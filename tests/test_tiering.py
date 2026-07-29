"""Power-tier decisions.

The property that matters: Relay yields the GPU when something else needs it,
without flapping, and never goes deaf as a result.
"""

import pytest

from relay import config
from relay.config import TIER_FULL, TIER_LITE, TIER_SLEEP
from relay.models.manager import CHATTERBOX_VRAM_MIB, ModelManager
from relay.models.vram import GpuState, matches_heavy_app
from relay.tts.engine import CHATTERBOX, KOKORO, VoiceRouter


class FakeTTS:
    def __init__(self, name):
        self.name = name
        self.unloaded = False
        self.loaded = False

    async def unload(self):
        self.unloaded = True

    async def load(self, warm=True):
        self.loaded = True


class FakeGpu:
    def __init__(self, free_mib, total_mib=8188, available=True):
        self.free = free_mib
        self.total = total_mib
        self.available = available

    def state(self):
        if not self.available:
            return None
        return GpuState(total_mib=self.total, used_mib=self.total - self.free,
                        free_mib=self.free)


def build(free_mib=6000, available=True, tier=TIER_LITE):
    cfg = config.load()
    voices = VoiceRouter(FakeTTS(KOKORO), FakeTTS(CHATTERBOX))
    manager = ModelManager(cfg, voices)
    manager.gpu = FakeGpu(free_mib, available=available)
    manager.tier = tier
    return manager


# --------------------------------------------------------------- thresholds
def test_restore_bar_is_higher_than_the_evict_bar():
    """Hysteresis: without this a game hovering at the line makes Relay flap."""
    manager = build()
    assert manager.restore_above_mib > manager.evict_below_mib


def test_loading_requires_room_for_the_measured_model_size():
    manager = build()
    assert manager.restore_above_mib >= CHATTERBOX_VRAM_MIB


def test_loaded_model_is_not_judged_against_the_load_time_requirement():
    """Regression: Relay used to evict the voice it had just loaded.

    Free VRAM excludes whatever Chatterbox already holds, so once resident
    `free` is ~3 GiB lower. Comparing that against the load-time requirement
    made the model's own footprint look like pressure:

        tier lite -> full  (6469 MiB free)
        chatterbox ready                      <- consumes ~3 GiB
        tier full -> lite  (only 3435 MiB free)
    """
    # Exactly the state observed in the log above.
    manager = build(free_mib=3435, tier=TIER_FULL)
    tier, reason = manager.desired_tier()
    assert tier == TIER_FULL, f"evicted itself: {reason}"


def test_a_full_load_cycle_settles_instead_of_flapping():
    """Promote with plenty free, then re-evaluate at the post-load level."""
    manager = build(free_mib=6469, tier=TIER_LITE)
    assert manager.desired_tier()[0] == TIER_FULL

    manager.tier = TIER_FULL
    manager.gpu = FakeGpu(6469 - CHATTERBOX_VRAM_MIB)   # what loading costs us
    assert manager.desired_tier()[0] == TIER_FULL, "must stay put after loading"


def test_real_outside_pressure_still_evicts():
    """A game taking the rest of the card must still push Relay off."""
    manager = build(free_mib=300, tier=TIER_FULL)
    assert manager.desired_tier()[0] == TIER_LITE


# ---------------------------------------------------------------- decisions
def test_plenty_of_vram_promotes_to_gpu():
    manager = build(free_mib=6000, tier=TIER_LITE)
    tier, _ = manager.desired_tier()
    assert tier == TIER_FULL


def test_scarce_vram_stays_on_cpu():
    manager = build(free_mib=1500, tier=TIER_LITE)
    tier, reason = manager.desired_tier()
    assert tier == TIER_LITE
    assert "VRAM" in reason


def test_no_gpu_machine_stays_on_cpu():
    manager = build(available=False)
    tier, reason = manager.desired_tier()
    assert tier == TIER_LITE
    assert "no GPU" in reason


def test_a_running_game_forces_cpu_even_with_free_vram():
    """The window event arrives before the game has finished allocating, so
    free VRAM still looks fine at that moment."""
    manager = build(free_mib=6000, tier=TIER_FULL)
    manager.heavy_app = "cs2"
    tier, reason = manager.desired_tier()
    assert tier == TIER_LITE
    assert "cs2" in reason


def test_hysteresis_prevents_flapping_in_the_middle_band():
    """Between the two thresholds, whichever tier we're in should persist."""
    midpoint = 2000  # above evict_below (700), below restore_above (4700)

    on_gpu = build(free_mib=midpoint, tier=TIER_FULL)
    assert on_gpu.desired_tier()[0] == TIER_FULL, "should not drop in the middle band"

    on_cpu = build(free_mib=midpoint, tier=TIER_LITE)
    assert on_cpu.desired_tier()[0] == TIER_LITE, "should not promote in the middle band"


def test_manual_override_beats_everything():
    manager = build(free_mib=8000)
    manager.manual_override = TIER_SLEEP
    tier, reason = manager.desired_tier()
    assert tier == TIER_SLEEP
    assert "asked" in reason


# -------------------------------------------------------------- transitions
async def test_dropping_to_cpu_unloads_the_gpu_voice():
    manager = build(free_mib=6000, tier=TIER_FULL)
    manager.voices.prefer(CHATTERBOX)

    await manager.set_tier(TIER_LITE, reason="test", announce=False)

    assert manager.voices.chatterbox.unloaded
    assert manager.voices.active.name == KOKORO


async def test_transition_is_announced_out_loud():
    manager = build(free_mib=1000, tier=TIER_FULL)
    said = []

    async def announce(text):
        said.append(text)

    manager.announce = announce
    manager.heavy_app = "blender"
    await manager.set_tier(TIER_LITE, reason="blender is running")

    assert said and "CPU mode" in said[0]
    assert "blender" in said[0]


async def test_sleep_and_wake_round_trip():
    manager = build(free_mib=6000, tier=TIER_FULL)
    await manager.sleep()
    assert manager.tier == TIER_SLEEP
    assert manager.manual_override == TIER_SLEEP

    await manager.wake()
    assert manager.manual_override is None
    assert manager.tier == TIER_FULL


async def test_setting_the_same_tier_is_a_noop():
    manager = build(tier=TIER_LITE)
    said = []

    async def announce(text):
        said.append(text)

    manager.announce = announce
    await manager.set_tier(TIER_LITE, reason="test")
    assert said == []


# ------------------------------------------------------------- heavy apps
@pytest.mark.parametrize(
    ("window_class", "title"),
    [
        ("steam_app_730", "Counter-Strike 2"),
        ("blender", "Blender"),
        ("Unity", "Unity Editor"),
        ("cs2", "cs2"),
        ("obs", "OBS Studio"),
    ],
)
def test_heavy_applications_are_recognised(window_class, title):
    cfg = config.load()
    assert matches_heavy_app(window_class, title, cfg.models.heavy_apps)


@pytest.mark.parametrize(
    ("window_class", "title"),
    [("kitty", "terminal"), ("zen", "Zen Browser"), ("discord", "Discord")],
)
def test_ordinary_applications_do_not_trigger_a_drop(window_class, title):
    cfg = config.load()
    assert not matches_heavy_app(window_class, title, cfg.models.heavy_apps)


# ------------------------------------------------------------------ status
def test_status_reports_what_the_user_would_want_to_know():
    manager = build(free_mib=5000, tier=TIER_FULL)
    status = manager.status()
    assert status["tier"] == TIER_FULL
    assert status["gpu_free_mib"] == 5000
    assert status["gpu_total_mib"] == 8188
    assert status["voice"] in (KOKORO, CHATTERBOX)

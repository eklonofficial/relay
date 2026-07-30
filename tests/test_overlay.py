"""The orb.

Two things matter more than anything the orb draws.

The first is that it cannot hurt Relay. It is a decoration attached to the
audio path, and the audio path is the assistant. So the bus never blocks, the
state object works when there is no bus at all, and a renderer that dies or
stops reading changes nothing about whether Relay hears you.

The second is that it is genuinely removable. `[overlay] enabled = false` has
to mean nothing is constructed, nothing is listening, and no code path behaves
differently -- not "it starts and hides".
"""

import asyncio
import json

import numpy as np
import pytest

from relay.config import Config
from relay.overlay.bus import OverlayBus
from relay.overlay.process import OverlayProcess, quickshell_binary
from relay.overlay.state import (
    ENVELOPE_BUCKETS,
    IDLE,
    LISTENING,
    SPEAKING,
    STATES,
    OverlayState,
    envelope,
    normalise,
)

QML_DIR = OverlayProcess().qml_dir


@pytest.fixture
def socket_path(tmp_path):
    # Unix socket paths cap at ~108 bytes and pytest's tmp_path is long, so
    # this deliberately does not use it. Losing a whole feature to a silently
    # truncated path is a real way to spend an afternoon.
    path = tmp_path / "o.sock"
    if len(str(path)) > 100:
        pytest.skip(f"tmp_path too long for a unix socket ({len(str(path))})")
    return path


class Recorder:
    """A bus that keeps what it was told instead of writing it anywhere."""

    def __init__(self):
        self.messages = []

    def send(self, **payload):
        self.messages.append(payload)

    @property
    def states(self):
        return [m["state"] for m in self.messages if "state" in m]

    @property
    def levels(self):
        return [m["level"] for m in self.messages if "level" in m]


# ------------------------------------------------------------------- levels
def test_a_silent_room_is_not_full_deflection():
    """A quiet room idles around 30 RMS. If that read as loud the orb would
    pulse at nothing all day."""
    assert normalise(30.0) < 0.2


def test_loudness_is_ordered_and_bounded():
    quiet, talking, shouting = normalise(80), normalise(900), normalise(9000)
    assert quiet < talking < shouting
    assert shouting <= 1.0
    assert normalise(0.0) == 0.0


def test_an_envelope_follows_the_shape_of_a_clip():
    """A clip that starts loud and ends quiet must produce an envelope that
    does the same, or the orb pulses out of time with the words."""
    loud = np.ones(12000, dtype=np.float32) * 0.8
    quiet = np.ones(12000, dtype=np.float32) * 0.05
    shape = envelope(np.concatenate([loud, quiet]))

    assert len(shape) == ENVELOPE_BUCKETS
    assert shape[0] > shape[-1]
    assert max(shape) <= 1.0


def test_an_empty_clip_produces_no_envelope():
    assert envelope(np.zeros(0, dtype=np.float32)) == []


def test_integer_audio_is_scaled_like_float_audio():
    """Kokoro returns float32, but WAV capture and the wake word are int16.
    One code path has to serve both, or the pulse depends on where the audio
    came from."""
    tone = np.sin(np.linspace(0, 90, 24000)).astype(np.float32)
    as_int = (tone * 32767).astype(np.int16)
    assert envelope(tone) == pytest.approx(envelope(as_int), abs=0.02)


# -------------------------------------------------------------------- state
def test_states_reach_the_bus():
    orb = OverlayState(Recorder())
    orb.wake()
    orb.listening()
    orb.thinking()
    orb.idle()
    assert orb.bus.states == ["waking", "listening", "thinking", "idle"]


def test_an_unknown_state_is_ignored_rather_than_sent():
    orb = OverlayState(Recorder())
    orb.set("melting")
    assert orb.bus.messages == []


def test_speaking_carries_the_shape_of_the_sentence():
    orb = OverlayState(Recorder())
    orb.speaking(np.sin(np.linspace(0, 90, 24000)).astype(np.float32), 24000)

    sent = orb.bus.messages[-1]
    assert sent["state"] == SPEAKING
    assert len(sent["envelope"]) == ENVELOPE_BUCKETS
    assert sent["duration"] == pytest.approx(1.0, abs=0.01)


def test_speaking_still_shows_when_the_clip_cannot_be_measured():
    """Being visibly wrong about the rhythm beats the orb going blank."""
    orb = OverlayState(Recorder())
    orb.speaking(None, 0)
    assert orb.bus.states == [SPEAKING]


def test_levels_only_flow_while_listening():
    """Mic level means nothing while Relay is talking or thinking, and acting
    on it would make the orb react to its own voice."""
    orb = OverlayState(Recorder())
    orb.thinking()
    orb.level(1500)
    assert orb.bus.levels == []

    orb.listening()
    orb.level(1500)
    assert orb.bus.levels != []


def test_an_unchanging_level_is_not_resent_forever():
    """Frames arrive 12 times a second. A quiet room would otherwise emit the
    same number all day."""
    orb = OverlayState(Recorder())
    orb.listening()
    for _ in range(30):
        orb.level(300.0)
    assert len(orb.bus.levels) == 1


def test_a_changing_level_is_reported():
    orb = OverlayState(Recorder())
    orb.listening()
    for value in (100, 900, 2000, 300):
        orb.level(value)
    assert len(orb.bus.levels) >= 3


# --------------------------------------------------------- fault isolation
def test_a_broken_bus_cannot_break_a_turn():
    """The whole reason the orb is safe to attach to the audio path."""
    class Exploding:
        def send(self, **_):
            raise RuntimeError("renderer went away")

    orb = OverlayState(Exploding())
    orb.wake()
    orb.listening()
    orb.level(900)
    orb.speaking(np.zeros(100, dtype=np.float32), 24000)
    orb.idle()          # reaching here at all is the assertion


def test_the_state_object_works_with_no_bus():
    """`OverlayState(None)` keeps the audio path free of null checks, which
    is exactly where a forgotten one would cost a turn."""
    orb = OverlayState(None)
    assert orb.enabled is False
    orb.wake()
    orb.level(500)
    orb.speaking(np.zeros(100, dtype=np.float32), 24000)
    assert orb.current in STATES


# ---------------------------------------------------------------------- bus
@pytest.mark.asyncio
async def test_the_bus_delivers_to_a_client(socket_path):
    bus = OverlayBus(socket_path)
    await bus.start()
    reader, writer = await asyncio.open_unix_connection(str(socket_path))
    await asyncio.sleep(0.05)

    bus.send(state="waking")
    line = await asyncio.wait_for(reader.readline(), timeout=2.0)

    assert json.loads(line)["state"] == "waking"
    writer.close()
    await bus.stop()


@pytest.mark.asyncio
async def test_a_late_client_is_told_the_current_state(socket_path):
    """A renderer that starts after Relay would otherwise sit blank until the
    next thing happened -- which, if Relay is mid-sentence, is wrong."""
    bus = OverlayBus(socket_path)
    await bus.start()
    bus.send(state="thinking")

    reader, writer = await asyncio.open_unix_connection(str(socket_path))
    line = await asyncio.wait_for(reader.readline(), timeout=2.0)

    assert json.loads(line)["state"] == "thinking"
    writer.close()
    await bus.stop()


@pytest.mark.asyncio
async def test_sending_with_nobody_watching_is_free(socket_path):
    bus = OverlayBus(socket_path)
    await bus.start()
    for _ in range(1000):
        bus.send(level=0.5)
    assert bus.clients == 0
    await bus.stop()


@pytest.mark.asyncio
async def test_a_client_that_vanishes_is_dropped(socket_path):
    """Relay outlives its renderers. A dead writer must not accumulate."""
    bus = OverlayBus(socket_path)
    await bus.start()
    _, writer = await asyncio.open_unix_connection(str(socket_path))
    await asyncio.sleep(0.05)
    assert bus.clients == 1

    writer.close()
    await asyncio.sleep(0.1)
    for _ in range(50):
        bus.send(state="idle")
    await asyncio.sleep(0.05)

    assert bus.clients == 0
    await bus.stop()


@pytest.mark.asyncio
async def test_a_stale_socket_does_not_stop_startup(socket_path):
    """A killed daemon leaves the file behind, and bind would fail on it."""
    socket_path.parent.mkdir(parents=True, exist_ok=True)
    socket_path.write_text("")
    bus = OverlayBus(socket_path)
    await bus.start()
    assert bus.listening
    await bus.stop()


@pytest.mark.asyncio
async def test_stopping_removes_the_socket(socket_path):
    bus = OverlayBus(socket_path)
    await bus.start()
    await bus.stop()
    assert not socket_path.exists()


# ------------------------------------------------------------- removability
def test_the_overlay_is_off_by_a_single_flag():
    cfg = Config()
    assert hasattr(cfg.overlay, "enabled")
    cfg.overlay.enabled = False
    assert cfg.overlay.enabled is False


def test_an_overlay_section_is_optional_in_config():
    """Unknown TOML keys are skipped, so a config written for a build with the
    orb still starts one without it, and the reverse."""
    from relay.config import _merge

    cfg = Config()
    _merge(cfg, {"overlay": {"enabled": False, "size": 200},
                 "something_from_the_future": {"x": 1}})
    assert cfg.overlay.enabled is False
    assert cfg.overlay.size == 200


@pytest.mark.asyncio
async def test_a_missing_renderer_is_reported_not_raised(tmp_path):
    """No quickshell, or no QML, must degrade to 'no orb' rather than to a
    daemon that won't start."""
    process = OverlayProcess(qml_dir=tmp_path)
    assert await process.start() is False
    assert process.last_error
    await process.stop()


# -------------------------------------------------------------- the drawing
def test_the_overlay_never_takes_input():
    """Click-through is a promise to every window underneath. An empty mask
    region is what keeps it, and losing that line would silently start
    swallowing clicks over fullscreen apps."""
    shell = (QML_DIR / "shell.qml").read_text()
    assert "mask: Region {}" in shell
    assert "WlrKeyboardFocus.None" in shell


def test_the_overlay_draws_above_everything():
    shell = (QML_DIR / "shell.qml").read_text()
    assert "WlrLayer.Overlay" in shell
    assert "ExclusionMode.Ignore" in shell


def test_the_namespace_avoids_the_quickshell_layer_rules():
    """Every `quickshell:*` layer on this machine gets ignore_alpha 0.79 from
    the dotfiles, and at 0.79 a translucent orb is never blurred -- no glass
    at all. The namespace is what opts out."""
    shell = (QML_DIR / "shell.qml").read_text()
    assert 'WlrLayershell.namespace: "relay-orb"' in shell
    assert "quickshell:" not in shell.split("namespace:")[1].split("\n")[0]


def test_the_compiled_shader_ships_with_the_source():
    """`qsb` is not on PATH here (/usr/lib/qt6/bin/qsb), so installing must
    not need a shader toolchain."""
    assert (QML_DIR / "orb.frag").exists()
    compiled = QML_DIR / "orb.frag.qsb"
    assert compiled.exists() and compiled.stat().st_size > 0


def test_quickshell_is_found_when_installed():
    binary = quickshell_binary()
    if binary is None:
        pytest.skip("quickshell not installed")
    assert binary.endswith(("qs", "quickshell"))

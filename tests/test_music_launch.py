"""Starting Cider when it isn't already running.

Asking for music should just work, whether or not the player is open. The
awkward part is the wait: a cold Electron start takes several seconds, and
silence during it reads as a failure, so the launch announces itself.

The rule that shapes these tests: only *playing* starts the player. Pausing a
player that isn't running should say so, not open a music app.
"""

import pytest

from relay import config as config_mod
from relay.memory.store import MemoryStore
from relay.tools import base as tool_base
from relay.tools import cider as cider_mod
from relay.tools import music


class Spy:
    """Stands in for the voice loop, recording what got spoken."""

    def __init__(self):
        self.said = []

    async def say_once(self, text):
        self.said.append(text)


@pytest.fixture
def wired(tmp_path, monkeypatch):
    """A tool context with a real config and a fake voice."""
    store = MemoryStore(tmp_path / "relay.db")
    store.connect()
    cfg = config_mod.Config()
    cfg.music.launch_timeout_s = 0.3
    voice = Spy()
    tool_base.set_context(tool_base.ToolContext(cfg=cfg, store=store, speak=voice))
    music.reset_client()
    yield cfg, voice
    music.reset_client()


def fake_api(monkeypatch, *, up_after=0):
    """Replace the Cider client. `up_after` = how many probes before it answers."""
    state = {"probes": 0}

    async def is_up(self):
        state["probes"] += 1
        return state["probes"] > up_after

    monkeypatch.setattr(cider_mod.CiderClient, "is_up", is_up)
    return state


def fake_launch(monkeypatch, *, succeeds=True):
    launched = []

    async def exec_command(command, workspace=None):
        launched.append(command)
        return (succeeds, "" if succeeds else "no such binary")

    monkeypatch.setattr(music.hypr, "exec_command", exec_command)
    return launched


# ---------------------------------------------------------------- already up
async def test_a_running_cider_is_not_launched_again(wired, monkeypatch):
    fake_api(monkeypatch, up_after=0)
    launched = fake_launch(monkeypatch)

    ready, message = await music.ensure_cider()

    assert ready and message == ""
    assert launched == [], "Cider was already running"


async def test_nothing_is_announced_when_cider_is_already_up(wired, monkeypatch):
    _cfg, voice = wired
    fake_api(monkeypatch, up_after=0)
    fake_launch(monkeypatch)

    await music.ensure_cider()

    assert voice.said == [], "the common path should be silent"


# -------------------------------------------------------------- cold start
async def test_a_closed_cider_is_launched_and_waited_for(wired, monkeypatch):
    fake_api(monkeypatch, up_after=2)
    launched = fake_launch(monkeypatch)

    ready, message = await music.ensure_cider()

    assert ready, message
    assert launched == ["cider"]


async def test_the_wait_is_announced_so_silence_is_not_mistaken_for_failure(
    wired, monkeypatch
):
    _cfg, voice = wired
    fake_api(monkeypatch, up_after=2)
    fake_launch(monkeypatch)

    await music.ensure_cider()

    assert any("Starting Cider" in line for line in voice.said)


async def test_the_launch_goes_through_the_hyprland_adapter(wired, monkeypatch):
    """Hyprland 0.55 moved dispatch to Lua, so raw dispatch strings are a
    syntax error. Everything must go through the dialect adapter."""
    fake_api(monkeypatch, up_after=1)
    launched = fake_launch(monkeypatch)

    await music.ensure_cider()

    assert launched == ["cider"]


async def test_the_configured_player_is_what_gets_launched(wired, monkeypatch):
    cfg, _voice = wired
    cfg.music.player = "cider-2"
    fake_api(monkeypatch, up_after=1)
    launched = fake_launch(monkeypatch)

    await music.ensure_cider()

    assert launched == ["cider-2"]


# ---------------------------------------------------------------- failures
async def test_a_player_that_never_comes_up_is_reported_plainly(wired, monkeypatch):
    fake_api(monkeypatch, up_after=10_000)
    fake_launch(monkeypatch)

    ready, message = await music.ensure_cider()

    assert not ready
    assert "didn't finish starting" in message
    assert "Settings" in message, "should hint at the API being switched off"


async def test_a_failed_launch_says_why(wired, monkeypatch):
    fake_api(monkeypatch, up_after=10_000)
    fake_launch(monkeypatch, succeeds=False)

    ready, message = await music.ensure_cider()

    assert not ready
    assert "Couldn't start Cider" in message


async def test_giving_up_does_not_hang_past_the_timeout(wired, monkeypatch):
    import time

    fake_api(monkeypatch, up_after=10_000)
    fake_launch(monkeypatch)

    started = time.monotonic()
    await music.ensure_cider()
    # Timeout is 0.3s in this fixture; allow generous scheduling slack.
    assert time.monotonic() - started < 5.0


# ------------------------------------------------------- launch=False path
async def test_transport_commands_do_not_start_the_player(wired, monkeypatch):
    """Saying "pause" with nothing open should not open a music app."""
    fake_api(monkeypatch, up_after=10_000)
    launched = fake_launch(monkeypatch)

    ready, message = await music.ensure_cider(launch=False)

    assert not ready
    assert launched == []
    assert message == "Cider isn't running."


async def test_pause_reports_rather_than_launching(wired, monkeypatch):
    fake_api(monkeypatch, up_after=10_000)
    launched = fake_launch(monkeypatch)
    monkeypatch.setattr(cider_mod, "playerctl",
                        _async_return((False, "no players")))

    result = await music.music_pause.handler({})

    assert launched == [], "pausing must never launch Cider"
    assert result.get("is_error")
    assert "isn't running" in result["content"][0]["text"]


def _async_return(value):
    async def _inner(*args, **kwargs):
        return value
    return _inner


# ----------------------------------------------------------- MPRIS fallback
async def test_transport_falls_back_to_mpris_when_the_api_is_off(wired, monkeypatch):
    """A missing or wrong token shouldn't cost you pause and skip."""
    fake_api(monkeypatch, up_after=10_000)
    fake_launch(monkeypatch)
    calls = []

    async def playerctl(*args, player="cider"):
        calls.append(args)
        return True, ""

    monkeypatch.setattr(cider_mod, "playerctl", playerctl)

    result = await music.music_next.handler({})

    assert not result.get("is_error")
    assert calls == [("next",)]


async def test_the_fallback_can_be_switched_off(wired, monkeypatch):
    cfg, _voice = wired
    cfg.music.allow_mpris_fallback = False
    fake_api(monkeypatch, up_after=10_000)
    called = []

    async def playerctl(*args, player="cider"):
        called.append(args)
        return True, ""

    monkeypatch.setattr(cider_mod, "playerctl", playerctl)

    result = await music.music_pause.handler({})

    assert result.get("is_error")
    assert called == [], "fallback was disabled"


# ------------------------------------------------------------------ client
def test_the_client_is_built_from_config(wired):
    cfg, _voice = wired
    cfg.music.cider_url = "http://localhost:19999"
    cfg.music.cider_token = "abc"
    music.reset_client()

    api = music.client()

    assert api.base_url == "http://localhost:19999"
    assert api.token == "abc"


def test_resetting_the_client_picks_up_a_changed_token(wired):
    cfg, _voice = wired
    cfg.music.cider_token = "first"
    assert music.client().token == "first"

    cfg.music.cider_token = "second"
    music.reset_client()

    assert music.client().token == "second"

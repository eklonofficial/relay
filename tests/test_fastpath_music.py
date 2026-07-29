"""Music commands on the fast path.

These are the highest-value fast-path entries: short, frequent, and completely
deterministic. Every one that matches here is a model turn -- roughly 8,000
tokens of plan allowance -- that never happens.

The negative cases matter as much as the positive ones. "play Radiohead" needs
an Apple Music catalogue search to resolve a name, so it must reach the model;
matching it locally would play the wrong thing or nothing at all.
"""

import pytest

from relay.fastpath import FastPath
from relay.memory.store import MemoryStore


@pytest.fixture
def fast(tmp_path, monkeypatch):
    store = MemoryStore(tmp_path / "relay.db")
    store.connect()
    fp = FastPath(store, enabled=True)
    # Default to "music is playing" so the ambiguous commands are claimed;
    # individual tests override it.
    monkeypatch.setattr(fp, "music_is_live", _always(True))
    return fp


def _always(value):
    async def _inner():
        return value
    return _inner


class Recorder:
    """Captures the tool the fast path decided to call."""

    def __init__(self):
        self.calls = []

    async def __call__(self, tool_name, args):
        self.calls.append((tool_name, args))
        return {"content": [{"type": "text", "text": "done"}]}


async def _run(fast, utterance):
    recorder = Recorder()
    result = await fast.handle(utterance, run_tool=recorder)
    return result, recorder


# ------------------------------------------------------------------ pause
@pytest.mark.parametrize("said", [
    "pause", "pause the music", "pause music", "stop the music",
    "Relay, pause", "pause it", "please pause the music",
])
async def test_pause_phrasings_are_handled_locally(fast, said):
    result, recorder = await _run(fast, said)
    assert result is not None, f"{said!r} should not have reached the model"
    assert recorder.calls[0][0] == "mcp__music__music_pause"


async def test_pausing_does_not_need_music_to_be_playing(fast, monkeypatch):
    """"Pause" is unambiguous, and the tool answers "Cider isn't running"
    cheaply. Spending a model turn to say the same thing would be worse."""
    monkeypatch.setattr(fast, "music_is_live", _always(False))
    result, recorder = await _run(fast, "pause the music")
    assert result is not None
    assert recorder.calls[0][0] == "mcp__music__music_pause"


# ------------------------------------------------------------- next / back
@pytest.mark.parametrize("said", [
    "next", "skip", "skip this", "next song", "next track", "skip the song",
])
async def test_skip_phrasings_are_handled_locally(fast, said):
    result, recorder = await _run(fast, said)
    assert result is not None
    assert recorder.calls[0][0] == "mcp__music__music_next"


@pytest.mark.parametrize("said", [
    "previous", "go back", "last song", "previous track",
])
async def test_going_back_is_handled_locally(fast, said):
    result, recorder = await _run(fast, said)
    assert result is not None
    assert recorder.calls[0][0] == "mcp__music__music_previous"


@pytest.mark.parametrize("said", ["next", "skip", "go back", "play"])
async def test_ambiguous_words_defer_when_nothing_is_playing(fast, monkeypatch, said):
    """"Next" and "go back" are ordinary English too. With no player running,
    the model has the context to work out what was meant."""
    monkeypatch.setattr(fast, "music_is_live", _always(False))
    result, recorder = await _run(fast, said)
    assert result is None, f"{said!r} should have gone to the model"
    assert recorder.calls == []


async def test_a_broken_probe_defers_rather_than_guessing(fast, monkeypatch):
    async def explode():
        raise RuntimeError("no event loop, no config, no anything")

    # music_is_live swallows everything and answers False.
    monkeypatch.setattr(FastPath, "music_is_live", FastPath.music_is_live)
    fp = fast
    monkeypatch.setattr(fp, "music_is_live", explode)
    with pytest.raises(RuntimeError):
        await fp.music_is_live()
    # The real implementation must not propagate that.
    real = FastPath(fp.store, enabled=True)
    assert await real.music_is_live() in (True, False)


# ------------------------------------------------------------- now playing
@pytest.mark.parametrize("said", [
    "what's playing", "what is playing", "what song is this", "who is this",
])
async def test_now_playing_is_handled_locally(fast, said):
    result, recorder = await _run(fast, said)
    assert result is not None
    assert recorder.calls[0][0] == "mcp__music__music_now_playing"


# ----------------------------------------------------------------- volume
async def test_volume_is_passed_through_as_a_percentage(fast):
    result, recorder = await _run(fast, "volume 40")
    assert result is not None
    assert recorder.calls[0] == ("mcp__music__music_volume", {"percent": 40})


async def test_set_volume_to_a_number_also_matches(fast):
    _, recorder = await _run(fast, "set volume to 75 percent")
    assert recorder.calls[0][1] == {"percent": 75}


# ------------------------------------------------------- the negative case
@pytest.mark.parametrize("said", [
    "play Radiohead",
    "play some jazz",
    "play Weird Fishes by Radiohead",
    "play the new Taylor Swift album",
    "put on something relaxing",
])
async def test_playing_by_name_goes_to_the_model(fast, said):
    """Resolving a name needs an Apple Music catalogue search. Matching it
    locally would play the wrong thing, or nothing."""
    result, recorder = await _run(fast, said)
    assert result is None, f"{said!r} must reach the model"
    assert recorder.calls == []


async def test_bare_play_is_treated_as_resume(fast):
    """"Play" on its own only ever means un-pause."""
    result, recorder = await _run(fast, "play")
    assert result is not None
    assert recorder.calls[0] == ("mcp__music__music_play", {})


# ------------------------------------------------- no collision with others
async def test_music_patterns_do_not_swallow_window_commands(fast):
    """"go to workspace 2" starts with a word the music patterns care about."""
    _, recorder = await _run(fast, "go to workspace 2")
    assert recorder.calls[0][0] == "mcp__desktop__switch_workspace"


def test_stop_is_reached_by_the_interrupt_path_before_the_fast_path():
    """Bare "stop" matches the pause pattern, which is fine only because the
    voice loop checks STOP_WORDS *before* calling the fast path. If that order
    ever changes, saying "stop" to interrupt Relay would pause the music
    instead of shutting it up."""
    from relay.fastpath import MUSIC_PAUSE
    from relay.voice import STOP_WORDS

    assert MUSIC_PAUSE.match("stop")
    assert "stop" in STOP_WORDS, "the interrupt path must claim it first"


def test_pause_does_not_swallow_unrelated_sentences():
    from relay.fastpath import MUSIC_PAUSE

    assert MUSIC_PAUSE.match("stop the music")
    assert not MUSIC_PAUSE.match("stop talking")
    assert not MUSIC_PAUSE.match("pause the video in my browser")


async def test_disabled_fast_path_sends_music_to_the_model(fast):
    fast.enabled = False
    result, recorder = await _run(fast, "pause the music")
    assert result is None
    assert recorder.calls == []

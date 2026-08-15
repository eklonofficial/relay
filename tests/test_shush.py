"""`relay shush` and `relay come back`.

Two things make this more than a boolean.

The first is that Relay already had a way to stop listening -- `pause()`,
used while it speaks -- and building on it would have been wrong in a way
that only shows up in use: `say()` calls `resume()` in a `finally`, so a mute
routed through the pause flag would survive exactly until the first sentence
Relay spoke. Several tests here exist to hold those two apart.

The second is that a shush is a promise about a room, not about a process.
Restarting for an update must not break it, so it is written down.
"""

import json

import numpy as np
import pytest

from relay.audio.capture import FRAME_SAMPLES
from relay.audio.listener import Listener, VoiceActivity, WakeWordDetector


class ScriptedMic:
    def __init__(self, frames: int = 30):
        self.frames_to_yield = frames
        self.drained = 0
        self._queued = 9
        self.device = "test"
        self._capture_rate = 16_000
        self.dropped_frames = 0
        self.frames_yielded = 0
        self.consumers = 1

    async def frames(self):
        for _ in range(self.frames_to_yield):
            yield (np.ones(FRAME_SAMPLES) * 6000).astype(np.int16)

    def preroll(self):
        return np.zeros(0, dtype=np.int16)

    def drain(self) -> int:
        self.drained += 1
        dropped, self._queued = self._queued, 0
        return dropped


class AlwaysFires(WakeWordDetector):
    """So anything that fails to produce a turn was stopped deliberately."""

    def score(self, frame):
        return "relay", 0.99

    def reset(self):
        pass


class LoudnessVad(VoiceActivity):
    def __init__(self):
        super().__init__()
        self._vad = None

    def is_speech(self, frame):
        return float(np.abs(frame.astype(np.float32)).mean()) > 100

    def reset(self):
        pass


class Watcher:
    """The orb and the ducker, as far as the listener is concerned."""

    def __init__(self):
        self.events = []

    def wake(self):
        self.events.append("wake")

    def idle(self):
        self.events.append("idle")


@pytest.fixture
def listener(tmp_path):
    return Listener(ScriptedMic(), AlwaysFires(), LoudnessVad(),
                    silence_ms=240, lead_in_ms=0,
                    mute_file=tmp_path / "muted.json")


async def turns(listener):
    return [u async for u in listener.utterances()]


# ------------------------------------------------------------ the wake word
async def test_the_wake_word_is_ignored_while_shushed(listener):
    listener.mute()
    assert await turns(listener) == []


async def test_the_wake_word_works_again_after_come_back(listener):
    listener.mute()
    listener.unmute()
    assert await turns(listener), "come back left the wake word off"


async def test_shushing_does_not_deafen_the_diagnostics(listener):
    """`relay mic` has to stay useful, or a shush and a dead microphone look
    identical from the outside -- which is the whole reason to check."""
    listener.mute()
    await turns(listener)
    assert listener.frames_seen == 30
    assert listener.peak_level > 0


# ----------------------------------------------------- the deliberate route
async def test_push_to_talk_still_works_while_shushed(listener):
    """The key cannot go off by itself, so it stays live: there is always a
    way to say something without a trip to the terminal."""
    listener.mute()
    listener.trigger()
    assert len(await turns(listener)) == 1


async def test_a_push_to_talk_turn_leaves_no_window_open(listener):
    """Otherwise the one turn allowed while shushed would re-arm the
    microphone behind it, and Relay would be listening again by accident."""
    listener.mute()
    listener.open_follow_up()
    assert not listener.follow_up_pending
    assert not listener.listening_for_follow_up


async def test_shushing_closes_a_window_that_is_already_open(listener):
    listener.open_follow_up()
    listener.follow_up_pending = False
    listener.follow_up_until = float("inf")
    listener.mute()
    assert not listener.listening_for_follow_up
    assert not listener.follow_up_pending


# ----------------------------------------------------- not the same as paused
def test_speaking_does_not_undo_a_shush(listener):
    """The bug a simpler implementation would have.

    `say()` pauses the microphone and resumes it in a `finally`. If mute were
    the same flag, the first thing Relay said would unmute it -- and Relay
    says something on almost every path out of here.
    """
    listener.mute()
    listener.pause()
    listener.resume()
    assert listener.muted, "resume() cleared the shush"


async def test_resuming_does_not_let_the_wake_word_back_in(listener):
    listener.mute()
    listener.pause()
    listener.resume()
    assert await turns(listener) == []


def test_unmuting_does_not_disturb_the_pause(listener):
    """The other direction: coming back mid-sentence must not deafen Relay to
    its own speech-tail handling."""
    listener.pause()
    listener.mute()
    listener.unmute()
    assert listener._paused, "unmute() cleared a pause it did not set"


# ------------------------------------------------------------- side effects
def test_shushing_puts_the_music_back(listener):
    """A shush can land mid-turn, with the orb out and the music ducked. The
    events that would normally undo both are the ones just switched off."""
    watcher = Watcher()
    listener.watch(watcher)
    listener.mute()
    assert watcher.events == ["idle"]


def test_coming_back_drops_what_was_captured_during_the_silence(listener):
    """It was recorded during a silence someone asked for. Transcribing it as
    the next command is the same bug that had Relay answering itself."""
    listener.mute()
    listener.unmute()
    assert listener.microphone.drained == 1


# ---------------------------------------------------------------- it sticks
def test_a_shush_is_written_down(listener):
    listener.mute()
    assert listener.mute_file.exists()
    assert json.loads(listener.mute_file.read_text())["since"] > 0


def test_coming_back_clears_it(listener):
    listener.mute()
    listener.unmute()
    assert not listener.mute_file.exists()


def test_a_shush_survives_a_restart(tmp_path):
    """The reason it is written down at all: `relay shush` is said because of
    something in the room, and none of those end because Relay restarted."""
    path = tmp_path / "muted.json"
    first = Listener(ScriptedMic(), AlwaysFires(), LoudnessVad(), mute_file=path)
    first.mute()

    revived = Listener(ScriptedMic(), AlwaysFires(), LoudnessVad(), mute_file=path)
    assert not revived.muted, "state should come from the file, not the constructor"
    assert revived.restore_mute()
    assert revived.muted
    assert revived.stats()["muted_for_s"] is not None


def test_nothing_written_means_listening(tmp_path):
    fresh = Listener(ScriptedMic(), AlwaysFires(), LoudnessVad(),
                     mute_file=tmp_path / "muted.json")
    assert not fresh.restore_mute()
    assert not fresh.muted


def test_a_corrupt_record_still_counts_as_shushed(tmp_path):
    """Of the two ways to read a damaged file wrong, staying quiet is the one
    that can be undone by typing a command. The other one talks in a room
    that asked for silence."""
    path = tmp_path / "muted.json"
    path.write_text("{not json")
    listener = Listener(ScriptedMic(), AlwaysFires(), LoudnessVad(), mute_file=path)
    assert listener.restore_mute()
    assert listener.muted


def test_an_unwritable_state_directory_is_not_fatal(tmp_path):
    """Losing the file costs the setting across a restart. Raising here would
    cost the command, and Relay would keep talking."""
    path = tmp_path / "nope"
    path.write_text("i am a file, not a directory")
    listener = Listener(ScriptedMic(), AlwaysFires(), LoudnessVad(),
                        mute_file=path / "muted.json")
    listener.mute()
    assert listener.muted


# ------------------------------------------------------------------ report
def test_stats_say_so(listener):
    assert listener.stats()["muted"] is False
    assert listener.stats()["muted_for_s"] is None
    listener.mute()
    assert listener.stats()["muted"] is True
    assert listener.stats()["muted_for_s"] >= 0


def test_muting_twice_keeps_the_original_time(listener):
    listener.mute()
    first = listener.muted_since
    listener.mute()
    assert listener.muted_since == first

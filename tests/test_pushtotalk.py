"""Push-to-talk and abort.

Relay is deaf while it speaks, so the keybinding is the only way to interrupt
it. That makes this the one input path that runs *while* the microphone is
paused and Relay's own voice is still in the buffer -- the exact conditions
that produced the self-hearing bugs, so the draining is asserted here.
"""

import numpy as np
import pytest

from relay.audio.capture import FRAME_SAMPLES
from relay.audio.listener import Listener, VoiceActivity, WakeWordDetector
from relay.audio.playback import Playback
from relay.voice import VoiceLoop


class ScriptedMic:
    def __init__(self, frames: int = 40):
        self.frames_to_yield = frames
        self.drained = 0
        self._queued = 12
        # Diagnostics that Listener.stats() reads off the microphone.
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


class QuietMic(ScriptedMic):
    async def frames(self):
        for _ in range(self.frames_to_yield):
            yield np.zeros(FRAME_SAMPLES, dtype=np.int16)


class LoudnessVad(VoiceActivity):
    def __init__(self):
        super().__init__()
        self._vad = None

    def is_speech(self, frame):
        return float(np.abs(frame.astype(np.float32)).mean()) > 100

    def reset(self):
        pass


def _listener(mic=None) -> Listener:
    return Listener(
        mic or ScriptedMic(), WakeWordDetector(), LoudnessVad(),
        silence_ms=240, max_utterance_s=5, lead_in_ms=0,
    )


# ------------------------------------------------------------------ listener
def test_trigger_is_not_armed_by_default():
    assert not _listener().triggered


def test_trigger_sets_the_flag():
    listener = _listener()
    listener.trigger()
    assert listener.triggered


async def test_a_trigger_produces_an_utterance_without_a_wake_word():
    listener = _listener()
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert found, "push-to-talk should have recorded something"
    assert found[0].push_to_talk
    assert found[0].wake_word == "push_to_talk"


async def test_push_to_talk_works_while_paused():
    """The whole point: Relay is paused exactly when it is speaking."""
    listener = _listener()
    listener.pause()
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert found, "a paused listener still has to answer the key"
    assert not listener._paused, "triggering should clear the pause"


async def test_triggering_drains_the_microphone_first():
    """Regression guard for the self-hearing bug class.

    While Relay speaks, the frame queue keeps filling with Relay's own voice.
    Recording without dropping that backlog transcribes Relay's last reply as
    the user's next command.
    """
    mic = ScriptedMic()
    listener = _listener(mic)
    listener.pause()
    listener.trigger()
    [u async for u in listener.utterances()]
    assert mic.drained >= 1, "buffered audio must be dropped before recording"


async def test_the_trigger_is_consumed_not_repeated():
    listener = _listener()
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert len(found) == 1, "one key press is one turn"
    assert not listener.triggered


async def test_a_trigger_that_catches_silence_is_discarded():
    listener = _listener(QuietMic())
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert found == [], "a mis-press should not start an empty turn"


async def test_triggering_closes_an_open_follow_up_window():
    listener = _listener()
    listener.open_follow_up()
    listener.trigger()
    [u async for u in listener.utterances()]
    assert not listener.listening_for_follow_up
    assert not listener.follow_up_pending


def test_push_to_talk_count_is_reported():
    listener = _listener()
    assert listener.stats()["push_to_talks"] == 0


# --------------------------------------------------------------- voice loop
class FakePlayback:
    def __init__(self):
        self.interrupted = 0

    def interrupt(self):
        self.interrupted += 1


class FakeListener:
    def __init__(self):
        self.triggered = False
        self.closed = 0
        self.opened = 0

    def trigger(self):
        self.triggered = True

    def close_follow_up(self):
        self.closed += 1

    def open_follow_up(self):
        self.opened += 1

    def pause(self):
        pass

    def resume(self):
        pass


def _loop() -> VoiceLoop:
    loop = VoiceLoop.__new__(VoiceLoop)
    loop.playback = FakePlayback()
    loop.listener = FakeListener()
    loop._aborted = False
    loop._last_spoken = None
    loop.pause_while_speaking = True
    loop.cooldown_s = 0.0
    return loop


def test_abort_stops_playback_and_closes_the_window():
    loop = _loop()
    loop.abort()
    assert loop.playback.interrupted == 1
    assert loop.listener.closed == 1
    assert loop._aborted


async def test_abort_silences_subsequent_sentences():
    """Stopping playback alone isn't enough: the next streamed sentence would
    simply start speaking."""
    loop = _loop()
    spoken = []

    async def fake_synth(text):
        spoken.append(text)
        raise AssertionError("should not synthesise after an abort")

    loop.voices = type("V", (), {"synthesise": staticmethod(fake_synth)})()
    loop.abort()
    await loop.say("this should never be spoken")
    assert spoken == []


async def test_push_to_talk_interrupts_then_triggers():
    loop = _loop()
    await loop.listen_now()
    assert loop.playback.interrupted == 1, "must stop speaking first"
    assert loop.listener.triggered, "then take the command"


def test_an_aborted_turn_does_not_leave_a_follow_up_open():
    loop = _loop()
    loop.abort()
    loop._offer_follow_up()
    assert loop.listener.opened == 0


def test_a_pending_push_to_talk_suppresses_the_follow_up_window():
    """Otherwise the key press and the window race to record the same speech."""
    loop = _loop()
    loop.listener.triggered = True
    loop._offer_follow_up()
    assert loop.listener.opened == 0


def test_a_normal_turn_still_opens_the_follow_up_window():
    loop = _loop()
    loop._offer_follow_up()
    assert loop.listener.opened == 1

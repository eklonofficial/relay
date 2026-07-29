"""Conversation mode: talking again without repeating the wake word.

Modelled on Alexa's Follow-Up Mode (~5s window). The risk it documents is
false triggers from background speech, so these tests focus on the window
closing correctly rather than just opening.
"""

import time

import numpy as np
import pytest

from relay.audio.capture import FRAME_SAMPLES
from relay.audio.listener import Listener, VoiceActivity, WakeWordDetector
from relay.audio.capture import rms


class ScriptedMic:
    def __init__(self, script):
        self.script = script
        self.device = None
        self._capture_rate = 16000
        self.dropped_frames = 0
        self.frames_yielded = 0
        self.consumers = 0

    async def frames(self):
        for is_speech in self.script:
            yield (np.ones(FRAME_SAMPLES) * (6000 if is_speech else 0)).astype(np.int16)

    def preroll(self):
        return np.zeros(0, dtype=np.int16)


class LoudnessVad(VoiceActivity):
    def __init__(self):
        super().__init__()
        self._vad = None

    def is_speech(self, frame):
        return rms(frame) > 100

    def reset(self):
        pass


class NeverFires(WakeWordDetector):
    """So any utterance produced must have come from the follow-up window."""

    def score(self, frame):
        return None, 0.0

    def reset(self):
        pass


def build(script, **kwargs):
    return Listener(ScriptedMic(script), NeverFires(), LoudnessVad(),
                    silence_ms=240, lead_in_ms=0, **kwargs)


# ----------------------------------------------------------------- window
def test_window_is_closed_by_default():
    listener = build([False])
    assert not listener.listening_for_follow_up


def test_arming_does_not_open_the_window_immediately():
    """Relay's voice is still coming off the walls when it stops speaking.

    Opening straight away means the first thing the window catches is Relay
    itself, which is exactly what happened live:

        follow-up speech detected (no wake word)
        heard "It's five thirty seven PM"     <- Relay's own answer
    """
    listener = build([False], follow_up_seconds=5)
    listener.open_follow_up()
    assert listener.follow_up_pending
    assert not listener.listening_for_follow_up


async def test_window_opens_once_the_room_goes_quiet():
    listener = build([False] * 10, follow_up_seconds=30, follow_up_quiet_frames=3)
    listener.open_follow_up()
    _ = [u async for u in listener.utterances()]
    assert listener.listening_for_follow_up
    assert not listener.follow_up_pending


async def test_continuing_sound_keeps_the_window_shut():
    """Speaker bleed and reverb count as sound; the window must wait."""
    listener = build([True] * 12, follow_up_seconds=30, follow_up_quiet_frames=3)
    listener.open_follow_up()
    _ = [u async for u in listener.utterances()]
    assert not listener.listening_for_follow_up
    assert listener.follow_up_pending, "should still be waiting for quiet"


def test_window_expires_on_its_own():
    listener = build([False], follow_up_seconds=0.05)
    listener.open_follow_up()
    time.sleep(0.08)
    assert not listener.listening_for_follow_up


def test_zero_seconds_disables_the_feature():
    listener = build([False], follow_up_seconds=0)
    listener.open_follow_up()
    assert not listener.listening_for_follow_up


# ------------------------------------------------------------- triggering
async def test_speech_in_the_window_becomes_an_utterance_without_a_wake_word():
    # quiet first (arms the window), then speech, then silence to end it
    listener = build([False] * 8 + [True] * 8 + [False] * 8,
                     follow_up_seconds=30, follow_up_quiet_frames=3)
    listener.open_follow_up()

    found = [u async for u in listener.utterances()]

    assert len(found) == 1
    assert found[0].follow_up is True
    assert listener.follow_ups == 1


async def test_nothing_happens_without_an_open_window():
    """The same audio, but no window: the wake word is required."""
    listener = build([True] * 8 + [False] * 8, follow_up_seconds=30)
    # deliberately not opening it
    assert [u async for u in listener.utterances()] == []


async def test_a_brief_noise_does_not_trigger_a_follow_up():
    """A cough or a door is one or two frames; a sentence is not."""
    listener = build([False] * 8 + [True, False] * 6, follow_up_seconds=30,
                     follow_up_min_speech_frames=3, follow_up_quiet_frames=3)
    listener.open_follow_up()

    assert [u async for u in listener.utterances()] == []


async def test_sustained_speech_clears_the_minimum():
    listener = build([False] * 8 + [True] * 6 + [False] * 8, follow_up_seconds=30,
                     follow_up_min_speech_frames=3, follow_up_quiet_frames=3)
    listener.open_follow_up()
    assert len([u async for u in listener.utterances()]) == 1


async def test_window_closes_once_used():
    """One follow-up per window; the loop re-arms it after answering."""
    listener = build([False] * 8 + [True] * 8 + [False] * 8,
                     follow_up_seconds=30, follow_up_quiet_frames=3)
    listener.open_follow_up()
    _ = [u async for u in listener.utterances()]
    assert not listener.listening_for_follow_up


async def test_silence_through_the_window_yields_nothing():
    listener = build([False] * 20, follow_up_seconds=30)
    listener.open_follow_up()
    assert [u async for u in listener.utterances()] == []


async def test_paused_listener_ignores_the_window():
    """Relay must not follow up on its own voice while speaking."""
    listener = build([True] * 10, follow_up_seconds=30)
    listener.open_follow_up()
    listener.pause()
    assert [u async for u in listener.utterances()] == []


def test_stats_report_the_window():
    listener = build([False], follow_up_seconds=6)
    listener.open_follow_up()
    stats = listener.stats()
    assert stats["follow_up_pending"] is True
    assert stats["follow_up_open"] is False
    assert stats["follow_up_seconds"] == 6


# ------------------------------------------------- hearing itself
class RecordingMic(ScriptedMic):
    def __init__(self, script):
        super().__init__(script)
        self.drained = 0

    def drain(self):
        self.drained += 1
        return 0


def test_resuming_drops_audio_buffered_while_speaking():
    """Regression: Relay transcribed its own answer as a follow-up.

    Pausing stops scoring but not capture, so the look-back buffer fills with
    Relay's own speech while it talks. Observed live:

        follow-up speech detected (no wake word)
        heard "It's five thirty six PM"      <- Relay's own reply
    """
    listener = Listener(RecordingMic([False]), NeverFires(), LoudnessVad())
    listener.pause()
    listener.resume()
    assert listener.microphone.drained == 1


async def test_follow_up_uses_a_short_look_back():
    """The long look-back is for the wake word, which is confirmed ~1s late.

    A follow-up is detected within a few frames, so reaching back as far picks
    up Relay's own reply still in the buffer. Observed live:

        room quiet; listening for a follow-up for 6s
        follow-up speech detected (no wake word)
        heard "It's five forty PM"          <- Relay's own answer
    """
    captured = {}

    listener = build([False] * 8 + [True] * 8 + [False] * 8,
                     follow_up_seconds=30, follow_up_quiet_frames=3,
                     follow_up_min_speech_frames=3)
    listener.lead_in_frames = 15          # the long, wake-word look-back
    original = listener._record

    async def spy(word, confidence, *, lead_in_frames=None):
        captured["lead_in"] = lead_in_frames
        return await original(word, confidence, lead_in_frames=lead_in_frames)

    listener._record = spy
    listener.open_follow_up()
    _ = [u async for u in listener.utterances()]

    assert captured["lead_in"] == 3, "follow-up should use the short look-back"
    assert captured["lead_in"] < listener.lead_in_frames

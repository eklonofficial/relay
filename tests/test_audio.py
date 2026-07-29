"""Audio pipeline logic.

The wake word itself needs a human voice, so these cover the parts that can
be driven deterministically: resampling, endpointing, and device selection.
"""

import numpy as np
import pytest

from relay.audio.capture import FRAME_SAMPLES, SAMPLE_RATE, Microphone, rms
from relay.audio.listener import Listener, Utterance, VoiceActivity, WakeWordDetector


# ------------------------------------------------------------- resampling
def test_native_rate_audio_passes_through_untouched():
    mic = Microphone()
    mic._capture_rate = SAMPLE_RATE
    frame = np.arange(FRAME_SAMPLES, dtype=np.int16)
    assert mic._to_16k(frame) is frame


def test_48k_frames_are_resampled_to_the_model_frame_size():
    """PipeWire nodes usually only offer 48 kHz; the models need exactly 1280."""
    mic = Microphone()
    mic._capture_rate = 48_000
    frame = np.zeros(FRAME_SAMPLES * 3, dtype=np.int16)
    out = mic._to_16k(frame)
    assert out.shape == (FRAME_SAMPLES,)
    assert out.dtype == np.int16


def test_resampling_preserves_a_tone_rather_than_producing_noise():
    """A 440 Hz tone at 48k should still be a 440 Hz tone at 16k."""
    mic = Microphone()
    mic._capture_rate = 48_000
    t = np.arange(FRAME_SAMPLES * 3) / 48_000
    tone = (np.sin(2 * np.pi * 440 * t) * 8000).astype(np.int16)

    out = mic._to_16k(tone)

    # Dominant frequency should land near 440 Hz.
    spectrum = np.abs(np.fft.rfft(out.astype(np.float32)))
    peak_hz = np.fft.rfftfreq(len(out), 1 / SAMPLE_RATE)[np.argmax(spectrum)]
    assert 380 < peak_hz < 500, f"expected ~440 Hz, got {peak_hz:.0f} Hz"


def test_short_frames_are_padded_not_truncated():
    mic = Microphone()
    mic._capture_rate = 48_000
    assert mic._to_16k(np.zeros(100, dtype=np.int16)).shape == (FRAME_SAMPLES,)


# ------------------------------------------------------------------ rms
def test_rms_of_silence_is_zero():
    assert rms(np.zeros(1000, dtype=np.int16)) == 0.0


def test_rms_of_empty_frame_does_not_divide_by_zero():
    assert rms(np.zeros(0, dtype=np.int16)) == 0.0


# ----------------------------------------------------------- utterances
def test_too_short_utterance_is_treated_as_a_false_trigger():
    loud = (np.ones(1000) * 5000).astype(np.int16)
    utterance = Utterance(audio=loud, wake_word="relay", confidence=0.9, duration_s=0.1)
    assert utterance.is_probably_empty


def test_silent_utterance_is_treated_as_a_false_trigger():
    """The wake word fired but nobody actually said anything."""
    utterance = Utterance(
        audio=np.zeros(SAMPLE_RATE, dtype=np.int16),
        wake_word="relay", confidence=0.9, duration_s=1.0,
    )
    assert utterance.is_probably_empty


def test_real_speech_length_utterance_is_kept():
    speech = (np.random.default_rng(0).normal(0, 2000, SAMPLE_RATE)).astype(np.int16)
    utterance = Utterance(audio=speech, wake_word="relay", confidence=0.9, duration_s=1.0)
    assert not utterance.is_probably_empty


# ----------------------------------------------------------- endpointing
class ScriptedMic:
    """A microphone that plays a fixed sequence of frames."""

    def __init__(self, script: list[bool]):
        # True = speech-like frame, False = silence
        self.script = script

    async def frames(self):
        for is_speech in self.script:
            level = 6000 if is_speech else 0
            yield (np.ones(FRAME_SAMPLES) * level).astype(np.int16)

    def preroll(self):
        return np.zeros(0, dtype=np.int16)


class LoudnessVad(VoiceActivity):
    """VAD stand-in driven purely by level, so tests are deterministic."""

    def __init__(self):
        super().__init__()
        self._vad = None

    def is_speech(self, frame):
        return rms(frame) > 100

    def reset(self):
        pass


async def _record(script: list[bool], silence_ms: int = 240) -> Utterance:
    listener = Listener(
        ScriptedMic(script), WakeWordDetector(), LoudnessVad(),
        silence_ms=silence_ms, max_utterance_s=30, lead_in_ms=0,
    )
    return await listener._record("relay", 0.9)


async def test_recording_stops_after_a_pause_in_speech():
    # 10 frames of speech, then silence past the threshold.
    utterance = await _record([True] * 10 + [False] * 10)
    # 240ms of silence is 3 frames, so it should stop well before the end.
    assert utterance.duration_s < (20 * 80) / 1000


async def test_recording_does_not_stop_during_a_natural_pause():
    """A brief gap mid-sentence must not end the utterance early."""
    script = [True] * 5 + [False] * 2 + [True] * 5 + [False] * 10
    utterance = await _record(script, silence_ms=240)
    # Should have captured through the gap and both speech runs.
    assert utterance.duration_s > (10 * 80) / 1000


async def test_wake_word_with_no_speech_gives_up():
    """If nothing follows the wake word, stop rather than record forever."""
    utterance = await _record([False] * 60)
    assert utterance.is_probably_empty


async def test_recording_respects_the_length_limit():
    listener = Listener(
        ScriptedMic([True] * 1000), WakeWordDetector(), LoudnessVad(),
        silence_ms=240, max_utterance_s=1.0, lead_in_ms=0,
    )
    utterance = await listener._record("relay", 0.9)
    assert utterance.duration_s <= 1.2


# -------------------------------------------------------------- pausing
async def test_paused_listener_ignores_audio():
    """Used while Relay is speaking, so it doesn't hear itself."""
    listener = Listener(ScriptedMic([True] * 5), WakeWordDetector(), LoudnessVad())
    listener.pause()
    found = [u async for u in listener.utterances()]
    assert found == []


# ------------------------------------------------------- device selection
def test_pipewire_node_is_preferred_over_raw_alsa(monkeypatch):
    """Opening hw:N,0 can take the card exclusively, which is wrong for a
    daemon that runs all day."""
    from relay.audio import listener as listener_mod

    monkeypatch.setattr(listener_mod, "list_input_devices", lambda: [
        {"index": 6, "name": "fifine Microphone: USB Audio (hw:2,0)", "channels": 2,
         "sample_rate": 44100},
        {"index": 18, "name": "fifine Microphone Analog Stereo", "channels": 4,
         "sample_rate": 48000},
    ], raising=False)
    monkeypatch.setattr("relay.audio.capture.list_input_devices", lambda: [
        {"index": 6, "name": "fifine Microphone: USB Audio (hw:2,0)", "channels": 2,
         "sample_rate": 44100},
        {"index": 18, "name": "fifine Microphone Analog Stereo", "channels": 4,
         "sample_rate": 48000},
    ])

    resolved = listener_mod._device_index(
        "alsa_input.usb-3142_fifine_Microphone-00.analog-stereo"
    )
    assert resolved == 18


def test_unknown_device_falls_back_to_default():
    from relay.audio.listener import _device_index

    assert _device_index(None) is None
    assert _device_index("") is None


async def test_drain_discards_audio_buffered_while_paused():
    """Regression: Relay transcribed its own reply back as a command.

    The frame queue holds several seconds. It keeps filling while the listener
    is paused -- which is exactly while Relay is speaking -- so the next
    recording read that backlog instead of live audio:

        room quiet; listening for a follow-up for 6s
        follow-up speech detected (no wake word)
        heard "It's five forty two PM"      <- Relay's own answer
    """
    import numpy as np

    mic = Microphone()
    for _ in range(20):
        mic._async_queue.put_nowait(np.zeros(FRAME_SAMPLES, dtype=np.int16))
    mic._preroll.append(np.zeros(FRAME_SAMPLES, dtype=np.int16))

    dropped = mic.drain()

    assert dropped == 20
    assert mic._async_queue.empty()
    assert mic.preroll().size == 0

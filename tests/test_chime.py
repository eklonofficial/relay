"""The listening chime.

The chime plays *while the microphone is recording* -- openWakeWord confirms
the wake word about a second after it was spoken, so by the time this sounds
you are often already talking. That makes two properties load-bearing: it must
be short, and it must be quiet. Neither is decoration.
"""

import asyncio

import numpy as np
import pytest

from relay.audio import chime as chime_mod
from relay.audio.capture import FRAME_SAMPLES
from relay.audio.chime import Chime, build
from relay.audio.listener import Listener, VoiceActivity, WakeWordDetector


@pytest.fixture(autouse=True)
def _clear_cache():
    chime_mod._cache.clear()
    yield
    chime_mod._cache.clear()


# ------------------------------------------------------------------ shape
def test_the_chime_is_short_enough_not_to_swallow_a_word():
    audio = build(0.10)
    seconds = len(audio) / chime_mod.SAMPLE_RATE
    assert seconds <= 0.4, f"{seconds:.2f}s would cover a whole syllable"


def test_the_chime_is_quiet():
    assert float(np.abs(build(0.10)).max()) == pytest.approx(0.10, abs=0.001)


def test_volume_is_honoured():
    assert float(np.abs(build(0.04)).max()) == pytest.approx(0.04, abs=0.001)


def test_volume_cannot_be_pushed_past_full_scale():
    """Clipping in the output would be broadband noise straight into the
    microphone -- far worse for transcription than the tone itself."""
    assert float(np.abs(build(9.0)).max()) <= 1.0


def test_zero_volume_produces_no_audio():
    assert build(0.0).size == 0


def test_negative_volume_is_treated_as_silence():
    assert build(-1.0).size == 0


# --------------------------------------------------------------- no clicks
def test_it_starts_and_ends_at_silence():
    """A hard edge clicks, and a click is broadband -- the one thing
    guaranteed to smear across the whole speech band."""
    audio = build(0.10)
    assert abs(float(audio[0])) < 1e-6
    assert abs(float(audio[-1])) < 1e-6


def test_it_swells_rather_than_switching_on():
    """A flat-topped envelope is most of what makes a sound read as a beep.
    The first attempt at this chime did exactly that and was rejected."""
    audio = np.abs(build(0.10))
    sample_rate = chime_mod.SAMPLE_RATE
    early = float(audio[: int(0.004 * sample_rate)].max())
    peak = float(audio.max())
    assert early < peak * 0.5, "the attack is too abrupt"


def test_it_decays_rather_than_being_cut_off():
    audio = np.abs(build(0.10))
    tail = float(audio[-int(len(audio) * 0.1):].max())
    assert tail < float(audio.max()) * 0.2


# ------------------------------------------------------------------ pitch
def test_the_pitch_rises():
    """An upward glide reads as a question. A falling one reads as an error,
    and a flat one reads as a beep."""
    audio = build(0.10)
    sample_rate = chime_mod.SAMPLE_RATE
    half = len(audio) // 2

    def dominant(segment):
        spectrum = np.abs(np.fft.rfft(segment * np.hanning(len(segment))))
        return np.fft.rfftfreq(len(segment), 1 / sample_rate)[np.argmax(spectrum)]

    assert dominant(audio[:half]) < dominant(audio[half:])


def test_the_chime_stays_in_its_intended_register():
    """Chosen by ear. Drifting upward over time would quietly undo that --
    the first version was an octave and a half higher and sounded harsh."""
    audio = build(0.10)
    spectrum = np.abs(np.fft.rfft(audio))
    freqs = np.fft.rfftfreq(len(audio), 1 / chime_mod.SAMPLE_RATE)
    dominant = freqs[np.argmax(spectrum)]
    assert 500 <= dominant <= 950, f"dominant tone drifted to {dominant:.0f} Hz"


def test_most_energy_is_not_in_the_top_octaves():
    """Brightness above the fundamental was half of what made the first
    attempt harsh."""
    audio = build(0.10)
    spectrum = np.abs(np.fft.rfft(audio))
    freqs = np.fft.rfftfreq(len(audio), 1 / chime_mod.SAMPLE_RATE)
    bright = spectrum[freqs > 2000].sum() / spectrum.sum()
    assert bright < 0.15, f"{bright:.0%} of the energy is above 2 kHz"


# ------------------------------------------------------------------ cache
def test_the_waveform_is_only_built_once():
    first = build(0.10)
    assert build(0.10) is first


def test_a_different_volume_gets_its_own_waveform():
    assert build(0.10) is not build(0.05)


def test_it_can_be_rendered_at_the_microphone_rate():
    """Used when testing the effect on transcription."""
    audio = build(0.10, 16_000)
    assert 0.25 < len(audio) / 16_000 < 0.35


# ----------------------------------------------------------------- playing
async def test_playing_does_not_block_the_caller():
    """It fires while the recorder is running; holding up that loop would
    cost the start of the command."""
    played = []
    chime = Chime(volume=0.1)

    def slow(audio, sample_rate):
        import time

        time.sleep(0.4)
        played.append(len(audio))

    chime_mod._play_blocking = slow
    started = asyncio.get_running_loop().time()
    chime.play()
    elapsed = asyncio.get_running_loop().time() - started

    assert elapsed < 0.1, "play() blocked"
    await asyncio.sleep(0.6)
    assert played, "it should still have played, just off the hot path"


async def test_a_broken_output_device_costs_the_sound_not_the_command():
    def explode(audio, sample_rate):
        raise OSError("no such device")

    chime_mod._play_blocking = explode
    Chime(volume=0.1).play()          # must not raise
    await asyncio.sleep(0.05)


async def test_a_disabled_chime_plays_nothing():
    played = []
    chime_mod._play_blocking = lambda audio, sr: played.append(1)
    chime = Chime(volume=0.1, enabled=False)
    chime.play()
    await asyncio.sleep(0.05)
    assert played == [] and chime.played == 0


async def test_zero_volume_plays_nothing():
    played = []
    chime_mod._play_blocking = lambda audio, sr: played.append(1)
    Chime(volume=0.0).play()
    await asyncio.sleep(0.05)
    assert played == []


def test_playing_outside_an_event_loop_is_not_an_error():
    Chime(volume=0.1).play()


# ----------------------------------------------------------- listener wiring
class ScriptedMic:
    def __init__(self, frames=30):
        self.frames_to_yield = frames
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

    def drain(self):
        return 0


class LoudnessVad(VoiceActivity):
    def __init__(self):
        super().__init__()
        self._vad = None

    def is_speech(self, frame):
        return float(np.abs(frame.astype(np.float32)).mean()) > 100

    def reset(self):
        pass


async def test_push_to_talk_sounds_the_chime_too():
    """Pressing the key is the same "I'm listening now" moment as the wake
    word, and gets the same confirmation."""
    rung = []
    listener = Listener(
        ScriptedMic(), WakeWordDetector(), LoudnessVad(),
        silence_ms=240, max_utterance_s=5, lead_in_ms=0,
        on_wake=lambda: rung.append(1),
    )
    listener.trigger()
    [u async for u in listener.utterances()]
    assert rung, "push-to-talk should confirm it heard you"


async def test_a_failing_chime_does_not_stop_the_recording():
    def explode():
        raise RuntimeError("no audio device")

    listener = Listener(
        ScriptedMic(), WakeWordDetector(), LoudnessVad(),
        silence_ms=240, max_utterance_s=5, lead_in_ms=0,
        on_wake=explode,
    )
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert found, "the command must survive a broken speaker"


async def test_a_listener_with_no_chime_still_works():
    listener = Listener(
        ScriptedMic(), WakeWordDetector(), LoudnessVad(),
        silence_ms=240, max_utterance_s=5, lead_in_ms=0,
    )
    listener.trigger()
    assert [u async for u in listener.utterances()]

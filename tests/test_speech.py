"""STT/TTS engine logic.

Model-loading tests are marked and skipped when the weights aren't present,
so the suite stays fast and works on a machine without a GPU.
"""

import numpy as np
import pytest

from relay.paths import PATHS
from relay.stt.engine import Transcript, _resample, _to_float32
from relay.tts.engine import CHATTERBOX, KOKORO, KokoroTTS, Speech, VoiceRouter


# ------------------------------------------------------------ conversions
def test_int16_capture_is_normalised_for_the_model():
    """Capture is int16; Parakeet wants float32 in [-1, 1]."""
    audio = np.array([-32768, 0, 32767], dtype=np.int16)
    out = _to_float32(audio)
    assert out.dtype == np.float32
    assert -1.01 <= out.min() and out.max() <= 1.01


def test_float32_audio_passes_through():
    audio = np.array([0.5, -0.5], dtype=np.float32)
    assert _to_float32(audio) is audio


def test_resample_changes_length_proportionally():
    audio = np.zeros(24_000, dtype=np.float32)
    out = _resample(audio, 24_000, 16_000)
    assert 15_500 < len(out) < 16_500


def test_resample_is_a_noop_at_matching_rates():
    audio = np.zeros(100, dtype=np.float32)
    assert _resample(audio, 16_000, 16_000) is audio


# -------------------------------------------------------------- transcript
def test_transcript_reports_real_time_factor():
    t = Transcript(text="hello", duration_s=2.0, latency_s=0.5, placement="cpu")
    assert t.real_time_factor == 0.25
    assert not t.is_empty


def test_empty_transcript_is_detected():
    assert Transcript(text="   ", duration_s=1.0, latency_s=0.1, placement="cpu").is_empty


def test_zero_duration_does_not_divide_by_zero():
    assert Transcript(text="x", duration_s=0.0, latency_s=0.1, placement="cpu").real_time_factor == 0.0


# ------------------------------------------------------------------ speech
def test_speech_duration_and_rtf():
    s = Speech(audio=np.zeros(24_000, dtype=np.float32), sample_rate=24_000,
               latency_s=0.5, engine=KOKORO)
    assert s.duration_s == 1.0
    assert s.real_time_factor == 0.5


# ------------------------------------------------------------------ router
class FakeTTS:
    def __init__(self, name, fail=False):
        self.name = name
        self.fail = fail
        self.calls = 0
        self.unloaded = False

    async def synthesise(self, text):
        self.calls += 1
        if self.fail:
            raise RuntimeError("CUDA out of memory")
        return Speech(audio=np.zeros(100, dtype=np.float32), sample_rate=24_000,
                      latency_s=0.1, engine=self.name)

    async def unload(self):
        self.unloaded = True


async def test_router_uses_kokoro_by_default():
    router = VoiceRouter(FakeTTS(KOKORO), FakeTTS(CHATTERBOX))
    assert (await router.synthesise("hi")).engine == KOKORO


async def test_router_uses_chatterbox_when_preferred():
    router = VoiceRouter(FakeTTS(KOKORO), FakeTTS(CHATTERBOX))
    router.prefer(CHATTERBOX)
    assert (await router.synthesise("hi")).engine == CHATTERBOX


async def test_losing_the_gpu_mid_sentence_changes_the_voice_not_the_answer():
    """A CUDA OOM should degrade to CPU, not silence the assistant."""
    kokoro, chatterbox = FakeTTS(KOKORO), FakeTTS(CHATTERBOX, fail=True)
    router = VoiceRouter(kokoro, chatterbox)
    router.prefer(CHATTERBOX)

    speech = await router.synthesise("hi")

    assert speech.engine == KOKORO
    assert kokoro.calls == 1
    # And it stays on CPU rather than retrying the broken engine every turn.
    await router.synthesise("again")
    assert chatterbox.calls == 1


async def test_kokoro_failure_propagates_because_there_is_no_lower_tier():
    router = VoiceRouter(FakeTTS(KOKORO, fail=True))
    with pytest.raises(RuntimeError):
        await router.synthesise("hi")


async def test_unload_gpu_frees_chatterbox_and_switches_voice():
    kokoro, chatterbox = FakeTTS(KOKORO), FakeTTS(CHATTERBOX)
    router = VoiceRouter(kokoro, chatterbox)
    router.prefer(CHATTERBOX)

    await router.unload_gpu()

    assert chatterbox.unloaded
    assert router.active.name == KOKORO


async def test_router_without_chatterbox_never_selects_it():
    """A machine with no GPU should still work."""
    router = VoiceRouter(FakeTTS(KOKORO), None)
    router.prefer(CHATTERBOX)
    assert (await router.synthesise("hi")).engine == KOKORO


# ------------------------------------------------------------ model files
def test_missing_kokoro_files_are_reported_clearly(tmp_path):
    kokoro = KokoroTTS(tmp_path)
    missing = kokoro.missing_files()
    assert "kokoro-v1.0.onnx" in missing
    assert "voices-v1.0.bin" in missing


async def test_loading_kokoro_without_weights_explains_where_to_get_them(tmp_path):
    kokoro = KokoroTTS(tmp_path)
    with pytest.raises(FileNotFoundError, match="github.com"):
        await kokoro.load()


@pytest.mark.skipif(
    not (PATHS.models / "kokoro-v1.0.onnx").exists(), reason="kokoro weights not downloaded"
)
def test_installed_kokoro_reports_no_missing_files():
    assert KokoroTTS(PATHS.models).missing_files() == []


# --------------------------------------------------- quiet speech reaches STT
def test_quiet_audio_is_lifted_before_transcription():
    """The failure that looks like deafness: the wake word fires, six seconds
    are recorded, and the transcript comes back empty.

    Echo cancellation makes it likelier -- its high-pass strips the rumble
    carrying most of the level, leaving the speech bands untouched but the
    waveform about 10 dB smaller than the model expects.
    """
    import numpy as np

    from relay.stt.engine import _normalise

    quiet = (np.sin(np.linspace(0, 400, 16000)) * 0.02).astype(np.float32)
    lifted, gain = _normalise(quiet)

    assert gain > 1.0
    assert float(np.abs(lifted).max()) > float(np.abs(quiet).max())


def test_loud_audio_is_left_alone():
    """Only ever lifts. Flattening everything to one level would also flatten
    the difference between speech and a room."""
    import numpy as np

    from relay.stt.engine import _normalise

    loud = (np.sin(np.linspace(0, 400, 16000)) * 0.9).astype(np.float32)
    out, gain = _normalise(loud)

    assert gain == 1.0
    assert np.array_equal(out, loud)


def test_near_silence_is_not_amplified_into_words():
    """A recording of nothing must not be blown up until the model feels
    obliged to find speech in it."""
    import numpy as np

    from relay.stt.engine import _normalise

    hiss = (np.random.default_rng(3).normal(0, 0.0005, 16000)).astype(np.float32)
    _out, gain = _normalise(hiss)

    assert gain == 1.0


def test_the_lift_is_capped():
    import numpy as np

    from relay.stt.engine import MAX_GAIN, _normalise

    faint = (np.sin(np.linspace(0, 400, 16000)) * 0.006).astype(np.float32)
    _out, gain = _normalise(faint)

    assert gain <= MAX_GAIN

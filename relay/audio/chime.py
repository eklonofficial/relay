"""The "I'm listening" sound.

A short, warm synth swell that glides upward, so it reads as a question rather
than an alarm. Andrew picked it by ear from a set of candidates; the first
attempt was a pair of high sines with a symmetric envelope and sounded, quite
correctly, like a hard beep.

What makes it soft rather than beepy:

  * an upward pitch glide that eases out, instead of a fixed tone
  * a 28 ms attack, so it swells in rather than switching on -- a flat-topped
    envelope is most of what makes a sound read as a "beep"
  * a long exponential tail, like something struck rather than gated
  * two slightly detuned oscillators, whose slow beating is what separates a
    warm synth from a sterile test tone
  * harmonics that roll off steeply; the brightness above the fundamental was
    the other half of the harshness

**The trade-off worth knowing.** openWakeWord doesn't confirm the wake word
until it has a full 16-frame window -- roughly a second *after* you say it,
which is why the recorder reaches 1200 ms into the past. So the chime plays
while the microphone is live and often while you are already speaking, and it
lands inside the recorded audio.

At 587-880 Hz this sits in the speech band, overlapping the formants that
carry intelligibility. That is a deliberate choice: a higher chime is safer
for transcription but sounded harsh, and measured against real recordings of
Andrew's voice at normal levels the transcript was unchanged. It is kept
short and quiet to hold that margin. If Relay ever starts mishearing commands
it did not used to, this is the first thing to turn down.

Synthesised rather than shipped as a file: it is a few lines of arithmetic, it
retunes from config without hunting for an asset, and there is no sample rate
to resample.
"""

from __future__ import annotations

import asyncio
import logging

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 48_000

# D5 -> A5. Low enough to stay warm, high enough to carry over a room.
START_HZ = 587.0
END_HZ = 880.0
DURATION_S = 0.30
ATTACK_S = 0.028
# Quiet partials above the fundamental. Steep rolloff: this is where the
# earlier version got its glassy edge.
HARMONICS = ((2, 0.22), (3, 0.06))
# Fraction of a semitone, near enough. Enough beating to feel alive, not
# enough to sound out of tune.
DETUNE = 1.003

_cache: dict[tuple, np.ndarray] = {}


def build(volume: float = 0.10, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """The chime, as float32 in [-1, 1]. Cached: it never changes."""
    key = (round(volume, 4), sample_rate)
    if key in _cache:
        return _cache[key]

    volume = max(0.0, min(1.0, volume))
    samples = int(sample_rate * DURATION_S)
    if samples <= 0 or volume == 0.0:
        return np.zeros(0, dtype=np.float32)

    t = np.arange(samples, dtype=np.float32) / sample_rate
    span = t[-1] or 1.0

    # Ease-out sweep: most of the movement happens early, so the tail settles
    # instead of climbing away.
    progress = t / span
    frequency = START_HZ + (END_HZ - START_HZ) * (1 - (1 - progress) ** 2)

    # Integrate the sweep to get phase. Using freq*t directly would make the
    # pitch wrong everywhere except the first sample, and click on the way.
    phase = 2 * np.pi * np.cumsum(frequency) / sample_rate
    detuned = 2 * np.pi * np.cumsum(frequency * DETUNE) / sample_rate

    out = (np.sin(phase) + np.sin(detuned)) * 0.5
    for multiple, weight in HARMONICS:
        out += weight * np.sin(multiple * phase)

    out *= _envelope(samples, sample_rate)

    peak = float(np.abs(out).max() or 1.0)
    _cache[key] = ((out / peak) * volume).astype(np.float32)
    return _cache[key]


def _envelope(samples: int, sample_rate: int) -> np.ndarray:
    """Soft swell, long decay. Zero at both ends, so it can't click."""
    attack = max(1, min(samples - 1, int(ATTACK_S * sample_rate)))
    envelope = np.ones(samples, dtype=np.float32)
    envelope[:attack] = np.sin(np.linspace(0, np.pi / 2, attack)) ** 2
    envelope[attack:] = np.exp(-np.linspace(0, 4.2, samples - attack))
    # Force the last sample to zero: exp() never quite reaches it.
    envelope[-1] = 0.0
    return envelope


def _play_blocking(audio: np.ndarray, sample_rate: int) -> None:
    import sounddevice as sd

    # Deliberately no sd.wait(): the caller must not be held up, because the
    # microphone is already recording the command by the time this plays.
    sd.play(audio, samplerate=sample_rate, blocking=False)


class Chime:
    """Plays the listening sound without blocking the loop that triggered it."""

    def __init__(self, *, volume: float = 0.10, enabled: bool = True,
                 sample_rate: int = SAMPLE_RATE) -> None:
        self.volume = volume
        self.enabled = enabled
        self.sample_rate = sample_rate
        self.played = 0

    @property
    def audio(self) -> np.ndarray:
        return build(self.volume, self.sample_rate)

    def play(self) -> None:
        """Fire and forget. Safe to call from the audio loop.

        Never awaited and never raised from: a missing output device should
        cost you the sound, not the command you just spoke.
        """
        if not self.enabled or self.volume <= 0:
            return
        audio = self.audio
        if audio.size == 0:
            return
        self.played += 1
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        loop.run_in_executor(None, _play_blocking, audio, self.sample_rate)

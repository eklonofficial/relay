"""Keeping the utterances Relay failed to understand.

"Sometimes I ask it something and it just goes away" is impossible to debug
from a log line saying the transcript was empty. The question is always
whether the microphone heard nothing, heard the room, or heard the words
perfectly and the model failed on them -- and those look identical from
outside, while sounding nothing alike.

So when a recording transcribes to nothing, it is written to disk. A few
seconds of audio answers in one listen what a week of guessing does not.

Kept deliberately small: the most recent handful, in the state directory,
overwritten in a ring. This is a diagnostic, not a recording of someone's
home, and it should never quietly become one.
"""

from __future__ import annotations

import contextlib
import logging
import wave
from pathlib import Path

import numpy as np

from relay.audio.capture import SAMPLE_RATE
from relay.paths import PATHS

log = logging.getLogger(__name__)

KEEP = 5
DIRNAME = "missed"


def directory() -> Path:
    return PATHS.state / DIRNAME


def keep_missed(audio: np.ndarray, *, sample_rate: int = SAMPLE_RATE) -> Path | None:
    """Save an unintelligible utterance, and drop the oldest beyond KEEP."""
    if audio is None or getattr(audio, "size", 0) == 0:
        return None
    try:
        folder = directory()
        folder.mkdir(parents=True, exist_ok=True)

        # A ring rather than a growing pile: five is enough to spot a pattern
        # and few enough that nobody discovers a month of their kitchen here.
        existing = sorted(folder.glob("missed-*.wav"))
        for stale in existing[: max(0, len(existing) - (KEEP - 1))]:
            with contextlib.suppress(OSError):
                stale.unlink()

        import time

        path = folder / f"missed-{time.strftime('%Y%m%d-%H%M%S')}.wav"
        samples = np.asarray(audio)
        if samples.dtype != np.int16:
            peak = float(np.abs(samples).max() or 1.0)
            samples = (samples / peak * 32767).astype(np.int16)
        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(sample_rate)
            handle.writeframes(samples.tobytes())

        log.info("kept the unintelligible audio at %s "
                 "(peak %d, %.1fs) -- play it to hear what Relay heard",
                 path, int(np.abs(samples).max()), len(samples) / sample_rate)
        return path
    except Exception as exc:  # noqa: BLE001 - a diagnostic must not be a fault
        log.debug("could not keep the missed utterance: %s", exc)
        return None

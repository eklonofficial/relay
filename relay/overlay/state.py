"""What Relay is doing, expressed as something drawable.

The states are deliberately coarse. The orb is a glance, not a readout: it
says "I heard you", "go on", "working", "talking" and nothing more. Finer
detail would only make the animation twitch.

Every method here is safe to call when there is no bus, no renderer attached,
or no overlay configured at all -- `OverlayState(None)` is a working object
that does nothing. That keeps the call sites in the audio path free of
`if self.overlay is not None` noise, which is where such checks get forgotten.
"""

from __future__ import annotations

import logging
import time

import numpy as np

log = logging.getLogger(__name__)

WAKING = "waking"        # pulling out of the bezel
LISTENING = "listening"  # the user is talking
THINKING = "thinking"    # transcribing, or waiting on the model
SPEAKING = "speaking"    # Relay is talking
IDLE = "idle"            # retracted, nothing happening

STATES = (WAKING, LISTENING, THINKING, SPEAKING, IDLE)

# Speech is sent as one envelope per sentence rather than as a level stream:
# playback hands the whole buffer to the sound card at once, so the shape is
# known up front and the renderer can follow it on its own clock. 50 buckets
# over a two-second sentence is ~25Hz, finer than the eye resolves on a
# pulsing blob and one message instead of fifty.
ENVELOPE_BUCKETS = 50

# Mic RMS at which the orb is at full deflection. A silent room idles near 30
# and speech at a normal distance peaks in the low thousands; 2200 puts
# ordinary speech near the top of the range without clipping on a laugh.
FULL_SCALE_RMS = 2200.0


def normalise(level: float) -> float:
    """Map a raw int16 RMS onto 0..1 for the animation.

    Square-rooted rather than linear: loudness is perceptual, and a linear map
    leaves the orb nearly still through most of normal speech.
    """
    if level <= 0.0:
        return 0.0
    scaled = min(1.0, level / FULL_SCALE_RMS)
    return float(scaled ** 0.5)


def envelope(audio: np.ndarray, buckets: int = ENVELOPE_BUCKETS) -> list[float]:
    """The loudness shape of a clip, as `buckets` values in 0..1.

    Computed once when a sentence starts playing so the orb can pulse in time
    with the words instead of merely being on.
    """
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    if samples.size == 0:
        return []
    # Float audio is already -1..1; int16 needs bringing down to the same
    # scale so one code path serves both backends.
    if np.issubdtype(np.asarray(audio).dtype, np.integer):
        samples = samples / 32768.0
    usable = samples.size - (samples.size % buckets)
    if usable < buckets:
        return [float(np.abs(samples).max())]
    frames = samples[:usable].reshape(buckets, -1)
    loudness = np.sqrt((frames ** 2).mean(axis=1))
    peak = float(loudness.max())
    if peak <= 0.0:
        return [0.0] * buckets
    return [round(float(v / peak), 3) for v in loudness]


class OverlayState:
    """Turns Relay's internals into orb states.

    Holds no timers and no thread of its own: every transition is driven by
    something that already happened in the voice loop.
    """

    def __init__(self, bus=None, *, enabled: bool = True) -> None:
        self.bus = bus
        self.enabled = enabled and bus is not None
        self.current = IDLE
        # Levels are emitted per 80ms audio frame. Sending every one is 12.5
        # messages a second per client for a value that changes smoothly;
        # this drops the ones that say nothing new.
        self._last_level = -1.0
        self._last_level_at = 0.0

    # ------------------------------------------------------------ plumbing
    def _send(self, **payload) -> None:
        """Emit, and never let a drawing problem become a voice problem."""
        if not self.enabled:
            return
        try:
            self.bus.send(**payload)
        except Exception as exc:  # noqa: BLE001
            log.debug("overlay emit failed: %s", exc)

    def set(self, state: str) -> None:
        if state not in STATES:
            log.debug("ignoring unknown overlay state %r", state)
            return
        self.current = state
        self._send(state=state)

    # -------------------------------------------------------------- states
    def wake(self) -> None:
        """Wake word, push-to-talk or a follow-up: the orb comes out."""
        self.set(WAKING)

    def listening(self) -> None:
        self._last_level = -1.0
        self.set(LISTENING)

    def thinking(self) -> None:
        self.set(THINKING)

    def speaking(self, audio=None, sample_rate: int = 0) -> None:
        """Relay has started a sentence.

        The envelope goes with the state so the renderer can pulse along the
        actual words. A clip that can't be measured still sets the state --
        being visibly wrong about the rhythm beats going blank.
        """
        payload = {"state": SPEAKING}
        if audio is not None and sample_rate > 0:
            try:
                shape = envelope(audio)
                if shape:
                    payload["envelope"] = shape
                    payload["duration"] = round(len(audio) / sample_rate, 3)
            except Exception as exc:  # noqa: BLE001
                log.debug("could not measure the clip: %s", exc)
        self.current = SPEAKING
        self._send(**payload)

    def idle(self) -> None:
        self.set(IDLE)

    # -------------------------------------------------------------- levels
    def level(self, rms: float) -> None:
        """Report how loudly the user is speaking, for the ripple.

        Only meaningful while listening, and only sent when it has actually
        moved -- a resting-quiet room would otherwise emit the same number
        twelve times a second forever.
        """
        if not self.enabled or self.current != LISTENING:
            return
        value = normalise(rms)
        now = time.monotonic()
        if abs(value - self._last_level) < 0.02 and now - self._last_level_at < 0.25:
            return
        self._last_level = value
        self._last_level_at = now
        self._send(level=round(value, 3))

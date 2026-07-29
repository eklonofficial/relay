"""Wake word detection and utterance endpointing.

The loop: score every frame for the wake word; on a hit, keep recording until
the speaker stops, then hand the audio to transcription.

Both models are ONNX on the CPU and total about 6MB, which is what lets Relay
keep listening while the GPU is busy with a game — the whole point of the
LITE tier.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass

import numpy as np

from relay.audio.capture import FRAME_MS, FRAME_SAMPLES, SAMPLE_RATE, Microphone, rms

log = logging.getLogger(__name__)


@dataclass(slots=True)
class Utterance:
    audio: np.ndarray          # int16 mono @ 16kHz
    wake_word: str
    confidence: float
    duration_s: float
    follow_up: bool = False    # spoken during the window, without the wake word
    push_to_talk: bool = False  # started by the keybinding, not by voice

    @property
    def is_probably_empty(self) -> bool:
        """Wake word fired but nothing was actually said afterwards."""
        return self.duration_s < 0.35 or rms(self.audio) < 8.0


class WakeWordDetector:
    """openWakeWord on ONNX. Kept on the CPU so it survives GPU eviction."""

    def __init__(self, wake_word: str = "hey_jarvis", threshold: float = 0.6,
                 model_path: str | None = None) -> None:
        self.wake_word = wake_word
        self.threshold = threshold
        self.model_path = model_path
        self._model = None

    def load(self) -> None:
        from openwakeword.model import Model

        models = [self.model_path] if self.model_path else [self.wake_word]
        # tflite has no cp312 wheels, and we want CPU-only anyway.
        self._model = Model(wakeword_models=models, inference_framework="onnx")
        log.info("wake word ready: %s (threshold %.2f)",
                 ", ".join(self._model.models.keys()), self.threshold)

    def score(self, frame: np.ndarray) -> tuple[str | None, float]:
        """Score one frame. Returns (wake_word, confidence) on a hit."""
        if self._model is None:
            return None, 0.0
        predictions = self._model.predict(frame)
        best_name, best_score = None, 0.0
        for name, score in predictions.items():
            if score > best_score:
                best_name, best_score = name, float(score)
        if best_score >= self.threshold:
            return best_name, best_score
        return None, best_score

    def reset(self) -> None:
        """Clear internal state so one utterance can't retrigger the next."""
        if self._model is not None:
            self._model.reset()


class VoiceActivity:
    """Silero VAD, used to decide when the speaker has finished."""

    def __init__(self, threshold: float = 0.5) -> None:
        self.threshold = threshold
        self._vad = None

    def load(self) -> None:
        from openwakeword.vad import VAD

        self._vad = VAD()

    def is_speech(self, frame: np.ndarray) -> bool:
        if self._vad is None:
            # Without VAD, fall back to loudness. Crude, but it still ends
            # an utterance rather than recording forever.
            return rms(frame) > 12.0
        try:
            score = self._vad.predict(frame)
        except Exception:  # noqa: BLE001 - never let VAD kill the listener
            return rms(frame) > 12.0
        if isinstance(score, dict):
            score = max(score.values(), default=0.0)
        return float(score) >= self.threshold

    def reset(self) -> None:
        if self._vad is not None:
            self._vad.reset_states()


class Listener:
    """Wake word -> utterance, as an async stream."""

    def __init__(
        self,
        microphone: Microphone,
        detector: WakeWordDetector,
        vad: VoiceActivity,
        *,
        silence_ms: int = 700,
        max_utterance_s: float = 30.0,
        lead_in_ms: int = 1200,
        follow_up_seconds: float = 6.0,
        follow_up_min_speech_frames: int = 3,
        follow_up_quiet_frames: int = 13,
        on_wake: Callable[[], None] | None = None,
    ) -> None:
        self.microphone = microphone
        self.detector = detector
        self.vad = vad
        self.silence_frames = max(1, silence_ms // FRAME_MS)
        self.max_frames = int(max_utterance_s * 1000 // FRAME_MS)
        self.lead_in_frames = max(0, lead_in_ms // FRAME_MS)
        self._paused = False
        # Conversation mode: after Relay answers, keep listening briefly so
        # a follow-up needs no wake word. Alexa uses about five seconds and
        # ships it off by default because it misfires in noisy rooms, so
        # this requires sustained speech rather than any sound at all.
        self.follow_up_seconds = follow_up_seconds
        self.follow_up_min_speech_frames = follow_up_min_speech_frames
        # ~1s of continuous silence before the window arms. Shorter than
        # this and a natural pause between Relay's own words counts as
        # quiet, so it arms mid-sentence and hears its next syllable.
        self.follow_up_quiet_frames = follow_up_quiet_frames
        self.follow_up_until: float | None = None
        # Armed but not yet open: the window starts only once the room has
        # gone quiet. A fixed cooldown can't cover speaker bleed and room
        # reverb reliably, and Relay would transcribe its own answer back.
        self.follow_up_pending = False
        self.follow_ups = 0
        # Push-to-talk: a keybinding starts a turn without the wake word, and
        # works while Relay is speaking, which the wake word cannot.
        self._triggered = False
        self.push_to_talks = 0
        # Sounded the moment Relay starts recording, so you know it heard you.
        # It has to fire from in here rather than from the voice loop: by the
        # time an utterance is yielded, the recording is already over.
        self.on_wake = on_wake
        # Diagnostics, surfaced by `relay mic`. A silent microphone and a
        # stuck pause look identical from the outside otherwise.
        self.frames_seen = 0
        self.last_level = 0.0
        self.peak_level = 0.0
        self.last_score = 0.0
        self.peak_score = 0.0
        self.detections = 0
        self.paused_since: float | None = None

    def pause(self) -> None:
        """Ignore audio, e.g. while Relay itself is speaking without echo cancellation."""
        self._paused = True
        self.paused_since = time.time()

    def resume(self) -> None:
        self._paused = False
        self.paused_since = None
        self.detector.reset()
        self.vad.reset()
        # Pausing stops *scoring*, not capture: both the pre-roll buffer and
        # the frame queue have been filling with Relay's own speech. The
        # queue holds several seconds, so without dropping it the next
        # recording replays Relay's reply and transcribes it as the user's
        # next command.
        dropped = self.microphone.drain()
        if dropped:
            log.debug("dropped %d buffered frames captured while speaking", dropped)

    def _wake_signal(self) -> None:
        """Sound the listening chime, if there is one.

        Swallows everything: a broken output device must cost you the sound,
        not the command.
        """
        if self.on_wake is None:
            return
        try:
            self.on_wake()
        except Exception:  # noqa: BLE001
            log.debug("wake chime failed", exc_info=True)

    def trigger(self) -> None:
        """Start a turn now, as if the wake word had fired.

        This is the push-to-talk entry point. Unlike the wake word it works
        while the listener is paused -- that is the whole point, since paused
        is exactly the state Relay is in while speaking, and interrupting it
        is what the key is for.
        """
        self._triggered = True

    @property
    def triggered(self) -> bool:
        return self._triggered

    def open_follow_up(self) -> None:
        """Arm the window. It opens once the microphone hears silence.

        Relay's own voice is still coming back off the walls when it stops
        speaking, so opening immediately means the first thing the window
        catches is Relay itself.
        """
        if self.follow_up_seconds > 0:
            self.follow_up_pending = True
            self.follow_up_until = None

    def close_follow_up(self) -> None:
        self.follow_up_until = None
        self.follow_up_pending = False

    @property
    def listening_for_follow_up(self) -> bool:
        return self.follow_up_until is not None and time.time() < self.follow_up_until

    def stats(self) -> dict:
        return {
            "frames_seen": self.frames_seen,
            "paused": self._paused,
            "paused_for_s": round(time.time() - self.paused_since, 1)
            if self.paused_since else None,
            "last_level": round(self.last_level, 1),
            "peak_level": round(self.peak_level, 1),
            "last_score": round(self.last_score, 3),
            "peak_score": round(self.peak_score, 3),
            "detections": self.detections,
            "follow_ups": self.follow_ups,
            "push_to_talks": self.push_to_talks,
            "follow_up_open": self.listening_for_follow_up,
            "follow_up_pending": self.follow_up_pending,
            "follow_up_seconds": self.follow_up_seconds,
            "threshold": self.detector.threshold,
            "wake_word": self.detector.wake_word,
            "device": self.microphone.device,
            "capture_rate": self.microphone._capture_rate,
            "dropped_frames": self.microphone.dropped_frames,
            "frames_yielded": self.microphone.frames_yielded,
            "consumers": self.microphone.consumers,
        }

    def reset_stats(self) -> None:
        self.peak_level = 0.0
        self.peak_score = 0.0

    async def utterances(self) -> AsyncIterator[Utterance]:
        speech_run = 0
        quiet_run = 0
        async for frame in self.microphone.frames():
            self.frames_seen += 1
            self.last_level = rms(frame)
            self.peak_level = max(self.peak_level, self.last_level)

            # Checked before the pause, so the key works mid-sentence.
            if self._triggered:
                self._triggered = False
                self._paused = False
                self.paused_since = None
                self.close_follow_up()
                self.push_to_talks += 1
                # Everything buffered so far is either Relay's own voice or
                # the silence before the key was pressed. Dropping it is the
                # same fix that stopped Relay transcribing its own replies.
                self.microphone.drain()
                self.detector.reset()
                self.vad.reset()
                log.info("push-to-talk")
                self._wake_signal()
                utterance = await self._record(
                    "push_to_talk", 1.0,
                    lead_in_frames=self.follow_up_min_speech_frames,
                )
                utterance.push_to_talk = True
                self.detector.reset()
                self.vad.reset()
                speech_run = 0
                quiet_run = 0
                if utterance.is_probably_empty:
                    log.info("push-to-talk caught nothing; ignoring")
                    continue
                yield utterance
                continue

            if self._paused:
                continue

            # Conversation mode: speech alone is enough while the window is
            # open. Require several consecutive speech frames so a cough, a
            # door, or someone else's sentence doesn't count.
            # Wait for quiet before the window actually opens.
            if self.follow_up_pending:
                if self.vad.is_speech(frame):
                    quiet_run = 0
                else:
                    quiet_run += 1
                    if quiet_run >= self.follow_up_quiet_frames:
                        self.follow_up_pending = False
                        self.follow_up_until = time.time() + self.follow_up_seconds
                        quiet_run = 0
                        log.info("room quiet; listening for a follow-up for %.0fs",
                                 self.follow_up_seconds)
                continue

            if self.follow_up_until is not None:
                if time.time() >= self.follow_up_until:
                    self.close_follow_up()
                    speech_run = 0
                    log.info("follow-up window closed; wake word needed again")
                elif self.vad.is_speech(frame):
                    speech_run += 1
                    if speech_run >= self.follow_up_min_speech_frames:
                        self.close_follow_up()
                        self.follow_ups += 1
                        log.info("follow-up speech detected (no wake word)")
                        # A follow-up is detected within a few frames of
                        # the speaker starting, unlike the wake word which
                        # is confirmed about a second late. Reaching as far
                        # back here would scoop up Relay's own reply still
                        # sitting in the buffer and transcribe it as the
                        # user's next command.
                        utterance = await self._record(
                            "follow_up", 1.0,
                            lead_in_frames=self.follow_up_min_speech_frames,
                        )
                        utterance.follow_up = True
                        self.detector.reset()
                        self.vad.reset()
                        speech_run = 0
                        if utterance.is_probably_empty:
                            log.info("follow-up was empty; ignoring")
                            continue
                        yield utterance
                        continue
                else:
                    speech_run = 0

            wake_word, confidence = self.detector.score(frame)
            self.last_score = confidence
            self.peak_score = max(self.peak_score, confidence)
            if wake_word is None:
                continue
            self.detections += 1

            self.close_follow_up()
            log.info("wake word '%s' (%.2f)", wake_word, confidence)
            self._wake_signal()
            utterance = await self._record(wake_word, confidence)
            # Reset so the tail of this utterance can't trigger the next one.
            self.detector.reset()
            self.vad.reset()

            if utterance.is_probably_empty:
                log.info("wake word fired but nothing was said; ignoring")
                continue
            yield utterance

    async def _record(self, wake_word: str, confidence: float,
                      *, lead_in_frames: int | None = None) -> Utterance:
        """Collect audio until the speaker stops."""
        started = time.time()
        # Look back well before the detection. openWakeWord only confirms a
        # wake word once it has a full 16-frame window, roughly a second after
        # the word was actually spoken — and people run straight on from it
        # ("Relay, open Outer Wilds"). Reaching back only a few hundred
        # milliseconds captures the tail silence and transcribes to nothing.
        collected: list[np.ndarray] = []
        lead_in = self.lead_in_frames if lead_in_frames is None else lead_in_frames
        preroll = self.microphone.preroll()
        if preroll.size and lead_in:
            collected.append(preroll[-lead_in * FRAME_SAMPLES :])

        silent_run = 0
        heard_speech = False

        async for frame in self.microphone.frames():
            collected.append(frame)

            if self.vad.is_speech(frame):
                heard_speech = True
                silent_run = 0
            else:
                silent_run += 1

            # Only end on silence once the person has actually started.
            if heard_speech and silent_run >= self.silence_frames:
                break
            # ...but don't wait forever if they never did.
            if not heard_speech and silent_run >= self.silence_frames * 3:
                break
            if len(collected) >= self.max_frames:
                log.info("utterance hit the length limit")
                break

        audio = np.concatenate(collected) if collected else np.zeros(0, dtype=np.int16)
        return Utterance(
            audio=audio,
            wake_word=wake_word,
            confidence=confidence,
            duration_s=len(audio) / SAMPLE_RATE,
        )


async def build_listener(cfg) -> Listener:
    """Assemble the listener from config, loading models off the event loop."""
    microphone = Microphone(device=_device_index(cfg.audio.input_device))
    detector = WakeWordDetector(cfg.audio.wake_word, cfg.audio.wake_threshold)
    vad = VoiceActivity()
    await asyncio.gather(
        asyncio.to_thread(detector.load),
        asyncio.to_thread(vad.load),
    )
    from relay.audio.chime import Chime

    chime = Chime(volume=cfg.audio.wake_chime_volume,
                  enabled=cfg.audio.wake_chime)
    return Listener(
        microphone, detector, vad,
        silence_ms=cfg.audio.vad_silence_ms,
        max_utterance_s=cfg.audio.max_utterance_s,
        lead_in_ms=cfg.audio.lead_in_ms,
        follow_up_seconds=cfg.audio.follow_up_seconds,
        on_wake=chime.play,
    )


def _device_index(name: str | None) -> str | int | None:
    """Map a PipeWire source name to a sounddevice index, if we can.

    Config records the PipeWire node (what `pactl` reports); sounddevice wants
    its own index or a substring. Falling back to the default device is fine —
    it's usually right, and `relay devices` shows the alternatives.
    """
    if not name:
        return None
    try:
        from relay.audio.capture import list_input_devices

        # "alsa_input.usb-3142_fifine_Microphone-00.analog-stereo" -> "fifine"
        hint = ""
        for part in name.replace(".", "_").split("_"):
            if len(part) > 4 and part.isalpha() and part.lower() not in ("alsa", "input", "usb",
                                                                        "analog", "stereo", "mono"):
                hint = part.lower()
                break
        if not hint:
            return None

        matches = [d for d in list_input_devices() if hint in d["name"].lower()]
        if not matches:
            return None

        # Prefer the PipeWire-managed node over the raw ALSA device. Opening
        # `hw:N,0` directly can take exclusive control of the card, which for a
        # daemon that runs all day means other applications lose the mic.
        for device in matches:
            if "hw:" not in device["name"]:
                return device["index"]
        return matches[0]["index"]
    except Exception as exc:  # noqa: BLE001
        log.debug("could not map audio device %r: %s", name, exc)
    return None

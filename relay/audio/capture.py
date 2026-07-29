"""Microphone capture into an async frame stream.

sounddevice delivers audio on its own realtime thread, so nothing here may
block: the callback only drops frames into a queue, and all real work happens
on the event loop. A ring buffer keeps a short history so the audio *before*
the wake word finished is still available — people start talking immediately
after "Relay", and without pre-roll the first word is lost.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import queue
import time
from collections import deque
from collections.abc import AsyncIterator

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
# openWakeWord expects 1280-sample chunks (80ms at 16kHz).
FRAME_SAMPLES = 1280
FRAME_MS = FRAME_SAMPLES * 1000 // SAMPLE_RATE

# Frames arrive every 80ms, so a few seconds without one means the stream has
# stopped delivering -- but it is long enough not to trip over a scheduling
# hiccup or a model load.
STALL_AFTER_S = 6.0

# The failure that actually happens is quieter than that. When the audio
# server tears the device node down underneath us -- a resume, a WirePlumber
# restart -- the ALSA plugin keeps the stream alive and feeds it *digital
# zero* forever. Frames keep arriving exactly on time and every one is empty,
# so watching frame arrival alone sees nothing wrong.
#
# A real microphone never produces exact zero for long: even a silent room has
# a noise floor, and this one idles around 30 RMS. Thousands of consecutive
# zero samples means the capture is dead, not that the room is quiet.
SILENT_AFTER_S = 45.0
# A hardware mute switch also produces true zero, and that is a legitimate
# thing for a user to do. Backing off stops a muted microphone from being
# reopened every 45 seconds all day.
MAX_SILENCE_WINDOW_S = 600.0
WATCHDOG_INTERVAL_S = 2.0


class MicrophoneClosed(RuntimeError):
    pass


class Microphone:
    """Continuous 16 kHz mono capture, yielded as fixed-size int16 frames."""

    def __init__(
        self,
        device: str | int | None = None,
        *,
        preroll_ms: int = 2500,
        queue_frames: int = 100,
        resolve=None,
    ) -> None:
        self.device = device
        # Called before reopening to look the device up again. A resume can
        # renumber the input devices underneath us, so the index that was
        # right at startup is not necessarily right now.
        self._resolve = resolve
        # When a frame last arrived, and when one last carried any signal at
        # all. The watchdog reads both; nothing else does.
        self.last_frame_at = 0.0
        self.last_signal_at = 0.0
        self.reopens = 0
        # When the last reopen happened. Reopening resets the clocks above, so
        # without this the tick straight afterwards looks healthy and throws
        # the backoff away before it has done anything.
        self._reopened_at = 0.0
        self._queue: queue.Queue[np.ndarray] = queue.Queue(maxsize=queue_frames)
        self._stream = None
        self._preroll = deque(maxlen=max(1, preroll_ms // FRAME_MS))
        self._dropped = 0
        self._running = False
        self._capture_rate = SAMPLE_RATE
        self.frames_yielded = 0
        self.consumers = 0
        self._async_queue: asyncio.Queue = asyncio.Queue(maxsize=queue_frames)
        self._loop: asyncio.AbstractEventLoop | None = None

    # ----------------------------------------------------------- lifecycle
    def _pick_sample_rate(self, sd) -> int:
        """Open at 16 kHz if the device allows it, else its native rate.

        PipeWire-managed nodes typically advertise 48 kHz only and refuse
        16 kHz outright, so insisting on it would force us onto the raw ALSA
        device — which a long-running daemon should avoid, since opening
        `hw:N,0` can take the card exclusively.
        """
        try:
            sd.check_input_settings(device=self.device, samplerate=SAMPLE_RATE,
                                    channels=1, dtype="int16")
            return SAMPLE_RATE
        except Exception:  # noqa: BLE001 - fall back to the native rate
            pass
        try:
            native = int(sd.query_devices(self.device, "input")["default_samplerate"])
        except Exception:  # noqa: BLE001
            native = 48_000
        log.info("device does not accept %d Hz; capturing at %d Hz and resampling",
                 SAMPLE_RATE, native)
        return native

    def start(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        # The PortAudio callback runs on its own thread and must reach the
        # event loop without blocking, so capture the loop up front.
        try:
            self._loop = loop or asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

        self._open()
        self._running = True

    def _open(self) -> None:
        """Open the capture stream. Shared by start() and reopen()."""
        import sounddevice as sd

        if self._resolve is not None:
            try:
                found = self._resolve()
            except Exception as exc:  # noqa: BLE001 - keep the old device
                log.debug("could not re-resolve the input device: %s", exc)
            else:
                if found is not None:
                    self.device = found

        self._capture_rate = self._pick_sample_rate(sd)
        # Ask for whatever yields 1280 samples after resampling.
        blocksize = int(FRAME_SAMPLES * self._capture_rate / SAMPLE_RATE)

        def callback(indata, _frames, _time, status) -> None:
            # Realtime thread: never block, never log at speed.
            if status:
                self._note_status(status)
            frame = indata[:, 0].copy()
            loop = self._loop
            if loop is None or loop.is_closed():
                return
            try:
                loop.call_soon_threadsafe(self._offer, frame)
            except RuntimeError:
                # Loop shutting down.
                self._dropped += 1

        stream = sd.InputStream(
            samplerate=self._capture_rate,
            blocksize=blocksize,
            device=self.device,
            channels=1,
            dtype="int16",
            callback=callback,
        )
        stream.start()
        self._stream = stream
        # Start both clocks now: the watchdog must not fire on the gap between
        # opening the device and the first frame landing.
        self.last_frame_at = self.last_signal_at = time.monotonic()
        log.info("microphone open (device=%s, %d Hz%s)", self.device or "default",
                 self._capture_rate,
                 "" if self._capture_rate == SAMPLE_RATE else f" -> {SAMPLE_RATE} Hz")

    def _close_stream(self) -> None:
        """Drop the PortAudio stream, leaving the queue and consumers alone."""
        if self._stream is None:
            return
        try:
            self._stream.stop()
            self._stream.close()
        except Exception as exc:  # noqa: BLE001 - a dead device fails both
            log.debug("error closing the capture stream: %s", exc)
        finally:
            self._stream = None

    def reopen(self) -> bool:
        """Throw the capture stream away and open a fresh one.

        Deliberately does not touch `_running`, the frame queue or the
        pre-roll: `frames()` is parked on `_async_queue.get()` and must stay
        there, or every consumer would have to be restarted too. Only the
        device handle is replaced, and frames resume arriving underneath the
        consumers that are already waiting.
        """
        self._close_stream()
        try:
            self._open()
        except Exception as exc:  # noqa: BLE001 - device may still be settling
            log.warning("could not reopen the microphone: %s", exc)
            return False
        self.reopens += 1
        # After _open(), so a frame arriving later compares strictly greater
        # and is recognisable as genuinely new audio.
        self._reopened_at = time.monotonic()
        return True

    def _stall_reason(self, now: float, stall_after_s: float,
                      silence_window: float) -> str | None:
        """Why the capture looks dead, or None if it looks fine."""
        starved = now - self.last_frame_at
        if starved >= stall_after_s:
            return f"no audio for {starved:.0f}s"
        mute = now - self.last_signal_at
        if mute >= silence_window:
            return f"nothing but digital silence for {mute:.0f}s"
        return None

    async def watch(self, *, stall_after_s: float = STALL_AFTER_S,
                    silent_after_s: float = SILENT_AFTER_S,
                    interval_s: float = WATCHDOG_INTERVAL_S) -> None:
        """Reopen the microphone when it stops delivering real audio.

        Suspending the machine re-enumerates the microphone underneath
        PortAudio, which does not report it. Relay stays up, keeps answering
        `relay status`, and is deaf until restarted -- it went an hour like
        that before this existed.

        Two symptoms, because the obvious one is not the one that happens.
        Frames may stop arriving; but far more often the ALSA plugin holds the
        stream open and feeds digital zero forever, so frames keep landing
        exactly on time and every one is empty. Measured during a WirePlumber
        restart: 76 frames in 6 seconds, RMS 0.0, no error anywhere.

        Both mean the same thing -- no audio is reaching us -- and both are
        fixed the same way.
        """
        silence_window = silent_after_s
        while True:
            await asyncio.sleep(interval_s)
            if not self._running:
                continue
            # No check for a missing stream. `_stream` is None when an earlier
            # reopen failed, and that is precisely the state to keep retrying
            # out of -- skipping it would leave Relay deaf until restarted,
            # which is the bug this watchdog exists to fix.
            now = time.monotonic()
            reason = self._stall_reason(now, stall_after_s, silence_window)
            if reason is None:
                # Only real audio clears the backoff. Reopening resets the
                # clocks by itself, so testing them alone would call a muted
                # microphone healthy one tick after every reopen and undo the
                # backoff before it slowed anything down.
                if self.last_signal_at > self._reopened_at:
                    silence_window = silent_after_s
                continue

            log.warning("%s; reopening the microphone", reason)
            if self.reopen():
                log.info("microphone reopened (%d since start)", self.reopens)
            else:
                # Hold off a full window before trying again: after a resume
                # the device can take seconds to come back, and retrying every
                # tick would only fill the log while it does.
                self.last_frame_at = self.last_signal_at = time.monotonic()

            # Widen the silence window each time reopening fails to bring
            # audio back, so a microphone muted at the hardware switch settles
            # down instead of being reopened all day.
            silence_window = min(silence_window * 2, MAX_SILENCE_WINDOW_S)

    def _offer(self, frame: np.ndarray) -> None:
        """Runs on the event loop; drops the oldest frame when backed up."""
        now = time.monotonic()
        self.last_frame_at = now
        # `any()` rather than an RMS threshold: the question is whether the
        # device is delivering audio at all, not whether it is loud enough.
        # One non-zero sample in 1280 is enough to prove it is alive.
        if frame.any():
            self.last_signal_at = now
        try:
            self._async_queue.put_nowait(frame)
        except asyncio.QueueFull:
            self._dropped += 1
            # Prefer fresh audio over a stale backlog.
            try:
                self._async_queue.get_nowait()
                self._async_queue.put_nowait(frame)
            except (asyncio.QueueEmpty, asyncio.QueueFull):
                pass

    def _to_16k(self, frame: np.ndarray) -> np.ndarray:
        """Resample a captured frame to 16 kHz mono int16."""
        if self._capture_rate == SAMPLE_RATE:
            return frame
        from math import gcd

        divisor = gcd(SAMPLE_RATE, self._capture_rate)
        up, down = SAMPLE_RATE // divisor, self._capture_rate // divisor
        try:
            from scipy.signal import resample_poly

            resampled = resample_poly(frame.astype(np.float32), up, down)
        except ImportError:
            # Nearest-neighbour is poor but keeps the assistant working.
            indices = (np.arange(FRAME_SAMPLES) * self._capture_rate / SAMPLE_RATE).astype(int)
            resampled = frame[np.clip(indices, 0, len(frame) - 1)].astype(np.float32)

        # The models want exactly FRAME_SAMPLES per frame.
        if len(resampled) > FRAME_SAMPLES:
            resampled = resampled[:FRAME_SAMPLES]
        elif len(resampled) < FRAME_SAMPLES:
            resampled = np.pad(resampled, (0, FRAME_SAMPLES - len(resampled)))
        return np.clip(resampled, -32768, 32767).astype(np.int16)

    def _note_status(self, status) -> None:
        # Overflows are expected under load; only surface them occasionally.
        self._dropped += 1
        if self._dropped % 100 == 1:
            log.debug("audio status: %s", status)

    def stop(self) -> None:
        self._running = False
        if self._loop is not None and not self._loop.is_closed():
            with contextlib.suppress(RuntimeError):
                self._loop.call_soon_threadsafe(self._async_queue.put_nowait, None)
        self._close_stream()
        if self._dropped:
            log.info("dropped %d audio frames over this session", self._dropped)

    def __enter__(self) -> Microphone:
        self.start()
        return self

    def __exit__(self, *exc) -> None:
        self.stop()

    # -------------------------------------------------------------- frames
    async def frames(self) -> AsyncIterator[np.ndarray]:
        """Yield 80ms int16 frames, keeping a rolling pre-roll buffer.

        Frames are handed over by the PortAudio callback via
        ``call_soon_threadsafe`` rather than by polling a thread-safe queue
        through ``run_in_executor``. The polling version blocks one executor
        thread per frame, and shares the default executor with every
        ``asyncio.to_thread`` call in the process — model loading, inference,
        playback. Starve that pool and audio capture stops dead while the
        producer keeps happily filling and dropping.
        """
        self.consumers += 1
        log.info("frame consumer started (running=%s, consumers=%d)",
                 self._running, self.consumers)
        try:
            while self._running:
                frame = await self._async_queue.get()
                if frame is None:      # shutdown sentinel
                    break
                frame = self._to_16k(frame)
                self.frames_yielded += 1
                self._preroll.append(frame)
                yield frame
        finally:
            self.consumers -= 1

    def preroll(self) -> np.ndarray:
        """Recent audio, so the start of an utterance isn't clipped."""
        if not self._preroll:
            return np.zeros(0, dtype=np.int16)
        return np.concatenate(list(self._preroll))

    def clear_preroll(self) -> None:
        self._preroll.clear()

    def drain(self) -> int:
        """Throw away audio queued but not yet consumed.

        The queue buffers several seconds. While the listener is paused --
        which is exactly while Relay is speaking -- it keeps filling with
        Relay's own voice. Without draining, the next recording reads that
        backlog instead of live audio and transcribes Relay's reply back as
        though the user had said it.
        """
        dropped = 0
        while True:
            try:
                self._async_queue.get_nowait()
                dropped += 1
            except asyncio.QueueEmpty:
                break
        self._preroll.clear()
        return dropped

    @property
    def dropped_frames(self) -> int:
        return self._dropped


def list_input_devices() -> list[dict]:
    """Input devices, for `relay devices` and config help."""
    import sounddevice as sd

    devices = []
    for index, device in enumerate(sd.query_devices()):
        if device["max_input_channels"] > 0:
            devices.append({
                "index": index,
                "name": device["name"],
                "channels": device["max_input_channels"],
                "sample_rate": int(device["default_samplerate"]),
            })
    return devices


def rms(frame: np.ndarray) -> float:
    if frame.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)))

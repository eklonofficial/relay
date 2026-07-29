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
from collections import deque
from collections.abc import AsyncIterator

import numpy as np

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
# openWakeWord expects 1280-sample chunks (80ms at 16kHz).
FRAME_SAMPLES = 1280
FRAME_MS = FRAME_SAMPLES * 1000 // SAMPLE_RATE


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
    ) -> None:
        self.device = device
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
        import sounddevice as sd

        # The PortAudio callback runs on its own thread and must reach the
        # event loop without blocking, so capture the loop up front.
        try:
            self._loop = loop or asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

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

        self._stream = sd.InputStream(
            samplerate=self._capture_rate,
            blocksize=blocksize,
            device=self.device,
            channels=1,
            dtype="int16",
            callback=callback,
        )
        self._stream.start()
        self._running = True
        log.info("microphone open (device=%s, %d Hz%s)", self.device or "default",
                 self._capture_rate,
                 "" if self._capture_rate == SAMPLE_RATE else f" -> {SAMPLE_RATE} Hz")

    def _offer(self, frame: np.ndarray) -> None:
        """Runs on the event loop; drops the oldest frame when backed up."""
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
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception as exc:  # noqa: BLE001
                log.debug("error closing stream: %s", exc)
            self._stream = None
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

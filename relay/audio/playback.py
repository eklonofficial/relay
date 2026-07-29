"""Speaking: a queue that plays sentences as they are synthesised.

Sentences are queued rather than concatenated so speech begins while the
model is still writing. The queue is interruptible, because "Relay, stop"
has to work mid-sentence.
"""

from __future__ import annotations

import asyncio
import logging

import numpy as np

log = logging.getLogger(__name__)


class Playback:
    """Serialised audio output with barge-in support."""

    def __init__(self, *, on_start=None, on_finish=None) -> None:
        self._queue: asyncio.Queue = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._stream = None
        self._speaking = False
        self._interrupted = False
        self.on_start = on_start
        self.on_finish = on_finish

    @property
    def speaking(self) -> bool:
        return self._speaking

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run(), name="relay-playback")

    async def stop(self) -> None:
        self.interrupt()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._task = None

    async def say(self, audio: np.ndarray, sample_rate: int) -> None:
        await self._queue.put((audio, sample_rate))

    def interrupt(self) -> None:
        """Stop immediately and discard anything queued."""
        self._interrupted = True
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
                self._queue.task_done()
            except asyncio.QueueEmpty:
                break
        try:
            import sounddevice as sd

            sd.stop()
        except Exception:  # noqa: BLE001
            pass

    async def wait_until_idle(self) -> None:
        await self._queue.join()

    async def _run(self) -> None:
        while True:
            audio, sample_rate = await self._queue.get()
            try:
                if self._interrupted:
                    continue
                await self._play(audio, sample_rate)
            except Exception as exc:  # noqa: BLE001 - a bad clip must not stop the queue
                log.warning("playback failed: %s", exc)
            finally:
                self._queue.task_done()

    async def _play(self, audio: np.ndarray, sample_rate: int) -> None:
        import sounddevice as sd

        if audio.size == 0:
            return
        samples = np.asarray(audio, dtype=np.float32)
        peak = float(np.abs(samples).max() or 0.0)
        if peak > 1.0:
            samples = samples / peak

        self._speaking = True
        self._interrupted = False
        if self.on_start:
            await _maybe_await(self.on_start())
        try:
            await asyncio.to_thread(_blocking_play, sd, samples, sample_rate)
        finally:
            self._speaking = False
            if self.on_finish:
                await _maybe_await(self.on_finish())


def _blocking_play(sd, samples: np.ndarray, sample_rate: int) -> None:
    sd.play(samples, samplerate=sample_rate)
    sd.wait()


async def _maybe_await(value):
    if asyncio.iscoroutine(value):
        await value
    return value

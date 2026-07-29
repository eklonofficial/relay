"""Speech to text: Parakeet TDT 0.6B v3 via ONNX Runtime.

One model, two placements. The int8 CPU build transcribes a 2-second command
in about 0.8s on this machine — 2.5x faster than realtime — which is why the
LITE tier is a genuine fallback rather than a degraded one. The fp32 CUDA
build is faster still, at the cost of VRAM that a game would rather have.

Deliberately no PyTorch: ONNX Runtime covers both placements, and keeping
torch out of the STT path means the assistant still hears you even if the
GPU stack is unavailable.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import numpy as np

log = logging.getLogger(__name__)

MODEL_ID = "nemo-parakeet-tdt-0.6b-v3"
SAMPLE_RATE = 16_000

CPU = "cpu"
GPU = "gpu"


@dataclass(slots=True)
class Transcript:
    text: str
    duration_s: float
    latency_s: float
    placement: str

    @property
    def real_time_factor(self) -> float:
        return self.latency_s / self.duration_s if self.duration_s else 0.0

    @property
    def is_empty(self) -> bool:
        return not self.text.strip()


class SpeechToText:
    """Parakeet, loadable on CPU or GPU and swappable at runtime."""

    def __init__(self, placement: str = CPU) -> None:
        self.placement = placement
        self._model = None
        self._loaded_placement: str | None = None
        self._lock = asyncio.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load_sync(self, placement: str):
        import onnx_asr

        if placement == GPU:
            # fp32 on CUDA. Falls back rather than failing if the provider
            # isn't actually available.
            try:
                model = onnx_asr.load_model(MODEL_ID, providers=["CUDAExecutionProvider"])
                log.info("STT loaded on GPU (fp32)")
                return model
            except Exception as exc:  # noqa: BLE001
                log.warning("could not load STT on GPU (%s); using CPU", exc)
                placement = CPU

        # int8 keeps the download and the memory footprint small.
        model = onnx_asr.load_model(MODEL_ID, quantization="int8",
                                    providers=["CPUExecutionProvider"])
        log.info("STT loaded on CPU (int8)")
        return model

    async def load(self, placement: str | None = None) -> None:
        target = placement or self.placement
        async with self._lock:
            if self._model is not None and self._loaded_placement == target:
                return
            started = time.time()
            self._model = await asyncio.to_thread(self._load_sync, target)
            self._loaded_placement = target
            self.placement = target
            log.info("STT ready in %.1fs (%s)", time.time() - started, target)

    async def unload(self) -> None:
        """Release the model, e.g. when a game needs the VRAM."""
        async with self._lock:
            self._model = None
            self._loaded_placement = None

    async def transcribe(self, audio: np.ndarray, *, sample_rate: int = SAMPLE_RATE) -> Transcript:
        if self._model is None:
            await self.load()

        samples = _to_float32(audio)
        if sample_rate != SAMPLE_RATE:
            samples = _resample(samples, sample_rate, SAMPLE_RATE)
        duration = len(samples) / SAMPLE_RATE

        started = time.time()
        text = await asyncio.to_thread(
            self._model.recognize, samples, sample_rate=SAMPLE_RATE
        )
        latency = time.time() - started

        transcript = Transcript(
            text=(text or "").strip(),
            duration_s=duration,
            latency_s=latency,
            placement=self._loaded_placement or self.placement,
        )
        log.info("heard %r (%.1fs audio, %.2fs, RTF %.2f, %s)",
                 transcript.text, duration, latency,
                 transcript.real_time_factor, transcript.placement)
        return transcript


def _to_float32(audio: np.ndarray) -> np.ndarray:
    """Parakeet wants float32 in [-1, 1]; capture gives int16."""
    if audio.dtype == np.int16:
        return audio.astype(np.float32) / 32768.0
    if audio.dtype == np.float32:
        return audio
    return audio.astype(np.float32)


def _resample(audio: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate:
        return audio
    from math import gcd

    divisor = gcd(source_rate, target_rate)
    try:
        from scipy.signal import resample_poly

        return resample_poly(audio, target_rate // divisor, source_rate // divisor)
    except ImportError:
        indices = np.linspace(0, len(audio) - 1, int(len(audio) * target_rate / source_rate))
        return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)

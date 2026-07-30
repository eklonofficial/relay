"""Text to speech.

Kokoro-82M, ONNX, on the CPU. Fifty-four voices, no VRAM, faster than
realtime, and loaded in half a second -- `relay voice` chooses between them
by ear.

There used to be a second engine on the GPU and a supervisor that swapped
between them as VRAM came and went. It sounded no better, held three
gigabytes of a card that also has to run games, and meant Relay's voice
changed halfway through a conversation. One voice is both the simpler
assistant and the better one.

Synthesis is per sentence so speech starts while the model is still writing.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

KOKORO = "kokoro"

KOKORO_MODEL = "kokoro-v1.0.onnx"
KOKORO_VOICES = "voices-v1.0.bin"
KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"


@dataclass(slots=True)
class Speech:
    audio: np.ndarray      # float32 mono
    sample_rate: int
    latency_s: float
    engine: str

    @property
    def duration_s(self) -> float:
        return len(self.audio) / self.sample_rate if self.sample_rate else 0.0

    @property
    def real_time_factor(self) -> float:
        return self.latency_s / self.duration_s if self.duration_s else 0.0


class TextToSpeech:
    """Base interface. Implementations load lazily and can be unloaded."""

    name = "base"

    async def load(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def unload(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    async def synthesise(self, text: str) -> Speech:  # pragma: no cover - interface
        raise NotImplementedError

    @property
    def loaded(self) -> bool:  # pragma: no cover - interface
        raise NotImplementedError


class KokoroTTS(TextToSpeech):
    """CPU tier. 82M parameters, no VRAM, faster than realtime."""

    name = KOKORO

    def __init__(self, models_dir: Path, voice: str = "af_heart", speed: float = 1.0) -> None:
        self.models_dir = Path(models_dir)
        self.voice = voice
        self.speed = speed
        self._kokoro = None
        self._lock = asyncio.Lock()

    @property
    def loaded(self) -> bool:
        return self._kokoro is not None

    def _model_paths(self) -> tuple[Path, Path]:
        return self.models_dir / KOKORO_MODEL, self.models_dir / KOKORO_VOICES

    def missing_files(self) -> list[str]:
        return [p.name for p in self._model_paths() if not p.exists()]

    def _load_sync(self):
        import espeakng_loader
        from kokoro_onnx import Kokoro

        # Kokoro phonemises through espeak-ng; the wheel bundles the library,
        # so no system package is required.
        espeakng_loader.make_library_available()
        model, voices = self._model_paths()
        return Kokoro(str(model), str(voices))

    async def load(self) -> None:
        async with self._lock:
            if self._kokoro is not None:
                return
            missing = self.missing_files()
            if missing:
                raise FileNotFoundError(
                    f"Kokoro model files missing from {self.models_dir}: {', '.join(missing)}. "
                    f"Download them from {KOKORO_URL}"
                )
            started = time.time()
            self._kokoro = await asyncio.to_thread(self._load_sync)
            log.info("TTS kokoro ready in %.1fs (CPU)", time.time() - started)

    async def unload(self) -> None:
        async with self._lock:
            self._kokoro = None

    async def synthesise(self, text: str) -> Speech:
        if self._kokoro is None:
            await self.load()
        started = time.time()
        audio, sample_rate = await asyncio.to_thread(
            self._kokoro.create, text, self.voice, self.speed, "en-us"
        )
        return Speech(audio=np.asarray(audio, dtype=np.float32), sample_rate=int(sample_rate),
                      latency_s=time.time() - started, engine=self.name)

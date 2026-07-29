"""Text to speech, with two voices for two power tiers.

FULL  Chatterbox Turbo on the GPU — your cloned voice, best prosody.
LITE  Kokoro-82M on the CPU — a different voice, ~0 VRAM, 4.5x realtime.

The voice change is deliberate and useful: hearing a different voice is how
you know Relay has dropped to CPU mode because something else wants the GPU.

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
CHATTERBOX = "chatterbox"

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


class ChatterboxTTS(TextToSpeech):
    """GPU tier. Zero-shot voice cloning from a short reference clip."""

    name = CHATTERBOX

    def __init__(self, reference_audio: Path | None = None, device: str = "cuda") -> None:
        self.reference_audio = Path(reference_audio) if reference_audio else None
        self.device = device
        self._model = None
        self._lock = asyncio.Lock()

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def _load_sync(self):
        # Turbo lives in its own submodule and is not re-exported from
        # chatterbox.tts, where the docs imply it lives.
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        return ChatterboxTurboTTS.from_pretrained(self.device)

    async def load(self, *, warm: bool = True) -> None:
        async with self._lock:
            if self._model is not None:
                return
            started = time.time()
            self._model = await asyncio.to_thread(self._load_sync)
            load_s = time.time() - started

        if warm:
            # Measured on this machine: the first synthesis after load takes
            # ~7.4s (RTF 2.95) while warm runs take ~0.43s (RTF 0.30). Without
            # this, the first thing Relay says after returning from CPU mode
            # arrives seven seconds late. Burn that cost now, silently.
            warm_started = time.time()
            try:
                await self.synthesise("ready")
                log.info("TTS chatterbox ready in %.1fs (+%.1fs warmup, %s)",
                         load_s, time.time() - warm_started, self.device)
            except Exception as exc:  # noqa: BLE001 - warmup is best effort
                log.warning("chatterbox warmup failed: %s", exc)
        else:
            log.info("TTS chatterbox ready in %.1fs (cold, %s)", load_s, self.device)

    async def unload(self) -> None:
        """Free the VRAM. This is what the tier supervisor calls."""
        async with self._lock:
            self._model = None
            try:
                import torch

                torch.cuda.empty_cache()
            except Exception:  # noqa: BLE001
                pass

    async def synthesise(self, text: str) -> Speech:
        if self._model is None:
            await self.load()
        started = time.time()

        def _run():
            kwargs = {}
            if self.reference_audio and self.reference_audio.exists():
                kwargs["audio_prompt_path"] = str(self.reference_audio)
            wav = self._model.generate(text, **kwargs)
            try:
                array = wav.squeeze().detach().cpu().numpy()
            except AttributeError:
                array = np.asarray(wav).squeeze()
            return array.astype(np.float32), int(getattr(self._model, "sr", 24000))

        audio, sample_rate = await asyncio.to_thread(_run)
        return Speech(audio=audio, sample_rate=sample_rate,
                      latency_s=time.time() - started, engine=self.name)


class VoiceRouter:
    """Picks the engine for the current power tier and degrades gracefully."""

    def __init__(self, kokoro: KokoroTTS, chatterbox: ChatterboxTTS | None = None) -> None:
        self.kokoro = kokoro
        self.chatterbox = chatterbox
        self._preferred = KOKORO

    def prefer(self, engine: str) -> None:
        self._preferred = engine

    @property
    def active(self) -> TextToSpeech:
        if self._preferred == CHATTERBOX and self.chatterbox is not None:
            return self.chatterbox
        return self.kokoro

    async def synthesise(self, text: str) -> Speech:
        engine = self.active
        try:
            return await engine.synthesise(text)
        except Exception as exc:  # noqa: BLE001
            if engine is self.kokoro:
                raise
            # Losing the GPU mid-sentence should change the voice, not the
            # assistant's ability to answer.
            log.warning("%s failed (%s); falling back to kokoro", engine.name, exc)
            self._preferred = KOKORO
            return await self.kokoro.synthesise(text)

    async def unload_gpu(self) -> None:
        if self.chatterbox is not None:
            await self.chatterbox.unload()
        self._preferred = KOKORO


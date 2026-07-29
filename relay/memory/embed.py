"""Local sentence embeddings for the semantic arm of memory search.

BGE-small via ONNX Runtime on the CPU: ~130MB, ~384 dims, no VRAM, no network
after the first download. The GPU is reserved for speech.

The embedder is deliberately *optional*. If the model isn't present, memory
search degrades to FTS5-only rather than failing — so a fresh install can
write and recall explicit memories before anything is downloaded.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

# BGE retrieval models are asymmetric: queries get an instruction prefix,
# stored documents don't. Skipping this measurably degrades recall.
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "

_MAX_TOKENS = 512


class Embedder:
    """Lazily-loaded ONNX sentence embedder. Thread-safe."""

    def __init__(self, model_id: str = "BAAI/bge-small-en-v1.5", dim: int = 384,
                 cache_dir: Path | None = None) -> None:
        self.model_id = model_id
        self.dim = dim
        self.cache_dir = cache_dir
        self._session = None
        self._tokenizer = None
        self._lock = threading.Lock()
        self._unavailable = False

    # -- availability ---------------------------------------------------
    @property
    def available(self) -> bool:
        """True if embeddings can be produced, attempting a load if needed."""
        if self._unavailable:
            return False
        if self._session is None:
            try:
                self._load()
            except Exception as exc:  # noqa: BLE001 - degrade, never crash
                log.warning("embeddings unavailable, falling back to keyword search: %s", exc)
                self._unavailable = True
                return False
        return True

    def _load(self) -> None:
        with self._lock:
            if self._session is not None:
                return
            import onnxruntime as ort
            from huggingface_hub import hf_hub_download
            from tokenizers import Tokenizer

            kwargs = {"cache_dir": str(self.cache_dir)} if self.cache_dir else {}
            model_path = hf_hub_download(self.model_id, "onnx/model.onnx", **kwargs)
            tokenizer_path = hf_hub_download(self.model_id, "tokenizer.json", **kwargs)

            opts = ort.SessionOptions()
            # One thread per physical core is counterproductive here; embedding
            # a short sentence is latency-bound, not throughput-bound.
            opts.intra_op_num_threads = 4
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

            self._session = ort.InferenceSession(
                model_path, sess_options=opts, providers=["CPUExecutionProvider"]
            )
            tok = Tokenizer.from_file(tokenizer_path)
            tok.enable_truncation(max_length=_MAX_TOKENS)
            tok.enable_padding()
            self._tokenizer = tok
            log.info("embedder ready: %s (%dd)", self.model_id, self.dim)

    # -- encoding -------------------------------------------------------
    def encode(self, texts: list[str], *, is_query: bool = False) -> np.ndarray | None:
        """Return L2-normalised embeddings, or None if the model is unavailable."""
        if not texts or not self.available:
            return None

        prepared = [QUERY_PREFIX + t for t in texts] if is_query else list(texts)
        encodings = self._tokenizer.encode_batch(prepared)

        input_ids = np.array([e.ids for e in encodings], dtype=np.int64)
        attention_mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)

        feed = {"input_ids": input_ids, "attention_mask": attention_mask}
        # Some exports drop token_type_ids; only send what the graph declares.
        expected = {i.name for i in self._session.get_inputs()}
        if "token_type_ids" in expected:
            feed["token_type_ids"] = np.zeros_like(input_ids)
        feed = {k: v for k, v in feed.items() if k in expected}

        last_hidden = self._session.run(None, feed)[0]
        # BGE pools on the CLS token, not the mean.
        pooled = last_hidden[:, 0, :]
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        return (pooled / np.clip(norms, 1e-12, None)).astype(np.float32)

    def encode_one(self, text: str, *, is_query: bool = False) -> np.ndarray | None:
        out = self.encode([text], is_query=is_query)
        return None if out is None else out[0]


class NullEmbedder(Embedder):
    """Explicitly disabled embeddings, for tests and keyword-only setups."""

    def __init__(self) -> None:
        super().__init__()
        self._unavailable = True

    @property
    def available(self) -> bool:
        return False

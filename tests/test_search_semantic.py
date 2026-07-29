"""Semantic-arm tests. These need the real embedder, so they download
bge-small on first run and skip if it can't be loaded (offline CI).
"""

import pytest

from relay.memory.embed import Embedder
from relay.memory.search import search
from relay.memory.store import MemoryStore

_embedder = Embedder()
needs_embedder = pytest.mark.skipif(
    not _embedder.available, reason="embedding model unavailable (offline?)"
)


@pytest.fixture
def store(tmp_path):
    with MemoryStore(tmp_path / "memory.db", embedder=_embedder) as s:
        s.write("Discord belongs on Hyprland workspace 2")
        s.write("my coding projects are in ~/Projects")
        s.write("Vice is my media player app, source in ~/Vice", scope="project:vice")
        yield s


@needs_embedder
@pytest.mark.parametrize(
    "query",
    [
        "open the thing I've been building lately",  # no shared words at all
        "where do I keep my code?",
        "which workspace does discord go on",
    ],
)
def test_semantic_recall_without_lexical_overlap(store, query):
    """The whole point of the vector arm: FTS5 cannot answer these."""
    results = search(store, query)
    assert results, f"expected a semantic hit for {query!r}"
    assert results[0].similarity is not None


@needs_embedder
@pytest.mark.parametrize(
    "query",
    [
        "what do you remember about quantum chromodynamics?",
        "how do I bake sourdough bread",
        "what is the capital of France",
    ],
)
def test_unrelated_queries_return_nothing_rather_than_noise(store, query):
    """Without a similarity floor, RRF happily returns the least-bad match as
    a confident hit, and the model then recites it as fact."""
    assert search(store, query) == []


@needs_embedder
def test_similarity_floor_is_configurable(store):
    query = "how do I bake sourdough bread"
    assert search(store, query) == []
    # Drop the bar and the same noise comes back, proving the floor is what
    # was excluding it rather than the query simply matching nothing.
    assert search(store, query, min_similarity=0.0) != []


@needs_embedder
def test_stronger_semantic_match_outranks_a_weaker_one(store):
    """Similarity magnitude must survive fusion; plain RRF discards it."""
    results = search(store, "which workspace does discord go on", limit=3)
    assert "Discord" in results[0].memory.content
    if len(results) > 1:
        assert results[0].similarity >= results[1].similarity


@needs_embedder
def test_changing_embedding_signature_rebuilds_the_index(tmp_path):
    """A dimension/metric change must not leave stale vectors behind."""
    path = tmp_path / "memory.db"
    with MemoryStore(path, embedder=_embedder) as s:
        s.write("my coding projects are in ~/Projects")
        assert search(s, "where do I keep my code?")

    # Reopen claiming a different dimension: the vector index is dropped.
    with MemoryStore(path, embedder=_embedder, embed_dim=128) as s:
        count = s.db.execute("SELECT COUNT(*) c FROM memories_vec").fetchone()["c"]
        assert count == 0, "stale vectors survived a signature change"
        # The memory itself is untouched and still findable by keyword.
        assert s.list()
        assert search(s, "projects")

"""Retrieval behaviour.

These run with the NullEmbedder, so they exercise the keyword arm and the
ranking function — i.e. the degraded path that must work on a fresh install
before any model has been downloaded.
"""

import time

import pytest

from relay.memory.search import build_fts_query, search
from relay.memory.store import MemoryStore

DAY = 86400.0


@pytest.fixture
def store(tmp_path):
    with MemoryStore(tmp_path / "memory.db") as s:
        yield s


def _age(store, memory_id: int, days: float) -> None:
    """Backdate a memory so recency weighting can be tested."""
    past = time.time() - days * DAY
    store.db.execute(
        "UPDATE memories SET updated_at = ?, created_at = ?, last_accessed_at = NULL WHERE id = ?",
        (past, past, memory_id),
    )
    store.db.commit()


# ------------------------------------------------------- FTS query building
@pytest.mark.parametrize(
    "text",
    [
        "what's my project?",           # apostrophe
        "find -rf the thing",           # bare hyphen
        'the "quoted" bit',             # embedded quotes
        "a AND b OR NOT c",             # FTS keywords as literal words
        "~/Projects/vice",              # a path
        "***",                          # nothing but punctuation
    ],
)
def test_fts_query_never_produces_a_syntax_error(store, text):
    """Transcribed speech is full of characters that break raw MATCH."""
    store.write("my coding projects are in ~/Projects")
    # Must not raise.
    results = search(store, text)
    assert isinstance(results, list)


def test_fts_query_drops_stopwords_and_keeps_content_words():
    query = build_fts_query("where are my vice files")
    assert "vice" in query
    assert "files" in query
    assert '"are"' not in query


def test_fts_query_returns_none_when_nothing_searchable():
    assert build_fts_query("a the of") is None
    assert build_fts_query("!!!") is None


# ------------------------------------------------------------ exact recall
def test_literal_name_is_found_by_keyword(store):
    store.write("Vice source lives in ~/Vice", scope="project:vice")
    store.write("unrelated note about gardening")

    results = search(store, "where are my vice files")

    assert results
    assert "Vice" in results[0].memory.content


# ----------------------------------------------------------------- recency
def test_newer_conflicting_statement_outranks_the_older_one(store):
    old = store.write("my projects are in ~/code")
    new = store.write("my projects are in ~/Projects")
    _age(store, old, days=300)
    _age(store, new, days=1)

    results = search(store, "where are my projects")
    assert [r.memory.id for r in results][0] == new


# -------------------------------------------------------------- importance
def test_explicit_outranks_an_inference_of_equal_relevance(store):
    guess = store.write("user probably keeps projects in ~/dev", source="inferred_once")
    stated = store.write("user keeps projects in ~/Projects", source="explicit")
    # Same age, so only importance separates them.
    _age(store, guess, days=5)
    _age(store, stated, days=5)

    results = search(store, "projects")
    assert results[0].memory.id == stated
    assert results[0].memory.confidence > results[-1].memory.confidence


def test_pinned_memory_is_boosted(store):
    plain = store.write("relay uses sqlite for memory")
    pinned = store.write("relay stores memory in sqlite with fts5", pinned=True)
    _age(store, plain, days=5)
    _age(store, pinned, days=5)

    results = search(store, "memory sqlite")
    assert results[0].memory.id == pinned


# ------------------------------------------------------------------- scope
def test_active_project_scope_outranks_global(store):
    glob = store.write("the build command is make", scope="global")
    proj = store.write("the build command is cargo build", scope="project:vice")
    _age(store, glob, days=5)
    _age(store, proj, days=5)

    results = search(store, "build command", active_scope="project:vice")
    assert results[0].memory.id == proj

    # With no active scope the affinity term is neutral for both.
    neutral = search(store, "build command")
    assert {r.memory.id for r in neutral} == {glob, proj}


def test_scope_filter_excludes_other_projects(store):
    store.write("vice uses rust", scope="project:vice")
    store.write("relay uses python", scope="project:relay")

    results = search(store, "uses", scope="project:relay")
    assert len(results) == 1
    assert "python" in results[0].memory.content


# ---------------------------------------------------------- exclusion rules
def test_forgotten_memories_do_not_come_back(store):
    memory_id = store.write("my projects are in ~/Projects")
    store.forget(memory_id)

    assert search(store, "projects") == []


def test_superseded_memories_are_not_returned(store):
    old = store.write("projects are in ~/code")
    store.write("projects are in ~/Projects", supersedes=old)

    results = search(store, "projects")
    assert old not in [r.memory.id for r in results]


def test_low_confidence_inference_is_still_marked_as_such(store):
    """An inference may surface, but must never look like a stated fact."""
    store.write("maybe prefers tabs", source="inferred_once")
    results = search(store, "tabs")
    assert results[0].memory.confidence == 20
    assert "confidence 20%" in results[0].memory.describe()


# ------------------------------------------------------------------- misc
def test_search_records_access_for_future_recency(store):
    memory_id = store.write("my projects are in ~/Projects")
    search(store, "projects")
    assert store.get(memory_id).access_count == 1


def test_empty_query_returns_nothing(store):
    store.write("something")
    assert search(store, "   ") == []


def test_results_report_which_arm_matched(store):
    store.write("my projects are in ~/Projects")
    results = search(store, "projects")
    # No embedder in tests, so this is the keyword arm only.
    assert results[0].matched_by == "keyword"

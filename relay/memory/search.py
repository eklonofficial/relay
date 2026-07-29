"""Hybrid retrieval over the memory store.

Two arms, fused with Reciprocal Rank Fusion:

  FTS5/BM25  catches literal tokens  — "where are my vice files"
  sqlite-vec catches meaning         — "open the project I've been working on"

The fused ranking is then weighted by how recent a memory is, how much it
should be trusted, and whether it belongs to what the user is doing right now.
The vector arm is optional; with no embedder this degrades to keyword search
rather than failing.
"""

from __future__ import annotations

import logging
import math
import re
import sqlite3
import time
from dataclasses import dataclass

import sqlite_vec

from relay.memory.store import Memory, MemoryStore

log = logging.getLogger(__name__)

_WORD = re.compile(r"[A-Za-z0-9_~/.-]+")

# Stop words are dropped from the *keyword* arm only. The vector arm still
# sees the full sentence, which is where phrasing carries meaning.
_STOP = {
    "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from",
    "i", "in", "is", "it", "me", "my", "of", "on", "or", "that", "the", "to",
    "was", "what", "when", "where", "which", "who", "with", "you", "your",
}


# Below this cosine similarity a semantic "match" is noise. Calibrated on
# bge-small against this machine's memories: genuinely relevant queries score
# 0.61-0.79, unrelated ones ("how do I bake sourdough bread") top out at 0.46.
# Without a floor, asking about something Relay knows nothing about returns its
# most-recent unrelated memory as a confident hit.
DEFAULT_MIN_SIMILARITY = 0.50


@dataclass(slots=True)
class SearchResult:
    memory: Memory
    score: float
    fts_rank: int | None = None
    vec_rank: int | None = None
    similarity: float | None = None

    @property
    def matched_by(self) -> str:
        if self.fts_rank is not None and self.vec_rank is not None:
            return "both"
        return "keyword" if self.fts_rank is not None else "semantic"


def build_fts_query(text: str) -> str | None:
    """Turn free-form speech into a safe FTS5 MATCH expression.

    Raw user text can't go near MATCH — an apostrophe or a bare `-` is a syntax
    error, and a transcribed question is full of both. Each token is quoted and
    OR-ed, letting BM25 do the ranking.
    """
    tokens = [t for t in _WORD.findall(text.lower()) if t not in _STOP and len(t) > 1]
    if not tokens:
        return None
    return " OR ".join('"' + t.replace('"', '""') + '"' for t in tokens)


def recency_weight(memory: Memory, *, now: float, half_life_days: float, floor: float) -> float:
    """Newer memories win. This is what makes the most recent of two
    conflicting statements surface first."""
    reference = memory.last_accessed_at or memory.updated_at
    age_days = max(0.0, (now - reference) / 86400.0)
    return max(floor, 0.5 ** (age_days / half_life_days))


def importance_weight(memory: Memory) -> float:
    """Explicit statements outrank inferences; pinned outranks everything."""
    weight = 0.55 + 0.45 * (memory.confidence / 100.0)
    if memory.pinned:
        weight *= 1.25
    return weight


def scope_affinity(memory_scope: str, active_scope: str | None) -> float:
    """Vice memories surface first while you're working on Vice."""
    if not active_scope or memory_scope == active_scope:
        return 1.0
    # `global` is the parent of every project scope: still relevant, ranked lower.
    if memory_scope == "global":
        return 0.7
    if active_scope.startswith(memory_scope + ":") or memory_scope.startswith(active_scope + ":"):
        return 0.8
    return 0.4  # a different project entirely


def search(
    store: MemoryStore,
    query: str,
    *,
    scope: str | None = None,
    kind: str | None = None,
    active_scope: str | None = None,
    limit: int = 8,
    fts_candidates: int = 40,
    vec_candidates: int = 40,
    rrf_k: int = 60,
    half_life_days: float = 90.0,
    recency_floor: float = 0.3,
    min_similarity: float = DEFAULT_MIN_SIMILARITY,
    touch: bool = True,
) -> list[SearchResult]:
    """Hybrid search, most relevant first.

    Returns an empty list when nothing clears the relevance bar, so the model
    can say "I don't know that" instead of confidently reciting an unrelated
    memory.
    """
    if not query.strip():
        return []

    fts_ranks = _fts_arm(store, query, scope=scope, kind=kind, limit=fts_candidates)
    vec_hits = _vector_arm(
        store, query, scope=scope, kind=kind, limit=vec_candidates,
        min_similarity=min_similarity,
    )

    fused: dict[int, float] = {}
    for memory_id, rank in fts_ranks.items():
        fused[memory_id] = fused.get(memory_id, 0.0) + 1.0 / (rrf_k + rank)
    for memory_id, (rank, similarity) in vec_hits.items():
        # RRF alone throws away *how* similar a semantic hit was, collapsing a
        # 0.9 match and a 0.55 match to nearly the same score. Scaling the
        # vector arm's contribution by similarity keeps that signal.
        fused[memory_id] = fused.get(memory_id, 0.0) + similarity / (rrf_k + rank)

    if not fused:
        return []

    now = time.time()
    results: list[SearchResult] = []
    for memory_id, rrf in fused.items():
        memory = store.get(memory_id)
        if memory is None or memory.deleted_at is not None or memory.superseded_by is not None:
            continue
        score = (
            rrf
            * recency_weight(memory, now=now, half_life_days=half_life_days, floor=recency_floor)
            * importance_weight(memory)
            * scope_affinity(memory.scope, active_scope)
        )
        hit = vec_hits.get(memory_id)
        results.append(
            SearchResult(
                memory=memory, score=score,
                fts_rank=fts_ranks.get(memory_id),
                vec_rank=hit[0] if hit else None,
                similarity=hit[1] if hit else None,
            )
        )

    results.sort(key=lambda r: r.score, reverse=True)
    top = results[:limit]
    if touch and top:
        store.touch([r.memory.id for r in top])
    return top


def _fts_arm(store: MemoryStore, query: str, *, scope: str | None,
             kind: str | None, limit: int) -> dict[int, int]:
    match = build_fts_query(query)
    if not match:
        return {}

    sql = [
        "SELECT f.rowid AS id FROM memories_fts f",
        "JOIN memories m ON m.id = f.rowid",
        "WHERE memories_fts MATCH ? AND m.deleted_at IS NULL AND m.superseded_by IS NULL",
    ]
    params: list[object] = [match]
    if scope:
        sql.append("AND m.scope = ?"); params.append(scope)
    if kind:
        sql.append("AND m.kind = ?"); params.append(kind)
    sql.append("ORDER BY bm25(memories_fts) LIMIT ?")
    params.append(limit)

    try:
        rows = store.db.execute(" ".join(sql), params).fetchall()
    except sqlite3.OperationalError:
        # A malformed MATCH should degrade to "no keyword hits", never take
        # the whole search down.
        return {}
    return {row["id"]: i + 1 for i, row in enumerate(rows)}


def _vector_arm(store: MemoryStore, query: str, *, scope: str | None, kind: str | None,
                limit: int, min_similarity: float) -> dict[int, tuple[int, float]]:
    """Semantic arm. Returns {memory_id: (rank, cosine_similarity)}."""
    vector = store.embedder.encode_one(query, is_query=True)
    if vector is None:
        return {}

    # vec0 KNN can't be filtered by joined columns in the same statement, so
    # over-fetch and filter after. Cheap at this scale.
    try:
        rows = store.db.execute(
            "SELECT memory_id, distance FROM memories_vec"
            " WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (sqlite_vec.serialize_float32(vector.tolist()), limit * 3),
        ).fetchall()
    except sqlite3.OperationalError as exc:
        # e.g. the index was built for a different embedding dimension.
        # Keyword search still works; a misconfigured model shouldn't make
        # memory unreachable.
        log.warning("semantic arm unavailable, using keyword search only: %s", exc)
        return {}
    if not rows:
        return {}

    ids = [r["memory_id"] for r in rows]
    placeholders = ",".join("?" * len(ids))
    clauses = ["deleted_at IS NULL", "superseded_by IS NULL"]
    params: list[object] = list(ids)
    if scope:
        clauses.append("scope = ?"); params.append(scope)
    if kind:
        clauses.append("kind = ?"); params.append(kind)
    allowed = {
        r["id"] for r in store.db.execute(
            f"SELECT id FROM memories WHERE id IN ({placeholders}) AND {' AND '.join(clauses)}",
            params,
        ).fetchall()
    }

    ranked: dict[int, tuple[int, float]] = {}
    rank = 0
    for row in rows:
        if row["memory_id"] not in allowed:
            continue
        # Tables are declared distance_metric=cosine, so distance is 1 - cos.
        similarity = 1.0 - float(row["distance"])
        if similarity < min_similarity:
            continue  # noise, not a match
        rank += 1
        ranked[row["memory_id"]] = (rank, similarity)
        if rank >= limit:
            break
    return ranked


def search_conversations(
    store: MemoryStore,
    query: str,
    *,
    since: float | None = None,
    limit: int = 5,
    rrf_k: int = 60,
    min_similarity: float = DEFAULT_MIN_SIMILARITY,
) -> list[sqlite3.Row]:
    """Episodic search — 'what did we decide about the memory system last week?'

    Deliberately a different strategy from memory search: recency dominates
    much harder, and there's no confidence dimension because a conversation
    summary isn't a graded claim.
    """
    match = build_fts_query(query)
    fused: dict[int, float] = {}

    if match:
        try:
            rows = store.db.execute(
                "SELECT rowid AS id FROM conversations_fts WHERE conversations_fts MATCH ?"
                " ORDER BY bm25(conversations_fts) LIMIT ?",
                (match, limit * 4),
            ).fetchall()
            for i, row in enumerate(rows):
                fused[row["id"]] = fused.get(row["id"], 0.0) + 1.0 / (rrf_k + i + 1)
        except sqlite3.OperationalError:
            pass

    vector = store.embedder.encode_one(query, is_query=True)
    if vector is not None:
        rows = store.db.execute(
            "SELECT conversation_id AS id, distance FROM conversations_vec"
            " WHERE embedding MATCH ? AND k = ? ORDER BY distance",
            (sqlite_vec.serialize_float32(vector.tolist()), limit * 4),
        ).fetchall()
        rank = 0
        for row in rows:
            similarity = 1.0 - float(row["distance"])
            if similarity < min_similarity:
                continue
            rank += 1
            fused[row["id"]] = fused.get(row["id"], 0.0) + similarity / (rrf_k + rank)

    if not fused:
        return []

    now = time.time()
    scored = []
    for conversation_id, rrf in fused.items():
        row = store.db.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        if row is None:
            continue
        if since is not None and row["started_at"] < since:
            continue
        # 30-day half-life: last week's decision should beat last year's.
        age_days = max(0.0, (now - row["started_at"]) / 86400.0)
        scored.append((rrf * math.pow(0.5, age_days / 30.0), row))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [row for _, row in scored[:limit]]

"""The memory database: connection, migration, and all non-search mutations.

Search lives in search.py. This module owns the write side and the invariants
that keep memory trustworthy — confidence grading, supersession rather than
overwrite, soft deletes, and the rule that a probe can never clobber an
explicit user override.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import sqlite_vec

from relay.memory.embed import Embedder, NullEmbedder

log = logging.getLogger(__name__)

SCHEMA_VERSION = "1"
_SCHEMA_PATH = Path(__file__).parent / "schema.sql"

# How much to trust a memory based on where it came from. These are the
# numbers behind the confidence model: a single guess never outranks a
# statement the user actually made.
SOURCE_CONFIDENCE = {
    "explicit": 100,          # user said it outright
    "confirmed": 90,          # user said yes when asked
    "inferred_repeated": 80,  # observed three or more times
    "imported": 70,
    "inferred_once": 20,      # a guess; stays in observations
}

VALID_KINDS = {
    "fact", "preference", "routine", "entity",
    "technical_note", "todo", "bug", "decision",
    # Who the user is. Kept here rather than in system_facts, which describes
    # the *machine* and is overwritten by a probe on every start -- identity
    # needs confidence, dates and supersession, which that table has none of.
    "identity",
}


@dataclass(slots=True)
class Memory:
    id: int
    scope: str
    kind: str
    content: str
    confidence: int
    source: str
    created_at: float
    updated_at: float
    last_accessed_at: float | None
    access_count: int
    superseded_by: int | None
    pinned: bool
    deleted_at: float | None

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> Memory:
        return cls(
            id=row["id"], scope=row["scope"], kind=row["kind"], content=row["content"],
            confidence=row["confidence"], source=row["source"],
            created_at=row["created_at"], updated_at=row["updated_at"],
            last_accessed_at=row["last_accessed_at"], access_count=row["access_count"],
            superseded_by=row["superseded_by"], pinned=bool(row["pinned"]),
            deleted_at=row["deleted_at"],
        )

    def describe(self) -> str:
        """One-line rendering for the model to read."""
        bits = [f"[{self.scope}/{self.kind}]", self.content]
        if self.confidence < 100:
            bits.append(f"(confidence {self.confidence}%)")
        return " ".join(bits)


@dataclass(slots=True)
class Observation:
    id: int
    pattern_key: str
    content: str
    scope: str
    kind: str
    occurrences: int
    first_seen: float
    last_seen: float
    promoted_at: float | None
    dismissed_at: float | None


class MemoryStore:
    def __init__(
        self,
        path: Path,
        embedder: Embedder | None = None,
        *,
        embed_dim: int = 384,
        promotion_threshold: int = 60,
    ) -> None:
        self.path = path
        self.embedder = embedder or NullEmbedder()
        self.embed_dim = embed_dim
        self.promotion_threshold = promotion_threshold
        self._db: sqlite3.Connection | None = None
        self._lock = threading.RLock()
        # Set if the vector index turns out to be unusable at runtime. Search
        # then falls back to keyword-only rather than every write failing.
        self._vectors_disabled = False

    # ------------------------------------------------------------ lifecycle
    def connect(self) -> MemoryStore:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(self.path, check_same_thread=False)
        db.row_factory = sqlite3.Row

        db.enable_load_extension(True)
        sqlite_vec.load(db)
        db.enable_load_extension(False)

        db.executescript(_SCHEMA_PATH.read_text())
        self._db = db

        # The vec tables' dimension and distance metric are baked into their
        # DDL, so they can't live in schema.sql alongside a configurable dim.
        # Cosine (rather than the vec0 default of L2) means `distance` converts
        # straight to a similarity we can threshold on, which is what stops
        # unrelated memories being returned as confident matches.
        signature = f"{self.embed_dim}:cosine"
        existing = db.execute("SELECT value FROM meta WHERE key='vec_signature'").fetchone()
        if existing is not None and existing["value"] != signature:
            log.info("embedding signature changed (%s -> %s); rebuilding vector index",
                     existing["value"], signature)
            db.execute("DROP TABLE IF EXISTS memories_vec")
            db.execute("DROP TABLE IF EXISTS conversations_vec")

        for table, key in (("memories_vec", "memory_id"),
                           ("conversations_vec", "conversation_id")):
            db.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0("
                f"  {key} INTEGER PRIMARY KEY,"
                f"  embedding FLOAT[{self.embed_dim}] distance_metric=cosine)"
            )

        db.executemany(
            "INSERT INTO meta(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [("schema_version", SCHEMA_VERSION), ("vec_signature", signature)],
        )
        db.commit()

        if existing is not None and existing["value"] != signature:
            self.reindex()
        return self

    def reindex(self) -> int:
        """Re-embed every live memory. Used after an embedding-model change."""
        if not self.embedder.available:
            log.warning("cannot reindex: no embedder available")
            return 0
        rows = self.db.execute(
            "SELECT id, content FROM memories WHERE deleted_at IS NULL"
        ).fetchall()
        with self._lock:
            for row in rows:
                self._embed_memory(row["id"], row["content"])
            self.db.commit()
        log.info("reindexed %d memories", len(rows))
        return len(rows)

    @property
    def db(self) -> sqlite3.Connection:
        if self._db is None:
            raise RuntimeError("MemoryStore.connect() has not been called")
        return self._db

    def close(self) -> None:
        with self._lock:
            if self._db is not None:
                self._db.close()
                self._db = None

    def __enter__(self) -> MemoryStore:
        return self.connect()

    def __exit__(self, *exc) -> None:
        self.close()

    # ------------------------------------------------------------- memories
    def write(
        self,
        content: str,
        *,
        scope: str = "global",
        kind: str = "fact",
        source: str = "explicit",
        confidence: int | None = None,
        pinned: bool = False,
        supersedes: int | None = None,
    ) -> int:
        """Store a memory and return its id.

        `confidence` defaults to the value implied by `source`, so callers
        can't accidentally record a guess at full confidence.
        """
        content = content.strip()
        if not content:
            raise ValueError("refusing to store an empty memory")
        if kind not in VALID_KINDS:
            raise ValueError(f"unknown kind {kind!r}; expected one of {sorted(VALID_KINDS)}")
        if source not in SOURCE_CONFIDENCE:
            raise ValueError(f"unknown source {source!r}")

        score = SOURCE_CONFIDENCE[source] if confidence is None else confidence
        now = time.time()

        with self._lock:
            cur = self.db.execute(
                "INSERT INTO memories(scope, kind, content, confidence, source,"
                "  created_at, updated_at, pinned) VALUES(?,?,?,?,?,?,?,?)",
                (scope, kind, content, score, source, now, now, int(pinned)),
            )
            memory_id = int(cur.lastrowid)
            self._embed_memory(memory_id, content)
            if supersedes is not None:
                self._supersede(supersedes, memory_id)
            self.db.commit()
        return memory_id

    def _embed_memory(self, memory_id: int, content: str) -> None:
        """Attach a vector to a memory, best-effort.

        Indexing is an optimisation, not a correctness requirement: a broken
        or mismatched embedder must degrade search to keyword-only, never stop
        the user from recording something.
        """
        if self._vectors_disabled:
            return
        vector = self.embedder.encode_one(content)
        if vector is None:
            return
        if len(vector) != self.embed_dim:
            log.error(
                "embedder produced %dd vectors but the index expects %dd; "
                "disabling semantic search (memory writes continue). "
                "Fix memory.embed_dim in config to match the model, then run `relay memory reindex`.",
                len(vector), self.embed_dim,
            )
            self._vectors_disabled = True
            return
        try:
            self.db.execute("DELETE FROM memories_vec WHERE memory_id = ?", (memory_id,))
            self.db.execute(
                "INSERT INTO memories_vec(memory_id, embedding) VALUES (?, ?)",
                (memory_id, sqlite_vec.serialize_float32(vector.tolist())),
            )
        except sqlite3.OperationalError as exc:
            log.error("vector index write failed, disabling semantic search: %s", exc)
            self._vectors_disabled = True

    def _supersede(self, old_id: int, new_id: int) -> None:
        """Point an outdated memory at its replacement, keeping both."""
        self.db.execute(
            "UPDATE memories SET superseded_by = ?, updated_at = ? WHERE id = ?",
            (new_id, time.time(), old_id),
        )

    def update(self, memory_id: int, *, content: str | None = None,
               confidence: int | None = None, pinned: bool | None = None,
               scope: str | None = None, kind: str | None = None) -> bool:
        sets, params = [], []
        if content is not None:
            sets.append("content = ?"); params.append(content.strip())
        if confidence is not None:
            sets.append("confidence = ?"); params.append(confidence)
        if pinned is not None:
            sets.append("pinned = ?"); params.append(int(pinned))
        if scope is not None:
            sets.append("scope = ?"); params.append(scope)
        if kind is not None:
            sets.append("kind = ?"); params.append(kind)
        if not sets:
            return False

        sets.append("updated_at = ?"); params.append(time.time())
        params.append(memory_id)

        with self._lock:
            cur = self.db.execute(f"UPDATE memories SET {', '.join(sets)} WHERE id = ?", params)
            if content is not None:
                self._embed_memory(memory_id, content.strip())
            self.db.commit()
            return cur.rowcount > 0

    def forget(self, memory_id: int) -> bool:
        """Soft delete, so 'actually, remember that again' still works."""
        with self._lock:
            cur = self.db.execute(
                "UPDATE memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL",
                (time.time(), memory_id),
            )
            self.db.commit()
            return cur.rowcount > 0

    def restore(self, memory_id: int) -> bool:
        with self._lock:
            cur = self.db.execute(
                "UPDATE memories SET deleted_at = NULL WHERE id = ?", (memory_id,)
            )
            self.db.commit()
            return cur.rowcount > 0

    def get(self, memory_id: int) -> Memory | None:
        row = self.db.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        return Memory.from_row(row) if row else None

    def list(self, *, scope: str | None = None, kind: str | None = None,
             include_deleted: bool = False, include_superseded: bool = False,
             limit: int = 50) -> list[Memory]:
        clauses, params = [], []
        if not include_deleted:
            clauses.append("deleted_at IS NULL")
        if not include_superseded:
            clauses.append("superseded_by IS NULL")
        if scope:
            clauses.append("scope = ?"); params.append(scope)
        if kind:
            clauses.append("kind = ?"); params.append(kind)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        params.append(limit)
        rows = self.db.execute(
            f"SELECT * FROM memories {where} ORDER BY updated_at DESC LIMIT ?", params
        ).fetchall()
        return [Memory.from_row(r) for r in rows]

    # ---------------------------------------------------------- conversations
    def add_conversation(self, *, topic_title: str, summary: str,
                         started_at: float, ended_at: float | None = None,
                         session_id: str | None = None,
                         scope: str = "global") -> int:
        """Store what a conversation was about. Summaries, never transcripts.

        The only write path into `conversations`. Everything on the read side
        -- the FTS triggers, the vector index, the RRF fusion in
        search_conversations() -- was already built and waiting for this.
        """
        topic_title = topic_title.strip()
        summary = summary.strip()
        if not topic_title and not summary:
            raise ValueError("refusing to store an empty conversation")

        with self._lock:
            cursor = self.db.execute(
                "INSERT INTO conversations(session_id, started_at, ended_at,"
                " scope, topic_title, summary) VALUES(?,?,?,?,?,?)",
                (session_id, started_at, ended_at or time.time(), scope,
                 topic_title, summary),
            )
            conversation_id = int(cursor.lastrowid)
            # Both fields, because "what did we decide about the wake word"
            # should match a title *or* something only mentioned in the body.
            self._embed_conversation(conversation_id, f"{topic_title}\n{summary}")
            self.db.commit()
        return conversation_id

    def _embed_conversation(self, conversation_id: int, content: str) -> None:
        """Same best-effort contract as _embed_memory: a broken embedder
        degrades search to keyword-only, it never loses the conversation."""
        if self._vectors_disabled:
            return
        vector = self.embedder.encode_one(content)
        if vector is None or len(vector) != self.embed_dim:
            return
        try:
            self.db.execute(
                "DELETE FROM conversations_vec WHERE conversation_id = ?",
                (conversation_id,),
            )
            self.db.execute(
                "INSERT INTO conversations_vec(conversation_id, embedding)"
                " VALUES (?, ?)",
                (conversation_id, sqlite_vec.serialize_float32(vector.tolist())),
            )
        except sqlite3.OperationalError as exc:
            log.warning("could not index conversation %d: %s", conversation_id, exc)

    def decay(self, *, points_per_month: int = 1, floor: int = 20,
              now: float | None = None) -> int:
        """Let guesses fade. Returns how many memories lost confidence.

        Only *inferred* memories decay. Something the user stated is not less
        true for being old, and a pinned memory is pinned precisely to say
        "keep this regardless" -- so `explicit`, `confirmed` and pinned rows
        are all untouched.

        The floor exists so a memory fades into the background rather than
        disappearing: at zero it would be indistinguishable from a fact that
        was never learned, and there would be nothing left to correct.
        """
        now = time.time() if now is None else now
        month = 30 * 86_400
        changed = 0

        with self._lock:
            rows = self.db.execute(
                "SELECT id, confidence, updated_at FROM memories"
                " WHERE deleted_at IS NULL AND pinned = 0"
                "   AND source IN ('inferred_once','inferred_repeated')"
            ).fetchall()

            for row in rows:
                months = int((now - row["updated_at"]) // month)
                if months <= 0:
                    continue
                target = max(floor, row["confidence"] - points_per_month * months)
                if target == row["confidence"]:
                    continue
                # Deliberately not touching updated_at: that field records
                # when the *content* last changed, and decay would otherwise
                # reset the very clock it depends on.
                self.db.execute(
                    "UPDATE memories SET confidence = ? WHERE id = ?",
                    (target, row["id"]),
                )
                changed += 1
            self.db.commit()

        if changed:
            log.info("decayed %d inferred memories", changed)
        return changed

    def conversations(self, *, limit: int = 20) -> list[sqlite3.Row]:
        """Most recent first. For `relay memory conversations`."""
        return self.db.execute(
            "SELECT * FROM conversations ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ).fetchall()

    def profile(self, *, pinned_only: bool = False) -> list[Memory]:
        """What Relay knows about the user, most confident first.

        `pinned_only` is what reaches the system prompt. The rest is found by
        searching, which is the whole point: the full biography is a few
        hundred tokens and paying that on every single turn is exactly the
        context bloat this memory system exists to avoid.
        """
        query = (
            "SELECT * FROM memories WHERE kind = 'identity'"
            " AND deleted_at IS NULL AND superseded_by IS NULL"
        )
        if pinned_only:
            query += " AND pinned = 1"
        query += " ORDER BY pinned DESC, confidence DESC, created_at ASC"
        return [Memory.from_row(r) for r in self.db.execute(query).fetchall()]

    def touch(self, memory_ids: list[int]) -> None:
        """Record that these memories were actually used; feeds recency ranking."""
        if not memory_ids:
            return
        placeholders = ",".join("?" * len(memory_ids))
        with self._lock:
            self.db.execute(
                f"UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 "
                f"WHERE id IN ({placeholders})",
                [time.time(), *memory_ids],
            )
            self.db.commit()

    # --------------------------------------------------------- observations
    def observe(self, pattern_key: str, content: str, *, scope: str = "global",
                kind: str = "preference") -> Observation:
        """Record a behavioural signal. Repeated signals build confidence.

        This never writes to `memories` — that only happens via promote(),
        and only once the threshold is cleared.
        """
        now = time.time()
        with self._lock:
            self.db.execute(
                "INSERT INTO observations(pattern_key, content, scope, kind,"
                "  occurrences, first_seen, last_seen) VALUES(?,?,?,?,1,?,?) "
                "ON CONFLICT(pattern_key, scope) DO UPDATE SET "
                "  occurrences = occurrences + 1, last_seen = excluded.last_seen,"
                "  content = excluded.content",
                (pattern_key, content, scope, kind, now, now),
            )
            self.db.commit()
        row = self.db.execute(
            "SELECT * FROM observations WHERE pattern_key = ? AND scope = ?",
            (pattern_key, scope),
        ).fetchone()
        return _observation(row)

    def confidence_for(self, occurrences: int) -> int:
        """The confidence an observation has earned from repetition alone."""
        if occurrences >= 3:
            return SOURCE_CONFIDENCE["inferred_repeated"]
        if occurrences == 2:
            return 50
        return SOURCE_CONFIDENCE["inferred_once"]

    def promotable(self) -> list[Observation]:
        """Observations that have earned enough confidence to be worth asking about."""
        rows = self.db.execute(
            "SELECT * FROM observations WHERE promoted_at IS NULL AND dismissed_at IS NULL"
        ).fetchall()
        return [
            _observation(r) for r in rows
            if self.confidence_for(r["occurrences"]) >= self.promotion_threshold
        ]

    def promote(self, observation_id: int, *, confirmed: bool = False) -> int | None:
        """Graduate an observation into a real memory."""
        row = self.db.execute(
            "SELECT * FROM observations WHERE id = ?", (observation_id,)
        ).fetchone()
        if row is None or row["promoted_at"] is not None:
            return None

        source = "confirmed" if confirmed else "inferred_repeated"
        confidence = SOURCE_CONFIDENCE[source] if confirmed else self.confidence_for(row["occurrences"])
        if confidence < self.promotion_threshold:
            return None

        memory_id = self.write(
            row["content"], scope=row["scope"], kind=row["kind"],
            source=source, confidence=confidence,
        )
        with self._lock:
            self.db.execute(
                "UPDATE observations SET promoted_at = ? WHERE id = ?",
                (time.time(), observation_id),
            )
            self.db.commit()
        return memory_id

    def dismiss(self, observation_id: int) -> None:
        """User said no. Stop asking."""
        with self._lock:
            self.db.execute(
                "UPDATE observations SET dismissed_at = ? WHERE id = ?",
                (time.time(), observation_id),
            )
            self.db.commit()

    # --------------------------------------------------------- system facts
    def set_fact(self, key: str, value: str, *, category: str | None = None,
                 source: str = "probed") -> None:
        """Record a machine fact.

        A probe must never overwrite an explicit override — that's what keeps
        "open my browser" resolving to Zen instead of the stale xdg-settings
        answer. An explicit write always wins.
        """
        now = time.time()
        with self._lock:
            if source == "probed":
                self.db.execute(
                    "INSERT INTO system_facts(key, value, category, source, refreshed_at) "
                    "VALUES(?,?,?,'probed',?) "
                    "ON CONFLICT(key) DO UPDATE SET "
                    "  value = excluded.value, category = excluded.category,"
                    "  refreshed_at = excluded.refreshed_at "
                    "WHERE system_facts.source = 'probed'",
                    (key, value, category, now),
                )
            else:
                self.db.execute(
                    "INSERT INTO system_facts(key, value, category, source, refreshed_at) "
                    "VALUES(?,?,?,'explicit',?) "
                    "ON CONFLICT(key) DO UPDATE SET "
                    "  value = excluded.value, category = excluded.category,"
                    "  source = 'explicit', refreshed_at = excluded.refreshed_at",
                    (key, value, category, now),
                )
            self.db.commit()

    def get_fact(self, key: str) -> str | None:
        row = self.db.execute("SELECT value FROM system_facts WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def all_facts(self, category: str | None = None) -> dict[str, str]:
        if category:
            rows = self.db.execute(
                "SELECT key, value FROM system_facts WHERE category = ? ORDER BY key", (category,)
            ).fetchall()
        else:
            rows = self.db.execute("SELECT key, value FROM system_facts ORDER BY key").fetchall()
        return {r["key"]: r["value"] for r in rows}

    # ----------------------------------------------------------- usage log
    def log_usage(self, *, session_id: str | None = None, source: str = "cli",
                  input_tokens: int = 0, output_tokens: int = 0,
                  cache_read_tokens: int = 0, cache_creation_tokens: int = 0,
                  cost_usd: float | None = None, duration_ms: int | None = None,
                  num_turns: int | None = None, rate_limit_type: str | None = None,
                  rate_limit_status: str | None = None,
                  utilization: float | None = None) -> None:
        with self._lock:
            self.db.execute(
                "INSERT INTO usage_log(ts, session_id, source, input_tokens, output_tokens,"
                "  cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, num_turns,"
                "  rate_limit_type, rate_limit_status, utilization)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (time.time(), session_id, source, input_tokens, output_tokens,
                 cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms,
                 num_turns, rate_limit_type, rate_limit_status, utilization),
            )
            self.db.commit()

    def usage_since(self, since_ts: float) -> dict[str, float | int]:
        row = self.db.execute(
            "SELECT COUNT(*) AS turns,"
            "  COALESCE(SUM(input_tokens),0)  AS input_tokens,"
            "  COALESCE(SUM(output_tokens),0) AS output_tokens,"
            "  COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,"
            "  COALESCE(SUM(cache_creation_tokens),0) AS cache_creation_tokens,"
            "  COALESCE(SUM(cost_usd),0.0) AS cost_usd"
            " FROM usage_log WHERE ts >= ?",
            (since_ts,),
        ).fetchone()
        out = dict(row)
        out["total_tokens"] = out["input_tokens"] + out["output_tokens"]
        return out

    def latest_rate_limit(self, *, max_age_s: float | None = None) -> sqlite3.Row | None:
        """Most recent subscription telemetry.

        The CLI only emits a rate-limit event when the *status* changes, so a
        stored reading can be hours old while the real window has since reset.
        Trusting one indefinitely made Relay refuse to answer at "98% used"
        long after usage had dropped back to 70%. Callers making a decision
        must pass `max_age_s`; callers merely displaying a number need not.
        """
        row = self.db.execute(
            "SELECT rate_limit_type, rate_limit_status, utilization, ts FROM usage_log"
            " WHERE utilization IS NOT NULL ORDER BY ts DESC LIMIT 1"
        ).fetchone()
        if row is None or max_age_s is None:
            return row
        return row if (time.time() - row["ts"]) <= max_age_s else None


def _observation(row: sqlite3.Row) -> Observation:
    return Observation(
        id=row["id"], pattern_key=row["pattern_key"], content=row["content"],
        scope=row["scope"], kind=row["kind"], occurrences=row["occurrences"],
        first_seen=row["first_seen"], last_seen=row["last_seen"],
        promoted_at=row["promoted_at"], dismissed_at=row["dismissed_at"],
    )

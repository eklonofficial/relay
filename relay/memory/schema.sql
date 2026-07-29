-- Relay memory database.
--
-- Four layers live here: explicit facts the user stated, learned behaviour
-- (held in `observations` until confident enough to promote), distilled
-- conversation summaries, and a live picture of the machine.
--
-- Retrieval fuses FTS5 (exact tokens: "where are my vice files") with
-- sqlite-vec (semantic: "the project I've been working on").

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ---------------------------------------------------------------- memories
CREATE TABLE IF NOT EXISTS memories (
    id               INTEGER PRIMARY KEY,
    scope            TEXT    NOT NULL DEFAULT 'global',
    kind             TEXT    NOT NULL DEFAULT 'fact',
    content          TEXT    NOT NULL,

    -- 100 explicit, 90 confirmed, 80 repeated. Below promotion_threshold a
    -- candidate never reaches this table at all; it stays an observation.
    confidence       INTEGER NOT NULL DEFAULT 100,
    source           TEXT    NOT NULL DEFAULT 'explicit',

    created_at       REAL    NOT NULL,
    updated_at       REAL    NOT NULL,
    last_accessed_at REAL,
    access_count     INTEGER NOT NULL DEFAULT 0,

    -- Newer contradicting statement. The old row is kept, not deleted, so
    -- "what did I used to have that set to?" still answers.
    superseded_by    INTEGER REFERENCES memories(id) ON DELETE SET NULL,

    pinned           INTEGER NOT NULL DEFAULT 0,   -- exempt from decay
    deleted_at       REAL,                          -- soft delete: "forget that" is undoable

    CHECK (confidence BETWEEN 0 AND 100),
    CHECK (source IN ('explicit','confirmed','inferred_repeated','inferred_once','imported'))
);

CREATE INDEX IF NOT EXISTS idx_memories_scope    ON memories(scope)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_kind     ON memories(kind)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_memories_live     ON memories(deleted_at, superseded_by);
CREATE INDEX IF NOT EXISTS idx_memories_accessed ON memories(last_accessed_at);

-- Exact / keyword arm. Porter stemming so "project" matches "projects".
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    content,
    scope,
    kind,
    content='memories',
    content_rowid='id',
    tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, content, scope, kind)
    VALUES (new.id, new.content, new.scope, new.kind);
END;

CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, scope, kind)
    VALUES ('delete', old.id, old.content, old.scope, old.kind);
END;

CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
    INSERT INTO memories_fts(memories_fts, rowid, content, scope, kind)
    VALUES ('delete', old.id, old.content, old.scope, old.kind);
    INSERT INTO memories_fts(rowid, content, scope, kind)
    VALUES (new.id, new.content, new.scope, new.kind);
END;

-- ------------------------------------------------------------ observations
-- Learned-memory staging. A single guess never becomes a fact: candidates
-- accumulate occurrences here and are only promoted once confidence clears
-- the threshold.
CREATE TABLE IF NOT EXISTS observations (
    id           INTEGER PRIMARY KEY,
    pattern_key  TEXT    NOT NULL,          -- e.g. 'app_workspace:discord'
    content      TEXT    NOT NULL,
    scope        TEXT    NOT NULL DEFAULT 'global',
    kind         TEXT    NOT NULL DEFAULT 'preference',
    occurrences  INTEGER NOT NULL DEFAULT 1,
    first_seen   REAL    NOT NULL,
    last_seen    REAL    NOT NULL,
    promoted_at  REAL,                      -- set when it graduates to memories
    dismissed_at REAL,                      -- user said no; stop asking
    UNIQUE (pattern_key, scope)
);

-- ----------------------------------------------------------- conversations
-- Episodic layer. Summaries, not transcripts.
CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY,
    session_id  TEXT,
    started_at  REAL NOT NULL,
    ended_at    REAL,
    scope       TEXT NOT NULL DEFAULT 'global',
    topic_title TEXT,
    summary     TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_time ON conversations(started_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts USING fts5(
    topic_title,
    summary,
    content='conversations',
    content_rowid='id',
    tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS conversations_ai AFTER INSERT ON conversations BEGIN
    INSERT INTO conversations_fts(rowid, topic_title, summary)
    VALUES (new.id, new.topic_title, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS conversations_ad AFTER DELETE ON conversations BEGIN
    INSERT INTO conversations_fts(conversations_fts, rowid, topic_title, summary)
    VALUES ('delete', old.id, old.topic_title, old.summary);
END;

CREATE TRIGGER IF NOT EXISTS conversations_au AFTER UPDATE ON conversations BEGIN
    INSERT INTO conversations_fts(conversations_fts, rowid, topic_title, summary)
    VALUES ('delete', old.id, old.topic_title, old.summary);
    INSERT INTO conversations_fts(rowid, topic_title, summary)
    VALUES (new.id, new.topic_title, new.summary);
END;

-- ------------------------------------------------------------ system facts
-- What the machine actually is. `source` matters: a probe refresh must never
-- clobber an explicit override, which is how "open my browser" resolves to
-- Zen rather than the stale xdg-settings answer.
CREATE TABLE IF NOT EXISTS system_facts (
    key          TEXT PRIMARY KEY,
    value        TEXT NOT NULL,
    category     TEXT,
    source       TEXT NOT NULL DEFAULT 'probed',
    refreshed_at REAL NOT NULL,
    CHECK (source IN ('probed','explicit'))
);

-- --------------------------------------------------------------- usage log
-- Every turn's cost, so an always-on assistant can't quietly eat the
-- subscription pool that interactive Claude Code shares.
CREATE TABLE IF NOT EXISTS usage_log (
    id                    INTEGER PRIMARY KEY,
    ts                    REAL NOT NULL,
    session_id            TEXT,
    source                TEXT,            -- voice | cli | fastpath
    input_tokens          INTEGER NOT NULL DEFAULT 0,
    output_tokens         INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd              REAL,
    duration_ms           INTEGER,
    num_turns             INTEGER,
    -- Live subscription telemetry reported by the SDK.
    rate_limit_type       TEXT,
    rate_limit_status     TEXT,
    utilization           REAL
);

CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_log(ts DESC);

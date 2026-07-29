"""Backing up the parts of Relay that can't be rebuilt.

A backup is trusted, which makes a silently broken one worse than none at
all. Both bugs found while building this were of exactly that kind: a
snapshot that left stray SQLite sidecars implying a dependency it didn't
have, and a fingerprint querying a column that doesn't exist, which failed
quietly and made every run look like a change.
"""

import sqlite3

import pytest

from relay import backup as backup_mod
from relay.memory.store import MemoryStore


@pytest.fixture
def live(tmp_path):
    """A populated database standing in for the real one."""
    store = MemoryStore(tmp_path / "memory.db").connect()
    store.write("Projects live in ~/Projects.")
    store.write("The user is Andrew Marin.", kind="identity", pinned=True)
    store.add_conversation(topic_title="ffmpeg", summary="Use it directly.",
                           started_at=1000.0)
    store.observe("app_workspace:discord", "Discord belongs on workspace 2.")
    store.set_fact("browser", "zen-browser")
    return store


# ------------------------------------------------------------- snapshotting
def test_a_database_is_copied(live, tmp_path):
    destination = tmp_path / "copy.db"
    good, error = backup_mod.snapshot_database(live.path, destination)
    assert good, error
    assert destination.exists()


def test_the_copy_holds_the_same_data(live, tmp_path):
    destination = tmp_path / "copy.db"
    backup_mod.snapshot_database(live.path, destination)

    copy = MemoryStore(destination).connect()
    assert len(copy.list()) == len(live.list())
    assert copy.get_fact("browser") == "zen-browser"


def test_snapshotting_works_while_the_database_is_open(live, tmp_path):
    """Relay runs continuously, so the file is always in use. A plain cp can
    catch a write mid-flight and produce a file that opens fine now and
    fails at restore time -- the worst moment to find out."""
    live.write("written while the backup runs")
    good, error = backup_mod.snapshot_database(live.path, tmp_path / "copy.db")
    assert good, error


def test_a_missing_source_is_reported(tmp_path):
    good, error = backup_mod.snapshot_database(tmp_path / "nope.db",
                                               tmp_path / "copy.db")
    assert not good and "no database" in error


def test_no_sqlite_sidecars_are_left_behind(live, tmp_path):
    """Regression: -wal and -shm files appeared next to the copy and would
    have been committed, implying the backup depended on them.

    They came back twice: `with sqlite3.connect(...)` commits but does *not*
    close, and verifying the copy reopens it."""
    destination = tmp_path / "copy.db"
    backup_mod.snapshot_database(live.path, destination)
    backup_mod.verify(destination)
    backup_mod.tidy_sidecars(destination)

    assert not (tmp_path / "copy.db-wal").exists()
    assert not (tmp_path / "copy.db-shm").exists()


# --------------------------------------------------------------- verifying
def test_a_good_copy_verifies_and_reports_its_contents(live, tmp_path):
    destination = tmp_path / "copy.db"
    backup_mod.snapshot_database(live.path, destination)

    good, summary = backup_mod.verify(destination)

    assert good
    assert "memories" in summary and "conversations" in summary


def test_a_corrupt_copy_is_caught(tmp_path):
    """The whole point of verifying: a backup that cannot be opened must be
    reported now, not at restore time."""
    broken = tmp_path / "broken.db"
    broken.write_bytes(b"this is definitely not a database")

    good, error = backup_mod.verify(broken)

    assert not good and error


def test_an_empty_file_is_caught(tmp_path):
    empty = tmp_path / "empty.db"
    empty.touch()
    good, _ = backup_mod.verify(empty)
    assert not good


# ------------------------------------------------------------ fingerprint
def test_a_fingerprint_is_produced(live):
    assert backup_mod.fingerprint(live.path)


def test_an_unchanged_database_fingerprints_the_same(live):
    """Two snapshots of an unchanged database are not byte-identical, so
    comparing files would report a change every run and fill the history
    with commits recording nothing."""
    assert backup_mod.fingerprint(live.path) == backup_mod.fingerprint(live.path)


def test_writing_a_memory_changes_the_fingerprint(live):
    before = backup_mod.fingerprint(live.path)
    live.write("something new")
    assert backup_mod.fingerprint(live.path) != before


def test_forgetting_a_memory_changes_the_fingerprint(live):
    memory_id = live.write("temporary")
    before = backup_mod.fingerprint(live.path)
    live.forget(memory_id)
    assert backup_mod.fingerprint(live.path) != before


def test_a_new_conversation_changes_the_fingerprint(live):
    before = backup_mod.fingerprint(live.path)
    live.add_conversation(topic_title="new", summary="s", started_at=2000.0)
    assert backup_mod.fingerprint(live.path) != before


def test_a_new_observation_changes_the_fingerprint(live):
    before = backup_mod.fingerprint(live.path)
    live.observe("app_workspace:code", "Code belongs on workspace 1.")
    assert backup_mod.fingerprint(live.path) != before


def test_a_missing_database_has_no_fingerprint(tmp_path):
    assert backup_mod.fingerprint(tmp_path / "absent.db") is None


def test_every_table_it_queries_actually_exists(live):
    """Regression: the fingerprint asked system_facts for `updated_at`, which
    is called `refreshed_at`. The query raised, the error was swallowed, and
    change detection silently never worked."""
    db = sqlite3.connect(f"file:{live.path}?mode=ro", uri=True)
    try:
        for table, stamp in (("memories", "updated_at"),
                             ("conversations", "started_at"),
                             ("observations", "last_seen"),
                             ("system_facts", "refreshed_at")):
            columns = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
            assert stamp in columns, f"{table} has no {stamp}"
    finally:
        db.close()


def test_a_broken_database_fingerprints_to_nothing(tmp_path):
    broken = tmp_path / "broken.db"
    broken.write_bytes(b"not a database")
    assert backup_mod.fingerprint(broken) is None


# -------------------------------------------------------------- collecting
def test_collecting_gathers_the_irreplaceable_files(live, tmp_path, monkeypatch):
    data = tmp_path / "data"
    (data / "models").mkdir(parents=True)
    (data / "models" / "relay.onnx").write_bytes(b"fake wake word")
    (data / "voice-samples" / "wake").mkdir(parents=True)
    (data / "voice-samples" / "wake" / "relay_0.wav").write_bytes(b"audio")

    monkeypatch.setattr(backup_mod.PATHS, "data", data, raising=False)
    monkeypatch.setattr(type(backup_mod.PATHS), "db",
                        property(lambda self: live.path))
    monkeypatch.setattr(type(backup_mod.PATHS), "models",
                        property(lambda self: data / "models"))
    monkeypatch.setattr(backup_mod, "BACKUP_DIR", tmp_path / "backup")

    good, notes = backup_mod.collect()

    assert good, notes
    written = {p.name for p in (tmp_path / "backup").iterdir()}
    assert {"memory.db", "relay.onnx", "manifest.txt", "README.md"} <= written
    assert (tmp_path / "backup" / "voice-samples").is_dir()


def test_collecting_writes_a_manifest_matching_the_database(live, tmp_path, monkeypatch):
    monkeypatch.setattr(type(backup_mod.PATHS), "db",
                        property(lambda self: live.path))
    monkeypatch.setattr(type(backup_mod.PATHS), "models",
                        property(lambda self: tmp_path / "models"))
    monkeypatch.setattr(backup_mod.PATHS, "data", tmp_path, raising=False)
    monkeypatch.setattr(backup_mod, "BACKUP_DIR", tmp_path / "backup")

    backup_mod.collect()

    stored = (tmp_path / "backup" / "manifest.txt").read_text().strip()
    assert stored == backup_mod.fingerprint(live.path)


def test_a_missing_database_fails_the_backup(tmp_path, monkeypatch):
    monkeypatch.setattr(type(backup_mod.PATHS), "db",
                        property(lambda self: tmp_path / "absent.db"))
    monkeypatch.setattr(backup_mod, "BACKUP_DIR", tmp_path / "backup")

    good, notes = backup_mod.collect()

    assert not good
    assert any("no database" in note for note in notes)


# ------------------------------------------------------------------ safety
def test_the_repo_ignores_the_real_config():
    """config.toml holds the Cider API token. It must never be committable."""
    ignored = (backup_mod.REPO_ROOT / ".gitignore").read_text()
    assert "config.toml" in ignored


def test_the_repo_ignores_the_virtualenv_and_large_models():
    ignored = (backup_mod.REPO_ROOT / ".gitignore").read_text()
    assert ".venv/" in ignored
    assert "models/" in ignored


def test_the_backup_directory_is_explicitly_kept():
    """The blanket *.db and models/ rules would otherwise swallow the two
    things the backup exists to preserve."""
    ignored = (backup_mod.REPO_ROOT / ".gitignore").read_text()
    assert "!backup/" in ignored


def test_no_live_token_is_committed_anywhere():
    """Belt and braces: the real token was once pasted into a test."""
    import subprocess

    result = subprocess.run(
        ["git", "grep", "-I", "-l", "-E", "cider_token *= *\"[a-z0-9]{16,}\""],
        cwd=backup_mod.REPO_ROOT, capture_output=True, text=True, check=False,
    )
    assert result.stdout.strip() == "", f"a token is committed in: {result.stdout}"

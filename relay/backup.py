"""`relay backup` — push the parts of Relay that can't be rebuilt.

Almost everything about Relay is reproducible: the code is in git, the
dependencies come from `pyproject.toml`, and the speech models can be
downloaded again. Three things cannot:

  * **memory.db** — everything Relay knows about Andrew, every conversation it
    has kept, every preference it has learned.
  * **relay.onnx** — the wake word, trained on his own voice.
  * **voice-samples/** — the recordings it was trained from, needed to
    retrain it.

Those are what this copies into `backup/` and commits.

The database is copied with SQLite's own backup API rather than `cp`. Relay
runs continuously, so a plain copy can catch a write mid-flight and produce a
file that looks fine and fails to open later -- the failure would surface at
restore time, which is the worst possible moment to discover it.
"""

from __future__ import annotations

import logging
import shutil
import sqlite3
import subprocess
import time
from pathlib import Path

from relay.paths import PATHS

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKUP_DIR = REPO_ROOT / "backup"


def _run(*argv: str, cwd: Path | None = None) -> tuple[int, str]:
    try:
        proc = subprocess.run(argv, cwd=cwd or REPO_ROOT, capture_output=True,
                              text=True, check=False, timeout=300)
    except FileNotFoundError:
        return 127, f"{argv[0]} is not installed"
    except subprocess.TimeoutExpired:
        return 124, f"{argv[0]} timed out"
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def snapshot_database(source: Path, destination: Path) -> tuple[bool, str]:
    """Copy a live SQLite database safely.

    `sqlite3.Connection.backup` takes a consistent snapshot even while the
    daemon is writing, and it folds in the write-ahead log, so the result is a
    single self-contained file rather than a .db that silently depends on a
    -wal you didn't copy.
    """
    if not source.exists():
        return False, f"no database at {source}"

    live = copy = None
    try:
        live = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        copy = sqlite3.connect(destination)
        live.backup(copy)
    except sqlite3.Error as exc:
        return False, f"could not snapshot the database: {exc}"
    finally:
        # Closed explicitly, not with a `with` block: sqlite3's context
        # manager commits the transaction but leaves the connection *open*,
        # so the -wal and -shm files below would be recreated the moment
        # after they were deleted.
        for connection in (live, copy):
            if connection is not None:
                connection.close()

    return True, ""


def tidy_sidecars(database: Path) -> None:
    """Remove the -wal and -shm files SQLite leaves beside an opened copy.

    They are empty once every connection has closed, and committing them
    would imply the backup depends on files it doesn't. Called after
    verification rather than after the snapshot, because opening the copy to
    check it recreates them.
    """
    for suffix in ("-wal", "-shm"):
        Path(str(database) + suffix).unlink(missing_ok=True)


def verify(path: Path) -> tuple[bool, str]:
    """Open the copy and count what's in it.

    A backup that cannot be read is worse than none, because it is trusted.
    """
    db = None
    try:
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            return False, f"integrity check failed: {integrity}"
        counts = {
            name: db.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
            for name in ("memories", "conversations", "observations",
                         "system_facts")
        }
    except sqlite3.Error as exc:
        return False, f"the copy will not open: {exc}"
    finally:
        if db is not None:
            db.close()
    return True, ", ".join(f"{n} {k}" for k, n in counts.items())


def collect(*, include_voice: bool = True) -> tuple[bool, list[str]]:
    """Gather the irreplaceable files into backup/."""
    notes: list[str] = []
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    good, error = snapshot_database(PATHS.db, BACKUP_DIR / "memory.db")
    if not good:
        return False, [error]

    good, summary = verify(BACKUP_DIR / "memory.db")
    tidy_sidecars(BACKUP_DIR / "memory.db")
    if not good:
        return False, [summary]
    notes.append(f"memory.db  ({summary})")

    wake_word = PATHS.models / "relay.onnx"
    if wake_word.exists():
        shutil.copy2(wake_word, BACKUP_DIR / "relay.onnx")
        notes.append(f"relay.onnx  ({wake_word.stat().st_size // 1024} KiB, "
                     "trained wake word)")

    samples = PATHS.data / "voice-samples"
    if include_voice and samples.is_dir():
        destination = BACKUP_DIR / "voice-samples"
        shutil.rmtree(destination, ignore_errors=True)
        shutil.copytree(samples, destination)
        count = sum(1 for _ in destination.rglob("*") if _.is_file())
        notes.append(f"voice-samples  ({count} recordings)")

    (BACKUP_DIR / "README.md").write_text(
        "# Backup\n\n"
        "Written by `relay backup`. These are the only parts of Relay that\n"
        "cannot be rebuilt from source:\n\n"
        "- `memory.db` — everything Relay knows and remembers\n"
        "- `relay.onnx` — the wake word, trained on Andrew's voice\n"
        "- `voice-samples/` — the recordings it was trained from\n\n"
        f"Last updated: {time.strftime('%Y-%m-%d %H:%M')}\n\n"
        "`install.sh` restores all three, and will not overwrite an existing\n"
        "memory.db.\n"
    )
    return True, notes


def push(*, message: str | None = None, dry_run: bool = False) -> tuple[int, list[str]]:
    """Snapshot, commit and push. Returns (exit_code, lines to print)."""
    lines: list[str] = []

    code, _ = _run("git", "rev-parse", "--is-inside-work-tree")
    if code != 0:
        return 1, [f"{REPO_ROOT} is not a git repository.",
                   "Run install.sh from a clone, or `git init` here first."]

    good, notes = collect()
    if not good:
        return 1, notes
    lines.extend(f"  {note}" for note in notes)

    if dry_run:
        lines.append("")
        lines.append("Dry run — backup/ is updated but nothing was committed.")
        return 0, lines

    code, out = _run("git", "add", "backup")
    if code != 0:
        return 1, lines + [f"git add failed: {out}"]

    code, _ = _run("git", "diff", "--cached", "--quiet", "--", "backup")
    if code == 0:
        lines.append("")
        lines.append("Nothing changed since the last backup.")
        return 0, lines

    stamp = time.strftime("%Y-%m-%d %H:%M")
    code, out = _run("git", "commit", "-m", message or f"Back up memories, {stamp}")
    if code != 0:
        return 1, lines + [f"git commit failed: {out}"]

    code, out = _run("git", "push")
    if code != 0:
        return 1, lines + [
            "Committed locally, but the push failed:",
            f"  {out}",
            "Your backup is safe on disk; run `git push` when you can.",
        ]

    lines.append("")
    lines.append(f"Pushed. ({stamp})")
    return 0, lines

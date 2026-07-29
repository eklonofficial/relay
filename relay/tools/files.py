"""File discovery tools.

Reading and searching only. Anything that *changes* the filesystem goes
through Bash so it passes the permission hook, where deletes and moves are
gated behind spoken confirmation.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from relay.tools.base import fail, integer, ok, schema, string

# Relative time words, since "yesterday" is how people actually speak.
_RELATIVE = {
    "today": 0, "yesterday": 1, "this week": 7, "last week": 14,
    "this month": 30, "last month": 60,
}


def _parse_since(text: str) -> float | None:
    """Turn 'yesterday' or '2026-07-20' into a unix timestamp."""
    value = text.strip().lower()

    if value in _RELATIVE:
        days = _RELATIVE[value]
        midnight = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        return (midnight - timedelta(days=days)).timestamp()

    if value.endswith(("d", "h", "m")) and value[:-1].strip().isdigit():
        amount = int(value[:-1])
        unit = {"d": 86400, "h": 3600, "m": 60}[value[-1]]
        return time.time() - amount * unit

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d %B %Y", "%d %b %Y"):
        try:
            return datetime.strptime(value, fmt).timestamp()
        except ValueError:
            continue
    return None


def _human_size(size: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f}{unit}" if unit == "B" else f"{size:.1f}{unit}"
        size /= 1024.0
    return f"{size:.1f}GB"


@tool(
    "find_by_time",
    "Find files modified within a time window. Understands 'yesterday', "
    "'today', 'last week', '3d', '2h', or a date. This is how you answer "
    "'the clips I took yesterday'.",
    schema(
        {
            "directory": string("Directory to search, e.g. '~/Videos/clips'"),
            "since": string("Start of the window: 'yesterday', '3d', '2026-07-20'"),
            "until": string("Optional end of the window, same formats"),
            "pattern": string("Optional glob such as '*.mp4' (default '*')"),
            "limit": integer("Max results (default 50)"),
        },
        required=["directory", "since"],
    ),
)
async def find_by_time(args: dict[str, Any]) -> dict[str, Any]:
    directory = Path(args["directory"]).expanduser()
    if not directory.is_dir():
        return fail(f"{directory} is not a directory.")

    since = _parse_since(args["since"])
    if since is None:
        return fail(f"Couldn't understand the time '{args['since']}'.")
    until = _parse_since(args["until"]) if args.get("until") else None
    # A bare day name means that whole day, not everything since.
    if until is None and args["since"].strip().lower() in ("yesterday", "today"):
        until = since + 86400

    pattern = args.get("pattern") or "*"
    limit = int(args.get("limit", 50))

    matches = []
    try:
        for path in directory.rglob(pattern):
            if not path.is_file():
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            if stat.st_mtime < since or (until is not None and stat.st_mtime > until):
                continue
            matches.append((stat.st_mtime, path, stat.st_size))
    except (OSError, ValueError) as exc:
        return fail(f"Couldn't search {directory}: {exc}")

    if not matches:
        return ok(f"No files in {directory} match that window.")

    matches.sort(reverse=True)
    total = len(matches)
    lines = [
        f"{datetime.fromtimestamp(mtime):%Y-%m-%d %H:%M}  {_human_size(size):>8}  {path}"
        for mtime, path, size in matches[:limit]
    ]
    header = f"{total} file(s):" if total <= limit else f"{total} file(s), showing {limit}:"
    return ok(header + "\n" + "\n".join(lines))


@tool(
    "file_info",
    "Size, modification time and type of a single file or directory.",
    schema({"path": string("Path to inspect")}, required=["path"]),
)
async def file_info(args: dict[str, Any]) -> dict[str, Any]:
    path = Path(args["path"]).expanduser()
    if not path.exists():
        return fail(f"{path} does not exist.")
    try:
        stat = path.stat()
    except OSError as exc:
        return fail(str(exc))
    kind = "directory" if path.is_dir() else "file"
    if path.is_dir():
        try:
            count = sum(1 for _ in path.iterdir())
            return ok(f"{path} — {kind}, {count} entries, "
                      f"modified {datetime.fromtimestamp(stat.st_mtime):%Y-%m-%d %H:%M}")
        except OSError:
            pass
    return ok(f"{path} — {kind}, {_human_size(stat.st_size)}, "
              f"modified {datetime.fromtimestamp(stat.st_mtime):%Y-%m-%d %H:%M}")


@tool(
    "disk_usage",
    "How much space a directory uses, and free space on its filesystem.",
    schema({"path": string("Directory to measure")}, required=["path"]),
)
async def disk_usage(args: dict[str, Any]) -> dict[str, Any]:
    import shutil as _shutil

    path = Path(args["path"]).expanduser()
    if not path.is_dir():
        return fail(f"{path} is not a directory.")
    total = 0
    for candidate in path.rglob("*"):
        try:
            if candidate.is_file():
                total += candidate.stat().st_size
        except OSError:
            continue
    usage = _shutil.disk_usage(path)
    return ok(
        f"{path} uses {_human_size(total)}. "
        f"Filesystem: {_human_size(usage.free)} free of {_human_size(usage.total)}."
    )


TOOLS = [find_by_time, file_info, disk_usage]
TOOL_NAMES = [f"mcp__files__{t.name}" for t in TOOLS]


def server():
    return create_sdk_mcp_server(name="files", version="1.0.0", tools=TOOLS)

"""Permission tiers and dry-run, enforced in a PreToolUse hook.

This is code, not prompt text, so the model cannot talk its way past it.

Three tiers:
  AUTO   runs immediately — reads, window management, launching apps
  ASK    needs spoken confirmation — deletes, sudo, installs, anything outward
  NEVER  refused outright — catastrophic or credential-stealing

The default for anything unrecognised is ASK, never AUTO. A new tool or an
unfamiliar shell command should interrupt the user, not surprise them.
"""

from __future__ import annotations

import logging
import re
import shlex
from collections.abc import Awaitable, Callable
from enum import Enum
from pathlib import Path
from typing import Any

from relay.config import MODE_DRY_RUN, Config

log = logging.getLogger(__name__)


class Tier(str, Enum):
    AUTO = "auto"
    ASK = "ask"
    NEVER = "never"


# --------------------------------------------------------------- shell rules
# Commands that only ever read. Anything not here falls through to ASK.
READ_ONLY = {
    "ls", "cat", "head", "tail", "less", "bat", "wc", "file", "stat", "readlink",
    "grep", "rg", "egrep", "fgrep", "find", "fd", "locate", "tree",
    "echo", "printf", "pwd", "whoami", "id", "date", "uptime", "hostname",
    "which", "whereis", "type", "env", "printenv",
    "ps", "pgrep", "top", "free", "df", "du", "lsblk", "lscpu", "uname",
    "jq", "sort", "uniq", "cut", "tr", "column", "diff", "cmp", "md5sum", "sha256sum",
    "nvidia-smi", "pactl", "wpctl", "pw-cli", "playerctl",
    "curl", "wget",  # gated further below: only safe without upload/output flags
}

# Read-only subcommands of tools that also have destructive ones.
SAFE_SUBCOMMANDS = {
    "git": {"status", "log", "diff", "show", "branch", "remote", "describe",
            "rev-parse", "ls-files", "blame", "stash list", "config"},
    "hyprctl": {"clients", "monitors", "workspaces", "activewindow", "activeworkspace",
                "devices", "version", "getoption", "layers", "binds", "dispatch"},
    "systemctl": {"status", "list-units", "is-active", "is-enabled", "show", "cat"},
    "docker": {"ps", "images", "logs", "inspect"},
    "flatpak": {"list", "info"},
    "pacman": {"-Q", "-Qi", "-Qs", "-Ql", "-Si", "-Ss"},  # queries only
}

# Refused outright, with no confirmation offered.
NEVER_PATTERNS = [
    (re.compile(r"\brm\s+(-[a-zA-Z]*\s+)*(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\S*\s+/\s*$"),
     "recursive delete of /"),
    (re.compile(r"\brm\s+.*\s+/(\s|$)"), "delete targeting /"),
    (re.compile(r"\bmkfs(\.\w+)?\b"), "filesystem format"),
    (re.compile(r"\bdd\b.*\bof=/dev/(sd|nvme|vd|hd)"), "raw write to a block device"),
    (re.compile(r">\s*/dev/(sd|nvme|vd|hd)"), "raw write to a block device"),
    (re.compile(r":\(\)\s*\{.*\};\s*:"), "fork bomb"),
    (re.compile(r"\b(shutdown|poweroff|halt|reboot)\b"), "power state change"),
    (re.compile(r"\bchmod\s+(-[a-zA-Z]+\s+)*777\s+/(\s|$)"), "world-writable root"),
    (re.compile(r"(^|\s)>\s*/etc/"), "overwriting system configuration"),
    (re.compile(r"\b(rm|mv|truncate)\b[^|;&]*\s/(etc|boot|usr|bin|sbin|lib)(/|\s|$)"),
     "modifying system directories"),
    # Credential exfiltration: reading key material is fine locally, sending it isn't.
    (re.compile(r"(\.ssh/id_|\.gnupg|\.aws/credentials|\.config/gh/hosts|credentials\.json)"
                r"[^|;&]*\|[^|;&]*\b(curl|wget|nc|ncat|ssh|mail)\b"),
     "sending credentials off the machine"),
]

# Shell metacharacters that split one command line into several.
_SPLIT = re.compile(r"\|\||&&|;|\||\n")

# Redirections that write to a file.
_WRITE_REDIRECT = re.compile(r"(?<![0-9<>])>{1,2}(?!&)")

# Directories Relay may write to without asking.
DEFAULT_WRITABLE = ("~/Projects", "~/Vice", "~/Linux-assistant", "/tmp")


def _expand(paths: tuple[str, ...]) -> list[Path]:
    return [Path(p).expanduser().resolve() for p in paths]


def classify_bash(command: str, *, writable: tuple[str, ...] = DEFAULT_WRITABLE) -> tuple[Tier, str]:
    """Classify a shell command line.

    Every segment is classified independently and the most restrictive wins,
    so `ls; rm -rf ~` is never treated as `ls`.
    """
    stripped = command.strip()
    if not stripped:
        return Tier.ASK, "empty command"

    for pattern, why in NEVER_PATTERNS:
        if pattern.search(stripped):
            return Tier.NEVER, why

    # Command substitution can hide anything; make the user look at it.
    if "$(" in stripped or "`" in stripped:
        return Tier.ASK, "contains command substitution"

    worst, reason = Tier.AUTO, "read-only"
    for segment in _SPLIT.split(stripped):
        tier, why = _classify_segment(segment.strip(), writable=writable)
        if tier == Tier.NEVER:
            return tier, why
        if tier == Tier.ASK and worst == Tier.AUTO:
            worst, reason = tier, why
    return worst, reason


def _classify_segment(segment: str, *, writable: tuple[str, ...]) -> tuple[Tier, str]:
    if not segment:
        return Tier.AUTO, "empty"

    if _WRITE_REDIRECT.search(segment):
        target = _redirect_target(segment)
        if target and _within(target, writable):
            return Tier.AUTO, f"writes inside {target}"
        return Tier.ASK, "redirects output to a file"

    try:
        parts = shlex.split(segment)
    except ValueError:
        return Tier.ASK, "unparseable command"
    if not parts:
        return Tier.AUTO, "empty"

    # Strip env-var assignments and sudo detection.
    while parts and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", parts[0]):
        parts.pop(0)
    if not parts:
        return Tier.AUTO, "environment assignment only"

    executable = Path(parts[0]).name
    if executable in ("sudo", "doas", "pkexec"):
        return Tier.ASK, "runs as root"

    if executable in SAFE_SUBCOMMANDS:
        args = [p for p in parts[1:] if not p.startswith("--")]
        subcommand = args[0] if args else ""
        if subcommand in SAFE_SUBCOMMANDS[executable]:
            # `hyprctl dispatch` is how windows get moved: allowed, but it acts.
            return Tier.AUTO, f"{executable} {subcommand}"
        return Tier.ASK, f"{executable} {subcommand or '(no subcommand)'} may change things"

    if executable in ("sed", "perl") and any(a.startswith("-i") for a in parts[1:]):
        return Tier.ASK, "edits files in place"

    if executable in ("curl", "wget"):
        # Fetching is fine; uploading or saving is not.
        if any(a in ("-X", "--request", "-d", "--data", "-F", "--form", "-T", "--upload-file",
                     "-o", "--output", "-O") for a in parts[1:]):
            return Tier.ASK, "uploads or writes a file"
        return Tier.AUTO, "read-only fetch"

    if executable in READ_ONLY:
        return Tier.AUTO, "read-only"

    return Tier.ASK, f"'{executable}' is not on the auto-allow list"


def _redirect_target(segment: str) -> Path | None:
    match = re.search(r">{1,2}\s*([^\s;|&]+)", segment)
    if not match:
        return None
    try:
        return Path(match.group(1)).expanduser().resolve()
    except (OSError, RuntimeError):
        return None


def _within(path: Path, writable: tuple[str, ...]) -> bool:
    for root in _expand(writable):
        try:
            path.relative_to(root)
            return True
        except ValueError:
            continue
    return False


# ----------------------------------------------------------------- tool rules
# Relay's own tools, by tier. Everything here is deliberate; unlisted tools
# fall through to ASK.
TOOL_TIERS: dict[str, Tier] = {
    # memory
    "memory_search": Tier.AUTO, "memory_write": Tier.AUTO, "memory_forget": Tier.AUTO,
    "memory_list": Tier.AUTO, "memory_observe": Tier.AUTO,
    "conversation_search": Tier.AUTO, "system_fact": Tier.AUTO, "system_set": Tier.AUTO,
    # desktop — window management is reversible and expected
    "list_windows": Tier.AUTO, "active_window": Tier.AUTO, "list_workspaces": Tier.AUTO,
    "focus_window": Tier.AUTO, "move_window_to_workspace": Tier.AUTO,
    "switch_workspace": Tier.AUTO, "toggle_floating": Tier.AUTO,
    "fullscreen_window": Tier.AUTO, "launch_app": Tier.AUTO, "is_running": Tier.AUTO,
    # closing a window can lose unsaved work
    "close_window": Tier.ASK,
    # files — read-only
    "find_by_time": Tier.AUTO, "file_info": Tier.AUTO, "disk_usage": Tier.AUTO,
    # music — all trivially reversible, and confirming "skip this song" would
    # be worse than useless
    "music_play": Tier.AUTO, "music_pause": Tier.AUTO, "music_next": Tier.AUTO,
    "music_previous": Tier.AUTO, "music_now_playing": Tier.AUTO,
    "music_volume": Tier.AUTO, "music_seek": Tier.AUTO,
    "music_shuffle": Tier.AUTO, "music_repeat": Tier.AUTO,
    "music_queue": Tier.AUTO,
    # screen — saving a PNG is inert. read_screen sends the screen contents
    # to the model, which is a real privacy step, but it is also the whole
    # point of the tool and only ever happens when the user asked to be
    # looked at. Confirming every capture would make the feature unusable.
    "take_screenshot": Tier.AUTO, "read_screen": Tier.AUTO,
    # built-ins
    "Read": Tier.AUTO, "Glob": Tier.AUTO, "Grep": Tier.AUTO,
}

# Tools with no side effects still run normally during a dry run, so the
# preview describes what's actually on disk instead of a guess.
READ_ONLY_TOOLS = {
    "Read", "Glob", "Grep",
    "memory_search", "memory_list", "conversation_search", "system_fact",
    "list_windows", "active_window", "list_workspaces", "is_running",
    "find_by_time", "file_info", "disk_usage",
    "music_now_playing", "music_queue",
    # Looking changes nothing, so a dry run should still describe what's on
    # screen rather than guessing at it.
    "read_screen", "take_screenshot",
}


def strip_prefix(tool_name: str) -> str:
    """`mcp__desktop__launch_app` -> `launch_app`."""
    if tool_name.startswith("mcp__"):
        return tool_name.rsplit("__", 1)[-1]
    return tool_name


def classify(tool_name: str, tool_input: dict[str, Any], *,
             writable: tuple[str, ...] = DEFAULT_WRITABLE) -> tuple[Tier, str]:
    """Classify any tool call into a permission tier."""
    name = strip_prefix(tool_name)

    if name == "Bash":
        command = (tool_input or {}).get("command", "")
        return classify_bash(command, writable=writable)

    if name in ("Write", "Edit", "NotebookEdit"):
        path = (tool_input or {}).get("file_path") or ""
        if path:
            try:
                resolved = Path(path).expanduser().resolve()
            except (OSError, RuntimeError):
                return Tier.ASK, "unresolvable path"
            if _within(resolved, writable):
                return Tier.AUTO, f"writes inside an allowed directory"
        return Tier.ASK, "writes outside the allowed directories"

    tier = TOOL_TIERS.get(name)
    if tier is not None:
        return tier, "listed"
    return Tier.ASK, f"'{name}' is not on the auto-allow list"


def is_read_only(tool_name: str) -> bool:
    return strip_prefix(tool_name) in READ_ONLY_TOOLS


# ---------------------------------------------------------------------- hook
ConfirmFn = Callable[[str], Awaitable[bool]]


def _decision(decision: str, reason: str) -> dict[str, Any]:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }


def describe_call(tool_name: str, tool_input: dict[str, Any]) -> str:
    """A short human description, for confirmations and dry-run previews."""
    name = strip_prefix(tool_name)
    data = tool_input or {}
    if name == "Bash":
        return f"run `{data.get('command', '')}`"
    if name in ("Write", "Edit"):
        return f"modify {data.get('file_path', 'a file')}"
    if data:
        primary = next(iter(data.values()))
        return f"{name} ({primary})"
    return name


def make_hook(cfg: Config, confirm: ConfirmFn | None = None,
              on_dry_run: Callable[[str], None] | None = None,
              on_allowed: Callable[[str, dict[str, Any]], None] | None = None):
    """Build the PreToolUse hook enforcing tiers and dry-run."""
    writable = tuple(DEFAULT_WRITABLE)

    async def hook(input_data: dict[str, Any], tool_use_id: str | None,
                   context: Any) -> dict[str, Any]:
        tool_name = input_data.get("tool_name", "")
        tool_input = input_data.get("tool_input") or {}
        tier, reason = classify(tool_name, tool_input, writable=writable)
        description = describe_call(tool_name, tool_input)

        if tier == Tier.NEVER:
            log.warning("blocked %s: %s", description, reason)
            return _decision(
                "deny",
                f"Refused: {reason}. Relay will not do this. Do not retry or "
                f"rephrase — tell the user what you were asked to do and stop.",
            )

        # Dry run: read-only tools still execute, so the preview is grounded in
        # what's really there. Everything else is described, not performed.
        if cfg.mode == MODE_DRY_RUN and not is_read_only(tool_name):
            if on_dry_run:
                on_dry_run(description)
            log.info("dry run, not executing: %s", description)
            return _decision(
                "deny",
                f"DRY RUN — not executed. This would {description}. "
                f"Continue planning and describe the whole plan to the user; "
                f"do not treat this as a failure.",
            )

        if tier == Tier.ASK:
            if confirm is None:
                return _decision(
                    "deny",
                    f"Needs confirmation ({reason}) but no confirmation channel is "
                    f"available. Tell the user what you wanted to do and why.",
                )
            approved = await confirm(description)
            if not approved:
                return _decision(
                    "deny",
                    "The user declined. Do not retry or work around it; "
                    "acknowledge and move on.",
                )
            _notify_allowed(tool_name, tool_input)
            return _decision("allow", "user confirmed")

        _notify_allowed(tool_name, tool_input)
        return _decision("allow", reason)

    def _notify_allowed(tool_name: str, tool_input: dict[str, Any]) -> None:
        """The single point where a tool is about to actually run.

        Deliberately not called on the deny paths: a refused or dry-run
        action is not something to learn a preference from.
        """
        if on_allowed is None:
            return
        try:
            on_allowed(tool_name, tool_input)
        except Exception:  # noqa: BLE001 - observing must never block acting
            log.debug("on_allowed callback failed", exc_info=True)

    return hook

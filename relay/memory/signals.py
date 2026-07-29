"""What counts as something worth learning from.

Kept apart from `store.py` (which only stores) and from the daemon (which
only orchestrates) because this is a *policy* question: which of the hundreds
of things Relay does in a day are worth noticing?

The answer is deliberately: very few. An allowlist, not a filter.

Recording every tool call would fill the observation table with noise, and
noise is exactly how a memory system ends up "polluted with random
assumptions". A signal earns a place here only if repeating it three times
plausibly means something — "Discord belongs on workspace 2" is a preference;
"listed the windows again" is not.

Signals record *intent*, not outcome. If the same thing is asked for three
times it is a pattern whether or not it worked.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

# Strip the mcp__server__ prefix before matching.
def _bare(tool_name: str) -> str:
    return tool_name.rsplit("__", 1)[-1] if tool_name.startswith("mcp__") else tool_name


def signal_for(tool_name: str, args: dict[str, Any]) -> tuple[str, str, str] | None:
    """Map a tool call to (pattern_key, content, kind), or None to ignore it.

    `pattern_key` is what makes repetition countable, so it must identify the
    *pattern* and not the instance: `app_workspace:discord` counts every time
    Discord is sent to a workspace, and the content records where it went.
    """
    name = _bare(tool_name)
    args = args or {}

    if name == "move_window_to_workspace":
        app = str(args.get("window_class") or "").strip().lower()
        workspace = args.get("workspace")
        if app and workspace is not None:
            return (
                f"app_workspace:{app}",
                f"{app.title()} belongs on workspace {workspace}.",
                "preference",
            )

    if name == "launch_app":
        app = str(args.get("command") or "").strip().lower()
        workspace = args.get("workspace")
        # Only interesting *with* a workspace. "Opens Discord sometimes" is
        # not a preference; "opens Discord on workspace 2" is.
        if app and workspace is not None:
            return (
                f"app_launch_workspace:{app}",
                f"{app.title()} is opened on workspace {workspace}.",
                "preference",
            )

    if name == "music_volume":
        percent = args.get("percent")
        if isinstance(percent, int):
            return (
                "music_volume_preference",
                f"Music volume is usually set to about {percent} percent.",
                "preference",
            )

    return None


def infer_scope(store, focused_window: str | None) -> str:
    """Which project the user appears to be working on right now.

    The ranking function already weights scope affinity
    (`search.scope_affinity`), so this is what turns that from inert into
    useful: Vice memories rank above general ones while a Vice window is
    focused.

    Deliberately timid. A *wrong* scope is worse than none, because it
    silently demotes the memories that would have been right, and nothing
    about the answer reveals that it happened. Anything unclear is "global".

    Project names come from the memories themselves, so the mapping is data
    rather than hardcoded strings: a scope like `project:vice` is only ever
    inferred because a memory already claims that scope.
    """
    if not focused_window:
        return "global"

    haystack = focused_window.lower()
    try:
        known = {m.scope for m in store.list(limit=500) if m.scope.startswith("project:")}
    except Exception:  # noqa: BLE001 - inference is optional
        return "global"

    # Longest name first, so `project:vice-web` wins over `project:vice`.
    for scope in sorted(known, key=len, reverse=True):
        name = scope.split(":", 1)[1].strip().lower()
        if len(name) >= 3 and name in haystack:
            return scope
    return "global"


_YES = {"yes", "yeah", "yep", "yup", "sure", "ok", "okay", "please do",
        "go ahead", "do it", "correct", "right", "affirmative", "sounds good"}
_NO = {"no", "nope", "nah", "don't", "dont", "no thanks", "leave it",
       "forget it", "negative", "never mind", "nevermind"}


def yes_or_no(text: str) -> bool | None:
    """Is this a clear yes, a clear no, or neither?

    Neither is the common case and must stay the safe one: a command that
    merely *starts* with "yeah" is still a command, and treating it as an
    answer would both store the wrong thing and swallow the request.
    """
    cleaned = text.strip().lower().rstrip(".!?")
    # "yes please" and "no thanks" are answers, not commands.
    for filler in (" please", " thanks", " thank you"):
        if cleaned.endswith(filler):
            cleaned = cleaned[: -len(filler)].strip()
    for prefix in ("yes ", "no ", "yeah ", "sure "):
        # "yes please" is an answer; "yes open discord" is a command.
        if cleaned.startswith(prefix) and len(cleaned.split()) > 2:
            return None
    if cleaned in _YES:
        return True
    if cleaned in _NO:
        return False
    return None


def record(store, tool_name: str, args: dict[str, Any]) -> None:
    """Note a signal, if this call is one. Never raises.

    Learning is a nicety; failing to learn must never cost the user the
    action they actually asked for.
    """
    try:
        signal = signal_for(tool_name, args)
        if signal is None:
            return
        pattern_key, content, kind = signal
        observation = store.observe(pattern_key, content, kind=kind)
        log.debug("observed %s (%d occurrence(s))", pattern_key, observation.occurrences)
    except Exception:  # noqa: BLE001
        log.debug("could not record a signal for %s", tool_name, exc_info=True)

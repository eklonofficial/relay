"""Answer common commands locally, without calling the model.

At roughly 8,000 tokens of context per turn drawn from the same plan allowance
as the user's own Claude conversations, "open Discord" should not cost a model
call. This matches a small set of unambiguous commands and executes them
directly.

Two rules keep it safe:

1. **It only ever handles AUTO-tier actions.** Anything that would need
   confirmation goes to the model, so it passes through the permission hook
   like everything else. The fast path can never bypass a gate.

2. **It falls through whenever it isn't sure.** An app name that doesn't
   resolve to a real application, an unrecognised phrasing, or anything with
   extra clauses goes to the model. Guessing wrong is worse than spending a
   turn.

Every pattern is anchored at both ends, which is what stops a keyword inside a
larger request being hijacked: "pause" matches, "pause the music and tell me
what time it is" does not, because the trailing clause leaves nothing for `$`
to match against. Filler like "could you" and a trailing "please" are stripped
first, so ordinary politeness still matches, but any *substantive* extra
clause sends the whole utterance to the model.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any

from relay.memory.store import MemoryStore
from relay.permissions import Tier, classify

log = logging.getLogger(__name__)


@dataclass(slots=True)
class FastResult:
    text: str
    action: str


# Words people use for an app whose actual binary is recorded in system_facts.
ROLE_WORDS = {
    "browser": "browser", "web browser": "browser", "internet": "browser",
    "editor": "editor", "code editor": "editor", "ide": "editor",
    "terminal": "terminal", "shell": "terminal", "console": "terminal",
    "file manager": "file_manager", "files": "file_manager",
    "music": "music", "music player": "music", "spotify": "music",
    "chat": "chat", "messages": "chat",
}

# Filler that carries no meaning for these commands.
_FILLER = re.compile(
    r"^(please|could you|can you|would you|hey|ok|okay|now|just)\s+", re.IGNORECASE
)
_TRAILING = re.compile(r"\s*(please|for me|thanks|thank you)[.!]?$", re.IGNORECASE)

_NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
}

LAUNCH = re.compile(
    r"^(?:open|launch|start|run|fire up)\s+(?P<app>.+?)"
    r"(?:\s+on\s+workspace\s+(?P<workspace>\w+))?$",
    re.IGNORECASE,
)
FOCUS = re.compile(
    r"^(?:focus|switch to|go to|show me|bring up)\s+(?P<app>.+?)$", re.IGNORECASE
)
MOVE = re.compile(
    r"^(?:move|put|send)\s+(?P<app>.+?)\s+(?:to|on|onto)\s+workspace\s+(?P<workspace>\w+)$",
    re.IGNORECASE,
)
SWITCH_WORKSPACE = re.compile(
    r"^(?:(?:go to|switch to|show)\s+)?workspace\s+(?P<workspace>\w+)$", re.IGNORECASE
)
# ------------------------------------------------------------------ music
# Transport control is the ideal fast-path case: fixed phrasing, no arguments
# to resolve, and frequent. "play <something>" is deliberately NOT here --
# resolving a name needs an Apple Music catalogue search, so it goes to the
# model. Bare "play" and "resume" only mean "un-pause".
MUSIC_PAUSE = re.compile(
    r"^(?:pause|stop)(?:\s+(?:the\s+)?(?:music|song|track|playback|it))?$",
    re.IGNORECASE,
)
MUSIC_RESUME = re.compile(
    r"^(?:play|resume|unpause|continue)(?:\s+(?:the\s+)?(?:music|song|track|playback|it))?$",
    re.IGNORECASE,
)
MUSIC_NEXT = re.compile(
    r"^(?:next|skip)(?:\s+(?:this|it|song|track|the\s+song|the\s+track))?$",
    re.IGNORECASE,
)
MUSIC_PREVIOUS = re.compile(
    r"^(?:previous|go back|last song|last track|previous song|previous track)$",
    re.IGNORECASE,
)
MUSIC_NOW_PLAYING = re.compile(
    r"^(?:what(?:'s| is)?\s+(?:this\s+song|playing|this)|"
    r"what\s+song\s+is\s+this|who\s+is\s+this)$",
    re.IGNORECASE,
)
MUSIC_VOLUME = re.compile(
    r"^(?:set\s+)?volume\s+(?:to\s+)?(?P<percent>\d{1,3})(?:\s*percent)?$",
    re.IGNORECASE,
)

TIME = re.compile(r"^(?:what(?:'s| is)? the time|what time is it|time)\??$", re.IGNORECASE)
DATE = re.compile(r"^(?:what(?:'s| is)? (?:the )?date|what day is it)\??$", re.IGNORECASE)


def _application_dirs() -> list[Path]:
    """Everywhere a .desktop file might live, including Flatpak exports."""
    home = Path.home()
    data_home = Path(os.environ.get("XDG_DATA_HOME", home / ".local/share"))
    dirs = [data_home / "applications", Path("/usr/share/applications")]
    dirs += [Path(d) / "applications"
             for d in os.environ.get("XDG_DATA_DIRS", "").split(":") if d]
    dirs += [data_home / "flatpak/exports/share/applications",
             Path("/var/lib/flatpak/exports/share/applications")]
    return dirs


_NOT_A_WINDOW = re.compile(r"^(?:Terminal|NoDisplay|Hidden)\s*=\s*true\s*$", re.IGNORECASE | re.MULTILINE)


def _opens_a_window(entry: Path) -> bool:
    """Skip entries that don't put a window on screen: terminal-only tools
    (texinfo ships `info.desktop` with `Terminal=true`) and hidden ones."""
    try:
        return not _NOT_A_WINDOW.search(entry.read_text(errors="replace"))
    except OSError:
        return False


@lru_cache(maxsize=1)
def _desktop_entries() -> frozenset[str]:
    """Lower-cased .desktop basenames. Cached: this is on the hot path."""
    names: set[str] = set()
    for directory in _application_dirs():
        try:
            names.update(p.stem.lower() for p in directory.glob("*.desktop") if _opens_a_window(p))
        except OSError:
            continue
    return frozenset(names)


def has_desktop_entry(name: str) -> bool:
    """Does this look like something you can actually open a window of?

    Matches on a prefix boundary, because real entries are often decorated:
    Discord installs `discord-460807638964371468.desktop`.
    """
    name = name.lower()
    for entry in _desktop_entries():
        if entry == name or entry.startswith(f"{name}-") or entry.startswith(f"{name}."):
            return True
    return False


def ordinal(day: int) -> str:
    """1 -> '1st'. Spoken dates need the suffix; strftime has no such format."""
    if 11 <= day % 100 <= 13:
        return f"{day}th"
    return f"{day}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(day % 10, 'th') }"


# The transcript contains the wake word, because the recording starts just
# before it: "Relay, what time is it?" rather than "what time is it?".
# Every pattern below matches the command alone, so the address has to come
# off first — otherwise nothing ever matches and every spoken command goes to
# the model.
_WAKE_PREFIX = re.compile(
    r"^\s*(?:hey\s+|ok\s+|okay\s+)?"
    r"(relay|jarvis|alexa|computer)\b[\s,.!?:;-]*",
    re.IGNORECASE,
)


def strip_wake_word(text: str) -> str:
    return _WAKE_PREFIX.sub("", text, count=1).strip()


def normalise(text: str) -> str:
    text = strip_wake_word(text.strip())
    text = text.strip().rstrip("?.!")
    text = _FILLER.sub("", text)
    text = _TRAILING.sub("", text)
    return text.strip()


def parse_workspace(token: str | None) -> int | None:
    if not token:
        return None
    token = token.strip().lower()
    if token.isdigit():
        value = int(token)
    elif token in _NUMBER_WORDS:
        value = _NUMBER_WORDS[token]
    else:
        return None
    return value if 1 <= value <= 20 else None


class FastPath:
    """Local matcher. Returns None whenever the model should handle it."""

    def __init__(self, store: MemoryStore, *, enabled: bool = True) -> None:
        self.store = store
        self.enabled = enabled

    # ------------------------------------------------------------ resolving
    def resolve_app(self, phrase: str) -> str | None:
        """Turn what the user said into an executable name, or None.

        Returning None is the safe outcome: the model gets the utterance and
        can search memory or ask.
        """
        phrase = phrase.strip().lower()
        phrase = re.sub(r"^(?:my|the|a)\s+", "", phrase)
        if not phrase or len(phrase) > 40:
            return None

        # "my browser" -> whatever browser this machine actually uses.
        role = ROLE_WORDS.get(phrase)
        if role:
            recorded = self.store.get_fact(role)
            if recorded and shutil.which(recorded):
                return recorded
            return None

        # An explicitly recorded alias always wins.
        recorded = self.store.get_fact(f"app_{phrase.replace(' ', '_')}")
        if recorded and shutil.which(recorded):
            return recorded

        # Otherwise only accept it if it's a real, *graphical* application.
        # Multi-word phrases are almost never a command name, so don't guess.
        if " " in phrase:
            return None
        # "Is it on PATH?" is far too weak on its own. Plenty of ordinary
        # English words are also CLI tools -- date, info, look, chat, w --
        # so "show me the date" resolved to /usr/bin/date and tried to focus
        # a window belonging to it. Requiring a desktop entry separates
        # applications you can actually open from coreutils.
        if shutil.which(phrase) and has_desktop_entry(phrase):
            return phrase
        return None

    async def music_is_live(self) -> bool:
        """Is there a music player to control right now?

        A cheap local HTTP probe with a one-second timeout. Wrapped broadly
        because this only ever decides whether to *offer* a shortcut -- if
        anything at all goes wrong the answer is "no", and the model handles
        the utterance instead.
        """
        try:
            from relay.tools import music

            return await music.client().is_up()
        except Exception:  # noqa: BLE001
            return False

    # -------------------------------------------------------------- matching
    async def handle(
        self,
        utterance: str,
        *,
        run_tool: Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]],
    ) -> FastResult | None:
        """Try to answer locally. None means 'send it to the model'."""
        if not self.enabled:
            return None

        text = normalise(utterance)
        if not text:
            return None

        if TIME.match(text):
            return FastResult(datetime.now().strftime("It's %-I:%M %p."), "time")

        if DATE.match(text):
            now = datetime.now()
            return FastResult(
                f"It's {now:%A} the {ordinal(now.day)} of {now:%B}.", "date"
            )

        # --------------------------------------------------------- music
        # Unambiguous phrasings answer straight away: the tools report "Cider
        # isn't running" cheaply, and spending a model turn to say the same
        # thing would be worse.
        if MUSIC_PAUSE.match(text):
            return await self._act("mcp__music__music_pause", {}, run_tool, "music_pause")

        if MUSIC_NOW_PLAYING.match(text):
            return await self._act(
                "mcp__music__music_now_playing", {}, run_tool, "music_now_playing"
            )

        match = MUSIC_VOLUME.match(text)
        if match:
            return await self._act(
                "mcp__music__music_volume", {"percent": int(match.group("percent"))},
                run_tool, "music_volume",
            )

        # "next", "skip", "play" and "go back" are ordinary English as well as
        # music commands, so only claim them while something is actually
        # playing. Otherwise hand the utterance to the model, which has the
        # context to work out what was meant.
        for pattern, tool_name, action in (
            (MUSIC_NEXT, "mcp__music__music_next", "music_next"),
            (MUSIC_PREVIOUS, "mcp__music__music_previous", "music_previous"),
            (MUSIC_RESUME, "mcp__music__music_play", "music_play"),
        ):
            if pattern.match(text):
                if not await self.music_is_live():
                    log.debug("%r looks like music but nothing is playing", text)
                    return None
                return await self._act(tool_name, {}, run_tool, action)

        match = SWITCH_WORKSPACE.match(text)
        if match:
            workspace = parse_workspace(match.group("workspace"))
            if workspace is not None:
                return await self._act(
                    "mcp__desktop__switch_workspace", {"workspace": workspace},
                    run_tool, "switch_workspace",
                )

        match = MOVE.match(text)
        if match:
            workspace = parse_workspace(match.group("workspace"))
            app = self.resolve_app(match.group("app"))
            if workspace is not None and app:
                return await self._act(
                    "mcp__desktop__move_window_to_workspace",
                    {"workspace": workspace, "window_class": app},
                    run_tool, "move_window",
                )

        match = LAUNCH.match(text)
        if match:
            app = self.resolve_app(match.group("app"))
            workspace = parse_workspace(match.group("workspace"))
            if app:
                args: dict[str, Any] = {"command": app}
                if workspace is not None:
                    args["workspace"] = workspace
                return await self._act(
                    "mcp__desktop__launch_app", args, run_tool, "launch_app"
                )

        match = FOCUS.match(text)
        if match:
            app = self.resolve_app(match.group("app"))
            if app:
                return await self._act(
                    "mcp__desktop__focus_window", {"window_class": app},
                    run_tool, "focus_window",
                )

        return None

    async def _act(self, tool_name: str, args: dict[str, Any], run_tool, action: str):
        """Execute, but only if the action is auto-tier.

        The fast path must never do something the permission hook would have
        gated, so the same classifier decides here too.
        """
        tier, _reason = classify(tool_name, args)
        if tier != Tier.AUTO:
            log.debug("fast path declining %s (%s tier); deferring to model", tool_name, tier)
            return None

        result = await run_tool(tool_name, args)
        text = result["content"][0]["text"]
        if result.get("is_error"):
            # A failure here often means the model could do better — e.g. the
            # window isn't open and it should be launched instead.
            log.debug("fast path tool failed, deferring to model: %s", text)
            return None
        return FastResult(text, action)

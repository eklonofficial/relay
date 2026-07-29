"""`relay docs` — read the guide without leaving the terminal."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent.parent / "docs"

TOPICS = {
    "guide": ("guide.md", "How Relay works, usage, and troubleshooting"),
    "cost": ("cost-findings.md", "What a turn costs and how usage is measured"),
    "hyprland": ("hyprland-dispatch.md", "The Hyprland 0.55 dispatch API change"),
}


def available() -> dict[str, tuple[Path, str]]:
    found = {}
    for topic, (filename, description) in TOPICS.items():
        path = DOCS_DIR / filename
        if path.exists():
            found[topic] = (path, description)
    return found


def show(topic: str = "guide", *, section: str | None = None, plain: bool = False) -> int:
    docs = available()
    if topic not in docs:
        print(f"No such topic '{topic}'. Available: {', '.join(docs) or 'none'}")
        return 1

    path, _ = docs[topic]
    text = path.read_text()

    if section:
        text = _extract(text, section)
        if text is None:
            print(f"No section matching '{section}' in {path.name}.")
            return 1

    if plain or not sys.stdout.isatty():
        print(text)
        return 0

    return _page(_render(text))


def _render(text: str) -> str:
    """Markdown to styled terminal text, or plain text if rich isn't there."""
    try:
        from rich.console import Console
        from rich.markdown import Markdown
    except ImportError:
        return text

    # force_terminal because output is captured to a string rather than
    # written to the tty, so rich would otherwise strip all the styling it
    # was asked for. Width is capped: full-width prose on an ultrawide
    # monitor is unreadable.
    width = min(100, shutil.get_terminal_size(fallback=(100, 24)).columns)
    console = Console(force_terminal=True, width=width)
    with console.capture() as captured:
        # rich's default code theme (monokai) paints a hard #272822 block
        # behind every fenced example, which fights whatever background the
        # terminal actually has. "ansi_dark" uses the terminal's own palette
        # instead, so code blocks sit on the page rather than on a slab.
        console.print(Markdown(text, code_theme="ansi_dark",
                               inline_code_theme="ansi_dark"))
    return captured.get()


def _page(rendered: str) -> int:
    """Show styled text through a pager that won't mangle it.

    `rich`'s own `console.pager(styles=True)` writes ANSI escapes into
    whatever `pydoc` picks, which is `less` *without* `-R`. less then prints
    every escape sequence literally and the page becomes an unreadable wall
    of `ESC[38;2;248;248;242m`. So the pager is chosen here instead, and
    `-R` is never optional.
    """
    pager = os.environ.get("PAGER")
    if pager:
        argv = pager.split()
        # Respect the user's choice, but don't let a bare `less` mangle it.
        if argv and Path(argv[0]).name == "less" and not any(
            flag.startswith("-") and "R" in flag for flag in argv[1:]
        ):
            argv.append("-R")
    elif shutil.which("less"):
        #  -R  pass colour through
        #  -F  don't page at all if it fits on one screen
        #  -X  don't wipe the screen on exit, so short pages stay readable
        argv = ["less", "-RFX"]
    else:
        print(rendered)
        return 0

    try:
        proc = subprocess.run(argv, input=rendered, text=True, check=False)
    except OSError:
        print(rendered)
        return 0
    return proc.returncode


def _extract(text: str, needle: str) -> str | None:
    """Pull out the heading whose title matches, plus everything under it."""
    needle = needle.lower()
    lines = text.splitlines()
    start = None
    level = 0
    for i, line in enumerate(lines):
        if line.startswith("#") and needle in line.lower():
            start = i
            level = len(line) - len(line.lstrip("#"))
            break
    if start is None:
        return None
    for j in range(start + 1, len(lines)):
        line = lines[j]
        if line.startswith("#"):
            if len(line) - len(line.lstrip("#")) <= level:
                return "\n".join(lines[start:j])
    return "\n".join(lines[start:])


def list_topics() -> str:
    docs = available()
    if not docs:
        return "No documentation found."
    width = max(len(t) for t in docs)
    lines = ["Topics (relay docs <topic>):"]
    lines += [f"  {topic:<{width}}  {desc}" for topic, (_, desc) in docs.items()]
    lines.append("\nJump to a section:  relay docs --section troubleshooting")
    return "\n".join(lines)

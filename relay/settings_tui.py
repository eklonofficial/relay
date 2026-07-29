"""`relay settings` — a curses control panel.

curses rather than a TUI framework: it's in the standard library, works over
SSH, and this screen is a list and an edit box. All validation lives in
settings.py so it can be tested without a terminal.
"""

from __future__ import annotations

import curses
from typing import Any

from relay import config as config_mod
from relay import settings as settings_mod
from relay.paths import PATHS

HELP = "up/down move   enter edit   s save   r reload   q quit"


class SettingsScreen:
    def __init__(self) -> None:
        self.cfg = config_mod.load()
        self.fields = settings_mod.FIELDS
        self.index = 0
        self.message = ""
        self.dirty = False

    # ------------------------------------------------------------- drawing
    def draw(self, screen) -> None:
        screen.erase()
        height, width = screen.getmaxyx()

        title = " Relay settings "
        if self.dirty:
            title += "(unsaved) "
        screen.attron(curses.A_REVERSE)
        screen.addstr(0, 0, title.ljust(width - 1)[: width - 1])
        screen.attroff(curses.A_REVERSE)

        row = 2
        section = None
        for i, field in enumerate(self.fields):
            if row >= height - 5:
                break
            if field.section != section:
                section = field.section
                if row < height - 5:
                    screen.attron(curses.A_BOLD)
                    screen.addstr(row, 2, section.upper()[: width - 4])
                    screen.attroff(curses.A_BOLD)
                    row += 1

            value = settings_mod.display(field, settings_mod.get_value(self.cfg, field.path))
            line = f"  {field.label:<28} {value}"
            if i == self.index:
                screen.attron(curses.A_REVERSE)
                screen.addstr(row, 2, line.ljust(width - 5)[: width - 5])
                screen.attroff(curses.A_REVERSE)
            else:
                screen.addstr(row, 2, line[: width - 5])
            row += 1

        # Help for the selected field, wrapped.
        current = self.fields[self.index]
        row = min(row + 1, height - 4)
        for chunk in _wrap(current.help, width - 6)[:2]:
            if row < height - 2:
                screen.addstr(row, 3, chunk[: width - 5], curses.A_DIM)
                row += 1

        if self.message and height > 2:
            screen.addstr(height - 2, 2, self.message[: width - 4], curses.A_BOLD)
        screen.addstr(height - 1, 2, HELP[: width - 4], curses.A_DIM)
        screen.refresh()

    # ------------------------------------------------------------- editing
    def edit(self, screen) -> None:
        field = self.fields[self.index]
        height, width = screen.getmaxyx()
        current = settings_mod.get_value(self.cfg, field.path)

        if field.kind == "bool":
            settings_mod.set_value(self.cfg, field.path, not current)
            self.dirty = True
            self.message = f"{field.label}: {'yes' if not current else 'no'}"
            return

        if field.kind == "choice":
            choices = list(field.choices)
            nxt = choices[(choices.index(str(current)) + 1) % len(choices)] \
                if str(current) in choices else choices[0]
            settings_mod.set_value(self.cfg, field.path, nxt)
            self.dirty = True
            self.message = f"{field.label}: {nxt}"
            return

        prompt = f"{field.label} = "
        screen.addstr(height - 3, 2, " " * (width - 4))
        screen.addstr(height - 3, 2, prompt)
        curses.echo()
        curses.curs_set(1)
        try:
            raw = screen.getstr(height - 3, 2 + len(prompt), 120).decode(errors="replace")
        finally:
            curses.noecho()
            curses.curs_set(0)

        if not raw.strip():
            self.message = "unchanged"
            return
        try:
            settings_mod.set_value(self.cfg, field.path, settings_mod.parse(field, raw))
            self.dirty = True
            self.message = f"{field.label} set"
        except settings_mod.ValidationError as exc:
            self.message = f"{field.label}: {exc}"

    # ---------------------------------------------------------------- loop
    def run(self, screen) -> None:
        curses.curs_set(0)
        screen.keypad(True)
        while True:
            self.draw(screen)
            try:
                key = screen.getch()
            except KeyboardInterrupt:
                break

            if key in (curses.KEY_DOWN, ord("j")):
                self.index = (self.index + 1) % len(self.fields)
                self.message = ""
            elif key in (curses.KEY_UP, ord("k")):
                self.index = (self.index - 1) % len(self.fields)
                self.message = ""
            elif key in (curses.KEY_ENTER, 10, 13):
                self.edit(screen)
            elif key in (ord("s"), ord("S")):
                path = settings_mod.save(self.cfg)
                self.dirty = False
                self.message = f"saved to {path} — restart relayd to apply"
            elif key in (ord("r"), ord("R")):
                self.cfg = config_mod.load()
                self.dirty = False
                self.message = "reloaded from disk"
            elif key in (ord("q"), ord("Q"), 27):
                if self.dirty:
                    self.message = "unsaved changes — press s to save, or q again to discard"
                    self.dirty = False
                    continue
                break


def main() -> int:
    screen = SettingsScreen()
    try:
        curses.wrapper(screen.run)
    except curses.error as exc:
        print(f"settings needs an interactive terminal ({exc})")
        return 1
    print(f"config: {PATHS.config_file}")
    return 0


def _wrap(text: str, width: int) -> list[str]:
    words, lines, line = text.split(), [], ""
    for word in words:
        if len(line) + len(word) + 1 > width:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return lines


def render_plain() -> str:
    """Non-interactive listing, for `relay settings --list`."""
    cfg = config_mod.load()
    out, section = [], None
    for field in settings_mod.FIELDS:
        if field.section != section:
            section = field.section
            out.append(f"\n[{section}]")
        value = settings_mod.display(field, settings_mod.get_value(cfg, field.path))
        out.append(f"  {field.label:<30} {value}")
        out.append(f"      {field.help}")
    return "\n".join(out).strip()


if __name__ == "__main__":
    raise SystemExit(main())

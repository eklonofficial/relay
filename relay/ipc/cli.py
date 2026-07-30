"""The `relay` command."""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any

from relay.ipc import protocol
from relay.paths import PATHS


async def send(command: str, args: dict[str, Any], *, assume_yes: bool = False) -> int:
    """Send one command to relayd and stream the reply."""
    try:
        reader, writer = await asyncio.open_unix_connection(str(PATHS.socket))
    except (FileNotFoundError, ConnectionRefusedError):
        print("relayd is not running. Start it with `relayd`.", file=sys.stderr)
        return 3

    writer.write(protocol.encode(protocol.message(protocol.COMMAND, command=command, args=args)))
    await writer.drain()

    exit_code = 0
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            message = protocol.decode(line)
            kind = message.get("type")

            if kind == protocol.TEXT:
                print(message.get("text", ""))
            elif kind == protocol.INFO:
                print(message.get("text", ""))
            elif kind == protocol.ERROR:
                print(message.get("text", ""), file=sys.stderr)
                exit_code = 1
            elif kind == protocol.CONFIRM:
                approved = assume_yes or _prompt(message.get("text", "proceed?"))
                writer.write(protocol.encode(protocol.message(
                    protocol.CONFIRM_REPLY, token=message.get("token"), approved=approved
                )))
                await writer.drain()
            elif kind == protocol.DONE:
                break
    finally:
        writer.close()
    return exit_code


def _prompt(description: str) -> bool:
    if not sys.stdin.isatty():
        print(f"[declined, not a terminal] {description}", file=sys.stderr)
        return False
    try:
        answer = input(f"\nRelay wants to {description}. Allow? [y/N] ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        return False
    return answer in ("y", "yes")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="relay", description="Talk to relayd")
    parser.add_argument("-y", "--yes", action="store_true",
                        help="approve confirmation prompts automatically")
    sub = parser.add_subparsers(dest="command", required=True)

    settings = sub.add_parser("settings", help="interactive settings panel")
    settings.add_argument("--list", action="store_true", help="print settings and exit")

    docs = sub.add_parser("docs", help="read the documentation")
    docs.add_argument("topic", nargs="?", default="guide")
    docs.add_argument("--section", help="jump to a heading, e.g. troubleshooting")
    docs.add_argument("--list", action="store_true", help="list topics")
    docs.add_argument("--plain", action="store_true", help="no pager or styling")

    install = sub.add_parser("install-service",
                             help="run Relay under systemd, starting at login")
    install.add_argument("--no-start", action="store_true",
                         help="install and enable, but don't start it now")
    sub.add_parser("uninstall-service", help="remove the systemd service")
    sub.add_parser("service", help="show the systemd service state")

    sub.add_parser("status", help="daemon, model, plan usage")
    sub.add_parser("ping", help="check the daemon is alive")
    sub.add_parser("listen", help="push-to-talk: take a command now, no wake word")
    sub.add_parser("abort", help="stop speaking and drop the current turn")
    sub.add_parser("usage", help="token usage and plan utilisation")

    ask = sub.add_parser("ask", help="send a request, as if spoken")
    ask.add_argument("text", nargs="+")

    mode = sub.add_parser("mode", help="show or set normal / dry-run")
    mode.add_argument("mode", nargs="?", choices=["normal", "dry-run", "dry_run"])

    say = sub.add_parser("say", help="speak a line out loud")
    say.add_argument("text", nargs="+")

    tier = sub.add_parser("tier", help="show or force the power tier")
    tier.add_argument("tier", nargs="?", choices=["full", "lite", "sleep", "auto"])

    sub.add_parser("devices", help="list audio input devices")

    mic = sub.add_parser("mic", help="live microphone and wake-word diagnostics")
    mic.add_argument("--reset", action="store_true", help="reset peak counters")

    voice = sub.add_parser("voice", help="choose Relay's voice, by ear")
    voice.add_argument("--list", action="store_true",
                       help="print the voices instead of opening the picker")

    overlay = sub.add_parser(
        "overlay", help="show the orb's status, or drive it by hand")
    overlay.add_argument(
        "state", nargs="?",
        choices=["waking", "listening", "thinking", "speaking", "idle", "status"],
        help="force a state, for tuning the animation without speaking")
    overlay.add_argument(
        "--scrub", type=float, metavar="0..1",
        help="hold the pull-out at one point (0 = in the bezel, 1 = formed). "
             "The whole separation lasts half a second, which is shorter than "
             "a screenshot takes")

    backup = sub.add_parser(
        "backup", help="push memories and the trained wake word to GitHub")
    backup.add_argument("-m", "--message", help="commit message")
    backup.add_argument("--dry-run", action="store_true",
                        help="update backup/ but don't commit or push")

    sub.add_parser("profile", help="what Relay knows about you")

    facts = sub.add_parser("facts", help="what Relay knows about this machine")
    facts.add_argument("--category")

    memory = sub.add_parser("memory", help="inspect stored memory")
    memory_sub = memory.add_subparsers(dest="action", required=True)
    memory_list = memory_sub.add_parser("list")
    memory_list.add_argument("--scope")
    memory_list.add_argument("--limit", type=int, default=30)
    memory_search = memory_sub.add_parser("search")
    memory_search.add_argument("query", nargs="+")
    memory_forget = memory_sub.add_parser("forget")
    memory_forget.add_argument("memory_id", type=int)
    memory_restore = memory_sub.add_parser("restore", help="undo a forget")
    memory_restore.add_argument("memory_id", type=int)
    memory_review = memory_sub.add_parser(
        "review", help="patterns Relay noticed and wants to confirm")
    memory_review.add_argument("--approve", type=int, metavar="ID")
    memory_review.add_argument("--dismiss", type=int, metavar="ID")
    memory_convos = memory_sub.add_parser("conversations",
                                          help="what Relay has talked about")
    memory_convos.add_argument("--limit", type=int, default=20)
    memory_sub.add_parser("reindex")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    ns = parser.parse_args(argv)

    # These two are local tools, not daemon commands: they have to work when
    # relayd isn't running, which is exactly when you need the docs.
    if ns.command == "settings":
        from relay import settings_tui

        if ns.list:
            print(settings_tui.render_plain())
            return 0
        return settings_tui.main()

    # Local too. It has to load the speech model and play audio itself, and
    # it is useful before the daemon has ever run.
    if ns.command == "voice":
        from relay import voice_tui, voices as voices_mod
        from relay.paths import PATHS as _paths

        if ns.list:
            found = voices_mod.available(_paths.models)
            if not found:
                print("No voices are installed.", file=sys.stderr)
                return 1
            for v in found:
                print(f"{v.id:<16} {v.name:<14} {v.label}")
            return 0
        return voice_tui.main()

    # Local, like settings and docs: backing up is exactly what you want to
    # still work when the daemon won't start.
    if ns.command == "backup":
        from relay import backup as backup_mod

        code, lines = backup_mod.push(message=ns.message, dry_run=ns.dry_run)
        for line in lines:
            print(line, file=sys.stderr if code else sys.stdout)
        return code

    if ns.command in ("install-service", "uninstall-service", "service"):
        from relay import service as service_mod

        if ns.command == "service":
            print(service_mod.status())
            return 0
        if ns.command == "uninstall-service":
            code, notes = service_mod.uninstall()
        else:
            code, notes = service_mod.install(start=not ns.no_start)
        for note in notes:
            print(note, file=sys.stderr if code else sys.stdout)
        return code

    if ns.command == "docs":
        from relay import docs as docs_mod

        if ns.list:
            print(docs_mod.list_topics())
            return 0
        return docs_mod.show(ns.topic, section=ns.section, plain=ns.plain)

    command = ns.command
    args: dict[str, Any] = {}

    if command == "ask":
        args["text"] = " ".join(ns.text)
    elif command == "say":
        args["text"] = " ".join(ns.text)
    elif command == "mic":
        args["reset"] = ns.reset
    elif command == "overlay":
        args["state"] = ns.state or ""
        if ns.scrub is not None:
            args["scrub"] = ns.scrub
    elif command == "tier":
        args["tier"] = ns.tier or ""
    elif command == "mode":
        args["mode"] = (ns.mode or "").replace("-", "_")
    elif command == "facts":
        args["category"] = ns.category
    elif command == "memory":
        args["action"] = ns.action
        for field in ("scope", "limit", "memory_id", "approve", "dismiss"):
            if hasattr(ns, field):
                args[field] = getattr(ns, field)
        if getattr(ns, "query", None):
            args["query"] = " ".join(ns.query)

    return asyncio.run(send(command, args, assume_yes=ns.yes))


if __name__ == "__main__":
    raise SystemExit(main())

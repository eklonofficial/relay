"""Desktop control: Hyprland windows and workspaces, plus launching apps.

Window management goes through hyprctl rather than the screen. It's
deterministic, instant, and can't misidentify a button — the screenshot loop
is a fallback for applications with no other interface, not the default.
"""

from __future__ import annotations

import json
import shutil
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from relay.tools import hypr
from relay.tools.base import ctx, fail, integer, ok, run, schema, string


async def _hyprctl_json(*args: str) -> tuple[Any | None, str | None]:
    code, out, err = await run("hyprctl", "-j", *args)
    if code != 0:
        return None, err.strip() or f"hyprctl {' '.join(args)} failed"
    try:
        return json.loads(out), None
    except json.JSONDecodeError as exc:
        return None, f"could not parse hyprctl output: {exc}"


def _describe(client: dict[str, Any]) -> str:
    workspace = (client.get("workspace") or {}).get("id", "?")
    title = (client.get("title") or "")[:60]
    flags = []
    if client.get("floating"):
        flags.append("floating")
    if client.get("fullscreen"):
        flags.append("fullscreen")
    suffix = f" [{', '.join(flags)}]" if flags else ""
    return f"{client.get('class') or 'unknown'} — ws{workspace} — {title}{suffix}"


# ------------------------------------------------------------------ windows
@tool(
    "list_windows",
    "List open windows with their class, workspace and title.",
    schema({"workspace": integer("Only windows on this workspace")}),
)
async def list_windows(args: dict[str, Any]) -> dict[str, Any]:
    clients, err = await _hyprctl_json("clients")
    if err:
        return fail(err)
    wanted = args.get("workspace")
    if wanted is not None:
        clients = [c for c in clients if (c.get("workspace") or {}).get("id") == int(wanted)]
    if not clients:
        return ok("No windows open." if wanted is None else f"Nothing on workspace {wanted}.")
    return ok("\n".join(_describe(c) for c in clients))


@tool(
    "active_window",
    "The window that currently has focus.",
    schema({}),
)
async def active_window(_args: dict[str, Any]) -> dict[str, Any]:
    client, err = await _hyprctl_json("activewindow")
    if err:
        return fail(err)
    if not client or not client.get("class"):
        return ok("Nothing is focused.")
    return ok(_describe(client))


@tool(
    "list_workspaces",
    "List workspaces and how many windows are on each.",
    schema({}),
)
async def list_workspaces(_args: dict[str, Any]) -> dict[str, Any]:
    workspaces, err = await _hyprctl_json("workspaces")
    if err:
        return fail(err)
    active, _ = await _hyprctl_json("activeworkspace")
    active_id = (active or {}).get("id")
    rows = sorted(workspaces, key=lambda w: w.get("id", 0))
    lines = [
        f"{'*' if w.get('id') == active_id else ' '} workspace {w.get('id')}: "
        f"{w.get('windows', 0)} window(s)"
        for w in rows
    ]
    return ok("\n".join(lines) or "No workspaces.")


@tool(
    "focus_window",
    "Focus a window by its class, e.g. 'discord' or 'zen'.",
    schema({"window_class": string("Window class, case-insensitive substring")},
           required=["window_class"]),
)
async def focus_window(args: dict[str, Any]) -> dict[str, Any]:
    target = args["window_class"].lower()
    clients, err = await _hyprctl_json("clients")
    if err:
        return fail(err)
    match = next((c for c in clients if target in (c.get("class") or "").lower()), None)
    if match is None:
        return fail(f"No open window matching '{args['window_class']}'.")
    good, message = await hypr.focus_window(match["address"])
    return ok(f"Focused {match.get('class')}.") if good else fail(message)


@tool(
    "move_window_to_workspace",
    "Move a window to a workspace. Moves the focused window if no class given.",
    schema({
        "workspace": integer("Target workspace number"),
        "window_class": string("Which window to move; default the focused one"),
    }, required=["workspace"]),
)
async def move_window_to_workspace(args: dict[str, Any]) -> dict[str, Any]:
    workspace = int(args["workspace"])
    window_class = args.get("window_class")

    if window_class:
        clients, err = await _hyprctl_json("clients")
        if err:
            return fail(err)
        match = next(
            (c for c in clients if window_class.lower() in (c.get("class") or "").lower()), None
        )
        if match is None:
            return fail(f"No open window matching '{window_class}'.")
        good, message = await hypr.move_window_to_workspace(workspace, match["address"])
        label = match.get("class")
    else:
        good, message = await hypr.move_window_to_workspace(workspace)
        label = "the focused window"

    return ok(f"Moved {label} to workspace {workspace}.") if good else fail(message)


@tool(
    "switch_workspace",
    "Switch to a workspace.",
    schema({"workspace": integer("Workspace number")}, required=["workspace"]),
)
async def switch_workspace(args: dict[str, Any]) -> dict[str, Any]:
    good, message = await hypr.switch_workspace(int(args["workspace"]))
    return ok(f"On workspace {args['workspace']}.") if good else fail(message)


@tool(
    "close_window",
    "Close a window by class, or the focused one if no class is given.",
    schema({"window_class": string("Which window to close")}),
)
async def close_window(args: dict[str, Any]) -> dict[str, Any]:
    window_class = args.get("window_class")
    if not window_class:
        good, message = await hypr.close_window()
        return ok("Closed the focused window.") if good else fail(message)

    clients, err = await _hyprctl_json("clients")
    if err:
        return fail(err)
    match = next(
        (c for c in clients if window_class.lower() in (c.get("class") or "").lower()), None
    )
    if match is None:
        return fail(f"No open window matching '{window_class}'.")
    good, message = await hypr.close_window(match["address"])
    return ok(f"Closed {match.get('class')}.") if good else fail(message)


@tool(
    "toggle_floating",
    "Toggle floating for the focused window.",
    schema({}),
)
async def toggle_floating(_args: dict[str, Any]) -> dict[str, Any]:
    good, message = await hypr.toggle_floating()
    return ok("Toggled floating.") if good else fail(message)


@tool(
    "fullscreen_window",
    "Toggle fullscreen for the focused window.",
    schema({}),
)
async def fullscreen_window(_args: dict[str, Any]) -> dict[str, Any]:
    good, message = await hypr.toggle_fullscreen()
    return ok("Toggled fullscreen.") if good else fail(message)


# --------------------------------------------------------------------- apps
@tool(
    "launch_app",
    "Start an application by command name. Check system_fact first when the "
    "user says 'my browser' or 'my editor' — the right binary is recorded there.",
    schema({
        "command": string("Executable name, e.g. 'discord' or 'zen-browser'"),
        "workspace": integer("Optionally open it on this workspace"),
    }, required=["command"]),
)
async def launch_app(args: dict[str, Any]) -> dict[str, Any]:
    command = args["command"].strip()
    # Only ever an executable name, never a shell string — no user text reaches
    # a shell through this path.
    if not command or any(ch in command for ch in ";|&$`<>\n"):
        return fail("That doesn't look like a plain command name.")
    if shutil.which(command) is None:
        return fail(f"'{command}' is not installed or not on PATH.")

    workspace = args.get("workspace")
    if workspace is not None:
        good, message = await hypr.exec_command(command, workspace=int(workspace))
        return ok(f"Launched {command} on workspace {workspace}.") if good else fail(message)

    good, message = await hypr.exec_command(command)
    return ok(f"Launched {command}.") if good else fail(message)


@tool(
    "is_running",
    "Check whether an application is currently running.",
    schema({"name": string("Process or window class name")}, required=["name"]),
)
async def is_running(args: dict[str, Any]) -> dict[str, Any]:
    name = args["name"].lower()
    clients, err = await _hyprctl_json("clients")
    if not err and clients:
        for client in clients:
            if name in (client.get("class") or "").lower():
                workspace = (client.get("workspace") or {}).get("id")
                return ok(f"Yes — {client.get('class')} is open on workspace {workspace}.")

    # `pgrep -f` matches against whole command lines, which includes the
    # command doing the asking — searching for "foo" reliably finds the very
    # shell that passed "foo" as an argument, so everything looks like it's
    # running. `-x` matches the executable name exactly instead.
    code, out, _ = await run("pgrep", "-x", args["name"])
    if code == 0 and out.strip():
        return ok(f"{args['name']} is running, but has no window open.")
    return ok(f"{args['name']} is not running.")


TOOLS = [
    list_windows, active_window, list_workspaces, focus_window,
    move_window_to_workspace, switch_workspace, close_window,
    toggle_floating, fullscreen_window, launch_app, is_running,
]

TOOL_NAMES = [f"mcp__desktop__{t.name}" for t in TOOLS]


def server():
    return create_sdk_mcp_server(name="desktop", version="1.0.0", tools=TOOLS)

"""Hyprland dispatch, adapted to whichever API this version speaks.

Hyprland 0.55 replaced the flat dispatch strings with a Lua surface:
``hyprctl dispatch workspace 2`` became ``hl.dsp.focus({workspace = 2})``,
and the old form now fails with a Lua syntax error rather than anything
recognisable. Since that has already changed once, Relay detects the dialect
at startup instead of hardcoding either.

Detected once per process, then cached.
"""

from __future__ import annotations

import logging

from relay.tools.base import run

log = logging.getLogger(__name__)

LEGACY = "legacy"   # hyprctl dispatch workspace 2
LUA = "lua"         # hyprctl dispatch 'hl.dsp.focus({workspace = 2})'

_dialect: str | None = None


def lua_string(value: str) -> str:
    """Quote a Lua string literal safely."""
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


async def detect_dialect(force: bool = False) -> str:
    """Work out which dispatch syntax this Hyprland understands."""
    global _dialect
    if _dialect is not None and not force:
        return _dialect

    # no_op exists in both worlds and changes nothing, so it's a safe probe.
    code, out, err = await run("hyprctl", "dispatch", "hl.dsp.no_op()")
    combined = (out + err).lower()
    _dialect = LUA if code == 0 and "error" not in combined else LEGACY
    log.info("hyprland dispatch dialect: %s", _dialect)
    return _dialect


async def dispatch(*args: str) -> tuple[bool, str]:
    """Run a raw dispatch and normalise the result.

    hyprctl reports failures on stdout with a zero exit code, so the text has
    to be inspected rather than trusting the return code.
    """
    code, out, err = await run("hyprctl", "dispatch", *args)
    text = (out + err).strip()
    if code != 0 or text.lower().startswith("error") or "error:" in text.lower():
        return False, text or "dispatch failed"
    return True, text


async def switch_workspace(workspace: int) -> tuple[bool, str]:
    if await detect_dialect() == LUA:
        return await dispatch(f"hl.dsp.focus({{workspace = {workspace}}})")
    return await dispatch("workspace", str(workspace))


async def focus_window(address: str) -> tuple[bool, str]:
    if await detect_dialect() == LUA:
        selector = lua_string(f"address:{address}")
        return await dispatch(f"hl.dsp.focus({{window = {selector}}})")
    return await dispatch("focuswindow", f"address:{address}")


async def move_window_to_workspace(workspace: int, address: str | None = None) -> tuple[bool, str]:
    """Move a window to a workspace.

    In the Lua dialect the move dispatcher acts on the focused window, so a
    targeted move is focus-then-move. That shifts focus as a side effect,
    which matches what someone means by "put Discord on workspace 2".
    """
    if await detect_dialect() == LUA:
        if address:
            good, message = await focus_window(address)
            if not good:
                return good, message
        return await dispatch(f"hl.dsp.window.move({{workspace = {workspace}}})")

    if address:
        return await dispatch("movetoworkspacesilent", f"{workspace},address:{address}")
    return await dispatch("movetoworkspace", str(workspace))


async def exec_command(command: str, workspace: int | None = None) -> tuple[bool, str]:
    payload = f"[workspace {workspace} silent] {command}" if workspace is not None else command
    if await detect_dialect() == LUA:
        return await dispatch(f"hl.dsp.exec_cmd({lua_string(payload)})")
    return await dispatch("exec", payload)


async def close_window(address: str | None = None) -> tuple[bool, str]:
    if await detect_dialect() == LUA:
        if address:
            good, message = await focus_window(address)
            if not good:
                return good, message
        return await dispatch("hl.dsp.window.close()")

    if address:
        return await dispatch("closewindow", f"address:{address}")
    return await dispatch("killactive")


async def toggle_floating() -> tuple[bool, str]:
    if await detect_dialect() == LUA:
        return await dispatch("hl.dsp.window.float()")
    return await dispatch("togglefloating")


async def toggle_fullscreen() -> tuple[bool, str]:
    if await detect_dialect() == LUA:
        return await dispatch("hl.dsp.window.fullscreen()")
    return await dispatch("fullscreen", "1")

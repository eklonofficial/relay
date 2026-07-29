"""Seeing the screen.

Two different jobs, deliberately separate tools:

  * `take_screenshot` saves a PNG and tells you where it went. Cheap. Nothing
    is sent anywhere.
  * `read_screen` sends the image to Claude so it can actually describe or
    reason about what's on screen. Useful, but it costs tokens and it means
    the contents of your screen leave the machine -- so it is never something
    that happens as a side effect of an unrelated request.

**Size is the thing to get right.** The monitor is 3440x1440. Handed over
whole, that is roughly 4,800 tokens of plan allowance per look, and Claude's
vision resizes anything over 2576px on the long edge anyway -- so sending full
resolution buys nothing and costs real allowance. Images are scaled down
before they are encoded, and `grim` does it during capture rather than after,
which is faster and skips a decode.

`capture` returns the scale factor it applied. Nothing consumes it yet; it is
returned rather than discarded because mapping a coordinate from a shrunken
screenshot back onto the real screen is the first thing cursor control will
need, and losing the factor here would make that impossible to get right.
"""

from __future__ import annotations

import base64
import logging
import shutil
import time
from pathlib import Path
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from relay.paths import PATHS
from relay.tools.base import ctx, fail, ok, run, schema, string

log = logging.getLogger(__name__)

# Claude's vision resizes anything longer than this on its long edge, so
# sending more is pure waste.
MAX_EDGE = 2576
# Roughly a screenful of detail at a quarter of the tokens. Enough to read
# window titles and menu items; not enough for body text in a small font.
DEFAULT_MAX_EDGE = 1600

TARGETS = ("screen", "window", "region")


def shots_dir() -> Path:
    path = PATHS.state / "screenshots"
    path.mkdir(parents=True, exist_ok=True)
    return path


async def _active_window_geometry() -> tuple[str | None, str]:
    """`X,Y WxH` for the focused window, in the form grim's -g wants."""
    code, out, err = await run("hyprctl", "-j", "activewindow")
    if code != 0:
        return None, err.strip() or "hyprctl failed"
    import json

    try:
        window = json.loads(out)
    except ValueError:
        return None, "couldn't read the active window"
    at = window.get("at")
    size = window.get("size")
    if not at or not size:
        return None, "no window is focused"
    return f"{at[0]},{at[1]} {size[0]}x{size[1]}", ""


async def capture(target: str = "screen", *, max_edge: int = DEFAULT_MAX_EDGE,
                  destination: Path | None = None) -> tuple[Path | None, float, str]:
    """Grab the screen. Returns (path, scale_applied, error)."""
    if shutil.which("grim") is None:
        return None, 1.0, "grim isn't installed"

    argv = ["grim"]
    if target == "window":
        geometry, err = await _active_window_geometry()
        if geometry is None:
            return None, 1.0, err
        argv += ["-g", geometry]
    elif target == "region":
        if shutil.which("slurp") is None:
            return None, 1.0, "slurp isn't installed, so a region can't be chosen"
        code, out, err = await run("slurp", timeout=60.0)
        if code != 0 or not out.strip():
            return None, 1.0, "no region was selected"
        argv += ["-g", out.strip()]
    elif target != "screen":
        return None, 1.0, f"unknown target '{target}'"

    # Scale during capture rather than afterwards: grim does it while the
    # buffer is still in memory, so there's no decode/re-encode round trip.
    scale = _scale_for(await _screen_size(), max_edge)
    if scale < 1.0:
        argv += ["-s", f"{scale:.4f}"]

    path = destination or (shots_dir() / f"{time.strftime('%Y%m%d-%H%M%S')}.png")
    argv.append(str(path))

    code, _out, err = await run(*argv, timeout=20.0)
    if code != 0 or not path.exists():
        return None, 1.0, err.strip() or "screenshot failed"
    return path, scale, ""


async def _screen_size() -> tuple[int, int]:
    code, out, _ = await run("hyprctl", "-j", "monitors")
    if code == 0:
        import json

        try:
            monitors = json.loads(out)
        except ValueError:
            monitors = []
        for monitor in monitors:
            if monitor.get("focused"):
                return int(monitor["width"]), int(monitor["height"])
        if monitors:
            return int(monitors[0]["width"]), int(monitors[0]["height"])
    return 1920, 1080


def _scale_for(size: tuple[int, int], max_edge: int) -> float:
    """How much to shrink so the long edge fits, never upscaling."""
    longest = max(size)
    if longest <= max_edge or longest <= 0:
        return 1.0
    return max_edge / longest


# ------------------------------------------------------------------- tools
@tool(
    "take_screenshot",
    "Save a screenshot to a file without looking at it. 'screen' for "
    "everything, 'window' for the focused window, 'region' to pick an area "
    "by dragging. Use read_screen instead if you need to see it.",
    schema({
        "target": string("What to capture", enum=list(TARGETS)),
        "path": string("Where to save it. Defaults to a dated file in Relay's "
                       "screenshot folder."),
    }),
)
async def take_screenshot(args: dict[str, Any]) -> dict[str, Any]:
    target = args.get("target") or "screen"
    destination = Path(args["path"]).expanduser() if args.get("path") else None
    if destination is not None:
        destination.parent.mkdir(parents=True, exist_ok=True)

    # Saving to disk is not sent anywhere, so keep the full detail.
    path, _scale, err = await capture(target, max_edge=MAX_EDGE,
                                      destination=destination)
    if path is None:
        return fail(err)
    return ok(f"Saved to {path}.")


@tool(
    "read_screen",
    "Look at the screen. Returns the image so you can see what's on it. Use "
    "this only when you actually need to see something -- it costs tokens "
    "and sends the screen contents to the model.",
    schema({
        "target": string("What to look at", enum=list(TARGETS)),
    }),
)
async def read_screen(args: dict[str, Any]) -> dict[str, Any]:
    target = args.get("target") or "screen"
    path, scale, err = await capture(target)
    if path is None:
        return fail(err)

    try:
        data = path.read_bytes()
    except OSError as exc:
        return fail(f"Couldn't read the screenshot: {exc}")

    log.info("read_screen: %s at %.2f scale, %d KiB", target, scale, len(data) // 1024)
    return {
        "content": [
            {
                "type": "image",
                "data": base64.standard_b64encode(data).decode("ascii"),
                "mimeType": "image/png",
            },
            {"type": "text", "text": f"Screenshot of the {target}."},
        ]
    }


TOOLS = [take_screenshot, read_screen]

TOOL_NAMES = [f"mcp__screen__{t.name}" for t in TOOLS]


def server():
    return create_sdk_mcp_server(name="screen", version="1.0.0", tools=TOOLS)

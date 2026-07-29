"""Shared plumbing for Relay's in-process MCP tools.

Every tool definition lives in the model's cached prefix and is re-read on
each turn, so descriptions here are written to be short and unambiguous
rather than chatty. See docs/cost-findings.md.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from dataclasses import dataclass, field
from typing import Any

from relay.config import Config
from relay.memory.store import MemoryStore

log = logging.getLogger(__name__)


@dataclass
class ToolContext:
    """Everything the tools need, injected once at daemon start.

    Module-level tool functions can't take constructor arguments, so this is
    set once by the daemon and read by the tool bodies.
    """

    cfg: Config
    store: MemoryStore
    speak: Any | None = None          # set once TTS exists
    active_scope: str = "global"
    extras: dict[str, Any] = field(default_factory=dict)


_CONTEXT: ToolContext | None = None


def set_context(context: ToolContext) -> None:
    global _CONTEXT
    _CONTEXT = context


def ctx() -> ToolContext:
    if _CONTEXT is None:
        raise RuntimeError("tool context not initialised; call set_context() first")
    return _CONTEXT


# --------------------------------------------------------------- results
def ok(text: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}]}


def fail(text: str) -> dict[str, Any]:
    """Tool-level error. Returned to the model so it can adapt, not raised."""
    return {"content": [{"type": "text", "text": text}], "is_error": True}


# ------------------------------------------------------------- processes
async def run(*argv: str, timeout: float = 15.0) -> tuple[int, str, str]:
    """Run a command, returning (returncode, stdout, stderr).

    Used for hyprctl, playerctl and friends. Deliberately argv-based rather
    than shell=True: none of these take user text directly, and keeping a
    shell out of the picture removes a whole class of injection.
    """
    if shutil.which(argv[0]) is None:
        return 127, "", f"{argv[0]} is not installed"
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        return 124, "", f"{argv[0]} timed out after {timeout}s"
    except OSError as exc:
        return 1, "", str(exc)
    return proc.returncode or 0, stdout.decode(errors="replace"), stderr.decode(errors="replace")


def schema(properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
    """Build a JSON Schema object for a tool's input."""
    return {
        "type": "object",
        "properties": properties,
        "required": required or [],
        "additionalProperties": False,
    }


def string(description: str, enum: list[str] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {"type": "string", "description": description}
    if enum:
        out["enum"] = enum
    return out


def integer(description: str) -> dict[str, Any]:
    return {"type": "integer", "description": description}


def boolean(description: str) -> dict[str, Any]:
    return {"type": "boolean", "description": description}

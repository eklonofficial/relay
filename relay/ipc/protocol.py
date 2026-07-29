"""Line-delimited JSON over a unix socket.

Deliberately boring. The socket is a control channel for an agent that can run
shell commands, so the directory is 0700 and there is no network listener.
"""

from __future__ import annotations

import json
from typing import Any

ENCODING = "utf-8"

# Server -> client message types
TEXT = "text"            # a chunk of assistant output
DONE = "done"            # request finished
ERROR = "error"
CONFIRM = "confirm"      # server asks the user to approve an action
INFO = "info"            # status line, not assistant speech

# Client -> server
COMMAND = "command"
CONFIRM_REPLY = "confirm_reply"


def encode(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, separators=(",", ":")) + "\n").encode(ENCODING)


def decode(line: bytes) -> dict[str, Any]:
    return json.loads(line.decode(ENCODING))


def message(kind: str, **fields: Any) -> dict[str, Any]:
    return {"type": kind, **fields}

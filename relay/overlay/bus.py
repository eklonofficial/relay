"""Broadcasting what Relay is doing, for anything that wants to draw it.

Relay's main IPC socket is request/response: `emit` is a closure bound to one
connection's writer, and every exchange ends with DONE. That shape is right
for commands and wrong for animation, which needs a continuous push to however
many clients happen to be watching. So the orb gets its own socket.

The one rule here is that **this must never slow the voice loop down**. Levels
are emitted from the audio path roughly thirty times a second, and a renderer
that stops reading must not be able to block the coroutine that heard you
speak. So writes are fire-and-forget: no `drain()`, no backpressure, and a
client whose buffer fills simply loses frames. Dropped frames cost a stutter
in an animation. A blocked audio loop costs the assistant.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Any

from relay.ipc import protocol
from relay.paths import PATHS

log = logging.getLogger(__name__)


class OverlayBus:
    """A write-only fan-out of state and audio levels."""

    def __init__(self, socket_path=None) -> None:
        self.path = socket_path or PATHS.overlay_socket
        self._server: asyncio.AbstractServer | None = None
        self._clients: set[asyncio.StreamWriter] = set()
        # The last state sent, replayed to each new client so a renderer that
        # starts late doesn't sit blank until Relay next does something.
        self._last: dict[str, Any] | None = None
        self.sent = 0
        self.dropped = 0

    @property
    def listening(self) -> bool:
        return self._server is not None

    @property
    def clients(self) -> int:
        return len(self._clients)

    async def start(self) -> None:
        # A stale socket from a killed daemon would make bind fail. Nothing
        # else owns this path, and it carries no commands, so removing it is
        # safe in a way that the control socket's stale handling is not.
        with contextlib.suppress(FileNotFoundError):
            self.path.unlink()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._server = await asyncio.start_unix_server(
            self._accept, path=str(self.path))
        self.path.chmod(0o600)
        log.info("overlay bus listening on %s", self.path)

    async def stop(self) -> None:
        for writer in tuple(self._clients):
            self._drop(writer)
        if self._server is not None:
            self._server.close()
            with contextlib.suppress(Exception):
                await self._server.wait_closed()
            self._server = None
        with contextlib.suppress(FileNotFoundError):
            self.path.unlink()

    async def _accept(self, reader: asyncio.StreamReader,
                      writer: asyncio.StreamWriter) -> None:
        self._clients.add(writer)
        log.info("overlay attached (%d watching)", len(self._clients))
        if self._last is not None:
            self._write(writer, self._last)
        try:
            # Read-only channel: the orb never sends anything back. Waiting on
            # EOF is just how we notice it has gone away.
            await reader.read()
        except (ConnectionResetError, BrokenPipeError, OSError):
            pass
        finally:
            self._drop(writer)
            log.info("overlay detached (%d watching)", len(self._clients))

    def _drop(self, writer: asyncio.StreamWriter) -> None:
        self._clients.discard(writer)
        with contextlib.suppress(Exception):
            writer.close()

    def _write(self, writer: asyncio.StreamWriter, payload: dict[str, Any]) -> None:
        try:
            writer.write(protocol.encode(payload))
        except Exception:  # noqa: BLE001 - a dead client must not raise here
            self.dropped += 1
            self._drop(writer)

    def send(self, **payload: Any) -> None:
        """Push a message to every attached renderer.

        Synchronous, and deliberately so: it is called from the audio path and
        from `abort()`, which is itself sync because it has to take effect the
        instant the key is pressed. `writer.write()` only appends to a buffer,
        so this does no I/O -- the event loop flushes it later.
        """
        if payload.get("state"):
            self._last = payload
        if not self._clients:
            return
        for writer in tuple(self._clients):
            self._write(writer, payload)
        self.sent += 1

    def stats(self) -> dict[str, Any]:
        return {
            "listening": self.listening,
            "clients": self.clients,
            "sent": self.sent,
            "dropped": self.dropped,
            "socket": str(self.path),
        }

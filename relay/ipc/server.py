"""Unix socket server: one connection per `relay` invocation."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from typing import Any

from relay.daemon import RelayDaemon
from relay.ipc import protocol
from relay.paths import PATHS

log = logging.getLogger(__name__)


class IPCServer:
    def __init__(self, daemon: RelayDaemon) -> None:
        self.daemon = daemon
        self._server: asyncio.AbstractServer | None = None

    async def start(self) -> None:
        PATHS.ensure()
        socket_path = PATHS.socket
        if socket_path.exists():
            # A leftover socket from a crash would block binding. Only remove
            # it if nothing is listening.
            if await _is_live(socket_path):
                raise RuntimeError(f"relayd is already running on {socket_path}")
            socket_path.unlink()

        self._server = await asyncio.start_unix_server(self._handle, path=str(socket_path))
        os.chmod(socket_path, 0o600)
        log.info("listening on %s", socket_path)

    async def serve_forever(self) -> None:
        if self._server is None:
            raise RuntimeError("server not started")
        async with self._server:
            await self._server.serve_forever()

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            with contextlib.suppress(Exception):
                await self._server.wait_closed()
        with contextlib.suppress(OSError):
            PATHS.socket.unlink()

    # ------------------------------------------------------------ connection
    async def _handle(self, reader: asyncio.StreamReader,
                      writer: asyncio.StreamWriter) -> None:
        pending: dict[str, asyncio.Future] = {}

        async def emit(kind: str, fields: dict[str, Any]) -> None:
            writer.write(protocol.encode(protocol.message(kind, **fields)))
            await writer.drain()

        async def confirm(description: str) -> bool:
            """Round-trip a confirmation to whoever is on the other end."""
            token = os.urandom(8).hex()
            future: asyncio.Future = asyncio.get_running_loop().create_future()
            pending[token] = future
            await emit(protocol.CONFIRM, {"text": description, "token": token})
            try:
                return bool(await asyncio.wait_for(future, timeout=120))
            except TimeoutError:
                log.info("confirmation timed out: %s", description)
                return False
            finally:
                pending.pop(token, None)

        try:
            while True:
                line = await reader.readline()
                if not line:
                    break
                try:
                    request = protocol.decode(line)
                except ValueError:
                    await emit(protocol.ERROR, {"text": "malformed request"})
                    continue

                kind = request.get("type")
                if kind == protocol.CONFIRM_REPLY:
                    future = pending.get(request.get("token", ""))
                    if future and not future.done():
                        future.set_result(bool(request.get("approved")))
                    continue

                if kind != protocol.COMMAND:
                    await emit(protocol.ERROR, {"text": f"unexpected message '{kind}'"})
                    continue

                try:
                    await self.daemon.handle(
                        request.get("command", ""),
                        request.get("args") or {},
                        emit=emit,
                        confirm=confirm,
                    )
                except Exception as exc:  # noqa: BLE001 - one bad command shouldn't kill relayd
                    log.exception("command failed")
                    await emit(protocol.ERROR, {"text": f"{type(exc).__name__}: {exc}"})
                await emit(protocol.DONE, {})
        except (ConnectionResetError, BrokenPipeError):
            pass
        finally:
            with contextlib.suppress(Exception):
                writer.close()
                await writer.wait_closed()


async def _is_live(path) -> bool:
    """True if something is actually listening on the socket."""
    try:
        reader, writer = await asyncio.open_unix_connection(str(path))
    except (ConnectionRefusedError, FileNotFoundError, OSError):
        return False
    writer.close()
    with contextlib.suppress(Exception):
        await writer.wait_closed()
    del reader
    return True

"""Running the Quickshell instance that draws the orb.

Relay owns this process rather than adding a widget to the shell config in
`~/.config/quickshell/ii`. That config belongs to end-4's dotfiles and is
replaced wholesale when they update; anything Relay put there would be lost,
and uninstalling Relay would mean editing someone else's files. A separate
instance costs about 40 MB and keeps the whole overlay inside this repo, where
it is committed, backed up and removable in one line.

It is supervised rather than fired and forgotten, because a renderer that dies
silently at 3am leaves Relay looking broken while it is working perfectly.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import shutil
from pathlib import Path

log = logging.getLogger(__name__)

QML_DIR = Path(__file__).resolve().parent / "qml"

# Quickshell is started by the compositor at login, so it is normally already
# up before Relay is. These delays are for the case where it isn't -- a
# restart loop that hammers a missing binary helps nobody.
FIRST_RETRY_S = 2.0
MAX_RETRY_S = 60.0
# A process that survives this long counts as a real start, so a crash after
# an hour doesn't inherit the backoff from one at boot.
HEALTHY_AFTER_S = 30.0


def quickshell_binary() -> str | None:
    """`qs` is the short name; `quickshell` is what the package installs."""
    return shutil.which("qs") or shutil.which("quickshell")


class OverlayProcess:
    """Keeps one `qs -p <repo>/relay/overlay/qml` alive."""

    def __init__(self, qml_dir: Path | None = None, *, env: dict | None = None) -> None:
        self.qml_dir = qml_dir or QML_DIR
        # Geometry and socket path travel as environment variables, because
        # the window needs its size before any socket has connected.
        self.env = env or {}
        self._task: asyncio.Task | None = None
        self._process: asyncio.subprocess.Process | None = None
        self.starts = 0
        self.last_error: str | None = None

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def start(self) -> bool:
        """Begin supervising. False means it will never work, not 'not yet'."""
        binary = quickshell_binary()
        if binary is None:
            self.last_error = "quickshell is not installed (no `qs` on PATH)"
            log.warning("overlay disabled: %s", self.last_error)
            return False
        if not (self.qml_dir / "shell.qml").exists():
            self.last_error = f"no shell.qml in {self.qml_dir}"
            log.warning("overlay disabled: %s", self.last_error)
            return False
        self._task = asyncio.create_task(self._supervise(binary),
                                         name="relay-overlay")
        return True

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._task = None
        await self._terminate()

    async def _terminate(self) -> None:
        process = self._process
        self._process = None
        if process is None or process.returncode is not None:
            return
        try:
            process.terminate()
            await asyncio.wait_for(process.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            log.warning("overlay did not exit; killing it")
            with contextlib.suppress(Exception):
                process.kill()
        except Exception as exc:  # noqa: BLE001
            log.debug("error stopping the overlay: %s", exc)

    async def _supervise(self, binary: str) -> None:
        delay = FIRST_RETRY_S
        while True:
            started = asyncio.get_running_loop().time()
            try:
                await self._run_once(binary)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                self.last_error = str(exc)
                log.warning("overlay failed to start: %s", exc)

            lived = asyncio.get_running_loop().time() - started
            if lived >= HEALTHY_AFTER_S:
                delay = FIRST_RETRY_S
            log.info("overlay exited after %.0fs; restarting in %.0fs", lived, delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, MAX_RETRY_S)

    async def _run_once(self, binary: str) -> None:
        # `-p` points at a QML file/directory directly, which is what keeps
        # this independent of ~/.config/quickshell and its config names.
        environment = {**os.environ, **{k: str(v) for k, v in self.env.items()}}
        self._process = await asyncio.create_subprocess_exec(
            binary, "-p", str(self.qml_dir / "shell.qml"),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=environment,
        )
        self.starts += 1
        log.info("overlay started (pid %s)", self._process.pid)
        await self._drain(self._process)
        await self._process.wait()

    async def _drain(self, process) -> None:
        """Forward QML warnings into Relay's log.

        Without this a shader that fails to compile produces a blank screen
        and total silence, which is the hardest kind of bug to find.
        """
        if process.stdout is None:
            return
        try:
            async for line in process.stdout:
                text = line.decode(errors="replace").rstrip()
                if text:
                    log.info("overlay: %s", text)
        except Exception as exc:  # noqa: BLE001
            log.debug("overlay output closed: %s", exc)

    def stats(self) -> dict:
        return {
            "running": self.running,
            "starts": self.starts,
            "qml": str(self.qml_dir),
            "error": self.last_error,
        }

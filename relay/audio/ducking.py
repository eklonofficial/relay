"""Turning everything else down while Relay is listening.

Echo cancellation removes the music from what the microphone hears. It cannot
remove what the music does to *you*: people raise their voice over it, run
words together, and the room reverberates. So for the few seconds of a
request, everything else goes quiet -- the same gesture as someone reaching
over and turning the stereo down to listen.

Everything else, and not Relay. Its own replies would otherwise be ducked by
the same rule that ducks the music, which would be absurd. The exclusion is
by process id rather than by application name: Relay's playback reaches
PipeWire as "ALSA plug-in [python3.12]", which any Python program would also
be called, whereas `application.process.id` is exactly this daemon and
nothing else.

Nothing here may block the event loop and nothing may leave the volume down.
Both are load-bearing: the first because ducking happens on the wake word,
milliseconds before recording starts, and the second because the failure mode
is somebody's music staying quiet until they work out why.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os

from relay.paths import PATHS

log = logging.getLogger(__name__)

# Volumes are restored from here if Relay dies while something is ducked.
# Without it a crash mid-request leaves the music down with nothing left
# running that knows it did that.
STATE_FILE = "ducked.json"


async def _pactl(*args: str) -> tuple[int, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "pactl", *args,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        out, err = await asyncio.wait_for(proc.communicate(), timeout=4.0)
    except FileNotFoundError:
        return 127, "pactl is not installed"
    except asyncio.TimeoutError:
        return 124, "pactl timed out"
    except Exception as exc:  # noqa: BLE001
        return 1, str(exc)
    return proc.returncode, (out or err).decode(errors="replace")


class Ducker:
    """Lowers every other stream while Relay has your attention."""

    def __init__(self, *, level: float = 0.25, enabled: bool = True,
                 state_file=None) -> None:
        # 0 would be a mute, which is a different and more startling thing.
        self.level = min(0.95, max(0.02, float(level)))
        self.enabled = enabled
        self.state_file = state_file or (PATHS.state / STATE_FILE)
        self._lock = asyncio.Lock()
        # stream index -> the per-channel volumes it had before we touched it
        self._original: dict[str, list[int]] = {}
        self._want_ducked = False
        self.ducks = 0

    @property
    def ducked(self) -> bool:
        return bool(self._original)

    # ---------------------------------------------------- listener contract
    def wake(self) -> None:
        """Relay has been addressed: turn the room down."""
        self._request(True)

    def idle(self) -> None:
        """The turn is over: put it back."""
        self._request(False)

    def _request(self, ducked: bool) -> None:
        """Record what we want and let a task converge on it.

        Synchronous and non-blocking on purpose. This is called from the wake
        path, a few milliseconds before recording starts; waiting on a
        subprocess here would delay the microphone for the first syllable of
        the request, which is the one thing ducking exists to protect.
        """
        if not self.enabled:
            return
        self._want_ducked = ducked
        try:
            asyncio.get_running_loop().create_task(self._apply())
        except RuntimeError:
            pass  # no loop (tests, shutdown); nothing to converge

    async def unduck(self) -> None:
        """Put every volume back, now, and wait until it is done.

        The awaitable counterpart to `idle()`, for shutdown: there the loop
        is about to stop and a fire-and-forget task would never run.
        """
        self._want_ducked = False
        async with self._lock:
            if self._original:
                await self._restore()

    async def _apply(self) -> None:
        # Serialised, and expressed as "get to this state" rather than "do
        # this action", so a wake immediately followed by an abort settles
        # correctly instead of racing to a half-ducked mess.
        async with self._lock:
            try:
                if self._want_ducked and not self._original:
                    await self._duck()
                elif not self._want_ducked and self._original:
                    await self._restore()
            except Exception:  # noqa: BLE001
                log.debug("ducking failed", exc_info=True)

    # ------------------------------------------------------------ the work
    async def _streams(self) -> list[dict]:
        code, out = await _pactl("-f", "json", "list", "sink-inputs")
        if code != 0:
            log.debug("could not list streams: %s", out.strip()[:120])
            return []
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return []

    async def _duck(self) -> None:
        mine = str(os.getpid())
        original: dict[str, list[int]] = {}

        for stream in await self._streams():
            props = stream.get("properties") or {}
            # Never Relay's own voice.
            if str(props.get("application.process.id")) == mine:
                continue
            volumes = [int(ch["value"]) for ch in (stream.get("volume") or {}).values()]
            if not volumes or all(v == 0 for v in volumes):
                continue          # already silent; nothing to duck or restore
            index = str(stream.get("index"))
            lowered = [str(max(0, int(v * self.level))) for v in volumes]
            code, out = await _pactl("set-sink-input-volume", index, *lowered)
            if code == 0:
                # The application is recorded alongside the stream index
                # because indexes do not survive the stream. PipeWire
                # remembers a volume *per application*, so a duck left
                # behind by a crash becomes that app's remembered volume --
                # and if it has closed by the time Relay comes back, the
                # index it was ducked under no longer exists and there is
                # nothing to put back. Matching on the app gives the next
                # stream it opens a chance to be corrected.
                original[index] = {
                    "volumes": volumes,
                    "app": (props.get("application.name") or "")[:64],
                }
            else:
                log.debug("could not duck stream %s: %s", index, out.strip()[:80])

        if not original:
            return
        self._original = original
        self._save()
        self.ducks += 1
        log.info("ducked %d stream(s) to %d%%", len(original), int(self.level * 100))

    async def _restore(self) -> None:
        live = {str(s.get("index")): s for s in await self._streams()}
        by_app: dict[str, str] = {}
        for index, s in live.items():
            name = ((s.get("properties") or {}).get("application.name") or "")[:64]
            by_app.setdefault(name, index)

        for index, record in tuple(self._original.items()):
            values = [str(v) for v in record["volumes"]]
            # Always attempt the original index, even when the listing above
            # says it is gone or failed outright. Setting a volume on a
            # stream that no longer exists is a harmless error; *skipping*
            # every restore because one `pactl` call failed would leave the
            # whole lot ducked, which is the failure this class exists to
            # prevent.
            await _pactl("set-sink-input-volume", index, *values)

            if live and index not in live:
                # A stream that has gone away is not an error -- the song
                # ended, or the app closed, while Relay was being spoken to.
                # But if the same application is playing again under a new
                # index, it is almost certainly carrying our ducked volume
                # forward, because PipeWire remembers volume per application.
                alt = by_app.get(record.get("app", ""), "")
                if alt:
                    log.info("stream %s is gone; restoring %s instead",
                             index, record.get("app") or alt)
                    await _pactl("set-sink-input-volume", alt, *values)

        log.info("restored %d stream(s)", len(self._original))
        self._original = {}
        self._clear()

    # ------------------------------------------------------ crash recovery
    def _save(self) -> None:
        with contextlib.suppress(Exception):
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps(self._original))

    def _clear(self) -> None:
        with contextlib.suppress(Exception):
            self.state_file.unlink(missing_ok=True)

    async def recover(self) -> int:
        """Undo a duck left behind by a daemon that died mid-request.

        Called at startup. Volumes are a user-visible side effect that
        outlives the process that caused them, so something has to remember
        across a restart, and the process that did it plainly cannot.
        """
        if not self.state_file.exists():
            return 0
        try:
            stale = json.loads(self.state_file.read_text())
        except Exception:  # noqa: BLE001
            self._clear()
            return 0
        if not isinstance(stale, dict) or not stale:
            self._clear()
            return 0
        log.warning("restoring %d stream(s) left ducked by a previous run",
                    len(stale))
        self._original = {
            str(k): (v if isinstance(v, dict) else {"volumes": list(v), "app": ""})
            for k, v in stale.items()
        }
        async with self._lock:
            await self._restore()
        return len(stale)

    def stats(self) -> dict:
        return {
            "enabled": self.enabled,
            "level": self.level,
            "ducked": self.ducked,
            "streams": len(self._original),
            "ducks": self.ducks,
        }

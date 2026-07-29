"""Talking to Cider, the Apple Music client.

Cider exposes a local REST API on port 10767. It is the only way to play
something *by name* -- there is no search endpoint, so a name has to go
through Apple Music's catalogue search (`/api/v1/amapi/run-v3`) and the
resulting id fed back into `play-item`.

For plain transport control there is a second route: Cider registers on MPRIS,
so `playerctl` works with no configuration, no token, and no settings change.
This module prefers REST (richer, and needed for everything else) and falls
back to playerctl, so pause/skip keep working when the API is off, the token
is wrong, or Cider changes it again.

The auth header is genuinely contested. Cider's own docs say `apptoken`; the
published Rust client says `apitoken`; there is an open Cider issue stating
the latter is wrong. Rather than betting on either, the first 401 retries with
the other name and remembers which one worked.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import time
from typing import Any

from relay.tools.base import run

log = logging.getLogger(__name__)

DEFAULT_URL = "http://localhost:10767"
PLAYBACK = "/api/v1/playback"
AMAPI = "/api/v1/amapi/run-v3"

# Preferred first; the other is tried once on a 401.
TOKEN_HEADERS = ("apptoken", "apitoken")

# A probe that must stay quick: it runs before every music command to decide
# whether Cider needs launching.
PROBE_TIMEOUT_S = 1.0
CALL_TIMEOUT_S = 6.0
# Apple Music search can be slow over a cold connection.
SEARCH_TIMEOUT_S = 12.0


class CiderError(Exception):
    """Cider is reachable but refused, or isn't reachable at all."""


class CiderClient:
    def __init__(self, base_url: str = DEFAULT_URL, token: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        # Which header name worked. Learned on first success so the retry
        # happens once per process, not on every call.
        self._header_name: str | None = None

    # ------------------------------------------------------------- transport
    def _headers(self, name: str, *, has_body: bool) -> dict[str, str]:
        headers = {}
        # Only declare a JSON body when there is one. Cider runs Fastify,
        # which rejects a bodyless request that claims application/json:
        #   400 FST_ERR_CTP_EMPTY_JSON_BODY
        #   "Body cannot be empty when content-type is set to
        #    'application/json'"
        # Every argument-free command -- play, pause, next, previous -- goes
        # through this path, so getting it wrong breaks most of the API while
        # leaving the GET endpoints working perfectly.
        if has_body:
            headers["Content-Type"] = "application/json"
        if self.token:
            # No "Bearer" prefix -- Cider wants the bare token.
            headers[name] = self.token
        return headers

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        timeout: float = CALL_TIMEOUT_S,
    ) -> Any:
        """One API call. Raises CiderError; never returns a failure sentinel."""
        import httpx

        url = f"{self.base_url}{path}"
        names = [self._header_name] if self._header_name else list(TOKEN_HEADERS)

        last_error = "no attempt made"
        for name in names:
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.request(
                        method, url,
                        headers=self._headers(name, has_body=json is not None),
                        json=json,
                    )
            except Exception as exc:  # noqa: BLE001 - httpx raises a family
                raise CiderError(f"Cider isn't reachable at {self.base_url}") from exc

            if response.status_code in (401, 403):
                last_error = "Cider rejected the API token"
                continue  # try the other header name

            if response.status_code >= 400:
                raise CiderError(
                    f"Cider returned {response.status_code} for {path}"
                )

            self._header_name = name
            if response.status_code == 204 or not response.content:
                return None
            try:
                return response.json()
            except ValueError:
                return None

        raise CiderError(
            f"{last_error}. Check Settings -> Connectivity in Cider and update "
            "music.cider_token."
        )

    # ------------------------------------------------------------- liveness
    async def is_up(self) -> bool:
        """Is the API answering? Deliberately cheap and quiet."""
        try:
            await self.request("GET", f"{PLAYBACK}/is-playing", timeout=PROBE_TIMEOUT_S)
        except CiderError:
            return False
        return True

    async def wait_until_up(self, timeout_s: float, *, interval_s: float = 0.75) -> bool:
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if await self.is_up():
                return True
            await asyncio.sleep(interval_s)
        return False

    # ------------------------------------------------------------- playback
    async def is_playing(self) -> bool:
        data = await self.request("GET", f"{PLAYBACK}/is-playing")
        return bool((data or {}).get("is_playing"))

    async def now_playing(self) -> dict[str, Any]:
        data = await self.request("GET", f"{PLAYBACK}/now-playing")
        return (data or {}).get("info") or {}

    async def play(self) -> None:
        await self.request("POST", f"{PLAYBACK}/play")

    async def pause(self) -> None:
        await self.request("POST", f"{PLAYBACK}/pause")

    async def next_track(self) -> None:
        await self.request("POST", f"{PLAYBACK}/next")

    async def previous_track(self) -> None:
        await self.request("POST", f"{PLAYBACK}/previous")

    async def seek(self, position_s: float) -> None:
        await self.request("POST", f"{PLAYBACK}/seek", json={"position": position_s})

    async def get_volume(self) -> float:
        data = await self.request("GET", f"{PLAYBACK}/volume")
        return float((data or {}).get("volume", 0.0))

    async def set_volume(self, fraction: float) -> None:
        # The API works in 0-1; people speak in percentages. Clamping here
        # rather than at the tool means every caller is safe.
        fraction = max(0.0, min(1.0, fraction))
        await self.request("POST", f"{PLAYBACK}/volume", json={"volume": fraction})

    async def toggle_shuffle(self) -> int:
        await self.request("POST", f"{PLAYBACK}/toggle-shuffle")
        data = await self.request("GET", f"{PLAYBACK}/shuffle-mode")
        return int((data or {}).get("value", 0))

    async def toggle_repeat(self) -> int:
        await self.request("POST", f"{PLAYBACK}/toggle-repeat")
        data = await self.request("GET", f"{PLAYBACK}/repeat-mode")
        return int((data or {}).get("value", 0))

    async def queue(self) -> list[dict[str, Any]]:
        data = await self.request("GET", f"{PLAYBACK}/queue")
        return data if isinstance(data, list) else []

    async def play_item(self, kind: str, item_id: str) -> None:
        # Ids must be strings; sending a number is silently ignored.
        await self.request(
            "POST", f"{PLAYBACK}/play-item", json={"type": kind, "id": str(item_id)}
        )

    # --------------------------------------------------------------- search
    async def search(self, term: str, *, kinds: str = "songs", limit: int = 5
                     ) -> list[dict[str, Any]]:
        """Apple Music catalogue search, proxied through Cider.

        There is no Cider-level search endpoint, so this goes to the MusicKit
        v3 route. The storefront is chosen by Cider from the signed-in account,
        so "us" here is only a path placeholder that MusicKit rewrites.
        """
        from urllib.parse import quote

        # safe="" matters: quote() leaves "/" alone by default, and plenty of
        # real titles contain one ("Weird Fishes/Arpeggi"), which would then
        # break out of the query parameter and corrupt the path.
        path = (f"/v1/catalog/us/search?term={quote(term, safe='')}"
                f"&types={kinds}&limit={limit}")
        data = await self.request("POST", AMAPI, json={"path": path},
                                  timeout=SEARCH_TIMEOUT_S)

        results = (((data or {}).get("data") or {}).get("results") or {})
        bucket = results.get(kinds) or {}
        return bucket.get("data") or []


# --------------------------------------------------------------------- MPRIS
# Cider is an Electron app and never sets its own MPRIS identity, so it
# registers as `chromium.instance<pid>` -- a name that changes every restart
# and is indistinguishable from an actual Chromium browser. Asking playerctl
# for "cider" therefore finds nothing, which is how the fallback managed to
# look implemented while never once working.
#
# What it *does* set is the D-Bus `Identity` property, which reads "Cider".
# That's what this matches on.
_player_cache: str | None = None


async def _identity(player: str) -> str:
    code, out, _ = await run(
        "busctl", "--user", "get-property",
        f"org.mpris.MediaPlayer2.{player}", "/org/mpris/MediaPlayer2",
        "org.mpris.MediaPlayer2", "Identity",
    )
    if code != 0:
        return ""
    # Output looks like: s "Cider"
    return out.strip().removeprefix("s ").strip().strip('"')


async def find_player(name: str = "cider", *, refresh: bool = False) -> str | None:
    """The MPRIS bus name for Cider, or None if it isn't on the bus."""
    global _player_cache
    if _player_cache and not refresh:
        return _player_cache

    if shutil.which("playerctl") is None:
        return None
    code, out, _ = await run("playerctl", "-l")
    if code != 0:
        return None

    candidates = [line.strip() for line in out.splitlines() if line.strip()]
    # A future Cider that sets a sane bus name should win immediately.
    for candidate in candidates:
        if name in candidate.lower():
            _player_cache = candidate
            return candidate

    for candidate in candidates:
        if name in (await _identity(candidate)).lower():
            _player_cache = candidate
            return candidate
    return None


async def playerctl(*args: str, player: str | None = None) -> tuple[bool, str]:
    """Transport control over MPRIS, for when the REST API isn't available."""
    if shutil.which("playerctl") is None:
        return False, "playerctl isn't installed"

    target = player or await find_player()
    if target is None:
        return False, "Cider isn't on the MPRIS bus"

    code, out, err = await run("playerctl", "--player", target, *args)
    if code != 0:
        # The bus name embeds a pid, so it changes on every restart. One
        # retry with a fresh lookup turns a stale cache into a hiccup rather
        # than a dead fallback.
        refreshed = await find_player(refresh=True)
        if refreshed and refreshed != target:
            code, out, err = await run("playerctl", "--player", refreshed, *args)
        if code != 0:
            return False, (err or out).strip() or "playerctl failed"
    return True, out.strip()



def describe_track(info: dict[str, Any]) -> str:
    """Turn a now-playing payload into something worth saying out loud."""
    name = info.get("name") or info.get("title")
    artist = info.get("artistName") or info.get("artist")
    if not name:
        return "Nothing is playing."
    if artist:
        return f"{name} by {artist}."
    return f"{name}."

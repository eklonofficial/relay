"""Music control, through Cider.

Everything here is deliberately forgiving about *how* it reaches the player:
the REST API when it's available, MPRIS via playerctl when it isn't. The one
thing that genuinely needs the API is playing something by name, because that
requires an Apple Music catalogue search.

Asking for music when Cider is closed starts it. That wait is the awkward
part -- a cold start is several seconds -- so it announces itself rather than
leaving silence that reads as a failure.
"""

from __future__ import annotations

import logging
from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from relay.tools import cider as cider_mod
from relay.tools import hypr
from relay.tools.base import ctx, fail, integer, ok, schema, string

log = logging.getLogger(__name__)

_client: cider_mod.CiderClient | None = None


def client() -> cider_mod.CiderClient:
    """One client per process, built from config on first use."""
    global _client
    if _client is None:
        cfg = ctx().cfg.music
        _client = cider_mod.CiderClient(cfg.cider_url, cfg.cider_token)
    return _client


def reset_client() -> None:
    """Drop the cached client, so a changed token takes effect."""
    global _client
    _client = None


async def _say(text: str) -> None:
    """Speak, if there's a voice. Routed through say_once so a stuck launch
    can't turn into Relay talking on a loop."""
    speak = ctx().speak
    if speak is None:
        return
    try:
        say_once = getattr(speak, "say_once", None)
        await (say_once(text) if say_once else speak(text))
    except Exception:  # noqa: BLE001 - never let the announcement break the command
        log.debug("could not announce %r", text, exc_info=True)


async def ensure_cider(*, launch: bool = True) -> tuple[bool, str]:
    """Make sure the API is answering, starting Cider if it isn't.

    Returns (ready, message). The probe is the common path and must stay fast,
    so it runs with a one-second timeout before anything else happens.
    """
    api = client()
    if await api.is_up():
        return True, ""

    if not launch:
        return False, "Cider isn't running."

    good, message = await hypr.exec_command(ctx().cfg.music.player)
    if not good:
        return False, f"Couldn't start Cider: {message}"

    await _say("Starting Cider.")
    timeout = ctx().cfg.music.launch_timeout_s
    # Poll proportionally rather than on a fixed tick: a long timeout doesn't
    # need to hammer the port, and a short one shouldn't get a single probe.
    interval = min(0.75, max(0.05, timeout / 20))
    if await api.wait_until_up(timeout, interval_s=interval):
        return True, ""
    return False, (
        f"Cider didn't finish starting within {timeout:g} seconds. It may "
        "still be loading, or its API may be switched off in Settings."
    )


async def _transport(rest, mpris_args: tuple[str, ...], done: str) -> dict[str, Any]:
    """Run a transport command over REST, falling back to MPRIS.

    Deliberately does not launch Cider: pausing a player that isn't running
    should say so, not start one.
    """
    api = client()
    try:
        if await api.is_up():
            await rest(api)
            return ok(done)
    except cider_mod.CiderError as exc:
        log.info("Cider REST failed (%s); trying MPRIS", exc)

    if not ctx().cfg.music.allow_mpris_fallback:
        return fail("Cider isn't responding.")

    good, _ = await cider_mod.playerctl(*mpris_args)
    if good:
        return ok(done)
    return fail("Cider isn't running.")


# ------------------------------------------------------------------- tools
@tool(
    "music_play",
    "Play music in Cider. With 'query', searches Apple Music and plays the "
    "best match; without it, resumes what's paused. Starts Cider if needed.",
    schema({
        "query": string("Song, artist or album to play, e.g. 'Weird Fishes'"),
        "kind": string("What to search for", enum=["songs", "albums", "artists"]),
    }),
)
async def music_play(args: dict[str, Any]) -> dict[str, Any]:
    query = (args.get("query") or "").strip()

    # Playing is the one command that should start the player.
    ready, message = await ensure_cider(launch=True)
    if not ready:
        return fail(message)

    api = client()
    if not query:
        try:
            await api.play()
            return ok("Playing.")
        except cider_mod.CiderError as exc:
            return fail(str(exc))

    kind = args.get("kind") or "songs"
    try:
        results = await api.search(query, kinds=kind)
    except cider_mod.CiderError as exc:
        return fail(f"Couldn't search Apple Music: {exc}")

    if not results:
        return fail(f"Couldn't find anything for '{query}'.")

    best = results[0]
    attributes = best.get("attributes") or {}
    try:
        await api.play_item(best.get("type") or kind, best.get("id"))
    except cider_mod.CiderError as exc:
        return fail(str(exc))

    # Say what was actually picked: catalogue search is fuzzy and the top hit
    # is regularly not what was meant.
    return ok(f"Playing {cider_mod.describe_track(attributes)}")


@tool("music_pause", "Pause the music.", schema({}))
async def music_pause(_args: dict[str, Any]) -> dict[str, Any]:
    return await _transport(lambda api: api.pause(), ("pause",), "Paused.")


@tool("music_next", "Skip to the next track.", schema({}))
async def music_next(_args: dict[str, Any]) -> dict[str, Any]:
    return await _transport(lambda api: api.next_track(), ("next",), "Skipped.")


@tool("music_previous", "Go back to the previous track.", schema({}))
async def music_previous(_args: dict[str, Any]) -> dict[str, Any]:
    return await _transport(
        lambda api: api.previous_track(), ("previous",), "Went back."
    )


@tool("music_now_playing", "What song is currently playing.", schema({}))
async def music_now_playing(_args: dict[str, Any]) -> dict[str, Any]:
    api = client()
    try:
        if await api.is_up():
            info = await api.now_playing()
            if not info:
                return ok("Nothing is playing.")
            return ok(cider_mod.describe_track(info))
    except cider_mod.CiderError as exc:
        log.info("now-playing over REST failed (%s); trying MPRIS", exc)

    good, title = await cider_mod.playerctl("metadata", "--format",
                                            "{{title}} by {{artist}}")
    if good and title:
        return ok(f"{title}.")
    return ok("Nothing is playing.")


@tool(
    "music_volume",
    "Set or report Cider's volume as a percentage (0-100).",
    schema({"percent": integer("Target volume, 0 to 100. Omit to report it.")}),
)
async def music_volume(args: dict[str, Any]) -> dict[str, Any]:
    api = client()
    if not await api.is_up():
        return fail("Cider isn't running.")

    percent = args.get("percent")
    try:
        if percent is None:
            current = await api.get_volume()
            return ok(f"Volume is at {round(current * 100)} percent.")
        target = max(0, min(100, int(percent)))
        await api.set_volume(target / 100.0)
        return ok(f"Volume {target} percent.")
    except cider_mod.CiderError as exc:
        return fail(str(exc))


@tool(
    "music_seek",
    "Jump to a position in the current track, in seconds.",
    schema({"seconds": integer("Position from the start, in seconds")},
           required=["seconds"]),
)
async def music_seek(args: dict[str, Any]) -> dict[str, Any]:
    api = client()
    if not await api.is_up():
        return fail("Cider isn't running.")
    try:
        await api.seek(max(0, int(args["seconds"])))
    except cider_mod.CiderError as exc:
        return fail(str(exc))
    return ok("Done.")


@tool("music_shuffle", "Toggle shuffle.", schema({}))
async def music_shuffle(_args: dict[str, Any]) -> dict[str, Any]:
    api = client()
    if not await api.is_up():
        return fail("Cider isn't running.")
    try:
        value = await api.toggle_shuffle()
    except cider_mod.CiderError as exc:
        return fail(str(exc))
    return ok("Shuffle on." if value else "Shuffle off.")


@tool("music_repeat", "Toggle repeat.", schema({}))
async def music_repeat(_args: dict[str, Any]) -> dict[str, Any]:
    api = client()
    if not await api.is_up():
        return fail("Cider isn't running.")
    try:
        value = await api.toggle_repeat()
    except cider_mod.CiderError as exc:
        return fail(str(exc))
    return ok({0: "Repeat off.", 1: "Repeating everything.",
               2: "Repeating this track."}.get(value, "Repeat changed."))


@tool("music_queue", "What's coming up next.", schema({}))
async def music_queue(_args: dict[str, Any]) -> dict[str, Any]:
    api = client()
    if not await api.is_up():
        return fail("Cider isn't running.")
    try:
        items = await api.queue()
    except cider_mod.CiderError as exc:
        return fail(str(exc))

    if not items:
        return ok("The queue is empty.")
    # Spoken, so a long list is useless. Three is plenty.
    names = [cider_mod.describe_track(item.get("attributes") or item).rstrip(".")
             for item in items[:3]]
    return ok("Next up: " + ", then ".join(names) + ".")


TOOLS = [
    music_play, music_pause, music_next, music_previous, music_now_playing,
    music_volume, music_seek, music_shuffle, music_repeat, music_queue,
]

TOOL_NAMES = [f"mcp__music__{t.name}" for t in TOOLS]


def server():
    return create_sdk_mcp_server(name="music", version="1.0.0", tools=TOOLS)

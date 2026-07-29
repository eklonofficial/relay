"""relayd entrypoint."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import signal
import sys

from relay import config as config_mod
from relay.agent.client import SubscriptionUnavailable
from relay.daemon import RelayDaemon
from relay.ipc.server import IPCServer
from relay.paths import PATHS

log = logging.getLogger("relay")


def setup_logging(verbose: bool) -> None:
    PATHS.ensure()
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        handlers=[logging.StreamHandler(sys.stderr), logging.FileHandler(PATHS.log)],
    )
    # The SDK is chatty at debug level.
    logging.getLogger("claude_agent_sdk").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def run(verbose: bool, voice: bool = True) -> int:
    setup_logging(verbose)
    cfg = config_mod.load()

    daemon = RelayDaemon(cfg)
    try:
        await daemon.start()
    except SubscriptionUnavailable as exc:
        # Deliberately fatal: Relay never falls back to paid API billing.
        log.error("%s", exc)
        return 4
    except Exception:
        log.exception("failed to start")
        return 1

    if voice:
        try:
            await daemon.start_voice()
        except Exception:
            # A missing or busy microphone must not stop the text path.
            log.exception("voice loop unavailable; continuing without it")

    server = IPCServer(daemon)
    try:
        await server.start()
    except RuntimeError as exc:
        log.error("%s", exc)
        await daemon.stop()
        return 2

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)

    serving = asyncio.create_task(server.serve_forever())
    try:
        await stop.wait()
    finally:
        log.info("shutting down")
        serving.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await serving
        await server.stop()
        await daemon.stop()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="relayd", description="Relay voice assistant daemon")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--no-voice", action="store_true",
                        help="text path only; do not open the microphone")
    ns = parser.parse_args(argv)
    try:
        return asyncio.run(run(ns.verbose, voice=not ns.no_voice))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

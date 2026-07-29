#!/usr/bin/env python
"""Verify Claude access end to end, and report what it actually costs.

Anthropic's Agent SDK billing arrangement has changed once already and is
currently "paused, not cancelled", so this is worth being able to re-run:
it proves which credential is in use, that a turn completes, and what the
subscription telemetry says.

    uv run python scripts/check_auth.py                 # subscription
    uv run python scripts/check_auth.py --api-key       # ANTHROPIC_API_KEY

Deliberately tiny: one short turn, no tools.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from relay import config  # noqa: E402
from relay.agent.client import RelayAgent, configure_auth, subscription_tier  # noqa: E402
from relay.memory.store import MemoryStore  # noqa: E402


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api-key", action="store_true",
                        help="use ANTHROPIC_API_KEY instead of the subscription")
    parser.add_argument("--prompt", default="Reply with exactly: ok")
    args = parser.parse_args()

    cfg = config.load()
    cfg.agent.auth_mode = "api_key" if args.api_key else "subscription"
    # Don't let a stale ceiling block the check itself.
    cfg.usage.block_at_utilization = 1.0
    cfg.usage.daily_token_ceiling = 10**12

    try:
        credential = configure_auth(cfg.agent.auth_mode)
    except RuntimeError as exc:
        print(f"FAIL  {exc}")
        return 2

    tier = subscription_tier()
    if tier:
        print(f"plan       : {tier['subscription_type']} ({tier['rate_limit_tier']})")
    print(f"auth mode  : {cfg.agent.auth_mode}")
    print(f"credential : {credential}")
    print(f"model      : {cfg.agent.model}")

    with tempfile.TemporaryDirectory() as tmp:
        store = MemoryStore(Path(tmp) / "probe.db").connect()
        agent = RelayAgent(cfg, store, style="Answer in as few words as possible.")
        context_usage = None
        try:
            await agent.start()
            result = await agent.ask(args.prompt, source="probe")
            # Must be read before stop() tears the client down.
            context_usage = await agent._client.get_context_usage()
        except Exception as exc:  # noqa: BLE001
            print(f"\nFAIL  {type(exc).__name__}: {exc}")
            return 1
        finally:
            await agent.stop()

        print(f"\nreply      : {result.text!r}")
        print(f"error      : {result.is_error}")
        print(f"tokens     : in={result.input_tokens} out={result.output_tokens} "
              f"cache_read={result.cache_read_tokens} "
              f"cache_write={result.cache_creation_tokens}")
        # NOT a charge. Claude Code computes this locally from token counts at
        # API list prices. On a subscription it is an API-equivalent estimate
        # only; usage is metered against the plan's rolling windows instead.
        print(f"est. API-equivalent: ${result.cost_usd:.5f} "
              f"(NOT billed on a subscription)" if result.cost_usd else "cost: n/a")
        print(f"duration   : {result.duration_ms} ms")

        if context_usage:
            print(f"context    : {context_usage['totalTokens']:,} tokens")
            for category in sorted(context_usage["categories"], key=lambda c: -c["tokens"]):
                if category["tokens"] and category["name"] not in ("Free space", "Autocompact buffer"):
                    print(f"             {category['tokens']:>7,}  {category['name']}")

        event = agent.last_rate_limit
        if event is None:
            print("rate limit : no event emitted this turn "
                  "(the CLI only sends one when the status changes)")
        else:
            info = event.rate_limit_info
            print(f"rate limit : status={info.status} type={info.rate_limit_type} "
                  f"utilization={info.utilization}")

        store.close()

    print("\nPASS" if not result.is_error else "\nFAIL  turn reported an error")
    return 0 if not result.is_error else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

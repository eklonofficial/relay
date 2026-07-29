#!/usr/bin/env python
"""Measure what a Relay turn actually costs, and where the cost comes from.

Every built-in tool's schema lives in the cached prefix and is re-read on
every turn, so the tool surface is a recurring per-turn cost rather than a
one-off. This compares the full Claude Code tool set against the handful Relay
actually needs.

    uv run python scripts/measure_turn_cost.py
"""

from __future__ import annotations

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from relay import config  # noqa: E402
from relay.agent.client import DEFAULT_BUILTIN_TOOLS, RelayAgent  # noqa: E402
from relay.memory.store import MemoryStore  # noqa: E402

PROMPTS = ["Reply with exactly: one", "Reply with exactly: two", "Reply with exactly: three"]


async def run_case(name: str, builtin_tools) -> float:
    cfg = config.load()
    cfg.usage.block_at_utilization = 1.0
    cfg.usage.daily_token_ceiling = 10**12

    print(f"\n=== {name} ===")
    with tempfile.TemporaryDirectory() as tmp:
        store = MemoryStore(Path(tmp) / "probe.db").connect()
        agent = RelayAgent(cfg, store, style="Answer in as few words as possible.",
                           builtin_tools=builtin_tools)
        steady = 0.0
        try:
            await agent.start()
            print(f"{'turn':>4} {'cache_rd':>9} {'cache_wr':>9} {'cost':>9}")
            costs = []
            for i, prompt in enumerate(PROMPTS, 1):
                r = await agent.ask(prompt, source="probe")
                costs.append(r.cost_usd or 0.0)
                print(f"{i:>4} {r.cache_read_tokens:>9} {r.cache_creation_tokens:>9} "
                      f"{(r.cost_usd or 0):>9.5f}")
            # Turn 1 pays the cache write; steady state is what an always-on
            # assistant actually lives with.
            steady = sum(costs[1:]) / max(1, len(costs) - 1)
            print(f"steady-state ${steady:.5f}/turn")
        except Exception as exc:  # noqa: BLE001
            print(f"FAILED: {type(exc).__name__}: {exc}")
        finally:
            await agent.stop()
            store.close()
        return steady


async def main() -> int:
    full = await run_case("all built-in tools (preset)", {"type": "preset", "preset": "claude_code"})
    trimmed = await run_case(f"Relay's set {DEFAULT_BUILTIN_TOOLS}", DEFAULT_BUILTIN_TOOLS)
    none_ = await run_case("no built-in tools", [])

    print("\n--- steady-state cost per turn ---")
    print(f"  all tools : ${full:.5f}")
    print(f"  relay set : ${trimmed:.5f}"
          + (f"   ({(1 - trimmed / full) * 100:.0f}% cheaper)" if full else ""))
    print(f"  none      : ${none_:.5f}"
          + (f"   ({(1 - none_ / full) * 100:.0f}% cheaper)" if full else ""))
    if trimmed:
        print(f"\n  at 50 turns/day : ${trimmed * 50 * 30:.2f}/month")
        print(f"  at 200 turns/day: ${trimmed * 200 * 30:.2f}/month")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

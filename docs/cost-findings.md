# What Relay costs, and what it consumes

Measured on this machine, `claude-sonnet-5`, subscription auth, July 2026.
Reproduce with `uv run python scripts/check_auth.py`.

## The short version

- **Relay costs £0 in additional charges.** The dollar figures the SDK reports
  are a locally-computed API-equivalent estimate, not a bill.
- **It does consume plan allowance**, from the same pool as claude.ai chat and
  interactive Claude Code.
- **The 38k-token mystery was inherited MCP servers.** Fixed; context dropped
  82%.
- **Relay never falls back to paid API billing.** Enforced in code, with tests.

## 1. Are those dollar figures real charges? No.

From Anthropic's [Claude Code cost documentation](https://code.claude.com/docs/en/costs):

> The Session block in `/usage` shows API token usage and is intended for API
> users. **Claude Max and Pro subscribers have usage included in their
> subscription, so the session cost figure isn't relevant for billing
> purposes.**

> **Claude Code computes the dollar figure locally from token counts priced at
> standard list rates**, so it doesn't reflect promotional pricing or
> contracted discounts and may differ from your actual bill.

Confirmed independently: `total_cost_usd` is passed straight through from the
CLI (`data.get("total_cost_usd")` in the SDK's message parser), not computed
against any billing account. This machine authenticates with subscription OAuth
(`~/.claude/.credentials.json`, `subscriptionType: pro`) and has **no API key
set** — there is no billing relationship for a per-token charge to land on.

**So: the "$0.10" and "$0.02–0.03/turn" figures are an API-equivalent estimate —
what this *would* have cost at list price. They are not charges.**

## 2. How does usage count against the plan?

Against rolling **five-hour** and **weekly** windows, shared across claude.ai
chat, Claude Code, and Relay. The SDK surfaces this directly as
`RateLimitEvent` → `RateLimitInfo`, with `rate_limit_type` values such as
`five_hour` and `seven_day_sonnet`, and a `utilization` fraction.

This machine is on **Pro**, not Max — a smaller allowance than the earlier
projections assumed, and one already shared with regular Claude usage. That is
the real constraint on Relay, and it's why the guardrails below matter more
than any dollar figure.

Relay logs this telemetry per turn and refuses to start a turn above
`usage.block_at_utilization` (default 92%), leaving headroom for the user's own
conversations. It stops rather than degrading, because falling back to paid
billing is not permitted.

## 3. The 38k prefix jump: solved

`get_context_usage()` gives the per-category breakdown, and the answer was
immediate:

```
after connect:   7,996 total    System tools 7,101 · System prompt 887
after turn 2:   46,664 total    MCP tools 38,307  ← 82% of context
```

**38,307 tokens were MCP tool definitions inherited from `~/.claude/`** — the
Canva, Gmail, Google Drive, Chrome and Replit servers configured for
interactive Claude Code. Relay uses none of them, and was re-reading all of
them on every turn.

`setting_sources=[]` does *not* exclude these. The fix is
`strict_mcp_config=True`, which restricts the agent to MCP servers passed
programmatically.

| | inherited | `strict_mcp_config=True` |
|---|---|---|
| Context | 46,708 tokens | **8,263 tokens** |
| MCP tools | 38,307 | **0** |
| Steady state | $0.0267/turn est. | **$0.0073/turn est.** |

**−82% context, −73% estimated cost, zero capability lost.**

## 4. Does trimming actually reduce plan consumption?

**Yes — these are real token reductions, not just a smaller estimate.**

Plan limits are metered on token usage. The context sent per turn genuinely
fell from ~46,700 tokens to ~8,200. Cache reads are cheaper per token than
fresh input but are still metered, so removing 38,307 tokens from every single
turn is a direct, roughly-proportional reduction in what Relay draws from the
allowance. The dollar figure falling is a *symptom* of that, not the substance.

Two separate wins, both real:

1. **Trimming built-in tools** to `Bash, Read, Glob, Grep` — the whole Claude
   Code tool set is otherwise re-read every turn (~16.7k → ~7.1k).
2. **`strict_mcp_config=True`** — removes the inherited 38,307.

Combined: **~46,700 → ~8,200 tokens per turn, an 82% reduction.**

## 5. Reducing consumption further without losing capability

Already applied:

| Lever | Saving | Capability cost |
|---|---|---|
| `strict_mcp_config=True` | −38,307 tok/turn | none |
| Trimmed built-in tools | −9,600 tok/turn | none (MCP tools cover the rest) |
| Static cacheable system prompt | writes 3,186 → 44 | none |
| `effort = "low"` default | fewer thinking tokens | tuneable per task |

Still to come, in rough order of value:

- **Local fast path** (planned). At ~8k tokens/turn, every command answered
  locally is 8k tokens of allowance kept. "Open Discord" should never reach the
  model. This is now the single biggest remaining lever.
- **Session hygiene.** Long sessions resend growing history every turn. Relay
  should end a conversation after idle time and start fresh rather than
  accumulating, which is the documented cause of usage climbing in long
  sessions.
- **Keep the system prompt lean.** It sits in every turn's prefix; the machine
  facts digest is capped at 40 lines for this reason.

## Auth safety

Relay is subscription-only by construction:

- `configure_auth()` **removes** any `ANTHROPIC_API_KEY` from the daemon's
  environment in subscription mode. The SDK builds its subprocess env as
  `{**os.environ, **options.env}`, so `options.env` can only add variables,
  never unset one — without this, a stray key would silently outrank the
  subscription and bill per token with no visible change in behaviour.
- Paid API mode requires **both** `auth_mode = "api_key"` and an explicit
  `allow_paid_api = true`. Neither alone is sufficient.
- Missing subscription credentials raise `SubscriptionUnavailable` and stop.
  There is no automatic fallback, by design.

Covered by tests in `tests/test_agent_auth.py`.

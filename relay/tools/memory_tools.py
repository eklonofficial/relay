"""Memory tools — the model's deliberate access to what Relay knows.

Three separate tools rather than one search, because the three questions want
genuinely different retrieval: graded facts, past conversations, and machine
configuration. Keeping them apart makes "open my browser" a dictionary lookup
instead of a semantic search.
"""

from __future__ import annotations

from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from relay.memory import search as search_mod
from relay.tools.base import boolean, ctx, fail, integer, ok, schema, string

_KINDS = ["fact", "preference", "routine", "entity", "technical_note", "todo", "bug", "decision"]


@tool(
    "memory_search",
    "Search stored facts and preferences. Use for personal, ambiguous or "
    "previously-established things: 'my projects', 'the usual setup'. "
    "Returns nothing if there is no good match — say so rather than guessing.",
    schema(
        {
            "query": string("What to look for, in natural language"),
            "scope": string("Restrict to a scope, e.g. 'project:vice'"),
            "kind": string("Restrict to one kind", enum=_KINDS),
            "limit": integer("Max results (default 6)"),
        },
        required=["query"],
    ),
)
async def memory_search(args: dict[str, Any]) -> dict[str, Any]:
    c = ctx()
    results = search_mod.search(
        c.store,
        args["query"],
        scope=args.get("scope"),
        kind=args.get("kind"),
        active_scope=c.active_scope,
        limit=int(args.get("limit", 6)),
        fts_candidates=c.cfg.memory.fts_candidates,
        vec_candidates=c.cfg.memory.vec_candidates,
        rrf_k=c.cfg.memory.rrf_k,
        half_life_days=c.cfg.memory.recency_half_life_days,
        recency_floor=c.cfg.memory.recency_floor,
    )
    if not results:
        return ok("No stored memory matches that.")
    lines = [f"{r.memory.id}. {r.memory.describe()}" for r in results]
    return ok("\n".join(lines))


@tool(
    "memory_write",
    "Store a fact the user has told you to remember. Only for things they "
    "stated; use memory_observe for behaviour you merely noticed.",
    schema(
        {
            "content": string("The fact, phrased so it makes sense on its own"),
            "scope": string("'global', or 'project:<name>' (default global)"),
            "kind": string("What sort of memory this is", enum=_KINDS),
            "pinned": boolean("Exempt from decay; for long-lived essentials"),
        },
        required=["content"],
    ),
)
async def memory_write(args: dict[str, Any]) -> dict[str, Any]:
    c = ctx()
    try:
        memory_id = c.store.write(
            args["content"],
            scope=args.get("scope", "global"),
            kind=args.get("kind", "fact"),
            source="explicit",
            pinned=bool(args.get("pinned", False)),
        )
    except ValueError as exc:
        return fail(str(exc))
    return ok(f"Stored as memory {memory_id}.")


@tool(
    "memory_forget",
    "Forget a memory. Reversible — the row is kept and can be restored.",
    schema({"memory_id": integer("The id shown by memory_search or memory_list")},
           required=["memory_id"]),
)
async def memory_forget(args: dict[str, Any]) -> dict[str, Any]:
    c = ctx()
    memory_id = int(args["memory_id"])
    memory = c.store.get(memory_id)
    if memory is None:
        return fail(f"No memory with id {memory_id}.")
    c.store.forget(memory_id)
    return ok(f"Forgotten: {memory.content}")


@tool(
    "memory_list",
    "List stored memories, newest first. Use for 'what do you remember about X' "
    "when the user wants a survey rather than a specific lookup.",
    schema({
        "scope": string("Restrict to a scope"),
        "kind": string("Restrict to one kind", enum=_KINDS),
        "limit": integer("Max results (default 20)"),
    }),
)
async def memory_list(args: dict[str, Any]) -> dict[str, Any]:
    c = ctx()
    memories = c.store.list(
        scope=args.get("scope"), kind=args.get("kind"), limit=int(args.get("limit", 20))
    )
    if not memories:
        return ok("Nothing stored for that.")
    return ok("\n".join(f"{m.id}. {m.describe()}" for m in memories))


@tool(
    "memory_observe",
    "Record something you noticed the user do, without treating it as fact. "
    "Repeated observations build confidence and may later be promoted.",
    schema(
        {
            "pattern_key": string("Stable key for this behaviour, e.g. 'app_workspace:discord'"),
            "content": string("The inferred preference, as a sentence"),
            "scope": string("Scope (default global)"),
        },
        required=["pattern_key", "content"],
    ),
)
async def memory_observe(args: dict[str, Any]) -> dict[str, Any]:
    c = ctx()
    observation = c.store.observe(
        args["pattern_key"], args["content"], scope=args.get("scope", "global")
    )
    confidence = c.store.confidence_for(observation.occurrences)
    if confidence >= c.cfg.memory.promotion_threshold:
        return ok(
            f"Noted ({observation.occurrences} times, {confidence}% confident). "
            f"Worth asking the user whether to remember this properly."
        )
    return ok(f"Noted ({observation.occurrences} so far, {confidence}% confident).")


@tool(
    "conversation_search",
    "Search past conversations. Use for 'what did we decide about X' or "
    "'what were we working on' — questions about a discussion, not a stored fact.",
    schema({
        "query": string("What the conversation was about"),
        "limit": integer("Max results (default 5)"),
    }, required=["query"]),
)
async def conversation_search(args: dict[str, Any]) -> dict[str, Any]:
    c = ctx()
    rows = search_mod.search_conversations(
        c.store, args["query"], limit=int(args.get("limit", 5))
    )
    if not rows:
        return ok("No past conversation matches that.")
    lines = []
    for row in rows:
        from datetime import datetime

        when = datetime.fromtimestamp(row["started_at"]).strftime("%d %b")
        lines.append(f"{when} — {row['topic_title'] or 'untitled'}: {row['summary'] or ''}")
    return ok("\n".join(lines))


@tool(
    "system_fact",
    "Look up a fact about this machine by key: browser, editor, terminal, gpu, "
    "wm, and so on. A direct lookup — use this, not memory_search, for "
    "'open my browser'. Omit the key to list everything known.",
    schema({"key": string("The fact to look up, e.g. 'browser'")}),
)
async def system_fact(args: dict[str, Any]) -> dict[str, Any]:
    c = ctx()
    key = args.get("key")
    if not key:
        facts = c.store.all_facts()
        if not facts:
            return ok("Nothing recorded about this machine yet.")
        return ok("\n".join(f"{k}: {v}" for k, v in facts.items()))
    value = c.store.get_fact(key)
    if value is None:
        return ok(f"Nothing recorded for '{key}'.")
    return ok(f"{key}: {value}")


@tool(
    "system_set",
    "Record or correct a fact about this machine. Use when the user tells you "
    "which app they actually use — this overrides anything auto-detected.",
    schema({
        "key": string("Fact name, e.g. 'browser'"),
        "value": string("The value, e.g. 'zen-browser'"),
    }, required=["key", "value"]),
)
async def system_set(args: dict[str, Any]) -> dict[str, Any]:
    c = ctx()
    c.store.set_fact(args["key"], args["value"], source="explicit")
    return ok(f"Recorded {args['key']} as {args['value']}.")


TOOLS = [
    memory_search, memory_write, memory_forget, memory_list,
    memory_observe, conversation_search, system_fact, system_set,
]

TOOL_NAMES = [f"mcp__memory__{t.name}" for t in TOOLS]


def server():
    return create_sdk_mcp_server(name="memory", version="1.0.0", tools=TOOLS)

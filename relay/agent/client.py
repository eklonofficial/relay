"""The Claude Agent SDK client, wrapped with Relay's auth, usage and streaming.

**Relay runs on the user's Claude subscription and must add nothing to their
bill.** It never falls back to paid API billing — not when credentials expire,
not when limits are hit, not when Anthropic changes the rules. If subscription
access stops working, Relay stops and says so.

The relevant consequence is that Relay shares one allowance with the user's
regular Claude conversations and their interactive Claude Code. Tokens spent
here are tokens unavailable there, which is why this module trims the context
aggressively and meters every turn.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
    TextBlock,
)

from relay.agent import prompt as prompt_mod
from relay.agent.stream import SentenceAccumulator, strip_for_speech
from relay.config import MODE_DRY_RUN, Config
from relay.memory.store import MemoryStore

log = logging.getLogger(__name__)

AUTH_SUBSCRIPTION = "subscription"
AUTH_API_KEY = "api_key"

# The built-in tools Relay actually uses. Everything the harness offers is
# loaded into the cached prefix and re-read on every turn, so this list is a
# direct, per-turn cost. Relay's own MCP servers cover apps, windows, memory
# and speech; the model still needs a shell and a way to read and find files.
#
# WebSearch and WebFetch are here because an assistant that cannot answer
# "what's the weather" is not much of one. Relay was not declining to look
# things up -- it had no way to, and said so in the only terms it had, which
# sounded like a refusal.
#
# They run through the Claude subscription like every other turn and add no
# separate billing. They are the only tools here that send anything off this
# machine, so both need confirmation before they run.
DEFAULT_BUILTIN_TOOLS = ["Bash", "Read", "Glob", "Grep", "WebSearch", "WebFetch"]


class UsageLimitReached(RuntimeError):
    """Raised instead of making a request that would eat into reserved quota."""


@dataclass
class TurnResult:
    text: str
    session_id: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0
    cost_usd: float | None = None
    duration_ms: int | None = None
    num_turns: int | None = None
    is_error: bool = False
    tools_used: list[str] = field(default_factory=list)


class SubscriptionUnavailable(RuntimeError):
    """Subscription credentials are missing or unusable.

    Deliberately fatal. Relay will not fall back to paid API billing on its
    own — it stops and says why.
    """


CREDENTIALS_FILE = ".claude/.credentials.json"


def configure_auth(mode: str, *, allow_paid_api: bool = False) -> str:
    """Set up process credentials, enforcing the subscription-only rule.

    Relay is designed to run entirely within the user's existing Claude
    subscription and to add nothing to their bill. Two things protect that:

    1. Subscription mode **removes** any ANTHROPIC_API_KEY from this process.
       The SDK builds its subprocess env as ``{**os.environ, **options.env}``,
       so options.env can only add variables, never unset one — a stray key
       would otherwise silently outrank the subscription and bill per token
       with no visible change in behaviour.

    2. Paid API mode requires an explicit opt-in (``allow_paid_api``) on top of
       selecting it. It is never reached automatically, and there is no
       fallback path from subscription to API.

    Returns a short description of the credential actually in use.
    """
    if mode == AUTH_API_KEY:
        if not allow_paid_api:
            raise RuntimeError(
                "auth_mode is 'api_key', which bills per token outside your Claude "
                "subscription. Relay refuses this unless agent.allow_paid_api is "
                "explicitly set to true in config.toml. If you did not intend to "
                "pay per token, set agent.auth_mode = 'subscription'."
            )
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError(
                "auth_mode is 'api_key' but ANTHROPIC_API_KEY is not set."
            )
        log.warning("using PAID API billing — this is charged separately from your subscription")
        return "api_key(paid)"

    if mode != AUTH_SUBSCRIPTION:
        raise ValueError(f"unknown auth_mode {mode!r}; expected 'subscription' or 'api_key'")

    removed = os.environ.pop("ANTHROPIC_API_KEY", None)
    if removed:
        log.warning(
            "ANTHROPIC_API_KEY was set in the environment and has been ignored, "
            "so requests draw on the Claude subscription rather than paid API billing."
        )

    # CLAUDE_CODE_OAUTH_TOKEN is the non-interactive form of the same
    # subscription credential; leave it in place.
    if os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        return "subscription(oauth_token)"

    if not (Path.home() / CREDENTIALS_FILE).exists():
        raise SubscriptionUnavailable(
            "No Claude subscription credentials found "
            f"(~/{CREDENTIALS_FILE} is missing). Run `claude /login` to sign in. "
            "Relay will not fall back to paid API billing."
        )
    return "subscription(cli_login)"


def subscription_tier() -> dict[str, str] | None:
    """Read the plan and rate-limit tier from the CLI's stored credentials.

    Used only to tell the user which allowance Relay is drawing on. Never
    touches the secret fields.
    """
    path = Path.home() / CREDENTIALS_FILE
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    oauth = data.get("claudeAiOauth") or {}
    return {
        "subscription_type": oauth.get("subscriptionType", "unknown"),
        "rate_limit_tier": oauth.get("rateLimitTier", "unknown"),
    }


class RelayAgent:
    """One persistent Claude session, with usage accounting around it."""

    def __init__(
        self,
        cfg: Config,
        store: MemoryStore,
        *,
        style: str,
        mcp_servers: dict[str, Any] | None = None,
        allowed_tools: list[str] | None = None,
        builtin_tools: list[str] | None = None,
        hooks: dict[str, Any] | None = None,
        cwd: str | None = None,
    ) -> None:
        self.cfg = cfg
        self.store = store
        self.style = style
        self.mcp_servers = mcp_servers or {}
        self.allowed_tools = allowed_tools or []
        # Every built-in tool's schema sits in the cached prefix and is re-read
        # on every single turn. Loading the whole Claude Code tool set costs
        # ~16.7k prefix tokens per turn; Relay only needs a handful, and its
        # own MCP tools cover the rest. See DEFAULT_BUILTIN_TOOLS.
        self.builtin_tools = (
            DEFAULT_BUILTIN_TOOLS if builtin_tools is None else builtin_tools
        )
        self.hooks = hooks or {}
        self.cwd = cwd
        self._client: ClaudeSDKClient | None = None
        self._auth_description: str | None = None
        self._session_id: str | None = None
        self.last_rate_limit: RateLimitEvent | None = None
        self._last_turn_at: float | None = None
        self._turns_this_session = 0
        # Whether the most recent turn called any tools. Read by the daemon to
        # decide whether a single exchange was substantive enough to keep.
        self.last_turn_used_tools = False

    # ------------------------------------------------------------ lifecycle
    def _build_options(self) -> ClaudeAgentOptions:
        facts = self.store.all_facts()
        system_prompt = prompt_mod.build(
            self.cfg,
            style=self.style,
            system_facts=facts,
            profile=[m.content for m in self.store.profile(pinned_only=True)],
            dry_run=self.cfg.mode == MODE_DRY_RUN,
        )
        return ClaudeAgentOptions(
            model=self.cfg.agent.model,
            system_prompt=system_prompt,
            effort=self.cfg.agent.effort,
            max_turns=self.cfg.agent.max_turns,
            max_budget_usd=self.cfg.agent.max_budget_usd,
            tools=self.builtin_tools,
            mcp_servers=self.mcp_servers,
            allowed_tools=self.allowed_tools,
            hooks=self.hooks,
            include_partial_messages=True,
            # Relay's behaviour must come from its own config, not from
            # whatever .claude/ directory the daemon happens to start in.
            setting_sources=[],
            # Critical for cost. Without this the daemon inherits every MCP
            # server configured in ~/.claude/ — measured at 38,307 tokens of
            # Canva/Gmail/Drive/Chrome/Replit definitions on this machine —
            # and re-reads them on every single turn. Relay uses none of them.
            # Turning this on cut context 46,708 -> 8,263 tokens (-82%) with
            # no loss of capability. See docs/cost-findings.md.
            strict_mcp_config=True,
            permission_mode="bypassPermissions",  # Relay's own hook is the gate
            cwd=self.cwd,
        )

    async def start(self) -> None:
        self._auth_description = configure_auth(
            self.cfg.agent.auth_mode,
            allow_paid_api=self.cfg.agent.allow_paid_api,
        )
        log.info("agent auth: %s, model: %s", self._auth_description, self.cfg.agent.model)
        self._client = ClaudeSDKClient(options=self._build_options())
        await self._client.connect()

    async def stop(self) -> None:
        if self._client is not None:
            try:
                await self._client.disconnect()
            except Exception as exc:  # noqa: BLE001
                log.debug("error during disconnect: %s", exc)
            self._client = None

    async def ask_once(self, prompt: str, *, source: str = "aside") -> str:
        """A single question in its own throwaway session.

        Used for bookkeeping the user never sees -- summarising a finished
        conversation, for instance. It deliberately does *not* go through the
        main client: that would append the summarising prompt to the very
        conversation being summarised, and the summary would then be the
        first thing in the next one.

        Carries no tools and no machine facts, so its prefix is a fraction of
        a normal turn.
        """
        self.check_budget()
        started = time.time()
        options = ClaudeAgentOptions(
            model=self.cfg.agent.model,
            system_prompt="You are a precise summariser. Follow the format exactly.",
            effort=self.cfg.agent.effort,
            max_turns=1,
            # No tools, no MCP servers: this is a text-in, text-out task, and
            # the tool definitions are most of what a turn costs.
            tools=[],
            setting_sources=[],
            strict_mcp_config=True,
            cwd=self.cwd,
        )

        client = ClaudeSDKClient(options=options)
        await client.connect()
        try:
            await client.query(prompt)
            parts: list[str] = []
            result_message: ResultMessage | None = None
            async for message in client.receive_response():
                if isinstance(message, RateLimitEvent):
                    self._note_rate_limit(message)
                elif isinstance(message, ResultMessage):
                    result_message = message
                elif isinstance(message, AssistantMessage):
                    parts.extend(block.text for block in message.content
                                 if isinstance(block, TextBlock))
            self._record(result_message, source=source, started=started)
            return "".join(parts)
        finally:
            try:
                await client.disconnect()
            except Exception as exc:  # noqa: BLE001
                log.debug("error disconnecting one-shot client: %s", exc)

    async def interrupt(self) -> None:
        """Stop the current turn — the 'Relay, stop' path."""
        if self._client is not None:
            await self._client.interrupt()

    @property
    def auth_description(self) -> str | None:
        return self._auth_description

    # ------------------------------------------------------- session hygiene
    async def maybe_rotate_session(self) -> str | None:
        """Start a fresh session when the current one has gone stale.

        Every turn resends the whole conversation, so a session left open all
        day makes a question about the weather carry hours of unrelated
        history. Rotating keeps each turn near the ~8k floor instead of
        growing without limit. Returns a reason if it rotated.
        """
        idle_limit = self.cfg.usage.session_idle_minutes * 60
        reason = None

        if idle_limit > 0 and self._last_turn_at is not None:
            idle = time.time() - self._last_turn_at
            if idle > idle_limit:
                reason = f"idle for {idle / 60:.0f} minutes"

        if reason is None and self.cfg.usage.session_max_turns > 0:
            if self._turns_this_session >= self.cfg.usage.session_max_turns:
                reason = f"{self._turns_this_session} turns in this session"

        if reason is None:
            return None

        log.info("rotating session (%s)", reason)
        await self.stop()
        await self.start()
        self._turns_this_session = 0
        return reason

    # ---------------------------------------------------------------- guard
    def check_budget(self) -> None:
        """Refuse a turn that would eat into allowance reserved for the user.

        Relay draws on the same plan allowance as the user's own Claude
        conversations and their interactive Claude Code. The point of stopping
        short of 100% is to leave headroom for those, not to control spending —
        there is no spending. Stopping is the only safe response, since falling
        back to paid API billing is explicitly not allowed.
        """
        # Only act on a *fresh* reading. Telemetry arrives solely when the
        # status changes, so an old value can easily describe a window that
        # has since reset — blocking on that means refusing to work for hours
        # after usage actually dropped.
        latest = self.store.latest_rate_limit(max_age_s=self.cfg.usage.telemetry_max_age_s)
        if latest and latest["utilization"] is not None:
            utilization = float(latest["utilization"])
            if utilization >= self.cfg.usage.block_at_utilization:
                # Deliberately avoids saying the wake word: spoken aloud, it
                # would retrigger the microphone and repeat itself forever.
                raise UsageLimitReached(
                    f"Your Claude plan is {utilization:.0%} used, and I stop at "
                    f"{self.cfg.usage.block_at_utilization:.0%} to leave you some. "
                    f"Raise the limit in config if you want me to keep going."
                )

        day_ago = time.time() - 86400
        totals = self.store.usage_since(day_ago)
        if totals["total_tokens"] >= self.cfg.usage.daily_token_ceiling:
            raise UsageLimitReached(
                f"Relay has used {totals['total_tokens']:,} tokens in the last day, "
                f"which is its configured daily ceiling."
            )

    # ----------------------------------------------------------------- turn
    async def ask(self, text: str, *, source: str = "cli",
                  context: str | None = None) -> TurnResult:
        """Run one turn and return the whole reply."""
        chunks: list[str] = []
        result = await self._run(text, source=source, context=context,
                                 on_sentence=chunks.append)
        if not result.text:
            result.text = " ".join(chunks)
        return result

    async def stream(self, text: str, *, source: str = "voice",
                     context: str | None = None) -> AsyncIterator[str]:
        """Yield speakable sentences as they arrive, for the TTS queue.

        Speech starts while the model is still writing, which is most of the
        difference between an assistant that feels instant and one that
        doesn't.
        """
        if self._client is None:
            raise RuntimeError("agent not started")
        self.check_budget()

        accumulator = SentenceAccumulator()
        started = time.time()
        await self._client.query(self._compose(text, context))

        result_message: ResultMessage | None = None
        async for message in self._client.receive_response():
            if isinstance(message, StreamEvent):
                delta = _text_delta(message)
                if delta:
                    for sentence in accumulator.feed(delta):
                        yield strip_for_speech(sentence)
            elif isinstance(message, RateLimitEvent):
                self._note_rate_limit(message)
            elif isinstance(message, ResultMessage):
                result_message = message

        tail = accumulator.flush()
        if tail:
            yield strip_for_speech(tail)

        self._record(result_message, source=source, started=started)

    async def _run(self, text: str, *, source: str, context: str | None,
                   on_sentence) -> TurnResult:
        if self._client is None:
            raise RuntimeError("agent not started")
        self.check_budget()

        accumulator = SentenceAccumulator()
        started = time.time()
        await self._client.query(self._compose(text, context))

        result_message: ResultMessage | None = None
        tools_used: list[str] = []
        full_text: list[str] = []

        async for message in self._client.receive_response():
            if isinstance(message, StreamEvent):
                delta = _text_delta(message)
                if delta:
                    for sentence in accumulator.feed(delta):
                        on_sentence(strip_for_speech(sentence))
            elif isinstance(message, AssistantMessage):
                for block in message.content:
                    if isinstance(block, TextBlock):
                        full_text.append(block.text)
                    elif getattr(block, "name", None):
                        tools_used.append(block.name)
            elif isinstance(message, RateLimitEvent):
                self._note_rate_limit(message)
            elif isinstance(message, ResultMessage):
                result_message = message

        tail = accumulator.flush()
        if tail:
            on_sentence(strip_for_speech(tail))

        result = self._record(result_message, source=source, started=started)
        result.tools_used = tools_used
        if full_text:
            result.text = strip_for_speech("\n".join(full_text))
        return result

    def _compose(self, text: str, context: str | None) -> str:
        """Volatile context goes *after* the user's words, never in the prefix."""
        if context is None:
            context = prompt_mod.turn_context(
                now=datetime.now().strftime("%A %d %B %Y, %H:%M")
            )
        return f"{text}\n\n<context>\n{context}\n</context>"

    # ---------------------------------------------------------- bookkeeping
    def _note_rate_limit(self, event: RateLimitEvent) -> None:
        self.last_rate_limit = event
        info = event.rate_limit_info
        if info.status in ("allowed_warning", "rejected"):
            log.warning(
                "subscription rate limit %s (%s, %.0f%% used)",
                info.status, info.rate_limit_type or "unknown",
                (info.utilization or 0) * 100,
            )

    def _record(self, message: ResultMessage | None, *, source: str,
                started: float) -> TurnResult:
        result = TurnResult(text="")
        usage: dict[str, Any] = {}

        if message is not None:
            result.session_id = message.session_id
            self._session_id = message.session_id
            result.cost_usd = message.total_cost_usd
            result.duration_ms = message.duration_ms
            result.num_turns = message.num_turns
            result.is_error = message.is_error
            if message.result:
                result.text = strip_for_speech(message.result)
            usage = message.usage or {}

        result.input_tokens = int(usage.get("input_tokens", 0) or 0)
        result.output_tokens = int(usage.get("output_tokens", 0) or 0)
        result.cache_read_tokens = int(usage.get("cache_read_input_tokens", 0) or 0)
        result.cache_creation_tokens = int(usage.get("cache_creation_input_tokens", 0) or 0)
        if result.duration_ms is None:
            result.duration_ms = int((time.time() - started) * 1000)

        self._last_turn_at = time.time()
        self._turns_this_session += 1
        # A turn that used no tools is one request and one reply. Every tool
        # call adds a round trip, so >1 means Relay actually did something
        # rather than just answering. stream() never sees the tool blocks
        # themselves, so this is the signal available to it.
        self.last_turn_used_tools = (result.num_turns or 1) > 1

        info = self.last_rate_limit.rate_limit_info if self.last_rate_limit else None
        self.store.log_usage(
            session_id=result.session_id,
            source=source,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            cache_read_tokens=result.cache_read_tokens,
            cache_creation_tokens=result.cache_creation_tokens,
            cost_usd=result.cost_usd,
            duration_ms=result.duration_ms,
            num_turns=result.num_turns,
            rate_limit_type=info.rate_limit_type if info else None,
            rate_limit_status=info.status if info else None,
            utilization=info.utilization if info else None,
        )
        return result


def _text_delta(event: StreamEvent) -> str | None:
    """Pull assistant text out of a raw streaming event."""
    raw = event.event if isinstance(event.event, dict) else {}
    if raw.get("type") != "content_block_delta":
        return None
    delta = raw.get("delta") or {}
    if delta.get("type") != "text_delta":
        return None
    return delta.get("text") or None

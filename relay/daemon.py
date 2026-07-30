"""relayd — the long-running process that owns everything.

Phase 1 is the text path: memory, tools, permissions and the agent, driven
over a unix socket by the `relay` CLI. Audio hangs off the same core later,
so nothing here assumes a microphone exists.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

from relay import config as config_mod
from relay import system_probe
from relay.agent import prompt as prompt_mod
from relay.agent.client import (
    RelayAgent,
    SubscriptionUnavailable,
    UsageLimitReached,
    subscription_tier,
)
from relay.config import MODE_DRY_RUN, MODE_NORMAL, Config
from relay.memory import distil, signals
from relay.memory.embed import Embedder
from relay.memory.store import MemoryStore
from relay.paths import PATHS
from relay.fastpath import FastPath
from relay.permissions import make_hook
from relay.audio.listener import build_listener
from relay.audio.playback import Playback
from relay.stt.engine import SpeechToText
from relay.tools import base as tool_base
from relay.tools import desktop, files, memory_tools, music, screen
from relay.tts.engine import KokoroTTS
from relay.voice import VoiceLoop

log = logging.getLogger(__name__)


class RelayDaemon:
    """Owns the store, the agent, and the tool surface."""

    def __init__(self, cfg: Config | None = None) -> None:
        self.cfg = cfg or config_mod.load()
        self.store: MemoryStore | None = None
        self.agent: RelayAgent | None = None
        self.started_at = time.time()
        self._lock = asyncio.Lock()  # one turn at a time
        self._dry_run_plan: list[str] = []
        self.fastpath: FastPath | None = None
        self._tool_handlers: dict[str, Any] = {}
        self.voice: VoiceLoop | None = None
        # The orb. `orb` is what the rest of Relay talks to; the bus and the
        # renderer process are plumbing behind it. All three are None when the
        # overlay is disabled or failed to start, and every caller checks.
        self.orb: Any | None = None
        self.overlay_bus: Any | None = None
        self.overlay_process: Any | None = None
        # Turns everything else down while Relay is being spoken to.
        self.ducker: Any | None = None
        # Debounces the orb's return to idle across the gaps between the
        # sentences of one reply.
        self._settle_task: asyncio.Task | None = None
        # What this conversation has covered so far. Only model turns land
        # here — fast-path commands return before it's touched, so "pause the
        # music" can never become a conversation by construction.
        self.turns = distil.TurnBuffer()
        # An observation Relay has asked about and is waiting on an answer
        # for. At most one per conversation, so noticing patterns can never
        # turn into nagging.
        self._pending_promotion: Any | None = None
        self._asked_this_conversation = False
        self._maintenance: asyncio.Task | None = None

    # ------------------------------------------------------------- startup
    async def start(self) -> None:
        config_mod.ensure_user_files()

        embedder = Embedder(
            self.cfg.memory.embed_model,
            dim=self.cfg.memory.embed_dim,
            cache_dir=PATHS.models,
        )
        self.store = MemoryStore(
            PATHS.db,
            embedder=embedder,
            embed_dim=self.cfg.memory.embed_dim,
            promotion_threshold=self.cfg.memory.promotion_threshold,
        ).connect()

        # Refresh what we know about the machine. Explicit user corrections
        # survive this — see MemoryStore.set_fact.
        await asyncio.to_thread(system_probe.probe, self.store)

        tool_base.set_context(tool_base.ToolContext(cfg=self.cfg, store=self.store))

        mcp_servers = {
            "memory": memory_tools.server(),
            "desktop": desktop.server(),
            "files": files.server(),
            "music": music.server(),
            "screen": screen.server(),
        }
        allowed = (memory_tools.TOOL_NAMES + desktop.TOOL_NAMES
                   + files.TOOL_NAMES + music.TOOL_NAMES + screen.TOOL_NAMES)

        # Same tools, reachable directly so the fast path can use them
        # without a model round trip.
        for module, prefix in ((memory_tools, "memory"), (desktop, "desktop"),
                               (files, "files"), (music, "music"),
                               (screen, "screen")):
            for spec in module.TOOLS:
                self._tool_handlers[f"mcp__{prefix}__{spec.name}"] = spec.handler

        self.fastpath = FastPath(self.store, enabled=self.cfg.fast_path_enabled)

        self.agent = RelayAgent(
            self.cfg,
            self.store,
            style=config_mod.load_style(),
            mcp_servers=mcp_servers,
            allowed_tools=allowed,
            hooks={"PreToolUse": [_matcher(make_hook(
                self.cfg, confirm=self._confirm_aloud,
                on_dry_run=self._note_dry_run,
                on_allowed=self._note_signal))]},
        )
        await self.agent.start()
        self._maintenance = asyncio.create_task(
            self._maintain(), name="relay-maintenance")

        tier = subscription_tier() or {}
        log.info(
            "relayd ready — model=%s auth=%s plan=%s mode=%s",
            self.cfg.agent.model, self.agent.auth_description,
            tier.get("subscription_type", "?"), self.cfg.mode,
        )

    async def stop(self) -> None:
        if self._maintenance is not None:
            self._maintenance.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._maintenance
            self._maintenance = None
        await self.stop_voice()
        # Shutting down ends the conversation as surely as an idle timeout.
        if self.agent is not None and self.turns.turns:
            with contextlib.suppress(Exception):
                await self._archive_conversation()
        if self.agent is not None:
            await self.agent.stop()
        if self.store is not None:
            self.store.close()

    @property
    def is_dry_run(self) -> bool:
        return self.cfg.mode == MODE_DRY_RUN

    async def start_voice(self) -> None:
        """Bring up the microphone and the speech models.

        Separate from start() so the text path works on a machine with no
        audio hardware, and so a broken microphone can't stop relayd.
        """
        voices = KokoroTTS(PATHS.models, voice=self.cfg.audio.tts_voice)
        await self._start_overlay()

        from relay.audio.ducking import Ducker

        self.ducker = Ducker(level=self.cfg.audio.duck_level,
                             enabled=self.cfg.audio.duck_others)
        # A previous run may have died between ducking and restoring, and the
        # volume it changed outlives the process that changed it.
        await self.ducker.recover()

        # The orb draws the state; the ducker turns the room down. Neither
        # knows about the other, and either can be absent.
        watchers = tuple(w for w in (self.orb, self.ducker) if w is not None)
        listener = await build_listener(self.cfg, activity=watchers)
        # on_start/on_finish have existed on Playback since it was written and
        # were never used. They are the exact bracket for "Relay is talking",
        # and they carry the clip, so the orb can pulse on the syllables
        # rather than merely being lit.
        playback = Playback(
            on_start=self._speaking_started,
            on_finish=self._speaking_finished,
        )
        self.voice = VoiceLoop(self, listener, SpeechToText(), voices, playback,
                               cooldown_ms=self.cfg.audio.post_speech_cooldown_ms,
                               # Barge-in means leaving the microphone live
                               # while Relay talks, which is only reasonable
                               # now that echo cancellation removes its own
                               # voice from what it hears. `barge_in = false`
                               # goes back to deafening itself while speaking.
                               pause_while_speaking=not self.cfg.audio.barge_in,
                               activity=watchers)
        # The voice loop is built from the listener, so it cannot be passed in
        # as a watcher -- but it has to hear the wake word to stop talking
        # when it is interrupted.
        listener.watch(self.voice)
        # Let tools speak for themselves. Music needs it: starting Cider takes
        # several seconds, and silence during the wait reads as a failure.
        tool_base.ctx().speak = self.voice
        await self.voice.start()

    async def _start_overlay(self) -> None:
        """Bring up the orb, or carry on without it.

        Failing here is never fatal. An assistant that refuses to listen
        because a decoration would not start has its priorities backwards, so
        every path out of this leaves `self.orb` usable and Relay unaffected.
        """
        if not self.cfg.overlay.enabled:
            return
        from relay.overlay import OverlayBus, OverlayState
        from relay.overlay.process import OverlayProcess

        try:
            self.overlay_bus = OverlayBus()
            await self.overlay_bus.start()
            self.orb = OverlayState(self.overlay_bus)
            self.overlay_process = OverlayProcess(env={
                "RELAY_ORB_SOCKET": self.overlay_bus.path,
                "RELAY_ORB_SIZE": self.cfg.overlay.size,
                "RELAY_ORB_TOP": self.cfg.overlay.orb_top,
                "RELAY_ORB_MATERIAL": self.cfg.overlay.material,
            })
            if not await self.overlay_process.start():
                self.overlay_process = None
        except Exception:  # noqa: BLE001
            log.exception("overlay unavailable; continuing without it")
            self.orb = None
            self.overlay_bus = None
            self.overlay_process = None

    async def _speaking_started(self, samples, sample_rate: int) -> None:
        self._cancel_settle()
        if self.orb is not None:
            self.orb.speaking(samples, sample_rate)

    async def _speaking_finished(self) -> None:
        """Relay has stopped talking. Decide, shortly, whether it is done.

        Not immediately: playback fires this at the end of every *sentence*
        and the next is usually already synthesising, so retracting here
        would flicker through a paragraph. Not never, either -- that was the
        bug. This used to hand the orb to `thinking` and rely on the voice
        loop to finish the job, which works for an answer and not at all for
        speech that belongs to no turn: the model manager announcing it has
        dropped to the CPU voice would leave the orb spinning indefinitely,
        because nothing was ever going to come along and end a turn that had
        not started.
        """
        self._cancel_settle()
        if self.orb is None:
            return
        # Inside a turn the turn decides. Synthesising the next sentence of a
        # reply can easily take longer than the timer below, and letting it
        # fire there put the orb away in the middle of an answer that was
        # still being spoken -- then brought it back for the next sentence.
        if self.voice is not None and self.voice.in_turn:
            return
        self._settle_task = asyncio.create_task(self._settle())

    def _cancel_settle(self) -> None:
        if self._settle_task is not None:
            self._settle_task.cancel()
            self._settle_task = None

    async def _settle(self) -> None:
        from relay.overlay.state import SPEAKING

        try:
            # Long enough to cover the gap between two sentences of one
            # reply, short enough not to linger after the last.
            await asyncio.sleep(1.2)
        except asyncio.CancelledError:
            return
        # Only if nothing has taken over in the meantime. After a real turn
        # the follow-up window has already moved the orb to "listening", and
        # that owns it now.
        if self.orb is not None and self.orb.current == SPEAKING:
            self.orb.idle()

    async def stop_voice(self) -> None:
        # Before anything else. Shutting down with the music still turned
        # down leaves the user with quiet audio and nothing running that
        # knows why -- the exact failure the state file exists to catch, and
        # better not to need it.
        if self.ducker is not None:
            with contextlib.suppress(Exception):
                await self.ducker.unduck()
        self.ducker = None
        if self.voice is not None:
            await self.voice.stop()
        if self.overlay_process is not None:
            await self.overlay_process.stop()
            self.overlay_process = None
        if self.overlay_bus is not None:
            await self.overlay_bus.stop()
            self.overlay_bus = None
        self.orb = None

    async def _maintain(self) -> None:
        """Slow background upkeep. Never on the path of a reply."""
        while True:
            try:
                await asyncio.to_thread(self.store.decay)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - housekeeping must not kill the daemon
                log.warning("maintenance pass failed", exc_info=True)
            await asyncio.sleep(24 * 3600)

    async def _archive_conversation(self) -> None:
        """Summarise the finished conversation and keep it, if it earned it.

        Never raises and never blocks a reply: it runs after the answer has
        already been delivered, and losing a summary is not worth surfacing
        an error for.
        """
        buffer, self.turns = self.turns, distil.TurnBuffer()
        # A new conversation earns one fresh chance to ask about a pattern.
        self._asked_this_conversation = False
        self._pending_promotion = None
        if not buffer.turns:
            return

        try:
            distilled = await distil.distil(self.agent, buffer)
            if distilled is None:
                log.debug("conversation not kept (%d turns)", len(buffer))
                return
            title, summary = distilled
            self.store.add_conversation(
                topic_title=title, summary=summary,
                started_at=buffer.started_at, ended_at=time.time(),
                session_id=buffer.session_id,
                scope=tool_base.ctx().active_scope,
            )
            log.info("kept conversation: %s", title)
        except Exception:  # noqa: BLE001 - bookkeeping must not break the daemon
            log.exception("could not archive the conversation")

    def _answer_pending_promotion(self, text: str) -> str | None:
        """Interpret a reply to "should I remember that?", if one is pending.

        Returns what to say back, or None if this wasn't an answer — in which
        case the utterance is handled normally. Being conservative matters:
        mistaking a real command for a "yes" would both store the wrong thing
        and swallow what the user actually asked for.
        """
        observation = self._pending_promotion
        if observation is None:
            return None

        answer = signals.yes_or_no(text)
        if answer is None:
            # Not an answer. Drop the question rather than holding it open --
            # a stale prompt attaching itself to a later "yes" is worse than
            # simply asking again next time.
            self._pending_promotion = None
            return None

        self._pending_promotion = None
        if answer:
            self.store.promote(observation.id, confirmed=True)
            log.info("promoted observation %s", observation.pattern_key)
            return "Noted, I'll remember that."
        self.store.dismiss(observation.id)
        log.info("dismissed observation %s", observation.pattern_key)
        return "Fine, I won't bring it up again."

    def _promotion_question(self) -> str | None:
        """Something worth asking about, at most once per conversation."""
        if self._asked_this_conversation or self._pending_promotion is not None:
            return None
        candidates = self.store.promotable()
        if not candidates:
            return None

        observation = candidates[0]
        self._pending_promotion = observation
        self._asked_this_conversation = True
        return (f"By the way — {observation.content.rstrip('.')}, "
                f"{observation.occurrences} times now. Want me to remember that?")

    def _note_signal(self, tool_name: str, args: dict[str, Any]) -> None:
        """Notice a repeatable preference, if this call is one."""
        signals.record(self.store, tool_name, args)

    def _note_dry_run(self, description: str) -> None:
        # Logged as well as collected: without this there is no way to tell
        # afterwards whether dry run actually blocked anything, or whether the
        # model simply chose to describe the work instead of doing it. Those
        # look identical from the outside and only one of them is a safety
        # property.
        log.info("DRY RUN blocked: %s", description)
        self._dry_run_plan.append(description)

    # ------------------------------------------------------------ commands
    async def handle(
        self,
        command: str,
        args: dict[str, Any],
        *,
        emit: Callable[[str, dict[str, Any]], Awaitable[None]],
        confirm: Callable[[str], Awaitable[bool]] | None = None,
    ) -> None:
        """Dispatch one CLI command, streaming output through `emit`."""
        handler = getattr(self, f"_cmd_{command}", None)
        if handler is None:
            await emit("error", {"text": f"Unknown command '{command}'."})
            return
        await handler(args, emit=emit, confirm=confirm)

    async def _cmd_status(self, _args, *, emit, confirm=None) -> None:
        tier = subscription_tier() or {}
        totals = self.store.usage_since(time.time() - 86400)
        rate = self.store.latest_rate_limit()
        uptime = int(time.time() - self.started_at)

        lines = [
            f"mode        : {self.cfg.mode}",
            f"model       : {self.cfg.agent.model}",
            f"auth        : {self.agent.auth_description} "
            f"(plan: {tier.get('subscription_type', 'unknown')})",
            f"uptime      : {uptime // 3600}h {(uptime % 3600) // 60}m",
            f"memories    : {len(self.store.list(limit=10_000))}",
            f"turns (24h) : {totals['turns']}, {totals['total_tokens']:,} tokens",
        ]
        lines.append("plan usage  : " + _describe_rate_limit(rate, self.cfg))
        await emit("info", {"text": "\n".join(lines)})

    async def _run_tool_direct(self, tool_name: str, args: dict[str, Any]) -> dict[str, Any]:
        """Invoke one of Relay's own tools without going through the model."""
        handler = self._tool_handlers.get(tool_name)
        if handler is None:
            return {"content": [{"type": "text", "text": f"no such tool {tool_name}"}],
                    "is_error": True}
        # The fast path bypasses the model, and therefore the PreToolUse hook,
        # so signals have to be recorded here too. Without this, the commands
        # said most often — the ones the fast path exists to catch — would be
        # the only ones Relay never learned from.
        self._note_signal(tool_name, args)
        return await handler(args)

    async def _cmd_ask(self, args, *, emit, confirm=None) -> None:
        text = (args.get("text") or "").strip()
        if not text:
            await emit("error", {"text": "Nothing to ask."})
            return

        # If Relay asked whether to remember something, this might be the
        # answer. Checked before the fast path, since "no" and "sure" would
        # otherwise fall through to the model as unrecognised commands.
        reply = self._answer_pending_promotion(text)
        if reply is not None:
            await emit("text", {"text": reply})
            return

        # Try to answer locally first. At ~8k tokens of context per model turn,
        # drawn from the same allowance as the user's own conversations, a
        # deterministic "open Discord" should not cost a turn. Falls through
        # whenever it isn't certain.
        if self.cfg.mode != MODE_DRY_RUN and self.fastpath is not None:
            try:
                hit = await self.fastpath.handle(text, run_tool=self._run_tool_direct)
            except Exception:  # noqa: BLE001 - never let the shortcut break the request
                log.exception("fast path failed; deferring to the model")
                hit = None
            if hit is not None:
                self.store.log_usage(source="fastpath")  # zero tokens, still counted
                log.info("fast path handled '%s' as %s (no model call)", text, hit.action)
                await emit("text", {"text": hit.text})
                # Ask here too. The fast path handles the commands said most
                # often, which is exactly where repeated patterns come from --
                # asking only on the model path would mean never asking about
                # the things Relay sees most.
                question = self._promotion_question()
                if question:
                    await emit("text", {"text": question})
                return

        async with self._lock:
            # Drop stale conversation history before it inflates this turn.
            # A rotation means the previous conversation just ended, so this
            # is the moment to keep whatever it came to.
            if await self.agent.maybe_rotate_session():
                await self._archive_conversation()
            self._dry_run_plan.clear()
            # The hook is rebuilt per turn so it closes over this connection's
            # confirmation channel.
            self.agent.hooks = {
                "PreToolUse": [
                    _matcher(make_hook(self.cfg, confirm=confirm,
                                       on_dry_run=self._note_dry_run,
                                       on_allowed=self._note_signal))
                ]
            }
            # Set the scope before building the context, so memory searches
            # made during this turn are ranked against what's on screen.
            focused = await _focused_window()
            tool_base.ctx().active_scope = signals.infer_scope(self.store, focused)
            context = prompt_mod.turn_context(
                now=datetime.now().strftime("%A %d %B %Y, %H:%M"),
                focused_window=focused,
                active_scope=tool_base.ctx().active_scope,
            )
            spoken: list[str] = []
            try:
                async for sentence in self.agent.stream(
                    text, source=args.get("source", "cli"), context=context
                ):
                    spoken.append(sentence)
                    await emit("text", {"text": sentence})
            except UsageLimitReached as exc:
                await emit("error", {"text": str(exc)})
                return
            except SubscriptionUnavailable as exc:
                await emit("error", {"text": str(exc)})
                return

            # Only reached on a completed model turn. A tool call is the
            # signal that something actually happened, which is what lets a
            # one-exchange conversation still be worth remembering.
            self.turns.add(
                text, " ".join(spoken),
                used_tools=self.agent.last_turn_used_tools or bool(self._dry_run_plan),
            )

        if self.cfg.mode == MODE_DRY_RUN and self._dry_run_plan:
            await emit("info", {
                "text": "Dry run — nothing was executed. Would have:\n"
                        + "\n".join(f"  - {step}" for step in self._dry_run_plan)
            })

        # Asked only after the answer has been given, never in the middle of
        # doing something.
        question = self._promotion_question()
        if question:
            await emit("text", {"text": question})

    async def _cmd_mode(self, args, *, emit, confirm=None) -> None:
        requested = (args.get("mode") or "").strip().lower().replace("-", "_")
        if not requested:
            await emit("info", {"text": f"mode is {self.cfg.mode}"})
            return
        if requested not in (MODE_NORMAL, MODE_DRY_RUN):
            await emit("error", {"text": f"Unknown mode '{requested}'. Use normal or dry-run."})
            return
        self.cfg.mode = requested
        # The system prompt changes with the mode, so the session restarts.
        await self.agent.stop()
        await self.agent.start()
        await emit("info", {"text": f"mode is now {requested}"})

    async def _cmd_usage(self, args, *, emit, confirm=None) -> None:
        day = self.store.usage_since(time.time() - 86400)
        week = self.store.usage_since(time.time() - 7 * 86400)
        rate = self.store.latest_rate_limit()
        lines = [
            f"last 24h : {day['turns']} turns, {day['total_tokens']:,} tokens "
            f"({day['cache_read_tokens']:,} cached)",
            f"last 7d  : {week['turns']} turns, {week['total_tokens']:,} tokens",
        ]
        lines.append("plan     : " + _describe_rate_limit(rate, self.cfg))
        lines.append(
            "note     : dollar figures from the SDK are an API-equivalent estimate, "
            "not a charge — Relay runs on your subscription."
        )
        await emit("info", {"text": "\n".join(lines)})

    async def _cmd_memory(self, args, *, emit, confirm=None) -> None:
        action = (args.get("action") or "list").lower()
        if action == "list":
            memories = self.store.list(scope=args.get("scope"), limit=int(args.get("limit", 30)))
            text = "\n".join(f"{m.id}. {m.describe()}" for m in memories) or "Nothing stored."
            await emit("info", {"text": text})
        elif action == "search":
            from relay.memory.search import search as do_search

            results = do_search(self.store, args.get("query", ""), limit=10)
            text = "\n".join(
                f"{r.score:.4f}  {r.memory.describe()}" for r in results
            ) or "No matches."
            await emit("info", {"text": text})
        elif action == "forget":
            ok = self.store.forget(int(args["memory_id"]))
            await emit("info", {"text": "Forgotten." if ok else "No such memory."})
        elif action == "reindex":
            count = await asyncio.to_thread(self.store.reindex)
            await emit("info", {"text": f"Reindexed {count} memories."})
        elif action == "restore":
            good = self.store.restore(int(args["memory_id"]))
            await emit("info", {"text": "Restored." if good else "No such memory."})
        elif action == "review":
            pending = self.store.promotable()
            if not pending:
                await emit("info", {"text": "Nothing waiting to be confirmed."})
                return
            approve = args.get("approve")
            dismiss = args.get("dismiss")
            if approve is not None:
                self.store.promote(int(approve), confirmed=True)
                await emit("info", {"text": "Remembered."})
                return
            if dismiss is not None:
                self.store.dismiss(int(dismiss))
                await emit("info", {"text": "Dismissed."})
                return
            lines = [f"{o.id}. {o.content}  (seen {o.occurrences} times)"
                     for o in pending]
            lines.append("\nrelay memory review --approve <id>  |  --dismiss <id>")
            await emit("info", {"text": "\n".join(lines)})
        elif action == "conversations":
            rows = self.store.conversations(limit=int(args.get("limit", 20)))
            lines = [
                f"{datetime.fromtimestamp(r['started_at']):%d %b %H:%M}  "
                f"{r['topic_title']}\n      {r['summary']}"
                for r in rows
            ]
            await emit("info", {"text": "\n".join(lines) or "No conversations kept yet."})
        else:
            await emit("error", {"text": f"Unknown memory action '{action}'."})

    async def _cmd_facts(self, args, *, emit, confirm=None) -> None:
        facts = self.store.all_facts(category=args.get("category"))
        await emit("info", {"text": "\n".join(f"{k:18} {v}" for k, v in facts.items())
                            or "No machine facts recorded."})

    async def _cmd_profile(self, _args, *, emit, confirm=None) -> None:
        """What Relay believes about the user — the counterpart to `facts`."""
        entries = self.store.profile()
        if not entries:
            await emit("info", {"text": "Relay doesn't know anything about you yet."})
            return

        lines = []
        for memory in entries:
            # The star marks what's in every prompt, as opposed to what has
            # to be searched for. That distinction is the whole design.
            marker = "*" if memory.pinned else " "
            scope = "" if memory.scope == "global" else f"[{memory.scope}] "
            lines.append(f"{marker} {memory.confidence:3}%  {scope}{memory.content}")
        lines.append("\n* = always in Relay's context. The rest it looks up.")
        await emit("info", {"text": "\n".join(lines)})

    async def _cmd_say(self, args, *, emit, confirm=None) -> None:
        text = (args.get("text") or "").strip()
        if not text:
            await emit("error", {"text": "Nothing to say."})
            return
        if self.voice is None:
            await emit("error", {"text": "Voice is not running (started with --no-voice?)."})
            return
        await self.voice.announce(text)
        await emit("info", {"text": f"said: {text}"})

    async def _cmd_mic(self, args, *, emit, confirm=None) -> None:
        """Live microphone diagnostics — is it hearing anything, and is it paused?"""
        if self.voice is None:
            await emit("error", {"text": "Voice is not running."})
            return
        listener = self.voice.listener
        if args.get("reset"):
            listener.reset_stats()
        s = listener.stats()
        lines = [
            f"wake word   : {s['wake_word']} (threshold {s['threshold']})",
            f"device      : index {s['device']} @ {s['capture_rate']} Hz",
            f"frames seen : {s['frames_seen']} "
            f"(mic yielded {s['frames_yielded']}, dropped {s['dropped_frames']}, "
            f"consumers {s['consumers']})",
            f"level       : now {s['last_level']}, peak {s['peak_level']}",
            f"wake score  : now {s['last_score']}, peak {s['peak_score']}",
            f"detections  : {s['detections']} (+{s['follow_ups']} follow-ups, "
            f"{s['push_to_talks']} push-to-talk)",
            f"conversation: {_describe_follow_up(s)}",
            "push-to-talk: SUPER+SPACE  (stop: SUPER+SHIFT+ESC)",
        ]
        if s["paused"]:
            lines.append(f"PAUSED      : yes, for {s['paused_for_s']}s "
                         f"<- not listening while paused")
        else:
            lines.append("paused      : no")
        await emit("info", {"text": "\n".join(lines)})

    async def _cmd_devices(self, _args, *, emit, confirm=None) -> None:
        from relay.audio.capture import list_input_devices

        lines = [f"[{d['index']:>2}] {d['name'][:46]:48} {d['channels']}ch {d['sample_rate']}Hz"
                 for d in list_input_devices()]
        await emit("info", {"text": "\n".join(lines) or "No input devices."})

    async def _cmd_ping(self, _args, *, emit, confirm=None) -> None:
        await emit("info", {"text": "pong"})

    async def _confirm_aloud(self, description: str) -> bool:
        """The voice path's answer to "should I?".

        Wired at construction because the agent is built before the voice
        loop exists; it resolves `self.voice` at call time instead. Without
        it the hook has no confirmation channel and denies outright, so Relay
        would announce that it needed permission and then refuse whatever you
        answered -- the refusal having already happened.
        """
        if self.voice is None:
            return False
        return await self.voice.confirm(description)

    async def _cmd_reload_voice(self, _args, *, emit, confirm=None) -> None:
        """Pick up a voice chosen by `relay voice`, without a restart.

        Only the voice name changes, and Kokoro takes it per call rather than
        at load, so nothing has to be reloaded -- which is why this can be a
        two-line command instead of a tier restart.
        """
        if self.voice is None:
            await emit("error", {"text": "Voice is not running."})
            return
        fresh = config_mod.load()
        self.cfg.audio.tts_voice = fresh.audio.tts_voice
        self.voice.voices.voice = fresh.audio.tts_voice
        await emit("info", {"text": f"voice: {fresh.audio.tts_voice}"})

    async def _cmd_overlay(self, args, *, emit, confirm=None) -> None:
        """Drive the orb by hand, or report on it.

        Tuning an animation by saying "Relay, what time is it" forty times is
        no way to work, and half the states barely last long enough to see.
        """
        from relay.overlay.state import STATES

        if self.orb is None:
            enabled = self.cfg.overlay.enabled
            await emit("error", {"text":
                "The orb isn't running." if enabled
                else "The orb is disabled ([overlay] enabled = false)."})
            return

        scrub = args.get("scrub")
        if scrub is not None:
            self.orb.scrub(float(scrub))
            await emit("info", {"text": f"orb held at {float(scrub):.2f}"})
            return

        state = (args.get("state") or "").strip().lower()
        if not state or state == "status":
            lines = [f"state    : {self.orb.current}"]
            if self.overlay_bus is not None:
                s = self.overlay_bus.stats()
                lines.append(f"socket   : {s['socket']}")
                lines.append(f"watching : {s['clients']} "
                             f"({s['sent']} sent, {s['dropped']} dropped)")
            if self.overlay_process is not None:
                p = self.overlay_process.stats()
                lines.append(f"renderer : {'running' if p['running'] else 'down'} "
                             f"({p['starts']} starts)")
                if p["error"]:
                    lines.append(f"last error: {p['error']}")
            await emit("info", {"text": "\n".join(lines)})
            return

        if state not in STATES:
            await emit("error", {"text":
                f"Unknown state {state!r}. Try: {', '.join(STATES)}."})
            return
        self.orb.set(state)
        await emit("info", {"text": f"orb: {state}"})

    async def _cmd_listen(self, _args, *, emit, confirm=None) -> None:
        """Push-to-talk. Bound to a key, so the reply has to be terse."""
        if self.voice is None:
            await emit("error", {"text": "The voice loop isn't running."})
            return
        await self.voice.listen_now()
        await emit("info", {"text": "listening"})

    async def _cmd_abort(self, _args, *, emit, confirm=None) -> None:
        """Stop talking and drop the rest of the turn."""
        if self.voice is None:
            await emit("error", {"text": "The voice loop isn't running."})
            return
        self.voice.abort()
        await emit("info", {"text": "stopped"})


def _describe_follow_up(stats: dict) -> str:
    """Whether Relay is still listening without needing the wake word."""
    if stats["follow_up_seconds"] <= 0:
        return "off (set audio.follow_up_seconds to enable)"
    if stats["follow_up_open"]:
        return "LISTENING now — no wake word needed"
    if stats.get("follow_up_pending"):
        return "waiting for the room to go quiet before listening again"
    return f"{stats['follow_up_seconds']:g}s window opens after each answer"


def _describe_rate_limit(row, cfg) -> str:
    """Render plan usage, making staleness explicit.

    Telemetry only arrives when the status changes, so the newest stored
    reading can describe a window that has since reset. Printing it as though
    it were current is how "98% used" ends up on screen while the dashboard
    says 70%.
    """
    if row is None or row["utilization"] is None:
        return "no telemetry yet (Claude reports it only when the status changes)"

    age_s = time.time() - row["ts"]
    percent = f"{float(row['utilization']):.0%} of {row['rate_limit_type']}"
    if age_s <= cfg.usage.telemetry_max_age_s:
        return f"{percent} (as of {age_s/60:.0f} min ago)"
    return (f"{percent} — but that reading is {age_s/60:.0f} min old, so it is "
            f"ignored; check claude.ai/settings/usage for the real figure")


def _matcher(hook):
    """Wrap a hook so it applies to every tool."""
    from claude_agent_sdk import HookMatcher

    return HookMatcher(matcher=None, hooks=[hook])


async def _focused_window() -> str | None:
    """One line of 'what am I looking at', for turn context."""
    try:
        code, out, _ = await tool_base.run("hyprctl", "-j", "activewindow", timeout=3)
        if code != 0 or not out.strip():
            return None
        import json

        client = json.loads(out)
        if not client.get("class"):
            return None
        workspace = (client.get("workspace") or {}).get("id")
        return f"{client['class']} on workspace {workspace} — {(client.get('title') or '')[:60]}"
    except Exception:  # noqa: BLE001 - context is optional, never fatal
        return None


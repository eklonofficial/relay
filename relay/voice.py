"""The voice loop: wake word to spoken answer.

    listen -> transcribe -> (fast path | model) -> speak

Two decisions shape this. First, the fast path runs before the model, so
"open Discord" costs nothing from the plan allowance. Second, the microphone
is paused while Relay speaks: without echo cancellation a desktop speaker
feeds straight back into the wake word detector, and Relay hears itself.
"""

from __future__ import annotations

import asyncio
import logging
import time

from relay.agent.client import UsageLimitReached
from relay.audio.listener import Listener, Utterance
from relay.audio.playback import Playback
from relay.stt.engine import SpeechToText
from relay.tts.engine import VoiceRouter

log = logging.getLogger(__name__)

# Said before the microphone is handed to transcription, so an interruption
# feels immediate rather than queued behind a sentence.
STOP_WORDS = {"stop", "cancel", "never mind", "nevermind", "shut up", "quiet"}


class VoiceLoop:
    def __init__(
        self,
        daemon,
        listener: Listener,
        stt: SpeechToText,
        voices: VoiceRouter,
        playback: Playback,
        *,
        pause_while_speaking: bool = True,
        cooldown_ms: int = 600,
        activity=None,
    ) -> None:
        self.daemon = daemon
        # The orb, or nothing. Same duck-typed contract the listener uses.
        self.activity = activity
        self.listener = listener
        self.stt = stt
        self.voices = voices
        self.playback = playback
        self.pause_while_speaking = pause_while_speaking
        self.cooldown_s = cooldown_ms / 1000.0
        self._task: asyncio.Task | None = None
        self._watchdog: asyncio.Task | None = None
        # Suppresses an identical spoken message repeating. If every turn
        # fails the same way, saying so once is help; saying it on a loop
        # is not.
        self._last_spoken: tuple[str, float] | None = None
        # Set by abort(). A model reply arrives sentence by sentence and each
        # is spoken as it lands, so stopping playback alone just means the
        # next sentence starts. This flag abandons the rest of the turn.
        self._aborted = False

    async def start(self) -> None:
        self.listener.microphone.start()
        await self.playback.start()
        await self.stt.load()
        self._task = asyncio.create_task(self._run(), name="relay-voice")
        # Watches for the capture stream dying silently -- which is what a
        # suspend/resume does to it -- and reopens the device.
        self._watchdog = asyncio.create_task(
            self.listener.microphone.watch(), name="relay-mic-watchdog")
        log.info("voice loop listening")

    async def stop(self) -> None:
        for task in (self._task, self._watchdog):
            if task is None:
                continue
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._task = self._watchdog = None
        await self.playback.stop()
        self.listener.microphone.stop()

    def abort(self) -> None:
        """Stop speaking and abandon whatever is left of this turn.

        Synchronous on purpose: it is called from an IPC command that should
        take effect the instant the key is pressed, not after the current
        sentence finishes synthesising.
        """
        self._aborted = True
        self.playback.interrupt()
        self.listener.close_follow_up()
        self._show("idle")
        log.info("aborted")

    def _show(self, state: str) -> None:
        """Move the orb, if there is one. Never raises."""
        if self.activity is None:
            return
        try:
            getattr(self.activity, state)()
        except Exception:  # noqa: BLE001
            log.debug("overlay %s failed", state, exc_info=True)

    async def listen_now(self) -> None:
        """Push-to-talk: barge in and take a command immediately.

        Order matters. Stop the speech first, then trigger -- the listener
        drains the microphone as part of triggering, and anything captured
        before that point is Relay's own voice coming back off the speakers.
        """
        self.abort()
        self.listener.trigger()

    async def announce(self, text: str) -> None:
        """Speak something that isn't part of a turn.

        `say()` stays quiet once the turn has been aborted, which is right for
        the sentences still streaming out of a reply the user just stopped.
        It is wrong for anything that arrives on its own: `relay say`, and the
        model manager reporting that it has dropped to the CPU voice. Those
        have nothing to do with the abandoned turn, and silently swallowing
        them means Relay stops explaining itself exactly when it degrades.
        """
        self._aborted = False
        await self.say(text)

    async def say(self, text: str) -> None:
        """Speak a line, pausing the microphone so Relay doesn't hear itself."""
        text = text.strip()
        if not text:
            return
        if self._aborted:
            return
        try:
            speech = await self.voices.synthesise(text)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not synthesise %r: %s", text[:40], exc)
            return

        if self.pause_while_speaking:
            self.listener.pause()
        try:
            await self.playback.say(speech.audio, speech.sample_rate)
            await self.playback.wait_until_idle()
            # The speakers are still settling and the room still ringing when
            # sd.wait() returns, so keep ignoring input a moment longer.
            if self.cooldown_s:
                await asyncio.sleep(self.cooldown_s)
        finally:
            if self.pause_while_speaking:
                # Resetting the detector matters: without it the tail of
                # Relay's own speech can retrigger the wake word.
                self.listener.resume()

    async def say_once(self, text: str, *, within_s: float = 120.0) -> None:
        """Say something, unless it was just said.

        Failure messages otherwise repeat on every attempt, which is how a
        stuck condition turns into Relay talking at you on a loop.
        """
        now = time.monotonic()
        if self._last_spoken:
            previous, when = self._last_spoken
            if previous == text and now - when < within_s:
                log.info("suppressing repeat: %s", text[:60])
                return
        self._last_spoken = (text, now)
        await self.say(text)

    # ------------------------------------------------------------- the loop
    async def _run(self) -> None:
        async for utterance in self.listener.utterances():
            try:
                await self._handle(utterance)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - one bad turn must not end the loop
                log.exception("voice turn failed")
                await self.say("Something went wrong with that one.")

    async def _handle(self, utterance: Utterance) -> None:
        # A new turn clears any abort left over from the previous one.
        self._aborted = False
        # The user has stopped talking; from here to the first spoken word is
        # all "working", whether that's transcription, the fast path or the
        # model. Splitting it finer would only make the orb flicker.
        self._show("thinking")
        transcript = await self.stt.transcribe(utterance.audio)
        if transcript.is_empty:
            # Background chatter caught by the follow-up window looks exactly
            # like this. Close it rather than staying open and grabbing more.
            self.listener.close_follow_up()
            self._show("idle")
            log.info("nothing intelligible; not treating it as a command")
            return

        text = transcript.text
        spoken = text.strip().lower().rstrip(".!?")

        if spoken in STOP_WORDS:
            self.abort()
            return

        # Fast path first: no model call, no plan usage.
        hit = None
        if self.daemon.fastpath is not None and not self.daemon.is_dry_run:
            try:
                hit = await self.daemon.fastpath.handle(
                    text, run_tool=self.daemon._run_tool_direct
                )
            except Exception:  # noqa: BLE001
                log.exception("fast path failed; deferring to the model")

        if hit is not None:
            self.daemon.store.log_usage(source="voice_fastpath")
            log.info("fast path handled %r as %s (no model call)", text, hit.action)
            await self.say(hit.text)
            self._offer_follow_up()
            return

        await self._ask_model(text)
        self._offer_follow_up()

    def _offer_follow_up(self) -> None:
        """Keep listening briefly so the next thing said needs no wake word.

        Opened only after Relay has finished speaking -- say() resumes the
        listener on the way out, and the cooldown has already elapsed, so the
        window can't be triggered by Relay's own voice.
        """
        # An aborted turn shouldn't leave a window hanging open: either the
        # user said "stop", or push-to-talk has already started a new turn.
        # Whatever happens to the follow-up window, the turn is over and the
        # orb goes back into the bezel.
        self._show("idle")
        if self._aborted or self.listener.triggered:
            return
        self.listener.open_follow_up()

    async def _ask_model(self, text: str) -> None:
        sentences: list[str] = []
        try:
            async for sentence in self.daemon.agent.stream(text, source="voice"):
                if self._aborted:
                    log.info("abandoning the rest of the reply")
                    return
                sentences.append(sentence)
                # Speak each sentence as it lands rather than waiting for the
                # whole reply, which is most of the difference between feeling
                # instant and feeling slow.
                await self.say(sentence)
        except UsageLimitReached as exc:
            await self.say_once(str(exc))
            return

        if not sentences:
            await self.say("I didn't get a response to that.")

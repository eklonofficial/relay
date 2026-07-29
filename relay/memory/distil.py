"""Turning a finished conversation into something worth keeping.

Separate from `store.py` on purpose: storage is a database concern and this
makes a model call, and mixing the two makes the store impossible to test
without an agent.

Two questions live here, and the first matters more than the second.

**Is this worth keeping at all?** Most of what Relay handles is not a
conversation. "Pause the music", "open Discord", "what time is it" are
commands, and a database full of them makes `conversation_search` worse than
empty -- every real search would surface a wall of "user asked to pause the
music". Fast-path turns never reach here at all, since they return before the
model is involved. What's left still needs a filter, applied below.

**What did it come to?** A short topic title and a couple of sentences about
what was decided or established. Not a transcript: the original requirement
was "the important bits", topic-named and dated, and a transcript is neither
smaller nor more useful than the conversation it replaces.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

# One exchange is a command, not a conversation. Two is a thread.
MIN_TURNS = 2
# A single turn can still be worth keeping if it clearly did something, or if
# the answer was long enough to have contained real substance.
SUBSTANTIVE_REPLY_CHARS = 220

DISTIL_PROMPT = """\
Summarise this conversation for a searchable memory. Reply with exactly two \
lines and nothing else:

TITLE: a short topic name, under 60 characters
SUMMARY: two or three sentences on what was decided, established or learned

Write the summary so it is useful months later to someone who has forgotten \
the conversation. Record outcomes and decisions, not the back-and-forth. If \
nothing was actually settled, say so plainly rather than inventing substance.

Conversation:
{transcript}
"""


@dataclass
class Turn:
    utterance: str
    reply: str
    used_tools: bool = False


@dataclass
class TurnBuffer:
    """The current conversation, accumulating until the session rotates."""

    session_id: str | None = None
    started_at: float = field(default_factory=time.time)
    turns: list[Turn] = field(default_factory=list)

    def add(self, utterance: str, reply: str, *, used_tools: bool = False) -> None:
        self.turns.append(Turn(utterance.strip(), reply.strip(), used_tools))

    def clear(self) -> None:
        self.turns.clear()
        self.started_at = time.time()
        self.session_id = None

    def __len__(self) -> int:
        return len(self.turns)

    def transcript(self) -> str:
        parts = []
        for turn in self.turns:
            parts.append(f"User: {turn.utterance}")
            if turn.reply:
                parts.append(f"Relay: {turn.reply}")
        return "\n".join(parts)


def is_worth_keeping(buffer: TurnBuffer) -> bool:
    """Does this deserve a row in the conversation history?

    Deliberately strict. A false negative loses one summary; a false positive
    pollutes search for every future query.
    """
    if not buffer.turns:
        return False
    if len(buffer.turns) >= MIN_TURNS:
        return True

    # A single exchange, so it has to justify itself.
    only = buffer.turns[0]
    if only.used_tools:
        return True
    return len(only.reply) >= SUBSTANTIVE_REPLY_CHARS


def parse(reply: str) -> tuple[str, str] | None:
    """Pull TITLE and SUMMARY out of the model's answer.

    Tolerant of the model wrapping, re-ordering or omitting the labels --
    a malformed summary should cost the conversation, not raise.
    """
    title = ""
    summary_lines: list[str] = []
    in_summary = False

    for raw in reply.splitlines():
        line = raw.strip()
        if not line:
            continue
        upper = line.upper()
        if upper.startswith("TITLE:"):
            title = line[len("TITLE:"):].strip()
            in_summary = False
        elif upper.startswith("SUMMARY:"):
            summary_lines.append(line[len("SUMMARY:"):].strip())
            in_summary = True
        elif in_summary:
            summary_lines.append(line)

    summary = " ".join(part for part in summary_lines if part).strip()
    if not title and not summary:
        return None
    if not title:
        # Better a truncated first sentence than nothing to search on.
        title = summary.split(".")[0][:60]
    return title[:120], summary


async def distil(agent, buffer: TurnBuffer) -> tuple[str, str] | None:
    """One model call, off the hot path. None means "don't store it".

    Runs after the reply has already been spoken, so it never delays an
    answer, and failure is logged rather than surfaced -- losing a summary is
    not worth interrupting the user for.
    """
    if not is_worth_keeping(buffer):
        log.debug("conversation too slight to keep (%d turns)", len(buffer))
        return None

    prompt = DISTIL_PROMPT.format(transcript=buffer.transcript())
    try:
        reply = await agent.ask_once(prompt, source="distil")
    except Exception:  # noqa: BLE001 - never let bookkeeping break the daemon
        log.warning("could not distil the conversation", exc_info=True)
        return None

    parsed = parse(reply or "")
    if parsed is None:
        log.warning("distillation returned nothing usable: %r", (reply or "")[:120])
    return parsed

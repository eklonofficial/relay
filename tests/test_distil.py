"""Keeping what a conversation came to.

The filter matters more than the summary. Relay handles far more commands
than conversations, and a `conversations` table full of "user asked to pause
the music" is worse than an empty one — every real search would have to wade
through it. So the bar for keeping something is deliberately high, and a
false negative (losing one summary) is much cheaper than a false positive.
"""

import pytest

from relay.memory import distil
from relay.memory.distil import TurnBuffer, is_worth_keeping, parse
from relay.memory.store import MemoryStore


def buffer_with(*turns, used_tools=False) -> TurnBuffer:
    buffer = TurnBuffer()
    for utterance, reply in turns:
        buffer.add(utterance, reply, used_tools=used_tools)
    return buffer


# --------------------------------------------------------------- the filter
def test_an_empty_buffer_is_never_kept():
    assert not is_worth_keeping(TurnBuffer())


def test_a_single_throwaway_exchange_is_dropped():
    """"What time is it" is a command, not a conversation."""
    assert not is_worth_keeping(buffer_with(("what time is it", "It's five past four.")))


def test_two_exchanges_make_a_conversation():
    assert is_worth_keeping(buffer_with(
        ("how should I structure this?", "Use ffmpeg directly."),
        ("what about re-encoding?", "Fall back to a second pass."),
    ))


def test_one_exchange_that_did_something_is_kept():
    """A single turn that actually acted is worth remembering, even though a
    single turn that only answered isn't."""
    assert is_worth_keeping(buffer_with(
        ("move all my clips into folders by date", "Done, sorted 40 files."),
        used_tools=True,
    ))


def test_one_long_answer_is_kept():
    """Length is a proxy for substance when no tool ran."""
    long_reply = "x" * (distil.SUBSTANTIVE_REPLY_CHARS + 1)
    assert is_worth_keeping(buffer_with(("explain how the wake word works", long_reply)))


def test_one_short_answer_is_not():
    assert not is_worth_keeping(buffer_with(("is Discord open?", "Yes.")))


# --------------------------------------------------------------- the buffer
def test_the_transcript_reads_as_a_dialogue():
    buffer = buffer_with(("hello", "hi"), ("how are you", "fine"))
    assert buffer.transcript() == "User: hello\nRelay: hi\nUser: how are you\nRelay: fine"


def test_clearing_resets_the_clock_and_the_turns():
    buffer = buffer_with(("a", "b"))
    started = buffer.started_at
    buffer.clear()
    assert len(buffer) == 0
    assert buffer.started_at >= started


def test_whitespace_is_trimmed_on_the_way_in():
    buffer = TurnBuffer()
    buffer.add("  spaced  ", "  out  ")
    assert buffer.turns[0].utterance == "spaced"


# ---------------------------------------------------------------- parsing
def test_a_well_formed_reply_is_parsed():
    title, summary = parse("TITLE: ffmpeg strategy\nSUMMARY: Call it directly.")
    assert title == "ffmpeg strategy"
    assert summary == "Call it directly."


def test_a_multi_line_summary_is_joined():
    title, summary = parse(
        "TITLE: Wake word\nSUMMARY: Trained on his voice.\nThreshold is 0.85."
    )
    assert summary == "Trained on his voice. Threshold is 0.85."


def test_the_labels_are_matched_case_insensitively():
    assert parse("title: x\nsummary: y") == ("x", "y")


def test_blank_lines_do_not_break_it():
    title, summary = parse("\nTITLE: x\n\nSUMMARY: y\n\n")
    assert (title, summary) == ("x", "y")


def test_a_missing_title_falls_back_to_the_first_sentence():
    """Better a truncated title than nothing to search on."""
    title, summary = parse("SUMMARY: Decided to use ffmpeg. Then went home.")
    assert title == "Decided to use ffmpeg"
    assert summary.startswith("Decided to use ffmpeg")


def test_an_unusable_reply_returns_nothing():
    assert parse("") is None
    assert parse("I'm sorry, I can't help with that") is None


def test_an_overlong_title_is_truncated():
    title, _ = parse(f"TITLE: {'x' * 400}\nSUMMARY: y")
    assert len(title) <= 120


# ------------------------------------------------------------- distillation
class FakeAgent:
    def __init__(self, reply="TITLE: t\nSUMMARY: s", explode=False):
        self.reply = reply
        self.explode = explode
        self.calls = []

    async def ask_once(self, prompt, *, source="aside"):
        self.calls.append((prompt, source))
        if self.explode:
            raise RuntimeError("model unavailable")
        return self.reply


async def test_a_slight_conversation_never_reaches_the_model():
    """The filter runs first, so trivia costs nothing at all — not even the
    summarising call."""
    agent = FakeAgent()
    assert await distil.distil(agent, buffer_with(("hi", "hello"))) is None
    assert agent.calls == [], "should not have spent a turn"


async def test_a_real_conversation_is_summarised():
    agent = FakeAgent("TITLE: ffmpeg\nSUMMARY: Use it directly.")
    result = await distil.distil(agent, buffer_with(("a", "b"), ("c", "d")))
    assert result == ("ffmpeg", "Use it directly.")


async def test_the_transcript_is_sent_to_the_model():
    agent = FakeAgent()
    await distil.distil(agent, buffer_with(("question one", "answer one"),
                                           ("question two", "answer two")))
    prompt = agent.calls[0][0]
    assert "question one" in prompt and "answer two" in prompt


async def test_a_failing_model_call_loses_the_summary_not_the_daemon():
    agent = FakeAgent(explode=True)
    assert await distil.distil(agent, buffer_with(("a", "b"), ("c", "d"))) is None


async def test_an_unparseable_summary_is_discarded():
    agent = FakeAgent("I couldn't summarise that.")
    assert await distil.distil(agent, buffer_with(("a", "b"), ("c", "d"))) is None


# ------------------------------------------------------------------ storage
@pytest.fixture
def store(tmp_path):
    return MemoryStore(tmp_path / "relay.db").connect()


def test_a_conversation_can_be_stored_and_listed(store):
    store.add_conversation(topic_title="ffmpeg strategy",
                           summary="Call it directly.", started_at=1000.0)
    rows = store.conversations()
    assert len(rows) == 1
    assert rows[0]["topic_title"] == "ffmpeg strategy"


def test_an_empty_conversation_is_refused(store):
    with pytest.raises(ValueError):
        store.add_conversation(topic_title="  ", summary="  ", started_at=1.0)


def test_conversations_come_back_newest_first(store):
    store.add_conversation(topic_title="older", summary="s", started_at=1000.0)
    store.add_conversation(topic_title="newer", summary="s", started_at=2000.0)
    assert [r["topic_title"] for r in store.conversations()] == ["newer", "older"]


def test_a_stored_conversation_is_searchable(store):
    """The read path — FTS triggers, vector index, RRF — was already built.
    This asserts the new write path actually feeds it."""
    from relay.memory import search as search_mod

    store.add_conversation(
        topic_title="ffmpeg strategy for Vice",
        summary="Decided to call ffmpeg directly rather than use a wrapper.",
        started_at=1000.0,
    )
    hits = search_mod.search_conversations(store, "ffmpeg wrapper decision", limit=5)
    assert hits, "the conversation should be findable"
    assert "ffmpeg" in hits[0]["topic_title"]


def test_the_summary_body_is_searchable_not_just_the_title(store):
    from relay.memory import search as search_mod

    store.add_conversation(
        topic_title="Clip handling",
        summary="Stream copy first, re-encode only near the cut boundary.",
        started_at=1000.0,
    )
    assert search_mod.search_conversations(store, "stream copy", limit=5)


def test_a_conversation_can_be_scoped(store):
    store.add_conversation(topic_title="t", summary="s", started_at=1.0,
                           scope="project:vice")
    assert store.conversations()[0]["scope"] == "project:vice"

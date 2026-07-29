import pytest

from relay.agent.stream import SentenceAccumulator, strip_for_speech


def feed_all(text: str, chunk: int = 3) -> tuple[list[str], str | None]:
    """Feed text in small pieces, the way tokens actually arrive."""
    acc = SentenceAccumulator()
    out = []
    for i in range(0, len(text), chunk):
        out.extend(acc.feed(text[i : i + chunk]))
    return out, acc.flush()


def test_sentences_emit_as_soon_as_they_complete():
    acc = SentenceAccumulator()
    assert acc.feed("Discord is open") == []
    assert acc.feed(" now. ") == ["Discord is open now."]


def test_streaming_in_tiny_chunks_still_splits_correctly():
    sentences, tail = feed_all("Discord is on workspace two. Zen is on one. Done!")
    assert sentences == ["Discord is on workspace two.", "Zen is on one."]
    assert tail == "Done!"


def test_flush_returns_trailing_text_without_punctuation():
    acc = SentenceAccumulator()
    acc.feed("no trailing period here")
    assert acc.flush() == "no trailing period here"
    assert acc.flush() is None


@pytest.mark.parametrize(
    "text",
    ["It took 3.5 seconds.", "That's 0.75 of the limit."],
)
def test_decimals_do_not_split_a_sentence(text):
    sentences, tail = feed_all(text)
    assert sentences == [text.strip()] or tail == text.strip()
    # Crucially, never a fragment ending mid-number.
    assert all(not s.rstrip().endswith("3.") for s in sentences)


def test_abbreviations_do_not_split():
    sentences, _ = feed_all("Dr. Smith called. Ring back.")
    assert sentences[0] == "Dr. Smith called."


def test_question_and_exclamation_are_boundaries():
    sentences, tail = feed_all("Ready? Yes! Go.")
    # The last sentence has no trailing whitespace, so it can't be classified
    # mid-stream (it might continue) and is released by flush instead.
    assert sentences == ["Ready?", "Yes!"]
    assert tail == "Go."


def test_ambiguous_trailing_period_waits_for_more_text():
    """The streaming case that makes naive splitting wrong: at the moment we
    see "0." we cannot know whether "75" follows."""
    acc = SentenceAccumulator()
    assert acc.feed("That's 0.") == [], "emitted a fragment before disambiguating"
    assert acc.feed("75 of the limit. ") == ["That's 0.75 of the limit."]


# --------------------------------------------------------- speech cleanup
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("**Done** already", "Done already"),
        ("run `ls -la` now", "run ls -la now"),
        ("# Heading\ntext", "Heading\ntext"),
        ("- one\n- two", "one\ntwo"),
        ("see [the docs](https://x.com)", "see the docs"),
        ("*emphasis* here", "emphasis here"),
    ],
)
def test_markdown_is_stripped_before_speaking(raw, expected):
    """The style rules forbid markdown, but a stray marker otherwise gets
    read aloud as 'asterisk asterisk'."""
    assert strip_for_speech(raw) == expected


def test_code_fences_are_removed_entirely():
    spoken = strip_for_speech("Here you go:\n```python\nprint('hi')\n```\nDone.")
    assert "print" not in spoken
    assert "Done." in spoken

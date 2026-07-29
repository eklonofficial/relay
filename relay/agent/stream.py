"""Turning a token stream into speakable chunks.

TTS wants whole sentences: synthesising per-token produces choppy audio, while
waiting for the full reply adds seconds of silence before Relay says anything.
This accumulates deltas and emits a sentence as soon as one is complete, so
speech starts while the model is still writing.
"""

from __future__ import annotations

import re

# Sentence-final punctuation followed by whitespace.
#
# Whitespace is required rather than optional: mid-stream, a period at the very
# end of the buffer is ambiguous. "That's 0." could continue into "75", and
# "Dr." could continue into " Smith". We can only classify it once the next
# character arrives, so an unterminated boundary stays buffered until then and
# is resolved by flush() at end of turn.
_BOUNDARY = re.compile(r"([.!?…])(\s+)")

# Don't split after these — they end in a period but not a sentence.
_ABBREVIATIONS = {
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st",
    "e.g", "i.e", "etc", "vs", "approx", "no",
    "a.m", "p.m", "u.s", "u.k",
}

# Very short fragments are usually a false boundary ("Yes." is fine, but a
# stray "3." from a list is not worth a synthesis call on its own).
_MIN_CHARS = 2


class SentenceAccumulator:
    """Feed it text deltas; get back complete sentences."""

    def __init__(self, min_chars: int = _MIN_CHARS) -> None:
        self._buffer = ""
        self._min_chars = min_chars

    def feed(self, delta: str) -> list[str]:
        """Add a chunk of streamed text, returning any sentences it completed."""
        self._buffer += delta
        out: list[str] = []

        while True:
            sentence, remainder = self._split_once(self._buffer)
            if sentence is None:
                break
            self._buffer = remainder
            cleaned = sentence.strip()
            if cleaned:
                out.append(cleaned)
        return out

    def flush(self) -> str | None:
        """Emit whatever is left, at end of turn."""
        remaining = self._buffer.strip()
        self._buffer = ""
        return remaining or None

    def _split_once(self, text: str) -> tuple[str | None, str]:
        for match in _BOUNDARY.finditer(text):
            end = match.end(1)
            candidate = text[:end]
            if len(candidate.strip()) < self._min_chars:
                continue
            if _ends_with_abbreviation(candidate):
                continue
            if _is_decimal_point(text, match.start(1)):
                continue
            return candidate, text[match.end() :]
        return None, text


def _ends_with_abbreviation(text: str) -> bool:
    trailing = text.rstrip()
    if not trailing.endswith("."):
        return False
    word = re.split(r"[\s(]", trailing[:-1])[-1].lower()
    return word in _ABBREVIATIONS


def _is_decimal_point(text: str, index: int) -> bool:
    """'3.5 seconds' must not split after the 3."""
    if text[index] != ".":
        return False
    before = text[index - 1] if index > 0 else ""
    after = text[index + 1] if index + 1 < len(text) else ""
    return before.isdigit() and after.isdigit()


def strip_for_speech(text: str) -> str:
    """Remove formatting the model shouldn't have produced but sometimes does.

    The style rules tell it not to use markdown, but a stray list marker or
    code fence otherwise gets read out as "asterisk asterisk".
    """
    text = re.sub(r"```[\s\S]*?```", " ", text)      # fenced code
    text = re.sub(r"`([^`]*)`", r"\1", text)          # inline code
    text = re.sub(r"\*\*([^*]*)\*\*", r"\1", text)    # bold
    text = re.sub(r"(?<!\w)\*([^*]+)\*(?!\w)", r"\1", text)  # italics
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)  # headers
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)       # bullets
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)               # links
    return re.sub(r"[ \t]+", " ", text).strip()

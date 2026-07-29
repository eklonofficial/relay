"""Learning from repeated behaviour.

Two things are being protected here.

**The observation table must stay meaningful.** It is an allowlist, not a
filter: recording every tool call is how a memory system fills with noise,
and noise is what "polluted with random assumptions" describes. A signal
earns a place only if repeating it three times plausibly means something.

**A "yes" must really be a yes.** The promotion question is answered by the
user's *next* utterance, so mistaking a command for an answer would both
store the wrong thing and swallow what they actually asked for.
"""

import pytest

from relay.memory import signals
from relay.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path):
    return MemoryStore(tmp_path / "relay.db").connect()


# ------------------------------------------------------------- what counts
def test_moving_a_window_is_a_preference():
    signal = signals.signal_for("mcp__desktop__move_window_to_workspace",
                                {"window_class": "discord", "workspace": 2})
    key, content, kind = signal
    assert key == "app_workspace:discord"
    assert "workspace 2" in content
    assert kind == "preference"


def test_the_pattern_key_identifies_the_pattern_not_the_instance():
    """Repetition is only countable if the key is stable across occurrences,
    so the destination belongs in the content, not the key."""
    first = signals.signal_for("mcp__desktop__move_window_to_workspace",
                               {"window_class": "discord", "workspace": 2})
    second = signals.signal_for("mcp__desktop__move_window_to_workspace",
                                {"window_class": "discord", "workspace": 5})
    assert first[0] == second[0]
    assert first[1] != second[1]


def test_launching_without_a_workspace_is_not_a_preference():
    """"Opens Discord sometimes" says nothing. "Opens Discord on workspace 2"
    does."""
    assert signals.signal_for("mcp__desktop__launch_app",
                              {"command": "discord"}) is None
    assert signals.signal_for("mcp__desktop__launch_app",
                              {"command": "discord", "workspace": 2}) is not None


def test_setting_the_volume_is_a_preference():
    key, content, _ = signals.signal_for("mcp__music__music_volume",
                                         {"percent": 30})
    assert key == "music_volume_preference"
    assert "30" in content


def test_reading_the_volume_is_not():
    assert signals.signal_for("mcp__music__music_volume", {}) is None


@pytest.mark.parametrize("tool", [
    "mcp__desktop__list_windows",
    "mcp__desktop__focus_window",
    "mcp__music__music_pause",
    "mcp__screen__read_screen",
    "mcp__memory__memory_search",
    "Bash",
    "Read",
])
def test_ordinary_actions_are_not_recorded(tool):
    """The allowlist is the point. Everything not on it is noise."""
    assert signals.signal_for(tool, {"command": "x", "workspace": 1}) is None


def test_a_missing_app_name_is_ignored():
    assert signals.signal_for("mcp__desktop__move_window_to_workspace",
                              {"workspace": 2}) is None


def test_the_server_prefix_is_stripped():
    assert signals.signal_for("move_window_to_workspace",
                              {"window_class": "discord", "workspace": 2})


# --------------------------------------------------------------- recording
def test_repeating_an_action_builds_occurrences(store):
    for _ in range(3):
        signals.record(store, "mcp__desktop__move_window_to_workspace",
                       {"window_class": "discord", "workspace": 2})
    rows = store.db.execute("SELECT occurrences FROM observations").fetchall()
    assert rows[0]["occurrences"] == 3


def test_three_occurrences_becomes_promotable(store):
    for _ in range(3):
        signals.record(store, "mcp__desktop__move_window_to_workspace",
                       {"window_class": "discord", "workspace": 2})
    assert len(store.promotable()) == 1


def test_two_occurrences_is_not_enough(store):
    """Twice is a coincidence."""
    for _ in range(2):
        signals.record(store, "mcp__desktop__move_window_to_workspace",
                       {"window_class": "discord", "workspace": 2})
    assert store.promotable() == []


def test_nothing_is_written_to_memories_until_promotion(store):
    for _ in range(5):
        signals.record(store, "mcp__desktop__move_window_to_workspace",
                       {"window_class": "discord", "workspace": 2})
    assert store.list() == [], "observations must not leak into memories"


def test_a_confirmed_promotion_stores_at_high_confidence(store):
    for _ in range(3):
        signals.record(store, "mcp__desktop__move_window_to_workspace",
                       {"window_class": "discord", "workspace": 2})
    memory_id = store.promote(store.promotable()[0].id, confirmed=True)
    assert store.get(memory_id).confidence == 90


def test_a_dismissed_observation_is_never_raised_again(store):
    for _ in range(3):
        signals.record(store, "mcp__desktop__move_window_to_workspace",
                       {"window_class": "discord", "workspace": 2})
    store.dismiss(store.promotable()[0].id)
    assert store.promotable() == []

    # ...and it stays dismissed even if the behaviour continues.
    for _ in range(3):
        signals.record(store, "mcp__desktop__move_window_to_workspace",
                       {"window_class": "discord", "workspace": 2})
    assert store.promotable() == []


def test_a_broken_store_does_not_break_the_action(store):
    """Failing to learn must never cost the user what they actually asked
    for."""
    class Broken:
        def observe(self, *a, **k):
            raise RuntimeError("database is on fire")

    signals.record(Broken(), "mcp__desktop__move_window_to_workspace",
                   {"window_class": "discord", "workspace": 2})


# ------------------------------------------------------------- yes or no
@pytest.mark.parametrize("said", ["yes", "yeah", "yep", "sure", "ok", "do it",
                                  "go ahead", "please do", "Yes.", " YES "])
def test_clear_agreement_is_understood(said):
    assert signals.yes_or_no(said) is True


@pytest.mark.parametrize("said", ["no", "nope", "nah", "no thanks",
                                  "forget it", "never mind", "No!"])
def test_clear_refusal_is_understood(said):
    assert signals.yes_or_no(said) is False


@pytest.mark.parametrize("said", [
    "yes open discord and put it on workspace three",
    "no wait what time is it",
    "sure but first pause the music",
    "what's playing",
    "put discord on workspace 2",
    "",
])
def test_anything_that_is_not_purely_an_answer_is_left_alone(said):
    """A command that merely starts with "yes" is still a command. Treating
    it as an answer would store the wrong thing *and* drop the request."""
    assert signals.yes_or_no(said) is None


def test_a_short_yes_phrase_still_counts():
    assert signals.yes_or_no("yes please") is True

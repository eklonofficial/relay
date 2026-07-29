"""Fast path behaviour.

Two things matter more than coverage: it must never act when unsure, and it
must never perform something the permission hook would have gated.
"""

import pytest

from relay.fastpath import FastPath, normalise, parse_workspace
from relay.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path):
    with MemoryStore(tmp_path / "m.db") as s:
        # Mirror what the prober records on this machine.
        s.set_fact("browser", "zen-browser", source="probed")
        s.set_fact("editor", "code", source="probed")
        s.set_fact("music", "cider", source="probed")
        yield s


@pytest.fixture
def calls():
    return []


@pytest.fixture
def run_tool(calls):
    async def _run(name, args):
        calls.append((name, args))
        return {"content": [{"type": "text", "text": f"did {name}"}]}

    return _run


@pytest.fixture
def fast(store):
    return FastPath(store)


# ------------------------------------------------------------- normalising
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Please open Discord", "open Discord"),
        ("could you open discord for me", "open discord"),
        ("open discord thanks", "open discord"),
        ("  what time is it?  ", "what time is it"),
    ],
)
def test_filler_is_stripped(raw, expected):
    assert normalise(raw) == expected


@pytest.mark.parametrize(
    ("token", "expected"),
    [("2", 2), ("two", 2), ("ten", 10), ("99", None), ("banana", None), (None, None)],
)
def test_workspace_parsing(token, expected):
    assert parse_workspace(token) == expected


# ------------------------------------------------------------------ hits
async def test_launch_a_real_binary(fast, run_tool, calls):
    result = await fast.handle("open kitty", run_tool=run_tool)
    assert result is not None
    assert calls == [("mcp__desktop__launch_app", {"command": "kitty"})]


async def test_role_words_resolve_through_machine_facts(fast, run_tool, calls):
    """'my browser' must become zen-browser, not a semantic search."""
    result = await fast.handle("open my browser", run_tool=run_tool)
    assert result is not None
    assert calls[0][1]["command"] == "zen-browser"


async def test_launch_onto_a_named_workspace(fast, run_tool, calls):
    await fast.handle("open kitty on workspace two", run_tool=run_tool)
    assert calls[0][1] == {"command": "kitty", "workspace": 2}


async def test_move_window_to_workspace(fast, run_tool, calls):
    await fast.handle("put kitty on workspace 2", run_tool=run_tool)
    assert calls == [
        ("mcp__desktop__move_window_to_workspace", {"workspace": 2, "window_class": "kitty"})
    ]


async def test_switch_workspace(fast, run_tool, calls):
    await fast.handle("go to workspace 3", run_tool=run_tool)
    assert calls == [("mcp__desktop__switch_workspace", {"workspace": 3})]


async def test_time_and_date_need_no_tool_at_all(fast, run_tool, calls):
    assert "It's" in (await fast.handle("what time is it", run_tool=run_tool)).text
    assert "It's" in (await fast.handle("what day is it", run_tool=run_tool)).text
    assert calls == [], "answering the time should not touch a tool"


# --------------------------------------------------------------- fall-through
@pytest.mark.parametrize(
    "utterance",
    [
        "open the pod bay doors",              # not a real binary
        "open my quantum flux capacitor",      # unknown role word
        "find all the clips I took yesterday", # needs real reasoning
        "open discord and tell margo I'm late",# compound request
        "what's on workspace 2",               # a question, not a command
        "remember my projects are in ~/Projects",
        "open something",
        "",
    ],
)
async def test_unsure_input_falls_through_to_the_model(fast, run_tool, calls, utterance):
    assert await fast.handle(utterance, run_tool=run_tool) is None
    assert calls == [], "nothing should have been executed"


async def test_unresolvable_role_word_falls_through(store, run_tool, calls):
    """A role with no recorded binary must not be guessed at."""
    store.set_fact("browser", "not-installed-anywhere", source="explicit")
    fast = FastPath(store)
    assert await fast.handle("open my browser", run_tool=run_tool) is None
    assert calls == []


async def test_disabled_fast_path_always_falls_through(store, run_tool, calls):
    fast = FastPath(store, enabled=False)
    assert await fast.handle("open kitty", run_tool=run_tool) is None
    assert calls == []


# ------------------------------------------------------------------ safety
async def test_fast_path_never_performs_an_ask_tier_action(store, calls):
    """The security property: it can't bypass the permission hook.

    close_window is ASK tier because it can lose unsaved work, so even though
    the phrasing is simple, the fast path must defer to the model.
    """
    fast = FastPath(store)

    async def run_tool(name, args):
        calls.append((name, args))
        return {"content": [{"type": "text", "text": "closed"}]}

    assert await fast.handle("close kitty", run_tool=run_tool) is None
    assert calls == []


async def test_failed_tool_defers_to_the_model(store, calls):
    """If focusing fails because nothing is open, the model may want to
    launch it instead — so a failure is a fall-through, not an answer."""
    fast = FastPath(store)

    async def failing(name, args):
        calls.append((name, args))
        return {"content": [{"type": "text", "text": "no such window"}], "is_error": True}

    assert await fast.handle("focus kitty", run_tool=failing) is None
    assert len(calls) == 1  # it tried, then handed over


async def test_explicit_alias_beats_guessing(store, run_tool, calls):
    store.set_fact("app_music", "cider", source="explicit")
    fast = FastPath(store)
    await fast.handle("open music", run_tool=run_tool)
    assert calls[0][1]["command"] == "cider"


# ----------------------------------------------------------------- ordinals
@pytest.mark.parametrize(
    ("day", "expected"),
    [(1, "1st"), (2, "2nd"), (3, "3rd"), (4, "4th"), (11, "11th"), (12, "12th"),
     (13, "13th"), (21, "21st"), (22, "22nd"), (23, "23rd"), (28, "28th"), (31, "31st")],
)
def test_spoken_ordinals(day, expected):
    """Dates are read aloud, so '28 of July' has to become '28th of July'."""
    from relay.fastpath import ordinal

    assert ordinal(day) == expected


# ------------------------------------------------------- wake word stripping
@pytest.mark.parametrize(
    ("transcript", "expected"),
    [
        ("Relay, what time is it?", "what time is it"),
        ("Relay what time is it", "what time is it"),
        ("relay. open discord", "open discord"),
        ("Hey Relay, go to workspace 2", "go to workspace 2"),
        ("Relay Organize My Clips", "Organize My Clips"),
        ("Jarvis, open discord", "open discord"),
        # No wake word present: left alone.
        ("open discord", "open discord"),
        # A word that merely starts similarly must not be eaten.
        ("relate these two files", "relate these two files"),
    ],
)
def test_wake_word_is_stripped_from_the_transcript(transcript, expected):
    """STT returns the wake word too, since recording starts before it.

    Without stripping, every spoken command misses the fast path and costs a
    model turn.
    """
    assert normalise(transcript) == expected


async def test_spoken_command_with_wake_word_hits_the_fast_path(fast, run_tool, calls):
    result = await fast.handle("Relay, what time is it?", run_tool=run_tool)
    assert result is not None and "It's" in result.text


async def test_spoken_launch_with_wake_word_hits_the_fast_path(fast, run_tool, calls):
    await fast.handle("Relay, open kitty", run_tool=run_tool)
    assert calls == [("mcp__desktop__launch_app", {"command": "kitty"})]

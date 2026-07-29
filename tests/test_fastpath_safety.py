"""What stops the fast path hijacking a real request.

The worry is reasonable: if "pause" is matched by a regex, what happens to
"pause the music and tell me what time it is"? Two mechanisms answer it, and
both are asserted here because a regression in either is silent -- the fast
path would simply start doing the wrong thing, confidently and for free.

  1. **Anchoring.** Every pattern is `^...$`, so the *entire* utterance has to
     be the command. A trailing clause leaves nothing for `$` and the whole
     thing goes to the model.

  2. **Resolution.** An app name is only accepted if it maps to a recorded
     alias, a role word, or a real graphical application.
"""

import pytest

from relay.fastpath import FastPath, has_desktop_entry, normalise
from relay.memory.store import MemoryStore


@pytest.fixture
def fast(tmp_path, monkeypatch):
    store = MemoryStore(tmp_path / "relay.db")
    store.connect()
    fp = FastPath(store, enabled=True)

    async def live():
        return True

    monkeypatch.setattr(fp, "music_is_live", live)
    return fp


class Recorder:
    def __init__(self):
        self.calls = []

    async def __call__(self, tool_name, args):
        self.calls.append((tool_name, args))
        return {"content": [{"type": "text", "text": "done"}]}


async def _handled(fast, text):
    recorder = Recorder()
    result = await fast.handle(text, run_tool=recorder)
    return result, recorder


# ------------------------------------------------- keywords inside requests
@pytest.mark.parametrize("said", [
    "pause the music and tell me what time it is",
    "can you pause my spotify and also open discord",
    "what's playing on the radio in the other room",
    "skip the intro of this youtube video",
    "next, tell me about the weather",
    "go back to what we were discussing",
    "stop what you're doing and explain this code",
    "open the file I was editing and fix the bug",
    "what time is the meeting tomorrow",
    "set the volume of my headphones to 40 percent in pavucontrol",
    "show me what's on my screen",
    "open a new tab and search for cats",
    "focus on the important part of this",
    "move the window I was using to another monitor",
    "play the album I was listening to yesterday",
])
async def test_a_keyword_inside_a_larger_request_does_not_hijack_it(fast, said):
    result, recorder = await _handled(fast, said)
    assert result is None, f"{said!r} was hijacked by the fast path"
    assert recorder.calls == []


async def test_politeness_is_still_stripped(fast):
    """Filler must not push an ordinary command to the model -- that would
    make the whole optimisation depend on speaking curtly."""
    result, _ = await _handled(fast, "could you pause the music please")
    assert result is not None


def test_normalisation_removes_only_filler():
    assert normalise("Relay, could you pause the music please") == "pause the music"
    # ...and leaves anything substantive in place, so `$` still fails.
    assert normalise("pause the music and open discord") == "pause the music and open discord"


# --------------------------------------------------- app-name resolution
def test_a_cli_tool_is_not_mistaken_for_an_application(fast):
    """Regression.

    `shutil.which` alone was the test, and plenty of ordinary English words
    are also coreutils: date, info, look, chat, w. So "show me the date"
    resolved to /usr/bin/date and tried to focus a window belonging to it,
    instead of just answering with the date.
    """
    assert fast.resolve_app("date") is None
    assert fast.resolve_app("look") is None
    assert fast.resolve_app("info") is None


@pytest.mark.parametrize("said", ["show me the date", "start date", "open info",
                                  "show me look", "focus w"])
async def test_command_line_words_go_to_the_model(fast, said):
    result, recorder = await _handled(fast, said)
    assert result is None or result.action == "date", said
    if result is None:
        assert recorder.calls == []


def test_a_multi_word_phrase_is_never_guessed_at(fast):
    assert fast.resolve_app("the file I was editing") is None
    assert fast.resolve_app("a new tab") is None


def test_an_absurdly_long_phrase_is_rejected(fast):
    assert fast.resolve_app("x" * 200) is None


def test_a_recorded_alias_still_wins(fast, monkeypatch):
    """An explicit alias is the user's own instruction, so it outranks any
    heuristic about desktop entries."""
    fast.store.set_fact("app_notes", "kitty", source="explicit")
    monkeypatch.setattr("relay.fastpath.shutil.which", lambda name: f"/usr/bin/{name}")
    assert fast.resolve_app("notes") == "kitty"


def test_a_role_word_resolves_through_system_facts(fast):
    fast.store.set_fact("browser", "true", source="probed")   # `true` is real
    assert fast.resolve_app("browser") == "true"


def test_a_role_word_pointing_at_nothing_defers(fast):
    fast.store.set_fact("editor", "not-a-real-binary-anywhere", source="probed")
    assert fast.resolve_app("my editor") is None


# ------------------------------------------------------- desktop entries
def test_real_applications_are_recognised():
    """These are installed on this machine and all ship a .desktop file."""
    assert has_desktop_entry("kitty")


def test_coreutils_are_not_recognised():
    assert not has_desktop_entry("date")
    assert not has_desktop_entry("cat")
    assert not has_desktop_entry("ls")


def test_decorated_entry_names_still_match(monkeypatch):
    """Discord installs `discord-460807638964371468.desktop`, so an exact
    filename match would miss it."""
    from relay import fastpath

    monkeypatch.setattr(fastpath, "_desktop_entries",
                        lambda: frozenset({"discord-460807638964371468"}))
    assert fastpath.has_desktop_entry("discord")
    # ...but a prefix that isn't a name boundary must not match.
    assert not fastpath.has_desktop_entry("disc")


# ------------------------------------------------------- the safety net
async def test_the_fast_path_can_never_run_a_gated_action(fast, monkeypatch):
    """The permission classifier decides here too, so the fast path cannot
    become a way around a confirmation prompt."""
    from relay.permissions import Tier

    monkeypatch.setattr("relay.fastpath.classify",
                        lambda name, args: (Tier.ASK, "needs confirmation"))
    result, recorder = await _handled(fast, "open discord")

    assert result is None, "an ASK-tier action must go to the model"
    assert recorder.calls == [], "and must not have been executed"

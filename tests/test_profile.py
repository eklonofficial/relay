"""What Relay knows about the user.

Identity lives in `memories`, not `system_facts`. That table describes the
*machine*, is overwritten by a probe on every start, and has no confidence,
dates or supersession — so "I'm a senior now" would have no way to replace
"I'm a junior" without destroying the history.

The other decision under test is the pinned/unpinned split: pinned identity
renders into every system prompt, everything else is searched for. Getting
that wrong doesn't break anything visibly — it just quietly puts the user's
dog in front of the model on every turn about window management.
"""

import pytest

from relay import config as config_mod
from relay.agent import prompt as prompt_mod
from relay.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path):
    return MemoryStore(tmp_path / "relay.db").connect()


# ------------------------------------------------------------------ storage
def test_identity_is_a_valid_kind(store):
    store.write("The user is Andrew Marin.", kind="identity")
    assert len(store.profile()) == 1


def test_the_profile_is_empty_before_anything_is_stored(store):
    assert store.profile() == []


def test_only_identity_memories_appear(store):
    store.write("The user is Andrew Marin.", kind="identity")
    store.write("Projects live in ~/Projects", kind="fact")
    store.write("Prefers dark mode", kind="preference")
    contents = [m.content for m in store.profile()]
    assert contents == ["The user is Andrew Marin."]


def test_pinned_entries_come_first(store):
    store.write("Plays tennis.", kind="identity")
    store.write("The user is Andrew Marin.", kind="identity", pinned=True)
    assert store.profile()[0].content == "The user is Andrew Marin."


def test_pinned_only_returns_just_the_prompt_block(store):
    store.write("The user is Andrew Marin.", kind="identity", pinned=True)
    store.write("Has a German Shepherd named Drake.", kind="identity")
    assert [m.content for m in store.profile(pinned_only=True)] == [
        "The user is Andrew Marin."
    ]


def test_forgetting_removes_it_from_the_profile(store):
    memory_id = store.write("Is 5 foot 7.", kind="identity")
    store.forget(memory_id)
    assert store.profile() == []


def test_a_superseded_fact_leaves_the_profile_but_not_the_database(store):
    """"I'm a senior now" must replace "I'm a junior" without destroying the
    record that he was once a junior."""
    old = store.write("Andrew is a junior.", kind="identity")
    new = store.write("Andrew is a senior.", kind="identity", supersedes=old)

    live = [m.content for m in store.profile()]
    assert live == ["Andrew is a senior."]
    assert store.get(old) is not None, "the old row must still be readable"
    assert store.get(old).superseded_by == new


def test_identity_can_be_scoped_to_a_project(store):
    store.write("Maintains Vice.", kind="identity", scope="project:vice")
    assert store.profile()[0].scope == "project:vice"


def test_stated_facts_are_stored_at_full_confidence(store):
    memory_id = store.write("The user is Andrew Marin.", kind="identity",
                            source="explicit")
    assert store.get(memory_id).confidence == 100


# ------------------------------------------------------------------- prompt
def test_the_profile_block_is_rendered_when_there_is_one():
    text = prompt_mod.build(
        config_mod.Config(), style="be brief",
        profile=["The user is Andrew Marin."],
    )
    assert "# About the user" in text
    assert "- The user is Andrew Marin." in text


def test_no_profile_means_no_empty_heading():
    text = prompt_mod.build(config_mod.Config(), style="be brief")
    assert "# About the user" not in text


def test_the_block_is_capped_so_it_cannot_grow_without_limit():
    """It sits in the cached prefix of every turn. An unbounded list here is
    how a memory system quietly becomes context stuffing."""
    rendered = prompt_mod._render_profile([f"fact {i}" for i in range(50)])
    assert rendered.count("\n") < 12
    assert "memory_search" in rendered, "should say where the rest lives"


def test_the_user_block_comes_before_the_machine_block():
    text = prompt_mod.build(
        config_mod.Config(), style="be brief",
        profile=["The user is Andrew Marin."],
        system_facts={"gpu": "RTX 4060"},
    )
    assert text.index("# About the user") < text.index("# This machine")


def test_identity_does_not_leak_into_machine_facts(store):
    """Putting "M1 MacBook Air" in system_facts would corrupt answers about
    *this* machine's hardware."""
    store.write("Andrew also has an M1 MacBook Air.", kind="identity")
    assert store.all_facts() == {} or "MacBook" not in str(store.all_facts())


# -------------------------------------------------------------------- style
def test_the_default_style_asks_for_occasional_name_use():
    """Requested explicitly: by name sometimes, not so often it stands out."""
    style = config_mod.DEFAULT_STYLE.lower()
    assert "name occasionally" in style
    assert "not every reply" in style


# ------------------------------------------------------------------ seeding
def test_seeding_is_idempotent(store, monkeypatch):
    from scripts import seed_profile

    first_written, first_skipped = seed_profile.seed(store)
    second_written, second_skipped = seed_profile.seed(store)

    assert first_written > 0 and first_skipped == 0
    assert second_written == 0, "re-running must not duplicate the profile"
    assert second_skipped == first_written


def test_a_dry_run_writes_nothing(store):
    from scripts import seed_profile

    written, _ = seed_profile.seed(store, dry_run=True)
    assert written > 0
    assert store.profile() == []


def test_the_seeded_profile_pins_only_a_handful(store):
    """Everything pinned would defeat the point of having the flag."""
    from scripts import seed_profile

    seed_profile.seed(store)
    pinned = store.profile(pinned_only=True)
    everything = store.profile()

    assert 0 < len(pinned) <= 6, f"{len(pinned)} pinned is too many for every turn"
    assert len(everything) > len(pinned)


def test_vice_facts_are_scoped_to_the_project(store):
    """Gives scope inference something real to prioritise."""
    from scripts import seed_profile

    seed_profile.seed(store)
    scopes = {m.scope for m in store.profile()}
    assert "project:vice" in scopes


def test_the_seeded_profile_is_searchable(store):
    """The unpinned half is only reachable if search finds it."""
    from relay.memory import search as search_mod
    from scripts import seed_profile

    seed_profile.seed(store)
    hits = search_mod.search(store, "where am I applying to university", limit=5)
    assert any("Toronto" in h.memory.content for h in hits)

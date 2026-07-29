"""Scope inference and confidence decay.

Both were designed long before anything drove them: `search.scope_affinity`
weighted a scope nothing ever set, and decay was described in the plan but
never written. Both share a failure mode — they go wrong *silently*. A bad
scope reorders results with no sign it happened, and over-eager decay quietly
demotes something the user actually said.
"""

import time

import pytest

from relay.memory import signals
from relay.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path):
    return MemoryStore(tmp_path / "relay.db").connect()


# ------------------------------------------------------------------- scope
def test_nothing_focused_means_no_scope(store):
    assert signals.infer_scope(store, None) == "global"


def test_a_project_window_infers_its_scope(store):
    store.write("Vice uses ffmpeg directly.", scope="project:vice")
    focused = "code on workspace 1 — vice/src/recorder.rs"
    assert signals.infer_scope(store, focused) == "project:vice"


def test_an_unrelated_window_stays_global(store):
    store.write("Vice uses ffmpeg directly.", scope="project:vice")
    assert signals.infer_scope(store, "discord on workspace 2 — general") == "global"


def test_only_scopes_that_already_exist_are_inferred(store):
    """The mapping is data, not hardcoded names: a project scope is only
    guessed because a memory already claims it."""
    assert signals.infer_scope(store, "code — working on unreal engine") == "global"


def test_the_longest_matching_project_wins(store):
    """`project:vice` must not steal a window belonging to `project:vice-web`."""
    store.write("a", scope="project:vice")
    store.write("b", scope="project:vice-web")
    assert signals.infer_scope(store, "code — vice-web/index.html") == "project:vice-web"


def test_very_short_project_names_are_ignored(store):
    """A two-letter name would match almost any window title by accident."""
    store.write("a", scope="project:ab")
    assert signals.infer_scope(store, "code — a fabulous absolute path") == "global"


def test_matching_is_case_insensitive(store):
    store.write("a", scope="project:vice")
    assert signals.infer_scope(store, "Code — VICE/README.md") == "project:vice"


def test_a_broken_store_falls_back_to_global(store):
    class Broken:
        def list(self, **kwargs):
            raise RuntimeError("no database")

    assert signals.infer_scope(Broken(), "code — vice") == "global"


def test_scope_actually_changes_the_ranking(store):
    """The point of all this: with a Vice window focused, Vice memories
    should outrank general ones on the same query."""
    from relay.memory import search as search_mod

    store.write("The clip format is mp4.", scope="global")
    store.write("The clip format is mkv.", scope="project:vice")

    ranked = search_mod.search(store, "clip format", active_scope="project:vice")
    assert ranked[0].memory.scope == "project:vice"

    unranked = search_mod.search(store, "clip format", active_scope="global")
    assert unranked[0].memory.scope == "global"


# ------------------------------------------------------------------- decay
MONTH = 30 * 86_400


def _age(store, memory_id: int, months: float) -> None:
    store.db.execute("UPDATE memories SET updated_at = ? WHERE id = ?",
                     (time.time() - months * MONTH, memory_id))
    store.db.commit()


def test_a_guess_fades_over_time(store):
    # inferred_repeated starts at 80. A single-occurrence guess is already at
    # the floor (20) and has nowhere left to fall, which is the intended
    # behaviour rather than an omission.
    memory_id = store.write("Prefers dark mode.", source="inferred_repeated")
    before = store.get(memory_id).confidence
    _age(store, memory_id, 3)

    store.decay()

    assert store.get(memory_id).confidence < before


def test_something_the_user_said_never_fades(store):
    """Age doesn't make a stated fact less true."""
    memory_id = store.write("Projects live in ~/Projects.", source="explicit")
    _age(store, memory_id, 24)

    store.decay()

    assert store.get(memory_id).confidence == 100


def test_a_confirmed_memory_never_fades(store):
    memory_id = store.write("Discord belongs on workspace 2.", source="confirmed")
    _age(store, memory_id, 24)
    store.decay()
    assert store.get(memory_id).confidence == 90


def test_a_pinned_memory_never_fades(store):
    """Pinned means "keep this regardless"."""
    memory_id = store.write("The user is Andrew Marin.", source="inferred_repeated",
                            pinned=True)
    _age(store, memory_id, 24)
    store.decay()
    assert store.get(memory_id).confidence == 80


def test_a_recent_memory_is_untouched(store):
    memory_id = store.write("Likes jazz.", source="inferred_repeated")
    store.decay()
    assert store.get(memory_id).confidence == 80


def test_a_single_guess_is_already_at_the_floor(store):
    """20 is where an unconfirmed guess starts *and* where decay stops, so
    there is nothing to take away from it."""
    memory_id = store.write("Maybe likes jazz.", source="inferred_once")
    _age(store, memory_id, 60)
    store.decay()
    assert store.get(memory_id).confidence == 20


def test_decay_stops_at_a_floor(store):
    """At zero a memory is indistinguishable from one never learned, and
    there'd be nothing left to correct."""
    memory_id = store.write("A weak guess.", source="inferred_repeated")
    _age(store, memory_id, 240)

    store.decay(floor=20)

    assert store.get(memory_id).confidence == 20


def test_decay_reports_how_many_it_touched(store):
    first = store.write("guess one", source="inferred_repeated")
    store.write("guess two", source="inferred_repeated")
    store.write("a stated fact", source="explicit")
    _age(store, first, 5)

    assert store.decay() == 1


def test_decay_does_not_reset_the_clock_it_depends_on(store):
    """updated_at records when the *content* changed. If decay touched it,
    the next pass would think the memory had just been updated."""
    memory_id = store.write("A guess.", source="inferred_repeated")
    _age(store, memory_id, 6)
    before = store.get(memory_id).updated_at

    store.decay()

    assert store.get(memory_id).updated_at == before


def test_repeated_passes_keep_decaying(store):
    memory_id = store.write("A guess.", source="inferred_repeated")
    _age(store, memory_id, 2)
    store.decay()
    first = store.get(memory_id).confidence
    _age(store, memory_id, 10)
    store.decay()
    assert store.get(memory_id).confidence < first


def test_a_forgotten_memory_is_left_alone(store):
    memory_id = store.write("A guess.", source="inferred_repeated")
    store.forget(memory_id)
    _age(store, memory_id, 12)
    assert store.decay() == 0

import pytest

from relay.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path):
    with MemoryStore(tmp_path / "memory.db") as s:
        yield s


# --------------------------------------------------------------- confidence
def test_source_determines_confidence_by_default(store):
    explicit = store.get(store.write("projects live in ~/Projects"))
    guess = store.get(store.write("probably prefers dark mode", source="inferred_once"))

    assert explicit.confidence == 100
    assert guess.confidence == 20
    # A guess must never outrank something the user actually said.
    assert guess.confidence < explicit.confidence


def test_empty_content_is_refused(store):
    with pytest.raises(ValueError):
        store.write("   ")


def test_unknown_kind_is_refused(store):
    with pytest.raises(ValueError):
        store.write("something", kind="nonsense")


# ------------------------------------------------------------- observations
def test_single_observation_does_not_become_a_memory(store):
    store.observe("app_workspace:discord", "Discord goes on workspace 2")

    assert store.promotable() == []
    assert store.list() == []  # nothing leaked into real memory


def test_observation_promotes_only_after_three_sightings(store):
    key, content = "app_workspace:discord", "Discord goes on workspace 2"

    store.observe(key, content)
    assert store.promotable() == []

    store.observe(key, content)
    assert store.promotable() == [], "two sightings is only 50%, below the threshold"

    obs = store.observe(key, content)
    assert obs.occurrences == 3
    promotable = store.promotable()
    assert len(promotable) == 1

    memory_id = store.promote(promotable[0].id)
    memory = store.get(memory_id)
    assert memory.confidence == 80
    assert memory.source == "inferred_repeated"


def test_confirming_an_inference_raises_it_to_ninety(store):
    key = "app_workspace:discord"
    for _ in range(3):
        store.observe(key, "Discord goes on workspace 2")

    obs = store.promotable()[0]
    memory = store.get(store.promote(obs.id, confirmed=True))

    assert memory.source == "confirmed"
    assert memory.confidence == 90


def test_dismissed_observation_stops_being_offered(store):
    key = "app_workspace:discord"
    for _ in range(3):
        store.observe(key, "Discord goes on workspace 2")

    store.dismiss(store.promotable()[0].id)
    assert store.promotable() == []


# ------------------------------------------------------------- system facts
def test_probe_cannot_overwrite_an_explicit_override(store):
    """The Zen-vs-firedragon case.

    xdg-settings reports firedragon; the user says they use Zen. A later probe
    must not undo that, or "open my browser" silently regresses.
    """
    store.set_fact("browser", "firedragon", source="probed")
    store.set_fact("browser", "zen-browser", source="explicit")

    store.set_fact("browser", "firedragon", source="probed")  # boot-time refresh

    assert store.get_fact("browser") == "zen-browser"


def test_probe_updates_a_probed_fact(store):
    store.set_fact("gpu", "RTX 4060", source="probed")
    store.set_fact("gpu", "RTX 5090", source="probed")
    assert store.get_fact("gpu") == "RTX 5090"


def test_explicit_always_wins_regardless_of_order(store):
    store.set_fact("editor", "micro", source="explicit")
    store.set_fact("editor", "kate", source="probed")
    assert store.get_fact("editor") == "micro"


# ------------------------------------------------------------ forget/restore
def test_forget_is_soft_and_undoable(store):
    memory_id = store.write("my coding projects are in ~/Projects")

    assert store.forget(memory_id) is True
    assert store.list() == []
    assert store.get(memory_id).deleted_at is not None  # row survives

    assert store.restore(memory_id) is True
    assert len(store.list()) == 1


def test_forgetting_twice_reports_no_second_change(store):
    memory_id = store.write("something")
    assert store.forget(memory_id) is True
    assert store.forget(memory_id) is False


# --------------------------------------------------------------- supersede
def test_supersede_keeps_the_old_statement(store):
    old = store.write("projects are in ~/code")
    new = store.write("projects are in ~/Projects", supersedes=old)

    assert store.get(old).superseded_by == new
    # Only the current answer is listed...
    assert [m.id for m in store.list()] == [new]
    # ...but "what did I used to say?" can still find it.
    assert len(store.list(include_superseded=True)) == 2


# ------------------------------------------------------------------- usage
def test_usage_accumulates_and_reports_totals(store):
    store.log_usage(input_tokens=100, output_tokens=50, cost_usd=0.01)
    store.log_usage(input_tokens=200, output_tokens=25, cost_usd=0.02)

    totals = store.usage_since(0)
    assert totals["turns"] == 2
    assert totals["input_tokens"] == 300
    assert totals["total_tokens"] == 375
    assert totals["cost_usd"] == pytest.approx(0.03)


def test_latest_rate_limit_reads_back_subscription_telemetry(store):
    store.log_usage(input_tokens=1)  # no telemetry on this turn
    store.log_usage(rate_limit_type="seven_day_sonnet", rate_limit_status="allowed_warning",
                    utilization=0.81)

    latest = store.latest_rate_limit()
    assert latest["rate_limit_type"] == "seven_day_sonnet"
    assert latest["utilization"] == pytest.approx(0.81)


# -------------------------------------------------------------------- touch
def test_touch_records_access_for_recency_ranking(store):
    memory_id = store.write("something")
    assert store.get(memory_id).access_count == 0

    store.touch([memory_id])
    memory = store.get(memory_id)
    assert memory.access_count == 1
    assert memory.last_accessed_at is not None

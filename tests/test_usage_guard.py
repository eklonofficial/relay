"""Usage guard and spoken-loop protection.

Both of these were real failures: Relay refused to work for hours on a stale
number, and then repeated the refusal on a loop because the message contained
its own wake word.
"""

import time

import pytest

from relay import config
from relay.agent.client import RelayAgent, UsageLimitReached
from relay.memory.store import MemoryStore


@pytest.fixture
def store(tmp_path):
    with MemoryStore(tmp_path / "m.db") as s:
        yield s


def _agent(store, cfg=None):
    return RelayAgent(cfg or config.load(), store, style="terse")


# ------------------------------------------------------------- staleness
def test_fresh_high_reading_blocks(store):
    store.log_usage(rate_limit_type="five_hour", rate_limit_status="allowed_warning",
                    utilization=0.98)
    with pytest.raises(UsageLimitReached):
        _agent(store).check_budget()


def test_stale_high_reading_is_ignored(store):
    """The actual bug: a 127-minute-old '98% used' kept Relay refusing to
    answer long after real usage had fallen back to 70%."""
    store.log_usage(rate_limit_type="five_hour", rate_limit_status="allowed_warning",
                    utilization=0.98)
    # Backdate it beyond the freshness window.
    store.db.execute("UPDATE usage_log SET ts = ?", (time.time() - 127 * 60,))
    store.db.commit()

    _agent(store).check_budget()  # must not raise


def test_freshness_window_is_configurable(store):
    store.log_usage(utilization=0.99)
    store.db.execute("UPDATE usage_log SET ts = ?", (time.time() - 1000,))
    store.db.commit()

    cfg = config.load()
    cfg.usage.telemetry_max_age_s = 2000  # widen it: now the reading counts
    with pytest.raises(UsageLimitReached):
        _agent(store, cfg).check_budget()


def test_store_returns_stale_row_when_no_max_age_given(store):
    """Display callers still want the number, even if old."""
    store.log_usage(utilization=0.98)
    store.db.execute("UPDATE usage_log SET ts = ?", (time.time() - 10_000,))
    store.db.commit()

    assert store.latest_rate_limit() is not None
    assert store.latest_rate_limit(max_age_s=900) is None


def test_no_telemetry_at_all_does_not_block(store):
    _agent(store).check_budget()


# --------------------------------------------------- self-triggering loop
def test_limit_message_does_not_contain_the_wake_word(store):
    """Spoken aloud, any 'relay' in the message retriggers the microphone and
    the refusal repeats forever."""
    store.log_usage(utilization=0.99)
    with pytest.raises(UsageLimitReached) as excinfo:
        _agent(store).check_budget()

    assert "relay" not in str(excinfo.value).lower()


async def test_identical_messages_are_not_repeated(tmp_path):
    """Saying a failure once is help; saying it on a loop is not."""
    from relay.voice import VoiceLoop

    spoken = []

    class FakeListener:
        def pause(self): pass
        def resume(self): pass

    loop = VoiceLoop.__new__(VoiceLoop)
    loop._last_spoken = None
    loop.say = lambda text: _record(spoken, text)

    await loop.say_once("plan is full")
    await loop.say_once("plan is full")
    await loop.say_once("plan is full")

    assert spoken == ["plan is full"], "the same message should only be said once"


async def test_a_different_message_still_gets_said(tmp_path):
    from relay.voice import VoiceLoop

    spoken = []
    loop = VoiceLoop.__new__(VoiceLoop)
    loop._last_spoken = None
    loop.say = lambda text: _record(spoken, text)

    await loop.say_once("first problem")
    await loop.say_once("second problem")
    assert spoken == ["first problem", "second problem"]


async def test_repeat_is_allowed_again_after_the_window(tmp_path):
    from relay.voice import VoiceLoop

    spoken = []
    loop = VoiceLoop.__new__(VoiceLoop)
    loop._last_spoken = None
    loop.say = lambda text: _record(spoken, text)

    await loop.say_once("same", within_s=0.0)
    await loop.say_once("same", within_s=0.0)
    assert len(spoken) == 2


async def _record(sink, text):
    sink.append(text)

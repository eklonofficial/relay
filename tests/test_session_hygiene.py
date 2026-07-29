"""Session rotation.

Every turn resends the whole conversation, so a session left open all day
would carry hours of unrelated history into a request about the weather.
"""

import time

import pytest

from relay import config
from relay.agent.client import RelayAgent
from relay.memory.store import MemoryStore


@pytest.fixture
def agent(tmp_path):
    store = MemoryStore(tmp_path / "m.db").connect()
    cfg = config.load()
    a = RelayAgent(cfg, store, style="terse")
    yield a
    store.close()


def _stub_restart(agent, restarts):
    async def stop():
        restarts.append("stop")

    async def start():
        restarts.append("start")

    agent.stop = stop
    agent.start = start


async def test_fresh_session_is_not_rotated(agent):
    restarts = []
    _stub_restart(agent, restarts)
    assert await agent.maybe_rotate_session() is None
    assert restarts == []


async def test_idle_session_rotates(agent):
    restarts = []
    _stub_restart(agent, restarts)
    agent.cfg.usage.session_idle_minutes = 20
    agent._last_turn_at = time.time() - 21 * 60

    reason = await agent.maybe_rotate_session()
    assert reason and "idle" in reason
    assert restarts == ["stop", "start"]


async def test_recent_session_survives(agent):
    restarts = []
    _stub_restart(agent, restarts)
    agent.cfg.usage.session_idle_minutes = 20
    agent._last_turn_at = time.time() - 60  # a minute ago

    assert await agent.maybe_rotate_session() is None
    assert restarts == []


async def test_long_session_rotates_on_turn_count(agent):
    """Even a continuously-used session shouldn't grow without limit."""
    restarts = []
    _stub_restart(agent, restarts)
    agent.cfg.usage.session_idle_minutes = 0  # disable the idle rule
    agent.cfg.usage.session_max_turns = 40
    agent._turns_this_session = 40

    reason = await agent.maybe_rotate_session()
    assert reason and "turns" in reason
    assert agent._turns_this_session == 0, "counter should reset after rotating"


async def test_rotation_can_be_disabled(agent):
    restarts = []
    _stub_restart(agent, restarts)
    agent.cfg.usage.session_idle_minutes = 0
    agent.cfg.usage.session_max_turns = 0
    agent._last_turn_at = time.time() - 10 * 3600
    agent._turns_this_session = 5000

    assert await agent.maybe_rotate_session() is None
    assert restarts == []

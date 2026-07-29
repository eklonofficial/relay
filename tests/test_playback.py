"""The speech queue, and what happens after it's interrupted.

Relay went mute for ten hours because of a latched flag in here, and the
existing tests missed it entirely: they interrupt a `FakePlayback` stub and
assert it was *asked* to stop, which it always is. Nothing drove the real
queue across an interruption and out the other side.

So these tests use the real Playback with only the audio device faked, and
the ones that matter are the ones that queue something *after* an interrupt.
"""

import asyncio

import numpy as np
import pytest

from relay.audio.playback import Playback


@pytest.fixture
def playback():
    """A real Playback with the sound card replaced by a list."""
    pb = Playback()
    pb.played: list[float] = []

    async def record(audio, sample_rate):
        pb.played.append(float(audio[0]))

    pb._play = record
    return pb


def clip(marker: float) -> np.ndarray:
    """A one-sample clip that identifies itself."""
    return np.array([marker], dtype=np.float32)


async def _drain(pb):
    await pb.wait_until_idle()
    # The queue is joined the moment task_done() fires, which is before the
    # discard path has finished its iteration. Yield once so the loop settles.
    await asyncio.sleep(0)


# --------------------------------------------------------------- the basics
@pytest.mark.asyncio
async def test_a_queued_clip_is_played(playback):
    await playback.start()
    await playback.say(clip(1.0), 48_000)
    await _drain(playback)
    assert playback.played == [1.0]
    await playback.stop()


@pytest.mark.asyncio
async def test_clips_play_in_order(playback):
    await playback.start()
    for marker in (1.0, 2.0, 3.0):
        await playback.say(clip(marker), 48_000)
    await _drain(playback)
    assert playback.played == [1.0, 2.0, 3.0]
    await playback.stop()


# ---------------------------------------------------------- interruption
@pytest.mark.asyncio
async def test_interrupting_discards_what_was_queued(playback):
    """"Relay, stop" has to drop the rest of the reply, not just the
    sentence being spoken."""
    await playback.start()
    for marker in (1.0, 2.0, 3.0):
        await playback.say(clip(marker), 48_000)
    playback.interrupt()
    await _drain(playback)

    assert 2.0 not in playback.played
    assert 3.0 not in playback.played
    await playback.stop()


@pytest.mark.asyncio
async def test_speech_still_works_after_an_interruption(playback):
    """The regression, in one test.

    Saying "never mind" set a flag that was cleared only inside _play(),
    which the discard path skipped over -- so every sentence after the first
    interruption was pulled off the queue and dropped. Relay kept waking,
    transcribing, answering and synthesising, and never made a sound again
    until it was restarted.
    """
    await playback.start()

    playback.interrupt()
    await asyncio.sleep(0)

    await playback.say(clip(7.0), 48_000)
    await _drain(playback)

    assert playback.played == [7.0], "playback did not recover from interrupt"
    await playback.stop()


@pytest.mark.asyncio
async def test_speech_survives_repeated_interruptions(playback):
    """Once was enough to break it; ten times must still be fine."""
    await playback.start()
    for turn in range(10):
        playback.interrupt()
        await asyncio.sleep(0)
        await playback.say(clip(float(turn)), 48_000)
        await _drain(playback)

    assert playback.played == [float(t) for t in range(10)]
    await playback.stop()


@pytest.mark.asyncio
async def test_an_interrupt_spares_the_turn_that_follows_it(playback):
    """The discard must be scoped to the interrupted turn.

    Dropping everything already queued while still playing everything queued
    afterwards is the whole distinction; getting it wrong in the other
    direction eats the first sentence of the next reply.
    """
    await playback.start()
    await playback.say(clip(1.0), 48_000)   # belongs to the abandoned turn
    playback.interrupt()
    await playback.say(clip(2.0), 48_000)   # belongs to the new one
    await _drain(playback)

    assert playback.played == [2.0]
    await playback.stop()


@pytest.mark.asyncio
async def test_waiting_for_idle_returns_after_an_interrupt(playback):
    """Discarded clips must still be marked done.

    wait_until_idle() joins the queue, so a clip that is dropped without
    task_done() would hang the voice loop forever instead of muting it.
    """
    await playback.start()
    for marker in (1.0, 2.0, 3.0):
        await playback.say(clip(marker), 48_000)
    playback.interrupt()

    await asyncio.wait_for(playback.wait_until_idle(), timeout=2.0)
    await playback.stop()


@pytest.mark.asyncio
async def test_a_failing_clip_does_not_stop_the_queue(playback):
    """One bad clip must not take the rest of the reply with it."""
    async def explode(audio, sample_rate):
        if float(audio[0]) == 2.0:
            raise RuntimeError("bad clip")
        playback.played.append(float(audio[0]))

    playback._play = explode
    await playback.start()
    for marker in (1.0, 2.0, 3.0):
        await playback.say(clip(marker), 48_000)
    await _drain(playback)

    assert playback.played == [1.0, 3.0]
    await playback.stop()

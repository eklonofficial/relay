"""Turning the music down while Relay listens, and putting it back.

The interesting tests here are all about the second half. Lowering a volume
is easy; the ways this goes wrong are all failures to restore one -- Relay
crashing mid-request, a stream disappearing while it was ducked, an abort
arriving in the same breath as the wake word. Every one of those leaves
somebody's music quiet with nothing left running that knows it did that.

And the rule that must never break: Relay does not duck itself.
"""

import asyncio
import json
import os

import pytest

from relay.audio import ducking
from relay.audio.ducking import Ducker


def stream(index, pid, volumes=(65536, 65536), name="Cider"):
    """A sink-input as `pactl -f json` reports one."""
    return {
        "index": index,
        "properties": {"application.process.id": str(pid),
                       "application.name": name},
        "volume": {f"ch{i}": {"value": v} for i, v in enumerate(volumes)},
    }


@pytest.fixture
def fake_pactl(monkeypatch):
    """Stands in for the audio server, and records what it was told."""
    class Server:
        def __init__(self):
            self.streams = []
            self.calls = []
            self.fail_on = set()

        async def __call__(self, *args):
            self.calls.append(args)
            if args[:3] == ("-f", "json", "list"):
                return 0, json.dumps(self.streams)
            if args[0] == "set-sink-input-volume":
                if args[1] in self.fail_on:
                    return 1, "No such entity"
                return 0, ""
            return 0, ""

        def volumes_set(self, index):
            return [c[2:] for c in self.calls
                    if c[0] == "set-sink-input-volume" and c[1] == index]

    server = Server()
    monkeypatch.setattr(ducking, "_pactl", server)
    return server


@pytest.fixture
def ducker(tmp_path):
    return Ducker(level=0.25, state_file=tmp_path / "ducked.json")


# --------------------------------------------------------------- the rule
@pytest.mark.asyncio
async def test_relay_never_ducks_itself(fake_pactl, ducker):
    """Its own replies would otherwise be turned down by the same rule that
    turns down the music, which would be absurd."""
    fake_pactl.streams = [
        stream(1, os.getpid(), name="ALSA plug-in [python3.12]"),  # Relay
        stream(2, 9999, name="Cider"),
    ]
    await ducker._duck()

    assert fake_pactl.volumes_set("1") == [], "Relay ducked its own voice"
    assert fake_pactl.volumes_set("2"), "the music was not ducked"


@pytest.mark.asyncio
async def test_identity_is_by_process_not_by_name(fake_pactl, ducker):
    """Relay reaches PipeWire as "ALSA plug-in [python3.12]", which any
    Python program is also called. Matching on that would duck Relay and
    spare an unrelated script, or the other way round."""
    fake_pactl.streams = [
        stream(1, 4242, name="ALSA plug-in [python3.12]"),  # some other python
    ]
    await ducker._duck()
    assert fake_pactl.volumes_set("1"), "a different python process was spared"


# -------------------------------------------------------------- the ducking
@pytest.mark.asyncio
async def test_volumes_are_lowered_not_muted(fake_pactl, ducker):
    """Cutting music dead is startling and reads as the assistant seizing
    the machine."""
    fake_pactl.streams = [stream(1, 9999, volumes=(65536, 65536))]
    await ducker._duck()

    lowered = fake_pactl.volumes_set("1")[0]
    assert [int(v) for v in lowered] == [16384, 16384]
    assert all(int(v) > 0 for v in lowered)


@pytest.mark.asyncio
async def test_the_exact_original_is_restored(fake_pactl, ducker):
    """Not 100%: whatever it actually was. Restoring to full would turn
    somebody's quiet background music into a surprise."""
    fake_pactl.streams = [stream(1, 9999, volumes=(30000, 21000))]
    await ducker._duck()
    await ducker._restore()

    assert [int(v) for v in fake_pactl.volumes_set("1")[-1]] == [30000, 21000]
    assert not ducker.ducked


@pytest.mark.asyncio
async def test_silent_streams_are_left_alone(fake_pactl, ducker):
    """A muted stream has nothing to duck, and recording 0 as its original
    would mean 'restoring' it to silence later."""
    fake_pactl.streams = [stream(1, 9999, volumes=(0, 0))]
    await ducker._duck()
    assert fake_pactl.volumes_set("1") == []


@pytest.mark.asyncio
async def test_ducking_twice_does_not_lose_the_original(fake_pactl, ducker):
    """A follow-up arrives while already ducked. Snapshotting again would
    record the ducked volume as the original and the music would never come
    back up."""
    fake_pactl.streams = [stream(1, 9999, volumes=(65536, 65536))]
    ducker._want_ducked = True
    await ducker._apply()
    await ducker._apply()
    await ducker.unduck()

    assert [int(v) for v in fake_pactl.volumes_set("1")[-1]] == [65536, 65536]


@pytest.mark.asyncio
async def test_a_stream_that_vanished_does_not_block_the_rest(fake_pactl, ducker):
    """The song ended while Relay was being spoken to. That is not an error,
    and it must not stop the other streams being restored."""
    fake_pactl.streams = [stream(1, 9999), stream(2, 8888)]
    await ducker._duck()
    fake_pactl.fail_on.add("1")

    await ducker._restore()

    assert fake_pactl.volumes_set("2")[-1]
    assert not ducker.ducked


# ----------------------------------------------------------- crash recovery
@pytest.mark.asyncio
async def test_a_duck_survives_a_crash_and_is_undone(fake_pactl, tmp_path):
    """The volume outlives the process that changed it. If Relay dies
    between ducking and restoring, the next run has to clean up -- otherwise
    the music stays quiet and nothing left running knows why."""
    state = tmp_path / "ducked.json"
    state.write_text(json.dumps({"7": [50000, 50000]}))

    revived = Ducker(level=0.25, state_file=state)
    count = await revived.recover()

    assert count == 1
    assert [int(v) for v in fake_pactl.volumes_set("7")[-1]] == [50000, 50000]
    assert not state.exists()


@pytest.mark.asyncio
async def test_a_reopened_app_gets_its_volume_back(fake_pactl, tmp_path):
    """PipeWire remembers volume per *application*, not per stream.

    So a duck left behind by a crash becomes that app's remembered volume,
    and it carries into the next stream the app opens -- under a new index,
    which the state file knows nothing about. Observed for real: after a
    SIGKILL mid-request, a freshly launched player started at 25%.
    """
    state = tmp_path / "ducked.json"
    state.write_text(json.dumps(
        {"41": {"volumes": [65536, 65536], "app": "Cider"}}))
    # Same app, new stream, still carrying the ducked volume.
    fake_pactl.streams = [stream(77, 9999, volumes=(16384, 16384), name="Cider")]

    revived = Ducker(state_file=state)
    await revived.recover()

    assert [int(v) for v in fake_pactl.volumes_set("77")[-1]] == [65536, 65536]


@pytest.mark.asyncio
async def test_restoring_survives_a_failure_to_list(fake_pactl, ducker):
    """If the listing fails, every restore must still be attempted.

    Skipping them because one `pactl` call failed would leave the whole lot
    ducked -- the exact outcome this class exists to prevent, arrived at by
    being careful.
    """
    fake_pactl.streams = [stream(1, 9999, volumes=(65536, 65536))]
    await ducker._duck()

    async def broken(*args):
        if args[:3] == ("-f", "json", "list"):
            return 1, "connection refused"
        return await fake_pactl.__class__.__call__(fake_pactl, *args)

    ducking._pactl = broken
    try:
        await ducker._restore()
    finally:
        ducking._pactl = fake_pactl

    assert [int(v) for v in fake_pactl.volumes_set("1")[-1]] == [65536, 65536]
    assert not ducker.ducked


@pytest.mark.asyncio
async def test_recovery_with_nothing_to_recover(fake_pactl, ducker):
    assert await ducker.recover() == 0


@pytest.mark.asyncio
async def test_a_corrupt_state_file_is_discarded(fake_pactl, tmp_path):
    state = tmp_path / "ducked.json"
    state.write_text("{not json")
    revived = Ducker(state_file=state)

    assert await revived.recover() == 0
    assert not state.exists()


@pytest.mark.asyncio
async def test_the_state_file_is_written_while_ducked(fake_pactl, ducker):
    fake_pactl.streams = [stream(1, 9999)]
    await ducker._duck()
    assert ducker.state_file.exists()

    await ducker._restore()
    assert not ducker.state_file.exists()


# ------------------------------------------------------------- convergence
@pytest.mark.asyncio
async def test_wake_then_immediate_idle_settles_unducked(fake_pactl, ducker):
    """"Relay -- no, never mind." Both requests land in the same breath, and
    what matters is where it ends up, not which task won."""
    fake_pactl.streams = [stream(1, 9999, volumes=(65536, 65536))]
    ducker.wake()
    ducker.idle()
    await asyncio.sleep(0.05)

    assert not ducker.ducked
    last = fake_pactl.volumes_set("1")
    if last:
        assert [int(v) for v in last[-1]] == [65536, 65536]


@pytest.mark.asyncio
async def test_requests_do_not_block_the_caller(fake_pactl, ducker):
    """wake() runs milliseconds before recording starts. Waiting on a
    subprocess here would cost the first syllable of the request."""
    fake_pactl.streams = [stream(1, 9999)]
    loop = asyncio.get_running_loop()
    started = loop.time()
    ducker.wake()
    assert loop.time() - started < 0.01
    await asyncio.sleep(0.05)


# -------------------------------------------------------------- switched off
@pytest.mark.asyncio
async def test_disabled_touches_nothing(fake_pactl, tmp_path):
    off = Ducker(enabled=False, state_file=tmp_path / "d.json")
    off.wake()
    await asyncio.sleep(0.05)
    assert fake_pactl.calls == []
    assert not off.ducked


def test_the_level_cannot_be_a_mute():
    """0 is a different and more startling thing than quiet, and 1 would
    make the feature a no-op that looks like it is working."""
    assert Ducker(level=0.0).level > 0.0
    assert Ducker(level=5.0).level <= 0.95

"""Surviving a microphone that dies without saying so.

Relay went deaf for an hour after the machine suspended. Nothing crashed and
nothing was logged: suspending re-enumerates the USB microphone underneath
PortAudio, the capture callback simply stops firing, and `frames()` waits
forever on a queue nothing will ever fill again. The daemon stayed up and
answered `relay status` the whole time.

Every cause looks identical from inside the process -- resume, a PipeWire
restart, the microphone being unplugged -- so the watchdog watches the one
symptom they share: frames stop arriving.
"""

import asyncio
import time

import numpy as np
import pytest

from relay.audio.capture import Microphone


class FakeStream:
    """Stands in for sounddevice's InputStream."""

    def __init__(self, dead: bool = False):
        self.dead = dead
        self.stopped = False
        self.closed = False

    def start(self):
        pass

    def stop(self):
        self.stopped = True

    def close(self):
        self.closed = True


@pytest.fixture
def mic():
    """A microphone whose device is a list of streams we hand out in order."""
    m = Microphone(device=0)
    m.opened: list[FakeStream] = []

    def fake_open():
        stream = FakeStream()
        m.opened.append(stream)
        m._stream = stream
        # Both clocks, exactly as the real _open() does -- the watchdog must
        # not fire on the gap between opening and the first frame landing.
        m.last_frame_at = m.last_signal_at = time.monotonic()

    m._open = fake_open
    return m


def noise() -> np.ndarray:
    """A frame with a noise floor: what a live microphone in a silent room
    actually delivers."""
    frame = np.zeros(1280, dtype=np.int16)
    frame[::64] = 5
    return frame


def go_silent(mic, seconds: float) -> None:
    """Pretend no frame has arrived for `seconds`."""
    mic.last_frame_at = mic.last_signal_at = time.monotonic() - seconds


# ------------------------------------------------------------------ reopen
def test_reopening_replaces_the_stream(mic):
    mic.start()
    first = mic._stream

    assert mic.reopen()

    assert mic._stream is not first
    assert first.stopped and first.closed, "the dead stream must be released"


def test_reopening_does_not_disturb_the_consumers(mic):
    """`frames()` is parked on the queue and must stay there.

    Tearing the queue down on reopen would mean every consumer had to be
    restarted too -- and the shutdown sentinel would end them for good.
    """
    mic.start()
    mic.consumers = 2
    mic._async_queue.put_nowait(np.zeros(1280, dtype=np.int16))

    mic.reopen()

    assert mic._running is True
    assert mic.consumers == 2
    assert mic._async_queue.qsize() == 1, "queued audio must survive a reopen"


def test_a_failed_reopen_is_reported_not_raised(mic):
    """After a resume the device can take seconds to come back. That is a
    retry, not a crash."""
    def refuse():
        raise OSError("Device unavailable")

    mic.start()
    mic._open = refuse

    assert mic.reopen() is False
    assert mic._stream is None


def test_reopening_re_resolves_the_device(mic):
    """A resume can renumber the inputs, so the index that was right at
    startup may point somewhere else by the time we reopen."""
    m = Microphone(device=24, resolve=lambda: 7)
    m._pick_sample_rate = lambda sd: 48_000
    opened = []

    def fake_open():
        # The real _open() consults the resolver before touching the device.
        if m._resolve is not None:
            m.device = m._resolve()
        opened.append(m.device)

    m._open = fake_open
    m.start()
    assert opened == [7]


# --------------------------------------------------------------- watchdog
@pytest.mark.asyncio
async def test_the_watchdog_reopens_a_stalled_microphone(mic):
    """The regression, in one test."""
    mic.start()
    assert len(mic.opened) == 1

    go_silent(mic, 30.0)
    watch = asyncio.create_task(mic.watch(stall_after_s=0.05, interval_s=0.01))
    await asyncio.sleep(0.15)
    watch.cancel()

    assert len(mic.opened) > 1, "a stalled microphone was never reopened"
    assert mic.reopens >= 1


@pytest.mark.asyncio
async def test_the_watchdog_leaves_a_working_microphone_alone(mic):
    """Reopening mid-sentence would clip audio, so a live stream is
    untouched however long the room stays quiet."""
    mic.start()

    async def keep_feeding():
        for _ in range(20):
            mic._offer(noise())
            await asyncio.sleep(0.01)

    watch = asyncio.create_task(
        mic.watch(stall_after_s=0.05, silent_after_s=0.06, interval_s=0.01))
    await keep_feeding()
    watch.cancel()

    assert len(mic.opened) == 1, "a healthy microphone was reopened"
    assert mic.reopens == 0


@pytest.mark.asyncio
async def test_frames_still_arriving_does_not_mean_audio_is(mic):
    """The failure that actually happens.

    When the audio server drops the device node -- a resume, a WirePlumber
    restart -- the ALSA plugin keeps the stream open and feeds digital zero
    forever. Frames land exactly on time and every one is empty. Measured
    live: 76 frames in 6 seconds, RMS 0.0, and no error raised anywhere.

    Watching frame arrival alone sees a perfectly healthy microphone.
    """
    mic.start()
    watch = asyncio.create_task(
        mic.watch(stall_after_s=0.05, silent_after_s=0.06, interval_s=0.01))

    for _ in range(20):
        mic._offer(np.zeros(1280, dtype=np.int16))   # punctual, and empty
        await asyncio.sleep(0.01)

    watch.cancel()
    assert mic.reopens >= 1, "digitally silent capture was treated as healthy"


@pytest.mark.asyncio
async def test_a_quiet_room_is_left_alone(mic):
    """A real microphone has a noise floor; near-zero is not zero.

    Reopening whenever nobody is talking would clip the start of commands
    all day, so the test is 'no signal at all', not 'quiet'.
    """
    mic.start()
    watch = asyncio.create_task(
        mic.watch(stall_after_s=0.05, silent_after_s=0.06, interval_s=0.01))

    quiet = np.zeros(1280, dtype=np.int16)
    quiet[7] = 3            # a noise floor, the faintest possible
    for _ in range(20):
        mic._offer(quiet)
        await asyncio.sleep(0.01)

    watch.cancel()
    assert mic.reopens == 0, "a quiet room was mistaken for a dead microphone"


@pytest.mark.asyncio
async def test_persistent_silence_backs_off(mic):
    """A hardware mute switch produces true zero too, and that is the user's
    choice. It must not be reopened every window forever."""
    mic.start()
    watch = asyncio.create_task(
        mic.watch(stall_after_s=1.0, silent_after_s=0.02, interval_s=0.005))
    await asyncio.sleep(0.4)
    watch.cancel()

    # Without backoff this is ~20 reopens; with it, the window doubles each
    # time and the count stays in single figures.
    assert 1 <= mic.reopens <= 8, f"reopened {mic.reopens} times while muted"


@pytest.mark.asyncio
async def test_the_watchdog_keeps_trying_after_a_failure(mic):
    """A resume may need several attempts before the device is back."""
    mic.start()
    attempts = []

    def refuse():
        attempts.append(1)
        raise OSError("Device unavailable")

    mic._open = refuse
    go_silent(mic, 30.0)

    watch = asyncio.create_task(mic.watch(stall_after_s=0.02, interval_s=0.01))
    await asyncio.sleep(0.2)
    watch.cancel()

    assert len(attempts) >= 2, "gave up after the first failed reopen"


@pytest.mark.asyncio
async def test_the_watchdog_ignores_a_stopped_microphone(mic):
    """Shutting down is not a stall; reopening during it would resurrect the
    device on the way out."""
    mic.start()
    mic.stop()
    go_silent(mic, 30.0)
    before = len(mic.opened)

    watch = asyncio.create_task(mic.watch(stall_after_s=0.02, interval_s=0.01))
    await asyncio.sleep(0.1)
    watch.cancel()

    assert len(mic.opened) == before


@pytest.mark.asyncio
async def test_a_frame_arriving_updates_the_clock(mic):
    mic.start()
    go_silent(mic, 30.0)
    stale = mic.last_frame_at

    mic._offer(np.zeros(1280, dtype=np.int16))

    assert mic.last_frame_at > stale

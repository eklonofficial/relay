"""Push-to-talk and abort.

Relay is deaf while it speaks, so the keybinding is the only way to interrupt
it. That makes this the one input path that runs *while* the microphone is
paused and Relay's own voice is still in the buffer -- the exact conditions
that produced the self-hearing bugs, so the draining is asserted here.
"""

import numpy as np
import pytest

from relay.audio.capture import FRAME_SAMPLES
from relay.audio.listener import Listener, VoiceActivity, WakeWordDetector
from relay.audio.playback import Playback
from relay.voice import VoiceLoop


class ScriptedMic:
    def __init__(self, frames: int = 40):
        self.frames_to_yield = frames
        self.drained = 0
        self._queued = 12
        # Diagnostics that Listener.stats() reads off the microphone.
        self.device = "test"
        self._capture_rate = 16_000
        self.dropped_frames = 0
        self.frames_yielded = 0
        self.consumers = 1

    async def frames(self):
        for _ in range(self.frames_to_yield):
            yield (np.ones(FRAME_SAMPLES) * 6000).astype(np.int16)

    def preroll(self):
        return np.zeros(0, dtype=np.int16)

    def drain(self) -> int:
        self.drained += 1
        dropped, self._queued = self._queued, 0
        return dropped


class QuietMic(ScriptedMic):
    async def frames(self):
        for _ in range(self.frames_to_yield):
            yield np.zeros(FRAME_SAMPLES, dtype=np.int16)


class LoudnessVad(VoiceActivity):
    def __init__(self):
        super().__init__()
        self._vad = None

    def is_speech(self, frame):
        return float(np.abs(frame.astype(np.float32)).mean()) > 100

    def reset(self):
        pass


def _listener(mic=None, activity=None) -> Listener:
    return Listener(
        mic or ScriptedMic(), WakeWordDetector(), LoudnessVad(),
        silence_ms=240, max_utterance_s=5, lead_in_ms=0,
        activity=activity,
    )


class Watcher:
    """Records what the listener said it was doing."""

    def __init__(self):
        self.events = []

    def wake(self):      self.events.append("wake")
    def listening(self): self.events.append("listening")
    def idle(self):      self.events.append("idle")
    def level(self, _):  pass


async def test_an_empty_turn_still_reports_that_it_ended():
    """A discarded utterance is never yielded, so the voice loop never runs
    and nothing downstream learns the turn is over.

    Found live, not here: the orb stayed out and the music stayed ducked
    after a push-to-talk that caught nothing, until the *next* time Relay was
    spoken to. Silence is the most likely way a turn ends by accident, so it
    is the one that must clean up after itself.
    """
    watcher = Watcher()
    listener = _listener(QuietMic(frames=40), activity=[watcher])
    listener.trigger()

    async for _ in listener.utterances():
        break

    assert "wake" in watcher.events
    assert watcher.events[-1] == "idle", (
        f"turn ended without saying so: {watcher.events}")


# ------------------------------------------------------------------ listener
def test_trigger_is_not_armed_by_default():
    assert not _listener().triggered


def test_trigger_sets_the_flag():
    listener = _listener()
    listener.trigger()
    assert listener.triggered


async def test_a_trigger_produces_an_utterance_without_a_wake_word():
    listener = _listener()
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert found, "push-to-talk should have recorded something"
    assert found[0].push_to_talk
    assert found[0].wake_word == "push_to_talk"


async def test_push_to_talk_works_while_paused():
    """The whole point: Relay is paused exactly when it is speaking."""
    listener = _listener()
    listener.pause()
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert found, "a paused listener still has to answer the key"
    assert not listener._paused, "triggering should clear the pause"


async def test_triggering_drains_the_microphone_first():
    """Regression guard for the self-hearing bug class.

    While Relay speaks, the frame queue keeps filling with Relay's own voice.
    Recording without dropping that backlog transcribes Relay's last reply as
    the user's next command.
    """
    mic = ScriptedMic()
    listener = _listener(mic)
    listener.pause()
    listener.trigger()
    [u async for u in listener.utterances()]
    assert mic.drained >= 1, "buffered audio must be dropped before recording"


async def test_the_trigger_is_consumed_not_repeated():
    listener = _listener()
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert len(found) == 1, "one key press is one turn"
    assert not listener.triggered


async def test_a_trigger_that_catches_silence_is_discarded():
    listener = _listener(QuietMic())
    listener.trigger()
    found = [u async for u in listener.utterances()]
    assert found == [], "a mis-press should not start an empty turn"


async def test_triggering_closes_an_open_follow_up_window():
    listener = _listener()
    listener.open_follow_up()
    listener.trigger()
    [u async for u in listener.utterances()]
    assert not listener.listening_for_follow_up
    assert not listener.follow_up_pending


def test_push_to_talk_count_is_reported():
    listener = _listener()
    assert listener.stats()["push_to_talks"] == 0


# --------------------------------------------------------------- voice loop
class FakePlayback:
    def __init__(self):
        self.interrupted = 0
        self.speaking = False

    def interrupt(self):
        self.interrupted += 1


class FakeListener:
    def __init__(self):
        self.triggered = False
        self.closed = 0
        self.opened = 0
        # The real listener arms the window rather than opening it outright,
        # and the voice loop reads that back to decide whether Relay is still
        # listening or genuinely finished.
        self.follow_up_pending = False
        self.listening_for_follow_up = False

    def trigger(self):
        self.triggered = True

    def close_follow_up(self):
        self.closed += 1
        self.follow_up_pending = False
        self.listening_for_follow_up = False

    def open_follow_up(self):
        self.opened += 1
        self.follow_up_pending = True

    def pause(self):
        pass

    def resume(self):
        pass


def _loop() -> VoiceLoop:
    loop = VoiceLoop.__new__(VoiceLoop)
    loop.playback = FakePlayback()
    loop.listener = FakeListener()
    loop._aborted = False
    loop._last_spoken = None
    loop.pause_while_speaking = True
    loop.cooldown_s = 0.0
    # No watchers in these tests: abort and the follow-up window are audio
    # behaviour and must work identically whether anything is drawing the
    # state or turning the music down or not.
    loop.activity = ()
    return loop


def test_abort_stops_playback_and_closes_the_window():
    loop = _loop()
    loop.abort()
    assert loop.playback.interrupted == 1
    assert loop.listener.closed == 1
    assert loop._aborted


async def test_abort_silences_subsequent_sentences():
    """Stopping playback alone isn't enough: the next streamed sentence would
    simply start speaking."""
    loop = _loop()
    spoken = []

    async def fake_synth(text):
        spoken.append(text)
        raise AssertionError("should not synthesise after an abort")

    loop.voices = type("V", (), {"synthesise": staticmethod(fake_synth)})()
    loop.abort()
    await loop.say("this should never be spoken")
    assert spoken == []


async def test_announce_speaks_even_after_an_abort():
    """Out-of-turn speech isn't part of the turn that was stopped.

    `relay say` and the model manager's "I've dropped to the CPU voice"
    notice both go through announce(). Routing them through say() meant one
    "never mind" silenced them until the next spoken turn -- so Relay went
    quiet about degrading at precisely the moment it degraded.
    """
    loop = _loop()
    spoken = []

    async def fake_synth(text):
        spoken.append(text)
        raise RuntimeError("stop here; synthesis is all we're checking")

    loop.voices = type("V", (), {"synthesise": staticmethod(fake_synth)})()
    loop.abort()
    await loop.announce("Switching to the CPU voice.")

    assert spoken == ["Switching to the CPU voice."]


async def test_announce_does_not_reopen_an_aborted_reply():
    """Clearing the flag must not resurrect the streamed reply behind it.

    announce() clears _aborted so its own line is spoken; the guard that
    matters is _ask_model's, which has already returned by then.
    """
    loop = _loop()
    loop.voices = type("V", (), {"synthesise": staticmethod(
        lambda text: (_ for _ in ()).throw(RuntimeError("no device")))})()
    loop.abort()
    assert loop._aborted
    await loop.announce("something out of band")
    # The turn stays abandoned: _offer_follow_up is what would restart it.
    loop._aborted = True
    loop._offer_follow_up()
    assert loop.listener.opened == 0


async def test_push_to_talk_interrupts_then_triggers():
    loop = _loop()
    await loop.listen_now()
    assert loop.playback.interrupted == 1, "must stop speaking first"
    assert loop.listener.triggered, "then take the command"


def test_an_aborted_turn_does_not_leave_a_follow_up_open():
    loop = _loop()
    loop.abort()
    loop._offer_follow_up()
    assert loop.listener.opened == 0


def test_a_pending_push_to_talk_suppresses_the_follow_up_window():
    """Otherwise the key press and the window race to record the same speech."""
    loop = _loop()
    loop.listener.triggered = True
    loop._offer_follow_up()
    assert loop.listener.opened == 0


def test_a_normal_turn_still_opens_the_follow_up_window():
    loop = _loop()
    loop._offer_follow_up()
    assert loop.listener.opened == 1


class OrbSpy:
    def __init__(self):
        self.states = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return lambda *a: self.states.append(name)


def test_the_orb_keeps_listening_through_the_follow_up_window():
    """Relay carries on listening for several seconds after it answers, and
    the orb has to say so.

    Retracting the moment it stopped talking made it look like it had left --
    so the follow-up window, the whole point of which is to let you just keep
    talking, was invisible and nobody used it.
    """
    loop = _loop()
    orb = OrbSpy()
    loop.activity = (orb,)

    loop._offer_follow_up()

    assert orb.states[-1] == "listening", orb.states


def test_the_orb_retracts_when_no_follow_up_is_offered():
    """With the window disabled the turn really is over."""
    loop = _loop()
    orb = OrbSpy()
    loop.activity = (orb,)
    loop.listener.open_follow_up = lambda: None      # window disabled

    loop._offer_follow_up()

    assert orb.states[-1] == "idle", orb.states


def test_a_new_turn_leaves_the_orb_alone():
    """Push-to-talk during a reply: the old turn's cleanup must not retract
    an orb that the new turn has just brought out."""
    loop = _loop()
    orb = OrbSpy()
    loop.activity = (orb,)
    loop.listener.triggered = True

    loop._offer_follow_up()

    assert orb.states == [], f"the new turn's orb was disturbed: {orb.states}"


# ------------------------------------------------------------- interrupting
def test_the_wake_word_stops_relay_mid_sentence():
    """Talking over it has to actually stop it.

    Without this, saying "Relay" over an answer starts a new turn whose
    recording is mostly the old answer still playing, while the old one runs
    to the end regardless.
    """
    loop = _loop()
    loop.playback.speaking = True

    loop.wake()

    assert loop.playback.interrupted == 1
    assert loop._aborted


def test_the_wake_word_does_nothing_when_relay_is_silent():
    """The ordinary case. Interrupting nothing must not abort the turn that
    is only just beginning."""
    loop = _loop()
    loop.playback.speaking = False

    loop.wake()

    assert loop.playback.interrupted == 0
    assert not loop._aborted


def test_interrupting_does_not_retract_the_orb():
    """A new turn is starting, not ending -- unlike abort(), which is a
    dismissal and should put the orb away."""
    loop = _loop()
    orb = OrbSpy()
    loop.activity = (orb,)
    loop.playback.speaking = True

    loop.wake()

    assert "idle" not in orb.states


# ----------------------------------------------------------- turn ownership
async def test_a_turn_says_when_it_is_running():
    """The orb's return to idle is debounced by a timer, and that timer must
    not fire inside a turn.

    Synthesising the next sentence of a reply can easily take longer than the
    debounce, and letting it fire there put the orb away in the middle of an
    answer that was still being spoken, then brought it back for the next
    sentence -- which is what made the animation stop matching the state.
    """
    loop = _loop()
    seen = []

    async def fake_turn(_utterance):
        seen.append(loop.in_turn)

    loop._turn = fake_turn
    await loop._handle(object())

    assert seen == [True]
    assert loop.in_turn is False


async def test_the_turn_flag_clears_even_when_the_turn_fails():
    """A turn that raises must not leave the orb owned by nobody, frozen
    wherever it happened to be."""
    loop = _loop()

    async def boom(_utterance):
        raise RuntimeError("bad turn")

    loop._turn = boom
    with pytest.raises(RuntimeError):
        await loop._handle(object())

    assert loop.in_turn is False


# ---------------------------------------------------------------- dismissal
def test_dismissal_words_are_whole_utterances_only():
    """"stop" ends the turn; "stop the music" is a command about music.

    Searching for these inside an utterance instead of matching the whole of
    it would make a third of ordinary requests unanswerable.
    """
    from relay.voice import STOP_WORDS

    for phrase in ("dismiss", "never mind", "that's all", "go away"):
        assert phrase in STOP_WORDS
    for command in ("stop the music", "cancel the timer", "no thanks i'd rather"):
        assert command not in STOP_WORDS

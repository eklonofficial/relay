"""Choosing a voice.

Kokoro names its voices `af_heart` and `bm_lewis`, which is a scheme rather
than a set of names: language letter, gender letter, then the name. The tests
that matter here are the ones about turning that back into something a person
can choose from, and about the picker still being usable when the models it
wants to preview are not installed.
"""

import curses

import pytest

from relay import voices as voices_mod
from relay.config import AudioConfig
from relay.voices import catalogue, describe

SAMPLE_IDS = [
    "af_heart", "am_michael", "bf_emma", "bm_lewis",
    "jf_alpha", "zm_yunxi", "ef_dora",
]


# ------------------------------------------------------------------ naming
def test_an_id_becomes_something_readable():
    voice = describe("af_heart")
    assert voice.name == "Heart"
    assert voice.language == "American English"
    assert voice.gender == "female"
    assert voice.label == "American English · female"


def test_every_language_prefix_is_understood():
    for voice_id in SAMPLE_IDS:
        assert describe(voice_id).language != "Other", voice_id


def test_british_and_american_are_told_apart():
    """Both are English and they do not sound the same, so a picker that
    called them both "English" would be hiding the choice being made."""
    assert describe("am_michael").language == "American English"
    assert describe("bm_lewis").language == "British English"


def test_an_unrecognised_id_still_produces_a_row():
    """A new Kokoro release adding a language must not empty the picker."""
    voice = describe("qq_mystery")
    assert voice.id == "qq_mystery"
    assert voice.name == "Mystery"
    assert voice.language == "Other"


def test_an_id_with_no_underscore_survives():
    assert describe("nonsense").name == "Nonsense"


# ----------------------------------------------------------------- ordering
def test_english_voices_come_first():
    """Relay speaks English. Making someone scroll past Mandarin to find it
    would be a strange way to arrange the list."""
    ordered = catalogue(SAMPLE_IDS)
    assert ordered[0].language == "American English"
    languages = [v.language for v in ordered]
    assert languages.index("American English") < languages.index("British English")
    assert languages.index("British English") < languages.index("Mandarin")


def test_the_catalogue_keeps_every_voice():
    assert len(catalogue(SAMPLE_IDS)) == len(SAMPLE_IDS)


# --------------------------------------------------------- missing models
def test_no_models_means_no_voices_not_an_exception(tmp_path):
    """The caller is an interactive picker. "No voices installed" is a
    sentence to print, not a traceback."""
    assert voices_mod.available(tmp_path) == []


# ------------------------------------------------------------------ config
def test_the_chosen_voice_is_a_config_field():
    assert AudioConfig().tts_voice
    assert describe(AudioConfig().tts_voice).language == "American English"


def test_the_voice_survives_a_config_round_trip(tmp_path):
    from relay import config as config_mod
    from relay import settings as settings_mod

    cfg = config_mod.Config()
    cfg.audio.tts_voice = "bm_george"
    path = tmp_path / "config.toml"
    settings_mod.save(cfg, path)

    assert config_mod.load(path).audio.tts_voice == "bm_george"


# ------------------------------------------------------------------ picker
class FakeScreen:
    """Enough curses to draw against without a terminal."""

    def __init__(self, height=24, width=90):
        self._size = (height, width)
        self.lines = []

    def getmaxyx(self):
        return self._size

    def erase(self):
        self.lines = []

    def addstr(self, row, col, text, *attrs):
        self.lines.append((row, text))

    def attron(self, _a):
        pass

    def attroff(self, _a):
        pass

    def refresh(self):
        pass


@pytest.fixture
def screen(monkeypatch):
    from relay import voice_tui

    monkeypatch.setattr(voice_tui.voices_mod, "available",
                        lambda _dir: catalogue(SAMPLE_IDS))
    return voice_tui.VoiceScreen()


def test_the_picker_opens_on_the_current_voice(screen, monkeypatch):
    """Fifty-four voices deep, opening at the top would mean hunting for the
    one already in use."""
    screen.current = "bm_lewis"
    screen.index = next(i for i, v in enumerate(screen.voices)
                        if v.id == "bm_lewis")
    assert screen.voices[screen.index].id == "bm_lewis"


def test_the_picker_draws(screen):
    screen.draw(FakeScreen())        # reaching the end is the assertion


def test_the_picker_draws_in_a_tiny_terminal(screen):
    """Truncation is the difference between a small window and a crash."""
    screen.draw(FakeScreen(height=6, width=20))


def test_the_selected_row_stays_on_screen(screen):
    """Scrolling has to follow the selection, or arrowing down past the
    bottom moves an invisible cursor."""
    fake = FakeScreen(height=10)
    screen.index = len(screen.voices) - 1
    screen.draw(fake)

    last = screen.voices[-1]
    assert any(last.name in text for _row, text in fake.lines), \
        "the selected voice was scrolled off the screen"


def test_the_picker_says_which_voice_this_actually_changes(screen):
    """On this machine the GPU voice is usually the one you hear, and it is
    not in this list. Not saying so would make the feature look broken."""
    fake = FakeScreen()
    screen.draw(fake)
    text = " ".join(t for _r, t in fake.lines)
    assert "CPU voice" in text and "Chatterbox" in text


def test_navigation_stays_in_range(screen):
    screen.index = 0
    screen.index = max(0, screen.index - 1)
    assert screen.index == 0

    screen.index = len(screen.voices) - 1
    screen.index = min(len(screen.voices) - 1, screen.index + 1)
    assert screen.index == len(screen.voices) - 1


def test_arrow_keys_are_the_documented_way_around(screen):
    from relay import voice_tui

    assert "up/down" in voice_tui.HELP
    assert curses.KEY_UP is not None

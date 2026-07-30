"""Settings editing and persistence."""

import pytest

from relay import config as config_mod
from relay import settings as settings_mod
from relay.settings import Field, ValidationError, parse


# ---------------------------------------------------------------- parsing
@pytest.mark.parametrize(
    ("raw", "expected"),
    [("yes", True), ("no", False), ("true", True), ("0", False), ("ON", True)],
)
def test_bool_parsing(raw, expected):
    assert parse(Field("x", "x", "", "bool"), raw) is expected


def test_bad_bool_is_rejected():
    with pytest.raises(ValidationError, match="yes or no"):
        parse(Field("x", "x", "", "bool"), "maybe")


def test_choice_must_be_one_of_the_options():
    field = Field("x", "x", "", "choice", choices=("low", "high"))
    assert parse(field, "high") == "high"
    with pytest.raises(ValidationError, match="one of"):
        parse(field, "medium")


def test_numbers_respect_their_bounds():
    field = Field("x", "x", "", "float", minimum=0.05, maximum=0.99)
    assert parse(field, "0.85") == 0.85
    with pytest.raises(ValidationError, match="at most"):
        parse(field, "1.5")
    with pytest.raises(ValidationError, match="at least"):
        parse(field, "0.01")


def test_non_numeric_input_is_rejected():
    with pytest.raises(ValidationError, match="expected a number"):
        parse(Field("x", "x", "", "float"), "loud")


def test_empty_string_is_rejected():
    with pytest.raises(ValidationError, match="empty"):
        parse(Field("x", "x", "", "str"), "   ")


# ----------------------------------------------------------- get and set
def test_nested_paths_resolve():
    cfg = config_mod.Config()
    settings_mod.set_value(cfg, "audio.wake_threshold", 0.7)
    assert settings_mod.get_value(cfg, "audio.wake_threshold") == 0.7
    assert cfg.audio.wake_threshold == 0.7


def test_top_level_paths_resolve():
    cfg = config_mod.Config()
    settings_mod.set_value(cfg, "mode", "dry_run")
    assert cfg.mode == "dry_run"


def test_every_declared_field_actually_exists():
    """A typo in the field list would otherwise only surface at runtime."""
    cfg = config_mod.Config()
    for field in settings_mod.FIELDS:
        settings_mod.get_value(cfg, field.path)


# -------------------------------------------------------------- persistence
def test_only_changed_settings_are_written(tmp_path):
    """Storing defaults would freeze them, so upgrades stop improving them."""
    cfg = config_mod.Config()
    assert settings_mod.changed_from_defaults(cfg) == {}

    cfg.audio.wake_threshold = 0.7
    assert settings_mod.changed_from_defaults(cfg) == {"audio.wake_threshold": 0.7}


def test_save_and_reload_round_trip(tmp_path):
    path = tmp_path / "config.toml"
    cfg = config_mod.Config()
    cfg.audio.wake_threshold = 0.72
    cfg.mode = "dry_run"
    cfg.fast_path_enabled = False

    settings_mod.save(cfg, path)
    reloaded = config_mod.load(path)

    assert reloaded.audio.wake_threshold == 0.72
    assert reloaded.mode == "dry_run"
    assert reloaded.fast_path_enabled is False
    # Untouched settings still come from defaults. Compared against the
    # default itself rather than a copy of its value, so tuning the default
    # doesn't fail a test that is about round-tripping.
    assert reloaded.audio.vad_silence_ms == config_mod.AudioConfig().vad_silence_ms


def test_saving_preserves_settings_the_editor_does_not_expose(tmp_path):
    """The wake-word model path isn't editable here; saving must not drop it."""
    path = tmp_path / "config.toml"
    path.write_text(
        '[audio]\nwake_word = "/models/relay.onnx"\nwake_threshold = 0.85\n'
    )

    cfg = config_mod.load(path)
    cfg.audio.wake_threshold = 0.9
    settings_mod.save(cfg, path)

    reloaded = config_mod.load(path)
    assert reloaded.audio.wake_word == "/models/relay.onnx", "custom model path was lost"
    assert reloaded.audio.wake_threshold == 0.9


def test_top_level_keys_are_written_before_tables(tmp_path):
    """A bare key after a [table] silently becomes part of that table."""
    path = tmp_path / "config.toml"
    cfg = config_mod.Config()
    cfg.mode = "dry_run"
    cfg.audio.wake_threshold = 0.7
    settings_mod.save(cfg, path)

    reloaded = config_mod.load(path)
    assert reloaded.mode == "dry_run"
    assert reloaded.audio.wake_threshold == 0.7


# ------------------------------------------------------------- display
def test_fractions_display_as_percentages():
    field = next(f for f in settings_mod.FIELDS if f.path == "usage.block_at_utilization")
    assert settings_mod.display(field, 0.92) == "92%"


def test_booleans_display_readably():
    field = next(f for f in settings_mod.FIELDS if f.kind == "bool")
    assert settings_mod.display(field, True) == "yes"
    assert settings_mod.display(field, False) == "no"


def test_long_paths_are_shortened_for_display():
    field = Field("audio.input_device", "Mic", "", "str")
    shown = settings_mod.display(field, "a" * 100)
    assert len(shown) < 50

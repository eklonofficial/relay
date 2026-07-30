"""Editable settings: the schema behind `relay settings`.

The field list is kept separate from the curses UI so validation and saving
can be tested without a terminal. Only settings worth changing by hand are
exposed; the rest stay in config.toml for anyone who wants them.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import tomli_w

from relay import config as config_mod
from relay.paths import PATHS


@dataclass
class Field:
    path: str                    # dotted path into Config, e.g. "audio.wake_threshold"
    label: str
    help: str
    kind: str                    # float | int | str | bool | choice
    choices: tuple[str, ...] = ()
    minimum: float | None = None
    maximum: float | None = None
    # Shown as dots. Editable, but never printed back -- `relay settings
    # --list` output gets pasted into bug reports.
    secret: bool = False

    @property
    def section(self) -> str:
        return self.path.split(".")[0] if "." in self.path else "general"


FIELDS: list[Field] = [
    # --- listening ------------------------------------------------------
    Field("audio.wake_threshold", "Wake word threshold",
          "How confident before Relay wakes. Lower = more sensitive. "
          "Your voice scores 0.95-1.00; 'relate' scores 0.80.",
          "float", minimum=0.05, maximum=0.99),
    Field("audio.lead_in_ms", "Look-back",
          "How far back to reach for the command. The wake word is confirmed "
          "about a second after you say it, so this must cover the gap.",
          "int", minimum=0, maximum=2400),
    Field("audio.vad_silence_ms", "End-of-speech silence",
          "How long you have to stop talking before Relay decides you're done.",
          "int", minimum=200, maximum=3000),
    Field("audio.post_speech_cooldown_ms", "Cooldown after speaking",
          "Ignore the mic briefly after Relay talks, so it doesn't hear itself.",
          "int", minimum=0, maximum=3000),
    Field("audio.tts_voice", "Voice (CPU tier)",
          "Which Kokoro preset Relay speaks in when the GPU is busy. "
          "Choose it by ear with `relay voice` -- fifty-four voices named "
          "things like am_fenrir are not choosable from a list.",
          "str"),
    Field("audio.wake_chime", "Listening chime",
          "A short sound when Relay starts recording, so you know it heard "
          "you.", "bool"),
    Field("audio.wake_chime_volume", "Chime volume",
          "It plays while the microphone is live, so quiet is safer. Turn it "
          "down first if Relay starts mishearing you.",
          "float", minimum=0.0, maximum=1.0),
    Field("audio.input_device", "Microphone",
          "PipeWire source name. `relay devices` lists what's available.", "str"),

    # --- claude usage ---------------------------------------------------
    Field("usage.block_at_utilization", "Stop at plan usage",
          "Relay stops working above this share of your Claude plan window, "
          "leaving allowance for your own conversations. Not a spending limit "
          "-- Relay never costs money.",
          "float", minimum=0.1, maximum=1.0),
    Field("usage.telemetry_max_age_s", "Trust usage readings for",
          "Seconds. Claude only reports usage when it changes, so older "
          "readings are ignored rather than acted on.",
          "float", minimum=60, maximum=7200),
    Field("usage.session_idle_minutes", "Start a fresh session after",
          "Minutes idle before Relay drops conversation history. Keeps each "
          "turn cheap; 0 disables.",
          "float", minimum=0, maximum=240),

    # --- model ----------------------------------------------------------
    Field("agent.model", "Claude model", "Which model answers.", "str"),
    Field("agent.effort", "Thinking effort",
          "How hard Claude thinks. 'low' is fastest and cheapest, which suits "
          "spoken replies.",
          "choice", choices=("low", "medium", "high", "xhigh", "max")),

    # --- behaviour ------------------------------------------------------
    Field("mode", "Execution mode",
          "dry_run previews actions without performing them.",
          "choice", choices=("normal", "dry_run")),
    Field("fast_path_enabled", "Local fast path",
          "Answer simple commands without calling Claude. Free and instant. "
          "Turn off only to debug.",
          "bool"),
    Field("models.tier", "GPU tier",
          "auto follows free VRAM. full = GPU voice, lite = CPU voice, "
          "sleep = wake word only.",
          "choice", choices=("auto", "full", "lite", "sleep")),
    Field("models.announce_transitions", "Announce tier changes",
          "Say something out loud when switching between GPU and CPU.", "bool"),
    # --- music ----------------------------------------------------------
    Field("music.cider_token", "Cider API token",
          "From Cider: Settings -> Connectivity -> Manage External Application "
          "Access. Needed to play songs by name.",
          "str", secret=True),
    Field("music.cider_url", "Cider API address",
          "Where Cider's local API listens. Change only if you moved the port.",
          "str"),
    Field("music.launch_timeout_s", "Wait for Cider to start",
          "How long to wait for Cider's API after launching it, in seconds.",
          "float", minimum=1.0, maximum=120.0),
    Field("music.allow_mpris_fallback", "Fall back to MPRIS",
          "If Cider's API is unreachable, use playerctl for play, pause and "
          "skip. No token needed, but no search.",
          "bool"),
]


def get_value(cfg: config_mod.Config, path: str) -> Any:
    target: Any = cfg
    for part in path.split("."):
        target = getattr(target, part)
    return target


def set_value(cfg: config_mod.Config, path: str, value: Any) -> None:
    parts = path.split(".")
    target: Any = cfg
    for part in parts[:-1]:
        target = getattr(target, part)
    setattr(target, parts[-1], value)


class ValidationError(ValueError):
    pass


def parse(field: Field, raw: str) -> Any:
    """Turn typed text into a valid value, or explain why it isn't one."""
    raw = raw.strip()
    if field.kind == "bool":
        if raw.lower() in ("true", "yes", "y", "on", "1"):
            return True
        if raw.lower() in ("false", "no", "n", "off", "0"):
            return False
        raise ValidationError("expected yes or no")

    if field.kind == "choice":
        if raw not in field.choices:
            raise ValidationError(f"expected one of: {', '.join(field.choices)}")
        return raw

    if field.kind == "int":
        try:
            value = int(float(raw))
        except ValueError as exc:
            raise ValidationError("expected a whole number") from exc
        return _bounded(field, value)

    if field.kind == "float":
        try:
            value = float(raw)
        except ValueError as exc:
            raise ValidationError("expected a number") from exc
        return _bounded(field, value)

    if not raw:
        raise ValidationError("cannot be empty")
    return raw


def _bounded(field: Field, value):
    if field.minimum is not None and value < field.minimum:
        raise ValidationError(f"must be at least {field.minimum:g}")
    if field.maximum is not None and value > field.maximum:
        raise ValidationError(f"must be at most {field.maximum:g}")
    return value


def display(field: Field, value: Any) -> str:
    if field.secret:
        # Enough to confirm something is set, not enough to leak it.
        text = str(value or "")
        if not text:
            return "(not set)"
        return "•" * 8 + text[-4:]
    if field.kind == "bool":
        return "yes" if value else "no"
    if field.kind == "float":
        # Utilisation-style fractions read better as percentages.
        if field.maximum == 1.0 and 0 <= float(value) <= 1:
            return f"{float(value):.0%}"
        return f"{float(value):g}"
    if field.path == "audio.wake_word" or field.kind == "str":
        text = str(value)
        return f"...{text[-40:]}" if len(text) > 43 else text
    return str(value)


def changed_from_defaults(cfg: config_mod.Config) -> dict[str, Any]:
    """Only persist what differs, so upgrades keep improving the defaults."""
    defaults = config_mod.Config()
    out: dict[str, Any] = {}
    for field in FIELDS:
        current = get_value(cfg, field.path)
        if current != get_value(defaults, field.path):
            out[field.path] = current
    return out


def to_toml(cfg: config_mod.Config, *, preserve: dict[str, Any] | None = None) -> str:
    """Render the changed settings as config.toml."""
    document: dict[str, Any] = {}
    for path, value in {**(preserve or {}), **changed_from_defaults(cfg)}.items():
        parts = path.split(".")
        if len(parts) == 1:
            document[parts[0]] = value
        else:
            document.setdefault(parts[0], {})[parts[1]] = value
    # Top-level keys must come before any table, or they land inside it.
    ordered = {k: v for k, v in document.items() if not isinstance(v, dict)}
    ordered.update({k: v for k, v in document.items() if isinstance(v, dict)})
    return tomli_w.dumps(ordered)


def save(cfg: config_mod.Config, path: Path | None = None) -> Path:
    target = path or PATHS.config_file
    target.parent.mkdir(parents=True, exist_ok=True)

    # Keep settings the editor doesn't expose (e.g. the wake-word model path).
    preserve: dict[str, Any] = {}
    if target.exists():
        import tomllib

        existing = tomllib.loads(target.read_text())
        known = {f.path for f in FIELDS}
        for section, value in existing.items():
            if isinstance(value, dict):
                for key, inner in value.items():
                    if f"{section}.{key}" not in known:
                        preserve[f"{section}.{key}"] = inner
            elif section not in known:
                preserve[section] = value

    header = (
        "# Relay configuration.\n"
        "# Written by `relay settings`. Only values differing from the\n"
        "# defaults are stored, so upgrades keep improving everything else.\n\n"
    )
    target.write_text(header + to_toml(cfg, preserve=preserve))

    # The Cider client caches the token it was built with, so a token edited
    # here would otherwise not take effect until the daemon restarted.
    with contextlib.suppress(Exception):
        from relay.tools import music

        music.reset_client()
    return target

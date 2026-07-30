"""The voices Relay can speak in.

Kokoro ships 54 of them and names them things like `af_heart` and `bm_lewis`,
which tells you everything if you know the scheme and nothing if you don't.
The first letter is the language, the second is the gender, and the rest is a
name. This turns that back into something readable, and puts the English
voices first, because that is what Relay speaks.

Only Kokoro is listed. Chatterbox, the GPU voice, does not have presets at
all -- it clones from a reference clip, which is a different thing to choose
and a different way of choosing it.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

# The first letter of a Kokoro voice id.
LANGUAGES = {
    "a": ("American English", 0),
    "b": ("British English", 1),
    "e": ("Spanish", 2),
    "f": ("French", 3),
    "h": ("Hindi", 4),
    "i": ("Italian", 5),
    "j": ("Japanese", 6),
    "p": ("Portuguese", 7),
    "z": ("Mandarin", 8),
}

GENDERS = {"f": "female", "m": "male"}

SAMPLE = "Hi Andrew. This is how I would sound."


@dataclass(frozen=True)
class Voice:
    id: str                 # what Kokoro wants: "af_heart"
    name: str               # what a person wants: "Heart"
    language: str
    gender: str
    order: int              # English first

    @property
    def label(self) -> str:
        return f"{self.language} · {self.gender}"


def describe(voice_id: str) -> Voice:
    """Unpack a Kokoro id. Unknown shapes degrade to the raw id."""
    code, _, rest = voice_id.partition("_")
    language, order = LANGUAGES.get(code[:1], ("Other", 9))
    gender = GENDERS.get(code[1:2], "")
    name = (rest or voice_id).replace("_", " ").title()
    return Voice(id=voice_id, name=name, language=language,
                 gender=gender, order=order)


def catalogue(voice_ids) -> list[Voice]:
    """Every voice, English first, then alphabetically within a language."""
    voices = [describe(v) for v in voice_ids]
    return sorted(voices, key=lambda v: (v.order, v.gender, v.name))


def model_paths(models_dir: Path) -> tuple[Path, Path]:
    from relay.tts.engine import KOKORO_MODEL, KOKORO_VOICES

    return models_dir / KOKORO_MODEL, models_dir / KOKORO_VOICES


def available(models_dir: Path) -> list[Voice]:
    """What this machine can actually speak in.

    Returns an empty list rather than raising when the models are missing:
    the caller is an interactive picker, and "no voices installed" is a
    sentence, not a traceback.
    """
    model, voices = model_paths(models_dir)
    if not model.exists() or not voices.exists():
        return []
    try:
        from kokoro_onnx import Kokoro

        return catalogue(Kokoro(str(model), str(voices)).get_voices())
    except Exception:  # noqa: BLE001
        return []

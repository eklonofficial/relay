"""What the repository must contain, and must not.

Both of these guard failures that are invisible until the worst moment.

The first is real and happened: `.gitignore` carried an unanchored `models/`,
meant for downloaded weights, which also matched the source package
`relay/models/`. It was never committed. A clone would have installed
perfectly and then failed to start on `No module named 'relay.models'`, and
nothing in the test suite or the backup would have said a word.

The second is the GPU voice growing back. It was removed deliberately: it
sounded no better than the CPU one, held three gigabytes of an eight
gigabyte card, and dragged in torch, CUDA and a warm-up that delayed every
restart.
"""

import subprocess
import tomllib
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def tracked() -> set[str]:
    out = subprocess.run(["git", "ls-files"], cwd=REPO,
                         capture_output=True, text=True, check=False).stdout
    return set(out.split())


def test_every_source_file_is_committed():
    """A file that runs locally and is missing from the repository is a
    backup that restores something which cannot start."""
    on_disk = {
        str(p.relative_to(REPO))
        for p in REPO.glob("relay/**/*.py")
        if "__pycache__" not in p.parts
    }
    missing = sorted(on_disk - tracked())
    assert not missing, f"source files excluded from git: {missing}"


def test_the_weights_rule_cannot_swallow_source():
    """Anchored, so it means "the weights directory at the root" and not
    "any directory called models, anywhere"."""
    ignored = (REPO / ".gitignore").read_text()
    assert "/models/" in ignored
    for line in ignored.splitlines():
        assert line.strip() != "models/", "unanchored models/ is back"


def test_the_gpu_voice_is_gone():
    data = tomllib.loads((REPO / "pyproject.toml").read_text())
    extras = data["project"].get("optional-dependencies", {})
    assert "gpu" not in extras

    everything = [*data["project"]["dependencies"],
                  *(dep for group in extras.values() for dep in group)]
    for banned in ("torch", "torchaudio", "chatterbox", "nvidia-ml-py"):
        assert not any(dep.lower().startswith(banned) for dep in everything), \
            f"{banned} is back in pyproject.toml"


def test_nothing_imports_the_tier_system():
    """`relay/models/` existed only to choose between two voices."""
    out = subprocess.run(
        ["git", "grep", "-l", "-E",
         r"relay\.models|ModelManager|VoiceRouter|ChatterboxTTS|TIER_(FULL|LITE|SLEEP)",
         # Not itself: the names have to be written down somewhere to be
         # searched for, and this file is where. It only started matching
         # once it was committed -- `git grep` searches tracked files -- so
         # the guard passed when it was written and failed on the next run.
         "--", "relay", "tests", "scripts",
         f":!{Path(__file__).relative_to(REPO)}"],
        cwd=REPO, capture_output=True, text=True, check=False)
    assert out.stdout.strip() == "", f"tier machinery still referenced in:\n{out.stdout}"


def test_the_permission_tiers_are_untouched():
    """A different thing entirely, and it shares the word. Removing the power
    tiers must not have taken AUTO/ASK/NEVER with them."""
    from relay.permissions import Tier

    assert {Tier.AUTO, Tier.ASK, Tier.NEVER}

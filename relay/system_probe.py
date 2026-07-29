"""Work out what this computer actually is, and record it.

This is the "computer memory" layer: it's what lets "open my browser" or
"play some music" resolve to real binaries. Everything written here uses
source='probed', so an explicit correction from the user always wins and
survives the next boot — which matters, because auto-detection is often
wrong. On this machine xdg-settings reports firedragon while the user
actually uses Zen.
"""

from __future__ import annotations

import logging
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path

from relay.memory.store import MemoryStore

log = logging.getLogger(__name__)

# Applications worth knowing about, grouped by the role a person would name
# out loud. First match on PATH wins, so order is preference order.
ROLE_CANDIDATES: dict[str, list[str]] = {
    "browser": ["zen-browser", "firedragon", "firefox", "chromium", "google-chrome-stable"],
    "editor": ["code", "cursor", "nvim", "micro", "kate", "gedit"],
    "terminal": ["kitty", "alacritty", "foot", "wezterm", "konsole"],
    "file_manager": ["nautilus", "dolphin", "thunar", "nemo"],
    "music": ["cider", "spotify", "rhythmbox", "elisa"],
    "chat": ["discord", "vesktop", "element-desktop", "signal-desktop"],
    "3d": ["blender"],
    "games": ["steam", "lutris", "heroic"],
    "screenshot": ["hyprshot", "grim", "flameshot", "spectacle"],
    "image_editor": ["gimp", "krita", "inkscape"],
    "video_editor": ["kdenlive", "davinci-resolve", "shotcut"],
}


def _run(*argv: str, timeout: float = 5.0) -> str:
    if shutil.which(argv[0]) is None:
        return ""
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
        return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def probe(store: MemoryStore) -> dict[str, str]:
    """Detect and record machine facts. Returns everything written."""
    facts: dict[str, tuple[str, str]] = {}  # key -> (value, category)

    def add(key: str, value: str | None, category: str) -> None:
        if value:
            facts[key] = (str(value).strip(), category)

    # --- identity -----------------------------------------------------
    add("os", _os_name(), "system")
    add("kernel", platform.release(), "system")
    add("hostname", platform.node(), "system")
    add("username", os.environ.get("USER") or "", "system")
    add("home", str(Path.home()), "paths")
    add("shell", Path(os.environ.get("SHELL", "")).name, "system")

    # --- desktop ------------------------------------------------------
    add("desktop", os.environ.get("XDG_CURRENT_DESKTOP"), "desktop")
    add("session_type", os.environ.get("XDG_SESSION_TYPE"), "desktop")
    if shutil.which("hyprctl"):
        version = _run("hyprctl", "version")
        match = re.search(r"Tag:\s*(v[\d.]+)", version) or re.search(r"(v?\d+\.\d+\.\d+)", version)
        add("window_manager", f"Hyprland {match.group(1)}" if match else "Hyprland", "desktop")
        add("monitors", _monitors(), "desktop")

    # --- hardware -----------------------------------------------------
    add("cpu", _cpu(), "hardware")
    add("memory", _memory(), "hardware")
    add("gpu", _gpu(), "hardware")

    # --- audio --------------------------------------------------------
    add("audio_server", "PipeWire" if shutil.which("pipewire") else None, "audio")
    add("microphone", _default_source(), "audio")

    # --- applications by role ----------------------------------------
    for role, candidates in ROLE_CANDIDATES.items():
        found = next((c for c in candidates if shutil.which(c)), None)
        add(role, found, "apps")

    # --- notable directories -----------------------------------------
    for name in ("Projects", "Documents", "Downloads", "Pictures", "Videos", "Music"):
        path = Path.home() / name
        if path.is_dir():
            add(f"dir_{name.lower()}", str(path), "paths")

    for key, (value, category) in facts.items():
        store.set_fact(key, value, category=category, source="probed")

    log.info("probed %d machine facts", len(facts))
    return {key: value for key, (value, _) in facts.items()}


def _os_name() -> str:
    try:
        for line in Path("/etc/os-release").read_text().splitlines():
            if line.startswith("PRETTY_NAME="):
                return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return platform.system()


def _cpu() -> str:
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.startswith("model name"):
                name = line.split(":", 1)[1].strip()
                return f"{name} ({os.cpu_count()} threads)"
    except OSError:
        pass
    return f"{platform.machine()} ({os.cpu_count()} threads)"


def _memory() -> str:
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                kb = int(line.split()[1])
                return f"{kb / 1024 / 1024:.0f} GiB"
    except (OSError, ValueError):
        pass
    return ""


def _gpu() -> str:
    out = _run("nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader")
    if out:
        first = out.splitlines()[0]
        name, _, memory = first.partition(",")
        return f"{name.strip()} ({memory.strip()})"
    lspci = _run("lspci")
    for line in lspci.splitlines():
        if re.search(r"VGA|3D controller", line):
            return line.split(":", 2)[-1].strip()
    return ""


def _monitors() -> str:
    out = _run("hyprctl", "-j", "monitors")
    if not out:
        return ""
    try:
        import json

        monitors = json.loads(out)
    except (ValueError, TypeError):
        return ""
    return ", ".join(
        f"{m.get('name')} {m.get('width')}x{m.get('height')}@{float(m.get('refreshRate', 0)):.0f}Hz"
        for m in monitors
    )


def _default_source() -> str:
    """The microphone, by human-readable description rather than sink name."""
    out = _run("pactl", "info")
    default_name = ""
    for line in out.splitlines():
        if line.startswith("Default Source:"):
            default_name = line.split(":", 1)[1].strip()
            break
    if not default_name:
        return ""
    # Monitor sources are loopbacks of outputs, never a real mic.
    if default_name.endswith(".monitor"):
        listing = _run("pactl", "list", "short", "sources")
        for line in listing.splitlines():
            parts = line.split()
            if len(parts) > 1 and not parts[1].endswith(".monitor"):
                return parts[1]
    return default_name

"""`relay install-service` — run Relay under systemd so it survives the terminal.

Relay is a session service, not a system one: it needs the compositor's socket
for window control and the user's PipeWire for the microphone, so it lives in
the systemd *user* manager and is bound to graphical-session.target.

The awkward part is the environment. WAYLAND_DISPLAY and, especially,
HYPRLAND_INSTANCE_SIGNATURE change every login, so they cannot be baked into
the unit file. There are two ways they reach the service:

  * Under uwsm (which this machine uses), the compositor is itself started by
    systemd and uwsm finalizes those variables into the user manager on every
    login. Nothing else is needed and nothing goes stale.
  * Otherwise `systemctl --user import-environment` copies them across, but
    only as a snapshot of the session that ran it. That is why install writes
    a note telling you to add the same line to hyprland.conf -- without it the
    service comes back after a reboot pointed at a compositor that no longer
    exists.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
from pathlib import Path

UNIT_NAME = "relay.service"
SOURCE_UNIT = Path(__file__).resolve().parent.parent / "systemd" / UNIT_NAME
UNIT_DIR = Path(
    os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")
) / "systemd" / "user"

# The three that cannot be hardcoded. XDG_RUNTIME_DIR is stable in practice but
# is what the other two are resolved against, so it travels with them.
SESSION_VARS = ("WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "XDG_RUNTIME_DIR")

FOLLOW_LOGS = "journalctl --user -u relay -f"

# The console scripts are installed into the virtualenv, which is not on PATH,
# so `relay` and `relay docs` do nothing in a normal terminal. ~/.local/bin is
# already on PATH on this machine, so link them there. Symlinks rather than
# copies: reinstalling the venv then keeps them working.
BIN_DIR = Path.home() / ".local" / "bin"
ENTRY_POINTS = ("relay", "relayd")


def link_commands(venv_bin: Path | None = None) -> list[str]:
    """Put `relay` and `relayd` on PATH. Returns human-readable notes."""
    venv_bin = venv_bin or Path(__file__).resolve().parent.parent / ".venv" / "bin"
    notes: list[str] = []
    BIN_DIR.mkdir(parents=True, exist_ok=True)

    for name in ENTRY_POINTS:
        source = venv_bin / name
        if not source.exists():
            notes.append(f"Skipped {name}: {source} does not exist.")
            continue
        target = BIN_DIR / name
        if target.is_symlink() and target.resolve() == source.resolve():
            continue  # already correct, say nothing
        if target.exists() and not target.is_symlink():
            notes.append(f"Left {target} alone: it exists and isn't a symlink.")
            continue
        target.unlink(missing_ok=True)
        target.symlink_to(source)
        notes.append(f"Linked {target} -> {source}")

    if notes and str(BIN_DIR) not in os.environ.get("PATH", "").split(os.pathsep):
        notes.append(f"Note: {BIN_DIR} is not on your PATH, so `relay` still "
                     "won't resolve. Add it to your shell profile.")
    return notes


def _systemctl(*args: str) -> tuple[int, str]:
    try:
        proc = subprocess.run(
            ["systemctl", "--user", *args],
            capture_output=True, text=True, check=False, timeout=30,
        )
    except FileNotFoundError:
        return 127, "systemctl not found; this needs a systemd user session"
    except subprocess.TimeoutExpired:
        return 124, "systemctl timed out"
    return proc.returncode, (proc.stdout + proc.stderr).strip()


def manager_environment() -> dict[str, str]:
    """What the systemd user manager will hand to the service."""
    code, out = _systemctl("show-environment")
    if code != 0:
        return {}
    env = {}
    for line in out.splitlines():
        key, sep, value = line.partition("=")
        if sep:
            env[key] = value
    return env


def uwsm_managed(env: dict[str, str] | None = None) -> bool:
    """True when uwsm owns the session and refreshes the variables itself.

    uwsm sets UWSM_FINALIZE_VARNAMES in the manager environment listing exactly
    which variables it will finalize each login. If HYPRLAND_INSTANCE_SIGNATURE
    is in that list, the stale-after-reboot problem does not apply.
    """
    env = manager_environment() if env is None else env
    return "HYPRLAND_INSTANCE_SIGNATURE" in env.get("UWSM_FINALIZE_VARNAMES", "")


def missing_session_vars(env: dict[str, str] | None = None) -> list[str]:
    env = manager_environment() if env is None else env
    return [name for name in SESSION_VARS if not env.get(name)]


def is_installed() -> bool:
    return (UNIT_DIR / UNIT_NAME).exists()


def is_active() -> bool:
    return _systemctl("is-active", "--quiet", UNIT_NAME)[0] == 0


def foreign_daemon_running(socket_path: Path) -> bool:
    """A relayd started by hand still holds the socket; systemd's would collide.

    Checked by connecting rather than by process name -- `pgrep -f "python -m
    relay"` matches its own command line, and has bitten this project twice.
    """
    if not socket_path.exists():
        return False
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            sock.settimeout(1.0)
            sock.connect(str(socket_path))
    except OSError:
        return False  # stale socket file, nothing listening
    return not is_active()


def install(*, enable: bool = True, start: bool = True) -> tuple[int, list[str]]:
    """Copy the unit in, wire up the environment, enable and start it."""
    notes: list[str] = []

    if not SOURCE_UNIT.exists():
        return 1, [f"Unit file missing: {SOURCE_UNIT}"]

    from relay.paths import PATHS

    if foreign_daemon_running(PATHS.socket):
        return 1, [
            "A relayd started by hand is already holding "
            f"{PATHS.socket}.",
            "Stop it first, otherwise the systemd copy will fail to bind:",
            "    pkill -x relayd  ||  press Ctrl-C in the terminal running it",
        ]

    notes.extend(link_commands())

    UNIT_DIR.mkdir(parents=True, exist_ok=True)
    destination = UNIT_DIR / UNIT_NAME
    shutil.copyfile(SOURCE_UNIT, destination)
    notes.append(f"Installed {destination}")

    code, out = _systemctl("daemon-reload")
    if code != 0:
        return code, notes + [f"daemon-reload failed: {out}"]

    env = manager_environment()
    if uwsm_managed(env):
        notes.append(
            "Session is managed by uwsm, which finalizes "
            "HYPRLAND_INSTANCE_SIGNATURE into systemd on every login -- no "
            "environment import needed, and nothing goes stale on reboot."
        )
    else:
        code, out = _systemctl("import-environment", *SESSION_VARS)
        if code != 0:
            notes.append(f"Could not import the session environment: {out}")
        else:
            notes.append(f"Imported {', '.join(SESSION_VARS)} from this session.")
        notes.append(
            "That import is a snapshot of *this* login. Add the same line to "
            "~/.config/hypr/hyprland.conf so it happens every time:\n"
            "    exec-once = systemctl --user import-environment "
            + " ".join(SESSION_VARS)
        )

    still_missing = missing_session_vars()
    if still_missing:
        notes.append(
            "Warning: systemd still has no value for "
            f"{', '.join(still_missing)}. Relay will start but will not be "
            "able to control windows."
        )

    if enable:
        code, out = _systemctl("enable", UNIT_NAME)
        if code != 0:
            return code, notes + [f"enable failed: {out}"]
        notes.append("Enabled: Relay will start with your graphical session.")

    if start:
        code, out = _systemctl("restart", UNIT_NAME)
        if code != 0:
            return code, notes + [f"start failed: {out}", f"Logs: {FOLLOW_LOGS}"]
        notes.append("Started.")

    notes.append(f"Follow the logs with:  {FOLLOW_LOGS}")
    return 0, notes


def uninstall() -> tuple[int, list[str]]:
    notes: list[str] = []
    destination = UNIT_DIR / UNIT_NAME

    if not destination.exists():
        return 0, ["Not installed; nothing to remove."]

    _systemctl("stop", UNIT_NAME)
    notes.append("Stopped.")
    code, out = _systemctl("disable", UNIT_NAME)
    if code != 0:
        notes.append(f"disable reported: {out}")
    destination.unlink()
    notes.append(f"Removed {destination}")
    _systemctl("daemon-reload")
    return 0, notes


def status() -> str:
    """A short human summary, safe to run when nothing is installed."""
    lines = []
    if not is_installed():
        lines.append("Service:   not installed  (relay install-service)")
    else:
        active = "running" if is_active() else "stopped"
        code, enabled = _systemctl("is-enabled", UNIT_NAME)
        state = enabled.strip() or "unknown"
        lines.append(f"Service:   installed, {active}, {state} at login")

    env = manager_environment()
    if uwsm_managed(env):
        lines.append("Session:   uwsm (environment refreshed every login)")
    else:
        missing = missing_session_vars(env)
        if missing:
            lines.append(f"Session:   missing {', '.join(missing)} in systemd")
        else:
            lines.append("Session:   environment present (imported)")

    lines.append(f"Logs:      {FOLLOW_LOGS}")
    return "\n".join(lines)

"""XDG-conformant locations for everything Relay writes to disk.

Kept in one module so nothing else has to know where things live, and so tests
can redirect the whole tree by setting RELAY_HOME.
"""

from __future__ import annotations

import os
from pathlib import Path


def _xdg(env_var: str, default: str) -> Path:
    value = os.environ.get(env_var)
    return Path(value) if value else Path.home() / default


def _runtime_base() -> Path:
    # XDG_RUNTIME_DIR is tmpfs and cleared on logout, which is what we want for
    # the socket. It is normally set under a systemd user session; fall back to
    # a per-uid /tmp path when it isn't (e.g. a bare ssh session).
    value = os.environ.get("XDG_RUNTIME_DIR")
    return Path(value) if value else Path(f"/tmp/relay-{os.getuid()}")


class Paths:
    """Resolved once at import; override the whole tree with RELAY_HOME."""

    def __init__(self, home: Path | None = None) -> None:
        override = home or (Path(os.environ["RELAY_HOME"]) if "RELAY_HOME" in os.environ else None)
        if override:
            self.config = override / "config"
            self.data = override / "data"
            self.state = override / "state"
            self.runtime = override / "runtime"
        else:
            self.config = _xdg("XDG_CONFIG_HOME", ".config") / "relay"
            self.data = _xdg("XDG_DATA_HOME", ".local/share") / "relay"
            self.state = _xdg("XDG_STATE_HOME", ".local/state") / "relay"
            self.runtime = _runtime_base() / "relay"

    # --- config files -------------------------------------------------
    @property
    def config_file(self) -> Path:
        return self.config / "config.toml"

    @property
    def style_file(self) -> Path:
        """Conversational style rules, editable by voice."""
        return self.config / "style.md"

    @property
    def permissions_file(self) -> Path:
        return self.config / "permissions.toml"

    # --- data ---------------------------------------------------------
    @property
    def db(self) -> Path:
        return self.data / "memory.db"

    @property
    def models(self) -> Path:
        return self.data / "models"

    @property
    def sessions(self) -> Path:
        return self.data / "sessions"

    # --- runtime ------------------------------------------------------
    @property
    def socket(self) -> Path:
        return self.runtime / "relay.sock"

    @property
    def log(self) -> Path:
        return self.state / "relay.log"

    def ensure(self) -> None:
        """Create every directory Relay writes to. Safe to call repeatedly."""
        for d in (self.config, self.data, self.state, self.runtime, self.models, self.sessions):
            d.mkdir(parents=True, exist_ok=True)
        # The socket directory is world-readable on some systems; the socket
        # itself is a control channel for an agent that can run shell commands,
        # so lock the directory down to the owner.
        self.runtime.chmod(0o700)


PATHS = Paths()

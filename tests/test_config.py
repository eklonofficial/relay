from relay import config
from relay.paths import Paths


def test_defaults_load_without_a_config_file(tmp_path):
    cfg = config.load(tmp_path / "does-not-exist.toml")
    assert cfg.agent.model == "claude-sonnet-5"
    assert cfg.agent.auth_mode == "subscription"
    assert cfg.mode == config.MODE_NORMAL


def test_partial_override_keeps_other_defaults(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text(
        """
        mode = "dry_run"

        [agent]
        auth_mode = "api_key"

        [usage]
        block_at_utilization = 0.5
        """
    )
    cfg = config.load(path)

    # Overridden
    assert cfg.mode == config.MODE_DRY_RUN
    assert cfg.agent.auth_mode == "api_key"
    assert cfg.usage.block_at_utilization == 0.5

    # Untouched siblings keep their defaults rather than being wiped by the
    # partial table.
    assert cfg.agent.model == "claude-sonnet-5"
    assert cfg.agent.effort == "low"
    assert cfg.usage.warn_at_utilization == 0.75


def test_unknown_keys_are_ignored_not_fatal(tmp_path):
    """A config written by a newer Relay must not stop an older one starting."""
    path = tmp_path / "config.toml"
    path.write_text(
        """
        some_future_option = true

        [agent]
        model = "claude-opus-5"
        another_future_option = "x"
        """
    )
    cfg = config.load(path)
    assert cfg.agent.model == "claude-opus-5"


def test_relay_home_redirects_the_whole_tree(tmp_path):
    paths = Paths(home=tmp_path)
    assert paths.config_file == tmp_path / "config" / "config.toml"
    assert paths.db == tmp_path / "data" / "memory.db"
    assert paths.socket == tmp_path / "runtime" / "relay.sock"


def test_ensure_creates_dirs_and_locks_down_runtime(tmp_path):
    paths = Paths(home=tmp_path)
    paths.ensure()
    assert paths.models.is_dir()
    assert paths.sessions.is_dir()
    # The socket is a control channel for an agent that can run shell commands.
    assert paths.runtime.stat().st_mode & 0o777 == 0o700

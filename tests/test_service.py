"""Installing Relay as a systemd user service.

The interesting logic is all about the session environment, which is the part
that silently breaks: a service that starts but can't reach the compositor
looks healthy in `systemctl status` and does nothing useful.
"""

import socket

import pytest

from relay import service


# --------------------------------------------------------- environment parse
def test_manager_environment_parses_show_environment(monkeypatch):
    monkeypatch.setattr(service, "_systemctl", lambda *a: (0,
        "PATH=/usr/bin\nWAYLAND_DISPLAY=wayland-1\nXDG_RUNTIME_DIR=/run/user/1000"))
    env = service.manager_environment()
    assert env["WAYLAND_DISPLAY"] == "wayland-1"
    assert env["XDG_RUNTIME_DIR"] == "/run/user/1000"


def test_values_containing_equals_are_not_truncated():
    """UWSM_FINALIZE_VARNAMES and PATH both contain '='-adjacent junk."""
    monkey = "FOO=a=b=c"
    key, _, value = monkey.partition("=")
    assert value == "a=b=c"  # documents the partition() choice over split('=')


def test_failed_systemctl_yields_no_environment(monkeypatch):
    monkeypatch.setattr(service, "_systemctl", lambda *a: (1, "Failed to connect"))
    assert service.manager_environment() == {}


# ------------------------------------------------------------------- uwsm
def test_uwsm_detected_when_it_finalizes_the_hyprland_signature():
    env = {"UWSM_FINALIZE_VARNAMES": "HYPRLAND_INSTANCE_SIGNATURE HYPRLAND_CMD"}
    assert service.uwsm_managed(env)


def test_uwsm_finalizing_other_variables_is_not_enough():
    """Only the Hyprland signature going stale actually breaks window control."""
    env = {"UWSM_FINALIZE_VARNAMES": "XCURSOR_SIZE XCURSOR_THEME"}
    assert not service.uwsm_managed(env)


def test_plain_session_is_not_uwsm_managed():
    assert not service.uwsm_managed({"WAYLAND_DISPLAY": "wayland-1"})


# --------------------------------------------------------- missing variables
def test_all_session_vars_present_reports_nothing_missing():
    env = {name: "value" for name in service.SESSION_VARS}
    assert service.missing_session_vars(env) == []


def test_empty_values_count_as_missing():
    """systemd will happily store an empty string; the service still breaks."""
    env = {name: "value" for name in service.SESSION_VARS}
    env["HYPRLAND_INSTANCE_SIGNATURE"] = ""
    assert service.missing_session_vars(env) == ["HYPRLAND_INSTANCE_SIGNATURE"]


def test_absent_variable_is_reported():
    assert "WAYLAND_DISPLAY" in service.missing_session_vars({})


# ----------------------------------------------------- foreign daemon check
def test_no_socket_file_means_no_foreign_daemon(tmp_path):
    assert not service.foreign_daemon_running(tmp_path / "absent.sock")


def test_stale_socket_file_is_not_a_running_daemon(tmp_path):
    """A leftover socket with nothing listening must not block installation."""
    path = tmp_path / "relay.sock"
    path.write_text("")
    assert not service.foreign_daemon_running(path)


def test_listening_socket_outside_systemd_blocks_installation(tmp_path, monkeypatch):
    path = tmp_path / "relay.sock"
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(path))
    server.listen(1)
    monkeypatch.setattr(service, "is_active", lambda: False)
    try:
        assert service.foreign_daemon_running(path)
    finally:
        server.close()


def test_socket_owned_by_the_systemd_unit_is_fine(tmp_path, monkeypatch):
    """Reinstalling over a running service is normal; only a hand-started
    relayd is a conflict."""
    path = tmp_path / "relay.sock"
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(str(path))
    server.listen(1)
    monkeypatch.setattr(service, "is_active", lambda: True)
    try:
        assert not service.foreign_daemon_running(path)
    finally:
        server.close()


# ------------------------------------------------------------------ install
def test_install_refuses_when_a_hand_started_daemon_holds_the_socket(monkeypatch):
    monkeypatch.setattr(service, "foreign_daemon_running", lambda path: True)
    code, notes = service.install()
    assert code == 1
    assert any("holding" in note for note in notes)


def test_install_skips_the_environment_import_under_uwsm(tmp_path, monkeypatch):
    calls = []

    def fake_systemctl(*args):
        calls.append(args)
        if args[0] == "show-environment":
            return 0, "UWSM_FINALIZE_VARNAMES=HYPRLAND_INSTANCE_SIGNATURE\n" + "\n".join(
                f"{name}=x" for name in service.SESSION_VARS)
        return 0, ""

    monkeypatch.setattr(service, "_systemctl", fake_systemctl)
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    monkeypatch.setattr(service, "foreign_daemon_running", lambda path: False)

    code, notes = service.install()

    assert code == 0
    assert not any(args[0] == "import-environment" for args in calls)
    assert (tmp_path / service.UNIT_NAME).exists()
    assert any("uwsm" in note for note in notes)


def test_install_imports_the_environment_without_uwsm(tmp_path, monkeypatch):
    calls = []

    def fake_systemctl(*args):
        calls.append(args)
        if args[0] == "show-environment":
            return 0, "\n".join(f"{name}=x" for name in service.SESSION_VARS)
        return 0, ""

    monkeypatch.setattr(service, "_systemctl", fake_systemctl)
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    monkeypatch.setattr(service, "foreign_daemon_running", lambda path: False)

    code, notes = service.install()

    assert code == 0
    imported = [args for args in calls if args[0] == "import-environment"]
    assert imported and set(imported[0][1:]) == set(service.SESSION_VARS)
    # Must tell the user how to make it survive a reboot.
    assert any("hyprland.conf" in note for note in notes)


def test_install_warns_when_the_compositor_variables_never_arrive(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "_systemctl",
                        lambda *a: (0, "") if a[0] != "show-environment" else (0, ""))
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    monkeypatch.setattr(service, "foreign_daemon_running", lambda path: False)

    code, notes = service.install()

    assert code == 0, "a missing variable is a warning, not a failure"
    assert any("not be able to control windows" in note for note in notes)


def test_install_reports_a_failed_enable(tmp_path, monkeypatch):
    def fake_systemctl(*args):
        if args[0] == "enable":
            return 1, "Failed to enable unit"
        return 0, ""

    monkeypatch.setattr(service, "_systemctl", fake_systemctl)
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    monkeypatch.setattr(service, "foreign_daemon_running", lambda path: False)

    code, notes = service.install()
    assert code == 1
    assert any("enable failed" in note for note in notes)


def test_a_failed_start_points_at_the_logs(tmp_path, monkeypatch):
    def fake_systemctl(*args):
        if args[0] == "restart":
            return 1, "Job failed"
        return 0, ""

    monkeypatch.setattr(service, "_systemctl", fake_systemctl)
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    monkeypatch.setattr(service, "foreign_daemon_running", lambda path: False)

    code, notes = service.install()
    assert code == 1
    assert any("journalctl" in note for note in notes)


# ---------------------------------------------------------------- uninstall
def test_uninstalling_something_absent_is_not_an_error(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    code, notes = service.uninstall()
    assert code == 0
    assert "nothing to remove" in notes[0]


def test_uninstall_stops_disables_and_removes(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(service, "_systemctl",
                        lambda *a: (calls.append(a), (0, ""))[1])
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    (tmp_path / service.UNIT_NAME).write_text("[Unit]\n")

    code, _ = service.uninstall()

    assert code == 0
    assert not (tmp_path / service.UNIT_NAME).exists()
    verbs = [args[0] for args in calls]
    assert verbs.index("stop") < verbs.index("disable")


# ------------------------------------------------------------------- status
def test_status_when_not_installed_says_how_to_install(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    monkeypatch.setattr(service, "_systemctl", lambda *a: (0, ""))
    assert "relay install-service" in service.status()


def test_status_reports_running_and_enabled(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "UNIT_DIR", tmp_path)
    (tmp_path / service.UNIT_NAME).write_text("[Unit]\n")

    def fake_systemctl(*args):
        if args[0] == "is-active":
            return 0, ""
        if args[0] == "is-enabled":
            return 0, "enabled"
        if args[0] == "show-environment":
            return 0, "UWSM_FINALIZE_VARNAMES=HYPRLAND_INSTANCE_SIGNATURE"
        return 0, ""

    monkeypatch.setattr(service, "_systemctl", fake_systemctl)
    text = service.status()
    assert "running" in text and "enabled" in text and "uwsm" in text


# --------------------------------------------------------------- unit file
def test_the_shipped_unit_file_is_valid_enough_to_install():
    """Regression: StartLimitIntervalSec sat in [Service], where systemd
    ignores it ("Unknown key ... ignoring"), so the crash-loop guard that was
    supposed to stop a broken Relay restarting forever did nothing."""
    # Comments mention section names, so strip them before splitting.
    lines = [line for line in service.SOURCE_UNIT.read_text().splitlines()
             if not line.lstrip().startswith("#")]
    unit_section = "\n".join(lines).split("[Service]")[0]
    for key in ("StartLimitIntervalSec", "StartLimitBurst"):
        assert key in unit_section, f"{key} must be in [Unit], not [Service]"


def test_the_unit_binds_to_the_graphical_session():
    """Relay needs the compositor; starting at boot would be useless."""
    text = service.SOURCE_UNIT.read_text()
    assert "WantedBy=graphical-session.target" in text
    assert "PartOf=graphical-session.target" in text

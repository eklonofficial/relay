"""Seeing the screen.

The capture itself is a call to `grim`, so the part worth testing is the one
with judgement in it: how much the image is shrunk before it costs allowance.

Mapping a coordinate back onto the real screen belongs with the code that
moves the cursor, so it arrives with cursor control rather than sitting here
tested and unreachable.
"""

import base64

import pytest

from relay.permissions import Tier, classify, is_read_only
from relay.tools import screen


# ------------------------------------------------------------------ scaling
def test_an_ultrawide_screen_is_shrunk():
    """3440x1440 sent whole is ~4,800 tokens a look, and Claude's vision
    resizes it anyway -- so the extra pixels cost allowance and buy nothing."""
    assert screen._scale_for((3440, 1440), 1600) == pytest.approx(1600 / 3440)


def test_a_small_screen_is_never_blown_up():
    assert screen._scale_for((1280, 720), 1600) == 1.0


def test_a_screen_exactly_at_the_limit_is_left_alone():
    assert screen._scale_for((1600, 900), 1600) == 1.0


def test_the_long_edge_decides_even_when_it_is_the_height():
    assert screen._scale_for((900, 2000), 1000) == pytest.approx(0.5)


def test_a_nonsense_size_does_not_divide_by_zero():
    assert screen._scale_for((0, 0), 1600) == 1.0


def test_the_default_is_well_under_the_vision_limit():
    """The cap is what the model would resize to anyway; the default is
    smaller still, because a quarter of the tokens still reads window titles
    and menu items."""
    assert screen.DEFAULT_MAX_EDGE < screen.MAX_EDGE


# ------------------------------------------------------------------- capture
async def test_a_missing_grim_is_reported_not_raised(monkeypatch):
    monkeypatch.setattr(screen.shutil, "which", lambda name: None)
    path, _scale, err = await screen.capture()
    assert path is None and "grim" in err


async def test_an_unknown_target_is_refused(monkeypatch):
    monkeypatch.setattr(screen.shutil, "which", lambda name: "/usr/bin/grim")
    path, _scale, err = await screen.capture("the-third-monitor")
    assert path is None and "unknown target" in err


async def test_a_cancelled_region_selection_is_not_an_error(monkeypatch, tmp_path):
    """slurp exits non-zero when you press Escape. That's a change of mind,
    not a failure."""
    monkeypatch.setattr(screen.shutil, "which", lambda name: f"/usr/bin/{name}")

    async def fake_run(*argv, timeout=15.0):
        if argv[0] == "slurp":
            return 1, "", ""
        return 0, "", ""

    monkeypatch.setattr(screen, "run", fake_run)
    path, _scale, err = await screen.capture("region")
    assert path is None and "no region" in err


async def test_capturing_a_window_asks_hyprland_for_its_geometry(monkeypatch, tmp_path):
    seen = {}

    async def fake_run(*argv, timeout=15.0):
        if argv[0] == "hyprctl" and "activewindow" in argv:
            return 0, '{"at":[100,200],"size":[800,600]}', ""
        if argv[0] == "hyprctl":
            return 0, '[{"focused":true,"width":3440,"height":1440}]', ""
        if argv[0] == "grim":
            seen["argv"] = argv
            (tmp_path / "shot.png").write_bytes(b"x")
            return 0, "", ""
        return 0, "", ""

    monkeypatch.setattr(screen.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(screen, "run", fake_run)

    path, _scale, err = await screen.capture(
        "window", destination=tmp_path / "shot.png")

    assert path is not None, err
    assert "-g" in seen["argv"]
    assert "100,200 800x600" in seen["argv"]


async def test_capturing_with_nothing_focused_says_so(monkeypatch):
    async def fake_run(*argv, timeout=15.0):
        if "activewindow" in argv:
            return 0, "{}", ""
        return 0, "", ""

    monkeypatch.setattr(screen.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(screen, "run", fake_run)
    path, _scale, err = await screen.capture("window")
    assert path is None and "no window is focused" in err


async def test_scaling_is_done_during_capture_not_after(monkeypatch, tmp_path):
    """grim shrinks the buffer while it's still in memory, which skips a
    decode and re-encode."""
    seen = {}

    async def fake_run(*argv, timeout=15.0):
        if argv[0] == "grim":
            seen["argv"] = argv
            (tmp_path / "shot.png").write_bytes(b"x")
            return 0, "", ""
        return 0, '[{"focused":true,"width":3440,"height":1440}]', ""

    monkeypatch.setattr(screen.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(screen, "run", fake_run)

    await screen.capture("screen", destination=tmp_path / "shot.png")

    assert "-s" in seen["argv"], "grim should have been asked to scale"


# --------------------------------------------------------------------- tools
async def test_read_screen_returns_an_image_the_model_can_see(monkeypatch, tmp_path):
    shot = tmp_path / "shot.png"
    shot.write_bytes(b"\x89PNG\r\n\x1a\n fake")

    async def fake_capture(target="screen", *, max_edge=0, destination=None):
        return shot, 0.5, ""

    monkeypatch.setattr(screen, "capture", fake_capture)
    result = await screen.read_screen.handler({"target": "screen"})

    image = result["content"][0]
    assert image["type"] == "image"
    assert image["mimeType"] == "image/png"
    assert base64.standard_b64decode(image["data"]) == shot.read_bytes()


async def test_read_screen_reports_a_failure_rather_than_an_empty_image(monkeypatch):
    async def fake_capture(target="screen", *, max_edge=0, destination=None):
        return None, 1.0, "grim isn't installed"

    monkeypatch.setattr(screen, "capture", fake_capture)
    result = await screen.read_screen.handler({})
    assert result.get("is_error")


async def test_saving_a_screenshot_keeps_the_full_detail(monkeypatch, tmp_path):
    """Nothing is sent anywhere, so there is no allowance to save by
    shrinking it -- and a saved screenshot is usually wanted at full size."""
    seen = {}

    async def fake_capture(target="screen", *, max_edge=0, destination=None):
        seen["max_edge"] = max_edge
        (tmp_path / "s.png").write_bytes(b"x")
        return tmp_path / "s.png", 1.0, ""

    monkeypatch.setattr(screen, "capture", fake_capture)
    await screen.take_screenshot.handler({"target": "screen"})

    assert seen["max_edge"] == screen.MAX_EDGE


async def test_saving_somewhere_specific_works(monkeypatch, tmp_path):
    seen = {}

    async def fake_capture(target="screen", *, max_edge=0, destination=None):
        seen["destination"] = destination
        destination.write_bytes(b"x")
        return destination, 1.0, ""

    monkeypatch.setattr(screen, "capture", fake_capture)
    target = tmp_path / "nested" / "out.png"
    result = await screen.take_screenshot.handler({"path": str(target)})

    assert seen["destination"] == target
    assert not result.get("is_error")


# --------------------------------------------------------------- permissions
@pytest.mark.parametrize("name", ["take_screenshot", "read_screen"])
def test_looking_at_the_screen_does_not_need_confirmation(name):
    tier, _ = classify(f"mcp__screen__{name}", {})
    assert tier is Tier.AUTO


@pytest.mark.parametrize("name", ["take_screenshot", "read_screen"])
def test_looking_still_works_during_a_dry_run(name):
    """A preview of "what's on my screen" that refuses to look is useless."""
    assert is_read_only(f"mcp__screen__{name}")

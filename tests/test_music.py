"""Music control through Cider.

Everything here runs against a stubbed API rather than the live app, so the
tests pass whether or not Cider is installed, running, or logged in.
"""

import asyncio

import pytest

from relay import config as config_mod
from relay import settings as settings_mod
from relay.permissions import Tier, classify, is_read_only
from relay.tools import cider as cider_mod


# ------------------------------------------------------------------- stubs
class StubResponse:
    def __init__(self, status_code=200, payload=None, content=b"{}"):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.content = content

    def json(self):
        return self._payload


class StubHttp:
    """Stands in for httpx.AsyncClient, recording what was sent."""

    def __init__(self, responder):
        self.responder = responder
        self.calls = []

    def __call__(self, **kwargs):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def request(self, method, url, headers=None, json=None):
        self.calls.append({"method": method, "url": url,
                           "headers": headers or {}, "json": json})
        return self.responder(method, url, headers or {}, json)


def install(monkeypatch, responder):
    """Point the client's lazily-imported httpx at a stub."""
    import httpx

    stub = StubHttp(responder)
    monkeypatch.setattr(httpx, "AsyncClient", stub)
    return stub


def _client(token="secret-token"):
    return cider_mod.CiderClient("http://localhost:10767", token)


# ------------------------------------------------------------------- auth
async def test_the_token_is_sent_as_apptoken(monkeypatch):
    stub = install(monkeypatch, lambda *a: StubResponse(200, {"is_playing": True}))
    assert await _client().is_playing() is True
    assert stub.calls[0]["headers"]["apptoken"] == "secret-token"


async def test_the_token_never_gets_a_bearer_prefix(monkeypatch):
    stub = install(monkeypatch, lambda *a: StubResponse(200, {"is_playing": False}))
    await _client().is_playing()
    assert stub.calls[0]["headers"]["apptoken"] == "secret-token"


async def test_a_401_retries_with_the_other_header_name(monkeypatch):
    """Cider's docs say `apptoken`; the published Rust client says `apitoken`.
    Rather than betting on either, the first rejection tries the other."""
    def responder(method, url, headers, json):
        if "apptoken" in headers:
            return StubResponse(401)
        return StubResponse(200, {"is_playing": True})

    stub = install(monkeypatch, responder)
    assert await _client().is_playing() is True
    assert [c["headers"] for c in stub.calls][1].get("apitoken") == "secret-token"


async def test_the_working_header_is_remembered(monkeypatch):
    def responder(method, url, headers, json):
        if "apptoken" in headers:
            return StubResponse(401)
        return StubResponse(200, {"is_playing": True})

    stub = install(monkeypatch, responder)
    api = _client()
    await api.is_playing()
    await api.is_playing()
    # Two calls for the first (rejected, then retried), one for the second.
    assert len(stub.calls) == 3


async def test_both_names_rejected_explains_how_to_fix_it(monkeypatch):
    install(monkeypatch, lambda *a: StubResponse(403))
    with pytest.raises(cider_mod.CiderError, match="Settings -> Connectivity"):
        await _client().is_playing()


async def test_a_bodyless_post_does_not_claim_to_send_json(monkeypatch):
    """Regression, found only against the live app.

    Cider runs Fastify, which rejects a request declaring
    application/json with no body:

        400 FST_ERR_CTP_EMPTY_JSON_BODY
        "Body cannot be empty when content-type is set to 'application/json'"

    Every argument-free command -- play, pause, next, previous -- is a
    bodyless POST, so sending the header unconditionally broke most of the
    API while leaving every GET endpoint working, which made it look like
    a permissions problem rather than a header one.
    """
    stub = install(monkeypatch, lambda *a: StubResponse(200))
    await _client().pause()
    assert "Content-Type" not in stub.calls[0]["headers"]


async def test_a_post_with_a_body_still_declares_json(monkeypatch):
    stub = install(monkeypatch, lambda *a: StubResponse(200))
    await _client().set_volume(0.5)
    assert stub.calls[0]["headers"]["Content-Type"] == "application/json"


async def test_the_token_is_still_sent_on_bodyless_posts(monkeypatch):
    stub = install(monkeypatch, lambda *a: StubResponse(200))
    await _client().next_track()
    assert stub.calls[0]["headers"]["apptoken"] == "secret-token"


async def test_no_token_sends_no_auth_header(monkeypatch):
    stub = install(monkeypatch, lambda *a: StubResponse(200, {"is_playing": False}))
    await _client(token="").is_playing()
    assert "apptoken" not in stub.calls[0]["headers"]


# -------------------------------------------------------------- liveness
async def test_an_unreachable_cider_is_not_up(monkeypatch):
    def boom(*a):
        raise OSError("connection refused")

    install(monkeypatch, boom)
    assert await _client().is_up() is False


async def test_is_up_does_not_raise_on_a_bad_token(monkeypatch):
    """The probe runs before every command; it must answer, not explode."""
    install(monkeypatch, lambda *a: StubResponse(401))
    assert await _client().is_up() is False


async def test_wait_until_up_gives_up_at_the_timeout(monkeypatch):
    def boom(*a):
        raise OSError("not yet")

    install(monkeypatch, boom)
    started = asyncio.get_running_loop().time()
    ready = await _client().wait_until_up(0.3, interval_s=0.05)
    assert ready is False
    assert asyncio.get_running_loop().time() - started < 2.0


async def test_wait_until_up_returns_as_soon_as_it_answers(monkeypatch):
    install(monkeypatch, lambda *a: StubResponse(200, {"is_playing": False}))
    assert await _client().wait_until_up(5.0, interval_s=0.05) is True


# -------------------------------------------------------------- playback
async def test_volume_is_clamped_to_the_api_range(monkeypatch):
    """People say "volume 200"; the API takes 0-1 and misbehaves outside it."""
    stub = install(monkeypatch, lambda *a: StubResponse(200))
    api = _client()
    await api.set_volume(3.5)
    await api.set_volume(-1.0)
    assert stub.calls[0]["json"] == {"volume": 1.0}
    assert stub.calls[1]["json"] == {"volume": 0.0}


async def test_play_item_sends_the_id_as_a_string(monkeypatch):
    """Cider silently ignores numeric ids."""
    stub = install(monkeypatch, lambda *a: StubResponse(200))
    await _client().play_item("songs", 12345)
    assert stub.calls[0]["json"] == {"type": "songs", "id": "12345"}


async def test_a_204_with_no_body_is_not_an_error(monkeypatch):
    install(monkeypatch, lambda *a: StubResponse(204, content=b""))
    assert await _client().seek(30) is None


async def test_now_playing_unwraps_the_info_envelope(monkeypatch):
    install(monkeypatch, lambda *a: StubResponse(
        200, {"status": "ok", "info": {"name": "Weird Fishes",
                                       "artistName": "Radiohead"}}))
    info = await _client().now_playing()
    assert info["name"] == "Weird Fishes"


async def test_a_server_error_is_reported_not_swallowed(monkeypatch):
    install(monkeypatch, lambda *a: StubResponse(500))
    with pytest.raises(cider_mod.CiderError, match="500"):
        await _client().play()


# ---------------------------------------------------------------- search
async def test_search_unwraps_the_musickit_envelope(monkeypatch):
    payload = {"data": {"results": {"songs": {"data": [
        {"id": "1", "type": "songs", "attributes": {"name": "Nude"}}
    ]}}}}
    install(monkeypatch, lambda *a: StubResponse(200, payload))
    results = await _client().search("nude")
    assert results[0]["attributes"]["name"] == "Nude"


async def test_search_terms_are_url_encoded(monkeypatch):
    """Otherwise "Weird Fishes/Arpeggi" breaks the path."""
    stub = install(monkeypatch, lambda *a: StubResponse(200, {}))
    await _client().search("Weird Fishes/Arpeggi")
    path = stub.calls[0]["json"]["path"]
    assert " " not in path and "%2F" in path


async def test_empty_search_results_do_not_crash(monkeypatch):
    install(monkeypatch, lambda *a: StubResponse(200, {"data": {"results": {}}}))
    assert await _client().search("nonsense that matches nothing") == []


# ---------------------------------------------------------------- MPRIS
@pytest.fixture(autouse=True)
def _clear_player_cache():
    cider_mod._player_cache = None
    yield
    cider_mod._player_cache = None


def fake_shell(monkeypatch, handler):
    """Replace the subprocess helper the MPRIS code runs commands through."""
    calls = []

    async def run(*argv, timeout=15.0):
        calls.append(argv)
        return handler(argv)

    monkeypatch.setattr(cider_mod, "run", run)
    monkeypatch.setattr(cider_mod.shutil, "which", lambda name: f"/usr/bin/{name}")
    return calls


async def test_cider_is_found_by_its_dbus_identity(monkeypatch):
    """Regression: the fallback never worked.

    Cider is an Electron app that doesn't set an MPRIS name, so it registers
    as `chromium.instance<pid>` -- indistinguishable from a real Chromium
    browser and different on every restart. Asking playerctl for "cider"
    found nothing, so the fallback looked implemented but silently did
    nothing. The D-Bus `Identity` property does say "Cider".
    """
    def handler(argv):
        if argv[:2] == ("playerctl", "-l"):
            return 0, "chromium.instance999\nfirefox\n", ""
        if argv[0] == "busctl" and "chromium.instance999" in argv[3]:
            return 0, 's "Cider"\n', ""
        return 0, 's "Mozilla Firefox"\n', ""

    fake_shell(monkeypatch, handler)
    assert await cider_mod.find_player() == "chromium.instance999"


async def test_a_sanely_named_player_is_preferred_without_a_dbus_lookup(monkeypatch):
    """If Cider ever fixes its bus name, take it directly."""
    def handler(argv):
        if argv[:2] == ("playerctl", "-l"):
            return 0, "cider\n", ""
        raise AssertionError("should not need to ask D-Bus")

    fake_shell(monkeypatch, handler)
    assert await cider_mod.find_player() == "cider"


async def test_no_cider_on_the_bus_is_reported_not_guessed(monkeypatch):
    def handler(argv):
        if argv[:2] == ("playerctl", "-l"):
            return 0, "firefox\nspotify\n", ""
        return 0, 's "Mozilla Firefox"\n', ""

    fake_shell(monkeypatch, handler)
    assert await cider_mod.find_player() is None

    good, message = await cider_mod.playerctl("pause")
    assert not good and "MPRIS" in message


async def test_a_stale_player_name_is_retried_once(monkeypatch):
    """The bus name embeds a pid, so restarting Cider invalidates the cache."""
    cider_mod._player_cache = "chromium.instance111"   # the old pid
    attempts = []

    def handler(argv):
        if argv[:2] == ("playerctl", "-l"):
            return 0, "chromium.instance222\n", ""
        if argv[0] == "busctl":
            return 0, 's "Cider"\n', ""
        attempts.append(argv[2])
        return (1, "", "No player could handle this command") \
            if argv[2] == "chromium.instance111" else (0, "Playing", "")

    fake_shell(monkeypatch, handler)
    good, _ = await cider_mod.playerctl("status")

    assert good, "a restarted Cider should be found again, not give up"
    assert attempts == ["chromium.instance111", "chromium.instance222"]


async def test_missing_playerctl_is_not_an_exception(monkeypatch):
    monkeypatch.setattr(cider_mod.shutil, "which", lambda name: None)
    good, message = await cider_mod.playerctl("pause")
    assert not good and "playerctl" in message


# -------------------------------------------------------------- describing
def test_a_track_is_described_the_way_you_would_say_it():
    assert cider_mod.describe_track(
        {"name": "Nude", "artistName": "Radiohead"}) == "Nude by Radiohead."


def test_a_track_with_no_artist_still_reads_cleanly():
    assert cider_mod.describe_track({"name": "Nude"}) == "Nude."


def test_nothing_playing_is_stated_plainly():
    assert cider_mod.describe_track({}) == "Nothing is playing."


# ------------------------------------------------------------ permissions
@pytest.mark.parametrize("name", [
    "music_play", "music_pause", "music_next", "music_previous",
    "music_now_playing", "music_volume", "music_seek", "music_shuffle",
    "music_repeat", "music_queue",
])
def test_music_tools_run_without_confirmation(name):
    """Unlisted tools default to ASK, which would silently disable the fast
    path -- FastPath._act refuses anything that isn't AUTO."""
    tier, _ = classify(f"mcp__music__{name}", {})
    assert tier is Tier.AUTO, f"{name} would need confirmation"


def test_asking_what_is_playing_still_works_during_a_dry_run():
    assert is_read_only("mcp__music__music_now_playing")
    assert is_read_only("mcp__music__music_queue")


def test_changing_playback_is_not_treated_as_read_only():
    assert not is_read_only("mcp__music__music_play")
    assert not is_read_only("mcp__music__music_pause")


# --------------------------------------------------------------- settings
def test_the_token_is_masked_in_the_settings_panel():
    # A made-up token, obviously. A test that pastes in the real one defeats
    # the very thing it's checking, and puts the secret in version control
    # where masking it in the UI no longer helps.
    field = next(f for f in settings_mod.FIELDS if f.path == "music.cider_token")
    shown = settings_mod.display(field, "abcdefghijklmnopqrst1234")
    assert "abcdefghijklmnopqrst" not in shown
    assert shown.endswith("1234"), "enough tail to confirm which token it is"


def test_an_unset_token_says_so_rather_than_showing_dots():
    field = next(f for f in settings_mod.FIELDS if f.path == "music.cider_token")
    assert settings_mod.display(field, "") == "(not set)"


def test_music_settings_all_point_at_real_config_fields():
    cfg = config_mod.Config()
    for field in settings_mod.FIELDS:
        if field.path.startswith("music."):
            settings_mod.get_value(cfg, field.path)


def test_the_token_round_trips_through_the_config_file(tmp_path):
    path = tmp_path / "config.toml"
    cfg = config_mod.Config()
    cfg.music.cider_token = "abc123"
    settings_mod.save(cfg, path)
    assert config_mod.load(path).music.cider_token == "abc123"

import pytest

from relay.agent.client import AUTH_API_KEY, AUTH_SUBSCRIPTION, configure_auth


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_CODE_OAUTH_TOKEN", raising=False)


def test_subscription_mode_removes_a_stray_api_key(monkeypatch):
    """The critical case.

    The SDK builds its subprocess env as {**os.environ, **options.env}, so
    options.env cannot *unset* a variable. A leftover ANTHROPIC_API_KEY would
    therefore silently outrank the subscription and bill per-token, with no
    visible difference in behaviour. It has to be removed from this process.
    """
    import os

    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-leftover")
    configure_auth(AUTH_SUBSCRIPTION)
    assert "ANTHROPIC_API_KEY" not in os.environ


def test_subscription_mode_keeps_the_oauth_token(monkeypatch):
    """CLAUDE_CODE_OAUTH_TOKEN is the non-interactive form of the same
    subscription credential, so it must survive."""
    import os

    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "oat-123")
    description = configure_auth(AUTH_SUBSCRIPTION)
    assert os.environ["CLAUDE_CODE_OAUTH_TOKEN"] == "oat-123"
    assert "oauth_token" in description


def test_subscription_without_token_reports_cli_login():
    assert configure_auth(AUTH_SUBSCRIPTION) == "subscription(cli_login)"


def test_paid_api_is_refused_without_explicit_opt_in(monkeypatch):
    """Relay must never bill outside the subscription by accident.

    Selecting api_key mode is not enough on its own — a second, deliberate
    opt-in is required, so a stray edit or a copied config can't start
    charging per token.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real")
    with pytest.raises(RuntimeError, match="allow_paid_api"):
        configure_auth(AUTH_API_KEY)


def test_paid_api_works_only_with_both_the_mode_and_the_opt_in(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real")
    assert configure_auth(AUTH_API_KEY, allow_paid_api=True) == "api_key(paid)"


def test_opt_in_alone_does_not_enable_paid_api(monkeypatch):
    """allow_paid_api is a permission, not a switch. Subscription stays in use."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real")
    import os

    assert configure_auth(AUTH_SUBSCRIPTION, allow_paid_api=True).startswith("subscription")
    assert "ANTHROPIC_API_KEY" not in os.environ


def test_missing_subscription_fails_loudly_instead_of_falling_back(monkeypatch, tmp_path):
    """The behaviour the user asked for: fail safe, never silently switch."""
    from relay.agent.client import SubscriptionUnavailable

    monkeypatch.setattr("relay.agent.client.Path.home", lambda: tmp_path)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real")

    with pytest.raises(SubscriptionUnavailable, match="will not fall back"):
        configure_auth(AUTH_SUBSCRIPTION)


def test_unknown_auth_mode_is_rejected():
    with pytest.raises(ValueError, match="unknown auth_mode"):
        configure_auth("magic")

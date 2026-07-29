"""`relay docs`.

The formatting bug this covers made the guide unreadable: every ANSI escape
was printed literally, so a page of prose came out as thousands of
`ESC[38;2;248;248;242m` sequences. The cause was the pager, not the renderer.
"""

import subprocess

import pytest

from relay import docs


# ------------------------------------------------------------------ topics
def test_the_guide_is_always_available():
    assert "guide" in docs.available()


def test_listing_topics_mentions_how_to_jump_to_a_section():
    assert "--section" in docs.list_topics()


def test_an_unknown_topic_is_rejected(capsys):
    assert docs.show("does-not-exist") == 1
    assert "No such topic" in capsys.readouterr().out


# ---------------------------------------------------------------- sections
def test_a_section_can_be_pulled_out_by_name():
    text = (docs.DOCS_DIR / "guide.md").read_text()
    extracted = docs._extract(text, "troubleshooting")
    assert extracted and extracted.lstrip().startswith("#")


def test_extracting_stops_at_the_next_heading_of_the_same_level():
    text = "# One\nalpha\n\n# Two\nbeta\n"
    assert docs._extract(text, "one") == "# One\nalpha\n"


def test_extracting_keeps_nested_subsections():
    text = "## Big\nalpha\n\n### Small\nbeta\n\n## Next\ngamma\n"
    out = docs._extract(text, "big")
    assert "Small" in out and "gamma" not in out


def test_a_missing_section_is_reported(capsys):
    assert docs.show("guide", section="no such heading") == 1
    assert "No section matching" in capsys.readouterr().out


# --------------------------------------------------------------- rendering
def test_rendering_produces_real_escape_bytes_not_literal_text():
    """The bug: `ESC[38;2;248;248;242m` printed as visible characters.

    Those were always real escape bytes -- the renderer was fine. What broke
    was the pager showing them instead of acting on them. This asserts the
    renderer's half of the contract.
    """
    rendered = docs._render("# Heading\n\nSome **bold** text.\n")
    assert "\x1b[" in rendered, "styling should be present"
    assert "ESC[" not in rendered, "escapes must not be literal text"


def test_rendering_survives_rich_being_absent(monkeypatch):
    import builtins

    real_import = builtins.__import__

    def no_rich(name, *args, **kwargs):
        if name.startswith("rich"):
            raise ImportError("no rich")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", no_rich)
    assert docs._render("# Heading\n") == "# Heading\n"


def test_lines_are_not_rendered_full_width_on_an_ultrawide_monitor(monkeypatch):
    """3440px of prose on one line is unreadable."""
    monkeypatch.setattr(docs.shutil, "get_terminal_size",
                        lambda fallback=(100, 24): type("S", (), {"columns": 400})())
    rendered = docs._render("word " * 200)
    longest = max(len(line) for line in rendered.splitlines())
    assert longest <= 120, f"lines ran to {longest} columns"


# ------------------------------------------------------------------ paging
def _argv(monkeypatch, captured):
    def fake_run(argv, **kwargs):
        captured.append(argv)
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(docs.subprocess, "run", fake_run)


def test_less_is_always_told_to_pass_colour_through(monkeypatch):
    """Regression. `rich`'s own pager writes escapes into `less` *without*
    `-R`, which prints every one of them literally."""
    monkeypatch.delenv("PAGER", raising=False)
    monkeypatch.setattr(docs.shutil, "which", lambda name: "/usr/bin/less")
    captured = []
    _argv(monkeypatch, captured)

    docs._page("\x1b[1mhello\x1b[0m")

    assert any("R" in flag for flag in captured[0][1:]), captured[0]


def test_a_users_bare_less_is_repaired_rather_than_replaced(monkeypatch):
    monkeypatch.setenv("PAGER", "less")
    captured = []
    _argv(monkeypatch, captured)

    docs._page("x")

    assert captured[0][0] == "less"
    assert "-R" in captured[0]


def test_a_users_less_flags_are_respected(monkeypatch):
    monkeypatch.setenv("PAGER", "less -RS")
    captured = []
    _argv(monkeypatch, captured)

    docs._page("x")

    assert captured[0] == ["less", "-RS"], "shouldn't append a redundant -R"


def test_a_non_less_pager_is_left_alone(monkeypatch):
    """`bat` and `moar` handle colour themselves and reject less's flags."""
    monkeypatch.setenv("PAGER", "bat")
    captured = []
    _argv(monkeypatch, captured)

    docs._page("x")

    assert captured[0] == ["bat"]


def test_no_pager_at_all_still_prints_the_docs(monkeypatch, capsys):
    monkeypatch.delenv("PAGER", raising=False)
    monkeypatch.setattr(docs.shutil, "which", lambda name: None)

    assert docs._page("the documentation") == 0
    assert "the documentation" in capsys.readouterr().out


def test_a_pager_that_will_not_start_falls_back_to_printing(monkeypatch, capsys):
    monkeypatch.setenv("PAGER", "definitely-not-installed")

    def explode(argv, **kwargs):
        raise OSError("no such file")

    monkeypatch.setattr(docs.subprocess, "run", explode)

    assert docs._page("the documentation") == 0
    assert "the documentation" in capsys.readouterr().out


# ------------------------------------------------------------------- plain
def test_plain_mode_emits_markdown_with_no_escapes(capsys):
    docs.show("guide", section="Music", plain=True)
    out = capsys.readouterr().out
    assert "\x1b[" not in out
    assert "Music" in out


def test_output_to_a_pipe_is_never_styled(monkeypatch, capsys):
    """`relay docs | grep` and copy-paste into a bug report both need this."""
    monkeypatch.setattr(docs.sys.stdout, "isatty", lambda: False)
    docs.show("guide", section="Music")
    assert "\x1b[" not in capsys.readouterr().out

"""Configuration: typed defaults, overlaid with ~/.config/relay/config.toml.

Defaults are chosen so Relay runs on this machine with no config file at all.
Anything the user edits wins; anything they omit falls back here.
"""

from __future__ import annotations

import tomllib
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from pathlib import Path
from typing import Any

from relay.paths import PATHS

# Modes on the execution axis.
MODE_NORMAL = "normal"
MODE_DRY_RUN = "dry_run"


@dataclass
class AgentConfig:
    model: str = "claude-sonnet-5"

    # Relay runs on the user's Claude subscription and must never incur
    # separate API charges. "api_key" exists only as a deliberate, explicit
    # choice — it is NOT a fallback, and Relay will not switch to it on its
    # own under any circumstance. If subscription access stops working, Relay
    # fails loudly and says so.
    auth_mode: str = "subscription"

    # Second lock on the above. Selecting auth_mode = "api_key" without also
    # setting this to true is refused, so a stray edit or a copied config can
    # never quietly start billing per token.
    allow_paid_api: bool = False

    # Voice replies want speed over depth. Raise for heavy agentic work.
    effort: str = "low"
    max_turns: int = 30
    # Hard per-session spend guard, honoured by the SDK itself.
    max_budget_usd: float | None = None


@dataclass
class UsageConfig:
    """Guardrails so an always-on assistant can't starve interactive Claude Code.

    Agent SDK usage draws from the same subscription pool as the CLI, so these
    thresholds read the live rate-limit telemetry the SDK reports rather than
    guessing from token counts.
    """

    # Fractions of the subscription window, from RateLimitInfo.utilization.
    warn_at_utilization: float = 0.75
    block_at_utilization: float = 0.92
    # Belt-and-braces local ceiling in case telemetry is unavailable.
    daily_token_ceiling: int = 3_000_000
    # Spoken warning when crossing warn_at_utilization.
    announce_warnings: bool = True

    # Rate-limit telemetry only arrives when the status changes, so a
    # stored reading goes stale while the window keeps moving. Anything
    # older than this is ignored rather than acted on: blocking on a
    # two-hour-old "98% used" long after it fell back to 70% makes Relay
    # refuse to work for no reason.
    telemetry_max_age_s: float = 900.0

    # Every turn resends the whole conversation, so an assistant left running
    # all day would carry hours of unrelated history into a request about the
    # weather. After this long without a turn, Relay starts a fresh session.
    # 0 disables. This is the documented main cause of usage climbing in long
    # sessions, so it matters more here than in an interactive tool.
    session_idle_minutes: float = 20.0
    # Hard ceiling on turns in one session, regardless of idle time.
    session_max_turns: int = 40


@dataclass
class MemoryConfig:
    embed_model: str = "BAAI/bge-small-en-v1.5"
    embed_dim: int = 384
    # Candidates pulled from each retrieval arm before fusion.
    fts_candidates: int = 40
    vec_candidates: int = 40
    rrf_k: int = 60
    # Below this, an inferred candidate stays in `observations` and is never
    # treated as fact.
    promotion_threshold: int = 60
    recency_half_life_days: float = 90.0
    recency_floor: float = 0.3
    # Off by default: retrieval is a decision the model makes. This only ever
    # fires on an unambiguous known-project mention.
    prefetch_pinned_on_project_mention: bool = False


@dataclass
class AudioConfig:
    # Measured on this machine; `relay devices` lists alternatives.
    input_device: str = "alsa_input.usb-3142_fifine_Microphone-00.analog-stereo"
    sample_rate: int = 16000
    frame_ms: int = 80
    wake_word: str = "hey_jarvis"  # stock model until a custom "Relay" is trained
    wake_threshold: float = 0.6
    # How far back to reach when an utterance starts. The wake word is
    # confirmed about a second after it is spoken, so a short look-back
    # misses the command that followed it.
    lead_in_ms: int = 1200
    # Silence that ends an utterance. People pause mid-sentence to think --
    # "Relay, open... the thing I was working on" -- and at 700ms Relay
    # treated the pause as the end and answered the first half. A second is
    # long enough to ride out a normal hesitation and still short enough that
    # finishing a sentence doesn't feel like waiting.
    vad_silence_ms: int = 1000
    max_utterance_s: float = 30.0
    # Conversation mode. After Relay answers, keep listening this long so a
    # follow-up needs no wake word -- the same idea as Alexa's Follow-Up
    # Mode, which uses about five seconds. 0 disables it.
    follow_up_seconds: float = 6.0
    # Keep listening during playback so "Relay, stop" can interrupt.
    barge_in: bool = True
    # Ignore the microphone for a moment after Relay finishes speaking.
    # Speakers are still settling and the room still echoing; without this
    # Relay can hear its own last word and wake itself up.
    post_speech_cooldown_ms: int = 1000
    # A short, high, quiet blip when Relay starts recording, so you know it
    # heard you. It plays *while* the microphone is live -- the wake word is
    # confirmed about a second late, so you're often already talking -- which
    # is why it sits above the speech formants and is quiet by default.
    # Set the volume to 0, or this to false, to switch it off.
    wake_chime: bool = True
    wake_chime_volume: float = 0.10
    # Which of Kokoro's 54 presets Relay speaks in. `relay voice` picks it by
    # ear, which is the only sensible way to choose between fifty-four voices
    # named things like `am_fenrir`.
    tts_voice: str = "af_heart"
    # Ducking: turn everything else down while Relay has your attention, the
    # way a smart speaker does. Echo cancellation already removes the music
    # from what the microphone hears, but it cannot remove what the music
    # does to *you* -- you raise your voice over it, and the room reverberates.
    # Turning it down for the few seconds of a request is the difference
    # between being heard and being nearly heard.
    duck_others: bool = True
    # A quarter of the original, not silence. Cutting music dead is startling
    # and makes the assistant feel like it seized the machine; ducking it is
    # the same gesture as someone turning the stereo down to listen.
    duck_level: float = 0.25


@dataclass
class MusicConfig:
    """Cider, the Apple Music client.

    The token comes from Cider's Settings -> Connectivity -> Manage External
    Application Access. It only grants control of the local music player, but
    it still lives in the config file rather than in source, and `relay
    settings` masks it.
    """

    player: str = "cider"
    cider_url: str = "http://localhost:10767"
    cider_token: str = ""
    # A cold Electron start is several seconds. Long enough to be patient,
    # short enough that a genuine failure is reported rather than hung on.
    launch_timeout_s: float = 25.0
    # Falls back to playerctl over MPRIS when the REST API can't be reached,
    # so pause and skip survive a missing or wrong token.
    allow_mpris_fallback: bool = True


@dataclass
class OverlayConfig:
    """The orb: a glass bubble that pulls out of the right bezel when Relay
    wakes, and moves differently while listening, thinking and speaking.

    Entirely optional. With `enabled = false` nothing is spawned, no socket is
    opened, and Relay behaves exactly as it did before the overlay existed.
    """

    enabled: bool = True
    # Which edge it emerges from, and where the top of the orb sits measured
    # from the top of the screen. 72 tucks it directly under the 63px bar --
    # as high as it goes without overlapping.
    edge: str = "right"
    orb_top: int = 72
    size: int = 132
    # "shader"   -- the orb shades its own glass: tint, caustic, chromatic
    #               fringe and rim light, over Hyprland's own backdrop blur.
    # "hyprglass" -- the hyprglass compositor plugin supplies refraction and
    #               dispersion for the whole surface, so the orb draws a
    #               plainer body and lets the plugin do the material. Setting
    #               this without the plugin installed just looks flat.
    material: str = "shader"
    # Layer-shell overlays draw above fullscreen windows, which is the point
    # for a wake indicator and a distraction mid-game. Off by default because
    # confirming the wake word matters more than a clean screenshot.
    hide_when_fullscreen: bool = False


@dataclass
class Config:
    agent: AgentConfig = field(default_factory=AgentConfig)
    music: MusicConfig = field(default_factory=MusicConfig)
    overlay: OverlayConfig = field(default_factory=OverlayConfig)
    usage: UsageConfig = field(default_factory=UsageConfig)
    memory: MemoryConfig = field(default_factory=MemoryConfig)
    audio: AudioConfig = field(default_factory=AudioConfig)
    # Execution axis. Persisted so `relay mode dry-run` survives a restart.
    mode: str = MODE_NORMAL
    # Set false to send every utterance to Claude instead of matching locally.
    fast_path_enabled: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _merge(target: Any, data: dict[str, Any]) -> None:
    """Overlay a parsed TOML table onto a dataclass instance, in place.

    Unknown keys are ignored rather than fatal, so a config written for a newer
    Relay doesn't stop an older one from starting.
    """
    known = {f.name: f for f in fields(target)}
    for key, value in data.items():
        if key not in known:
            continue
        current = getattr(target, key)
        if is_dataclass(current) and isinstance(value, dict):
            _merge(current, value)
        else:
            setattr(target, key, value)


def load(path: Path | None = None) -> Config:
    """Load config, falling back entirely to defaults when no file exists."""
    cfg = Config()
    config_path = path or PATHS.config_file
    if config_path.exists():
        with config_path.open("rb") as fh:
            _merge(cfg, tomllib.load(fh))
    return cfg


DEFAULT_STYLE = """\
You are speaking aloud, not writing. Your output goes through a text-to-speech
engine, so formatting is wasted at best and read out as noise at worst.

Write the way a person talks. No markdown, no bullet points, no headers, no code
blocks, no emoji. Short sentences. Answer first, detail only if asked. A typical
reply is one or two sentences.

Say paths and identifiers the way you'd say them out loud: "tilde slash Projects",
not "~/Projects". Read numbers naturally.

Confirm actions briefly rather than narrating every step. Don't announce what
you're about to do and then do it; just do it and say what happened.

Don't ask permission for things you're already allowed to do. Ask only when
genuinely blocked, or when the permission rules require confirmation.

Use the user's name occasionally, where it falls naturally — greeting them,
or softening a refusal. Not every reply, and never twice in one. Overusing it
is the fastest way to sound like a machine imitating warmth.
"""


def ensure_user_files() -> None:
    """Write the editable config files on first run. Never overwrites."""
    PATHS.ensure()
    if not PATHS.style_file.exists():
        PATHS.style_file.write_text(DEFAULT_STYLE)


def load_style() -> str:
    """The conversational style rules, editable by voice."""
    if PATHS.style_file.exists():
        return PATHS.style_file.read_text().strip()
    return DEFAULT_STYLE.strip()

# Relay

An always-on voice assistant for Hyprland, powered by Claude Sonnet 5.

Say "Relay", and it listens, transcribes locally, reasons, acts on the machine,
and speaks back — opening apps, moving windows, controlling music, reading the
screen, and remembering what matters.

It runs entirely on a Claude Pro subscription and adds **no API charges**.

## What it does

| | |
|---|---|
| **Wake word** | `relay.onnx`, trained on my own voice. ~1 MB, CPU, ~50 MB RAM. |
| **Transcription** | Parakeet TDT 0.6B, int8 ONNX, on the CPU. ~0.2 s. |
| **Reasoning** | Claude Sonnet 5, through the Claude Code subscription login. |
| **Speech** | Chatterbox on the GPU, Kokoro on the CPU when the GPU is busy. |
| **Windows** | Full Hyprland control via the 0.55 Lua dispatch API. |
| **Music** | Cider (Apple Music) over its local REST API, MPRIS as a fallback. |
| **Screen** | Screenshots, and looking at them when asked to. |
| **Memory** | Four layers in SQLite, searched by keyword *and* meaning. |
| **The orb** | A glass bubble that pulls out of the right bezel when it wakes. |

Roughly half of everyday commands — "pause", "next", "open Discord",
"workspace 2", "what time is it" — never reach the model at all. They're
matched locally and cost nothing.

## Design notes

**Memory is a database, not a transcript.** Resending conversation history
every turn gets expensive and eventually overflows the context window. Relay
keeps a searchable SQLite store — facts you told it, behaviour it has learned,
distilled conversation summaries, and a live picture of the machine — and
queries it as a tool. Retrieval is a decision the model makes, not something
that happens blindly every turn.

**It learns, but it asks first.** Do the same thing three times and Relay
notices, then asks whether to remember it. A yes stores it at 90% confidence;
a no means it never raises it again. Nothing is inferred silently.

**You can see it thinking.** A dark glass orb pulls out of the right bezel
when Relay wakes, ripples with your voice while you talk, turns over while it
thinks, and pulses on the syllables while it speaks. It is a click-through
layer-shell surface in its own Quickshell instance, so it draws above
fullscreen windows, never swallows a click, and is deleted by turning one
config flag off. Hyprland blurs the desktop behind it; the shader draws the
glass.

**It degrades instead of dying.** The wake word runs on the CPU, so when a game
or a Blender render needs the GPU, Relay drops its GPU models and keeps working
rather than going deaf.

**It asks before doing anything you'd regret.** Reads, window management and app
launching run freely; deletes, `sudo`, installs and anything that sends data to
another person need spoken confirmation. Dry-run mode previews a whole plan
without executing any of it. The rules are enforced in code, not in the prompt.

**It never spends money.** Paid API billing requires two separate opt-ins in
config and is never reached automatically. If the subscription login stops
working, Relay stops and says so.

## Status

Working and in daily use. Cursor and keyboard control is the remaining piece.

## Requirements

- Hyprland on Wayland, PipeWire, Python 3.12
- A Claude Pro subscription, logged in via `claude`
- An NVIDIA GPU for the GPU voice (optional — the CPU tier needs no GPU at all)

## Install

```bash
git clone git@github.com:eklonofficial/relay.git
cd relay
./install.sh
```

It checks for system packages and tells you what to `pacman -S` rather than
running sudo itself, then builds the virtualenv, downloads the speech models,
restores the wake word and memories from `backup/`, and installs the systemd
user service.

## Usage

```bash
relay status                       # daemon, model, plan usage
relay ask "what's on workspace 2?" # talk to it without the microphone
relay profile                      # what it knows about me
relay memory conversations         # what it has talked about
relay mode dry-run                 # preview actions without running them
relay overlay                      # the orb: status, or drive it by hand
relay backup                       # push memories and wake word to GitHub
relay docs                         # full documentation in the terminal
relay settings                     # interactive control panel
```

`SUPER+SPACE` is push-to-talk; `SUPER+SHIFT+ESC` stops it talking.

Full documentation, including troubleshooting, is in `docs/guide.md` or via
`relay docs`.

## Backup and restore

Almost all of Relay is reproducible from this repository. Three things are not,
and `relay backup` commits them to `backup/`:

- `memory.db` — everything it knows and remembers
- `relay.onnx` — the wake word, trained on my voice
- `voice-samples/` — the recordings it was trained from

`install.sh` restores all three, and will never overwrite an existing
`memory.db`.

## Uninstall

```bash
./uninstall.sh              # dry run: shows what would go
./uninstall.sh --yes        # remove it, keep memories and wake word
./uninstall.sh --yes --purge   # remove everything
```

## Licence

Personal project. Not affiliated with Anthropic.

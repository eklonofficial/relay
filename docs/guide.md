# Relay — how it works, and how to fix it

Everything you need to run Relay, understand what it's doing, and diagnose it
when it misbehaves.

---

## 1. Quick reference

```bash
relay install-service       # run at login, survive closing the terminal
relay service               # is it installed? running? enabled?
relay uninstall-service     # remove it again

relayd                      # start by hand instead (--no-voice for text only)
relayd -v                   # ...with debug logging

relay listen                # push-to-talk: SUPER+SPACE
relay abort                 # stop talking:  SUPER+SHIFT+ESC

relay status                # daemon, model, plan usage
relay mic                   # is it hearing you? is it paused?
relay tier                  # GPU/CPU tier and live VRAM
relay usage                 # how much of your plan Relay has used
relay ask "what's on workspace 2?"    # talk to it without the microphone
relay say "hello"           # test the voice
relay devices               # list microphones
relay ask "play some jazz"  # music: Cider starts itself if closed
relay ask "what's on my screen?"      # it can see
relay memory list           # what it remembers
relay profile               # what it knows about you
relay memory conversations  # what it has talked about
relay memory review         # patterns it noticed, awaiting a yes/no
relay facts                 # what it knows about this machine
relay mode dry-run          # preview actions without doing them
relay settings              # interactive control panel
relay docs                  # this document, in the terminal
relay tier sleep            # free the GPU; `relay tier auto` to restore
```

Logs: `~/.local/state/relay/relay.log`, or `journalctl --user -u relay -f`
Config: `~/.config/relay/config.toml`
Speaking style: `~/.config/relay/style.md` (plain English, edit freely)

---

## 2. What happens when you speak

```
you say "Relay, open Discord"
   |
   v
microphone            fifine @ 48kHz, resampled to 16kHz
   |
   v
wake word             relay.onnx, ~1MB, CPU. Fires at >= 0.85
   |                  Confirmed ~1s AFTER you said it, so Relay
   |                  reaches 1.2s BACK into a buffer to catch
   |                  the command that followed.
   v
endpointing           Silero VAD decides when you stopped talking
   |
   v
transcription         Parakeet TDT 0.6B, int8 ONNX, CPU (~0.2s)
   |
   v
+--- fast path? -----> yes: run it locally. ZERO tokens. ~40ms.
|                      "open X", "focus X", "workspace N",
|                      "put X on workspace N", "what time is it"
|
v  no
Claude Sonnet 5       via your subscription. ~8k tokens/turn.
   |                  Tools: memory, windows, apps, files, shell.
   v
speech                Chatterbox (GPU) or Kokoro (CPU)
```

### Talking again without the wake word

After Relay answers, it keeps listening for **6 seconds**. Anything you say in
that window is treated as a follow-up — no wake word needed — and answering
opens the window again, so a back-and-forth flows naturally:

```
you    "Relay, what time is it?"
relay  "It's twenty past five."
you    "and what's the date?"          <- no wake word
relay  "Tuesday the 28th of July."
you    "put Discord on workspace two"  <- still no wake word
```

The window doesn't open the instant Relay stops talking. It waits for the
room to go quiet for a full second first — speaker bleed and reverb otherwise
get caught and Relay transcribes its own reply back as your next command. You
can watch this in the log: *"room quiet; listening for a follow-up for 6s"*.

The window closes as soon as you stop talking, or if what it hears isn't
intelligible — background chatter shouldn't hijack it. It also requires a few
consecutive frames of speech, so a cough or a door won't open a turn.

This mirrors Alexa's Follow-Up Mode, which uses about five seconds. Amazon
ships it *disabled* by default because it misfires in noisy rooms; if you find
that happening, turn it off:

```toml
[audio]
follow_up_seconds = 0     # wake word required every time
```

`relay mic` shows whether the window is currently open.

**The fast path matters.** Every command it handles is a turn that costs
nothing from your Claude plan. If something you say often is going to the
model, it's worth adding a pattern for it in `relay/fastpath.py`.

---

## 3. Your Claude plan

Relay runs on your **Claude Pro subscription** through the same login as
Claude Code. It never uses an API key and **cannot** add anything to your bill:
paid API mode requires *two* separate opt-ins in config and is never reached
automatically. If your subscription login stops working, Relay stops and says
so rather than falling back to paid billing.

**The dollar figures are not charges.** Claude Code computes them locally from
token counts at API list prices. On a subscription they're an "if you'd paid
per token" estimate. Your real limit is the usage windows on
[claude.ai/settings/usage](https://claude.ai/settings/usage): a rolling 5-hour
session window and a weekly window, shared with your normal Claude chats.

Relay stops at **92%** of a window so there's allowance left for you. To change
that:

```toml
[usage]
block_at_utilization = 0.97
```

**Roughly what it costs:** ~8,000 tokens per model turn. Fast-path commands
cost nothing. `relay usage` shows the running total.

---

## 3b. Running it all the time

```bash
relay install-service
```

That copies `systemd/relay.service` into `~/.config/systemd/user/`, enables it,
and starts it. Relay then comes up with your graphical session and stays up
when you close the terminal.

```bash
relay service                       # installed? running? enabled?
systemctl --user restart relay      # restart after changing code
systemctl --user stop relay         # stop until next login
journalctl --user -u relay -f       # follow the log
relay uninstall-service             # remove it
```

**Why it's a *user* service, bound to `graphical-session.target`.** Relay needs
the compositor's socket to control windows and your PipeWire session for the
microphone. Neither exists at boot, so a system service would start too early
and be unable to see or hear anything.

**The environment problem.** `HYPRLAND_INSTANCE_SIGNATURE` changes every login,
so it cannot be written into the unit file. On this machine Hyprland runs under
**uwsm**, which finalises that variable into systemd on every login — so it is
always correct and nothing goes stale. Without uwsm, `install-service` runs
`systemctl --user import-environment`, which is only a snapshot of the login
that ran it; it then tells you to add the same line to `hyprland.conf`.

If Relay starts but can't control windows, this is the first thing to check:

```bash
systemctl --user show-environment | grep HYPRLAND_INSTANCE_SIGNATURE
hyprctl activewindow                # what the value should point at
```

**Conflict with a hand-started daemon.** Only one relayd can hold the socket.
`relay install-service` refuses to run if it finds another one listening, and
tells you so, rather than leaving you with a service that restarts forever.

---

## 3c. Interrupting Relay

Relay pauses its microphone while it speaks, because without echo cancellation
a desktop speaker feeds straight back into the wake-word detector and Relay
hears itself. The consequence is that it **cannot hear "stop" mid-sentence**.
So there are keys:

| Key | Does |
|---|---|
| `SUPER+SPACE` | Push-to-talk. Stops the speech and takes a command immediately — no wake word. |
| `SUPER+SHIFT+ESC` | Stop talking and drop the rest of the turn. |

Both are just `relay listen` and `relay abort`, bound in
`~/.config/hypr/custom/keybinds.lua`, so you can rebind them freely.

Saying "stop", "cancel", "never mind" or "shut up" does the same thing, but
only works once Relay has finished the sentence it's on.

Push-to-talk drops whatever audio was buffered before you pressed the key. That
buffer is full of Relay's own voice, and replaying it was the cause of Relay
transcribing its own answers back as new commands. The cost is that if you
speak *before* pressing, the first syllable is lost — press, then talk.

---

## 3c-2. The listening chime

A short warm blip plays the moment Relay starts recording, so you know it
heard you. Turn it down or off in `relay settings`.

It's worth knowing *why* it sounds the way it does. The wake word isn't
confirmed until about a second after you say it, so by the time the chime
plays you're often already talking — it lands inside the recorded audio
rather than politely before it. That forces it to be short (300ms) and quiet
(0.10 of full scale).

It sits at 587–880 Hz, which is inside the speech band. Measured against real
recordings at normal speaking volume the transcript was word-for-word
identical in 9 out of 9 placements, so the margin is there — but **if Relay
ever starts mishearing commands it used to get right, turn the chime down
first.**

```bash
relay settings          # Listening chime / Chime volume
```

---

## 3d. Seeing the screen

```
"Relay, what's on my screen?"
"Relay, what am I looking at?"
"Relay, take a screenshot and save it to my Pictures folder"
```

Two separate abilities, deliberately:

| Tool | Does | Costs |
|---|---|---|
| `take_screenshot` | Saves a PNG. Nothing leaves the machine. | Nothing |
| `read_screen` | Sends the image to Claude so it can actually see it. | ~1,400 tokens a look |

Both take `screen` (everything), `window` (whatever's focused), or `region`
(you drag a box with `slurp`).

**Privacy, plainly:** `read_screen` sends whatever is on screen to Claude.
That's the point of it, and it only happens when you ask to be looked at —
but it does mean anything visible at that moment goes with it. `relay tier
sleep` or stopping the service is the way to be certain it can't.

**On image size.** The monitor is 3440×1440. Sent whole that's ~4,800 tokens
per look, and Claude's vision resizes anything over 2576px anyway — so the
extra pixels cost allowance and buy nothing. Relay shrinks to a 1600px long
edge before sending, which still reads window titles and menu items. Saved
screenshots keep the full detail, since nothing is being sent.

Relay records the scale factor it used. Nothing needs it yet; it becomes
essential the moment Relay can click on what it sees, because every
coordinate has to be multiplied back up by ~2.15.

---

## 3e. Music

Relay drives **Cider** (Apple Music). Say any of these:

```
"Relay, play Weird Fishes by Radiohead"    "Relay, pause"
"Relay, play some jazz"                    "Relay, skip"
"Relay, what's playing?"                   "Relay, go back"
"Relay, volume 40"                         "Relay, shuffle"
"Relay, what's coming up next?"
```

**Cider starts itself.** Asking to play when it's closed launches it, says
"Starting Cider", waits for its API, then plays. A cold start takes several
seconds. Only *playing* launches it — saying "pause" with nothing open just
tells you nothing is running, rather than opening a music app at you.

**Most of these are free.** `pause`, `play`, `skip`, `go back`,
`what's playing` and `volume N` are handled locally with no model call — check
with `grep "fast path handled" ~/.local/state/relay/relay.log`.

Playing *by name* is the exception: Cider has no search endpoint, so the name
goes to Apple Music's catalogue search and the top result plays. That needs
the model, and it's fuzzy — Relay says what it actually picked, so you can
tell when it guessed wrong.

### Setting it up again

The token lives in `~/.config/relay/config.toml` under `[music]`, and comes
from Cider: **Settings → Connectivity → Manage External Application Access**.
`relay settings` can edit it and shows it masked.

```bash
relay settings                  # Cider API token, address, launch timeout
```

### When music doesn't work

```bash
# Is Cider's API up at all?
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "apptoken: $(grep cider_token ~/.config/relay/config.toml | cut -d'"' -f2)" \
  http://localhost:10767/api/v1/playback/is-playing
```

`200` means the token and API are fine. `401`/`403` means the token is wrong —
regenerate it in Cider. Connection refused means Cider isn't running or its
API is switched off in Settings.

Two failure modes worth knowing, because both looked like permissions
problems when they weren't:

- **Everything readable works, nothing else does.** Cider runs Fastify, which
  rejects a bodyless request that declares `Content-Type: application/json`
  (`FST_ERR_CTP_EMPTY_JSON_BODY`). Every argument-free command — play, pause,
  next — is a bodyless POST, so this breaks them all while leaving
  "what's playing" working perfectly.
- **The MPRIS fallback silently does nothing.** Cider is an Electron app that
  never sets an MPRIS name, so it appears on the bus as
  `chromium.instance<pid>`, not `cider` — a name that also changes every
  restart. Relay finds it by reading the D-Bus `Identity` property instead:

  ```bash
  playerctl -l                  # what's on the bus
  busctl --user get-property org.mpris.MediaPlayer2.<name> \
      /org/mpris/MediaPlayer2 org.mpris.MediaPlayer2 Identity
  ```

  The fallback only covers play/pause/skip — never search — so a broken token
  costs you playing by name even when transport still works.

---

## 4. Troubleshooting

### Relay doesn't respond when I speak

Run `relay mic` and read it in this order:

```
frames seen : 128 (mic yielded 128, dropped 0, consumers 1)
level       : now 45.2, peak 114.5
wake score  : now 0.0, peak 0.955
paused      : no
```

| Symptom | Meaning | Fix |
|---|---|---|
| `frames seen: 0` but `dropped` climbing | Audio is arriving but the consumer is stuck | Restart `relayd`; report it, this is a bug |
| `frames seen` not increasing at all | Microphone isn't open | `relay devices`, check `audio.input_device` |
| `peak level` under ~100 while you talk | Mic gain too low | See below |
| `peak score` climbing but under threshold | Close, but not confident enough | Lower `audio.wake_threshold` |
| `paused: yes` for a long time | Stuck while speaking | Restart; report it |
| `conversation: LISTENING` when you didn't speak | Follow-up window open | Normal for 6s after an answer |
| Nothing at all, and `relay ping` fails | Daemon isn't running | `relay service`, then `journalctl --user -u relay -n 50` |
| `voice loop unavailable` in the log | An audio backend failed to import | See "`uv run` silently breaks the voice" below |

**Low mic gain** is the most common cause. Check it:

```bash
pactl list sources | grep -A6 'Name: alsa_input' | grep -E 'Name|Volume'
```

If it's well under 100%, raise it:

```bash
pactl set-source-volume alsa_input.usb-3142_fifine_Microphone-00.analog-stereo 100%
```

This machine shipped at **27% / −33.69 dB**, which was quiet enough that the
wake word never fired.

### It speaks in the wrong voice, or the GPU voice never loads

Relay has two voices: **Chatterbox** on the GPU (the good one) and **Kokoro**
on the CPU (0 VRAM, instant). It starts on Kokoro and switches once Chatterbox
finishes loading, about 8 seconds in — so anything said in that window comes
out in the CPU voice, which is normal.

If it *never* switches, check the log:

```bash
grep "TTS " ~/.local/state/relay/relay.log | tail -3
```

`TTS chatterbox ready ... (cuda)` means it worked. If instead you see only
Kokoro, or a `falling back to kokoro` warning, the GPU voice failed to import.
The usual cause is dependency drift — Chatterbox is fussy:

| Breaks it | Symptom |
|---|---|
| `numpy` ≥ 2.5 | `Numba needs NumPy 2.4 or less` |
| `huggingface-hub` < 1.3 | `cannot import name 'is_offline_mode'` |
| `setuptools` ≥ 81 | `pkg_resources` gone; `perth` silently becomes `None` |
| pinning `transformers` | resolver walks Chatterbox back to 0.1.3, `llvmlite` fails to build |

Check them in one go:

```bash
.venv/bin/python -c "import chatterbox; print('ok')"
```

### `uv run` fails to resolve, or silently breaks the voice

Two separate traps.

**Resolution fails** with `tflite-runtime ... no wheels`: openWakeWord declares
`tflite-runtime`, which publishes no Python 3.12 wheels. Relay runs openWakeWord
through ONNX and never imports tflite, so it is deliberately **not** listed in
`pyproject.toml`. Install it on its own:

```bash
uv pip install --no-deps openwakeword
```

**Resolution succeeds and the voice degrades**: a bare `uv run` or `uv sync`
syncs the venv down to the core dependencies and *uninstalls* the audio and GPU
backends. Relay then still starts, quietly falls back to the CPU voice, or logs
`voice loop unavailable`. Always pass the extras:

```bash
uv sync --all-extras
```

The safest habit is to invoke the venv directly — `.venv/bin/relay`,
`.venv/bin/python -m pytest` — which is what the systemd unit does.

### Tuning the wake word

```bash
uv run python scripts/check_audio.py --listen 20
```

Say "Relay" a few times and watch the score. It prints the peak at the end.

- Real "Relay" (this speaker) scores **0.95–1.00**
- Nearest false positives — "relate" 0.80, "really" 0.73, "replay" 0.54
- Threshold sits at **0.85**, in the gap

Missing you? Lower to 0.75. Triggering on its own? Raise to 0.90.

### It said something about my plan being used up

Check [claude.ai/settings/usage](https://claude.ai/settings/usage) against
what `relay usage` reports. Relay only trusts telemetry from the last 15
minutes; older readings are ignored, because the CLI only reports usage when
the status *changes* and a stored value goes stale as the window moves.

If it still disagrees with the dashboard, raise `usage.block_at_utilization`
or set `usage.telemetry_max_age_s` lower.

### It repeated itself over and over

Fixed, but if you see it again: identical spoken messages are suppressed for
120 seconds, and Relay ignores the microphone for 600ms after it finishes
speaking. If a message contains the word "relay", speaking it retriggers the
microphone — that's what caused the original loop. Keep spoken text free of
the wake word.

### It answered its own reply

Fixed, and worth knowing the shape of because it took three attempts. Pausing
the microphone stops wake-word *scoring*, not capture, so while Relay speaks:

1. the look-back buffer fills with Relay's own voice, and
2. the frame queue — several seconds deep — fills too.

Clearing the look-back wasn't enough; the queue still held the backlog, so the
next recording replayed Relay's answer from seconds earlier. Both are now
dropped when listening resumes, and the follow-up window additionally waits
for a second of real silence before arming.

If you ever see Relay transcribe its own words back, that's the mechanism to
look at.

### The voice changed

That's deliberate. A different voice means Relay dropped to CPU mode because
something wants the GPU. `relay tier` shows why.

### It won't do something

Deletes, `sudo`, installs, `git push` and anything sending data to another
person need spoken confirmation. `rm -rf /`, disk formatting and writes to
`/etc` are refused outright and can't be approved. Permission tiers live in
`relay/permissions.py`.

### Starting fresh

```bash
rm ~/.local/share/relay/memory.db     # forget everything
relay memory reindex                  # rebuild search after a model change
```

---

## 5. GPU and power tiers

| Tier | Speech models | VRAM | When |
|---|---|---|---|
| `full` | Chatterbox (GPU) + Parakeet (CPU) | ~3.0 GiB | Plenty free |
| `lite` | Kokoro (CPU) + Parakeet (CPU) | ~0 | Game/Blender running, or VRAM tight |
| `sleep` | wake word only | ~0 | You asked |

Relay loads the GPU voice when **4700 MiB** is free and releases it when free
VRAM drops under **700 MiB**. Those two numbers answer different questions —
one is "can I afford to load 3 GiB?", the other is "is something squeezing me
out?" — and conflating them made Relay evict the model it had just loaded.

It also watches Hyprland window events, so launching CS2 or Blender drops the
tier *before* the game allocates rather than after.

```bash
relay tier lite     # force CPU
relay tier auto     # hand control back
relay tier sleep    # free everything
```

---

## 6. Memory

Four layers, all in one SQLite file at `~/.local/share/relay/memory.db`:

- **Explicit** — things you told it. Confidence 100, never decays.
- **Learned** — behaviour it noticed. Held in `observations` until seen 3
  times; a single guess never becomes a fact.
- **Episodic** — distilled conversation summaries, not transcripts.
- **System** — what this machine is. Your corrections always beat
  auto-detection, so "my browser" stays Zen even though `xdg-settings` says
  firedragon.

Search fuses keyword (FTS5) and meaning (vectors), then weights by recency,
confidence, and what you're currently doing. Unrelated questions return
**nothing** rather than the least-bad match, so Relay says "I don't know"
instead of reciting something irrelevant.

```
"Relay, remember my projects are in ~/Projects"
"Relay, where do I keep my code?"
"Relay, what do you remember about Vice?"
"Relay, forget that"
```

### What it knows about you

```bash
relay profile              # everything, most confident first
relay facts                # ...and what it knows about the machine
```

Entries marked `*` are in Relay's context on **every turn** — your name, your
school, Vice, your machines. Everything else it looks up when relevant. That
split is deliberate: the full profile is a few hundred tokens, and paying that
per turn is exactly the context stuffing the memory system exists to avoid.

Identity lives in `memories`, *not* `system_facts`. That table describes this
machine and is overwritten by a probe on every start — putting "M1 MacBook
Air" in it would corrupt answers about your actual GPU.

Tell it something new about yourself and it stores it at 100%. Contradict
something and the old row is superseded, not deleted, so "what did I used to
have that set to?" still answers.

### Conversations

Relay keeps a persistent session and rotates it after **20 minutes idle** or
40 turns. Speak again inside that window and it remembers the exchange; after
that it's a fresh conversation.

When a conversation *ends*, Relay summarises it in one small model call and
stores the summary — a topic title and a few sentences on what was decided,
never a transcript.

```bash
relay memory conversations      # what it has kept
```

**Commands are not conversations.** "Pause the music" leaves no trace at all:
fast-path turns return before the buffer is touched, so they're structurally
incapable of creating a row. On top of that, a session is only kept if it had
two or more model turns, or a single turn that actually did something. A lone
"what's the weather" is dropped.

### Learning from what you do

A short allowlist of repeatable actions is noticed — which workspace an app
goes to, what you set the volume to. After **three** occurrences Relay asks:

```
> put discord on workspace 2
Moved discord to workspace 2.
By the way — Discord belongs on workspace 2, 3 times now. Want me to remember that?
> yes
Noted, I'll remember that.
```

A yes stores it at 90%. A no dismisses it permanently — it will never ask
again. It asks at most once per conversation, so it can't nag.

```bash
relay memory review                  # what's waiting to be confirmed
relay memory review --approve 4      # ...or handle it in a batch
relay memory review --dismiss 4
relay memory restore 12              # undo a "forget that"
```

The allowlist is deliberately narrow. Recording every action is how a memory
fills with noise, and noise is what makes search useless.

### Confidence and decay

| Source | Confidence | Decays? |
|---|---|---|
| You said it | 100% | never |
| You confirmed it when asked | 90% | never |
| Seen 3+ times, unconfirmed | 80% | 1 point/month, floor 20 |
| A single guess | 20% | already at the floor |

Pinned memories never decay regardless. Decay runs once a day in the
background, never on the path of a reply.

---

## 7. Settings panel

```bash
relay settings          # interactive
relay settings --list   # print everything and exit
```

Arrow keys move, enter edits (booleans and choices toggle), `s` saves, `q`
quits. Only values you actually change are written, so future defaults keep
improving. Restart `relayd` to apply.

Settings the panel doesn't expose — like the wake-word model path — are
preserved when it saves.

## 8. Configuration

`~/.config/relay/config.toml`. Everything is optional; defaults suit this
machine.

```toml
[agent]
model = "claude-sonnet-5"
effort = "low"               # low | medium | high — speed vs depth

[audio]
wake_word = "/home/andrewmarin/.local/share/relay/models/relay.onnx"
wake_threshold = 0.85
lead_in_ms = 1200            # how far back to reach for the command
vad_silence_ms = 700         # silence that ends an utterance
post_speech_cooldown_ms = 600
follow_up_seconds = 6        # keep listening after an answer; 0 = always need the wake word

[usage]
block_at_utilization = 0.92
telemetry_max_age_s = 900
session_idle_minutes = 20    # start a fresh session after this; keeps turns cheap

[models]
tier = "auto"                # or full / lite / sleep
heavy_apps = ["steam_app_", "cs2", "blender", "Unity", "obs"]

fast_path_enabled = true
```

---

## 9. Retraining the wake word

If detection is unreliable, record 6–10 clips of yourself saying the word
(1–2 seconds each, WAV), drop them in
`~/.local/share/relay/voice-samples/wake/`, and run:

```bash
uv run python scripts/train_wakeword.py --word Relay
```

Takes about 7 minutes on CPU. It mixes your recordings with 54 synthetic
voices and trains against deliberate near-misses ("delay", "replay",
"relate"). Nothing leaves the machine.

Afterwards, re-check the threshold with `check_audio.py --listen`.

---

## 10. Layout

```
relay/
  daemon.py        wiring; owns store, agent, tools, voice
  voice.py         wake -> transcribe -> fast path or model -> speak
  fastpath.py      local commands, zero tokens
  permissions.py   AUTO / ASK / NEVER tiers, dry-run
  config.py        typed defaults + config.toml
  agent/           Claude client, prompt, sentence streaming
  audio/           capture, wake word, VAD, playback
  stt/ tts/        Parakeet; Chatterbox + Kokoro
  memory/          schema, hybrid search, embeddings
  models/          GPU tiering
  tools/           MCP tools: memory, desktop, files
scripts/
  check_audio.py     microphone and wake word diagnostics
  check_auth.py      prove which Claude credential is in use
  train_wakeword.py  train a custom wake word
  measure_turn_cost.py
```

Run the tests with `uv run pytest -q` (250 of them).

Deeper notes: `docs/cost-findings.md` (what a turn really costs),
`docs/hyprland-dispatch.md` (the 0.55 Lua API change).

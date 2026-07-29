#!/usr/bin/env bash
# Rebuild Relay from this repository.
#
# Safe to re-run: every step checks before it acts, so this doubles as a
# repair tool when one piece has broken.
#
#   ./install.sh                 # full install
#   ./install.sh --no-service    # install, but don't enable it at login
#   ./install.sh --no-restore    # skip restoring memories from backup/
#
# Needs root only for system packages, and it will not attempt those itself:
# it prints the pacman command and waits.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/relay"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/relay"
MODELS="$DATA/models"
BIN="$HOME/.local/bin"
BACKUP="$HERE/backup"

WANT_SERVICE=1
WANT_RESTORE=1
for arg in "$@"; do
    case "$arg" in
        --no-service) WANT_SERVICE=0 ;;
        --no-restore) WANT_RESTORE=0 ;;
        --help|-h) sed -n '2,13p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
say()  { printf '  %s\n' "$1"; }
die()  { printf '\n  ERROR: %s\n' "$1" >&2; exit 1; }

# ------------------------------------------------------ system packages
step "1. System packages"
MISSING=()
#         binary       package
for pair in "uv:uv" "grim:grim" "slurp:slurp" "playerctl:playerctl" \
            "hyprctl:hyprland" "busctl:systemd" "ffmpeg:ffmpeg"; do
    bin="${pair%%:*}"; pkg="${pair##*:}"
    command -v "$bin" >/dev/null 2>&1 || MISSING+=("$pkg")
done

if [ ${#MISSING[@]} -gt 0 ]; then
    say "Missing: ${MISSING[*]}"
    say ""
    say "Run this, then start install.sh again:"
    say ""
    say "    sudo pacman -S --needed ${MISSING[*]}"
    say ""
    die "install the packages above first"
fi
say "all present: uv, grim, slurp, playerctl, hyprctl, ffmpeg"

# Optional, so noted rather than demanded.
for pair in "cider:music control" "ydotool:cursor control (future)" \
            "wtype:typing (future)"; do
    bin="${pair%%:*}"; what="${pair##*:}"
    command -v "$bin" >/dev/null 2>&1 || say "optional, not installed: $bin — $what"
done

# ------------------------------------------------------------ the venv
step "2. Python environment"
if [ ! -d "$HERE/.venv" ]; then
    say "creating .venv on Python 3.12"
    (cd "$HERE" && uv venv --python 3.12) || die "could not create the virtualenv"
fi

say "installing dependencies (several minutes; torch is large)"
(cd "$HERE" && uv sync --all-extras) || die "dependency install failed"

# openWakeWord declares tflite-runtime, which has no Python 3.12 wheels. Relay
# runs it through ONNX and never imports tflite, so it is deliberately absent
# from pyproject.toml -- naming it there makes the whole project unresolvable.
say "installing openwakeword separately (see the comment in pyproject.toml)"
(cd "$HERE" && uv pip install --no-deps openwakeword) \
    || die "could not install openwakeword"

say "verifying every backend imports"
"$HERE/.venv/bin/python" - <<'PY' || die "a backend failed to import; see above"
import importlib, sys
missing = []
for name in ("openwakeword.model", "silero_vad", "sounddevice", "onnx_asr",
             "kokoro_onnx", "chatterbox", "torch", "sqlite_vec",
             "claude_agent_sdk", "onnxruntime", "httpx"):
    try:
        importlib.import_module(name)
    except Exception as exc:
        missing.append(f"{name}: {exc}")
if missing:
    print("\n".join("    " + m for m in missing))
    sys.exit(1)
print("    all backends import")
PY

# ------------------------------------------------------------- commands
step "3. Shell commands"
mkdir -p "$BIN"
for cmd in relay relayd; do
    ln -sf "$HERE/.venv/bin/$cmd" "$BIN/$cmd"
    say "linked $BIN/$cmd"
done
case ":$PATH:" in
    *":$BIN:"*) ;;
    *) say "WARNING: $BIN is not on your PATH — add it to your shell profile" ;;
esac

# --------------------------------------------------------------- models
step "4. Models"
mkdir -p "$MODELS"
KOKORO_URL="https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
for pair in "kokoro-v1.0.onnx:$KOKORO_URL/kokoro-v1.0.onnx" \
            "voices-v1.0.bin:$KOKORO_URL/voices-v1.0.bin"; do
    file="${pair%%:*}"; url="${pair#*:}"
    if [ -f "$MODELS/$file" ]; then
        say "already have $file"
    else
        say "downloading $file"
        curl -fL --progress-bar -o "$MODELS/$file" "$url" \
            || die "could not download $file"
    fi
done
say "Parakeet and the embedding model download themselves on first use"

# ---------------------------------------------------- restore the backup
step "5. Restoring from backup/"
if [ "$WANT_RESTORE" -eq 0 ]; then
    say "skipped (--no-restore)"
elif [ ! -d "$BACKUP" ]; then
    say "no backup/ directory in the repo — starting fresh"
else
    # The wake word is the important one: it was trained on Andrew's voice
    # and there is nowhere to download it from.
    if [ -f "$BACKUP/relay.onnx" ]; then
        cp -n "$BACKUP/relay.onnx" "$MODELS/relay.onnx" 2>/dev/null \
            && say "restored the trained wake word" \
            || say "wake word already present, left alone"
    fi
    if [ -d "$BACKUP/voice-samples" ]; then
        mkdir -p "$DATA/voice-samples"
        cp -rn "$BACKUP/voice-samples/." "$DATA/voice-samples/" 2>/dev/null
        say "restored the voice samples"
    fi
    if [ -f "$BACKUP/memory.db" ]; then
        if [ -f "$DATA/memory.db" ]; then
            say "memory.db already exists here — NOT overwriting it"
            say "  to replace it:  cp $BACKUP/memory.db $DATA/memory.db"
        else
            mkdir -p "$DATA"
            cp "$BACKUP/memory.db" "$DATA/memory.db"
            say "restored the memory database"
        fi
    fi
fi

# --------------------------------------------------------------- config
step "6. Configuration"
mkdir -p "$CONFIG"
if [ -f "$CONFIG/config.toml" ]; then
    say "config.toml already exists, left alone"
elif [ -f "$HERE/config.example.toml" ]; then
    cp "$HERE/config.example.toml" "$CONFIG/config.toml"
    chmod 600 "$CONFIG/config.toml"
    say "wrote $CONFIG/config.toml from the example"
    say ""
    say "  It has no Cider API token, so music-by-name won't work until you"
    say "  add one: Cider -> Settings -> Connectivity -> Manage External"
    say "  Application Access, then 'relay settings'."
fi

# The wake-word path is machine-specific and not in the example.
if [ -f "$MODELS/relay.onnx" ] && ! grep -q "wake_word" "$CONFIG/config.toml" 2>/dev/null; then
    printf '\n[audio]\nwake_word = "%s"\nwake_threshold = 0.85\n' \
        "$MODELS/relay.onnx" >> "$CONFIG/config.toml"
    say "pointed the config at the restored wake word"
fi

# -------------------------------------------------------------- service
step "7. The service"
if [ "$WANT_SERVICE" -eq 1 ]; then
    "$HERE/.venv/bin/relay" install-service || say "could not install the service"
else
    say "skipped (--no-service). Start by hand with: relayd"
fi

# ------------------------------------------------------------- keybinds
step "8. Hyprland keybindings"
KEYBINDS="$HOME/.config/hypr/custom/keybinds.lua"
if [ -f "$KEYBINDS" ] && grep -q "Relay voice assistant" "$KEYBINDS"; then
    say "already bound"
elif [ -f "$KEYBINDS" ]; then
    cat >> "$KEYBINDS" <<EOF

-- Relay voice assistant.
-- Push-to-talk exists because Relay pauses its microphone while speaking (no
-- echo cancellation yet), so it cannot hear "stop" mid-sentence.
local relay = "$HERE/.venv/bin/relay"
hl.bind("SUPER+Space", hl.dsp.exec_cmd(relay .. " listen"),
    { description = "Relay: push-to-talk" })
hl.bind("SUPER+SHIFT+Escape", hl.dsp.exec_cmd(relay .. " abort"),
    { description = "Relay: stop talking" })
EOF
    say "added SUPER+SPACE and SUPER+SHIFT+ESC"
    hyprctl reload >/dev/null 2>&1 && say "reloaded Hyprland"
else
    say "no $KEYBINDS — bind 'relay listen' yourself if you want push-to-talk"
fi

# -------------------------------------------------------------- overlay
step "9. The orb"
RULES="$HOME/.config/hypr/custom/rules.lua"
QML_DIR="$HERE/relay/overlay/qml"
QML_SHADER="$QML_DIR/orb.frag.qsb"

# The compiled shader is committed, because `qsb` lives in /usr/lib/qt6/bin
# and is not on PATH, and installing should not need a shader toolchain.
# Recompiled here only when the tool happens to be present and the source is
# newer than the artefact.
QSB="/usr/lib/qt6/bin/qsb"
if [ -x "$QSB" ] && [ "$QML_DIR/orb.frag" -nt "$QML_SHADER" ]; then
    "$QSB" --qt6 -o "$QML_SHADER" "$QML_DIR/orb.frag" && say "recompiled the shader"
fi

if [ ! -f "$QML_SHADER" ]; then
    say "no compiled shader at $QML_SHADER — the orb will not draw"
elif [ -f "$RULES" ] && grep -q "relay-orb" "$RULES"; then
    say "already configured"
elif [ -f "$RULES" ]; then
    cat >> "$RULES" <<'EOF'

-- ######## Relay ########
-- The wake orb (relay/overlay). Deliberately NOT a "quickshell:*" namespace:
-- hyprland/rules.lua gives those blur with ignore_alpha 0.79, and at 0.79 a
-- translucent orb is never blurred at all, which is the whole effect gone.
-- These are loaded after that file, so they win.
hl.layer_rule({ match = { namespace = "relay-orb" }, blur = true })
-- Blur even the near-transparent body, which is most of the glass.
hl.layer_rule({ match = { namespace = "relay-orb" }, ignore_alpha = 0.02 })
-- Overrides the global xray = true. With xray the blur samples only the
-- wallpaper, so the orb would refract the desktop while sitting on a window.
hl.layer_rule({ match = { namespace = "relay-orb" }, xray = false })
-- The shader does its own entrance; Hyprland's layer animation fights it.
hl.layer_rule({ match = { namespace = "relay-orb" }, no_anim = true })
EOF
    say "added the relay-orb layer rules"
    hyprctl reload >/dev/null 2>&1 && say "reloaded Hyprland"
else
    say "no $RULES — the orb will draw, but without backdrop blur"
fi

if ! command -v qs >/dev/null 2>&1 && ! command -v quickshell >/dev/null 2>&1; then
    say "quickshell is not installed; the orb stays off (Relay is unaffected)"
    say "  install it, or set [overlay] enabled = false to silence the warning"
fi

# -------------------------------------------------------- echo cancellation
step "10. Echo cancellation"
# Not enabled automatically: it changes the machine's audio graph, and that
# is a decision to make deliberately rather than to find having happened.
if [ -f "$HOME/.config/pipewire/pipewire.conf.d/99-relay-echo-cancel.conf" ]; then
    say "already enabled"
else
    say "optional: lets Relay hear you over music and over its own voice"
    say "  enable with:  ./scripts/setup_aec.sh enable"
fi

# ----------------------------------------------------------------- done
step "Done."
say "Check it with:   relay status"
say "Read the docs:   relay docs"
say "Watch the log:   journalctl --user -u relay -f"
echo
say "Relay uses your Claude subscription through the Claude Code login."
say "If 'relay status' says the subscription is unavailable, run: claude"

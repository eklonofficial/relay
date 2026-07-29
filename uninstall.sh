#!/usr/bin/env bash
# Remove Relay from this machine.
#
# Nothing here needs root. Relay only ever installed things into the user's
# own home directory and systemd user session, which is why removing it is
# this dull.
#
# Defaults to a dry run. Nothing is deleted until you pass --yes, and even
# then the memory database and the trained wake word are kept unless you also
# pass --purge -- those two are the only things that cannot be recreated.
#
#   ./uninstall.sh              # show what would be removed
#   ./uninstall.sh --yes        # remove Relay, keep memories and wake word
#   ./uninstall.sh --yes --purge   # remove everything, including memories
#
set -uo pipefail

DRY=1
PURGE=0
for arg in "$@"; do
    case "$arg" in
        --yes|-y)  DRY=0 ;;
        --purge)   PURGE=1 ;;
        --help|-h) sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
        *) echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/relay"
CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/relay"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/relay"
UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/relay.service"
HYPR_KEYBINDS="$HOME/.config/hypr/custom/keybinds.lua"

if [ "$DRY" -eq 1 ]; then
    echo "DRY RUN — nothing will be removed. Re-run with --yes to do it."
    echo
fi

say()  { printf '  %s\n' "$1"; }
step() { printf '\n%s\n' "$1"; }

run() {
    if [ "$DRY" -eq 1 ]; then
        say "would: $*"
    else
        "$@" 2>/dev/null && say "done: $*" || say "skipped (not present): $*"
    fi
}

remove() {
    local target="$1"
    [ -e "$target" ] || { say "not present: $target"; return; }
    local size
    size=$(du -sh "$target" 2>/dev/null | cut -f1)
    if [ "$DRY" -eq 1 ]; then
        say "would remove: $target  ($size)"
    else
        rm -rf "$target" && say "removed: $target  ($size)"
    fi
}

# ---------------------------------------------------------------- service
step "1. Stopping the service"
if systemctl --user list-unit-files relay.service >/dev/null 2>&1; then
    run systemctl --user stop relay.service
    run systemctl --user disable relay.service
    remove "$UNIT"
    run systemctl --user daemon-reload
else
    say "the systemd service was never installed"
fi

# A hand-started relayd holds the same socket and won't be stopped by systemd.
if pgrep -x relayd >/dev/null 2>&1; then
    step "   A relayd started by hand is still running"
    run pkill -x relayd
fi

# ------------------------------------------------------------- shortcuts
step "2. Removing the shell commands"
for cmd in relay relayd; do
    link="$HOME/.local/bin/$cmd"
    if [ -L "$link" ]; then
        remove "$link"
    elif [ -e "$link" ]; then
        say "left alone (not a symlink, so not ours): $link"
    else
        say "not present: $link"
    fi
done

# ------------------------------------------------------------- keybinds
step "3. Hyprland keybindings"
if [ -f "$HYPR_KEYBINDS" ] && grep -q "Relay voice assistant" "$HYPR_KEYBINDS"; then
    if [ "$DRY" -eq 1 ]; then
        say "would strip the Relay block from $HYPR_KEYBINDS"
        say "(a .bak copy is written first)"
    else
        cp "$HYPR_KEYBINDS" "$HYPR_KEYBINDS.bak-uninstall"
        # Delete from the Relay comment marker to the end of its block.
        sed -i '/^-- Relay voice assistant\.$/,/^hl\.bind("SUPER+SHIFT+Escape".*$/d' \
            "$HYPR_KEYBINDS"
        # Tidy the local declaration and any leftover blank run.
        sed -i '/^local relay = .*\.venv\/bin\/relay"$/d' "$HYPR_KEYBINDS"
        say "stripped the Relay block (backup at $HYPR_KEYBINDS.bak-uninstall)"
        say "run 'hyprctl reload' to apply"
    fi
else
    say "no Relay keybindings found"
fi

# ------------------------------------------------------------------ audio
step "3a. Echo cancellation"
AEC_DROPIN="$HOME/.config/pipewire/pipewire.conf.d/99-relay-echo-cancel.conf"
if [ -f "$AEC_DROPIN" ]; then
    if [ "$DRY" -eq 1 ]; then
        say "would remove $AEC_DROPIN and restart PipeWire"
    else
        rm -f "$AEC_DROPIN"
        systemctl --user restart pipewire pipewire-pulse 2>/dev/null || true
        say "removed the echo canceller and restarted PipeWire"
    fi
else
    say "not installed"
fi

# -------------------------------------------------------------- orb rules
step "3b. Orb layer rules"
HYPR_RULES="$HOME/.config/hypr/custom/rules.lua"
if [ -f "$HYPR_RULES" ] && grep -q "relay-orb" "$HYPR_RULES"; then
    if [ "$DRY" -eq 1 ]; then
        say "would strip the relay-orb rules from $HYPR_RULES"
        say "(a .bak copy is written first)"
    else
        cp "$HYPR_RULES" "$HYPR_RULES.bak-uninstall"
        # From the Relay banner to the last of its layer rules.
        sed -i '/^-- ######## Relay ########$/,/^hl\.layer_rule({ match = { namespace = "relay-orb" }, no_anim = true })$/d' \
            "$HYPR_RULES"
        # The block was appended after a blank separator line; drop the
        # trailing blank run so the file comes back byte-identical.
        printf '%s\n' "$(cat "$HYPR_RULES")" > "$HYPR_RULES"
        say "stripped the orb rules (backup at $HYPR_RULES.bak-uninstall)"
        say "run 'hyprctl reload' to apply"
    fi
else
    say "no orb layer rules found"
fi

# ------------------------------------------------------------------ data
step "4. Configuration and runtime state"
remove "$STATE"          # logs
remove "$CONFIG"         # config.toml (holds the Cider token) and style.md

step "5. Models and data"
if [ "$PURGE" -eq 1 ]; then
    remove "$DATA"
else
    # Keep the two irreplaceable things, drop the rest.
    for path in "$DATA/models/kokoro-v1.0.onnx" \
                "$DATA/models/voices-v1.0.bin" \
                "$DATA/models/models--BAAI--bge-small-en-v1.5" \
                "$DATA/models/CACHEDIR.TAG" \
                "$DATA/sessions" "$DATA/screenshots"; do
        remove "$path"
    done
    echo
    say "KEPT: $DATA/memory.db          (everything Relay knows about you)"
    say "KEPT: $DATA/models/relay.onnx  (wake word trained on your voice)"
    say "KEPT: $DATA/voice-samples      (the recordings it was trained from)"
    say ""
    say "Those three cannot be downloaded again. Pass --purge to remove them"
    say "as well, or run 'relay backup' first to push them to GitHub."
fi

# ------------------------------------------------------------- the venv
step "6. The virtualenv"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
remove "$HERE/.venv"

step "Done."
if [ "$DRY" -eq 1 ]; then
    echo "  Nothing was removed. Re-run with --yes to actually do it."
else
    echo "  Relay is uninstalled. The source tree at $HERE is untouched;"
    echo "  delete it by hand if you want it gone too."
fi

echo
echo "  Not touched, because Relay didn't install them: cider, ydotool,"
echo "  grim, slurp, playerctl, uv. Remove those with pacman if you want."

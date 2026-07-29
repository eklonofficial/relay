#!/usr/bin/env bash
# Acoustic echo cancellation for Relay -- hearing you over the speakers.
#
# The microphone picks up everything the speakers play: music, a video,
# Relay's own voice. Without help none of that is distinguishable from the
# person talking. This loads PipeWire's WebRTC echo canceller, which takes
# the audio being sent to the speakers as a reference and subtracts it from
# what the microphone hears. What is left is the room.
#
#   ./scripts/setup_aec.sh enable     install it and point Relay at it
#   ./scripts/setup_aec.sh disable    remove it and go back to the raw mic
#   ./scripts/setup_aec.sh status     is it loaded, and what is it bound to
#   ./scripts/setup_aec.sh measure    how much is actually being cancelled
#
# It adds one input device and changes nothing about the existing ones.
# Disabling deletes a single file.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DROPIN_DIR="$HOME/.config/pipewire/pipewire.conf.d"
DROPIN="$DROPIN_DIR/99-relay-echo-cancel.conf"
SOURCE_NAME="relay_mic"
RELAY_CONFIG="$HOME/.config/relay/config.toml"

say()  { printf '  %s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }

restart_pipewire() {
    systemctl --user restart pipewire pipewire-pulse
    # The graph takes a moment to rebuild; checking immediately reports a
    # missing device that is merely late.
    sleep 3
}

loaded() { pactl list short sources 2>/dev/null | grep -q "\b$SOURCE_NAME\b"; }

cmd_enable() {
    step "1. Installing the echo canceller"
    if [ ! -f "$HERE/scripts/relay-echo-cancel.conf" ]; then
        say "missing scripts/relay-echo-cancel.conf"; exit 1
    fi
    mkdir -p "$DROPIN_DIR"
    cp "$HERE/scripts/relay-echo-cancel.conf" "$DROPIN"
    say "wrote $DROPIN"

    step "2. Restarting PipeWire"
    restart_pipewire
    if loaded; then
        say "created the '$SOURCE_NAME' input"
    else
        say "the module did not load. Undoing, so audio is left as it was."
        rm -f "$DROPIN"
        restart_pipewire
        say "check: journalctl --user -u pipewire -n 40"
        exit 1
    fi

    step "3. Pointing Relay at it"
    if [ -f "$RELAY_CONFIG" ] && grep -q "$SOURCE_NAME" "$RELAY_CONFIG"; then
        say "already configured"
    elif [ -f "$RELAY_CONFIG" ]; then
        cp "$RELAY_CONFIG" "$RELAY_CONFIG.bak-aec"
        # Relay resolves this name to a device index at startup and falls
        # back to the default input if it is missing, so the setting is safe
        # to leave in place even with the module unloaded.
        if grep -q "^input_device" "$RELAY_CONFIG"; then
            sed -i "s|^input_device.*|input_device = \"$SOURCE_NAME\"|" "$RELAY_CONFIG"
        else
            sed -i "/^\[audio\]/a input_device = \"$SOURCE_NAME\"" "$RELAY_CONFIG"
        fi
        say "set input_device (backup at $RELAY_CONFIG.bak-aec)"
    else
        say "no $RELAY_CONFIG yet — add input_device = \"$SOURCE_NAME\" under [audio]"
    fi

    step "4. Restarting Relay"
    systemctl --user restart relay 2>/dev/null && say "restarted" \
        || say "not running as a service; restart it yourself"

    step "Done."
    say "Check it heard the change:  relay mic"
    say "Measure the cancellation:   ./scripts/setup_aec.sh measure"
}

cmd_disable() {
    step "1. Removing the echo canceller"
    if [ -f "$DROPIN" ]; then
        rm -f "$DROPIN"
        say "removed $DROPIN"
        restart_pipewire
    else
        say "not installed"
    fi

    step "2. Putting Relay back on the raw microphone"
    if [ -f "$RELAY_CONFIG" ] && grep -q "$SOURCE_NAME" "$RELAY_CONFIG"; then
        cp "$RELAY_CONFIG" "$RELAY_CONFIG.bak-aec-off"
        sed -i "/input_device = \"$SOURCE_NAME\"/d" "$RELAY_CONFIG"
        sed -i "/^# The echo-cancelled source created by/,+1d" "$RELAY_CONFIG"
        say "cleared input_device (backup at $RELAY_CONFIG.bak-aec-off)"
        systemctl --user restart relay 2>/dev/null && say "restarted Relay" || true
    else
        say "Relay was not using it"
    fi
    step "Done."
}

cmd_status() {
    step "Echo cancellation"
    [ -f "$DROPIN" ] && say "config : $DROPIN" || say "config : not installed"
    if loaded; then
        say "device : $SOURCE_NAME is present"
    else
        say "device : absent"
    fi
    # What the canceller is using as its reference. Unset in the config, so
    # it binds to whatever the current default sink is -- which means it
    # follows the output rather than being pinned to one that may go away.
    local ref
    ref="$(pw-link -l 2>/dev/null | grep -A1 'echo-cancel-sink:input_FL' \
           | grep '<-' | sed 's/.*<- *//' || true)"
    [ -n "$ref" ] && say "reference: ${ref%%:*}" || say "reference: not linked"
    say ""
    say "Relay input_device: $(grep -oP '(?<=^input_device = ").*(?=")' "$RELAY_CONFIG" 2>/dev/null || echo '(default)')"
}

cmd_measure() {
    step "Measuring"
    say "Playing noise through the speakers and recording both microphones."
    say "This is meaningless on headphones -- there is no echo to cancel."
    say ""
    exec "$HERE/.venv/bin/python" "$HERE/scripts/measure_aec.py"
}

case "${1:-status}" in
    enable)  cmd_enable ;;
    disable) cmd_disable ;;
    status)  cmd_status ;;
    measure) cmd_measure ;;
    *) echo "usage: $0 {enable|disable|status|measure}" >&2; exit 2 ;;
esac

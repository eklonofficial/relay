// The orb itself: state in, uniforms out.
//
// All the drawing is in orb.frag. This file only decides how the numbers get
// from one state to the next, and that is most of what makes it feel like a
// physical object rather than a set of pictures. Nothing snaps except the
// moment the droplet separates, which is the one place a snap is wanted.

import QtQuick

Item {
    id: root

    property real orbRadius: 66
    property bool plainBody: false

    // --- live state ------------------------------------------------------
    property string state_: "idle"
    property real emerge: 0       // 0 inside the bezel, 1 detached
    property real level: 0        // 0..1 loudness
    property real thinking: 0     // blend into the thinking look
    property real speaking: 0     // blend into the speaking look

    // Envelope playback for speech: the whole shape of a sentence arrives at
    // once and is replayed against a local clock, so the pulse follows the
    // words instead of lagging a message behind them.
    property var envelope: []
    property real envelopeDuration: 0
    property real envelopeStartedAt: 0

    visible: emerge > 0.001 || shader.opacity > 0.001

    function reset() {
        envelope = [];
        root.state_ = "idle";
        emerge = 0;
        level = 0;
        thinking = 0;
        speaking = 0;
    }

    function handle(line) {
        if (!line) return;
        let msg;
        try {
            msg = JSON.parse(line);
        } catch (e) {
            return;                      // a partial line is not worth a crash
        }
        if (msg.level !== undefined) root.level = msg.level;
        if (msg.state === undefined) return;

        root.state_ = msg.state;
        if (msg.state === "speaking" && msg.envelope && msg.envelope.length > 0) {
            root.envelope = msg.envelope;
            root.envelopeDuration = msg.duration || 0;
            root.envelopeStartedAt = clock.elapsed;
        } else if (msg.state !== "speaking") {
            root.envelope = [];
        }
    }

    // --- transitions -----------------------------------------------------
    // The pull-out overshoots slightly and settles: surface tension letting
    // go. Retracting is quicker and does not overshoot, because being pulled
    // back into a bezel is not elastic.
    Behavior on emerge {
        NumberAnimation {
            duration: root.emerge > 0.5 ? 460 : 300
            easing.type: root.emerge > 0.5 ? Easing.OutBack : Easing.InCubic
            easing.overshoot: 1.15
        }
    }
    Behavior on thinking { NumberAnimation { duration: 320; easing.type: Easing.InOutQuad } }
    Behavior on speaking { NumberAnimation { duration: 200; easing.type: Easing.OutQuad } }
    // Loudness is smoothed on the way in: raw RMS is jittery per 80ms frame,
    // and an orb that flickers reads as broken rather than as responsive.
    Behavior on level    { NumberAnimation { duration: 90;  easing.type: Easing.OutQuad } }

    onState_Changed: {
        switch (state_) {
        case "waking":    emerge = 1; thinking = 0; speaking = 0; break;
        case "listening": emerge = 1; thinking = 0; speaking = 0; break;
        case "thinking":  emerge = 1; thinking = 1; speaking = 0; level = 0; break;
        case "speaking":  emerge = 1; thinking = 0; speaking = 1; break;
        case "idle":      emerge = 0; thinking = 0; speaking = 0; level = 0; break;
        }
    }

    // --- clock -----------------------------------------------------------
    // One repeating animator drives `time`. A Timer would tie the animation
    // to a wall-clock tick rather than to the frame, and the wobble would
    // beat against the refresh rate.
    QtObject {
        id: clock
        property real elapsed: 0
    }

    NumberAnimation on _tick {
        id: ticker
        from: 0
        to: 10000
        duration: 10000000
        loops: Animation.Infinite
        running: root.visible
    }
    property real _tick: 0
    on_TickChanged: {
        clock.elapsed = _tick;
        if (root.envelope.length > 0 && root.envelopeDuration > 0) {
            const progress = (clock.elapsed - root.envelopeStartedAt) / root.envelopeDuration;
            if (progress >= 0 && progress <= 1) {
                const i = Math.min(root.envelope.length - 1,
                                   Math.floor(progress * root.envelope.length));
                root.level = root.envelope[i];
            } else if (progress > 1) {
                root.envelope = [];
                root.level = 0;
            }
        }
    }

    ShaderEffect {
        id: shader
        anchors.fill: parent

        // Fading the whole effect in and out on top of the shape animation
        // hides the single frame where the neck is thinner than one pixel.
        opacity: root.emerge > 0.001 ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 180 } }

        blending: true
        fragmentShader: Qt.resolvedUrl("orb.frag.qsb")

        property vector2d size: Qt.vector2d(width, height)
        property real time: clock.elapsed
        property real emerge: root.emerge
        property real level: root.level
        property real thinking: root.thinking
        property real speaking: root.speaking
        property real radius: root.orbRadius
        property real plainBody: root.plainBody ? 1.0 : 0.0
    }
}

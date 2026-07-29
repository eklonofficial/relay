//@ pragma UseQApplication

// Relay's orb, as a standalone Quickshell instance.
//
// Deliberately not a widget inside ~/.config/quickshell/ii: that tree belongs
// to end-4's dotfiles and is replaced on update. Living here means the orb is
// committed with Relay, backed up with it, and removed with it.
//
// The namespace matters. Every `quickshell:*` layer on this machine picks up
// `blur = true` and `ignore_alpha = 0.79` from hyprland/rules.lua, and 0.79
// would mean a translucent orb is never blurred at all -- no glass. Calling
// ourselves "relay-orb" instead opts out of all of that, and install.sh adds
// the four rules we actually want.

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland

ShellRoot {
    id: root

    // Config arrives as environment variables because the window geometry is
    // needed before any socket has connected.
    readonly property int orbSize: parseInt(Quickshell.env("RELAY_ORB_SIZE") || "132")
    // Where the TOP OF THE ORB sits, measured from the top of the screen --
    // not the panel's margin, which would depend on the padding below and be
    // impossible to set by eye. 72 puts it just under the 63px bar.
    readonly property int orbTop: parseInt(Quickshell.env("RELAY_ORB_TOP") || "72")
    readonly property string socketPath: Quickshell.env("RELAY_ORB_SOCKET") || ""
    readonly property bool plainBody: (Quickshell.env("RELAY_ORB_MATERIAL") || "shader") === "hyprglass"

    // Room above and below the orb for the wobble, the lip and the soft edge.
    // Kept tight: this is the surface the compositor composites and blurs
    // behind on every frame, and it is also what decides how far down the
    // panel reaches for a given orbTop.
    readonly property int vpad: 40

    PanelWindow {
        id: panel

        WlrLayershell.namespace: "relay-orb"
        WlrLayershell.layer: WlrLayer.Overlay        // above fullscreen windows
        WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
        exclusionMode: ExclusionMode.Ignore

        color: "transparent"
        visible: true

        // An empty region is total click-through. The orb is a light, not a
        // button: nothing it draws should ever swallow a click meant for the
        // window underneath.
        mask: Region {}

        anchors {
            top: true
            right: true
        }
        // The orb is vertically centred in the panel, so the panel starts
        // exactly vpad above where the orb's top edge should be.
        margins.top: Math.max(0, root.orbTop - root.vpad)

        // Wide enough for the droplet at full travel plus its stretch; tall
        // enough for the orb and its wobble. No taller -- a panel sized to
        // the whole corner would have the compositor blurring a region eight
        // times larger than anything ever drawn in it.
        implicitWidth: root.orbSize * 2 + 60
        implicitHeight: root.orbSize + root.vpad * 2

        Orb {
            id: orb
            anchors.fill: parent
            orbRadius: root.orbSize / 2
            plainBody: root.plainBody
        }

        Socket {
            id: link
            path: root.socketPath
            connected: root.socketPath.length > 0

            parser: SplitParser {
                onRead: line => orb.handle(line)
            }

            onConnectionStateChanged: {
                if (!connected && root.socketPath.length > 0) {
                    // The daemon restarts more often than this process does
                    // (a code change, a `systemctl restart`). Reconnecting
                    // rather than exiting means the orb survives that.
                    orb.reset();
                    reconnect.start();
                }
            }
        }

        Timer {
            id: reconnect
            interval: 1000
            repeat: false
            onTriggered: link.connected = true
        }
    }
}

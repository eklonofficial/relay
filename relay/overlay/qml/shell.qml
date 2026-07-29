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
    readonly property int topMargin: parseInt(Quickshell.env("RELAY_ORB_TOP_MARGIN") || "120")
    readonly property string socketPath: Quickshell.env("RELAY_ORB_SOCKET") || ""
    readonly property bool plainBody: (Quickshell.env("RELAY_ORB_MATERIAL") || "shader") === "hyprglass"

    // Room around the orb for the neck while it is still attached, the
    // wobble, and the soft edge. Kept small: this is the surface the
    // compositor composites and blurs behind every frame.
    readonly property int pad: 96

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
        margins.top: root.topMargin

        implicitWidth: root.orbSize * 2 + root.pad
        implicitHeight: root.orbSize * 2 + root.pad

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

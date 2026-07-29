"""The orb — Relay's on-screen presence.

A glass bubble that pulls out of the right bezel when Relay wakes, ripples
while you talk, turns over while it thinks, and pulses while it speaks.

Three pieces, deliberately separate:

  * `bus`     — broadcasts what Relay is doing over a unix socket
  * `state`   — decides which state each moment belongs to
  * `process` — supervises the Quickshell instance that draws it

Nothing here is load-bearing. Every entry point is null-guarded at the call
site, every emit swallows its own exceptions, and with `[overlay] enabled =
false` none of it is constructed at all. An assistant that stops listening
because a decoration crashed would be a bad trade.
"""

from relay.overlay.bus import OverlayBus
from relay.overlay.state import STATES, OverlayState

__all__ = ["OverlayBus", "OverlayState", "STATES"]

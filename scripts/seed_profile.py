#!/usr/bin/env python
"""Seed what Relay knows about Andrew.

Everything here was stated directly, so it goes in at confidence 100 with
`source='explicit'`. Re-runnable: an existing identity memory with the same
content is left alone rather than duplicated.

The `pinned` flag is the interesting decision. Pinned memories render into the
system prompt on **every turn**; everything else is found with `memory_search`
when it happens to be relevant. The whole profile is a few hundred tokens, and
paying that per turn is precisely the context stuffing the memory system
exists to avoid -- so only the handful of things that shape most answers are
pinned:

  * his name, because being addressed correctly matters constantly
  * where he studies, because it dates everything else
  * Vice, because it is the project most likely to come up
  * which machines exist, because "my laptop" has to resolve to something

The rest -- universities, Blender, tennis, the dog -- is retrieved on demand.

    .venv/bin/python scripts/seed_profile.py [--dry-run]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from relay.memory.store import MemoryStore  # noqa: E402
from relay.paths import PATHS  # noqa: E402

# (content, scope, pinned)
PROFILE: list[tuple[str, str, bool]] = [
    # --- always in context -------------------------------------------------
    ("The user is Andrew Marin.", "global", True),
    ("Andrew is a junior at Seven Lakes High School in Katy ISD, Texas.",
     "global", True),
    ("Andrew maintains Vice, an open-source Linux game clip recorder, "
     "distributed on the AUR as vice-clipper.", "project:vice", True),
    ("Andrew is a dual Canadian-American citizen who grew up in Calgary and "
     "Toronto before moving to Texas for high school.", "global", True),
    ("Andrew's machines: this desktop (THECHUNK, RTX 4060), a secondary Ryzen "
     "5 7600X with a GTX 1650, and an M1 MacBook Air running Asahi Fedora "
     "Remix with GNOME.", "global", True),

    # --- retrieved on demand ----------------------------------------------
    ("Andrew is targeting top CS, AI and engineering programs: University of "
     "Toronto, University of Waterloo, UT Austin, Carnegie Mellon and MIT.",
     "global", False),
    ("Vice has over 185 stars on GitHub.", "project:vice", False),
    ("Andrew has deep Linux and Hyprland customisation experience.",
     "global", False),
    ("Andrew works in Blender, mainly VFX compositing and backrooms or "
     "poolrooms renders.", "global", False),
    ("Andrew is learning Unreal Engine 5.", "global", False),
    ("Andrew sim races with a Moza R5 wheel on a Next Level Racing F-GT Lite "
     "rig.", "global", False),
    ("Andrew plays competitive tennis.", "global", False),
    ("Andrew is a speedcuber, sub-14 seconds on 3x3 using CFOP.",
     "global", False),
    ("Andrew plays piano, B-flat clarinet, tenor saxophone and drums, and is "
     "learning ukulele.", "global", False),
    ("Andrew has a senior German Shepherd named Drake.", "global", False),
    ("Andrew is 5 foot 7.", "global", False),
]


def seed(store: MemoryStore, *, dry_run: bool = False) -> tuple[int, int]:
    existing = {m.content for m in store.profile()}
    written = skipped = 0

    for content, scope, pinned in PROFILE:
        if content in existing:
            skipped += 1
            continue
        marker = "pinned" if pinned else "      "
        print(f"  [{marker}] {scope:14} {content[:64]}")
        if not dry_run:
            store.write(content, scope=scope, kind="identity",
                        source="explicit", pinned=pinned)
        written += 1

    return written, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="show what would be written and stop")
    args = parser.parse_args()

    store = MemoryStore(PATHS.db).connect()
    try:
        written, skipped = seed(store, dry_run=args.dry_run)
    finally:
        store.close()

    verb = "would write" if args.dry_run else "wrote"
    print(f"\n{verb} {written}, skipped {skipped} already present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

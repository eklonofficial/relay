#!/usr/bin/env python
"""Check the microphone, wake word and VAD without running the whole daemon.

    uv run python scripts/check_audio.py --devices
    uv run python scripts/check_audio.py --listen 15

The listen mode prints a live meter: input level, voice activity, and the
wake-word score. Say the wake word and watch the score spike — that's the
fastest way to find a sensible threshold for your mic and room.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from relay import config  # noqa: E402
from relay.audio.capture import Microphone, list_input_devices, rms  # noqa: E402
from relay.audio.listener import VoiceActivity, WakeWordDetector, _device_index  # noqa: E402


def show_devices() -> None:
    cfg = config.load()
    resolved = _device_index(cfg.audio.input_device)
    print("Input devices:")
    for device in list_input_devices():
        marker = " <- selected" if device["index"] == resolved else ""
        print(f"  [{device['index']:>2}] {device['name'][:48]:50} "
              f"{device['channels']}ch {device['sample_rate']}Hz{marker}")
    print(f"\nconfig audio.input_device = {cfg.audio.input_device}")
    print(f"resolved to sounddevice index: {resolved if resolved is not None else 'default'}")


async def listen(seconds: float) -> int:
    cfg = config.load()
    detector = WakeWordDetector(cfg.audio.wake_word, cfg.audio.wake_threshold)
    vad = VoiceActivity()
    print(f"loading models (wake word: {cfg.audio.wake_word})...")
    await asyncio.gather(asyncio.to_thread(detector.load), asyncio.to_thread(vad.load))

    microphone = Microphone(device=_device_index(cfg.audio.input_device))
    microphone.start()
    print(f"\nListening for {seconds:.0f}s — say the wake word.\n")
    print(f"  {'level':>7}  {'voice':>5}  {'wake':>6}   {'meter':<32}")

    deadline = time.time() + seconds
    peak_score = 0.0
    detections = 0
    try:
        async for frame in microphone.frames():
            if time.time() > deadline:
                break
            level = rms(frame)
            speech = vad.is_speech(frame)
            name, score = detector.score(frame)
            peak_score = max(peak_score, score)
            if name:
                detections += 1
                print(f"  {level:7.0f}  {'yes' if speech else '  -':>5}  {score:6.3f}   "
                      f"<-- WAKE WORD '{name}'")
                detector.reset()
                continue
            bars = min(32, int(level / 30))
            print(f"  {level:7.0f}  {'yes' if speech else '  -':>5}  {score:6.3f}   "
                  f"{'#' * bars:<32}", end="\r")
    finally:
        microphone.stop()

    print("\n")
    print(f"peak wake-word score : {peak_score:.3f}")
    print(f"detections           : {detections}")
    print(f"dropped frames       : {microphone.dropped_frames}")
    if detections == 0:
        print(f"\nNo detection. Current threshold is {cfg.audio.wake_threshold}; "
              f"the peak seen was {peak_score:.3f}.")
        if peak_score > 0.2:
            print("Close — try lowering audio.wake_threshold a little.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--devices", action="store_true", help="list input devices and exit")
    parser.add_argument("--listen", type=float, metavar="SECONDS", default=0)
    args = parser.parse_args()

    if args.devices or not args.listen:
        show_devices()
        if not args.listen:
            return 0
    return asyncio.run(listen(args.listen))


if __name__ == "__main__":
    raise SystemExit(main())

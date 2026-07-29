"""Does the echo canceller actually subtract the speakers?

Plays speech-band noise through the default sink while recording the raw
microphone and the cancelled one at the same time, then compares the energy
in each. Only the second half is measured: an adaptive filter needs a few
seconds to converge, and judging it before that measures nothing.
"""
import subprocess
import sys
import time
import wave

import numpy as np

import tempfile
HERE = tempfile.mkdtemp(prefix="relay-aec-")
RAW = "alsa_input.usb-3142_fifine_Microphone-00.analog-stereo"
AEC = "relay_mic"
SECONDS = 10


def make_tone(path):
    """Speech-band noise: what a voice assistant actually has to cancel."""
    sr = 48000
    n = sr * SECONDS
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 0.25, n)
    # Bandpass it roughly into 300-3000Hz by smoothing then removing DC.
    k = np.ones(12) / 12
    noise = np.convolve(noise, k, mode="same")
    noise = noise - np.convolve(noise, np.ones(160) / 160, mode="same")
    noise = noise / (np.abs(noise).max() or 1) * 0.7
    data = (noise * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data.tobytes())


def rms_tail(path, fraction=0.5):
    with wave.open(path, "rb") as w:
        frames = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        ch = w.getnchannels()
    if frames.size == 0:
        return 0.0
    if ch > 1:
        frames = frames.reshape(-1, ch)[:, 0]
    tail = frames[int(len(frames) * (1 - fraction)):].astype(np.float32)
    return float(np.sqrt((tail ** 2).mean()))


tone = f"{HERE}/tone.wav"
make_tone(tone)

recorders = [
    subprocess.Popen(["pw-record", "--target", RAW, f"{HERE}/rec_raw.wav"]),
    subprocess.Popen(["pw-record", "--target", AEC, f"{HERE}/rec_aec.wav"]),
]
time.sleep(1.0)
player = subprocess.Popen(["pw-play", tone])
player.wait()
time.sleep(0.4)
for p in recorders:
    p.terminate()
    p.wait()

raw = rms_tail(f"{HERE}/rec_raw.wav")
aec = rms_tail(f"{HERE}/rec_aec.wav")
print(f"raw mic RMS      : {raw:8.1f}")
print(f"cancelled RMS    : {aec:8.1f}")
if raw > 0 and aec > 0:
    db = 20 * np.log10(aec / raw)
    print(f"suppression      : {db:+.1f} dB")
    print(f"energy remaining : {100 * aec / raw:.1f}%")
if raw < 60:
    print("\nNOTE: the raw mic barely heard the playback at all, so there was "
          "nothing to cancel. Headphones, or the speakers are muted.",
          file=sys.stderr)

#!/usr/bin/env python
"""Train a custom wake word, entirely offline.

    uv run python scripts/train_wakeword.py --word Relay

openWakeWord models are small classifiers sitting on a shared, frozen feature
stack (melspectrogram -> 96-dim embeddings, 16 frames of context). Only the
classifier needs training, which is why this runs in a couple of minutes on a
CPU instead of needing the full training pipeline and its torch/speechbrain
extras.

Training data is synthesised locally with Kokoro's 54 voices, so no dataset
download and no upload of your voice to a web trainer.

The negatives matter more than the positives. A model trained only against
random speech happily fires on "delay", "replay" and "relate", so those are
generated explicitly as hard negatives.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SAMPLE_RATE = 16_000
CLIP_SECONDS = 2.0
CLIP_SAMPLES = int(SAMPLE_RATE * CLIP_SECONDS)

# Rhyme-alikes and near-misses. Without these the classifier learns "starts
# with r, two syllables" and fires constantly in normal conversation.
HARD_NEGATIVE_TEMPLATE = [
    "delay", "replay", "relate", "related", "relay race", "rely",
    "reload", "release", "relax", "railway", "we lay", "the lake",
    "belay", "melee", "her way", "already", "radio", "relative",
]

# Deliberately held back from the hard-negative set. Parakeet transcribed one
# of the real "Relay" recordings as "Really", so this speaker's pronunciation
# sits close to it. Training hard against these would cost real recall on the
# actual wake word, so they are included sparingly rather than not at all.
RISKY_NEGATIVES = ["really", "real", "ready"]

# Ordinary speech, so the model learns what "not the wake word" sounds like.
GENERAL_NEGATIVES = [
    "open discord", "what time is it", "close this window", "move it to workspace two",
    "can you find the file", "play some music", "turn the volume down",
    "how much space is left", "switch to the browser", "that's all thanks",
    "hello there", "no thank you", "let me think about it", "the weather is nice",
    "I need to finish this first", "send it over when you can",
    "put that on the second screen", "what did we decide yesterday",
]


def build_kokoro():
    import espeakng_loader
    from kokoro_onnx import Kokoro

    from relay.paths import PATHS

    espeakng_loader.make_library_available()
    return Kokoro(str(PATHS.models / "kokoro-v1.0.onnx"),
                  str(PATHS.models / "voices-v1.0.bin"))


def synthesise(kokoro, text: str, voice: str, speed: float) -> np.ndarray:
    from scipy.signal import resample_poly

    audio, sr = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
    audio = np.asarray(audio, dtype=np.float32)
    if sr != SAMPLE_RATE:
        audio = resample_poly(audio, SAMPLE_RATE, sr)
    peak = float(np.abs(audio).max() or 1.0)
    return (audio / peak).astype(np.float32)


def place_in_clip(word: np.ndarray, rng, *, noise_db: float | None = None) -> np.ndarray:
    """Drop a word into a fixed-length clip at a random offset.

    The wake word arrives at an arbitrary point in the audio stream, so the
    classifier must not learn that it always starts at sample zero.
    """
    clip = np.zeros(CLIP_SAMPLES, dtype=np.float32)
    word = word[:CLIP_SAMPLES]
    # Bias towards the end: detection fires on the frame where the word
    # completes, so that is what the 16-frame window usually contains.
    latest = CLIP_SAMPLES - len(word)
    offset = int(rng.uniform(max(0, latest * 0.35), max(1, latest))) if latest > 0 else 0
    clip[offset:offset + len(word)] = word

    gain = rng.uniform(0.25, 1.0)
    clip *= gain
    if noise_db is not None:
        noise = rng.normal(0, 10 ** (noise_db / 20.0), CLIP_SAMPLES).astype(np.float32)
        clip = clip + noise
    return np.clip(clip * 32767, -32768, 32767).astype(np.int16)


def load_real_samples(directory: Path) -> list[np.ndarray]:
    """Load recordings of the actual user saying the wake word."""
    import soundfile as sf
    from scipy.signal import resample_poly

    clips = []
    for path in sorted(directory.glob("*.wav")):
        audio, sr = sf.read(path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        if sr != SAMPLE_RATE:
            from math import gcd

            divisor = gcd(sr, SAMPLE_RATE)
            audio = resample_poly(audio, SAMPLE_RATE // divisor, sr // divisor)
        peak = float(np.abs(audio).max() or 1.0)
        clips.append((audio / peak).astype(np.float32))
    return clips


def augment_real(clip: np.ndarray, rng, count: int) -> list[np.ndarray]:
    """Turn a handful of real recordings into a usable training set.

    Six samples is far too few on their own, so each is varied by speed,
    gain, position and noise. These carry much more weight than the
    synthetic voices: they are the only examples of the actual speaker.
    """
    from scipy.signal import resample_poly

    out = []
    for _ in range(count):
        varied = clip
        # Mild time-stretch, standing in for natural variation in delivery.
        rate = rng.uniform(0.9, 1.12)
        if abs(rate - 1.0) > 0.02:
            up, down = 1000, int(1000 * rate)
            varied = resample_poly(varied, up, down).astype(np.float32)
        out.append(place_in_clip(varied, rng, noise_db=rng.uniform(-60, -28)))
    return out


def generate_dataset(word: str, *, voices_limit: int, rng) -> tuple[list, list]:
    kokoro = build_kokoro()
    voices = sorted(kokoro.get_voices())[:voices_limit]
    print(f"synthesising with {len(voices)} voices")

    positives, negatives = [], []
    speeds = (0.85, 1.0, 1.15)

    # --- positives: the word alone, and inside a natural phrase ----------
    variants = [word, f"{word},", f"{word}?", f"hey {word}", f"{word} please"]
    for voice in voices:
        for speed in speeds:
            text = variants[rng.integers(len(variants))]
            try:
                audio = synthesise(kokoro, text, voice, speed)
            except Exception:
                continue
            for _ in range(2):
                positives.append(place_in_clip(audio, rng,
                                               noise_db=rng.uniform(-60, -34)))

    # --- hard negatives: near-misses --------------------------------------
    for phrase in HARD_NEGATIVE_TEMPLATE:
        for voice in voices[::2]:
            speed = speeds[rng.integers(len(speeds))]
            try:
                audio = synthesise(kokoro, phrase, voice, speed)
            except Exception:
                continue
            negatives.append(place_in_clip(audio, rng, noise_db=rng.uniform(-60, -34)))

    # --- risky near-misses, deliberately few -------------------------------
    for phrase in RISKY_NEGATIVES:
        for voice in voices[::6]:
            try:
                audio = synthesise(kokoro, phrase, voice, 1.0)
            except Exception:
                continue
            negatives.append(place_in_clip(audio, rng, noise_db=rng.uniform(-60, -34)))

    # --- general speech ----------------------------------------------------
    for phrase in GENERAL_NEGATIVES:
        for voice in voices[::2]:
            try:
                audio = synthesise(kokoro, phrase, voice, 1.0)
            except Exception:
                continue
            negatives.append(place_in_clip(audio, rng, noise_db=rng.uniform(-60, -34)))

    # --- silence and noise, so a quiet room never triggers -----------------
    for _ in range(len(positives) // 3):
        level = rng.uniform(-70, -30)
        noise = rng.normal(0, 10 ** (level / 20.0), CLIP_SAMPLES).astype(np.float32)
        negatives.append(np.clip(noise * 32767, -32768, 32767).astype(np.int16))

    return positives, negatives


def extract_features(clips: list[np.ndarray]) -> np.ndarray:
    from openwakeword.utils import AudioFeatures

    features = AudioFeatures(inference_framework="onnx")
    out = []
    for clip in clips:
        features.__call__(clip)
        out.append(np.array(features.get_features(16))[0])
        features.reset()
    return np.stack(out).astype(np.float32)


def train(x: np.ndarray, y: np.ndarray, *, epochs: int, seed: int):
    try:
        import torch
        import torch.nn as nn
    except ImportError as exc:      # noqa: F841
        raise SystemExit(
            "Training the wake word needs PyTorch, which Relay no longer\n"
            "installs -- it was only ever here for the GPU voice, and torch\n"
            "plus CUDA is about four gigabytes to keep resident for a script\n"
            "that runs once.\n\n"
            "    uv pip install torch\n\n"
            "Then run this again. Uninstall it afterwards if you like; the\n"
            "trained relay.onnx is all Relay needs at runtime."
        ) from None

    torch.manual_seed(seed)
    model = nn.Sequential(
        nn.Flatten(),
        nn.Linear(16 * 96, 128), nn.ReLU(), nn.Dropout(0.2),
        nn.Linear(128, 64), nn.ReLU(),
        nn.Linear(64, 1),
    )

    indices = np.random.default_rng(seed).permutation(len(x))
    split = int(len(x) * 0.85)
    train_idx, val_idx = indices[:split], indices[split:]

    xt = torch.from_numpy(x[train_idx])
    yt = torch.from_numpy(y[train_idx]).float().unsqueeze(1)
    xv = torch.from_numpy(x[val_idx])
    yv = torch.from_numpy(y[val_idx]).float().unsqueeze(1)

    # Positives are outnumbered; without this the model can score well by
    # simply never firing.
    positive_weight = float((y[train_idx] == 0).sum() / max(1, (y[train_idx] == 1).sum()))
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([positive_weight]))
    optimiser = torch.optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)

    best_state, best_score = None, -1.0
    for epoch in range(epochs):
        model.train()
        order = torch.randperm(len(xt))
        for start in range(0, len(xt), 64):
            batch = order[start:start + 64]
            optimiser.zero_grad()
            loss = loss_fn(model(xt[batch]), yt[batch])
            loss.backward()
            optimiser.step()

        model.eval()
        with torch.no_grad():
            probs = torch.sigmoid(model(xv)).numpy().ravel()
        truth = yv.numpy().ravel()
        predicted = probs >= 0.5
        true_positive = float(((predicted == 1) & (truth == 1)).sum())
        false_positive = float(((predicted == 1) & (truth == 0)).sum())
        false_negative = float(((predicted == 0) & (truth == 1)).sum())
        recall = true_positive / max(1e-9, true_positive + false_negative)
        precision = true_positive / max(1e-9, true_positive + false_positive)
        f1 = 2 * precision * recall / max(1e-9, precision + recall)
        if f1 > best_score:
            best_score = f1
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        if (epoch + 1) % 10 == 0:
            print(f"  epoch {epoch+1:>3}  precision {precision:.3f}  "
                  f"recall {recall:.3f}  f1 {f1:.3f}")

    model.load_state_dict(best_state)
    print(f"best validation f1: {best_score:.3f}")
    return model


def export_onnx(model, path: Path) -> None:
    """Export with the signature openWakeWord expects: [1,16,96] -> [1,1]."""
    try:
        import torch
        import torch.nn as nn
    except ImportError as exc:      # noqa: F841
        raise SystemExit(
            "Training the wake word needs PyTorch, which Relay no longer\n"
            "installs -- it was only ever here for the GPU voice, and torch\n"
            "plus CUDA is about four gigabytes to keep resident for a script\n"
            "that runs once.\n\n"
            "    uv pip install torch\n\n"
            "Then run this again. Uninstall it afterwards if you like; the\n"
            "trained relay.onnx is all Relay needs at runtime."
        ) from None

    class WithSigmoid(nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner
            # openWakeWord reads the output as a probability, so the sigmoid
            # has to be inside the graph rather than applied by the caller.
            self.act = nn.Sigmoid()

        def forward(self, x):
            return self.act(self.inner(x))

    wrapped = WithSigmoid(model).eval()
    dummy = torch.zeros(1, 16, 96)
    path.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        wrapped, dummy, str(path),
        input_names=["x"], output_names=["y"],
        dynamic_axes=None, opset_version=17,
    )
    print(f"wrote {path} ({path.stat().st_size/1024:.0f} KB)")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--word", default="Relay")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--voices", type=int, default=54)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--real", type=Path, default=None,
                        help="directory of .wav recordings of you saying the word")
    parser.add_argument("--real-copies", type=int, default=60,
                        help="augmented variants generated per real recording")
    args = parser.parse_args()

    from relay.paths import PATHS

    out = args.out or (PATHS.models / f"{args.word.lower()}.onnx")
    rng = np.random.default_rng(args.seed)

    started = time.time()
    print(f"=== generating training audio for {args.word!r} ===")
    positives, negatives = generate_dataset(args.word, voices_limit=args.voices, rng=rng)
    synthetic_count = len(positives)

    real_dir = args.real or (PATHS.data / "voice-samples" / "wake")
    if real_dir.is_dir():
        real = load_real_samples(real_dir)
        for clip in real:
            positives.extend(augment_real(clip, rng, args.real_copies))
        print(f"added {len(real)} real recordings -> "
              f"{len(positives)-synthetic_count} augmented positives")
    else:
        print(f"no real recordings in {real_dir}; synthetic only "
              f"(accuracy on your voice will be worse)")

    print(f"positives {len(positives)} ({synthetic_count} synthetic), "
          f"negatives {len(negatives)} ({time.time()-started:.0f}s)")

    print("=== extracting features ===")
    x = extract_features(positives + negatives)
    y = np.concatenate([np.ones(len(positives)), np.zeros(len(negatives))]).astype(np.float32)
    print(f"feature matrix {x.shape}")

    print("=== training ===")
    model = train(x, y, epochs=args.epochs, seed=args.seed)

    print("=== exporting ===")
    export_onnx(model, out)
    print(f"\nDone in {time.time()-started:.0f}s.")
    print(f"Point Relay at it:  audio.wake_word = \"{out}\"  in ~/.config/relay/config.toml")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

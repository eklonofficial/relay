#!/usr/bin/env python3
"""Builds assets/sounds/*.mp3 from licensed source recordings (see assets/sounds/SOURCES.md).

Every effect is cut, layered and processed here so the result is reproducible:
  python3 docs/games/shockshellers/tools/sounds.py <source dir>
where <source dir> holds the unpacked libraries listed in SOURCES.md. Needs ffmpeg and numpy.
"""
import os, subprocess, sys
import numpy as np

SR = 48000
SRC = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'sounds')
os.makedirs(OUT, exist_ok=True)
FF = os.path.join(SRC, 'Prepared SFX Library')
K = lambda pack, name: os.path.join(SRC, f'kenney_{pack}', 'Audio', name)
CHICKEN = os.path.join(SRC, 'chicken', 'Chicken Sound Effect.ogg')

def load(path, speed=1.0):
    """Decode to mono float at SR (speed < 1 lowers pitch and slows, like tape)."""
    rate = int(SR / speed)
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(rate), '-f', 'f32le', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)

def onset(x, frac=0.2, start=0):
    peak = np.max(np.abs(x[start:])) or 1
    i = start + int(np.argmax(np.abs(x[start:]) > peak * frac))
    return max(0, i - int(0.003 * SR))

def cut(x, start, dur):
    return x[start:start + int(dur * SR)].copy()

def fade(x, out=0.35, shape=2.5, fin=0.002):
    n = len(x); fo = int(n * out); fi = int(fin * SR)
    if fo: x[-fo:] *= np.linspace(1, 0, fo) ** shape
    if fi: x[:fi] *= np.linspace(0, 1, fi)
    return x

def lowpass(x, hz):
    # One-pole low-pass run forward and backward (zero phase).
    a = np.exp(-2 * np.pi * hz / SR)
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x): acc = (1 - a) * v + a * acc; y[i] = acc
    acc = 0.0
    for i in range(len(y) - 1, -1, -1): acc = (1 - a) * y[i] + a * acc; y[i] = acc
    return y

def highpass(x, hz): return x - lowpass(x, hz)

def thump(dur, f0, f1, level):
    """A pitched-down sine kick: the cartoon punch under each shot."""
    t = np.arange(int(dur * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 30)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 12) * level

def noise(dur, seed=1): return np.random.default_rng(seed).uniform(-1, 1, int(dur * SR))

def mix(*parts):
    n = max(int(off * SR) + len(p) for p, off in parts)
    y = np.zeros(n)
    for p, off in parts: o = int(off * SR); y[o:o + len(p)] += p
    return y

def master(x, gain=1.0, drive=1.4, peak=0.89):
    x = highpass(x, 40) * gain
    x = np.tanh(x * drive) / np.tanh(drive)          # gentle saturation: weight without clipping
    m = np.max(np.abs(x)) or 1
    return x / m * peak

def save(name, x, rate=SR):
    path = os.path.join(OUT, name + '.mp3')
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(rate), '-ac', '1', '-i', '-', '-codec:a', 'libmp3lame', '-b:a', '112k', path], input=pcm, check=True)
    print(f'{name}: {len(x) / SR:.2f}s, {os.path.getsize(path) // 1024} KB')

def shot(file, dur, body=(140, 55, 0.35), out=0.55, gain=1.0, start_frac=0.2):
    x = load(os.path.join(FF, file))
    s = onset(x, start_frac)
    y = fade(cut(x, s, dur), out)
    if body: y = mix((y, 0), (thump(min(dur, 0.25), *body) * np.max(np.abs(y)), 0))
    return master(y, gain)

# ---------------- weapons ----------------
save('yolk47', shot('AK-47/C_28P.wav', 0.55, (150, 55, 0.4)))
save('beater', shot('PPSh/P_30P.wav', 0.32, (190, 70, 0.3), out=0.6))
save('triBoil', shot('AR-15/D_32P.wav', 0.5, (160, 60, 0.35)))
save('cageFree', shot('SKS/U_14P.wav', 0.75, (120, 45, 0.45)))
save('poacher', shot('Mosin Nagant/M_21P.wav', 1.2, (100, 38, 0.55), out=0.7))
save('doubleYolker', shot('Nova/O_21P.wav', 0.95, (90, 35, 0.6), out=0.65))
save('peck9mm', shot('Walther PPQ/X_39P.wav', 0.4, (200, 70, 0.3)))
# Yolkzooka launch: a deep recoil pop under a rising whoosh.
pop = shot('1917/B_24P.wav', 0.5, (70, 30, 0.7))
whoosh = noise(0.9, 3); t = np.arange(len(whoosh)) / SR
whoosh = lowpass(whoosh, 2400) * (1 - np.exp(-t * 18)) * np.exp(-t * 3.2) * 0.9
save('yolkzooka', master(mix((pop * 0.8, 0), (whoosh, 0.02))))

# ---------------- explosions ----------------
def boom(seed, speed=0.38):
    blast = load(os.path.join(FF, 'Nova/O_21P.wav'), speed)
    s = onset(blast); b = fade(cut(blast, s, 2.2), 0.8, 2)
    rumble = lowpass(noise(2.4, seed), 220); t = np.arange(len(rumble)) / SR
    rumble *= np.exp(-t * 2.2) * 3
    return master(mix((b, 0), (rumble, 0.01), (thump(0.8, 70, 28, 1.0), 0)), drive=2.0)
save('explode', boom(5))
dud = load(K('impact-sounds', 'impactSoft_heavy_001.ogg'))
save('dud', master(mix((fade(cut(dud, onset(dud), 0.4)), 0), (lowpass(noise(0.5, 9), 900) * np.exp(-np.arange(int(0.5 * SR)) / SR * 6) * 0.5, 0.02))))

# ---------------- eggs ----------------
def crack(seed, big):
    g = load(K('impact-sounds', f'impactGlass_{"medium" if big else "light"}_00{seed}.ogg'), 1.25)
    w = load(K('impact-sounds', f'impactWood_light_00{seed}.ogg'), 1.4)
    g = fade(cut(g, onset(g), 0.35)); w = fade(cut(w, onset(w), 0.2))
    return master(mix((g, 0), (w * 0.8, 0)), drive=1.2)
for i in range(3): save(f'crack{i}', crack(i, False))
save('crackBig', crack(1, True))
soft = load(K('impact-sounds', 'impactSoft_heavy_002.ogg'), 0.8)
punch = load(K('impact-sounds', 'impactPunch_heavy_001.ogg'), 0.9)
glass = load(K('impact-sounds', 'impactGlass_medium_002.ogg'), 1.1)
wet = lowpass(noise(0.45, 4), 1400) * np.exp(-np.arange(int(0.45 * SR)) / SR * 9) * 0.6
save('splat', master(mix((fade(cut(glass, onset(glass), 0.4)) * 0.7, 0), (fade(cut(soft, onset(soft), 0.45)), 0.01), (fade(cut(punch, onset(punch), 0.3)) * 0.6, 0), (wet, 0.02))))

# ---------------- hands ----------------
def clip(file, dur, speed=1.0, gain=1.0):
    x = load(file, speed); return master(fade(cut(x, onset(x), dur)), gain, 1.1)
click = load(K('rpg-audio', 'metalClick.ogg')); latch = load(K('rpg-audio', 'metalLatch.ogg'))
belt = load(K('rpg-audio', 'beltHandle1.ogg')); belt2 = load(K('rpg-audio', 'beltHandle2.ogg'))
c1 = fade(cut(click, onset(click), 0.15)); l1 = fade(cut(latch, onset(latch), 0.3)); b1 = fade(cut(belt, onset(belt), 0.3)); b2 = fade(cut(belt2, onset(belt2), 0.3))
# Reloads are two sounds the game times to the real reload: the magazine out at the start, and the
# magazine in (plus a bolt/slap on an empty-gun reload) when it completes.
save('reload', master(b1 * 0.7, drive=1.1, peak=0.8))
save('reloaded', master(c1, drive=1.1, peak=0.8))
save('reloadedLong', master(mix((c1, 0), (l1, 0.18)), drive=1.1, peak=0.8))
save('bolt', master(mix((l1, 0), (c1 * 0.8, 0.22)), drive=1.1))
save('dry', clip(K('interface-sounds', 'tick_002.ogg'), 0.12, 0.8))
cloth = load(K('rpg-audio', 'cloth2.ogg'))
save('swap', master(mix((fade(cut(cloth, onset(cloth), 0.3)) * 0.6, 0), (b2 * 0.8, 0.12)), drive=1.1))
save('melee', clip(K('rpg-audio', 'knifeSlice.ogg'), 0.35, 0.85))
save('throw', clip(K('rpg-audio', 'cloth4.ogg'), 0.35, 1.2))
for i in range(2): save(f'bounce{i}', clip(K('impact-sounds', f'impactMetal_light_00{i}.ogg'), 0.25, 1.3, 0.8))
save('ammo', master(mix((b2, 0), (c1 * 0.6, 0.08)), drive=1.1))
save('pickupNade', clip(K('impact-sounds', 'impactMetal_medium_001.ogg'), 0.3, 1.4))
for i in range(4): save(f'step{i}', clip(K('impact-sounds', f'footstep_concrete_00{i}.ogg'), 0.25, 1.15, 0.6))
save('land', clip(K('impact-sounds', 'impactSoft_medium_001.ogg'), 0.3, 0.9))
save('jump', clip(K('rpg-audio', 'cloth1.ogg'), 0.2, 1.3, 0.5))
save('hitmark', clip(K('interface-sounds', 'click_002.ogg'), 0.08, 1.2, 0.7))

# ---------------- chickens ----------------
ch = load(CHICKEN)
env = np.abs(ch); hop = int(0.01 * SR)
level = np.array([env[i:i + hop].mean() for i in range(0, len(env) - hop, hop)])
thr = np.percentile(level, 70); segs = []; on = None
for i, v in enumerate(level):
    if v > thr and on is None: on = i
    if v <= thr * 0.8 and on is not None:
        if i - on >= 3: segs.append((on * hop, i * hop))
        on = None
print('chicken syllables:', len(segs))
segs.sort(key=lambda s: -np.abs(ch[s[0]:s[1]]).max())
clucks = [fade(ch[max(0, a - 400):b + 2400].copy(), 0.4) for a, b in segs[:6]]
for i, c in enumerate(clucks[:4]): save(f'cluck{i}', master(c, 0.9, 1.1))
loud = clucks[0]
save('bawk', master(np.concatenate([loud, np.zeros(int(0.05 * SR)), clucks[1] if len(clucks) > 1 else loud]), 1, 1.3))
save('squawk', master(load(CHICKEN, 1.15)[segs[0][0]:segs[0][1] + 3000], 1, 1.6))

# ---------------- interface ----------------
save('click', clip(K('interface-sounds', 'click_001.ogg'), 0.15))
save('pop', clip(K('interface-sounds', 'select_002.ogg'), 0.2))
save('powerup', clip(K('interface-sounds', 'confirmation_002.ogg'), 0.8))
save('powerdown', clip(K('interface-sounds', 'minimize_006.ogg'), 0.6))
save('challenge', clip(K('interface-sounds', 'confirmation_004.ogg'), 0.9))
save('respawn', clip(K('interface-sounds', 'maximize_003.ogg'), 0.5))
save('shield', clip(K('interface-sounds', 'glass_002.ogg'), 0.5))
save('zone', clip(K('interface-sounds', 'bong_001.ogg'), 1.0))
save('alarm', clip(K('interface-sounds', 'error_006.ogg'), 0.6))
save('score', clip(K('interface-sounds', 'confirmation_001.ogg'), 0.8))
save('drop', clip(K('interface-sounds', 'drop_002.ogg'), 0.5))
print('done')

// Sound (GDD §24): positional 3D audio for world sounds, one SFX volume for everything. Recorded
// samples (assets/sounds, decoded from the bundle) are used where present; anything without a sample
// is synthesised, so the game is never silent. `ctx` is what quick-hide suspends and resumes.
//
// The mix: every world sound is filtered by distance (far shots lose their top end) and muffled when
// a wall stands between it and you; gunfire and explosions also feed a convolution reverb whose size
// follows the map (a tight barn, an open quarry). Each map has a quiet synthesised bed (wind and birds,
// crickets, the hum of space). A blast close by, or your own death, briefly dulls everything.
import { fetchAsset } from '../util/asset.js?v=muzthczg';

const SAMPLE_URLS = {}; // name → URL, filled by registerSamples() from the sound bank module
// How much of each sound goes to the reverb.
const SEND = { explode: 0.55, yolkzooka: 0.45, poacher: 0.45, cageFree: 0.38, doubleYolker: 0.38, yolk47: 0.3, triBoil: 0.3, beater: 0.26, peck9mm: 0.26, crackBig: 0.25, splat: 0.2, squawk: 0.25, bounce: 0.15, melee: 0.15, step: 0.08, land: 0.1 };
// Voice budget and what gives way first; what earns HRTF panning when close.
const VOICES = 24, MINOR = new Set(['step', 'bounce', 'land', 'jump', 'impact', 'mech', 'whiz', 'dust']);
const LOUD = new Set(['yolk47', 'beater', 'triBoil', 'peck9mm', 'cageFree', 'poacher', 'doubleYolker', 'yolkzooka', 'explode', 'whiz', 'crackBig', 'squawk']);
// Samples decoded only when first needed (many gun skins have their own shot).
const ON_DEMAND = /^skin_/;
const UI = new Set(['uiHover', 'uiClick', 'pop', 'click', 'challenge', 'hitmark', 'hitBody', 'killConfirm', 'heartbeat', 'death', 'lowAmmo']);

export class Sound {
  constructor(settings) { this.settings = settings; this.ctx = null; this.buffers = new Map(); this.decoding = new Map(); this.loops = new Map(); this.lx = 0; this.ly = 0; this.lz = 0; this.occluded = null; this.ambient = []; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new AudioContext({ latencyHint: 'interactive' }); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.connect(this.master);
    // The muffle: a low-pass over the whole game mix (not the interface), opened wide normally.
    this.muffle = c.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5; this.muffle.connect(this.comp);
    this.bus = c.createGain(); this.bus.connect(this.muffle);
    this.ui = c.createGain(); this.ui.connect(this.comp);
    this.wet = c.createGain(); this.wet.gain.value = 0.5; this.wet.connect(this.muffle);
    this.reverb = c.createConvolver(); this.reverb.connect(this.wet);
    this.send = c.createGain(); this.send.connect(this.reverb);
    this.amb = c.createGain(); this.amb.gain.value = 0.0; this.amb.connect(this.muffle);
    this.setRoom(1.4, 0.35);
    this.setVolume(this.settings.volume);
    const n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.variants = new Map();
    for (const [name, url] of Object.entries(SAMPLE_URLS)) {
      if (!ON_DEMAND.test(name)) this.load(name, url);
      const base = name.replace(/\d+$/, '');
      if (base !== name) { if (!this.variants.has(base)) this.variants.set(base, []); this.variants.get(base).push(name); }
    }
    if (this.pendingAmbience) this.ambience(this.pendingAmbience);
  }
  setVolume(v) { if (this.master) this.master.gain.value = (v / 100) ** 1.5 * 0.9; }
  // The reverb: a decaying stereo noise tail with a few early reflections (seconds, wet level).
  setRoom(decay, wet) {
    if (!this.ctx) return;
    const c = this.ctx, len = Math.max(0.2, decay) * c.sampleRate | 0, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) { const t = i / c.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 6.9 / decay) * (t < 0.008 ? t / 0.008 : 1); }
      for (let k = 0; k < 6; k++) { const at = (0.011 + k * 0.017 + Math.random() * 0.01) * c.sampleRate | 0; if (at < len) d[at] += (Math.random() < 0.5 ? -1 : 1) * 0.6 * Math.exp(-k * 0.5); }
    }
    this.reverb.buffer = ir; this.wet.gain.value = wet;
  }
  // Muffle everything for a moment (an explosion beside you, your own death): down to `freq`, back over `time`.
  dull(freq = 500, time = 1.2) {
    if (!this.ctx) return;
    const f = this.muffle.frequency, t = this.ctx.currentTime;
    f.cancelScheduledValues(t); f.setValueAtTime(Math.min(f.value, freq), t); f.exponentialRampToValueAtTime(20000, t + time);
  }
  async load(name, url) {
    try {
      if (!this.decoding.has(url)) this.decoding.set(url, fetchAsset(url).then(a => this.ctx.decodeAudioData(a)));
      this.buffers.set(name, await this.decoding.get(url));
    } catch { /* synthesised instead */ }
  }
  // Start decoding a sample that loads on demand (a gun skin's shot), so it is ready when needed.
  warm(name) { if (this.ctx && !this.buffers.has(name) && SAMPLE_URLS[name]) this.load(name, SAMPLE_URLS[name]); }
  listener(x, y, z, yaw) {
    this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw;
    const L = this.ctx?.listener; if (!L) return;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t); L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(fz, t); L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t); }
    else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
  }
  // An output node at a world position (or straight to the bus when pos is null: our own sounds).
  // (HRTF panning, the convincing 3D kind, convolves every voice on the audio thread; on a two-core
  // Chromebook that competes with the game, so only loud sounds close by get it.)
  out(pos, gain = 1, send = 0, ui = false, hrtf = false) {
    const c = this.ctx, g = c.createGain(); g.gain.value = gain;
    if (pos) {
      // Air and walls: far sounds lose their top end; through a wall they are dull and quieter.
      const d = Math.hypot(pos[0] - this.lx, pos[1] - this.ly, pos[2] - this.lz), blocked = this.occluded?.(pos[0], pos[1], pos[2]);
      const p = c.createPanner(); p.panningModel = hrtf && d < 12 ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.1; p.maxDistance = 120;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(blocked ? 700 : 1500, Math.min(20000, 20000 * Math.exp(-d / 28))) * (blocked ? 0.6 : 1);
      if (blocked) g.gain.value = gain * 0.6;
      place(p, pos); g.connect(lp); lp.connect(p); p.connect(this.bus); g.panner = p;
      if (send) { const s = c.createGain(); s.gain.value = send * (blocked ? 1.3 : 1); p.connect(s); s.connect(this.send); }
    } else {
      g.connect(ui ? this.ui : this.bus);
      if (send) { const s = c.createGain(); s.gain.value = send * 0.8; g.connect(s); s.connect(this.send); }
    }
    return g;
  }
  // name decides the mix (reverb, loudness, voice priority); sample, when given, is the recording to
  // play in its place (a gun skin's own shot, a reload's mechanical cue).
  play(name, pos = null, gain = 1, rate = 1, sample = name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (pos && Math.hypot(pos[0] - this.lx, pos[1] - this.ly, pos[2] - this.lz) > 90) return;
    // A busy fight can ask for dozens of sounds at once: past the voice budget, the small ones
    // (footsteps, bounces) give way.
    if (this.voices >= VOICES && MINOR.has(name)) return;
    const out = this.out(pos, gain, SEND[name] || 0, UI.has(name), LOUD.has(name));
    if (sample !== name) this.warm(sample);
    const b = this.pick(sample) || (sample !== name ? this.pick(name) : null);
    this.voices = (this.voices || 0) + 1;
    const done = () => { this.voices--; };
    if (b) { const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (0.96 + Math.random() * 0.08); s.connect(out); s.onended = done; s.start(); return; }
    (SYNTH[name] || SYNTH.pop)(this, out, rate);
    setTimeout(done, 400);
  }
  // A recorded sample for this name, choosing among numbered variants (crack0, crack1…) when there are some.
  pick(name) {
    const b = this.buffers.get(name); if (b) return b;
    const v = this.variants?.get(name); if (v?.length) return this.buffers.get(v[Math.floor(Math.random() * v.length)]);
    return null;
  }
  // Looping sound attached to an id (grenade clucks, rocket hiss): call every frame to keep it alive
  // and move it; loops not refreshed are stopped by sweepLoops().
  loop(id, name, pos) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let l = this.loops.get(id);
    if (!l) { const out = this.out(pos, 1); l = { out, stop: (SYNTH_LOOP[name] || SYNTH_LOOP.cluck)(this, out), seen: true }; this.loops.set(id, l); }
    l.seen = true;
    if (l.out.panner) place(l.out.panner, pos);
  }
  sweepLoops() { for (const [id, l] of this.loops) { if (!l.seen) { l.stop(); this.loops.delete(id); } else l.seen = false; } }
  stopAll() { for (const l of this.loops.values()) l.stop(); this.loops.clear(); this.ambience(null); }
  // The map's background bed: 'day' | 'dusk' | 'night' | 'space' | 'indoor' | null (silence).
  ambience(kind) {
    this.pendingAmbience = kind;
    for (const stop of this.ambient) stop();
    this.ambient = [];
    if (!this.ctx || !kind) return;
    const t = this.ctx.currentTime;
    this.amb.gain.cancelScheduledValues(t); this.amb.gain.setValueAtTime(0, t); this.amb.gain.linearRampToValueAtTime(1, t + 2.5);
    for (const part of AMBIENCE[kind] || []) this.ambient.push(part(this, this.amb));
  }
}
function place(p, pos) { if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]); }
export function registerSamples(map) { Object.assign(SAMPLE_URLS, map); }

// ---------------- synthesis ----------------
const env = (g, t, a, d, peak = 1) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
function noise(s, out, { t = 0, dur = 0.2, type = 'lowpass', f = 2000, q = 0.7, peak = 1, a = 0.002, sweep = null }) {
  const c = s.ctx, n = c.createBufferSource(); n.buffer = s.noise; n.playbackRate.value = 0.9 + Math.random() * 0.2;
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const g = c.createGain(); const t0 = c.currentTime + t;
  env(g, t0, a, dur, peak);
  if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
  n.connect(fl); fl.connect(g); g.connect(out); n.start(t0, Math.random()); n.stop(t0 + a + dur + 0.05);
}
function tone(s, out, { t = 0, f = 440, f2 = null, dur = 0.15, type = 'sine', peak = 0.5, a = 0.004 }) {
  const c = s.ctx, o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + t;
  o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  env(g, t0, a, dur, peak); o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + a + dur + 0.05);
}
function shot(s, out, body, crack, tail, peak = 1) {
  noise(s, out, { dur: 0.03, type: 'highpass', f: 2500, peak: 0.7 * peak });
  noise(s, out, { dur: crack, type: 'bandpass', f: body, q: 0.9, peak: 1.2 * peak, sweep: body * 0.4 });
  tone(s, out, { f: body / 8, f2: 40, dur: crack * 0.8, type: 'sine', peak: 0.9 * peak });
  noise(s, out, { t: 0.01, dur: tail, type: 'lowpass', f: 900, peak: 0.25 * peak, sweep: 200 });
}
const SYNTH = {
  yolk47: (s, o) => shot(s, o, 1400, 0.09, 0.25),
  beater: (s, o) => shot(s, o, 1800, 0.06, 0.16, 0.8),
  triBoil: (s, o) => shot(s, o, 1200, 0.09, 0.22),
  peck9mm: (s, o) => shot(s, o, 2200, 0.06, 0.15, 0.75),
  cageFree: (s, o) => shot(s, o, 900, 0.14, 0.45, 1.1),
  poacher: (s, o) => { shot(s, o, 700, 0.2, 0.7, 1.3); noise(s, o, { t: 0.02, dur: 0.6, type: 'lowpass', f: 400, peak: 0.3 }); },
  doubleYolker: (s, o) => { shot(s, o, 600, 0.22, 0.6, 1.4); noise(s, o, { dur: 0.3, type: 'lowpass', f: 300, peak: 0.6 }); },
  yolkzooka: (s, o) => { noise(s, o, { dur: 0.5, type: 'bandpass', f: 600, q: 0.5, peak: 0.9, sweep: 2500 }); tone(s, o, { f: 90, f2: 50, dur: 0.3, peak: 0.6 }); },
  dry: (s, o) => tone(s, o, { f: 1800, dur: 0.02, type: 'square', peak: 0.2 }),
  reload: (s, o) => { tone(s, o, { f: 900, dur: 0.03, type: 'square', peak: 0.12 }); tone(s, o, { t: 0.25, f: 1300, dur: 0.03, type: 'square', peak: 0.12 }); },
  reloadLong: (s, o) => { tone(s, o, { f: 900, dur: 0.03, type: 'square', peak: 0.12 }); tone(s, o, { t: 0.3, f: 1300, dur: 0.03, type: 'square', peak: 0.12 }); noise(s, o, { t: 0.6, dur: 0.05, type: 'bandpass', f: 3000, peak: 0.4 }); },
  swap: (s, o) => noise(s, o, { dur: 0.08, type: 'bandpass', f: 1800, peak: 0.2 }),
  crack: (s, o) => { noise(s, o, { dur: 0.06, type: 'highpass', f: 3000, peak: 0.9 }); tone(s, o, { f: 1600, f2: 700, dur: 0.05, type: 'triangle', peak: 0.4 }); },
  crackBig: (s, o) => { noise(s, o, { dur: 0.1, type: 'highpass', f: 2200, peak: 1.1 }); tone(s, o, { f: 1200, f2: 400, dur: 0.1, type: 'triangle', peak: 0.5 }); },
  splat: (s, o) => { noise(s, o, { dur: 0.25, type: 'lowpass', f: 900, peak: 0.9, sweep: 150 }); tone(s, o, { f: 260, f2: 80, dur: 0.2, type: 'sine', peak: 0.5 }); },
  hitmark: (s, o) => tone(s, o, { f: 2400, dur: 0.03, type: 'square', peak: 0.12 }),
  explode: (s, o) => { noise(s, o, { dur: 1.2, type: 'lowpass', f: 1400, peak: 1.5, sweep: 120 }); tone(s, o, { f: 70, f2: 30, dur: 0.8, peak: 1 }); SYNTH.squawk(s, o); },
  squawk: (s, o) => { for (let i = 0; i < 2; i++) tone(s, o, { t: i * 0.08, f: 900, f2: 500, dur: 0.12, type: 'sawtooth', peak: 0.18 }); },
  dud: (s, o) => noise(s, o, { dur: 0.3, type: 'lowpass', f: 700, peak: 0.4, sweep: 200 }),
  throw: (s, o) => noise(s, o, { dur: 0.15, type: 'bandpass', f: 900, peak: 0.35, sweep: 2500 }),
  bounce: (s, o) => tone(s, o, { f: 600, f2: 300, dur: 0.05, type: 'triangle', peak: 0.25 }),
  melee: (s, o) => noise(s, o, { dur: 0.15, type: 'bandpass', f: 1200, peak: 0.4, sweep: 400 }),
  step: (s, o) => noise(s, o, { dur: 0.05, type: 'lowpass', f: 500, peak: 0.25 }),
  land: (s, o) => noise(s, o, { dur: 0.1, type: 'lowpass', f: 300, peak: 0.5 }),
  jump: (s, o) => noise(s, o, { dur: 0.06, type: 'lowpass', f: 700, peak: 0.15 }),
  ammo: (s, o) => { tone(s, o, { f: 600, f2: 1200, dur: 0.08, type: 'sine', peak: 0.4 }); },
  pickupNade: (s, o) => { tone(s, o, { f: 2000, dur: 0.05, type: 'triangle', peak: 0.3 }); tone(s, o, { t: 0.05, f: 2600, dur: 0.06, type: 'triangle', peak: 0.25 }); },
  pop: (s, o) => tone(s, o, { f: 700, f2: 1100, dur: 0.05, type: 'sine', peak: 0.3 }),
  click: (s, o) => tone(s, o, { f: 1400, dur: 0.02, type: 'square', peak: 0.12 }),
  powerup: (s, o) => [523, 659, 784, 1046].forEach((f, i) => tone(s, o, { t: i * 0.07, f, dur: 0.12, type: 'triangle', peak: 0.3 })),
  powerdown: (s, o) => [1046, 784, 659, 523].forEach((f, i) => tone(s, o, { t: i * 0.07, f, dur: 0.12, type: 'triangle', peak: 0.3 })),
  bawk: (s, o) => { tone(s, o, { f: 700, f2: 1100, dur: 0.1, type: 'sawtooth', peak: 0.3 }); tone(s, o, { t: 0.1, f: 1000, f2: 500, dur: 0.25, type: 'sawtooth', peak: 0.3 }); },
  drop: (s, o) => tone(s, o, { f: 500, f2: 200, dur: 0.2, type: 'triangle', peak: 0.3 }),
  zone: (s, o) => [660, 880].forEach((f, i) => tone(s, o, { t: i * 0.12, f, dur: 0.2, type: 'sine', peak: 0.3 })),
  alarm: (s, o) => [0, 0.2].forEach(t => tone(s, o, { t, f: 880, f2: 660, dur: 0.15, type: 'square', peak: 0.12 })),
  score: (s, o) => [523, 659, 784].forEach((f, i) => tone(s, o, { t: i * 0.1, f, dur: 0.25, type: 'triangle', peak: 0.3 })),
  win: (s, o) => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(s, o, { t: i * 0.12, f, dur: 0.3, type: 'triangle', peak: 0.3 })),
  shield: (s, o) => tone(s, o, { f: 400, f2: 800, dur: 0.2, type: 'sine', peak: 0.2 }),
  respawn: (s, o) => tone(s, o, { f: 440, f2: 880, dur: 0.2, type: 'sine', peak: 0.25 }),
  challenge: (s, o) => [784, 988, 1175].forEach((f, i) => tone(s, o, { t: i * 0.08, f, dur: 0.15, type: 'triangle', peak: 0.3 })),
  // A bright two-note ding with a soft thump under it: the crack that finished someone.
  killConfirm: (s, o) => { tone(s, o, { f: 1318, dur: 0.12, type: 'triangle', peak: 0.28 }); tone(s, o, { t: 0.07, f: 1975, dur: 0.22, type: 'triangle', peak: 0.24 }); tone(s, o, { f: 140, f2: 60, dur: 0.12, type: 'sine', peak: 0.5 }); },
  death: (s, o) => { tone(s, o, { f: 320, f2: 70, dur: 0.7, type: 'sawtooth', peak: 0.12 }); noise(s, o, { dur: 0.6, type: 'lowpass', f: 600, peak: 0.25, sweep: 120 }); s.dull(380, 1.6); },
  heartbeat: (s, o) => { tone(s, o, { f: 62, f2: 38, dur: 0.11, type: 'sine', peak: 0.9 }); tone(s, o, { t: 0.2, f: 55, f2: 34, dur: 0.12, type: 'sine', peak: 0.7 }); },
  uiHover: (s, o) => tone(s, o, { f: 2100, dur: 0.012, type: 'sine', peak: 0.05 }),
  uiClick: (s, o) => { tone(s, o, { f: 900, f2: 1300, dur: 0.04, type: 'triangle', peak: 0.18 }); noise(s, o, { dur: 0.02, type: 'highpass', f: 3000, peak: 0.08 }); },
  tinnitus: (s, o) => tone(s, o, { f: 3900, dur: 1.4, type: 'sine', peak: 0.025, a: 0.05 }),
  // Our shot landed on an egg: a short meaty thump and a crunch of shell under the hit tick, so a
  // hit never sounds like a miss.
  hitBody: (s, o, r = 1) => { tone(s, o, { f: 180 * r, f2: 70, dur: 0.07, type: 'sine', peak: 0.55 }); noise(s, o, { dur: 0.045, type: 'bandpass', f: 3200 * r, q: 1.4, peak: 0.45, sweep: 1600 }); },
  // A bullet passing close: a fast rising-falling whine.
  whiz: (s, o) => { noise(s, o, { dur: 0.16, type: 'bandpass', f: 2600, q: 3, peak: 0.55, a: 0.03, sweep: 900 }); tone(s, o, { f: 1900, f2: 1100, dur: 0.14, type: 'sine', peak: 0.05, a: 0.03 }); },
  // Where our misses land: a dull knock on the wall (and the odd ricochet).
  impact: (s, o) => { noise(s, o, { dur: 0.05, type: 'bandpass', f: 1100, q: 1.2, peak: 0.35 }); if (Math.random() < 0.18) tone(s, o, { t: 0.01, f: 3600, f2: 1800, dur: 0.18, type: 'sine', peak: 0.04 }); },
  // The last quarter of a magazine: each shot adds a light, rising tick.
  lowAmmo: (s, o, r = 1) => tone(s, o, { f: 2600 * r, dur: 0.025, type: 'triangle', peak: 0.07 }),
  // Reload steps, keyed to the hands' animation.
  magOut: (s, o) => { noise(s, o, { dur: 0.05, type: 'bandpass', f: 1500, q: 1.5, peak: 0.35 }); tone(s, o, { f: 700, f2: 500, dur: 0.04, type: 'square', peak: 0.05 }); },
  magIn: (s, o) => { noise(s, o, { dur: 0.04, type: 'bandpass', f: 2200, q: 2, peak: 0.45 }); tone(s, o, { t: 0.02, f: 1300, dur: 0.03, type: 'square', peak: 0.08 }); tone(s, o, { f: 160, f2: 90, dur: 0.05, peak: 0.3 }); },
  rack: (s, o) => { noise(s, o, { dur: 0.06, type: 'bandpass', f: 1800, q: 1.2, peak: 0.4, sweep: 3200 }); noise(s, o, { t: 0.09, dur: 0.05, type: 'bandpass', f: 2600, q: 1.5, peak: 0.5 }); tone(s, o, { t: 0.09, f: 1400, dur: 0.03, type: 'square', peak: 0.08 }); },
  breakOpen: (s, o) => { noise(s, o, { dur: 0.07, type: 'bandpass', f: 1200, q: 1, peak: 0.45 }); tone(s, o, { f: 600, f2: 900, dur: 0.06, type: 'triangle', peak: 0.08 }); },
  shellIn: (s, o) => { noise(s, o, { dur: 0.04, type: 'bandpass', f: 1700, q: 1.5, peak: 0.35 }); noise(s, o, { t: 0.12, dur: 0.04, type: 'bandpass', f: 1600, q: 1.5, peak: 0.35 }); },
  boltUp: (s, o) => { noise(s, o, { dur: 0.05, type: 'bandpass', f: 1600, q: 1.5, peak: 0.4, sweep: 2600 }); tone(s, o, { t: 0.04, f: 1100, dur: 0.03, type: 'square', peak: 0.07 }); },
  boltDown: (s, o) => { noise(s, o, { dur: 0.05, type: 'bandpass', f: 2600, q: 1.5, peak: 0.45, sweep: 1500 }); tone(s, o, { t: 0.05, f: 1500, dur: 0.03, type: 'square', peak: 0.09 }); },
  rocketIn: (s, o) => { noise(s, o, { dur: 0.25, type: 'bandpass', f: 700, q: 0.8, peak: 0.3, sweep: 300 }); tone(s, o, { t: 0.22, f: 120, f2: 70, dur: 0.08, peak: 0.4 }); },
  // The mechanism cycling after one of our own shots (a little click under the bang).
  mech: (s, o, r = 1) => tone(s, o, { t: 0.035, f: 2900 * r, dur: 0.015, type: 'square', peak: 0.035 }),
};
// Map beds: each part starts on the ambience bus and returns a function that stops it.
function windBed(s, out, f = 380, level = 0.05) {
  const c = s.ctx, n = c.createBufferSource(); n.buffer = s.noise; n.loop = true;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.6;
  const g = c.createGain(); g.gain.value = level;
  // Gusts: a slow wobble on level and pitch.
  const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.09; lg.gain.value = level * 0.7; lfo.connect(lg); lg.connect(g.gain);
  const lfo2 = c.createOscillator(), lg2 = c.createGain(); lfo2.frequency.value = 0.05; lg2.gain.value = f * 0.35; lfo2.connect(lg2); lg2.connect(bp.frequency);
  n.connect(bp); bp.connect(g); g.connect(out); n.start(); lfo.start(); lfo2.start();
  return () => { try { n.stop(); lfo.stop(); lfo2.stop(); } catch { /* stopped */ } };
}
function scheduled(s, out, every, fn) {
  let on = true;
  const next = () => { if (!on || !s.ctx) return; if (s.ctx.state === 'running') fn(s, out); setTimeout(next, every[0] + Math.random() * every[1]); };
  setTimeout(next, 800 + Math.random() * 2000);
  return () => { on = false; };
}
function panned(s, out) { const p = s.ctx.createStereoPanner(); p.pan.value = Math.random() * 1.6 - 0.8; p.connect(out); return p; }
const birds = (s, out) => { const p = panned(s, out), base = 2400 + Math.random() * 1600; for (let i = 0, n = 2 + Math.floor(Math.random() * 4); i < n; i++) tone(s, p, { t: i * (0.09 + Math.random() * 0.05), f: base * (0.9 + Math.random() * 0.25), f2: base * (1.15 + Math.random() * 0.3), dur: 0.06, type: 'sine', peak: 0.03 }); };
const crickets = (s, out) => { const p = panned(s, out); for (let i = 0; i < 3; i++) tone(s, p, { t: i * 0.07, f: 4300 + Math.random() * 300, dur: 0.035, type: 'sine', peak: 0.012 }); };
function drone(s, out) {
  const c = s.ctx, g = c.createGain(); g.gain.value = 0.03; g.connect(out);
  const oscs = [55, 55.4, 82.6].map(f => { const o = c.createOscillator(); o.frequency.value = f; o.type = 'sine'; o.connect(g); o.start(); return o; });
  return () => { for (const o of oscs) try { o.stop(); } catch { /* stopped */ } };
}
const AMBIENCE = {
  day: [(s, o) => windBed(s, o, 380, 0.045), (s, o) => scheduled(s, o, [2500, 5000], birds)],
  dusk: [(s, o) => windBed(s, o, 300, 0.04), (s, o) => scheduled(s, o, [4000, 6000], birds), (s, o) => scheduled(s, o, [900, 1600], crickets)],
  night: [(s, o) => windBed(s, o, 260, 0.03), (s, o) => scheduled(s, o, [500, 900], crickets)],
  space: [drone, (s, o) => windBed(s, o, 140, 0.02)],
  indoor: [(s, o) => windBed(s, o, 180, 0.02)],
};
const SYNTH_LOOP = {
  cluck(s, out) {
    let on = true;
    // A live grenade clucks: recorded syllables at a nervous, irregular pace.
    const tick = () => {
      if (!on || !s.ctx) return;
      const b = s.pick('cluck');
      if (b) { const src = s.ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = 1.05 + Math.random() * 0.25; const g = s.ctx.createGain(); g.gain.value = 0.55; src.connect(g); g.connect(out); src.start(); }
      else tone(s, out, { f: 650 + Math.random() * 200, f2: 400, dur: 0.07, type: 'sawtooth', peak: 0.15 });
      setTimeout(tick, 200 + Math.random() * 160);
    };
    tick(); return () => { on = false; };
  },
  rocket(s, out) {
    const c = s.ctx, n = c.createBufferSource(); n.buffer = s.noise; n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.25; n.connect(f); f.connect(g); g.connect(out); n.start();
    return () => { try { n.stop(); } catch { /* stopped */ } };
  },
};

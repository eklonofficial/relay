// Sound (GDD §24): positional 3D audio for world sounds, one SFX volume for everything. Recorded
// samples (assets/sounds, decoded from the bundle) are used where present; anything without a sample
// is synthesised, so the game is never silent. `ctx` is what quick-hide suspends and resumes.
const SAMPLE_URLS = {}; // name → URL, filled by registerSamples() from the sound bank module

export class Sound {
  constructor(settings) { this.settings = settings; this.ctx = null; this.buffers = new Map(); this.loops = new Map(); this.lx = 0; this.ly = 0; this.lz = 0; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try { this.ctx = new AudioContext({ latencyHint: 'interactive' }); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4; this.comp.connect(this.master);
    this.bus = c.createGain(); this.bus.connect(this.comp);
    this.setVolume(this.settings.volume);
    const n = c.sampleRate * 2, buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    for (const [name, url] of Object.entries(SAMPLE_URLS)) this.load(name, url);
  }
  setVolume(v) { if (this.master) this.master.gain.value = (v / 100) ** 1.5 * 0.9; }
  async load(name, url) {
    try { const r = await fetch(url); const a = await r.arrayBuffer(); this.buffers.set(name, await this.ctx.decodeAudioData(a)); } catch { /* synthesised instead */ }
  }
  listener(x, y, z, yaw) {
    this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw;
    const L = this.ctx?.listener; if (!L) return;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), t = this.ctx.currentTime;
    if (L.positionX) { L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t); L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(0, t); L.forwardZ.setValueAtTime(fz, t); L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t); }
    else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
  }
  // An output node at a world position (or straight to the bus when pos is null: our own sounds).
  out(pos, gain = 1) {
    const c = this.ctx, g = c.createGain(); g.gain.value = gain;
    if (pos) {
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.5; p.rolloffFactor = 1.1; p.maxDistance = 120;
      place(p, pos); g.connect(p); p.connect(this.bus); g.panner = p;
    } else g.connect(this.bus);
    return g;
  }
  play(name, pos = null, gain = 1, rate = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (pos && Math.hypot(pos[0] - this.lx, pos[1] - this.ly, pos[2] - this.lz) > 90) return;
    const out = this.out(pos, gain);
    const b = this.buffers.get(name) || this.buffers.get(name.replace(/\d+$/, ''));
    if (b) { const s = this.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate * (0.96 + Math.random() * 0.08); s.connect(out); s.start(); return; }
    (SYNTH[name] || SYNTH.pop)(this, out, rate);
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
  stopAll() { for (const l of this.loops.values()) l.stop(); this.loops.clear(); }
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
};
const SYNTH_LOOP = {
  cluck(s, out) {
    let on = true;
    const tick = () => { if (!on || !s.ctx) return; tone(s, out, { f: 650 + Math.random() * 200, f2: 400, dur: 0.07, type: 'sawtooth', peak: 0.15 }); setTimeout(tick, 220 + Math.random() * 140); };
    tick(); return () => { on = false; };
  },
  rocket(s, out) {
    const c = s.ctx, n = c.createBufferSource(); n.buffer = s.noise; n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.25; n.connect(f); f.connect(g); g.connect(out); n.start();
    return () => { try { n.stop(); } catch { /* stopped */ } };
  },
};

// Procedural soundtrack: dozens of named, original pieces in a calm piano / ambient style,
// composed deterministically from each track's seed (key, mode, tempo, chord progression,
// recurring melodic motif with variations, accompaniment pattern and instrument palette).
// Notes are scheduled a couple of seconds ahead so only a handful of audio nodes exist at once.
import { mulberry32 } from '../core/noise.js?v=murpnhgy';

const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], minor: [0, 2, 3, 5, 7, 8, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], wholetone: [0, 2, 4, 6, 8, 10, 12],
};
// Progressions as scale degrees (0-based).
const PROGS = {
  bright: [[0, 4, 5, 3], [0, 3, 5, 4], [5, 3, 0, 4], [0, 2, 3, 3], [3, 0, 4, 5], [0, 5, 1, 4], [0, 3, 0, 4], [3, 4, 2, 5]],
  dark: [[0, 6, 5, 6], [0, 3, 0, 4], [0, 5, 2, 6], [0, 3, 6, 2], [5, 3, 0, 0], [0, 1, 0, 6]],
  drift: [[0, 0, 3, 3], [0, 4, 0, 3], [0, 5, 0, 5], [0, 1, 0, 1]],
};

// Track list: name, mood, mode, progression family, instrument palette, tempo range.
const TRACKS = [
  ['Morning Moss', 'day', 'major', 'bright', 'piano', 70], ['Meadow Song', 'day', 'lydian', 'bright', 'piano', 64], ['Pebble Path', 'day', 'major', 'bright', 'piano', 78],
  ['Potter\'s Wheel', 'day', 'mixolydian', 'bright', 'piano', 66], ['Oak & Ivy', 'day', 'major', 'drift', 'piano', 60], ['Haystack Nap', 'day', 'lydian', 'bright', 'musicbox', 72],
  ['Sunflower Wind', 'day', 'major', 'bright', 'piano', 74], ['Cherry Petals', 'day', 'lydian', 'drift', 'musicbox', 68], ['Riverbend', 'day', 'major', 'bright', 'piano', 62],
  ['Village Morning', 'day', 'mixolydian', 'bright', 'piano', 76],
  ['Lanterns', 'night', 'dorian', 'dark', 'piano', 58], ['Owl Hollow', 'night', 'minor', 'dark', 'piano', 54], ['Moonlit Birches', 'night', 'dorian', 'drift', 'musicbox', 60],
  ['Starfall', 'night', 'minor', 'dark', 'bell', 56], ['Quiet Hearth', 'night', 'dorian', 'dark', 'piano', 62], ['Blue Hour', 'night', 'minor', 'drift', 'piano', 52],
  ['Deepslate', 'cave', 'minor', 'drift', 'pad', 48], ['Dripstone', 'cave', 'phrygian', 'drift', 'bell', 50], ['Glow Lichen', 'cave', 'dorian', 'drift', 'pad', 46],
  ['Echoing Veins', 'cave', 'minor', 'dark', 'pad', 52], ['Geode', 'cave', 'wholetone', 'drift', 'bell', 54],
  ['Basalt Hymn', 'nether', 'phrygian', 'dark', 'pad', 48], ['Crimson Canopy', 'nether', 'phrygian', 'drift', 'pad', 52], ['Soul Valley', 'nether', 'minor', 'drift', 'bell', 46],
  ['Ghast Lullaby', 'nether', 'phrygian', 'dark', 'pad', 44], ['Fortress Walls', 'nether', 'minor', 'dark', 'pad', 56],
  ['Void Choir', 'end', 'wholetone', 'drift', 'pad', 44], ['Chorus Garden', 'end', 'lydian', 'drift', 'bell', 50], ['Pillars', 'end', 'minor', 'drift', 'pad', 42],
  ['Endless Isles', 'end', 'lydian', 'drift', 'musicbox', 48],
  ['Blueprint', 'creative', 'lydian', 'bright', 'piano', 80], ['Skybridge', 'creative', 'major', 'bright', 'musicbox', 84], ['Scaffolding', 'creative', 'mixolydian', 'bright', 'piano', 76],
  ['Floating Isles', 'creative', 'lydian', 'drift', 'piano', 68],
  ['Blockhaven', 'menu', 'major', 'bright', 'piano', 66], ['Title Screen Clouds', 'menu', 'lydian', 'drift', 'piano', 60], ['Home', 'menu', 'major', 'bright', 'musicbox', 70],
  ['New World', 'menu', 'mixolydian', 'bright', 'piano', 64],
];
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// Composes a full piece into a flat list of { t, m (midi), d (dur s), v (0..1), i (instrument) }.
export function compose(track) {
  const [name, mood, modeKey, progKey, palette, bpmBase] = track;
  const r = mulberry32(hashStr(name));
  const pick = a => a[Math.floor(r() * a.length)];
  const scale = MODES[modeKey];
  const low = mood === 'nether' || mood === 'cave';
  const tonic = (low ? 38 : 50) + Math.floor(r() * 9); // D2..B2 / D3..B3
  const bpm = bpmBase + Math.floor(r() * 7) - 3, beat = 60 / bpm, bar = beat * 4;
  const prog = pick(PROGS[progKey]);
  const deg = (d, oct = 0) => { const n = scale.length; const o = Math.floor(d / n); return tonic + scale[((d % n) + n) % n] + 12 * (o + oct); };
  const notes = [];
  const add = (t, m, d, v, i) => { while (m < 31) m += 12; while (m > 96) m -= 12; notes.push({ t: t + (r() - 0.5) * 0.018, m, d, v: v * (0.85 + r() * 0.3), i }); };
  const melInst = palette === 'pad' ? (r() < 0.5 ? 'bell' : 'piano') : palette;
  const accInst = palette === 'pad' ? 'pad' : palette === 'bell' ? 'piano' : palette;

  // Motif: two bars of rhythm + contour, reused with variations.
  const rhythms = [[1, 1, 2], [1.5, 0.5, 2], [2, 1, 1], [0.5, 0.5, 1, 2], [1, 0.5, 0.5, 2], [3, 1], [1, 1, 1, 1], [2, 2]];
  const motif = [];
  for (let b = 0; b < 2; b++) { let t = 0; for (const len of pick(rhythms)) { motif.push({ t: b * 4 + t, len, step: Math.floor(r() * 5) - 2 }); t += len; } }
  const accPattern = pick(['arp8', 'arp4', 'block', 'alberti', 'drone', 'broken']);
  const sections = mood === 'menu' ? ['intro', 'A', 'B', 'A', 'outro'] : pick([['intro', 'A', 'B', 'A', 'outro'], ['intro', 'A', 'A', 'B', 'outro'], ['A', 'B', 'B', 'A', 'outro'], ['intro', 'A', 'B', 'outro']]);
  let t = 1;
  let melDeg = 4 + Math.floor(r() * 3);
  for (const sec of sections) {
    const bars = sec === 'intro' ? 2 : sec === 'outro' ? 2 : 8;
    for (let b = 0; b < bars; b++) {
      const chord = prog[b % prog.length];
      const t0 = t + b * bar;
      // Accompaniment.
      const root = deg(chord, -1), third = deg(chord + 2, -1), fifth = deg(chord + 4, -1), oct = deg(chord, 0);
      const bassV = sec === 'outro' ? 0.28 : 0.34;
      if (sec === 'outro' && b === bars - 1) { for (const m of [root - 12, root, fifth, oct + 4 - 4, deg(chord + 2, 0)]) add(t0, m, bar * 2, 0.26, accInst === 'pad' ? 'pad' : 'piano'); continue; }
      add(t0, root - 12, bar * 0.95, bassV, accInst === 'pad' ? 'pad' : 'bass');
      switch (accInst === 'pad' ? 'drone' : accPattern) {
        case 'arp8': [root, fifth, oct, deg(chord + 2, 0), oct, fifth, third, fifth].forEach((m, k) => add(t0 + k * beat / 2, m, beat * 1.4, 0.2, accInst)); break;
        case 'arp4': [root, fifth, oct, third + 12].forEach((m, k) => add(t0 + k * beat, m, beat * 2, 0.22, accInst)); break;
        case 'block': for (const k of [0, 2]) for (const m of [third, fifth, oct]) add(t0 + k * beat, m, beat * 1.8, 0.14, accInst); break;
        case 'alberti': [root, fifth, third, fifth, root, fifth, third, fifth].forEach((m, k) => add(t0 + k * beat / 2, m + 12, beat, 0.15, accInst)); break;
        case 'broken': [root, oct, fifth + 12, third + 12].forEach((m, k) => add(t0 + k * beat * (k === 3 ? 0.75 : 1), m, beat * 2.5, 0.2, accInst)); break;
        default: for (const m of [root, fifth, oct]) add(t0, m, bar * 1.1, 0.16, 'pad');
      }
      // Melody: the motif over A, a freer variation over B; intro/outro stay sparse.
      if (sec === 'intro') { if (b === 1) add(t0 + beat * 2, deg(chord + 4, 1), beat * 2, 0.22, melInst); continue; }
      if (sec === 'outro') { add(t0, deg(chord + 2, 1), bar, 0.2, melInst); continue; }
      const half = b % 2;
      for (const n of motif) {
        if (Math.floor(n.t / 4) !== half) continue;
        if (sec === 'B' && r() < 0.25) continue; // breathe
        melDeg += (sec === 'B' ? n.step + (r() < 0.3 ? 1 : 0) : n.step);
        if (n.t % 4 === 0) { // land on a chord tone on the downbeat
          const tones = [chord, chord + 2, chord + 4, chord + 7];
          melDeg = tones.reduce((a, c) => Math.abs(c - melDeg) < Math.abs(a - melDeg) ? c : a, tones[0]);
        }
        melDeg = Math.max(chord + 1, Math.min(chord + 11, melDeg));
        add(t0 + (n.t % 4) * beat, deg(melDeg, 1), n.len * beat * 1.3, sec === 'B' ? 0.3 : 0.26, melInst);
        if (sec === 'B' && r() < 0.15) add(t0 + (n.t % 4) * beat, deg(melDeg - 2, 1), n.len * beat, 0.14, melInst);
      }
    }
    t += bars * bar;
  }
  return { name, mood, notes: notes.sort((a, b) => a.t - b.t), length: t + 4 };
}

export class MusicPlayer {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out;
    this.piece = null; this.gap = 6 + Math.random() * 8; this.last = null; this.mood = null;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 3800; this.tone.Q.value = 0.4;
    this.tone.connect(out);
  }
  // Called every frame with the current mood; handles gaps, track choice, crossfades and scheduling.
  update(dt, mood) {
    const c = this.ctx;
    if (this.piece) {
      const p = this.piece, now = c.currentTime;
      // Mood changed a lot (e.g. into the Nether): fade the current piece out.
      if (mood !== p.mood && !p.fading && !(p.mood === 'day' && mood === 'creative') && !(p.mood === 'creative' && mood === 'day')) {
        p.fading = true; p.bus.gain.setTargetAtTime(0, now, 1.5); p.end = Math.min(p.end, now + 5); this.gap = 3;
      }
      while (p.i < p.notes.length && p.start + p.notes[p.i].t < now + 2.5) { const n = p.notes[p.i++]; if (!p.fading) this.voice(p.bus, p.start + n.t, n); }
      if (now > p.end) { p.bus.disconnect(); this.piece = null; this.gap = p.fading ? this.gap : (mood === 'menu' ? 4 + Math.random() * 6 : 15 + Math.random() * 30); }
      return;
    }
    this.gap -= dt;
    if (this.gap > 0) return;
    const options = TRACKS.filter(tr => tr[1] === mood && tr[0] !== this.last);
    const tr = (options.length ? options : TRACKS.filter(t => t[1] === 'day'))[Math.floor(Math.random() * Math.max(1, options.length))];
    const comp = compose(tr);
    const bus = c.createGain(); bus.gain.value = 1; bus.connect(this.tone);
    this.piece = { ...comp, i: 0, start: c.currentTime + 0.3, end: c.currentTime + comp.length, bus, mood };
    this.last = tr[0];
    this.nowPlaying = tr[0];
  }
  voice(bus, t, n) {
    const c = this.ctx, f = mtof(n.m), v = n.v;
    const g = c.createGain();
    g.connect(bus);
    const osc = (type, freq, lvl) => { const o = c.createOscillator(); o.type = type; o.frequency.value = freq; const og = c.createGain(); og.gain.value = lvl; o.connect(og).connect(g); return o; };
    let oscs, stop;
    switch (n.i) {
      case 'pad': {
        oscs = [osc('sawtooth', f * 0.997, 0.05), osc('sawtooth', f * 1.003, 0.05), osc('triangle', f / 2, 0.08)];
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700 + f; g.disconnect(); g.connect(lp).connect(bus);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + Math.min(1.8, n.d * 0.4));
        g.gain.setValueAtTime(v, t + n.d); g.gain.exponentialRampToValueAtTime(0.0001, t + n.d + 2.5); stop = t + n.d + 2.6; break;
      }
      case 'musicbox': {
        oscs = [osc('sine', f * 2, 0.5), osc('sine', f * 8, 0.06), osc('triangle', f * 2, 0.12)];
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8); stop = t + 1.9; break;
      }
      case 'bell': {
        oscs = [osc('sine', f, 0.5), osc('sine', f * 2.76, 0.12), osc('sine', f * 5.4, 0.05)];
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6); stop = t + 3.7; break;
      }
      case 'bass': {
        oscs = [osc('sine', f, 0.7), osc('triangle', f, 0.2)];
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(1.5, n.d + 1)); stop = t + Math.max(1.6, n.d + 1.1); break;
      }
      default: { // soft felt piano
        const decay = Math.max(1.4, Math.min(5, 4.2 - Math.log2(f / 220) * 0.9));
        oscs = [osc('triangle', f, 0.55), osc('sine', f * 2.001, 0.16), osc('sine', f * 3.003, 0.05)];
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.005);
        g.gain.exponentialRampToValueAtTime(v * 0.35, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(decay, n.d + 1.2)); stop = t + Math.min(decay, n.d + 1.2) + 0.05;
      }
    }
    for (const o of oscs) { o.start(t); o.stop(stop); }
    oscs[0].onended = () => g.disconnect();
  }
  static get trackCount() { return TRACKS.length; }
}

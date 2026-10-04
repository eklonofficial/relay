// Bundled/resource-pack samples replace matching sounds; WebAudio synthesis remains the fallback.
const MATERIAL = {
  grass: { freq: 1900, q: 0.6, gain: 0.5 }, gravel: { freq: 1100, q: 0.9, gain: 0.6 }, stone: { freq: 2600, q: 1.6, gain: 0.55, click: 1200 },
  wood: { freq: 750, q: 2.4, gain: 0.6, knock: 220 }, sand: { freq: 3400, q: 0.5, gain: 0.45 }, snow: { freq: 4200, q: 0.4, gain: 0.35 },
  glass: { freq: 5200, q: 2.5, gain: 0.45, ring: 2100 }, cloth: { freq: 800, q: 0.5, gain: 0.4 }, metal: { freq: 3000, q: 3, gain: 0.45, ring: 1400 },
  slime: { freq: 520, q: 1.2, gain: 0.55, knock: 150 },
};
// Mob voices: [base freq, type, duration, sweep, noise]

import { SOUND_FILES, NOTE_FILES, MOB_DIR, matSound } from '../render/pack.js?v=mutb2tbl';
import { MusicPlayer } from './music.js?v=mutb2tbl';

const VOWEL = { a: [[730, 6, 1.2], [1090, 7, 0.9], [2440, 9, 0.3]], o: [[450, 6, 1.2], [800, 7, 0.9], [2800, 9, 0.2]], u: [[320, 6, 1.3], [870, 7, 0.7], [2250, 9, 0.2]] };
const MOB_VOICE_ALIAS = { polar_bear: 'bear', zombified_piglin: 'zpiglin', wandering_trader: 'villager', pillager: 'illager', vindicator: 'illager', evoker: 'illager', iron_golem: 'golem', snow_golem: 'snowgolem', husk: 'zombie', drowned: 'zombie', zombie_villager: 'zombie', stray: 'skeleton', wither_skeleton: 'skeleton', cave_spider: 'spider', magma_cube: 'slime', mooshroom: 'cow', donkey: 'horse', camel: 'horse', mule: 'horse', endermite: 'silverfish', ender_dragon: 'dragon', glow_squid: 'squid', cod: 'fish', salmon: 'fish', tropical_fish: 'fish', pufferfish: 'fish' };

export class Sound {
  constructor() { this.ctx = null; this.volume = 0.6; this.music = 0.4; this.listener = { pos: [0, 0, 0], yaw: 0 }; this.musicT = 20; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.master = this.ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.gain.value = this.music * 0.5;
      const verb = this.ctx.createConvolver();
      const ir = this.ctx.createBuffer(2, this.ctx.sampleRate * 3, this.ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const ch = ir.getChannelData(c); for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3); }
      verb.buffer = ir;
      this.musicBus.connect(verb).connect(this.master);
      this.musicBus.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  setMusic(v) { this.music = v; if (this.musicBus) this.musicBus.gain.value = v * 0.5; }
  // Distance attenuation and stereo pan for a world position.
  spatial(pos, vol) {
    const c = this.ctx;
    const g = c.createGain();
    let level = vol, pan = 0;
    if (pos) {
      const l = this.listener.pos, dx = pos[0] - l[0], dy = pos[1] - l[1], dz = pos[2] - l[2], d = Math.hypot(dx, dy, dz);
      level *= Math.max(0, 1 - d / 24) ** 1.3;
      const rx = Math.cos(this.listener.yaw), rz = -Math.sin(this.listener.yaw);
      pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8 : 0;
    }
    if (level < 0.005) return null;
    g.gain.value = level;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(this.master); } else g.connect(this.master);
    return g;
  }
  burst(mat, duration, level, rate = 1, pos = null) {
    if (!this.ctx) return;
    const out = this.spatial(pos, 1); if (!out) return;
    const c = this.ctx, now = c.currentTime, m = MATERIAL[mat] || MATERIAL.stone;
    const src = c.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = m.freq * (0.85 + Math.random() * 0.3); f.Q.value = m.q;
    const g = c.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(level * m.gain, now + 0.006); g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(f).connect(g).connect(out); src.start(now, Math.random() * 1.5, duration + 0.05);
    if (m.knock) this.tone(m.knock * (0.9 + Math.random() * 0.2), m.knock * 0.6, duration * 0.8, level * 0.5, 'triangle', out);
    if (m.click) this.tone(m.click, m.click * 0.7, 0.03, level * 0.15, 'square', out);
    if (m.ring) this.tone(m.ring * (0.9 + Math.random() * 0.3), m.ring, duration * 2.5, level * 0.12, 'sine', out);
  }
  tone(f0, f1, duration, level, type = 'sine', out = this.master, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), now); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + duration);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(level, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, now + duration);
    o.connect(g).connect(out); o.start(now); o.stop(now + duration + 0.05);
  }
  noiseSweep(f0, f1, dur, level, out, type = 'lowpass') {
    const c = this.ctx, now = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, now); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), now + dur);
    const g = c.createGain(); g.gain.setValueAtTime(level, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(f).connect(g).connect(out); src.start(now, Math.random(), dur + 0.1);
  }
  // ---------------- resource pack samples ----------------
  // With a resource pack loaded, sounds it provides replace the synthesized ones (a random
  // numbered variant, decoded on first use).
  setPack(zip, index, overlay = false) {
    const pack = { zip, index, buffers: new Map(), pending: new Map() };
    this.packs = overlay ? [pack, ...(this.packs || [])] : [pack];
    this.pack = this.packs[0];
  }
  packFor(base) { return (this.packs || []).find(pack => pack.index.has(base)); }
  hasSample(base) { return !!this.packFor(base); }
  sample(base, pos, vol = 1, pitch = 1) {
    const P = this.packFor(base);
    if (!P || !this.ctx) return false;
    const files = P.index.get(base);
    if (!files || !files.length) return false;
    const file = files[Math.floor(Math.random() * files.length)];
    const play = buf => {
      const out = this.spatial(pos, vol); if (!out) return;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = pitch;
      src.connect(out); src.start();
    };
    const buf = P.buffers.get(file);
    if (buf) { play(buf); return true; }
    let job = P.pending.get(file);
    if (!job) {
      job = P.zip.bytes(file).then(b => this.ctx.decodeAudioData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))).then(d => { P.buffers.set(file, d); return d; });
      job.catch(() => { P.index.delete(base); });
      P.pending.set(file, job);
    }
    job.then(play, () => {});
    return true;
  }
  dig(mat, pos) { if (this.sample(matSound('dig', mat), pos, 1, 0.8)) return; this.burst(mat, 0.16, 0.9, 1, pos); }
  hit(mat, pos) { if (this.sample(matSound('step', mat), pos, 0.25, 0.5)) return; this.burst(mat, 0.07, 0.35, 1.2, pos); }
  place(mat, pos) { if (this.sample(matSound('dig', mat), pos, 1, 0.8)) return; this.burst(mat, 0.1, 0.8, 0.8, pos); }
  step(mat, pos) { if (this.sample(matSound('step', mat), pos, 0.15, 1)) return; this.burst(mat, 0.08, 0.25, 1, pos); }
  click(v = 1) { if (!this.ctx) return; const out = this.spatial(null, 0.5 * v); if (!out) return; this.pulses(out, { count: 1, freq: 2600, q: 3, gain: 0.35, len: 0.03 }); this.tone(1400, 1100, 0.03, 0.05, 'sine', out); }

  play(name, pos = null, vol = 1, pitch = 1) {
    if (!this.ctx) return;
    if (this.pack && SOUND_FILES[name] && this.sample(SOUND_FILES[name], pos, vol, pitch)) return;
    const out = this.spatial(pos, vol); if (!out) return;
    const T = (a, b, d, l, t) => this.tone(a * pitch, b * pitch, d, l, t, out);
    switch (name) {
      case 'pop': T(900, 1400, 0.08, 0.25, 'sine'); break;
      case 'xp': T(1500, 2200, 0.1, 0.18, 'sine'); T(2250, 3000, 0.12, 0.08, 'sine'); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.5, 0.18, 'triangle', out, i * 0.08)); break;
      case 'hurt': this.voice(out, { dur: 0.22, f0: [230 * pitch, 170 * pitch], formants: VOWEL.u, breath: 0.35, gain: 0.34, attack: 0.01 }); this.burst('cloth', 0.08, 0.6, 0.8, pos); break;
      case 'eat': for (let i = 0; i < 3; i++) this.burst('grass', 0.07, 0.6, 0.7, pos); break;
      case 'burp': this.voice(out, { dur: 0.35, f0: [120, 90, 80], formants: VOWEL.o, breath: 0.3, gain: 0.3, jitter: 0.2 }); break;
      case 'drink': for (let k = 0; k < 3; k++) { this.tone(340, 200, 0.09, 0.12, 'sine', out, k * 0.16); this.pulses(out, { t: k * 0.16, count: 1, freq: 700, q: 2, gain: 0.25, len: 0.08, type: 'lowpass' }); } break;
      case 'bow': this.noiseSweep(3000, 800, 0.2, 0.4, out, 'bandpass'); T(400, 150, 0.15, 0.2, 'triangle'); break;
      case 'bow_draw': this.noiseSweep(600, 1400, 0.4, 0.12, out, 'bandpass'); break;
      case 'arrow_hit': this.burst('wood', 0.08, 0.6, 1.4, pos); break;
      case 'arrow_hit_entity': this.pulses(out, { count: 1, freq: 500, q: 1.5, gain: 0.5, len: 0.09, type: 'lowpass' }); this.burst('wood', 0.06, 0.4, 1.3, pos); break;
      case 'attack': this.noiseSweep(2500, 600, 0.12, 0.3, out, 'bandpass'); break;
      case 'crit': this.pulses(out, { count: 1, freq: 600, q: 1, gain: 0.55, len: 0.1, type: 'lowpass' }); this.noiseSweep(6000, 2000, 0.12, 0.3, out, 'highpass'); this.ring(out, [2400, 3700], { decay: 0.25, gain: 0.06 }); break;
      case 'shield_block': this.burst('wood', 0.12, 0.9, 0.8, pos); this.pulses(out, { count: 1, freq: 320, q: 1.2, gain: 0.5, len: 0.12, type: 'lowpass' }); break;
      case 'shield_break': this.burst('wood', 0.3, 1, 0.6, pos); this.burst('metal', 0.2, 0.6, 1.1, pos); this.pulses(out, { count: 3, gap: 0.04, freq: 700, q: 2, gain: 0.35 }); break;
      case 'sweep': this.noiseSweep(5000, 1200, 0.2, 0.35, out, 'bandpass'); break;
      case 'explode': this.noiseSweep(1800, 40, 1.8, 1.4, out); T(80, 30, 1.2, 0.8, 'sine'); break;
      case 'firework': this.noiseSweep(1800, 5000, 0.6, 0.3, out, 'bandpass'); break;
      case 'firework_blast': this.noiseSweep(2500, 120, 1.2, 0.9, out); this.pulses(out, { t: 0.25, count: 12, gap: 0.06, freq: 4000, q: 2, gain: 0.25, len: 0.03 }); break;
      case 'fuse': this.noiseSweep(6000, 3000, 1.5, 0.35, out, 'highpass'); break;
      case 'fizz': this.noiseSweep(6000, 2000, 0.5, 0.3, out, 'highpass'); break;
      case 'fire': this.noiseSweep(900, 300, 0.4, 0.2, out); break;
      case 'ignite': this.noiseSweep(4000, 800, 0.3, 0.4, out, 'bandpass'); T(300, 900, 0.2, 0.1, 'sawtooth'); break;
      case 'fireball': this.noiseSweep(1200, 200, 0.7, 0.6, out); break;
      case 'teleport': this.noiseSweep(300, 4000, 0.3, 0.3, out, 'bandpass'); this.voice(out, { dur: 0.45, f0: [90, 240, 70], formants: [[600, 2, 1], [1800, 3, 0.6]], vib: 40, vibRate: 15, breath: 0.5, gain: 0.2 }); break;
      case 'portal': T(90, 120, 3, 0.2, 'sine'); T(180, 140, 3, 0.1, 'triangle'); break;
      case 'portal_travel': T(60, 400, 3.5, 0.3, 'sawtooth'); this.noiseSweep(200, 3000, 3, 0.2, out); break;
      case 'splash': this.noiseSweep(2400, 250, 0.55, 0.5, out); break;
      case 'swim': this.noiseSweep(1200, 400, 0.3, 0.15, out); break;
      case 'door_open': this.burst('wood', 0.2, 0.7, 0.7, pos); T(220, 180, 0.2, 0.1, 'triangle'); break;
      case 'door_close': this.burst('wood', 0.12, 0.9, 0.6, pos); break;
      case 'chest_open': this.pulses(out, { count: 1, freq: 1800, q: 3, gain: 0.3, len: 0.04 }); this.creak(out, { t: 0.03, dur: 0.5, f0: 95 * pitch, f1: 170 * pitch, gain: 0.3 }); break;
      case 'chest_close': this.creak(out, { dur: 0.22, f0: 150 * pitch, f1: 105 * pitch, gain: 0.22 }); this.pulses(out, { t: 0.2, count: 1, freq: 380, q: 1.2, gain: 0.7, len: 0.12, type: 'lowpass' }); this.pulses(out, { t: 0.21, count: 2, gap: 0.03, freq: 1400, q: 2, gain: 0.25, len: 0.04 }); break;
      case 'glass': for (let i = 0; i < 4; i++) this.burst('glass', 0.3, 0.6, 1 + i * 0.2, pos); break;
      case 'thunder': this.noiseSweep(400, 30, 4, 1.6, out); T(50, 25, 3, 0.6, 'sine'); break;
      case 'shear': this.noiseSweep(5000, 2500, 0.1, 0.3, out, 'bandpass'); break;
      case 'milk': this.noiseSweep(800, 300, 0.4, 0.3, out); break;
      case 'throw': this.noiseSweep(2000, 800, 0.2, 0.25, out, 'bandpass'); break;
      case 'anvil': T(900, 880, 0.6, 0.2, 'triangle'); T(1450, 1420, 0.5, 0.12, 'sine'); break;
      case 'anvil_use': T(1180, 1150, 0.35, 0.22, 'triangle'); T(2350, 2300, 0.25, 0.1, 'sine'); this.burst('stone', 0.05, 0.4, 1.4, pos); break;
      case 'anvil_break': T(700, 400, 0.5, 0.2, 'sawtooth'); for (let i = 0; i < 3; i++) this.burst('stone', 0.08, 0.6, 0.8, pos); break;
      // Enchanting: a rising shimmer of soft bell tones.
      case 'enchant': [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, f * 1.01, 0.7, 0.1, 'sine', out, i * 0.07)); break;
      case 'cure': this.ring(out, [660, 990, 1320, 1760], { decay: 1.4, gain: 0.12 }); this.noiseSweep(2000, 8000, 1.2, 0.08, out, 'highpass'); break;
      case 'fangs': this.pulses(out, { count: 2, gap: 0.05, freq: 1200, q: 2, gain: 0.45, len: 0.05 }); this.burst('stone', 0.12, 0.8, 0.7, pos); break;
      case 'ghast_warn': this.voice(out, { dur: 0.7, f0: [1300, 1500, 800], formants: [[1200, 3, 1], [2800, 5, 0.5]], vib: 60, vibRate: 7, breath: 0.2, gain: 0.28, wave: 'triangle' }); break;
      case 'enderman_stare': this.voice(out, { dur: 1.4, f0: [300, 900, 700, 1100], formants: [[900, 3, 1], [2400, 5, 0.7]], vib: 90, vibRate: 11, breath: 0.6, gain: 0.3, jitter: 0.3 }); this.voice(out, { dur: 1.4, f0: [60, 55, 70], formants: [[300, 2, 1]], breath: 0.3, gain: 0.25 }); break;
      case 'phantom': this.mob('phantom', 'ambient', pos, null); break;
      case 'trade': this.mob('villager', 'ambient', pos, null); break;
      case 'no': this.voice(out, { dur: 0.4, f0: [230, 250, 170], formants: [[280, 5, 1], [2200, 8, 0.7], [900, 4, 0.5]], breath: 0.08, gain: 0.26 }); break;
      case 'break_item': this.burst('metal', 0.3, 0.8, 1.3, pos); this.pulses(out, { count: 4, gap: 0.03, freq: 3000, q: 3, gain: 0.3 }); this.ring(out, [1900, 2870, 4100], { decay: 0.3, gain: 0.08 }); break;
      case 'equip': this.burst('metal', 0.15, 0.5, 0.8, pos); break;
      case 'totem': T(400, 1600, 1, 0.3, 'triangle'); T(600, 2400, 1.2, 0.2, 'sine'); break;
      case 'dragon_death': this.noiseSweep(3000, 40, 6, 1, out); T(200, 40, 6, 0.5, 'sawtooth'); break;
      case 'bell': [880, 1320, 1760].forEach(f => this.tone(f, f, 2, 0.15, 'sine', out)); break;
      case 'chime': [1046, 1318, 1568].forEach((f, i) => this.tone(f, f, 1.2, 0.12, 'sine', out, i * 0.1)); break;
      case 'xbow_start': this.creak(out, { dur: 0.35, f0: 180 * pitch, f1: 260 * pitch, gain: 0.25 }); break;
      case 'xbow_mid': this.creak(out, { dur: 0.3, f0: 240 * pitch, f1: 320 * pitch, gain: 0.22 }); this.pulses(out, { t: 0.1, count: 2, gap: 0.08, freq: 1500, q: 3, gain: 0.25, len: 0.03 }); break;
      case 'xbow_load': this.pulses(out, { count: 1, freq: 900, q: 1.5, gain: 0.6, len: 0.06, type: 'lowpass' }); this.pulses(out, { t: 0.04, count: 1, freq: 2600, q: 3, gain: 0.4, len: 0.03 }); break;
      case 'xbow_shoot': this.noiseSweep(3200, 700, 0.18, 0.5, out, 'bandpass'); T(260, 90, 0.16, 0.3, 'triangle'); this.pulses(out, { count: 1, freq: 700, q: 1.2, gain: 0.5, len: 0.05, type: 'lowpass' }); break;
      case 'rs_click': this.pulses(out, { count: 1, freq: 2200 * pitch, q: 4, gain: 0.45, len: 0.03 }); T(900, 600, 0.04, 0.12, 'square'); break;
      case 'piston_out': this.noiseSweep(900 * pitch, 2400 * pitch, 0.16, 0.5, out, 'bandpass'); this.burst('wood', 0.1, 0.8, 1.1, pos); break;
      case 'piston_in': this.noiseSweep(2200 * pitch, 800 * pitch, 0.16, 0.45, out, 'bandpass'); this.burst('stone', 0.1, 0.6, 0.9, pos); break;
      default: this.pulses(out, { count: 1, freq: 1200, q: 2, gain: 0.15, len: 0.04 });
    }
  }
  // Note blocks: the instrument comes from the block underneath; pitch 1 is F#4 like the original's samples.
  note(inst, pitch, pos) {
    if (!this.ctx) return;
    if (this.pack && NOTE_FILES[inst] && this.sample(NOTE_FILES[inst], pos, 1, pitch)) return;
    const out = this.spatial(pos, 1); if (!out) return;
    const f = 370 * pitch, T = (a, d, l, type, k = 1) => this.tone(f * a, f * a * k, d, l, type, out);
    switch (inst) {
      case 'bass': T(0.25, 0.7, 0.35, 'triangle'); T(0.5, 0.4, 0.1, 'sine'); break;
      case 'didgeridoo': T(0.25, 1.1, 0.25, 'sawtooth'); break;
      case 'guitar': T(0.5, 0.6, 0.18, 'sawtooth'); T(1, 0.4, 0.08, 'triangle'); break;
      case 'flute': T(2, 0.9, 0.22, 'sine'); T(4, 0.3, 0.03, 'sine'); break;
      case 'bell': this.ring(out, [f * 4, f * 4 * 2.76, f * 4 * 5.4], { decay: 1.8, gain: 0.14 }); break;
      case 'chime': this.ring(out, [f * 4, f * 4 * 2.2, f * 4 * 3.9], { decay: 1.5, gain: 0.1 }); break;
      case 'xylophone': T(4, 0.25, 0.28, 'sine'); this.ring(out, [f * 12], { decay: 0.15, gain: 0.05 }); break;
      case 'iron_xylophone': T(1, 0.5, 0.2, 'square'); T(2, 0.4, 0.08, 'sine'); break;
      case 'cow_bell': this.ring(out, [f * 2, f * 3], { decay: 0.35, gain: 0.18 }); break;
      case 'bit': T(1, 0.45, 0.14, 'square'); break;
      case 'banjo': T(1, 0.4, 0.2, 'square'); T(2, 0.25, 0.1, 'triangle'); break;
      case 'pling': T(1, 1.2, 0.25, 'sine'); T(2, 1.0, 0.12, 'triangle'); break;
      case 'basedrum': this.tone(140 * pitch, 50 * pitch, 0.25, 0.55, 'sine', out); break;
      case 'snare': this.noiseSweep(4000 * pitch, 1500 * pitch, 0.15, 0.45, out, 'bandpass'); break;
      case 'hat': this.noiseSweep(9000 * Math.min(1.5, pitch), 7000, 0.07, 0.3, out, 'highpass'); break;
      default: T(1, 1.0, 0.3, 'triangle'); T(2, 0.6, 0.08, 'sine');
    }
  }
  // ---------------- voice synthesis ----------------
  // A buzzy source (sawtooth + breath noise) shaped by vowel formants, with a pitch contour and
  // vibrato: enough to make moos, bleats, whinnies, groans and grunts instead of beeps.
  voice(out, { t = 0, dur = 0.5, f0 = [200, 180], formants = VOWEL.a, vib = 0, vibRate = 5, breath = 0.15, gain = 0.3, attack = 0.03, wave = 'sawtooth', jitter = 0 }) {
    const c = this.ctx, now = c.currentTime + t;
    const src = c.createOscillator(); src.type = wave;
    const n = f0.length;
    src.frequency.setValueAtTime(Math.max(30, f0[0]), now);
    for (let i = 1; i < n; i++) src.frequency.linearRampToValueAtTime(Math.max(30, f0[i] * (1 + (Math.random() - 0.5) * jitter)), now + dur * i / (n - 1));
    if (vib) { const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = vibRate; lg.gain.value = vib; lfo.connect(lg).connect(src.frequency); lfo.start(now); lfo.stop(now + dur + 0.05); }
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, now); env.gain.linearRampToValueAtTime(gain, now + attack);
    env.gain.setValueAtTime(gain, now + dur * 0.7); env.gain.exponentialRampToValueAtTime(0.0005, now + dur);
    const mix = c.createGain(); mix.gain.value = 1;
    src.connect(mix);
    if (breath > 0) { const nz = c.createBufferSource(); nz.buffer = this.noise; const ng = c.createGain(); ng.gain.value = breath; nz.connect(ng).connect(mix); nz.start(now, Math.random(), dur + 0.1); }
    for (const [ff, q, g] of formants) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q; const fg = c.createGain(); fg.gain.value = g; mix.connect(bp).connect(fg).connect(env); }
    env.connect(out);
    src.start(now); src.stop(now + dur + 0.05);
  }
  // A wooden hinge creak: a stick-slip buzz whose pitch drifts, chopped into a ratchety grain and
  // coloured by the resonances of a wooden box.
  creak(out, { t = 0, dur = 0.4, f0 = 100, f1 = 160, gain = 0.3 }) {
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, now);
    // Irregular pitch wander, like a hinge catching and slipping.
    for (let k = 1; k <= 6; k++) o.frequency.linearRampToValueAtTime(f0 + (f1 - f0) * (k / 6) * (0.85 + Math.random() * 0.3), now + dur * k / 6);
    const grain = c.createOscillator(); grain.type = 'square'; grain.frequency.value = 22 + Math.random() * 14;
    const gd = c.createGain(); gd.gain.value = 0.45;
    const chop = c.createGain(); chop.gain.value = 0.55;
    grain.connect(gd).connect(chop.gain);
    const env = c.createGain(); env.gain.setValueAtTime(0.0001, now); env.gain.linearRampToValueAtTime(gain, now + dur * 0.15); env.gain.linearRampToValueAtTime(gain * 0.8, now + dur * 0.75); env.gain.exponentialRampToValueAtTime(0.0005, now + dur);
    const mix = c.createGain();
    for (const [f, q, g] of [[720, 4, 1], [1650, 5, 0.6], [3100, 6, 0.25]]) { const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * (0.95 + Math.random() * 0.1); bp.Q.value = q; const bg = c.createGain(); bg.gain.value = g; o.connect(bp).connect(bg).connect(mix); }
    mix.connect(chop).connect(env).connect(out);
    o.start(now); o.stop(now + dur + 0.05); grain.start(now); grain.stop(now + dur + 0.05);
  }
  // Short filtered-noise pulses (rattles, clicks, chitters, crackles).
  pulses(out, { t = 0, count = 6, gap = 0.05, freq = 2500, q = 4, gain = 0.3, len = 0.025, type = 'bandpass', spread = 0.3 }) {
    const c = this.ctx;
    for (let i = 0; i < count; i++) {
      const now = c.currentTime + t + i * gap * (1 + (Math.random() - 0.5) * spread);
      const src = c.createBufferSource(); src.buffer = this.noise;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq * (0.8 + Math.random() * 0.4); f.Q.value = q;
      const g = c.createGain(); g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.001, now + len);
      src.connect(f).connect(g).connect(out); src.start(now, Math.random() * 1.5, len + 0.02);
    }
  }
  // Inharmonic partials: metal, bells, chimes.
  ring(out, freqs, { t = 0, decay = 0.6, gain = 0.15 } = {}) {
    freqs.forEach((f, i) => this.tone(f, f * 0.995, decay * (1 - i * 0.12), gain / (1 + i * 0.6), 'sine', out, t));
  }
  mob(type, event, pos, e) {
    if (!this.ctx) return;
    if (this.pack) {
      const key = MOB_VOICE_ALIAS[type] || type, dir = MOB_DIR[key] || `mob/${key}`;
      const names = event === 'hurt' ? ['hurt', 'hit', 'hitt'] : event === 'death' ? ['death', 'hurt', 'hit'] : ['say', 'idle', 'ambient', 'breathe', 'moan', 'bark', 'meow', 'small', 'neutral'];
      const p = (e && e.baby ? 1.5 : 1) * (0.9 + Math.random() * 0.2);
      for (const n of names) if (this.hasSample(`${dir}/${n}`)) { this.sample(`${dir}/${n}`, pos, event === 'ambient' ? 0.8 : 1, p); return; }
    }
    const out = this.spatial(pos, event === 'death' ? 1 : event === 'ambient' ? 0.65 : 0.85); if (!out) return;
    const baby = e && e.baby ? 1.45 : 1, r = 0.92 + Math.random() * 0.16;
    const p = baby * r * (event === 'hurt' ? 1.15 : event === 'death' ? 0.85 : 1);
    const hurt = event === 'hurt', death = event === 'death';
    const V = o => this.voice(out, o), P = o => this.pulses(out, o);
    const key = MOB_VOICE_ALIAS[type] || type;
    switch (key) {
      case 'cow': V({ dur: death ? 1.2 : 0.9 + Math.random() * 0.3, f0: [118 * p, 104 * p, 92 * p, 84 * p], formants: [[320, 5, 1.4], [700, 6, 0.9], [2400, 8, 0.2]], vib: 3, vibRate: 5, breath: 0.08, gain: 0.35, attack: 0.08 }); break;
      case 'pig': for (let k = 0; k < (hurt ? 1 : 2); k++) V({ t: k * 0.2, dur: hurt ? 0.3 : 0.16, f0: [230 * p, 170 * p], formants: [[420, 5, 1.2], [1300, 6, 0.8], [2800, 8, 0.3]], breath: 0.35, gain: 0.3, wave: 'square' }); break;
      case 'sheep': V({ dur: 0.65, f0: [340 * p, 330 * p, 300 * p], formants: [[750, 6, 1.3], [1150, 7, 0.9], [2500, 9, 0.3]], vib: 26, vibRate: 7, breath: 0.12, gain: 0.28 }); break;
      case 'goat': V({ dur: 0.55, f0: [380 * p, 360 * p, 320 * p], formants: [[650, 6, 1.2], [1400, 7, 0.9]], vib: 40, vibRate: 9, breath: 0.2, gain: 0.26 }); break;
      case 'chicken': for (let k = 0; k < 3; k++) V({ t: k * 0.09, dur: 0.07, f0: [900 * p, 700 * p], formants: [[1100, 4, 1], [2600, 6, 0.6]], breath: 0.3, gain: 0.22, wave: 'square' }); if (hurt || death) V({ t: 0.28, dur: 0.18, f0: [1200 * p, 800 * p], formants: [[1400, 4, 1]], gain: 0.25 }); break;
      case 'horse': V({ dur: hurt ? 0.5 : 1.0, f0: [1050 * p, 900 * p, 700 * p, 520 * p, 460 * p], formants: [[900, 5, 1.1], [1800, 6, 0.8], [2900, 8, 0.3]], vib: 70, vibRate: 13, breath: 0.25, gain: 0.24 }); break;
      case 'llama': V({ dur: 0.5, f0: [520 * p, 480 * p], formants: [[700, 5, 1], [1300, 6, 0.6]], vib: 20, vibRate: 6, breath: 0.4, gain: 0.22 }); break;
      case 'wolf': if (e && e.target && !death) { V({ dur: 0.9, f0: [120 * p, 110 * p], formants: [[500, 4, 1], [1200, 5, 0.6]], vib: 12, vibRate: 22, breath: 0.6, gain: 0.3 }); } else for (let k = 0; k < (hurt ? 1 : 2); k++) V({ t: k * 0.22, dur: hurt ? 0.3 : 0.13, f0: [hurt ? 900 * p : 520 * p, 380 * p], formants: [[800, 4, 1.1], [1700, 5, 0.7]], breath: 0.4, gain: 0.3 }); break;
      case 'cat': V({ dur: 0.55, f0: [600 * p, 820 * p, 700 * p, 520 * p], formants: [[500, 4, 0.9], [1800, 5, 1], [3000, 7, 0.4]], vib: 8, vibRate: 6, breath: 0.1, gain: 0.22 }); break;
      case 'fox': V({ dur: 0.25, f0: [900 * p, 1300 * p, 700 * p], formants: [[1100, 4, 1], [2400, 6, 0.6]], breath: 0.3, gain: 0.22 }); break;
      case 'bear': V({ dur: 0.9, f0: [95 * p, 80 * p, 70 * p], formants: [[400, 4, 1.2], [900, 5, 0.8]], vib: 10, vibRate: 25, breath: 0.6, gain: 0.34 }); break;
      case 'panda': V({ dur: 0.3, f0: [300 * p, 260 * p], formants: [[500, 5, 1], [1100, 6, 0.7]], breath: 0.3, gain: 0.22 }); break;
      case 'zombie': V({ dur: death ? 1.3 : 0.9 + Math.random() * 0.4, f0: [96 * p, 84 * p, 70 * p], formants: [[420, 4, 1.3], [760, 5, 0.9], [2300, 7, 0.2]], vib: 6, vibRate: 7, breath: 0.55, gain: 0.34, jitter: 0.15 }); break;
      case 'skeleton': P({ count: hurt ? 5 : death ? 14 : 8, gap: 0.045, freq: 2200 * p, q: 5, gain: 0.32 }); P({ t: 0.02, count: 4, gap: 0.06, freq: 900, q: 3, gain: 0.2, len: 0.04 }); break;
      case 'spider': this.noiseSweep(3200, 1400, hurt ? 0.25 : 0.5, 0.18, out, 'bandpass'); P({ count: hurt ? 6 : 10, gap: 0.035, freq: 4200, q: 8, gain: 0.18, len: 0.015 }); break;
      case 'creeper': this.noiseSweep(5000, 2400, 0.35, hurt ? 0.3 : 0.12, out, 'highpass'); break;
      case 'enderman': V({ dur: 0.9, f0: [70 * p, 55 * p, 90 * p, 60 * p], formants: [[300, 3, 1], [900, 4, 0.6]], vib: 30, vibRate: 3, breath: 0.4, gain: 0.3 }); this.tone(1400 * p, 700 * p, 0.8, 0.05, 'sine', out); break;
      case 'witch': V({ dur: 0.6, f0: [420 * p, 520 * p, 380 * p, 460 * p], formants: [[600, 5, 1], [1700, 6, 0.8]], vib: 15, vibRate: 10, breath: 0.2, gain: 0.24 }); break;
      case 'villager': case 'illager': { const low = key === 'illager' ? 0.8 : 1; const up = hurt ? [260, 320] : death ? [240, 150] : [210, 240, 190]; V({ dur: hurt ? 0.3 : 0.45, f0: up.map(f => f * p * low), formants: [[280, 5, 1], [2200, 8, 0.7], [900, 4, 0.5]], breath: 0.08, gain: 0.26, attack: 0.02 }); break; }
      case 'golem': this.ring(out, [180 * p, 297 * p, 413 * p, 611 * p], { decay: 0.5, gain: 0.25 }); this.burst('metal', 0.2, 0.7, 0.6, null); break;
      case 'blaze': this.noiseSweep(700, 300, 0.7, 0.25, out); V({ dur: 0.7, f0: [150 * p, 130 * p], formants: [[500, 3, 0.8]], vib: 20, vibRate: 30, breath: 0.8, gain: 0.18 }); break;
      case 'ghast': V({ dur: death ? 1.6 : 1.1, f0: [900 * p, 1100 * p, 700 * p], formants: [[900, 4, 1], [2600, 6, 0.6]], vib: 40, vibRate: 5, breath: 0.1, gain: 0.22, wave: 'triangle' }); break;
      case 'slime': this.noiseSweep(600, 200, 0.18, 0.35, out); this.tone(160 * p, 90 * p, 0.15, 0.15, 'sine', out); break;
      case 'dragon': case 'wither': V({ dur: death ? 3 : 1.6, f0: [key === 'wither' ? 70 : 90, 60, 55, 45].map(f => f * p), formants: [[350, 3, 1.3], [800, 4, 0.9], [1900, 5, 0.4]], vib: 15, vibRate: 18, breath: 0.9, gain: 0.45, jitter: 0.2 }); break;
      case 'piglin': case 'zpiglin': case 'hoglin': for (let k = 0; k < 2; k++) V({ t: k * 0.18, dur: 0.14, f0: [180 * p, 140 * p], formants: [[450, 5, 1.2], [1100, 6, 0.8]], breath: 0.5, gain: 0.3, wave: 'square' }); break;
      case 'ravager': V({ dur: 1.0, f0: [80 * p, 60 * p], formants: [[380, 4, 1.2], [800, 4, 0.8]], vib: 10, vibRate: 20, breath: 0.7, gain: 0.38 }); break;
      case 'bat': for (let k = 0; k < 3; k++) this.tone(4200 * p, 3600 * p, 0.035, 0.08, 'sine', out, k * 0.07); break;
      case 'parrot': for (let k = 0; k < 3; k++) V({ t: k * 0.1, dur: 0.08, f0: [1800 * p, 2400 * p], formants: [[2200, 4, 1]], gain: 0.18 }); break;
      case 'phantom': V({ dur: 0.8, f0: [700 * p, 520 * p, 300 * p], formants: [[900, 4, 1], [2500, 6, 0.5]], vib: 50, vibRate: 12, breath: 0.4, gain: 0.26 }); break;
      case 'silverfish': P({ count: 7, gap: 0.03, freq: 5000, q: 6, gain: 0.14, len: 0.012 }); break;
      case 'fish': case 'squid': case 'dolphin': case 'turtle': case 'axolotl': case 'frog': this.noiseSweep(900, 300, 0.2, 0.2, out); if (key === 'dolphin') for (let k = 0; k < 4; k++) this.tone(2400 * p, 3200 * p, 0.05, 0.08, 'sine', out, k * 0.06); break;
      case 'rabbit': case 'ocelot': case 'strider': case 'snowgolem': V({ dur: 0.2, f0: [500 * p, 420 * p], formants: [[700, 5, 1], [1800, 6, 0.5]], breath: 0.4, gain: 0.18 }); break;
      default: V({ dur: 0.35, f0: [260 * p, 200 * p], formants: [[500, 5, 1], [1500, 6, 0.6]], breath: 0.3, gain: 0.24 });
    }
  }

  // Soundtrack: structured original pieces per mood (see music.js), with short gaps between tracks.
  updateMusic(dt, mood = 'day') {
    if (!this.ctx || this.music <= 0) return;
    if (!this.musicPlayer) this.musicPlayer = new MusicPlayer(this.ctx, this.musicBus);
    this.musicPlayer.update(dt, mood);
  }
  get nowPlaying() { return this.musicPlayer && this.musicPlayer.piece ? this.musicPlayer.nowPlaying : null; }
  // ElytraOnPlayerSoundInstance: wind rushing past while gliding (volume 0-1, pitch from 1 up).
  // The bundled pack has no elytra loop, so it is filtered noise rising in pitch with speed.
  setWind(volume, pitch = 1) {
    if (!this.ctx) return;
    if (!this.windSrc && volume > 0) {
      const c = this.ctx;
      this.windSrc = c.createBufferSource(); this.windSrc.buffer = this.noise; this.windSrc.loop = true;
      this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.Q.value = 0.6;
      this.windGain = c.createGain(); this.windGain.gain.value = 0;
      this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master); this.windSrc.start();
    }
    if (!this.windGain) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(volume * 0.4, t, 0.08);
    this.windFilter.frequency.setTargetAtTime(380 * pitch + volume * 520, t, 0.1);
    if (volume <= 0 && this.windSrc) { const src = this.windSrc; this.windSrc = null; this.windGain = null; setTimeout(() => { try { src.stop(); } catch { /* already stopped */ } }, 400); }
  }
  // Continuous rain hiss while it rains.
  setRain(level) {
    if (!this.ctx) return;
    if (!this.rainSrc && level > 0) {
      const c = this.ctx;
      this.rainSrc = c.createBufferSource(); this.rainSrc.buffer = this.noise; this.rainSrc.loop = true;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
      this.rainGain = c.createGain(); this.rainGain.gain.value = 0;
      this.rainSrc.connect(f).connect(this.rainGain).connect(this.master); this.rainSrc.start();
    }
    if (this.rainGain) this.rainGain.gain.value = level * 0.12;
  }
}

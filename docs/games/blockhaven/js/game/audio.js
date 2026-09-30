// Every sound is synthesized with WebAudio: materials, mobs, combat, weather and generative music.
const MATERIAL = {
  grass: { freq: 1900, q: 0.6, gain: 0.5 }, gravel: { freq: 1100, q: 0.9, gain: 0.6 }, stone: { freq: 2600, q: 1.6, gain: 0.55, click: 1200 },
  wood: { freq: 750, q: 2.4, gain: 0.6, knock: 220 }, sand: { freq: 3400, q: 0.5, gain: 0.45 }, snow: { freq: 4200, q: 0.4, gain: 0.35 },
  glass: { freq: 5200, q: 2.5, gain: 0.45, ring: 2100 }, cloth: { freq: 800, q: 0.5, gain: 0.4 }, metal: { freq: 3000, q: 3, gain: 0.45, ring: 1400 },
};
// Mob voices: [base freq, type, duration, sweep, noise]
const VOICE = {
  pig: [300, 'sawtooth', 0.25, 0.7, 0.2], cow: [140, 'sawtooth', 0.7, 0.8, 0.1], sheep: [420, 'square', 0.45, 0.9, 0.05], chicken: [900, 'square', 0.12, 1.3, 0.1],
  zombie: [110, 'sawtooth', 0.9, 0.7, 0.35], skeleton: [0, 'noise', 0.15, 1, 1], creeper: [0, 'noise', 0.3, 1, 1], spider: [300, 'sawtooth', 0.2, 0.6, 0.6],
  enderman: [70, 'sine', 0.8, 1.6, 0.4], villager: [260, 'triangle', 0.35, 0.8, 0.05], illager: [220, 'triangle', 0.35, 0.75, 0.1], witch: [500, 'triangle', 0.3, 1.4, 0.1],
  wolf: [500, 'sawtooth', 0.18, 0.7, 0.2], cat: [700, 'triangle', 0.4, 0.8, 0], horse: [420, 'sawtooth', 0.6, 0.6, 0.2], llama: [350, 'triangle', 0.4, 0.8, 0.1],
  golem: [80, 'square', 0.3, 0.8, 0.5], blaze: [180, 'sawtooth', 0.6, 0.9, 0.6], ghast: [900, 'sine', 1.1, 0.5, 0.2], slime: [120, 'sine', 0.2, 0.6, 0.3],
  bat: [2400, 'square', 0.08, 1.2, 0], parrot: [1500, 'square', 0.15, 1.3, 0], fox: [800, 'sawtooth', 0.2, 0.7, 0.2], bear: [90, 'sawtooth', 0.8, 0.7, 0.4],
  dragon: [60, 'sawtooth', 2, 0.6, 0.5], phantom: [600, 'sawtooth', 0.6, 0.5, 0.4], piglin: [200, 'sawtooth', 0.4, 0.8, 0.3], zpiglin: [150, 'sawtooth', 0.5, 0.8, 0.3],
  hoglin: [100, 'sawtooth', 0.5, 0.8, 0.5], ravager: [70, 'sawtooth', 0.8, 0.7, 0.5], panda: [300, 'triangle', 0.4, 0.8, 0.2], goat: [500, 'sawtooth', 0.4, 0.9, 0.1],
  fish: [0, 'noise', 0.1, 1, 1], squid: [0, 'noise', 0.2, 1, 1], dolphin: [2000, 'sine', 0.3, 1.2, 0], frog: [180, 'square', 0.2, 1.1, 0.1], turtle: [200, 'sine', 0.3, 0.9, 0.2],
  rabbit: [1000, 'sine', 0.1, 1, 0.2], silverfish: [2000, 'noise', 0.15, 1, 1], strider: [250, 'sawtooth', 0.4, 0.8, 0.3], axolotl: [900, 'sine', 0.2, 1.2, 0],
};

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
  dig(mat, pos) { this.burst(mat, 0.16, 0.9, 1, pos); }
  hit(mat, pos) { this.burst(mat, 0.07, 0.35, 1.2, pos); }
  place(mat, pos) { this.burst(mat, 0.1, 0.8, 0.8, pos); }
  step(mat, pos) { this.burst(mat, 0.08, 0.25, 1, pos); }
  click(v = 1) { if (this.ctx) this.tone(720, 540, 0.05, 0.12 * v, 'square'); }

  play(name, pos = null, vol = 1, pitch = 1) {
    if (!this.ctx) return;
    const out = this.spatial(pos, vol); if (!out) return;
    const T = (a, b, d, l, t) => this.tone(a * pitch, b * pitch, d, l, t, out);
    switch (name) {
      case 'pop': T(900, 1400, 0.08, 0.25, 'sine'); break;
      case 'xp': T(1500, 2200, 0.1, 0.18, 'sine'); T(2250, 3000, 0.12, 0.08, 'sine'); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.5, 0.18, 'triangle', out, i * 0.08)); break;
      case 'hurt': T(260, 150, 0.2, 0.35, 'sawtooth'); this.noiseSweep(1500, 400, 0.15, 0.3, out); break;
      case 'eat': for (let i = 0; i < 3; i++) this.burst('grass', 0.07, 0.6, 0.7, pos); break;
      case 'burp': T(160, 90, 0.35, 0.3, 'sawtooth'); break;
      case 'drink': T(400, 200, 0.15, 0.2, 'sine'); break;
      case 'bow': this.noiseSweep(3000, 800, 0.2, 0.4, out, 'bandpass'); T(400, 150, 0.15, 0.2, 'triangle'); break;
      case 'bow_draw': this.noiseSweep(600, 1400, 0.4, 0.12, out, 'bandpass'); break;
      case 'arrow_hit': this.burst('wood', 0.08, 0.6, 1.4, pos); break;
      case 'arrow_hit_entity': T(1200, 600, 0.08, 0.2, 'square'); break;
      case 'attack': this.noiseSweep(2500, 600, 0.12, 0.3, out, 'bandpass'); break;
      case 'crit': T(1800, 900, 0.1, 0.2, 'square'); this.noiseSweep(4000, 1000, 0.1, 0.3, out, 'highpass'); break;
      case 'sweep': this.noiseSweep(5000, 1200, 0.2, 0.35, out, 'bandpass'); break;
      case 'explode': this.noiseSweep(1800, 40, 1.8, 1.4, out); T(80, 30, 1.2, 0.8, 'sine'); break;
      case 'fuse': this.noiseSweep(6000, 3000, 1.5, 0.35, out, 'highpass'); break;
      case 'fizz': this.noiseSweep(6000, 2000, 0.5, 0.3, out, 'highpass'); break;
      case 'fire': this.noiseSweep(900, 300, 0.4, 0.2, out); break;
      case 'ignite': this.noiseSweep(4000, 800, 0.3, 0.4, out, 'bandpass'); T(300, 900, 0.2, 0.1, 'sawtooth'); break;
      case 'fireball': this.noiseSweep(1200, 200, 0.7, 0.6, out); break;
      case 'teleport': T(200, 1200, 0.3, 0.2, 'sine'); T(1300, 300, 0.4, 0.15, 'sine'); break;
      case 'portal': T(90, 120, 3, 0.2, 'sine'); T(180, 140, 3, 0.1, 'triangle'); break;
      case 'portal_travel': T(60, 400, 3.5, 0.3, 'sawtooth'); this.noiseSweep(200, 3000, 3, 0.2, out); break;
      case 'splash': this.noiseSweep(2400, 250, 0.55, 0.5, out); break;
      case 'swim': this.noiseSweep(1200, 400, 0.3, 0.15, out); break;
      case 'door_open': this.burst('wood', 0.2, 0.7, 0.7, pos); T(220, 180, 0.2, 0.1, 'triangle'); break;
      case 'door_close': this.burst('wood', 0.12, 0.9, 0.6, pos); break;
      case 'chest_open': this.burst('wood', 0.3, 0.6, 0.5, pos); T(160, 240, 0.3, 0.08, 'triangle'); break;
      case 'chest_close': this.burst('wood', 0.15, 0.8, 0.5, pos); break;
      case 'glass': for (let i = 0; i < 4; i++) this.burst('glass', 0.3, 0.6, 1 + i * 0.2, pos); break;
      case 'thunder': this.noiseSweep(400, 30, 4, 1.6, out); T(50, 25, 3, 0.6, 'sine'); break;
      case 'shear': this.noiseSweep(5000, 2500, 0.1, 0.3, out, 'bandpass'); break;
      case 'milk': this.noiseSweep(800, 300, 0.4, 0.3, out); break;
      case 'throw': this.noiseSweep(2000, 800, 0.2, 0.25, out, 'bandpass'); break;
      case 'anvil': T(900, 880, 0.6, 0.2, 'triangle'); T(1450, 1420, 0.5, 0.12, 'sine'); break;
      case 'cure': T(300, 900, 1.5, 0.2, 'sine'); break;
      case 'fangs': T(300, 100, 0.2, 0.3, 'sawtooth'); break;
      case 'ghast_warn': T(1200, 600, 0.5, 0.25, 'sine'); T(1400, 700, 0.5, 0.15, 'sine'); break;
      case 'enderman_stare': T(80, 60, 1.5, 0.4, 'sawtooth'); T(1600, 1200, 1.5, 0.08, 'sine'); break;
      case 'phantom': T(700, 300, 0.8, 0.25, 'sawtooth'); break;
      case 'trade': T(350, 420, 0.25, 0.2, 'triangle'); break;
      case 'no': T(240, 180, 0.3, 0.2, 'triangle'); break;
      case 'break_item': this.burst('metal', 0.3, 0.8, 1.3, pos); T(1600, 400, 0.3, 0.1, 'square'); break;
      case 'equip': this.burst('metal', 0.15, 0.5, 0.8, pos); break;
      case 'totem': T(400, 1600, 1, 0.3, 'triangle'); T(600, 2400, 1.2, 0.2, 'sine'); break;
      case 'dragon_death': this.noiseSweep(3000, 40, 6, 1, out); T(200, 40, 6, 0.5, 'sawtooth'); break;
      case 'bell': [880, 1320, 1760].forEach(f => this.tone(f, f, 2, 0.15, 'sine', out)); break;
      case 'chime': [1046, 1318, 1568].forEach((f, i) => this.tone(f, f, 1.2, 0.12, 'sine', out, i * 0.1)); break;
      default: T(440, 330, 0.1, 0.1, 'sine');
    }
  }
  mob(type, event, pos, e) {
    if (!this.ctx) return;
    const map = { polar_bear: 'bear', zombified_piglin: 'zpiglin', wandering_trader: 'villager', pillager: 'illager', vindicator: 'illager', evoker: 'illager', iron_golem: 'golem', snow_golem: 'golem', husk: 'zombie', drowned: 'zombie', zombie_villager: 'zombie', stray: 'skeleton', wither_skeleton: 'skeleton', cave_spider: 'spider', magma_cube: 'slime', mooshroom: 'cow', donkey: 'horse', camel: 'horse', ocelot: 'cat', endermite: 'silverfish', ender_dragon: 'dragon', glow_squid: 'squid', cod: 'fish', salmon: 'fish', tropical_fish: 'fish', pufferfish: 'fish' };
    const v = VOICE[map[type] || type] || VOICE.pig;
    const out = this.spatial(pos, event === 'death' ? 1 : 0.8); if (!out) return;
    const [f, wave, dur, sweep, nz] = v;
    const p = (e && e.baby ? 1.5 : 1) * (0.9 + Math.random() * 0.2) * (event === 'hurt' ? 1.2 : event === 'death' ? 0.8 : 1);
    if (wave === 'noise' || nz > 0.5) this.noiseSweep(1500 * p, 500 * p, dur, 0.4, out, 'bandpass');
    if (f) this.tone(f * p, f * p * sweep, dur * (event === 'death' ? 1.5 : 1), 0.22, wave === 'noise' ? 'sawtooth' : wave, out);
    if (event === 'hurt') this.tone(f * p * 1.3 || 600, (f * p || 600) * 0.7, 0.12, 0.12, 'square', out);
  }

  // Sparse generative piano-like ambience (pentatonic, long reverb), in the spirit of calm sandbox music.
  updateMusic(dt, mood = 'day') {
    if (!this.ctx || this.music <= 0) return;
    this.musicT -= dt;
    if (this.musicT > 0) return;
    this.musicT = 90 + Math.random() * 120;
    const scales = { day: [0, 2, 4, 7, 9], night: [0, 3, 5, 7, 10], nether: [0, 1, 5, 6, 10], end: [0, 2, 3, 7, 8], cave: [0, 3, 6, 7, 10] };
    const sc = scales[mood] || scales.day;
    const root = mood === 'nether' ? 110 : mood === 'end' ? 130.8 : 196 * (Math.random() < 0.5 ? 1 : 0.75);
    const notes = 14 + Math.floor(Math.random() * 12);
    let t = 0;
    for (let i = 0; i < notes; i++) {
      const deg = sc[Math.floor(Math.random() * sc.length)] + 12 * Math.floor(Math.random() * 2);
      const f = root * Math.pow(2, deg / 12);
      const c = this.ctx, now = c.currentTime + t;
      for (const [mult, lvl, type] of [[1, 0.18, 'triangle'], [2, 0.05, 'sine'], [3, 0.02, 'sine']]) {
        const o = c.createOscillator(); o.type = type; o.frequency.value = f * mult;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(lvl, now + 0.02); g.gain.exponentialRampToValueAtTime(0.0003, now + 3.5);
        o.connect(g).connect(this.musicBus); o.start(now); o.stop(now + 3.6);
      }
      if (Math.random() < 0.25) {
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = root / 2 * Math.pow(2, sc[0] / 12);
        const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.08, now + 0.5); g.gain.exponentialRampToValueAtTime(0.0003, now + 6);
        o.connect(g).connect(this.musicBus); o.start(now); o.stop(now + 6.2);
      }
      t += [0.6, 0.9, 1.2, 1.8][Math.floor(Math.random() * 4)];
    }
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

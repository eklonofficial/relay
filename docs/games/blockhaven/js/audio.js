// All sounds are synthesized with WebAudio.

const MATERIAL = {
  grass: { freq: 1900, q: 0.6, gain: 0.5 },
  gravel: { freq: 1100, q: 0.9, gain: 0.6 },
  stone: { freq: 2600, q: 1.6, gain: 0.55, click: 1200 },
  wood: { freq: 750, q: 2.4, gain: 0.6, knock: 220 },
  sand: { freq: 3400, q: 0.5, gain: 0.45 },
  snow: { freq: 4200, q: 0.4, gain: 0.35 },
  glass: { freq: 5200, q: 2.5, gain: 0.45, ring: 2100 },
  cloth: { freq: 800, q: 0.5, gain: 0.4 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  burst(mat, duration, level, rate = 1) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime, m = MATERIAL[mat] || MATERIAL.stone;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = m.freq * (0.85 + Math.random() * 0.3);
    f.Q.value = m.q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(level * m.gain, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 0.5, duration + 0.05);
    if (m.knock) this.tone(m.knock * (0.9 + Math.random() * 0.2), m.knock * 0.6, duration * 0.8, level * 0.5, 'triangle');
    if (m.click) this.tone(m.click, m.click * 0.7, 0.03, level * 0.15, 'square');
    if (m.ring) this.tone(m.ring * (0.9 + Math.random() * 0.3), m.ring, duration * 2.5, level * 0.12, 'sine');
  }

  tone(f0, f1, duration, level, type = 'sine') {
    const c = this.ctx, now = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + duration);
    const g = c.createGain();
    g.gain.setValueAtTime(level, now);
    g.gain.exponentialRampToValueAtTime(0.0005, now + duration);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + duration + 0.02);
  }

  dig(mat) { this.burst(mat, 0.16, 0.9); }
  hit(mat) { this.burst(mat, 0.07, 0.35, 1.2); }
  place(mat) { this.burst(mat, 0.1, 0.8, 0.8); if (this.ctx) this.tone(140, 70, 0.09, 0.25); }
  step(mat) { this.burst(mat, 0.08, 0.28); }

  splash() {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2400, now);
    f.frequency.exponentialRampToValueAtTime(250, now + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
    src.connect(f).connect(g).connect(this.master);
    src.start(now, 0, 0.6);
  }

  click() { if (this.ctx) this.tone(720, 540, 0.05, 0.12, 'square'); }
}

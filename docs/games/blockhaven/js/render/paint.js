// Tiny pixel-art toolkit shared by the block, item and mob texture generators.
import { mulberry32 } from '../core/noise.js?v=muo1ytra';

export const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const shade = (h, f) => toHex(hex(h).map(v => v * f));
export const mixHex = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
// Four-step ramp around a base colour: [dark, mid-dark, base, light].
export const ramp = (h, spread = 0.14) => [shade(h, 1 - spread * 2), shade(h, 1 - spread), h, shade(h, 1 + spread * 0.8)];

export class Painter {
  constructor(w, h, seed) {
    this.w = w; this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
    this.r = mulberry32((seed * 2654435761) >>> 0);
  }
  rand(n) { return Math.floor(this.r() * n); }
  chance(p) { return this.r() < p; }
  pick(a) { return a[this.rand(a.length)]; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  put(x, y, c, a = 255) {
    if (!this.inb(x, y)) return;
    const i = (y * this.w + x) * 4, v = typeof c === 'string' ? hex(c) : c;
    this.d[i] = v[0]; this.d[i + 1] = v[1]; this.d[i + 2] = v[2]; this.d[i + 3] = a;
  }
  wrapPut(x, y, c, a = 255) { this.put(((x % this.w) + this.w) % this.w, ((y % this.h) + this.h) % this.h, c, a); }
  get(x, y) { const i = (y * this.w + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  alpha(x, y) { return this.d[(y * this.w + x) * 4 + 3]; }
  clear() { this.d.fill(0); return this; }
  fill(c, a = 255) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.put(x, y, c, a); return this; }
  rect(x, y, w, h, c, a = 255) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.put(i, j, c, a); return this; }
  hline(x, y, w, c) { return this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { return this.rect(x, y, 1, h, c); }
  frame(x, y, w, h, c) { this.hline(x, y, w, c); this.hline(x, y + h - 1, w, c); this.vline(x, y, h, c); this.vline(x + w - 1, y, h, c); return this; }
  shadePx(x, y, f) { if (!this.inb(x, y)) return; const c = this.get(x, y); this.put(x, y, [c[0] * f, c[1] * f, c[2] * f], c[3]); }
  // Tileable smooth value noise in [0,1] with `cells` lattice cells across the texture.
  valueNoise(cells) {
    const g = Array.from({ length: cells * cells }, () => this.r());
    const at = (x, y) => g[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
    return (x, y) => {
      const fx = x / this.w * cells, fy = y / this.h * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  }
  // Palette noise: clumped choice between palette entries (index 0 darkest), crisp with no blending.
  noise(pal, { clump = 4, grain = 0.35, x0 = 0, y0 = 0, w = this.w, h = this.h } = {}) {
    const vn = this.valueNoise(clump);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const v = vn(x, y) * (1 - grain) + this.r() * grain;
      this.put(x, y, pal[Math.min(pal.length - 1, Math.floor(v * pal.length))]);
    }
    return this;
  }
  speck(pal, n, size = 1) {
    for (let k = 0; k < n; k++) {
      const x = this.rand(this.w), y = this.rand(this.h), c = this.pick(pal);
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) if (i + j < size + 1) this.wrapPut(x + i, y + j, c);
    }
    return this;
  }
  bevel(light, dark, x = 0, y = 0, w = this.w, h = this.h) {
    this.hline(x, y, w, light); this.vline(x, y, h, light);
    this.hline(x, y + h - 1, w, dark); this.vline(x + w - 1, y, h, dark);
    return this;
  }
  // Mark every opaque pixel as biome-tintable (alpha 254 is the shader's tint marker).
  tintMark(onlyIf = () => true) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = (y * this.w + x) * 4;
      if (this.d[i + 3] === 255 && onlyIf(x, y)) this.d[i + 3] = 254;
    }
    return this;
  }
  // Give transparent pixels their neighbours' average colour so mipmaps don't pull in black fringes.
  bleed() {
    let s = [0, 0, 0], n = 0;
    for (let i = 0; i < this.w * this.h; i++) if (this.d[i * 4 + 3] > 0) { s[0] += this.d[i * 4]; s[1] += this.d[i * 4 + 1]; s[2] += this.d[i * 4 + 2]; n++; }
    if (!n) return this;
    for (let i = 0; i < this.w * this.h; i++) if (this.d[i * 4 + 3] === 0) { this.d[i * 4] = s[0] / n; this.d[i * 4 + 1] = s[1] / n; this.d[i * 4 + 2] = s[2] / n; }
    return this;
  }
  copyFrom(other) { this.d.set(other.d); return this; }
}

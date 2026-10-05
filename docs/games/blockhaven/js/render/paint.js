// Tiny pixel-art toolkit shared by the block, item and mob texture generators.
import { mulberry32 } from '../core/noise.js?v=muujn2k9';

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
  // In the image, and inside the clip rectangle [x, y, w, h] when one is set (a model face being painted).
  inb(x, y) { const c = this.clip; return x >= 0 && y >= 0 && x < this.w && y < this.h && (!c || (x >= c[0] && y >= c[1] && x < c[0] + c[2] && y < c[1] + c[3])); }
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
  // Two-octave tileable value noise in [0,1]: soft blotches with a little finer variation on top.
  fbm(cells, oct = 2) { const a = this.valueNoise(cells), b = oct > 1 ? this.valueNoise(cells * 2) : null; return b ? (x, y) => a(x, y) * 0.65 + b(x, y) * 0.35 : a; }
  // Clumped n-tone fill with exact tone proportions (pal[i] covers weights[i]/sum of the area), assigned by
  // rank of blotchy noise plus per-pixel grain. This is the vanilla "soft 4-tone blotch" look for stone, dirt, wool...
  dither(pal, weights = null, { cells = 4, grain = 0.3, oct = 2, x0 = 0, y0 = 0, w = this.w, h = this.h } = {}) {
    const wts = weights || pal.map(() => 1), vn = this.fbm(cells, oct), vals = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) vals.push([vn(x, y) * (1 - grain) + this.r() * grain, x, y]);
    vals.sort((a, b) => a[0] - b[0]);
    const total = wts.reduce((a, c) => a + c, 0);
    let k = 0, acc = wts[0] / total * vals.length;
    vals.forEach(([, x, y], r) => { while (r >= acc && k < pal.length - 1) { k++; acc += wts[k] / total * vals.length; } this.put(x, y, pal[k]); });
    return this;
  }
  // n single-pixel flecks of pal, never adjacent to another fleck (vanilla stone's lone light/dark pixels).
  flecks(pal, n) {
    const used = new Set();
    for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      const x = this.rand(this.w), y = this.rand(this.h);
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) if (used.has(((y + dy + this.h) % this.h) * this.w + (x + dx + this.w) % this.w)) { ok = false; break; }
      if (!ok) continue;
      used.add(y * this.w + x); this.put(x, y, this.pick(pal)); k++;
    }
    return this;
  }
  // Angular pebbles: n small w x h chips of pal with a 1px darker shadow along the lower-right edge.
  pebbles(pal, n, { maxW = 3, maxH = 2, shadow = 0.78 } = {}) {
    for (let k = 0; k < n; k++) {
      const x = this.rand(this.w), y = this.rand(this.h), w = 1 + this.rand(maxW), h = 1 + this.rand(maxH), c = this.pick(pal);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.wrapPut(x + i, y + j, c);
      const sc = shade(c, shadow);
      for (let i = 0; i < w; i++) this.wrapPut(x + i, y + h, sc);
      for (let j = 0; j < h; j++) this.wrapPut(x + w, y + j, sc);
    }
    return this;
  }
  // Horizontal or vertical grain: n short runs of pal tones (length lo..hi) laid along an axis.
  streaks(pal, n, lo = 2, hi = 5, vertical = false) {
    for (let k = 0; k < n; k++) {
      const x = this.rand(this.w), y = this.rand(this.h), l = lo + this.rand(hi - lo + 1), c = this.pick(pal);
      for (let i = 0; i < l; i++) vertical ? this.wrapPut(x, y + i, c) : this.wrapPut(x + i, y, c);
    }
    return this;
  }
}

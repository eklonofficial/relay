// Mob skins: packs every model box into a 64x64 layer (MC-style box unwrap) and paints its faces.
import { Painter, shade, mixHex } from './paint.js?v=munkcr3r';

export const SKIN = 64;

// Shelf-pack box unwraps; shrinks texel density until everything fits.
export function packModel(model) {
  const boxes = [];
  for (const [name, part] of Object.entries(model.parts)) part.boxes.forEach((b, i) => boxes.push({ b, name, i }));
  for (const scale of [1, 0.75, 0.5, 0.375, 0.25, 0.18, 0.12, 0.08]) {
    let x = 0, y = 0, rowH = 0, ok = true;
    const sorted = boxes.slice().sort((a, b) => (b.b.s[2] + b.b.s[1]) - (a.b.s[2] + a.b.s[1]));
    const place = [];
    for (const e of sorted) {
      const us = e.b.s.map(v => Math.max(1, Math.round(v * scale * (e.b.texMul || 1))));
      const w = 2 * us[2] + 2 * us[0], h = us[2] + us[1];
      if (w > SKIN) { ok = false; break; }
      if (x + w > SKIN) { x = 0; y += rowH; rowH = 0; }
      if (y + h > SKIN) { ok = false; break; }
      place.push([e, x, y, us]);
      x += w; rowH = Math.max(rowH, h);
    }
    if (!ok) continue;
    for (const [e, px, py, us] of place) { e.b.uv = [px, py]; e.b.us = us; }
    model.tex = [SKIN, SKIN];
    return model;
  }
  throw new Error('model does not fit in a skin');
}

// Face rectangles of a packed box: { top, bottom, right(-X), front(-Z), left(+X), back(+Z) } -> [x, y, w, h]
export function faceRects(b) {
  const [u, v] = b.uv, [w, h, d] = b.us;
  return {
    top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
    right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + 2 * d + w, v + d, w, h],
  };
}

// Paint styles. A style is { pal: [4 colours dark..light], pattern?, decor?: { face: fn(p, x, y, w, h) } }.
export function paintModel(model, seed) {
  const p = new Painter(SKIN, SKIN, seed);
  for (const part of Object.values(model.parts)) {
    for (const b of part.boxes) {
      const st = b.style || part.style || model.style;
      if (!st) continue;
      const rects = faceRects(b);
      for (const [face, [x, y, w, h]] of Object.entries(rects)) {
        fillFace(p, x, y, w, h, st, face);
        const d = st.decor && (st.decor[face] || st.decor.all);
        if (d) d(p, x, y, w, h, face);
      }
    }
  }
  return p.d;
}

function fillFace(p, x, y, w, h, st, face) {
  const pal = st.pal;
  const pat = st.pattern || 'noise';
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let k;
    const r = p.r();
    switch (pat) {
      case 'flat': k = 2; break;
      case 'fur': k = r < 0.25 ? 1 : r < 0.85 ? 2 : 3; if ((i + j * 2) % 5 === 0) k = 1; break;
      case 'scales': k = ((i + (j % 2)) % 2) ? 1 : 2; if (r < 0.15) k = 3; break;
      case 'wool': k = r < 0.35 ? 1 : r < 0.8 ? 2 : 3; break;
      case 'gradient': k = j < h * 0.3 ? 3 : j < h * 0.7 ? 2 : 1; if (r < 0.2) k = Math.max(0, k - 1); break;
      case 'bones': k = 2; break;
      default: k = r < 0.2 ? 1 : r < 0.88 ? 2 : 3;
    }
    if (face === 'bottom') k = Math.max(0, k - 1);
    if (face === 'top' && k < 3 && r < 0.3) k++;
    p.put(x + i, y + j, pal[k]);
  }
}

// ---------- decoration helpers (relative coordinates inside a face rect) ----------
export const D = {
  eyes: ({ c = '#ffffff', pupil = '#1a1a1a', y = 0.45, sep = 0.25, size = 1, glow = false } = {}) => (p, x, fy, w, h) => {
    const ey = fy + Math.floor(h * y), s = Math.max(1, Math.round(size * w / 8));
    const cx = x + w / 2;
    for (const side of [-1, 1]) {
      const ex = Math.round(cx + side * w * sep - (side < 0 ? s : 0));
      p.rect(ex, ey, s, s, c);
      if (pupil) p.rect(side < 0 ? ex + s - 1 : ex, ey, 1, s, pupil);
    }
    void glow;
  },
  rect: (rx, ry, rw, rh, c) => (p, x, y, w, h) => p.rect(x + Math.floor(rx * w), y + Math.floor(ry * h), Math.max(1, Math.round(rw * w)), Math.max(1, Math.round(rh * h)), c),
  spots: (c, n = 5, size = 2) => (p, x, y, w, h) => { for (let k = 0; k < n; k++) { const sx = x + p.rand(Math.max(1, w - 1)), sy = y + p.rand(Math.max(1, h - 1)); p.rect(sx, sy, Math.min(size, w), Math.min(size, h), c); } },
  stripes: (c, every = 3, vertical = false) => (p, x, y, w, h) => { if (vertical) { for (let i = 0; i < w; i += every) p.vline(x + i, y, h, c); } else { for (let j = 0; j < h; j += every) p.hline(x, y + j, w, c); } },
  band: (ry0, ry1, c) => (p, x, y, w, h) => p.rect(x, y + Math.floor(ry0 * h), w, Math.max(1, Math.round((ry1 - ry0) * h)), c),
  frame: c => (p, x, y, w, h) => p.frame(x, y, w, h, c),
  all: (...fns) => (p, x, y, w, h, f) => fns.forEach(fn => fn(p, x, y, w, h, f)),
};

export const pal = (base, spread = 0.12) => [shade(base, 1 - spread * 2.2), shade(base, 1 - spread), base, shade(base, 1 + spread * 0.9)];
export { mixHex, shade };

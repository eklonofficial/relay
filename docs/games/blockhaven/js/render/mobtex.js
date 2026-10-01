// Mob skins: packs every model box into a 64x64 layer (MC-style box unwrap) and paints its faces.
import { Painter, shade, mixHex } from './paint.js?v=mupp1ffq';

export const SKIN = 64;

// Shelf-pack box unwraps; shrinks texel density until everything fits. The face box (head part, box 0) keeps up to 1.5x the
// density of the rest (never above 1:1) so faces stay readable on big mobs.
export function packModel(model) {
  const boxes = [];
  for (const [name, part] of Object.entries(model.parts)) part.boxes.forEach((b, i) => boxes.push({ b, name, i }));
  const tryPack = (scale, boost) => {
    let x = 0, y = 0, rowH = 0;
    const place = boxes.map(e => [e, e.b.s.map(v => Math.max(1, Math.round(v * Math.min(1, scale * (boost && e.name === 'head' && e.i === 0 ? 1.5 : 1)) * (e.b.texMul || 1))))]);
    place.sort((a, b) => (b[1][2] + b[1][1]) - (a[1][2] + a[1][1]) || (b[1][0] + b[1][2]) - (a[1][0] + a[1][2]));
    for (const q of place) {
      const us = q[1], w = 2 * us[2] + 2 * us[0], h = us[2] + us[1];
      if (w > SKIN) return false;
      if (x + w > SKIN) { x = 0; y += rowH; rowH = 0; }
      if (y + h > SKIN) return false;
      q.push(x, y); x += w; rowH = Math.max(rowH, h);
    }
    for (const [e, us, px, py] of place) { e.b.uv = [px, py]; e.b.us = us; }
    model.tex = [SKIN, SKIN];
    return true;
  };
  for (const scale of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25, 0.2, 0.18, 0.15, 0.12, 0.1, 0.08]) if (tryPack(scale, scale < 1) || tryPack(scale, false)) return model;
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

// Paint styles. A style is { pal: [4 colours dark..light], pattern?, decor?: { face: fn(p, x, y, w, h, face, st) } }.
// Faces: 'front' is -Z (the mob's face, drawn unmirrored); on 'right' (-X) column 0 touches the front, on 'left' (+X) the last column does.
export function paintModel(model, seed) {
  const p = new Painter(SKIN, SKIN, seed);
  p.n1 = p.valueNoise(22); p.n2 = p.valueNoise(9);   // ~3px and ~7px clumps, sampled in skin coordinates
  for (const part of Object.values(model.parts)) {
    for (const b of part.boxes) {
      const st = b.style || part.style || model.style;
      if (!st) continue;
      const rects = faceRects(b);
      for (const [face, [x, y, w, h]] of Object.entries(rects)) {
        fillFace(p, x, y, w, h, st, face);
        const d = st.decor && (st.decor[face] || (face === 'top' || face === 'bottom' ? st.decor.caps : face !== 'front' ? st.decor.sides : null) || st.decor.all);
        if (d) d(p, x, y, w, h, face, st);
      }
    }
  }
  return p.d;
}

const tone = (v, a, b, c) => v < a ? 0 : v < b ? 1 : v < c ? 2 : 3;
// Fills one face with its pattern: clumped (2-3px) palette noise, lit from the top, darker underneath.
function fillFace(p, x, y, w, h, st, face) {
  const pal = st.pal, pat = st.pattern || 'noise', n1 = p.n1, n2 = p.n2;
  const cap = face === 'top' ? 0.08 : face === 'bottom' ? -0.16 : 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const X = x + i, Y = y + j, r = p.r();
    const lit = cap + (cap || h < 4 ? 0 : (0.5 - (j + 0.5) / h) * 0.1);
    const v = n1(X, Y) * 0.7 + r * 0.3 + lit;
    let k;
    switch (pat) {
      case 'flat': k = r < 0.07 ? 1 : r > 0.95 ? 3 : 2; if (face === 'bottom') k--; break;
      case 'bones': case 'bone': k = tone(v, 0.08, 0.3, 0.8); break;
      case 'fur': k = tone(n1(X * 1.8, Y * 0.5) * 0.72 + r * 0.28 + lit, 0.12, 0.34, 0.74); break;
      case 'wool': { const row = Y / 3 | 0, cx = (X + (row & 1) * 2) & 3, cy = Y % 3;
        k = tone(n2(X, Y) * 0.35 + r * 0.35 + 0.18 + lit + (cx === 0 && cy === 0 ? 0.3 : cx === 3 || cy === 2 ? -0.18 : 0), 0.08, 0.34, 0.74); break; }
      case 'scales': { const cx = (X + ((Y >> 1) & 1) * 2) & 3, cy = Y & 1;
        k = tone(v * 0.6 + 0.2 + (cy === 0 && cx < 3 ? 0.18 : cx === 3 ? -0.22 : 0), 0.15, 0.36, 0.72); break; }
      case 'feathers': { const row = Y / 3 | 0, cx = (X + (row & 1) * 2) & 3, cy = Y % 3;
        k = tone(v * 0.5 + 0.25 + (cy === 0 ? 0.2 : cy === 2 && cx === 3 ? -0.3 : 0), 0.12, 0.3, 0.7); break; }
      case 'mottled': k = tone(n1(X * 1.6, Y * 1.6) * 0.45 + r * 0.55 + lit, 0.2, 0.42, 0.72); break;
      case 'metal': k = tone(n2(X, Y) * 0.5 + n1(X, Y) * 0.25 + r * 0.25 + lit, 0.16, 0.38, 0.72); break;
      case 'cloth': k = tone(n1(X * 2.4, Y * 0.4) * 0.6 + r * 0.25 + 0.08 + lit - ((X + Y) & 1) * 0.07, 0.1, 0.36, 0.8); break;
      case 'membrane': k = tone(v, 0.08, 0.3, 0.82); if (i % 4 === 1 && r < 0.85) k = 1; break;
      case 'rod': k = tone(v * 0.5 + 0.25 + (Y % 4 === 0 ? 0.25 : Y % 4 === 3 ? -0.25 : 0), 0.14, 0.34, 0.66); break;
      case 'belly': { const b = face === 'top' ? -0.2 : face === 'bottom' ? 0.45 : face === 'front' || face === 'back' ? 0 : ((j + 0.5) / h - 0.55) * 0.7;
        k = tone(n1(X, Y) * 0.6 + r * 0.25 + 0.08 + b, 0.1, 0.34, 0.7); break; }
      case 'slime': k = tone(n1(X, Y) * 0.35 + r * 0.5 + lit, 0.04, 0.14, 0.78); break;
      case 'gradient': k = tone((1 - (j + 0.5) / h) * 0.8 + r * 0.25 + cap, 0.18, 0.42, 0.72); break;
      default: k = tone(v, 0.1, 0.3, 0.76);
    }
    p.put(X, Y, pal[Math.max(0, Math.min(3, k))]);
  }
}

// ---------- decoration helpers (relative coordinates inside a face rect) ----------
const frontCol = (face, w, i = 0) => face === 'left' ? w - 1 - i : i;   // column i steps back from the front edge of a side face
const rowAt = (y, h, n = 1) => Math.max(0, Math.min(h - n, typeof y === 'number' && y >= 1 ? y : Math.floor(y * h)));
export const D = {
  // Two eyes: `ew`px wide (2 on faces 8px+), pupil on the inner (or outer) side; `gap` px apart or `sep` of the face width.
  eyes: ({ c = '#ffffff', pupil = '#1a1a1a', y = 0.45, sep = 0.12, gap, ew, eh = 1, out = false, shine = null } = {}) => (p, x, fy, w, h) => {
    const e = Math.min(ew ?? (w >= 8 ? 2 : 1), Math.max(1, (w - 1) >> 1));
    let g = Math.max(0, gap ?? Math.round(2 * w * sep));
    if ((w - 2 * e - g) & 1) g += g < w - 2 * e ? 1 : -1;
    const ey = fy + rowAt(y, h, eh), lx = x + ((w - 2 * e - g) >> 1), rx = lx + e + g;
    for (const [ex, inner] of [[lx, lx + e - 1], [rx, rx]]) {
      p.rect(ex, ey, e, eh, e === 1 && pupil ? pupil : c);
      if (pupil && e > 1) p.rect(out ? (inner === ex ? ex + e - 1 : ex) : inner, ey, 1, eh, pupil);
      if (shine) p.put(ex, ey, shine);
    }
  },
  // An eye on a side face, `from` px behind the front edge.
  sideEye: ({ c = '#1a1a1a', pupil = null, y = 0.35, from = 1, ew = 1, eh = 1 } = {}) => (p, x, fy, w, h, face) => {
    if (face !== 'left' && face !== 'right') return;
    const ey = fy + rowAt(y, h, eh);
    for (let i = 0; i < ew; i++) p.rect(x + frontCol(face, w, from + i), ey, 1, eh, i === 0 && pupil ? pupil : c);
  },
  // Centred horizontal bar (brows, mouths): bw < 1 is a fraction of the face width, otherwise pixels.
  bar: (c, y, bw = 1, bh = 1, dx = 0) => (p, x, fy, w, h) => {
    let n = Math.min(w, Math.max(1, bw < 1 ? Math.round(bw * w) : bw)); if ((w - n) & 1 && n < w) n++;
    p.rect(x + ((w - n) >> 1) + dx, fy + rowAt(y, h, bh), n, bh, c);
  },
  brow: (c, y = 0.3, inset = 1) => (p, x, fy, w, h) => p.rect(x + inset, fy + rowAt(y, h), w - 2 * inset, 1, c),
  mouth: (c = '#3a1a1a', y = 0.78, mw = 0.4) => D.bar(c, y, mw),
  // Nose: centred block with a lit top and a shadowed bottom row.
  nose: (c, y = 0.5, nw = 2, nh = 2) => (p, x, fy, w, h) => {
    const nx = x + ((w - nw) >> 1), ny = fy + rowAt(y, h, nh);
    p.rect(nx, ny, nw, nh, c); p.hline(nx, ny + nh - 1, nw, shade(c, 0.78)); p.put(nx, ny, shade(c, 1.1));
  },
  // Muzzle/snout area: a lighter block over the lower face (inset from the sides) with two nostrils.
  muzzle: (c, { y = 0.6, inset = 1, nostril = null, ny = 1, gap } = {}) => (p, x, fy, w, h) => {
    const y0 = rowAt(y, h), cw = w - 2 * inset;
    for (let j = y0; j < h; j++) for (let i = 0; i < cw; i++) p.put(x + inset + i, fy + j, p.r() < 0.18 ? shade(c, 0.92) : j === y0 && p.r() < 0.5 ? shade(c, 1.06) : c);
    if (nostril) { const g = gap ?? Math.max(1, Math.round(cw / 3)), lx = x + ((w - g - 2) >> 1); p.put(lx, fy + Math.min(h - 1, y0 + ny), nostril); p.put(lx + g + 1, fy + Math.min(h - 1, y0 + ny), nostril); }
  },
  // Pig/piglin snout face: pink plate with two dark nostril holes.
  snout: (nostril, lip = null) => (p, x, y, w, h) => {
    const nw = Math.max(1, Math.round(w / 4)), g = Math.max(1, w - 2 * nw - 2 * Math.max(0, Math.round(w / 8)));
    const lx = x + ((w - 2 * nw - g) >> 1), ny = y + Math.max(0, (h >> 1) - 1), nh = Math.max(1, h - 2);
    p.rect(lx, ny, nw, Math.min(nh, 2), nostril); p.rect(lx + nw + g, ny, nw, Math.min(nh, 2), nostril);
    if (lip) p.hline(x, y + h - 1, w, lip);
  },
  // Colour near the front edge of side faces (a muzzle wrapping around the sides).
  sideFront: (c, depth = 2, y0 = 0, y1 = 1) => (p, x, y, w, h, face) => {
    if (face !== 'left' && face !== 'right') return;
    for (let j = rowAt(y0, h); j < Math.max(1, Math.round(y1 * h)); j++) for (let i = 0; i < Math.min(depth, w); i++) p.put(x + frontCol(face, w, i), y + j, p.r() < 0.15 ? shade(c, 0.92) : c);
  },
  // Pixel art: rows of chars scaled to the face. '0'-'3' use the face's own palette, '.' skips, other chars come from `cols`.
  art: (rows, cols = {}) => (p, x, y, w, h, face, st) => {
    const mh = rows.length, mw = rows[0].length;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ch = rows[Math.floor(j * mh / h)][Math.floor(i * mw / w)];
      if (ch === '.' || ch === ' ') continue;
      const c = ch >= '0' && ch <= '3' ? st.pal[+ch] : cols[ch];
      if (c) p.put(x + i, y + j, c);
    }
  },
  // Irregular blobs (cow hide, panda, horse markings): noisy-edged ellipses, with a darker rim pixel now and then.
  patches: (c, n = 3, size = 3, rim = null) => (p, x, y, w, h) => {
    for (let k = 0; k < n; k++) {
      const cx = p.r() * w, cy = p.r() * h, rx = size * (0.7 + p.r() * 0.7), ry = size * (0.6 + p.r() * 0.6);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const dx = (i + 0.5 - cx) / rx, dy = (j + 0.5 - cy) / ry, d = dx * dx + dy * dy + (p.n1(x + i, y + j) - 0.5) * 0.9;
        if (d < 1) p.put(x + i, y + j, rim && d > 0.72 && p.r() < 0.5 ? rim : c);
      }
    }
  },
  rect: (rx, ry, rw, rh, c) => (p, x, y, w, h) => p.rect(x + Math.floor(rx * w), y + Math.floor(ry * h), Math.max(1, Math.round(rw * w)), Math.max(1, Math.round(rh * h)), c),
  spots: (c, n = 5, size = 2) => (p, x, y, w, h) => { for (let k = 0; k < n; k++) { const sx = x + p.rand(Math.max(1, w - 1)), sy = y + p.rand(Math.max(1, h - 1)); p.rect(sx, sy, Math.min(size, w), Math.min(size, h), c); } },
  stripes: (c, every = 3, vertical = false) => (p, x, y, w, h) => { if (vertical) { for (let i = 0; i < w; i += every) p.vline(x + i, y, h, c); } else { for (let j = 0; j < h; j += every) p.hline(x, y + j, w, c); } },
  band: (ry0, ry1, c) => (p, x, y, w, h) => p.rect(x, y + Math.floor(ry0 * h), w, Math.max(1, Math.round((ry1 - ry0) * h)), c),
  // Band whose lower (or upper) edge is ragged by a pixel either way: hair fringes, torn hems, boots.
  ragged: (ry0, ry1, c, jag = 1) => (p, x, y, w, h) => {
    const a = Math.floor(ry0 * h), b = Math.round(ry1 * h);
    for (let i = 0; i < w; i++) { const t = p.rand(2 * jag + 1) - jag, j0 = a > 0 ? a + t : 0, j1 = a > 0 ? b : b + t; for (let j = Math.max(0, j0); j < Math.min(h, j1); j++) p.put(x + i, y + j, typeof c === 'function' ? c(p) : c); }
  },
  // Clumped second colour mixed over the face (dirt, moss, rot); `amount` 0..1.
  blotch: (c, amount = 0.3, c2 = null) => (p, x, y, w, h) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = p.n1(x * 1.3 + i * 1.3 + 17, y + j + 5) * 0.8 + p.r() * 0.2; if (v > 1 - amount) p.put(x + i, y + j, c2 && v > 1 - amount * 0.4 ? c2 : c); }
  },
  // Vines hanging from the top edge with leaf pixels (iron golem).
  vines: (c = '#3e7a2a', leaf = '#5fa03a', n = 2) => (p, x, y, w, h) => {
    for (let k = 0; k < n; k++) {
      let i = p.rand(w); const len = 2 + p.rand(Math.max(1, h - 2));
      for (let j = 0; j < len; j++) { p.put(x + i, y + j, c); if (p.r() < 0.3) p.put(x + Math.max(0, Math.min(w - 1, i + (p.r() < 0.5 ? -1 : 1))), y + j, leaf); if (p.r() < 0.25) i = Math.max(0, Math.min(w - 1, i + (p.r() < 0.5 ? -1 : 1))); }
    }
  },
  // Thin dark crack lines.
  cracks: (c, n = 2, len = 4) => (p, x, y, w, h) => {
    for (let k = 0; k < n; k++) { let i = p.rand(w), j = p.rand(h); for (let s = 0; s < len; s++) { p.put(x + i, y + j, c); if (p.r() < 0.5) i += p.r() < 0.5 ? -1 : 1; else j++; if (i < 0 || i >= w || j >= h) break; } }
  },
  // Ribcage over a dark chest: collar bone, spine and rib rows.
  ribs: (bone, gap = '#2a2826') => (p, x, y, w, h) => {
    p.rect(x, y, w, h, gap); const m = x + (w >> 1);
    p.hline(x, y, w, bone); p.rect(m - 1, y, 2, h, shade(bone, 0.86));
    for (let j = 2; j < h - 2; j += 2) p.hline(x + 1, y + j, w - 2, j % 4 === 2 ? bone : shade(bone, 0.9));
    p.hline(x + 1, y + h - 2, w - 2, shade(bone, 0.9)); p.put(x + 1, y + h - 1, bone); p.put(x + w - 2, y + h - 1, bone);
  },
  // Plate/brick seams: rows every `ch`, joints every `cw` offset by half on alternate rows (shells, armour plates).
  grid: (c, cw = 4, ch = 4) => (p, x, y, w, h) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const row = Math.floor(j / ch); if (j % ch === ch - 1 || (i + (row & 1) * (cw >> 1)) % cw === cw - 1) p.put(x + i, y + j, c); }
  },
  // Glowing horizontal seams every `every` rows with random breaks (magma cube layers).
  seams: (c, hot, every = 3) => (p, x, y, w, h) => {
    for (let j = 1; j < h; j += every) for (let i = 0; i < w; i++) { const r = p.r(); if (r < 0.7) p.put(x + i, y + j, r < 0.12 ? hot : c); }
  },
  // Runs a decoration inside a horizontal slice (rows ry0..ry1) and optional column range of the face.
  at: (ry0, ry1, fn, rx0 = 0, rx1 = 1) => (p, x, y, w, h, f, st) => { const a = Math.round(ry0 * h), b = Math.max(a + 1, Math.round(ry1 * h)), l = Math.round(rx0 * w), r = Math.max(l + 1, Math.round(rx1 * w)); fn(p, x + l, y + a, r - l, b - a, f, st); },
  frame: c => (p, x, y, w, h) => p.frame(x, y, w, h, c),
  all: (...fns) => (p, x, y, w, h, f, st) => fns.forEach(fn => fn && fn(p, x, y, w, h, f, st)),
};

export const pal = (base, spread = 0.12) => [shade(base, 1 - spread * 2.2), shade(base, 1 - spread), base, shade(base, 1 + spread * 0.9)];
export { mixHex, shade };

// Procedural textures for the map's material families (maps/dsl.js MAT). Everything is drawn at
// start-up on canvases: low-poly, bright, with visible tile seams and triangle noise (GDD §25), and
// no image files to fetch. Each family has a base texture; maps tint them through per-cell variants.
import * as THREE from '../../vendor/three/three.module.js?v=muuo6ksf';

const S = 256;
// Deterministic noise so every player sees the same walls.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const hex = (c, k = 0) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = v => Math.max(0, Math.min(255, Math.round(v + k * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};
// Offscreen: these never enter any document.
function canvas() { return new OffscreenCanvas(S, S); }

// Triangle noise: the faceted, slightly varied flat colour the reference style uses on grass/dirt.
function triangles(x, base, amount, seed, cell = 32) {
  const r = rng(seed);
  for (let gy = 0; gy < S; gy += cell) for (let gx = 0; gx < S; gx += cell) {
    for (const flip of [0, 1]) {
      x.fillStyle = hex(base, (r() - 0.5) * amount);
      x.beginPath();
      if (flip) { x.moveTo(gx, gy); x.lineTo(gx + cell, gy); x.lineTo(gx, gy + cell); }
      else { x.moveTo(gx + cell, gy); x.lineTo(gx + cell, gy + cell); x.lineTo(gx, gy + cell); }
      x.closePath(); x.fill();
    }
  }
}
// Bricks/tiles in rows with offset joints and a soft bevel on each one.
function bricks(x, base, mortar, rows, cols, seed, vary = 0.06, bevel = 0.08) {
  const r = rng(seed), h = S / rows, w = S / cols;
  x.fillStyle = hex(mortar); x.fillRect(0, 0, S, S);
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? w / 2 : 0;
    for (let col = -1; col <= cols; col++) {
      const bx = col * w + off + 2, by = row * h + 2, bw = w - 4, bh = h - 4;
      const k = (r() - 0.5) * vary * 2;
      x.fillStyle = hex(base, k); x.fillRect(bx, by, bw, bh);
      x.fillStyle = hex(base, k + bevel); x.fillRect(bx, by, bw, 3);
      x.fillStyle = hex(base, k - bevel); x.fillRect(bx, by + bh - 3, bw, 3);
    }
  }
}
function planks(x, base, seed, n = 4) {
  const r = rng(seed), h = S / n;
  for (let i = 0; i < n; i++) {
    const k = (r() - 0.5) * 0.12;
    x.fillStyle = hex(base, k); x.fillRect(0, i * h, S, h);
    x.strokeStyle = hex(base, k - 0.06); x.lineWidth = 2;
    for (let g = 0; g < 5; g++) { const y = i * h + 6 + r() * (h - 12); x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 6, S * 0.6, y + (r() - 0.5) * 6, S, y); x.stroke(); }
    x.fillStyle = hex(base, -0.2); x.fillRect(0, i * h, S, 3);
    const seam = r() * S; x.fillRect(seam, i * h, 3, h);
  }
}
function speckle(x, base, amount, seed, count = 900, size = 3) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) { x.fillStyle = hex(base, (r() - 0.5) * amount); x.fillRect(r() * S, r() * S, size + r() * size, size + r() * size); }
}

const DRAW = {
  0: x => bricks(x, 0xb9b3a6, 0x8d877b, 4, 2, 11, 0.05, 0.06), // stone blocks
  1: x => triangles(x, 0x7cbf45, 0.10, 21, 32),                 // grass
  2: x => planks(x, 0xb07a45, 31),                               // wood
  3: x => bricks(x, 0xb3593d, 0x9b8f80, 8, 4, 41, 0.07, 0.07),   // brick
  4: x => { triangles(x, 0xe3cc8f, 0.05, 51, 64); speckle(x, 0xe3cc8f, 0.08, 52, 400, 2); }, // sand
  5: x => { x.fillStyle = hex(0x8c96a0); x.fillRect(0, 0, S, S); bricks(x, 0x949ea8, 0x6c7680, 2, 2, 61, 0.03, 0.1); for (const [a, b] of [[16, 16], [S - 20, 16], [16, S / 2 - 20], [S - 20, S / 2 - 20]]) { x.fillStyle = hex(0x5c6670); x.fillRect(a, b, 5, 5); } }, // metal
  6: x => { triangles(x, 0x8f6a45, 0.10, 71, 32); speckle(x, 0x8f6a45, 0.15, 72, 300, 3); }, // dirt
  7: x => { triangles(x, 0xe9e2d4, 0.04, 81, 64); speckle(x, 0xe9e2d4, 0.05, 82, 500, 2); }, // plaster
  8: x => bricks(x, 0x8c3b2a, 0x6c2b1e, 8, 3, 91, 0.06, 0.12),   // roof tiles
  9: x => bricks(x, 0x6f6c6a, 0x4f4c4a, 4, 2, 101, 0.06, 0.06),  // dark stone
  10: x => { triangles(x, 0xf2f7fb, 0.04, 111, 64); },           // snow
  11: x => { x.fillStyle = hex(0xc9ced6); x.fillRect(0, 0, S, S); x.strokeStyle = hex(0x8d939c); x.lineWidth = 4; x.strokeRect(6, 6, S - 12, S - 12); x.strokeRect(S / 4, S / 4, S / 2, S / 2); }, // space panel
  12: x => { planks(x, 0xc49058, 121, 3); x.strokeStyle = hex(0x7a5530); x.lineWidth = 14; x.strokeRect(7, 7, S - 14, S - 14); x.beginPath(); x.moveTo(14, 14); x.lineTo(S - 14, S - 14); x.stroke(); }, // crate
  13: x => { x.fillStyle = hex(0xe6c35c); x.fillRect(0, 0, S, S); const r = rng(131); x.strokeStyle = hex(0xc9a33e); x.lineWidth = 2; for (let i = 0; i < 200; i++) { const a = r() * S, b = r() * S; x.beginPath(); x.moveTo(a, b); x.lineTo(a + (r() - 0.5) * 40, b + (r() - 0.5) * 8); x.stroke(); } }, // hay
  14: x => { triangles(x, 0xa7a9ac, 0.08, 141, 64); const r = rng(142); for (let i = 0; i < 14; i++) { x.strokeStyle = hex(0x86888b); x.lineWidth = 3; x.beginPath(); x.arc(r() * S, r() * S, 6 + r() * 18, 0, 6.3); x.stroke(); } }, // moon rock
  15: x => { x.fillStyle = hex(0xe8b42e); x.fillRect(0, 0, S, S); speckle(x, 0xe8b42e, 0.15, 151, 300, 3); }, // gold
  16: x => { triangles(x, 0x4f9a3a, 0.14, 161, 32); },          // leaves
  17: x => { triangles(x, 0x4aa3d8, 0.06, 171, 64); },          // water
  18: x => { triangles(x, 0xd24b3e, 0.06, 181, 64); },          // red team paint
  19: x => { triangles(x, 0x3f7fd6, 0.06, 191, 64); },          // blue team paint
};

const cache = new Map();
export function materialTexture(id) {
  if (cache.has(id)) return cache.get(id);
  const c = canvas(), x = c.getContext('2d');
  (DRAW[id] || DRAW[0])(x);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(id, t);
  return t;
}
// World units per texture repeat, per family (bricks look right at 2 cells, grass at 4).
export const TEX_SCALE = { 1: 0.25, 4: 0.25, 6: 0.25, 10: 0.25, 14: 0.25, 16: 0.5, 17: 0.25, 7: 0.25 };

const mats = new Map();
export function worldMaterial(id) {
  if (mats.has(id)) return mats.get(id);
  const m = new THREE.MeshLambertMaterial({ map: materialTexture(id), vertexColors: true });
  if (id === 17) { m.transparent = true; m.opacity = 0.8; }
  mats.set(id, m);
  return m;
}

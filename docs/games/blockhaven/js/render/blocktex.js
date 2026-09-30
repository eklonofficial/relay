// Procedural 16x16 block textures. Every name registered in data/blocks.js must be drawable here.
import { Painter, ramp, shade, mixHex, hex } from './paint.js?v=muo1whx0';
import { TEXTURES, COLORS } from '../data/blocks.js?v=muo1whx0';

const N = 16;

export const DYE = {
  white: '#e9ecec', orange: '#f07613', magenta: '#bd44b3', light_blue: '#3aafd9', yellow: '#f8c627', lime: '#70b919',
  pink: '#ed8dac', gray: '#3e4447', light_gray: '#8e8e86', cyan: '#158991', purple: '#792aac', blue: '#35399d',
  brown: '#724728', green: '#546d1b', red: '#a12722', black: '#141519',
};
const CONCRETE = {
  white: '#cfd5d6', orange: '#e06101', magenta: '#a9309f', light_blue: '#2489c7', yellow: '#f1af15', lime: '#5ea918',
  pink: '#d5658e', gray: '#36393d', light_gray: '#7d7d73', cyan: '#157788', purple: '#64209c', blue: '#2c2e8f',
  brown: '#603b1f', green: '#495b24', red: '#8e2121', black: '#080a0f',
};
const TERRA = {
  white: '#d1b1a1', orange: '#a15325', magenta: '#95576c', light_blue: '#716c89', yellow: '#ba8523', lime: '#677534',
  pink: '#a14e4e', gray: '#392a23', light_gray: '#876a61', cyan: '#565b5b', purple: '#764656', blue: '#4a3b5b',
  brown: '#4d3323', green: '#4c532a', red: '#8f3d2e', black: '#251610',
};

const WOOD = {
  oak: { planks: '#a2824e', bark: '#6b5536', inner: '#b29157', ring: '#8f7043' },
  spruce: { planks: '#735531', bark: '#3b2716', inner: '#7a5a36', ring: '#5c4225' },
  birch: { planks: '#c5b77b', bark: '#d8d7d2', inner: '#c8b77a', ring: '#a89660', birch: true },
  jungle: { planks: '#a0734d', bark: '#574519', inner: '#aa7954', ring: '#8a5f3c' },
  acacia: { planks: '#a8592f', bark: '#676157', inner: '#b45b32', ring: '#914824' },
  dark_oak: { planks: '#4f3218', bark: '#3c2e1a', inner: '#50361d', ring: '#3e2a15' },
  cherry: { planks: '#e3b3ac', bark: '#3b1e26', inner: '#e1b4ae', ring: '#c9938d' },
  mangrove: { planks: '#773630', bark: '#574330', inner: '#7a3b35', ring: '#632c27' },
  crimson: { planks: '#6a344b', bark: '#5c1a1e', inner: '#8e3a52', ring: '#6f2c40', glow: '#d6533b' },
  warped: { planks: '#2b6863', bark: '#3a3b4e', inner: '#39a098', ring: '#2c7a74', glow: '#15c3b3' },
};

// ---------- families ----------

function stoneLike(p, base, { spread = 0.12, clump = 4, grain = 0.4, specks = null, streak = null } = {}) {
  p.noise(ramp(base, spread), { clump, grain });
  if (specks) p.speck(specks, 10);
  if (streak) for (let k = 0; k < 4; k++) { const x = p.rand(N), y = p.rand(N), l = 2 + p.rand(3); for (let i = 0; i < l; i++) p.wrapPut(x + i, y, streak); }
  return p;
}

function polished(p, base) {
  const r = ramp(base, 0.07);
  p.noise(r.slice(1, 4), { clump: 2, grain: 0.15 });
  p.bevel(shade(base, 1.18), shade(base, 0.72));
  p.bevel(shade(base, 1.08), shade(base, 0.85), 1, 1, 14, 14);
  return p;
}

function cobble(p, base, moss) {
  const pts = Array.from({ length: 10 }, () => [p.r() * N, p.r() * N]);
  const shadesArr = [1.1, 1.0, 0.92, 1.18, 0.86, 1.05, 0.97, 1.12, 0.9, 1.0];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let d1 = 1e9, d2 = 1e9, id = 0;
    pts.forEach(([px, py], i) => {
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const d = Math.hypot(x + 0.5 - px - ox * N, y + 0.5 - py - oy * N);
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
    });
    const edge = d2 - d1;
    const [px, py] = pts[id];
    const dx = x + 0.5 - px, dy = y + 0.5 - py;
    let c;
    if (edge < 0.9) c = shade(base, 0.7);
    else {
      c = shade(base, shadesArr[id] * 1.08);
      if (edge < 1.8 && (dx > 0 || dy > 0)) c = shade(c, 0.84);          // shadowed lower-right rim
      else if (edge < 2.2 && dx < 0 && dy < 0) c = shade(c, 1.16);      // lit upper-left rim
      if (p.chance(0.1)) c = shade(c, 0.93);
    }
    p.put(x, y, c);
  }
  if (moss) {
    const vn = p.valueNoise(4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (vn(x, y) > 0.56) p.put(x, y, p.pick(['#5a7a2a', '#4d6b24', '#6b8c38', '#43611f']));
  }
  return p;
}

function bricks(p, brick, mortar, { rowH = 4, w = 8, bevel = true } = {}) {
  for (let y = 0; y < N; y++) {
    const row = Math.floor(y / rowH), ly = y % rowH;
    const off = row % 2 ? w / 2 : 0;
    for (let x = 0; x < N; x++) {
      const lx = (x + off) % w;
      if (ly === rowH - 1 || lx === w - 1) { p.put(x, y, shade(mortar, p.chance(0.3) ? 0.93 : 1)); continue; }
      const id = Math.floor((x + off) / w) + row * 7;
      let c = shade(brick, [1, 0.94, 1.06, 0.9, 1.03][id % 5]);
      if (bevel && ly === 0) c = shade(c, 1.1);
      if (bevel && ly === rowH - 2) c = shade(c, 0.9);
      p.put(x, y, p.chance(0.12) ? shade(c, 0.92) : c);
    }
  }
  return p;
}

function bigBricks(p, base, mortar) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const top = y < 8, ly = y % 8, seams = top ? [7, 15] : [3, 11];
    let c;
    if (ly === 7 || seams.includes(x)) c = mortar;
    else if (ly === 0 || seams.includes((x + 15) % 16)) c = shade(base, 1.12);
    else if (ly === 6 || seams.includes((x + 1) % 16)) c = shade(base, 0.84);
    else c = shade(base, p.pick([1, 0.97, 1.03, 0.95]));
    p.put(x, y, c);
  }
  return p;
}

function planks(p, base) {
  const shades = [1, 0.93, 1.06, 0.97];
  for (let y = 0; y < N; y++) {
    const board = y >> 2, c0 = shade(base, shades[board]);
    for (let x = 0; x < N; x++) {
      let c = c0;
      if (y % 4 === 3) c = shade(base, 0.68);
      else if (x === (board * 5 + 3) % 16) c = shade(base, 0.75);
      else if (y % 4 === 0) c = shade(c0, 1.06);
      else if (p.chance(0.12)) c = shade(c0, 0.9);
      p.put(x, y, c);
    }
  }
  return p;
}

function logSide(p, w) {
  const W = WOOD[w];
  if (W.birch) {
    p.noise(['#c9c7bf', '#d8d7d2', '#e4e3de', '#d1d0c9'], { clump: 3, grain: 0.3 });
    for (let k = 0; k < 7; k++) {
      const x = p.rand(N), y = p.rand(N), len = 2 + p.rand(4);
      for (let i = 0; i < len; i++) p.wrapPut(x + i, y, i === 0 || i === len - 1 ? '#5a5a52' : '#27271f');
    }
    return p;
  }
  const r = ramp(W.bark, 0.14);
  for (let x = 0; x < N; x++) {
    const col = r[[2, 1, 2, 3, 2, 1, 0, 2][(x * 5 + (x >> 2)) % 8]];
    for (let y = 0; y < N; y++) p.put(x, y, p.chance(0.18) ? p.pick(r) : col);
  }
  for (let k = 0; k < 6; k++) { const x = p.rand(N), y = p.rand(N), l = 3 + p.rand(6); for (let i = 0; i < l; i++) p.wrapPut(x, y + i, r[0]); }
  if (W.glow) p.speck([W.glow], 5);
  return p;
}

function logTop(p, w) {
  const W = WOOD[w];
  const ringCols = [W.inner, W.ring, W.inner, shade(W.inner, 1.06), W.ring, W.inner, shade(W.ring, 0.95)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (r > 6.6) p.put(x, y, shade(W.bark, p.chance(0.3) ? 0.85 : 1));
    else p.put(x, y, ringCols[Math.floor(r) % ringCols.length]);
  }
  return p;
}

function leaves(p, pal, tint) {
  const vn = p.valueNoise(5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (p.chance(0.18) && vn(x, y) < 0.7) { p.put(x, y, [0, 0, 0], 0); continue; }
    const v = vn(x, y) * 0.6 + p.r() * 0.4;
    p.put(x, y, pal[Math.min(pal.length - 1, Math.floor(v * pal.length))]);
  }
  if (tint) p.tintMark();
  return p.bleed();
}

function oreOn(p, baseFn, colors) {
  baseFn(p);
  // Four or five clusters spread over the face (one per quadrant), each a blob of ore pixels
  // with a bright top-left glint and a dark bottom-right edge.
  const quads = [[1, 1], [8, 1], [1, 8], [8, 8], [4, 5]].slice(0, 4 + p.rand(2));
  for (const [qx, qy] of quads) {
    const cx = qx + 1 + p.rand(4), cy = qy + 1 + p.rand(4);
    const cells = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [2, 1], [1, 2], [0, -1], [2, 0], [-1, 1], [2, 2], [3, 1], [0, 2]].slice(0, 7 + p.rand(6));
    const set = new Set(cells.map(([a, b]) => a + ',' + b));
    for (const [dx, dy] of cells) {
      const lit = !set.has((dx - 1) + ',' + dy) && !set.has(dx + ',' + (dy - 1));
      const dark = !set.has((dx + 1) + ',' + dy) && !set.has(dx + ',' + (dy + 1));
      p.put(cx + dx, cy + dy, lit ? colors[colors.length - 1] : dark ? colors[0] : colors[1 + ((dx + dy) & 1) % (colors.length - 2)]);
    }
  }
  return p;
}

const toWhite = (hex, t) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => Math.round(c + (255 - c) * t)); };
// Assigns palette colours by rank of a noise field, so the colour proportions are exact.
function byRank(p, pal, cluster, after) {
  const vn = p.valueNoise(3), vals = [];
  for (let i = 0; i < N * N; i++) vals.push([(1 - cluster) * p.r() + cluster * vn(i % N, i / N | 0), i]);
  vals.sort((a, b) => a[0] - b[0]);
  const total = pal.reduce((a, c) => a + c[1], 0);
  let k = 0, acc = pal[0][1] / total * N * N;
  vals.forEach(([, i], r) => { while (r >= acc && k < pal.length - 1) { k++; acc += pal[k][1] / total * N * N; } p.put(i % N, i / N | 0, pal[k][0]); });
  if (after) after();
  return p;
}
function erfinv(x) { const a = 0.147, l = Math.log(1 - x * x), t = 2 / (Math.PI * a) + l / 2; return Math.sign(x) * Math.sqrt(Math.sqrt(t * t - l / a) - t); }
function mineral(p, base, style) {
  const r = ramp(base, 0.12);
  p.noise(r.slice(1), { clump: 3, grain: 0.2 });
  if (style === 'lines') for (let y = 1; y < N; y += 4) p.hline(1, y, 14, r[3]);
  if (style === 'facets' || style === 'shiny') {
    // Polished metal/gem: smooth fill with diagonal glints, like light catching a cut face.
    p.noise([r[1], r[2], r[2]], { clump: 5, grain: 0.1 });
    for (const [x0, y0, len] of [[3, 2, 5], [9, 5, 4], [4, 9, 6], [11, 11, 3]]) for (let i = 0; i < len; i++) { p.wrapPut(x0 + i, y0 + i, toWhite(base, 0.55)); p.wrapPut(x0 + i + 1, y0 + i, toWhite(base, 0.3)); }
  }
  if (style === 'dots') p.speck([r[0], r[3]], 18);
  p.bevel(shade(base, 1.25), shade(base, 0.62));
  return p;
}

function wool(p, base) {
  const r = ramp(base, 0.07);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const k = ((x + y * 3) % 4 === 0) ? 0 : ((x * 3 - y) % 5 === 0) ? 3 : p.chance(0.5) ? 2 : 1;
    p.put(x, y, r[k]);
  }
  return p;
}

function crossClear(p) { return p.clear(); }

function stem(p, x, y0, y1, col) { for (let y = y0; y <= y1; y++) p.put(x, y, col); }

function flower(p, petals, center, { headY = 5, r = 2.6, stemCol = '#3f8a2b', shape = 'round' } = {}) {
  crossClear(p);
  stem(p, 7, headY + 1, 15, stemCol); stem(p, 8, 12, 15, stemCol);
  p.put(6, 11, '#4ea235'); p.put(5, 10, '#4ea235'); p.put(9, 12, '#4ea235'); p.put(10, 11, '#4ea235');
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - 7.5, dy = y - headY;
    let inside = dx * dx + dy * dy < r * r;
    if (shape === 'tulip') inside = Math.abs(dx) < 2 && y >= headY - 2 && y <= headY + 1;
    if (shape === 'star') inside = (Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.6) && dx * dx + dy * dy < r * r;
    if (inside) p.put(x, y, petals[(x + y) % petals.length]);
  }
  if (center) { p.put(7, Math.round(headY), center); p.put(8, Math.round(headY), center); }
  return p.bleed();
}

function mushroomSprite(p, cap, spots) {
  crossClear(p);
  p.rect(7, 9, 2, 6, '#d9d2c4'); p.put(7, 14, '#b9b2a4');
  for (let y = 4; y <= 9; y++) for (let x = 3; x <= 12; x++) {
    const dx = x - 7.5, dy = (y - 9) * 1.4;
    if (dx * dx + dy * dy < 22 && y <= 9) p.put(x, y, y === 9 ? shade(cap, 0.8) : cap);
  }
  if (spots) for (const [x, y] of [[5, 6], [9, 5], [11, 7], [7, 7]]) p.put(x, y, '#f2f2f2');
  return p.bleed();
}

function grassBlades(p, colFn, count = 9, tint = true) {
  crossClear(p);
  for (let b = 0; b < count; b++) {
    let x = 1 + p.rand(14);
    const h = 5 + p.rand(10), lean = p.chance(0.5) ? -1 : 1;
    for (let i = 0; i < h; i++) {
      if (i > h * 0.6 && p.chance(0.35)) x += lean;
      p.put(x, 15 - i, colFn(i, h));
    }
  }
  if (tint) p.tintMark();
  return p.bleed();
}

function crop(p, stage, max, kind) {
  crossClear(p);
  const t = stage / (max - 1);
  const h = 3 + Math.round(t * 11);
  const green = t > 0.85 && kind === 'wheat' ? ['#b89b3a', '#c8ad48', '#a58a2f'] : ['#3f8a2b', '#57a33a', '#2f7021'];
  for (const x of [2, 5, 8, 11, 14]) {
    for (let i = 0; i < h; i++) p.put(x + (i > h - 3 && x % 2 ? 1 : 0), 15 - i, green[i % green.length]);
    if (kind === 'wheat' && t > 0.5) for (let i = h - 4; i < h; i++) p.put(x - 1, 15 - i, t > 0.85 ? '#d8bd5a' : '#7fae44');
  }
  if (stage === max - 1 && kind !== 'wheat') {
    const c = kind === 'carrots' ? '#f08a19' : kind === 'potatoes' ? '#c9a55a' : '#8e2b3e';
    for (const x of [2, 8, 14]) { p.put(x, 14, c); p.put(x + 1, 14, c); p.put(x, 15, shade(c, 0.85)); }
  }
  return p.bleed();
}

function doorTex(p, w, top) {
  const iron = w === 'iron';
  const base = iron ? '#c9c9c9' : WOOD[w].planks;
  planks(p, base);
  p.frame(0, 0, 16, 16, shade(base, 0.62));
  p.frame(1, 1, 14, 14, shade(base, 0.8));
  if (top && !iron) {
    for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) p.rect(x, y, 4, 4, '#000000', 0);
  }
  if (iron) {
    p.clear(); p.fill('#c4c4c4');
    p.frame(0, 0, 16, 16, '#8c8c8c');
    for (let y = 2; y < 16; y += 4) p.hline(2, y, 12, '#dadada');
    if (top) { p.rect(3, 3, 4, 4, '#000000', 0); p.rect(9, 3, 4, 4, '#000000', 0); }
    p.put(12, top ? 13 : 3, '#707070');
  } else p.put(12, top ? 14 : 2, shade(base, 0.5));
  return p.bleed();
}

function trapdoorTex(p, w) {
  const iron = w === 'iron', base = iron ? '#c4c4c4' : WOOD[w].planks;
  p.fill(base);
  planks(p, base);
  p.frame(0, 0, 16, 16, shade(base, 0.62));
  for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) p.rect(x, y, 4, 4, '#000000', 0);
  return p.bleed();
}

function torchTex(p, flame, stick = '#6e4f2a') {
  crossClear(p);
  for (let y = 6; y < 16; y++) { p.put(7, y, shade(stick, 1.1)); p.put(8, y, stick); }
  p.put(7, 6, flame[0]); p.put(8, 6, flame[1]);
  p.put(7, 7, flame[2]); p.put(8, 7, flame[1]);
  p.put(7, 8, flame[2]); p.put(8, 8, shade(stick, 0.8));
  return p.bleed();
}

function glassTex(p, border, inside, alphaIn) {
  p.fill(inside, alphaIn);
  p.frame(0, 0, 16, 16, border);
  for (let i = 0; i < 4; i++) { p.put(3 + i, 6 - i, shade(border, 1.05), Math.max(alphaIn, 200)); p.put(9 + i, 12 - i, shade(border, 1.05), Math.max(alphaIn, 200)); }
  return p;
}

function sandstoneSide(p, base, top) {
  p.noise(ramp(base, 0.05).slice(1), { clump: 3, grain: 0.3 });
  for (let y = 4; y < 11; y++) for (let x = 0; x < N; x++) if (Math.sin(x * 0.9 + y * 1.7) + Math.sin(x * 0.4 - y * 1.1) > 1.1) p.put(x, y, shade(base, 0.9));
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < 3; y++) p.put(x, y, shade(top, p.chance(0.2) ? 0.95 : 1));
    p.put(x, 3, shade(base, 0.85));
    p.put(x, 11, shade(base, 0.88));
    p.put(x, 13, shade(base, 0.92));
  }
  return p;
}

function portalTex(p) {
  const vn = p.valueNoise(4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = vn(x, y);
    p.put(x, y, v > 0.7 ? '#d68cff' : v > 0.5 ? '#9b3ff0' : v > 0.3 ? '#6a17c7' : '#4a0a99', 200);
  }
  return p;
}

// ---------- named textures ----------

// Skull faces live in the centre 8x8 of the tile (the head is an 8-pixel cube).
const skull = (p, pal) => { p.noise(pal, { clump: 2, grain: 0.25 }); return p; };
const skullFace = (p, dark) => { p.rect(5, 7, 2, 2, dark); p.rect(9, 7, 2, 2, dark); p.rect(7, 9, 2, 1, dark); for (let x = 5; x < 11; x += 2) p.rect(x, 11, 1, 1, dark); return p; };
const G = {
  // stones
  stone: p => {
    stoneLike(p, '#7d7d7d', { spread: 0.1, clump: 3, grain: 0.35 });
    // Horizontal streaks of lighter and darker stone, like the original's strata.
    for (let k = 0; k < 9; k++) { const x = p.rand(N), y = p.rand(N), l = 2 + p.rand(4), c = k % 3 === 0 ? '#9a9a9a' : k % 3 === 1 ? '#686868' : '#747474'; for (let i = 0; i < l; i++) p.wrapPut(x + i, y, c); if (l > 3) p.wrapPut(x + 1, y + 1, c); }
    return p;
  },
  granite: p => stoneLike(p, '#9a6b57', { specks: ['#c49a86', '#6e4a3c', '#b0806c'] }),
  polished_granite: p => polished(p, '#9e6b58'),
  diorite: p => { p.noise(['#8e8e8e', '#a8a8a8', '#d0d0d0', '#e6e6e6', '#f4f4f4'], { clump: 2, grain: 0.7 }); return p.speck(['#6e6e6e', '#ffffff'], 10); },
  polished_diorite: p => polished(p, '#c2c2c4'),
  andesite: p => stoneLike(p, '#888889', { specks: ['#a5a5a6', '#6b6b6c'] }),
  polished_andesite: p => polished(p, '#848687'),
  smooth_stone: p => { p.noise(ramp('#9f9f9f', 0.04).slice(1), { clump: 2, grain: 0.2 }); return p.frame(0, 0, 16, 16, '#8b8b8b'); },
  smooth_stone_side: p => { G.smooth_stone(p); p.hline(0, 7, 16, '#8b8b8b'); return p; },
  deepslate: p => { stoneLike(p, '#4d4d52', { spread: 0.1, grain: 0.3 }); for (let y = 1; y < N; y += 3) for (let x = 0; x < N; x++) if (p.chance(0.55)) p.put(x, y, '#3b3b40'); return p; },
  deepslate_top: p => { stoneLike(p, '#50505a', { spread: 0.1 }); for (let r = 2; r < 8; r += 2) p.frame(7 - r, 7 - r, r * 2 + 2, r * 2 + 2, '#3e3e44'); return p; },
  cobbled_deepslate: p => cobble(p, '#57575c'),
  polished_deepslate: p => polished(p, '#4a4a4f'),
  deepslate_bricks: p => bricks(p, '#4e4e53', '#2e2e32', { rowH: 4, w: 8 }),
  deepslate_tiles: p => bricks(p, '#39393d', '#232326', { rowH: 8, w: 8 }),
  tuff: p => stoneLike(p, '#6c6d65', { specks: ['#8a8b82', '#54554e', '#7e7a6e'] }),
  calcite: p => stoneLike(p, '#dfe0dc', { spread: 0.05, specks: ['#c8c9c4', '#f2f2ef'] }),
  dripstone_block: p => { stoneLike(p, '#866b5c', { spread: 0.1, clump: 3 }); for (let x = 1; x < N; x += 3) for (let y = 0; y < N; y++) if (p.chance(0.5)) p.put(x, y, '#6f5649'); return p; },
  cobblestone: p => cobble(p, '#808080'),
  mossy_cobblestone: p => cobble(p, '#7a7a7a', true),
  bedrock: p => p.noise(['#1f1f1f', '#3b3b3b', '#575757', '#7a7a7a'], { clump: 5, grain: 0.55 }),
  obsidian: p => {
    p.noise(['#0d0a14', '#130e1c', '#191226', '#1e1630'], { clump: 4, grain: 0.3 });
    for (let k = 0; k < 7; k++) { let x = p.rand(N), y = p.rand(N); const c = p.pick(['#2e2150', '#3b2a63', '#4a3780']); for (let i = 0; i < 3 + p.rand(4); i++) { p.wrapPut(x, y, c); x += p.rand(2); y += p.chance(0.5) ? 1 : 0; } }
    return p.speck(['#5a4596'], 4);
  },
  crying_obsidian: p => { G.obsidian(p); return p.speck(['#8a2be2', '#b35cff', '#d08cff'], 12); },
  netherrack: p => { p.noise(['#4f1f1f', '#6b2a2a', '#7a3333', '#8d3d3a'], { clump: 5, grain: 0.35 }); return p.speck(['#a65151', '#3f1717'], 10); },
  end_stone: p => { p.noise(['#cfd29a', '#dbde9f', '#e3e6ae', '#c5c88e'], { clump: 4, grain: 0.3 }); return p.speck(['#b7ba7e', '#eef0c4'], 12); },
  blackstone: p => { p.noise(['#1d1a1d', '#2a2528', '#342e32', '#3d363b'], { clump: 4, grain: 0.35 }); return p.speck(['#4a4248'], 8); },
  blackstone_top: p => { G.blackstone(p); for (let r = 2; r < 8; r += 3) p.frame(7 - r, 7 - r, r * 2 + 2, r * 2 + 2, '#251f23'); return p; },
  polished_blackstone: p => polished(p, '#35303a'),
  polished_blackstone_bricks: p => bricks(p, '#35303a', '#1e1a20', { rowH: 4, w: 8 }),
  gilded_blackstone: p => { G.blackstone(p); return p.speck(['#f2c94c', '#d9a520', '#fff08a'], 12, 2); },
  basalt_side: p => { for (let x = 0; x < N; x++) { const c = ['#4b4b50', '#575760', '#3e3e44', '#505055'][x % 4 === 0 ? 2 : p.rand(4)]; for (let y = 0; y < N; y++) p.put(x, y, p.chance(0.15) ? '#36363b' : c); } return p; },
  basalt_top: p => { p.noise(['#3e3e44', '#4b4b50', '#57575f'], { clump: 3 }); for (let r = 1; r < 8; r += 2) p.frame(7 - r, 7 - r, r * 2 + 2, r * 2 + 2, '#36363b'); return p; },
  polished_basalt_side: p => { for (let x = 0; x < N; x++) { const c = x % 4 === 0 ? '#3a3a40' : x % 4 === 1 ? '#6a6a72' : '#55555c'; for (let y = 0; y < N; y++) p.put(x, y, c); } return p; },
  polished_basalt_top: p => polished(p, '#5a5a62'),
  magma_block: p => { p.noise(['#3a1409', '#4d1d0c', '#62250f'], { clump: 4, grain: 0.3 }); const vn = p.valueNoise(5); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = vn(x, y); if (v > 0.47 && v < 0.53) p.put(x, y, '#ff8f1f'); else if (v > 0.44 && v < 0.56) p.put(x, y, '#c9480f'); } return p; },
  // dirt family
  // Four browns in the classic proportions, loosely clustered, plus a few grey pebbles.
  dirt: p => byRank(p, [['#593d29', 34], ['#79553a', 107], ['#966c4a', 68], ['#b9855c', 39]], 0.3, () => { for (let k = 0; k < 7; k++) p.put(p.rand(N), p.rand(N), k % 2 ? '#878787' : '#6c6c6c'); }),
  coarse_dirt: p => { G.dirt(p); return p.speck(['#5a5a5a', '#747474', '#4a3526'], 22); },
  rooted_dirt: p => { G.dirt(p); for (let k = 0; k < 5; k++) { let x = p.rand(N), y = p.rand(N); for (let i = 0; i < 5; i++) { p.wrapPut(x, y, '#a88a64'); x += p.rand(3) - 1; y++; } } return p; },
  mud: p => p.noise(['#2f2a2c', '#3a3438', '#443d41', '#4e464a'], { clump: 4, grain: 0.3 }),
  packed_mud: p => { p.noise(['#8a6a4f', '#94735a', '#9e7c60', '#7d5f45'], { clump: 3, grain: 0.35 }); return p.speck(['#c7b08b'], 10); },
  clay: p => { p.noise(['#9a9fad', '#a0a5b3', '#a6abba', '#959aa8'], { clump: 3, grain: 0.3 }); return p.speck(['#8a8f9c'], 12); },
  podzol_top: p => { p.noise(['#5b3d1f', '#6d4a27', '#7a5530', '#4e3419'], { clump: 4, grain: 0.4 }); return p.speck(['#8b6a3a', '#3f2a14'], 14); },
  podzol_side: p => { G.dirt(p); for (let x = 0; x < N; x++) { const d = 2 + p.rand(3); for (let y = 0; y < d; y++) p.put(x, y, p.pick(['#5b3d1f', '#6d4a27', '#7a5530'])); } return p; },
  mycelium_top: p => { p.noise(['#6a5c64', '#76686f', '#82737b', '#5d5057'], { clump: 4, grain: 0.4 }); return p.speck(['#9d8c96', '#b8a8b2'], 12); },
  mycelium_side: p => { G.dirt(p); for (let x = 0; x < N; x++) { const d = 3 + p.rand(2); for (let y = 0; y < d; y++) p.put(x, y, p.pick(['#6a5c64', '#76686f', '#82737b'])); } return p; },
  // Fine per-pixel grey noise (tinted by the biome): a bell curve of ~60 shades around 145.
  grass_block_top: p => {
    const vn = p.valueNoise(3), vals = [];
    for (let i = 0; i < N * N; i++) vals.push([0.78 * p.r() + 0.22 * vn(i % N, i / N | 0), i]);
    vals.sort((a, b) => a[0] - b[0]);
    vals.forEach(([, i], r) => { const q = (r + 0.5) / (N * N); const z = Math.sqrt(2) * erfinv(2 * q - 1); const g = Math.max(112, Math.min(195, Math.round(145 + z * 17))); p.put(i % N, i / N | 0, [g, g, g]); });
    return p.tintMark();
  },
  grass_block_side: p => {
    G.dirt(p);
    // A ragged 1-4 pixel fringe of grass, each column on its own, with a shadow row under it.
    for (let x = 0; x < N; x++) {
      const r = p.r(), d = r < 0.08 ? 1 : r < 0.33 ? 2 : r < 0.8 ? 3 : 4;
      for (let y = 0; y < d; y++) { const g = y === d - 1 && p.chance(0.4) ? 125 + p.rand(20) : 145 + p.rand(34); p.put(x, y, [g, g, g], 254); }
      if (p.chance(0.55)) p.put(x, d, '#593d29');
    }
    return p;
  },
  grass_block_snow: p => { G.dirt(p); for (let x = 0; x < N; x++) { const d = 3 + p.rand(3); for (let y = 0; y < d; y++) p.put(x, y, y === d - 1 ? '#cdd6de' : p.pick(['#f4f8fb', '#e8eef4', '#ffffff'])); } return p; },
  snow: p => { p.noise(['#dfe7ee', '#eaf0f5', '#f4f8fb', '#ffffff'], { clump: 4, grain: 0.35 }); return p; },
  farmland: p => { G.dirt(p); for (let y = 0; y < N; y += 4) p.hline(0, y, 16, '#5a3e2a'); p.frame(0, 0, 16, 16, '#5f412c'); return p; },
  farmland_moist: p => { G.farmland(p); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) p.shadePx(x, y, 0.62); return p; },
  dirt_path_top: p => p.noise(['#8d7542', '#9a8049', '#a58a52', '#7f6a3a'], { clump: 4, grain: 0.35 }),
  dirt_path_side: p => { G.dirt(p); for (let x = 0; x < N; x++) { p.put(x, 0, '#9a8049'); p.put(x, 1, '#8d7542'); if (p.chance(0.5)) p.put(x, 2, '#7f6a3a'); } p.rect(0, 0, 16, 1, '#000000', 0); return p.bleed(); },
  sand: p => { p.noise(['#d2c994', '#dbd3a0', '#e3dbad', '#ece4b8'], { clump: 4, grain: 0.45 }); return p.speck(['#c7bd83'], 6); },
  red_sand: p => { p.noise(['#a4531d', '#b05b21', '#bd6427', '#c46c2f'], { clump: 4, grain: 0.45 }); return p.speck(['#8f4617'], 6); },
  gravel: p => { p.noise(['#62605e', '#7d7875', '#8a8583', '#a29c99'], { clump: 2, grain: 0.5 }); for (let k = 0; k < 24; k++) { const x = p.rand(N), y = p.rand(N), c = p.pick(['#a8a09a', '#5f5a58', '#9d9896', '#6b6360', '#b3aca6']); p.wrapPut(x, y, c); p.wrapPut(x + 1, y, c); p.wrapPut(x, y + 1, shade(c, 0.85)); } return p; },
  soul_sand: p => { p.noise(['#3d2e25', '#4a382c', '#554134', '#5e4a3b'], { clump: 4, grain: 0.4 }); for (let k = 0; k < 4; k++) { const x = 2 + p.rand(11), y = 2 + p.rand(11); p.put(x, y, '#2a1e18'); p.put(x + 2, y, '#2a1e18'); p.hline(x, y + 2, 3, '#2a1e18'); } return p; },
  soul_soil: p => p.noise(['#3a2c24', '#44342a', '#4d3b30', '#574436'], { clump: 5, grain: 0.35 }),
  moss_block: p => p.noise(['#4e6b25', '#597a2b', '#648a31', '#6f9837'], { clump: 5, grain: 0.4 }),
  crimson_nylium: p => { p.noise(['#7b0000', '#8e1414', '#a41e1e', '#b52626'], { clump: 5, grain: 0.4 }); return p.speck(['#d64a3a'], 6); },
  crimson_nylium_side: p => { G.netherrack(p); for (let x = 0; x < N; x++) { const d = 2 + p.rand(3); for (let y = 0; y < d; y++) p.put(x, y, p.pick(['#8e1414', '#a41e1e', '#7b0000'])); } return p; },
  warped_nylium: p => { p.noise(['#16635a', '#1a7568', '#1f8a7a', '#26998a'], { clump: 5, grain: 0.4 }); return p.speck(['#5ce6d1'], 6); },
  warped_nylium_side: p => { G.netherrack(p); for (let x = 0; x < N; x++) { const d = 2 + p.rand(3); for (let y = 0; y < d; y++) p.put(x, y, p.pick(['#16635a', '#1a7568', '#1f8a7a'])); } return p; },
  // sandstone
  sandstone: p => sandstoneSide(p, '#d8cb94', '#e0d6a3'),
  sandstone_top: p => p.noise(['#d8cc96', '#e0d6a3', '#e6dcab', '#d2c68f'], { clump: 4, grain: 0.3 }),
  sandstone_bottom: p => { G.sandstone_top(p); return p.speck(['#c9bb82'], 12); },
  cut_sandstone: p => { G.sandstone_top(p); p.frame(0, 0, 16, 16, '#c9bb82'); p.hline(1, 7, 14, '#c9bb82'); return p; },
  chiseled_sandstone: p => { G.cut_sandstone(p); p.frame(4, 3, 8, 10, '#b8a96f'); p.rect(6, 5, 1, 2, '#9e8f58'); p.rect(9, 5, 1, 2, '#9e8f58'); p.rect(7, 8, 2, 3, '#9e8f58'); return p; },
  red_sandstone: p => sandstoneSide(p, '#b5621f', '#c46c2f'),
  red_sandstone_top: p => p.noise(['#b5621f', '#bd6727', '#c46c2f', '#a8591b'], { clump: 4, grain: 0.3 }),
  red_sandstone_bottom: p => { G.red_sandstone_top(p); return p.speck(['#99501a'], 12); },
  cut_red_sandstone: p => { G.red_sandstone_top(p); p.frame(0, 0, 16, 16, '#99501a'); p.hline(1, 7, 14, '#99501a'); return p; },
  chiseled_red_sandstone: p => { G.cut_red_sandstone(p); p.frame(4, 3, 8, 10, '#8a4716'); p.rect(7, 6, 2, 5, '#7a3e12'); return p; },
  // plants
  short_grass: p => grassBlades(p, (i, h) => i > h - 3 ? '#c4c4c4' : p.pick(['#9a9a9a', '#8a8a8a', '#a8a8a8'])),
  fern: p => { crossClear(p); for (const [x0, lean] of [[4, -1], [8, 0], [11, 1]]) { let x = x0; for (let i = 0; i < 12; i++) { p.put(x, 15 - i, i % 2 ? '#8e8e8e' : '#a0a0a0'); if (i % 3 === 1) { p.put(x - 1, 15 - i, '#8a8a8a'); p.put(x + 1, 15 - i, '#8a8a8a'); } if (i > 6 && i % 3 === 0) x += lean; } } return p.tintMark().bleed(); },
  dead_bush: p => { crossClear(p); const br = (x, y, dx, len) => { for (let i = 0; i < len; i++) { p.put(x, y, p.pick(['#8a6a3a', '#6e5230', '#7d5e34'])); y--; if (i % 2) x += dx; if (p.chance(0.2) && len > 4) br(x, y, -dx, len - i - 2); } }; br(7, 15, -1, 9); br(8, 15, 1, 10); br(8, 12, 1, 5); return p.bleed(); },
  crimson_roots: p => grassBlades(p, (i, h) => i > h - 3 ? '#e0513f' : p.pick(['#8e1d1d', '#a42a2a', '#7a1616']), 7, false),
  warped_roots: p => grassBlades(p, (i, h) => i > h - 3 ? '#39d1b8' : p.pick(['#127a6a', '#159a86', '#0f5f53']), 7, false),
  crimson_fungus: p => mushroomSprite(p, '#a82828', true),
  warped_fungus: p => mushroomSprite(p, '#138b7b', true),
  nether_sprouts: p => grassBlades(p, () => p.pick(['#18a98f', '#12806c', '#22c2a5']), 12, false),
  sugar_cane: p => { crossClear(p); for (const x of [3, 8, 12]) for (let y = 0; y < N; y++) { p.put(x, y, y % 5 === 0 ? '#8a8a8a' : '#b0b0b0'); p.put(x + 1, y, '#9a9a9a'); if (y % 5 === 2) p.put(x + 2, y, '#a4a4a4'); } return p.tintMark().bleed(); },
  seagrass: p => grassBlades(p, (i, h) => i > h - 3 ? '#5fb55a' : p.pick(['#2f8a3a', '#3b9a44', '#277a31']), 8, false),
  kelp: p => { crossClear(p); for (let y = 0; y < N; y++) { const x = 7 + Math.round(Math.sin(y * 0.8)); p.put(x, y, '#5a8a2a'); p.put(x + 1, y, '#4a7a22'); if (y % 3 === 0) { p.put(x - 1, y, '#6b9a34'); p.put(x + 2, y, '#6b9a34'); } } return p.bleed(); },
  sweet_berry_bush: p => { grassBlades(p, () => p.pick(['#2f5a2a', '#3a6b33', '#274f23']), 12, false); for (const [x, y] of [[4, 8], [10, 6], [7, 11], [12, 10]]) { p.put(x, y, '#c42a3a'); p.put(x + 1, y, '#a31e2c'); } return p; },
  cave_vines: p => { crossClear(p); for (let y = 0; y < N; y++) { p.put(7, y, '#4a6b24'); p.put(8, y, y % 3 ? '#5a7a2a' : '#3f5c1f'); } for (const y of [4, 10]) { p.rect(5, y, 2, 2, '#f6a632'); p.rect(9, y + 2, 2, 2, '#ffc75a'); } return p.bleed(); },
  glow_lichen: p => { crossClear(p); p.speck(['#6fa38a', '#86b89e', '#9fd4b8'], 40, 2); return p.bleed(); },
  vine: p => { crossClear(p); for (let k = 0; k < 5; k++) { let x = p.rand(N); for (let y = 0; y < N; y++) { p.put(x, y, p.pick(['#8e8e8e', '#9e9e9e', '#7c7c7c'])); if (p.chance(0.3)) p.put(x + 1, y, '#a8a8a8'); if (p.chance(0.2)) x = (x + (p.chance(0.5) ? 1 : 15)) % 16; } } return p.tintMark().bleed(); },
  lily_pad: p => { crossClear(p); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const dx = x - 7.5, dy = y - 7.5, d = dx * dx + dy * dy; if (d < 50 && !(dy < 0 && Math.abs(dx) < Math.abs(dy) * 0.35)) p.put(x, y, d > 40 ? '#1f6a1f' : p.pick(['#2a8a2a', '#248024', '#319a31'])); } return p.bleed(); },
  bamboo_stalk: p => { p.fill('#5d8a2a'); for (let y = 0; y < N; y += 5) p.hline(0, y, 16, '#7fae3c'); p.vline(7, 0, 16, '#4a7a1f'); return p; },
  cobweb: p => { crossClear(p); for (let i = 0; i < N; i++) { p.put(i, i, '#e8e8e8'); p.put(15 - i, i, '#e8e8e8'); p.put(7, i, '#dcdcdc'); p.put(i, 7, '#dcdcdc'); } for (const r of [3, 6]) p.frame(7 - r, 7 - r, r * 2 + 2, r * 2 + 2, '#d0d0d0'); return p.bleed(); },
  amethyst_cluster: p => { crossClear(p); for (const [x, h] of [[4, 8], [7, 13], [10, 10], [12, 6]]) for (let i = 0; i < h; i++) { p.put(x, 15 - i, i > h - 3 ? '#fcd2ff' : '#b67cf0'); p.put(x + 1, 15 - i, '#8a4fcf'); } return p.bleed(); },
  pointed_dripstone: p => { crossClear(p); for (let i = 0; i < 14; i++) { const w = Math.max(1, Math.round((14 - i) / 4)); p.rect(8 - w, 15 - i, w * 2, 1, i % 3 ? '#866b5c' : '#6f5649'); } return p.bleed(); },
  // flowers
  dandelion: p => flower(p, ['#f7d51d', '#e6b90f', '#fff06a'], '#c99a0a', { headY: 7, r: 2.2 }),
  poppy: p => flower(p, ['#d8322a', '#b3241e', '#f04a3a'], '#3a1a10', { headY: 5, r: 2.9 }),
  blue_orchid: p => flower(p, ['#3aa0e8', '#2a7fcc', '#7fcaf7'], '#1c5a99', { headY: 5, r: 2.9, shape: 'star' }),
  allium: p => flower(p, ['#b35fdb', '#9a44c7', '#d08cf0'], null, { headY: 4, r: 3.2 }),
  azure_bluet: p => flower(p, ['#e8ecf2', '#ffffff', '#d4d9e2'], '#e6c830', { headY: 7, r: 2.4, shape: 'star' }),
  red_tulip: p => flower(p, ['#d8322a', '#b3241e'], null, { headY: 5, shape: 'tulip' }),
  orange_tulip: p => flower(p, ['#f08a19', '#d86f0f'], null, { headY: 5, shape: 'tulip' }),
  white_tulip: p => flower(p, ['#f2f2f2', '#dadada'], null, { headY: 5, shape: 'tulip' }),
  pink_tulip: p => flower(p, ['#f2a0c4', '#e07aa8'], null, { headY: 5, shape: 'tulip' }),
  oxeye_daisy: p => flower(p, ['#f5f5f5', '#e2e2e2'], '#f0c419', { headY: 5, r: 3, shape: 'star' }),
  cornflower: p => flower(p, ['#4a6ee0', '#3656c7', '#7a95f0'], '#23357a', { headY: 5, r: 2.7, shape: 'star' }),
  lily_of_the_valley: p => { flower(p, ['#ffffff'], null, { headY: 20 }); for (const [x, y] of [[5, 5], [9, 3], [10, 7], [4, 8]]) { p.put(x, y, '#ffffff'); p.put(x, y + 1, '#e6e6e6'); } return p; },
  wither_rose: p => flower(p, ['#1f1a1a', '#2e2626', '#141111'], '#3a2a2a', { headY: 5, r: 2.9, stemCol: '#2f3a22' }),
  red_mushroom: p => mushroomSprite(p, '#d42a2a', true),
  brown_mushroom: p => mushroomSprite(p, '#9a6b48', false),
  torchflower: p => flower(p, ['#f08a19', '#ffb347', '#e0521a'], '#6b3a10', { headY: 5, r: 3, shape: 'star' }),
  // saplings
  ...Object.fromEntries(['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'cherry', 'mangrove'].map(w => [`sapling_${w}`, p => {
    crossClear(p);
    const leaf = { oak: '#3f7a26', spruce: '#2f5d3a', birch: '#6a9a3c', jungle: '#3c8a1f', acacia: '#5a8a24', dark_oak: '#2f5a1c', cherry: '#f0a8c8', mangrove: '#4a8a2a' }[w];
    p.rect(7, 9, 2, 7, WOOD[w].bark);
    for (let y = 1; y < 11; y++) for (let x = 2; x < 14; x++) { const d = Math.abs(x - 7.5) + Math.abs(y - 6) * 1.2; if (d < 6.5 && p.chance(0.85)) p.put(x, y, shade(leaf, p.pick([0.85, 1, 1.12]))); }
    return p.bleed();
  }])),
  // functional
  torch: p => torchTex(p, ['#fff3a0', '#ffd24a', '#ff9f2a']),
  torch_top: p => { p.clear(); p.rect(7, 7, 2, 2, '#ffd24a'); return p.bleed(); },
  soul_torch: p => torchTex(p, ['#b8fbff', '#5ee9f2', '#3aa6c7']),
  soul_torch_top: p => { p.clear(); p.rect(7, 7, 2, 2, '#5ee9f2'); return p.bleed(); },
  lantern: p => { p.clear(); p.rect(5, 9, 6, 7, '#3c3c46'); p.rect(6, 10, 4, 5, '#ffcf5a'); p.rect(7, 11, 2, 3, '#fff2b3'); p.hline(5, 12, 6, '#2e2e36'); p.rect(6, 7, 4, 2, '#4a4a55'); p.rect(5, 5, 6, 4, '#4a4a55'); p.rect(6, 6, 4, 2, '#5c5c68'); return p.bleed(); },
  soul_lantern: p => { G.lantern(p); p.rect(6, 10, 4, 5, '#5ee9f2'); p.rect(7, 11, 2, 3, '#c9fbff'); return p; },
  lantern_hanging: p => G.lantern(p),
  crafting_table_top: p => { planks(p, '#b08a52'); p.frame(0, 0, 16, 16, '#5c4424'); p.frame(1, 1, 14, 14, '#8a6a3a'); for (const k of [5, 10]) { p.hline(2, k, 12, '#6a5030'); p.vline(k, 2, 12, '#6a5030'); } return p; },
  crafting_table_side: p => { planks(p, '#a2824e'); p.rect(0, 0, 16, 3, '#7a5d38'); p.rect(3, 6, 4, 6, '#5e5e5e'); p.rect(4, 5, 2, 1, '#8c8c8c'); p.rect(10, 5, 2, 8, '#6e5433'); p.rect(9, 5, 4, 2, '#8c8c8c'); return p; },
  crafting_table_front: p => { G.crafting_table_side(p); p.rect(4, 8, 8, 5, '#6e5433'); p.rect(5, 9, 2, 3, '#c0c0c0'); p.rect(9, 9, 2, 3, '#c0c0c0'); return p; },
  furnace_side: p => { stoneLike(p, '#737373', { spread: 0.08 }); p.frame(0, 0, 16, 16, '#5a5a5a'); return p; },
  furnace_top: p => { G.furnace_side(p); p.frame(2, 2, 12, 12, '#5f5f5f'); return p; },
  furnace_front: p => {
    G.furnace_side(p);
    const arch = (y0, h, dark, rim) => { for (let y = y0; y < y0 + h; y++) for (let x = 3; x < 13; x++) { const inset = y === y0 ? 2 : y === y0 + 1 ? 1 : 0; if (x < 3 + inset || x > 12 - inset) continue; const edge = x === 3 + inset || x === 12 - inset || y === y0 || y === y0 + h - 1; p.put(x, y, edge ? rim : dark); } };
    arch(2, 5, '#3a3a3a', '#555555');
    arch(9, 5, '#1c1c1c', '#454545');
    p.hline(3, 8, 10, '#5e5e5e');
    return p;
  },
  furnace_front_on: p => { G.furnace_front(p); p.rect(4, 9, 8, 4, '#3a1a08'); p.rect(5, 11, 6, 2, '#ff8f1f'); p.rect(6, 10, 4, 1, '#ffd24a'); p.put(7, 9, '#fff3a0'); return p; },
  chest_top: p => { planks(p, '#a1742e'); p.frame(0, 0, 16, 16, '#4a3312'); p.frame(1, 1, 14, 14, '#6e4f1f'); return p; },
  chest_side: p => { planks(p, '#a1742e'); p.frame(0, 0, 16, 16, '#4a3312'); p.hline(0, 5, 16, '#4a3312'); return p; },
  chest_front: p => { G.chest_side(p); p.rect(7, 4, 2, 4, '#c9c9c9'); p.rect(7, 7, 2, 1, '#7a7a7a'); return p; },
  bed_side: p => { p.fill('#8e1f1f'); p.rect(0, 0, 16, 3, '#b52a2a'); p.rect(0, 9, 16, 7, '#000000', 0); p.rect(0, 9, 2, 7, '#a2824e'); p.rect(14, 9, 2, 7, '#a2824e'); return p.bleed(); },
  bed_top_foot: p => { p.fill('#b52a2a'); p.noise(['#a12626', '#b52a2a', '#c23232'], { clump: 3, grain: 0.2 }); p.frame(0, 0, 16, 16, '#8e1f1f'); return p; },
  bed_top_head: p => { G.bed_top_foot(p); p.rect(1, 1, 14, 6, '#ececec'); p.frame(1, 1, 14, 6, '#cfcfcf'); return p; },
  ladder: p => { p.clear(); for (let y = 0; y < N; y++) { p.put(2, y, '#7a5d38'); p.put(3, y, '#8e6d42'); p.put(12, y, '#7a5d38'); p.put(13, y, '#8e6d42'); } for (let y = 1; y < N; y += 4) { p.hline(2, y, 12, '#9c7a4a'); p.hline(2, y + 1, 12, '#6e5433'); } return p.bleed(); },
  glass: p => glassTex(p, '#dbeef5', '#dbeef5', 0),
  iron_bars: p => { p.clear(); for (const x of [1, 5, 10, 14]) p.rect(x, 0, 1, 16, '#9a9a9a'); p.hline(0, 1, 16, '#8a8a8a'); p.hline(0, 14, 16, '#8a8a8a'); return p.bleed(); },
  tnt_side: p => {
    p.fill('#d9432e'); for (let x = 0; x < N; x += 4) { p.vline(x, 0, 16, '#b8331f'); p.vline(x + 2, 0, 16, '#e0543c'); }
    p.rect(0, 5, 16, 6, '#e8e1d0'); p.hline(0, 5, 16, '#c8c0ae'); p.hline(0, 10, 16, '#c8c0ae');
    const k = '#1e1e1e';
    // T
    p.hline(2, 6, 3, k); p.vline(3, 6, 4, k);
    // N
    p.vline(6, 6, 4, k); p.vline(9, 6, 4, k); p.put(7, 7, k); p.put(8, 8, k);
    // T
    p.hline(11, 6, 3, k); p.vline(12, 6, 4, k);
    return p;
  },
  tnt_top: p => { p.fill('#d9432e'); p.rect(4, 4, 8, 8, '#b8331f'); p.rect(7, 7, 2, 2, '#3a3a3a'); return p; },
  tnt_bottom: p => { p.fill('#b8331f'); p.frame(0, 0, 16, 16, '#9a2a18'); return p; },
  bookshelf: p => {
    planks(p, '#a2824e');
    const books = ['#8f2f2f', '#2f4f8f', '#3f7f3f', '#8f7f2f', '#6f3f7f', '#2f6f6f', '#b0b0b0', '#a0522d'];
    for (const [y0, y1] of [[1, 6], [9, 14]]) { let x = 1; while (x < 15) { const w = 1 + p.rand(2), c = p.pick(books), gap = p.chance(0.1); for (let dx = 0; dx < w && x + dx < 15; dx++) for (let y = y0; y <= y1; y++) p.put(x + dx, y, gap ? '#2a1f14' : y === y0 + 1 ? shade(c, 1.25) : c); x += w; } }
    return p;
  },
  pumpkin_side: p => { p.noise(['#d67b12', '#e38a1d', '#ef9a2c'], { clump: 2, grain: 0.3 }); for (const x of [0, 4, 8, 12]) p.vline(x, 0, 16, '#b8640f'); return p; },
  pumpkin_top: p => { p.noise(['#d67b12', '#e38a1d', '#ef9a2c'], { clump: 2, grain: 0.3 }); for (let i = 0; i < N; i++) { p.put(i, 7, '#c56f12'); p.put(7, i, '#c56f12'); } p.rect(7, 6, 2, 3, '#5a7a2a'); return p; },
  carved_pumpkin: p => { G.pumpkin_side(p); p.rect(3, 4, 3, 3, '#3a2008'); p.rect(10, 4, 3, 3, '#3a2008'); p.rect(3, 10, 10, 2, '#3a2008'); p.rect(5, 12, 2, 1, '#3a2008'); p.rect(9, 12, 2, 1, '#3a2008'); return p; },
  jack_o_lantern: p => { G.carved_pumpkin(p); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (p.get(x, y)[0] === 0x3a) p.put(x, y, y < 8 ? '#ffe46a' : '#ffc233'); return p; },
  melon_side: p => { p.fill('#6e9a24'); for (let x = 0; x < N; x += 3) p.vline(x, 0, 16, '#4f7a14'); p.speck(['#8ab83a'], 10); return p; },
  melon_top: p => { p.noise(['#6e9a24', '#7aa82c', '#5f8a1c'], { clump: 3 }); p.frame(0, 0, 16, 16, '#4f7a14'); return p; },
  hay_block_side: p => { p.fill('#c9a82b'); for (let x = 0; x < N; x++) if (x % 2) p.vline(x, 0, 16, '#b8961f'); p.hline(0, 4, 16, '#8a5f1a'); p.hline(0, 11, 16, '#8a5f1a'); return p; },
  hay_block_top: p => { p.noise(['#c9a82b', '#b8961f', '#d8b83a'], { clump: 2, grain: 0.6 }); return p.frame(0, 0, 16, 16, '#8a6f1a'); },
  spawner: p => { p.clear(); for (let i = 0; i < N; i += 3) { p.vline(i, 0, 16, '#2a3a4a'); p.hline(0, i, 16, '#2a3a4a'); } p.frame(0, 0, 16, 16, '#1a2530'); return p.bleed(); },
  rail: p => { p.clear(); for (let y = 1; y < N; y += 3) p.hline(2, y, 12, '#6e5433'); for (let y = 0; y < N; y++) { p.put(3, y, '#9a9a9a'); p.put(12, y, '#9a9a9a'); } return p.bleed(); },
  jukebox_side: p => { planks(p, '#6a4630'); p.frame(0, 0, 16, 16, '#4a2f1f'); p.hline(0, 7, 16, '#4a2f1f'); return p; },
  jukebox_top: p => { G.jukebox_side(p); p.rect(3, 3, 10, 10, '#2a2a2a'); p.rect(5, 7, 6, 2, '#1a1a1a'); return p; },
  note_block: p => { planks(p, '#6a4630'); p.frame(0, 0, 16, 16, '#4a2f1f'); p.rect(6, 4, 1, 7, '#1a1a1a'); p.rect(4, 10, 3, 2, '#1a1a1a'); p.rect(7, 4, 3, 1, '#1a1a1a'); return p; },
  barrel_side: p => { planks(p, '#7a5a36'); p.hline(0, 2, 16, '#4a4a4a'); p.hline(0, 13, 16, '#4a4a4a'); return p; },
  barrel_top: p => { planks(p, '#8a6a42'); p.frame(0, 0, 16, 16, '#4a4a4a'); p.rect(6, 6, 4, 4, '#3a2a1a'); return p; },
  sea_lantern: p => { p.noise(['#b8d8d0', '#d0ece6', '#e6f8f4'], { clump: 3, grain: 0.3 }); p.frame(0, 0, 16, 16, '#8ab8ae'); p.frame(3, 3, 10, 10, '#f6fffd'); return p; },
  redstone_lamp: p => { p.noise(['#d99a3f', '#f0b85a', '#ffd88a'], { clump: 3, grain: 0.35 }); p.frame(0, 0, 16, 16, '#8a4f1f'); p.hline(0, 7, 16, '#8a4f1f'); p.vline(7, 0, 16, '#8a4f1f'); return p; },
  sponge: p => { p.noise(['#c7b83a', '#d4c64a', '#b8a92c'], { clump: 3 }); return p.speck(['#8a7a1a', '#9e8f22'], 20); },
  wet_sponge: p => { p.noise(['#9a9a3a', '#a8a84a', '#8a8a2c'], { clump: 3 }); return p.speck(['#5a5a1a'], 20); },
  target_side: p => { G.hay_block_side(p); for (const r of [2, 5]) p.frame(7 - r, 7 - r, r * 2 + 2, r * 2 + 2, '#d94a3a'); p.rect(7, 7, 2, 2, '#d94a3a'); return p; },
  target_top: p => G.target_side(p),
  end_portal_frame_side: p => { G.end_stone(p); p.rect(0, 0, 16, 4, '#3a6b5a'); p.hline(0, 4, 16, '#2a4a3f'); return p; },
  end_portal_frame_top: p => { p.noise(['#3a6b5a', '#447a68', '#2f5a4a'], { clump: 3 }); p.frame(0, 0, 16, 16, '#2a4a3f'); p.rect(4, 4, 8, 8, '#16302a'); return p; },
  end_portal_frame_eye: p => { p.clear(); p.rect(4, 4, 8, 8, '#2a8a6a'); p.rect(5, 5, 6, 6, '#3aba8a'); p.rect(6, 6, 4, 4, '#0a2a1a'); p.rect(7, 7, 2, 2, '#50e0a0'); return p.bleed(); },
  end_portal: p => { p.fill('#060b12'); p.speck(['#1f4a5a', '#2d6b6b', '#3a8a8a', '#5ab8a8'], 20); return p; },
  end_rod: p => { p.clear(); p.rect(7, 0, 2, 15, '#f2eee6'); p.rect(6, 14, 4, 2, '#d8c9b8'); return p.bleed(); },
  dragon_egg: p => { p.noise(['#0c0812', '#140d1e', '#1c1228'], { clump: 3 }); return p.speck(['#3a2860', '#553a8a'], 12); },
  chorus_plant: p => { p.noise(['#5a3a5a', '#6b456b', '#7d527d'], { clump: 3 }); p.speck(['#3a233a'], 10); return p; },
  chorus_flower: p => { p.noise(['#9a7a9a', '#b08cb0', '#c29ec2'], { clump: 3 }); p.frame(0, 0, 16, 16, '#6b456b'); return p; },
  purpur_block: p => { p.noise(['#9a6b9a', '#a97aa9', '#b88ab8'], { clump: 3, grain: 0.3 }); return p.bevel('#c69ec6', '#7d527d'); },
  purpur_pillar: p => { for (let x = 0; x < N; x++) { const c = x % 4 === 0 ? '#7d527d' : x % 4 === 1 ? '#c69ec6' : '#a97aa9'; p.vline(x, 0, 16, c); } return p; },
  purpur_pillar_top: p => { G.purpur_block(p); return p.frame(3, 3, 10, 10, '#7d527d'); },
  fire: p => { p.clear(); const vn = p.valueNoise(4); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const h = vn(x, 3) * 8 + 5; if (15 - y < h) { const t = (15 - y) / h; p.put(x, y, t > 0.8 ? '#ffe46a' : t > 0.5 ? '#ffa12a' : t > 0.25 ? '#f06a1a' : '#c8360e'); } } return p.bleed(); },
  soul_fire: p => { G.fire(p); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (p.alpha(x, y)) { const c = p.get(x, y); p.put(x, y, [c[2] * 0.4, c[1] * 0.9 + 40, c[0]]); } return p; },
  mangrove_roots: p => { p.clear(); for (let k = 0; k < 6; k++) { let x = p.rand(N), y = 0; for (let i = 0; i < 20; i++) { p.wrapPut(x, y, p.pick(['#4a3a2a', '#5a4a33', '#3f2f22'])); if (p.chance(0.5)) x++; else y++; } } return p.bleed(); },
  coral_block_tube: p => { p.noise(['#2a4ec7', '#3560d9', '#1f3ca8'], { clump: 3 }); return p.speck(['#6a8cf0'], 14); },
  coral_block_brain: p => { p.noise(['#c7508a', '#d9609a', '#a83a70'], { clump: 3 }); return p.speck(['#f08ab8'], 14); },
  coral_block_bubble: p => { p.noise(['#a01fa0', '#b82ab8', '#8a148a'], { clump: 3 }); return p.speck(['#e060e0'], 14); },
  coral_block_fire: p => { p.noise(['#c72a2a', '#d93a3a', '#a81f1f'], { clump: 3 }); return p.speck(['#f07a5a'], 14); },
  coral_block_horn: p => { p.noise(['#d8c82a', '#e6d83a', '#b8a81f'], { clump: 3 }); return p.speck(['#fff06a'], 14); },
  skeleton_skull_side: p => skull(p, ['#b9b9ae', '#cfcfc4', '#e0e0d6']),
  skeleton_skull_top: p => skull(p, ['#c2c2b7', '#d6d6cc', '#e6e6dc']),
  skeleton_skull_front: p => skullFace(skull(p, ['#b9b9ae', '#cfcfc4', '#e0e0d6']), '#3a3a36'),
  wither_skull_side: p => skull(p, ['#1c1c1c', '#262626', '#303030']),
  wither_skull_top: p => skull(p, ['#202020', '#2a2a2a', '#343434']),
  wither_skull_front: p => skullFace(skull(p, ['#1c1c1c', '#262626', '#303030']), '#060606'),
  bone_block_side: p => { p.noise(['#e2ddc6', '#d6d0b6', '#ece8d4'], { clump: 3, grain: 0.2 }); for (let x = 2; x < N; x += 5) p.vline(x, 0, 16, '#c9c2a4'); return p; },
  bone_block_top: p => { p.noise(['#e2ddc6', '#d6d0b6'], { clump: 3 }); p.rect(4, 4, 8, 8, '#c9c2a4'); p.rect(6, 6, 4, 4, '#b8b194'); return p; },
  shroomlight: p => { p.noise(['#f09a3a', '#ffb24a', '#ffc86a', '#ffdc8a'], { clump: 3, grain: 0.4 }); return p.speck(['#fff2b8'], 10); },
  nether_wart_block: p => { p.noise(['#6e0f0f', '#7f1414', '#8f1a1a', '#5e0a0a'], { clump: 3, grain: 0.45 }); return p.speck(['#a82a2a'], 10); },
  warped_wart_block: p => { p.noise(['#0f6e62', '#138073', '#179084', '#0a5e53'], { clump: 3, grain: 0.45 }); return p.speck(['#2ab8a6'], 10); },
  red_mushroom_block: p => { p.fill('#c42a2a'); p.noise(['#b52424', '#c42a2a', '#d23232'], { clump: 3, grain: 0.2 }); for (const [x, y, s] of [[2, 2, 3], [10, 3, 3], [5, 9, 4], [12, 11, 2]]) p.rect(x, y, s, s, '#f2ece0'); return p; },
  brown_mushroom_block: p => p.noise(['#8a5f3f', '#946848', '#9e7050', '#80573a'], { clump: 3, grain: 0.3 }),
  mushroom_stem: p => { p.noise(['#d8d0bd', '#e2dac8', '#cfc6b2'], { clump: 2, grain: 0.3 }); for (let x = 1; x < N; x += 4) p.vline(x, 0, 16, '#c4bba6'); return p; },
  water: p => { const vn = p.valueNoise(4); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) p.put(x, y, ['#8a8a8a', '#9a9a9a', '#a8a8a8', '#b6b6b6'][Math.min(3, Math.floor((vn(x, y) * 0.7 + p.r() * 0.3) * 4))], 254); return p; },
  water_flow: p => G.water(p),
  lava: p => { const vn = p.valueNoise(4); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = vn(x, y); p.put(x, y, v > 0.75 ? '#ffb029' : v > 0.55 ? '#f28a1c' : v > 0.35 ? '#e65c12' : '#c0310a'); } return p; },
  lava_flow: p => G.lava(p),
  ice: p => { p.noise(['#8fb4ee', '#9dbff4', '#a8c8f8', '#b5d2fb'], { clump: 3, grain: 0.3 }); for (let k = 0; k < 3; k++) { const x = p.rand(N), y = p.rand(N); for (let i = 0; i < 5; i++) p.wrapPut(x + i, y - i, '#e3f0ff'); } return p; },
  packed_ice: p => { p.noise(['#7ea6e0', '#8cb2e8', '#9abdef'], { clump: 4, grain: 0.3 }); for (let k = 0; k < 4; k++) { const x = p.rand(N), y = p.rand(N); for (let i = 0; i < 4; i++) p.wrapPut(x + i, y, '#b8d4f8'); } return p; },
  blue_ice: p => { p.noise(['#5a8fe0', '#6a9ee8', '#78a9ef'], { clump: 4, grain: 0.3 }); return p.speck(['#a8ccff'], 10); },
  nether_portal: p => portalTex(p),
  dirt_path: p => G.dirt_path_top(p),
  cactus_side: p => { p.noise(['#3f7f2e', '#4a8f37', '#428631'], { clump: 2, grain: 0.3 }); for (let y = 0; y < N; y++) { for (const x of [3, 7, 11]) p.put(x, y, '#2c5e20'); p.put(0, y, '#23501a'); p.put(15, y, '#23501a'); } for (let k = 0; k < 10; k++) p.put(p.pick([2, 5, 9, 13]), p.rand(N), p.chance(0.5) ? '#d9e6b0' : '#1f4a17'); return p; },
  cactus_top: p => { p.fill('#4f9a3c'); p.frame(0, 0, 16, 16, '#2c5e20'); p.frame(4, 4, 8, 8, '#58a142'); p.speck(['#d9e6b0'], 5); return p; },
  cactus_bottom: p => G.cactus_top(p),
  terracotta: p => p.noise(ramp('#985e43', 0.05), { clump: 3, grain: 0.35 }),
  moss_carpet: p => G.moss_block(p),
  air: p => p.clear(),
  snow_block: p => G.snow(p),
  glowstone: p => {
    p.noise(['#8a6a2a', '#b8903a', '#d9b04a', '#f2d06a'], { clump: 3, grain: 0.3 });
    for (let k = 0; k < 7; k++) { const x = p.rand(14), y = p.rand(14); p.rect(x, y, 2, 2, '#fff2a8'); p.put(x + 1, y + 1, '#ffffff'); }
    return p;
  },
  campfire: p => {
    p.clear();
    for (const y of [11, 13]) { p.rect(0, y, 16, 2, '#6b4a2b'); p.hline(0, y, 16, '#8a643a'); }
    for (let x = 2; x < 14; x++) { const h = 3 + ((x * 7) % 5) + (x > 4 && x < 11 ? 3 : 0); for (let y = 11 - h; y < 11; y++) p.put(x, y, y < 11 - h * 0.6 ? '#ffd24a' : y < 11 - h * 0.3 ? '#ff9a2a' : '#e0521a'); }
    return p;
  },
};

// Families by name pattern.
function family(name, p) {
  let m;
  if ((m = name.match(/^planks_(\w+)$/))) return planks(p, WOOD[m[1]].planks);
  if ((m = name.match(/^log_(\w+)_top$/)) || (m = name.match(/^stem_(\w+)_top$/))) return logTop(p, m[1]);
  if ((m = name.match(/^log_(\w+)$/)) || (m = name.match(/^stem_(\w+)$/))) return logSide(p, m[1]);
  if ((m = name.match(/^leaves_(\w+)$/))) {
    const pal = {
      spruce: ['#3a5a3a', '#446a44', '#4f774f', '#5a855a', '#2f4a2f'], birch: ['#607f3a', '#6d8f42', '#7a9d4a', '#88ab54', '#557336'],
      cherry: ['#e89ac0', '#f0aacb', '#f7bdd8', '#fbd0e3', '#d884ad'], azalea: ['#50752a', '#5b8430', '#669237', '#71a03f', '#476a24'],
      flowering_azalea: ['#50752a', '#5b8430', '#d27ab5', '#669237', '#e08fc4'],
    }[m[1]];
    return leaves(p, pal || ['#6a6a6a', '#7c7c7c', '#8e8e8e', '#a0a0a0', '#585858'], !pal);
  }
  if ((m = name.match(/^door_(\w+)_(top|bottom)$/))) return doorTex(p, m[1], m[2] === 'top');
  if ((m = name.match(/^trapdoor_(\w+)$/))) return trapdoorTex(p, m[1]);
  if ((m = name.match(/^wool_(\w+)$/))) return wool(p, DYE[m[1]]);
  if ((m = name.match(/^concrete_(\w+)$/))) return p.noise(ramp(CONCRETE[m[1]], 0.03).slice(1, 3), { clump: 2, grain: 0.3 });
  if ((m = name.match(/^terracotta_(\w+)$/))) return p.noise(ramp(TERRA[m[1]], 0.05), { clump: 3, grain: 0.35 });
  if ((m = name.match(/^stained_glass_(\w+)$/))) return glassTex(p, shade(DYE[m[1]], 1.15), DYE[m[1]], 110);
  if ((m = name.match(/^(deepslate_)?ore_(\w+)$/))) {
    const colors = {
      coal: ['#0c0c0c', '#1a1a1a', '#262626', '#454545'], iron: ['#b88a6c', '#c49a7c', '#d8af93', '#e6c4a8'],
      copper: ['#8a4a2a', '#b8613a', '#d9774a', '#5ea890'], gold: ['#d9b420', '#e0c52a', '#fcee4b', '#fff7a0'],
      redstone: ['#8a0000', '#b50000', '#e01010', '#ff4a4a'], lapis: ['#1a3a8a', '#1f4db8', '#2a5fd9', '#4a7ef0'],
      emerald: ['#0f8a3a', '#17a84a', '#2ac760', '#7af0a0'], diamond: ['#2fb3bd', '#3dcbd6', '#5decf5', '#a6fbff'],
    }[m[2]];
    return oreOn(p, m[1] ? G.deepslate : G.stone, colors);
  }
  if (name === 'nether_gold_ore') return oreOn(p, G.netherrack, ['#d9a520', '#f2c94c', '#fff08a', '#fff7c0']);
  if (name === 'nether_quartz_ore') return oreOn(p, G.netherrack, ['#d8d0c4', '#e8e2d8', '#f6f2ea', '#ffffff']);
  if (name === 'ancient_debris_side') { p.noise(['#4a3a33', '#5a4840', '#66524a'], { clump: 3 }); for (let y = 1; y < N; y += 4) p.hline(0, y, 16, '#3a2d27'); return p.speck(['#7a6258'], 10); }
  if (name === 'ancient_debris_top') { p.noise(['#4a3a33', '#5a4840'], { clump: 3 }); for (let r = 1; r < 8; r += 2) p.frame(7 - r, 7 - r, r * 2 + 2, r * 2 + 2, '#3a2d27'); return p; }
  if ((m = name.match(/^block_(\w+)$/)) || (m = name.match(/^(coal|iron|gold|diamond|emerald|lapis|redstone|copper|amethyst|quartz|netherite|raw_iron|raw_gold|raw_copper)_block$/))) {
    const [c, style] = {
      coal: ['#1a1a1a', 'dots'], iron: ['#d8d8d8', 'lines'], gold: ['#f5d53a', 'shiny'], diamond: ['#5decf5', 'facets'], emerald: ['#2ac760', 'facets'],
      lapis: ['#2250b8', 'dots'], redstone: ['#b50f0f', 'dots'], copper: ['#c06a4a', 'lines'], amethyst: ['#8a5ad0', 'facets'], quartz: ['#ece6dc', ''],
      netherite: ['#3a3438', 'lines'], raw_iron: ['#b88a6c', 'dots'], raw_gold: ['#e0b52a', 'dots'], raw_copper: ['#b8613a', 'dots'],
    }[m[1]];
    return mineral(p, c, style);
  }
  if ((m = name.match(/^(wheat|carrots|potatoes|beetroots)_stage(\d)$/))) return crop(p, Number(m[2]), m[1] === 'wheat' ? 8 : 4, m[1]);
  if ((m = name.match(/^(pumpkin|melon)_stem_stage(\d)$/))) {
    crossClear(p);
    const t = Number(m[2]) / 7, h = 3 + Math.round(t * 10);
    const c = t > 0.9 ? ['#b8912a', '#a07a22'] : ['#5aa83a', '#4a8f2e'];
    for (let i = 0; i < h; i++) { p.put(8, 15 - i, c[i % 2]); if (i % 4 === 2) { p.put(7, 15 - i, c[1]); p.put(9, 14 - i, c[0]); } }
    return p.bleed();
  }
  if ((m = name.match(/^nether_wart_stage(\d)$/))) {
    crossClear(p);
    const t = Number(m[1]) / 3;
    for (const x of [3, 7, 11]) {
      const h = 3 + Math.round(t * 6 + (x % 3));
      for (let i = 0; i < h; i++) p.put(x, 15 - i, '#6b1a1f');
      p.rect(x - 1, 15 - h, 3, 2 + Math.round(t * 2), t > 0.9 ? '#b8232e' : '#8e1d25');
    }
    return p.bleed();
  }
  if ((m = name.match(/^destroy_(\d)$/))) {
    p.clear();
    // Chiselled pixel cracks: a dark fissure with a pale lip on its lower edge, growing from the
    // centre outwards as the stage rises.
    const pts = CRACKS(), count = Math.max(2, Math.round(pts.length * [0.04, 0.09, 0.16, 0.25, 0.35, 0.46, 0.58, 0.71, 0.85, 1][Number(m[1])]));
    const on = new Set(pts.slice(0, count).map(([x, y]) => y * N + x));
    for (const i of on) { const x = i % N, y = (i / N) | 0; if (y + 1 < N && !on.has(i + N)) p.put(x, y + 1, '#2a2a2a', 95); }
    for (const i of on) p.put(i % N, (i / N) | 0, '#161616', 205);
    return p;
  }
  // brick family
  const BR = {
    bricks: () => bricks(p, '#96463a', '#b5a79a'),
    stone_bricks: () => bigBricks(p, '#7a7a7a', '#4e4e4e'),
    mossy_stone_bricks: () => { bigBricks(p, '#7a7a7a', '#4e4e4e'); const vn = p.valueNoise(4); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (vn(x, y) > 0.58) p.put(x, y, p.pick(['#5a7a2a', '#4d6b24', '#6b8c38'])); return p; },
    cracked_stone_bricks: () => { bigBricks(p, '#7a7a7a', '#4e4e4e'); let x = 3, y = 0; for (let i = 0; i < 18; i++) { p.put(x, y, '#3f3f3f'); if (p.chance(0.5)) x = (x + 1) % 16; y = (y + 1) % 16; } return p; },
    chiseled_stone_bricks: () => { bigBricks(p, '#7a7a7a', '#4e4e4e'); p.rect(2, 2, 12, 12, '#7a7a7a'); p.frame(2, 2, 12, 12, '#5a5a5a'); p.frame(5, 5, 6, 6, '#5a5a5a'); return p; },
    nether_bricks: () => bricks(p, '#2c1418', '#160a0c', { rowH: 4, w: 6 }),
    red_nether_bricks: () => bricks(p, '#4a0a0c', '#2a0406', { rowH: 4, w: 6 }),
    end_stone_bricks: () => bigBricks(p, '#dbde9f', '#b7ba7e'),
    mud_bricks: () => bricks(p, '#8a6a4f', '#6a5039', { rowH: 4, w: 8 }),
    quartz_bricks: () => bigBricks(p, '#ece6dc', '#cfc8bb'),
    prismarine: () => p.noise(['#4a8a7a', '#5a9e8a', '#6ab29a', '#3a7a6a'], { clump: 3, grain: 0.45 }),
    prismarine_bricks: () => bigBricks(p, '#6ab29a', '#3a7a6a'),
    dark_prismarine: () => bigBricks(p, '#335c4c', '#1f3d31'),
  };
  if (BR[name]) return BR[name]();
  return null;
}

let crackCache = null;
// Crack pixels in growth order. Each tip has a diagonal heading and steps along either its x or
// its y component, so fissures come out as jagged pixel staircases; tips fork now and then, and
// advancing every tip in turn grows the crack outward evenly from the centre.
export function CRACKS(seed = 1037) {
  if (crackCache && seed === 1037) return crackCache;
  const p = new Painter(N, N, seed);
  const seen = new Set(), pts = [];
  const free = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !seen.has(y * N + x);
  const nbs = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].filter(([dx, dy]) => seen.has((y + dy) * N + x + dx) && x + dx >= 0 && x + dx < N).length;
  const add = (x, y) => { seen.add(y * N + x); pts.push([x, y]); };
  add(7, 7);
  let tips = [[7, 7, 1, 1, 11], [7, 7, -1, -1, 11], [7, 7, 1, -1, 10], [7, 7, -1, 1, 10]];
  for (let step = 0; step < 80 && pts.length < 100; step++) {
    const next = [];
    for (const t of tips) {
      const [x, y, sx, sy, life] = t;
      if (life <= 0) continue;
      const opts = p.chance(0.5) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
      const mv = opts.find(([dx, dy]) => free(x + dx, y + dy) && nbs(x + dx, y + dy) <= 2);
      if (!mv) continue;
      const nx = x + mv[0], ny = y + mv[1];
      add(nx, ny);
      next.push([nx, ny, sx, sy, life - 1]);
      if (p.chance(0.16) && next.length + tips.length < 12) next.push([nx, ny, p.chance(0.5) ? -sx : sx, p.chance(0.5) ? sy : -sy, 2 + p.rand(4)]);
    }
    tips = next;
    if (!tips.length) { const [x, y] = pts[p.rand(pts.length)]; tips = [[x, y, p.chance(0.5) ? 1 : -1, p.chance(0.5) ? 1 : -1, 3 + p.rand(4)]]; }
  }
  if (seed === 1037) crackCache = pts;
  return pts;
}

// Average colours of the default Minecraft textures (the palette values pixel-art tools use).
// Our generators are original; this only nudges each one's overall colour onto the familiar
// look while keeping its own pixel detail.
const REF_AVG = {
  stone: [126, 126, 126], cobblestone: [128, 127, 128], dirt: [134, 96, 67], planks_oak: [162, 131, 79], log_oak: [109, 85, 51], log_oak_top: [151, 122, 73],
  sand: [219, 207, 163], gravel: [132, 127, 127], bricks: [151, 98, 83], sandstone: [216, 203, 156], deepslate: [80, 80, 83], netherrack: [98, 38, 38],
  end_stone: [220, 223, 158], obsidian: [15, 11, 25], ore_coal: [106, 106, 105], ore_iron: [136, 129, 123], ore_diamond: [121, 141, 141], ore_gold: [145, 134, 107],
  snow: [249, 254, 254], clay: [161, 166, 179], terracotta: [152, 94, 68], planks_spruce: [115, 85, 49], planks_birch: [192, 175, 121], log_birch: [217, 215, 210],
  stone_bricks: [122, 122, 122], bookshelf: [117, 95, 60], furnace_front: [92, 91, 91], crafting_table_top: [120, 73, 42], soul_sand: [81, 62, 51], ice: [146, 184, 254],
  packed_ice: [142, 180, 250], quartz_block: [236, 230, 223], prismarine: [99, 162, 146], mycelium_top: [111, 99, 101], podzol_top: [92, 63, 24], log_spruce: [59, 38, 17],
  planks_jungle: [160, 115, 81], planks_acacia: [168, 90, 50], planks_dark_oak: [67, 43, 20], log_dark_oak: [60, 47, 26], log_jungle: [85, 68, 25], log_acacia: [103, 97, 87],
  red_sand: [191, 103, 33], ore_redstone: [140, 110, 110], ore_lapis: [107, 118, 141], ore_emerald: [108, 136, 116], ore_copper: [125, 126, 120], mossy_cobblestone: [110, 119, 95],
  andesite: [136, 136, 137], diorite: [189, 188, 189], granite: [149, 103, 86], calcite: [223, 224, 221], tuff: [108, 109, 103], blackstone: [42, 36, 41],
  basalt_side: [73, 73, 78], crying_obsidian: [33, 10, 60], nether_bricks: [44, 22, 26], end_stone_bricks: [218, 224, 162], purpur_block: [170, 126, 170], mud: [60, 57, 61],
  coarse_dirt: [119, 86, 59], iron_block: [220, 220, 220], gold_block: [246, 208, 62], diamond_block: [98, 237, 228], emerald_block: [42, 203, 88], lapis_block: [31, 67, 140],
  coal_block: [16, 16, 16], hay_block_side: [166, 136, 38], pumpkin_side: [196, 115, 24], melon_side: [114, 146, 30], smooth_stone: [159, 159, 159], mossy_stone_bricks: [115, 121, 105],
  cracked_stone_bricks: [118, 118, 118], dripstone_block: [134, 108, 93], amethyst_block: [134, 98, 191], magma_block: [142, 63, 31], bone_block_side: [229, 226, 208], soul_soil: [76, 58, 47],
  planks_cherry: [227, 179, 173], planks_mangrove: [118, 54, 49],
};
function calibrate(d, ref) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i + 3] !== 254) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  if (!n) return;
  const k = [ref[0] / Math.max(1, r / n), ref[1] / Math.max(1, g / n), ref[2] / Math.max(1, b / n)];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i + 3] !== 254) for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.round(d[i + c] * k[c]));
}

export function drawBlockTexture(name, seed) {
  const p = new Painter(N, N, seed);
  if (G[name]) G[name](p);
  else if (!family(name, p)) throw new Error(`No texture generator for "${name}"`);
  if (REF_AVG[name]) calibrate(p.d, REF_AVG[name]);
  return p.d;
}

export function generateBlockTextures() {
  return TEXTURES.map((name, i) => drawBlockTexture(name, i + 1));
}

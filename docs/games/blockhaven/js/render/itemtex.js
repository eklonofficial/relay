// Procedural 16x16 pixel art for every non-block item, plus particle/effect sprites.
// Icons are hand-drawn as pixel rows (px``) or auto-shaded silhouettes (sil), then given MC-style dark outlines.
import { Painter, shade, mixHex, ramp } from './paint.js?v=muq89fgx';
import { ITEMS, I } from '../data/items.js?v=muq89fgx';
import { TEXTURES, TEX, BLOCKS, FACE_TEX, VARIANT_MASK, COLORS } from '../data/blocks.js?v=muq89fgx';
import { drawBlockTexture } from './blocktex.js?v=muq89fgx';
import { EXTRA_ITEM_TEX } from './enchtex.js?v=muq89fgx';

const N = 16;
export const MAT = {
  wooden: ['#4a3419', '#6b4c24', '#9c7640', '#c29a5c'], wood: ['#4a3419', '#6b4c24', '#9c7640', '#c29a5c'],
  stone: ['#3a3a3a', '#5e5e5e', '#848484', '#a8a8a8'], iron: ['#4e4e4e', '#9a9a9a', '#d0d0d0', '#ffffff'],
  golden: ['#7a5a0c', '#d0a018', '#f4d443', '#fff8b0'], diamond: ['#0f4f4b', '#20a39b', '#4fe3ea', '#cafffd'],
  netherite: ['#1f1a1c', '#3a3134', '#554a4e', '#766a6e'], leather: ['#4f2810', '#7e4220', '#a55f34', '#c47d4c'],
  chainmail: ['#3a3a3a', '#6e6e6e', '#a8a8a8', '#d8d8d8'], turtle: ['#1f4a1f', '#2f7a2f', '#47a347', '#6ac26a'],
  elytra: ['#3a3a52', '#5a5a7a', '#8484a8', '#aaaacc'],
};
const HANDLE = ['#3d2a12', '#6b4c24', '#8e6a38'];

// ---------- primitives ----------
function line(p, x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (let k = 0; k < 64; k++) {
    p.put(x, y, typeof c === 'function' ? c(x, y, k) : c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
// Filled ellipse shaded from top-left (light) to bottom-right (dark) using a 4-step ramp.
function blob(p, cx, cy, rx, ry, pal, { rot = 0, rough = 0 } = {}) {
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry;
    const d = u * u + v * v;
    if (d > 1 - rough * p.r()) continue;
    const light = -(dx + dy) / (rx + ry) * 1.2 + (1 - d) * 0.5;
    const k = light > 0.55 ? 3 : light > 0.1 ? 2 : light > -0.35 ? 1 : 0;
    p.put(x, y, pal[k]);
  }
}
function mask(p, rows, pal, shadeFn) {
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.' || ch === ' ') return;
    if (ch >= '0' && ch <= '3') p.put(x, y, pal[Number(ch)]);
    else if (ch === '#') p.put(x, y, pal[shadeFn ? shadeFn(x, y) : x < 6 ? 3 : x < 10 ? 2 : 1]);
    else if (ch === 'w') p.put(x, y, '#ffffff');
    else if (ch === 'k') p.put(x, y, '#1a1a1a');
  }));
}
// Dark outline around every opaque pixel (4-neighbourhood), like vanilla item sprites.
function outline(p, color = null, diag = false) {
  const a = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) a[i] = p.d[i * 4 + 3] > 0 ? 1 : 0;
  const nb = diag ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (a[y * N + x]) continue;
    for (const [dx, dy] of nb) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || !a[ny * N + nx]) continue;
      const c = p.get(nx, ny);
      p.put(x, y, color || [c[0] * 0.3, c[1] * 0.3, c[2] * 0.3]);
      break;
    }
  }
  return p;
}
// ---------- sprite helpers ----------
// px`` -> pixel rows: one text line per row, '.' = empty (a lone '.' is a blank row).
const px = s => s[0].trim().split('\n').map(r => r.trim());
// Rows from a predicate f(x, y) -> char | falsy.
const shape = f => Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => f(x, y) || '.').join(''));
// Overlay b on a: b's non-'.' chars win (only on a's silhouette unless inside = false).
const over = (a, b, inside = true) => a.map((r, y) => [...r.padEnd(N, '.')].map((c, x) => { const d = (b[y] || '')[x]; return d && d !== '.' && (!inside || c !== '.') ? d : c; }).join(''));
const disc = (cx, cy, r, ch = '#') => shape((x, y) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r && ch);
const ramp4 = (c, lo = 0.55, hi = 1.2) => [shade(c, lo), shade(c, (1 + lo) / 2), c, shade(c, hi)];
const DEF = { w: '#ffffff', k: '#1a1a1a' };
// Draws rows. '#' is auto-shaded from pal: lit top-left edge (3), body (2), bottom-right edge (1), outer corner (0).
// '0'-'3' pick pal tones directly; other chars come from lut: a colour, or a 4-tone ramp shaded like '#'.
// Finishes with outline() unless ol === false (ol may also be an outline colour).
function sil(p, rows, pal, lut = {}, ol) {
  const on = (x, y) => { const c = (rows[y] || '')[x]; return !!c && c !== '.'; };
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch === '.') return;
    const v = ch === '#' ? pal : ch >= '0' && ch <= '3' ? pal[+ch] : lut[ch] || DEF[ch];
    if (!v) return;
    if (typeof v === 'string') { p.put(x, y, v); return; }
    const t = !on(x - 1, y) || !on(x, y - 1), b = !on(x + 1, y) || !on(x, y + 1);
    p.put(x, y, v[t && !b ? 3 : b && !t ? (!on(x + 1, y) && !on(x, y + 1) ? 0 : 1) : 2]);
  }));
  if (ol !== false) outline(p, ol || null);
  return p;
}

// ---------- tools ----------
// Vanilla layout: a 2-px handle (c light, b dark) runs from the bottom-left corner towards the top-right and the head
// sits in the top-right quadrant. Heads are fill-only 0-3 material ramps lit from the top-left; outline() adds the rim.
function art(p, rows, pal) {
  const lut = { 0: pal[0], 1: pal[1], 2: pal[2], 3: pal[3], c: HANDLE[2], b: HANDLE[1] };
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (lut[ch]) p.put(x, y, lut[ch]); }));
  outline(p);
}
// Handle rows y0..13: light pixel at x = 15 - y, dark one beside it.
const shaft = y0 => Array.from({ length: 16 }, (_, y) => y >= y0 && y <= 13 ? '.'.repeat(15 - y) + 'cb' : '');
const withShaft = (rows, y0) => shaft(y0).map((r, y) => [...(rows[y] || '').padEnd(16, '.')].map((ch, x) => ch !== '.' ? ch : r[x] || '.').join('').slice(0, 16));
const TOOL_ROWS = {
  pickaxe: withShaft(px`
.
.
.....333333
....32222222
...32.....122
...........121
............21
............21
............21
............21
............21
...........11
...........0`, 5),
  axe: withShaft(px`
.
......3332
.....33222221
.....3322221
.....332221
.....33221
.....3221
......21`, 2),
  shovel: withShaft(px`
.
...........32
..........3322
.........332221
........3322211
........322211
.........2211
..........1`, 7),
  hoe: withShaft(px`
.
.
......33333332
......22222221
......21
......1`, 2),
};
const toolArt = type => (p, pal) => art(p, TOOL_ROWS[type], pal);
const [pickaxe, axe, shovel, hoe] = ['pickaxe', 'axe', 'shovel', 'hoe'].map(toolArt);
// Sword in blade-aligned coordinates: s = across the blade (0 = axis), t = along it (tip -> pommel).
// Everything is symmetric in s, so the guard sits square across the blade.
function sword(p, pal) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const s = x + y - 15, t = y - x, as = Math.abs(s);
    let c = null;
    if (t >= -13 && t <= 2 && as <= 1 && !(t === -13 && s !== 0)) c = t === -13 ? pal[3] : pal[2 - s];
    else if (t >= 3 && t <= 4 && as <= 4) c = t === 3 ? pal[s < 0 ? 3 : 2] : pal[s < 2 ? 1 : 0];
    else if (t >= 5 && t <= 9 && (s === -1 || s === 0)) c = s < 0 ? HANDLE[2] : HANDLE[1];
    else if (t >= 10 && t <= 11 && as <= 1) c = t === 10 ? pal[s < 1 ? 3 : 2] : pal[1];
    if (c) p.put(x, y, c);
  }
  outline(p);
}
// Shears: two closed blades pointing top-right, a rivet, and dark grips opening towards the bottom-left.
function shears(p) {
  sil(p, px`
.
.............3
............321
...........3321
..........3321
.........3321
........3321
.......3k21
......gg.gg
.....gg..gg
....gg..gg
...ggg.ggg
...gg..gg`, MAT.iron, { g: ['#1e1e1e', '#3a3a3a', '#5a5a5a', '#7a7a7a'] });
}

// ---------- armor ----------
// Silhouettes in the vanilla icon layout; '#' is auto-shaded, '1' marks fixed creases.
const ARMOR_ROWS = {
  helmet: px`
.
.
.
.....######
...##########
..############
..############
..############
..####....####
..###......###
..###......###`,
  chestplate: px`
.
.
..###......###
..####....####
..#####11#####
..############
..############
...##########
....########
....########
....########
....########
....########`,
  leggings: px`
.
.
...##########
...##########
...#####1####
...####..####
...####..####
...####..####
...####..####
...####..####
...####..####
...####..####
...####..####`,
  boots: px`
.
.
.
.
.
.
...###....###
...###....###
...###....###
..####...####
.#####..#####
.#####..#####`,
};
function armor(p, piece, pal, mat) {
  sil(p, ARMOR_ROWS[piece], pal, {}, false);
  const on = (x, y) => p.inb(x, y) && p.alpha(x, y);
  // Chain links: a dark dot grid on inner pixels; metal sets get a bright rivet on the lit shoulder / brim.
  if (mat === 'chainmail') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (on(x, y) && on(x - 1, y) && on(x + 1, y) && on(x, y - 1) && on(x, y + 1) && (x + y) % 2 === 0 && y % 2 === 1) p.put(x, y, pal[0]);
  if (mat === 'turtle') for (const [x, y] of [[5, 5], [8, 4], [10, 6], [6, 7], [9, 7]]) if (on(x, y)) p.put(x, y, pal[1]);
  outline(p);
}

// ---------- materials ----------
// Iso bar: lit top face (2) with a bright front edge (3), shaded long side (1), dark end cap (0).
const INGOT = px`
.
.
.
.........22
.......222222
.....2222222233
...222222223311
.33222222331111
.00332233111111
.000033111111
.0000011111
...000111
.....01`;
const ingot = (pal, spots) => p => { sil(p, INGOT, pal, {}, false); if (spots) for (const [x, y] of [[5, 6], [9, 5], [11, 9], [7, 8]]) p.put(x, y, spots); outline(p); };
// Union of round lumps, each shaded on its own (lit top-left) so the bumps and creases read; fl = fleck pixels.
const lumps = (L, pal, fl = [], fc = pal[1], ol) => p => {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let best = null, bv = 0;
    for (const [cx, cy, r] of L) { const dx = x + 0.5 - cx, dy = y + 0.5 - cy, v = 1 - Math.hypot(dx, dy) / r; if (v > bv) { bv = v; best = (dx + dy) / r; } }
    if (best !== null) p.put(x, y, pal[best < -0.55 ? 3 : best < 0.25 ? 2 : best < 0.8 ? 1 : 0]);
  }
  for (const [x, y] of fl) if (p.alpha(x, y)) p.put(x, y, fc);
  if (ol !== false) outline(p, ol || null);
};
const nugget = pal => lumps([[6.5, 7.5, 2.4], [9.8, 8.8, 2.2], [6.6, 10.8, 2.2]], pal);
// Angular chunk with a lit facet ridge (coal, charcoal, flint-ish).
const CHUNK = px`
.
.
.
......####
....#######
...###ff####
..###ff####f#
..##ff###fff#
..#######ff##
..##fff######
..#ff########
...#f########
....#######
......###`;
const chunk = (pal, f = shade(pal[3], 1.35)) => p => sil(p, CHUNK, pal, { f });
const coal = (pal, glint) => lumps([[6, 6.4, 3.6], [10.4, 7.2, 3.4], [7.6, 10.6, 3.9], [11, 11, 2.4]], pal, [[4, 5], [5, 4], [9, 6], [5, 9], [10, 10], [8, 4]], glint);
// Lumpy raw-ore chunk: four bumps plus flecks.
const lump = (pal, fleck) => lumps([[6, 6.2, 3.3], [10.6, 6.8, 3.2], [8.4, 10.6, 3.8], [4.4, 10.4, 2.8]], pal, [[5, 5], [10, 7], [7, 10], [11, 11], [4, 11], [9, 4]], fleck || pal[1]);
// Heap of specks.
const DUST = px`
.
.
.
.
.
........2
......3..
.....323.1
....32322
...3232212
..323221212
..3232212121
.323221212111
.2212121111110
..1.1.11.1.1`;
const dust = pal => p => sil(p, DUST, pal);
// Brilliant-cut gem: table + crown on top, pavilion tapering to a point.
const GEM = px`
.
.
.....333322
....33w33322
...3333333222
..333333322221
.22222222111111
..222222211110
...2222211110
....22221110
.....222110
......2110
.......10`;
const gem = pal => p => sil(p, GEM, pal);
// Tall octagonal emerald with an inner table.
const EMERALD = px`
.
.
......3322
.....333222
....33332221
....33w32221
....33332221
....33322221
....33222211
....32222211
....32222111
....22211110
.....211110
......1100`;
// Crystal shards along the handle diagonal: s = across (0 = axis), t = along (tip at the top-right).
const shard = (pal, parts) => p => {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const s0 = x + y - 15, t = y - x;
    for (const [ds, t0, t1, w] of parts) {
      const s = s0 - ds, hw = Math.min(w, (t - t0) * 0.6, (t1 - t) * 0.8);
      if (Math.abs(s) > hw) continue;
      p.put(x, y, pal[s < 0 ? 3 : s === 0 ? (t < (t0 + t1) / 2 ? 2 : 1) : s === 1 ? 1 : 0]); break;
    }
  }
  outline(p);
};
const stick = (p, pal = HANDLE, y0 = 3) => { for (let y = y0; y <= 13; y++) { p.put(15 - y, y, pal[2]); p.put(16 - y, y, pal[1]); } outline(p); };
// Round body shaded by sil with a highlight; extra rows can be overlaid.
const orb = (pal, r = 5, extra, lut) => p => sil(p, over(over(disc(8, 8, r), px`
.
.
.
.
.....33
.....3w`), extra || []), pal, lut);

// ---------- containers ----------
const BUCKET = px`
.
.
.
...3333333333
..3bbbbbbbbbb2
..32aaaaaaaa21
..322222222221
...3222222221
...3222222211
...3222222211
....32222211
....32222211
....21111110`;
const bucket = (b, a) => p => sil(p, BUCKET, MAT.iron, { a, b });
// Glass bottle with a hand-drawn rim (o) so the hollow inside stays clear; liquid ramp a (dark) .. d (surface).
const BOTTLE = px`
....oooooooo
....oggggggo
....ohhhhhho
.....og..go
.....og..go
....og....go
...og......go
..og........go
..og........go
..og........go
..og........go
..og........go
...og......go
....oggggggo
.....oooooo`;
const LIQUID = px`
.
.
.
.
.
.
.
.
....dddddddd
....wccccccb
....wcccccbb
....cccccbbb
.....bbbbba`;
const bottle = liq => p => {
  const lut = { o: '#2c3c48', g: '#dcecf2', h: '#a8c4d0', w: '#eef8fc' };
  sil(p, liq ? over(BOTTLE, LIQUID, false) : over(BOTTLE, px`
.
.
.
.
.
.
....w
...w`, false), null, liq ? { ...lut, a: liq[0], b: liq[1], c: liq[2], d: liq[3] } : lut, false);
};
const BOWL = px`
.
.
.
.
.
....33333333
..3iiiiiiiiii2
.3jjjjjjjjjjjj1
.33333333333321
..322222222221
...3222222221
....22222211
.....111111`;
const bowl = (i, j, bits) => p => { sil(p, bits ? over(BOWL, bits) : BOWL, MAT.wood, { i, j, m: '#c8a070', n: '#e05030', r: '#8a4a20', g: '#5a9a3a' }); };
const STEW_BITS = px`
.
.
.
.
.
.
....m..n.m
..r...m..g..r`;
// Pouch tied at the top (dyes, ink sacs).
const POUCH = px`
.
.
.
.....1.1
......22
.....3322
....332222
...33222222
...3w222222
...32222221
...32222211
....222211
.....1111`;
const pouch = c => p => sil(p, POUCH, ramp4(c, 0.55, 1.25));
// Spawn egg: base ramp + fixed spots in the second colour.
const EGG = px`
.
.
......####
.....######
....########
....########
...##########
...##########
...##########
...##########
...##########
....########
....########
.....######`;
const EGG_SPOTS = px`
.
.
.
.......aa
.....a
.........aa
....aa
.......a...a
..........a
.....aa
.........a
.......aa
.....a....a`;
function egg(p, a, b) { sil(p, over(EGG, EGG_SPOTS), ramp4(a, 0.6, 1.2), { a: ramp4(b, 0.65, 1.15) }); }
function book(p) {
  sil(p, px`
.
..33333333331
..s2222222221p
..s2222222221pq
..s22yyyyy221pq
..s22yyyyy221pq
..s2222222221pq
..s2222222221pq
..s2222222221pq
..s2222222221pq
..s2222222221pq
..s2222222221pq
..s1111111111pq
...pppppppppppq
....qqqqqqqqqq`, ['#3a1a0c', '#6a3018', '#8e4424', '#b0603a'], { s: '#4a2010', p: '#f0ece0', q: '#b8b0a0', y: '#d8b048' });
}
// Bow: limbs bulge towards the top-left, string along the other diagonal; drawing pulls it to the bottom-right.
// Bow drawn from bottom-left to top-right; when pulled the string makes a V and an arrow is
// nocked, its head at the top-left corner (like the original's pulling sprites).
function bow(p, pull) {
  const wood = ['#3d2a12', '#6b4c24', '#9c7640', '#b8925a'];
  const A = [13, 2], B = [2, 13], C = [1.5 + pull * 0.8, 1.5 + pull * 0.8];
  for (let k = 0; k <= 80; k++) {
    const t = k / 80, u = 1 - t, x = u * u * A[0] + 2 * u * t * C[0] + t * t * B[0], y = u * u * A[1] + 2 * u * t * C[1] + t * t * B[1];
    const X = Math.round(x), Y = Math.round(y), grip = Math.abs(t - 0.5) < 0.09;
    p.put(X, Y, grip ? '#4a3a2a' : wood[2]); if (!p.alpha(X + 1, Y) || grip) p.put(X + 1, Y, grip ? '#2e241a' : wood[1]);
  }
  outline(p);
  const s = pull * 1.2, mx = Math.round(8 + s), my = Math.round(8 + s);
  line(p, 13, 2, mx, my, '#c8c8c8'); line(p, mx, my, 2, 13, '#c8c8c8');
  if (pull > 0) {
    line(p, mx - 1, my - 1, 4 + pull, 4 + pull, '#9c7640'); line(p, mx, my - 1, 5 + pull, 4 + pull, '#6b4c24');
    for (const [x, y] of [[3 + pull, 3 + pull], [4 + pull, 3 + pull], [3 + pull, 4 + pull]]) p.put(x, y, '#d8d8d8');
  }
}
function arrow(p, tip = MAT.iron, fl = ['#8a8a8a', '#e8e8e8']) {
  for (let x = 3; x <= 11; x++) { p.put(x, 15 - x, '#9c7640'); p.put(x + 1, 15 - x, '#6b4c24'); }
  sil(p, px`
.
.
..........3333
...........322
............21
.............1
.
.
.
.
.ff
.ff
..f
...ggg
....gg`, tip, { f: fl[1], g: fl[0] });
}
// Crossbow: diagonal stock, bowed limbs across its front end, string drawn back along the stock to
// row `draw` (7 at rest, 10 fully drawn); `load` 'arrow' or 'rocket' when charged.
function crossbow(p, draw = 7, load = null) {
  for (let y = 4; y <= 13; y++) { p.put(15 - y, y, HANDLE[2]); p.put(16 - y, y, HANDLE[1]); }
  const A = [5, 2], B = [13, 10], C = [12.5, 2.5];
  for (let k = 0; k <= 60; k++) { const t = k / 60, u = 1 - t, x = Math.round(u * u * A[0] + 2 * u * t * C[0] + t * t * B[0]), y = Math.round(u * u * A[1] + 2 * u * t * C[1] + t * t * B[1]); p.put(x, y, '#8a6a3a'); if (!p.alpha(x + 1, y)) p.put(x + 1, y, '#5a4020'); }
  p.put(12, 3, MAT.iron[2]); p.put(13, 2, MAT.iron[3]); p.put(13, 3, MAT.iron[1]); p.put(12, 2, MAT.iron[2]);
  outline(p);
  const S = [15 - draw, draw];
  line(p, A[0], A[1] + 1, S[0], S[1], '#d0d0d0'); line(p, S[0], S[1], B[0] - 1, B[1], '#d0d0d0');
  if (load === 'arrow') { line(p, S[0] + 1, S[1] - 1, 12, 3, '#c8c8c8'); p.put(13, 2, '#ffffff'); p.put(12, 2, '#e8e8e8'); p.put(13, 3, '#e8e8e8'); }
  else if (load === 'rocket') {
    line(p, S[0] + 1, S[1] - 1, 9, 6, '#8a6a3a');
    for (const [x, y, c] of [[10, 5, '#a82020'], [11, 4, '#d03030'], [10, 4, '#f06060'], [11, 5, '#6a1010'], [12, 3, '#f0f0f0'], [11, 3, '#d03030'], [12, 4, '#a82020'], [13, 2, '#b0b0b0']]) p.put(x, y, c);
  }
}
// Trident: shaft on the handle diagonal, crossbar and three prongs at the top-right (blade coordinates as in sword()).
function trident(p) {
  const pal = ['#1f4f48', '#2f7a6e', '#4aa898', '#9ae0d0'];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const s = x + y - 15, t = y - x;
    let on = false;
    if ((s === -1 || s === 0) && t >= -13 && t <= 11) on = true;
    if (t >= -5 && t <= -3 && s >= -5 && s <= 4) on = true;
    if ((s === -5 || s === -4 || s === 3 || s === 4) && t >= -10 && t <= -3) on = true;
    if (on) p.put(x, y, pal[t < -2 ? (s < 0 ? 3 : 2) : s < 0 ? 2 : 1]);
  }
  outline(p);
}

// ---------- food ----------
const APPLE = px`
.
........e.gg
........egh
...####.e####
..############
..#w##########
..#w##########
..############
..############
..############
..############
...##########
....###..###`;
const apple = (pal, w) => p => sil(p, APPLE, pal, { e: '#5a3a18', g: '#6ac448', h: '#2e8a1e', w });
const PORK = px`
.
.
.
.......####f
.....######ff
....#######fg
...########fg
..#########fg
..########fg
.#########fg
.########fg
.#######fg
..####ffg
...ffgg`;
const STEAK = px`
.
.
.
.....#####
...#########
..###f#######
..####ff######
.######f######
.#######f#####
.###f####f####
.####ff###f###
..#######f###
...#########
.....#####`;
const DRUM = px`
.
.
....#####
...#######
..#########
..#########
..#########
..#########
...########
....######
......###wv
.........wv
........wwwv
.........wwv
..........v`;
const LEG = px`
.
..........ww
.........wwwv
..........wv
.....####wv
...#######
..#########
.###########
.###########
.###########
..#########
...#######
.....###`;
const BUNNY = px`
.
.
.
.
..........#
.........##
....#######
...#########
..##########
..#########
...##...##
..##....##`;
const meat = (rows, pal, f, g = shade(f, 0.82)) => p => sil(p, rows, pal, { f, g, w: '#f4f0e0', v: '#c8c0a8' });
const FISH = px`
.
.
.
.
......ddd
....#######..##
..###########.##
.#k############
.##############
.lll##########.
..llll#####..##
....#####....#`;
const fish = (pal, l, d) => p => sil(p, FISH, pal, { l, d });
const CARROT = px`
.
.
............g.
..........g.gh.
...........ghg
.........##hg
........####
.......##r#
......####
.....#r##
....####
...##r
...###
..##
..#`;
const carrot = (pal, leaf) => p => sil(p, CARROT, pal, { g: leaf[1], h: leaf[0], r: pal[1] });
const POTATO = px`
.
.
.
.
.....#####
...#########
..###########
..####e#######
.#############
.######e######
..############
..#e#########
...#########
.....#####`;
const potato = (pal, e, c) => p => sil(p, c ? over(POTATO, px`
.
.
.
.
.
....ccccc
.....ccccc`) : POTATO, pal, { e, c });
const berries = (pal, stem) => p => {
  line(p, 8, 2, 6, 7, stem); line(p, 8, 2, 10, 6, stem); line(p, 8, 2, 8, 10, stem); p.put(9, 2, stem); p.put(10, 2, shade(stem, 1.4));
  for (const [cx, cy] of [[5.5, 9], [10.5, 8], [8, 12]]) sil(p, over(disc(cx, cy, 2.3), shape((x, y) => x === Math.floor(cx) - 1 && y === Math.floor(cy) - 1 && 'w')), pal, {}, false);
  outline(p);
};

// Loose seeds: two-pixel grains in a small scatter.
const SEEDS = px`
.
.
.
.
.
.........ab
.....ab
.
...ab....ab
.......ab
.
....ab....ab
.
.......ab`;
const seeds = (a, b, o) => p => sil(p, SEEDS, null, { a, b }, o);


// ---------- redstone ----------
// Smooth-stone slab seen from the front with its dust track; torches are a 2px stick under a lit red head.
const SLAB = ['#6a6a6a', '#8e8e8e', '#a8a8a8', '#c6c6c6'];
const RS_LUT = { r: '#8a1008', H: '#ff9a80', h: '#e8200e', j: '#a80c04', c: HANDLE[2], b: HANDLE[1] };
const REPEATER = px`
.
.
.
.
.
...Hh......Hh
...hj......hj
...cb......cb
...cb......cb
...cb......cb
.##############
.#rrrrrrrrrrrr#
.##############
.##############`;
const COMPARATOR = px`
.
.
.
.
.......Hh
.......hj
..Hh...cb...Hh
..hj...cb...hj
..cb...cb...cb
..cb...cb...cb
.##############
.#rrrrrrrrrrrr#
.##############
.##############`;
// Lever: a handle leaning up-right out of a speckled cobblestone base.
const LEVER = px`
.
.
.
.
...........cb
..........cb
.........cb
........cb
.......cb
......cb
...##########
...#s###s##s#
...###s###s##
...##########`;
// Hopper: wide rim with a dark opening, tapering to a 2px spout.
const HOPPER = px`
.
.
.##############
.#kkkkkkkkkkkk#
.#kllllllllllk#
.##############
...##########
...##########
...##########
.....######
.....######
......####
.......##
.......##`;

// ---------- item table ----------
const G = {
  repeater: p => sil(p, REPEATER, SLAB, RS_LUT),
  comparator: p => sil(p, COMPARATOR, SLAB, RS_LUT),
  lever: p => sil(p, LEVER, MAT.stone, { s: '#4a4a4a', c: HANDLE[2], b: HANDLE[1] }),
  hopper: p => sil(p, HOPPER, ['#262626', '#383838', '#4c4c4c', '#686868'], { k: '#141414', l: '#1e1e1e' }),
  stick: p => stick(p),
  coal: coal(['#0a0a0a', '#1a1a1a', '#2c2c2c', '#464646'], '#6e6e6e'), charcoal: coal(['#140e08', '#261c12', '#3a2c20', '#54422f'], '#7a6450'),
  flint: p => sil(p, px`
.
.
.......#
......###
.....#####
....###3###
....##33####
...##33#####
...#33######
..#3########
..##########
..#########
...######
....###`, ['#141414', '#2a2a2a', '#404040', '#686868']),
  raw_iron: lump(['#6e5446', '#a68268', '#c8a488', '#e6c8ac'], '#8a6a55'), raw_gold: lump(['#8a6a10', '#c89a20', '#e6c040', '#fff090'], '#b07818'),
  raw_copper: lump(['#6e3418', '#a8552c', '#d07040', '#f0a070'], '#5ea890'),
  netherite_scrap: lump(['#2a1f1c', '#4a3a33', '#66524a', '#8a7064'], '#9a8074'),
  iron_ingot: ingot(MAT.iron), gold_ingot: ingot(MAT.golden), copper_ingot: ingot(['#6e3418', '#b8613a', '#e0875a', '#f8b890']),
  netherite_ingot: ingot(MAT.netherite), brick: ingot(['#5a2016', '#8a3a28', '#b0543c', '#c87058'], '#6a2a1c'),
  nether_brick: ingot(['#1a0a0c', '#2c1418', '#44202a', '#5c2c36'], '#1a0a0c'),
  iron_nugget: nugget(MAT.iron), gold_nugget: nugget(MAT.golden),
  diamond: gem(MAT.diamond), emerald: p => sil(p, EMERALD, ['#0a4a22', '#17a84a', '#3ad870', '#b8ffd0']),
  lapis_lazuli: chunk(['#0f2a6a', '#1f4db8', '#3a6ae0', '#6a90f0'], '#b8d0ff'),
  quartz: p => sil(p, px`
.
.
.......3
......332
......332..3
..3...332.332
.332..332.332
.332..332.332
.332..332.332
.332..332.332
.332..332.332
.3322222222221
..11111111110`, ['#8a8278', '#bcb4a8', '#e6e0d6', '#ffffff']),
  amethyst_shard: shard(['#3a1f6a', '#6a3fb0', '#9a6ae0', '#e0c8ff'], [[0, -12, 7, 2.2], [-4, -7, 5, 1.3], [4, -6, 8, 1.3]]),
  echo_shard: shard(['#051a22', '#0a3a4a', '#1f6a7a', '#4ab8c8'], [[0, -11, 9, 2], [3, -4, 6, 1]]),
  prismarine_crystals: p => sil(p, px`
.
.......3
......332
.....33221
......221
.......1
...3.......3
..332.....332
.33221...33221
..221.....221
...1...3...1
......332
.....33221
......221
.......1`, ['#3a6a5a', '#7ac0a8', '#b8f0dc', '#ffffff']),
  prismarine_shard: p => sil(p, px`
.
.
............##
..........####
.........####
.......######
......#####
.....3######
....33#####
...33######
..33#####
..3######
..####
..##`, ['#2a5a4a', '#4a8a7a', '#6ab29a', '#a8e0cc']),
  redstone: dust(['#4a0000', '#9a0808', '#dc1a10', '#ff6050']), glowstone_dust: dust(['#8a6a2a', '#d0a040', '#f2d06a', '#fff4b0']),
  sugar: dust(['#b8b8c0', '#dcdce0', '#f0f0f0', '#ffffff']), gunpowder: dust(['#262626', '#444444', '#666666', '#8c8c8c']),
  blaze_powder: dust(['#8a3a00', '#d86a10', '#f8a020', '#ffe070']), bone_meal: dust(['#a8a490', '#d0ccb8', '#ece8d8', '#ffffff']),
  clay_ball: p => sil(p, over(disc(8, 8.5, 5), px`
.
.
.
.
.
.....33
....3w
.
..........1
.........1`), ['#5a6270', '#8a92a0', '#a4acb8', '#c8d0da']),
  slime_ball: orb(['#2e7a22', '#4eaa36', '#72d052', '#b0f090'], 5, px`
.
.
.
.
.
.
.......44
......4444
......4444
.......44`, { 4: '#3c9a2c' }),
  ender_pearl: orb(['#062a24', '#0f4a40', '#1c6a5a', '#3a9a86'], 5, px`
.
.
.
.
.
.
......aaa
.....abbba
.....abcba
.....abbba
......aaa`, { a: '#2a8a74', b: '#56c8a8', c: '#0a3a32' }),
  ender_eye: orb(['#0a3a32', '#1a6a5a', '#2a9a82', '#6ad8b8'], 5, px`
.
.
.
.
.
.....aaaa
....abbbba
....abkbba
....abkbba
....abbbba
.....aaaa`, { a: '#5a8a2a', b: '#b8e070' }),
  heart_of_the_sea: orb(['#4a3422', '#7a5a3a', '#a8845a', '#d0b080'], 5.5, px`
.
.
.
.
.....bbbb
....bccccb
....bcddcb
....bcddcb
....bccccb
.....bbbb`, { b: '#1a4a9a', c: '#3a8ae0', d: '#b0e0ff' }),
  magma_cream: orb(['#6a2008', '#b84818', '#e87a28', '#ffc040'], 4.8, px`
.
.
.
.
.
.........a
....a...a
.....a.aa
......yy
.....ayy.a
....a....a`, { a: '#5a1a08', y: '#ffe070' }),
  ghast_tear: p => sil(p, px`
.
.
.
.......#
.......#
......###
......###
.....##w##
.....#w###
....#######
....#######
....#######
.....#####
......###`, ['#7a98a4', '#b8d0d8', '#e0f0f4', '#ffffff']),
  string: p => sil(p, px`
.
.
..........wwv
.........w...v
.........w...v
..........vv.v
......wwv...v
.....w...vvv
.....w..v
......vv
...wwv
..w..v
..w.v
...v`, null, { w: '#f0f0f0', v: '#b0b0b0' }, '#3a3a3a'),
  feather: p => sil(p, px`
.
............ww
..........wwwv
.........wwwqv
........wwwqvv
.......wwwqvv
......wwwqvv
.....wwwqvv
....wwwqvv
...wwwqvv
...wwqvv
...wqv
..q
.q`, null, { w: '#f4f4f4', v: '#b8b8c0', q: '#8a7a6a' }),
  leather: p => sil(p, over(px`
.
.
..##.......##
..###########
...##########
..############
.#############
..###########
..############
.#############
..###########
...##########
..##.......##`, px`
.
.
.
.
.....1...1
.
........1
....1
.
.........1
.....1`), MAT.leather),
  rabbit_hide: p => sil(p, px`
.
.
.
...#.......#
...#########
....#######
...#########
..##########
...#########
....#######
...#########
...#.......#`, ['#6a5238', '#8a6c4a', '#a88a64', '#c8aa80']),
  rabbit_foot: p => sil(p, px`
.
.
..........##
.........####
........#####
.......#####
......######
.....#######
....########
...#p#p####
..pp#pp###
..ppppp#
...pp.pp`, ['#5a4228', '#8a6a4a', '#a88a64', '#c8aa80'], { p: ['#a89478', '#d0bca0', '#e8d8c0', '#fff4e4'] }),
  bone: p => sil(p, shape((x, y) => {
    const lumps = [[11, 2], [13, 4], [4, 13], [2, 11]].some(([cx, cy]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= 1.5);
    return (lumps || ((x + y === 14 || x + y === 15) && y >= 3 && y <= 12)) && '#';
  }), ['#8a8470', '#c8c2a8', '#e6e0cc', '#fbf8ee']),
  blaze_rod: p => { stick(p, ['#6a2a00', '#e08a10', '#ffd040'], 2); for (const y of [4, 7, 10]) p.put(15 - y, y, '#fff4a0'); },
  nether_wart: p => sil(p, px`
.
.
.
.....##
....####.##
....###3####
..##3##.#3##
.##3###..###
.#####..####
..###.s.###
......s
.....s
....s`, ['#4a0a10', '#7a141e', '#a82230', '#d84a58'], { s: '#5a1a18' }),
  paper: p => sil(p, px`
.
.
...#########
...##########
...#llllll###
...##########
...#lllll####
...##########
...#llllll###
...##########
...#llll#####
...##########
...##########`, ['#8a8878', '#d8d8cc', '#f2f2ea', '#ffffff'], { l: '#c8c8bc' }),
  book,
  wheat: p => sil(p, px`
.
.......y
...y..yyy..y
..yyy.yyy.yyy
..yyy.yyy.yyy
..yyy.yyy.yyy
...yy.yyy.yy
....s..s..s
.....s.s.s
......bbb
......sss
.....s.s.s
....s..s..s
...s...s...s`, null, { y: ['#6a5010', '#a8801e', '#d8b040', '#f0d878'], s: '#9a8a2a', b: '#6a4a1a' }),
  wheat_seeds: seeds('#5a9a2a', '#2e6a18', '#16300a'), beetroot_seeds: seeds('#d8c8a0', '#a08a60', '#3a3020'),
  pumpkin_seeds: seeds('#f0e8c0', '#c8b880', '#6a5a30'), melon_seeds: seeds('#3a3226', '#1a160e', '#8a7a58'),
  bowl: bowl('#6b4c24', '#4a3419'),
  glass_bottle: bottle(null),
  experience_bottle: bottle(['#3a8a1a', '#6ad82a', '#a8f060', '#e8ffa8']),
  dragon_breath: bottle(['#7a2a6a', '#b84aa0', '#e07ad0', '#ffc0f0']),
  honey_bottle: bottle(['#a8661a', '#e0961a', '#f8c040', '#fff0a0']),
  ink_sac: pouch('#2e2e44'), glow_ink_sac: p => { pouch('#1a9a92')(p); for (const [x, y] of [[5, 8], [8, 10], [9, 7]]) p.put(x, y, '#b8fff4'); },
  phantom_membrane: p => sil(p, over(px`
.
.
.
.....####
...#########
..############
.#############
..############
...###########
....##########
......########
.........####`, px`
.
.
.
.
....v....v
.....v..v
......vv
......v
.....v
....v`), ['#6a6a7a', '#9a9aa8', '#c8c8d4', '#ececf4'], { v: '#8a8a9a' }),
  shulker_shell: p => sil(p, px`
.
.
.
.....######
...##########
..############
..############
.##############
.##############
.rrrrrrrrrrrrrr
.##############
..############`, ['#4a2a5a', '#7a4a8a', '#a870b8', '#d0a0e0'], { r: '#3a1a48' }),
  nautilus_shell: p => { sil(p, disc(8, 8.5, 5.5), ['#8a7a6a', '#c8b8a8', '#e8d8c8', '#fff8f0'], {}, false); for (let t = 0.6; t < 11; t += 0.08) { const x = Math.round(7.8 + Math.cos(t) * t * 0.42), y = Math.round(8.3 + Math.sin(t) * t * 0.42); if (p.alpha(x, y)) p.put(x, y, '#9a5a44'); } outline(p); },
  scute: p => sil(p, px`
.
.
.
.....#####
....#######
...###3333##
..###3222211#
..##322222211#
..##32222221##
...#3222221##
....#11111##
.....######`, ['#1f4a1f', '#2f7a2f', '#47a347', '#6ac26a']),
  honeycomb: p => sil(p, over(disc(8, 8.5, 5.6), px`
.
.
.
.
.....c..c
....c.cc.c
.......c
....c..c..c
...c.cc.cc.c
......c..c
.....c.cc.c
........c`), ['#8a4e0a', '#d88a18', '#f6b830', '#ffe890'], { c: '#9a5a10' }),
  nether_star: p => sil(p, shape((x, y) => { const dx = Math.abs(x + 0.5 - 8), dy = Math.abs(y + 0.5 - 8); return (dx * dx + dy * dy < 7 || Math.sqrt(dx) + Math.sqrt(dy) < 2.72) && (dx + dy < 2 ? 'w' : '#'); }), ['#9a9a7a', '#d8d8c0', '#f4f4e0', '#ffffff']),
  disc_fragment: p => sil(p, shape((x, y) => { const d = Math.hypot(x + 0.5 - 3, y + 0.5 - 3); return d < 11 && x + y > 4 && y >= 2 && x >= 2 && (d > 5 && d < 6 || d > 8 && d < 9 ? 'g' : '#'); }), ['#161616', '#262626', '#383838', '#5a5a5a'], { g: '#707070' }),
  totem_of_undying: p => sil(p, px`
.
.....######
.....#3333#
.....#e##e#
.....######
......#kk#
..############
..##########11
....########
....##gggg##
....########
....###..###
....###..###`, ['#6a5210', '#b8961e', '#e8c83c', '#fff0a0'], { e: '#3ad060', k: '#6a4a08', g: '#2a9a4a' }),
  name_tag: p => sil(p, px`
.
..www
.w...w
.w....w
..w....w
...ww..w
.....w.#######
....#w#########
...#h##########
....###########
.....##########`, ['#6a5238', '#a88a64', '#d8c8a0', '#f0e4c8'], { w: '#e8e8e8', h: '#3a2a18' }),
  saddle: p => sil(p, px`
.
.
..##.......##
..###.....###
..###########
.#############
.#############
..###########
...s......s
...s......s
...s......s
..iii....iii
..i.i....i.i
..iii....iii`, MAT.leather, { s: '#3a2410', i: ['#4a4a4a', '#8a8a8a', '#b8b8b8', '#e0e0e0'] }),
  lead: p => { sil(p, shape((x, y) => { const u = (x + 0.5 - 8) / 5.2, v = (y + 0.5 - 7) / 4.2, d = u * u + v * v; return d <= 1 && d >= 0.4 && ((Math.round(Math.atan2(v, u) * 3) & 1) ? 'a' : 'b'); }), null, { a: '#8a6a44', b: '#c8a878' }, false); line(p, 4, 10, 2, 13, '#a88a5a'); p.put(3, 12, '#c8a878'); outline(p); },
  compass: p => sil(p, over(over(disc(8, 8, 6), disc(8, 8, 4.3, 'f')), px`
.
.
.
.
.
.....FF...r
....FF...rr
........rr
.......kr
......nk
.....nn
.....n`), MAT.iron, { f: '#454545', F: '#5a5a5a', r: '#e02a2a', n: '#e8e8e8', k: '#1a1a1a' }),
  clock: p => sil(p, over(over(disc(8, 8, 6), shape((x, y) => (x + 0.5 - 8) ** 2 + (y + 0.5 - 8) ** 2 <= 4.3 * 4.3 && (y < 8 ? 's' : 'n'))), px`
.
.
.
.
.
.......yy
.......yy
........k
........k
.
.
......ww
.....w..w`), MAT.golden, { s: '#4a8ae0', n: '#23234a', y: '#fff060', k: '#1a1a1a', w: '#cfd8ff' }),
  snowball: orb(['#8aa8c0', '#c8dcec', '#eef6ff', '#ffffff'], 4.8),
  fire_charge: orb(['#140804', '#2e1208', '#4a1c0c', '#6a2a10'], 5, px`
.
.
.
.....a
......a..a
.......aa
.....ay.a
....a.yya
.......y.a
......a
.....a`, { a: '#ff8a20', y: '#ffe060' }),
  egg: p => sil(p, over(EGG, px`
.
.
.
.
.
.........a
.
.....a
.
...........a
.......a`), ['#a08a60', '#d8c49c', '#ece0c0', '#fffaf0'], { a: '#c8b088' }),
  flint_and_steel: p => sil(p, px`
.
.
...ssssss
..ssssssss
..ss....ss
..ss....ss
..ss....ss
...s...###
......#####
.....###3###
.....##33###
......#3###
.......###`, ['#141414', '#2a2a2a', '#404040', '#6a6a6a'], { s: MAT.iron }),
  shears,
  bucket: bucket('#6a6a6a', '#3a3a3a'), water_bucket: bucket('#4a7af0', '#2a4ad0'), lava_bucket: bucket('#ffb030', '#e0601a'),
  milk_bucket: bucket('#ffffff', '#e4e4e4'),
  fishing_rod: p => { for (let k = 0; k <= 10; k++) { p.put(2 + k, 13 - k, k % 3 ? HANDLE[2] : HANDLE[1]); } p.put(2, 13, '#3a3a3a'); p.put(3, 12, '#3a3a3a'); outline(p); line(p, 13, 3, 13, 11, '#d8d8d8'); p.put(12, 12, '#a8a8a8'); p.put(12, 11, '#a8a8a8'); p.put(13, 12, '#a8a8a8'); },
  // Held while the line is out: the rod alone, the line leaves from its tip.
  fishing_rod_cast_sprite: p => { for (let k = 0; k <= 10; k++) { p.put(2 + k, 13 - k, k % 3 ? HANDLE[2] : HANDLE[1]); } p.put(2, 13, '#3a3a3a'); p.put(3, 12, '#3a3a3a'); outline(p); },
  bow: p => bow(p, 0), crossbow: p => crossbow(p),
  arrow: p => arrow(p), spectral_arrow: p => arrow(p, MAT.golden, ['#c8a018', '#fff0a0']),
  shield: p => sil(p, px`
.
..iiiiiiiiiiii
..i322d22d222i
..i322d22d221i
..i222d22d221i
..i222oooo221i
..i222oxxo221i
..i222oxxo221i
..i222oooo221i
..i222d22d221i
...i22d22d21i
....i2d22d2i
.....i2222i
......iiii`, MAT.wood, { i: ['#2e2e2e', '#5e5e5e', '#8e8e8e', '#bcbcbc'], d: '#4a3419', o: '#8e8e8e', x: '#c8c8c8' }),
  trident,
  firework_rocket: p => sil(p, px`
.
.......w
......ggg
.....ggggg
.....rrrrr
.....wwwww
.....rrrrr
.....rrrrr
.....wwwww
.....rrrrr
.....rrrrr
.......s
.......s
.......s`, null, { g: ['#5a5a5a', '#8a8a8a', '#b0b0b0', '#d8d8d8'], r: ['#6a1010', '#a82020', '#d03030', '#f06060'], w: ['#9a9a9a', '#d0d0d0', '#f0f0f0', '#ffffff'], s: '#8a6a3a' }),
  elytra: p => sil(p, over(px`
.
...###..###
..####..####
.#####..#####
.#####..#####
.#####..#####
.####....####
.####....####
.###......###
.###......###
..##......##
..##......##
..#........#`, px`
.
.
....f....f
...f.f..f.f
..f.f....f.f
..f.f....f.f
...f......f
..f........f`), MAT.elytra, { f: MAT.elytra[1] }),
  // Food
  apple: apple(['#5c0c0c', '#a8141a', '#d8282a', '#f06050'], '#ffd0c0'),
  golden_apple: apple(['#7a5a0a', '#d4a018', '#f4d040', '#fff4a0'], '#ffffff'),
  enchanted_golden_apple: p => { G.golden_apple(p); for (const [x, y] of [[5, 9], [9, 6], [11, 10], [7, 12]]) p.put(x, y, '#ff9aff'); },
  bread: p => sil(p, px`
.
.
.
.
.
...3333333333
..333c33c33c32
.332c22c22c2221
.32222222222221
.22222222222211
..111111111111`, ['#5a3010', '#9a5a1e', '#c8863a', '#e6b060'], { c: '#f4d890' }),
  porkchop: meat(PORK, ['#8a3a3a', '#c05a5a', '#e88a8a', '#f8b0b0'], '#fae0dc'), cooked_porkchop: meat(PORK, ['#4a2210', '#8a5028', '#b87840', '#d8a060'], '#e8c080'),
  beef: meat(STEAK, ['#5a0c0c', '#a02424', '#c83838', '#e06060'], '#f0c8c0'), cooked_beef: meat(STEAK, ['#2e1408', '#5a3016', '#7a4822', '#9a6434'], '#b88858'),
  chicken: meat(DRUM, ['#b08a7a', '#e0b8a8', '#f0d4c8', '#fff0e8'], '#fff'), cooked_chicken: meat(DRUM, ['#5a300c', '#a0601c', '#c8883a', '#e8b068'], '#fff'),
  mutton: meat(LEG, ['#7a1f1f', '#b83a3a', '#d86060', '#f09090'], '#fff'), cooked_mutton: meat(LEG, ['#3e1c0c', '#6e3a1c', '#96582e', '#b87848'], '#fff'),
  rabbit: meat(BUNNY, ['#9a6a5a', '#d09a8a', '#ecbcb0', '#fff0e8'], '#fff'), cooked_rabbit: meat(BUNNY, ['#5a300c', '#9a5a1c', '#c8843a', '#e8ac68'], '#fff'),
  rabbit_stew: bowl('#b0661e', '#8a4a14', STEW_BITS), mushroom_stew: bowl('#dcc4a0', '#b89a74', STEW_BITS), beetroot_soup: bowl('#b82a3a', '#8e1a2a'),
  cod: fish(['#4a3e2a', '#8a7658', '#b09a78', '#d0c09a'], '#e8dcc0', '#6a5a40'), cooked_cod: fish(['#6a4a2a', '#b88c60', '#dcb488', '#f4dcb8'], '#fff0dc', '#9a7048'),
  salmon: fish(['#5a1a14', '#a03a2a', '#c85a44', '#e8846a'], '#f0a890', '#3a5048'), cooked_salmon: fish(['#7a2e14', '#c0602e', '#e88848', '#ffb880'], '#ffd0a8', '#9a4a20'),
  tropical_fish: p => { fish(['#8a3a0a', '#e06a1a', '#ff9a40', '#ffc890'], '#ffd8b0', '#e0e0e0')(p); for (let y = 5; y < 12; y++) for (const x of [6, 10]) if (p.alpha(x, y) && p.get(x, y)[0] > 150) p.put(x, y, '#f4f4f4'); },
  pufferfish: p => sil(p, over(over(disc(8, 8.5, 4.8), px`
.
.
.
.
.
.
.....k..k
.
.
.......rr`), px`
.
.
.
........s
....s.......s
.
.
.
..s..........s
.
.
.
.
....s.......s
........s`, false), ['#8a7a1a', '#d8c030', '#f8e060', '#fff8b0'], { r: '#e08a3a', s: '#a89020' }),
  carrot: carrot(['#8a3a08', '#d86a10', '#f08a19', '#ffb050'], ['#1f5a14', '#4ab82a']),
  golden_carrot: carrot(['#8a6a10', '#d8a018', '#f8c830', '#fff080'], ['#5a7a10', '#b8d040']),
  potato: potato(['#7a5a24', '#c09850', '#dcb870', '#f0d8a0'], '#8a6a2a'),
  baked_potato: potato(['#5a3a14', '#a8742e', '#cc9a4a', '#e8c070'], '#6a4a1a', '#f8e8b0'),
  poisonous_potato: potato(['#5a6a1e', '#98aa44', '#b8c864', '#d8ec98'], '#4a5a1a'),
  beetroot: p => sil(p, px`
.
......g..g
.......gg.g
.......hg
.....#####
....#######
...#########
...#w#######
...#########
....#######
.....#####
......###
.......#
.......#`, ['#4a0a1a', '#8e1a2e', '#b83040', '#d85a6a'], { g: '#4aa83a', h: '#2e7a24', w: '#f0a0a8' }),
  melon_slice: p => sil(p, shape((x, y) => {
    const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 3);
    if (y < 3 || d > 7.4) return null;
    if (d > 6.5) return 'h'; if (d > 5.6) return 'g';
    return [[5, 5], [8, 6], [11, 5], [7, 8], [9, 8]].some(([sx, sy]) => sx === x && sy === y) ? 'k' : '#';
  }), ['#8a1010', '#c82020', '#e83838', '#ff7060'], { h: '#2a6a1a', g: '#b8e080' }),
  sweet_berries: berries(['#5a0a1a', '#a8202a', '#d8404a', '#ff8080'], '#3a6a2a'),
  glow_berries: berries(['#8a5006', '#e8921e', '#ffbe48', '#fff0a0'], '#3a6a2a'),
  cookie: p => sil(p, over(disc(8, 8, 5.4), px`
.
.
.
.
......k
.........k
....k
.......k..k
.
.....k...k
........k`), ['#7a4a1e', '#b8803e', '#d8a060', '#eec088']),
  pumpkin_pie: p => sil(p, px`
.
.
.
.
.....cccccc
...cc######cc
..c##########c
.c############c
.c############c
.dc##########cd
.ddccccccccccdd
..dddddddddddd
...dddddddddd`, ['#8a4a10', '#d07a20', '#f09a30', '#ffc060'], { c: '#f4dca0', d: ['#6a3a10', '#a8661e', '#c88a3a', '#e0a850'] }),
  rotten_flesh: p => sil(p, over(px`
.
.
.
....####
..#######.#
..##########
.############
.############
..###########
.############
..##########
...#######
....##..##`, px`
.
.
.
.
....g
.........v
...v...g
.......v
.....g....g
...v
........v`), ['#4a3018', '#7a5a30', '#9a7a44', '#b89a60'], { g: '#5a7a2a', v: '#8a3a2a' }),
  spider_eye: orb(['#4a0a1a', '#8a1a2a', '#c83a4a', '#f07a8a'], 5, px`
.
.
.
.
.
.
.......kk
......kkkk
......kkkk
.......kk
.
....v....v
.....v..v`, { v: '#5a0a14' }),
  dried_kelp: p => sil(p, px`
.
.
............##
..........####
........######
......###1###
.....##1####
....##1####
...##1###
...#1###
..#####
..###`, ['#141e0c', '#26361a', '#3a4c26', '#56683a']),
  chorus_fruit: p => sil(p, over(px`
.
.
.
.....###..
....#####.##
...#########
..###########
..###########
.############
..##########
..##########
...########
....##..##`, px`
.
.
.
.
.....a
.........a
...a...a
......a....a
....a
.........a
......a`), ['#3a1f4a', '#6a4a7a', '#9a7aaa', '#c8a8d8'], { a: '#e0c8f0' }),
};
// Materials by pattern.
const MAT_KEYS = Object.keys(MAT);

function drawItem(it, p) {
  if (G[it.key]) { G[it.key](p); return true; }
  if (EXTRA_ITEM_TEX[it.key]) { EXTRA_ITEM_TEX[it.key](p, sil, px); return true; }
  if (it.tool && ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'].includes(it.tool.type)) {
    const pal = MAT[it.material];
    ({ sword, pickaxe, axe, shovel, hoe })[it.tool.type](p, pal);
    return true;
  }
  if (it.armor && it.material in MAT && it.tex) { armor(p, it.tex, MAT[it.material], it.material); return true; }
  if (it.dye) { pouch(DYE_COLORS[it.dye])(p); return true; }
  if (it.eggColors) { egg(p, it.eggColors[0], it.eggColors[1]); return true; }
  return false;
}
export const DYE_COLORS = {
  white: '#f0f0f0', orange: '#f08a19', magenta: '#c64fbd', light_blue: '#3ab3da', yellow: '#fed83d', lime: '#80c71f', pink: '#f38baa', gray: '#474f52',
  light_gray: '#9d9d97', cyan: '#169c9c', purple: '#8932b8', blue: '#3c44aa', brown: '#835432', green: '#5e7c16', red: '#b02e26', black: '#1d1d21',
};

// Effect sprites share the item texture array. Most are tinted per particle, so they stay light and near-neutral.
export const FX = ['smoke_0', 'smoke_1', 'smoke_2', 'flame', 'heart', 'crit', 'bubble', 'note', 'rain', 'snow', 'explosion_0', 'explosion_1', 'explosion_2', 'explosion_3',
  'xp_0', 'xp_1', 'portal', 'splash', 'angry', 'happy', 'soul', 'lava_drip', 'water_drip', 'bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2', 'crossbow_loaded', 'crossbow_pulling_0', 'crossbow_pulling_1', 'crossbow_pulling_2', 'crossbow_arrow', 'crossbow_firework', 'fishing_rod_cast', 'fishing_bobber', 'blank', 'spark', 'ash', 'end_rod', 'white', 'glint'];
const GREY = ['#5a5a5a', '#808080', '#a8a8a8', '#cccccc'];
// Plus-shaped sparkle: arm length a (and diagonal stubs of length d), bright core.
const sparkle = (a, d) => shape((x, y) => { const dx = Math.abs(x - 7), dy = Math.abs(y - 7); return ((dx === 0 && dy <= a) || (dy === 0 && dx <= a) || (dx === dy && dx <= d)) && (dx + dy === 0 ? 'w' : dx + dy < 2 ? 'b' : 'a'); });
const DROP = px`
.
.
.
.
.
.......3
.......3
......322
......321
.....32221
.....22211
......211`;
const FLAME = px`
.
.
.
.......a
.......a
......aa
......aba.a
.....abba
.....abbba
....abbcba
....abccba
....abcwcba
....abccba
.....abba
......aa`;
// Smoke puffs grow per frame; explosion frames go from a dense bright puff to scattered dark wisps.
const SMOKE = [[[8, 8, 2]], [[7.5, 8.5, 2.6], [9.5, 7, 2]], [[7, 9, 3.2], [10, 7, 2.8], [6, 6, 2.2]]];
const EXPLODE = [
  [[8, 8, 4.4], [5, 5.5, 3], [11, 5.5, 3], [4.5, 10.5, 3], [11.5, 10.5, 3], [8, 12, 2.6]],
  [[8, 8, 4.6], [4.5, 5, 3.2], [11.5, 5, 3.2], [4, 11, 3.2], [12, 11, 3.2], [8, 3.5, 2.4]],
  [[5, 5, 2.8], [11, 5, 2.8], [4.5, 11, 2.8], [11.5, 11, 2.8], [8, 8, 2.2]],
  [[4.5, 4.5, 2], [11.5, 5, 1.8], [4.5, 11.5, 1.8], [11, 11, 2.2]]];
const BOOM = [['#9a9a9a', '#d0d0d0', '#f0f0f0', '#ffffff'], ['#8a8a8a', '#bcbcbc', '#e0e0e0', '#f8f8f8'], ['#6a6a6a', '#8e8e8e', '#b0b0b0', '#d0d0d0'], ['#505050', '#6e6e6e', '#8a8a8a', '#a8a8a8']];
function drawFx(name, p) {
  switch (name) {
    case 'smoke_0': case 'smoke_1': case 'smoke_2': lumps(SMOKE[Number(name.slice(-1))], GREY, [], null, false)(p); break;
    case 'flame': sil(p, FLAME, null, { a: '#e04a10', b: '#f8901a', c: '#ffd040', w: '#fff8c8' }, false); break;
    case 'heart': sil(p, px`
.
.
.
...##...##
..####.####
..#w#######
..#########
...#######
....#####
.....###
......#`, ['#6a0a0a', '#c01414', '#f03a3a', '#ff8a8a'], { w: '#ffd0d0' }, '#2a0000'); break;
    case 'crit': sil(p, sparkle(5, 2), null, { a: '#c8c8c8', b: '#ececec' }, false); break;
    case 'bubble': sil(p, shape((x, y) => { const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8); return d <= 3.6 && d > 2.4 && (x + y < 14 ? 'a' : 'b'); }), null, { a: '#d8f0ff', b: '#78a8e0' }, false); p.put(6, 6, '#ffffff'); break;
    case 'note': sil(p, px`
.
.
.........##
.........#.#
.........#..#
.........#..#
.........#
.........#
......####
.....#####
.....####`, ['#8a8a8a', '#c8c8c8', '#f0f0f0', '#ffffff'], {}, '#2a2a2a'); break;
    case 'rain': p.rect(7, 1, 1, 14, '#b4d0ff', 210); p.rect(8, 2, 1, 12, '#7aa0e8', 170); break;
    case 'snow': sil(p, px`
.
.
.
.
.
.
.......a
......aba
.....abwba
......aba
.......a`, null, { a: '#c8d8f0', b: '#e8f0ff' }, false); break;
    case 'explosion_0': case 'explosion_1': case 'explosion_2': case 'explosion_3': { const k = Number(name.slice(-1)); lumps(EXPLODE[k], BOOM[k], [], null, false)(p); break; }
    case 'xp_0': case 'xp_1': sil(p, over(disc(8, 8, 3.3), px`
.
.
.
.
.
.
......w`), name === 'xp_0' ? ['#3a8a1a', '#6ad82a', '#b8f860', '#f0ffc0'] : ['#7a8a10', '#c8e82a', '#f0ff70', '#ffffff'], {}, '#1a3a0a'); break;
    case 'portal': sil(p, sparkle(2, 1), null, { a: '#8a2ad8', b: '#c870ff', w: '#f4d8ff' }, false); break;
    case 'splash': sil(p, px`
.
.
.
.
.
.
.....a....a
....aba..aba
.....a....a
.
.......a
......aba
.......a`, null, { a: '#6a9ae8', b: '#c8e0ff' }, false); break;
    case 'angry': mask(p, ['................', '................', '................', '...##.....##....', '....##...##.....', '.....##.##......', '................', '.....##.##......', '....##...##.....', '...##.....##....', '................', '................', '................', '................', '................', '................'], ['#6a0a0a', '#d02a2a', '#ff4a4a', '#ff8a8a'], () => 2); outline(p, '#3a0000'); break;
    case 'happy': mask(p, ['................', '.......#........', '......###.......', '.......#........', '....#.....#.....', '...###...###....', '....#.....#.....', '................', '.......#........', '......###.......', '.......#........', '................', '................', '................', '................', '................'], ['#1a6a1a', '#3ac83a', '#8aff8a', '#ffffff'], () => 2); break;
    case 'soul': sil(p, FLAME, null, { a: '#1a6a7a', b: '#3aa8c0', c: '#7ae8f8', w: '#e8ffff' }, false); break;
    case 'lava_drip': sil(p, DROP, ['#a02a00', '#e8601a', '#ffa030', '#ffe080'], {}, false); break;
    case 'water_drip': sil(p, DROP, ['#1a3aa0', '#2a5ad8', '#5a8af0', '#b0d0ff'], {}, false); break;
    case 'bow_pulling_0': bow(p, 1); break;
    case 'bow_pulling_1': bow(p, 2); break;
    case 'bow_pulling_2': bow(p, 3); break;
    case 'crossbow_loaded': case 'crossbow_arrow': crossbow(p, 10, 'arrow'); break;
    case 'crossbow_firework': crossbow(p, 10, 'rocket'); break;
    case 'crossbow_pulling_0': crossbow(p, 8); break;
    case 'crossbow_pulling_1': crossbow(p, 9); break;
    case 'crossbow_pulling_2': crossbow(p, 10); break;
    case 'fishing_rod_cast': G.fishing_rod_cast_sprite(p); break;
    case 'fishing_bobber': sil(p, px`
.
.
.
.......k
......rrr
.....rrrrr
.....rrrrr
.....wwwww
.....wwwww
......www`, null, { k: '#303030', r: ['#6a1010', '#a82020', '#e03030', '#f06060'], w: ['#9a9a9a', '#d0d0d0', '#f0f0f0', '#ffffff'] }); break;
    case 'spark': sil(p, sparkle(2, 0), null, { a: '#ffe8a0', b: '#fff4d0' }, false); break;
    case 'ash': p.rect(7, 7, 2, 2, '#3a3a3a'); p.put(7, 7, '#5a5a5a'); break;
    case 'end_rod': sil(p, sparkle(2, 1), null, { a: '#d8d0f0', b: '#f0ecff' }, false); break;
    case 'white': p.fill('#ffffff'); break;
    case 'glint': sil(p, sparkle(4, 2), null, { a: '#9a4ac8', b: '#d8a0ff', w: '#f8e8ff' }, false); break;
    default: break;
  }
}


// ---------- layer table ----------
// Item key -> layer; FX name -> layer. Flat block items copy their block texture.
export const ITEM_LAYER = {};
export const FX_LAYER = {};
export const flatTexFor = it => {
  const [id, meta] = it.block;
  const k = (id << 4) | (meta & VARIANT_MASK[id]);
  return TEXTURES[FACE_TEX[k * 7]];
};
let layers = 0;
for (const it of ITEMS) if (!it.block || it.flat) ITEM_LAYER[it.key] = layers++;
for (const f of FX) FX_LAYER[f] = layers++;
export const ITEM_LAYER_COUNT = () => layers;

export function generateItemTextures() {
  const out = [];
  for (const it of ITEMS) {
    if (it.block && !it.flat) continue;
    const p = new Painter(N, N, it.id + 7);
    if (it.block && !G[it.key]) {
      const name = it.key.endsWith('_door') ? `door_${it.key.slice(0, -5)}_top` : flatTexFor(it);
      p.d.set(drawBlockTexture(name, it.id + 3));
      // Plants and vines are grey + biome tinted in the world; give their icons a fixed green.
      for (let i = 0; i < N * N; i++) if (p.d[i * 4 + 3] === 254) { p.d[i * 4] *= 0.5; p.d[i * 4 + 1] *= 0.78; p.d[i * 4 + 2] *= 0.35; p.d[i * 4 + 3] = 255; }
    } else if (!drawItem(it, p)) {
      blob(p, 8, 8, 5, 5, ramp(`#${((it.id * 2654435761) >>> 8 & 0xffffff).toString(16).padStart(6, '0')}`));
      outline(p);
    }
    out.push(p.d);
  }
  for (const f of FX) { const p = new Painter(N, N, 99); drawFx(f, p); out.push(p.d); }
  // Keep the tint marker out of item sprites.
  for (const d of out) for (let i = 3; i < d.length; i += 4) if (d[i] === 254) d[i] = 255;
  return out;
}
export { MAT_KEYS };

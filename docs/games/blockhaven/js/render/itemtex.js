// Procedural 16x16 pixel art for every non-block item, plus particle/effect sprites.
// Icons are painted with a few primitives, then given MC-style dark outlines automatically.
import { Painter, shade, mixHex, ramp } from './paint.js?v=munfaoam';
import { ITEMS, I } from '../data/items.js?v=munfaoam';
import { TEXTURES, TEX, BLOCKS, FACE_TEX, VARIANT_MASK, COLORS } from '../data/blocks.js?v=munfaoam';
import { drawBlockTexture } from './blocktex.js?v=munfaoam';

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
function handle(p, x0, y0, x1, y1) {
  line(p, x0, y0, x1, y1, (x, y, k) => HANDLE[k % 2 ? 1 : 2]);
  line(p, x0 + 1, y0, x1 + 1, y1, (x, y, k) => HANDLE[0]);
}

// ---------- tools ----------
function sword(p, pal) {
  for (let k = 0; k < 9; k++) { p.put(5 + k, 10 - k, pal[3]); p.put(6 + k, 10 - k, pal[2]); p.put(6 + k, 11 - k, pal[1]); }
  p.put(14, 1, pal[3]); p.put(15, 0, pal[2]);
  line(p, 2, 8, 7, 13, pal[1]); line(p, 3, 8, 7, 12, pal[2]);
  handle(p, 2, 13, 4, 11);
  p.put(1, 14, pal[1]); p.put(2, 14, pal[0]);
  outline(p);
}
function pickaxe(p, pal) {
  handle(p, 2, 13, 10, 5);
  for (let t = -1.72; t <= 0.14; t += 0.02) {
    for (const [rr, k] of [[10.2, 1], [11.2, 2], [12.2, 3]]) {
      const x = Math.round(3 + rr * Math.cos(t)), y = Math.round(12 + rr * Math.sin(t));
      if (x >= 0 && y >= 0 && x < N && y < N) p.put(x, y, pal[k]);
    }
  }
  outline(p);
}
function axe(p, pal) {
  handle(p, 2, 13, 11, 4);
  const pts = [[7, 2], [8, 1], [9, 1], [10, 1], [11, 2], [12, 3], [13, 4], [13, 5], [12, 6], [11, 7], [10, 7]];
  for (let y = 1; y < 8; y++) for (let x = 7; x < 14; x++) {
    const inside = (x - 7) + (y - 1) >= 1 && x - y < 10 && x + y < 19 && !(x <= 9 && y >= 5) && y - x < 0;
    if (inside) p.put(x, y, pal[x + y < 11 ? 3 : x + y < 14 ? 2 : 1]);
  }
  for (const [x, y] of pts) if (!p.alpha(x, y)) p.put(x, y, pal[1]);
  outline(p);
}
function shovel(p, pal) {
  handle(p, 2, 13, 9, 6);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x + 0.5 - 11.5, v = y + 0.5 - 4.5, a = (u + v) / 1.414, b = (u - v) / 1.414;
    if (Math.abs(a) / 3.2 + Math.abs(b) / 2.4 <= 1.05) p.put(x, y, pal[a + b < -1.5 ? 3 : a + b < 1 ? 2 : 1]);
  }
  outline(p);
}
function hoe(p, pal) {
  handle(p, 2, 13, 11, 4);
  line(p, 8, 2, 12, 2, pal[3]); line(p, 8, 3, 12, 3, pal[2]); p.put(13, 3, pal[1]); p.put(13, 4, pal[1]); p.put(12, 4, pal[1]);
  outline(p);
}
function shears(p) {
  const pal = MAT.iron;
  line(p, 3, 3, 9, 9, pal[3]); line(p, 4, 3, 10, 9, pal[2]);
  line(p, 12, 3, 6, 9, pal[2]); line(p, 12, 4, 7, 9, pal[1]);
  blob(p, 11.5, 11.5, 2.3, 2.3, ['#3a1010', '#7a1f1f', '#b52a2a', '#d84a4a']);
  blob(p, 5.5, 11.5, 2.3, 2.3, ['#3a1010', '#7a1f1f', '#b52a2a', '#d84a4a']);
  p.put(11, 11, '#000000', 0); p.put(5, 11, '#000000', 0);
  outline(p);
}

// ---------- armor ----------
const ARMOR_MASKS = {
  helmet: ['................', '................', '................', '....########....', '...##########...', '..############..', '..############..', '..###......###..', '..###......###..', '..##........##..', '................', '................', '................', '................', '................', '................'],
  chestplate: ['................', '..###......###..', '..####....####..', '..############..', '..############..', '..############..', '...##########...', '....########....', '....########....', '....########....', '....########....', '....########....', '....########....', '................', '................', '................'],
  leggings: ['................', '................', '...##########...', '...##########...', '...##########...', '...####..####...', '...####..####...', '...####..####...', '...####..####...', '...####..####...', '...####..####...', '...####..####...', '...####..####...', '................', '................', '................'],
  boots: ['................', '................', '................', '................', '................', '................', '...###....###...', '...###....###...', '...###....###...', '..####....####..', '.#####....#####.', '.#####....#####.', '................', '................', '................', '................'],
};
function armor(p, piece, pal, mat) {
  mask(p, ARMOR_MASKS[piece], pal, (x, y) => (x + y) % 7 === 0 ? 3 : x < 7 ? 2 : 1);
  if (mat === 'chainmail') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (p.alpha(x, y) && (x + y) % 2 === 0 && y % 2 === 0) p.put(x, y, '#000000', 0);
  if (mat === 'diamond' || mat === 'golden' || mat === 'iron') for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (p.alpha(x, y) && !p.alpha(x, y - 1)) p.put(x, y, pal[3]);
  outline(p);
}

// ---------- generic shapes ----------
const ingot = pal => p => { for (let y = 6; y < 12; y++) for (let x = 2; x < 14; x++) { const s = x - (11 - y); if (s < 0 || s > 9) continue; p.put(x, y, pal[y === 6 ? 3 : y < 8 ? 2 : y < 11 ? 1 : 0]); } outline(p); };
const nugget = pal => p => { blob(p, 7.5, 9, 3.4, 2.6, pal, { rough: 0.2 }); p.put(6, 8, pal[3]); outline(p); };
const gem = pal => p => {
  const rows = ['................', '................', '.....######.....', '....#3333332....', '...#33233223#...', '..#3322222111#..', '..#2222211111#..', '...#22211110#...', '....#221110#....', '.....#2110#.....', '......#10#......', '.......##.......', '................', '................', '................', '................'];
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') p.put(x, y, pal[0]); else if (ch >= '0' && ch <= '3') p.put(x, y, pal[Number(ch)]); }));
};
const dust = pal => p => { for (let k = 0; k < 70; k++) { const a = p.r() * Math.PI * 2, r = Math.sqrt(p.r()) * 5; const x = Math.round(8 + Math.cos(a) * r * 1.2), y = Math.round(10 + Math.sin(a) * r * 0.6); p.put(x, y, pal[p.rand(4)]); } };
const lump = (pal, spots) => p => { blob(p, 8, 8.5, 5, 4.2, pal, { rough: 0.25, rot: 0.4 }); if (spots) p.speck(spots, 6); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!p.alpha(x, y)) p.put(x, y, '#000', 0); outline(p); };
const food = (pal, opts) => p => { blob(p, 8, 8.5, opts.rx || 5.5, opts.ry || 4, pal, { rot: opts.rot ?? -0.5 }); if (opts.deco) opts.deco(p); outline(p); };

function bucket(p, fill) {
  const pal = MAT.iron;
  mask(p, ['................', '................', '................', '...##########...', '..#..........#..', '..############..', '..############..', '...##########...', '...##########...', '...##########...', '....########....', '....########....', '.....######.....', '................', '................', '................'], pal, (x, y) => (x < 5 ? 3 : x < 11 ? 2 : 1));
  if (fill) for (let x = 3; x < 13; x++) p.put(x, 4, fill[x % fill.length]);
  else for (let x = 3; x < 13; x++) p.put(x, 4, '#2a2a2a');
  outline(p);
}
function bow(p, pull) {
  const wood = ['#3d2a12', '#6b4c24', '#9c7640'];
  const r = 9 - pull * 0.8;
  for (let t = -0.35; t <= 1.92; t += 0.03) {
    const x = Math.round(2 + Math.cos(t) * r), y = Math.round(13 - Math.sin(t) * r);
    if (x >= 0 && y >= 0) { p.put(x, y, wood[2]); p.put(x - 1, y + 1 < N ? y : y, wood[1]); }
  }
  line(p, 2 + pull, 13 - pull, 12 - pull, 3 + pull, '#d8d8d8');
  if (pull > 0) { line(p, 3 + pull, 12 - pull, 14 - pull, 1 + pull, '#8a6a3a'); p.put(14 - pull, 1 + pull, '#bbbbbb'); }
  outline(p);
}
function arrow(p, tip = MAT.iron) {
  line(p, 3, 12, 12, 3, '#8e6a38'); line(p, 4, 12, 12, 4, '#6b4c24');
  p.put(12, 2, tip[3]); p.put(13, 2, tip[2]); p.put(13, 3, tip[2]); p.put(12, 3, tip[3]); p.put(14, 1, tip[1]);
  for (const [x, y] of [[2, 12], [3, 13], [1, 11], [2, 14], [4, 14], [1, 13]]) p.put(x, y, '#e8e8e8');
  outline(p);
}
function egg(p, a, b) {
  blob(p, 8, 8.5, 4.4, 5.8, [shade(a, 0.7), shade(a, 0.85), a, shade(a, 1.15)], { rot: 0 });
  for (let k = 0; k < 7; k++) { const x = 5 + p.rand(7), y = 4 + p.rand(9); if (p.alpha(x, y)) { p.put(x, y, b); if (p.alpha(x + 1, y)) p.put(x + 1, y, b); } }
  outline(p);
}
function dye(p, c) {
  const pal = [shade(c, 0.6), shade(c, 0.8), c, shade(c, 1.2)];
  blob(p, 8, 9.5, 4.6, 4.2, pal);
  for (let x = 6; x < 10; x++) p.put(x, 4, pal[1]);
  p.put(7, 3, pal[2]); p.put(8, 3, pal[2]);
  outline(p);
}
function book(p) {
  mask(p, ['................', '................', '..###########...', '..#0000000000#..', '..#0111111110#..', '..#0111111110#..', '..#0111111110#..', '..#0111111110#..', '..#0111111110#..', '..#0111111110#..', '..#0111111110#..', '..#0000000000#..', '..wwwwwwwwwwww..', '...###########..', '................', '................'], ['#5a2a14', '#8a3f20', '#b0562c', '#d07040'], () => 0);
  outline(p);
}
function orb(p, pal, rim) { blob(p, 8, 8, 4.8, 4.8, pal); if (rim) { p.rect(6, 6, 4, 4, rim); p.rect(7, 7, 2, 2, '#000000'); } outline(p); }

const G = {
  stick: p => { line(p, 4, 12, 11, 5, (x, y, k) => HANDLE[k % 2 ? 1 : 2]); line(p, 5, 12, 12, 5, HANDLE[0]); outline(p); },
  coal: lump(['#111111', '#1f1f1f', '#303030', '#4a4a4a']), charcoal: lump(['#1a140e', '#2e241a', '#453628', '#5e4a38']),
  raw_iron: lump(['#6e5446', '#a68268', '#c8a488', '#e6c8ac'], ['#8a6a55']), raw_gold: lump(['#8a6a10', '#c89a20', '#e6c040', '#fff090']),
  raw_copper: lump(['#6e3418', '#a8552c', '#d07040', '#f0a070'], ['#5ea890']),
  iron_ingot: ingot(MAT.iron), gold_ingot: ingot(MAT.golden), copper_ingot: ingot(['#6e3418', '#b8613a', '#e0875a', '#f8b890']),
  netherite_ingot: ingot(MAT.netherite), netherite_scrap: lump(['#2a1f1c', '#4a3a33', '#66524a', '#8a7064']), brick: ingot(['#5a2016', '#8a3a28', '#b0543c', '#c87058']),
  nether_brick: ingot(['#1a0a0c', '#2c1418', '#44202a', '#5c2c36']),
  iron_nugget: nugget(MAT.iron), gold_nugget: nugget(MAT.golden),
  diamond: gem(MAT.diamond), emerald: gem(['#0a4a22', '#17a84a', '#3ad870', '#b8ffd0']), quartz: gem(['#8a8278', '#cfc8bb', '#ece6dc', '#ffffff']),
  amethyst_shard: gem(['#3a1f6a', '#6a3fb0', '#9a6ae0', '#e0c8ff']), prismarine_crystals: gem(['#3a6a5a', '#6ab8a0', '#a8f0d8', '#ffffff']),
  echo_shard: gem(['#051a22', '#0a3a4a', '#1f6a7a', '#4ab8c8']), prismarine_shard: lump(['#2a5a4a', '#4a8a7a', '#6ab29a', '#9ad8c0']),
  lapis_lazuli: lump(['#0f2a6a', '#1f4db8', '#3a6ae0', '#7aa0ff']), redstone: dust(['#5a0000', '#a00000', '#e01010', '#ff5a4a']),
  glowstone_dust: dust(['#8a6a2a', '#d0a040', '#f2d06a', '#fff4b0']), sugar: dust(['#c8c8c8', '#e0e0e0', '#f0f0f0', '#ffffff']),
  gunpowder: dust(['#2a2a2a', '#4a4a4a', '#6a6a6a', '#8a8a8a']), blaze_powder: dust(['#8a3a00', '#d86a10', '#f8a020', '#ffe070']),
  bone_meal: dust(['#b8b4a0', '#d8d4c0', '#ece8d8', '#ffffff']),
  flint: lump(['#1a1a1a', '#2e2e2e', '#454545', '#6a6a6a']), clay_ball: lump(['#6a7280', '#8a92a0', '#a4acb8', '#c0c8d2']),
  slime_ball: p => orb(p, ['#3a8a2a', '#5ab83a', '#7ad85a', '#b0f090']), ender_pearl: p => orb(p, ['#0a3a32', '#1a6a5a', '#2a9a82', '#6ad8b8']),
  ender_eye: p => orb(p, ['#0a3a32', '#1a6a5a', '#2a9a82', '#9ae8c0'], '#b8f070'), heart_of_the_sea: p => orb(p, ['#0a2a5a', '#1a5aa8', '#3a8ae0', '#9ad0ff']),
  magma_cream: p => { orb(p, ['#5a1a00', '#a83a10', '#e06a20', '#ffc040']); p.speck(['#ffe070'], 5); },
  ghast_tear: p => { blob(p, 8, 9.5, 3.2, 4, ['#8aa8b0', '#b8d0d8', '#e0f0f4', '#ffffff']); p.put(8, 4, '#e0f0f4'); outline(p); },
  string: p => { for (let k = 0; k < 3; k++) line(p, 2 + k * 2, 13 - k, 13 - k, 2 + k * 2, '#e8e8e8'); outline(p, '#6a6a6a'); },
  feather: p => { line(p, 3, 13, 12, 3, '#9a9a9a'); for (let k = 0; k < 8; k++) { line(p, 5 + k, 11 - k, 4 + k, 8 - k, '#f0f0f0'); line(p, 5 + k, 11 - k, 8 + k, 12 - k, '#dcdcdc'); } outline(p); },
  leather: food(['#4f2810', '#7e4220', '#a55f34', '#c47d4c'], { rx: 5.8, ry: 4.6, rot: 0.3 }),
  rabbit_hide: food(['#6a5238', '#8a6c4a', '#a88a64', '#c8aa80'], { rx: 5, ry: 4.2 }),
  rabbit_foot: food(['#6a5238', '#a88a64', '#c8aa80', '#e8d8c0'], { rx: 2.5, ry: 5, rot: 0.6 }),
  bone: p => { line(p, 4, 11, 11, 4, '#e8e4d0'); line(p, 5, 11, 11, 5, '#c8c4b0'); for (const [x, y] of [[3, 11], [4, 12], [3, 12], [11, 3], [12, 4], [12, 3]]) p.put(x, y, '#f4f0e0'); outline(p); },
  blaze_rod: p => { line(p, 4, 12, 11, 5, (x, y, k) => ['#f8d040', '#e8a020', '#ffe890'][k % 3]); line(p, 5, 12, 12, 5, '#c07010'); outline(p); },
  nether_wart: p => { blob(p, 8, 9, 4, 3.5, ['#4a0a10', '#7a141e', '#a82230', '#d03a48'], { rough: 0.3 }); outline(p); },
  paper: p => { p.rect(3, 2, 10, 12, '#f0f0e8'); for (let y = 4; y < 13; y += 2) p.hline(4, y, 8, '#d0d0c8'); outline(p); },
  book: book,
  wheat: p => { for (const [x, l] of [[5, 10], [8, 12], [11, 9]]) { line(p, x, 14, x + 1, 14 - l, '#b89b3a'); for (let k = 0; k < 4; k++) { p.put(x, 14 - l + k * 2, '#d8bd5a'); p.put(x + 2, 15 - l + k * 2, '#c8ad48'); } } outline(p); },
  wheat_seeds: p => { for (let k = 0; k < 7; k++) { const x = 4 + p.rand(8), y = 5 + p.rand(8); p.put(x, y, '#5a8a2a'); p.put(x, y + 1, '#3a6a1a'); } outline(p); },
  beetroot_seeds: p => { for (let k = 0; k < 7; k++) { const x = 4 + p.rand(8), y = 5 + p.rand(8); p.put(x, y, '#c8b890'); p.put(x, y + 1, '#8a7a58'); } outline(p); },
  pumpkin_seeds: p => { for (let k = 0; k < 6; k++) { const x = 4 + p.rand(8), y = 5 + p.rand(8); p.rect(x, y, 2, 1, '#e8dca8'); } outline(p); },
  melon_seeds: p => { for (let k = 0; k < 6; k++) { const x = 4 + p.rand(8), y = 5 + p.rand(8); p.rect(x, y, 2, 1, '#2a2418'); } outline(p, '#8a7a58'); },
  bowl: p => { mask(p, ['................', '................', '................', '................', '................', '................', '..############..', '..#2222222222#..', '...#11111111#...', '....#111111#....', '.....######.....', '................', '................', '................', '................', '................'], MAT.wood, () => 1); outline(p); },
  glass_bottle: p => { mask(p, ['................', '......####......', '......#..#......', '......#..#......', '.....#....#.....', '....#......#....', '...#........#...', '...#........#...', '...#........#...', '...#........#...', '....########....', '................', '................', '................', '................', '................'], ['#a8c8d8', '#a8c8d8', '#c8e0ec', '#e8f4fa'], () => 2); outline(p, '#4a6a7a'); },
  experience_bottle: p => { G.glass_bottle(p); blob(p, 8, 8.5, 3, 2.4, ['#3a8a1a', '#6ad82a', '#a8f060', '#e8ffa8']); },
  dragon_breath: p => { G.glass_bottle(p); blob(p, 8, 8.5, 3, 2.4, ['#6a2a6a', '#a84aa8', '#e07ae0', '#ffc0ff']); },
  honey_bottle: p => { G.glass_bottle(p); blob(p, 8, 8.5, 3, 2.4, ['#a8661a', '#e0961a', '#f8c040', '#fff0a0']); },
  ink_sac: p => { blob(p, 8, 9, 4.5, 4, ['#0a0a14', '#1a1a2a', '#2e2e44', '#4a4a66']); p.rect(7, 3, 2, 3, '#1a1a2a'); outline(p); },
  glow_ink_sac: p => { blob(p, 8, 9, 4.5, 4, ['#0a4a4a', '#1a8a8a', '#3ac8c0', '#9af0e8']); p.rect(7, 3, 2, 3, '#1a8a8a'); outline(p); },
  phantom_membrane: food(['#6a6a8a', '#9a9ab8', '#c8c8dc', '#ececf6'], { rx: 6, ry: 4, rot: 0.4 }),
  shulker_shell: food(['#4a2a5a', '#7a4a8a', '#a870b8', '#d0a0e0'], { rx: 5.5, ry: 4.5 }),
  nautilus_shell: p => { blob(p, 8, 8.5, 5.5, 5, ['#8a7a6a', '#c8b8a8', '#e8d8c8', '#fff8f0']); for (let t = 0; t < 10; t += 0.1) p.put(Math.round(8 + Math.cos(t) * t * 0.45), Math.round(8.5 + Math.sin(t) * t * 0.45), '#8a5a4a'); outline(p); },
  scute: food(['#1f4a1f', '#2f7a2f', '#47a347', '#6ac26a'], { rx: 5, ry: 3.5, rot: 0 }),
  honeycomb: p => { blob(p, 8, 8.5, 5.5, 5, ['#a8661a', '#e0961a', '#f8c040', '#fff0a0']); for (let y = 4; y < 13; y += 3) for (let x = 3 + (y % 2) * 2; x < 13; x += 4) p.put(x, y, '#a8661a'); outline(p); },
  nether_star: p => { const c = ['#c8c8a8', '#e8e8d0', '#ffffe8', '#ffffff']; for (let k = 0; k < 4; k++) { line(p, 8, 8, 8 + Math.round(Math.cos(k * Math.PI / 2) * 6), 8 + Math.round(Math.sin(k * Math.PI / 2) * 6), c[2]); } blob(p, 8, 8, 3, 3, c); outline(p); },
  disc_fragment: p => { blob(p, 8, 8, 5, 5, ['#1a1a1a', '#2a2a2a', '#3a3a3a', '#5a5a5a']); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x + y > 17) p.put(x, y, '#000', 0); outline(p); },
  totem_of_undying: p => { mask(p, ['................', '.....######.....', '....#333333#....', '....#3k33k3#....', '....#333333#....', '..###222222###..', '..#3322222233#..', '..###222222###..', '....#222222#....', '....#211112#....', '....#211112#....', '....#222222#....', '.....######.....', '................', '................', '................'], ['#6a5a10', '#b8a020', '#e8d040', '#fff8a0'], () => 0); outline(p); },
  name_tag: p => { mask(p, ['................', '................', '................', '.......##.......', '......#..#......', '.....#2222#.....', '....#222222#....', '...#22222222#...', '...#22222222#...', '...#22222222#...', '...#22222222#...', '...##########...', '................', '................', '................', '................'], ['#6a5238', '#a88a64', '#e8dcc0', '#ffffff'], () => 0); outline(p); },
  saddle: p => { blob(p, 8, 7, 6, 3.5, MAT.leather); line(p, 5, 9, 5, 14, '#3a3a3a'); line(p, 11, 9, 11, 14, '#3a3a3a'); p.put(5, 14, '#c8c8c8'); p.put(11, 14, '#c8c8c8'); outline(p); },
  lead: p => { for (let t = 0; t < 6.2; t += 0.1) p.put(Math.round(8 + Math.cos(t) * 5), Math.round(8 + Math.sin(t) * 4), '#a88a64'); line(p, 3, 11, 12, 3, '#8a6a4a'); outline(p); },
  compass: p => { orb(p, ['#4a4a4a', '#8a8a8a', '#b8b8b8', '#d8d8d8']); blob(p, 8, 8, 3.5, 3.5, ['#6a6a6a', '#8a8a8a', '#a0a0a0', '#b8b8b8']); line(p, 6, 10, 10, 6, '#d82a2a'); p.put(8, 8, '#3a3a3a'); },
  clock: p => { orb(p, ['#7a5a0c', '#d0a018', '#f4d443', '#fff8b0']); blob(p, 8, 8, 3.5, 3.5, ['#1a2a6a', '#2a4aa8', '#f8d860', '#ffffff']); line(p, 8, 8, 8, 5, '#3a3a3a'); },
  snowball: p => orb(p, ['#a8c0d0', '#d8e8f0', '#f0f8ff', '#ffffff']),
  fire_charge: p => { orb(p, ['#1a0a00', '#4a1a0a', '#8a3a10', '#c86a20']); p.speck(['#ffa020', '#ffe060'], 6); },
  egg: p => { blob(p, 8, 8.5, 4, 5.2, ['#b89a70', '#d8c098', '#ece0c0', '#fffaf0']); outline(p); },
  flint_and_steel: p => { line(p, 3, 5, 9, 11, MAT.iron[2]); line(p, 3, 6, 8, 11, MAT.iron[1]); line(p, 3, 5, 3, 9, MAT.iron[2]); blob(p, 11, 5, 2.8, 2.4, ['#1a1a1a', '#2e2e2e', '#454545', '#6a6a6a']); outline(p); },
  shears: shears,
  bucket: p => bucket(p, null), water_bucket: p => bucket(p, ['#2a5ad8', '#3a6ae8', '#4a7af0']), lava_bucket: p => bucket(p, ['#e0501a', '#f8a020', '#ff7010']),
  milk_bucket: p => bucket(p, ['#f4f4f4', '#ffffff', '#e8e8e8']),
  fishing_rod: p => { line(p, 2, 14, 12, 2, (x, y, k) => HANDLE[k % 2 + 1]); line(p, 12, 2, 13, 12, '#d8d8d8'); p.put(13, 13, '#b8b8b8'); outline(p); },
  bow: p => bow(p, 0), crossbow: p => { line(p, 3, 12, 12, 3, (x, y, k) => HANDLE[k % 2 + 1]); line(p, 2, 6, 9, 13, '#6b4c24'); line(p, 6, 2, 13, 9, '#6b4c24'); line(p, 2, 6, 6, 2, '#d8d8d8'); line(p, 9, 13, 13, 9, '#d8d8d8'); outline(p); },
  arrow: p => arrow(p), spectral_arrow: p => arrow(p, MAT.golden),
  shield: p => { mask(p, ['................', '..############..', '..#3322222211#..', '..#3322222211#..', '..#3322222211#..', '..#3322222211#..', '..#3322222211#..', '..#2222222211#..', '...#222222211#..', '...#22222221#...', '....#2222221#...', '.....#22221#....', '......####......', '................', '................', '................'], MAT.wood, () => 0); for (let y = 2; y < 11; y++) p.put(8, y, MAT.iron[2]); outline(p); },
  trident: p => { line(p, 2, 14, 10, 6, '#3a8a7a'); line(p, 3, 14, 11, 6, '#2a6a5a'); for (const [a, b] of [[10, 2], [14, 6], [13, 3]]) line(p, 11, 5, a, b, '#6ad8b8'); outline(p); },
  elytra: p => { blob(p, 5, 8, 3, 6, MAT.elytra, { rot: -0.2 }); blob(p, 11, 8, 3, 6, MAT.elytra, { rot: 0.2 }); outline(p); },
  // Food
  apple: p => { blob(p, 8, 9, 5, 4.6, ['#6a0a0a', '#b01818', '#e03030', '#ff7a6a']); p.put(8, 4, '#4a2a10'); p.put(9, 3, '#3a8a2a'); p.put(10, 3, '#4aa83a'); outline(p); },
  golden_apple: p => { blob(p, 8, 9, 5, 4.6, ['#8a6a10', '#d8a820', '#f6d84a', '#fff8b0']); p.put(8, 4, '#4a2a10'); p.put(9, 3, '#3a8a2a'); outline(p); },
  enchanted_golden_apple: p => { G.golden_apple(p); for (let k = 0; k < 6; k++) { const x = 4 + p.rand(8), y = 5 + p.rand(8); if (p.alpha(x, y)) p.put(x, y, '#ff80ff'); } },
  bread: food(['#6a3a10', '#a8661e', '#d09040', '#e8b870'], { rx: 6.5, ry: 3.4, rot: -0.6, deco: p => { for (let k = 0; k < 3; k++) p.put(6 + k * 2, 10 - k * 2, '#e8c890'); } }),
  porkchop: food(['#8a3a3a', '#d06a6a', '#f09a9a', '#ffc8c8'], { rx: 5.5, ry: 4 }), cooked_porkchop: food(['#5a2a10', '#9a5a2a', '#c8864a', '#e0aa70'], { rx: 5.5, ry: 4 }),
  beef: food(['#6a0a0a', '#b02a2a', '#d84a4a', '#f08a8a'], { rx: 5.5, ry: 4.2, deco: p => p.speck(['#f8e0e0'], 4) }), cooked_beef: food(['#3a1a0a', '#6a3a1a', '#8a5a2a', '#b07a4a'], { rx: 5.5, ry: 4.2 }),
  chicken: food(['#b08a7a', '#e0c0b0', '#f0d8cc', '#fff0e8'], { rx: 4.5, ry: 4.8, deco: p => { line(p, 11, 12, 13, 14, '#f4f0e0'); } }),
  cooked_chicken: food(['#6a3a10', '#a8661e', '#d09040', '#e8b870'], { rx: 4.5, ry: 4.8, deco: p => { line(p, 11, 12, 13, 14, '#f4f0e0'); } }),
  mutton: food(['#8a2a2a', '#c04a4a', '#e07a7a', '#f8b0b0'], { rx: 5, ry: 3.6 }), cooked_mutton: food(['#4a2210', '#7a4020', '#a86a3a', '#c89060'], { rx: 5, ry: 3.6 }),
  rabbit: food(['#b08a7a', '#d8a8a0', '#f0c8c0', '#fff0e8'], { rx: 4, ry: 4 }), cooked_rabbit: food(['#6a3a10', '#a8661e', '#d09040', '#e8b870'], { rx: 4, ry: 4 }),
  rabbit_stew: p => { G.bowl(p); blob(p, 8, 6.5, 5, 1.5, ['#6a3a10', '#a8661e', '#d09040', '#f08a19']); },
  mushroom_stew: p => { G.bowl(p); blob(p, 8, 6.5, 5, 1.5, ['#6a4a3a', '#9a7a5a', '#c8a888', '#e8d0b8']); },
  beetroot_soup: p => { G.bowl(p); blob(p, 8, 6.5, 5, 1.5, ['#5a0a1a', '#8e1a2e', '#b83040', '#d85a6a']); },
  cod: p => { blob(p, 7, 8, 5.5, 2.8, ['#6a5a40', '#a8906a', '#c8b08a', '#e0d0b0'], { rot: -0.4 }); line(p, 12, 4, 14, 3, '#a8906a'); line(p, 12, 5, 14, 6, '#a8906a'); p.put(4, 9, '#000000'); outline(p); },
  cooked_cod: p => { blob(p, 7, 8, 5.5, 2.8, ['#8a6a4a', '#c8a888', '#e0c8a8', '#f8e8d8'], { rot: -0.4 }); outline(p); },
  salmon: p => { blob(p, 7, 8, 5.5, 2.8, ['#6a1a1a', '#a83a3a', '#d06a5a', '#f09a8a'], { rot: -0.4 }); line(p, 12, 4, 14, 3, '#6a8a9a'); p.put(4, 9, '#000'); outline(p); },
  cooked_salmon: p => { blob(p, 7, 8, 5.5, 2.8, ['#8a3a1a', '#d06a3a', '#f09a5a', '#ffc890'], { rot: -0.4 }); outline(p); },
  tropical_fish: p => { blob(p, 7, 8, 5, 3.4, ['#a8501a', '#f07a2a', '#ffa050', '#ffffff'], { rot: -0.3 }); line(p, 6, 5, 8, 11, '#ffffff'); outline(p); },
  pufferfish: p => { orb(p, ['#8a7a1a', '#d8c030', '#f8e060', '#fff8b0']); for (let k = 0; k < 8; k++) p.put(4 + p.rand(9), 4 + p.rand(9), '#6a5a1a'); },
  carrot: p => { line(p, 3, 13, 10, 6, '#f08a19'); line(p, 4, 13, 11, 6, '#d06a10'); line(p, 4, 12, 10, 7, '#ffaa40'); for (const [x, y] of [[11, 4], [12, 3], [12, 5], [13, 4]]) p.put(x, y, '#3a8a2a'); outline(p); },
  golden_carrot: p => { line(p, 3, 13, 10, 6, '#f8c830'); line(p, 4, 13, 11, 6, '#d8a018'); line(p, 4, 12, 10, 7, '#fff080'); for (const [x, y] of [[11, 4], [12, 3], [12, 5]]) p.put(x, y, '#f8d860'); outline(p); },
  potato: food(['#8a6a2a', '#c9a55a', '#e0c07a', '#f0d8a0'], { rx: 5, ry: 3.8, deco: p => p.speck(['#8a6a2a'], 3) }),
  baked_potato: food(['#6a4a1a', '#a87a3a', '#d0a060', '#f0d8a0'], { rx: 5, ry: 3.8 }),
  poisonous_potato: food(['#6a7a2a', '#a0b04a', '#c0d06a', '#e0f0a0'], { rx: 5, ry: 3.8 }),
  beetroot: p => { blob(p, 8, 9.5, 4.2, 4.2, ['#4a0a1a', '#8e1a2e', '#b83040', '#d85a6a']); line(p, 8, 5, 7, 2, '#3a8a2a'); line(p, 9, 5, 11, 2, '#4aa83a'); outline(p); },
  melon_slice: p => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = Math.hypot(x - 8, y - 3); if (y > 3 && d < 11 && d > 0) p.put(x, y, d > 9.5 ? '#3a8a2a' : d > 8.5 ? '#c8e0a0' : '#e03030'); } p.speck(['#1a1a1a'], 4); outline(p); },
  sweet_berries: p => { for (const [x, y] of [[5, 9], [9, 10], [7, 6], [11, 7]]) blob(p, x, y, 2, 2, ['#5a0a1a', '#a8202a', '#d8404a', '#ff8080']); outline(p); },
  glow_berries: p => { for (const [x, y] of [[5, 9], [9, 10], [7, 6], [11, 7]]) blob(p, x, y, 2, 2, ['#a86a0a', '#f6a632', '#ffc75a', '#fff0b0']); outline(p); },
  cookie: p => { orb(p, ['#8a5a2a', '#c08a4a', '#d8a868', '#f0c890']); p.speck(['#3a1a0a'], 5); },
  pumpkin_pie: food(['#8a4a10', '#d08a30', '#f0b050', '#fff0c0'], { rx: 5.8, ry: 4, rot: 0 }),
  rotten_flesh: food(['#4a3a1a', '#7a6a3a', '#9a8a4a', '#6a8a3a'], { rx: 5.5, ry: 4, deco: p => p.speck(['#3a5a2a', '#8a3a2a'], 6) }),
  spider_eye: p => { orb(p, ['#4a0a1a', '#8a1a2a', '#c83a4a', '#f07a8a']); p.put(8, 8, '#1a0a0a'); },
  dried_kelp: food(['#1f2a14', '#2e3a1e', '#3e4a2a', '#56663a'], { rx: 5.5, ry: 3, rot: -0.7 }),
  chorus_fruit: p => { orb(p, ['#3a1f4a', '#6a4a7a', '#9a7aaa', '#c8a8d8']); p.speck(['#e0c8f0'], 4); },
};
// Materials by pattern.
const MAT_KEYS = Object.keys(MAT);

function drawItem(it, p) {
  if (G[it.key]) { G[it.key](p); return true; }
  if (it.tool && ['sword', 'pickaxe', 'axe', 'shovel', 'hoe'].includes(it.tool.type)) {
    const pal = MAT[it.material];
    ({ sword, pickaxe, axe, shovel, hoe })[it.tool.type](p, pal);
    return true;
  }
  if (it.armor && it.material in MAT && it.tex) { armor(p, it.tex, MAT[it.material], it.material); return true; }
  if (it.dye) { dye(p, DYE_COLORS[it.dye]); return true; }
  if (it.eggColors) { egg(p, it.eggColors[0], it.eggColors[1]); return true; }
  return false;
}
export const DYE_COLORS = {
  white: '#f0f0f0', orange: '#f08a19', magenta: '#c64fbd', light_blue: '#3ab3da', yellow: '#fed83d', lime: '#80c71f', pink: '#f38baa', gray: '#474f52',
  light_gray: '#9d9d97', cyan: '#169c9c', purple: '#8932b8', blue: '#3c44aa', brown: '#835432', green: '#5e7c16', red: '#b02e26', black: '#1d1d21',
};

// Effect sprites share the item texture array.
export const FX = ['smoke_0', 'smoke_1', 'smoke_2', 'flame', 'heart', 'crit', 'bubble', 'note', 'rain', 'snow', 'explosion_0', 'explosion_1', 'explosion_2', 'explosion_3',
  'xp_0', 'xp_1', 'portal', 'splash', 'angry', 'happy', 'soul', 'lava_drip', 'water_drip', 'bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2', 'crossbow_loaded', 'blank', 'spark', 'ash', 'end_rod', 'white', 'glint'];
function drawFx(name, p) {
  switch (name) {
    case 'smoke_0': case 'smoke_1': case 'smoke_2': { const r = 2 + Number(name.slice(-1)) * 1.4; blob(p, 8, 8, r, r, ['#3a3a3a', '#5a5a5a', '#7a7a7a', '#9a9a9a'], { rough: 0.2 }); break; }
    case 'flame': mask(p, ['................', '................', '................', '.......#........', '......##........', '......###.......', '.....####.......', '.....#####......', '....######......', '....##33##......', '....#3333#......', '....#3333#......', '.....#33#.......', '................', '................', '................'], ['#c83a0a', '#f8801a', '#ffc040', '#fff4b0'], (x, y) => y < 9 ? 1 : 2); break;
    case 'heart': mask(p, ['................', '................', '................', '...##...##......', '..####.####.....', '..#########.....', '..#########.....', '...#######......', '....#####.......', '.....###........', '......#.........', '................', '................', '................', '................', '................'], ['#6a0a0a', '#d01a1a', '#ff4a4a', '#ff9a9a'], (x, y) => (x < 5 && y < 6 ? 3 : 2)); outline(p, '#2a0000'); break;
    case 'crit': for (let k = 0; k < 4; k++) { p.put(8, 8 - k, '#ffffff'); p.put(8, 8 + k, '#ffffff'); p.put(8 - k, 8, '#ffffff'); p.put(8 + k, 8, '#ffffff'); } break;
    case 'bubble': for (let t = 0; t < 6.3; t += 0.2) p.put(Math.round(8 + Math.cos(t) * 3), Math.round(8 + Math.sin(t) * 3), '#c8e8ff'); p.put(7, 7, '#ffffff'); break;
    case 'note': mask(p, ['................', '................', '.........##.....', '.........#.#....', '.........#..#...', '.........#......', '.........#......', '.........#......', '......####......', '.....#####......', '.....####.......', '................', '................', '................', '................', '................'], ['#2a2a2a', '#5a5a5a', '#ffffff', '#ffffff'], () => 2); break;
    case 'rain': p.rect(7, 2, 1, 12, '#8ab4ff', 200); p.rect(8, 5, 1, 8, '#6a94e8', 160); break;
    case 'snow': p.rect(7, 7, 2, 2, '#ffffff'); p.put(6, 8, '#e8f0ff'); p.put(9, 7, '#e8f0ff'); break;
    case 'explosion_0': case 'explosion_1': case 'explosion_2': case 'explosion_3': { const k = Number(name.slice(-1)); blob(p, 8, 8, 7 - k * 0.6, 7 - k * 0.6, k < 2 ? ['#8a8a8a', '#c8c8c8', '#f0f0f0', '#ffffff'] : ['#5a5a5a', '#7a7a7a', '#9a9a9a', '#bbbbbb'], { rough: 0.35 }); break; }
    case 'xp_0': case 'xp_1': blob(p, 8, 8, 3.2, 3.2, name === 'xp_0' ? ['#3a8a1a', '#6ad82a', '#c8ff6a', '#ffffc8'] : ['#6a8a1a', '#b8e82a', '#f0ff6a', '#ffffff']); outline(p, '#1a3a0a'); break;
    case 'portal': blob(p, 8, 8, 2.5, 2.5, ['#4a0a8a', '#8a2ad8', '#c870ff', '#f0c8ff']); break;
    case 'splash': p.rect(7, 7, 2, 2, '#8ab4ff'); p.put(6, 6, '#c8e0ff'); break;
    case 'angry': mask(p, ['................', '................', '................', '...##.....##....', '....##...##.....', '.....##.##......', '................', '.....##.##......', '....##...##.....', '...##.....##....', '................', '................', '................', '................', '................', '................'], ['#6a0a0a', '#d02a2a', '#ff4a4a', '#ff8a8a'], () => 2); break;
    case 'happy': mask(p, ['................', '.......#........', '......###.......', '.......#........', '....#.....#.....', '...###...###....', '....#.....#.....', '................', '.......#........', '......###.......', '.......#........', '................', '................', '................', '................', '................'], ['#1a6a1a', '#3ac83a', '#8aff8a', '#ffffff'], () => 2); break;
    case 'soul': blob(p, 8, 8, 3, 4, ['#1a5a6a', '#3aa8c0', '#7ae8f8', '#e0ffff']); break;
    case 'lava_drip': p.rect(7, 6, 2, 4, '#f8801a'); p.put(7, 10, '#ffc040'); break;
    case 'water_drip': p.rect(7, 6, 2, 4, '#3a6ae8'); p.put(7, 10, '#8ab4ff'); break;
    case 'bow_pulling_0': bow(p, 1); break;
    case 'bow_pulling_1': bow(p, 2); break;
    case 'bow_pulling_2': bow(p, 3); break;
    case 'crossbow_loaded': G.crossbow(p); line(p, 5, 10, 11, 4, '#8e6a38'); break;
    case 'spark': p.put(8, 8, '#ffffff'); p.put(7, 8, '#ffe8a0'); p.put(9, 8, '#ffe8a0'); p.put(8, 7, '#ffe8a0'); p.put(8, 9, '#ffe8a0'); break;
    case 'ash': p.rect(7, 7, 2, 2, '#3a3a3a'); break;
    case 'end_rod': p.rect(7, 7, 2, 2, '#ffffff'); p.put(6, 7, '#e8e0ff'); p.put(9, 8, '#e8e0ff'); break;
    case 'white': p.fill('#ffffff'); break;
    case 'glint': blob(p, 8, 8, 6, 6, ['#6a2a8a', '#9a4ac8', '#c87aff', '#f0c8ff']); break;
    default: break;
  }
}

// ---------- layer table ----------
// Item key -> layer; FX name -> layer. Flat block items copy their block texture.
export const ITEM_LAYER = {};
export const FX_LAYER = {};
const flatTexFor = it => {
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
    if (it.block) {
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

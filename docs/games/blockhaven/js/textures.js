// Every texture is 16x16 pixel art generated here.
import { TEXTURES, BLOCKS, R_CROSS, R_TORCH } from './blocks.js';
import { mulberry32 } from './noise.js';

const N = 16;
const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

class Tex {
  constructor(seed) {
    this.d = new Uint8ClampedArray(N * N * 4);
    this.r = mulberry32(seed * 7919 + 17);
  }
  rand(n) { return Math.floor(this.r() * n); }
  pick(arr) { return arr[this.rand(arr.length)]; }
  set(x, y, c, a = 255) {
    x = ((x % N) + N) % N; y = ((y % N) + N) % N;
    const i = (y * N + x) * 4, v = typeof c === 'string' ? rgb(c) : c;
    this.d[i] = v[0]; this.d[i + 1] = v[1]; this.d[i + 2] = v[2]; this.d[i + 3] = a;
  }
  get(x, y) {
    x = ((x % N) + N) % N; y = ((y % N) + N) % N;
    const i = (y * N + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  alpha(x, y) { return this.d[(y * N + x) * 4 + 3]; }
  shade(x, y, f) {
    const c = this.get(x, y);
    this.set(x, y, [c[0] * f, c[1] * f, c[2] * f], c[3]);
  }
  jitter(c, amt) {
    const v = typeof c === 'string' ? rgb(c) : c, j = (this.r() * 2 - 1) * amt;
    return [v[0] + j, v[1] + j, v[2] + j];
  }
  noise(palette, jit = 6) {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) this.set(x, y, this.jitter(this.pick(palette), jit));
  }
  // Tileable value noise in [0,1].
  valueNoise(cells) {
    const g = [];
    for (let i = 0; i < cells * cells; i++) g.push(this.r());
    const at = (x, y) => g[((y % cells + cells) % cells) * cells + ((x % cells + cells) % cells)];
    return (x, y) => {
      const fx = x / N * cells, fy = y / N * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  }
  // Transparent pixels take their neighbours' colour so mipmaps don't pick up dark fringes.
  bleed() {
    let sum = [0, 0, 0], n = 0;
    for (let i = 0; i < N * N; i++) if (this.d[i * 4 + 3] > 0) { sum[0] += this.d[i * 4]; sum[1] += this.d[i * 4 + 1]; sum[2] += this.d[i * 4 + 2]; n++; }
    if (!n) return;
    for (let i = 0; i < N * N; i++) if (this.d[i * 4 + 3] === 0) { this.d[i * 4] = sum[0] / n; this.d[i * 4 + 1] = sum[1] / n; this.d[i * 4 + 2] = sum[2] / n; }
  }
}

const P = {
  dirt: ['#866043', '#79553a', '#96704d', '#6c4b33', '#8b6446'],
  grass: ['#5fa53b', '#6db446', '#559a34', '#7cc152', '#4d8f2f', '#67ad40'],
  snow: ['#f4f8fb', '#e8eef4', '#ffffff', '#dde6ee'],
  stone: ['#7f7f7f', '#878787', '#747474', '#8e8e8e', '#7a7a7a'],
  sand: ['#dbd3a0', '#e3dbad', '#d2c994', '#ece4b8', '#d8cf98'],
};

function stoneBase(t) {
  t.noise(P.stone, 5);
  for (let k = 0; k < 5; k++) {
    const y = t.rand(N), x = t.rand(N), len = 2 + t.rand(3);
    for (let i = 0; i < len; i++) t.set(x + i, y, t.jitter('#6a6a6a', 4));
  }
}

function voronoi(t, count) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([t.r() * N, t.r() * N, i]);
  return (x, y) => {
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (const [px, py, i] of pts) {
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const dx = x + 0.5 - (px + ox * N), dy = y + 0.5 - (py + oy * N), d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
    }
    return { id, edge: d2 - d1 };
  };
}

function cobble(t) {
  const v = voronoi(t, 9);
  const shades = ['#8a8a8a', '#9a9a9a', '#7c7c7c', '#a3a3a3', '#737373', '#909090', '#858585', '#999999', '#7f7f7f'];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const { id, edge } = v(x, y);
    if (edge < 1.1) t.set(x, y, t.jitter(edge < 0.55 ? '#4a4a4a' : '#5e5e5e', 4));
    else t.set(x, y, t.jitter(shades[id], 7));
  }
}

function rings(t, colors, bark) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (r > 6.6) t.set(x, y, t.jitter(t.pick(bark), 6));
    else t.set(x, y, t.jitter(colors[Math.floor(r) % colors.length], 6));
  }
}

function bark(t, palette, streak) {
  const cols = [];
  for (let x = 0; x < N; x++) cols.push(t.pick(palette));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.set(x, y, t.jitter(t.r() < 0.8 ? cols[x] : t.pick(palette), 6));
  for (let k = 0; k < 5; k++) {
    const x = t.rand(N), y = t.rand(N), len = 3 + t.rand(5);
    for (let i = 0; i < len; i++) t.set(x, y + i, t.jitter(streak, 4));
  }
}

function leaves(t, palette) {
  const vn = t.valueNoise(4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (t.r() < 0.2) { t.set(x, y, [0, 0, 0], 0); continue; }
    const c = t.jitter(t.pick(palette), 8);
    const f = 0.8 + vn(x, y) * 0.35;
    t.set(x, y, [c[0] * f, c[1] * f, c[2] * f]);
  }
  t.bleed();
}

function ore(t, colors) {
  stoneBase(t);
  for (let k = 0; k < 4; k++) {
    const cx = 2 + t.rand(12), cy = 2 + t.rand(12);
    const shape = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 1], [1, 2]].slice(0, 4 + t.rand(4));
    for (const [dx, dy] of shape) t.set(cx + dx, cy + dy, t.jitter(t.pick(colors), 8));
    t.set(cx - 1, cy + 1, '#5a5a5a');
  }
}

function wool(t, base) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = t.jitter(base, 7);
    const f = (x + y) % 4 === 0 ? 0.9 : (x - y + 16) % 4 === 0 ? 1.05 : 1;
    t.set(x, y, [c[0] * f, c[1] * f, c[2] * f]);
  }
}

function flower(t, petals, center, headY, radius) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.set(x, y, [0, 0, 0], 0);
  for (let y = headY + 1; y < N; y++) t.set(7 + (y > 12 ? 1 : 0), y, t.jitter('#3f7f2a', 8));
  t.set(5, 11, '#4a8f32'); t.set(6, 11, '#3f7f2a'); t.set(9, 12, '#4a8f32'); t.set(10, 12, '#3f7f2a');
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = x - 7.5, dy = y - headY;
    if (dx * dx + dy * dy < radius * radius) t.set(x, y, t.jitter(t.pick(petals), 10));
  }
  t.set(7, Math.round(headY), center); t.set(8, Math.round(headY), center);
  t.bleed();
}

function crackPixels() {
  const t = new Tex(999);
  const pts = [];
  const walk = (x, y, dir, len) => {
    for (let i = 0; i < len; i++) {
      pts.push([x & 15, y & 15]);
      if (t.r() < 0.35) dir = (dir + (t.r() < 0.5 ? 1 : 3)) % 4;
      x += [1, 0, -1, 0][dir]; y += [0, 1, 0, -1][dir];
      if (t.r() < 0.08) walk(x, y, (dir + 1) % 4, 3 + t.rand(4));
    }
  };
  for (let k = 0; k < 7; k++) walk(5 + t.rand(6), 5 + t.rand(6), t.rand(4), 9);
  return pts;
}
const CRACKS = crackPixels();

const GEN = {
  dirt: t => { t.noise(P.dirt, 6); for (let k = 0; k < 6; k++) t.set(t.rand(N), t.rand(N), '#5c3f2a'); },
  grass_top: t => { const vn = t.valueNoise(4); t.noise(P.grass, 6); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.shade(x, y, 0.88 + vn(x, y) * 0.22); },
  grass_side: t => {
    GEN.dirt(t);
    for (let x = 0; x < N; x++) {
      const d = 3 + (t.r() < 0.5 ? 1 : 0) + (t.r() < 0.25 ? 1 : 0);
      for (let y = 0; y < d; y++) t.set(x, y, t.jitter(y === d - 1 ? '#4a8a2e' : t.pick(P.grass), 6));
    }
  },
  grass_snowed: t => {
    GEN.dirt(t);
    for (let x = 0; x < N; x++) {
      const d = 3 + (t.r() < 0.5 ? 1 : 0) + (t.r() < 0.3 ? 1 : 0);
      for (let y = 0; y < d; y++) t.set(x, y, t.jitter(y === d - 1 ? '#cfd8e0' : t.pick(P.snow), 4));
    }
  },
  snow: t => t.noise(P.snow, 3),
  stone: stoneBase,
  cobblestone: cobble,
  mossy_cobblestone: t => {
    cobble(t);
    const vn = t.valueNoise(4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (vn(x, y) > 0.58) t.set(x, y, t.jitter(t.pick(['#5a7a3a', '#4a6a2e', '#6b8a45', '#557536']), 8));
  },
  sand: t => t.noise(P.sand, 5),
  gravel: t => {
    t.noise(['#8a8583', '#7a7472', '#948e8b', '#6f6a68'], 6);
    for (let k = 0; k < 14; k++) {
      const x = t.rand(N), y = t.rand(N), c = t.pick(['#a8a09a', '#5f5a58', '#9d9896', '#6b6360', '#b3aca6']);
      t.set(x, y, c); t.set(x + 1, y, c); t.set(x, y + 1, t.jitter(c, 10));
    }
  },
  bedrock: t => t.noise(['#575757', '#333333', '#7a7a7a', '#1f1f1f', '#4a4a4a', '#666666'], 10),
  log_oak: t => bark(t, ['#6b5132', '#5c4429', '#735736', '#664c2e'], '#4a3622'),
  log_oak_top: t => rings(t, ['#c3a06b', '#b18d5a', '#bd9964', '#a88353'], ['#6b5132', '#5c4429']),
  log_birch: t => {
    t.noise(['#d8d6cc', '#e6e4dc', '#cfccc1', '#dedbd0'], 4);
    for (let k = 0; k < 7; k++) {
      const x = t.rand(N), y = t.rand(N), len = 2 + t.rand(4);
      for (let i = 0; i < len; i++) t.set(x + i, y, i === 0 || i === len - 1 ? '#55524a' : '#2a2a27');
    }
  },
  log_birch_top: t => rings(t, ['#dcc58b', '#cbb276', '#d6bf82'], ['#dedbd0', '#cfccc1']),
  log_spruce: t => bark(t, ['#3d2b1b', '#4a3522', '#43301e', '#3a2918'], '#2a1e12'),
  log_spruce_top: t => rings(t, ['#8a6a45', '#7a5c3a', '#846440'], ['#3d2b1b', '#4a3522']),
  leaves_oak: t => leaves(t, ['#3f7a26', '#4a8a2e', '#356b20', '#57993a', '#2e5f1c']),
  leaves_birch: t => leaves(t, ['#6a9a3c', '#7aad46', '#5c8a33', '#86b852']),
  leaves_spruce: t => leaves(t, ['#2f5d3a', '#39694a', '#264f31', '#437553']),
  planks_oak: t => {
    const shades = ['#a4834f', '#9c7a49', '#b08d58', '#967447'];
    for (let y = 0; y < N; y++) {
      const plank = y >> 2, base = shades[plank];
      for (let x = 0; x < N; x++) {
        let c = t.jitter(base, 5);
        if (y % 4 === 3) c = t.jitter('#6e5433', 4);
        else if (x === (plank * 5 + 3) % 16) c = t.jitter('#7a5d38', 4);
        else if (t.r() < 0.1) c = t.jitter('#8e6d40', 4);
        t.set(x, y, c);
      }
    }
  },
  bookshelf: t => {
    GEN.planks_oak(t);
    const books = ['#8f2f2f', '#2f4f8f', '#3f7f3f', '#8f7f2f', '#6f3f7f', '#2f6f6f', '#b0b0b0', '#a0522d'];
    for (const [y0, y1] of [[2, 6], [9, 13]]) {
      let x = 1;
      while (x < 15) {
        const w = 1 + t.rand(2), c = t.pick(books), gap = t.r() < 0.15;
        for (let dx = 0; dx < w && x + dx < 15; dx++) {
          for (let y = y0; y <= y1; y++) {
            const top = y0 + (t.r() < 0.3 ? 1 : 0);
            if (gap || y < top) t.set(x + dx, y, '#2a1f14');
            else t.set(x + dx, y, t.jitter(y === top ? '#e0d6c0' : c, 8));
          }
        }
        x += w;
      }
    }
  },
  glass: t => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      if (edge) t.set(x, y, (x + y) % 5 === 0 ? '#b8d4de' : '#dbeef5');
      else t.set(x, y, '#dbeef5', 0);
    }
    for (let i = 0; i < 4; i++) { t.set(3 + i, 6 - i, '#f2fbff'); t.set(9 + i, 12 - i, '#f2fbff'); }
    t.set(5, 5, '#f2fbff'); t.set(12, 9, '#f2fbff');
  },
  water: t => { const vn = t.valueNoise(4); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = t.jitter('#2f63d6', 6); const f = 0.85 + vn(x, y) * 0.3; t.set(x, y, [c[0] * f, c[1] * f, c[2] * f]); } },
  ice: t => {
    t.noise(['#a8c8f8', '#9dbff4', '#b5d2fb', '#a2c3f6'], 4);
    for (let k = 0; k < 3; k++) { const x = t.rand(N), y = t.rand(N); for (let i = 0; i < 5; i++) t.set(x + i, y - i, '#e3f0ff'); }
  },
  sandstone: t => {
    t.noise(['#d8cc96', '#dcd19c', '#d3c68e'], 4);
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < 3; y++) t.set(x, y, t.jitter('#e5dba8', 4));
      t.set(x, 3, t.jitter('#c9bb82', 3));
      t.set(x, 11, t.jitter('#c9bb82', 3));
      t.set(x, 14, t.jitter('#c2b37a', 3));
    }
  },
  sandstone_top: t => t.noise(['#e0d6a3', '#d8cc96', '#e6dcab', '#d2c68f'], 4),
  cactus_side: t => {
    t.noise(['#3f7f2e', '#4a8f37', '#428631'], 5);
    for (let y = 0; y < N; y++) {
      for (const x of [2, 7, 12]) t.set(x, y, t.jitter('#2c5e20', 4));
      t.set(0, y, '#23501a'); t.set(15, y, '#23501a');
    }
    for (let k = 0; k < 10; k++) { const x = t.pick([1, 3, 6, 8, 11, 13]), y = t.rand(N); t.set(x, y, t.r() < 0.5 ? '#d9e6b0' : '#1f4a17'); }
  },
  cactus_top: t => { rings(t, ['#5aa545', '#4f9a3c', '#58a142'], ['#3f7f2e', '#2c5e20']); for (let k = 0; k < 6; k++) t.set(4 + t.rand(8), 4 + t.rand(8), '#d9e6b0'); },
  coal_ore: t => ore(t, ['#2b2b2b', '#1c1c1c', '#3a3a3a', '#262626']),
  iron_ore: t => ore(t, ['#d8af93', '#c49a7c', '#e6c4a8', '#b88a6c']),
  gold_ore: t => ore(t, ['#fcee4b', '#e0c52a', '#fff7a0', '#d9b420']),
  diamond_ore: t => ore(t, ['#5decf5', '#3dcbd6', '#a6fbff', '#2fb3bd']),
  bricks: t => {
    const colors = ['#96463a', '#a4503f', '#8a3f33', '#b05a47', '#9b4a3c'];
    for (let y = 0; y < N; y++) {
      const row = y >> 2;
      const seams = row % 2 ? [3, 11] : [7, 15];
      const brickColor = [t.pick(colors), t.pick(colors), t.pick(colors)];
      for (let x = 0; x < N; x++) {
        if (y % 4 === 3 || seams.includes(x)) t.set(x, y, t.jitter('#b5a79a', 6));
        else t.set(x, y, t.jitter(brickColor[x < seams[0] ? 0 : x < seams[1] ? 1 : 2], 8));
      }
    }
  },
  stone_bricks: t => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const top = y < 8, seams = top ? [7, 15] : [3, 11];
      const ly = y % 8;
      let c;
      if (ly === 7 || seams.includes(x)) c = '#4e4e4e';
      else if (ly === 0 || seams.map(s => (s + 1) % 16).includes(x)) c = '#8f8f8f';
      else if (ly === 6 || seams.map(s => (s + 15) % 16).includes(x)) c = '#646464';
      else c = t.pick(['#7a7a7a', '#7f7f7f', '#767676']);
      t.set(x, y, t.jitter(c, 4));
    }
  },
  glowstone: t => {
    const vn = t.valueNoise(5);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = vn(x, y) + t.r() * 0.25;
      t.set(x, y, t.jitter(v > 0.95 ? '#fff4c2' : v > 0.75 ? '#ffe28a' : v > 0.55 ? '#f6c55a' : v > 0.35 ? '#d99a3f' : '#9a6a2a', 6));
    }
  },
  torch: t => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (y < 2) t.set(x, y, '#fff3a0'); else if (y < 4) t.set(x, y, '#ffcf40'); else if (y < 5) t.set(x, y, '#ff9f2a');
      else t.set(x, y, t.jitter(y < 10 ? '#7a5a33' : '#654a2a', 5));
    }
  },
  torch_top: t => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.set(x, y, Math.abs(x - 7.5) + Math.abs(y - 7.5) < 6 ? '#fff6b8' : '#ffd24a'); },
  tall_grass: t => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.set(x, y, [0, 0, 0], 0);
    for (let b = 0; b < 8; b++) {
      let x = 1 + t.rand(14);
      const h = 6 + t.rand(9), lean = t.r() < 0.5 ? -1 : 1;
      for (let i = 0; i < h; i++) {
        const y = 15 - i;
        if (i > h * 0.6 && t.r() < 0.4) x += lean;
        t.set(x, y, t.jitter(i > h - 3 ? '#86c95a' : t.pick(['#5fa53b', '#4f9331', '#6bb044']), 8));
      }
    }
    t.bleed();
  },
  poppy: t => flower(t, ['#d8322a', '#b3241e', '#f04a3a'], '#3a1a10', 5, 2.9),
  dandelion: t => flower(t, ['#f7d51d', '#e6b90f', '#fff06a'], '#c99a0a', 7, 2.2),
  blue_orchid: t => flower(t, ['#3aa0e8', '#2a7fcc', '#7fcaf7'], '#1c5a99', 5, 2.9),
  dead_bush: t => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.set(x, y, [0, 0, 0], 0);
    const branch = (x, y, dx, len) => {
      for (let i = 0; i < len; i++) {
        t.set(x, y, t.jitter(t.pick(['#8a6a3a', '#6e5230', '#7d5e34']), 6));
        y--; if (i % 2) x += dx;
        if (t.r() < 0.2 && len > 3) branch(x, y, -dx, len - i - 2);
      }
    };
    branch(7, 15, -1, 9); branch(8, 15, 1, 10); branch(8, 12, 1, 5);
    t.bleed();
  },
  pumpkin_side: t => {
    t.noise(['#e38a1d', '#d67b12', '#ef9a2c', '#dd8418'], 5);
    for (let y = 0; y < N; y++) for (const x of [0, 4, 8, 12]) t.set(x, y, t.jitter('#b8640f', 5));
  },
  pumpkin_top: t => {
    t.noise(['#e38a1d', '#d67b12', '#ef9a2c'], 5);
    for (let i = 0; i < N; i++) { t.set(i, 7, '#c56f12'); t.set(7, i, '#c56f12'); }
    for (const [x, y] of [[7, 7], [8, 7], [7, 8], [8, 8], [8, 6]]) t.set(x, y, t.pick(['#5a7a2a', '#4a6a20']));
  },
  wool_white: t => wool(t, '#e9ecec'),
  wool_red: t => wool(t, '#a12722'),
  wool_blue: t => wool(t, '#35399d'),
  wool_yellow: t => wool(t, '#f9c627'),
  lava: t => {
    const vn = t.valueNoise(4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const v = vn(x, y);
      t.set(x, y, t.jitter(v > 0.75 ? '#ffb029' : v > 0.55 ? '#f28a1c' : v > 0.35 ? '#e65c12' : '#c0310a', 8));
    }
  },
  obsidian: t => {
    t.noise(['#140f1f', '#1c1530', '#0d0a14', '#181226'], 4);
    for (let k = 0; k < 10; k++) t.set(t.rand(N), t.rand(N), t.pick(['#3b2a63', '#2e2150', '#4a3a78']));
  },
};

export function generateTextures() {
  const layers = TEXTURES.map((name, i) => {
    const t = new Tex(i + 1);
    const m = name.match(/^destroy_(\d)$/);
    if (m) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) t.set(x, y, [0, 0, 0], 0);
      const count = Math.floor(CRACKS.length * (Number(m[1]) + 1) / 10);
      for (let k = 0; k < count; k++) t.set(CRACKS[k][0], CRACKS[k][1], [20, 20, 20], 200);
    } else {
      GEN[name](t);
    }
    return t.d;
  });
  return layers;
}

function tileCanvas(data) {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), N, N), 0, 0);
  return c;
}

// Renders an isometric icon for each inventory block; returns id -> data URL.
export function makeIcons(layers, size = 64) {
  const tiles = layers.map(tileCanvas);
  const index = name => TEXTURES.indexOf(name);
  const icons = {};
  for (const b of BLOCKS) {
    if (!b || !b.inventory) continue;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const k = size / 48;
    if (b.render === R_CROSS) {
      g.drawImage(tiles[index(b.tex.side)], 8 * k, 8 * k, 32 * k, 32 * k);
    } else if (b.render === R_TORCH) {
      g.drawImage(tiles[index(b.tex.side)], 0, 0, 16, 16, 21 * k, 8 * k, 6 * k, 32 * k);
    } else {
      const faces = [
        [tiles[index(b.tex.top)], [1.25 * k, -0.625 * k, 1.25 * k, 0.625 * k, 4 * k, 14 * k], 1.0],
        [tiles[index(b.tex.side)], [1.25 * k, 0.625 * k, 0, 1.25 * k, 4 * k, 14 * k], 0.78],
        [tiles[index(b.tex.side)], [1.25 * k, -0.625 * k, 0, 1.25 * k, 24 * k, 24 * k], 0.6],
      ];
      for (const [tile, m, shade] of faces) {
        g.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        g.drawImage(tile, 0, 0);
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = `rgba(0,0,0,${1 - shade})`;
        g.fillRect(0, 0, N, N);
        g.globalCompositeOperation = 'source-over';
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
    icons[b.id] = c.toDataURL();
  }
  return icons;
}

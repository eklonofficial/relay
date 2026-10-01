// Far view (like the Voxy mod): the land past the loaded chunks, drawn as tiles of 16x16 cells.
// Each cell is one column of the world generator's surface drawn as a box, with its trees, water
// and snow, coloured from the block textures. Tiles further out use coarser cells (4 blocks per cell
// close in, up to 32 at the horizon), so every tile costs the same and covers the same screen size.
import { B, TINT_OF, FACE_TEX, VARIANT_MASK } from '../data/blocks.js?v=muprr3ie';
import { BIOME_COLORS } from '../gen/biomes.js?v=muprr3ie';

export const LOD_CELLS = 16, LOD_LEVELS = 4;
export const lodStep = level => 4 << level;                // blocks per cell: 4, 8, 16, 32
export const lodSize = level => LOD_CELLS * lodStep(level); // blocks per tile: 64 ... 512
// Vertex: u8 x and z (cell corners, 0-16), i16 y (eighths of a block), rgba8 colour (shading baked in).
export const LOD_STRIDE = 8;
// The terrain shader's face shading: +X -X +Y -Y +Z -Z.
const SHADE = [0.8, 0.8, 1.0, 0.55, 0.68, 0.68];

// Per texture layer, the average colour of its tinted pixels and of the rest (6 bytes), counted over
// the pixels the terrain shader keeps (alpha >= 0.5). Tinted pixels are marked by alpha below 1.
export function layerColors(layers) {
  const out = new Uint8Array(layers.length * 6);
  layers.forEach((d, l) => {
    const sum = [0, 0, 0, 0, 0, 0];
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      if (a < 128) continue;
      const k = a < 255 ? 3 : 0;
      sum[k] += d[i]; sum[k + 1] += d[i + 1]; sum[k + 2] += d[i + 2];
      n++;
    }
    if (n) for (let k = 0; k < 6; k++) out[l * 6 + k] = Math.round(sum[k] / n);
  });
  return out;
}

// One face of one block state as it looks in a biome (rgb 0-255), like the mesher's texture * tint.
function faceColor(colors, id, meta, face, biome, out, o) {
  const layer = FACE_TEX[(((id << 4) | (meta & VARIANT_MASK[id])) * 7) + face], c = layer * 6, t = TINT_OF[id];
  for (let k = 0; k < 3; k++) {
    const tint = t ? BIOME_COLORS[biome * 9 + (t - 1) * 3 + k] : 255;
    out[o + k] = Math.min(255, colors[c + k] + colors[c + 3 + k] * tint / 255);
  }
}

const TOP = 2, SIDE = 4;
// Builds one tile: level 0-3, tile coordinates (tx, tz) in units of lodSize(level). `terrain` is the
// overworld generator (surfaceY + lodColumn); `colors` comes from layerColors.
export function buildLodTile(terrain, colors, level, tx, tz) {
  const step = lodStep(level), N = LOD_CELLS, W = N + 2, x0 = tx * lodSize(level), z0 = tz * lodSize(level);
  // Surface heights for the tile plus a ring of its neighbours' cells, so edges know what is next door.
  const ys = new Int16Array(W * W);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) ys[i + j * W] = terrain.surfaceY(x0 + (i - 1) * step, z0 + (j - 1) * step);
  // Per cell: top height and where its walls change colour (eighths of a block), and the colours of
  // its top, the upper part of its walls and the lower part.
  const H = new Int16Array(W * W), S = new Int16Array(W * W), C = new Uint8Array(W * W * 9);
  const tmp = new Uint8Array(3);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const c = i + j * W, y = ys[c];
    const at = (a, b) => ys[Math.max(0, Math.min(W - 1, a)) + Math.max(0, Math.min(W - 1, b)) * W];
    // The generator's slope is the rise across two blocks; here neighbours are 2 * step apart.
    const slope = Math.round(Math.max(Math.abs(at(i + 1, j) - at(i - 1, j)), Math.abs(at(i, j + 1) - at(i, j - 1))) / step);
    const col = terrain.lodColumn(x0 + (i - 1) * step, z0 + (j - 1) * step, y, slope, step);
    const ground = (y + 1) * 8, o = c * 9;
    faceColor(colors, col.fill[0], col.fill[1], SIDE, col.biome, C, o + 6);
    if (col.water) {
      // Water drawn 7/8 high, its colour deepening over deeper water as the floor fades from view.
      const frozen = col.snow, h = (col.water + 1) * 8 - 1;
      faceColor(colors, frozen ? B.ICE : B.WATER, 0, TOP, col.biome, C, o);
      if (!frozen) {
        faceColor(colors, col.top[0], col.top[1], TOP, col.biome, tmp, 0);
        const f = Math.min(0.92, 0.6 + (col.water - y) / 24);
        for (let k = 0; k < 3; k++) C[o + k] = tmp[k] + (C[o + k] * 0.8 - tmp[k]) * f;
      }
      C.copyWithin(o + 3, o, o + 3);
      H[c] = h; S[c] = h - 8;
    } else if (col.tree) {
      // A canopy: leaves (snowed on in cold biomes) from the ground up to the treetops.
      faceColor(colors, B.LEAVES, col.tree[0], TOP, col.biome, C, o + 3);
      if (col.snow) faceColor(colors, B.SNOW, 0, TOP, col.biome, C, o); else C.copyWithin(o, o + 3, o + 6);
      faceColor(colors, col.top[0], col.top[1], TOP, col.biome, C, o + 6);
      H[c] = ground + col.tree[1] * 8; S[c] = ground;
    } else {
      // Bare ground: a slope steps down in blocks of its top, so a wall's upper step has the top's
      // colour; below that the soil (or stone) under it shows.
      if (col.snow) faceColor(colors, B.SNOW, 0, TOP, col.biome, C, o); else faceColor(colors, col.top[0], col.top[1], TOP, col.biome, C, o);
      C.copyWithin(o + 3, o, o + 3);
      H[c] = ground; S[c] = ground - step * 8;
    }
  }

  const maxQuads = N * N * 9;
  const buf = new ArrayBuffer(maxQuads * 4 * LOD_STRIDE), u8 = new Uint8Array(buf), i16 = new Int16Array(buf);
  let v = 0, minY = 1e9, maxY = -1e9;
  const vert = (x, y, z, c, o, shade) => {
    const b = v * LOD_STRIDE;
    u8[b] = x; u8[b + 1] = z; i16[(b >> 1) + 1] = y;
    u8[b + 4] = c[o] * shade; u8[b + 5] = c[o + 1] * shade; u8[b + 6] = c[o + 2] * shade; u8[b + 7] = 255;
    v++;
  };
  // Corners in order around the face as seen from outside (counter-clockwise, front-facing in GL).
  const quad = (p, c, o, face) => {
    const shade = SHADE[face];
    for (let k = 0; k < 4; k++) vert(p[k * 3], p[k * 3 + 1], p[k * 3 + 2], c, o, shade);
  };
  // A wall from height lo to hi along one cell edge, in two colour bands split at `split`.
  const wall = (c, lo, hi, face, ax, az, bx, bz) => {
    const split = Math.max(lo, Math.min(hi, S[c]));
    minY = Math.min(minY, lo);
    if (hi > split) quad([ax, split, az, bx, split, bz, bx, hi, bz, ax, hi, az], C, c * 9 + 3, face);
    if (split > lo) quad([ax, lo, az, bx, lo, bz, bx, split, bz, ax, split, az], C, c * 9 + 6, face);
  };
  // Walls along the tile's edges reach a cell lower than they need to (a skirt), hiding the cracks
  // where it meets a tile of another level whose cells stand at slightly different heights.
  const skirt = step * 8;
  for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) {
    const c = i + j * W, h = H[c], x = i - 1, z = j - 1;
    maxY = Math.max(maxY, h); minY = Math.min(minY, h);
    quad([x, h, z, x, h, z + 1, x + 1, h, z + 1, x + 1, h, z], C, c * 9, 2);
    // Each side faces its neighbour: +X, -X, +Z, -Z.
    const sides = [[c + 1, i === N, 0, x + 1, z + 1, x + 1, z], [c - 1, i === 1, 1, x, z, x, z + 1], [c + W, j === N, 4, x, z + 1, x + 1, z + 1], [c - W, j === 1, 5, x + 1, z, x, z]];
    for (const [n, edge, face, ax, az, bx, bz] of sides) {
      const lo = edge ? Math.min(H[n], h) - skirt : H[n];
      if (lo < h) wall(c, lo, h, face, ax, az, bx, bz);
    }
  }
  return { verts: buf.slice(0, v * LOD_STRIDE), quads: v / 4, minY: Math.floor(minY / 8), maxY: Math.ceil(maxY / 8) };
}

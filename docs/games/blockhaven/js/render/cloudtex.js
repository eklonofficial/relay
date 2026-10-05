// The cloud map when no resource pack supplies textures/environment/clouds.png: 256x256 cells of
// cloud (white) or sky (clear), tiling seamlessly like Java's, with patches of scattered blobs.
export const CLOUD_SIZE = 256;

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Value noise on a lattice that wraps every `period` cells, so the map tiles.
function noise(x, y, cell, seed) {
  const period = CLOUD_SIZE / cell, gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (i, j) => hash(((x0 + i) % period + period) % period, ((y0 + j) % period + period) % period, seed);
  const a = h(0, 0) + (h(1, 0) - h(0, 0)) * sx, b = h(0, 1) + (h(1, 1) - h(0, 1)) * sx;
  return a + (b - a) * sy;
}

export function cloudTexture() {
  const N = CLOUD_SIZE, out = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = noise(x, y, 16, 1) * 0.5 + noise(x, y, 8, 2) * 0.35 + noise(x, y, 4, 3) * 0.15;
    const o = (y * N + x) * 4;
    out[o] = out[o + 1] = out[o + 2] = 255;
    out[o + 3] = n > 0.58 ? 255 : 0;
  }
  return { w: N, h: N, data: out };
}

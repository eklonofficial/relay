// Extruded 3D meshes for flat item sprites: front and back faces plus a 1-pixel rim.
// Local space: x, y in 0..1 (sprite), z in -1/32..1/32. Each quad: { pts: [[x,y,z]x4], uv: [[u,v]x4], shade }.
const cache = new Map();

export function itemMesh(key, pixels) {
  let m = cache.get(key);
  if (m) return m;
  const N = 16, T = 1 / 32;
  const solid = (x, y) => x >= 0 && y >= 0 && x < N && y < N && pixels[(y * N + x) * 4 + 3] > 20;
  m = [];
  // Front (+z) and back (-z) faces over the whole sprite; transparent texels are alpha-tested away.
  m.push({ pts: [[0, 0, T], [1, 0, T], [1, 1, T], [0, 1, T]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]], shade: 1 });
  m.push({ pts: [[1, 0, -T], [0, 0, -T], [0, 1, -T], [1, 1, -T]], uv: [[1, 1], [0, 1], [0, 0], [1, 0]], shade: 0.75 });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!solid(x, y)) continue;
    const x0 = x / N, x1 = (x + 1) / N, y1 = 1 - y / N, y0 = 1 - (y + 1) / N;
    const u0 = (x + 0.2) / N, u1 = (x + 0.8) / N, v0 = (y + 0.2) / N, v1 = (y + 0.8) / N;
    const uv = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    if (!solid(x - 1, y)) m.push({ pts: [[x0, y0, -T], [x0, y0, T], [x0, y1, T], [x0, y1, -T]], uv, shade: 0.8 });
    if (!solid(x + 1, y)) m.push({ pts: [[x1, y0, T], [x1, y0, -T], [x1, y1, -T], [x1, y1, T]], uv, shade: 0.8 });
    if (!solid(x, y - 1)) m.push({ pts: [[x0, y1, T], [x1, y1, T], [x1, y1, -T], [x0, y1, -T]], uv, shade: 1 });
    if (!solid(x, y + 1)) m.push({ pts: [[x0, y0, -T], [x1, y0, -T], [x1, y0, T], [x0, y0, T]], uv, shade: 0.6 });
  }
  cache.set(key, m);
  return m;
}

// Emits a mesh through a 3x4 row-major matrix (see entity.js M) into a batch.
export function emitItemMesh(batch, mesh, layer, m, light, alpha = 1) {
  const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const q of mesh) {
    for (let k = 0; k < 4; k++) {
      const [x, y, z] = q.pts[k];
      P[k] = [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
    }
    batch.quadUV(P, q.uv, layer, [light[0] * q.shade, light[1] * q.shade, light[2] * q.shade, alpha]);
  }
}

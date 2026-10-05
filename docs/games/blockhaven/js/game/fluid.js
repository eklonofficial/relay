// Fluid state helpers shared by the simulation and entity physics, after Java's FluidState /
// FlowingFluid. A liquid's meta is Java's legacy LiquidBlock LEVEL: 0 source, 1-7 flowing
// (amount 8 - level), 8 falling. Waterlogged blocks (seagrass, kelp) hold a water source.
import { B, SOLID, OPAQUE, WATERLOGGED } from '../data/blocks.js?v=muujme14';

export const isWater = id => id === B.WATER || WATERLOGGED[id] === 1;
export const sameFluid = (id, lava) => (lava ? id === B.LAVA : isWater(id));
const H4 = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // north, south, west, east (Direction.Plane.HORIZONTAL order)

// FluidState.getAmount for the fluid in a cell (0 when it holds no such fluid).
export function amountAt(w, x, y, z, lava) {
  const id = w.getBlock(x, y, z);
  if (!sameFluid(id, lava)) return 0;
  if (id !== B.WATER && id !== B.LAVA) return 8;
  const m = w.getMeta(x, y, z) & 15;
  return m === 0 || m >= 8 ? 8 : 8 - m;
}
const fallingAt = (w, x, y, z) => { const id = w.getBlock(x, y, z); return (id === B.WATER || id === B.LAVA) && (w.getMeta(x, y, z) & 15) >= 8; };

// FluidState.getHeight: a full block under the same fluid, else amount / 9.
export function heightAt(w, x, y, z, lava) {
  const a = amountAt(w, x, y, z, lava);
  if (!a) return 0;
  return sameFluid(w.getBlock(x, y + 1, z), lava) ? 1 : a / 9;
}

// FlowingFluid.getFlow: the normalised current at a cell ([0, 0, 0] in still fluid).
export function flowAt(w, x, y, z, lava) {
  const own = amountAt(w, x, y, z, lava) / 9;
  if (!own) return [0, 0, 0];
  let fx = 0, fz = 0;
  for (const [dx, dz] of H4) {
    const nid = w.getBlock(x + dx, y, z + dz);
    if ((nid === B.LAVA || isWater(nid)) && !sameFluid(nid, lava)) continue; // affectsFlow: no fluid, or the same one
    let f = amountAt(w, x + dx, y, z + dz, lava) / 9, d = 0;
    if (f === 0) {
      if (!SOLID[nid]) { const fb = amountAt(w, x + dx, y - 1, z + dz, lava) / 9; if (fb > 0) d = own - (fb - 0.8888889); }
    } else d = own - f;
    if (d) { fx += dx * d; fz += dz * d; }
  }
  let v = [fx, 0, fz];
  if (fallingAt(w, x, y, z)) {
    const solidFace = (a, b, c, up) => { const id = w.getBlock(a, b, c); return !sameFluid(id, lava) && (up || (OPAQUE[id] && id !== B.ICE)); };
    for (const [dx, dz] of H4) if (solidFace(x + dx, y, z + dz) || solidFace(x + dx, y + 1, z + dz)) { const l = Math.hypot(v[0], v[2]); v = l ? [v[0] / l, -6, v[2] / l] : [0, -6, 0]; break; }
  }
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-4 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
}

// Entity.updateFluidHeightAndDoFluidPushing for one fluid. box = [x0, y0, z0, x1, y1, z1]; m is the
// motion in blocks per tick, changed in place when pushed. Returns the fluid height in the box (0 = not in it).
export function fluidPush(w, box, m, lava, scale, pushed, normalize) {
  const e = 0.001, x0 = box[0] + e, y0 = box[1] + e, z0 = box[2] + e, x1 = box[3] - e, y1 = box[4] - e, z1 = box[5] - e;
  let depth = 0, touching = false, vx = 0, vy = 0, vz = 0, n = 0;
  for (let x = Math.floor(x0); x < Math.ceil(x1); x++) for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let z = Math.floor(z0); z < Math.ceil(z1); z++) {
    const h = heightAt(w, x, y, z, lava);
    if (!h || y + h < y0) continue;
    touching = true;
    depth = Math.max(y + h - y0, depth);
    if (!pushed) continue;
    let f = flowAt(w, x, y, z, lava);
    if (depth < 0.4) f = [f[0] * depth, f[1] * depth, f[2] * depth];
    vx += f[0]; vy += f[1]; vz += f[2]; n++;
  }
  let l = Math.hypot(vx, vy, vz);
  if (l > 0) {
    if (n > 0) { vx /= n; vy /= n; vz /= n; }
    if (normalize) { l = Math.hypot(vx, vy, vz); vx /= l; vy /= l; vz /= l; }
    vx *= scale; vy *= scale; vz *= scale;
    l = Math.hypot(vx, vy, vz);
    if (Math.abs(m[0]) < 0.003 && Math.abs(m[2]) < 0.003 && l < 0.0045) { vx *= 0.0045 / l; vy *= 0.0045 / l; vz *= 0.0045 / l; }
    m[0] += vx; m[1] += vy; m[2] += vz;
  }
  return touching ? Math.max(depth, 1e-6) : 0;
}

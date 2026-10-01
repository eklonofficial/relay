// Grid A* for walking mobs: 8-way moves (no corner cutting), one-block step-ups, drops of up to
// three blocks, doors for villagers, and it avoids lava, fire, cacti and deep falls. When the
// goal can't be reached within the node budget it returns a path to the closest spot it found.
import { B, SOLID, SHAPE_OF, SHAPE } from '../data/blocks.js?v=muox46vc';
import { UNLOADED } from '../world/world.js?v=muox46vc';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DANGER = new Set([B.LAVA, B.FIRE, B.CACTUS, B.SWEET_BERRY_BUSH, B.MAGMA_BLOCK].filter(x => x !== undefined));

// Min-heap keyed on f.
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
}

export function findPath(world, from, to, { height = 2, maxNodes = 700, maxDrop = 3, doors = false, swim = false } = {}) {
  const get = (x, y, z) => world.getBlock(x, y, z);
  const passable = id => id === B.AIR || (!SOLID[id] && !DANGER.has(id) && id !== UNLOADED) || (doors && SHAPE_OF[id] === SHAPE.DOOR) || (swim && id === B.WATER);
  const standable = (x, y, z) => {
    const below = get(x, y - 1, z);
    if (below === UNLOADED || DANGER.has(below)) return false;
    if (!(SOLID[below] || (swim && below === B.WATER) || get(x, y, z) === B.WATER)) return false;
    for (let k = 0; k < height; k++) if (!passable(get(x, y + k, z))) return false;
    return true;
  };
  const sx = Math.floor(from[0]), sy = Math.floor(from[1] + 0.01), sz = Math.floor(from[2]);
  const gx = Math.floor(to[0]), gy = Math.floor(to[1] + 0.01), gz = Math.floor(to[2]);
  const key = (x, y, z) => ((x & 1023) << 20) | ((y & 255) << 10) | (z & 1023);
  const h = (x, y, z) => { const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(y - gy) * 0.5; };
  const open = new Heap(), seen = new Map();
  const start = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), parent: null };
  open.push(start); seen.set(key(sx, sy, sz), start);
  let best = start, n = 0;
  while (open.size && n++ < maxNodes) {
    const c = open.pop();
    if (c.closed) continue;
    c.closed = true;
    if (Math.abs(c.x - gx) <= 1 && Math.abs(c.z - gz) <= 1 && Math.abs(c.y - gy) <= 1) { best = c; break; }
    if (c.f - c.g < best.f - best.g) best = c;
    for (const [dx, dz] of DIRS) {
      const nx = c.x + dx, nz = c.z + dz;
      if (dx && dz && (!passable(get(c.x + dx, c.y, c.z)) || !passable(get(c.x, c.y, c.z + dz)) || !passable(get(c.x + dx, c.y + 1, c.z)) || !passable(get(c.x, c.y + 1, c.z + dz)))) continue;
      let ny = -1;
      if (standable(nx, c.y, nz)) ny = c.y;
      else if (passable(get(c.x, c.y + height, c.z)) && standable(nx, c.y + 1, nz)) ny = c.y + 1; // step up
      else if (passable(get(nx, c.y, nz)) && passable(get(nx, c.y + 1, nz))) { // drop down
        for (let d = 1; d <= maxDrop; d++) if (standable(nx, c.y - d, nz)) { ny = c.y - d; break; } else if (!passable(get(nx, c.y - d, nz))) break;
      }
      if (ny < 1) continue;
      const k = key(nx, ny, nz);
      const cost = c.g + (dx && dz ? 1.414 : 1) + (ny > c.y ? 0.6 : ny < c.y ? 0.3 * (c.y - ny) : 0) + (get(nx, ny, nz) === B.WATER ? 1.5 : 0);
      const o = seen.get(k);
      if (o && (o.closed || o.g <= cost)) continue;
      const node = { x: nx, y: ny, z: nz, g: cost, f: cost + h(nx, ny, nz), parent: c };
      seen.set(k, node); open.push(node);
    }
  }
  if (best === start) return null;
  const path = [];
  for (let c = best; c && c !== start; c = c.parent) path.push([c.x + 0.5, c.y, c.z + 0.5]);
  path.reverse();
  // Drop redundant waypoints on straight runs.
  const out = [];
  for (let i = 0; i < path.length; i++) {
    const a = out[out.length - 1], b = path[i], c = path[i + 1];
    if (a && c && b[1] === a[1] && c[1] === b[1] && Math.sign(b[0] - a[0]) === Math.sign(c[0] - b[0]) && Math.sign(b[2] - a[2]) === Math.sign(c[2] - b[2])) continue;
    out.push(b);
  }
  return { points: out, complete: Math.abs(best.x - gx) <= 1 && Math.abs(best.z - gz) <= 1 && Math.abs(best.y - gy) <= 1 };
}

// True when a mob can walk straight at p without a wall, hole or hazard in the way.
export function clearWalk(world, from, to, height = 2) {
  const dx = to[0] - from[0], dz = to[2] - from[2], d = Math.hypot(dx, dz);
  if (Math.abs(to[1] - from[1]) > 1.2) return false;
  const steps = Math.ceil(d / 0.5);
  let y = Math.floor(from[1] + 0.01);
  for (let i = 1; i <= steps; i++) {
    const x = from[0] + dx * i / steps, z = from[2] + dz * i / steps;
    const feet = world.getBlock(x, y, z), below = world.getBlock(x, y - 1, z);
    if (SOLID[feet]) { if (SOLID[world.getBlock(x, y + 1, z)] || SOLID[world.getBlock(x, y + height, z)]) return false; y++; continue; }
    if (!SOLID[below]) { if (SOLID[world.getBlock(x, y - 2, z)]) { y--; continue; } return false; }
    for (let k = 1; k < height; k++) if (SOLID[world.getBlock(x, y + k, z)]) return false;
    if (DANGER.has(feet) || DANGER.has(below)) return false;
  }
  return true;
}

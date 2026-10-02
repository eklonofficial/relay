// Tree and large-plant generators. (x, y, z) is the first air block above the ground; r is a seeded RNG.
import { B } from '../data/blocks.js?v=muqxeajj';

export const WOOD = { oak: 0, spruce: 1, birch: 2, jungle: 3, acacia: 4, dark_oak: 5, cherry: 6, mangrove: 7 };
export const LEAF = { oak: 0, spruce: 1, birch: 2, jungle: 3, acacia: 4, dark_oak: 5, cherry: 6, mangrove: 7, azalea: 8, flowering_azalea: 9 };
const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
const ri = (r, a, b) => a + Math.floor(r() * (b - a + 1));

const log = (w, x, y, z, wood, axis = 0) => w.set(x, y, z, B.LOG, wood | (axis << 4));
const leaf = (w, x, y, z, t) => w.soft(x, y, z, B.LEAVES, t);

function blob(w, cx, cy, cz, rx, ry, rz, t, r, rough = 0.25) {
  const X = Math.ceil(rx), Y = Math.ceil(ry), Z = Math.ceil(rz);
  for (let dy = -Y; dy <= Y; dy++) for (let dz = -Z; dz <= Z; dz++) for (let dx = -X; dx <= X; dx++) {
    const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);
    if (d <= 1 - rough * r()) leaf(w, cx + dx, cy + dy, cz + dz, t);
  }
}
function layer(w, cx, y, cz, rad, t, r, cutCorners = true) {
  for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
    if (cutCorners && Math.abs(dx) === rad && Math.abs(dz) === rad && (rad > 1 || r() < 0.5)) continue;
    leaf(w, cx + dx, y, cz + dz, t);
  }
}
function disc(w, cx, y, cz, rad, t, r, rough = 0.3) {
  for (let dz = -Math.ceil(rad); dz <= Math.ceil(rad); dz++) for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx++) {
    if (dx * dx + dz * dz <= rad * rad * (1 - rough * r())) leaf(w, cx + dx, y, cz + dz, t);
  }
}
// Hanging vines under and beside leaves.
function vines(w, x0, y0, z0, x1, y1, z1, r, chance = 0.25) {
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    if (w.get(x, y, z) !== B.AIR) continue;
    for (let d = 0; d < 4; d++) {
      if (w.get(x + DIRS[d][0], y, z + DIRS[d][1]) !== B.LEAVES || r() > chance) continue;
      const len = ri(r, 1, 5);
      for (let k = 0; k < len && w.get(x, y - k, z) === B.AIR; k++) w.set(x, y - k, z, B.VINE, d);
      break;
    }
  }
}
function trunkVines(w, x, y, z, h, r, chance = 0.35) {
  for (let d = 0; d < 4; d++) for (let k = 0; k < h; k++) {
    if (r() < chance) w.soft(x - DIRS[d][0], y + k, z - DIRS[d][1], B.VINE, d);
  }
}

export function oak(w, x, y, z, r, opts = {}) {
  const h = ri(r, 4, 6), t = opts.leaf ?? LEAF.oak, wood = opts.wood ?? WOOD.oak;
  const top = y + h - 1;
  layer(w, x, top - 1, z, 2, t, r); layer(w, x, top, z, 2, t, r);
  layer(w, x, top + 1, z, 1, t, r); layer(w, x, top + 2, z, 1, t, r, false);
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) w.set(x + dx, top + 2, z + dz, B.AIR);
  for (let k = 0; k < h; k++) log(w, x, y + k, z, wood);
  if (opts.vines) vines(w, x - 3, top - 2, z - 3, x + 3, top + 2, z + 3, r, 0.35);
}

export function birch(w, x, y, z, r, tall = false) {
  oak(w, x, y, z, r, { leaf: LEAF.birch, wood: WOOD.birch });
  if (tall) { const extra = ri(r, 4, 7); for (let k = 0; k < extra; k++) log(w, x, y + k, z, WOOD.birch); blob(w, x, y + extra + 5, z, 2, 2.5, 2, LEAF.birch, r); for (let k = 0; k < extra + 6; k++) log(w, x, y + k, z, WOOD.birch); }
}

export function fancyOak(w, x, y, z, r) {
  const h = ri(r, 7, 12);
  const branches = ri(r, 3, 5);
  for (let b = 0; b < branches; b++) {
    const a = r() * Math.PI * 2, len = ri(r, 2, 4), by = y + Math.floor(h * (0.45 + r() * 0.4));
    let bx = x, bz = z;
    for (let k = 1; k <= len; k++) {
      const nx = x + Math.round(Math.cos(a) * k), nz = z + Math.round(Math.sin(a) * k);
      const axis = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? 1 : 2;
      log(w, nx, by + Math.floor(k / 2), nz, WOOD.oak, axis);
      bx = nx; bz = nz;
    }
    blob(w, bx, by + Math.floor(len / 2) + 1, bz, 2.6, 1.8, 2.6, LEAF.oak, r);
  }
  blob(w, x, y + h, z, 3, 2.2, 3, LEAF.oak, r);
  for (let k = 0; k < h; k++) log(w, x, y + k, z, WOOD.oak);
}

export function spruce(w, x, y, z, r, snowy = false) {
  const h = ri(r, 6, 10), top = y + h;
  leaf(w, x, top + 1, z, LEAF.spruce); leaf(w, x, top, z, LEAF.spruce);
  layer(w, x, top - 1, z, 1, LEAF.spruce, r);
  let rad = 1, maxR = h > 8 ? 3 : 2;
  for (let yy = top - 2; yy >= y + 2; yy--) {
    layer(w, x, yy, z, rad, LEAF.spruce, r);
    rad = rad >= maxR ? 1 : rad + 1;
  }
  for (let k = 0; k < h; k++) log(w, x, y + k, z, WOOD.spruce);
  if (snowy) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) for (let yy = top + 2; yy > y; yy--) {
    if (w.get(x + dx, yy, z + dz) === B.LEAVES) { w.soft(x + dx, yy + 1, z + dz, B.SNOW, 0); break; }
  }
}

export function pine(w, x, y, z, r) {
  const h = ri(r, 9, 14), top = y + h;
  leaf(w, x, top + 1, z, LEAF.spruce);
  for (let yy = top; yy >= top - 4; yy--) layer(w, x, yy, z, yy === top || yy === top - 4 ? 1 : 2, LEAF.spruce, r);
  for (let k = 0; k < h; k++) log(w, x, y + k, z, WOOD.spruce);
}

export function megaSpruce(w, x, y, z, r) {
  const h = ri(r, 18, 30), top = y + h;
  for (let yy = top + 1; yy >= top - Math.floor(h * 0.55); yy--) {
    const t = (top + 1 - yy) / (h * 0.55);
    const rad = 1 + t * 4 * (0.7 + 0.3 * Math.sin(yy * 1.3));
    disc(w, x + 0.5, yy, z + 0.5, rad, LEAF.spruce, r, 0.2);
  }
  for (let k = 0; k < h; k++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) log(w, x + dx, y + k, z + dz, WOOD.spruce);
  for (let dz = -2; dz <= 3; dz++) for (let dx = -2; dx <= 3; dx++) if (r() < 0.7 && w.get(x + dx, y - 1, z + dz) === B.GRASS_BLOCK) w.set(x + dx, y - 1, z + dz, B.DIRT, 2);
}

export function jungle(w, x, y, z, r) {
  const h = ri(r, 5, 9), top = y + h - 1;
  layer(w, x, top - 1, z, 2, LEAF.jungle, r); layer(w, x, top, z, 2, LEAF.jungle, r); layer(w, x, top + 1, z, 1, LEAF.jungle, r);
  for (let k = 0; k < h; k++) log(w, x, y + k, z, WOOD.jungle);
  trunkVines(w, x, y, z, h - 1, r, 0.3);
}

export function megaJungle(w, x, y, z, r) {
  const h = ri(r, 16, 28), top = y + h;
  blob(w, x + 0.5, top, z + 0.5, 4.5, 2.2, 4.5, LEAF.jungle, r, 0.2);
  for (let b = 0; b < 3; b++) {
    const a = r() * Math.PI * 2, by = y + Math.floor(h * (0.5 + r() * 0.35)), len = ri(r, 3, 5);
    let ex = x, ez = z;
    for (let k = 1; k <= len; k++) { ex = x + Math.round(Math.cos(a) * k); ez = z + Math.round(Math.sin(a) * k); log(w, ex, by + (k >> 1), ez, WOOD.jungle, Math.abs(Math.cos(a)) > 0.7 ? 1 : 2); }
    blob(w, ex, by + (len >> 1) + 1, ez, 2.8, 1.5, 2.8, LEAF.jungle, r);
  }
  for (let k = 0; k < h; k++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) log(w, x + dx, y + k, z + dz, WOOD.jungle);
  for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) trunkVines(w, x + dx, y, z + dz, h - 2, r, 0.25);
  vines(w, x - 6, top - 4, z - 6, x + 7, top + 1, z + 7, r, 0.3);
}

export function acacia(w, x, y, z, r) {
  const h = ri(r, 3, 5);
  for (let k = 0; k < h; k++) log(w, x, y + k, z, WOOD.acacia);
  const d = DIRS[ri(r, 0, 3)], bend = ri(r, 2, 3);
  let bx = x, by = y + h - 1, bz = z;
  for (let k = 0; k < bend; k++) { bx += d[0]; bz += d[1]; by++; log(w, bx, by, bz, WOOD.acacia); }
  disc(w, bx, by + 1, bz, 3.3, LEAF.acacia, r, 0.15); disc(w, bx, by + 2, bz, 2.2, LEAF.acacia, r, 0.1);
  if (r() < 0.6) {
    const d2 = DIRS[(DIRS.indexOf(d) + 2) % 4];
    let cx = x, cy = y + h - 2, cz = z;
    for (let k = 0; k < 2; k++) { cx += d2[0]; cz += d2[1]; cy++; log(w, cx, cy, cz, WOOD.acacia); }
    disc(w, cx, cy + 1, cz, 2.4, LEAF.acacia, r, 0.15);
  }
}

export function darkOak(w, x, y, z, r) {
  const h = ri(r, 6, 9), top = y + h;
  disc(w, x + 0.5, top - 1, z + 0.5, 4.3, LEAF.dark_oak, r, 0.15);
  disc(w, x + 0.5, top, z + 0.5, 4, LEAF.dark_oak, r, 0.15);
  disc(w, x + 0.5, top + 1, z + 0.5, 2.8, LEAF.dark_oak, r, 0.2);
  for (let k = 0; k < h; k++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) log(w, x + dx, y + k, z + dz, WOOD.dark_oak);
  for (const [dx, dz] of [[-1, 0], [2, 1], [0, 2], [1, -1]]) if (r() < 0.5) log(w, x + dx, y + h - 2, z + dz, WOOD.dark_oak);
}

export function cherry(w, x, y, z, r) {
  const h = ri(r, 4, 6);
  for (let k = 0; k < h; k++) log(w, x, y + k, z, WOOD.cherry);
  const n = ri(r, 2, 3), a0 = r() * Math.PI * 2;
  for (let b = 0; b < n; b++) {
    const a = a0 + b * Math.PI * 2 / n, len = ri(r, 3, 4);
    let ex = x, ey = y + h - 1, ez = z;
    for (let k = 1; k <= len; k++) {
      ex = x + Math.round(Math.cos(a) * k); ez = z + Math.round(Math.sin(a) * k); ey = y + h - 1 + Math.round(k * 0.8);
      log(w, ex, ey, ez, WOOD.cherry, Math.abs(Math.cos(a)) > 0.7 ? 1 : 2);
    }
    blob(w, ex, ey + 1, ez, 3.4, 2, 3.4, LEAF.cherry, r, 0.2);
    for (let k = 0; k < 10; k++) { const hx = ex + ri(r, -3, 3), hz = ez + ri(r, -3, 3); if (w.get(hx, ey - 1, hz) === B.AIR && w.get(hx, ey, hz) === B.LEAVES) leaf(w, hx, ey - 1, hz, LEAF.cherry); }
  }
}

export function mangrove(w, x, y, z, r) {
  const lift = ri(r, 2, 4), h = ri(r, 5, 8);
  for (const d of DIRS) {
    for (let k = 0; k <= lift + 2; k++) {
      const rx = x + d[0] * Math.min(k, 2), rz = z + d[1] * Math.min(k, 2), ry = y + lift - k;
      if (ry < y - 3) break;
      const c = w.get(rx, ry, rz);
      if (c > 0 && c !== B.WATER && c !== B.AIR && c !== B.SEAGRASS) break;
      w.set(rx, ry, rz, B.MANGROVE_ROOTS);
    }
  }
  for (let k = 0; k < h; k++) log(w, x, y + lift + k, z, WOOD.mangrove);
  blob(w, x, y + lift + h, z, 3.2, 2.2, 3.2, LEAF.mangrove, r);
  vines(w, x - 4, y + lift + h - 3, z - 4, x + 4, y + lift + h, z + 4, r, 0.2);
}

export function azalea(w, x, y, z, r) {
  const h = ri(r, 2, 3);
  for (let k = 0; k < h; k++) log(w, x, y + k, z, WOOD.oak);
  for (let dy = 0; dy < 3; dy++) {
    const rad = dy === 2 ? 1.5 : 2.5;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dz * dz <= rad * rad * (1 - 0.3 * r())) leaf(w, x + dx, y + h + dy - 1, z + dz, r() < 0.3 ? LEAF.flowering_azalea : LEAF.azalea);
  }
  w.set(x, y - 1, z, B.DIRT, 3);
}

export function bush(w, x, y, z, r, t = LEAF.jungle, wood = WOOD.jungle) {
  log(w, x, y, z, wood);
  blob(w, x, y + 0.5, z, 2, 1.4, 2, t, r, 0.3);
}

export function hugeMushroom(w, x, y, z, r, red) {
  const h = ri(r, 5, 8);
  const cap = red ? 0 : 1;
  if (red) {
    for (let dy = -3; dy <= 0; dy++) {
      const rad = dy === 0 ? 1 : 2;
      for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
        if (dy < 0 && Math.abs(dx) < rad && Math.abs(dz) < rad) continue;
        if (dy < 0 && Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
        w.soft(x + dx, y + h + dy, z + dz, B.MUSHROOM_BLOCK, cap, true);
      }
    }
  } else {
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      w.soft(x + dx, y + h, z + dz, B.MUSHROOM_BLOCK, cap, true);
    }
  }
  for (let k = 0; k < h; k++) w.set(x, y + k, z, B.MUSHROOM_BLOCK, 2);
}

export function iceSpike(w, x, y, z, r) {
  const big = r() < 0.08, h = big ? ri(r, 22, 45) : ri(r, 6, 14), base = big ? 3.2 : 1.6;
  for (let k = -3; k < h; k++) {
    const rad = base * Math.pow(1 - Math.max(0, k) / h, 0.8);
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dz * dz <= rad * rad) w.set(x + dx, y + k, z + dz, B.PACKED_ICE, 0);
  }
}

export function boulder(w, x, y, z, r) {
  const rad = 1.5 + r() * 1.2;
  for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    if (dx * dx + dy * dy * 1.4 + dz * dz <= rad * rad * (1 - 0.2 * r())) w.set(x + dx, y + dy, z + dz, B.COBBLESTONE, 1);
  }
}

export function fallenLog(w, x, y, z, r, wood) {
  const d = r() < 0.5 ? [1, 0] : [0, 1], len = ri(r, 3, 5);
  for (let k = 0; k < len; k++) {
    const lx = x + d[0] * k, lz = z + d[1] * k;
    if (w.get(lx, y - 1, lz) <= 0 || w.get(lx, y - 1, lz) === B.AIR) return;
    log(w, lx, y, lz, wood, d[0] ? 1 : 2);
    if (r() < 0.3) w.soft(lx, y + 1, lz, B.MOSS_CARPET);
  }
}

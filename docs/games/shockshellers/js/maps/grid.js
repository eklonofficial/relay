// The collision world: a W×H×D grid of cells, each a piece id and rotation (pieces.js). Shared by
// the simulation (movement, bullets, grenades), the bots (line of sight, navigation) and the renderer.
import { PIECES, BOXES, PIECE, facing } from './pieces.js?v=muvda47g';

export class MapGrid {
  constructor(w, h, d) {
    this.w = w; this.h = h; this.d = d;
    this.cells = new Uint16Array(w * h * d);
    this.rot = new Uint8Array(w * h * d);
    this.tint = new Uint8Array(w * h * d); // material variant, for the renderer
  }
  index(x, y, z) { return (y * this.d + z) * this.w + x; }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.d; }
  get(x, y, z) { return this.inside(x, y, z) ? this.cells[this.index(x, y, z)] : 0; }
  getRot(x, y, z) { return this.inside(x, y, z) ? this.rot[this.index(x, y, z)] : 0; }
  set(x, y, z, piece, ry = 0, tint = 0) {
    if (!this.inside(x, y, z)) return;
    const i = this.index(x, y, z);
    this.cells[i] = typeof piece === 'string' ? PIECE[piece] : piece; this.rot[i] = ry & 3; this.tint[i] = tint;
  }
  piece(x, y, z) { return PIECES[this.get(x, y, z)]; }
  // Rotated collider boxes of one cell, in cell space.
  boxes(x, y, z) { const i = this.inside(x, y, z) ? this.index(x, y, z) : -1; return i < 0 ? EMPTY : BOXES[this.cells[i]][this.rot[i]]; }
  // Is this cell (fully) solid for line-of-sight purposes?
  opaque(x, y, z) { const p = this.piece(x, y, z); return p.key === 'block' || p.key === 'leaves'; }

  // ---- sphere vs. world ----
  // Calls fn(nx, ny, nz, depth, kind, top) for every collider box the sphere overlaps (normal points out of
  // the box towards the sphere centre). `players` selects player colliders; otherwise grenade ones.
  overlaps(cx, cy, cz, r, fn) {
    const x0 = Math.floor(cx - r), x1 = Math.floor(cx + r), y0 = Math.floor(cy - r), y1 = Math.floor(cy + r), z0 = Math.floor(cz - r), z1 = Math.floor(cz + r);
    let any = false;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (!this.inside(x, y, z)) continue;
      const i = this.index(x, y, z), p = PIECES[this.cells[i]];
      if (!p.blocksPlayers) continue;
      for (const b of BOXES[p.id][this.rot[i]]) {
        const bx0 = x + b[0], by0 = y + b[1], bz0 = z + b[2], bx1 = x + b[3], by1 = y + b[4], bz1 = z + b[5];
        const px = cx < bx0 ? bx0 : cx > bx1 ? bx1 : cx, py = cy < by0 ? by0 : cy > by1 ? by1 : cy, pz = cz < bz0 ? bz0 : cz > bz1 ? bz1 : cz;
        let dx = cx - px, dy = cy - py, dz = cz - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        let depth, nx, ny, nz;
        if (d2 > 1e-12) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; nz = dz / d; depth = r - d; }
        else {
          // Centre inside the box: push out through the nearest face.
          const faces = [cx - bx0, bx1 - cx, cy - by0, by1 - cy, cz - bz0, bz1 - cz];
          let k = 0; for (let j = 1; j < 6; j++) if (faces[j] < faces[k]) k = j;
          nx = k === 0 ? -1 : k === 1 ? 1 : 0; ny = k === 2 ? -1 : k === 3 ? 1 : 0; nz = k === 4 ? -1 : k === 5 ? 1 : 0;
          depth = faces[k] + r;
        }
        any = true;
        if (fn(nx, ny, nz, depth, p.kind, by1) === false) return true;
      }
    }
    return any;
  }
  collides(cx, cy, cz, r) { return this.overlaps(cx, cy, cz, r, () => false); }

  // ---- rays ----
  // First hit of the segment from (ox,oy,oz) along unit (dx,dy,dz) up to maxT, against colliders that
  // block shots (bullets) or players (grenades/spatula: pass === true). Writes into `out`
  // ({t, nx, ny, nz, x, y, z}) and returns true on a hit. Amanatides–Woo cell walk, then slab tests.
  raycast(ox, oy, oz, dx, dy, dz, maxT, out = HIT, pass = false) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0, sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
    let tmx = sx > 0 ? (x + 1 - ox) * tdx : sx < 0 ? (ox - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - oy) * tdy : sy < 0 ? (oy - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - oz) * tdz : sz < 0 ? (oz - z) * tdz : Infinity;
    let t = 0;
    for (let guard = 0; guard < 1024 && t <= maxT; guard++) {
      if (this.inside(x, y, z)) {
        const i = this.index(x, y, z), p = PIECES[this.cells[i]];
        if (pass ? p.blocksPlayers : p.blocksShots) {
          let best = Infinity, bn = 0;
          for (const b of BOXES[p.id][this.rot[i]]) {
            const r = slab(ox, oy, oz, dx, dy, dz, x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
            if (r >= 0 && r < best) { best = r; bn = SLAB_N; }
          }
          if (best <= maxT) {
            out.t = best; out.nx = bn === 1 ? -Math.sign(dx) : 0; out.ny = bn === 2 ? -Math.sign(dy) : 0; out.nz = bn === 3 ? -Math.sign(dz) : 0;
            out.x = ox + dx * best; out.y = oy + dy * best; out.z = oz + dz * best;
            return true;
          }
        }
      } else if ((x < 0 && sx <= 0) || (x >= this.w && sx >= 0) || (y < 0 && sy <= 0) || (y >= this.h && sy >= 0) || (z < 0 && sz <= 0) || (z >= this.d && sz >= 0)) break; // outside, moving away
      if (tmx < tmy && tmx < tmz) { t = tmx; tmx += tdx; x += sx; }
      else if (tmy < tmz) { t = tmy; tmy += tdy; y += sy; }
      else { t = tmz; tmz += tdz; z += sz; }
    }
    return false;
  }
  // Clear line between two points for shots (bots' line of sight uses this).
  visible(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    return !this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 1e-3);
  }

  // ---- features ----
  // The ladder cell the sphere touches (with its wall direction), or null.
  ladderAt(cx, cy, cz, r) {
    for (let y = Math.floor(cy - 0.9); y <= Math.floor(cy + 0.9); y++) for (let z = Math.floor(cz - r); z <= Math.floor(cz + r); z++) for (let x = Math.floor(cx - r); x <= Math.floor(cx + r); x++) {
      if (this.get(x, y, z) !== PIECE.ladder) continue;
      const [fx, fz] = facing(this.getRot(x, y, z));
      // The rung face sits against the wall side; the sphere must reach into the cell.
      const nx = Math.max(x, Math.min(x + 1, cx)), nz = Math.max(z, Math.min(z + 1, cz));
      if ((cx - nx) ** 2 + (cz - nz) ** 2 > (r + 0.02) ** 2) continue;
      return { x, y, z, fx, fz };
    }
    return null;
  }
  padUnder(px, py, pz) {
    const y = Math.floor(py - 0.06);
    return this.get(Math.floor(px), y, Math.floor(pz)) === PIECE.pad && py - y < 0.25;
  }
  // Height of the top walkable surface in a column at or below y (or -Infinity).
  floorBelow(x, y, z) {
    for (let cy = Math.min(this.h - 1, Math.floor(y)); cy >= 0; cy--) {
      let top = -Infinity;
      for (const b of this.boxes(Math.floor(x), cy, Math.floor(z))) if (PIECES[this.get(Math.floor(x), cy, Math.floor(z))].blocksPlayers && cy + b[4] <= y + 1e-6) top = Math.max(top, cy + b[4]);
      if (top > -Infinity) return top;
    }
    return -Infinity;
  }
}

const EMPTY = [];
export const HIT = { t: 0, nx: 0, ny: 0, nz: 0, x: 0, y: 0, z: 0 };
let SLAB_N = 0;
// Entry distance of a ray into an AABB (or -1); sets SLAB_N to the entry axis (1 x, 2 y, 3 z).
function slab(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, axis = 0;
  if (dx !== 0) { let a = (x0 - ox) / dx, b = (x1 - ox) / dx; if (a > b) [a, b] = [b, a]; if (a > tmin) { tmin = a; axis = 1; } if (b < tmax) tmax = b; }
  else if (ox < x0 || ox > x1) return -1;
  if (dy !== 0) { let a = (y0 - oy) / dy, b = (y1 - oy) / dy; if (a > b) [a, b] = [b, a]; if (a > tmin) { tmin = a; axis = 2; } if (b < tmax) tmax = b; }
  else if (oy < y0 || oy > y1) return -1;
  if (dz !== 0) { let a = (z0 - oz) / dz, b = (z1 - oz) / dz; if (a > b) [a, b] = [b, a]; if (a > tmin) { tmin = a; axis = 3; } if (b < tmax) tmax = b; }
  else if (oz < z0 || oz > z1) return -1;
  if (tmax < Math.max(tmin, 0)) return -1;
  if (tmin < 0) { SLAB_N = axis; return 0; } // starting inside
  SLAB_N = axis; return tmin;
}

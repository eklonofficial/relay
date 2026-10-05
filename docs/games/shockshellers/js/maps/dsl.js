// A small vocabulary for writing maps by hand: fill volumes with pieces, add stairs, ladders and
// metadata layers (spawns, items, roost zones, spatula spawns, the overview camera). Maps are code,
// so symmetric layouts are written once and mirrored.
import { MapGrid } from './grid.js?v=muv76gka';
import { PIECE } from './pieces.js?v=muv76gka';

// Material families (render/materials.js gives each one textures and colours).
export const MAT = { stone: 0, grass: 1, wood: 2, brick: 3, sand: 4, metal: 5, dirt: 6, plaster: 7, roof: 8, darkStone: 9, snow: 10, panel: 11, crate: 12, hay: 13, moon: 14, gold: 15, leaf: 16, water: 17, red: 18, blue: 19 };

export class Builder {
  constructor(w, h, d) { this.grid = new MapGrid(w, h, d); this.spawns = []; this.items = []; this.roostZones = []; this.spatulaSpawns = []; this.overview = null; this.mirrors = []; }
  // Every call through `put` is repeated for each active mirror (x, z or both).
  put(x, y, z, piece, ry = 0, mat = 0) {
    this.grid.set(x, y, z, piece, ry, mat);
    for (const m of this.mirrors) { const [mx, mz, mr] = m(x, z, ry); this.grid.set(mx, y, mz, piece, mr, mat); }
  }
  fill(x0, y0, z0, x1, y1, z1, piece = 'block', mat = MAT.stone, ry = 0) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.put(x, y, z, piece, ry, mat);
    return this;
  }
  clear(x0, y0, z0, x1, y1, z1) { return this.fill(x0, y0, z0, x1, y1, z1, 'air', 0); }
  // Hollow room: walls one cell thick from y0 to y1, floor at y0-1 left as is.
  walls(x0, y0, z0, x1, y1, z1, mat = MAT.stone) {
    this.fill(x0, y0, z0, x1, y1, z0, 'block', mat); this.fill(x0, y0, z1, x1, y1, z1, 'block', mat);
    this.fill(x0, y0, z0, x0, y1, z1, 'block', mat); this.fill(x1, y0, z0, x1, y1, z1, 'block', mat);
    return this;
  }
  // A flight of `n` stairs starting at (x,y,z) rising one cell per cell in direction ry
  // (0 +z, 1 +x, 2 -z, 3 -x), `width` cells wide (extending to the right of the climb).
  stairs(x, y, z, n, ry, width = 1, mat = MAT.stone, piece = 'stairs') {
    const [fx, fz] = [[0, 1], [1, 0], [0, -1], [-1, 0]][ry], [rx, rz] = [[-1, 0], [0, 1], [1, 0], [0, -1]][ry];
    for (let i = 0; i < n; i++) for (let k = 0; k < width; k++) {
      const cx = x + fx * i + rx * k, cz = z + fz * i + rz * k;
      this.put(cx, y + i, cz, piece, ry, mat);
      for (let j = y; j < y + i; j++) this.put(cx, j, cz, 'block', 0, mat);
    }
    return this;
  }
  // A ladder `h` cells tall in cell (x, y.., z), hung on the wall in direction ry.
  ladder(x, y, z, h, ry, mat = MAT.wood) { for (let i = 0; i < h; i++) this.put(x, y + i, z, 'ladder', ry, mat); return this; }
  // Metadata, mirrored like geometry. Coordinates are cell coordinates; y is the floor cell's top.
  spawn(x, y, z, team = 0, yaw = null) { this.meta('spawns', { x: x + 0.5, y, z: z + 0.5, team, yaw }, team); return this; }
  item(kind, x, y, z) { this.meta('items', { kind, x: x + 0.5, y: y + 0.3, z: z + 0.5 }); return this; }
  spatula(x, y, z) { this.meta('spatulaSpawns', { x: x + 0.5, y, z: z + 0.5 }); return this; }
  roost(x0, z0, x1, z1, y, h = 3) { this.meta('roostZones', { x0, z0, x1: x1 + 1, z1: z1 + 1, y0: y, y1: y + h, cx: (x0 + x1 + 1) / 2, cy: y, cz: (z0 + z1 + 1) / 2 }); return this; }
  meta(list, o, team = 0) {
    this[list].push(o);
    for (const m of this.mirrors) {
      const c = { ...o };
      if ('x0' in o) { const [ax, az] = m(o.x0, o.z0), [bx, bz] = m(o.x1 - 1, o.z1 - 1); c.x0 = Math.min(ax, bx); c.x1 = Math.max(ax, bx) + 1; c.z0 = Math.min(az, bz); c.z1 = Math.max(az, bz) + 1; c.cx = (c.x0 + c.x1) / 2; c.cz = (c.z0 + c.z1) / 2; }
      else { const [mx, mz] = m(o.x - 0.5, o.z - 0.5); c.x = mx + 0.5; c.z = mz + 0.5; if (o.yaw !== null && o.yaw !== undefined) c.yaw = o.yaw + Math.PI; }
      if (team) c.team = 3 - team;
      // Skip exact duplicates (an item on the mirror line).
      if (!this[list].some(e => e.x === c.x && e.z === c.z && e.y === c.y && e.x0 === c.x0 && e.z0 === c.z0)) this[list].push(c);
    }
  }
  // Point-mirror through the map centre (180° rotation): the usual two-team symmetry.
  mirrored(fn) {
    const { w, d } = this.grid;
    this.mirrors.push((x, z, ry = 0) => [w - 1 - x, d - 1 - z, (ry + 2) & 3]);
    fn(this); this.mirrors.pop(); return this;
  }
  // Four-way rotational symmetry about the centre (square maps only).
  quartered(fn) {
    const n = this.grid.w;
    // (x,z) → (n-1-z, x) turns directions by three of rotateBox's quarter turns, and so on.
    this.mirrors.push((x, z, ry = 0) => [n - 1 - z, x, (ry + 3) & 3], (x, z, ry = 0) => [n - 1 - x, n - 1 - z, (ry + 2) & 3], (x, z, ry = 0) => [z, n - 1 - x, (ry + 1) & 3]);
    fn(this); this.mirrors.length -= 3; return this;
  }
  finish(meta) {
    return { grid: this.grid, meta, spawns: this.spawns, items: this.items, roostZones: this.roostZones, spatulaSpawns: this.spatulaSpawns, overview: this.overview || { cx: this.grid.w / 2, cy: this.grid.h * 0.6, cz: this.grid.d / 2, r: Math.max(this.grid.w, this.grid.d) * 0.55 } };
  }
}
export { PIECE };

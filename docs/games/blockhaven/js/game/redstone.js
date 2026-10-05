// Redstone, modelled on Java Edition's server logic so the same builds and timings work:
//  - 20 game ticks a second, run in the original's order each tick: scheduled block ticks
//    (sorted by time, priority, then scheduling order), block events (pistons, note blocks),
//    entity checks (pressure plates), then block entities (moving pistons, hoppers, sensors).
//  - Block updates go through the same depth-first neighbour updater as the original
//    (west, east, down, up, north, south), plus the separate "shape" updates observers see.
//  - Redstone wire keeps the original algorithm, including its order-of-updates quirks
//    (a Java HashSet walk), so locational behaviour matches too.
// Only the host (or a single player) simulates; everyone else receives the block changes.
import { B, BLOCKS, SOLID, OPAQUE, SHAPE_OF, SHAPE, props, VARIANT_MASK } from '../data/blocks.js?v=muum39sy';
import { timeOfDay, skyDarken } from './weather.js?v=muum39sy';
import { I, maxStack } from '../data/items.js?v=muum39sy';
import { UNLOADED, posKey } from '../world/world.js?v=muum39sy';
import { blockDrops } from './drops.js?v=muum39sy';
import { DIR6_OF_2D, DIR2D_OF_6, OPP6 } from '../data/orient.js?v=muum39sy';

// ---- directions (Java order) ----
const DOWN = 0, UP = 1, NORTH = 2, SOUTH = 3, WEST = 4, EAST = 5;
const DX = [0, 0, 0, 0, -1, 1], DY = [-1, 1, 0, 0, 0, 0], DZ = [0, 0, -1, 1, 0, 0];
const OPP = OPP6;
const UPDATE_ORDER = [WEST, EAST, DOWN, UP, NORTH, SOUTH];
const SHAPE_ORDER = [WEST, EAST, NORTH, SOUTH, DOWN, UP];
const ALL = [DOWN, UP, NORTH, SOUTH, WEST, EAST];
const HORIZ = [NORTH, EAST, SOUTH, WEST];
const H2D = DIR6_OF_2D;              // 2D facing (0 S, 1 W, 2 N, 3 E) -> direction
const D2 = DIR2D_OF_6;               // direction -> 2D facing
const CW2 = f => (f + 1) & 3;        // clockwise seen from above
const CCW2 = f => (f + 3) & 3;
// Tick priorities.
const EXTREMELY_HIGH = -3, VERY_HIGH = -2, HIGH = -1, NORMAL = 0;
// setBlock flags (as in the original).
const F_NEIGHBORS = 1, F_CLIENTS = 2, F_INVISIBLE = 4, F_KNOWN_SHAPE = 16, F_NO_DROPS = 32, F_MOVING = 64;

// ---- block kinds ----
const K = { WIRE: 1, TORCH: 2, REPEATER: 3, COMPARATOR: 4, LEVER: 5, BUTTON: 6, PLATE: 7, RBLOCK: 8, LAMP: 9, NOTE: 10, TARGET: 11, OBSERVER: 12, DAYLIGHT: 13, PISTON: 14, HEAD: 15, MOVING: 16, HOPPER: 17, DISPENSER: 18, TNT: 19, DOOR: 20, TRAPDOOR: 21 };
export const KIND = new Uint8Array(256);
const setKind = (key, k) => { if (B[key] !== undefined) KIND[B[key]] = k; };
setKind('REDSTONE_WIRE', K.WIRE); setKind('REDSTONE_TORCH', K.TORCH); setKind('REPEATER', K.REPEATER); setKind('COMPARATOR', K.COMPARATOR);
setKind('LEVER', K.LEVER); setKind('BUTTON', K.BUTTON); setKind('PRESSURE_PLATE', K.PLATE); setKind('REDSTONE_BLOCK', K.RBLOCK);
setKind('REDSTONE_LAMP', K.LAMP); setKind('NOTE_BLOCK', K.NOTE); setKind('TARGET', K.TARGET); setKind('OBSERVER', K.OBSERVER);
setKind('DAYLIGHT_DETECTOR', K.DAYLIGHT); setKind('PISTON', K.PISTON); setKind('PISTON_HEAD', K.HEAD); setKind('MOVING_PISTON', K.MOVING);
setKind('HOPPER', K.HOPPER); setKind('DISPENSER', K.DISPENSER); setKind('DROPPER', K.DISPENSER); setKind('TNT', K.TNT); setKind('DOOR', K.DOOR); setKind('TRAPDOOR', K.TRAPDOOR);
const SOURCE = new Uint8Array(256);
for (const k of [K.WIRE, K.TORCH, K.REPEATER, K.COMPARATOR, K.LEVER, K.BUTTON, K.PLATE, K.RBLOCK, K.OBSERVER, K.DAYLIGHT, K.TARGET]) for (let id = 0; id < 256; id++) if (KIND[id] === k) SOURCE[id] = 1;
// Solid, opaque, full blocks conduct power; a few full blocks deliberately do not.
const CONDUCT = new Uint8Array(256);
for (let id = 0; id < 256; id++) CONDUCT[id] = OPAQUE[id];
for (const k of ['REDSTONE_BLOCK', 'OBSERVER']) if (B[k] !== undefined) CONDUCT[B[k]] = 0;
// Blocks with a comparator reading.
const ANALOG = new Uint8Array(256);
for (const k of ['CHEST', 'FURNACE', 'HOPPER', 'DISPENSER', 'DROPPER', 'END_PORTAL_FRAME', 'MISC']) if (B[k] !== undefined) ANALOG[B[k]] = 1;
// Piston push reactions: 0 normal, 1 destroy, 2 block.
const PUSH = new Uint8Array(256);
for (let id = 0; id < 256; id++) {
  const b = BLOCKS[id];
  if (!b) continue;
  const sh = b.shape;
  if ([SHAPE.CROSS, SHAPE.CROP, SHAPE.TORCH, SHAPE.DUST, SHAPE.DIODE, SHAPE.LEVER, SHAPE.BUTTON, SHAPE.PLATE, SHAPE.FIRE, SHAPE.VINE, SHAPE.LADDER,
    SHAPE.DOOR, SHAPE.BED, SHAPE.CARPET, SHAPE.SNOW, SHAPE.CACTUS, SHAPE.LANTERN, SHAPE.SKULL, SHAPE.LIQUID, SHAPE.FLAT].includes(sh)) PUSH[id] = 1;
  if (b.hardness === Infinity) PUSH[id] = 2;
}
for (const k of ['PUMPKIN', 'MELON', 'DRAGON_EGG', 'CHORUS', 'BAMBOO', 'SWEET_BERRY_BUSH', 'CAVE_VINES', 'GLOW_LICHEN']) if (B[k] !== undefined) PUSH[B[k]] = 1;
// Blocks with block entities never move.
for (const k of ['CHEST', 'FURNACE', 'SPAWNER', 'HOPPER', 'DISPENSER', 'DROPPER', 'DAYLIGHT_DETECTOR', 'CAMPFIRE', 'OBSIDIAN', 'MOVING_PISTON', 'PISTON_HEAD', 'BEDROCK', 'END_PORTAL_FRAME'])
  if (B[k] !== undefined) PUSH[B[k]] = 2;
PUSH[B.COMPARATOR] = 1;
const MISC_BE = new Set(['barrel', 'jukebox']);

// ---- positions ----
const OFF = 2097152;
const pk = (x, y, z) => ((x + OFF) * 4194304 + (z + OFF)) * 256 + y;
// Java's BlockPos.hashCode + HashMap spreading, for walking hash sets in the original's order.
const jhash = (x, y, z) => { const h = (Math.imul((y + Math.imul(z, 31)) | 0, 31) + x) | 0; return h ^ (h >>> 16); };
function javaHashOrder(list, n = list.length) {
  let cap = 16;
  while (n > cap * 0.75) cap *= 2;
  const m = cap - 1, len = list.length;
  const keys = HASH_KEYS.length >= len ? HASH_KEYS : (HASH_KEYS = new Int32Array(len * 2));
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const p = list[i], k = ((jhash(p[0], p[1], p[2]) & m) << 12) | i;
    let j = i - 1;
    while (j >= 0 && keys[j] > k) { keys[j + 1] = keys[j]; out[j + 1] = out[j]; j--; }
    keys[j + 1] = k; out[j + 1] = p;
  }
  return out;
}
let HASH_KEYS = new Int32Array(64);

// ---- binary heap for scheduled ticks ----
const tickLess = (a, b) => a.t !== b.t ? a.t < b.t : a.p !== b.p ? a.p < b.p : a.o < b.o;
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(v) { const a = this.a; a.push(v); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!tickLess(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && tickLess(a[l], a[m])) m = l; if (r < a.length && tickLess(a[r], a[m])) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; }
    }
    return top;
  }
}

const ID = s => s & 255;
const M = s => s >> 8;
const S = (id, m) => id | (m << 8);
const AIR = 0;
const MAX_UPDATES = 1000000;

export class Redstone {
  constructor(game) {
    this.g = game;
    this.reset();
  }
  reset() {
    this.gameTime = 0; this.acc = 0; this.alpha = 0;
    this.heap = new Heap(); this.pending = new Map(); this.running = new Map(); this.order = 0;
    this.events = []; this.eventKeys = new Set();
    this.stack = []; this.added = []; this.count = 0;
    this.tickers = []; this.newTickers = [];
    this.moving = new Set(); // keys of blocks in motion, for drawing
    this.toggles = [];
    this.shouldSignal = true;
    this.selfSet = 0; this.handlingTick = false;
    this.cmap = new Map(); this.cgen = -1; this.lc = null; this.lcx = 0; this.lcz = 0; this.cslot = new Array(16).fill(null);
  }
  get w() { return this.g.world; }
  get enabled() { const n = this.g.net; return !n || n.isHost; }

  // ---------------- world access ----------------
  // Block reads dominate the cost of redstone (the original's wire algorithm reads a lot), so
  // they go through a one-chunk cache, then a numeric map, before the world's own lookup.
  lookup(cx, cz) {
    const w = this.g.world;
    if (this.cgen !== w.chunkGen) { this.cmap.clear(); this.cslot.fill(null); this.cgen = w.chunkGen; }
    // A small direct-mapped cache (4x4 chunks) in front of a numeric map.
    const slot = ((cx & 3) << 2) | (cz & 3);
    let c = this.cslot[slot];
    if (c === null || c.cx !== cx || c.cz !== cz || c.dead) {
      const k = (cx + 262144) * 524288 + (cz + 262144);
      c = this.cmap.get(k);
      if (c === undefined || c.dead) { c = w.chunks.get(`${cx},${cz}`); if (!c || !c.ids) return null; this.cmap.set(k, c); }
      this.cslot[slot] = c;
    }
    this.lcx = cx; this.lcz = cz; this.lc = c;
    return c;
  }
  chunkOf(x, z) { const cx = x >> 4, cz = z >> 4, c = this.lc; return c !== null && cx === this.lcx && cz === this.lcz && !c.dead ? c : this.lookup(cx, cz); }
  // Packed state (id | meta << 8); -1 where the chunk isn't loaded.
  get(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y > 255) return AIR;
    const cx = x >> 4, cz = z >> 4;
    let c = this.lc;
    if (c === null || cx !== this.lcx || cz !== this.lcz || c.dead) { c = this.lookup(cx, cz); if (c === null) return -1; }
    const i = (x & 15) | ((z & 15) << 4) | (y << 8);
    return c.ids[i] | (c.meta[i] << 8);
  }
  loaded(x, z) { return !!this.chunkOf(x, z); }
  be(x, y, z) { return this.w.blockEntities.get(posKey(x, y, z)); }

  // Sets a block like the original's Level.setBlock: onRemove/onPlace, then neighbour updates
  // (flag 1) and shape updates (unless flag 16). Returns false if nothing changed.
  setBlock(x, y, z, s, flags = 3, rec = 512) {
    const old = this.get(x, y, z);
    if (old < 0 || old === s || y < 0 || y > 255) return false;
    this.selfSet++;
    try { this.w.setBlock(x, y, z, ID(s), M(s)); } finally { this.selfSet--; }
    const moving = (flags & F_MOVING) !== 0;
    this.onRemove(x, y, z, old, s, moving);
    this.onPlace(x, y, z, s, old, moving);
    if (this.get(x, y, z) !== s) return true;
    if (flags & F_NEIGHBORS) {
      this.updateNeighborsAt(x, y, z, ID(old));
      if (ANALOG[ID(s)]) this.updateNeighbourForOutputSignal(x, y, z);
    }
    if (!(flags & F_KNOWN_SHAPE) && rec > 0) {
      const f2 = flags & ~34;
      this.updateIndirectNeighbourShapes(x, y, z, old, f2, rec - 1);
      this.updateNeighbourShapes(x, y, z, s, f2, rec - 1);
      this.updateIndirectNeighbourShapes(x, y, z, s, f2, rec - 1);
    }
    return true;
  }
  removeBlock(x, y, z) { return this.setBlock(x, y, z, AIR, 3); }
  // Breaks a block with drops and effects (Level.destroyBlock).
  destroyBlock(x, y, z, drop = true, rec = 512) {
    const s = this.get(x, y, z);
    if (s <= 0) return false;
    const g = this.g, id = ID(s), m = M(s);
    if (id !== B.FIRE && SHAPE_OF[id] !== SHAPE.LIQUID) { g.particles.block(x, y, z, id, m, 12); g.sound.dig(props(id, m).sound, [x + 0.5, y + 0.5, z + 0.5]); }
    if (drop) this.dropResources(x, y, z, s);
    return this.setBlock(x, y, z, AIR, 3, rec);
  }
  dropResources(x, y, z, s) {
    const g = this.g;
    if (!g.rules.doTileDrops) return;
    const { items } = blockDrops(ID(s), M(s), null);
    for (const it of items) g.dropItem(x + 0.5, y + 0.3, z + 0.5, it);
    const be = this.be(x, y, z);
    if (be && be.items) for (const it of be.items) if (it) g.dropItem(x + 0.5, y + 0.5, z + 0.5, it);
  }

  // ---------------- neighbour updates (the original's CollectingNeighborUpdater) ----------------
  addAndRun(u) {
    const nested = this.count > 0, over = this.count >= MAX_UPDATES;
    this.count++;
    if (!over) { if (nested) this.added.push(u); else this.stack.push(u); }
    if (!nested) this.runUpdates();
  }
  runUpdates() {
    const st = this.stack, added = this.added;
    try {
      while (st.length || added.length) {
        for (let i = added.length - 1; i >= 0; i--) st.push(added[i]);
        added.length = 0;
        const u = st[st.length - 1];
        while (!added.length) { if (!this.runNext(u)) { st.pop(); break; } }
      }
    } finally { st.length = 0; added.length = 0; this.count = 0; }
  }
  runNext(u) {
    switch (u.t) {
      case 0: this.neighborChanged(u.x, u.y, u.z, u.b, u.fx, u.fy, u.fz); return false;
      case 1: {
        const d = UPDATE_ORDER[u.i++];
        this.neighborChanged(u.x + DX[d], u.y + DY[d], u.z + DZ[d], u.b, u.x, u.y, u.z);
        if (u.i < 6 && UPDATE_ORDER[u.i] === u.skip) u.i++;
        return u.i < 6;
      }
      default: { // shape update
        const cur = this.get(u.x, u.y, u.z);
        if (cur < 0) return false;
        const nw = this.updateShape(u.x, u.y, u.z, cur, u.d, u.s, u.nx, u.ny, u.nz);
        this.updateOrDestroy(u.x, u.y, u.z, cur, nw, u.f, u.r);
        return false;
      }
    }
  }
  neighborChangedAt(x, y, z, block, fx, fy, fz) { this.addAndRun({ t: 0, x, y, z, b: block, fx, fy, fz }); }
  updateNeighborsAt(x, y, z, block) { this.addAndRun({ t: 1, x, y, z, b: block, skip: -1, i: 0 }); }
  updateNeighborsAtExcept(x, y, z, block, skip) { this.addAndRun({ t: 1, x, y, z, b: block, skip, i: UPDATE_ORDER[0] === skip ? 1 : 0 }); }
  // Neighbour at (x,y,z)+d is told this block (state s) changed.
  shapeUpdate(d, s, x, y, z, nx, ny, nz, f, r) { this.addAndRun({ t: 2, d, s, x, y, z, nx, ny, nz, f, r }); }
  updateNeighbourShapes(x, y, z, s, flags, rec) {
    for (const d of SHAPE_ORDER) this.shapeUpdate(OPP[d], s, x + DX[d], y + DY[d], z + DZ[d], x, y, z, flags, rec);
  }
  updateOrDestroy(x, y, z, old, nw, flags, rec) {
    if (nw === old) return;
    if (ID(nw) === AIR && ID(old) !== AIR) this.destroyBlock(x, y, z, !(flags & F_NO_DROPS), rec);
    else this.setBlock(x, y, z, nw, flags & ~F_NO_DROPS, rec);
  }
  // Comparators next to (or behind a block next to) a container re-read it.
  updateNeighbourForOutputSignal(x, y, z) {
    for (const d of HORIZ) {
      let nx = x + DX[d], nz = z + DZ[d];
      let s = this.get(nx, y, nz);
      if (s < 0) continue;
      if (KIND[ID(s)] === K.COMPARATOR) this.neighborChanged(nx, y, nz, ID(this.get(x, y, z)), x, y, z);
      else if (this.isConductor(s)) {
        nx += DX[d]; nz += DZ[d]; s = this.get(nx, y, nz);
        if (s >= 0 && KIND[ID(s)] === K.COMPARATOR) this.neighborChanged(nx, y, nz, ID(this.get(x, y, z)), x, y, z);
      }
    }
  }

  // ---------------- signals ----------------
  isConductor(s) {
    if (s < 0) return false;
    const id = ID(s);
    if (SHAPE_OF[id] === SHAPE.SLAB) return ((M(s) >> 4) & 3) === 2;
    return CONDUCT[id] === 1;
  }
  // Weak power the block at (x,y,z) sends to a neighbour; d points from that neighbour to it.
  getSignal(s, x, y, z, d) {
    if (s < 0) return 0;
    const id = ID(s);
    if (!SOURCE[id]) return 0;
    const m = M(s);
    switch (KIND[id]) {
      case K.WIRE: {
        if (!this.shouldSignal || d === DOWN) return 0;
        const p = m & 15;
        if (!p) return 0;
        return d === UP || ((m >> 4) >> D2[OPP[d]]) & 1 ? p : 0;
      }
      case K.TORCH: {
        if (m & 1) return 0;
        const a = (m >> 1) & 7;
        return a === 0 ? (d !== UP ? 15 : 0) : (d !== H2D[(a + 1) & 3] ? 15 : 0);
      }
      case K.REPEATER: return (m & 16) && H2D[m & 3] === d ? 15 : 0;
      case K.COMPARATOR: return (m & 8) && H2D[m & 3] === d ? this.compOut(x, y, z) : 0;
      case K.LEVER: return m & 16 ? 15 : 0;
      case K.BUTTON: return m & 128 ? 15 : 0;
      case K.PLATE: return (m >> 2) & 15;
      case K.RBLOCK: return 15;
      case K.OBSERVER: return (m & 8) && (m & 7) === d ? 15 : 0;
      case K.DAYLIGHT: case K.TARGET: return m & 15;
      default: return 0;
    }
  }
  // Strong power into the block the signal goes to.
  getDirectSignal(s, x, y, z, d) {
    if (s < 0) return 0;
    const id = ID(s), m = M(s);
    switch (KIND[id]) {
      case K.WIRE: return this.shouldSignal ? this.getSignal(s, x, y, z, d) : 0;
      case K.TORCH: return d === DOWN ? this.getSignal(s, x, y, z, d) : 0;
      case K.REPEATER: case K.COMPARATOR: case K.OBSERVER: return this.getSignal(s, x, y, z, d);
      case K.LEVER: return m & 16 && this.attachedDir(m & 3, (m >> 2) & 3) === d ? 15 : 0;
      case K.BUTTON: return m & 128 && this.attachedDir((m >> 3) & 3, (m >> 5) & 3) === d ? 15 : 0;
      case K.PLATE: return d === UP ? (m >> 2) & 15 : 0;
      default: return 0;
    }
  }
  // Direction from a lever/button's support block towards it.
  attachedDir(face, f) { return face === 0 ? UP : face === 2 ? DOWN : H2D[f]; }
  // Level.getSignal: power reaching a receiver from (x,y,z), including strong power through a conductor.
  signalAt(x, y, z, d) {
    const s = this.get(x, y, z);
    const i = this.getSignal(s, x, y, z, d);
    return this.isConductor(s) ? Math.max(i, this.directSignalTo(x, y, z)) : i;
  }
  directSignalTo(x, y, z) {
    let i = 0;
    for (const d of ALL) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      const v = this.getDirectSignal(this.get(nx, ny, nz), nx, ny, nz, d);
      if (v > i) { i = v; if (i >= 15) return i; }
    }
    return i;
  }
  directSignalFrom(x, y, z, d) { return this.getDirectSignal(this.get(x, y, z), x, y, z, d); }
  hasSignal(x, y, z, d) { return this.signalAt(x, y, z, d) > 0; }
  hasNeighborSignal(x, y, z) {
    for (const d of ALL) if (this.signalAt(x + DX[d], y + DY[d], z + DZ[d], d) > 0) return true;
    return false;
  }
  bestNeighborSignal(x, y, z) {
    let i = 0;
    for (const d of ALL) { const v = this.signalAt(x + DX[d], y + DY[d], z + DZ[d], d); if (v > i) { i = v; if (i >= 15) return 15; } }
    return i;
  }

  // ---------------- support ----------------
  sturdy(s, d) {
    if (s < 0) return false;
    const id = ID(s), m = M(s);
    switch (SHAPE_OF[id]) {
      case SHAPE.CUBE: return SOLID[id] === 1;
      case SHAPE.DIRCUBE: return true;
      case SHAPE.SLAB: { const t = (m >> 4) & 3; return t === 2 || (t === 1 && d === UP) || (t === 0 && d === DOWN); }
      case SHAPE.STAIRS: { const up = (m >> 6) & 1; return d === UP ? !!up : d === DOWN ? !up : d === H2D[(m >> 4) & 3]; }
      case SHAPE.PISTON: return !(m & 16) || d !== ((m >> 1) & 7);
      case SHAPE.PISTON_HEAD: return d === ((m >> 1) & 7);
      case SHAPE.DIODE: case SHAPE.DAYLIGHT: case SHAPE.FARMLAND: return d === DOWN;
      case SHAPE.SNOW: return (m & 7) === 7;
      default: return false;
    }
  }
  canSupportCenter(s) { return s >= 0 && (this.sturdy(s, UP) || SHAPE_OF[ID(s)] === SHAPE.FENCE || ID(s) === B.HOPPER); }
  canSurvive(x, y, z, s) {
    const id = ID(s), m = M(s);
    switch (KIND[id]) {
      case K.WIRE: { const b = this.get(x, y - 1, z); return this.sturdy(b, UP) || ID(b) === B.HOPPER; }
      case K.REPEATER: case K.COMPARATOR: return this.sturdy(this.get(x, y - 1, z), UP);
      case K.PLATE: return this.canSupportCenter(this.get(x, y - 1, z));
      case K.TORCH: {
        const a = (m >> 1) & 7;
        if (!a) return this.canSupportCenter(this.get(x, y - 1, z));
        const f = H2D[(a + 1) & 3], sx = x - DX[f], sz = z - DZ[f];
        return this.sturdy(this.get(sx, y, sz), f);
      }
      case K.LEVER: case K.BUTTON: {
        const face = KIND[id] === K.LEVER ? m & 3 : (m >> 3) & 3, f = KIND[id] === K.LEVER ? (m >> 2) & 3 : (m >> 5) & 3;
        const cd = this.attachedDir(face, f);
        return this.sturdy(this.get(x - DX[cd], y - DY[cd], z - DZ[cd]), cd);
      }
      default: return true;
    }
  }

  // ---------------- per-block behaviour ----------------
  neighborChanged(x, y, z, block, fx, fy, fz) {
    const s = this.get(x, y, z);
    if (s <= 0) return;
    const id = ID(s), m = M(s);
    switch (KIND[id]) {
      case K.WIRE:
        if (this.canSurvive(x, y, z, s)) this.wireUpdatePower(x, y, z, s);
        else { this.dropResources(x, y, z, s); this.removeBlock(x, y, z); }
        return;
      case K.TORCH:
        if (((m & 1) === 0) === this.torchPowered(x, y, z, m) && !this.willTickThisTick(x, y, z, id)) this.schedule(x, y, z, id, 2);
        return;
      case K.REPEATER: case K.COMPARATOR:
        if (this.canSurvive(x, y, z, s)) this.diodeCheckTick(x, y, z, s);
        else { this.dropResources(x, y, z, s); this.removeBlock(x, y, z); for (const d of ALL) this.updateNeighborsAt(x + DX[d], y + DY[d], z + DZ[d], id); }
        return;
      case K.LAMP: {
        const lit = (m & 1) === 1;
        if (lit !== this.hasNeighborSignal(x, y, z)) { if (lit) this.schedule(x, y, z, id, 4); else this.setBlock(x, y, z, S(id, 1), 2); }
        return;
      }
      case K.NOTE: {
        const p = this.hasNeighborSignal(x, y, z);
        if (p !== !!(m & 32)) { if (p) this.playNote(x, y, z); this.setBlock(x, y, z, S(id, p ? m | 32 : m & ~32), 3); }
        return;
      }
      case K.PISTON: this.pistonCheck(x, y, z, s); return;
      case K.HEAD: {
        const d = (m >> 1) & 7;
        if (this.headCanSurvive(x, y, z, s)) this.neighborChangedAt(x - DX[d], y - DY[d], z - DZ[d], block, fx, fy, fz);
        return;
      }
      case K.HOPPER: {
        const enabled = !this.hasNeighborSignal(x, y, z);
        if (enabled === !!(m & 8)) this.setBlock(x, y, z, S(id, enabled ? m & ~8 : m | 8), 2);
        return;
      }
      case K.DISPENSER: {
        const p = this.hasNeighborSignal(x, y, z) || this.hasNeighborSignal(x, y + 1, z), trig = (m & 8) !== 0;
        if (p && !trig) { this.schedule(x, y, z, id, 4); this.setBlock(x, y, z, S(id, m | 8), 2); }
        else if (!p && trig) this.setBlock(x, y, z, S(id, m & ~8), 2);
        return;
      }
      case K.TNT: if (this.hasNeighborSignal(x, y, z)) this.primeTnt(x, y, z); return;
      case K.DOOR: {
        const upper = (m >> 6) & 1, oy = upper ? y - 1 : y + 1;
        const p = this.hasNeighborSignal(x, y, z) || this.hasNeighborSignal(x, oy, z);
        if (p !== !!(m & 128)) {
          const open = p ? 32 : 0;
          if (!!(m & 32) !== p) this.g.sound.play(p ? 'door_open' : 'door_close', [x + 0.5, y + 0.5, z + 0.5], 0.7);
          this.setBlock(x, y, z, S(id, (m & ~(32 | 128)) | open | (p ? 128 : 0)), 2);
          const os = this.get(x, oy, z);
          if (ID(os) === id) this.setBlock(x, oy, z, S(id, (M(os) & ~(32 | 128)) | open | (p ? 128 : 0)), 2);
        }
        return;
      }
      case K.TRAPDOOR: {
        const p = this.hasNeighborSignal(x, y, z);
        if (p !== !!(m & 128)) {
          let nm = m;
          if (!!(m & 32) !== p) { nm = p ? nm | 32 : nm & ~32; this.g.sound.play(p ? 'door_open' : 'door_close', [x + 0.5, y + 0.5, z + 0.5], 0.7); }
          this.setBlock(x, y, z, S(id, p ? nm | 128 : nm & ~128), 2);
        }
        return;
      }
      default: return;
    }
  }
  // Shape updates: returns the block's new state given a changed neighbour in direction d.
  updateShape(x, y, z, s, d, ns, nx, ny, nz) {
    const id = ID(s), m = M(s);
    switch (KIND[id]) {
      case K.WIRE:
        if (d === DOWN) return s;
        if (d === UP) return this.wireConnectionState(x, y, z, s);
        {
          const side = this.wireSide(x, y, z, d, !this.isConductor(this.get(x, y + 1, z)));
          const cur = ((m >> 4) >> D2[d]) & 1;
          if (side === cur && (m >> 4) !== 15) return S(id, side ? m | (16 << D2[d]) : m & ~(16 << D2[d]));
          return this.wireConnectionState(x, y, z, S(id, (m & 15) | (15 << 4)));
        }
      case K.TORCH: {
        const a = (m >> 1) & 7;
        const support = a === 0 ? DOWN : OPP[H2D[(a + 1) & 3]];
        return d === support && !this.canSurvive(x, y, z, s) ? AIR : s;
      }
      case K.REPEATER:
        if (d === DOWN && !this.sturdy(ns, UP)) return AIR;
        if (d !== UP && d !== DOWN && D2[d] !== (m & 3) && D2[d] !== ((m + 2) & 3)) return S(id, this.repeaterLocked(x, y, z, m) ? m | 32 : m & ~32);
        return s;
      case K.COMPARATOR: return d === DOWN && !this.sturdy(ns, UP) ? AIR : s;
      case K.PLATE: return d === DOWN && !this.canSurvive(x, y, z, s) ? AIR : s;
      case K.LEVER: case K.BUTTON: {
        const lever = KIND[id] === K.LEVER;
        const cd = this.attachedDir(lever ? m & 3 : (m >> 3) & 3, lever ? (m >> 2) & 3 : (m >> 5) & 3);
        return OPP[cd] === d && !this.canSurvive(x, y, z, s) ? AIR : s;
      }
      case K.OBSERVER:
        if ((m & 7) === d && !(m & 8) && !this.hasScheduled(x, y, z, id)) this.schedule(x, y, z, id, 2);
        return s;
      case K.HEAD: return OPP[(m >> 1) & 7] === d && !this.headCanSurvive(x, y, z, s) ? AIR : s;
      default: return s;
    }
  }
  updateIndirectNeighbourShapes(x, y, z, s, flags, rec) {
    if (s < 0 || KIND[ID(s)] !== K.WIRE) return;
    const mask = M(s) >> 4;
    for (const d of HORIZ) {
      if (!((mask >> D2[d]) & 1)) continue;
      const ax = x + DX[d], az = z + DZ[d];
      if (ID(this.get(ax, y, az)) === B.REDSTONE_WIRE) continue;
      for (const dy of [-1, 1]) {
        if (ID(this.get(ax, y + dy, az)) === B.REDSTONE_WIRE) {
          const bx = ax - DX[d], bz = az - DZ[d];
          this.shapeUpdate(OPP[d], this.get(bx, y + dy, bz), ax, y + dy, az, bx, y + dy, bz, flags, rec);
        }
      }
    }
  }
  onPlace(x, y, z, s, old, moving) {
    const id = ID(s), m = M(s), same = ID(old) === id;
    switch (KIND[id]) {
      case K.WIRE:
        if (!same) {
          this.wireUpdatePower(x, y, z, s);
          for (const d of [UP, DOWN]) this.updateNeighborsAt(x + DX[d], y + DY[d], z + DZ[d], id);
          this.wireUpdateNeighbouringWires(x, y, z);
        }
        return;
      case K.TORCH: for (const d of ALL) this.updateNeighborsAt(x + DX[d], y + DY[d], z + DZ[d], id); return;
      case K.REPEATER: case K.COMPARATOR:
        if (KIND[id] === K.COMPARATOR && !same) this.ensureBE(x, y, z, { type: 'comparator', out: 0 });
        this.diodeUpdateFront(x, y, z, m, id); return;
      case K.OBSERVER:
        if (!same && (m & 8) && !this.hasScheduled(x, y, z, id)) { const ns = S(id, m & ~8); this.setBlock(x, y, z, ns, 18); this.observerUpdateFront(x, y, z, m & ~8, id); }
        return;
      case K.PISTON: if (!same && !this.be(x, y, z)) this.pistonCheck(x, y, z, s); return;
      case K.TARGET: if (!same && (m & 15) && !this.hasScheduled(x, y, z, id)) this.setBlock(x, y, z, S(id, 0), 18); return;
      case K.TNT: if (!same && this.hasNeighborSignal(x, y, z)) this.primeTnt(x, y, z); return;
      case K.HOPPER: if (!same) { this.ensureBE(x, y, z, { type: 'hopper', items: [] }, true); this.neighborChanged(x, y, z, id, x, y, z); } return;
      case K.DAYLIGHT: if (!same) this.ensureBE(x, y, z, { type: 'daylight' }, true); return;
      case K.DISPENSER: if (!same) this.ensureBE(x, y, z, { type: 'chest', items: [] }); return;
      default: return;
    }
  }
  onRemove(x, y, z, s, ns, moving) {
    if (s < 0) return;
    const id = ID(s), m = M(s), same = ID(ns) === id;
    switch (KIND[id]) {
      case K.WIRE:
        if (!moving && !same) {
          for (const d of ALL) this.updateNeighborsAt(x + DX[d], y + DY[d], z + DZ[d], id);
          this.wireUpdatePower(x, y, z, s);
          this.wireUpdateNeighbouringWires(x, y, z);
        }
        return;
      case K.TORCH: if (!moving) for (const d of ALL) this.updateNeighborsAt(x + DX[d], y + DY[d], z + DZ[d], id); return;
      case K.REPEATER: case K.COMPARATOR: if (!moving && !same) this.diodeUpdateFront(x, y, z, m, id); return;
      case K.LEVER: if (!moving && !same && (m & 16)) this.faceUpdate(x, y, z, m & 3, (m >> 2) & 3, id); return;
      case K.BUTTON: if (!moving && !same && (m & 128)) this.faceUpdate(x, y, z, (m >> 3) & 3, (m >> 5) & 3, id); return;
      case K.PLATE: if (!moving && !same && ((m >> 2) & 15)) { this.updateNeighborsAt(x, y, z, id); this.updateNeighborsAt(x, y - 1, z, id); } return;
      case K.OBSERVER: if (!same && (m & 8) && this.hasScheduled(x, y, z, id)) this.observerUpdateFront(x, y, z, m & ~8, id); return;
      case K.HEAD:
        if (!same) {
          const d = (m >> 1) & 7, bx = x - DX[d], by = y - DY[d], bz = z - DZ[d];
          if (this.isFittingBase(s, this.get(bx, by, bz))) this.destroyBlock(bx, by, bz, true);
        }
        return;
      default: return;
    }
  }
  ensureBE(x, y, z, data, ticking = false) {
    const k = posKey(x, y, z);
    let be = this.w.blockEntities.get(k);
    if (!be) { be = { ...data, x, y, z }; this.w.blockEntities.set(k, be); }
    if (ticking) this.addTicker(be);
    return be;
  }
  addTicker(be) { if (!be.ticking) { Object.defineProperty(be, 'ticking', { value: true, writable: true, enumerable: false, configurable: true }); this.newTickers.push(be); } }

  // ---------------- redstone wire ----------------
  shouldConnectTo(s, d) {
    if (s < 0) return false;
    const id = ID(s);
    const k = KIND[id];
    if (k === K.WIRE) return true;
    if (k === K.REPEATER) { if (d < 0) return false; const f = H2D[M(s) & 3]; return f === d || OPP[f] === d; }
    if (k === K.OBSERVER) return d >= 0 && (M(s) & 7) === d;
    return SOURCE[id] === 1 && d >= 0;
  }
  // Connection towards horizontal d: 0 none, 1 side (or up).
  wireSide(x, y, z, d, openAbove) {
    const nx = x + DX[d], nz = z + DZ[d], n = this.get(nx, y, nz);
    if (openAbove) {
      const onTop = ID(n) === B.TRAPDOOR || this.sturdy(n, UP) || ID(n) === B.HOPPER;
      if (onTop && this.shouldConnectTo(this.get(nx, y + 1, nz), -1)) return 1;
    }
    return !this.shouldConnectTo(n, d) && (this.isConductor(n) || !this.shouldConnectTo(this.get(nx, y - 1, nz), -1)) ? 0 : 1;
  }
  wireConnectionState(x, y, z, s) {
    const m = M(s), dot = (m >> 4) === 0;
    const open = !this.isConductor(this.get(x, y + 1, z));
    let mask = 0;
    for (const d of HORIZ) if (this.wireSide(x, y, z, d, open)) mask |= 1 << D2[d];
    if (dot && mask === 0) return S(ID(s), m & 15);
    const n = mask & 4, so = mask & 1, e = mask & 8, w = mask & 2;
    const nsNone = !n && !so, ewNone = !e && !w;
    if (!w && nsNone) mask |= 2;
    if (!e && nsNone) mask |= 8;
    if (!n && ewNone) mask |= 4;
    if (!so && ewNone) mask |= 1;
    return S(ID(s), (m & 15) | (mask << 4));
  }
  wireSignalOf(s) { return s >= 0 && KIND[ID(s)] === K.WIRE ? M(s) & 15 : 0; }
  wireTargetStrength(x, y, z) {
    this.shouldSignal = false;
    const i = this.bestNeighborSignal(x, y, z);
    this.shouldSignal = true;
    let j = 0;
    if (i < 15) {
      const aboveConductor = this.isConductor(this.get(x, y + 1, z));
      for (const d of HORIZ) {
        const nx = x + DX[d], nz = z + DZ[d], n = this.get(nx, y, nz);
        j = Math.max(j, this.wireSignalOf(n));
        if (this.isConductor(n) && !aboveConductor) j = Math.max(j, this.wireSignalOf(this.get(nx, y + 1, nz)));
        else if (!this.isConductor(n)) j = Math.max(j, this.wireSignalOf(this.get(nx, y - 1, nz)));
      }
    }
    return Math.max(i, j - 1);
  }
  // s is the wire's state (on removal, the state it had).
  wireUpdatePower(x, y, z, s) {
    const i = this.wireTargetStrength(x, y, z);
    if ((M(s) & 15) === i) return;
    if (this.get(x, y, z) === s) this.setBlock(x, y, z, S(ID(s), (M(s) & ~15) | i), 2);
    const set = [[x, y, z]];
    for (const d of ALL) set.push([x + DX[d], y + DY[d], z + DZ[d]]);
    for (const p of javaHashOrder(set)) this.updateNeighborsAt(p[0], p[1], p[2], B.REDSTONE_WIRE);
  }
  wireCheckCorner(x, y, z) {
    if (ID(this.get(x, y, z)) !== B.REDSTONE_WIRE) return;
    this.updateNeighborsAt(x, y, z, B.REDSTONE_WIRE);
    for (const d of ALL) this.updateNeighborsAt(x + DX[d], y + DY[d], z + DZ[d], B.REDSTONE_WIRE);
  }
  wireUpdateNeighbouringWires(x, y, z) {
    for (const d of HORIZ) this.wireCheckCorner(x + DX[d], y, z + DZ[d]);
    for (const d of HORIZ) {
      const nx = x + DX[d], nz = z + DZ[d];
      if (this.isConductor(this.get(nx, y, nz))) this.wireCheckCorner(nx, y + 1, nz); else this.wireCheckCorner(nx, y - 1, nz);
    }
  }

  // ---------------- torches ----------------
  torchPowered(x, y, z, m) {
    const a = (m >> 1) & 7;
    if (!a) return this.hasSignal(x, y - 1, z, DOWN);
    const f = OPP[H2D[(a + 1) & 3]];
    return this.hasSignal(x + DX[f], y, z + DZ[f], f);
  }
  torchTick(x, y, z, s) {
    const id = ID(s), m = M(s), powered = this.torchPowered(x, y, z, m);
    const now = this.gameTime;
    while (this.toggles.length && now - this.toggles[0].t > 60) this.toggles.shift();
    if ((m & 1) === 0) {
      if (powered) {
        this.setBlock(x, y, z, S(id, m | 1), 3);
        if (this.toggledTooOften(x, y, z, true)) {
          this.g.sound.play('fizz', [x + 0.5, y + 0.5, z + 0.5], 0.5);
          this.g.particles.smoke([x + 0.5, y + 0.7, z + 0.5], 5);
          this.schedule(x, y, z, id, 160);
        }
      }
    } else if (!powered && !this.toggledTooOften(x, y, z, false)) this.setBlock(x, y, z, S(id, m & ~1), 3);
  }
  toggledTooOften(x, y, z, log) {
    const k = pk(x, y, z);
    if (log) this.toggles.push({ k, t: this.gameTime });
    let n = 0;
    for (const t of this.toggles) if (t.k === k && ++n >= 8) return true;
    return false;
  }

  // ---------------- repeaters & comparators ----------------
  diodeInput(x, y, z, m) {
    const d = H2D[m & 3], bx = x + DX[d], bz = z + DZ[d];
    const i = this.signalAt(bx, y, bz, d);
    if (i >= 15) return i;
    const b = this.get(bx, y, bz);
    return Math.max(i, this.wireSignalOf(b));
  }
  sideSignal(x, y, z, m, diodesOnly) {
    const f = m & 3;
    let best = 0;
    for (const side of [CW2(f), CCW2(f)]) {
      const d = H2D[side], nx = x + DX[d], nz = z + DZ[d], s = this.get(nx, y, nz);
      if (s < 0) continue;
      const k = KIND[ID(s)];
      const ok = diodesOnly ? k === K.REPEATER || k === K.COMPARATOR : SOURCE[ID(s)] === 1;
      if (!ok) continue;
      const v = k === K.RBLOCK ? 15 : k === K.WIRE ? M(s) & 15 : this.getDirectSignal(s, nx, y, nz, d);
      if (v > best) best = v;
    }
    return best;
  }
  repeaterLocked(x, y, z, m) { return this.sideSignal(x, y, z, m, true) > 0; }
  compOut(x, y, z) { const be = this.be(x, y, z); return be ? be.out | 0 : 0; }
  compInput(x, y, z, m) {
    let i = this.diodeInput(x, y, z, m);
    const d = H2D[m & 3];
    let bx = x + DX[d], bz = z + DZ[d];
    let b = this.get(bx, y, bz);
    if (b >= 0 && this.hasAnalog(b, bx, y, bz)) i = this.analogOf(b, bx, y, bz);
    else if (i < 15 && this.isConductor(b)) {
      bx += DX[d]; bz += DZ[d]; b = this.get(bx, y, bz);
      if (b >= 0 && this.hasAnalog(b, bx, y, bz)) i = this.analogOf(b, bx, y, bz);
    }
    return i;
  }
  compCalc(x, y, z, m) {
    const i = this.compInput(x, y, z, m);
    if (i === 0) return 0;
    const j = this.sideSignal(x, y, z, m, false);
    if (j > i) return 0;
    return m & 4 ? i - j : i;
  }
  compShouldTurnOn(x, y, z, m) {
    const i = this.compInput(x, y, z, m);
    if (i === 0) return false;
    const j = this.sideSignal(x, y, z, m, false);
    return i > j || (i === j && !(m & 4));
  }
  diodeShouldPrioritize(x, y, z, m) {
    const d = OPP[H2D[m & 3]], s = this.get(x + DX[d], y, z + DZ[d]);
    const k = s >= 0 ? KIND[ID(s)] : 0;
    return (k === K.REPEATER || k === K.COMPARATOR) && H2D[M(s) & 3] !== d;
  }
  diodeCheckTick(x, y, z, s) {
    const id = ID(s), m = M(s);
    if (KIND[id] === K.REPEATER) {
      if (this.repeaterLocked(x, y, z, m)) return;
      const powered = !!(m & 16), on = this.diodeInput(x, y, z, m) > 0;
      if (powered !== on && !this.willTickThisTick(x, y, z, id)) {
        const pri = this.diodeShouldPrioritize(x, y, z, m) ? EXTREMELY_HIGH : powered ? VERY_HIGH : HIGH;
        this.schedule(x, y, z, id, (((m >> 2) & 3) + 1) * 2, pri);
      }
    } else {
      if (this.willTickThisTick(x, y, z, id)) return;
      const i = this.compCalc(x, y, z, m), j = this.compOut(x, y, z);
      if (i !== j || !!(m & 8) !== this.compShouldTurnOn(x, y, z, m)) this.schedule(x, y, z, id, 2, this.diodeShouldPrioritize(x, y, z, m) ? HIGH : NORMAL);
    }
  }
  repeaterTick(x, y, z, s) {
    const id = ID(s), m = M(s);
    if (this.repeaterLocked(x, y, z, m)) return;
    const powered = !!(m & 16), on = this.diodeInput(x, y, z, m) > 0;
    if (powered && !on) this.setBlock(x, y, z, S(id, m & ~16), 2);
    else if (!powered) {
      this.setBlock(x, y, z, S(id, m | 16), 2);
      if (!on) this.schedule(x, y, z, id, (((m >> 2) & 3) + 1) * 2, VERY_HIGH);
    }
  }
  comparatorRefresh(x, y, z, s) {
    const id = ID(s), m = M(s);
    const i = this.compCalc(x, y, z, m);
    const be = this.ensureBE(x, y, z, { type: 'comparator', out: 0 });
    const j = be.out | 0;
    be.out = i;
    if (j !== i || !(m & 4)) {
      const on = this.compShouldTurnOn(x, y, z, m), powered = !!(m & 8);
      if (powered && !on) this.setBlock(x, y, z, S(id, m & ~8), 2);
      else if (!powered && on) this.setBlock(x, y, z, S(id, m | 8), 2);
      this.diodeUpdateFront(x, y, z, M(this.get(x, y, z)) | 0, id);
    }
  }
  diodeUpdateFront(x, y, z, m, id) {
    const d = H2D[m & 3], fx = x - DX[d], fz = z - DZ[d];
    this.neighborChangedAt(fx, y, fz, id, x, y, z);
    this.updateNeighborsAtExcept(fx, y, fz, id, d);
  }

  // ---------------- levers, buttons, plates ----------------
  faceUpdate(x, y, z, face, f, id) {
    const cd = this.attachedDir(face, f);
    this.updateNeighborsAt(x, y, z, id);
    this.updateNeighborsAt(x - DX[cd], y - DY[cd], z - DZ[cd], id);
  }
  buttonTicks(m) { const v = m & 7; return v === 0 || v === 7 ? 20 : 30; }
  buttonTick(x, y, z, s) {
    const id = ID(s), m = M(s);
    if (!(m & 128)) return;
    this.buttonCheckPressed(x, y, z, s);
  }
  buttonCheckPressed(x, y, z, s) {
    const id = ID(s), m = M(s), wood = (m & 7) !== 0 && (m & 7) !== 7;
    const arrow = wood && this.arrowIn(x, y, z, s);
    const powered = !!(m & 128);
    if (arrow !== powered) {
      this.setBlock(x, y, z, S(id, arrow ? m | 128 : m & ~128), 3);
      this.faceUpdate(x, y, z, (m >> 3) & 3, (m >> 5) & 3, id);
      this.click([x, y, z], arrow, wood);
    }
    if (arrow) this.schedule(x, y, z, id, this.buttonTicks(m));
  }
  arrowIn(x, y, z) {
    for (const e of this.g.entities.list) if ((e.kind === 'arrow' || e.kind === 'trident') && e.inGround && e.stuck && e.stuck[0] === x && e.stuck[1] === y && e.stuck[2] === z) return true;
    return false;
  }
  click(p, on, wood = false) { this.g.sound.play('rs_click', [p[0] + 0.5, p[1] + 0.5, p[2] + 0.5], 0.5, on ? (wood ? 0.9 : 1.2) : (wood ? 0.75 : 1)); }
  plateSignalStrength(x, y, z, m) {
    const v = m & 3;
    let n = 0;
    const x0 = x + 1 / 16, x1 = x + 15 / 16, z0 = z + 1 / 16, z1 = z + 15 / 16, y0 = y, y1 = y + 0.25;
    this.forEntities(e => {
      if (v === 0 && !e.isLiving) return;
      if (e.spectatorLike) return;
      const hw = e.hw || 0.3, h = e.h || 1.8, p = e.pos;
      if (p[0] + hw > x0 && p[0] - hw < x1 && p[2] + hw > z0 && p[2] - hw < z1 && p[1] + h > y0 && p[1] < y1) n++;
    });
    if (v === 2) return Math.min(n, 15);
    if (v === 3) return Math.ceil(Math.min(n, 150) / 10);
    return n > 0 ? 15 : 0;
  }
  plateCheckPressed(x, y, z, s, cur) {
    const id = ID(s), m = M(s), j = this.plateSignalStrength(x, y, z, m);
    if (cur !== j) {
      this.setBlock(x, y, z, S(id, (m & ~60) | (j << 2)), 2);
      this.updateNeighborsAt(x, y, z, id); this.updateNeighborsAt(x, y - 1, z, id);
    }
    if (!(j > 0) && cur > 0) this.click([x, y, z], false, (m & 3) === 1);
    else if (j > 0 && !(cur > 0)) this.click([x, y, z], true, (m & 3) === 1);
    if (j > 0) this.schedule(x, y, z, id, (m & 3) >= 2 ? 10 : 20);
  }
  forEntities(fn) {
    const g = this.g;
    if (g.alive && g.mode !== 'spectator') fn({ pos: g.player.pos, hw: 0.3, h: g.player.sneaking ? 1.5 : 1.8, isLiving: true });
    for (const e of g.entities.list) { if (e.dead || e.frozen || (e.remote && !e.visible)) continue; fn(e); }
  }
  // The original calls entityInside for every block an entity overlaps; plates and buttons care.
  entityTick() {
    const seen = this.seenPlates || (this.seenPlates = new Set());
    seen.clear();
    this.forEntities(e => {
      const p = e.pos, hw = e.hw || 0.3;
      const y = Math.floor(p[1]);
      for (let x = Math.floor(p[0] - hw); x <= Math.floor(p[0] + hw); x++) for (let z = Math.floor(p[2] - hw); z <= Math.floor(p[2] + hw); z++) {
        const s = this.get(x, y, z);
        if (s < 0 || KIND[ID(s)] !== K.PLATE) continue;
        const k = pk(x, y, z);
        if (seen.has(k)) continue;
        seen.add(k);
        const cur = (M(s) >> 2) & 15;
        if (cur === 0) this.plateCheckPressed(x, y, z, s, cur);
      }
    });
    for (const e of this.g.entities.list) {
      if (!e.inGround || !e.stuck) continue;
      const [x, y, z] = e.stuck, s = this.get(x, y, z);
      if (s >= 0 && KIND[ID(s)] === K.BUTTON && !(M(s) & 128)) this.buttonCheckPressed(x, y, z, s);
    }
  }

  // ---------------- lamps, notes, targets, TNT ----------------
  lampTick(x, y, z, s) { if ((M(s) & 1) && !this.hasNeighborSignal(x, y, z)) this.setBlock(x, y, z, S(ID(s), 0), 2); }
  playNote(x, y, z) { if (ID(this.get(x, y + 1, z)) === AIR) this.blockEvent(x, y, z, B.NOTE_BLOCK, 0, 0); }
  instrument(x, y, z) {
    const s = this.get(x, y - 1, z);
    if (s < 0) return 'harp';
    const p = props(ID(s), M(s)), key = p.key, b = BLOCKS[ID(s)];
    if (key === 'gold_block') return 'bell';
    if (key === 'clay') return 'flute';
    if (key === 'packed_ice') return 'chime';
    if (b.key === 'wool') return 'guitar';
    if (key === 'bone_block') return 'xylophone';
    if (key === 'iron_block') return 'iron_xylophone';
    if (key === 'soul_sand') return 'cow_bell';
    if (b.key === 'pumpkin') return 'didgeridoo';
    if (key === 'emerald_block') return 'bit';
    if (key === 'hay_block') return 'banjo';
    if (key === 'glowstone') return 'pling';
    if (b.key === 'sand' || b.key === 'gravel' || key === 'concrete_powder') return 'snare';
    if (b.key === 'glass' || b.key === 'stained_glass' || b.key === 'pane' || key === 'sea_lantern' || key === 'beacon') return 'hat';
    if (p.sound === 'wood' || b.flammable) return 'bass';
    if (p.tool === 'pickaxe' || p.sound === 'stone') return 'basedrum';
    return 'harp';
  }
  primeTnt(x, y, z) { this.selfSet++; try { this.g.igniteTnt(x, y, z); } finally { this.selfSet--; } this.afterExternal(x, y, z, AIR, S(B.TNT, 0)); }
  targetHit(x, y, z, hit, proj) {
    if (!this.enabled) return;
    const s = this.get(x, y, z);
    if (s < 0 || KIND[ID(s)] !== K.TARGET) return;
    const fx = Math.abs(hit[0] - (x + 0.5)), fy = Math.abs(hit[1] - (y + 0.5)), fz = Math.abs(hit[2] - (z + 0.5));
    const axes = [fx, fy, fz].sort((a, b) => b - a);
    const dist = axes[1];
    const power = Math.max(1, Math.ceil(15 * Math.max(0, Math.min(1, (0.5 - dist) / 0.5))));
    const dur = proj && (proj.kind === 'arrow' || proj.kind === 'trident') ? 20 : 8;
    if (!this.hasScheduled(x, y, z, ID(s))) { this.setBlock(x, y, z, S(ID(s), power), 3); this.schedule(x, y, z, ID(s), dur); }
  }
  targetTick(x, y, z, s) { if (M(s) & 15) this.setBlock(x, y, z, S(ID(s), 0), 3); }

  // ---------------- observers ----------------
  observerTick(x, y, z, s) {
    const id = ID(s), m = M(s);
    if (m & 8) this.setBlock(x, y, z, S(id, m & ~8), 2);
    else { this.setBlock(x, y, z, S(id, m | 8), 2); this.schedule(x, y, z, id, 2); }
    this.observerUpdateFront(x, y, z, M(this.get(x, y, z)), id);
  }
  observerUpdateFront(x, y, z, m, id) {
    const d = m & 7, bx = x - DX[d], by = y - DY[d], bz = z - DZ[d];
    this.neighborChangedAt(bx, by, bz, id, x, y, z);
    this.updateNeighborsAtExcept(bx, by, bz, id, d);
  }

  // ---------------- daylight detectors ----------------
  daylightUpdate(be) {
    const { x, y, z } = be, s = this.get(x, y, z);
    if (s < 0 || KIND[ID(s)] !== K.DAYLIGHT) return;
    const m = M(s), g = this.g, w = this.w;
    let i = (w.hasSky ? w.lightAt(x, y, z).sky : 0) - this.skyDarken();
    const t = this.timeOfDay();
    let f = t * Math.PI * 2;
    if (m & 16) i = 15 - i;
    else if (i > 0) { const f1 = f < Math.PI ? 0 : Math.PI * 2; f += (f1 - f) * 0.2; i = Math.round(i * Math.cos(f)); }
    i = Math.max(0, Math.min(15, i));
    if ((m & 15) !== i) this.setBlock(x, y, z, S(ID(s), (m & ~15) | i), 3);
    void g;
  }
  timeOfDay() { return timeOfDay(this.g.dayTime); }
  skyDarken() { return skyDarken(this.g.dayTime, this.g.weather || {}); }

  // ---------------- pistons ----------------
  pistonPowered(x, y, z, facing) {
    for (const d of ALL) if (d !== facing && this.hasSignal(x + DX[d], y + DY[d], z + DZ[d], d)) return true;
    if (this.hasSignal(x, y, z, DOWN)) return true;
    for (const d of ALL) if (d !== DOWN && this.hasSignal(x + DX[d], y + 1 + DY[d], z + DZ[d], d)) return true;
    return false;
  }
  pistonCheck(x, y, z, s) {
    const m = M(s), d = (m >> 1) & 7, on = this.pistonPowered(x, y, z, d), ext = !!(m & 16);
    if (on && !ext) {
      if (this.resolve(x, y, z, d, true)) this.blockEvent(x, y, z, ID(s), 0, d);
    } else if (!on && ext) {
      const bx = x + DX[d] * 2, by = y + DY[d] * 2, bz = z + DZ[d] * 2, b = this.get(bx, by, bz);
      let type = 1;
      if (b >= 0 && ID(b) === B.MOVING_PISTON) {
        const mv = this.be(bx, by, bz);
        if (mv && mv.type === 'moving' && mv.dir === d && mv.ext && (mv.prog < 0.5 || this.gameTime === mv.last || this.handlingTick)) type = 2;
      }
      this.blockEvent(x, y, z, ID(s), type, d);
    }
  }
  isFittingBase(head, base) {
    if (base < 0 || ID(base) !== B.PISTON) return false;
    const hm = M(head), bm = M(base);
    return (bm & 16) !== 0 && ((bm >> 1) & 7) === ((hm >> 1) & 7) && (bm & 1) === (hm & 1);
  }
  headCanSurvive(x, y, z, s) {
    const m = M(s), d = (m >> 1) & 7, b = this.get(x - DX[d], y - DY[d], z - DZ[d]);
    if (this.isFittingBase(s, b)) return true;
    if (b >= 0 && ID(b) === B.MOVING_PISTON) { const mv = this.be(x - DX[d], y - DY[d], z - DZ[d]); return !!(mv && mv.dir === d); }
    return false;
  }
  isSticky(s) { return s >= 0 && (ID(s) === B.SLIME_BLOCK || ID(s) === B.HONEY_BLOCK); }
  canStick(a, b) {
    if (ID(a) === B.HONEY_BLOCK && ID(b) === B.SLIME_BLOCK) return false;
    if (ID(a) === B.SLIME_BLOCK && ID(b) === B.HONEY_BLOCK) return false;
    return this.isSticky(a) || this.isSticky(b);
  }
  isPushable(s, x, y, z, moveDir, allowDestroy, pistonFacing) {
    if (s < 0 || y < 0 || y > 255) return false;
    const id = ID(s);
    if (id === AIR) return true;
    if (moveDir === DOWN && y === 0) return false;
    if (moveDir === UP && y === 255) return false;
    if (id === B.PISTON) return !(M(s) & 16);
    if (id === B.MISC && MISC_BE.has(props(id, M(s)).key)) return false;
    if (id === B.OBSIDIAN) return false;
    switch (PUSH[id]) {
      case 2: return false;
      case 1: return allowDestroy;
      default: return true;
    }
  }
  // PistonStructureResolver: which blocks move, which break.
  resolve(px, py, pz, facing, extending) {
    const r = { toPush: [], toDestroy: [], px, py, pz, facing, extending };
    r.pushDir = extending ? facing : OPP[facing];
    const sx = px + DX[facing] * (extending ? 1 : 2), sy = py + DY[facing] * (extending ? 1 : 2), sz = pz + DZ[facing] * (extending ? 1 : 2);
    const s = this.get(sx, sy, sz);
    this.lastResolve = r;
    if (!this.isPushable(s, sx, sy, sz, r.pushDir, false, facing)) {
      if (extending && s >= 0 && PUSH[ID(s)] === 1) { r.toDestroy.push([sx, sy, sz]); return true; }
      return false;
    }
    if (!this.addBlockLine(r, sx, sy, sz, r.pushDir)) return false;
    for (let i = 0; i < r.toPush.length; i++) {
      const p = r.toPush[i];
      if (this.isSticky(this.get(p[0], p[1], p[2])) && !this.addBranching(r, p)) return false;
    }
    return true;
  }
  addBlockLine(r, ox, oy, oz, dir) {
    let s = this.get(ox, oy, oz);
    if (s === AIR) return true;
    if (!this.isPushable(s, ox, oy, oz, r.pushDir, false, dir)) return true;
    if (ox === r.px && oy === r.py && oz === r.pz) return true;
    if (r.toPush.some(p => p[0] === ox && p[1] === oy && p[2] === oz)) return true;
    const back = OPP[r.pushDir];
    let i = 1;
    if (i + r.toPush.length > 12) return false;
    while (this.isSticky(s)) {
      const bx = ox + DX[back] * i, by = oy + DY[back] * i, bz = oz + DZ[back] * i;
      const prev = s;
      s = this.get(bx, by, bz);
      if (s === AIR || s < 0 || !this.canStick(prev, s) || !this.isPushable(s, bx, by, bz, r.pushDir, false, back) || (bx === r.px && by === r.py && bz === r.pz)) break;
      i++;
      if (i + r.toPush.length > 12) return false;
    }
    let l = 0;
    for (let k = i - 1; k >= 0; k--) { r.toPush.push([ox + DX[back] * k, oy + DY[back] * k, oz + DZ[back] * k]); l++; }
    for (let j = 1; ; j++) {
      const bx = ox + DX[r.pushDir] * j, by = oy + DY[r.pushDir] * j, bz = oz + DZ[r.pushDir] * j;
      const idx = r.toPush.findIndex(p => p[0] === bx && p[1] === by && p[2] === bz);
      if (idx > -1) {
        this.reorder(r, l, idx);
        for (let k = 0; k <= idx + l; k++) { const p = r.toPush[k]; if (this.isSticky(this.get(p[0], p[1], p[2])) && !this.addBranching(r, p)) return false; }
        return true;
      }
      s = this.get(bx, by, bz);
      if (s === AIR) return true;
      if (!this.isPushable(s, bx, by, bz, r.pushDir, true, r.pushDir) || (bx === r.px && by === r.py && bz === r.pz)) return false;
      if (PUSH[ID(s)] === 1) { r.toDestroy.push([bx, by, bz]); return true; }
      if (r.toPush.length >= 12) return false;
      r.toPush.push([bx, by, bz]); l++;
    }
  }
  reorder(r, offsets, index) {
    const t = r.toPush, n = t.length;
    r.toPush = [...t.slice(0, index), ...t.slice(n - offsets), ...t.slice(index, n - offsets)];
  }
  addBranching(r, p) {
    const s = this.get(p[0], p[1], p[2]);
    const axis = d => (d >> 1);
    for (const d of ALL) {
      if (axis(d) === axis(r.pushDir)) continue;
      const bx = p[0] + DX[d], by = p[1] + DY[d], bz = p[2] + DZ[d], b = this.get(bx, by, bz);
      if (b >= 0 && this.canStick(b, s) && !this.addBlockLine(r, bx, by, bz, d)) return false;
    }
    return true;
  }
  moveBlocks(px, py, pz, dir, extending) {
    const hx = px + DX[dir], hy = py + DY[dir], hz = pz + DZ[dir];
    const sticky = M(this.get(px, py, pz)) & 1;
    if (!extending && ID(this.get(hx, hy, hz)) === B.PISTON_HEAD) this.setBlock(hx, hy, hz, AIR, 20);
    if (!this.resolve(px, py, pz, dir, extending)) return false;
    const r = this.lastResolve;
    const map = new Map(), keys = [];
    const toPush = r.toPush, toDestroy = r.toDestroy;
    const states = [];
    const orig = toPush.map(p => this.get(p[0], p[1], p[2]));
    toPush.forEach((p, i) => { map.set(pk(p[0], p[1], p[2]), [p, orig[i]]); keys.push(p); });
    const moveDir = extending ? dir : OPP[dir];
    const destroyed = [];
    for (let k = toDestroy.length - 1; k >= 0; k--) {
      const p = toDestroy[k], s = this.get(p[0], p[1], p[2]);
      this.dropResources(p[0], p[1], p[2], s);
      this.setBlock(p[0], p[1], p[2], AIR, 18);
      if (ID(s) !== B.FIRE) this.g.particles.block(p[0], p[1], p[2], ID(s), M(s), 10);
      destroyed.push(s);
    }
    const pushedStates = [];
    for (let l = toPush.length - 1; l >= 0; l--) {
      const p = toPush[l], s = this.get(p[0], p[1], p[2]);
      const nx = p[0] + DX[moveDir], ny = p[1] + DY[moveDir], nz = p[2] + DZ[moveDir];
      map.delete(pk(nx, ny, nz));
      this.setBlock(nx, ny, nz, S(B.MOVING_PISTON, dir << 1), 68);
      this.newMoving(nx, ny, nz, orig[l], dir, extending, false);
      pushedStates.push(s);
    }
    if (extending) {
      const head = S(B.PISTON_HEAD, sticky | (dir << 1));
      map.delete(pk(hx, hy, hz));
      this.setBlock(hx, hy, hz, S(B.MOVING_PISTON, dir << 1), 68);
      this.newMoving(hx, hy, hz, head, dir, true, true);
    }
    const rest = javaHashOrder([...map.values()].map(v => v[0]), toPush.length);
    for (const p of rest) this.setBlock(p[0], p[1], p[2], AIR, 82);
    for (const p of rest) {
      const s = this.origState(toPush, p, map);
      this.updateIndirectNeighbourShapes(p[0], p[1], p[2], s, 2, 511);
      this.updateNeighbourShapes(p[0], p[1], p[2], AIR, 2, 511);
    }
    for (let i = toDestroy.length - 1, j = 0; i >= 0; i--, j++) {
      const p = toDestroy[i], s = destroyed[j];
      this.updateIndirectNeighbourShapes(p[0], p[1], p[2], s, 2, 511);
      this.updateNeighborsAt(p[0], p[1], p[2], ID(s));
    }
    for (let l = toPush.length - 1, j = 0; l >= 0; l--, j++) this.updateNeighborsAt(toPush[l][0], toPush[l][1], toPush[l][2], ID(pushedStates[j]));
    if (extending) this.updateNeighborsAt(hx, hy, hz, B.PISTON_HEAD);
    return true;
  }
  origState(toPush, p, map) { const v = map.get(pk(p[0], p[1], p[2])); return v ? v[1] : AIR; }
  newMoving(x, y, z, state, dir, ext, source) {
    const be = { type: 'moving', x, y, z, state, dir, ext, src: source, prog: 0, prog0: 0, last: this.gameTime };
    this.w.blockEntities.set(posKey(x, y, z), be);
    this.moving.add(posKey(x, y, z));
    this.addTicker(be);
    this.g.onBlockEntityChanged(be);
    return be;
  }
  pistonEvent(x, y, z, s, type, param) {
    const id = ID(s), m = M(s), d = (m >> 1) & 7, sticky = m & 1;
    const on = this.pistonPowered(x, y, z, d);
    if (on && (type === 1 || type === 2)) { this.setBlock(x, y, z, S(id, m | 16), 2); return false; }
    if (!on && type === 0) return false;
    const pos = [x + 0.5, y + 0.5, z + 0.5];
    if (type === 0) {
      if (!this.moveBlocks(x, y, z, d, true)) return false;
      this.setBlock(x, y, z, S(id, m | 16), 67);
      this.g.sound.play('piston_out', pos, 0.5, 0.6 + Math.random() * 0.25);
    } else {
      const hx = x + DX[d], hy = y + DY[d], hz = z + DZ[d];
      const hb = this.be(hx, hy, hz);
      if (hb && hb.type === 'moving') this.finalTick(hb);
      const moving = S(B.MOVING_PISTON, d << 1);
      this.setBlock(x, y, z, moving, 20);
      this.newMoving(x, y, z, S(id, (param & 7) << 1 | sticky), d, false, true);
      this.updateNeighborsAt(x, y, z, B.MOVING_PISTON);
      this.updateNeighbourShapes(x, y, z, moving, 2, 512);
      if (sticky) {
        const bx = x + DX[d] * 2, by = y + DY[d] * 2, bz = z + DZ[d] * 2, b = this.get(bx, by, bz);
        let done = false;
        if (b >= 0 && ID(b) === B.MOVING_PISTON) { const mv = this.be(bx, by, bz); if (mv && mv.type === 'moving' && mv.dir === d && mv.ext) { this.finalTick(mv); done = true; } }
        if (!done) {
          if (type !== 1 || b === AIR || b < 0 || !this.isPushable(b, bx, by, bz, OPP[d], false, d) || (PUSH[ID(b)] !== 0 && ID(b) !== B.PISTON)) this.removeBlock(hx, hy, hz);
          else this.moveBlocks(x, y, z, d, false);
        }
      } else this.removeBlock(hx, hy, hz);
      this.g.sound.play('piston_in', pos, 0.5, 0.6 + Math.random() * 0.15);
    }
    return true;
  }
  // A moving block's progress: 0.5 per game tick; it lands the tick after reaching 1.
  movingTick(be) {
    const { x, y, z } = be;
    be.last = this.gameTime;
    be.prog0 = be.prog;
    if (be.prog0 >= 1) {
      this.removeTicker(be);
      if (ID(this.get(x, y, z)) === B.MOVING_PISTON) {
        this.w.blockEntities.delete(posKey(x, y, z));
        const s = this.updateFromNeighbourShapes(be.state, x, y, z);
        if (ID(s) === AIR) { this.setBlock(x, y, z, be.state, 84); this.updateOrDestroy(x, y, z, be.state, s, 3, 512); }
        else { this.setBlock(x, y, z, s, 67); this.neighborChangedAt(x, y, z, ID(s), x, y, z); }
      }
      return;
    }
    const f = be.prog + 0.5;
    this.pushEntities(be, f);
    be.prog = Math.min(1, f);
    this.g.onBlockEntityChanged(be);
  }
  finalTick(be) {
    if (be.prog0 < 1) {
      const { x, y, z } = be;
      be.prog = be.prog0 = 1;
      this.removeTicker(be);
      this.w.blockEntities.delete(posKey(x, y, z));
      if (ID(this.get(x, y, z)) === B.MOVING_PISTON) {
        const s = be.src ? AIR : this.updateFromNeighbourShapes(be.state, x, y, z);
        this.setBlock(x, y, z, s, 3);
        this.neighborChangedAt(x, y, z, ID(s), x, y, z);
      }
    }
  }
  updateFromNeighbourShapes(s, x, y, z) {
    for (const d of SHAPE_ORDER) {
      const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
      s = this.updateShape(x, y, z, s, d, this.get(nx, ny, nz), nx, ny, nz);
    }
    return s;
  }
  removeTicker(be) { be.removed = true; }
  // Entities in the way of a moving block are shoved along; slime launches them.
  pushEntities(be, f) {
    const s = be.state;
    if (ID(s) === AIR) return;
    const d = be.ext ? be.dir : OPP[be.dir];
    const off = be.ext ? f - 1 : 1 - f;
    const ox = be.x + DX[be.dir] * off, oy = be.y + DY[be.dir] * off, oz = be.z + DZ[be.dir] * off;
    const push = 0.5 + 0.01;
    const slime = ID(s) === B.SLIME_BLOCK;
    const hit = (p, hw, h) => p[0] + hw > ox && p[0] - hw < ox + 1 && p[2] + hw > oz && p[2] - hw < oz + 1 && p[1] + h > oy && p[1] < oy + 1 + (d === UP ? 0.01 : 0);
    const move = (pos, vel, hw, h) => {
      if (!hit(pos, hw, h)) return;
      pos[0] += DX[d] * push; pos[1] += DY[d] * push; pos[2] += DZ[d] * push;
      if (slime && vel) { if (DX[d]) vel[0] = DX[d] * 20; if (DY[d]) vel[1] = DY[d] * 20; if (DZ[d]) vel[2] = DZ[d] * 20; }
      else if (vel && DY[d] > 0 && vel[1] < 0) vel[1] = 0;
    };
    const g = this.g;
    if (g.alive) move(g.player.pos, g.player.vel, 0.3, 1.8);
    for (const e of g.entities.list) if (!e.dead && !e.remote && e.pos) move(e.pos, e.vel, e.hw || 0.3, e.h || 1);
  }

  // ---------------- containers (hoppers, droppers, comparators) ----------------
  hasAnalog(s, x, y, z) {
    const id = ID(s);
    if (!ANALOG[id]) return false;
    if (id === B.MISC) return props(id, M(s)).key === 'barrel';
    return true;
  }
  analogOf(s, x, y, z) {
    const id = ID(s);
    if (id === B.END_PORTAL_FRAME) return (M(s) >> 2) & 1 ? 15 : 0;
    const c = this.containerAt(x, y, z);
    if (!c) return 0;
    let f = 0, any = false;
    for (let i = 0; i < c.slots.length; i++) { const it = c.slots[i]; if (it) { f += it.count / Math.min(64, maxStack(it.key)); any = true; } }
    f /= c.slots.length;
    return Math.floor(f * 14) + (any ? 1 : 0);
  }
  containerSize(s) {
    const id = ID(s);
    if (id === B.CHEST) return 27;
    if (id === B.MISC && props(id, M(s)).key === 'barrel') return 27;
    if (id === B.FURNACE) return 3;
    if (id === B.HOPPER) return 5;
    if (id === B.DISPENSER || id === B.DROPPER) return 9;
    return 0;
  }
  containerAt(x, y, z) {
    const s = this.get(x, y, z);
    if (s < 0) return null;
    const n = this.containerSize(s);
    if (!n) return null;
    const type = ID(s) === B.FURNACE ? 'furnace' : ID(s) === B.HOPPER ? 'hopper' : 'chest';
    const be = this.ensureBE(x, y, z, { type, items: [] }, type === 'hopper');
    const c = this.g.containerOf(be, n);
    c.kind = ID(s) === B.FURNACE ? 'furnace' : 'box';
    return c;
  }
  // Slots a container offers to an insert/extract from direction `from` (the side touched).
  insertSlots(c, from) { if (c.kind === 'furnace') return from === UP ? [0] : from === DOWN ? [] : [1]; return c.slots.map((_, i) => i); }
  extractSlots(c, from) { if (c.kind === 'furnace') return from === DOWN ? [2] : []; return c.slots.map((_, i) => i); }
  canInsert(c, slot, stack) {
    if (c.kind === 'furnace' && slot === 1) return !!(I[stack.key] && I[stack.key].fuel);
    if (c.kind === 'furnace' && slot === 2) return false;
    return true;
  }
  // Moves a stack into a container; returns what did not fit.
  addItem(dest, stack, from) {
    const slots = this.insertSlots(dest, from);
    let rest = { ...stack };
    for (const i of slots) {
      if (rest.count <= 0) break;
      if (!this.canInsert(dest, i, rest)) continue;
      const cur = dest.get(i), max = maxStack(rest.key);
      if (!cur) { const n = Math.min(max, rest.count); dest.set(i, { ...rest, count: n }); rest.count -= n; }
      else if (cur.key === rest.key && !cur.tag && !rest.tag && !cur.dmg && cur.count < max) { const n = Math.min(max - cur.count, rest.count); dest.set(i, { ...cur, count: cur.count + n }); rest.count -= n; }
    }
    return rest.count > 0 ? rest : null;
  }
  isFull(c, from) { for (const i of this.insertSlots(c, from)) { const it = c.get(i); if (!it || it.count < maxStack(it.key)) return false; } return true; }
  hopperTick(be) {
    const { x, y, z } = be, s = this.get(x, y, z);
    if (s < 0) return;
    if (ID(s) !== B.HOPPER) { be.removed = true; return; }
    be.cd = (be.cd ?? -1) - 1;
    be.tg = this.gameTime;
    if (be.cd > 0) return;
    be.cd = 0;
    this.hopperMove(be, s);
  }
  hopperMove(be, s) {
    const { x, y, z } = be, m = M(s);
    if (be.cd > 0 || (m & 8)) return false;
    const c = this.g.containerOf(be, 5);
    let moved = false;
    if (c.slots.some(Boolean)) moved = this.hopperEject(be, c, m);
    if (!this.isFull(c, null)) moved = this.hopperSuck(be, c) || moved;
    if (moved) { be.cd = 8; this.updateNeighbourForOutputSignal(x, y, z); return true; }
    return false;
  }
  hopperEject(be, c, m) {
    const d = m & 7, tx = be.x + DX[d], ty = be.y + DY[d], tz = be.z + DZ[d];
    const dest = this.containerAt(tx, ty, tz);
    if (!dest) return false;
    const from = OPP[d];
    if (this.isFull(dest, from)) return false;
    for (let i = 0; i < c.slots.length; i++) {
      const it = c.get(i);
      if (!it) continue;
      const one = { ...it, count: 1 };
      const wasEmpty = !dest.slots.some(Boolean);
      if (!this.addItem(dest, one, from)) {
        c.set(i, it.count > 1 ? { ...it, count: it.count - 1 } : null);
        this.afterInsert(dest, tx, ty, tz, wasEmpty, be);
        return true;
      }
    }
    return false;
  }
  afterInsert(dest, x, y, z, wasEmpty, srcBe) {
    this.updateNeighbourForOutputSignal(x, y, z);
    if (wasEmpty && ID(this.get(x, y, z)) === B.HOPPER) {
      const tb = this.be(x, y, z);
      if (tb) { let k = 0; if (srcBe && srcBe.type === 'hopper' && (tb.tg ?? -1) >= (srcBe.tg ?? -1)) k = 1; tb.cd = 8 - k; }
    }
  }
  hopperSuck(be, c) {
    const { x, y, z } = be;
    const src = this.containerAt(x, y + 1, z);
    if (src) {
      for (const i of this.extractSlots(src, DOWN)) {
        const it = src.get(i);
        if (!it) continue;
        if (!this.addItem(c, { ...it, count: 1 }, UP)) { src.set(i, it.count > 1 ? { ...it, count: it.count - 1 } : null); this.updateNeighbourForOutputSignal(x, y + 1, z); return true; }
      }
      return false;
    }
    const above = this.get(x, y + 1, z);
    if (above >= 0 && OPAQUE[ID(above)]) return false;
    for (const e of this.g.entities.list) {
      if (e.dead || e.type !== 'item' || !e.stack || e.remote) continue;
      const p = e.pos;
      if (p[0] < x || p[0] > x + 1 || p[2] < z || p[2] > z + 1 || p[1] < y + 11 / 16 || p[1] > y + 2) continue;
      const rest = this.addItem(c, e.stack, UP);
      if (!rest) { e.dead = true; return true; }
      if (rest.count !== e.stack.count) { e.stack = rest; return true; }
    }
    return false;
  }

  // ---------------- dispensers & droppers ----------------
  dispense(x, y, z, s) {
    const g = this.g, id = ID(s), m = M(s), d = m & 7;
    const be = this.ensureBE(x, y, z, { type: 'chest', items: [] });
    const c = g.containerOf(be, 9);
    let slot = -1, n = 1;
    for (let i = 0; i < 9; i++) if (c.get(i) && Math.random() * n++ < 1) slot = i;
    const pos = [x + 0.5, y + 0.5, z + 0.5];
    if (slot < 0) { g.sound.play('rs_click', pos, 0.5, 1.2); return; }
    const it = c.get(slot);
    const take = () => c.set(slot, it.count > 1 ? { ...it, count: it.count - 1 } : null);
    const fx = x + DX[d], fy = y + DY[d], fz = z + DZ[d];
    const out = [x + 0.5 + DX[d] * 0.7, y + 0.5 + DY[d] * 0.7 - (DY[d] ? 0 : 0.125), z + 0.5 + DZ[d] * 0.7];
    g.particles.smoke([x + 0.5 + DX[d] * 0.6, y + 0.5 + DY[d] * 0.6, z + 0.5 + DZ[d] * 0.6], 4);
    if (id === B.DROPPER) {
      const dest = this.containerAt(fx, fy, fz);
      if (dest) {
        const wasEmpty = !dest.slots.some(Boolean);
        if (!this.addItem(dest, { ...it, count: 1 }, OPP[d])) { take(); this.afterInsert(dest, fx, fy, fz, wasEmpty, null); }
        g.sound.play('rs_click', pos, 0.5, 1);
        return;
      }
      take(); this.spawnItem(it, out, d); g.sound.play('rs_click', pos, 0.5, 1);
      return;
    }
    const key = it.key, def = I[key], front = this.get(fx, fy, fz);
    const vel = (speed, spread) => { const sp = spread * 0.0075; const v = [DX[d] + gauss() * sp, DY[d] + 0.1 + gauss() * sp, DZ[d] + gauss() * sp], l = Math.hypot(...v); return v.map(a => a / l * speed * 20); };
    const shoot = kind => { g.shootProjectile(kind, out, vel(kind === 'arrow' || kind === 'spectral_arrow' ? 1.1 : 1.1, 6), null, kind === 'arrow' ? { pickup: true } : {}); take(); g.sound.play('bow', pos, 0.5); };
    if (key === 'arrow' || key === 'spectral_arrow') { shoot('arrow'); return; }
    if (key === 'snowball' || key === 'egg' || key === 'splash_potion') { shoot(key); return; }
    if (key === 'fire_charge') { g.shootProjectile('small_fireball', out, vel(1.2, 1), null); take(); g.sound.play('fireball', pos, 0.5); return; }
    if (key === 'tnt') { g.igniteTnt(fx, fy, fz); take(); return; }
    if (key === 'water_bucket' || key === 'lava_bucket') {
      if (front >= 0 && (ID(front) === AIR || (BLOCKS[ID(front)] && BLOCKS[ID(front)].replaceable))) { g.world.setBlock(fx, fy, fz, key === 'water_bucket' ? B.WATER : B.LAVA, 0); c.set(slot, { key: 'bucket', count: 1 }); g.sound.play('splash', pos, 0.4); return; }
    }
    if (key === 'bucket' && front >= 0 && (ID(front) === B.WATER || ID(front) === B.LAVA) && (M(front) & 15) === 0) {
      g.world.setBlock(fx, fy, fz, AIR, 0);
      const full = { key: ID(front) === B.WATER ? 'water_bucket' : 'lava_bucket', count: 1 };
      take(); if (this.addItem(c, full, null)) this.spawnItem(full, out, d);
      return;
    }
    if (key === 'flint_and_steel') {
      if (ID(front) === B.TNT) g.igniteTnt(fx, fy, fz);
      else if (ID(front) === AIR) g.world.setBlock(fx, fy, fz, B.FIRE, 0);
      else { g.sound.play('rs_click', pos, 0.5, 1.2); return; }
      const dmg = (it.dmg || 0) + 1;
      c.set(slot, dmg >= (def.durability || 64) ? null : { ...it, dmg });
      return;
    }
    if (key === 'bone_meal') { if (g.sim.boneMeal(fx, fy, fz)) { g.particles.fx('happy', [fx + 0.5, fy + 0.5, fz + 0.5], 10, 0.5); take(); } else g.sound.play('rs_click', pos, 0.5, 1.2); return; }
    if (def && def.use === 'spawn_egg') { g.spawnMob(def.mob, fx + 0.5, fy, fz + 0.5, { persistent: true }); take(); return; }
    if (def && def.use === 'firework') { g.launchFirework(out); take(); return; }
    take(); this.spawnItem(it, out, d); g.sound.play('rs_click', pos, 0.5, 1);
  }
  spawnItem(it, out, d) {
    const sp = Math.random() * 0.1 + 0.2;
    const v = [DX[d] * sp + gauss() * 0.0075 * 6, (DY[d] ? DY[d] * sp : 0.2) + gauss() * 0.0075 * 6, DZ[d] * sp + gauss() * 0.0075 * 6];
    const e = this.g.dropItem(out[0], out[1] - 0.15, out[2], { ...it, count: 1 }, v.map(a => a * 20));
    if (e) e.pickupDelay = 0.5;
  }

  // ---------------- ticks and events ----------------
  schedule(x, y, z, id, delay, pri = NORMAL) {
    if (this.hasScheduled(x, y, z, id)) return;
    const k = pk(x, y, z), t = { x, y, z, id, t: this.gameTime + delay, p: pri, o: this.order++, k };
    const list = this.pending.get(k);
    if (list) list.push(t); else this.pending.set(k, [t]);
    this.heap.push(t);
  }
  hasScheduled(x, y, z, id) {
    const k = pk(x, y, z);
    const a = this.pending.get(k);
    if (a && a.some(t => t.id === id)) return true;
    return this.willTickThisTick(x, y, z, id);
  }
  willTickThisTick(x, y, z, id) { const r = this.running.get(pk(x, y, z)); return !!(r && r.includes(id)); }
  blockEvent(x, y, z, id, a, b) {
    const key = `${x},${y},${z},${id},${a},${b}`;
    if (this.eventKeys.has(key)) return;
    this.eventKeys.add(key);
    this.events.push({ x, y, z, id, a, b, key });
  }
  runTicks() {
    const due = [], later = [];
    this.handlingTick = true;
    while (this.heap.size && this.heap.peek().t <= this.gameTime && due.length < 65536) {
      const t = this.heap.pop();
      if (!this.loaded(t.x, t.z)) { later.push(t); continue; }
      const list = this.pending.get(t.k);
      if (list) { const i = list.indexOf(t); if (i >= 0) list.splice(i, 1); if (!list.length) this.pending.delete(t.k); }
      due.push(t);
      const r = this.running.get(t.k);
      if (r) r.push(t.id); else this.running.set(t.k, [t.id]);
    }
    for (const t of later) this.heap.push(t);
    for (const t of due) {
      const r = this.running.get(t.k);
      if (r) { const i = r.indexOf(t.id); if (i >= 0) r.splice(i, 1); if (!r.length) this.running.delete(t.k); }
      const s = this.get(t.x, t.y, t.z);
      if (s >= 0 && ID(s) === t.id) this.tickBlock(t.x, t.y, t.z, s);
    }
    this.running.clear();
    this.handlingTick = false;
  }
  tickBlock(x, y, z, s) {
    switch (KIND[ID(s)]) {
      case K.TORCH: this.torchTick(x, y, z, s); return;
      case K.REPEATER: this.repeaterTick(x, y, z, s); return;
      case K.COMPARATOR: this.comparatorRefresh(x, y, z, s); return;
      case K.BUTTON: this.buttonTick(x, y, z, s); return;
      case K.PLATE: { const cur = (M(s) >> 2) & 15; if (cur > 0) this.plateCheckPressed(x, y, z, s, cur); return; }
      case K.LAMP: this.lampTick(x, y, z, s); return;
      case K.TARGET: this.targetTick(x, y, z, s); return;
      case K.OBSERVER: this.observerTick(x, y, z, s); return;
      case K.DISPENSER: this.dispense(x, y, z, s); return;
      default: return;
    }
  }
  runEvents() {
    while (this.events.length) {
      const e = this.events.shift();
      this.eventKeys.delete(e.key);
      if (!this.loaded(e.x, e.z)) continue;
      const s = this.get(e.x, e.y, e.z);
      if (s < 0 || ID(s) !== e.id) continue;
      if (KIND[e.id] === K.PISTON) this.pistonEvent(e.x, e.y, e.z, s, e.a, e.b);
      else if (KIND[e.id] === K.NOTE) this.noteEvent(e.x, e.y, e.z, s);
    }
  }
  noteEvent(x, y, z, s) {
    const note = M(s) & 31, g = this.g;
    g.sound.note(this.instrument(x, y, z), Math.pow(2, (note - 12) / 12), [x + 0.5, y + 0.5, z + 0.5]);
    g.particles.fx('note', [x + 0.5, y + 1.2, z + 0.5], 1, 0, 0, noteColor(note));
  }
  tickEntities() {
    if (this.newTickers.length) { for (const be of this.newTickers) this.tickers.push(be); this.newTickers.length = 0; }
    let n = 0;
    for (let i = 0; i < this.tickers.length; i++) {
      const be = this.tickers[i];
      if (be.removed || this.w.blockEntities.get(posKey(be.x, be.y, be.z)) !== be) { be.ticking = false; continue; }
      this.tickers[n++] = be;
      if (!this.loaded(be.x, be.z)) continue;
      if (be.type === 'moving') this.movingTick(be);
      else if (be.type === 'hopper') this.hopperTick(be);
      else if (be.type === 'daylight') { if (this.gameTime % 20 === 0) this.daylightUpdate(be); }
    }
    this.tickers.length = n;
  }
  gameTick() {
    this.gameTime++;
    this.runTicks();
    this.runEvents();
    this.entityTick();
    this.tickEntities();
  }
  update(dt) {
    if (!this.enabled || !this.g.world) return;
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= 0.05 && n < 5) { this.acc -= 0.05; this.gameTick(); n++; }
    if (n === 5) this.acc = 0;
    this.alpha = this.acc / 0.05;
  }

  // ---------------- hooks from the rest of the game ----------------
  // A block changed outside the engine (players, explosions, liquids, other players' edits):
  // run what the original's setBlock would have run.
  onWorldChange(x, y, z, oldId, oldM, id, m) {
    if (!this.enabled || this.selfSet) return;
    this.afterExternal(x, y, z, S(id, m), S(oldId, oldM));
  }
  afterExternal(x, y, z, s, old) {
    this.onRemove(x, y, z, old, s, false);
    this.onPlace(x, y, z, s, old, false);
    if (this.get(x, y, z) !== s) return;
    this.updateNeighborsAt(x, y, z, ID(old));
    if (ANALOG[ID(s)]) this.updateNeighbourForOutputSignal(x, y, z);
    this.updateIndirectNeighbourShapes(x, y, z, old, 2, 511);
    this.updateNeighbourShapes(x, y, z, s, 2, 511);
    this.updateIndirectNeighbourShapes(x, y, z, s, 2, 511);
  }
  onContainerChanged(be) { if (this.enabled && be && be.x !== undefined && this.g.world) this.updateNeighbourForOutputSignal(be.x, be.y, be.z); }
  // After a player places a block (Block.setPlacedBy).
  placedBy(x, y, z) {
    if (!this.enabled) return;
    const s = this.get(x, y, z);
    if (s < 0) return;
    const k = KIND[ID(s)];
    if (k === K.REPEATER && this.diodeInput(x, y, z, M(s)) > 0) this.schedule(x, y, z, ID(s), 1);
    if (k === K.COMPARATOR && this.compShouldTurnOn(x, y, z, M(s))) this.schedule(x, y, z, ID(s), 1);
    if (k === K.PISTON) this.pistonCheck(x, y, z, s);
  }
  // Right-click on a redstone block; returns true if it reacted.
  isUsable(id) { const k = KIND[id]; return k === K.LEVER || k === K.BUTTON || k === K.REPEATER || k === K.COMPARATOR || k === K.WIRE || k === K.NOTE || k === K.DAYLIGHT; }
  use(x, y, z) {
    const s = this.get(x, y, z);
    if (s < 0) return false;
    const id = ID(s), m = M(s), g = this.g, pos = [x, y, z];
    switch (KIND[id]) {
      case K.LEVER: {
        const nm = m ^ 16;
        this.setBlock(x, y, z, S(id, nm), 3);
        this.faceUpdate(x, y, z, m & 3, (m >> 2) & 3, id);
        this.click(pos, !!(nm & 16));
        if (nm & 16) g.particles.fx('white', [x + 0.5, y + 0.5, z + 0.5], 3, 0.2, 0.2, [1, 0.1, 0.1]);
        return true;
      }
      case K.BUTTON:
        if (m & 128) return true;
        this.setBlock(x, y, z, S(id, m | 128), 3);
        this.faceUpdate(x, y, z, (m >> 3) & 3, (m >> 5) & 3, id);
        this.schedule(x, y, z, id, this.buttonTicks(m));
        this.click(pos, true, (m & 7) !== 0 && (m & 7) !== 7);
        return true;
      case K.REPEATER: this.setBlock(x, y, z, S(id, (m & ~12) | ((((m >> 2) & 3) + 1) & 3) << 2), 3); this.click(pos, true); return true;
      case K.COMPARATOR: {
        const nm = m ^ 4;
        g.sound.play('rs_click', [x + 0.5, y + 0.5, z + 0.5], 0.3, nm & 4 ? 1.1 : 1);
        this.setBlock(x, y, z, S(id, nm), 2);
        this.comparatorRefresh(x, y, z, this.get(x, y, z));
        return true;
      }
      case K.WIRE: {
        const mask = m >> 4;
        if (mask !== 15 && mask !== 0) return false;
        let ns = S(id, (m & 15) | (mask === 15 ? 0 : 15 << 4));
        ns = this.wireConnectionState(x, y, z, ns);
        if (ns === s) return false;
        this.setBlock(x, y, z, ns, 3);
        const nmask = M(ns) >> 4;
        for (const d of HORIZ) {
          const a = (mask >> D2[d]) & 1, b = (nmask >> D2[d]) & 1;
          if (a !== b && this.isConductor(this.get(x + DX[d], y, z + DZ[d]))) this.updateNeighborsAtExcept(x + DX[d], y, z + DZ[d], id, OPP[d]);
        }
        return true;
      }
      case K.NOTE: this.setBlock(x, y, z, S(id, (m & ~31) | (((m & 31) + 1) % 25)), 3); this.playNote(x, y, z); return true;
      case K.DAYLIGHT: this.setBlock(x, y, z, S(id, m ^ 16), 2); { const be = this.ensureBE(x, y, z, { type: 'daylight' }, true); this.daylightUpdate(be); } return true;
      default: return false;
    }
  }
  // Left-clicking a note block plays it.
  attack(x, y, z) { const s = this.get(x, y, z); if (s >= 0 && KIND[ID(s)] === K.NOTE && this.enabled) this.playNote(x, y, z); }

  // The block state a player's placement creates, or -1 if it cannot go there.
  placementState(id, variant, x, y, z, hit, look2d, lookVec) {
    const k = KIND[id], n = [hit.nx, hit.ny, hit.nz];
    const nearest = dominant(lookVec);
    switch (k) {
      case K.WIRE: {
        const s = S(id, 15 << 4);
        if (!this.canSurvive(x, y, z, s)) return -1;
        return this.wireConnectionState(x, y, z, s);
      }
      case K.TORCH: {
        let a;
        if (n[1] === 1) a = 0;
        else if (n[1] === 0) { const f = n[0] === 1 ? 3 : n[0] === -1 ? 1 : n[2] === 1 ? 0 : 2; a = ((f + 2) & 3) + 1; }
        else return -1;
        const s = S(id, a << 1);
        return this.canSurvive(x, y, z, s) ? s : -1;
      }
      case K.REPEATER: case K.COMPARATOR: {
        const f = (look2d + 2) & 3;
        let m = f;
        if (!this.sturdy(this.get(x, y - 1, z), UP)) return -1;
        if (k === K.REPEATER && this.repeaterLocked(x, y, z, m)) m |= 32;
        return S(id, m);
      }
      case K.LEVER: case K.BUTTON: {
        let face, f;
        if (n[1] === 1) { face = 0; f = look2d; } else if (n[1] === -1) { face = 2; f = look2d; } else { face = 1; f = n[0] === 1 ? 3 : n[0] === -1 ? 1 : n[2] === 1 ? 0 : 2; }
        const s = k === K.LEVER ? S(id, face | (f << 2)) : S(id, variant | (face << 3) | (f << 5));
        return this.canSurvive(x, y, z, s) ? s : -1;
      }
      case K.PLATE: { const s = S(id, variant); return this.canSurvive(x, y, z, s) ? s : -1; }
      case K.LAMP: return S(id, this.enabled && this.hasNeighborSignal(x, y, z) ? 1 : 0);
      case K.OBSERVER: return S(id, nearest);
      case K.DISPENSER: return S(id, OPP[nearest]);
      case K.PISTON: return S(id, variant | (OPP[nearest] << 1));
      case K.HOPPER: { let d = n[1] === 1 ? DOWN : n[1] === -1 ? DOWN : OPP[n[0] === 1 ? EAST : n[0] === -1 ? WEST : n[2] === 1 ? SOUTH : NORTH]; if (d === UP) d = DOWN; return S(id, d); }
      default: return S(id, variant);
    }
  }

  // ---------------- saving ----------------
  serialize() {
    const ticks = [];
    for (const t of [...this.heap.a].sort((a, b) => (tickLess(a, b) ? -1 : 1))) ticks.push([t.x, t.y, t.z, t.id, Math.max(0, t.t - this.gameTime), t.p]);
    return { time: this.gameTime, ticks, toggles: [] };
  }
  load(data) {
    this.reset();
    if (!data) { this.collectTickers(); return; }
    this.gameTime = data.time | 0;
    for (const [x, y, z, id, d, p] of data.ticks || []) this.schedule(x, y, z, id, d, p);
    this.collectTickers();
  }
  // Block entities that tick; blocks caught mid-move when the world was saved land in place.
  collectTickers() {
    const w = this.g.world;
    if (!w) return;
    for (const be of w.blockEntities.values()) {
      if (be.type === 'hopper' || be.type === 'daylight' || be.type === 'moving') this.addTicker(be);
      if (be.type === 'moving') this.moving.add(posKey(be.x, be.y, be.z));
    }
  }
  settleMoving() {
    for (const be of [...this.g.world.blockEntities.values()]) if (be.type === 'moving' && this.loaded(be.x, be.z)) this.finalTick(be);
  }

  // Moving blocks are drawn from their block entities.
  render(ctx, lightOf) {
    const w = this.g.world;
    if (!w || !this.moving.size) return;
    const a = this.enabled ? this.alpha : 0.5;
    for (const k of this.moving) {
      const be = w.blockEntities.get(k);
      if (!be || be.type !== 'moving' || ID(this.get(be.x, be.y, be.z)) !== B.MOVING_PISTON) { this.moving.delete(k); continue; }
      if (ID(be.state) === AIR) continue;
      const f = be.prog0 + (be.prog - be.prog0) * a;
      const off = be.ext ? f - 1 : 1 - f;
      const x = be.x + DX[be.dir] * off, y = be.y + DY[be.dir] * off, z = be.z + DZ[be.dir] * off;
      const light = lightOf(be.x, be.y, be.z);
      let st = be.state;
      // A retracting piston keeps its base in place and pulls its head in.
      if (be.src && !be.ext && ID(st) === B.PISTON) {
        ctx.blockModels.push({ id: B.PISTON, meta: M(st) & ~16, light, matrix: translate(be.x, be.y, be.z) });
        st = S(B.PISTON_HEAD, (M(st) & 1) | (be.dir << 1) | 16);
      }
      ctx.blockModels.push({ id: ID(st), meta: M(st), light, matrix: translate(x, y, z) });
    }
  }
}

const translate = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
function gauss() { let u = 0; for (let k = 0; k < 6; k++) u += Math.random(); return (u - 3) / Math.SQRT2; }
// Nearest looking direction (the axis the view points along most).
function dominant(v) {
  const ax = Math.abs(v[0]), ay = Math.abs(v[1]), az = Math.abs(v[2]);
  if (ay >= ax && ay >= az) return v[1] > 0 ? UP : DOWN;
  if (ax >= az) return v[0] > 0 ? EAST : WEST;
  return v[2] > 0 ? SOUTH : NORTH;
}
// Note particle colours cycle through the rainbow like the original.
function noteColor(n) {
  const f = n / 24;
  const c = t => Math.max(0, Math.sin((f + t) * Math.PI * 2) * 0.65 + 0.35);
  return [c(0), c(1 / 3), c(2 / 3)];
}
export { VARIANT_MASK, UNLOADED };

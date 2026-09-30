// Chunk under construction. All feature and structure writers use world coordinates and are
// silently clipped to this chunk, so features that span chunk borders generate seamlessly.
import { CHUNK, HEIGHT, B, BLOCKS, SHAPE_OF, SHAPE, OPAQUE } from '../data/blocks.js?v=muono2ew';

export const CI = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;

export class ChunkBuilder {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.ox = cx * CHUNK; this.oz = cz * CHUNK;
    this.ids = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    this.meta = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    this.biomes = new Uint8Array(CHUNK * CHUNK);
    this.heights = new Uint8Array(CHUNK * CHUNK);
    this.entities = [];       // { type, x, y, z, data }
    this.blockEntities = [];  // { x, y, z, type, ... }
  }
  inside(x, z) { const lx = Math.floor(x) - this.ox, lz = Math.floor(z) - this.oz; return lx >= 0 && lx < CHUNK && lz >= 0 && lz < CHUNK; }
  index(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    const lx = x - this.ox, lz = z - this.oz;
    if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= HEIGHT) return -1;
    return lx + lz * CHUNK + y * CHUNK * CHUNK;
  }
  get(x, y, z) { const i = this.index(x, y, z); return i < 0 ? -1 : this.ids[i]; }
  getMeta(x, y, z) { const i = this.index(x, y, z); return i < 0 ? 0 : this.meta[i]; }
  set(x, y, z, id, m = 0) {
    const i = this.index(x, y, z);
    if (i < 0 || this.ids[i] === B.BEDROCK) return;
    this.ids[i] = id; this.meta[i] = m;
  }
  // Only replaces air, plants, snow and leaves-like soft blocks.
  soft(x, y, z, id, m = 0, overLeaves = false) {
    const i = this.index(x, y, z);
    if (i < 0) return;
    const c = this.ids[i];
    if (c === B.AIR || (BLOCKS[c].replaceable && c !== B.WATER && c !== B.LAVA) || c === B.SNOW || (overLeaves && c === B.LEAVES)) { this.ids[i] = id; this.meta[i] = m; }
  }
  // Replaces air and water (for things like kelp or lily pads) but nothing solid.
  fill(x, y, z, id, m = 0) {
    const i = this.index(x, y, z);
    if (i < 0) return;
    const c = this.ids[i];
    if (!OPAQUE[c] && c !== B.BEDROCK) { this.ids[i] = id; this.meta[i] = m; }
  }
  isAir(x, y, z) { return this.get(x, y, z) === B.AIR; }
  solid(x, y, z) { const c = this.get(x, y, z); return c > 0 && OPAQUE[c] === 1; }
  box(x0, y0, z0, x1, y1, z1, id, m = 0) {
    const ax = Math.max(x0, this.ox), bx = Math.min(x1, this.ox + CHUNK - 1);
    const az = Math.max(z0, this.oz), bz = Math.min(z1, this.oz + CHUNK - 1);
    if (ax > bx || az > bz) return;
    for (let y = Math.max(0, y0); y <= Math.min(HEIGHT - 1, y1); y++) for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.set(x, y, z, id, m);
  }
  overlaps(x0, z0, x1, z1) { return x1 >= this.ox && x0 < this.ox + CHUNK && z1 >= this.oz && z0 < this.oz + CHUNK; }
  // Tagged with the structure being built (see gen/versions.js).
  addBlockEntity(e) { if (this.inside(e.x, e.z)) { if (this.kind) e.k = this.kind; this.blockEntities.push(e); } }
  addEntity(e) { if (this.inside(Math.floor(e.x), Math.floor(e.z))) { if (this.kind) e.k = this.kind; this.entities.push(e); } }
  isPlant(id) { return SHAPE_OF[id] === SHAPE.CROSS; }
}

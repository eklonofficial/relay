// Far view: which tiles of distant land (js/mesh/lod.js) to show around the player, building them
// on workers that have nothing else to do, and swapping them in without holes as the player moves.
import { CHUNK } from '../data/blocks.js?v=muprr3ie';
import { LOD_LEVELS, lodSize, lodStep } from '../mesh/lod.js?v=muprr3ie';

// The tiles covering the land within `radius` blocks of (px, pz). Starting from the coarsest level,
// a tile splits into its four finer children while closer than `split` of its own widths, so cells
// cover about the same part of the screen at every distance. Tiles lying wholly within `inner`
// blocks are left out (the loaded chunks cover them). Nearest first.
export function lodTiles(px, pz, radius, split, inner) {
  const out = [], top = LOD_LEVELS - 1, S = lodSize(top);
  const visit = (L, tx, tz) => {
    const s = lodSize(L), x0 = tx * s, z0 = tz * s;
    const near = Math.hypot(Math.max(x0 - px, 0, px - x0 - s), Math.max(z0 - pz, 0, pz - z0 - s));
    if (near > radius) return;
    if (Math.hypot(Math.max(Math.abs(px - x0), Math.abs(px - x0 - s)), Math.max(Math.abs(pz - z0), Math.abs(pz - z0 - s))) < inner) return;
    if (L > 0 && near < split * s) {
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) visit(L - 1, tx * 2 + a, tz * 2 + b);
      return;
    }
    out.push({ key: `${L},${tx},${tz}`, level: L, tx, tz, x0, z0, size: s, step: lodStep(L), d: near });
  };
  for (let tz = Math.floor((pz - radius) / S); tz <= Math.floor((pz + radius) / S); tz++)
    for (let tx = Math.floor((px - radius) / S); tx <= Math.floor((px + radius) / S); tx++) visit(top, tx, tz);
  return out.sort((a, b) => a.d - b.d);
}

const overlaps = (a, b) => a.x0 < b.x0 + b.size && b.x0 < a.x0 + a.size && a.z0 < b.z0 + b.size && b.z0 < a.z0 + a.size;

export class FarView {
  // radius in chunks; split: see lodTiles (lower is coarser and cheaper).
  constructor(world, renderer, { radius, split = 3 }) {
    this.world = world; this.renderer = renderer;
    this.radius = radius * CHUNK; this.split = split;
    this.tiles = new Map(); // key -> tile: { ...lodTiles entry, pending, ready, gpu, minY, maxY }
    this.wanted = []; this.wantedKeys = new Set();
    this.at = null; this.colors = null; this.dirty = true; this.list = []; this.near = null; this.nearAge = 0;
    world.onLod = m => this.onTile(m);
  }
  // Block colours (layerColors) for the workers; new colours (a resource pack) rebuild every tile.
  setColors(colors) {
    this.colors = colors;
    for (const w of this.world.workers) w.postMessage({ type: 'lodColors', colors });
    for (const t of this.tiles.values()) this.renderer.freeLod(t.gpu);
    this.tiles.clear(); this.dirty = true;
  }
  setRadius(chunks) { if (chunks * CHUNK !== this.radius) { this.radius = chunks * CHUNK; this.at = null; } }
  dispose() {
    for (const t of this.tiles.values()) this.renderer.freeLod(t.gpu);
    this.tiles.clear(); this.list = [];
    if (this.world.onLod) this.world.onLod = null;
  }

  // Per frame: re-plan after moving 16 blocks, and start building the nearest missing tiles on idle
  // workers (chunks always come first: a worker with chunk jobs is never given a tile).
  update(px, pz, renderDistance) {
    const inner = Math.max(0, renderDistance - 1) * CHUNK;
    if (!this.at || Math.hypot(px - this.at[0], pz - this.at[1]) > 16 || this.at[2] !== inner) {
      this.at = [px, pz, inner];
      this.wanted = lodTiles(px, pz, this.radius, this.split, inner);
      this.wantedKeys = new Set(this.wanted.map(t => t.key));
      this.dirty = true;
    }
    if (!this.colors) return;
    const w = this.world;
    let sent = 0;
    for (const t of this.wanted) {
      if (this.tiles.has(t.key)) continue;
      const worker = w.workers.find(k => k.busy === 0);
      if (!worker) break;
      worker.busy++;
      this.tiles.set(t.key, { ...t, pending: true, ready: false, gpu: null });
      worker.postMessage({ type: 'lod', job: w.nextJob++, key: t.key, seed: w.seed, dim: w.dim, worldType: w.worldType, level: t.level, tx: t.tx, tz: t.tz });
      if (++sent >= 2) break;
    }
  }

  onTile(m) {
    const t = this.tiles.get(m.key);
    if (!t || !t.pending) return;
    t.pending = false; t.ready = true;
    if (m.type === 'error') console.warn('far view tile failed', m.key, m.message);
    else { t.gpu = this.renderer.makeLod(m.verts, m.quads); t.minY = m.minY; t.maxY = m.maxY; }
    if (!this.wantedKeys.has(t.key)) { this.renderer.freeLod(t.gpu); this.tiles.delete(t.key); }
    this.dirty = true;
  }

  // The tiles to draw this frame. A tile no longer wanted stays until every tile replacing it is
  // built (and those wait hidden), so moving never opens holes or draws two levels over each other.
  drawList() {
    if (!this.dirty) return this.list;
    this.dirty = false;
    const hidden = new Set(), list = [];
    for (const t of [...this.tiles.values()]) {
      if (this.wantedKeys.has(t.key) || !t.ready) continue;
      const repl = this.wanted.filter(n => overlaps(n, t));
      const done = repl.every(n => { const r = this.tiles.get(n.key); return r && r.ready; });
      if (done) { this.renderer.freeLod(t.gpu); this.tiles.delete(t.key); continue; }
      for (const n of repl) hidden.add(n.key);
      if (t.gpu) list.push(t);
    }
    for (const n of this.wanted) {
      const t = this.tiles.get(n.key);
      if (t && t.gpu && !hidden.has(n.key)) list.push(t);
    }
    return (this.list = list);
  }

  // The loaded chunks the far view must stay out of: chunk (cx, cz) is drawn by the terrain when
  // (cx - x)^2 + (cz - z)^2 <= r2 around the player's chunk. That is every chunk in render distance
  // once they are all built; until then, only out to the nearest one still missing.
  nearDisc(renderDistance) {
    const w = this.world, list = w.wantedList;
    if (!list || !w.centre) return [0, 0, -1];
    if (this.near && this.nearAge++ < 8 && this.near.key === w.wantedKey) return this.near.disc;
    const lim = (renderDistance + 0.5) ** 2;
    let r2 = lim;
    for (const [cx, cz, d2] of list) {
      if (d2 > lim) break;
      const c = w.chunk(cx, cz);
      if (!c || !c.gpu) { r2 = d2 - 0.5; break; }
    }
    this.near = { key: w.wantedKey, disc: [w.centre[0], w.centre[1], r2] };
    this.nearAge = 0;
    return this.near.disc;
  }
}

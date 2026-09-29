import { CHUNK, HEIGHT, PAD, PS, B, OPAQUE, EMIT, RENDER, R_LIQUID, R_NONE } from './blocks.js';
import { VOLUME_SIZE } from './mesher.js';

export const UNLOADED = 255;
const key = (cx, cz) => `${cx},${cz}`;

export class World {
  constructor(seed, savedEdits, callbacks) {
    this.seed = seed;
    this.chunks = new Map();
    this.edits = new Map();
    for (const [k, list] of Object.entries(savedEdits || {})) {
      const m = new Map();
      for (let i = 0; i < list.length; i += 2) m.set(list[i], list[i + 1]);
      this.edits.set(k, m);
    }
    this.onMesh = callbacks.onMesh;
    this.onUnload = callbacks.onUnload;
    this.jobs = 0;
    this.nextJob = 1;
    const count = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = e => this.onWorkerMessage(w, e.data);
      w.onerror = e => console.error('worker error', e.message);
      this.workers.push(w);
    }
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const c of this.chunks.values()) this.onUnload(c);
    this.chunks.clear();
  }

  pickWorker() {
    let best = null;
    for (const w of this.workers) if (w.busy < 2 && (!best || w.busy < best.busy)) best = w;
    return best;
  }

  chunk(cx, cz) { return this.chunks.get(key(cx, cz)); }

  onWorkerMessage(w, m) {
    w.busy--;
    const c = this.chunk(m.cx, m.cz);
    if (!c) return;
    if (m.type === 'gen') {
      c.blocks = m.blocks;
      c.genPending = false;
      const edits = this.edits.get(c.key);
      if (edits) for (const [i, id] of edits) c.blocks[i] = id;
    } else if (m.type === 'mesh') {
      c.meshPending = false;
      if (m.version !== c.version) return; // an edit happened meanwhile; a newer mesh is coming
      c.meshedVersion = m.version;
      c.maxY = m.maxY;
      this.onMesh(c, m);
    }
  }

  // Load/generate/mesh chunks around the player and drop far ones.
  update(px, pz, radius) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    for (const c of this.chunks.values()) {
      if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cz - pcz)) > radius + 3) {
        this.onUnload(c);
        this.chunks.delete(c.key);
      }
    }

    const wanted = [];
    for (let dz = -radius - 1; dz <= radius + 1; dz++) {
      for (let dx = -radius - 1; dx <= radius + 1; dx++) {
        if (dx * dx + dz * dz > (radius + 1.5) * (radius + 1.5)) continue;
        wanted.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);

    for (const [cx, cz, d2] of wanted) {
      let c = this.chunk(cx, cz);
      if (!c) {
        c = { cx, cz, key: key(cx, cz), blocks: null, genPending: false, meshPending: false, version: 1, meshedVersion: 0, maxY: 0, gpu: null, priority: 0 };
        this.chunks.set(c.key, c);
      }
      if (!c.blocks && !c.genPending) {
        const w = this.pickWorker();
        if (!w) break;
        c.genPending = true;
        w.busy++;
        w.postMessage({ type: 'gen', job: this.nextJob++, seed: this.seed, cx, cz });
      }
    }

    // Mesh edited chunks first, then the nearest unmeshed ones.
    const toMesh = [];
    for (const [cx, cz, d2] of wanted) {
      if (d2 > (radius + 0.5) * (radius + 0.5)) continue;
      const c = this.chunk(cx, cz);
      if (!c || !c.blocks || c.meshPending || c.meshedVersion === c.version) continue;
      if (!this.neighboursReady(cx, cz)) continue;
      toMesh.push([c, c.priority ? -1 : d2]);
    }
    toMesh.sort((a, b) => a[1] - b[1]);
    for (const [c] of toMesh) {
      const w = this.pickWorker();
      if (!w) break;
      c.meshPending = true;
      c.priority = 0;
      w.busy++;
      const vol = this.buildVolume(c.cx, c.cz);
      w.postMessage({ type: 'mesh', job: this.nextJob++, cx: c.cx, cz: c.cz, version: c.version, vol }, [vol.buffer]);
    }
  }

  neighboursReady(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunk(cx + dx, cz + dz);
      if (!n || !n.blocks) return false;
    }
    return true;
  }

  // Copies the chunk plus a PAD-wide border from its neighbours, with a bedrock floor and air ceiling layer.
  buildVolume(cx, cz) {
    const S = PS, SS = S * S, vol = new Uint8Array(VOLUME_SIZE);
    vol.fill(B.BEDROCK, 0, SS);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const src = this.chunk(cx + dx, cz + dz).blocks;
      const x0 = Math.max(0, PAD + dx * CHUNK), x1 = Math.min(S, PAD + dx * CHUNK + CHUNK);
      const z0 = Math.max(0, PAD + dz * CHUNK), z1 = Math.min(S, PAD + dz * CHUNK + CHUNK);
      const lx0 = x0 - (PAD + dx * CHUNK), len = x1 - x0;
      for (let y = 0; y < HEIGHT; y++) {
        for (let pz = z0; pz < z1; pz++) {
          const s = lx0 + (pz - (PAD + dz * CHUNK)) * CHUNK + y * CHUNK * CHUNK;
          vol.set(src.subarray(s, s + len), x0 + pz * S + (y + 1) * SS);
        }
      }
    }
    return vol;
  }

  getBlock(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunk(cx, cz);
    if (!c || !c.blocks) return UNLOADED;
    return c.blocks[(x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK + y * CHUNK * CHUNK];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunk(cx, cz);
    if (!c || !c.blocks) return false;
    const i = (x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK + y * CHUNK * CHUNK;
    c.blocks[i] = id;
    if (!this.edits.has(c.key)) this.edits.set(c.key, new Map());
    this.edits.get(c.key).set(i, id);
    // Light reaches up to 14 blocks, so every neighbour may need a new mesh.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = this.chunk(cx + dx, cz + dz);
      if (n) { n.version++; if (dx === 0 && dz === 0) n.priority = 1; }
    }
    return true;
  }

  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) {
      const list = [];
      for (const [i, id] of m) list.push(i, id);
      if (list.length) out[k] = list;
    }
    return out;
  }

  isReadyAround(x, z, r) {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const c = this.chunk(pcx + dx, pcz + dz);
      if (!c || c.meshedVersion === 0) return false;
    }
    return true;
  }

  // Voxel DDA; returns the first targetable block and the face that was hit.
  raycast(o, d, maxDist) {
    let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
    const sx = Math.sign(d[0]), sy = Math.sign(d[1]), sz = Math.sign(d[2]);
    const tdx = sx ? Math.abs(1 / d[0]) : Infinity, tdy = sy ? Math.abs(1 / d[1]) : Infinity, tdz = sz ? Math.abs(1 / d[2]) : Infinity;
    let tx = sx ? (sx > 0 ? x + 1 - o[0] : o[0] - x) * tdx : Infinity;
    let ty = sy ? (sy > 0 ? y + 1 - o[1] : o[1] - y) * tdy : Infinity;
    let tz = sz ? (sz > 0 ? z + 1 - o[2] : o[2] - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && id !== UNLOADED && RENDER[id] !== R_LIQUID && RENDER[id] !== R_NONE) return { x, y, z, nx, ny, nz, id };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // Cheap light estimate for things drawn outside the chunk meshes (held item, particles).
  lightAt(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    let sky = 15;
    for (let yy = y + 1; yy < HEIGHT; yy++) {
      const id = this.getBlock(x, yy, z);
      if (id !== UNLOADED && OPAQUE[id]) { sky = Math.max(3, 12 - Math.min(9, yy - y)); break; }
    }
    let blk = 0;
    for (let dz = -6; dz <= 6; dz++) for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const e = EMIT[this.getBlock(x + dx, y + dy, z + dz)];
      if (e) blk = Math.max(blk, e - Math.abs(dx) - Math.abs(dy) - Math.abs(dz));
    }
    return { sky, blk: Math.max(0, blk) };
  }
}

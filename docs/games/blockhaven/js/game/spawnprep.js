// Spawn preparation as Java Edition (1.20.1) does it, for the world-generation screen.
//
// The server holds a ticket on the spawn chunk at level 22, which reaches out 11 chunks: every chunk
// within 11 (a 23x23 square) must become FULL, and the rings beyond it only need earlier statuses
// (ChunkStatus.getStatusAroundFullChunk). Chunks climb the status list one step at a time, lowest
// ticket level first, and a step may only run once the neighbours within its range have reached the
// status it depends on (ChunkMap.getDependencyStatus). LevelLoadingScreen draws each chunk's status
// as a coloured 2x2 square on a 47x47 map and shows FULL chunks / 529 (23x23) as the percentage; the server
// is ready once the 441 chunks within 10 are ticking, which needs everything within 11 FULL.
//
// Our generator builds a chunk in one worker job rather than in steps, so that job is the NOISE step
// (the first step that makes terrain): nothing can pass NOISE until its terrain really exists, and the
// map fills exactly as fast as chunks are generated. The other steps are bookkeeping here, taken on the
// main thread once a frame.

export const STATUS = ['empty', 'structure_starts', 'structure_references', 'biomes', 'noise', 'surface', 'carvers',
  'liquid_carvers', 'features', 'light', 'spawn', 'heightmaps', 'full'];
const [EMPTY, STARTS, , BIOMES, NOISE, , , LIQUID, FEATURES, , , , FULL] = STATUS.keys();
// LevelLoadingScreen.COLORS, by status; a chunk with no status yet is drawn black.
export const STATUS_COLOR = ['#545454', '#999999', '#5f6191', '#80b497', '#d1d1d1', '#726809', '#6d665c', '#303572', '#21c600', '#cccccc', '#f26060', '#eeeeee', '#ffffff'];
// How far out from a FULL chunk each status is still required.
const BY_RANGE = [FULL, FEATURES, LIQUID, BIOMES, STARTS, STARTS, STARTS, STARTS, STARTS, STARTS, STARTS, STARTS];
const around = r => (r < 0 ? FULL : r >= BY_RANGE.length ? EMPTY : BY_RANGE[r]);
// ChunkStatus.getDistance, and the neighbourhood each step reads.
const DISTANCE = STATUS.map((_, s) => { let i = 0; while (i + 1 < BY_RANGE.length && s <= BY_RANGE[i + 1]) i++; return i; });
const RANGE = [-1, 0, 8, 8, 8, 8, 8, 8, 8, 1, 0, 0, 0];

export const SPAWN_RADIUS = 11; // the level-22 spawn ticket
export const MAP_RADIUS = SPAWN_RADIUS + BY_RANGE.length; // StoringChunkProgressListener: 23, a 47x47 map
const D = MAP_RADIUS * 2 + 1;
export const SPAWN_CHUNKS = (SPAWN_RADIUS * 2 + 1) ** 2;

export class SpawnPrep {
  // world: { chunk(cx, cz), generate(cx, cz) -> false while every worker is busy }
  constructor(world, cx, cz) {
    this.world = world; this.cx = cx; this.cz = cz;
    this.status = new Int8Array(D * D).fill(-1);
    this.target = new Int8Array(D * D);
    // mins[l][i]: the lowest status within l of chunk i (off the map counts as none).
    this.mins = Array.from({ length: 9 }, () => new Int8Array(D * D));
    this.pending = new Set();
    this.full = 0;
    for (let i = 0; i < D * D; i++) this.target[i] = around(this.dist(i) - SPAWN_RADIUS);
    // Lowest ticket level first; within a level, nearest first.
    const order = [...this.status.keys()];
    const e2 = i => (i % D - MAP_RADIUS) ** 2 + (Math.floor(i / D) - MAP_RADIUS) ** 2;
    this.order = order.sort((a, b) => this.dist(a) - this.dist(b) || e2(a) - e2(b));
  }
  dist(i) { return Math.max(Math.abs(i % D - MAP_RADIUS), Math.abs(Math.floor(i / D) - MAP_RADIUS)); }
  get progress() { return Math.min(100, Math.floor(this.full * 100 / SPAWN_CHUNKS)); }
  get done() { return this.full >= SPAWN_CHUNKS; }
  // Status of the map cell (x, z), 0..46 from the north-west corner; -1 when it has none yet.
  statusAt(x, z) { return this.status[x + z * D]; }

  // One scheduling pass (call once a frame): every chunk takes the steps its neighbours allow, as
  // they stood at the start of the pass, so each dependency costs a frame, much like the server's
  // tick-by-tick task queue. Generation jobs go out nearest-first while workers are free.
  update() {
    for (const i of this.pending) {
      const c = this.world.chunk(this.cx + i % D - MAP_RADIUS, this.cz + Math.floor(i / D) - MAP_RADIUS);
      if (c && (c.ids || c.failed >= 3)) { this.pending.delete(i); this.set(i, NOISE); }
    }
    this.erode();
    let workersFree = true;
    for (const i of this.order) {
      while (this.status[i] < this.target[i]) {
        const next = this.status[i] + 1;
        if (!this.ready(i, next)) break;
        if (next === NOISE) {
          const x = this.cx + i % D - MAP_RADIUS, z = this.cz + Math.floor(i / D) - MAP_RADIUS, c = this.world.chunk(x, z);
          if (!(c && c.ids)) {
            if (!this.pending.has(i) && workersFree) { if (this.world.generate(x, z)) this.pending.add(i); else workersFree = false; }
            break;
          }
        }
        this.set(i, next);
      }
    }
  }
  // May chunk i take the step to status s? Every neighbour at distance l within the step's range
  // must have reached the status s depends on at that distance. That requirement only falls with
  // distance, so the lowest status within l standing in for ring l's is the same test.
  ready(i, s) {
    for (let l = 1; l <= RANGE[s]; l++) if (this.mins[l][i] < around(DISTANCE[s] + l)) return false;
    return true;
  }
  // mins[l] from mins[l - 1] by taking the lowest of each 3x3 neighbourhood.
  erode() {
    this.mins[0].set(this.status);
    for (let l = 1; l < this.mins.length; l++) {
      const a = this.mins[l - 1], b = this.mins[l];
      for (let z = 0; z < D; z++) for (let x = 0; x < D; x++) {
        let m = 127;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, nz = z + dz;
          const v = nx < 0 || nz < 0 || nx >= D || nz >= D ? -1 : a[nx + nz * D];
          if (v < m) m = v;
        }
        b[x + z * D] = m;
      }
    }
  }
  set(i, s) {
    if (this.status[i] >= s) return;
    this.status[i] = s;
    if (s === FULL) this.full++;
  }
}

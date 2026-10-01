import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { SpawnPrep, STATUS, MAP_RADIUS, SPAWN_CHUNKS } = await load('game/spawnprep.js');
const S = Object.fromEntries(STATUS.map((s, i) => [s, i]));
const D = MAP_RADIUS * 2 + 1;

// A world whose workers each finish one chunk per tick.
function fakeWorld(workers = 4) {
  const chunks = new Map(), jobs = [], calls = [];
  return {
    calls,
    chunk: (x, z) => chunks.get(`${x},${z}`),
    generate(x, z) {
      if (jobs.length >= workers) return false;
      const c = { ids: null }; chunks.set(`${x},${z}`, c); jobs.push(c); calls.push([x, z]);
      return true;
    },
    tick() { for (const c of jobs.splice(0)) c.ids = true; },
  };
}
function run(prep, world, maxTicks = 5000) {
  for (let t = 0; t < maxTicks && !prep.done; t++) { prep.update(); world.tick(); }
  prep.update();
}
const ring = (x, z) => Math.max(Math.abs(x - MAP_RADIUS), Math.abs(z - MAP_RADIUS));

test('ends with the rings the level-22 spawn ticket leaves', () => {
  const w = fakeWorld(), prep = new SpawnPrep(w, 5, -3);
  run(prep, w);
  assert.equal(prep.progress, 100); assert.ok(prep.done);
  const want = d => (d <= 11 ? 'full' : d === 12 ? 'features' : d === 13 ? 'liquid_carvers' : d === 14 ? 'biomes' : d <= 22 ? 'structure_starts' : 'empty');
  for (let z = 0; z < D; z++) for (let x = 0; x < D; x++) assert.equal(STATUS[prep.statusAt(x, z)], want(ring(x, z)), `cell ${x},${z}`);
  // Terrain is generated for every chunk that needs NOISE or later: 13 out, a 27x27 square.
  assert.equal(w.calls.length, 27 * 27);
  assert.equal(SPAWN_CHUNKS, 529); // LoggerChunkProgressListener(11): (2 * 11 + 1)^2
});

test('generation starts at the spawn chunk and spreads outwards', () => {
  const w = fakeWorld(1), prep = new SpawnPrep(w, 10, 20);
  run(prep, w);
  assert.deepEqual(w.calls[0], [10, 20]);
  const d = ([x, z]) => Math.max(Math.abs(x - 10), Math.abs(z - 20));
  for (let i = 1; i < w.calls.length; i++) assert.ok(d(w.calls[i]) >= d(w.calls[i - 1]) - 1, `call ${i} jumps back inwards`);
});

test('nothing passes BIOMES before its terrain exists, and the percentage counts FULL chunks', () => {
  const w = fakeWorld(); w.tick = () => {}; // workers never finish
  const prep = new SpawnPrep(w, 0, 0);
  for (let t = 0; t < 50; t++) prep.update();
  for (let z = 0; z < D; z++) for (let x = 0; x < D; x++) assert.ok(prep.statusAt(x, z) <= S.biomes);
  assert.equal(prep.progress, 0);
  assert.equal(w.calls.length, 4); // one job per free worker
});

test('every step waits for its neighbours, as in ChunkMap.getDependencyStatus', () => {
  const w = fakeWorld(3), prep = new SpawnPrep(w, 0, 0);
  const at = (x, z) => (x < 0 || z < 0 || x >= D || z >= D ? -1 : prep.statusAt(x, z));
  for (let t = 0; t < 400 && !prep.done; t++) {
    prep.update(); w.tick();
    // FULL needs every neighbour at FEATURES or later (LIGHT's range of 1), and FEATURES needs
    // neighbours at LIQUID_CARVERS; nothing can be FULL next to an ungenerated chunk.
    for (let z = 0; z < D; z++) for (let x = 0; x < D; x++) {
      const s = prep.statusAt(x, z);
      if (s >= S.light) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) assert.ok(at(x + dx, z + dz) >= S.features);
      if (s >= S.features) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) assert.ok(at(x + dx, z + dz) >= S.liquid_carvers);
    }
  }
});

test('the bookkeeping steps cost frames, not generation time', () => {
  // With four workers each finishing a chunk per frame, the 729 terrain jobs need 183 frames; the
  // dependency steps around them add only a handful more.
  const w = fakeWorld(4), prep = new SpawnPrep(w, 0, 0);
  let frames = 0;
  while (!prep.done && frames < 1000) { prep.update(); w.tick(); frames++; }
  assert.ok(prep.done);
  assert.ok(frames < 183 + 30, `took ${frames} frames`);
});

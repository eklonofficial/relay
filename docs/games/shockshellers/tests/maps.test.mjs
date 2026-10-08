// The map list: the imported maps load and stand up, PLAY draws only from them through playlists,
// and both sets sort into size classes with a natural number of players.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from './load.mjs';
const { loadMaps, MAPS, getMap, mapDef, pickPublicMap, mapsBySize, sizeOf, naturalPlayers, walkable, SIZES } = await load('maps/index.js');
const { playlists, nextInPlaylist, randomPlaylist } = await load('maps/playlists.js');
const { PIECES, PIECE, ladderFacing, rotateBox, orient } = await load('maps/pieces.js');
const { MapGrid } = await load('maps/grid.js');
const { stepBody, makeBody } = await load('sim/movement.js');
const { CTRL } = await load('sim/tuning.js');
const { loadBlocks, blockMesh } = await load('render/blocks.js');
const { BLOCKS } = await load('maps/blocks.js');
before(async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async url => new Response(await readFile(new URL(url)));
  try { await Promise.all([loadMaps(), loadBlocks()]); } finally { globalThis.fetch = fetchOriginal; }
});
const fresh = () => MAPS.filter(m => m.set === 'new');

test('the new maps load, and only they are public', () => {
  assert.ok(fresh().length >= 90, `${fresh().length} new maps`);
  assert.deepEqual(MAPS.filter(m => m.public).map(m => m.set), fresh().map(() => 'new'));
  for (let i = 0; i < 40; i++) assert.equal(mapDef(pickPublicMap('ffa')).set, 'new');
});

test('every new map has spawns standing on the floor and in the clear', () => {
  for (const def of fresh()) {
    const { grid, spawns } = getMap(def.id);
    assert.ok(spawns.length >= 2, `${def.id} has spawns`);
    for (const s of spawns) {
      assert.ok(Math.abs(grid.floorBelow(s.x, s.y + 0.5, s.z) - s.y) < 0.05, `${def.id} spawn at ${s.x},${s.y},${s.z} stands on the floor`);
      assert.ok(!grid.collides(s.x, s.y + 0.32, s.z, 0.28), `${def.id} spawn at ${s.x},${s.y},${s.z} is clear`);
    }
  }
});

test('each set sorts largest first into size classes, with a natural number of players', () => {
  for (const set of ['new', 'legacy']) {
    const list = mapsBySize(set);
    for (let i = 1; i < list.length; i++) assert.ok(walkable(list[i - 1]) >= walkable(list[i]));
    for (const m of list) {
      const n = naturalPlayers(m);
      assert.ok(n >= 2 && n <= m.maxPlayers, `${m.id}: ${n} players`);
      if (sizeOf(m).id === 'duel') assert.equal(n, 2);
    }
  }
  const classes = new Set(fresh().map(m => sizeOf(m).id));
  for (const s of SIZES) assert.ok(classes.has(s.id), `some new map is ${s.name}`);
});

test('playlists deal every non-1v1 new map once, each list a mix of sizes', () => {
  const lists = playlists(), dealt = lists.flatMap(l => l.maps);
  assert.equal(new Set(dealt).size, dealt.length, 'no map twice');
  assert.deepEqual(new Set(dealt), new Set(fresh().filter(m => sizeOf(m).id !== 'duel').map(m => m.id)));
  for (const l of lists) {
    assert.ok(l.maps.length >= 4 && l.maps.length <= 8, `${l.name}: ${l.maps.length} maps`);
    assert.ok(new Set(l.maps.map(id => sizeOf(mapDef(id)).id)).size >= 2, `${l.name} mixes sizes`);
  }
  assert.notEqual(randomPlaylist(Math.random, lists[0].id), lists[0].id);
});

test('rounds on a playlist go through it in order and come back round', () => {
  const l = playlists()[0], seen = [];
  let at = null;
  for (let i = 0; i < l.maps.length * 2; i++) { at = nextInPlaylist(l.id, at, 'ffa'); seen.push(at); }
  const ffa = l.maps.filter(id => mapDef(id).modes.includes('ffa'));
  assert.deepEqual(seen, [...ffa, ...ffa]);
});

test("the new maps' ladders climb: walk up to one holding forward and come off the top", () => {
  let tried = 0, climbed = 0;
  for (const def of fresh()) {
    const g = getMap(def.id).grid;
    for (let y = 1; y < g.h; y++) for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) {
      const p = PIECES[g.get(x, y, z)];
      if (p.kind !== 'ladder' || PIECES[g.get(x, y - 1, z)].kind === 'ladder') continue;
      let top = y; while (PIECES[g.get(x, top + 1, z)].kind === 'ladder') top++;
      const [fx, fz] = ladderFacing(p, g.getRot(x, y, z)), sx = x + 0.5 - fx * 0.9, sz = z + 0.5 - fz * 0.9, floor = g.floorBelow(sx, y + 0.6, sz);
      if (!(floor > y - 1.2) || g.collides(sx, floor + 0.35, sz, 0.3) || g.collides(sx, floor + 1.2, sz, 0.3)) continue;
      const b = makeBody(sx, floor, sz); b.yaw = Math.atan2(-fx, -fz);
      tried++;
      for (let t = 0; t < 400; t++) { stepBody(g, b, CTRL.up); if (b.y >= top + 0.95 && !b.climbing) { climbed++; break; } }
    }
  }
  assert.ok(tried > 300, `${tried} ladders`);
  assert.ok(climbed / tried > 0.97, `${climbed} of ${tried} climbed`);
});

test('every imported piece with a mesh has one to draw', () => {
  const missing = BLOCKS.flatMap((b, i) => b.mesh && !blockMesh([i, 0, 0, 0, 0]).children[0]?.geometry.index.count ? [b.name] : []);
  assert.deepEqual(missing, []);
});

test("faces pressed against a neighbour are left out, and each chunk of columns is its own mesh", () => {
  const cube = BLOCKS.findIndex(b => b.name === 'scifi.ground.full'), tris = m => m.children.reduce((n, c) => n + c.geometry.index.count / 3, 0);
  const one = tris(blockMesh([cube, 0, 0, 0, 0])), row = [];
  for (let x = 0; x < 20; x++) row.push(cube, x, 0, 0, x & 3);
  const m = blockMesh(row);
  assert.ok(tris(m) < one * 20 * 0.9, `${tris(m)} triangles for 20 (alone ${one})`);
  assert.equal(m.children.length, 3, 'three chunks of 8 columns');
});

// A floor (top at y = 1) with one imported piece at (5, 1, 5), turned by code.
function stage(name, code = 0) {
  const g = new MapGrid(11, 8, 11);
  for (let x = 0; x < 11; x++) for (let z = 0; z < 11; z++) g.set(x, 0, z, PIECE.block);
  g.set(5, 1, 5, PIECE['b:' + name], code);
  return g;
}
const walk = (g, x, z, yaw, ticks) => { const b = makeBody(x, 1, z); b.yaw = yaw; let top = 1; for (let t = 0; t < ticks; t++) { stepBody(g, b, CTRL.up); top = Math.max(top, b.y); } return { b, top }; };

test('orientations: quarter turns about y as before, and pieces tipped and flipped by rx and rz', () => {
  const box = [0.1, 0, 0.2, 0.4, 0.5, 0.9];
  // The old turn: (x0, z0, x1, z1) -> (z0, 1 - x1, z1, 1 - x0) per quarter turn about y.
  assert.deepEqual(rotateBox(box, 1).map(v => +v.toFixed(6)), [0.2, 0, 0.6, 0.9, 0.5, 0.9]);
  // Upside down (rz = 2): a floor slab becomes a ceiling slab; rx = rz = 2 is a half turn about y.
  assert.deepEqual(rotateBox([0, 0, 0, 1, 0.25, 1], 2 << 4).map(v => +v.toFixed(6)), [0, 0.75, 0, 1, 1, 1]);
  assert.deepEqual(rotateBox(box, (2 << 2) | (2 << 4)), rotateBox(box, 2));
  // Every code is a proper rotation (no mirroring: meshes keep their winding).
  for (let c = 0; c < 64; c++) { const R = orient(c), det = R[0][0] * (R[1][1] * R[2][2] - R[1][2] * R[2][1]) - R[0][1] * (R[1][0] * R[2][2] - R[1][2] * R[2][0]) + R[0][2] * (R[1][0] * R[2][1] - R[1][1] * R[2][0]); assert.equal(det, 1); }
});

test('a tunnel piece is walked through along its length (and walled across it)', () => {
  const g = stage('generic.pavement-tunnel.aabb');
  assert.ok(walk(g, 3.5, 5.5, -Math.PI / 2, 60).b.x > 6.5, 'through along x');
  assert.ok(walk(g, 5.5, 3.5, Math.PI, 60).b.z < 4.9, 'stopped by its wall along z');
  // Turned a quarter, it runs along z.
  assert.ok(walk(stage('generic.pavement-tunnel.aabb', 1), 5.5, 3.5, Math.PI, 60).b.z > 6.5);
});

test('stairs and ramps are walked up from their foot, whichever way they are turned', () => {
  for (const name of ['generic.stairs.wedge', 'castle.stairs.wedge', 'town.stairs.wedge', 'generic.metal-ramp.wedge']) {
    for (let r = 0; r < 4; r++) {
      const g = stage(name, r), bx = g.boxes(5, 1, 5);
      // The high side: the edge whose column is tallest.
      const h = (dx, dz) => Math.max(0, ...bx.filter(b => 0.5 + dx * 0.45 >= b[0] && 0.5 + dx * 0.45 <= b[3] && 0.5 + dz * 0.45 >= b[2] && 0.5 + dz * 0.45 <= b[5]).map(b => b[4]));
      const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort((a, b) => h(...b) - h(...a))[0];
      g.set(5 + dx, 1, 5 + dz, PIECE.block);   // something to step off onto
      const { top } = walk(g, 5.5 - dx * 1.2, 5.5 - dz * 1.2, Math.atan2(-dx, -dz), 90);
      assert.ok(top > 1.95, `${name} turned ${r}: reached ${top.toFixed(2)}`);
    }
  }
});

test('an imported jump pad launches whoever stands on it', () => {
  const g = stage('INTERACTIVE.jump-pad.full'), b = makeBody(5.5, 2.02, 5.5);
  let launched = false, top = 0;
  for (let t = 0; t < 60; t++) { if (stepBody(g, b, 0) === 'pad') launched = true; top = Math.max(top, b.y); }
  assert.ok(launched && top > 4, `launched ${launched}, up to ${top.toFixed(2)}`);
});

// The map list: the imported maps load and stand up, PLAY draws only from them through playlists,
// and both sets sort into size classes with a natural number of players.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { load } from './load.mjs';
const { loadMaps, MAPS, getMap, mapDef, pickPublicMap, mapsBySize, sizeOf, naturalPlayers, walkable, SIZES } = await load('maps/index.js');
const { playlists, nextInPlaylist, randomPlaylist } = await load('maps/playlists.js');
const { PIECES, ladderFacing } = await load('maps/pieces.js');
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
  const missing = BLOCKS.flatMap((b, i) => b.mesh && !blockMesh([i, 0, 0, 0, 0]).geometry.attributes.position.count ? [b.name] : []);
  assert.deepEqual(missing, []);
});

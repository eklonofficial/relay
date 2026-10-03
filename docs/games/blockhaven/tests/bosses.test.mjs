// entity/bosses.js: the wither and the ender dragon on Java's models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { dragonPose, dragonHistory, witherPose } = await load('entity/bosses.js');
const { texFactor } = await load('render/mobtex.js');
const { MOBS } = await load('data/mobs.js');

test('the bosses name their pack textures; the dragon keeps its 256x256 skin at half size', () => {
  const w = MOBS.wither.model(), d = MOBS.ender_dragon.model();
  assert.equal(w.texture, 'entity/wither/wither'); assert.equal(MOBS.wither.scale, 2);
  assert.deepEqual(d.texture, ['entity/enderdragon/dragon', 'entity/enderdragon/dragon_eyes']);
  assert.deepEqual(d.texSize, [256, 256]); assert.equal(texFactor(d), 2); assert.equal(texFactor(w), 1);
});

test('the dragon lays its neck and tail along its flight history', () => {
  const m = MOBS.ender_dragon.model(), straight = {}, turning = {};
  for (let i = 0; i < 64; i++) { dragonHistory(straight, 0, 64); dragonHistory(turning, i * 3, 64); }
  const s = dragonPose(m, { history: straight }), t = dragonPose(m, { history: turning });
  // Flying straight and level, the five neck pieces run straight ahead, 10 px apart.
  for (let i = 1; i < 5; i++) assert.ok(Math.abs(s.pivots[`neck${i}`][2] - s.pivots[`neck${i - 1}`][2] + 10) < 0.2, `neck ${i}`);
  assert.ok(Math.abs(s.pivots.neck4[0]) < 1e-6);
  assert.ok(Math.abs(t.pivots.neck4[0]) > 1, 'turning, the neck curves');
  const perched = dragonPose(m, { history: straight, perch: 1 });
  assert.ok(perched.pivots.head[1] < s.pivots.head[1] - 5, 'perched, the head bows');
  const wp = witherPose(MOBS.wither.model(), { age: 0 });
  assert.ok(wp.pivots.tail);
});

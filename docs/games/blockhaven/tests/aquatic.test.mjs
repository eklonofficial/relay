// entity/aquatic.js: the water mobs' Java models, texture layouts and poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { squidPose, fishPose, guardianPose, axolotlPose } = await load('entity/aquatic.js');
const { MOBS } = await load('data/mobs.js');

test('each water mob names its pack texture and Java texture size', () => {
  const want = { squid: ['entity/squid/squid', 64, 32], glow_squid: ['entity/squid/glow_squid', 64, 32], cod: ['entity/fish/cod', 32, 32], salmon: ['entity/fish/salmon', 32, 32],
    tropical_fish: ['entity/fish/tropical_a', 32, 32], pufferfish: ['entity/fish/pufferfish', 32, 32], guardian: ['entity/guardian', 64, 64], elder_guardian: ['entity/guardian_elder', 64, 64],
    dolphin: ['entity/dolphin', 64, 64], turtle: ['entity/turtle/big_sea_turtle', 128, 64], axolotl: ['entity/axolotl/axolotl_lucy', 64, 64] };
  for (const [k, [tex, w, h]] of Object.entries(want)) {
    const m = MOBS[k].model();
    assert.ok(m.java, k); assert.equal(m.texture, tex, k); assert.deepEqual(m.texSize, [w, h], k);
  }
  assert.equal(MOBS.tropical_fish.overlay().texture, 'entity/fish/tropical_a_pattern_1');
  assert.ok(MOBS.tropical_fish.model().tint, 'tinted by its base colour');
  assert.equal(MOBS.pufferfish.forms.big().puff, 2);
});

test('poses: squid tentacles, a stranded fish thrashing, guardian spikes and eye, an axolotl swimming', () => {
  const sq = squidPose(MOBS.squid.model(), { tentacleAngle: 0.5 });
  assert.equal(sq.poses.tentacle3[0], -0.5);
  const cod = MOBS.cod.model(), age = 2;
  assert.ok(Math.abs(fishPose(cod, { age, inWater: false }).poses.tailFin[1] / fishPose(cod, { age, inWater: true }).poses.tailFin[1] - 1.5) < 1e-9);
  const g = MOBS.guardian.model(), out = guardianPose(g, { spikes: 0 }), drawn = guardianPose(g, { spikes: 0.55 });
  const fromMiddle = ([x, y, z]) => Math.hypot(x, y + 16, z); // (the spikes sit round the body's middle, 16 down)
  assert.ok(fromMiddle(drawn.pivots.spike2) < fromMiddle(out.pivots.spike2) * 0.5, 'spikes draw in');
  assert.deepEqual(guardianPose(g, { eye: [2, 1] }).pivots.eye, [-2, -1, -8.25]);
  const ax = axolotlPose(MOBS.axolotl.model(), { inWater: true, moving: true, age: 5 });
  assert.ok(Math.abs(ax.poses.leftHindLeg[0] + 1.8849558) < 1e-6 && Math.abs(ax.poses.rightHindLeg[0] + 1.8849558) < 1e-6, 'hind legs swept back together');
});

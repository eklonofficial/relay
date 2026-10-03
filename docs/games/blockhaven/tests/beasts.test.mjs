// entity/beasts.js: the golems' and beasts' Java models, texture layouts and poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { ironGolemPose, hoglinPose, ravagerPose, snowGolemPose } = await load('entity/beasts.js');
const { MOBS } = await load('data/mobs.js');

test('each beast names its pack texture and Java texture size', () => {
  const want = { iron_golem: ['entity/iron_golem/iron_golem', 128, 128], snow_golem: ['entity/snow_golem', 64, 64], hoglin: ['entity/hoglin/hoglin', 128, 64],
    strider: ['entity/strider/strider', 64, 128], ravager: ['entity/illager/ravager', 128, 128] };
  for (const [k, [tex, w, h]] of Object.entries(want)) {
    const m = MOBS[k].model();
    assert.ok(m.java, k); assert.equal(m.texture, tex, k); assert.deepEqual(m.texSize, [w, h], k);
  }
  assert.deepEqual(MOBS.iron_golem.variants.high, ['entity/iron_golem/iron_golem', 'entity/iron_golem/iron_golem_crackiness_high']);
  assert.equal(MOBS.strider.variants.cold, 'entity/strider/strider_cold');
});

test('poses: golem arms come down together, a hoglin gores, a ravager lunges, a snow golem turns', () => {
  const g = ironGolemPose(MOBS.iron_golem.model(), { attackTicks: 10 });
  assert.equal(g.poses.rightArm[0], g.poses.leftArm[0]);
  assert.ok(Math.abs(g.poses.rightArm[0] - (2 - 1.5)) < 1e-9, 'both arms at -2 + 1.5 at the blow');
  const calm = hoglinPose(MOBS.hoglin.model(), {}), gore = hoglinPose(MOBS.hoglin.model(), { attackTicks: 5 });
  assert.ok(Math.abs(calm.poses.head[0] + 0.87266463) < 1e-6 && Math.abs(gore.poses.head[0] - 0.34906584) < 1e-6);
  const rv = MOBS.ravager.model();
  assert.ok(ravagerPose(rv, { attackTicks: 5 }).pivots.neck[2] < ravagerPose(rv, {}).pivots.neck[2], 'the neck lunges forward');
  const sg = snowGolemPose(MOBS.snow_golem.model(), { headYaw: 1 });
  assert.ok(Math.abs(sg.poses.upperBody[1] + 0.25) < 1e-9);
});

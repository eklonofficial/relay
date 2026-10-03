// entity/monsters.js: the monsters' Java models, texture layouts and poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { spiderPose, endermanPose, magmaPose, blazePose } = await load('entity/monsters.js');
const { MOBS } = await load('data/mobs.js');

test('each monster names its pack texture and Java texture size', () => {
  const want = { creeper: 'entity/creeper/creeper', spider: 'entity/spider/spider,entity/spider_eyes', cave_spider: 'entity/spider/cave_spider,entity/spider_eyes',
    enderman: 'entity/enderman/enderman,entity/enderman/enderman_eyes', slime: 'entity/slime/slime', magma_cube: 'entity/slime/magmacube', silverfish: 'entity/silverfish',
    endermite: 'entity/endermite', blaze: 'entity/blaze', ghast: 'entity/ghast/ghast', phantom: 'entity/phantom,entity/phantom_eyes' };
  for (const [k, tex] of Object.entries(want)) {
    const m = MOBS[k].model();
    assert.ok(m.java, k); assert.equal([].concat(m.texture).join(), tex, k);
    assert.deepEqual(m.texSize, k === 'phantom' ? [64, 64] : [64, 32], k);
  }
  assert.ok(MOBS.slime.overlay().clear, "the slime's outer jelly is drawn see-through");
  assert.equal(MOBS.ghast.scale, 4.5);
});

test('ghast tentacles and silverfish segments are laid out as the game builds them', () => {
  const g = MOBS.ghast.model();
  assert.deepEqual(Array.from({ length: 9 }, (_, i) => g.parts[`tentacle${i}`].boxes[0].s[1]), [8, 13, 9, 11, 11, 10, 12, 9, 12]);
  assert.deepEqual(g.parts.tentacle0.pivot, [3.75, -0.6000000000000014, -5]);
  const s = MOBS.silverfish.model();
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => s.parts[`segment${i}`].pivot[2]), [-3.5, -1.5, 1, 4, 7, 9.5, 11.5]);
});

test('poses: spider legs splay, an enderman screams, magma slices part, blaze rods circle', () => {
  const sp = spiderPose(MOBS.spider.model(), {});
  assert.ok(Math.abs(sp.poses.rightFrontLeg[2] + Math.PI / 4) < 1e-9 && Math.abs(sp.poses.leftFrontLeg[2] - Math.PI / 4) < 1e-9);
  const em = MOBS.enderman.model(), calm = endermanPose(em, {}), angry = endermanPose(em, { creepy: true });
  assert.equal(angry.pivots.head[1] - calm.pivots.head[1], 5, 'the head lifts 5 off the jaw');
  assert.deepEqual(angry.pivots.hat, calm.pivots.hat);
  const walk = endermanPose(em, { limbSwing: 0, limbAmt: 1 });
  assert.ok(Math.abs(walk.poses.leftLeg[0]) <= 0.4 + 1e-9, 'limbs held within 0.4');
  const mc = magmaPose(MOBS.magma_cube.model(), { squish: 1 });
  assert.ok(Math.abs(mc.pivots.cube0[1] - (24 + 4 * 1.7)) < 1e-9 && Math.abs(mc.pivots.cube4[1] - 24) < 1e-9);
  const bz = blazePose(MOBS.blaze.model(), { age: 0 });
  assert.ok(Math.abs(Math.hypot(bz.pivots.part0[0], bz.pivots.part0[2]) - 9) < 1e-9 && Math.abs(Math.hypot(bz.pivots.part8[0], bz.pivots.part8[2]) - 5) < 1e-9);
});

// entity/critters.js: the small creatures' Java models, poses and keyframe animations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { animate, restParts, rabbitPose, camelPose, frogPose, FROG_WALK, CAMEL_WALK } = await load('entity/critters.js');
const { MOBS } = await load('data/mobs.js');

test('each creature names its pack texture and Java texture size', () => {
  const want = { rabbit: ['entity/rabbit/brown', 64, 32], ocelot: ['entity/cat/ocelot', 64, 32], panda: ['entity/panda/panda', 64, 64], parrot: ['entity/parrot/parrot_red_blue', 32, 32],
    bat: ['entity/bat', 64, 64], frog: ['entity/frog/temperate_frog', 48, 48], camel: ['entity/camel/camel', 128, 128] };
  for (const [k, [tex, w, h]] of Object.entries(want)) {
    const m = MOBS[k].model();
    assert.ok(m.java, k); assert.equal(m.texture, tex, k); assert.deepEqual(m.texSize, [w, h], k);
  }
  assert.equal(MOBS.rabbit.scale, 0.6); assert.equal(MOBS.bat.scale, 0.35);
});

test('keyframes play as KeyframeAnimations does: linear between keys, looping, scaled', () => {
  const def = { len: 1, loop: true, bones: { a: [['r', [[0, 0, 0, 0], [0.5, 1, 0, 0], [1, 0, 0, 0]]], ['p', [[0, 0, 2, 0], [1, 0, 2, 0]]]] } };
  const p = { a: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 } };
  animate(p, def, 1.25, 0.5);
  assert.ok(Math.abs(p.a.rx - 0.25) < 1e-9, 'a quarter of the way up, at half strength');
  assert.equal(p.a.y, 1);
  assert.equal(FROG_WALK.len, 1.25); assert.ok(CAMEL_WALK.loop);
});

test('poses: a rabbit kicks through its jump, a camel walks and shows its tack only when saddled', () => {
  const r = MOBS.rabbit.model(), still = rabbitPose(r, {}), mid = rabbitPose(r, { jump: 0.5 });
  assert.ok(Math.abs(-mid.poses.leftHindFoot[0] - 50 * Math.PI / 180) < 1e-9 && still.poses.leftHindFoot[0] === 0);
  const c = MOBS.camel.model();
  assert.equal(camelPose(c, {}).poses.hide.saddle, true);
  assert.equal(camelPose(c, { saddled: true, ridden: true }).poses.hide.reins, false);
  const walk = camelPose(c, { limbSwing: 10, limbAmt: 1 });
  assert.notDeepEqual(walk.poses.rightFrontLeg, camelPose(c, {}).poses.rightFrontLeg);
  assert.ok(frogPose(MOBS.frog.model(), {}).poses.hide.croakingBody);
  assert.equal(restParts(c).head.z, -19.5);
});

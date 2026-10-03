// entity/animals.js: the animals' Java models, texture layouts and poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { animalPose, wolfPose, chickenPose } = await load('entity/animals.js');
const { MOBS } = await load('data/mobs.js');

test('each animal names its pack texture and Java texture size', () => {
  const want = { pig: ['entity/pig/pig', 64, 32], cow: ['entity/cow/cow', 64, 32], mooshroom: ['entity/cow/red_mooshroom', 64, 32], sheep: ['entity/sheep/sheep', 64, 32],
    chicken: ['entity/chicken', 64, 32], wolf: ['entity/wolf/wolf', 64, 32], fox: ['entity/fox/fox', 48, 32], polar_bear: ['entity/bear/polarbear', 128, 64],
    goat: ['entity/goat/goat', 64, 64], llama: ['entity/llama/creamy', 128, 64], horse: ['entity/horse/horse_brown', 64, 64], donkey: ['entity/horse/donkey', 64, 64] };
  for (const [k, [tex, w, h]] of Object.entries(want)) {
    const m = MOBS[k].model();
    assert.equal(m.texture, tex, k); assert.deepEqual(m.texSize, [w, h], k); assert.ok(m.java, k);
  }
  assert.equal(MOBS.sheep.overlay().texture, 'entity/sheep/sheep_fur');
  assert.deepEqual(MOBS.wolf.variants, { tame: 'entity/wolf/wolf_tame', angry: 'entity/wolf/wolf_angry' });
});

test('QuadrupedModel layout: pig snout, cow horns and udder, unmirrored legs', () => {
  const pig = MOBS.pig.model(), cow = MOBS.cow.model();
  assert.equal(pig.parts.head.boxes[1].uv.join(), '16,16');
  assert.equal(cow.parts.head.boxes.length, 3); assert.equal(cow.parts.body.boxes[1].uv.join(), '52,0');
  assert.ok(!cow.parts.leftHindLeg.boxes[0].mirror, 'every leg uses the same texture, unmirrored (1.20.1)');
  assert.ok(Math.abs(cow.parts.body.rot[0] + Math.PI / 2) < 1e-9, 'body lies along the animal');
});

test('legs swing in diagonal pairs; a tame wolf holds its tail up by its health', () => {
  const { poses } = animalPose(MOBS.cow.model(), { limbSwing: 1, limbAmt: 1 });
  assert.ok(Math.abs(poses.rightHindLeg[0] - poses.leftFrontLeg[0]) < 1e-9 && Math.abs(poses.rightHindLeg[0] + poses.leftHindLeg[0]) < 1e-9);
  const wolf = MOBS.wolf.model();
  const full = wolfPose(wolf, { tamed: true, health: 20 }).poses.tail[0], hurt = wolfPose(wolf, { tamed: true, health: 4 }).poses.tail[0];
  assert.ok(Math.abs(full) > Math.abs(hurt), 'a hurt tame wolf drops its tail');
  const sit = wolfPose(wolf, { sitting: true });
  assert.ok(sit.pivots.body[1] < wolf.parts.body.pivot[1], 'sitting lowers the body');
  assert.ok(sit.pivots.rightHindLeg[1] < wolf.parts.rightHindLeg.pivot[1], 'and folds the hind legs down');
});

test('a chicken beats its wings in the air and folds them on the ground', () => {
  const m = MOBS.chicken.model();
  assert.equal(chickenPose(m, { flap: 0 }).poses.rightWing[2], 0);
  assert.ok(chickenPose(m, { flap: 1.5 }).poses.rightWing[2] > 1);
});

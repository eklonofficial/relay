// entity/javamodels.js: the villager family, witch, illager and piglin models and poses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { illagerPose, villagerPose, piglinPose } = await load('entity/javamodels.js');
const { MOBS } = await load('data/mobs.js');
const { paintModel, faceRects, ENTITY } = await load('render/mobtex.js');

test('villagers: a 10-tall head, folded arms, a hat with its brim, and their pack layers in order', () => {
  const v = MOBS.villager.professionModel('librarian');
  assert.deepEqual(v.parts.head.boxes[0].s, [8, 10, 8]);
  assert.equal(v.parts.hatRim.parent, 'hat');
  assert.ok(Math.abs(v.parts.arms.rot[0] - 0.75) < 1e-9, 'arms folded 0.75 rad');
  assert.deepEqual(v.texture, ['entity/villager/villager', 'entity/villager/type/plains', 'entity/villager/profession/librarian']);
});

test('the witch: a 64x128 texture with the hat stacked tier on tier', () => {
  const w = MOBS.witch.model();
  assert.deepEqual(w.texSize, [64, 128]);
  assert.equal(w.parts.hat4.parent, 'hat3'); assert.equal(w.parts.hat3.parent, 'hat2'); assert.equal(w.parts.hat.parent, 'head');
  assert.equal(w.parts.hat2.boxes[0].uv.join(), '0,76');
  assert.ok(!w.parts.hatRim);
});

test('illagers fold their arms unless using them', () => {
  assert.ok(illagerPose({ armPose: 'crossed' }).poses.hide.rightArm);
  const cast = illagerPose({ armPose: 'spellcasting' }).poses;
  assert.ok(cast.hide.arms && cast.rightArm[2] > 2, 'arms raised to the sides');
  const swing = illagerPose({ armPose: 'attacking', holding: true }).poses;
  assert.ok(swing.rightArm[0] > 1.5, 'weapon held high');
});

test('piglin ears hang out and flap; villager legs swing half as far', () => {
  const p = piglinPose(MOBS.piglin.model(), { age: 0 }).poses;
  assert.ok(p.leftEar[2] < -0.5 && p.rightEar[2] > 0.5);
  const v = villagerPose(MOBS.villager.model(), { limbSwing: 0, limbAmt: 1 }).poses;
  assert.ok(Math.abs(Math.abs(v.rightLeg[0]) - 0.7) < 1e-6);
});

test('painting stays inside each face (no stray pixels on the villager hat brim)', () => {
  const m = MOBS.villager.professionModel('farmer'), px = paintModel(m, 5);
  const [x, y, w, h] = faceRects(m.parts.hatRim.boxes[0]).front;
  let n = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (px[((y + j) * ENTITY + x + i) * 4 + 3]) n++;
  assert.equal(n, 0);
});

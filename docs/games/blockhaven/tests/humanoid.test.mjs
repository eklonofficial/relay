// entity/humanoid.js: Java's player and armor models, their unwrap, poses and skin processing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { playerModel, armorModel, humanoidPose, processSkin, armorHide } = await load('entity/humanoid.js');
const { drawModel, rootMatrix } = await load('entity/entity.js');
const { Batch } = await load('render/renderer.js');
const { armorLayer } = await load('data/armor.js');

// The texels (in 64x64 pixels) and the outward direction of every quad one box of a model draws.
function faces(model, partName, boxIndex = 0) {
  const m = { ...model, parts: { [partName]: { ...model.parts[partName], boxes: [model.parts[partName].boxes[boxIndex]] } } };
  const b = new Batch();
  drawModel(b, m, 0, rootMatrix([0, 0, 0], 0), {}, [1, 1, 1]);
  const out = [];
  for (let q = 0; q < b.quads; q++) {
    const v = k => Array.from(b.data.subarray((q * 4 + k) * 10, (q * 4 + k) * 10 + 5));
    const p = [0, 1, 2, 3].map(v), mid = [0, 1, 2].map(a => p.reduce((s, c) => s + c[a], 0) / 4);
    const us = p.map(c => c[3] * 64), vs = p.map(c => c[4] * 64);
    out.push({ mid, rect: [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)], p });
  }
  return out;
}
const facing = (fs, axis, sign) => fs.reduce((best, f) => (best === null || f.mid[axis] * sign > best.mid[axis] * sign ? f : best), null);

test('the head unwraps as Java: face at (8,8), the right side (+X here) at (0,8), the top at (8,0)', () => {
  const fs = faces(playerModel(), 'head');
  assert.equal(fs.length, 6);
  assert.deepEqual(facing(fs, 2, -1).rect.map(Math.round), [8, 8, 16, 16], 'front (-Z)');
  assert.deepEqual(facing(fs, 0, 1).rect.map(Math.round), [0, 8, 8, 16], 'right side (+X, the entity\'s right)');
  assert.deepEqual(facing(fs, 0, -1).rect.map(Math.round), [16, 8, 24, 16], 'left side');
  assert.deepEqual(facing(fs, 1, 1).rect.map(Math.round), [8, 0, 16, 8], 'top');
  assert.deepEqual(facing(fs, 1, -1).rect.map(Math.round), [16, 0, 24, 8], 'bottom');
  assert.deepEqual(facing(fs, 2, 1).rect.map(Math.round), [24, 8, 32, 16], 'back');
});

test('the front of the head reads left to right as seen from the front', () => {
  // Seen from the front (-Z), the viewer's left is +X: that edge takes u = 8.
  const front = facing(faces(playerModel(), 'head'), 2, -1);
  const left = front.p.filter(c => c[0] > 0).map(c => Math.round(c[3] * 64));
  assert.deepEqual([...new Set(left)], [8]);
});

test('PlayerModel texture offsets, the second layer and slim arms', () => {
  const m = playerModel(), slim = playerModel({}, true);
  const uv = (mm, part, k) => mm.parts[part].boxes[k].uv.join(',');
  assert.equal(uv(m, 'body', 0), '16,16'); assert.equal(uv(m, 'body', 1), '16,32');
  assert.equal(uv(m, 'rightArm', 0), '40,16'); assert.equal(uv(m, 'leftArm', 0), '32,48'); assert.equal(uv(m, 'leftArm', 1), '48,48');
  assert.equal(uv(m, 'rightLeg', 0), '0,16'); assert.equal(uv(m, 'leftLeg', 0), '16,48'); assert.equal(uv(m, 'leftLeg', 1), '0,48');
  assert.equal(m.parts.head.boxes[1].inflate, 0.5); assert.equal(m.parts.body.boxes[1].inflate, 0.25);
  assert.equal(slim.parts.rightArm.boxes[0].s[0], 3);
  // The arms reach from the body's side (x 4..8 here) outwards.
  const arm = m.parts.rightArm, x0 = arm.pivot[0] + arm.boxes[0].o[0];
  assert.deepEqual([x0, x0 + arm.boxes[0].s[0]], [4, 8]);
});

test('armor: 1 px out for layer 1, half a pixel for leggings, mirrored left limbs, parts by piece', () => {
  assert.equal(armorModel(false).parts.body.boxes[0].inflate, 1);
  assert.equal(armorModel(true).parts.body.boxes[0].inflate, 0.5);
  assert.equal(armorModel(false).parts.leftArm.boxes[0].mirror, true);
  assert.deepEqual(Object.keys(armorHide(0)).sort(), ['body', 'leftArm', 'leftLeg', 'rightArm', 'rightLeg']);
  const legs = armorLayer('iron_leggings');
  assert.equal(legs.skin, 'armor_iron_2'); assert.equal(legs.model, 'armor_inner'); assert.ok(legs.hide.head && !legs.hide.body);
  assert.equal(armorLayer('golden_boots').skin, 'armor_golden_1');
  assert.equal(armorLayer('elytra'), null);
});

test('a mirrored box takes the right strip on its other side', () => {
  const fs = faces(armorModel(false), 'leftArm');
  assert.deepEqual(facing(fs, 0, -1).rect.map(Math.round), [40, 20, 44, 32], 'the mirrored right strip faces -X');
});

test('crouching tips the body forward from the neck and lowers the head (HumanoidModel)', () => {
  const stand = humanoidPose({}), crouch = humanoidPose({ crouching: true });
  assert.ok(crouch.poses.body[0] < 0, 'the body pitches forward');
  assert.equal(crouch.pivots.head[1], 24 - 4.2);
  assert.equal(crouch.pivots.rightLeg[2], 4);
  assert.equal(stand.pivots.rightArm[0], 5);
});

test('walking swings opposite arms and legs; an attack swings the arm down', () => {
  const { poses } = humanoidPose({ limbSwing: 1, limbAmt: 1 });
  assert.ok(Math.sign(poses.rightArm[0]) === -Math.sign(poses.leftArm[0]));
  assert.ok(Math.sign(poses.rightArm[0]) === -Math.sign(poses.rightLeg[0]));
  const hit = humanoidPose({ attack: 0.5 });
  assert.ok(hit.poses.rightArm[0] > 0.5, 'the arm comes up and over');
});

test('a classic 64x32 skin gets its left limbs from the right ones, and the first layer is opaque', () => {
  const src = new Uint8ClampedArray(64 * 32 * 4);
  const put = (x, y, r) => { const i = (y * 64 + x) * 4; src[i] = r; src[i + 3] = 255; };
  put(4, 20, 200); put(7, 20, 100); // right leg front, its two edge columns
  const out = processSkin(src, 64, 32);
  const px = (x, y) => out[(y * 64 + x) * 4];
  // Left leg front at (20, 52), mirrored.
  assert.equal(px(23, 52), 200); assert.equal(px(20, 52), 100);
  assert.equal(out[(0 * 64 + 0) * 4 + 3], 255, 'head first layer opaque');
  assert.throws(() => processSkin(new Uint8ClampedArray(16), 2, 2));
});

const { mobHumanoid } = await load('entity/humanoid.js');
const { MOBS } = await load('data/mobs.js');

test('mob meshes: zombie mirrors its left limbs, drowned has its own, skeleton limbs are 2 px', () => {
  const z = mobHumanoid('zombie'), d = mobHumanoid('drowned'), s = mobHumanoid('skeleton');
  assert.equal(z.parts.leftArm.boxes[0].mirror, true); assert.equal(z.parts.leftArm.boxes[0].uv.join(), '40,16');
  assert.equal(d.parts.leftArm.boxes[0].uv.join(), '32,48'); assert.equal(d.parts.leftLeg.boxes[0].uv.join(), '16,48');
  assert.deepEqual(s.parts.rightArm.boxes[0].s, [2, 12, 2]); assert.equal(s.parts.rightLeg.pivot[0], 2);
  // Each mob names the pack image that replaces its paint, and the stray and drowned get outer layers.
  assert.equal(MOBS.zombie.model().texture, 'entity/zombie/zombie');
  assert.equal(MOBS.stray.overlay().texture, 'entity/skeleton/stray_overlay');
  assert.equal(MOBS.drowned.overlay().parts.body.boxes[0].inflate, 0.25);
});

test('zombie arms reach out, higher when hunting; a skeleton aims its bow along its gaze', () => {
  const idle = humanoidPose({ arms: 'zombie' }).poses.rightArm[0], hunting = humanoidPose({ arms: 'zombie', aggressive: true }).poses.rightArm[0];
  assert.ok(idle > 1.2 && hunting > idle, `${idle} ${hunting}`);
  const bow = humanoidPose({ arms: 'skeleton', aggressive: true, rightPose: 'bow', headPitch: 0.3 }).poses;
  assert.ok(Math.abs(bow.rightArm[0] - (Math.PI / 2 - 0.3)) < 0.1, `${bow.rightArm[0]}`);
});

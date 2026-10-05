// Java Edition's animal models (QuadrupedModel and its pig, cow, sheep and polar bear, ChickenModel,
// WolfModel, GoatModel, FoxModel, HorseModel, DonkeyModel, LlamaModel) with their texture offsets, and
// their setupAnim poses. Java coordinates (y down from the model's top, feet at 24), turned into ours
// as in entity/humanoid.js; a part with a parent sits relative to it.
import { jbox, pivot } from './humanoid.js?v=muujnr74';

const PI = Math.PI;
export const child = (x, y, z) => [-x, -y, z];
export const rot = (x, y, z) => [-x, -y, z];
export const P = (pv, boxes, extra = {}) => ({ pivot: pv, boxes, ...extra });
// The model wrapper: Java texture size (for packs), pack image(s), our pose kind.
export const model = (anim, parts, texSize, texture, extra = {}) => ({ java: true, tex: [64, 64], texSize, anim, texture, parts, ...extra });

// QuadrupedModel.createBodyMesh: head, a body lying along z, four legs `legH` tall, all from one texture.
function quadruped(legH, st, k = 0) {
  const leg = (x, z) => P(pivot(x, 24 - legH, z), [jbox(0, 16, -2, 0, -2, 4, legH, 4, k, { style: st.leg })]);
  return {
    head: P(pivot(0, 18 - legH, -6), [jbox(0, 0, -4, -4, -8, 8, 8, 8, k, { style: st.head })]),
    body: P(pivot(0, 17 - legH, 2), [jbox(28, 8, -5, -10, -7, 10, 16, 8, k, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: leg(-3, 7), leftHindLeg: leg(3, 7), rightFrontLeg: leg(-3, -5), leftFrontLeg: leg(3, -5),
  };
}

// PigModel: a 6-tall-legged quadruped with a snout.
export function pigModel(st, texture = 'entity/pig/pig') {
  const parts = quadruped(6, st);
  parts.head = P(pivot(0, 12, -6), [jbox(0, 0, -4, -4, -8, 8, 8, 8, 0, { style: st.head }), jbox(16, 16, -2, 0, -9, 4, 3, 1, 0, { style: st.snout || st.head })]);
  return model('jquadruped', parts, [64, 32], texture);
}

// CowModel (cows, mooshrooms): horns on the head, an udder under the body, 12-tall legs.
export function cowModel(st, texture = 'entity/cow/cow') {
  const leg = (x, z) => P(pivot(x, 12, z), [jbox(0, 16, -2, 0, -2, 4, 12, 4, 0, { style: st.leg })]);
  return model('jquadruped', {
    head: P(pivot(0, 4, -8), [jbox(0, 0, -4, -4, -6, 8, 8, 6, 0, { style: st.head }), jbox(22, 0, -5, -5, -4, 1, 3, 1, 0, { style: st.horn }), jbox(22, 0, 4, -5, -4, 1, 3, 1, 0, { style: st.horn })]),
    body: P(pivot(0, 5, 2), [jbox(18, 4, -6, -10, -7, 12, 18, 10, 0, { style: st.body }), jbox(52, 0, -2, 2, -8, 4, 6, 1, 0, { style: st.udder })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: leg(-4, 7), leftHindLeg: leg(4, 7), rightFrontLeg: leg(-4, -6), leftFrontLeg: leg(4, -6),
  }, [64, 32], texture);
}

// SheepModel, and SheepFurModel (the wool, tinted by the sheep's colour, drawn over it unless sheared).
export function sheepModel(st, texture = 'entity/sheep/sheep') {
  const parts = quadruped(12, st);
  parts.head = P(pivot(0, 6, -8), [jbox(0, 0, -3, -4, -6, 6, 6, 8, 0, { style: st.head })]);
  parts.body = P(pivot(0, 5, 2), [jbox(28, 8, -4, -10, -7, 8, 16, 6, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) });
  return model('jquadruped', parts, [64, 32], texture, { eatHead: true });
}
export function sheepFurModel(st, texture = 'entity/sheep/sheep_fur') {
  const leg = x => z => P(pivot(x, 12, z), [jbox(0, 16, -2, 0, -2, 4, 6, 4, 0.5, { style: st.leg })]);
  return model('jquadruped', {
    head: P(pivot(0, 6, -8), [jbox(0, 0, -3, -4, -4, 6, 6, 6, 0.6, { style: st.head })]),
    body: P(pivot(0, 5, 2), [jbox(28, 8, -4, -10, -7, 8, 16, 6, 1.75, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: leg(-3)(7), leftHindLeg: leg(3)(7), rightFrontLeg: leg(-3)(-5), leftFrontLeg: leg(3)(-5),
  }, [64, 32], texture, { wool: true });
}

// ChickenModel: head with beak and wattle, a body lying along z, wings and thin legs.
export function chickenModel(st, texture = 'entity/chicken') {
  const head = (boxes) => P(pivot(0, 15, -4), boxes);
  return model('jchicken', {
    head: head([jbox(0, 0, -2, -6, -2, 4, 6, 3, 0, { style: st.head })]),
    beak: head([jbox(14, 0, -2, -4, -4, 4, 2, 2, 0, { style: st.beak })]),
    wattle: head([jbox(14, 4, -1, -2, -3, 2, 2, 2, 0, { style: st.wattle })]),
    body: P(pivot(0, 16, 0), [jbox(0, 9, -3, -4, -3, 6, 8, 6, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    rightLeg: P(pivot(-2, 19, 1), [jbox(26, 0, -1, 0, -3, 3, 5, 3, 0, { style: st.leg })]),
    leftLeg: P(pivot(1, 19, 1), [jbox(26, 0, -1, 0, -3, 3, 5, 3, 0, { style: st.leg })]),
    rightWing: P(pivot(-4, 13, 0), [jbox(24, 13, 0, 0, -3, 1, 4, 6, 0, { style: st.wing })]),
    leftWing: P(pivot(4, 13, 0), [jbox(24, 13, -1, 0, -3, 1, 4, 6, 0, { style: st.wing })]),
  }, [64, 32], texture);
}

// WolfModel: the head (with ears and muzzle) in a holder that turns, a mane, a body, thin legs, a tail.
export function wolfModel(st, texture = 'entity/wolf/wolf') {
  const leg = (x, z) => P(pivot(x, 16, z), [jbox(0, 18, 0, 0, -1, 2, 8, 2, 0, { style: st.leg })]);
  return model('jwolf', {
    head: P(pivot(-1, 13.5, -7), []),
    realHead: P(child(0, 0, 0), [jbox(0, 0, -2, -3, -2, 6, 6, 4, 0, { style: st.head }), jbox(16, 14, -2, -5, 0, 2, 2, 1, 0, { style: st.ear }), jbox(16, 14, 2, -5, 0, 2, 2, 1, 0, { style: st.ear }), jbox(0, 10, -0.5, -0.001, -5, 3, 3, 4, 0, { style: st.muzzle })], { parent: 'head' }),
    body: P(pivot(0, 14, 2), [jbox(18, 14, -3, -2, -3, 6, 9, 6, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    upperBody: P(pivot(-1, 14, -3), [jbox(21, 0, -3, -3, -3, 8, 6, 7, 0, { style: st.mane })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: leg(-2.5, 7), leftHindLeg: leg(0.5, 7), rightFrontLeg: leg(-2.5, -4), leftFrontLeg: leg(0.5, -4),
    tail: P(pivot(-1, 12, 8), [], { rot: rot(0.62831855, 0, 0) }),
    realTail: P(child(0, 0, 0), [jbox(9, 18, 0, 0, -1, 2, 8, 2, 0, { style: st.tail })], { parent: 'tail' }),
  }, [64, 32], texture);
}

// PolarBearModel (128x64): a big head with a muzzle and ears, a two-box body, thick legs.
export function polarBearModel(st, texture = 'entity/bear/polarbear') {
  const hind = x => P(pivot(x, 14, 6), [jbox(50, 22, -2, 0, -2, 4, 10, 8, 0, { style: st.leg })]);
  const front = x => P(pivot(x, 14, -8), [jbox(50, 40, -2, 0, -2, 4, 10, 6, 0, { style: st.leg })]);
  return model('jquadruped', {
    head: P(pivot(0, 10, -16), [jbox(0, 0, -3.5, -3, -3, 7, 7, 7, 0, { style: st.head }), jbox(0, 44, -2.5, 1, -6, 5, 3, 3, 0, { style: st.muzzle }), jbox(26, 0, -4.5, -4, -1, 2, 2, 1, 0, { style: st.ear }), jbox(26, 0, 2.5, -4, -1, 2, 2, 1, 0, { mirror: true })]),
    body: P(pivot(-2, 9, 12), [jbox(0, 19, -5, -13, -7, 14, 14, 11, 0, { style: st.body }), jbox(39, 0, -4, -25, -7, 12, 12, 10, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: hind(-4.5), leftHindLeg: hind(4.5), rightFrontLeg: front(-3.5), leftFrontLeg: front(3.5),
  }, [128, 64], texture);
}

// GoatModel: a long head with ears, a goatee, horns and a nose set at an angle; a two-box body; short
// hind legs and long front legs, each with its own texture.
export function goatModel(st, texture = 'entity/goat/goat') {
  return model('jquadruped', {
    head: P(pivot(1, 14, 0), [jbox(2, 61, -6, -11, -10, 3, 2, 1, 0, { style: st.ear }), jbox(2, 61, 2, -11, -10, 3, 2, 1, 0, { mirror: true }), jbox(23, 52, -0.5, -3, -14, 0, 7, 5, 0, { style: st.goatee, mirror: true })]),
    leftHorn: P(child(0, 0, 0), [jbox(12, 55, -0.01, -16, -10, 2, 7, 2, 0, { style: st.horn })], { parent: 'head' }),
    rightHorn: P(child(0, 0, 0), [jbox(12, 55, -2.99, -16, -10, 2, 7, 2, 0, { style: st.horn })], { parent: 'head' }),
    nose: P(child(0, -8, -8), [jbox(34, 46, -3, -4, -8, 5, 7, 10, 0, { style: st.head })], { parent: 'head', rot: rot(0.9599, 0, 0) }),
    body: P(pivot(0, 24, 0), [jbox(1, 1, -4, -17, -7, 9, 11, 16, 0, { style: st.body }), jbox(0, 28, -5, -18, -8, 11, 14, 11, 0, { style: st.wool || st.body })]),
    leftHindLeg: P(pivot(1, 14, 4), [jbox(36, 29, 0, 4, 0, 3, 6, 3, 0, { style: st.leg })]),
    rightHindLeg: P(pivot(-3, 14, 4), [jbox(49, 29, 0, 4, 0, 3, 6, 3, 0, { style: st.leg })]),
    leftFrontLeg: P(pivot(1, 14, -6), [jbox(49, 2, 0, 0, 0, 3, 10, 3, 0, { style: st.leg })]),
    rightFrontLeg: P(pivot(-3, 14, -6), [jbox(35, 2, 0, 0, 0, 3, 10, 3, 0, { style: st.leg })]),
  }, [64, 64], texture);
}

// FoxModel (48x32): a pointed head with ears and a nose, a slim body with a bushy tail, short legs.
export function foxModel(st, texture = 'entity/fox/fox') {
  const leg = (u, x, z) => P(pivot(x, 17.5, z), [jbox(u, 24, 2, 0.5, -1, 2, 6, 2, 0.001, { style: st.leg })]);
  return model('jquadruped', {
    head: P(pivot(-1, 16.5, -3), [jbox(1, 5, -3, -2, -5, 8, 6, 6, 0, { style: st.head }), jbox(8, 1, -3, -4, -4, 2, 2, 1, 0, { style: st.ear }), jbox(15, 1, 3, -4, -4, 2, 2, 1, 0, { style: st.ear }), jbox(6, 18, -1, 2.01, -8, 4, 2, 3, 0, { style: st.nose })]),
    body: P(pivot(0, 16, -6), [jbox(24, 15, -3, 3.999, -3.5, 6, 11, 6, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    tail: P(child(-4, 15, -1), [jbox(30, 0, 2, 0, -1, 4, 9, 5, 0, { style: st.tail })], { parent: 'body', rot: rot(-0.05235988, 0, 0) }),
    rightHindLeg: leg(13, -5, 7), leftHindLeg: leg(4, -1, 7), rightFrontLeg: leg(13, -5, 0), leftFrontLeg: leg(4, -1, 0),
  }, [48, 32], texture);
}

// HorseModel (horses, donkeys, mules): body, the neck holding the head, mane and muzzle, ears, tail,
// and long legs; DonkeyModel adds long ears and saddlebags.
export function horseModel(st, texture = 'entity/horse/horse_brown', donkey = false) {
  const leg = (u, x, z, bx, bz, right) => P(pivot(x, 14, z), [jbox(48, 21, bx, -1.01, bz, 4, 11, 4, 0, right ? { style: st.leg } : { mirror: true })]);
  const parts = {
    body: P(pivot(0, 11, 5), [jbox(0, 32, -5, -8, -17, 10, 10, 22, 0.05, { style: st.body })]),
    tail: P(child(0, -5, 2), [jbox(42, 36, -1.5, 0, 0, 3, 14, 4, 0, { style: st.tail })], { parent: 'body', rot: rot(PI / 6, 0, 0) }),
    neck: P(pivot(0, 4, -12), [jbox(0, 35, -2.05, -6, -2, 4, 12, 7, 0, { style: st.neck || st.body })], { rot: rot(PI / 6, 0, 0) }),
    head: P(child(0, 0, 0), [jbox(0, 13, -3, -11, -2, 6, 5, 7, 0, { style: st.head })], { parent: 'neck' }),
    mane: P(child(0, 0, 0), [jbox(56, 36, -1, -11, 5.01, 2, 16, 2, 0, { style: st.mane })], { parent: 'neck' }),
    mouth: P(child(0, 0, 0), [jbox(0, 25, -2, -11, -7, 4, 5, 5, 0, { style: st.mouth || st.head })], { parent: 'neck' }),
    leftHindLeg: leg(48, 4, 7, -3, -1, false), rightHindLeg: leg(48, -4, 7, -1, -1, true),
    leftFrontLeg: leg(48, 4, -12, -3, -1.9, false), rightFrontLeg: leg(48, -4, -12, -1, -1.9, true),
  };
  if (donkey) {
    // DonkeyModel: long ears tilted out, and saddlebags when it carries a chest.
    parts.leftEar = P(child(1.25, -10, 4), [jbox(0, 12, -1, -7, 0, 2, 7, 1, 0, { style: st.ear })], { parent: 'head', rot: rot(PI / 12, 0, PI / 12) });
    parts.rightEar = P(child(-1.25, -10, 4), [jbox(0, 12, -1, -7, 0, 2, 7, 1, 0, { style: st.ear })], { parent: 'head', rot: rot(PI / 12, 0, -PI / 12) });
  } else {
    parts.leftEar = P(child(0, 0, 0), [jbox(19, 16, 0.55, -13, 4, 2, 3, 1, -0.001, { style: st.ear })], { parent: 'head' });
    parts.rightEar = P(child(0, 0, 0), [jbox(19, 16, -2.55, -13, 4, 2, 3, 1, -0.001, { style: st.ear })], { parent: 'head' });
  }
  return model('jhorse', parts, [64, 64], texture);
}

// LlamaModel (128x64): a tall neck-and-head with a snout and ears, a body, long legs.
export function llamaModel(st, texture = 'entity/llama/creamy') {
  const leg = (x, z) => P(pivot(x, 10, z), [jbox(29, 29, -2, 0, -2, 4, 14, 4, 0, { style: st.leg })]);
  return model('jquadruped', {
    head: P(pivot(0, 7, -6), [jbox(0, 0, -2, -14, -10, 4, 4, 9, 0, { style: st.snout || st.head }), jbox(0, 14, -4, -16, -6, 8, 18, 6, 0, { style: st.head }), jbox(17, 0, -4, -19, -4, 3, 3, 2, 0, { style: st.ear }), jbox(17, 0, 1, -19, -4, 3, 3, 2, 0, { style: st.ear })]),
    body: P(pivot(0, 5, 2), [jbox(29, 0, -6, -10, -7, 12, 18, 10, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: leg(-3.5, 6), leftHindLeg: leg(3.5, 6), rightFrontLeg: leg(-3.5, -5), leftFrontLeg: leg(3.5, -5),
  }, [128, 64], texture, { headStill: true });
}

// ---------------- poses ----------------
// st: { limbSwing, limbAmt, age (ticks), headPitch, headYaw (Java's signs), sitting, angry, tamed, health,
//   flap (chicken wing angle), eat (sheep grazing 0-1) }
export const toOurs = (parts, model) => {
  const poses = {}, pivots = {};
  for (const [k, p] of Object.entries(parts)) {
    poses[k] = [-p.rx, -p.ry, p.rz];
    if (p.x !== undefined) pivots[k] = model.parts[k] && model.parts[k].parent ? child(p.x, p.y, p.z) : pivot(p.x, p.y, p.z);
  }
  return { poses, pivots };
};
export const R = (rx = 0, ry = 0, rz = 0) => ({ rx, ry, rz });

// QuadrupedModel.setupAnim: head look, diagonal leg pairs swinging together (and the llama's head
// staying level, the sheep's dipping to graze).
export function animalPose(model, st) {
  const limb = st.limbSwing || 0, amt = st.limbAmt || 0;
  const parts = {
    head: R(st.headPitch || 0, st.headYaw || 0),
    rightHindLeg: R(Math.cos(limb * 0.6662) * 1.4 * amt), leftHindLeg: R(Math.cos(limb * 0.6662 + PI) * 1.4 * amt),
    rightFrontLeg: R(Math.cos(limb * 0.6662 + PI) * 1.4 * amt), leftFrontLeg: R(Math.cos(limb * 0.6662) * 1.4 * amt),
  };
  if (model.eatHead && st.eat > 0) { parts.head.rx = PI / 5 + 0.2 * Math.sin(st.eat * 28.7) * Math.min(1, st.eat * 4); Object.assign(parts.head, { x: 0, y: 6 + st.eat * 9, z: -8 }); }
  if (model.parts.body && model.parts.body.rot) parts.body = R(PI / 2);
  return toOurs(parts, model);
}

// ChickenModel.setupAnim: head look (beak and wattle with it), legs, wings flapping by `flap`.
export function chickenPose(model, st) {
  const limb = st.limbSwing || 0, amt = st.limbAmt || 0, head = R(st.headPitch || 0, st.headYaw || 0);
  return toOurs({
    head, beak: { ...head }, wattle: { ...head }, body: R(PI / 2),
    rightLeg: R(Math.cos(limb * 0.6662) * 1.4 * amt), leftLeg: R(Math.cos(limb * 0.6662 + PI) * 1.4 * amt),
    rightWing: R(0, 0, st.flap || 0), leftWing: R(0, 0, -(st.flap || 0)),
  }, model);
}

// WolfModel.prepareMobModel / setupAnim: tail wag and height (by health when tame), sitting pose.
export function wolfPose(model, st) {
  const limb = st.limbSwing || 0, amt = st.limbAmt || 0;
  const tailAngle = st.angry ? 1.5393804 : st.tamed ? (0.55 - (20 - (st.health ?? 20)) * 0.02) * PI : PI / 5;
  const parts = { head: R(st.headPitch || 0, st.headYaw || 0), tail: R(tailAngle, st.angry ? 0 : Math.cos(limb * 0.6662) * 1.4 * amt) };
  if (st.sitting) {
    Object.assign(parts, {
      upperBody: { x: -1, y: 16, z: -3, ...R(2 * PI / 5) }, body: { x: 0, y: 18, z: 0, ...R(PI / 4) },
      rightHindLeg: { x: -2.5, y: 22.7, z: 2, ...R(3 * PI / 2) }, leftHindLeg: { x: 0.5, y: 22.7, z: 2, ...R(3 * PI / 2) },
      rightFrontLeg: { x: -2.49, y: 17, z: -4, ...R(5.811947) }, leftFrontLeg: { x: 0.51, y: 17, z: -4, ...R(5.811947) },
    });
    parts.tail = { x: -1, y: 21, z: 6, ...parts.tail };
  } else {
    Object.assign(parts, {
      body: R(PI / 2), upperBody: R(PI / 2),
      rightHindLeg: R(Math.cos(limb * 0.6662) * 1.4 * amt), leftHindLeg: R(Math.cos(limb * 0.6662 + PI) * 1.4 * amt),
      rightFrontLeg: R(Math.cos(limb * 0.6662 + PI) * 1.4 * amt), leftFrontLeg: R(Math.cos(limb * 0.6662) * 1.4 * amt),
    });
  }
  return toOurs(parts, model);
}

// HorseModel.prepareMobModel (walking): the neck tilted down 30 degrees and following the gaze, legs in
// diagonal pairs, the tail lifting with speed.
export function horsePose(model, st) {
  const limb = st.limbSwing || 0, amt = st.limbAmt || 0, f7 = Math.cos(limb * 0.6662 + PI) * 0.8 * amt;
  return toOurs({
    neck: R(PI / 6 + (st.headPitch || 0), st.headYaw || 0),
    tail: R(PI / 6 + amt * 0.75),
    leftHindLeg: R(f7), rightHindLeg: R(-f7), leftFrontLeg: R(-f7), rightFrontLeg: R(f7),
  }, model);
}

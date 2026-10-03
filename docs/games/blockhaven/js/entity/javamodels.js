// Java Edition's models for the villager family, witches, illagers and piglins (VillagerModel,
// WitchModel, IllagerModel, PiglinModel, ZombieVillagerModel), with their texture offsets, and their
// setupAnim poses. Coordinates are Java's, turned into ours as in entity/humanoid.js; a part with a
// parent is placed relative to it.
import { jbox, pivot, playerModel, humanoidPose, bobArms, xbowCharge, xbowHold } from './humanoid.js?v=musof0se';

const PI = Math.PI;
const child = (x, y, z) => [-x, -y, z];
const rot = (x, y, z) => [-x, -y, z];
const P = (pv, boxes, extra = {}) => ({ pivot: pv, boxes, ...extra });

// VillagerModel (villagers, wandering traders, and the witch's body): a 10-tall head with its nose,
// the robe over the body, arms folded in front, and a hat with a brim (shown where its pixels are).
function villagerParts(st) {
  return {
    head: P(pivot(0, 0, 0), [jbox(0, 0, -4, -10, -4, 8, 10, 8, 0, { style: st.head })]),
    hat: P(child(0, 0, 0), [jbox(32, 0, -4, -10, -4, 8, 10, 8, 0.51, { style: st.hat })], { parent: 'head' }),
    hatRim: P(child(0, 0, 0), [jbox(30, 47, -8, -8, -6, 16, 16, 1, 0, { style: st.hatRim })], { parent: 'hat', rot: rot(-PI / 2, 0, 0) }),
    nose: P(child(0, -2, 0), [jbox(24, 0, -1, -1, -6, 2, 4, 2, 0, { style: st.nose })], { parent: 'head' }),
    body: P(pivot(0, 0, 0), [jbox(16, 20, -4, 0, -3, 8, 12, 6, 0, { style: st.body })]),
    jacket: P(child(0, 0, 0), [jbox(0, 38, -4, 0, -3, 8, 20, 6, 0.5, { style: st.robe })], { parent: 'body' }),
    arms: P(pivot(0, 3, -1), [jbox(44, 22, -8, -2, -2, 4, 8, 4, 0, { style: st.arm }), jbox(44, 22, 4, -2, -2, 4, 8, 4, 0, { mirror: true }), jbox(40, 38, -4, 2, -2, 8, 4, 4, 0, { style: st.hands || st.arm })], { rot: rot(-0.75, 0, 0) }),
    rightLeg: P(pivot(-2, 12, 0), [jbox(0, 22, -2, 0, -2, 4, 12, 4, 0, { style: st.leg })]),
    leftLeg: P(pivot(2, 12, 0), [jbox(0, 22, -2, 0, -2, 4, 12, 4, 0, { mirror: true })]),
  };
}
export function villagerModel(st, texture) {
  return { java: true, tex: [64, 64], texSize: [64, 64], anim: 'jvillager', texture, eye: 24 + 10 * 0.55, parts: villagerParts(st) };
}

// WitchModel: VillagerModel with its own head (no villager hat), a nose with a mole, and the four-tier
// pointed hat on a 64x128 texture.
export function witchModel(st, texture) {
  const parts = villagerParts(st);
  delete parts.hat; delete parts.hatRim;
  parts.nose = P(child(0, -2, 0), [jbox(24, 0, -1, -1, -6, 2, 4, 2, 0, { style: st.nose })], { parent: 'head' });
  parts.mole = P(child(0, -2, 0), [jbox(0, 0, 0, 3, -6.75, 1, 1, 1, -0.25, { style: st.mole })], { parent: 'nose' });
  parts.hat = P(child(-5, -10.03125, -5), [jbox(0, 64, 0, 0, 0, 10, 2, 10, 0, { style: st.hat })], { parent: 'head' });
  parts.hat2 = P(child(1.75, -4, 2), [jbox(0, 76, 0, 0, 0, 7, 4, 7, 0, { style: st.hat2 || st.hat })], { parent: 'hat', rot: rot(-0.05235988, 0, 0.02617994) });
  parts.hat3 = P(child(1.75, -4, 2), [jbox(0, 87, 0, 0, 0, 4, 4, 4, 0, { style: st.hat })], { parent: 'hat2', rot: rot(-0.10471976, 0, 0.05235988) });
  parts.hat4 = P(child(1.75, -2, 2), [jbox(0, 95, 0, 0, 0, 1, 2, 1, 0.25, { style: st.hat })], { parent: 'hat3', rot: rot(-0.20943952, 0, 0.10471976) });
  return { java: true, tex: [64, 128], texSize: [64, 128], anim: 'jvillager', witch: true, texture, eye: 24 + 10 * 0.55, parts };
}

// IllagerModel (pillagers, vindicators, evokers): the villager's head and robe, plus free arms that
// replace the folded ones whenever the illager is doing something with its hands.
export function illagerModel(st, texture) {
  return {
    java: true, tex: [64, 64], texSize: [64, 64], anim: 'jillager', texture, eye: 24 + 10 * 0.55,
    parts: {
      head: P(pivot(0, 0, 0), [jbox(0, 0, -4, -10, -4, 8, 10, 8, 0, { style: st.head })]),
      nose: P(child(0, -2, 0), [jbox(24, 0, -1, -1, -6, 2, 4, 2, 0, { style: st.nose })], { parent: 'head' }),
      body: P(pivot(0, 0, 0), [jbox(16, 20, -4, 0, -3, 8, 12, 6, 0, { style: st.body }), jbox(0, 38, -4, 0, -3, 8, 20, 6, 0.5, { style: st.robe })]),
      arms: P(pivot(0, 3, -1), [jbox(44, 22, -8, -2, -2, 4, 8, 4, 0, { style: st.arm }), jbox(40, 38, -4, 2, -2, 8, 4, 4, 0, { style: st.hands || st.arm }), jbox(44, 22, 4, -2, -2, 4, 8, 4, 0, { mirror: true })], { rot: rot(-0.75, 0, 0) }),
      rightLeg: P(pivot(-2, 12, 0), [jbox(0, 22, -2, 0, -2, 4, 12, 4, 0, { style: st.leg })]),
      leftLeg: P(pivot(2, 12, 0), [jbox(0, 22, -2, 0, -2, 4, 12, 4, 0, { mirror: true })]),
      rightArm: P(pivot(-5, 2, 0), [jbox(40, 46, -3, -2, -2, 4, 12, 4, 0, { style: st.arm2 || st.arm })]),
      leftArm: P(pivot(5, 2, 0), [jbox(40, 46, -1, -2, -2, 4, 12, 4, 0, { mirror: true })]),
    },
  };
}

// PiglinModel (piglins, zombified piglins): the player's body and limbs (with their outer layers)
// under a wide head with a snout, two tusks and floppy ears.
export function piglinModel(st, texture, zombified = false) {
  const m = playerModel({ body: st.body, jacket: st.jacket, arm: st.arm, sleeve: st.sleeve, leg: st.leg, pants: st.pants }, false);
  m.parts.head.boxes = [
    jbox(0, 0, -5, -8, -4, 10, 8, 8, 0, { style: st.head }), jbox(31, 1, -2, -4, -5, 4, 4, 1, 0, { style: st.snout }),
    jbox(2, 4, 2, -2, -5, 1, 2, 1, 0, { style: st.tusk }), jbox(2, 0, -3, -2, -5, 1, 2, 1, 0, { style: st.tusk }),
  ];
  m.parts.leftEar = P(child(4.5, -6, 0), [jbox(51, 6, 0, 0, -2, 1, 5, 4, 0, { style: st.ear })], { parent: 'head', rot: rot(0, 0, -PI / 6) });
  m.parts.rightEar = P(child(-4.5, -6, 0), [jbox(39, 6, -1, 0, -2, 1, 5, 4, 0, { style: st.ear })], { parent: 'head', rot: rot(0, 0, PI / 6) });
  return { ...m, anim: 'jpiglin', zombified, texture, texSize: [64, 64], eye: 24 + 8 * 0.55 };
}

// ZombieVillagerModel: a humanoid with the villager's head, nose, hat and robe, and free zombie arms.
export function zombieVillagerModel(st, texture) {
  return {
    java: true, tex: [64, 64], texSize: [64, 64], anim: 'jhumanoid', arms: 'zombie', legX: 2, texture, eye: 24 + 10 * 0.55,
    parts: {
      head: P(pivot(0, 0, 0), [jbox(0, 0, -4, -10, -4, 8, 10, 8, 0, { style: st.head }), jbox(24, 0, -1, -3, -6, 2, 4, 2, 0, { style: st.nose })]),
      hat: P(child(0, 0, 0), [jbox(32, 0, -4, -10, -4, 8, 10, 8, 0.5, { style: st.hat })], { parent: 'head' }),
      hatRim: P(child(0, 0, 0), [jbox(30, 47, -8, -8, -6, 16, 16, 1, 0, { style: st.hatRim })], { parent: 'hat', rot: rot(-PI / 2, 0, 0) }),
      body: P(pivot(0, 0, 0), [jbox(16, 20, -4, 0, -3, 8, 12, 6, 0, { style: st.body }), jbox(0, 38, -4, 0, -3, 8, 20, 6, 0.05, { style: st.robe })]),
      rightArm: P(pivot(-5, 2, 0), [jbox(44, 22, -3, -2, -2, 4, 12, 4, 0, { style: st.arm })]),
      leftArm: P(pivot(5, 2, 0), [jbox(44, 22, -1, -2, -2, 4, 12, 4, 0, { mirror: true })]),
      rightLeg: P(pivot(-2, 12, 0), [jbox(0, 22, -2, 0, -2, 4, 12, 4, 0, { style: st.leg })]),
      leftLeg: P(pivot(2, 12, 0), [jbox(0, 22, -2, 0, -2, 4, 12, 4, 0, { mirror: true })]),
    },
  };
}

// ---------------- poses ----------------
// st: { limbSwing, limbAmt, age (ticks), headPitch, headYaw (Java's signs), attack (0-1), aggressive,
//   unhappy, armPose: 'crossed' | 'neutral' | 'attacking' | 'spellcasting' | 'bow' | 'xbow_hold' | 'xbow_charge',
//   xbowCharge (0-1), holding (an item in the main hand), id (for the witch's nose) }
const toOurs = parts => {
  const poses = {}, pivots = {};
  for (const [k, p] of Object.entries(parts)) { poses[k] = [-p.rx, -p.ry, p.rz]; if (p.root) pivots[k] = pivot(p.x, p.y, p.z); }
  return { poses, pivots };
};
const jpart = (x, y, z, root = true) => ({ x, y, z, rx: 0, ry: 0, rz: 0, root });

// VillagerModel.setupAnim (and WitchModel's nose): the head looks, an unhappy villager shakes its head,
// the legs swing half as far as a player's.
export function villagerPose(model, st) {
  const limb = st.limbSwing || 0, amt = st.limbAmt || 0, age = st.age || 0;
  const head = jpart(0, 0, 0), rightLeg = jpart(-2, 12, 0), leftLeg = jpart(2, 12, 0);
  head.ry = st.headYaw || 0; head.rx = st.headPitch || 0;
  if (st.unhappy) { head.rz = 0.3 * Math.sin(0.45 * age); head.rx = 0.4; }
  rightLeg.rx = Math.cos(limb * 0.6662) * 1.4 * amt * 0.5;
  leftLeg.rx = Math.cos(limb * 0.6662 + PI) * 1.4 * amt * 0.5;
  const parts = { head, rightLeg, leftLeg };
  if (model.witch) {
    const nose = jpart(0, -2, 0, false), f = 0.01 * ((st.id || 0) % 10);
    nose.rx = Math.sin(age * f) * 4.5 * PI / 180; nose.rz = Math.cos(age * f) * 2.5 * PI / 180;
    parts.nose = nose;
  }
  const out = toOurs(parts);
  if (model.witch && st.holding) { out.poses.nose = [0.9, 0, 0]; out.pivots.nose = child(0, 1, -1.5); }
  return out;
}

// IllagerModel.setupAnim: walking arms and half-swing legs, then the arm pose; the folded arms show
// only while 'crossed'.
export function illagerPose(st) {
  const limb = st.limbSwing || 0, amt = st.limbAmt || 0, age = st.age || 0, attack = st.attack || 0;
  const head = jpart(0, 0, 0), rightArm = jpart(-5, 2, 0), leftArm = jpart(5, 2, 0), rightLeg = jpart(-2, 12, 0), leftLeg = jpart(2, 12, 0);
  head.ry = st.headYaw || 0; head.rx = st.headPitch || 0;
  rightArm.rx = Math.cos(limb * 0.6662 + PI) * 2 * amt * 0.5;
  leftArm.rx = Math.cos(limb * 0.6662) * 2 * amt * 0.5;
  rightLeg.rx = Math.cos(limb * 0.6662) * 1.4 * amt * 0.5;
  leftLeg.rx = Math.cos(limb * 0.6662 + PI) * 1.4 * amt * 0.5;
  const pose = st.armPose || 'crossed';
  if (pose === 'attacking') {
    if (!st.holding) {
      // animateZombieArms, hunting.
      const f = Math.sin(attack * PI), g = Math.sin((1 - (1 - attack) * (1 - attack)) * PI);
      rightArm.ry = -(0.1 - f * 0.6); leftArm.ry = 0.1 - f * 0.6;
      rightArm.rx = -PI / 1.5 + f * 1.2 - g * 0.4; leftArm.rx = -PI / 1.5 + f * 1.2 - g * 0.4;
      bobArms(rightArm, leftArm, age);
    } else {
      // AnimationUtils.swingWeaponDown: the weapon raised high and brought down in the swing.
      const f = Math.sin(attack * PI), g = Math.sin((1 - (1 - attack) * (1 - attack)) * PI);
      rightArm.rz = 0; leftArm.rz = 0; rightArm.ry = 0.15707964; leftArm.ry = -0.15707964;
      rightArm.rx = -1.8849558 + Math.cos(age * 0.09) * 0.15 + f * 2.2 - g * 0.4;
      leftArm.rx = Math.cos(age * 0.19) * 0.5 + f * 1.2 - g * 0.4;
      bobArms(rightArm, leftArm, age);
    }
  } else if (pose === 'spellcasting') {
    rightArm.rx = Math.cos(age * 0.6662) * 0.25; leftArm.rx = Math.cos(age * 0.6662) * 0.25;
    rightArm.rz = 2.3561945; leftArm.rz = -2.3561945; rightArm.ry = 0; leftArm.ry = 0;
  } else if (pose === 'bow') {
    rightArm.ry = -0.1 + head.ry; rightArm.rx = -PI / 2 + head.rx;
    leftArm.rx = -0.9424779; leftArm.ry = head.ry - 0.4; leftArm.rz = PI / 2;
  } else if (pose === 'xbow_hold') xbowHold(rightArm, leftArm, head, true);
  else if (pose === 'xbow_charge') xbowCharge(rightArm, leftArm, st.xbowCharge || 0, true);
  const out = toOurs({ head, rightArm, leftArm, rightLeg, leftLeg });
  const crossed = pose === 'crossed';
  out.poses.hide = crossed ? { rightArm: true, leftArm: true } : { arms: true };
  return out;
}

// PiglinModel.setupAnim: the humanoid pose, ears flapping with each step, and the zombified piglin's
// zombie arms.
export function piglinPose(model, st) {
  const { poses, pivots } = humanoidPose({ ...st, arms: model.zombified ? 'zombie' : null });
  const f1 = (st.age || 0) * 0.1 + (st.limbSwing || 0) * 0.5, f2 = 0.08 + (st.limbAmt || 0) * 0.4;
  poses.leftEar = [0, 0, -PI / 6 - Math.cos(f1 * 1.2) * f2];
  poses.rightEar = [0, 0, PI / 6 + Math.cos(f1) * f2];
  return { poses, pivots };
}

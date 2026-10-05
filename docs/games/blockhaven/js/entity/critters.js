// Java Edition's small-creature models (RabbitModel, OcelotModel, PandaModel, ParrotModel, BatModel,
// FrogModel, CamelModel) with their texture offsets and poses. The frog and camel animate from Java's
// keyframe animations (FrogAnimation, CamelAnimation), played as KeyframeAnimations does. Coordinates
// as in entity/animals.js.
import { jbox, pivot } from './humanoid.js?v=muvda45h';
import { P, child, rot, model, toOurs, R } from './animals.js?v=muvda45h';

const PI = Math.PI;

// ---------------- keyframe animations ----------------
// Java's parts at rest, in its own terms ({ x, y, z, rx, ry, rz } per part).
export function restParts(model) {
  const out = {};
  for (const [k, p] of Object.entries(model.parts)) {
    const pv = p.pivot, r = p.rot || [0, 0, 0];
    out[k] = { x: -pv[0], y: p.parent ? -pv[1] : 24 - pv[1], z: pv[2], rx: -r[0], ry: -r[1], rz: r[2] };
  }
  return out;
}
// Mth.catmullrom.
const catmull = (t, p0, p1, p2, p3) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
// KeyframeAnimations.animate: adds each bone's channels, `t` seconds in (looping or held at the end),
// to `parts` (Java's terms), scaled by `amount`. Keys are [time, x, y, z, catmull-rom?] as Java stores
// them (rotations in radians, positions with y already turned down).
export function animate(parts, def, t, amount = 1) {
  if (def.loop) t %= def.len;
  for (const [bone, channels] of Object.entries(def.bones)) {
    const p = parts[bone];
    if (!p) continue;
    for (const [target, keys] of channels) {
      let i = keys.findIndex(k => t <= k[0]);
      i = Math.max(0, (i < 0 ? keys.length : i) - 1);
      const j = Math.min(keys.length - 1, i + 1), a = keys[i], b = keys[j];
      const f = j !== i ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
      const v = [1, 2, 3].map(c => (b[4] ? catmull(f, keys[Math.max(0, i - 1)][c], a[c], b[c], keys[Math.min(keys.length - 1, j + 1)][c]) : a[c] + (b[c] - a[c]) * f) * amount);
      if (target === 'r') { p.rx += v[0]; p.ry += v[1]; p.rz += v[2]; }
      else if (target === 'p') { p.x += v[0]; p.y += v[1]; p.z += v[2]; }
    }
  }
}
// HierarchicalModel.animateWalk: the walk cycle timed by the limb swing, as strong as the stride.
export const animateWalk = (parts, def, limbSwing, limbAmt, maxSpeed, scale) => animate(parts, def, limbSwing * 50 * maxSpeed / 1000, Math.min(limbAmt * scale, 1));

// Java's FrogAnimation and CamelAnimation keyframes used here (AnimationDefinition data).
export const FROG_WALK = { len: 1.25, loop: true, bones: {
    leftLeg: [['r', [[0,0,0,0],[.1667,0,0,0],[.2917,.7854,0,0],[.625,-.7854,0,0],[.7917,0,0,0],[1.25,0,0,0]]], ['p', [[0,0,-.1,1.2],[.1667,0,-.1,2],[.4583,0,-2,1.06],[.7917,0,-.1,-1],[1.25,0,-.1,1.2]]]],
    rightArm: [['r', [[0,0,0,0],[.125,.3927,0,0],[.4583,-.7854,0,0],[.625,0,.08727,0],[.9583,.1309,.04067,.1309],[1.25,0,0,0]]], ['p', [[0,.5,-.1,2],[.2917,-.5,-1,.12],[.625,0,-.1,-2],[.9583,.5,.25,-.13],[1.25,.5,-.1,2]]]],
    rightLeg: [['r', [[0,-.58905,0,0],[.0417,-.7854,0,0],[.1667,0,0,0],[.7917,0,0,0],[.9583,.7854,0,0],[1.25,-.58905,0,0]]], ['p', [[0,0,-1.14,.11],[.1667,0,-.1,-1],[.7917,0,-.1,2],[1.125,0,-2,.95],[1.25,0,-1.14,.11]]]],
    leftArm: [['r', [[0,0,-.08727,0],[.2917,.1309,-.0466,-.1309],[.625,0,0,0],[.7917,.3927,0,0],[1.125,-.7854,0,0],[1.25,0,-.08727,0]]], ['p', [[0,0,-.1,-2],[.2917,-.5,.25,-.13],[.625,-.5,-.1,2],[.9583,.5,-1,-.11],[1.25,0,-.1,-2]]]],
    body: [['r', [[0,0,.08727,0],[.2917,-.1309,.00576,.1309],[.625,0,-.08727,0],[.9583,-.1309,.00576,-.1309],[1.25,0,.08727,0]]]],
} };
export const FROG_SWIM = { len: 1.04167, loop: true, bones: {
    leftLeg: [['r', [[0,1.5708,0,0,1],[.25,1.5708,0,0,1],[.4583,1.1781,-.7854,0,1],[.7917,1.5708,.7854,0,1],[.9583,1.5708,0,0,1],[1.0417,1.5708,0,0,1]]], ['p', [[0,-2.5,0,1,1],[.25,-2,0,1,1],[.4583,1,2,-1,1],[.7917,.58,0,-2.83,1],[.9583,-2.5,0,1,1],[1.0417,-2.5,0,1,1]]]],
    rightArm: [['r', [[0,1.5708,-.3927,0,1],[.4583,.7854,-.3927,0,1],[.6667,-.3927,.3927,.3927,1],[.875,-.7854,.3927,0,1],[.9583,.3927,0,-.3927,1],[1.0417,1.5708,-.3927,0,1]]], ['p', [[0,0,.64,2,1],[.4583,0,.64,0,1],[.6667,0,0,0,1],[.875,0,.27,-1.14,1],[.9583,0,1.45,.43,1],[1.0417,0,.64,2,1]]]],
    rightLeg: [['r', [[0,1.5708,0,0,1],[.25,1.5708,0,0,1],[.4583,1.1781,.7854,0,1],[.7917,1.5708,-.7854,0,1],[.9583,1.5708,0,0,1],[1.0417,1.5708,0,0,1]]], ['p', [[0,2.5,0,1,1],[.25,2,0,1,1],[.4583,-1,2,-1,1],[.7917,-.58,0,-2.83,1],[.9583,2.5,0,1,1],[1.0417,2.5,0,1,1]]]],
    leftArm: [['r', [[0,1.5708,.3927,0,1],[.4583,.7854,.3927,0,1],[.6667,-.3927,-.3927,-.3927,1],[.875,-.7854,-.3927,0,1],[.9583,.3927,0,.3927,1],[1.0417,1.5708,.3927,0,1]]], ['p', [[0,0,.64,2,1],[.4583,0,.64,0,1],[.6667,0,0,0,1],[.875,0,.27,-1.14,1],[.9583,0,1.45,.43,1],[1.0417,0,.64,2,1]]]],
    body: [['r', [[0,0,0,0,1],[.3333,.17453,0,0,1],[.6667,-.17453,0,0,1],[1.0417,0,0,0,1]]]],
} };
export const FROG_JUMP = { len: .5, loop: false, bones: {
    leftLeg: [['r', [[0,.7854,0,0],[.5,.7854,0,0]]], ['p', [[0,0,0,0],[.5,0,0,0]]]],
    rightArm: [['r', [[0,-.97983,0,0],[.5,-.97983,0,0]]], ['p', [[0,0,-1,0],[.5,0,-1,0]]]],
    rightLeg: [['r', [[0,.7854,0,0],[.5,.7854,0,0]]], ['p', [[0,0,0,0],[.5,0,0,0]]]],
    leftArm: [['r', [[0,-.97983,0,0],[.5,-.97983,0,0]]], ['p', [[0,0,-1,0],[.5,0,-1,0]]]],
    body: [['r', [[0,-.3927,0,0],[.5,-.3927,0,0]]], ['p', [[0,0,0,0],[.5,0,0,0]]]],
} };
export const FROG_IDLE_WATER = { len: 3, loop: true, bones: {
    leftLeg: [['r', [[0,.3927,-.3927,0,1],[1,.3927,-.3927,-.7854,1],[3,.3927,-.3927,0,1]]], ['p', [[0,0,0,1,1],[1,0,1,1,1],[3,0,0,1,1]]]],
    rightArm: [['r', [[0,0,0,.3927,1],[2.2083,0,0,.7854,1],[3,0,0,.3927,1]]], ['p', [[0,1,0,0,1],[2.2083,1,.5,0,1],[3,1,0,0,1]]]],
    rightLeg: [['r', [[0,.3927,.3927,0,1],[1,.3927,.3927,.7854,1],[3,.3927,.3927,0,1]]], ['p', [[0,0,0,1,1],[1,0,1,1,1],[3,0,0,1,1]]]],
    leftArm: [['r', [[0,0,0,-.3927,1],[2.2083,0,0,-.7854,1],[3,0,0,-.3927,1]]], ['p', [[0,-1,0,0,1],[2.2083,-1,.5,0,1],[3,-1,0,0,1]]]],
    body: [['r', [[0,0,0,0,1],[1.625,-.17453,0,0,1],[3,0,0,0,1]]]],
} };
export const CAMEL_WALK = { len: 1.5, loop: true, bones: {
    head: [['r', [[0,.04363,0,0,1],[.375,-.04363,0,0,1],[.75,.04363,0,0,1],[1.125,-.04363,0,0,1],[1.5,.04363,0,0,1]]]],
    rightFrontLeg: [['r', [[0,.3927,0,0,1],[.75,-.3927,0,0,1],[1.5,.3927,0,0,1]]], ['p', [[0,0,0,0,1],[.4583,0,-4,0,1],[.75,0,0,0,1],[1.5,0,0,0,1]]]],
    rightHindLeg: [['r', [[0,.3927,0,0,1],[.625,-.3927,0,0,1],[1.5,.3927,0,0,1]]], ['p', [[0,0,0,0,1],[.375,0,-4,0,1],[.625,0,0,0,1],[1.5,0,0,0,1]]]],
    tail: [['r', [[0,.27822,-.14698,.36549,1],[.75,.27822,.14698,-.36549,1],[1.5,.27822,-.14698,.36549,1]]]],
    root: [['r', [[0,0,0,.04363,1],[1,0,0,-.04363,1],[1.5,0,0,.04363,1]]]],
    leftHindLeg: [['r', [[0,-.35605,0,0,1],[.75,.3927,0,0,1],[1.375,-.3927,0,0],[1.5,-.35605,0,0]]], ['p', [[0,0,.21,0,1],[.75,0,0,0,1],[1.0833,0,-4,0,1],[1.375,0,0,0],[1.5,0,.21,0]]]],
    rightEar: [['r', [[0,0,0,0,1],[.375,0,0,.3927,1],[.75,0,0,0,1],[1.125,0,0,.3927,1],[1.5,0,0,0,1]]]],
    leftFrontLeg: [['r', [[0,-.3927,0,0,1],[.75,.3927,0,0,1],[1.5,-.3927,0,0,1]]], ['p', [[0,0,0,0,1],[.75,0,0,0,1],[1.2083,0,-4,0,1],[1.5,0,0,0,1]]]],
    leftEar: [['r', [[0,0,0,0,1],[.375,0,0,-.3927,1],[.75,0,0,0,1],[1.125,0,0,-.3927,1],[1.5,0,0,0,1]]]],
} };

// ---------------- models ----------------
// RabbitModel: drawn at 0.6 size (the mob's scale); legs, haunches, ears and nose around a sloped body.
export function rabbitModel(st, texture = 'entity/rabbit/brown') {
  const ear = st.ear || st.head;
  return model('jrabbit', {
    body: P(pivot(0, 19, 8), [jbox(0, 0, -3, -2, -10, 6, 5, 10, 0, { style: st.body })], { rot: rot(-0.34906584, 0, 0) }),
    head: P(pivot(0, 16, -1), [jbox(32, 0, -2.5, -4, -5, 5, 4, 5, 0, { style: st.head })]),
    nose: P(pivot(0, 16, -1), [jbox(32, 9, -0.5, -2.5, -5.5, 1, 1, 1, 0, { style: st.nose || st.head })]),
    rightEar: P(pivot(0, 16, -1), [jbox(52, 0, -2.5, -9, -1, 2, 5, 1, 0, { style: ear })], { rot: rot(0, -0.2617994, 0) }),
    leftEar: P(pivot(0, 16, -1), [jbox(58, 0, 0.5, -9, -1, 2, 5, 1, 0, { style: ear })], { rot: rot(0, 0.2617994, 0) }),
    tail: P(pivot(0, 20, 7), [jbox(52, 6, -1.5, -1.5, 0, 3, 3, 2, 0, { style: st.tail || st.body })], { rot: rot(-0.34906584, 0, 0) }),
    rightHaunch: P(pivot(-3, 17.5, 3.7), [jbox(16, 15, -1, 0, 0, 2, 4, 5, 0, { style: st.leg })], { rot: rot(-0.34906584, 0, 0) }),
    leftHaunch: P(pivot(3, 17.5, 3.7), [jbox(30, 15, -1, 0, 0, 2, 4, 5, 0, { style: st.leg })], { rot: rot(-0.34906584, 0, 0) }),
    rightHindFoot: P(pivot(-3, 17.5, 3.7), [jbox(8, 24, -1, 5.5, -3.7, 2, 1, 7, 0, { style: st.leg })]),
    leftHindFoot: P(pivot(3, 17.5, 3.7), [jbox(26, 24, -1, 5.5, -3.7, 2, 1, 7, 0, { style: st.leg })]),
    rightFrontLeg: P(pivot(-3, 17, -1), [jbox(0, 15, -1, 0, -1, 2, 7, 2, 0, { style: st.leg })], { rot: rot(-0.17453292, 0, 0) }),
    leftFrontLeg: P(pivot(3, 17, -1), [jbox(8, 15, -1, 0, -1, 2, 7, 2, 0, { style: st.leg })], { rot: rot(-0.17453292, 0, 0) }),
  }, [64, 32], texture);
}

// OcelotModel: a slim body, the head with nose and ears, a two-piece tail, thin legs.
export function ocelotModel(st, texture = 'entity/cat/ocelot') {
  return model('jocelot', {
    head: P(pivot(0, 15, -9), [jbox(0, 0, -2.5, -2, -3, 5, 4, 5, 0, { style: st.head }), jbox(0, 24, -1.5, -0.001, -4, 3, 2, 2, 0, { style: st.nose || st.head }),
      jbox(0, 10, -2, -3, 0, 1, 1, 2, 0, { style: st.ear || st.head }), jbox(6, 10, 1, -3, 0, 1, 1, 2, 0, { style: st.ear || st.head })]),
    body: P(pivot(0, 12, -10), [jbox(20, 0, -2, 3, -8, 4, 16, 6, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    tail1: P(pivot(0, 15, 8), [jbox(0, 15, -0.5, 0, 0, 1, 8, 1, 0, { style: st.tail })], { rot: rot(0.9, 0, 0) }),
    tail2: P(pivot(0, 20, 14), [jbox(4, 15, -0.5, 0, 0, 1, 8, 1, -0.02, { style: st.tail })]),
    leftHindLeg: P(pivot(1.1, 18, 5), [jbox(8, 13, -1, 0, 1, 2, 6, 2, 0, { style: st.leg })]),
    rightHindLeg: P(pivot(-1.1, 18, 5), [jbox(8, 13, -1, 0, 1, 2, 6, 2, 0, { style: st.leg })]),
    leftFrontLeg: P(pivot(1.2, 14.1, -5), [jbox(40, 0, -1, 0, 0, 2, 10, 2, 0, { style: st.leg })]),
    rightFrontLeg: P(pivot(-1.2, 14.1, -5), [jbox(40, 0, -1, 0, 0, 2, 10, 2, 0, { style: st.leg })]),
  }, [64, 32], texture);
}

// PandaModel (a quadruped): the big head with its muzzle and ears, the body, four stout legs.
export function pandaModel(st, texture = 'entity/panda/panda') {
  const leg = (x, z) => P(pivot(x, 15, z), [jbox(40, 0, -3, 0, -3, 6, 9, 6, 0, { style: st.leg })]);
  return model('jquadruped', {
    head: P(pivot(0, 11.5, -17), [jbox(0, 6, -6.5, -5, -4, 13, 10, 9, 0, { style: st.head }), jbox(45, 16, -3.5, 0, -6, 7, 5, 2, 0, { style: st.muzzle || st.head }),
      jbox(52, 25, 3.5, -8, -1, 5, 4, 1, 0, { style: st.ear || st.head }), jbox(52, 25, -8.5, -8, -1, 5, 4, 1, 0, { style: st.ear || st.head })]),
    body: P(pivot(0, 10, 0), [jbox(0, 25, -9.5, -13, -6.5, 19, 26, 13, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: leg(-5.5, 9), leftHindLeg: leg(5.5, 9), rightFrontLeg: leg(-5.5, -9), leftFrontLeg: leg(5.5, -9),
  }, [64, 64], texture);
}

// ParrotModel (32x32): head with its beak and crest, body, wings, tail and legs.
export function parrotModel(st, texture = 'entity/parrot/parrot_red_blue') {
  return model('jparrot', {
    body: P(pivot(0, 16.5, -3), [jbox(2, 8, -1.5, 0, -1.5, 3, 6, 3, 0, { style: st.body })]),
    tail: P(pivot(0, 21.07, 1.16), [jbox(22, 1, -1.5, -1, -1, 3, 4, 1, 0, { style: st.tail || st.body })]),
    leftWing: P(pivot(1.5, 16.94, -2.76), [jbox(19, 8, -0.5, 0, -1.5, 1, 5, 3, 0, { style: st.wing })]),
    rightWing: P(pivot(-1.5, 16.94, -2.76), [jbox(19, 8, -0.5, 0, -1.5, 1, 5, 3, 0, { style: st.wing })]),
    head: P(pivot(0, 15.69, -2.76), [jbox(2, 2, -1, -1.5, -1, 2, 3, 2, 0, { style: st.head })]),
    head2: P(child(0, -2, -1), [jbox(10, 0, -1, -0.5, -2, 2, 1, 4, 0, { style: st.head })], { parent: 'head' }),
    beak1: P(child(0, -0.5, -1.5), [jbox(11, 7, -0.5, -1, -0.5, 1, 2, 1, 0, { style: st.beak })], { parent: 'head' }),
    beak2: P(child(0, -1.75, -2.45), [jbox(16, 7, -0.5, 0, -0.5, 1, 2, 1, 0, { style: st.beak })], { parent: 'head' }),
    feather: P(child(0, -2.15, 0.15), [jbox(2, 18, 0, -4, -2, 0, 5, 4, 0, { style: st.feather || st.head })], { parent: 'head' }),
    leftLeg: P(pivot(1, 22, -1.05), [jbox(14, 18, -0.5, 0, -0.5, 1, 2, 1, 0, { style: st.leg })]),
    rightLeg: P(pivot(-1, 22, -1.05), [jbox(14, 18, -0.5, 0, -0.5, 1, 2, 1, 0, { style: st.leg })]),
  }, [32, 32], texture);
}

// BatModel (drawn at 0.35 size): head with ears, body, wings in two pieces.
export function batModel(st, texture = 'entity/bat') {
  return model('jbat', {
    head: P(pivot(0, 0, 0), [jbox(0, 0, -3, -3, -3, 6, 6, 6, 0, { style: st.head })]),
    rightEar: P(child(0, 0, 0), [jbox(24, 0, -4, -6, -2, 3, 4, 1, 0, { style: st.ear || st.head })], { parent: 'head' }),
    leftEar: P(child(0, 0, 0), [jbox(24, 0, 1, -6, -2, 3, 4, 1, 0, { style: st.ear || st.head, mirror: true })], { parent: 'head' }),
    body: P(pivot(0, 0, 0), [jbox(0, 16, -3, 4, -3, 6, 12, 6, 0, { style: st.body }), jbox(0, 34, -5, 16, 0, 10, 6, 1, 0, { style: st.body })]),
    rightWing: P(child(0, 0, 0), [jbox(42, 0, -12, 1, 1.5, 10, 16, 1, 0, { style: st.wing })], { parent: 'body' }),
    rightWingTip: P(child(-12, 1, 1.5), [jbox(24, 16, -8, 1, 0, 8, 12, 1, 0, { style: st.wing })], { parent: 'rightWing' }),
    leftWing: P(child(0, 0, 0), [jbox(42, 0, 2, 1, 1.5, 10, 16, 1, 0, { style: st.wing, mirror: true })], { parent: 'body' }),
    leftWingTip: P(child(12, 1, 1.5), [jbox(24, 16, 0, 1, 0, 8, 12, 1, 0, { style: st.wing, mirror: true })], { parent: 'leftWing' }),
  }, [64, 64], texture);
}

// FrogModel (48x48): a root holding the body, the head with its eyes, the tongue and croaking throat,
// arms and legs ending in flat hands and feet.
export function frogModel(st, texture = 'entity/frog/temperate_frog') {
  const flat = st.foot || st.leg;
  return model('jfrog', {
    root: P(pivot(0, 24, 0), []),
    body: P(child(0, -2, 4), [jbox(3, 1, -3.5, -2, -8, 7, 3, 9, 0, { style: st.body }), jbox(23, 22, -3.5, -1, -8, 7, 0, 9, 0, { style: st.body })], { parent: 'root' }),
    head: P(child(0, -2, -1), [jbox(23, 13, -3.5, -1, -7, 7, 0, 9, 0, { style: st.head }), jbox(0, 13, -3.5, -2, -7, 7, 3, 9, 0, { style: st.head })], { parent: 'body' }),
    eyes: P(child(-0.5, 0, 2), [], { parent: 'head' }),
    rightEye: P(child(-1.5, -3, -6.5), [jbox(0, 0, -1.5, -1, -1.5, 3, 2, 3, 0, { style: st.eye })], { parent: 'eyes' }),
    leftEye: P(child(2.5, -3, -6.5), [jbox(0, 5, -1.5, -1, -1.5, 3, 2, 3, 0, { style: st.eye })], { parent: 'eyes' }),
    croakingBody: P(child(0, -1, -5), [jbox(26, 5, -3.5, -0.1, -2.9, 7, 2, 3, -0.1, { style: st.body })], { parent: 'body' }),
    tongue: P(child(0, -1.01, 1), [jbox(17, 13, -2, 0, -7.1, 4, 0, 7, 0, { style: st.tongue || st.body })], { parent: 'body' }),
    leftArm: P(child(4, -1, -6.5), [jbox(0, 32, -1, 0, -1, 2, 3, 3, 0, { style: st.leg })], { parent: 'body' }),
    leftHand: P(child(0, 3, -1), [jbox(18, 40, -4, 0.01, -4, 8, 0, 8, 0, { style: flat })], { parent: 'leftArm' }),
    rightArm: P(child(-4, -1, -6.5), [jbox(0, 38, -1, 0, -1, 2, 3, 3, 0, { style: st.leg })], { parent: 'body' }),
    rightHand: P(child(0, 3, 0), [jbox(2, 40, -4, 0.01, -5, 8, 0, 8, 0, { style: flat })], { parent: 'rightArm' }),
    leftLeg: P(child(3.5, -3, 4), [jbox(14, 25, -1, 0, -2, 3, 3, 4, 0, { style: st.leg })], { parent: 'root' }),
    leftFoot: P(child(2, 3, 0), [jbox(2, 32, -4, 0.01, -4, 8, 0, 8, 0, { style: flat })], { parent: 'leftLeg' }),
    rightLeg: P(child(-3.5, -3, 4), [jbox(0, 25, -2, 0, -2, 3, 3, 4, 0, { style: st.leg })], { parent: 'root' }),
    rightFoot: P(child(-2, 3, 0), [jbox(18, 32, -4, 0.01, -4, 8, 0, 8, 0, { style: flat })], { parent: 'rightLeg' }),
  }, [48, 48], texture);
}

// CamelModel (128x128): a root holding the body with its hump and tail, the long-necked head (with
// the bridle, reins and saddle shown when saddled), ears, and four long legs.
export function camelModel(st, texture = 'entity/camel/camel') {
  const leg = (u, v, x, z) => P(child(x, 1, z), [jbox(u, v, -2.5, 2, -2.5, 5, 21, 5, 0, { style: st.leg })], { parent: 'root' });
  const tack = st.saddle || st.body;
  return model('jcamel', {
    root: P(pivot(0, 0, 0), []),
    body: P(child(0, 4, 9.5), [jbox(0, 25, -7.5, -12, -23.5, 15, 12, 27, 0, { style: st.body })], { parent: 'root' }),
    hump: P(child(0, -12, -10), [jbox(74, 0, -4.5, -5, -5.5, 9, 5, 11, 0, { style: st.hump || st.body })], { parent: 'body' }),
    tail: P(child(0, -9, 3.5), [jbox(122, 0, -1.5, 0, 0, 3, 14, 0, 0, { style: st.tail || st.body })], { parent: 'body' }),
    head: P(child(0, -3, -19.5), [jbox(60, 24, -3.5, -7, -15, 7, 8, 19, 0, { style: st.neck || st.head }), jbox(21, 0, -3.5, -21, -15, 7, 14, 7, 0, { style: st.head }), jbox(50, 0, -2.5, -21, -21, 5, 5, 6, 0, { style: st.head })], { parent: 'body' }),
    leftEar: P(child(3, -21, -9.5), [jbox(45, 0, -0.5, 0.5, -1, 3, 1, 2, 0, { style: st.ear || st.head })], { parent: 'head' }),
    rightEar: P(child(-3, -21, -9.5), [jbox(67, 0, -2.5, 0.5, -1, 3, 1, 2, 0, { style: st.ear || st.head })], { parent: 'head' }),
    leftHindLeg: leg(58, 16, 4.9, 9.5), rightHindLeg: leg(94, 16, -4.9, 9.5), leftFrontLeg: leg(0, 0, 4.9, -10.5), rightFrontLeg: leg(0, 26, -4.9, -10.5),
    saddle: P(child(0, 0, 0), [jbox(74, 64, -4.5, -17, -15.5, 9, 5, 11, 0.1, { style: tack }), jbox(92, 114, -3.5, -20, -15.5, 7, 3, 11, 0.1, { style: tack }), jbox(0, 89, -7.5, -12, -23.5, 15, 12, 27, 0.1, { style: tack })], { parent: 'body' }),
    bridle: P(child(0, 0, 0), [jbox(60, 87, -3.5, -7, -15, 7, 8, 19, 0.1, { style: tack }), jbox(21, 64, -3.5, -21, -15, 7, 14, 7, 0.1, { style: tack }), jbox(50, 64, -2.5, -21, -21, 5, 5, 6, 0.1, { style: tack }),
      jbox(74, 70, 2.5, -19, -18, 1, 2, 2, 0, { style: tack }), jbox(74, 70, -3.5, -19, -18, 1, 2, 2, 0, { style: tack, mirror: true })], { parent: 'head' }),
    reins: P(child(0, 0, 0), [jbox(98, 42, 3.51, -18, -17, 0, 7, 15, 0, { style: tack }), jbox(84, 57, -3.5, -18, -2, 7, 7, 0, 0, { style: tack }), jbox(98, 42, -3.51, -18, -17, 0, 7, 15, 0, { style: tack })], { parent: 'head' }),
  }, [128, 128], texture);
}

// ---------------- poses ----------------
// st as in entity/animals.js, plus: jump (rabbit jump completion 0..1), jumpT (seconds since a frog
// leapt), flying / sitting / flap (parrot), resting (bat), saddled / ridden (camel), inWater, moving.
const D2R = PI / 180;

// RabbitModel.setupAnim: head, ears and nose look; the legs kick back through a jump.
export function rabbitPose(model, st) {
  const pitch = st.headPitch || 0, yaw = st.headYaw || 0, j = Math.sin((st.jump || 0) * PI);
  return toOurs({
    head: R(pitch, yaw), nose: R(pitch, yaw), rightEar: R(pitch, yaw - 0.2617994), leftEar: R(pitch, yaw + 0.2617994),
    leftHaunch: R((j * 50 - 21) * D2R), rightHaunch: R((j * 50 - 21) * D2R), leftHindFoot: R(j * 50 * D2R), rightHindFoot: R(j * 50 * D2R),
    leftFrontLeg: R((j * -40 - 11) * D2R), rightFrontLeg: R((j * -40 - 11) * D2R),
  }, model);
}

// OcelotModel.prepareMobModel / setupAnim: crouched, sprinting or walking, the tail curling with the stride.
export function ocelotPose(model, st) {
  const l = (st.limbSwing || 0) * 0.6662, a = st.limbAmt || 0, c = Math.cos;
  const p = {
    body: { x: 0, y: 12, z: -10, ...R(PI / 2) }, head: { x: 0, y: 15, z: -9, ...R(st.headPitch || 0, st.headYaw || 0) },
    tail1: { x: 0, y: 15, z: 8, ...R(0.9) }, tail2: { x: 0, y: 20, z: 14, ...R() },
    leftFrontLeg: { x: 1.2, y: 14.1, z: -5, ...R() }, rightFrontLeg: { x: -1.2, y: 14.1, z: -5, ...R() },
    leftHindLeg: { x: 1.1, y: 18, z: 5, ...R() }, rightHindLeg: { x: -1.1, y: 18, z: 5, ...R() },
  };
  if (st.crouching) {
    p.body.y += 1; p.head.y += 2; p.tail1.y += 1; p.tail2.y += -4; p.tail2.z += 2; p.tail1.rx = p.tail2.rx = PI / 2;
  } else if (st.sprinting) {
    p.tail2.y = p.tail1.y; p.tail2.z += 2; p.tail1.rx = PI / 2;
    p.leftHindLeg.rx = c(l) * a; p.rightHindLeg.rx = c(l + 0.3) * a; p.leftFrontLeg.rx = c(l + PI + 0.3) * a; p.rightFrontLeg.rx = c(l + PI) * a;
    p.tail2.rx = 1.7278761 + 0.31415927 * c(st.limbSwing || 0) * a;
  } else {
    p.leftHindLeg.rx = c(l) * a; p.rightHindLeg.rx = c(l + PI) * a; p.leftFrontLeg.rx = c(l + PI) * a; p.rightFrontLeg.rx = c(l) * a;
    p.tail2.rx = 1.7278761 + PI / 4 * c(st.limbSwing || 0) * a;
  }
  return toOurs(p, model);
}

// ParrotModel.prepare / setupAnim: perched, standing or flying (wings beating with `flap`), the tail
// and legs following.
export function parrotPose(model, st) {
  const l = (st.limbSwing || 0) * 0.6662, a = st.limbAmt || 0, bob = st.flap || 0;
  const p = {
    head: { x: 0, y: 15.69, z: -2.76, ...R(st.headPitch || 0, st.headYaw || 0) }, feather: R(-0.2214),
    body: { x: 0, y: 16.5, z: -3, ...R(0.4937) }, tail: { x: 0, y: 21.07, z: 1.16, ...R() },
    leftWing: { x: 1.5, y: 16.94, z: -2.76, ...R(-0.6981, -PI) }, rightWing: { x: -1.5, y: 16.94, z: -2.76, ...R(-0.6981, -PI) },
    leftLeg: { x: 1, y: 22, z: -1.05, ...R(-0.0299) }, rightLeg: { x: -1, y: 22, z: -1.05, ...R(-0.0299) },
  };
  if (st.sitting) {
    p.head.y = 17.59; p.tail.rx = 1.5388988; p.tail.y = 22.97; p.body.y = 18.4;
    p.leftWing.rz = -0.0873; p.leftWing.y = 18.84; p.rightWing.rz = 0.0873; p.rightWing.y = 18.84;
    p.leftLeg.y += 1.9; p.rightLeg.y += 1.9; p.leftLeg.rx += PI / 2; p.rightLeg.rx += PI / 2;
  } else {
    if (st.flying) { p.leftLeg.rx += 0.6981317; p.rightLeg.rx += 0.6981317; }
    else { p.leftLeg.rx += Math.cos(l) * 1.4 * a; p.rightLeg.rx += Math.cos(l + PI) * 1.4 * a; }
    const f = bob * 0.3;
    p.head.y = 15.69 + f; p.tail.rx = 1.015 + Math.cos(l) * 0.3 * a; p.tail.y = 21.07 + f; p.body.y = 16.5 + f;
    p.leftWing.rz = -0.0873 - bob; p.leftWing.y = 16.94 + f; p.rightWing.rz = 0.0873 + bob; p.rightWing.y = 16.94 + f;
    p.leftLeg.y = 22 + f; p.rightLeg.y = 22 + f;
  }
  return toOurs(p, model);
}

// BatModel.setupAnim: hanging upside down asleep, or flying with the wings beating.
export function batPose(model, st) {
  const age = st.age || 0, p = {};
  if (st.resting) {
    p.head = { x: 0, y: -2, z: 0, ...R(st.headPitch || 0, PI - (st.headYaw || 0), PI) };
    p.body = R(PI);
    p.rightWing = { x: -3, y: 0, z: 3, ...R(-0.15707964, -1.2566371) }; p.leftWing = { x: 3, y: 0, z: 3, ...R(-0.15707964, 1.2566371) };
    p.rightWingTip = R(0, -1.7278761); p.leftWingTip = R(0, 1.7278761);
  } else {
    const w = Math.cos(age * 74.48451 * D2R) * PI * 0.25;
    p.head = { x: 0, y: 0, z: 0, ...R(st.headPitch || 0, st.headYaw || 0) };
    p.body = R(PI / 4 + Math.cos(age * 0.1) * 0.15);
    p.rightWing = { x: 0, y: 0, z: 0, ...R(0, w) }; p.leftWing = { x: 0, y: 0, z: 0, ...R(0, -w) };
    p.rightWingTip = R(0, w * 0.5); p.leftWingTip = R(0, -w * 0.5);
  }
  return toOurs(p, model);
}

// FrogModel.setupAnim: the leap, the swim stroke or hop-walk timed by its stride, and treading water
// when still; the croaking throat stays hidden.
export function frogPose(model, st) {
  const p = restParts(model);
  if (st.jumpT !== undefined && st.jumpT !== null) animate(p, FROG_JUMP, st.jumpT);
  if (st.inWater) animateWalk(p, FROG_SWIM, st.limbSwing || 0, st.limbAmt || 0, 1, 2.5);
  else animateWalk(p, FROG_WALK, st.limbSwing || 0, st.limbAmt || 0, 1.5, 2.5);
  if (st.inWater && !st.moving) animate(p, FROG_IDLE_WATER, (st.age || 0) / 20);
  const out = toOurs(p, model);
  out.poses.hide = { croakingBody: true };
  return out;
}

// CamelModel.setupAnim: the head looks (within its reach), the walk cycle, and the saddle, bridle and
// reins shown only when saddled (the reins while ridden).
export function camelPose(model, st) {
  const p = restParts(model), clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  p.head.ry = clamp(st.headYaw || 0, -30 * D2R, 30 * D2R);
  p.head.rx = clamp(st.headPitch || 0, -25 * D2R, 45 * D2R);
  animateWalk(p, CAMEL_WALK, st.limbSwing || 0, st.limbAmt || 0, 2, 2.5);
  const out = toOurs(p, model);
  out.poses.hide = { saddle: !st.saddled, bridle: !st.saddled, reins: !(st.saddled && st.ridden) };
  return out;
}

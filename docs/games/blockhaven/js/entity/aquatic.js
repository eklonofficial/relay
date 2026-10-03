// Java Edition's water mob models (SquidModel, CodModel, SalmonModel, TropicalFishModelA/B, the three
// Pufferfish models, GuardianModel, DolphinModel, TurtleModel, AxolotlModel) with their texture
// offsets, and their setupAnim poses. Coordinates as in entity/animals.js.
import { jbox, pivot } from './humanoid.js?v=musn4era';
import { P, child, rot, model, toOurs, R } from './animals.js?v=musn4era';

const PI = Math.PI;

// SquidModel (squids, glow squids): the body and eight tentacles in a ring.
export function squidModel(st, texture = 'entity/squid/squid') {
  const parts = { body: P(pivot(0, 8, 0), [jbox(0, 0, -6, -8, -6, 12, 16, 12, 0.02, { style: st.body })]) };
  for (let i = 0; i < 8; i++) {
    const a = i * PI * 2 / 8;
    parts[`tentacle${i}`] = P(pivot(Math.cos(a) * 5, 15, Math.sin(a) * 5), [jbox(48, 0, -1, 0, -1, 2, 18, 2, 0, { style: st.tentacle })], { rot: rot(0, i * PI * -2 / 8 + PI / 2, 0) });
  }
  return model('jsquid', parts, [64, 32], texture);
}

// CodModel (32x32): body, head and nose, fins, a tail fin.
export function codModel(st, texture = 'entity/fish/cod') {
  return model('jfish', {
    body: P(pivot(0, 22, 0), [jbox(0, 0, -1, -2, 0, 2, 4, 7, 0, { style: st.body })]),
    head: P(pivot(0, 22, 0), [jbox(11, 0, -1, -2, -3, 2, 4, 3, 0, { style: st.head })]),
    nose: P(pivot(0, 22, -3), [jbox(0, 0, -1, -2, -1, 2, 3, 1, 0, { style: st.head })]),
    rightFin: P(pivot(-1, 23, 0), [jbox(22, 1, -2, 0, -1, 2, 0, 2, 0, { style: st.fin })], { rot: rot(0, 0, -PI / 4) }),
    leftFin: P(pivot(1, 23, 0), [jbox(22, 4, 0, 0, -1, 2, 0, 2, 0, { style: st.fin })], { rot: rot(0, 0, PI / 4) }),
    tailFin: P(pivot(0, 22, 7), [jbox(22, 3, 0, -2, 0, 0, 4, 4, 0, { style: st.fin })]),
    topFin: P(pivot(0, 20, 0), [jbox(20, -6, 0, -1, -1, 0, 1, 6, 0, { style: st.fin })]),
  }, [32, 32], texture, { tailPart: 'tailFin', tailAmp: 0.45, flop: [1.6, 1.6, -1.6] });
}

// SalmonModel (32x32): a two-piece body (the back half swishing), head, fins.
export function salmonModel(st, texture = 'entity/fish/salmon') {
  return model('jfish', {
    bodyFront: P(pivot(0, 20, 0), [jbox(0, 0, -1.5, -2.5, 0, 3, 5, 8, 0, { style: st.body })]),
    bodyBack: P(pivot(0, 20, 8), [jbox(0, 13, -1.5, -2.5, 0, 3, 5, 8, 0, { style: st.body })]),
    head: P(pivot(0, 20, 0), [jbox(22, 0, -1, -2, -3, 2, 4, 3, 0, { style: st.head })]),
    backFin: P(child(0, 0, 8), [jbox(20, 10, 0, -2.5, 0, 0, 5, 6, 0, { style: st.fin })], { parent: 'bodyBack' }),
    topFrontFin: P(child(0, -4.5, 5), [jbox(2, 1, 0, 0, 0, 0, 2, 3, 0, { style: st.fin })], { parent: 'bodyFront' }),
    topBackFin: P(child(0, -4.5, -1), [jbox(0, 2, 0, 0, 0, 0, 2, 4, 0, { style: st.fin })], { parent: 'bodyBack' }),
    rightFin: P(pivot(-1.5, 21.5, 0), [jbox(-4, 0, -2, 0, 0, 2, 0, 2, 0, { style: st.fin })], { rot: rot(0, 0, -PI / 4) }),
    leftFin: P(pivot(1.5, 21.5, 0), [jbox(0, 0, 0, 0, 0, 2, 0, 2, 0, { style: st.fin })], { rot: rot(0, 0, PI / 4) }),
  }, [32, 32], texture, { tailPart: 'bodyBack', tailAmp: 0.25, salmon: true, flop: [3.2, 1.6, 0] });
}

// TropicalFishModelA (small) and B (large), 32x32, tinted by the fish's base colour; `inflate` 0.008
// gives the pattern layer drawn over them in the pattern colour.
export function tropicalFishModel(st, texture = 'entity/fish/tropical_a', large = false, inflate = 0) {
  const k = inflate, fin = st.fin || st.body;
  const parts = large ? {
    body: P(pivot(0, 19, 0), [jbox(0, 20, -1, -3, -3, 2, 6, 6, k, { style: st.body })]),
    tail: P(pivot(0, 19, 3), [jbox(21, 16, 0, -3, 0, 0, 6, 5, k, { style: fin })]),
    rightFin: P(pivot(-1, 20, 0), [jbox(2, 16, -2, 0, 0, 2, 2, 0, k, { style: fin })], { rot: rot(0, PI / 4, 0) }),
    leftFin: P(pivot(1, 20, 0), [jbox(2, 12, 0, 0, 0, 2, 2, 0, k, { style: fin })], { rot: rot(0, -PI / 4, 0) }),
    topFin: P(pivot(0, 16, -3), [jbox(20, 11, 0, -4, 0, 0, 4, 6, k, { style: fin })]),
    bottomFin: P(pivot(0, 22, -3), [jbox(20, 21, 0, 0, 0, 0, 4, 6, k, { style: fin })]),
  } : {
    body: P(pivot(0, 22, 0), [jbox(0, 0, -1, -1.5, -3, 2, 3, 6, k, { style: st.body })]),
    tail: P(pivot(0, 22, 3), [jbox(22, -6, 0, -1.5, 0, 0, 3, 6, k, { style: fin })]),
    rightFin: P(pivot(-1, 22.5, 0), [jbox(2, 16, -2, -1, 0, 2, 2, 0, k, { style: fin })], { rot: rot(0, PI / 4, 0) }),
    leftFin: P(pivot(1, 22.5, 0), [jbox(2, 12, 0, -1, 0, 2, 2, 0, k, { style: fin })], { rot: rot(0, -PI / 4, 0) }),
    topFin: P(pivot(0, 20.5, -3), [jbox(10, -5, 0, -3, 0, 0, 3, 6, k, { style: fin })]),
  };
  return model('jfish', parts, [32, 32], texture, { tailPart: 'tail', tailAmp: 0.45, flop: [3.2, 1.6, 0] });
}

// PufferfishSmallModel, PufferfishMidModel, PufferfishBigModel (32x32): the three puff states.
export function pufferfishModel(st, size = 0, texture = 'entity/fish/pufferfish') {
  const fin = st.fin || st.body;
  const parts = size === 0 ? {
    body: P(pivot(0, 23, 0), [jbox(0, 27, -1.5, -2, -1.5, 3, 2, 3, 0, { style: st.body })]),
    rightEye: P(pivot(0, 20, 0), [jbox(24, 6, -1.5, 0, -1.5, 1, 1, 1, 0, { style: st.eye || st.body })]),
    leftEye: P(pivot(0, 20, 0), [jbox(28, 6, 0.5, 0, -1.5, 1, 1, 1, 0, { style: st.eye || st.body })]),
    backFin: P(pivot(0, 22, 1.5), [jbox(-3, 0, -1.5, 0, 0, 3, 0, 3, 0, { style: fin })]),
    rightFin: P(pivot(-1.5, 22, -1.5), [jbox(25, 0, -1, 0, 0, 1, 0, 2, 0, { style: fin })]),
    leftFin: P(pivot(1.5, 22, -1.5), [jbox(25, 0, 0, 0, 0, 1, 0, 2, 0, { style: fin })]),
  } : size === 1 ? {
    body: P(pivot(0, 22, 0), [jbox(12, 22, -2.5, -5, -2.5, 5, 5, 5, 0, { style: st.body })]),
    rightBlueFin: P(pivot(-2.5, 17, -1.5), [jbox(24, 0, -2, 0, 0, 2, 0, 2, 0, { style: fin })]),
    leftBlueFin: P(pivot(2.5, 17, -1.5), [jbox(24, 3, 0, 0, 0, 2, 0, 2, 0, { style: fin })]),
    topFrontFin: P(pivot(0, 17, -2.5), [jbox(15, 16, -2.5, -1, 0, 5, 1, 1, 0, { style: fin })], { rot: rot(PI / 4, 0, 0) }),
    topBackFin: P(pivot(0, 17, 2.5), [jbox(10, 16, -2.5, -1, -1, 5, 1, 1, 0, { style: fin })], { rot: rot(-PI / 4, 0, 0) }),
    rightFrontFin: P(pivot(-2.5, 22, -2.5), [jbox(8, 16, -1, -5, 0, 1, 5, 1, 0, { style: fin })], { rot: rot(0, -PI / 4, 0) }),
    rightBackFin: P(pivot(-2.5, 22, 2.5), [jbox(8, 16, -1, -5, 0, 1, 5, 1, 0, { style: fin })], { rot: rot(0, PI / 4, 0) }),
    leftBackFin: P(pivot(2.5, 22, 2.5), [jbox(4, 16, 0, -5, 0, 1, 5, 1, 0, { style: fin })], { rot: rot(0, -PI / 4, 0) }),
    leftFrontFin: P(pivot(2.5, 22, -2.5), [jbox(0, 16, 0, -5, 0, 1, 5, 1, 0, { style: fin })], { rot: rot(0, PI / 4, 0) }),
    bottomBackFin: P(pivot(0.5, 22, 2.5), [jbox(8, 22, 0, 0, 0, 1, 1, 1, 0, { style: fin })], { rot: rot(PI / 4, 0, 0) }),
    bottomFrontFin: P(pivot(0, 22, -2.5), [jbox(17, 21, -2.5, 0, 0, 5, 1, 1, 0, { style: fin })], { rot: rot(-PI / 4, 0, 0) }),
  } : {
    body: P(pivot(0, 22, 0), [jbox(0, 0, -4, -8, -4, 8, 8, 8, 0, { style: st.body })]),
    rightBlueFin: P(pivot(-4, 15, -2), [jbox(24, 0, -2, 0, -1, 2, 1, 2, 0, { style: fin })]),
    leftBlueFin: P(pivot(4, 15, -2), [jbox(24, 3, 0, 0, -1, 2, 1, 2, 0, { style: fin })]),
    topFrontFin: P(pivot(0, 14, -4), [jbox(15, 17, -4, -1, 0, 8, 1, 0, 0, { style: fin })], { rot: rot(PI / 4, 0, 0) }),
    topMiddleFin: P(pivot(0, 14, 0), [jbox(14, 16, -4, -1, 0, 8, 1, 1, 0, { style: fin })]),
    topBackFin: P(pivot(0, 14, 4), [jbox(23, 18, -4, -1, 0, 8, 1, 0, 0, { style: fin })], { rot: rot(-PI / 4, 0, 0) }),
    rightFrontFin: P(pivot(-4, 22, -4), [jbox(5, 17, -1, -8, 0, 1, 8, 0, 0, { style: fin })], { rot: rot(0, -PI / 4, 0) }),
    leftFrontFin: P(pivot(4, 22, -4), [jbox(1, 17, 0, -8, 0, 1, 8, 0, 0, { style: fin })], { rot: rot(0, PI / 4, 0) }),
    bottomFrontFin: P(pivot(0, 22, -4), [jbox(15, 20, -4, 0, 0, 8, 1, 0, 0, { style: fin })], { rot: rot(-PI / 4, 0, 0) }),
    bottomMiddleFin: P(pivot(0, 22, 0), [jbox(15, 20, -4, 0, 0, 8, 1, 0, 0, { style: fin })]),
    bottomBackFin: P(pivot(0, 22, 4), [jbox(15, 20, -4, 0, 0, 8, 1, 0, 0, { style: fin })], { rot: rot(PI / 4, 0, 0) }),
    rightBackFin: P(pivot(-4, 22, 4), [jbox(9, 17, -1, -8, 0, 1, 8, 0, 0, { style: fin })], { rot: rot(0, PI / 4, 0) }),
    leftBackFin: P(pivot(4, 22, 4), [jbox(9, 17, 0, -8, 0, 1, 8, 0, 0, { style: fin })], { rot: rot(0, -PI / 4, 0) }),
  };
  return model('jpufferfish', parts, [32, 32], texture, { puff: size });
}

// GuardianModel (guardians and elder guardians): the spiked body, an eye that follows its target, and
// a three-piece tail.
const SPIKE_XR = [1.75, 0.25, 0, 0, 0.5, 0.5, 0.5, 0.5, 1.25, 0.75, 0, 0];
const SPIKE_YR = [0, 0, 0, 0, 0.25, 1.75, 1.25, 0.75, 0, 0, 0, 0];
const SPIKE_ZR = [0, 0, 0.25, 1.75, 0, 0, 0, 0, 0, 0, 0.75, 1.25];
const SPIKE_X = [0, 0, 8, -8, -8, 8, 8, -8, 0, 0, 8, -8];
const SPIKE_Y = [-8, -8, -8, -8, 0, 0, 0, 0, 8, 8, 8, 8];
const SPIKE_Z = [8, -8, 0, 0, -8, -8, 8, 8, 8, -8, 0, 0];
// GuardianModel.getSpikeX/Y/Z: each spike's place, drawn in by `f` (0 out .. 0.55 in) and quivering.
const spikeAt = (i, age, f) => { const k = 1 + Math.cos(age * 1.5 + i) * 0.01 - f; return [SPIKE_X[i] * k, 16 + SPIKE_Y[i] * k, SPIKE_Z[i] * k]; };
export function guardianModel(st, texture = 'entity/guardian') {
  const parts = {
    head: P(pivot(0, 0, 0), [jbox(0, 0, -6, 10, -8, 12, 12, 16, 0, { style: st.body }), jbox(0, 28, -8, 10, -6, 2, 12, 12, 0, { style: st.side || st.body }),
      jbox(0, 28, 6, 10, -6, 2, 12, 12, 0, { style: st.side || st.body, mirror: true }), jbox(16, 40, -6, 8, -6, 12, 2, 12, 0, { style: st.cap || st.body }), jbox(16, 40, -6, 22, -6, 12, 2, 12, 0, { style: st.cap || st.body })]),
    eye: P(child(0, 0, -8.25), [jbox(8, 0, -1, 15, 0, 2, 2, 1, 0, { style: st.eye })], { parent: 'head' }),
    tail0: P(child(0, 0, 0), [jbox(40, 0, -2, 14, 7, 4, 4, 8, 0, { style: st.tail })], { parent: 'head' }),
    tail1: P(child(-1.5, 0.5, 14), [jbox(0, 54, 0, 14, 0, 3, 3, 7, 0, { style: st.tail })], { parent: 'tail0' }),
    tail2: P(child(0.5, 0.5, 6), [jbox(41, 32, 0, 14, 0, 2, 2, 6, 0, { style: st.tail }), jbox(25, 19, 1, 10.5, 3, 1, 9, 9, 0, { style: st.fin || st.tail })], { parent: 'tail1' }),
  };
  for (let i = 0; i < 12; i++) parts[`spike${i}`] = P(child(...spikeAt(i, 0, 0)), [jbox(0, 0, -1, -4.5, -1, 2, 9, 2, 0, { style: st.spike })], { parent: 'head', rot: rot(PI * SPIKE_XR[i], PI * SPIKE_YR[i], PI * SPIKE_ZR[i]) });
  return model('jguardian', parts, [64, 64], texture);
}

// DolphinModel: body with head and nose, fins, a two-piece tail.
export function dolphinModel(st, texture = 'entity/dolphin') {
  return model('jdolphin', {
    body: P(pivot(0, 22, -5), [jbox(22, 0, -4, -7, 0, 8, 7, 13, 0, { style: st.body })]),
    backFin: P(child(0, 0, 0), [jbox(51, 0, -0.5, 0, 8, 1, 4, 5, 0, { style: st.fin })], { parent: 'body', rot: rot(PI / 3, 0, 0) }),
    leftFin: P(child(2, -2, 4), [jbox(48, 20, -0.5, -4, 0, 1, 4, 7, 0, { style: st.fin, mirror: true })], { parent: 'body', rot: rot(PI / 3, 0, 2 * PI / 3) }),
    rightFin: P(child(-2, -2, 4), [jbox(48, 20, -0.5, -4, 0, 1, 4, 7, 0, { style: st.fin })], { parent: 'body', rot: rot(PI / 3, 0, -2 * PI / 3) }),
    tail: P(child(0, -2.5, 11), [jbox(0, 19, -2, -2.5, 0, 4, 5, 11, 0, { style: st.tail || st.body })], { parent: 'body', rot: rot(-0.10471976, 0, 0) }),
    tailFin: P(child(0, 0, 9), [jbox(19, 20, -5, -0.5, 0, 10, 1, 6, 0, { style: st.fin })], { parent: 'tail' }),
    head: P(child(0, -4, -3), [jbox(0, 0, -4, -3, -3, 8, 7, 6, 0, { style: st.head })], { parent: 'body' }),
    nose: P(child(0, 0, 0), [jbox(0, 13, -1, 2, -7, 2, 2, 4, 0, { style: st.nose || st.head })], { parent: 'head' }),
  }, [64, 64], texture);
}

// TurtleModel (128x64): the shell and belly lying along z, the egg belly (when carrying eggs),
// flippers and hind legs.
export function turtleModel(st, texture = 'entity/turtle/big_sea_turtle') {
  return model('jturtle', {
    head: P(pivot(0, 19, -10), [jbox(3, 0, -3, -1, -3, 6, 5, 6, 0, { style: st.head })]),
    body: P(pivot(0, 11, -10), [jbox(7, 37, -9.5, 3, -10, 19, 20, 6, 0, { style: st.body }), jbox(31, 1, -5.5, 3, -13, 11, 18, 3, 0, { style: st.belly || st.body })], { rot: rot(PI / 2, 0, 0) }),
    eggBelly: P(pivot(0, 11, -10), [jbox(70, 33, -4.5, 3, -14, 9, 18, 1, 0, { style: st.belly || st.body })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: P(pivot(-3.5, 22, 11), [jbox(1, 23, -2, 0, 0, 4, 1, 10, 0, { style: st.leg })]),
    leftHindLeg: P(pivot(3.5, 22, 11), [jbox(1, 12, -2, 0, 0, 4, 1, 10, 0, { style: st.leg })]),
    rightFrontLeg: P(pivot(-5, 21, -4), [jbox(27, 30, -13, 0, -2, 13, 1, 5, 0, { style: st.leg })]),
    leftFrontLeg: P(pivot(5, 21, -4), [jbox(27, 24, 0, 0, -2, 13, 1, 5, 0, { style: st.leg })]),
  }, [128, 64], texture);
}

// AxolotlModel: body with a fin, the head with three gills, four little legs and a tail fin.
export function axolotlModel(st, texture = 'entity/axolotl/axolotl_lucy') {
  const leg = (x, z, right) => P(child(x, 1, z), [jbox(2, 13, right ? -2 : -1, 0, 0, 3, 5, 0, 0.001, { style: st.leg })], { parent: 'body' });
  return model('jaxolotl', {
    body: P(pivot(0, 20, 5), [jbox(0, 11, -4, -2, -9, 8, 4, 10, 0, { style: st.body }), jbox(2, 17, 0, -3, -8, 0, 5, 9, 0, { style: st.fin })]),
    head: P(child(0, 0, -9), [jbox(0, 1, -4, -3, -5, 8, 5, 5, 0.001, { style: st.head })], { parent: 'body' }),
    topGills: P(child(0, -3, -1), [jbox(3, 37, -4, -3, 0, 8, 3, 0, 0.001, { style: st.gills })], { parent: 'head' }),
    leftGills: P(child(-4, 0, -1), [jbox(0, 40, -3, -5, 0, 3, 7, 0, 0.001, { style: st.gills })], { parent: 'head' }),
    rightGills: P(child(4, 0, -1), [jbox(11, 40, 0, -5, 0, 3, 7, 0, 0.001, { style: st.gills })], { parent: 'head' }),
    rightHindLeg: leg(-3.5, -1, true), leftHindLeg: leg(3.5, -1, false), rightFrontLeg: leg(-3.5, -8, true), leftFrontLeg: leg(3.5, -8, false),
    tail: P(child(0, 0, 1), [jbox(2, 19, 0, -3, 0, 0, 5, 12, 0, { style: st.fin })], { parent: 'body' }),
  }, [64, 64], texture);
}

// ---------------- poses ----------------
// st as in entity/animals.js, plus: tentacleAngle (squid), inWater, onGround, moving, spikes (guardian
// spikes drawn in, 0..0.55), tail (guardian tail animation), eye ([x, y] in Java's terms).

// SquidModel.setupAnim: every tentacle at the squid's tentacle angle.
export function squidPose(model, st) {
  const parts = {};
  for (let i = 0; i < 8; i++) parts[`tentacle${i}`] = R(st.tentacleAngle || 0, i * PI * -2 / 8 + PI / 2);
  return toOurs(parts, model);
}

// CodModel / SalmonModel / TropicalFishModel.setupAnim: the tail swishing, faster when stranded.
export function fishPose(model, st) {
  const out = !st.inWater, age = st.age || 0;
  const a = model.salmon ? (out ? 1.3 : 1) * 0.25 * Math.sin((out ? 1.7 : 1) * 0.6 * age) : (out ? 1.5 : 1) * model.tailAmp * Math.sin(0.6 * age);
  return toOurs({ [model.tailPart]: R(0, -a) }, model);
}
// Cod/Salmon/TropicalFishRenderer.setupRotations: the body's own sway (radians about y).
export const fishSway = (model, st) => (model.salmon && !st.inWater ? 1.3 : 1) * 4.3 * Math.sin((model.salmon && !st.inWater ? 1.7 : 1) * 0.6 * (st.age || 0)) * PI / 180;

// Pufferfish models' setupAnim: the side fins beating.
export function pufferfishPose(model, st) {
  const z = 0.4 * Math.sin((st.age || 0) * 0.2);
  const [r, l] = model.puff === 0 ? ['rightFin', 'leftFin'] : ['rightBlueFin', 'leftBlueFin'];
  return toOurs({ [r]: R(0, 0, -0.2 + z), [l]: R(0, 0, 0.2 - z) }, model);
}

// GuardianModel.setupAnim: head look, the spikes drawn in while it swims, the eye turned to its
// target, the tail swaying.
export function guardianPose(model, st) {
  const age = st.age || 0, f = st.spikes || 0, parts = { head: R(st.headPitch || 0, st.headYaw || 0) };
  for (let i = 0; i < 12; i++) { const [x, y, z] = spikeAt(i, age, f); parts[`spike${i}`] = { x, y, z, ...R(PI * SPIKE_XR[i], PI * SPIKE_YR[i], PI * SPIKE_ZR[i]) }; }
  const [ex, ey] = st.eye || [0, 0];
  parts.eye = { x: ex, y: ey, z: -8.25, ...R() };
  const t = Math.sin(st.tail || 0) * PI;
  parts.tail0 = R(0, t * 0.05); parts.tail1 = R(0, t * 0.1); parts.tail2 = R(0, t * 0.15);
  return toOurs(parts, model);
}

// DolphinModel.setupAnim: the body follows the gaze, and bobs with the tail as it swims.
export function dolphinPose(model, st) {
  const c = Math.cos((st.age || 0) * 0.3), parts = { body: R(st.headPitch || 0, st.headYaw || 0), tail: R(-0.10471976), tailFin: R() };
  if (st.moving) { parts.body.rx += -0.05 - 0.05 * c; parts.tail = R(-0.1 * c); parts.tailFin = R(-0.2 * c); }
  return toOurs(parts, model);
}

// TurtleModel.setupAnim: flippers paddling (in water) or hauling it along the ground.
export function turtlePose(model, st) {
  const l = st.limbSwing || 0, a = st.limbAmt || 0, w = l * 0.6662 * 0.6;
  const parts = {
    head: R(st.headPitch || 0, st.headYaw || 0), body: R(PI / 2), eggBelly: R(PI / 2),
    rightHindLeg: R(Math.cos(w) * 0.5 * a), leftHindLeg: R(Math.cos(w + PI) * 0.5 * a),
    rightFrontLeg: R(0, 0, Math.cos(w + PI) * 0.5 * a), leftFrontLeg: R(0, 0, Math.cos(w) * 0.5 * a),
  };
  if (!st.inWater && st.onGround) {
    parts.rightFrontLeg = R(0, Math.cos(l * 5 + PI) * 8 * a); parts.leftFrontLeg = R(0, Math.cos(l * 5) * 8 * a);
    parts.rightHindLeg = R(0, Math.cos(l * 5 + PI) * 3 * a); parts.leftHindLeg = R(0, Math.cos(l * 5) * 3 * a);
  }
  const out = toOurs(parts, model);
  out.poses.hide = { eggBelly: !st.hasEgg };
  return out;
}

// AxolotlModel.setupAnim: swimming, hovering in the water, crawling, or lying still on the ground,
// each easing into its pose (here, the pose it eases to).
export function axolotlPose(model, st) {
  const age = st.age || 0, p = {};
  const set = (k, rx = 0, ry = 0, rz = 0) => { p[k] = R(rx, ry, rz); };
  const mirrorLegs = () => { for (const s of ['Hind', 'Front']) { const l = p[`left${s}Leg`]; p[`right${s}Leg`] = R(l.rx, -l.ry, -l.rz); } };
  ['head', 'topGills', 'leftGills', 'rightGills', 'tail', 'leftHindLeg', 'leftFrontLeg', 'rightHindLeg', 'rightFrontLeg'].forEach(k => set(k));
  set('body', (st.headPitch || 0), (st.headYaw || 0));
  let bodyY = 20;
  if (st.inWater) {
    if (st.moving) {
      // setupSwimmingAnimation
      const f = age * 0.33, s = Math.sin(f), c = Math.cos(f), k = 0.13 * s;
      p.body = R((st.headPitch || 0) + k, st.headYaw || 0); p.head.rx = -k * 1.8; bodyY -= 0.45 * c;
      p.topGills.rx = -0.5 * s - 0.8; p.leftGills.ry = 0.3 * s + 0.9; p.rightGills.ry = -p.leftGills.ry;
      p.tail.ry = 0.3 * Math.cos(f * 0.9);
      set('leftHindLeg', 1.8849558, -0.4 * s, PI / 2); set('leftFrontLeg', 1.8849558, -0.2 * c - 0.1, PI / 2);
    } else {
      // setupWaterHoveringAnimation
      const f = age * 0.075, c = Math.cos(f), s = Math.sin(f) * 0.15;
      p.body = R(-0.15 + 0.075 * c, st.headYaw || 0); bodyY -= s; p.head.rx = -p.body.rx;
      p.topGills.rx = 0.2 * c; p.leftGills.ry = -0.3 * c - 0.19; p.rightGills.ry = -p.leftGills.ry;
      set('leftHindLeg', 2.3561945 - c * 0.11, 0.47123894, 1.7278761); set('leftFrontLeg', PI / 4 - c * 0.2, 2.042035, 0);
      p.tail.ry = 0.5 * c;
    }
    mirrorLegs();
  } else if (st.moving) {
    // setupGroundCrawlingAnimation
    const f = age * 0.11, c = Math.cos(f), k = (c * c - 2 * c) / 5, m = 0.7 * c;
    p.head.ry = 0.09 * c; p.tail.ry = p.head.ry;
    p.topGills.rx = 0.6 - 0.08 * (c * c + 2 * Math.sin(f)); p.leftGills.ry = -p.topGills.rx; p.rightGills.ry = -p.leftGills.ry;
    set('leftHindLeg', 0.9424779, 1.5 - k, -0.1); set('leftFrontLeg', 1.0995574, PI / 2 - m, 0);
    set('rightHindLeg', 0.9424779, -1 - k, 0); set('rightFrontLeg', 1.0995574, -PI / 2 - m, 0);
    p.body = R(0, st.headYaw || 0);
  } else {
    // setupLayStillOnGroundAnimation
    const f = age * 0.09, s = Math.sin(f), c = Math.cos(f), a = s * s - 2 * s, b = c * c - 3 * s;
    p.head = R(-0.09 * a, 0, -0.2); p.tail.ry = -0.1 + 0.1 * a;
    p.topGills.rx = 0.6 + 0.05 * b; p.leftGills.ry = -p.topGills.rx; p.rightGills.ry = -p.leftGills.ry;
    set('leftHindLeg', 1.1, 1, 0); set('leftFrontLeg', 0.8, 2.3, -0.5); mirrorLegs();
    p.body = R(0, (st.headYaw || 0));
  }
  p.body = { x: 0, y: bodyY, z: 5, ...p.body };
  return toOurs(p, model);
}

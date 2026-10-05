// Java Edition's monster models (CreeperModel, SpiderModel, EndermanModel, SlimeModel, LavaSlimeModel,
// SilverfishModel, EndermiteModel, BlazeModel, GhastModel, PhantomModel) with their texture offsets, and
// their setupAnim poses. Coordinates as in entity/animals.js.
import { jbox, pivot, humanoidParts } from './humanoid.js?v=muujns32';
import { P, child, rot, model, toOurs, R } from './animals.js?v=muujns32';

const PI = Math.PI;

// CreeperModel: head and body on one pivot, four short legs.
// (Grown by `k`, it is the charged creeper's CreeperPowerLayer, 2.0.)
export function creeperModel(st, texture = 'entity/creeper/creeper', k = 0) {
  const leg = (x, z) => P(pivot(x, 18, z), [jbox(0, 16, -2, 0, -2, 4, 6, 4, k, { style: st.leg || st.body })]);
  return model('jcreeper', {
    head: P(pivot(0, 6, 0), [jbox(0, 0, -4, -8, -4, 8, 8, 8, k, { style: st.head })]),
    body: P(pivot(0, 6, 0), [jbox(16, 16, -4, 0, -2, 8, 12, 4, k, { style: st.body })]),
    rightHindLeg: leg(-2, 4), leftHindLeg: leg(2, 4), rightFrontLeg: leg(-2, -4), leftFrontLeg: leg(2, -4),
  }, [64, 32], texture);
}

// SpiderModel (spiders and cave spiders): head, a small thorax and a big abdomen, eight legs from
// one texture (the left ones mirrored). SpiderEyesLayer's glowing eyes are drawn over the skin.
export function spiderModel(st, texture = ['entity/spider/spider', 'entity/spider_eyes']) {
  const leg = (x, z) => P(pivot(x, 15, z), [jbox(18, 0, x < 0 ? -15 : -1, -1, -1, 16, 2, 2, 0, x < 0 ? { style: st.leg } : { style: st.leg, mirror: true })]);
  return model('jspider', {
    head: P(pivot(0, 15, -3), [jbox(32, 4, -4, -4, -8, 8, 8, 8, 0, { style: st.head })]),
    body0: P(pivot(0, 15, 0), [jbox(0, 0, -3, -3, -3, 6, 6, 6, 0, { style: st.neck })]),
    body1: P(pivot(0, 15, 9), [jbox(0, 12, -5, -4, -6, 10, 8, 12, 0, { style: st.body })]),
    rightHindLeg: leg(-4, 2), leftHindLeg: leg(4, 2), rightMiddleHindLeg: leg(-4, 1), leftMiddleHindLeg: leg(4, 1),
    rightMiddleFrontLeg: leg(-4, 0), leftMiddleFrontLeg: leg(4, 0), rightFrontLeg: leg(-4, -1), leftFrontLeg: leg(4, -1),
  }, [64, 32], texture);
}

// EndermanModel: the humanoid mesh with 30-long limbs, and the jaw (the head's inner `hat`) that stays
// behind when the head lifts in anger. EnderEyesLayer's eyes are drawn over the skin.
export function endermanModel(st, texture = ['entity/enderman/enderman', 'entity/enderman/enderman_eyes']) {
  const limb = (x, y, top, mirror) => P(pivot(x, y, 0), [jbox(56, 0, -1, top, -1, 2, 30, 2, 0, mirror ? { style: st.limb, mirror: true } : { style: st.limb })]);
  return model('jenderman', {
    head: P(pivot(0, -13, 0), [jbox(0, 0, -4, -8, -4, 8, 8, 8, 0, { style: st.head })]),
    hat: P(pivot(0, -13, 0), [jbox(0, 16, -4, -8, -4, 8, 8, 8, -0.5, { style: st.jaw })]),
    body: P(pivot(0, -14, 0), [jbox(32, 16, -4, 0, -2, 8, 12, 4, 0, { style: st.body })]),
    rightArm: limb(-5, -12, -2, false), leftArm: limb(5, -12, -2, true),
    rightLeg: limb(-2, -5, 0, false), leftLeg: limb(2, -5, 0, true),
  }, [64, 32], texture);
}

// SlimeModel: the inner layer (core, eyes, mouth) and, drawn see-through over it, the outer jelly.
export function slimeModel(st, texture = 'entity/slime/slime') {
  return model('jslime', {
    cube: P(pivot(0, 0, 0), [jbox(0, 16, -3, 17, -3, 6, 6, 6, 0, { style: st.core })]),
    rightEye: P(pivot(0, 0, 0), [jbox(32, 0, -3.25, 18, -3.5, 2, 2, 2, 0, { style: st.eye })]),
    leftEye: P(pivot(0, 0, 0), [jbox(32, 4, 1.25, 18, -3.5, 2, 2, 2, 0, { style: st.eye })]),
    mouth: P(pivot(0, 0, 0), [jbox(32, 8, 0, 21, -3.5, 1, 1, 1, 0, { style: st.mouth || st.eye })]),
  }, [64, 32], texture);
}
export function slimeOuterModel(st, texture = 'entity/slime/slime') {
  return model('jslime', { cube: P(pivot(0, 0, 0), [jbox(0, 0, -4, 16, -4, 8, 8, 8, 0, { style: st.shell })]) }, [64, 32], texture, { clear: true });
}

// LavaSlimeModel: eight one-pixel slices (pulled apart as it squishes) round a small core. `st.slice(i)`
// paints slice i (top first).
export function magmaCubeModel(st, texture = 'entity/slime/magmacube') {
  const uv = [[0, 0], [0, 1], [24, 10], [24, 19], [0, 4], [0, 5], [0, 6], [0, 7]], parts = {};
  for (let i = 0; i < 8; i++) parts[`cube${i}`] = P(pivot(0, 0, 0), [jbox(uv[i][0], uv[i][1], -4, 16 + i, -4, 8, 1, 8, 0, { style: st.slice ? st.slice(i) : st.body })]);
  parts.insideCube = P(pivot(0, 0, 0), [jbox(0, 16, -2, 18, -2, 4, 4, 4, 0, { style: st.core })]);
  return model('jmagma', parts, [64, 32], texture);
}

// SilverfishModel: seven segments tapering to the tail (BODY_SIZES, BODY_TEXS) and three shell layers.
const SILVERFISH = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
const SILVERFISH_UV = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
// EndermiteModel: four segments.
const ENDERMITE = [[4, 3, 2], [6, 4, 5], [3, 3, 1], [1, 2, 1]];
const ENDERMITE_UV = [[0, 0], [0, 5], [0, 14], [0, 18]];
// The segments sit end to end from z = -3.5, each on the ground.
function segments(sizes, uvs, st) {
  const parts = {}, zs = [];
  let z = -3.5;
  sizes.forEach(([w, h, d], i) => {
    parts[`segment${i}`] = P(pivot(0, 24 - h, z), [jbox(uvs[i][0], uvs[i][1], w * -0.5, 0, d * -0.5, w, h, d, 0, { style: i === 0 && st.head ? st.head : st.body })]);
    zs.push(z);
    if (i < sizes.length - 1) z += (d + sizes[i + 1][2]) * 0.5;
  });
  return { parts, zs };
}
export function silverfishModel(st, texture = 'entity/silverfish') {
  const { parts, zs } = segments(SILVERFISH, SILVERFISH_UV, st), S = SILVERFISH;
  parts.layer0 = P(pivot(0, 16, zs[2]), [jbox(20, 0, -5, 0, S[2][2] * -0.5, 10, 8, S[2][2], 0, { style: st.shell || st.body })]);
  parts.layer1 = P(pivot(0, 20, zs[4]), [jbox(20, 11, -3, 0, S[4][2] * -0.5, 6, 4, S[4][2], 0, { style: st.shell || st.body })]);
  parts.layer2 = P(pivot(0, 19, zs[1]), [jbox(20, 18, -3, 0, S[4][2] * -0.5, 6, 5, S[1][2], 0, { style: st.shell || st.body })]);
  return model('jsilverfish', parts, [64, 32], texture, { wiggle: [0.05, 0.2] });
}
export function endermiteModel(st, texture = 'entity/endermite') {
  return model('jsilverfish', segments(ENDERMITE, ENDERMITE_UV, st).parts, [64, 32], texture, { wiggle: [0.01, 0.1] });
}

// BlazeModel: the head and twelve rods in three rings (placed by blazePose).
export function blazeModel(st, texture = 'entity/blaze') {
  const parts = { head: P(pivot(0, 0, 0), [jbox(0, 0, -4, -4, -4, 8, 8, 8, 0, { style: st.head })]) };
  for (let i = 0; i < 12; i++) parts[`part${i}`] = P(pivot(0, 0, 0), [jbox(0, 16, 0, 0, 0, 2, 8, 2, 0, { style: st.rod })]);
  const m = model('jblaze', parts, [64, 32], texture);
  Object.assign(m.parts, blazePose(m, { age: 0 }).pivotParts);
  return m;
}

// GhastModel: the body and nine tentacles, their lengths drawn from RandomSource.create(1660).
const GHAST_TENTACLES = [8, 13, 9, 11, 11, 10, 12, 9, 12];
export function ghastModel(st, texture = 'entity/ghast/ghast') {
  const parts = { body: P(pivot(0, 17.6, 0), [jbox(0, 0, -8, -8, -8, 16, 16, 16, 0, { style: st.body })]) };
  GHAST_TENTACLES.forEach((len, i) => {
    const x = ((i % 3 - (Math.floor(i / 3) % 2) * 0.5 + 0.25) / 2 * 2 - 1) * 5, z = (Math.floor(i / 3) / 2 * 2 - 1) * 5;
    parts[`tentacle${i}`] = P(pivot(x, 24.6, z), [jbox(0, 0, -1, 0, -1, 2, len, 2, 0, { style: st.tentacle })]);
  });
  return model('jghast', parts, [64, 32], texture);
}

// PhantomModel: body, head, two-piece wings and tail. (PhantomRenderer lifts it 1.3125 blocks back up
// and 0.1875 forward from where its body would sit; that is folded into the body's pivot.)
export function phantomModel(st, texture = ['entity/phantom', 'entity/phantom_eyes']) {
  return model('jphantom', {
    body: P(pivot(0, 21, 3), [jbox(0, 8, -3, -2, -8, 5, 3, 9, 0, { style: st.body })], { rot: rot(-0.1, 0, 0) }),
    head: P(child(0, 1, -7), [jbox(0, 0, -4, -2, -5, 7, 3, 5, 0, { style: st.head })], { parent: 'body', rot: rot(0.2, 0, 0) }),
    rightWingBase: P(child(-3, -2, -8), [jbox(23, 12, -6, 0, 0, 6, 2, 9, 0, { style: st.wing, mirror: true })], { parent: 'body', rot: rot(0, 0, -0.1) }),
    rightWingTip: P(child(-6, 0, 0), [jbox(16, 24, -13, 0, 0, 13, 1, 9, 0, { style: st.wingTip || st.wing, mirror: true })], { parent: 'rightWingBase', rot: rot(0, 0, -0.1) }),
    leftWingBase: P(child(2, -2, -8), [jbox(23, 12, 0, 0, 0, 6, 2, 9, 0, { style: st.wing })], { parent: 'body', rot: rot(0, 0, 0.1) }),
    leftWingTip: P(child(6, 0, 0), [jbox(16, 24, 0, 0, 0, 13, 1, 9, 0, { style: st.wingTip || st.wing })], { parent: 'leftWingBase', rot: rot(0, 0, 0.1) }),
    tailBase: P(child(0, -2, 1), [jbox(3, 20, -2, 0, 0, 3, 2, 6, 0, { style: st.tail || st.body })], { parent: 'body' }),
    tailTip: P(child(0, 0.5, 6), [jbox(4, 29, -1, 0, 0, 1, 1, 6, 0, { style: st.tail || st.body })], { parent: 'tailBase' }),
  }, [64, 64], texture);
}

// ---------------- poses ----------------
// st as in entity/animals.js, plus: carrying, creepy (enderman), squish (magma cube), age in ticks.
const legSwing = (limb, amt, phase) => Math.cos(limb * 0.6662 + phase) * 1.4 * amt;

// CreeperModel.setupAnim (its fields name the legs crosswise, so the pairs swing the other way round).
export function creeperPose(model, st) {
  const l = st.limbSwing || 0, a = st.limbAmt || 0;
  return toOurs({
    head: R(st.headPitch || 0, st.headYaw || 0),
    rightHindLeg: R(legSwing(l, a, PI)), leftHindLeg: R(legSwing(l, a, 0)), rightFrontLeg: R(legSwing(l, a, 0)), leftFrontLeg: R(legSwing(l, a, PI)),
  }, model);
}

// SpiderModel.setupAnim: legs splayed out and fanned, rowing forward and lifting in alternate pairs.
export function spiderPose(model, st) {
  const l = (st.limbSwing || 0) * 0.6662, a = st.limbAmt || 0;
  const z = [PI / 4, 0.58119464, 0.58119464, PI / 4], y = [PI / 4, 0.3926991, -0.3926991, -PI / 4];
  const phase = [0, PI, PI / 2, 3 * PI / 2];
  const parts = { head: R(st.headPitch || 0, st.headYaw || 0) };
  ['Hind', 'MiddleHind', 'MiddleFront', 'Front'].forEach((n, i) => {
    const swing = -(Math.cos(l * 2 + phase[i]) * 0.4) * a, lift = Math.abs(Math.sin(l + phase[i]) * 0.4) * a;
    parts[`right${n}Leg`] = R(0, y[i] + swing, -z[i] + lift);
    parts[`left${n}Leg`] = R(0, -y[i] - swing, z[i] - lift);
  });
  return toOurs(parts, model);
}

// EndermanModel.setupAnim: HumanoidModel's pose with the limbs' swing halved and held within 0.4,
// arms forward when it carries a block, and the head lifted 5 off the jaw when it screams (`creepy`).
export function endermanPose(model, st) {
  const p = humanoidParts(st), clamp = v => Math.max(-0.4, Math.min(0.4, v * 0.5));
  for (const k of ['rightArm', 'leftArm', 'rightLeg', 'leftLeg']) p[k].rx = clamp(p[k].rx);
  if (st.carrying) { p.rightArm.rx = p.leftArm.rx = -0.5; p.rightArm.rz = 0.05; p.leftArm.rz = -0.05; }
  Object.assign(p.body, { rx: 0, y: -14, z: 0 });
  p.rightLeg.y = p.leftLeg.y = -5; p.rightLeg.z = p.leftLeg.z = 0;
  Object.assign(p.head, { y: -13, z: 0 });
  p.hat = { ...p.head };
  if (st.creepy) p.head.y -= 5;
  Object.assign(p.rightArm, { x: -5, y: -12, z: 0 }); Object.assign(p.leftArm, { x: 5, y: -12, z: 0 });
  p.rightLeg.x = -2; p.leftLeg.x = 2;
  return toOurs(p, model);
}

// LavaSlimeModel.prepareMobModel: the slices spread apart by the squish.
export function magmaPose(model, st) {
  const sq = Math.max(0, st.squish || 0), parts = {};
  for (let i = 0; i < 8; i++) parts[`cube${i}`] = { x: 0, y: -(4 - i) * sq * 1.7, z: 0, ...R() };
  return toOurs(parts, model);
}

// SilverfishModel / EndermiteModel.setupAnim: the segments sway side to side in a travelling wave.
export function silverfishPose(model, st) {
  const t = (st.age || 0) * 0.9, [turn, sway] = model.wiggle, parts = {};
  const n = Object.keys(model.parts).filter(k => k.startsWith('segment')).length;
  for (let i = 0; i < n; i++) {
    const p = model.parts[`segment${i}`].pivot, ph = t + i * 0.15 * PI;
    parts[`segment${i}`] = { x: Math.sin(ph) * PI * sway * Math.abs(i - 2), y: 24 - p[1], z: p[2], ...R(0, Math.cos(ph) * PI * turn * (1 + Math.abs(i - 2))) };
  }
  // The shell layers ride on segments 2, 4 and 1.
  const ride = (k, s, moveX) => { if (model.parts[k]) { const p = model.parts[k].pivot; parts[k] = { x: moveX ? parts[s].x : 0, y: 24 - p[1], z: p[2], ...R(0, parts[s].ry) }; } };
  ride('layer0', 'segment2', false); ride('layer1', 'segment4', true); ride('layer2', 'segment1', true);
  return toOurs(parts, model);
}

// BlazeModel.setupAnim: three rings of four rods, turning and bobbing around the head.
export function blazePose(model, st) {
  const t = st.age || 0, parts = {};
  const ring = (from, a0, speed, r, y0, freq, bob) => {
    let a = a0 + t * PI * speed;
    for (let i = from; i < from + 4; i++, a += PI / 2) parts[`part${i}`] = { x: Math.cos(a) * r, y: y0 + Math.cos((bob(i) + t) * freq), z: Math.sin(a) * r, ...R() };
  };
  ring(0, 0, -0.1, 9, -2, 0.25, i => i * 2);
  ring(4, PI / 4, 0.03, 7, 2, 0.25, i => i * 2);
  ring(8, 0.47123894, -0.05, 5, 11, 0.5, i => i * 1.5);
  parts.head = R(st.headPitch || 0, st.headYaw || 0);
  const out = toOurs(parts, model);
  out.pivotParts = {};
  for (let i = 0; i < 12; i++) out.pivotParts[`part${i}`] = { ...model.parts[`part${i}`], pivot: out.pivots[`part${i}`] };
  return out;
}

// GhastModel.setupAnim: the tentacles swaying slowly.
export function ghastPose(model, st) {
  const t = st.age || 0, parts = {};
  for (let i = 0; i < 9; i++) parts[`tentacle${i}`] = R(0.2 * Math.sin(t * 0.3 + i) + 0.4);
  return toOurs(parts, model);
}

// PhantomModel.setupAnim: wings beating 16 degrees each way, the tail flicking with them.
export function phantomPose(model, st) {
  const f = ((st.id || 0) * 3 + (st.age || 0)) * 7.448451 * PI / 180, wing = Math.cos(f) * 16 * PI / 180, tail = -(5 + Math.cos(f * 2) * 5) * PI / 180;
  return toOurs({
    body: R(-0.1), head: R(0.2),
    leftWingBase: R(0, 0, wing), leftWingTip: R(0, 0, wing), rightWingBase: R(0, 0, -wing), rightWingTip: R(0, 0, -wing),
    tailBase: R(tail), tailTip: R(tail),
  }, model);
}

// Java Edition's golem and beast models (IronGolemModel, SnowGolemModel, HoglinModel, StriderModel,
// RavagerModel) with their texture offsets, and their setupAnim / prepareMobModel poses. Coordinates as
// in entity/animals.js.
import { jbox, pivot } from './humanoid.js?v=muujnf54';
import { P, child, rot, model, toOurs, R } from './animals.js?v=muujnf54';

const PI = Math.PI;
// Mth.triangleWave.
const tri = (x, period) => (Math.abs(x % period - period * 0.5) - period * 0.25) / (period * 0.25);

// IronGolemModel (128x128): head with its nose, a broad chest over a waist, long arms, short legs.
export function ironGolemModel(st, texture = 'entity/iron_golem/iron_golem') {
  return model('jirongolem', {
    head: P(pivot(0, -7, -2), [jbox(0, 0, -4, -12, -5.5, 8, 10, 8, 0, { style: st.head }), jbox(24, 0, -1, -5, -7.5, 2, 4, 2, 0, { style: st.nose || st.head })]),
    body: P(pivot(0, -7, 0), [jbox(0, 40, -9, -2, -6, 18, 12, 11, 0, { style: st.body }), jbox(0, 70, -4.5, 10, -3, 9, 5, 6, 0.5, { style: st.waist || st.body })]),
    rightArm: P(pivot(0, -7, 0), [jbox(60, 21, -13, -2.5, -3, 4, 30, 6, 0, { style: st.arm })]),
    leftArm: P(pivot(0, -7, 0), [jbox(60, 58, 9, -2.5, -3, 4, 30, 6, 0, { style: st.arm })]),
    rightLeg: P(pivot(-4, 11, 0), [jbox(37, 0, -3.5, -3, -3, 6, 16, 5, 0, { style: st.leg })]),
    leftLeg: P(pivot(5, 11, 0), [jbox(60, 0, -3.5, -3, -3, 6, 16, 5, 0, { style: st.leg, mirror: true })]),
  }, [128, 128], texture);
}

// SnowGolemModel: two snowballs, the head (under SnowGolemHeadLayer's pumpkin), stick arms.
export function snowGolemModel(st, texture = 'entity/snow_golem') {
  const arm = () => [jbox(32, 0, -1, 0, -1, 12, 2, 2, -0.5, { style: st.arm })];
  return model('jsnowgolem', {
    head: P(pivot(0, 4, 0), [jbox(0, 0, -4, -8, -4, 8, 8, 8, -0.5, { style: st.head })]),
    upperBody: P(pivot(0, 13, 0), [jbox(0, 16, -5, -10, -5, 10, 10, 10, -0.5, { style: st.body })]),
    lowerBody: P(pivot(0, 24, 0), [jbox(0, 36, -6, -12, -6, 12, 12, 12, -0.5, { style: st.body })]),
    leftArm: P(pivot(5, 6, 1), arm(), { rot: rot(0, 0, 1) }),
    rightArm: P(pivot(-5, 6, -1), arm(), { rot: rot(0, PI, -1) }),
  }, [64, 64], texture);
}

// HoglinModel (128x64): a long head with horns and floppy ears, a big body with a mane, four legs.
export function hoglinModel(st, texture = 'entity/hoglin/hoglin') {
  const leg = (u, v, x, y, z, w, h) => P(pivot(x, y, z), [jbox(u, v, -w / 2, 0, -w / 2, w, h, w, 0, { style: st.leg })]);
  return model('jhoglin', {
    body: P(pivot(0, 7, 0), [jbox(1, 1, -8, -7, -13, 16, 14, 26, 0, { style: st.body })]),
    mane: P(child(0, -14, -5), [jbox(90, 33, 0, 0, -9, 0, 10, 19, 0.001, { style: st.mane || st.body })], { parent: 'body' }),
    head: P(pivot(0, 2, -12), [jbox(61, 1, -7, -3, -19, 14, 6, 19, 0, { style: st.head })], { rot: rot(0.87266463, 0, 0) }),
    rightEar: P(child(-6, -2, -3), [jbox(1, 1, -6, -1, -2, 6, 1, 4, 0, { style: st.ear || st.head })], { parent: 'head', rot: rot(0, 0, -0.6981317) }),
    leftEar: P(child(6, -2, -3), [jbox(1, 6, 0, -1, -2, 6, 1, 4, 0, { style: st.ear || st.head })], { parent: 'head', rot: rot(0, 0, 0.6981317) }),
    rightHorn: P(child(-7, 2, -12), [jbox(10, 13, -1, -11, -1, 2, 11, 2, 0, { style: st.horn })], { parent: 'head' }),
    leftHorn: P(child(7, 2, -12), [jbox(1, 13, -1, -11, -1, 2, 11, 2, 0, { style: st.horn })], { parent: 'head' }),
    rightFrontLeg: leg(66, 42, -4, 10, -8.5, 6, 14), leftFrontLeg: leg(41, 42, 4, 10, -8.5, 6, 14),
    rightHindLeg: leg(21, 45, -5, 13, 10, 5, 11), leftHindLeg: leg(0, 45, 5, 13, 10, 5, 11),
  }, [128, 64], texture);
}

// StriderModel (64x128): the body with three bristles a side, two long legs. Its saddle (SaddleLayer)
// is the same mesh with the saddle texture.
export function striderModel(st, texture = 'entity/strider/strider') {
  const bristle = (v, x, y, right, zRot) => P(child(x, y, -8), [jbox(16, v, right ? -12 : 0, 0, 0, 12, 0, 16, 0, right ? { style: st.bristle, mirror: true } : { style: st.bristle })], { parent: 'body', rot: rot(0, 0, zRot) });
  return model('jstrider', {
    body: P(pivot(0, 1, 0), [jbox(0, 0, -8, -6, -8, 16, 14, 16, 0, { style: st.body })]),
    rightBottomBristle: bristle(65, -8, 4, true, -1.2217305), rightMiddleBristle: bristle(49, -8, -1, true, -1.134464), rightTopBristle: bristle(33, -8, -5, true, -0.87266463),
    leftTopBristle: bristle(33, 8, -6, false, 0.87266463), leftMiddleBristle: bristle(49, 8, -2, false, 1.134464), leftBottomBristle: bristle(65, 8, 3, false, 1.2217305),
    rightLeg: P(pivot(-4, 8, 0), [jbox(0, 32, -2, 0, -2, 4, 16, 4, 0, { style: st.leg })]),
    leftLeg: P(pivot(4, 8, 0), [jbox(0, 55, -2, 0, -2, 4, 16, 4, 0, { style: st.leg })]),
  }, [64, 128], texture);
}

// RavagerModel (128x128): a neck carrying the head (horns, a jaw that drops), a two-box body, four
// long legs.
export function ravagerModel(st, texture = 'entity/illager/ravager') {
  const leg = (u, x, z, mirror) => P(pivot(x, -13, z), [jbox(u, 0, -4, 0, -4, 8, 37, 8, 0, mirror ? { style: st.leg, mirror: true } : { style: st.leg })]);
  return model('jravager', {
    neck: P(pivot(0, -7, 5.5), [jbox(68, 73, -5, -1, -18, 10, 10, 18, 0, { style: st.neck || st.body })]),
    head: P(child(0, 16, -17), [jbox(0, 0, -8, -20, -14, 16, 20, 16, 0, { style: st.head }), jbox(0, 0, -2, -6, -18, 4, 8, 4, 0, { style: st.nose || st.head })], { parent: 'neck' }),
    rightHorn: P(child(-10, -14, -8), [jbox(74, 55, 0, -14, -2, 2, 14, 4, 0, { style: st.horn })], { parent: 'head', rot: rot(1.0995574, 0, 0) }),
    leftHorn: P(child(8, -14, -8), [jbox(74, 55, 0, -14, -2, 2, 14, 4, 0, { style: st.horn, mirror: true })], { parent: 'head', rot: rot(1.0995574, 0, 0) }),
    mouth: P(child(0, -2, 2), [jbox(0, 36, -8, 0, -16, 16, 3, 16, 0, { style: st.mouth || st.head })], { parent: 'head' }),
    body: P(pivot(0, 1, 2), [jbox(0, 55, -7, -10, -7, 14, 16, 20, 0, { style: st.body }), jbox(0, 91, -6, 6, -7, 12, 13, 18, 0, { style: st.body })], { rot: rot(PI / 2, 0, 0) }),
    rightHindLeg: leg(96, -8, 18, false), leftHindLeg: leg(96, 8, 18, true), rightFrontLeg: leg(64, -8, -5, false), leftFrontLeg: leg(64, 8, -5, true),
  }, [128, 128], texture);
}

// ---------------- poses ----------------
// st as in entity/animals.js, plus attackTicks (Java's attack animation counter, 10 down to 0), ridden.

// IronGolemModel.setupAnim / prepareMobModel: stiff legs and arms swinging on a triangle wave; both
// arms raised and brought down on an attack.
export function ironGolemPose(model, st) {
  const l = st.limbSwing || 0, a = st.limbAmt || 0, w = tri(l, 13), t = st.attackTicks || 0;
  const arms = t > 0 ? [-2 + 1.5 * tri(t, 10), -2 + 1.5 * tri(t, 10)] : [(-0.2 + 1.5 * w) * a, (-0.2 - 1.5 * w) * a];
  return toOurs({
    head: R(st.headPitch || 0, st.headYaw || 0),
    rightLeg: R(-1.5 * w * a), leftLeg: R(1.5 * w * a), rightArm: R(arms[0]), leftArm: R(arms[1]),
  }, model);
}
// IronGolemRenderer.setupRotations: the side-to-side lurch of its walk (radians about z).
export const ironGolemSway = (limbSwing, limbAmt) => limbAmt < 0.01 ? 0 : 6.5 * ((Math.abs((limbSwing + 6) % 13 - 6.5) - 3.25) / 3.25) * PI / 180;

// SnowGolemModel.setupAnim: the head looks; the upper body turns a quarter as far, the arms with it.
export function snowGolemPose(model, st) {
  const yaw = st.headYaw || 0, body = yaw * 0.25, s = Math.sin(body), c = Math.cos(body);
  return toOurs({
    head: R(st.headPitch || 0, yaw), upperBody: R(0, body),
    leftArm: { x: c * 5, y: 6, z: -s * 5, ...R(0, body, 1) }, rightArm: { x: -c * 5, y: 6, z: s * 5, ...R(0, body + PI, -1) },
  }, model);
}

// HoglinModel.setupAnim: ears flapping with its stride, the head swung up to gore (attackTicks),
// legs in diagonal pairs.
export function hoglinPose(model, st) {
  const l = st.limbSwing || 0, a = st.limbAmt || 0, t = st.attackTicks || 0;
  const f = 1 - Math.abs(10 - 2 * t) / 10, front = Math.cos(l) * 1.2 * a, back = Math.cos(l + PI) * 1.2 * a;
  return toOurs({
    rightEar: R(0, 0, -0.6981317 - a * Math.sin(l)), leftEar: R(0, 0, 0.6981317 + a * Math.sin(l)),
    head: { x: 0, y: 2, z: -12, ...R(0.87266463 + (-0.34906584 - 0.87266463) * f, st.headYaw || 0) },
    mane: { x: 0, y: -14, z: -7, ...R() },
    rightFrontLeg: R(front), leftHindLeg: R(front), leftFrontLeg: R(back), rightHindLeg: R(back),
  }, model);
}

// StriderModel.setupAnim: the body follows the gaze (unless ridden) and bobs and rolls with its long
// stride; the bristles stream back as it walks and drift on their own.
export function striderPose(model, st) {
  const l = st.limbSwing || 0, a = Math.min(0.25, st.limbAmt || 0), age = st.age || 0, h = l * 1.5 * 0.5;
  const sway = Math.cos(l * 1.5 + PI) * a;
  const parts = {
    body: { x: 0, y: 2 - 2 * Math.cos(l * 1.5) * 2 * a, z: 0, ...R(st.ridden ? 0 : st.headPitch || 0, st.ridden ? 0 : st.headYaw || 0, 0.1 * Math.sin(l * 1.5) * 4 * a) },
    leftLeg: { x: 4, y: 8 + 2 * Math.sin(h + PI) * 2 * a, z: 0, ...R(Math.sin(h) * 2 * a, 0, 0.17453292 * Math.cos(h) * a) },
    rightLeg: { x: -4, y: 8 + 2 * Math.sin(h) * 2 * a, z: 0, ...R(Math.sin(h + PI) * 2 * a, 0, 0.17453292 * Math.cos(h + PI) * a) },
  };
  const b = (base, k, drift) => R(0, 0, base + sway * k + drift);
  parts.rightBottomBristle = b(-1.2217305, 1.3, 0.05 * Math.sin(age * -0.4));
  parts.rightMiddleBristle = b(-1.134464, 1.2, 0.1 * Math.sin(age * 0.2));
  parts.rightTopBristle = b(-0.87266463, 0.6, 0.1 * Math.sin(age * 0.4));
  parts.leftTopBristle = b(0.87266463, 0.6, 0.1 * Math.sin(age * 0.4));
  parts.leftMiddleBristle = b(1.134464, 1.2, 0.1 * Math.sin(age * 0.2));
  parts.leftBottomBristle = b(1.2217305, 1.3, 0.05 * Math.sin(age * -0.4));
  return toOurs(parts, model);
}

// RavagerModel.setupAnim / prepareMobModel: head look, slow heavy legs; on an attack the neck lunges
// out and the jaw snaps (attackTicks); otherwise the mouth hangs a little open.
export function ravagerPose(model, st) {
  const l = (st.limbSwing || 0) * 0.6662, a = 0.4 * (st.limbAmt || 0), t = st.attackTicks || 0;
  const parts = {
    head: R(st.headPitch || 0, st.headYaw || 0),
    rightHindLeg: R(Math.cos(l) * a), leftHindLeg: R(Math.cos(l + PI) * a), rightFrontLeg: R(Math.cos(l + PI) * a), leftFrontLeg: R(Math.cos(l) * a),
  };
  if (t > 0) {
    const f = (1 + tri(t, 10)) * 0.5, reach = f * f * f * 12;
    parts.neck = { x: 0, y: -7, z: -6.5 + reach, ...R() };
    parts.mouth = R(t > 5 ? Math.sin((-4 + t) / 4) * PI * 0.4 : 0.15707964 * Math.sin(PI * t / 10));
  } else {
    parts.neck = { x: 0, y: -7, z: 5.5, ...R() };
    parts.mouth = R(PI * 0.01);
  }
  return toOurs(parts, model);
}

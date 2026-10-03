// The player and armor models exactly as Java Edition builds them (PlayerModel, HumanoidArmorModel),
// so real skins and armor textures map pixel for pixel, plus HumanoidModel.setupAnim's poses.
//
// Java's model space has y pointing down from the neck and x mirrored; ours has the feet at y = 0
// and x the other way, so a Java point (x, y, z) is (-x, 24 - y, z) here, and rotations about x and
// y change sign (z rotations keep theirs). Boxes keep Java's texture offsets, and `java: true` makes
// the renderer unwrap them as Java's ModelPart.Cube does.

// A Java box: texture offset (u, v), corner and size in Java coordinates around its part's pivot.
function jbox(u, v, x, y, z, w, h, d, inflate = 0, extra = {}) {
  return { uv: [u, v], us: [w, h, d], o: [-(x + w), -(y + h), z], s: [w, h, d], inflate, ...extra };
}
const pivot = (x, y, z) => [-x, 24 - y, z];

// PlayerModel.createMesh: 64x64 skin with the second (outer) layer on every part. Slim (Alex) arms
// are 3 px wide. Styles paint the default skins; the outer layer stays clear unless given one.
export function playerModel(st = {}, slim = false) {
  const aw = slim ? 3 : 4, ay = slim ? 2.5 : 2;
  const part = (pv, boxes) => ({ pivot: pv, boxes });
  return {
    java: true, tex: [64, 64], anim: 'biped', eye: 24 + 8 * 0.55, slim,
    parts: {
      head: part(pivot(0, 0, 0), [jbox(0, 0, -4, -8, -4, 8, 8, 8, 0, { style: st.head }), jbox(32, 0, -4, -8, -4, 8, 8, 8, 0.5, { style: st.hat })]),
      body: part(pivot(0, 0, 0), [jbox(16, 16, -4, 0, -2, 8, 12, 4, 0, { style: st.body }), jbox(16, 32, -4, 0, -2, 8, 12, 4, 0.25, { style: st.jacket })]),
      rightArm: part(pivot(-5, ay, 0), [jbox(40, 16, slim ? -2 : -3, -2, -2, aw, 12, 4, 0, { style: st.arm }), jbox(40, 32, slim ? -2 : -3, -2, -2, aw, 12, 4, 0.25, { style: st.sleeve })]),
      leftArm: part(pivot(5, ay, 0), [jbox(32, 48, -1, -2, -2, aw, 12, 4, 0, { style: st.arm }), jbox(48, 48, -1, -2, -2, aw, 12, 4, 0.25, { style: st.sleeve })]),
      rightLeg: part(pivot(-1.9, 12, 0), [jbox(0, 16, -2, 0, -2, 4, 12, 4, 0, { style: st.leg }), jbox(0, 32, -2, 0, -2, 4, 12, 4, 0.25, { style: st.pants })]),
      leftLeg: part(pivot(1.9, 12, 0), [jbox(16, 48, -2, 0, -2, 4, 12, 4, 0, { style: st.leg }), jbox(0, 48, -2, 0, -2, 4, 12, 4, 0.25, { style: st.pants })]),
    },
  };
}

// HumanoidArmorModel: the humanoid mesh on a 64x32 armor texture, every box inflated by 1 (the outer
// layer: helmet, chestplate, boots) or 0.5 (the inner layer: leggings). The left limbs reuse the
// right ones' texture, mirrored. Which parts show depends on the piece (see ARMOR_PARTS).
export function armorModel(inner, st = {}) {
  const k = inner ? 0.5 : 1, part = (pv, boxes) => ({ pivot: pv, boxes });
  return {
    java: true, tex: [64, 64], anim: 'biped', eye: 0,
    parts: {
      head: part(pivot(0, 0, 0), [jbox(0, 0, -4, -8, -4, 8, 8, 8, k, { style: st.head }), jbox(32, 0, -4, -8, -4, 8, 8, 8, k + 0.5, { style: st.hat })]),
      body: part(pivot(0, 0, 0), [jbox(16, 16, -4, 0, -2, 8, 12, 4, k, { style: st.body })]),
      rightArm: part(pivot(-5, 2, 0), [jbox(40, 16, -3, -2, -2, 4, 12, 4, k, { style: st.arm })]),
      leftArm: part(pivot(5, 2, 0), [jbox(40, 16, -1, -2, -2, 4, 12, 4, k, { mirror: true })]),
      rightLeg: part(pivot(-1.9, 12, 0), [jbox(0, 16, -2, 0, -2, 4, 12, 4, k, { style: st.leg })]),
      leftLeg: part(pivot(1.9, 12, 0), [jbox(0, 16, -2, 0, -2, 4, 12, 4, k, { mirror: true })]),
    },
  };
}
// The humanoid mobs' meshes (64x64 layers; 64x32 textures use the top half), `texture` naming the
// pack image (assets/minecraft/textures/<texture>.png) that replaces the painted skin:
//   'zombie'   ZombieModel (zombies, husks): the left limbs mirror the right ones' pixels.
//   'drowned'  DrownedModel: its own left arm and leg.
//   'skeleton' SkeletonModel: 2-px limbs, the legs 2 px out from the middle.
//   'outer'    HumanoidModel with every box `inflate` out (the stray's clothes, the drowned's outer layer).
// `arms` picks the arm animation (see humanoidPose).
export function mobHumanoid(kind, st = {}, { inflate = 0, texture = null, arms = 'zombie' } = {}) {
  const k = inflate, part = (pv, boxes) => ({ pivot: pv, boxes });
  const thin = kind === 'skeleton', own = kind === 'drowned';
  const legX = thin ? 2 : 1.9;
  const arm = (right) => thin ? jbox(40, 16, -1, -2, -1, 2, 12, 2, k, right ? { style: st.arm } : { mirror: true })
    : right ? jbox(40, 16, -3, -2, -2, 4, 12, 4, k, { style: st.arm })
      : own ? jbox(32, 48, -1, -2, -2, 4, 12, 4, k, { style: st.arm }) : jbox(40, 16, -1, -2, -2, 4, 12, 4, k, { mirror: true });
  const leg = (right) => thin ? jbox(0, 16, -1, 0, -1, 2, 12, 2, k, right ? { style: st.leg } : { mirror: true })
    : right ? jbox(0, 16, -2, 0, -2, 4, 12, 4, k, { style: st.leg })
      : own ? jbox(16, 48, -2, 0, -2, 4, 12, 4, k, { style: st.leg }) : jbox(0, 16, -2, 0, -2, 4, 12, 4, k, { mirror: true });
  return {
    java: true, tex: [64, 64], anim: 'jhumanoid', arms, legX, texture, eye: 24 + 8 * 0.55,
    parts: {
      head: part(pivot(0, 0, 0), [jbox(0, 0, -4, -8, -4, 8, 8, 8, k, { style: st.head }), jbox(32, 0, -4, -8, -4, 8, 8, 8, k + 0.5, { style: st.hat })]),
      body: part(pivot(0, 0, 0), [jbox(16, 16, -4, 0, -2, 8, 12, 4, k, { style: st.body })]),
      rightArm: part(pivot(-5, 2, 0), [arm(true)]), leftArm: part(pivot(5, 2, 0), [arm(false)]),
      rightLeg: part(pivot(-legX, 12, 0), [leg(true)]), leftLeg: part(pivot(legX, 12, 0), [leg(false)]),
    },
  };
}

// HumanoidArmorLayer.setPartVisibility: the parts each piece shows (by slot: head, chest, legs, feet).
export const ARMOR_PARTS = [['head'], ['body', 'rightArm', 'leftArm'], ['body', 'rightLeg', 'leftLeg'], ['rightLeg', 'leftLeg']];
const ALL_PARTS = ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'];
export const armorHide = slot => Object.fromEntries(ALL_PARTS.filter(p => !ARMOR_PARTS[slot].includes(p)).map(p => [p, true]));

// ---------------- poses (HumanoidModel.setupAnim, PlayerModel) ----------------
// st: { limbSwing, limbAmt (0-1), age (ticks), headPitch (radians, + is down, Java's), headYaw,
//   attack (0-1), attackLeft, crouching, riding, rightPose, leftPose, using ('right'|'left'|null),
//   fallFlying (ticks), vel (blocks a tick, for the elytra), swim (0-1), xbowCharge (0-1) }
// Arm poses: 'empty' 'item' 'block' 'bow' 'spear' 'xbow_charge' 'xbow_hold' 'spyglass' 'brush'.
// Returns { poses, pivots } in our model space for drawModel (and for armor, which copies them).
const PI = Math.PI;
const lerp = (t, a, b) => a + (b - a) * t;
const wrap = a => { a %= 2 * PI; if (a >= PI) a -= 2 * PI; if (a < -PI) a += 2 * PI; return a; };
const rotlerp = (t, a, b) => a + t * wrap(b - a);
const quadArm = f => -65 * f + f * f;

export function humanoidPose(st) {
  const part = (x, y, z) => ({ x, y, z, rx: 0, ry: 0, rz: 0 });
  const legX = st.legX ?? 1.9;
  const head = part(0, 0, 0), body = part(0, 0, 0), rightArm = part(-5, 2, 0), leftArm = part(5, 2, 0), rightLeg = part(-legX, 12, 0), leftLeg = part(legX, 12, 0);
  const limb = st.limbSwing || 0, amt = st.limbAmt || 0, age = st.age || 0, attack = st.attack || 0, swim = st.swim || 0;
  const flying = (st.fallFlying || 0) > 4;
  head.ry = st.headYaw || 0;
  if (flying) head.rx = -PI / 4;
  else if (swim > 0) head.rx = rotlerp(swim, st.headPitch || 0, -PI / 4);
  else head.rx = st.headPitch || 0;
  // Gliding fast swings the limbs less.
  let f = 1;
  if (flying && st.vel) { f = (st.vel[0] ** 2 + st.vel[1] ** 2 + st.vel[2] ** 2) / 0.2; f = f * f * f; }
  if (f < 1) f = 1;
  rightArm.rx = Math.cos(limb * 0.6662 + PI) * 2 * amt * 0.5 / f;
  leftArm.rx = Math.cos(limb * 0.6662) * 2 * amt * 0.5 / f;
  rightLeg.rx = Math.cos(limb * 0.6662) * 1.4 * amt / f;
  leftLeg.rx = Math.cos(limb * 0.6662 + PI) * 1.4 * amt / f;
  rightLeg.ry = 0.005; leftLeg.ry = -0.005; rightLeg.rz = 0.005; leftLeg.rz = -0.005;
  if (st.riding) {
    rightArm.rx += -PI / 5; leftArm.rx += -PI / 5;
    rightLeg.rx = -1.4137167; rightLeg.ry = PI / 10; rightLeg.rz = 0.07853982;
    leftLeg.rx = -1.4137167; leftLeg.ry = -PI / 10; leftLeg.rz = -0.07853982;
  }
  const rp = st.rightPose || 'empty', lp = st.leftPose || 'empty';
  const poseRight = () => {
    switch (rp) {
      case 'block': rightArm.rx = rightArm.rx * 0.5 - 0.9424779; rightArm.ry = -PI / 6; break;
      case 'item': rightArm.rx = rightArm.rx * 0.5 - PI / 10; rightArm.ry = 0; break;
      case 'spear': rightArm.rx = rightArm.rx * 0.5 - PI; rightArm.ry = 0; break;
      case 'bow': rightArm.ry = -0.1 + head.ry; leftArm.ry = 0.1 + head.ry + 0.4; rightArm.rx = -PI / 2 + head.rx; leftArm.rx = -PI / 2 + head.rx; break;
      case 'xbow_charge': xbowCharge(rightArm, leftArm, st.xbowCharge || 0, true); break;
      case 'xbow_hold': xbowHold(rightArm, leftArm, head, true); break;
      case 'brush': rightArm.rx = rightArm.rx * 0.5 - PI / 5; rightArm.ry = 0; break;
      case 'spyglass': rightArm.rx = Math.max(-2.4, Math.min(3.3, head.rx - 1.9198622 - (st.crouching ? 0.2617994 : 0))); rightArm.ry = head.ry - 0.2617994; break;
      default: rightArm.ry = 0;
    }
  };
  const poseLeft = () => {
    switch (lp) {
      case 'block': leftArm.rx = leftArm.rx * 0.5 - 0.9424779; leftArm.ry = PI / 6; break;
      case 'item': leftArm.rx = leftArm.rx * 0.5 - PI / 10; leftArm.ry = 0; break;
      case 'spear': leftArm.rx = leftArm.rx * 0.5 - PI; leftArm.ry = 0; break;
      case 'bow': rightArm.ry = -0.1 + head.ry - 0.4; leftArm.ry = 0.1 + head.ry; rightArm.rx = -PI / 2 + head.rx; leftArm.rx = -PI / 2 + head.rx; break;
      case 'xbow_charge': xbowCharge(rightArm, leftArm, st.xbowCharge || 0, false); break;
      case 'xbow_hold': xbowHold(rightArm, leftArm, head, false); break;
      case 'brush': leftArm.rx = leftArm.rx * 0.5 - PI / 5; leftArm.ry = 0; break;
      case 'spyglass': leftArm.rx = Math.max(-2.4, Math.min(3.3, head.rx - 1.9198622 - (st.crouching ? 0.2617994 : 0))); leftArm.ry = head.ry + 0.2617994; break;
      default: leftArm.ry = 0;
    }
  };
  // The arm using an item poses alone; otherwise a two-handed pose in the off hand goes first.
  const twoHanded = p => p === 'bow' || p === 'xbow_charge' || p === 'xbow_hold';
  if (st.using === 'right') poseRight();
  else if (st.using === 'left') poseLeft();
  else if (twoHanded(lp)) { poseLeft(); poseRight(); }
  else { poseRight(); poseLeft(); }
  // setupAttackAnimation: the body turns into the swing and the arm comes down across it.
  if (attack > 0) {
    const arm = st.attackLeft ? leftArm : rightArm;
    body.ry = Math.sin(Math.sqrt(attack) * PI * 2) * 0.2 * (st.attackLeft ? -1 : 1);
    rightArm.z = Math.sin(body.ry) * 5; rightArm.x = -Math.cos(body.ry) * 5;
    leftArm.z = -Math.sin(body.ry) * 5; leftArm.x = Math.cos(body.ry) * 5;
    rightArm.ry += body.ry; leftArm.ry += body.ry; leftArm.rx += body.ry;
    let g = 1 - attack; g *= g; g *= g; g = 1 - g;
    const f1 = Math.sin(g * PI), f2 = Math.sin(attack * PI) * -(head.rx - 0.7) * 0.75;
    arm.rx -= f1 * 1.2 + f2;
    arm.ry += body.ry * 2;
    arm.rz += Math.sin(attack * PI) * -0.4;
  }
  if (st.crouching) {
    body.rx = 0.5; rightArm.rx += 0.4; leftArm.rx += 0.4;
    rightLeg.z = leftLeg.z = 4; rightLeg.y = leftLeg.y = 12.2;
    head.y = 4.2; body.y = 3.2; leftArm.y = rightArm.y = 5.2;
  } else { rightLeg.z = leftLeg.z = 0.1; } // (and every part back at its rest height, slim arms included)
  // AnimationUtils.bobModelPart: the idle sway of the arms.
  if (rp !== 'spyglass') { rightArm.rz += Math.cos(age * 0.09) * 0.05 + 0.05; rightArm.rx += Math.sin(age * 0.067) * 0.05; }
  if (lp !== 'spyglass') { leftArm.rz -= Math.cos(age * 0.09) * 0.05 + 0.05; leftArm.rx -= Math.sin(age * 0.067) * 0.05; }
  // The mobs' own arms, after the humanoid pose (AbstractZombieModel, SkeletonModel, DrownedModel).
  if (st.arms === 'zombie' || st.arms === 'drowned') {
    // AnimationUtils.animateZombieArms: held out in front, higher when hunting, chopping as they hit.
    const f = Math.sin(attack * PI), g = Math.sin((1 - (1 - attack) * (1 - attack)) * PI);
    rightArm.rz = 0; leftArm.rz = 0;
    rightArm.ry = -(0.1 - f * 0.6); leftArm.ry = 0.1 - f * 0.6;
    const out = -PI / (st.aggressive ? 1.5 : 2.25);
    rightArm.rx = out + f * 1.2 - g * 0.4; leftArm.rx = out + f * 1.2 - g * 0.4;
    bobArms(rightArm, leftArm, age);
    if (st.arms === 'drowned') {
      if (rp === 'spear') { rightArm.rx = rightArm.rx * 0.5 - PI; rightArm.ry = 0; }
      if (lp === 'spear') { leftArm.rx = leftArm.rx * 0.5 - PI; leftArm.ry = 0; }
    }
  } else if (st.arms === 'skeleton' && st.aggressive && rp !== 'bow') {
    // SkeletonModel: a skeleton fighting without a bow reaches out with both arms.
    const f = Math.sin(attack * PI), g = Math.sin((1 - (1 - attack) * (1 - attack)) * PI);
    rightArm.rz = 0; leftArm.rz = 0;
    rightArm.ry = -(0.1 - f * 0.6); leftArm.ry = 0.1 - f * 0.6;
    rightArm.rx = -PI / 2 - (f * 1.2 - g * 0.4); leftArm.rx = -PI / 2 - (f * 1.2 - g * 0.4);
    bobArms(rightArm, leftArm, age);
  }
  // Swimming and crawling: the front crawl stroke and a flutter kick.
  if (swim > 0) {
    const s = limb % 26, fr = st.attack > 0 && !st.attackLeft ? 0 : swim, fl = st.attack > 0 && st.attackLeft ? 0 : swim;
    if (!st.using) {
      if (s < 14) {
        leftArm.rx = rotlerp(fl, leftArm.rx, 0); rightArm.rx = lerp(fr, rightArm.rx, 0);
        leftArm.ry = rotlerp(fl, leftArm.ry, PI); rightArm.ry = lerp(fr, rightArm.ry, PI);
        leftArm.rz = rotlerp(fl, leftArm.rz, PI + 1.8707964 * quadArm(s) / quadArm(14)); rightArm.rz = lerp(fr, rightArm.rz, PI - 1.8707964 * quadArm(s) / quadArm(14));
      } else if (s < 22) {
        const t = (s - 14) / 8;
        leftArm.rx = rotlerp(fl, leftArm.rx, PI / 2 * t); rightArm.rx = lerp(fr, rightArm.rx, PI / 2 * t);
        leftArm.ry = rotlerp(fl, leftArm.ry, PI); rightArm.ry = lerp(fr, rightArm.ry, PI);
        leftArm.rz = rotlerp(fl, leftArm.rz, 5.012389 - 1.8707964 * t); rightArm.rz = lerp(fr, rightArm.rz, 1.2707963 + 1.8707964 * t);
      } else {
        const t = (s - 22) / 4;
        leftArm.rx = rotlerp(fl, leftArm.rx, PI / 2 - PI / 2 * t); rightArm.rx = lerp(fr, rightArm.rx, PI / 2 - PI / 2 * t);
        leftArm.ry = rotlerp(fl, leftArm.ry, PI); rightArm.ry = lerp(fr, rightArm.ry, PI);
        leftArm.rz = rotlerp(fl, leftArm.rz, PI); rightArm.rz = lerp(fr, rightArm.rz, PI);
      }
    }
    leftLeg.rx = lerp(swim, leftLeg.rx, 0.3 * Math.cos(limb * 0.33333334 + PI));
    rightLeg.rx = lerp(swim, rightLeg.rx, 0.3 * Math.cos(limb * 0.33333334));
  }
  // Into our model space (see the top of this file).
  const parts = { head, body, rightArm, leftArm, rightLeg, leftLeg }, poses = {}, pivots = {};
  for (const [k, p] of Object.entries(parts)) { poses[k] = [-p.rx, -p.ry, p.rz]; pivots[k] = pivot(p.x, p.y, p.z); }
  return { poses, pivots };
}

// AnimationUtils.bobArms.
function bobArms(rightArm, leftArm, age) {
  rightArm.rz += Math.cos(age * 0.09) * 0.05 + 0.05; leftArm.rz -= Math.cos(age * 0.09) * 0.05 + 0.05;
  rightArm.rx += Math.sin(age * 0.067) * 0.05; leftArm.rx -= Math.sin(age * 0.067) * 0.05;
}
// AnimationUtils.animateCrossbowCharge / animateCrossbowHold.
function xbowCharge(rightArm, leftArm, f, right) {
  const main = right ? rightArm : leftArm, off = right ? leftArm : rightArm;
  main.ry = right ? -0.8 : 0.8; main.rx = -0.97079635; off.rx = main.rx;
  off.ry = lerp(f, 0.4, 0.85) * (right ? 1 : -1);
  off.rx = lerp(f, off.rx, -PI / 2);
}
function xbowHold(rightArm, leftArm, head, right) {
  const main = right ? rightArm : leftArm, off = right ? leftArm : rightArm;
  main.ry = (right ? -0.3 : 0.3) + head.ry; off.ry = (right ? 0.6 : -0.6) + head.ry;
  main.rx = -PI / 2 + head.rx + 0.1; off.rx = -1.5 + head.rx;
}

// ---------------- skins ----------------
// HttpTexture.processLegacySkin: a 64x32 (pre-1.8) skin becomes 64x64, its left arm and leg copied
// from the right ones, mirrored; then the first layer is made opaque (as Java does for every skin),
// and an old skin's hat is cleared if it is entirely opaque (the "Notch transparency" fix).
export function processSkin(src, w, h) {
  if (w !== 64 || (h !== 64 && h !== 32)) throw new Error('A skin must be 64x64 (or a classic 64x32) pixels.');
  const out = new Uint8ClampedArray(64 * 64 * 4);
  out.set(src.subarray(0, 64 * h * 4));
  const legacy = h === 32;
  if (legacy) {
    // copyRect(src x, y, w, h, dx, dy, mirror): each face strip of the right limbs moved and flipped.
    const copy = (x, y, dx, dy, cw, ch) => {
      for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
        const s = ((y + j) * 64 + x + i) * 4, d = ((y + dy + j) * 64 + x + dx + (cw - 1 - i)) * 4;
        for (let c = 0; c < 4; c++) out[d + c] = out[s + c];
      }
    };
    for (const [x, y, dx, dy, cw, ch] of [
      [4, 16, 16, 32, 4, 4], [8, 16, 16, 32, 4, 4], [0, 20, 24, 32, 4, 12], [4, 20, 16, 32, 4, 12], [8, 20, 8, 32, 4, 12], [12, 20, 16, 32, 4, 12],
      [44, 16, -8, 32, 4, 4], [48, 16, -8, 32, 4, 4], [40, 20, 0, 32, 4, 12], [44, 20, -8, 32, 4, 12], [48, 20, -16, 32, 4, 12], [52, 20, -8, 32, 4, 12],
    ]) copy(x, y, dx, dy, cw, ch);
  }
  const opaque = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out[(y * 64 + x) * 4 + 3] = 255; };
  opaque(0, 0, 32, 16);
  if (legacy) {
    // doNotchTransparencyHack: a hat with no transparent pixel at all is cleared.
    let any = false;
    for (let y = 0; y < 32 && !any; y++) for (let x = 32; x < 64; x++) if (out[(y * 64 + x) * 4 + 3] < 128) { any = true; break; }
    if (!any) for (let y = 0; y < 32; y++) for (let x = 32; x < 64; x++) out[(y * 64 + x) * 4 + 3] = 0;
  }
  opaque(0, 16, 64, 32); opaque(16, 48, 48, 64);
  return out;
}

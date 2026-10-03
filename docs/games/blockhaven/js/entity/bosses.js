// Java Edition's boss models: WitherBossModel, and the ender dragon's DragonModel, which
// EnderDragonRenderer draws from a history of the dragon's heading and height (EnderDragon's
// latency positions): five neck pieces and twelve tail pieces laid end to end along it, the body
// rolling into turns, the wings beating. Coordinates as in entity/animals.js.
import { jbox, pivot } from './humanoid.js?v=musxdph0';
import { P, child, rot, model, toOurs, R } from './animals.js?v=musxdph0';

const PI = Math.PI, D2R = PI / 180;
const wrapDeg = a => { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a; };

// WitherBossModel (drawn at twice its size): shoulders, ribcage and tail, three heads.
export function witherModel(st, texture = 'entity/wither/wither') {
  const bone = st.body;
  return model('jwither', {
    shoulders: P(pivot(0, 0, 0), [jbox(0, 16, -10, 3.9, -0.5, 20, 3, 3, 0, { style: bone })]),
    ribcage: P(pivot(-2, 6.9, -0.5), [jbox(0, 22, 0, 0, 0, 3, 10, 3, 0, { style: bone }), jbox(24, 22, -4, 1.5, 0.5, 11, 2, 2, 0, { style: bone }),
      jbox(24, 22, -4, 4, 0.5, 11, 2, 2, 0, { style: bone }), jbox(24, 22, -4, 6.5, 0.5, 11, 2, 2, 0, { style: bone })], { rot: rot(0.20420352, 0, 0) }),
    tail: P(pivot(-2, 6.9 + Math.cos(0.20420352) * 10, -0.5 + Math.sin(0.20420352) * 10), [jbox(12, 22, 0, 0, 0, 3, 6, 3, 0, { style: bone })], { rot: rot(0.83252203, 0, 0) }),
    centerHead: P(pivot(0, 0, 0), [jbox(0, 0, -4, -4, -4, 8, 8, 8, 0, { style: st.head })]),
    rightHead: P(pivot(-8, 4, 0), [jbox(32, 0, -4, -4, -4, 6, 6, 6, 0, { style: st.sideHead || st.head })]),
    leftHead: P(pivot(10, 4, 0), [jbox(32, 0, -4, -4, -4, 6, 6, 6, 0, { style: st.sideHead || st.head })]),
  }, [64, 64], texture);
}

// WitherBossModel.setupAnim / prepareMobModel: it breathes (the ribcage rocking and the tail
// swinging with it), the middle head looks, the side heads look their own ways.
export function witherPose(model, st) {
  const c = Math.cos((st.age || 0) * 0.1), rib = (0.065 + 0.05 * c) * PI;
  const [lh, rh] = st.sideHeads || [[0, 0], [0, 0]];
  return toOurs({
    ribcage: R(rib), tail: { x: -2, y: 6.9 + Math.cos(rib) * 10, z: -0.5 + Math.sin(rib) * 10, ...R((0.265 + 0.1 * c) * PI) },
    centerHead: R(st.headPitch || 0, st.headYaw || 0), leftHead: R(lh[0], lh[1]), rightHead: R(rh[0], rh[1]),
  }, model);
}

// DragonModel (256x256). `frame` carries the whole model's bob; `bodyFrame` rolls the body, wings and
// legs into turns; the neck and tail pieces are placed by dragonPose.
export function dragonModel(st, texture = ['entity/enderdragon/dragon', 'entity/enderdragon/dragon_eyes']) {
  const sc = st.body, wing = st.wing || sc, mem = st.membrane || sc;
  const neck = () => [jbox(192, 104, -5, -5, -5, 10, 10, 10, 0, { style: sc }), jbox(48, 0, -1, -9, -3, 2, 4, 6, 0, { style: st.spine || sc })];
  const M = { mirror: true };
  const parts = {
    frame: P(pivot(0, -32, -48), []),
    head: P(child(0, 20, -62), [jbox(176, 44, -6, -1, -24, 12, 5, 16, 0, { style: st.snout || st.head }), jbox(112, 30, -8, -8, -10, 16, 16, 16, 0, { style: st.head }),
      jbox(0, 0, -5, -12, -4, 2, 4, 6, 0, { style: st.spine || sc, ...M }), jbox(112, 0, -5, -3, -22, 2, 2, 4, 0, { style: st.spine || sc, ...M }),
      jbox(0, 0, 3, -12, -4, 2, 4, 6, 0, { style: st.spine || sc, ...M }), jbox(112, 0, 3, -3, -22, 2, 2, 4, 0, { style: st.spine || sc, ...M })], { parent: 'frame' }),
    jaw: P(child(0, 4, -8), [jbox(176, 65, -6, 0, -16, 12, 4, 16, 0, { style: st.jaw || st.head })], { parent: 'head' }),
    bodyFrame: P(child(0, 16, 0), [], { parent: 'frame' }),
    body: P(child(0, 4 - 16, 8), [jbox(0, 0, -12, 0, -16, 24, 24, 64, 0, { style: sc }), jbox(220, 53, -1, -6, -10, 2, 6, 12, 0, { style: st.spine || sc }),
      jbox(220, 53, -1, -6, 10, 2, 6, 12, 0, { style: st.spine || sc }), jbox(220, 53, -1, -6, 30, 2, 6, 12, 0, { style: st.spine || sc })], { parent: 'bodyFrame' }),
    leftWing: P(child(12, 5 - 16, 2), [jbox(112, 88, 0, -4, -4, 56, 8, 8, 0, { style: wing, ...M }), jbox(-56, 88, 0, 0, 2, 56, 0, 56, 0, { style: mem, ...M })], { parent: 'bodyFrame' }),
    leftWingTip: P(child(56, 0, 0), [jbox(112, 136, 0, -2, -2, 56, 4, 4, 0, { style: wing, ...M }), jbox(-56, 144, 0, 0, 2, 56, 0, 56, 0, { style: mem, ...M })], { parent: 'leftWing' }),
    rightWing: P(child(-12, 5 - 16, 2), [jbox(112, 88, -56, -4, -4, 56, 8, 8, 0, { style: wing }), jbox(-56, 88, -56, 0, 2, 56, 0, 56, 0, { style: mem })], { parent: 'bodyFrame' }),
    rightWingTip: P(child(-56, 0, 0), [jbox(112, 136, -56, -2, -2, 56, 4, 4, 0, { style: wing }), jbox(-56, 144, -56, 0, 2, 56, 0, 56, 0, { style: mem })], { parent: 'rightWing' }),
  };
  for (const [side, x] of [['left', 1], ['right', -1]]) {
    parts[`${side}FrontLeg`] = P(child(12 * x, 20 - 16, 2), [jbox(112, 104, -4, -4, -4, 8, 24, 8, 0, { style: st.leg || sc })], { parent: 'bodyFrame' });
    parts[`${side}FrontLegTip`] = P(child(0, 20, -1), [jbox(226, 138, -3, -1, -3, 6, 24, 6, 0, { style: st.leg || sc })], { parent: `${side}FrontLeg` });
    parts[`${side}FrontFoot`] = P(child(0, 23, 0), [jbox(144, 104, -4, 0, -12, 8, 4, 16, 0, { style: st.foot || sc })], { parent: `${side}FrontLegTip` });
    parts[`${side}HindLeg`] = P(child(16 * x, 16 - 16, 42), [jbox(0, 0, -8, -4, -8, 16, 32, 16, 0, { style: st.leg || sc })], { parent: 'bodyFrame' });
    parts[`${side}HindLegTip`] = P(child(0, 32, -4), [jbox(196, 0, -6, -2, 0, 12, 32, 12, 0, { style: st.leg || sc })], { parent: `${side}HindLeg` });
    parts[`${side}HindFoot`] = P(child(0, 31, 4), [jbox(112, 0, -9, 0, -20, 18, 6, 24, 0, { style: st.foot || sc })], { parent: `${side}HindLegTip` });
  }
  for (let i = 0; i < 5; i++) parts[`neck${i}`] = P(child(0, 20, -12 - i * 10), neck(), { parent: 'frame' });
  for (let i = 0; i < 12; i++) parts[`tail${i}`] = P(child(0, 10, 60 + i * 10), neck(), { parent: 'frame' });
  return model('jdragon', parts, [256, 256], texture);
}

// The dragon's latency history (EnderDragon.positions): 64 ticks of [heading, height], newest first
// at index 0. Heading in Java's degrees (the dragon's yRot).
export function dragonHistory(m, yawDeg, y) {
  if (!m.dragonPos) m.dragonPos = Array.from({ length: 64 }, () => [yawDeg, y]);
  m.dragonPos.unshift([yawDeg, y]); m.dragonPos.length = 64;
}
const lat = (m, i) => m.dragonPos[Math.min(63, i)];

// EnderDragonRenderer.render and DragonModel.renderToBuffer. st: { flap (EnderDragon.flapTime),
// perch (0 flying .. 1 sitting), history (dragonHistory's owner) }. Returns the poses and the
// renderer's own turn of the whole dragon: { poses, pivots, pitch (radians about x) }.
export function dragonPose(model, st) {
  const h = st.history, f = st.flap || 0, perch = st.perch || 0, p = {};
  // EnderDragon.getHeadPartYOffset: sitting, the neck bows piece by piece; flying, it follows the climb.
  const yOff = (i, a, b) => perch * i + (1 - perch) * (i === 6 ? 0 : b[1] - a[1]);
  p.head = R(); p.jaw = R((Math.sin(f * 2 * PI) + 1) * 0.2);
  let bob = Math.sin(f * 2 * PI - 1) + 1;
  bob = (bob * bob + bob * 2) * 0.05;
  p.frame = { x: 0, y: (bob - 2) * 16, z: -48, ...R(bob * 2 * D2R) };
  const a6 = lat(h, 6), turn = wrapDeg(lat(h, 5)[0] - lat(h, 10)[0]), mid = wrapDeg(lat(h, 5)[0] + turn / 2), ft = f * 2 * PI;
  let x = 0, y = 20, z = -12;
  for (let i = 0; i < 5; i++) {
    const b = lat(h, 5 - i), n = { x, y, z, rx: Math.cos(i * 0.45 + ft) * 0.15 + yOff(i, a6, b) * D2R * 1.5 * 5, ry: wrapDeg(b[0] - a6[0]) * D2R * 1.5, rz: -wrapDeg(b[0] - mid) * D2R * 1.5 };
    p[`neck${i}`] = n;
    y += Math.sin(n.rx) * 10; z -= Math.cos(n.ry) * Math.cos(n.rx) * 10; x -= Math.sin(n.ry) * Math.cos(n.rx) * 10;
  }
  const b0 = lat(h, 0);
  p.head = { x, y, z, rx: wrapDeg(yOff(6, a6, b0)) * D2R * 1.5 * 5, ry: wrapDeg(b0[0] - a6[0]) * D2R, rz: -wrapDeg(b0[0] - mid) * D2R };
  p.bodyFrame = { x: 0, y: 16, z: 0, ...R(0, 0, -turn * 1.5 * D2R) };
  const w = f * 2 * PI;
  p.leftWing = R(0.125 - Math.cos(w) * 0.2, -0.25, -(Math.sin(w) + 0.125) * 0.8);
  p.leftWingTip = R(0, 0, (Math.sin(w + 2) + 0.5) * 0.75);
  p.rightWing = R(p.leftWing.rx, -p.leftWing.ry, -p.leftWing.rz);
  p.rightWingTip = R(0, 0, -p.leftWingTip.rz);
  for (const s of ['left', 'right']) {
    p[`${s}HindLeg`] = R(1 + bob * 0.1); p[`${s}HindLegTip`] = R(0.5 + bob * 0.1); p[`${s}HindFoot`] = R(0.75 + bob * 0.1);
    p[`${s}FrontLeg`] = R(1.3 + bob * 0.1); p[`${s}FrontLegTip`] = R(-0.5 - bob * 0.1); p[`${s}FrontFoot`] = R(0.75 + bob * 0.1);
  }
  const a11 = lat(h, 11);
  let tx = 0, ty = 10, tz = 60, sway = 0;
  for (let k = 0; k < 12; k++) {
    const b = lat(h, 12 + k);
    sway += Math.sin(k * 0.45 + ft) * 0.05;
    const n = { x: tx, y: ty, z: tz, rx: sway + (b[1] - a11[1]) * D2R * 1.5 * 5, ry: (wrapDeg(b[0] - a11[0]) * 1.5 + 180) * D2R, rz: wrapDeg(b[0] - mid) * D2R * 1.5 };
    p[`tail${k}`] = n;
    ty += Math.sin(n.rx) * 10; tz -= Math.cos(n.ry) * Math.cos(n.rx) * 10; tx -= Math.sin(n.ry) * Math.cos(n.rx) * 10;
  }
  const out = toOurs(p, model);
  // EnderDragonRenderer.render: pitched by its climb over the last few ticks.
  out.pitch = (lat(h, 5)[1] - lat(h, 10)[1]) * 10 * D2R;
  out.heading = lat(h, 7)[0];
  return out;
}

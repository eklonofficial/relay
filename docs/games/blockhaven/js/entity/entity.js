// Entity base class, manager and the box-model renderer shared by every mob.
import { moveEntity } from './physics.js?v=musmwq7w';
import { B } from '../data/blocks.js?v=musmwq7w';
import { fluidPush } from '../game/fluid.js?v=musmwq7w';
import { ENTITY, texFactor } from '../render/mobtex.js?v=musmwq7w';

let nextId = 1;
export class Entity {
  constructor(game, type, x, y, z) {
    this.id = nextId++;
    this.game = game;
    this.type = type;
    this.pos = [x, y, z];
    this.prev = [x, y, z];
    this.vel = [0, 0, 0];
    this.yaw = 0; this.pitch = 0;
    this.hw = 0.25; this.h = 0.5;
    this.onGround = false; this.dead = false; this.age = 0;
    this.stepHeight = 0;
    this.fire = 0; this.inWater = false; this.inLava = false;
    this.gravity = 28; this.drag = 0.02;
    this.persistent = false;
  }
  get world() { return this.game.world; }
  physics(dt, { gravity = this.gravity, airDrag = this.drag, groundFriction = 0.6 } = {}) {
    this.prev[0] = this.pos[0]; this.prev[1] = this.pos[1]; this.prev[2] = this.pos[2];
    const w = this.world;
    const feet = w.getBlock(this.pos[0], this.pos[1] + 0.05, this.pos[2]), mid = w.getBlock(this.pos[0], this.pos[1] + this.h * 0.6, this.pos[2]);
    this.inWater = feet === B.WATER || mid === B.WATER;
    this.inLava = feet === B.LAVA || mid === B.LAVA;
    if (this.inWater || this.inLava) {
      // Currents carry mobs too (Entity.updateFluidHeightAndDoFluidPushing, normalised for
      // non-players); scaled so the drift settles at Java's speed under this damping.
      const lava = !this.inWater, m = [0, 0, 0];
      fluidPush(w, [this.pos[0] - this.hw, this.pos[1], this.pos[2] - this.hw, this.pos[0] + this.hw, this.pos[1] + this.h, this.pos[2] + this.hw], m, lava, lava ? (w.dim === 1 ? 0.007 : 0.0023333333333333335) : 0.014, true, true);
      const kp = 20 * (lava ? 4 : 2.2) / (1 - (lava ? 0.5 : 0.8));
      this.vel[0] += m[0] * kp * dt; this.vel[1] += m[1] * kp * dt; this.vel[2] += m[2] * kp * dt;
      this.vel[1] -= gravity * 0.25 * dt;
      const k = Math.exp(-(this.inLava ? 4 : 2.2) * dt);
      this.vel[0] *= k; this.vel[1] *= k; this.vel[2] *= k;
    } else {
      this.vel[1] -= gravity * dt;
      const k = Math.pow(1 - airDrag, dt * 20);
      this.vel[0] *= k; this.vel[2] *= k; this.vel[1] *= Math.pow(0.98, dt * 20);
    }
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vel[0]), Math.abs(this.vel[1]), Math.abs(this.vel[2])) * dt / 0.45));
    for (let i = 0; i < steps; i++) moveEntity(w, this, this.vel[0] * dt / steps, this.vel[1] * dt / steps, this.vel[2] * dt / steps);
    if (this.onGround) { const f = Math.pow(groundFriction, dt * 20); this.vel[0] *= f; this.vel[2] *= f; }
    if (this.pos[1] < -64) this.dead = true;
  }
  distTo(p) { return Math.hypot(this.pos[0] - p[0], this.pos[1] - p[1], this.pos[2] - p[2]); }
  center() { return [this.pos[0], this.pos[1] + this.h / 2, this.pos[2]]; }
  // Light multiplier from world light at the entity's head.
  brightness() {
    const g = this.game, l = g.world.lightAt(this.pos[0], this.pos[1] + Math.min(this.h, 1.5) * 0.7, this.pos[2]);
    const sky = Math.pow(0.8, 15 - l.sky), blk = Math.pow(0.82, 15 - l.blk);
    const s = g.env.skyLight, a = g.env.ambient;
    return [Math.max(s[0] * sky, blk * 1.12, a[0]), Math.max(s[1] * sky, blk * 0.85, a[1]), Math.max(s[2] * sky, blk * 0.56, a[2])];
  }
  overlaps(o, pad = 0) {
    return Math.abs(this.pos[0] - o.pos[0]) < this.hw + o.hw + pad && Math.abs(this.pos[2] - o.pos[2]) < this.hw + o.hw + pad &&
      this.pos[1] < o.pos[1] + o.h + pad && this.pos[1] + this.h > o.pos[1] - pad;
  }
  update() {}
  render() {}
  toJSON() { return null; }
}

export class EntityManager {
  constructor(game) { this.game = game; this.list = []; this.frame = 0; }
  add(e) { e.lodPhase = (Math.random() * 8) | 0; this.list.push(e); if (e.onAdd) e.onAdd(); return e; }
  update(dt) {
    const g = this.game, p = g.player && g.player.pos;
    this.frame = (this.frame + 1) | 0;
    for (const e of this.list) {
      if (e.dead) continue;
      if (!g.world.isLoaded(e.pos[0], e.pos[2])) { e.frozen = true; continue; }
      e.frozen = false;
      e.age += dt;
      // Distant mobs think less often (their skipped time is carried over), which keeps
      // big villages and mob farms cheap on low-end machines.
      if (p && e.isLiving && !(e.def && e.def.kind === 'boss') && !e.target) {
        const dx = e.pos[0] - p[0], dz = e.pos[2] - p[2], d2 = dx * dx + dz * dz;
        const n = d2 > 9216 ? 8 : d2 > 1600 ? 3 : 1;
        if (n > 1) {
          e.lodAcc = (e.lodAcc || 0) + dt;
          if ((this.frame + e.lodPhase) % n) continue;
          const adt = Math.min(e.lodAcc, 0.1);
          e.lodAcc = 0;
          e.update(adt);
          continue;
        }
      }
      e.update(dt);
    }
    if (this.list.some(e => e.dead)) this.list = this.list.filter(e => { if (e.dead && e.onRemove) e.onRemove(); return !e.dead; });
  }
  near(p, r, filter) {
    const out = [];
    for (const e of this.list) if (!e.dead && Math.abs(e.pos[0] - p[0]) < r && Math.abs(e.pos[2] - p[2]) < r && Math.abs(e.pos[1] - p[1]) < r && (!filter || filter(e))) out.push(e);
    return out;
  }
  count(filter) { let n = 0; for (const e of this.list) if (!e.dead && filter(e)) n++; return n; }
  clear() { this.list = []; }
}

// ---------------- box models ----------------
// A model is { tex: [w, h], java?, parts: { name: { pivot, boxes: [{ o, s, uv, inflate, mirror }], parent } } } in 1/16
// block units; `java` models unwrap their boxes exactly as Java's ModelPart.Cube does (entity/humanoid.js).
// Poses: { name: [rx, ry, rz] }. Matrices are row-major 3x4 arrays.
const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[4] + a[2] * b[8], a[0] * b[1] + a[1] * b[5] + a[2] * b[9], a[0] * b[2] + a[1] * b[6] + a[2] * b[10], a[0] * b[3] + a[1] * b[7] + a[2] * b[11] + a[3],
  a[4] * b[0] + a[5] * b[4] + a[6] * b[8], a[4] * b[1] + a[5] * b[5] + a[6] * b[9], a[4] * b[2] + a[5] * b[6] + a[6] * b[10], a[4] * b[3] + a[5] * b[7] + a[6] * b[11] + a[7],
  a[8] * b[0] + a[9] * b[4] + a[10] * b[8], a[8] * b[1] + a[9] * b[5] + a[10] * b[9], a[8] * b[2] + a[9] * b[6] + a[10] * b[10], a[8] * b[3] + a[9] * b[7] + a[10] * b[11] + a[11],
];
export const M = {
  id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  t: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z],
  s: (x, y = x, z = x) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0],
  rx: a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0]; },
  ry: a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0]; },
  rz: a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]; },
  mul,
  chain: (...ms) => ms.reduce((a, b) => mul(a, b)),
  apply: (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]],
};

// Per-face shading (+X, -X, +Y, -Y, +Z, -Z).
const FACE_SHADE = [0.62, 0.62, 1.0, 0.5, 0.8, 0.8];
const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];

// Emits one box (in part space) into a batch. uv: texture coords of the MC box unwrap in texels.
let SHIFT_U = 0, SHIFT_V = 0;
function emitBox(batch, m, box, layer, tw, th, light, alpha, java = false) {
  const [ox, oy, oz] = box.o, [w, h, d] = box.s, inf = box.inflate || 0;
  const x0 = ox - inf, y0 = oy - inf, z0 = oz - inf, x1 = ox + w + inf, y1 = oy + h + inf, z1 = oz + d + inf;
  const c = (i, x, y, z) => { const r = M.apply(m, x, y, z); P[i][0] = r[0]; P[i][1] = r[1]; P[i][2] = r[2]; };
  c(0, x0, y0, z0); c(1, x1, y0, z0); c(2, x1, y1, z0); c(3, x0, y1, z0);
  c(4, x0, y0, z1); c(5, x1, y0, z1); c(6, x1, y1, z1); c(7, x0, y1, z1);
  const [u, v] = box.uv, W = box.us ? box.us[0] : w, H = box.us ? box.us[1] : h, D = box.us ? box.us[2] : d;
  const U = x => x / tw + SHIFT_U, V = y => y / th + SHIFT_V;
  // MC unwrap: top (u+d, v), bottom (u+d+w, v), right (u, v+d), front (u+d, v+d), left (u+d+w, v+d), back (u+2d+w, v+d).
  // Entities face -Z in model space ("front" = -Z).
  const faces = [
    // +X (left side of the mob seen from the front): verts 5,1,2,6 -> uv left
    [[P[1], P[5], P[6], P[2]], [u + D + W, v + D, u + D + W + D, v + D + H], 0],
    // -X (right side): 0,4,7,3
    [[P[4], P[0], P[3], P[7]], [u, v + D, u + D, v + D + H], 1],
    // +Y top
    [[P[3], P[2], P[6], P[7]], [u + D, v, u + D + W, v + D], 2],
    // -Y bottom
    [[P[0], P[1], P[5], P[4]], [u + D + W, v, u + D + W + W, v + D], 3],
    // +Z back
    [[P[5], P[4], P[7], P[6]], [u + D + W + D, v + D, u + D + W + D + W, v + D + H], 4],
    // -Z front
    [[P[0], P[1], P[2], P[3]], [u + D, v + D, u + D + W, v + D + H], 5],
  ];
  if (java) {
    // Java's ModelPart.Cube, corner by corner (our x and y are Java's flipped): the right strip on
    // the +X side, the bottom flipped, and a mirrored box swapped side for side.
    if (box.mirror) for (const [a, b] of [[0, 1], [3, 2], [4, 5], [7, 6]]) { const t = P[a]; P[a] = P[b]; P[b] = t; }
    const U0 = u, U1 = u + D, U2 = u + D + W, U2w = u + D + W + W, U3 = u + D + W + D, U4 = u + D + W + D + W, V0 = v, V1 = v + D, V2 = v + D + H;
    const J = [
      [[2, U1, V1], [6, U0, V1], [5, U0, V2], [1, U1, V2], 0],
      [[7, U3, V1], [3, U2, V1], [0, U2, V2], [4, U3, V2], 1],
      [[7, U2, V0], [6, U1, V0], [2, U1, V1], [3, U2, V1], 2],
      [[0, U2w, V1], [1, U2, V1], [5, U2, V0], [4, U2w, V0], 3],
      [[6, U4, V1], [7, U3, V1], [4, U3, V2], [5, U4, V2], 4],
      [[3, U2, V1], [2, U1, V1], [1, U1, V2], [0, U2, V2], 5],
    ];
    for (const face of J) {
      const sh = FACE_SHADE[face[4]], col = [light[0] * sh, light[1] * sh, light[2] * sh, alpha];
      batch.quadUV([P[face[0][0]], P[face[1][0]], P[face[2][0]], P[face[3][0]]], [0, 1, 2, 3].map(k => [U(face[k][1]), V(face[k][2])]), layer, col);
    }
    if (box.mirror) for (const [a, b] of [[0, 1], [3, 2], [4, 5], [7, 6]]) { const t = P[a]; P[a] = P[b]; P[b] = t; }
    return;
  }
  for (const [pts, r, f] of faces) {
    let [a0, b0, a1, b1] = r;
    if (box.mirror) { const t = a0; a0 = a1; a1 = t; }
    const sh = FACE_SHADE[f];
    const col = [light[0] * sh, light[1] * sh, light[2] * sh, alpha];
    const uvs = f === 3 ? [[a1, b0], [a0, b0], [a0, b1], [a1, b1]] : [[a1, b1], [a0, b1], [a0, b0], [a1, b0]];
    batch.quadUV(pts, uvs.map(q => [U(q[0]), V(q[1])]), layer, col);
  }
}

// Draws a model: root matrix (world), poses per part, skin layer, light colour, hurt 0..1, alpha.
export function drawModel(batch, model, layer, root, poses, light, hurt = 0, alpha = 1) {
  // Texels are measured against the (square) entity layer, or against the texture itself when it
  // fills the layer (a scrolling energy swirl, shifted by poses.uvShift).
  const tw = model.fill ? model.texSize[0] : ENTITY * texFactor(model), th = model.fill ? model.texSize[1] : tw;
  [SHIFT_U, SHIFT_V] = poses.uvShift || [0, 0];
  const mats = {};
  const partMatrix = name => {
    if (mats[name]) return mats[name];
    const p = model.parts[name];
    const base = p.parent ? partMatrix(p.parent) : root;
    const r = poses[name] || p.rot || null;
    const pv = (poses.pivots && poses.pivots[name]) || p.pivot;
    let m = M.mul(base, M.t(pv[0], pv[1], pv[2]));
    if (r) { if (r[2]) m = M.mul(m, M.rz(r[2])); if (r[1]) m = M.mul(m, M.ry(r[1])); if (r[0]) m = M.mul(m, M.rx(r[0])); }
    if (p.scale) m = M.mul(m, M.s(p.scale));
    mats[name] = m;
    return m;
  };
  const a = hurt > 0 ? 1 + hurt : alpha;
  for (const name of Object.keys(model.parts)) {
    const p = model.parts[name];
    if (p.hidden || (poses.hide && poses.hide[name])) continue;
    const m = partMatrix(name);
    for (const b of p.boxes) {
      if (b.wool && poses.sheared) continue;
      emitBox(batch, m, b, layer, tw, th, b.wool && poses.woolColor ? [light[0] * poses.woolColor[0], light[1] * poses.woolColor[1], light[2] * poses.woolColor[2]] : light, a, !!model.java);
    }
  }
  SHIFT_U = SHIFT_V = 0;
  return mats;
}

// World matrix for a model: feet at pos, facing yaw (model -Z = forward), 1/16 scale.
export function rootMatrix(pos, yaw, scale = 1, extra = null) {
  let m = M.chain(M.t(pos[0], pos[1], pos[2]), M.ry(yaw), M.s(scale / 16));
  if (extra) m = M.mul(m, extra);
  return m;
}

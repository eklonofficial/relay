// Entity base class, manager and the box-model renderer shared by every mob.
import { moveEntity } from './physics.js?v=mut7vbyz';
import { B } from '../data/blocks.js?v=mut7vbyz';
import { fluidPush } from '../game/fluid.js?v=mut7vbyz';
import { ENTITY, texFactor } from '../render/mobtex.js?v=mut7vbyz';

let nextId = 1;
const LIGHT = { sky: 0, blk: 0 };
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
    const g = this.game, l = g.world.lightAt(this.pos[0], this.pos[1] + Math.min(this.h, 1.5) * 0.7, this.pos[2], LIGHT);
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

// Scratch for emitBox: a box's 8 corners, one face's corners, uvs and colour (quadUV copies them).
const PT = [null, null, null, null], UV = [[0, 0], [0, 0], [0, 0], [0, 0]], COL = [0, 0, 0, 0];
const UT = [0, 0, 0, 0, 0, 0], VT = [0, 0, 0];
// Java's ModelPart.Cube per face (+X -X +Y -Y +Z -Z): four corners as [corner, u column, v row],
// columns u, u+d, u+d+w, u+d+2w, u+2d+w, u+2d+2w and rows v, v+d, v+d+h.
const JFACES = [
  [2, 1, 1, 6, 0, 1, 5, 0, 2, 1, 1, 2],
  [7, 4, 1, 3, 2, 1, 0, 2, 2, 4, 4, 2],
  [7, 2, 0, 6, 1, 0, 2, 1, 1, 3, 2, 1],
  [0, 3, 1, 1, 2, 1, 5, 2, 0, 4, 3, 0],
  [6, 5, 1, 7, 4, 1, 4, 4, 2, 5, 5, 2],
  [3, 2, 1, 2, 1, 1, 1, 1, 2, 0, 2, 2],
];
const MIRROR = [1, 0, 3, 2, 5, 4, 7, 6]; // a mirrored box swaps its corners side for side
// The older unwrap: corners per face (entities face -Z in model space, "front" = -Z).
const FACES = [[1, 5, 6, 2], [4, 0, 3, 7], [3, 2, 6, 7], [0, 1, 5, 4], [5, 4, 7, 6], [0, 1, 2, 3]];

// Emits one box (in part space) into a batch. uv: texture coords of the MC box unwrap in texels.
function emitBox(batch, m, box, layer, tw, th, light, alpha, java = false) {
  const o = box.o, sz = box.s, inf = box.inflate || 0;
  const w = sz[0], h = sz[1], d = sz[2];
  const x0 = o[0] - inf, y0 = o[1] - inf, z0 = o[2] - inf, x1 = o[0] + w + inf, y1 = o[1] + h + inf, z1 = o[2] + d + inf;
  for (let i = 0; i < 8; i++) {
    const x = i === 1 || i === 2 || i === 5 || i === 6 ? x1 : x0, y = i === 2 || i === 3 || i === 6 || i === 7 ? y1 : y0, z = i < 4 ? z0 : z1;
    const p = P[i];
    p[0] = m[0] * x + m[1] * y + m[2] * z + m[3]; p[1] = m[4] * x + m[5] * y + m[6] * z + m[7]; p[2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  const u = box.uv[0], v = box.uv[1], W = box.us ? box.us[0] : w, H = box.us ? box.us[1] : h, D = box.us ? box.us[2] : d;
  if (java) {
    // Java's ModelPart.Cube, corner by corner (our x and y are Java's flipped): the right strip on
    // the +X side, the bottom flipped, and a mirrored box swapped side for side.
    UT[0] = u / tw; UT[1] = (u + D) / tw; UT[2] = (u + D + W) / tw; UT[3] = (u + D + W + W) / tw; UT[4] = (u + D + W + D) / tw; UT[5] = (u + D + W + D + W) / tw;
    VT[0] = v / th; VT[1] = (v + D) / th; VT[2] = (v + D + H) / th;
    const mir = box.mirror;
    for (let f = 0; f < 6; f++) {
      const F = JFACES[f], sh = FACE_SHADE[f];
      COL[0] = light[0] * sh; COL[1] = light[1] * sh; COL[2] = light[2] * sh; COL[3] = alpha;
      for (let k = 0; k < 4; k++) {
        PT[k] = P[mir ? MIRROR[F[k * 3]] : F[k * 3]];
        UV[k][0] = UT[F[k * 3 + 1]]; UV[k][1] = VT[F[k * 3 + 2]];
      }
      batch.quadUV(PT, UV, layer, COL);
    }
    return;
  }
  for (let f = 0; f < 6; f++) {
    let a0, b0, a1, b1;
    if (f === 0) { a0 = u + D + W; b0 = v + D; a1 = u + D + W + D; b1 = v + D + H; }
    else if (f === 1) { a0 = u; b0 = v + D; a1 = u + D; b1 = v + D + H; }
    else if (f === 2) { a0 = u + D; b0 = v; a1 = u + D + W; b1 = v + D; }
    else if (f === 3) { a0 = u + D + W; b0 = v; a1 = u + D + W + W; b1 = v + D; }
    else if (f === 4) { a0 = u + D + W + D; b0 = v + D; a1 = u + D + W + D + W; b1 = v + D + H; }
    else { a0 = u + D; b0 = v + D; a1 = u + D + W; b1 = v + D + H; }
    if (box.mirror) { const t = a0; a0 = a1; a1 = t; }
    const sh = FACE_SHADE[f], c = FACES[f];
    COL[0] = light[0] * sh; COL[1] = light[1] * sh; COL[2] = light[2] * sh; COL[3] = alpha;
    for (let k = 0; k < 4; k++) PT[k] = P[c[k]];
    if (f === 3) { UV[0][0] = a1; UV[0][1] = b0; UV[1][0] = a0; UV[1][1] = b0; UV[2][0] = a0; UV[2][1] = b1; UV[3][0] = a1; UV[3][1] = b1; }
    else { UV[0][0] = a1; UV[0][1] = b1; UV[1][0] = a0; UV[1][1] = b1; UV[2][0] = a0; UV[2][1] = b0; UV[3][0] = a1; UV[3][1] = b0; }
    for (let k = 0; k < 4; k++) { UV[k][0] = UV[k][0] / tw; UV[k][1] = UV[k][1] / th; }
    batch.quadUV(PT, UV, layer, COL);
  }
}

// Draws a model: root matrix (world), poses per part, skin layer, light colour, hurt 0..1, alpha.
export function drawModel(batch, model, layer, root, poses, light, hurt = 0, alpha = 1) {
  const tw = ENTITY * texFactor(model), th = tw; // texels are measured against the (square) entity layer
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
  return mats;
}

// World matrix for a model: feet at pos, facing yaw (model -Z = forward), 1/16 scale.
export function rootMatrix(pos, yaw, scale = 1, extra = null) {
  let m = M.chain(M.t(pos[0], pos[1], pos[2]), M.ry(yaw), M.s(scale / 16));
  if (extra) m = M.mul(m, extra);
  return m;
}

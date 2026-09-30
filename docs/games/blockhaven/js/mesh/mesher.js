// Chunk mesher: flood-fill lighting, smooth AO, biome tints and every block shape.
// Runs in workers on a padded volume (chunk + PAD blocks around it, plus a floor and ceiling layer).
import {
  CHUNK, HEIGHT, PAD, PS, B, SHAPE, VF, TINT, TEX,
  OPAQUE, SHAPE_OF, TRANSLUCENT, EMIT, ATTEN, VFLAGS, CULL_SAME, TINT_OF, WATERLOGGED, VARIANT_MASK,
  FACING_SHIFT, AXIS_SHIFT, FACE_TEX, CROP_STAGES, CROP_TEX,
} from '../data/blocks.js';
import { BIOME_COLORS } from '../gen/biomes.js';

export const H2 = HEIGHT + 2;
export const VOLUME_SIZE = PS * PS * H2;
export const STRIDE = 20;          // bytes per vertex
export const POS_SCALE = 32;       // vertex units per block
export const POS_BIAS = 64;        // lets geometry poke slightly outside the chunk

// Faces: +X -X +Y -Y +Z -Z. Corners are counter-clockwise seen from outside.
const FACE_CORNERS = [
  [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
  [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
  [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
];
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const TANGENTS = [[1, 2], [1, 2], [0, 2], [0, 2], [0, 1], [0, 1]];
// Texture coordinates from a position inside the block (in pixels), per face.
const UVF = [
  (x, y, z) => [16 - z, 16 - y], (x, y, z) => [z, 16 - y], (x, y, z) => [x, z],
  (x, y, z) => [x, 16 - z], (x, y, z) => [x, 16 - y], (x, y, z) => [16 - x, 16 - y],
];
// One 90° turn about Y (+Z -> -X -> -Z -> +X) maps faces like this.
const ROT_FACE = [4, 5, 2, 3, 1, 0];
// facing index (0 +Z, 1 -X, 2 -Z, 3 +X) -> face index
export const FACING_FACE = [4, 1, 5, 0];
export const FACING_DIR = [[0, 1], [-1, 0], [0, -1], [1, 0]];

// ---- volume addressing (reconfigured for single-block models) ----
let S = PS, SS = PS * PS, HH = H2;
let FO = [];
function setStride(s, h) {
  S = s; SS = s * s; HH = h;
  FO = NORMALS.map(n => n[0] + n[2] * S + n[1] * SS);
}
setStride(PS, H2);

let vol = null, meta = null, skyL = null, blkL = null, queue = null;
const QMASK = (1 << 21) - 1;

// ---------------- lighting ----------------
const emitOf = i => { const id = vol[i]; return EMIT[(id << 4) | (meta[i] & VARIANT_MASK[id])]; };

function flood(light, head, tail) {
  const q = queue;
  while (head !== tail) {
    const i = q[head]; head = (head + 1) & QMASK;
    const l = light[i];
    if (l <= 1) continue;
    const x = i % S, z = ((i / S) | 0) % S, y = (i / SS) | 0;
    for (let k = 0; k < 6; k++) {
      let n;
      if (k === 0) { if (x === 0) continue; n = i - 1; }
      else if (k === 1) { if (x === S - 1) continue; n = i + 1; }
      else if (k === 2) { if (z === 0) continue; n = i - S; }
      else if (k === 3) { if (z === S - 1) continue; n = i + S; }
      else if (k === 4) { if (y <= 1) continue; n = i - SS; }
      else { if (y >= HH - 1) continue; n = i + SS; }
      const id = vol[n];
      if (OPAQUE[id]) continue;
      const nl = l - 1 - ATTEN[id];
      if (nl > light[n]) { light[n] = nl; q[tail] = n; tail = (tail + 1) & QMASK; }
    }
  }
}

function computeLight(maxY, hasSky) {
  const size = S * S * HH;
  if (!skyL || skyL.length !== size) { skyL = new Uint8Array(size); blkL = new Uint8Array(size); }
  if (!queue) queue = new Int32Array(QMASK + 1);
  skyL.fill(0); blkL.fill(0);
  let tail = 0;
  if (hasSky) {
    skyL.fill(15, (maxY + 1) * SS);
    for (let c = 0; c < SS; c++) {
      let l = 15;
      for (let y = maxY; y >= 1; y--) {
        const i = c + y * SS, id = vol[i];
        if (OPAQUE[id]) l = 0; else if (l > 0) l = Math.max(0, l - ATTEN[id]);
        skyL[i] = l;
      }
    }
    for (let y = 1; y <= maxY + 1 && y < HH; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const i = x + z * S + y * SS, l = skyL[i];
      if (l <= 1) continue;
      if ((x > 0 && skyL[i - 1] < l - 1 && !OPAQUE[vol[i - 1]]) || (x < S - 1 && skyL[i + 1] < l - 1 && !OPAQUE[vol[i + 1]]) ||
          (z > 0 && skyL[i - S] < l - 1 && !OPAQUE[vol[i - S]]) || (z < S - 1 && skyL[i + S] < l - 1 && !OPAQUE[vol[i + S]]) ||
          (y > 1 && skyL[i - SS] < l - 1 && !OPAQUE[vol[i - SS]])) { queue[tail] = i; tail = (tail + 1) & QMASK; }
    }
    flood(skyL, 0, tail);
  }
  tail = 0;
  for (let i = SS; i < (maxY + 1) * SS; i++) {
    if (!vol[i]) continue;
    const e = emitOf(i);
    if (e) { blkL[i] = e; queue[tail] = i; tail = (tail + 1) & QMASK; }
  }
  flood(blkL, 0, tail);
}

// ---------------- vertex output ----------------
class VB {
  constructor(q = 2048) { this.quads = 0; this.grow(q); }
  grow(q) {
    const buf = new ArrayBuffer(q * 4 * STRIDE);
    if (this.u8) new Uint8Array(buf).set(this.u8);
    this.u8 = new Uint8Array(buf); this.u16 = new Uint16Array(buf); this.cap = q;
  }
  result() { return this.u8.buffer.slice(0, this.quads * 4 * STRIDE); }
}

// Staging for one quad; positions in pixels relative to the chunk origin.
const QX = new Float32Array(4), QY = new Float32Array(4), QZ = new Float32Array(4);
const QU = new Uint8Array(4), QV = new Uint8Array(4), QA = new Uint8Array(4), QL = new Uint8Array(4), QB = new Int32Array(4);
let TR = 255, TG = 255, TB = 255;

function emit(buf, layer, normal, flags) {
  if (buf.quads >= buf.cap) buf.grow(buf.cap * 2);
  const rot = QB[0] + QB[2] > QB[1] + QB[3] ? 1 : 0;
  const { u8, u16 } = buf;
  let o = buf.quads * 4 * STRIDE;
  for (let k = 0; k < 4; k++, o += STRIDE) {
    const j = (k + rot) & 3, h = o >> 1;
    u16[h] = Math.round(QX[j] * 2) + POS_BIAS; u16[h + 1] = Math.round(QY[j] * 2) + POS_BIAS; u16[h + 2] = Math.round(QZ[j] * 2) + POS_BIAS; u16[h + 3] = flags;
    u16[h + 4] = layer; u16[h + 5] = QU[j] | (QV[j] << 5) | (normal << 10);
    u8[o + 12] = QA[j]; u8[o + 13] = QL[j]; u8[o + 14] = 0; u8[o + 15] = 0;
    u8[o + 16] = TR; u8[o + 17] = TG; u8[o + 18] = TB; u8[o + 19] = 255;
  }
  buf.quads++;
}

const packL = (s, b) => (Math.min(15, Math.round(s)) << 4) | Math.min(15, Math.round(b));
const cellLight = i => (skyL[i] << 4) | blkL[i];

// ---------------- tints ----------------
let tints = null; // per centre column: grass rgb, foliage rgb, water rgb (blended)
function computeTints(biomes, blendR) {
  tints = new Uint8Array(CHUNK * CHUNK * 9);
  for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
    const acc = new Float32Array(9);
    let n = 0;
    for (let dz = -blendR; dz <= blendR; dz++) for (let dx = -blendR; dx <= blendR; dx++) {
      const b = biomes[(x + PAD + dx) + (z + PAD + dz) * PS];
      for (let k = 0; k < 9; k++) acc[k] += BIOME_COLORS[b * 9 + k];
      n++;
    }
    for (let k = 0; k < 9; k++) tints[(x + z * CHUNK) * 9 + k] = acc[k] / n;
  }
}
let curTintCol = 0;
function setTint(id) {
  const t = TINT_OF[id];
  if (!t || !tints) { TR = TG = TB = 255; return; }
  const o = curTintCol * 9 + (t - 1) * 3;
  TR = tints[o]; TG = tints[o + 1]; TB = tints[o + 2];
}
function setWaterTint() {
  if (!tints) { TR = 63; TG = 118; TB = 228; return; }
  const o = curTintCol * 9 + 6;
  TR = tints[o]; TG = tints[o + 1]; TB = tints[o + 2];
}

// ---------------- geometry helpers ----------------
const texOf = (id, m, face) => FACE_TEX[(((id << 4) | (m & VARIANT_MASK[id])) * 7) + face];

// Axis-aligned box in block pixels. layers: 6 texture layers (-1 = skip face).
// o: { cull, uvFull, uvRot: number[6], shear: [sx, sz] per pixel of height, dv }
function box(buf, ci, ox, oy, oz, x0, y0, z0, x1, y1, z1, layers, flags, o = null) {
  const cull = o ? o.cull !== false : true;
  const own = cellLight(ci);
  for (let f = 0; f < 6; f++) {
    const layer = layers[f];
    if (layer < 0) continue;
    const boundary = (f === 0 && x1 >= 16) || (f === 1 && x0 <= 0) || (f === 2 && y1 >= 16) || (f === 3 && y0 <= 0) || (f === 4 && z1 >= 16) || (f === 5 && z0 <= 0);
    let L = own;
    if (boundary) {
      const n = ci + FO[f];
      if (cull && OPAQUE[vol[n]]) continue;
      if (!OPAQUE[vol[n]]) { const nl = cellLight(n); L = Math.max(nl >> 4, own >> 4) << 4 | Math.max(nl & 15, own & 15); }
    }
    const cs = FACE_CORNERS[f];
    const rot = o && o.uvRot ? o.uvRot[f] : 0;
    for (let k = 0; k < 4; k++) {
      const c = cs[k];
      const px = c[0] ? x1 : x0, py = c[1] ? y1 : y0, pz = c[2] ? z1 : z0;
      let uv = o && o.uvFull ? UVF[f](c[0] * 16, c[1] * 16, c[2] * 16) : UVF[f](px, py, pz);
      let u = uv[0], v = uv[1];
      if (o && o.dv && f !== 2 && f !== 3) v += o.dv;
      for (let r = 0; r < rot; r++) { const t = u; u = v; v = 16 - t; }
      QU[k] = Math.max(0, Math.min(31, Math.round(u))); QV[k] = Math.max(0, Math.min(31, Math.round(v)));
      let sx = 0, sz = 0;
      if (o && o.shear && y1 > y0) { const t = (py - y0) / (y1 - y0); sx = o.shear[0] * t; sz = o.shear[1] * t; }
      QX[k] = ox + px + sx; QY[k] = oy + py; QZ[k] = oz + pz + sz;
      QA[k] = 3; QL[k] = L; QB[k] = 0;
    }
    emit(buf, layer, f, flags);
  }
}

// Rotates a canonical (+Z-facing) box by `facing` quarter turns and emits it.
const rl = new Int32Array(6);
function rbox(buf, ci, ox, oy, oz, facing, x0, y0, z0, x1, y1, z1, layers, flags, o = null) {
  for (let r = 0; r < facing; r++) { const a = x0, b = x1; x0 = 16 - z1; x1 = 16 - z0; z0 = a; z1 = b; }
  for (let f = 0; f < 6; f++) { let g = f; for (let r = 0; r < facing; r++) g = ROT_FACE[g]; rl[g] = layers[f]; }
  let oo = o;
  if (o && o.shear) {
    let [sx, sz] = o.shear;
    for (let r = 0; r < facing; r++) { const t = sx; sx = -sz; sz = t; }
    oo = { ...o, shear: [sx, sz] };
  }
  box(buf, ci, ox, oy, oz, x0, y0, z0, x1, y1, z1, rl, flags, oo);
}

// Double-sided vertical plane from (ax, az) to (bx, bz) in block pixels.
function plane(buf, ci, ox, oy, oz, ax, az, bx, bz, y0, y1, layer, flags, L, u0 = 0, u1 = 16) {
  const xs = [ax, ax, bx, bx], zs = [az, az, bz, bz], ys = [y0, y1, y1, y0], us = [u0, u0, u1, u1];
  const vTop = Math.max(0, 16 - (y1 - y0));
  for (let side = 0; side < 2; side++) {
    for (let k = 0; k < 4; k++) {
      const j = side ? 3 - k : k;
      QX[k] = ox + xs[j]; QY[k] = oy + ys[j]; QZ[k] = oz + zs[j];
      QU[k] = us[j]; QV[k] = ys[j] === y1 ? vTop : 16; QA[k] = 3; QL[k] = L; QB[k] = 0;
    }
    emit(buf, layer, 6, flags);
  }
}

// Horizontal quad (both sides optional) at height y.
function flat(buf, ox, oy, oz, x0, z0, x1, z1, y, layer, flags, L, rot = 0, both = false) {
  const pts = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]];
  for (let side = 0; side < (both ? 2 : 1); side++) {
    for (let k = 0; k < 4; k++) {
      const j = side ? 3 - k : k;
      const [px, pz] = pts[j];
      let u = px, v = pz;
      for (let r = 0; r < rot; r++) { const t = u; u = v; v = 16 - t; }
      QX[k] = ox + px; QY[k] = oy + y; QZ[k] = oz + pz; QU[k] = u; QV[k] = v; QA[k] = 3; QL[k] = L; QB[k] = 0;
    }
    emit(buf, layer, side ? 3 : 2, flags);
  }
}

// ---------------- full cubes with smooth lighting ----------------
const CORNER_OFFS = FACE_CORNERS.map(() => []);
function buildCornerOffsets() {
  const AXIS_STEP = [1, SS, S];
  FACE_CORNERS.forEach((cs, f) => {
    const t = TANGENTS[f], o = FO[f];
    CORNER_OFFS[f] = cs.map(c => {
      const s1 = c[t[0]] ? 1 : -1, s2 = c[t[1]] ? 1 : -1;
      const a = o + s1 * AXIS_STEP[t[0]], b = o + s2 * AXIS_STEP[t[1]];
      return [a, b, a + s2 * AXIS_STEP[t[1]]];
    });
  });
}

function cube(buf, i, id, m, ox, oy, oz) {
  const flags = VFLAGS[id], cullSame = CULL_SAME[id];
  const fs = FACING_SHIFT[id], as = AXIS_SHIFT[id];
  const frontFace = fs >= 0 ? FACING_FACE[(m >> fs) & 3] : -1;
  const axis = as >= 0 ? (m >> as) & 3 : 0;
  for (let f = 0; f < 6; f++) {
    const n = i + FO[f], nid = vol[n];
    if (OPAQUE[nid]) continue;
    if (cullSame && nid === id) continue;
    let tf = f, rot = 0;
    if (axis === 1) { tf = f < 2 ? 2 : 0; rot = 1; }
    else if (axis === 2) { tf = f >= 4 ? 2 : 0; rot = f < 2 ? 1 : 0; }
    const layer = f === frontFace ? texOf(id, m, 6) : texOf(id, m, tf);
    const cs = FACE_CORNERS[f], co = CORNER_OFFS[f];
    for (let k = 0; k < 4; k++) {
      const c = cs[k], cr = co[k];
      QX[k] = ox + c[0] * 16; QY[k] = oy + c[1] * 16; QZ[k] = oz + c[2] * 16;
      let [u, v] = UVF[f](c[0] * 16, c[1] * 16, c[2] * 16);
      if (rot) { const t = u; u = v; v = 16 - t; }
      QU[k] = u; QV[k] = v;
      const A = i + cr[0], Bc = i + cr[1], C = i + cr[2];
      const oa = OPAQUE[vol[A]], ob = OPAQUE[vol[Bc]], oc = OPAQUE[vol[C]];
      const ao = oa && ob ? 0 : 3 - oa - ob - oc;
      let s = skyL[n], bl = blkL[n], cnt = 1;
      if (!oa) { s += skyL[A]; bl += blkL[A]; cnt++; }
      if (!ob) { s += skyL[Bc]; bl += blkL[Bc]; cnt++; }
      if (!oc && !(oa && ob)) { s += skyL[C]; bl += blkL[C]; cnt++; }
      QA[k] = ao; QL[k] = packL(s / cnt, bl / cnt); QB[k] = ao * 64 + (s + bl) / cnt;
    }
    emit(buf, layer, f, flags);
  }
}

// ---------------- liquids ----------------
const isWaterId = id => id === B.WATER || WATERLOGGED[id] === 1;
const sameLiquid = (id, lava) => lava ? id === B.LAVA : isWaterId(id);
function liquidLevel(i) { return vol[i] === B.WATER || vol[i] === B.LAVA ? meta[i] & 15 : 0; }
function cellHeight(j, lava) {
  const id = vol[j];
  if (!sameLiquid(id, lava)) return OPAQUE[id] || SHAPE_OF[id] === SHAPE.SLAB ? -2 : -1;
  if (sameLiquid(vol[j + SS], lava)) return 16;
  const l = liquidLevel(j);
  return l >= 8 ? 14.2 : (8 - l) / 9 * 16;
}
function cornerHeight(i, dx, dz, lava) {
  let sum = 0, w = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
    const j = i + (dx - 1 + a) + (dz - 1 + b) * S;
    const h = cellHeight(j, lava);
    if (h === 16) return 16;
    if (h === -2) continue;
    if (h === -1) { w += 1; continue; }
    const wt = h >= 14 ? 10 : 1;
    sum += h * wt; w += wt;
  }
  return w ? sum / w : 14.2;
}

function liquid(bufT, bufO, i, lava, ox, oy, oz) {
  const buf = lava ? bufO : bufT;
  const above = vol[i + SS];
  const surface = !sameLiquid(above, lava);
  const h00 = surface ? cornerHeight(i, 0, 0, lava) : 16, h10 = surface ? cornerHeight(i, 1, 0, lava) : 16;
  const h11 = surface ? cornerHeight(i, 1, 1, lava) : 16, h01 = surface ? cornerHeight(i, 0, 1, lava) : 16;
  const H = [[h00, h01], [h10, h11]]; // [x][z]
  const flowing = liquidLevel(i) !== 0;
  const topLayer = TEX[lava ? (flowing ? 'lava_flow' : 'lava') : (flowing ? 'water_flow' : 'water')];
  const sideLayer = TEX[lava ? 'lava_flow' : 'water_flow'];
  const own = cellLight(i), up = cellLight(i + SS);
  const L = (Math.max(own >> 4, up >> 4) << 4) | Math.max(own & 15, up & 15);
  if (lava) { TR = TG = TB = 255; } else setWaterTint();
  if (surface && !OPAQUE[above]) {
    const cs = FACE_CORNERS[2];
    for (let k = 0; k < 4; k++) {
      const c = cs[k];
      QX[k] = ox + c[0] * 16; QZ[k] = oz + c[2] * 16; QY[k] = oy + H[c[0]][c[2]] - (lava ? 0 : 0.6);
      QU[k] = c[0] * 16; QV[k] = c[2] * 16; QA[k] = 3; QL[k] = L; QB[k] = 0;
    }
    emit(buf, topLayer, 2, lava ? VF.LAVA : VF.WATER_TOP);
    // Underside so the surface is visible from below the water too.
    if (!lava) {
      for (let k = 0; k < 4; k++) { const c = FACE_CORNERS[2][3 - k]; QX[k] = ox + c[0] * 16; QZ[k] = oz + c[2] * 16; QY[k] = oy + H[c[0]][c[2]] - 0.6; QU[k] = c[0] * 16; QV[k] = c[2] * 16; QL[k] = L; }
      emit(buf, topLayer, 3, VF.WATER);
    }
  }
  for (const f of [0, 1, 4, 5]) {
    const n = i + FO[f], nid = vol[n];
    if (OPAQUE[nid] || sameLiquid(nid, lava)) continue;
    const cs = FACE_CORNERS[f], nl = cellLight(n);
    const LL = (Math.max(nl >> 4, own >> 4) << 4) | Math.max(nl & 15, own & 15);
    for (let k = 0; k < 4; k++) {
      const c = cs[k];
      const top = c[1] ? H[c[0]][c[2]] - (surface && !lava ? 0.6 : 0) : 0;
      QX[k] = ox + c[0] * 16; QY[k] = oy + top; QZ[k] = oz + c[2] * 16;
      const uv = UVF[f](c[0] * 16, top, c[2] * 16);
      QU[k] = uv[0]; QV[k] = Math.round(uv[1]); QA[k] = 3; QL[k] = LL; QB[k] = 0;
    }
    emit(buf, sideLayer, f, lava ? VF.LAVA : VF.WATER);
  }
  const below = vol[i - SS];
  if (!OPAQUE[below] && !sameLiquid(below, lava)) {
    const cs = FACE_CORNERS[3], nl = cellLight(i - SS);
    for (let k = 0; k < 4; k++) { const c = cs[k]; QX[k] = ox + c[0] * 16; QY[k] = oy; QZ[k] = oz + c[2] * 16; QU[k] = c[0] * 16; QV[k] = c[2] * 16; QA[k] = 3; QL[k] = nl; QB[k] = 0; }
    emit(buf, topLayer, 3, lava ? VF.LAVA : VF.WATER);
  }
}

// ---------------- special shapes ----------------
const L6 = new Int32Array(6);
function six(id, m) { for (let f = 0; f < 6; f++) L6[f] = texOf(id, m, f); return L6; }
function sixOf(layer) { L6.fill(layer); return L6; }

const hash = (x, y, z) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };
let chunkX = 0, chunkZ = 0;

const connects = (nid, selfShape) => OPAQUE[nid] || SHAPE_OF[nid] === selfShape || (selfShape === SHAPE.FENCE && SHAPE_OF[nid] === SHAPE.FENCE);

function special(bufO, bufT, i, id, m, shape, ox, oy, oz, x, y, z) {
  const flags = VFLAGS[id];
  const buf = TRANSLUCENT[id] ? bufT : bufO;
  const own = cellLight(i);
  switch (shape) {
    case SHAPE.CROSS: {
      const layer = texOf(id, m, 0);
      let dx = 0, dz = 0;
      if (flags === VF.PLANT && id !== B.SUGAR_CANE && id !== B.SEAGRASS) {
        const h = hash(chunkX * 16 + x, y, chunkZ * 16 + z);
        dx = ((h & 7) - 3.5) * 0.8; dz = (((h >> 3) & 7) - 3.5) * 0.8;
      }
      const a = 0.8, b = 15.2;
      plane(buf, i, ox + dx, oy, oz + dz, a, a, b, b, 0, 16, layer, flags, own);
      plane(buf, i, ox + dx, oy, oz + dz, a, b, b, a, 0, 16, layer, flags, own);
      break;
    }
    case SHAPE.CROP: {
      const v = m & 7, age = (m >> 3) & 7;
      const layer = CROP_TEX[v] + Math.min(age, CROP_STAGES[v] - 1);
      for (const p of [4, 12]) {
        plane(buf, i, ox, oy - 1, oz, p, 0, p, 16, 0, 16, layer, VF.PLANT, own);
        plane(buf, i, ox, oy - 1, oz, 0, p, 16, p, 0, 16, layer, VF.PLANT, own);
      }
      break;
    }
    case SHAPE.TORCH: {
      const attach = (m >> 1) & 7;
      const L = six(id, m);
      L6[3] = -1; L6[2] = texOf(id, m, 2);
      if (!attach) box(buf, i, ox, oy, oz, 7, 0, 7, 9, 10, 9, L, flags, { cull: false });
      else rbox(buf, i, ox, oy, oz, attach - 1, 7, 3, 13, 9, 13, 15, L, flags, { cull: false, shear: [0, -4], dv: 3 });
      break;
    }
    case SHAPE.SLAB: {
      const t = (m >> 4) & 3;
      const [y0, y1] = t === 0 ? [0, 8] : t === 1 ? [8, 16] : [0, 16];
      box(buf, i, ox, oy, oz, 0, y0, 0, 16, y1, 16, six(id, m), flags);
      break;
    }
    case SHAPE.STAIRS: {
      const facing = (m >> 4) & 3, up = (m >> 6) & 1;
      const L = six(id, m);
      const lo = up ? [8, 16] : [0, 8], hi = up ? [0, 8] : [8, 16];
      box(buf, i, ox, oy, oz, 0, lo[0], 0, 16, lo[1], 16, L, flags);
      rbox(buf, i, ox, oy, oz, facing, 0, hi[0], 8, 16, hi[1], 16, six(id, m), flags);
      break;
    }
    case SHAPE.FENCE: {
      const L = six(id, m);
      box(buf, i, ox, oy, oz, 6, 0, 6, 10, 16, 10, L, flags);
      for (let d = 0; d < 4; d++) {
        const f = FACING_FACE[d], nid = vol[i + FO[f]];
        if (!connects(nid, SHAPE.FENCE)) continue;
        for (const [y0, y1] of [[6, 9], [12, 15]]) rbox(buf, i, ox, oy, oz, d, 7, y0, 10, 9, y1, 16, six(id, m), flags);
      }
      break;
    }
    case SHAPE.PANE: {
      const layer = texOf(id, m, 0);
      const con = [0, 1, 2, 3].map(d => connects(vol[i + FO[FACING_FACE[d]]], SHAPE.PANE));
      const any = con.some(Boolean);
      box(buf, i, ox, oy, oz, 7, 0, 7, 9, 16, 9, sixOf(layer), flags);
      for (let d = 0; d < 4; d++) if (con[d] || !any) rbox(buf, i, ox, oy, oz, d, 7, 0, 9, 9, 16, 16, sixOf(layer), flags);
      break;
    }
    case SHAPE.DOOR: {
      const facing = (m >> 3) & 3, open = (m >> 5) & 1, upper = (m >> 6) & 1;
      const layer = texOf(id, m, upper ? 2 : 0);
      rbox(buf, i, ox, oy, oz, (facing + open) & 3, 0, 0, 0, 16, 16, 3, sixOf(layer), flags, { cull: false });
      break;
    }
    case SHAPE.TRAPDOOR: {
      const facing = (m >> 3) & 3, open = (m >> 5) & 1, top = (m >> 6) & 1;
      const L = sixOf(texOf(id, m, 0));
      if (open) rbox(buf, i, ox, oy, oz, facing, 0, 0, 13, 16, 16, 16, L, flags, { cull: false, uvFull: true });
      else box(buf, i, ox, oy, oz, 0, top ? 13 : 0, 0, 16, top ? 16 : 3, 16, L, flags, { cull: false });
      break;
    }
    case SHAPE.LADDER: case SHAPE.VINE: {
      const facing = m & 3;
      setTint(id);
      const L = sixOf(texOf(id, m, 0));
      rbox(buf, i, ox, oy, oz, facing, 0, 0, 15.5, 16, 16, 16, L, flags, { cull: false, uvFull: true });
      break;
    }
    case SHAPE.SNOW: {
      const h = ((m & 7) + 1) * 2;
      box(buf, i, ox, oy, oz, 0, 0, 0, 16, h, 16, six(id, m), flags);
      break;
    }
    case SHAPE.CARPET:
      box(buf, i, ox, oy, oz, 0, 0, 0, 16, 1, 16, six(id, m), flags);
      break;
    case SHAPE.FARMLAND:
      box(buf, i, ox, oy, oz, 0, 0, 0, 16, 15, 16, six(id, m), flags, { dv: 0 });
      break;
    case SHAPE.CACTUS:
      box(buf, i, ox, oy, oz, 1, 0, 1, 15, 16, 15, six(id, m), flags, { cull: false, uvFull: true });
      break;
    case SHAPE.CHEST: {
      const facing = m & 3, L = six(id, m);
      L6[4] = texOf(id, m, 6);
      rbox(buf, i, ox, oy, oz, facing, 1, 0, 1, 15, 14, 15, L, flags);
      rbox(buf, i, ox, oy, oz, facing, 7, 7, 15, 9, 11, 16, sixOf(TEX.iron_block ?? texOf(id, m, 6)), flags);
      break;
    }
    case SHAPE.BED: {
      const facing = m & 3, head = (m >> 2) & 1;
      const L = six(id, m);
      L6[2] = head ? TEX.bed_top_head : texOf(id, m, 2);
      const rot = [0, 0, (facing + 2) & 3, 0, 0, 0];
      box(buf, i, ox, oy, oz, 0, 3, 0, 16, 9, 16, L, flags, { uvRot: rot, dv: -7 });
      for (const [lx, lz] of [[0, 0], [13, 0], [0, 13], [13, 13]]) box(buf, i, ox, oy, oz, lx, 0, lz, lx + 3, 3, lz + 3, sixOf(TEX.planks_oak), flags);
      break;
    }
    case SHAPE.SKULL: {
      const facing = (m >> 1) & 3, L = six(id, m);
      L6[4] = texOf(id, m, 6);
      rbox(buf, i, ox, oy, oz, facing, 4, 0, 4, 12, 8, 12, L, flags);
      break;
    }
    case SHAPE.LANTERN: {
      const hanging = (m >> 1) & 1, dy = hanging ? 7 : 0;
      const L = sixOf(texOf(id, m, 0));
      box(buf, i, ox, oy + dy, oz, 5, 0, 5, 11, 7, 11, L, flags, { cull: false });
      box(buf, i, ox, oy + dy, oz, 6, 7, 6, 10, 9, 10, L, flags, { cull: false });
      if (hanging) plane(buf, i, ox, oy, oz, 8, 6.5, 8, 9.5, 16, 16, TEX.iron_bars, 0, own, 0, 3);
      break;
    }
    case SHAPE.FLAT: {
      const r = hash(chunkX * 16 + x, y, chunkZ * 16 + z) & 3;
      flat(buf, ox, oy, oz, 0, 0, 16, 16, 0.5, texOf(id, m, 2), flags, own, r, true);
      break;
    }
    case SHAPE.RAIL:
      flat(buf, ox, oy, oz, 0, 0, 16, 16, 1, texOf(id, m, 2), flags, own, m & 1, false);
      break;
    case SHAPE.PORTAL: {
      const axis = m & 1, layer = texOf(id, m, 0);
      L6.fill(layer);
      // Hide faces between portal blocks.
      for (let f = 0; f < 6; f++) if (vol[i + FO[f]] === id) L6[f] = -1;
      if (axis === 0) box(buf, i, ox, oy, oz, 0, 0, 6, 16, 16, 10, L6, flags);
      else box(buf, i, ox, oy, oz, 6, 0, 0, 10, 16, 16, L6, flags);
      break;
    }
    case SHAPE.END_PORTAL:
      flat(bufO, ox, oy, oz, 0, 0, 16, 16, 12, texOf(id, m, 2), VF.END_PORTAL, own, 0, false);
      break;
    case SHAPE.ENDFRAME: {
      box(buf, i, ox, oy, oz, 0, 0, 0, 16, 13, 16, six(id, m), flags);
      if ((m >> 2) & 1) box(buf, i, ox, oy, oz, 4, 13, 4, 12, 16, 12, sixOf(TEX.end_portal_frame_eye), VF.EMISSIVE, { uvFull: true });
      break;
    }
    case SHAPE.FIRE: {
      const layer = texOf(id, m, 0);
      for (const p of [1, 15]) {
        plane(buf, i, ox, oy, oz, p, 0, p, 16, 0, 22, layer, VF.FIRE, own);
        plane(buf, i, ox, oy, oz, 0, p, 16, p, 0, 22, layer, VF.FIRE, own);
      }
      break;
    }
    case SHAPE.ROD: {
      const layer = texOf(id, m, 0);
      if (id === B.BAMBOO) box(buf, i, ox, oy, oz, 6.5, 0, 6.5, 9.5, 16, 9.5, sixOf(layer), flags, { cull: false });
      else {
        box(buf, i, ox, oy, oz, 7, 1, 7, 9, 16, 9, sixOf(layer), flags, { cull: false });
        box(buf, i, ox, oy, oz, 6, 0, 6, 10, 1, 10, sixOf(layer), flags, { cull: false });
      }
      break;
    }
    case SHAPE.CAMPFIRE: {
      const layer = texOf(id, m, 0);
      plane(buf, i, ox, oy, oz, 0.8, 0.8, 15.2, 15.2, 0, 16, layer, VF.EMISSIVE, own);
      plane(buf, i, ox, oy, oz, 0.8, 15.2, 15.2, 0.8, 0, 16, layer, VF.EMISSIVE, own);
      box(buf, i, ox, oy, oz, 1, 0, 3, 15, 3, 6, sixOf(TEX.log_oak), 0, { cull: false });
      box(buf, i, ox, oy, oz, 1, 0, 10, 15, 3, 13, sixOf(TEX.log_oak), 0, { cull: false });
      break;
    }
    default: break;
  }
}

// ---------------- chunk meshing ----------------
function topY() {
  for (let y = HH - 2; y >= 1; y--) {
    const base = y * SS;
    for (let k = 0; k < SS; k++) if (vol[base + k]) return y;
  }
  return 1;
}

// job: { ids, meta, biomes (PS*PS), cx, cz, sky }
export function meshChunk(job) {
  setStride(PS, H2);
  buildCornerOffsets();
  vol = job.ids; meta = job.meta; chunkX = job.cx; chunkZ = job.cz;
  computeTints(job.biomes, 2);
  const maxY = topY();
  computeLight(maxY, job.sky !== false);

  const opaque = new VB(4096), trans = new VB(1024);
  // Quads come out bottom-up, so 16-tall sections are contiguous ranges (drawn with per-section culling).
  const secO = new Int32Array(17), secT = new Int32Array(17);
  for (let y = 1; y <= maxY; y++) {
    if ((y - 1) % 16 === 0) { const s = (y - 1) >> 4; secO[s] = opaque.quads; secT[s] = trans.quads; }
    for (let z = PAD; z < PAD + CHUNK; z++) {
      for (let x = PAD; x < PAD + CHUNK; x++) {
        const i = x + z * S + y * SS, id = vol[i];
        if (!id) continue;
        const lx = x - PAD, lz = z - PAD;
        curTintCol = lx + lz * CHUNK;
        const ox = lx * 16, oy = (y - 1) * 16, oz = lz * 16;
        const shape = SHAPE_OF[id], m = meta[i];
        setTint(id);
        if (shape === SHAPE.CUBE) cube(TRANSLUCENT[id] ? trans : opaque, i, id, m, ox, oy, oz);
        else if (shape === SHAPE.LIQUID) liquid(trans, opaque, i, id === B.LAVA, ox, oy, oz);
        else special(opaque, trans, i, id, m, shape, ox, oy, oz, lx, y - 1, lz);
        if (WATERLOGGED[id]) liquid(trans, opaque, i, false, ox, oy, oz);
      }
    }
  }

  for (let sct = (maxY >> 4) + 1; sct <= 16; sct++) { secO[sct] = opaque.quads; secT[sct] = trans.quads; }
  for (let sct = 1; sct < 17; sct++) { if (secO[sct] < secO[sct - 1]) secO[sct] = secO[sct - 1]; if (secT[sct] < secT[sct - 1]) secT[sct] = secT[sct - 1]; }

  // Light for the chunk's own columns, for entities and particles on the main thread.
  const light = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < CHUNK; z++) {
    const src = PAD + (z + PAD) * S + (y + 1) * SS, dst = z * CHUNK + y * CHUNK * CHUNK;
    for (let x = 0; x < CHUNK; x++) light[dst + x] = (skyL[src + x] << 4) | blkL[src + x];
  }

  return {
    opaque: opaque.result(), opaqueQuads: opaque.quads,
    trans: trans.result(), transQuads: trans.quads,
    maxY: maxY - 1, light: light.buffer, secO, secT,
  };
}

// Mesh one block state on its own (held items, dropped blocks, falling blocks).
// Returns { data, quads } in the chunk vertex format, centred on the block's 0..16 pixel box.
let sVol = null, sMeta = null;
export function meshSingleBlock(id, m, light = 0xf0) {
  const saved = [S, HH, vol, meta, skyL, blkL, tints, chunkX, chunkZ];
  setStride(3, 3);
  buildCornerOffsets();
  if (!sVol) { sVol = new Uint8Array(27); sMeta = new Uint8Array(27); }
  sVol.fill(0); sMeta.fill(0);
  vol = sVol; meta = sMeta;
  const c = 1 + 3 + 9;
  vol[c] = id; meta[c] = m;
  skyL = new Uint8Array(27).fill(light >> 4); blkL = new Uint8Array(27).fill(light & 15);
  tints = null; chunkX = 0; chunkZ = 0;
  const bufO = new VB(64), bufT = new VB(16);
  const shape = SHAPE_OF[id];
  if (TINT_OF[id] === TINT.GRASS) { TR = 124; TG = 189; TB = 107; }
  else if (TINT_OF[id] === TINT.FOLIAGE) { TR = 72; TG = 181; TB = 24; }
  else if (TINT_OF[id] === TINT.WATER) { TR = 63; TG = 118; TB = 228; }
  else { TR = TG = TB = 255; }
  const r = { TR, TG, TB };
  if (shape === SHAPE.CUBE) cube(TRANSLUCENT[id] ? bufT : bufO, c, id, m, 0, 0, 0);
  else if (shape === SHAPE.LIQUID) liquid(bufT, bufO, c, id === B.LAVA, 0, 0, 0);
  else special(bufO, bufT, c, id, m, shape, 0, 0, 0, 0, 0, 0);
  // Merge both passes; the caller draws with blending.
  const total = bufO.quads + bufT.quads;
  const data = new Uint8Array(total * 4 * STRIDE);
  data.set(bufO.u8.subarray(0, bufO.quads * 4 * STRIDE));
  data.set(bufT.u8.subarray(0, bufT.quads * 4 * STRIDE), bufO.quads * 4 * STRIDE);
  [S, HH, vol, meta, skyL, blkL, tints, chunkX, chunkZ] = saved;
  setStride(S, HH);
  buildCornerOffsets();
  void r;
  return { data, quads: total };
}

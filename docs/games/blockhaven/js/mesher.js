import {
  CHUNK, HEIGHT, PAD, PS, B, R_CUBE, R_CROSS, R_TORCH, R_LIQUID,
  OPAQUE, RENDER, TRANSLUCENT, EMIT, ATTEN, VFLAGS, CULL_SAME, FACE_TEX,
  F_WATER, F_WATER_TOP,
} from './blocks.js';

// The padded volume has one extra layer below (bedrock) and above (air): layer y' = y + 1.
export const H2 = HEIGHT + 2;
const S = PS, SS = PS * PS;
export const VOLUME_SIZE = SS * H2;

// Faces: +X -X +Y -Y +Z -Z. Corners are listed counter-clockwise seen from outside.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: [2, 1, 0, 3], t: [1, 2] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: [2, 1, 0, 3], t: [1, 2] },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: [0, 3, 2, 1], t: [0, 2] },
  { n: [0, -1, 0], c: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], uv: [3, 0, 1, 2], t: [0, 2] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], uv: [2, 1, 0, 3], t: [0, 1] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], uv: [2, 1, 0, 3], t: [0, 1] },
];
const AXIS_STEP = [1, SS, S]; // index step along x, y, z
const offsetIndex = (dx, dy, dz) => dx + dz * S + dy * SS;

// Per face and corner: index offsets of the face cell and the three cells used for AO/smooth light.
for (const f of FACES) {
  f.o = offsetIndex(f.n[0], f.n[1], f.n[2]);
  f.corners = f.c.map(corner => {
    const s1 = corner[f.t[0]] ? 1 : -1, s2 = corner[f.t[1]] ? 1 : -1;
    const a = f.o + s1 * AXIS_STEP[f.t[0]];
    const b = f.o + s2 * AXIS_STEP[f.t[1]];
    return { a, b, c: a + s2 * AXIS_STEP[f.t[1]] };
  });
}

class VertexBuffer {
  constructor() { this.alloc(4096); this.quads = 0; }
  alloc(quads) {
    const buf = new ArrayBuffer(quads * 4 * 12);
    if (this.u8) new Uint8Array(buf).set(this.u8);
    this.cap = quads;
    this.u16 = new Uint16Array(buf);
    this.u8 = new Uint8Array(buf);
  }
  result() { return this.u8.buffer.slice(0, this.quads * 48); }
}

// Reused across jobs in a worker.
let skyL = null, blkL = null, queue = null;
const QMASK = (1 << 21) - 1;

function flood(light, vol, head, tail) {
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
      else { if (y >= H2 - 1) continue; n = i + SS; }
      const id = vol[n];
      if (OPAQUE[id]) continue;
      const nl = l - 1 - ATTEN[id];
      if (nl > light[n]) { light[n] = nl; q[tail] = n; tail = (tail + 1) & QMASK; }
    }
  }
}

function computeLight(vol, maxY) {
  if (!skyL) { skyL = new Uint8Array(VOLUME_SIZE); blkL = new Uint8Array(VOLUME_SIZE); queue = new Int32Array(QMASK + 1); }
  skyL.fill(0); blkL.fill(0);
  skyL.fill(15, (maxY + 1) * SS);

  for (let c = 0; c < SS; c++) {
    let l = 15;
    for (let y = maxY; y >= 1; y--) {
      const i = c + y * SS, id = vol[i];
      if (OPAQUE[id]) l = 0;
      else if (l > 0) l = Math.max(0, l - ATTEN[id]);
      skyL[i] = l;
    }
  }

  let tail = 0;
  for (let y = 1; y <= maxY + 1 && y < H2; y++) {
    for (let z = 0; z < S; z++) {
      for (let x = 0; x < S; x++) {
        const i = x + z * S + y * SS;
        const l = skyL[i];
        if (l <= 1) continue;
        // Only cells next to something darker can spread light.
        if ((x > 0 && skyL[i - 1] < l - 1 && !OPAQUE[vol[i - 1]]) ||
            (x < S - 1 && skyL[i + 1] < l - 1 && !OPAQUE[vol[i + 1]]) ||
            (z > 0 && skyL[i - S] < l - 1 && !OPAQUE[vol[i - S]]) ||
            (z < S - 1 && skyL[i + S] < l - 1 && !OPAQUE[vol[i + S]]) ||
            (y > 1 && skyL[i - SS] < l - 1 && !OPAQUE[vol[i - SS]])) {
          queue[tail] = i; tail = (tail + 1) & QMASK;
        }
      }
    }
  }
  flood(skyL, vol, 0, tail);

  tail = 0;
  for (let i = SS; i < (maxY + 1) * SS; i++) {
    const e = EMIT[vol[i]];
    if (e) { blkL[i] = e; queue[tail] = i; tail = (tail + 1) & QMASK; }
  }
  flood(blkL, vol, 0, tail);
}

const px = new Int32Array(4), py = new Int32Array(4), pz = new Int32Array(4);
const uvs = new Uint8Array(4), aos = new Uint8Array(4), lts = new Uint8Array(4), bright = new Int32Array(4);

function pushQuad(buf, layer, normal, flags) {
  if (buf.quads >= buf.cap) buf.alloc(buf.cap * 2);
  // Split along the diagonal through the darker corners to avoid AO anisotropy.
  const rot = bright[0] + bright[2] > bright[1] + bright[3] ? 1 : 0;
  let v = buf.quads * 4;
  for (let k = 0; k < 4; k++, v++) {
    const j = (k + rot) & 3;
    const o16 = v * 6, o8 = v * 12 + 8;
    buf.u16[o16] = px[j]; buf.u16[o16 + 1] = py[j]; buf.u16[o16 + 2] = pz[j]; buf.u16[o16 + 3] = flags;
    buf.u8[o8] = layer; buf.u8[o8 + 1] = normal | (uvs[j] << 3); buf.u8[o8 + 2] = aos[j]; buf.u8[o8 + 3] = lts[j];
  }
  buf.quads++;
}

function packLight(s, b) { return (Math.min(15, Math.round(s)) << 4) | Math.min(15, Math.round(b)); }

// vol: padded block ids, (x + z*PS + y'*PS*PS). Returns vertex data for the chunk's opaque and translucent passes.
export function meshChunk(vol) {
  let maxY = 1;
  for (let y = H2 - 2; y >= 1; y--) {
    const base = y * SS;
    let any = false;
    for (let i = 0; i < SS; i++) { if (vol[base + i]) { any = true; break; } }
    if (any) { maxY = y; break; }
  }
  computeLight(vol, maxY);

  const opaque = new VertexBuffer(), trans = new VertexBuffer();

  for (let y = 1; y <= maxY; y++) {
    for (let z = PAD; z < PAD + CHUNK; z++) {
      for (let x = PAD; x < PAD + CHUNK; x++) {
        const i = x + z * S + y * SS;
        const id = vol[i];
        if (!id) continue;
        const render = RENDER[id];
        const bx = (x - PAD) * 16, by = (y - 1) * 16, bz = (z - PAD) * 16;

        if (render === R_CUBE || render === R_LIQUID) {
          const liquid = render === R_LIQUID;
          const buf = TRANSLUCENT[id] ? trans : opaque;
          const above = vol[i + SS];
          const surface = liquid && above !== id && above !== B.ICE;
          for (let f = 0; f < 6; f++) {
            const face = FACES[f];
            const nb = vol[i + face.o];
            if (OPAQUE[nb]) continue;
            if (nb === id && CULL_SAME[id]) continue;
            if (liquid && f === 2 && !surface) continue;
            let flags = VFLAGS[id];
            if (liquid && id === B.WATER) flags = surface && f === 2 ? F_WATER_TOP : F_WATER;
            const layer = FACE_TEX[id * 6 + f];
            for (let k = 0; k < 4; k++) {
              const c = face.c[k], cr = face.corners[k];
              px[k] = bx + c[0] * 16;
              py[k] = by + (c[1] ? (surface ? 14 : 16) : 0);
              pz[k] = bz + c[2] * 16;
              uvs[k] = face.uv[k];
              const O = i + face.o, A = i + cr.a, Bc = i + cr.b, C = i + cr.c;
              const oa = OPAQUE[vol[A]], ob = OPAQUE[vol[Bc]], oc = OPAQUE[vol[C]];
              const ao = oa && ob ? 0 : 3 - oa - ob - oc;
              let s = skyL[O], bl = blkL[O], n = 1;
              if (!oa) { s += skyL[A]; bl += blkL[A]; n++; }
              if (!ob) { s += skyL[Bc]; bl += blkL[Bc]; n++; }
              if (!oc && !(oa && ob)) { s += skyL[C]; bl += blkL[C]; n++; }
              aos[k] = liquid ? 3 : ao;
              lts[k] = packLight(s / n, bl / n);
              bright[k] = aos[k] * 64 + s / n + bl / n;
            }
            pushQuad(buf, layer, f, flags);
          }
        } else if (render === R_CROSS) {
          const layer = FACE_TEX[id * 6];
          const lt = packLight(skyL[i], blkL[i]);
          const quadsXZ = [[0, 0, 1, 1], [0, 1, 1, 0]];
          for (const [x0, z0, x1, z1] of quadsXZ) {
            for (let side = 0; side < 2; side++) {
              const xs = side ? [x1, x1, x0, x0] : [x0, x0, x1, x1];
              const zs = side ? [z1, z1, z0, z0] : [z0, z0, z1, z1];
              const ys = [0, 1, 1, 0];
              const us = [3, 0, 1, 2];
              for (let k = 0; k < 4; k++) {
                px[k] = bx + xs[k] * 16; py[k] = by + ys[k] * 16; pz[k] = bz + zs[k] * 16;
                uvs[k] = us[k]; aos[k] = 3; lts[k] = lt; bright[k] = 0;
              }
              pushQuad(opaque, layer, 6, VFLAGS[id]);
            }
          }
        } else if (render === R_TORCH) {
          const lt = packLight(skyL[i], blkL[i]);
          const lo = 7, hi = 9, top = 10;
          for (const f of [0, 1, 2, 4, 5]) {
            const face = FACES[f];
            for (let k = 0; k < 4; k++) {
              const c = face.c[k];
              px[k] = bx + (c[0] ? hi : lo); py[k] = by + (c[1] ? top : 0); pz[k] = bz + (c[2] ? hi : lo);
              uvs[k] = face.uv[k]; aos[k] = 3; lts[k] = lt; bright[k] = 0;
            }
            pushQuad(opaque, FACE_TEX[id * 6 + f], f, VFLAGS[id]);
          }
        }
      }
    }
  }

  return {
    opaque: opaque.result(), opaqueQuads: opaque.quads,
    trans: trans.result(), transQuads: trans.quads,
    maxY: maxY - 1,
  };
}

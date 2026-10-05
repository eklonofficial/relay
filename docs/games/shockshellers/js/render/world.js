// Turns a map grid into a few merged meshes (one per material family). Faces hidden against full
// blocks are dropped, and every vertex gets baked ambient occlusion from the cells around it, which
// gives the soft, lightmapped look of the reference maps without shipping any lightmap.
import * as THREE from '../../vendor/three/three.module.js?v=muv6kjqg';
import { PIECES, BOXES, facing } from '../maps/pieces.js?v=muv6kjqg';
import { worldMaterial, TEX_SCALE } from './materials.js?v=muv6kjqg';

class Bucket {
  constructor(mat) { this.mat = mat; this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; this.v = 0; this.s = TEX_SCALE[mat] ?? 0.5; }
}

// Visual boxes per shape where they differ from the colliders.
const STEP_BOXES = [[0, 0, 0, 1, 0.25, 1], [0, 0.25, 0.25, 1, 0.5, 1], [0, 0.5, 0.5, 1, 0.75, 1], [0, 0.75, 0.75, 1, 1, 1]];
const LADDER = [[0.12, 0, 0.84, 0.2, 1, 0.94], [0.8, 0, 0.84, 0.88, 1, 0.94], ...[0.12, 0.37, 0.62, 0.87].map(y => [0.2, y - 0.03, 0.86, 0.8, y + 0.03, 0.92])];
const FENCE = [[0, 0.82, 0.44, 1, 0.94, 0.56], [0, 0.42, 0.45, 1, 0.52, 0.55], [0.02, 0, 0.42, 0.16, 1, 0.58], [0.84, 0, 0.42, 0.98, 1, 0.58]];
const ARCH = [[0, 0.72, 0, 1, 1, 1], [0, 0.62, 0, 0.12, 0.72, 1], [0.88, 0.62, 0, 1, 0.72, 1]];
const PAD = [[0, 0, 0, 1, 0.1, 1], [0.2, 0.1, 0.2, 0.8, 0.13, 0.8]];
const visualBoxes = (key, boxes) => ({ stairs: STEP_BOXES, ladder: LADDER, fence: FENCE, arch: ARCH, pad: PAD, glass: [] }[key] ?? boxes);

export function buildWorld(map) {
  const grid = map.grid, buckets = new Map();
  const bucket = m => { if (!buckets.has(m)) buckets.set(m, new Bucket(m)); return buckets.get(m); };
  const full = (x, y, z) => { const k = PIECES[grid.get(x, y, z)].key; return k === 'block' || k === 'leaves'; };
  // Is this point inside geometry (for occlusion)?
  const solidAt = (px, py, pz) => {
    const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
    if (y < 0) return true;
    const p = PIECES[grid.get(x, y, z)];
    if (!p.blocksPlayers) return false;
    for (const b of grid.boxes(x, y, z)) if (px > x + b[0] && px < x + b[3] && py > y + b[1] && py < y + b[4] && pz > z + b[2] && pz < z + b[5]) return true;
    return false;
  };
  const ao = (vx, vy, vz, nx, ny, nz) => {
    // Four samples a quarter cell out from the face, around the vertex.
    const t1 = nx ? [0, 1, 0] : [1, 0, 0], t2 = nz ? [0, 1, 0] : [0, 0, 1];
    const e = 0.22;
    let occ = 0;
    for (const a of [-1, 1]) for (const c of [-1, 1]) {
      if (solidAt(vx + nx * e + (t1[0] * a + t2[0] * c) * e, vy + ny * e + (t1[1] * a + t2[1] * c) * e, vz + nz * e + (t1[2] * a + t2[2] * c) * e)) occ++;
    }
    // Skylight: faces under a roof get a little darker overall.
    let roof = 0;
    for (let k = 1; k <= 4; k++) if (full(Math.floor(vx + nx * 0.3), Math.floor(vy + ny * 0.3) + k, Math.floor(vz + nz * 0.3))) { roof = 1; break; }
    return Math.max(0.35, 1 - occ * 0.14 - roof * 0.12 + (ny > 0 ? 0.04 : 0));
  };
  // One quad, corners counter-clockwise seen from outside.
  const quad = (B, verts, nx, ny, nz) => {
    const base = B.v;
    for (const [x, y, z] of verts) {
      B.p.push(x, y, z); B.n.push(nx, ny, nz);
      const u = nx ? z : x, v = ny ? (nz ? y : z) : y;
      B.u.push((nx ? (nx > 0 ? -u : u) : nz < 0 ? -u : u) * B.s, (ny ? (ny > 0 ? -v : v) : v) * B.s);
      const a = ao(x, y, z, nx, ny, nz); B.c.push(a, a, a);
      B.v++;
    }
    B.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (B, a, b, c, flat = true) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = B.v;
    for (const p of [a, b, c]) {
      B.p.push(p[0], p[1], p[2]); B.n.push(nx, ny, nz);
      const ax = Math.abs(nx), ay = Math.abs(ny);
      B.u.push((ay > ax ? p[0] : p[2] + p[0] * 0.3) * B.s, (ay > ax ? p[2] : p[1]) * B.s);
      const o = flat ? ao(p[0], p[1], p[2], Math.round(nx), Math.round(ny), Math.round(nz)) : 1; B.c.push(o, o, o);
      B.v++;
    }
    B.i.push(base, base + 1, base + 2);
  };
  const box = (B, x0, y0, z0, x1, y1, z1, cull) => {
    // cull(face) → true to skip; faces: 0 -x, 1 +x, 2 -y, 3 +y, 4 -z, 5 +z
    if (!cull?.(0)) quad(B, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0);
    if (!cull?.(1)) quad(B, [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], 1, 0, 0);
    if (!cull?.(2)) quad(B, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0, -1, 0);
    if (!cull?.(3)) quad(B, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], 0, 1, 0);
    if (!cull?.(4)) quad(B, [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], 0, 0, -1);
    if (!cull?.(5)) quad(B, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1);
  };
  const N6 = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  // Rotate a point in cell space by ry quarter turns, like pieces.rotateBox.
  const rot = (px, pz, ry) => { for (let i = 0; i < ry; i++) [px, pz] = [pz, 1 - px]; return [px, pz]; };
  const extras = [];

  for (let y = 0; y < grid.h; y++) for (let z = 0; z < grid.d; z++) for (let x = 0; x < grid.w; x++) {
    const i = grid.index(x, y, z), id = grid.cells[i];
    if (!id) continue;
    const p = PIECES[id], ry = grid.rot[i], mat = grid.tint[i], B = bucket(mat);
    switch (p.shape) {
      case 'block': case 'leaves':
        box(B, x, y, z, x + 1, y + 1, z + 1, f => { const [nx, ny, nz] = N6[f]; return full(x + nx, y + ny, z + nz); });
        break;
      case 'ramp': case 'halfRamp': {
        const h = p.shape === 'ramp' ? 1 : 0.5;
        const P = (px, py, pz) => { const [a, b] = rot(px, pz, ry); return [x + a, y + py, z + b]; };
        const a = P(0, 0, 0), b = P(1, 0, 0), c = P(1, 0, 1), d = P(0, 0, 1), e = P(1, h, 1), f = P(0, h, 1);
        tri(B, a, f, e); tri(B, a, e, b);            // slope
        tri(B, d, c, e); tri(B, d, e, f);            // back
        tri(B, a, d, f); tri(B, b, e, c);            // sides
        if (!full(x, y - 1, z)) { tri(B, a, b, c); tri(B, a, c, d); }
        break;
      }
      case 'barrel': {
        const M = bucket(5), r = 0.3, n = 10;
        for (let k = 0; k < n; k++) {
          const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
          const p0 = [x + 0.5 + Math.cos(a0) * r, z + 0.5 + Math.sin(a0) * r], p1 = [x + 0.5 + Math.cos(a1) * r, z + 0.5 + Math.sin(a1) * r];
          tri(M, [p0[0], y, p0[1]], [p0[0], y + 0.9, p0[1]], [p1[0], y + 0.9, p1[1]]); tri(M, [p0[0], y, p0[1]], [p1[0], y + 0.9, p1[1]], [p1[0], y, p1[1]]);
          tri(M, [x + 0.5, y + 0.9, z + 0.5], [p1[0], y + 0.9, p1[1]], [p0[0], y + 0.9, p0[1]]);
        }
        break;
      }
      case 'tree': {
        box(bucket(2), x + 0.36, y, z + 0.36, x + 0.64, y + 1.6, z + 0.64);
        extras.push({ kind: 'canopy', x: x + 0.5, y: y + 2.1, z: z + 0.5, seed: i });
        break;
      }
      case 'bush': extras.push({ kind: 'bush', x: x + 0.5, y: y + 0.25, z: z + 0.5, seed: i }); break;
      case 'glass': extras.push({ kind: 'glass', x, y, z, ry }); break;
      case 'pad': {
        const vb = visualBoxes(p.key, BOXES[id][ry]);
        box(bucket(5), x + vb[0][0], y + vb[0][1], z + vb[0][2], x + vb[0][3], y + vb[0][4], z + vb[0][5]);
        extras.push({ kind: 'pad', x: x + 0.5, y: y + 0.13, z: z + 0.5 });
        break;
      }
      default: {
        const list = visualBoxes(p.key, p.boxes).map(b => rotateVisual(b, ry));
        for (const b of list) box(B, x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
      }
    }
  }

  const group = new THREE.Group();
  for (const B of buckets.values()) {
    if (!B.v) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
    g.setIndex(B.v > 65535 ? new THREE.Uint32BufferAttribute(B.i, 1) : new THREE.Uint16BufferAttribute(B.i, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, worldMaterial(B.mat));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  for (const e of extras) group.add(buildExtra(e));
  return group;
}

function rotateVisual([x0, y0, z0, x1, y1, z1], ry) {
  for (let i = 0; i < (ry & 3); i++) [x0, z0, x1, z1] = [z0, 1 - x1, z1, 1 - x0];
  return [Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1)];
}

// Trees, bushes, pads and glass: small shared meshes placed per cell.
const shared = {};
function buildExtra(e) {
  if (e.kind === 'canopy' || e.kind === 'bush') {
    shared.leaf ??= new THREE.MeshLambertMaterial({ color: 0x7ccc3c });
    const g = new THREE.Group(), r = mulberry(e.seed);
    const parts = e.kind === 'canopy' ? 4 : 2, size = e.kind === 'canopy' ? 0.85 : 0.42;
    for (let k = 0; k < parts; k++) {
      // A soft, lumpy ball: a subdivided sphere with its surface pushed in and out a little.
      const geo = new THREE.IcosahedronGeometry(size * (0.75 + r() * 0.45), 3);
      const pos = geo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const n = 1 + 0.08 * Math.sin(v.x * 7 + k) * Math.sin(v.y * 6) * Math.sin(v.z * 8 + k * 2); pos.setXYZ(i, v.x * n, v.y * n * 0.85, v.z * n); }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, shared.leaf);
      m.position.set(e.x + (r() - 0.5) * size, e.y + (r() - 0.3) * size * 0.8, e.z + (r() - 0.5) * size);
      m.rotation.set(r() * 3, r() * 3, r() * 3);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }
  if (e.kind === 'pad') {
    shared.pad ??= new THREE.MeshBasicMaterial({ color: 0x7af0ff, transparent: true, opacity: 0.85 });
    shared.padGeo ??= new THREE.RingGeometry(0.16, 0.34, 24).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(shared.padGeo, shared.pad); m.position.set(e.x, e.y + 0.005, e.z); m.userData.pulse = true;
    return m;
  }
  if (e.kind === 'glass') {
    shared.glass ??= new THREE.MeshLambertMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.35, depthWrite: false });
    const [fx, fz] = facing(e.ry);
    const geo = new THREE.BoxGeometry(fx ? 0.1 : 1, 1, fz ? 0.1 : 1);
    const m = new THREE.Mesh(geo, shared.glass); m.position.set(e.x + 0.5, e.y + 0.5, e.z + 0.5);
    return m;
  }
  return new THREE.Group();
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

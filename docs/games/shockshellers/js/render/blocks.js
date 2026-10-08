// The imported map pieces' meshes (assets/maps/blocks.glb). A map's placed pieces are baked into
// vertex-coloured meshes, one per CHUNK×CHUNK column of cells (so what's out of view is skipped),
// leaving out every face pressed flat against a neighbour that covers it (the insides of walls and
// floors, most of a map's triangles). (Each piece's child meshes in the library are its collision
// shapes, which maps/blocks.js already holds; only the piece's own mesh is drawn.)
import * as THREE from '../../vendor/three/three.module.js?v=muzmf26a';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js?v=muzmf26a';
import { orient, turn } from '../maps/pieces.js?v=muzmf26a';
import { BLOCKS } from '../maps/blocks.js?v=muzmf26a';
import { MAP_ASSETS } from '../maps/map-assets.js?v=muzmf26a';
import { fetchAsset } from '../util/asset.js?v=muzmf26a';

const CHUNK = 8;
// Cell sides, in a piece's own frame: +x, -x, +y, -y, +z, -z.
const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const sideOf = (x, y, z) => SIDES.findIndex(d => d[0] === x && d[1] === y && d[2] === z);
// A triangle is on a side when it faces straight out of it (angled bevels don't count) and lies in
// the outermost SKIN of the cell: brick relief and ground bumps count, so a whole wall's insides go.
const SKIN = 0.06, FACING = 0.9;

// Per block: { pos, nor, col, idx } typed arrays in cell-centred space, side (per triangle: the
// cell side it lies on, or -1) and cover (per side: whether its triangles fill that side).
// null for a block with nothing to draw.
let parts = null;
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, envMapIntensity: 0.4 });
export async function loadBlocks() {
  if (parts) return;
  const gltf = await new GLTFLoader().parseAsync(await fetchAsset(MAP_ASSETS['blocks.glb']), '');
  const byName = new Map(); gltf.scene.children.forEach(o => byName.set(o.name, o));
  parts = BLOCKS.map(b => {
    // (GLTFLoader names nodes as sanitizeNodeName does: no dots, slashes or brackets.)
    const o = b.mesh ? byName.get(THREE.PropertyBinding.sanitizeNodeName(b.name)) : null;
    if (!o?.isMesh) return null;
    const g = o.geometry, a = g.attributes, n = a.position.count;
    const col = new Float32Array(n * 3);
    if (a.color) for (let i = 0; i < n; i++) { col[i * 3] = a.color.getX(i); col[i * 3 + 1] = a.color.getY(i); col[i * 3 + 2] = a.color.getZ(i); }
    else col.fill(0.8);
    const idx = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
    const pos = Float32Array.from(a.position.array), side = new Int8Array(idx.length / 3).fill(-1), area = new Float32Array(6);
    for (let t = 0; t < side.length; t++) {
      const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
      const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
      const vx = pos[i2] - pos[i0], vy = pos[i2 + 1] - pos[i0 + 1], vz = pos[i2 + 2] - pos[i0 + 2];
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], len = Math.hypot(...n);
      if (!len) continue;
      for (let k = 0; k < 3; k++) {
        const out = Math.sign(n[k]);
        if (Math.abs(n[k]) / len < FACING || [i0, i1, i2].some(i => pos[i + k] * out < 0.5 - SKIN)) continue;
        const d = [0, 0, 0]; d[k] = out; side[t] = sideOf(...d);
        area[side[t]] += Math.abs(n[k]) / 2;   // (its area seen square-on from that side)
        break;
      }
    }
    return { pos, nor: Float32Array.from(a.normal.array), col, idx, side, cover: Array.from(area, x => x > 0.7) };
  });
}
export const blocksReady = () => !!parts;

// A side of a piece in the world for an orientation (and, with the transpose, back again).
const sideTurned = (side, R) => { const [x, y, z] = turn(R, ...SIDES[side]); return sideOf(Math.round(x), Math.round(y), Math.round(z)); };
const transpose = R => [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];

// Meshes for placements [block, x, y, z, code, ...] (each piece centred in its cell, turned by its
// orientation code: maps/pieces.js orient()), in a group: one mesh per chunk of columns.
export function blockMesh(list) {
  // What sits in each cell, to find the faces a neighbour covers.
  const at = new Map(), key = (x, y, z) => (x * 4096 + y) * 4096 + z;
  for (let i = 0; i < list.length; i += 5) if (parts[list[i]]) at.set(key(list[i + 1], list[i + 2], list[i + 3]), i);
  const hidden = (i, side) => {
    const [dx, dy, dz] = SIDES[side], j = at.get(key(list[i + 1] + dx, list[i + 2] + dy, list[i + 3] + dz));
    if (j === undefined) return false;
    // The neighbour's side facing back at us, in its own frame.
    return parts[list[j]].cover[sideTurned(sideOf(-dx, -dy, -dz), transpose(orient(list[j + 4] & 63)))];
  };
  const chunks = new Map();
  for (let i = 0; i < list.length; i += 5) {
    if (!parts[list[i]]) continue;
    const k = Math.floor(list[i + 1] / CHUNK) * 1024 + Math.floor(list[i + 3] / CHUNK);
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k).push(i);
  }
  const group = new THREE.Group();
  group.name = 'imported';
  for (const items of chunks.values()) {
    // Which triangles each placement keeps.
    const keep = items.map(i => {
      const p = parts[list[i]], R = orient(list[i + 4] & 63), open = SIDES.map((_, s) => !hidden(i, s));
      const tris = [];
      if (!open.some(Boolean)) return tris;   // (buried on every side: none of it shows)
      for (let t = 0; t < p.side.length; t++) if (p.side[t] < 0 || open[sideTurned(p.side[t], R)]) tris.push(t);
      return tris;
    });
    let verts = 0, count = 0;
    items.forEach((i, n) => { verts += parts[list[i]].pos.length / 3; count += keep[n].length * 3; });
    if (!count) continue;
    const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3), idx = new Uint32Array(count);
    let v = 0, t = 0;
    items.forEach((i, n) => {
      const p = parts[list[i]];
      const cx = list[i + 1] + 0.5, cy = list[i + 2] + 0.5, cz = list[i + 3] + 0.5, R = orient(list[i + 4] & 63), nv = p.pos.length / 3;
      for (let k = 0; k < nv; k++) {
        const o = (v + k) * 3, q = turn(R, p.pos[k * 3], p.pos[k * 3 + 1], p.pos[k * 3 + 2]), n = turn(R, p.nor[k * 3], p.nor[k * 3 + 1], p.nor[k * 3 + 2]);
        pos[o] = cx + q[0]; pos[o + 1] = cy + q[1]; pos[o + 2] = cz + q[2];
        nor[o] = n[0]; nor[o + 1] = n[1]; nor[o + 2] = n[2];
      }
      col.set(p.col, v * 3);
      for (const tri of keep[n]) { idx[t++] = p.idx[tri * 3] + v; idx[t++] = p.idx[tri * 3 + 1] + v; idx[t++] = p.idx[tri * 3 + 2] + v; }
      v += nv;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}

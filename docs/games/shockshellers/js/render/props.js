// Low-poly stand-ins for the map props that are baked into the world (world.js bakeProps): trees,
// bushes, crates and barrels, in the props' own materials (so the leaves still sway and everything
// keeps its colours) but with a fraction of the triangles. Maps carry dozens of these, and a weak
// GPU pays for every triangle every frame: a modelled tree's leaves were 2,400 triangles, a crate
// with its bevelled boards 1,836. Same layout and size as the modelled ones (props.glb).
import * as THREE from '../../vendor/three/three.module.js?v=muwxp155';
import { materials } from './models.js?v=muwxp155';

// A lumpy ball: a once-subdivided icosahedron pushed in and out a little (seeded, so every copy of
// the prop is the same), smooth-shaded.
function lump(r, x, y, z, seed, k = 0.14) {
  const g = new THREE.IcosahedronGeometry(r, 1), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + k * Math.sin(v.x * 9 / r + seed) * Math.sin(v.y * 7 / r + seed * 2) * Math.sin(v.z * 8 / r + seed * 3);
    p.setXYZ(i, v.x * n + x, v.y * n * 0.9 + y, v.z * n + z);
  }
  return finish(g);
}
function finish(g) {
  // Shared vertices for smooth shading across the lumps (IcosahedronGeometry comes unindexed).
  const m = mergeVertices(g); m.computeVertexNormals(); g.dispose();
  return m;
}
// (A small vertex weld: positions within 1e-4 become one vertex.)
function mergeVertices(g) {
  const p = g.attributes.position, map = new Map(), pos = [], idx = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    let j = map.get(key);
    if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(p.getX(i), p.getY(i), p.getZ(i)); }
    idx.push(j);
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setIndex(idx);
  return out;
}
// An upright turned part (axis y) with its base at y0.
function turned(r, r2, h, x, y0, z, seg, rot) {
  const g = new THREE.CylinderGeometry(r2, r, h, seg, 1); g.translate(0, h / 2, 0);
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.translate(x, y0, z);
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g.toNonIndexed();
}
function box(w, h, d, x, y, z, rot) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.translate(x, y, z); g.deleteAttribute('uv');
  return g.toNonIndexed();
}

// (Blender's z is up and its y forward: a part at Blender (x, y, z) sits at (x, z, -y) here.)
const BUILD = {
  tree: () => ({
    leaf: [[0, 0, 2.0, 0.85], [0.45, 0.1, 1.7, 0.6], [-0.4, -0.2, 1.8, 0.62], [0.05, -0.45, 1.65, 0.55], [-0.1, 0.4, 2.25, 0.55]].map(([x, y, z, s], i) => lump(s, x, z, -y, i + 1)),
    bark: [turned(0.16, 0.1, 1.7, 0, 0, 0, 8), ...[0, 1, 2].map(a => { const ang = a / 3 * Math.PI * 2; return turned(0.06, 0.02, 0.3, Math.cos(ang) * 0.14, 0.0, -Math.sin(ang) * 0.14, 5, [0, ang, -1.2]); })],
  }),
  bush: () => ({ leaf: [[0, 0, 0.25, 0.36], [0.25, 0.08, 0.2, 0.26], [-0.22, -0.06, 0.2, 0.27]].map(([x, y, z, s], i) => lump(s, x, z, -y, i + 7, 0.1)) }),
  crate: () => {
    const dark = [];
    for (const s of [-1, 1]) {
      for (const e of [-1, 1]) { dark.push(box(0.84, 0.08, 0.08, 0, 0.4 + e * 0.38, -s * 0.39)); dark.push(box(0.08, 0.08, 0.84, s * 0.39, 0.4 + e * 0.38, 0)); }
      dark.push(box(0.08, 0.84, 0.08, s * 0.39, 0.4, 0.39), box(0.08, 0.84, 0.08, s * 0.39, 0.4, -0.39));
      dark.push(box(0.82, 0.07, 0.07, 0, 0.4, -s * 0.405, [0, 0, Math.PI / 4]), box(0.07, 0.07, 0.82, s * 0.405, 0.4, 0, [Math.PI / 4, 0, 0]));
    }
    return { wood: [box(0.8, 0.8, 0.8, 0, 0.4, 0)], woodDark: dark };
  },
  barrel: () => ({
    teal: [turned(0.3, 0.3, 0.88, 0, 0, 0, 14)],
    steel: [0.12, 0.44, 0.76].map(z => turned(0.31, 0.31, 0.04, 0, z - 0.02, 0, 14)).concat([turned(0.04, 0.04, 0.02, 0.12, 0.885, -0.05, 6)]),
    gunmetal: [turned(0.27, 0.27, 0.02, 0, 0.875, 0, 14)],
  }),
};

const cache = new Map();
// A prop's parts as [{ mat, geo }] (like models.js modelParts), or null to use the modelled one.
export function propParts(name) {
  if (cache.has(name)) return cache.get(name);
  let parts = null;
  if (BUILD[name]) {
    const byMat = BUILD[name]();
    if (Object.keys(byMat).every(k => materials.has(k))) {
      parts = Object.entries(byMat).map(([k, list]) => {
        const geo = list.length === 1 ? list[0] : mergeList(list);
        geo.computeBoundingSphere();
        return { mat: materials.get(k), geo };
      });
    }
  }
  cache.set(name, parts);
  return parts;
}
function mergeList(list) {
  // All one kind (indexed lumps, or unindexed boxes and cylinders) per material.
  const indexed = list.every(g => g.index), src = indexed ? list : list.map(g => g.index ? g.toNonIndexed() : g);
  const pos = [], nor = [], idx = [];
  let base = 0;
  for (const g of src) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    if (indexed) for (const i of g.index.array) idx.push(i + base);
    base += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (indexed) out.setIndex(idx);
  return out;
}

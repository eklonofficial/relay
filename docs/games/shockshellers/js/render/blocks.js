// The imported map pieces' meshes (assets/maps/blocks.glb). A map's placed pieces are baked into one
// vertex-coloured mesh: one draw call for all of a map's imported geometry. (Each piece's child
// meshes in the library are its collision shapes, which maps/blocks.js already holds; only the
// piece's own mesh is drawn.)
import * as THREE from '../../vendor/three/three.module.js?v=muzi7z97';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js?v=muzi7z97';
import { BLOCKS } from '../maps/blocks.js?v=muzi7z97';
import { MAP_ASSETS } from '../maps/map-assets.js?v=muzi7z97';
import { fetchAsset } from '../util/asset.js?v=muzi7z97';

let parts = null;   // per block: { pos, nor, col, idx } typed arrays in cell-centred space, or null
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
    return { pos: Float32Array.from(a.position.array), nor: Float32Array.from(a.normal.array), col, idx };
  });
}
export const blocksReady = () => !!parts;

// One mesh for placements [block, x, y, z, ry, ...] (each piece centred in its cell, turned ry quarter
// turns like maps/pieces.js rotateBox).
export function blockMesh(list) {
  let verts = 0, tris = 0;
  for (let i = 0; i < list.length; i += 5) { const p = parts[list[i]]; if (p) { verts += p.pos.length / 3; tris += p.idx.length; } }
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3), idx = new Uint32Array(tris);
  let v = 0, t = 0;
  for (let i = 0; i < list.length; i += 5) {
    const p = parts[list[i]]; if (!p) continue;
    const cx = list[i + 1] + 0.5, cy = list[i + 2] + 0.5, cz = list[i + 3] + 0.5, r = list[i + 4] & 3;
    // A quarter turn maps (x, z) to (z, -x), as rotateBox does in cell space.
    const c = [1, 0, -1, 0][r], s = [0, 1, 0, -1][r], n = p.pos.length / 3;
    for (let k = 0; k < n; k++) {
      const x = p.pos[k * 3], z = p.pos[k * 3 + 2], nx = p.nor[k * 3], nz = p.nor[k * 3 + 2], o = (v + k) * 3;
      pos[o] = cx + x * c + z * s; pos[o + 1] = cy + p.pos[k * 3 + 1]; pos[o + 2] = cz - x * s + z * c;
      nor[o] = nx * c + nz * s; nor[o + 1] = p.nor[k * 3 + 1]; nor[o + 2] = -nx * s + nz * c;
    }
    col.set(p.col, v * 3);
    for (let k = 0; k < p.idx.length; k++) idx[t + k] = p.idx[k] + v;
    v += n; t += p.idx.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material);
  mesh.castShadow = mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
  return mesh;
}

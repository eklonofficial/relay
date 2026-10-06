// The modelled assets (assets/models/*.glb, built by tools/models/build_models.py in Blender):
// guns, eggs, gloves, hats and props. Loaded once at start-up; clone() hands out a copy of any named
// model with its attachment points (muzzle, sight, grip, support) read from the file's empties and its
// magazine part ("mag") found for reload animation. merged() hands out a static copy with every part
// baked into one mesh per material, for things whose parts never move on their own (props, the guns
// other eggs hold, hats): a crate is 18 parts, and each part would otherwise be its own draw call.
// Development loads the files; the production build inlines them as data: URLs.
import * as THREE from '../../vendor/three/three.module.js?v=muwb4ktb';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js?v=muwb4ktb';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js?v=muwb4ktb';

const FILES = {
  guns: new URL('../../assets/models/guns.glb', import.meta.url).href,
  eggs: new URL('../../assets/models/eggs.glb', import.meta.url).href,
  props: new URL('../../assets/models/props.glb', import.meta.url).href,
};
const library = new Map();
let ready = false;
export const modelsReady = () => ready;

// Materials by name, so the renderer can tune families (metals reflect the sky, leaves sway).
export const materials = new Map();
const METALS = new Set(['steel', 'gunmetal', 'brass', 'gold']);

export async function loadModels() {
  const loader = new GLTFLoader();
  await Promise.all(Object.values(FILES).map(async url => {
    const buf = await (await fetch(url)).arrayBuffer();
    const gltf = await loader.parseAsync(buf, '');
    for (const node of gltf.scene.children) {
      node.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const m = o.material;
        if (m && m.isMeshStandardMaterial) {
          materials.set(m.name, m);
          // Metals pick up the sky's reflection (scene.environment); everything else stays matte so
          // it sits with the world's flat-lit look.
          if (METALS.has(m.name)) { m.metalness = Math.min(m.metalness, 0.85); m.roughness = Math.max(0.28, m.roughness); m.envMapIntensity = 1.1; }
          else m.envMapIntensity = 0.45;
        }
      });
      library.set(node.name, node);
    }
  }));
  ready = true;
}

// Names repeat across models in one Blender scene (mag, mag.001 …; three drops the dot).
const base = n => n.replace(/[._]?\d+$/, '');
function anchorsOf(g) {
  const anchors = {};
  let mag = null;
  g.traverse(o => {
    if (o === g) return;
    const n = base(o.name);
    if (!o.isMesh && ['muzzle', 'sight', 'grip', 'support'].includes(n)) anchors[n] = o.position.clone();
    if (n === 'mag' && !mag) mag = o;
  });
  return { anchors, mag };
}

// A copy of a named model, with its attachment points in userData (in the model's own space).
export function clone(name) {
  const src = library.get(name);
  if (!src) return null;
  const g = src.clone(true);
  const { anchors, mag } = anchorsOf(g);
  g.userData = { ...anchors, mag, model: name };
  if (!g.userData.muzzle) g.userData.muzzle = new THREE.Vector3(0, 0, -0.3);
  return g;
}
export const hasModel = name => library.has(name);

// One merged geometry per material for a model, in the model's own space (cached; shared by copies).
const mergedParts = new Map();
function partsOf(name) {
  if (mergedParts.has(name)) return mergedParts.get(name);
  const src = library.get(name);
  if (!src) return null;
  src.updateMatrixWorld(true);
  const inv = src.matrixWorld.clone().invert(), groups = new Map(), m = new THREE.Matrix4();
  src.traverse(o => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', o.geometry.attributes.position.clone());
    if (o.geometry.attributes.normal) g.setAttribute('normal', o.geometry.attributes.normal.clone());
    if (o.geometry.index) g.setIndex(o.geometry.index.clone());
    g.applyMatrix4(m);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!groups.has(o.material)) groups.set(o.material, []);
    groups.get(o.material).push(g);
  });
  const parts = [];
  for (const [mat, list] of groups) {
    const indexed = list.every(g => g.index);
    const geo = mergeGeometries(indexed ? list : list.map(g => g.index ? g.toNonIndexed() : g));
    geo.computeBoundingSphere();
    parts.push({ mat, geo });
  }
  const { anchors } = anchorsOf(src);
  const entry = { parts, anchors };
  mergedParts.set(name, entry);
  return entry;
}
// A static copy of a named model: one mesh per material (anchors in userData, as clone()).
export function merged(name, shadows = true) {
  const e = partsOf(name);
  if (!e) return null;
  const g = new THREE.Group();
  for (const { mat, geo } of e.parts) { const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = shadows; mesh.receiveShadow = true; g.add(mesh); }
  g.userData = { ...Object.fromEntries(Object.entries(e.anchors).map(([k, v]) => [k, v.clone()])), model: name };
  if (!g.userData.muzzle) g.userData.muzzle = new THREE.Vector3(0, 0, -0.3);
  return g;
}
// The raw merged parts of a model (for baking many copies of a prop into the world's own meshes).
export const modelParts = name => partsOf(name)?.parts || null;

// The modelled assets. assets/models/*.glb (built by tools/models/build_models.py in Blender) hold
// the props; assets/imported/*.glb hold the egg, hats and hands, each weapon (one skeleton, every
// skin as its own skinned mesh, and its animation clips), the whisk and the projectiles.
// Loaded once at start-up; clone() hands out a copy of any named model with its attachment points
// read from the file's empties. merged() hands out a static copy with every part baked into one mesh
// per material, for things whose parts never move on their own: a crate is 18 parts, and each part
// would otherwise be its own draw call. weaponModel() hands out a weapon rig (weapon-rig.js plays
// it). The production build ships the files content-addressed beside the bundle.
import * as THREE from '../../vendor/three/three.module.js?v=muziihfj';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js?v=muziihfj';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js?v=muziihfj';
import { clone as cloneSkeleton } from '../../vendor/three/SkeletonUtils.js?v=muziihfj';
import { ASSETS, WEAPON_ASSETS } from './asset-catalog.js?v=muziihfj';
import { PROFILE } from './weapon-profile.js?v=muziihfj';
import { fetchAsset } from '../util/asset.js?v=muziihfj';

const FILES = {
  props: new URL('../../assets/models/props.glb', import.meta.url).href,
};
const library = new Map();
let ready = false;
export const modelsReady = () => ready;

// Materials by name, so the renderer can tune families (metals reflect the sky, leaves sway).
export const materials = new Map();
const METALS = new Set(['steel', 'gunmetal', 'brass', 'gold']);

// Imported bundle nodes are numbered in file order (nodes_0001 is node 0).
const nodeName = index => `nodes_${String(index + 1).padStart(4, '0')}`;
const EGG_NODE = 540, HANDS_NODE = 544, GRENADE_NODE = 77, ROCKET_NODE = 76;
const MELEE = { file: 'melee_weapons', skins: [nodeName(68)], right: nodeName(0), left: nodeName(1), short: 0, inspect: 0, fire: 1 };
const bundles = new Map(), templates = new Map();
// Imported meshes are vertex-coloured; one matte material per bundle keeps them to one shader.
const vertexColored = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, envMapIntensity: 0.45 });
export const importedMaterial = vertexColored;

export async function loadModels() {
  const loader = new GLTFLoader();
  const imported = Object.entries(ASSETS).filter(([name]) => name.endsWith('.glb'));
  await Promise.all(imported.map(async ([name, url]) => {
    const gltf = await loader.parseAsync(await fetchAsset(url), '');
    gltf.scene.traverse(o => { if (o.isMesh) { o.material = vertexColored; o.castShadow = o.receiveShadow = true; if (o.isSkinnedMesh) o.frustumCulled = false; } });
    bundles.set(name, gltf);
  }));
  const character = bundles.get('character.glb').scene, projectiles = bundles.get('projectiles.glb').scene;
  library.set('grenade', projectiles.getObjectByName(nodeName(GRENADE_NODE)));
  library.set('rocket', projectiles.getObjectByName(nodeName(ROCKET_NODE)));
  eggGeo = shellGeometryFrom(character.getObjectByName(nodeName(EGG_NODE)));
  await Promise.all(Object.values(FILES).map(async url => {
    const buf = await fetchAsset(url);
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

// The imported egg as the shell: its base at y = 0 like the rest of the egg's parts, with u/v
// texture coordinates matching shellart.js (u once around, the front, -z, at u = 0.5; v up the
// egg) so the painted colour, pattern and stamp map onto it. Its vertex colours carry the crack
// pattern egg.js reveals with damage. Triangles across the u seam get their own corners (u + 1) so
// the texture doesn't smear back around the egg.
let eggGeo = null, eggMinY = 0;   // (hats are placed relative to the egg's centre, as the shell was)
export const eggGeometry = () => eggGeo;
function shellGeometryFrom(mesh) {
  const g = mesh.geometry.toNonIndexed(), pos = g.attributes.position;
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, height = max.y - min.y, uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 3) {
    const u = [0, 1, 2].map(k => Math.hypot(pos.getX(i + k), pos.getZ(i + k)) < 1e-4 ? null : (Math.atan2(pos.getX(i + k), pos.getZ(i + k)) / (2 * Math.PI) + 1) % 1);
    const known = u.filter(v => v !== null), lo = Math.min(...known), wraps = Math.max(...known) - lo > 0.5;
    const fixed = u.map(v => v === null ? null : wraps && v < 0.5 ? v + 1 : v), mean = fixed.filter(v => v !== null).reduce((a, b) => a + b, 0) / known.length;
    for (let k = 0; k < 3; k++) { uv[(i + k) * 2] = fixed[k] ?? mean; uv[(i + k) * 2 + 1] = (pos.getY(i + k) - min.y) / height; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  eggMinY = min.y; g.translate(0, -min.y, 0); g.computeBoundingSphere();
  return g;
}
// A hat by its node in the character bundle, placed on an egg whose base is at y = 0.
export function hatModel(node) {
  const src = bundles.get('character.glb')?.scene.getObjectByName(nodeName(node));
  if (!src) return null;
  const hat = src.clone(); hat.position.y -= eggMinY; hat.castShadow = false;
  return hat;
}

// One mesh and the armature it uses, never the hundreds of other skins sharing that armature.
function rigTemplate(file, name) {
  const source = bundles.get(file).scene, group = new THREE.Group();
  for (const o of source.children) if (!o.isMesh || o.name === name) group.add(o.clone(true));
  const mesh = group.getObjectByName(name), original = source.getObjectByName(name);
  mesh.skeleton = new THREE.Skeleton(original.skeleton.bones.map(b => group.getObjectByName(b.name)), original.skeleton.boneInverses);
  mesh.bindMatrix.copy(original.bindMatrix); mesh.bindMatrixInverse.copy(original.bindMatrixInverse);
  return group;
}
export const weaponSpec = id => id === 'whisk' ? MELEE : WEAPON_ASSETS[id];
// A weapon rig: the skin's skinned mesh on its own skeleton, and (hands) the mittens bound to its
// grip and support bones. userData: the clips, the spec (which clip is which), the muzzle.
export function weaponModel(id, skin = 0, hands = false) {
  const spec = weaponSpec(id);
  if (!spec || !ready) return null;
  const index = Number.isInteger(skin) && skin >= 0 && skin < spec.skins.length ? skin : 0, key = `${id}:${index}`;
  if (!templates.has(key)) templates.set(key, rigTemplate(spec.file + '.glb', spec.skins[index]));
  const group = cloneSkeleton(templates.get(key));
  if (hands) {
    const source = bundles.get('character.glb').scene.getObjectByName(nodeName(HANDS_NODE));
    const mesh = new THREE.SkinnedMesh(source.geometry, vertexColored);
    mesh.name = 'hands'; mesh.frustumCulled = false;
    group.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([group.getObjectByName(spec.right), group.getObjectByName(spec.left)], source.skeleton.boneInverses.map(m => m.clone())), source.bindMatrix);
    group.add(mesh);
  }
  group.userData = { model: id, clips: bundles.get(spec.file + '.glb').animations, spec, muzzle: new THREE.Vector3(0.25, 0, -(PROFILE[id]?.muzzle ?? 0.6)) };
  return group;
}

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

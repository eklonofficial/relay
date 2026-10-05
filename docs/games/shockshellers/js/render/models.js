// The modelled assets (assets/models/*.glb, built by tools/models/build_models.py in Blender):
// guns, eggs, gloves, hats and props. Loaded once at start-up; clone() hands out a copy of any named
// model with its attachment points (muzzle, sight, grip, support) read from the file's empties and its
// magazine part ("mag") found for reload animation. Development loads the files; the production
// build inlines them as data: URLs.
import * as THREE from '../../vendor/three/three.module.js?v=muv76gka';
import { GLTFLoader } from '../../vendor/three/GLTFLoader.js?v=muv76gka';

const FILES = {
  guns: new URL('../../assets/models/guns.glb', import.meta.url).href,
  eggs: new URL('../../assets/models/eggs.glb', import.meta.url).href,
  props: new URL('../../assets/models/props.glb', import.meta.url).href,
};
const library = new Map();
let ready = false;
export const modelsReady = () => ready;

export async function loadModels() {
  const loader = new GLTFLoader();
  await Promise.all(Object.values(FILES).map(async url => {
    const buf = await (await fetch(url)).arrayBuffer();
    const gltf = await loader.parseAsync(buf, '');
    for (const node of gltf.scene.children) {
      node.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          // Plain, cheap shading that matches the world (no environment map to light metals).
          const m = o.material;
          if (m && m.isMeshStandardMaterial) { m.envMapIntensity = 0; if (m.metalness > 0.5) m.metalness = 0.45; }
        }
      });
      library.set(node.name, node);
    }
  }));
  ready = true;
}

// A copy of a named model, with its attachment points in userData (in the model's own space).
export function clone(name) {
  const src = library.get(name);
  if (!src) return null;
  const g = src.clone(true);
  const anchors = {};
  // Names repeat across models in one Blender scene (mag, mag.001 …; three drops the dot).
  const base = n => n.replace(/[._]?\d+$/, '');
  let mag = null;
  g.traverse(o => {
    if (o === g) return;
    const n = base(o.name);
    if (!o.isMesh && ['muzzle', 'sight', 'grip', 'support'].includes(n)) anchors[n] = o.position.clone();
    if (n === 'mag' && !mag) mag = o;
  });
  g.userData = { ...anchors, mag, model: name };
  if (!g.userData.muzzle) g.userData.muzzle = new THREE.Vector3(0, 0, -0.3);
  return g;
}
export const hasModel = name => library.has(name);

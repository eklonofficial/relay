// The weapons as drawn. The first-person gun (and any egg up close) is a live rig that weapon-rig.js
// animates; everything else gets a still copy: the rig at rest, skinned once on the CPU and baked
// into one vertex-coloured mesh (one draw call), for other eggs' guns, the weapon icons and the shop.
// The Cluck Bomb and rocket are plain imported meshes.
import * as THREE from '../../vendor/three/three.module.js?v=muzthczg';
import { mergeGeometries } from '../../vendor/three/BufferGeometryUtils.js?v=muzthczg';
import { clone, importedMaterial } from './models.js?v=muzthczg';
import { WeaponRig } from './weapon-rig.js?v=muzthczg';
import { WEAPON_ASSETS } from './asset-catalog.js?v=muzthczg';
import { PROFILE } from './weapon-profile.js?v=muzthczg';

export const GUN_IDS = Object.keys(WEAPON_ASSETS);

// Each skinned mesh of a rig posed at rest, baked into its root's space (positions, normals, colours).
function bake(rig) {
  const parts = [], p = new THREE.Vector3(), n = new THREE.Vector4(), normalMatrix = new THREE.Matrix3();
  rig.root.updateMatrixWorld(true);
  rig.root.traverse(o => {
    if (!o.isSkinnedMesh || !o.visible) return;
    const src = o.geometry, count = src.attributes.position.count, pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
    normalMatrix.getNormalMatrix(o.matrixWorld);
    for (let i = 0; i < count; i++) {
      o.applyBoneTransform(i, p.fromBufferAttribute(src.attributes.position, i)).applyMatrix4(o.matrixWorld);
      pos.set([p.x, p.y, p.z], i * 3);
      n.set(src.attributes.normal.getX(i), src.attributes.normal.getY(i), src.attributes.normal.getZ(i), 0);
      o.applyBoneTransform(i, n);
      p.set(n.x, n.y, n.z).applyMatrix3(normalMatrix).normalize();
      nor.set([p.x, p.y, p.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', src.attributes.color.clone());
    if (src.index) g.setIndex(src.index.clone());
    parts.push(g);
  });
  const geo = mergeGeometries(parts); geo.computeBoundingSphere();
  return geo;
}

// A weapon (or the whisk) at rest in one geometry; hands adds the mittens holding it. Cached.
const stills = new Map();
export function stillGeometry(id, skin = 0, hands = false) {
  const key = `${id}|${skin}|${hands}`;
  if (!stills.has(key)) { const rig = new WeaponRig(id, skin, hands); stills.set(key, bake(rig)); rig.dispose(); }
  return stills.get(key);
}
// What another egg holds: its gun and both mittens, one mesh in the gun's own space.
export const heldGeometry = (id, skin = 0) => stillGeometry(id, skin, true);
// Where a weapon's muzzle is in its own space.
export const muzzleOf = id => new THREE.Vector3(0.25, 0, -(PROFILE[id]?.muzzle ?? 0.6));

// A still model to place in the scene: a weapon at rest, or the Cluck Bomb / rocket.
export function gunModel(id, skin = 0) {
  if (id === 'grenade' || id === 'rocket') return clone(id);
  const g = new THREE.Group(), m = new THREE.Mesh(stillGeometry(id, skin), importedMaterial);
  m.castShadow = true; g.add(m); g.userData = { model: id, muzzle: muzzleOf(id) };
  return g;
}

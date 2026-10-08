// First-person hands (GDD §25): the held weapon's imported rig (the gun and both mittens on one
// skeleton), drawn in its own scene and camera after the world, over a cleared depth buffer.
//
// What the hands and gun do comes from the rig's own clips (weapon-rig.js): firing, inspecting, the
// whisk's swing, and each reload, sampled on the simulation's reload clock so it ends exactly when
// the reload does. The framing is the one those clips were made for (weapon-profile.js): the gun
// pivots at the head, 0.1 below the eye, turned a little inwards at the hip; aiming brings it square
// under the eye at the gun's own height and narrows the view to its zoom.
//
// On top of that, everything that moves the whole gun (sway, bob, strafe lean, breathing, jumps and
// landings, recoil, sprinting, swaps, the jolt of each mechanical moment of a reload) runs through
// critically damped springs, so motion never snaps. Spent brass flies out of the ejection port; the
// muzzle flash is a star plus two crossed flames; smoke curls off the barrel.
import * as THREE from '../../vendor/three/three.module.js?v=muziihfj';
import { gunModel } from './guns.js?v=muziihfj';
import { WeaponRig } from './weapon-rig.js?v=muziihfj';
import { HIP_FOV, PROFILE } from './weapon-profile.js?v=muziihfj';

// Recoil per shot: [kick back (m), muzzle climb (rad), side jitter (rad), roll jitter (rad), camera punch (rad)].
const RECOIL = {
  yolk47: [0.032, 0.06, 0.018, 0.03, 0.004], beater: [0.024, 0.045, 0.02, 0.025, 0.003], triBoil: [0.03, 0.055, 0.015, 0.02, 0.004],
  peck9mm: [0.03, 0.13, 0.02, 0.05, 0.005], cageFree: [0.05, 0.1, 0.015, 0.03, 0.009], poacher: [0.085, 0.17, 0.02, 0.06, 0.016],
  doubleYolker: [0.095, 0.22, 0.03, 0.07, 0.016], yolkzooka: [0.11, 0.12, 0.02, 0.04, 0.016],
};
const FLASH = { doubleYolker: 1.6, yolkzooka: 1.8, poacher: 1.35, cageFree: 1.15, yolk47: 1, triBoil: 1, beater: 0.8, peck9mm: 0.75 };
// Where each gun throws its spent case with every shot (its own space). The shotgun, sniper and
// launcher don't: their cases come out (or don't) during the reload.
const EJECT = { yolk47: [0.27, 0.04, -0.21], beater: [0.27, 0.07, -0.13], triBoil: [0.27, 0.05, -0.15], cageFree: [0.27, 0.05, -0.2], peck9mm: [0.265, 0.045, -0.27] };
// The jolt each mechanical moment of a reload (reload-cues.js) gives the gun's springs, accenting the
// clip: [rise, pitch, push back, roll, camera nod].
const KICK = {
  out: [-0.15, -0.85, 0, 0.35, 0], in: [0.32, 1.55, 0.07, -0.45, 0.04], rack: [0.16, 1.4, 0.2, 0.3, 0.045], pull: [0, 0.3, 0.14, 0, 0],
  open: [-0.18, -1.3, 0, 0.45, 0], load: [0.09, 0.45, 0, 0, 0], close: [0.36, 2.3, 0.12, -0.55, 0.07],
};

// Keyframe helpers: progress of f through [a,b] (clamped), smoothed; a bump that rises and falls in [a,b].
const ss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const bump = (f, a, b) => (f <= a || f >= b) ? 0 : Math.sin((f - a) / (b - a) * Math.PI);
// Fast out of the blocks and settling: a move that starts fast reads as deliberate.
const snap = (f, a, b) => { const t = Math.max(0, Math.min(1, (f - a) / (b - a))); return 1 - (1 - t) ** 3; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rnd = () => Math.random() * 2 - 1;

// A critically damped spring (stiffness k): x chases target, v is its velocity. Stepped in small
// sub-steps so a long frame can't make it overshoot wildly.
export class Spring {
  constructor(k = 120, damping = 1) { this.k = k; this.c = 2 * Math.sqrt(k) * damping; this.x = 0; this.v = 0; }
  step(target, dt) {
    for (let t = dt; t > 1e-6; t -= 1 / 240) {
      const h = Math.min(t, 1 / 240);
      this.v += ((target - this.x) * this.k - this.v * this.c) * h; this.x += this.v * h;
    }
    return this.x;
  }
}
// The holder's rest pose at aim blend a: [x, y, z, pitch, yaw] relative to the head pivot. Pure, so
// the framing is testable: at the hip it sits at the pivot turned in; aimed, square under the eye.
export function restPose(id, a, out = [0, 0, 0, 0, 0]) {
  const p = PROFILE[id] || PROFILE.yolk47;
  out[0] = -0.25 * a; out[1] = p.scopeY * a; out[2] = 0.05 * a; out[3] = 0.035 * (1 - a); out[4] = 0.14 * (1 - a);
  return out;
}
// The view's vertical field of view (degrees) at aim blend a.
export const viewFov = (id, a) => THREE.MathUtils.radToDeg(HIP_FOV + ((PROFILE[id] || PROFILE.yolk47).scopeFov - HIP_FOV) * a);

function starTexture() {
  const c = new OffscreenCanvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.22, 'rgba(255,226,140,0.95)'); g.addColorStop(0.55, 'rgba(255,150,40,0.5)'); g.addColorStop(1, 'rgba(255,110,20,0)');
  x.fillStyle = g;
  x.beginPath();
  for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2, r = i % 2 ? 18 : 64 - (i % 4) * 9; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// A flame seen side-on: hot at the muzzle (left), ragged and tapering forward.
function flameTexture() {
  const c = new OffscreenCanvas(128, 64), x = c.getContext('2d');
  let s = 7; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const t = r(), cx = 6 + t * 110, cy = 32 + (r() - 0.5) * 18 * (1 - t), rad = (1 - t) * 22 + 4;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255,${200 + 55 * (1 - t) | 0},${120 * (1 - t) | 0},${0.55 * (1 - t * 0.7)})`); g.addColorStop(1, 'rgba(255,120,20,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// A soft, lumpy smoke puff (a few overlapping blobs), white so its material tints it.
function smokeTexture() {
  const c = new OffscreenCanvas(64, 64), x = c.getContext('2d');
  let s = 11; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14; i++) {
    const cx = 20 + r() * 24, cy = 20 + r() * 24, rad = 10 + r() * 14, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.32)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// The melee swoosh: a flat arc ribbon in front of the camera, fading from its tail to its head.
function swooshMesh() {
  const c = new OffscreenCanvas(128, 16), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 128, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.8, 'rgba(255,250,235,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0.95)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 16);
  const v = x.createLinearGradient(0, 0, 0, 16); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
  x.globalCompositeOperation = 'destination-out'; x.fillStyle = v; x.fillRect(0, 0, 128, 16);
  const N = 22, pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) { const u = i / N, a = -0.25 + (1 - u) * 2.7; for (const r of [0.2, 0.3]) { pos.push(Math.cos(a) * r, Math.sin(a) * r * 0.5, 0); uv.push(u, r > 0.25 ? 1 : 0); } }
  for (let i = 0; i < N; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false, opacity: 0 }));
  m.renderOrder = 6; m.visible = false; m.frustumCulled = false; return m;
}
const lerpA = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const CASINGS = 24, PUFFS = 12, CASE_SIZE = 0.64;
// How much barrel smoke each gun leaves (a wisp per shot; sustained fire builds a haze).
const SMOKE = { doubleYolker: 2, yolkzooka: 2.6, poacher: 1.4, cageFree: 1.1, yolk47: 0.75, triBoil: 0.75, beater: 0.6, peck9mm: 0.55 };

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(THREE.MathUtils.radToDeg(HIP_FOV), 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.5); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9); this.sun.position.set(-1, 2, 1); this.scene.add(this.sun);
    this.root = new THREE.Group(); this.scene.add(this.root);
    // The head pivot the gun (and the whisk) hang from, 0.1 below the eye.
    this.head = new THREE.Group(); this.head.position.y = -0.1; this.root.add(this.head);
    this.hold = new THREE.Group(); this.hold.rotation.order = 'YXZ'; this.head.add(this.hold);
    this.shieldMat = new THREE.MeshStandardMaterial({ color: 0x9cff9c, roughness: 0.5, emissive: 0x1a6b1a });
    this.swoosh = swooshMesh(); this.swoosh.position.set(0.02, -0.17, -0.42); this.root.add(this.swoosh); this.lastMelee = 0;
    // Muzzle flash: a star facing the camera plus two crossed flame quads along the bore.
    this.flash = new THREE.Group(); this.flash.visible = false; this.hold.add(this.flash);
    const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
    this.flashStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), ...add })); this.flashStar.renderOrder = 5; this.flash.add(this.flashStar);
    const fg = new THREE.PlaneGeometry(1, 0.5).translate(0.5, 0, 0).rotateY(Math.PI / 2), fm = new THREE.MeshBasicMaterial({ map: flameTexture(), side: THREE.DoubleSide, ...add });
    this.flame = new THREE.Group(); this.flash.add(this.flame);
    for (let i = 0; i < 2; i++) { const p = new THREE.Mesh(fg, fm); p.rotation.z = i * Math.PI / 2; p.renderOrder = 5; this.flame.add(p); }
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.4, 2); this.hold.add(this.flashLight);
    // Spent brass: one instanced mesh, each case flying in camera space.
    const cg = new THREE.CylinderGeometry(0.0055, 0.0055, 0.024, 8).rotateZ(Math.PI / 2);
    this.casings = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.8, envMapIntensity: 1.2 }), CASINGS);
    this.casings.frustumCulled = false; this.casings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.casingList = Array.from({ length: CASINGS }, () => ({ life: 0, p: V(0, 0, 0), v: V(0, 0, 0), r: new THREE.Euler(), w: V(0, 0, 0), s: 1 }));
    for (let i = 0; i < CASINGS; i++) { this.casings.setColorAt(i, new THREE.Color(0xd9a441)); this.casings.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0)); }
    this.root.add(this.casings); this.ci = 0;
    // Barrel smoke: a few sprites that curl up off the muzzle after each shot and drift away.
    const smoke = smokeTexture();
    this.puffs = Array.from({ length: PUFFS }, () => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smoke, color: 0xb9b5ad, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false; sp.renderOrder = 4; this.root.add(sp);
      return { sp, life: 0, max: 1, v: V(0, 0, 0), size: 0, k: 1 };
    });
    this.puffI = 0; this.muzzleAt = V(0, 0, 0);
    this.t = 0; this.weapon = null; this.flashT = 0; this.adsBlend = 0; this.nadeBlend = 0;
    // Springs: position (x, y, z) and rotation (pitch, yaw, roll) offsets on the hold, plus the camera punch.
    this.sp = { x: new Spring(160), y: new Spring(140, 0.7), z: new Spring(260, 0.6), rx: new Spring(230, 0.58), ry: new Spring(170, 0.75), rz: new Spring(150, 0.62), swap: new Spring(90, 0.85) };
    this.cam = { pitch: new Spring(260, 1), yaw: new Spring(260, 1), roll: new Spring(120, 1) };
    this.bobPhase = 0; this.bobAmt = 0; this.throwT = -1; this.lastCharge = null;
    this.pose = [0, 0, 0, 0, 0]; this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.one = V(1, 1, 1); this.caseColor = new THREE.Color();
    this.handAt = V(0, 0, 0); this.nadeAt = V(0, 0, 0);
  }
  // The held weapon (and its skin). The whisk and the Cluck Bomb are made with the first gun, once
  // the models have loaded.
  setWeapon(id, skin = 0) {
    if (this.weapon === id && this.skin === skin) return;
    this.weapon = id; this.skin = skin;
    if (this.rig) { this.hold.remove(this.gun); this.rig.dispose(); }
    this.rig = new WeaponRig(id, skin, true); this.gun = this.rig.root; this.hold.add(this.gun);
    this.gun.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.hands = this.gun.getObjectByName('hands'); this.handsMat = this.hands.material;
    this.leftHand = this.gun.getObjectByName(this.rig.spec.left);
    const muzzle = this.gun.userData.muzzle;
    this.flash.position.copy(muzzle); this.flashLight.position.copy(muzzle).add(V(0, 0.02, 0.05));
    this.eject = EJECT[id] ? V(...EJECT[id]) : null;
    if (!this.whiskRig) {
      this.whiskRig = new WeaponRig('whisk'); this.whisk = this.whiskRig.root; this.whisk.visible = false;
      this.whisk.rotation.set(0.035, 0.14, 0, 'YXZ'); this.head.add(this.whisk);
      this.nade = gunModel('grenade'); this.nade.visible = false; this.root.add(this.nade);
    }
  }
  // A shot. From the hip the gun bucks: it slams back, the muzzle snaps up and twists, and the springs
  // overshoot as it settles. Aiming, it recoils almost straight back into the shoulder and the flash
  // shrinks, so the sights (and whatever they're on) stay in view. The rig's own fire clip works the
  // action underneath.
  fire(id) {
    this.rig?.fire();
    const r = RECOIL[id] || RECOIL.yolk47, a = this.adsBlend, twist = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
    // (Aimed, the zoom magnifies every movement, so the kick is a small shove straight back.)
    this.sp.z.v += r[0] * 62 * (1 - a * 0.88); this.sp.rx.v += r[1] * 58 * (1 - a * 0.95);
    this.sp.ry.v += rnd() * r[2] * 50 * (1 - a * 0.7); this.sp.rz.v += twist * r[3] * 60 * (1 - a * 0.65);
    this.sp.y.v += r[0] * 8 * (1 - a);
    this.cam.pitch.v += r[4] * 60 * (1 - a * 0.5); this.cam.yaw.v += rnd() * r[4] * 18 * (1 - a * 0.6);
    this.flashT = id === 'yolkzooka' ? 0.075 : id === 'doubleYolker' ? 0.06 : 0.045;
    const k = (FLASH[id] || 1) * (0.85 + Math.random() * 0.3) * (1 - a * 0.7);
    this.flashStar.scale.setScalar(0.2 * k); this.flashStar.material.rotation = Math.random() * Math.PI; this.flashStar.material.opacity = 1 - a * 0.45;
    this.flame.scale.set(0.32 * k, 0.22 * k, 0.32 * k * (1 - a * 0.4)); this.flame.rotation.z = Math.random() * Math.PI;
    if (this.eject) this.spawnCase(this.eject, id === 'peck9mm' ? 0.75 : 1, 0xd9a441);
    // Smoke off the muzzle (hardly any while aiming, so it never clouds the sights).
    const amt = (SMOKE[id] ?? 0.7) * (1 - a * 0.9);
    if (amt > 0.08) {
      this.flash.updateWorldMatrix(true, false); this.flash.getWorldPosition(this.muzzleAt);
      for (let i = amt > 1.5 ? 2 : 1; i > 0; i--) this.puff(this.muzzleAt, amt);
    }
  }
  // A mechanical moment of a reload: its sound, and a jolt through the springs.
  cue(sample, what) {
    this.onSound?.(sample);
    const k = KICK[what]; if (!k) return;
    this.sp.y.v += k[0]; this.sp.rx.v += k[1]; this.sp.z.v += k[2]; this.sp.rz.v += k[3] + rnd() * Math.abs(k[1]) * 0.15; this.cam.pitch.v += k[4];
    if (what === 'open' && this.weapon === 'doubleYolker') for (const dx of [-0.012, 0.012]) this.spawnCase(V(0.25 + dx, 0.05, -0.12), 2.2, 0xc8342a, 0.8);
    if (what === 'open' && this.weapon === 'poacher') this.spawnCase(V(0.28, 0.06, -0.18), 1.5, 0xd9a441);
  }

  puff(at, amt) {
    const p = this.puffs[this.puffI = (this.puffI + 1) % PUFFS];
    p.sp.position.copy(at).add(V(rnd() * 0.01, rnd() * 0.01, rnd() * 0.01));
    p.life = p.max = 0.55 + Math.random() * 0.5;
    // Up and back towards the shoulder, a little to the right: away from the crosshair.
    p.v.set(0.03 + Math.random() * 0.03, 0.05 + Math.random() * 0.05, 0.02 + Math.random() * 0.02);
    p.size = 0.05 * Math.sqrt(amt); p.k = Math.min(1, 0.45 + amt * 0.35);
    p.sp.material.rotation = Math.random() * Math.PI * 2; p.sp.visible = true;
  }
  stepSmoke(dt) {
    const fade = 1 - this.adsBlend * 0.85;
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sp.visible = false; p.sp.material.opacity = 0; continue; }
      const t = 1 - p.life / p.max;
      p.sp.position.addScaledVector(p.v, dt); p.v.multiplyScalar(Math.exp(-dt * 1.2)); p.v.y += dt * 0.04;
      const sz = p.size * (1 + t * 3.6); p.sp.scale.set(sz, sz, 1);
      p.sp.material.opacity = 0.6 * p.k * Math.min(1, t * 6) * (1 - t) * (1 - t) * fade;
      p.sp.material.rotation += dt * 0.5;
    }
  }
  // A case from a gun-space point, flung right, up and a little back, spinning.
  spawnCase(at, size, color, spread = 1) {
    if (!this.gun) return;
    this.hold.updateMatrixWorld(true);
    const c = this.casingList[this.ci = (this.ci + 1) % CASINGS];
    c.p.copy(at).applyMatrix4(this.hold.matrixWorld).applyMatrix4(this.m4.copy(this.root.matrixWorld).invert());
    c.v.set(1.1 + Math.random() * 0.5, 0.9 + Math.random() * 0.5, 0.25 + Math.random() * 0.2).multiplyScalar(spread);
    c.r.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); c.w.set(rnd() * 25, rnd() * 25, rnd() * 25);
    c.life = 0.55; c.s = size;
    this.casings.setColorAt(this.ci, this.caseColor.setHex(color)); this.casings.instanceColor.needsUpdate = true;
  }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  // The camera's recoil this frame: [pitch, yaw, roll] radians, springing back to rest.
  takePunch(dt) { return [this.cam.pitch.step(0, dt), this.cam.yaw.step(0, dt), this.cam.roll.step(0, dt)]; }
  // A melee swing that connected: the view jolts with the impact.
  meleeConnect() { this.cam.pitch.v -= 0.35; this.cam.yaw.v += 0.4; this.cam.roll.v -= 0.3; this.sp.x.v -= 0.4; }
  // A landing (fall speed in u/s): the gun dips and the camera nods.
  land(speed) { const k = Math.min(1, speed / 9); this.sp.y.v -= 0.5 * k; this.sp.rx.v -= 1.2 * k; this.cam.pitch.v -= 0.25 * k; }
  // Match the world's light: sun direction (camera space) and colours.
  light(sunDir, sunColor, sunIntensity, sky, ground) {
    this.sun.position.copy(sunDir); this.sun.color.copy(sunColor); this.sun.intensity = sunIntensity * 0.85;
    this.hemi.color.copy(sky); this.hemi.groundColor.copy(ground);
  }
  // s: { dt, speed (u/s), strafe (u/s, + right), vy (u/s), air, climbing, ads, scoped, reload: {f,long}|null,
  //      swap: 0..1|0, melee: 0..1|0, charge: 0..1|null, inspect: 0..1|0, shield, sprint, mouseDX, mouseDY, visible }
  update(s) {
    this.root.visible = s.visible;
    this.stepCasings(s.dt); this.stepSmoke(s.dt);
    if (!s.visible || !this.rig) return;
    const dt = s.dt; this.t += dt;
    // The clip: reload, inspect, a shot working the action, or rest.
    this.rig.update({ ...s, aim: this.adsBlend }, (sample, what) => this.cue(sample, what));
    // Aim blend: a quick ease, then smoothstepped so the sights settle rather than slide; the view
    // narrows to the gun's zoom with it.
    this.adsBlend += ((s.ads ? 1 : 0) - this.adsBlend) * Math.min(1, dt * 14);
    const a = ss(this.adsBlend), free = 1 - a * 0.88;
    const fov = viewFov(this.weapon, a);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Walk bob: a figure of eight in step with the egg's stride, gone in the air.
    const moving = Math.min(1, s.speed / 3.2) * (s.air ? 0.15 : 1);
    this.bobAmt += (moving - this.bobAmt) * Math.min(1, dt * 8);
    this.bobPhase += dt * (4 + s.speed * 1.6);
    const bx = Math.sin(this.bobPhase) * 0.011 * this.bobAmt * free, by = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * this.bobAmt * free;
    const broll = Math.sin(this.bobPhase) * 0.02 * this.bobAmt * free;
    // Breathing when still.
    const br = (1 - this.bobAmt) * free, bry = Math.sin(this.t * 1.6) * 0.0025 * br, brx = Math.sin(this.t * 0.8) * 0.008 * br;
    // Look sway: the gun lags behind the view and leans into turns; strafing leans it over.
    const swx = Math.max(-0.05, Math.min(0.05, -s.mouseDX * 0.00028)) * free, swy = Math.max(-0.05, Math.min(0.05, s.mouseDY * 0.00028)) * free;
    const lean = Math.max(-1, Math.min(1, (s.strafe || 0) / 3)) * free;
    // Jumping: the gun floats down as the egg rises and up as it falls; landing kicks it (main calls land()).
    const vyLag = s.climbing ? 0 : Math.max(-0.03, Math.min(0.03, -(s.vy || 0) * 0.004)) * free;
    const p = restPose(this.weapon, a, this.pose);
    const px = this.sp.x.step(swx + lean * 0.012, dt), py = this.sp.y.step(swy + vyLag, dt), pz = this.sp.z.step(0, dt);
    const rx0 = this.sp.rx.step(-swy * 3 + brx * 0.3, dt), ry0 = this.sp.ry.step(swx * 4, dt), rz0 = this.sp.rz.step(-lean * 0.09 + swx * 3, dt);
    let x = p[0] + bx + px, y = p[1] + by + py + bry, z = p[2] + pz;
    let rx = p[3] + rx0, ry = p[4] + ry0, rz = broll + rz0;
    // Sprinting: the gun drops and cants across the body, and the stride swings harder.
    this.sprintBlend = (this.sprintBlend || 0) + ((s.sprint && !s.reload ? 1 : 0) - (this.sprintBlend || 0)) * Math.min(1, dt * 9);
    const sb = ss(this.sprintBlend) * (1 - a);
    // (The gun turns about the head, so a little pitch goes a long way at the muzzle.)
    x += -sb * 0.02 + bx * sb * 1.2; y += -sb * 0.025 + by * sb; rx += -sb * 0.1; ry += sb * 0.38; rz += -sb * 0.22 + broll * sb * 2;
    // Swap: stow down and out to the right, the next gun rises with a little settle.
    const sw = this.sp.swap.step(s.swap ? (s.swap < 0.5 ? ss(s.swap * 2) : 1 - ss((s.swap - 0.5) * 2)) : 0, dt);
    y -= sw * 0.3; x += sw * 0.05; rx -= sw * 0.9; rz -= sw * 0.4;
    this.hold.position.set(x, y, z); this.hold.rotation.set(rx, ry, rz);
    // Melee: the gun is put away and the whisk's own swing plays, its blur (the swoosh) trailing the
    // strike as the view twists with it.
    const meleeing = s.melee > 0;
    this.whisk.visible = meleeing; this.swoosh.visible = false;
    if (meleeing) {
      const f = s.melee;
      this.whiskRig.update({ dt, melee: f, reload: null, inspect: 0 });
      const strike = snap(f, 0.16, 0.4), blur = bump(f, 0.14, 0.62);
      if (blur > 0) { this.swoosh.visible = true; this.swoosh.material.opacity = blur * 0.6; this.swoosh.rotation.z = (1 - strike) * 1.4 - 0.15; this.swoosh.scale.set(0.5 + strike * 0.12, 0.42 + strike * 0.1, 1); }
      if (this.lastMelee < 0.16 && f >= 0.16) { this.cam.roll.v -= 0.5; this.cam.yaw.v += 0.35; this.sp.rz.v += 1.5; }
      this.lastMelee = f;
    } else this.lastMelee = 0;
    // Grenade: the support hand leaves the gun to hold the bomb and draws it back with the charge;
    // release lobs it.
    const charging = s.charge !== null && s.charge !== undefined;
    if (!charging && this.lastCharge !== null) this.throwT = 0;
    this.lastCharge = charging ? s.charge : null;
    if (this.throwT >= 0) { this.throwT += dt; if (this.throwT > 0.3) this.throwT = -1; }
    this.nade.visible = charging || (this.throwT >= 0 && this.throwT < 0.12);
    this.nadeBlend += ((charging ? 1 : 0) - this.nadeBlend) * Math.min(1, dt * 18);
    if (charging) {
      const c = Math.max(0, s.charge);
      this.nadeAt.set(-0.2 + c * 0.04, -0.17 + c * 0.07, -0.42 + c * 0.1); this.nade.rotation.set(c * 0.5, 0, 0.3);
      this.hold.position.y -= 0.02 + c * 0.015; this.hold.rotation.x -= 0.04;
    } else if (this.throwT >= 0) {
      const t = this.throwT / 0.3;
      this.nadeAt.set(-0.16 + t * 0.05, -0.1 + t * 0.12, -0.32 - t * 0.5);
      this.hold.position.y -= 0.03 * (1 - t);
    }
    this.nade.position.copy(this.nadeAt);
    if (this.nadeBlend > 0.001) {
      // Steer the support hand's bone (the clip already posed it) towards the bomb.
      this.root.updateMatrixWorld(true);
      const bone = this.leftHand, from = bone.getWorldPosition(this.handAt), to = this.nade.getWorldPosition(V(0, 0, 0)).add(V(0, -0.03, 0.02));
      bone.position.copy(bone.parent.worldToLocal(from.lerp(to, this.nadeBlend)));
      bone.updateMatrixWorld(true);
    }
    const mat = s.shield ? this.shieldMat : this.handsMat;
    if (this.hands.material !== mat) this.hands.material = mat;
    // Scoped guns vanish under the scope once raised; the gun is away while the whisk swings.
    const hidden = s.scoped && this.adsBlend > 0.85;
    this.gun.visible = !hidden && !meleeing;
    if (this.flashT > 0) { this.flashT -= dt; this.flash.visible = this.gun.visible; this.flashLight.intensity = 5; }
    else { this.flash.visible = false; this.flashLight.intensity = 0; }
  }
  stepCasings(dt) {
    let any = false;
    for (let i = 0; i < CASINGS; i++) {
      const c = this.casingList[i];
      if (c.life <= 0) continue;
      c.life -= dt; any = true;
      if (c.life <= 0) { this.casings.setMatrixAt(i, this.m4.makeScale(0, 0, 0)); continue; }
      c.v.y -= 7 * dt; c.p.addScaledVector(c.v, dt);
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt;
      this.q.setFromEuler(c.r); this.one.setScalar(c.s * CASE_SIZE);
      this.casings.setMatrixAt(i, this.m4.compose(c.p, this.q, this.one));
    }
    if (any || this.casingsDirty) this.casings.instanceMatrix.needsUpdate = true;
    this.casingsDirty = any;
  }
}

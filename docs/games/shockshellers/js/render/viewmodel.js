// First-person hands (GDD §25): the floating mittens and the held gun, lower right. Drawn in its own
// scene and camera after the world, over a cleared depth buffer.
//
// The guns are modelled at real scale (a rifle is about a metre long), with empties marking the grip,
// the support hand, the sight line and the muzzle. Poses are computed from those anchors rather than
// hand-placed: at the hip the grip sits low right and the bore converges on the crosshair a few
// metres out; aiming puts the sight anchor exactly on the eye line at a short eye relief, so the
// iron sights line up for every gun. Everything that moves the gun (sway, bob, strafe lean, jumps
// and landings, recoil, swaps) runs through critically damped springs, so motion never snaps.
// Reloads are keyframed per kind of gun (magazine swap with the left mitten, break-open shotgun,
// bolt-action round, rocket into the tube; a reload from empty adds the charging handle or slide).
// Spent brass flies out of the ejection port; the muzzle flash is a star plus two crossed flames.
import * as THREE from '../../vendor/three/three.module.js?v=muylpzs7';
import { gunModel, LOADED_ONLY } from './guns.js?v=muylpzs7';
import { clone } from './models.js?v=muylpzs7';

// Hip hold per gun: where the grip anchor sits in camera space (metres). The bore is then turned to
// meet the view axis CONVERGE metres out, so every gun points where the crosshair does.
const HOLD = {
  yolk47: [0.15, -0.19, -0.42], beater: [0.145, -0.185, -0.4], triBoil: [0.15, -0.19, -0.42], cageFree: [0.15, -0.19, -0.44],
  poacher: [0.15, -0.195, -0.46], doubleYolker: [0.15, -0.19, -0.42], yolkzooka: [0.215, -0.25, -0.37], peck9mm: [0.12, -0.17, -0.38],
};
// Eye relief when aiming (how far in front of the eye the sight anchor sits): far enough that the
// receiver behind the sights frames them instead of filling the screen.
const SCALE = 0.64, CONVERGE = 7, RELIEF = { peck9mm: 0.26, doubleYolker: 0.17, yolkzooka: 0.16 }, RELIEF_DEFAULT = 0.17;
// Recoil per shot: [kick back (m), muzzle climb (rad), side jitter (rad), roll jitter (rad), camera punch (rad)].
const RECOIL = {
  yolk47: [0.032, 0.06, 0.018, 0.03, 0.004], beater: [0.024, 0.045, 0.02, 0.025, 0.003], triBoil: [0.03, 0.055, 0.015, 0.02, 0.004],
  peck9mm: [0.03, 0.13, 0.02, 0.05, 0.005], cageFree: [0.05, 0.1, 0.015, 0.03, 0.009], poacher: [0.085, 0.17, 0.02, 0.06, 0.016],
  doubleYolker: [0.095, 0.22, 0.03, 0.07, 0.016], yolkzooka: [0.11, 0.12, 0.02, 0.04, 0.016],
};
const FLASH = { doubleYolker: 1.6, yolkzooka: 1.8, poacher: 1.35, cageFree: 1.15, yolk47: 1, triBoil: 1, beater: 0.8, peck9mm: 0.75 };
// How each gun reloads.
export const RELOAD_KIND = { yolk47: 'mag', beater: 'mag', triBoil: 'mag', cageFree: 'mag', peck9mm: 'pistol', doubleYolker: 'break', poacher: 'bolt', yolkzooka: 'rocket' };

// Keyframe helpers: progress of f through [a,b] (clamped), smoothed; a bump that rises and falls in [a,b].
const ss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const seg = (f, a, b) => ss((f - a) / (b - a));
const bump = (f, a, b) => (f <= a || f >= b) ? 0 : Math.sin((f - a) / (b - a) * Math.PI);
// Snappy versions for reloads: fast out of the blocks and settling (snap), or overshooting a touch
// and springing back (pop). A move that starts fast reads as deliberate; smoothstep reads as slow motion.
const snap = (f, a, b) => { const t = Math.max(0, Math.min(1, (f - a) / (b - a))); return 1 - (1 - t) ** 3; };
const pop = (f, a, b) => { const t = Math.max(0, Math.min(1, (f - a) / (b - a))) - 1; return 1 + 2.2 * t * t * t + 1.2 * t * t; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp3 = (out, a, b, t) => out.copy(a).lerp(b, t);
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
// Where to put a hold group (scale k) so a gun-space point lands on the view axis `relief` metres in
// front of the eye with the gun level: pure, so the sight alignment is testable.
export function sightOnAxis(sight, k, relief, out = [0, 0, 0]) {
  out[0] = -sight.x * k; out[1] = -sight.y * k; out[2] = -relief - sight.z * k; return out;
}
// Yaw and pitch that turn a gun's bore (-z) from point p (camera space) towards the view axis `dist` out.
export function convergeAngles(p, dist) {
  const dx = -p[0], dy = -p[1], dz = -dist - p[2];
  return [Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz)];
}

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

const CASINGS = 24, PUFFS = 12;
// How much barrel smoke each gun leaves (a wisp per shot; sustained fire builds a haze).
const SMOKE = { doubleYolker: 2, yolkzooka: 2.6, poacher: 1.4, cageFree: 1.1, yolk47: 0.75, triBoil: 0.75, beater: 0.6, peck9mm: 0.55 };

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.5); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9); this.sun.position.set(-1, 2, 1); this.scene.add(this.sun);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.hold = new THREE.Group(); this.hold.rotation.order = 'YXZ'; this.hold.scale.setScalar(SCALE); this.root.add(this.hold);
    this.gloveMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, envMapIntensity: 0.6 });
    this.shieldMat = new THREE.MeshStandardMaterial({ color: 0x9cff9c, roughness: 0.5, emissive: 0x1a6b1a });
    this.gloveR = this.mitten(); this.gloveL = this.mitten();
    this.hold.add(this.gloveR, this.gloveL);
    this.whisk = gunModel('whisk'); this.whisk.visible = false; this.whisk.scale.setScalar(0.95); this.root.add(this.whisk);
    this.swoosh = swooshMesh(); this.swoosh.position.set(0.02, -0.17, -0.42); this.root.add(this.swoosh); this.lastMelee = 0;
    this.nade = gunModel('grenade'); this.nade.visible = false; this.root.add(this.nade);
    // Muzzle flash: a star facing the camera plus two crossed flame quads along the bore.
    this.flash = new THREE.Group(); this.flash.visible = false; this.hold.add(this.flash);
    const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
    this.flashStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), ...add })); this.flashStar.renderOrder = 5; this.flash.add(this.flashStar);
    const fg = new THREE.PlaneGeometry(1, 0.5).translate(0.5, 0, 0).rotateY(Math.PI / 2), fm = new THREE.MeshBasicMaterial({ map: flameTexture(), side: THREE.DoubleSide, ...add });
    this.flame = new THREE.Group(); this.flash.add(this.flame);
    for (let i = 0; i < 2; i++) { const p = new THREE.Mesh(fg, fm); p.rotation.z = i * Math.PI / 2; p.renderOrder = 5; this.flame.add(p); }
    this.flashLight = new THREE.PointLight(0xffb060, 0, 1.4, 2); this.hold.add(this.flashLight);
    // Spent brass (and red shotgun hulls): one instanced mesh, each case flying in camera space.
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
    this.t = 0; this.weapon = null; this.flashT = 0; this.adsBlend = 0;
    // Springs: position (x, y, z) and rotation (pitch, yaw, roll) offsets on the hold, plus the camera punch.
    this.sp = { x: new Spring(160), y: new Spring(140, 0.7), z: new Spring(260, 0.6), rx: new Spring(230, 0.58), ry: new Spring(170, 0.75), rz: new Spring(150, 0.62), swap: new Spring(90, 0.85) };
    this.cam = { pitch: new Spring(260, 1), yaw: new Spring(260, 1), roll: new Spring(120, 1) };
    this.bobPhase = 0; this.bobAmt = 0; this.wasAir = false; this.lastVy = 0; this.throwT = -1; this.lastCharge = null;
    // The spent magazine that falls away during a reload (a copy of the gun's own), and scratch vectors.
    this.dropMag = null; this.dropT = -1; this.tmp = V(0, 0, 0); this.tmp2 = V(0, 0, 0); this.handTarget = V(0, 0, 0); this.lastReloadF = 1;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.one = V(1, 1, 1); this.caseColor = new THREE.Color();
  }
  mitten() {
    const m = clone('glove');
    if (m) { m.traverse(o => { if (o.isMesh) { o.material = this.gloveMat; o.castShadow = false; } }); m.scale.setScalar(0.86); return m; }
    const g = new THREE.SphereGeometry(0.05, 18, 14); g.scale(1, 0.85, 1.25);
    return new THREE.Mesh(g, this.gloveMat);
  }
  setWeapon(id, skin = 'factory') {
    if (this.weapon === id && this.skin === skin) return;
    this.weapon = id; this.skin = skin;
    if (this.gun) this.hold.remove(this.gun);
    this.gun = gunModel(id, false, skin); this.hold.add(this.gun);
    this.gun.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
    const u = this.gun.userData;
    const grip = u.grip || V(0, -0.07, 0), support = u.support || V(0, -0.03, -0.25);
    // Mittens: the right one wraps the grip, the left one cups the support point from below.
    this.gloveR.position.copy(grip).add(V(0.012, 0, 0.01)); this.gloveR.rotation.set(-0.35, 0.15, -0.1);
    this.gloveL.position.copy(support).add(V(-0.015, -0.025, 0)); this.gloveL.rotation.set(-1.2, -0.2, 0.5);
    if (id === 'peck9mm') { this.gloveL.position.copy(grip).add(V(-0.035, -0.01, -0.01)); this.gloveL.rotation.set(-0.3, -0.5, 0.4); }
    // Hip: the grip at its spot, the bore turned to converge on the view axis.
    const g = HOLD[id] || HOLD.yolk47, [pitch, yaw] = convergeAngles(g, CONVERGE);
    this.hipRot = V(pitch, yaw, 0);
    const e = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    this.hipPos = V(...g).sub(grip.clone().multiplyScalar(SCALE).applyEuler(e));
    // Aiming: the sight anchor on the eye line, level, a little in front of the eye.
    const sight = u.sight || V(0, 0.06, 0.05);
    this.adsPos = V(...sightOnAxis(sight, SCALE, RELIEF[id] ?? RELIEF_DEFAULT));
    this.mag = u.mag; this.magHome = this.mag ? this.mag.position.clone() : null;
    this.gloveLRest = this.gloveL.position.clone(); this.gloveLRot = this.gloveL.rotation.clone();
    this.gloveRRest = this.gloveR.position.clone();
    if (this.dropMag) { this.hold.remove(this.dropMag); this.dropMag = null; }
    if (this.mag && !LOADED_ONLY.has(id)) { this.dropMag = this.mag.clone(true); this.dropMag.visible = false; this.hold.add(this.dropMag); }
    this.dropT = -1;
    if (this.mag && LOADED_ONLY.has(id)) this.mag.visible = false;
    this.flash.position.copy(u.muzzle);
    this.flashLight.position.copy(u.muzzle).add(V(0, 0.02, 0.05));
    this.eject = u.eject ? u.eject.clone() : null;
    // Moving parts: the slide or charging handle (kicks back with each shot), the shotgun's barrels
    // (break open to load), the sniper's bolt.
    this.slide = u.slide || null; this.slideHome = this.slide ? this.slide.position.clone() : null; this.slideTravel = u.slideTravel || 0; this.slideK = 0;
    this.hinge = u.hinge || null; this.bolt = u.bolt || null; this.boltHome = this.bolt ? this.bolt.position.clone() : null;
  }
  // A shot: recoil impulses (randomised a little per shot), the flash, a case out of the port.
  // A shot. From the hip the gun bucks: it slams back, the muzzle snaps up and twists, and the springs
  // overshoot as it settles. Aiming, it recoils almost straight back into the shoulder and the flash
  // shrinks, so the sights (and whatever they're on) stay in view.
  fire(id) {
    const r = RECOIL[id] || RECOIL.yolk47, a = this.adsBlend, twist = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
    this.sp.z.v += r[0] * 62 * (1 - a * 0.35); this.sp.rx.v += r[1] * 58 * (1 - a * 0.8);
    this.sp.ry.v += rnd() * r[2] * 50 * (1 - a * 0.7); this.sp.rz.v += twist * r[3] * 60 * (1 - a * 0.65);
    this.sp.y.v += r[0] * 8 * (1 - a);
    this.cam.pitch.v += r[4] * 60 * (1 - a * 0.5); this.cam.yaw.v += rnd() * r[4] * 18 * (1 - a * 0.6);
    this.flashT = id === 'yolkzooka' ? 0.075 : id === 'doubleYolker' ? 0.06 : 0.045;
    const k = (FLASH[id] || 1) * (0.85 + Math.random() * 0.3) * (1 - a * 0.7);
    this.flashStar.scale.setScalar(0.2 * k); this.flashStar.material.rotation = Math.random() * Math.PI; this.flashStar.material.opacity = 1 - a * 0.45;
    this.flame.scale.set(0.32 * k, 0.22 * k, 0.32 * k * (1 - a * 0.4)); this.flame.rotation.z = Math.random() * Math.PI;
    if (this.eject) this.spawnCase(this.eject, id === 'peck9mm' ? 0.75 : 1, 0xd9a441);
    this.slideK = 1;
    // Smoke off the muzzle (hardly any while aiming, so it never clouds the sights).
    const amt = (SMOKE[id] ?? 0.7) * (1 - a * 0.9);
    if (amt > 0.08) {
      this.flash.updateWorldMatrix(true, false); this.flash.getWorldPosition(this.muzzleAt);
      for (let i = amt > 1.5 ? 2 : 1; i > 0; i--) this.puff(this.muzzleAt, amt);
    }
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
    this.hold.updateMatrix();
    const c = this.casingList[this.ci = (this.ci + 1) % CASINGS];
    c.p.copy(at).applyMatrix4(this.hold.matrix);
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
  // Gun-space point → hold space, and back (the gun may be offset/rotated inside the hold group).
  toHold(v, out) { this.gun.updateMatrix(); return out.copy(v).applyMatrix4(this.gun.matrix); }
  toGun(v, out) { this.gun.updateMatrix(); return out.copy(v).applyMatrix4(this.tmpInv.copy(this.gun.matrix).invert()); }
  // One reload frame at progress f (0..1 of the real reload time): the gun's pose offset, where the
  // left mitten is, and what the magazine/shells/round/rocket are doing.
  reloadPose(f, long) {
    const kind = RELOAD_KIND[this.weapon] || 'mag', o = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, hand: null, slide: null, hinge: 0, boltUp: 0, boltBack: 0 };
    this.tmpInv = this.tmpInv || new THREE.Matrix4();
    const rest = this.gloveLRest, magHome = this.magHome;
    const below = V(-0.06, -0.32, 0.06);                      // off the bottom of the screen (fetching)
    if (f < this.lastReloadF - 0.5) { this.dropT = -1; this.ejected = false; }   // a new reload began
    if (kind === 'mag' || kind === 'pistol') {
      if (kind === 'pistol' && long && f < 0.76) o.slide = 1;   // locked back until it's racked
      // Tilt the gun to show the magazine well (overshooting into the pose and back out of it).
      const tilt = pop(f, 0, 0.1) * (1 - pop(f, long ? 0.89 : 0.85, long ? 0.99 : 0.96));
      // Bring it up and in, turned and rolled so the well (and the mitten working it) is in view.
      const P = kind === 'pistol';
      o.rz = -tilt * (P ? 0.72 : 0.82); o.rx = tilt * (P ? 0.3 : 0.2); o.ry = tilt * (P ? 0.3 : 0.36); o.y = tilt * (P ? 0.05 : 0.04); o.x = -tilt * (P ? 0.06 : 0.07); o.z = tilt * 0.02;
      // Follow-through: the gun lifts away as the old magazine is yanked, rolls further to watch the
      // hand fetch the new one, and dips to meet it just before it's slammed home.
      o.y += bump(f, 0.15, 0.3) * 0.018; o.rx += bump(f, 0.15, 0.3) * 0.06;
      const fetch = bump(f, 0.3, 0.6); o.rz -= fetch * 0.12; o.ry += fetch * 0.06; o.y -= fetch * 0.01;
      const meet = bump(f, 0.55, 0.67); o.y -= meet * 0.025; o.rx -= meet * 0.07;
      if (long) {
        // From empty: rolled back the other way to rack the slide or yank the charging handle.
        const rack = P ? bump(f, 0.7, 0.86) : bump(f, 0.71, 0.9);
        o.rz += rack * (P ? 0.5 : 0.6); o.ry -= rack * 0.2; o.x += rack * 0.03; o.rx += rack * 0.08;
      }
      const magIn = this.mag ? this.toHold(magHome, this.tmp) : rest;
      const grab = this.handTarget.copy(magIn).add(V(-0.01, -0.035, 0));
      const end = long ? 0.86 : 0.8;
      if (f < 0.12) o.hand = lerp3(V(0, 0, 0), rest, grab, snap(f, 0, 0.1));
      else if (f < 0.32) {                                      // yank the old magazine down and out
        const t = snap(f, 0.16, 0.24);
        o.hand = grab.clone().add(V(0, -0.09 * t, 0));
        if (this.mag) this.mag.position.copy(magHome).add(V(0, -0.09 * t / (this.gun.scale.y || 1), 0));
      } else if (f < 0.6) {                                     // let it drop; fetch a fresh one
        if (this.mag && this.dropT < 0 && this.lastReloadF < 0.32) { this.toHold(this.mag.position, this.tmp2); this.dropFrom = this.tmp2.clone(); this.dropT = 0; this.dropMag.quaternion.copy(this.gun.quaternion); this.dropMag.scale.copy(this.gun.scale); }
        if (this.mag) this.mag.visible = false;
        const t = f < 0.45 ? snap(f, 0.32, 0.42) : 1 - snap(f, 0.45, 0.57);
        o.hand = lerp3(V(0, 0, 0), grab.clone().add(V(0, -0.09, 0)), grab.clone().add(below), t);
        if (f >= 0.45 && this.mag) { this.mag.visible = true; this.toGun(o.hand.clone().add(V(0.01, 0.035, 0)), this.tmp); this.mag.position.copy(this.tmp); }
      } else if (f < 0.72) {                                    // line it up and seat it, with a bump
        const t = seg(f, 0.6, 0.68);
        o.hand = grab.clone().add(V(0, -0.06 * (1 - t), 0));
        if (this.mag) { this.mag.visible = true; this.mag.position.copy(magHome).add(V(0, -0.06 * (1 - t) / (this.gun.scale.y || 1), 0)); }
        o.rx -= bump(f, 0.66, 0.72) * 0.06; o.y += bump(f, 0.66, 0.72) * 0.014;
      } else if (long && kind === 'pistol' && f < end) {        // empty pistol: rack the slide (a sharp kick back)
        if (this.mag) this.mag.position.copy(magHome);
        o.hand = grab.clone(); o.z += bump(f, 0.74, 0.82) * 0.03; o.rx += bump(f, 0.74, 0.8) * 0.15;
        o.slide = 1 - seg(f, 0.76, 0.8);
      } else if (long && f < end) {                             // empty: work the charging handle
        if (this.mag) this.mag.position.copy(magHome);
        const side = this.toHold(this.handlePoint(), V(0, 0, 0));
        const pull = bump(f, 0.76, 0.84);
        o.hand = lerp3(V(0, 0, 0), grab, side, seg(f, 0.72, 0.76)).add(V(0, 0, 0.05 * pull));
        o.z += pull * 0.012; o.rx -= bump(f, 0.82, 0.86) * 0.06; o.slide = pull;
      } else {                                                  // back to the support hand
        if (this.mag) this.mag.position.copy(magHome);
        o.hand = lerp3(V(0, 0, 0), long && kind !== 'pistol' ? this.toHold(this.handlePoint(), V(0, 0, 0)) : grab, rest, snap(f, long ? end : 0.72, long ? 0.93 : 0.82));
      }
    } else if (kind === 'break') {
      // Break it open (muzzle drops), the spent hulls kick out, push two shells into the breech, snap
      // it shut with a flick.
      const open = pop(f, 0, 0.1) * (1 - snap(f, 0.77, 0.81)); o.hinge = open;
      // (muzzle down and turned in so the open breech faces you, kept low so the stock doesn't fill
      // the view; each shell is pushed in with a nudge; shut with an upward flick)
      const lift = pop(f, 0, 0.12) * (1 - pop(f, 0.8, 0.95));
      o.rx = -lift * 0.34; o.rz = -lift * 0.42; o.ry = lift * 0.14; o.y = -lift * 0.005; o.x = -lift * 0.04; o.z = -lift * 0.06;
      o.rx -= (bump(f, 0.47, 0.53) + bump(f, 0.6, 0.66)) * 0.05; o.y -= (bump(f, 0.47, 0.53) + bump(f, 0.6, 0.66)) * 0.008;
      o.rx += bump(f, 0.78, 0.9) * 0.3; o.y += bump(f, 0.78, 0.9) * 0.02;
      if (f > 0.14 && !this.ejected) { this.ejected = true; const b = this.mag ? magHome : V(0, 0.03, -0.02); for (const dx of [-0.024, 0.024]) this.spawnCase(V(b.x + dx, b.y, b.z + 0.04), 2.2, 0xc8342a, 0.8); }
      const breech = this.toHold(this.mag ? magHome : V(0, 0, 0.05), V(0, 0, 0));
      if (f < 0.4) o.hand = lerp3(V(0, 0, 0), rest, breech.clone().add(below), snap(f, 0.1, 0.3));
      else if (f < 0.7) o.hand = lerp3(V(0, 0, 0), breech.clone().add(below), breech.clone().add(V(0, -0.02, 0.01)), snap(f, 0.4, 0.58));
      else o.hand = lerp3(V(0, 0, 0), breech, rest, snap(f, 0.72, 0.86));
      if (this.mag) { this.mag.visible = f > 0.4 && f < 0.7; if (this.mag.visible) { this.toGun(o.hand.clone().add(V(0.005, 0.02, -0.01)), this.tmp); this.mag.position.copy(this.tmp); } }
    } else if (kind === 'bolt') {
      // Roll the rifle, bolt up and back (the spent case flies), thumb a round in, bolt forward and down.
      const roll = pop(f, 0, 0.11) * (1 - pop(f, 0.84, 0.97));
      o.rz = -roll * 0.72; o.rx = roll * 0.14; o.ry = roll * 0.32; o.y = roll * 0.05; o.x = -roll * 0.07;
      o.z += bump(f, 0.15, 0.3) * 0.03 - bump(f, 0.68, 0.8) * 0.03;
      o.rz -= bump(f, 0.42, 0.58) * 0.08; o.y -= bump(f, 0.42, 0.58) * 0.012;   // thumbing the round in
      o.boltUp = snap(f, 0.15, 0.18) * (1 - snap(f, 0.75, 0.78)); o.boltBack = snap(f, 0.2, 0.25) * (1 - snap(f, 0.68, 0.72));
      if (f > 0.24 && !this.ejected) { this.ejected = true; this.spawnCase(V(0.03, 0.05, 0.0), 1.5, 0xd9a441); }
      const port = this.toHold(this.mag ? magHome : V(0, 0.02, 0.05), V(0, 0, 0));
      if (f < 0.35) o.hand = lerp3(V(0, 0, 0), rest, port.clone().add(below), snap(f, 0.1, 0.3));
      else if (f < 0.65) o.hand = lerp3(V(0, 0, 0), port.clone().add(below), port.clone().add(V(-0.01, 0.01, 0)), snap(f, 0.35, 0.55));
      else o.hand = lerp3(V(0, 0, 0), port, rest, snap(f, 0.66, 0.82));
      if (this.mag) { this.mag.visible = f > 0.35 && f < 0.64; if (this.mag.visible) { this.toGun(o.hand.clone().add(V(0.01, 0.02, 0)), this.tmp); this.mag.position.copy(this.tmp); } }
    } else {
      // Rocket: lower the tube, bring a rocket up to the muzzle and slide it in.
      const lower = pop(f, 0, 0.14) * (1 - pop(f, 0.8, 0.94));
      // (the launcher swings down off the shoulder and tips its mouth up and across to the mitten,
      // takes the rocket with a shove, and swings back up loaded)
      o.y = -lower * 0.12; o.x = -lower * 0.1; o.rx = lower * 0.5; o.rz = -lower * 0.62; o.ry = lower * 0.3; o.z = lower * 0.04;
      o.y -= bump(f, 0.56, 0.66) * 0.025; o.rx -= bump(f, 0.56, 0.66) * 0.08;
      const mouth = this.toHold(this.gun.userData.muzzle || V(0, 0, -0.4), V(0, 0, 0));
      if (f < 0.4) o.hand = lerp3(V(0, 0, 0), rest, mouth.clone().add(below), snap(f, 0.1, 0.34));
      else if (f < 0.72) o.hand = lerp3(V(0, 0, 0), mouth.clone().add(below), mouth.clone().add(V(0, 0, 0.12)), seg(f, 0.4, 0.66));
      else o.hand = lerp3(V(0, 0, 0), mouth, rest, snap(f, 0.74, 0.9));
      o.rx -= bump(f, 0.66, 0.74) * 0.05;
      if (this.mag) { this.mag.visible = f > 0.4 && f < 0.7; if (this.mag.visible) { this.toGun(o.hand.clone().add(V(0, 0.02, -0.04)), this.tmp); this.mag.position.copy(this.tmp); } }
    }
    // Never let the mitten come right up to the lens.
    if (o.hand) o.hand.z = Math.min(o.hand.z, 0.04);
    this.reloadKicks(kind, f, long);
    this.lastReloadF = f;
    return o;
  }
  // The hits of a reload: each mechanical moment (a magazine yanked out or slammed home, a breech
  // snapped shut, a bolt or slide released) kicks the gun's springs and nudges the camera, so the gun
  // jolts and springs back instead of gliding between poses.
  reloadKicks(kind, f, long) {
    const was = this.lastReloadF > f + 0.5 ? -1 : this.lastReloadF, at = k => was < k && f >= k;
    const sp = this.sp, cam = this.cam, kick = (y, rx, z = 0, rz = 0, pitch = 0) => {
      sp.y.v += y; sp.rx.v += rx; sp.z.v += z; sp.rz.v += rz + rnd() * Math.abs(rx) * 0.3; cam.pitch.v += pitch;
    };
    if (kind === 'mag' || kind === 'pistol') {
      if (at(0.16)) kick(-0.25, -1.4, 0, 0.6);                     // magazine yanked out
      if (at(0.66)) kick(0.55, 2.6, 0.12, -0.8, 0.07);             // fresh one slammed home
      if (long && kind === 'pistol' && at(0.79)) kick(0.3, 3.2, 0.35, 0, 0.1); // slide slams forward
      if (long && kind !== 'pistol' && at(0.84)) kick(0.25, 2, 0.3, 0.5, 0.06); // charging handle let go
    } else if (kind === 'break') {
      if (at(0.04)) kick(-0.3, -2.2, 0, 0.8);                      // broken open
      if (at(0.6)) kick(0.15, 0.8);                                // shells pushed in
      if (at(0.78)) kick(0.6, 4, 0.2, -1, 0.12);                   // snapped shut
    } else if (kind === 'bolt') {
      if (at(0.16)) kick(0.15, 0.8, 0, 0.6);                       // bolt up
      if (at(0.21)) kick(0, 0.4, 0.3);                             // and back
      if (at(0.68)) kick(0, -0.6, -0.4, 0, 0.04);                  // rammed forward
      if (at(0.76)) kick(0.2, 1.8, 0, -0.6, 0.05);                 // and locked down
    } else {
      if (at(0.62)) kick(0.5, 2.4, 0.25, 0, 0.08);                 // rocket seated
      if (at(0.82)) kick(0.4, 1.5, 0, 0.4, 0.04);                  // shouldered again
    }
  }
  // Where the charging handle / slide is grabbed: just above and behind the grip.
  handlePoint() { const u = this.gun.userData, g = u.grip || V(0, -0.07, 0); return this.weapon === 'peck9mm' ? V(g.x - 0.01, g.y + 0.07, g.z - 0.03) : V(g.x - 0.03, g.y + 0.08, g.z - 0.1); }
  // s: { dt, speed (u/s), strafe (u/s, + right), vy (u/s), air, climbing, ads, scoped, reload: {f,long}|null,
  //      swap: 0..1|0, melee: 0..1|0, charge: 0..1|null, inspect: 0..1|0, shield, mouseDX, mouseDY, visible }
  update(s) {
    this.root.visible = s.visible;
    this.stepCasings(s.dt); this.stepSmoke(s.dt);
    if (!s.visible || !this.gun) { this.wasAir = false; return; }
    const dt = s.dt; this.t += dt;
    // Aim blend: a quick ease, then smoothstepped so the sights settle rather than slide.
    this.adsBlend += ((s.ads ? 1 : 0) - this.adsBlend) * Math.min(1, dt * 14);
    const a = ss(this.adsBlend), free = 1 - a * 0.88;
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
    const p = this.tmp.copy(this.hipPos).lerp(this.adsPos, a);
    const px = this.sp.x.step(swx + lean * 0.012, dt), py = this.sp.y.step(swy + vyLag, dt), pz = this.sp.z.step(0, dt);
    const rx0 = this.sp.rx.step(-swy * 3 + brx * 0.3, dt), ry0 = this.sp.ry.step(swx * 4, dt), rz0 = this.sp.rz.step(-lean * 0.09 + swx * 3, dt);
    let x = p.x + bx + px, y = p.y + by + py + bry, z = p.z + pz;
    let rx = this.hipRot.x * (1 - a) + rx0, ry = this.hipRot.y * (1 - a) + ry0, rz = broll + rz0;
    let hand = null, R = null; // where the left mitten goes this frame (hold space), if it leaves its rest
    if (s.reload) {
      R = this.reloadPose(Math.min(1, Math.max(0, s.reload.f)), s.reload.long);
      x += R.x; y += R.y; z += R.z; rx += R.rx; ry += R.ry; rz += R.rz; hand = R.hand;
    } else {
      if (this.mag) { this.mag.position.copy(this.magHome); this.mag.visible = !LOADED_ONLY.has(this.weapon); }
      this.lastReloadF = 1;
    }
    // Moving parts: the slide snaps back with a shot and eases home (an empty pistol's stays locked
    // back), the shotgun breaks open, the bolt lifts and draws back.
    this.slideK = Math.max(0, this.slideK - dt * 16);
    if (this.slide) {
      let k = this.slideK > 0.75 ? (1 - this.slideK) / 0.25 : this.slideK / 0.75;
      if (R && R.slide !== null) k = R.slide;
      else if (s.empty && !R && this.weapon === 'peck9mm') k = 1;
      this.slide.position.copy(this.slideHome); this.slide.position.z += this.slideTravel * k;
    }
    if (this.hinge) this.hinge.rotation.x = -(R ? R.hinge : 0) * 0.55;
    if (this.bolt) { this.bolt.rotation.z = (R ? R.boltUp : 0) * 1.1; this.bolt.position.copy(this.boltHome); this.bolt.position.z += (R ? R.boltBack : 0) * 0.07; }
    // Sprinting: the gun drops and cants across the body, and the stride swings harder.
    this.sprintBlend = (this.sprintBlend || 0) + ((s.sprint && !s.reload ? 1 : 0) - (this.sprintBlend || 0)) * Math.min(1, dt * 9);
    const sb = ss(this.sprintBlend) * (1 - a);
    x += -sb * 0.035 + bx * sb * 1.2; y += -sb * 0.055 + by * sb; rx += -sb * 0.32; ry += sb * 0.55; rz += -sb * 0.28 + broll * sb * 2;
    // Swap: stow down and out to the right, the next gun rises with a little settle.
    const sw = this.sp.swap.step(s.swap ? (s.swap < 0.5 ? ss(s.swap * 2) : 1 - ss((s.swap - 0.5) * 2)) : 0, dt);
    y -= sw * 0.3; x += sw * 0.05; rx -= sw * 0.9; rz -= sw * 0.4;
    if (s.inspect) { const f = s.inspect, e = bump(f, 0, 1); ry += e * 1.0; rz += Math.sin(f * Math.PI * 2) * 0.35 * e; x -= e * 0.05; y += e * 0.03; rx += e * 0.15; }
    this.hold.position.set(x, y, z); this.hold.rotation.set(rx, ry, rz);
    // The left mitten: at rest on the support, or following the reload's hand path.
    if (hand) { this.gloveL.position.lerp(hand, Math.min(1, dt * 30)); this.gloveL.rotation.set(-0.6, -0.1, 0.9); }
    else { this.gloveL.position.lerp(this.gloveLRest, Math.min(1, dt * 20)); this.gloveL.rotation.copy(this.gloveLRot); }
    // The spent magazine falls out of view, tumbling.
    if (this.dropMag && this.dropT >= 0) {
      this.dropT += dt; const t = this.dropT;
      this.dropMag.visible = t < 0.6;
      this.dropMag.position.set(this.dropFrom.x - t * 0.05, this.dropFrom.y - 1.6 * t * t - t * 0.15, this.dropFrom.z + t * 0.04);
      this.dropMag.rotation.set(t * 3, 0, t * 1.5);
      if (t >= 0.6) this.dropT = -1;
    }
    // Melee: a quick backhand with the whisk. The gun drops away down-left; the whisk cocks back over
    // the right shoulder, whips across the middle of the view in a blur (the swoosh) as the view twists
    // with it, then snaps back down out of sight.
    this.whisk.visible = s.melee > 0; this.swoosh.visible = false;
    if (s.melee > 0) {
      const f = s.melee, out = Math.sin(Math.min(1, f * 1.2) * Math.PI);
      this.hold.position.y -= out * 0.24; this.hold.position.x -= out * 0.09; this.hold.rotation.z += out * 0.65; this.hold.rotation.x -= out * 0.3;
      const cock = snap(f, 0, 0.16), strike = snap(f, 0.16, 0.4), back = snap(f, 0.5, 0.85);
      // Keyframes [x, y, z, rx, ry, rz]: entering, cocked over the right shoulder, struck across to the
      // left (head first, the handle never points at the lens), dropped away out of sight.
      const P = [[0.32, -0.34, -0.34, -0.5, -1.0, -2.4], [0.26, -0.07, -0.36, -0.5, -1.0, -2.1], [-0.24, -0.16, -0.38, -0.5, -1.0, 0.15], [-0.18, -0.5, -0.3, -0.6, -1.0, 0.5]];
      const w = lerpA(lerpA(lerpA(P[0], P[1], cock), P[2], strike), P[3], back);
      this.whisk.position.set(w[0], w[1], w[2]); this.whisk.rotation.set(w[3], w[4], w[5]);
      // The swoosh trails the strike: it sweeps round with the whisk and fades as the swing finishes.
      const blur = bump(f, 0.14, 0.62);
      if (blur > 0) { this.swoosh.visible = true; this.swoosh.material.opacity = blur * 0.6; this.swoosh.rotation.z = (1 - strike) * 1.4 - 0.15; this.swoosh.scale.set(0.5 + strike * 0.12, 0.42 + strike * 0.1, 1); }
      if (this.lastMelee < 0.16 && f >= 0.16) { this.cam.roll.v -= 0.5; this.cam.yaw.v += 0.35; this.sp.rz.v += 1.5; }
      this.lastMelee = f;
    } else this.lastMelee = 0;
    // Grenade: the left mitten holds the bomb and draws it back with the charge; release lobs it.
    const charging = s.charge !== null && s.charge !== undefined;
    if (!charging && this.lastCharge !== null) this.throwT = 0;
    this.lastCharge = charging ? s.charge : null;
    if (this.throwT >= 0) { this.throwT += dt; if (this.throwT > 0.3) this.throwT = -1; }
    this.nade.visible = charging || (this.throwT >= 0 && this.throwT < 0.12);
    if (charging) {
      const c = Math.max(0, s.charge);
      this.nade.position.set(-0.15 + c * 0.03, -0.12 + c * 0.08, -0.28 + c * 0.1); this.nade.rotation.set(c * 0.5, 0, 0.3);
      this.hold.position.y -= 0.05 + c * 0.03; this.hold.rotation.x -= 0.1;
    } else if (this.throwT >= 0) {
      const t = this.throwT / 0.3;
      this.nade.position.set(-0.12 + t * 0.05, -0.04 + t * 0.12, -0.25 - t * 0.5);
      this.hold.position.y -= 0.08 * (1 - t);
    }
    const mat = s.shield ? this.shieldMat : this.gloveMat;
    for (const gl of [this.gloveR, this.gloveL]) gl.traverse(o => { if (o.isMesh && o.material !== mat) o.material = mat; });
    // Scoped guns vanish under the scope once raised.
    const hidden = s.scoped && this.adsBlend > 0.85;
    this.gun.visible = this.gloveR.visible = !hidden;
    this.gloveL.visible = !hidden && !this.nade.visible;
    if (this.flashT > 0) { this.flashT -= dt; this.flash.visible = !hidden; this.flashLight.intensity = 5; }
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
      this.q.setFromEuler(c.r); this.one.setScalar(c.s * SCALE);
      this.casings.setMatrixAt(i, this.m4.compose(c.p, this.q, this.one));
    }
    if (any || this.casingsDirty) this.casings.instanceMatrix.needsUpdate = true;
    this.casingsDirty = any;
  }
}

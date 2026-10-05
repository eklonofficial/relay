// First-person hands (GDD §25): the floating mittens and the held gun, lower right. Bob scales with
// speed (doubled jumping or climbing), shots kick it back and up (and punch the camera a little), the
// muzzle flashes at the gun's real muzzle, aiming brings the gun's own sight onto the eye line,
// reloads dip and tilt it while the magazine drops and comes back (the long reload adds a slap),
// swaps lower it out and back, the whisk swings across, inspect turns it over.
// Drawn in its own scene and camera after the world, over a cleared depth buffer.
import * as THREE from '../../vendor/three/three.module.js?v=muv8vpk2';
import { gunModel } from './guns.js?v=muv8vpk2';
import { clone } from './models.js?v=muv8vpk2';

// Where each gun sits at the hip (metres in camera space), and how hard it kicks.
const HIP = { yolk47: [0.16, -0.17, -0.36], doubleYolker: [0.16, -0.18, -0.35], cageFree: [0.16, -0.17, -0.38], yolkzooka: [0.2, -0.22, -0.38], beater: [0.15, -0.16, -0.32], poacher: [0.16, -0.17, -0.4], triBoil: [0.16, -0.17, -0.36], peck9mm: [0.15, -0.15, -0.3] };
const KICK = { yolk47: 0.45, doubleYolker: 1, cageFree: 0.8, yolkzooka: 1, beater: 0.32, poacher: 1, triBoil: 0.4, peck9mm: 0.55 };
// Parts that only exist while loading (shotgun shells, the sniper round, the rocket).
const LOADED_ONLY = new Set(['doubleYolker', 'poacher', 'yolkzooka']);

function starTexture() {
  const c = new OffscreenCanvas(128, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.25, 'rgba(255,220,120,0.9)'); g.addColorStop(1, 'rgba(255,140,30,0)');
  x.fillStyle = g;
  x.beginPath();
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, r = i % 2 ? 22 : 64; x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  x.closePath(); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.7));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.7); this.sun.position.set(-1, 2, 1); this.scene.add(this.sun);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.hold = new THREE.Group(); this.hold.scale.setScalar(0.85); this.root.add(this.hold);
    this.gloveMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    this.shieldMat = new THREE.MeshStandardMaterial({ color: 0x9cff9c, roughness: 0.5, emissive: 0x1a6b1a });
    this.gloveR = this.mitten(); this.gloveL = this.mitten();
    this.hold.add(this.gloveR, this.gloveL);
    this.whisk = gunModel('whisk'); this.whisk.visible = false; this.whisk.scale.setScalar(1.2); this.root.add(this.whisk);
    this.nade = gunModel('grenade'); this.nade.visible = false; this.root.add(this.nade);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.flash.visible = false; this.flash.renderOrder = 5; this.hold.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffc070, 0, 1.2, 2); this.hold.add(this.flashLight);
    this.t = 0; this.kick = 0; this.swayX = 0; this.swayY = 0; this.weapon = null; this.flashT = 0; this.punch = 0; this.adsBlend = 0;
  }
  mitten() {
    const m = clone('glove');
    if (m) { m.traverse(o => { if (o.isMesh) o.material = this.gloveMat; }); return m; }
    const g = new THREE.SphereGeometry(0.05, 18, 14); g.scale(1, 0.85, 1.25);
    return new THREE.Mesh(g, this.gloveMat);
  }
  setWeapon(id) {
    if (this.weapon === id) return;
    this.weapon = id;
    if (this.gun) this.hold.remove(this.gun);
    this.gun = gunModel(id); this.hold.add(this.gun);
    this.gun.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    const u = this.gun.userData;
    const grip = u.grip || new THREE.Vector3(0, -0.07, 0), support = u.support || new THREE.Vector3(0, -0.03, -0.25);
    // Mittens: the right one wraps the grip, the left one cups the support point from below.
    this.gloveR.position.copy(grip).add(new THREE.Vector3(0.012, 0, 0.01)); this.gloveR.rotation.set(-0.35, 0.15, -0.1);
    this.gloveL.position.copy(support).add(new THREE.Vector3(-0.015, -0.025, 0)); this.gloveL.rotation.set(-1.2, -0.2, 0.5);
    if (id === 'peck9mm') { this.gloveL.position.copy(grip).add(new THREE.Vector3(-0.035, -0.01, -0.01)); this.gloveL.rotation.set(-0.3, -0.5, 0.4); }
    this.hip = new THREE.Vector3(...(HIP[id] || HIP.yolk47));
    // Aiming: put the gun's sight point on the eye line, a little in front of the eye.
    const sight = u.sight || new THREE.Vector3(0, 0.06, 0.05);
    // The sight line runs just above the rear sight, which sits a hand's length in front of the eye.
    this.adsPos = new THREE.Vector3(-sight.x, -sight.y - 0.016, -0.17 - sight.z);
    this.mag = u.mag; this.magHome = this.mag ? this.mag.position.clone() : null;
    if (this.mag && LOADED_ONLY.has(id)) this.mag.visible = false;
    this.flash.position.copy(u.muzzle).add(new THREE.Vector3(0, 0, -0.04));
    this.flashLight.position.copy(this.flash.position);
  }
  fire(id) {
    this.kick = Math.min(1.2, this.kick + (KICK[id] ?? 0.5));
    this.punch = Math.min(0.06, this.punch + (KICK[id] ?? 0.5) * 0.012);
    this.flashT = id === 'yolkzooka' ? 0.08 : 0.05;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.scale.setScalar((id === 'doubleYolker' || id === 'yolkzooka' ? 0.28 : id === 'peck9mm' || id === 'beater' ? 0.14 : 0.18) * (0.85 + Math.random() * 0.3));
  }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  // The camera's recoil punch this frame (radians of upward kick), recovering quickly.
  takePunch(dt) { const p = this.punch; this.punch = Math.max(0, this.punch - dt * 0.35); return p; }
  // s: { dt, speed (u/s), air, climbing, ads, scoped, reload: {f,long}|null, swap: 0..1|0, melee: 0..1|0,
  //      charge: 0..1|null, inspect: 0..1|0, shield, mouseDX, mouseDY, visible }
  update(s) {
    this.root.visible = s.visible;
    if (!s.visible || !this.gun) return;
    this.t += s.dt;
    const a = this.adsBlend = this.adsBlend + ((s.ads ? 1 : 0) - this.adsBlend) * Math.min(1, s.dt * 16);
    const bobK = Math.min(1, s.speed / 2) * (s.air || s.climbing ? 2 : 1) * (1 - a * 0.85);
    const ph = this.t * 9;
    const bx = Math.sin(ph) * 0.008 * bobK, by = -Math.abs(Math.cos(ph)) * 0.008 * bobK;
    // The gun lags the view slightly when looking around.
    this.swayX += (-s.mouseDX * 0.00035 * (1 - a * 0.8) - this.swayX) * Math.min(1, s.dt * 12);
    this.swayY += (s.mouseDY * 0.00035 * (1 - a * 0.8) - this.swayY) * Math.min(1, s.dt * 12);
    this.kick = Math.max(0, this.kick - s.dt * 8);
    const k = this.kick;
    const p = this.hip.clone().lerp(this.adsPos, a);
    let x = p.x + bx + this.swayX, y = p.y + by + this.swayY, z = p.z + k * 0.045 * (1 - a * 0.5);
    let rx = k * 0.12 * (1 - a * 0.6), ry = -0.05 * (1 - a), rz = 0;
    if (s.reload) {
      const f = Math.min(1, s.reload.f), dip = Math.sin(f * Math.PI);
      y -= dip * 0.07; rz += dip * 0.5; rx += dip * 0.2;
      if (s.reload.long && f > 0.65 && f < 0.9) rx -= Math.sin((f - 0.65) / 0.25 * Math.PI) * 0.2; // the slap / bolt
      // The magazine drops out and comes back in; shells and rounds appear while loading.
      if (this.mag) {
        if (LOADED_ONLY.has(this.weapon)) this.mag.visible = f > 0.3 && f < 0.75;
        else this.mag.position.y = this.magHome.y - (f < 0.5 ? Math.min(1, f / 0.25) : Math.max(0, (0.8 - f) / 0.3)) * 0.12;
      }
    } else if (this.mag) { this.mag.position.copy(this.magHome); if (LOADED_ONLY.has(this.weapon)) this.mag.visible = false; }
    if (s.swap) { const f = s.swap, d = f < 0.5 ? f * 2 : (1 - f) * 2; y -= d * 0.25; rx -= d * 0.6; }
    if (s.inspect) { const f = s.inspect; ry += Math.sin(f * Math.PI) * 1.2; rz += Math.sin(f * Math.PI * 2) * 0.3; }
    this.hold.position.set(x, y, z); this.hold.rotation.set(rx, ry, rz);
    // Melee: the gun drops, the whisk sweeps across.
    this.whisk.visible = s.melee > 0;
    if (s.melee > 0) {
      const f = s.melee;
      this.hold.position.y -= Math.sin(Math.min(1, f * 1.5) * Math.PI) * 0.18;
      this.whisk.position.set(0.22 - f * 0.4, -0.13 + Math.sin(f * Math.PI) * 0.06, -0.3);
      this.whisk.rotation.set(-0.6, 0.5 - f * 1.4, -0.8 + f * 0.6);
    }
    // Grenade wind-up: the left mitten draws the bomb back.
    this.nade.visible = s.charge !== null && s.charge !== undefined;
    if (this.nade.visible) { const c = Math.max(0, s.charge); this.nade.position.set(-0.13 + c * 0.03, -0.1 + c * 0.07, -0.24 + c * 0.08); }
    const mat = s.shield ? this.shieldMat : this.gloveMat;
    for (const gl of [this.gloveR, this.gloveL]) gl.traverse(o => { if (o.isMesh && o.material !== mat) o.material = mat; });
    // Scoped guns vanish under the scope once raised.
    const hidden = s.scoped && a > 0.85;
    this.gun.visible = this.gloveR.visible = !hidden;
    this.gloveL.visible = !hidden && !this.nade.visible;
    if (this.flashT > 0) { this.flashT -= s.dt; this.flash.visible = !hidden; this.flashLight.intensity = 4; }
    else { this.flash.visible = false; this.flashLight.intensity = 0; }
  }
}

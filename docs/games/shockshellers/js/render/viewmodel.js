// First-person hands: the floating gloves and the held gun, lower right (GDD §25). Bob scales with
// speed (doubled jumping or climbing), shots kick it back, reloads dip and tilt it (the long reload
// adds a slap), swaps lower it out and back, the whisk swings across, inspect turns it over.
// Drawn in its own scene and camera after the world, over a cleared depth buffer.
import * as THREE from '../../vendor/three/three.module.js?v=muv6kjqg';
import { gunModel } from './guns.js?v=muv6kjqg';

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 1.6));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6); this.sun.position.set(-1, 2, 1); this.scene.add(this.sun);
    this.root = new THREE.Group(); this.root.scale.setScalar(0.62); this.scene.add(this.root);
    this.hold = new THREE.Group(); this.root.add(this.hold);
    const gm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 });
    this.shieldMat = new THREE.MeshStandardMaterial({ color: 0x9cff9c, roughness: 0.5, emissive: 0x1a6b1a });
    const gg = new THREE.SphereGeometry(0.05, 18, 14); gg.scale(1, 0.85, 1.25);
    this.gloveR = new THREE.Mesh(gg, gm); this.gloveL = new THREE.Mesh(gg, gm);
    this.hold.add(this.gloveR, this.gloveL);
    this.whisk = gunModel('whisk'); this.whisk.visible = false; this.whisk.scale.setScalar(1.6); this.root.add(this.whisk);
    this.nade = gunModel('grenade'); this.nade.visible = false; this.root.add(this.nade);
    this.gloveMat = gm;
    this.t = 0; this.kick = 0; this.kickRot = 0; this.swayX = 0; this.swayY = 0; this.weapon = null;
  }
  setWeapon(id) {
    if (this.weapon === id) return;
    this.weapon = id;
    if (this.gun) this.hold.remove(this.gun);
    this.gun = gunModel(id); this.hold.add(this.gun);
    const pistol = id === 'peck9mm', rocket = id === 'yolkzooka';
    this.gun.position.set(0, 0, 0);
    this.gloveR.position.set(0, -0.07, 0.04);
    this.gloveL.position.set(-0.02, -0.03, pistol ? 0.02 : rocket ? -0.3 : -0.25);
    this.base = rocket ? new THREE.Vector3(0.3, -0.3, -0.62) : pistol ? new THREE.Vector3(0.3, -0.3, -0.6) : new THREE.Vector3(0.32, -0.3, -0.56);
  }
  fire(id) { this.kick = Math.min(1, this.kick + (id === 'poacher' || id === 'yolkzooka' ? 1 : id === 'doubleYolker' ? 0.9 : 0.45)); }
  resize(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
  // s: { dt, speed (u/s), air, climbing, ads, reload: {f,long}|null, swap: 0..1|0, melee: 0..1|0,
  //      charge: 0..1|null, inspect: 0..1|0, shield, mouseDX, mouseDY, visible }
  update(s) {
    this.root.visible = s.visible;
    if (!s.visible || !this.gun) return;
    this.t += s.dt;
    const bobK = Math.min(1, s.speed / 2) * (s.air || s.climbing ? 2 : 1) * (s.ads ? 0.25 : 1);
    const ph = this.t * 9;
    const bx = Math.sin(ph) * 0.012 * bobK, by = -Math.abs(Math.cos(ph)) * 0.012 * bobK;
    // Mouse sway lags the view a little.
    this.swayX += (-s.mouseDX * 0.0006 - this.swayX) * Math.min(1, s.dt * 10);
    this.swayY += (s.mouseDY * 0.0006 - this.swayY) * Math.min(1, s.dt * 10);
    this.kick = Math.max(0, this.kick - s.dt * 7);
    const k = this.kick;
    const base = this.base;
    // Aiming brings the gun to the centre line (scoped guns are hidden under the scope overlay).
    const adsK = s.ads ? 1 : 0;
    this.adsBlend = (this.adsBlend || 0) + (adsK - (this.adsBlend || 0)) * Math.min(1, s.dt * 14);
    const a = this.adsBlend;
    let x = base.x * (1 - a) + bx + this.swayX, y = base.y * (1 - a) + (-0.12) * a + by + this.swayY, z = base.z + k * 0.06 + a * 0.05;
    let rx = k * 0.25, ry = 0, rz = 0;
    if (s.reload) {
      const f = s.reload.f, dip = Math.sin(Math.min(1, f) * Math.PI);
      y -= dip * 0.12; rz += dip * 0.6; rx += dip * 0.25;
      if (s.reload.long && f > 0.6 && f < 0.85) rx -= Math.sin((f - 0.6) / 0.25 * Math.PI) * 0.25; // slap
    }
    if (s.swap) { const f = s.swap; const d = f < 0.5 ? f * 2 : (1 - f) * 2; y -= d * 0.35; rx -= d * 0.6; }
    if (s.inspect) { const f = s.inspect; ry += Math.sin(f * Math.PI) * 1.4; rz += Math.sin(f * Math.PI * 2) * 0.3; }
    this.hold.position.set(x, y, z); this.hold.rotation.set(rx, ry, rz);
    // Melee: the gun drops, the whisk sweeps from right to left.
    this.whisk.visible = s.melee > 0;
    if (s.melee > 0) {
      const f = s.melee;
      this.hold.position.y -= Math.sin(Math.min(1, f * 1.5) * Math.PI) * 0.25;
      this.whisk.position.set(0.32 - f * 0.55, -0.2 + Math.sin(f * Math.PI) * 0.1, -0.4);
      this.whisk.rotation.set(-0.3, 0.6 - f * 1.4, -0.8 + f * 0.6);
    }
    // Grenade charge: the left glove raises the grenade back over the shoulder.
    this.nade.visible = s.charge !== null && s.charge !== undefined;
    if (this.nade.visible) { const c = Math.max(0, s.charge); this.nade.position.set(-0.18 + c * 0.05, -0.12 + c * 0.1, -0.3 + c * 0.12); this.gloveL.visible = false; }
    else this.gloveL.visible = true;
    const sh = !!s.shield;
    this.gloveR.material = sh ? this.shieldMat : this.gloveMat; this.gloveL.material = this.gloveR.material;
    this.gun.visible = !(s.scoped && a > 0.9);
    this.gloveR.visible = this.gloveL.visible && this.gun.visible ? true : this.gun.visible;
  }
}

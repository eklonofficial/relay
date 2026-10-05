// First-person hands (GDD §25): the floating mittens and the held gun, lower right. Bob scales with
// speed (doubled jumping or climbing), shots kick it back and up (and punch the camera a little), the
// muzzle flashes at the gun's real muzzle, aiming brings the gun's own sight onto the eye line,
// reloads are keyframed per kind of gun (magazine swap with the left mitten, break-open shotgun,
// bolt-action round, rocket into the tube; a reload from empty adds the charging handle or slide),
// swaps lower it out and back, the whisk swings across, inspect turns it over.
// Drawn in its own scene and camera after the world, over a cleared depth buffer.
import * as THREE from '../../vendor/three/three.module.js?v=muvmfsft';
import { gunModel } from './guns.js?v=muvmfsft';
import { clone } from './models.js?v=muvmfsft';

// Where each gun sits at the hip (metres in camera space), and how hard it kicks.
const HIP = { yolk47: [0.16, -0.17, -0.36], doubleYolker: [0.16, -0.18, -0.35], cageFree: [0.16, -0.17, -0.38], yolkzooka: [0.2, -0.22, -0.38], beater: [0.15, -0.16, -0.32], poacher: [0.16, -0.17, -0.4], triBoil: [0.16, -0.17, -0.36], peck9mm: [0.15, -0.15, -0.3] };
const KICK = { yolk47: 0.45, doubleYolker: 1, cageFree: 0.8, yolkzooka: 1, beater: 0.32, poacher: 1, triBoil: 0.4, peck9mm: 0.55 };
// Parts that only exist while loading (shotgun shells, the sniper round, the rocket).
const LOADED_ONLY = new Set(['doubleYolker', 'poacher', 'yolkzooka']);
// How each gun reloads.
const RELOAD_KIND = { yolk47: 'mag', beater: 'mag', triBoil: 'mag', cageFree: 'mag', peck9mm: 'pistol', doubleYolker: 'break', poacher: 'bolt', yolkzooka: 'rocket' };

// Keyframe helpers: progress of f through [a,b] (clamped), smoothed; a bump that rises and falls in [a,b].
const ss = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const seg = (f, a, b) => ss((f - a) / (b - a));
const bump = (f, a, b) => (f <= a || f >= b) ? 0 : Math.sin((f - a) / (b - a) * Math.PI);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp3 = (out, a, b, t) => out.copy(a).lerp(b, t);

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
    // The spent magazine that falls away during a reload (a copy of the gun's own), and scratch vectors.
    this.dropMag = null; this.dropT = -1; this.tmp = V(0, 0, 0); this.tmp2 = V(0, 0, 0); this.handTarget = V(0, 0, 0); this.lastReloadF = 1;
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
    this.gloveLRest = this.gloveL.position.clone(); this.gloveLRot = this.gloveL.rotation.clone();
    this.gloveRRest = this.gloveR.position.clone();
    if (this.dropMag) { this.hold.remove(this.dropMag); this.dropMag = null; }
    if (this.mag && !LOADED_ONLY.has(id)) { this.dropMag = this.mag.clone(true); this.dropMag.visible = false; this.hold.add(this.dropMag); }
    this.dropT = -1;
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
  // Gun-space point → hold space, and back (the gun may be offset/rotated inside the hold group).
  toHold(v, out) { this.gun.updateMatrix(); return out.copy(v).applyMatrix4(this.gun.matrix); }
  toGun(v, out) { this.gun.updateMatrix(); return out.copy(v).applyMatrix4(this.tmpInv.copy(this.gun.matrix).invert()); }
  // One reload frame at progress f (0..1 of the real reload time): the gun's pose offset, where the
  // left mitten is, and what the magazine/shells/round/rocket are doing.
  reloadPose(f, long) {
    const kind = RELOAD_KIND[this.weapon] || 'mag', o = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, hand: null };
    this.tmpInv = this.tmpInv || new THREE.Matrix4();
    const rest = this.gloveLRest, magHome = this.magHome;
    const below = V(-0.06, -0.32, 0.06);                      // off the bottom of the screen (fetching)
    if (f < this.lastReloadF - 0.5) this.dropT = -1;          // a new reload began
    if (kind === 'mag' || kind === 'pistol') {
      // Tilt the gun to show the magazine well; ease back at the end.
      const tilt = seg(f, 0, 0.14) * (1 - seg(f, long ? 0.9 : 0.86, 1));
      // Bring it up and in, turned and rolled so the well (and the mitten working it) is in view.
      const P = kind === 'pistol';
      o.rz = -tilt * (P ? 0.5 : 0.75); o.rx = tilt * (P ? 0.25 : 0.12); o.ry = tilt * 0.25; o.y = tilt * (P ? 0.09 : 0.05); o.x = -tilt * (P ? 0.08 : 0.06); o.z = tilt * 0.03;
      const magIn = this.mag ? this.toHold(magHome, this.tmp) : rest;
      const grab = this.handTarget.copy(magIn).add(V(-0.01, -0.035, 0));
      const end = long ? 0.86 : 0.8;
      if (f < 0.12) o.hand = lerp3(V(0, 0, 0), rest, grab, seg(f, 0, 0.12));
      else if (f < 0.32) {                                      // pull the old magazine down and out
        const t = seg(f, 0.16, 0.32);
        o.hand = grab.clone().add(V(0, -0.09 * t, 0));
        if (this.mag) this.mag.position.copy(magHome).add(V(0, -0.09 * t / (this.gun.scale.y || 1), 0));
      } else if (f < 0.6) {                                     // let it drop; fetch a fresh one
        if (this.mag && this.dropT < 0 && this.lastReloadF < 0.32) { this.toHold(this.mag.position, this.tmp2); this.dropFrom = this.tmp2.clone(); this.dropT = 0; this.dropMag.quaternion.copy(this.gun.quaternion); this.dropMag.scale.copy(this.gun.scale); }
        if (this.mag) this.mag.visible = false;
        const t = f < 0.45 ? seg(f, 0.32, 0.45) : 1 - seg(f, 0.45, 0.6);
        o.hand = lerp3(V(0, 0, 0), grab.clone().add(V(0, -0.09, 0)), grab.clone().add(below), t);
        if (f >= 0.45 && this.mag) { this.mag.visible = true; this.toGun(o.hand.clone().add(V(0.01, 0.035, 0)), this.tmp); this.mag.position.copy(this.tmp); }
      } else if (f < 0.72) {                                    // line it up and seat it, with a bump
        const t = seg(f, 0.6, 0.7);
        o.hand = grab.clone().add(V(0, -0.06 * (1 - t), 0));
        if (this.mag) { this.mag.visible = true; this.mag.position.copy(magHome).add(V(0, -0.06 * (1 - t) / (this.gun.scale.y || 1), 0)); }
        o.rx -= bump(f, 0.68, 0.74) * 0.05; o.y += bump(f, 0.68, 0.74) * 0.012;
      } else if (long && kind === 'pistol' && f < end) {        // empty pistol: rack the slide (a sharp kick back)
        if (this.mag) this.mag.position.copy(magHome);
        o.hand = grab.clone(); o.z += bump(f, 0.74, 0.82) * 0.03; o.rx += bump(f, 0.74, 0.8) * 0.15;
      } else if (long && f < end) {                             // empty: work the charging handle
        if (this.mag) this.mag.position.copy(magHome);
        const side = this.toHold(this.handlePoint(), V(0, 0, 0));
        const pull = bump(f, 0.76, 0.84);
        o.hand = lerp3(V(0, 0, 0), grab, side, seg(f, 0.72, 0.76)).add(V(0, 0, 0.05 * pull));
        o.z += pull * 0.012; o.rx -= bump(f, 0.82, 0.86) * 0.06;
      } else {                                                  // back to the support hand
        if (this.mag) this.mag.position.copy(magHome);
        o.hand = lerp3(V(0, 0, 0), long && kind !== 'pistol' ? this.toHold(this.handlePoint(), V(0, 0, 0)) : grab, rest, seg(f, long ? end : 0.72, long ? 0.95 : 0.85));
      }
    } else if (kind === 'break') {
      // Break it open (muzzle drops), push two shells into the breech, snap it shut with a flick.
      const open = seg(f, 0, 0.16) * (1 - seg(f, 0.76, 0.84));
      // (raised and turned in so the open breech faces you)
      o.rx = -open * 0.25; o.rz = -open * 0.4; o.ry = open * 0.25; o.y = open * 0.05 + bump(f, 0.8, 0.92) * 0.02; o.x = -open * 0.06; o.rx += bump(f, 0.8, 0.9) * 0.12;
      const breech = this.toHold(this.mag ? magHome : V(0, 0, 0.05), V(0, 0, 0));
      if (f < 0.4) o.hand = lerp3(V(0, 0, 0), rest, breech.clone().add(below), seg(f, 0.1, 0.35));
      else if (f < 0.7) o.hand = lerp3(V(0, 0, 0), breech.clone().add(below), breech.clone().add(V(0, -0.02, 0.01)), seg(f, 0.4, 0.62));
      else o.hand = lerp3(V(0, 0, 0), breech, rest, seg(f, 0.72, 0.88));
      if (this.mag) { this.mag.visible = f > 0.4 && f < 0.7; if (this.mag.visible) { this.toGun(o.hand.clone().add(V(0.005, 0.02, -0.01)), this.tmp); this.mag.position.copy(this.tmp); } }
    } else if (kind === 'bolt') {
      // Roll the rifle, bolt up and back, thumb a round in, bolt forward and down.
      const roll = seg(f, 0, 0.15) * (1 - seg(f, 0.85, 1));
      o.rz = -roll * 0.55; o.rx = roll * 0.1; o.ry = roll * 0.25; o.y = roll * 0.05; o.x = -roll * 0.06;
      o.z += bump(f, 0.15, 0.3) * 0.02 - bump(f, 0.7, 0.82) * 0.02;
      const port = this.toHold(this.mag ? magHome : V(0, 0.02, 0.05), V(0, 0, 0));
      if (f < 0.35) o.hand = lerp3(V(0, 0, 0), rest, port.clone().add(below), seg(f, 0.1, 0.33));
      else if (f < 0.65) o.hand = lerp3(V(0, 0, 0), port.clone().add(below), port.clone().add(V(-0.01, 0.01, 0)), seg(f, 0.35, 0.58));
      else o.hand = lerp3(V(0, 0, 0), port, rest, seg(f, 0.66, 0.85));
      if (this.mag) { this.mag.visible = f > 0.35 && f < 0.64; if (this.mag.visible) { this.toGun(o.hand.clone().add(V(0.01, 0.02, 0)), this.tmp); this.mag.position.copy(this.tmp); } }
    } else {
      // Rocket: lower the tube, bring a rocket up to the muzzle and slide it in.
      const lower = seg(f, 0, 0.2) * (1 - seg(f, 0.82, 1));
      // (the launcher dips mostly out of view, muzzle up, and comes back up loaded)
      o.y = -lower * 0.1; o.x = -lower * 0.02; o.rx = lower * 0.35; o.rz = -lower * 0.12; o.z = lower * 0.03;
      const mouth = this.toHold(this.gun.userData.muzzle || V(0, 0, -0.4), V(0, 0, 0));
      if (f < 0.4) o.hand = lerp3(V(0, 0, 0), rest, mouth.clone().add(below), seg(f, 0.1, 0.38));
      else if (f < 0.72) o.hand = lerp3(V(0, 0, 0), mouth.clone().add(below), mouth.clone().add(V(0, 0, 0.12)), seg(f, 0.4, 0.7));
      else o.hand = lerp3(V(0, 0, 0), mouth, rest, seg(f, 0.74, 0.92));
      o.rx -= bump(f, 0.66, 0.74) * 0.05;
      if (this.mag) { this.mag.visible = f > 0.4 && f < 0.7; if (this.mag.visible) { this.toGun(o.hand.clone().add(V(0, 0.02, -0.04)), this.tmp); this.mag.position.copy(this.tmp); } }
    }
    // Never let the mitten come right up to the lens.
    if (o.hand) o.hand.z = Math.min(o.hand.z, 0.04);
    this.lastReloadF = f;
    return o;
  }
  // Where the charging handle / slide is grabbed: just above and behind the grip.
  handlePoint() { const u = this.gun.userData, g = u.grip || V(0, -0.07, 0); return this.weapon === 'peck9mm' ? V(g.x - 0.01, g.y + 0.07, g.z - 0.03) : V(g.x - 0.03, g.y + 0.08, g.z - 0.1); }
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
    let hand = null; // where the left mitten goes this frame (hold space), if it leaves its rest
    if (s.reload) {
      const R = this.reloadPose(Math.min(1, Math.max(0, s.reload.f)), s.reload.long);
      x += R.x; y += R.y; z += R.z; rx += R.rx; ry += R.ry; rz += R.rz; hand = R.hand;
    } else {
      if (this.mag) { this.mag.position.copy(this.magHome); if (LOADED_ONLY.has(this.weapon)) this.mag.visible = false; else this.mag.visible = true; }
      this.lastReloadF = 1;
    }
    if (s.swap) { const f = s.swap, d = f < 0.5 ? f * 2 : (1 - f) * 2; y -= d * 0.25; rx -= d * 0.6; }
    if (s.inspect) { const f = s.inspect; ry += Math.sin(f * Math.PI) * 1.2; rz += Math.sin(f * Math.PI * 2) * 0.3; }
    this.hold.position.set(x, y, z); this.hold.rotation.set(rx, ry, rz);
    // The left mitten: at rest on the support, or following the reload's hand path.
    if (hand) { this.gloveL.position.lerp(hand, Math.min(1, s.dt * 30)); this.gloveL.rotation.set(-0.6, -0.1, 0.9); }
    else { this.gloveL.position.lerp(this.gloveLRest, Math.min(1, s.dt * 20)); this.gloveL.rotation.copy(this.gloveLRot); }
    // The spent magazine falls out of view, tumbling.
    if (this.dropMag && this.dropT >= 0) {
      this.dropT += s.dt; const t = this.dropT;
      this.dropMag.visible = t < 0.6;
      this.dropMag.position.set(this.dropFrom.x - t * 0.05, this.dropFrom.y - 1.6 * t * t - t * 0.15, this.dropFrom.z + t * 0.04);
      this.dropMag.rotation.set(t * 3, 0, t * 1.5);
      if (t >= 0.6) this.dropT = -1;
    }
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

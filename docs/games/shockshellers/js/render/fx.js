// Effects (GDD §25): bullet streaks and tracers, wall impacts, muzzle flashes, rocket smoke trails,
// explosions (sprite count ∝ damage/4), yolk hit splashes, egg shatter shards and yolk splats, plus
// the world objects that move: rockets, grenades (with the pre-detonation flash), pickups and the
// spatula. Pools are reused; nothing allocates per frame once warm.
import * as THREE from '../../vendor/three/three.module.js?v=muv7xl0m';
import { gunModel } from './guns.js?v=muv7xl0m';
import { TEAM_COLORS } from './egg.js?v=muv7xl0m';

function radial(inner, outer, size = 64) {
  const c = new OffscreenCanvas(size, size), x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function puff() {
  const c = new OffscreenCanvas(64, 64), x = c.getContext('2d');
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2, r = 12 + (i % 3) * 3;
    const g = x.createRadialGradient(32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, 0, 32 + Math.cos(a) * 9, 32 + Math.sin(a) * 9, r);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

class SpritePool {
  constructor(scene, texture, blending = THREE.NormalBlending, n = 96) {
    this.list = []; this.i = 0;
    for (let k = 0; k < n; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, blending }));
      s.visible = false; s.userData = { life: 0, max: 1, v: new THREE.Vector3(), grow: 0, fade: true, size: 1, color: new THREE.Color() };
      scene.add(s); this.list.push(s);
    }
  }
  spawn(x, y, z, size, life, color = 0xffffff, vx = 0, vy = 0, vz = 0, grow = 0, opacity = 1) {
    const s = this.list[this.i = (this.i + 1) % this.list.length], u = s.userData;
    s.position.set(x, y, z); s.visible = true; s.scale.setScalar(size); s.material.color.setHex(color); s.material.opacity = opacity;
    u.life = life; u.max = life; u.v.set(vx, vy, vz); u.grow = grow; u.size = size; u.op = opacity;
    s.material.rotation = Math.random() * 6.28;
    return s;
  }
  update(dt) {
    for (const s of this.list) {
      if (!s.visible) continue;
      const u = s.userData;
      u.life -= dt; if (u.life <= 0) { s.visible = false; continue; }
      s.position.addScaledVector(u.v, dt); u.v.multiplyScalar(Math.max(0, 1 - dt * 1.5));
      u.size += u.grow * dt; s.scale.setScalar(u.size);
      s.material.opacity = u.op * Math.min(1, u.life / u.max * 1.6);
    }
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new SpritePool(scene, puff(), THREE.NormalBlending, 160);
    this.fire = new SpritePool(scene, radial('rgba(255,240,170,1)', 'rgba(255,120,20,0)'), THREE.AdditiveBlending, 96);
    this.yolk = new SpritePool(scene, radial('rgba(255,200,40,1)', 'rgba(255,170,0,0)'), THREE.NormalBlending, 96);
    // Bullet streaks: short bright segments flying along the real bullet path (they are projectiles).
    this.streakMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
    const sg = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true); sg.rotateX(Math.PI / 2); sg.translate(0, 0, -0.5);
    this.streaks = []; for (let i = 0; i < 160; i++) { const m = new THREE.Mesh(sg, this.streakMat); m.visible = false; m.userData = {}; scene.add(m); this.streaks.push(m); }
    this.si = 0;
    // Impacts: small dark scorch decals that fade.
    this.decalMat = new THREE.MeshBasicMaterial({ map: radial('rgba(40,30,20,0.8)', 'rgba(40,30,20,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.splatMat = new THREE.MeshBasicMaterial({ map: radial('rgba(255,196,30,1)', 'rgba(255,170,0,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const dg = new THREE.PlaneGeometry(1, 1);
    this.decals = []; for (let i = 0; i < 64; i++) { const m = new THREE.Mesh(dg, this.decalMat); m.visible = false; m.userData = { life: 0 }; scene.add(m); this.decals.push(m); }
    this.di = 0;
    // Shell shards.
    this.shardGeo = new THREE.TetrahedronGeometry(0.06, 0);
    this.shards = []; for (let i = 0; i < 96; i++) { const m = new THREE.Mesh(this.shardGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, flatShading: true })); m.visible = false; m.userData = { v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }; m.castShadow = true; scene.add(m); this.shards.push(m); }
    this.shi = 0;
    // Flash light for muzzle flashes and explosions.
    this.flash = new THREE.PointLight(0xffc070, 0, 6, 2); scene.add(this.flash); this.flashT = 0;
    this.objects = new Map(); // id → mesh for rockets, grenades
  }
  streak(x, y, z, dx, dy, dz, len, speed, tracer) {
    const m = this.streaks[this.si = (this.si + 1) % this.streaks.length], u = m.userData;
    m.material = tracer ? this.tracerMat : this.streakMat;
    m.position.set(x, y, z); m.lookAt(x + dx, y + dy, z + dz); m.rotateY(Math.PI);
    u.x = x; u.y = y; u.z = z; u.dx = dx; u.dy = dy; u.dz = dz; u.left = len; u.speed = speed * 30; u.d = 0;
    m.scale.set(tracer ? 1.6 : 1, tracer ? 1.6 : 1, Math.min(tracer ? 1.6 : 0.9, len)); m.visible = true;
  }
  impact(x, y, z, nx, ny, nz) {
    const m = this.decals[this.di = (this.di + 1) % this.decals.length];
    m.material = this.decalMat; m.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01);
    m.lookAt(x + nx, y + ny, z + nz); m.scale.setScalar(0.12 + Math.random() * 0.05); m.visible = true; m.userData.life = 8;
    for (let i = 0; i < 3; i++) this.smoke.spawn(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, 0.08, 0.45, 0xd8d0c0, nx * 0.6 + (Math.random() - 0.5) * 0.5, ny * 0.6 + Math.random() * 0.4, nz * 0.6 + (Math.random() - 0.5) * 0.5, 0.25, 0.7);
  }
  muzzle(x, y, z, big = false) {
    this.fire.spawn(x, y, z, big ? 0.35 : 0.2, 0.05, 0xffe8a0);
    this.flash.position.set(x, y, z); this.flash.intensity = big ? 6 : 3; this.flashT = 0.05;
  }
  hitSplash(x, y, z, dx, dy, dz) {
    for (let i = 0; i < 5; i++) this.yolk.spawn(x, y, z, 0.07 + Math.random() * 0.05, 0.35, 0xffc21a, -dx * 1.5 + (Math.random() - 0.5) * 1.5, -dy * 1.5 + Math.random() * 1.5, -dz * 1.5 + (Math.random() - 0.5) * 1.5, -0.1);
    for (let i = 0; i < 3; i++) this.shard(x, y, z, 0xffffff, 0.6);
  }
  shard(x, y, z, color, life = 2.5) {
    const m = this.shards[this.shi = (this.shi + 1) % this.shards.length], u = m.userData;
    m.material.color.setHex(color); m.position.set(x, y, z); m.visible = true; m.scale.setScalar(0.6 + Math.random() * 0.9);
    u.v.set((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3); u.w.set(Math.random() * 10, Math.random() * 10, Math.random() * 10); u.life = life;
  }
  // Death: 8–12 shards, a yolk burst and a yolk splat on the floor below.
  shatter(x, y, z, color, floorY) {
    const n = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) this.shard(x + (Math.random() - 0.5) * 0.3, y + 0.3 + Math.random() * 0.3, z + (Math.random() - 0.5) * 0.3, color);
    for (let i = 0; i < 10; i++) this.yolk.spawn(x, y + 0.3, z, 0.1 + Math.random() * 0.08, 0.6, 0xffbf00, (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3, 0.1);
    const m = this.decals[this.di = (this.di + 1) % this.decals.length];
    m.material = this.splatMat; m.position.set(x, floorY + 0.012, z); m.rotation.set(-Math.PI / 2, 0, Math.random() * 6); m.scale.setScalar(0.7 + Math.random() * 0.3); m.visible = true; m.userData.life = 10;
  }
  explosion(x, y, z, radius, weapon, team = 0) {
    const n = Math.round((weapon === 'grenade' ? 150 : 140) / 4 / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, b = Math.random() * 3.14, r = Math.random() * radius * 0.35;
      const vx = Math.cos(a) * Math.sin(b), vy = Math.cos(b), vz = Math.sin(a) * Math.sin(b);
      this.fire.spawn(x + vx * r, y + vy * r + 0.2, z + vz * r, 0.6 + Math.random() * 0.6, 0.3 + Math.random() * 0.2, i % 3 ? 0xffa040 : 0xffe080, vx * 2, vy * 2 + 1, vz * 2, 1.2);
      this.smoke.spawn(x + vx * r, y + vy * r + 0.3, z + vz * r, 0.6 + Math.random() * 0.5, 1.4 + Math.random() * 0.8, 0x6f6a66, vx * 1.5, vy + 1.2, vz * 1.5, 0.9, 0.8);
    }
    this.flash.position.set(x, y + 0.5, z); this.flash.intensity = 30; this.flash.distance = radius * 4; this.flashT = 0.12;
  }
  dud(x, y, z) { for (let i = 0; i < 6; i++) this.smoke.spawn(x, y, z, 0.15, 0.6, 0xdddddd, (Math.random() - 0.5), Math.random(), (Math.random() - 0.5), 0.4); }

  // ---- moving objects ----
  rocket(id, x, y, z, dx, dy, dz) {
    let m = this.objects.get('r' + id);
    if (!m) {
      m = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xffc531, roughness: 0.4 }));
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8452f })); tip.position.z = -0.21;
      m.add(body, tip); this.scene.add(m); this.objects.set('r' + id, m);
    }
    m.position.set(x, y, z); m.lookAt(x + dx, y + dy, z + dz); m.rotateY(Math.PI);
    if (Math.random() < 0.8) this.smoke.spawn(x - dx * 0.2, y - dy * 0.2, z - dz * 0.2, 0.18, 1.2, 0xeeeeee, (Math.random() - 0.5) * 0.3, 0.2, (Math.random() - 0.5) * 0.3, 0.5, 0.85);
    this.fire.spawn(x - dx * 0.22, y - dy * 0.22, z - dz * 0.22, 0.14, 0.06, 0xffc060);
    m.userData.seen = true;
  }
  grenade(id, x, y, z, fuse, team) {
    let m = this.objects.get('g' + id);
    if (!m) { m = gunModel('grenade'); m.scale.setScalar(1.4); this.scene.add(m); this.objects.set('g' + id, m); m.userData.flash = new THREE.PointLight(0xffff60, 0, 3); m.add(m.userData.flash); }
    m.position.set(x, y, z); m.rotation.y += 0.15;
    // Yellow (team-tinted) flash right before detonation.
    const f = fuse < 15 && Math.floor(fuse / 2) % 2 === 0;
    m.userData.flash.color.setHex(team ? TEAM_COLORS[team] : 0xffff60); m.userData.flash.intensity = f ? 3 : 0;
    m.userData.seen = true;
  }
  // Drop objects not refreshed this frame.
  sweep() { for (const [k, m] of this.objects) { if (!m.userData.seen) { this.scene.remove(m); this.objects.delete(k); } else m.userData.seen = false; } }

  update(dt) {
    this.smoke.update(dt); this.fire.update(dt); this.yolk.update(dt);
    for (const m of this.streaks) {
      if (!m.visible) continue;
      const u = m.userData, step = u.speed * dt;
      u.d += step;
      if (u.d >= u.left) { m.visible = false; continue; }
      m.position.set(u.x + u.dx * u.d, u.y + u.dy * u.d, u.z + u.dz * u.d);
    }
    for (const m of this.decals) if (m.visible && (m.userData.life -= dt) <= 0) m.visible = false;
    for (const m of this.shards) {
      if (!m.visible) continue;
      const u = m.userData; u.life -= dt; if (u.life <= 0) { m.visible = false; continue; }
      u.v.y -= 9 * dt; m.position.addScaledVector(u.v, dt);
      m.rotation.x += u.w.x * dt; m.rotation.y += u.w.y * dt;
      if (m.position.y < -20) m.visible = false;
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
  }
}

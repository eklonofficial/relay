// Effects (GDD §25): bullet streaks and tracers, wall impacts, muzzle flashes, rocket smoke trails,
// explosions (sprite count ∝ damage/4), yolk hit splashes, egg shatter shards and yolk splats, plus
// the world objects that move: rockets, grenades (with the pre-detonation flash), pickups and the
// spatula. Pools are reused; nothing allocates per frame once warm.
import * as THREE from '../../vendor/three/three.module.js?v=muvmvc5o';
import { gunModel } from './guns.js?v=muvmvc5o';
import { TEAM_COLORS } from './egg.js?v=muvmvc5o';

function radial(inner, outer, size = 64) {
  const c = new OffscreenCanvas(size, size), x = c.getContext('2d');
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// A bullet hole: a small dark core with a chipped, lighter rim and a faint soot ring around it.
function bulletHole(size = 64) {
  const c = new OffscreenCanvas(size, size), x = c.getContext('2d'), m = size / 2;
  let g = x.createRadialGradient(m, m, 0, m, m, m);
  g.addColorStop(0, 'rgba(30,24,18,0.55)'); g.addColorStop(0.45, 'rgba(30,24,18,0.25)'); g.addColorStop(1, 'rgba(30,24,18,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  x.fillStyle = 'rgba(190,184,172,0.28)';
  x.beginPath();
  for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI * 2, r = size * (0.17 + ((i * 7) % 5) * 0.012); x.lineTo(m + Math.cos(a) * r, m + Math.sin(a) * r); }
  x.fill();
  g = x.createRadialGradient(m, m, 0, m, m, size * 0.13);
  g.addColorStop(0, 'rgba(8,6,4,1)'); g.addColorStop(0.8, 'rgba(20,16,12,0.95)'); g.addColorStop(1, 'rgba(20,16,12,0)');
  x.fillStyle = g; x.beginPath(); x.arc(m, m, size * 0.13, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// A yolk splat seen from above: a ragged white of albumen with a glossy yolk off-centre and droplets.
function yolkSplat(size = 128) {
  const c = new OffscreenCanvas(size, size), x = c.getContext('2d'), m = size / 2;
  let s = 99; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const blob = (cx, cy, R, n, wob) => { x.beginPath(); for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, rr = R * (1 - wob + r() * wob * 2); i ? x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : x.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill(); };
  x.fillStyle = 'rgba(255,252,236,0.75)'; blob(m, m, size * 0.36, 18, 0.22);
  for (let i = 0; i < 9; i++) { const a = r() * 6.28, d = size * (0.36 + r() * 0.1); blob(m + Math.cos(a) * d, m + Math.sin(a) * d, size * (0.02 + r() * 0.035), 8, 0.2); }
  const g = x.createRadialGradient(m - size * 0.06, m - size * 0.07, 0, m, m, size * 0.2);
  g.addColorStop(0, '#ffe680'); g.addColorStop(0.5, '#ffbe14'); g.addColorStop(1, '#f29d00');
  x.fillStyle = g; blob(m + size * 0.03, m + size * 0.02, size * 0.19, 14, 0.1);
  x.fillStyle = 'rgba(255,255,255,0.7)'; x.beginPath(); x.ellipse(m - size * 0.04, m - size * 0.05, size * 0.05, size * 0.025, -0.6, 0, 7); x.fill();
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
    // Impacts: small bullet holes that shrink away after a while.
    this.decalMat = new THREE.MeshBasicMaterial({ map: bulletHole(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.splatMat = new THREE.MeshBasicMaterial({ map: yolkSplat(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const dg = new THREE.PlaneGeometry(1, 1);
    this.decals = []; for (let i = 0; i < 64; i++) { const m = new THREE.Mesh(dg, this.decalMat); m.visible = false; m.userData = { life: 0 }; scene.add(m); this.decals.push(m); }
    this.di = 0;
    // Shell shards.
    // Curved bits of shell (patches of a sphere the egg's size), a few shapes, lit on both faces.
    this.shardGeos = [[0.5, 0.45], [0.35, 0.6], [0.6, 0.3], [0.3, 0.3]].map(([a, b]) => new THREE.SphereGeometry(0.3, 3, 2, 0, a, 1.2, b).translate(0, 0, -0.3).rotateX(Math.PI / 2));
    this.shards = []; for (let i = 0; i < 128; i++) { const m = new THREE.Mesh(this.shardGeos[i % 4], new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, flatShading: true, side: THREE.DoubleSide })); m.visible = false; m.userData = { v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 }; m.castShadow = true; scene.add(m); this.shards.push(m); }
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
    m.lookAt(x + nx, y + ny, z + nz); m.rotateZ(Math.random() * 6.28); m.scale.setScalar(0.085 + Math.random() * 0.025); m.visible = true; m.userData.life = 10; m.userData.size = m.scale.x;
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
  // A shell fragment flung from (x,y,z); `out` pushes it away from the egg's centre. It bounces and
  // settles on `floor`, then shrinks away.
  shard(x, y, z, color, life = 2.5, floor = -Infinity, out = null, scale = 0.45) {
    const m = this.shards[this.shi = (this.shi + 1) % this.shards.length], u = m.userData;
    m.material.color.setHex(color); m.position.set(x, y, z); m.visible = true; u.size = scale * (0.6 + Math.random() * 0.8); m.scale.setScalar(u.size);
    m.rotation.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    if (out) u.v.set(out[0] * (2 + Math.random() * 2.5) + (Math.random() - 0.5), out[1] * 2 + 1.5 + Math.random() * 2.5, out[2] * (2 + Math.random() * 2.5) + (Math.random() - 0.5));
    else u.v.set((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
    u.w.set((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 0); u.life = life; u.max = life; u.floor = floor;
  }
  // Death: 8–12 shards, a yolk burst and a yolk splat on the floor below.
  // Death: the shell bursts into a shower of curved pieces (in the egg's colour) flung outwards from
  // all over its surface, a yolk-and-white splash, and a splat left on the floor.
  shatter(x, y, z, color, floorY) {
    const n = 22 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, h = Math.random();
      const o = [Math.cos(a), h - 0.3, Math.sin(a)];
      this.shard(x + o[0] * 0.25, y + 0.05 + h * 0.6, z + o[2] * 0.25, color, 2.2 + Math.random(), floorY, o, 1.0);
    }
    for (let i = 0; i < 14; i++) this.yolk.spawn(x, y + 0.35, z, 0.12 + Math.random() * 0.14, 0.5 + Math.random() * 0.3, 0xffb400, (Math.random() - 0.5) * 3.5, Math.random() * 3, (Math.random() - 0.5) * 3.5, 0.2);
    for (let i = 0; i < 8; i++) this.smoke.spawn(x, y + 0.35, z, 0.16 + Math.random() * 0.1, 0.45, 0xfffaf0, (Math.random() - 0.5) * 2.5, Math.random() * 2, (Math.random() - 0.5) * 2.5, 0.5, 0.75);
    const m = this.decals[this.di = (this.di + 1) % this.decals.length];
    m.material = this.splatMat; m.position.set(x, floorY + 0.012, z); m.rotation.set(-Math.PI / 2, 0, Math.random() * 6); m.scale.setScalar(1.0 + Math.random() * 0.35); m.visible = true; m.userData.life = 12; m.userData.size = m.scale.x;
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
    for (const m of this.decals) {
      if (!m.visible) continue;
      if ((m.userData.life -= dt) <= 0) m.visible = false;
      else if (m.userData.life < 0.6 && m.userData.size) m.scale.setScalar(m.userData.size * m.userData.life / 0.6);
    }
    for (const m of this.shards) {
      if (!m.visible) continue;
      const u = m.userData; u.life -= dt; if (u.life <= 0) { m.visible = false; continue; }
      u.v.y -= 9 * dt; m.position.addScaledVector(u.v, dt);
      if (m.position.y < u.floor + 0.02) {
        // Bounce once or twice, then lie still.
        m.position.y = u.floor + 0.02; if (u.v.y < 0) u.v.y *= -0.3; u.v.x *= 0.55; u.v.z *= 0.55; u.w.multiplyScalar(0.5);
        if (Math.abs(u.v.y) < 0.4) u.v.y = 0;
      }
      m.rotation.x += u.w.x * dt; m.rotation.y += u.w.y * dt;
      if (u.life < 0.4) m.scale.setScalar(u.size * u.life / 0.4);
      if (m.position.y < -20) m.visible = false;
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.intensity = 0; }
  }
}

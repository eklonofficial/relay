// The 3D scene: sky, sun and shadows, the map, eggs, pickups, the spatula, the roost, effects and
// the first-person hands. The game canvas (#game) lives outside the compositor so WebGL and pointer
// lock work natively; this module only draws into it.
import * as THREE from '../../vendor/three/three.module.js?v=muuocbci';
import { buildWorld } from './world.js?v=muuocbci';
import { EggAvatar, TEAM_COLORS } from './egg.js?v=muuocbci';
import { Effects } from './fx.js?v=muuocbci';
import { ViewModel } from './viewmodel.js?v=muuocbci';
import { gunModel } from './guns.js?v=muuocbci';

const SKIES = {
  day: { top: 0x2f8fd8, bottom: 0xbfe3f2, sun: 0xfff2d8 },
  dusk: { top: 0x3b4a8c, bottom: 0xf3b37c, sun: 0xffc890 },
  night: { top: 0x070b1e, bottom: 0x24304f, sun: 0xb8c8ff },
  space: { top: 0x000006, bottom: 0x0c0c22, sun: 0xffffff },
};

function skyDome(kind) {
  const s = SKIES[kind] || SKIES.day;
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(s.top) }, bottom: { value: new THREE.Color(s.bottom) }, stars: { value: kind === 'night' || kind === 'space' ? 1 : 0 } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float stars; varying vec3 vp;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){ float t = clamp(vp.y * 1.4 + 0.15, 0.0, 1.0); vec3 c = mix(bottom, top, pow(t, 0.8));
        if (stars > 0.5) { vec3 q = floor(vp * 300.0); float s = step(0.997, h(q)); c += s * vec3(0.9) * clamp(vp.y + 0.2, 0.0, 1.0); }
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const m = new THREE.Mesh(geo, mat); m.renderOrder = -1; m.frustumCulled = false;
  return m;
}
function clouds(seed) {
  const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.95 });
  let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Group(), a = r() * Math.PI * 2, d = 120 + r() * 120;
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(8 + r() * 8, 0), mat); m.position.set(k * 9 - 13, r() * 4, r() * 6); m.scale.y = 0.55; c.add(m); }
    c.position.set(Math.cos(a) * d, 60 + r() * 40, Math.sin(a) * d); c.rotation.y = r() * 3;
    g.add(c);
  }
  return g;
}
function carton() {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: 0xf0a43a, roughness: 0.8 }));
  g.add(box);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.22), new THREE.MeshStandardMaterial({ color: 0xffd36a, roughness: 0.8 })); lid.position.y = 0.065; g.add(lid);
  const dome = new THREE.SphereGeometry(0.045, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const e = new THREE.Mesh(dome, lid.material); e.position.set(-0.11 + i * 0.11, 0.08, -0.05 + j * 0.1); g.add(e); }
  g.traverse(o => { o.castShadow = true; });
  return g;
}
function spatulaModel() {
  const g = new THREE.Group(), gold = new THREE.MeshStandardMaterial({ color: 0xffc531, roughness: 0.25, metalness: 0.8, emissive: 0x3a2600 });
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, 0.26), gold); blade.position.z = -0.2; g.add(blade);
  for (let i = 0; i < 3; i++) { const slot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.16), new THREE.MeshStandardMaterial({ color: 0x8a6400 })); slot.position.set(-0.06 + i * 0.06, 0.003, -0.2); g.add(slot); }
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.4, 8).rotateX(Math.PI / 2), gold); handle.position.z = 0.12; g.add(handle);
  g.traverse(o => { o.castShadow = true; });
  return g;
}
// A floating crown marker (Rule the Roost) and team-coloured perimeter.
function crownSprite() {
  const c = new OffscreenCanvas(128, 128), x = c.getContext('2d');
  x.fillStyle = '#ffc531'; x.strokeStyle = '#5a3a00'; x.lineWidth = 6; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(14, 96); x.lineTo(22, 34); x.lineTo(46, 64); x.lineTo(64, 22); x.lineTo(82, 64); x.lineTo(106, 34); x.lineTo(114, 96); x.closePath(); x.fill(); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(0.8, 0.8, 1); s.renderOrder = 10;
  return s;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping; this.gl.toneMappingExposure = 1.2;
    this.gl.shadowMap.enabled = true; this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 600);
    this.baseFov = 72;
    this.hemi = new THREE.HemisphereLight(0xe6f2ff, 0xa89878, 1.5); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.fx = new Effects(this.scene);
    this.view = new ViewModel();
    this.avatars = new Map();
    this.items = new Map();
    this.scale = 1; this.detail = 1;
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight, dpr = Math.min(2, devicePixelRatio || 1) * this.scale;
    this.gl.setPixelRatio(dpr); this.gl.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.view.resize(w / h);
  }
  // Auto Detail (GDD §27): lower shadow resolution and render scale when the frame rate drops.
  setDetail(level) {
    if (level === this.detail) return;
    this.detail = level;
    this.scale = level >= 1 ? 1 : level === 0.5 ? 0.85 : 0.7;
    // Shadows stay on (switching them off would need every material recompiled); the map shrinks.
    const size = level >= 1 ? 2048 : level === 0.5 ? 1024 : 512;
    this.sun.shadow.mapSize.set(size, size);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.resize();
  }
  loadMap(map) {
    if (this.world) { this.scene.remove(this.world); this.world.traverse(o => o.geometry?.dispose()); }
    for (const a of this.avatars.values()) this.scene.remove(a.group);
    this.avatars.clear();
    for (const m of this.items.values()) this.scene.remove(m);
    this.items.clear();
    if (this.sky) this.scene.remove(this.sky);
    if (this.clouds) this.scene.remove(this.clouds);
    const meta = map.meta, g = map.grid;
    this.world = buildWorld(map); this.scene.add(this.world);
    this.sky = skyDome(meta.sky || 'day'); this.scene.add(this.sky);
    if ((meta.sky || 'day') === 'day') { this.clouds = clouds(7); this.scene.add(this.clouds); } else this.clouds = null;
    const s = SKIES[meta.sky || 'day'];
    const fog = meta.fog || { color: s.bottom, near: 40, far: 120 };
    this.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    const sun = meta.sun || { dir: [-0.4, 0.8, -0.3], color: s.sun, intensity: 2.2 };
    const d = new THREE.Vector3(...sun.dir).normalize();
    const c = new THREE.Vector3(g.w / 2, 0, g.d / 2), R = Math.hypot(g.w, g.d, g.h) / 2 + 2;
    this.sun.position.copy(c).addScaledVector(d, R * 2); this.sun.target.position.copy(c);
    this.sun.color.setHex(sun.color); this.sun.intensity = sun.intensity;
    const sc = this.sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = R * 4; sc.updateProjectionMatrix();
    this.hemi.intensity = (meta.ambient ?? 1.1) * 1.4;
    for (const it of map.items) {
      const m = it.kind === 'ammo' ? carton() : (() => { const g = gunModel('grenade'); g.scale.setScalar(1.5); return g; })();
      m.position.set(it.x, it.y, it.z); this.scene.add(m); this.items.set(map.items.indexOf(it), m);
    }
    this.spatula = spatulaModel(); this.spatula.visible = false; this.scene.add(this.spatula);
    this.roost = new THREE.Group(); this.roost.visible = false; this.scene.add(this.roost);
    this.roostRing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    this.roost.add(this.roostRing);
    this.crown = crownSprite(); this.scene.add(this.crown); this.crown.visible = false;
    this.map = map;
  }
  setRoostZone(z) {
    if (!z) { this.roost.visible = false; this.crown.visible = false; return; }
    const w = z.x1 - z.x0, d = z.z1 - z.z0, t = 0.12;
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(w, 0), new THREE.Vector2(w, d), new THREE.Vector2(0, d)]);
    shape.holes.push(new THREE.Path([new THREE.Vector2(t, t), new THREE.Vector2(t, d - t), new THREE.Vector2(w - t, d - t), new THREE.Vector2(w - t, t)]));
    this.roostRing.geometry.dispose();
    this.roostRing.geometry = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    this.roost.position.set(z.x0, z.y0 + 0.03, z.z0); this.roost.visible = true;
    this.crown.position.set(z.cx, z.y0 + 2.6, z.cz); this.crown.visible = true;
    this.roostZone = z;
  }
  setRoostColor(team, contested, t) {
    const c = contested ? (Math.floor(t * 4) % 2 ? TEAM_COLORS[1] : TEAM_COLORS[2]) : team ? TEAM_COLORS[team] : 0x222222;
    this.roostRing.material.color.setHex(c);
  }
  avatar(id, opts) {
    let a = this.avatars.get(id);
    if (!a) { a = new EggAvatar(opts); this.avatars.set(id, a); this.scene.add(a.group); }
    return a;
  }
  dropAvatar(id) { const a = this.avatars.get(id); if (a) { this.scene.remove(a.group); a.dispose(); this.avatars.delete(id); } }
  setItem(i, active, t) {
    const m = this.items.get(i); if (!m) return;
    m.visible = active;
    if (active) { m.rotation.y = t * 1.5 + i; m.position.y = this.map.items[i].y + Math.sin(t * 2.5 + i) * 0.05; }
  }
  // Draw a frame. cam: { x, y, z, yaw, pitch, fovMul, shake }.
  render(cam, dt, t) {
    this.camera.position.set(cam.x, cam.y, cam.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(cam.pitch + (cam.shakeX || 0), cam.yaw + (cam.shakeY || 0), 0);
    const fov = this.baseFov * (cam.fovMul || 1);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (this.sky) this.sky.position.copy(this.camera.position);
    if (this.clouds) this.clouds.rotation.y = t * 0.004;
    if (this.crown.visible) this.crown.material.opacity = 0.85 + Math.sin(t * 3) * 0.15;
    this.world?.traverse(o => { if (o.userData.pulse) o.material.opacity = 0.6 + Math.sin(t * 5) * 0.3; });
    this.fx.update(dt);
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (this.view.root.visible) { this.gl.clearDepth(); this.gl.render(this.view.scene, this.view.camera); }
  }
}

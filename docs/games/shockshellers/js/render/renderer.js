// The 3D scene: sky, sun and shadows, the map, eggs, pickups, the spatula, the roost, effects and
// the first-person hands, then post-processing. The game canvas (#game) lives outside the compositor
// so WebGL and pointer lock work natively; this module only draws into it.
//
// Graphics quality comes in rungs (low, medium-low, medium, high). Auto Detail starts at medium and
// steps down when the frame rate sags (and never climbs back above a rung it had to leave), so a
// Chromebook settles on what it can hold at 60 and a desktop GPU gets the full picture.
import * as THREE from '../../vendor/three/three.module.js?v=muw89qdu';
import { buildWorld } from './world.js?v=muw89qdu';
import { EggAvatar, TEAM_COLORS } from './egg.js?v=muw89qdu';
import { Effects } from './fx.js?v=muw89qdu';
import { ViewModel } from './viewmodel.js?v=muw89qdu';
import { gunModel } from './guns.js?v=muw89qdu';
import { clone, merged } from './models.js?v=muw89qdu';
import { noiseTexture, WIND } from './materials.js?v=muw89qdu';
import { Post } from './post.js?v=muw89qdu';

// Sky palettes: zenith, ground below the horizon, sun, cloud light and shade, cloud cover (0 = none).
// The horizon colour is the map's fog colour, so distant walls melt into the sky.
export const SKIES = {
  day: { top: 0x2a78d0, bottom: 0xbfe3f2, ground: 0x93aab4, sun: 0xfff2d8, cloud: 0xffffff, shade: 0x9fb4c9, cover: 0.5, hemi: [0xdfefff, 0x9c8e74] },
  dusk: { top: 0x2e3d7a, bottom: 0xf3b37c, ground: 0x5a4a5a, sun: 0xffb070, cloud: 0xffd1a8, shade: 0x6b5a7a, cover: 0.55, hemi: [0xffd9b8, 0x6a5a6a] },
  night: { top: 0x050916, bottom: 0x24304f, ground: 0x0b1020, sun: 0xb8c8ff, cloud: 0x3a4766, shade: 0x101626, cover: 0.62, hemi: [0x8090c0, 0x302830] },
  space: { top: 0x000006, bottom: 0x0c0c22, ground: 0x050510, sun: 0xffffff, cloud: 0, shade: 0, cover: 0, hemi: [0xc8d0ff, 0x403a50] },
};

const SKY_VERT = 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }';
// Sky: a zenith-to-horizon gradient with a bright haze band, the sun (an HDR disc, so it blooms, plus
// a wide glow), stars on dark skies, and clouds: fractal noise projected onto a high plane, drifting,
// lit from the sun's side with darker undersides, thinning towards the horizon. One draw call.
const SKY_FRAG = `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir; uniform vec3 sunColor;
  uniform float stars; uniform sampler2D noise; uniform float cover; uniform vec3 cloudLight; uniform vec3 cloudShade; uniform float time; uniform float clouds;
  varying vec3 vDir;
  float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main(){
    vec3 d = normalize(vDir); float y = d.y;
    float t = pow(clamp(y, 0.0, 1.0), 0.42);
    vec3 c = mix(horizon, top, t);
    c = mix(c, ground, 1.0 - smoothstep(-0.18, 0.0, y));
    float sd = max(dot(d, sunDir), 0.0);
    c += sunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.55 + pow(sd, 600.0) * 2.5);
    c += sunColor * smoothstep(0.99955, 0.99975, sd) * 26.0;
    if (stars > 0.5) { vec3 q = floor(d * 280.0); float s = step(0.9965, h3(q)); c += s * vec3(1.2) * h3(q + 1.0) * clamp(y + 0.2, 0.0, 1.0); }
    if (clouds > 0.5 && cover > 0.0 && y > 0.0) {
      vec2 p = d.xz / (y + 0.12) * 0.22 + time * vec2(0.0035, 0.0015);
      float n = texture2D(noise, p).r * 0.62 + texture2D(noise, p * 2.7 + 0.31).r * 0.28 + texture2D(noise, p * 7.3 + 0.77).r * 0.1;
      float n2 = texture2D(noise, p + sunDir.xz * 0.035).r * 0.62 + texture2D(noise, p * 2.7 + 0.31 + sunDir.xz * 0.09).r * 0.28 + 0.05;
      float a = smoothstep(cover, cover + 0.22, n) * smoothstep(0.0, 0.2, y);
      float lit = clamp(0.62 + (n - n2) * 3.5, 0.0, 1.0);
      vec3 cc = mix(cloudShade, cloudLight, lit) + sunColor * pow(sd, 8.0) * 0.6 * lit;
      cc = mix(cc, horizon, (1.0 - smoothstep(0.0, 0.35, y)) * 0.55);
      c = mix(c, cc, a * 0.96);
    }
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
function skyMaterial(kind, fogColor, sunDir, sunColor) {
  const s = SKIES[kind] || SKIES.day;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(s.top) }, horizon: { value: new THREE.Color(fogColor ?? s.bottom) }, ground: { value: new THREE.Color(s.ground) },
      sunDir: { value: sunDir.clone() }, sunColor: { value: new THREE.Color(sunColor) }, stars: { value: kind === 'night' || kind === 'space' ? 1 : 0 },
      noise: { value: noiseTexture() }, cover: { value: s.cover }, cloudLight: { value: new THREE.Color(s.cloud) }, cloudShade: { value: new THREE.Color(s.shade) },
      time: { value: 0 }, clouds: { value: 1 },
    },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
  });
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
// A soft glow column over pickups so they read from across the map.
function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 color; uniform float time; varying vec2 vUv; void main(){ float a = (1.0 - vUv.y) * (1.0 - vUv.y) * (0.55 + 0.15 * sin(time * 3.0 + vUv.y * 9.0)); gl_FragColor = vec4(color * a * 0.35, 1.0); }',
  });
}

// Quality rungs (see the header). dpr: the most device pixels per CSS pixel drawn; scale: a further
// render-scale factor; levels: bloom steps; samples: MSAA on the HDR target.
export const RUNGS = [
  { name: 'low', post: false, levels: 0, samples: 0, dpr: 1, scale: 0.75, shadow: 1024, clouds: false, particles: 0.5 },
  { name: 'medium-low', post: true, levels: 3, samples: 2, dpr: 1, scale: 0.85, shadow: 1024, clouds: true, particles: 0.75 },
  { name: 'medium', post: true, levels: 4, samples: 4, dpr: 1, scale: 1, shadow: 2048, clouds: true, particles: 1 },
  { name: 'high', post: true, levels: 5, samples: 4, dpr: 1.5, scale: 1, shadow: 2048, clouds: true, particles: 1 },
];
export const QUALITY_RUNG = { low: 0, medium: 2, high: 3 };
// The Auto Detail ladder, pure so it can be tested: given the half-second frame rate, returns the
// state's next rung. Drops after 2 s under 45 fps; climbs after 5 s at 60, but never above a rung
// it has had to leave.
export function adaptRung(st, fps) {
  if (fps < 45) { if (++st.low >= 4) { st.low = 0; if (st.rung > 0) { st.ceiling = st.rung - 1; st.rung--; } } }
  else if (fps > 57 && st.rung < st.ceiling) { if (--st.low <= -10) { st.low = 0; st.rung++; } }
  else st.low = 0;
  return st.rung;
}

const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _c = new THREE.Color();
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NeutralToneMapping; this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true; this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.autoClear = false;
    this.post = new Post(this.gl);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 600);
    this.baseFov = 72;
    this.hemi = new THREE.HemisphereLight(0xe6f2ff, 0xa89878, 1.5); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0006; this.sun.shadow.normalBias = 0.02; this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.fx = new Effects(this.scene);
    this.view = new ViewModel();
    this.avatars = new Map();
    this.items = new Map();
    this.pmrem = new THREE.PMREMGenerator(this.gl);
    this.rung = -1; this.auto = { rung: 2, ceiling: 3, low: 0 }; this.calls = 0; this.tris = 0;
    this.setQuality('auto');
  }
  // 'auto' | 'low' | 'medium' | 'high'. Auto starts at medium and adapts.
  setQuality(q, adaptive = q === 'auto') {
    this.adaptive = adaptive;
    const rung = QUALITY_RUNG[q] ?? 2;
    this.auto = { rung, ceiling: q === 'auto' ? 3 : rung, low: 0 };
    this.setRung(rung);
  }
  // Auto Detail: called twice a second with the frame rate.
  adapt(fps) { if (this.adaptive) this.setRung(adaptRung(this.auto, fps)); }
  setRung(r) {
    if (r === this.rung) return;
    this.rung = r; const q = this.q = RUNGS[r];
    this.post.configure(q.post, q.levels, q.samples);
    // Shadows stay on (switching them off would need every material recompiled); the map shrinks.
    this.sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    if (this.sky) this.sky.material.uniforms.clouds.value = q.clouds ? 1 : 0;
    this.fx.detail = q.particles;
    this.resize();
  }
  get detail() { return this.rung; }
  resize() {
    const w = innerWidth, h = innerHeight, q = this.q || RUNGS[2], dpr = Math.min(q.dpr, devicePixelRatio || 1) * q.scale;
    this.gl.setPixelRatio(dpr); this.gl.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.view.resize(w / h);
    this.post.resize();
  }
  loadMap(map) {
    if (this.world) { this.scene.remove(this.world); this.world.traverse(o => o.geometry?.dispose()); }
    for (const m of this.items.values()) this.scene.remove(m.userData.beam);
    for (const a of this.avatars.values()) this.scene.remove(a.group);
    this.avatars.clear();
    for (const m of this.items.values()) this.scene.remove(m);
    this.items.clear();
    if (this.sky) { this.scene.remove(this.sky); this.sky.material.dispose(); }
    const meta = map.meta, g = map.grid, kind = meta.sky || 'day', s = SKIES[kind] || SKIES.day;
    this.world = buildWorld(map); this.scene.add(this.world);
    const fog = meta.fog || { color: s.bottom, near: 40, far: 120 };
    const sun = meta.sun || { dir: [-0.4, 0.8, -0.3], color: s.sun, intensity: 2.2 };
    const d = new THREE.Vector3(...sun.dir).normalize();
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMaterial(kind, fog.color, d, sun.color));
    this.sky.renderOrder = -1; this.sky.frustumCulled = false; this.sky.material.uniforms.clouds.value = this.q.clouds ? 1 : 0;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    const c = new THREE.Vector3(g.w / 2, 0, g.d / 2), R = Math.hypot(g.w, g.d, g.h) / 2 + 2;
    this.sunDir = d;
    this.sun.position.copy(c).addScaledVector(d, R * 2); this.sun.target.position.copy(c);
    this.sun.color.setHex(sun.color); this.sun.intensity = sun.intensity * 1.05;
    const sc = this.sun.shadow.camera; sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = R * 4; sc.updateProjectionMatrix();
    this.hemi.color.setHex(s.hemi[0]); this.hemi.groundColor.setHex(s.hemi[1]);
    this.hemi.intensity = (meta.ambient ?? 1.1) * 1.35;
    // Reflections: the sky (sun and clouds included) baked once into a prefiltered environment, which
    // the eggs' shells, the guns' metal and the props pick up.
    this.env?.dispose();
    const envScene = new THREE.Scene(), envSky = new THREE.Mesh(this.sky.geometry, this.sky.material);
    envSky.frustumCulled = false; envScene.add(envSky);
    this.env = this.pmrem.fromScene(envScene, 0, 0.1, 1000);
    this.scene.environment = this.env.texture; this.view.scene.environment = this.env.texture;
    for (const it of map.items) {
      const m = it.kind === 'ammo' ? (merged('ammo') || carton()) : (() => { const g = gunModel('grenade'); g.scale.setScalar(1.5); return g; })();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 1.3, 12, 1, true).translate(0, 0.65, 0), beamMaterial(it.kind === 'ammo' ? 0xffb43a : 0x7dff6a));
      beam.position.set(it.x, it.y - 0.3, it.z); beam.renderOrder = 2; this.scene.add(beam);
      m.userData.beam = beam;
      m.position.set(it.x, it.y, it.z); this.scene.add(m); this.items.set(map.items.indexOf(it), m);
    }
    this.spatula = merged('spatula') || spatulaModel(); this.spatula.visible = false; this.scene.add(this.spatula);
    this.roost = new THREE.Group(); this.roost.visible = false; this.scene.add(this.roost);
    this.roostRing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    this.roost.add(this.roostRing);
    this.crown = crownSprite(); this.scene.add(this.crown); this.crown.visible = false;
    this.fx.clear(); this.fx.setGrid(g);
    this.map = map;
    this.prewarm();
  }
  // Compile every shader the match can need now, so the first shot, flash or explosion never stalls a
  // frame (on a slow GPU each new shader can take a noticeable moment). Where the browser can compile
  // in parallel this doesn't block at all.
  prewarm() {
    const v = this.view, rootVis = v.root.visible, flashVis = v.flash.visible;
    v.root.visible = true; v.flash.visible = true; this.spatula.visible = true; this.crown.visible = true; this.roost.visible = true;
    const done = () => { v.root.visible = rootVis; v.flash.visible = flashVis; this.spatula.visible = false; this.crown.visible = false; this.roost.visible = false; };
    try {
      this.camera.updateMatrixWorld();
      this.gl.compile(this.scene, this.camera); this.gl.compile(v.scene, v.camera);
    } catch { /* compiled on first use instead */ }
    done();
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
    m.visible = active; m.userData.beam.visible = active;
    if (active) { m.rotation.y = t * 1.5 + i; m.position.y = this.map.items[i].y + Math.sin(t * 2.5 + i) * 0.05; m.userData.beam.material.uniforms.time.value = t + i; }
  }
  // Draw a frame. cam: { x, y, z, yaw, pitch, roll, fovMul, shakeX, shakeY }. fx: post effects.
  render(cam, dt, t, fx = {}) {
    this.camera.position.set(cam.x, cam.y, cam.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(cam.pitch + (cam.shakeX || 0), cam.yaw + (cam.shakeY || 0), cam.roll || 0);
    const fov = this.baseFov * (cam.fovMul || 1);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
    if (this.sky) { this.sky.position.copy(this.camera.position); this.sky.material.uniforms.time.value = t; }
    if (this.crown.visible) this.crown.material.opacity = 0.85 + Math.sin(t * 3) * 0.15;
    for (const o of this.world?.userData.pulses || []) o.material.opacity = 0.6 + Math.sin(t * 5) * 0.3;
    WIND.value = t;
    this.fx.update(dt, this.camera);
    // The hands are lit like the world around them: the sun's direction in camera space, the sky's
    // reflections turned to match where the camera looks.
    if (this.view.root.visible && this.sunDir) {
      _m.makeRotationFromEuler(this.camera.rotation).transpose();
      this.view.light(_v.copy(this.sunDir).applyMatrix4(_m), this.sun.color, this.sun.intensity, this.hemi.color, this.hemi.groundColor);
      this.view.scene.environmentRotation.setFromRotationMatrix(_m);
    }
    this.post.begin();
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    // (The world's own counts, shadows included, for the F3 overlay; three resets them every render.)
    this.calls = this.gl.info.render.calls; this.tris = this.gl.info.render.triangles;
    if (this.view.root.visible) { this.gl.clearDepth(); this.gl.render(this.view.scene, this.view.camera); this.calls += this.gl.info.render.calls; this.tris += this.gl.info.render.triangles; }
    this.post.end({ ...fx, time: t });
  }
  // A reflection environment from one of the skies (for scenes without a map: the home screen).
  skyEnvironment(kind = 'day', fog = 0xcfe6ef) {
    const s = SKIES[kind] || SKIES.day, envScene = new THREE.Scene();
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMaterial(kind, fog, new THREE.Vector3(-0.5, 0.75, 0.45).normalize(), s.sun));
    sky.frustumCulled = false; envScene.add(sky);
    const rt = this.pmrem.fromScene(envScene, 0, 0.1, 1000);
    sky.geometry.dispose(); sky.material.dispose();
    return rt.texture;
  }
  // Any other scene (the home screen) through the same pipeline.
  renderScene(scene, camera, t, clear = 0x000000) {
    this.post.begin();
    this.gl.setClearColor(clear, 1); this.gl.clear(); this.gl.render(scene, camera);
    this.post.end({ time: t });
  }
}

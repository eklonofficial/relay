// The 3D scene: sky, sun and shadows, the map, eggs, pickups, the spatula, the roost, effects and
// the first-person hands, then post-processing. The game canvas (#game) lives outside the compositor
// so WebGL and pointer lock work natively; this module only draws into it.
//
// Graphics quality comes in rungs (low, medium-low, medium, high), and within a rung the 3D view's
// resolution moves (dynamic resolution) while the HUD and the final image stay sharp at the
// screen's own resolution. Auto Detail starts where the GPU suggests (Chromebooks and software
// rendering start low), first trades resolution for frame rate, then steps rungs down when that is
// not enough (never climbing back above a rung it had to leave), so a Chromebook settles on what it
// can hold at 60 and a desktop GPU gets the full picture.
//
// What makes the low rungs cheap: the world's sun shadows are drawn into the shadow map once per
// map (the map never moves) instead of every frame, and eggs get a soft blob shadow instead; no
// muzzle-flash or explosion lights and no sky reflections (each costs every pixel of every lit
// surface); no bloom or multisampling; fewer particles.
import * as THREE from '../../vendor/three/three.module.js?v=muwxo6oz';
import { buildWorld } from './world.js?v=muwxo6oz';
import { EggAvatar, TEAM_COLORS } from './egg.js?v=muwxo6oz';
import { Effects } from './fx.js?v=muwxo6oz';
import { ViewModel } from './viewmodel.js?v=muwxo6oz';
import { gunModel } from './guns.js?v=muwxo6oz';
import { Kit, kitMaterial } from './kit.js?v=muwxo6oz';
import { clone, merged } from './models.js?v=muwxo6oz';
import { noiseTexture, WIND } from './materials.js?v=muwxo6oz';
import { Post } from './post.js?v=muwxo6oz';

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
// The ammo pickup: an open egg carton, six eggs in their cups and the lid tipped back (one draw).
let cartonGeo = null;
function carton() {
  if (!cartonGeo) {
    const k = new Kit({ card: [0xe9a64b, 0.85, 0, 0], cardLight: [0xffd27a, 0.85, 0, 0], cream: [0xfff3d6, 0.5, 0, 0], label: [0xd8452f, 0.6, 0, 0] }, false);
    k.box('card', [0, 0.04, 0], [0.36, 0.08, 0.24], 0.01);
    k.box('cardLight', [0, 0.11, 0.135], [0.36, 0.03, 0.24], 0.01, [-0.25 + Math.PI / 2, 0, 0]);
    k.box('label', [0, 0.04, -0.121], [0.16, 0.05, 0.004], 0.001);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      k.dome('card', [-0.11 + i * 0.11, 0.07, -0.05 + j * 0.1], 0.045, [1, 0.7, 1], 8, 3, Math.PI);
      k.ball('cream', [-0.11 + i * 0.11, 0.12, -0.05 + j * 0.1], 0.035, [0.9, 1.15, 0.9], 8, 6);
    }
    cartonGeo = k.geometry();
  }
  const m = new THREE.Mesh(cartonGeo, kitMaterial()); const g = new THREE.Group(); g.add(m); return g;
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

// Quality rungs (see the header). dpr: the most device pixels per CSS pixel the 3D view draws;
// scale: its resolution at most (dynamic resolution moves between minScale and scale); levels:
// bloom steps; samples: MSAA on the HDR target; lights: the flash and explosion lights; env: sky
// reflections; live: egg shadows in the shadow map, redrawn every frame (otherwise blob shadows).
export const RUNGS = [
  { name: 'low', levels: 0, samples: 0, dpr: 1, scale: 0.8, minScale: 0.5, shadow: 1024, clouds: false, particles: 0.5, lights: false, env: false, live: false },
  { name: 'medium-low', levels: 3, samples: 0, dpr: 1, scale: 0.9, minScale: 0.6, shadow: 1024, clouds: true, particles: 0.75, lights: true, env: true, live: false },
  { name: 'medium', levels: 4, samples: 4, dpr: 1, scale: 1, minScale: 0.7, shadow: 2048, clouds: true, particles: 1, lights: true, env: true, live: false },
  { name: 'high', levels: 5, samples: 4, dpr: 1.5, scale: 1, minScale: 0.8, shadow: 2048, clouds: true, particles: 1, lights: true, env: true, live: true },
];
// The HUD and the final image are drawn at up to this many device pixels per CSS pixel.
export const UI_DPR = 1.5;
export const QUALITY_RUNG = { low: 0, medium: 2, high: 3 };
// The Auto Detail ladder, pure so it can be tested: given the half-second frame rate, returns the
// state's next rung. Drops after 2 s under 45 fps; climbs after 5 s at 60, but never above a rung
// it has had to leave.
export function adaptRung(st, fps) {
  if (fps < 45) { if (st.low < 0) st.low = 0; if (++st.low >= 4) { st.low = 0; if (st.rung > 0) { st.ceiling = st.rung - 1; st.rung--; } } }
  else if (fps > 57 && st.rung < st.ceiling) { if (st.low > 0) st.low = 0; if (--st.low <= -10) { st.low = 0; st.rung++; } }
  else st.low = 0;
  return st.rung;
}

// Dynamic resolution, pure so it can be tested: given the half-second frame rate, moves st.res
// (between min and max) and says whether it changed. Under 50 fps for a second: 10% less. At 58
// or better for four seconds: 5% more.
export function adaptScale(st, fps) {
  if (fps < 50) { st.fast = 0; if (st.res > st.min && ++st.slow >= 2) { st.slow = 0; st.res = Math.max(st.min, Math.round((st.res - 0.1) * 100) / 100); return true; } }
  else if (fps >= 58) { st.slow = 0; if (st.res < st.max && ++st.fast >= 8) { st.fast = 0; st.res = Math.min(st.max, Math.round((st.res + 0.05) * 100) / 100); return true; } }
  else { st.slow = 0; st.fast = 0; }
  return false;
}
// What the GPU suggests for a start: 0 software rendering (Chrome without a usable GPU), 1 a
// Chromebook or a phone-class / basic integrated GPU, 2 anything else.
export function gpuTier(renderer, ua = '') {
  const name = String(renderer || '');
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) return 0;
  if (/\bCrOS\b/.test(ua) || /mali|powervr|adreno|vivante|videocore|apple gpu|intel.*\b(hd|uhd) graphics|gma/i.test(name)) return 1;
  return 2;
}
const BLOBS = 32;
function blobTexture() {
  const c = new OffscreenCanvas(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.55, 'rgba(0,0,0,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _c = new THREE.Color(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    // No multisampling on the canvas itself: the 3D view is drawn into its own (multisampled where the
    // rung allows) target and the canvas only receives the finished image and the HUD.
    // (Opaque: the browser can put the frame on screen without blending it with the page behind.)
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: false });
    this.gl.debug.checkShaderErrors = false;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NeutralToneMapping; this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true; this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.shadowMap.autoUpdate = false; this.gl.shadowMap.needsUpdate = true;
    this.gl.autoClear = false;
    const ctx = this.gl.getContext();
    let gpu = '';
    try { const ext = ctx.getExtension('WEBGL_debug_renderer_info'); gpu = ctx.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER); } catch { /* unknown GPU */ }
    this.gpuName = String(gpu || ''); this.tier = gpuTier(this.gpuName, navigator.userAgent);
    // The final image and HUD: up to 1.5 device pixels per CSS pixel, 1.25 on Chromebook-class GPUs
    // (their screens are often 2x, and every pixel of the last pass costs), 1 in software.
    this.uiDpr = [1, 1.25, UI_DPR][this.tier];
    this.post = new Post(this.gl);
    // The HUD: a 2D canvas laid over the finished frame (premultiplied, so it blends exactly as the
    // page would have drawn it).
    this.hudScene = new THREE.Scene(); this.hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.hudMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null } }, depthTest: false, depthWrite: false, transparent: true, toneMapped: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = texture2D(map, vec2(vUv.x, 1.0 - vUv.y)); }',
    });
    const tri = new THREE.BufferGeometry(); tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.hudQuad = new THREE.Mesh(tri, this.hudMat); this.hudQuad.frustumCulled = false; this.hudScene.add(this.hudQuad);
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
    // Blob shadows under the eggs (one instanced draw), where egg shadows aren't in the shadow map.
    this.blobs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false }), BLOBS);
    this.blobs.frustumCulled = false; this.blobs.count = 0; this.blobs.renderOrder = 1; this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(this.blobs);
    this.rung = -1; this.auto = { rung: 2, ceiling: 3, low: 0 }; this.dyn = { res: 1, min: 0.7, max: 1, slow: 0, fast: 0 }; this.calls = 0; this.tris = 0;
    this.setQuality('auto');
  }
  // 'auto' | 'low' | 'medium' | 'high'. Auto starts where the GPU suggests and adapts.
  setQuality(q, adaptive = q === 'auto') {
    this.adaptive = adaptive;
    const rung = q === 'auto' ? (this.tier === 2 ? 2 : 0) : QUALITY_RUNG[q] ?? 2;
    this.auto = { rung, ceiling: q === 'auto' ? 3 : rung, low: 0 };
    this.rung = -1; this.setRung(rung);
    if (q === 'auto' && this.tier === 0) { this.dyn.res = 0.6; this.resize(); }
  }
  // Auto Detail, called twice a second with the frame rate: resolution moves first; once it can't
  // help (at its floor, or at full resolution with frames to spare), the rung moves.
  adapt(fps) {
    if (!this.adaptive) return;
    const d = this.dyn;
    if ((fps < 50 && d.res > d.min) || (fps >= 58 && d.res < d.max)) { if (adaptScale(d, fps)) this.resize(); this.auto.low = 0; return; }
    const r = adaptRung(this.auto, fps);
    if (r !== this.rung) { const up = r > this.rung; this.setRung(r); d.res = up ? d.min : d.max; this.resize(); }
  }
  setRung(r) {
    if (r === this.rung) return;
    const was = this.q;
    this.rung = r; const q = this.q = RUNGS[r];
    this.dyn.min = q.minScale; this.dyn.max = q.scale; this.dyn.res = Math.min(q.scale, Math.max(q.minScale, this.dyn.res));
    this.post.configure(true, q.levels, q.samples);
    this.sun.shadow.mapSize.set(q.shadow, q.shadow); this.sun.shadow.radius = q.shadow > 1024 ? 3 : 2;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.gl.shadowMap.autoUpdate = q.live; this.gl.shadowMap.needsUpdate = true;
    for (const a of this.avatars.values()) a.shell.castShadow = q.live;
    if (this.sky) this.sky.material.uniforms.clouds.value = q.clouds ? 1 : 0;
    this.fx.detail = q.particles;
    // Lights and reflections change what every lit material's shader is, so they only switch when
    // they have to (the next frame compiles the new versions).
    if (!was || was.lights !== q.lights) this.fx.lights(q.lights);
    if (!was || was.env !== q.env) this.applyEnv();
    this.resize();
    if (was && this.map && (was.lights !== q.lights || was.env !== q.env || was.levels !== q.levels)) this.prewarm();
  }
  // (The hands always keep their reflections: guns are metal, and without the sky to reflect metal
  // turns black. They are a small, cheap scene.)
  applyEnv() { this.scene.environment = this.q?.env && this.env ? this.env.texture : null; this.view.scene.environment = this.env ? this.env.texture : null; }
  get detail() { return this.rung; }
  get resolution() { return this.dyn.res; }
  resize() {
    const w = innerWidth, h = innerHeight, q = this.q || RUNGS[2], dev = devicePixelRatio || 1;
    // The canvas (final image and HUD) at the screen's own sharpness; the 3D view at the rung's.
    const ui = Math.min(this.uiDpr ?? UI_DPR, dev), view = Math.min(q.dpr, dev) * this.dyn.res;
    this.viewScale = Math.min(1, view / ui);
    if (this.post.supported) { this.gl.setPixelRatio(ui); this.post.scale = this.home ? 1 : this.viewScale; }
    else this.gl.setPixelRatio(view);
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this.view.resize(w / h);
    this.post.resize();
  }
  // Blob shadows for this frame: [x, floorY, z, size, strength] per egg.
  setBlobs(list) {
    const n = this.q.live ? 0 : Math.min(BLOBS, list.length);
    for (let i = 0; i < n; i++) {
      const [x, y, z, size, k] = list[i];
      _s.set(size * k, 1, size * k); _v.set(x, y + 0.01, z);
      this.blobs.setMatrixAt(i, _m.compose(_v, _q.identity(), _s));
    }
    this.blobs.count = n; this.blobs.instanceMatrix.needsUpdate = true;
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
    this.gl.shadowMap.needsUpdate = true;
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
    this.applyEnv();
    for (const it of map.items) {
      const m = it.kind === 'ammo' ? carton() : (() => { const g = gunModel('grenade'); g.scale.setScalar(1.5); return g; })();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.2, 1.3, 12, 1, true).translate(0, 0.65, 0), beamMaterial(it.kind === 'ammo' ? 0xffb43a : 0x7dff6a));
      beam.position.set(it.x, it.y - 0.3, it.z); beam.renderOrder = 2; this.scene.add(beam);
      m.userData.beam = beam;
      m.traverse(o => { o.castShadow = false; });   // (the shadow map is drawn once; pickups come and go)
      m.position.set(it.x, it.y, it.z); this.scene.add(m); this.items.set(map.items.indexOf(it), m);
    }
    this.spatula = merged('spatula') || spatulaModel(); this.spatula.visible = false; this.spatula.traverse(o => { o.castShadow = false; }); this.scene.add(this.spatula);
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
    const v = this.view, rootVis = v.root.visible, flashVis = v.flash.visible, n = this.blobs.count;
    v.root.visible = true; v.flash.visible = true; this.spatula.visible = true; this.crown.visible = true; this.roost.visible = true; this.blobs.count = 1;
    // Stand-in eggs (another player's and a teammate's) so the eggs' materials compile now too.
    const eggs = [new EggAvatar({ name: 'x', look: { hat: 'cap' } }), new EggAvatar({ name: 'y', team: 1, friendly: true })];
    for (const e of eggs) { e.group.position.copy(this.camera.position); this.scene.add(e.group); }
    const done = () => { v.root.visible = rootVis; v.flash.visible = flashVis; this.spatula.visible = false; this.crown.visible = false; this.roost.visible = false; this.blobs.count = n; for (const e of eggs) { this.scene.remove(e.group); e.dispose(); } };
    if (!v.gun) v.setWeapon('yolk47');
    try {
      // (Into the target the frame really draws into: shaders differ by where they write.)
      this.camera.updateMatrixWorld(); this.post.begin();
      this.gl.compile(this.scene, this.camera); this.gl.compile(v.scene, v.camera);
    } catch { /* compiled on first use instead */ }
    this.gl.setRenderTarget(null);
    try { this.gl.compile(this.hudScene, this.hudCam); } catch { /* on first use */ }
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
    if (!a) { a = new EggAvatar(opts); a.shell.castShadow = this.q.live; this.avatars.set(id, a); this.scene.add(a.group); }
    return a;
  }
  dropAvatar(id) { const a = this.avatars.get(id); if (a) { this.scene.remove(a.group); a.dispose(); this.avatars.delete(id); } }
  setItem(i, active, t) {
    const m = this.items.get(i); if (!m) return;
    m.visible = active; m.userData.beam.visible = active;
    if (active) { m.rotation.y = t * 1.5 + i; m.position.y = this.map.items[i].y + Math.sin(t * 2.5 + i) * 0.05; m.userData.beam.material.uniforms.time.value = t + i; }
  }
  // Point the camera (also done by render(); call it first to project HUD markers for this frame).
  place(cam) {
    // A fraction of a millimetre off the grid: maps are built on whole and half cells and spawns face
    // exact angles, which can put a world vertex exactly in the camera's plane (w = 0). Hardware
    // clips that fine, but Chrome's software renderer (used where the GPU is blocklisted) turns the
    // clipped triangle's colours into NaN.
    this.camera.position.set(cam.x + 1.37e-4, cam.y + 0.73e-4, cam.z + 1.09e-4);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(cam.pitch + (cam.shakeX || 0), cam.yaw + (cam.shakeY || 0), cam.roll || 0);
    const fov = this.baseFov * (cam.fovMul || 1);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
  }
  // Draw a frame. cam: { x, y, z, yaw, pitch, roll, fovMul, shakeX, shakeY }. fx: post effects. hud:
  // the HUD (its canvas is laid over the frame; re-uploaded only when it changed), or null.
  render(cam, dt, t, fx = {}, hud = null) {
    if (this.home) { this.home = false; this.post.setScale(this.viewScale); }
    this.place(cam);
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
    if (hud) this.drawHud(hud);
  }
  // The HUD's two layers (hud.js): the panel, then the live layer; each re-uploaded only when it
  // changed.
  drawHud(hud) {
    this.hudLayers ??= [{ key: 'panel', dirty: 'panelDirty' }, { key: 'canvas', dirty: 'dirty' }].map(l => { const mesh = new THREE.Mesh(this.hudQuad.geometry, this.hudMat.clone()); mesh.frustumCulled = false; return { ...l, tex: null, mesh }; });
    this.gl.setRenderTarget(null);
    for (const l of this.hudLayers) {
      const c = hud[l.key];
      if (!l.tex || l.tex.image !== c || l.tex.image.width !== l.w || l.tex.image.height !== l.h) {
        l.tex?.dispose();
        l.tex = new THREE.CanvasTexture(c); l.tex.premultiplyAlpha = true; l.tex.flipY = false; l.tex.generateMipmaps = false;
        l.tex.minFilter = THREE.LinearFilter; l.tex.magFilter = THREE.LinearFilter; l.tex.colorSpace = THREE.NoColorSpace;
        l.mesh.material.uniforms.map.value = l.tex; l.w = c.width; l.h = c.height; hud[l.dirty] = true;
      }
      if (hud[l.dirty]) { l.tex.needsUpdate = true; hud[l.dirty] = false; }
      this.gl.render(l.mesh, this.hudCam);
    }
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
  // (The home screen is one egg on a turntable: it always gets full resolution.)
  renderScene(scene, camera, t, clear = 0x000000) {
    if (!this.home) { this.home = true; this.post.setScale(1); }
    this.gl.shadowMap.needsUpdate = true;
    this.post.begin();
    this.gl.setClearColor(clear, 1); this.gl.clear(); this.gl.render(scene, camera);
    this.post.end({ time: t });
  }
}

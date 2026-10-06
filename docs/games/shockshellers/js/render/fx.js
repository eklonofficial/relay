// Effects (GDD §25): bullet streaks and tracers, wall impacts (dust, chips and sparks in the colours
// of what was hit), muzzle flashes, rocket smoke trails, explosions (flash, fireball, sparks, debris,
// a rising smoke column, a ground shockwave and a scorch mark), yolk hit splashes, egg shatter shards
// and yolk splats, plus the world objects that move: rockets and grenades (with the pre-detonation
// blink).
//
// Everything is pooled and instanced, so a firefight costs a fixed handful of draw calls however much
// is flying: one per particle blend mode, one per shard shape, one each for streaks, chips and the
// three kinds of decal. Lights never come and go during play (that would recompile every material);
// two point lights stay in the scene and are just turned up and down. Nothing allocates per frame.
import * as THREE from '../../vendor/three/three.module.js?v=muwqd5r4';
import { gunModel } from './guns.js?v=muwqd5r4';
import { TEAM_COLORS } from './egg.js?v=muwqd5r4';

const rnd = () => Math.random() * 2 - 1;
// Approximate colours of each map material family (maps/dsl.js MAT), for dust and chips.
const SURFACE = [0xc9c3b6, 0x78ad43, 0xb07a45, 0xb3593d, 0xe6d3a0, 0x8c96a0, 0x8f6a45, 0xece5d6, 0x8c3b2a, 0x86827e, 0xf2f7fb, 0xc9ced6, 0xc49058, 0xe6c35c, 0xa7a9ac, 0xe8b42e, 0x4f9a3a, 0x4aa3d8, 0xd24b3e, 0x3f7fd6];
const METAL = new Set([5, 11, 15]);

// ---- textures ----
// The particle atlas, 2×2 tiles: 0 a soft puff of smoke, 1 a round glow, 2 a glossy yolk blob, 3 a spark.
function atlas() {
  const S = 128, c = new OffscreenCanvas(S * 2, S * 2), x = c.getContext('2d');
  // Tile t sits at column t % 2, row t >> 1 counted from the BOTTOM (textures are flipped on upload).
  const at = t => [(t % 2) * S, (1 - (t >> 1)) * S];
  let [ox, oy] = at(0);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2, r = 22 + (i % 3) * 6, cx = ox + 64 + Math.cos(a) * 20, cy = oy + 64 + Math.sin(a) * 20;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(ox, oy, S, S);
  }
  let g = x.createRadialGradient(ox + 64, oy + 64, 0, ox + 64, oy + 64, 34); g.addColorStop(0, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(ox, oy, S, S);
  [ox, oy] = at(1);
  g = x.createRadialGradient(ox + 64, oy + 64, 0, ox + 64, oy + 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.75)'); g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(ox, oy, S, S);
  [ox, oy] = at(2);
  g = x.createRadialGradient(ox + 54, oy + 54, 0, ox + 64, oy + 64, 56);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,1)'); g.addColorStop(0.32, 'rgba(235,235,235,1)'); g.addColorStop(0.85, 'rgba(200,200,200,0.95)'); g.addColorStop(1, 'rgba(200,200,200,0)');
  x.fillStyle = g; x.beginPath(); x.arc(ox + 64, oy + 64, 56, 0, Math.PI * 2); x.fill();
  [ox, oy] = at(3);
  g = x.createRadialGradient(ox + 64, oy + 64, 0, ox + 64, oy + 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.15, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.save(); x.translate(ox + 64, oy + 64); x.scale(1, 0.35); x.beginPath(); x.arc(0, 0, 64, 0, Math.PI * 2); x.restore(); x.fill();
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
// Scorch: a sooty star burst with a dark centre.
function scorch(size = 128) {
  const c = new OffscreenCanvas(size, size), x = c.getContext('2d'), m = size / 2;
  let s = 31; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 22; i++) { const a = r() * 6.28, L = size * (0.25 + r() * 0.22); x.strokeStyle = `rgba(20,16,12,${0.25 + r() * 0.3})`; x.lineWidth = 3 + r() * 6; x.beginPath(); x.moveTo(m, m); x.lineTo(m + Math.cos(a) * L, m + Math.sin(a) * L); x.stroke(); }
  const g = x.createRadialGradient(m, m, 0, m, m, m * 0.8); g.addColorStop(0, 'rgba(14,10,8,0.85)'); g.addColorStop(0.5, 'rgba(20,16,12,0.45)'); g.addColorStop(1, 'rgba(20,16,12,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// A ring for the explosion shockwave.
function ringTex(size = 128) {
  const c = new OffscreenCanvas(size, size), x = c.getContext('2d'), m = size / 2;
  const g = x.createRadialGradient(m, m, m * 0.55, m, m, m);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---- instanced billboard particles ----
const P_VERT = `attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iMisc; attribute vec3 iVel;
  varying vec2 vUv; varying vec4 vCol;
  #include <fog_pars_vertex>
  void main(){
    float size = iMisc.x, rot = iMisc.y, tile = iMisc.z, stretch = iMisc.w;
    vec4 mvPosition = modelViewMatrix * vec4(iPos, 1.0);
    vec2 k = position.xy;
    if (stretch > 0.0) {
      vec2 sv = (modelViewMatrix * vec4(iVel, 0.0)).xy; float l = length(sv);
      vec2 ax = l > 1e-4 ? sv / l : vec2(1.0, 0.0);
      mvPosition.xy += ax * k.x * size * (1.0 + stretch * l) + vec2(-ax.y, ax.x) * k.y * size;
    } else { float c = cos(rot), s = sin(rot); mvPosition.xy += mat2(c, s, -s, c) * k * size; }
    gl_Position = projectionMatrix * mvPosition;
    vUv = (uv + vec2(mod(tile, 2.0), floor(tile * 0.5))) * 0.5; vCol = iCol;
    #include <fog_vertex>
  }`;
const P_FRAG = `uniform sampler2D atlas; varying vec2 vUv; varying vec4 vCol;
  #include <fog_pars_fragment>
  void main(){ vec4 t = texture2D(atlas, vUv); gl_FragColor = vec4(t.rgb * vCol.rgb, t.a * vCol.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;
class Particles {
  constructor(scene, map, additive, n) {
    const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.misc = new Float32Array(n * 4); this.vel = new Float32Array(n * 3);
    for (const [name, arr, k] of [['iPos', this.pos, 3], ['iCol', this.col, 4], ['iMisc', this.misc, 4], ['iVel', this.vel, 3]]) { const a = new THREE.InstancedBufferAttribute(arr, k); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); }
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { atlas: { value: null } }]), vertexShader: P_VERT, fragmentShader: P_FRAG,
      transparent: true, depthWrite: false, fog: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    mat.uniforms.atlas.value = map;
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 4 : 3; scene.add(this.mesh);
    this.geo = g; this.n = n; this.next = 0;
    // Simulation state, one slot per particle.
    this.life = new Float32Array(n); this.max = new Float32Array(n); this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    this.size = new Float32Array(n); this.grow = new Float32Array(n); this.rot = new Float32Array(n); this.spin = new Float32Array(n);
    this.rgb = new Float32Array(n * 3); this.a = new Float32Array(n); this.tile = new Uint8Array(n); this.drag = new Float32Array(n); this.grav = new Float32Array(n); this.stretch = new Float32Array(n); this.fadeIn = new Float32Array(n);
  }
  // o: { size, grow, life, color (hex), bright (HDR multiplier), alpha, tile, drag, gravity, spin, stretch, fadeIn }
  emit(x, y, z, vx, vy, vz, o) {
    const i = this.next; this.next = (i + 1) % this.n;
    this.life[i] = this.max[i] = o.life; this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.size[i] = o.size; this.grow[i] = o.grow || 0; this.rot[i] = Math.random() * 6.28; this.spin[i] = o.spin ?? rnd() * 1.5;
    const c = o.color ?? 0xffffff, b = o.bright ?? 1;
    this.rgb[i * 3] = ((c >> 16) & 255) / 255 * b; this.rgb[i * 3 + 1] = ((c >> 8) & 255) / 255 * b; this.rgb[i * 3 + 2] = (c & 255) / 255 * b;
    this.a[i] = o.alpha ?? 1; this.tile[i] = o.tile ?? 0; this.drag[i] = o.drag ?? 1.5; this.grav[i] = o.gravity ?? 0; this.stretch[i] = o.stretch ?? 0; this.fadeIn[i] = o.fadeIn ?? 0;
  }
  clear() { this.life.fill(0); this.geo.instanceCount = 0; }
  update(dt) {
    let k = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const l = this.life[i] -= dt; if (l <= 0) continue;
      const j = i * 3, f = Math.max(0, 1 - dt * this.drag[i]);
      this.v[j + 1] -= this.grav[i] * dt;
      this.v[j] *= f; this.v[j + 1] *= f; this.v[j + 2] *= f;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      this.size[i] = Math.max(0, this.size[i] + this.grow[i] * dt); this.rot[i] += this.spin[i] * dt;
      const age = 1 - l / this.max[i], fin = this.fadeIn[i] > 0 ? Math.min(1, age / this.fadeIn[i]) : 1;
      const alpha = this.a[i] * fin * Math.min(1, (l / this.max[i]) * 1.6);
      const o3 = k * 3, o4 = k * 4;
      this.pos[o3] = this.p[j]; this.pos[o3 + 1] = this.p[j + 1]; this.pos[o3 + 2] = this.p[j + 2];
      this.vel[o3] = this.v[j]; this.vel[o3 + 1] = this.v[j + 1]; this.vel[o3 + 2] = this.v[j + 2];
      this.col[o4] = this.rgb[j]; this.col[o4 + 1] = this.rgb[j + 1]; this.col[o4 + 2] = this.rgb[j + 2]; this.col[o4 + 3] = alpha;
      this.misc[o4] = this.size[i]; this.misc[o4 + 1] = this.rot[i]; this.misc[o4 + 2] = this.tile[i]; this.misc[o4 + 3] = this.stretch[i];
      k++;
    }
    this.geo.instanceCount = k;
    if (k) for (const name of ['iPos', 'iCol', 'iMisc', 'iVel']) { const a = this.geo.attributes[name]; a.clearUpdateRanges(); a.addUpdateRange(0, k * a.itemSize); a.needsUpdate = true; }
  }
}

// ---- instanced meshes with simple physics (shell shards, chips) ----
class Bits {
  constructor(scene, geo, mat, n, shadows) {
    this.mesh = new THREE.InstancedMesh(geo, mat, n); this.mesh.frustumCulled = false; this.mesh.castShadow = shadows;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.list = Array.from({ length: n }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: 1, floor: -Infinity }));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) { this.mesh.setMatrixAt(i, zero); this.mesh.setColorAt(i, c); }
    scene.add(this.mesh); this.next = 0; this.live = 0;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.sc = new THREE.Vector3(); this.c = new THREE.Color();
  }
  spawn(x, y, z, vx, vy, vz, size, life, color, floor = -Infinity) {
    const i = this.next, b = this.list[i]; this.next = (i + 1) % this.list.length;
    b.p.set(x, y, z); b.v.set(vx, vy, vz); b.r.set(Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3); b.w.set(rnd() * 18, rnd() * 18, rnd() * 6);
    b.s = size; b.life = b.max = life; b.floor = floor;
    this.mesh.setColorAt(i, this.c.setHex(color)); this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { for (const b of this.list) b.life = 0; this.update(0); }
  update(dt) {
    let live = 0;
    for (let i = 0; i < this.list.length; i++) {
      const b = this.list[i];
      if (b.life <= 0) { if (b.life > -1) { b.life = -1; this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0)); live++; } continue; }
      b.life -= dt; live++;
      b.v.y -= 9 * dt; b.p.addScaledVector(b.v, dt);
      if (b.p.y < b.floor + 0.02) {
        // Bounce once or twice, then lie still.
        b.p.y = b.floor + 0.02; if (b.v.y < 0) b.v.y *= -0.3; b.v.x *= 0.55; b.v.z *= 0.55; b.w.multiplyScalar(0.5);
        if (Math.abs(b.v.y) < 0.4) b.v.y = 0;
      }
      b.r.x += b.w.x * dt; b.r.y += b.w.y * dt; b.r.z += b.w.z * dt;
      const s = b.s * (b.life < 0.4 ? Math.max(0, b.life / 0.4) : 1);
      this.mesh.setMatrixAt(i, this.m.compose(b.p, this.q.setFromEuler(b.r), this.sc.setScalar(s)));
    }
    if (live) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---- decals: flat instanced quads stuck to surfaces, shrinking away at the end of their life ----
class Decals {
  constructor(scene, map, n, offset) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset }), n);
    this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; this.mesh.renderOrder = 1;
    this.list = Array.from({ length: n }, () => ({ life: 0, s: 1, m: new THREE.Matrix4() }));
    const zero = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh); this.next = 0; this.o = new THREE.Object3D(); this.tmp = new THREE.Matrix4();
  }
  add(x, y, z, nx, ny, nz, size, life) {
    const i = this.next, d = this.list[i]; this.next = (i + 1) % this.list.length;
    const o = this.o; o.position.set(x + nx * 0.01, y + ny * 0.01, z + nz * 0.01); o.scale.setScalar(1);
    o.lookAt(x + nx, y + ny, z + nz); o.rotateZ(Math.random() * 6.28); o.updateMatrix();
    d.m.copy(o.matrix); d.s = size; d.life = life;
    this.mesh.setMatrixAt(i, this.tmp.copy(d.m).scale(o.scale.setScalar(size))); this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { for (const d of this.list) d.life = 0; const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < this.list.length; i++) this.mesh.setMatrixAt(i, z); this.mesh.instanceMatrix.needsUpdate = true; }
  update(dt) {
    let dirty = false;
    for (let i = 0; i < this.list.length; i++) {
      const d = this.list[i]; if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life < 0.6) { const k = Math.max(0, d.life / 0.6) * d.s; this.mesh.setMatrixAt(i, this.tmp.copy(d.m).scale(this.o.scale.setScalar(k))); dirty = true; }
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene; this.detail = 1; this.grid = null;
    const tex = atlas();
    this.soft = new Particles(scene, tex, false, 640);    // smoke, dust, yolk
    this.glow = new Particles(scene, tex, true, 512);     // fire, flashes, sparks, embers
    // Bullet streaks: short bright segments flying along the real bullet path (they are projectiles).
    // Tracers are hotter (HDR) so they bloom.
    const sg = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true); sg.rotateX(Math.PI / 2); sg.translate(0, 0, -0.5);
    const streakMat = (c, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.streaks = [new THREE.InstancedMesh(sg, streakMat(0xfff1a8, 1.6), 96), new THREE.InstancedMesh(sg, streakMat(0xffa030, 4), 64)];
    this.streakList = this.streaks.map(m => Array.from({ length: m.count }, () => ({ live: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, left: 0, speed: 0, d: 0, q: new THREE.Quaternion(), len: 1, w: 1 })));
    this.streakNext = [0, 0];
    for (const m of this.streaks) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < m.count; i++) m.setMatrixAt(i, z); scene.add(m); }
    // Decals.
    this.holes = new Decals(scene, bulletHole(), 96, -2);
    this.splats = new Decals(scene, yolkSplat(), 24, -3);
    this.scorches = new Decals(scene, scorch(), 16, -4);
    // Shell shards: curved bits of shell (patches of a sphere the egg's size), lit on both faces.
    const shardMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, flatShading: true, side: THREE.DoubleSide, envMapIntensity: 0.6 });
    this.shards = [[0.5, 0.45], [0.35, 0.6], [0.6, 0.3], [0.3, 0.3]].map(([a, b]) => new Bits(scene, new THREE.SphereGeometry(0.3, 3, 2, 0, a, 1.2, b).translate(0, 0, -0.3).rotateX(Math.PI / 2), shardMat, 40, true));
    this.shardNext = 0;
    // Chips of wall and dirt from impacts and explosions.
    this.chips = new Bits(scene, new THREE.BoxGeometry(1, 0.6, 0.8), new THREE.MeshLambertMaterial({ color: 0xffffff }), 96, false);
    // Explosion shockwaves: flat rings growing along the ground.
    this.ringMat = new THREE.MeshBasicMaterial({ map: ringTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    this.rings = Array.from({ length: 4 }, () => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.ringMat.clone()); m.visible = false; m.userData = { t: 0, r: 1 }; m.renderOrder = 4; scene.add(m); return m; });
    // Two lights that only ever change brightness: muzzle flashes, and explosions.
    this.flash = new THREE.PointLight(0xffb060, 0, 7, 2); scene.add(this.flash); this.flashT = 0; this.flashMax = 0;
    this.boom = new THREE.PointLight(0xff9a40, 0, 12, 2); scene.add(this.boom); this.boomT = 0; this.boomMax = 0;
    this.objects = new Map(); // id → mesh for rockets, grenades
    // (Streaks: the geometry runs along -z from its origin; pointing -z backwards makes it trail the head.)
    this.tmpM = new THREE.Matrix4(); this.tmpV = new THREE.Vector3(); this.up = new THREE.Vector3(0, 0, 1); this.sc = new THREE.Vector3();
  }
  setGrid(grid) { this.grid = grid; }
  // The two lights cost every lit pixel; the lowest rung goes without them (flashes still glow).
  lights(on) { for (const l of [this.flash, this.boom]) { if (on) this.scene.add(l); else this.scene.remove(l); } }
  clear() {
    this.soft.clear(); this.glow.clear(); this.holes.clear(); this.splats.clear(); this.scorches.clear();
    for (const s of this.shards) s.clear(); this.chips.clear();
    for (const l of this.streakList) for (const s of l) s.live = false;
    for (const r of this.rings) r.visible = false;
    for (const m of this.objects.values()) this.scene.remove(m); this.objects.clear();
  }
  n(k) { return Math.max(1, Math.round(k * this.detail)); }
  // The material family of the surface at a hit (the cell just behind the point), or -1.
  surfaceAt(x, y, z, nx, ny, nz) {
    const g = this.grid; if (!g) return -1;
    const cx = Math.floor(x - nx * 0.02), cy = Math.floor(y - ny * 0.02), cz = Math.floor(z - nz * 0.02);
    return g.inside(cx, cy, cz) && g.cells[g.index(cx, cy, cz)] ? g.tint[g.index(cx, cy, cz)] : -1;
  }
  streak(x, y, z, dx, dy, dz, len, speed, tracer) {
    const k = tracer ? 1 : 0, list = this.streakList[k], i = this.streakNext[k], s = list[i];
    this.streakNext[k] = (i + 1) % list.length;
    s.live = true; s.x = x; s.y = y; s.z = z; s.dx = dx; s.dy = dy; s.dz = dz; s.left = len; s.speed = speed * 30; s.d = 0;
    s.q.setFromUnitVectors(this.up, this.tmpV.set(dx, dy, dz)); s.len = Math.min(tracer ? 1.8 : 0.9, len); s.w = tracer ? 1.7 : 1;
  }
  impact(x, y, z, nx, ny, nz) {
    const mat = this.surfaceAt(x, y, z, nx, ny, nz), col = SURFACE[mat] ?? 0xd8d0c0;
    this.holes.add(x, y, z, nx, ny, nz, 0.085 + Math.random() * 0.025, 12);
    const px = x + nx * 0.05, py = y + ny * 0.05, pz = z + nz * 0.05;
    // A puff of dust in the surface's colour, thrown off the face.
    for (let i = 0; i < this.n(4); i++) this.soft.emit(px, py, pz, nx * (0.6 + Math.random()) + rnd() * 0.4, ny * 0.8 + Math.random() * 0.6, nz * (0.6 + Math.random()) + rnd() * 0.4, { size: 0.09 + Math.random() * 0.06, grow: 0.35, life: 0.5 + Math.random() * 0.3, color: col, alpha: 0.75, drag: 3, gravity: 0.4 });
    if (METAL.has(mat)) {
      // Metal sings: a burst of hot sparks.
      for (let i = 0; i < this.n(7); i++) this.glow.emit(px, py, pz, (nx + rnd() * 0.8) * (2 + Math.random() * 3), (ny + Math.random() * 0.8) * (2 + Math.random() * 2), (nz + rnd() * 0.8) * (2 + Math.random() * 3), { size: 0.02, life: 0.18 + Math.random() * 0.15, color: 0xffc070, bright: 4, tile: 3, drag: 1, gravity: 9, stretch: 0.25 });
      this.glow.emit(px, py, pz, 0, 0, 0, { size: 0.16, life: 0.05, color: 0xffd090, bright: 3, tile: 1, drag: 0 });
    } else {
      // Stone, wood and dirt chip: a few small bits fly off and fall.
      for (let i = 0; i < this.n(3); i++) this.chips.spawn(px, py, pz, (nx + rnd() * 0.6) * (1 + Math.random() * 2), (ny + Math.random()) * (1 + Math.random() * 1.5), (nz + rnd() * 0.6) * (1 + Math.random() * 2), 0.018 + Math.random() * 0.02, 0.7, col, ny > 0.7 ? y : -Infinity);
      if (Math.random() < 0.5) this.glow.emit(px, py, pz, nx * 2, ny * 2 + 1, nz * 2, { size: 0.015, life: 0.12, color: 0xffe0a0, bright: 3, tile: 3, gravity: 6, stretch: 0.25 });
    }
  }
  muzzle(x, y, z, big = false) {
    this.glow.emit(x, y, z, 0, 0, 0, { size: big ? 0.45 : 0.26, life: 0.05, color: 0xffd38a, bright: 3, tile: 1, drag: 0 });
    this.light(x, y, z, big ? 6 : 3.5, 0.06);
    this.soft.emit(x, y, z, rnd() * 0.2, 0.3, rnd() * 0.2, { size: 0.08, grow: 0.5, life: 0.6, color: 0xe8e4dc, alpha: 0.35, drag: 2, fadeIn: 0.2 });
  }
  // A brief light at a point (our own shots light up the walls around us too).
  light(x, y, z, intensity, time = 0.06) {
    if (intensity < this.flash.intensity && this.flashT > 0) return;
    this.flash.position.set(x, y, z); this.flash.intensity = this.flashMax = intensity; this.flashT = this.flashTime = time;
  }
  // Smoke curling off the muzzle after a burst (world space, from our own gun).
  wisp(x, y, z) { this.soft.emit(x, y, z, rnd() * 0.05, 0.25 + Math.random() * 0.15, rnd() * 0.05, { size: 0.035, grow: 0.12, life: 1.1, color: 0xf0ece6, alpha: 0.28, drag: 1.2, fadeIn: 0.3, spin: rnd() * 0.6 }); }
  hitSplash(x, y, z, dx, dy, dz) {
    // Yolk and white spray back towards the shooter, a puff, and a few shell flakes.
    for (let i = 0; i < this.n(7); i++) this.soft.emit(x, y, z, -dx * 1.4 + rnd() * 1.3, -dy * 1.4 + Math.random() * 1.6, -dz * 1.4 + rnd() * 1.3, { size: 0.05 + Math.random() * 0.05, grow: -0.04, life: 0.4 + Math.random() * 0.2, color: i % 3 ? 0xffc21a : 0xfff6dc, tile: 2, drag: 1, gravity: 6 });
    this.soft.emit(x, y, z, 0, 0.2, 0, { size: 0.12, grow: 0.6, life: 0.3, color: 0xfffaf0, alpha: 0.5, drag: 2 });
    for (let i = 0; i < this.n(3); i++) this.shard(x, y, z, 0xffffff, 0.6, -Infinity, null, 0.3);
  }
  // A shell fragment flung from (x,y,z); `out` pushes it away from the egg's centre. It bounces and
  // settles on `floor`, then shrinks away.
  shard(x, y, z, color, life = 2.5, floor = -Infinity, out = null, scale = 0.45) {
    const b = this.shards[this.shardNext = (this.shardNext + 1) % 4], s = scale * (0.6 + Math.random() * 0.8);
    if (out) b.spawn(x, y, z, out[0] * (2 + Math.random() * 2.5) + rnd() * 0.5, out[1] * 2 + 1.5 + Math.random() * 2.5, out[2] * (2 + Math.random() * 2.5) + rnd() * 0.5, s, life, color, floor);
    else b.spawn(x, y, z, rnd() * 1.5, 1.5 + Math.random() * 2.5, rnd() * 1.5, s, life, color, floor);
  }
  // Death: the shell bursts into a shower of curved pieces (in the egg's colour) flung outwards from
  // all over its surface, a yolk-and-white splash, and a splat left on the floor.
  shatter(x, y, z, color, floorY) {
    const n = this.n(22 + Math.floor(Math.random() * 8));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, h = Math.random();
      const o = [Math.cos(a), h - 0.3, Math.sin(a)];
      this.shard(x + o[0] * 0.25, y + 0.05 + h * 0.6, z + o[2] * 0.25, color, 2.2 + Math.random(), floorY, o, 0.7);
    }
    for (let i = 0; i < this.n(16); i++) this.soft.emit(x, y + 0.35, z, rnd() * 2.2, Math.random() * 3, rnd() * 2.2, { size: 0.09 + Math.random() * 0.1, grow: -0.05, life: 0.6 + Math.random() * 0.3, color: i % 4 ? 0xffb400 : 0xfff6dc, tile: 2, drag: 0.8, gravity: 7 });
    for (let i = 0; i < this.n(8); i++) this.soft.emit(x, y + 0.35, z, rnd() * 2.5, Math.random() * 2, rnd() * 2.5, { size: 0.16 + Math.random() * 0.1, grow: 0.5, life: 0.45, color: 0xfffaf0, alpha: 0.75, drag: 3 });
    this.splats.add(x, floorY + 0.002, z, 0, 1, 0, 1.0 + Math.random() * 0.35, 14);
  }
  explosion(x, y, z, radius, weapon, team = 0, floorY = null) {
    const big = weapon !== 'grenade';
    // The flash: a bright core and the light.
    this.glow.emit(x, y + 0.2, z, 0, 0, 0, { size: radius * 1.4, grow: radius * 2, life: 0.12, color: 0xfff0c8, bright: 5, tile: 1, drag: 0 });
    this.boom.position.set(x, y + 0.6, z); this.boom.intensity = this.boomMax = big ? 60 : 45; this.boom.distance = radius * 4.5; this.boomT = this.boomTime = 0.35;
    // The fireball: hot puffs boiling outwards and up, cooling from yellow to orange.
    for (let i = 0; i < this.n(18); i++) {
      const a = Math.random() * 6.28, b = Math.acos(rnd()), sp = 1.5 + Math.random() * radius * 1.2;
      const vx = Math.cos(a) * Math.sin(b), vy = Math.abs(Math.cos(b)) * 0.8 + 0.3, vz = Math.sin(a) * Math.sin(b);
      this.glow.emit(x + vx * 0.2, y + 0.25 + vy * 0.2, z + vz * 0.2, vx * sp, vy * sp, vz * sp, { size: 0.35 + Math.random() * 0.4, grow: 1.4, life: 0.3 + Math.random() * 0.25, color: i % 3 ? 0xff7a1e : 0xffc04a, bright: 1.7, tile: 1, drag: 4.5, gravity: -1.5 });
    }
    // Sparks and embers arcing out.
    for (let i = 0; i < this.n(22); i++) this.glow.emit(x, y + 0.3, z, rnd() * 9, 3 + Math.random() * 7, rnd() * 9, { size: 0.03, life: 0.5 + Math.random() * 0.6, color: 0xffb050, bright: 4, tile: 3, drag: 0.8, gravity: 9, stretch: 0.18 });
    // Smoke: a dark, rising, spreading column that lingers.
    for (let i = 0; i < this.n(14); i++) this.soft.emit(x + rnd() * radius * 0.3, y + 0.3 + Math.random() * 0.4, z + rnd() * radius * 0.3, rnd() * 1.4, 0.9 + Math.random() * 1.4, rnd() * 1.4, { size: 0.5 + Math.random() * 0.5, grow: 0.9, life: 1.8 + Math.random() * 1.2, color: i % 2 ? 0x3e3935 : 0x57504a, alpha: 0.85, drag: 1.2, gravity: -0.25, fadeIn: 0.12, spin: rnd() * 0.5 });
    // Debris and dust from the ground.
    const fy = floorY ?? y;
    const ground = this.surfaceAt(x, fy, z, 0, 1, 0), col = SURFACE[ground] ?? 0x8f6a45;
    for (let i = 0; i < this.n(14); i++) this.chips.spawn(x + rnd() * 0.3, fy + 0.15, z + rnd() * 0.3, rnd() * 5, 3 + Math.random() * 5, rnd() * 5, 0.03 + Math.random() * 0.04, 1.4, col, fy);
    // The shockwave along the ground, and a scorch where it went off.
    if (y - fy < radius * 0.8) {
      const r = this.rings.find(m => !m.visible) || this.rings[0];
      r.visible = true; r.position.set(x, fy + 0.04, z); r.userData.t = 0; r.userData.r = radius * 2.2;
      r.material.color.setHex(team ? TEAM_COLORS[team] : 0xffe2b0).multiplyScalar(2);
      this.scorches.add(x, fy + 0.003, z, 0, 1, 0, radius * 0.9, 20);
    }
  }
  // Small world cues: dust kicked up by a landing (in the colour of the ground), a ring of sparkles
  // where a pickup is collected or an egg spawns, a burst off a jump pad.
  dust(x, y, z, k = 1) {
    const col = SURFACE[this.surfaceAt(x, y, z, 0, 1, 0)] ?? 0xd8d0c0;
    for (let i = 0; i < this.n(6 * k); i++) { const a = i / 6 * Math.PI * 2 + Math.random(); this.soft.emit(x + Math.cos(a) * 0.15, y + 0.05, z + Math.sin(a) * 0.15, Math.cos(a) * 1.2 * k, 0.25 + Math.random() * 0.3, Math.sin(a) * 1.2 * k, { size: 0.09 + Math.random() * 0.06, grow: 0.5, life: 0.5 + Math.random() * 0.3, color: col, alpha: 0.6, drag: 3.5 }); }
  }
  sparkle(x, y, z, color = 0xffe08a, n = 12) {
    for (let i = 0; i < this.n(n); i++) { const a = Math.random() * 6.28, sp = 0.8 + Math.random() * 1.4; this.glow.emit(x, y, z, Math.cos(a) * sp, 0.6 + Math.random() * 1.8, Math.sin(a) * sp, { size: 0.035 + Math.random() * 0.03, life: 0.45 + Math.random() * 0.35, color, bright: 2.5, tile: 1, drag: 2, gravity: 2 }); }
    this.glow.emit(x, y, z, 0, 0, 0, { size: 0.5, grow: 1.5, life: 0.18, color, bright: 1.5, tile: 1, drag: 0 });
  }
  pad(x, y, z) {
    for (let i = 0; i < this.n(14); i++) { const a = i / 14 * Math.PI * 2; this.glow.emit(x + Math.cos(a) * 0.3, y + 0.05, z + Math.sin(a) * 0.3, Math.cos(a) * 0.6, 3 + Math.random() * 2, Math.sin(a) * 0.6, { size: 0.03, life: 0.4, color: 0x7af0ff, bright: 3, tile: 3, drag: 1.5, stretch: 0.2 }); }
  }
  dud(x, y, z) { for (let i = 0; i < this.n(6); i++) this.soft.emit(x, y, z, rnd() * 0.8, Math.random(), rnd() * 0.8, { size: 0.15, grow: 0.4, life: 0.6, color: 0xdddddd, alpha: 0.8, drag: 2 }); }

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
    this.soft.emit(x - dx * 0.2, y - dy * 0.2, z - dz * 0.2, rnd() * 0.15, 0.15, rnd() * 0.15, { size: 0.14, grow: 0.55, life: 1.3, color: 0xeeeeee, alpha: 0.8, drag: 1.5, fadeIn: 0.05 });
    this.glow.emit(x - dx * 0.22, y - dy * 0.22, z - dz * 0.22, -dx * 2, -dy * 2, -dz * 2, { size: 0.2, life: 0.07, color: 0xffb050, bright: 4, tile: 1, drag: 0 });
    m.userData.seen = true;
  }
  grenade(id, x, y, z, fuse, team) {
    let m = this.objects.get('g' + id);
    if (!m) { m = gunModel('grenade'); m.scale.setScalar(1.4); this.scene.add(m); this.objects.set('g' + id, m); }
    m.position.set(x, y, z); m.rotation.y += 0.15;
    // A team-tinted blink right before detonation (a glow, not a light: lights coming and going would
    // recompile every material).
    if (fuse < 15 && Math.floor(fuse / 2) % 2 === 0) this.glow.emit(x, y + 0.05, z, 0, 0, 0, { size: 0.5, life: 0.04, color: team ? TEAM_COLORS[team] : 0xffff60, bright: 3, tile: 1, drag: 0 });
    m.userData.seen = true;
  }
  // Drop objects not refreshed this frame.
  sweep() { for (const [k, m] of this.objects) { if (!m.userData.seen) { this.scene.remove(m); this.objects.delete(k); } else m.userData.seen = false; } }

  update(dt) {
    this.soft.update(dt); this.glow.update(dt);
    for (const s of this.shards) s.update(dt);
    this.chips.update(dt);
    this.holes.update(dt); this.splats.update(dt); this.scorches.update(dt);
    for (let k = 0; k < 2; k++) {
      const mesh = this.streaks[k], list = this.streakList[k]; let any = false;
      for (let i = 0; i < list.length; i++) {
        const s = list[i]; if (!s.live) continue;
        any = true;
        s.d += s.speed * dt;
        if (s.d >= s.left) { s.live = false; mesh.setMatrixAt(i, this.tmpM.makeScale(0, 0, 0)); continue; }
        this.tmpV.set(s.x + s.dx * s.d, s.y + s.dy * s.d, s.z + s.dz * s.d);
        mesh.setMatrixAt(i, this.tmpM.compose(this.tmpV, s.q, this.sc.set(s.w, s.w, Math.min(s.len, s.d + 0.05))));
      }
      if (any || mesh.userData.dirty) mesh.instanceMatrix.needsUpdate = true;
      mesh.userData.dirty = any;
    }
    for (const r of this.rings) {
      if (!r.visible) continue;
      const u = r.userData; u.t += dt; const f = u.t / 0.45;
      if (f >= 1) { r.visible = false; continue; }
      r.scale.setScalar(0.3 + u.r * (1 - (1 - f) * (1 - f))); r.material.opacity = (1 - f) * 0.9;
    }
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = this.flashT > 0 ? this.flashMax * (this.flashT / this.flashTime) : 0; }
    if (this.boomT > 0) { this.boomT -= dt; this.boom.intensity = this.boomT > 0 ? this.boomMax * (this.boomT / this.boomTime) ** 2 : 0; }
  }
}

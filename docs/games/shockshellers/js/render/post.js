// Post-processing: the frame is drawn into a half-float target (linear, unclamped; multisampled where
// the rung allows; at the dynamic resolution, often below the screen's), then one composite pass
// scales it up to the canvas, tone-maps it with a soft filmic shoulder, grades it, adds bloom, a
// vignette and the damage and low-health treatments, and dithers it.
//
// Bloom is the dual-filter kind (Bjørge, 2015): the bright part of the frame is shrunk through a few
// half-size steps and grown back, each step a handful of bilinear taps, so even a Chromebook's GPU
// spends well under a millisecond on it. Only things brighter than the scene's whites glow: muzzle
// flashes, explosions, tracers, the sun.
//
// Where half-float targets can't be rendered (WebGL 1, very old GPUs) the renderer skips all of
// this and draws straight to the canvas with three's own tone mapping, which looks nearly the same.
// scale: the 3D view's resolution as a fraction of the canvas's.
import * as THREE from '../../vendor/three/three.module.js?v=muzmf26a';

const VERT = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Down: the centre plus four diagonal bilinear taps (a 6x6 footprint). The first step also keeps only
// what is above the threshold (with a soft knee) and tames single bright pixels so they don't flicker.
const DOWN = `uniform sampler2D src; uniform vec2 texel; uniform float threshold; uniform float knee; uniform bool prefilter; varying vec2 vUv;
  vec3 pick(vec2 uv){ vec3 c = texture2D(src, uv).rgb;
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); // one bad pixel must never smear across the glow
    if (prefilter) { float br = max(c.r, max(c.g, c.b)); float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee); rq = rq * rq / (4.0 * knee + 1e-4);
      c *= max(rq, br - threshold) / max(br, 1e-4); c /= 1.0 + max(c.r, max(c.g, c.b)) * 0.25; }
    return c; }
  void main(){ vec2 h = texel;
    vec3 s = pick(vUv) * 4.0 + pick(vUv - h) + pick(vUv + h) + pick(vUv + vec2(h.x, -h.y)) + pick(vUv - vec2(h.x, -h.y));
    gl_FragColor = vec4(s / 8.0, 1.0); }`;
// Up: an eight-tap tent around the point, added on top of the larger level's own content.
const UP = `uniform sampler2D src; uniform vec2 texel; uniform float weight; varying vec2 vUv;
  void main(){ vec2 h = texel; vec3 s =
    texture2D(src, vUv + vec2(-h.x * 2.0, 0.0)).rgb + texture2D(src, vUv + vec2(-h.x, h.y)).rgb * 2.0 +
    texture2D(src, vUv + vec2(0.0, h.y * 2.0)).rgb + texture2D(src, vUv + vec2(h.x, h.y)).rgb * 2.0 +
    texture2D(src, vUv + vec2(h.x * 2.0, 0.0)).rgb + texture2D(src, vUv + vec2(h.x, -h.y)).rgb * 2.0 +
    texture2D(src, vUv + vec2(0.0, -h.y * 2.0)).rgb + texture2D(src, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
    gl_FragColor = vec4(s / 12.0 * weight, 1.0); }`;

// Light shafts (medium and high rungs): from each pixel, march towards the sun across the frame and
// gather how much open sky lies along the way (the sky writes alpha 0, everything solid alpha 1), so
// light streams through every gap between walls, trees and crates and the solid parts cast dark
// streaks through it. Drawn at a quarter of the resolution with 24 taps.
const RAYS = `uniform sampler2D src; uniform vec3 sun; varying vec2 vUv;
  void main(){
    vec2 d = (sun.xy - vUv) / 24.0; vec2 p = vUv; float acc = 0.0, w = 1.0;
    for (int i = 0; i < 24; i++) {
      p += d; vec4 s = texture2D(src, p);
      float open = (1.0 - s.a) * step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
      acc += open * w; w *= 0.93;
    }
    float near = exp(-length((vUv - sun.xy) * vec2(1.6, 1.0)) * 2.2);
    gl_FragColor = vec4(vec3(acc / 10.0 * near), 1.0); }`;

// Composite. Tone curve: Khronos PBR Neutral (keeps the bright cartoon colours true) with a gentle
// toe; then saturation, contrast around mid-grey, a warm/cool split, and the effects.
const COMPOSITE = `uniform sampler2D scene; uniform sampler2D bloom; uniform bool hasBloom; uniform float bloomStrength;
  uniform sampler2D rays; uniform float raysOn; uniform vec3 sunColor;
  uniform float exposure; uniform float saturation; uniform float contrast; uniform vec3 lift; uniform vec3 gain;
  uniform float vignette; uniform vec3 hurtColor; uniform float hurt; uniform float lowHp; uniform float aberration;
  uniform float time; uniform vec2 res; varying vec2 vUv;
  // A filmic curve (the ACES fit's shape: a real toe, so shade goes properly dark, and a soft
  // shoulder), applied to brightness so hues stay true (per channel it turns blue skies purple), with
  // the brightest highlights easing towards white the way film does.
  float curve(float x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
  vec3 filmic(vec3 c){ float m = max(c.r, max(c.g, c.b)); if (m <= 1e-5) return vec3(0.0);
    float t = curve(m); vec3 o = c * (t / m);
    return mix(o, vec3(t), smoothstep(0.75, 1.0, t) * 0.5); }
  vec3 neutral(vec3 c){ const float start = 0.8 - 0.04, desat = 0.15;
    float x = min(c.r, min(c.g, c.b)); float off = x < 0.08 ? x - 6.25 * x * x : 0.04; c -= off;
    float peak = max(c.r, max(c.g, c.b)); if (peak < start) return c;
    float d = 1.0 - start; float np = 1.0 - d * d / (peak + d - start); c *= np / peak;
    float g = 1.0 - 1.0 / (desat * (peak - np) + 1.0); return mix(c, vec3(np), g); }
  vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
  void main(){
    vec2 q = vUv - 0.5; float r2 = dot(q, q);
    vec3 c;
    if (aberration > 0.0) { vec2 o = q * aberration * r2; c = vec3(texture2D(scene, vUv + o).r, texture2D(scene, vUv).g, texture2D(scene, vUv - o).b); }
    else c = texture2D(scene, vUv).rgb;
    if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
    if (hasBloom) c += texture2D(bloom, vUv).rgb * bloomStrength;
    if (raysOn > 0.0) c += texture2D(rays, vUv).r * sunColor * raysOn;
    c *= exposure;
    c = filmic(c);
    // Grade (in display-ish space so the controls behave like an editor's).
    c = pow(max(c, 0.0), vec3(1.0 / 2.2));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float sat = saturation * (1.0 - lowHp * 0.75);
    c = mix(vec3(l), c, sat);
    c = (c - 0.5) * contrast + 0.5;
    c = c * gain + lift * (1.0 - c);
    // Vignette, and the hurt / low-health edges.
    c *= 1.0 - smoothstep(0.2, 0.95, r2 * 2.0) * vignette;
    float edge = smoothstep(0.08, 0.42, r2);
    c = mix(c, hurtColor, clamp(edge * hurt, 0.0, 0.85));
    c = clamp(c, 0.0, 1.0);
    c = pow(c, vec3(2.2));
    vec3 o = toSRGB(c);
    o += (hash(vUv * res) - 0.5) / 255.0;
    gl_FragColor = vec4(o, 1.0); }`;

function pass(fragmentShader, uniforms, blending = THREE.NoBlending) {
  return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, blending, toneMapped: false });
}

export class Post {
  constructor(gl) {
    this.gl = gl;
    const ext = gl.extensions;
    this.supported = gl.capabilities.isWebGL2 && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.enabled = false; this.levels = 0; this.samples = 4; this.scale = 1;
    // One big triangle covers the screen (no diagonal seam, a little cheaper than a quad).
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(g); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad); this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.down = pass(DOWN, { src: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 6.5 }, knee: { value: 2.0 }, prefilter: { value: false } });
    this.up = pass(UP, { src: { value: null }, texel: { value: new THREE.Vector2() }, weight: { value: 1 } }, THREE.AdditiveBlending);
    this.composite = pass(COMPOSITE, {
      scene: { value: null }, bloom: { value: null }, hasBloom: { value: false }, bloomStrength: { value: 0.5 },
      exposure: { value: 0.92 }, saturation: { value: 1.14 }, contrast: { value: 1.05 }, lift: { value: new THREE.Vector3(0.0, 0.012, 0.028) }, gain: { value: new THREE.Vector3(1.025, 1.0, 0.955) },
      vignette: { value: 0.32 }, hurtColor: { value: new THREE.Vector3(0.55, 0.02, 0.0) }, hurt: { value: 0 }, lowHp: { value: 0 }, aberration: { value: 0 },
      time: { value: 0 }, res: { value: new THREE.Vector2(1, 1) },
      rays: { value: null }, raysOn: { value: 0 }, sunColor: { value: new THREE.Color(1, 0.8, 0.55) },
    });
    this.raysPass = pass(RAYS, { src: { value: null }, sun: { value: new THREE.Vector3() } });
    this.rays = false; this.raysTarget = null;
    this.size = new THREE.Vector2(); this.strength = 0.9;
    this.chain = [];
  }
  // levels: bloom steps (0 = no bloom); samples: MSAA on the scene target.
  configure(enabled, levels = 4, samples = 4, rays = false) {
    enabled = enabled && this.supported;
    if (enabled === this.enabled && levels === this.levels && samples === this.samples && rays === this.rays) return;
    this.enabled = enabled; this.levels = levels; this.samples = samples; this.rays = rays; this.raysStrength = 0.55;
    this.dispose();
    if (enabled) this.resize(true);
  }
  setScale(k) { if (k !== this.scale) { this.scale = k; this.resize(true); } }
  dispose() { this.target?.dispose(); this.target = null; for (const t of this.chain) t.dispose(); this.chain = []; this.raysTarget?.dispose(); this.raysTarget = null; }
  resize(force = false) {
    if (!this.enabled) return;
    const s = this.gl.getDrawingBufferSize(this.size), w = Math.max(1, Math.round(s.x * this.scale)), h = Math.max(1, Math.round(s.y * this.scale));
    if (!force && this.target && this.target.width === w && this.target.height === h) return;
    this.dispose();
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.samples, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    for (let i = 0, cw = w, ch = h; i < this.levels; i++) {
      cw = Math.max(1, cw >> 1); ch = Math.max(1, ch >> 1);
      this.chain.push(new THREE.WebGLRenderTarget(cw, ch, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    }
    this.composite.uniforms.res.value.set(s.x, s.y); // (the dither is per screen pixel)
    if (this.rays) this.raysTarget = new THREE.WebGLRenderTarget(Math.max(1, w >> 2), Math.max(1, h >> 2), { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  }
  // Start a frame: everything drawn until end() lands in the HDR target.
  begin() { if (this.enabled) { this.resize(); this.gl.setRenderTarget(this.target); } else this.gl.setRenderTarget(null); }
  draw(material, target) { this.quad.material = material; this.gl.setRenderTarget(target); this.gl.render(this.scene, this.camera); }
  // fx: { hurt 0..1, lowHp 0..1, aberration, time }
  end(fx) {
    if (!this.enabled) return;
    const gl = this.gl, autoClear = gl.autoClear; gl.autoClear = false;
    const u = this.composite.uniforms, n = this.chain.length;
    if (n) {
      // Shrink: scene → level 0 (thresholded) → level 1 → ...
      let src = this.target.texture, sw = this.target.width, sh = this.target.height;
      for (let i = 0; i < n; i++) {
        const d = this.down.uniforms; d.src.value = src; d.texel.value.set(1 / sw, 1 / sh); d.prefilter.value = i === 0;
        this.draw(this.down, this.chain[i]);
        src = this.chain[i].texture; sw = this.chain[i].width; sh = this.chain[i].height;
      }
      // Grow back, each level added onto the next larger one.
      for (let i = n - 2; i >= 0; i--) {
        const s = this.chain[i + 1], p = this.up.uniforms; p.src.value = s.texture; p.texel.value.set(1 / s.width, 1 / s.height); p.weight.value = 1;
        this.draw(this.up, this.chain[i]);
      }
      u.bloom.value = this.chain[0].texture;
    }
    // Each level adds its own copy of the glow on the way back up, so the total is divided by the count.
    // Light shafts, when the sun is on or near the screen.
    const sun = fx.sun;
    if (this.rays && this.raysTarget && sun && sun[2] > 0.01) {
      const r = this.raysPass.uniforms; r.src.value = this.target.texture; r.sun.value.set(sun[0], sun[1], 0);
      this.draw(this.raysPass, this.raysTarget);
      u.rays.value = this.raysTarget.texture; u.raysOn.value = sun[2] * this.raysStrength; if (fx.sunColor) u.sunColor.value.copy(fx.sunColor);
    } else u.raysOn.value = 0;
    u.hasBloom.value = n > 0; u.scene.value = this.target.texture; u.bloomStrength.value = n ? this.strength / n : 0;
    u.hurt.value = fx.hurt || 0; u.lowHp.value = fx.lowHp || 0; u.aberration.value = fx.aberration || 0; u.time.value = (fx.time || 0) % 100;
    this.draw(this.composite, null);
    gl.autoClear = autoClear;
  }
}

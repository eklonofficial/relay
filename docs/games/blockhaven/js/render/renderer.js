import { CHUNK, TEX, DIM } from '../data/blocks.js?v=muujnq9z';
import { meshSingleBlock, STRIDE } from '../mesh/mesher.js?v=muujnq9z';
import * as S from './shaders.js?v=muujnq9z';
import { uploadArray, updateLayer, uploadLayerChain, buildMipChain } from './atlas.js?v=muujnq9z';
import { mat4, perspective, multiply, invert, viewMatrix, frustumPlanes, boxVisible } from '../core/math.js?v=muujnq9z';

const NO_OPTS = {};

// Graphics presets: 0 Disabled, 1 Regular, 2 High, 3 PC.
export const QUALITY = [
  { name: 'Disabled', shadow: 0, god: 0, bloom: 0, ssr: 0 },
  { name: 'Regular', shadow: 0, god: 24, bloom: 0, ssr: 20 },
  { name: 'High', shadow: 2048, shadowR: 72, pcf: 1, god: 40, bloom: 0.2, ssr: 32 },
  { name: 'PC', shadow: 4096, shadowR: 112, pcf: 2, god: 56, bloom: 0.24, ssr: 56 },
];

const MAX_QUADS = 1 << 18;
const IDENTITY = mat4();
// Opaque terrain passes: [program, chunk mesh, its section table].
const OPAQUE_PASSES = [['terrainSolid', 'solid', 'secS'], ['terrain', 'cutout', 'secC']];
const byDrawDist = (a, b) => a.drawDist - b.drawDist;

// Java's cloud mesh (LevelRenderer.buildClouds) in cloud cells, y relative to the camera: f17 is the
// cloud base rounded down to Java's 4-block bands. Vertices are x, y, z, u, v (cloud-map pixels / 256,
// before the drift offset) and the face's shade (Java's 0.7 bottom, 1 top, 0.9 x sides, 0.8 z sides).
function cloudMesh(fancy, f17) {
  const out = [], E = 9.765625E-4, T = 0.00390625;
  const v = (x, y, z, u, w, sh) => out.push(x, y, z, u * T, w * T, sh);
  if (!fancy) {
    for (let k = -32; k < 32; k += 32) for (let l = -32; l < 32; l += 32) {
      v(k, f17, l + 32, k, l + 32, 1); v(k + 32, f17, l + 32, k + 32, l + 32, 1); v(k + 32, f17, l, k + 32, l, 1); v(k, f17, l, k, l, 1);
    }
    return new Float32Array(out);
  }
  for (let k = -3; k <= 4; k++) for (let l = -3; l <= 4; l++) {
    const x = k * 8, z = l * 8;
    if (f17 > -5) { v(x, f17, z + 8, x, z + 8, 0.7); v(x + 8, f17, z + 8, x + 8, z + 8, 0.7); v(x + 8, f17, z, x + 8, z, 0.7); v(x, f17, z, x, z, 0.7); }
    if (f17 <= 5) { const y = f17 + 4 - E; v(x, y, z + 8, x, z + 8, 1); v(x + 8, y, z + 8, x + 8, z + 8, 1); v(x + 8, y, z, x + 8, z, 1); v(x, y, z, x, z, 1); }
    if (k > -1) for (let i = 0; i < 8; i++) { const a = x + i, u = x + i + 0.5; v(a, f17, z + 8, u, z + 8, 0.9); v(a, f17 + 4, z + 8, u, z + 8, 0.9); v(a, f17 + 4, z, u, z, 0.9); v(a, f17, z, u, z, 0.9); }
    if (k <= 1) for (let i = 0; i < 8; i++) { const a = x + i + 1 - E, u = x + i + 0.5; v(a, f17, z + 8, u, z + 8, 0.9); v(a, f17 + 4, z + 8, u, z + 8, 0.9); v(a, f17 + 4, z, u, z, 0.9); v(a, f17, z, u, z, 0.9); }
    if (l > -1) for (let i = 0; i < 8; i++) { const c = z + i, w = z + i + 0.5; v(x, f17 + 4, c, x, w, 0.8); v(x + 8, f17 + 4, c, x + 8, w, 0.8); v(x + 8, f17, c, x + 8, w, 0.8); v(x, f17, c, x, w, 0.8); }
    if (l <= 1) for (let i = 0; i < 8; i++) { const c = z + i + 1 - E, w = z + i + 0.5; v(x, f17 + 4, c, x, w, 0.8); v(x + 8, f17 + 4, c, x + 8, w, 0.8); v(x + 8, f17, c, x + 8, w, 0.8); v(x, f17, c, x, w, 0.8); }
  }
  return new Float32Array(out);
}
// Level.getCloudColor: white dimmed by the time of day, greyed by rain and darker in a thunderstorm.
// dayTime: 0..1 of a day from Java's tick 0 (6 am).
function cloudColor(dayTime, rain, thunder) {
  const d0 = dayTime - 0.25 - Math.floor(dayTime - 0.25), d1 = 0.5 - Math.cos(d0 * Math.PI) / 2, f = (d0 * 2 + d1) / 3;
  const f1 = Math.max(0, Math.min(1, Math.cos(f * Math.PI * 2) * 2 + 0.5));
  let r = 1, g = 1, b = 1;
  if (rain > 0) { const grey = (r * 0.3 + g * 0.59 + b * 0.11) * 0.6, k = 1 - rain * 0.95; r = r * k + grey * (1 - k); g = g * k + grey * (1 - k); b = b * k + grey * (1 - k); }
  r *= f1 * 0.9 + 0.1; g *= f1 * 0.9 + 0.1; b *= f1 * 0.85 + 0.15;
  if (thunder > 0) { const grey = (r * 0.3 + g * 0.59 + b * 0.11) * 0.2, k = 1 - thunder * 0.95; r = r * k + grey * (1 - k); g = g * k + grey * (1 - k); b = b * k + grey * (1 - k); }
  return [r, g, b];
}

// Growable float batch of quads: pos(3) uv+layer(3) colour(4).
export class Batch {
  constructor() { this.data = new Float32Array(4096 * 40); this.quads = 0; }
  reset() { this.quads = 0; }
  ensure() { if ((this.quads + 1) * 40 > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; } }
  // p: 4 corners [x,y,z]; uv: [u0,v0,u1,v1]; c: [r,g,b,a]
  quad(p, uv, layer, c) {
    this.ensure();
    const d = this.data;
    let o = this.quads * 40;
    for (let k = 0; k < 4; k++) {
      d[o++] = p[k][0]; d[o++] = p[k][1]; d[o++] = p[k][2];
      d[o++] = k < 2 ? uv[0] : uv[2]; d[o++] = k === 0 || k === 3 ? uv[3] : uv[1]; d[o++] = layer;
      d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; d[o++] = c[3];
    }
    this.quads++;
  }
  // Quad with explicit per-corner uvs.
  quadUV(p, uvs, layer, c) {
    this.ensure();
    const d = this.data;
    let o = this.quads * 40;
    for (let k = 0; k < 4; k++) {
      d[o++] = p[k][0]; d[o++] = p[k][1]; d[o++] = p[k][2];
      d[o++] = uvs[k][0]; d[o++] = uvs[k][1]; d[o++] = layer;
      d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; d[o++] = c[3];
    }
    this.quads++;
  }
}

export class Renderer {
  constructor(canvas, opts = {}) {
    // desynchronized (low latency) draws straight to the screen, skipping a frame of compositor buffering.
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false, desynchronized: !!opts.lowLatency });
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl;
    // A desynchronized canvas shows its buffer while it is being drawn, so frames must only ever
    // reach it whole, in the final full-screen pass.
    this.frontBuffer = !!gl.getContextAttributes().desynchronized;
    this.canvas = canvas;
    this.stats = { chunks: 0, quads: 0, draws: 0 };
    this.draws = 0;
    this.terrain = this.program(S.TERRAIN_VS, S.TERRAIN_FS);
    this.terrainSolid = this.program(S.TERRAIN_VS, S.TERRAIN_SOLID_FS);
    this.liquid = this.program(S.TERRAIN_VS, S.LIQUID_FS);
    this.sky = this.program(S.SKY_VS, S.SKY_FS);
    this.entity = this.program(S.ENTITY_VS, S.ENTITY_FS);
    this.line = this.program(S.LINE_VS, S.LINE_FS);
    this.post = this.program(S.POST_VS, S.POST_FS);
    this.shadowProg = this.program(S.TERRAIN_VS, S.SHADOW_FS);
    this.shadowSolid = this.program(S.TERRAIN_VS, S.SHADOW_SOLID_FS);
    this.cloudProg = this.program(S.CLOUD_VS, S.CLOUD_FS);
    this.bloomProg = this.program(S.POST_VS, S.BLOOM_FS);
    this.godProg = this.program(S.POST_VS, S.GOD_FS);
    this.quality = 1;
    // 1x1 compare-mode depth texture so the shadow sampler is always valid.
    this.dummyShadow = this.depthTexture(1, 1, true);

    const idx = new Uint32Array(MAX_QUADS * 6);
    for (let q = 0, i = 0; q < MAX_QUADS; q++) {
      const v = q * 4;
      idx[i++] = v; idx[i++] = v + 1; idx[i++] = v + 2; idx[i++] = v; idx[i++] = v + 2; idx[i++] = v + 3;
    }
    this.quadIndex = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.emptyVao = gl.createVertexArray();

    this.lineVao = gl.createVertexArray();
    this.lineVbo = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    this.models = new Map();
    this.samples = 0;
    this.width = this.height = 0;
    this.scale = 1;
  }

  program(vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n'));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  setBlockTextures(chain, count) { if (this.blockTex) this.gl.deleteTexture(this.blockTex); this.blockTex = uploadArray(this.gl, chain, count); this.animShown = new Map(); }
  // Animated block textures (layer -> { frames, order: [{ i, t }] }): each shows the frame due at
  // this client tick, uploaded only when it changes (like Java's TextureAtlas animation ticks).
  // Each frame's mip chain is built the first time it shows and kept, so steady animation is only uploads.
  setAnimations(anims) { this.anims = anims; this.animShown = new Map(); this.animChains = new Map(); }
  animate(tick) {
    if (!this.anims || !this.blockTex) return;
    for (const [layer, a] of this.anims) {
      const total = a.total || (a.total = a.order.reduce((s, f) => s + f.t, 0));
      let t = tick % total, k = 0;
      while (t >= a.order[k].t) { t -= a.order[k].t; k++; }
      const f = a.order[k].i;
      if (this.animShown.get(layer) === f) continue;
      this.animShown.set(layer, f);
      let chains = this.animChains.get(a);
      if (!chains) this.animChains.set(a, chains = []);
      uploadLayerChain(this.gl, this.blockTex, layer, chains[f] || (chains[f] = buildMipChain([a.frames[f]])));
    }
  }
  // The cloud map ({ w, h, data } RGBA), repeating, unfiltered and without mipmaps as in Java.
  setCloudTexture(t) {
    const gl = this.gl;
    if (this.cloudTex) gl.deleteTexture(this.cloudTex);
    this.cloudTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, t.w, t.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }
  // Java's clouds (s.clouds 'fancy' or 'fast'), drawn after translucent terrain like LevelRenderer.
  drawClouds(s, viewProj, fogNear, fogFar) {
    const gl = this.gl, fancy = s.clouds === 'fancy';
    if (!this.cloudTex || (!fancy && s.clouds !== 'fast') || s.dim !== DIM.OVERWORLD || s.renderDistance < 4) return;
    const H = 192, ticks = (s.cloudTicks ?? s.time * 20) * 0.03;
    let d2 = (s.camPos[0] + ticks) / 12, d4 = s.camPos[2] / 12 + 0.33000001311302185;
    const d3 = H - s.camPos[1] + 0.33000001311302185;
    d2 -= Math.floor(d2 / 2048) * 2048; d4 -= Math.floor(d4 / 2048) * 2048;
    const f3 = d2 - Math.floor(d2), f4 = (d3 / 4 - Math.floor(d3 / 4)) * 4, f5 = d4 - Math.floor(d4);
    const f17 = Math.floor(d3 / 4) * 4;
    const key = `${fancy}|${f17}`;
    if (this.cloudKey !== key) {
      this.cloudKey = key;
      const data = cloudMesh(fancy, f17);
      if (!this.cloudVao) {
        this.cloudVao = gl.createVertexArray(); this.cloudVbo = gl.createBuffer();
        gl.bindVertexArray(this.cloudVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
      }
      gl.bindVertexArray(this.cloudVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cloudVbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.cloudQuads = data.length / 24;
    }
    const p = this.cloudProg, F = Math.max(s.renderDistance * CHUNK, 32);
    gl.useProgram(p.p);
    this.setEnv(p.u, s, fogNear, fogFar);
    gl.uniformMatrix4fv(p.u.uViewProj, false, viewProj);
    gl.uniform3f(p.u.uShift, -f3, f4, -f5);
    gl.uniform2f(p.u.uUVOff, Math.floor(d2) * 0.00390625, Math.floor(d4) * 0.00390625);
    const c = cloudColor(s.dayTime ?? 0, s.rain || 0, s.thunder || 0);
    gl.uniform3f(p.u.uCloudColor, c[0], c[1], c[2]);
    gl.uniform2f(p.u.uCloudFog, F - Math.max(4, Math.min(64, F / 10)), F);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.cloudTex); gl.uniform1i(p.u.uCloudTex, 1); gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.cloudVao);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    // Fancy: depth first, then colour, so only the nearest cloud face shows (Java's two passes).
    for (let pass = fancy ? 0 : 1; pass < 2; pass++) {
      gl.colorMask(pass === 1, pass === 1, pass === 1, pass === 1);
      gl.drawElements(gl.TRIANGLES, this.cloudQuads * 6, gl.UNSIGNED_INT, 0);
      this.draws++;
    }
    gl.depthMask(false);
    gl.enable(gl.CULL_FACE);
  }
  setEntityTextures(chain, count) { this.entityTex = uploadArray(this.gl, chain, count); }
  // Replaces one 128x128 entity layer (a player's own skin, a pack's armor), mipmaps and all.
  setEntityLayer(layer, pixels) { updateLayer(this.gl, this.entityTex, layer, pixels, 128, 8); }
  setItemTextures(chain, count) { this.itemTex = uploadArray(this.gl, chain, count); }
  texFor(kind) { return kind === 'block' ? this.blockTex : kind === 'item' ? this.itemTex : kind === 'weather' ? this.weatherTex : this.entityTex; }
  // Rain and snow (render/weathertex.js): two 64x256 layers that repeat as the sheets of weather scroll.
  setWeatherTextures(layers) {
    const gl = this.gl, w = 64, h = 256, data = new Uint8Array(w * h * 4 * layers.length);
    layers.forEach((d, i) => data.set(d, i * w * h * 4));
    if (this.weatherTex) gl.deleteTexture(this.weatherTex);
    const t = this.weatherTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, layers.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  depthTexture(w, h, compare) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, compare ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, compare ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (compare) { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL); }
    return t;
  }
  colorTexture(w, h) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  fbo(color, depth) {
    const gl = this.gl, f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    if (!color) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    return f;
  }
  setQuality(q) {
    const gl = this.gl;
    this.quality = q;
    const Q = QUALITY[q];
    if (this.shadowFbo) { gl.deleteFramebuffer(this.shadowFbo); gl.deleteTexture(this.shadowTex); this.shadowFbo = null; }
    if (Q.shadow) {
      const size = Math.min(Q.shadow, gl.getParameter(gl.MAX_TEXTURE_SIZE));
      this.shadowSize = size;
      this.shadowTex = this.depthTexture(size, size, true);
      this.shadowFbo = this.fbo(null, this.shadowTex);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.freeTargets();
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    this.freeTargets();
  }
  // Offscreen targets are made the first time a frame needs them: the scene copy only for water
  // reflections, the quarter-size ones only for god rays and bloom. When no effect needs the
  // scene as a texture (the Fast preset, in the open air), it is drawn straight to the screen.
  freeTargets() {
    const gl = this.gl;
    for (const f of [this.sceneFbo, this.copyFbo, this.bloomFboA, this.bloomFboB, this.godFboA, this.godFboB]) if (f) gl.deleteFramebuffer(f);
    for (const t of [this.sceneTex, this.sceneDepth, this.copyTex, this.copyDepth, this.bloomA, this.bloomB, this.godA, this.godB]) if (t) gl.deleteTexture(t);
    this.sceneFbo = this.copyFbo = this.bloomFboA = this.bloomFboB = this.godFboA = this.godFboB = null;
    this.sceneTex = this.sceneDepth = this.copyTex = this.copyDepth = this.bloomA = this.bloomB = this.godA = this.godB = null;
  }
  sceneTarget() {
    if (!this.sceneFbo) {
      this.sceneTex = this.colorTexture(this.width, this.height);
      this.sceneDepth = this.depthTexture(this.width, this.height, false);
      this.sceneFbo = this.fbo(this.sceneTex, this.sceneDepth);
    }
    return this.sceneFbo;
  }
  copyTarget() {
    if (!this.copyFbo) {
      this.copyTex = this.colorTexture(this.width, this.height);
      this.copyDepth = this.depthTexture(this.width, this.height, false);
      this.copyFbo = this.fbo(this.copyTex, this.copyDepth);
    }
    return this.copyFbo;
  }
  quarterTargets() {
    if (!this.godFboA) {
      const bw = Math.max(1, this.width >> 2), bh = Math.max(1, this.height >> 2);
      this.bloomSize = [bw, bh];
      this.bloomA = this.colorTexture(bw, bh); this.bloomB = this.colorTexture(bw, bh);
      this.bloomFboA = this.fbo(this.bloomA, null); this.bloomFboB = this.fbo(this.bloomB, null);
      this.godA = this.colorTexture(bw, bh); this.godB = this.colorTexture(bw, bh);
      this.godFboA = this.fbo(this.godA, null); this.godFboB = this.fbo(this.godB, null);
    }
  }

  // Renders opaque terrain depth from the sun for shadow mapping. Returns the shadow matrix.
  shadowPass(s, visibleChunks) {
    const gl = this.gl, Q = QUALITY[this.quality];
    const sd = s.env.sunDir;
    const R = Q.shadowR;
    // Light basis.
    const f = [-sd[0], -sd[1], -sd[2]];
    let up = Math.abs(f[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    let r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
    const rl = Math.hypot(...r); r = r.map(v => v / rl);
    up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    // Snap the centre to shadow texels so shadows don't shimmer while moving.
    const texel = (2 * R) / this.shadowSize;
    const c = s.camPos;
    const cr = Math.round((c[0] * r[0] + c[1] * r[1] + c[2] * r[2]) / texel) * texel;
    const cu = Math.round((c[0] * up[0] + c[1] * up[1] + c[2] * up[2]) / texel) * texel;
    const cf = c[0] * f[0] + c[1] * f[1] + c[2] * f[2];
    const D = 260;
    // view: rows r, up, -f ; ortho
    const view = new Float32Array([r[0], up[0], -f[0], 0, r[1], up[1], -f[1], 0, r[2], up[2], -f[2], 0, -cr, -cu, cf - D, 1]);
    // Orthographic projection: x,y in [-R,R], z from near 1 to far 2D.
    const n = 1, fa = D * 1.5;
    const proj = new Float32Array([1 / R, 0, 0, 0, 0, 1 / R, 0, 0, 0, 0, -2 / (fa - n), 0, 0, 0, -(fa + n) / (fa - n), 1]);
    const vp = multiply(mat4(), proj, view);
    const planes = frustumPlanes(vp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    for (const [p, part, sec] of [[this.shadowSolid, 'solid', 'secS'], [this.shadowProg, 'cutout', 'secC']]) {
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u.uViewProj, false, vp);
      gl.uniformMatrix4fv(p.u.uModel, false, IDENTITY);
      if (p.u.uTime) gl.uniform1f(p.u.uTime, s.time);
      if (p.u.uWind) gl.uniform1f(p.u.uWind, s.wind || 0);
      if (p.u.uTex) gl.uniform1i(p.u.uTex, 0);
      for (const c2 of visibleChunks) {
        const m = c2.gpu && c2.gpu[part];
        if (!m) continue;
        const x0 = c2.cx * CHUNK, z0 = c2.cz * CHUNK;
        if (Math.abs(x0 + 8 - c[0]) > R + 24 || Math.abs(z0 + 8 - c[2]) > R + 24) continue;
        if (!boxVisible(planes, x0, -1, z0, x0 + CHUNK, c2.maxY + 2, z0 + CHUNK)) continue;
        gl.uniform3f(p.u.uChunk, x0, 0, z0);
        gl.bindVertexArray(m.vao);
        this.drawTopDown(m, c2.gpu[sec], c2, planes);
      }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.CULL_FACE);
    return vp;
  }
  bindShadow(u, on, mat, strength) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, on ? this.shadowTex : this.dummyShadow);
    gl.activeTexture(gl.TEXTURE0);
    if (u.uShadowMap) gl.uniform1i(u.uShadowMap, 3);
    if (u.uShadowOn !== undefined && u.uShadowOn) gl.uniform1f(u.uShadowOn, on ? QUALITY[this.quality].pcf : 0);
    if (u.uShadowMat && mat) gl.uniformMatrix4fv(u.uShadowMat, false, mat);
    if (u.uShadowTexel) gl.uniform1f(u.uShadowTexel, on ? 1 / this.shadowSize : 0);
    if (u.uShadowStrength) gl.uniform1f(u.uShadowStrength, on ? strength : 0);
  }

  // ---- chunk-format meshes ----
  makeMesh(buffer, quads, old) {
    const gl = this.gl;
    if (!quads) { if (old) this.freeMesh(old); return null; }
    const m = old || { vao: gl.createVertexArray(), vbo: gl.createBuffer() };
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_SHORT, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 2, gl.UNSIGNED_SHORT, STRIDE, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2, 4, gl.UNSIGNED_BYTE, STRIDE, 12);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, true, STRIDE, 16);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    gl.bindVertexArray(null);
    m.quads = Math.min(quads, MAX_QUADS);
    return m;
  }
  freeMesh(m) { if (m) { this.gl.deleteVertexArray(m.vao); this.gl.deleteBuffer(m.vbo); } }
  uploadChunk(c, r) {
    if (!c.gpu) c.gpu = { solid: null, cutout: null, trans: null };
    c.gpu.solid = this.makeMesh(r.solid, r.solidQuads, c.gpu.solid);
    c.gpu.cutout = this.makeMesh(r.cutout, r.cutoutQuads, c.gpu.cutout);
    c.gpu.trans = this.makeMesh(r.trans, r.transQuads, c.gpu.trans);
    c.gpu.secS = r.secS; c.gpu.secC = r.secC; c.gpu.secT = r.secT;
  }
  freeChunk(c) {
    if (!c.gpu) return;
    this.freeMesh(c.gpu.solid); this.freeMesh(c.gpu.cutout); this.freeMesh(c.gpu.trans);
    c.gpu = null;
  }
  // Cached single-block model, lit at full sky; light is applied through uniforms per draw.
  blockModel(id, meta) {
    const k = id * 256 + meta;
    let m = this.models.get(k);
    if (m === undefined) {
      const r = meshSingleBlock(id, meta, 0xf0);
      m = this.makeMesh(r.data.buffer, r.quads, null);
      this.models.set(k, m);
    }
    return m;
  }

  setEnv(u, s, fogNear, fogFar, camPos = s.camPos, medium = s.medium) {
    const gl = this.gl, env = s.env;
    if (u.uFogColor) gl.uniform3fv(u.uFogColor, env.fogColor);
    if (u.uFogNear) gl.uniform1f(u.uFogNear, fogNear);
    if (u.uFogFar) gl.uniform1f(u.uFogFar, fogFar);
    if (u.uSkyLight) gl.uniform3fv(u.uSkyLight, env.skyLight);
    if (u.uAmbient) gl.uniform3fv(u.uAmbient, env.ambient);
    if (u.uCamPos) gl.uniform3fv(u.uCamPos, camPos);
    if (u.uMedium) gl.uniform1f(u.uMedium, medium);
    if (u.uZenith) gl.uniform3fv(u.uZenith, env.zenith);
    if (u.uHorizon) gl.uniform3fv(u.uHorizon, env.horizon);
    if (u.uSunDir) gl.uniform3fv(u.uSunDir, env.sunDir);
    if (u.uSunColor) gl.uniform3fv(u.uSunColor, env.sunColor);
    if (u.uTime) gl.uniform1f(u.uTime, s.time);
    if (u.uWind) gl.uniform1f(u.uWind, s.wind || 0);
    if (u.uFlicker) gl.uniform1f(u.uFlicker, Math.sin(s.time * 11) * 0.5 + Math.sin(s.time * 7.3) * 0.5);
  }

  // Draws only the 16-tall sections of a chunk mesh that are inside the frustum, merging runs of
  // neighbouring sections into one draw. Translucent meshes are laid out bottom-up (sec[s] is
  // section s, k = s); opaque ones top-down (sec[k] is section 15 - k), drawn from k0 to k1.
  drawSections(m, sec, c, planes, topDown = false, k0 = 0, k1 = 16) {
    const gl = this.gl;
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    let start = -1, end = -1, n = 0;
    for (let k = k0; k <= k1; k++) {
      let visible = false;
      if (k < k1) {
        const a = sec[k], b = Math.min(sec[k + 1], m.quads);
        if (b <= a) continue;
        const s = topDown ? 15 - k : k;
        visible = boxVisible(planes, x0, s * 16 - 1, z0, x0 + CHUNK, s * 16 + 17, z0 + CHUNK);
        if (visible) { if (start < 0) start = a; end = b; }
      }
      if (!visible && start >= 0) {
        gl.drawElements(gl.TRIANGLES, (end - start) * 6, gl.UNSIGNED_INT, start * 24);
        n += end - start; this.draws++; start = -1;
      }
    }
    return n;
  }
  // Opaque meshes: the camera's section and those below it first (the ground under the player
  // hides the caves beneath it), then the sections above.
  drawTopDown(m, sec, c, planes, camY = Infinity) {
    const split = 15 - Math.max(0, Math.min(15, Math.floor(camY / 16)));
    return this.drawSections(m, sec, c, planes, true, split, 16) + (split > 0 ? this.drawSections(m, sec, c, planes, true, 0, split) : 0);
  }

  // A model drawn on its own into a small transparent image (the inventory's player preview), read
  // back as RGBA rows from the bottom up. list: [{ batch, tex }]; s: { env, time }.
  // The pixels are copied into a buffer on the GPU and picked up a frame later once the GPU has
  // finished, so reading them never stalls the frame; returns null until a picture is ready.
  renderPreview(list, w, h, viewProj, s) {
    const gl = this.gl;
    if (!this.pv || this.pv.w !== w || this.pv.h !== h) {
      if (this.pv) { gl.deleteFramebuffer(this.pv.f); gl.deleteTexture(this.pv.c); gl.deleteTexture(this.pv.d); gl.deleteBuffer(this.pv.pbo); if (this.pv.fence) gl.deleteSync(this.pv.fence); }
      const c = this.colorTexture(w, h), d = this.depthTexture(w, h, false), pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.pv = { w, h, c, d, f: this.fbo(c, d), px: new Uint8Array(w * h * 4), pbo, fence: null };
    }
    const pv = this.pv;
    let out = null;
    if (pv.fence && gl.getSyncParameter(pv.fence, gl.SYNC_STATUS) === gl.SIGNALED) {
      gl.deleteSync(pv.fence); pv.fence = null;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pv.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pv.px);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      out = pv.px;
    }
    if (pv.fence) return out; // the GPU hasn't finished the last one yet
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pv.f);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    const e = this.entity;
    gl.useProgram(e.p);
    this.setEnv(e.u, s, 1e6, 2e6, [0, 0, 0], 0);
    gl.uniformMatrix4fv(e.u.uViewProj, false, viewProj);
    gl.uniform1i(e.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    // (A batch may ask to be blended: { blend, additive, wrap, alphaTest }, as in the main pass.)
    for (const b of list) { const tx = this.texFor(b.tex); if (tx) this.drawBatch(b.batch, tx, b.alphaTest ?? 0.1, !!b.blend, b); }
    // Blocks held in a hand, as the main pass draws block models.
    if (s.blockModels && s.blockModels.length) {
      const t = this.terrain, env = s.env;
      gl.useProgram(t.p);
      this.setEnv(t.u, s, 1e6, 2e6, [0, 0, 0], 0);
      gl.uniformMatrix4fv(t.u.uViewProj, false, viewProj);
      gl.uniform1i(t.u.uTex, 0); gl.uniform1f(t.u.uAlpha, 1);
      this.bindShadow(t.u, false, null, 0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
      for (const bm of s.blockModels) {
        const m = this.blockModel(bm.id, bm.meta);
        if (!m) continue;
        gl.uniformMatrix4fv(t.u.uModel, false, bm.matrix);
        gl.uniform3f(t.u.uChunk, 0, 0, 0);
        const L = bm.light ?? 1;
        gl.uniform3f(t.u.uSkyLight, env.skyLight[0] * L, env.skyLight[1] * L, env.skyLight[2] * L);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
      }
      gl.uniformMatrix4fv(t.u.uModel, false, IDENTITY);
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pv.pbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pv.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
  // Every batch has its own vertex buffer: refilling one shared buffer several times a frame
  // makes drivers wait for (or copy around) the draws still using it.
  // opts: { additive (added onto what is behind, as Java's additive transparency), wrap (texture repeats) }
  drawBatch(batch, tex, alphaTest, blend, opts = NO_OPTS) {
    if (!batch || !batch.quads) return;
    const gl = this.gl;
    if (!batch.vao) {
      batch.vao = gl.createVertexArray(); batch.vbo = gl.createBuffer();
      gl.bindVertexArray(batch.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, batch.vbo);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);
    }
    gl.bindVertexArray(batch.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.quads * 40), gl.STREAM_DRAW);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.uniform1f(this.entity.u.uAlphaTest, alphaTest);
    if (blend) { gl.enable(gl.BLEND); if (opts.additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    if (opts.wrap && this.entity.u.uWrap) gl.uniform1f(this.entity.u.uWrap, 1);
    gl.drawElements(gl.TRIANGLES, batch.quads * 6, gl.UNSIGNED_INT, 0);
    this.draws++;
    if (opts.wrap && this.entity.u.uWrap) gl.uniform1f(this.entity.u.uWrap, 0);
    if (blend) { gl.disable(gl.BLEND); gl.depthMask(true); }
  }

  render(s) {
    const gl = this.gl;
    const w = this.width, h = this.height;
    const M = this.mats || (this.mats = { proj: mat4(), vp: mat4(), ivp: mat4() });
    const proj = perspective(M.proj, s.fov * Math.PI / 180, w / h, 0.05, 1200);
    const view = s.view || viewMatrix(s.camPos, s.yaw, s.pitch, s.roll);
    const viewProj = multiply(M.vp, proj, view);
    const invViewProj = invert(M.ivp, viewProj);
    const planes = frustumPlanes(viewProj);
    const fogFar = s.dim === DIM.NETHER ? Math.min(s.renderDistance * CHUNK - 4, 90) : s.renderDistance * CHUNK - 4;
    const fogNear = s.dim === DIM.NETHER ? 10 : fogFar * (s.rain ? 0.3 : 0.55);
    const env = s.env;
    const Q = QUALITY[this.quality];
    const fx = s.post || {};
    this.draws = 0;
    const allChunks = this.allChunks || (this.allChunks = []);
    allChunks.length = 0;
    for (const c of s.chunks) allChunks.push(c);
    const sunUp = s.dim === DIM.OVERWORLD ? Math.max(0, Math.min(1, (env.sunDir[1] - 0.04) * 5)) * (1 - (s.rain || 0) * 0.7) : 0;
    let shadowMat = null;
    if (Q.shadow && this.shadowFbo && sunUp > 0) shadowMat = this.shadowPass(s, allChunks);
    this.shadowStrength = shadowMat ? 0.42 * sunUp : 0;
    // Only the presets above Fast and a few passing effects (underwater wobble, portal swirl,
    // flashes, the sleeping fade) need the finished scene as a texture; otherwise it is drawn
    // straight to the screen, saving a full-screen copy every frame (unless the canvas is
    // desynchronized: it would show the frame half drawn).
    const direct = !this.frontBuffer && this.quality === 0 && !(s.medium > 0.5 && s.medium < 1.5) && !(fx.portal > 0) && !(fx.flash > 0) && !(fx.dark > 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, direct ? null : this.sceneTarget());
    gl.viewport(0, 0, w, h);
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);

    // Chunks in view, nearest first. In the open air nothing is drawn past the end of the fog:
    // chunks kept loaded just beyond the render distance would only show as fog-coloured shapes.
    const visible = this.visible || (this.visible = []);
    visible.length = 0;
    const cx = s.camPos[0], cz = s.camPos[2], far2 = s.medium === 0 ? fogFar * fogFar : Infinity;
    for (const c of allChunks) {
      if (!c.gpu) continue;
      const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
      const nx = Math.max(x0 - cx, 0, cx - x0 - CHUNK), nz = Math.max(z0 - cz, 0, cz - z0 - CHUNK);
      if (nx * nx + nz * nz > far2) continue;
      if (!boxVisible(planes, x0, -1, z0, x0 + CHUNK, c.maxY + 2, z0 + CHUNK)) continue;
      const dx = x0 + 8 - cx, dz = z0 + 8 - cz;
      c.drawDist = dx * dx + dz * dz;
      visible.push(c);
    }
    visible.sort(byDrawDist);

    // Opaque terrain: solid blocks with no alpha test first, then the cut-out ones.
    let quads = 0;
    for (const [t, part, sec] of OPAQUE_PASSES) {
      const p = this[t];
      gl.useProgram(p.p);
      this.setEnv(p.u, s, fogNear, fogFar);
      gl.uniformMatrix4fv(p.u.uViewProj, false, viewProj);
      gl.uniformMatrix4fv(p.u.uModel, false, IDENTITY);
      gl.uniform1i(p.u.uTex, 0);
      gl.uniform1f(p.u.uAlpha, 1);
      this.bindShadow(p.u, !!shadowMat, shadowMat, this.shadowStrength);
      for (const c of visible) {
        const m = c.gpu[part];
        if (!m) continue;
        gl.uniform3f(p.u.uChunk, c.cx * CHUNK, 0, c.cz * CHUNK);
        gl.bindVertexArray(m.vao);
        quads += this.drawTopDown(m, c.gpu[sec], c, planes, s.camPos[1]);
      }
    }
    const t = this.terrain;

    // Dropped/falling blocks and other block models (lit via sky-light uniform scaling).
    if (s.blockModels && s.blockModels.length) {
      gl.disable(gl.CULL_FACE);
      for (const bm of s.blockModels) {
        const m = this.blockModel(bm.id, bm.meta);
        if (!m) continue;
        gl.uniformMatrix4fv(t.u.uModel, false, bm.matrix);
        gl.uniform3f(t.u.uChunk, 0, 0, 0);
        const L = bm.light ?? 1;
        gl.uniform3f(t.u.uSkyLight, env.skyLight[0] * L, env.skyLight[1] * L, env.skyLight[2] * L);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
      }
      gl.uniformMatrix4fv(t.u.uModel, false, IDENTITY);
      gl.uniform3fv(t.u.uSkyLight, env.skyLight);
      gl.enable(gl.CULL_FACE);
    }

    // Entities (entity texture array) and block particles (block texture array).
    const e = this.entity;
    gl.useProgram(e.p);
    this.setEnv(e.u, s, fogNear, fogFar);
    gl.uniformMatrix4fv(e.u.uViewProj, false, viewProj);
    gl.uniform1i(e.u.uTex, 0);
    gl.disable(gl.CULL_FACE);
    for (const b of s.solidBatches || []) { const tx = this.texFor(b.tex); if (tx) this.drawBatch(b.batch, tx, b.alphaTest ?? 0.5, false); }
    if (s.crack) this.drawCrack(s.crack, viewProj);
    if (s.target) this.drawOutline(s.target, viewProj);

    // Sky (stars, sun, moon, animated clouds) only where nothing opaque was drawn: its noise-heavy
    // shader used to run for every pixel of the screen and then get painted over by terrain.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.useProgram(this.sky.p);
    this.setEnv(this.sky.u, s, fogNear, fogFar);
    gl.uniformMatrix4fv(this.sky.u.uInvViewProj, false, invViewProj);
    gl.uniform1f(this.sky.u.uNight, env.night);
    gl.uniform1f(this.sky.u.uClouds, s.clouds === 'soft' ? 1 : 0); // the soft (shader) clouds
    gl.uniform1f(this.sky.u.uRain, s.rain || 0);
    gl.uniform1i(this.sky.u.uDim, s.dim || 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    // Snapshot the opaque scene for water reflections/refraction, only when water is in view.
    let anyWater = false;
    for (const c of visible) if (c.gpu.trans) { anyWater = true; break; }
    const ssr = Q.ssr > 0 && s.medium === 0 && anyWater && !direct;
    if (ssr) {
      const copy = this.copyTarget();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copy);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    }
    // Translucent terrain, back to front.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    // Cull back faces so a water surface and its underside never draw on top of each other.
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    const l = this.liquid;
    gl.useProgram(l.p);
    this.setEnv(l.u, s, fogNear, fogFar);
    gl.uniformMatrix4fv(l.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(l.u.uModel, false, IDENTITY);
    gl.uniform1i(l.u.uTex, 0);
    gl.uniform1f(l.u.uSSR, ssr ? Q.ssr : 0);
    gl.uniform1f(l.u.uPlainWater, this.quality === 0 ? 1 : 0);
    gl.uniform1f(l.u.uWaves, this.quality === 0 ? 0 : 1);
    gl.uniform1f(l.u.uClouds, s.clouds === 'soft' ? 1 : 0);
    gl.uniform1f(l.u.uRain, s.rain || 0);
    gl.uniform2f(l.u.uNearFar, 0.05, 1200);
    gl.uniform2f(l.u.uScreen, w, h);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.copyTex);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.copyDepth);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(l.u.uOpaque, 4); gl.uniform1i(l.u.uOpaqueDepth, 5);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    for (let i = visible.length - 1; i >= 0; i--) {
      const c = visible[i], m = c.gpu.trans;
      if (!m) continue;
      gl.uniform3f(l.u.uChunk, c.cx * CHUNK, 0, c.cz * CHUNK);
      gl.bindVertexArray(m.vao);
      quads += this.drawSections(m, c.gpu.secT, c, planes);
    }
    this.drawClouds(s, viewProj, fogNear, fogFar);
    // Translucent effects: weather, smoke, glints.
    gl.useProgram(e.p);
    for (const b of s.blendBatches || []) { const tx = this.texFor(b.tex); if (tx) { if (b.noCull) gl.disable(gl.CULL_FACE); this.drawBatch(b.batch, tx, b.alphaTest ?? 0.02, true, b); if (b.noCull) gl.enable(gl.CULL_FACE); } }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);

    // First-person hand, in its own projection.
    if (s.hand) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const handProj = perspective(mat4(), 70 * Math.PI / 180, w / h, 0.01, 10);
      const hs = { ...s, camPos: [0, 0, 0] };
      for (const hb of [s.hand.block, s.hand.block2]) {
        if (!hb) continue;
        const m = this.blockModel(hb.id, hb.meta);
        if (m) {
          gl.useProgram(t.p);
          this.setEnv(t.u, hs, 1e4, 2e4, [0, 0, 0], 0);
          gl.uniformMatrix4fv(t.u.uViewProj, false, handProj);
          gl.uniformMatrix4fv(t.u.uModel, false, hb.matrix);
          gl.uniform3f(t.u.uChunk, 0, 0, 0);
          const L = s.hand.light;
          gl.uniform3f(t.u.uSkyLight, L, L, L);
          this.bindShadow(t.u, false, null, 0);
          gl.disable(gl.CULL_FACE);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
          gl.bindVertexArray(m.vao);
          gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
          gl.enable(gl.CULL_FACE);
        }
      }
      if (s.hand.batch && s.hand.batch.quads) {
        gl.useProgram(e.p);
        this.setEnv(e.u, hs, 1e4, 2e4, [0, 0, 0], 0);
        gl.uniformMatrix4fv(e.u.uViewProj, false, handProj);
        gl.disable(gl.CULL_FACE);
        this.drawBatch(s.hand.batch, this.texFor(s.hand.batchTex), 0.5, false);
        gl.enable(gl.CULL_FACE);
      }
      if (s.hand.batch2 && s.hand.batch2.quads) {
        gl.useProgram(e.p);
        this.setEnv(e.u, hs, 1e4, 2e4, [0, 0, 0], 0);
        gl.uniformMatrix4fv(e.u.uViewProj, false, handProj);
        gl.disable(gl.CULL_FACE);
        this.drawBatch(s.hand.batch2, this.texFor(s.hand.batchTex2), 0.5, false);
        gl.enable(gl.CULL_FACE);
      }
    }

    // Bloom (High/PC): bright pass at quarter resolution, then a separable blur.
    gl.bindVertexArray(this.emptyVao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    // Sun position on screen for god rays.
    let sun = [0, 0, 0];
    if (Q.god && s.dim === DIM.OVERWORLD && s.medium === 0) {
      const d = env.sunDir, sp = [s.camPos[0] + d[0] * 500, s.camPos[1] + d[1] * 500, s.camPos[2] + d[2] * 500];
      const m = viewProj;
      const cx = m[0] * sp[0] + m[4] * sp[1] + m[8] * sp[2] + m[12], cy = m[1] * sp[0] + m[5] * sp[1] + m[9] * sp[2] + m[13], cw = m[3] * sp[0] + m[7] * sp[1] + m[11] * sp[2] + m[15];
      if (cw > 0) {
        const u = cx / cw * 0.5 + 0.5, v = cy / cw * 0.5 + 0.5;
        const onScreen = 1 - Math.min(1, Math.max(0, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 1) * 1.5);
        // Strongest with the sun low (sunrise, sunset), fading out as it sets below the horizon.
        const up = Math.max(0, Math.min(1, (d[1] + 0.04) / 0.1)), low = 1 - Math.max(0, Math.min(1, d[1] * 2.5));
        const strength = 0.5 * onScreen * up * (0.6 + 0.9 * low) * (1 - (s.rain || 0));
        sun = [u, v, strength];
      }
    }
    // God rays: trace at quarter resolution, blur once, composite in the post pass.
    if (sun[2] > 0.001) {
      this.quarterTargets();
      const [bw, bh] = this.bloomSize, gp = this.godProg, bp = this.bloomProg;
      gl.viewport(0, 0, bw, bh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.godFboA);
      gl.useProgram(gp.p);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.sceneDepth);
      gl.uniform1i(gp.u.uDepth, 1);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex); gl.uniform1i(gp.u.uScene, 3); gl.activeTexture(gl.TEXTURE1);
      gl.uniform3f(gp.u.uSun, sun[0], sun[1], sun[2]);
      gl.uniform2f(gp.u.uAspect, w / h, 1);
      gl.uniform1f(gp.u.uSamples, Q.god);
      gl.uniform1f(gp.u.uTime, s.time || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(bp.p);
      const pass = (src, dst, mode) => { gl.bindFramebuffer(gl.FRAMEBUFFER, dst); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(bp.u.uSrc, 1); gl.uniform1i(bp.u.uMode, mode); gl.uniform2f(bp.u.uTexel, 1 / bw, 1 / bh); gl.drawArrays(gl.TRIANGLES, 0, 3); };
      pass(this.godA, this.godFboB, 1); pass(this.godB, this.godFboA, 2);
      gl.activeTexture(gl.TEXTURE0);
    }
    if (Q.bloom) {
      this.quarterTargets();
      const bp = this.bloomProg, [bw, bh] = this.bloomSize;
      gl.useProgram(bp.p);
      gl.viewport(0, 0, bw, bh);
      gl.activeTexture(gl.TEXTURE1);
      const pass = (src, dst, mode, tw, th) => { gl.bindFramebuffer(gl.FRAMEBUFFER, dst); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(bp.u.uSrc, 1); gl.uniform1i(bp.u.uMode, mode); gl.uniform2f(bp.u.uTexel, 1 / tw, 1 / th); gl.drawArrays(gl.TRIANGLES, 0, 3); };
      pass(this.sceneTex, this.bloomFboA, 0, w, h);
      for (let k = 0; k < (this.quality >= 3 ? 2 : 1); k++) { pass(this.bloomA, this.bloomFboB, 1, bw, bh); pass(this.bloomB, this.bloomFboA, 2, bw, bh); }
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    if (direct) {
      this.stats.chunks = visible.length; this.stats.quads = quads; this.stats.draws = this.draws;
      return;
    }
    const p = this.post;
    gl.useProgram(p.p);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.sceneDepth);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.bloomA);
    gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, this.godA);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(p.u.uScene, 1); gl.uniform1i(p.u.uDepth, 2); gl.uniform1i(p.u.uBloom, 6); gl.uniform1i(p.u.uGod, 7);
    gl.uniform1i(p.u.uQuality, this.quality);
    gl.uniform2f(p.u.uTexel, 1 / w, 1 / h);
    gl.uniform3f(p.u.uSun, sun[0], sun[1], sun[2]);
    gl.uniform3fv(p.u.uSunColor, env.sunColor);
    gl.uniform1f(p.u.uBloomStrength, Q.bloom || 0);
    gl.uniform1f(p.u.uMedium, s.medium);
    gl.uniform1f(p.u.uTime, s.time);
    gl.uniform1f(p.u.uFlash, fx.flash || 0);
    gl.uniform1f(p.u.uHurt, fx.hurt || 0);
    gl.uniform1f(p.u.uPortal, fx.portal || 0);
    gl.uniform1f(p.u.uDark, fx.dark || 0);
    gl.uniform1f(p.u.uSaturation, fx.saturation ?? 1.1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.stats.chunks = visible.length; this.stats.quads = quads; this.stats.draws = this.draws;
  }

  drawOutline(tg, viewProj) {
    const gl = this.gl;
    const b = tg.box || [0, 0, 0, 1, 1, 1];
    const e = 0.003;
    const x0 = tg.x + b[0] - e, y0 = tg.y + b[1] - e, z0 = tg.z + b[2] - e, x1 = tg.x + b[3] + e, y1 = tg.y + b[4] + e, z1 = tg.z + b[5] + e;
    const v = [
      x0, y0, z0, x1, y0, z0, x1, y0, z0, x1, y0, z1, x1, y0, z1, x0, y0, z1, x0, y0, z1, x0, y0, z0,
      x0, y1, z0, x1, y1, z0, x1, y1, z0, x1, y1, z1, x1, y1, z1, x0, y1, z1, x0, y1, z1, x0, y1, z0,
      x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1,
    ];
    gl.useProgram(this.line.p);
    gl.uniformMatrix4fv(this.line.u.uViewProj, false, viewProj);
    gl.uniform4f(this.line.u.uColor, 0.02, 0.02, 0.02, 0.7);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, 24);
    gl.disable(gl.BLEND);
  }

  drawCrack(cr, viewProj) {
    const gl = this.gl;
    const b = cr.box || [0, 0, 0, 1, 1, 1], e = 0.004;
    const a = [cr.x + b[0] - e, cr.y + b[1] - e, cr.z + b[2] - e], c = [cr.x + b[3] + e, cr.y + b[4] + e, cr.z + b[5] + e];
    const P = (i, j, k) => [[a[0], c[0]][i], [a[1], c[1]][j], [a[2], c[2]][k]];
    const faces = [
      [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)], [P(0, 0, 1), P(0, 1, 1), P(0, 1, 0), P(0, 0, 0)],
      [P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), P(0, 1, 0)], [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)],
      [P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), P(0, 0, 1)], [P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)],
    ];
    if (!this.crackBatch) this.crackBatch = new Batch();
    const bt = this.crackBatch;
    bt.reset();
    const layer = TEX[`destroy_${cr.stage}`];
    for (const f of faces) bt.quad(f, [0, 0, 1, 1], layer, [1, 1, 1, 1]);
    gl.useProgram(this.entity.p);
    gl.uniformMatrix4fv(this.entity.u.uViewProj, false, viewProj);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -1);
    this.drawBatch(bt, this.blockTex, 0.05, true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
}

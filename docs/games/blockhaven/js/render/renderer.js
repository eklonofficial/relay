import { CHUNK, TEX, DIM } from '../data/blocks.js?v=muoh3kij';
import { meshSingleBlock, STRIDE } from '../mesh/mesher.js?v=muoh3kij';
import * as S from './shaders.js?v=muoh3kij';
import { uploadArray } from './atlas.js?v=muoh3kij';
import { mat4, perspective, multiply, invert, viewMatrix, frustumPlanes, boxVisible } from '../core/math.js?v=muoh3kij';

// Graphics presets: 0 Disabled, 1 Regular, 2 High, 3 PC.
export const QUALITY = [
  { name: 'Disabled', shadow: 0, god: 0, bloom: 0, ssr: 0 },
  { name: 'Regular', shadow: 0, god: 0, bloom: 0, ssr: 20 },
  { name: 'High', shadow: 2048, shadowR: 72, pcf: 1, god: 40, bloom: 0.2, ssr: 32 },
  { name: 'PC', shadow: 4096, shadowR: 112, pcf: 2, god: 80, bloom: 0.24, ssr: 56 },
];

const MAX_QUADS = 1 << 18;
const IDENTITY = mat4();

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
    const U = [uv[0], uv[0], uv[2], uv[2]], V = [uv[3], uv[1], uv[1], uv[3]];
    for (let k = 0; k < 4; k++) {
      d[o++] = p[k][0]; d[o++] = p[k][1]; d[o++] = p[k][2];
      d[o++] = U[k]; d[o++] = V[k]; d[o++] = layer;
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
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.stats = { chunks: 0, quads: 0 };
    this.terrain = this.program(S.TERRAIN_VS, S.TERRAIN_FS);
    this.liquid = this.program(S.TERRAIN_VS, S.LIQUID_FS);
    this.sky = this.program(S.SKY_VS, S.SKY_FS);
    this.entity = this.program(S.ENTITY_VS, S.ENTITY_FS);
    this.line = this.program(S.LINE_VS, S.LINE_FS);
    this.post = this.program(S.POST_VS, S.POST_FS);
    this.shadowProg = this.program(S.TERRAIN_VS, S.SHADOW_FS);
    this.bloomProg = this.program(S.POST_VS, S.BLOOM_FS);
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

    this.batchVao = gl.createVertexArray();
    this.batchVbo = gl.createBuffer();
    gl.bindVertexArray(this.batchVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.batchVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);

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

  setBlockTextures(chain, count) { this.blockTex = uploadArray(this.gl, chain, count); }
  setEntityTextures(chain, count) { this.entityTex = uploadArray(this.gl, chain, count); }
  setItemTextures(chain, count) { this.itemTex = uploadArray(this.gl, chain, count); }
  texFor(kind) { return kind === 'block' ? this.blockTex : kind === 'item' ? this.itemTex : this.entityTex; }

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
    this.width = 0; // force target rebuild
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    const gl = this.gl;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    for (const f of [this.sceneFbo, this.copyFbo, this.bloomFboA, this.bloomFboB]) if (f) gl.deleteFramebuffer(f);
    for (const t of [this.sceneTex, this.sceneDepth, this.copyTex, this.copyDepth, this.bloomA, this.bloomB]) if (t) gl.deleteTexture(t);
    this.sceneTex = this.colorTexture(w, h);
    this.sceneDepth = this.depthTexture(w, h, false);
    this.sceneFbo = this.fbo(this.sceneTex, this.sceneDepth);
    this.copyTex = this.colorTexture(w, h);
    this.copyDepth = this.depthTexture(w, h, false);
    this.copyFbo = this.fbo(this.copyTex, this.copyDepth);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    this.bloomSize = [bw, bh];
    this.bloomA = this.colorTexture(bw, bh); this.bloomB = this.colorTexture(bw, bh);
    this.bloomFboA = this.fbo(this.bloomA, null); this.bloomFboB = this.fbo(this.bloomB, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    const p = this.shadowProg;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uViewProj, false, vp);
    gl.uniformMatrix4fv(p.u.uModel, false, IDENTITY);
    if (p.u.uTime) gl.uniform1f(p.u.uTime, s.time);
    if (p.u.uWind) gl.uniform1f(p.u.uWind, s.wind || 0);
    gl.uniform1i(p.u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    for (const c2 of visibleChunks) {
      const m = c2.gpu && c2.gpu.opaque;
      if (!m) continue;
      const x0 = c2.cx * CHUNK, z0 = c2.cz * CHUNK;
      if (Math.abs(x0 + 8 - c[0]) > R + 24 || Math.abs(z0 + 8 - c[2]) > R + 24) continue;
      if (!boxVisible(planes, x0, -1, z0, x0 + CHUNK, c2.maxY + 2, z0 + CHUNK)) continue;
      gl.uniform3f(p.u.uChunk, x0, 0, z0);
      gl.bindVertexArray(m.vao);
      this.drawSections(m, c2.gpu.secO, c2, planes);
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
    if (!c.gpu) c.gpu = { opaque: null, trans: null };
    c.gpu.opaque = this.makeMesh(r.opaque, r.opaqueQuads, c.gpu.opaque);
    c.gpu.trans = this.makeMesh(r.trans, r.transQuads, c.gpu.trans);
    c.gpu.secO = r.secO; c.gpu.secT = r.secT;
  }
  freeChunk(c) {
    if (!c.gpu) return;
    this.freeMesh(c.gpu.opaque); this.freeMesh(c.gpu.trans);
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

  // Draws only the 16-tall sections of a chunk mesh that are inside the frustum.
  drawSections(m, sec, c, planes) {
    const gl = this.gl;
    if (!sec) { gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0); return m.quads; }
    const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
    let start = -1, end = -1, n = 0;
    const flush = () => { if (start >= 0 && end > start) { gl.drawElements(gl.TRIANGLES, (end - start) * 6, gl.UNSIGNED_INT, start * 24); n += end - start; } start = -1; };
    for (let s = 0; s < 16; s++) {
      const a = sec[s], b = Math.min(sec[s + 1], m.quads);
      if (b <= a) continue;
      if (boxVisible(planes, x0, s * 16 - 1, z0, x0 + CHUNK, s * 16 + 17, z0 + CHUNK)) { if (start < 0) start = a; end = b; }
      else flush();
    }
    flush();
    return n;
  }

  drawBatch(batch, tex, alphaTest, blend) {
    if (!batch || !batch.quads) return;
    const gl = this.gl;
    gl.bindVertexArray(this.batchVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.batchVbo);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.quads * 40), gl.STREAM_DRAW);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.uniform1f(this.entity.u.uAlphaTest, alphaTest);
    if (blend) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    gl.drawElements(gl.TRIANGLES, batch.quads * 6, gl.UNSIGNED_INT, 0);
    if (blend) { gl.disable(gl.BLEND); gl.depthMask(true); }
  }

  render(s) {
    const gl = this.gl;
    const w = this.width, h = this.height;
    const proj = perspective(mat4(), s.fov * Math.PI / 180, w / h, 0.05, 1200);
    const view = s.view || viewMatrix(s.camPos, s.yaw, s.pitch, s.roll);
    const viewProj = multiply(mat4(), proj, view);
    const invViewProj = invert(mat4(), viewProj);
    const planes = frustumPlanes(viewProj);
    const fogFar = s.dim === DIM.NETHER ? Math.min(s.renderDistance * CHUNK - 4, 90) : s.renderDistance * CHUNK - 4;
    const fogNear = s.dim === DIM.NETHER ? 10 : fogFar * (s.rain ? 0.3 : 0.55);
    const env = s.env;
    const Q = QUALITY[this.quality];
    const allChunks = [...s.chunks];
    const sunUp = s.dim === DIM.OVERWORLD ? Math.max(0, Math.min(1, (env.sunDir[1] - 0.04) * 5)) * (1 - (s.rain || 0) * 0.7) : 0;
    let shadowMat = null;
    if (Q.shadow && this.shadowFbo && sunUp > 0) shadowMat = this.shadowPass(s, allChunks);
    this.shadowStrength = shadowMat ? 0.42 * sunUp : 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
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

    const visible = [];
    for (const c of allChunks) {
      if (!c.gpu) continue;
      const x0 = c.cx * CHUNK, z0 = c.cz * CHUNK;
      if (!boxVisible(planes, x0, -1, z0, x0 + CHUNK, c.maxY + 2, z0 + CHUNK)) continue;
      const dx = x0 + 8 - s.camPos[0], dz = z0 + 8 - s.camPos[2];
      visible.push([c, dx * dx + dz * dz]);
    }
    visible.sort((a, b) => a[1] - b[1]);

    const t = this.terrain;
    gl.useProgram(t.p);
    this.setEnv(t.u, s, fogNear, fogFar);
    gl.uniformMatrix4fv(t.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(t.u.uModel, false, IDENTITY);
    gl.uniform1i(t.u.uTex, 0);
    gl.uniform1f(t.u.uAlpha, 1);
    this.bindShadow(t.u, !!shadowMat, shadowMat, this.shadowStrength);
    let quads = 0;
    for (const [c] of visible) {
      const m = c.gpu.opaque;
      if (!m) continue;
      gl.uniform3f(t.u.uChunk, c.cx * CHUNK, 0, c.cz * CHUNK);
      gl.bindVertexArray(m.vao);
      quads += this.drawSections(m, c.gpu.secO, c, planes);
    }

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
    gl.uniform1f(this.sky.u.uClouds, s.clouds ? 1 : 0);
    gl.uniform1f(this.sky.u.uRain, s.rain || 0);
    gl.uniform1i(this.sky.u.uDim, s.dim || 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);

    // Snapshot the opaque scene for water reflections/refraction, only when water is in view.
    const anyWater = visible.some(([c]) => c.gpu.trans);
    const ssr = Q.ssr > 0 && s.medium === 0 && anyWater;
    if (ssr) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copyFbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    }
    // Translucent terrain, back to front.
    gl.useProgram(e.p);
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
    gl.uniform2f(l.u.uNearFar, 0.05, 1200);
    gl.uniform2f(l.u.uScreen, w, h);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.copyTex);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, this.copyDepth);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(l.u.uOpaque, 4); gl.uniform1i(l.u.uOpaqueDepth, 5);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    for (let i = visible.length - 1; i >= 0; i--) {
      const c = visible[i][0], m = c.gpu.trans;
      if (!m) continue;
      gl.uniform3f(l.u.uChunk, c.cx * CHUNK, 0, c.cz * CHUNK);
      gl.bindVertexArray(m.vao);
      quads += this.drawSections(m, c.gpu.secT, c, planes);
    }
    // Translucent effects: weather, smoke, glints.
    gl.useProgram(e.p);
    for (const b of s.blendBatches || []) { const tx = this.texFor(b.tex); if (tx) { if (b.additive) { gl.enable(gl.BLEND); } this.drawBatch(b.batch, tx, b.alphaTest ?? 0.02, true); } }
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
    if (Q.bloom) {
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
    const p = this.post, fx = s.post || {};
    gl.useProgram(p.p);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.sceneDepth);
    gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, this.bloomA);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(p.u.uScene, 1); gl.uniform1i(p.u.uDepth, 2); gl.uniform1i(p.u.uBloom, 6);
    gl.uniform1i(p.u.uQuality, this.quality);
    gl.uniform2f(p.u.uTexel, 1 / w, 1 / h);
    // Sun position on screen for god rays.
    let sun = [0, 0, 0];
    if (Q.god && s.dim === DIM.OVERWORLD && s.medium === 0) {
      const d = env.sunDir, sp = [s.camPos[0] + d[0] * 500, s.camPos[1] + d[1] * 500, s.camPos[2] + d[2] * 500];
      const m = viewProj;
      const cx = m[0] * sp[0] + m[4] * sp[1] + m[8] * sp[2] + m[12], cy = m[1] * sp[0] + m[5] * sp[1] + m[9] * sp[2] + m[13], cw = m[3] * sp[0] + m[7] * sp[1] + m[11] * sp[2] + m[15];
      if (cw > 0) {
        const u = cx / cw * 0.5 + 0.5, v = cy / cw * 0.5 + 0.5;
        const onScreen = 1 - Math.min(1, Math.max(0, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2 - 1) * 1.5);
        const strength = 0.45 * onScreen * Math.max(0, Math.min(1, d[1] * 4 + 0.2)) * (1 - (s.rain || 0));
        sun = [u, v, strength];
      }
    }
    gl.uniform3f(p.u.uSun, sun[0], sun[1], sun[2]);
    gl.uniform3fv(p.u.uSunColor, env.sunColor);
    gl.uniform1f(p.u.uGodSamples, Q.god || 1);
    gl.uniform1f(p.u.uBloomStrength, Q.bloom || 0);
    gl.uniform1f(p.u.uMedium, s.medium);
    gl.uniform1f(p.u.uTime, s.time);
    gl.uniform1f(p.u.uFlash, fx.flash || 0);
    gl.uniform1f(p.u.uHurt, fx.hurt || 0);
    gl.uniform1f(p.u.uPortal, fx.portal || 0);
    gl.uniform1f(p.u.uDark, fx.dark || 0);
    gl.uniform1f(p.u.uSaturation, fx.saturation ?? 1.1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.stats.chunks = visible.length;
    this.stats.quads = quads;
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

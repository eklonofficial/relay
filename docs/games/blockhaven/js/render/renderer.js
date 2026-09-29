import { CHUNK, TEX, DIM } from '../data/blocks.js';
import { meshSingleBlock, STRIDE } from '../mesh/mesher.js';
import * as S from './shaders.js';
import { uploadArray } from './atlas.js';
import { mat4, perspective, multiply, invert, viewMatrix, frustumPlanes, boxVisible } from '../core/math.js';

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
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
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

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    const gl = this.gl;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    for (const o of [this.msFbo, this.resolveFbo]) if (o) gl.deleteFramebuffer(o);
    for (const o of [this.msColor, this.msDepth, this.depthRb]) if (o) gl.deleteRenderbuffer(o);
    if (this.sceneTex) gl.deleteTexture(this.sceneTex);
    this.sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.resolveFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    this.msFbo = null; this.depthRb = null;
    if (this.samples > 1) {
      this.msColor = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, w, h);
      this.msDepth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.msDepth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
      this.msFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msDepth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) { this.samples = 0; this.msFbo = null; }
    }
    if (!this.msFbo) {
      this.depthRb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo || this.resolveFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky
    gl.disable(gl.DEPTH_TEST);
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

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);

    const visible = [];
    for (const c of s.chunks) {
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
    let quads = 0;
    for (const [c] of visible) {
      const m = c.gpu.opaque;
      if (!m) continue;
      gl.uniform3f(t.u.uChunk, c.cx * CHUNK, 0, c.cz * CHUNK);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
      quads += m.quads;
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

    // Translucent terrain, back to front.
    gl.useProgram(e.p);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    const l = this.liquid;
    gl.useProgram(l.p);
    this.setEnv(l.u, s, fogNear, fogFar);
    gl.uniformMatrix4fv(l.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(l.u.uModel, false, IDENTITY);
    gl.uniform1i(l.u.uTex, 0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    for (let i = visible.length - 1; i >= 0; i--) {
      const c = visible[i][0], m = c.gpu.trans;
      if (!m) continue;
      gl.uniform3f(l.u.uChunk, c.cx * CHUNK, 0, c.cz * CHUNK);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
      quads += m.quads;
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
      if (s.hand.block) {
        const m = this.blockModel(s.hand.block.id, s.hand.block.meta);
        if (m) {
          gl.useProgram(t.p);
          this.setEnv(t.u, hs, 1e4, 2e4, [0, 0, 0], 0);
          gl.uniformMatrix4fv(t.u.uViewProj, false, handProj);
          gl.uniformMatrix4fv(t.u.uModel, false, s.hand.block.matrix);
          gl.uniform3f(t.u.uChunk, 0, 0, 0);
          const L = s.hand.light;
          gl.uniform3f(t.u.uSkyLight, L, L, L);
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
    }

    // Resolve + post.
    gl.bindVertexArray(this.emptyVao);
    if (this.msFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    const p = this.post, fx = s.post || {};
    gl.useProgram(p.p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(p.u.uScene, 1);
    gl.uniform1f(p.u.uMedium, s.medium);
    gl.uniform1f(p.u.uTime, s.time);
    gl.uniform1f(p.u.uFlash, fx.flash || 0);
    gl.uniform1f(p.u.uHurt, fx.hurt || 0);
    gl.uniform1f(p.u.uPortal, fx.portal || 0);
    gl.uniform1f(p.u.uDark, fx.dark || 0);
    gl.uniform1f(p.u.uSaturation, fx.saturation ?? 1.1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);

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

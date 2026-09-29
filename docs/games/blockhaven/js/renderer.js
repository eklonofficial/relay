import { CHUNK, TEX, TEXTURES, BLOCKS, R_CROSS, R_TORCH } from './blocks.js';
import * as S from './shaders.js';
import { mat4, perspective, multiply, invert, viewMatrix, frustumPlanes, boxVisible, compose, translation, rotationX, rotationY, rotationZ, scaling } from './math.js';

const MAX_QUADS = 1 << 17;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.stats = { chunks: 0, quads: 0 };

    this.terrain = this.program(S.TERRAIN_VS, S.TERRAIN_FS);
    this.liquid = this.program(S.TERRAIN_VS, S.LIQUID_FS);
    this.sky = this.program(S.SKY_VS, S.SKY_FS);
    this.overlay = this.program(S.OVERLAY_VS, S.OVERLAY_FS);
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

    this.overlayVao = gl.createVertexArray();
    this.overlayVbo = gl.createBuffer();
    gl.bindVertexArray(this.overlayVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.quadIndex);

    this.lineVao = gl.createVertexArray();
    this.lineVbo = gl.createBuffer();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);

    this.hand = null;
    this.handKey = '';
    this.samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
    this.width = this.height = 0;
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

  setTextures(layers) {
    const gl = this.gl;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 16, 16, layers.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    layers.forEach((d, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, 16, 16, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(d.buffer)));
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, 4);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }

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

    this.msFbo = null;
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

  makeMesh(buffer, quads, old) {
    const gl = this.gl;
    if (!quads) { if (old) this.freeMesh(old); return null; }
    const m = old || { vao: gl.createVertexArray(), vbo: gl.createBuffer() };
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, false, 12, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, false, 12, 8);
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
    this.freeMesh(c.gpu.opaque);
    this.freeMesh(c.gpu.trans);
    c.gpu = null;
  }

  // Small mesh for the held block, in the chunk vertex format.
  buildHand(id, light) {
    const k = `${id}:${light}`;
    if (k === this.handKey) return;
    this.handKey = k;
    const b = BLOCKS[id];
    const quads = [];
    const faceDefs = [
      [0, [[16, 0, 0], [16, 16, 0], [16, 16, 16], [16, 0, 16]], [2, 1, 0, 3]],
      [1, [[0, 0, 16], [0, 16, 16], [0, 16, 0], [0, 0, 0]], [2, 1, 0, 3]],
      [2, [[0, 16, 0], [0, 16, 16], [16, 16, 16], [16, 16, 0]], [0, 3, 2, 1]],
      [3, [[0, 0, 16], [0, 0, 0], [16, 0, 0], [16, 0, 16]], [3, 0, 1, 2]],
      [4, [[16, 0, 16], [16, 16, 16], [0, 16, 16], [0, 0, 16]], [2, 1, 0, 3]],
      [5, [[0, 0, 0], [0, 16, 0], [16, 16, 0], [16, 0, 0]], [2, 1, 0, 3]],
    ];
    const faceLayer = f => TEX[f === 2 ? b.tex.top : f === 3 ? b.tex.bottom : b.tex.side];
    if (b.render === R_CROSS) {
      quads.push([6, [[0, 0, 8], [0, 16, 8], [16, 16, 8], [16, 0, 8]], [3, 0, 1, 2], TEX[b.tex.side]]);
      quads.push([6, [[16, 0, 8], [16, 16, 8], [0, 16, 8], [0, 0, 8]], [3, 0, 1, 2], TEX[b.tex.side]]);
    } else {
      const torch = b.render === R_TORCH;
      for (const [f, corners, uv] of faceDefs) {
        const cs = torch ? corners.map(([x, y, z]) => [x ? 9 : 7, y ? 10 : 0, z ? 9 : 7]) : corners;
        quads.push([f, cs, uv, faceLayer(f)]);
      }
    }
    const u16 = new Uint16Array(quads.length * 24), u8 = new Uint8Array(u16.buffer);
    quads.forEach(([f, cs, uv, layer], q) => {
      for (let v = 0; v < 4; v++) {
        const i = q * 4 + v;
        u16[i * 6] = cs[v][0]; u16[i * 6 + 1] = cs[v][1]; u16[i * 6 + 2] = cs[v][2]; u16[i * 6 + 3] = b.flags === 7 ? 7 : 0;
        u8[i * 12 + 8] = layer; u8[i * 12 + 9] = f | (uv[v] << 3); u8[i * 12 + 10] = 3; u8[i * 12 + 11] = light;
      }
    });
    this.hand = this.makeMesh(u16.buffer, quads.length, this.hand);
    this.handIsFlat = b.render === R_CROSS;
    this.handIsTorch = b.render === R_TORCH;
  }

  setEnvUniforms(u, env, camPos, fogNear, fogFar, underwater) {
    const gl = this.gl;
    if (u.uFogColor) gl.uniform3fv(u.uFogColor, env.fogColor);
    if (u.uFogNear) gl.uniform1f(u.uFogNear, fogNear);
    if (u.uFogFar) gl.uniform1f(u.uFogFar, fogFar);
    if (u.uSkyLight) gl.uniform3fv(u.uSkyLight, env.skyLight);
    if (u.uCamPos) gl.uniform3fv(u.uCamPos, camPos);
    if (u.uUnderwater) gl.uniform1f(u.uUnderwater, underwater ? 1 : 0);
    if (u.uZenith) gl.uniform3fv(u.uZenith, env.zenith);
    if (u.uHorizon) gl.uniform3fv(u.uHorizon, env.horizon);
    if (u.uSunDir) gl.uniform3fv(u.uSunDir, env.sunDir);
    if (u.uSunColor) gl.uniform3fv(u.uSunColor, env.sunColor);
  }

  render(s) {
    const gl = this.gl;
    const w = this.width, h = this.height;
    const proj = perspective(mat4(), s.fov * Math.PI / 180, w / h, 0.05, 1000);
    const view = viewMatrix(s.camPos, s.yaw, s.pitch, s.roll);
    const viewProj = multiply(mat4(), proj, view);
    const invViewProj = invert(mat4(), viewProj);
    const planes = frustumPlanes(viewProj);
    const fogFar = s.renderDistance * CHUNK - 4, fogNear = fogFar * 0.55;
    const env = s.env;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.msFbo || this.resolveFbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(env.fogColor[0], env.fogColor[1], env.fogColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.sky.p);
    this.setEnvUniforms(this.sky.u, env, s.camPos, fogNear, fogFar, s.underwater);
    gl.uniformMatrix4fv(this.sky.u.uInvViewProj, false, invViewProj);
    gl.uniform1f(this.sky.u.uTime, s.time);
    gl.uniform1f(this.sky.u.uNight, env.night);
    gl.uniform1f(this.sky.u.uClouds, s.clouds ? 1 : 0);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Opaque terrain, front to back
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);

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
    this.setEnvUniforms(t.u, env, s.camPos, fogNear, fogFar, s.underwater);
    gl.uniformMatrix4fv(t.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(t.u.uModel, false, mat4());
    gl.uniform1f(t.u.uTime, s.time);
    gl.uniform1i(t.u.uTex, 0);
    let quads = 0;
    for (const [c] of visible) {
      const m = c.gpu.opaque;
      if (!m) continue;
      gl.uniform3f(t.u.uChunk, c.cx * CHUNK, 0, c.cz * CHUNK);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
      quads += m.quads;
    }

    // Block outline, cracks and particles
    if (s.target) this.drawOutline(s.target, viewProj);
    this.drawOverlay(s, viewProj, env, fogNear, fogFar);

    // Water, lava and ice, back to front
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    const l = this.liquid;
    gl.useProgram(l.p);
    this.setEnvUniforms(l.u, env, s.camPos, fogNear, fogFar, s.underwater);
    gl.uniformMatrix4fv(l.u.uViewProj, false, viewProj);
    gl.uniformMatrix4fv(l.u.uModel, false, mat4());
    gl.uniform1f(l.u.uTime, s.time);
    gl.uniform1i(l.u.uTex, 0);
    for (let i = visible.length - 1; i >= 0; i--) {
      const c = visible[i][0], m = c.gpu.trans;
      if (!m) continue;
      gl.uniform3f(l.u.uChunk, c.cx * CHUNK, 0, c.cz * CHUNK);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.quads * 6, gl.UNSIGNED_INT, 0);
      quads += m.quads;
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);

    // Held block
    if (s.hand && this.hand) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const handProj = perspective(mat4(), 70 * Math.PI / 180, w / h, 0.01, 10);
      gl.useProgram(t.p);
      this.setEnvUniforms(t.u, env, [0, 0, 0], 1e4, 2e4, false);
      gl.uniformMatrix4fv(t.u.uViewProj, false, handProj);
      gl.uniformMatrix4fv(t.u.uModel, false, s.hand.matrix);
      gl.uniform3f(t.u.uChunk, 0, 0, 0);
      if (this.handIsFlat) gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.hand.vao);
      gl.drawElements(gl.TRIANGLES, this.hand.quads * 6, gl.UNSIGNED_INT, 0);
      gl.enable(gl.CULL_FACE);
    }

    // Resolve and post-process
    gl.bindVertexArray(this.emptyVao);
    if (this.msFbo) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.post.p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.post.u.uScene, 1);
    gl.uniform1f(this.post.u.uUnderwater, s.underwater ? 1 : 0);
    gl.uniform1f(this.post.u.uTime, s.time);
    gl.uniform1f(this.post.u.uFlash, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);

    this.stats.chunks = visible.length;
    this.stats.quads = quads;
  }

  drawOutline(tg, viewProj) {
    const gl = this.gl;
    const e = 0.003, x0 = tg.x - e, y0 = tg.y - e, z0 = tg.z - e, x1 = tg.x + 1 + e, y1 = tg.y + 1 + e, z1 = tg.z + 1 + e;
    const v = [
      x0, y0, z0, x1, y0, z0, x1, y0, z0, x1, y0, z1, x1, y0, z1, x0, y0, z1, x0, y0, z1, x0, y0, z0,
      x0, y1, z0, x1, y1, z0, x1, y1, z0, x1, y1, z1, x1, y1, z1, x0, y1, z1, x0, y1, z1, x0, y1, z0,
      x0, y0, z0, x0, y1, z0, x1, y0, z0, x1, y1, z0, x1, y0, z1, x1, y1, z1, x0, y0, z1, x0, y1, z1,
    ];
    gl.useProgram(this.line.p);
    gl.uniformMatrix4fv(this.line.u.uViewProj, false, viewProj);
    gl.uniform4f(this.line.u.uColor, 0.05, 0.05, 0.05, 0.75);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, 24);
    gl.disable(gl.BLEND);
  }

  drawOverlay(s, viewProj, env, fogNear, fogFar) {
    const gl = this.gl;
    const data = [];
    let quads = 0;
    const quad = (p, layer, uvRect, bright) => {
      const [u0, v0, u1, v1] = uvRect;
      const uvs = [[u0, v1], [u0, v0], [u1, v0], [u1, v1]];
      for (let k = 0; k < 4; k++) data.push(p[k][0], p[k][1], p[k][2], uvs[k][0], uvs[k][1], layer, bright);
      quads++;
    };

    // Cracks on the block being broken
    let crackQuads = 0;
    if (s.crack && s.target) {
      const e = 0.004, { x, y, z } = s.target;
      const a = [x - e, y - e, z - e], b = [x + 1 + e, y + 1 + e, z + 1 + e];
      const P = (i, j, k) => [[a[0], b[0]][i], [a[1], b[1]][j], [a[2], b[2]][k]];
      const faces = [
        [P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1)], [P(0, 0, 1), P(0, 1, 1), P(0, 1, 0), P(0, 0, 0)],
        [P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), P(0, 1, 0)], [P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1)],
        [P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), P(0, 0, 1)], [P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0)],
      ];
      const layer = TEX[`destroy_${s.crack}`];
      for (const f of faces) quad(f, layer, [0, 0, 1, 1], 1);
      crackQuads = quads;
    }

    // Break particles, billboarded towards the camera
    const right = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)];
    const up = [Math.sin(s.yaw) * Math.sin(s.pitch), Math.cos(s.pitch), Math.cos(s.yaw) * Math.sin(s.pitch)];
    for (const p of s.particles) {
      const h = p.size / 2;
      const c = (sr, su) => [p.x + (right[0] * sr + up[0] * su) * h, p.y + (right[1] * sr + up[1] * su) * h, p.z + (right[2] * sr + up[2] * su) * h];
      quad([c(-1, -1), c(-1, 1), c(1, 1), c(1, -1)], p.layer, [p.u, p.v, p.u + 0.25, p.v + 0.25], p.bright);
    }
    if (!quads) return;

    gl.useProgram(this.overlay.p);
    this.setEnvUniforms(this.overlay.u, env, s.camPos, fogNear, fogFar, s.underwater);
    gl.uniformMatrix4fv(this.overlay.u.uViewProj, false, viewProj);
    gl.uniform1i(this.overlay.u.uTex, 0);
    gl.bindVertexArray(this.overlayVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    gl.disable(gl.CULL_FACE);
    if (crackQuads) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      gl.depthMask(false);
      gl.uniform1f(this.overlay.u.uAlphaTest, 0.05);
      gl.drawElements(gl.TRIANGLES, crackQuads * 6, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.BLEND);
    }
    if (quads > crackQuads) {
      gl.uniform1f(this.overlay.u.uAlphaTest, 0.5);
      gl.drawElements(gl.TRIANGLES, (quads - crackQuads) * 6, gl.UNSIGNED_INT, crackQuads * 24);
    }
    gl.enable(gl.CULL_FACE);
  }
}

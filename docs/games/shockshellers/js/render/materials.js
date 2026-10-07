// Procedural textures for the map's material families (maps/dsl.js MAT). Everything is drawn at
// start-up on canvases: low-poly, bright, with visible tile seams and triangle noise (GDD §25), and
// no image files to fetch. Each family has a base texture; maps tint them through per-cell variants.
import * as THREE from '../../vendor/three/three.module.js?v=muyjiq9z';

const S = 256;
// Deterministic noise so every player sees the same walls.
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const hex = (c, k = 0) => {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = v => Math.max(0, Math.min(255, Math.round(v + k * 255)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};
// Offscreen: these never enter any document.
function canvas() { return new OffscreenCanvas(S, S); }

// Triangle noise: the faceted, slightly varied flat colour the reference style uses on grass/dirt.
function triangles(x, base, amount, seed, cell = 32) {
  const r = rng(seed);
  for (let gy = 0; gy < S; gy += cell) for (let gx = 0; gx < S; gx += cell) {
    for (const flip of [0, 1]) {
      x.fillStyle = hex(base, (r() - 0.5) * amount);
      x.beginPath();
      if (flip) { x.moveTo(gx, gy); x.lineTo(gx + cell, gy); x.lineTo(gx, gy + cell); }
      else { x.moveTo(gx + cell, gy); x.lineTo(gx + cell, gy + cell); x.lineTo(gx, gy + cell); }
      x.closePath(); x.fill();
    }
  }
}
// Bricks/tiles in rows with offset joints and a soft bevel on each one.
function bricks(x, base, mortar, rows, cols, seed, vary = 0.06, bevel = 0.08) {
  const r = rng(seed), h = S / rows, w = S / cols;
  x.fillStyle = hex(mortar); x.fillRect(0, 0, S, S);
  for (let row = 0; row < rows; row++) {
    const off = row % 2 ? w / 2 : 0;
    for (let col = -1; col <= cols; col++) {
      const bx = col * w + off + 2, by = row * h + 2, bw = w - 4, bh = h - 4;
      const k = (r() - 0.5) * vary * 2;
      x.fillStyle = hex(base, k); x.fillRect(bx, by, bw, bh);
      x.fillStyle = hex(base, k + bevel); x.fillRect(bx, by, bw, 3);
      x.fillStyle = hex(base, k - bevel); x.fillRect(bx, by + bh - 3, bw, 3);
    }
  }
}
function planks(x, base, seed, n = 4) {
  const r = rng(seed), h = S / n;
  for (let i = 0; i < n; i++) {
    const k = (r() - 0.5) * 0.12;
    x.fillStyle = hex(base, k); x.fillRect(0, i * h, S, h);
    x.strokeStyle = hex(base, k - 0.06); x.lineWidth = 2;
    for (let g = 0; g < 5; g++) { const y = i * h + 6 + r() * (h - 12); x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(S * 0.3, y + (r() - 0.5) * 6, S * 0.6, y + (r() - 0.5) * 6, S, y); x.stroke(); }
    x.fillStyle = hex(base, -0.2); x.fillRect(0, i * h, S, 3);
    const seam = r() * S; x.fillRect(seam, i * h, 3, h);
  }
}
// Soft mottled grain (stacked value noise): smooth stone and plaster, no busy pattern. Tiles come from
// the bevel shading in the material, one per cell, like big chunky blocks.
function grain(x, base, amount, seed) {
  const r = rng(seed), img = x.createImageData(S, S), d = img.data;
  const octaves = [[8, 0.5], [16, 0.3], [64, 0.2]].map(([n, w]) => { const g = new Float32Array((n + 1) * (n + 1)); for (let i = 0; i < g.length; i++) g[i] = r(); for (let k = 0; k <= n; k++) { g[n * (n + 1) + k] = g[k]; g[k * (n + 1) + n] = g[k * (n + 1)]; } return { n, w, g }; });
  const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
  for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) {
    let v = 0;
    for (const { n, w, g } of octaves) {
      const fx = xx / S * n, fy = y / S * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), at = (a, b) => g[b * (n + 1) + a];
      v += w * ((at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy);
    }
    const k = (v - 0.5) * amount * 255, i = (y * S + xx) * 4;
    d[i] = Math.max(0, Math.min(255, br + k)); d[i + 1] = Math.max(0, Math.min(255, bg + k)); d[i + 2] = Math.max(0, Math.min(255, bb + k)); d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
}
function speckle(x, base, amount, seed, count = 900, size = 3) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) { x.fillStyle = hex(base, (r() - 0.5) * amount); x.fillRect(r() * S, r() * S, size + r() * size, size + r() * size); }
}

const DRAW = {
  0: x => grain(x, 0xc9c3b6, 0.16, 11),                         // stone blocks (bevelled per cell)
  1: x => { grain(x, 0x78ad43, 0.22, 21); speckle(x, 0x78ad43, 0.14, 23, 700, 2); speckle(x, 0x9ccc5a, 0.08, 24, 250, 3); }, // grass
  2: x => planks(x, 0xb07a45, 31),                               // wood
  3: x => bricks(x, 0xb3593d, 0x9b8f80, 8, 4, 41, 0.07, 0.07),   // brick
  4: x => { grain(x, 0xe6d3a0, 0.12, 51); speckle(x, 0xe6d3a0, 0.08, 52, 400, 2); }, // sand
  5: x => { x.fillStyle = hex(0x8c96a0); x.fillRect(0, 0, S, S); bricks(x, 0x949ea8, 0x6c7680, 2, 2, 61, 0.03, 0.1); for (const [a, b] of [[16, 16], [S - 20, 16], [16, S / 2 - 20], [S - 20, S / 2 - 20]]) { x.fillStyle = hex(0x5c6670); x.fillRect(a, b, 5, 5); } }, // metal
  6: x => { triangles(x, 0x8f6a45, 0.10, 71, 32); speckle(x, 0x8f6a45, 0.15, 72, 300, 3); }, // dirt
  7: x => grain(x, 0xece5d6, 0.08, 81),                          // plaster
  8: x => bricks(x, 0x8c3b2a, 0x6c2b1e, 8, 3, 91, 0.06, 0.12),   // roof tiles
  9: x => grain(x, 0x86827e, 0.18, 101),                         // dark stone (bevelled per cell)
  10: x => { triangles(x, 0xf2f7fb, 0.04, 111, 64); },           // snow
  11: x => { x.fillStyle = hex(0xc9ced6); x.fillRect(0, 0, S, S); x.strokeStyle = hex(0x8d939c); x.lineWidth = 4; x.strokeRect(6, 6, S - 12, S - 12); x.strokeRect(S / 4, S / 4, S / 2, S / 2); }, // space panel
  12: x => { planks(x, 0xc49058, 121, 3); x.strokeStyle = hex(0x7a5530); x.lineWidth = 14; x.strokeRect(7, 7, S - 14, S - 14); x.beginPath(); x.moveTo(14, 14); x.lineTo(S - 14, S - 14); x.stroke(); }, // crate
  13: x => { x.fillStyle = hex(0xe6c35c); x.fillRect(0, 0, S, S); const r = rng(131); x.strokeStyle = hex(0xc9a33e); x.lineWidth = 2; for (let i = 0; i < 200; i++) { const a = r() * S, b = r() * S; x.beginPath(); x.moveTo(a, b); x.lineTo(a + (r() - 0.5) * 40, b + (r() - 0.5) * 8); x.stroke(); } }, // hay
  14: x => { triangles(x, 0xa7a9ac, 0.08, 141, 64); const r = rng(142); for (let i = 0; i < 14; i++) { x.strokeStyle = hex(0x86888b); x.lineWidth = 3; x.beginPath(); x.arc(r() * S, r() * S, 6 + r() * 18, 0, 6.3); x.stroke(); } }, // moon rock
  15: x => { x.fillStyle = hex(0xe8b42e); x.fillRect(0, 0, S, S); speckle(x, 0xe8b42e, 0.15, 151, 300, 3); }, // gold
  16: x => { triangles(x, 0x4f9a3a, 0.14, 161, 32); },          // leaves
  17: x => { triangles(x, 0x4aa3d8, 0.06, 171, 64); },          // water
  18: x => { triangles(x, 0xd24b3e, 0.06, 181, 64); },          // red team paint
  19: x => { triangles(x, 0x3f7fd6, 0.06, 191, 64); },          // blue team paint
};

const cache = new Map();
export function materialTexture(id) {
  if (cache.has(id)) return cache.get(id);
  const c = canvas(), x = c.getContext('2d');
  (DRAW[id] || DRAW[0])(x);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(id, t);
  return t;
}
// World units per texture repeat, per family (bricks look right at 2 cells, grass at 4).
export const TEX_SCALE = { 1: 0.25, 4: 0.25, 6: 0.25, 10: 0.25, 14: 0.25, 16: 0.5, 17: 0.25, 7: 0.25 };

// A soft, tileable fractal noise (three octaves of smoothed value noise, single channel), shared by
// the world's large-scale colour variation and the sky's clouds.
let noiseTex = null;
export function noiseTexture() {
  if (noiseTex) return noiseTex;
  const N = 256, r = rng(4242), data = new Uint8Array(N * N * 4);
  const octaves = [[8, 0.55], [16, 0.28], [32, 0.17]].map(([n, w]) => { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = r(); return { n, w, g }; });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const { n, w, g } of octaves) {
      const fx = x / N * n, fy = y / N * n, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), at = (a, b) => g[(b % n) * n + (a % n)];
      v += w * ((at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy);
    }
    const i = (y * N + x) * 4; data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255); data[i + 3] = 255;
  }
  noiseTex = new THREE.DataTexture(data, N, N);
  noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping; noiseTex.magFilter = THREE.LinearFilter; noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true; noiseTex.needsUpdate = true;
  return noiseTex;
}

// Every world material gets large-scale colour variation in the shader (two samples of the noise in
// world space, projected along the face's axis), so a field of grass or a long wall never shows its
// texture repeating; grass also drifts between lusher and sun-dried patches. Blocky materials also
// get soft bevelled edges per cell: a light rim along top edges, a shaded lip along the bottom, and a
// fine seam between neighbours, so a wall reads as chunky stacked blocks (no extra geometry).
const BEVELLED = new Set([0, 3, 5, 7, 9, 11, 12, 14, 15, 18, 19]);
const MACRO = { 1: 0.32, 4: 0.18, 6: 0.22, 10: 0.08, 14: 0.2, 16: 0.25, 0: 0.14, 9: 0.16, 7: 0.1, 2: 0.12, 3: 0.12, 8: 0.12, 13: 0.14 };
function shade(m, id) {
  const bevel = BEVELLED.has(id), macro = MACRO[id] ?? 0.1, grass = id === 1 || id === 16;
  m.onBeforeCompile = sh => {
    sh.uniforms.macroTex = { value: noiseTexture() };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float ao; varying float vAo; varying vec3 vWPos; varying vec3 vWNorm;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAo = ao; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNorm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAo; varying vec3 vWPos; varying vec3 vWNorm; uniform sampler2D macroTex;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= vAo;
        vec3 an = abs(vWNorm);
        vec2 mp = an.y > 0.5 ? vWPos.xz : (an.x > 0.5 ? vWPos.zy : vWPos.xy);
        float m1 = texture2D(macroTex, mp * 0.031).r, m2 = texture2D(macroTex, mp * 0.137 + 0.37).r;
        float mv = m1 * 0.65 + m2 * 0.35;
        diffuseColor.rgb *= 1.0 + (mv - 0.5) * ${(macro * 2).toFixed(3)};
        ${grass ? 'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.16, 1.06, 0.62), smoothstep(0.52, 0.78, m1) * 0.55 * an.y);' : ''}
        ${bevel ? `vec3 cf = fract(vWPos + 0.0005);
        vec2 cuv = an.x > 0.5 ? cf.zy : (an.y > 0.5 ? cf.xz : cf.xy);
        vec2 dd = min(cuv, 1.0 - cuv); float ce = min(dd.x, dd.y);
        float rim = 1.0 - smoothstep(0.0, 0.075, ce);
        float tone = an.y > 0.5 ? 0.13 : (cf.y > 0.5 ? 0.11 : -0.16);
        diffuseColor.rgb *= 1.0 + rim * tone;
        diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.004, 0.016, ce));` : ''}`);
  };
  m.customProgramCacheKey = () => `world${bevel ? 'b' : ''}${grass ? 'g' : ''}${macro}`;
}
const mats = new Map();
export function worldMaterial(id) {
  if (mats.has(id)) return mats.get(id);
  // (Occlusion comes in as a one-float "ao" attribute rather than three-float vertex colours: a third
  // of the data for the biggest meshes in the game.)
  const m = new THREE.MeshLambertMaterial({ map: materialTexture(id) });
  if (id === 17) { m.transparent = true; m.opacity = 0.8; }
  shade(m, id);
  mats.set(id, m);
  return m;
}

// Wind for foliage: leaves (merged into the world with a per-vertex "sway" weight, 0 at the trunk)
// drift in a slow, travelling breeze. One uniform shared by every leaf material.
export const WIND = { value: 0 };
const swaying = new WeakSet();
export function sway(m) {
  if (swaying.has(m)) return m;
  swaying.add(m);
  m.onBeforeCompile = sh => {
    sh.uniforms.uWind = WIND;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float sway; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 sw = (modelMatrix * vec4(transformed, 1.0)).xyz; float ph = sw.x * 0.35 + sw.z * 0.27;
        transformed += vec3(sin(uWind * 1.7 + ph), sin(uWind * 2.3 + ph * 1.7) * 0.3, cos(uWind * 1.3 + ph * 1.3)) * 0.045 * sway;`);
  };
  m.customProgramCacheKey = () => 'sway';
  return m;
}

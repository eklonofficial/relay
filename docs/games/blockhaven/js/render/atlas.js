// Builds hand-made mip chains for 16x16 texture layers.
// GL's generateMipmap averages alpha, which blurs cutouts and breaks the alpha-254 tint marker;
// here every level keeps cutout coverage, keeps the marker exact, and never bleeds in black.

export const TEX_SIZE = 16;
export const MIP_LEVELS = 5; // 16, 8, 4, 2, 1

function downsample(src, size, layers) {
  const half = size >> 1, out = new Uint8Array(half * half * 4 * layers);
  for (let l = 0; l < layers; l++) {
    const so = l * size * size * 4, doff = l * half * half * 4;
    for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
      let r = 0, g = 0, b = 0, n = 0, ar = 0, ag = 0, ab = 0, tint = 0, partial = 0, asum = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const k = so + ((y * 2 + j) * size + x * 2 + i) * 4, a = src[k + 3];
        ar += src[k]; ag += src[k + 1]; ab += src[k + 2]; asum += a;
        if (a >= 128) { r += src[k]; g += src[k + 1]; b += src[k + 2]; n++; if (a === 254) tint++; }
        if (a > 0 && a < 254) partial++;
      }
      const d = doff + (y * half + x) * 4;
      if (partial >= 2) { // translucent texture (stained glass): average everything
        out[d] = ar / 4; out[d + 1] = ag / 4; out[d + 2] = ab / 4; out[d + 3] = Math.min(253, asum / 4);
      } else if (n >= 2) {
        out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = tint * 2 >= n ? 254 : 255;
      } else {
        out[d] = ar / 4; out[d + 1] = ag / 4; out[d + 2] = ab / 4; out[d + 3] = 0;
      }
    }
  }
  return out;
}

// layers: array of Uint8ClampedArray(16*16*4). Returns [{ size, data }] from 16 down to 1.
export function buildMipChain(layers, size = TEX_SIZE, levels = MIP_LEVELS) {
  const base = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((d, i) => base.set(d, i * size * size * 4));
  const chain = [{ size, data: base }];
  for (let lv = 1; lv < levels && (size >> lv) >= 1; lv++) {
    const prev = chain[lv - 1];
    chain.push({ size: prev.size >> 1, data: downsample(prev.data, prev.size, layers.length) });
  }
  return chain;
}

// Uploads a chain as a TEXTURE_2D_ARRAY with crisp, stable filtering.
export function uploadArray(gl, chain, layerCount) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, chain.length, gl.RGBA8, chain[0].size, chain[0].size, layerCount);
  chain.forEach((lv, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, i, 0, 0, 0, lv.size, lv.size, layerCount, gl.RGBA, gl.UNSIGNED_BYTE, lv.data));
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, chain.length - 1);
  return tex;
}

// Replaces one layer of an uploaded array (all its mip levels): animated textures change frames
// this way, like Java's TextureAtlas uploading each animated sprite's current frame.
export function updateLayer(gl, tex, layer, pixels, size = TEX_SIZE, levels = MIP_LEVELS) {
  uploadLayerChain(gl, tex, layer, buildMipChain([pixels], size, levels));
}
// Same, from a mip chain built earlier (animation frames keep theirs).
export function uploadLayerChain(gl, tex, layer, chain) {
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  for (let i = 0; i < chain.length; i++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, i, 0, 0, layer, chain[i].size, chain[i].size, 1, gl.RGBA, gl.UNSIGNED_BYTE, chain[i].data);
}

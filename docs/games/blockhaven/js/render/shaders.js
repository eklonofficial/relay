import { VF } from '../data/blocks.js?v=mush3qz5';

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
`;
const FLAGS = Object.entries(VF).map(([k, v]) => `#define F_${k} ${v}`).join('\n') + '\n';

const NOISE = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = r * p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
`;

const SKY = `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
vec3 skyColor(vec3 d) {
  float h = d.y;
  vec3 c = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  if (h < 0.0) c = mix(uHorizon, uHorizon * 0.5, clamp(-h * 3.0, 0.0, 1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 5.0) * 0.28 + pow(sd, 48.0) * 0.45) * (1.0 - 0.5 * clamp(h, 0.0, 1.0));
  return c;
}
`;

const LIGHTING = `
vec3 applyLightS(vec3 col, vec2 light, float ao, float shade, float vis, float ndl);
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uSkyLight;
uniform vec3 uAmbient;
uniform vec3 uCamPos;
uniform float uMedium; // 0 air, 1 water, 2 lava, 3 powder snow
uniform float uFlicker;
uniform float uShadowStrength;

vec3 applyLight(vec3 col, vec2 light, float ao, float shade) {
  return applyLightS(col, light, ao, shade, 1.0, 0.0);
}


vec3 applyLightS(vec3 col, vec2 light, float ao, float shade, float vis, float ndl) {
  float sky = pow(0.8, 15.0 * (1.0 - light.x));
  float blk = pow(0.82, 15.0 * (1.0 - light.y));
  // Sun shadows darken the sky-light part only; lit faces get a little direct warmth.
  float sun = 1.0 - uShadowStrength * (1.0 - vis) + uShadowStrength * 0.45 * vis * ndl;
  vec3 L = max(uSkyLight * sky * sun, vec3(1.0, 0.76, 0.5) * blk * (1.12 + uFlicker * 0.06));
  L = max(L, uAmbient);
  return col * L * mix(0.4, 1.0, ao / 3.0) * shade;
}

vec3 applyFog(vec3 col, vec3 world) {
  float d = length(world - uCamPos);
  if (uMedium > 1.5 && uMedium < 2.5) return mix(col, vec3(0.6, 0.12, 0.0), 1.0 - exp(-d * 0.9));
  if (uMedium > 2.5) return mix(col, vec3(0.62, 0.74, 0.82), 1.0 - exp(-d * 0.7));
  if (uMedium > 0.5) {
    float f = 1.0 - exp(-d * 0.075);
    return mix(col, vec3(0.04, 0.14, 0.28) * (0.25 + 0.75 * uSkyLight.g), f);
  }
  float f = smoothstep(uFogNear, uFogFar, d);
  return mix(col, uFogColor, f * f * (3.0 - 2.0 * f));
}
`;

export const TERRAIN_VS = HEADER + FLAGS + `
layout(location = 0) in uvec4 aPos;
layout(location = 1) in uvec2 aTex;
layout(location = 2) in uvec4 aMisc;
layout(location = 3) in vec4 aTint;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uChunk;
uniform float uTime;
uniform float uWind;
uniform float uWaves;
out vec3 vUV;
out vec3 vWorld;
out float vShade;
out float vAO;
out vec2 vLight;
out vec3 vTint;
flat out int vFlags;
flat out int vNormal;

const float SHADE[7] = float[7](0.8, 0.8, 1.0, 0.55, 0.68, 0.68, 0.9);

void main() {
  vec3 p = (vec3(aPos.xyz) - 256.0) / 128.0 + uChunk;
  int flags = int(aPos.w);
  int uvn = int(aTex.y);
  float u = float(uvn & 31), v = float((uvn >> 5) & 31);
  int n = (uvn >> 10) & 7;
  float w = 1.0 + uWind * 1.6;
  if (flags == F_LEAVES) {
    p.x += sin(uTime * 1.7 + p.x * 0.9 + p.y * 0.4 + p.z * 0.6) * 0.03 * w;
    p.z += cos(uTime * 1.3 + p.x * 0.5 + p.z * 0.8) * 0.03 * w;
  } else if (flags == F_PLANT && v < 8.0) {
    p.x += sin(uTime * 2.1 + p.x * 0.8 + p.z * 0.7) * 0.06 * w;
    p.z += cos(uTime * 1.7 + p.z * 0.9 + p.x * 0.3) * 0.045 * w;
  } else if (flags == F_WATER_TOP && uWaves > 0.5) {
    p.y += (sin(uTime * 1.6 + p.x * 0.8 + p.z * 0.45) + sin(uTime * 1.1 - p.z * 0.9 + p.x * 0.3)) * 0.025 * w - 0.04;
  }
  vec4 world = uModel * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = uViewProj * world;
  vUV = vec3(u / 16.0, v / 16.0, float(aTex.x));
  // Flowing liquid tops: the flow texture turned to run along the current (LiquidBlockRenderer).
  int fl = int(aMisc.z);
  if (fl > 0) {
    float a = float(fl - 1) / 254.0 * 6.2831853, c = cos(a), sn = sin(a);
    vec2 q = vec2(u, v) / 8.0 - 1.0;
    vUV.xy = 0.5 + 0.25 * vec2(c * q.x + sn * q.y, c * q.y - sn * q.x);
  }
  vShade = SHADE[n];
  vAO = float(aMisc.x);
  int L = int(aMisc.y);
  vLight = vec2(float(L >> 4), float(L & 15)) / 15.0;
  vTint = aTint.rgb;
  vFlags = flags;
  vNormal = n;
}
`;

const SHADOW = `
uniform vec3 uSunDir;
uniform highp sampler2DShadow uShadowMap;
uniform mat4 uShadowMat;
uniform float uShadowOn;
uniform float uShadowTexel;
const vec3 FACE_N[7] = vec3[7](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1), vec3(0, 1, 0));
float shadowVis(vec3 world, vec3 N) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(world + N * 0.04, 1.0);
  vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  p.z -= 0.0006;
  float sum = 0.0;
  if (uShadowOn > 1.5) {
    for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) sum += texture(uShadowMap, vec3(p.xy + (vec2(x, y) - 1.5) * uShadowTexel * 1.2, p.z));
    sum /= 16.0;
  } else {
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) sum += texture(uShadowMap, vec3(p.xy + vec2(x, y) * uShadowTexel, p.z));
    sum /= 9.0;
  }
  float edge = smoothstep(0.0, 0.06, min(min(p.x, p.y), min(1.0 - p.x, 1.0 - p.y)));
  return mix(1.0, sum, edge);
}
`;

export const TERRAIN_FS = HEADER + FLAGS + NOISE + LIGHTING + SHADOW + `
uniform sampler2DArray uTex;
uniform float uTime;
uniform float uAlpha;
in vec3 vUV;
in vec3 vWorld;
in float vShade;
in float vAO;
in vec2 vLight;
in vec3 vTint;
flat in int vFlags;
flat in int vNormal;
out vec4 outColor;

void main() {
  // The mesher selects the pack's still/flowing lava layer. Keep lava emissive, but
  // use that texture rather than replacing both layers with procedural noise.
  if (vFlags == F_LAVA) {
    vec3 col = texture(uTex, vUV).rgb * 1.1;
    outColor = vec4(applyFog(col, vWorld), 1.0);
    return;
  }
  if (vFlags == F_END_PORTAL) {
    vec3 d = normalize(vWorld - uCamPos);
    vec3 col = vec3(0.02, 0.04, 0.06);
    for (int i = 0; i < 4; i++) {
      float s = 3.0 + float(i) * 2.5;
      vec2 q = d.xz / max(0.15, abs(d.y)) * s + vec2(uTime * 0.02 * float(i + 1), float(i) * 7.1);
      vec2 c = floor(q * 6.0);
      float h = hash12(c + float(i) * 13.0);
      if (h > 0.93) col += vec3(0.15 + h * 0.2, 0.45 + 0.3 * sin(h * 40.0), 0.5 + 0.2 * cos(h * 20.0)) * (0.5 + 0.5 * sin(uTime * 2.0 + h * 60.0));
    }
    outColor = vec4(col, 1.0);
    return;
  }
  if (vFlags == F_FIRE) {
    // Animated flames: pixel-snapped noise rising over time, yellow core to red tips.
    vec2 q = floor(clamp(vUV.xy, 0.0, 0.999) * 16.0) / 16.0;
    float hgt = 1.0 - q.y;
    float seed = dot(floor(vWorld.xz + 0.001), vec2(3.1, 7.7));
    float n = fbm(vec2(q.x * 3.2 + seed, hgt * 2.4 - uTime * 2.8));
    float edge = 1.0 - abs(q.x - 0.47) * 1.25;
    float top = (0.3 + 0.8 * n) * edge;
    if (hgt > top) discard;
    float k = hgt / max(top, 0.01);
    vec4 base = texture(uTex, vec3(0.5, 0.95, vUV.z));
    vec3 c = base.b > base.r
      ? mix(vec3(0.8, 1.0, 1.0), vec3(0.1, 0.55, 0.95), k)
      : (k < 0.35 ? mix(vec3(1.0, 0.96, 0.62), vec3(1.0, 0.72, 0.18), k / 0.35) : mix(vec3(1.0, 0.72, 0.18), vec3(0.85, 0.2, 0.04), (k - 0.35) / 0.65));
    outColor = vec4(applyFog(c * 1.15, vWorld), 1.0);
    return;
  }
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.5) discard;
  vec3 col = t.rgb;
  if (t.a < 0.998) col *= vTint;
  if (vFlags == F_EMISSIVE || vFlags == F_FIRE) col = col * 1.1;
  else {
    vec3 N = FACE_N[vNormal];
    float ndl = vNormal == 6 ? 0.6 : dot(N, uSunDir);
    float vis = uShadowOn > 0.5 ? (ndl <= 0.0 ? 0.0 : shadowVis(vWorld, N)) : 1.0;
    col = applyLightS(col, vLight, vAO, vShade, vis, max(ndl, 0.0));
  }
  outColor = vec4(applyFog(col, vWorld), uAlpha);
}
`;

export const LIQUID_FS = HEADER + FLAGS + NOISE + SKY + LIGHTING + `
uniform sampler2DArray uTex;
uniform float uTime;
uniform float uSSR;
uniform float uPlainWater;
uniform sampler2D uOpaque;
uniform sampler2D uOpaqueDepth;
uniform mat4 uViewProj;
uniform vec2 uNearFar;
uniform vec2 uScreen;
float linDepth(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x)); }
// Screen-space reflection: march the reflected ray with geometrically growing steps (so a
// handful of steps reach hills far across a lake), then binary-search the hit for a sharp image.
vec2 ssrProject(vec3 q, out float rd, out float ok) {
  vec4 c = uViewProj * vec4(q, 1.0);
  ok = c.w > 0.0 ? 1.0 : 0.0;
  vec3 ndc = c.xyz / max(c.w, 1e-4);
  rd = linDepth(ndc.z * 0.5 + 0.5);
  return ndc.xy * 0.5 + 0.5;
}
vec3 traceSSR(vec3 P, vec3 R, out float hit) {
  hit = 0.0;
  float grow = uSSR < 30.0 ? 1.34 : uSSR < 50.0 ? 1.22 : 1.14;
  float t = 0.5, prev = 0.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= uSSR) break;
    float rd, ok;
    vec2 uv = ssrProject(P + R * t, rd, ok);
    if (ok < 0.5 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sd = texture(uOpaqueDepth, uv).r;
    float sdl = linDepth(sd);
    if (sd < 0.99999 && rd > sdl && rd - sdl < max(1.5, (t - prev) * 1.5)) {
      float a = prev, b = t;
      for (int k = 0; k < 5; k++) {
        float m = (a + b) * 0.5, rm, okm;
        vec2 um = ssrProject(P + R * m, rm, okm);
        if (rm > linDepth(texture(uOpaqueDepth, um).r)) b = m; else a = m;
      }
      float rb, okb;
      uv = ssrProject(P + R * b, rb, okb);
      vec2 e = abs(uv - 0.5) * 2.0;
      hit = (1.0 - smoothstep(0.8, 1.0, max(e.x, e.y))) * (1.0 - smoothstep(0.7, 1.0, float(i) / uSSR));
      return texture(uOpaque, uv).rgb;
    }
    prev = t;
    t = t * grow + 0.35;
  }
  return vec3(0.0);
}
in vec3 vUV;
in vec3 vWorld;
in float vShade;
in float vAO;
in vec2 vLight;
in vec3 vTint;
flat in int vFlags;
flat in int vNormal;
out vec4 outColor;

uniform float uClouds;
uniform float uRain;
// The sky as the water reflects it, with the near cloud layer (same pattern as the sky's own).
vec3 reflectSky(vec3 P, vec3 R) {
  vec3 c = skyColor(R);
  if (uClouds > 0.5 && R.y > 0.02) {
    float t = (260.0 - P.y) / R.y;
    if (t > 0.0) {
      vec2 q = (P.xz + R.xz * t) * 0.006 + vec2(uTime * 0.006, uTime * 0.0025);
      float cover = smoothstep(0.48 - uRain * 0.3, 0.78 - uRain * 0.3, fbm(q));
      vec3 cc = vec3(0.92, 0.94, 1.0) * clamp(uSkyLight * 1.1, vec3(0.06), vec3(1.0)) + uSunColor * 0.12;
      c = mix(c, cc, cover * exp(-t * 0.0008) * smoothstep(0.02, 0.18, R.y) * 0.9);
    }
  }
  return c;
}
// Slope of the water surface: four directional wave trains plus fine noise, the detail fading
// with distance so far water settles into a clean mirror instead of glittering noise.
vec2 waterSlope(vec2 p, float dist) {
  vec2 g = vec2(0.0);
  const vec4 W[4] = vec4[4](vec4(0.96, 0.28, 0.95, 0.040), vec4(-0.55, 0.83, 1.70, 0.024), vec4(0.24, -0.97, 3.10, 0.013), vec4(0.80, 0.60, 5.30, 0.007));
  const float SP[4] = float[4](1.25, 1.6, 2.3, 3.1);
  for (int i = 0; i < 4; i++) {
    vec2 d = W[i].xy; float f = W[i].z;
    g += d * f * W[i].w * cos(dot(d, p) * f + uTime * SP[i]);
  }
  // Choppy detail: two noise octaves drifting against each other.
  float e = 0.05;
  vec2 q = p * 2.6 + vec2(uTime * 0.35, -uTime * 0.27);
  float n0 = vnoise(q);
  g += vec2(vnoise(q + vec2(e, 0.0)) - n0, vnoise(q + vec2(0.0, e)) - n0) / e * 0.03;
  vec2 q2 = mat2(0.8, -0.6, 0.6, 0.8) * p * 6.3 - vec2(uTime * 0.6, uTime * 0.45);
  float m0 = vnoise(q2);
  g += vec2(vnoise(q2 + vec2(e, 0.0)) - m0, vnoise(q2 + vec2(0.0, e)) - m0) / e * 0.012 / (1.0 + dist * 0.04);
  return g / (1.0 + dist * 0.012);
}
const vec3 NORMALS[7] = vec3[7](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1), vec3(0, 1, 0));

void main() {
  if (vFlags == F_PORTAL) {
    vec3 p = floor(vWorld * 16.0) / 16.0;
    vec2 q = (vNormal < 2 ? p.zy : p.xy) * 1.4;
    float a = atan(q.y - floor(q.y) - 0.5, q.x - floor(q.x) - 0.5);
    float n = fbm(q * 1.5 + vec2(sin(uTime * 0.7 + a), cos(uTime * 0.6)) * 0.8 + uTime * 0.15);
    vec3 col = mix(vec3(0.3, 0.05, 0.6), vec3(0.8, 0.45, 1.0), smoothstep(0.35, 0.8, n));
    outColor = vec4(applyFog(col, vWorld), 0.78);
    return;
  }
  vec4 t = texture(uTex, vUV);
  if (vFlags == F_ICE || vFlags == F_GLASS) {
    if (t.a < 0.02) discard;
    vec3 col = applyLight(t.rgb, vLight, vAO, vShade);
    outColor = vec4(applyFog(col, vWorld), vFlags == F_ICE ? 0.82 : t.a);
    return;
  }
  vec3 N = NORMALS[vNormal];
  // The lowest preset draws Java's water: the animated texture, tinted, at its own alpha (180/255).
  if (uPlainWater > 0.5 && (vFlags == F_WATER_TOP || vFlags == F_WATER)) {
    vec3 col = applyLight(t.rgb * vTint, vLight, vAO, vShade);
    outColor = vec4(applyFog(col, vWorld), t.a < 0.996 ? t.a : 0.706);
    return;
  }
  if (vFlags != F_WATER_TOP && vFlags != F_WATER) {
    // Other translucent liquids keep the plain lit texture.
    vec3 col = applyLight(t.rgb * vTint, vLight, vAO, vShade);
    outColor = vec4(applyFog(col, vWorld), t.a);
    return;
  }
  vec3 V = normalize(uCamPos - vWorld);
  float dist = length(uCamPos - vWorld);
  if (vFlags == F_WATER_TOP) {
    vec2 sl = waterSlope(vWorld.xz, dist);
    N = normalize(vec3(-sl.x, 1.0, -sl.y));
  }
  float skyVis = pow(0.8, 15.0 * (1.0 - vLight.x));
  // The water body: deep, tinted and only lightly lit, so the surface reads as clear, not milky.
  vec3 body = applyLight(vTint * vec3(0.24, 0.36, 0.44) + vec3(0.01, 0.025, 0.04), vLight, 3.0, vShade);
  // Schlick Fresnel for water (F0 = 0.02): see-through looking down, a mirror at grazing angles.
  float cosT = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  if (uMedium > 0.5) fres = 0.0; // from below, the surface shows the world above (no sky mirror)
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = reflectSky(vWorld, R) * mix(0.15, 1.0, skyVis);
  float bodyOpacity = uMedium > 0.5 ? 0.45 : 0.5;
  vec3 under = vec3(0.0);
  bool refr = false;
  if (uSSR > 0.5 && vFlags == F_WATER_TOP && uMedium < 0.5) {
    float hit;
    // Reflect off a calmer normal: full-strength ripples scatter the ray into the shore and bed.
    vec3 Nr = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.35));
    vec3 Rr = reflect(-V, Nr); Rr.y = max(Rr.y, 0.02);
    vec3 sr = traceSSR(vWorld + vec3(0.0, 0.05, 0.0), Rr, hit);
    refl = mix(refl, sr, hit);
    // Refraction: see the bottom through the water, bent by the waves and fading with depth.
    vec2 suv = gl_FragCoord.xy / uScreen + N.xz * 0.025;
    float depthBelow = linDepth(texture(uOpaqueDepth, suv).r) - dist;
    if (depthBelow < 0.0) { suv = gl_FragCoord.xy / uScreen; depthBelow = linDepth(texture(uOpaqueDepth, suv).r) - dist; }
    vec3 bed = texture(uOpaque, suv).rgb;
    // Sunlit caustics dancing on the bed, strongest in the shallows.
    vec3 bp = vWorld - V * max(depthBelow, 0.0);
    vec2 cq = bp.xz * 1.1 + bp.y * 0.3;
    float ca = 1.0 - abs(vnoise(cq + vec2(uTime * 0.5, uTime * 0.3)) - vnoise(cq * 1.3 - vec2(uTime * 0.4, -uTime * 0.35) + 3.1));
    ca = pow(ca, 9.0) * smoothstep(0.0, 0.6, depthBelow) * exp(-max(depthBelow, 0.0) * 0.25);
    bed = bed * vec3(0.78, 1.0, 0.96) + uSunColor * ca * 0.45 * skyVis * max(uSunDir.y, 0.0);
    vec3 absorb = exp(-max(depthBelow, 0.0) * vec3(0.45, 0.16, 0.11));
    under = mix(body, bed, absorb);
    refr = true;
  }
  // Sun glints: a sharp sparkle on the ripples plus a broad sheen.
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  vec3 spec = uSunColor * (pow(nh, 900.0) * 9.0 + pow(nh, 90.0) * 0.18) * skyVis * step(0.0, uSunDir.y + 0.05);
  vec3 col; float alpha;
  if (refr) {
    col = mix(under, refl, fres) + spec;
    alpha = 1.0;
  } else {
    // Blended over the scene: result = refl*F + (1-F)*(body*k + scene*(1-k)).
    float k = vFlags == F_WATER ? 0.62 : bodyOpacity;
    alpha = fres + (1.0 - fres) * k;
    col = (refl * fres + body * (1.0 - fres) * k) / max(alpha, 1e-3) + spec / max(alpha, 1e-3);
    alpha = clamp(alpha + dot(spec, vec3(0.33)), 0.0, 1.0);
  }
  outColor = vec4(applyFog(col, vWorld), alpha);
}
`;

export const SKY_VS = HEADER + `
out vec2 vNdc;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}
`;

export const SKY_FS = HEADER + NOISE + SKY + `
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uNight;
uniform float uClouds;
uniform float uRain;
uniform int uDim;
uniform vec3 uFogColor;
in vec2 vNdc;
out vec4 outColor;

float squareDisc(vec3 dir, vec3 center, float size) {
  vec3 right = normalize(cross(center, vec3(0.0, 0.0, 1.0)));
  vec3 up = cross(right, center);
  float d = dot(dir, center);
  if (d <= 0.0) return 0.0;
  vec2 q = vec2(dot(dir, right), dot(dir, up)) / d;
  return 1.0 - smoothstep(size * 0.92, size, max(abs(q.x), abs(q.y)));
}

void main() {
  vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w - uCamPos);
  if (uDim == 1) {
    float n = fbm(dir.xz / (abs(dir.y) + 0.4) * 2.0 + uTime * 0.01);
    outColor = vec4(uFogColor * (0.75 + 0.5 * n), 1.0);
    return;
  }
  if (uDim == 2) {
    vec2 q = dir.xz / (abs(dir.y) + 0.35) * 6.0;
    float n = fbm(q * 0.6) * 0.5 + vnoise(q * 4.0) * 0.15;
    vec3 col = mix(vec3(0.05, 0.02, 0.08), vec3(0.2, 0.12, 0.26), n);
    vec3 cell = floor(dir * 180.0);
    if (hash13(cell) > 0.997) col += vec3(0.7, 0.6, 0.9);
    outColor = vec4(col, 1.0);
    return;
  }
  vec3 col = skyColor(dir);
  float clear = 1.0 - uRain * 0.85;
  if (uNight > 0.01 && dir.y > -0.05) {
    vec3 sd = dir * 260.0;
    vec3 cell = floor(sd);
    float h = hash13(cell);
    if (h > 0.9965) {
      vec3 f = fract(sd) - 0.5;
      float star = smoothstep(0.35, 0.0, length(f));
      float tw = 0.55 + 0.45 * sin(uTime * (2.0 + h * 5.0) + h * 80.0);
      col += vec3(0.85, 0.9, 1.0) * star * tw * uNight * smoothstep(-0.05, 0.25, dir.y) * clear;
    }
  }
  float sun = squareDisc(dir, uSunDir, 0.055);
  col += uSunColor * sun * 5.0 * clear;
  float moon = squareDisc(dir, -uSunDir, 0.04);
  vec3 md = dir * 30.0;
  float craters = 0.75 + 0.25 * vnoise(vec2(dot(md, vec3(1, 0, 0)), dot(md, vec3(0, 1, 0))) * 3.0);
  col += vec3(0.8, 0.85, 1.0) * moon * craters * (0.3 + uNight * 1.2) * clear;
  col += vec3(0.25, 0.3, 0.45) * pow(max(dot(dir, -uSunDir), 0.0), 60.0) * uNight * clear;
  if (uClouds > 0.5 && dir.y > 0.02) {
    for (int layer = 0; layer < 2; layer++) {
      float height = layer == 0 ? 260.0 : 320.0;
      float t = (height - uCamPos.y) / dir.y;
      if (t <= 0.0) continue;
      vec2 q = (uCamPos.xz + dir.xz * t) * (layer == 0 ? 0.006 : 0.0035) + vec2(uTime * 0.006, uTime * 0.0025) * (layer == 0 ? 1.0 : 0.6);
      float c = fbm(q);
      float cover = smoothstep(0.48 - uRain * 0.3, 0.78 - uRain * 0.3, c) * (layer == 0 ? 1.0 : 0.6);
      float light = smoothstep(0.4, 0.95, fbm(q + vec2(0.04, 0.03)));
      vec3 day = mix(vec3(1.0), vec3(0.78, 0.82, 0.9), light * 0.6) * (1.0 - uRain * 0.45);
      vec3 cloudCol = mix(vec3(0.08, 0.09, 0.14), day, 1.0 - uNight) + uSunColor * 0.25 * (1.0 - light) * clear;
      float fade = exp(-t * 0.0008) * smoothstep(0.02, 0.18, dir.y);
      col = mix(col, cloudCol, cover * fade * 0.92);
    }
  }
  col = mix(col, uFogColor, uRain * 0.55);
  outColor = vec4(col, 1.0);
}
`;

// Entities, dropped items, particles and weather: float vertices with baked light.
export const ENTITY_VS = HEADER + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aUV;
layout(location = 2) in vec4 aColor;
uniform mat4 uViewProj;
out vec3 vUV;
out vec3 vWorld;
out vec4 vColor;
void main() {
  vUV = aUV; vWorld = aPos; vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const ENTITY_FS = HEADER + LIGHTING + `
uniform sampler2DArray uTex;
uniform float uAlphaTest;
uniform float uTime;
in vec3 vUV;
in vec3 vWorld;
in vec4 vColor;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUV);
  if (t.a < uAlphaTest) discard;
  vec3 col = t.rgb * vColor.rgb;
  // Vertex alpha above 2 marks an enchanted item: a violet sheen drifting across it.
  float glint = vColor.a >= 2.0 ? 1.0 : 0.0;
  float va = vColor.a - glint * 2.0;
  float hurt = clamp(va - 1.0, 0.0, 1.0);
  col = mix(col, vec3(0.9, 0.1, 0.05), hurt * 0.55);
  float band = fract((vUV.x * 0.7 + vUV.y * 0.35) * 1.3 - uTime * 0.35);
  float band2 = fract((vUV.x * -0.4 + vUV.y * 0.8) * 1.1 - uTime * 0.22);
  float sheen = smoothstep(0.0, 0.15, band) * smoothstep(0.35, 0.15, band) + 0.6 * smoothstep(0.0, 0.1, band2) * smoothstep(0.25, 0.1, band2);
  col += vec3(0.42, 0.18, 0.75) * glint * (0.1 + sheen * 0.5);
  float alpha = min(va, 1.0) * (t.a < 0.998 && t.a > 0.99 ? 1.0 : t.a);
  outColor = vec4(applyFog(col, vWorld), alpha);
}
`;

export const LINE_VS = HEADER + `
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
void main() { gl_Position = uViewProj * vec4(aPos, 1.0); }
`;
export const LINE_FS = HEADER + `
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }
`;

export const POST_VS = HEADER + `
out vec2 vUV;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
export const SHADOW_FS = HEADER + `
uniform sampler2DArray uTex;
in vec3 vUV;
flat in int vFlags;
out vec4 outColor;
void main() { if (texture(uTex, vUV).a < 0.5) discard; outColor = vec4(1.0); }
`;

export const BLOOM_FS = HEADER + `
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform int uMode;
in vec2 vUV;
out vec4 outColor;
void main() {
  if (uMode == 0) {
    vec3 c = vec3(0.0);
    for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) c += texture(uSrc, vUV + (vec2(x, y) - 0.5) * uTexel).rgb;
    c *= 0.25;
    // Soft-knee threshold: only genuinely bright things (sun, lava, torches, glowstone) glow;
    // bright-but-ordinary surfaces like daytime sky and snow stay crisp.
    float l = dot(c, vec3(0.299, 0.587, 0.114)) * 0.6 + max(c.r, max(c.g, c.b)) * 0.4;
    float k = clamp((l - 0.78) / 0.22, 0.0, 1.0);
    outColor = vec4(c * k * k, 1.0);
    return;
  }
  vec2 d = uMode == 1 ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  const float W[5] = float[5](0.227, 0.194, 0.122, 0.054, 0.016);
  vec3 c = texture(uSrc, vUV).rgb * W[0];
  for (int i = 1; i < 5; i++) c += (texture(uSrc, vUV + d * float(i) * 1.5).rgb + texture(uSrc, vUV - d * float(i) * 1.5).rgb) * W[i];
  outColor = vec4(c, 1.0);
}
`;

// God rays at quarter resolution (light scattering, after GPU Gems 3 ch. 13): bright open sky
// near the sun is smeared outward from the sun's screen position, so clouds, trees and terrain in
// front of it cut visible shafts. A per-pixel jittered start and two blur passes keep it smooth.
export const GOD_FS = HEADER + `
uniform sampler2D uDepth;
uniform sampler2D uScene;
uniform vec3 uSun;
uniform vec2 uAspect;
uniform float uSamples;
uniform float uTime;
in vec2 vUV;
out vec4 outColor;
float lightAt(vec2 p) {
  if (texture(uDepth, p).r < 0.99999) return 0.0;
  vec3 c = texture(uScene, p).rgb;
  float l = dot(c, vec3(0.3, 0.55, 0.15));
  // Only the brightest sky (the sun, its glow, sunlit cloud edges) emits; dimmer cloud cores block.
  float d = length((p - uSun.xy) * uAspect);
  return smoothstep(0.55, 1.0, l) * (exp(-d * 6.0) + 0.25 * exp(-d * 1.8));
}
void main() {
  vec2 toSun = uSun.xy - vUV;
  float dist = length(toSun * uAspect);
  float fall = pow(max(0.0, 1.0 - dist * 0.75), 1.6);
  if (fall <= 0.0) { outColor = vec4(0.0); return; }
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  // March towards the sun, at most 85% of the way across the screen.
  vec2 d = toSun * min(1.0, 0.85 / max(dist, 1e-4)) / uSamples;
  vec2 p = vUV + d * jit;
  float illum = 0.0, decay = 1.0, wsum = 0.0;
  for (int i = 0; i < 64; i++) {
    if (float(i) >= uSamples) break;
    illum += lightAt(clamp(p, 0.001, 0.999)) * decay; wsum += decay;
    decay *= 0.985;
    p += d;
  }
  // Crepuscular streaks: slowly drifting radial bands around the sun (integer frequencies, so
  // they wrap seamlessly), on top of the real shafts cut by whatever blocks the light.
  float a = atan(toSun.y, toSun.x * uAspect.x);
  float band = sin(a * 7.0 + 1.3 + uTime * 0.03) * 0.45 + sin(a * 13.0 - uTime * 0.05) * 0.35 + sin(a * 29.0 + 2.1 + uTime * 0.02) * 0.2;
  float streak = mix(1.0, 0.25 + 1.1 * smoothstep(-0.35, 0.75, band), smoothstep(0.02, 0.2, dist));
  outColor = vec4(illum / wsum * fall * streak, 0.0, 0.0, 1.0);
}
`;

export const POST_FS = HEADER + `
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uBloom;
uniform sampler2D uGod;
uniform int uQuality;
uniform vec2 uTexel;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uBloomStrength;
uniform float uMedium;
uniform float uTime;
uniform float uFlash;
uniform float uHurt;
uniform float uPortal;
uniform float uDark;
uniform float uSaturation;
in vec2 vUV;
out vec4 outColor;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
// Compact FXAA: smooths edges for a fraction of MSAA's cost.
vec3 fxaa(vec2 uv) {
  vec3 m = texture(uScene, uv).rgb;
  float lM = luma(m);
  float lN = luma(texture(uScene, uv + vec2(0.0, uTexel.y)).rgb), lS = luma(texture(uScene, uv - vec2(0.0, uTexel.y)).rgb);
  float lE = luma(texture(uScene, uv + vec2(uTexel.x, 0.0)).rgb), lW = luma(texture(uScene, uv - vec2(uTexel.x, 0.0)).rgb);
  float lo = min(lM, min(min(lN, lS), min(lE, lW))), hi = max(lM, max(max(lN, lS), max(lE, lW)));
  if (hi - lo < max(0.04, hi * 0.12)) return m;
  vec2 dir = vec2(-((lN + lS) - (lE + lW)) * 0.5, (lN + lS) * 0.0 + (lE + lW) * 0.0 + ((lN - lS)) * 0.0);
  dir = vec2((lS - lN), (lE - lW));
  float scale = 1.0 / (min(abs(dir.x), abs(dir.y)) + 0.03);
  dir = clamp(dir * scale, -4.0, 4.0) * uTexel;
  vec3 a = 0.5 * (texture(uScene, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uScene, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(uScene, uv - dir * 0.5).rgb + texture(uScene, uv + dir * 0.5).rgb);
  float lb = luma(b);
  return (lb < lo || lb > hi) ? a : b;
}

void main() {
  vec2 uv = vUV;
  if (uMedium > 0.5 && uMedium < 1.5) uv += vec2(sin(uv.y * 22.0 + uTime * 2.2), cos(uv.x * 17.0 + uTime * 1.8)) * 0.0035;
  if (uPortal > 0.0) {
    vec2 c = uv - 0.5;
    float a = uPortal * 0.6 * sin(uTime * 1.3);
    uv = 0.5 + mat2(cos(a), -sin(a), sin(a), cos(a)) * c * (1.0 - uPortal * 0.08);
  }
  vec3 c = uQuality >= 1 ? fxaa(uv) : texture(uScene, uv).rgb;
  if (uQuality == 0) { outColor = vec4(c * (1.0 - uDark) + uFlash, 1.0); return; }
  // God rays (traced at quarter resolution in GOD_FS), warm with the sun's colour.
  if (uSun.z > 0.001) {
    float g = texture(uGod, uv).r;
    c += uSunColor * g * uSun.z * 2.6 * (1.0 - 0.35 * luma(c));
  }
  if (uQuality >= 2) c += texture(uBloom, uv).rgb * uBloomStrength;
  if (uMedium > 0.5 && uMedium < 1.5) c = mix(c, c * vec3(0.4, 0.62, 1.0), 0.55);
  float l = luma(c);
  c = mix(vec3(l), c, uSaturation * (uQuality >= 2 ? 1.03 : 1.0));
  c = (c - 0.5) * 1.05 + 0.5;
  // Soft shoulder so bloom and rays roll off instead of clipping.
  if (uQuality >= 2) c = mix(c, 0.82 + (1.0 - exp(-(c - 0.82) * 5.5)) * 0.18, step(0.82, c));
  if (uPortal > 0.0) c = mix(c, vec3(0.55, 0.2, 0.8), uPortal * 0.45);
  c += uFlash;
  vec2 dd = vUV - 0.5;
  c *= mix(0.68, 1.0, smoothstep(0.85, 0.25, length(dd) * 1.15));
  c = mix(c, vec3(0.7, 0.0, 0.0), uHurt * smoothstep(0.2, 0.75, length(dd)) * 0.8);
  c *= 1.0 - uDark;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

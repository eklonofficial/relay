import { VF } from '../data/blocks.js';

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
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uSkyLight;
uniform vec3 uAmbient;
uniform vec3 uCamPos;
uniform float uMedium; // 0 air, 1 water, 2 lava, 3 powder snow
uniform float uFlicker;

vec3 applyLight(vec3 col, vec2 light, float ao, float shade) {
  float sky = pow(0.8, 15.0 * (1.0 - light.x));
  float blk = pow(0.82, 15.0 * (1.0 - light.y));
  vec3 L = max(uSkyLight * sky, vec3(1.0, 0.76, 0.5) * blk * (1.12 + uFlicker * 0.06));
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
  vec3 p = (vec3(aPos.xyz) - 64.0) / 32.0 + uChunk;
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
  } else if (flags == F_WATER_TOP) {
    p.y += (sin(uTime * 1.6 + p.x * 0.8 + p.z * 0.45) + sin(uTime * 1.1 - p.z * 0.9 + p.x * 0.3)) * 0.025 * w - 0.04;
  }
  vec4 world = uModel * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = uViewProj * world;
  vUV = vec3(u / 16.0, v / 16.0, float(aTex.x));
  vShade = SHADE[n];
  vAO = float(aMisc.x);
  int L = int(aMisc.y);
  vLight = vec2(float(L >> 4), float(L & 15)) / 15.0;
  vTint = aTint.rgb;
  vFlags = flags;
  vNormal = n;
}
`;

export const TERRAIN_FS = HEADER + FLAGS + NOISE + LIGHTING + `
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

vec3 lava(vec3 w) {
  vec3 px = floor(w * 16.0 + 0.001) / 16.0;
  vec2 q = px.xz * 0.55 + vec2(px.y * 0.35, -px.y * 0.2);
  float n = fbm(q + vec2(uTime * 0.07, uTime * 0.045));
  float n2 = fbm(q * 2.2 - vec2(uTime * 0.11, uTime * 0.02));
  vec3 col = mix(vec3(0.5, 0.06, 0.01), vec3(1.0, 0.42, 0.04), smoothstep(0.25, 0.75, n));
  return mix(col, vec3(1.0, 0.88, 0.38), smoothstep(0.62, 0.9, n2) * 0.85) * 1.15;
}

void main() {
  if (vFlags == F_LAVA) { outColor = vec4(applyFog(lava(vWorld), vWorld), 1.0); return; }
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
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.5) discard;
  vec3 col = t.rgb;
  if (t.a < 0.998) col *= vTint;
  if (vFlags == F_EMISSIVE || vFlags == F_FIRE) col = col * 1.1;
  else col = applyLight(col, vLight, vAO, vShade);
  outColor = vec4(applyFog(col, vWorld), uAlpha);
}
`;

export const LIQUID_FS = HEADER + FLAGS + NOISE + SKY + LIGHTING + `
uniform sampler2DArray uTex;
uniform float uTime;
in vec3 vUV;
in vec3 vWorld;
in float vShade;
in float vAO;
in vec2 vLight;
in vec3 vTint;
flat in int vFlags;
flat in int vNormal;
out vec4 outColor;

float waterHeight(vec2 p) {
  return sin(p.x * 1.7 + uTime * 1.8) * 0.035 + sin(p.y * 2.3 - uTime * 1.3) * 0.03
       + sin((p.x + p.y) * 3.1 + uTime * 2.4) * 0.015 + (vnoise(p * 1.6 + uTime * 0.45) - 0.5) * 0.07;
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
  if (vFlags == F_WATER_TOP) {
    vec2 p = vWorld.xz;
    float e = 0.08;
    float h0 = waterHeight(p);
    N = normalize(vec3((h0 - waterHeight(p + vec2(e, 0.0))) / e, 1.0, (h0 - waterHeight(p + vec2(0.0, e))) / e));
  }
  vec3 V = normalize(uCamPos - vWorld);
  float cosT = abs(dot(N, V));
  float fres = 0.03 + 0.97 * pow(1.0 - cosT, 5.0);
  float skyVis = pow(0.8, 15.0 * (1.0 - vLight.x));
  vec3 base = applyLight(t.rgb * vTint * 1.25, vLight, 3.0, vShade);
  vec3 refl = skyColor(reflect(-V, N)) * mix(0.2, 1.0, skyVis);
  vec3 col = mix(base, refl * vec3(0.8, 0.9, 1.0), clamp(fres, 0.0, 0.6));
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 240.0) * 3.0 * skyVis;
  float alpha = uMedium > 0.5 ? 0.55 : mix(0.66, 0.94, fres);
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
in vec3 vUV;
in vec3 vWorld;
in vec4 vColor;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUV);
  if (t.a < uAlphaTest) discard;
  vec3 col = t.rgb * vColor.rgb;
  float hurt = clamp(vColor.a - 1.0, 0.0, 1.0);
  col = mix(col, vec3(0.9, 0.1, 0.05), hurt * 0.55);
  float alpha = min(vColor.a, 1.0) * (t.a < 0.998 && t.a > 0.99 ? 1.0 : t.a);
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
export const POST_FS = HEADER + `
uniform sampler2D uScene;
uniform float uMedium;
uniform float uTime;
uniform float uFlash;
uniform float uHurt;
uniform float uPortal;
uniform float uDark;
uniform float uSaturation;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec2 uv = vUV;
  if (uMedium > 0.5 && uMedium < 1.5) uv += vec2(sin(uv.y * 22.0 + uTime * 2.2), cos(uv.x * 17.0 + uTime * 1.8)) * 0.0035;
  if (uPortal > 0.0) {
    vec2 c = uv - 0.5;
    float a = uPortal * 0.6 * sin(uTime * 1.3);
    uv = 0.5 + mat2(cos(a), -sin(a), sin(a), cos(a)) * c * (1.0 - uPortal * 0.08);
  }
  vec3 c = texture(uScene, uv).rgb;
  if (uMedium > 0.5 && uMedium < 1.5) c = mix(c, c * vec3(0.4, 0.62, 1.0), 0.55);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSaturation);
  c = (c - 0.5) * 1.05 + 0.5;
  if (uPortal > 0.0) c = mix(c, vec3(0.55, 0.2, 0.8), uPortal * 0.45);
  c += uFlash;
  vec2 d = vUV - 0.5;
  float vig = mix(0.68, 1.0, smoothstep(0.85, 0.25, length(d) * 1.15));
  c *= vig;
  c = mix(c, vec3(0.7, 0.0, 0.0), uHurt * smoothstep(0.2, 0.75, length(d)) * 0.8);
  c *= 1.0 - uDark;
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
`;

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
uniform vec3 uCamPos;
uniform float uUnderwater;

vec3 applyLight(vec3 col, vec2 light, float ao, float shade) {
  float sky = pow(0.8, 15.0 * (1.0 - light.x));
  float blk = pow(0.82, 15.0 * (1.0 - light.y));
  vec3 L = max(uSkyLight * sky, vec3(1.0, 0.74, 0.46) * blk * 1.15);
  L = max(L, vec3(0.035, 0.04, 0.055));
  return col * L * mix(0.38, 1.0, ao / 3.0) * shade;
}

vec3 applyFog(vec3 col, vec3 world) {
  float d = length(world - uCamPos);
  if (uUnderwater > 0.5) {
    float f = 1.0 - exp(-d * 0.085);
    return mix(col, vec3(0.04, 0.14, 0.28) * (0.25 + 0.75 * uSkyLight.g), f);
  }
  float f = smoothstep(uFogNear, uFogFar, d);
  return mix(col, uFogColor, f * f * (3.0 - 2.0 * f));
}
`;

export const TERRAIN_VS = HEADER + `
layout(location = 0) in vec4 aPos;
layout(location = 1) in vec4 aData;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uChunk;
uniform float uTime;
out vec3 vUV;
out vec3 vWorld;
out vec3 vNormal;
out float vShade;
out float vAO;
out vec2 vLight;
flat out int vFlags;

const vec3 NORMALS[7] = vec3[7](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1), vec3(0, 1, 0));
const float SHADE[7] = float[7](0.8, 0.8, 1.0, 0.55, 0.68, 0.68, 0.92);
const vec2 UVS[4] = vec2[4](vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1));

void main() {
  vec3 p = aPos.xyz / 16.0 + uChunk;
  int flags = int(aPos.w + 0.5);
  int packed = int(aData.y + 0.5);
  int n = packed & 7;
  vec2 uv = UVS[(packed >> 3) & 3];
  if (flags == 1) {
    p.x += sin(uTime * 1.7 + p.x * 0.9 + p.y * 0.4 + p.z * 0.6) * 0.035;
    p.z += cos(uTime * 1.3 + p.x * 0.5 + p.z * 0.8) * 0.035;
  } else if (flags == 2 && uv.y < 0.5) {
    p.x += sin(uTime * 2.1 + p.x * 0.8 + p.z * 0.7) * 0.07;
    p.z += cos(uTime * 1.7 + p.z * 0.9 + p.x * 0.3) * 0.05;
  } else if (flags == 3) {
    p.y += (sin(uTime * 1.6 + p.x * 0.8 + p.z * 0.45) + sin(uTime * 1.1 - p.z * 0.9 + p.x * 0.3)) * 0.03 - 0.06;
  }
  vec4 world = uModel * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = uViewProj * world;
  vUV = vec3(uv, aData.x);
  vNormal = NORMALS[n];
  vShade = SHADE[n];
  vAO = aData.z;
  int L = int(aData.w + 0.5);
  vLight = vec2(float(L >> 4), float(L & 15)) / 15.0;
  vFlags = flags;
}
`;

export const TERRAIN_FS = HEADER + LIGHTING + `
uniform sampler2DArray uTex;
in vec3 vUV;
in vec3 vWorld;
in vec3 vNormal;
in float vShade;
in float vAO;
in vec2 vLight;
flat in int vFlags;
out vec4 outColor;

void main() {
  vec4 t = texture(uTex, vUV);
  if (t.a < 0.5) discard;
  vec3 col = t.rgb;
  if (vFlags == 7) col *= 1.08;
  else col = applyLight(col, vLight, vAO, vShade);
  outColor = vec4(applyFog(col, vWorld), 1.0);
}
`;

export const LIQUID_FS = HEADER + NOISE + SKY + LIGHTING + `
uniform sampler2DArray uTex;
uniform float uTime;
in vec3 vUV;
in vec3 vWorld;
in vec3 vNormal;
in float vShade;
in float vAO;
in vec2 vLight;
flat in int vFlags;
out vec4 outColor;

float waterHeight(vec2 p) {
  return sin(p.x * 1.7 + uTime * 1.8) * 0.035 + sin(p.y * 2.3 - uTime * 1.3) * 0.03
       + sin((p.x + p.y) * 3.1 + uTime * 2.4) * 0.015 + (vnoise(p * 1.6 + uTime * 0.45) - 0.5) * 0.07;
}

void main() {
  if (vFlags == 4) {
    vec3 px = floor(vWorld * 16.0 + 0.001) / 16.0; // snap to the texel grid so lava reads as pixel art
    vec2 q = px.xz * 0.55 + vec2(px.y * 0.35, -px.y * 0.2);
    float n = fbm(q + vec2(uTime * 0.07, uTime * 0.045));
    float n2 = fbm(q * 2.2 - vec2(uTime * 0.11, uTime * 0.02));
    vec3 col = mix(vec3(0.5, 0.06, 0.01), vec3(1.0, 0.42, 0.04), smoothstep(0.25, 0.75, n));
    col = mix(col, vec3(1.0, 0.88, 0.38), smoothstep(0.62, 0.9, n2) * 0.85);
    outColor = vec4(applyFog(col * 1.15, vWorld), 1.0);
    return;
  }
  vec4 t = texture(uTex, vUV);
  if (vFlags == 8) {
    vec3 col = applyLight(t.rgb, vLight, vAO, vShade);
    outColor = vec4(applyFog(col, vWorld), 0.8);
    return;
  }
  vec3 N = vNormal;
  if (vFlags == 3) {
    vec2 p = vWorld.xz;
    float e = 0.08;
    float h0 = waterHeight(p);
    N = normalize(vec3((h0 - waterHeight(p + vec2(e, 0.0))) / e, 1.0, (h0 - waterHeight(p + vec2(0.0, e))) / e));
  }
  vec3 V = normalize(uCamPos - vWorld);
  float cosT = abs(dot(N, V));
  float fres = 0.03 + 0.97 * pow(1.0 - cosT, 5.0);
  float skyVis = pow(0.8, 15.0 * (1.0 - vLight.x));
  vec3 base = applyLight(t.rgb * vec3(0.55, 0.78, 1.05), vLight, 3.0, vShade);
  vec3 refl = skyColor(reflect(-V, N)) * mix(0.25, 1.0, skyVis);
  vec3 col = mix(base, refl * vec3(0.8, 0.9, 1.0), clamp(fres, 0.0, 0.6));
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.0), 240.0) * 3.0 * skyVis;
  float alpha = uUnderwater > 0.5 ? 0.6 : mix(0.68, 0.94, fres);
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
  vec3 col = skyColor(dir);

  if (uNight > 0.01 && dir.y > -0.05) {
    vec3 sd = dir * 260.0;
    vec3 cell = floor(sd);
    float h = hash13(cell);
    if (h > 0.9965) {
      vec3 f = fract(sd) - 0.5;
      float star = smoothstep(0.35, 0.0, length(f));
      float tw = 0.55 + 0.45 * sin(uTime * (2.0 + h * 5.0) + h * 80.0);
      col += vec3(0.85, 0.9, 1.0) * star * tw * uNight * smoothstep(-0.05, 0.25, dir.y);
    }
  }

  float sun = squareDisc(dir, uSunDir, 0.055);
  col += uSunColor * sun * 5.0;
  float moon = squareDisc(dir, -uSunDir, 0.04);
  vec3 md = dir * 30.0;
  float craters = 0.75 + 0.25 * vnoise(vec2(dot(md, vec3(1, 0, 0)), dot(md, vec3(0, 1, 0))) * 3.0);
  col += vec3(0.8, 0.85, 1.0) * moon * craters * (0.3 + uNight * 1.2);
  float mg = max(dot(dir, -uSunDir), 0.0);
  col += vec3(0.25, 0.3, 0.45) * pow(mg, 60.0) * uNight;

  if (uClouds > 0.5 && dir.y > 0.02) {
    for (int layer = 0; layer < 2; layer++) {
      float height = layer == 0 ? 190.0 : 240.0;
      float t = (height - uCamPos.y) / dir.y;
      if (t <= 0.0) continue;
      vec2 q = (uCamPos.xz + dir.xz * t) * (layer == 0 ? 0.006 : 0.0035) + vec2(uTime * 0.006, uTime * 0.0025) * (layer == 0 ? 1.0 : 0.6);
      float c = fbm(q);
      float cover = smoothstep(0.48, 0.78, c) * (layer == 0 ? 1.0 : 0.6);
      float light = smoothstep(0.4, 0.95, fbm(q + vec2(0.04, 0.03))) ;
      vec3 day = mix(vec3(1.0), vec3(0.78, 0.82, 0.9), light * 0.6);
      vec3 cloudCol = mix(vec3(0.08, 0.09, 0.14), day, 1.0 - uNight) + uSunColor * 0.25 * (1.0 - light);
      float fade = exp(-t * 0.0009) * smoothstep(0.02, 0.18, dir.y);
      col = mix(col, cloudCol, cover * fade * 0.92);
    }
  }
  outColor = vec4(col, 1.0);
}
`;

export const OVERLAY_VS = HEADER + `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aUV;
layout(location = 2) in float aLight;
uniform mat4 uViewProj;
out vec3 vUV;
out vec3 vWorld;
out float vBright;
void main() {
  vUV = aUV;
  vWorld = aPos;
  vBright = aLight;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}
`;

export const OVERLAY_FS = HEADER + LIGHTING + `
uniform sampler2DArray uTex;
uniform float uAlphaTest;
in vec3 vUV;
in vec3 vWorld;
in float vBright;
out vec4 outColor;
void main() {
  vec4 t = texture(uTex, vUV);
  if (t.a < uAlphaTest) discard;
  outColor = vec4(applyFog(t.rgb * vBright, vWorld), t.a);
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
uniform float uUnderwater;
uniform float uTime;
uniform float uFlash;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec2 uv = vUV;
  if (uUnderwater > 0.5) uv += vec2(sin(uv.y * 22.0 + uTime * 2.2), cos(uv.x * 17.0 + uTime * 1.8)) * 0.0035;
  vec3 c = texture(uScene, uv).rgb;
  if (uUnderwater > 0.5) c = mix(c, c * vec3(0.4, 0.62, 1.0), 0.55);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.1);
  c = (c - 0.5) * 1.05 + 0.5;
  c += uFlash;
  vec2 d = vUV - 0.5;
  c *= mix(0.68, 1.0, smoothstep(0.85, 0.25, length(d) * 1.15));
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

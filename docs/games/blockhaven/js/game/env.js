// Sky, sun, fog and ambient light per dimension, time of day and weather.
import { DIM } from '../data/blocks.js?v=mush3n7f';

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

export function computeEnv(dim, dayTime, camFwd, rain = 0, thunder = 0, brightness = 0.5) {
  const lift = brightness * 0.06;
  if (dim === DIM.NETHER) {
    return {
      sunDir: [0, 1, 0], zenith: [0.2, 0.03, 0.02], horizon: [0.25, 0.05, 0.03], sunColor: [0, 0, 0],
      skyLight: [0, 0, 0], night: 0, fogColor: [0.24, 0.04, 0.025], day: 0, ambient: [0.52 + lift, 0.4 + lift, 0.35 + lift], sky: 0,
    };
  }
  if (dim === DIM.END) {
    return {
      sunDir: [0, 1, 0], zenith: [0.05, 0.02, 0.08], horizon: [0.1, 0.06, 0.13], sunColor: [0, 0, 0],
      skyLight: [0.55, 0.5, 0.62], night: 0, fogColor: [0.06, 0.04, 0.09], day: 0, ambient: [0.16 + lift, 0.14 + lift, 0.2 + lift], sky: 0,
    };
  }
  const a = dayTime * Math.PI * 2;
  const len = Math.hypot(Math.cos(a), Math.sin(a), 0.25);
  const sunDir = [Math.cos(a) / len, Math.sin(a) / len, 0.25 / len];
  const sy = sunDir[1];
  const day = smoothstep(-0.1, 0.22, sy);
  const sunset = (1 - smoothstep(0.0, 0.32, Math.abs(sy))) * smoothstep(-0.28, 0.0, sy);
  let zenith = mix([0.008, 0.012, 0.035], [0.25, 0.5, 0.95], day);
  let horizon = mix([0.03, 0.045, 0.09], [0.68, 0.82, 1.0], day);
  horizon = mix(horizon, [1.0, 0.52, 0.25], sunset * 0.7 * (1 - rain));
  zenith = mix(zenith, [0.32, 0.33, 0.6], sunset * 0.25 * (1 - rain));
  const grey = v => { const l = (v[0] + v[1] + v[2]) / 3; return [l, l, l]; };
  zenith = mix(zenith, grey(zenith).map(v => v * 0.6), rain);
  horizon = mix(horizon, grey(horizon).map(v => v * 0.65), rain);
  const sunColor = mix([1.0, 0.45, 0.18], [1.0, 0.93, 0.82], smoothstep(0.0, 0.45, sy)).map(v => v * smoothstep(-0.12, 0.05, sy) * (1 - rain * 0.8));
  let skyLight = mix([0.16, 0.19, 0.32], mix([1.0, 0.72, 0.52], [1, 1, 1], smoothstep(0.05, 0.4, sy)), day);
  skyLight = skyLight.map(v => v * (1 - rain * 0.3 - thunder * 0.2));
  const night = 1 - smoothstep(-0.25, 0.05, sy);
  const fl = Math.hypot(camFwd[0], camFwd[2]) || 1, sl = Math.hypot(sunDir[0], sunDir[2]) || 1;
  const facing = Math.max(0, (camFwd[0] * sunDir[0] + camFwd[2] * sunDir[2]) / (fl * sl));
  const fogColor = horizon.map((v, i) => v + sunColor[i] * Math.pow(facing, 4) * 0.35 * sunset);
  const amb = 0.035 + lift;
  return { sunDir, zenith, horizon, sunColor, skyLight, night, fogColor, day, ambient: [amb, amb * 1.1, amb * 1.5], sky: 1 };
}

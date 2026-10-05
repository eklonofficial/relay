// Rain and snow textures: Java's environment/rain.png and snow.png, 64x256 each and repeating, drawn
// on the sheets of falling rain and snow (main.js drawWeather). Without a pack, painted ones: thin
// pale streaks of rain, and loose flakes of snow.
import { mulberry32 } from '../core/noise.js?v=muujns32';

export const WEATHER_W = 64, WEATHER_H = 256;

function paint(fn, seed) {
  const d = new Uint8ClampedArray(WEATHER_W * WEATHER_H * 4), r = mulberry32(seed);
  const put = (x, y, c, a) => { x = ((x % WEATHER_W) + WEATHER_W) % WEATHER_W; y = ((y % WEATHER_H) + WEATHER_H) % WEATHER_H; const o = (y * WEATHER_W + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.max(d[o + 3], a); };
  fn(put, r);
  return d;
}
export function generateWeatherTextures() {
  // Rain: short streaks, each a few pixels long, brighter at the front.
  const rain = paint((put, r) => {
    for (let k = 0; k < 90; k++) {
      const x = Math.floor(r() * WEATHER_W), y = Math.floor(r() * WEATHER_H), len = 6 + Math.floor(r() * 10);
      for (let j = 0; j < len; j++) put(x, y + j, [196, 214, 255], 70 + Math.floor(130 * j / len));
    }
  }, 11);
  // Snow: flakes of one to four pixels.
  const snow = paint((put, r) => {
    for (let k = 0; k < 110; k++) {
      const x = Math.floor(r() * WEATHER_W), y = Math.floor(r() * WEATHER_H), big = r() < 0.4;
      put(x, y, [255, 255, 255], 230);
      if (big) { put(x + 1, y, [240, 244, 255], 200); put(x, y + 1, [240, 244, 255], 200); put(x + 1, y + 1, [225, 232, 250], 170); }
    }
  }, 23);
  return [rain, snow];
}

// The pack's rain and snow, at 64x256 (a high-resolution pack scaled down); null for any it lacks.
export async function readWeatherTextures(zip) {
  const out = [];
  for (const name of ['rain', 'snow']) {
    const bytes = await zip.bytes(`assets/minecraft/textures/environment/${name}.png`);
    if (!bytes) { out.push(null); continue; }
    try {
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas'); c.width = WEATHER_W; c.height = WEATHER_H;
      const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
      x.drawImage(bmp, 0, 0, WEATHER_W, WEATHER_H);
      out.push(new Uint8ClampedArray(x.getImageData(0, 0, WEATHER_W, WEATHER_H).data));
    } catch { out.push(null); }
  }
  return out;
}

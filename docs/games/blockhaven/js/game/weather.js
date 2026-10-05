// Java Edition's weather (1.20.1): ServerLevel.advanceWeatherCycle's timers, the rain and thunder
// levels that follow them, where it rains or snows (Biome.getPrecipitationAt, Level.isRainingAt) and
// how dark the sky gets (Level.updateSkyBrightness). Times are in ticks (20 a second).
import { BIOMES, DRY } from '../gen/biomes.js?v=muujmt1i';
import { B, SOLID, DIM, SHAPE, SHAPE_OF, STATE, WATERLOGGED, VARIANT_MASK } from '../data/blocks.js?v=muujmt1i';
import { collisionBoxes } from '../data/shapes.js?v=muujmt1i';

// ServerLevel's UniformInts.
export const RAIN_DELAY = [12000, 180000], RAIN_DURATION = [12000, 24000], THUNDER_DELAY = [12000, 180000], THUNDER_DURATION = [3600, 15600];
export const sample = ([a, b]) => a + Math.floor(Math.random() * (b - a + 1));

// The weather state: { raining, thundering, clearTime, rainTime, thunderTime, rain, thunder } (the
// last two the 0..1 levels). Saves from before carried { rain, thunder, target, thunderOn, timer }.
export function weatherState(w = {}) {
  if (w.raining === undefined) {
    w.raining = !!w.target; w.thundering = !!(w.target && w.thunderOn);
    w.clearTime = 0; w.rainTime = 0; w.thunderTime = 0;
    delete w.target; delete w.thunderOn; delete w.timer;
  }
  w.rain = w.rain || 0; w.thunder = w.thunder || 0;
  return w;
}

// One tick of ServerLevel.advanceWeatherCycle (`cycle`: the doWeatherCycle rule).
export function tickWeather(w, cycle) {
  if (cycle) {
    if (w.clearTime > 0) {
      w.clearTime--;
      w.thunderTime = w.thundering ? 0 : 1; w.rainTime = w.raining ? 0 : 1;
      w.thundering = false; w.raining = false;
    } else {
      if (w.thunderTime > 0) { if (--w.thunderTime === 0) w.thundering = !w.thundering; }
      else w.thunderTime = sample(w.thundering ? THUNDER_DURATION : THUNDER_DELAY);
      if (w.rainTime > 0) { if (--w.rainTime === 0) w.raining = !w.raining; }
      else w.rainTime = sample(w.raining ? RAIN_DURATION : RAIN_DELAY);
    }
  }
  w.thunder = Math.min(1, Math.max(0, w.thunder + (w.thundering ? 0.01 : -0.01)));
  w.rain = Math.min(1, Math.max(0, w.rain + (w.raining ? 0.01 : -0.01)));
}

// ServerLevel.setWeatherParameters (/weather, sleeping).
export function setWeather(w, clearTime, time, raining, thundering) {
  w.clearTime = clearTime; w.rainTime = time; w.thunderTime = time; w.raining = raining; w.thundering = thundering;
}

// Level.getRainLevel / getThunderLevel (thunder only counts as far as it also rains), isRaining
// and isThundering.
export const rainLevel = w => w.rain || 0;
export const thunderLevel = w => (w.thunder || 0) * (w.rain || 0);
export const isRaining = w => rainLevel(w) > 0.2;
export const isThundering = w => thunderLevel(w) > 0.9;

// DimensionType.timeOfDay: the sun's angle, 0..1 from noon.
export function timeOfDay(dayTime) {
  const d0 = ((dayTime - 0.25) % 1 + 1) % 1, d1 = 0.5 - Math.cos(d0 * Math.PI) / 2;
  return (d0 * 2 + d1) / 3;
}
// Level.updateSkyBrightness: how many light levels the sky has lost (0 at noon, 11 at night; rain
// and thunder each take 5/16 of what is left).
export function skyDarken(dayTime, w) {
  const d0 = 1 - rainLevel(w) * 5 / 16, d1 = 1 - thunderLevel(w) * 5 / 16;
  const d2 = 0.5 + 2 * Math.max(-0.25, Math.min(0.25, Math.cos(timeOfDay(dayTime) * Math.PI * 2)));
  return Math.floor((1 - d2 * d0 * d1) * 11);
}

// Biome.getHeightAdjustedTemperature: above y 80 it gets colder (with a little noise across the land).
function tempNoise(x, z) { return Math.sin(x * 0.051 + Math.sin(z * 0.037)) * 0.5 + Math.sin(z * 0.043 - x * 0.029) * 0.5; }
export function temperatureAt(biome, x, y, z) {
  const t = BIOMES[biome] ? BIOMES[biome].temp : 0.8;
  return y > 80 ? t - (tempNoise(x / 8, z / 8) * 8 + y - 80) * 0.05 / 40 : t;
}
// Biome.getPrecipitationAt: 'rain', 'snow' (below 0.15), or null where it never rains (deserts,
// savannas, badlands, the Nether).
export function precipitationAt(biome, x, y, z) {
  if (DRY.has(biome) || /savanna|badlands|end/.test((BIOMES[biome] || {}).key || '')) return null;
  return temperatureAt(biome, x, y, z) < 0.15 ? 'snow' : 'rain';
}
// The MOTION_BLOCKING heightmap: the top block that stops a fall (solid, leaves) or holds a fluid;
// rain and snow come down to the block above it. (Snow layers don't count: Java's are never solid.)
export function precipitationHeight(world, x, z) {
  let y = world.heightAt(x, z);
  if (y < 0) return -1;
  while (y > 0) { const id = world.getBlock(x, y, z); if ((SOLID[id] && id !== B.SNOW) || id === B.WATER || id === B.LAVA) break; y--; }
  return y + 1;
}
// Level.isRainingAt: raining, open to the sky there, and rain (not snow) in its biome.
export function isRainingAt(world, w, dim, x, y, z) {
  if (dim !== DIM.OVERWORLD || !isRaining(w)) return false;
  if (precipitationHeight(world, x, z) > Math.floor(y)) return false;
  return precipitationAt(world.biomeAt(x, z), x, Math.floor(y), z) === 'rain';
}

// Biome.shouldFreeze: a still water source too cold for rain, with block light below 10 and
// something other than water beside it (ice grows in from the shore).
export function shouldFreeze(world, biome, x, y, z) {
  if (temperatureAt(biome, x, y, z) >= 0.15 || y < 0 || y > 255 || world.lightAt(x, y, z).blk >= 10) return false;
  if (world.getBlock(x, y, z) !== B.WATER || (world.getMeta(x, y, z) & 15) !== 0) return false;
  let edge = false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = world.getBlock(x + dx, y, z + dz);
    if (n === 255) return false; // (an unloaded neighbour: isAreaLoaded)
    if (n !== B.WATER && !WATERLOGGED[n]) edge = true;
  }
  return edge;
}
// Biome.shouldSnow: too cold for rain, block light below 10, air or a snow layer, and somewhere
// snow can lie.
export function shouldSnow(world, biome, x, y, z) {
  if (temperatureAt(biome, x, y, z) >= 0.15 || y < 1 || y > 255 || world.lightAt(x, y, z).blk >= 10) return false;
  const id = world.getBlock(x, y, z);
  return (id === B.AIR || id === B.SNOW) && snowCanSurvive(world, x, y, z);
}
// SnowLayerBlock.canSurvive: not on ice, packed ice or barriers; always on honey and soul sand;
// otherwise on a full top face, or on a full stack of snow layers.
export function snowCanSurvive(world, x, y, z) {
  const id = world.getBlock(x, y - 1, z), m = world.getMeta(x, y - 1, z), is = k => STATE[k] && id === STATE[k][0] && (m & VARIANT_MASK[id]) === STATE[k][1];
  if (id === B.ICE || is('packed_ice')) return false;
  if (is('honey_block') || is('soul_sand')) return true;
  if (id === B.SNOW) return (m & 7) === 7;
  if (SHAPE_OF[id] === SHAPE.PANE) return false;
  return collisionBoxes(id, m).some(b => b[0] <= 0 && b[2] <= 0 && b[3] >= 1 && b[5] >= 1 && b[4] === 1);
}

// Java's TimeArgument: a number of ticks, or with a unit: 't' ticks, 's' seconds, 'd' days.
export function parseTime(s) {
  const m = /^(\d+(?:\.\d+)?)([tsd]?)$/.exec(s || '');
  if (!m) return null;
  return Math.round(Number(m[1]) * ({ '': 1, t: 1, s: 20, d: 24000 })[m[2]]);
}

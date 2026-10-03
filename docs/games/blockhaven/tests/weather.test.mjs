// game/weather.js: Java's weather cycle, levels, sky darkening and where it rains.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const W = await load('game/weather.js');
const { BIOMES } = await load('gen/biomes.js');
const { B } = await load('data/blocks.js');
const biome = k => BIOMES.find(b => b.key === k).id;

test('the cycle: clear weather holds, then rain comes and goes on its own timer', () => {
  const w = W.weatherState({});
  W.setWeather(w, 3, 0, false, false);
  for (let i = 0; i < 3; i++) W.tickWeather(w, true);
  assert.equal(w.raining, false); assert.equal(w.clearTime, 0);
  // As in Java, a set clear spell ends in a storm: both timers were held at 1.
  W.tickWeather(w, true);
  assert.equal(w.raining, true); assert.equal(w.thundering, true);
  W.tickWeather(w, true); // new timers drawn from Java's ranges
  assert.ok(w.rainTime >= 12000 && w.rainTime <= 24000 && w.thunderTime >= 3600 && w.thunderTime <= 15600);
  W.setWeather(w, 0, 0, false, false); w.rain = 0;
  W.tickWeather(w, true); w.rainTime = 1; W.tickWeather(w, true);
  assert.equal(w.raining, true);
  for (let i = 0; i < 50; i++) W.tickWeather(w, true);
  assert.ok(Math.abs(w.rain - 0.51) < 1e-9, 'the rain level rises 0.01 a tick (from the tick it starts)');
});

test('old saves keep their weather', () => {
  const w = W.weatherState({ rain: 1, thunder: 0, target: 1, thunderOn: false, timer: 200 });
  assert.equal(w.raining, true); assert.equal(w.thundering, false); assert.equal(w.timer, undefined);
});

test('the sky darkens as Level.updateSkyBrightness does', () => {
  const clear = { rain: 0, thunder: 0 }, rain = { rain: 1, thunder: 0 }, storm = { rain: 1, thunder: 1 };
  assert.equal(W.skyDarken(0.25, clear), 0); // noon
  assert.equal(W.skyDarken(0.75, clear), 11); // midnight
  assert.equal(W.skyDarken(0.25, rain), 3);
  assert.equal(W.skyDarken(0.25, storm), 5);
  assert.ok(W.isThundering(storm) && !W.isThundering(rain));
});

test('rain falls only where the biome has rain, from open sky', () => {
  const world = { heightAt: () => 63, getBlock: (x, y) => (y <= 63 ? B.STONE : B.AIR), biomeAt: () => biome('plains') };
  const w = { rain: 1, thunder: 0 };
  assert.ok(W.isRainingAt(world, w, 0, 0, 64, 0));
  assert.ok(!W.isRainingAt(world, w, 0, 0, 60, 0), 'not under the ground');
  assert.ok(!W.isRainingAt({ ...world, biomeAt: () => biome('desert') }, w, 0, 0, 64, 0), 'no rain in a desert');
  assert.equal(W.precipitationAt(biome('snowy_plains'), 0, 64, 0), 'snow');
  assert.equal(W.precipitationAt(biome('plains'), 0, 64, 0), 'rain');
  assert.equal(W.precipitationAt(biome('windswept_hills'), 0, 150, 0), 'snow', 'cold enough high up');
  assert.equal(W.precipitationAt(biome('plains'), 0, 200, 0), 'rain', 'plains never get that cold');
  assert.equal(W.parseTime('100'), 100); assert.equal(W.parseTime('30s'), 600); assert.equal(W.parseTime('1d'), 24000); assert.equal(W.parseTime('x'), null);
});

test('JavaRandom gives java.util.Random\'s numbers (for the rain and snow columns)', async () => {
  const { JavaRandom } = await load('core/jrandom.js');
  const r = new JavaRandom(42);
  assert.deepEqual([r.nextInt(100), r.nextInt(100)], [30, 63]);
  assert.equal(r.nextFloat().toFixed(6), '0.683223');
  assert.equal(r.nextDouble().toFixed(6), '0.047939');
  assert.equal(r.nextGaussian().toFixed(6), '0.276860');
  const q = new JavaRandom(-12345678901n);
  assert.equal(q.nextInt(10), 4); assert.equal(q.nextFloat().toFixed(6), '0.795654');
});

test('ice and snow form as ServerLevel.tickPrecipitation forms them', () => {
  const blocks = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  const world = {
    heightAt: () => 64, lightAt: () => ({ sky: 15, blk: 0 }), biomeAt: () => biome('snowy_plains'),
    getBlock: (x, y, z) => blocks.get(key(x, y, z))?.[0] ?? (y <= 62 ? B.STONE : B.AIR),
    getMeta: (x, y, z) => blocks.get(key(x, y, z))?.[1] ?? 0,
  };
  const cold = biome('snowy_plains'), warm = biome('plains');
  // A pond three wide: its edge freezes, its middle waits for the ice to grow in.
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) blocks.set(key(x, 63, z), [B.WATER, 0]);
  assert.ok(W.shouldFreeze(world, cold, 1, 63, 0));
  assert.ok(!W.shouldFreeze(world, cold, 0, 63, 0), 'the middle is all water around');
  assert.ok(!W.shouldFreeze(world, warm, 1, 63, 0), 'too warm');
  assert.ok(!W.shouldFreeze({ ...world, lightAt: () => ({ sky: 15, blk: 12 }) }, cold, 1, 63, 0), 'too bright');
  // Snow lies on stone, not on ice, and not where it's warm.
  assert.ok(W.shouldSnow(world, cold, 5, 63, 5));
  assert.ok(!W.shouldSnow(world, warm, 5, 63, 5));
  blocks.set(key(1, 63, 0), [B.ICE, 0]);
  assert.ok(!W.shouldSnow(world, cold, 1, 64, 0), 'not on ice');
  // Rain and snow fall through snow layers (they aren't motion-blocking).
  blocks.set(key(5, 63, 5), [B.SNOW, 0]);
  assert.equal(W.precipitationHeight(world, 5, 5), 63);
  assert.ok(W.shouldSnow(world, cold, 5, 63, 5), 'a snow layer can take another');
});

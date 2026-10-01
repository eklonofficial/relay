import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { B, DIM } = await load('data/blocks.js');
const { Sim } = await load('game/sim.js');
const { flowAt } = await load('game/fluid.js');

// A small world (stone floor at y 0) and the bits of Game the simulation calls.
function setup(dim = DIM.OVERWORLD) {
  const cells = new Map(), k = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  const world = {
    dim,
    getBlock: (x, y, z) => (y < 1 ? B.STONE : (cells.get(k(x, y, z)) || [B.AIR])[0]),
    getMeta: (x, y, z) => (y < 1 ? 0 : (cells.get(k(x, y, z)) || [0, 0])[1]),
    lightAt: () => ({ sky: 15, blk: 0 }),
  };
  const game = {
    world, dim, rules: { doFireTick: false },
    sound: { play() {} }, particles: { smoke() {} },
    setBlock(x, y, z, id, m = 0) { if (id === B.AIR) cells.delete(k(x, y, z)); else cells.set(k(x, y, z), [id, m]); sim.onChange(Math.floor(x), Math.floor(y), Math.floor(z)); },
    breakBlock(x, y, z) { game.setBlock(x, y, z, B.AIR, 0); },
  };
  const sim = new Sim(game);
  sim.randomTicks = () => {};
  const run = seconds => { for (let t = 0; t < seconds * 20; t++) sim.update(0.05); };
  return { world, game, sim, run, at: (x, y, z) => [world.getBlock(x, y, z), world.getMeta(x, y, z)] };
}

test('a source on flat ground spreads 7 blocks as a diamond', () => {
  const s = setup();
  s.game.setBlock(0, 1, 0, B.WATER, 0);
  s.run(10);
  assert.deepEqual(s.at(7, 1, 0), [B.WATER, 7]);
  assert.deepEqual(s.at(3, 1, 4), [B.WATER, 7]);
  assert.deepEqual(s.at(8, 1, 0), [B.AIR, 0]);
  assert.deepEqual(s.at(4, 1, 4), [B.AIR, 0]);
  assert.deepEqual(s.at(2, 1, 1), [B.WATER, 3]);
});

test('water heads only for the nearest drop within 4 blocks', () => {
  const s = setup();
  // A raised platform at y 1 with a hole 3 blocks east of the source.
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) if (!(x === 3 && z === 0)) s.game.setBlock(x, 1, z, B.STONE, 0);
  s.game.setBlock(3, 1, 0, B.AIR, 0);
  s.game.setBlock(0, 2, 0, B.WATER, 0);
  s.run(6);
  assert.equal(s.at(1, 2, 0)[0], B.WATER);
  assert.equal(s.at(-1, 2, 0)[0], B.AIR, 'no spreading away from the hole');
  assert.equal(s.at(0, 2, 1)[0], B.AIR);
  assert.equal(s.at(3, 1, 0)[0], B.WATER, 'it falls into the hole');
});

test('a waterfall landing on water does not spread over its surface', () => {
  const s = setup();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) s.game.setBlock(x, 1, z, B.WATER, 0);
  s.game.setBlock(0, 6, 0, B.STONE, 0);
  s.game.setBlock(0, 5, 0, B.WATER, 0);
  s.run(10);
  for (let y = 2; y <= 4; y++) assert.deepEqual(s.at(0, y, 0), [B.WATER, 8], `falling column at y ${y}`);
  // A hanging source spreads one block each way (those fall too), but nothing flows over the pool.
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { const [id, m] = s.at(x, 2, z); assert.ok(id === B.AIR || m === 8, `puddle at ${x},${z}`); }
  assert.equal(s.at(2, 2, 0)[0], B.AIR);
});

test('two sources make a third between them; lava never does', () => {
  const s = setup();
  s.game.setBlock(0, 1, 0, B.WATER, 0); s.game.setBlock(2, 1, 0, B.WATER, 0);
  s.run(3);
  assert.deepEqual(s.at(1, 1, 0), [B.WATER, 0]);
  const l = setup();
  l.game.setBlock(0, 1, 0, B.LAVA, 0); l.game.setBlock(2, 1, 0, B.LAVA, 0);
  l.run(10);
  assert.notEqual(l.at(1, 1, 0)[1], 0);
});

test('lava runs 3 blocks in the Overworld and 7 in the Nether', () => {
  const s = setup();
  s.game.setBlock(0, 1, 0, B.LAVA, 0);
  s.run(60);
  assert.deepEqual(s.at(3, 1, 0), [B.LAVA, 6]);
  assert.equal(s.at(4, 1, 0)[0], B.AIR);
  const n = setup(DIM.NETHER);
  n.game.dim = DIM.NETHER;
  n.game.setBlock(0, 1, 0, B.LAVA, 0);
  n.run(30);
  assert.deepEqual(n.at(7, 1, 0), [B.LAVA, 7]);
});

test('water meeting lava makes obsidian from a source and cobblestone from flowing lava', () => {
  const s = setup();
  s.game.setBlock(0, 1, 0, B.LAVA, 0);
  s.game.setBlock(5, 1, 0, B.LAVA, 0);
  s.run(10);
  s.game.setBlock(1, 1, 1, B.STONE, 0); s.game.setBlock(1, 1, -1, B.STONE, 0);
  s.game.setBlock(0, 2, 0, B.WATER, 0);
  assert.equal(s.at(0, 1, 0)[0], B.OBSIDIAN);
  s.game.setBlock(6, 2, 0, B.WATER, 0);
  s.run(1);
  assert.equal(s.at(6, 1, 0)[0], B.COBBLESTONE);
});

test('the current points downhill, and falling water pulls down at a wall', () => {
  const s = setup();
  s.game.setBlock(0, 1, 0, B.WATER, 0);
  s.run(5);
  const f = flowAt(s.world, 3, 1, 0, false);
  assert.ok(f[0] > 0.99 && Math.abs(f[2]) < 1e-6, `flow ${f}`);
  assert.deepEqual(flowAt(s.world, 0, 1, 0, false).map(v => Math.round(v * 1e6) / 1e6), [0, 0, 0]);
});

test('taking the source away drains the flow', () => {
  const s = setup();
  s.game.setBlock(0, 1, 0, B.WATER, 0);
  s.run(10);
  s.game.setBlock(0, 1, 0, B.AIR, 0);
  s.run(10);
  for (let x = -7; x <= 7; x++) assert.equal(s.at(x, 1, 0)[0], B.AIR, `left at ${x}`);
});

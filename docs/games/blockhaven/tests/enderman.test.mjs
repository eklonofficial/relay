// Endermen picking up and setting down blocks (Mob.endermanBlocks, after EndermanTakeBlockGoal and
// EndermanLeaveBlockGoal).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { Mob } = await load('entity/mob.js');
const { B } = await load('data/blocks.js');

// An enderman standing at (0.5, 1, 0.5) on a floor of `floor`, with `put` blocks placed by key.
function scene(floor, put = {}, griefing = true) {
  const blocks = new Map(Object.entries(put));
  const w = {
    getBlock: (x, y, z) => { x = Math.floor(x); y = Math.floor(y); z = Math.floor(z); return blocks.has(`${x},${y},${z}`) ? blocks.get(`${x},${y},${z}`) : y <= 0 ? floor : B.AIR; },
    getMeta: () => 0,
    raycast(o, d, max) { for (let t = 0; t <= max; t += 0.05) { const id = this.getBlock(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t); if (id !== B.AIR) return { x: Math.floor(o[0] + d[0] * t), y: Math.floor(o[1] + d[1] * t), z: Math.floor(o[2] + d[2] * t), id }; } return null; },
  };
  const m = Object.create(Mob.prototype);
  Object.assign(m, { pos: [0.5, 1, 0.5], carried: null });
  m.game = { world: w, rules: { mobGriefing: griefing }, setBlock: (x, y, z, id) => blocks.set(`${x},${y},${z}`, id) };
  return { m, blocks };
}

test('an enderman picks up a holdable block near it, and leaves stone alone', () => {
  const { m, blocks } = scene(B.STONE, { '1,1,0': B.TNT });
  for (let i = 0; i < 20000 && !m.carried; i++) m.endermanBlocks(0.05);
  assert.deepEqual(m.carried, [B.TNT, 0]);
  assert.equal(blocks.get('1,1,0'), B.AIR);
  const s = scene(B.STONE);
  for (let i = 0; i < 5000; i++) s.m.endermanBlocks(0.05);
  assert.equal(s.m.carried, null, 'stone is not holdable');
});

test('it sets its block down on solid ground, and does nothing without mobGriefing', () => {
  const { m, blocks } = scene(B.STONE);
  m.carried = [B.TNT, 0];
  for (let i = 0; i < 200000 && m.carried; i++) m.endermanBlocks(0.05);
  assert.equal(m.carried, null);
  assert.ok([...blocks.values()].includes(B.TNT));
  const off = scene(B.STONE, { '1,1,0': B.TNT }, false);
  for (let i = 0; i < 5000; i++) off.m.endermanBlocks(0.05);
  assert.equal(off.m.carried, null);
});

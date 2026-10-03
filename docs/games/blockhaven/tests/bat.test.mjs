// Bats roosting (Mob.batRest, after Bat.customServerAiStep).
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { Mob } = await load('entity/mob.js');
const { B } = await load('data/blocks.js');

// A bat under a stone block at y = 10, with the player `far` blocks away.
const bat = (ceiling = true, far = 10) => {
  const m = Object.create(Mob.prototype);
  Object.assign(m, { pos: [0.5, 9.5, 0.5], vel: [1, 1, 1], h: 0.9, yaw: 0, resting: false, mobType: 'bat' });
  m.game = { world: { getBlock: (x, y) => (ceiling && Math.floor(y) === 10 ? B.STONE : B.AIR) } };
  m.playerTargetable = () => true; m.distToPlayer = () => far;
  return m;
};

test('a bat under a ceiling hangs from it, snapped to its underside and still', () => {
  const m = bat();
  for (let i = 0; i < 2000 && !m.resting; i++) m.batRest(0.05);
  assert.ok(m.resting, 'settles within a few hundred ticks');
  m.batRest(0.05);
  assert.equal(m.pos[1], 10 - 0.9); assert.deepEqual(m.vel, [0, 0, 0]);
});

test('it lets go when the ceiling goes or a player comes near, and never hangs from air', () => {
  const m = bat(); m.resting = true; m.game.world.getBlock = () => B.AIR;
  assert.equal(m.batRest(0.05), false); assert.equal(m.resting, false);
  const n = bat(true, 3); n.resting = true;
  assert.equal(n.batRest(0.05), false);
  const o = bat(false);
  for (let i = 0; i < 2000; i++) o.batRest(0.05);
  assert.equal(o.resting, false);
});

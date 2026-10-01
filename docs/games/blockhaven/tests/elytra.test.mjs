import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { Player } = await load('game/player.js');
const { B } = await load('data/blocks.js');

// Open sky: nothing to collide with, no fluids.
const air = { dim: 0, getBlock: () => B.AIR, getMeta: () => 0, collide: () => [], lightAt: () => ({ sky: 15, blk: 0 }) };
const idle = { forward: false, back: false, left: false, right: false, jump: false, sneak: false, sprint: false };

test('a rocket lives 20-31 ticks at flight 1 and they stack', () => {
  const p = new Player(air);
  for (let i = 0; i < 200; i++) p.addRocket(1);
  assert.ok(p.rockets.every(t => t >= 20 && t <= 31));
  const q = new Player(air);
  q.addRocket(3);
  assert.ok(q.rockets[0] >= 40 && q.rockets[0] <= 51);
});

test('a gliding rocket settles near 1.67 blocks a tick along the view (Java ~33.5 m/s)', () => {
  const p = new Player(air);
  p.pos = [0, 200, 0]; p.gliding = true; p.yaw = 0; p.pitch = 0; p.vel = [0, 0, 0];
  p.rockets = [30];
  for (let t = 0; t < 10; t++) p.tick(idle);
  const v = p.vel.map(x => x / 20);
  assert.ok(-v[2] > 1.5 && -v[2] < 1.75, `forward ${-v[2]}`);
  assert.equal(p.h, 0.6, 'gliding hitbox is 0.6 tall');
});

test('rockets burn out while not gliding, without pushing', () => {
  const p = new Player(air);
  p.pos = [0, 200, 0]; p.vel = [0, 0, 0]; p.rockets = [3];
  for (let t = 0; t < 4; t++) p.tick(idle);
  assert.equal(p.rockets.length, 0);
  assert.ok(Math.abs(p.vel[0]) < 1e-9 && Math.abs(p.vel[2]) < 1e-9);
});

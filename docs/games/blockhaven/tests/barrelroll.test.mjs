import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { BarrelRoll } = await load('game/barrelroll.js');
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('free flight keeps yaw and pitch, rolls all the way round and comes back level', () => {
  const d = new BarrelRoll();
  d.start(0.7, 0.3);
  near(d.yaw, 0.7); near(d.pitch, 0.3); near(d.roll, 0);
  // A full barrel roll with the mouse: 2*pi of roll returns to the start.
  const sens = 0.002, steps = 1000, dx = 2 * Math.PI / (sens * 1.4) / steps;
  let maxRoll = 0;
  for (let i = 0; i < steps; i++) { d.look(dx, 0, sens); maxRoll = Math.max(maxRoll, Math.abs(d.roll)); }
  near(d.yaw, 0.7, 1e-6); near(d.pitch, 0.3, 1e-6); near(d.roll, 0, 1e-6);
  assert.ok(maxRoll > 3, 'went upside down on the way');
  // Rolling right then banking turns right (yaw decreases).
  d.look(300, 0, sens);
  assert.ok(d.roll < -0.5);
  const y0 = d.yaw;
  for (let i = 0; i < 20; i++) d.update(0.05, {}, false, 1);
  assert.ok(d.yaw < y0 - 0.1, `banked turn: ${y0} -> ${d.yaw}`);
  // A loop: pitching up through vertical flips over the top.
  const e = new BarrelRoll(); e.start(0, 0);
  for (let i = 0; i < 100; i++) e.look(0, -Math.PI / 0.002 / 100, 0.002);
  near(Math.abs(e.roll), Math.PI, 1e-6); near(e.pitch, 0, 1e-6);
  // Landing eases the camera roll back to zero.
  d.stop();
  let r = d.cameraRoll(0);
  for (let i = 0; i < 60; i++) r = d.cameraRoll(0.05);
  assert.ok(Math.abs(r) < 0.01 && !d.active);
});

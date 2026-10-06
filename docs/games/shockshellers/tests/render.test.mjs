// Rendering logic that doesn't need a GPU: the Auto Detail ladder, the quality rungs, the aim pose
// (iron sights on the eye line) and the hip pose (the bore meeting the crosshair), and the springs
// that move the first-person gun.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { adaptRung, RUNGS, QUALITY_RUNG } = await load('render/renderer.js');
const { sightOnAxis, convergeAngles, Spring } = await load('render/viewmodel.js');

const feed = (st, fps, n) => { for (let i = 0; i < n; i++) adaptRung(st, fps); return st.rung; };

test('Auto Detail drops after two seconds under 45 fps, not on a single dip', () => {
  const st = { rung: 2, ceiling: 3, low: 0 };
  assert.equal(feed(st, 30, 3), 2, 'a second and a half of low frame rate is not enough');
  assert.equal(feed(st, 60, 1), 2);
  assert.ok(st.low <= 0, 'a good sample clears the count of bad ones');
  assert.equal(feed(st, 30, 4), 1);
  assert.equal(feed(st, 30, 4), 0);
  assert.equal(feed(st, 20, 40), 0, 'never below the lowest rung');
});

test('Auto Detail climbs after five seconds at 60, but never back above a rung it had to leave', () => {
  const st = { rung: 2, ceiling: 3, low: 0 };
  assert.equal(feed(st, 60, 9), 2);
  assert.equal(feed(st, 60, 1), 3, 'ten good samples climb one rung');
  assert.equal(feed(st, 30, 4), 2);
  assert.equal(st.ceiling, 2);
  assert.equal(feed(st, 60, 100), 2, 'the rung it dropped from is off limits');
  const fixed = { rung: 0, ceiling: 0, low: 0 };
  assert.equal(feed(fixed, 60, 100), 0, 'a fixed choice never climbs');
});

test('quality rungs: Low draws straight to the canvas, nothing renders above 1.5 pixels per CSS pixel', () => {
  assert.equal(RUNGS[QUALITY_RUNG.low].post, false);
  assert.ok(RUNGS[QUALITY_RUNG.medium].post && RUNGS[QUALITY_RUNG.high].post);
  for (let i = 1; i < RUNGS.length; i++) {
    const a = RUNGS[i - 1], b = RUNGS[i];
    assert.ok(b.dpr * b.scale >= a.dpr * a.scale && b.levels >= a.levels && b.shadow >= a.shadow, `${b.name} is no cheaper than ${a.name}`);
  }
  for (const r of RUNGS) assert.ok(r.dpr <= 1.5 && r.scale <= 1, r.name);
});

test('aiming puts the sight anchor exactly on the eye line, at the eye relief', () => {
  for (const [sight, k, relief] of [[{ x: 0, y: 0.09, z: 0.04 }, 0.64, 0.17], [{ x: 0.08, y: 0.13, z: 0.05 }, 0.64, 0.16], [{ x: 0, y: 0.06, z: 0.12 }, 1, 0.26]]) {
    const p = sightOnAxis(sight, k, relief);
    const at = [p[0] + sight.x * k, p[1] + sight.y * k, p[2] + sight.z * k];
    assert.ok(Math.abs(at[0]) < 1e-12 && Math.abs(at[1]) < 1e-12 && Math.abs(at[2] + relief) < 1e-12, JSON.stringify(at));
  }
});

test('at the hip the bore is turned to meet the view axis a few metres out', () => {
  for (const p of [[0.15, -0.19, -0.42], [0.215, -0.25, -0.37], [0.12, -0.17, -0.38]]) {
    const [pitch, yaw] = convergeAngles(p, 7);
    // The bore (-z) turned by pitch then yaw (Euler order YXZ), followed from p out to the axis' depth.
    const d = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
    const t = (-7 - p[2]) / d[2];
    assert.ok(Math.abs(p[0] + d[0] * t) < 1e-9 && Math.abs(p[1] + d[1] * t) < 1e-9, `${p}`);
    assert.ok(yaw > 0 && pitch > 0, 'a gun low and right turns up and left');
  }
});

test('the gun springs settle without ringing, even across a long frame', () => {
  const s = new Spring(160);
  let peak = 0;
  for (let i = 0; i < 120; i++) { s.step(1, 1 / 60); peak = Math.max(peak, s.x); }
  assert.ok(Math.abs(s.x - 1) < 1e-3, `settles (${s.x})`);
  assert.ok(peak < 1.001, `critically damped: no overshoot (${peak})`);
  const big = new Spring(220, 0.9); big.v = 50;
  for (let i = 0; i < 10; i++) big.step(0, 0.1);
  assert.ok(Number.isFinite(big.x) && Math.abs(big.x) < 0.05, `stable at 10 fps (${big.x})`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { SplashArt } = await load('render/splashart.js');
const DT = 1 / 60;
const size = { w: 1280, h: 720, dpr: 1, cssW: 1280, cssH: 720 };
const make = (opts) => { const a = new SplashArt(opts); a.resize(size); return a; };
// Steps until f(art) or a time limit; returns the seconds taken.
const until = (art, f, limit = 30) => { let t = 0; while (!f(art) && t < limit) { art.step(DT); t += DT; } return t; };

// A 2D context that records what is drawn and rejects anything that is not a finite number.
function fakeCtx() {
  const calls = { fill: 0, fillRect: 0 };
  const finite = (...v) => v.forEach(x => assert.ok(Number.isFinite(x), `non-finite coordinate ${x}`));
  return {
    calls, globalAlpha: 1, fillStyle: '',
    clearRect() {}, beginPath() {}, closePath() {},
    moveTo: finite, lineTo: finite,
    fill() { calls.fill++; },
    fillRect(...v) { finite(...v); calls.fillRect++; },
  };
}

test('plays the whole animation, then fades out, once loading is done', () => {
  const art = make();
  art.setProgress(0.3);
  until(art, a => a.anim >= 1);
  assert.equal(art.fade, -1, 'no fade before loading finishes');
  art.setReady();
  const t = until(art, a => a.done);
  assert.ok(art.done);
  assert.ok(t > 2 && t < 2.5, `fade took ${t.toFixed(2)} s`); // the bar over 1 s, the rest over the next
});

test('loading racing ahead doubles the speed, as the mod does', () => {
  const slow = make(), fast = make();
  slow.setProgress(0.3); fast.setProgress(0.7);
  const ts = until(slow, a => a.anim >= 1), tf = until(fast, a => a.anim >= 1);
  assert.ok(Math.abs(ts - 1.6) < 0.05, `normal pace ${ts}`);
  assert.ok(Math.abs(tf - 0.8) < 0.05, `double pace ${tf}`);
});

test('finished loading holds the bar at 90% until the animation is through', () => {
  const art = make();
  art.setReady();
  let maxBefore = 0;
  while (art.anim < 1) { art.step(DT); maxBefore = Math.max(maxBefore, art.shown); }
  assert.ok(maxBefore <= 0.9 + 1e-9, `bar reached ${maxBefore}`);
  until(art, a => a.shown > 0.95 || a.done);
});

test('the subtitle only appears once the bar passes 80%', () => {
  const art = make();
  art.setProgress(0.5);
  until(art, () => false, 3);
  assert.equal(art.sub, 0);
  art.setProgress(1);
  until(art, a => a.sub >= 1, 5);
  assert.equal(art.sub, 1);
});

test('draws finite geometry at every moment, and nothing once faded', () => {
  const art = make(), ctx = fakeCtx();
  art.setProgress(0.5);
  for (let i = 0; i < 120; i++) { art.step(DT); art.draw(ctx); }
  assert.ok(ctx.calls.fill > 0 && ctx.calls.fillRect > 0);
  art.setReady();
  until(art, a => a.done);
  const after = fakeCtx(); art.draw(after);
  assert.equal(after.calls.fill + after.calls.fillRect, 0);
});

test('reduced motion starts with the letters already in place', () => {
  const art = make({ reduced: true });
  assert.equal(art.anim, 1);
  art.setReady();
  assert.ok(until(art, a => a.done) < 2.5);
});

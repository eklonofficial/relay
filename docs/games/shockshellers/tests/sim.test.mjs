// The simulation reproduces the GDD's numbers: movement feel, hit-angle damage, spread recovery,
// reload timings, grenade charge, streak power-ups, pickups and spawn protection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { Builder, MAT } = await load('maps/dsl.js');
const { stepBody, makeBody } = await load('sim/movement.js');
const { Match, angleMultiplier } = await load('sim/match.js');
const { makeHands, stepHands, currentSpread } = await load('sim/combat.js');
const { CTRL, WEAPONS, PLAYER } = await load('sim/tuning.js');

// A flat 30×30 floor (top at y = 1) with a few test features.
function flat(extra) {
  const b = new Builder(30, 8, 30);
  b.fill(0, 0, 0, 29, 0, 29, 'block', MAT.stone);
  extra?.(b);
  for (let i = 0; i < 4; i++) b.spawn(3 + i * 6, 1, 3);
  return b.finish({ id: 'test', name: 'Test', maxPlayers: 8, modes: { ffa: true } });
}
const run = (grid, body, ctrl, n) => { for (let i = 0; i < n; i++) stepBody(grid, body, typeof ctrl === 'function' ? ctrl(i) : ctrl); };

// The GDD's derived 0.0444 is the stored velocity after friction (what bloom reads: 0.0444 × 14.41 ≈ 0.64);
// following its pseudo-code, each tick's displacement is that plus one tick of acceleration.
test('top run speed: velocity 0.0444 u/tick (bloom ≈ 0.64), half that aiming, and diagonals are not faster', () => {
  const { grid } = flat();
  const b = makeBody(15, 1, 15); run(grid, b, CTRL.up, 60);
  assert.ok(Math.abs(Math.hypot(b.vx, b.vz) - 0.0444) < 0.002, `${Math.hypot(b.vx, b.vz)}`);
  assert.ok(Math.abs(Math.hypot(b.vx, b.vz) * 14.41 - 0.64) < 0.03);
  const d = makeBody(15, 1, 15); run(grid, d, CTRL.up | CTRL.right, 60);
  assert.ok(Math.abs(Math.hypot(d.vx, d.vz) - 0.0444) < 0.002);
  const a = makeBody(15, 1, 15); for (let i = 0; i < 60; i++) stepBody(grid, a, CTRL.up, { ads: true });
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - 0.0222) < 0.002);
});

test('sprinting (double-tapped forward) runs 1.4 times as fast, only forwards and never while aiming', () => {
  const { grid } = flat();
  const s = makeBody(15, 1, 15); run(grid, s, CTRL.up | CTRL.sprint, 60);
  assert.ok(Math.abs(Math.hypot(s.vx, s.vz) - 0.0444 * PLAYER.sprintMult) < 0.003, `${Math.hypot(s.vx, s.vz)}`);
  const back = makeBody(15, 1, 15); run(grid, back, CTRL.down | CTRL.sprint, 60);
  assert.ok(Math.abs(Math.hypot(back.vx, back.vz) - 0.0444) < 0.002, 'no sprinting backwards');
  const a = makeBody(15, 1, 15); for (let i = 0; i < 60; i++) stepBody(grid, a, CTRL.up | CTRL.sprint, { ads: true });
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - 0.0222) < 0.002, 'aiming walks');
});

test('a jump rises about 0.7 units, lasts about 22 ticks, and cannot climb a full block', () => {
  const { grid } = flat(b => b.fill(15, 1, 10, 15, 1, 10, 'block'));
  const b = makeBody(5, 1, 5); run(grid, b, 0, 5);
  let top = 0, air = 0;
  stepBody(grid, b, CTRL.jump);
  for (let i = 0; i < 60; i++) { stepBody(grid, b, CTRL.jump); top = Math.max(top, b.y - 1); if (b.y > 1.0001) air++; }
  assert.ok(top > 0.65 && top < 0.8, `apex ${top}`);
  assert.ok(air >= 19 && air <= 25, `airtime ${air}`);
  // Running and jumping into a 1-high block never gets on top of it.
  const c = makeBody(15.5, 1, 13);
  run(grid, c, i => CTRL.up | (i % 25 === 0 ? CTRL.jump : 0), 200);
  assert.ok(c.y < 1.5 && c.z > 10.9, `${c.y} ${c.z}`);
});

test('stairs and slabs are walked up without jumping; a ladder climbs a wall', () => {
  const { grid } = flat(b => { b.stairs(10, 1, 10, 3, 0, 1); b.fill(10, 1, 13, 10, 3, 15, 'block'); b.fill(20, 1, 10, 22, 4, 10, 'block'); b.ladder(21, 1, 9, 4, 0); });
  const b = makeBody(10.5, 1, 8.5); b.yaw = Math.PI; // facing +z
  run(grid, b, CTRL.up, 120);
  assert.ok(b.y > 3.9, `climbed stairs to ${b.y}`);
  const l = makeBody(21.5, 1, 8.2); l.yaw = Math.PI;
  run(grid, l, CTRL.up, 200);
  assert.ok(l.y > 4.9, `climbed ladder to ${l.y}`);
});

test('coyote time and the jump buffer', () => {
  const { grid } = flat(b => b.fill(10, 1, 10, 12, 3, 12, 'block'));
  // Walk off the edge, press jump 3 ticks later: still jumps.
  const b = makeBody(11, 4, 12.6); b.yaw = Math.PI; run(grid, b, 0, 4);
  let t = 0; while (b.onGround === 4 && t++ < 60) stepBody(grid, b, CTRL.up);
  stepBody(grid, b, CTRL.up); stepBody(grid, b, CTRL.up);
  const y0 = b.y; stepBody(grid, b, CTRL.up | CTRL.jump);
  assert.ok(b.vy > 0.05 || b.y > y0, 'coyote jump');
  // Press jump 8 ticks before landing: jumps on landing.
  const c = makeBody(5, 2.2, 5); c.vy = 0;
  let pressedAt = -1, jumped = false;
  for (let i = 0; i < 40; i++) {
    const near = c.y - 1 < 0.35 && pressedAt < 0 && c.vy < 0;
    if (near) pressedAt = i;
    stepBody(grid, c, near ? CTRL.jump : 0);
    if (pressedAt >= 0 && c.vy > 0.05) { jumped = true; break; }
  }
  assert.ok(jumped, 'buffered jump');
});

test('hit-angle damage table', () => {
  const off = f => angleMultiplier(Math.sqrt(1 - f * f));
  assert.ok(Math.abs(off(0) - 1) < 1e-9);
  assert.ok(Math.abs(off(0.25) - 0.88) < 0.03, `${off(0.25)}`);
  assert.ok(Math.abs(off(0.5) - 0.59) < 0.04, `${off(0.5)}`);
  assert.ok(Math.abs(off(0.75) - 0.26) < 0.04, `${off(0.75)}`);
  assert.ok(off(0.95) < 0.06, `${off(0.95)}`);
});

test('bloom grows per shot and recovers starting about 9 ticks after the last shot', () => {
  const body = makeBody(0, 0, 0), h = makeHands('yolk47', 5);
  const w = WEAPONS.yolk47;
  let prev = 0;
  for (let i = 0; i < 4; i++) stepHands(h, body, i === 0 ? CTRL.fire : CTRL.fire, prev = i ? CTRL.fire : 0, false);
  const peak = currentSpread(h);
  assert.ok(peak > w.acc[0] + w.acc[2] * 0.9, `${peak}`);
  const series = [];
  for (let i = 0; i < 20; i++) { stepHands(h, body, 0, i ? 0 : CTRL.fire, false); series.push(currentSpread(h)); }
  const firstDrop = series.findIndex((s, i) => i > 0 && s < series[i - 1] - 1e-9);
  assert.ok(firstDrop >= 6 && firstDrop <= 10, `recovery starts at ${firstDrop}`);
  assert.ok(series.at(-1) < peak);
});

test('reload timings: empty reload 205 → 3.42 s; tactical reload is faster', () => {
  const body = makeBody(0, 0, 0), h = makeHands('yolk47', 5);
  h.slots[0].mag = 0;
  let ticks = 0, prev = 0;
  stepHands(h, body, CTRL.reload, prev, false); ticks++;
  while (h.reload > 0 && ticks < 500) { stepHands(h, body, 0, CTRL.reload, false); ticks++; }
  assert.ok(Math.abs(ticks - 205 / 2) <= 1.5, `${ticks}`);
  assert.equal(h.slots[0].mag, 30);
  assert.equal(h.slots[0].store, 210);
  h.slots[0].mag = 10; ticks = 0;
  stepHands(h, body, CTRL.reload, 0, false); ticks++;
  while (h.reload > 0 && ticks < 500) { stepHands(h, body, 0, CTRL.reload, false); ticks++; }
  assert.ok(Math.abs(ticks - 160 / 2) <= 1.5, `${ticks}`);
});

test('Tri-Boil fires one 3-round burst per click; Poacher reloads after every shot', () => {
  const body = makeBody(0, 0, 0), t = makeHands('triBoil', 3);
  let shots = 0;
  for (let i = 0; i < 40; i++) shots += stepHands(t, body, CTRL.fire, i ? CTRL.fire : 0, false).shots.length;
  assert.equal(shots, 3);
  const p = makeHands('poacher', 3);
  stepHands(p, body, CTRL.fire, 0, false);
  assert.equal(p.slots[0].mag, 0);
  for (let i = 0; i < 30; i++) stepHands(p, body, i === 10 ? CTRL.fire : 0, i === 11 ? CTRL.fire : 0, false);
  assert.ok(p.reload > 0 || p.slots[0].mag === 1, 'clicking empty starts the reload');
});

test('grenade reaches full charge after about 38 ticks; a tap drops it near your feet', () => {
  const body = makeBody(0, 0, 0), h = makeHands('yolk47', 3);
  let ev, prev = 0, n = 0;
  stepHands(h, body, CTRL.grenade, prev, false);
  while (h.power < 1 && n < 100) { stepHands(h, body, CTRL.grenade, CTRL.grenade, false); n++; }
  assert.ok(n >= 35 && n <= 40, `${n}`);
  ev = stepHands(h, body, 0, CTRL.grenade, false);
  assert.equal(ev.thrown, 1);
  assert.equal(h.grenades, 0);
});

// Two eggs facing each other on a flat floor.
function duel(primary = 'yolk47') {
  const map = flat();
  const m = new Match(map, { seed: 7 });
  const a = m.addPlayer({ id: 1, name: 'A', primary }), b = m.addPlayer({ id: 2, name: 'B' });
  m.spawn(a); m.spawn(b);
  Object.assign(a.body, { x: 15, y: 1, z: 20 }); Object.assign(b.body, { x: 15, y: 1, z: 15 });
  a.spawnShield = 0; b.spawnShield = 0;
  return { m, a, b };
}

test('a centred Poacher shot kills; spawn shield blocks damage and firing; regen after 2 s', () => {
  const { m, a, b } = duel('poacher');
  m.setInput(1, CTRL.fire, 0, Math.atan2((1 + 0.3) - (1 + 0.3), 5));
  m.step(); for (let i = 0; i < 5; i++) { m.setInput(1, 0, 0, 0); m.step(); }
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1); assert.equal(a.streak, 1);
  // Shielded target takes nothing.
  const d = duel('yolk47'); d.b.spawnShield = 100;
  d.m.setInput(1, CTRL.fire, 0, 0); for (let i = 0; i < 6; i++) d.m.step();
  assert.equal(d.b.hp, 100);
  // A shielded shooter cannot fire.
  const e = duel('yolk47'); e.a.spawnShield = 100;
  e.m.setInput(1, CTRL.fire, 0, 0); e.m.step();
  assert.equal(e.a.hands.slots[0].mag, 30);
  // Regeneration waits 2 s after the last damage, then 3 HP/s.
  const r = duel(); r.b.hp = 50; r.b.lastHurt = r.m.tick;
  for (let i = 0; i < 59; i++) r.m.step();
  assert.equal(r.b.hp, 50);
  for (let i = 0; i < 31; i++) r.m.step();
  assert.ok(r.b.hp > 52 && r.b.hp < 54, `${r.b.hp}`);
});

test('bullets are projectiles: they take time to arrive and vanish at max range', () => {
  // The Cage Free's round flies 1.75 u/tick: at 9 units it lands on the 6th tick, not the first.
  const { m, b } = duel('cageFree');
  Object.assign(b.body, { x: 15, y: 1, z: 20 - 9 }); b.hp = 50;
  m.setInput(1, CTRL.fire, 0, 0); m.step();
  assert.equal(Math.round(b.hp), 50, 'not hit on the firing tick at 9 units with velocity 1.75 (hp ' + b.hp + ')');
  m.setInput(1, 0, 0, 0); for (let i = 0; i < 6; i++) m.step();
  assert.equal(b.alive, false);
  // The live Crackshot's round (velocity 17) is all but instant: 9 units in one tick.
  const q = duel('poacher');
  Object.assign(q.b.body, { x: 15, y: 1, z: 20 - 9 });
  q.m.setInput(1, CTRL.fire, 0, 0); q.m.step();
  assert.equal(q.b.alive, false);
  const p = duel('yolk47');
  Object.assign(p.a.body, { z: 28 }); Object.assign(p.b.body, { x: 15, y: 1, z: 2 }); // 26 units > Yolk-47 range 20
  p.m.setInput(1, CTRL.fire, 0, 0); for (let i = 0; i < 30; i++) p.m.step();
  assert.equal(p.b.hp, 100);
});

test('streak power-ups: Hard Boiled at 5, Shell Breaker at 10', () => {
  const { m, a } = duel();
  for (let i = 0; i < 10; i++) {
    const v = m.addPlayer({ id: 10 + i, name: 'V' + i }); m.spawn(v); v.spawnShield = 0;
    m.kill(v, a, 'yolk47');
    if (i === 4) assert.equal(a.shield, 100);
  }
  assert.equal(a.streak, 10);
  assert.ok(a.power.shellBreaker > 0);
});

test('pickups refill the held weapon reserve and respawn later', () => {
  const map = flat(b => b.item('ammo', 15, 1, 20));
  const m = new Match(map, { seed: 3 });
  const a = m.addPlayer({ id: 1, name: 'A' }); m.spawn(a);
  Object.assign(a.body, { x: 15.5, y: 1, z: 20.5 });
  a.hands.slots[0].store = 0;
  m.step();
  assert.equal(a.hands.slots[0].store, 30);
  assert.equal(m.items[0].active, false);
  Object.assign(a.body, { x: 5.5, z: 5.5 }); // step off it, or it is collected again on respawn
  for (let i = 0; i < 600; i++) m.step();
  assert.equal(m.items[0].active, true);
});

test('explosions hurt the thrower but never teammates', () => {
  const map = flat();
  const m = new Match(map, { mode: 'teams', seed: 2 });
  const a = m.addPlayer({ id: 1, name: 'A', team: 1 }), mate = m.addPlayer({ id: 2, name: 'B', team: 1 }), foe = m.addPlayer({ id: 3, name: 'C', team: 2 });
  for (const p of [a, mate, foe]) { m.spawn(p); p.spawnShield = 0; }
  Object.assign(a.body, { x: 10, y: 1, z: 10 }); Object.assign(mate.body, { x: 10.5, y: 1, z: 10 }); Object.assign(foe.body, { x: 11, y: 1, z: 10 });
  m.explode(10.5, 1.3, 10, 150, 3, a, 'grenade', null);
  assert.equal(mate.hp, 100);
  assert.ok(a.hp < 100);
  assert.ok(foe.hp < 100);
});

test('the match is deterministic for identical inputs', () => {
  const runOnce = () => {
    const { m, a, b } = duel('beater');
    for (let i = 0; i < 120; i++) { m.setInput(1, (i % 20 < 10 ? CTRL.fire : 0) | CTRL.left, 0.02 * Math.sin(i), 0); m.setInput(2, CTRL.right | (i % 7 === 0 ? CTRL.jump : 0), Math.PI, 0); m.step(); }
    return [a.body.x, a.body.z, b.body.x, b.hp, a.hands.seed, m.tick].map(v => +v.toFixed(6));
  };
  assert.deepEqual(runOnce(), runOnce());
});

test('Hen House: an egg walks up the stairwell to the gallery (headroom through the floor above)', async () => {
  const { Match } = await load('sim/match.js'), { getMap } = await load('maps/index.js'), { CTRL } = await load('sim/tuning.js');
  const m = new Match(getMap('henhouse'), { mode: 'ffa', seed: 1 }), p = m.addPlayer({ id: 1, name: 'A' });
  for (let i = 0; i < 5; i++) m.step();
  Object.assign(p.body, { x: 19.9, y: 1, z: 11.5, vx: 0, vy: 0, vz: 0 }); p.alive = true; p.spawnShield = 1e9;
  for (let t = 0; t < 120; t++) { m.setInput(1, CTRL.up, 0, 0); m.step(); }
  assert.ok(p.body.y >= 3.9 && p.body.z < 7, `stuck at ${p.body.x.toFixed(2)},${p.body.y.toFixed(2)},${p.body.z.toFixed(2)}`);
});

// A long flat floor for range checks: shooter at z 66 looking down -z, target `dist` in front.
function range(primary, dist, seed = 7) {
  const b = new Builder(70, 12, 70); b.fill(0, 0, 0, 69, 0, 69, 'block', MAT.stone); b.spawn(3, 1, 3);
  const m = new Match(b.finish({ id: 'r', name: 'R', maxPlayers: 8, modes: { ffa: true } }), { seed });
  const a = m.addPlayer({ id: 1, name: 'A', primary }), t = m.addPlayer({ id: 2, name: 'B' });
  m.spawn(a); m.spawn(t); Object.assign(a.body, { x: 35, y: 1, z: 66 }); Object.assign(t.body, { x: 35, y: 1, z: 66 - dist }); a.spawnShield = t.spawnShield = 0;
  return { m, a, t };
}
const fireOnce = (m, ticks = 40, pitch = 0) => { m.setInput(1, CTRL.fire, 0, pitch); m.step(); for (let i = 0; i < ticks; i++) { m.setInput(1, 0, 0, pitch); m.step(); } };
const avgDamage = (primary, dist, n = 12) => { let s = 0; for (let k = 1; k <= n; k++) { const { m, t } = range(primary, dist, k); t.hp = 1e4; fireOnce(m); s += 1e4 - t.hp; } return s / n; };

test('Double Yolker: cracks an egg point blank, but fades fast with distance (no two-shots at range)', () => {
  assert.ok(avgDamage('doubleYolker', 1.5) >= 100, 'one shot point blank');
  assert.ok(avgDamage('doubleYolker', 3) >= 100, 'one shot at 3 units');
  assert.ok(avgDamage('doubleYolker', 6) < 34, 'three or more shots at 6 units');
  assert.ok(avgDamage('doubleYolker', 8) < 12, 'useless at 8 units');
});

test('Yolkzooka: hits harder the further it flies; blasts throw eggs; rocket jumps never hurt the shooter', () => {
  const near = avgDamage('yolkzooka', 3, 1), far = avgDamage('yolkzooka', 25, 1);
  assert.ok(near < 70 && far > 100, `direct hit ${near} close, ${far} far`);
  // A rocket into the floor in front of an egg: splash (less than a direct hit) and a moderate throw.
  const k = range('yolkzooka', 4); const x0 = k.t.body.x, z0 = k.t.body.z; let up = 0;
  const pitch = -Math.atan2(0.4, 3);
  k.m.setInput(1, CTRL.fire, 0, pitch); k.m.step(); for (let i = 0; i < 80; i++) { k.m.setInput(1, 0, 0, pitch); k.m.step(); up = Math.max(up, k.t.body.y - 1); }
  const thrown = Math.hypot(k.t.body.x - x0, k.t.body.z - z0);
  assert.ok(k.t.alive && k.t.hp < 100 && k.t.hp > 50, `splash leaves ${k.t.hp}`);
  assert.ok(thrown > 1.5 && thrown < 6 && up > 0.2 && up < 1.5, `thrown ${thrown} sideways, ${up} up`);
  // Rocket jump: jump, fire at your feet: launched well above a jump, unhurt.
  const j = range('yolkzooka', 30); let peak = 0;
  j.m.setInput(1, CTRL.jump, 0, 0); j.m.step(); for (let i = 0; i < 3; i++) { j.m.setInput(1, 0, 0, 0); j.m.step(); }
  j.m.setInput(1, CTRL.fire, 0, -1.5); j.m.step(); for (let i = 0; i < 60; i++) { j.m.setInput(1, 0, 0, -1.5); j.m.step(); peak = Math.max(peak, j.a.body.y - 1); }
  assert.equal(j.a.hp, 100); assert.ok(peak > 2.5, `rocket jump peak ${peak}`);
  // Firing shoves the shooter back a little; their aim doesn't move.
  const r = range('yolkzooka', 30), z0r = r.a.body.z; fireOnce(r.m, 30);
  assert.ok(r.a.body.z - z0r > 0.2 && r.a.body.z - z0r < 1); assert.equal(r.a.body.yaw, 0); assert.equal(r.a.body.pitch, 0);
});

test('Peck 9mm: four or five hits crack an egg at any range', () => {
  for (const d of [3, 30, 50]) {
    const { m, a, t } = range('peck9mm', d); a.hands.cur = 1;
    let hits = 0, hp = t.hp;
    for (let n = 0; n < 40 && t.alive; n++) { fireOnce(m, 12); if (t.hp < hp || !t.alive) hits++; hp = t.hp; a.hands.slots[1].mag = 15; }
    assert.ok(!t.alive && hits >= 4 && hits <= 5, `${d} units: ${hits} hits, alive ${t.alive}`);
  }
});

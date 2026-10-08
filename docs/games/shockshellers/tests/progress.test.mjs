// Scoring and progress: points for how a player does (kills, streaks, assists, the objective), the
// eggs they earn, and what eggs unlock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { Builder, MAT } = await load('maps/dsl.js');
const { Match } = await load('sim/match.js');
const { SCORE, ECONOMY, WEAPON_IDS, PRIMARIES } = await load('sim/tuning.js');
const { WEAPON_UNLOCK, TIERS, skinTier, eggsFor, unlocked, eggsForPoints } = await load('game/progress.js');
const { SKIN_COUNTS } = await load('game/cosmetics.js');

function arena(mode = 'ffa') {
  const b = new Builder(30, 8, 30); b.fill(0, 0, 0, 29, 0, 29, 'block', MAT.stone); for (let i = 0; i < 4; i++) b.spawn(3 + i * 6, 1, 3);
  const map = b.finish({ id: 't', name: 'T', maxPlayers: 8, modes: { ffa: true, teams: true, spatula: true } });
  const m = new Match(map, { seed: 5, mode });
  const ps = [1, 2, 3, 4].map(id => m.addPlayer({ id, name: 'P' + id }));
  ps.forEach(p => m.spawn(p));
  return { m, ps };
}
const hit = (m, q, n, from, w = 'yolk47') => m.damage(q, n, from, w, { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 1 });

test('a kill scores, more on a streak; dying keeps your score', () => {
  const { m, ps: [a, b, c, d] } = arena();
  b.spawnShield = c.spawnShield = d.spawnShield = 0;
  hit(m, b, 200, a);
  assert.equal(a.score, SCORE.kill);
  hit(m, c, 200, a);
  assert.equal(a.score, 2 * SCORE.kill + SCORE.streakStep, 'second kill in a streak');
  a.spawnShield = 0; hit(m, a, 200, d);
  assert.equal(a.score, 2 * SCORE.kill + SCORE.streakStep, 'dying doesn’t wipe the round score');
  assert.equal(a.streak, 0);
  const pts = m.events.filter(e => e.t === 'points');
  assert.deepEqual(pts.map(e => [e.id, e.n, e.why]), [[1, 100, 'kill'], [1, 110, 'kill'], [4, 100, 'kill']]);
});

test('the streak bonus is capped, and a whisk kill earns a little more', () => {
  const { m, ps: [a, b] } = arena();
  for (let i = 0; i < 9; i++) { b.alive = true; b.hp = 100; b.spawnShield = 0; hit(m, b, 200, a); }
  assert.equal(a.score, 9 * SCORE.kill + [0, 1, 2, 3, 4, 5, 5, 5, 5].reduce((s, k) => s + Math.min(SCORE.streakMax, k * SCORE.streakStep), 0));
  const before = a.score; b.alive = true; b.hp = 100; b.spawnShield = 0; hit(m, b, 200, a, 'melee');
  assert.equal(a.score - before, SCORE.kill + SCORE.streakMax + SCORE.melee);
});

test('an assist for anyone else who did enough of the damage, only once per life', () => {
  const { m, ps: [a, b, c, d] } = arena();
  c.spawnShield = 0;
  hit(m, c, SCORE.assistMin, b); hit(m, c, 10, d);   // b did enough, d didn't
  hit(m, c, 200, a);
  assert.equal(b.score, SCORE.assist); assert.equal(b.assists, 1);
  assert.equal(d.score, 0);
  assert.equal(c.hurtBy.size, 0, 'cleared with the death');
});

test('carrying the spatula and taking it score objective points', () => {
  const { m, ps: [a] } = arena('spatula');
  const s = m.mode.spat;
  Object.assign(s, { x: a.body.x, y: a.body.y + 0.3, z: a.body.z, vx: 0, vy: 0, vz: 0, rest: true });
  for (let i = 0; i < 31; i++) m.step();
  assert.equal(s.carrier, a.id);
  const obj = m.events.filter(e => e.t === 'points' && e.id === a.id && e.why === 'objective').reduce((n, e) => n + e.n, 0);
  assert.equal(obj, SCORE.spatulaTake + SCORE.objPerSecond, 'took it, then held it a second');
});

test('eggs come from points, carried exactly across awards, doubled when doubling applies', () => {
  const ledger = {};
  assert.equal(eggsForPoints(ledger, 105), 10);
  assert.equal(eggsForPoints(ledger, 5), 1, 'the leftover 5 points count');
  assert.equal(eggsForPoints(ledger, 3), 0);
  assert.equal(eggsForPoints(ledger, 100, 2), 20);
  assert.equal(ECONOMY.pointsPerEgg, 10);
  assert.ok(ECONOMY.place[0] > ECONOMY.place[1] && ECONOMY.place[1] > ECONOMY.place[2]);
});

test('unlocks: every weapon is free, every skin has a rarity, and eggs are never taken back', () => {
  assert.deepEqual(Object.keys(WEAPON_UNLOCK).sort(), [...WEAPON_IDS].sort());
  for (const id of WEAPON_IDS) assert.equal(WEAPON_UNLOCK[id], 0, `${id} is free`);
  for (let i = 1; i < TIERS.length; i++) assert.ok(TIERS[i].eggs > TIERS[i - 1].eggs);
  for (const id of WEAPON_IDS) {
    assert.equal(skinTier(id, 0), 0, `${id}: its standard finish is free`);
    const tiers = Array.from({ length: SKIN_COUNTS[id] }, (_, i) => skinTier(id, i));
    assert.ok(tiers.every(t => Number.isInteger(t) && t >= 0 && t < TIERS.length), id);
    assert.ok(tiers.filter(t => t === TIERS.length - 1).length >= 3, `${id} has legendary skins to earn`);
  }
  const fresh = { coins: 0, owned: [] }, rich = { coins: 1e6, owned: [] };
  assert.equal(unlocked(fresh, 'weapon', 'yolkzooka'), true);
  const legendary = SKIN_COUNTS.yolk47 && Array.from({ length: SKIN_COUNTS.yolk47 }, (_, i) => i).find(i => skinTier('yolk47', i) === TIERS.length - 1);
  assert.equal(unlocked(fresh, 'skin', legendary, 'yolk47'), false); assert.equal(unlocked(rich, 'skin', legendary, 'yolk47'), true);
  assert.equal(unlocked({ coins: 0, owned: ['hat:crown'] }, 'hat', 'crown'), true, 'bought before eggs stopped being spent');
  assert.equal(eggsFor('pattern', 'camo'), 0);
});

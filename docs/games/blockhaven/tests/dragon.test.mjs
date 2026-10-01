import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { dragonInit, dragonAI, dragonDamage, dragonDying, dragonHead, dragonCrystalLost } = await load('entity/dragon.js');
const { B } = await load('data/blocks.js');

// A tiny stand-in for the game: flat end stone at y 62, one player, a list of entities.
function fakeGame(seed = 1) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const g = {
    entities: { list: [], add(e) { this.list.push(e); return e; }, near(p, r, f) { return this.list.filter(e => !e.dead && Math.abs(e.pos[0] - p[0]) < r && Math.abs(e.pos[2] - p[2]) < r && (!f || f(e))); } },
    world: { heightAt: () => 62, getBlock: () => B.AIR },
    particles: { fx() {}, explosion() {} }, sound: { play() {}, mob() {} },
    rules: { mobGriefing: false }, alive: true, dragonKilled: false, xp: 0,
    spawnXp(p, n) { this.xp += n; }, onDragonDeath() { this.portal = true; },
    player: { eyePos: () => [20, 64.6, 0] }, lookDir: () => [-1, 0, 0],
  };
  g.playerEntity = { pos: [20, 63, 0], h: 1.8, isLiving: true, hurt(a) { g.hurtTaken = (g.hurtTaken || 0) + a; return true; }, vel: [0, 0, 0] };
  return { g, rand };
}
function fakeDragon(g) {
  const m = {
    game: g, mobType: 'ender_dragon', pos: [0, 100, 0], vel: [0, 0, 0], yaw: 0, bodyYaw: 0, health: 200, maxHealth: 200, scale: 1, deathT: 0,
    get focus() { return g.playerEntity; }, playerTargetable: () => true, canSee: () => true,
    distTo(p) { return Math.hypot(p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]); },
    hurt(a, src) { const d = dragonDamage(this, a, src); this.health -= d; return d > 0; },
  };
  dragonInit(m);
  return m;
}

test('the dragon circles, strafes with fireballs, lands, breathes and takes off again', async () => {
  const { g, rand } = fakeGame();
  const real = Math.random; Math.random = rand;
  try {
    const m = fakeDragon(g), seen = new Set(), want = ['holding', 'strafe', 'landing_approach', 'landing', 'scanning', 'roar', 'flame', 'takeoff'];
    for (let t = 0, extra = 0; t < 900 && extra < 2; t += 0.05) {
      if (want.every(p => seen.has(p))) extra += 0.05;
      dragonAI(m, 0.05);
      m.pos[0] += m.vel[0] * 0.05; m.pos[1] += m.vel[1] * 0.05; m.pos[2] += m.vel[2] * 0.05;
      seen.add(m.phase);
    }
    for (const p of want) assert.ok(seen.has(p), `never entered ${p}: ${[...seen]}`);
    assert.ok(g.entities.list.some(e => e.kind === 'dragon_fireball'), 'shot a fireball');
    assert.ok(g.entities.list.some(e => e.breath), 'left a cloud of breath');
  } finally { Math.random = real; }
});

test('head hits do full damage, body hits a quarter; perched it ignores arrows', () => {
  const { g } = fakeGame();
  const m = fakeDragon(g);
  m.pos = [0, 63, 0];
  const h = dragonHead(m);
  assert.equal(dragonDamage(m, 20, { kind: 'projectile', attacker: g.playerEntity, projectile: { pos: h } }), 20);
  assert.equal(dragonDamage(m, 20, { kind: 'projectile', attacker: g.playerEntity, projectile: { pos: [0, 64, 6] } }), 6);
  assert.equal(dragonDamage(m, 20, { kind: 'explosion', attacker: null }), 0, 'only player-caused blasts hurt it');
  m.phase = 'scanning';
  assert.equal(dragonDamage(m, 20, { kind: 'projectile', attacker: g.playerEntity, projectile: { pos: h } }), 0);
});

test('crystals heal it, and losing the healing crystal costs 10 health', () => {
  const { g } = fakeGame();
  const m = fakeDragon(g);
  m.health = 100;
  const c = { type: 'end_crystal', pos: [10, 100, 0], dead: false };
  g.entities.add(c);
  for (let i = 0; i < 40; i++) dragonAI(m, 0.05);
  assert.ok(m.health > 100 && m.beam === c, `healed to ${m.health}`);
  const before = m.health;
  g.entities.list.push(m);
  c.dead = true;
  dragonCrystalLost(g, c, g.playerEntity);
  assert.equal(m.health, before - 10);
});

test('dying takes ten seconds, sheds 12000 experience the first time, then opens the portal', () => {
  const { g } = fakeGame();
  const m = fakeDragon(g);
  m.deathT = 0.001;
  while (!m.dead) { m.deathT += 0.05; dragonDying(m, 0.05); }
  assert.ok(m.deathT >= 10 && m.deathT < 10.1);
  assert.ok(g.xp >= 11000 && g.xp <= 12000, `xp ${g.xp}`);
  assert.ok(g.portal);
});

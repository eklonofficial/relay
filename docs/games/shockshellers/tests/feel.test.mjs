// Aim assist (subtle: friction and partial tracking, only near the crosshair, only on visible
// enemies, only while the player is giving input) and the cosmetics catalogue (every id the shop
// offers can be drawn, and anything else from the network falls back to a default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { aimAssist, assistOn, ASSIST, ASSIST_BY_GUN } = await load('game/aim.js');
const { COLORS, PATTERNS, STAMPS, HATS, SKIN_COUNTS, NATURAL, sanitizeCosmetics, botCosmetics } = await load('game/cosmetics.js');
const { PATTERN_IDS } = await load('render/shellart.js');
const { HAT_IDS } = await load('render/hats.js');
const { ASSETS, HAT_NODES, WEAPON_ASSETS } = await load('render/asset-catalog.js');
const { WEAPON_IDS } = await load('sim/tuning.js');

const cam = { x: 0, y: 1, z: 0, yaw: 0, pitch: 0 };
const at = (d, angle, id = 1) => ({ id, x: -Math.sin(angle) * d, y: 1, z: -Math.cos(angle) * d });

test('aim assist only acts near the crosshair, and slows the look most on the target itself', () => {
  assert.equal(aimAssist({}, cam, [at(10, 0.4)], 1 / 60).slow, 1, 'well off the crosshair: nothing');
  assert.equal(aimAssist({}, cam, [at(ASSIST.range + 5, 0)], 1 / 60).slow, 1, 'out of range: nothing');
  const on = aimAssist({}, cam, [at(10, 0)], 1 / 60), near = aimAssist({}, cam, [at(10, 0.03)], 1 / 60);
  assert.ok(on.slow < near.slow && near.slow < 1, `${on.slow} < ${near.slow} < 1`);
  assert.ok(on.slow >= 1 - ASSIST.slow - 1e-9, 'never more than the friction cap');
  assert.equal(aimAssist({}, cam, [{ ...at(10, 0), visible: () => false }], 1 / 60).slow, 1, 'not through walls');
});

test('aim assist tracks part of a target sliding across the view, only while the player is active', () => {
  const dt = 1 / 60, w = 0.6;   // the target sweeps across at 0.6 rad/s
  for (const active of [true, false]) {
    const st = {}; let turned = 0;
    for (let i = 0; i < 30; i++) {
      const r = aimAssist(st, { ...cam, yaw: turned }, [at(8, -w * i * dt)], dt, { active });
      turned += r.dyaw;
    }
    if (active) {
      const target = -w * 29 * dt;
      assert.ok(turned < 0 && turned > target, `follows some of the way: turned ${turned.toFixed(3)} of ${target.toFixed(3)}`);
      assert.ok(Math.abs(turned) < Math.abs(target) * 0.75, 'but never all of it: the player still aims');
    } else assert.equal(turned, 0, 'idle players get no tracking');
  }
  const st = {}; aimAssist(st, cam, [at(8, 0)], dt, { active: true });
  assert.equal(aimAssist(st, cam, [at(8, 0.09)], dt, { active: true }).dyaw, 0, 'a jump (a respawn, a teleport) is ignored');
});

test('aim assist suits the gun: most help up close, a gentle pull on the snipers, no tracking for the Yolkzooka', () => {
  const near = gun => aimAssist({}, cam, [at(10, 0.04)], 1 / 60, { gun }).slow;
  assert.ok(near('doubleYolker') < near('yolk47') && near('yolk47') < near('poacher'), 'friction: shotgun > rifle > sniper');
  assert.equal(aimAssist({}, cam, [at(10, 0.09)], 1 / 60, { gun: 'poacher' }).slow, 1, "the sniper's cone is narrow");
  const st = {}; aimAssist(st, cam, [at(8, 0)], 1 / 60, { gun: 'yolkzooka', active: true });
  assert.ok(aimAssist(st, cam, [at(8, -0.01)], 1 / 60, { gun: 'yolkzooka', active: true }).dyaw === 0, 'the Yolkzooka is never turned for you');
  for (const g of Object.values(ASSIST_BY_GUN)) assert.ok(Math.min(0.4, ASSIST.slow * g.slow) <= 0.4 && g.cone * ASSIST.cone < 0.15, 'still subtle for every gun');
});

test('aim assist is on for Chromebooks and gamepads by default, and the setting wins', () => {
  assert.equal(assistOn('auto', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', false), true);
  assert.equal(assistOn('auto', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', false), false);
  assert.equal(assistOn('auto', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', true), true);
  assert.equal(assistOn('off', 'Mozilla/5.0 (X11; CrOS x86_64)', true), false);
  assert.equal(assistOn('on', 'Mozilla/5.0 (Windows NT 10.0)', false), true);
});

test('every cosmetic in the shop can be drawn, and most of it is free', () => {
  assert.ok(COLORS.length >= 30 && PATTERNS.length >= 15 && STAMPS.length >= 600 && HATS.length >= 600);
  for (const p of PATTERNS) assert.ok(p.id === 'none' || PATTERN_IDS.includes(p.id), p.id);
  for (const s of STAMPS) assert.ok(s.id === 'none' || ASSETS[`stamps/${s.id}.webp`], s.id);
  for (const h of HATS) assert.ok(h.id === 'none' || HAT_IDS.includes(h.id), h.id);
  assert.equal(new Set(HATS.map(h => h.id)).size, HATS.length, 'hat ids are unique');
  assert.deepEqual(new Set(HATS.filter(h => h.node !== undefined).map(h => h.node)), new Set(HAT_NODES), 'every imported hat is offered exactly once');
  for (const id of WEAPON_IDS) assert.equal(SKIN_COUNTS[id], WEAPON_ASSETS[id].skins.length, id);
  assert.ok(HATS.filter(h => !h.price).length >= HATS.length - 3, 'only a few hats cost yolks');
});

test('cosmetics from the network: known values pass, anything else falls back', () => {
  const ok = { color: 20, pcolor: 3, hat: 'wizard', pattern: 'camo', stamp: 'decal_0007', skins: { yolk47: 12, peck9mm: 3 } };
  assert.deepEqual(sanitizeCosmetics(ok), ok);
  assert.deepEqual(sanitizeCosmetics({ color: 999, pcolor: -1, hat: '<script>', pattern: 7, stamp: null, skins: { yolk47: 9999, poacher: -2, nope: 3, beater: '4' } }), { color: 0, pcolor: 13, hat: 'none', pattern: 'none', stamp: 'none', skins: {} });
  assert.deepEqual(sanitizeCosmetics(null), sanitizeCosmetics({}));
  assert.deepEqual(sanitizeCosmetics({ color: 3, hat: 'cap', skin: 'lava', stamp: 'googly' }), { color: 3, pcolor: 13, hat: 'cap', pattern: 'none', stamp: 'none', skins: {} }, 'old profiles keep what still exists');
  let s = 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) { const c = botCosmetics(rnd); assert.deepEqual(sanitizeCosmetics(c), c); assert.ok(NATURAL.includes(c.color) && c.hat === 'none' && c.pattern === 'none' && c.stamp === 'none', 'bots are plain eggs in natural colours'); }
});

test('PLAY moves around the map rotation instead of repeating the last few maps', async () => {
  const { pickPublicMap, MAPS } = await load('maps/index.js');
  let s = 3; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const recent = [];
  for (let i = 0; i < 60; i++) {
    const id = pickPublicMap('ffa', rnd, recent.slice(-4));
    assert.ok(!recent.slice(-4).includes(id), `${id} came up again within four plays`);
    recent.push(id);
  }
  assert.ok(new Set(recent).size >= 6, 'most of the rotation shows up');
  const roost = MAPS.filter(m => m.public && m.modes.includes('roost')).map(m => m.id);
  assert.ok(roost.includes(pickPublicMap('roost', rnd, roost.slice(0, -1))), 'with every map recent, it still picks one');
});

test('the kill replay finds the shot that cracked you and plays its flight in slow motion', async () => {
  const { Recorder, planReplay, replayRate, projectileAt } = await load('game/replay.js');
  const rec = new Recorder(), players = new Map([[1, { body: { x: 0, y: 1, z: 0, yaw: 0, pitch: 0 }, alive: true }], [2, { body: { x: 0, y: 1, z: -6, yaw: Math.PI, pitch: 0 }, alive: true }]]);
  for (let t = 0; t <= 60; t++) rec.record({ tick: t, players });
  rec.shot(40, { id: 2, x: 0, y: 1.4, z: -6, dx: 1, dy: 0, dz: 0, w: 'yolk47' });                 // a miss, off to the side
  rec.shot(56, { id: 2, x: 0, y: 1.4, z: -6, dx: 0, dy: -0.016, dz: 0.9999, w: 'yolk47' });     // the one that hit
  const P = planReplay(rec, 2, 60, 'yolk47', 1.5, [0, 1.3, 0]);
  assert.equal(P.shotTick, 56);
  assert.ok(P.hitTick >= P.deathTick && P.start < P.shotTick && P.end > P.hitTick);
  assert.ok(replayRate(P, P.start) === 1 && replayRate(P, P.shotTick + 1) < 0.35, 'real time, then slow motion for the shot');
  const real = (P.hitTick - P.shotTick) / (30 * P.slow);
  assert.ok(real > 0.6 && real < 2.5, `the flight lasts ${real.toFixed(2)} s on screen`);
  const mid = projectileAt(P, (P.shotTick + P.hitTick) / 2);
  assert.ok(mid && mid[2] > -6 && mid[2] < 0, 'the round is between the killer and you mid-flight');
  assert.equal(planReplay(new Recorder(), 2, 60, 'yolk47', 1.5, [0, 1.3, 0]), null, 'nothing recorded, no replay');
});

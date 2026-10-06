// Aim assist (subtle: friction and partial tracking, only near the crosshair, only on visible
// enemies, only while the player is giving input) and the cosmetics catalogue (every id the shop
// offers can be drawn, and anything else from the network falls back to a default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { aimAssist, assistOn, ASSIST, ASSIST_BY_GUN } = await load('game/aim.js');
const { COLORS, PATTERNS, STAMPS, HATS, SKINS, NATURAL, sanitizeCosmetics, botCosmetics } = await load('game/cosmetics.js');
const { PATTERN_IDS, STAMP_IDS } = await load('render/shellart.js');
const { HAT_IDS } = await load('render/hats.js');
const { SKIN_IDS, GUN_IDS, gunAnchors } = await load('render/guns.js');

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
  assert.ok(COLORS.length >= 30 && PATTERNS.length >= 15 && STAMPS.length >= 15 && HATS.length >= 25 && SKINS.length >= 15);
  for (const p of PATTERNS) assert.ok(p.id === 'none' || PATTERN_IDS.includes(p.id), p.id);
  for (const s of STAMPS) assert.ok(s.id === 'none' || STAMP_IDS.includes(s.id), s.id);
  for (const h of HATS) assert.ok(h.id === 'none' || HAT_IDS.includes(h.id), h.id);
  for (const s of SKINS) assert.ok(SKIN_IDS.includes(s.id), s.id);
  assert.ok(HATS.filter(h => !h.price).length >= HATS.length - 3, 'only a few hats cost yolks');
});

test('cosmetics from the network: known values pass, anything else falls back', () => {
  const ok = { color: 20, pcolor: 3, hat: 'wizard', pattern: 'camo', stamp: 'googly', skin: 'lava' };
  assert.deepEqual(sanitizeCosmetics(ok), ok);
  assert.deepEqual(sanitizeCosmetics({ color: 999, pcolor: -1, hat: '<script>', pattern: 7, stamp: null, skin: 'x' }), { color: 0, pcolor: 13, hat: 'none', pattern: 'none', stamp: 'none', skin: 'factory' });
  assert.deepEqual(sanitizeCosmetics(null), sanitizeCosmetics({}));
  assert.deepEqual(sanitizeCosmetics({ color: 3, hat: 'cap' }), { color: 3, pcolor: 13, hat: 'cap', pattern: 'none', stamp: 'none', skin: 'factory' }, 'old profiles keep their look');
  let s = 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) { const c = botCosmetics(rnd); assert.deepEqual(sanitizeCosmetics(c), c); assert.ok(NATURAL.includes(c.color) && c.hat === 'none' && c.pattern === 'none' && c.stamp === 'none', 'bots are plain eggs in natural colours'); }
});

test('every gun has the attachment points the hands and camera need', () => {
  for (const id of ['yolk47', 'doubleYolker', 'cageFree', 'yolkzooka', 'beater', 'poacher', 'triBoil', 'peck9mm']) {
    assert.ok(GUN_IDS.includes(id), id);
    const u = gunAnchors(id);
    for (const k of ['muzzle', 'sight', 'grip', 'support']) assert.ok(u[k]?.isVector3, `${id}.${k}`);
    assert.ok(u.muzzle.z < u.grip.z && u.sight.y > u.grip.y, `${id}: muzzle ahead of the grip, sights above it`);
  }
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

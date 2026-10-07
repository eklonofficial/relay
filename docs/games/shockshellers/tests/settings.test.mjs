// Saved settings: moved defaults reach players still on the old ones, and nothing they chose is lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const stored = new Map();
globalThis.localStorage = { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, String(v)), removeItem: k => stored.delete(k) };
const { loadSettings, SETTINGS_KEY, MOUSE_DEFAULT } = await load('game/store.js');
const save = s => stored.set(SETTINGS_KEY, JSON.stringify(s));

test('a PC mouse defaults to a speed small corrections can work with', () => {
  stored.clear();
  assert.ok(MOUSE_DEFAULT < 60, 'not the old maximum');
  assert.equal(loadSettings().mouseSpeed, MOUSE_DEFAULT);
});
test('players on the old default mouse speed move to the new one; a chosen speed stays', () => {
  save({ mouseSpeed: 100 }); assert.equal(loadSettings().mouseSpeed, MOUSE_DEFAULT);
  save({ mouseSpeed: 63 }); assert.equal(loadSettings().mouseSpeed, 63);
  // After the move, choosing the maximum again sticks.
  save({ mouseSpeed: 100, mouseRev: 1 }); assert.equal(loadSettings().mouseSpeed, 100);
});
test('old default keys move (melee to F, aim to left Shift); chosen keys stay', () => {
  save({ keys: { melee: 'KeyV', scope: 'M2' } }); let s = loadSettings();
  assert.equal(s.keys.melee, 'KeyF'); assert.equal(s.keys.scope, 'ShiftLeft');
  save({ keys: { melee: 'KeyC' } }); s = loadSettings(); assert.equal(s.keys.melee, 'KeyC');
});

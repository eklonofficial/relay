// render/itemtex.js: item sprites and particle layers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { generateItemTextures, ITEM_LAYER_COUNT, ITEM_LAYER, FX_LAYER } = await load('render/itemtex.js');

const first = generateItemTextures();

test('one 16x16 RGBA layer per ITEM_LAYER_COUNT()', () => {
  assert.equal(first.length, ITEM_LAYER_COUNT());
  for (const d of first) { assert.ok(d instanceof Uint8ClampedArray); assert.equal(d.length, 16 * 16 * 4); }
});

test('layer tables index inside the generated array without overlap', () => {
  const idx = [...Object.values(ITEM_LAYER), ...Object.values(FX_LAYER)];
  assert.equal(new Set(idx).size, idx.length, 'two entries share a layer');
  for (const i of idx) assert.ok(i >= 0 && i < first.length, `layer ${i}`);
});

test('generation is deterministic', () => {
  const second = generateItemTextures();
  assert.equal(second.length, first.length);
  first.forEach((d, i) => assert.deepEqual(second[i], d, `layer ${i} differs between runs`));
});

test('the alpha-254 tint marker never leaks into item sprites', () => {
  first.forEach((d, i) => { for (let p = 3; p < d.length; p += 4) assert.notEqual(d[p], 254, `layer ${i}`); });
});

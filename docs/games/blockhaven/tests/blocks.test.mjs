// data/blocks.js: the registry every other table is indexed by.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { BLOCKS, B, TEX, TEXTURES, FACE_TEX, STATE, VARIANT_MASK, MAX_ID } = await load('data/blocks.js');

test('block ids are unique, dense, fit a byte, and match B', () => {
  assert.ok(BLOCKS.length > 0 && BLOCKS.length <= 256, `${BLOCKS.length} blocks`);
  assert.equal(MAX_ID, BLOCKS.length);
  const keys = new Set();
  BLOCKS.forEach((b, i) => {
    assert.ok(b, `hole at id ${i}`);
    assert.equal(b.id, i, `${b.key} id`);
    assert.ok(!keys.has(b.key), `duplicate block key ${b.key}`);
    keys.add(b.key);
    assert.equal(B[b.key.toUpperCase()], i, `B.${b.key.toUpperCase()}`);
  });
  assert.equal(B.AIR, 0);
});

test('variants fit the 4-bit variant slot and their keys are unique across all blocks', () => {
  const seen = new Map();
  for (const b of BLOCKS) {
    assert.ok(b.variants.length >= 1 && b.variants.length <= 16, `${b.key}: ${b.variants.length} variants`);
    assert.ok(b.variants.length <= VARIANT_MASK[b.id] + 1, `${b.key}: variant mask too small`);
    b.variants.forEach((v, i) => {
      assert.equal(v.index, i);
      assert.ok(!seen.has(v.key), `variant key ${v.key} in both ${seen.get(v.key)} and ${b.key}`);
      seen.set(v.key, b.key);
      assert.deepEqual(STATE[v.key], [b.id, i]);
    });
  }
});

test('every variant face names a texture in TEX', () => {
  for (const b of BLOCKS) for (const v of b.variants) {
    for (const face of ['side', 'top', 'bottom']) assert.equal(typeof v.tex[face], 'string', `${v.key}.${face}`);
    for (const [face, name] of Object.entries(v.tex)) {
      assert.ok(name in TEX, `${v.key}.${face} -> unknown texture "${name}"`);
      assert.equal(TEXTURES[TEX[name]], name);
    }
  }
});

test('TEXTURES has no duplicates and TEX is its inverse', () => {
  assert.equal(new Set(TEXTURES).size, TEXTURES.length, 'duplicate texture names');
  assert.equal(Object.keys(TEX).length, TEXTURES.length);
  TEXTURES.forEach((n, i) => assert.equal(TEX[n], i));
});

test('FACE_TEX points at real layers for every variant face', () => {
  for (const b of BLOCKS) for (const v of b.variants) {
    const k = ((b.id << 4) | v.index) * 7;
    for (let f = 0; f < 7; f++) assert.ok(FACE_TEX[k + f] < TEXTURES.length, `${v.key} face ${f}`);
  }
});

// data/recipes.js + data/items.js: every recipe names real items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { SHAPED, SHAPELESS, SMELTING, TAGS, findRecipe, allRecipes } = await load('data/recipes.js');
const { ITEMS, I } = await load('data/items.js');

const isItem = k => Object.prototype.hasOwnProperty.call(I, k);
const checkSpec = (spec, where) => {
  if (spec[0] === '#') assert.ok(Object.prototype.hasOwnProperty.call(TAGS, spec.slice(1)), `${where}: unknown tag ${spec}`);
  else assert.ok(isItem(spec), `${where}: unknown item ${spec}`);
};

test('item registry: ids match positions and keys are unique', () => {
  assert.ok(ITEMS.length > 0);
  ITEMS.forEach((it, i) => { assert.equal(it.id, i); assert.equal(I[it.key], it, it.key); });
  assert.equal(Object.keys(I).length, ITEMS.length);
});

test('every tag lists only real items', () => {
  for (const [tag, keys] of Object.entries(TAGS)) {
    assert.ok(keys.length > 0, `tag ${tag} is empty`);
    for (const k of keys) assert.ok(isItem(k), `tag #${tag}: unknown item ${k}`);
  }
});

test('shaped recipes: real output and ingredients, consistent pattern', () => {
  assert.ok(SHAPED.length > 0);
  for (const r of SHAPED) {
    const where = `shaped -> ${r.out}`;
    assert.ok(isItem(r.out), `${where}: unknown output`);
    assert.ok(Number.isInteger(r.count) && r.count >= 1, `${where}: count ${r.count}`);
    assert.ok(r.h >= 1 && r.h <= 3 && r.w >= 1 && r.w <= 3, `${where}: ${r.w}x${r.h}`);
    const used = new Set();
    for (const row of r.pattern) {
      assert.equal(row.length, r.w, `${where}: ragged pattern`);
      for (const ch of row) if (ch !== ' ') { assert.ok(ch in r.key, `${where}: pattern char '${ch}' not in key`); used.add(ch); }
    }
    for (const [ch, spec] of Object.entries(r.key)) { assert.ok(used.has(ch), `${where}: key '${ch}' unused`); checkSpec(spec, where); }
  }
});

test('shapeless recipes: real output and ingredients, fit a 3x3 grid', () => {
  assert.ok(SHAPELESS.length > 0);
  for (const r of SHAPELESS) {
    const where = `shapeless -> ${r.out}`;
    assert.ok(isItem(r.out), `${where}: unknown output`);
    assert.ok(r.ings.length >= 1 && r.ings.length <= 9, `${where}: ${r.ings.length} ingredients`);
    assert.ok(Number.isInteger(r.count) && r.count >= 1);
    for (const s of r.ings) checkSpec(s, where);
  }
});

test('smelting: real inputs and outputs', () => {
  assert.ok(Object.keys(SMELTING).length > 0);
  for (const [input, r] of Object.entries(SMELTING)) {
    assert.ok(isItem(input), `smelt ${input}: unknown input`);
    assert.ok(isItem(r.out), `smelt ${input}: unknown output ${r.out}`);
  }
});

test('recipe book lists every recipe with real specs', () => {
  const all = allRecipes();
  assert.equal(all.length, SHAPED.length + SHAPELESS.length);
  for (const r of all) for (const c of r.cells) checkSpec(c.spec, `book -> ${r.out}`);
});

test('findRecipe matches a known shaped and shapeless recipe', () => {
  const p = 'oak_planks';
  assert.equal(findRecipe([p, p, p, p], 2)?.out, 'crafting_table');
  assert.equal(findRecipe([null, null, null, null, 'oak_log', null, null, null, null], 3)?.out, 'oak_planks');
  assert.equal(findRecipe([null, null, null, null], 2), null);
});

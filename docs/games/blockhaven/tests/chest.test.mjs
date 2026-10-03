// Double chests: where a half's partner is, the large chest's slots, the halves' outlines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { chestPartner, chestType, SHEETS } = await load('data/blocks.js');
const { Container, CompoundContainer } = await load('game/inventory.js');

test("a half's partner is on its facing's clockwise side (left half) or the other (right half)", () => {
  // Facing south (0): clockwise is west.
  assert.deepEqual(chestPartner(0 | 1 << 2), [-1, 0]);
  assert.deepEqual(chestPartner(0 | 2 << 2), [1, 0]);
  // Facing east (3): clockwise is south.
  assert.deepEqual(chestPartner(3 | 1 << 2), [0, 1]);
  assert.equal(chestPartner(2), null); assert.equal(chestType(2 | 2 << 2), 2);
  assert.equal(SHEETS.chest_left[2], 'entity/chest/normal_left');
});

test('a large chest is the right half\'s 27 slots, then the left\'s', () => {
  const right = new Container(27), left = new Container(27), big = new CompoundContainer(right, left);
  assert.equal(big.slots.length, 54);
  big.set(30, { key: 'stone', count: 5 });
  assert.equal(left.get(3).count, 5);
  right.set(0, { key: 'dirt', count: 1 });
  assert.equal(big.get(0).key, 'dirt');
});

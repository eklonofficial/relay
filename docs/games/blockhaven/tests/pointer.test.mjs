import test from 'node:test';
import assert from 'node:assert/strict';
import { movementSamples } from '../js/util/pointer.js';

test('zero-valued coalesced events do not discard real movement', () => {
  const event = { movementX: 12, movementY: -4, getCoalescedEvents: () => [{movementX:0,movementY:0}] };
  assert.deepEqual(movementSamples(event), [event]);
});
test('useful coalesced samples win without counting the outer event twice', () => {
  const list = [{movementX:2,movementY:-1},{movementX:3,movementY:4}];
  assert.deepEqual(movementSamples({movementX:5,movementY:3,getCoalescedEvents:()=>list}),list);
});
test('empty raw events allow ordinary pointer and mouse fallback', () => {
  assert.deepEqual(movementSamples({movementX:0,movementY:0,getCoalescedEvents:()=>[{movementX:0,movementY:0}]}),[]);
  const mouse = {movementX:-6,movementY:2};
  assert.deepEqual(movementSamples(mouse),[mouse]);
});
test('invalid deltas cannot poison camera angles', () => {
  assert.deepEqual(movementSamples({movementX:NaN,movementY:Infinity}),[]);
});

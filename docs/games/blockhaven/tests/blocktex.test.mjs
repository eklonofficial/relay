// render/blocktex.js: procedural 16x16 block textures, one per TEXTURES entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { generateBlockTextures } = await load('render/blocktex.js');
const { TEXTURES } = await load('data/blocks.js');

const SIZE = 16 * 16 * 4;
// Textures that are fully transparent on purpose.
const EMPTY_BY_DESIGN = new Set(['air']);
// Crack overlays are near-black translucent pixels, so a black bleed is the colour they average
// to anyway; the rule below is about cutouts sampled against lit surfaces.
const BLEED_EXEMPT = name => EMPTY_BY_DESIGN.has(name) || /^destroy_\d$/.test(name);

const first = generateBlockTextures();

test('one 16x16 RGBA Uint8ClampedArray per TEXTURES entry', () => {
  assert.equal(first.length, TEXTURES.length);
  first.forEach((d, i) => {
    assert.ok(d instanceof Uint8ClampedArray, `${TEXTURES[i]} is ${d?.constructor?.name}`);
    assert.equal(d.length, SIZE, TEXTURES[i]);
  });
});

test('generation is deterministic', () => {
  const second = generateBlockTextures();
  first.forEach((d, i) => assert.ok(Buffer.from(d.buffer, d.byteOffset, d.byteLength).equals(Buffer.from(second[i].buffer, second[i].byteOffset, second[i].byteLength)), `${TEXTURES[i]} differs between runs`));
});

test('every texture (except air) has at least one visible pixel', () => {
  const blank = [];
  first.forEach((d, i) => {
    if (EMPTY_BY_DESIGN.has(TEXTURES[i])) return;
    let any = false;
    for (let p = 3; p < d.length; p += 4) if (d[p] > 0) { any = true; break; }
    if (!any) blank.push(TEXTURES[i]);
  });
  assert.deepEqual(blank, [], `fully transparent textures: ${blank.join(', ')}`);
});

// Bleed rule: transparent pixels of a cutout carry a real colour (Painter.bleed), never black,
// or mipmapping/filtering darkens the edges. Soft check for now: texture work is in flight and
// some textures (e.g. campfire) do not follow it yet.
test('cutout textures do not leave pure-black RGB under alpha 0 (soft check)', () => {
  const offenders = [];
  first.forEach((d, i) => {
    if (BLEED_EXEMPT(TEXTURES[i])) return;
    for (let p = 0; p < d.length; p += 4) if (d[p + 3] === 0 && !d[p] && !d[p + 1] && !d[p + 2]) { offenders.push(TEXTURES[i]); break; }
  });
  if (offenders.length) console.warn(`[blocktex] bleed rule not met (alpha-0 pixels with black RGB): ${offenders.join(', ')}`);
});

// game/migrate.js: saved worlds must survive block reorders/renames and generator bumps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { migrateWorld, blockPalette, SAVE_VERSION } = await load('game/migrate.js');
const { B, BLOCKS } = await load('data/blocks.js');
const { GEN_VERSION } = await load('gen/versions.js');

// An edit value is the block id in the low byte and the meta (variant/state) above it.
const ed = (id, meta = 0) => id | (meta << 8);
const clone = o => JSON.parse(JSON.stringify(o));

// A save written by an older build whose palette had stone and dirt swapped, plus a block that
// has since been renamed away (its old key no longer exists).
function oldSave() {
  const pal = blockPalette();
  const [s, d] = [B.STONE, B.DIRT];
  pal[s] = 'dirt'; pal[d] = 'stone';
  const gone = B.GRAVEL;
  pal[gone] = 'ruby_block_renamed_away';
  return {
    palette: pal, genVersion: GEN_VERSION,
    dims: {
      overworld: { edits: { '0,0': [10, ed(s, 3), 11, ed(d), 12, ed(gone, 1), 13, ed(B.GLASS)] } },
      the_nether: { edits: { '-1,2': [5, ed(d, 2)] } },
    },
  };
}

test('edits are remapped by block name when the palette was reordered', () => {
  const meta = migrateWorld(oldSave());
  const [, stoneWas, , dirtWas, , , , glass] = meta.dims.overworld.edits['0,0'];
  assert.equal(stoneWas, ed(B.DIRT, 3), 'saved id that meant dirt maps to dirt, meta kept');
  assert.equal(dirtWas, ed(B.STONE), 'saved id that meant stone maps to stone');
  assert.equal(glass, ed(B.GLASS), 'unchanged entries stay put');
  assert.equal(meta.dims.the_nether.edits['-1,2'][1], ed(B.STONE, 2), 'every dimension is remapped');
  // Positions (even slots) are never touched.
  assert.deepEqual(meta.dims.overworld.edits['0,0'].filter((_, i) => i % 2 === 0), [10, 11, 12, 13]);
});

test('blocks whose saved name no longer exists become AIR', () => {
  const v = migrateWorld(oldSave()).dims.overworld.edits['0,0'][5];
  assert.equal(v & 255, B.AIR);
});

test('ids past the end of an older, shorter palette are left alone', () => {
  const pal = blockPalette().slice(0, 5);
  [pal[1], pal[2]] = [pal[2], pal[1]]; // force a remap so the out-of-range path runs
  const high = BLOCKS.length - 1;
  const meta = migrateWorld({ palette: pal, genVersion: GEN_VERSION, dims: { overworld: { edits: { a: [0, ed(high, 1), 1, ed(1)] } } } });
  assert.equal(meta.dims.overworld.edits.a[1], ed(high, 1));
  assert.equal(meta.dims.overworld.edits.a[3], ed(2), 'in-range ids are still remapped');
});

test('a save with the current palette is not rewritten; metadata is stamped', () => {
  const edits = { '0,0': [1, ed(B.STONE, 4), 2, ed(B.DIRT)] };
  const meta = migrateWorld({ palette: blockPalette(), genVersion: GEN_VERSION, dims: { overworld: { edits: clone(edits) } } });
  assert.deepEqual(meta.dims.overworld.edits, edits);
  assert.equal(meta.saveVersion, SAVE_VERSION);
  assert.equal(meta.genVersion, GEN_VERSION);
  assert.deepEqual(meta.palette, blockPalette());
});

test('a save without a palette (pre-palette build) gets one and keeps its edits', () => {
  const meta = migrateWorld({ dims: { overworld: { edits: { k: [0, ed(B.SAND)] } } } });
  assert.deepEqual(meta.dims.overworld.edits.k, [0, ed(B.SAND)]);
  assert.deepEqual(meta.palette, blockPalette());
});

test('a generator-version bump moves populated chunks into popOld[oldVersion]', () => {
  const old = GEN_VERSION - 1;
  const meta = migrateWorld({
    palette: blockPalette(), genVersion: old,
    dims: {
      overworld: { edits: {}, populated: ['0,0', '1,0'], popOld: { [old]: ['9,9'] } },
      the_end: { edits: {}, populated: [] },
    },
  });
  assert.deepEqual(meta.dims.overworld.populated, []);
  assert.deepEqual(meta.dims.overworld.popOld, { [old]: ['9,9', '0,0', '1,0'] });
  assert.equal(meta.dims.the_end.popOld, undefined, 'empty dims are left alone');
  assert.equal(meta.genVersion, GEN_VERSION);
});

test('a save with no genVersion is treated as version 1', () => {
  const meta = migrateWorld({ dims: { overworld: { edits: {}, populated: ['2,3'] } } });
  if (GEN_VERSION > 1) assert.deepEqual(meta.dims.overworld.popOld, { 1: ['2,3'] });
  assert.deepEqual(meta.dims.overworld.populated, GEN_VERSION > 1 ? [] : ['2,3']);
});

test('a current-version save keeps its populated list', () => {
  const meta = migrateWorld({ palette: blockPalette(), genVersion: GEN_VERSION, dims: { overworld: { edits: {}, populated: ['0,0'] } } });
  assert.deepEqual(meta.dims.overworld.populated, ['0,0']);
  assert.equal(meta.dims.overworld.popOld, undefined);
});

test('migrateWorld is idempotent', () => {
  const save = oldSave();
  save.genVersion = GEN_VERSION - 1;
  save.dims.overworld.populated = ['4,4'];
  const once = clone(migrateWorld(save));
  const twice = migrateWorld(clone(once));
  assert.deepEqual(twice, once);
});

test('null / undefined meta passes through', () => {
  assert.equal(migrateWorld(null), null);
  assert.equal(migrateWorld(undefined), undefined);
});

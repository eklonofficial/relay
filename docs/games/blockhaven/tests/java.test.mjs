import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { toJava, fromJava } = await load('game/javablocks.js');
const { readNbt, writeNbt, compound, int, string, list, long, longArray, TAG, readRegion, writeRegion } = await load('game/nbt.js');
const { exportJavaWorld, importJavaWorld, readBits, pack, unpack } = await load('game/javaworld.js');
const { Zip } = await load('render/pack.js');
const { getChunk, decodeChunk } = await load('game/storage.js');
const { createGenerator } = await load('gen/index.js');
const { BLOCKS, B } = await load('data/blocks.js');

test('every block state survives Blockhaven -> Java -> Blockhaven', () => {
  let unstable = 0;
  for (const b of BLOCKS) {
    if (!b || b.id === B.AIR || b.id === B.MOVING_PISTON) continue;
    for (let m = 0; m < 256; m++) {
      const j = toJava(b.id, m), back = fromJava(j.name, j.props);
      if (JSON.stringify(toJava(back & 255, back >> 8)) !== JSON.stringify(j)) unstable++;
    }
  }
  assert.equal(unstable, 0);
});

test('Java blocks we lack fall back to their closest family', () => {
  const key = s => { const b = BLOCKS[s & 255]; return b.variants[(s >> 8) & ((1 << b.variantBits) - 1)].key; };
  assert.equal(key(fromJava('minecraft:stripped_spruce_log', { axis: 'x' })), 'spruce_log');
  assert.equal(key(fromJava('minecraft:deepslate_tile_stairs', { facing: 'east' })), 'deepslate_brick_stairs');
  assert.equal(key(fromJava('minecraft:lime_glazed_terracotta', null)), 'lime_terracotta');
  assert.equal(key(fromJava('minecraft:oak_sign', null)), 'air');
  assert.equal(key(fromJava('minecraft:grass', null)), 'short_grass');
});

test('NBT and region files round-trip', async () => {
  const bytes = writeNbt(compound({ a: int(-5), s: string('hé'), n: long(-3), l: list(TAG.STRING, ['x', 'y']), la: longArray(new Uint32Array([1, 2, 0xffffffff, 4])) }));
  const back = readNbt(bytes);
  assert.equal(back.a, -5); assert.equal(back.s, 'hé'); assert.equal(back.n, -3n); assert.deepEqual(back.l, ['x', 'y']); assert.deepEqual([...back.la], [1, 2, 0xffffffff, 4]);
  const r = await readRegion(await writeRegion([{ lx: 7, lz: 30, bytes }]));
  assert.equal(r.length, 1); assert.equal(r[0].lx, 7); assert.equal(r[0].lz, 30); assert.equal(r[0].nbt.s, 'hé');
});

test('packed block-state arrays read back, with and without long spanning', () => {
  const vals = Uint16Array.from({ length: 4096 }, (_, i) => (i * 7919) % 37);
  assert.deepEqual([...unpack(pack(vals, 6), 4096, 6, false)], [...vals]);
  // Spanning (pre-1.16): a continuous bit stream.
  const words = new Uint32Array(Math.ceil(4096 * 6 / 64) * 2);
  for (let i = 0; i < 4096; i++) for (let k = 0; k < 6; k++) if ((vals[i] >> k) & 1) { const pos = i * 6 + k, L = pos >> 6, bit = pos & 63; words[bit < 32 ? 2 * L + 1 : 2 * L] |= 1 << (bit & 31); }
  assert.deepEqual([...unpack(words, 4096, 6, true)], [...vals]);
  assert.equal(readBits(new Uint32Array([0, 0b1011]), 0, 4), 0b1011);
});

test('a world exported to Java imports back block for block, with player and chests', async () => {
  const keys = ['0,0', '1,0', '0,-1'];
  const w = {
    id: 'jt', name: 'Java Test', seed: 4242, seedText: '4242', type: 'default', mode: 'survival', spawn: [8, 70, 8],
    dims: { 0: { populated: keys, edits: { '0,0': [3 + 4 * 16 + 120 * 256, B.GLOWSTONE] }, blockEntities: { '2,100,2': { type: 'chest', x: 2, y: 100, z: 2, items: [{ key: 'diamond', count: 3 }, ...new Array(26).fill(null)] } } } },
    player: { pos: [8, 90, 8], yaw: 0.5, pitch: 0.1, dim: 0 }, inventory: { main: [{ key: 'stone', count: 12 }, ...new Array(35).fill(null)], armor: [null, null, null, null], offhand: [null], selected: 0 },
  };
  const { blob } = await exportJavaWorld(w);
  const meta = await importJavaWorld(await Zip.open(blob));
  assert.equal(meta.seed, 4242);
  assert.deepEqual(meta.player.pos, [8, 90, 8]);
  assert.deepEqual(meta.inventory.main[0], { key: 'stone', count: 12 });
  assert.deepEqual(meta.dims[0].blockEntities['2,100,2'].items[0], { key: 'diamond', count: 3 });
  const g = createGenerator(4242, 0, 'default');
  for (const k of keys) {
    const [cx, cz] = k.split(',').map(Number), a = g.generateChunk(cx, cz);
    if (k === '0,0') { a.ids[3 + 4 * 16 + 120 * 256] = B.GLOWSTONE; a.meta[3 + 4 * 16 + 120 * 256] = 0; }
    const b = await decodeChunk(await getChunk(`${meta.id}/0/${k}`));
    let diff = 0;
    for (let i = 256 * 5; i < 65536; i++) if (a.ids[i] !== b.ids[i] || a.meta[i] !== b.meta[i]) diff++;
    assert.equal(diff, 0, `chunk ${k}`);
  }
});

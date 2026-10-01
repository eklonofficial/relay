// Far view: mesh/lod.js tiles and world/farview.js tiling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { buildLodTile, layerColors, lodSize, lodStep, LOD_STRIDE } = await load('mesh/lod.js');
const { lodTiles } = await load('world/farview.js');
const { createOverworld } = await load('gen/overworld.js');
const { generateBlockTextures } = await load('render/blocktex.js');
const { B, CHUNK } = await load('data/blocks.js');
const { BI } = await load('gen/biomes.js');

const colors = layerColors(generateBlockTextures());

// Reads a tile back as quads: corners in blocks (relative to the tile) and the face normal.
function quads(r, step) {
  const u8 = new Uint8Array(r.verts), i16 = new Int16Array(r.verts), out = [];
  for (let q = 0; q < r.quads; q++) {
    const p = [];
    for (let k = 0; k < 4; k++) { const b = (q * 4 + k) * LOD_STRIDE; p.push([u8[b] * step, i16[(b >> 1) + 1] / 8, u8[b + 1] * step]); }
    const e1 = p[1].map((v, i) => v - p[0][i]), e2 = p[2].map((v, i) => v - p[0][i]);
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    out.push({ p, n, rgb: [...u8.slice(q * 4 * LOD_STRIDE + 4, q * 4 * LOD_STRIDE + 7)] });
  }
  return out;
}

test('a flat plain is one grass top per cell, facing up, plus skirts at the edges', () => {
  const terrain = { surfaceY: () => 70, lodColumn: () => ({ biome: BI.PLAINS, top: [B.GRASS_BLOCK, 0], fill: [B.DIRT, 0], water: 0, snow: false, tree: null }) };
  const r = buildLodTile(terrain, colors, 0, 0, 0), qs = quads(r, 4);
  const tops = qs.filter(q => q.n[1] > 0);
  assert.equal(tops.length, 256);
  assert.ok(tops.every(q => q.p.every(v => v[1] === 71)), 'tops at the top of the block');
  // Grass is tinted green in plains.
  assert.ok(tops[0].rgb[1] > tops[0].rgb[0] && tops[0].rgb[1] > tops[0].rgb[2], `grass colour ${tops[0].rgb}`);
  // Every other quad is a skirt wall on the tile's outer edge, facing outward.
  for (const q of qs.filter(q => q.n[1] === 0)) {
    const xs = q.p.map(v => v[0]), zs = q.p.map(v => v[2]);
    if (q.n[0]) assert.ok(xs.every(x => x === (q.n[0] > 0 ? 64 : 0)));
    else assert.ok(zs.every(z => z === (q.n[2] > 0 ? 64 : 0)));
  }
  assert.equal(r.maxY, 71);
});

test('a step faces the lower side, and water sits 7/8 up its top block', () => {
  const terrain = {
    surfaceY: x => (x < 32 ? 80 : 50),
    lodColumn: (x, z, y) => ({ biome: BI.PLAINS, top: [B.GRASS_BLOCK, 0], fill: [B.DIRT, 0], water: y < 64 ? 64 : 0, snow: false, tree: null }),
  };
  const qs = quads(buildLodTile(terrain, colors, 0, 0, 0), 4);
  const cliff = qs.filter(q => q.n[0] > 0 && q.p.every(v => v[0] === 32));
  assert.ok(cliff.length >= 16, 'a wall along the step');
  assert.ok(cliff.every(q => Math.min(...q.p.map(v => v[1])) >= 64.875 && Math.max(...q.p.map(v => v[1])) <= 81));
  const water = qs.filter(q => q.n[1] > 0 && q.p[0][0] >= 32);
  assert.ok(water.every(q => q.p[0][1] === 64.875), 'water top');
  assert.ok(water[0].rgb[2] > water[0].rgb[0], `water colour ${water[0].rgb}`);
});

test('tiles from the real generator match the heights of generated chunks', () => {
  const gen = createOverworld(12345);
  const r = buildLodTile(gen, colors, 0, 2, -3), x0 = 2 * lodSize(0), z0 = -3 * lodSize(0);
  const tops = quads(r, lodStep(0)).filter(q => q.n[1] > 0);
  assert.equal(tops.length, 256);
  const w = gen.generateChunk(Math.floor(x0 / CHUNK), Math.floor(z0 / CHUNK));
  let close = 0, n = 0;
  for (const q of tops) {
    const [x, , z] = q.p[0];
    if (x >= 16 || z >= 16 || q.p.some(v => v[0] < x || v[2] < z)) continue;
    const real = w.heights[x + z * 16] + 1, lod = q.p[0][1];
    n++;
    // Water stands at its own level; land within a tree's height of the real top (canopies).
    if (Math.abs(lod - real) <= 15) close++;
  }
  assert.ok(n >= 16 && close / n > 0.9, `${close}/${n} cells near the real surface`);
});

test('the tiles cover the far ring exactly once, finer near the player', () => {
  const px = 1000.5, pz = -300.25, radius = 1024, inner = 7 * 16;
  const tiles = lodTiles(px, pz, radius, 3, inner);
  for (let z = pz - radius; z <= pz + radius; z += 23) for (let x = px - radius; x <= px + radius; x += 23) {
    const d = Math.hypot(x - px, z - pz);
    const n = tiles.filter(t => x >= t.x0 && x < t.x0 + t.size && z >= t.z0 && z < t.z0 + t.size).length;
    assert.ok(n <= 1, 'no overlaps');
    if (d < radius - 1 && d > inner * 1.5) assert.equal(n, 1, `covered at ${x},${z}`);
  }
  const near = tiles.filter(t => t.d < 300), far = tiles.filter(t => t.d > 1200);
  assert.ok(near.every(t => t.level <= 1) && far.every(t => t.level >= 2));
  assert.ok(tiles.length < 400, `${tiles.length} tiles`);
});

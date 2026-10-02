// data/models.js (Java's block model format) and the mesher's element models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { MODELS } = await load('data/models.js');
const { meshSingleBlock, STRIDE, POS_BIAS } = await load('mesh/mesher.js');
const { BLOCKS, TEX } = await load('data/blocks.js');

const block = key => { for (const b of BLOCKS) for (const v of b.variants) if (v.key === key) return [b.id, v.index]; throw new Error(key); };
// The quads of one block alone: corners in pixels, texture layer, UVs in pixels.
function quads(key, meta = 0) {
  const [id, v] = block(key), r = meshSingleBlock(id, v | meta), u16 = new Uint16Array(r.data.buffer), out = [];
  for (let q = 0; q < r.quads; q++) {
    const p = [], uv = [];
    let layer = 0;
    for (let k = 0; k < 4; k++) {
      const h = (q * 4 + k) * STRIDE / 2;
      p.push([0, 1, 2].map(a => (u16[h + a] - POS_BIAS) / 2));
      layer = u16[h + 4];
      uv.push([u16[h + 5] & 31, (u16[h + 5] >> 5) & 31]);
    }
    out.push({ p, uv, layer });
  }
  return out;
}

test('every model face has a texture name and a UV rectangle inside the texture', () => {
  for (const [name, els] of Object.entries(MODELS)) {
    assert.ok(els.length, name);
    for (const e of els) for (const f of e.faces) {
      assert.ok(f.tex && f.f >= 0 && f.f < 6, `${name} face`);
      assert.ok(f.uv.every(u => u >= 0 && u <= 16), `${name} uv ${f.uv}`);
    }
  }
});

test('a torch is its texture on crossed 2-px slabs, topped with the flame (Java template_torch)', () => {
  const qs = quads('torch');
  assert.equal(qs.length, 6);
  // The side planes span the whole block and show the whole texture.
  const sides = qs.filter(q => Math.max(...q.p.map(c => c[1])) === 16);
  assert.equal(sides.length, 4);
  assert.ok(sides.every(q => q.uv.some(([u, v]) => u === 0 && v === 0) && q.uv.some(([u, v]) => u === 16 && v === 16)));
  const top = qs.find(q => q.p.every(c => c[1] === 10));
  assert.deepEqual([...new Set(top.uv.map(c => c.join()))].sort(), ['7,6', '7,8', '9,6', '9,8']);
});

test('a wall torch leans 22.5 degrees out from its wall', () => {
  // Attached to the north side of its block (meta: attach 3), so it leans south (+Z).
  const qs = quads('torch', 3 << 1);
  const tops = qs.flatMap(q => q.p).filter(c => c[1] > 13);
  const bottoms = qs.flatMap(q => q.p).filter(c => c[1] < 4);
  const avg = cs => cs.reduce((s, c) => s + c[2], 0) / cs.length;
  assert.ok(avg(tops) > avg(bottoms) + 2, `top z ${avg(tops)} vs bottom z ${avg(bottoms)}`);
});

test('a lantern uses the lantern sheet, not whole-texture faces (Java template_lantern)', () => {
  const qs = quads('lantern');
  assert.ok(qs.length >= 10);
  const body = qs.filter(q => q.p.every(c => c[1] <= 7) && q.p.some(c => c[1] === 7) && q.p.some(c => c[1] === 0));
  assert.ok(body.length === 4 && body.every(q => q.uv.every(([u, v]) => u <= 6 && v >= 2 && v <= 9)));
});

test('a cactus is inset a pixel on its sides with full-size top and bottom', () => {
  const qs = quads('cactus');
  assert.equal(qs.length, 6);
  const top = qs.find(q => q.p.every(c => c[1] === 16));
  assert.ok(top.p.some(c => c[0] === 0) && top.p.some(c => c[0] === 16));
  assert.equal(top.layer, TEX.cactus_top);
  const xs = qs.filter(q => q.p.every(c => c[0] === q.p[0][0])).map(q => q.p[0][0]).sort((a, b) => a - b);
  assert.deepEqual(xs, [1, 15]);
});

test('stems grow 2 px a stage', () => {
  const height = age => Math.max(...quads('pumpkin_stem', age << 3).flatMap(q => q.p.map(c => c[1])));
  assert.equal(height(0), 1);
  assert.equal(height(7), 15);
});

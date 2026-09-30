// core/noise.js: seeded RNG, hashes and simplex noise must be deterministic (worlds regenerate
// from their seed on every load) and stay in range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { mulberry32, hash2, hash3, Simplex } = await load('core/noise.js');

const take = (r, n) => Array.from({ length: n }, () => r());

test('mulberry32: same seed, same sequence; different seed, different sequence', () => {
  assert.deepEqual(take(mulberry32(12345), 50), take(mulberry32(12345), 50));
  assert.notDeepEqual(take(mulberry32(12345), 50), take(mulberry32(12346), 50));
});

test('mulberry32 stays in [0, 1) and is roughly uniform', () => {
  const r = mulberry32(42), n = 20000;
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = r(); assert.ok(v >= 0 && v < 1, `out of range: ${v}`); sum += v; }
  assert.ok(Math.abs(sum / n - 0.5) < 0.02, `mean ${sum / n}`);
});

test('mulberry32 accepts negative and huge seeds deterministically', () => {
  for (const s of [-1, 0, 2 ** 32 + 5, -987654321]) assert.deepEqual(take(mulberry32(s), 5), take(mulberry32(s), 5));
});

test('hash2 / hash3 are deterministic and in [0, 1)', () => {
  for (let i = -20; i < 20; i++) {
    const a = hash2(i, i * 7 - 3, 99), b = hash3(i, 64, -i, 99);
    assert.equal(a, hash2(i, i * 7 - 3, 99));
    assert.equal(b, hash3(i, 64, -i, 99));
    assert.ok(a >= 0 && a < 1 && b >= 0 && b < 1);
  }
  assert.notEqual(hash2(3, 4, 1), hash2(3, 4, 2));
});

test('Simplex: same seed gives identical noise; perm is a permutation', () => {
  const a = new Simplex(777), b = new Simplex(777), c = new Simplex(778);
  assert.deepEqual([...new Set(a.perm.slice(0, 256))].sort((x, y) => x - y), Array.from({ length: 256 }, (_, i) => i));
  let differs = false;
  for (let i = 0; i < 200; i++) {
    const x = i * 0.137 - 13, y = i * 0.071 + 2, z = i * -0.053;
    assert.equal(a.noise2(x, y), b.noise2(x, y));
    assert.equal(a.noise3(x, y, z), b.noise3(x, y, z));
    if (a.noise2(x, y) !== c.noise2(x, y)) differs = true;
  }
  assert.ok(differs, 'different seeds should give different noise');
});

test('Simplex output stays within [-1, 1]', () => {
  const s = new Simplex(1);
  for (let i = 0; i < 5000; i++) {
    const x = (i % 97) * 0.31, y = Math.floor(i / 97) * 0.29, z = i * 0.011;
    const n2 = s.noise2(x, y), n3 = s.noise3(x, y, z);
    assert.ok(n2 >= -1 && n2 <= 1, `noise2 ${n2}`);
    assert.ok(n3 >= -1 && n3 <= 1, `noise3 ${n3}`);
  }
});

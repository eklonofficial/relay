// Conformance with the shared standard (standards/standards.md §9): the infrastructure Blockhaven
// proved out is copied, not reinvented, and this game keeps to its own namespace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ref = join(root, '../blockhaven');
const read = (base, f) => readFileSync(join(base, f), 'utf8');
const unstamp = s => s.replace(/\?v=[a-z0-9]+/g, '');

test('the compositor is byte-for-byte Blockhaven\'s', () => {
  assert.equal(read(root, 'js/surface.js'), read(ref, 'js/surface.js'));
});
test('quick-hide, dialogs, pointer samples and the sealed channel match Blockhaven\'s (stamps aside)', () => {
  for (const f of ['js/veil.js', 'js/dialog.js', 'js/util/pointer.js', 'js/net/sealed.js', 'js/page.js']) assert.equal(unstamp(read(root, f)), unstamp(read(ref, f)), f);
});
test('the transport differs from Blockhaven\'s only in its topic root', () => {
  const a = unstamp(read(root, 'js/net/transport.js')).split('\n'), b = unstamp(read(ref, 'js/net/transport.js')).split('\n');
  assert.equal(a.length, b.length);
  const diff = a.map((l, i) => l === b[i] ? null : [l, b[i]]).filter(Boolean);
  assert.deepEqual(diff, [["const ROOT = 'shockshellers/v1';", "const ROOT = 'blockhaven/v1';"]]);
});
test('Link and the connection helpers are Blockhaven\'s', () => {
  // From the Link class's comment to the end of the class.
  const pick = s => { s = unstamp(s); const a = s.indexOf('// One data connection.'); return s.slice(a, s.indexOf('\n}\n', a) + 3); };
  assert.equal(pick(read(root, 'js/net/net.js')), pick(read(ref, 'js/net/net.js')));
});
test('the shared calculator is embedded; no per-game calculator or Vercel config', () => {
  assert.ok(!existsSync(join(root, 'calc.html')));
  assert.ok(!existsSync(join(root, 'vercel.json')));
  assert.match(read(root, 'js/veil.js'), /frame\.src = '\.\.\/calc\.html'/);
});
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(join(root, 'js'));
test('nothing is published on window and no forbidden calls', () => {
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /\b(?:window|globalThis)\.[A-Za-z_$][\w$]*\s*=[^=]/, f);
    assert.doesNotMatch(s, /\b(?:alert|confirm|prompt|eval)\(|new Function\(|localStorage\.clear\(/, f);
  }
});
test('every storage key and database name is namespaced to the game', () => {
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*(['"`])([^'"`]+)\1/g)) assert.ok(m[2].startsWith('shockshellers'), `${f}: ${m[2]}`);
    for (const m of s.matchAll(/(?:KEY|_KEY)\s*=\s*'([^']+)'/g)) assert.ok(m[1].startsWith('shockshellers'), `${f}: ${m[1]}`);
    for (const m of s.matchAll(/indexedDB\.open\(\s*'([^']+)'/g)) assert.ok(m[1].startsWith('shockshellers'), `${f}: ${m[1]}`);
  }
  assert.match(read(root, 'js/net/net.js'), /PREFIX = 'shockshellers-v1-'/);
});
test('no select, video or native range inputs in the interface', () => {
  assert.doesNotMatch(read(root, 'index.html'), /<select|<video|type="range"/);
});

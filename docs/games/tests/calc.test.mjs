// The shared calculator: one table of expressions, each opening one game folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptHashes, policy, syncSite, gameFolders } from '../tools/security.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const calc = readFileSync(join(root, 'calc.html'), 'utf8');
const normalise = s => s.toLowerCase().replace(/[\s*]/g, '');
const table = [...calc.match(/const GAMES = \{([^}]*)\}/)[1].matchAll(/'([^']*)'\s*:\s*'([a-z0-9]+)'/g)].map(m => [m[1], m[2]]);

test('every expression is unique after normalisation and opens one existing game', () => {
  assert.ok(table.length >= 2);
  const seen = new Set(), games = new Set();
  for (const [secret, game] of table) {
    assert.equal(secret, normalise(secret), 'store expressions already normalised');
    assert.ok(secret.length >= 3);
    assert.ok(!seen.has(secret), 'duplicate expression'); seen.add(secret);
    assert.ok(!games.has(game), `${game} listed twice`); games.add(game);
    assert.ok(existsSync(join(root, game, 'index.html')), `${game}/index.html`);
  }
  assert.deepEqual(gameFolders(), [...games].sort());
});

test('games embed the shared calculator and have no calculator of their own', () => {
  for (const [, game] of table) {
    assert.ok(!existsSync(join(root, game, 'calc.html')), `${game}/calc.html must not exist`);
    assert.ok(!existsSync(join(root, game, 'vercel.json')), `${game}/vercel.json must not exist`);
    assert.match(readFileSync(join(root, game, 'js/veil.js'), 'utf8'), /frame\.src = '\.\.\/calc\.html'/);
  }
});

test('expressions are written only in the calculator table', () => {
  const files = [];
  (function walk(d) {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (!['vendor', 'assets', 'fonts', 'node_modules'].includes(f)) walk(p); }
      else if (/\.(m?js|html|md|json)$/.test(f)) files.push(p);
    }
  })(root);
  const games = new Set(table.map(([, g]) => g));
  for (const p of files.filter(p => [...games].some(g => p.startsWith(join(root, g) + '/')) || p.startsWith(join(root, 'tools')) || p.startsWith(join(root, 'tests')))) {
    const text = readFileSync(p, 'utf8');
    for (const [secret] of table) assert.ok(!text.includes(`'${secret}'`) && !text.includes(`"${secret}"`), `${secret} written in ${p}`);
  }
});

test('calculator page and site headers are in sync', () => {
  const tag = calc.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.equal(tag[1], policy(scriptHashes(calc)));
  assert.deepEqual(syncSite(root, true), []);
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  assert.ok(config.routes.some(r => r.src === '^/$' && r.dest === '/calc.html'));
});

test('launch opens the chosen game folder and the embedded handoff keeps the bh contract', () => {
  assert.match(calc, /location\.href = game \+ '\/index\.html'/);
  assert.match(calc, /\{ bh: 'resume' \} : \{ bh: 'open', game \}/);
  assert.match(calc, /parent\.postMessage\([^)]*, location\.origin\)/);
});

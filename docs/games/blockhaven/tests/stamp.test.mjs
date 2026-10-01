// tools/stamp.mjs: --check must pass on a freshly stamped tree and fail on unstamped or mixed
// stamps, without writing anything. Runs on a throwaway copy, never on the repo itself.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const game = fileURLToPath(new URL('..', import.meta.url));
let dir;
const run = (...args) => spawnSync(process.execPath, [join(dir, 'tools', 'stamp.mjs'), ...args], { encoding: 'utf8' });
const edit = (rel, fn) => { const p = join(dir, rel); writeFileSync(p, fn(readFileSync(p, 'utf8'))); };

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'blockhaven-stamp-'));
  for (const f of ['index.html', 'calc.html', 'vercel.json', 'js', 'tools']) cpSync(join(game, f), join(dir, f), { recursive: true });
  const r = run();
  assert.equal(r.status, 0, r.stderr);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('--check passes on a freshly stamped tree and changes nothing', () => {
  const before = readFileSync(join(dir, 'js/game/game.js'), 'utf8');
  const r = run('--check');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /stamp check ok/);
  assert.equal(readFileSync(join(dir, 'js/game/game.js'), 'utf8'), before);
});

test('--check fails on an unstamped module import', () => {
  edit('js/game/game.js', s => s.replace(/\.js\?v=[^'"]*/, '.js'));
  const r = run('--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no \?v= stamp[\s\S]*js\/game\/game\.js:\d+/);
  run();
});

test('--check fails on an unstamped worker URL and entry script', () => {
  edit('js/world/world.js', s => s.replace(/worker\.js\?v=[^'"]*/, 'worker.js'));
  edit('index.html', s => s.replace(/js\/main\.js\?v=[^"]*/, 'js/main.js'));
  const r = run('--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /js\/world\/world\.js:\d+\s+\.\.\/worker\.js/);
  assert.match(r.stderr, /index\.html:\d+\s+js\/main\.js/);
  run();
});

test('--check fails when stamps disagree, and write mode repairs it', () => {
  edit('js/data/items.js', s => s.replace(/\?v=[^'"]*/g, '?v=stale0'));
  const r = run('--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stamps disagree: 2 different versions/);
  assert.match(r.stderr, /v=stale0/);
  assert.equal(run().status, 0);
  assert.equal(run('--check').status, 0);
});

test('--check fails when the splash module count is out of date, and write mode repairs it', () => {
  edit('index.html', s => s.replace(/data-modules="\d*"/, 'data-modules="3"'));
  const r = run('--check');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /data-modules is 3, but the page loads \d+ modules/);
  assert.equal(run().status, 0);
  assert.equal(run('--check').status, 0);
});

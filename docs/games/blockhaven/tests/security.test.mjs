import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scriptHashes, policy, syncSecurity } from '../tools/security.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = name => readFileSync(join(root, name), 'utf8');
const directive = (csp, name) => csp.split('; ').find(s => s.startsWith(`${name} `));

test('CSP script hashes match HTML parser line-ending normalization', () => {
  assert.deepEqual(scriptHashes('<script>one\r\ntwo\rthree</script>'), scriptHashes('<script>one\ntwo\nthree</script>'));
});

test('both entry pages have early, exact hashed CSP and no-referrer', () => {
  for (const name of ['index.html', 'calc.html']) {
    const html = read(name), tag = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
    assert.ok(tag, name);
    assert.equal(tag[1], policy(scriptHashes(html)));
    assert.ok(tag.index < html.indexOf('<script'));
    assert.ok(tag.index < html.indexOf('<link'));
    assert.equal(html.match(/name="referrer" content="no-referrer"/g)?.length, 1);
    assert.doesNotMatch(directive(tag[1], 'script-src'), /unsafe-inline|unsafe-eval|blob:|data:|https:/);
    assert.equal(directive(tag[1], 'script-src-attr'), "script-src-attr 'none'");
    assert.equal(directive(tag[1], 'object-src'), "object-src 'none'");
    assert.equal(directive(tag[1], 'base-uri'), "base-uri 'none'");
    assert.equal(directive(tag[1], 'form-action'), "form-action 'none'");
  }
});

test('Vercel policies retain routing, media, workers and configurable multiplayer', () => {
  const config = JSON.parse(read('vercel.json'));
  const h = config.routes[0].headers;
  assert.equal(config.routes[0].continue, true);
  assert.ok(config.routes.some(r => r.src === '^/$' && r.dest === '/calc.html'));
  assert.equal(h['Content-Security-Policy'], policy(['index.html', 'calc.html'].flatMap(n => scriptHashes(read(n)))));
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.match(h['Permissions-Policy'], /camera=\(\), microphone=\(\), geolocation=\(\)/);
  assert.equal(directive(h['Content-Security-Policy'], 'worker-src'), "worker-src 'self' blob:");
  assert.match(directive(h['Content-Security-Policy'], 'connect-src'), /https: wss: http: ws:/);
  assert.equal(directive(h['Content-Security-Policy'], 'img-src'), "img-src 'self' data: blob:");
});

test('policy generation is idempotent, detects changed scripts, and preserves unrelated routes', () => {
  const temp = mkdtempSync(join(tmpdir(), 'blockhaven-security-'));
  try {
    for (const n of ['index.html', 'calc.html', 'vercel.json']) cpSync(join(root, n), join(temp, n));
    assert.equal(syncSecurity(temp, true), 0);
    const path = join(temp, 'calc.html'), altered = readFileSync(path, 'utf8').replace('<script>', '<script>\n/* changed */');
    writeFileSync(path, altered);
    assert.equal(syncSecurity(temp, true), 1);
    assert.equal(readFileSync(path, 'utf8'), altered, 'check must not write');
    const configPath = join(temp, 'vercel.json'), config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.routes.push({ src: '/example', dest: '/example.html' });
    writeFileSync(configPath, JSON.stringify(config));
    syncSecurity(temp);
    assert.equal(syncSecurity(temp, true), 0);
    assert.deepEqual(JSON.parse(readFileSync(configPath, 'utf8')).routes.at(-1), { src: '/example', dest: '/example.html' });
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

// Cache-busting: stamps every relative module import (and the worker URL and the page's entry
// script) with ?v=<version>, so a deploy never mixes fresh and cached files. Run before pushing:
//   node docs/games/blockhaven/tools/stamp.mjs
// CI runs the read-only check, which changes nothing and exits 1 if any reference is unstamped
// or the stamps disagree on the version:
//   node docs/games/blockhaven/tools/stamp.mjs --check
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const v = Date.now().toString(36);
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(join(root, 'js'));
const html = join(root, 'index.html');

if (process.argv.includes('--check')) process.exit(check());

const stamp = s => s
  .replace(/(from\s+|import\s*\(\s*|import\s+)(['"])(\.\.?\/[^'"?]+\.js)(\?v=[^'"]*)?\2/g, (m, a, q, path) => `${a}${q}${path}?v=${v}${q}`)
  .replace(/new URL\((['"])(\.\.?\/[^'"?]+\.js)(\?v=[^'"]*)?\1/g, (m, q, path) => `new URL(${q}${path}?v=${v}${q}`);
let n = 0;
for (const f of files) { const s = readFileSync(f, 'utf8'), t = stamp(s); if (t !== s) { writeFileSync(f, t); n++; } }
writeFileSync(html, readFileSync(html, 'utf8').replace(/src="js\/main\.js(\?v=[^"]*)?"/, `src="js/main.js?v=${v}"`).replace(/src="net-config\.js(\?v=[^"]*)?"/, `src="net-config.js?v=${v}"`));
console.log(`stamped ${n} modules + index.html with v=${v}`);

// Read-only: every reference the write mode would stamp must carry ?v=, and all with one version.
function check() {
  const unstamped = [], versions = new Map(); // version -> [locations]
  const lineOf = (s, i) => s.slice(0, i).split('\n').length;
  const see = (file, s, m, path, ver) => {
    const where = `${relative(root, file)}:${lineOf(s, m.index)}`;
    if (ver === undefined) { unstamped.push(`${where}  ${path}`); return; }
    if (!versions.has(ver)) versions.set(ver, []);
    versions.get(ver).push(where);
  };
  // Same shapes the write mode rewrites; the version group is optional so misses are caught.
  const patterns = [
    /(?:from\s+|import\s*\(\s*|import\s+)(['"])(\.\.?\/[^'"?]+\.js)(?:\?v=([^'"]*))?\1/g,
    /new URL\((['"])(\.\.?\/[^'"?]+\.js)(?:\?v=([^'"]*))?\1/g,
  ];
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    for (const re of patterns) for (const m of s.matchAll(re)) see(f, s, m, m[2], m[3]);
  }
  const page = readFileSync(html, 'utf8');
  for (const entry of ['js/main.js', 'net-config.js']) {
    const re = new RegExp(`src="(${entry.replace(/[.]/g, '\\.')})(?:\\?v=([^"]*))?"`, 'g');
    const found = [...page.matchAll(re)];
    if (!found.length) unstamped.push(`index.html  no <script src="${entry}"> found`);
    for (const m of found) see(html, page, m, m[1], m[2]);
  }

  const total = [...versions.values()].reduce((a, l) => a + l.length, 0) + unstamped.length;
  const problems = [];
  if (unstamped.length) problems.push(`${unstamped.length} reference(s) have no ?v= stamp:\n` + unstamped.map(u => `    ${u}`).join('\n'));
  if (versions.size > 1) {
    const byCount = [...versions].sort((a, b) => b[1].length - a[1].length);
    problems.push(`stamps disagree: ${versions.size} different versions (a partial stamp mixes cached and fresh modules):\n` +
      byCount.map(([ver, locs]) => `    v=${ver || '(empty)'}  ${locs.length} ref(s), e.g. ${locs.slice(0, 3).join(', ')}`).join('\n'));
  }
  if (versions.size === 1 && [...versions.keys()][0] === '') problems.push('stamps are empty (?v= with no version)');
  if (problems.length) {
    console.error(`stamp check FAILED (${total} references checked):\n  ` + problems.join('\n  ') +
      '\n\nFix: run `node docs/games/blockhaven/tools/stamp.mjs` and commit the result.');
    return 1;
  }
  console.log(`stamp check ok: ${total} references in ${files.length} modules + index.html all carry v=${[...versions.keys()][0]}`);
  return 0;
}

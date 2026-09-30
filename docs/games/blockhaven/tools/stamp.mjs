// Cache-busting: stamps every relative module import (and the worker URL and the page's entry
// script) with ?v=<version>, so a deploy never mixes fresh and cached files. Run before pushing:
//   node docs/games/blockhaven/tools/stamp.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const v = Date.now().toString(36);
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(join(root, 'js'));
const stamp = s => s
  .replace(/(from\s+|import\s*\(\s*|import\s+)(['"])(\.\.?\/[^'"?]+\.js)(\?v=[^'"]*)?\2/g, (m, a, q, path) => `${a}${q}${path}?v=${v}${q}`)
  .replace(/new URL\((['"])(\.\.?\/[^'"?]+\.js)(\?v=[^'"]*)?\1/g, (m, q, path) => `new URL(${q}${path}?v=${v}${q}`);
let n = 0;
for (const f of files) { const s = readFileSync(f, 'utf8'), t = stamp(s); if (t !== s) { writeFileSync(f, t); n++; } }
const html = join(root, 'index.html');
writeFileSync(html, readFileSync(html, 'utf8').replace(/src="js\/main\.js(\?v=[^"]*)?"/, `src="js/main.js?v=${v}"`));
console.log(`stamped ${n} modules + index.html with v=${v}`);

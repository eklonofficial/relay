// Packs the whole site: every game (its own tools/build.mjs, into build/games/<slug>/), then the
// shared calculator (build/games/calc.html + its .bin) and build/games/vercel.json. Deploy ONLY
// build/games/. The calculator shell, bootstrap and CSP are exactly the games' (see any game's
// tools/build.mjs); only the bundle differs.
//   node docs/games/tools/build.mjs [--out <dir>] [--dependencies <dir>] [--calc-only]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gamesRoot as root, gameFolders } from './security.mjs';
const arg = name => process.argv.includes(name) ? resolve(process.argv[process.argv.indexOf(name) + 1]) : null;
const dependencyDir = arg('--dependencies') || resolve(root, '../..');
const { build } = createRequire(join(dependencyDir, 'package.json'))('esbuild');
const out = arg('--out') || resolve(root, '../../build/games');
mkdirSync(out, { recursive: true });
const games = gameFolders();
if (!process.argv.includes('--calc-only')) {
  for (const g of games) execFileSync(process.execPath, [join(root, g, 'tools/build.mjs'), '--out', join(out, g), '--dependencies', dependencyDir], { stdio: 'inherit' });
}
const read = name => readFileSync(join(root, name), 'utf8');
const calculator = read('calc.html');
const identity = calculator.match(/<title>[^<]*<\/title>\s*<link rel="icon" href="[^"]*">/)[0];
const calcStyle = calculator.match(/<style>([\s\S]*?)<\/style>/)[1];
const calcMarkup = calculator.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const calcCode = calculator.match(/<script>([\s\S]*?)<\/script>/)[1];
// The compositor is identical in every game (conformance tests); the reference copy packs it.
const entry = join(out, '.entry.mjs');
writeFileSync(entry, `import {mount,surfaceDocument as document} from ${JSON.stringify(join(root, 'blockhaven/js/surface.js').replace(/\\/g, '/'))};mount(${JSON.stringify(calcMarkup)},${JSON.stringify(calcStyle)});\n(()=>{${calcCode}\n})();`);
const bundle = (await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, legalComments: 'none' })).outputFiles[0].text;
const payload = gzipSync(Buffer.from(bundle), { level: 9 });
const digest = createHash('sha256').update(payload).digest('hex');
const name = digest.slice(0, 24) + '.bin';
writeFileSync(join(out, name), payload);
const boot = `try{const r=await fetch('./${name}',{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw Error();const a=await r.arrayBuffer();const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),n=>n.toString(16).padStart(2,'0')).join('');if(h!=='${digest}')throw Error('Resource verification failed');const s=new Blob([a]).stream().pipeThrough(new DecompressionStream('gzip'));const b=await new Response(s).blob();const u=URL.createObjectURL(new Blob([b],{type:'text/javascript'}));await import(u)}catch(e){const c=document.querySelector('canvas'),x=c.getContext('2d');c.width=innerWidth;c.height=innerHeight;x.fillStyle='#222';x.fillRect(0,0,c.width,c.height);x.fillStyle='#fff';x.font='18px sans-serif';x.fillText('Unable to open. Please reload.',24,48);console.error(e)}`;
const sha = s => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
const csp = hashes => `default-src 'none'; script-src blob: ${hashes.join(' ')}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'self' data: https: wss: http: ws:; worker-src blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`;
writeFileSync(join(out, 'calc.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp([sha(boot)])}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">${identity}<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{width:100%;height:100%;display:block}</style></head><body><canvas></canvas><script type="module">${boot}</script></body></html>`);
// One header policy for the whole deployment: the calculator's boot hash plus each packed game's.
const hashes = [sha(boot)];
for (const g of games) {
  const page = join(out, g, 'index.html');
  if (existsSync(page)) hashes.push(sha(readFileSync(page, 'utf8').match(/<script type="module">([\s\S]*?)<\/script>/)[1]));
}
const config = JSON.parse(read('vercel.json'));
config.routes[0].headers['Content-Security-Policy'] = csp(hashes);
writeFileSync(join(out, 'vercel.json'), JSON.stringify(config, null, 2) + '\n');
// Remove only our known temporary entry file, never a computed output tree.
unlinkSync(entry);
console.log(`built ${out}: calculator ${payload.length} bytes + ${games.length} game(s)`);

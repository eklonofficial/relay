// Deploy ONLY this output directory. Source modules, readable templates, debug
// pages and individual assets intentionally are not copied into the deployment.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencyDir = process.argv.includes('--dependencies') ? resolve(process.argv[process.argv.indexOf('--dependencies') + 1]) : resolve(root, '../../..');
const { build } = createRequire(join(dependencyDir, 'package.json'))('esbuild');
const out = process.argv.includes('--out') ? resolve(process.argv[process.argv.indexOf('--out') + 1]) : resolve(root, '../../../build/games/blockhaven');
mkdirSync(out, { recursive: true });
const read = name => readFileSync(join(root, name), 'utf8');
const page = read('index.html');
// The tab identity is the shared calculator's (docs/games/calc.html), from the first byte.
const identity = read('../calc.html').match(/<title>[^<]*<\/title>\s*<link rel="icon" href="[^"]*">/)[0];
let css = page.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
css = css.replace(/Minecraft/g, 'p').replace(/Pixelify Sans/g, 'q').replace(/url\((fonts\/[^)?]+)(?:\?[^)]*)?\)/g, (_, name) => `url(data:font/woff2;base64,${readFileSync(join(root, name)).toString('base64')})`);
const markup = page.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const binary = (name, type) => `data:${type};base64,${readFileSync(join(root, name)).toString('base64')}`;
const compiled = async (entry, plugin) => (await build({ entryPoints: [join(root, entry)], bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, sourcemap: false, legalComments: 'none', plugins: plugin ? [plugin] : [] })).outputFiles[0].text;
const worker = await compiled('js/worker.js');
const splashWorker = await compiled('js/render/splashworker.js');
const lib = read('vendor/peerjs.min.js');
const replacements = {
  name: 'local-resources',
  setup(api) {
    api.onResolve({ filter: /\.js\?v=/ }, args => ({ path: resolve(args.resolveDir, args.path.split('?')[0]) }));
    api.onLoad({ filter: /[\\/]page\.js$/ }, () => ({ contents: `import {mount} from './surface.js';mount(${JSON.stringify(markup)},${JSON.stringify(css)});`, loader: 'js' }));
    api.onLoad({ filter: /[\\/](?:main|splash|world|net)\.js$/ }, args => {
      let source = readFileSync(args.path, 'utf8');
      if (args.path.endsWith(join('net', 'net.js'))) {
        source = read('net-config.js').replace('window.BLOCKHAVEN_NET =', 'const __defaultConfig =') + '\n' + source.replace('...(window.BLOCKHAVEN_NET || {})', '...__defaultConfig, ...(window.BLOCKHAVEN_NET || {})');
      }
      // Replacer functions, not strings: in a replacement string "$&" and the like are patterns, and
      // minified code is full of them (a variable named $ masked with $&1).
      source = source.replace(/new URL\(['"]\.\.\/worker\.js[^'"]*['"], import\.meta\.url\)/g, () => `__resource('a',${JSON.stringify(worker)})`);
      source = source.replace(/new URL\(['"]\.\/render\/splashworker\.js[^'"]*['"], import\.meta\.url\)/g, () => `__resource('b',${JSON.stringify(splashWorker)})`);
      source = source.replace(/new URL\(['"]\.\.\/\.\.\/vendor\/peerjs\.min\.js[^'"]*['"], import\.meta\.url\)\.href/g, () => `__resource('c',${JSON.stringify(lib)})`);
      source = source.replace(/fetch\('assets\/default-pack\.zip[^']*'/g, () => `fetch(${JSON.stringify(binary('assets/default-pack.zip', 'application/zip'))}`);
      if (source.includes('__resource(')) source = `const __urls=new Map();function __resource(k,s){if(!__urls.has(k))__urls.set(k,URL.createObjectURL(new Blob([s],{type:'text/javascript'})));return __urls.get(k)}\n` + source;
      return { contents: source, loader: 'js' };
    });
  }
};
// Load configuration before networking modules; keep existing custom-server and
// storage keys compatible with previous saves.
const entry = join(out, '.entry.mjs');
writeFileSync(entry, `import ${JSON.stringify(join(root, 'js/main.js').replace(/\\/g, '/'))};`);
const code = (await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, legalComments: 'none', plugins: [replacements] })).outputFiles[0].text;
const payload = gzipSync(Buffer.from(code), { level: 9 });
const digest = createHash('sha256').update(payload).digest('hex');
const name = digest.slice(0, 24) + '.bin';
writeFileSync(join(out, name), payload);
const boot = `try{const r=await fetch('./${name}',{credentials:'omit',referrerPolicy:'no-referrer'});if(!r.ok)throw Error();const a=await r.arrayBuffer();const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',a)),n=>n.toString(16).padStart(2,'0')).join('');if(h!=='${digest}')throw Error('Resource verification failed');const s=new Blob([a]).stream().pipeThrough(new DecompressionStream('gzip'));const b=await new Response(s).blob();const u=URL.createObjectURL(new Blob([b],{type:'text/javascript'}));await import(u)}catch(e){const c=document.querySelector('canvas'),x=c.getContext('2d');c.width=innerWidth;c.height=innerHeight;x.fillStyle='#222';x.fillRect(0,0,c.width,c.height);x.fillStyle='#fff';x.font='18px sans-serif';x.fillText('Unable to open. Please reload.',24,48);console.error(e)}`;
const hash = `'sha256-${createHash('sha256').update(boot).digest('base64')}'`;
const csp = `default-src 'none'; script-src blob: ${hash}; script-src-attr 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'self' data: https: wss: http: ws:; worker-src blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`;
writeFileSync(join(out, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">${identity}<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{width:100%;height:100%;display:block}</style></head><body><canvas></canvas><script type="module">${boot}</script></body></html>`);
// The shared calculator (../calc.html) and vercel.json are packed by docs/games/tools/build.mjs.
writeFileSync(join(out, 'third-party-notices.txt'), ['fonts/LICENSE-minecraft-font.txt', 'fonts/LICENSE-pixelify-sans.txt', 'vendor/LICENSE-peerjs.txt'].map(n => `${n}\n${read(n)}`).join('\n\n'));
// Remove only our known temporary entry file, never a computed output tree.
unlinkSync(entry);
console.log(`built ${out}: ${payload.length} bytes, one packed resource`);

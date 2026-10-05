// Static-host compatible defense in depth, shared by every calculator-launched game. Each game's
// tools/security.mjs syncs its own index.html through syncPages() and then calls syncSite(), which
// syncs the shared calculator page and docs/games/vercel.json (one Vercel project serves the
// calculator and every game, so its header policy carries the hashes of all those pages).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const gamesRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const scriptHashes = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([, attrs, body]) => !/\bsrc\s*=/i.test(attrs) && body.trim())
  .map(([, , body]) => `'sha256-${createHash('sha256').update(body.replace(/\r\n?/g, '\n')).digest('base64')}'`);

export function policy(hashes) {
  return [
    "default-src 'none'",
    `script-src 'self' ${[...new Set(hashes)].join(' ')}`,
    "script-src-attr 'none'",
    // Existing UI changes CSS variables/styles at runtime. No inline JavaScript is allowed.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "font-src 'self'", "media-src 'self' data: blob:",
    // Custom multiplayer servers are a supported feature: do not silently pin one provider.
    // HTTP/WS remain for existing custom/local servers; production defaults all use TLS.
    // This is deliberately not an exfiltration firewall once an attacker can run code.
    "connect-src 'self' https: wss: http: ws:",
    // The networking keepalive uses a locally created blob worker.
    "worker-src 'self' blob:", "frame-src 'self'", "object-src 'none'",
    "base-uri 'none'", "form-action 'none'",
  ].join('; ');
}

// Rewrites each page's early CSP <meta> (and the single no-referrer <meta>) from its inline scripts.
export function syncPages(root, pages, check = false) {
  const hashes = [], changes = [];
  for (const name of pages) {
    const path = join(root, name), original = readFileSync(path, 'utf8'), source = original.replace(/\r\n?/g, '\n');
    const own = scriptHashes(source); hashes.push(...own);
    const clean = source.replace(/\n<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')
      .replace(/\n<meta name="referrer"[^>]*>/g, '');
    const next = clean.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${policy(own)}">\n<meta name="referrer" content="no-referrer">`);
    if (original !== next) { changes.push(name); if (!check) writeFileSync(path, next); }
  }
  return { hashes, changes };
}

// The calculator-launched games: the folders named in calc.html's GAMES table (other folders under
// docs/games are ordinary arcade games and are not part of this deployment).
export const gameFolders = (root = gamesRoot) => {
  const table = readFileSync(join(root, 'calc.html'), 'utf8').match(/const GAMES = \{([^}]*)\}/)[1];
  return [...new Set([...table.matchAll(/:\s*'([a-z0-9]+)'/g)].map(m => m[1]))].filter(g => existsSync(join(root, g, 'index.html'))).sort();
};

export function siteHeaders(root = gamesRoot) {
  const hashes = [...scriptHashes(readFileSync(join(root, 'calc.html'), 'utf8'))];
  for (const g of gameFolders(root)) hashes.push(...scriptHashes(readFileSync(join(root, g, 'index.html'), 'utf8')));
  return {
    'Content-Security-Policy': policy(hashes),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'X-DNS-Prefetch-Control': 'off',
  };
}

export function syncSite(root = gamesRoot, check = false) {
  const { changes } = syncPages(root, ['calc.html'], check);
  // Keep the root rewrite and any unrelated routes. Legacy Vercel routes cannot coexist with the
  // top-level headers key, so attach response headers in a continuing route.
  const path = join(root, 'vercel.json'), source = existsSync(path) ? readFileSync(path, 'utf8') : '{"$schema":"https://openapi.vercel.sh/vercel.json","routes":[{"src":"^/$","dest":"/calc.html"}]}';
  const config = JSON.parse(source), headers = siteHeaders(root);
  const route = (config.routes || []).find(r => r.src === '/(.*)' && r.continue === true && r.headers?.['Content-Security-Policy']);
  if (route) Object.assign(route.headers, headers);
  else config.routes = [{ src: '/(.*)', headers, continue: true }, ...(config.routes || [])];
  const next = JSON.stringify(config, null, 2) + '\n';
  if (source !== next) { changes.push('vercel.json'); if (!check) writeFileSync(path, next); }
  return changes;
}

export function report(changes, check) {
  if (check && changes.length) {
    console.error(`security policy check FAILED: ${changes.join(', ')}; run tools/stamp.mjs to regenerate policies.`);
    return 1;
  }
  console.log(check ? 'security policy check ok' : `security policies synchronized (${changes.length} files)`);
  return 0;
}

// node docs/games/tools/security.mjs [--check]: the calculator page and vercel.json only.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  process.exit(report(syncSite(gamesRoot, check), check));
}

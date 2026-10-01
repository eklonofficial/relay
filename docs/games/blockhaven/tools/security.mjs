// Static-host compatible defense in depth. Run via stamp.mjs before publishing;
// --check in CI catches inline-script edits without corresponding CSP hash updates.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const scriptHashes = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter(([, attrs, body]) => !/\bsrc\s*=/i.test(attrs) && body.trim())
  .map(([, , body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);

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

export function syncSecurity(root, check = false) {
  const pages = ['index.html', 'calc.html'];
  const hashes = [], changes = [];
  for (const name of pages) {
    const path = join(root, name), source = readFileSync(path, 'utf8');
    const own = scriptHashes(source); hashes.push(...own);
    const clean = source.replace(/\n<meta http-equiv="Content-Security-Policy"[^>]*>/g, '')
      .replace(/\n<meta name="referrer"[^>]*>/g, '');
    const next = clean.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${policy(own)}">\n<meta name="referrer" content="no-referrer">`);
    if (source !== next) { changes.push(name); if (!check) writeFileSync(path, next); }
  }
  // Keep the existing root rewrite and any unrelated routes. Legacy Vercel routes cannot
  // coexist with the top-level headers key, so attach response headers in a continuing route.
  const path = join(root, 'vercel.json'), source = readFileSync(path, 'utf8'), config = JSON.parse(source);
  const headers = {
    'Content-Security-Policy': policy(hashes),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    'X-DNS-Prefetch-Control': 'off',
  };
  const route = (config.routes || []).find(r => r.src === '/(.*)' && r.continue === true && r.headers?.['Content-Security-Policy']);
  if (route) Object.assign(route.headers, headers);
  else config.routes = [{ src: '/(.*)', headers, continue: true }, ...(config.routes || [])];
  const next = JSON.stringify(config, null, 2) + '\n';
  if (source !== next) { changes.push('vercel.json'); if (!check) writeFileSync(path, next); }
  if (check && changes.length) {
    console.error(`security policy check FAILED: ${changes.join(', ')}; run tools/stamp.mjs to regenerate policies.`);
    return 1;
  }
  console.log(check ? 'security policy check ok' : `security policies synchronized (${changes.length} files)`);
  return 0;
}

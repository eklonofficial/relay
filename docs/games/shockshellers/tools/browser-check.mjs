// Real browser regression checks against the PACKED site (build/games/). The test-only attachShadow
// instrumentation is deliberate: production does not publish this reference or application state.
// Adapted from Blockhaven's browser-check.mjs (same server, captures, boundary demonstrations).
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
// This game's expression, read from the shared calculator's table (never written here).
const secret = [...readFileSync(new URL('../../calc.html', import.meta.url), 'utf8').match(/const GAMES = \{([^}]*)\}/)[1].matchAll(/'([^']*)'\s*:\s*'([a-z0-9]+)'/g)].find(m => m[2] === 'shockshellers')[1];
const dep = process.argv.includes('--dependencies') ? resolve(process.argv[process.argv.indexOf('--dependencies') + 1]) : process.cwd();
const { chromium } = createRequire(resolve(dep, 'package.json'))('playwright');
const root = resolve(process.env.SITE_OUTPUT || 'build/games');
const captures = resolve('build/checks/shockshellers'); await mkdir(captures, { recursive: true });
const types = { '.html': 'text/html', '.bin': 'application/octet-stream', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const p = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!p.startsWith(root + sep) && p !== root) { res.writeHead(403).end(); return; }
  try { const f = p === root ? resolve(root, 'index.html') : p; const bytes = await readFile(f); res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' }).end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser, page;
const errors = [], requests = [], wakes = [];
try {
  const launch = { headless: true, args: ['--no-proxy-server', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  if (process.env.BROWSER_EXECUTABLE) launch.executablePath = process.env.BROWSER_EXECUTABLE;
  else if (process.platform === 'win32') launch.channel = 'msedge';
  browser = await chromium.launch(launch);
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  // The one outside request the page makes on its own is the wake-up of the project relay (it sleeps
  // when idle; see net-config.js), so only that exact URL is set aside; anything else is recorded.
  page.on('request', r => { if (!/^https?:/.test(r.url())) return; const u = new URL(r.url()); if (u.host === 'blockhaven-relay.onrender.com' && u.pathname === '/health') { wakes.push(u.href); return; } requests.push(u.pathname); });
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { const root = original.call(this, options); if (options.mode === 'closed') window.testRoot = root; return root; };
    window.observed = [];
    const scan = node => {
      if (node.nodeType === 3) window.observed.push(node.data);
      if (node.nodeType === 1) { window.observed.push(...[...node.attributes].map(a => a.value)); node.childNodes.forEach(scan); }
    };
    new MutationObserver(records => {
      for (const r of records) {
        if (r.type === 'characterData') window.observed.push(r.target.data);
        if (r.type === 'attributes') window.observed.push(r.target.getAttribute(r.attributeName) || '');
        if (r.type === 'childList') r.addedNodes.forEach(scan);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    // Test-only MAIN-world instrumentation demonstrates the endpoint boundary.
    window.paintedLabels = new Set();
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) { if (window.paintedLabels.size < 4096) window.paintedLabels.add(String(args[0])); return fill.apply(this, args); };
    // No real servers from CI: matches stay offline; skip the first-run How to Play wait.
    localStorage.setItem('shockshellers.net', JSON.stringify({ offline: true, brokers: [] }));
    localStorage.setItem('shockshellers.settings.v1', JSON.stringify({ seenHowTo: true, autoDetail: false }));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/shockshellers';
  await page.goto(base + '/index.html', { waitUntil: 'commit' });
  await page.waitForFunction(() => window.testRoot?.getElementById('boot') == null && !window.testRoot?.getElementById('home')?.classList.contains('hidden'), null, { polling: 100 });
  const publicState = () => page.evaluate(() => ({ text: document.body.innerText, controls: document.querySelectorAll('button,input,select,textarea').length, published: 'shockshellers' in window, observed: window.observed }));
  assert.deepEqual((await publicState()).text, ''); assert.equal((await publicState()).controls, 0); assert.equal((await publicState()).published, false);
  assert.equal(await page.title(), 'Graphing Calculator');
  const originalIcon = await page.locator('link[rel="icon"]').getAttribute('href');
  assert.ok(originalIcon.startsWith('data:image/svg+xml,'));
  // These assertions intentionally prove what privileged access CAN recover.
  const debuggerSession = await page.context().newCDPSession(page);
  // Retry briefly: the debugger's snapshot can lag the page by a moment while the packed bundle settles.
  let debugDOM;
  for (let i = 0; i < 20; i++) { debugDOM = await debuggerSession.send('DOM.getDocument', { depth: -1, pierce: true }); if (/"shadowRootType":"closed"/.test(JSON.stringify(debugDOM))) break; await page.waitForTimeout(250); }
  assert.match(JSON.stringify(debugDOM), /"shadowRootType":"closed"/);
  assert.match(JSON.stringify(debugDOM), /btn-play/);
  await debuggerSession.detach();
  await page.waitForFunction(() => window.paintedLabels.has('PLAY'));
  const mainResource = requests.find(p => /shockshellers\/[a-f0-9]{24}\.bin$/.test(p));
  assert.ok(mainResource);
  assert.match(gunzipSync(await readFile(resolve(root, '.' + mainResource))).toString('utf8'), /PLAY WITH FRIENDS/);
  const boundaryEvidence = { earlyHookReadsClosedLayout: true, debuggerReadsClosedLayout: true, drawingHookReadsLabels: true, packedResourceIsDecodable: true };
  const click = async id => { const box = await page.evaluate(id => { const r = window.testRoot.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id); await page.mouse.click(box.x, box.y); };
  const text = id => page.evaluate(id => window.testRoot.getElementById(id).textContent, id);
  await page.screenshot({ path: resolve(captures, 'home.png') });
  console.log('startup and public-DOM checks passed');
  // Typed name, weapon choice and the mode drop-up through real input.
  await click('name'); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('PrivateEgg');
  assert.equal(await page.evaluate(() => window.testRoot.getElementById('name').value), 'PrivateEgg');
  await page.evaluate(() => { const b = window.testRoot.querySelectorAll('#home-weapons button')[4]; b.id = 'test-weapon'; });
  await click('test-weapon');
  await page.waitForFunction(() => window.testRoot.getElementById('weapon-name').textContent === 'BEATER');
  await click('mode-btn'); await page.waitForFunction(() => !window.testRoot.getElementById('mode-list-wrap').classList.contains('hidden'));
  await click('mode-btn');
  await click('btn-settings'); await page.waitForFunction(() => !window.testRoot.getElementById('settings').classList.contains('hidden'));
  await page.screenshot({ path: resolve(captures, 'settings.png') });
  await click('set-tab-2'); await click('set-ok');
  // PLAY: a bot-filled match, joined on the respawn screen.
  await click('btn-play');
  await page.waitForFunction(() => !window.testRoot.getElementById('respawn').classList.contains('hidden') && window.testRoot.querySelectorAll('#board-list .lb').length >= 6, null, { polling: 100 });
  await page.screenshot({ path: resolve(captures, 'respawn.png') });
  // Quit through the canvas-rendered confirm dialog, then run the input checks in a custom match
  // with no bots, so nothing can crack the test egg mid-check.
  await click('btn-quit');
  await page.waitForFunction(() => [...window.testRoot.querySelectorAll('.screen button')].some(b => b.textContent === 'OK'));
  await page.evaluate(() => { [...window.testRoot.querySelectorAll('.screen button')].find(b => b.textContent === 'OK').id = 'test-ok'; });
  await click('test-ok');
  await page.waitForFunction(() => !window.testRoot.getElementById('home').classList.contains('hidden'));
  await click('btn-friends'); await click('btn-create');
  await page.waitForFunction(() => !window.testRoot.getElementById('custom').classList.contains('hidden'));
  await page.evaluate(() => { [...window.testRoot.querySelectorAll('#cu-bots button')].find(b => b.textContent === 'None').id = 'test-nobots'; });
  await click('test-nobots');
  await page.screenshot({ path: resolve(captures, 'custom.png') });
  await click('cu-start');
  await page.waitForFunction(() => !window.testRoot.getElementById('respawn').classList.contains('hidden') && window.testRoot.querySelectorAll('#board-list .lb').length === 1, null, { polling: 100 });
  await page.waitForFunction(() => window.testRoot.getElementById('rs-play').textContent.includes('PLAY'), null, { polling: 100 });
  await click('rs-play');
  await page.waitForFunction(() => document.pointerLockElement?.tagName === 'CANVAS' && window.testRoot.getElementById('respawn').classList.contains('hidden'), null, { polling: 100 });
  await page.keyboard.press('F3');
  await page.waitForFunction(() => /XYZ/.test(window.testRoot.getElementById('debug').textContent), null, { polling: 100 });
  const position = async () => (await text('debug')).match(/XYZ: ([\d.-]+) \/ ([\d.-]+) \/ ([\d.-]+)/).slice(1).map(Number);
  const before = await position();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1200); await page.keyboard.up('KeyW');
  await page.waitForFunction(b => { const m = window.testRoot.getElementById('debug').textContent.match(/XYZ: ([\d.-]+) \/ [\d.-]+ \/ ([\d.-]+)/); return m && Math.hypot(m[1] - b[0], m[2] - b[2]) > 0.1; }, before, { timeout: 15000, polling: 100 }).catch(() => {});
  const after = await position();
  assert.ok(Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.1, 'W must move the egg, not merely deliver a key event');
  const facing = async () => (await text('debug')).match(/Facing: (\d+)/)[1];
  const beforeLook = await facing();
  await page.evaluate(() => { for (let i = 0; i < 6; i++) {
    const event = new PointerEvent('pointerrawupdate', { bubbles: true, composed: true, movementX: 120, movementY: 0 });
    Object.defineProperty(event, 'getCoalescedEvents', { value: () => [] });
    document.pointerLockElement.dispatchEvent(event);
  } });
  await page.waitForFunction(b => window.testRoot.getElementById('debug').textContent.match(/Facing: (\d+)/)?.[1] !== b, beforeLook, { timeout: 15000, polling: 100 }).catch(() => {});
  assert.notEqual(await facing(), beforeLook, 'locked pointer input must turn the camera');
  // Firing spends rounds: the HUD's magazine count drops (the Beater was picked above).
  const ammo = async () => Number((await text('ammo-n')).split('/')[0]);
  const fullMag = await ammo();
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await page.waitForFunction(n => Number(window.testRoot.getElementById('ammo-n').textContent.split('/')[0]) < n, fullMag, { timeout: 15000, polling: 100 });
  await page.screenshot({ path: resolve(captures, 'play.png') });
  // Chat: Enter opens it, typed text stays in the closed tree, Enter sends.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !window.testRoot.getElementById('chat-input').classList.contains('hidden'));
  await page.keyboard.type('Private hello'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.testRoot.getElementById('chat-lines').textContent.includes('Private hello'));
  console.log('menus, match, movement, look, firing and chat passed');
  assert.equal((await publicState()).text, ''); assert.equal((await publicState()).controls, 0);
  assert.doesNotMatch((await publicState()).observed.join(' '), /PrivateEgg|Private hello|PLAY WITH FRIENDS|Challenges|BEST/);
  const fontState = await page.evaluate(() => [...document.fonts].filter(f => f.family === 's' || f.family === 'n').map(f => f.status));
  assert.ok(fontState.length && fontState.every(s => s === 'loaded'), 'packed fonts must load');
  // Quick hide with the shared calculator, then the secret resumes.
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => !window.testRoot.getElementById('respawn').classList.contains('hidden'));
  await page.keyboard.press('KeyJ'); await page.waitForFunction(() => document.querySelector('iframe')?.style.display === 'block');
  assert.equal(await page.title(), 'Graphing Calculator');
  const calculator = page.frames().find(f => f !== page.mainFrame());
  await calculator.waitForFunction(() => !!window.testRoot?.querySelector('input.ex'));
  const calcBox = await calculator.evaluate(() => { const r = window.testRoot.querySelector('input.ex').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(calcBox.x, calcBox.y); await page.keyboard.type(secret); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('iframe').style.display === 'none');
  assert.equal(await page.title(), 'Graphing Calculator');
  assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'), originalIcon);
  assert.ok(requests.every(p => /\/(?:index\.html|calc\.html|[a-f0-9]{24}\.bin)$/.test(p)), JSON.stringify(requests));
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 800, height: 600 }); await page.screenshot({ path: resolve(captures, 'small.png') });
  await writeFile(resolve(captures, 'results.json'), JSON.stringify({ requests, fontState, errors, boundaryEvidence }, null, 2));
  const tampered = await browser.newPage();
  await tampered.route('**/*.bin', route => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'modified' }));
  await tampered.goto(base + '/index.html');
  await tampered.waitForFunction(() => document.querySelector('canvas')?.width === innerWidth && !document.querySelector('div'));
  await tampered.close();
  console.log('browser checks passed: canvas UI, native input, menus, match, chat, calculator, resize and opaque resources');
} catch (error) {
  console.error('Browser errors:', errors);
  await writeFile(resolve(captures, 'failure.json'), JSON.stringify({ error: String(error), errors, requests }, null, 2));
  await page?.screenshot({ path: resolve(captures, 'failure.png'), timeout: 5000 }).catch(() => {});
  throw error;
} finally { await browser?.close(); await new Promise(r => server.close(r)); }

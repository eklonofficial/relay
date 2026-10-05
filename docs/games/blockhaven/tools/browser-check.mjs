// Real browser regression checks. The test-only attachShadow instrumentation is
// deliberate: production does not publish this reference or application state.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
// This game's expression, read from the shared calculator's table (never written here).
const secret = [...readFileSync(new URL('../../calc.html', import.meta.url), 'utf8').match(/const GAMES = \{([^}]*)\}/)[1].matchAll(/'([^']*)'\s*:\s*'([a-z0-9]+)'/g)].find(m => m[2] === 'blockhaven')[1];
const dep = process.argv.includes('--dependencies') ? resolve(process.argv[process.argv.indexOf('--dependencies') + 1]) : process.cwd();
const { chromium } = createRequire(resolve(dep, 'package.json'))('playwright');
const root = resolve(process.env.SITE_OUTPUT || 'build/games');
const captures = resolve('build/checks'); await mkdir(captures, { recursive: true });
const types = { '.html': 'text/html', '.bin': 'application/octet-stream', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  const p = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!p.startsWith(root + sep) && p !== root) { res.writeHead(403).end(); return; }
  try { const f = p === root ? resolve(root, 'index.html') : p; const bytes = await readFile(f); res.writeHead(200, { 'Content-Type': types[extname(f)] || 'application/octet-stream' }).end(bytes); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser, page;
const errors = [], requests = [];
try {
  const launch = { headless: true, args: ['--no-proxy-server', '--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
  if (process.env.BROWSER_EXECUTABLE) launch.executablePath = process.env.BROWSER_EXECUTABLE;
  else if (process.platform === 'win32') launch.channel = 'msedge';
  browser = await chromium.launch(launch);
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(180000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(new URL(r.url()).pathname); });
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { const root = original.call(this, options); if (options.mode === 'closed') window.testRoot = root; return root; };
    window.observed = [];
    const scan = node => {
      if (node.nodeType === 3) window.observed.push(node.data);
      if (node.nodeType === 1) {
        window.observed.push(...[...node.attributes].map(a => a.value));
        node.childNodes.forEach(scan);
      }
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
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      if (window.paintedLabels.size < 1024) window.paintedLabels.add(String(args[0]));
      return fill.apply(this, args);
    };
    // Smaller streamed area keeps CI focused on behavior, with the same assets.
    localStorage.setItem('blockhaven.settings.v2', JSON.stringify({ renderDistance: 3, graphics: 0 }));
  });
  const base = 'http://127.0.0.1:' + server.address().port + '/blockhaven';
  await page.goto(base + '/index.html', { waitUntil: 'commit' });
  // Poll readiness independently of Chromium's animation-frame scheduling:
  // software-rendered CI can miss RAF polls while the title panorama is busy.
  await page.waitForFunction(() => window.testRoot?.getElementById('boot') == null && !!window.testRoot?.getElementById('btn-play'), null, {polling:100});
  const publicState = () => page.evaluate(() => ({ text: document.body.innerText, controls: document.querySelectorAll('button,input,select,textarea').length, published: 'blockhaven' in window, observed: window.observed }));
  assert.deepEqual((await publicState()).text, ''); assert.equal((await publicState()).controls, 0); assert.equal((await publicState()).published, false);
  assert.equal(await page.title(), 'Graphing Calculator');
  const originalIcon = await page.locator('link[rel="icon"]').getAttribute('href');
  assert.ok(originalIcon.startsWith('data:image/svg+xml,'));
  // These assertions intentionally prove what privileged access CAN recover.
  // chrome.debugger exposes DOM/Runtime; no screenshot analysis is involved.
  const debuggerSession = await page.context().newCDPSession(page);
  const debugDOM = await debuggerSession.send('DOM.getDocument', { depth: -1, pierce: true });
  assert.match(JSON.stringify(debugDOM), /"shadowRootType":"closed"/);
  assert.match(JSON.stringify(debugDOM), /btn-play/);
  await debuggerSession.detach();
  await page.waitForFunction(() => window.paintedLabels.has('Singleplayer'));
  const mainResource = requests.find(p => /[a-f0-9]{24}\.bin$/.test(p));
  assert.ok(mainResource);
  assert.match(gunzipSync(await readFile(resolve(root, '.' + mainResource))).toString('utf8'), /Singleplayer/);
  const boundaryEvidence = { earlyHookReadsClosedLayout: true, debuggerReadsClosedLayout: true, drawingHookReadsLabels: true, packedResourceIsDecodable: true };
  const click = async id => { const box = await page.evaluate(id => { const r = window.testRoot.getElementById(id).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id); await page.mouse.click(box.x, box.y); };
  const reference = async name => {
    await page.evaluate(() => { const layout = window.testRoot.querySelector('.surface-layout'); layout.style.opacity = '1'; layout.style.background = 'transparent'; window.testRoot.lastElementChild.style.visibility = 'hidden'; });
    await page.screenshot({path:resolve(captures, name + '-native.png')});
    await page.evaluate(() => { window.testRoot.querySelector('.surface-layout').style.opacity = '0'; window.testRoot.lastElementChild.style.visibility = ''; });
  };
  await page.screenshot({ path: resolve(captures, 'title.png') });
  await reference('title');
  console.log('startup and public-DOM checks passed');
  await click('btn-settings'); await click('set-clouds'); await click('btn-settings-done');
  await click('btn-controls'); await click('btn-controls-done'); await click('btn-guide');
  await page.screenshot({ path: resolve(captures, 'guide.png') }); await click('btn-guide-done');
  await click('btn-play'); await click('btn-world-new'); await click('cw-name');
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('Private sample');
  assert.equal(await page.evaluate(() => window.testRoot.getElementById('cw-name').value), 'Private sample');
  // Keep the seeded generator stable across checks, including resource-pack application.
  await click('cw-seed'); await page.keyboard.type('1'); await click('btn-create');
  await page.waitForFunction(() => window.testRoot.getElementById('loading').classList.contains('hidden') && !window.testRoot.getElementById('hud').classList.contains('hidden'));
  await page.mouse.click(640, 400);
  await page.keyboard.press('F3');
  await page.waitForTimeout(300);
  await page.waitForFunction(() => document.pointerLockElement?.tagName === 'CANVAS' && window.testRoot.getElementById('pause').classList.contains('hidden'));
  const position = () => page.evaluate(() => window.testRoot.getElementById('debug').textContent.match(/XYZ: ([\d.-]+) \/ ([\d.-]+) \/ ([\d.-]+)/)?.slice(1).map(Number));
  const before = await position();
  await page.keyboard.down('KeyW'); await page.waitForTimeout(1000); await page.keyboard.up('KeyW');
  await page.mouse.move(700, 420); await page.waitForTimeout(500);
  // As with the heading below: wait for the debug screen to show the new position.
  await page.waitForFunction(b => { const m = window.testRoot.getElementById('debug').textContent.match(/XYZ: ([\d.-]+) \/ [\d.-]+ \/ ([\d.-]+)/); return m && Math.hypot(m[1] - b[0], m[2] - b[2]) > 0.1; }, before, { timeout: 15000, polling: 100 }).catch(() => {});
  const after = await position();
  assert.ok(Math.hypot(after[0]-before[0],after[2]-before[2]) > 0.1, 'W must move the player, not merely deliver a key event');
  const facing = () => page.evaluate(() => window.testRoot.getElementById('debug').textContent.match(/Facing: (\w+)/)?.[1]);
  const beforeLook = await facing();
  // Headless absolute mouse injection can generate recenter pairs with net-zero
  // deltas under pointer lock. Send explicit relative samples through the real
  // locked canvas and installed event handlers; no application state is edited.
  await page.evaluate(()=>{for(let i=0;i<6;i++) {
    const event=new PointerEvent('pointerrawupdate',{bubbles:true,composed:true,movementX:180,movementY:2});
    Object.defineProperty(event,'getCoalescedEvents',{value:()=>[{movementX:0,movementY:0}]});
    document.pointerLockElement.dispatchEvent(event);
  }});
  // The debug screen refreshes every quarter second of game time, which on a software-rendered
  // runner (a few frames a second) can take well over a fixed wait: poll for the new heading.
  await page.waitForFunction(b => window.testRoot.getElementById('debug').textContent.match(/Facing: (\w+)/)?.[1] !== b, beforeLook, { timeout: 15000, polling: 100 }).catch(() => {});
  assert.notEqual(await facing(),beforeLook,'locked pointer input must turn the camera');
  await page.keyboard.press('F3');
  await page.mouse.click(640, 400); await page.keyboard.press('KeyE');
  await page.waitForFunction(() => !window.testRoot.getElementById('gui').classList.contains('hidden'));
  assert.ok(await page.evaluate(() => window.testRoot.querySelectorAll('.gs').length >= 36));
  await page.screenshot({ path: resolve(captures, 'inventory.png') });
  await reference('inventory');
  await page.keyboard.press('Escape'); await page.keyboard.press('KeyT'); await page.keyboard.type('/gamemode creative'); await page.keyboard.press('Enter');
  await page.keyboard.press('KeyE'); await page.waitForFunction(() => window.testRoot.querySelectorAll('.gs').length > 50);
  await page.screenshot({ path: resolve(captures, 'creative.png') });
  await reference('creative');
  console.log('menus, native text input and both inventories passed');
  await page.keyboard.press('KeyI');
  await page.waitForFunction(() => window.testRoot.querySelector('.csearch') && window.testRoot.activeElement === window.testRoot.querySelector('.csearch'));
  await page.keyboard.type('ron');
  assert.equal(await page.evaluate(() => window.testRoot.querySelector('.csearch').value), 'iron');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.testRoot.getElementById('gui').classList.contains('hidden'));
  await page.mouse.click(640, 400); await page.waitForFunction(() => document.pointerLockElement?.tagName === 'CANVAS');
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => !window.testRoot.getElementById('pause').classList.contains('hidden'));
  await click('btn-quit'); await page.waitForFunction(() => !window.testRoot.getElementById('title').classList.contains('hidden')); await click('btn-play');
  await page.waitForFunction(() => window.testRoot.querySelector('.world-entry'));
  await page.evaluate(() => window.testRoot.querySelector('.world-entry').click());
  const downloadPromise = page.waitForEvent('download'); await click('btn-world-download');
  const download = await downloadPromise; await download.saveAs(resolve(captures, 'sample.bhworld')); assert.equal(await download.failure(), null);
  await click('btn-world-delete'); await page.waitForFunction(() => [...window.testRoot.querySelectorAll('.screen')].some(e => e.style.zIndex === '100000'));
  await page.screenshot({ path: resolve(captures, 'dialog.png') }); await page.keyboard.press('Escape');
  assert.equal((await publicState()).text, ''); assert.equal((await publicState()).controls, 0);
  assert.doesNotMatch((await publicState()).observed.join(' '), /Private sample|Inventory|Respawn|Score|Crafting/);
  const fontState = await page.evaluate(() => [...document.fonts].filter(f => f.family === 'p').map(f => f.status));
  assert.ok(fontState.length && fontState.every(s => s === 'loaded'), 'packed fonts must load');
  console.log('search, save/download, dialog and font checks passed');
  // Quick hide must also work with a canvas-rendered calculator.
  await page.keyboard.press('KeyJ'); await page.waitForFunction(() => document.querySelector('iframe')?.style.display === 'block');
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
  console.log('browser checks passed: canvas UI, native input, menus, inventory, creative search, saves/download, dialogs, calculator, resize and opaque resources');
} catch (error) {
  console.error('Browser errors:',errors);
  console.error('Startup state:',await page?.evaluate(()=>({root:!!window.testRoot,boot:!!window.testRoot?.getElementById('boot'),play:!!window.testRoot?.getElementById('btn-play'),roots:[...document.querySelectorAll('*')].filter(e=>e.shadowRoot).map(e=>e.tagName),visibility:document.visibilityState})).catch(()=>null));
  await writeFile(resolve(captures,'failure.json'),JSON.stringify({error:String(error),errors,requests},null,2));
  await page?.screenshot({path:resolve(captures,'failure.png'),timeout:5000}).catch(()=>{});
  throw error;
} finally { await browser?.close(); await new Promise(r => server.close(r)); }

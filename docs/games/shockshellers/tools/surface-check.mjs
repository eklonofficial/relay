// Compare the compositor with native CSS at the same coordinates, without
// world generation/GPU timing. Nothing in this fixture is shipped to players.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium, firefox } = createRequire(resolve('package.json'))('playwright');
const css = (await readFile(resolve(root,'index.html'),'utf8')).match(/<style>([\s\S]*?)<\/style>/)[1];
const markup = `<canvas id="game"></canvas><div class="screen" id="fixture">
<button class="green" style="position:absolute;left:20px;top:20px;width:170px" id="button">PLAY</button>
<div class="panel" style="position:absolute;left:220px;top:20px;width:260px"><div class="head">CHALLENGES</div><div class="body"><div class="chal" style="display:flex;gap:8px"><div class="t">BACK TO BACK</div><div class="dsc">Spawn and get 2 kills</div></div></div></div>
<div class="nav" style="position:absolute;left:0;top:150px;width:200px"><button class="on"><span>HOME</span></button><button><span>PROFILE</span></button></div>
<div class="glass" style="position:absolute;left:330px;top:200px;padding:8px"><span class="h" style="font-size:22px">x0 BEST</span></div>
<input type="text" id="entry" style="position:absolute;left:20px;top:320px;width:240px" value="Egg name">
</div>`;
const runner = `import {mount,surfaceDocument,paint} from '/js/surface.js';
mount(${JSON.stringify(markup)},${JSON.stringify(css)});
window.fixture={document:surfaceDocument,paint};
surfaceDocument.getElementById('button').onclick=()=>window.clicked=(window.clicked||0)+1;
surfaceDocument.addEventListener('keydown',e=>{window.lastKey=e.code});
await document.fonts.ready;paint();window.ready=true;`;
const server = createServer(async (req,res)=>{
  if(req.url==='/') {res.end('<!doctype html><style>body{margin:0;background:#000}</style><script type="module" src="/runner.js"></script>');return;}
  if(req.url==='/runner.js'){res.setHeader('Content-Type','text/javascript');res.end(runner);return;}
  const file=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',extname(file)==='.js'?'text/javascript':extname(file)==='.woff2'?'font/woff2':'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
  const engine=process.env.SURFACE_BROWSER==='firefox'?firefox:chromium;
  browser=await engine.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:640,height:480}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{const original=Element.prototype.attachShadow;Element.prototype.attachShadow=function(o){return window.testRoot=original.call(this,o)};});
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.ready);
  await page.waitForTimeout(400);
  await page.evaluate(()=>fixture.paint());
  const rendered=await page.screenshot();
  await page.evaluate(()=>{const layout=testRoot.querySelector('.surface-layout');layout.style.opacity='1';layout.style.background='transparent';testRoot.lastElementChild.style.visibility='hidden';});
  const native=await page.screenshot();
  const comparison=await page.evaluate(async([a,b])=>{
    const pixels=async base64=>{const img=new Image();img.src='data:image/png;base64,'+base64;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height).data;};
    const x=await pixels(a),y=await pixels(b);let changed=0,error=0;
    for(let i=0;i<x.length;i+=4){let d=0;for(let j=0;j<3;j++)d+=Math.abs(x[i+j]-y[i+j]);error+=d;if(d>60)changed++;}
    return {changedFraction:changed/(x.length/4),meanError:error/(x.length/4*3)};
  },[rendered.toString('base64'),native.toString('base64')]);
  await mkdir('build/checks/shockshellers',{recursive:true});
  await writeFile('build/checks/shockshellers/surface-canvas.png',rendered);await writeFile('build/checks/shockshellers/surface-native.png',native);
  console.log('surface comparison',comparison);
  assert.ok(comparison.changedFraction<0.015 && comparison.meanError<2,'canvas must preserve native layout, glyph orientation, panel borders and pseudo-element sizes');
  await page.evaluate(()=>{testRoot.querySelector('.surface-layout').style.opacity='0';testRoot.lastElementChild.style.visibility='';});
  await page.mouse.click(100,40);assert.equal(await page.evaluate(()=>window.clicked),1);
  await page.mouse.click(60,337);await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('Edited');
  assert.equal(await page.evaluate(()=>fixture.document.getElementById('entry').value),'Edited');
  await page.evaluate(()=>{fixture.document.getElementById('fixture').classList.add('hidden');fixture.document.getElementById('game').focus();});
  await page.keyboard.press('KeyW');assert.equal(await page.evaluate(()=>window.lastKey),'KeyW');
  assert.equal(await page.evaluate(()=>document.elementFromPoint(320,240)===fixture.document.getElementById('game')),true,'hidden layout must not intercept world clicks');
  assert.deepEqual(errors,[]);
  console.log('surface checks passed: visual parity, input, focus and click-through');
} finally {await browser?.close();await new Promise(r=>server.close(r));}

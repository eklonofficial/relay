// Opt-in end-to-end smoke check against a deployed relay. Separate browser
// contexts keep test worlds/settings isolated from real user profiles.
// SITE_URL=https://.../index.html RELAY_URL=wss://.../mqtt node tools/multiplayer-check.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const site=process.env.SITE_URL,relay=process.env.RELAY_URL;
if(!site||!relay) throw Error('Set SITE_URL and RELAY_URL explicitly.');
const browser=await chromium.launch({headless:true,args:['--no-proxy-server','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const pages=[],errors=[],sockets=[];
try {
  for(const name of ['RelayHost','RelayGuest']) {
    const context=await browser.newContext({viewport:{width:1280,height:800}});
    await context.addInitScript(({name,relay})=>{
      const attach=Element.prototype.attachShadow;
      Element.prototype.attachShadow=function(options){const root=attach.call(this,options);if(options.mode==='closed')window.testRoot=root;return root;};
      // Disable both direct paths; a passing test must use this specific relay.
      window.Peer=class {constructor(){throw Error('Direct connections disabled by relay test');}};
      localStorage.setItem('blockhaven.net',JSON.stringify({brokers:[relay],wake:[],iceServers:[],forceRelay:true}));
      localStorage.setItem('blockhaven.settings.v2',JSON.stringify({mpName:name,renderDistance:3,graphics:0}));
    },{name,relay});
    const page=await context.newPage();page.setDefaultTimeout(120000);
    page.on('pageerror',e=>errors.push(e.message));
    page.on('websocket',s=>sockets.push(s.url()));
    await page.goto(site,{waitUntil:'commit'});
    await page.waitForFunction(()=>window.testRoot?.getElementById('boot')==null&&!!window.testRoot?.getElementById('btn-play'));
    pages.push(page);
    console.log(`${name}: title ready`);
  }
  const [host,guest]=pages;
  const click=async(page,id)=>{await page.bringToFront();const box=await page.evaluate(id=>{const r=window.testRoot.getElementById(id).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};},id);await page.mouse.click(box.x,box.y);};
  const playing=page=>page.waitForFunction(()=>window.testRoot.getElementById('loading').classList.contains('hidden')&&!window.testRoot.getElementById('hud').classList.contains('hidden'));
  await click(host,'btn-play');await click(host,'btn-world-new');await click(host,'cw-name');
  await host.keyboard.press('ControlOrMeta+A');await host.keyboard.type('Relay smoke test');
  await click(host,'cw-seed');await host.keyboard.type('1');await click(host,'btn-create');await playing(host);
  console.log('Host world ready');
  await host.evaluate(()=>document.exitPointerLock());
  await host.waitForFunction(()=>!window.testRoot.getElementById('pause').classList.contains('hidden'));
  await click(host,'btn-open');
  await host.waitForFunction(()=>window.testRoot.getElementById('room-info').querySelector('b'));
  const code=await host.evaluate(()=>window.testRoot.getElementById('room-info').querySelector('b').textContent);
  assert.match(code,/^[A-Z2-9]{5}$/);
  console.log('Relay room open');
  await click(guest,'btn-mp');await click(guest,'mp-code');await guest.keyboard.type(code);await click(guest,'btn-mp-join');
  await playing(guest);
  console.log('Guest world ready');
  await host.waitForFunction(()=>window.testRoot.getElementById('chat').textContent.includes('RelayGuest joined'));
  if(await guest.evaluate(()=>!window.testRoot.getElementById('pause').classList.contains('hidden'))) await click(guest,'btn-resume');
  await guest.keyboard.press('KeyT');await guest.keyboard.type('Live relay verified');await guest.keyboard.press('Enter');
  await host.waitForFunction(()=>window.testRoot.getElementById('chat').textContent.includes('Live relay verified'));
  assert.ok(sockets.length>=2&&sockets.every(s=>s===relay),JSON.stringify(sockets));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',hostJoinWorldAndChat:true,relayOnly:true,sockets,errors}));
} catch(error) {
  console.error('Browser errors:',errors);
  for(const page of pages) console.error(await page.evaluate(()=>({status:window.testRoot?.getElementById('mp-status')?.textContent,room:window.testRoot?.getElementById('room-info')?.textContent})).catch(()=>null));
  throw error;
} finally {await browser.close();}

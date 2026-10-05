import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import WebSocket from 'ws';
import {hostRoom,joinRoom,Mesh} from '../docs/games/blockhaven/js/net/transport.js';
import {SealedChannel} from '../docs/games/blockhaven/js/net/sealed.js';
import {Link} from '../docs/games/blockhaven/js/net/net.js';
globalThis.window=globalThis;
globalThis.WebSocket=WebSocket;

function deadline(p,ms=12000) {
  let timer;
  return Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out')),ms)})]).finally(()=>clearTimeout(timer));
}
async function launch(t) {
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const child=spawn(process.execPath,[new URL('server.js',import.meta.url).pathname],{env:{...process.env,PORT:String(port),ALLOWED_ORIGINS:''},stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  await deadline(once(child.stdout,'data'));
  return {child,url:`ws://127.0.0.1:${port}/mqtt`,health:`http://127.0.0.1:${port}/health`};
}
test('two players exchange encrypted, fragmented Unicode data through the actual MQTT server',async t=>{
  const server=await launch(t),cfg={brokers:[server.url],iceServers:[],forceRelay:true},code='TEST'+crypto.randomUUID();
  let hostLink,guestLink;
  const room=await hostRoom(code,cfg,ch=>{hostLink=new Link(new SealedChannel(ch));hostLink.onMessage=m=>hostLink.send({echo:m});});
  t.after(()=>{guestLink?.close();hostLink?.close();room.close();});
  const guest=await joinRoom(code,cfg);
  guestLink=new Link(new SealedChannel(guest.channel));
  const payload={t:'test',text:'Relay payload ⛏️ '.repeat(12000)};
  const response=new Promise((resolve,reject)=>{guestLink.onMessage=resolve;guestLink.onClose=()=>reject(Error('Connection closed'));});
  guestLink.send(payload);
  assert.deepEqual(await deadline(response),{echo:payload});
  assert.equal(guest.relayed,true);
});
test('malformed MQTT packets cannot take down every player',async t=>{
  const server=await launch(t);
  const ws=new WebSocket(server.url,'mqtt');t.after(()=>ws.terminate());await once(ws,'open');
  const connect=Buffer.from([0x10,14,0,4,77,81,84,84,4,2,0,60,0,2,113,97]);
  ws.send(connect);await once(ws,'message');
  const closed=once(ws,'close');ws.send(Buffer.from([0x30,0]));await deadline(closed);
  await new Promise(r=>setTimeout(r,100));
  assert.equal(server.child.exitCode,null,'an invalid publish must close that client, not crash the relay');
  assert.equal((await fetch(server.health)).status,200);
});
test('each calculator game may use its own topic root; other roots are refused',async t=>{
  const server=await launch(t);
  const ws=new WebSocket(server.url,'mqtt');t.after(()=>ws.terminate());await once(ws,'open');
  ws.send(Buffer.from([0x10,14,0,4,77,81,84,84,4,2,0,60,0,2,113,97]));await once(ws,'message');
  const topics=['blockhaven/v1/A/h','shockshellers/v1/A/h','other/v1/A/h'];
  const body=Buffer.concat([Buffer.from([0,7]),...topics.map(s=>Buffer.concat([Buffer.from([0,s.length]),Buffer.from(s),Buffer.from([0])]))]);
  ws.send(Buffer.concat([Buffer.from([0x82,body.length]),body]));
  const [ack]=await deadline(once(ws,'message'));
  assert.deepEqual([...ack.subarray(4)],[0,0,0x80]);
});
test('initial connection waits for a sleeping relay to become available',async()=>{
  const mesh=new Mesh(['ws://test.invalid']);
  let up;
  mesh.connectOne=()=>{up=setTimeout(()=>mesh.add({subscribe(){},close(){}},'ws://test.invalid'),80);return Promise.resolve(null);};
  try {await mesh.start(500);assert.equal(mesh.up,true);} finally {clearTimeout(up);mesh.close();}
});
test('an unreachable relay times out and clears pending reconnects',async()=>{
  const mesh=new Mesh(['ws://test.invalid']);
  mesh.connectOne=u=>{mesh.again(u);return Promise.resolve(null);};
  await assert.rejects(mesh.start(30),/No relay server/);
  assert.equal(mesh.closed,true);
  assert.equal(mesh.retryTimers.size,0);
});
test('closing during startup cancels the wait',async()=>{
  const mesh=new Mesh(['ws://test.invalid']);
  mesh.connectOne=()=>Promise.resolve(null);
  const started=mesh.start(500);
  mesh.close();
  await assert.rejects(started,/closed/);
});

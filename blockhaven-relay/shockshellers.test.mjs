// Shock Shellers over the actual relay: a host's bot-filled match, a guest who joins with the room
// code and takes a bot's place, inputs flowing up, snapshots and events flowing down. Uses the real
// transport, sealed channel and Link (relay path only: no WebRTC in Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
globalThis.window = globalThis;
globalThis.WebSocket = WebSocket;
const html = readFileSync(new URL('../docs/games/shockshellers/index.html', import.meta.url), 'utf8');
const v = html.match(/src="js\/main\.js\?v=([^"]+)"/)[1];
const load = rel => import(new URL(`../docs/games/shockshellers/js/${rel}?v=${v}`, import.meta.url).href);
const { HostSession } = await load('game/session.js');
const { GuestSession } = await load('net/guest.js');
const { CTRL } = await load('sim/tuning.js');

function deadline(p, ms = 20000) { let t; return Promise.race([p, new Promise((_, r) => { t = setTimeout(() => r(Error('Timed out')), ms); })]).finally(() => clearTimeout(t)); }
async function relay(t) {
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening'); const port = reserve.address().port; await new Promise(r => reserve.close(r));
  const child = spawn(process.execPath, [new URL('server.js', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), ALLOWED_ORIGINS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  await deadline(once(child.stdout, 'data'));
  return `ws://127.0.0.1:${port}/mqtt`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('a friend joins a bot match by code, replaces a bot and plays', async t => {
  const url = await relay(t);
  globalThis.SHOCKSHELLERS_NET = { brokers: [url], iceServers: [], forceRelay: true, wake: [] };
  const host = new HostSession({ map: 'omelet', mode: 'ffa', options: {}, difficulty: 'normal', name: 'Hosty', primary: 'yolk47', cosmetics: { color: 0, hat: 'none' } });
  t.after(() => host.close());
  const before = host.match.players.size, botsBefore = host.botCount();
  assert.equal(before, 6);
  const code = await deadline(host.openRoom());
  assert.match(code, /^[A-Z2-9]{5}$/);
  // Run the host's game in real time while the guest connects.
  let running = true;
  const hostLoop = (async () => { while (running) { host.advance(1 / 30, { ctrl: 0, yaw: 0, pitch: 0 }); host.takeEvents(); await sleep(33); } })();
  const guest = await deadline(GuestSession.join(code, { name: 'Friend', primary: 'beater', cosmetics: { color: 3, hat: 'cap' } }, () => {}), 30000);
  t.after(() => { running = false; guest.close(); });
  assert.equal(host.match.players.size, before, 'the room stays the same size');
  assert.equal(host.botCount(), botsBefore - 1, 'the friend took a bot\'s place');
  const g = host.match.players.get(guest.myId);
  assert.equal(g.name, 'Friend'); assert.equal(g.bot, false);
  // The guest spawns and walks forward; the host's copy of them moves.
  guest.respawn();
  let moved = false;
  for (let i = 0; i < 150 && !moved; i++) {
    guest.advance(1 / 30, { ctrl: guest.me.alive ? CTRL.up : 0, yaw: 0, pitch: 0 });
    guest.takeEvents();
    await sleep(33);
    if (g.alive && Math.hypot(g.body.vx, g.body.vz) > 0.03) moved = true;
  }
  assert.ok(g.alive, 'host spawned the guest');
  assert.ok(moved, 'guest inputs drive the host simulation');
  // The guest's mirror shows the other players, and its prediction agrees with the host.
  assert.equal(guest.match.players.size, host.match.players.size);
  await sleep(300); guest.advance(0.01, { ctrl: 0, yaw: 0, pitch: 0 }); await sleep(300);
  const err = Math.hypot(guest.me.body.x - g.body.x, guest.me.body.z - g.body.z);
  assert.ok(err < 1, `prediction close to the host (${err.toFixed(3)})`);
  running = false; await hostLoop;
});

test('rounds over the relay: the guest sees the podium and follows the host to the next map', async t => {
  const url = await relay(t);
  globalThis.SHOCKSHELLERS_NET = { brokers: [url], iceServers: [], forceRelay: true, wake: [] };
  const host = new HostSession({ map: 'omelet', mode: 'ffa', options: { timeLimit: 3 }, difficulty: 'normal', name: 'Hosty', primary: 'yolk47', cosmetics: { color: 0, hat: 'none' } });
  t.after(() => host.close());
  const code = await deadline(host.openRoom());
  let running = true;
  // The host runs several ticks per step (advance catches up a quarter second at a time): the round
  // and its 15 s podium pass in a few seconds of real time.
  const hostLoop = (async () => { while (running) { host.advance(0.25, { ctrl: 0, yaw: 0, pitch: 0 }); host.takeEvents(); await sleep(25); } })();
  const guest = await deadline(GuestSession.join(code, { name: 'Friend', primary: 'beater', cosmetics: { color: 3, hat: 'cap' } }, () => {}), 30000);
  t.after(() => { running = false; guest.close(); });
  let ended = null, rounds = 0;
  guest.onNewRound = () => rounds++;
  for (let i = 0; i < 1200 && !rounds; i++) {
    guest.advance(1 / 30, { ctrl: 0, yaw: 0, pitch: 0 });
    for (const e of guest.takeEvents()) if (e.t === 'roundEnd') ended = e;
    await sleep(10);
  }
  assert.ok(ended && ended.podium.length === 3 && ended.nextName, 'the guest saw the podium and the next map');
  assert.equal(rounds, 1, 'the guest moved to the next round');
  assert.equal(guest.mapId, host.mapId); assert.equal(guest.mapId, ended.next);
  assert.ok(guest.me && guest.match.players.has(guest.myId) && !guest.match.over);
  assert.equal(guest.match.players.size, host.match.players.size);
  running = false; await hostLoop;
});

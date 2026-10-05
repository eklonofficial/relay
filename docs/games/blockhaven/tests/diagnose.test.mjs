import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { diagnose } = await load('net/transport.js');
const relay = 'wss://relay.example/mqtt', wake = 'https://relay.example/health';

function setup(t, readyAt) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 0 });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('CORS blocked'); });
  const previousWindow = globalThis.window, previousSocket = globalThis.WebSocket;
  globalThis.window = {};
  t.after(() => { globalThis.window = previousWindow; globalThis.WebSocket = previousSocket; });
  const sockets = [];
  class Socket {
    constructor() {
      this.closed = false;
      sockets.push(this);
      this.timer = setTimeout(() => {
        if (readyAt === null) return; // a connection that never answers
        if (Date.now() < readyAt) this.onerror?.();
        else this.onopen?.();
      }, 10);
    }
    send(packet) {
      if (packet[0] === 0x10) this.onmessage?.({ data: new Uint8Array([0x20, 2, 0, 0]).buffer });
    }
    close() { this.closed = true; clearTimeout(this.timer); this.onclose?.(); }
  }
  globalThis.WebSocket = Socket;
  return sockets;
}
async function advance(t, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    t.mock.timers.tick(100);
    for (let n = 0; n < 8; n++) await Promise.resolve();
  }
}

test('diagnostics wait for a sleeping relay and retry despite a failed HTTP wake', async t => {
  const sockets = setup(t, 12000), reports = [];
  const pending = diagnose({ brokers: [relay], wake: [wake] }, r => reports.push(r));
  await advance(t, 9000);
  assert.equal(reports.filter(r => r.name.startsWith('Relay')).length, 0);
  await advance(t, 6000);
  const results = await pending;
  assert.equal(results.find(r => r.name.startsWith('Relay')).ok, true);
  assert.ok(sockets.length > 1, 'retry failed WebSocket handshakes');
  assert.ok(sockets.every(s => s.closed));
  const call = fetch.mock.calls[0];
  assert.equal(call.arguments[0], wake);
  assert.equal(call.arguments[1].credentials, 'omit');
  assert.equal(call.arguments[1].signal.aborted, true);
});

test('a relay that remains down fails within the startup budget and stops retrying', async t => {
  const sockets = setup(t, Infinity);
  const pending = diagnose({ brokers: [relay], wake: [wake] });
  await advance(t, 65000);
  const results = await pending;
  const result = results.find(r => r.name.startsWith('Relay'));
  assert.equal(result.ok, false);
  assert.match(result.detail, /65 seconds/);
  assert.ok(sockets.every(s => s.closed));
  const attempts = sockets.length;
  await advance(t, 30000);
  assert.equal(sockets.length, attempts);
});

test('an unrelated wake URL does not delay public broker failures', async t => {
  const sockets = setup(t, Infinity);
  const pending = diagnose({ brokers: [relay], wake: ['https://other.example/health'] });
  await advance(t, 1000);
  assert.equal((await pending).find(r => r.name.startsWith('Relay')).ok, false);
  assert.equal(sockets.length, 1);
  assert.equal(fetch.mock.calls.length, 0);
});

test('silent sockets respect the total deadline and are closed after timeout', async t => {
  const sockets = setup(t, null);
  const pending = diagnose({ brokers: [relay], wake: [wake] });
  await advance(t, 65000);
  assert.equal((await pending).find(r => r.name.startsWith('Relay')).ok, false);
  assert.ok(sockets.length > 1);
  assert.ok(sockets.every(s => s.closed));
});

test('an already awake relay succeeds immediately and closes its probe socket', async t => {
  const sockets = setup(t, 0);
  const pending = diagnose({ brokers: [relay], wake: [wake] });
  await advance(t, 100);
  assert.equal((await pending).find(r => r.name.startsWith('Relay')).ok, true);
  assert.equal(sockets.length, 1);
  assert.ok(sockets[0].closed);
});

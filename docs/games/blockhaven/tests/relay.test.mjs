import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

globalThis.window = globalThis;
const { RelayChannel } = await load('net/transport.js');

// Two relay channels joined by a fake broker that loses, duplicates and reorders messages.
function link({ loss = 0, dup = 0, jitter = 0 } = {}) {
  const ends = {};
  const mesh = side => ({
    send(topic, m) {
      const copies = Math.random() < dup ? 2 : 1;
      for (let i = 0; i < copies; i++) {
        if (Math.random() < loss) continue;
        const msg = JSON.parse(JSON.stringify(m));
        setTimeout(() => ends[side === 'a' ? 'b' : 'a'].receive(msg), Math.random() * jitter);
      }
    },
  });
  ends.a = new RelayChannel(mesh('a'), 'to-b');
  ends.b = new RelayChannel(mesh('b'), 'to-a');
  return ends;
}
async function transfer(opts, n) {
  const { a, b } = link(opts), gotA = [], gotB = [];
  a.on('data', d => gotA.push(d)); b.on('data', d => gotB.push(d));
  for (let i = 0; i < n; i++) { a.send(`a${i}`); b.send(`b${i}`); }
  const want = p => Array.from({ length: n }, (_, i) => `${p}${i}`);
  for (let t = 0; t < 300 && (gotA.length < n || gotB.length < n); t++) await new Promise(r => setTimeout(r, 50));
  a.close(); b.close();
  return { okB: JSON.stringify(gotB) === JSON.stringify(want('a')), okA: JSON.stringify(gotA) === JSON.stringify(want('b')), gotA: gotA.length, gotB: gotB.length };
}

test('relayed data arrives complete and in order over a clean link', async () => {
  const r = await transfer({}, 300);
  assert.ok(r.okA && r.okB, JSON.stringify(r));
});

test('relayed data survives 30% loss, duplicates and reordering', async () => {
  const r = await transfer({ loss: 0.3, dup: 0.1, jitter: 80 }, 300);
  assert.ok(r.okA && r.okB, JSON.stringify(r));
});

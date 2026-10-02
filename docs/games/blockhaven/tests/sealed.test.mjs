import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { SealedChannel } = await load('net/sealed.js');
function pair(initiallyOpen = true) {
  const wire = [[], []], sockets = [0, 1].map(i => ({ open: initiallyOpen, listeners: {}, on(n, f) { (this.listeners[n] ||= []).push(f); }, send(s) { assert.equal(this.open, true); wire[i].push(s); queueMicrotask(() => sockets[1 - i].emit('data', s)); }, emit(n, s) { for (const f of this.listeners[n] || []) f(s); }, close() { if (!this.open) return; this.open = false; this.emit('close'); } }));
  const channels = sockets.map(s => new SealedChannel(s));
  return { wire, sockets, channels, close: () => channels.forEach(c => c.close()) };
}
test('queued payloads round-trip in both directions with no readable wire content', async () => {
  const p = pair();
  try {
    const got = [[], []]; p.channels.forEach((c, i) => c.on('data', s => got[i].push(s)));
    p.channels[0].send('Inventory: secret Ω'); p.channels[0].send('Respawn: second'); p.channels[1].send('Score: 42');
    await Promise.all(p.channels.map(c => c.ready)); await Promise.all(p.channels.map(c => c.tx));
    await Promise.all(p.channels.map(c => c.rx));
    assert.deepEqual(got, [['Score: 42'], ['Inventory: secret Ω', 'Respawn: second']]);
    assert.doesNotMatch(p.wire.flat().join(''), /Inventory|secret|Respawn|Score/);
    assert.notEqual(p.channels[0].keys.send, p.channels[0].keys.recv);
  } finally { p.close(); }
});
test('tampered, reflected, replayed and plaintext packets fail closed', async () => {
  for (const attack of ['tamper', 'reflect', 'replay', 'plaintext']) {
    const p = pair();
    try {
      await Promise.all(p.channels.map(c => c.ready));
      if (attack === 'tamper') p.sockets[0].send = s => p.wire[0].push(s);
      p.channels[0].send('private'); await p.channels[0].tx; await p.channels[1].rx;
      const packet = p.wire[0].find(s => s.startsWith('1.'));
      if (attack === 'reflect') { p.sockets[0].emit('data', packet); await p.channels[0].rx; assert.equal(p.channels[0].closed, true); continue; }
      let bad = packet;
      if (attack === 'tamper') { const bytes = Uint8Array.from(atob(packet.slice(2)), c => c.charCodeAt(0)); bytes[bytes.length - 1] ^= 1; bad = '1.' + btoa(String.fromCharCode(...bytes)); }
      if (attack === 'plaintext') bad = '{"chat":"private"}';
      p.sockets[1].emit('data', bad); await p.channels[1].rx;
      assert.equal(p.channels[1].closed, true, attack);
    } finally { p.close(); }
  }
});
test('an incoming PeerJS connection can open after key generation', async () => {
  const p = pair(false);
  try {
    await Promise.all(p.channels.map(c => c.local));
    assert.equal(p.wire.flat().length, 0);
    for (const s of p.sockets) { s.open = true; s.emit('open'); }
    await Promise.all(p.channels.map(c => c.ready));
    assert.ok(p.channels.every(c => c.open && !c.closed));
  } finally { p.close(); }
});
test('existing Link fragmentation reassembles a large encrypted Unicode payload', async () => {
  const { Link } = await load('net/net.js');
  const p = pair();
  try {
    const links = p.channels.map(c => new Link(c));
    const got = new Promise(r => { links[1].onMessage = r; });
    const payload = { t: 'welcome', world: 'Ω𐐀'.repeat(25000) };
    links[0].send(payload);
    assert.deepEqual(await got, payload);
    assert.equal(links[1].pending, 0); assert.equal(p.channels[0].queued, 0);
  } finally { p.close(); }
});

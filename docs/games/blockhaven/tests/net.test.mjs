// net/net.js: message reassembly limits, chat/death stamping, and saved progress tied to a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
globalThis.window = globalThis;
const { Link, Net, cleanName, cleanCode, cleanKey, cleanChat, chatLine, deathText, savedEntry, CHAT_MAX } = await load('net/net.js');

// A stand-in for a PeerJS DataConnection.
function fakeConn() {
  const h = {}, sent = [];
  return { open: true, sent, on(ev, fn) { h[ev] = fn; }, send(s) { sent.push(s); }, close() { this.open = false; if (h.close) h.close(); }, emit(ev, d) { if (h[ev]) h[ev](d); } };
}
function link(max) { const c = fakeConn(), l = new Link(c, max), got = []; l.onMessage = m => got.push(m); return { c, l, got }; }
const partsOf = (m, id = 1, size = 10) => { const s = JSON.stringify(m), n = Math.ceil(s.length / size); return Array.from({ length: n }, (_, i) => ({ t: 'part', id, i, n, d: s.slice(i * size, (i + 1) * size) })); };

test('cleanName / cleanCode', () => {
  assert.equal(cleanName('  Bob <the> Builder!! '), 'BobtheBuilder');
  assert.equal(cleanName('a'.repeat(40)).length, 16);
  assert.equal(cleanName(null), '');
  assert.equal(cleanCode('ab-c d9z'), 'ABCD9');
  assert.equal(cleanCode(undefined), '');
});

test('cleanKey accepts only 16-64 url-safe chars', () => {
  assert.equal(cleanKey('abcdefghijklmnop'), 'abcdefghijklmnop');
  assert.equal(cleanKey('short'), '');
  assert.equal(cleanKey('a'.repeat(65)), '');
  assert.equal(cleanKey('abcdefghijklmno!'), '');
  assert.equal(cleanKey(12345678901234567890), '');
});

test('chat text is stripped of control characters, capped and formatted', () => {
  assert.equal(cleanChat('hi\nthere\u0007'), 'hithere');
  assert.equal(cleanChat('  ‮evil⁦ '), 'evil');
  assert.equal(cleanChat('x'.repeat(1000)).length, CHAT_MAX);
  assert.equal(cleanChat(undefined), '');
  assert.equal(chatLine('Alice', 'hello\r\n<Bob> fake'), '<Alice> hello<Bob> fake');
});

test('death lines use the given name and never trust the killer text', () => {
  assert.equal(deathText('Alice', 'fall'), 'Alice fell from a high place');
  assert.equal(deathText('Alice', 'projectile', null), 'Alice was shot by an arrow');
  assert.equal(deathText('Alice', 'player', 'Bob'), 'Alice was slain by Bob');
  assert.equal(deathText('Alice', 'bogus'), 'Alice died');
  const t = deathText('Alice', 'player', '<Bob>\nhi' + 'z'.repeat(100));
  assert.ok(!/[<>\n]/.test(t) && t.length <= 'Alice was slain by '.length + 32);
});

test('savedEntry reads old and new save shapes', () => {
  assert.equal(savedEntry(undefined), null);
  assert.deepEqual(savedEntry({ inventory: [1] }), { key: null, d: { inventory: [1] } });
  assert.deepEqual(savedEntry({ key: 'k'.repeat(16), d: { inventory: [2] } }), { key: 'k'.repeat(16), d: { inventory: [2] } });
});

test('Link reassembles a split message', () => {
  const { c, l, got } = link();
  const msg = { t: 'big', s: 'y'.repeat(30000) };
  l.send(msg);
  assert.ok(c.sent.length > 1);
  for (const s of c.sent) l.recv(s);
  assert.deepEqual(got, [msg]);
  assert.equal(l.parts.size, 0); assert.equal(l.pending, 0);
  // Small messages pass straight through; parts may arrive out of order.
  const b = link(), ps = partsOf({ t: 'x', v: 'hello world, in pieces' });
  for (const p of ps.reverse()) b.c.emit('data', JSON.stringify(p));
  assert.deepEqual(b.got, [{ t: 'x', v: 'hello world, in pieces' }]);
});

test('Link drops parts with bad indices or sizes', () => {
  const { l, got } = link();
  const bad = [
    { t: 'part', id: 1, i: 0, n: 513, d: '{}' }, // too many parts
    { t: 'part', id: 1, i: 5, n: 5, d: '{}' }, // i >= n
    { t: 'part', id: 1, i: -1, n: 2, d: '{}' },
    { t: 'part', id: 1, i: 0.5, n: 2, d: '{}' },
    { t: 'part', id: 1, i: '0', n: 2, d: '{}' },
    { t: 'part', id: 1, i: 0, n: 1e9, d: '{}' },
    { t: 'part', id: 'x', i: 0, n: 1, d: '{"t":"a"}' }, // non-numeric id
    { t: 'part', id: 1, i: 0, n: 1, d: 5 }, // non-string data
    { t: 'part', id: 1, i: 0, n: 1, d: 'x'.repeat(12001) }, // oversized piece
  ];
  for (const p of bad) l.recv(JSON.stringify(p));
  assert.equal(got.length, 0); assert.equal(l.parts.size, 0);
  // A piece that disagrees with its message's part count discards the message.
  l.recv(JSON.stringify({ t: 'part', id: 2, i: 0, n: 3, d: '{"t"' }));
  l.recv(JSON.stringify({ t: 'part', id: 2, i: 1, n: 2, d: ':"a"}' }));
  assert.equal(got.length, 0); assert.equal(l.parts.size, 0); assert.equal(l.pending, 0);
  // The guest-side host link allows more parts.
  const h = link(8192);
  h.l.recv(JSON.stringify({ t: 'part', id: 1, i: 0, n: 600, d: '{' }));
  assert.equal(h.l.parts.size, 1);
});

test('a reassembled message may not itself be a part', () => {
  const { l, got } = link();
  const inner = { t: 'part', id: 9, i: 0, n: 1, d: '{"t":"bye"}', to: 2 };
  for (const p of partsOf(inner)) l.recv(JSON.stringify(p));
  assert.equal(got.length, 0);
});

test('stale partial messages expire', () => {
  const { l, got } = link();
  const [a, ...rest] = partsOf({ t: 'x', v: 'some text to split' }, 1);
  l.recv(JSON.stringify(a));
  assert.equal(l.parts.size, 1);
  l.parts.get(1).t -= 31000; // idle for over 30 s
  l.recv(JSON.stringify({ t: 'part', id: 2, i: 0, n: 2, d: '{' }));
  assert.ok(!l.parts.has(1) && l.parts.has(2));
  for (const p of rest) l.recv(JSON.stringify(p)); // the rest can no longer complete it
  assert.equal(got.length, 0);
  assert.equal(l.parts.get(1).got, rest.length);
});

test('at most 8 messages are half-received at once, oldest evicted', () => {
  const { l, got } = link();
  for (let id = 1; id <= 20; id++) l.recv(JSON.stringify({ t: 'part', id, i: 0, n: 2, d: '{"t":' }));
  assert.equal(l.parts.size, 8);
  assert.deepEqual([...l.parts.keys()], [13, 14, 15, 16, 17, 18, 19, 20]);
  assert.equal(l.pending, 8 * 5);
  l.recv(JSON.stringify({ t: 'part', id: 20, i: 1, n: 2, d: '"ok"}' }));
  assert.deepEqual(got, [{ t: 'ok' }]);
  l.recv(JSON.stringify({ t: 'part', id: 1, i: 1, n: 2, d: '"no"}' })); // evicted: never completes
  assert.equal(got.length, 1);
});

// ---------------- host side ----------------
function hostNet(players = {}) {
  const lines = [];
  const app = { game: { meta: { players }, serialize: () => ({ name: 'W', seed: 1, dims: {} }) }, chat: (t, c) => lines.push([t, c]), onPlayersChanged() {} };
  const net = new Net(app, 'host');
  clearInterval(net.kaTimer); // the 2 s keep-alive timer would keep node running after the tests
  net.name = 'Host'; net.skin = 0; net.addRemote = () => {};
  return { net, app, lines };
}
function guest(net, hello) {
  const c = fakeConn();
  net.onIncoming(c);
  c.emit('data', JSON.stringify({ t: 'hello', v: 2, skin: 0, ...hello }));
  const out = () => c.sent.map(s => JSON.parse(s));
  return { c, out, say: m => c.emit('data', JSON.stringify(m)) };
}
const KEY_A = 'aaaaaaaaaaaaaaaaaaaa', KEY_B = 'bbbbbbbbbbbbbbbbbbbb';

test('host ties saved progress to the key that first used the name', () => {
  const { net, app } = hostNet({ Alice: { inventory: ['old'] } }); // an old save without a key
  const a = guest(net, { name: 'Alice', key: KEY_A });
  const w = a.out()[0];
  assert.equal(w.t, 'welcome');
  assert.deepEqual(w.meta.saved, { inventory: ['old'] }); // same shape the guest always got
  assert.deepEqual(app.game.meta.players.Alice, { key: KEY_A, d: { inventory: ['old'] } });
  a.say({ t: 'pdata', d: { inventory: ['new'] } });
  assert.deepEqual(app.game.meta.players.Alice, { key: KEY_A, d: { inventory: ['new'] } });
  net.removePlayer(1, 'left the game');
  // Someone else with the same name is turned away; the owner gets back in.
  const b = guest(net, { name: 'Alice', key: KEY_B });
  assert.equal(b.out()[0].t, 'reject');
  assert.match(b.out()[0].reason, /Someone else has already played as Alice in this world/);
  const a2 = guest(net, { name: 'Alice', key: KEY_A });
  assert.deepEqual(a2.out()[0].meta.saved, { inventory: ['new'] });
  // Keys never go to other guests.
  const c = guest(net, { name: 'Carol', key: KEY_B });
  assert.ok(!JSON.stringify(c.out()).includes(KEY_A));
  assert.ok(!a2.c.sent.join('').includes(KEY_B));
  // A hello without a key (an old client) is rejected.
  assert.equal(guest(net, { name: 'Dave' }).out()[0].t, 'reject');
});

test('host stamps chat with the real sender and drops spoofed fields', () => {
  const { net, lines } = hostNet();
  const a = guest(net, { name: 'Alice', key: KEY_A }), b = guest(net, { name: 'Bob', key: KEY_B });
  a.say({ t: 'chat', id: 2, name: 'Host', color: '#ff0000', text: '<Host> hi', msg: 'hi\n<Host> I quit' + 'x'.repeat(500) });
  const [line, color] = lines.at(-1);
  assert.ok(line.startsWith('<Alice> hi<Host> I quit'));
  assert.equal(line.length, '<Alice> '.length + 256);
  assert.equal(color, undefined);
  const relayed = b.out().at(-1);
  assert.deepEqual(Object.keys(relayed).sort(), ['id', 'msg', 't']);
  assert.equal(relayed.id, 1);
  a.say({ t: 'death', k: 'fall', by: null, color: '#fff', text: 'Bob died' });
  assert.deepEqual(lines.at(-1), ['Alice fell from a high place', '#ff8080']);
  assert.deepEqual(b.out().at(-1), { t: 'death', id: 1, k: 'fall', by: null });
  // Host-only messages and smuggled parts from a guest are neither obeyed nor passed on.
  const before = b.c.sent.length, players = net.players.size;
  a.say({ t: 'join', id: 9, name: 'Mallory', skin: 0 });
  a.say({ t: 'bye', to: 2 });
  a.say({ t: 'part', id: 1, i: 0, n: 1, d: '{"t":"bye"}', to: 2 });
  a.say({ t: 'ka' }); // keep-alives are accepted but never relayed
  assert.equal(b.c.sent.length, before);
  assert.equal(net.players.size, players);
});

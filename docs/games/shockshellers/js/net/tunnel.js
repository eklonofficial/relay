// A fourth way to carry a game, for school networks that block direct connections (STUN) and the
// relays' hosts but still let the PeerJS server through (it is how players find each other, so
// filters tend to allow it). That server passes messages between two connected players, unchanged,
// so here the game data rides those messages, over the same reliable channel as the brokers' and
// the mailbox's relay paths (transport.js's RelayChannel), and the rest of the networking can't tell
// the difference.
//
// This speaks the PeerJS server's own protocol on a WebSocket of its own: register an id, send a
// heartbeat every 5 s, and address messages by id. The server stamps each message with the real
// sender's id, so a message can't pretend to come from someone else (and everything is sealed
// end to end anyway, sealed.js). The host listens here as well as on the other paths; a guest
// whose direct connection doesn't come up in a few seconds knocks here too, and whichever path
// connects first is used.
import { RelayChannel } from './transport.js?v=muztsdw7';

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
// (The server forwards these; ours carry `ss` so anything else is ignored.)
const TYPE = 'ANSWER';

export const tunnelHostId = (prefix, code) => `${prefix}${code}-t`;

export class Tunnel {
  constructor(cfg, id) {
    const p = cfg.peer || {};
    this.url = `${p.secure === false ? 'ws' : 'wss'}://${p.host}:${p.port || 443}${p.path || '/'}peerjs?key=${p.key || 'peerjs'}&id=${encodeURIComponent(id)}&token=${rid()}&version=1.5.5`;
    this.id = id; this.ws = null; this.ready = false; this.closed = false; this.hb = null; this.out = new Map(); this.flushing = false;
    this.drops = 0; this.lastDrop = ''; this.retry = null;
    this.onMessage = () => {}; this.onExpire = () => {};
  }
  // Connect and register; resolves once the server says the id is ours. After that the link stays
  // up on its own: if the network or the server cuts it, it reconnects under the same id (the
  // server keeps it for us) and what was waiting to go out goes out then.
  open(ms = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { if (!this.ready) { this.close(); reject(new Error(`The PeerJS server did not answer${this.lastDrop ? ` (${this.lastDrop})` : ''}.`)); } }, ms);
      this.first = { resolve: () => { clearTimeout(t); resolve(this); }, reject: e => { clearTimeout(t); this.close(); reject(e); } };
      this.connect();
    });
  }
  connect() {
    if (this.closed) return;
    let ws, opened = 0;
    try { ws = new WebSocket(this.url); } catch (e) { this.dropped(`could not open: ${e && e.message}`); return; }
    this.ws = ws;
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'OPEN') {
        opened = performance.now(); this.ready = true; this.beat(); this.flush();
        if (this.first) { this.first.resolve(); this.first = null; }
        return;
      }
      if (m.type === 'ID-TAKEN' || m.type === 'ERROR' || m.type === 'INVALID-KEY') {
        const why = m.type === 'ID-TAKEN' ? 'That room id is already taken.' : (m.payload && m.payload.msg) || 'The PeerJS server refused the connection.';
        if (this.first) { this.first.reject(new Error(why)); this.first = null; } else this.lastDrop = why;
        return;
      }
      if (m.type === 'EXPIRE') { this.onExpire(m.src); return; }
      if (m.type === TYPE && m.payload && m.payload.ss === 1 && typeof m.src === 'string' && Array.isArray(m.payload.b)) for (const x of m.payload.b) this.onMessage(m.src, x);
    };
    ws.onclose = e => {
      if (this.ws !== ws) return;
      this.dropped(`closed${e.code ? ' ' + e.code : ''}${e.reason ? ' ' + e.reason : ''}${opened ? ` after ${((performance.now() - opened) / 1000).toFixed(1)} s` : ' before registering'}`);
    };
    ws.onerror = () => {};
  }
  dropped(why) {
    this.ready = false; clearInterval(this.hb); this.hb = null; this.ws = null;
    if (this.closed) return;
    this.drops++; this.lastDrop = why;
    clearTimeout(this.retry); this.retry = setTimeout(() => this.connect(), Math.min(5000, 300 * this.drops));
  }
  beat() { clearInterval(this.hb); this.hb = setInterval(() => this.raw({ type: 'HEARTBEAT' }), 5000); }
  raw(o) { if (this.ready && this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; }
  // Everything sent to one player in the same moment goes out as one server message.
  send(dst, m) {
    if (this.closed) return;
    let q = this.out.get(dst); if (!q) this.out.set(dst, q = []);
    q.push(m);
    if (q.length > 4096) q.splice(0, q.length - 4096); // (a long outage: the channel resends anyway)
    if (!this.flushing) { this.flushing = true; setTimeout(() => this.flush(), 0); }
  }
  flush() {
    this.flushing = false;
    if (!this.ready) return; // (kept until the link is back)
    // (In server messages of about 32 kB at most, which any proxy in front of the server passes.)
    for (const [dst, b] of this.out) {
      let batch = [], size = 0;
      for (const m of b) {
        const n = JSON.stringify(m).length;
        if (batch.length && size + n > 32000) { this.raw({ type: TYPE, dst, payload: { ss: 1, b: batch } }); batch = []; size = 0; }
        batch.push(m); size += n;
      }
      if (batch.length) this.raw({ type: TYPE, dst, payload: { ss: 1, b: batch } });
    }
    this.out.clear();
  }
  // What has gone wrong with the link so far, for error messages.
  trouble() { return this.drops ? `the PeerJS server link dropped ${this.drops} time${this.drops > 1 ? 's' : ''}, last ${this.lastDrop}` : ''; }
  close() {
    this.closed = true; this.ready = false; clearInterval(this.hb); clearTimeout(this.retry);
    const ws = this.ws; this.ws = null;
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* ignore */ } }
  }
}
// What RelayChannel needs from its carrier (its "topic" is the other player's id).
const mesh = t => ({ send: (dst, m) => t.send(dst, m) });

// Host: answer knocks; each guest gets its own channel.
export async function hostTunnel(prefix, code, cfg, onConnection) {
  const t = new Tunnel(cfg, tunnelHostId(prefix, code)), guests = new Map(); // guest id → channel
  t.onMessage = (src, m) => {
    if (!m || typeof m !== 'object') return;
    let ch = guests.get(src);
    if (m.k === 'knock') {
      if (!ch) {
        ch = new RelayChannel(mesh(t), src); guests.set(src, ch);
        ch.on('close', () => guests.delete(src));
        onConnection(ch);
      }
      t.send(src, { k: 'hi' }); // (again, for a knock that crossed the first answer)
      return;
    }
    if (ch) ch.receive(m);
  };
  await t.open();
  return { close: () => { for (const ch of guests.values()) ch.close(); setTimeout(() => t.close(), 300); } };
}

// Guest: knock until the host answers, then talk over a reliable channel.
export async function joinTunnel(prefix, code, cfg, waitMs = 25000) {
  const host = tunnelHostId(prefix, code), t = new Tunnel(cfg, `${prefix}g${rid()}`);
  await t.open();
  return await new Promise((resolve, reject) => {
    let ch = null, expired = 0;
    const fail = e => { clearTimeout(done); clearInterval(knock); t.close(); reject(e); };
    const done = setTimeout(() => {
      const why = t.trouble();
      fail(new Error(`No game answered through the PeerJS server${why ? ` (${why})` : ''}.`));
    }, waitMs);
    t.onMessage = (src, m) => {
      if (src !== host || !m || typeof m !== 'object') return;
      if (!ch && m.k === 'hi') {
        clearTimeout(done); clearInterval(knock);
        ch = new RelayChannel(mesh(t), host);
        ch.on('close', () => t.close());
        resolve(ch);
        return;
      }
      if (ch) ch.receive(m);
    };
    // The server tells us when a knock had nowhere to go: no game with that code (or its host is
    // on an older version of the game, without the tunnel).
    t.onExpire = src => { if (src === host && !ch && ++expired >= 2) { const e = new Error('No game with that code is listening through the PeerJS server (check the code; the host may need to refresh the page).'); e.notFound = true; fail(e); } };
    const knock = setInterval(() => t.send(host, { k: 'knock' }), 1500);
    t.send(host, { k: 'knock' });
  });
}

// Connection test: can this network carry a game this way? Registers, then sends itself a message
// a second for 10 s (long enough to see a filter that cuts the link after a while).
export async function probeTunnel(cfg, prefix) {
  const t = new Tunnel(cfg, `${prefix}p${rid()}`);
  try {
    await t.open(12000);
    let back = 0;
    t.onMessage = (src, m) => { if (src === t.id && m && m.k === 'ping') back++; };
    for (let i = 0; i < 10; i++) { t.send(t.id, { k: 'ping' }); await new Promise(r => setTimeout(r, 1000)); }
    await new Promise(r => setTimeout(r, 1000));
    const why = t.trouble();
    if (back >= 7) return true;
    return `${back} of 10 messages came back${why ? `; ${why}` : ''}`;
  } catch (e) { return (e && e.message) || 'blocked'; } finally { t.close(); }
}

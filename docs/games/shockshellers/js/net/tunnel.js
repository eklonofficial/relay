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
import { RelayChannel } from './transport.js?v=muzthczg';

const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
// (The server forwards these; ours carry `ss` so anything else is ignored.)
const TYPE = 'ANSWER';

export const tunnelHostId = (prefix, code) => `${prefix}${code}-t`;

export class Tunnel {
  constructor(cfg, id) {
    const p = cfg.peer || {};
    this.url = `${p.secure === false ? 'ws' : 'wss'}://${p.host}:${p.port || 443}${p.path || '/'}peerjs?key=${p.key || 'peerjs'}&id=${encodeURIComponent(id)}&token=${rid()}&version=1.5.5`;
    this.id = id; this.ws = null; this.closed = false; this.hb = null; this.out = new Map(); this.flushing = false;
    this.onMessage = () => {}; this.onExpire = () => {}; this.onDrop = () => {};
  }
  // Connect and register; resolves once the server says the id is ours.
  open(ms = 15000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = e => { if (done) return; done = true; clearTimeout(t); if (e) { this.drop(); reject(e); } else resolve(this); };
      const t = setTimeout(() => finish(new Error('The PeerJS server did not answer.')), ms);
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { finish(e); return; }
      this.ws = ws;
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'OPEN') { this.beat(); finish(); return; }
        if (m.type === 'ID-TAKEN') { finish(new Error('That room id is already taken.')); return; }
        if (m.type === 'ERROR' || m.type === 'INVALID-KEY') { finish(new Error((m.payload && m.payload.msg) || 'The PeerJS server refused the connection.')); return; }
        if (m.type === 'EXPIRE') { this.onExpire(m.src); return; }
        if (m.type === TYPE && m.payload && m.payload.ss === 1 && typeof m.src === 'string' && Array.isArray(m.payload.b)) for (const x of m.payload.b) this.onMessage(m.src, x);
      };
      ws.onclose = () => { if (!done) finish(new Error('Could not reach the PeerJS server.')); else if (!this.closed) { this.drop(); this.onDrop(); } };
      ws.onerror = () => {};
    });
  }
  beat() { clearInterval(this.hb); this.hb = setInterval(() => this.raw({ type: 'HEARTBEAT' }), 5000); }
  raw(o) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; }
  // Everything sent to one player in the same moment goes out as one server message.
  send(dst, m) {
    if (this.closed) return;
    let q = this.out.get(dst); if (!q) this.out.set(dst, q = []);
    q.push(m);
    if (!this.flushing) { this.flushing = true; setTimeout(() => this.flush(), 0); }
  }
  flush() {
    this.flushing = false;
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
  drop() { clearInterval(this.hb); this.hb = null; if (this.ws) { this.ws.onclose = null; try { this.ws.close(); } catch { /* ignore */ } } this.ws = null; }
  close() { this.closed = true; this.drop(); }
}
// What RelayChannel needs from its carrier (its "topic" is the other player's id).
const mesh = t => ({ send: (dst, m) => t.send(dst, m) });

// Host: answer knocks; each guest gets its own channel. Comes back if the server link drops.
export async function hostTunnel(prefix, code, cfg, onConnection) {
  const id = tunnelHostId(prefix, code), guests = new Map(); // guest id → channel
  let t = null, stopped = false;
  const listen = async () => {
    const n = new Tunnel(cfg, id);
    n.onMessage = (src, m) => {
      if (!m || typeof m !== 'object') return;
      let ch = guests.get(src);
      if (m.k === 'knock') {
        if (!ch) {
          ch = new RelayChannel(mesh(n), src); guests.set(src, ch);
          ch.on('close', () => guests.delete(src));
          onConnection(ch);
        }
        n.send(src, { k: 'hi' }); // (again, for a knock that crossed the first answer)
        return;
      }
      if (ch) ch.receive(m);
    };
    n.onDrop = () => { if (!stopped) setTimeout(retry, 1500); };
    await n.open();
    t = n;
    // Channels made on the old link keep working through the new one.
    for (const ch of guests.values()) ch.mesh = mesh(n);
  };
  let tries = 0;
  const retry = () => { if (stopped) return; listen().then(() => { tries = 0; }, () => { if (!stopped) setTimeout(retry, Math.min(15000, 2000 * ++tries)); }); };
  await listen();
  return { close: () => { stopped = true; for (const ch of guests.values()) ch.close(); setTimeout(() => t && t.close(), 300); } };
}

// Guest: knock until the host answers, then talk over a reliable channel.
export async function joinTunnel(prefix, code, cfg, waitMs = 20000) {
  const host = tunnelHostId(prefix, code), t = new Tunnel(cfg, `${prefix}g${rid()}`);
  await t.open();
  return await new Promise((resolve, reject) => {
    let ch = null, expired = 0;
    const fail = e => { clearTimeout(done); clearInterval(knock); t.close(); reject(e); };
    const done = setTimeout(() => fail(new Error('No game answered through the PeerJS server.')), waitMs);
    t.onMessage = (src, m) => {
      if (src !== host || !m || typeof m !== 'object') return;
      if (!ch && m.k === 'hi') {
        clearTimeout(done); clearInterval(knock);
        ch = new RelayChannel(mesh(t), host);
        ch.on('close', () => t.close());
        t.onDrop = () => ch.close();
        resolve(ch);
        return;
      }
      if (ch) ch.receive(m);
    };
    // The server tells us when a knock had nowhere to go: no game with that code.
    t.onExpire = src => { if (src === host && !ch && ++expired >= 2) { const e = new Error('No game was found with that code. Check the code with your friend.'); e.notFound = true; fail(e); } };
    t.onDrop = () => { if (!ch) fail(new Error('Lost the PeerJS server.')); };
    const knock = setInterval(() => t.send(host, { k: 'knock' }), 1500);
    t.send(host, { k: 'knock' });
  });
}

// Connection test: can this network carry a game this way? (Register, send ourselves a message.)
export async function probeTunnel(cfg, prefix) {
  const t = new Tunnel(cfg, `${prefix}p${rid()}`);
  try {
    await t.open(12000);
    return await new Promise(resolve => {
      const to = setTimeout(() => resolve('registered, but messages did not come back'), 8000);
      t.onMessage = (src, m) => { if (src === t.id && m && m.k === 'ping') { clearTimeout(to); resolve(true); } };
      t.send(t.id, { k: 'ping' });
    });
  } catch (e) { return (e && e.message) || 'blocked'; } finally { t.close(); }
}

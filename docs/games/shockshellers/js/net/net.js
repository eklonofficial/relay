// Multiplayer over WebRTC data channels: Blockhaven's networking, kept as it is.
//
// One player hosts: their browser runs the real match (and its bots) and relays everything between
// the others (a star, so each guest only needs one connection). Friends join with a five-letter room
// code and take a bot's place; a free public PeerJS server and the MQTT relays only introduce the
// browsers to each other (transport.js), after which data flows directly between them, or through the
// relays when no direct route exists. Every message is sealed (sealed.js).
//
// Game model: the host is authoritative. Guests send their inputs; the host sends snapshots at
// 15 Hz plus the match's events, and each guest predicts only its own egg (guest.js).
import { hostBox, joinBox } from './box.js?v=muzk36dq';
import { hostRoom, joinRoom, diagnose } from './transport.js?v=muzk36dq';
import { SealedChannel } from './sealed.js?v=muzk36dq';

export const MAX_HUMANS = 8;
const PREFIX = 'shockshellers-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROTOCOL = 1;
const PART = 12000;
// Reassembly limits: parts per message (512 ≈ 6 MB; the host's world download may use more), messages
// half-received at once, and how long a half-received message may sit idle.
const MAX_PARTS = 512, HOST_PARTS = 8192, MAX_PENDING = 8, PART_TTL = 30000;
const STATE_HZ = 20;
// A link that has been silent this long is dead (keep-alives go out every 2 s, even from background tabs).
// As long as the relay channel's own limit (transport.js): a guest on a slow Chromebook can go quiet
// for a good while building the map right after it joins.
const LINK_TIMEOUT = 30000;
// Guest messages the host passes on to every other guest (chat; everything else is the host's to decide).
const RELAY = new Set(['chat']);
// Only the host may send these; a guest's copy is dropped rather than obeyed or passed on.
const HOST_ONLY = new Set(['hello', 'welcome', 'reject', 'join', 'leave', 'bye', 'st', 'ev', 'opts', 'boot']);

export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
export const cleanName = s => String(s || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
// Per-browser secret that ties a guest's saved progress to them (sent to the host only).
export const cleanKey = s => (typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : '');
// Chat text: no control or bidi-override characters, one line, capped.
export const CHAT_MAX = 256;
export const cleanChat = s => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, '').trim().slice(0, CHAT_MAX);
export const chatLine = (name, msg) => `<${name}> ${cleanChat(msg)}`;
let libPromise = null;
function loadLib() {
  if (window.Peer) return Promise.resolve();
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/peerjs.min.js?v=muzk36dq', import.meta.url).href;
      s.onload = () => resolve();
      s.onerror = () => { libPromise = null; reject(new Error('Could not load the multiplayer library. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}
// Free hosting puts an idle relay to sleep; a request wakes it while the player is still choosing.
export function wakeRelays() { for (const u of netConfig().wake || []) fetch(u, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).catch(() => {}); }
export const diagnoseNetwork = onResult => diagnose(netConfig(), onResult);
function netConfig() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem('shockshellers.net')); } catch { /* none */ }
  return { ...(window.SHOCKSHELLERS_NET || {}), ...(o || {}) };
}
function makePeer(id) {
  const c = netConfig();
  const opts = { ...(c.peer || {}), config: { iceServers: c.iceServers || [] }, debug: 0 };
  return id ? new window.Peer(id, opts) : new window.Peer(opts);
}
const peerError = e => {
  switch (e && e.type) {
    case 'peer-unavailable': return 'No game was found with that code. Check the code with your friend.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return 'Could not reach the multiplayer server. Check your internet connection (some school or work networks block it).';
    case 'browser-incompatible': return 'This browser does not support multiplayer (WebRTC).';
    case 'webrtc': return 'A direct connection could not be made between your browsers. See MULTIPLAYER.md about adding a free TURN relay.';
    default: return (e && e.message) || 'Connection failed.';
  }
};
const timeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);

// One data connection. Messages are JSON; long ones are split so no browser drops them.
export class Link {
  constructor(conn, maxParts = MAX_PARTS) {
    this.conn = conn; this.parts = new Map(); this.pending = 0; this.maxParts = maxParts; this.nextPart = 1; this.seen = performance.now();
    this.onMessage = null; this.onClose = null; this.closed = false;
    conn.on('data', d => { this.seen = performance.now(); this.recv(d); });
    const closed = () => { if (this.closed) return; this.closed = true; if (this.onClose) this.onClose(); };
    conn.on('close', closed);
    conn.on('error', closed);
  }
  get open() { return this.conn.open && !this.closed; }
  send(m) {
    if (!this.open) return;
    const s = JSON.stringify(m);
    try {
      if (s.length <= PART) { this.conn.send(s); return; }
      const id = this.nextPart++, n = Math.ceil(s.length / PART);
      for (let i = 0; i < n; i++) this.conn.send(JSON.stringify({ t: 'part', id, i, n, d: s.slice(i * PART, (i + 1) * PART) }));
    } catch (e) { console.warn('send failed', e); }
  }
  recv(d) {
    let m;
    try { m = typeof d === 'string' ? JSON.parse(d) : d; } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'part' && !(m = this.part(m))) return;
    if (this.onMessage) this.onMessage(m);
  }
  // One piece of a split message; returns the whole message once every piece is in. Bad indices are
  // dropped, idle half-messages expire, and at most MAX_PENDING (and maxParts pieces' worth) are held.
  part(m) {
    const { id, i, n, d } = m, now = performance.now();
    if (!Number.isSafeInteger(id) || !Number.isInteger(i) || !Number.isInteger(n) || i < 0 || i >= n || n > this.maxParts || typeof d !== 'string' || d.length > PART) return null;
    for (const [k, q] of this.parts) if (now - q.t > PART_TTL) this.dropPart(k);
    let p = this.parts.get(id);
    if (p && p.n !== n) { this.dropPart(id); return null; }
    if (!p) {
      while (this.parts.size >= MAX_PENDING) this.dropPart(this.parts.keys().next().value);
      p = { n, got: 0, size: 0, list: [], t: now }; this.parts.set(id, p);
    }
    p.t = now;
    if (p.list[i] === undefined) { p.list[i] = d; p.got++; p.size += d.length; this.pending += d.length; }
    for (const k of [...this.parts.keys()]) { if (this.pending <= this.maxParts * PART) break; if (k !== id) this.dropPart(k); }
    if (p.got < n) return null;
    this.dropPart(id);
    let out;
    try { out = JSON.parse(p.list.join('')); } catch { return null; }
    // A reassembled message is never itself a part (no smuggling pieces through the host's relay).
    return out && typeof out === 'object' && out.t !== 'part' ? out : null;
  }
  dropPart(k) { const p = this.parts.get(k); if (p) { this.pending -= p.size; this.parts.delete(k); } }
  close() { this.closed = true; try { this.conn.close(); } catch { /* already closed */ } }
}

// The connection layer of a match. The game logic lives in the session (game/session.js on the
// host, net/guest.js on a guest); Net only finds peers, admits guests and moves messages.
export class Net {
  constructor(session, role) {
    this.session = session; this.role = role; // 'host' | 'guest'
    this.guests = new Map(); // player id → { id, name, link }
    this.closed = false;
    // Keep-alive on a timer, not the frame loop: a browser pauses the game while its tab is in
    // the background, and the others must not mistake that for a lost connection.
    // The ticks come from a tiny worker: timers on the page itself are throttled to once a minute
    // in background tabs, which would make a minimised player look disconnected.
    const ka = () => { if (this.closed) return; if (this.isHost) this.broadcast({ t: 'ka' }); else if (this.hostLink) this.hostLink.send({ t: 'ka', ts: performance.now() }); this.checkLinks(); };
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 2000);'], { type: 'text/javascript' }));
      this.kaWorker = new Worker(url); URL.revokeObjectURL(url);
      this.kaWorker.onmessage = ka;
    } catch { this.kaTimer = setInterval(ka, 2000); }
  }
  get isHost() { return this.role === 'host'; }

  // ---------------- hosting ----------------
  // Rooms are registered three independent ways at once (the PeerJS server, the MQTT brokers in
  // transport.js, and the relay's plain-HTTPS mailbox in box.js for networks that block the
  // others); friends can join through whichever answers them.
  async host() {
    const cfg = netConfig();
    if (cfg.offline) throw new Error('multiplayer is switched off in this browser');
    const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    this.code = code;
    const peerP = loadLib().then(() => this.registerPeer(code));
    const roomP = cfg.brokers && cfg.brokers.length
      ? hostRoom(code, cfg, ch => { if (!this.closed) this.onIncoming(ch); }).then(r => { if (this.closed) r.close(); else this.room = r; return r; })
      : Promise.reject(new Error('no brokers'));
    const boxP = hostBox(code, cfg, ch => { if (!this.closed) this.onIncoming(ch); }).then(r => { if (this.closed) r.close(); else this.box = r; return r; });
    try { await Promise.any([peerP, roomP, boxP]); }
    catch (e) {
      const why = e.errors ? e.errors.map(x => x && x.message).filter(Boolean).join(' / ') : e.message;
      throw new Error(`Could not open the game to friends: the multiplayer servers could not be reached. Check your internet connection. (${why})`);
    }
    peerP.catch(e => console.warn('PeerJS room unavailable; using the relay servers only.', e && e.message));
    roomP.catch(e => console.warn('Relay servers unavailable; using PeerJS only.', e && e.message));
    boxP.catch(e => console.warn('Relay mailbox unavailable.', e && e.message));
    return code;
  }
  async registerPeer(code) {
    const peer = makePeer(PREFIX + code);
    try {
      await timeout(new Promise((resolve, reject) => { peer.on('open', resolve); peer.on('error', e => reject(e)); }), 15000, 'The PeerJS server did not answer.');
    } catch (e) { peer.destroy(); throw new Error(e && e.type ? peerError(e) : e.message); }
    if (this.closed) { peer.destroy(); return null; }
    this.peer = peer;
    peer.off('error');
    peer.on('error', e => { if (e.type !== 'peer-unavailable') console.warn('peer error', e.type, e.message); });
    // Keep accepting friends if the link to the signaling server drops.
    peer.on('disconnected', () => { if (!this.closed) setTimeout(() => { if (!this.closed && peer.disconnected && !peer.destroyed) peer.reconnect(); }, 2000); });
    peer.on('connection', conn => this.onIncoming(conn));
    return peer;
  }
  onIncoming(conn) {
    this.acceptLink(new Link(new SealedChannel(conn)));
  }
  acceptLink(link) {
    let guest = null;
    const bail = reason => { link.send({ t: 'reject', reason }); setTimeout(() => link.close(), 500); };
    const helloTimer = setTimeout(() => { if (!guest) link.close(); }, 15000);
    link.onClose = () => { clearTimeout(helloTimer); if (guest) this.removeGuest(guest.id, 'left the game'); };
    link.onMessage = m => {
      if (guest) { this.onMessage(m, guest); return; }
      if (m.t !== 'hello') return;
      clearTimeout(helloTimer);
      const name = cleanName(m.name);
      if (m.v !== PROTOCOL) { bail('Your game is a different version. Refresh the page (Ctrl+Shift+R) and try again.'); return; }
      if (!name) { bail('Pick a name first.'); return; }
      if (this.guests.size + 1 >= MAX_HUMANS) { bail(`This game is full (${MAX_HUMANS} players max).`); return; }
      // The session decides (locked games, a full room with no bot to replace, taken names).
      const r = this.session.admit({ name, primary: String(m.primary || ''), cosmetics: m.cosmetics });
      if (r.reason) { bail(r.reason); return; }
      guest = { id: r.id, name: r.name, link };
      this.guests.set(guest.id, guest);
      link.send({ t: 'welcome', id: guest.id, ...r.welcome });
      this.broadcast({ t: 'join', id: guest.id, name: guest.name }, guest.id);
    };
  }

  // ---------------- joining ----------------
  // Both ways of finding the room are tried at once; the first channel that opens is used.
  static async join(session, code, hello, status = () => {}) {
    const net = new Net(session, 'guest');
    net.code = code;
    const cfg = netConfig();
    status('Contacting the multiplayer servers…');
    let winner = null;
    const claim = (conn, how) => { if (winner) { try { conn.close(); } catch { /* ignore */ } return false; } winner = { conn, how }; return true; };
    const viaPeer = (async () => {
      await loadLib();
      const peer = makePeer();
      let lastError = null;
      peer.on('error', e => { lastError = e; });
      try {
        await timeout(new Promise((resolve, reject) => { peer.on('open', resolve); peer.on('error', reject); }), 15000, 'The PeerJS server did not answer.');
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
        await timeout(new Promise((resolve, reject) => { conn.on('open', resolve); peer.on('error', reject); conn.on('error', reject); }), 20000, 'Could not connect directly.');
        if (!claim(conn, 'direct')) { peer.destroy(); return; }
        net.peer = peer;
      } catch (e) { peer.destroy(); const err = new Error(peerError(lastError && lastError.type ? lastError : e)); err.notFound = (lastError || e).type === 'peer-unavailable'; throw err; }
    })();
    const viaRoom = cfg.brokers && cfg.brokers.length ? (async () => {
      const r = await joinRoom(code, cfg, s => { if (!winner) status(s); });
      claim(r.channel, r.relayed ? 'relay' : 'direct');
    })() : Promise.reject(new Error('no brokers'));
    // The relay's plain-HTTPS mailbox: what gets through filters that break WebSockets.
    const viaBox = (async () => { const ch = await joinBox(code, cfg); claim(ch, 'relay'); })();
    try { await Promise.any([viaPeer, viaRoom, viaBox]); }
    catch (e) {
      const errs = (e.errors || [e]).filter(Boolean);
      const nf = errs.find(x => x.notFound);
      throw new Error(nf ? nf.message : errs.map(x => x.message).join(' — ') || 'Connection failed.');
    }
    // A slower path that connects later is closed by claim().
    viaPeer.catch(() => {}); viaRoom.catch(() => {}); viaBox.catch(() => {});
    const link = new Link(new SealedChannel(winner.conn), HOST_PARTS);
    net.hostLink = link; net.relayed = winner.how === 'relay';
    status(net.relayed ? 'Connected through the relay servers. Joining…' : 'Joining…');
    const welcome = await timeout(new Promise((resolve, reject) => {
      link.onMessage = m => { if (m.t === 'welcome') resolve(m); else if (m.t === 'reject') reject(new Error(m.reason)); };
      link.onClose = () => reject(new Error('The host closed the connection.'));
      link.send({ t: 'hello', v: PROTOCOL, ...hello });
    }), 30000, 'The host did not answer.');
    link.onMessage = m => net.onMessage(m, null);
    link.onClose = () => net.onHostLost();
    return { net, welcome };
  }
  onHostLost() {
    if (this.closed) return;
    this.closed = true;
    this.session.onDisconnected?.('Connection to the host was lost.');
  }

  // ---------------- messaging ----------------
  send(m) {
    if (this.isHost) this.broadcast(m);
    else if (this.hostLink) this.hostLink.send(m);
  }
  broadcast(m, except = -1) { for (const g of this.guests.values()) if (g.id !== except && g.link) g.link.send(m); }
  sendTo(id, m) { const g = this.guests.get(id); if (g && g.link) g.link.send(m); }
  onMessage(m, from) {
    if (m.t === 'ka') { if (this.isHost && from) from.link.send({ t: 'kb', ts: m.ts }); return; }
    if (m.t === 'kb') { if (!this.isHost) this.session.onPong?.(m.ts); return; }
    // Host: a guest's message. Never obey host-only types; stamp the real sender.
    if (this.isHost && from) {
      if (m.t === 'part' || HOST_ONLY.has(m.t)) return;
      m.id = from.id;
      if (m.t === 'chat') { const msg = cleanChat(m.msg); if (!msg) return; m = { t: 'chat', id: from.id, msg, team: !!m.team }; }
      if (RELAY.has(m.t)) this.session.relayChat?.(m, from.id) ?? this.broadcast(m, from.id);
      this.session.onGuestMessage(m, from.id);
      return;
    }
    if (m.t === 'bye') { this.closed = true; this.session.onDisconnected?.('The host ended the game.'); return; }
    this.session.onHostMessage(m);
  }
  removeGuest(id, why) {
    const g = this.guests.get(id);
    if (!g) return;
    this.guests.delete(id);
    if (g.link) g.link.close();
    this.broadcast({ t: 'leave', id, reason: why });
    this.session.onGuestLeft(id, why);
  }
  kick(id, reason = 'You were booted from this game.') {
    const g = this.guests.get(id); if (!g) return;
    g.link.send({ t: 'boot', reason });
    setTimeout(() => this.removeGuest(id, 'was booted'), 300);
  }
  // Drop links that have silently died. A long gap since the last check means this page itself was
  // frozen (a slow device building a map or compiling shaders right after joining): what arrived in
  // the meantime hasn't been read yet, so every link gets a fresh grace period instead of the blame.
  checkLinks() {
    const now = performance.now(), frozen = this.lastCheck !== undefined && now - this.lastCheck > 5000;
    this.lastCheck = now;
    if (frozen) { for (const g of this.guests.values()) if (g.link) g.link.seen = Math.max(g.link.seen, now); if (this.hostLink) this.hostLink.seen = Math.max(this.hostLink.seen, now); return; }
    if (this.isHost) { for (const g of [...this.guests.values()]) if (g.link && now - g.link.seen > LINK_TIMEOUT) this.removeGuest(g.id, 'timed out'); }
    else if (this.hostLink && now - this.hostLink.seen > LINK_TIMEOUT) this.onHostLost();
  }
  close() {
    if (this.closed && !this.peer && !this.room && !this.box) return;
    this.closed = true;
    try { if (this.isHost) this.broadcast({ t: 'bye' }); } catch { /* ignore */ }
    clearInterval(this.kaTimer);
    if (this.kaWorker) { this.kaWorker.terminate(); this.kaWorker = null; }
    setTimeout(() => {
      for (const g of this.guests.values()) if (g.link) g.link.close();
      if (this.hostLink) this.hostLink.close();
      if (this.peer) this.peer.destroy();
      if (this.room) this.room.close();
      if (this.box) this.box.close();
      this.peer = null; this.room = null; this.box = null;
    }, 300);
  }
}

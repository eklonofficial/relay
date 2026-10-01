// Multiplayer over WebRTC data channels.
//
// One player hosts: their saved world is the real one, and they relay everything between the
// others (a star, so each guest only needs one connection). Friends join with a five-letter room
// code; a free public PeerJS server only introduces the browsers to each other, after which data
// flows directly between them. Up to five players per world.
//
// Sync model: every client simulates its own surroundings. Whoever causes a block change (their
// own hands, or their own water/fire/sand simulation) broadcasts it once; everyone else mirrors it
// silently, so nothing is applied twice. The host keeps the authoritative save, including each
// guest's inventory and position, and owns the clock and the weather.
import { RemotePlayer } from './remote.js?v=muphwqr9';
import { getChunk } from '../game/storage.js?v=muphwqr9';
import { EntitySync } from './share.js?v=muphwqr9';
import { hostRoom, joinRoom, diagnose } from './transport.js?v=muphwqr9';

export const MAX_PLAYERS = 5;
const PREFIX = 'blockhaven-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROTOCOL = 2; // 2: chat/death lines are built by the receiver; hello carries a per-browser key
const PART = 12000;
// Reassembly limits: parts per message (512 ≈ 6 MB; the host's world download may use more), messages
// half-received at once, and how long a half-received message may sit idle.
const MAX_PARTS = 512, HOST_PARTS = 8192, MAX_PENDING = 8, PART_TTL = 30000;
const STATE_HZ = 20;
// A link that has been silent this long is dead (keep-alives go out every 2 s, even from background tabs).
const LINK_TIMEOUT = 20000;
// Guest messages the host passes on to every other guest.
const RELAY = new Set(['st', 'ed', 'be', 'chat', 'death', 'fx', 'ent', 'pop']);
// Only the host may send these; a guest's copy is dropped rather than obeyed or passed on.
const HOST_ONLY = new Set(['hello', 'welcome', 'reject', 'join', 'leave', 'bye', 'env']);

export const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
export const cleanName = s => String(s || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
// Per-browser secret that ties a guest's saved progress to them (sent to the host only).
export const cleanKey = s => (typeof s === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(s) ? s : '');
// Chat text: no control or bidi-override characters, one line, capped.
export const CHAT_MAX = 256;
export const cleanChat = s => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, '').trim().slice(0, CHAT_MAX);
export const chatLine = (name, msg) => `<${name}> ${cleanChat(msg)}`;
// Death lines are rebuilt by each receiver from the dead player's real name, a kind and a killer name.
const cleanBy = s => cleanChat(s).replace(/[<>]/g, '').slice(0, 32);
export function deathText(who, kind, by) {
  const name = by ? cleanBy(by) : '';
  switch (kind) {
    case 'fall': return `${who} fell from a high place`;
    case 'lava': return `${who} tried to swim in lava`;
    case 'fire': return `${who} burned to death`;
    case 'drown': return `${who} drowned`;
    case 'starve': return `${who} starved to death`;
    case 'void': return `${who} fell out of the world`;
    case 'explosion': return name ? `${who} was blown up by ${name}` : `${who} blew up`;
    case 'projectile': return `${who} was shot by ${name || 'an arrow'}`;
    case 'magic': return `${who} was killed by magic`;
    case 'wither': return `${who} withered away`;
    case 'lightning': return `${who} was struck by lightning`;
    case 'kill': return `${who} was killed`;
    default: return name ? `${who} was slain by ${name}` : `${who} died`;
  }
}
// A guest's saved progress: { key, d } since protocol 2; older saves hold the bare data (no key yet).
export const savedEntry = e => (!e || typeof e !== 'object' ? null : typeof e.key === 'string' && 'd' in e ? { key: e.key, d: e.d } : { key: null, d: e });
const r3 = v => Math.round(v * 1000) / 1000;

let libPromise = null;
function loadLib() {
  if (window.Peer) return Promise.resolve();
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL('../../vendor/peerjs.min.js?v=muphwqr9', import.meta.url).href;
      s.onload = () => resolve();
      s.onerror = () => { libPromise = null; reject(new Error('Could not load the multiplayer library. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}
// Free hosting puts an idle relay to sleep; a request wakes it while the player is still choosing.
export function wakeRelays() { for (const u of netConfig().wake || []) fetch(u, { mode: 'no-cors', cache: 'no-store' }).catch(() => {}); }
export const diagnoseNetwork = onResult => diagnose(netConfig(), onResult);
function netConfig() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem('blockhaven.net')); } catch { /* none */ }
  return { ...(window.BLOCKHAVEN_NET || {}), ...(o || {}) };
}
function makePeer(id) {
  const c = netConfig();
  const opts = { ...(c.peer || {}), config: { iceServers: c.iceServers || [] }, debug: 0 };
  return id ? new window.Peer(id, opts) : new window.Peer(opts);
}
const peerError = e => {
  switch (e && e.type) {
    case 'peer-unavailable': return 'No open world was found with that code. Check the code, and that your friend has pressed "Open to Friends".';
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

export class Net {
  constructor(app, role) {
    this.app = app; this.role = role; // 'host' | 'guest'
    this.players = new Map(); // id -> { id, name, skin, link?, rp }
    this.myId = role === 'host' ? 0 : -1;
    this.edits = []; this.beDirty = new Map();
    this.stateT = 0; this.envT = 0; this.pdataT = 0; this.flushT = 0;
    this.swingCount = 0; this.hurtCount = 0;
    this.applying = false; this.closed = false;
    this.share = new EntitySync(this);
    // Keep-alive on a timer, not the frame loop: a browser pauses the game while its tab is in
    // the background, and the others must not mistake that for a lost connection.
    // The ticks come from a tiny worker: timers on the page itself are throttled to once a minute
    // in background tabs, which would make a minimised player look disconnected.
    const ka = () => { if (this.closed) return; if (this.isHost) this.broadcast({ t: 'ka' }); else if (this.hostLink) this.hostLink.send({ t: 'ka' }); };
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 2000);'], { type: 'text/javascript' }));
      this.kaWorker = new Worker(url); URL.revokeObjectURL(url);
      this.kaWorker.onmessage = ka;
    } catch { this.kaTimer = setInterval(ka, 2000); }
  }
  get game() { return this.app.game; }
  get isHost() { return this.role === 'host'; }
  get count() { return this.players.size + 1; }

  // ---------------- hosting ----------------
  // Rooms are registered two independent ways at once (the PeerJS server and the MQTT brokers
  // in transport.js); friends can join through whichever answers them.
  async host(name, skin) {
    this.name = name; this.skin = skin;
    const cfg = netConfig();
    const code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    this.code = code;
    const peerP = loadLib().then(() => this.registerPeer(code));
    const roomP = cfg.brokers && cfg.brokers.length
      ? hostRoom(code, cfg, ch => { if (!this.closed) this.onIncoming(ch); }).then(r => { if (this.closed) r.close(); else this.room = r; return r; })
      : Promise.reject(new Error('no brokers'));
    try { await Promise.any([peerP, roomP]); }
    catch (e) {
      const why = e.errors ? e.errors.map(x => x && x.message).filter(Boolean).join(' / ') : e.message;
      throw new Error(`Could not open the world to friends: the multiplayer servers could not be reached. Check your internet connection. (${why})`);
    }
    peerP.catch(e => console.warn('PeerJS room unavailable; using the relay servers only.', e && e.message));
    roomP.catch(e => console.warn('Relay servers unavailable; using PeerJS only.', e && e.message));
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
    const link = new Link(conn);
    let player = null;
    const bail = reason => { link.send({ t: 'reject', reason }); setTimeout(() => link.close(), 500); };
    const helloTimer = setTimeout(() => { if (!player) link.close(); }, 15000);
    link.onClose = () => { clearTimeout(helloTimer); if (player) this.removePlayer(player.id, 'left the game'); };
    link.onMessage = m => {
      if (player) { this.onMessage(m, player); return; }
      if (m.t !== 'hello') return;
      clearTimeout(helloTimer);
      const name = cleanName(m.name), key = cleanKey(m.key);
      if (m.v !== PROTOCOL || !key) { bail('Your game is a different version. Refresh the page (Ctrl+Shift+R) and try again.'); return; }
      if (!this.game) { bail('The host is not in a world right now.'); return; }
      if (this.count >= MAX_PLAYERS) { bail(`This world is full (${MAX_PLAYERS} players max).`); return; }
      if (!name) { bail('Pick a name first.'); return; }
      // A guest coming back before their old connection timed out replaces it.
      const stale = [...this.players.values()].find(p => p.name.toLowerCase() === name.toLowerCase());
      if (stale && stale.key === key) this.removePlayer(stale.id, 'reconnected');
      if (name.toLowerCase() === this.name.toLowerCase() || [...this.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) { bail(`Someone called ${name} is already playing. Pick another name.`); return; }
      // Saved progress belongs to the browser that first played under this name here.
      const g = this.game, e = savedEntry((g.meta.players || {})[name]);
      if (e && e.key && e.key !== key) { bail(`Someone else has already played as ${name} in this world. Pick another name.`); return; }
      g.meta.players = g.meta.players || {};
      g.meta.players[name] = { key, d: e ? e.d : null };
      let id = 1;
      while (this.players.has(id)) id++;
      player = { id, name, skin: m.skin | 0, link, key };
      this.players.set(id, player);
      link.send({ t: 'welcome', id, host: { id: 0, name: this.name, skin: this.skin }, meta: this.snapshot(name), players: [...this.players.values()].filter(p => p.id !== id).map(p => ({ id: p.id, name: p.name, skin: p.skin })) });
      this.broadcast({ t: 'join', id, name, skin: player.skin }, id);
      this.addRemote(player);
      this.app.chat(`${name} joined the game`, '#ffff55');
      this.app.onPlayersChanged();
    };
  }
  // The world as a guest needs it: seed, settings, every edit and container, and their own data.
  snapshot(name) {
    const g = this.game, s = g.serialize();
    const dims = {};
    for (const [d, v] of Object.entries(s.dims || {})) dims[d] = { edits: v.edits, blockEntities: v.blockEntities, populated: v.populated, popOld: v.popOld };
    const e = savedEntry((g.meta.players || {})[name]), saved = (e && e.d) || null;
    return {
      name: s.name, seed: s.seed, seedText: s.seedText, type: s.type, mode: s.mode, difficulty: s.difficulty, cheats: s.cheats, rules: s.rules,
      time: s.time, day: s.day, weather: s.weather, spawn: s.spawn, dragonKilled: s.dragonKilled, dims, saved, genVersion: s.genVersion, palette: s.palette,
      java: s.java ? { dims: s.java.dims, beyond: s.java.beyond, border: s.java.border } : undefined,
    };
  }

  // ---------------- joining ----------------
  // Both ways of finding the room are tried at once; the first channel that opens is used.
  static async join(app, code, name, skin, key, status = () => {}) {
    const net = new Net(app, 'guest');
    net.name = name; net.skin = skin; net.code = code;
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
    try { await Promise.any([viaPeer, viaRoom]); }
    catch (e) {
      const errs = (e.errors || [e]).filter(Boolean);
      const nf = errs.find(x => x.notFound);
      throw new Error(nf ? nf.message : errs.map(x => x.message).join(' — ') || 'Connection failed.');
    }
    // A slower path that connects later is closed by claim().
    viaPeer.catch(() => {}); viaRoom.catch(() => {});
    const link = new Link(winner.conn, HOST_PARTS);
    net.hostLink = link; net.relayed = winner.how === 'relay';
    status(net.relayed ? 'Connected through the relay servers. Downloading the world…' : 'Downloading the world…');
    const welcome = await timeout(new Promise((resolve, reject) => {
      link.onMessage = m => { if (m.t === 'welcome') resolve(m); else if (m.t === 'reject') reject(new Error(m.reason)); };
      link.onClose = () => reject(new Error('The host closed the connection.'));
      link.send({ t: 'hello', v: PROTOCOL, name, skin, key });
    }), 90000, 'The host did not answer.');
    net.myId = welcome.id;
    link.onMessage = m => net.onMessage(m, null);
    link.onClose = () => net.onHostLost();
    net.pendingPlayers = [welcome.host, ...welcome.players];
    return { net, welcome };
  }
  // Called once the guest's game has started.
  attach() {
    for (const p of this.pendingPlayers || []) { this.players.set(p.id, { ...p }); this.addRemote(this.players.get(p.id)); }
    this.pendingPlayers = null;
    this.app.onPlayersChanged();
  }
  // Imported Java worlds: guests fetch those chunks from the host, which keeps them in storage.
  requestChunk(d, k) {
    const key = `${d}/${k}`;
    this.chunkWaits = this.chunkWaits || new Map();
    if (this.chunkWaits.has(key)) return this.chunkWaits.get(key).p;
    let resolve;
    const p = new Promise(r => { resolve = r; });
    const t = setTimeout(() => { this.chunkWaits.delete(key); resolve(null); }, 30000);
    this.chunkWaits.set(key, { p, resolve: v => { clearTimeout(t); this.chunkWaits.delete(key); resolve(v); } });
    this.send({ t: 'ichunk', d, k });
    return p;
  }
  chunkArrived(m) {
    const w = this.chunkWaits && this.chunkWaits.get(`${m.d}/${m.k}`);
    if (!w) return;
    let bytes = null;
    try { if (typeof m.b === 'string') { const s = atob(m.b); bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); } } catch { bytes = null; }
    w.resolve(bytes);
  }
  async serveChunk(to, d, k) {
    const g = this.game;
    if (!/^-?\d+,-?\d+$/.test(k) || !g.meta.java || !(g.meta.java.dims?.[d] || []).includes(k)) { this.sendTo(to, { t: 'ichunkd', d, k, b: null }); return; }
    const raw = await getChunk(`${g.meta.id}/${d}/${k}`);
    let b = null;
    if (raw) { let s = ''; for (let i = 0; i < raw.length; i += 0x8000) s += String.fromCharCode(...raw.subarray(i, i + 0x8000)); b = btoa(s); }
    this.sendTo(to, { t: 'ichunkd', d, k, b });
  }
  onHostLost() {
    if (this.closed) return;
    this.closed = true;
    this.app.onDisconnected('Connection to the host was lost.', { retry: true });
  }

  // ---------------- messaging ----------------
  send(m) {
    if (this.isHost) this.broadcast(m);
    else if (this.hostLink) this.hostLink.send(m);
  }
  broadcast(m, except = -1) { for (const p of this.players.values()) if (p.id !== except && p.link) p.link.send(m); }
  sendTo(id, m) {
    if (this.isHost) { const p = this.players.get(id); if (p && p.link) p.link.send(m); }
    else if (this.hostLink) this.hostLink.send({ ...m, to: id });
  }
  onMessage(m, from) {
    // Host: relay guest traffic, or deliver messages addressed to someone else.
    if (this.isHost && from) {
      if (m.t === 'part' || HOST_ONLY.has(m.t)) return;
      m.id = from.id;
      if (m.from !== undefined) m.from = from.id;
      // Chat and death lines carry only the raw words; each receiver adds the sender's real name.
      if (m.t === 'chat') { const msg = cleanChat(m.msg); if (!msg) return; m = { t: 'chat', id: from.id, msg }; }
      else if (m.t === 'death') m = { t: 'death', id: from.id, k: String(m.k || '').slice(0, 16), by: m.by ? cleanBy(m.by) : null };
      if (m.to !== undefined && m.to !== 0) { const p = this.players.get(m.to); if (p && p.link) p.link.send(m); return; }
      if (RELAY.has(m.t)) this.broadcast(m, from.id);
    }
    const g = this.game;
    switch (m.t) {
      case 'st': { const p = this.players.get(m.id); if (p && p.rp) p.rp.push(m); break; }
      case 'ed': if (g) this.applyEdits(m.e); break;
      case 'be': if (g) this.applyBlockEntity(m); break;
      case 'chat': { const n = this.nameOf(m.id), msg = cleanChat(m.msg); if (n && msg) this.app.chat(chatLine(n, msg)); break; }
      case 'death': { const n = this.nameOf(m.id); if (n) this.app.chat(deathText(n, m.k, m.by), '#ff8080'); break; }
      case 'fx': if (g) this.playFx(m); break;
      case 'ent': if (g) this.share.onEnt(m); break;
      case 'ehit': if (g) this.share.onEhit(m); break;
      case 'take': if (g) this.share.onTake(m); break;
      case 'give': if (g) this.share.onGive(m); break;
      case 'givexp': if (g) this.share.onGiveXp(m); break;
      case 'claim': if (g) this.share.onClaim(m); break;
      case 'own': if (g) this.share.onOwn(m); break;
      case 'handover': if (g && this.isHost) this.share.onHandover(m); break;
      case 'pop': if (g) g.applyRemotePopulated(m.d, m.k); break;
      case 'ichunk': if (g && this.isHost && from) this.serveChunk(from.id, m.d | 0, String(m.k || '')); break;
      case 'ichunkd': if (!this.isHost) this.chunkArrived(m); break;
      case 'rsuse': if (g && this.isHost && m.d === g.dim && Array.isArray(m.p)) g.rs.use(m.p[0] | 0, m.p[1] | 0, m.p[2] | 0); break;
      case 'hit': if (g) this.onHit(m); break;
      case 'env': if (g && !this.isHost) this.applyEnv(m); break;
      case 'pdata': if (this.isHost && from && g) { g.meta.players = g.meta.players || {}; g.meta.players[from.name] = { key: from.key, d: m.d }; } break;
      case 'join': this.players.set(m.id, { id: m.id, name: m.name, skin: m.skin }); this.addRemote(this.players.get(m.id)); this.app.chat(`${m.name} joined the game`, '#ffff55'); this.app.onPlayersChanged(); break;
      case 'leave': this.removePlayer(m.id, m.reason || 'left the game'); break;
      case 'bye': if (!this.isHost) { this.closed = true; this.app.onDisconnected('The host closed the world.'); } break;
      default: break;
    }
  }
  removePlayer(id, why) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.share.dropOwner(id);
    if (p.rp) p.rp.dead = true;
    if (p.link) p.link.close();
    if (this.isHost) this.broadcast({ t: 'leave', id, reason: why });
    this.app.chat(`${p.name} ${why}`, '#ffff55');
    this.app.onPlayersChanged();
  }
  addRemote(p) {
    if (!this.game) return;
    p.rp = new RemotePlayer(this.game, p);
  }
  nameOf(id) { const p = id !== this.myId && this.players.get(id); return p ? p.name : null; }
  remotePlayers() { return [...this.players.values()].map(p => p.rp).filter(Boolean); }
  playerNames() { return [this.name, ...[...this.players.values()].map(p => p.name)]; }

  // ---------------- per-frame ----------------
  update(dt) {
    const g = this.game;
    if (!g || this.closed) return;
    // Keep remote players in the entity list of whichever dimension they share with us.
    let stray = false;
    for (const rp of this.remotePlayers()) {
      const here = rp.dim === g.dim && !rp.dead;
      const inList = g.entities.list.includes(rp);
      if (here && !inList) g.entities.list.push(rp);
      else if (!here && inList) stray = true;
    }
    if (stray) g.entities.list = g.entities.list.filter(e => !(e.remote && e.dim !== g.dim));
    this.stateT += dt;
    if (this.stateT >= 1 / STATE_HZ) { this.stateT = 0; this.sendState(); }
    this.flushT += dt;
    if (this.flushT >= 0.05) { this.flushT = 0; this.flush(); }
    this.share.update(dt);
    if (this.isHost) {
      this.envT += dt;
      if (this.envT >= 1) { this.envT = 0; this.broadcast({ t: 'env', time: g.dayTime, day: g.day, w: g.weather, pvp: g.rules.pvp !== false }); }
      // Drop guests whose connection silently died.
      const now = performance.now();
      for (const p of [...this.players.values()]) if (p.link && now - p.link.seen > LINK_TIMEOUT) this.removePlayer(p.id, 'timed out');
    } else {
      this.pdataT += dt;
      if (this.pdataT >= 10) { this.pdataT = 0; this.sendPlayerData(); }
      if (this.hostLink && performance.now() - this.hostLink.seen > LINK_TIMEOUT) this.onHostLost();
    }
  }
  sendState() {
    const g = this.game, p = g.player, it = this.app.interact;
    if (!p) return;
    const sw = it ? it.swing : 0;
    if (sw > (this.lastSwing || 0) + 0.05) this.onSwing();
    this.lastSwing = sw;
    const inv = g.inv;
    this.send({
      t: 'st', id: this.myId, p: [r3(p.pos[0]), r3(p.pos[1]), r3(p.pos[2])], y: r3(p.yaw), pi: r3(p.pitch), d: g.dim,
      v: [r3(p.vel[0]), r3(p.vel[1]), r3(p.vel[2])],
      f: (p.sneaking ? 1 : 0) | (p.sprinting ? 2 : 0) | (p.gliding ? 4 : 0) | (g.riding ? 8 : 0) | (g.alive ? 0 : 16) | (g.mode === 'spectator' ? 32 : 0) | (g.blocking ? 64 : 0) | (p.flying ? 128 : 0) | (g.stats.fire > 0 ? 256 : 0) | (it && (it.using === 'bow' || it.using === 'crossbow') ? 512 : 0) | (it && it.using === 'trident' ? 1024 : 0) | (!it?.using && inv.held && inv.held.key === 'crossbow' && inv.held.tag && inv.held.tag.loaded ? 2048 : 0),
      h: inv.held ? inv.held.key : 0, o: inv.offhand.get(0) ? inv.offhand.get(0).key : 0,
      a: inv.armor.slots.map(s => (s ? s.key : 0)),
      sc: this.swingCount, hc: this.hurtCount, hp: Math.ceil(g.stats.health), m: g.mode,
    });
  }
  // Local swing / hurt events show up on everyone else's copy of us.
  onSwing() { this.swingCount = (this.swingCount + 1) % 1000; }
  onHurt() { this.hurtCount = (this.hurtCount + 1) % 1000; }

  // ---------------- blocks ----------------
  // Every block change made on this machine (not ones we are mirroring) goes out once.
  onLocalEdit(dim, x, y, z, id, m) { if (!this.applying) this.edits.push(dim, x, y, z, id, m); }
  flush() {
    if (this.edits.length) { this.send({ t: 'ed', id: this.myId, e: this.edits }); this.edits = []; }
    if (this.beDirty.size) {
      for (const [k, { dim, be }] of this.beDirty) this.send({ t: 'be', id: this.myId, d: dim, k, be: plainBE(be) });
      this.beDirty.clear();
    }
  }
  applyEdits(e) {
    const g = this.game;
    this.applying = true;
    try {
      for (let i = 0; i + 5 < e.length + 0; i += 6) {
        const [dim, x, y, z, id, m] = [e[i], e[i + 1], e[i + 2], e[i + 3], e[i + 4], e[i + 5]];
        if (dim === g.dim) g.world.setBlockRemote(x, y, z, id, m);
        else g.storeRemoteEdit(dim, x, y, z, id, m);
      }
    } finally { this.applying = false; }
  }
  onLocalBlockEntity(dim, k, be) { if (!this.applying) this.beDirty.set(k, { dim, be }); }
  applyBlockEntity(m) {
    const g = this.game;
    this.applying = true;
    try { g.applyRemoteBlockEntity(m.d, m.k, m.be); } finally { this.applying = false; }
  }

  // ---------------- combat ----------------
  hit(rp, amount, src) {
    const g = this.game;
    if (g.rules.pvp === false && (src.kind === 'player' || src.kind === 'projectile')) return false;
    if (rp.mode === 'creative' || rp.mode === 'spectator' || rp.deadFlag) return false;
    const sp = src.pos || (src.projectile && src.projectile.pos) || null;
    const atk = src.attacker, weapon = src.weapon || (atk && atk.equipment && atk.equipment.hand) || null;
    const an = atk && atk !== this.game.playerEntity && atk.def ? (atk.displayName || atk.def.name) : null;
    this.sendTo(rp.id, { t: 'hit', from: this.myId, dmg: amount, kind: src.kind || 'player', knock: src.knock || null, ks: src.knockStrength || 0, fire: src.fire || 0, w: weapon, sp: sp && sp.map(r3), an, ap: atk && atk.pos ? atk.pos.map(r3) : null });
    return true;
  }
  onHit(m) {
    const g = this.game;
    const from = this.players.get(m.from);
    if (m.fire) g.playerEntity.setFire(m.fire);
    if (!m.dmg) return;
    // A mob on someone else's machine: name it (for the death message) and place it (for shields).
    const attacker = m.an ? { def: { name: m.an }, displayName: m.an, pos: m.ap || (from && from.rp ? from.rp.pos : null), isLiving: true } : from ? from.rp : null;
    g.damagePlayer(m.dmg, { kind: m.kind, attacker, weapon: m.w, pos: m.sp || undefined, knock: m.knock, knockStrength: m.ks });
  }
  // Sounds and particles other players should hear/see (explosions, block breaks…).
  fx(kind, pos, extra = {}) { this.send({ t: 'fx', id: this.myId, k: kind, p: pos.map(r3), ...extra }); }
  playFx(m) {
    const g = this.game;
    if (m.d !== undefined && m.d !== g.dim) return;
    if (m.k === 'sound') g.sound.play(m.s, m.p, m.v || 1);
    else if (m.k === 'break') { g.sound.dig(m.s, m.p); g.particles.block(Math.floor(m.p[0]), Math.floor(m.p[1]), Math.floor(m.p[2]), m.b, m.bm || 0, 20); }
    else if (m.k === 'chest') g.chestViewer(m.p[0], m.p[1], m.p[2], m.o);
    else if (m.k === 'explode') { g.sound.play('explode', m.p, 1.6); g.particles.explosion(m.p, m.pw || 4); }
  }

  // ---------------- world clock & saving ----------------
  applyEnv(m) {
    const g = this.game;
    let d = m.time - g.dayTime;
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
    g.dayTime = Math.abs(d) > 0.01 ? m.time : (g.dayTime + d * 0.2 + 1) % 1;
    g.day = m.day;
    Object.assign(g.weather, m.w);
    g.rules.pvp = m.pvp;
  }
  sendPlayerData() {
    const g = this.game;
    if (!g || this.isHost || !g.player) return;
    this.hostLink && this.hostLink.send({ t: 'pdata', d: g.playerData() });
  }
  close() {
    if (this.closed && !this.peer && !this.room) return;
    this.closed = true;
    try {
      if (this.isHost) this.broadcast({ t: 'bye' });
      else { this.share.handoverAll(); this.sendPlayerData(); }
    } catch { /* ignore */ }
    clearInterval(this.kaTimer);
    if (this.kaWorker) { this.kaWorker.terminate(); this.kaWorker = null; }
    setTimeout(() => {
      for (const p of this.players.values()) if (p.link) p.link.close();
      if (this.hostLink) this.hostLink.close();
      if (this.peer) this.peer.destroy();
      if (this.room) this.room.close();
      this.peer = null; this.room = null;
    }, 300);
    for (const p of this.players.values()) if (p.rp) p.rp.dead = true;
  }
}

// Block entities travel as plain JSON (their live Container wrapper is not enumerable).
function plainBE(be) { return JSON.parse(JSON.stringify(be)); }

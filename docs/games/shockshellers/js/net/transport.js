// A second way for players to find each other that does not depend on any one server.
//
// Rooms are topics on several free public MQTT brokers (over secure WebSockets), used at once:
//  1. The guest "knocks" on the room's topic; the host answers, so a wrong code fails fast.
//  2. The browsers exchange WebRTC offers/answers and ICE candidates through those topics and
//     try to open a direct data channel.
//  3. If no direct route exists (strict school/mobile/office NATs, no TURN relay configured), the
//     game data itself travels through the brokers instead. Slower, but the join still works.
// Both ends publish to every broker they reached and drop duplicates, so one broker being down
// or slow doesn't matter. Channels look like PeerJS connections (on/send/close/open) so the rest
// of the networking code doesn't care which path was used.

const ROOT = 'shockshellers/v1';
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const enc = new TextEncoder(), dec = new TextDecoder();

// ---------------- a minimal MQTT 3.1.1 client over WebSocket (QoS 0) ----------------
function varint(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
function str(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
function packet(type, body) { const u = new Uint8Array(1 + varint(body.length).length + body.length); const h = [type, ...varint(body.length)]; u.set(h, 0); u.set(body, h.length); return u; }

class Mqtt {
  constructor(url) {
    // Brokers that need a (public) login are written wss://user:pass@host/...; browsers refuse
    // credentials in WebSocket URLs, so they go into the CONNECT packet instead.
    const m = /^(wss?:\/\/)([^:@/]+):([^@/]*)@(.*)$/.exec(url);
    this.url = m ? m[1] + m[4] : url; this.user = m ? decodeURIComponent(m[2]) : null; this.pass = m ? decodeURIComponent(m[3]) : null;
    this.ws = null; this.ok = false; this.subs = new Map(); this.pid = 1; this.buf = new Uint8Array(0); this.onDown = null;
  }
  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => { if (done) return; done = true; clearTimeout(t); if (err) { try { this.ws && this.ws.close(); } catch { /* ignore */ } reject(err); } else resolve(this); };
      const t = setTimeout(() => finish(new Error('timeout')), timeoutMs);
      let ws;
      try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { finish(e); return; }
      this.ws = ws; ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const flags = 2 | (this.user !== null ? 0x80 : 0) | (this.pass !== null ? 0x40 : 0);
        const body = [...str('MQTT'), 4, flags, 0, 60, ...str('bh' + rid()), ...(this.user !== null ? str(this.user) : []), ...(this.pass !== null ? str(this.pass) : [])];
        ws.send(packet(0x10, body));
      };
      ws.onmessage = e => {
        const d = new Uint8Array(e.data), all = new Uint8Array(this.buf.length + d.length);
        all.set(this.buf); all.set(d, this.buf.length); this.buf = all;
        this.drain(() => finish(null));
      };
      ws.onerror = () => finish(new Error('socket error'));
      ws.onclose = () => { const was = this.ok; this.ok = false; clearInterval(this.ping); finish(new Error('closed')); if (was && this.onDown) this.onDown(); };
    });
  }
  drain(onConnack) {
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      let len = 0, mul = 1, i = 1;
      for (;;) { if (i >= b.length) return; const c = b[i++]; len += (c & 127) * mul; mul *= 128; if (!(c & 128)) break; }
      if (b.length < i + len) return;
      const type = b[0] >> 4, body = b.subarray(i, i + len);
      this.buf = b.slice(i + len);
      if (type === 2) { if (body[1] === 0) { this.ok = true; this.ping = setInterval(() => { try { this.ws.send(new Uint8Array([0xc0, 0])); } catch { /* closed */ } }, 25000); onConnack(); } }
      else if (type === 3) {
        const tl = (body[0] << 8) | body[1], topic = dec.decode(body.subarray(2, 2 + tl));
        let off = 2 + tl;
        if ((b[0] >> 1) & 3) off += 2;
        const payload = dec.decode(body.subarray(off));
        for (const [filter, cb] of this.subs) if (filter === topic || (filter.endsWith('/#') && topic.startsWith(filter.slice(0, -1)))) cb(topic, payload);
      }
    }
  }
  subscribe(topic, cb) {
    this.subs.set(topic, cb);
    const id = this.pid++ & 0xffff || 1;
    this.ws.send(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }
  publish(topic, payload) {
    if (!this.ok) return;
    const t = str(topic), p = enc.encode(payload), body = new Uint8Array(t.length + p.length);
    body.set(t, 0); body.set(p, t.length);
    try { this.ws.send(packet(0x30, body)); } catch { /* closed */ }
  }
  close() { this.ok = false; clearInterval(this.ping); try { this.ws.send(new Uint8Array([0xe0, 0])); this.ws.close(); } catch { /* ignore */ } }
}

// Several brokers used as one: publish everywhere, deliver each message once.
export class Mesh {
  constructor(urls) { this.urls = urls; this.clients = []; this.seen = new Set(); this.seenOrder = []; this.handlers = new Map(); this.closed = false; this.retry = new Map(); this.retryTimers = new Map(); }
  // Connects to one broker; on failure or a later drop it keeps retrying in the background
  // (2 s, 4 s, ... up to 30 s apart) for as long as the mesh is open.
  connectOne(u) {
    return new Mqtt(u).connect().then(c => {
      if (this.closed) { c.close(); return null; }
      this.retry.delete(u); this.add(c, u); return c;
    }, () => { this.again(u); return null; });
  }
  again(u) {
    if (this.closed || this.retryTimers.has(u)) return;
    const wait = Math.min(30000, (this.retry.get(u) || 1000) * 2);
    this.retry.set(u, wait);
    this.retryTimers.set(u, setTimeout(() => { this.retryTimers.delete(u); if (!this.closed && !this.clients.some(c => c.src === u)) this.connectOne(u); }, wait));
  }
  async start(timeoutMs = 65000) {
    if (!this.urls.length) throw new Error('No relay servers configured.');
    if (this.closed) throw new Error('Relay connection closed.');
    if (this.up) return this;
    // A free Render instance can take about a minute to wake. Keep awaiting the
    // reconnect attempts instead of rejecting after the first six-second try
    // and leaving an orphan mesh that never registers the host's room handlers.
    let timer;
    try {
      await new Promise((resolve, reject) => {
        this.firstConnection = resolve; this.rejectStart = reject;
        timer = setTimeout(() => reject(new Error('No relay server could be reached. It may still be waking up; please try again.')), timeoutMs);
        for (const u of this.urls) this.connectOne(u);
      });
      return this;
    } catch (error) { this.close(); throw error; }
    finally { clearTimeout(timer); this.firstConnection = this.rejectStart = null; }
  }
  add(c, u) {
    c.src = u;
    this.clients.push(c);
    for (const [topic] of this.handlers) c.subscribe(topic, (tp, p) => this.deliver(tp, p));
    c.onDown = () => { this.clients = this.clients.filter(x => x !== c); this.again(u); };
    this.firstConnection?.();
  }
  get up() { return this.clients.length > 0; }
  deliver(topic, payload) {
    let m;
    try { m = JSON.parse(payload); } catch { return; }
    if (!m || !m.u) return;
    if (this.seen.has(m.u)) return;
    this.seen.add(m.u); this.seenOrder.push(m.u);
    if (this.seenOrder.length > 4000) this.seen.delete(this.seenOrder.shift());
    const h = this.handlers.get(topic);
    if (h) h(m);
  }
  on(topic, fn) { this.handlers.set(topic, fn); for (const c of this.clients) c.subscribe(topic, (tp, p) => this.deliver(tp, p)); }
  send(topic, m) { m.u = rid(); const s = JSON.stringify(m); for (const c of this.clients) c.publish(topic, s); }
  close() {
    this.closed = true; this.rejectStart?.(new Error('Relay connection closed.'));
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const c of this.clients) c.close(); this.clients = [];
  }
}

// A channel with PeerJS's DataConnection shape.
class Channel {
  constructor() { this.handlers = { data: [], close: [], error: [], open: [] }; this.open = false; }
  on(ev, fn) { (this.handlers[ev] || (this.handlers[ev] = [])).push(fn); }
  emit(ev, ...a) { for (const fn of this.handlers[ev] || []) fn(...a); }
}
// Data straight over WebRTC.
class RtcChannel extends Channel {
  constructor(dc, pc) {
    super(); this.dc = dc; this.pc = pc;
    dc.onopen = () => { this.open = true; this.emit('open'); };
    dc.onmessage = e => this.emit('data', e.data);
    dc.onclose = () => this.shut();
    dc.onerror = () => this.shut();
    if (dc.readyState === 'open') this.open = true;
  }
  send(s) { if (this.dc.readyState === 'open') this.dc.send(s); }
  shut() { if (!this.open && this.dead) return; this.dead = true; this.open = false; this.emit('close'); }
  close() { try { this.dc.close(); this.pc.close(); } catch { /* ignore */ } this.shut(); }
}
// Data relayed through the brokers, reliably and in order. Public brokers deliver at most once,
// so every message carries a sequence number and the receiver acknowledges what it has: everything
// below n, plus the ranges it already holds beyond a gap (selective acks), so only real gaps are
// sent again, soon and then with growing delays. Duplicates (a second
// broker, a resend) are dropped. A channel that gets no acknowledgement for 30 s is dead.
export class RelayChannel extends Channel {
  constructor(mesh, outTopic, extra = {}) {
    super(); this.mesh = mesh; this.out = outTopic; this.extra = extra;
    this.seq = 0; this.next = 0; this.pending = new Map(); this.open = true;
    this.unacked = new Map(); this.lastAck = performance.now(); this.ackDue = false;
    this.timer = setInterval(() => this.tick(), 100);
  }
  post(m) { this.mesh.send(this.out, { ...m, ...this.extra }); }
  send(s) {
    if (!this.open) return;
    const n = this.seq++;
    this.unacked.set(n, { d: s, t: performance.now(), rto: 600 });
    this.post({ k: 'd', n, d: s });
  }
  receive(m) {
    if (m.k === 'bye') { this.shut(); return; }
    if (m.k === 'a') {
      for (const n of [...this.unacked.keys()]) if (n < m.n) this.unacked.delete(n);
      if (Array.isArray(m.s)) for (const r of m.s) if (Array.isArray(r)) for (let n = r[0] | 0; n <= (r[1] | 0) && n - r[0] < 4096; n++) this.unacked.delete(n);
      // The first gap the receiver reports goes out again right away.
      const gap = this.unacked.get(m.n);
      if (gap && Array.isArray(m.s) && m.s.length && performance.now() - gap.t > 250) { gap.t = performance.now(); this.post({ k: 'd', n: m.n, d: gap.d }); }
      this.lastAck = performance.now();
      return;
    }
    if (m.k !== 'd' || typeof m.n !== 'number') return;
    this.ackDue = true;
    if (m.n < this.next || this.pending.has(m.n)) return; // duplicate
    this.pending.set(m.n, m.d);
    while (this.pending.has(this.next)) { const d = this.pending.get(this.next); this.pending.delete(this.next); this.next++; this.emit('data', d); }
  }
  tick() {
    if (!this.open) return;
    const now = performance.now();
    if (this.ackDue) {
      this.ackDue = false;
      // Ranges held beyond the gap (at most 48 of them).
      const s = [];
      if (this.pending.size) {
        const keys = [...this.pending.keys()].sort((a, b) => a - b);
        let a = keys[0], b = a;
        for (let i = 1; i <= keys.length && s.length < 48; i++) { const k = keys[i]; if (k === b + 1) b = k; else { s.push([a, b]); a = b = k; } }
      }
      this.post(s.length ? { k: 'a', n: this.next, s } : { k: 'a', n: this.next });
    }
    if (this.unacked.size && now - this.lastAck > 30000) { this.shut(); return; }
    let sent = 0;
    for (const [n, u] of this.unacked) {
      if (now - u.t < u.rto) continue;
      u.t = now; u.rto = Math.min(2000, u.rto * 1.5);
      this.post({ k: 'd', n, d: u.d });
      if (++sent >= 128) break;
    }
    if (!this.unacked.size) this.lastAck = now;
  }
  shut() { if (!this.open) return; this.open = false; clearInterval(this.timer); this.emit('close'); }
  close() { if (this.open) this.post({ k: 'bye' }); this.shut(); }
}

const rtcConfig = iceServers => ({ iceServers: iceServers || [] });
const cfgForce = cfg => !!(cfg && cfg.forceRelay); // testing: skip the direct attempt

// Host side: answer knocks on the room and hand each new guest's channel to onConnection.
export async function hostRoom(code, { brokers, iceServers }, onConnection) {
  const mesh = await new Mesh(brokers).start();
  const base = `${ROOT}/${code}`;
  const guests = new Map(); // guest id -> { pc, relay }
  mesh.on(`${base}/h`, async m => {
    const g = m.from && String(m.from).slice(0, 24);
    if (!g) return;
    const to = `${base}/g/${g}`;
    let st = guests.get(g);
    if (m.k === 'knock') { mesh.send(to, { k: 'here' }); return; }
    if (m.k === 'offer' && !st) {
      st = { pc: new RTCPeerConnection(rtcConfig(iceServers)), relay: null, used: false };
      guests.set(g, st);
      st.pc.onicecandidate = e => { if (e.candidate) mesh.send(to, { k: 'ice', c: e.candidate.toJSON() }); };
      st.pc.ondatachannel = e => {
        const ch = new RtcChannel(e.channel, st.pc);
        const go = () => { if (st.used) { ch.close(); return; } st.used = true; onConnection(ch); };
        if (ch.open) go(); else ch.on('open', go);
      };
      try {
        await st.pc.setRemoteDescription(m.sdp);
        const ans = await st.pc.createAnswer();
        await st.pc.setLocalDescription(ans);
        mesh.send(to, { k: 'answer', sdp: st.pc.localDescription.toJSON() });
      } catch (e) { console.warn('rtc answer failed', e); }
      return;
    }
    if (m.k === 'ice' && st && st.pc) { try { await st.pc.addIceCandidate(m.c); } catch { /* stale */ } return; }
    if (m.k === 'relay') {
      if (!st) { st = { pc: null, relay: null, used: false }; guests.set(g, st); }
      // A repeated request means our answer was lost: answer again.
      if (st.relay) { mesh.send(to, { k: 'relay-ok' }); return; }
      if (st.used) return;
      st.used = true;
      try { st.pc && st.pc.close(); } catch { /* ignore */ }
      const ch = new RelayChannel(mesh, to);
      st.relay = ch;
      mesh.send(to, { k: 'relay-ok' });
      onConnection(ch);
      ch.on('close', () => guests.delete(g));
      return;
    }
    if (st && st.relay) st.relay.receive(m);
  });
  return { mesh, close: () => { for (const st of guests.values()) { try { st.relay && st.relay.close(); st.pc && st.pc.close(); } catch { /* ignore */ } } mesh.close(); } };
}

// Guest side: find the room, try a direct channel, fall back to relaying.
export async function joinRoom(code, { brokers, iceServers }, status = () => {}, directWaitMs = 9000) {
  const mesh = await new Mesh(brokers).start();
  const base = `${ROOT}/${code}`, me = rid(), hostTopic = `${base}/h`;
  let resolveHere, onAnswer = null, onIce = null, onRelayOk = null, relay = null;
  const here = new Promise(r => { resolveHere = r; });
  mesh.on(`${base}/g/${me}`, m => {
    if (m.k === 'here') resolveHere(true);
    else if (m.k === 'answer' && onAnswer) onAnswer(m.sdp);
    else if (m.k === 'ice' && onIce) onIce(m.c);
    else if (m.k === 'relay-ok' && onRelayOk) onRelayOk();
    else if (relay) relay.receive(m);
  });
  // Knock a few times (a knock can be lost while subscriptions settle).
  let knocks = 0;
  const knocker = setInterval(() => { if (knocks++ < 14) mesh.send(hostTopic, { k: 'knock', from: me }); }, 600);
  mesh.send(hostTopic, { k: 'knock', from: me });
  const found = await Promise.race([here, new Promise(r => setTimeout(() => r(false), 9000))]);
  clearInterval(knocker);
  if (!found) { mesh.close(); const e = new Error('No open world was found with that code. Check the code, and that your friend has pressed "Open to Friends".'); e.notFound = true; throw e; }
  status('Found the world; connecting…');
  // Direct attempt.
  let direct = null;
  if (window.RTCPeerConnection && !cfgForce(arguments[1])) {
    try {
      const pc = new RTCPeerConnection(rtcConfig(iceServers));
      const dc = pc.createDataChannel('bh', { ordered: true });
      const ch = new RtcChannel(dc, pc);
      pc.onicecandidate = e => { if (e.candidate) mesh.send(hostTopic, { k: 'ice', from: me, c: e.candidate.toJSON() }); };
      onAnswer = async sdp => { try { await pc.setRemoteDescription(sdp); } catch (e) { console.warn(e); } };
      onIce = async c => { try { await pc.addIceCandidate(c); } catch { /* stale */ } };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      mesh.send(hostTopic, { k: 'offer', from: me, sdp: pc.localDescription.toJSON() });
      direct = await new Promise(resolve => {
        const t = setTimeout(() => resolve(null), directWaitMs);
        ch.on('open', () => { clearTimeout(t); resolve(ch); });
        pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { clearTimeout(t); resolve(null); } };
      });
      if (!direct) { try { pc.close(); } catch { /* ignore */ } }
    } catch (e) { console.warn('direct connection failed', e); }
  }
  if (direct) {
    // Signalling is done; keep the brokers only for a clean shutdown.
    setTimeout(() => mesh.close(), 3000);
    return { channel: direct, relayed: false };
  }
  status('No direct route between your networks; relaying the game instead…');
  relay = new RelayChannel(mesh, hostTopic, { from: me });
  const baseClose = relay.close.bind(relay);
  relay.close = () => { baseClose(); setTimeout(() => mesh.close(), 500); };
  relay.on('close', () => setTimeout(() => mesh.close(), 500));
  const ok = await new Promise(resolve => {
    onRelayOk = () => resolve(true);
    let n = 0;
    // Asked again every 0.7 s for up to 30 s: a busy or slow host (a Chromebook mid-frame, a
    // background tab) can take a while to answer.
    const until = performance.now() + 30000;
    const iv = setInterval(() => { n++; if (performance.now() > until) { clearInterval(iv); resolve(false); } else mesh.send(hostTopic, { k: 'relay', from: me }); }, 700);
    mesh.send(hostTopic, { k: 'relay', from: me });
    onRelayOk = () => { clearInterval(iv); resolve(true); };
  });
  if (!ok) { mesh.close(); throw new Error('The host could not be reached. Ask them to check their connection and try again.'); }
  return { channel: relay, relayed: true };
}

// ---------------- connection test ----------------
// A sleeping private relay needs the same startup budget as hosting/joining.
// Keep trying WebSocket/MQTT even if the HTTP wake request is blocked by CORS.
async function probeRelay(url, wake) {
  const until = Date.now() + (wake ? 65000 : 8000);
  const controller = new AbortController();
  if (wake) fetch(wake, { mode: 'no-cors', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal }).catch(() => {});
  try {
    for (;;) {
      try {
        const client = await new Mqtt(url).connect(Math.min(8000, Math.max(1, until - Date.now())));
        client.close();
        return;
      } catch (error) {
        const left = until - Date.now();
        if (!wake || left <= 0) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(2000, left)));
        if (Date.now() >= until) throw error;
      }
    }
  } finally { controller.abort(); }
}

// Checks every way of connecting from this network; each result is { name, ok, detail }.
export async function diagnose(cfg, onResult = () => {}) {
  const results = [];
  const add = r => { results.push(r); onResult(r); };
  const jobs = [];
  for (const u of cfg.brokers || []) {
    const name = u.replace(/^wss?:\/\/([^@/]*@)?/, '').replace(/\/.*$/, '');
    const wake = (cfg.wake || []).find(w => { try { return new URL(w).host === new URL(u).host; } catch { return false; } });
    jobs.push(probeRelay(u, wake).then(() => add({ name: `Relay server ${name}`, ok: true, detail: 'reachable' }), () => add({ name: `Relay server ${name}`, ok: false, detail: wake ? 'no connection after 65 seconds; check the relay deployment or try again' : 'blocked or down' })));
  }
  if (cfg.peer && cfg.peer.host) {
    const url = `${cfg.peer.secure === false ? 'http' : 'https'}://${cfg.peer.host}${cfg.peer.port && cfg.peer.port !== 443 ? ':' + cfg.peer.port : ''}${cfg.peer.path || '/'}peerjs/id`;
    jobs.push(fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(r => add({ name: `Room server ${cfg.peer.host}`, ok: r.ok, detail: r.ok ? 'reachable' : `error ${r.status}` }), () => add({ name: `Room server ${cfg.peer.host}`, ok: false, detail: 'blocked or down' })));
  }
  if (window.RTCPeerConnection) {
    jobs.push((async () => {
      const pc = new RTCPeerConnection({ iceServers: cfg.iceServers || [] });
      const kinds = new Set();
      pc.onicecandidate = e => { if (e.candidate && e.candidate.type) kinds.add(e.candidate.type); };
      pc.createDataChannel('t');
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(r => { const t = setTimeout(r, 6000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); r(); } }; });
      pc.close();
      add({ name: 'Direct connections (STUN)', ok: kinds.has('srflx'), detail: kinds.has('srflx') ? 'this network allows them' : 'blocked here: games will go through a relay server' });
      if ((cfg.iceServers || []).some(s => /^turns?:/.test([].concat(s.urls)[0] || ''))) add({ name: 'TURN relay', ok: kinds.has('relay'), detail: kinds.has('relay') ? 'working' : 'not reachable' });
    })().catch(() => add({ name: 'Direct connections (STUN)', ok: false, detail: 'WebRTC unavailable' })));
  } else add({ name: 'Direct connections', ok: false, detail: 'this browser has no WebRTC' });
  await Promise.all(jobs);
  return results;
}

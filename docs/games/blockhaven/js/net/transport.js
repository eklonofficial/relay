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

const ROOT = 'blockhaven/v1';
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const enc = new TextEncoder(), dec = new TextDecoder();

// ---------------- a minimal MQTT 3.1.1 client over WebSocket (QoS 0) ----------------
function varint(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
function str(s) { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
function packet(type, body) { const u = new Uint8Array(1 + varint(body.length).length + body.length); const h = [type, ...varint(body.length)]; u.set(h, 0); u.set(body, h.length); return u; }

class Mqtt {
  constructor(url) { this.url = url; this.ws = null; this.ok = false; this.subs = new Map(); this.pid = 1; this.buf = new Uint8Array(0); this.onDown = null; }
  connect(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err) => { if (done) return; done = true; clearTimeout(t); if (err) { try { this.ws && this.ws.close(); } catch { /* ignore */ } reject(err); } else resolve(this); };
      const t = setTimeout(() => finish(new Error('timeout')), timeoutMs);
      let ws;
      try { ws = new WebSocket(this.url, 'mqtt'); } catch (e) { finish(e); return; }
      this.ws = ws; ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const body = [...str('MQTT'), 4, 2, 0, 60, ...str('bh' + rid())];
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
  constructor(urls) { this.urls = urls; this.clients = []; this.seen = new Set(); this.seenOrder = []; this.handlers = new Map(); }
  async start() {
    const tries = this.urls.map(u => new Mqtt(u).connect().then(c => { this.add(c); return c; }, () => null));
    // Resolve as soon as one broker is up; the rest join as they connect.
    await new Promise((resolve, reject) => {
      let left = tries.length;
      for (const t of tries) t.then(c => { if (c) resolve(); else if (--left === 0) reject(new Error('No relay server could be reached.')); });
      if (!tries.length) reject(new Error('No relay servers configured.'));
    });
    return this;
  }
  add(c) {
    this.clients.push(c);
    for (const [topic] of this.handlers) c.subscribe(topic, (tp, p) => this.deliver(tp, p));
    c.onDown = () => { this.clients = this.clients.filter(x => x !== c); };
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
  close() { for (const c of this.clients) c.close(); this.clients = []; }
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
// Data relayed through the brokers, in order (sequence numbers; brokers keep per-client order,
// the numbers let us drop duplicates arriving from a second broker).
class RelayChannel extends Channel {
  constructor(mesh, outTopic) {
    super(); this.mesh = mesh; this.out = outTopic; this.seq = 0; this.next = 0; this.pending = new Map(); this.open = true;
  }
  send(s) { if (this.open) this.mesh.send(this.out, { k: 'd', n: this.seq++, d: s }); }
  receive(m) {
    if (m.k === 'bye') { this.shut(); return; }
    if (m.k !== 'd' || m.n < this.next) return;
    this.pending.set(m.n, m.d);
    this.flush();
    // Something got lost for good: skip ahead rather than stall.
    if (this.pending.size > 200) { this.next = Math.min(...this.pending.keys()); this.flush(); }
  }
  flush() { while (this.pending.has(this.next)) { const d = this.pending.get(this.next); this.pending.delete(this.next); this.next++; this.emit('data', d); } }
  shut() { if (!this.open) return; this.open = false; this.emit('close'); }
  close() { if (this.open) this.mesh.send(this.out, { k: 'bye' }); this.shut(); }
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
  const knocker = setInterval(() => { if (knocks++ < 8) mesh.send(hostTopic, { k: 'knock', from: me }); }, 700);
  mesh.send(hostTopic, { k: 'knock', from: me });
  const found = await Promise.race([here, new Promise(r => setTimeout(() => r(false), 7000))]);
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
  relay = new RelayChannel(mesh, hostTopic);
  relay.send = s => { if (relay.open) mesh.send(hostTopic, { k: 'd', from: me, n: relay.seq++, d: s }); };
  const baseClose = relay.close.bind(relay);
  relay.close = () => { if (relay.open) mesh.send(hostTopic, { k: 'bye', from: me }); baseClose(); setTimeout(() => mesh.close(), 500); };
  const ok = await new Promise(resolve => {
    onRelayOk = () => resolve(true);
    let n = 0;
    const iv = setInterval(() => { if (n++ > 6) { clearInterval(iv); resolve(false); } else mesh.send(hostTopic, { k: 'relay', from: me }); }, 800);
    mesh.send(hostTopic, { k: 'relay', from: me });
    onRelayOk = () => { clearInterval(iv); resolve(true); };
  });
  if (!ok) { mesh.close(); throw new Error('The host could not be reached. Ask them to check their connection and try again.'); }
  return { channel: relay, relayed: true };
}

// Blockhaven multiplayer relay: a minimal MQTT 3.1.1 broker over WebSocket (QoS 0, exact topics).
//
// The game already speaks MQTT to public brokers to find rooms and, when two browsers cannot
// connect directly, to carry the game data. This server is one more broker, but one you control
// and that runs on the standard HTTPS port (443) on Render, so it gets through networks that
// block the public brokers' unusual ports.
//
//   GET /health   -> 200 "ok" (also wakes a sleeping free instance)
//   WS  /mqtt     -> MQTT over WebSocket (subprotocol "mqtt")
//   POST /box/*   -> the same idea over plain HTTPS long polling, for networks that break WebSockets
//
// Limits: only "blockhaven/" topics, 64 KB packets, 400 packets/s per client, 2000 clients.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const MAX_PACKET = 64 * 1024, MAX_RATE = 400, MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 2000, PREFIXES = ['blockhaven/', 'shockshellers/'];
// One relay for every calculator game; each game keeps to its own topic root.
const allowed = topic => PREFIXES.some(p => topic.startsWith(p));
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

// ---- The mailbox: the same publish/subscribe over plain HTTPS requests (long polling) ----
// For networks whose filters break WebSockets but still pass ordinary HTTPS (school proxies that
// decrypt and inspect traffic, for example). POST /box/send {pub: [[topic, message], ...]} publishes;
// POST /box/recv {sub: [topics], since} answers with everything published to those topics after
// `since` (holding the request up to 20 s until something arrives). Bodies are sent as text/plain,
// so browsers need no CORS preflight. Only Shock Shellers' mailbox topics; messages live 30 s.
const BOX_PREFIX = 'shockshellers/box/', BOX_TTL = 30000, BOX_KEEP = 512, BOX_WAIT = 20000;
const box = new Map(); // topic -> [{ i, m, t }]
const waiting = new Set(); // { topics: Set, since, res, timer }
let boxSeq = 0;
const httpRate = new Map(); // ip -> { n, start }
function boxPublish(topic, m) {
  let log = box.get(topic); if (!log) box.set(topic, log = []);
  log.push({ i: ++boxSeq, m, t: Date.now() }); if (log.length > BOX_KEEP) log.shift();
  for (const w of [...waiting]) if (w.topics.has(topic)) boxAnswer(w);
}
function boxCollect(topics, since) {
  const out = [];
  for (const t of topics) for (const e of box.get(t) || []) if (e.i > since) out.push([t, e.m, e.i]);
  return out.sort((a, b) => a[2] - b[2]).map(([t, m]) => [t, m]);
}
function boxAnswer(w) {
  if (!waiting.delete(w)) return;
  clearTimeout(w.timer);
  json(w.res, 200, { at: boxSeq, msgs: boxCollect(w.topics, w.since) });
}
function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}
setInterval(() => { const old = Date.now() - BOX_TTL; for (const [t, log] of box) { while (log.length && log[0].t < old) log.shift(); if (!log.length) box.delete(t); } httpRate.clear(); }, 10000).unref();

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end('ok');
    return;
  }
  if (req.method === 'OPTIONS' && req.url.startsWith('/box/')) {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' });
    res.end(); return;
  }
  if (req.method === 'POST' && (req.url === '/box/send' || req.url === '/box/recv')) {
    if (ORIGINS.length && !ORIGINS.includes(req.headers.origin || '')) { json(res, 403, { error: 'origin' }); return; }
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0];
    const r = httpRate.get(ip) || { n: 0 }; r.n++; httpRate.set(ip, r);
    if (r.n > 1500) { json(res, 429, { error: 'slow down' }); return; } // per 10 s
    let body = '', size = 0;
    req.on('data', d => { size += d.length; if (size > MAX_PACKET * 2) { req.destroy(); return; } body += d; });
    req.on('end', () => {
      let q; try { q = JSON.parse(body); } catch { json(res, 400, { error: 'bad json' }); return; }
      if (req.url === '/box/send') {
        for (const p of Array.isArray(q.pub) ? q.pub.slice(0, 256) : []) {
          if (Array.isArray(p) && typeof p[0] === 'string' && p[0].startsWith(BOX_PREFIX) && p[0].length < 200 && typeof p[1] === 'string' && p[1].length <= MAX_PACKET) boxPublish(p[0], p[1]);
        }
        json(res, 200, { at: boxSeq });
        return;
      }
      const topics = new Set((Array.isArray(q.sub) ? q.sub.slice(0, 64) : []).filter(t => typeof t === 'string' && t.startsWith(BOX_PREFIX) && t.length < 200));
      // A first request (no `since`) starts from now; a client that fell further behind than the
      // log reaches just gets what is left.
      const since = Number.isFinite(q.since) ? Math.max(0, q.since) : boxSeq;
      const w = { topics, since, res, timer: null };
      if (boxCollect(topics, since).length || !topics.size) { waiting.add(w); boxAnswer(w); return; }
      w.timer = setTimeout(() => boxAnswer(w), BOX_WAIT);
      waiting.add(w);
      res.on('close', () => { waiting.delete(w); clearTimeout(w.timer); });
    });
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({
  server, path: '/mqtt', maxPayload: MAX_PACKET,
  handleProtocols: p => (p.has('mqtt') ? 'mqtt' : false),
  verifyClient: (info, cb) => {
    if (wss.clients.size >= MAX_CLIENTS) return cb(false, 503);
    if (ORIGINS.length && !ORIGINS.includes(info.origin || '')) return cb(false, 403);
    cb(true);
  },
});

const topics = new Map(); // topic -> Set(ws)
const vi = n => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n); return o; };

wss.on('connection', ws => {
  let buf = Buffer.alloc(0), connected = false, count = 0, windowStart = Date.now();
  const mine = new Set();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data, isBinary) => {
    if (!isBinary) { ws.terminate(); return; }
    buf = Buffer.concat([buf, data]);
    if (buf.length > MAX_PACKET * 2) { ws.terminate(); return; }
    for (;;) {
      if (buf.length < 2) return;
      let len = 0, mul = 1, i = 1;
      for (;;) { if (i >= buf.length) return; const c = buf[i++]; len += (c & 127) * mul; mul *= 128; if (!(c & 128)) break; if (i > 4) { ws.terminate(); return; } }
      if (len > MAX_PACKET) { ws.terminate(); return; }
      if (buf.length < i + len) return;
      const header = buf[0], type = header >> 4, body = buf.subarray(i, i + len), whole = Buffer.from(buf.subarray(0, i + len));
      buf = buf.subarray(i + len);
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > MAX_RATE) continue; // over the rate: drop (the game resends what matters)
      if (type === 1) {
        if (connected || header !== 0x10 || body.length < 12 || !body.subarray(0, 7).equals(Buffer.from([0, 4, 77, 81, 84, 84, 4])) || (body[7] & 1) || body.length < 12 + body.readUInt16BE(10)) { ws.terminate(); return; }
        connected = true; ws.send(Buffer.from([0x20, 2, 0, 0])); continue;
      }
      if (!connected) { ws.terminate(); return; }
      if (type === 8) { // SUBSCRIBE: id, then (topic, qos)*
        if (header !== 0x82 || body.length < 6 || !body.readUInt16BE(0)) { ws.terminate(); return; }
        const id = body.subarray(0, 2), granted = [];
        let p = 2;
        while (p < body.length) {
          if (p + 2 > body.length) { ws.terminate(); return; }
          const tl = body.readUInt16BE(p), end = p + 2 + tl;
          if (!tl || end >= body.length || body[end] > 2) { ws.terminate(); return; }
          const topic = body.subarray(p + 2, end).toString(); p = end + 1;
          if (!allowed(topic) || /[#+]/.test(topic) || (!mine.has(topic) && mine.size >= 64)) { granted.push(0x80); continue; }
          if (!topics.has(topic)) topics.set(topic, new Set());
          topics.get(topic).add(ws); mine.add(topic); granted.push(0);
        }
        ws.send(Buffer.from([0x90, ...vi(2 + granted.length), id[0], id[1], ...granted]));
      } else if (type === 3) { // PUBLISH (QoS 0)
        if (body.length < 2 || (header & 6)) { ws.terminate(); return; }
        const tl = body.readUInt16BE(0);
        if (!tl || 2 + tl > body.length) { ws.terminate(); return; }
        const topic = body.subarray(2, 2 + tl).toString();
        if (!allowed(topic) || /[#+]/.test(topic)) continue;
        const subs = topics.get(topic);
        if (subs) for (const s of subs) if (s !== ws && s.readyState === 1) s.send(whole);
      } else if (header === 0xc0 && !body.length) ws.send(Buffer.from([0xd0, 0])); // PINGREQ
      else if (header === 0xe0 && !body.length) { ws.close(); return; } // DISCONNECT
      else { ws.terminate(); return; }
    }
  });
  ws.on('close', () => { for (const t of mine) { const s = topics.get(t); if (s) { s.delete(ws); if (!s.size) topics.delete(t); } } });
  ws.on('error', () => {});
});
// Drop dead sockets.
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch { /* closed */ } } }, 30000);

server.listen(PORT, () => console.log(`blockhaven relay listening on ${PORT}`));

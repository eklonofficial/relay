// Blockhaven multiplayer relay: a minimal MQTT 3.1.1 broker over WebSocket (QoS 0, exact topics).
//
// The game already speaks MQTT to public brokers to find rooms and, when two browsers cannot
// connect directly, to carry the game data. This server is one more broker, but one you control
// and that runs on the standard HTTPS port (443) on Render, so it gets through networks that
// block the public brokers' unusual ports.
//
//   GET /health   -> 200 "ok" (also wakes a sleeping free instance)
//   WS  /mqtt     -> MQTT over WebSocket (subprotocol "mqtt")
//
// Limits: only "blockhaven/" topics, 64 KB packets, 400 packets/s per client, 2000 clients.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const MAX_PACKET = 64 * 1024, MAX_RATE = 400, MAX_CLIENTS = Number(process.env.MAX_CLIENTS) || 2000, PREFIX = 'blockhaven/';
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end('ok');
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
          if (!topic.startsWith(PREFIX) || /[#+]/.test(topic) || (!mine.has(topic) && mine.size >= 64)) { granted.push(0x80); continue; }
          if (!topics.has(topic)) topics.set(topic, new Set());
          topics.get(topic).add(ws); mine.add(topic); granted.push(0);
        }
        ws.send(Buffer.from([0x90, ...vi(2 + granted.length), id[0], id[1], ...granted]));
      } else if (type === 3) { // PUBLISH (QoS 0)
        if (body.length < 2 || (header & 6)) { ws.terminate(); return; }
        const tl = body.readUInt16BE(0);
        if (!tl || 2 + tl > body.length) { ws.terminate(); return; }
        const topic = body.subarray(2, 2 + tl).toString();
        if (!topic.startsWith(PREFIX) || /[#+]/.test(topic)) continue;
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

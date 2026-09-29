'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 16;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);

const TICK_MS = 50;
const MAX_HP = 100;
const HIT_DAMAGE = 10;
const MIN_HIT_INTERVAL_MS = 80; // the AK fires every 100 ms
const MIN_SHOT_INTERVAL_MS = 60;
const MAX_HIT_DISTANCE = 150;
const RESPAWN_MS = 3000;
const MAX_MSGS_PER_SEC = 60;
const WORLD_LIMIT = 1000;

const players = new Map();
let nextId = 1;

function sanitizeName(raw) {
  const name = String(raw || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 16);
  return name || `Player${Math.floor(Math.random() * 9000 + 1000)}`;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < WORLD_LIMIT;
}

function publicInfo(p) {
  return { id: p.id, name: p.name, kills: p.kills, deaths: p.deaths };
}

function send(p, msg) {
  if (p.ws.readyState === p.ws.OPEN) p.ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.joined && p.id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

function originAllowed(origin) {
  return ALLOWED_ORIGINS.includes('*') || (!!origin && ALLOWED_ORIGINS.includes(origin));
}

function handle(p, msg) {
  const now = Date.now();

  if (msg.t === 'hello' && !p.joined) {
    p.name = sanitizeName(msg.name);
    p.joined = true;
    p.alive = true;
    send(p, {
      t: 'welcome', id: p.id, maxHp: MAX_HP,
      players: [...players.values()].filter(o => o.joined && o.id !== p.id).map(publicInfo),
    });
    broadcast({ t: 'join', player: publicInfo(p) }, p.id);
    return;
  }

  if (!p.joined) return;

  if (msg.t === 'state') {
    if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(isNum) || !isNum(msg.y)) return;
    p.pos = msg.p;
    p.yaw = msg.y;
    p.anim = msg.a === 1 ? 1 : 0;
    p.hasState = true;
    return;
  }

  if (msg.t === 'shot') {
    if (!p.alive || now - p.lastShot < MIN_SHOT_INTERVAL_MS) return;
    p.lastShot = now;
    broadcast({ t: 'shot', id: p.id }, p.id);
    return;
  }

  if (msg.t === 'hit') {
    const target = players.get(msg.target);
    if (!target || target === p || !target.joined || !target.alive || !p.alive) return;
    if (now - p.lastHit < MIN_HIT_INTERVAL_MS) return;
    const dx = target.pos[0] - p.pos[0], dy = target.pos[1] - p.pos[1], dz = target.pos[2] - p.pos[2];
    if (dx * dx + dy * dy + dz * dz > MAX_HIT_DISTANCE * MAX_HIT_DISTANCE) return;
    p.lastHit = now;

    target.hp = Math.max(0, target.hp - HIT_DAMAGE);
    send(target, { t: 'hp', hp: target.hp, from: p.id });

    if (target.hp === 0) {
      target.alive = false;
      target.deaths++;
      p.kills++;
      broadcast({ t: 'kill', killer: p.id, victim: target.id });
      setTimeout(() => {
        if (!players.has(target.id)) return;
        target.hp = MAX_HP;
        target.alive = true;
        send(target, { t: 'respawn', hp: MAX_HP });
      }, RESPAWN_MS);
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ok: true, players: [...players.values()].filter(p => p.joined).length, max: MAX_PLAYERS }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server,
  maxPayload: 1024,
  verifyClient: info => originAllowed(info.origin),
});

wss.on('connection', ws => {
  if (players.size >= MAX_PLAYERS) {
    ws.send(JSON.stringify({ t: 'full', max: MAX_PLAYERS }));
    ws.close(4000, 'full');
    return;
  }

  const p = {
    id: nextId++, ws, name: '', joined: false, alive: false, hasState: false,
    pos: [0, 0, 0], yaw: 0, anim: 0, hp: MAX_HP, kills: 0, deaths: 0,
    lastHit: 0, lastShot: 0, msgWindowStart: Date.now(), msgCount: 0, isAlive: true,
  };
  players.set(p.id, p);

  ws.on('pong', () => { p.isAlive = true; });

  ws.on('message', data => {
    const now = Date.now();
    if (now - p.msgWindowStart >= 1000) { p.msgWindowStart = now; p.msgCount = 0; }
    if (++p.msgCount > MAX_MSGS_PER_SEC) {
      if (p.msgCount > MAX_MSGS_PER_SEC * 2) ws.close(1008, 'rate limit');
      return;
    }
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg && typeof msg === 'object') handle(p, msg);
  });

  ws.on('close', () => {
    players.delete(p.id);
    if (p.joined) broadcast({ t: 'leave', id: p.id });
  });

  ws.on('error', () => {});
});

setInterval(() => {
  // Players appear in snapshots once they've reported a position, so nobody pops up at the origin.
  const joined = [...players.values()].filter(p => p.joined && p.hasState);
  if (!joined.length) return;
  const round = v => Math.round(v * 100) / 100;
  const snap = {
    t: 'snap',
    s: joined.map(p => [p.id, round(p.pos[0]), round(p.pos[1]), round(p.pos[2]), round(p.yaw), p.anim, p.alive ? 0 : 1, p.kills, p.deaths]),
  };
  broadcast(snap);
}, TICK_MS);

// Drop connections that stopped answering pings, and keep idle proxies from closing live ones.
setInterval(() => {
  for (const p of players.values()) {
    if (!p.isAlive) { p.ws.terminate(); continue; }
    p.isAlive = false;
    p.ws.ping();
  }
}, 20000);

server.listen(PORT, () => {
  console.log(`FPS server listening on :${PORT} (max ${MAX_PLAYERS} players, origins: ${ALLOWED_ORIGINS.join(', ')})`);
});

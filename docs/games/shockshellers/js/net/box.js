// A third way to reach a room, for locked-down networks (school Chromebooks behind GoGuardian,
// ContentKeeper and the like): the project relay's mailbox, over plain HTTPS requests. Those
// filters often break WebSockets (which the brokers in transport.js need) while ordinary HTTPS
// requests still pass, so here a "subscription" is a long-polling request (the relay holds it until
// something arrives) and publishing is an ordinary POST.
//
// The game data rides the same reliable channel as the brokers' relay path (transport.js's
// RelayChannel: sequence numbers, acks, resends), so the rest of the networking can't tell the
// difference. Every host listens here as well as on the other paths, and a joining guest races this
// against them; whichever connects first is used.
import { RelayChannel } from './transport.js?v=muzi7z97';

const ROOT = 'shockshellers/box/';
const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const opts = body => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain' }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });

// The mailbox base URL from the relay's WebSocket address (wss://host/mqtt → https://host).
export function boxBase(cfg) {
  if (cfg.box) return cfg.box;
  const u = (cfg.brokers || []).find(b => /onrender\.com/.test(b)) || (cfg.brokers || [])[0];
  try { const p = new URL(u); return `${p.protocol === 'ws:' ? 'http:' : 'https:'}//${p.host}`; } catch { return null; }
}

export class Box {
  constructor(base) {
    this.base = base; this.subs = new Map(); this.since = undefined; this.out = []; this.sending = false; this.closed = false;
    this.poll = null; this.fails = 0; this.ok = false;
  }
  subscribe(topic, fn) { this.subs.set(ROOT + topic, fn); this.restart(); }
  unsubscribe(topic) { this.subs.delete(ROOT + topic); }
  publish(topic, m) { this.out.push([ROOT + topic, typeof m === 'string' ? m : JSON.stringify(m)]); this.flush(); }
  // One send in flight at a time: whatever was published meanwhile goes out together next, so a
  // channel's 30 messages a second become a handful of requests.
  async flush() {
    if (this.sending || !this.out.length || this.closed) return;
    this.sending = true;
    const batch = this.out.splice(0, 256);
    try { const r = await fetch(this.base + '/box/send', opts({ pub: batch })); if (!r.ok) throw new Error(`relay ${r.status}`); }
    catch { if (!this.closed) { this.out.unshift(...batch); await new Promise(r => setTimeout(r, 400)); } }
    this.sending = false;
    if (this.out.length) this.flush();
  }
  // Ask for new messages; a new subscription restarts the waiting request so it is heard at once.
  restart() { if (this.poll) this.poll.abort(); else this.loop(); }
  async loop() {
    while (!this.closed) {
      const ctl = new AbortController(); this.poll = ctl;
      const t = setTimeout(() => ctl.abort(), 25000);
      try {
        const r = await fetch(this.base + '/box/recv', { ...opts({ sub: [...this.subs.keys()], since: this.since }), signal: ctl.signal });
        if (!r.ok) throw new Error(`relay ${r.status}`);
        const { at, msgs } = await r.json();
        this.since = at; this.fails = 0; this.ok = true;
        for (const [topic, m] of msgs || []) { const fn = this.subs.get(topic); if (fn) { let o; try { o = JSON.parse(m); } catch { continue; } fn(o); } }
      } catch (e) {
        if (this.closed) break;
        // An abort is a restart (new subscription), not a failure.
        if (!(e && e.name === 'AbortError')) { this.fails++; await new Promise(r => setTimeout(r, Math.min(4000, 300 * this.fails))); }
      } finally { clearTimeout(t); }
    }
    this.poll = null;
  }
  // Can the mailbox be reached from here at all? (A quick request; a sleeping relay can take a while.)
  async reach(ms = 60000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try { const r = await fetch(this.base + '/box/send', { ...opts({ pub: [] }), signal: ctl.signal }); return r.ok; } catch { return false; } finally { clearTimeout(t); }
  }
  close() { this.closed = true; if (this.poll) this.poll.abort(); }
}
// What RelayChannel needs from its carrier.
const mesh = box => ({ send: (topic, m) => box.publish(topic, m) });

// Host: answer knocks on the room's mailbox; each guest gets its own channel.
export async function hostBox(code, cfg, onConnection) {
  const base = boxBase(cfg); if (!base) throw new Error('no mailbox');
  const box = new Box(base);
  if (!(await box.reach())) { box.close(); throw new Error('The relay mailbox could not be reached.'); }
  const guests = new Map(); // guest id → { hid, ch }
  box.subscribe(`r/${code}`, m => {
    if (!m || m.k !== 'knock' || typeof m.g !== 'string' || !/^[a-z0-9]{8,20}$/.test(m.g)) return;
    let g = guests.get(m.g);
    if (!g) {
      const hid = rid(), ch = new RelayChannel(mesh(box), `c/${m.g}`);
      g = { hid, ch }; guests.set(m.g, g);
      box.subscribe(`c/${hid}`, x => ch.receive(x));
      ch.on('close', () => { box.unsubscribe(`c/${hid}`); guests.delete(m.g); });
      onConnection(ch);
    }
    box.publish(`c/${m.g}`, { k: 'hi', h: g.hid }); // (again, for a knock that crossed the first answer)
  });
  return { close: () => { for (const g of guests.values()) g.ch.close(); box.close(); } };
}

// Guest: knock until the host answers, then talk over a reliable channel.
export async function joinBox(code, cfg, waitMs = 25000) {
  const base = boxBase(cfg); if (!base) throw new Error('no mailbox');
  const box = new Box(base), gid = rid();
  return await new Promise((resolve, reject) => {
    let ch = null;
    const done = setTimeout(() => { clearInterval(knock); box.close(); reject(new Error('No game answered through the relay mailbox.')); }, waitMs);
    box.subscribe(`c/${gid}`, m => {
      if (!ch && m.k === 'hi' && typeof m.h === 'string') {
        clearTimeout(done); clearInterval(knock);
        ch = new RelayChannel(mesh(box), `c/${m.h}`);
        ch.on('close', () => box.close());
        resolve(ch);
        return;
      }
      if (ch) ch.receive(m);
    });
    const knock = setInterval(() => box.publish(`r/${code}`, { k: 'knock', g: gid }), 1500);
    box.publish(`r/${code}`, { k: 'knock', g: gid });
  });
}

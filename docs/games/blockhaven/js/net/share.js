// Shared mobs, dropped items, XP, projectiles, falling blocks and TNT.
//
// Every entity has one owner: the machine that spawned it runs its AI and physics and streams its
// state to the others, who draw a "puppet" copy. Hitting a puppet, picking up a puppet item or
// right-clicking a puppet mob is forwarded to the owner. When the owner wanders off (or leaves)
// the entity is handed to a player who is still near it, so the world keeps working for everyone.
import { Mob } from '../entity/mob.js?v=musof0se';
import { ItemEntity, XpOrb, Projectile, FallingBlock, PrimedTnt } from '../entity/objects.js?v=musof0se';
import { EndCrystal } from '../entity/crystal.js?v=musof0se';

const SHARE_R = 96; // entities this close to another player are streamed to them
const HAND_R = 48; // an entity this close to another player (and far from us) is handed over
const KEEPALIVE = 1.5;
const TIMEOUT = 4;
const r2 = v => Math.round(v * 100) / 100;
const r3 = v => Math.round(v * 1000) / 1000;

export function kindOf(e) {
  if (e.remote || e.puppet) return null;
  if (e instanceof Mob) return 'mob';
  if (e instanceof ItemEntity) return 'item';
  if (e instanceof XpOrb) return 'xp';
  if (e instanceof Projectile) return 'proj';
  if (e instanceof FallingBlock) return 'fall';
  if (e instanceof PrimedTnt) return 'tnt';
  if (e instanceof EndCrystal) return 'crystal';
  return null;
}
// Everything needed to build a copy of the entity.
function describe(e, k) {
  switch (k) {
    case 'mob': return e.toJSON() || { t: 'mob', type: e.mobType, p: e.pos, yaw: e.yaw, baby: e.baby, size: e.size };
    case 'item': return { s: e.stack };
    case 'xp': return { v: e.value };
    case 'proj': return { kind: e.kind };
    case 'fall': return { id: e.blockId, m: e.blockMeta };
    case 'tnt': return { fuse: e.fuse };
    default: return {};
  }
}
// The moving parts, sent many times a second.
function state(e, k) {
  const s = { p: [r3(e.pos[0]), r3(e.pos[1]), r3(e.pos[2])] };
  if (k === 'mob') {
    s.y = r2(e.yaw); s.b = r2(e.bodyYaw); s.hp = r2(e.headPitch || 0);
    s.f = (e.hurtT > 0 ? 1 : 0) | (e.fire > 0 ? 2 : 0) | (e.angry ? 4 : 0) | (e.onGround ? 8 : 0) | (e.sitting ? 16 : 0) | (e.sheared ? 32 : 0) | (e.saddled ? 64 : 0) | (e.baby ? 128 : 0) | (e.charged ? 256 : 0) | (e.inWater ? 512 : 0) | (e.tamed ? 1024 : 0);
    if (e.swing > 0) s.sw = r2(e.swing);
    if (e.deathT > 0) s.dt = r2(e.deathT);
    if (e.fuse > 0) s.fu = r2(e.fuse);
    if (e.def.kind === 'boss' || e.health < e.maxHealth) s.h = r2(e.health);
    if (e.woolColor) s.wc = e.woolColor;
    const lz = e.def.laser && e.laserInfo && e.laserInfo();
    if (lz) s.lz = [...lz.to.map(r2), r2(lz.prog)];
  } else if (k === 'proj') { s.y = r2(e.yaw); s.pi = r2(e.pitch); s.v = e.vel.map(r2); if (e.inGround) s.g = 1; }
  else if (k === 'tnt') s.fu = r2(e.fuse);
  else if (k === 'item') s.c = e.stack.count;
  return s;
}

export class EntitySync {
  constructor(net) {
    this.net = net;
    this.sent = new Map(); // our entity -> { key: last state json, t: time since sent }
    this.byId = new Map(); // our entity id -> entity (for forwarded hits / pickups)
    this.puppets = new Map(); // `${owner}:${id}` -> puppet entity
    this.descs = new Map(); // `${owner}:${id}` -> description
    this.t = 0; this.descT = 0; this.handT = 0;
    this.takeAsked = new Map();
    this.pendingClaim = null;
  }
  get game() { return this.net.game; }

  // ---------------- owner side ----------------
  update(dt) {
    const g = this.game;
    if (!g) return;
    this.t += dt; this.descT += dt; this.handT += dt;
    for (const p of this.puppets.values()) if ((p.puppet.age += dt) > TIMEOUT) this.dropPuppet(p);
    if (this.t < 0.1) return;
    const step = this.t; this.t = 0;
    const others = this.net.remotePlayers().filter(rp => rp.dim === g.dim && rp.snaps.length);
    const out = [], gone = [], descs = {};
    const fullRefresh = this.descT > 2;
    if (fullRefresh) this.descT = 0;
    const seen = new Set();
    this.byId.clear();
    for (const e of g.entities.list) {
      const k = kindOf(e);
      if (!k) continue;
      this.byId.set(e.id, e);
      if (e.dead || e.frozen) continue;
      let near = false;
      for (const rp of others) { const dx = rp.pos[0] - e.pos[0], dz = rp.pos[2] - e.pos[2]; if (dx * dx + dz * dz < SHARE_R * SHARE_R) { near = true; break; } }
      if (!near) continue;
      seen.add(e);
      let rec = this.sent.get(e);
      const st = state(e, k), key = JSON.stringify(st);
      if (!rec) { rec = { key: '', t: 99 }; this.sent.set(e, rec); descs[e.id] = [k, describe(e, k)]; }
      else if (fullRefresh) descs[e.id] = [k, describe(e, k)];
      rec.t += step;
      if (key === rec.key && rec.t < KEEPALIVE) continue;
      rec.key = key; rec.t = 0;
      st.i = e.id;
      out.push(st);
    }
    for (const e of this.sent.keys()) if (!seen.has(e)) { gone.push(e.id); this.sent.delete(e); }
    if (out.length || gone.length || Object.keys(descs).length) this.net.send({ t: 'ent', id: this.net.myId, d: g.dim, l: out, j: descs, x: gone });
    if (this.handT > 1) { this.handT = 0; this.autoHandoff(others); }
  }
  // Give entities we are no longer near to a player who is.
  autoHandoff(others) {
    const g = this.game;
    if (!others.length) return;
    const me = g.player.pos;
    for (const e of g.entities.list) {
      const k = kindOf(e);
      if (k !== 'mob' && k !== 'item' && k !== 'xp') continue;
      if (e.dead || e.deathT > 0 || e === g.riding) continue;
      const dMe = Math.hypot(e.pos[0] - me[0], e.pos[2] - me[2]);
      if (!e.frozen && dMe < 64) continue;
      let best = null, bd = HAND_R;
      for (const rp of others) { const d = Math.hypot(rp.pos[0] - e.pos[0], rp.pos[2] - e.pos[2]); if (d < bd && d < dMe) { best = rp; bd = d; } }
      if (best) this.giveTo(best.peerId, e, k);
    }
  }
  giveTo(peerId, e, k = kindOf(e)) {
    const desc = k === 'mob' ? e.toJSON() : k === 'item' ? { t: 'item', p: e.pos, s: e.stack, a: e.age } : k === 'xp' ? { t: 'xp', p: e.pos, v: e.value } : null;
    if (!desc) return false;
    this.net.sendTo(peerId, { t: 'own', from: this.net.myId, d: this.game.dim, e: desc, was: e.id });
    e.dead = true; e.handedOff = true;
    return true;
  }
  // Leaving a dimension: hand everything near other players in it over to them.
  leaveDim(dim) {
    const g = this.game;
    const others = this.net.remotePlayers().filter(rp => rp.dim === dim && rp.snaps.length);
    for (const p of [...this.puppets.values()]) this.dropPuppet(p);
    if (!others.length) return;
    for (const e of g.entities.list) {
      const k = kindOf(e);
      if ((k !== 'mob' && k !== 'item' && k !== 'xp') || e.dead || e.deathT > 0) continue;
      let best = others[0], bd = Infinity;
      for (const rp of others) { const d = Math.hypot(rp.pos[0] - e.pos[0], rp.pos[2] - e.pos[2]); if (d < bd) { best = rp; bd = d; } }
      this.giveTo(best.peerId, e, k);
    }
    g.entities.list = g.entities.list.filter(e => !e.handedOff);
  }
  // A guest leaving the game gives the host everything it owns, in every dimension.
  handoverAll() {
    const g = this.game;
    if (!g) return;
    const byDim = {};
    for (const e of g.entities.list) {
      const k = kindOf(e);
      if (k !== 'mob' && k !== 'item' || e.dead || e.deathT > 0) continue;
      const j = k === 'mob' ? e.toJSON() : { t: 'item', p: e.pos, s: e.stack, a: e.age };
      if (j) (byDim[g.dim] || (byDim[g.dim] = [])).push(j);
    }
    for (const [d, v] of Object.entries(g.dims || {})) if (Number(d) !== g.dim && v && v.entities && v.entities.length) (byDim[d] || (byDim[d] = [])).push(...v.entities);
    for (const [d, list] of Object.entries(byDim)) this.net.sendTo(0, { t: 'handover', from: this.net.myId, d: Number(d), list });
  }

  // ---------------- receiving ----------------
  onEnt(m) {
    const g = this.game;
    if (m.d !== g.dim) { this.dropOwner(m.id); return; }
    for (const [i, d] of Object.entries(m.j || {})) this.descs.set(`${m.id}:${i}`, d);
    for (const s of m.l || []) {
      const key = `${m.id}:${s.i}`;
      let p = this.puppets.get(key);
      if (!p) {
        const d = this.descs.get(key);
        if (!d) continue;
        p = this.makePuppet(m.id, s.i, d[0], d[1], s);
        if (!p) continue;
      }
      p.puppet.tgt = s; p.puppet.age = 0;
    }
    for (const i of m.x || []) { const p = this.puppets.get(`${m.id}:${i}`); if (p) this.dropPuppet(p); this.descs.delete(`${m.id}:${i}`); }
    // Descriptions refreshed: keep puppets' looks (wool colour, trades, equipment) current.
    for (const [i, d] of Object.entries(m.j || {})) { const p = this.puppets.get(`${m.id}:${i}`); if (p && d[0] === 'mob') this.refreshMob(p, d[1]); }
  }
  makePuppet(owner, id, k, d, s) {
    const g = this.game, [x, y, z] = s.p;
    let e;
    try {
      switch (k) {
        case 'mob': e = new Mob(g, d.type, x, y, z, d); e.yaw = s.y ?? d.yaw ?? 0; e.bodyYaw = s.b ?? e.yaw; break;
        case 'item': e = new ItemEntity(g, x, y, z, { ...d.s }, [0, 0, 0]); break;
        case 'xp': e = new XpOrb(g, x, y, z, d.v); break;
        case 'proj': e = new Projectile(g, d.kind, x, y, z, s.v || [0, 0, 0], null); break;
        case 'fall': e = new FallingBlock(g, x - 0.5, y, z - 0.5, d.id, d.m); break;
        case 'tnt': e = new PrimedTnt(g, x - 0.5, y, z - 0.5, d.fuse); break;
        case 'crystal': e = new EndCrystal(g, x, y, z); break;
        default: return null;
      }
    } catch (err) { console.warn('puppet failed', k, err); return null; }
    const key = `${owner}:${id}`;
    e.puppet = { owner, id, key, kind: k, tgt: s, age: 0, desc: d };
    e.persistent = true;
    const sync = this;
    e.update = function (dt) { sync.puppetUpdate(this, dt); };
    e.toJSON = () => null;
    e.hurt = (amount, src = {}) => sync.forwardHit(e, amount, src);
    e.setFire = s2 => { sync.forwardHit(e, 0, { kind: 'fire', fire: s2 }); };
    if (k === 'mob') e.interact = () => sync.claim(e);
    this.puppets.set(key, e);
    g.entities.list.push(e);
    return e;
  }
  refreshMob(p, d) {
    if (d.woolColor) p.woolColor = d.woolColor;
    if (d.equipment) p.equipment = d.equipment;
    if (d.name !== undefined) p.name = d.name;
    if (d.trades) p.trades = d.trades;
    p.puppet.desc = d;
  }
  dropPuppet(p) {
    p.dead = true;
    this.puppets.delete(p.puppet.key);
    const g = this.game;
    if (g && g.entities.list.includes(p)) g.entities.list = g.entities.list.filter(e => e !== p);
  }
  dropOwner(owner) { for (const p of [...this.puppets.values()]) if (p.puppet.owner === owner) this.dropPuppet(p); }
  // Smoothly follow the owner's copy and animate like the real thing.
  puppetUpdate(e, dt) {
    const g = this.game, s = e.puppet.tgt;
    if (!s) return;
    const k = 1 - Math.exp(-14 * dt);
    const prev = e.pos.slice();
    const far = Math.hypot(s.p[0] - e.pos[0], s.p[1] - e.pos[1], s.p[2] - e.pos[2]) > 8;
    for (let a = 0; a < 3; a++) e.pos[a] = far ? s.p[a] : e.pos[a] + (s.p[a] - e.pos[a]) * k;
    const lerpA = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
    const kind = e.puppet.kind;
    if (kind === 'mob') {
      const wasHurt = e.hurtT > 0, dying = e.deathT > 0;
      e.yaw = lerpA(e.yaw, s.y); e.bodyYaw = lerpA(e.bodyYaw, s.b); e.headPitch += ((s.hp || 0) - e.headPitch) * k;
      const f = s.f || 0;
      e.hurtT = f & 1 ? 0.2 : Math.max(0, e.hurtT - dt);
      e.fire = f & 2 ? 1 : 0; e.angry = !!(f & 4); e.onGround = !!(f & 8); e.sitting = !!(f & 16); e.sheared = !!(f & 32); e.saddled = !!(f & 64);
      e.charged = !!(f & 256); e.inWater = !!(f & 512); e.tamed = !!(f & 1024);
      if (e.baby && !(f & 128)) e.growUp();
      e.swing = s.sw || Math.max(0, e.swing - dt * 3);
      e.fuse = s.fu || 0;
      if (s.wc) e.woolColor = s.wc;
      if (s.lz) { e.laserTgt = s.lz.slice(0, 3); e.laserProg = s.lz[3]; } else e.laserTgt = null;
      if (s.h !== undefined) e.health = s.h;
      if (s.dt) { if (!dying) { e.deathT = 0.001; g.sound.mob(e.mobType, 'death', e.pos, e); } else e.deathT += dt; }
      if (!wasHurt && e.hurtT > 0 && !s.dt) g.sound.mob(e.mobType, 'hurt', e.pos, e);
      const sp = dt > 0 ? Math.hypot(e.pos[0] - prev[0], e.pos[2] - prev[2]) / dt : 0;
      e.walkAmt += (Math.min(1, sp / 3) - e.walkAmt) * Math.min(1, dt * 8);
      e.walk += sp * dt * 2.2;
      e.ambT = (e.ambT ?? 5 + Math.random() * 10) - dt;
      if (e.ambT <= 0 && !e.deathT) { e.ambT = 7 + Math.random() * 11; const pp = g.player.pos; if (Math.hypot(pp[0] - e.pos[0], pp[2] - e.pos[2]) < 20) g.sound.mob(e.mobType, 'ambient', e.pos, e); }
      if (e.def.kind === 'boss' && !e.deathT) {
        const pp = g.player.pos, d = Math.hypot(pp[0] - e.pos[0], pp[1] - e.pos[1], pp[2] - e.pos[2]);
        if (d < 128 && (!g.bossBar || d < g.bossBar.dist)) g.bossBar = { name: e.name || e.def.name, frac: Math.max(0, e.health / e.maxHealth), color: e.def.bossColor || '#e070ff', dist: d };
      }
      if (e.fire > 0 && Math.random() < dt * 8) g.particles.fx('flame', [e.pos[0] + (Math.random() - 0.5) * e.hw * 2, e.pos[1] + Math.random() * e.h, e.pos[2] + (Math.random() - 0.5) * e.hw * 2], 1, 0.05, 0.3);
    } else if (kind === 'proj') {
      e.yaw = s.y ?? e.yaw; e.pitch = s.pi ?? e.pitch;
      if (s.v && !s.g) for (let a = 0; a < 3; a++) e.pos[a] += s.v[a] * dt * 0.5;
      if (e.kind && e.kind.includes('fireball') && Math.random() < 0.5) g.particles.fx('flame', e.pos, 1, 0.15);
    } else if (kind === 'tnt') {
      e.fuse = s.fu ?? e.fuse;
      if (Math.random() < 0.5) g.particles.smoke([e.pos[0], e.pos[1] + 1.05, e.pos[2]], 1);
    } else if (kind === 'item') {
      if (s.c) e.stack.count = s.c;
      this.tryTake(e, dt, 1.3);
    } else if (kind === 'xp') {
      this.tryTake(e, dt, 1.1);
    }
  }
  // Walking over another player's item or XP asks its owner for it.
  tryTake(e, dt, r) {
    const g = this.game, p = g.player.pos;
    if (!g.alive || g.mode === 'spectator' || e.age < 0.6) return;
    const dx = p[0] - e.pos[0], dy = p[1] + 0.8 - e.pos[1], dz = p[2] - e.pos[2];
    if (Math.abs(dx) > r || Math.abs(dz) > r || Math.abs(dy) > 1.6) return;
    const now = performance.now(), last = this.takeAsked.get(e.puppet.key) || 0;
    if (now - last < 800) return;
    this.takeAsked.set(e.puppet.key, now);
    this.net.sendTo(e.puppet.owner, { t: 'take', from: this.net.myId, i: e.puppet.id });
  }
  forwardHit(e, amount, src) {
    const p = e.puppet;
    if (!p || e.dead || e.deathT > 0) return false;
    if (p.kind !== 'mob' && p.kind !== 'crystal') return false;
    const atk = src.attacker, me = this.game.playerEntity;
    this.net.sendTo(p.owner, { t: 'ehit', from: this.net.myId, i: p.id, dmg: amount, kind: src.kind || 'player', knock: src.knock || null, ks: src.knockStrength || 0, fire: src.fire || 0, byMe: atk === me || (atk && atk.tamed) ? 1 : 0 });
    if (amount > 0 && p.kind === 'mob') e.hurtT = 0.3;
    return amount > 0;
  }
  // Right-clicking another player's mob: ask for it, then use it as soon as it arrives.
  claim(e) {
    const p = e.puppet;
    this.pendingClaim = { owner: p.owner, id: p.id, t: performance.now() };
    this.net.sendTo(p.owner, { t: 'claim', from: this.net.myId, i: p.id });
    return true;
  }
  onEhit(m) {
    const e = this.byId.get(m.i) || this.game.entities.list.find(o => o.id === m.i && !o.puppet && !o.remote);
    if (!e || e.dead) return;
    const who = this.net.players.get(m.from);
    const attacker = who && who.rp && m.byMe ? who.rp : null;
    if (m.fire && e.setFire) e.setFire(m.fire);
    if (m.dmg > 0) e.hurt(m.dmg, { kind: m.kind, attacker, knock: m.knock, knockStrength: m.ks });
  }
  onTake(m) {
    const e = this.byId.get(m.i);
    if (!e || e.dead) return;
    const k = kindOf(e);
    if (k === 'item') { e.dead = true; this.net.sendTo(m.from, { t: 'give', s: { ...e.stack } }); }
    else if (k === 'xp') { e.dead = true; this.net.sendTo(m.from, { t: 'givexp', v: e.value }); }
  }
  onGive(m) {
    const g = this.game;
    const left = g.inv.add({ ...m.s });
    if (left) g.dropItem(g.player.pos[0], g.player.pos[1] + 0.5, g.player.pos[2], { ...m.s, count: left });
    if (left < m.s.count) { g.sound.play('pop', null, 0.3, 1.4 + Math.random() * 0.6); g.onPickup(m.s.key, m.s.count - left); }
  }
  onGiveXp(m) { const g = this.game; g.addXp(m.v); g.sound.play('xp', null, 0.3, 0.9 + Math.random() * 0.8); }
  onClaim(m) {
    const e = this.byId.get(m.i);
    if (!e || e.dead || e.deathT > 0 || e === this.game.riding) return;
    this.giveTo(m.from, e);
  }
  // An entity handed to us: it becomes ours to simulate.
  onOwn(m) {
    const g = this.game;
    const old = this.puppets.get(`${m.from}:${m.was}`);
    if (old) this.dropPuppet(old);
    if (m.d !== g.dim) { const d = g.dims[m.d] || (g.dims[m.d] = {}); (d.entities || (d.entities = [])).push(m.e); return; }
    const e = this.spawnFromJSON(m.e);
    const pc = this.pendingClaim;
    if (e && pc && pc.owner === m.from && pc.id === m.was && performance.now() - pc.t < 3000) {
      this.pendingClaim = null;
      if (e.interact) { const app = g.app; if (e.interact(g.inv.held) && app.interact) app.interact.swing = 1; }
    }
  }
  onHandover(m) {
    const g = this.game;
    if (m.d !== g.dim) { const d = g.dims[m.d] || (g.dims[m.d] = {}); (d.entities || (d.entities = [])).push(...m.list); return; }
    this.dropOwner(m.from);
    for (const j of m.list) this.spawnFromJSON(j);
  }
  spawnFromJSON(j) {
    const g = this.game;
    if (!j) return null;
    const before = g.entities.list.length;
    if (j.t === 'xp') { g.entities.add(new XpOrb(g, j.p[0], j.p[1], j.p[2], j.v)); }
    else g.loadEntity(j);
    return g.entities.list.length > before ? g.entities.list[g.entities.list.length - 1] : null;
  }
  // Puppets the host writes into the save (their owners may never hand them back).
  puppetsJSON() {
    const out = [];
    for (const p of this.puppets.values()) {
      if (p.dead) continue;
      if (p.puppet.kind === 'mob' && !p.deathT) out.push({ ...p.puppet.desc, p: p.pos.slice(), yaw: p.yaw });
      else if (p.puppet.kind === 'item') out.push({ t: 'item', p: p.pos.slice(), s: { ...p.stack }, a: 0 });
    }
    return out;
  }
}

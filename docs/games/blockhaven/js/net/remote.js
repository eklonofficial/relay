// Another player in the world: a puppet driven by their network updates. It lives in the entity
// list so everything that can hit a mob (swords, arrows, explosions) can hit it too; the hit is
// forwarded to that player's own game, which applies armour, knockback and death itself.
import { Entity } from '../entity/entity.js?v=muoqcjyl';

const DELAY = 0.1; // seconds of buffering for smooth motion
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class RemotePlayer extends Entity {
  constructor(game, info) {
    super(game, 'player', 0, -1000, 0);
    this.remote = true; this.isLiving = true;
    this.peerId = info.id; this.name = info.name; this.skin = info.skin | 0;
    this.hw = 0.3; this.h = 1.8;
    this.def = { name: info.name, kind: 'player' };
    this.snaps = []; this.dim = -1; this.flags = 0; this.mode = 'survival';
    this.held = null; this.off = null; this.armor = [0, 0, 0, 0];
    this.swing = 0; this.hurtT = 0; this.walk = 0; this.walkAmt = 0; this.health = 20;
    this.sc = null; this.hc = null; this.renderPos = this.pos.slice(); this.headPitch = 0;
  }
  get displayName() { return this.name; }
  get id() { return this.peerId; }
  set id(v) { /* entity ids are not used for remote players */ }
  get sneaking() { return !!(this.flags & 1); }
  get gliding() { return !!(this.flags & 4); }
  get riding() { return !!(this.flags & 8); }
  get deadFlag() { return !!(this.flags & 16); }
  get spectator() { return !!(this.flags & 32); }
  get blocking() { return !!(this.flags & 64); }
  get onFire() { return !!(this.flags & 256); }
  get drawingBow() { return !!(this.flags & 512); }
  get throwingTrident() { return !!(this.flags & 1024); }
  get crossbowHold() { return !!(this.flags & 2048); }
  get deathT() { return this.deadFlag ? 1 : 0; }
  set deathT(v) { /* driven by the owner */ }

  push(m) {
    const now = performance.now() / 1000;
    if (this.dim !== m.d) this.snaps = [];
    this.dim = m.d; this.flags = m.f; this.mode = m.m || 'survival';
    this.held = m.h || null; this.off = m.o || null; this.armor = m.a || [0, 0, 0, 0];
    this.health = m.hp ?? 20;
    if (this.sc !== null && m.sc !== this.sc) this.swing = 1;
    if (this.hc !== null && m.hc !== this.hc) { this.hurtT = 0.4; if (this.dim === this.game.dim) this.game.sound.play('hurt', this.pos, 0.8); }
    this.sc = m.sc; this.hc = m.hc;
    this.vel = m.v || [0, 0, 0];
    this.snaps.push({ t: now, p: m.p, y: m.y, pi: m.pi });
    if (this.snaps.length > 20) this.snaps.shift();
    if (this.snaps.length === 1) { this.pos = m.p.slice(); this.yaw = m.y; this.headPitch = m.pi; }
  }
  update(dt) {
    const s = this.snaps;
    if (s.length) {
      const t = performance.now() / 1000 - DELAY;
      let a = s[0], b = s[0];
      for (let i = 0; i < s.length; i++) { if (s[i].t <= t) a = s[i]; if (s[i].t >= t) { b = s[i]; break; } b = s[i]; }
      const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1;
      const prev = this.pos.slice();
      this.pos = [a.p[0] + (b.p[0] - a.p[0]) * k, a.p[1] + (b.p[1] - a.p[1]) * k, a.p[2] + (b.p[2] - a.p[2]) * k];
      this.yaw = lerpAngle(a.y, b.y, k); this.headPitch = a.pi + (b.pi - a.pi) * k;
      const sp = dt > 0 ? Math.hypot(this.pos[0] - prev[0], this.pos[2] - prev[2]) / dt : 0;
      this.walkAmt += (Math.min(1, sp / 4.3) - this.walkAmt) * Math.min(1, dt * 10);
      this.walk += sp * dt * 2.2;
    }
    this.renderPos = this.pos;
    this.swing = Math.max(0, this.swing - dt / 0.3);
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.onFire && Math.random() < dt * 8) this.game.particles.fx('flame', [this.pos[0] + (Math.random() - 0.5) * 0.6, this.pos[1] + Math.random() * 1.8, this.pos[2] + (Math.random() - 0.5) * 0.6], 1, 0.05, 0.3);
  }
  get visible() { return !this.deadFlag && !this.spectator && this.dim === this.game.dim && this.snaps.length > 0; }
  render(ctx) { if (this.visible) this.game.app.drawRemotePlayer(ctx, this); }
  center() { return [this.pos[0], this.pos[1] + 0.9, this.pos[2]]; }
  hurt(amount, src = {}) {
    if (!this.visible) return false;
    return this.game.net ? this.game.net.hit(this, amount, src) : false;
  }
  setFire(s) { if (this.visible && this.game.net) this.game.net.hit(this, 0, { kind: 'fire', fire: s }); }
  addEffect() {}
  toJSON() { return null; }
}

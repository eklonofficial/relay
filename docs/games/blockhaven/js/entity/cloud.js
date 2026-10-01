// Lingering clouds (the original's area effect cloud). The dragon leaves them where its fireballs
// land and where it breathes: a purple haze that hurts anything standing in it once a second and
// can be scooped up into bottles of dragon's breath.
import { Entity } from './entity.js?v=muppeqq8';

const rnd = (a, b) => a + Math.random() * (b - a);

export class AreaCloud extends Entity {
  // o: { radius, duration (s), grow (radius per s), damage, owner, wait (s) }
  constructor(game, x, y, z, o = {}) {
    super(game, 'area_cloud', x, y, z);
    this.radius = o.radius ?? 3; this.life = o.duration ?? 30; this.grow = o.grow ?? 0;
    this.damage = o.damage ?? 6; this.owner = o.owner || null; this.wait = o.wait ?? 0;
    this.breath = true; this.hw = this.radius; this.h = 0.5;
    this.hits = new Map();
  }
  update(dt) {
    const g = this.game;
    this.life -= dt; this.radius += this.grow * dt;
    if (this.life <= 0 || this.radius < 0.5) { this.dead = true; return; }
    this.hw = this.radius;
    // A drifting violet haze over the whole disc.
    const n = Math.min(12, this.radius * this.radius * dt * 6) + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * this.radius;
      g.particles.fx('portal', [this.pos[0] + Math.cos(a) * r, this.pos[1] + rnd(0, 0.6), this.pos[2] + Math.sin(a) * r], 1, 0.05, 0.15);
    }
    if (this.wait > 0) { this.wait -= dt; return; }
    // Instant damage on anything standing in it, at most once a second each.
    for (const [e, t] of this.hits) if (t - dt <= 0) this.hits.delete(e); else this.hits.set(e, t - dt);
    const targets = [...g.entities.near(this.pos, this.radius + 1, e => e.isLiving && e !== this.owner && e.mobType !== 'ender_dragon'), ...(g.alive ? [g.playerEntity] : [])];
    for (const e of targets) {
      if (this.hits.has(e) || e.dead) continue;
      const dx = e.pos[0] - this.pos[0], dz = e.pos[2] - this.pos[2], dy = e.pos[1] - this.pos[1];
      if (dx * dx + dz * dz > this.radius * this.radius || dy < -1.5 || dy > 1.5) continue;
      this.hits.set(e, 1);
      if (e.hurt) e.hurt(this.damage, { kind: 'magic', attacker: this.owner });
    }
  }
  hurt() { return false; }
  render() {}
}

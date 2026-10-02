// Particles: block fragments (block texture array) and effect sprites (item texture array).
import { FACE_TEX, VARIANT_MASK, TINT_OF, SOLID, B } from '../data/blocks.js?v=murm7eyf';
import { UNLOADED } from '../world/world.js?v=murm7eyf';
import { billboard } from '../entity/objects.js?v=murm7eyf';

const MAX = 1400;
const FX_PROPS = {
  smoke_0: { g: -1.2, life: [1, 2], drag: 0.9, size: 0.18 }, flame: { g: 0, life: [0.5, 1], drag: 0.9, size: 0.14, bright: true },
  heart: { g: -0.6, life: [0.8, 1.2], size: 0.3, bright: true }, crit: { g: 4, life: [0.4, 0.8], size: 0.12, bright: true },
  bubble: { g: -3, life: [0.4, 1], size: 0.12 }, note: { g: -0.5, life: [0.8, 1], size: 0.3, bright: true },
  explosion_0: { g: 0, life: [0.25, 0.45], size: 1.4, bright: true, anim: ['explosion_0', 'explosion_1', 'explosion_2', 'explosion_3'] },
  portal: { g: 0.5, life: [0.6, 1.4], size: 0.12, bright: true }, splash: { g: 12, life: [0.4, 0.8], size: 0.12 },
  angry: { g: -0.4, life: [0.8, 1.2], size: 0.35, bright: true }, happy: { g: -0.3, life: [0.8, 1.2], size: 0.25, bright: true },
  soul: { g: -1, life: [1, 2], size: 0.2, bright: true }, lava_drip: { g: 10, life: [0.6, 1], size: 0.14, bright: true },
  water_drip: { g: 10, life: [0.6, 1], size: 0.12 }, snow: { g: 3, life: [0.6, 1.2], size: 0.14 }, white: { g: 6, life: [0.3, 0.6], size: 0.1 },
  spark: { g: 2, life: [0.4, 1], size: 0.12, bright: true }, ash: { g: 0.6, life: [2, 4], size: 0.08 }, end_rod: { g: -0.2, life: [1, 2], size: 0.12, bright: true },
  glint: { g: -0.5, life: [0.6, 1], size: 0.16, bright: true },
};

export class Particles {
  constructor(game) { this.game = game; this.list = []; }
  push(p) { if (this.list.length >= MAX) this.list.shift(); this.list.push(p); }
  enabled() { return this.game.settings.particles !== false; }

  // Fragments of a block, e.g. while mining or when broken.
  block(x, y, z, id, meta, count, spread = 0.7, speed = 1) {
    if (!this.enabled() || !id) return;
    const k = ((id << 4) | (meta & VARIANT_MASK[id])) * 7;
    const layer = FACE_TEX[k];
    const tint = TINT_OF[id] ? [0.55, 0.78, 0.4] : [1, 1, 1];
    for (let i = 0; i < count; i++) {
      this.push({
        kind: 'block', x: x + 0.5 + (Math.random() - 0.5) * spread, y: y + 0.5 + (Math.random() - 0.5) * spread, z: z + 0.5 + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 3.2 * speed, vy: (Math.random() * 3.5 + 1) * speed, vz: (Math.random() - 0.5) * 3.2 * speed,
        life: 0.5 + Math.random() * 0.7, layer, u: Math.floor(Math.random() * 12) / 16, v: Math.floor(Math.random() * 12) / 16,
        size: 0.08 + Math.random() * 0.08, g: 16, tint, drag: 0.98, collide: true,
      });
    }
  }
  fx(name, pos, count = 1, spread = 0.3, speed = 0.4, color = null) {
    if (!this.enabled()) return;
    const P = FX_PROPS[name] || FX_PROPS.smoke_0;
    for (let i = 0; i < count; i++) {
      this.push({
        kind: 'fx', name, x: pos[0] + (Math.random() - 0.5) * spread * 2, y: pos[1] + (Math.random() - 0.5) * spread * 2, z: pos[2] + (Math.random() - 0.5) * spread * 2,
        vx: (Math.random() - 0.5) * speed * 2, vy: (Math.random() - 0.3) * speed * 2, vz: (Math.random() - 0.5) * speed * 2,
        life: P.life[0] + Math.random() * (P.life[1] - P.life[0]), size: P.size * (0.7 + Math.random() * 0.6), g: P.g, drag: P.drag ?? 0.96,
        bright: P.bright, color, anim: P.anim, max: 0,
      });
      this.list[this.list.length - 1].max = this.list[this.list.length - 1].life;
    }
  }
  smoke(pos, n = 3, big = false) {
    for (let i = 0; i < n; i++) {
      this.fx('smoke_0', pos, 1, 0.25, 0.3);
      const p = this.list[this.list.length - 1];
      if (p) { p.name = big ? 'smoke_2' : Math.random() < 0.5 ? 'smoke_0' : 'smoke_1'; p.size *= big ? 2.5 : 1; }
    }
  }
  explosion(pos, power) {
    for (let i = 0; i < 12 + power * 4; i++) this.fx('explosion_0', pos, 1, power * 0.5, 0.2);
    this.smoke(pos, 16, true);
  }
  update(dt) {
    const w = this.game.world;
    for (const p of this.list) {
      p.vy -= p.g * dt;
      const k = Math.pow(p.drag, dt * 20);
      p.vx *= k; p.vy *= k; p.vz *= k;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
      if (p.collide) {
        const id = w.getBlock(nx, ny, nz);
        if (id !== UNLOADED && SOLID[id]) {
          if (SOLID[w.getBlock(p.x, ny, p.z)]) { p.vy = -p.vy * 0.2; p.vx *= 0.6; p.vz *= 0.6; } else { p.vx = -p.vx * 0.3; p.vz = -p.vz * 0.3; }
        } else { p.x = nx; p.y = ny; p.z = nz; }
      } else { p.x = nx; p.y = ny; p.z = nz; }
      p.life -= dt;
    }
    this.list = this.list.filter(p => p.life > 0);
  }
  render(ctx) {
    const g = this.game;
    for (const p of this.list) {
      if (p.kind === 'block') {
        const l = g.world.lightAt(p.x, p.y, p.z);
        const b = Math.max(Math.pow(0.8, 15 - l.sky) * g.env.skyLight[0], Math.pow(0.82, 15 - l.blk), g.env.ambient[0]);
        billboard(ctx.blockParticles, ctx, p.x, p.y, p.z, p.size, p.layer, [b * p.tint[0], b * p.tint[1], b * p.tint[2], 1], [p.u, p.v, p.u + 0.25, p.v + 0.25]);
      } else {
        let name = p.name;
        if (p.anim) name = p.anim[Math.min(p.anim.length - 1, Math.floor((1 - p.life / p.max) * p.anim.length))];
        const a = Math.min(1, p.life * 3);
        const c = p.color || [1, 1, 1];
        const bright = p.bright ? 1.1 : 0.9;
        billboard(ctx.itemFx, ctx, p.x, p.y, p.z, p.size, g.fxLayer(name), [c[0] * bright, c[1] * bright, c[2] * bright, a]);
      }
    }
  }
}
export { B };

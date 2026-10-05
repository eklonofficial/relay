// Non-living entities: dropped items, XP orbs, projectiles, falling blocks, primed TNT, lightning.
import { Entity, M } from './entity.js?v=musmw2di';
import { itemMesh, emitItemMesh } from './itemmesh.js?v=musmw2di';
import { I } from '../data/items.js?v=musmw2di';
import { B, BLOCKS, SOLID, OPAQUE } from '../data/blocks.js?v=musmw2di';
import { compose, translation, rotationX, rotationY, rotationZ, scaling } from '../core/math.js?v=musmw2di';
import { maxStack } from '../data/items.js?v=musmw2di';
import { moveEntity } from './physics.js?v=musmw2di';
import { fluidPush } from '../game/fluid.js?v=musmw2di';
import { AreaCloud } from './cloud.js?v=musmw2di';
import { AQUATIC } from '../game/combat.js?v=musmw2di';
import { hasGlint } from '../data/enchantments.js?v=musmw2di';

// Billboarded sprite quad facing the camera.
export function billboard(batch, ctx, x, y, z, size, layer, color, uv = [0, 0, 1, 1]) {
  const r = ctx.camRight, u = ctx.camUp, h = size / 2;
  const c = (sr, su) => [x + (r[0] * sr + u[0] * su) * h, y + (r[1] * sr + u[1] * su) * h, z + (r[2] * sr + u[2] * su) * h];
  batch.quad([c(-1, -1), c(-1, 1), c(1, 1), c(1, -1)], uv, layer, color);
}

// Renders a stack in the world: blocks as mini cubes, everything else as an extruded sprite.
export function renderStack(ctx, game, key, pos, spin, scale, light, extraRot = 0, glint = false) {
  const it = I[key];
  if (!it) return;
  if (it.block && !it.flat) {
    const s = 0.25 * scale;
    ctx.blockModels.push({ id: it.block[0], meta: it.block[1], light: (light[0] + light[1] + light[2]) / 3, matrix: compose(translation(pos[0], pos[1], pos[2]), rotationY(spin), scaling(s, s, s), translation(-0.5, 0, -0.5)) });
  } else {
    const layer = game.itemLayer(key);
    const mesh = itemMesh(key, game.itemPixels(key));
    const s = 0.5 * scale;
    const m = M.chain(M.t(pos[0], pos[1], pos[2]), M.ry(spin), M.rz(extraRot), M.s(s), M.t(-0.5, 0, 0));
    emitItemMesh(ctx.items, mesh, layer, m, light, glint ? 3 : 1);
  }
}

export class ItemEntity extends Entity {
  constructor(game, x, y, z, stack, vel = null) {
    super(game, 'item', x, y, z);
    this.stack = stack;
    this.hw = 0.125; this.h = 0.25;
    this.gravity = 16; this.drag = 0.02;
    this.pickupDelay = 0.5;
    this.spin = Math.random() * Math.PI * 2;
    this.bob = Math.random() * Math.PI * 2;
    this.mergeT = 0;
    this.persistent = true;
    if (vel) this.vel = vel.slice();
    else this.vel = [(Math.random() - 0.5) * 2, 3, (Math.random() - 0.5) * 2];
  }
  // ItemEntity.tick, stepped at 20 ticks per second: gravity, drag, floating up through water and
  // riding its currents (so item streams carry drops like the original).
  itemPhysics(dt) {
    this.prev[0] = this.pos[0]; this.prev[1] = this.pos[1]; this.prev[2] = this.pos[2];
    const w = this.world, m = [this.vel[0] / 20, this.vel[1] / 20, this.vel[2] / 20];
    this.tickAcc = Math.min(0.25, (this.tickAcc || 0) + dt);
    while (this.tickAcc >= 0.05) {
      this.tickAcc -= 0.05;
      const box = [this.pos[0] - this.hw, this.pos[1], this.pos[2] - this.hw, this.pos[0] + this.hw, this.pos[1] + this.h, this.pos[2] + this.hw];
      const wh = fluidPush(w, box, m, false, 0.014, true, true), lh = fluidPush(w, box, m, true, w.dim === 1 ? 0.007 : 0.0023333333333333335, true, true);
      this.inWater = wh > 0; this.inLava = lh > 0;
      if (wh > 0.1 || lh > 0.1) { const k = wh > 0.1 ? 0.99 : 0.95; m[0] *= k; m[1] += m[1] < 0.06 ? 5e-4 : 0; m[2] *= k; }
      else m[1] -= 0.04;
      this.vel = m;
      moveEntity(w, this, m[0], m[1], m[2]);
      const below = this.onGround ? w.getBlock(this.pos[0], this.pos[1] - 0.5, this.pos[2]) : 0;
      const f = this.onGround ? (BLOCKS[below] && BLOCKS[below].slippery ? 0.98 : below === B.SLIME_BLOCK ? 0.8 : 0.6) * 0.98 : 0.98;
      m[0] *= f; m[1] *= 0.98; m[2] *= f;
      if (this.onGround && m[1] < 0) m[1] *= -0.5;
    }
    this.vel = [m[0] * 20, m[1] * 20, m[2] * 20];
    if (this.pos[1] < -64) this.dead = true;
  }
  update(dt) {
    this.itemPhysics(dt);
    if (this.dead) return;
    if (this.inLava || this.fire > 0) { this.dead = true; this.game.particles.smoke(this.pos, 4); this.game.sound.play('fizz', this.pos, 0.4); return; }
    this.pickupDelay -= dt;
    if (this.age > 300) { this.dead = true; return; }
    const id = this.world.getBlock(this.pos[0], this.pos[1], this.pos[2]);
    if (id === B.CACTUS || id === B.FIRE) { this.dead = true; return; }
    this.mergeT -= dt;
    if (this.mergeT <= 0) {
      this.mergeT = 0.6;
      const max = maxStack(this.stack.key);
      for (const o of this.game.entities.near(this.pos, 1.2, e => e.type === 'item' && e !== this && !e.dead && !e.puppet)) {
        if (o.stack.key !== this.stack.key || o.stack.dmg || this.stack.dmg || o.stack.tag || this.stack.tag || this.stack.count + o.stack.count > max) continue;
        this.stack.count += o.stack.count;
        o.dead = true;
      }
    }
    const g = this.game, p = g.player;
    if (this.pickupDelay <= 0 && g.alive && g.mode !== 'spectator') {
      const dx = p.pos[0] - this.pos[0], dy = p.pos[1] + 0.8 - this.pos[1], dz = p.pos[2] - this.pos[2];
      if (Math.abs(dx) < 1.3 && Math.abs(dz) < 1.3 && Math.abs(dy) < 1.6) {
        const before = this.stack.count;
        const left = g.inv.add({ ...this.stack });
        if (left < before) {
          g.sound.play('pop', this.pos, 0.3, 1.4 + Math.random() * 0.6);
          g.onPickup(this.stack.key, before - left);
          if (left === 0) this.dead = true; else this.stack.count = left;
        }
      }
    }
  }
  render(ctx) {
    const light = this.brightness();
    const y = this.pos[1] + 0.12 + Math.sin(this.age * 2.5 + this.bob) * 0.05;
    const copies = this.stack.count > 32 ? 3 : this.stack.count > 1 ? 2 : 1;
    for (let k = 0; k < copies; k++) {
      const o = k * 0.06;
      renderStack(ctx, this.game, this.stack.key, [this.pos[0] + o, y + o * 0.5, this.pos[2] - o], this.age * 1.8 + this.spin, 1, light, 0, hasGlint(this.stack));
    }
  }
  toJSON() { return { t: 'item', p: this.pos, s: this.stack, a: this.age }; }
}

export class XpOrb extends Entity {
  constructor(game, x, y, z, value) {
    super(game, 'xp', x, y, z);
    this.value = value; this.hw = 0.12; this.h = 0.25; this.gravity = 8;
    this.vel = [(Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3];
  }
  update(dt) {
    const g = this.game, p = g.player;
    const dx = p.pos[0] - this.pos[0], dy = p.pos[1] + 0.8 - this.pos[1], dz = p.pos[2] - this.pos[2], d = Math.hypot(dx, dy, dz);
    if (g.alive && d < 8 && g.mode !== 'spectator') {
      const f = (1 - d / 8) ** 2 * 60 * dt;
      this.vel[0] += dx / d * f; this.vel[1] += dy / d * f; this.vel[2] += dz / d * f;
    }
    this.physics(dt, { groundFriction: 0.8 });
    if (d < 1.1 && g.alive && g.mode !== 'spectator' && this.age > 0.3) {
      this.dead = true;
      g.addXp(g.mendWithXp(this.value));
      g.sound.play('xp', this.pos, 0.3, 0.9 + Math.random() * 0.8);
    }
    if (this.age > 300) this.dead = true;
  }
  render(ctx) {
    const pulse = 0.5 + 0.5 * Math.sin(this.age * 6);
    const s = 0.18 + Math.min(0.25, Math.log2(this.value + 1) * 0.04);
    billboard(ctx.itemFx, ctx, this.pos[0], this.pos[1] + 0.15, this.pos[2], s, this.game.fxLayer(pulse > 0.5 ? 'xp_1' : 'xp_0'), [1.4, 1.4, 1.4, 1]);
  }
}

// Arrows, snowballs, eggs, pearls, fireballs, tridents.
export class Projectile extends Entity {
  constructor(game, kind, x, y, z, vel, shooter) {
    super(game, kind, x, y, z);
    this.kind = kind;
    this.vel = vel.slice();
    this.shooter = shooter;
    this.hw = 0.12; this.h = 0.25;
    this.inGround = false;
    this.damage = kind === 'arrow' ? 2 : kind === 'trident' ? 8 : 0;
    this.gravity = kind === 'arrow' || kind === 'trident' ? 20 : kind.includes('fireball') || kind === 'dragon_fireball' || kind === 'wither_skull' || kind === 'firework' ? 0 : 12;
    this.pickup = false;
    this.crit = false;
    this.power = 1;
    this.updateAngles();
  }
  updateAngles() {
    const h = Math.hypot(this.vel[0], this.vel[2]);
    this.yaw = Math.atan2(-this.vel[0], -this.vel[2]);
    this.pitch = Math.atan2(this.vel[1], h);
  }
  update(dt) {
    const g = this.game, w = this.world;
    if (this.inGround) {
      this.groundT += dt;
      if (this.world.getBlock(this.stuck[0], this.stuck[1], this.stuck[2]) === B.AIR) { this.inGround = false; this.vel = [0, -1, 0]; return; }
      if (this.pickup && g.alive && this.distTo([g.player.pos[0], g.player.pos[1] + 0.5, g.player.pos[2]]) < 1.3) {
        if (g.mode === 'creative' || g.inv.add({ key: this.kind === 'trident' ? 'trident' : 'arrow', count: 1, ...(this.stack || {}) }) === 0) { this.dead = true; g.sound.play('pop', this.pos, 0.3, 1.6); }
      }
      if (this.groundT > 60) this.dead = true;
      return;
    }
    if (this.age > 30) { this.dead = true; return; }
    const speed = Math.hypot(...this.vel);
    const dist = speed * dt;
    const dir = this.vel.map(v => v / (speed || 1));
    // Entity hits along the path.
    let hitE = null, hitT = Infinity;
    for (const e of g.entities.near(this.pos, dist + 9, o => o.isLiving && !o.dead && o !== this.shooter && !o.projectileImmune)) {
      for (const b of [[e.pos[0] - e.hw, e.pos[1], e.pos[2] - e.hw, e.pos[0] + e.hw, e.pos[1] + e.h, e.pos[2] + e.hw], ...((e.partBoxes && e.partBoxes()) || [])]) {
        const t = w.rayBox(this.pos, dir, [b[0] - 0.15, b[1] - 0.1, b[2] - 0.15, b[3] + 0.15, b[4] + 0.1, b[5] + 0.15]);
        if (t && t.t <= dist && t.t < hitT) { hitE = e; hitT = t.t; }
      }
    }
    if (this.shooter !== g.playerEntity && g.alive && g.mode !== 'spectator' && g.mode !== 'creative') {
      const p = g.player;
      const t = w.rayBox(this.pos, dir, [p.pos[0] - 0.4, p.pos[1], p.pos[2] - 0.4, p.pos[0] + 0.4, p.pos[1] + 1.9, p.pos[2] + 0.4]);
      if (t && t.t <= dist && t.t < hitT) { hitE = g.playerEntity; hitT = t.t; }
    }
    const blockHit = w.raycast(this.pos, dir, dist, { liquids: false });
    if (blockHit && blockHit.t < hitT) {
      const hp = [this.pos[0] + dir[0] * blockHit.t, this.pos[1] + dir[1] * blockHit.t, this.pos[2] + dir[2] * blockHit.t];
      this.pos = hp;
      this.onBlock(blockHit, hp);
      return;
    }
    if (hitE) { this.pos = [this.pos[0] + dir[0] * hitT, this.pos[1] + dir[1] * hitT, this.pos[2] + dir[2] * hitT]; this.onEntity(hitE, speed); return; }
    this.pos[0] += this.vel[0] * dt; this.pos[1] += this.vel[1] * dt; this.pos[2] += this.vel[2] * dt;
    const id = w.getBlock(this.pos[0], this.pos[1], this.pos[2]);
    const water = id === B.WATER;
    this.vel[1] -= this.gravity * dt;
    const drag = water ? (this.kind === 'trident' ? 0.99 : 0.6) : this.gravity ? 0.99 : 1.0;
    const k = Math.pow(drag, dt * 20);
    this.vel[0] *= k; this.vel[1] *= k; this.vel[2] *= k;
    if (this.gravity === 0) { this.vel[0] *= 1 + dt * 0.5; this.vel[1] *= 1 + dt * 0.5; this.vel[2] *= 1 + dt * 0.5; if (Math.hypot(...this.vel) > 40) this.vel = this.vel.map(v => v * 0.98); }
    this.updateAngles();
    if (this.crit && Math.random() < 0.5) g.particles.fx('crit', this.pos, 1, 0.1);
    if (this.kind.includes('fireball')) g.particles.fx('flame', this.pos, 1, 0.15);
    if (this.kind === 'ender_eye') this.eyeUpdate(dt);
    if (this.kind === 'firework') { g.particles.fx('spark', this.pos, 1, 0.05, 0.3); this.fuse = (this.fuse ?? 1.2) - dt; if (this.fuse <= 0) this.impact(null, this.pos, null); }
  }
  onBlock(hit, hp) {
    const g = this.game;
    if (hit.id === B.TARGET) g.rs.targetHit(hit.x, hit.y, hit.z, hp, this);
    if (this.kind === 'arrow' || this.kind === 'trident') {
      this.inGround = true; this.groundT = 0; this.stuck = [hit.x, hit.y, hit.z]; this.vel = [0, 0, 0];
      g.sound.play('arrow_hit', hp, 0.5);
      if (hit.id === B.TNT && this.onFire) g.igniteTnt(hit.x, hit.y, hit.z);
      return;
    }
    this.impact(null, hp, hit);
  }
  onEntity(e, speed) {
    const g = this.game;
    if (this.kind === 'arrow' || this.kind === 'trident') {
      // Piercing arrows pass through up to level+1 targets, never hitting the same one twice.
      if (this.pierced && this.pierced.has(e)) return;
      let dmg = Math.ceil(speed / 20 * this.damage * this.power);
      if (this.crit) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
      // A thrown trident's Impaling hits sea creatures harder.
      if (this.kind === 'trident' && this.stack && this.stack.tag && this.stack.tag.ench && AQUATIC.has(e.mobType)) dmg += 2.5 * (this.stack.tag.ench.impaling || 0);
      const kb = (this.punch || 0) * 6;
      const hurt = e.hurt ? e.hurt(dmg, { kind: 'projectile', attacker: this.shooter, projectile: this, knock: [this.vel[0] / speed, this.vel[2] / speed], knockStrength: 5 + kb }) : false;
      if (hurt) {
        g.sound.play('arrow_hit_entity', this.pos, 0.6);
        if (this.onFire && e.setFire) e.setFire(5);
        if (this.pierce > 0) { this.pierce--; (this.pierced || (this.pierced = new Set())).add(e); return; }
        this.dead = this.kind !== 'trident';
        if (this.kind === 'trident') { this.vel = this.vel.map(v => -v * 0.1); }
      } else { this.vel = this.vel.map(v => -v * 0.1); }
      return;
    }
    this.impact(e, this.pos, null);
  }
  impact(e, hp, hit) {
    const g = this.game;
    this.dead = true;
    switch (this.kind) {
      case 'snowball': if (e && e.hurt) e.hurt(e.mobType === 'blaze' ? 3 : 0, { kind: 'projectile', attacker: this.shooter, projectile: this, knock: [this.vel[0] * 0.03, this.vel[2] * 0.03] }); g.particles.fx('snow', hp, 8, 0.3); break;
      case 'egg':
        if (e && e.hurt) e.hurt(0, { kind: 'projectile', attacker: this.shooter, projectile: this });
        g.particles.fx('white', hp, 6, 0.3, 0.05);
        if (Math.random() < 0.125) { const n = Math.random() < 1 / 32 ? 4 : 1; for (let k = 0; k < n; k++) g.spawnMob('chicken', hp[0], hp[1], hp[2], { baby: true }); }
        break;
      case 'ender_pearl':
        g.particles.fx('portal', hp, 24, 0.8);
        if (this.shooter === g.playerEntity) { g.teleportPlayer(hp[0] - Math.sign(this.vel[0]) * 0.3, hp[1] + (hit && hit.ny > 0 ? 0 : 0.1), hp[2] - Math.sign(this.vel[2]) * 0.3); g.damagePlayer(5, { kind: 'fall' }); if (Math.random() < 0.05) g.spawnMob('endermite', hp[0], hp[1], hp[2]); }
        break;
      case 'fireball':
        g.explode(hp, 1, { fire: true, source: this.shooter });
        break;
      case 'small_fireball':
        if (e && e.hurt) { e.hurt(5, { kind: 'fire', attacker: this.shooter }); if (e.setFire) e.setFire(5); }
        else if (hit) { const fx = hit.x + hit.nx, fy = hit.y + hit.ny, fz = hit.z + hit.nz; if (g.world.getBlock(fx, fy, fz) === B.AIR && g.rules.mobGriefing) g.setBlock(fx, fy, fz, B.FIRE, 0); }
        break;
      case 'dragon_fireball': {
        // No blast: it bursts into a lingering cloud of dragon's breath that spreads from 3 to 7
        // blocks across over 30 seconds.
        const y = hit && hit.ny > 0 ? hit.y + 1 : Math.floor(hp[1]);
        g.entities.add(new AreaCloud(g, hp[0], y, hp[2], { radius: 3, duration: 30, grow: 4 / 30, owner: this.shooter }));
        g.particles.fx('portal', hp, 40, 2);
        g.sound.play('fireball', hp, 0.8);
        break;
      }
      case 'firework':
        // A rocket without firework stars just bursts: sparks and a bang, no damage.
        g.particles.fx('spark', hp, 30, 0.6, 3); g.sound.play('firework_blast', hp, 0.8);
        break;
      case 'wither_skull':
        if (e && e.hurt) { e.hurt(8, { kind: 'projectile', attacker: this.shooter, projectile: this }); if (e.addEffect) e.addEffect('wither', 10); }
        g.explode(hp, 1, { source: this.shooter, breakBlocks: g.rules.mobGriefing });
        break;
      default: break;
    }
  }
  eyeUpdate() {
    if (!this.target) return;
    const dx = this.target[0] - this.pos[0], dz = this.target[1] - this.pos[2], d = Math.hypot(dx, dz);
    const sp = 12;
    this.vel[0] = dx / Math.max(d, 1) * sp; this.vel[2] = dz / Math.max(d, 1) * sp;
    this.vel[1] = this.age < 1.2 ? 3 : -1.5;
    this.game.particles.fx('portal', this.pos, 1, 0.2);
    if (this.age > 2.2) {
      this.dead = true;
      if (Math.random() < 0.8) this.game.dropItem(this.pos[0], this.pos[1], this.pos[2], { key: 'ender_eye', count: 1 });
      else { this.game.sound.play('glass', this.pos, 0.8); this.game.particles.fx('portal', this.pos, 20, 0.6); }
    }
  }
  render(ctx) {
    const g = this.game, light = this.brightness();
    if (this.kind === 'arrow' || this.kind === 'trident') {
      const m = M.chain(M.t(this.pos[0], this.pos[1], this.pos[2]), M.ry(this.yaw + Math.PI / 2), M.rz(this.pitch), M.s(this.kind === 'trident' ? 1.4 : 0.9), M.rz(-Math.PI / 4), M.t(-0.5, -0.5, 0));
      const key = this.kind === 'trident' ? 'trident' : 'arrow';
      emitItemMesh(ctx.items, itemMesh(key, g.itemPixels(key)), g.itemLayer(key), m, light);
      return;
    }
    if (this.kind === 'firework') {
      const m = M.chain(M.t(this.pos[0], this.pos[1], this.pos[2]), M.ry(this.yaw + Math.PI / 2), M.rz(this.pitch), M.s(0.8), M.rz(-Math.PI / 4), M.t(-0.5, -0.5, 0));
      emitItemMesh(ctx.items, itemMesh('firework_rocket', g.itemPixels('firework_rocket')), g.itemLayer('firework_rocket'), m, [1.2, 1.2, 1.2]);
      return;
    }
    const key = { snowball: 'snowball', egg: 'egg', ender_pearl: 'ender_pearl', ender_eye: 'ender_eye', fireball: 'fire_charge', small_fireball: 'fire_charge', dragon_fireball: 'dragon_breath', wither_skull: 'coal' }[this.kind] || 'snowball';
    const big = this.kind === 'fireball' || this.kind === 'dragon_fireball' ? 1.1 : 0.45;
    billboard(ctx.items, ctx, this.pos[0], this.pos[1], this.pos[2], big, g.itemLayer(key), this.kind.includes('fireball') ? [1.3, 1.3, 1.3, 1] : [...light, 1]);
  }
}

export class FallingBlock extends Entity {
  constructor(game, x, y, z, id, meta) {
    super(game, 'falling_block', x + 0.5, y, z + 0.5);
    this.blockId = id; this.blockMeta = meta;
    this.hw = 0.49; this.h = 0.98; this.gravity = 16;
  }
  update(dt) {
    this.physics(dt, { groundFriction: 0.5 });
    if (this.onGround || this.age > 30) {
      this.dead = true;
      const g = this.game, x = Math.floor(this.pos[0]), y = Math.floor(this.pos[1] + 0.5), z = Math.floor(this.pos[2]);
      const cur = g.world.getBlock(x, y, z);
      if (cur === B.AIR || (BLOCKS[cur] && BLOCKS[cur].replaceable)) g.setBlock(x, y, z, this.blockId, this.blockMeta);
      else g.dropItem(this.pos[0], this.pos[1], this.pos[2], { key: BLOCKS[this.blockId].variants[this.blockMeta & 15]?.key || BLOCKS[this.blockId].key, count: 1 });
      // Crush entities underneath (anvils would; sand just lands).
    }
  }
  render(ctx) {
    const l = this.brightness();
    ctx.blockModels.push({ id: this.blockId, meta: this.blockMeta, light: (l[0] + l[1] + l[2]) / 3, matrix: compose(translation(this.pos[0] - 0.5, this.pos[1], this.pos[2] - 0.5)) });
  }
}

export class PrimedTnt extends Entity {
  constructor(game, x, y, z, fuse = 4) {
    super(game, 'tnt', x + 0.5, y, z + 0.5);
    this.hw = 0.49; this.h = 0.98; this.gravity = 16; this.fuse = fuse;
    this.vel = [(Math.random() - 0.5) * 0.8, 4, (Math.random() - 0.5) * 0.8];
  }
  update(dt) {
    this.physics(dt, { groundFriction: 0.5 });
    this.fuse -= dt;
    if (Math.random() < 0.5) this.game.particles.smoke([this.pos[0], this.pos[1] + 1.05, this.pos[2]], 1);
    if (this.fuse <= 0) { this.dead = true; this.game.explode([this.pos[0], this.pos[1] + 0.49, this.pos[2]], 4, { source: this }); }
  }
  render(ctx) {
    const l = this.brightness();
    const flash = Math.floor(this.fuse * 5) % 2 === 0 ? 2.8 : 1;
    const s = this.fuse < 0.4 ? 1 + (0.4 - this.fuse) * 0.4 : 1;
    ctx.blockModels.push({ id: B.TNT, meta: 0, light: (l[0] + l[1] + l[2]) / 3 * flash, matrix: compose(translation(this.pos[0], this.pos[1], this.pos[2]), scaling(s, s, s), translation(-0.5, 0, -0.5)) });
  }
}

export class Lightning extends Entity {
  constructor(game, x, y, z) {
    super(game, 'lightning', x, y, z);
    this.seed = Math.random() * 1000;
    this.segments = [];
    let px = x, pz = z;
    for (let yy = y + 120; yy > y; yy -= 4) { const nx = px + (Math.random() - 0.5) * 3, nz = pz + (Math.random() - 0.5) * 3; this.segments.push([px, yy, pz, nx, Math.max(y, yy - 4), nz]); px = nx; pz = nz; }
  }
  onAdd() { this.game.onLightning(this); }
  update() { if (this.age > 0.6) this.dead = true; }
  render(ctx) {
    if (Math.floor(this.age * 20) % 3 === 2) return;
    const layer = this.game.fxLayer('white');
    for (const [x0, y0, z0, x1, y1, z1] of this.segments) {
      for (const w of [0.12, 0.35]) {
        const a = w > 0.2 ? 0.35 : 1;
        ctx.itemFx.quad([[x0 - w, y0, z0], [x1 - w, y1, z1], [x1 + w, y1, z1], [x0 + w, y0, z0]], [0, 0, 1, 1], layer, [0.85, 0.9, 1.4, a]);
        ctx.itemFx.quad([[x0, y0, z0 - w], [x1, y1, z1 - w], [x1, y1, z1 + w], [x0, y0, z0 + w]], [0, 0, 1, 1], layer, [0.85, 0.9, 1.4, a]);
      }
    }
  }
}

export { SOLID, OPAQUE };

// Living mobs: physics, AI archetypes, combat, breeding/taming, trading and animation.
import { Entity, drawModel, rootMatrix, M } from './entity.js';
import { Projectile, renderStack } from './objects.js';
import { MOBS, PROFESSIONS } from '../data/mobs.js';
import { B, BLOCKS, SOLID } from '../data/blocks.js';
import { UNLOADED } from '../world/world.js';
import { villagerTrades } from '../game/trades.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const wrap = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const WOOL_COLORS = { white: [1, 1, 1], light_gray: [0.62, 0.62, 0.6], gray: [0.3, 0.32, 0.34], black: [0.1, 0.1, 0.12], brown: [0.5, 0.33, 0.2], pink: [1, 0.6, 0.72] };

export class Mob extends Entity {
  constructor(game, type, x, y, z, opts = {}) {
    super(game, type, x, y, z);
    const d = MOBS[type];
    this.def = d; this.mobType = type; this.isLiving = true;
    this.size = opts.size || (d.sizes ? [1, 2, 4][rint(0, 2)] : 1);
    this.baby = !!opts.baby;
    const sc = (d.scale || 1) * (d.sizes ? this.size : 1) * (this.baby ? 0.5 : 1);
    this.scale = sc;
    this.hw = d.hw * (d.sizes ? this.size : 1) * (this.baby ? 0.5 : 1);
    this.h = d.h * (d.sizes ? this.size : 1) * (this.baby ? 0.5 : 1);
    this.maxHealth = d.health * (d.sizes ? this.size * this.size : 1);
    this.health = opts.health ?? this.maxHealth;
    this.speed = d.speed * (this.baby ? 1.3 : 1);
    this.stepHeight = 0.6;
    this.yaw = opts.yaw ?? rnd(-Math.PI, Math.PI); this.bodyYaw = this.yaw; this.headPitch = 0;
    this.hurtT = 0; this.invul = 0; this.deathT = 0; this.attackT = 0; this.swing = 0;
    this.walk = 0; this.walkAmt = 0; this.wanderT = rnd(1, 4); this.goal = null;
    this.target = null; this.panic = 0; this.love = 0; this.breedCd = 0; this.growT = this.baby ? 1200 : 0;
    this.persistent = !!(opts.persistent || d.persistent);
    this.home = opts.home || null;
    this.fuse = 0; this.charged = !!opts.charged;
    this.tamed = !!opts.tamed; this.sitting = !!opts.sitting;
    this.sheared = !!opts.sheared;
    this.woolColor = opts.woolColor || (type === 'sheep' ? (Math.random() < 0.82 ? 'white' : ['light_gray', 'gray', 'black', 'brown', 'pink'][rint(0, 4)]) : null);
    this.name = opts.name || null;
    this.air = 15;
    this.fire = 0;
    this.effects = {};
    this.gravity = d.flying ? 0 : 28;
    if (type === 'villager' || type === 'wandering_trader') this.initVillager(opts);
    if (type === 'ender_dragon') { this.phase = 'circle'; this.phaseT = 0; this.circleA = 0; this.projectileImmune = false; }
    if (d.slowFall) this.slowFall = true;
    this.eggT = rnd(300, 600);
  }

  get displayName() { return this.name || (this.profession && this.profession !== 'nitwit' ? this.profession[0].toUpperCase() + this.profession.slice(1) : this.def.name); }
  get skinKey() { return this.mobType === 'villager' ? `villager_${this.profession}` : this.mobType; }

  initVillager(o) {
    this.profession = this.mobType === 'wandering_trader' ? 'trader' : o.profession || PROFESSIONS[rint(0, PROFESSIONS.length - 1)];
    this.level = o.level || 1; this.xp = o.xp || 0;
    this.trades = o.trades || villagerTrades(this.profession, this.level, true);
    this.persistent = this.mobType === 'villager';
  }

  // ---------------- damage ----------------
  hurt(amount, src = {}) {
    const g = this.game;
    if (this.dead || this.deathT > 0 || this.invul > 0) return false;
    if (this.def.fireImmune && (src.kind === 'fire' || src.kind === 'lava')) return false;
    if (this.mobType === 'enderman' && src.kind === 'projectile') { this.teleportRandom(); return false; }
    if (this.mobType === 'ender_dragon' && src.kind !== 'explosion' && src.kind !== 'player' && src.kind !== 'projectile' && src.kind !== 'kill') return false;
    this.health -= amount;
    this.invul = 0.5; this.hurtT = 0.4;
    const kr = 1 - (this.def.knockbackResist || 0);
    if (src.knock && kr > 0) {
      const k = (src.knockStrength || 5) * kr;
      this.vel[0] += src.knock[0] * k; this.vel[2] += src.knock[1] * k;
      if (this.onGround || this.def.flying) this.vel[1] = Math.max(this.vel[1], 4 * kr);
    }
    g.sound.mob(this.mobType, 'hurt', this.pos, this);
    const atk = src.attacker;
    if (atk && atk !== this) {
      if (this.def.kind === 'passive' || this.def.ai === 'animal') this.panic = 5;
      if (this.def.kind === 'neutral' || this.def.kind === 'hostile' || this.def.ai === 'golem' || this.mobType === 'wolf' || this.mobType === 'goat') this.target = atk;
      if (this.def.groupAnger) for (const o of g.entities.near(this.pos, 20, e => e.mobType === this.mobType)) o.target = atk;
      if (this.mobType === 'wolf' && this.tamed && atk === g.playerEntity) this.target = null;
    }
    if (this.health <= 0) this.die(src);
    return true;
  }
  die(src) {
    const g = this.game, d = this.def;
    this.health = 0;
    this.deathT = 0.001;
    g.sound.mob(this.mobType, 'death', this.pos, this);
    const byPlayer = src.attacker === g.playerEntity || (src.attacker && src.attacker.tamed);
    const onFire = this.fire > 0;
    if (!this.baby && g.rules.doMobLoot) {
      for (const [key, a, b, chance] of d.drops || []) {
        if (chance !== undefined && Math.random() >= chance) continue;
        const n = rint(a, b);
        const k = onFire && d.cooked && d.cooked[key] ? d.cooked[key] : key;
        if (n > 0) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], { key: k, count: n });
      }
      if (d.woolDrop && !this.sheared) g.dropItem(this.pos[0], this.pos[1] + 0.5, this.pos[2], { key: `${this.woolColor}_wool`, count: 1 });
      if (this.mobType === 'creeper' && src.attacker && src.attacker.mobType === 'skeleton') g.dropItem(this.pos[0], this.pos[1], this.pos[2], { key: 'music_disc' in {} ? 'music_disc' : 'gunpowder', count: 1 });
      if (byPlayer && d.xp) g.spawnXp(this.pos, rint(d.xp[0], d.xp[1]) * (d.sizes ? this.size : 1));
    }
    if (d.sizes && this.size > 1) for (let k = 0; k < rint(2, 4); k++) g.spawnMob(this.mobType, this.pos[0] + rnd(-0.5, 0.5), this.pos[1] + 0.5, this.pos[2] + rnd(-0.5, 0.5), { size: this.size / 2 });
    if (this.mobType === 'ender_dragon') g.onDragonDeath(this);
    if (byPlayer) g.onKill(this);
  }
  setFire(s) { if (!this.def.fireImmune) this.fire = Math.max(this.fire, s); }
  teleportRandom() {
    const w = this.world;
    for (let k = 0; k < 16; k++) {
      const x = this.pos[0] + rnd(-16, 16), z = this.pos[2] + rnd(-16, 16);
      for (let y = Math.floor(this.pos[1]) + 8; y > this.pos[1] - 12; y--) {
        const id = w.getBlock(x, y, z);
        if (id !== UNLOADED && SOLID[id] && w.getBlock(x, y + 1, z) === B.AIR && w.getBlock(x, y + 2, z) === B.AIR && w.getBlock(x, y + 3, z) === B.AIR) {
          this.game.particles.fx('portal', this.center(), 20, 0.5);
          this.pos = [Math.floor(x) + 0.5, y + 1, Math.floor(z) + 0.5];
          this.game.sound.play('teleport', this.pos, 0.6);
          this.game.particles.fx('portal', this.center(), 20, 0.5);
          return true;
        }
      }
    }
    return false;
  }

  // ---------------- helpers ----------------
  playerTargetable() { const g = this.game; return g.alive && (g.mode === 'survival' || g.mode === 'adventure' || g.mode === 'hardcore') && g.difficulty !== 'peaceful'; }
  distToPlayer() { const p = this.game.player.pos; return Math.hypot(p[0] - this.pos[0], p[1] - this.pos[1], p[2] - this.pos[2]); }
  canSee(t) {
    const e = [this.pos[0], this.pos[1] + this.h * 0.85, this.pos[2]];
    const tp = t.pos, th = t.h || 1.6;
    const d = [tp[0] - e[0], tp[1] + th * 0.8 - e[1], tp[2] - e[2]], len = Math.hypot(...d);
    if (len < 0.5) return true;
    const hit = this.world.raycast(e, d.map(v => v / len), len);
    return !hit || !SOLID[hit.id] || hit.id === B.LEAVES;
  }
  targetPos() { const t = this.target; return t ? t.pos : null; }
  lookAt(p, rate = 8, dt = 0.05) {
    const dx = p[0] - this.pos[0], dz = p[2] - this.pos[2];
    const want = Math.atan2(-dx, -dz);
    this.yaw += wrap(want - this.yaw) * Math.min(1, rate * dt);
    const dy = p[1] + 1.2 - (this.pos[1] + this.h * 0.85);
    this.headPitch = Math.atan2(dy, Math.hypot(dx, dz)) * 0.8;
  }
  // Steer horizontally toward p at speed; jumps over single blocks; avoids cliffs and liquids for land mobs.
  moveTo(p, speed, dt) {
    const dx = p[0] - this.pos[0], dz = p[2] - this.pos[2], d = Math.hypot(dx, dz);
    if (d < 0.3) return true;
    this.lookAt(p, 6, dt);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    if (!this.def.flying && !this.def.swim && this.onGround && !this.target) {
      const ax = this.pos[0] + fx * 0.9, az = this.pos[2] + fz * 0.9;
      let drop = 0;
      for (let k = 0; k < 4 && !SOLID[this.world.getBlock(ax, this.pos[1] - 1 - k, az)]; k++) drop++;
      const ahead = this.world.getBlock(ax, this.pos[1], az), below = this.world.getBlock(ax, this.pos[1] - 1, az);
      if (drop >= 3 || below === B.LAVA || ahead === B.LAVA || ((below === B.WATER) && !this.def.amphibious)) { this.goal = null; this.wanderT = 0.5; return false; }
    }
    const k = 1 - Math.exp(-(this.onGround || this.inWater || this.def.flying ? 12 : 3) * dt);
    this.vel[0] += (fx * speed - this.vel[0]) * k;
    this.vel[2] += (fz * speed - this.vel[2]) * k;
    if (this.collidedH && this.onGround) { this.vel[1] = this.def.hop ? 6 : 8.4; this.stuck = (this.stuck || 0) + dt; }
    else if (this.def.hop && this.onGround) this.vel[1] = 5;
    if (this.def.climbs && this.collidedH) this.vel[1] = 3;
    if (this.inWater && !this.def.swim && this.pos[1] < this.waterSurface()) this.vel[1] = Math.max(this.vel[1], 2.2);
    return false;
  }
  waterSurface() { let y = Math.floor(this.pos[1]); while (this.world.getBlock(this.pos[0], y + 1, this.pos[2]) === B.WATER && y < 255) y++; return y + 0.5; }
  wander(dt, radius = 8, speed = this.speed * 0.45) {
    this.wanderT -= dt;
    if (this.wanderT <= 0) {
      this.wanderT = rnd(3, 9);
      if (Math.random() < 0.35) { this.goal = null; return; }
      const cx = this.home && Math.hypot(this.home[0] - this.pos[0], this.home[2] - this.pos[2]) > 24 ? this.home : this.pos;
      this.goal = [cx[0] + rnd(-radius, radius), this.pos[1], cx[2] + rnd(-radius, radius)];
    }
    if (this.goal) { if (this.moveTo(this.goal, speed, dt)) this.goal = null; if (this.stuck > 1.5) { this.goal = null; this.stuck = 0; } }
    else this.brake(dt);
  }
  brake(dt) { const k = Math.exp(-10 * dt); if (this.onGround) { this.vel[0] *= k; this.vel[2] *= k; } }
  flee(from, dt, speed) {
    const dx = this.pos[0] - from[0], dz = this.pos[2] - from[2], d = Math.hypot(dx, dz) || 1;
    this.moveTo([this.pos[0] + dx / d * 6, this.pos[1], this.pos[2] + dz / d * 6], speed, dt);
  }
  meleeTarget(dt, reach = null) {
    const t = this.target, a = this.def.attack;
    if (!t || !a) return;
    const d = Math.hypot(t.pos[0] - this.pos[0], t.pos[2] - this.pos[2]);
    const dy = Math.abs(t.pos[1] - this.pos[1]);
    reach = reach ?? this.hw + (t.hw || 0.3) + 0.9;
    if (d > reach * 0.8) this.moveTo(t.pos, this.speed, dt); else { this.lookAt(t.pos, 10, dt); this.brake(dt); }
    if (a.leap && this.onGround && d < 4 && d > 2 && Math.random() < dt * 1.5) { const n = d || 1; this.vel[0] = (t.pos[0] - this.pos[0]) / n * 6; this.vel[2] = (t.pos[2] - this.pos[2]) / n * 6; this.vel[1] = 6; }
    if (d < reach && dy < 2.2 && this.attackT <= 0) {
      this.attackT = a.cd;
      this.swing = 1;
      this.doAttack(t);
    }
  }
  doAttack(t) {
    const a = this.def.attack, g = this.game;
    const diffMul = { peaceful: 0, easy: 0.6, normal: 1, hard: 1.5 }[g.difficulty] ?? 1;
    let dmg = a.dmg * (t === g.playerEntity ? diffMul : 1);
    if (this.mobType === 'iron_golem') dmg = rnd(7, 21) * (t === g.playerEntity ? diffMul : 1);
    const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], n = Math.hypot(dx, dz) || 1;
    const ok = t.hurt(dmg, { kind: 'mob', attacker: this, knock: [dx / n, dz / n], knockStrength: a.fling ? 12 : 5 });
    if (ok) {
      if (a.fling) t.vel[1] = 9 * a.fling;
      if (a.poison && t.addEffect && g.difficulty !== 'easy') t.addEffect('poison', a.poison);
      if (a.wither && t.addEffect) t.addEffect('wither', a.wither);
      if (a.hunger && t.addEffect) t.addEffect('hunger', a.hunger);
      if (this.fire > 0 && t.setFire) t.setFire(4);
    }
  }
  shoot(kind, target, speed = 30) {
    const g = this.game;
    const e = [this.pos[0], this.pos[1] + this.h * 0.8, this.pos[2]];
    const tp = [target.pos[0], target.pos[1] + (target.h || 1.6) * 0.6, target.pos[2]];
    const dx = tp[0] - e[0], dz = tp[2] - e[2], hd = Math.hypot(dx, dz);
    let dy = tp[1] - e[1];
    if (kind === 'arrow' || kind === 'snowball' || kind === 'potion') dy += hd * hd * (kind === 'arrow' ? 20 : 12) / (2 * speed * speed);
    const len = Math.hypot(dx, dy, dz) || 1;
    const inacc = { easy: 0.12, normal: 0.07, hard: 0.03 }[g.difficulty] ?? 0.07;
    const v = [dx / len * speed + rnd(-1, 1) * inacc * speed, dy / len * speed + rnd(-1, 1) * inacc * speed, dz / len * speed + rnd(-1, 1) * inacc * speed];
    const pk = kind === 'potion' ? 'snowball' : kind;
    const pr = new Projectile(g, pk, e[0] + dx / len * 0.6, e[1], e[2] + dz / len * 0.6, v, this);
    if (kind === 'potion') { pr.kind = 'potion'; pr.potion = Math.random() < 0.5 ? 'poison' : 'harm'; }
    g.entities.add(pr);
    g.sound.play(kind === 'arrow' ? 'bow' : kind.includes('fireball') ? 'fireball' : 'throw', this.pos, 0.6);
  }

  // ---------------- update ----------------
  update(dt) {
    const g = this.game, d = this.def;
    if (this.deathT > 0) {
      this.deathT += dt;
      if (this.mobType === 'ender_dragon') { this.pos[1] += dt * 2; if (Math.random() < 0.5) g.particles.explosion([this.pos[0] + rnd(-4, 4), this.pos[1] + rnd(0, 4), this.pos[2] + rnd(-4, 4)], 1); if (this.deathT > 8) this.dead = true; return; }
      this.physics(dt);
      if (this.deathT > 1) { this.dead = true; g.particles.smoke(this.center(), 8); }
      return;
    }
    this.invul = Math.max(0, this.invul - dt); this.hurtT = Math.max(0, this.hurtT - dt);
    this.attackT -= dt; this.swing = Math.max(0, this.swing - dt * 3); this.breedCd -= dt;
    if (this.love > 0) { this.love -= dt; if (Math.random() < dt * 3) g.particles.fx('heart', [this.pos[0], this.pos[1] + this.h + 0.2, this.pos[2]], 1, 0.3); }
    if (this.baby) { this.growT -= dt; if (this.growT <= 0) this.growUp(); }
    for (const k of Object.keys(this.effects)) {
      this.effects[k] -= dt;
      if (k === 'poison' && Math.random() < dt && this.health > 1) this.hurt(1, { kind: 'magic' });
      if (this.effects[k] <= 0) delete this.effects[k];
    }
    this.environment(dt);
    if (this.dead) return;
    this.ai(dt);
    // Physics per archetype.
    if (d.flying) this.flyPhysics(dt);
    else if (d.swim && this.inWater) this.swimPhysics(dt);
    else {
      this.physics(dt, { groundFriction: 0.6 });
      if (this.slowFall && this.vel[1] < -2) this.vel[1] = -2;
    }
    const sp = Math.hypot(this.pos[0] - this.prev[0], this.pos[2] - this.prev[2]) / Math.max(dt, 1e-4);
    this.walkAmt += (Math.min(1, sp / 3) - this.walkAmt) * Math.min(1, dt * 8);
    this.walk += sp * dt * 2.2;
    this.bodyYaw += wrap(this.yaw - this.bodyYaw) * Math.min(1, dt * (sp > 0.3 ? 10 : 3));
    // Despawn far hostiles.
    if (!this.persistent && !this.name && !this.tamed && d.kind === 'hostile') {
      const dp = this.distToPlayer();
      if (dp > 128 || (dp > 40 && Math.random() < dt / 30)) this.dead = true;
    }
  }
  flyPhysics(dt) {
    this.prev = this.pos.slice();
    const k = Math.exp(-2 * dt);
    this.vel[0] *= k; this.vel[1] *= k; this.vel[2] *= k;
    const steps = Math.max(1, Math.ceil(Math.hypot(...this.vel) * dt / 0.45));
    if (this.mobType === 'ender_dragon' || this.mobType === 'ghast') { this.pos[0] += this.vel[0] * dt; this.pos[1] += this.vel[1] * dt; this.pos[2] += this.vel[2] * dt; return; }
    for (let i = 0; i < steps; i++) import_move(this, dt / steps);
  }
  swimPhysics(dt) {
    this.prev = this.pos.slice();
    const k = Math.exp(-1.5 * dt);
    this.vel[0] *= k; this.vel[1] *= k; this.vel[2] *= k;
    import_move(this, dt);
    if (this.world.getBlock(this.pos[0], this.pos[1] + this.h, this.pos[2]) !== B.WATER && this.vel[1] > 0) this.vel[1] *= 0.5;
  }
  environment(dt) {
    const g = this.game, d = this.def, w = this.world;
    const feet = w.getBlock(this.pos[0], this.pos[1] + 0.1, this.pos[2]);
    if (feet === B.LAVA && !d.fireImmune && !d.lavaWalker) { this.setFire(8); this.hurt(4, { kind: 'lava' }); }
    if ((feet === B.FIRE || feet === B.CAMPFIRE) && !d.fireImmune) this.setFire(4);
    if (this.fire > 0) {
      this.fire -= dt;
      if (this.inWater) this.fire = 0;
      if (Math.floor(this.fire * 1) !== Math.floor((this.fire + dt) * 1)) this.hurt(1, { kind: 'fire' });
      if (Math.random() < dt * 8) g.particles.fx('flame', [this.pos[0] + rnd(-this.hw, this.hw), this.pos[1] + rnd(0, this.h), this.pos[2] + rnd(-this.hw, this.hw)], 1, 0.05, 0.3);
    }
    // Undead burn in daylight.
    if (d.burns && g.isDay() && g.dim === 0 && !this.inWater) {
      const l = w.lightAt(this.pos[0], this.pos[1] + this.h, this.pos[2]);
      if (l.sky >= 15 && !g.raining && Math.random() < dt * 2) this.setFire(8);
    }
    if (d.hurtByWater && (this.inWater || (g.raining && w.lightAt(this.pos[0], this.pos[1] + 1, this.pos[2]).sky >= 15)) && Math.random() < dt * 2) this.hurt(1, { kind: 'drown' });
    if (d.hatesWater && (this.inWater || (g.raining && g.dim === 0 && w.lightAt(this.pos[0], this.pos[1] + 2, this.pos[2]).sky >= 15)) && Math.random() < dt * 2) { this.hurt(1, { kind: 'drown' }); this.teleportRandom(); }
    // Fish out of water.
    if (d.ai === 'fish' || this.mobType === 'squid' || this.mobType === 'glow_squid' || this.mobType === 'dolphin') {
      if (!this.inWater) { this.air -= dt; if (this.onGround && Math.random() < dt * 3) { this.vel[1] = 4; this.vel[0] = rnd(-2, 2); this.vel[2] = rnd(-2, 2); } if (this.air < 0 && Math.random() < dt) this.hurt(1, { kind: 'drown' }); }
      else this.air = 15;
    } else if (!d.swim && !d.amphibious && !d.undead && this.mobType !== 'iron_golem') {
      const head = w.getBlock(this.pos[0], this.pos[1] + this.h * 0.9, this.pos[2]);
      if (head === B.WATER) { this.air -= dt; if (this.air < 0 && Math.random() < dt) this.hurt(2, { kind: 'drown' }); } else this.air = 15;
    }
    if (d.meltsInHeat && (this.inWater || g.biomeTemp(this.pos) > 1) && Math.random() < dt) this.hurt(1, { kind: 'fire' });
    if (this.mobType === 'snow_golem' && this.onGround && Math.random() < dt * 4) {
      const x = this.pos[0], y = Math.floor(this.pos[1]), z = this.pos[2];
      if (w.getBlock(x, y, z) === B.AIR && SOLID[w.getBlock(x, y - 1, z)] && g.biomeTemp(this.pos) < 0.8 && g.rules.mobGriefing) g.setBlock(x, y, z, B.SNOW, 0);
    }
    if (this.pos[1] < -64) this.dead = true;
  }

  ai(dt) {
    const d = this.def, g = this.game;
    if (this.target && (this.target.dead || this.target.deathT > 0 || (this.target === g.playerEntity && !this.playerTargetable()) || this.distTo(this.target.pos) > 40)) this.target = null;
    switch (d.ai) {
      case 'animal': return this.aiAnimal(dt);
      case 'wolf': return this.aiWolf(dt);
      case 'neutral': return this.target ? this.meleeTarget(dt) : this.aiAnimal(dt);
      case 'melee': return this.aiHostileMelee(dt);
      case 'ranged': return this.aiRanged(dt);
      case 'creeper': return this.aiCreeper(dt);
      case 'enderman': return this.aiEnderman(dt);
      case 'slime': return this.aiSlime(dt);
      case 'swimmer': case 'fish': return this.aiSwim(dt);
      case 'bat': case 'flyer': return this.aiFlyer(dt);
      case 'phantom': return this.aiPhantom(dt);
      case 'blaze': return this.aiBlaze(dt);
      case 'ghast': return this.aiGhast(dt);
      case 'golem': return this.aiGolem(dt);
      case 'snowgolem': return this.aiSnowGolem(dt);
      case 'villager': return this.aiVillager(dt);
      case 'dragon': return this.aiDragon(dt);
      default: return this.wander(dt);
    }
  }
  seekPlayer(range = 16) {
    const g = this.game;
    if (this.target || !this.playerTargetable()) return;
    if (this.distToPlayer() > range) return;
    if (this.def.goldCalm && g.inv.armor.slots.some(s => s && s.key.startsWith('golden_'))) return;
    if (this.def.neutralInDay && g.isDay() && this.world.lightAt(this.pos[0], this.pos[1] + 1, this.pos[2]).sky > 11) return;
    if (this.canSee(g.playerEntity)) this.target = g.playerEntity;
  }
  aiAnimal(dt) {
    const g = this.game, d = this.def;
    if (this.panic > 0) { this.panic -= dt; const s = g.player.pos; this.flee(s, dt, this.speed * 1.6); return; }
    if (d.shy && this.distToPlayer() < 6 && !this.love) { this.flee(g.player.pos, dt, this.speed * 1.3); return; }
    // Breeding partners.
    if (this.love > 0 && !this.baby) {
      const mate = g.entities.near(this.pos, 8, e => e !== this && e.mobType === this.mobType && e.love > 0 && !e.baby)[0];
      if (mate) {
        this.moveTo(mate.pos, this.speed * 0.8, dt);
        if (this.distTo(mate.pos) < 1.5 + this.hw) {
          this.love = 0; mate.love = 0; this.breedCd = mate.breedCd = 300;
          g.spawnMob(this.mobType, this.pos[0], this.pos[1] + 0.2, this.pos[2], { baby: true, woolColor: Math.random() < 0.5 ? this.woolColor : mate.woolColor });
          g.spawnXp(this.pos, rint(1, 7));
        }
        return;
      }
    }
    // Follow a player holding food.
    const held = g.inv.held;
    if (d.food && held && d.food.includes(held.key) && this.distToPlayer() < 10 && g.alive) {
      if (this.distToPlayer() > 2.2) this.moveTo(g.player.pos, this.speed * 0.6, dt); else { this.lookAt(g.player.pos, 6, dt); this.brake(dt); }
      return;
    }
    if (this.mobType === 'chicken' && !this.baby) { this.eggT -= dt; if (this.eggT <= 0) { this.eggT = rnd(300, 600); g.dropItem(this.pos[0], this.pos[1] + 0.3, this.pos[2], { key: 'egg', count: 1 }); g.sound.play('pop', this.pos, 0.4); } }
    if (this.mobType === 'sheep' && this.sheared && Math.random() < dt / 40) {
      const b = this.world.getBlock(this.pos[0], this.pos[1] - 0.5, this.pos[2]);
      if (b === B.GRASS_BLOCK) { this.sheared = false; g.setBlock(Math.floor(this.pos[0]), Math.floor(this.pos[1] - 0.5), Math.floor(this.pos[2]), B.DIRT, 0); }
    }
    if (this.mobType === 'goat' && this.playerTargetable() && this.distToPlayer() < 8 && Math.random() < dt / 20) { this.target = g.playerEntity; this.ramT = 2; }
    if (this.ramT > 0) { this.ramT -= dt; if (this.target) { this.moveTo(this.target.pos, this.speed * 2.2, dt); if (this.distTo(this.target.pos) < 1.4) { this.target.hurt(2, { kind: 'mob', attacker: this, knock: [-Math.sin(this.yaw), -Math.cos(this.yaw)], knockStrength: 14 }); this.target = null; this.ramT = 0; } } return; }
    this.wander(dt);
  }
  aiWolf(dt) {
    const g = this.game;
    if (this.target && (this.target !== g.playerEntity || !this.tamed)) { this.meleeTarget(dt); return; }
    if (this.tamed) {
      if (this.sitting) { this.brake(dt); return; }
      const d = this.distToPlayer();
      if (d > 14 && g.alive) { this.pos = [g.player.pos[0] + rnd(-1, 1), g.player.pos[1], g.player.pos[2] + rnd(-1, 1)]; return; }
      if (d > 3.5) { this.moveTo(g.player.pos, this.speed * 1.1, dt); return; }
      // Defend the owner.
      const foe = g.lastAttackedBy && !g.lastAttackedBy.dead && g.lastAttackedBy !== this ? g.lastAttackedBy : g.lastTarget && !g.lastTarget.dead && g.lastTarget !== this ? g.lastTarget : null;
      if (foe && foe.isLiving && foe.distTo(this.pos) < 16) this.target = foe;
      this.brake(dt);
      return;
    }
    const prey = g.entities.near(this.pos, 12, e => e.mobType === 'sheep' || e.mobType === 'rabbit' || e.mobType === 'fox')[0];
    if (prey && Math.random() < dt / 20) this.target = prey;
    this.aiAnimal(dt);
  }
  aiHostileMelee(dt) {
    const g = this.game;
    this.seekPlayer(this.def.undead ? 32 : 16);
    if (!this.target && (this.mobType === 'zombie' || this.mobType === 'husk' || this.mobType === 'drowned')) {
      const v = g.entities.near(this.pos, 16, e => e.mobType === 'villager' || e.mobType === 'wandering_trader')[0];
      if (v) this.target = v;
    }
    if (this.def.raider && !this.target) {
      const v = g.entities.near(this.pos, 16, e => e.mobType === 'villager' || e.mobType === 'iron_golem')[0];
      if (v) this.target = v;
    }
    if (this.target) this.meleeTarget(dt);
    else this.wander(dt);
  }
  aiRanged(dt) {
    const g = this.game, a = this.def.attack;
    this.seekPlayer(a.range + 4);
    if (this.def.raider && !this.target) { const v = g.entities.near(this.pos, 16, e => e.mobType === 'villager' || e.mobType === 'iron_golem')[0]; if (v) this.target = v; }
    const t = this.target;
    if (!t) { this.wander(dt); return; }
    const d = this.distTo(t.pos);
    const see = this.canSee(t);
    this.lookAt(t.pos, 10, dt);
    if (d > a.range * 0.7 || !see) this.moveTo(t.pos, this.speed, dt);
    else if (d < 4) this.flee(t.pos, dt, this.speed);
    else {
      this.strafe = this.strafe || (Math.random() < 0.5 ? 1 : -1);
      if (Math.random() < dt * 0.3) this.strafe *= -1;
      const rx = Math.cos(this.yaw) * this.strafe, rz = -Math.sin(this.yaw) * this.strafe;
      this.vel[0] += (rx * this.speed * 0.5 - this.vel[0]) * Math.min(1, dt * 6);
      this.vel[2] += (rz * this.speed * 0.5 - this.vel[2]) * Math.min(1, dt * 6);
    }
    if (see && d < a.range && this.attackT <= 0) {
      this.attackT = a.cd * rnd(0.8, 1.3);
      this.swing = 1;
      if (a.ranged === 'fangs') this.evokerFangs(t);
      else this.shoot(a.ranged, t, a.ranged === 'arrow' ? 32 : 22);
    }
  }
  evokerFangs(t) {
    const g = this.game;
    const dx = t.pos[0] - this.pos[0], dz = t.pos[2] - this.pos[2], n = Math.hypot(dx, dz) || 1;
    for (let k = 1; k <= 12; k++) {
      const p = [this.pos[0] + dx / n * k * 1.2, this.pos[1], this.pos[2] + dz / n * k * 1.2];
      g.later(k * 0.06, () => {
        g.particles.fx('spark', [p[0], p[1] + 0.5, p[2]], 6, 0.4, 1);
        g.sound.play('fangs', p, 0.4);
        for (const e of [g.playerEntity, ...g.entities.near(p, 1.2, o => o.isLiving && o !== this && !o.def.raider)]) if (e && Math.hypot(e.pos[0] - p[0], e.pos[2] - p[2]) < 1 && Math.abs(e.pos[1] - p[1]) < 2) e.hurt(6, { kind: 'magic', attacker: this });
      });
    }
    if (Math.random() < 0.3) for (let k = 0; k < 2; k++) g.spawnMob('silverfish', this.pos[0], this.pos[1] + 1, this.pos[2]);
  }
  aiCreeper(dt) {
    const g = this.game;
    this.seekPlayer(16);
    const t = this.target;
    if (!t) { this.fuse = Math.max(0, this.fuse - dt); this.wander(dt); return; }
    const d = this.distTo(t.pos);
    if (d < 3 || (this.fuse > 0 && d < 7)) {
      if (this.fuse === 0) g.sound.play('fuse', this.pos, 0.8);
      this.fuse += dt; this.brake(dt); this.lookAt(t.pos, 8, dt);
      if (this.fuse >= 1.5) {
        this.dead = true;
        g.explode([this.pos[0], this.pos[1] + 0.8, this.pos[2]], this.charged ? 6 : 3, { source: this, breakBlocks: g.rules.mobGriefing });
      }
    } else { this.fuse = Math.max(0, this.fuse - dt * 2); this.moveTo(t.pos, this.speed, dt); }
  }
  aiEnderman(dt) {
    const g = this.game;
    if (!this.target && this.playerTargetable() && this.distToPlayer() < 64) {
      // Aggro when the player looks straight at the head.
      const e = g.player.eyePos(), f = g.lookDir();
      const h = [this.pos[0] - e[0], this.pos[1] + this.h * 0.9 - e[1], this.pos[2] - e[2]], len = Math.hypot(...h);
      const dot = (h[0] * f[0] + h[1] * f[1] + h[2] * f[2]) / len;
      if (dot > 1 - 0.025 / Math.max(1, len * 0.1) && this.canSee(g.playerEntity) && g.inv.armor.get(0)?.key !== 'carved_pumpkin') { this.target = g.playerEntity; g.sound.play('enderman_stare', this.pos, 1); }
    }
    if (this.target) { this.meleeTarget(dt); if (this.distTo(this.target.pos) > 12 && Math.random() < dt * 0.3) { this.teleportRandom(); } }
    else { this.wander(dt); if (Math.random() < dt / 30) this.teleportRandom(); }
  }
  aiSlime(dt) {
    this.seekPlayer(16);
    const t = this.target;
    this.jumpT = (this.jumpT ?? rnd(1, 2)) - dt;
    if (this.onGround) { this.brake(dt); if (this.landed === false) { this.landed = true; this.game.particles.fx('white', this.pos, 4 * this.size, this.hw, 0.5, this.mobType === 'slime' ? [0.5, 1, 0.4] : [1, 0.4, 0.1]); } }
    if (this.onGround && this.jumpT <= 0) {
      this.jumpT = t ? rnd(0.6, 1.2) : rnd(1.5, 4);
      if (t) this.lookAt(t.pos, 50, 1); else this.yaw += rnd(-1.5, 1.5);
      const sp = 3 + this.size;
      this.vel[0] = -Math.sin(this.yaw) * sp; this.vel[2] = -Math.cos(this.yaw) * sp; this.vel[1] = 6 + this.size * 0.8;
      this.landed = false;
    }
    if (t && this.size > 1 && this.overlaps(t, 0.1) && this.attackT <= 0) { this.attackT = 1; this.doAttack(t); }
    if (t && this.size === 1 && this.mobType === 'magma_cube' && this.overlaps(t, 0.1) && this.attackT <= 0) { this.attackT = 1; this.doAttack(t); }
  }
  aiSwim(dt) {
    const g = this.game;
    if (!this.inWater) return;
    this.wanderT -= dt;
    if (this.mobType === 'pufferfish' && this.distToPlayer() < 2.5 && this.attackT <= 0 && this.playerTargetable()) { this.attackT = 1; this.doAttack(g.playerEntity); }
    if (this.mobType === 'dolphin' && g.player.inWater && this.distToPlayer() < 12) this.goal = [g.player.pos[0] + rnd(-2, 2), g.player.pos[1] + rnd(-1, 1), g.player.pos[2] + rnd(-2, 2)];
    if (this.wanderT <= 0 || !this.goal) { this.wanderT = rnd(2, 6); this.goal = [this.pos[0] + rnd(-8, 8), this.pos[1] + rnd(-3, 3), this.pos[2] + rnd(-8, 8)]; }
    const dx = this.goal[0] - this.pos[0], dy = this.goal[1] - this.pos[1], dz = this.goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    if (this.world.getBlock(this.goal[0], this.goal[1], this.goal[2]) !== B.WATER) { this.goal = null; return; }
    const sp = this.speed * (this.mobType === 'squid' ? 0.6 + 0.4 * Math.max(0, Math.sin(this.age * 3)) : 1);
    this.vel[0] += (dx / n * sp - this.vel[0]) * Math.min(1, dt * 2); this.vel[1] += (dy / n * sp - this.vel[1]) * Math.min(1, dt * 2); this.vel[2] += (dz / n * sp - this.vel[2]) * Math.min(1, dt * 2);
    this.yaw += wrap(Math.atan2(-dx, -dz) - this.yaw) * Math.min(1, dt * 4);
  }
  aiFlyer(dt) {
    this.wanderT -= dt;
    if (this.wanderT <= 0 || !this.goal) {
      this.wanderT = rnd(1, 4);
      const ground = this.world.heightAt(this.pos[0], this.pos[2]);
      const maxY = this.mobType === 'bat' ? this.pos[1] + 3 : ground + 8;
      this.goal = [this.pos[0] + rnd(-6, 6), Math.min(maxY, this.pos[1] + rnd(-2, 2.5)), this.pos[2] + rnd(-6, 6)];
    }
    const dx = this.goal[0] - this.pos[0], dy = this.goal[1] - this.pos[1], dz = this.goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    this.vel[0] += (dx / n * this.speed - this.vel[0]) * Math.min(1, dt * 3); this.vel[1] += (dy / n * this.speed - this.vel[1]) * Math.min(1, dt * 3); this.vel[2] += (dz / n * this.speed - this.vel[2]) * Math.min(1, dt * 3);
    this.yaw += wrap(Math.atan2(-dx, -dz) - this.yaw) * Math.min(1, dt * 5);
    if (this.collidedH || this.collidedV) this.goal = null;
  }
  aiPhantom(dt) {
    const g = this.game;
    if (!this.target && this.playerTargetable()) this.target = g.playerEntity;
    const t = this.target;
    if (!t) { this.aiFlyer(dt); return; }
    this.phaseT = (this.phaseT || 0) - dt;
    this.circleA = (this.circleA || 0) + dt * 0.6;
    let goal;
    if (this.swoop) {
      goal = [t.pos[0], t.pos[1] + 1, t.pos[2]];
      if (this.distTo(goal) < 1.8 && this.attackT <= 0) { this.attackT = 1; this.doAttack(t); this.swoop = false; this.phaseT = rnd(4, 8); }
      if (this.phaseT < -4) this.swoop = false;
    } else {
      goal = [t.pos[0] + Math.cos(this.circleA) * 14, t.pos[1] + 16, t.pos[2] + Math.sin(this.circleA) * 14];
      if (this.phaseT <= 0) { this.swoop = true; this.phaseT = 0; g.sound.play('phantom', this.pos, 0.8); }
    }
    const dx = goal[0] - this.pos[0], dy = goal[1] - this.pos[1], dz = goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    const sp = this.swoop ? 11 : 7;
    this.vel[0] += (dx / n * sp - this.vel[0]) * Math.min(1, dt * 2); this.vel[1] += (dy / n * sp - this.vel[1]) * Math.min(1, dt * 2); this.vel[2] += (dz / n * sp - this.vel[2]) * Math.min(1, dt * 2);
    this.yaw = Math.atan2(-this.vel[0], -this.vel[2]);
  }
  aiBlaze(dt) {
    const g = this.game;
    this.seekPlayer(20);
    const t = this.target;
    if (!t) { this.aiFlyer(dt); return; }
    const goal = [t.pos[0] + Math.cos(this.age * 0.4) * 6, t.pos[1] + 3, t.pos[2] + Math.sin(this.age * 0.4) * 6];
    const dx = goal[0] - this.pos[0], dy = goal[1] - this.pos[1], dz = goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    this.vel[0] += (dx / n * 2.5 - this.vel[0]) * dt * 2; this.vel[1] += (dy / n * 2.5 - this.vel[1]) * dt * 2; this.vel[2] += (dz / n * 2.5 - this.vel[2]) * dt * 2;
    this.lookAt(t.pos, 10, dt);
    if (this.canSee(t) && this.attackT <= 0) {
      this.attackT = 3; this.burst = 3;
    }
    if (this.burst > 0 && this.attackT < 2.6 - (3 - this.burst) * 0.3) { this.burst--; this.shoot('small_fireball', t, 16); }
    if (Math.random() < dt * 4) g.particles.smoke(this.center(), 1);
  }
  aiGhast(dt) {
    this.seekPlayer(48);
    const t = this.target;
    this.wanderT -= dt;
    if (this.wanderT <= 0 || !this.goal) { this.wanderT = rnd(3, 7); this.goal = [this.pos[0] + rnd(-16, 16), this.pos[1] + rnd(-4, 4), this.pos[2] + rnd(-16, 16)]; }
    const dx = this.goal[0] - this.pos[0], dy = this.goal[1] - this.pos[1], dz = this.goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
    if (this.world.getBlock(this.pos[0] + dx / n * 3, this.pos[1] + 2 + dy / n * 3, this.pos[2] + dz / n * 3) !== B.AIR) this.goal = null;
    this.vel[0] += (dx / n * 2 - this.vel[0]) * dt; this.vel[1] += (dy / n * 2 - this.vel[1]) * dt; this.vel[2] += (dz / n * 2 - this.vel[2]) * dt;
    if (t) {
      this.lookAt(t.pos, 4, dt);
      if (this.attackT <= 0 && this.canSee(t)) { this.attackT = 3.5; this.charging = 0.6; this.game.sound.play('ghast_warn', this.pos, 1.2); }
      if (this.charging > 0) { this.charging -= dt; if (this.charging <= 0) this.shoot('fireball', t, 18); }
    } else this.yaw = Math.atan2(-this.vel[0], -this.vel[2]);
  }
  aiGolem(dt) {
    const g = this.game;
    if (!this.target || this.target === g.playerEntity) {
      const foe = g.entities.near(this.pos, 16, e => e.isLiving && e.def && e.def.kind === 'hostile' && e.mobType !== 'creeper' && e.deathT === 0)[0];
      if (foe) this.target = foe;
    }
    if (this.target) this.meleeTarget(dt, this.hw + (this.target.hw || 0.3) + 1.2);
    else this.wander(dt, 10, this.speed * 0.6);
  }
  aiSnowGolem(dt) {
    const g = this.game;
    const foe = g.entities.near(this.pos, 10, e => e.isLiving && e.def && e.def.kind === 'hostile' && e.deathT === 0)[0];
    if (foe) { this.lookAt(foe.pos, 8, dt); this.brake(dt); if (this.attackT <= 0) { this.attackT = 1; this.shoot('snowball', foe, 22); } }
    else this.wander(dt);
  }
  aiVillager(dt) {
    const g = this.game;
    if (this.trading) { this.lookAt(g.player.pos, 8, dt); this.brake(dt); return; }
    const threat = g.entities.near(this.pos, 8, e => e.def && (e.def.undead || e.def.raider) && e.deathT === 0 && e.def.kind === 'hostile')[0];
    if (threat) { this.flee(threat.pos, dt, this.speed * 1.4); return; }
    if (this.distToPlayer() < 4 && Math.random() < dt) this.lookAt(g.player.pos, 20, dt);
    this.wander(dt, 10);
    if (this.mobType === 'wandering_trader' && this.age > 2400) this.dead = true;
  }
  aiDragon(dt) {
    const g = this.game;
    g.bossBar = { name: 'Ender Dragon', frac: this.health / this.maxHealth };
    this.phaseT -= dt;
    // Crystals heal.
    const crystal = g.entities.near(this.pos, 40, e => e.type === 'end_crystal')[0];
    if (crystal && this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + dt); this.beam = crystal; } else this.beam = null;
    const p = g.player.pos;
    let goal;
    if (this.phase === 'circle') {
      this.circleA += dt * 0.25;
      goal = [Math.cos(this.circleA) * 60, 90 + Math.sin(this.circleA * 2) * 10, Math.sin(this.circleA) * 60];
      if (this.phaseT <= 0) { const r = Math.random(); this.phase = r < 0.4 ? 'charge' : r < 0.75 ? 'strafe' : 'perch'; this.phaseT = this.phase === 'perch' ? 10 : 6; }
    } else if (this.phase === 'charge') {
      goal = [p[0], p[1] + 1, p[2]];
      if (this.distTo(goal) < 5 || this.phaseT <= 0) { this.phase = 'circle'; this.phaseT = rnd(8, 14); }
    } else if (this.phase === 'strafe') {
      goal = [p[0] + Math.cos(this.circleA) * 30, p[1] + 20, p[2] + Math.sin(this.circleA) * 30];
      this.circleA += dt * 0.4;
      if (this.attackT <= 0 && this.playerTargetable()) { this.attackT = 2.5; this.shoot('dragon_fireball', g.playerEntity, 20); }
      if (this.phaseT <= 0) { this.phase = 'circle'; this.phaseT = rnd(8, 14); }
    } else {
      const top = g.world.heightAt(0, 0);
      goal = [0, (top > 0 ? top : 64) + 2, 0];
      if (this.distTo(goal) < 3) { this.vel = [0, 0, 0]; this.lookAt(p, 2, dt); if (this.attackT <= 0 && this.distToPlayer() < 20 && this.playerTargetable()) { this.attackT = 2; this.shoot('dragon_fireball', g.playerEntity, 16); } }
      if (this.phaseT <= 0) { this.phase = 'circle'; this.phaseT = rnd(10, 15); }
    }
    if (goal) {
      const dx = goal[0] - this.pos[0], dy = goal[1] - this.pos[1], dz = goal[2] - this.pos[2], n = Math.hypot(dx, dy, dz) || 1;
      const sp = this.phase === 'charge' ? 22 : 14;
      if (n > 2) { this.vel[0] += (dx / n * sp - this.vel[0]) * dt * 1.5; this.vel[1] += (dy / n * sp - this.vel[1]) * dt * 1.5; this.vel[2] += (dz / n * sp - this.vel[2]) * dt * 1.5; this.yaw += wrap(Math.atan2(-this.vel[0], -this.vel[2]) - this.yaw) * Math.min(1, dt * 2); }
    }
    // Body contact damage and knockback.
    if (g.alive && this.distToPlayer() < 5 && this.attackT <= 0 && this.playerTargetable()) {
      this.attackT = 1;
      const dx = p[0] - this.pos[0], dz = p[2] - this.pos[2], n = Math.hypot(dx, dz) || 1;
      g.playerEntity.hurt(10, { kind: 'mob', attacker: this, knock: [dx / n, dz / n], knockStrength: 16 });
      g.player.vel[1] = 10;
    }
    // Destroy blocks it flies through (not end stone/obsidian/bedrock).
    if (g.rules.mobGriefing && Math.random() < dt * 10) {
      const x = Math.floor(this.pos[0] + rnd(-3, 3)), y = Math.floor(this.pos[1] + rnd(0, 3)), z = Math.floor(this.pos[2] + rnd(-3, 3));
      const id = g.world.getBlock(x, y, z);
      if (id !== B.AIR && id !== UNLOADED && id !== B.END_STONE && id !== B.OBSIDIAN && id !== B.BEDROCK && id !== B.END_PORTAL && BLOCKS[id].hardness !== Infinity) g.setBlock(x, y, z, B.AIR, 0);
    }
  }
  growUp() {
    this.baby = false;
    const d = this.def;
    this.scale = d.scale || 1; this.hw = d.hw; this.h = d.h; this.speed = d.speed;
  }

  // Player right-clicked this mob with a stack. Returns true if consumed the interaction.
  interact(held) {
    const g = this.game, d = this.def, key = held && held.key;
    if (key === 'name_tag' && held.tag && held.tag.name) { this.name = held.tag.name; this.persistent = true; g.inv.consumeHeld(); return true; }
    if (d.food && key && d.food.includes(key)) {
      if (this.baby) { this.growT -= 120; g.inv.consumeHeld(g.mode === 'creative' ? 0 : 1); g.particles.fx('happy', this.center(), 5, 0.4); return true; }
      if (this.breedCd <= 0 && this.love <= 0 && (!this.tamed || this.mobType === 'wolf')) { this.love = 30; g.inv.consumeHeld(g.mode === 'creative' ? 0 : 1); g.sound.play('eat', this.pos, 0.5); return true; }
    }
    if (this.mobType === 'wolf') {
      if (!this.tamed && key === 'bone') {
        g.inv.consumeHeld(g.mode === 'creative' ? 0 : 1);
        if (Math.random() < 0.33) { this.tamed = true; this.persistent = true; this.target = null; this.sitting = true; this.maxHealth = 20; this.health = 20; g.particles.fx('heart', this.center(), 7, 0.4); g.toast('Tamed!', 'A wolf joined you', 'bone'); }
        else g.particles.smoke(this.center(), 4);
        return true;
      }
      if (this.tamed && !key) { this.sitting = !this.sitting; return true; }
    }
    if ((d.milk) && key === 'bucket' && !this.baby) { g.inv.consumeHeld(); g.inv.add({ key: 'milk_bucket', count: 1 }); g.sound.play('milk', this.pos, 0.6); return true; }
    if (d.stew && key === 'bowl' && !this.baby) { g.inv.consumeHeld(); g.inv.add({ key: 'mushroom_stew', count: 1 }); return true; }
    if (d.shearable && key === 'shears' && !this.sheared && !this.baby) {
      this.sheared = true;
      for (let k = rint(1, 3); k > 0; k--) g.dropItem(this.pos[0], this.pos[1] + 1, this.pos[2], { key: `${this.woolColor}_wool`, count: 1 });
      g.inv.damageHeld(1); g.sound.play('shear', this.pos, 0.6); return true;
    }
    if (this.mobType === 'mooshroom' && key === 'shears') { this.dead = true; g.spawnMob('cow', this.pos[0], this.pos[1], this.pos[2]); g.dropItem(this.pos[0], this.pos[1] + 1, this.pos[2], { key: 'red_mushroom', count: 5 }); return true; }
    if (this.mobType === 'sheep' && key && key.endsWith('_dye')) { const c = key.slice(0, -4); this.woolColor = c; g.inv.consumeHeld(); return true; }
    if ((this.mobType === 'villager' || this.mobType === 'wandering_trader') && this.profession !== 'nitwit' && !this.baby) {
      this.trading = true; g.openTrade(this); return true;
    }
    if (this.mobType === 'zombie_villager' && key === 'golden_apple') { g.inv.consumeHeld(); this.curing = 5; g.sound.play('cure', this.pos, 0.8); g.later(5, () => { if (!this.dead) { this.dead = true; g.spawnMob('villager', this.pos[0], this.pos[1], this.pos[2]); } }); return true; }
    if (this.mobType === 'iron_golem' && key === 'iron_ingot' && this.health < this.maxHealth) { this.health = Math.min(this.maxHealth, this.health + 25); g.inv.consumeHeld(); g.sound.play('anvil', this.pos, 0.5); return true; }
    if (key === 'saddle' && (this.mobType === 'pig' || this.mobType === 'horse' || this.mobType === 'strider')) { this.saddled = true; g.inv.consumeHeld(); return true; }
    return false;
  }

  // ---------------- rendering ----------------
  pose() {
    const t = this.age, w = this.walk, a = this.walkAmt, P = {};
    const sw = Math.sin(w) * 0.9 * a;
    const head = [this.headPitch, wrap(this.yaw - this.bodyYaw), 0];
    const anim = this.model.anim;
    const swing = Math.sin(this.swing * Math.PI) * 1.2;
    switch (anim) {
      case 'biped': case 'zombie': case 'skeleton': case 'enderman': case 'villager': case 'golem': {
        P.head = head;
        P.rightLeg = [sw, 0, 0]; P.leftLeg = [-sw, 0, 0];
        const idle = Math.sin(t * 1.1) * 0.05;
        if (anim === 'zombie') { P.rightArm = [1.45 + idle - swing * 0.5, 0, 0]; P.leftArm = [1.45 - idle - swing * 0.5, 0, 0]; }
        else if (anim === 'skeleton' && this.target) { P.rightArm = [1.5, -0.1, 0]; P.leftArm = [1.5, 0.4, 0]; }
        else if (anim === 'golem') { P.rightArm = [-sw * 0.6 + swing * 1.6, 0, 0]; P.leftArm = [sw * 0.6 + swing * 1.6, 0, 0]; P.rightLeg = [sw * 0.6, 0, 0]; P.leftLeg = [-sw * 0.6, 0, 0]; }
        else { P.rightArm = [-sw * 0.8 + swing, 0, 0.05 + idle]; P.leftArm = [sw * 0.8, 0, -0.05 - idle]; }
        if (anim === 'enderman' && this.target) { P.head = [head[0], head[1], 0]; P.pivots = { head: [0, 42, 0] }; }
        if (this.mobType === 'wolf' && this.sitting) { P.leg2 = [-1.3, 0, 0]; P.leg3 = [-1.3, 0, 0]; }
        break;
      }
      case 'quadruped': case 'creeper': {
        P.head = head;
        P.leg0 = [sw, 0, 0]; P.leg1 = [-sw, 0, 0]; P.leg2 = [-sw, 0, 0]; P.leg3 = [sw, 0, 0];
        if (this.model.parts.tail) P.tail = [(this.model.parts.tail.rot?.[0] || 0) + Math.sin(t * 3) * 0.1, Math.sin(t * 2) * 0.2 * (this.tamed ? 3 : 1), 0];
        if (this.mobType === 'wolf' && this.sitting) { P.leg2 = [-1.4, 0, 0]; P.leg3 = [-1.4, 0, 0]; }
        break;
      }
      case 'chicken': case 'bird': {
        P.head = head; P.leg0 = [sw, 0, 0]; P.leg1 = [-sw, 0, 0];
        const flap = this.onGround ? 0 : Math.sin(t * 30) * 0.8;
        P.wingR = [0, 0, -flap]; P.wingL = [0, 0, flap];
        break;
      }
      case 'spider': {
        P.head = head;
        for (let i = 0; i < 8; i++) { const base = this.model.parts[`leg${i}`].rot; const side = i < 4 ? 1 : -1; P[`leg${i}`] = [0, base[1] + Math.sin(w * 1.5 + i * 1.3) * 0.35 * a * side, base[2] + Math.abs(Math.cos(w * 1.5 + i)) * 0.25 * a * side]; }
        break;
      }
      case 'slime': break;
      case 'squid': for (let i = 0; i < 8; i++) P[`t${i}`] = [Math.sin(t * 3 + i) * 0.35, 0, 0]; break;
      case 'fish': P.tail = [0, Math.sin(t * 8) * 0.5, 0]; if (!this.inWater) P.body = [0, 0, Math.PI / 2]; break;
      case 'bat': { const f = Math.sin(t * 25) * 1.1; P.wingR = [0, f, 0]; P.wingL = [0, -f, 0]; break; }
      case 'phantom': { const f = Math.sin(t * 6) * 0.5; P.wingR = [0, 0, f]; P.wingL = [0, 0, -f]; P.tail = [Math.sin(t * 3) * 0.2, 0, 0]; break; }
      case 'blaze': {
        P.head = head; P.pivots = {};
        for (let i = 0; i < 12; i++) { const ring = Math.floor(i / 4), ang = t * (ring === 1 ? -1.4 : 1.2) + (i % 4) * Math.PI / 2 + ring; const r = [9, 7, 5][ring]; P.pivots[`rod${i}`] = [Math.cos(ang) * r, 2 + ring * 5 + Math.sin(t * 2 + i) * 1, Math.sin(ang) * r]; }
        break;
      }
      case 'ghast': for (let i = 0; i < 9; i++) P[`t${i}`] = [Math.sin(t * 1.5 + i) * 0.3, 0, Math.cos(t * 1.2 + i) * 0.2]; break;
      case 'snowgolem': P.head = head; break;
      case 'dragon': {
        const f = Math.sin(t * 2.2);
        P.wingR = [0, 0, f * 0.7]; P.wingL = [0, 0, -f * 0.7];
        P.pivots = {};
        for (let i = 0; i < 5; i++) P.pivots[`neck${i}`] = [0, 30 + Math.sin(t * 1.5 - i * 0.4) * 2 * (i + 1) * 0.5, -32 - i * 10];
        P.pivots.head = [0, 30 + Math.sin(t * 1.5 - 2) * 3, -80];
        for (let i = 0; i < 12; i++) P.pivots[`tail${i}`] = [Math.sin(t * 1.2 + i * 0.4) * i * 1.2, 30 + Math.sin(t * 1.5 + i * 0.3) * i * 0.6, 32 + i * 10];
        break;
      }
      case 'bug': { P.pivots = {}; for (const k of Object.keys(this.model.parts)) { const i = Number(k.slice(1)); P.pivots[k] = [Math.sin(w * 2 + i) * 0.8 * a, 0, -4 + i * 3]; } break; }
      default: break;
    }
    if (this.mobType === 'sheep') { P.sheared = this.sheared; P.woolColor = WOOL_COLORS[this.woolColor] || [1, 1, 1]; }
    return P;
  }

  render(ctx) {
    const g = this.game;
    if (!this.model) { this.model = g.mobModel(this.skinKey); this.layer = g.mobLayer(this.skinKey); }
    const light = this.def.glow ? [1.1, 1.1, 1.1] : this.brightness();
    let extra = null;
    if (this.deathT > 0 && this.mobType !== 'ender_dragon') extra = M.rz(Math.min(1, this.deathT * 2) * Math.PI / 2);
    let sc = this.scale;
    if (this.mobType === 'creeper' && this.fuse > 0) { const s = 1 + Math.min(1, this.fuse / 1.5) * 0.25 + Math.sin(this.fuse * 30) * 0.02; sc *= s; }
    if (this.model.anim === 'slime') { const sq = this.onGround ? 1 : 1.2; extra = M.s(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); }
    let yOff = 0;
    if (this.model.anim === 'bat' || this.model.anim === 'blaze' || this.model.anim === 'ghast') yOff = Math.sin(this.age * 2) * 0.1;
    const root = rootMatrix([this.pos[0], this.pos[1] + yOff, this.pos[2]], this.bodyYaw, sc, extra);
    const flash = this.hurtT > 0 || (this.mobType === 'creeper' && this.fuse > 0 && Math.floor(this.fuse * 8) % 2 === 0) ? 0.8 : 0;
    const mats = drawModel(ctx.mobs, this.model, this.layer, root, this.pose(), light, flash);
    // Held item.
    const held = this.def.holds;
    if (held && mats.rightArm) {
      const m = M.chain(mats.rightArm, M.t(0, -9, -1), M.rx(-Math.PI / 2), M.s(10));
      renderStackMatrix(ctx, g, held, m, light);
    }
    if (this.fire > 0) for (let k = 0; k < 2; k++) g.particles.fx('flame', [this.pos[0] + rnd(-this.hw, this.hw), this.pos[1] + rnd(0, this.h), this.pos[2] + rnd(-this.hw, this.hw)], 1, 0.05, 0.2);
    if (this.name) ctx.labels.push({ text: this.name, pos: [this.pos[0], this.pos[1] + this.h + 0.5, this.pos[2]] });
    if (this.beam) {
      const c = this.beam.pos, layer = g.fxLayer('white');
      ctx.itemFx.quad([[c[0] - 0.1, c[1] + 1, c[2]], [this.pos[0] - 0.1, this.pos[1] + 2, this.pos[2]], [this.pos[0] + 0.1, this.pos[1] + 2, this.pos[2]], [c[0] + 0.1, c[1] + 1, c[2]]], [0, 0, 1, 1], layer, [1.2, 0.6, 1.4, 0.7]);
    }
  }

  toJSON() {
    if (this.deathT > 0) return null;
    return {
      t: 'mob', type: this.mobType, p: this.pos, yaw: this.yaw, health: this.health, baby: this.baby, size: this.size, tamed: this.tamed, sitting: this.sitting,
      sheared: this.sheared, woolColor: this.woolColor, name: this.name, persistent: this.persistent, home: this.home, charged: this.charged,
      profession: this.profession, level: this.level, xp: this.xp, trades: this.trades,
    };
  }
}

// Moves an entity without gravity handling (fliers/swimmers).
import { moveEntity } from './physics.js';
function import_move(e, dt) { moveEntity(e.world, e, e.vel[0] * dt, e.vel[1] * dt, e.vel[2] * dt); }

// Renders a held item using a part matrix (model units).
function renderStackMatrix(ctx, g, key, m, light) {
  if (g.itemDef(key)) g.renderItemAt(ctx, key, m, light);
}
export { renderStack };

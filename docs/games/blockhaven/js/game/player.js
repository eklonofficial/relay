// First-person player movement: walking, sprinting, sneaking, swimming, climbing, flying and spectating.
import { B, BLOCKS, SHAPE_OF, SHAPE, props } from '../data/blocks.js?v=muovqjts';
import { moveEntity } from '../entity/physics.js?v=muovqjts';
import { UNLOADED } from '../world/world.js?v=muovqjts';

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = [0, 80, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0; this.pitch = 0;
    this.hw = 0.3; this.h = 1.8; this.eye = 1.62;
    this.onGround = false; this.flying = false; this.sprinting = false; this.sneaking = false;
    this.inWater = false; this.inLava = false; this.headInWater = false; this.headInLava = false;
    this.climbing = false; this.inWeb = false;
    this.fallStart = null; this.lastJumpTap = -1;
    this.bobPhase = 0; this.bobAmount = 0; this.stepDist = 0;
    this.autoJump = true; this.stepHeight = 0.6;
    this.mode = 'survival';
    this.onStep = null; this.onSplash = null; this.onLand = null;
    this.speedMul = 1; this.jumpBoost = 0;
  }

  get canFly() { return this.mode === 'creative' || this.mode === 'spectator'; }
  get noClip() { return this.mode === 'spectator'; }

  blockAt(dy) { return this.world.getBlock(this.pos[0], this.pos[1] + dy, this.pos[2]); }

  jumpPressed(now) {
    // Elytra: press jump while falling to spread the wings.
    if (!this.gliding && !this.flying && !this.onGround && !this.inWater && !this.climbing && this.hasElytra && this.hasElytra()) { this.gliding = true; this.glideAcc = 0; this.lastJumpTap = -1; return; }
    if (this.canFly && now - this.lastJumpTap < 0.3) {
      if (this.mode !== 'spectator') { this.flying = !this.flying; this.vel[1] = 0; }
      this.lastJumpTap = -1;
    } else this.lastJumpTap = now;
  }

  // One tick of elytra flight (Minecraft's exact equations; m in blocks/tick; our pitch is
  // positive looking up, so it's negated).
  glideTick(m) {
    const f = -this.pitch;
    const lx = -Math.sin(this.yaw) * Math.cos(f), ly = -Math.sin(f), lz = -Math.cos(this.yaw) * Math.cos(f);
    const d6 = Math.hypot(lx, lz), d8 = Math.hypot(m[0], m[2]);
    let f4 = Math.cos(f); f4 = f4 * f4;
    m[1] += -0.08 + f4 * 0.06;
    if (m[1] < 0 && d6 > 0) { const d2 = m[1] * -0.1 * f4; m[1] += d2; m[0] += lx * d2 / d6; m[2] += lz * d2 / d6; }
    if (f < 0 && d6 > 0) { const d10 = d8 * -Math.sin(f) * 0.04; m[1] += d10 * 3.2; m[0] -= lx * d10 / d6; m[2] -= lz * d10 / d6; }
    if (d6 > 0) { m[0] += (lx / d6 * d8 - m[0]) * 0.1; m[2] += (lz / d6 * d8 - m[2]) * 0.1; }
    m[0] *= 0.99; m[1] *= 0.98; m[2] *= 0.99;
    if (this.boostT > 0) { this.boostT -= 0.05; m[0] += lx * 0.1 + (lx * 1.5 - m[0]) * 0.5; m[1] += ly * 0.1 + (ly * 1.5 - m[1]) * 0.5; m[2] += lz * 0.1 + (lz * 1.5 - m[2]) * 0.5; }
    this.glideTicks = (this.glideTicks || 0) + 1;
    if (this.glideTicks % 20 === 0 && this.onGlideSecond) this.onGlideSecond();
  }
  sampleMedium() {
    const w = this.world;
    const feet = this.blockAt(0.1), mid = this.blockAt(0.9);
    const isWater = id => id === B.WATER || id === B.SEAGRASS;
    this.inWater = isWater(feet) || isWater(mid);
    this.inLava = feet === B.LAVA || mid === B.LAVA;
    const head = w.getBlock(this.pos[0], this.pos[1] + this.eye, this.pos[2]);
    this.headInWater = isWater(head);
    this.headInLava = head === B.LAVA;
    const cl = id => id !== UNLOADED && BLOCKS[id] && BLOCKS[id].climbable;
    this.climbing = !this.flying && (cl(feet) || cl(mid));
    this.inWeb = feet === B.COBWEB || mid === B.COBWEB || feet === B.SWEET_BERRY_BUSH;
    const under = w.getBlock(this.pos[0], this.pos[1] - 0.1, this.pos[2]);
    this.ground = under;
    this.groundMeta = w.getMeta(this.pos[0], this.pos[1] - 0.1, this.pos[2]);
  }

  // Movement is a port of Minecraft Java 1.20's LivingEntity.travel / Player.aiStep, stepped at
  // exactly 20 ticks per second with the game's own constants, so walking, sprint-jumping,
  // strafing, ice, ladders, water and parkour timing all feel identical. Rendering interpolates
  // between ticks so it stays smooth at any frame rate.
  update(dt, input) {
    if (this.noClip) this.flying = true;
    // Something else moved us (teleport, respawn, dismount): don't interpolate from the old spot.
    if (!this.tickEnd || Math.abs(this.tickEnd[0] - this.pos[0]) + Math.abs(this.tickEnd[1] - this.pos[1]) + Math.abs(this.tickEnd[2] - this.pos[2]) > 1e-6) { this.prevPos = this.pos.slice(); this.renderPos = this.pos.slice(); }
    this.tickAcc = Math.min(0.25, (this.tickAcc || 0) + dt);
    const before = this.renderPos ? this.renderPos.slice() : this.pos.slice();
    while (this.tickAcc >= 0.05) {
      this.tickAcc -= 0.05;
      this.prevPos = this.pos.slice();
      this.tick(input);
    }
    this.tickEnd = this.pos.slice();
    const a = this.tickAcc / 0.05, pp = this.prevPos || this.pos;
    this.renderPos = [pp[0] + (this.pos[0] - pp[0]) * a, pp[1] + (this.pos[1] - pp[1]) * a, pp[2] + (this.pos[2] - pp[2]) * a];
    // Per-frame presentation: view bob, footsteps, eye height.
    const moving = input.forward || input.back || input.left || input.right;
    const moved = Math.hypot(this.renderPos[0] - before[0], this.renderPos[2] - before[2]);
    const walking = this.onGround && moving && moved > 0.0005 && !this.flying;
    this.bobAmount += ((walking ? 1 : 0) - this.bobAmount) * (1 - Math.exp(-10 * dt));
    this.distanceMoved = moved;
    if (walking) {
      this.bobPhase += moved * 1.9;
      this.stepDist += moved;
      if (this.stepDist > (this.sprinting ? 2.0 : 1.6)) { this.stepDist = 0; if (this.onStep && !this.sneaking) this.onStep(this.world.getBlock(this.pos[0], this.pos[1] - 0.2, this.pos[2])); }
    }
    const targetEye = this.sneaking ? 1.27 : 1.62;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-14 * dt));
  }
  eyePos() { const p = this.renderPos || this.pos; return [p[0], p[1] + this.eye, p[2]]; }

  tick(input) {
    const wasInWater = this.inWater;
    this.sampleMedium();
    const m = [this.vel[0] / 20, this.vel[1] / 20, this.vel[2] / 20];
    if (this.inWater && !wasInWater && m[1] < -0.2 && this.onSplash) this.onSplash();

    // ---- input (Player.aiStep) ----
    this.sneaking = input.sneak && !this.flying && !this.gliding;
    this.h = this.sneaking ? 1.5 : 1.8;
    let fwd = (input.forward ? 1 : 0) - (input.back ? 1 : 0), str = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    if (this.sneaking) { fwd *= 0.3; str *= 0.3; }
    if (this.usingItem) { fwd *= 0.2; str *= 0.2; }
    fwd *= 0.98; str *= 0.98;
    if (input.sprint && input.forward && !this.sneaking && !this.noSprint && !this.usingItem && !this.collidedH) this.sprinting = true;
    if (!input.forward || this.sneaking || this.noSprint || this.usingItem || (this.collidedH && !this.flying)) this.sprinting = false;

    // ---- jumping ----
    this.jumpDelay = Math.max(0, (this.jumpDelay || 0) - 1);
    if (input.jump && !this.flying && !this.gliding) {
      if (this.inWater || this.inLava) m[1] += 0.04;
      else if (this.onGround && this.jumpDelay === 0) {
        m[1] = 0.42 * this.jumpFactor() + this.jumpBoost * 0.1;
        if (this.sprinting) { m[0] += -Math.sin(this.yaw) * 0.2; m[2] += -Math.cos(this.yaw) * 0.2; }
        this.jumpDelay = 10;
        if (this.onJump) this.onJump();
      }
    } else if (!input.jump) this.jumpDelay = 0;

    const moveRelative = (speed) => {
      const l2 = fwd * fwd + str * str;
      if (l2 < 1e-7) return;
      let f = fwd, s2 = str;
      if (l2 > 1) { const l = Math.sqrt(l2); f /= l; s2 /= l; }
      f *= speed; s2 *= speed;
      // Forward is (-sin yaw, -cos yaw); left is (-cos yaw, sin yaw).
      m[0] += -Math.sin(this.yaw) * f - Math.cos(this.yaw) * s2;
      m[2] += -Math.cos(this.yaw) * f + Math.sin(this.yaw) * s2;
    };
    const baseSpeed = 0.1 * (this.sprinting ? 1.3 : 1) * this.speedMul;
    const px = this.pos[0], pz = this.pos[2], wasOnGround = this.onGround;
    let collidedWall = false;
    const move = () => {
      this.stepHeight = this.onGround || this.inWater ? 0.6 : 0;
      const dm = this.inWeb ? [m[0] * 0.25, m[1] * 0.05, m[2] * 0.25] : m.slice();
      this.vel = m; // moveEntity zeroes blocked components in place
      moveEntity(this.world, this, dm[0], dm[1], dm[2]);
      if (this.collidedH) collidedWall = true;
      if (this.inWeb) { m[0] = 0; m[1] = 0; m[2] = 0; }
    };

    if (this.gliding) {
      this.preSpeed = Math.hypot(m[0], m[2]); this.preVel = [m[0] * 20, m[1] * 20, m[2] * 20];
      this.glideTick(m);
      move();
      if (collidedWall && this.onKinetic) { const dmg = (this.preSpeed - Math.hypot(m[0], m[2])) * 10 - 3; if (dmg > 0) this.onKinetic(dmg); }
    } else if (this.flying) {
      const fly = 0.05 * this.speedMul * (this.mode === 'spectator' ? 1.5 : 1);
      if (input.jump) m[1] += fly * 3;
      if (input.sneak) m[1] -= fly * 3;
      moveRelative(this.sprinting ? fly * 2 : fly);
      move();
      m[0] *= 0.91; m[2] *= 0.91; m[1] *= 0.6;
    } else if (this.inWater) {
      const slow = this.sprinting ? 0.9 : 0.8;
      moveRelative(0.02);
      move();
      if (this.sprinting && this.headInWater) m[1] += (Math.sin(this.pitch) * 0.1 - m[1]) * 0.1 * (fwd > 0 ? 1 : 0); // swimming follows the view
      m[0] *= slow; m[1] *= 0.8; m[2] *= slow;
      m[1] -= 0.005;
      if (collidedWall && this.freeAbove(0.6)) m[1] = 0.3; // climb out onto a ledge
    } else if (this.inLava) {
      moveRelative(0.02);
      move();
      m[0] *= 0.5; m[1] *= 0.5; m[2] *= 0.5; m[1] -= 0.02;
      if (collidedWall && this.freeAbove(0.6)) m[1] = 0.3;
    } else {
      const bf = this.blockFriction();
      const fr = this.onGround ? bf * 0.91 : 0.91;
      moveRelative(this.onGround ? baseSpeed * (0.21600002 / (bf * bf * bf)) : (this.sprinting ? 0.026 : 0.02));
      if (this.climbing) {
        m[0] = Math.max(-0.15, Math.min(0.15, m[0])); m[2] = Math.max(-0.15, Math.min(0.15, m[2]));
        m[1] = Math.max(m[1], -0.15);
        if (this.sneaking && m[1] < 0) m[1] = 0;
      }
      const vy0 = m[1];
      move();
      // Slime blocks bounce you back up unless you sneak (the original keeps all the speed for mobs and players).
      if (this.onGround && vy0 < 0 && !this.sneaking && this.world.getBlock(this.pos[0], this.pos[1] - 0.05, this.pos[2]) === B.SLIME_BLOCK) m[1] = -vy0;
      if (this.climbing && (collidedWall || input.jump)) m[1] = 0.2;
      m[1] = (m[1] - 0.08) * 0.98;
      m[0] *= fr; m[2] *= fr;
      // Soul sand, honey, berry bushes...
      const sf = this.speedFactor();
      if (sf !== 1) { m[0] *= sf; m[2] *= sf; }
    }
    for (let i = 0; i < 3; i++) if (Math.abs(m[i]) < 0.003) m[i] = 0;
    this.collidedH = collidedWall;

    // Auto-jump (optional, like the setting in Bedrock/Java 1.12+).
    if (this.autoJump && collidedWall && this.onGround && fwd > 0 && !this.flying && !this.inWater && !this.sneaking && this.freeAbove(1.05, true)) m[1] = 0.42;

    if (this.gliding && (this.onGround || this.inWater || this.climbing || this.flying || (this.hasElytra && !this.hasElytra()))) this.gliding = false;
    if (this.onGround && this.flying && this.mode !== 'spectator') this.flying = false;
    this.vel = [m[0] * 20, m[1] * 20, m[2] * 20];

    // Fall damage tracking (gliding at a gentle sink rate doesn't accumulate it).
    if (this.gliding && m[1] > -0.5) this.fallStart = this.pos[1];
    if (this.onGround || this.inWater || this.climbing || this.flying || this.inWeb) {
      if (this.fallStart !== null && this.onLand && !this.flying) this.onLand(this.fallStart - this.pos[1], this.inWater);
      this.fallStart = null;
    } else if (m[1] < 0 && this.fallStart === null) this.fallStart = this.pos[1];
    else if (this.fallStart !== null && this.pos[1] > this.fallStart) this.fallStart = this.pos[1];
    void px; void pz; void wasOnGround;
  }
  // Slipperiness of the block under the feet (ice 0.98, slime 0.8, everything else 0.6).
  blockFriction() {
    const id = this.world.getBlock(this.pos[0], this.pos[1] - 0.5, this.pos[2]);
    if (id === UNLOADED || !id) return 0.6;
    if (id === B.PACKED_ICE) return (this.world.getMeta(this.pos[0], this.pos[1] - 0.5, this.pos[2]) & 1) ? 0.989 : 0.98;
    if (id === B.SLIME_BLOCK) return 0.8;
    return BLOCKS[id] && BLOCKS[id].slippery ? 0.98 : 0.6;
  }
  jumpFactor() { const id = this.world.getBlock(this.pos[0], this.pos[1] - 0.5, this.pos[2]); return id === B.HONEY_BLOCK ? 0.5 : 1; }
  speedFactor() {
    if (!this.onGround) return 1;
    const id = this.world.getBlock(this.pos[0], this.pos[1] - 0.1, this.pos[2]);
    if (id === UNLOADED || !id) return 1;
    const pr = props(id, this.world.getMeta(this.pos[0], this.pos[1] - 0.1, this.pos[2]));
    return pr.slow ? 1 - pr.slow : 1;
  }
  freeAbove(up, ahead = false) {
    const f = ahead ? [-Math.sin(this.yaw) * 0.4, -Math.cos(this.yaw) * 0.4] : [0, 0];
    const x = this.pos[0] + f[0], z = this.pos[2] + f[1], y = this.pos[1] + up;
    return !this.world.collide(x - this.hw, y, z - this.hw, x + this.hw, y + this.h, z + this.hw).length;
  }
}

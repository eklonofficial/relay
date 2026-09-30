// First-person player movement: walking, sprinting, sneaking, swimming, climbing, flying and spectating.
import { B, BLOCKS, SHAPE_OF, SHAPE, props } from '../data/blocks.js?v=munk2rp4';
import { moveEntity } from '../entity/physics.js?v=munk2rp4';
import { UNLOADED } from '../world/world.js?v=munk2rp4';

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
  eyePos() { return [this.pos[0], this.pos[1] + this.eye, this.pos[2]]; }
  get noClip() { return this.mode === 'spectator'; }

  blockAt(dy) { return this.world.getBlock(this.pos[0], this.pos[1] + dy, this.pos[2]); }

  jumpPressed(now) {
    if (this.canFly && now - this.lastJumpTap < 0.3) {
      if (this.mode !== 'spectator') { this.flying = !this.flying; this.vel[1] = 0; }
      this.lastJumpTap = -1;
    } else this.lastJumpTap = now;
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

  update(dt, input) {
    if (this.noClip) this.flying = true;
    const wasInWater = this.inWater;
    this.sampleMedium();
    if (this.inWater && !wasInWater && this.vel[1] < -4 && this.onSplash) this.onSplash();

    this.sneaking = input.sneak && !this.flying;
    this.h = this.sneaking ? 1.5 : 1.8;
    const moving = input.forward || input.back || input.left || input.right;
    if (input.sprint && input.forward && !this.sneaking && !this.noSprint) this.sprinting = true;
    if (!input.forward || this.sneaking || this.noSprint || (this.collidedH && !this.flying)) this.sprinting = false;

    let speed = this.flying ? (this.sprinting ? 21.6 : 10.9) : this.sneaking ? 1.3 : this.sprinting ? 5.6 : 4.317;
    if (this.mode === 'spectator') speed *= 1.5;
    if (!this.flying) {
      speed *= this.speedMul;
      if (this.inWater) speed *= this.sprinting ? 0.9 : 0.5;
      if (this.inLava) speed *= 0.35;
      if (this.inWeb) speed *= 0.18;
      if (this.ground !== UNLOADED && this.ground > 0 && this.onGround) {
        const pr = props(this.ground, this.groundMeta);
        if (pr.slow) speed *= 1 - pr.slow;
      }
      if (this.usingItem) speed *= 0.3;
    }
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = 0, wz = 0;
    if (input.forward) { wx += fx; wz += fz; }
    if (input.back) { wx -= fx; wz -= fz; }
    if (input.right) { wx += rx; wz += rz; }
    if (input.left) { wx -= rx; wz -= rz; }
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    const slippery = this.onGround && this.ground > 0 && this.ground !== UNLOADED && BLOCKS[this.ground].slippery;
    const accel = this.flying ? 10 : this.onGround ? (slippery ? 2.2 : 18) : this.inWater ? 6 : 4.5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel[0] += (wx * speed - this.vel[0]) * k;
    this.vel[2] += (wz * speed - this.vel[2]) * k;

    if (this.flying) {
      const vy = ((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * (this.mode === 'spectator' ? 12 : 9);
      this.vel[1] += (vy - this.vel[1]) * (1 - Math.exp(-10 * dt));
    } else if (this.inWater || this.inLava) {
      this.vel[1] -= (this.inLava ? 5 : 9) * dt;
      this.vel[1] *= Math.exp(-(this.inLava ? 6 : 3.5) * dt);
      if (input.jump) this.vel[1] = Math.min(this.vel[1] + 26 * dt, this.inLava ? 1.8 : 3.4);
      if (this.sprinting && this.inWater && this.headInWater) this.vel[1] += (-Math.sin(this.pitch) * -speed * 0.9 - this.vel[1]) * k;
      // Hop out of water onto a ledge.
      if (input.jump && this.collidedH) this.vel[1] = 4.2;
    } else if (this.climbing) {
      this.vel[1] = input.jump || (this.collidedH && moving) ? 2.4 : this.sneaking ? 0 : Math.max(this.vel[1] - 28 * dt, -3);
    } else {
      this.vel[1] -= 28 * dt;
      if (this.vel[1] < -60) this.vel[1] = -60;
      if (this.inWeb) this.vel[1] = Math.max(this.vel[1], -1);
      if (input.jump && this.onGround && this.jumpCooldown <= 0) {
        this.vel[1] = 8.6 + this.jumpBoost * 1.8;
        if (this.sprinting) { this.vel[0] += fx * 2.2; this.vel[2] += fz * 2.2; }
        this.jumpCooldown = 0.08;
        if (this.onJump) this.onJump();
      }
    }
    this.jumpCooldown = (this.jumpCooldown || 0) - dt;

    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vel[0]), Math.abs(this.vel[1]), Math.abs(this.vel[2])) * dt / 0.4));
    const sdt = dt / steps;
    const px = this.pos[0], pz = this.pos[2], wasOnGround = this.onGround;
    let hitWall = false;
    for (let i = 0; i < steps; i++) {
      this.stepHeight = this.flying || !this.onGround ? (this.inWater ? 0.6 : 0) : 0.6;
      if (!this.onGround && wasOnGround) this.stepHeight = 0.6;
      moveEntity(this.world, this, this.vel[0] * sdt, this.vel[1] * sdt, this.vel[2] * sdt);
      if (this.collidedH) hitWall = true;
    }
    this.collidedH = hitWall;
    if (this.onGround && this.flying && this.mode !== 'spectator') this.flying = false;

    // Fall tracking for fall damage.
    if (this.onGround || this.inWater || this.climbing || this.flying || this.inWeb) {
      if (this.fallStart !== null && this.onLand && !this.flying) this.onLand(this.fallStart - this.pos[1], this.inWater);
      this.fallStart = null;
    } else if (this.vel[1] < 0 && this.fallStart === null) this.fallStart = this.pos[1];
    else if (this.fallStart !== null && this.pos[1] > this.fallStart) this.fallStart = this.pos[1];

    if (this.autoJump && hitWall && (this.onGround || wasOnGround) && len > 0 && !this.flying && !this.inWater && !this.sneaking) {
      const save = this.pos.slice();
      this.pos[1] += 1.05;
      const probe = { pos: [this.pos[0] + wx * 0.4, this.pos[1], this.pos[2] + wz * 0.4], hw: this.hw, h: this.h, vel: [0, 0, 0] };
      this.pos = save;
      const free = !this.world.collide(probe.pos[0] - probe.hw, probe.pos[1], probe.pos[2] - probe.hw, probe.pos[0] + probe.hw, probe.pos[1] + probe.h, probe.pos[2] + probe.hw).length;
      if (free) this.vel[1] = 8.6;
    }

    const moved = Math.hypot(this.pos[0] - px, this.pos[2] - pz);
    const walking = this.onGround && moving && moved > 0.001;
    this.bobAmount += ((walking ? 1 : 0) - this.bobAmount) * (1 - Math.exp(-10 * dt));
    this.distanceMoved = moved;
    if (walking) {
      this.bobPhase += moved * 1.9;
      this.stepDist += moved;
      if (this.stepDist > (this.sprinting ? 2.0 : 1.6)) {
        this.stepDist = 0;
        if (this.onStep && !this.sneaking) this.onStep(this.world.getBlock(this.pos[0], this.pos[1] - 0.2, this.pos[2]));
      }
    }
    const targetEye = this.sneaking ? 1.32 : 1.62;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-14 * dt));
  }
}

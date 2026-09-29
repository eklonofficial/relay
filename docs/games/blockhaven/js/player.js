import { SOLID, B } from './blocks.js';
import { UNLOADED } from './world.js';

const HALF = 0.3, EPS = 1e-4;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = [0, 80, 0];
    this.vel = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.sprinting = false;
    this.sneaking = false;
    this.inWater = false;
    this.headInWater = false;
    this.eye = 1.62;
    this.walkDist = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.lastJumpTap = -1;
    this.stepDist = 0;
    this.onStep = null;
    this.onSplash = null;
    this.autoJump = true;
    this.hitWall = false;
  }

  get height() { return this.sneaking && !this.flying ? 1.5 : 1.8; }
  eyePos() { return [this.pos[0], this.pos[1] + this.eye, this.pos[2]]; }

  solidAt(x, y, z) {
    const id = this.world.getBlock(x, y, z);
    return id === UNLOADED || SOLID[id] === 1;
  }

  moveAxis(axis, d) {
    if (!d) return;
    this.pos[axis] += d;
    const hit = this.collidesAll(this.pos);
    if (!hit.length) return;
    if (axis === 1) {
      if (d < 0) { this.pos[1] = Math.max(...hit.map(b => b[1])) + 1 + EPS; this.onGround = true; }
      else this.pos[1] = Math.min(...hit.map(b => b[1])) - this.height - EPS;
    } else if (d > 0) this.pos[axis] = Math.min(...hit.map(b => b[axis])) - HALF - EPS;
    else this.pos[axis] = Math.max(...hit.map(b => b[axis])) + 1 + HALF + EPS;
    this.vel[axis] = 0;
    if (axis !== 1) this.hitWall = true;
  }

  collidesAll(p) {
    const h = this.height, out = [];
    const x0 = Math.floor(p[0] - HALF), x1 = Math.floor(p[0] + HALF);
    const y0 = Math.floor(p[1]), y1 = Math.floor(p[1] + h);
    const z0 = Math.floor(p[2] - HALF), z1 = Math.floor(p[2] + HALF);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (this.solidAt(x, y, z)) out.push([x, y, z]);
    }
    return out;
  }

  jumpPressed(now) {
    if (now - this.lastJumpTap < 0.3) { this.flying = !this.flying; this.vel[1] = 0; this.lastJumpTap = -1; }
    else this.lastJumpTap = now;
  }

  update(dt, input) {
    const w = this.world;
    const feet = w.getBlock(this.pos[0], this.pos[1] + 0.1, this.pos[2]);
    const wasInWater = this.inWater;
    this.inWater = feet === B.WATER || feet === B.LAVA || w.getBlock(this.pos[0], this.pos[1] + 0.9, this.pos[2]) === B.WATER;
    this.headInWater = w.getBlock(this.pos[0], this.pos[1] + this.eye, this.pos[2]) === B.WATER;
    if (this.inWater && !wasInWater && this.vel[1] < -4 && this.onSplash) this.onSplash();

    this.sneaking = input.sneak && !this.flying;
    const moving = input.forward || input.back || input.left || input.right;
    if (input.sprint && input.forward && !this.sneaking) this.sprinting = true;
    if (!input.forward || this.sneaking) this.sprinting = false;

    let speed = this.flying ? (this.sprinting ? 21 : 10.9) : this.sneaking ? 1.6 : this.sprinting ? 5.8 : 4.3;
    if (this.inWater && !this.flying) speed *= 0.5;

    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = 0, wz = 0;
    if (input.forward) { wx += fx; wz += fz; }
    if (input.back) { wx -= fx; wz -= fz; }
    if (input.right) { wx += rx; wz += rz; }
    if (input.left) { wx -= rx; wz -= rz; }
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    const accel = this.flying ? 12 : this.onGround ? 18 : this.inWater ? 6 : 4.5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel[0] += (wx * speed - this.vel[0]) * k;
    this.vel[2] += (wz * speed - this.vel[2]) * k;

    if (this.flying) {
      const vy = ((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * 9;
      this.vel[1] += (vy - this.vel[1]) * (1 - Math.exp(-10 * dt));
    } else if (this.inWater) {
      this.vel[1] -= 9 * dt;
      this.vel[1] *= Math.exp(-3.5 * dt);
      if (input.jump) this.vel[1] = Math.min(this.vel[1] + 26 * dt, 3.4);
    } else {
      this.vel[1] -= 28 * dt;
      if (this.vel[1] < -58) this.vel[1] = -58;
      if (input.jump && this.onGround) this.vel[1] = 8.6;
    }

    // Integrate in small steps so fast movement can't tunnel through blocks.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vel[0]), Math.abs(this.vel[1]), Math.abs(this.vel[2])) * dt / 0.4));
    const sdt = dt / steps;
    const px = this.pos[0], pz = this.pos[2];
    const wasOnGround = this.onGround;
    this.onGround = false;
    this.hitWall = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis(1, this.vel[1] * sdt);
      this.moveAxis(0, this.vel[0] * sdt);
      this.moveAxis(2, this.vel[2] * sdt);
    }
    if (this.onGround && this.flying) this.flying = false;

    // Auto-jump: walking into a one-block ledge with headroom above hops onto it.
    if (this.autoJump && this.hitWall && (this.onGround || wasOnGround) && len > 0 && !this.flying && !this.inWater && !this.sneaking) {
      const probe = [this.pos[0] + wx * 0.45, this.pos[1] + 1.05, this.pos[2] + wz * 0.45];
      if (!this.collidesAll(probe).length) this.vel[1] = 8.6;
    }

    const moved = Math.hypot(this.pos[0] - px, this.pos[2] - pz);
    const walking = this.onGround && moving && moved > 0.001;
    this.bobAmount += ((walking ? 1 : 0) - this.bobAmount) * (1 - Math.exp(-10 * dt));
    if (walking) {
      this.bobPhase += moved * 1.9;
      this.stepDist += moved;
      if (this.stepDist > (this.sprinting ? 2.0 : 1.6)) {
        this.stepDist = 0;
        const under = w.getBlock(this.pos[0], this.pos[1] - 0.2, this.pos[2]);
        if (this.onStep) this.onStep(under);
      }
    }
    const targetEye = this.sneaking ? 1.32 : 1.62;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-14 * dt));
  }
}

// Egg movement, one 30 Hz tick at a time (GDD §6). Pure and deterministic: the host, a client's
// prediction and the bots all run exactly this, so a replayed input stream reproduces the same path.
//
// Conventions: position is the egg's feet origin; its collision sphere (r 0.31) is centred 0.31 above.
// Yaw 0 looks towards -z, positive yaw turns left (three.js camera convention); pitch > 0 looks up.
import { PLAYER, CTRL } from './tuning.js?v=mux1bcsv';

const R = PLAYER.collideRadius;

export function makeBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: 0, jumpBuf: 0, climbing: null, prevCtrl: 0, padCooldown: 0 };
}

export const forward = (yaw, pitch = 0, out = [0, 0, 0]) => {
  const c = Math.cos(pitch); out[0] = -Math.sin(yaw) * c; out[1] = Math.sin(pitch); out[2] = -Math.cos(yaw) * c; return out;
};
// The eye (camera, and where shots start): the head's pivot plus 0.1 along the head's up axis, so
// looking down moves it forward and looking up moves it back, as in the reference.
export const eyePoint = (b, out = [0, 0, 0]) => {
  const sp = Math.sin(b.pitch || 0), cp = Math.cos(b.pitch || 0);
  out[0] = b.x + Math.sin(b.yaw) * sp * PLAYER.eyeUp; out[1] = b.y + PLAYER.headY + cp * PLAYER.eyeUp; out[2] = b.z + Math.cos(b.yaw) * sp * PLAYER.eyeUp;
  return out;
};

// Push the sphere at the body's position out of the world, up to 8 times (GDD §6.4). Returns
// false if it still collides afterwards. Upward-facing contact (normal y > 0.707) means ground.
// Step-up (GDD §6.3): a grounded egg touching a box whose top is at most 0.26 above its feet is
// lifted onto it instead of being pushed back, so stairs, ramps and slabs walk without jumping
// (a full block never does: its top is a whole unit up).
const STEP = { canStep: false };
function resolve(grid, b, ground) {
  for (let it = 0; it < 8; it++) {
    let moved = false;
    grid.overlaps(b.x, b.y + R, b.z, R, (nx, ny, nz, depth, kind, top) => {
      if (STEP.canStep && ny < 0.707 && top > b.y + 1e-4 && top - b.y <= PLAYER.stepUp && !grid.collides(b.x, top + 0.002 + R, b.z, R - 1e-3)) {
        b.y = top + 0.002; ground.hit = true; moved = true; ground.stepped = true; return false;
      }
      // Push a hair past the surface: landing exactly on it still counts as touching (by rounding),
      // and the same box would then be "resolved" over and over, never reaching the next one.
      depth += 1e-6;
      if (ny > 0 && ny <= 0.707) {
        // A steep edge (not ground): push out sideways only, or pressing into a wall's top edge
        // would lift the egg up it a little every tick.
        const h = Math.hypot(nx, nz), k = depth / (h * h);
        b.x += nx * k; b.z += nz * k;
      } else { b.x += nx * depth; b.y += ny * depth; b.z += nz * depth; }
      moved = true;
      if (ny > 0.707) ground.hit = true;
      if (ny < -0.707) ground.ceiling = true;
      return false; // re-query after each push: boxes share edges
    });
    if (!moved) return true;
  }
  return !grid.collides(b.x, b.y + R, b.z, R - 1e-4);
}

const G = { hit: false, ceiling: false, stepped: false };
// Move by (dx,dy,dz) with collision; returns the actual displacement in `out`.
function moveBody(grid, b, dx, dy, dz, out) {
  const sx = b.x, sy = b.y, sz = b.z;
  for (let scale = 1, tries = 0; tries < 6; tries++, scale *= 0.9) {
    b.x = sx + dx * scale; b.y = sy + dy * scale; b.z = sz + dz * scale;
    G.hit = false; G.ceiling = false; G.stepped = false;
    if (resolve(grid, b, G)) break;
    if (tries === 5) { b.x = sx; b.y = sy; b.z = sz; }
  }
  out[0] = b.x - sx; out[1] = b.y - sy; out[2] = b.z - sz;
  return G.hit;
}

const D = [0, 0, 0], F = [0, 0, 0];
// ctrl: CTRL bitmask. opts: { gravity (host option), ads (aiming, after the scope delay), quail }.
// Returns events this tick: 'jump' | 'land' | 'pad' | 'fall' (kill plane) or null.
export function stepBody(grid, b, ctrl, opts = {}) {
  const gravity = PLAYER.gravity * (opts.gravity ?? 1), ads = !!opts.ads;
  let event = null;
  const pressed = ctrl & ~b.prevCtrl; b.prevCtrl = ctrl;
  if (pressed & CTRL.jump) b.jumpBuf = PLAYER.jumpBufferTicks;
  else if (b.jumpBuf > 0) b.jumpBuf--;

  // Desired direction from WASD, rotated by yaw; diagonals are not faster.
  let ix = ((ctrl & CTRL.right) ? 1 : 0) - ((ctrl & CTRL.left) ? 1 : 0);
  let iz = ((ctrl & CTRL.down) ? 1 : 0) - ((ctrl & CTRL.up) ? 1 : 0);
  const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
  let wx = ix * cy + iz * sy, wz = -ix * sy + iz * cy;
  const len = Math.hypot(wx, wz);
  if (len > 0) { wx /= len; wz /= len; }
  // Sprinting (double-tapped forward): faster while running forwards, never while aiming.
  const sprint = (ctrl & CTRL.sprint) && (ctrl & CTRL.up) && !(ctrl & CTRL.down) && !ads;
  const accel = PLAYER.moveAccel * (ads ? PLAYER.adsMoveMult : sprint ? PLAYER.sprintMult : 1);

  // Ladders (GDD §6.5): attach by touching one while holding forward, roughly facing it.
  const ladder = grid.ladderAt(b.x, b.y + R, b.z, R);
  if (!b.climbing && ladder && (ctrl & CTRL.up)) {
    const fx = -sy, fz = -cy; // facing direction on the ground
    if (fx * ladder.fx + fz * ladder.fz > 0.5) b.climbing = ladder;
  }
  if (b.climbing) {
    if (!ladder || (b.jumpBuf > 0 && (pressed & CTRL.jump))) {
      // Off the top or bottom, or a hop off: a small push onto the ledge / away.
      if (ladder) { b.vy = PLAYER.ladderJumpOff; b.jumpBuf = 0; }
      else if (b.vy > 0) { b.vx += b.climbing.fx * 0.06; b.vz += b.climbing.fz * 0.06; b.vy = Math.max(b.vy, 0.04); }
      b.climbing = null;
    } else {
      const climb = (ctrl & CTRL.up) ? 1 : (ctrl & CTRL.down) ? -1 : 0;
      b.vy += climb * PLAYER.ladderAccel; b.vy *= 0.5;
      // Sideways input still works (and backing off at the bottom detaches).
      const side = ix; b.vx += side * cy * accel * 0.5; b.vz += -side * sy * accel * 0.5;
      if (b.onGround > 0 && climb < 0) b.climbing = null;
    }
  }
  if (!b.climbing) {
    b.vx += wx * accel; b.vz += wz * accel;
    b.vy -= gravity;
    if (b.vy < -PLAYER.terminalFall) b.vy = -PLAYER.terminalFall;
    // Jump (with coyote time and the jump buffer).
    if (b.jumpBuf > 0 && b.onGround > 0) {
      b.vy = PLAYER.jumpVel * (ads ? PLAYER.adsJumpMult : 1);
      b.onGround = 0; b.jumpBuf = 0; event = 'jump';
    }
  }
  // Cap the displacement per tick.
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  if (speed > PLAYER.maxStep) { const k = PLAYER.maxStep / speed; b.vx *= k; b.vy *= k; b.vz *= k; }

  const wasGround = b.onGround > 0;
  // Only an egg that actually stood on something last tick may step (not during coyote time).
  STEP.canStep = b.onGround === PLAYER.coyoteTicks && b.vy <= 0.01 && !b.climbing;
  const ground = moveBody(grid, b, b.vx, b.vy, b.vz, D);
  STEP.canStep = false;
  // A step-up lift isn't vertical speed (it would trigger the slope slow-down and fling the egg).
  if (G.stepped && D[1] > 0) D[1] = 0;
  b.vx = D[0]; b.vy = D[1]; b.vz = D[2];
  if (G.ceiling && b.vy > 0) b.vy = 0;
  // Walking up a slope/step loses some horizontal speed.
  if (ground && b.vy > 0) {
    const l = Math.hypot(b.vx, b.vy, b.vz), k = 1 - (b.vy / l) * 0.5;
    b.vx *= k; b.vz *= k;
  }
  b.vx *= PLAYER.friction; b.vz *= PLAYER.friction;
  if (b.climbing) b.vy *= PLAYER.friction;

  if (ground) { if (!wasGround && event !== 'jump') event = 'land'; b.onGround = PLAYER.coyoteTicks; if (b.vy < 0) b.vy = 0; }
  else if (b.onGround > 0) b.onGround--;

  // Jump pads (GDD §6.6).
  if (b.padCooldown > 0) b.padCooldown--;
  else if (ground && grid.padUnder(b.x, b.y, b.z)) { b.vy = PLAYER.jumpPadVel; b.onGround = 0; b.padCooldown = 6; event = 'pad'; }

  // Invisible walls at the map edges; the kill plane below.
  b.x = Math.max(0.1, Math.min(grid.w - 0.1, b.x)); b.z = Math.max(0.1, Math.min(grid.d - 0.1, b.z));
  if (b.y < PLAYER.killPlaneY) event = 'fall';
  return event;
}

// Is the body moving in a way that breaks the spawn shield (any movement input)?
export const movementInput = ctrl => (ctrl & (CTRL.up | CTRL.down | CTRL.left | CTRL.right | CTRL.jump)) !== 0;
export { F as scratchForward };

// A player's hands: weapons, spread, fire/recoil/reload/swap, melee and grenade charge (GDD §8–11).
// One tick at a time, deterministic (spread rolls come from the player's seeded LCG), so the host
// and a client's prediction fire the same shots from the same inputs.
//
// Countdown units, exactly as the GDD lists them:
//   rof, burst gaps, scope delay, swap, melee           ticks       (−1 per tick)
//   recoil, reload, grenade throw/cancel lock, shield   1/60 s      (−2 per tick)
import { WEAPONS, PRIMARIES, SECONDARY, MELEE, GRENADE, PLAYER, CTRL } from './tuning.js?v=muwpta38';
import { forward, eyePoint } from './movement.js?v=muwpta38';

// Per-player LCG (GDD §8.3): seed = (seed·9301 + 49297) mod 233280.
export const lcg = s => (s * 9301 + 49297) % 233280;
export function rand(h) { h.seed = lcg(h.seed); return h.seed / 233280; }

export function makeHands(primary = 'yolk47', seed = 1, disabled = []) {
  const p = disabled.includes(primary) ? null : primary;
  const slots = [];
  if (p) slots.push(fullSlot(p));
  slots.push(fullSlot(SECONDARY));
  return {
    slots, cur: 0, seed: (seed >>> 0) % 233280,
    rof: 0, recoil: 0, reload: 0, reloadRounds: 0, swap: 0, swapTo: -1, scopeDelay: 0, scopeBlocked: false,
    burst: 0, burstGap: 0, queued: 0, triggerDown: false,
    melee: 0, meleeWindup: 0,
    grenades: GRENADE.startCount, charging: false, power: 0, throwLock: 0,
    moveSpread: 0, shootSpread: WEAPONS[slots[0].id].acc[0], recoverRate: 0,
    ads: false, inspect: 0,
  };
}
function fullSlot(id) {
  const w = WEAPONS[id];
  let mag = w.mag, store = w.store;
  if (w.burst) { mag -= mag % w.burst; store = Math.ceil(store / w.burst) * w.burst; }
  return { id, mag, store };
}
export const weaponOf = h => WEAPONS[h.slots[h.cur].id];
export const slotOf = h => h.slots[h.cur];

// Refill (respawn / Restock). keepGrenades: grenades = max(current, 1).
export function refill(h, grenadesTo = null) {
  for (const s of h.slots) Object.assign(s, fullSlot(s.id));
  if (grenadesTo !== null) h.grenades = grenadesTo;
}

// Reset transient state on spawn: primary in hand, timers clear.
export function readyHands(h) {
  h.cur = 0; h.rof = 0; h.recoil = 0; h.reload = 0; h.swap = 0; h.swapTo = -1; h.scopeDelay = 0; h.scopeBlocked = false;
  h.burst = 0; h.burstGap = 0; h.queued = 0; h.melee = 0; h.meleeWindup = 0; h.charging = false; h.power = 0; h.throwLock = 0;
  h.moveSpread = 0; h.shootSpread = weaponOf(h).acc[0]; h.recoverRate = 0; h.ads = false; h.triggerDown = false;
}

const busy = h => h.reload > 0 || h.swap > 0 || h.throwLock > 0 || h.melee > 0 || h.charging;

// What happened this tick, for the caller (the match) to act on.
export class HandEvents {
  constructor() { this.shots = []; this.reset(); }
  reset() { this.shots.length = 0; this.fired = false; this.dry = false; this.reloadStart = false; this.reloadDone = false; this.swapped = false; this.meleeHit = false; this.meleeSwing = false; this.thrown = null; this.chargeStart = false; this.cancelled = false; this.broke = false; return this; }
}

const DIR = [0, 0, 0];
// One tick. body: the movement body (velocities, view). ctrl: CTRL bits. shielded: spawn shield up.
// Returns HandEvents; shots[] entries are { x, y, z, dx, dy, dz, weapon, tracer }.
export function stepHands(h, body, ctrl, prevCtrl, shielded, ev = new HandEvents()) {
  ev.reset();
  const pressed = ctrl & ~prevCtrl, released = prevCtrl & ~ctrl;
  // Countdowns.
  if (h.rof > 0) h.rof--;
  if (h.recoil > 0) h.recoil = Math.max(0, h.recoil - 2);
  if (h.throwLock > 0) h.throwLock = Math.max(0, h.throwLock - 2);
  if (h.inspect > 0) h.inspect--;
  if (h.reload > 0) {
    h.reload = Math.max(0, h.reload - 2);
    if (h.reload === 0) { const s = slotOf(h), n = Math.min(h.reloadRounds, s.store); s.mag += n; s.store -= n; ev.reloadDone = true; h.scopeBlocked = false; }
  }
  if (h.swap > 0) {
    h.swap--;
    if (h.swap === PLAYER.swapEquipTicks && h.swapTo >= 0) { h.cur = h.swapTo; h.swapTo = -1; h.shootSpread = Math.max(h.shootSpread, weaponOf(h).acc[0]); ev.swapped = true; }
  }
  if (h.melee > 0) {
    h.melee--;
    if (h.meleeWindup > 0 && --h.meleeWindup === 0) ev.meleeHit = true;
    // Re-equip after the swing takes half an equip time (counted in the swap timer).
    if (h.melee === 0) h.swap = Math.max(h.swap, Math.ceil(PLAYER.swapEquipTicks / 2));
  }

  // Aim (ADS) engages after the scope delay; reloading cancels it until the reload ends.
  const scopeHeld = (ctrl & CTRL.scope) !== 0;
  if (!scopeHeld) { h.scopeDelay = PLAYER.scopeDelayTicks; h.scopeBlocked = false; }
  else if (h.scopeDelay > 0) h.scopeDelay--;
  h.ads = scopeHeld && h.scopeDelay === 0 && !h.scopeBlocked && h.reload === 0 && h.swap === 0 && h.melee === 0;

  const w = weaponOf(h), slot = slotOf(h);
  if (pressed & CTRL.fire) h.queued = 6; else if (h.queued > 0) h.queued--;
  if (released & CTRL.fire) h.triggerDown = false;

  // Grenade (GDD §11): hold to charge, release to throw; fire or melee cancels.
  if ((pressed & CTRL.grenade) && h.grenades > 0 && !h.charging && h.throwLock === 0 && h.melee === 0 && h.swap === 0 && h.reload === 0) {
    h.charging = true; h.power = GRENADE.chargeStart; ev.chargeStart = true; h.queued = 0;
  }
  if (h.charging) {
    if (pressed & (CTRL.fire | CTRL.melee)) {
      h.charging = false; h.power = 0; h.throwLock = GRENADE.cancelLock; ev.cancelled = true; h.queued = 0;
      return finishSpread(h, body, w, ev);
    }
    h.power = Math.min(1, h.power + GRENADE.chargePerTick);
    if (!(ctrl & CTRL.grenade)) {
      h.charging = false; h.grenades--; h.throwLock = GRENADE.throwLock;
      ev.thrown = Math.max(0, h.power); h.power = 0; ev.broke = true;
    }
    return finishSpread(h, body, w, ev);
  }

  // Melee (GDD §10).
  if ((pressed & CTRL.melee) && h.recoil === 0 && h.reload === 0 && h.swap === 0 && h.melee === 0 && !shielded) {
    h.melee = MELEE.lock; h.meleeWindup = MELEE.windup; h.recoil = MELEE.recoil; ev.meleeSwing = true; h.burst = 0; h.queued = 0;
  }
  // Swap (GDD §8.6): cancels a reload in progress.
  if ((pressed & CTRL.swap) && h.slots.length > 1 && h.swap === 0 && h.melee === 0 && h.throwLock === 0 && h.burst === 0) {
    h.reload = 0; h.swapTo = (h.cur + 1) % h.slots.length; h.swap = PLAYER.swapStowTicks + PLAYER.swapEquipTicks; h.queued = 0;
  }
  // Reload.
  const wantReload = (pressed & CTRL.reload) !== 0;
  if (wantReload && canReload(h)) startReload(h, ev);

  // Fire (GDD §8.5). Bursts keep going once started.
  if (h.burst > 0) {
    if (h.burstGap > 0) h.burstGap--;
    if (h.burstGap === 0) {
      if (slot.mag > 0 && !shielded) { shoot(h, body, w, slot, ev); h.burst--; h.burstGap = w.burstGap; if (h.burst === 0) h.rof = w.rof; }
      else h.burst = 0;
    }
  } else {
    const trigger = w.auto ? (ctrl & CTRL.fire) !== 0 : h.queued > 0 && !h.triggerDown;
    const ready = !busy(h) && h.rof <= 0;
    if (trigger && ready && shielded) { h.queued = 0; } // the shield auto-releases the trigger
    else if (trigger && ready) {
      if (slot.mag > 0) {
        if (!w.auto) { h.triggerDown = true; h.queued = 0; }
        if (w.burst) { h.burst = w.burst; h.burstGap = 0; shoot(h, body, w, slot, ev); h.burst--; h.burstGap = w.burstGap; }
        else { shoot(h, body, w, slot, ev); h.rof = w.rof; }
      } else if (slot.store > 0) { if (canReload(h)) startReload(h, ev); h.queued = 0; h.triggerDown = true; }
      else { ev.dry = true; h.queued = 0; h.triggerDown = true; h.rof = w.rof; }
    }
  }
  return finishSpread(h, body, w, ev);
}

function canReload(h) {
  const s = slotOf(h), w = WEAPONS[s.id];
  return h.recoil === 0 && h.reload === 0 && h.swap === 0 && h.throwLock === 0 && h.melee === 0 && h.burst === 0 && !h.charging && s.mag < w.mag && s.store > 0;
}
function startReload(h, ev) {
  const s = slotOf(h), w = WEAPONS[s.id];
  h.reloadRounds = Math.min(w.mag - s.mag, s.store);
  h.reload = s.mag === 0 ? w.reload[1] : w.reload[0];
  h.reloadWasLong = s.mag === 0 && w.reload[0] !== w.reload[1];
  h.scopeBlocked = true; h.ads = false; ev.reloadStart = true;
}

const EYE = [0, 0, 0];
function shoot(h, body, w, slot, ev) {
  slot.mag--;
  h.recoil = w.recoil;
  const spread = currentSpread(h, w);
  const [ox, oy, oz] = eyePoint(body, EYE);
  const n = w.pellets || 1;
  for (let i = 0; i < n; i++) {
    let yaw, pitch;
    if (w.pellets) { yaw = body.yaw + (rand(h) * 2 - 1) * spread; pitch = body.pitch + (rand(h) * 2 - 1) * spread * w.vSpreadMul; }
    else { yaw = body.yaw + (rand(h) - 0.5) * spread; pitch = body.pitch + (rand(h) - 0.5) * spread; rand(h); /* roll */ }
    forward(yaw, pitch, DIR);
    ev.shots.push({ x: ox, y: oy, z: oz, dx: DIR[0], dy: DIR[1], dz: DIR[2], weapon: slot.id, tracer: w.tracer ? (slot.mag % w.tracer === 0) : false });
  }
  // Bloom (GDD §8.3).
  const [, accMin, loss, recover] = w.acc, m = h.ads ? w.ads : 1;
  h.shootSpread = Math.min(h.shootSpread + loss * m, accMin * m);
  h.recoverRate = -8 * recover;
  ev.fired = true;
}

export function currentSpread(h, w = weaponOf(h)) {
  let s = h.moveSpread * (w.moveMod ?? 1) + h.shootSpread;
  if (w.absMinAcc) s = Math.min(s, w.absMinAcc);
  return s;
}

// Per-tick spread update (GDD §8.3), after this tick's actions.
function finishSpread(h, body, w, ev) {
  const [accMax, accMin, , recover] = w.acc, m = h.ads ? w.ads : 1;
  const lateral = Math.hypot(body.vx, body.vz) * 14.41;
  const vertical = Math.min(1, Math.abs(body.vy) * 14.41);
  const notReady = (h.reload > 0 && w.reloadBloom !== false) || h.swap > 0 || h.throwLock > 0 || h.charging ? 1 : 0;
  const target = (lateral + (body.climbing ? 0 : vertical) + notReady) * accMin * m;
  h.moveSpread = h.moveSpread < target ? target : Math.max(h.moveSpread - recover, target);
  h.recoverRate = Math.min(h.recoverRate + recover, recover);
  h.shootSpread = Math.max(h.shootSpread - Math.max(h.recoverRate, 0), accMax * m);
  return ev;
}

// Grenade launch velocity (GDD §11, [DESIGN]): 0.10 + 0.25·power along the view, +0.1 up, plus the thrower's velocity.
export function grenadeLaunch(body, power) {
  const s = GRENADE.throwSpeed[0] + (GRENADE.throwSpeed[1] - GRENADE.throwSpeed[0]) * power;
  const f = forward(body.yaw, body.pitch);
  return { x: body.x + f[0] * 0.3, y: body.y + PLAYER.eyeY + f[1] * 0.3, z: body.z + f[2] * 0.3, vx: f[0] * s + body.vx, vy: f[1] * s + GRENADE.upBias * s + body.vy, vz: f[2] * s + body.vz };
}

export { PRIMARIES };

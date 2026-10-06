// Aim assist for trackpads and gamepads (the compensation console shooters give controller players).
// Two subtle effects, only on an enemy the player can actually see, only close to the crosshair:
//
// - Friction: the look speed eases off (to at most a third slower) as the crosshair nears the target,
//   so a small trackpad swipe doesn't sail past it.
// - Tracking: while the player is moving or aiming (never when idle), the view follows part of the
//   target's drift across it (its own movement plus ours), so a strafing egg doesn't slide out from
//   under the crosshair. The player still has to put it there and keep it there.
//
// It never snaps or pulls onto a target from outside the small cone around the crosshair, and it
// only changes the look angles the player's own input produced, so the simulation stays the same
// for everyone. Pure, so it is tested without a browser.

export const ASSIST = {
  range: 40,          // units: no assist beyond this
  cone: 0.105,        // radians (~6°): the widest the assist ever reaches from the crosshair
  minCone: 0.035,     // radians (~2°): the narrowest, for far targets
  coneScale: 2.2,     // the cone is this many times the target's own angular radius (an egg is ~0.3 across)
  slow: 0.32,         // friction at the target's centre: look speed × (1 − slow)
  track: 0.35,        // share of the target's drift followed from the hip
  adsTrack: 0.5,      // ... and while aiming down sights
  maxRate: 2.5,       // radians/s: drift faster than this (a teleport, a respawn) is ignored
};

// Per gun: how wide the assist reaches (cone), how much it slows the look (slow) and how much of a
// target's drift it follows (track), as multiples of the above. Close-range guns get the most help
// (fights are fast and close); the snipers get a narrow, gentle pull (a precision shot should be
// yours); the Yolkzooka only slows the look a little (it leads its target, so tracking would hurt).
export const ASSIST_BY_GUN = {
  doubleYolker: { cone: 1.35, slow: 1.15, track: 1.25 }, beater: { cone: 1.15, slow: 1.05, track: 1.15 },
  yolk47: { cone: 1, slow: 1, track: 1 }, triBoil: { cone: 1, slow: 1.05, track: 1 }, peck9mm: { cone: 1.1, slow: 1, track: 1.05 },
  cageFree: { cone: 0.7, slow: 0.8, track: 0.6 }, poacher: { cone: 0.55, slow: 0.7, track: 0.4 }, yolkzooka: { cone: 0.8, slow: 0.6, track: 0 },
};
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// st: per-player memory between frames ({}); cam: { x, y, z, yaw, pitch } (the eye); targets:
// [{ id, x, y, z, visible?() }] (enemy centres); o: { ads, active, gun }. Returns { slow, dyaw, dpitch, id }:
// the look-speed multiplier for this frame and the tracking turn to add.
export function aimAssist(st, cam, targets, dt, o = {}) {
  const out = { slow: 1, dyaw: 0, dpitch: 0, id: null }, g = ASSIST_BY_GUN[o.gun] || ASSIST_BY_GUN.yolk47;
  let best = null;
  const cp = Math.cos(cam.pitch);
  for (const t of targets) {
    const dx = t.x - cam.x, dy = t.y - cam.y, dz = t.z - cam.z, flat = Math.hypot(dx, dz), d = Math.hypot(flat, dy);
    if (d < 0.5 || d > ASSIST.range) continue;
    const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, flat);
    const err = Math.hypot(wrap(yaw - cam.yaw) * cp, pitch - cam.pitch);
    const cone = clamp(Math.atan(0.3 / d) * ASSIST.coneScale, ASSIST.minCone, ASSIST.cone) * g.cone;
    const k = err / cone;
    if (k >= 1 || (best && k >= best.k)) continue;
    if (t.visible && !t.visible()) continue;
    best = { id: t.id, yaw, pitch, k };
  }
  if (!best) { st.id = null; return out; }
  const pull = 1 - best.k * best.k;                   // 1 on the target, 0 at the cone's edge
  out.slow = 1 - Math.min(0.4, ASSIST.slow * g.slow) * pull; out.id = best.id;
  if (st.id === best.id && dt > 0 && o.active) {
    const wy = wrap(best.yaw - st.yaw) / dt, wp = (best.pitch - st.pitch) / dt;
    if (Math.abs(wy) < ASSIST.maxRate && Math.abs(wp) < ASSIST.maxRate) {
      const k = Math.min(0.6, (o.ads ? ASSIST.adsTrack : ASSIST.track) * g.track) * pull;
      out.dyaw = wy * dt * k; out.dpitch = wp * dt * k * 0.5;
    }
  }
  st.id = best.id; st.yaw = best.yaw; st.pitch = best.pitch;
  return out;
}

// Whether assist is on: 'on', 'off', or 'auto' (Chromebooks, whose players are mostly on the
// trackpad, and anyone playing with a gamepad).
export function assistOn(setting, ua, padActive) {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return /\bCrOS\b/.test(ua || '') || !!padActive;
}

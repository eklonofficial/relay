// The kill replay: when you're cracked, a slow-motion instant replay of how it happened. The recorder
// keeps the last few seconds of every egg's pose and every shot; the planner finds the shot that
// cracked you and lays out the replay: a second following your killer, then slow motion as the
// bullet (or rocket) leaves their gun and travels to you, then your egg bursting.
// Pure apart from what it's fed, so it is tested without a browser.

const KEEP = 150; // ticks (five seconds)

export class Recorder {
  constructor() { this.frames = []; this.shots = []; this.last = -1; }
  clear() { this.frames.length = 0; this.shots.length = 0; this.last = -1; }
  // Once per sim tick: every player's [x, y, z, yaw, pitch, alive, scale].
  record(match) {
    const t = match.tick; if (t === this.last) return; this.last = t;
    const pl = new Map();
    for (const p of match.players.values()) pl.set(p.id, [p.body.x, p.body.y, p.body.z, p.body.yaw, p.body.pitch, p.alive ? 1 : 0, p.power?.quailEgg > 0 ? 0.5 : 1]);
    this.frames.push({ tick: t, pl });
    while (this.frames.length && this.frames[0].tick < t - KEEP) this.frames.shift();
    while (this.shots.length && this.shots[0].tick < t - KEEP) this.shots.shift();
  }
  // A shot or rocket launched: { id, x, y, z, dx, dy, dz, len, w }.
  shot(tick, e) { this.shots.push({ tick, id: e.id, x: e.x, y: e.y, z: e.z, dx: e.dx, dy: e.dy, dz: e.dz, len: e.len ?? 60, w: e.w }); }
  // A player's pose at fractional tick t (interpolated), or null if not recorded or not alive.
  pose(id, t) {
    const f = this.frames; if (!f.length) return null;
    let i = f.length - 1; while (i > 0 && f[i].tick > t) i--;
    const a = f[i].pl.get(id), b = (f[i + 1] || f[i]).pl.get(id);
    if (!a || !a[5]) return null;
    if (!b || !b[5] || f[i + 1] === undefined) return a.slice();
    const k = Math.max(0, Math.min(1, (t - f[i].tick) / Math.max(1, f[i + 1].tick - f[i].tick)));
    let dy = b[3] - a[3]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + dy * k, a[4] + (b[4] - a[4]) * k, 1, a[6]];
  }
}

// Lay out the replay of `victim` cracked by `killer` at deathTick. at: where the victim was hit
// (their centre). vel: projectile speed of the killing weapon (units per tick). Returns
// { start, shotTick, hitTick, deathTick, end, origin, dir, dist, slow } (shotTick null for a kill with no
// projectile to follow: melee, a Cluck Bomb), or null when there is nothing to replay.
export function planReplay(rec, killer, deathTick, weapon, vel, at) {
  if (!rec.frames.length || killer == null) return null;
  const oldest = rec.frames[0].tick;
  let best = null, bestD = Infinity;
  for (const s of rec.shots) {
    if (s.id !== killer || s.tick > deathTick || s.tick < deathTick - 90) continue;
    if (weapon !== 'yolkzooka' && s.w !== weapon) continue;
    const t = (at[0] - s.x) * s.dx + (at[1] - s.y) * s.dy + (at[2] - s.z) * s.dz;
    if (t <= 0) continue;
    const d = Math.hypot(s.x + s.dx * t - at[0], s.y + s.dy * t - at[1], s.z + s.dz * t - at[2]) + Math.abs(s.tick + t / vel - deathTick) * 0.01;
    if (d < bestD) { bestD = d; best = s; }
  }
  const plan = { deathTick, hitTick: deathTick, shotTick: null, origin: null, dir: null, dist: 0, slow: 0.35 };
  if (best && bestD < 4) {
    const t = (at[0] - best.x) * best.dx + (at[1] - best.y) * best.dy + (at[2] - best.z) * best.dz;
    plan.shotTick = best.tick; plan.origin = [best.x, best.y, best.z]; plan.dir = [best.dx, best.dy, best.dz]; plan.dist = t;
    // The shot gets its own flight in the replay (a close shot can land in the tick it's fired), and
    // the slow-motion stretch from just before it to the hit lasts about two seconds.
    plan.hitTick = Math.max(deathTick, best.tick + Math.max(3, t / vel));
    plan.slow = Math.max(0.06, Math.min(0.3, (plan.hitTick - best.tick + 3) / (30 * 1.8)));
  }
  const from = plan.shotTick ?? deathTick;
  plan.start = Math.max(oldest, from - 36);
  plan.end = plan.hitTick + 12;
  return plan;
}
// Playback speed at replay tick t: real time until just before the shot, slow motion to the hit,
// then a lingering half-speed look at the burst.
export function replayRate(plan, t) {
  if (plan.shotTick !== null && t >= plan.shotTick - 3 && t < plan.hitTick) return plan.slow;
  if (plan.shotTick === null && t >= plan.deathTick - 12 && t < plan.deathTick) return 0.3;
  return t >= plan.hitTick ? 0.35 : 1;
}
// Where the killing projectile is at replay tick t ([x, y, z]), or null before it's fired / after.
export function projectileAt(plan, t) {
  if (plan.shotTick === null || t < plan.shotTick || t > plan.hitTick) return null;
  const k = (t - plan.shotTick) / (plan.hitTick - plan.shotTick);
  const d = plan.dist * Math.min(1, k);
  return [plan.origin[0] + plan.dir[0] * d, plan.origin[1] + plan.dir[1] * d, plan.origin[2] + plan.dir[2] * d];
}

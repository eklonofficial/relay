// Game modes (GDD §14): Free For All, Teams, Spatula Snatch, Rule the Roost. Each mode answers the
// match's questions (teams, spawns, scoring) and keeps its own objective state, which the HUD and the
// network read through state().
import { ROOST, SPATULA, PLAYER } from './tuning.js?v=muwxo6oz';

export const TEAM_NAMES = ['', 'Blue', 'Red'];

class FFA {
  constructor(m) { this.m = m; this.teams = false; }
  assignTeam() { return 0; }
  spawnPoints() { return this.m.map.spawns; }
  canSpawn() { return true; }
  onKill() {}
  step() {}
  state() { return { k: 'ffa' }; }
  switchTeam() { return 'This mode has no teams.'; }
}

class Teams extends FFA {
  constructor(m) { super(m); this.teams = true; this.score = [0, 0, 0]; }
  counts() { const c = [0, 0, 0]; for (const p of this.m.players.values()) c[p.team]++; return c; }
  assignTeam() { const c = this.counts(); return c[1] <= c[2] ? 1 : 2; }
  spawnPoints(p) {
    const own = this.m.map.spawns.filter(s => s.team === p.team);
    return own.length ? own : this.m.map.spawns;
  }
  onKill(killer) { this.score[killer.team]++; }
  state() { return { k: 'teams', s: this.score.slice(1) }; }
  // Only onto the smaller team, unless the host's game says otherwise (GDD §14.2).
  switchTeam(p, force = false) {
    const o = this.m.options;
    if (o.noTeamChange && !force) return 'Team changes are off in this game.';
    const to = p.team === 1 ? 2 : 1, c = this.counts();
    if (!force && !o.private && c[to] >= c[p.team]) return "Let's keep it fair! The other team has enough players already. Try again later!";
    p.team = to; p.teamSwitches++;
    p.kills = 0;
    if (p.teamSwitches > 1) { p.streak = 0; p.score = 0; }
    if (p.alive) this.m.kill(p, null, 'switch');
    this.m.emit({ t: 'team', id: p.id, team: to });
    return null;
  }
}

class Spatula extends Teams {
  constructor(m) {
    super(m);
    this.score = [0, 0, 0];
    this.spat = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, carrier: -1, held: 0, last: 0, rest: false };
    this.respawn();
  }
  respawn() {
    const pts = this.m.map.spatulaSpawns.length ? this.m.map.spatulaSpawns : this.m.map.spawns;
    const s = pts[Math.floor(this.m.rnd() * pts.length)];
    Object.assign(this.spat, { x: s.x, y: s.y + 0.3, z: s.z, vx: 0, vy: 0, vz: 0, carrier: -1, held: 0, rest: false });
    this.m.emit({ t: 'spatula', k: 'spawn' });
  }
  drop(p) {
    const s = this.spat;
    Object.assign(s, { x: p.body.x, y: p.body.y + 0.5, z: p.body.z, vx: p.body.vx, vy: p.body.vy + SPATULA.hop, vz: p.body.vz, carrier: -1, held: 0, rest: false });
    this.m.emit({ t: 'spatula', k: 'drop', id: p.id });
  }
  onLeave(p) { if (this.spat.carrier === p.id) this.drop(p); }
  onKill(killer, victim) {
    if (this.spat.carrier === victim.id) this.drop(victim);
    if (this.spat.held && this.spat.held === killer.team) {
      this.score[killer.team]++;
      this.m.emit({ t: 'score', team: killer.team, s: this.score[killer.team] });
      const limit = this.m.options.scoreLimit;
      if (limit && this.score[killer.team] >= limit) { this.m.emit({ t: 'win', team: killer.team }); this.score = [0, 0, 0]; this.respawn(); }
    }
  }
  step() {
    const s = this.spat, m = this.m;
    if (s.carrier >= 0) {
      const p = m.players.get(s.carrier);
      if (!p || !p.alive) { if (p) this.drop(p); else { s.carrier = -1; s.held = 0; } return; }
      // Rides 0.3 behind the carrier, following their yaw.
      s.x = p.body.x + Math.sin(p.body.yaw) * SPATULA.carryBack; s.y = p.body.y + 0.45; s.z = p.body.z + Math.cos(p.body.yaw) * SPATULA.carryBack;
      return;
    }
    if (!s.rest) {
      s.vy = Math.max(s.vy - 0.012 * m.options.gravity, -0.29);
      s.x += s.vx; s.y += s.vy; s.z += s.vz;
      m.grid.overlaps(s.x, s.y, s.z, 0.15, (nx, ny, nz, depth) => {
        s.x += nx * depth; s.y += ny * depth; s.z += nz * depth;
        const vn = s.vx * nx + s.vy * ny + s.vz * nz;
        if (vn < 0) { s.vx -= (1 + SPATULA.restitution) * vn * nx; s.vy -= (1 + SPATULA.restitution) * vn * ny; s.vz -= (1 + SPATULA.restitution) * vn * nz; s.vx *= 0.9; s.vz *= 0.9; }
        if (ny > 0.7 && Math.hypot(s.vx, s.vy, s.vz) < 0.03) { s.vx = s.vy = s.vz = 0; s.rest = true; }
        return false;
      });
      if (s.y < PLAYER.killPlaneY || s.x < 0 || s.z < 0 || s.x > m.grid.w || s.z > m.grid.d) { this.respawn(); return; }
    }
    // Pick up by touch.
    for (const p of m.players.values()) {
      if (!p.alive || p.pausedAt >= 0) continue;
      if ((p.body.x - s.x) ** 2 + (p.body.z - s.z) ** 2 > SPATULA.radius ** 2 || Math.abs(p.body.y + 0.3 - s.y) > 0.9) continue;
      // Taking it from the other team resets your team's score; re-taking your own drop keeps it.
      if (s.last && s.last !== p.team) { this.score[p.team] = 0; }
      s.carrier = p.id; s.held = p.team; s.last = p.team; s.rest = false;
      m.emit({ t: 'spatula', k: 'take', id: p.id, team: p.team });
      break;
    }
  }
  state() { const s = this.spat; return { k: 'spatula', s: this.score.slice(1), c: s.carrier, h: s.held, p: [s.x, s.y, s.z] }; }
}

class Roost extends Teams {
  constructor(m) {
    super(m);
    this.zones = m.map.roostZones;
    this.zone = this.zones.length ? Math.floor(m.rnd() * this.zones.length) : -1;
    this.progress = 0; this.owner = 0; this.takeover = 0; this.taker = 0; this.st = 'start';
    this.intermission = 0; this.teamAt = new Map(); this.roundKills = new Map();
  }
  inZone(p) {
    const z = this.zones[this.zone]; if (!z) return false;
    const b = p.body;
    return b.x >= z.x0 && b.x <= z.x1 && b.z >= z.z0 && b.z <= z.z1 && b.y >= z.y0 - 0.2 && b.y <= z.y1;
  }
  onKill(killer) { this.roundKills.set(killer.id, (this.roundKills.get(killer.id) || 0) + 1); }
  canSpawn() { return true; }
  step() {
    const m = this.m;
    for (const p of m.players.values()) if (!this.teamAt.has(p.id) || this.teamAt.get(p.id).team !== p.team) this.teamAt.set(p.id, { team: p.team, since: m.tick });
    if (this.intermission > 0) { if (--this.intermission === 0) { this.score = [0, 0, 0]; this.newZone(); this.st = 'start'; this.roundStart = m.tick; this.roundKills.clear(); } return; }
    if (this.zone < 0) return;
    const c = this.counts();
    if (!c[1] || !c[2]) { this.st = 'waiting'; return; }
    const inside = [0, 0, 0];
    for (const p of m.players.values()) if (p.alive && p.pausedAt < 0 && this.inZone(p)) inside[p.team]++;
    if (inside[1] && inside[2]) { this.st = 'contested'; return; }
    const t = inside[1] ? 1 : inside[2] ? 2 : 0;
    if (!t) {
      if (this.takeover) { this.takeover = 0; this.taker = 0; }
      this.st = this.owner ? 'abandoned' : 'unclaimed'; return;
    }
    if (!this.owner || this.owner === t) {
      this.owner = t; this.takeover = 0;
      this.progress += ROOST.speeds[Math.min(inside[t], ROOST.speeds.length) - 1];
      this.st = 'capturing';
      if (this.progress >= ROOST.max) this.capture(t);
    } else {
      this.taker = t; this.st = 'takeover';
      if (++this.takeover >= ROOST.takeover) { this.owner = t; this.progress = 0; this.takeover = 0; this.taker = 0; m.emit({ t: 'roost', k: 'flip', team: t }); }
    }
  }
  capture(t) {
    const m = this.m;
    this.score[t]++; m.emit({ t: 'roost', k: 'score', team: t, s: this.score[t] });
    if (this.score[t] >= ROOST.goal) {
      // Round win: clear the air, hand out the bonus, then a short intermission (GDD §14.4).
      m.bullets.length = 0; m.rockets.length = 0; m.grenades.length = 0;
      const winners = [];
      for (const p of m.players.values()) {
        const at = this.teamAt.get(p.id);
        if (p.team !== t || !at) continue;
        const whole = at.since <= (this.roundStart ?? 0);
        if (whole || (this.roundKills.get(p.id) || 0) > 0) winners.push(p.id);
      }
      m.emit({ t: 'win', team: t, bonus: winners });
      this.intermission = ROOST.intermissionTicks; this.st = 'win';
      this.zone = -1; this.progress = 0; this.owner = 0;
      return;
    }
    this.newZone();
  }
  newZone() {
    const n = this.zones.length; if (!n) return;
    let z = Math.floor(this.m.rnd() * n);
    if (n > 1 && z === this.zone) z = (z + 1 + Math.floor(this.m.rnd() * (n - 1))) % n;
    this.zone = z; this.progress = 0; this.owner = 0; this.takeover = 0; this.taker = 0;
    this.m.emit({ t: 'roost', k: 'move', zone: z });
  }
  state() { return { k: 'roost', s: this.score.slice(1), z: this.zone, p: Math.round(this.progress), o: this.owner, tk: this.takeover, tt: this.taker, st: this.st, im: this.intermission }; }
}

export function makeMode(id, match) {
  switch (id) {
    case 'teams': return new Teams(match);
    case 'spatula': return new Spatula(match);
    case 'roost': return new Roost(match);
    default: return new FFA(match);
  }
}

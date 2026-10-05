// What host and guests say to each other, on top of Blockhaven's Link (JSON messages, split when long):
//   guest → host  in {f, c: [[ctrl, yaw, pitch] ×3], l: rtt ms}   inputs, three ticks per message (GDD §26)
//                 resp | prim {w} | pause | team | chat {msg, team}
//   host → guest  welcome {id, map, mode, options, code, roster, tick}
//                 st {k: tick, a: last input frame used, me: own state, p: players, i: items, m: mode,
//                     r: rockets, g: grenades, e: events}   15 Hz
//                 opts {options} | boot {reason} | join | leave | bye | chat
// Numbers are rounded to 1/256 (positions) and 1/1000 (angles) to keep messages small.
import { PRIMARIES, SECONDARY } from '../sim/tuning.js?v=muv8vpk2';

const q = v => Math.round(v * 256) / 256;
const a = v => Math.round(v * 1000) / 1000;
const WIDS = [...PRIMARIES, SECONDARY];

// Flags: alive 1, onGround 2, ads 4, spawnShield 8, reloading 16, climbing 32, paused 64, charging 128.
export function encodePlayer(p) {
  const b = p.body, h = p.hands;
  const f = (p.alive ? 1 : 0) | (b.onGround > 0 ? 2 : 0) | (h.ads ? 4 : 0) | (p.spawnShield > 0 ? 8 : 0) | (h.reload > 0 ? 16 : 0) | (b.climbing ? 32 : 0) | (p.pausedAt >= 0 ? 64 : 0) | (h.charging ? 128 : 0);
  return [p.id, q(b.x), q(b.y), q(b.z), a(b.yaw), a(b.pitch), f, Math.ceil(p.hp), Math.ceil(p.shield), WIDS.indexOf(h.slots[h.cur].id), p.score, p.kills, p.deaths, p.bestStreak, p.team, q(b.vx), q(b.vy), q(b.vz),
    p.power.shellBreaker, p.power.quailEgg, p.power.doubleYolks, h.melee, h.swap, p.overheal];
}
export function applyPlayer(p, r) {
  const b = p.body, h = p.hands;
  p.alive = !!(r[6] & 1); b.onGround = r[6] & 2 ? 1 : 0; h.ads = !!(r[6] & 4); p.spawnShield = r[6] & 8 ? 1 : 0;
  h.reload = r[6] & 16 ? 1 : 0; b.climbing = r[6] & 32 ? {} : null; p.pausedAt = r[6] & 64 ? 0 : -1; h.charging = !!(r[6] & 128);
  p.hp = r[7]; p.shield = r[8];
  const wid = WIDS[r[9]];
  if (wid && h.slots[h.cur]?.id !== wid) { let i = h.slots.findIndex(s => s.id === wid); if (i < 0) { h.slots.unshift({ id: wid, mag: 1, store: 0 }); i = 0; } h.cur = i; }
  p.score = r[10]; p.kills = r[11]; p.deaths = r[12]; p.bestStreak = r[13]; p.team = r[14];
  b.vx = r[15]; b.vy = r[16]; b.vz = r[17];
  p.power.shellBreaker = r[18]; p.power.quailEgg = r[19]; p.power.doubleYolks = r[20]; h.melee = r[21]; h.swap = r[22]; p.overheal = r[23];
}
// The full state of a guest's own egg after the input frame the host last used: the guest rewinds to
// this and replays its newer inputs (reconciliation).
export function ownState(p) {
  return { b: { ...p.body, climbing: p.body.climbing ? { ...p.body.climbing } : null }, h: JSON.parse(JSON.stringify(p.hands)), hp: p.hp, sh: p.shield, ss: p.spawnShield, al: p.alive, pw: { ...p.power }, ra: p.respawnAt, pc: p.pauseCooldownUntil, pa: p.pausedAt, pc2: p.prevCtrl, np: p.nextPrimary, oh: p.overheal, st: p.streak, bs: p.bestStreak, k: p.kills, d: p.deaths, sc: p.score, tm: p.team };
}
export function applyOwn(p, s) {
  Object.assign(p.body, s.b); p.hands = s.h; p.hp = s.hp; p.shield = s.sh; p.spawnShield = s.ss; p.alive = s.al; p.power = s.pw;
  p.respawnAt = s.ra; p.pauseCooldownUntil = s.pc; p.pausedAt = s.pa; p.prevCtrl = s.pc2; p.nextPrimary = s.np; p.overheal = s.oh;
  p.streak = s.st; p.bestStreak = s.bs; p.kills = s.k; p.deaths = s.d; p.score = s.sc; p.team = s.tm;
}
export const rosterEntry = p => ({ id: p.id, name: p.name, bot: !!p.bot, team: p.team, cosmetics: p.cosmetics || null, primary: p.primary });
// Events guests need (everything visual/audible plus kills and pickups); bulky or private ones are trimmed.
const SEND = new Set(['shot', 'fire', 'impact', 'hit', 'kill', 'spawn', 'reload', 'reloaded', 'dry', 'swap', 'swing', 'throw', 'bounce', 'rocket', 'boom', 'dud', 'collect', 'land', 'jump', 'power', 'powerEnd', 'shieldBreak', 'spatula', 'score', 'roost', 'win', 'team', 'join', 'leave', 'despawn', 'item']);
export const sendable = e => SEND.has(e.t);
export function trimEvent(e) {
  const o = { ...e };
  for (const k of ['x', 'y', 'z', 'dx', 'dy', 'dz', 'len', 'vx', 'vy', 'vz', 'dmg']) if (typeof o[k] === 'number') o[k] = Math.round(o[k] * 1000) / 1000;
  return o;
}

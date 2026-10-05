// Daily challenges (GDD §22): three a day from a pool, each rerollable once, replaced after 24 h.
// Progress comes from match events; rewards are Golden Yolks. Stored in the local profile.
import { PRIMARIES, WEAPONS } from '../sim/tuning.js?v=muv8vpk2';

const W = id => WEAPONS[id].name;
// type: kills | streak | quick (kills within 60 s of spawning) | weapon | damage | condition
export const POOL = [
  ...[10, 20, 50].map((n, i) => ({ id: 'kills' + n, tier: i + 1, title: n === 10 ? 'Shell Cracker' : n === 20 ? 'Egg Hunter' : 'Omelet Maker', desc: `Get ${n} total kills`, type: 'kills', goal: n, reward: [100, 300, 1000][i] })),
  ...[5, 10, 15].map((n, i) => ({ id: 'streak' + n, tier: i + 1, title: ['On a Roll', 'Hard Boiled', 'Unscrambled'][i], desc: `Reach a ${n}-kill streak`, type: 'streak', goal: n, reward: [150, 500, 1500][i] })),
  ...[2, 4].map((n, i) => ({ id: 'quick' + n, tier: i + 1, title: ['Back to Back', 'Fresh Out the Carton'][i], desc: `Spawn and get ${n} kills in 1 minute`, type: 'quick', goal: n, reward: [100, 400][i] })),
  ...[500, 1500, 4000].map((n, i) => ({ id: 'dmg' + n, tier: i + 1, title: ['Shattered Shells', 'Yolk Spiller', 'Breakfast Club'][i], desc: `Deal ${n} damage`, type: 'damage', goal: n, reward: [100, 300, 800][i] })),
  ...PRIMARIES.map(w => ({ id: 'w-' + w, tier: 2, title: `${W(w)} Pro`, desc: `Get 10 kills with the ${W(w)}`, type: 'weapon', weapon: w, goal: 10, reward: 400 })),
  { id: 'nade2', tier: 3, title: 'Two Birds', desc: 'Get 2 kills with one grenade', type: 'multi', weapon: 'grenade', goal: 1, reward: 800 },
  { id: 'melee3', tier: 2, title: 'Whisked Away', desc: 'Get 3 melee kills', type: 'weapon', weapon: 'melee', goal: 3, reward: 500 },
  { id: 'pistol5', tier: 1, title: 'Peck Order', desc: 'Get 5 kills with the Peck 9mm', type: 'weapon', weapon: 'peck9mm', goal: 5, reward: 300 },
  { id: 'lowhp', tier: 3, title: 'Cracked Not Broken', desc: 'Get a kill with less than 10 health', type: 'lowhp', goal: 1, reward: 600 },
];

const DAY = 24 * 3600 * 1000;
export function ensureDaily(profile, now = Date.now()) {
  const c = profile.challenges;
  if (c && now - c.start < DAY && Array.isArray(c.slots) && c.slots.length === 3) return c;
  const pick = new Set();
  const maxTier = (profile.stats.kills || 0) > 100 ? 3 : 2;
  const pool = POOL.filter(p => p.tier <= maxTier);
  while (pick.size < 3) pick.add(pool[Math.floor(Math.random() * pool.length)].id);
  profile.challenges = { start: now, slots: [...pick].map(id => ({ id, n: 0, done: false, claimed: false, rerolled: false })) };
  return profile.challenges;
}
export const def = id => POOL.find(p => p.id === id);
export function reroll(profile, i) {
  const c = profile.challenges, s = c.slots[i];
  if (!s || s.rerolled || s.done) return false;
  const used = new Set(c.slots.map(x => x.id));
  const options = POOL.filter(p => !used.has(p.id));
  const p = options[Math.floor(Math.random() * options.length)];
  c.slots[i] = { id: p.id, n: 0, done: false, claimed: false, rerolled: true };
  return true;
}
export function timeLeft(profile, now = Date.now()) {
  const ms = Math.max(0, DAY - (now - (profile.challenges?.start || now)));
  const h = Math.floor(ms / 3.6e6), m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
// Feed one local-player happening; returns challenges completed now.
export function progress(profile, ev) {
  const c = profile.challenges; if (!c) return [];
  const done = [];
  for (const s of c.slots) {
    if (s.done) continue;
    const d = def(s.id); if (!d) continue;
    let add = 0;
    switch (d.type) {
      case 'kills': if (ev.k === 'kill') add = 1; break;
      case 'streak': if (ev.k === 'kill') { s.n = Math.max(s.n, ev.streak); } break;
      case 'quick': if (ev.k === 'kill' && ev.sinceSpawn <= 30 * 60) s.n = Math.max(s.n, ev.lifeKills); break;
      case 'damage': if (ev.k === 'damage') add = ev.amount; break;
      case 'weapon': if (ev.k === 'kill' && ev.weapon === d.weapon) add = 1; break;
      case 'multi': if (ev.k === 'multi' && ev.weapon === d.weapon && ev.count >= 2) add = 1; break;
      case 'lowhp': if (ev.k === 'kill' && ev.hp < 10) add = 1; break;
    }
    s.n = Math.min(d.goal, s.n + add);
    if (s.n >= d.goal) { s.done = true; done.push(d); }
  }
  return done;
}
// Rewards are claimed back at the menus (GDD: "Claimed on returning to the menu").
export function claim(profile) {
  let total = 0;
  for (const s of profile.challenges?.slots || []) if (s.done && !s.claimed) { s.claimed = true; total += def(s.id)?.reward || 0; profile.stats.challenges = (profile.stats.challenges || 0) + 1; }
  profile.coins += total;
  return total;
}

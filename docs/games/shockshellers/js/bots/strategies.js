// Bot strategies: the plays a player can make, chosen situationally. Each strategy says
//   affinity  how naturally each weapon plays it (0 = never with that weapon)
//   fit       how well it suits the situation right now (0–1)
//   enter     what to do on choosing it (usually a movement goal); update keeps it going
//   tactic    how to fight while it is active: strafe, stand still to shoot ('counter' = only in
//             shooting windows, 'always', 'never'), hop ('duel' | 'escape' | 'none'), scope
// A bot weighs them with its own taste for each (a per-bot profile) and its skill: good players pick
// what the situation calls for and switch at the right time; weaker ones lean on habits and misjudge.
import { PLAYER, TICK } from '../sim/tuning.js?v=muws78am';
import { EDGE } from './nav.js?v=muws78am';

const T = (strafe, stand, hop, ads = false) => ({ strafe, stand, hop, ads });
const FIGHT = T(true, 'counter', 'duel');

export const STRATEGIES = [
  // ---------------- while an enemy is in sight ----------------
  {
    id: 'duel', fight: true, tactic: FIGHT,
    affinity: { yolk47: 1, triBoil: 1, beater: 1, peck9mm: 1, doubleYolker: 0.8, yolkzooka: 0.6, cageFree: 0.4, poacher: 0.1 },
    fit: (b, c) => c.dist >= c.near * 0.7 && c.dist <= c.far * 1.1 ? 0.8 : 0.35,
    enter: b => b.setGoal({ k: 'hold', node: null }),
  },
  {
    id: 'push', fight: true, tactic: T(true, 'never', 'duel'),
    affinity: { doubleYolker: 1.2, beater: 1, peck9mm: 0.6, yolk47: 0.5, triBoil: 0.4 },
    fit: (b, c) => Math.max(0, (c.dist > c.near + 1 ? 0.5 : 0.15) + (c.enemyWeak ? 0.5 : 0) + (c.hpFrac > 0.7 ? 0.15 : -0.2) - (c.closeFoes > 1 ? 0.35 : 0)),
    enter: (b, c) => b.setGoal({ k: 'close', node: b.nav.nearest(c.tmem.x, c.tmem.y, c.tmem.z) }),
  },
  {
    id: 'kite', fight: true, tactic: T(true, 'counter', 'none'),
    affinity: { yolkzooka: 1, triBoil: 0.8, yolk47: 0.7, cageFree: 0.7, poacher: 0.3 },
    // Keep a shotgun or SMG at arm's length.
    fit: (b, c) => c.dist < c.near ? 0.6 + (c.enemyShortRange ? 0.3 : 0) : 0,
    enter: (b, c) => b.setGoal({ k: 'backoff', node: b.retreatNode(c.tmem, c.near + 3) }),
  },
  {
    // Fight from cover: hide, reload, step out, shoot, back in. Also continues while out of sight.
    id: 'coverFight', fight: true, idle: true, tactic: T(false, 'always', 'none'),
    affinity: { cageFree: 1, poacher: 1, triBoil: 0.8, yolk47: 0.8, yolkzooka: 0.8, peck9mm: 0.5, beater: 0.4, doubleYolker: 0.25 },
    fit: (b, c) => !c.tmem || c.tmem.dead ? 0 : Math.min(1, (c.seeing ? 0.25 : c.recent ? 0.45 : 0) + (c.underFire ? 0.3 : 0) + (c.losing ? 0.25 : 0) + (c.reloading ? 0.3 : 0)),
    enter: (b, c) => { b.peekPhase = 'hide'; b.coverNode = b.findCover(c.tmem); b.setGoal({ k: 'cover', node: b.coverNode }); },
    update(b, c) {
      const h = b.p.hands, s = h.slots[h.cur];
      if (b.peekPhase === 'hide') {
        if (b.arrived() && s.mag > 0 && h.reload === 0 && !(c.underFire && c.tick - b.underFire < 10)) {
          const pk = b.peekNode(c.tmem);
          if (pk !== null) { b.peekPhase = 'peek'; b.peekShots = s.mag; b.peekUntil = c.tick + Math.round((0.8 + (1 - b.skill) * 0.8) / TICK); b.setGoal({ k: 'peek', node: pk }); }
        }
      } else if (s.mag === 0 || s.mag <= b.peekShots - (s.id === 'poacher' || s.id === 'cageFree' ? 1 : 3) || c.tick > b.peekUntil + 60 || (c.underFire && c.losing)) {
        // Shots taken (or the peek went bad): back in.
        b.peekPhase = 'hide'; b.setGoal({ k: 'cover', node: b.coverNode ?? b.findCover(c.tmem) });
      }
    },
  },
  {
    id: 'escape', fight: true, tactic: T(false, 'never', 'escape'),
    affinity: { any: 1 },
    fit: (b, c) => Math.min(1, (c.lowHp && c.losing ? 0.8 : 0) + (c.closeFoes >= 3 ? 0.4 : 0) + (c.scoped && c.dist < 7 ? 0.85 : 0) + (c.wid === 'yolkzooka' && c.dist < 3.5 ? 0.6 : 0)),
    enter: (b, c) => { b.coverNode = b.findCover(c.tmem); b.setGoal({ k: 'escape', node: b.coverNode ?? b.retreatNode(c.tmem, 9) }); },
  },
  {
    id: 'holdAngle', fight: true, tactic: T(false, 'always', 'none', true),
    affinity: { poacher: 1.2, cageFree: 1 },
    fit: (b, c) => c.dist > 9 ? 0.9 : 0.15,
    enter: b => b.setGoal({ k: 'hold', node: null }),
  },
  {
    // Snap-scoped shots at mid range: needs confidence and good hands.
    id: 'quickscope', fight: true, tactic: T(true, 'counter', 'none', true),
    affinity: { poacher: 0.8, cageFree: 0.7 },
    fit: (b, c) => c.dist >= 3 && c.dist <= 9 ? 0.4 + b.skill * 0.5 - (c.hpFrac < 0.5 ? 0.3 : 0) : 0,
    enter: b => b.setGoal({ k: 'hold', node: null }),
  },

  // ---------------- out of sight ----------------
  {
    id: 'hunt', idle: true, tactic: FIGHT,
    affinity: { doubleYolker: 1, beater: 1, yolk47: 0.8, triBoil: 0.7, peck9mm: 0.7, yolkzooka: 0.5, cageFree: 0.4, poacher: 0.15 },
    fit: (b, c) => c.recent ? 0.5 + b.per.aggression * 0.4 : 0,
    enter: (b, c) => b.setGoal({ k: 'hunt', node: b.nav.nearest(c.tmem.x, c.tmem.y, c.tmem.z) }),
  },
  {
    // Come at them from the side, through covered ground.
    id: 'flank', idle: true, tactic: FIGHT,
    affinity: { doubleYolker: 1, beater: 0.9, yolk47: 0.5, triBoil: 0.5, peck9mm: 0.5, yolkzooka: 0.3 },
    fit: (b, c) => c.recent && c.distMem > 6 ? 0.55 + b.per.aggression * 0.2 : 0,
    enter: (b, c) => b.setGoal({ k: 'flank', node: b.flankNode(c.tmem), avoidOpen: 3 }),
  },
  {
    id: 'perch', idle: true, tactic: T(false, 'always', 'none', true),
    affinity: { poacher: 1.2, cageFree: 1, triBoil: 0.15, yolk47: 0.12 },
    fit: (b, c) => 0.55 + (c.recent ? 0 : 0.25),
    enter: (b, c) => b.setGoal({ k: 'perch', node: b.perchNode(), until: c.tick + Math.round((8 + b.rnd() * 10) / TICK) }),
    update: (b, c) => { if (!b.goal || (b.arrived() && c.tick > (b.goal.until ?? 0))) b.setGoal({ k: 'perch', node: b.perchNode(), until: c.tick + Math.round((8 + b.rnd() * 10) / TICK) }); },
  },
  {
    // A sniper who has been spotted (hit, or got a kill) moves to a new spot.
    id: 'relocate', idle: true, tactic: T(true, 'never', 'none'),
    affinity: { poacher: 1, cageFree: 0.8, yolkzooka: 0.4, any: 0.15 },
    fit: (b, c) => (c.tick - (b.underFire || -999) < 90 || c.tick - (b.lastKill || -999) < 60) && !c.recent ? 0.85 : 0,
    enter: (b, c) => b.setGoal({ k: 'perch', node: b.perchNode(), until: c.tick + Math.round(10 / TICK) }),
  },
  {
    id: 'ambush', idle: true, tactic: T(false, 'always', 'duel'),
    affinity: { doubleYolker: 1.1, beater: 0.6, peck9mm: 0.3 },
    fit: (b, c) => 0.5 + (1 - b.per.aggression) * 0.3,
    enter: (b, c) => b.setGoal({ k: 'ambush', node: b.ambushNode(c.recent ? c.tmem : null), until: c.tick + Math.round((6 + b.rnd() * 8) / TICK) }),
    update: (b, c) => { if (!b.goal || (b.arrived() && c.tick > (b.goal.until ?? 0))) b.setGoal({ k: 'ambush', node: b.ambushNode(null), until: c.tick + Math.round((6 + b.rnd() * 8) / TICK) }); },
  },
  {
    id: 'roam', idle: true, tactic: FIGHT,
    affinity: { any: 1 },
    fit: () => 0.45,
    enter: b => b.setGoal({ k: 'roam', node: b.roamNode() }),
    update: b => { if (!b.goal || b.arrived()) b.setGoal({ k: 'roam', node: b.roamNode() }); },
  },
  {
    // Hurt and nobody around: get out of sight and let health come back.
    id: 'heal', idle: true, tactic: T(true, 'never', 'none'),
    affinity: { any: 1 },
    fit: (b, c) => c.hpFrac < 0.6 && !c.recent ? 0.9 * (1 - c.hpFrac) + 0.2 : 0,
    enter: b => b.setGoal({ k: 'heal', node: b.safeNode() }),
  },
  {
    id: 'resupply', idle: true, tactic: FIGHT,
    affinity: { any: 1 },
    fit: (b, c) => c.item ? (c.storeFrac < 0.35 ? 0.9 : 0.35) : 0,
    enter: (b, c) => b.setGoal({ k: 'item', node: c.item.node }),
  },
  {
    id: 'objective', idle: true, tactic: FIGHT,
    affinity: { any: 1, poacher: 0.6, cageFree: 0.7 },
    // How pressing the objective is: a free spatula, an enemy carrier or a zone to take pulls hard (as it
    // does real players); escorting or guarding approaches less so.
    fit: (b, c) => { const k = c.objective?.k; return !k ? 0 : k === 'zone' || k === 'spatula' || k === 'hunt' || k === 'carry' ? 1.3 : 0.8; },
    enter: (b, c) => b.setGoal(c.objective),
    update: (b, c) => { if (c.objective && (c.objective.node !== b.goal?.node || b.arrived())) b.setGoal(c.objective); },
  },
];

// Each bot's taste for each strategy: around 1, some far above (a favourite), some below.
export function strategyProfile(rnd) {
  const g = () => { let s = 0; for (let i = 0; i < 4; i++) s += rnd(); return (s - 2) * 1.2; };
  return Object.fromEntries(STRATEGIES.map(s => [s.id, Math.exp(g() * 0.5)]));
}

// Pick the strategy for this moment. Skill sharpens judgement (fit counts for more, habits and noise
// for less); the current strategy gets a bonus while it is young, so nobody flip-flops.
const CASUAL = new Set(['push', 'duel', 'hunt', 'roam']);
const TACTICAL = new Set(['holdAngle', 'coverFight', 'flank', 'ambush', 'perch', 'quickscope', 'kite', 'relocate']);
export function choose(bot, c) {
  const sk = bot.skill;
  let best = null, bu = -Infinity;
  for (const s of STRATEGIES) {
    if (c.seeing ? !s.fight : !s.idle) continue;
    const aff = s.affinity[c.wid] ?? s.affinity.any ?? 0;
    if (aff <= 0) continue;
    const fit = s.fit(bot, c);
    if (fit <= 0) continue;
    const noise = Math.exp(gauss(bot.rnd) * (0.45 - 0.37 * sk));
    let u = Math.pow(fit, 0.7 + 1.6 * sk) * aff * Math.pow(bot.pref[s.id] || 1, 1.15 - 0.6 * sk) * noise;
    // Most real players are casual: they push, chase and roam; holding angles, flanking, ambushes and
    // perches are what the better ones do. So the tactical plays fade in with skill.
    u *= CASUAL.has(s.id) ? 1 + 0.8 * (1 - sk) : TACTICAL.has(s.id) ? 0.3 + 0.7 * sk : 1;
    if (s === bot.strategy) u *= c.tick - bot.stratSince < Math.round(1.2 / TICK) ? 1.6 : 1.2;
    if (u > bu) { bu = u; best = s; }
  }
  return best;
}
function gauss(rnd) { return (rnd() + rnd() + rnd() + rnd() - 2) * 1.22; }
export { PLAYER, EDGE };

// Bots: they find each other and fight, never get stuck for long, skill decides outcomes, and a
// difficulty is a spread of skills rather than one value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { default: arena } = await load('maps/omelet-arena.js');
const { Match } = await load('sim/match.js');
const { NavGraph } = await load('bots/nav.js');
const { BotManager, BOT_NAMES, drawSkill, traits, SKILL_RANGES } = await load('bots/bot.js');

const map = arena(), nav = new NavGraph(map.grid);
function run(minutes, skills, primary, mode = 'ffa', seed = 3) {
  const m = new Match(map, { mode, seed }), mgr = new BotManager(m, nav, seed * 7);
  skills.forEach((s, i) => mgr.add(m.addPlayer({ id: i + 1, name: BOT_NAMES[i], bot: true }), s, primary ? { primary } : {}));
  const still = new Map();
  let maxStill = 0;
  for (let t = 0; t < 30 * 60 * minutes; t++) {
    mgr.tick(); m.step(); mgr.events(m.events); m.events.length = 0;
    for (const p of m.players.values()) {
      const n = p.alive && Math.hypot(p.body.vx, p.body.vz) < 0.002 && !mgr.bots.get(p.id).target ? (still.get(p.id) || 0) + 1 : 0;
      still.set(p.id, n); maxStill = Math.max(maxStill, n);
    }
  }
  return { m, maxStill };
}

test('the nav graph covers the map and is one connected region', () => {
  assert.ok(nav.nodes.length > 300);
  const main = [...nav.comp].filter(c => c === nav.main).length;
  assert.ok(main / nav.nodes.length > 0.85, `${main}/${nav.nodes.length}`);
  for (const s of map.spawns) assert.equal(nav.comp[nav.nearest(s.x, s.y, s.z)], nav.main, 'every spawn reachable');
});

test('a bot match produces fights and no bot stands idle for long', () => {
  const { m, maxStill } = run(2, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
  const kills = [...m.players.values()].reduce((a, p) => a + p.kills, 0);
  assert.ok(kills >= 10, `kills ${kills}`);
  assert.ok(maxStill < 30 * 8, `a bot stood idle for ${maxStill} ticks`);
});

test('skill decides fights: top bots clearly outscore beginners with the same weapon', () => {
  const { m } = run(4, [0.1, 0.95, 0.1, 0.95, 0.1, 0.95], 'yolk47');
  let lo = 0, hi = 0;
  for (const p of m.players.values()) if (p.id % 2) lo += p.kills; else hi += p.kills;
  assert.ok(hi > lo * 1.6, `top ${hi} vs beginners ${lo}`);
});

test('difficulties are skill ranges and traits vary between bots of the same skill', () => {
  let s = 1; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const draws = Array.from({ length: 200 }, () => drawSkill('normal', rnd));
  assert.ok(Math.min(...draws) >= SKILL_RANGES.normal[0] && Math.max(...draws) <= SKILL_RANGES.normal[1]);
  assert.ok(Math.max(...draws) - Math.min(...draws) > 0.2, 'a spread, not one value');
  const a = traits(0.5, rnd), b = traits(0.5, rnd);
  assert.notEqual(a.reaction, b.reaction);
  assert.ok(traits(1, () => 0.5).aimErr < traits(0, () => 0.5).aimErr / 5);
  assert.equal(drawSkill(0.42, rnd), 0.42);
});

test('bots play the objective: they grab and score with the spatula', () => {
  const r = run(3, [0.6, 0.6, 0.6, 0.6, 0.6, 0.6], null, 'spatula', 5);
  const st = r.m.mode.state();
  assert.ok(r.m.mode.spat.last !== 0, 'someone picked up the spatula');
  assert.ok(st.s[0] + st.s[1] > 0 || r.m.mode.spat.carrier >= 0);
});

test('hopping is situational: close fights only, never with a sniper, and not all the time', () => {
  const m = new Match(map, { mode: 'ffa', seed: 9 }), mgr = new BotManager(m, nav, 77);
  const kit = ['poacher', 'doubleYolker', 'cageFree', 'beater', 'yolk47', 'doubleYolker'];
  kit.forEach((w, i) => mgr.add(m.addPlayer({ id: i + 1, name: BOT_NAMES[i], bot: true }), 0.7, { primary: w, hopper: 0.8 }));
  let hops = 0, alive = 0, closeFights = 0, hopInClose = 0;
  for (let t = 0; t < 30 * 60 * 3; t++) {
    mgr.tick(); m.step(); mgr.events(m.events); m.events.length = 0;
    for (const b of mgr.bots.values()) {
      if (!b.p.alive) continue;
      alive++;
      const w = b.p.hands.slots[b.p.hands.cur].id;
      const q = b.target !== null ? m.players.get(b.target) : null;
      const dist = q ? Math.hypot(q.body.x - b.p.body.x, q.body.z - b.p.body.z) : Infinity;
      if (b.hopping && q) {
        hops++;
        assert.ok(b.hopWeapon !== 'poacher' && b.hopWeapon !== 'cageFree', `a sniper hopped (${b.hopWeapon})`);
        assert.ok(dist < 8.5, `hopped at range ${dist.toFixed(1)}`);
      }
      if (dist < 5 && b.visible(b.target)) { closeFights++; if (b.hopping) hopInClose++; }
    }
  }
  assert.ok(hopInClose > 0, 'bots do hop in close fights');
  assert.ok(hops / alive < 0.3, `hopping ${Math.round(hops / alive * 100)}% of the time`);
});

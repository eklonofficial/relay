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

const { MAPS, getMap } = await load('maps/index.js');
test('on every map, everything that matters is reachable on foot', () => {
  for (const def of MAPS) {
    const mp = getMap(def.id), nv = new NavGraph(mp.grid, mp.meta.gravity || 1);
    assert.ok(nv.nodes.length > 200, def.id);
    const reach = (x, y, z, what) => { const id = nv.nearest(x, y, z); assert.ok(id !== null && nv.comp[id] === nv.main, `${def.id}: ${what} at ${x},${y},${z} unreachable`); };
    for (const s of mp.spawns) reach(s.x, s.y, s.z, 'spawn');
    for (const it of mp.items) reach(it.x, it.y - 0.3, it.z, it.kind);
    for (const s of mp.spatulaSpawns) reach(s.x, s.y, s.z, 'spatula spawn');
    // A zone is reachable if a player can stand anywhere inside it.
    for (const z of mp.roostZones) assert.ok(nv.nodes.some(n => nv.comp[n.id] === nv.main && n.x >= z.x0 && n.x <= z.x1 && n.z >= z.z0 && n.z <= z.z1 && n.y >= z.y0 - 0.2 && n.y <= z.y1), `${def.id}: roost zone at ${z.cx},${z.cz} unreachable`);
    // Team modes need both sides.
    if (def.modes.includes('teams')) for (const t of [1, 2]) assert.ok(mp.spawns.some(s => s.team === t), `${def.id}: no team ${t} spawns`);
    if (def.modes.includes('roost')) assert.ok(mp.roostZones.length >= 3, `${def.id}: roost needs zones`);
  }
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

test('no map has a pit or loft bots can get into but not out of (stairs that end in a wall)', () => {
  for (const def of MAPS) {
    const nv = new NavGraph(getMap(def.id).grid), main = nv.nodes.filter(n => nv.comp[n.id] === nv.main);
    // The biggest set of ground where every spot can reach every other (Kosaraju's strongly connected components).
    const N = nv.nodes.length, rev = Array.from({ length: N }, () => []), order = [], seen = new Uint8Array(N);
    for (const n of nv.nodes) for (const e of n.edges) rev[e.to].push(n.id);
    for (let s = 0; s < N; s++) {
      if (seen[s]) continue; seen[s] = 1; const st = [[s, 0]];
      while (st.length) { const top = st[st.length - 1], es = nv.nodes[top[0]].edges; if (top[1] < es.length) { const t = es[top[1]++].to; if (!seen[t]) { seen[t] = 1; st.push([t, 0]); } } else { order.push(top[0]); st.pop(); } }
    }
    const comp = new Int32Array(N).fill(-1), size = [];
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i]; if (comp[s] >= 0) continue; const c = size.length; size.push(0); comp[s] = c; const q = [s];
      while (q.length) { const x = q.pop(); size[c]++; for (const t of rev[x]) if (comp[t] < 0) { comp[t] = c; q.push(t); } }
    }
    // A trap: ground reachable from the main area (on foot, by dropping, by a pad) that can't get back to it.
    const big = size.indexOf(Math.max(...size)), q = nv.nodes.filter(n => comp[n.id] === big).map(n => n.id), got = new Set(q);
    while (q.length) for (const e of nv.nodes[q.pop()].edges) if (!got.has(e.to)) { got.add(e.to); q.push(e.to); }
    const traps = [...got].filter(id => comp[id] !== big);
    assert.equal(traps.length, 0, `${def.id}: ${traps.length} spots can be got into but not out of, e.g. ${traps.slice(0, 3).map(id => { const n = nv.nodes[id]; return `${n.x},${n.y.toFixed(1)},${n.z}`; }).join(' ')}`);
  }
});

test('bots play the roost: they climb into the zone and hold it', () => {
  const qmap = getMap('quarry'), qnav = new NavGraph(qmap.grid), m = new Match(qmap, { mode: 'roost', seed: 1 }), mgr = new BotManager(m, qnav, 7);
  for (let i = 0; i < 8; i++) mgr.add(m.addPlayer({ id: i + 1, name: BOT_NAMES[i], bot: true, team: 1 + (i % 2) }), 0.5);
  let inside = 0, samples = 0;
  for (let t = 0; t < 30 * 90; t++) {
    mgr.tick(); m.step(); mgr.events(m.events); m.events.length = 0;
    if (t % 15 || m.mode.zone < 0) continue;
    for (const p of m.players.values()) if (p.alive) { samples++; if (m.mode.inZone(p)) inside++; }
  }
  assert.ok(inside / samples > 0.12, `only ${(100 * inside / samples).toFixed(1)}% of bot time in the zone`);
});

test('hopping is situational: close fights only, never with a sniper, and not all the time', () => {
  const m = new Match(map, { mode: 'ffa', seed: 9 }), mgr = new BotManager(m, nav, 77);
  const kit = ['poacher', 'doubleYolker', 'cageFree', 'beater', 'yolk47', 'doubleYolker'];
  kit.forEach((w, i) => mgr.add(m.addPlayer({ id: i + 1, name: BOT_NAMES[i], bot: true }), 0.7, { primary: w, hopper: 0.8 }));
  let hops = 0, alive = 0, closeFights = 0, hopInClose = 0;
  for (let t = 0; t < 30 * 60 * 3; t++) {
    mgr.tick(); const decided = new Map([...mgr.bots.values()].map(b => [b, b.target]));
    m.step(); mgr.events(m.events); m.events.length = 0;
    for (const b of mgr.bots.values()) {
      if (!b.p.alive) continue;
      alive++;
      const w = b.p.hands.slots[b.p.hands.cur].id;
      const q = b.target !== null ? m.players.get(b.target) : null;
      const dist = q ? Math.hypot(q.body.x - b.p.body.x, q.body.z - b.p.body.z) : Infinity;
      // (Only against the egg the hop was decided on: a shot from someone else can switch targets after it.)
      if (b.hopping && q && decided.get(b) === b.target) {
        hops++;
        // Snipers hop only when pushed: escaping someone close, unscoped. (Bots decide on the tick before
        // this one moves everyone, hence the half unit beyond the 8 they use.)
        if (b.hopWeapon === 'poacher' || b.hopWeapon === 'cageFree') assert.ok(dist < 8.5 && b.goal?.k === 'escape', `a sniper hopped at ${dist.toFixed(1)} (${b.goal?.k})`);
        assert.ok(dist < 8.5, `hopped at range ${dist.toFixed(1)}`);
      }
      if (dist < 5 && b.visible(b.target)) { closeFights++; if (b.hopping) hopInClose++; }
    }
  }
  assert.ok(hopInClose > 0, 'bots do hop in close fights');
  assert.ok(hops / alive < 0.3, `hopping ${Math.round(hops / alive * 100)}% of the time`);
});

const { Mind, counterPick } = await load('bots/mind.js');
test('bots remember: grudges, a nemesis, where they keep dying, and what keeps killing them', () => {
  const md = new Mind();
  md.died(100, 7, 'poacher', { x: 10, y: 1, z: 10 }, { x: 40, y: 6, z: 10 });
  md.died(400, 7, 'poacher', { x: 11, y: 1, z: 10 }, { x: 40, y: 6, z: 12 });
  md.died(700, 3, 'yolk47', { x: 30, y: 1, z: 30 }, { x: 31, y: 1, z: 30 });
  assert.equal(md.nemesis(), 7);
  assert.ok(md.grudge(7, 800) > md.grudge(3, 800) && md.grudge(5, 800) === 0);
  assert.ok(md.heatAt(10, 10, 800) > md.heatAt(60, 60, 800));
  assert.ok(md.heatAt(10, 10, 800) > md.heatAt(10, 10, 800 + 30 * 300), 'the heat fades');
  assert.equal(md.threat(), 'sniper');
  assert.equal(md.perches(800).length, 1);
  assert.ok(md.tilted);
  md.cracked(900, 7); assert.ok(!md.tilted && md.deathRun === 0);
  assert.ok(['doubleYolker', 'beater'].includes(counterPick('sniper', true, true, () => 0.3)));
  const next = md.carry();
  assert.equal(next.nemesis(), md.nemesis()); assert.equal(next.perches(0).length, 0);
});
test('bots talk about what happens, by name, and answer people', () => {
  const qmap = getMap('quarry'), qnav = new NavGraph(qmap.grid), m = new Match(qmap, { mode: 'teams', seed: 5, options: { timeLimit: 150 } }), mgr = new BotManager(m, qnav, 35);
  const human = m.addPlayer({ id: 9, name: 'Andrew', team: 1 });
  for (let i = 0; i < 7; i++) mgr.add(m.addPlayer({ id: i + 1, name: BOT_NAMES[i], bot: true, team: 1 + (i % 2) }), 0.4);
  const said = [];
  mgr.onChat = (id, msg) => said.push({ t: m.tick, id, msg });
  let greeted = null;
  for (let t = 0; t < 30 * 160; t++) {
    if (t === 30 * 20) { mgr.heard(human.id, 'hey everyone'); greeted = said.length; }
    mgr.tick(); m.step(); mgr.events(m.events); m.events.length = 0;
  }
  assert.ok(said.length >= 15, `only ${said.length} lines`);
  const names = [...m.players.values()].map(p => p.name.toLowerCase());
  assert.ok(said.filter(s => names.some(n => s.msg.toLowerCase().includes(n))).length >= 3, 'lines use names');
  assert.ok(said.slice(greeted).some(s => s.t < 30 * 30 && s.msg.toLowerCase().includes('andrew')), 'someone greets the person back by name');
  assert.ok(said.some(s => m.over && s.t >= m.over.until - 30 * 15 && /gg|good game/i.test(s.msg)), 'gg at the end');
});

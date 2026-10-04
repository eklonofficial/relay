// Chat commands (cheats) with Minecraft-style syntax, ~relative coordinates and suggestions.
import { B, STATE, DIM, BLOCKS } from '../data/blocks.js?v=mut8woro';
import { I, ITEMS } from '../data/items.js?v=mut8woro';
import { MOBS } from '../data/mobs.js?v=mut8woro';
import { BIOMES } from '../gen/biomes.js?v=mut8woro';
import { ENCHANTS, canEnchant, compatible, enchantsOf, setEnchants, enchantName } from '../data/enchantments.js?v=mut8woro';

const MODES = { survival: 'survival', s: 'survival', 0: 'survival', creative: 'creative', c: 'creative', 1: 'creative', adventure: 'adventure', a: 'adventure', 2: 'adventure', spectator: 'spectator', sp: 'spectator', 3: 'spectator' };
const DIMS = { overworld: DIM.OVERWORLD, 'minecraft:overworld': DIM.OVERWORLD, nether: DIM.NETHER, the_nether: DIM.NETHER, 'minecraft:the_nether': DIM.NETHER, end: DIM.END, the_end: DIM.END, 'minecraft:the_end': DIM.END };
const TIMES = { day: 0.02, noon: 0.25, sunset: 0.46, night: 0.55, midnight: 0.75, sunrise: 0.97 };
const EFFECTS = ['speed', 'slowness', 'haste', 'strength', 'instant_health', 'regeneration', 'resistance', 'fire_resistance', 'water_breathing', 'night_vision', 'poison', 'wither', 'absorption', 'jump_boost', 'hunger', 'invisibility', 'slow_falling'];
const STRUCTURES = ['village', 'stronghold', 'mineshaft', 'dungeon', 'desert_pyramid', 'pillager_outpost', 'igloo', 'ruined_portal', 'fortress', 'bastion', 'end_city', 'swamp_hut', 'shipwreck', 'ocean_ruin', 'ocean_monument', 'buried_treasure', 'jungle_temple', 'desert_well', 'fossil', 'trail_ruins', 'woodland_mansion', 'trial_chambers'];

export const COMMANDS = {
  help: { args: '[command]', desc: 'List commands' },
  gamemode: { args: '<survival|creative|adventure|spectator>', desc: 'Change game mode' },
  tp: { args: '<x> <y> <z>', desc: 'Teleport (supports ~ for relative)' },
  dimension: { args: '<overworld|nether|end>', desc: 'Travel to a dimension' },
  time: { args: 'set <day|noon|night|midnight|value> | add <value> | query', desc: 'Change the time' },
  weather: { args: '<clear|rain|thunder> [seconds]', desc: 'Change the weather' },
  give: { args: '<item> [count]', desc: 'Give yourself items' },
  enchant: { args: '<enchantment> [level]', desc: 'Enchant the held item' },
  summon: { args: '<mob> [x y z]', desc: 'Summon a mob' },
  kill: { args: '[@s|@e|@e[type=mob]]', desc: 'Kill entities' },
  clear: { args: '[item]', desc: 'Clear your inventory' },
  setblock: { args: '<x> <y> <z> <block>', desc: 'Place a block' },
  fill: { args: '<x1> <y1> <z1> <x2> <y2> <z2> <block> [hollow|outline|replace]', desc: 'Fill a region' },
  locate: { args: '<structure|biome>', desc: 'Find the nearest structure or biome' },
  seed: { args: '', desc: 'Show the world seed' },
  difficulty: { args: '<peaceful|easy|normal|hard>', desc: 'Set difficulty' },
  gamerule: { args: '<rule> [true|false]', desc: 'Change a game rule' },
  spawnpoint: { args: '', desc: 'Set spawn to your position' },
  effect: { args: 'give <effect> [seconds] [level] | clear', desc: 'Apply status effects' },
  xp: { args: '<amount> [levels]', desc: 'Give experience' },
  heal: { args: '', desc: 'Restore health and hunger' },
  say: { args: '<message>', desc: 'Broadcast a message' },
  me: { args: '<action>', desc: 'Describe an action' },
  list: { args: '', desc: 'List players' },
};

export class Commands {
  constructor(game) { this.g = game; }
  coord(s, base) {
    if (s === undefined) return base;
    if (s.startsWith('~')) return base + (s.length > 1 ? Number(s.slice(1)) : 0);
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  blockState(name) {
    name = name.replace(/^minecraft:/, '');
    if (STATE[name]) return STATE[name];
    if (name === 'air') return [B.AIR, 0];
    if (name === 'water') return [B.WATER, 0];
    if (name === 'lava') return [B.LAVA, 0];
    const b = BLOCKS.find(b => b.key === name);
    return b ? [b.id, 0] : null;
  }
  run(line) {
    const g = this.g;
    const parts = line.trim().replace(/^\//, '').split(/\s+/);
    const cmd = parts.shift().toLowerCase().replace(/^minecraft:/, '');
    const out = (m, c) => g.chat(m, c);
    const err = m => g.chat(m, '#ff5555');
    const free = ['help', 'seed', 'list', 'me', 'say'];
    if (!g.cheats && !free.includes(cmd)) return err('Cheats are not enabled in this world');
    const p = g.player.pos;
    switch (cmd) {
      case 'help': case '?': {
        if (parts[0] && COMMANDS[parts[0]]) return out(`/${parts[0]} ${COMMANDS[parts[0]].args} — ${COMMANDS[parts[0]].desc}`);
        out('Commands: ' + Object.keys(COMMANDS).map(k => '/' + k).join(' '), '#ffff55');
        return out('Type /help <command> for details. Tab completes names.', '#aaaaaa');
      }
      case 'gamemode': case 'gm': {
        const m = MODES[(parts[0] || '').toLowerCase()];
        if (!m) return err('Usage: /gamemode <survival|creative|adventure|spectator>');
        this.g.app.setGameMode(m);
        return out(`Set own game mode to ${m[0].toUpperCase() + m.slice(1)} Mode`);
      }
      case 'tp': case 'teleport': {
        if (parts.length === 1 && parts[0] === '@s') return;
        const x = this.coord(parts[0], p[0]), y = this.coord(parts[1], p[1]), z = this.coord(parts[2], p[2]);
        if ([x, y, z].some(v => !Number.isFinite(v))) return err('Usage: /tp <x> <y> <z>');
        g.teleportPlayer(x, y, z);
        return out(`Teleported to ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`);
      }
      case 'dimension': case 'dim': case 'execute': {
        let name = (parts[0] || '').toLowerCase();
        if (cmd === 'execute') { const i = parts.indexOf('in'); name = i >= 0 ? parts[i + 1] : ''; }
        const d = DIMS[name];
        if (d === undefined) return err('Usage: /dimension <overworld|nether|end>');
        if (d === g.dim) return out('You are already in that dimension');
        const target = d === DIM.END ? [100.5, 49, 0.5] : d === DIM.NETHER ? [Math.floor(p[0] / 8) + 0.5, 70, Math.floor(p[2] / 8) + 0.5] : [Math.floor(p[0] * (g.dim === DIM.NETHER ? 8 : 1)) + 0.5, 120, Math.floor(p[2] * (g.dim === DIM.NETHER ? 8 : 1)) + 0.5];
        g.changeDimension(d, g.dim === DIM.END && d === DIM.OVERWORLD ? g.spawn : target, { portal: d === DIM.NETHER || (g.dim === DIM.NETHER && d === DIM.OVERWORLD) });
        return;
      }
      case 'time': {
        if (parts[0] === 'set') {
          const v = TIMES[parts[1]] ?? (Number(parts[1]) / 24000 + 0.75) % 1;
          if (!Number.isFinite(v)) return err('Usage: /time set <day|noon|night|midnight|ticks>');
          g.dayTime = ((TIMES[parts[1]] !== undefined ? v : (Number(parts[1]) / 24000 + 0.0) % 1) + 1) % 1;
          return out(`Set the time to ${parts[1]}`);
        }
        if (parts[0] === 'add') { g.dayTime = (g.dayTime + Number(parts[1] || 0) / 24000 + 1) % 1; return out(`Added ${parts[1]} ticks`); }
        return out(`The time is ${Math.floor(g.dayTime * 24000)} (day ${g.day + 1})`);
      }
      case 'weather': {
        const w = g.weather, dur = Number(parts[1]) || 600;
        if (parts[0] === 'clear') { w.target = 0; w.thunderOn = false; w.timer = dur; }
        else if (parts[0] === 'rain') { w.target = 1; w.thunderOn = false; w.timer = dur; }
        else if (parts[0] === 'thunder') { w.target = 1; w.thunderOn = true; w.timer = dur; }
        else return err('Usage: /weather <clear|rain|thunder>');
        return out(`Changing to ${parts[0]}`);
      }
      case 'give': {
        let [a, b, c] = parts;
        if (a && a.startsWith('@')) { a = b; b = c; }
        const key = (a || '').replace(/^minecraft:/, '');
        if (!I[key]) return err(`Unknown item '${key}'`);
        const n = Math.max(1, Math.min(6400, Number(b) || 1));
        let left = n;
        while (left > 0) { const k = Math.min(left, I[key].stack); const rest = g.inv.add({ key, count: k }); if (rest) g.dropStack({ key, count: rest }); left -= k; }
        g.sound.play('pop', null, 0.5);
        return out(`Gave ${n} [${I[key].name}]`);
      }
      case 'summon': {
        const t = (parts[0] || '').replace(/^minecraft:/, '');
        if (!MOBS[t] && t !== 'lightning_bolt' && t !== 'tnt') return err(`Unknown entity '${t}'`);
        const f = g.lookDir();
        const x = this.coord(parts[1], p[0] + f[0] * 3), y = this.coord(parts[2], p[1]), z = this.coord(parts[3], p[2] + f[2] * 3);
        if (t === 'lightning_bolt') { g.app.summonLightning(x, y, z); return out('Summoned new Lightning Bolt'); }
        if (t === 'tnt') { g.igniteTnt(Math.floor(x), Math.floor(y), Math.floor(z)); return out('Summoned new Primed TNT'); }
        g.spawnMob(t, x, y, z, { persistent: true });
        return out(`Summoned new ${MOBS[t].name}`);
      }
      case 'kill': {
        const sel = parts[0] || '@s';
        if (sel === '@s' || sel === '@p') { g.damagePlayer(1e9, { kind: 'kill' }); if (g.mode === 'creative') out('Creative players can’t be killed; switch to survival first', '#aaaaaa'); return; }
        const m = sel.match(/^@e(?:\[type=(?:minecraft:)?(\w+)\])?$/);
        if (!m) return err('Usage: /kill [@s|@e|@e[type=zombie]]');
        let n = 0;
        for (const e of g.entities.list) if ((!m[1] || e.mobType === m[1] || e.type === m[1]) && !e.dead) { if (e.isLiving && e.hurt) e.hurt(1e9, { kind: 'kill' }); e.dead = true; n++; }
        return out(`Killed ${n} entities`);
      }
      case 'clear': {
        const key = parts[0] && parts[0] !== '@s' ? parts[0].replace(/^minecraft:/, '') : parts[1];
        if (key) { const n = g.inv.main.remove(k => k === key, 1e9); return out(`Removed ${n} items`); }
        g.inv.clearAll(); return out('Cleared inventory');
      }
      case 'setblock': {
        const x = Math.floor(this.coord(parts[0], p[0])), y = Math.floor(this.coord(parts[1], p[1])), z = Math.floor(this.coord(parts[2], p[2]));
        const s = this.blockState(parts[3] || '');
        if (!s) return err(`Unknown block '${parts[3]}'`);
        if (!g.world.setBlock(x, y, z, s[0], s[1])) return err('That position is not loaded');
        return out(`Changed the block at ${x}, ${y}, ${z}`);
      }
      case 'fill': {
        const c = parts.slice(0, 6).map((v, i) => Math.floor(this.coord(v, p[i % 3])));
        if (c.some(v => !Number.isFinite(v))) return err('Usage: /fill x1 y1 z1 x2 y2 z2 block');
        const s = this.blockState(parts[6] || '');
        if (!s) return err(`Unknown block '${parts[6]}'`);
        const mode = parts[7] || 'replace';
        const [x0, x1] = [Math.min(c[0], c[3]), Math.max(c[0], c[3])], [y0, y1] = [Math.max(0, Math.min(c[1], c[4])), Math.min(255, Math.max(c[1], c[4]))], [z0, z1] = [Math.min(c[2], c[5]), Math.max(c[2], c[5])];
        const vol = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1);
        if (vol > 32768 * 4) return err(`Too many blocks in the specified area (${vol} > 131072)`);
        let n = 0;
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
          const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
          if ((mode === 'hollow' || mode === 'outline') && !edge) { if (mode === 'hollow') g.world.setBlock(x, y, z, B.AIR, 0, false); continue; }
          if (g.world.setBlock(x, y, z, s[0], s[1], false)) n++;
        }
        return out(`Successfully filled ${n} blocks`);
      }
      case 'locate': {
        let what = (parts[0] === 'structure' || parts[0] === 'biome' ? parts[1] : parts[0]) || '';
        what = what.replace(/^minecraft:/, '');
        const biome = BIOMES.find(b => b.key === what);
        if (biome) {
          const r = this.findBiome(biome.id);
          return r ? out(`The nearest ${biome.name} is at ${r[0]}, ~, ${r[1]} (${Math.round(Math.hypot(r[0] - p[0], r[1] - p[2]))} blocks away)`, '#55ff55') : err(`Could not find a ${biome.name} within 3000 blocks`);
        }
        if (!STRUCTURES.includes(what)) return err(`Usage: /locate <${STRUCTURES.join('|')}|biome>`);
        out('Searching…', '#aaaaaa');
        g.world.locate(what, p[0], p[2], r => { if (r) out(`The nearest ${what.replace(/_/g, ' ')} is at ${r.x}, ${r.y ?? '~'}, ${r.z} (${Math.round(Math.hypot(r.x - p[0], r.z - p[2]))} blocks away)`, '#55ff55'); else err(`Could not find a ${what.replace(/_/g, ' ')} nearby in this dimension`); });
        return;
      }
      case 'seed': return out(`Seed: [${g.seed}]`);
      case 'difficulty': {
        const d = (parts[0] || '').toLowerCase();
        if (!['peaceful', 'easy', 'normal', 'hard'].includes(d)) return out(`The difficulty is ${g.difficulty}`);
        if (g.hardcore) return err('Difficulty is locked in hardcore worlds');
        g.difficulty = d;
        if (d === 'peaceful') for (const e of g.entities.list) if (e.def && e.def.kind === 'hostile') e.dead = true;
        return out(`The difficulty has been set to ${d}`);
      }
      case 'gamerule': {
        const r = parts[0];
        if (!r) return out('Rules: ' + Object.entries(g.rules).map(([k, v]) => `${k}=${v}`).join(', '));
        if (!(r in g.rules)) return err(`Unknown game rule '${r}'`);
        if (parts[1] === undefined) return out(`Gamerule ${r} is currently set to: ${g.rules[r]}`);
        g.rules[r] = parts[1] === 'true';
        return out(`Gamerule ${r} is now set to: ${g.rules[r]}`);
      }
      case 'spawnpoint': g.spawn = p.slice(); return out(`Set spawn point to ${p.map(v => v.toFixed(1)).join(', ')}`);
      case 'effect': {
        if (parts[0] === 'clear') { g.stats.effects = {}; g.stats.absorption = 0; return out('Removed every effect'); }
        let [, a, b, c, d] = parts;
        if (a && a.startsWith('@')) { a = b; b = c; c = d; }
        const e = (a || '').replace(/^minecraft:/, '');
        if (!EFFECTS.includes(e)) return err(`Unknown effect. Try: ${EFFECTS.join(', ')}`);
        const secs = Number(b) || 30;
        if (e === 'instant_health') g.stats.health = Math.min(g.stats.maxHealth, g.stats.health + 4 * (Number(c) || 1));
        else g.addEffect(e, secs, Number(c) || 1);
        if (e === 'jump_boost') g.player.jumpBoost = Number(c) || 1;
        return out(`Applied effect ${e} for ${secs}s`);
      }
      case 'xp': case 'experience': {
        const n = Number(parts[0] === 'add' ? parts[2] : parts[0]) || 0;
        const lv = (parts[1] === 'levels' || parts[3] === 'levels' || String(parts[0]).endsWith('L'));
        if (lv) g.stats.level = Math.max(0, g.stats.level + parseInt(parts[0], 10)); else g.addXp(n);
        return out(lv ? `Gave ${parseInt(parts[0], 10)} levels` : `Gave ${n} experience points`);
      }
      case 'heal': Object.assign(g.stats, { health: g.stats.maxHealth, food: 20, sat: 5, fire: 0 }); return out('Healed');
      case 'say': return out(`[Player] ${parts.join(' ')}`);
      case 'me': return out(`* Player ${parts.join(' ')}`);
      case 'list': return out('There is 1 of a max of 1 players online: Player');
      case 'enchant': {
        // /enchant [@s] <enchantment> [level], on the held item, with the original's checks.
        let [a, b, c] = parts;
        if (a && a.startsWith('@')) { a = b; b = c; }
        const id = (a || '').replace(/^minecraft:/, ''), e = ENCHANTS[id], lvl = b === undefined ? 1 : parseInt(b, 10);
        if (!e) return err(`Unknown enchantment '${id}'`);
        const held = g.inv.held;
        if (!held) return err('Player is not holding an item');
        if (!canEnchant(id, held.key, { anvil: true })) return err(`${I[held.key].name} cannot support that enchantment`);
        if (!(lvl >= 1) || lvl > e.max) return err(`${lvl} is higher than the maximum level of ${e.max} supported by that enchantment`);
        const cur = enchantsOf(held);
        for (const o of Object.keys(cur)) if (o !== id && !compatible(id, o)) return err(`${enchantName(o, cur[o])} can't be combined with ${e.name}`);
        setEnchants(held, { ...cur, [id]: lvl });
        g.inv.main.changed(); g.inv.offhand.changed();
        return out(`Applied enchantment ${enchantName(id, lvl)} to Player's item`);
      }
      default: return err(`Unknown command '/${cmd}'. Type /help for a list.`);
    }
  }
  findBiome(id) {
    const g = this.g, p = g.player.pos, gen = g.app.generator;
    for (let r = 0; r < 3000; r += 32) for (let a = 0; a < Math.max(1, r / 8); a++) {
      const t = a / Math.max(1, r / 8) * Math.PI * 2, x = Math.round(p[0] + Math.cos(t) * r), z = Math.round(p[2] + Math.sin(t) * r);
      if (gen.biomeAt(x, z) === id) return [x, z];
    }
    return null;
  }
  // Suggestions for the chat line.
  suggest(line) {
    if (!line.startsWith('/')) return [];
    const parts = line.slice(1).split(' ');
    if (parts.length === 1) return Object.keys(COMMANDS).filter(c => c.startsWith(parts[0])).map(c => `/${c} ${COMMANDS[c].args}`);
    const cmd = parts[0], last = parts[parts.length - 1];
    const pool = {
      gamemode: ['survival', 'creative', 'adventure', 'spectator'], dimension: ['overworld', 'nether', 'end'], weather: ['clear', 'rain', 'thunder'],
      difficulty: ['peaceful', 'easy', 'normal', 'hard'], time: parts.length === 2 ? ['set', 'add', 'query'] : Object.keys(TIMES),
      enchant: parts.length === 2 ? Object.keys(ENCHANTS) : [], give: ITEMS.map(i => i.key), summon: [...Object.keys(MOBS), 'lightning_bolt', 'tnt'], setblock: parts.length === 5 ? Object.keys(STATE) : [], fill: parts.length === 8 ? Object.keys(STATE) : [],
      locate: [...STRUCTURES, ...BIOMES.map(b => b.key)], gamerule: Object.keys(this.g.rules), effect: parts.length === 2 ? ['give', 'clear'] : EFFECTS, kill: ['@s', '@e', ...Object.keys(MOBS).map(m => `@e[type=${m}]`)],
    }[cmd] || [];
    return pool.filter(s => s.startsWith(last)).slice(0, 12);
  }
}

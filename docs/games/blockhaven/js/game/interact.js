// Player actions: mining, placing, using items and blocks, attacking.
import { meleeDamage, isCrit, knockStrength, isSword, SHIELD_DELAY, SHIELD_DISABLE, enchantDamage, enchLv, sweepDamage } from './combat.js?v=musn9kyc';
import { B, BLOCKS, SOLID, OPAQUE, SHAPE_OF, SHAPE, props, st, DIM, FACING_SHIFT, AXIS_SHIFT, VARIANT_MASK, CHEST_DIRS, chestType, chestPartner } from '../data/blocks.js?v=musn9kyc';
import { I, breakTime } from '../data/items.js?v=musn9kyc';
import { enchantWithLevels } from '../data/enchantments.js?v=musn9kyc';
import { collisionBoxes, selectionBoxes } from '../data/shapes.js?v=musn9kyc';
import { UNLOADED, posKey } from '../world/world.js?v=musn9kyc';
import { forward } from '../core/math.js?v=musn9kyc';
import { CompoundContainer } from './inventory.js?v=musn9kyc';
import { KIND } from './redstone.js?v=musn9kyc';

const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
export const CROSSBOW_CHARGE = 1.25; // seconds (25 ticks)
// Quick Charge takes 0.25 s off per level.
// The original's fishing loot: fish, junk or treasure, with Luck of the Sea shifting the odds
// from junk towards treasure. Treasure gear comes enchanted.
export function fishingLoot(luck = 0) {
  const pick = list => { let t = 0; for (const [, w] of list) t += w; let n = Math.random() * t; for (const [k, w] of list) { n -= w; if (n < 0) return k; } return list[0][0]; };
  const cat = pick([['fish', 85 - luck], ['junk', Math.max(0, 10 - 2 * luck)], ['treasure', 5 + 2 * luck]]);
  if (cat === 'fish') return { key: pick([['cod', 60], ['salmon', 25], ['tropical_fish', 2], ['pufferfish', 13]]), count: 1 };
  if (cat === 'junk') {
    const k = pick([['lily_pad', 17], ['leather_boots', 10], ['leather', 10], ['bone', 10], ['bowl', 10], ['string', 5], ['fishing_rod', 2], ['stick', 5], ['ink_sac', 1], ['tripwire_hook', 10], ['rotten_flesh', 10]]);
    const s = { key: I[k] ? k : 'stick', count: k === 'ink_sac' ? 10 : 1 };
    if (I[s.key] && I[s.key].durability) s.dmg = Math.floor(I[s.key].durability * (0.1 + Math.random() * 0.8));
    return s;
  }
  const k = pick([['name_tag', 1], ['saddle', 1], ['nautilus_shell', 1], ['bow', 1], ['fishing_rod', 1], ['book', 1]]);
  const s = { key: k, count: 1 };
  if (k === 'bow' || k === 'fishing_rod') { s.dmg = Math.floor(I[k].durability * Math.random() * 0.25); enchantWithLevels(s, 30, Math.random, true); }
  if (k === 'book') enchantWithLevels(s, 30, Math.random, true);
  return s;
}
export const crossbowCharge = s => CROSSBOW_CHARGE - 0.25 * enchLv(s, 'quick_charge');
export const dirIndex = (x, z) => (Math.abs(x) > Math.abs(z) ? (x > 0 ? 3 : 1) : (z > 0 ? 0 : 2));
const CROP_OF = { wheat: 0, carrots: 1, potatoes: 2, beetroots: 3, pumpkin_stem: 4, melon_stem: 5, nether_wart: 6 };
const INTERACTIVE = new Set(['crafting_table', 'furnace', 'chest', 'bed', 'door', 'trapdoor', 'misc', 'end_portal_frame', 'tnt', 'campfire']);

export class Interact {
  constructor(game) {
    this.g = game;
    this.target = null; this.entityTarget = null;
    this.breakKey = ''; this.progress = 0; this.hitT = 0; this.cooldown = 0; this.placeT = 0;
    this.useT = 0; this.using = null; this.swing = 0; this.equip = 0; this.fish = null;
  }
  get reach() { return this.g.mode === 'creative' ? 5 : 4.5; }

  // Finds the block and entity under the crosshair.
  pick() {
    const g = this.g, p = g.player, eye = p.eyePos(), dir = forward(p.yaw, p.pitch);
    this.target = g.mode === 'spectator' ? null : g.world.raycast(eye, dir, this.reach);
    let best = null, bt = this.target ? this.target.t : this.reach;
    if (g.mode !== 'spectator') for (const e of g.entities.near(eye, this.reach + 9, o => o.isLiving && !o.dead && !(o.deathT > 0) && o !== g.riding)) {
      const pad = 0.1;
      // Big mobs (the dragon) add boxes for parts outside their main one, like its head and neck.
      for (const b of [[e.pos[0] - e.hw, e.pos[1], e.pos[2] - e.hw, e.pos[0] + e.hw, e.pos[1] + e.h, e.pos[2] + e.hw], ...((e.partBoxes && e.partBoxes()) || [])]) {
        const t = g.world.rayBox(eye, dir, [b[0] - pad, b[1] - pad, b[2] - pad, b[3] + pad, b[4] + pad, b[5] + pad]);
        if (t && t.t < bt) { best = e; bt = t.t; }
      }
    }
    this.entityTarget = best;
    if (best) this.target = null;
  }

  update(dt, input) {
    const g = this.g;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.swing = Math.max(0, this.swing - dt / 0.3);
    this.equip = Math.max(0, this.equip - dt / 0.25);
    const held = g.inv.held, it = held && I[held.key];
    g.attackCooldown = Math.min(1, (g.attackCooldown ?? 1) + dt * (it && it.attackSpeed ? it.attackSpeed : 4));
    this.pick();
    if (!g.alive || g.mode === 'spectator') { this.progress = 0; return; }
    // Attack / mine.
    if (input.attackClicked && this.entityTarget) this.attack(this.entityTarget);
    if (input.attackClicked && this.target && this.target.id === B.NOTE_BLOCK) g.rs.attack(this.target.x, this.target.y, this.target.z);
    else if ((input.attack || input.attackClicked) && this.target && !this.using) this.mine(dt, input.attackClicked);
    else { this.progress = 0; this.breakKey = ''; if (input.attackClicked) this.swing = 1; }
    // Use.
    if (input.useClicked) this.useHands();
    if (this.using) {
      g.inv.hand = this.usingHand || 'main';
      if (input.use) this.useHold(dt);
      else this.useRelease();
      g.inv.hand = 'main';
    } else if (input.use && this.placeT > 0) {
      this.placeT -= dt;
      if (this.placeT <= 0) { this.useHands(true); }
    }
    this.swingOff = Math.max(0, (this.swingOff || 0) - dt / 0.3);
    g.blocking = this.using === 'shield';
    this.blockT = g.blocking ? (this.blockT || 0) + dt : 0;
    g.blockReady = this.blockT >= SHIELD_DELAY;
    // Any item in use (including a raised shield) slows you to a crawl, as in the original.
    g.player.usingItem = !!this.using;
    if (this.fish) this.fishTick(dt);
  }

  // ---------------- mining ----------------
  mine(dt, clicked) {
    const g = this.g, t = this.target;
    const key = `${t.x},${t.y},${t.z}`;
    if (key !== this.breakKey) { this.breakKey = key; this.progress = 0; this.hitT = 0; }
    if (this.cooldown > 0) return;
    const p = props(t.id, t.meta), held = g.inv.held, it = held && I[held.key];
    if (g.mode === 'adventure') return;
    if (g.mode === 'creative') {
      if (!clicked && this.progress < 0) return;
      if (it && it.tool && it.tool.type === 'sword') return;
      this.breakAt(t); this.cooldown = 0.2; if (this.swing < 0.5) this.swing = 1;
      return;
    }
    // Mining Fatigue (from Elder Guardians) makes digging roughly ten times slower.
    // Efficiency speeds up the right tool; Aqua Affinity on a helmet lifts the underwater slowdown.
    const aqua = enchLv(g.inv.armor.get(0), 'aqua_affinity') > 0;
    const time = breakTime(p, it, { onGround: g.player.onGround || g.player.flying, inWater: g.player.headInWater && !aqua, efficiency: enchLv(held, 'efficiency') }) * (g.stats.effects.mining_fatigue ? 10 : 1);
    if (time === Infinity) return;
    this.hitT -= dt;
    if (this.swing <= 0) this.swing = 1; // keep the arm swinging in a smooth loop while digging
    if (this.hitT <= 0) { this.hitT = 0.25; g.sound.hit(p.sound, [t.x + 0.5, t.y + 0.5, t.z + 0.5]); g.particles.block(t.x, t.y, t.z, t.id, t.meta, 2); }
    this.progress += time === 0 ? 1 : dt / time;
    if (this.progress >= 1) { this.breakAt(t); this.cooldown = time === 0 ? 0.05 : 0.3; }
  }
  breakAt(t) {
    const g = this.g, held = g.inv.held, it = held && I[held.key];
    g.breakBlock(t.x, t.y, t.z, { tool: held, player: true });
    this.progress = 0; this.breakKey = '';
    g.exhaust(0.005);
    if (g.mode !== 'creative' && it && it.durability && props(t.id, t.meta).hardness > 0) {
      if (g.inv.damageHeld(it.tool && it.tool.type === 'sword' ? 2 : 1)) g.sound.play('break_item', null, 0.8);
    }
  }
  // An axe hit knocked the raised shield away: it can't be raised again for 5 seconds.
  disableShield() {
    const g = this.g;
    if (this.using === 'shield') { this.using = null; this.useT = 0; }
    g.blocking = false; g.blockReady = false; this.blockT = 0;
    g.setCooldown('shield', SHIELD_DISABLE);
  }
  crackStage() { return this.progress > 0 && this.target ? Math.min(9, Math.floor(this.progress * 10)) : -1; }

  // ---------------- combat ----------------
  attack(e) {
    const g = this.g, held = g.inv.held, it = held && I[held.key];
    this.swing = 1;
    const cd = g.attackCooldown, p = g.player;
    const crit = isCrit(p, cd) && !p.sprinting;
    // Enchantment bonus scales with the charge but isn't boosted by crits (as in the original).
    const bonus = enchantDamage(held, e) * cd;
    const dmg = meleeDamage(held && held.key, cd, { crit, strength: g.stats.effects.strength ? 1 : 0, weakness: g.stats.effects.weakness ? 1 : 0 }) + bonus;
    const f = forward(p.yaw, 0);
    const sprintHit = p.sprinting && cd > 0.9;
    const kb = enchLv(held, 'knockback');
    const ok = e.hurt(dmg, { kind: 'player', attacker: g.playerEntity, weapon: held && held.key, looting: enchLv(held, 'looting'), knock: [f[0], f[2]], knockStrength: knockStrength(sprintHit) + kb * 4.5 });
    if (ok) {
      g.lastTarget = e;
      const fa = enchLv(held, 'fire_aspect');
      if (fa && e.setFire) e.setFire(4 * fa);
      if (bonus > 0) g.particles.fx('crit', e.center(), 8, 0.4, 2, [0.7, 0.4, 1]);
      if (crit) { g.sound.play('crit', e.pos, 0.7); g.particles.fx('crit', e.center(), 12, 0.4, 3); } else g.sound.play(cd > 0.9 ? 'attack' : 'attack', e.pos, cd > 0.9 ? 0.6 : 0.35);
      // Damage indicator: dark hearts, one per two points dealt.
      const n = Math.min(10, Math.floor(dmg / 2));
      if (n > 0) g.particles.fx('heart', [e.pos[0], e.pos[1] + (e.h || 1) * 0.6, e.pos[2]], n, 0.35, 1.2, [0.35, 0.05, 0.05]);
      // Sweep attack with swords.
      if (isSword(held && held.key) && cd > 0.9 && p.onGround && !p.sprinting && !crit) {
        for (const o of g.entities.near(e.pos, 1.5, x => x.isLiving && x !== e && !x.tamed && x.mobType !== 'villager')) o.hurt(sweepDamage(held, dmg), { kind: 'player', attacker: g.playerEntity, knock: [f[0], f[2]], knockStrength: 5 });
        g.sound.play('sweep', e.pos, 0.5);
      }
      if (sprintHit) p.sprinting = false;
      if (g.mode !== 'creative' && it && it.durability) if (g.inv.damageHeld(it.tool && it.tool.type === 'sword' ? 1 : 2)) g.sound.play('break_item', null, 0.8);
      g.exhaust(0.1);
    }
    g.attackCooldown = 0;
  }

  // ---------------- use ----------------
  useStart(repeat = false) {
    const g = this.g, held = g.inv.held, it = held && I[held.key], t = this.target, p = g.player;
    this.placeT = 0.22;
    if (g.mode === 'spectator') return;
    // Entities first.
    if (this.entityTarget && !repeat) { if (this.entityTarget.interact && this.entityTarget.interact(held)) { this.swing = 1; this.acted = true; return; } }
    // Blocks with their own interaction (unless sneaking with an item).
    if (t && !(p.sneaking && held) && !repeat && this.useBlock(t, held)) { this.swing = 1; this.acted = true; return; }
    if (!it) return;
    if (t && !repeat && this.toolUse(t)) { this.acted = true; return; }
    // Held-use items.
    if (it.food) { if (g.stats.food < 20 || it.key === 'golden_apple' || it.key === 'enchanted_golden_apple' || it.key === 'chorus_fruit' || it.food.milk || g.mode === 'creative' || g.difficulty === 'peaceful') { this.using = 'eat'; this.useT = 0; this.acted = true; } else if (!repeat && g.app.showAction) g.app.showAction("You're full — hold right click to eat when your hunger bar isn't full", 2); return; }
    if (it.kind === 'bow') {
      // A charged crossbow fires at once; otherwise start drawing (bow) or loading (crossbow).
      if (it.crossbow && held.tag && held.tag.loaded) { this.fireCrossbow(held); this.acted = true; return; }
      const rocket = it.crossbow && this.offhandRocket();
      if (g.mode === 'creative' || rocket || g.inv.main.count('arrow') > 0 || g.inv.main.count('spectral_arrow') > 0) {
        this.using = it.crossbow ? 'crossbow' : 'bow'; this.useT = 0; this.xbowSounds = 0;
        if (!it.crossbow) g.sound.play('bow_draw', null, 0.5);
        this.acted = true;
      }
      return;
    }
    if (it.kind === 'shield') { if (!g.onCooldown('shield')) { this.using = 'shield'; this.blockT = 0; } this.acted = true; return; }
    if (it.kind === 'trident') { this.using = 'trident'; this.useT = 0; this.acted = true; return; }
    if (it.kind === 'armor') {
      const slot = it.armor.slot;
      if (!g.inv.armor.get(slot)) { g.inv.armor.set(slot, { ...held, count: 1 }); g.inv.consumeHeld(); g.sound.play('equip', null, 0.6); this.equip = 1; this.acted = true; }
      return;
    }
    if (it.use) { this.useItem(it, held, t); this.acted = true; return; }
    if (it.place && t) { this.plantSeed(t, it, held); this.acted = true; return; }
    if ((it.block || it.placeBlock) && t) { this.place(t, it, held); this.acted = true; }
    else if (it.key === 'carved_pumpkin' && !g.inv.armor.get(0)) { g.inv.armor.set(0, { ...held, count: 1 }); g.inv.consumeHeld(); }
  }
  // Right click: the main hand acts first; if it does nothing, the off-hand item gets a turn
  // (torches, food, a shield, a bow, blocks...).
  useHands(repeat = false) {
    const g = this.g, inv = g.inv;
    this.acted = false; inv.hand = 'main';
    this.useStart(repeat);
    if (this.acted) { this.usingHand = 'main'; return; }
    if (!inv.offhand.get(0)) return;
    const swing = this.swing;
    inv.hand = 'off';
    try { this.useStart(repeat); } finally { inv.hand = 'main'; }
    if (this.acted) { this.usingHand = 'off'; this.swing = swing; this.swingOff = 1; }
  }
  useHold(dt) {
    const g = this.g, held = g.inv.held;
    this.useT += dt;
    if (!held) { this.using = null; return; }
    if (this.using === 'eat') {
      if (Math.floor(this.useT * 5) !== Math.floor((this.useT - dt) * 5)) { g.sound.play(I[held.key].drink || I[held.key].food.milk ? 'drink' : 'eat', g.player.pos, 0.5); g.particles.block(Math.floor(g.player.pos[0]), Math.floor(g.player.pos[1] + 1), Math.floor(g.player.pos[2]), B.MELON, 0, 0); }
      if (this.useT >= (I[held.key].key === 'dried_kelp' ? 0.8 : 1.6)) {
        const key = held.key;
        g.eat(key);
        if (g.mode !== 'creative') { g.inv.consumeHeld(); if (key === 'milk_bucket') g.inv.add({ key: 'bucket', count: 1 }); }
        this.using = null;
      }
    } else if (this.using === 'crossbow') {
      // Loading sounds at 20% and 50% of the charge, like the original; it loads on release.
      const f = this.useT / crossbowCharge(held);
      if (f >= 0.2 && this.xbowSounds < 1) { this.xbowSounds = 1; g.sound.play('xbow_start', null, 0.6); }
      if (f >= 0.5 && this.xbowSounds < 2) { this.xbowSounds = 2; g.sound.play('xbow_mid', null, 0.6); }
    }
  }
  useRelease() {
    const g = this.g, held = g.inv.held;
    if (this.using === 'bow' && held) {
      const t = Math.min(1, this.useT / 1);
      const power = Math.min(1, (t * t + t * 2) / 3);
      if (power >= 0.1) this.fireArrow(power, false);
    }
    if (this.using === 'crossbow' && held && held.key === 'crossbow' && this.useT >= crossbowCharge(held) && !(held.tag && held.tag.loaded)) {
      // Load: a firework rocket from the off-hand takes priority, then arrows.
      const creative = g.mode === 'creative';
      let rocket = false;
      const off = this.offhandRocket();
      if (off) { rocket = true; if (!creative) { off.count--; g.inv.offhand.set(0, off.count ? off : null); } }
      else if (!creative) { const k = g.inv.main.count('arrow') ? 'arrow' : 'spectral_arrow'; g.inv.main.remove(x => x === k, 1); }
      held.tag = { ...(held.tag || {}), loaded: true, rocket };
      g.inv.main.changed(); g.inv.offhand.changed();
      g.sound.play('xbow_load', null, 0.7);
    }
    if (this.using === 'trident' && held && this.useT > 0.5) {
      // Thrown at 2.5 blocks/tick plus the thrower's motion; the throw costs 1 durability.
      const p = g.player, f = forward(p.yaw, p.pitch), e = p.eyePos();
      const dmg = (held.dmg || 0) + (g.mode === 'creative' ? 0 : 1);
      if (dmg < I.trident.durability) g.shootProjectile('trident', e, [f[0] * 50 + p.vel[0], f[1] * 50 + (p.onGround ? 0 : p.vel[1]), f[2] * 50 + p.vel[2]], g.playerEntity, { pickup: g.mode !== 'creative', stack: held.tag ? { dmg, tag: held.tag } : { dmg } });
      else g.sound.play('break_item', null, 0.8);
      if (g.mode !== 'creative') g.inv.consumeHeld();
      g.sound.play('throw', null, 0.8);
      this.swing = 1;
    }
    this.using = null; this.useT = 0;
  }
  fireArrow(power, crossbow) {
    const g = this.g, p = g.player, f = forward(p.yaw, p.pitch), e = p.eyePos();
    const creative = g.mode === 'creative';
    let kind = 'arrow';
    const bow = g.inv.held, inf = enchLv(bow, 'infinity') > 0;
    // Infinity: a plain arrow isn't used up (but can't be picked back up either).
    if (!crossbow && !creative && !(inf && g.inv.main.count('arrow'))) {
      const k = g.inv.main.count('arrow') ? 'arrow' : 'spectral_arrow';
      g.inv.main.remove(x => x === k, 1);
      kind = 'arrow';
    }
    // Bow: power*3 blocks/tick; crossbow: 3.15 blocks/tick and always critical. Both get the
    // original's tiny random spread (divergence 1).
    const speed = (crossbow ? 3.15 : power * 3) * 20;
    const gauss = () => { let u = 0; for (let k = 0; k < 6; k++) u += Math.random(); return (u - 3) / Math.SQRT2; };
    const d = [f[0] + gauss() * 0.0075, f[1] + gauss() * 0.0075, f[2] + gauss() * 0.0075], dl = Math.hypot(...d);
    const pw = enchLv(bow, 'power');
    g.shootProjectile(kind, [e[0] + f[0] * 0.3, e[1] - 0.1, e[2] + f[2] * 0.3], [d[0] / dl * speed + p.vel[0], d[1] / dl * speed + (p.onGround ? 0 : p.vel[1]), d[2] / dl * speed + p.vel[2]], g.playerEntity, {
      crit: crossbow || power >= 1, pickup: !creative && !inf, power: 1,
      // Power: +0.5 damage per level plus 0.5; Punch: extra knockback; Flame: burning arrows.
      damage: 2 + (pw ? pw * 0.5 + 0.5 : 0), punch: enchLv(bow, 'punch'), onFire: enchLv(bow, 'flame') > 0,
    });
    g.sound.play('bow', null, 0.7, 0.9 + power * 0.3);
    if (!creative && g.inv.damageHeld(1)) g.sound.play('break_item', null, 0.8);
    this.advanceShot();
  }
  offhandRocket() { const o = this.g.inv.offhand.get(0); return o && o.key === 'firework_rocket' ? o : null; }
  // Crossbow: arrows at 3.15 blocks/tick (always critical), rockets at 1.6, spread 1.
  fireCrossbow(held) {
    const g = this.g, p = g.player, f = forward(p.yaw, p.pitch), e = p.eyePos();
    const rocket = !!(held.tag && held.tag.rocket);
    const multi = enchLv(held, 'multishot') > 0, pierce = enchLv(held, 'piercing');
    if (held.tag) { delete held.tag.loaded; delete held.tag.rocket; if (!Object.keys(held.tag).length) delete held.tag; }
    g.inv.main.changed(); g.inv.offhand.changed();
    const gauss = () => { let u = 0; for (let k = 0; k < 6; k++) u += Math.random(); return (u - 3) / Math.SQRT2; };
    const d = [f[0] + gauss() * 0.0075, f[1] + gauss() * 0.0075, f[2] + gauss() * 0.0075], dl = Math.hypot(...d);
    const speed = (rocket ? 1.6 : 3.15) * 20;
    const from = [e[0] + f[0] * 0.3, e[1] - 0.1, e[2] + f[2] * 0.3];
    const vel = [d[0] / dl * speed + p.vel[0], d[1] / dl * speed + (p.onGround ? 0 : p.vel[1]), d[2] / dl * speed + p.vel[2]];
    // Multishot: two more shots 10 degrees to either side (those can't be picked up).
    const turn = (v, a) => [v[0] * Math.cos(a) - v[2] * Math.sin(a), v[1], v[0] * Math.sin(a) + v[2] * Math.cos(a)];
    for (const a of multi ? [0, -0.1745, 0.1745] : [0]) {
      const v = a ? turn(vel, a) : vel;
      if (rocket) g.shootProjectile('firework', from, v, g.playerEntity, { fuse: 1.2 + Math.random() * 0.4 });
      else g.shootProjectile('arrow', from, v, g.playerEntity, { crit: true, pickup: g.mode !== 'creative' && !a, power: 1, pierce });
    }
    g.sound.play('xbow_shoot', null, 0.8, 0.9 + Math.random() * 0.2);
    if (g.mode !== 'creative' && g.inv.damageHeld(rocket ? 3 : 1)) g.sound.play('break_item', null, 0.8);
    this.swing = 0;
    this.advanceShot();
  }
  advanceShot() { this.g.advance('shoot', 'Take Aim', 'Shoot something with an arrow', 'bow'); }

  // Right-click on a block that reacts. Returns true if handled.
  useBlock(t, held) {
    const g = this.g, w = g.world, id = t.id, m = t.meta, b = BLOCKS[id];
    if (!b) return false;
    const key = props(id, m).key;
    // Redstone parts: the host's simulation handles the click (guests ask the host).
    if (g.rs.isUsable(id)) {
      if (id === B.REDSTONE_WIRE && (m >> 4) !== 0 && (m >> 4) !== 15) return false;
      if (g.net && !g.net.isHost) { g.net.send({ t: 'rsuse', id: g.net.myId, d: g.dim, p: [t.x, t.y, t.z] }); return true; }
      return g.rs.use(t.x, t.y, t.z);
    }
    if (b.key === 'hopper' || b.key === 'dispenser' || b.key === 'dropper') {
      let be = g.blockEntity(t.x, t.y, t.z);
      if (!be) { be = { type: b.key === 'hopper' ? 'hopper' : 'chest', x: t.x, y: t.y, z: t.z, items: [] }; w.blockEntities.set(posKey(t.x, t.y, t.z), be); }
      g.gui.openChest(g.containerOf(be, b.key === 'hopper' ? 5 : 9), b.name);
      return true;
    }
    switch (b.key) {
      case 'crafting_table': g.gui.openCrafting(); return true;
      case 'enchanting_table': g.gui.openEnchanting(t.x, t.y, t.z); return true;
      case 'anvil': g.gui.openAnvil(t.x, t.y, t.z); return true;
      case 'furnace': { let be = g.blockEntity(t.x, t.y, t.z); if (!be) { be = { type: 'furnace', x: t.x, y: t.y, z: t.z, items: [] }; w.blockEntities.set(posKey(t.x, t.y, t.z), be); } g.containerOf(be, 3); g.gui.openFurnace(be); return true; }
      case 'chest': {
        const bes = (a, b, c) => { let be = g.blockEntity(a, b, c); if (!be) { be = { type: 'chest', x: a, y: b, z: c, items: [] }; w.blockEntities.set(posKey(a, b, c), be); } return be; };
        const m = w.getMeta(t.x, t.y, t.z), d = chestPartner(m), px = d && t.x + d[0], pz = d && t.z + d[1];
        if (d && w.getBlock(px, t.y, pz) === B.CHEST && chestPartner(w.getMeta(px, t.y, pz))) {
          // (Both lids lift, and the right half's slots come first.)
          const right = chestType(m) === 2 ? [t.x, t.z] : [px, pz], left = chestType(m) === 2 ? [px, pz] : [t.x, t.z];
          const halves = [right, left].map(([a, c]) => g.containerOf(bes(a, t.y, c), 27));
          g.chestViewer(t.x, t.y, t.z, 1, true); g.chestViewer(px, t.y, pz, 1, true);
          g.gui.openChest(new CompoundContainer(halves[0], halves[1]), 'Large Chest', () => { g.chestViewer(t.x, t.y, t.z, -1, true); g.chestViewer(px, t.y, pz, -1, true); });
          return true;
        }
        const be = bes(t.x, t.y, t.z);
        g.chestViewer(t.x, t.y, t.z, 1, true); g.gui.openChest(g.containerOf(be, 27), 'Chest', () => g.chestViewer(t.x, t.y, t.z, -1, true)); return true;
      }
      case 'misc':
        if (key === 'barrel') { let be = g.blockEntity(t.x, t.y, t.z); if (!be) { be = { type: 'chest', x: t.x, y: t.y, z: t.z, items: [] }; w.blockEntities.set(posKey(t.x, t.y, t.z), be); } g.gui.openChest(g.containerOf(be, 27), 'Barrel'); return true; }
        if (key === 'note_block') { const n = ((m >> 3) + 1) % 25; w.setBlock(t.x, t.y, t.z, id, (m & 7) | (n << 3)); g.sound.tone(220 * Math.pow(2, n / 12), 220 * Math.pow(2, n / 12), 0.8, 0.25, 'triangle'); g.particles.fx('note', [t.x + 0.5, t.y + 1.2, t.z + 0.5], 1, 0, 0, [n / 24, 1 - n / 24, 0.5]); return true; }
        return false;
      case 'door': {
        if (key === 'iron_door') return false;
        const up = (m >> 6) & 1, oy = up ? t.y - 1 : t.y + 1;
        w.setBlock(t.x, t.y, t.z, id, m ^ 32);
        if (w.getBlock(t.x, oy, t.z) === B.DOOR) w.setBlock(t.x, oy, t.z, id, w.getMeta(t.x, oy, t.z) ^ 32);
        g.sound.play((m & 32) ? 'door_close' : 'door_open', [t.x, t.y, t.z], 0.7);
        return true;
      }
      case 'trapdoor': if (key === 'iron_trapdoor') return false; w.setBlock(t.x, t.y, t.z, id, m ^ 32); g.sound.play((m & 32) ? 'door_close' : 'door_open', [t.x, t.y, t.z], 0.7); return true;
      case 'bed': return this.sleep(t);
      case 'end_portal_frame':
        if (held && held.key === 'ender_eye' && !((m >> 2) & 1)) { w.setBlock(t.x, t.y, t.z, id, m | 4); if (g.mode !== 'creative') g.inv.consumeHeld(); g.sound.play('portal', [t.x, t.y, t.z], 0.6); g.checkEndPortal(t.x, t.y, t.z); return true; }
        return false;
      case 'tnt': if (held && (held.key === 'flint_and_steel' || held.key === 'fire_charge')) { g.igniteTnt(t.x, t.y, t.z); if (held.key === 'fire_charge') g.inv.consumeHeld(); else g.inv.damageHeld(1); return true; } return false;
      default: return false;
    }
  }
  sleep(t) {
    const g = this.g;
    if (g.dim !== DIM.OVERWORLD) { g.explode([t.x + 0.5, t.y + 0.5, t.z + 0.5], 5, { fire: true }); return true; }
    g.spawn = [t.x + 0.5, t.y + 0.6, t.z + 0.5];
    g.chat('Respawn point set', '#aaaaaa');
    if (g.isDay() && !g.raining) { g.chat('You can only sleep at night or during thunderstorms', '#aaaaaa'); return true; }
    const monsters = g.entities.near(g.player.pos, 8, e => e.def && e.def.kind === 'hostile');
    if (monsters.length && g.survivalLike) { g.chat('You may not rest now; there are monsters nearby', '#ff8080'); return true; }
    g.app.sleep(() => { g.dayTime = 0.0; g.day++; g.weather.target = 0; g.weather.rain = 0; g.weather.thunder = 0; g.nightsNoSleep = 0; });
    return true;
  }

  // ---------------- placing ----------------
  placePos(t) {
    const g = this.g, w = g.world;
    const tb = BLOCKS[t.id];
    if (tb && tb.replaceable && t.id !== B.WATER && t.id !== B.LAVA) return [t.x, t.y, t.z, true];
    return [t.x + t.nx, t.y + t.ny, t.z + t.nz, false];
  }
  canPlaceAt(x, y, z, id) {
    const g = this.g, w = g.world, cur = w.getBlock(x, y, z);
    if (cur === UNLOADED || y < 0 || y > 255) return false;
    if (!(cur === B.AIR || (BLOCKS[cur] && BLOCKS[cur].replaceable))) return false;
    if (SOLID[id] && g.mode !== 'spectator') {
      const boxes = collisionBoxes(id, 0, []);
      const p = g.player.pos, h = g.player.h;
      for (const b of boxes) if (x + b[3] > p[0] - 0.3 && x + b[0] < p[0] + 0.3 && y + b[4] > p[1] && y + b[1] < p[1] + h && z + b[5] > p[2] - 0.3 && z + b[2] < p[2] + 0.3) return false;
      for (const e of g.entities.near([x + 0.5, y, z + 0.5], 3, o => o.isLiving)) for (const b of boxes) if (x + b[3] > e.pos[0] - e.hw && x + b[0] < e.pos[0] + e.hw && y + b[4] > e.pos[1] && y + b[1] < e.pos[1] + e.h && z + b[5] > e.pos[2] - e.hw && z + b[2] < e.pos[2] + e.hw) return false;
    }
    return true;
  }
  place(t, it, held) {
    const g = this.g, w = g.world, p = g.player;
    let [id, meta] = it.block || it.placeBlock;
    // Slab stacking into a double slab.
    if (SHAPE_OF[id] === SHAPE.SLAB && t.id === id && (t.meta & 15) === meta) {
      const type = (t.meta >> 4) & 3;
      if ((type === 0 && t.ny === 1) || (type === 1 && t.ny === -1)) { this.commit(t.x, t.y, t.z, id, meta | (2 << 4), held); return; }
    }
    let [x, y, z, replaced] = this.placePos(t);
    if (!replaced && SHAPE_OF[id] === SHAPE.SLAB && w.getBlock(x, y, z) === id && (w.getMeta(x, y, z) & 15) === meta) { this.commit(x, y, z, id, meta | (2 << 4), held); return; }
    if (!this.canPlaceAt(x, y, z, id)) return;
    const f = forward(p.yaw, 0), look = dirIndex(f[0], f[2]), toward = (look + 2) % 4;
    if (KIND[id] && id !== B.DOOR && id !== B.TRAPDOOR && id !== B.TNT) {
      const s = g.rs.placementState(id, meta & VARIANT_MASK[id], x, y, z, t, look, forward(p.yaw, p.pitch));
      if (s < 0) return;
      this.commit(x, y, z, id, s >> 8, held);
      g.rs.placedBy(x, y, z);
      return;
    }
    const shape = SHAPE_OF[id];
    const hitY = t.box ? 0 : 0;
    void hitY;
    const fs = FACING_SHIFT[id], as = AXIS_SHIFT[id];
    const below = w.getBlock(x, y - 1, z);
    const n = [t.nx, t.ny, t.nz];
    const wallDir = n[1] === 0 ? dirIndex(-n[0], -n[2]) : -1;
    const upperHalf = (() => { const e = p.eyePos(), d = forward(p.yaw, p.pitch); const hy = e[1] + d[1] * (t.t || 0); return hy - Math.floor(hy) > 0.5; })();
    switch (shape) {
      case SHAPE.SLAB: meta |= (n[1] === -1 || (n[1] === 0 && upperHalf) ? 1 : 0) << 4; break;
      case SHAPE.STAIRS: meta |= look << 4; if (n[1] === -1 || (n[1] === 0 && upperHalf)) meta |= 64; break;
      case SHAPE.TORCH:
        if (n[1] === 1 || n[1] === 0) { if (n[1] === 0) { if (!OPAQUE[w.getBlock(x - n[0], y, z - n[2])]) return; meta |= (wallDir + 1) << 1; } else if (!SOLID[below]) return; }
        else return;
        break;
      case SHAPE.LADDER: case SHAPE.VINE: if (wallDir < 0) return; meta |= wallDir; break;
      case SHAPE.DOOR: {
        if (!SOLID[below] || !this.canPlaceAt(x, y + 1, z, id)) return;
        meta |= look << 3;
        this.commit(x, y, z, id, meta, held, false);
        w.setBlock(x, y + 1, z, id, meta | 64);
        return;
      }
      case SHAPE.TRAPDOOR: meta |= (n[1] === 0 ? wallDir : look) << 3; if (n[1] === -1 || (n[1] === 0 && upperHalf)) meta |= 64; break;
      case SHAPE.BED: {
        const [dx, dz] = DIRS[look];
        if (!this.canPlaceAt(x + dx, y, z + dz, id) || !SOLID[below]) return;
        // (meta holds the item's colour already: its variant.)
        this.commit(x, y, z, id, (meta & 15) | look << 4, held, false);
        w.setBlock(x + dx, y, z + dz, id, (meta & 15) | look << 4 | 64);
        return;
      }
      case SHAPE.LANTERN: if (n[1] === -1) meta |= 2; break;
      case SHAPE.RAIL: if (!SOLID[below]) return; meta |= look % 2; break;
      case SHAPE.CROSS: case SHAPE.CROP: {
        const soil = [B.GRASS_BLOCK, B.DIRT, B.FARMLAND, B.MOSS_BLOCK, B.SAND, B.MUD_BLOCK, B.NYLIUM, B.SOUL_SAND, B.NETHERRACK, B.END_STONE];
        if (id === B.SEAGRASS && w.getBlock(x, y, z) !== B.WATER) return;
        if (id !== B.COBWEB && id !== B.AMETHYST_CLUSTER && id !== B.POINTED_DRIPSTONE && id !== B.CAVE_VINES && !soil.includes(below) && !(id === B.SUGAR_CANE && below === B.SUGAR_CANE)) return;
        if (id === B.CAVE_VINES && !SOLID[w.getBlock(x, y + 1, z)]) return;
        break;
      }
      case SHAPE.SNOW: if (w.getBlock(x, y, z) === B.SNOW) { const l = w.getMeta(x, y, z) & 7; if (l < 7) { this.commit(x, y, z, id, l + 1, held); return; } } break;
      case SHAPE.CARPET: case SHAPE.FLAT: if (id === B.LILY_PAD ? below !== B.WATER : !SOLID[below]) return; break;
      default: break;
    }
    if (fs >= 0 && shape !== SHAPE.STAIRS && shape !== SHAPE.DOOR && shape !== SHAPE.TRAPDOOR && shape !== SHAPE.TORCH && shape !== SHAPE.LADDER && shape !== SHAPE.VINE && shape !== SHAPE.BED && shape !== SHAPE.RAIL) meta |= toward << fs;
    if (as >= 0) meta |= (n[0] !== 0 ? 1 : n[2] !== 0 ? 2 : 0) << as;
    if (id === B.CACTUS && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => SOLID[w.getBlock(x + a, y, z + b)])) return;
    if (id === B.CHEST && !g.player.sneaking) {
      const f = meta & 3, single = (a, b) => w.getBlock(a, y, b) === B.CHEST && (w.getMeta(a, y, b) & 15) === f;
      const [cx, cz] = CHEST_DIRS[(f + 1) & 3], [ax, az] = CHEST_DIRS[(f + 3) & 3];
      if (single(x + cx, z + cz)) { meta |= 1 << 2; w.setBlock(x + cx, y, z + cz, B.CHEST, f | 2 << 2); }
      else if (single(x + ax, z + az)) { meta |= 2 << 2; w.setBlock(x + ax, y, z + az, B.CHEST, f | 1 << 2); }
    }
    this.commit(x, y, z, id, meta, held);
    // Golems: pumpkin on snow/iron bodies.
    if (id === B.PUMPKIN) this.checkGolem(x, y, z);
    if (id === B.SKULL && (meta & 1) === 1) this.checkWither(x, y, z);
  }
  commit(x, y, z, id, meta, held, sound = true) {
    const g = this.g;
    if (!g.world.setBlock(x, y, z, id, meta)) return;
    if (sound) g.sound.place(props(id, meta).sound, [x + 0.5, y + 0.5, z + 0.5]);
    this.swing = 1;
    if (g.mode !== 'creative') g.inv.consumeHeld();
    if (id === B.CRAFTING_TABLE) g.advance('bench', 'Benchmarking', 'Craft a crafting table', 'crafting_table');
  }
  // Soul sand/soil T with three wither skeleton skulls on top builds the Wither.
  checkWither(x, y, z) {
    const g = this.g, w = g.world;
    const soul = (a, b, c) => w.getBlock(a, b, c) === B.SOUL_SAND;
    const skull = (a, b, c) => w.getBlock(a, b, c) === B.SKULL && (w.getMeta(a, b, c) & 1) === 1;
    for (const [ax, az] of [[1, 0], [0, 1]]) for (let o = -1; o <= 1; o++) {
      const cx = x - ax * o, cz = z - az * o, row = [-1, 0, 1];
      if (!row.every(k => skull(cx + ax * k, y, cz + az * k))) continue;
      if (!row.every(k => soul(cx + ax * k, y - 1, cz + az * k)) || !soul(cx, y - 2, cz)) continue;
      for (const k of row) { w.setBlock(cx + ax * k, y, cz + az * k, B.AIR, 0); w.setBlock(cx + ax * k, y - 1, cz + az * k, B.AIR, 0); }
      w.setBlock(cx, y - 2, cz, B.AIR, 0);
      g.spawnMob('wither', cx + 0.5, y - 2, cz + 0.5, { fresh: true, persistent: true });
      g.chat('The Wither has been summoned!', '#b44cf0');
      g.advance('summon_wither', 'Withering Heights', 'Summon the Wither', 'wither_skeleton_skull');
      return true;
    }
    return false;
  }
  checkGolem(x, y, z) {
    const g = this.g, w = g.world;
    if (w.getBlock(x, y - 1, z) === B.SNOW_BLOCK && w.getBlock(x, y - 2, z) === B.SNOW_BLOCK) {
      for (let k = 0; k < 3; k++) w.setBlock(x, y - k, z, B.AIR, 0);
      g.spawnMob('snow_golem', x + 0.5, y - 2, z + 0.5);
      return;
    }
    const iron = (a, b, c) => w.getBlock(a, b, c) === B.MINERAL_BLOCK && w.getMeta(a, b, c) === st('iron_block')[1];
    if (iron(x, y - 1, z) && iron(x, y - 2, z)) for (const [dx, dz] of [[1, 0], [0, 1]]) {
      if (iron(x + dx, y - 1, z + dz) && iron(x - dx, y - 1, z - dz)) {
        for (const [a, b, c] of [[x, y, z], [x, y - 1, z], [x, y - 2, z], [x + dx, y - 1, z + dz], [x - dx, y - 1, z - dz]]) w.setBlock(a, b, c, B.AIR, 0);
        g.spawnMob('iron_golem', x + 0.5, y - 2, z + 0.5, { persistent: true });
        g.advance('golem', 'Hired Help', 'Summon an Iron Golem', 'iron_block');
        return;
      }
    }
  }
  plantSeed(t, it, held) {
    const g = this.g, w = g.world;
    const [x, y, z] = [t.x, t.y + 1, t.z];
    if (t.ny !== 1 && it.place !== 'cave_vines') return;
    if (it.place === 'sweet_berry_bush') { if ((t.id === B.GRASS_BLOCK || t.id === B.DIRT) && w.getBlock(x, y, z) === B.AIR) this.commit(x, y, z, B.SWEET_BERRY_BUSH, 0, held); return; }
    if (it.place === 'cave_vines') { if (t.ny === -1 && w.getBlock(t.x, t.y - 1, t.z) === B.AIR) this.commit(t.x, t.y - 1, t.z, B.CAVE_VINES, 0, held); return; }
    const v = CROP_OF[it.place];
    if (v === undefined) return;
    const soil = v === 6 ? B.SOUL_SAND : B.FARMLAND;
    if (t.id !== soil || w.getBlock(x, y, z) !== B.AIR) return;
    this.commit(x, y, z, B.CROPS, v, held);
  }

  useItem(it, held, t) {
    const g = this.g, w = g.world, p = g.player, creative = g.mode === 'creative';
    const f = forward(p.yaw, p.pitch), eye = p.eyePos();
    switch (it.use) {
      case 'firework': {
        // Mid-glide: a boost. On the ground: a rocket launched at the targeted spot.
        // FireworkRocketItem.use: gliding attaches a rocket that boosts for its flight time.
        if (p.gliding) { p.addRocket((held && held.tag && held.tag.flight) || 1); g.sound.play('firework', p.pos, 1); this.swing = 1; }
        else if (t) g.launchFirework([t.x + 0.5 + t.nx * 0.6, t.y + 0.5 + t.ny * 0.6, t.z + 0.5 + t.nz * 0.6]);
        else return;
        if (!creative) g.inv.consumeHeld();
        return;
      }
      case 'bottle': {
        // Scoop dragon's breath out of a lingering cloud the crosshair passes through.
        const cloud = g.entities.list.find(e => {
          if (!e.breath || e.dead) return false;
          for (let s = 0; s <= this.reach; s += 0.25) {
            const q = [eye[0] + f[0] * s, eye[1] + f[1] * s, eye[2] + f[2] * s];
            if (Math.hypot(q[0] - e.pos[0], q[2] - e.pos[2]) < e.radius && q[1] > e.pos[1] - 0.5 && q[1] < e.pos[1] + 1.5) return true;
          }
          return false;
        });
        if (!cloud) return;
        cloud.radius -= 0.5;
        const full = { key: 'dragon_breath', count: 1 };
        if (!creative) g.inv.consumeHeld();
        if (g.inv.add(full)) g.dropStack(full);
        g.sound.play('drink', p.pos, 0.5);
        this.swing = 1;
        return;
      }
      case 'bucket': {
        const hit = w.raycast(eye, f, this.reach, { liquids: true });
        if (!hit || (hit.id !== B.WATER && hit.id !== B.LAVA) || (hit.meta & 15) !== 0) return;
        w.setBlock(hit.x, hit.y, hit.z, B.AIR, 0);
        const full = { key: hit.id === B.WATER ? 'water_bucket' : 'lava_bucket', count: 1 };
        if (!creative) { g.inv.consumeHeld(); if (g.inv.add(full)) g.dropStack(full); }
        g.sound.play('splash', [hit.x, hit.y, hit.z], 0.4);
        this.swing = 1;
        return;
      }
      case 'place_liquid': {
        if (!t) return;
        const [x, y, z] = this.placePos(t);
        const cur = w.getBlock(x, y, z);
        if (!(cur === B.AIR || (BLOCKS[cur] && BLOCKS[cur].replaceable))) return;
        if (it.liquid === 'water' && g.dim === DIM.NETHER) { g.sound.play('fizz', [x, y, z], 0.6); g.particles.smoke([x + 0.5, y + 0.5, z + 0.5], 8); }
        else w.setBlock(x, y, z, it.liquid === 'water' ? B.WATER : B.LAVA, 0);
        if (!creative) { g.inv.setHeld({ key: 'bucket', count: 1 }); }
        g.sound.play('splash', [x, y, z], 0.4);
        this.swing = 1;
        return;
      }
      case 'ignite': case 'ignite_once': {
        if (!t) return;
        const [x, y, z] = [t.x + t.nx, t.y + t.ny, t.z + t.nz];
        if (t.id === B.CAMPFIRE) return;
        if (w.getBlock(x, y, z) !== B.AIR) return;
        if (w.getBlock(x, y - 1, z) === B.OBSIDIAN || [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([a, , c]) => w.getBlock(x + a, y, z + c) === B.OBSIDIAN)) { if (g.tryLightPortal(x, y, z)) { this.afterUse(it); return; } }
        w.setBlock(x, y, z, B.FIRE, 0);
        g.sound.play('ignite', [x, y, z], 0.6);
        this.afterUse(it);
        return;
      }
      case 'throw': {
        const kind = it.projectile;
        // Ender pearls have a one-second cooldown; everything is thrown at 1.5 blocks/tick.
        if (kind === 'ender_pearl') { if (g.onCooldown('ender_pearl')) return; g.setCooldown('ender_pearl', 1); }
        g.shootProjectile(kind, [eye[0] + f[0] * 0.3, eye[1] - 0.1, eye[2] + f[2] * 0.3], [f[0] * 30 + p.vel[0], f[1] * 30 + (p.onGround ? 0 : p.vel[1]), f[2] * 30 + p.vel[2]], g.playerEntity);
        g.sound.play('throw', null, 0.6);
        if (!creative) g.inv.consumeHeld();
        this.swing = 1;
        return;
      }
      case 'eye': {
        if (g.dim !== DIM.OVERWORLD) return;
        const pr = g.shootProjectile('ender_eye', eye, [0, 3, 0], g.playerEntity);
        g.world.locate('stronghold', p.pos[0], p.pos[2], r => { if (r) pr.target = [r.x, r.z]; else pr.target = [p.pos[0] + f[0] * 20, p.pos[2] + f[2] * 20]; });
        if (!creative) g.inv.consumeHeld();
        g.sound.play('throw', null, 0.6);
        return;
      }
      case 'bone_meal':
        if (t && g.sim.boneMeal(t.x, t.y, t.z)) { g.particles.fx('happy', [t.x + 0.5, t.y + 1, t.z + 0.5], 10, 0.5); if (!creative) g.inv.consumeHeld(); this.swing = 1; }
        return;
      case 'spawn_egg': {
        if (!t) return;
        const [x, y, z] = this.placePos(t);
        const m = g.spawnMob(it.mob, x + 0.5, y, z + 0.5, { persistent: true });
        if (m) m.yaw = p.yaw + Math.PI;
        if (!creative) g.inv.consumeHeld();
        this.swing = 1;
        return;
      }
      case 'fish': {
        if (this.fish) { if (this.fish.bite > 0) { const loot = fishingLoot(enchLv(held, 'luck_of_the_sea')); if (g.inv.add(loot)) g.dropStack(loot); g.spawnXp(p.pos, 1 + Math.floor(Math.random() * 6)); g.sound.play('pop', null, 0.6); g.inv.damageHeld(1); g.advance('fish', 'Fishy Business', 'Catch a fish', 'cod'); } this.fish = null; return; }
        const hit = w.raycast(eye, f, 12, { liquids: true });
        if (hit && hit.id === B.WATER) { this.fish = { pos: [hit.x + 0.5, hit.y + 0.9, hit.z + 0.5], wait: Math.max(1, 4 + Math.random() * 12 - 5 * enchLv(held, 'lure')), lure: enchLv(held, 'lure'), bite: 0 }; g.sound.play('splash', this.fish.pos, 0.3); }
        return;
      }
      default: return;
    }
  }
  afterUse(it) { const g = this.g; if (g.mode === 'creative') return; if (it.key === 'flint_and_steel') g.inv.damageHeld(1); else g.inv.consumeHeld(); this.swing = 1; }
  // Hoes till, shovels make paths: handled via useStart fallback for tools.
  toolUse(t) {
    const g = this.g, held = g.inv.held, it = held && I[held.key];
    if (!it || !it.tool || !t) return false;
    const w = g.world, above = w.getBlock(t.x, t.y + 1, t.z);
    if (it.tool.type === 'hoe' && (t.id === B.GRASS_BLOCK || t.id === B.DIRT) && above === B.AIR && t.ny !== -1) { w.setBlock(t.x, t.y, t.z, B.FARMLAND, 0); g.sound.place('gravel', [t.x, t.y, t.z]); this.afterToolUse(); return true; }
    if (it.tool.type === 'shovel' && t.id === B.GRASS_BLOCK && above === B.AIR && t.ny !== -1) { w.setBlock(t.x, t.y, t.z, B.DIRT_PATH, 0); g.sound.place('gravel', [t.x, t.y, t.z]); this.afterToolUse(); return true; }
    if (it.tool.type === 'shovel' && t.id === B.CAMPFIRE) { w.setBlock(t.x, t.y, t.z, B.AIR, 0); g.particles.smoke([t.x + 0.5, t.y + 0.5, t.z + 0.5], 6); return true; }
    return false;
  }
  afterToolUse() { const g = this.g; this.swing = 1; if (g.mode !== 'creative') g.inv.damageHeld(1); }
  fishTick(dt) {
    const g = this.g, f = this.fish;
    f.wait -= dt;
    if (f.wait <= 0 && f.bite <= 0) { f.bite = 1.2; g.sound.play('splash', f.pos, 0.5); g.particles.fx('splash', f.pos, 12, 0.2, 2); }
    if (f.bite > 0) { f.bite -= dt; if (f.bite <= 0) { f.wait = Math.max(1, 4 + Math.random() * 10 - 5 * (f.lure || 0)); } }
    if (Math.random() < dt * 2) g.particles.fx('bubble', f.pos, 1, 0.1, 0.1);
    if (Math.hypot(g.player.pos[0] - f.pos[0], g.player.pos[2] - f.pos[2]) > 24) this.fish = null;
  }

  // Middle click: pick block.
  pickBlock() {
    const g = this.g, t = this.target;
    if (!t) return;
    const p = props(t.id, t.meta);
    const key = I[p.key] ? p.key : null;
    if (!key) return;
    const inv = g.inv.main;
    for (let i = 0; i < 9; i++) if (inv.get(i) && inv.get(i).key === key) { g.inv.selected = i; g.invDirty = true; return; }
    if (g.mode !== 'creative') { const idx = inv.slots.findIndex(s => s && s.key === key); if (idx >= 9) { const a = inv.get(g.inv.selected); inv.set(g.inv.selected, inv.get(idx)); inv.set(idx, a); } return; }
    let slot = g.inv.selected;
    for (let i = 0; i < 9; i++) if (!inv.get(i)) { slot = i; break; }
    inv.set(slot, { key, count: I[key].stack });
    g.inv.selected = slot; g.invDirty = true;
  }
}
export { VARIANT_MASK, selectionBoxes };

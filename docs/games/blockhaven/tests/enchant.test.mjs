import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const E = await load('data/enchantments.js');
const { enchantDamage, protectionFactor } = await load('game/combat.js');
const { blockDrops } = await load('game/drops.js');
const { B, st } = await load('data/blocks.js');

test('every enchantment has a sane definition', () => {
  assert.equal(E.ENCHANT_LIST.length, 39);
  for (const e of E.ENCHANT_LIST) {
    assert.ok(e.max >= 1 && e.weight >= 1, e.id);
    for (let l = 1; l <= e.max; l++) assert.ok(e.minCost(l) <= e.maxCost(l), `${e.id} ${l}`);
  }
  assert.equal(E.compatible('protection', 'fire_protection'), false);
  assert.equal(E.compatible('sharpness', 'smite'), false);
  assert.equal(E.compatible('silk_touch', 'fortune'), false);
  assert.equal(E.compatible('mending', 'infinity'), false);
  assert.equal(E.compatible('sharpness', 'looting'), true);
  assert.equal(E.enchantName('sharpness', 5), 'Sharpness V');
  assert.equal(E.enchantName('mending', 1), 'Mending');
  assert.equal(E.enchantName('binding_curse', 1), 'Curse of Binding');
});

test('the table offers grow with bookshelves and only roll fitting, compatible enchantments', () => {
  let low = 0, high = 0;
  for (let seed = 1; seed < 300; seed++) {
    const a = E.tableOffers(seed, 'diamond_sword', 0), b = E.tableOffers(seed, 'diamond_sword', 15);
    low += a.costs[2]; high += b.costs[2];
    assert.ok(b.costs[2] >= 30 && b.costs[2] <= 30 + 0, `max shelves gives level 30 for the third slot, got ${b.costs[2]}`);
    for (const o of [a, b]) for (let i = 0; i < 3; i++) {
      if (!o.costs[i]) continue;
      assert.ok(o.costs[i] >= i + 1);
      const picks = o.picks[i];
      assert.ok(picks.length >= 1);
      for (const p of picks) { assert.ok(E.canEnchant(p.id, 'diamond_sword'), p.id); assert.ok(!E.ENCHANTS[p.id].treasure); }
      for (const p of picks) for (const q of picks) if (p !== q) assert.ok(E.compatible(p.id, q.id), `${p.id}+${q.id}`);
    }
  }
  assert.ok(high > low * 2);
  // Same seed, same offers.
  assert.deepEqual(E.tableOffers(42, 'bow', 8), E.tableOffers(42, 'bow', 8));
});

test('the anvil combines, repairs, renames and refuses what the original refuses', () => {
  const book = { key: 'enchanted_book', count: 1, tag: { stored: { sharpness: 3 } } };
  const sword = { key: 'diamond_sword', count: 1, tag: { ench: { sharpness: 3 } } };
  const r = E.anvilResult(sword, book, undefined);
  assert.equal(r.result.tag.ench.sharpness, 4);
  assert.equal(r.cost, 4); // common (1), halved for a book (1) x level 4
  assert.equal(r.result.tag.rc, 1);
  // Incompatible only: nothing happens.
  assert.equal(E.anvilResult({ key: 'diamond_sword', count: 1, tag: { ench: { sharpness: 1 } } }, { key: 'enchanted_book', count: 1, tag: { stored: { smite: 1 } } }), null);
  // Repair with material: a quarter of max durability per diamond.
  const worn = { key: 'diamond_pickaxe', count: 1, dmg: 1000 };
  const rep = E.anvilResult(worn, { key: 'diamond', count: 5 });
  assert.equal(rep.used, 3);
  assert.equal(rep.result.dmg || 0, 1000 - 390 * 2 - 220);
  // Rename only.
  const nm = E.anvilResult({ key: 'iron_sword', count: 1 }, null, 'Sting');
  assert.equal(nm.result.tag.name, 'Sting'); assert.equal(nm.cost, 1);
  // Prior work makes it too expensive eventually.
  const heavy = { key: 'diamond_sword', count: 1, tag: { ench: { sharpness: 5 }, rc: 63 } };
  assert.equal(E.anvilResult(heavy, { key: 'enchanted_book', count: 1, tag: { stored: { looting: 3 } } }).tooExpensive, true);
  // Books stack levels together too.
  const b2 = E.anvilResult({ key: 'enchanted_book', count: 1, tag: { stored: { efficiency: 4 } } }, { key: 'enchanted_book', count: 1, tag: { stored: { efficiency: 4 } } });
  assert.equal(b2.result.tag.stored.efficiency, 5);
});

test('enchantments change damage, protection and drops', () => {
  const sword = { key: 'iron_sword', count: 1, tag: { ench: { sharpness: 5, smite: 0 } } };
  assert.equal(enchantDamage(sword, { mobType: 'cow' }), 3);
  assert.equal(enchantDamage({ key: 'iron_sword', count: 1, tag: { ench: { smite: 5 } } }, { mobType: 'zombie' }), 12.5);
  const prot4 = { key: 'diamond_chestplate', count: 1, tag: { ench: { protection: 4 } } };
  assert.equal(protectionFactor([prot4, prot4, prot4, prot4], 'mob'), 1 - 16 / 25);
  assert.equal(protectionFactor([prot4, prot4, prot4, prot4, prot4, prot4], 'mob'), 1 - 20 / 25);
  const boots = { key: 'diamond_boots', count: 1, tag: { ench: { feather_falling: 4 } } };
  assert.equal(protectionFactor([boots], 'fall'), 1 - 12 / 25);
  const [id, m] = st('diamond_ore');
  const silk = blockDrops(id, m, { key: 'iron_pickaxe', count: 1, tag: { ench: { silk_touch: 1 } } });
  assert.deepEqual(silk.items, [{ key: 'diamond_ore', count: 1 }]);
  let total = 0;
  for (let i = 0; i < 400; i++) total += blockDrops(id, m, { key: 'iron_pickaxe', count: 1, tag: { ench: { fortune: 3 } } }).items[0].count;
  assert.ok(total / 400 > 1.9 && total / 400 < 2.5, `fortune III averages ${total / 400}`);
  void B;
});

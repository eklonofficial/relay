// Item stacks and containers. A stack is { key, count, dmg?, tag? } or null.
import { I, maxStack } from '../data/items.js?v=mush3u38';
import { unbreakingSaves } from './combat.js?v=mush3u38';

export const stack = (key, count = 1, extra = {}) => (I[key] ? { key, count, ...extra } : null);
export const clone = s => (s ? { ...s, tag: s.tag ? { ...s.tag } : undefined } : null);
export const same = (a, b) => !!a && !!b && a.key === b.key && !a.dmg && !b.dmg && !a.tag && !b.tag;

export class Container {
  constructor(size) { this.slots = new Array(size).fill(null); this.onChange = null; }
  get size() { return this.slots.length; }
  get(i) { return this.slots[i]; }
  set(i, s) { this.slots[i] = s && s.count > 0 ? s : null; this.changed(); }
  changed() { if (this.onChange) this.onChange(); }
  // Adds a stack into slots [from, to), merging first. Returns the leftover count.
  add(s, from = 0, to = this.slots.length, order = null) {
    if (!s) return 0;
    let left = s.count;
    const max = maxStack(s.key);
    const idx = order || Array.from({ length: to - from }, (_, k) => from + k);
    for (const i of idx) {
      const t = this.slots[i];
      if (t && same(t, s) && t.count < max) { const n = Math.min(max - t.count, left); t.count += n; left -= n; if (!left) break; }
    }
    if (left) for (const i of idx) {
      if (!this.slots[i]) { const n = Math.min(max, left); this.slots[i] = { ...s, count: n }; left -= n; if (!left) break; }
    }
    this.changed();
    return left;
  }
  count(key) { let n = 0; for (const s of this.slots) if (s && s.key === key) n += s.count; return n; }
  countMatching(fn) { let n = 0; for (const s of this.slots) if (s && fn(s.key)) n += s.count; return n; }
  // Removes up to n items with a matching key; returns how many were removed.
  remove(fn, n) {
    let left = n;
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (!s || !fn(s.key)) continue;
      const k = Math.min(s.count, left);
      s.count -= k; left -= k;
      if (!s.count) this.slots[i] = null;
    }
    this.changed();
    return n - left;
  }
  clear() { this.slots.fill(null); this.changed(); }
  toJSON() { return this.slots.map(s => (s ? { ...s } : null)); }
  load(list) { if (Array.isArray(list)) list.forEach((s, i) => { if (i < this.slots.length) this.slots[i] = s && I[s.key] ? s : null; }); this.changed(); }
}

// Player inventory: 0-8 hotbar, 9-35 main, armor[4] (helmet..boots), offhand.
export class PlayerInventory {
  constructor() {
    this.main = new Container(36);
    this.armor = new Container(4);
    this.offhand = new Container(1);
    this.craft = new Container(4);
    this.selected = 0;
  }
  // `hand` switches which hand the held-item helpers act on ('main' or 'off'), so every use
  // action (eating, blocking, shooting, placing) works from the off-hand too.
  get held() { return this.hand === 'off' ? this.offhand.get(0) : this.main.get(this.selected); }
  get mainHeld() { return this.main.get(this.selected); }
  setHeld(s) { if (this.hand === 'off') this.offhand.set(0, s); else this.main.set(this.selected, s); }
  // Hotbar first, then main.
  add(s) {
    if (!s) return 0;
    const order = [...Array(9).keys(), ...Array.from({ length: 27 }, (_, k) => 9 + k)];
    return this.main.add(s, 0, 36, order);
  }
  consumeHeld(n = 1) {
    const s = this.held;
    if (!s) return;
    s.count -= n;
    const c = this.hand === 'off' ? this.offhand : this.main, i = this.hand === 'off' ? 0 : this.selected;
    if (s.count <= 0) c.set(i, null);
    else c.changed();
  }
  // Damages the held item; returns true if it broke.
  damageHeld(amount = 1) {
    const s = this.held;
    const it = s && I[s.key];
    if (!it || !it.durability) return false;
    for (let k = amount; k > 0; k--) if (unbreakingSaves(s)) amount--;
    if (amount <= 0) return false;
    s.dmg = (s.dmg || 0) + amount;
    const c = this.hand === 'off' ? this.offhand : this.main, i = this.hand === 'off' ? 0 : this.selected;
    if (s.dmg >= it.durability) { c.set(i, null); return true; }
    c.changed();
    return false;
  }
  armorPoints() {
    let pts = 0, tough = 0;
    for (const s of this.armor.slots) if (s) { const a = I[s.key].armor; if (a) { pts += a.points; tough += a.tough; } }
    return { pts, tough };
  }
  // Each hit wears every armor piece by max(1, damage/4).
  damageArmor(dmg) {
    const w = Math.max(1, Math.floor(dmg / 4));
    let broke = false;
    this.armor.slots.forEach((s, i) => {
      if (!s) return;
      const it = I[s.key];
      if (!it.durability) return;
      let n = w;
      for (let k = w; k > 0; k--) if (unbreakingSaves(s, true)) n--;
      if (n <= 0) return;
      s.dmg = (s.dmg || 0) + n;
      if (s.dmg >= it.durability) { this.armor.slots[i] = null; broke = true; }
    });
    this.armor.changed();
    return broke;
  }
  toJSON() { return { main: this.main.toJSON(), armor: this.armor.toJSON(), offhand: this.offhand.toJSON(), selected: this.selected }; }
  load(d) {
    if (!d) return;
    this.main.load(d.main); this.armor.load(d.armor); this.offhand.load(d.offhand);
    this.selected = d.selected || 0;
  }
  clearAll() { this.main.clear(); this.armor.clear(); this.offhand.clear(); this.craft.clear(); }
  allStacks() { return [...this.main.slots, ...this.armor.slots, ...this.offhand.slots, ...this.craft.slots].filter(Boolean); }
}

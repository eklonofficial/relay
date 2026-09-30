// Container GUIs (inventory, crafting, chest, furnace, creative, trading) and the HUD.
import { I, ITEMS, TABS, maxStack, ARMOR_SLOTS } from '../data/items.js?v=munkil2j';
import { findRecipe, allRecipes, matches, SMELTING, TAGS } from '../data/recipes.js?v=munkil2j';
import { same } from './inventory.js?v=munkil2j';

const $ = id => document.getElementById(id);
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
export const fuelOf = key => { const it = I[key]; if (!it) return 0; if (it.fuel) return it.fuel; if (TAGS.logs.includes(key) || TAGS.planks.includes(key)) return 15; if (/_slab$/.test(key) && TAGS.slabs_wood.includes(key)) return 7.5; if (key === 'coal_block') return 800; if (/_sapling$|stick|_fence$|ladder|crafting_table|chest|bookshelf|bowl|_door$|_trapdoor$/.test(key)) return 5; return 0; };

// A slot reference: get/set plus optional rules.
function ref(container, i, opts = {}) {
  return { get: () => container.get(i), set: s => container.set(i, s), ...opts };
}

export class GUI {
  constructor(game) {
    this.game = game;
    this.root = $('gui');
    this.cursor = null;
    this.screen = null;
    this.hover = null;
    this.creativeTab = 'building';
    this.creativeScroll = 0;
    this.search = '';
    this.bookOpen = true;
    this.cursorEl = $('cursor-item');
    this.tooltip = $('tooltip');
    document.addEventListener('mousemove', e => {
      this.mx = e.clientX; this.my = e.clientY;
      if (this.screen) this.positionFloating();
    });
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    this.root.addEventListener('mousedown', e => { if (e.target === this.root && this.cursor && this.screen) { this.dropCursor(e.button === 2); } });
  }

  get isOpen() { return !!this.screen; }
  icon(key) { return this.game.icons[key] || ''; }

  // ---------- rendering helpers ----------
  fillSlot(div, s, ghost = null) {
    div.textContent = '';
    const show = s || ghost;
    if (!show) return;
    const img = el('img', ghost && !s ? 'ghost' : '', div);
    img.src = this.icon(show.key);
    if (s && s.count > 1) el('span', 'count', div).textContent = s.count;
    const it = s && I[s.key];
    if (it && it.durability && s.dmg) {
      const d = el('div', 'dur', div), f = el('div', '', d), frac = 1 - s.dmg / it.durability;
      f.style.width = `${frac * 100}%`;
      f.style.background = `hsl(${frac * 120}, 90%, 45%)`;
    }
  }
  slotEl(r, parent, cls = '') {
    const div = el('div', `gs ${cls}`, parent);
    div._ref = r;
    this.fillSlot(div, r.get(), r.ghost);
    if (r.placeholder && !r.get()) div.dataset.ph = r.placeholder;
    div.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.click(r, e); });
    div.addEventListener('dblclick', e => { e.preventDefault(); this.collect(r); });
    div.addEventListener('mouseenter', () => { this.hover = r; this.showTooltip(r.get()); });
    div.addEventListener('mouseleave', () => { if (this.hover === r) this.hover = null; this.hideTooltip(); });
    this.slotEls.push(div);
    return div;
  }
  grid(refs, cols, parent, cls = '') {
    const g = el('div', 'grid', parent);
    g.style.gridTemplateColumns = `repeat(${cols}, 40px)`;
    refs.forEach(r => this.slotEl(r, g, cls));
    return g;
  }
  refresh() {
    for (const d of this.slotEls) this.fillSlot(d, d._ref.get(), d._ref.ghost);
    this.renderCursor();
    if (this.screen && this.screen.onRefresh) this.screen.onRefresh();
    if (this.hover) this.showTooltip(this.hover.get());
  }
  renderCursor() {
    const c = this.cursorEl;
    c.textContent = '';
    if (!this.cursor) { c.classList.add('hidden'); return; }
    c.classList.remove('hidden');
    const img = el('img', '', c); img.src = this.icon(this.cursor.key);
    if (this.cursor.count > 1) el('span', 'count', c).textContent = this.cursor.count;
    this.positionFloating();
  }
  positionFloating() {
    this.cursorEl.style.left = `${this.mx}px`; this.cursorEl.style.top = `${this.my}px`;
    this.tooltip.style.left = `${this.mx + 16}px`; this.tooltip.style.top = `${this.my - 30}px`;
  }
  showTooltip(s) {
    if (!s || this.cursor) { this.hideTooltip(); return; }
    const it = I[s.key];
    const t = this.tooltip;
    t.textContent = '';
    el('div', '', t).textContent = it.name;
    const lines = [];
    if (it.damage && it.kind !== 'bow') lines.push(`${it.damage} Attack Damage`);
    if (it.attackSpeed) lines.push(`${it.attackSpeed} Attack Speed`);
    if (it.armor && it.armor.points) lines.push(`+${it.armor.points} Armor`);
    if (it.armor && it.armor.tough) lines.push(`+${it.armor.tough} Armor Toughness`);
    if (it.food && it.food.hunger) lines.push(`Restores ${it.food.hunger / 2} hunger`);
    if (it.durability) lines.push(`Durability: ${it.durability - (s.dmg || 0)} / ${it.durability}`);
    for (const l of lines) el('div', 'sub blue', t).textContent = l;
    el('div', 'sub', t).textContent = `blockhaven:${s.key}`;
    t.classList.remove('hidden');
    this.positionFloating();
  }
  hideTooltip() { this.tooltip.classList.add('hidden'); }

  // ---------- interaction ----------
  click(r, e) {
    const g = this.game;
    g.sound.click(0.4);
    const shift = e.shiftKey, right = e.button === 2;
    if (r.creative) { this.creativeClick(r, e); return; }
    if (r.trash) { if (this.cursor) this.cursor = null; else if (shift) g.inv.main.clear(); this.refresh(); return; }
    if (r.output) { this.takeOutput(r, shift); this.refresh(); return; }
    const s = r.get();
    if (shift) {
      if (s && this.screen.quickMove) { const rest = this.screen.quickMove(r, s); r.set(rest); }
      this.refresh();
      return;
    }
    const c = this.cursor;
    if (!c) {
      if (!s) return;
      if (right) { const half = Math.ceil(s.count / 2); this.cursor = { ...s, count: half }; s.count -= half; r.set(s.count ? s : null); }
      else { this.cursor = s; r.set(null); }
    } else if (r.accept && !r.accept(c)) {
      return;
    } else if (!s) {
      const lim = r.limit || maxStack(c.key);
      const n = right ? 1 : Math.min(c.count, lim);
      r.set({ ...c, count: n });
      c.count -= n;
      if (!c.count) this.cursor = null;
    } else if (same(s, c)) {
      const max = Math.min(r.limit || 99, maxStack(s.key));
      const n = Math.min(right ? 1 : c.count, max - s.count);
      if (n > 0) { s.count += n; c.count -= n; r.set(s); if (!c.count) this.cursor = null; }
    } else if (!right) {
      r.set(c); this.cursor = s;
    }
    this.refresh();
    if (r.onChange) r.onChange();
  }
  collect(r) {
    const c = this.cursor;
    if (!c) return;
    const max = maxStack(c.key);
    for (const d of this.slotEls) {
      const o = d._ref;
      if (o.output || o.creative || o.trash) continue;
      const s = o.get();
      if (s && same(s, c) && c.count < max) { const n = Math.min(max - c.count, s.count); c.count += n; s.count -= n; o.set(s.count ? s : null); }
    }
    this.refresh();
  }
  takeOutput(r, shift) {
    const s = r.get();
    if (!s) return;
    if (shift) {
      for (let k = 0; k < 64; k++) {
        const cur = r.get();
        if (!cur || (k > 0 && cur.key !== s.key)) break;
        if (this.game.inv.add({ ...cur }) > 0) break;
        r.take();
      }
      return;
    }
    if (this.cursor && (!same(this.cursor, s) || this.cursor.count + s.count > maxStack(s.key))) return;
    if (this.cursor) this.cursor.count += s.count; else this.cursor = { ...s };
    r.take();
  }
  creativeClick(r, e) {
    const s = r.get();
    if (this.cursor) { this.cursor = null; this.refresh(); return; }
    if (!s) return;
    const full = { key: s.key, count: e.button === 2 ? 1 : maxStack(s.key) };
    if (e.shiftKey) this.game.inv.add(full); else this.cursor = full;
    this.refresh();
  }
  dropCursor(one) {
    if (!this.cursor) return;
    if (one) { this.game.dropStack({ ...this.cursor, count: 1 }); this.cursor.count--; if (!this.cursor.count) this.cursor = null; }
    else { this.game.dropStack(this.cursor); this.cursor = null; }
    this.refresh();
  }
  key(e) {
    if (!this.screen) return false;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') { if (e.code === 'Escape') this.close(); return e.code !== 'Escape'; }
    if (e.code === 'Escape' || e.code === 'KeyE') { this.close(); return true; }
    const h = this.hover;
    if (h && /^Digit[1-9]$/.test(e.code) && !h.output && !h.creative) {
      const n = Number(e.code.slice(5)) - 1, inv = this.game.inv.main;
      const a = h.get(), b = inv.get(n);
      if (h.accept && b && !h.accept(b)) return true;
      h.set(b); inv.set(n, a);
      this.refresh();
      return true;
    }
    if (h && e.code === 'KeyQ' && !h.creative) {
      const s = h.get();
      if (s) {
        if (h.output) { this.game.dropStack({ ...s }); h.take(); }
        else { const n = e.ctrlKey ? s.count : 1; this.game.dropStack({ ...s, count: n }); s.count -= n; h.set(s.count ? s : null); }
        this.refresh();
      }
      return true;
    }
    return true;
  }

  // Moves a stack into a list of refs (merge first); returns the rest or null.
  moveInto(s, refs) {
    let left = s.count;
    const max = maxStack(s.key);
    for (const r of refs) { const t = r.get(); if (t && same(t, s) && t.count < max && (!r.accept || r.accept(s))) { const n = Math.min(max - t.count, left); t.count += n; r.set(t); left -= n; if (!left) return null; } }
    for (const r of refs) { if (!r.get() && (!r.accept || r.accept(s))) { const n = Math.min(r.limit || max, left); r.set({ ...s, count: n }); left -= n; if (!left) return null; } }
    return { ...s, count: left };
  }
  invRefs() {
    const m = this.game.inv.main;
    return { hot: Array.from({ length: 9 }, (_, i) => ref(m, i)), main: Array.from({ length: 27 }, (_, i) => ref(m, 9 + i)) };
  }
  // Standard player-inventory block (main 3x9 + hotbar) appended to a window.
  playerSection(win) {
    const { hot, main } = this.invRefs();
    el('div', 'title', win).textContent = 'Inventory';
    this.grid(main, 9, win);
    el('div', 'inv-sep', win);
    this.grid(hot, 9, win);
    return { hot, main };
  }

  // ---------- open / close ----------
  begin(kind) {
    this.close(true);
    this.slotEls = [];
    this.root.textContent = '';
    this.root.classList.remove('hidden');
    this.screen = { kind };
    this.game.onGuiOpen();
  }
  close(silent = false) {
    if (!this.screen) return;
    const s = this.screen;
    if (s.onClose) s.onClose();
    if (this.cursor) { const rest = this.game.inv.add(this.cursor); if (rest) this.game.dropStack({ ...this.cursor, count: rest }); this.cursor = null; }
    this.screen = null;
    this.root.classList.add('hidden');
    this.root.textContent = '';
    this.cursorEl.classList.add('hidden');
    this.hideTooltip();
    if (!silent) this.game.onGuiClose();
  }

  craftingGrid(win, size, container, extra = {}) {
    const g = this.game;
    const cells = Array.from({ length: size * size }, (_, i) => ref(container, i, { onChange: () => this.refresh() }));
    const result = () => {
      const keys = cells.map(r => r.get() && r.get().key);
      const rec = findRecipe(keys, size);
      return rec ? { key: rec.out, count: rec.count } : null;
    };
    const out = {
      output: true,
      get: result,
      set: () => {},
      take: () => {
        const r = result();
        if (!r) return;
        for (const c of cells) {
          const s = c.get();
          if (!s) continue;
          s.count--;
          const rem = /_bucket$/.test(s.key) && s.key !== 'bucket' ? { key: 'bucket', count: 1 } : null;
          c.set(s.count ? s : rem);
        }
        g.onCraft(r);
      },
    };
    const wrap = el('div', 'flex', win);
    this.grid(cells, size, wrap);
    el('div', 'arrow-r', wrap).textContent = '➜';
    this.slotEl(out, wrap, 'big');
    return { cells, out };
  }

  recipeBook(parent, size, cells, container) {
    const book = el('div', 'win recipe-book', parent);
    el('div', 'title', book).textContent = 'Recipe Book';
    const search = el('input', 'search', book);
    search.type = 'text'; search.placeholder = 'Search…';
    const gridEl = el('div', 'grid', book);
    gridEl.style.gridTemplateColumns = 'repeat(5, 40px)';
    const inv = this.game.inv.main;
    const recipes = allRecipes().filter(r => r.w <= size && r.h <= size);
    const canMake = r => {
      const need = new Map();
      for (const c of r.cells) need.set(c.spec, (need.get(c.spec) || 0) + 1);
      for (const [spec, n] of need) if (inv.countMatching(k => matches(spec, k)) + cells.reduce((a, c) => a + (c.get() && matches(spec, c.get().key) ? c.get().count : 0), 0) < n) return false;
      return true;
    };
    const fill = r => {
      // Return current grid contents, then pull ingredients from the inventory.
      for (const c of cells) { const s = c.get(); if (s) { const rest = this.game.inv.add(s); c.set(rest ? { ...s, count: rest } : null); } }
      const ox = Math.floor((size - r.w) / 2), oy = Math.floor((size - r.h) / 2);
      for (const c of r.cells) {
        const idx = (c.y + (r.shaped ? oy : 0)) * size + c.x + (r.shaped ? ox : 0);
        if (idx >= size * size) continue;
        let key = null;
        for (const s of inv.slots) if (s && matches(c.spec, s.key)) { key = s.key; break; }
        if (!key) continue;
        inv.remove(k => k === key, 1);
        container.set(idx, { key, count: 1 });
      }
      this.refresh();
    };
    const draw = () => {
      gridEl.textContent = '';
      const q = search.value.trim().toLowerCase();
      const seen = new Set();
      const list = recipes.filter(r => (!q || I[r.out].name.toLowerCase().includes(q)));
      list.sort((a, b) => (canMake(b) - canMake(a)));
      for (const r of list) {
        if (seen.has(r.out) || seen.size > 160) continue;
        seen.add(r.out);
        const ok = canMake(r);
        const d = el('div', `gs rb-slot ${ok ? '' : 'missing'}`, gridEl);
        this.fillSlot(d, { key: r.out, count: r.count });
        d.title = I[r.out].name + (ok ? '' : ' (missing ingredients)');
        d.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); if (ok) fill(r); this.game.sound.click(0.4); });
      }
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', e => e.stopPropagation());
    draw();
    return { draw };
  }

  openInventory() {
    if (this.game.creativeMenu) { this.openCreative(); return; }
    this.begin('inventory');
    const g = this.game, inv = g.inv;
    const outer = el('div', 'flex', this.root);
    outer.style.alignItems = 'flex-start';
    let book = null;
    if (this.bookOpen) book = el('div', '', outer);
    const win = el('div', 'win', outer);
    const top = el('div', 'flex', win);
    const armorRefs = ARMOR_SLOTS.map((piece, k) => ref(inv.armor, k, { accept: s => I[s.key].armor && I[s.key].armor.slot === k, limit: 1, placeholder: piece }));
    const acol = el('div', 'col', top);
    for (const r of armorRefs) this.slotEl(r, acol, 'armor-empty');
    const view = el('div', 'player-view', top);
    this.playerCanvas = el('canvas', '', view);
    this.playerCanvas.width = 110; this.playerCanvas.height = 150;
    const offRef = ref(inv.offhand, 0);
    this.slotEl(offRef, el('div', 'col', top));
    const craftBox = el('div', 'col', top);
    el('div', 'title', craftBox).textContent = 'Crafting';
    const { cells, out } = this.craftingGrid(craftBox, 2, inv.craft);
    el('div', 'inv-sep', win);
    const { hot, main } = this.playerSection(win);
    const toggle = el('div', 'rb-toggle', win);
    const bi = el('img', '', toggle); bi.src = this.icon('book');
    toggle.addEventListener('mousedown', e => { e.stopPropagation(); this.bookOpen = !this.bookOpen; this.openInventory(); });
    let rb = null;
    if (book) rb = this.recipeBook(book, 2, cells, inv.craft);
    this.screen.quickMove = (r, s) => {
      const it = I[s.key];
      if (armorRefs.includes(r) || cells.includes(r) || r === offRef) return this.moveInto(s, [...main, ...hot]);
      if (it.armor && !armorRefs[it.armor.slot].get()) return this.moveInto(s, [armorRefs[it.armor.slot]]);
      if (hot.includes(r)) return this.moveInto(s, main);
      return this.moveInto(s, hot);
    };
    this.screen.onRefresh = () => { if (rb) rb.draw(); };
    this.screen.onClose = () => { for (const c of cells) { const s = c.get(); if (s) { const rest = inv.add(s); if (rest) g.dropStack({ ...s, count: rest }); c.set(null); } } };
  }

  openCrafting() {
    this.begin('crafting');
    const g = this.game, inv = g.inv;
    const outer = el('div', 'flex', this.root);
    outer.style.alignItems = 'flex-start';
    const bookHolder = el('div', '', outer);
    const win = el('div', 'win', outer);
    el('div', 'title', win).textContent = 'Crafting';
    const grid = g.tableGrid;
    const { cells } = this.craftingGrid(win, 3, grid);
    el('div', 'inv-sep', win);
    const { hot, main } = this.playerSection(win);
    const rb = this.recipeBook(bookHolder, 3, cells, grid);
    this.screen.quickMove = (r, s) => {
      if (cells.includes(r)) return this.moveInto(s, [...main, ...hot]);
      if (hot.includes(r)) return this.moveInto(s, main);
      return this.moveInto(s, hot);
    };
    this.screen.onRefresh = () => rb.draw();
    this.screen.onClose = () => { for (const c of cells) { const s = c.get(); if (s) { const rest = inv.add(s); if (rest) g.dropStack({ ...s, count: rest }); c.set(null); } } };
  }

  openChest(container, title = 'Chest', onClose = null) {
    this.begin('chest');
    const win = el('div', 'win', this.root);
    el('div', 'title', win).textContent = title;
    const refs = container.slots.map((_, i) => ref(container, i));
    this.grid(refs, 9, win);
    el('div', 'inv-sep', win);
    const { hot, main } = this.playerSection(win);
    this.screen.quickMove = (r, s) => (refs.includes(r) ? this.moveInto(s, [...hot, ...main].reverse().reverse()) : this.moveInto(s, refs));
    this.screen.onClose = onClose;
  }

  openFurnace(be) {
    this.begin('furnace');
    const win = el('div', 'win', this.root);
    el('div', 'title', win).textContent = 'Furnace';
    const c = be.container;
    const inRef = ref(c, 0), fuelRef = ref(c, 1, { accept: s => fuelOf(s.key) > 0 }), outRef = { output: true, get: () => c.get(2), set: s => c.set(2, s), take: () => { const s = c.get(2); c.set(2, null); this.game.onSmelt(s, be); } };
    const box = el('div', 'flex', win);
    box.style.margin = '6px 0 10px 40px';
    const left = el('div', 'col', box);
    this.slotEl(inRef, left);
    const flame = el('div', 'flame-ind', left);
    const flameFg = el('div', 'fg', flame);
    this.slotEl(fuelRef, left);
    const arrow = el('div', 'progress-arrow', box);
    el('div', 'bg', arrow).textContent = '➜';
    const fg = el('div', 'fg', arrow); fg.textContent = '➜';
    this.slotEl(outRef, box, 'big');
    const { hot, main } = this.playerSection(win);
    this.screen.quickMove = (r, s) => {
      if (r === inRef || r === fuelRef || r === outRef) return this.moveInto(s, [...hot, ...main]);
      if (SMELTING[s.key]) return this.moveInto(s, [inRef]);
      if (fuelOf(s.key)) return this.moveInto(s, [fuelRef]);
      return hot.includes(r) ? this.moveInto(s, main) : this.moveInto(s, hot);
    };
    this.screen.tick = () => {
      fg.style.width = `${(be.cook || 0) * 100}%`;
      flameFg.style.height = `${be.burnMax ? (be.burn / be.burnMax) * 100 : 0}%`;
    };
    this.screen.be = be;
  }

  openCreative() {
    this.begin('creative');
    const g = this.game;
    const wrap = el('div', 'col', this.root);
    const tabs = el('div', 'tabs', wrap);
    const allTabs = [...TABS, ['search', 'Search'], ['inventory', 'Survival Inventory']];
    const tabIcon = { building: 'bricks', colored: 'cyan_wool', natural: 'grass_block', functional: 'crafting_table', tools: 'iron_pickaxe', combat: 'diamond_sword', food: 'apple', ingredients: 'iron_ingot', spawn_eggs: 'zombie_spawn_egg', search: 'compass', inventory: 'chest' };
    for (const [k, name] of allTabs) {
      const t = el('div', `tab ${k === this.creativeTab ? 'on' : ''}`, tabs);
      t.title = name;
      const im = el('img', '', t); im.src = this.icon(tabIcon[k]) || this.icon('stone');
      t.addEventListener('mousedown', e => { e.stopPropagation(); this.creativeTab = k; this.openCreative(); });
    }
    const win = el('div', 'win', wrap);
    const tabName = allTabs.find(t => t[0] === this.creativeTab)[1];
    el('div', 'title', win).textContent = tabName;
    const { hot, main } = this.invRefs();
    if (this.creativeTab === 'inventory') {
      const inv = g.inv;
      const armorRefs = ARMOR_SLOTS.map((piece, k) => ref(inv.armor, k, { accept: s => I[s.key].armor && I[s.key].armor.slot === k, limit: 1, placeholder: piece }));
      const row = el('div', 'flex', win);
      const acol = el('div', 'col', row);
      for (const r of armorRefs) this.slotEl(r, acol, 'armor-empty');
      this.slotEl(ref(inv.offhand, 0), row);
      el('div', 'inv-sep', win);
      this.grid(main, 9, win);
      el('div', 'inv-sep', win);
    } else {
      let list;
      if (this.creativeTab === 'search') {
        const s = el('input', 'search', win);
        s.type = 'text'; s.placeholder = 'Search items…'; s.value = this.search;
        s.addEventListener('keydown', e => e.stopPropagation());
        s.addEventListener('input', () => { this.search = s.value; draw(); });
        setTimeout(() => s.focus(), 0);
      }
      const gridWrap = el('div', 'creative-grid', win);
      const draw = () => {
        gridWrap.textContent = '';
        this.slotEls = this.slotEls.filter(d => !d._ref.creative);
        const q = this.search.trim().toLowerCase();
        list = this.creativeTab === 'search' ? ITEMS.filter(it => !q || it.name.toLowerCase().includes(q) || it.key.includes(q)) : ITEMS.filter(it => it.tab === this.creativeTab);
        this.grid(list.map(it => ({ creative: true, get: () => ({ key: it.key, count: 1 }), set: () => {} })), 9, gridWrap);
      };
      draw();
      el('div', 'inv-sep', win);
    }
    const bottom = el('div', 'flex', win);
    this.grid(hot, 9, bottom);
    this.slotEl({ trash: true, get: () => null, set: () => {} }, bottom, 'trash').title = 'Destroy item (shift-click: clear inventory)';
    this.screen.quickMove = (r, s) => (hot.includes(r) ? this.moveInto(s, main) : this.moveInto(s, hot));
  }

  openTrade(villager) {
    this.begin('trade');
    const g = this.game;
    const outer = el('div', 'flex', this.root);
    outer.style.alignItems = 'flex-start';
    const listWin = el('div', 'win', outer);
    el('div', 'title', listWin).textContent = 'Trades';
    const list = el('div', 'trade-list', listWin);
    const win = el('div', 'win', outer);
    el('div', 'title', win).textContent = `${villager.displayName} — ${['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'][villager.level - 1] || ''}`;
    const xpbar = el('div', 'xpbar', win); const xpf = el('div', '', xpbar);
    const pay = g.tradeSlots;
    const payRefs = [ref(pay, 0), ref(pay, 1)];
    let sel = villager.trades[0] || null;
    const tradeOut = () => {
      if (!sel || sel.uses >= sel.maxUses) return null;
      const ok = (s, want) => !want || (s && s.key === want.key && s.count >= want.count);
      const a = pay.get(0), b = pay.get(1);
      if ((ok(a, sel.buy) && ok(b, sel.buy2)) || (ok(b, sel.buy) && ok(a, sel.buy2) && sel.buy2)) return { ...sel.sell };
      return null;
    };
    const outRef = {
      output: true, get: tradeOut, set: () => {},
      take: () => {
        if (!tradeOut()) return;
        const consume = want => { if (!want) return; for (let i = 0; i < 2; i++) { const s = pay.get(i); if (s && s.key === want.key && s.count >= want.count) { s.count -= want.count; pay.set(i, s.count ? s : null); return; } } };
        consume(sel.buy); consume(sel.buy2);
        g.onTrade(villager, sel);
        drawList();
      },
    };
    const row = el('div', 'flex', win);
    row.style.margin = '10px 0';
    this.grid(payRefs, 2, row);
    el('div', 'arrow-r', row).textContent = '➜';
    this.slotEl(outRef, row, 'big');
    const { hot, main } = this.playerSection(win);
    const fillPayment = t => {
      for (let i = 0; i < 2; i++) { const s = pay.get(i); if (s) { const rest = g.inv.add(s); pay.set(i, rest ? { ...s, count: rest } : null); } }
      const pull = (want, i) => { if (!want) return; const n = g.inv.main.remove(k => k === want.key, want.count * 1); if (n) pay.set(i, { key: want.key, count: n }); };
      pull(t.buy, 0); pull(t.buy2, 1);
    };
    const tItem = (parent, s) => { const d = el('div', 'ti', parent); const im = el('img', '', d); im.src = this.icon(s.key); if (s.count > 1) el('span', 'count', d).textContent = s.count; };
    const drawList = () => {
      list.textContent = '';
      for (const t of villager.trades) {
        const d = el('div', `trade ${t === sel ? 'sel' : ''} ${t.uses >= t.maxUses ? 'out' : ''}`, list);
        tItem(d, t.buy);
        if (t.buy2) tItem(d, t.buy2); else el('div', 'ti', d);
        el('span', '', d).textContent = '➜';
        tItem(d, t.sell);
        d.addEventListener('mousedown', e => { e.stopPropagation(); sel = t; fillPayment(t); drawList(); this.refresh(); });
      }
      const need = [0, 10, 70, 150, 250][villager.level] || 250, prev = [0, 0, 10, 70, 150][villager.level] || 0;
      xpf.style.width = `${Math.min(100, ((villager.xp - prev) / Math.max(1, need - prev)) * 100)}%`;
    };
    drawList();
    this.screen.quickMove = (r, s) => (payRefs.includes(r) ? this.moveInto(s, [...hot, ...main]) : this.moveInto(s, payRefs));
    this.screen.onClose = () => { for (let i = 0; i < 2; i++) { const s = pay.get(i); if (s) { const rest = g.inv.add(s); if (rest) g.dropStack({ ...s, count: rest }); pay.set(i, null); } } villager.trading = null; };
  }

  update() { if (this.screen && this.screen.tick) this.screen.tick(); }
}

// ---------------- HUD ----------------
export class HUD {
  constructor(game, sprites) {
    this.game = game; this.sprites = sprites;
    this.hotbar = $('hotbar');
    this.last = {};
    this.shakeT = 0;
    this.hotbarSlots = [];
    for (let i = 0; i < 9; i++) { const s = el('div', 'slot', this.hotbar); this.hotbarSlots.push(s); }
    this.toastQ = [];
  }
  fillSlot(div, s) {
    div.textContent = '';
    if (!s) return;
    const img = el('img', '', div); img.src = this.game.icons[s.key] || '';
    if (s.count > 1) el('span', 'count', div).textContent = s.count;
    const it = I[s.key];
    if (it && it.durability && s.dmg) {
      const d = el('div', 'dur', div), f = el('div', '', d), frac = 1 - s.dmg / it.durability;
      f.style.width = `${frac * 100}%`; f.style.background = `hsl(${frac * 120}, 90%, 45%)`;
    }
  }
  renderHotbar() {
    const inv = this.game.inv;
    this.hotbarSlots.forEach((d, i) => { this.fillSlot(d, inv.main.get(i)); d.classList.toggle('selected', i === inv.selected); });
    const off = $('offhand-slot'), o = inv.offhand.get(0);
    off.classList.toggle('hidden', !o);
    this.fillSlot(off, o);
  }
  row(id, n, full, half, empty, value, cap = 10, flip = false) {
    const key = `${id}:${value}:${full}:${this.shakeK}`;
    if (this.last[id] === key) return;
    this.last[id] = key;
    const r = $(id);
    r.textContent = '';
    for (let i = 0; i < Math.min(cap, n); i++) {
      const v = value - i * 2;
      const im = el('img', '', r);
      im.src = v >= 2 ? full : v === 1 ? half : empty;
      if (this.shakeK && id === 'hearts-row' && (i + this.shakeK) % 3 === 0) im.classList.add('shake');
    }
    void flip;
  }
  update(dt) {
    const g = this.game, S = this.sprites, st = g.stats;
    const survival = g.mode === 'survival' || g.mode === 'adventure' || g.mode === 'hardcore';
    $('stats').style.visibility = survival ? 'visible' : 'hidden';
    $('xp').style.visibility = survival ? 'visible' : 'hidden';
    if (survival) {
      const poison = st.effects.poison ? S.heartPoison : st.effects.wither ? S.heartWither : S.heart;
      this.shakeT -= dt;
      this.shakeK = st.health <= 4 && this.shakeT <= 0 ? (Math.floor(g.time * 12) % 3) + 1 : 0;
      const hp = Math.ceil(st.health);
      this.row('hearts-row', Math.ceil(Math.max(20, st.maxHealth) / 2), poison, S.heartHalf, S.heartEmpty, hp);
      const abs = Math.ceil(st.absorption);
      $('hearts-row2').classList.toggle('hidden', abs <= 0);
      if (abs > 0) this.row('hearts-row2', Math.ceil(abs / 2), S.heartGold, S.heartGold, S.heartEmpty, abs);
      const hunger = st.effects.hunger ? S.foodHunger : S.food;
      this.row('food-row', 10, hunger, S.foodHalf, S.foodEmpty, Math.ceil(st.food));
      const ap = g.inv.armorPoints().pts;
      $('armor-row').classList.toggle('hidden', ap <= 0);
      if (ap > 0) this.row('armor-row', 10, S.armor, S.armorHalf, S.armorEmpty, ap);
      const underwater = g.player.headInWater && st.air < 300;
      $('air-row').classList.toggle('hidden', !underwater);
      if (underwater) this.row('air-row', Math.ceil(st.air / 30), S.bubble, S.bubble, S.bubble, 20);
      $('xp-fill').style.width = `${st.xpProgress * 100}%`;
      $('xp-level').textContent = st.level > 0 ? st.level : '';
    }
    const cd = g.attackCooldown;
    const ind = $('attack-ind');
    ind.classList.toggle('hidden', !(survival && cd < 1 && cd > 0));
    ind.firstChild.style.width = `${cd * 100}%`;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').classList.remove('show'); }
    else if (this.toastQ.length) this.showToast(...this.toastQ.shift());
  }
  toast(title, text, icon) { this.toastQ.push([title, text, icon]); }
  showToast(title, text, icon) {
    const t = $('toast');
    t.querySelector('img').src = this.game.icons[icon] || '';
    t.querySelector('.t1').textContent = title;
    t.querySelector('.t2').textContent = text;
    t.classList.add('show');
    this.toastT = 4;
  }
}

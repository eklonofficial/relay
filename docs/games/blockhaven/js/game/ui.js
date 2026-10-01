// Container GUIs (inventory, crafting, chest, furnace, creative, trading) and the HUD, laid out in GUI pixels
// (1 unit = var(--u)) at the original's coordinates: 176x166 panels, 18x18 slots, 16x16 icons.
import { I, ITEMS, TABS, maxStack, ARMOR_SLOTS, iconKey } from '../data/items.js?v=muprr3ie';
import { findRecipe, allRecipes, matches, SMELTING, TAGS } from '../data/recipes.js?v=muprr3ie';
import { same } from './inventory.js?v=muprr3ie';
import { tableOffers, enchantName, enchantsOf, anvilResult, isEnchantable, hasGlint, ENCHANTS, ENCHANT_LIST } from '../data/enchantments.js?v=muprr3ie';
const ENCH_CURSE = id => !!(ENCHANTS[id] && ENCHANTS[id].curse);

// The enchanting table's glyphs (the Standard Galactic Alphabet as usually typed in Unicode).
const GLYPHS = ['ᔑ', 'ʖ', 'ᓵ', '↸', 'ᒷ', '⎓', '⊣', '⍑', '╎', '⋮', 'ꖌ', 'ꖎ', 'ᒲ', 'リ', 'ᑑ', '∷', 'ᓭ', 'ℸ', '⚍', '⍊', '∴', '⨅'];

const $ = id => document.getElementById(id);
const el = (tag, cls, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
export const fuelOf = key => { const it = I[key]; if (!it) return 0; if (it.fuel) return it.fuel; if (TAGS.logs.includes(key) || TAGS.planks.includes(key)) return 15; if (/_slab$/.test(key) && TAGS.slabs_wood.includes(key)) return 7.5; if (key === 'coal_block') return 800; if (/_sapling$|stick|_fence$|ladder|crafting_table|chest|bookshelf|bowl|_door$|_trapdoor$/.test(key)) return 5; return 0; };
const U = n => `calc(var(--u) * ${n})`;
const at = (e, x, y, w, h) => { const s = e.style; s.left = U(x); s.top = U(y); if (w !== undefined) { s.width = U(w); s.height = U(h); } return e; };
const guiScale = () => parseFloat(document.documentElement.style.getPropertyValue('--gs')) || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gs')) || 2;

// ---------- pixel sprites (our own art, drawn once into data URLs) ----------
const grid = (w, h, f) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => f(x, y)).join(''));
function pix(rows, pal) {
  const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length;
  const x = c.getContext('2d');
  rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const col = pal[r[i]]; if (col) { x.fillStyle = col; x.fillRect(i, j, 1, 1); } } });
  return c.toDataURL();
}
// 9-slice panel: 1 px black outline with cut corners, 2 px light band top/left, 2 px dark band bottom/right.
const PANEL = ['..KKKKK..', '.KWWWWWK.', 'KWWWWWGDK', 'KWWGGGDDK', 'KWWGGGDDK', 'KWWGGGDDK', 'KWGDDDDDK', '.KDDDDDK.', '..KKKKK..'];
const arrow = (w, h, t) => { const m = (h - 1) / 2, hx = w - Math.ceil(h / 2); return grid(w, h, (x, y) => ((x < hx ? Math.abs(y - m) <= t : Math.abs(y - m) <= m - (x - hx)) ? 'a' : '.')); };
const FLAME = ['..............', '......#.......', '......##......', '.....###...#..', '.....####..#..', '....#####.##..', '...#########..',
  '..###########.', '..###########.', '.############.', '.############.', '.############.', '..##########..', '...########...'];
const SIL = {
  helmet: ['', '', '', '', '.....######.....', '...##########...', '..############..', '..############..', '..####....####..', '..###......###..', '..###......###..', '..##........##..'],
  chestplate: ['', '..#####..#####..', '.##############.', '.##############.', '.###.######.###.', '.###.######.###.', '.....######.....', '....########....', '....########....', '....########....', '....########....', '....########....', '....########....'],
  leggings: ['', '', '....########....', '....########....', '....########....', ...Array(8).fill('....###..###....')],
  boots: ['', '', '', '', '', '', '', '....###..###....', '....###..###....', '....###..###....', '...####..####...', '..#####..#####..', '..#####..#####..'],
  shield: ['', '', ...Array(6).fill('...##########...'), '....########....', '....########....', '.....######.....', '......####......'],
};
let SPR = null;
function sprites() {
  if (SPR) return SPR;
  const panel = (W, G, D, K = '#000') => pix(PANEL, { K, W, G, D });
  const flameMask = FLAME.map(r => [...r]);
  const edge = (x, y) => !(flameMask[y] && flameMask[y][x] === '#');
  const flameLit = FLAME.map((r, y) => [...r].map((ch, x) => { if (ch !== '#') return '.'; if (edge(x - 1, y) || edge(x + 1, y) || edge(x, y - 1) || edge(x, y + 1)) return 'e'; if (edge(x - 2, y) || edge(x + 2, y) || edge(x, y - 2)) return 'i'; return 'c'; }).join(''));
  const sil = rows => pix(Array.from({ length: 16 }, (_, i) => (rows[i] || '').padEnd(16, '.')), { '#': 'rgba(40,40,40,0.3)' });
  const hot = w => grid(w, 22, (x, y) => { if (x === 0 || y === 0 || x === w - 1 || y === 21) return 'o'; const cx = (x - 1) % 20, cy = y - 1; return cx === 0 || cy === 0 ? 'h' : cx === 19 || cy === 19 ? 's' : 'i'; });
  const HOT = { o: 'rgba(0,0,0,0.8)', h: 'rgba(150,150,150,0.85)', s: 'rgba(80,80,80,0.85)', i: 'rgba(20,20,20,0.42)' };
  const bar = rows => grid(182, 5, (x, y) => (y === 0 || y === 4 || x === 0 || x === 181 ? 'K' : 'abc'[y - 1]));
  const pageArrow = flip => grid(12, 17, (x, y) => { const X = flip ? 11 - x : x, inside = (X, Y) => X >= 2 && X <= 10 && Math.abs(Y - 8) <= 10 - X; if (!inside(X, y)) return '.'; return inside(X - 1, y) && inside(X + 1, y) && inside(X, y - 1) && inside(X, y + 1) ? 'w' : 'K'; });
  const book = grid(20, 18, (x, y) => {
    if (y === 0 || y === 17) return '.';
    if (x <= 16) { if (x === 0 || x === 16 || y === 1 || y === 16) return 'K'; if (x <= 2) return 'd'; if (y === 2) return 'l'; return x >= 6 && x <= 13 && y >= 5 && y <= 12 && (x - 6) % 3 < 2 && (y - 5) % 3 < 2 ? 'e' : 'g'; }
    if (y === 1 || y === 16) return '.';
    return x === 19 || y === 2 || y === 15 ? 'K' : 'p';
  });
  SPR = {
    panel: panel('#ffffff', '#c6c6c6', '#555555'), tab: panel('#d4d4d4', '#a4a4a4', '#4a4a4a'), toast: panel('#4a4a4a', '#212121', '#303030'),
    arrow16: pix(arrow(16, 13, 1), { a: '#8b8b8b' }), arrow22: pix(arrow(22, 15, 2), { a: '#8b8b8b' }), arrow10: pix(arrow(10, 9, 1), { a: '#8b8b8b' }),
    plus: pix(grid(13, 13, (x, y) => ((x >= 5 && x <= 7) || (y >= 5 && y <= 7) ? 'a' : '.')), { a: '#8b8b8b' }),
    furnaceArrow: pix(arrow(24, 16, 1.5), { a: '#8b8b8b' }), furnaceArrowFill: pix(arrow(24, 16, 1.5), { a: '#ffffff' }),
    flameOff: pix(FLAME, { '#': '#b4b4b4' }), flame: pix(flameLit, { e: '#d23c00', i: '#ff9a00', c: '#ffe45a' }),
    outOfStock: pix(grid(10, 9, (x, y) => (x >= 1 && x <= 9 && (Math.abs((x - 1) - y) <= 0.5 || Math.abs((x - 1) + y - 8) <= 0.5) ? 'r' : '.')), { r: '#e02020' }),
    trash: pix(grid(16, 16, (x, y) => (x >= 3 && x <= 12 && y >= 3 && y <= 12 && (x === y || x === y + 1 || x + y === 15 || x + y === 16) ? 'r' : '.')), { r: 'rgba(160,30,30,0.75)' }),
    missing: pix(grid(16, 16, (x, y) => (((x >> 3) + (y >> 3)) & 1 ? 'k' : 'm')), { k: '#000', m: '#f800f8' }),
    book: pix(book, { K: '#000', d: '#2d5e1e', g: '#3f8b2c', l: '#6cc24a', e: '#9be07a', p: '#ece6d2' }),
    pageFwd: pix(pageArrow(false), { K: '#373737', w: '#e8e8e8' }), pageBack: pix(pageArrow(true), { K: '#373737', w: '#e8e8e8' }),
    hotbar: pix(hot(182), HOT), hotbar1: pix(hot(22), HOT),
    sel: pix(grid(24, 24, (x, y) => 'abcd'[Math.min(x, y, 23 - x, 23 - y)] || '.'), { a: 'rgba(0,0,0,0.8)', b: '#ffffff', c: '#d8d8d8', d: 'rgba(0,0,0,0.35)' }),
    xp: pix(bar(), { K: '#000', a: '#343434', b: '#2a2a2a', c: '#222222' }), xpFill: pix(bar(), { K: '#000', a: '#b6ff6a', b: '#80ff20', c: '#58c010' }),
  };
  for (const [k, rows] of Object.entries(SIL)) SPR['ph_' + k] = sil(rows);
  const root = document.documentElement.style;
  for (const k of ['panel', 'tab', 'toast', 'hotbar', 'hotbar1', 'sel', 'xp', 'xpFill', 'trash']) root.setProperty(`--spr-${k.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`, `url(${SPR[k]})`);
  return SPR;
}

// Item icon + count (bottom-right, 8-px font) + durability bar (13x2 at icon +2,+13), for GUI and HUD slots alike.
function fillItem(div, s, icons, ghost = null) {
  div.textContent = '';
  const show = s || ghost;
  if (!show) return;
  const img = el('img', ghost && !s ? 'ghost' : '', div);
  img.src = icons[iconKey(show)] || sprites().missing;
  // Enchanted items shimmer: a sliding violet sheen masked to the icon's shape.
  if (s && hasGlint(s)) { const gl = el('div', 'glint', div); gl.style.maskImage = gl.style.webkitMaskImage = `url(${img.src})`; }
  if (s && s.count > 1) el('span', 'count', div).textContent = s.count;
  const it = s && I[s.key];
  if (it && it.durability && s.dmg) {
    const frac = Math.max(0, 1 - s.dmg / it.durability), d = el('div', 'dur', div), f = el('div', '', d);
    f.style.width = U(Math.round(frac * 13)); f.style.background = `hsl(${frac * 120}, 100%, 50%)`;
  }
}

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
    this.rbPage = 0; this.rbCraftable = false; this.rbQuery = '';
    this.slotEls = [];
    this.cursorEl = $('cursor-item');
    this.tooltip = $('tooltip');
    sprites();
    document.addEventListener('mousemove', e => {
      this.mx = e.clientX; this.my = e.clientY;
      if (this.drag) this.drag(e.clientY);
      if (this.screen) this.positionFloating();
    });
    document.addEventListener('mouseup', () => { this.drag = null; });
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    this.root.addEventListener('mousedown', e => { if ((e.target === this.root || e.target.classList.contains('lay')) && this.cursor && this.screen) { this.dropCursor(e.button === 2); } });
    this.root.addEventListener('wheel', e => { if (this.screen && this.screen.onWheel && e.deltaY) { e.preventDefault(); this.screen.onWheel(Math.sign(e.deltaY)); } }, { passive: false });
  }

  get isOpen() { return !!this.screen; }
  icon(key) { return this.game.icons[key] || ''; }

  // ---------- rendering helpers ----------
  fillSlot(div, s, ghost = null) { fillItem(div, s, this.game.icons, ghost); }
  // A slot whose 16x16 icon sits at (x, y) in the window, like the original's Slot coordinates.
  slotEl(r, parent, cls = '', x, y) {
    const div = el('div', `gs ${cls}`, parent);
    div._ref = r;
    if (x !== undefined) { const o = /\bbig\b/.test(cls) ? 5 : 1; at(div, x - o, y - o); }
    if (r.placeholder) { div.classList.add('ph'); div.style.setProperty('--ph', `url(${sprites()['ph_' + r.placeholder]})`); }
    this.fillSlot(div, r.get(), r.ghost);
    div.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.click(r, e); });
    div.addEventListener('dblclick', e => { e.preventDefault(); this.collect(r); });
    div.addEventListener('mouseenter', () => { this.hover = r; this.showTooltip(r.get()); });
    div.addEventListener('mouseleave', () => { if (this.hover === r) this.hover = null; this.hideTooltip(); });
    this.slotEls.push(div);
    return div;
  }
  gridAt(refs, cols, parent, x, y, cls = '') { refs.forEach((r, i) => this.slotEl(r, parent, cls, x + (i % cols) * 18, y + Math.floor(i / cols) * 18)); }
  layout(cls = '') { return el('div', `lay ${cls}`, this.root); }
  win(parent, w, h, cls = '') { const d = el('div', `win ${cls}`, parent); d.style.width = U(w); d.style.height = U(h); return d; }
  // Dark-grey 8-px label; (x, y) is the top of the capitals, as in drawString.
  label(win, text, x, y, center = false) { const l = el('div', center ? 'lbl c' : 'lbl', win); l.textContent = text; at(l, x, y - 1); return l; }
  spr(parent, name, x, y, w, h, cls = '') { const d = el('div', `spr ${cls}`, parent); at(d, x, y, w, h); d.style.backgroundImage = `url(${sprites()[name]})`; return d; }
  tip(e, lines) { e.addEventListener('mouseenter', () => { if (!this.cursor) this.showTip(typeof lines === 'function' ? lines() : lines); }); e.addEventListener('mouseleave', () => this.hideTooltip()); }
  playerView(win, x, y, w, h, sc) {
    const box = el('div', 'pview', win); at(box, x, y, w, h);
    const c = el('canvas', '', box); c.width = 16; c.height = 32;
    at(c, Math.floor((w - 16 * sc) / 2), h - 32 * sc - 3, 16 * sc, 32 * sc);
    try {
      const a = this.game.app, L = a.mobLayer('player');
      let i = 0; for (let k = 0; k < 8; k++) if (a.mobLayers.get(`player_${k}`) === L) { i = k; break; }
      c.getContext('2d').drawImage(a.skinPreview(i), 0, 0);
    } catch { /* no skin preview available */ }
  }
  refresh() {
    for (const d of this.slotEls) this.fillSlot(d, d._ref.get(), d._ref.ghost);
    this.renderCursor();
    if (this.screen && this.screen.onRefresh) this.screen.onRefresh();
    if (this.hover) this.showTooltip(this.hover.get());
  }
  renderCursor() {
    const c = this.cursorEl;
    if (!this.cursor) { c.textContent = ''; c.classList.add('hidden'); return; }
    c.classList.remove('hidden');
    this.fillSlot(c, this.cursor);
    this.positionFloating();
  }
  positionFloating() {
    this.cursorEl.style.left = `${this.mx}px`; this.cursorEl.style.top = `${this.my}px`;
    const t = this.tooltip;
    if (t.classList.contains('hidden')) return;
    // The original draws the text 12 px right of and 12 px above the pointer (the box starts 3 px further out), flipping left at the edge.
    const gs = guiScale(), w = t.offsetWidth, h = t.offsetHeight;
    let x = this.mx + 9 * gs, y = this.my - 15 * gs;
    if (x + w > innerWidth - gs) x = Math.max(gs, this.mx - 13 * gs - w);
    y = Math.max(gs, Math.min(y, innerHeight - h - gs));
    t.style.left = `${x}px`; t.style.top = `${y}px`;
  }
  // Tooltip lines like the advanced (F3+H) tooltip: name, attribute lines, durability, then the item id in dark grey.
  tipLines(s) {
    const it = I[s.key];
    if (!it) return [[s.key, '']];
    const ench = enchantsOf(s), enchanted = Object.keys(ench).length > 0;
    // Like the original's rarity colours: enchanted gear is aqua, enchanted books yellow.
    const L = [[(s.tag && s.tag.name) || it.name, s.key === 'enchanted_book' ? 'yellow' : enchanted && s.key !== 'enchanted_book' ? 'aqua' : '']];
    for (const [id, lv] of Object.entries(ench)) L.push([enchantName(id, lv), ENCH_CURSE(id) ? 'curse' : 'ench']);
    const melee = it.damage && it.kind !== 'bow';
    if (melee || it.attackSpeed) { L.push(['', ''], ['When in Main Hand:', 'gray']); if (melee) L.push([` ${it.damage} Attack Damage`, 'green']); if (it.attackSpeed) L.push([` ${it.attackSpeed} Attack Speed`, 'green']); }
    if (it.armor && (it.armor.points || it.armor.tough)) {
      L.push(['', ''], [`When on ${['Head', 'Body', 'Legs', 'Feet'][it.armor.slot] || 'Body'}:`, 'gray']);
      if (it.armor.points) L.push([`+${it.armor.points} Armor`, 'blue']);
      if (it.armor.tough) L.push([`+${it.armor.tough} Armor Toughness`, 'blue']);
    }
    if (it.food && it.food.hunger) L.push([`Restores ${it.food.hunger / 2} Hunger`, 'blue']);
    if (it.durability) L.push([`Durability: ${it.durability - (s.dmg || 0)} / ${it.durability}`, '']);
    L.push([`blockhaven:${s.key}`, 'dark']);
    return L;
  }
  showTip(lines) {
    const t = this.tooltip;
    t.textContent = '';
    for (const [text, c] of lines) el('div', c ? `t-${c}` : '', t).textContent = text || ' ';
    t.classList.remove('hidden');
    this.positionFloating();
  }
  showTooltip(s) {
    if (!s || this.cursor) { this.hideTooltip(); return; }
    this.showTip(this.tipLines(s));
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
    // Curse of Binding: armor can't be taken off (except in creative).
    if (r.binding && s && s.tag && s.tag.ench && s.tag.ench.binding_curse && g.mode !== 'creative') return;
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
    const full = { ...s, count: e.button === 2 ? 1 : maxStack(s.key) };
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
    // Typing on a creative tab jumps to the search tab with that letter, like the original.
    if (this.screen.kind === 'creative' && this.creativeTab !== 'search' && /^Key[A-Z]$/.test(e.code) && e.code !== 'KeyQ' && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
      this.creativeTab = 'search'; this.search = e.key; this.creativeScroll = 0; this.switchTab(); return true;
    }
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
  // The player-inventory block: "Inventory" label, 9x3 main grid and the hotbar row 4 px below it.
  playerSection(win, y = 84, labelY = 72, x = 8) {
    const { hot, main } = this.invRefs();
    if (labelY !== null) this.label(win, 'Inventory', x, labelY);
    this.gridAt(main, 9, win, x, y);
    this.gridAt(hot, 9, win, x, y + 58);
    return { hot, main };
  }
  armorRefs() { const inv = this.game.inv; return ARMOR_SLOTS.map((piece, k) => ref(inv.armor, k, { accept: s => I[s.key].armor && I[s.key].armor.slot === k, limit: 1, placeholder: piece, binding: true })); }

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
    this.drag = null;
    this.root.classList.add('hidden');
    this.root.textContent = '';
    this.cursorEl.classList.add('hidden');
    this.hideTooltip();
    if (!silent) this.game.onGuiClose();
  }

  craftingGrid(win, size, container, gx, gy, ox, oy, big) {
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
    this.gridAt(cells, size, win, gx, gy);
    this.slotEl(out, win, big ? 'big' : '', ox, oy);
    return { cells, out };
  }

  // Recipe book panel (147x166, left of the window): search field, craftable filter, 5x4 pages of recipe buttons.
  recipeBook(parent, size, cells, container) {
    const book = this.win(parent, 147, 166, 'book');
    book.classList.toggle('hidden', !this.bookOpen);
    const search = el('input', 'field', book);
    search.type = 'text'; search.placeholder = 'Search...'; search.spellcheck = false; search.value = this.rbQuery;
    at(search, 25, 13, 81, 14);
    const filt = el('div', 'gbtn rb-filter', book); at(filt, 110, 12, 26, 16);
    el('img', '', filt).src = this.icon('crafting_table');
    this.tip(filt, () => [[this.rbCraftable ? 'Showing Craftable' : 'Showing All', '']]);
    const gridEl = el('div', 'rb-grid', book); at(gridEl, 11, 31, 125, 100);
    const pageL = this.label(book, '', 73, 141, true); pageL.classList.add('rb-page');
    const prev = this.spr(book, 'pageBack', 38, 137, 12, 17, 'rb-arrow'), next = this.spr(book, 'pageFwd', 93, 137, 12, 17, 'rb-arrow');
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
    let hovering = false;
    const draw = () => {
      if (hovering) { hovering = false; this.hideTooltip(); }
      gridEl.textContent = '';
      const q = search.value.trim().toLowerCase();
      const seen = new Set(), list = [];
      const all = recipes.filter(r => (!q || I[r.out].name.toLowerCase().includes(q))).map(r => [r, canMake(r)]);
      all.sort((a, b) => b[1] - a[1]);
      for (const [r, ok] of all) { if (seen.has(r.out) || (this.rbCraftable && !ok)) continue; seen.add(r.out); list.push([r, ok]); }
      const pages = Math.max(1, Math.ceil(list.length / 20));
      this.rbPage = Math.max(0, Math.min(this.rbPage, pages - 1));
      list.slice(this.rbPage * 20, this.rbPage * 20 + 20).forEach(([r, ok], i) => {
        const d = el('div', `rb-slot${ok ? '' : ' missing'}`, gridEl);
        at(d, (i % 5) * 25, Math.floor(i / 5) * 25, 25, 25);
        this.fillSlot(d, { key: r.out, count: r.count });
        d.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.game.sound.click(0.4); if (ok) fill(r); });
        d.addEventListener('mouseenter', () => { if (!this.cursor) { hovering = true; this.showTip(this.tipLines({ key: r.out, count: r.count })); } });
        d.addEventListener('mouseleave', () => { hovering = false; this.hideTooltip(); });
      });
      pageL.textContent = pages > 1 ? `${this.rbPage + 1}/${pages}` : '';
      prev.classList.toggle('hidden', this.rbPage <= 0);
      next.classList.toggle('hidden', this.rbPage >= pages - 1);
      filt.classList.toggle('on', this.rbCraftable);
    };
    const btn = (e, f) => e.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); this.game.sound.click(0.4); f(); draw(); });
    btn(prev, () => this.rbPage--); btn(next, () => this.rbPage++);
    btn(filt, () => { this.rbCraftable = !this.rbCraftable; this.rbPage = 0; this.showTip([[this.rbCraftable ? 'Showing Craftable' : 'Showing All', '']]); });
    search.addEventListener('input', () => { this.rbQuery = search.value; this.rbPage = 0; draw(); });
    search.addEventListener('keydown', e => e.stopPropagation());
    search.addEventListener('mousedown', e => e.stopPropagation());
    draw();
    return { draw, el: book };
  }
  // The green recipe-book button: shows/hides the book without rebuilding the window (the grid keeps its items).
  bookButton(win, x, y, book) {
    const b = this.spr(win, 'book', x, y, 20, 18, 'rb-toggle');
    b.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.game.sound.click(0.4); this.bookOpen = !this.bookOpen; book.classList.toggle('hidden', !this.bookOpen); });
  }

  openInventory() {
    if (this.game.creativeMenu) { this.openCreative(); return; }
    this.begin('inventory');
    const g = this.game, inv = g.inv;
    const lay = this.layout();
    const win = this.win(lay, 176, 166);
    const armorRefs = this.armorRefs();
    armorRefs.forEach((r, k) => this.slotEl(r, win, '', 8, 8 + k * 18));
    this.playerView(win, 25, 7, 51, 72, 2);
    const offRef = ref(inv.offhand, 0, { placeholder: 'shield' });
    this.slotEl(offRef, win, '', 77, 62);
    this.label(win, 'Crafting', 97, 6);
    const { cells } = this.craftingGrid(win, 2, inv.craft, 98, 18, 154, 28, false);
    this.spr(win, 'arrow16', 135, 29, 16, 13);
    const { hot, main } = this.playerSection(win, 84, null);
    const rb = this.recipeBook(lay, 2, cells, inv.craft);
    lay.insertBefore(rb.el, win);
    this.bookButton(win, 104, 61, rb.el);
    this.screen.quickMove = (r, s) => {
      const it = I[s.key];
      if (armorRefs.includes(r) || cells.includes(r) || r === offRef) return this.moveInto(s, [...main, ...hot]);
      if (it.armor && !armorRefs[it.armor.slot].get()) return this.moveInto(s, [armorRefs[it.armor.slot]]);
      if (hot.includes(r)) return this.moveInto(s, main);
      return this.moveInto(s, hot);
    };
    this.screen.onRefresh = () => rb.draw();
    this.screen.onClose = () => { for (const c of cells) { const s = c.get(); if (s) { const rest = inv.add(s); if (rest) g.dropStack({ ...s, count: rest }); c.set(null); } } };
  }

  openCrafting() {
    this.begin('crafting');
    const g = this.game, inv = g.inv;
    const lay = this.layout();
    const win = this.win(lay, 176, 166);
    this.label(win, 'Crafting', 29, 6);
    const grid = g.tableGrid;
    const { cells } = this.craftingGrid(win, 3, grid, 30, 17, 124, 35, true);
    this.spr(win, 'arrow22', 90, 35, 22, 15);
    const { hot, main } = this.playerSection(win);
    const rb = this.recipeBook(lay, 3, cells, grid);
    lay.insertBefore(rb.el, win);
    this.bookButton(win, 5, 34, rb.el);
    this.screen.quickMove = (r, s) => {
      if (cells.includes(r)) return this.moveInto(s, [...main, ...hot]);
      if (hot.includes(r)) return this.moveInto(s, main);
      return this.moveInto(s, hot);
    };
    this.screen.onRefresh = () => rb.draw();
    this.screen.onClose = () => { for (const c of cells) { const s = c.get(); if (s) { const rest = inv.add(s); if (rest) g.dropStack({ ...s, count: rest }); c.set(null); } } };
  }

  // Chest-like containers: rows of 9 (a 3x3 grid for 9-slot dispensers, one centred row for hoppers).
  openChest(container, title = 'Chest', onClose = null) {
    this.begin('chest');
    const n = container.slots.length, refs = container.slots.map((_, i) => ref(container, i));
    const lay = this.layout();
    let h, mainY;
    if (n === 9) { h = 166; mainY = 84; }
    else { const rows = Math.ceil(n / 9); h = 114 + rows * 18; mainY = h - 83; }
    const win = this.win(lay, 176, h);
    this.label(win, title, 8, 6);
    if (n === 9) this.gridAt(refs, 3, win, 62, 17);
    else this.gridAt(refs, 9, win, 8 + (9 - Math.min(9, n)) * 9, 18);
    const { hot, main } = this.playerSection(win, mainY, mainY - 12);
    this.screen.quickMove = (r, s) => (refs.includes(r) ? this.moveInto(s, [...hot, ...main].reverse().reverse()) : this.moveInto(s, refs));
    this.screen.onClose = onClose;
  }

  openFurnace(be) {
    this.begin('furnace');
    const lay = this.layout();
    const win = this.win(lay, 176, 166);
    this.label(win, 'Furnace', 88, 6, true);
    const c = be.container;
    const inRef = ref(c, 0), fuelRef = ref(c, 1, { accept: s => fuelOf(s.key) > 0 }), outRef = { output: true, get: () => c.get(2), set: s => c.set(2, s), take: () => { const s = c.get(2); c.set(2, null); this.game.onSmelt(s, be); } };
    this.slotEl(inRef, win, '', 56, 17);
    this.slotEl(fuelRef, win, '', 56, 53);
    this.slotEl(outRef, win, 'big', 116, 35);
    this.spr(win, 'flameOff', 56, 36, 14, 14);
    const flame = this.spr(win, 'flame', 56, 36, 14, 0, 'fill-up');
    this.spr(win, 'furnaceArrow', 79, 34, 24, 16);
    const arrowFg = this.spr(win, 'furnaceArrowFill', 79, 34, 0, 16, 'fill-right');
    const { hot, main } = this.playerSection(win);
    this.screen.quickMove = (r, s) => {
      if (r === inRef || r === fuelRef || r === outRef) return this.moveInto(s, [...hot, ...main]);
      if (SMELTING[s.key]) return this.moveInto(s, [inRef]);
      if (fuelOf(s.key)) return this.moveInto(s, [fuelRef]);
      return hot.includes(r) ? this.moveInto(s, main) : this.moveInto(s, hot);
    };
    // Whole GUI pixels, like the original: the arrow fills left to right, the flame burns down from the top.
    this.screen.tick = () => {
      arrowFg.style.width = U(Math.min(24, Math.ceil((be.cook || 0) * 24)));
      const k = be.burnMax && be.burn > 0 ? Math.min(14, Math.ceil((be.burn / be.burnMax) * 13) + 1) : 0;
      flame.style.top = U(50 - k); flame.style.height = U(k);
    };
    this.screen.tick();
    this.screen.be = be;
  }

  // Rebuilds the creative window on another tab, keeping the stack on the pointer (close() would put it away).
  switchTab() { const keep = this.cursor; this.cursor = null; this.openCreative(); this.cursor = keep; this.renderCursor(); }
  // Creative inventory: 195x136 panel, 26x32 tabs above and below, 9x5 item grid with a 14 px scrollbar.
  openCreative() {
    this.begin('creative');
    const g = this.game, inv = g.inv, tab = this.creativeTab;
    const lay = this.layout('tabbed');
    const win = this.win(lay, 195, 136, 'creative');
    const names = Object.fromEntries([...TABS, ['search', 'Search Items'], ['inventory', 'Survival Inventory']]);
    const tabIcon = { building: 'bricks', colored: 'cyan_wool', natural: 'grass_block', functional: 'crafting_table', redstone: 'redstone', tools: 'iron_pickaxe', combat: 'diamond_sword', food: 'apple', ingredients: 'iron_ingot', spawn_eggs: 'zombie_spawn_egg', search: 'compass', inventory: 'chest' };
    const rowsOfTabs = [['building', 'colored', 'natural', 'functional', 'redstone', null, 'search'], ['tools', 'combat', 'food', 'ingredients', 'spawn_eggs', null, 'inventory']];
    rowsOfTabs.forEach((row, bot) => row.forEach((k, col) => {
      if (!k) return;
      const on = k === tab, t = el('div', `tab ${bot ? 'bot' : 'top'}${on ? ' on' : ''}${col === 0 ? ' first' : ''}${col === 6 ? ' last' : ''}`, win);
      at(t, col === 6 ? 169 : col * 27, bot ? (on ? 133 : 132) : -28, 26, on ? 31 : 32);
      const im = el('img', '', t); im.src = this.icon(tabIcon[k]) || this.icon('stone');
      at(im, 1, bot ? (on ? 2 : 3) : 5, 16, 16);
      t.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); if (k === this.creativeTab) return; g.sound.click(0.4); this.creativeTab = k; this.creativeScroll = 0; this.switchTab(); });
      this.tip(t, [[names[k], '']]);
    }));
    const { hot, main } = this.invRefs();
    if (tab === 'inventory') {
      const armorRefs = this.armorRefs();
      [[54, 6], [54, 33], [108, 6], [108, 33]].forEach(([x, y], k) => this.slotEl(armorRefs[k], win, '', x, y));
      this.slotEl(ref(inv.offhand, 0, { placeholder: 'shield' }), win, '', 35, 20);
      this.playerView(win, 73, 6, 32, 43, 1);
      this.gridAt(main, 9, win, 9, 54);
      const trash = this.slotEl({ trash: true, get: () => null, set: () => {} }, win, 'trash ph', 173, 112);
      trash.style.setProperty('--ph', 'var(--spr-trash)');
      this.tip(trash, [['Destroy Item', ''], ['Shift-click: clear the inventory', 'gray']]);
    } else {
      this.label(win, tab === 'search' ? 'Search' : names[tab], 8, 6); // our font runs wider than the original's: keep clear of the field
      // Enchanted books appear once per enchantment and level, as in the original's creative tabs.
      const expand = arr => arr.flatMap(it => (it.key === 'enchanted_book' ? ENCHANT_LIST.flatMap(e => Array.from({ length: e.max }, (_, k) => ({ key: it.key, name: enchantName(e.id, k + 1), tag: { stored: { [e.id]: k + 1 } } }))) : [it]));
      const list = () => expand(tab === 'search' ? ITEMS.filter(it => { const q = this.search.trim().toLowerCase(); return !q || it.name.toLowerCase().includes(q) || it.key.includes(q) || (it.key === 'enchanted_book' && ENCHANT_LIST.some(e => e.name.toLowerCase().includes(q))); }) : ITEMS.filter(it => it.tab === tab));
      let items = list(), off = 0;
      const extra = () => Math.max(0, Math.ceil(items.length / 9) - 5);
      const refs = Array.from({ length: 45 }, (_, i) => ({ creative: true, get: () => { const it = items[off * 9 + i]; return it ? (it.tag ? { key: it.key, count: 1, tag: JSON.parse(JSON.stringify(it.tag)) } : { key: it.key, count: 1 }) : null; }, set: () => {} }));
      this.gridAt(refs, 9, win, 9, 18);
      const track = el('div', 'scroll-track', win); at(track, 174, 17, 14, 112);
      const handle = el('div', 'scroll-handle', win); at(handle, 175, 18, 12, 15);
      const setScroll = s => {
        const n = extra();
        this.creativeScroll = n ? Math.max(0, Math.min(1, s)) : 0;
        off = Math.round(this.creativeScroll * n);
        handle.style.top = U(18 + Math.round(95 * (n ? off / n : 0)));
        handle.classList.toggle('off', !n);
        this.refresh();
      };
      this.screen.onWheel = d => { const n = extra(); if (n) setScroll((off + d) / n); };
      const dragTo = y => { const gs = guiScale(), r = track.getBoundingClientRect(); setScroll((y - r.top - 8.5 * gs) / (95 * gs)); };
      for (const e of [track, handle]) e.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); if (!extra()) return; this.drag = dragTo; dragTo(ev.clientY); });
      if (tab === 'search') {
        const s = el('input', 'field csearch', win);
        s.type = 'text'; s.spellcheck = false; s.value = this.search;
        at(s, 81, 4, 88, 12);
        s.addEventListener('keydown', e => e.stopPropagation());
        s.addEventListener('mousedown', e => e.stopPropagation());
        s.addEventListener('input', () => { this.search = s.value; items = list(); setScroll(0); });
        setTimeout(() => s.focus(), 0);
      }
      setScroll(this.creativeScroll);
    }
    this.gridAt(hot, 9, win, 9, 112);
    this.screen.quickMove = (r, s) => (hot.includes(r) ? this.moveInto(s, main) : this.moveInto(s, hot));
  }

  // Villager trading: 276x166, offers list on the left (88x20 buttons), payment slots, result and the level bar on the right.
  openTrade(villager) {
    this.begin('trade');
    const g = this.game;
    const lay = this.layout();
    const win = this.win(lay, 276, 166);
    this.label(win, 'Trades', 53, 6, true);
    this.label(win, `${villager.displayName} - ${['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'][villager.level - 1] || ''}`, 187, 6, true);
    const xpbar = el('div', 'txp', win); at(xpbar, 136, 16, 102, 5);
    const xpf = el('div', '', xpbar);
    const list = el('div', 'offers', win); at(list, 5, 18, 88, 140);
    const pay = g.tradeSlots;
    const payRefs = [ref(pay, 0), ref(pay, 1)];
    let sel = villager.trades[0] || null;
    const tradeOut = () => {
      if (!sel || sel.uses >= sel.maxUses) return null;
      const ok = (s, want) => !want || (s && s.key === want.key && s.count >= want.count);
      const a = pay.get(0), b = pay.get(1);
      if ((ok(a, sel.buy) && ok(b, sel.buy2)) || (ok(b, sel.buy) && ok(a, sel.buy2) && sel.buy2)) return JSON.parse(JSON.stringify(sel.sell));
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
    this.slotEl(payRefs[0], win, '', 136, 37);
    this.slotEl(payRefs[1], win, '', 162, 37);
    this.spr(win, 'arrow22', 188, 38, 22, 15);
    this.slotEl(outRef, win, '', 220, 37);
    const { hot, main } = this.playerSection(win, 84, 72, 108);
    const fillPayment = t => {
      for (let i = 0; i < 2; i++) { const s = pay.get(i); if (s) { const rest = g.inv.add(s); pay.set(i, rest ? { ...s, count: rest } : null); } }
      const pull = (want, i) => { if (!want) return; const n = g.inv.main.remove(k => k === want.key, want.count * 1); if (n) pay.set(i, { key: want.key, count: n }); };
      pull(t.buy, 0); pull(t.buy2, 1);
    };
    const tItem = (parent, s, x) => { const d = el('div', 'ti', parent); d.style.left = U(x); fillItem(d, s, g.icons); this.tip(d, () => this.tipLines(s)); };
    let offset = 0;
    const scroller = el('div', 'scroll-handle', win);
    const drawList = () => {
      list.textContent = '';
      const n = villager.trades.length;
      offset = Math.max(0, Math.min(offset, n - 7));
      scroller.classList.toggle('hidden', n <= 7);
      at(scroller, 94, 18 + (n > 7 ? Math.round(113 * offset / (n - 7)) : 0), 6, 27);
      villager.trades.slice(offset, offset + 7).forEach((t, i) => {
        const d = el('div', `gbtn offer${t === sel ? ' sel' : ''}${t.uses >= t.maxUses ? ' out' : ''}`, list);
        at(d, 0, i * 20, 88, 20);
        tItem(d, t.buy, 5);
        if (t.buy2) tItem(d, t.buy2, 30);
        this.spr(d, t.uses >= t.maxUses ? 'outOfStock' : 'arrow10', 53, 6, 10, 9);
        tItem(d, t.sell, 67);
        d.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); g.sound.click(0.4); sel = t; fillPayment(t); drawList(); this.refresh(); });
      });
      const need = [0, 10, 70, 150, 250][villager.level] || 250, prev = [0, 0, 10, 70, 150][villager.level] || 0;
      xpf.style.width = U(Math.round(Math.max(0, Math.min(1, (villager.xp - prev) / Math.max(1, need - prev))) * 102));
    };
    drawList();
    this.screen.onWheel = d => { offset += d; drawList(); };
    this.screen.quickMove = (r, s) => (payRefs.includes(r) ? this.moveInto(s, [...hot, ...main]) : this.moveInto(s, payRefs));
    this.screen.onClose = () => { for (let i = 0; i < 2; i++) { const s = pay.get(i); if (s) { const rest = g.inv.add(s); if (rest) g.dropStack({ ...s, count: rest }); pay.set(i, null); } } villager.trading = null; };
  }

  // Enchanting table: item and lapis slots on the left, three offers (108x19) on the right.
  openEnchanting(x, y, z) {
    this.begin('enchanting');
    const g = this.game, slots = g.enchSlots;
    const lay = this.layout();
    const win = this.win(lay, 176, 166);
    this.label(win, 'Enchant', 12, 6);
    const book = el('img', 'ebook', win); book.src = this.icon('enchanted_book'); at(book, 16, 14, 24, 24);
    const itemRef = ref(slots, 0, { limit: 1, accept: s => isEnchantable(s.key) && !Object.keys(enchantsOf(s)).length || s.key === 'book' });
    const lapisRef = ref(slots, 1, { accept: s => s.key === 'lapis_lazuli', placeholder: null });
    this.slotEl(itemRef, win, '', 15, 47);
    this.slotEl(lapisRef, win, '', 35, 47);
    const shelves = g.bookshelvesAround(x, y, z);
    const btns = [0, 1, 2].map(i => { const b = el('div', 'gbtn eopt', win); at(b, 60, 14 + 19 * i, 108, 19); return b; });
    let offers = null;
    const draw = () => {
      const it = slots.get(0), lapis = slots.get(1), creative = g.mode === 'creative';
      if (g.stats.enchSeed === undefined) g.stats.enchSeed = Math.floor(Math.random() * 2 ** 31);
      offers = it ? tableOffers(g.stats.enchSeed, it.key === 'book' ? 'book' : it.key, shelves) : null;
      btns.forEach((b, i) => {
        b.textContent = '';
        const cost = offers ? offers.costs[i] : 0;
        b.classList.toggle('off', !cost);
        if (!cost) { b.onmousedown = null; b.onmouseenter = null; return; }
        const can = creative || (g.stats.level >= cost && lapis && lapis.count >= i + 1);
        b.classList.toggle('dim', !can);
        const orb = el('div', `eorb${can ? '' : ' dim'}`, b); orb.textContent = i + 1; at(orb, 1, 1, 16, 16);
        const r = (g.stats.enchSeed * 31 + i * 977 + cost * 13) >>> 0;
        const gl = el('div', 'eglyph', b); at(gl, 20, 2, 70, 15);
        gl.textContent = Array.from({ length: 2 + (r % 3) }, (_, k) => Array.from({ length: 2 + ((r >> (k * 3)) % 4) }, (_, j) => GLYPHS[(r * (k + 3) * (j + 7) >> 3) % GLYPHS.length]).join('')).join(' ');
        const n = el('div', `ecost${can ? '' : ' dim'}`, b); n.textContent = cost;
        const clue = offers.clues[i];
        const lines = () => {
          const L = [[`${clue ? enchantName(clue.id, clue.level) : '?'} . . . ?`, '']];
          if (!creative && g.stats.level < cost) L.push([`Level Requirement: ${cost}`, 'red']);
          else if (!creative) { L.push([`${i + 1} Lapis Lazuli`, lapis && lapis.count >= i + 1 ? 'gray' : 'red'], [`${i + 1} Enchantment Level${i ? 's' : ''}`, 'gray']); }
          return L;
        };
        b.onmouseenter = () => { if (!this.cursor) this.showTip(lines()); };
        b.onmouseleave = () => this.hideTooltip();
        b.onmousedown = e => {
          e.preventDefault(); e.stopPropagation();
          if (!can) return;
          const s = slots.get(0), list = offers.picks[i];
          if (!s || !list) return;
          const ench = Object.fromEntries(list.map(x => [x.id, x.level]));
          const out = s.key === 'book' ? { key: 'enchanted_book', count: 1, tag: { stored: ench } } : { ...s, tag: { ...(s.tag || {}), ench } };
          slots.set(0, out);
          if (!creative) { const l = slots.get(1); l.count -= i + 1; slots.set(1, l.count ? l : null); g.spendLevels(i + 1); }
          g.stats.enchSeed = Math.floor(Math.random() * 2 ** 31);
          g.sound.play('enchant', [x + 0.5, y + 0.5, z + 0.5], 0.8);
          g.advance('enchanter', 'Enchanter', 'Enchant an item at an Enchanting Table', 'enchanting_table');
          this.hideTooltip();
          this.refresh();
        };
      });
    };
    const { hot, main } = this.playerSection(win);
    this.screen.onRefresh = draw;
    draw();
    this.screen.quickMove = (r, s) => {
      if (r === itemRef || r === lapisRef) return this.moveInto(s, [...hot, ...main]);
      if (s.key === 'lapis_lazuli') return this.moveInto(s, [lapisRef]);
      if (!slots.get(0) && itemRef.accept(s)) { slots.set(0, { ...s, count: 1 }); return s.count > 1 ? { ...s, count: s.count - 1 } : null; }
      return hot.includes(r) ? this.moveInto(s, main) : this.moveInto(s, hot);
    };
    this.screen.onClose = () => g.returnSlots(slots);
  }

  // Anvil: "Repair & Name", a name field, two inputs and the result; the cost below in green, or
  // red when it's too expensive or you lack the levels.
  openAnvil(x, y, z) {
    this.begin('anvil');
    const g = this.game, slots = g.anvilSlots;
    const lay = this.layout();
    const win = this.win(lay, 176, 166);
    this.label(win, 'Repair & Name', 60, 6);
    const name = el('input', 'field aname', win);
    name.type = 'text'; name.spellcheck = false; name.maxLength = 50;
    at(name, 59, 20, 110, 12);
    name.addEventListener('keydown', e => e.stopPropagation());
    name.addEventListener('mousedown', e => e.stopPropagation());
    let named = null;
    const leftRef = ref(slots, 0, { onChange: () => { const s = slots.get(0); named = null; name.value = s ? (s.tag && s.tag.name) || I[s.key].name : ''; } });
    const rightRef = ref(slots, 1);
    const calc = () => {
      const l = slots.get(0), r = slots.get(1);
      if (!l) return null;
      return anvilResult(l, r, named === null ? undefined : named, { creative: g.mode === 'creative' });
    };
    const outRef = {
      output: true,
      get: () => { const c = calc(); return c && !c.tooExpensive ? c.result : null; },
      set: () => {},
      take: () => {
        const c = calc();
        if (!c || c.tooExpensive || (g.mode !== 'creative' && g.stats.level < c.cost)) return;
        if (g.mode !== 'creative') g.spendLevels(c.cost);
        slots.set(0, null);
        const r = slots.get(1);
        if (r) { r.count -= c.used; slots.set(1, r.count > 0 ? r : null); }
        named = null; name.value = '';
        g.useAnvil(x, y, z);
      },
    };
    this.slotEl(leftRef, win, '', 27, 47);
    this.spr(win, 'plus', 52, 47, 13, 13);
    this.slotEl(rightRef, win, '', 76, 47);
    this.spr(win, 'arrow22', 99, 45, 22, 15);
    const outEl = this.slotEl(outRef, win, '', 134, 47);
    const cost = el('div', 'acost', win); at(cost, 60, 69, 108, 12);
    name.addEventListener('input', () => { named = name.value; this.refresh(); });
    this.screen.onRefresh = () => {
      const c = calc();
      cost.textContent = '';
      outEl.classList.toggle('blocked', !!c && (c.tooExpensive || (g.mode !== 'creative' && g.stats.level < c.cost)));
      if (!c) return;
      if (c.tooExpensive) { cost.textContent = 'Too Expensive!'; cost.className = 'acost red'; return; }
      cost.textContent = `Enchantment Cost: ${c.cost}`;
      cost.className = `acost${g.mode !== 'creative' && g.stats.level < c.cost ? ' red' : ''}`;
    };
    const { hot, main } = this.playerSection(win);
    this.screen.onRefresh();
    this.screen.quickMove = (r, s) => {
      if (r === leftRef || r === rightRef) return this.moveInto(s, [...hot, ...main]);
      return this.moveInto(s, [leftRef, rightRef]);
    };
    this.screen.onClose = () => g.returnSlots(slots);
  }

  update() { if (this.screen && this.screen.tick) this.screen.tick(); }
}

// ---------------- HUD ----------------
let debugObserver = null;
export class HUD {
  constructor(game, sprites_) {
    sprites();
    this.game = game; this.sprites = sprites_;
    this.hotbar = $('hotbar');
    this.last = {};
    this.hotbarSlots = [];
    this.hotbar.textContent = ''; // a new HUD per world: never stack on the previous one's slots
    this.sel = el('div', 'sel', this.hotbar);
    for (let i = 0; i < 9; i++) { const s = el('div', 'slot', this.hotbar); at(s, 1 + i * 20, 1); this.hotbarSlots.push(s); }
    this.toastQ = [];
    this.blinkT = 0; this.hpLast = undefined; this.hpShown = 0; this.tick = -1; this.jig = null;
    // F3 text arrives as one string; give every line its own translucent backing like the original's debug screen.
    const dbg = $('debug');
    if (debugObserver) debugObserver.disconnect();
    debugObserver = new MutationObserver(() => {
      const f = dbg.firstChild;
      if (!f || f.nodeType !== 3 || dbg.childNodes.length !== 1) return;
      const lines = f.nodeValue.split('\n');
      dbg.textContent = '';
      for (const l of lines) el('div', '', dbg).textContent = l || ' ';
    });
    debugObserver.observe(dbg, { childList: true });
  }
  fillSlot(div, s) { fillItem(div, s, this.game.icons); }
  renderHotbar() {
    const inv = this.game.inv;
    this.hotbarSlots.forEach((d, i) => this.fillSlot(d, inv.main.get(i)));
    this.sel.style.left = U(-1 + inv.selected * 20);
    const off = $('offhand-slot'), o = inv.offhand.get(0);
    off.classList.toggle('hidden', !o);
    this.fillSlot(off, o);
    this.last.cd = null;
  }
  // One icon per 8 px (9 px sprites overlapping by 1): food, armor, air, mount health fallback.
  row(id, n, full, half, empty, value, cap = 10) {
    const key = `${n}:${value}:${full.length}:${half.length}:${full.slice(-24)}`;
    if (this.last[id] === key) return;
    this.last[id] = key;
    const r = $(id);
    r.textContent = '';
    for (let i = 0; i < Math.min(cap, n); i++) {
      const v = value - i * 2;
      el('i', '', r).style.backgroundImage = `url(${v >= 2 ? full : v === 1 ? half : empty})`;
    }
  }
  // Hearts, layered like the original: container (white while blinking after damage), lost health in white, then the heart.
  hearts(id, n, hp, shown, blink, kind) {
    const S = this.sprites, key = `${n}:${hp}:${shown}:${blink}:${kind}:${this.jig ? this.tick : 0}`;
    if (this.last[id] === key) return;
    this.last[id] = key;
    const r = $(id);
    r.textContent = '';
    for (let i = 0; i < Math.min(10, n); i++) {
      const v = hp - 2 * i, w = shown - 2 * i, L = [];
      if (v >= 2) L.push(S[kind]); else if (v === 1) L.push(S[kind + 'Half'] || S[kind]);
      if (blink && v < 2 && w > Math.max(0, v)) L.push(w >= 2 ? S.heartWhite : S.heartWhiteHalf);
      L.push(blink ? S.heartBlink : S.heartEmpty);
      const d = el('i', '', r);
      d.style.backgroundImage = L.map(u => `url(${u})`).join(',');
      const dy = this.jig && id === 'hearts-row' ? this.jig[i] : 0;
      if (dy) d.style.transform = `translateY(${U(dy)})`;
    }
  }
  // White sweep over hotbar items that are cooling down (ender pearls, a knocked-out shield).
  updateCooldowns() {
    const g = this.game, cds = g.itemCooldowns || {};
    const slots = [...this.hotbarSlots, document.getElementById('offhand-slot')];
    slots.forEach((d, i) => {
      const s = i < 9 ? g.inv.main.get(i) : g.inv.offhand.get(0), c = s && cds[s.key];
      let o = d.querySelector('.cd');
      if (!c) { if (o) o.remove(); return; }
      if (!o) { o = document.createElement('div'); o.className = 'cd'; d.appendChild(o); }
      o.style.height = U(Math.ceil(Math.max(0, Math.min(1, c.t / c.max)) * 16));
    });
  }
  update(dt) {
    const g = this.game, S = this.sprites, st = g.stats;
    this.updateCooldowns();
    const survival = g.mode === 'survival' || g.mode === 'adventure' || g.mode === 'hardcore';
    $('hud').classList.toggle('nostats', !survival);
    if (survival) {
      const hp = Math.ceil(st.health);
      if (this.hpLast === undefined) this.hpLast = this.hpShown = hp;
      if (hp < this.hpLast) { this.blinkT = 1; this.hpShown = Math.max(this.hpShown, this.hpLast); } else if (hp > this.hpLast) this.blinkT = Math.max(this.blinkT, 0.5);
      this.hpLast = hp;
      if (this.blinkT > 0) { this.blinkT -= dt; if (this.blinkT <= 0) { this.blinkT = 0; this.hpShown = hp; } }
      const blink = this.blinkT > 0 && Math.floor(this.blinkT / 0.15) % 2 === 1;
      // Low health shakes the hearts a pixel at random each tick; regeneration runs a wave through them.
      const tick = Math.floor(g.time * 20);
      if (tick !== this.tick) {
        this.tick = tick;
        const low = st.health + st.absorption <= 4, regen = st.effects.regeneration;
        this.jig = low || regen ? Array.from({ length: 10 }, (_, i) => (low ? Math.floor(Math.random() * 2) : 0) - (regen && i === tick % 25 ? 2 : 0)) : null;
      }
      const kind = st.effects.poison ? 'heartPoison' : st.effects.wither ? 'heartWither' : 'heart';
      this.hearts('hearts-row', Math.ceil(Math.min(20, st.maxHealth) / 2), hp, this.hpShown, blink, kind);
      const abs = Math.ceil(st.absorption);
      $('hearts-row2').classList.toggle('hidden', abs <= 0);
      $('stats').classList.toggle('abs', abs > 0);
      if (abs > 0) this.hearts('hearts-row2', Math.ceil(abs / 2), abs, abs, false, 'heartGold');
      const hunger = !!st.effects.hunger;
      if (!(g.riding && g.riding.saddled)) this.row('food-row', 10, hunger ? S.foodHunger : S.food, hunger ? S.foodHungerHalf : S.foodHalf, S.foodEmpty, Math.ceil(st.food));
      const ap = g.inv.armorPoints().pts;
      $('armor-row').classList.toggle('hidden', ap <= 0);
      if (ap > 0) this.row('armor-row', 10, S.armor, S.armorHalf, S.armorEmpty, ap);
      const underwater = g.player.headInWater && st.air < 300;
      $('air-row').classList.toggle('hidden', !underwater);
      if (underwater) this.row('air-row', Math.ceil(st.air / 30), S.bubble, S.bubble, S.bubble, 20);
      $('xp-fill').style.width = U(Math.min(182, Math.floor(st.xpProgress * 183)));
      $('xp-level').textContent = st.level > 0 ? st.level : '';
    }
    // Riding: the mount's health replaces hunger and the jump charge replaces the XP bar.
    const mount = g.riding && g.riding.saddled ? g.riding : null;
    if (mount) {
      const mh = Math.ceil(mount.maxHealth / 2), hp = Math.ceil(mount.health);
      this.hearts('food-row', Math.min(10, mh), Math.round(hp * Math.min(10, mh) / mh), 0, false, 'heart');
      $('xp-fill').style.width = U(Math.min(182, Math.floor((g.jumpCharge || 0) * 183))); $('xp-fill').classList.add('jump'); $('xp-level').textContent = '';
      this.wasRiding = true;
    } else if (this.wasRiding) { this.wasRiding = false; $('xp-fill').classList.remove('jump'); this.last = {}; }
    if (g.bossBar) $('boss').style.setProperty('--boss', g.bossBar.color || '#e070ff');
    const cd = g.attackCooldown;
    const ind = $('attack-ind');
    ind.classList.toggle('hidden', !(survival && cd < 1 && cd > 0));
    ind.firstChild.style.width = U(Math.min(16, Math.floor(cd * 17)));
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
    this.toastT = 5;
  }
}

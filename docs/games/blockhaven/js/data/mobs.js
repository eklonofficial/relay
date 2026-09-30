// Mob roster: stats, AI archetype, drops, box models and procedural skins.
// Model space: 1 unit = 1/16 block, feet at y=0, the mob faces -Z.
import { D, pal, shade as shadeHex } from '../render/mobtex.js?v=munl5eht';

const box = (o, s, style, extra = {}) => ({ o, s, style, ...extra });
const part = (pivot, boxes, extra = {}) => ({ pivot, boxes, ...extra });
const S = (base, pattern = 'noise', decor = null, spread = 0.12) => ({ pal: pal(base, spread), pattern, decor });

// ---------------- face decorations ----------------
const face = (...fns) => ({ front: D.all(...fns) });
const eyes = (o = {}) => D.eyes(o);
const mouth = (c = '#2a1a1a', y = 0.78, w = 0.5) => D.rect((1 - w) / 2, y, w, 0.12, c);
const snout = c => D.rect(0.25, 0.55, 0.5, 0.35, c);

// ---------------- builders ----------------
// Humanoid with head/body/arms/legs; opts: thin limbs, tall legs, head height, arm/leg styles.
function humanoid(st, o = {}) {
  const legH = o.legH ?? 12, bodyH = o.bodyH ?? 12, limb = o.thin ? 2 : 4, headH = o.headH ?? 8, bodyD = o.bodyD ?? 4;
  const armH = o.armH ?? 12;
  const top = legH + bodyH;
  const parts = {
    rightLeg: part([limb / 2 + (o.thin ? 0 : 0), legH, 0], [box([-limb / 2, -legH, -limb / 2], [limb, legH, limb], st.leg || st.body)]),
    leftLeg: part([-limb / 2, legH, 0], [box([-limb / 2, -legH, -limb / 2], [limb, legH, limb], st.leg || st.body, { mirror: true })]),
    body: part([0, legH, 0], [box([-4, 0, -bodyD / 2], [8, bodyH, bodyD], st.body)]),
    head: part([0, top, 0], [box([-4, 0, -4], [8, headH, 8], st.head)]),
    rightArm: part([4 + limb / 2, top - 2, 0], [box([-limb / 2, -armH + 2, -limb / 2], [limb, armH, limb], st.arm || st.body)]),
    leftArm: part([-4 - limb / 2, top - 2, 0], [box([-limb / 2, -armH + 2, -limb / 2], [limb, armH, limb], st.arm || st.body, { mirror: true })]),
  };
  if (o.thin) { parts.rightLeg.pivot[0] = 2; parts.leftLeg.pivot[0] = -2; parts.rightArm.pivot[0] = 5; parts.leftArm.pivot[0] = -5; }
  if (st.hat) parts.head.boxes.push(box([-4, 0, -4], [8, headH, 8], st.hat, { inflate: 0.5 }));
  if (o.nose) parts.head.boxes.push(box([-1, 1, -6], [2, 4, 2], st.nose || st.head));
  if (o.robe) parts.body.boxes.push(box([-4, -legH + 2, -3], [8, bodyH + legH - 2, 6], st.robe, { inflate: 0.3 }));
  if (o.crossed) {
    delete parts.rightArm; delete parts.leftArm;
    parts.arms = part([0, top - 3, -1], [box([-4, -4, -2], [8, 4, 4], st.arm || st.body), box([-8, -6, -2], [4, 8, 4], st.arm || st.body), box([4, -6, -2], [4, 8, 4], st.arm || st.body)], { rot: [-0.75, 0, 0] });
  }
  return { anim: o.crossed ? 'villager' : 'biped', parts, eye: top + headH * 0.55, thin: !!o.thin };
}

// Four-legged animal; dims in pixels.
function quadruped(st, d) {
  const { legH = 6, legW = 4, bodyW = 10, bodyH = 8, bodyL = 16, headW = 8, headH = 8, headL = 8, neckUp = 0, legInset = 0 } = d;
  const hx = bodyW / 2 - legW / 2 - legInset, hz = bodyL / 2 - legW / 2 - 1;
  const leg = (x, z, m) => part([x, legH, z], [box([-legW / 2, -legH, -legW / 2], [legW, legH, legW], st.leg || st.body, { mirror: m })]);
  const parts = {
    body: part([0, legH, 0], [box([-bodyW / 2, 0, -bodyL / 2], [bodyW, bodyH, bodyL], st.body)]),
    head: part([0, legH + bodyH * 0.6 + neckUp, -bodyL / 2], [box([-headW / 2, -headH / 2, -headL], [headW, headH, headL], st.head)]),
    leg0: leg(hx, -hz, false), leg1: leg(-hx, -hz, true), leg2: leg(hx, hz, false), leg3: leg(-hx, hz, true),
  };
  return { anim: 'quadruped', parts, eye: legH + bodyH * 0.6 + neckUp };
}

const PIG = '#f0a0a0', COW = '#4a3222', SHEEP = '#e8e8e8', ZOMBIE_SKIN = '#5e8f4a', HUSK = '#b8a06a', DROWNED = '#4f9a92';
const skinFace = (eyeCol = '#ffffff', pupil = '#3a2a8a') => face(eyes({ c: eyeCol, pupil, y: 0.45, sep: 0.2 }), mouth('#5a3a2a', 0.75, 0.25));

// ---------------- mob definitions ----------------
export const MOBS = {};
function mob(key, def) { MOBS[key] = { key, name: def.name || key.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), ...def }; }

// --- passive animals ---
mob('pig', {
  hw: 0.45, h: 0.9, health: 10, speed: 2.5, kind: 'passive', ai: 'animal', food: ['carrot', 'potato', 'beetroot'], egg: ['#f0a0a0', '#d06a6a'],
  drops: [['porkchop', 1, 3]], cooked: { porkchop: 'cooked_porkchop' }, xp: [1, 3], sound: 'pig',
  model: () => { const m = quadruped({ body: S(PIG, 'noise'), head: S(PIG, 'noise', face(eyes({ c: '#ffffff', pupil: '#1a1a1a', y: 0.3 }))), leg: S(PIG) }, { legH: 6, bodyW: 10, bodyH: 8, bodyL: 16, headW: 8, headH: 8, headL: 8 }); m.parts.head.boxes.push(box([-2, -3, -9], [4, 3, 1], S('#e08a8a', 'flat', { front: D.all(D.rect(0.2, 0.3, 0.2, 0.4, '#8a4a4a'), D.rect(0.6, 0.3, 0.2, 0.4, '#8a4a4a')) }))); return m; },
});
mob('cow', {
  hw: 0.45, h: 1.4, health: 10, speed: 2.2, kind: 'passive', ai: 'animal', food: ['wheat'], egg: ['#4a3222', '#a8a8a8'],
  drops: [['beef', 1, 3], ['leather', 0, 2]], cooked: { beef: 'cooked_beef' }, xp: [1, 3], sound: 'cow', milk: true,
  model: () => { const body = S(COW, 'noise', { all: D.spots('#f0f0f0', 4, 3) }); const m = quadruped({ body, head: S(COW, 'noise', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3 }), D.rect(0.25, 0.6, 0.5, 0.4, '#d8b8a8'))), leg: S(COW) }, { legH: 12, bodyW: 12, bodyH: 10, bodyL: 18, headW: 8, headH: 8, headL: 6 }); m.parts.head.boxes.push(box([-5, 2, -5], [1, 3, 1], S('#e0dccc', 'flat')), box([4, 2, -5], [1, 3, 1], S('#e0dccc', 'flat'))); return m; },
});
mob('mooshroom', {
  hw: 0.45, h: 1.4, health: 10, speed: 2.2, kind: 'passive', ai: 'animal', food: ['wheat'], egg: ['#a01818', '#b8b8b8'],
  drops: [['beef', 1, 3], ['leather', 0, 2]], cooked: { beef: 'cooked_beef' }, xp: [1, 3], sound: 'cow', milk: true, stew: true,
  model: () => { const m = quadruped({ body: S('#a01818', 'noise', { all: D.spots('#d8d8d8', 3, 3) }), head: S('#a01818', 'noise', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3 }), D.rect(0.25, 0.6, 0.5, 0.4, '#b8a8a8'))), leg: S('#b8b8b8') }, { legH: 12, bodyW: 12, bodyH: 10, bodyL: 18, headW: 8, headH: 8, headL: 6 }); m.parts.body.boxes.push(box([-2, 10, -3], [4, 4, 4], S('#c82020', 'noise', { all: D.spots('#f0f0f0', 3, 1) })), box([-3, 10, 4], [4, 4, 4], S('#c82020', 'noise', { all: D.spots('#f0f0f0', 3, 1) }))); return m; },
});
mob('sheep', {
  hw: 0.45, h: 1.3, health: 8, speed: 2.3, kind: 'passive', ai: 'animal', food: ['wheat'], egg: ['#e8e8e8', '#ffb5b5'],
  drops: [['mutton', 1, 2]], woolDrop: true, cooked: { mutton: 'cooked_mutton' }, xp: [1, 3], sound: 'sheep', shearable: true,
  model: () => { const m = quadruped({ body: S('#d8cfc4'), head: S('#d8cfc4', 'noise', face(eyes({ c: '#ffffff', pupil: '#1a1a1a', y: 0.35 }), D.rect(0.3, 0.7, 0.4, 0.2, '#f0b0b0'))), leg: S('#d8cfc4') }, { legH: 12, bodyW: 8, bodyH: 6, bodyL: 16, headW: 6, headH: 6, headL: 8 }); m.parts.body.boxes.push(box([-4, 0, -8], [8, 6, 16], S(SHEEP, 'wool', null, 0.06), { inflate: 1.75, wool: true })); m.parts.head.boxes.push(box([-3, -3, -7], [6, 6, 6], S(SHEEP, 'wool', null, 0.06), { inflate: 0.6, wool: true })); return m; },
});
mob('chicken', {
  hw: 0.2, h: 0.7, health: 4, speed: 2.4, kind: 'passive', ai: 'animal', food: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'], egg: ['#f0f0f0', '#e02020'],
  drops: [['chicken', 1, 1], ['feather', 0, 2]], cooked: { chicken: 'cooked_chicken' }, xp: [1, 3], sound: 'chicken', layEggs: true, slowFall: true,
  model: () => ({
    anim: 'chicken', eye: 13, parts: {
      body: part([0, 8, 0], [box([-3, -3, -4], [6, 6, 8], S('#f0f0f0', 'noise', null, 0.06))]),
      head: part([0, 10, -4], [box([-2, 0, -3], [4, 6, 3], S('#f4f4f4', 'noise', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.25, sep: 0.3 })), 0.05)), box([-2, 2, -5], [4, 2, 2], S('#f0a020', 'flat')), box([-1, 0, -4], [2, 2, 2], S('#d02020', 'flat'))]),
      wingR: part([3, 10, 0], [box([0, -4, -3], [1, 4, 6], S('#e8e8e8'))]), wingL: part([-3, 10, 0], [box([-1, -4, -3], [1, 4, 6], S('#e8e8e8'))]),
      leg0: part([1.5, 5, 1], [box([-0.5, -5, -0.5], [1, 5, 1], S('#f0a020', 'flat')), box([-1.5, -5, -2], [3, 0.01, 3], S('#f0a020', 'flat'))]),
      leg1: part([-1.5, 5, 1], [box([-0.5, -5, -0.5], [1, 5, 1], S('#f0a020', 'flat')), box([-1.5, -5, -2], [3, 0.01, 3], S('#f0a020', 'flat'))]),
    },
  }),
});
mob('rabbit', {
  hw: 0.2, h: 0.5, health: 3, speed: 3.5, kind: 'passive', ai: 'animal', hop: true, food: ['carrot', 'golden_carrot', 'dandelion'], egg: ['#9a7a5a', '#6a5238'],
  drops: [['rabbit', 0, 1], ['rabbit_hide', 0, 1], ['rabbit_foot', 0, 1, 0.1]], cooked: { rabbit: 'cooked_rabbit' }, xp: [1, 3], sound: 'rabbit',
  model: () => ({
    anim: 'quadruped', eye: 7, parts: {
      body: part([0, 2, 1], [box([-2.5, 0, -3], [5, 5, 7], S('#9a7a5a', 'fur'))]),
      head: part([0, 5, -2], [box([-2.5, 0, -4], [5, 4, 5], S('#9a7a5a', 'fur', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3, sep: 0.3 }))) ), box([-2, 4, -1], [1, 5, 2], S('#8a6a4a')), box([1, 4, -1], [1, 5, 2], S('#8a6a4a'))]),
      leg0: part([1.5, 2, -1], [box([-0.5, -2, -0.5], [1, 2, 1], S('#8a6a4a'))]), leg1: part([-1.5, 2, -1], [box([-0.5, -2, -0.5], [1, 2, 1], S('#8a6a4a'))]),
      leg2: part([2, 2, 3], [box([-1, -2, -2], [2, 2, 4], S('#8a6a4a'))]), leg3: part([-2, 2, 3], [box([-1, -2, -2], [2, 2, 4], S('#8a6a4a'))]),
      tail: part([0, 4, 4], [box([-1, 0, 0], [2, 2, 2], S('#f0f0f0'))]),
    },
  }),
});
// Horse family, after the original's geometry (y-up, facing -Z): body 10x10x22 on 11-px legs,
// neck and head tilted forward 30 degrees with a muzzle, ears and a mane, and a hanging tail.
const horse = (col, mane, spots, donkey = false) => () => {
  const hide = S(col, 'fur', spots ? { all: D.spots(spots, 5, 2) } : null), dark = S(mane, 'fur');
  const ear = donkey ? [2, 6, 1] : [2, 3, 1];
  const leg = (x, z, m) => part([x, 11, z], [box([-2, -11, -2], [4, 11, 4], S(col, 'fur', { all: D.band(0.8, 1, shadeHex(col, 0.7)) }), { mirror: m })]);
  return {
    anim: 'quadruped', eye: 30,
    parts: {
      body: part([0, 11, 0], [box([-5, 0, -12], [10, 10, 22], hide)]),
      head: part([0, 20, -11], [
        box([-2, -6, -2], [4, 12, 7], hide),                                            // neck
        box([-3, 6, -2], [6, 5, 7], S(col, 'fur', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3, sep: 0.34 })))), // skull
        box([-2, 6, -7], [4, 5, 5], S(col, 'fur', face(D.rect(0.2, 0.55, 0.2, 0.2, '#2a1a10'), D.rect(0.6, 0.55, 0.2, 0.2, '#2a1a10')))), // muzzle
        box([0.5, 10, 3.5], ear, S(col)), box([-2.5, 10, 3.5], ear, S(col)),             // ears
        box([-1, -5, 5], [2, 16, 2], dark),                                             // mane
      ], { rot: [-0.52, 0, 0] }),
      leg0: leg(3, -8, false), leg1: leg(-3, -8, true), leg2: leg(3, 7, false), leg3: leg(-3, 7, true),
      tail: part([0, 20, 10], [box([-1.5, -14, -2], [3, 14, 4], dark)], { rot: [-0.52, 0, 0] }),
    },
  };
};
mob('horse', { hw: 0.7, h: 1.6, health: 22, speed: 4, kind: 'passive', ai: 'animal', food: ['wheat', 'apple', 'golden_carrot', 'hay_block'], egg: ['#b8864a', '#e0d0b0'], drops: [['leather', 0, 2]], xp: [1, 3], sound: 'horse', model: horse('#9a6a3a', '#3a2a1a', '#e8dcc8') });
mob('donkey', { hw: 0.7, h: 1.5, health: 20, speed: 3.5, kind: 'passive', ai: 'animal', food: ['wheat', 'apple', 'golden_carrot'], egg: ['#6a5a4a', '#8a7a6a'], drops: [['leather', 0, 2]], xp: [1, 3], sound: 'horse', model: horse('#7a6a5a', '#3a3028', null, true) });
mob('llama', {
  hw: 0.45, h: 1.87, health: 22, speed: 2.5, kind: 'passive', ai: 'animal', food: ['wheat', 'hay_block'], egg: ['#c8b89a', '#e8dcc8'], drops: [['leather', 0, 2]], xp: [1, 3], sound: 'llama', spits: true,
  model: () => { const m = quadruped({ body: S('#d8ccb0', 'wool', null, 0.06), head: S('#d8ccb0', 'wool', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.2 })), 0.06), leg: S('#d8ccb0', 'wool', null, 0.06) }, { legH: 14, legW: 4, bodyW: 12, bodyH: 10, bodyL: 18, headW: 8, headH: 18, headL: 6, neckUp: 8 }); m.parts.head.boxes.push(box([-2, 7, -8], [4, 4, 4], S('#c8bca0', 'wool')), box([-4, 9, -2], [2, 3, 1], S('#d8ccb0')), box([2, 9, -2], [2, 3, 1], S('#d8ccb0'))); m.eye = 30; return m; },
});
mob('camel', {
  hw: 0.85, h: 2.3, health: 32, speed: 2.8, kind: 'passive', ai: 'animal', food: ['cactus'], egg: ['#c8a060', '#8a6a3a'], drops: [], xp: [1, 3], sound: 'horse',
  model: () => { const m = quadruped({ body: S('#d8b070', 'fur'), head: S('#d8b070', 'fur', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.25 }))), leg: S('#c8a060', 'fur') }, { legH: 20, legW: 4, bodyW: 14, bodyH: 12, bodyL: 26, headW: 7, headH: 7, headL: 14, neckUp: 12 }); m.parts.body.boxes.push(box([-4, 12, -4], [8, 5, 8], S('#c8a060', 'fur'))); m.parts.neck = part([0, 28, -12], [box([-2.5, 0, -3], [5, 13, 6], S('#d8b070', 'fur'))]); m.parts.head.pivot = [0, 40, -12]; m.eye = 40; return m; },
});
const wolfModel = (col, tame) => () => ({
  anim: 'quadruped', eye: 12, parts: {
    body: part([0, 8, 0], [box([-3, 0, -5], [6, 6, 10], S(col, 'fur')), box([-4, 1, -7], [8, 7, 5], S(col, 'fur'))]),
    head: part([0, 12, -7], [box([-3, -3, -4], [6, 6, 4], S(col, 'fur', face(eyes({ c: tame ? '#1a1a1a' : '#1a1a1a', pupil: null, y: 0.35, sep: 0.3 })))), box([-1.5, -3, -7], [3, 3, 3], S(col, 'fur', face(D.rect(0.3, 0, 0.4, 0.3, '#1a1a1a')))), box([-3, 3, -2], [2, 2, 1], S(col)), box([1, 3, -2], [2, 2, 1], S(col))]),
    leg0: part([1.5, 8, -4], [box([-1, -8, -1], [2, 8, 2], S(col, 'fur'))]), leg1: part([-1.5, 8, -4], [box([-1, -8, -1], [2, 8, 2], S(col, 'fur'))]),
    leg2: part([1.5, 8, 4], [box([-1, -8, -1], [2, 8, 2], S(col, 'fur'))]), leg3: part([-1.5, 8, 4], [box([-1, -8, -1], [2, 8, 2], S(col, 'fur'))]),
    tail: part([0, 12, 5], [box([-1, -8, 0], [2, 8, 2], S(col, 'fur'))], { rot: [0.6, 0, 0] }),
  },
});
mob('wolf', { chase: 5.4, hw: 0.3, h: 0.85, health: 8, speed: 3.4, kind: 'neutral', ai: 'wolf', attack: { dmg: 4, cd: 1 }, food: ['beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken', 'mutton', 'rotten_flesh'], tameItem: 'bone', egg: ['#d8d8d8', '#c8b8a0'], drops: [], xp: [1, 3], sound: 'wolf', model: wolfModel('#d8d4cc') });
mob('fox', {
  hw: 0.3, h: 0.7, health: 10, speed: 3.6, kind: 'passive', ai: 'animal', food: ['sweet_berries', 'glow_berries'], egg: ['#d87a2a', '#f0e0c8'], drops: [], xp: [1, 3], sound: 'fox', nocturnalHunter: true,
  model: () => { const m = wolfModel('#d8762a')(); m.parts.head.boxes[1].style = S('#f0e8e0', 'fur', face(D.rect(0.3, 0, 0.4, 0.3, '#1a1a1a'))); m.parts.tail.boxes = [box([-2, -9, 0], [4, 9, 4], S('#d8762a', 'fur', { all: D.band(0.8, 1, '#f0f0f0') }))]; m.parts.head.boxes[2].style = S('#2a1a10'); m.parts.head.boxes[3].style = S('#2a1a10'); return m; },
});
mob('ocelot', {
  hw: 0.3, h: 0.7, health: 10, speed: 4, kind: 'passive', ai: 'animal', food: ['cod', 'salmon'], egg: ['#e8c850', '#5a4a2a'], drops: [], xp: [1, 3], sound: 'cat', shy: true,
  model: () => { const m = wolfModel('#e0c060')(); m.parts.body.boxes = [box([-2, 0, -8], [4, 5, 14], S('#e0c060', 'fur', { all: D.spots('#6a4a1a', 6, 1) }))]; m.parts.tail.boxes = [box([-0.5, -10, 0], [1, 10, 1], S('#e0c060'))]; m.parts.head.boxes[0].style = S('#e0c060', 'fur', face(eyes({ c: '#3ac83a', pupil: '#1a1a1a', y: 0.35, sep: 0.28 }))); return m; },
});
mob('panda', {
  hw: 0.65, h: 1.25, health: 20, speed: 1.6, kind: 'neutral', ai: 'animal', food: ['bamboo'], egg: ['#f0f0f0', '#1a1a1a'], drops: [['bamboo', 0, 2]], xp: [1, 3], sound: 'panda', attack: { dmg: 6, cd: 1 },
  model: () => { const m = quadruped({ body: S('#f0f0f0', 'fur', { all: D.band(0, 0.45, '#1f1f1f') }, 0.05), head: S('#f0f0f0', 'fur', face(D.rect(0.12, 0.3, 0.3, 0.35, '#1f1f1f'), D.rect(0.58, 0.3, 0.3, 0.35, '#1f1f1f'), D.rect(0.2, 0.42, 0.1, 0.1, '#ffffff'), D.rect(0.7, 0.42, 0.1, 0.1, '#ffffff'), D.rect(0.4, 0.7, 0.2, 0.15, '#1f1f1f')), 0.05), leg: S('#1f1f1f', 'fur') }, { legH: 9, legW: 6, bodyW: 13, bodyH: 10, bodyL: 18, headW: 13, headH: 10, headL: 9 }); m.parts.head.boxes.push(box([-6, 4, -2], [3, 3, 1], S('#1f1f1f')), box([3, 4, -2], [3, 3, 1], S('#1f1f1f'))); return m; },
});
mob('polar_bear', { chase: 4.6,
  hw: 0.7, h: 1.4, health: 30, speed: 2.5, kind: 'neutral', ai: 'neutral', attack: { dmg: 6, cd: 1 }, egg: ['#f0f0f0', '#9a9a9a'], drops: [['cod', 0, 2], ['salmon', 0, 1]], xp: [1, 3], sound: 'bear',
  model: () => { const m = quadruped({ body: S('#f0f0f0', 'fur', null, 0.05), head: S('#f0f0f0', 'fur', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3, sep: 0.3 })), 0.05), leg: S('#e8e8e8', 'fur', null, 0.05) }, { legH: 10, legW: 6, bodyW: 14, bodyH: 12, bodyL: 22, headW: 7, headH: 7, headL: 7 }); m.parts.head.boxes.push(box([-2, -3.5, -10], [4, 3, 3], S('#e0e0e0', 'fur', face(D.rect(0.3, 0, 0.4, 0.4, '#1a1a1a'))))); return m; },
});
mob('goat', {
  hw: 0.45, h: 1.3, health: 10, speed: 2.8, kind: 'passive', ai: 'animal', food: ['wheat'], egg: ['#c8c0b0', '#6a5a4a'], drops: [], xp: [1, 3], sound: 'goat', milk: true, rams: true,
  model: () => { const m = quadruped({ body: S('#e0d8c8', 'fur', null, 0.07), head: S('#e0d8c8', 'fur', face(eyes({ c: '#e0c060', pupil: '#1a1a1a', y: 0.3, sep: 0.35 }))), leg: S('#c8c0b0', 'fur') }, { legH: 10, legW: 3, bodyW: 9, bodyH: 9, bodyL: 16, headW: 5, headH: 6, headL: 7, neckUp: 1 }); m.parts.head.boxes.push(box([-2.5, 3, -3], [1, 5, 1], S('#8a8272')), box([1.5, 3, -3], [1, 5, 1], S('#8a8272')), box([-1, -6, -8], [2, 3, 2], S('#e0d8c8'))); return m; },
});
mob('frog', {
  hw: 0.25, h: 0.5, health: 10, speed: 2, kind: 'passive', ai: 'animal', hop: true, amphibious: true, food: ['slime_ball'], egg: ['#d0843a', '#e8c090'], drops: [], xp: [1, 3], sound: 'frog',
  model: () => ({
    anim: 'quadruped', eye: 6, parts: {
      body: part([0, 2, 0], [box([-3.5, 0, -4.5], [7, 3, 9], S('#c8783a', 'noise', { all: D.spots('#e8a060', 3, 1) }))]),
      head: part([0, 5, 0], [box([-3.5, 0, -4.5], [7, 3, 9], S('#c8783a', 'noise', face(mouth('#6a2a1a', 0.8, 0.8)))), box([-3.5, 3, -4.5], [3, 2, 3], S('#f0f0f0', 'flat', face(D.rect(0.3, 0.3, 0.4, 0.4, '#1a1a1a')))), box([0.5, 3, -4.5], [3, 2, 3], S('#f0f0f0', 'flat', face(D.rect(0.3, 0.3, 0.4, 0.4, '#1a1a1a'))))]),
      leg0: part([3, 2, -3], [box([-1, -2, -1], [3, 2, 3], S('#b86a2a'))]), leg1: part([-3, 2, -3], [box([-2, -2, -1], [3, 2, 3], S('#b86a2a'))]),
      leg2: part([3, 2, 3], [box([-1, -2, -2], [3, 2, 4], S('#b86a2a'))]), leg3: part([-3, 2, 3], [box([-2, -2, -2], [3, 2, 4], S('#b86a2a'))]),
    },
  }),
});
mob('turtle', {
  hw: 0.6, h: 0.4, health: 30, speed: 1.2, kind: 'passive', ai: 'animal', amphibious: true, food: ['seagrass'], egg: ['#3a8a3a', '#e8d8a0'], drops: [['seagrass', 0, 2]], xp: [1, 3], sound: 'turtle',
  model: () => ({
    anim: 'quadruped', eye: 4, parts: {
      body: part([0, 1, 0], [box([-9, 0, -10], [18, 4, 20], S('#3a7a3a', 'scales', { top: D.stripes('#2a5a2a', 4, true) })), box([-7, -1, -8], [14, 1, 16], S('#e0d0a0'))]),
      head: part([0, 3, -10], [box([-3, -2, -6], [6, 5, 6], S('#6aa84a', 'noise', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3, sep: 0.35 }))))]),
      leg0: part([7, 2, -7], [box([0, -1, -2], [8, 1, 4], S('#6aa84a'))]), leg1: part([-7, 2, -7], [box([-8, -1, -2], [8, 1, 4], S('#6aa84a'))]),
      leg2: part([5, 2, 9], [box([-2, -1, 0], [4, 1, 6], S('#6aa84a'))]), leg3: part([-5, 2, 9], [box([-2, -1, 0], [4, 1, 6], S('#6aa84a'))]),
    },
  }),
});
mob('parrot', {
  hw: 0.25, h: 0.9, health: 6, speed: 3, kind: 'passive', ai: 'flyer', flying: true, food: ['wheat_seeds'], egg: ['#0da70b', '#ff0000'], drops: [['feather', 1, 2]], xp: [1, 3], sound: 'parrot',
  model: () => ({
    anim: 'bird', eye: 10, parts: {
      body: part([0, 3, 0], [box([-1.5, 0, -1.5], [3, 6, 3], S('#e02020', 'noise'))], { rot: [0.3, 0, 0] }),
      head: part([0, 9, 0], [box([-1, 0, -1], [2, 3, 2], S('#e02020', 'noise', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3, sep: 0.5, size: 0.5 })))), box([-0.5, 0.5, -2], [1, 2, 1], S('#2a2a2a', 'flat')), box([-0.5, 3, -1], [1, 2, 3], S('#f0d020'))]),
      wingR: part([1.5, 8, 0], [box([0, -5, -1.5], [1, 5, 3], S('#2a60e0'))]), wingL: part([-1.5, 8, 0], [box([-1, -5, -1.5], [1, 5, 3], S('#2a60e0'))]),
      tail: part([0, 3, 1], [box([-1.5, -4, 0], [3, 4, 1], S('#f0d020'))]),
      leg0: part([1, 3, 0], [box([-0.5, -3, -0.5], [1, 3, 1], S('#6a6a6a'))]), leg1: part([-1, 3, 0], [box([-0.5, -3, -0.5], [1, 3, 1], S('#6a6a6a'))]),
    },
  }),
});
mob('bat', {
  hw: 0.25, h: 0.9, health: 6, speed: 4, kind: 'ambient', ai: 'bat', flying: true, egg: ['#4c3e30', '#0f0f0f'], drops: [], xp: [0, 0], sound: 'bat',
  model: () => ({
    anim: 'bat', eye: 10, parts: {
      body: part([0, 4, 0], [box([-3, 0, -1.5], [6, 8, 3], S('#4c3e30', 'fur'))]),
      head: part([0, 12, 0], [box([-3, 0, -3], [6, 6, 6], S('#4c3e30', 'fur', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.4 })))), box([-3, 5, 0], [2, 3, 1], S('#3a2e24')), box([1, 5, 0], [2, 3, 1], S('#3a2e24'))]),
      wingR: part([3, 11, 0], [box([0, -9, 0], [9, 10, 1], S('#2a2018'))]), wingL: part([-3, 11, 0], [box([-9, -9, 0], [9, 10, 1], S('#2a2018'))]),
    },
  }),
});
const squidModel = (col, glow) => () => {
  const parts = { body: part([0, 8, 0], [box([-6, 0, -6], [12, 16, 12], S(col, 'noise', face(eyes({ c: glow ? '#aaffee' : '#ffffff', pupil: '#1a1a1a', y: 0.7 })), 0.1))]) };
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; parts[`t${i}`] = part([Math.cos(a) * 5, 8, Math.sin(a) * 5], [box([-1, -18, -1], [2, 18, 2], S(col))]); }
  return { anim: 'squid', eye: 18, parts };
};
mob('squid', { hw: 0.4, h: 0.95, health: 10, speed: 2, kind: 'water', ai: 'swimmer', swim: true, egg: ['#223b4d', '#708899'], drops: [['ink_sac', 1, 3]], xp: [1, 3], sound: 'squid', model: squidModel('#2a4a6a') });
mob('glow_squid', { hw: 0.4, h: 0.95, health: 10, speed: 2, kind: 'water', ai: 'swimmer', swim: true, glow: true, egg: ['#095656', '#85f1bc'], drops: [['glow_ink_sac', 1, 3]], xp: [1, 3], sound: 'squid', model: squidModel('#1a8a8a', true) });
const fishModel = (col, fin, len = 7, tall = 4) => () => ({
  anim: 'fish', eye: 2, parts: {
    body: part([0, 0, 0], [box([-1, 0, -len / 2], [2, tall, len], S(col, 'scales', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.2, sep: 0.4 })))), box([0, tall, -1], [0.01, 2, 4], S(fin))]),
    tail: part([0, tall / 2, len / 2], [box([0, -tall / 2, 0], [0.01, tall, 4], S(fin))]),
  },
});
mob('cod', { hw: 0.25, h: 0.3, health: 3, speed: 2.5, kind: 'water', ai: 'fish', swim: true, egg: ['#c1a76a', '#e5c48b'], drops: [['cod', 1, 1], ['bone_meal', 0, 1, 0.05]], cooked: { cod: 'cooked_cod' }, xp: [1, 3], sound: 'fish', model: fishModel('#a8906a', '#8a7454') });
mob('salmon', { hw: 0.35, h: 0.4, health: 3, speed: 2.8, kind: 'water', ai: 'fish', swim: true, egg: ['#a00f10', '#0e8474'], drops: [['salmon', 1, 1]], cooked: { salmon: 'cooked_salmon' }, xp: [1, 3], sound: 'fish', model: fishModel('#a83a3a', '#6a8a9a', 10, 5) });
mob('tropical_fish', { hw: 0.25, h: 0.4, health: 3, speed: 2.5, kind: 'water', ai: 'fish', swim: true, egg: ['#ef6915', '#fff9ef'], drops: [['tropical_fish', 1, 1]], xp: [1, 3], sound: 'fish', model: () => { const m = fishModel('#f07a2a', '#ffffff', 6, 5)(); m.parts.body.boxes[0].style = S('#f07a2a', 'noise', { all: D.stripes('#ffffff', 3, true) }); return m; } });
mob('pufferfish', { hw: 0.35, h: 0.6, health: 3, speed: 1.5, kind: 'water', ai: 'fish', swim: true, attack: { dmg: 2, cd: 1, poison: 3, touch: true }, egg: ['#f6b201', '#37c3f2'], drops: [['pufferfish', 1, 1]], xp: [1, 3], sound: 'fish', model: () => ({ anim: 'fish', eye: 4, parts: { body: part([0, 0, 0], [box([-4, 0, -4], [8, 8, 8], S('#d8c030', 'noise', { all: D.spots('#6a5a1a', 8, 1), front: D.all(D.spots('#6a5a1a', 4, 1), eyes({ c: '#1a1a1a', pupil: null, y: 0.35 })) }))]), tail: part([0, 4, 4], [box([0, -2, 0], [0.01, 4, 3], S('#d8c030'))]) } }) });
mob('dolphin', {
  hw: 0.45, h: 0.6, health: 10, speed: 5, kind: 'water', ai: 'swimmer', swim: true, breathes: true, egg: ['#223b4d', '#f9f9f9'], drops: [['cod', 0, 1]], xp: [1, 3], sound: 'dolphin',
  model: () => ({
    anim: 'fish', eye: 5, parts: {
      body: part([0, 0, 0], [box([-4, 0, -6], [8, 7, 13], S('#6a8aa8', 'gradient')), box([-0.5, 7, -1], [1, 4, 5], S('#5a7a98'))]),
      head: part([0, 3, -6], [box([-4, -3, -6], [8, 7, 6], S('#6a8aa8', 'gradient', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3 })))), box([-1, -3, -10], [2, 2, 4], S('#8aa8c0'))]),
      tail: part([0, 3, 7], [box([-2, -1, 0], [4, 3, 8], S('#6a8aa8')), box([-5, 0, 6], [10, 1, 4], S('#5a7a98'))]),
    },
  }),
});
mob('axolotl', {
  hw: 0.35, h: 0.42, health: 14, speed: 2.5, kind: 'water', ai: 'swimmer', swim: true, amphibious: true, food: ['tropical_fish'], egg: ['#fbc1e3', '#a62d74'], drops: [], xp: [1, 3], sound: 'axolotl',
  model: () => ({
    anim: 'quadruped', eye: 4, parts: {
      body: part([0, 2, 0], [box([-4, 0, -5], [8, 4, 10], S('#f4a8d0', 'noise')), box([0, 4, -3], [0.01, 2, 8], S('#e888b8'))]),
      head: part([0, 4, -5], [box([-4, -2, -5], [8, 5, 5], S('#f4a8d0', 'noise', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.4, sep: 0.35 }), mouth('#8a2a5a', 0.75, 0.4)))), box([-8, -1, -2], [3, 5, 0.01], S('#c83a7a')), box([5, -1, -2], [3, 5, 0.01], S('#c83a7a'))]),
      leg0: part([4, 2, -3], [box([0, -1, -1], [3, 1, 2], S('#e888b8'))]), leg1: part([-4, 2, -3], [box([-3, -1, -1], [3, 1, 2], S('#e888b8'))]),
      leg2: part([4, 2, 3], [box([0, -1, -1], [3, 1, 2], S('#e888b8'))]), leg3: part([-4, 2, 3], [box([-3, -1, -1], [3, 1, 2], S('#e888b8'))]),
      tail: part([0, 3, 5], [box([0, -2, 0], [0.01, 5, 12], S('#e888b8'))]),
    },
  }),
});
mob('strider', {
  hw: 0.45, h: 1.7, health: 20, speed: 2, kind: 'passive', ai: 'animal', lavaWalker: true, fireImmune: true, food: ['warped_fungus'], egg: ['#9c3436', '#4d494d'], drops: [['string', 2, 5]], xp: [1, 3], sound: 'strider',
  model: () => ({
    anim: 'quadruped', eye: 22, parts: {
      body: part([0, 14, 0], [box([-8, 0, -8], [16, 14, 16], S('#9c3436', 'noise', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.35 }), mouth('#5a1a1a', 0.6, 0.6)))), box([-7, 14, -6], [2, 6, 0.01], S('#7a2a2a')), box([5, 14, -6], [2, 6, 0.01], S('#7a2a2a'))]),
      leg0: part([4, 16, 0], [box([-2, -16, -2], [4, 16, 4], S('#4d494d'))]), leg1: part([-4, 16, 0], [box([-2, -16, -2], [4, 16, 4], S('#4d494d'))]),
    },
  }),
});

// --- villagers & utility ---
const VILLAGER_SKIN = '#b58663';
const villagerModel = (robe, extra) => () => {
  const m = humanoid({ head: S(VILLAGER_SKIN, 'noise', face(eyes({ c: '#ffffff', pupil: '#2a7a2a', y: 0.35 }), D.rect(0.15, 0.25, 0.7, 0.08, '#4a3020'))), body: S(robe), robe: S(robe, 'noise', extra), arm: S(robe), leg: S('#5a4a3a'), nose: S(VILLAGER_SKIN) }, { headH: 10, bodyD: 6, nose: true, robe: true, crossed: true });
  return m;
};
export const PROFESSIONS = ['farmer', 'librarian', 'armorer', 'weaponsmith', 'toolsmith', 'butcher', 'cleric', 'fletcher', 'leatherworker', 'shepherd', 'fisherman', 'mason', 'cartographer', 'nitwit'];
export const PROFESSION_COLORS = { farmer: '#c8a860', librarian: '#e8e8e8', armorer: '#3a3a3a', weaponsmith: '#4a4a4a', toolsmith: '#5a4030', butcher: '#e8e8e8', cleric: '#6a3a8a', fletcher: '#6a8a3a', leatherworker: '#8a5a2a', shepherd: '#a88a6a', fisherman: '#3a6a8a', mason: '#6a6a5a', cartographer: '#e0d8b0', nitwit: '#3a8a3a' };
mob('villager', { hw: 0.3, h: 1.95, health: 20, speed: 2.1, kind: 'utility', ai: 'villager', egg: ['#563c33', '#bd8b72'], drops: [], xp: [0, 0], sound: 'villager', persistent: true, model: villagerModel('#6a4a3a') });
mob('wandering_trader', { hw: 0.3, h: 1.95, health: 20, speed: 2.3, kind: 'utility', ai: 'villager', egg: ['#456296', '#eaa430'], drops: [], xp: [0, 0], sound: 'villager', model: villagerModel('#2a4a8a', { all: D.band(0.4, 0.5, '#e0a030') }) });
mob('iron_golem', { chase: 3.6,
  hw: 0.7, h: 2.7, health: 100, speed: 1.6, kind: 'utility', ai: 'golem', attack: { dmg: 11, cd: 1.3, fling: 1 }, egg: ['#dbcdc1', '#74a332'], drops: [['iron_ingot', 3, 5], ['poppy', 0, 2]], xp: [0, 0], sound: 'golem', knockbackResist: 1, persistent: true,
  model: () => { const st = S('#d8d0c4', 'noise', { all: D.spots('#8a8a6a', 4, 1) }, 0.07); const vine = S('#d8d0c4', 'noise', { all: D.all(D.spots('#8a8a6a', 3, 1), D.spots('#4a8a2a', 3, 2)) }, 0.07);
    return { anim: 'golem', eye: 38, parts: {
      body: part([0, 16, 0], [box([-9, 12, -6], [18, 12, 11], vine), box([-5, 4, -3], [9, 8, 6], st)]),
      head: part([0, 40, -2], [box([-4, 0, -5.5], [8, 10, 8], S('#d8d0c4', 'noise', face(eyes({ c: '#b82020', pupil: '#5a0a0a', y: 0.35, sep: 0.22 }), D.rect(0.2, 0.25, 0.6, 0.1, '#8a8272')))), box([-1, 1, -7.5], [2, 4, 2], st)]),
      rightArm: part([11, 38, 0], [box([-2, -28, -3], [4, 30, 6], vine)]), leftArm: part([-11, 38, 0], [box([-2, -28, -3], [4, 30, 6], vine)]),
      rightLeg: part([4, 16, 0], [box([-3, -16, -2.5], [6, 16, 5], st)]), leftLeg: part([-4, 16, 0], [box([-3, -16, -2.5], [6, 16, 5], st)]),
    } }; },
});
mob('snow_golem', {
  hw: 0.35, h: 1.9, health: 4, speed: 2, kind: 'utility', ai: 'snowgolem', attack: { ranged: 'snowball', range: 10, cd: 1 }, egg: ['#d9f2f2', '#81a4a4'], drops: [['snowball', 0, 15]], xp: [0, 0], sound: 'golem', meltsInHeat: true,
  model: () => ({ anim: 'snowgolem', eye: 26, parts: {
    body: part([0, 0, 0], [box([-6, 0, -6], [12, 12, 12], S('#f0f8f8', 'noise', null, 0.04)), box([-5, 11, -5], [10, 10, 10], S('#f0f8f8', 'noise', null, 0.04))]),
    head: part([0, 21, 0], [box([-4, 0, -4], [8, 8, 8], S('#d8781a', 'noise', { front: D.all(D.rect(0.15, 0.25, 0.2, 0.2, '#2a1a0a'), D.rect(0.65, 0.25, 0.2, 0.2, '#2a1a0a'), D.rect(0.15, 0.65, 0.7, 0.12, '#2a1a0a')), top: D.rect(0.4, 0.4, 0.2, 0.2, '#4a8a2a') }))]),
    rightArm: part([5, 18, 0], [box([0, -1, -1], [10, 2, 2], S('#6a4a2a'))], { rot: [0, 0, 0.5] }), leftArm: part([-5, 18, 0], [box([-10, -1, -1], [10, 2, 2], S('#6a4a2a'))], { rot: [0, 0, -0.5] }),
  } }),
});

// --- undead ---
const zombieLike = (skin, shirt, pants, eye = '#1a1a1a') => () => {
  const m = humanoid({ head: S(skin, 'noise', face(eyes({ c: eye, pupil: null, y: 0.45, sep: 0.2 }), D.rect(0.3, 0.72, 0.4, 0.1, '#2a3a1a'))), body: S(shirt), arm: S(skin), leg: S(pants) });
  m.anim = 'zombie'; return m;
};
const undead = { kind: 'hostile', ai: 'melee', undead: true, xp: [5, 5] };
mob('zombie', { chase: 4.0, ...undead, armor: 2, hw: 0.3, h: 1.95, health: 20, speed: 2.3, attack: { dmg: 3, cd: 1 }, burns: true, egg: ['#00afaf', '#799c65'], drops: [['rotten_flesh', 0, 2], ['iron_ingot', 0, 1, 0.025], ['carrot', 0, 1, 0.025], ['potato', 0, 1, 0.025]], sound: 'zombie', breaksDoors: true, model: zombieLike(ZOMBIE_SKIN, '#2a8aa8', '#3a3a8a') });
mob('husk', { chase: 4.0, ...undead, armor: 2, hw: 0.3, h: 1.95, health: 20, speed: 2.3, attack: { dmg: 3, cd: 1, hunger: 7 }, egg: ['#797061', '#e6cc94'], drops: [['rotten_flesh', 0, 2]], sound: 'zombie', model: zombieLike(HUSK, '#8a7a5a', '#6a5a3a') });
mob('drowned', { chase: 4.0, ...undead, armor: 2, hw: 0.3, h: 1.95, health: 20, speed: 2.3, swim: true, amphibious: true, attack: { dmg: 3, cd: 1, trident: 0.06 }, burns: true, egg: ['#8ff1d7', '#799c65'], drops: [['rotten_flesh', 0, 2], ['copper_ingot', 0, 1, 0.11]], sound: 'zombie', model: zombieLike(DROWNED, '#3a8a6a', '#2a6a5a', '#9af0e8') });
mob('zombie_villager', { chase: 4.0, ...undead, armor: 2, hw: 0.3, h: 1.95, health: 20, speed: 2.3, attack: { dmg: 3, cd: 1 }, burns: true, egg: ['#563c33', '#799c65'], drops: [['rotten_flesh', 0, 2]], sound: 'zombie', curable: true,
  model: () => { const m = humanoid({ head: S(ZOMBIE_SKIN, 'noise', face(eyes({ c: '#b82020', pupil: '#1a1a1a', y: 0.35 }))), body: S('#6a4a3a'), robe: S('#6a4a3a'), arm: S(ZOMBIE_SKIN), leg: S('#5a4a3a'), nose: S(ZOMBIE_SKIN) }, { headH: 10, bodyD: 6, nose: true, robe: true }); m.anim = 'zombie'; return m; } });
const skeletonModel = (bone, rag, eye = '#1a1a1a') => () => {
  const b = S(bone, 'noise', null, 0.08);
  const m = humanoid({ head: S(bone, 'noise', face(D.rect(0.15, 0.4, 0.25, 0.2, eye), D.rect(0.6, 0.4, 0.25, 0.2, eye), D.rect(0.42, 0.62, 0.16, 0.12, eye), D.rect(0.2, 0.8, 0.6, 0.08, '#6a6a6a')), 0.08), body: rag ? S(rag, 'noise') : S(bone, 'noise', { front: D.stripes('#3a3a3a', 3) }, 0.08), arm: b, leg: b }, { thin: true });
  m.anim = 'skeleton'; return m;
};
mob('skeleton', { chase: 3.9, ...undead, hw: 0.3, h: 1.99, health: 20, speed: 2.4, attack: { ranged: 'arrow', range: 15, cd: 2 }, burns: true, egg: ['#c1c1c1', '#494949'], drops: [['bone', 0, 2], ['arrow', 0, 2]], sound: 'skeleton', holds: 'bow', model: skeletonModel('#c8c8c0') });
mob('stray', { chase: 3.9, ...undead, hw: 0.3, h: 1.99, health: 20, speed: 2.4, attack: { ranged: 'arrow', range: 15, cd: 2, slow: true }, burns: true, egg: ['#617677', '#ddeaea'], drops: [['bone', 0, 2], ['arrow', 0, 2]], sound: 'skeleton', holds: 'bow', model: skeletonModel('#a8b8b8', '#6a8888') });
mob('wither_skeleton', { chase: 4.4, ...undead, hw: 0.35, h: 2.4, scale: 1.2, health: 20, speed: 2.5, attack: { dmg: 8, cd: 1, wither: 10 }, fireImmune: true, egg: ['#141414', '#474d4d'], drops: [['coal', 0, 1], ['bone', 0, 2], ['wither_skeleton_skull', 0, 1, 0.025]], sound: 'skeleton', holds: 'stone_sword', model: skeletonModel('#2a2a2a', null, '#8a8a8a') });
mob('zombified_piglin', { chase: 4.6, ...undead, kind: 'neutral', ai: 'melee', hw: 0.3, h: 1.95, health: 20, speed: 2.3, attack: { dmg: 8, cd: 1 }, fireImmune: true, egg: ['#ea9393', '#4c7129'], drops: [['rotten_flesh', 0, 1], ['gold_nugget', 0, 1], ['gold_ingot', 0, 1, 0.025]], sound: 'zpiglin', holds: 'golden_sword', groupAnger: true,
  model: () => { const m = humanoid({ head: S('#e89a8a', 'noise', face(eyes({ c: '#ffffff', pupil: '#1a1a1a', y: 0.3 }), D.spots('#5a8a3a', 3, 2))), body: S('#8a6a4a', 'noise', { all: D.spots('#5a8a3a', 3, 2) }), arm: S('#e89a8a', 'noise', { all: D.spots('#5a8a3a', 2, 2) }), leg: S('#6a4a3a') }); m.parts.head.boxes[0].s = [10, 8, 8]; m.parts.head.boxes[0].o = [-5, 0, -4]; m.parts.head.boxes.push(box([-2, 0, -5], [4, 4, 1], S('#e8a0a0', 'flat', face(D.rect(0.2, 0.3, 0.2, 0.4, '#8a4a4a'), D.rect(0.6, 0.3, 0.2, 0.4, '#8a4a4a'))))); m.anim = 'zombie'; return m; } });
mob('phantom', {
  hw: 0.45, h: 0.5, health: 20, speed: 7, kind: 'hostile', ai: 'phantom', flying: true, undead: true, burns: true, attack: { dmg: 6, cd: 1.5 }, egg: ['#43518a', '#88ff00'], drops: [['phantom_membrane', 0, 1]], xp: [5, 5], sound: 'phantom',
  model: () => ({ anim: 'phantom', eye: 2, parts: {
    body: part([0, 0, 0], [box([-2.5, 0, -4.5], [5, 3, 9], S('#3a4a7a'))]),
    head: part([0, 1, -4.5], [box([-3.5, -1, -5], [7, 3, 5], S('#3a4a7a', 'noise', face(D.rect(0.1, 0.3, 0.3, 0.3, '#88ff40'), D.rect(0.6, 0.3, 0.3, 0.3, '#88ff40'))))]),
    wingR: part([2.5, 2, 0], [box([0, -0.5, -4.5], [6, 1, 9], S('#4a5a8a')), box([6, -0.5, -4.5], [12, 1, 9], S('#6a7aaa'))]),
    wingL: part([-2.5, 2, 0], [box([-6, -0.5, -4.5], [6, 1, 9], S('#4a5a8a')), box([-18, -0.5, -4.5], [12, 1, 9], S('#6a7aaa'))]),
    tail: part([0, 1, 4.5], [box([-1.5, -1, 0], [3, 2, 6], S('#3a4a7a')), box([-0.5, -0.5, 6], [1, 1, 6], S('#3a4a7a'))]),
  } }),
});

// --- other hostiles ---
mob('creeper', { chase: 4.0,
  hw: 0.3, h: 1.7, health: 20, speed: 2.4, kind: 'hostile', ai: 'creeper', egg: ['#0da70b', '#000000'], drops: [['gunpowder', 0, 2]], xp: [5, 5], sound: 'creeper',
  model: () => { const c = S('#5ec04a', 'noise', null, 0.2);
    return { anim: 'creeper', eye: 22, parts: {
      body: part([0, 6, 0], [box([-4, 0, -2], [8, 12, 4], c)]),
      head: part([0, 18, 0], [box([-4, 0, -4], [8, 8, 8], S('#5ec04a', 'noise', face(D.rect(0.12, 0.25, 0.25, 0.25, '#0a0a0a'), D.rect(0.63, 0.25, 0.25, 0.25, '#0a0a0a'), D.rect(0.37, 0.5, 0.26, 0.2, '#0a0a0a'), D.rect(0.25, 0.62, 0.5, 0.25, '#0a0a0a'), D.rect(0.25, 0.87, 0.12, 0.13, '#0a0a0a'), D.rect(0.63, 0.87, 0.12, 0.13, '#0a0a0a')), 0.2))]),
      leg0: part([2, 6, -4], [box([-2, -6, -2], [4, 6, 4], c)]), leg1: part([-2, 6, -4], [box([-2, -6, -2], [4, 6, 4], c)]),
      leg2: part([2, 6, 4], [box([-2, -6, -2], [4, 6, 4], c)]), leg3: part([-2, 6, 4], [box([-2, -6, -2], [4, 6, 4], c)]),
    } }; },
});
const spiderModel = (col, eyeCol) => () => {
  const st = S(col, 'fur');
  const parts = {
    body: part([0, 9, 0], [box([-3, -3, -3], [6, 6, 6], st), box([-5, -4, 3], [10, 8, 12], S(col, 'fur', { top: D.spots('#5a1a1a', 3, 1) }))]),
    head: part([0, 9, -3], [box([-4, -4, -8], [8, 8, 8], S(col, 'fur', face(D.rect(0.2, 0.3, 0.12, 0.12, eyeCol), D.rect(0.68, 0.3, 0.12, 0.12, eyeCol), D.rect(0.35, 0.45, 0.1, 0.1, eyeCol), D.rect(0.55, 0.45, 0.1, 0.1, eyeCol), D.rect(0.25, 0.55, 0.15, 0.15, eyeCol), D.rect(0.6, 0.55, 0.15, 0.15, eyeCol))))]),
  };
  for (let i = 0; i < 8; i++) { const side = i < 4 ? 1 : -1, row = i % 4; parts[`leg${i}`] = part([side * 3, 9, -2 + row * 1.5], [box(side > 0 ? [0, -1, -1] : [-16, -1, -1], [16, 2, 2], st)], { rot: [0, (row - 1.5) * 0.35 * side, side * 0.6] }); }
  return { anim: 'spider', eye: 9, parts };
};
mob('spider', { chase: 4.8, hw: 0.7, h: 0.9, health: 16, speed: 3, kind: 'hostile', ai: 'melee', climbs: true, neutralInDay: true, attack: { dmg: 2, cd: 1, leap: true }, egg: ['#342d27', '#a80e0e'], drops: [['string', 0, 2], ['spider_eye', 0, 1, 0.33]], xp: [5, 5], sound: 'spider', model: spiderModel('#3a302a', '#e02020') });
mob('cave_spider', { chase: 5, hw: 0.35, h: 0.5, scale: 0.7, health: 12, speed: 3.2, kind: 'hostile', ai: 'melee', climbs: true, attack: { dmg: 2, cd: 1, poison: 7 }, egg: ['#0c424e', '#a80e0e'], drops: [['string', 0, 2], ['spider_eye', 0, 1, 0.33]], xp: [5, 5], sound: 'spider', model: spiderModel('#1a4a5a', '#e02020') });
mob('enderman', { chase: 6.2,
  hw: 0.3, h: 2.9, health: 40, speed: 3, kind: 'neutral', ai: 'enderman', attack: { dmg: 7, cd: 1 }, egg: ['#161616', '#000000'], drops: [['ender_pearl', 0, 1]], xp: [5, 5], sound: 'enderman', hatesWater: true, teleports: true,
  model: () => { const b = S('#161616', 'noise', null, 0.1); const m = humanoid({ head: S('#161616', 'noise', face(D.rect(0.05, 0.55, 0.35, 0.12, '#e070ff'), D.rect(0.6, 0.55, 0.35, 0.12, '#e070ff'), D.rect(0.12, 0.55, 0.12, 0.12, '#ffc8ff'), D.rect(0.72, 0.55, 0.12, 0.12, '#ffc8ff')), 0.1), body: b, arm: b, leg: b }, { thin: true, legH: 28, armH: 28 }); m.anim = 'enderman';
    // Jaw and mouth, hidden inside the head until it opens in anger.
    m.parts.jaw = part([0, 40, 0], [box([-3.9, 0, -3.9], [7.8, 2, 7.8], S('#101010', 'noise', face(D.rect(0.1, 0, 0.8, 0.5, '#e070ff')), 0.1))]);
    m.parts.mouth = part([0, 40, 0], [box([-3.6, 0.2, -3.6], [7.2, 7.4, 7.2], S('#5c1454', 'noise', null, 0.25))]);
    return m; },
});
mob('witch', {
  hw: 0.3, h: 1.95, health: 26, speed: 2.2, kind: 'hostile', ai: 'ranged', attack: { ranged: 'potion', range: 8, cd: 3 }, egg: ['#340000', '#51a03e'], drops: [['glass_bottle', 0, 2], ['glowstone_dust', 0, 2], ['gunpowder', 0, 2], ['redstone', 0, 2], ['spider_eye', 0, 2], ['sugar', 0, 2], ['stick', 0, 2]], xp: [5, 5], sound: 'witch',
  model: () => { const m = villagerModel('#3a2a4a')(); m.parts.head.boxes[0].style = S('#a8c090', 'noise', face(eyes({ c: '#ffffff', pupil: '#5a1a8a', y: 0.35 }))); m.parts.head.boxes.push(box([-5, 10, -5], [10, 2, 10], S('#2a2a2a')), box([-3.5, 12, -3.5], [7, 4, 7], S('#2a2a2a', 'noise', { all: D.band(0.8, 1, '#4a8a2a') })), box([-2, 16, -2], [4, 3, 4], S('#2a2a2a')), box([-1, 19, -1], [2, 2, 2], S('#2a2a2a'))); return m; },
});
const cube = (col, inner, eyeCol, scale = 1) => () => ({ anim: 'slime', eye: 6, parts: { body: part([0, 0, 0], [box([-4, 0, -4], [8, 8, 8], S(col, 'noise', face(D.rect(0.12, 0.25, 0.2, 0.2, eyeCol), D.rect(0.68, 0.25, 0.2, 0.2, eyeCol), D.rect(0.45, 0.65, 0.12, 0.1, eyeCol)))), ...(inner ? [box([-3, 1, -3], [6, 6, 6], S(inner))] : [])], { scale }) } });
mob('slime', { hw: 0.26, h: 0.52, health: 4, speed: 2.5, kind: 'hostile', ai: 'slime', attack: { dmg: 2, cd: 1, touch: true }, egg: ['#51a03e', '#7ebf6e'], drops: [['slime_ball', 0, 2]], xp: [1, 4], sound: 'slime', sizes: true, translucent: true, model: cube('#6ac85a', '#4a9a3a', '#1a4a1a') });
mob('magma_cube', { hw: 0.26, h: 0.52, health: 4, speed: 2.5, kind: 'hostile', ai: 'slime', attack: { dmg: 3, cd: 1, touch: true }, fireImmune: true, egg: ['#340000', '#fcfc00'], drops: [['magma_cream', 0, 1, 0.25]], xp: [1, 4], sound: 'slime', sizes: true, model: () => { const m = cube('#3a1a0a', null, '#ffa020')(); m.parts.body.boxes[0].style = S('#4a1a0a', 'noise', { all: D.stripes('#f08a1a', 3), front: D.all(D.stripes('#f08a1a', 3), D.rect(0.12, 0.25, 0.2, 0.2, '#ffe060'), D.rect(0.68, 0.25, 0.2, 0.2, '#ffe060')) }); return m; } });
const bug = (col, n) => () => { const parts = {}; for (let i = 0; i < n; i++) parts[`s${i}`] = part([0, 0, -4 + i * 3], [box([-2 + (i === 1 ? -1 : 0), 0, 0], [4 + (i === 1 ? 2 : 0), 3 + (i === 1 ? 1 : 0), 3], S(col, 'noise', i === 0 ? face(D.rect(0.2, 0.3, 0.2, 0.3, '#1a1a1a'), D.rect(0.6, 0.3, 0.2, 0.3, '#1a1a1a')) : null))]); return { anim: 'bug', eye: 2, parts }; };
mob('silverfish', { chase: 4.4, hw: 0.2, h: 0.3, health: 8, speed: 3, kind: 'hostile', ai: 'melee', attack: { dmg: 1, cd: 1 }, egg: ['#6e6e6e', '#303030'], drops: [], xp: [5, 5], sound: 'silverfish', model: bug('#8a8a8a', 4) });
mob('endermite', { chase: 4.4, hw: 0.2, h: 0.3, health: 8, speed: 3, kind: 'hostile', ai: 'melee', attack: { dmg: 2, cd: 1 }, egg: ['#161616', '#6e6e6e'], drops: [], xp: [3, 3], sound: 'silverfish', model: bug('#3a2a4a', 4) });
const illager = (robe, eyeCol = '#1a3a1a', armed = true) => () => {
  const m = humanoid({ head: S('#8a9a9a', 'noise', face(eyes({ c: '#ffffff', pupil: eyeCol, y: 0.4 }), D.rect(0.12, 0.3, 0.76, 0.08, '#2a2a2a'))), body: S(robe), robe: S(robe, 'noise', { all: D.band(0.55, 0.6, '#1a1a1a') }), arm: S(robe), leg: S('#2a2a2a'), nose: S('#8a9a9a') }, { headH: 10, bodyD: 6, nose: true, robe: true, crossed: !armed });
  if (armed) m.anim = 'zombie';
  return m;
};
mob('pillager', { chase: 3.9, hw: 0.3, h: 1.95, health: 24, speed: 2.4, kind: 'hostile', ai: 'ranged', raider: true, attack: { ranged: 'arrow', range: 16, cd: 2.5, crossbow: true }, egg: ['#532f36', '#959b9b'], drops: [['arrow', 0, 2], ['crossbow', 0, 1, 0.085]], xp: [5, 5], sound: 'illager', holds: 'crossbow', model: illager('#4a3a3a') });
mob('vindicator', { chase: 4.6, hw: 0.3, h: 1.95, health: 24, speed: 2.5, kind: 'hostile', ai: 'melee', raider: true, attack: { dmg: 13, cd: 1.2 }, egg: ['#959b9b', '#275e61'], drops: [['emerald', 0, 1], ['iron_axe', 0, 1, 0.085]], xp: [5, 5], sound: 'illager', holds: 'iron_axe', model: illager('#2a3a4a') });
mob('evoker', { hw: 0.3, h: 1.95, health: 24, speed: 2.2, kind: 'hostile', ai: 'ranged', raider: true, attack: { ranged: 'fangs', range: 12, cd: 4 }, egg: ['#959b9b', '#1e1c1a'], drops: [['totem_of_undying', 1, 1], ['emerald', 0, 1]], xp: [10, 10], sound: 'illager', model: illager('#1a1a1a', '#1a1a1a', false) });
mob('ravager', {
  hw: 0.98, h: 2.2, health: 100, speed: 2.5, kind: 'hostile', ai: 'melee', raider: true, attack: { dmg: 12, cd: 2, fling: 1 }, egg: ['#757470', '#5b5049'], drops: [['saddle', 1, 1]], xp: [20, 20], sound: 'ravager', breaksLeaves: true, knockbackResist: 0.75,
  model: () => { const m = quadruped({ body: S('#5a5550', 'noise'), head: S('#5a5550', 'noise', face(eyes({ c: '#ffffff', pupil: '#1a1a1a', y: 0.3 }), D.rect(0.2, 0.7, 0.6, 0.2, '#2a2a2a'))), leg: S('#4a4540') }, { legH: 16, legW: 8, bodyW: 14, bodyH: 16, bodyL: 22, headW: 16, headH: 16, headL: 14, neckUp: 4 }); m.parts.head.boxes.push(box([-10, 4, -6], [2, 12, 2], S('#e0dcc8')), box([8, 4, -6], [2, 12, 2], S('#e0dcc8'))); return m; },
});
mob('blaze', {
  hw: 0.3, h: 1.8, health: 20, speed: 2.3, kind: 'hostile', ai: 'blaze', flying: true, fireImmune: true, attack: { ranged: 'small_fireball', range: 16, cd: 3, burst: 3 }, egg: ['#f6b201', '#fff87e'], drops: [['blaze_rod', 0, 1]], xp: [10, 10], sound: 'blaze', glow: true, hurtByWater: true,
  model: () => { const parts = { head: part([0, 20, 0], [box([-4, 0, -4], [8, 8, 8], S('#f8c830', 'noise', face(eyes({ c: '#2a1a0a', pupil: null, y: 0.4 }), D.rect(0.2, 0.75, 0.6, 0.1, '#8a4a0a'))))]) }; for (let i = 0; i < 12; i++) parts[`rod${i}`] = part([0, 0, 0], [box([-1, 0, -1], [2, 8, 2], S('#e8a020', 'gradient'))]); return { anim: 'blaze', eye: 24, parts }; },
});
mob('ghast', {
  hw: 2, h: 4, health: 10, speed: 2.5, kind: 'hostile', ai: 'ghast', flying: true, fireImmune: true, attack: { ranged: 'fireball', range: 48, cd: 3.5 }, egg: ['#f9f9f9', '#bcbcbc'], drops: [['ghast_tear', 0, 1], ['gunpowder', 0, 2]], xp: [5, 5], sound: 'ghast', scale: 4,
  model: () => { const parts = { body: part([0, 4, 0], [box([-8, 0, -8], [16, 16, 16], S('#f0f0f0', 'noise', face(D.rect(0.15, 0.3, 0.2, 0.12, '#3a3a3a'), D.rect(0.65, 0.3, 0.2, 0.12, '#3a3a3a'), D.rect(0.35, 0.6, 0.3, 0.2, '#3a3a3a')), 0.05))]) }; for (let i = 0; i < 9; i++) parts[`t${i}`] = part([-5 + (i % 3) * 5, 4, -5 + Math.floor(i / 3) * 5], [box([-1, -8 - (i * 7) % 5, -1], [2, 8 + (i * 7) % 5, 2], S('#e8e8e8'))]); return { anim: 'ghast', eye: 14, parts }; },
});
const piglinModel = gold => () => { const m = humanoid({ head: S('#e8a090', 'noise', face(eyes({ c: '#ffffff', pupil: '#1a1a1a', y: 0.3 }))), body: S('#8a5a3a', 'noise', { all: D.band(0.8, 1, gold) }), arm: S('#e8a090'), leg: S('#6a4a2a') }); m.parts.head.boxes[0].s = [10, 8, 8]; m.parts.head.boxes[0].o = [-5, 0, -4]; m.parts.head.boxes.push(box([-2, 0, -5], [4, 4, 1], S('#e8a0a0', 'flat', face(D.rect(0.2, 0.3, 0.2, 0.4, '#8a4a4a'), D.rect(0.6, 0.3, 0.2, 0.4, '#8a4a4a')))), box([-6, 4, -1], [1, 5, 4], S('#e89080')), box([5, 4, -1], [1, 5, 4], S('#e89080'))); m.anim = 'zombie'; return m; };
mob('piglin', { chase: 4.5, hw: 0.3, h: 1.95, health: 16, speed: 2.5, kind: 'hostile', ai: 'melee', attack: { dmg: 5, cd: 1 }, goldCalm: true, barters: true, egg: ['#995f40', '#f9f3a4'], drops: [['gold_ingot', 0, 1, 0.08]], xp: [5, 5], sound: 'piglin', holds: 'golden_sword', model: piglinModel('#e0b020') });
mob('hoglin', { chase: 4.6,
  hw: 0.7, h: 1.4, health: 40, speed: 2.5, kind: 'hostile', ai: 'melee', attack: { dmg: 6, cd: 1.2, fling: 0.6 }, egg: ['#c66e55', '#5f6464'], drops: [['porkchop', 2, 4], ['leather', 0, 1]], cooked: { porkchop: 'cooked_porkchop' }, xp: [5, 5], sound: 'hoglin',
  model: () => { const m = quadruped({ body: S('#c67a5a', 'fur', { top: D.stripes('#e8c8a0', 2, true) }), head: S('#c67a5a', 'fur', face(eyes({ c: '#1a1a1a', pupil: null, y: 0.3 }))), leg: S('#a86a4a') }, { legH: 11, legW: 6, bodyW: 16, bodyH: 14, bodyL: 19, headW: 14, headH: 6, headL: 19 }); m.parts.head.boxes.push(box([-8, -1, -18], [2, 6, 2], S('#f0e8d0')), box([6, -1, -18], [2, 6, 2], S('#f0e8d0'))); return m; },
});

// --- the wither ---
mob('wither', {
  hw: 0.45, h: 3.2, scale: 1.35, health: 300, speed: 5, kind: 'boss', ai: 'wither', flying: true, fireImmune: true, undead: true, knockbackResist: 1,
  attack: { dmg: 8, cd: 1, wither: 10 }, egg: ['#141414', '#4a4a4a'], drops: [['nether_star', 1, 1]], xp: [50, 50], sound: 'wither', noEgg: true, bossColor: '#b44cf0',
  model: () => {
    const bone = S('#2b2b2b', 'noise', null, 0.14);
    const eyes2 = f => S('#262626', 'noise', face(eyes({ c: '#f0f0f0', pupil: null, y: 0.45, sep: 0.22 }), D.rect(0.3, 0.72, 0.4, 0.1, '#0a0a0a')), 0.12);
    const parts = {
      spine: part([0, 8, 0], [box([-1.5, 0, -1.5], [3, 16, 3], bone)]),
      ribs: part([0, 13, 0], [box([-4.5, 0, -2], [9, 1.5, 4], bone), box([-4.5, 3, -2], [9, 1.5, 4], bone), box([-4.5, 6, -2], [9, 1.5, 4], bone)]),
      tail: part([0, 8, 0], [box([-1.5, -9, -1.5], [3, 9, 3], bone)]),
      shoulders: part([0, 24, 0], [box([-10, 0, -1.5], [20, 3, 3], bone)]),
      head: part([0, 27, 0], [box([-4, 0, -4], [8, 8, 8], eyes2())]),
      headL: part([-9, 26, 0], [box([-3, 0, -3], [6, 6, 6], eyes2())]),
      headR: part([9, 26, 0], [box([-3, 0, -3], [6, 6, 6], eyes2())]),
    };
    return { anim: 'wither', parts, eye: 31 };
  },
});

// --- the dragon ---
mob('ender_dragon', {
  hw: 4, h: 4, health: 200, speed: 12, kind: 'boss', ai: 'dragon', flying: true, fireImmune: true, attack: { dmg: 10, cd: 1 }, egg: ['#1a1a1a', '#e070ff'], drops: [], xp: [12000, 12000], sound: 'dragon', knockbackResist: 1, noEgg: true,
  model: () => {
    const sc = S('#1f1a24', 'scales', null, 0.15), belly = S('#2a2430', 'noise');
    const parts = {
      body: part([0, 20, 0], [box([-12, 0, -32], [24, 24, 64], sc), box([-1, 24, -26], [2, 6, 12], S('#3a3040')), box([-1, 24, -6], [2, 6, 12], S('#3a3040')), box([-1, 24, 14], [2, 6, 12], S('#3a3040'))]),
      head: part([0, 30, -80], [box([-8, -4, -16], [16, 16, 16], S('#1f1a24', 'scales', face(D.rect(0.1, 0.25, 0.3, 0.15, '#e070ff'), D.rect(0.6, 0.25, 0.3, 0.15, '#e070ff')))), box([-6, -4, -32], [12, 5, 16], sc), box([-5, 12, -10], [2, 4, 6], S('#3a3040')), box([3, 12, -10], [2, 4, 6], S('#3a3040'))]),
      jaw: part([0, 26, -96], [box([-6, -4, -16], [12, 4, 16], belly)], { parent: null }),
      wingR: part([12, 38, -20], [box([0, -4, -4], [56, 8, 8], sc), box([0, 0, 4], [56, 0.5, 56], S('#2a2436', 'noise', null, 0.1))]),
      wingL: part([-12, 38, -20], [box([-56, -4, -4], [56, 8, 8], sc), box([-56, 0, 4], [56, 0.5, 56], S('#2a2436', 'noise', null, 0.1))]),
      leg0: part([10, 24, -24], [box([-4, -24, -4], [8, 24, 8], sc)]), leg1: part([-10, 24, -24], [box([-4, -24, -4], [8, 24, 8], sc)]),
      leg2: part([12, 24, 20], [box([-5, -26, -5], [10, 26, 10], sc)]), leg3: part([-12, 24, 20], [box([-5, -26, -5], [10, 26, 10], sc)]),
    };
    for (let i = 0; i < 5; i++) parts[`neck${i}`] = part([0, 30, -32 - i * 10], [box([-5, -5, -10], [10, 10, 10], sc)]);
    for (let i = 0; i < 12; i++) parts[`tail${i}`] = part([0, 30, 32 + i * 10], [box([-5, -5, 0], [10, 10, 10], sc)]);
    delete parts.jaw;
    return { anim: 'dragon', eye: 36, parts };
  },
});

MOBS.villager.professionModel = prof => villagerModel(PROFESSION_COLORS[prof] || '#6a4a3a', prof === 'librarian' ? { all: D.band(0.1, 0.25, '#8a3a2a') } : prof === 'cleric' ? { all: D.band(0.3, 0.4, '#e0c040') } : prof === 'farmer' ? { all: D.band(0.0, 0.15, '#e8d890') } : null)();

// The player's own model (first-person arm and third-person view).
export function playerModel() {
  const skin = '#c8926a';
  const m = humanoid({
    head: S(skin, 'noise', { front: D.all(D.band(0, 0.25, '#3a2412'), eyes({ c: '#ffffff', pupil: '#3a4ab8', y: 0.45, sep: 0.2 }), D.rect(0.35, 0.72, 0.3, 0.1, '#8a4a3a')), top: D.rect(0, 0, 1, 1, '#3a2412'), right: D.band(0, 0.35, '#3a2412'), left: D.band(0, 0.35, '#3a2412'), back: D.band(0, 0.7, '#3a2412') }, 0.06),
    body: S('#2aa8a8', 'noise', null, 0.07), arm: S(skin, 'noise', { all: D.band(0, 0.3, '#2aa8a8') }, 0.06), leg: S('#3a3aa8', 'noise', { all: D.band(0.85, 1, '#5a5a5a') }, 0.07),
  });
  return m;
}

// Saddle drawn on top of a saddled horse or donkey (shares the body pivot).
export function saddleModel() {
  const leather = S('#6a3e1e', 'noise', { all: D.frame('#4a2a12') }, 0.08), iron = S('#b8b8b8', 'flat');
  return { anim: 'quadruped', eye: 0, parts: { body: part([0, 11, 0], [
    box([-5, 10, -6], [10, 1, 9], leather, { inflate: 0.3 }),   // seat
    box([-2, 11, -6], [4, 2, 2], leather),                      // pommel
    box([-5.4, 1, -3], [0.6, 9, 2], leather), box([4.8, 1, -3], [0.6, 9, 2], leather), // girth strap
    box([-6, -1, -2.5], [1, 2, 1], iron), box([5, -1, -2.5], [1, 2, 1], iron),          // stirrups
  ]) } };
}

// Which mobs get spawn eggs.
export const EGG_MOBS = Object.values(MOBS).filter(m => !m.noEgg);

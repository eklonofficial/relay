// Mob roster: stats, AI archetype, drops, box models and procedural skins.
// Model space: 1 unit = 1/16 block, feet at y=0, the mob faces -Z.
import { D, pal, shade as shadeHex } from '../render/mobtex.js?v=muprr3ie';

const box = (o, s, style, extra = {}) => ({ o, s, style, ...extra });
const part = (pivot, boxes, extra = {}) => ({ pivot, boxes, ...extra });
const S = (base, pattern = 'noise', decor = null, spread = 0.12) => ({ pal: pal(base, spread), pattern, decor });

// ---------------- face decorations ----------------
const face = (...fns) => ({ front: D.all(...fns) });
const eyes = (o = {}) => D.eyes(o);
const K = '#141414';   // near-black for pupils, nostrils and eye sockets

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

const PIG = '#f0a0a0', COW = '#4a3222', SHEEP = '#eeeeec', ZOMBIE_SKIN = '#5e8f4a', HUSK = '#b8a06a', DROWNED = '#4f9a92';

// ---------------- mob definitions ----------------
export const MOBS = {};
function mob(key, def) { MOBS[key] = { key, name: def.name || key.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' '), ...def }; }

// --- passive animals ---
mob('pig', {
  hw: 0.45, h: 0.9, health: 10, speed: 2.5, kind: 'passive', ai: 'animal', food: ['carrot', 'potato', 'beetroot'], egg: ['#f0a0a0', '#d06a6a'],
  drops: [['porkchop', 1, 3]], cooked: { porkchop: 'cooked_porkchop' }, xp: [1, 3], sound: 'pig',
  model: () => { const m = quadruped({ body: S(PIG, 'noise', { all: D.blotch('#e69a98', 0.1), bottom: D.blotch('#d88684', 0.3) }, 0.08), head: S(PIG, 'noise', face(D.brow('#e39290', 0.375, 0), eyes({ c: '#ffffff', pupil: K, y: 0.5, gap: 2 }), D.bar('#d98583', 0.875, 0.5)), 0.08), leg: S(PIG, 'noise', { all: D.band(0.8, 1, '#d68a88') }, 0.08) }, { legH: 6, bodyW: 10, bodyH: 8, bodyL: 16, headW: 8, headH: 8, headL: 8 }); m.parts.head.boxes.push(box([-2, -3, -9], [4, 3, 1], S('#f4b0ae', 'flat', { front: D.snout('#9a4e56') }))); return m; },
});
mob('cow', {
  hw: 0.45, h: 1.4, health: 10, speed: 2.2, kind: 'passive', ai: 'animal', food: ['wheat'], egg: ['#4a3222', '#a8a8a8'],
  drops: [['beef', 1, 3], ['leather', 0, 2]], cooked: { beef: 'cooked_beef' }, xp: [1, 3], sound: 'cow', milk: true,
  model: () => { const white = '#e6e2da', body = S(COW, 'fur', { all: D.patches(white, 2, 3.2, '#c9c3b8'), bottom: D.patches(white, 2, 3) }); const m = quadruped({ body, head: S(COW, 'fur', { ...face(D.rect(0.375, 0, 0.25, 0.5, white), D.brow('#2e2016', 0.25, 1), eyes({ c: '#ffffff', pupil: K, y: 0.375, gap: 2 }), D.muzzle('#b8a292', { y: 0.625, inset: 2, nostril: '#4a3228', gap: 2 })), sides: D.sideFront('#b8a292', 1, 0.625) }), leg: S(COW, 'fur', { all: D.all(D.patches(white, 1, 2), D.band(0.85, 1, '#2a1c12')) }) }, { legH: 12, bodyW: 12, bodyH: 10, bodyL: 18, headW: 8, headH: 8, headL: 6 }); const horn = S('#d9d3c3', 'noise', { top: D.frame('#b3aa96'), all: D.band(0, 0.34, '#bdb4a2') }, 0.06); m.parts.head.boxes.push(box([-5, 2, -5], [1, 3, 1], horn), box([4, 2, -5], [1, 3, 1], horn)); return m; },
});
mob('mooshroom', {
  hw: 0.45, h: 1.4, health: 10, speed: 2.2, kind: 'passive', ai: 'animal', food: ['wheat'], egg: ['#a01818', '#b8b8b8'],
  drops: [['beef', 1, 3], ['leather', 0, 2]], cooked: { beef: 'cooked_beef' }, xp: [1, 3], sound: 'cow', milk: true, stew: true,
  model: () => { const red = '#a8201c', white = '#d9d4cc'; const m = quadruped({ body: S(red, 'fur', { all: D.patches(white, 2, 3, '#b8b2a8') }), head: S(red, 'fur', { ...face(D.brow('#7a1612', 0.25, 1), eyes({ c: '#ffffff', pupil: K, y: 0.375, gap: 2 }), D.muzzle('#c4b4ae', { y: 0.625, inset: 2, nostril: '#5a3a36', gap: 2 })), sides: D.sideFront('#c4b4ae', 1, 0.625) }), leg: S(white, 'fur', { all: D.all(D.ragged(0, 0.35, red), D.band(0.85, 1, '#6a625a')) }, 0.08) }, { legH: 12, bodyW: 12, bodyH: 10, bodyL: 18, headW: 8, headH: 8, headL: 6 }); const shroom = S('#d8241c', 'noise', { caps: D.spots('#f4ecea', 3, 1), sides: D.all(D.ragged(0.5, 1, '#e0d6c4'), D.spots('#f4ecea', 1, 1)), front: D.all(D.ragged(0.5, 1, '#e0d6c4'), D.spots('#f4ecea', 1, 1)) }); m.parts.body.boxes.push(box([-2, 10, -3], [4, 4, 4], shroom), box([-3, 10, 4], [4, 4, 4], shroom)); return m; },
});
mob('sheep', {
  hw: 0.45, h: 1.3, health: 8, speed: 2.3, kind: 'passive', ai: 'animal', food: ['wheat'], egg: ['#e8e8e8', '#ffb5b5'],
  drops: [['mutton', 1, 2]], woolDrop: true, cooked: { mutton: 'cooked_mutton' }, xp: [1, 3], sound: 'sheep', shearable: true,
  model: () => { const skin = '#d9c9b8'; const m = quadruped({ body: S(skin, 'noise', null, 0.07), head: S(skin, 'noise', face(D.ragged(0, 0.2, '#ecebe6'), eyes({ c: '#ffffff', pupil: K, y: 0.4, gap: 2 }), D.bar('#e8a0a0', 0.66, 2), D.bar('#b88878', 0.84, 2)), 0.07), leg: S(skin, 'noise', { all: D.band(0.84, 1, '#a89684') }, 0.07) }, { legH: 12, bodyW: 8, bodyH: 6, bodyL: 16, headW: 6, headH: 6, headL: 8 }); m.parts.body.boxes.push(box([-4, 0, -8], [8, 6, 16], S(SHEEP, 'wool', null, 0.05), { inflate: 1.75, wool: true })); m.parts.head.boxes.push(box([-3, -3, -7], [6, 6, 6], S(SHEEP, 'wool', null, 0.05), { inflate: 0.6, wool: true })); return m; },
});
mob('chicken', {
  hw: 0.2, h: 0.7, health: 4, speed: 2.4, kind: 'passive', ai: 'animal', food: ['wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds'], egg: ['#f0f0f0', '#e02020'],
  drops: [['chicken', 1, 1], ['feather', 0, 2]], cooked: { chicken: 'cooked_chicken' }, xp: [1, 3], sound: 'chicken', layEggs: true, slowFall: true,
  model: () => ({
    anim: 'chicken', eye: 13, parts: {
      body: part([0, 8, 0], [box([-3, -3, -4], [6, 6, 8], S('#f2f0ec', 'feathers', null, 0.06))]),
      head: part([0, 10, -4], [box([-2, 0, -3], [4, 6, 3], S('#f6f4f0', 'noise', { ...face(eyes({ c: K, pupil: null, y: 0.34, gap: 2, ew: 1 })), sides: D.sideEye({ c: K, y: 0.34, from: 0 }) }, 0.05)), box([-2, 2, -5], [4, 2, 2], S('#f0a818', 'noise', { front: D.band(0.5, 1, '#c87c10'), sides: D.band(0.5, 1, '#c87c10') }, 0.08)), box([-1, 0, -4], [2, 2, 2], S('#d42424', 'noise', null, 0.1))]),
      wingR: part([3, 10, 0], [box([0, -4, -3], [1, 4, 6], S('#e8e6e0', 'feathers', { sides: D.band(0.75, 1, '#d6d2ca') }, 0.06))]), wingL: part([-3, 10, 0], [box([-1, -4, -3], [1, 4, 6], S('#e8e6e0', 'feathers', { sides: D.band(0.75, 1, '#d6d2ca') }, 0.06))]),
      leg0: part([1.5, 5, 1], [box([-0.5, -5, -0.5], [1, 5, 1], S('#f0a020', 'flat')), box([-1.5, -5, -2], [3, 0.01, 3], S('#e09018', 'flat'))]),
      leg1: part([-1.5, 5, 1], [box([-0.5, -5, -0.5], [1, 5, 1], S('#f0a020', 'flat')), box([-1.5, -5, -2], [3, 0.01, 3], S('#e09018', 'flat'))]),
    },
  }),
});
mob('rabbit', {
  hw: 0.2, h: 0.5, health: 3, speed: 3.5, kind: 'passive', ai: 'animal', hop: true, food: ['carrot', 'golden_carrot', 'dandelion'], egg: ['#9a7a5a', '#6a5238'],
  drops: [['rabbit', 0, 1], ['rabbit_hide', 0, 1], ['rabbit_foot', 0, 1, 0.1]], cooked: { rabbit: 'cooked_rabbit' }, xp: [1, 3], sound: 'rabbit',
  model: () => ({
    anim: 'quadruped', eye: 7, parts: {
      body: part([0, 2, 1], [box([-2.5, 0, -3], [5, 5, 7], S('#94704e', 'fur', { bottom: D.blotch('#c8b090', 0.6) }))]),
      head: part([0, 5, -2], [box([-2.5, 0, -4], [5, 4, 5], S('#94704e', 'fur', { ...face(eyes({ c: K, pupil: null, y: 0.25, gap: 3, ew: 1 }), D.bar('#e49a9a', 0.5, 1), D.bar('#d8c4a8', 0.75, 3)), sides: D.sideEye({ c: K, y: 0.25, from: 0 }) })), box([-2, 4, -1], [1, 5, 2], S('#86644a', 'fur', { front: D.ragged(0.2, 0.9, '#d89a92') })), box([1, 4, -1], [1, 5, 2], S('#86644a', 'fur', { front: D.ragged(0.2, 0.9, '#d89a92') }))]),
      leg0: part([1.5, 2, -1], [box([-0.5, -2, -0.5], [1, 2, 1], S('#86644a', 'fur'))]), leg1: part([-1.5, 2, -1], [box([-0.5, -2, -0.5], [1, 2, 1], S('#86644a', 'fur'))]),
      leg2: part([2, 2, 3], [box([-1, -2, -2], [2, 2, 4], S('#86644a', 'fur', { bottom: D.band(0, 1, '#c8b090') }))]), leg3: part([-2, 2, 3], [box([-1, -2, -2], [2, 2, 4], S('#86644a', 'fur', { bottom: D.band(0, 1, '#c8b090') }))]),
      tail: part([0, 4, 4], [box([-1, 0, 0], [2, 2, 2], S('#eeeae4', 'wool', null, 0.06))]),
    },
  }),
});
// Horse family, after the original's geometry (y-up, facing -Z): body 10x10x22 on 11-px legs,
// neck and head tilted forward 30 degrees with a muzzle, ears and a mane, and a hanging tail.
const horse = (col, mane, spots, donkey = false) => () => {
  // Horse: white blaze and socks (`spots`); donkey: pale muzzle and belly.
  const pale = spots || shadeHex(col, 1.35), hoof = shadeHex(mane, 0.8);
  const hide = S(col, 'fur', donkey ? { bottom: D.blotch(pale, 0.6) } : null), dark = S(mane, 'fur', null, 0.14);
  const ear = donkey ? [2, 6, 1] : [2, 3, 1];
  const leg = (x, z, m) => part([x, 11, z], [box([-2, -11, -2], [4, 11, 4], S(col, 'fur', { all: spots ? D.all(D.ragged(0.62, 0.9, spots), D.band(0.9, 1, hoof)) : D.band(0.88, 1, hoof) }), { mirror: m })]);
  return {
    anim: 'quadruped', eye: 30,
    parts: {
      body: part([0, 11, 0], [box([-5, 0, -12], [10, 10, 22], hide)]),
      head: part([0, 20, -11], [
        box([-2, -6, -2], [4, 12, 7], hide),                                            // neck
        box([-3, 6, -2], [6, 5, 7], S(col, 'fur', { front: spots ? D.bar(spots, 0, 2, 99) : null, sides: D.sideEye({ c: K, pupil: '#f0ece4', y: 0.3, from: 1, ew: 2 }) })), // skull
        box([-2, 6, -7], [4, 5, 5], S(donkey ? pale : shadeHex(col, 0.9), 'fur', { front: D.all(spots ? D.bar(spots, 0, 2, 3) : null, D.snout(K), D.band(0.8, 1, shadeHex(col, 0.6))), top: spots ? D.bar(spots, 0, 2, 99) : null, sides: D.band(0.8, 1, shadeHex(col, 0.6)) })), // muzzle
        box([0.5, 10, 3.5], ear, S(col, 'fur', { front: D.ragged(0.3, 1, shadeHex(col, 0.7)) })), box([-2.5, 10, 3.5], ear, S(col, 'fur', { front: D.ragged(0.3, 1, shadeHex(col, 0.7)) })), // ears
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
  model: () => { const cream = '#e0d4b8'; const m = quadruped({ body: S(cream, 'wool', null, 0.07), head: S(cream, 'wool', face(eyes({ c: '#f4f0e8', pupil: K, y: 1, gap: 4, eh: 2 })), 0.07), leg: S(cream, 'wool', { all: D.band(0.86, 1, '#8a7a60') }, 0.07) }, { legH: 14, legW: 4, bodyW: 12, bodyH: 10, bodyL: 18, headW: 8, headH: 18, headL: 6, neckUp: 8 }); m.parts.head.boxes.push(box([-2, 7, -8], [4, 4, 4], S('#cdbf9f', 'noise', { front: D.all(D.snout('#5a4a38'), D.bar('#6a5a44', 0.75, 2)) }, 0.07)), box([-4, 9, -2], [2, 3, 1], S(cream, 'wool', { front: D.ragged(0.3, 1, '#b8a888') }, 0.07)), box([2, 9, -2], [2, 3, 1], S(cream, 'wool', { front: D.ragged(0.3, 1, '#b8a888') }, 0.07))); m.eye = 30; return m; },
});
mob('camel', {
  hw: 0.85, h: 2.3, health: 32, speed: 2.8, kind: 'passive', ai: 'animal', food: ['cactus'], egg: ['#c8a060', '#8a6a3a'], drops: [], xp: [1, 3], sound: 'horse',
  model: () => { const sand = '#d6ad6c', hump = '#b88a4c'; const m = quadruped({ body: S(sand, 'fur', { top: D.blotch(hump, 0.4) }), head: S(sand, 'fur', { front: D.all(D.snout('#5a4028'), D.bar('#8a6440', 0.84, 0.6)), sides: D.sideEye({ c: K, pupil: '#f4ead8', y: 0.2, from: 3, ew: 2 }), top: D.blotch(hump, 0.3) }), leg: S('#c8a060', 'fur', { all: D.all(D.band(0.42, 0.55, '#a88048'), D.band(0.9, 1, '#6a5030')) }) }, { legH: 20, legW: 4, bodyW: 14, bodyH: 12, bodyL: 26, headW: 7, headH: 7, headL: 14, neckUp: 12 }); m.parts.body.boxes.push(box([-4, 12, -4], [8, 5, 8], S(hump, 'fur', { caps: D.blotch('#9a7040', 0.4) }))); m.parts.neck = part([0, 28, -12], [box([-2.5, 0, -3], [5, 13, 6], S(sand, 'fur', { back: D.ragged(0, 1, hump), top: D.blotch(hump, 0.5) }))]); m.parts.head.pivot = [0, 40, -12]; m.eye = 40; return m; },
});
// Wolf (and the fox/ocelot variants built on it): grey saddle over a pale coat, dark nose on a lighter muzzle.
const wolfModel = (col, tame) => () => {
  const back = shadeHex(col, 0.72), pale = shadeHex(col, 1.08), fur = (d = null) => S(col, 'fur', d);
  return {
    anim: 'quadruped', eye: 12, parts: {
      body: part([0, 8, 0], [box([-3, 0, -5], [6, 6, 10], fur({ top: D.blotch(back, 0.7), sides: D.ragged(0, 0.3, back) })), box([-4, 1, -7], [8, 7, 5], fur({ top: D.blotch(back, 0.5), sides: D.ragged(0, 0.25, back), front: D.ragged(0.55, 1, pale) }))]),
      head: part([0, 12, -7], [box([-3, -3, -4], [6, 6, 4], fur({ front: D.all(D.brow(back, 0.34, 1), eyes({ c: tame ? '#2a1a10' : K, pupil: null, y: 0.5, gap: 2, ew: 1 }), D.ragged(0.84, 1, pale)), top: D.blotch(back, 0.5) })), box([-1.5, -3, -7], [3, 3, 3], S(pale, 'fur', { front: D.all(D.bar(K, 0, 99), D.bar('#5a4a44', 0.67, 1)), top: D.band(0, 0.34, K) })), box([-3, 3, -2], [2, 2, 1], fur({ front: D.band(0.5, 1, shadeHex(col, 0.55)) })), box([1, 3, -2], [2, 2, 1], fur({ front: D.band(0.5, 1, shadeHex(col, 0.55)) }))]),
      leg0: part([1.5, 8, -4], [box([-1, -8, -1], [2, 8, 2], fur())]), leg1: part([-1.5, 8, -4], [box([-1, -8, -1], [2, 8, 2], fur())]),
      leg2: part([1.5, 8, 4], [box([-1, -8, -1], [2, 8, 2], fur())]), leg3: part([-1.5, 8, 4], [box([-1, -8, -1], [2, 8, 2], fur())]),
      tail: part([0, 12, 5], [box([-1, -8, 0], [2, 8, 2], fur({ all: D.band(0.75, 1, back) }))], { rot: [0.6, 0, 0] }),
    },
  };
};
mob('wolf', { chase: 5.4, hw: 0.3, h: 0.85, health: 8, speed: 3.4, kind: 'neutral', ai: 'wolf', attack: { dmg: 4, cd: 1 }, food: ['beef', 'cooked_beef', 'porkchop', 'cooked_porkchop', 'chicken', 'mutton', 'rotten_flesh'], tameItem: 'bone', egg: ['#d8d8d8', '#c8b8a0'], drops: [], xp: [1, 3], sound: 'wolf', model: wolfModel('#d8d4cc') });
mob('fox', {
  hw: 0.3, h: 0.7, health: 10, speed: 3.6, kind: 'passive', ai: 'animal', food: ['sweet_berries', 'glow_berries'], egg: ['#d87a2a', '#f0e0c8'], drops: [], xp: [1, 3], sound: 'fox', nocturnalHunter: true,
  model: () => { const org = '#d8762a', white = '#f2ebe2', m = wolfModel(org)(); m.parts.body.boxes.forEach(b => { b.style = S(org, 'fur', { bottom: D.blotch(white, 0.7), front: D.ragged(0.5, 1, white) }); }); m.parts.head.boxes[0].style = S(org, 'fur', { front: D.all(D.ragged(0.55, 1, white), D.eyes({ c: '#f0e0c0', pupil: K, y: 0.5, gap: 2, ew: 1 }), D.brow('#b85e1e', 0.34, 1)), sides: D.ragged(0.6, 1, white) }); m.parts.head.boxes[1].style = S(white, 'fur', { front: D.bar(K, 0, 1), top: D.band(0, 0.34, K) }); m.parts.tail.boxes = [box([-2, -9, 0], [4, 9, 4], S(org, 'fur', { all: D.ragged(0.72, 1, white) }))]; m.parts.head.boxes[2].style = m.parts.head.boxes[3].style = S(org, 'fur', { front: D.band(0, 0.5, '#2a1a10'), back: D.band(0, 0.5, '#2a1a10') }); for (const l of ['leg0', 'leg1', 'leg2', 'leg3']) m.parts[l].boxes[0].style = S('#3a2618', 'fur', { all: D.band(0, 0.25, org) }); return m; },
});
mob('ocelot', {
  hw: 0.3, h: 0.7, health: 10, speed: 4, kind: 'passive', ai: 'animal', food: ['cod', 'salmon'], egg: ['#e8c850', '#5a4a2a'], drops: [], xp: [1, 3], sound: 'cat', shy: true,
  model: () => { const gold = '#e2c064', spot = '#6a4a1e', m = wolfModel(gold)(); m.parts.body.boxes = [box([-2, 0, -8], [4, 5, 14], S(gold, 'fur', { all: D.patches(spot, 7, 0.9), bottom: D.blotch('#f0e0b0', 0.7) }))]; m.parts.tail.boxes = [box([-0.5, -10, 0], [1, 10, 1], S(gold, 'fur', { all: D.stripes(spot, 3) }))]; m.parts.head.boxes[0].style = S(gold, 'fur', { front: D.all(D.eyes({ c: '#5ac838', pupil: K, y: 0.5, gap: 2 }), D.patches(spot, 1, 0.8)), top: D.stripes(spot, 2, true) }); m.parts.head.boxes[1].style = S('#f0e2b4', 'fur', { front: D.bar('#e08a8a', 0, 1) }); for (const l of ['leg0', 'leg1', 'leg2', 'leg3']) m.parts[l].boxes[0].style = S(gold, 'fur', { all: D.patches(spot, 1, 0.8) }); return m; },
});
mob('panda', {
  hw: 0.65, h: 1.25, health: 20, speed: 1.6, kind: 'neutral', ai: 'animal', food: ['bamboo'], egg: ['#f0f0f0', '#1a1a1a'], drops: [['bamboo', 0, 2]], xp: [1, 3], sound: 'panda', attack: { dmg: 6, cd: 1 },
  model: () => { const blk = '#262424'; const m = quadruped({ body: S('#eeece6', 'fur', { sides: D.ragged(0, 0.4, blk), front: D.ragged(0, 0.4, blk), back: D.ragged(0, 0.4, blk), top: D.band(0, 0.4, blk) }, 0.05), head: S('#eeece6', 'fur', face(D.art([
    '.............',
    '.............',
    '..kk.....kk..',
    '.kkkk...kkkk.',
    '.kwkk...kkwk.',
    '..kkk...kkk..',
    '.............',
    '.....kkk.....',
    '......k......',
    '.............'], { k: blk, w: '#f4f4f0' })), 0.05), leg: S(blk, 'fur', null, 0.1) }, { legH: 9, legW: 6, bodyW: 13, bodyH: 10, bodyL: 18, headW: 13, headH: 10, headL: 9 }); m.parts.head.boxes.push(box([-6, 4, -2], [3, 3, 1], S(blk, 'fur', null, 0.1)), box([3, 4, -2], [3, 3, 1], S(blk, 'fur', null, 0.1))); return m; },
});
mob('polar_bear', { chase: 4.6,
  hw: 0.7, h: 1.4, health: 30, speed: 2.5, kind: 'neutral', ai: 'neutral', attack: { dmg: 6, cd: 1 }, egg: ['#f0f0f0', '#9a9a9a'], drops: [['cod', 0, 2], ['salmon', 0, 1]], xp: [1, 3], sound: 'bear',
  model: () => { const m = quadruped({ body: S('#f2f0ea', 'fur', { bottom: D.blotch('#d8d4c8', 0.5) }, 0.05), head: S('#f2f0ea', 'fur', face(eyes({ c: K, pupil: null, y: 0.45, gap: 3, ew: 1 })), 0.05), leg: S('#ebe8e0', 'fur', { all: D.band(0.9, 1, '#c8c2b4') }, 0.05) }, { legH: 10, legW: 6, bodyW: 14, bodyH: 12, bodyL: 22, headW: 7, headH: 7, headL: 7 }); m.parts.head.boxes.push(box([-2, -3.5, -10], [4, 3, 3], S('#e6e2d8', 'fur', { front: D.all(D.bar(K, 0, 2), D.bar('#8a8680', 0.67, 2)), top: D.bar(K, 0.67, 2) }, 0.05))); return m; },
});
mob('goat', {
  hw: 0.45, h: 1.3, health: 10, speed: 2.8, kind: 'passive', ai: 'animal', food: ['wheat'], egg: ['#c8c0b0', '#6a5a4a'], drops: [], xp: [1, 3], sound: 'goat', milk: true, rams: true,
  model: () => { const coat = '#e6ded0'; const m = quadruped({ body: S(coat, 'fur', { bottom: D.blotch('#c8bca8', 0.5) }, 0.07), head: S(coat, 'fur', { front: D.all(D.snout('#6a5a50'), D.bar('#c8b8a8', 0.84, 3)), sides: D.sideEye({ c: '#d8b040', pupil: K, y: 0.3, from: 2, ew: 2 }) }, 0.07), leg: S('#d0c6b4', 'fur', { all: D.band(0.84, 1, '#5a5048') }, 0.07) }, { legH: 10, legW: 3, bodyW: 9, bodyH: 9, bodyL: 16, headW: 5, headH: 6, headL: 7, neckUp: 1 }); const horn = S('#a89e8c', 'noise', { all: D.stripes('#8a8272', 2) }, 0.08); m.parts.head.boxes.push(box([-2.5, 3, -3], [1, 5, 1], horn), box([1.5, 3, -3], [1, 5, 1], horn), box([-1, -6, -8], [2, 3, 2], S('#ece6da', 'fur', null, 0.06))); return m; },
});
mob('frog', {
  hw: 0.25, h: 0.5, health: 10, speed: 2, kind: 'passive', ai: 'animal', hop: true, amphibious: true, food: ['slime_ball'], egg: ['#d0843a', '#e8c090'], drops: [], xp: [1, 3], sound: 'frog',
  model: () => ({
    anim: 'quadruped', eye: 6, parts: {
      body: part([0, 2, 0], [box([-3.5, 0, -4.5], [7, 3, 9], S('#c8783a', 'noise', { top: D.patches('#8a4a22', 3, 1), sides: D.ragged(0.6, 1, '#ecc890'), bottom: D.blotch('#ecc890', 0.8) }))]),
      head: part([0, 5, 0], [box([-3.5, 0, -4.5], [7, 3, 9], S('#c8783a', 'noise', { front: D.all(D.band(0.67, 1, '#ecc890'), D.bar('#5a2a14', 0.67, 99)), top: D.patches('#8a4a22', 2, 1), sides: D.band(0.67, 1, '#ecc890') })), box([-3.5, 3, -4.5], [3, 2, 3], S('#c8783a', 'noise', { front: D.art(['...', 'yky'], { y: '#e8c050', k: K }), sides: D.art(['...', '.k.'], { k: K }) })), box([0.5, 3, -4.5], [3, 2, 3], S('#c8783a', 'noise', { front: D.art(['...', 'yky'], { y: '#e8c050', k: K }), sides: D.art(['...', '.k.'], { k: K }) }))]),
      leg0: part([3, 2, -3], [box([-1, -2, -1], [3, 2, 3], S('#b86a2a', 'noise', { bottom: D.band(0, 1, '#ecc890') }))]), leg1: part([-3, 2, -3], [box([-2, -2, -1], [3, 2, 3], S('#b86a2a', 'noise', { bottom: D.band(0, 1, '#ecc890') }))]),
      leg2: part([3, 2, 3], [box([-1, -2, -2], [3, 2, 4], S('#b86a2a', 'noise', { bottom: D.band(0, 1, '#ecc890') }))]), leg3: part([-3, 2, 3], [box([-2, -2, -2], [3, 2, 4], S('#b86a2a', 'noise', { bottom: D.band(0, 1, '#ecc890') }))]),
    },
  }),
});
mob('turtle', {
  hw: 0.6, h: 0.4, health: 30, speed: 1.2, kind: 'passive', ai: 'animal', amphibious: true, food: ['seagrass'], egg: ['#3a8a3a', '#e8d8a0'], drops: [['seagrass', 0, 2]], xp: [1, 3], sound: 'turtle',
  model: () => ({
    anim: 'quadruped', eye: 4, parts: {
      body: part([0, 1, 0], [box([-9, 0, -10], [18, 4, 20], S('#3e7c3a', 'noise', { top: D.all(D.grid('#24521f', 5, 4), D.frame('#6aa04a')), sides: D.all(D.band(0, 0.5, '#2e6a2a'), D.band(0.75, 1, '#5a3a22')) })), box([-7, -1, -8], [14, 1, 16], S('#e0d0a0', 'noise', { caps: D.grid('#b8a878', 4, 4) }, 0.06))]),
      head: part([0, 3, -10], [box([-3, -2, -6], [6, 5, 6], S('#74ac52', 'noise', { front: D.all(eyes({ c: K, pupil: null, y: 0.3, gap: 4, ew: 1 }), D.bar('#2a4a1a', 0.7, 4)), sides: D.sideEye({ c: K, y: 0.3, from: 1 }), top: D.patches('#5a8e3c', 2, 1) }))]),
      leg0: part([7, 2, -7], [box([0, -1, -2], [8, 1, 4], S('#6aa84a', 'noise', { caps: D.patches('#4e8a36', 2, 1) }))]), leg1: part([-7, 2, -7], [box([-8, -1, -2], [8, 1, 4], S('#6aa84a', 'noise', { caps: D.patches('#4e8a36', 2, 1) }))]),
      leg2: part([5, 2, 9], [box([-2, -1, 0], [4, 1, 6], S('#6aa84a', 'noise', { caps: D.patches('#4e8a36', 2, 1) }))]), leg3: part([-5, 2, 9], [box([-2, -1, 0], [4, 1, 6], S('#6aa84a', 'noise', { caps: D.patches('#4e8a36', 2, 1) }))]),
    },
  }),
});
mob('parrot', {
  hw: 0.25, h: 0.9, health: 6, speed: 3, kind: 'passive', ai: 'flyer', flying: true, food: ['wheat_seeds'], egg: ['#0da70b', '#ff0000'], drops: [['feather', 1, 2]], xp: [1, 3], sound: 'parrot',
  model: () => ({
    anim: 'bird', eye: 10, parts: {
      body: part([0, 3, 0], [box([-1.5, 0, -1.5], [3, 6, 3], S('#dc2222', 'feathers', { back: D.band(0.6, 1, '#f0d020') }))], { rot: [0.3, 0, 0] }),
      head: part([0, 9, 0], [box([-1, 0, -1], [2, 3, 2], S('#dc2222', 'noise', { front: D.band(0.34, 1, '#f4f0e8'), sides: D.all(D.band(0.34, 1, '#f4f0e8'), D.sideEye({ c: K, y: 0.34, from: 0 })) })), box([-0.5, 0.5, -2], [1, 2, 1], S('#3a3a3a', 'noise', { front: D.band(0, 0.5, '#5a5a5a') })), box([-0.5, 3, -1], [1, 2, 3], S('#dc2222', 'feathers'))]),
      wingR: part([1.5, 8, 0], [box([0, -5, -1.5], [1, 5, 3], S('#dc2222', 'feathers', { all: D.all(D.band(0.4, 0.6, '#f0d020'), D.band(0.6, 1, '#2a60e0')) }))]), wingL: part([-1.5, 8, 0], [box([-1, -5, -1.5], [1, 5, 3], S('#dc2222', 'feathers', { all: D.all(D.band(0.4, 0.6, '#f0d020'), D.band(0.6, 1, '#2a60e0')) }))]),
      tail: part([0, 3, 1], [box([-1.5, -4, 0], [3, 4, 1], S('#dc2222', 'feathers', { all: D.band(0.5, 1, '#2a60e0') }))]),
      leg0: part([1, 3, 0], [box([-0.5, -3, -0.5], [1, 3, 1], S('#6a6a6a'))]), leg1: part([-1, 3, 0], [box([-0.5, -3, -0.5], [1, 3, 1], S('#6a6a6a'))]),
    },
  }),
});
mob('bat', {
  hw: 0.25, h: 0.9, health: 6, speed: 4, kind: 'ambient', ai: 'bat', flying: true, egg: ['#4c3e30', '#0f0f0f'], drops: [], xp: [0, 0], sound: 'bat',
  model: () => ({
    anim: 'bat', eye: 10, parts: {
      body: part([0, 4, 0], [box([-3, 0, -1.5], [6, 8, 3], S('#4c3e30', 'fur', { front: D.blotch('#6a5644', 0.5) }))]),
      head: part([0, 12, 0], [box([-3, 0, -3], [6, 6, 6], S('#4c3e30', 'fur', face(D.band(0.5, 1, '#5e4c3c'), eyes({ c: '#101010', pupil: null, y: 0.5, gap: 2, ew: 1 }), D.bar('#e0d8c8', 0.84, 2), D.bar('#2a1e16', 0.67, 2)))), box([-3, 5, 0], [2, 3, 1], S('#3a2e24', 'noise', { front: D.band(0.34, 1, '#5a4034') })), box([1, 5, 0], [2, 3, 1], S('#3a2e24', 'noise', { front: D.band(0.34, 1, '#5a4034') }))]),
      wingR: part([3, 11, 0], [box([0, -9, 0], [9, 10, 1], S('#2e241c', 'membrane', null, 0.14))]), wingL: part([-3, 11, 0], [box([-9, -9, 0], [9, 10, 1], S('#2e241c', 'membrane', null, 0.14))]),
    },
  }),
});
const squidModel = (col, glow) => () => {
  const lite = glow ? '#7af0c8' : shadeHex(col, 1.35), spots = D.patches(lite, 3, 1.2);
  const eyesArt = D.at(0.62, 0.94, D.art(['............', '...ww..ww...', '...wk..kw...', '............', '.....mm.....'], { w: glow ? '#c8fff0' : '#e8ecf0', k: K, m: shadeHex(col, 0.55) }));
  const parts = { body: part([0, 8, 0], [box([-6, 0, -6], [12, 16, 12], S(col, 'noise', { front: D.all(spots, eyesArt), sides: spots, back: spots, top: D.blotch(lite, 0.2) }, 0.1))]) };
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; parts[`t${i}`] = part([Math.cos(a) * 5, 8, Math.sin(a) * 5], [box([-1, -18, -1], [2, 18, 2], S(col, 'noise', { sides: D.stripes(lite, 4), front: D.stripes(lite, 4), back: D.stripes(lite, 4) }, 0.1))]); }
  return { anim: 'squid', eye: 18, parts };
};
mob('squid', { hw: 0.4, h: 0.95, health: 10, speed: 2, kind: 'water', ai: 'swimmer', swim: true, egg: ['#223b4d', '#708899'], drops: [['ink_sac', 1, 3]], xp: [1, 3], sound: 'squid', model: squidModel('#2a4a6a') });
mob('glow_squid', { hw: 0.4, h: 0.95, health: 10, speed: 2, kind: 'water', ai: 'swimmer', swim: true, glow: true, egg: ['#095656', '#85f1bc'], drops: [['glow_ink_sac', 1, 3]], xp: [1, 3], sound: 'squid', model: squidModel('#1a8a8a', true) });
const fishModel = (col, fin, len = 7, tall = 4) => () => ({
  anim: 'fish', eye: 2, parts: {
    body: part([0, 0, 0], [box([-1, 0, -len / 2], [2, tall, len], S(col, 'belly', { front: D.bar(shadeHex(col, 0.6), 0.75, 99), sides: D.all(D.sideEye({ c: '#f0f0e8', pupil: K, y: 0.25, from: 0, ew: 2 }), D.patches(shadeHex(col, 0.8), 2, 0.8)) })), box([0, tall, -1], [0.01, 2, 4], S(fin, 'membrane'))]),
    tail: part([0, tall / 2, len / 2], [box([0, -tall / 2, 0], [0.01, tall, 4], S(fin, 'membrane'))]),
  },
});
mob('cod', { hw: 0.25, h: 0.3, health: 3, speed: 2.5, kind: 'water', ai: 'fish', swim: true, egg: ['#c1a76a', '#e5c48b'], drops: [['cod', 1, 1], ['bone_meal', 0, 1, 0.05]], cooked: { cod: 'cooked_cod' }, xp: [1, 3], sound: 'fish', model: fishModel('#a8906a', '#8a7454') });
mob('salmon', { hw: 0.35, h: 0.4, health: 3, speed: 2.8, kind: 'water', ai: 'fish', swim: true, egg: ['#a00f10', '#0e8474'], drops: [['salmon', 1, 1]], cooked: { salmon: 'cooked_salmon' }, xp: [1, 3], sound: 'fish', model: fishModel('#a83a3a', '#6a8a9a', 10, 5) });
mob('tropical_fish', { hw: 0.25, h: 0.4, health: 3, speed: 2.5, kind: 'water', ai: 'fish', swim: true, egg: ['#ef6915', '#fff9ef'], drops: [['tropical_fish', 1, 1]], xp: [1, 3], sound: 'fish', model: () => { const m = fishModel('#f07a2a', '#f4f0e8', 6, 5)(); m.parts.body.boxes[0].style = S('#f07a2a', 'noise', { sides: D.all(D.stripes('#f4f0e8', 3, true), D.sideEye({ c: '#f4f0e8', pupil: K, y: 0.3, from: 0, ew: 2 })), top: D.stripes('#f4f0e8', 3) }); return m; } });
mob('pufferfish', { hw: 0.35, h: 0.6, health: 3, speed: 1.5, kind: 'water', ai: 'fish', swim: true, attack: { dmg: 2, cd: 1, poison: 3, touch: true }, egg: ['#f6b201', '#37c3f2'], drops: [['pufferfish', 1, 1]], xp: [1, 3], sound: 'fish', model: () => ({ anim: 'fish', eye: 4, parts: { body: part([0, 0, 0], [box([-4, 0, -4], [8, 8, 8], S('#e0c030', 'belly', { all: D.patches('#8a6a1e', 5, 0.8), front: D.all(D.band(0.75, 1, '#f4eec8'), D.patches('#8a6a1e', 2, 0.8), eyes({ c: '#f4f4f0', pupil: K, y: 0.25, gap: 4, eh: 2, out: true }), D.bar('#8a4a1a', 0.62, 2)) }))]), tail: part([0, 4, 4], [box([0, -2, 0], [0.01, 4, 3], S('#d8c030', 'membrane'))]) } }) });
// Guardians: a spiked, one-eyed box with a three-segment tail that fires a charging laser.
const guardianModel = (col, spike, eyeC) => () => {
  const plates = D.all(D.grid(shadeHex(col, 0.84), 6, 4), D.patches(eyeC === '#e07a2a' ? '#c8743a' : shadeHex(col, 0.85), 3, 1));
  const body = S(col, 'noise', { front: D.all(plates, D.art([
    '............',
    '............',
    '............',
    '............',
    '...dddddd...',
    '..dwwwwwwd..',
    '..dwwiiwwd..',
    '..dwwiiwwd..',
    '..dwwwwwwd..',
    '...dddddd...',
    '............',
    '............'], { d: shadeHex(col, 0.55), w: '#f0ecd8', i: eyeC })), all: plates }, 0.1);
  const sp = S(spike, 'noise', { all: D.band(0, 0.3, shadeHex(spike, 1.1)) }, 0.08);
  const spikes = [[[-1, 12.8, -1], [2, 4, 2]], [[-1, -3.2, -1], [2, 4, 2]], [[6, 5.8, -1], [4, 2, 2]], [[-10, 5.8, -1], [4, 2, 2]], [[-1, 5.8, -12], [2, 2, 4]],
    [[4.5, 11.3, -6.5], [2, 3, 2]], [[-6.5, 11.3, -6.5], [2, 3, 2]], [[4.5, 11.3, 4.5], [2, 3, 2]], [[-6.5, 11.3, 4.5], [2, 3, 2]], [[4.5, -1.5, -6.5], [2, 3, 2]], [[-6.5, -1.5, 4.5], [2, 3, 2]]];
  return {
    anim: 'fish', eye: 7, parts: {
      body: part([0, 0, 0], [box([-6, 0.8, -8], [12, 12, 16], body), ...spikes.map(([o, s]) => box(o, s, sp))]),
      tail: part([0, 6.8, 8], [box([-2, -2, 0], [4, 4, 8], S(col, 'noise', { all: D.stripes(shadeHex(col, 0.72), 3, true) })), box([-1.5, -1.5, 8], [3, 3, 7], S(col, 'noise', { all: D.stripes(shadeHex(col, 0.72), 3, true) })), box([-1, -1, 15], [2, 2, 6], S(col)), box([0, -4.5, 19], [0.01, 9, 6], S(spike, 'membrane'))]),
    },
  };
};
mob('guardian', { hw: 0.43, h: 0.85, health: 30, speed: 4, kind: 'hostile', ai: 'guardian', swim: true, amphibious: true, laser: { dmg: 6, time: 4 }, egg: ['#5a8272', '#f17d30'], drops: [['prismarine_shard', 0, 2], ['cod', 0, 1], ['prismarine_crystals', 0, 1, 0.4]], xp: [8, 10], sound: 'squid', model: guardianModel('#5a8a7a', '#d8cfb8', '#e07a2a') });
mob('elder_guardian', { hw: 1.0, h: 2.0, scale: 2.35, health: 80, speed: 2.5, kind: 'hostile', ai: 'guardian', swim: true, amphibious: true, persistent: true, elder: true, laser: { dmg: 8, time: 3 }, egg: ['#ceccba', '#747693'], drops: [['wet_sponge', 1, 1], ['prismarine_shard', 0, 2], ['cod', 0, 1]], xp: [10, 10], sound: 'squid', model: guardianModel('#c8c4b0', '#8a86a0', '#8a6ab8') });
mob('dolphin', {
  hw: 0.45, h: 0.6, health: 10, speed: 5, kind: 'water', ai: 'swimmer', swim: true, breathes: true, egg: ['#223b4d', '#f9f9f9'], drops: [['cod', 0, 1]], xp: [1, 3], sound: 'dolphin',
  model: () => ({
    anim: 'fish', eye: 5, parts: {
      body: part([0, 0, 0], [box([-4, 0, -6], [8, 7, 13], S('#7890a4', 'belly')), box([-0.5, 7, -1], [1, 4, 5], S('#5a7086'))]),
      head: part([0, 3, -6], [box([-4, -3, -6], [8, 7, 6], S('#7890a4', 'belly', { front: D.all(D.band(0.6, 1, '#b8c6d0'), D.bar('#3a4a58', 0.72, 4)), sides: D.sideEye({ c: K, pupil: '#e8eef0', y: 0.4, from: 1, ew: 2 }) })), box([-1, -3, -10], [2, 2, 4], S('#a8b8c6', 'noise', { top: D.band(0, 1, '#8aa0b2') }))]),
      tail: part([0, 3, 7], [box([-2, -1, 0], [4, 3, 8], S('#7890a4', 'belly')), box([-5, 0, 6], [10, 1, 4], S('#5a7086'))]),
    },
  }),
});
mob('axolotl', {
  hw: 0.35, h: 0.42, health: 14, speed: 2.5, kind: 'water', ai: 'swimmer', swim: true, amphibious: true, food: ['tropical_fish'], egg: ['#fbc1e3', '#a62d74'], drops: [], xp: [1, 3], sound: 'axolotl',
  model: () => ({
    anim: 'quadruped', eye: 4, parts: {
      body: part([0, 2, 0], [box([-4, 0, -5], [8, 4, 10], S('#f4a8d0', 'noise', { top: D.patches('#e890bc', 3, 1), bottom: D.blotch('#fac4e0', 0.7) }, 0.08)), box([0, 4, -3], [0.01, 2, 8], S('#e888b8', 'membrane'))]),
      head: part([0, 4, -5], [box([-4, -2, -5], [8, 5, 5], S('#f4a8d0', 'noise', { front: D.all(eyes({ c: K, pupil: null, y: 0.4, gap: 6, ew: 1 }), D.bar('#b04a80', 0.8, 2)), top: D.patches('#e890bc', 1, 1) }, 0.08)), box([-8, -1, -2], [3, 5, 0.01], S('#c83a7a', 'noise', { all: D.stripes('#e0609a', 2) })), box([5, -1, -2], [3, 5, 0.01], S('#c83a7a', 'noise', { all: D.stripes('#e0609a', 2) }))]),
      leg0: part([4, 2, -3], [box([0, -1, -1], [3, 1, 2], S('#e888b8'))]), leg1: part([-4, 2, -3], [box([-3, -1, -1], [3, 1, 2], S('#e888b8'))]),
      leg2: part([4, 2, 3], [box([0, -1, -1], [3, 1, 2], S('#e888b8'))]), leg3: part([-4, 2, 3], [box([-3, -1, -1], [3, 1, 2], S('#e888b8'))]),
      tail: part([0, 3, 5], [box([0, -2, 0], [0.01, 5, 12], S('#e888b8', 'membrane'))]),
    },
  }),
});
mob('strider', {
  hw: 0.45, h: 1.7, health: 20, speed: 2, kind: 'passive', ai: 'animal', lavaWalker: true, fireImmune: true, food: ['warped_fungus'], egg: ['#9c3436', '#4d494d'], drops: [['string', 2, 5]], xp: [1, 3], sound: 'strider',
  model: () => ({
    anim: 'quadruped', eye: 22, parts: {
      body: part([0, 14, 0], [box([-8, 0, -8], [16, 14, 16], S('#a03638', 'fur', { front: D.all(D.stripes('#862a2c', 4, true), D.band(0.2, 0.3, '#7a2426'), eyes({ c: '#f0e8e0', pupil: K, y: 0.3, gap: 6, ew: 3, eh: 2 }), D.bar('#3a0e10', 0.6, 0.6, 2), D.bar('#e8dcd0', 0.6, 0.5)), all: D.stripes('#862a2c', 4, true) })), box([-7, 14, -6], [2, 6, 0.01], S('#7a2a2a', 'fur')), box([5, 14, -6], [2, 6, 0.01], S('#7a2a2a', 'fur'))]),
      leg0: part([4, 16, 0], [box([-2, -16, -2], [4, 16, 4], S('#56505a', 'noise', { all: D.all(D.stripes('#46404a', 4), D.band(0.9, 1, '#34303a')) }))]), leg1: part([-4, 16, 0], [box([-2, -16, -2], [4, 16, 4], S('#56505a', 'noise', { all: D.all(D.stripes('#46404a', 4), D.band(0.9, 1, '#34303a')) }))]),
    },
  }),
});

// --- villagers & utility ---
const VILLAGER_SKIN = '#b58663';
// Villager: one dark brow over green eyes, a long shaded nose, a cloth robe with a collar and hem, hands folded in front.
// `extra` is the profession's robe decoration ({ front, all }).
const villagerModel = (robe, extra, skin = VILLAGER_SKIN, eyeC = '#2e8a3a') => () => {
  const hem = D.all(D.band(0.93, 1, shadeHex(robe, 0.72)), extra && extra.all);
  const robeSt = S(robe, 'cloth', { front: D.all(D.bar(shadeHex(robe, 0.7), 0, 4), D.at(0.05, 0.93, D.stripes(shadeHex(robe, 0.86), 99, true), 0.5, 0.56), hem, extra && extra.front), sides: hem, back: hem, top: D.bar(shadeHex(skin, 0.8), 0.5, 4, 2) }, 0.1);
  const m = humanoid({ head: S(skin, 'noise', { front: D.all(D.brow(shadeHex(skin, 0.45), 0.3, 1), eyes({ c: '#f4f2ec', pupil: eyeC, y: 0.4, gap: 2 }), D.bar(shadeHex(skin, 0.82), 0.5, 4), D.bar(shadeHex(skin, 0.7), 0.9, 2)), top: D.blotch(shadeHex(skin, 0.9), 0.3) }, 0.08), body: S(robe, 'cloth'), robe: robeSt, arm: S(robe, 'cloth', { top: D.band(0, 1, shadeHex(robe, 0.8)) }, 0.1), leg: S('#4a3a2e', 'cloth'), nose: S(skin, 'noise', { front: D.band(0.75, 1, shadeHex(skin, 0.82)), sides: D.band(0.75, 1, shadeHex(skin, 0.75)), bottom: D.band(0, 1, shadeHex(skin, 0.7)) }, 0.06) }, { headH: 10, bodyD: 6, nose: true, robe: true, crossed: true });
  if (m.parts.arms) m.parts.arms.boxes[0].style = S(robe, 'cloth', { front: D.bar(skin, 0, 4, 99), top: D.bar(skin, 0, 4, 99) }, 0.1);
  return m;
};
// Profession looks: [robe decoration on the front, decoration on every side].
const band = (a, b, c) => D.band(a, b, c), apron = (c, top = 0.3) => D.at(top, 0.95, D.all(D.band(0, 1, c), D.stripes(shadeHex(c, 0.85), 99, true)), 0.2, 0.8);
const PROF_DECOR = {
  farmer: { all: band(0, 0.06, '#e8d890'), front: D.all(band(0.42, 0.46, '#5a3a1e'), apron('#8a6a3a', 0.46)) },
  librarian: { all: band(0.02, 0.14, '#8a3a2a'), front: D.at(0.2, 0.42, D.band(0, 1, '#6a4a2a'), 0.3, 0.7) },
  armorer: { all: band(0.42, 0.46, '#1a1a1a'), front: D.all(apron('#2a2a2a', 0.08), D.at(0.1, 0.36, D.band(0, 1, '#8a8a8e'), 0.3, 0.7)) },
  weaponsmith: { all: band(0.42, 0.47, '#1e1e1e'), front: apron('#242424', 0.47) },
  toolsmith: { all: band(0.42, 0.46, '#2a1e14'), front: apron('#3a2a1e', 0.2) },
  butcher: { all: band(0.42, 0.46, '#6a1a1a'), front: D.all(apron('#f0ece6', 0.1), D.at(0.1, 0.95, D.patches('#b83030', 3, 0.9), 0.2, 0.8)) },
  cleric: { all: band(0, 0.08, '#e0c040'), front: D.at(0, 1, D.band(0, 1, '#e0c040'), 0.38, 0.62) },
  fletcher: { all: band(0.42, 0.46, '#4a3a1e'), front: D.at(0.02, 0.2, D.band(0, 1, '#d8c89a')) },
  leatherworker: { all: band(0.42, 0.46, '#3a2410'), front: apron('#5a3a1a', 0.1) },
  shepherd: { all: band(0, 0.1, '#ece8e0'), front: D.at(0.1, 0.5, D.band(0, 1, '#ece8e0'), 0.25, 0.75) },
  fisherman: { all: band(0.42, 0.46, '#2a2a2a'), front: D.at(0.02, 0.42, D.band(0, 1, '#d8a030'), 0.15, 0.85) },
  mason: { all: band(0.42, 0.46, '#2a2a2a'), front: apron('#1e1e20', 0.1) },
  cartographer: { all: D.all(band(0.02, 0.1, '#a88a50'), band(0.42, 0.46, '#6a4a2a')), front: D.at(0.1, 0.42, D.stripes('#a88a50', 2, true), 0.25, 0.75) },
};
export const PROFESSIONS = ['farmer', 'librarian', 'armorer', 'weaponsmith', 'toolsmith', 'butcher', 'cleric', 'fletcher', 'leatherworker', 'shepherd', 'fisherman', 'mason', 'cartographer', 'nitwit'];
export const PROFESSION_COLORS = { farmer: '#c8a860', librarian: '#e8e8e8', armorer: '#3a3a3a', weaponsmith: '#4a4a4a', toolsmith: '#5a4030', butcher: '#e8e8e8', cleric: '#6a3a8a', fletcher: '#6a8a3a', leatherworker: '#8a5a2a', shepherd: '#a88a6a', fisherman: '#3a6a8a', mason: '#6a6a5a', cartographer: '#e0d8b0', nitwit: '#3a8a3a' };
mob('villager', { hw: 0.3, h: 1.95, health: 20, speed: 2.1, kind: 'utility', ai: 'villager', egg: ['#563c33', '#bd8b72'], drops: [], xp: [0, 0], sound: 'villager', persistent: true, model: villagerModel('#6a4a3a', { all: D.band(0.42, 0.46, '#3a2818') }) });
mob('wandering_trader', { hw: 0.3, h: 1.95, health: 20, speed: 2.3, kind: 'utility', ai: 'villager', egg: ['#456296', '#eaa430'], drops: [], xp: [0, 0], sound: 'villager', model: villagerModel('#2a4a8a', { all: D.all(D.band(0.42, 0.47, '#e0a030'), D.band(0, 0.08, '#1e3468')), front: D.at(0, 1, D.band(0, 1, '#e0a030'), 0.44, 0.56) }) });
mob('iron_golem', { chase: 3.6,
  hw: 0.7, h: 2.7, health: 100, speed: 1.6, kind: 'utility', ai: 'golem', attack: { dmg: 11, cd: 1.3, fling: 1 }, egg: ['#dbcdc1', '#74a332'], drops: [['iron_ingot', 3, 5], ['poppy', 0, 2]], xp: [0, 0], sound: 'golem', knockbackResist: 1, persistent: true,
  model: () => { const iron = '#d6cec2', crack = '#8a8278', st = S(iron, 'metal', { all: D.cracks(crack, 2, 4) }, 0.08); const vine = S(iron, 'metal', { all: D.cracks(crack, 1, 4), front: D.all(D.cracks(crack, 1, 4), D.vines('#3e7a2a', '#62a43a', 2)), back: D.vines('#3e7a2a', '#62a43a', 2), sides: D.vines('#3e7a2a', '#62a43a', 1), top: D.patches('#4e8a2e', 2, 1.5) }, 0.08);
    return { anim: 'golem', eye: 38, parts: {
      body: part([0, 16, 0], [box([-9, 12, -6], [18, 12, 11], vine), box([-5, 4, -3], [9, 8, 6], st)]),
      head: part([0, 40, -2], [box([-4, 0, -5.5], [8, 10, 8], S(iron, 'metal', { front: D.all(D.brow('#9a9286', 0.3, 1), D.bar('#6e685e', 0.4, 6), eyes({ c: '#a01818', pupil: null, y: 0.4, gap: 4, ew: 1 }), D.bar('#8a8278', 0.9, 4)), all: D.cracks(crack, 1, 3) }, 0.08)), box([-1, 1, -7.5], [2, 4, 2], S(iron, 'metal', { front: D.band(0.75, 1, '#a89e92') }, 0.08))]),
      rightArm: part([11, 38, 0], [box([-2, -28, -3], [4, 30, 6], vine)]), leftArm: part([-11, 38, 0], [box([-2, -28, -3], [4, 30, 6], vine)]),
      rightLeg: part([4, 16, 0], [box([-3, -16, -2.5], [6, 16, 5], st)]), leftLeg: part([-4, 16, 0], [box([-3, -16, -2.5], [6, 16, 5], st)]),
    } }; },
});
mob('snow_golem', {
  hw: 0.35, h: 1.9, health: 4, speed: 2, kind: 'utility', ai: 'snowgolem', attack: { ranged: 'snowball', range: 10, cd: 1 }, egg: ['#d9f2f2', '#81a4a4'], drops: [['snowball', 0, 15]], xp: [0, 0], sound: 'golem', meltsInHeat: true,
  model: () => ({ anim: 'snowgolem', eye: 26, parts: {
    body: part([0, 0, 0], [box([-6, 0, -6], [12, 12, 12], S('#f2f8f8', 'noise', { all: D.blotch('#d8e6ea', 0.25) }, 0.03)), box([-5, 11, -5], [10, 10, 10], S('#f2f8f8', 'noise', { all: D.blotch('#d8e6ea', 0.25) }, 0.03))]),
    head: part([0, 21, 0], [box([-4, 0, -4], [8, 8, 8], S('#dc7c1a', 'noise', { front: D.all(D.stripes('#b85e10', 3, true), D.art([
      '........',
      '........',
      '.kk..kk.',
      '.kk..kk.',
      '........',
      '.kkkkkk.',
      '..kkkk..',
      '........'], { k: '#3a1e08' })), sides: D.stripes('#b85e10', 3, true), back: D.stripes('#b85e10', 3, true), top: D.all(D.frame('#b85e10'), D.rect(0.375, 0.375, 0.25, 0.25, '#5a6a24')) }, 0.1))]),
    rightArm: part([5, 18, 0], [box([0, -1, -1], [10, 2, 2], S('#6a4a2a', 'fur', { all: D.stripes('#4a3218', 4, true) }))], { rot: [0, 0, 0.5] }), leftArm: part([-5, 18, 0], [box([-10, -1, -1], [10, 2, 2], S('#6a4a2a', 'fur', { all: D.stripes('#4a3218', 4, true) }))], { rot: [0, 0, -0.5] }),
  } }),
});

// --- undead ---
// Zombie family: sunken dark eyes under a heavy brow, rotting blotches, torn short-sleeved shirt, trousers.
const zombieLike = (skin, shirt, pants, eye = null, weed = null) => () => {
  const rot = D.blotch(shadeHex(skin, 0.8), 0.18), dark = shadeHex(skin, 0.62);
  const m = humanoid({
    head: S(skin, 'noise', { front: D.all(rot, D.brow(shadeHex(skin, 0.78), 0.375, 1), eyes({ c: eye || dark, pupil: eye ? shadeHex(eye, 0.6) : '#0e140e', y: 0.5, gap: 2 }), D.bar(shadeHex(skin, 0.8), 0.625, 2), D.bar(dark, 0.78, 4)), all: rot, top: D.blotch(shadeHex(skin, 0.7), 0.3) }, 0.1),
    body: S(shirt, 'cloth', { all: D.all(D.patches(skin, 1, 1), D.ragged(0.86, 1, pants), weed), top: D.bar(skin, 0.5, 4, 2) }, 0.1),
    arm: S(skin, 'noise', { all: D.all(rot, D.ragged(0, 0.3, shirt)), top: D.band(0, 1, shirt) }, 0.1),
    leg: S(pants, 'cloth', { all: D.all(D.ragged(0.86, 1, shadeHex(pants, 0.6)), weed) }, 0.1),
  });
  m.anim = 'zombie'; return m;
};
const undead = { kind: 'hostile', ai: 'melee', undead: true, xp: [5, 5] };
mob('zombie', { chase: 4.0, ...undead, armor: 2, hw: 0.3, h: 1.95, health: 20, speed: 2.3, attack: { dmg: 3, cd: 1 }, burns: true, egg: ['#00afaf', '#799c65'], drops: [['rotten_flesh', 0, 2], ['iron_ingot', 0, 1, 0.025], ['carrot', 0, 1, 0.025], ['potato', 0, 1, 0.025]], sound: 'zombie', breaksDoors: true, model: zombieLike(ZOMBIE_SKIN, '#2e9aa6', '#46409a') });
mob('husk', { chase: 4.0, ...undead, armor: 2, hw: 0.3, h: 1.95, health: 20, speed: 2.3, attack: { dmg: 3, cd: 1, hunger: 7 }, egg: ['#797061', '#e6cc94'], drops: [['rotten_flesh', 0, 2]], sound: 'zombie', model: zombieLike(HUSK, '#6a5c44', '#4a3e30') });
mob('drowned', { chase: 4.0, ...undead, armor: 2, hw: 0.3, h: 1.95, health: 20, speed: 2.3, swim: true, amphibious: true, attack: { dmg: 3, cd: 1, trident: 0.06 }, burns: true, egg: ['#8ff1d7', '#799c65'], drops: [['rotten_flesh', 0, 2], ['copper_ingot', 0, 1, 0.11]], sound: 'zombie', model: zombieLike(DROWNED, '#2a5e58', '#4a3e7a', '#9af0e8', D.vines('#2e6a2a', '#4a9a3a', 1)) });
mob('zombie_villager', { chase: 4.0, ...undead, armor: 2, hw: 0.3, h: 1.95, health: 20, speed: 2.3, attack: { dmg: 3, cd: 1 }, burns: true, egg: ['#563c33', '#799c65'], drops: [['rotten_flesh', 0, 2]], sound: 'zombie', curable: true,
  model: () => { const rot = D.blotch('#4a7a3a', 0.2), robe = '#6a4a3a'; const m = humanoid({ head: S(ZOMBIE_SKIN, 'noise', { front: D.all(rot, D.brow('#2e4a24', 0.3, 1), eyes({ c: '#8a2a1a', pupil: '#3a0a06', y: 0.4, gap: 2 }), D.bar('#3a5a2e', 0.9, 2)), all: rot }, 0.1), body: S(robe, 'cloth'), robe: S(robe, 'cloth', { all: D.all(D.patches('#4e6a3a', 1, 1.5), D.ragged(0.9, 1, '#3a2a1e')), front: D.all(D.patches('#4e6a3a', 1, 1.5), D.bar('#4a3222', 0, 4), D.ragged(0.9, 1, '#3a2a1e')) }, 0.1), arm: S(ZOMBIE_SKIN, 'noise', { all: D.all(rot, D.ragged(0, 0.4, robe)) }, 0.1), leg: S('#4a3a2e', 'cloth'), nose: S(ZOMBIE_SKIN, 'noise', { front: D.band(0.75, 1, '#4a7a3a') }, 0.1) }, { headH: 10, bodyD: 6, nose: true, robe: true }); m.anim = 'zombie'; return m; } });
// Skeletons: skull with deep sockets, nose hole and teeth; ribcage over a dark chest; jointed limb bones.
// `rag` drapes tattered cloth over the body, hips and head (stray).
const skeletonModel = (bone, rag, eye = '#1a1a1a') => () => {
  const gap = shadeHex(bone, 0.32), joint = shadeHex(bone, 0.78);
  const limb = D.all(D.band(0.46, 0.54, joint), D.band(0, 0.06, joint));
  const skull = D.art([
    '........',
    '........',
    '........',
    '.11..11.',
    '.kk..kk.',
    '...kk...',
    '.k3k3k3.',
    '..1111..'], { k: eye });
  const tatter = rag ? D.ragged(0, 0.3, rag) : null;
  const m = humanoid({
    head: S(bone, 'bone', { front: D.all(skull, tatter), sides: tatter, back: tatter, top: rag ? D.band(0, 1, rag) : D.cracks(joint, 1, 3) }, 0.1),
    body: rag ? S(rag, 'cloth', { all: D.ragged(0.8, 1, gap, 2), front: D.all(D.at(0.3, 0.8, D.ribs(bone, gap), 0.25, 0.75), D.ragged(0.8, 1, gap, 2)) }, 0.1) : S(bone, 'bone', { front: D.ribs(bone, gap), back: D.all(D.band(0, 1, gap), D.at(0, 1, D.band(0, 1, bone), 0.375, 0.625)), sides: D.all(D.band(0, 1, gap), D.stripes(bone, 2)) }, 0.1),
    arm: S(bone, 'bone', { sides: limb, front: limb, back: limb }, 0.1),
    leg: S(bone, 'bone', { sides: D.all(limb, rag ? D.ragged(0, 0.35, rag) : null), front: D.all(limb, rag ? D.ragged(0, 0.35, rag) : null), back: D.all(limb, rag ? D.ragged(0, 0.35, rag) : null) }, 0.1),
  }, { thin: true });
  m.anim = 'skeleton'; return m;
};
mob('skeleton', { chase: 3.9, ...undead, hw: 0.3, h: 1.99, health: 20, speed: 2.4, attack: { ranged: 'arrow', range: 15, cd: 2 }, burns: true, egg: ['#c1c1c1', '#494949'], drops: [['bone', 0, 2], ['arrow', 0, 2]], sound: 'skeleton', holds: 'bow', model: skeletonModel('#c6c6c0') });
mob('stray', { chase: 3.9, ...undead, hw: 0.3, h: 1.99, health: 20, speed: 2.4, attack: { ranged: 'arrow', range: 15, cd: 2, slow: true }, burns: true, egg: ['#617677', '#ddeaea'], drops: [['bone', 0, 2], ['arrow', 0, 2]], sound: 'skeleton', holds: 'bow', model: skeletonModel('#b0bcbc', '#5e7a7c', '#1e2a2e') });
mob('wither_skeleton', { chase: 4.4, ...undead, hw: 0.35, h: 2.4, scale: 1.2, health: 20, speed: 2.5, attack: { dmg: 8, cd: 1, wither: 10 }, fireImmune: true, egg: ['#141414', '#474d4d'], drops: [['coal', 0, 1], ['bone', 0, 2], ['wither_skeleton_skull', 0, 1, 0.025]], sound: 'skeleton', holds: 'stone_sword', model: skeletonModel('#444444', null, '#060606') });
mob('zombified_piglin', { chase: 4.6, ...undead, kind: 'neutral', ai: 'melee', hw: 0.3, h: 1.95, health: 20, speed: 2.3, attack: { dmg: 8, cd: 1 }, fireImmune: true, egg: ['#ea9393', '#4c7129'], drops: [['rotten_flesh', 0, 1], ['gold_nugget', 0, 1], ['gold_ingot', 0, 1, 0.025]], sound: 'zpiglin', holds: 'golden_sword', groupAnger: true,
  model: () => { const skin = '#e0968a', rot = D.all(D.patches('#6a9a4a', 2, 1.6, '#4e7a36'), D.patches('#e8e0cc', 1, 1.1)); const m = humanoid({ head: S(skin, 'noise', { front: D.all(D.at(0, 1, D.patches('#6a9a4a', 1, 2), 0.6, 1), D.at(0.3, 0.9, D.band(0, 1, '#e8e0cc'), 0.7, 1), D.brow('#b86a60', 0.25, 1), eyes({ c: '#f4f0e8', pupil: K, y: 0.375, gap: 4 }), D.bar('#f0e8d8', 0.875, 6), D.bar('#8a3a3a', 0.875, 4)), all: rot }, 0.08), body: S('#7a5a3a', 'cloth', { all: D.all(D.patches('#6a9a4a', 1, 1.5), D.band(0.72, 0.8, '#d8b030'), D.ragged(0.9, 1, '#5a4028')) }), arm: S(skin, 'noise', { all: rot }, 0.08), leg: S('#5e4430', 'cloth', { all: D.ragged(0.86, 1, '#3a2a1e') }) }); m.parts.head.boxes[0].s = [10, 8, 8]; m.parts.head.boxes[0].o = [-5, 0, -4]; m.parts.head.boxes.push(box([-2, 0, -5], [4, 4, 1], S('#eaa49a', 'noise', { front: D.snout('#7a3a3a') }, 0.06))); m.anim = 'zombie'; return m; } });
mob('phantom', {
  hw: 0.45, h: 0.5, health: 20, speed: 7, kind: 'hostile', ai: 'phantom', flying: true, undead: true, burns: true, attack: { dmg: 6, cd: 1.5 }, egg: ['#43518a', '#88ff00'], drops: [['phantom_membrane', 0, 1]], xp: [5, 5], sound: 'phantom',
  model: () => ({ anim: 'phantom', eye: 2, parts: {
    body: part([0, 0, 0], [box([-2.5, 0, -4.5], [5, 3, 9], S('#43518a', 'noise', { top: D.at(0, 1, D.band(0, 1, '#6a7ab0'), 0.4, 0.6) }))]),
    head: part([0, 1, -4.5], [box([-3.5, -1, -5], [7, 3, 5], S('#43518a', 'noise', { front: D.all(eyes({ c: '#88ff40', pupil: '#d8ffb0', y: 0.34, gap: 1, ew: 3, out: true }), D.bar('#1e2440', 1, 3)), top: D.stripes('#5a68a0', 2, true) }))]),
    wingR: part([2.5, 2, 0], [box([0, -0.5, -4.5], [6, 1, 9], S('#4c5a90', 'membrane', { caps: D.band(0, 0.2, '#8090c0') })), box([6, -0.5, -4.5], [12, 1, 9], S('#5e6ca4', 'membrane', { caps: D.all(D.band(0, 0.15, '#8090c0'), D.ragged(0.85, 1, '#2a3050')) }))]),
    wingL: part([-2.5, 2, 0], [box([-6, -0.5, -4.5], [6, 1, 9], S('#4c5a90', 'membrane', { caps: D.band(0, 0.2, '#8090c0') })), box([-18, -0.5, -4.5], [12, 1, 9], S('#5e6ca4', 'membrane', { caps: D.all(D.band(0, 0.15, '#8090c0'), D.ragged(0.85, 1, '#2a3050')) }))]),
    tail: part([0, 1, 4.5], [box([-1.5, -1, 0], [3, 2, 6], S('#43518a')), box([-0.5, -0.5, 6], [1, 1, 6], S('#3a4678'))]),
  } }),
});

// --- other hostiles ---
mob('creeper', { chase: 4.0,
  hw: 0.3, h: 1.7, health: 20, speed: 2.4, kind: 'hostile', ai: 'creeper', egg: ['#0da70b', '#000000'], drops: [['gunpowder', 0, 2]], xp: [5, 5], sound: 'creeper',
  model: () => { const c = S('#58b644', 'mottled', { bottom: D.band(0, 1, '#2e6a24') }, 0.22);
    return { anim: 'creeper', eye: 22, parts: {
      body: part([0, 6, 0], [box([-4, 0, -2], [8, 12, 4], c)]),
      head: part([0, 18, 0], [box([-4, 0, -4], [8, 8, 8], S('#58b644', 'mottled', face(D.art([
        '........',
        '........',
        '.kk..kk.',
        '.kj..jk.',
        '...kk...',
        '..kjjk..',
        '..kkkk..',
        '..k..k..'], { k: '#0c100c', j: '#1c2c18' })), 0.22))]),
      leg0: part([2, 6, -4], [box([-2, -6, -2], [4, 6, 4], c)]), leg1: part([-2, 6, -4], [box([-2, -6, -2], [4, 6, 4], c)]),
      leg2: part([2, 6, 4], [box([-2, -6, -2], [4, 6, 4], c)]), leg3: part([-2, 6, 4], [box([-2, -6, -2], [4, 6, 4], c)]),
    } }; },
});
// Spiders: bristly dark body, eight red eyes (a big pair, small ones above and beside), banded legs, marked abdomen.
const spiderModel = (col, eyeCol) => () => {
  const st = S(col, 'fur'), dark = shadeHex(col, 0.6), hair = shadeHex(col, 1.5), glint = '#ff8a7a';
  const parts = {
    body: part([0, 9, 0], [box([-3, -3, -3], [6, 6, 6], st), box([-5, -4, 3], [10, 8, 12], S(col, 'fur', { top: D.all(D.at(0.1, 0.9, D.art(['.d.d.', 'd.d.d', '.ddd.', '..d..'], { d: dark }), 0.2, 0.8), D.spots(hair, 4, 1)), sides: D.spots(hair, 3, 1), back: D.spots(hair, 2, 1) }))]),
    head: part([0, 9, -3], [box([-4, -4, -8], [8, 8, 8], S(col, 'fur', face(D.art([
      '........',
      '........',
      'e.e..e.e',
      '........',
      '.hE..Eh.',
      '.EE..EE.',
      '........',
      '..d..d..'], { e: eyeCol, E: eyeCol, h: glint, d: dark }))))]),
  };
  const leg = S(col, 'fur', { all: D.stripes(hair, 5, true) });
  for (let i = 0; i < 8; i++) { const side = i < 4 ? 1 : -1, row = i % 4; parts[`leg${i}`] = part([side * 3, 9, -2 + row * 1.5], [box(side > 0 ? [0, -1, -1] : [-16, -1, -1], [16, 2, 2], leg)], { rot: [0, (row - 1.5) * 0.35 * side, side * 0.6] }); }
  return { anim: 'spider', eye: 9, parts };
};
mob('spider', { chase: 4.8, hw: 0.7, h: 0.9, health: 16, speed: 3, kind: 'hostile', ai: 'melee', climbs: true, neutralInDay: true, attack: { dmg: 2, cd: 1, leap: true }, egg: ['#342d27', '#a80e0e'], drops: [['string', 0, 2], ['spider_eye', 0, 1, 0.33]], xp: [5, 5], sound: 'spider', model: spiderModel('#3a302a', '#d81c1c') });
mob('cave_spider', { chase: 5, hw: 0.35, h: 0.5, scale: 0.7, health: 12, speed: 3.2, kind: 'hostile', ai: 'melee', climbs: true, attack: { dmg: 2, cd: 1, poison: 7 }, egg: ['#0c424e', '#a80e0e'], drops: [['string', 0, 2], ['spider_eye', 0, 1, 0.33]], xp: [5, 5], sound: 'spider', model: spiderModel('#16424e', '#d81c1c') });
mob('enderman', { chase: 6.2,
  hw: 0.3, h: 2.9, health: 40, speed: 3, kind: 'neutral', ai: 'enderman', attack: { dmg: 7, cd: 1 }, egg: ['#161616', '#000000'], drops: [['ender_pearl', 0, 1]], xp: [5, 5], sound: 'enderman', hatesWater: true, teleports: true,
  model: () => { const b = S('#1c1a20', 'noise', null, 0.22); const m = humanoid({ head: S('#1c1a20', 'noise', face(D.art([
      '........',
      '........',
      '........',
      '........',
      'mpm..mpm',
      '.m....m.',
      '........',
      '........'], { m: '#cc3cf0', p: '#f4b8ff' })), 0.22), body: b, arm: b, leg: b }, { thin: true, legH: 28, armH: 28 }); m.anim = 'enderman';
    // Jaw and mouth, hidden inside the head until it opens in anger.
    m.parts.jaw = part([0, 40, 0], [box([-3.9, 0, -3.9], [7.8, 2, 7.8], S('#101010', 'noise', face(D.rect(0.1, 0, 0.8, 0.5, '#e070ff')), 0.1))]);
    m.parts.mouth = part([0, 40, 0], [box([-3.6, 0.2, -3.6], [7.2, 7.4, 7.2], S('#5c1454', 'noise', null, 0.25))]);
    return m; },
});
mob('witch', {
  hw: 0.3, h: 1.95, health: 26, speed: 2.2, kind: 'hostile', ai: 'ranged', attack: { ranged: 'potion', range: 8, cd: 3 }, egg: ['#340000', '#51a03e'], drops: [['glass_bottle', 0, 2], ['glowstone_dust', 0, 2], ['gunpowder', 0, 2], ['redstone', 0, 2], ['spider_eye', 0, 2], ['sugar', 0, 2], ['stick', 0, 2]], xp: [5, 5], sound: 'witch',
  model: () => { const hat = S('#2c2434', 'cloth', null, 0.14); const m = villagerModel('#3e2a4c', { front: D.at(0.46, 1, D.patches('#5a3e6a', 2, 1.2)), all: D.band(0.42, 0.46, '#5a8a2a') }, '#a89a70', '#7a2aa8')(); m.parts.head.boxes[1].style = S('#a89a70', 'noise', { front: D.all(D.band(0.75, 1, '#8a7c58'), D.rect(0.5, 0.5, 0.5, 0.25, '#5a8a2a')) }, 0.06); m.parts.head.boxes.push(box([-5, 10, -5], [10, 2, 10], hat), box([-3.5, 12, -3.5], [7, 4, 7], S('#2c2434', 'cloth', { sides: D.band(0.75, 1, '#5a8a2a'), front: D.band(0.75, 1, '#5a8a2a'), back: D.band(0.75, 1, '#5a8a2a') }, 0.14)), box([-2, 16, -2], [4, 3, 4], hat), box([-1, 19, -1], [2, 2, 2], hat)); return m; },
});
// Slime: a pale see-through-looking shell with the darker core showing inside it, eyes and mouth on the core.
const cube = (col, inner, eyeCol, scale = 1) => () => {
  const core = inner ? D.at(0.125, 0.875, D.all(D.band(0, 1, inner), D.frame(shadeHex(inner, 1.12))), 0.125, 0.875) : null;
  return { anim: 'slime', eye: 6, parts: { body: part([0, 0, 0], [box([-4, 0, -4], [8, 8, 8], S(col, 'slime', { front: D.all(core, D.art([
    '........',
    '........',
    '.kk..kk.',
    '.kl..kl.',
    '........',
    '.....k..',
    '........',
    '........'], { k: eyeCol, l: shadeHex(eyeCol, 1.8) })), sides: core, back: core, caps: core }, 0.1)), ...(inner ? [box([-3, 1, -3], [6, 6, 6], S(inner))] : [])], { scale }) } };
};
mob('slime', { hw: 0.26, h: 0.52, health: 4, speed: 2.5, kind: 'hostile', ai: 'slime', attack: { dmg: 2, cd: 1, touch: true }, egg: ['#51a03e', '#7ebf6e'], drops: [['slime_ball', 0, 2]], xp: [1, 4], sound: 'slime', sizes: true, translucent: true, model: cube('#7ed06a', '#5aae48', '#1e4a18') });
mob('magma_cube', { hw: 0.26, h: 0.52, health: 4, speed: 2.5, kind: 'hostile', ai: 'slime', attack: { dmg: 3, cd: 1, touch: true }, fireImmune: true, egg: ['#340000', '#fcfc00'], drops: [['magma_cream', 0, 1, 0.25]], xp: [1, 4], sound: 'slime', sizes: true, model: () => { const m = cube('#3a1a0a', null, '#ffa020')(); const lava = D.seams('#c8481a', '#f8a030', 3); m.parts.body.boxes[0].style = S('#401a10', 'noise', { all: lava, front: D.all(lava, D.art([
    '........',
    'dddddddd',
    'dyyddyyd',
    'dyrddryd',
    'dddddddd',
    '........',
    '........',
    '........'], { y: '#ffd040', r: '#c82a10', d: '#2a0e08' })) }, 0.2); return m; } });
// Segmented crawlers: lit ridge on top of each segment, dark seam at the back, eyes on the front one.
const bug = (col, n, spot = null) => () => { const parts = {}; const seg = { top: D.all(D.band(0, 0.34, shadeHex(col, 1.18)), D.band(0.67, 1, shadeHex(col, 0.72)), spot && D.spots(spot, 1, 1)), sides: D.all(D.band(0, 0.34, shadeHex(col, 1.12)), D.band(0.67, 1, shadeHex(col, 0.7))) }; for (let i = 0; i < n; i++) parts[`s${i}`] = part([0, 0, -4 + i * 3], [box([-2 + (i === 1 ? -1 : 0), 0, 0], [4 + (i === 1 ? 2 : 0), 3 + (i === 1 ? 1 : 0), 3], S(col, 'metal', i === 0 ? { ...seg, front: eyes({ c: K, pupil: null, y: 0.34, gap: 2, ew: 1 }) } : seg))]); return { anim: 'bug', eye: 2, parts }; };
mob('silverfish', { chase: 4.4, hw: 0.2, h: 0.3, health: 8, speed: 3, kind: 'hostile', ai: 'melee', attack: { dmg: 1, cd: 1 }, egg: ['#6e6e6e', '#303030'], drops: [], xp: [5, 5], sound: 'silverfish', model: bug('#8e9096', 4) });
mob('endermite', { chase: 4.4, hw: 0.2, h: 0.3, health: 8, speed: 3, kind: 'hostile', ai: 'melee', attack: { dmg: 2, cd: 1 }, egg: ['#161616', '#6e6e6e'], drops: [], xp: [3, 3], sound: 'silverfish', model: bug('#342a3e', 4, '#b060e0') });
// Illagers: grey skin, one heavy scowling brow, deep-set eyes and a big nose; `trim` edges the robe (evoker gold).
const illager = (robe, eyeCol = '#1a3a1a', armed = true, trim = null) => () => {
  const skin = '#969c9a', edge = D.all(D.band(0.44, 0.48, shadeHex(robe, 0.55)), D.band(0.93, 1, trim || shadeHex(robe, 0.7)));
  const m = humanoid({ head: S(skin, 'noise', { front: D.all(D.art([
      '........',
      '........',
      '........',
      '.kkkkkk.',
      '.wp..pw.',
      '.1....1.',
      '........',
      '........',
      '..1111..',
      '........'], { k: '#262626', w: '#e8e8e4', p: eyeCol })), top: D.blotch('#7a807e', 0.3) }, 0.07), body: S(robe, 'cloth'), robe: S(robe, 'cloth', { all: edge, front: D.all(edge, trim ? D.at(0, 1, D.band(0, 1, trim), 0.44, 0.56) : D.at(0.05, 0.93, D.stripes(shadeHex(robe, 0.8), 99, true), 0.5, 0.56)) }, 0.1), arm: S(robe, 'cloth', trim ? { all: D.band(0.85, 1, trim) } : null, 0.1), leg: S('#2a2a2c', 'cloth'), nose: S(skin, 'noise', { front: D.band(0.75, 1, '#7a807e'), bottom: D.band(0, 1, '#6a706e') }, 0.07) }, { headH: 10, bodyD: 6, nose: true, robe: true, crossed: !armed });
  if (armed) m.anim = 'zombie';
  return m;
};
mob('pillager', { chase: 3.9, hw: 0.3, h: 1.95, health: 24, speed: 2.4, kind: 'hostile', ai: 'ranged', raider: true, attack: { ranged: 'arrow', range: 16, cd: 2.5, crossbow: true }, egg: ['#532f36', '#959b9b'], drops: [['arrow', 0, 2], ['crossbow', 0, 1, 0.085]], xp: [5, 5], sound: 'illager', holds: 'crossbow', model: illager('#4e3e3a', '#2a2a2a') });
mob('vindicator', { chase: 4.6, hw: 0.3, h: 1.95, health: 24, speed: 2.5, kind: 'hostile', ai: 'melee', raider: true, attack: { dmg: 13, cd: 1.2 }, egg: ['#959b9b', '#275e61'], drops: [['emerald', 0, 1], ['iron_axe', 0, 1, 0.085]], xp: [5, 5], sound: 'illager', holds: 'iron_axe', model: illager('#2e3e44', '#1a4a2a') });
mob('evoker', { hw: 0.3, h: 1.95, health: 24, speed: 2.2, kind: 'hostile', ai: 'ranged', raider: true, attack: { ranged: 'fangs', range: 12, cd: 4 }, egg: ['#959b9b', '#1e1c1a'], drops: [['totem_of_undying', 1, 1], ['emerald', 0, 1]], xp: [10, 10], sound: 'illager', model: illager('#1e1e22', '#1a1a1a', false, '#d8b030') });
mob('ravager', {
  hw: 0.98, h: 2.2, health: 100, speed: 2.5, kind: 'hostile', ai: 'melee', raider: true, attack: { dmg: 12, cd: 2, fling: 1 }, egg: ['#757470', '#5b5049'], drops: [['saddle', 1, 1]], xp: [20, 20], sound: 'ravager', breaksLeaves: true, knockbackResist: 0.75,
  model: () => { const hide = '#5e5852'; const m = quadruped({ body: S(hide, 'fur', { top: D.stripes('#48433e', 3, true), bottom: D.blotch('#4a4540', 0.5) }), head: S(hide, 'fur', face(D.art([
      '..........',
      '..........',
      '.kkk..kkk.',
      '.wk....kw.',
      '..........',
      '...1111...',
      '..kkkkkk..',
      '..kwkkwk..',
      '..kkkkkk..',
      '..........'], { k: '#1e1c1a', w: '#e8e4d8' }))), leg: S('#4a4540', 'fur', { all: D.band(0.88, 1, '#2e2a26') }) }, { legH: 16, legW: 8, bodyW: 14, bodyH: 16, bodyL: 22, headW: 16, headH: 16, headL: 14, neckUp: 4 }); const horn = S('#4a4642', 'noise', { all: D.stripes('#3a3632', 3) }, 0.1); m.parts.head.boxes.push(box([-10, 4, -6], [2, 12, 2], horn), box([8, 4, -6], [2, 12, 2], horn)); return m; },
});
mob('blaze', {
  hw: 0.3, h: 1.8, health: 20, speed: 2.3, kind: 'hostile', ai: 'blaze', flying: true, fireImmune: true, attack: { ranged: 'small_fireball', range: 16, cd: 3, burst: 3 }, egg: ['#f6b201', '#fff87e'], drops: [['blaze_rod', 0, 1]], xp: [10, 10], sound: 'blaze', glow: true, hurtByWater: true,
  model: () => { const parts = { head: part([0, 20, 0], [box([-4, 0, -4], [8, 8, 8], S('#f4c030', 'mottled', { front: D.all(D.blotch('#c8781a', 0.25), D.art([
      '........',
      '........',
      '........',
      '.bbbbbb.',
      '.kk..kk.',
      '........',
      '..bbbb..',
      '........'], { k: '#2a1206', b: '#9a4a0a' })), all: D.blotch('#c8781a', 0.25) }, 0.14))]) }; for (let i = 0; i < 12; i++) parts[`rod${i}`] = part([0, 0, 0], [box([-1, 0, -1], [2, 8, 2], S('#eca824', 'rod', { caps: D.band(0, 1, '#fce070') }, 0.16))]); return { anim: 'blaze', eye: 24, parts }; },
});
mob('ghast', {
  hw: 2, h: 4, health: 10, speed: 2.5, kind: 'hostile', ai: 'ghast', flying: true, fireImmune: true, attack: { ranged: 'fireball', range: 48, cd: 3.5 }, egg: ['#f9f9f9', '#bcbcbc'], drops: [['ghast_tear', 0, 1], ['gunpowder', 0, 2]], xp: [5, 5], sound: 'ghast', scale: 4,
  model: () => { const parts = { body: part([0, 4, 0], [box([-8, 0, -8], [16, 16, 16], S('#f0f0ee', 'noise', { front: D.art([
      '................',
      '................',
      '................',
      '................',
      '................',
      '..gkkg....gkkg..',
      '...r........r...',
      '...r........r...',
      '................',
      '................',
      '.....gkkkkg.....',
      '.....kkkkkk.....',
      '......kkkk......',
      '................',
      '................',
      '................'], { k: '#2e2e2e', g: '#8a8a8a', r: '#c83a3a' }), all: D.blotch('#dcdcd8', 0.2) }, 0.05))]) }; for (let i = 0; i < 9; i++) parts[`t${i}`] = part([-5 + (i % 3) * 5, 4, -5 + Math.floor(i / 3) * 5], [box([-1, -8 - (i * 7) % 5, -1], [2, 8 + (i * 7) % 5, 2], S('#e8e8e6', 'noise', { all: D.stripes('#d4d4d0', 4) }, 0.05))]); return { anim: 'ghast', eye: 14, parts }; },
});
// Piglin: wide pink head with a snout plate, small tusks and droopy ears; leather tunic with a gold belt, gold armbands.
const piglinModel = gold => () => { const skin = '#e4a08e', ear = S('#dc907e', 'noise', { sides: D.ragged(0.6, 1, '#b8705e') }, 0.08); const m = humanoid({ head: S(skin, 'noise', { front: D.all(D.brow('#b87060', 0.25, 1), eyes({ c: '#f4f0e8', pupil: '#3a2a1a', y: 0.375, gap: 4 }), D.art(['..........', '..........', '..........', '..........', '..........', '..........', '.w......w.', '.w......w.'], { w: '#f2ecdc' })), top: D.blotch('#c88070', 0.25) }, 0.08), body: S('#7a5234', 'cloth', { all: D.all(D.band(0.72, 0.82, gold), D.ragged(0, 0.12, '#5a3a22')), front: D.all(D.band(0.72, 0.82, gold), D.at(0.72, 0.82, D.band(0, 1, '#a07818'), 0.375, 0.625), D.bar('#5a3a22', 0, 4)) }), arm: S(skin, 'noise', { all: D.band(0.55, 0.68, gold), top: D.band(0, 1, '#7a5234') }, 0.08), leg: S('#5e4028', 'cloth', { all: D.band(0.8, 1, '#3a2818') }) }); m.parts.head.boxes[0].s = [10, 8, 8]; m.parts.head.boxes[0].o = [-5, 0, -4]; m.parts.head.boxes.push(box([-2, 0, -5], [4, 4, 1], S('#eeaca0', 'noise', { front: D.snout('#7a3a3a') }, 0.06)), box([-6, 4, -1], [1, 5, 4], ear), box([5, 4, -1], [1, 5, 4], ear)); m.anim = 'zombie'; return m; };
mob('piglin', { chase: 4.5, hw: 0.3, h: 1.95, health: 16, speed: 2.5, kind: 'hostile', ai: 'melee', attack: { dmg: 5, cd: 1 }, goldCalm: true, barters: true, egg: ['#995f40', '#f9f3a4'], drops: [['gold_ingot', 0, 1, 0.08]], xp: [5, 5], sound: 'piglin', holds: 'golden_sword', model: piglinModel('#e0b020') });
mob('hoglin', { chase: 4.6,
  hw: 0.7, h: 1.4, health: 40, speed: 2.5, kind: 'hostile', ai: 'melee', attack: { dmg: 6, cd: 1.2, fling: 0.6 }, egg: ['#c66e55', '#5f6464'], drops: [['porkchop', 2, 4], ['leather', 0, 1]], cooked: { porkchop: 'cooked_porkchop' }, xp: [5, 5], sound: 'hoglin',
  model: () => { const hide = '#c07656', mane = '#e8c89a'; const m = quadruped({ body: S(hide, 'fur', { top: D.at(0, 1, D.all(D.band(0, 1, mane), D.stripes('#c8a070', 2, true)), 0.3, 0.7), front: D.ragged(0, 0.3, mane), back: D.blotch('#a06048', 0.3) }), head: S(hide, 'fur', { front: D.all(D.at(0.2, 1, D.band(0, 1, '#d89a82'), 0.2, 0.8), D.at(0.2, 1, D.snout('#5a2a22'), 0.2, 0.8)), sides: D.sideEye({ c: K, pupil: '#f0e0d0', y: 0.2, from: 2, ew: 2 }), top: D.blotch('#a06048', 0.3) }), leg: S('#a86a4a', 'fur', { all: D.band(0.85, 1, '#4a3024') }) }, { legH: 11, legW: 6, bodyW: 16, bodyH: 14, bodyL: 19, headW: 14, headH: 6, headL: 19 }); const tusk = S('#f0e8d0', 'noise', { all: D.band(0, 0.3, '#c8bca0') }, 0.06); m.parts.head.boxes.push(box([-8, -1, -18], [2, 6, 2], tusk), box([6, -1, -18], [2, 6, 2], tusk)); return m; },
});

// --- the wither ---
mob('wither', {
  hw: 0.45, h: 3.2, scale: 1.35, health: 300, speed: 5, kind: 'boss', ai: 'wither', flying: true, fireImmune: true, undead: true, knockbackResist: 1,
  attack: { dmg: 8, cd: 1, wither: 10 }, egg: ['#141414', '#4a4a4a'], drops: [['nether_star', 1, 1]], xp: [50, 50], sound: 'wither', noEgg: true, bossColor: '#b44cf0',
  model: () => {
    const bone = S('#323234', 'bone', { all: D.stripes('#222224', 3) }, 0.16);
    const eyes2 = f => S('#2e2e30', 'bone', face(D.art([
      '........',
      '........',
      '........',
      '.kk..kk.',
      '.ww..ww.',
      '...kk...',
      '.kgkkgk.',
      '..kkkk..'], { k: '#0a0a0c', w: '#e8eef0', g: '#8a8a8a' })), 0.16);
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
  hw: 4, h: 4, health: 200, speed: 12, kind: 'boss', ai: 'dragon', flying: true, fireImmune: true, attack: { dmg: 10, cd: 1 }, egg: ['#1a1a1a', '#e070ff'], drops: [], sound: 'dragon', knockbackResist: 1, noEgg: true,
  model: () => {
    const sc = S('#221c28', 'scales', { top: D.stripes('#3a3044', 4, true) }, 0.2), belly = S('#2e2834', 'noise', null, 0.15);
    const parts = {
      body: part([0, 20, 0], [box([-12, 0, -32], [24, 24, 64], sc), box([-1, 24, -26], [2, 6, 12], S('#5a5060')), box([-1, 24, -6], [2, 6, 12], S('#5a5060')), box([-1, 24, 14], [2, 6, 12], S('#5a5060'))]),
      head: part([0, 30, -80], [box([-8, -4, -16], [16, 16, 16], S('#221c28', 'scales', face(D.art(['........', '.mp..pm.', '........', '........'], { m: '#c040f0', p: '#f0b0ff' })), 0.2)), box([-6, -4, -32], [12, 5, 16], S('#221c28', 'scales', { front: D.snout('#0a080c'), top: D.art(['......', '.k..k.', '......'], { k: '#0a080c' }) }, 0.2)), box([-5, 12, -10], [2, 4, 6], S('#5a5060')), box([3, 12, -10], [2, 4, 6], S('#5a5060'))]),
      jaw: part([0, 26, -96], [box([-6, -4, -16], [12, 4, 16], belly)], { parent: null }),
      wingR: part([12, 38, -20], [box([0, -4, -4], [56, 8, 8], sc), box([0, 0, 4], [56, 0.5, 56], S('#34303c', 'membrane', null, 0.18))]),
      wingL: part([-12, 38, -20], [box([-56, -4, -4], [56, 8, 8], sc), box([-56, 0, 4], [56, 0.5, 56], S('#34303c', 'membrane', null, 0.18))]),
      leg0: part([10, 24, -24], [box([-4, -24, -4], [8, 24, 8], sc)]), leg1: part([-10, 24, -24], [box([-4, -24, -4], [8, 24, 8], sc)]),
      leg2: part([12, 24, 20], [box([-5, -26, -5], [10, 26, 10], sc)]), leg3: part([-12, 24, 20], [box([-5, -26, -5], [10, 26, 10], sc)]),
    };
    for (let i = 0; i < 5; i++) parts[`neck${i}`] = part([0, 30, -32 - i * 10], [box([-5, -5, -10], [10, 10, 10], sc)]);
    for (let i = 0; i < 12; i++) parts[`tail${i}`] = part([0, 30, 32 + i * 10], [box([-5, -5, 0], [10, 10, 10], sc)]);
    delete parts.jaw;
    return { anim: 'dragon', eye: 36, parts };
  },
});

MOBS.villager.professionModel = prof => villagerModel(PROFESSION_COLORS[prof] || '#6a4a3a', PROF_DECOR[prof] || null)();

// The player's own model (first-person arm and third-person view).
// The four default player skins players pick from in Multiplayer: [name, skin tone, hair,
// hair length (0 short .. 1 long), eye colour, shirt, trousers, shoes].
export const PLAYER_SKINS = [
  ['Classic', '#c8926a', '#3a2412', 0.25, '#3a4ab8', '#2aa8a8', '#3a3aa8', '#5a5a5a'],
  ['Ranger', '#eac19a', '#c8621e', 0.9, '#3a8a3a', '#5a9a3a', '#6a4a2a', '#3a2a1a'],
  ['Ember', '#8a5a3a', '#1a1414', 0.3, '#4a2a14', '#c83a3a', '#2a2a2e', '#e8e8e8'],
  ['Frost', '#f0cfb0', '#e8d890', 0.55, '#3aa8d8', '#7a4ab8', '#8a8a92', '#3a3a44'],
];
export function playerModel(v = 0) {
  const [, skin, hair, len, eye, shirt, pants, shoes] = PLAYER_SKINS[v] || PLAYER_SKINS[0];
  // Hair: a ragged fringe over the brow, locks down the sides (longer hair frames the face), full back and crown.
  const hairFx = fn => (p, x, y, w, h, f, st) => fn(p, x, y, w, h, f, { pal: [shadeHex(hair, 0.7), shadeHex(hair, 0.85), hair, shadeHex(hair, 1.15)] });
  const locks = hairFx(D.all(D.band(0, 0.3 + len * 0.55, hair), D.blotch(shadeHex(hair, 0.82), 0.3)));
  const m = humanoid({
    head: S(skin, 'noise', {
      front: D.all(D.ragged(0, 0.2, hair), len > 0.5 ? D.at(0, 0.5 + len * 0.3, D.band(0, 1, hair), 0, 0.125) : null, len > 0.5 ? D.at(0, 0.5 + len * 0.3, D.band(0, 1, hair), 0.875, 1) : null,
        eyes({ c: '#f8f8f8', pupil: eye, y: 0.5, gap: 2 }), D.bar(shadeHex(skin, 0.86), 0.625, 2), D.bar(shadeHex(skin, 0.62), 0.78, 2), D.bar(shadeHex(skin, 0.8), 0.78, 4)),
      top: hairFx(D.all(D.band(0, 1, hair), D.blotch(shadeHex(hair, 1.15), 0.25))), right: locks, left: locks, back: hairFx(D.all(D.band(0, 0.7 + len * 0.3, hair), D.blotch(shadeHex(hair, 0.82), 0.3))),
    }, 0.06),
    body: S(shirt, 'cloth', { front: D.all(D.bar(skin, 0, 2), D.band(0.9, 1, shadeHex(shirt, 0.78))), all: D.band(0.9, 1, shadeHex(shirt, 0.78)) }, 0.08),
    arm: S(skin, 'noise', { all: D.all(D.band(0, 0.34, shirt), D.band(0.34, 0.4, shadeHex(shirt, 0.8))), top: D.band(0, 1, shirt) }, 0.06),
    leg: S(pants, 'cloth', { all: D.band(0.84, 1, shoes), top: D.band(0, 1, shadeHex(pants, 0.85)), bottom: D.band(0, 1, shadeHex(shoes, 0.8)) }, 0.08),
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

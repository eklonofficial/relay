// Worn-armor models: inflated boxes that share part names and pivots with the humanoid body,
// so they follow every pose (walking, swinging, sneaking) automatically. One painted skin per
// material and piece; `thin` matches skeleton-style limbs.
import { D, pal } from '../render/mobtex.js?v=mupq37b9';

export const ARMOR_MATERIALS = {
  leather: { c: '#8e5a34', pattern: 'noise', trim: '#6a4024' },
  chainmail: { c: '#a4a6ae', pattern: 'scales', trim: '#6e7078' },
  iron: { c: '#d6d6d6', pattern: 'noise', trim: '#9a9a9a' },
  golden: { c: '#f2cc3a', pattern: 'noise', trim: '#c89a1c' },
  diamond: { c: '#4ee2d4', pattern: 'noise', trim: '#1e9e96' },
  netherite: { c: '#4d4649', pattern: 'noise', trim: '#312c2e' },
  turtle: { c: '#4aa246', pattern: 'scales', trim: '#2e6a2c' },
};
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];

const box = (o, s, style, extra = {}) => ({ o, s, style, ...extra });
const part = (pivot, boxes) => ({ pivot, boxes });
// Transparent pixels (visor opening, open bottoms).
const clear = (rx, ry, rw, rh) => (p, x, y, w, h) => p.rect(x + Math.floor(rx * w), y + Math.floor(ry * h), Math.max(1, Math.round(rw * w)), Math.max(1, Math.round(rh * h)), '#000000', 0);
const clearAll = (p, x, y, w, h) => p.rect(x, y, w, h, '#000000', 0);

export function armorModel(material, piece, thin = false) {
  const m = ARMOR_MATERIALS[material] || ARMOR_MATERIALS.iron;
  const st = decor => ({ pal: pal(m.c, 0.1), pattern: m.pattern, decor });
  const limb = thin ? 2 : 4, armX = thin ? 5 : 6, legX = 2;
  const edge = D.frame(m.trim);
  const parts = {};
  switch (piece) {
    case 'helmet':
      parts.head = part([0, 24, 0], [box([-4, 0, -4], [8, 8, 8], st({ front: D.all(edge, clear(0.125, 0.45, 0.75, 0.55)), all: edge, bottom: clearAll }), { inflate: 1 })]);
      break;
    case 'chestplate':
      parts.body = part([0, 12, 0], [box([-4, 0, -2], [8, 12, 4], st({ all: edge, top: clear(0.25, 0.25, 0.5, 0.5), bottom: clearAll }), { inflate: 1 })]);
      parts.rightArm = part([armX, 22, 0], [box([-limb / 2, -6, -limb / 2], [limb, 8, limb], st({ all: D.band(0.85, 1, m.trim), bottom: clearAll }), { inflate: 1 })]);
      parts.leftArm = part([-armX, 22, 0], [box([-limb / 2, -6, -limb / 2], [limb, 8, limb], st({ all: D.band(0.85, 1, m.trim), bottom: clearAll }), { inflate: 1, mirror: true })]);
      break;
    case 'leggings':
      parts.body = part([0, 12, 0], [box([-4, 0, -2], [8, 4, 4], st({ all: D.band(0, 0.3, m.trim), top: clearAll }), { inflate: 0.5 })]);
      parts.rightLeg = part([legX, 12, 0], [box([-limb / 2, -9, -limb / 2], [limb, 9, limb], st({ bottom: clearAll }), { inflate: 0.5 })]);
      parts.leftLeg = part([-legX, 12, 0], [box([-limb / 2, -9, -limb / 2], [limb, 9, limb], st({ bottom: clearAll }), { inflate: 0.5, mirror: true })]);
      break;
    case 'boots':
      parts.rightLeg = part([legX, 12, 0], [box([-limb / 2, -12, -limb / 2], [limb, 5, limb], st({ all: D.band(0, 0.25, m.trim), top: clearAll }), { inflate: 1 })]);
      parts.leftLeg = part([-legX, 12, 0], [box([-limb / 2, -12, -limb / 2], [limb, 5, limb], st({ all: D.band(0, 0.25, m.trim), top: clearAll }), { inflate: 1, mirror: true })]);
      break;
  }
  return { anim: 'biped', parts, eye: 0 };
}

// Elytra wings hang from the shoulders; pose them with wingL / wingR.
export function elytraModel() {
  const mem = { pal: pal('#6a6a90', 0.14), pattern: 'noise', decor: { all: D.all(D.stripes('#4a4a6a', 3, true), D.frame('#3a3a52')) } };
  return { anim: 'biped', eye: 0, parts: {
    wingL: { pivot: [-5, 24, 2], boxes: [{ o: [-5, -20, 0], s: [10, 20, 2], style: mem }] },
    wingR: { pivot: [5, 24, 2], boxes: [{ o: [-5, -20, 0], s: [10, 20, 2], style: mem, mirror: true }] },
  } };
}

// Skin key for a worn stack (null for things that are not drawn as armor, like elytra or a pumpkin).
export function armorSkinKey(itemKey, thin = false) {
  const m = /^(leather|chainmail|iron|golden|diamond|netherite|turtle)_(helmet|chestplate|leggings|boots)$/.exec(itemKey);
  return m ? `armor_${m[1]}_${m[2]}${thin ? '_thin' : ''}` : null;
}

// Worn armor as Java draws it (HumanoidArmorLayer): two layers per material on Java's armor model
// (entity/humanoid.js). Layer 1 (the helmet, chestplate and boots) sits 1 px out from the body,
// layer 2 (the leggings) half a pixel; each is one 64x32 texture in Java's layout, so a resource
// pack's textures/models/armor/<material>_layer_<n>.png replaces it directly. Without a pack the
// layers are painted here, clear wherever the real textures are clear.
import { D, pal } from '../render/mobtex.js?v=musmw2di';
import { armorModel as javaArmorModel, armorHide } from '../entity/humanoid.js?v=musmw2di';

export const ARMOR_MATERIALS = {
  leather: { c: '#a06540', pattern: 'noise', trim: '#7a4a2c' },
  chainmail: { c: '#a4a6ae', pattern: 'scales', trim: '#6e7078' },
  iron: { c: '#d6d6d6', pattern: 'noise', trim: '#9a9a9a' },
  golden: { c: '#f2cc3a', pattern: 'noise', trim: '#c89a1c' },
  diamond: { c: '#4ee2d4', pattern: 'noise', trim: '#1e9e96' },
  netherite: { c: '#4d4649', pattern: 'noise', trim: '#312c2e' },
  turtle: { c: '#4aa246', pattern: 'scales', trim: '#2e6a2c' },
};
export const ARMOR_PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
// Java's default leather colour (DyeableLeatherItem.DEFAULT_LEATHER_COLOR), which tints the
// greyscale leather layers of a pack.
export const LEATHER_COLOR = [0xa0, 0x65, 0x40];

// Transparent pixels: a share of a face (rows or a rectangle), or the whole face.
const clear = (rx, ry, rw, rh) => (p, x, y, w, h) => p.rect(x + Math.floor(rx * w), y + Math.floor(ry * h), Math.max(1, Math.round(rw * w)), Math.max(1, Math.round(rh * h)), '#000000', 0);
const clearAll = (p, x, y, w, h) => p.rect(x, y, w, h, '#000000', 0);
const rows = (from, to) => clear(0, from, 1, to - from);

// The painted layers of one material: layer 1 (helmet head, chestplate body and shoulders, boots)
// and layer 2 (leggings: the belt and legs). Left limbs share the right ones' pixels, as in Java.
export function armorLayerModel(material, layer) {
  const m = ARMOR_MATERIALS[material] || ARMOR_MATERIALS.iron;
  const st = decor => ({ pal: pal(m.c, 0.1), pattern: m.pattern, decor });
  const edge = D.frame(m.trim);
  if (layer === 1) return javaArmorModel(false, {
    head: st({ front: D.all(edge, clear(0.125, 0.45, 0.75, 0.55)), all: edge, bottom: clearAll }),
    body: st({ all: edge, top: clear(0.25, 0.25, 0.5, 0.5), bottom: clearAll }),
    arm: st({ all: D.all(D.band(0.35, 0.45, m.trim), rows(0.45, 1)), top: edge, bottom: clearAll }),
    leg: st({ all: D.all(rows(0, 0.6), D.band(0.6, 0.7, m.trim)), top: clearAll, bottom: edge }),
  });
  return javaArmorModel(true, {
    body: st({ all: D.all(rows(0, 0.67), D.band(0.67, 0.78, m.trim)), top: clearAll, bottom: clearAll }),
    leg: st({ all: rows(0.75, 1), top: clearAll, bottom: clearAll }),
  });
}

// Which layer a worn item draws and the parts it shows: { skin, model, hide } (null for things that
// are not drawn as armor, like elytra or a pumpkin).
export function armorLayer(itemKey) {
  const m = /^(leather|chainmail|iron|golden|diamond|netherite|turtle)_(helmet|chestplate|leggings|boots)$/.exec(itemKey);
  if (!m) return null;
  const slot = ARMOR_PIECES.indexOf(m[2]), inner = slot === 2;
  return { skin: `armor_${m[1]}_${inner ? 2 : 1}`, model: inner ? 'armor_inner' : 'armor_outer', hide: armorHide(slot) };
}

// Elytra wings hang from the shoulders; pose them with wingL / wingR.
export function elytraModel() {
  // The vanilla elytra: a pale grey-violet membrane with darker ribs and a dark rim.
  const mem = { pal: pal('#8e8ea6', 0.12), pattern: 'noise', decor: { all: D.all(D.stripes('#6c6c86', 3, true), D.frame('#4e4e64')) } };
  return { anim: 'biped', eye: 0, parts: {
    // ElytraModel: each wing a 10x20x2 box (inflated by 1) hanging from the neck, hinged at the
    // outer edge of the back so spreading swings it out to its own side.
    wingL: { pivot: [-5, 24, 2], boxes: [{ o: [0, -20, 0], s: [10, 20, 2], inflate: 1, style: mem }] },
    wingR: { pivot: [5, 24, 2], boxes: [{ o: [-10, -20, 0], s: [10, 20, 2], inflate: 1, style: mem, mirror: true }] },
  } };
}

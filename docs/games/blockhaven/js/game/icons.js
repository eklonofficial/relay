// Inventory icons as data URLs: isometric cubes for blocks, crisp sprites for items.
import { ITEMS } from '../data/items.js?v=muo4kot4';
import { FACE_TEX, VARIANT_MASK, TINT_OF, TINT, SHAPE_OF, SHAPE, TRANSLUCENT } from '../data/blocks.js?v=muo4kot4';
import { ITEM_LAYER } from '../render/itemtex.js?v=muo4kot4';

const TINTS = { [TINT.GRASS]: [124, 189, 107], [TINT.FOLIAGE]: [72, 181, 24], [TINT.WATER]: [63, 118, 228] };

function faceCanvas(data, tint, shade) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(16, 16);
  for (let i = 0; i < 256; i++) {
    let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a === 254 && tint) { r = r * tint[0] / 255; g = g * tint[1] / 255; b = b * tint[2] / 255; a = 255; }
    img.data[i * 4] = r * shade; img.data[i * 4 + 1] = g * shade; img.data[i * 4 + 2] = b * shade; img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function buildIcons(blockTex, itemTex) {
  const icons = {};
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  for (const it of ITEMS) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = false;
    if (it.block && !it.flat) {
      const [id, meta] = it.block;
      const k = ((id << 4) | (meta & VARIANT_MASK[id])) * 7;
      const tint = TINTS[TINT_OF[id]];
      const top = faceCanvas(blockTex[FACE_TEX[k + 2]], tint, 1);
      const left = faceCanvas(blockTex[FACE_TEX[k + 6] ?? FACE_TEX[k + 4]], tint, 0.78);
      const right = faceCanvas(blockTex[FACE_TEX[k]], tint, 0.6);
      const shape = SHAPE_OF[id];
      const hFrac = shape === SHAPE.SLAB ? 0.5 : shape === SHAPE.CARPET ? 0.08 : shape === SHAPE.SNOW ? 0.14 : shape === SHAPE.FARMLAND ? 0.94 : shape === SHAPE.TRAPDOOR ? 0.2 : 1;
      if (TRANSLUCENT[id]) ctx.globalAlpha = 0.85;
      // Unit cube corners in screen space: half-width w, rise r, height h.
      const w = S * 0.43, r = S * 0.25, h = S * 0.5 * hFrac, cx = S / 2, top0 = S * 0.06 + (S * 0.5 - h);
      // top face: maps (0,0)->(cx, top0), (16,0)->(cx+w, top0+r), (0,16)->(cx-w, top0+r)
      ctx.setTransform(w / 16, r / 16, -w / 16, r / 16, cx, top0);
      ctx.drawImage(top, 0, 0);
      // left face: (0,0)->(cx-w, top0+r), (16,0)->(cx, top0+2r), (0,16)->(cx-w, top0+r+h)
      ctx.setTransform(w / 16, r / 16, 0, h / 16, cx - w, top0 + r);
      ctx.drawImage(left, 0, 16 * (1 - hFrac), 16, 16 * hFrac, 0, 0, 16, 16);
      // right face: (0,0)->(cx, top0+2r), (16,0)->(cx+w, top0+r)
      ctx.setTransform(w / 16, -r / 16, 0, h / 16, cx, top0 + 2 * r);
      ctx.drawImage(right, 0, 16 * (1 - hFrac), 16, 16 * hFrac, 0, 0, 16, 16);
      ctx.globalAlpha = 1;
    } else {
      const layer = ITEM_LAYER[it.key];
      if (layer === undefined) continue;
      const c = faceCanvas(itemTex[layer], null, 1);
      ctx.setTransform(S / 16, 0, 0, S / 16, 0, 0);
      ctx.drawImage(c, 0, 0);
    }
    icons[it.key] = canvas.toDataURL();
  }
  return icons;
}

// Small pixel-art HUD sprites (hearts, food, armor, bubbles) as data URLs.
export function hudSprites() {
  const draw = (rows, pal) => {
    const c = document.createElement('canvas');
    c.width = c.height = 9;
    const ctx = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) { ctx.fillStyle = pal[ch]; ctx.fillRect(x, y, 1, 1); } }));
    return c.toDataURL();
  };
  const heart = ['.kk...kk.', 'krrk.krrk', 'krwrkrrrk', 'krrrrrrrk', 'krrrrrrrk', '.krrrrrk.', '..krrrk..', '...krk...', '....k....'];
  const half = ['.kk...kk.', 'krrk.k..k', 'krwrk...k', 'krrrr...k', 'krrrr...k', '.krrr..k.', '..krr.k..', '...krk...', '....k....'];
  const empty = ['.kk...kk.', 'k..k.k..k', 'k...k...k', 'k.......k', 'k.......k', '.k.....k.', '..k...k..', '...k.k...', '....k....'];
  const food = ['.....kk..', '....kbbk.', '...kbwbk.', '..kmmbbk.', '.kmmmmk..', 'kmmmmmk..', 'kmmmmk...', '.kkkk....', '.........'];
  const foodHalf = ['.....kk..', '....k..k.', '...k...k.', '..kmm..k.', '.kmmm.k..', 'kmmmm.k..', 'kmmmk....', '.kkkk....', '.........'];
  const foodEmpty = ['.....kk..', '....k..k.', '...k...k.', '..k....k.', '.k....k..', 'k.....k..', 'k....k...', '.kkkk....', '.........'];
  const armor = ['.kkk.kkk.', 'kaaakaaak', 'kaawaaaak', 'kaaaaaaak', '.kaaaaak.', '.kaaaaak.', '.kaaaaak.', '..kkkkk..', '.........'];
  const armorHalf = ['.kkk.kkk.', 'kaaak...k', 'kaawk...k', 'kaaak...k', '.kaak..k.', '.kaak..k.', '.kaak..k.', '..kkkkk..', '.........'];
  const armorEmpty = ['.kkk.kkk.', 'k...k...k', 'k.......k', 'k.......k', '.k.....k.', '.k.....k.', '.k.....k.', '..kkkkk..', '.........'];
  const bubble = ['..kkkk...', '.kbbbbk..', 'kbwbbbbk.', 'kbbbbbbk.', 'kbbbbbbk.', 'kbbbbbbk.', '.kbbbbk..', '..kkkk...', '.........'];
  const P = { k: '#1a1a1a', r: '#e02020', w: '#ff9a9a', b: '#a86a3a', m: '#c8864a', a: '#c8c8c8' };
  return {
    heart: draw(heart, P), heartHalf: draw(half, P), heartEmpty: draw(empty, { k: '#1a1a1a', '.': null }),
    heartPoison: draw(heart, { ...P, r: '#8a9a2a', w: '#c8d86a' }), heartWither: draw(heart, { ...P, r: '#2a2a2a', w: '#5a5a5a' }),
    heartGold: draw(heart, { ...P, r: '#e8b820', w: '#fff080' }),
    food: draw(food, { ...P, w: '#ffffff' }), foodHalf: draw(foodHalf, P), foodEmpty: draw(foodEmpty, P),
    foodHunger: draw(food, { ...P, m: '#6a8a2a', b: '#4a6a1a' }),
    armor: draw(armor, { ...P, w: '#ffffff' }), armorHalf: draw(armorHalf, P), armorEmpty: draw(armorEmpty, P),
    bubble: draw(bubble, { k: '#1a3a7a', b: '#4a8ae8', w: '#ffffff' }),
  };
}

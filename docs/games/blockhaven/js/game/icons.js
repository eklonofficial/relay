// Inventory icons as data URLs: isometric cubes for blocks, crisp sprites for items.
import { ITEMS } from '../data/items.js?v=musmwdx0';
import { FACE_TEX, VARIANT_MASK, TINT_OF, TINT, SHAPE_OF, SHAPE, TRANSLUCENT } from '../data/blocks.js?v=musmwdx0';
import { ITEM_LAYER, FX_LAYER } from '../render/itemtex.js?v=musmwdx0';
import { ANVIL_BOXES } from '../data/shapes.js?v=musmwdx0';

// Several boxes (in block pixels) drawn in the same isometric view as the cube icons, bottom first.
// The top face of the highest box uses the block's top texture; every other face uses the sides.
function isoBoxes(ctx, S, boxes, top, left, right, sideTop) {
  const w = S * 0.43, r = S * 0.25, hp = S * 0.5 / 16, cx = S / 2, base = S * 0.06;
  const P = (x, y, z) => [cx + (x - z) * w / 16, base + (x + z) * r / 16 + (16 - y) * hp];
  boxes.forEach((b, n) => {
    const [x0, y0, z0, x1, y1, z1] = b, dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    let o = P(x0, y1, z0);
    ctx.setTransform(w / 16, r / 16, -w / 16, r / 16, o[0], o[1]);
    ctx.drawImage(n === boxes.length - 1 ? top : sideTop, x0, z0, dx, dz, 0, 0, dx, dz);
    o = P(x0, y1, z1);
    ctx.setTransform(w / 16, r / 16, 0, hp, o[0], o[1]);
    ctx.drawImage(left, x0, 16 - y1, dx, dy, 0, 0, dx, dy);
    o = P(x1, y1, z1);
    ctx.setTransform(w / 16, -r / 16, 0, hp, o[0], o[1]);
    ctx.drawImage(right, 16 - z1, 16 - y1, dz, dy, 0, 0, dz, dy);
  });
}

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
      const hFrac = shape === SHAPE.SLAB ? 0.5 : shape === SHAPE.CARPET ? 0.08 : shape === SHAPE.SNOW ? 0.14 : shape === SHAPE.FARMLAND ? 0.94 : shape === SHAPE.TRAPDOOR ? 0.2 : shape === SHAPE.PLATE ? 0.07 : shape === SHAPE.BUTTON ? 0.2 : shape === SHAPE.DAYLIGHT ? 0.375 : shape === SHAPE.ENCHANTER ? 0.75 : 1;
      if (shape === SHAPE.ANVIL) { isoBoxes(ctx, S, ANVIL_BOXES, top, left, right, faceCanvas(blockTex[FACE_TEX[k]], tint, 1)); icons[it.key] = canvas.toDataURL(); continue; }
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
  // Item states shown in slots (a loaded crossbow).
  for (const name of ['crossbow_arrow', 'crossbow_firework']) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, S, S);
    const c = faceCanvas(itemTex[FX_LAYER[name]], null, 1);
    ctx.setTransform(S / 16, 0, 0, S / 16, 0, 0); ctx.drawImage(c, 0, 0);
    icons[name] = canvas.toDataURL();
  }
  return icons;
}

// Small pixel-art HUD sprites (hearts, food, armor, bubbles) as data URLs, 9x9 like the original's.
// Hearts are layered like Minecraft's: a container (outline + dark inside) under a full or left-half heart.
export function hudSprites() {
  const draw = (rows, pal) => {
    const c = document.createElement('canvas');
    c.width = c.height = 9;
    const ctx = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) { ctx.fillStyle = pal[ch]; ctx.fillRect(x, y, 1, 1); } }));
    return c.toDataURL();
  };
  const container = ['.KKK.KKK.', 'KcccKcccK', 'KcccccccK', 'KcccccccK', '.KcccccK.', '..KcccK..', '...KcK...', '....K....', '.........'];
  const heart = ['.KKK.KKK.', 'KrwrKrrrK', 'KwrrrrrdK', 'KrrrrrrdK', '.KrrrrdK.', '..KrrdK..', '...KdK...', '....K....', '.........'];
  const half = heart.map(r => r.slice(0, 5) + '....');
  const food = ['......kk.', '.....kwwk', '....kbwk.', '..kkkbk..', '.kmhmkk..', 'kmhmmmk..', 'kmmmmmk..', 'kmmmmk...', '.kkkk....'];
  const armor = ['.kkk.kkk.', 'kaaakaaak', 'kawaaaaak', 'kaaaaaaak', '.kaaaaak.', '.kaaaaak.', '.kaaaaak.', '..kkkkk..', '.........'];
  const empty = (rows, from = 0) => rows.map(r => [...r].map((ch, x) => x >= from && ch !== 'k' && ch !== '.' ? 'c' : ch).join(''));
  const foodHalf = empty(food, 4), foodEmpty = empty(food), armorHalf = empty(armor, 5), armorEmpty = empty(armor);
  const bubble = ['..kkkk...', '.kbbbbk..', 'kbwbbbbk.', 'kbwbbbbk.', 'kbbbbbdk.', 'kbbbbddk.', '.kbddddk.', '..kkkk...', '.........'];
  const K = '#000000', dim = 'rgba(0,0,0,0.42)';
  const H = (r, w, d) => ({ K, r, w, d });
  const red = H('#ff1313', '#ffffff', '#bb0f0f'), poison = H('#94a31a', '#dde07a', '#6a7410'), wither = H('#2b2b2b', '#6a6a6a', '#141414');
  const gold = H('#f2c91a', '#fff7a0', '#c49a0c'), white = H('#ffffff', '#ffffff', '#dcdcdc');
  const P = { k: K, c: dim, b: '#d8d0bc', w: '#ffffff', m: '#b4622a', h: '#e08c4a', a: '#dcdcdc' };
  return {
    heartEmpty: draw(container, { K, c: dim }), heartBlink: draw(container, { K: '#ffffff', c: dim }),
    heart: draw(heart, red), heartHalf: draw(half, red), heartWhite: draw(heart, white), heartWhiteHalf: draw(half, white),
    heartPoison: draw(heart, poison), heartPoisonHalf: draw(half, poison), heartWither: draw(heart, wither), heartWitherHalf: draw(half, wither),
    heartGold: draw(heart, gold), heartGoldHalf: draw(half, gold),
    food: draw(food, P), foodHalf: draw(foodHalf, P), foodEmpty: draw(foodEmpty, P),
    foodHunger: draw(food, { ...P, m: '#6a8a2a', h: '#8aae3a', b: '#b8c88a' }), foodHungerHalf: draw(foodHalf, { ...P, m: '#6a8a2a', h: '#8aae3a', b: '#b8c88a' }),
    armor: draw(armor, P), armorHalf: draw(armorHalf, P), armorEmpty: draw(armorEmpty, P),
    bubble: draw(bubble, { k: '#0d2f74', b: '#3f7fe8', d: '#2656b8', w: '#ffffff' }),
  };
}

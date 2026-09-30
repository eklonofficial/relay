// Keeps saved worlds working across updates without touching progress (inventories, stats,
// builds, chests). Runs on every world load before the world opens.
//  - Block ids: edits are stored as numeric block ids. Each save also records a palette (id ->
//    block name); if an update adds or reorders blocks, edits are remapped by name so builds keep
//    their blocks.
//  - Generator version: terrain and structure blocks regenerate from the seed on every load, so
//    new structures appear by themselves. Chunks first visited under an older version are marked
//    so their newer structures also receive their chest loot and mobs (see gen/versions.js).
import { BLOCKS, B, STATE, VARIANT_MASK } from '../data/blocks.js?v=muoqcjyl';
import { GEN_VERSION } from '../gen/versions.js?v=muoqcjyl';

export const SAVE_VERSION = 3;
export const blockPalette = () => Array.from({ length: BLOCKS.length }, (_, i) => (BLOCKS[i] ? BLOCKS[i].key : null));

export function migrateWorld(meta) {
  if (!meta) return meta;
  const dims = meta.dims || {};
  if (Array.isArray(meta.palette)) {
    const idOf = new Map();
    BLOCKS.forEach((b, i) => { if (b) idOf.set(b.key, i); });
    const map = meta.palette.map((k, i) => (k == null ? i : idOf.has(k) ? idOf.get(k) : B.AIR));
    if (map.some((v, i) => v !== i)) {
      for (const d of Object.values(dims)) for (const list of Object.values((d && d.edits) || {})) {
        for (let i = 1; i < list.length; i += 2) { const v = list[i]; list[i] = (map[v & 255] ?? (v & 255)) | (v & ~255); }
      }
    }
  }
  // Save version 3 gave note blocks, redstone lamps, targets and redstone blocks blocks of their
  // own (they carry redstone state now); convert the old variant-of-a-shared-block form.
  if ((meta.saveVersion || 1) < 3) {
    const conv = new Map();
    const from = key => STATE[key];
    const add = (key, fn) => { const s = from(key); if (s) conv.set(s[0] * 256 + s[1], fn); };
    add('legacy_note_block', m => B.NOTE_BLOCK | ((m >> 3) % 25) << 8);
    add('legacy_redstone_lamp', () => B.REDSTONE_LAMP);
    add('legacy_target', () => B.TARGET);
    add('legacy_redstone_block', () => B.REDSTONE_BLOCK);
    for (const d of Object.values(dims)) for (const list of Object.values((d && d.edits) || {})) {
      for (let i = 1; i < list.length; i += 2) {
        const id = list[i] & 255, m = list[i] >> 8, fn = conv.get(id * 256 + (m & VARIANT_MASK[id]));
        if (fn) list[i] = fn(m);
      }
    }
  }
  const gv = meta.genVersion || 1;
  if (gv < GEN_VERSION) {
    for (const d of Object.values(dims)) {
      if (!d || !d.populated || !d.populated.length) continue;
      d.popOld = d.popOld || {};
      d.popOld[gv] = [...(d.popOld[gv] || []), ...d.populated];
      d.populated = [];
    }
  }
  meta.genVersion = GEN_VERSION;
  meta.saveVersion = SAVE_VERSION;
  meta.palette = blockPalette();
  return meta;
}

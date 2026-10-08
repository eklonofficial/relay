// The cell palette (GDD §15.1). A map is a grid of 1×1×1 cells; each cell holds one piece and a
// rotation ry ∈ {0,1,2,3} (90° steps about the cell's vertical centre line).
//
// Every piece declares its colliders as boxes in its own cell space (ry = 0) and a collider type:
//   solid   blocks players, bullets, grenades and the spatula
//   pass    blocks players and grenades but not bullets/rockets (railings, fences)
//   ladder  climbable volume, no collision of its own (it hangs on a wall); ladder face at +z
//   pad     jump pad: a thin solid plate that launches whoever stands on it
//   none    decoration only
// Stairs and ramps collide as 0.25-high steps, so the movement code's +0.26 step-up walks them, as
// the GDD describes; they render as proper stairs or smooth wedges. Stairs/ramps rise towards +z.
//
// After the hand-made pieces come the imported map pieces (blocks.js: shape 'imported', drawn from
// their own meshes by render/blocks.js, colliding as their own boxes).
import { BLOCKS } from './blocks.js?v=muzischz';
const step4 = [[0, 0, 0, 1, 0.25, 1], [0, 0.25, 0.25, 1, 0.5, 1], [0, 0.5, 0.5, 1, 0.75, 1], [0, 0.75, 0.75, 1, 1, 1]];
const ramp8 = Array.from({ length: 8 }, (_, i) => [0, i / 8, i / 8, 1, (i + 1) / 8, 1]);
const halfRamp4 = Array.from({ length: 4 }, (_, i) => [0, i / 8, i / 4, 1, (i + 1) / 8, 1]);
// Corner ramps for terrain, high towards +x and +z. Outer (a convex corner): height min(x, z), so only
// the far corner is up. Inner (a concave corner): height max(x, z), so only the near corner is down.
const outer8 = Array.from({ length: 8 }, (_, i) => [i / 8, i / 8, i / 8, 1, (i + 1) / 8, 1]);
const inner8 = Array.from({ length: 8 }, (_, i) => [[i / 8, i / 8, 0, 1, (i + 1) / 8, 1], [0, i / 8, i / 8, 1, (i + 1) / 8, 1]]).flat();

// shape: what the renderer builds. mat: material family (render/materials.js) for the main faces.
const DEFS = [
  { key: 'air', kind: 'none', boxes: [] },
  { key: 'block', kind: 'solid', shape: 'block', boxes: [[0, 0, 0, 1, 1, 1]] },
  { key: 'slab', kind: 'solid', shape: 'slab', boxes: [[0, 0, 0, 1, 0.5, 1]] },
  { key: 'slabTop', kind: 'solid', shape: 'slabTop', boxes: [[0, 0.5, 0, 1, 1, 1]] },
  { key: 'stairs', kind: 'solid', shape: 'stairs', boxes: step4, ramp: true },
  { key: 'ramp', kind: 'solid', shape: 'ramp', boxes: ramp8, ramp: true },
  { key: 'halfRamp', kind: 'solid', shape: 'halfRamp', boxes: halfRamp4, ramp: true },
  { key: 'ladder', kind: 'ladder', shape: 'ladder', boxes: [] },
  { key: 'fence', kind: 'pass', shape: 'fence', boxes: [[0, 0, 0.42, 1, 1.0, 0.58]] },
  { key: 'pillar', kind: 'solid', shape: 'pillar', boxes: [[0.25, 0, 0.25, 0.75, 1, 0.75]] },
  { key: 'arch', kind: 'solid', shape: 'arch', boxes: [[0, 0.72, 0, 1, 1, 1]] },
  { key: 'window', kind: 'solid', shape: 'window', boxes: [[0, 0, 0, 1, 0.38, 1], [0, 0.78, 0, 1, 1, 1], [0, 0.38, 0, 0.12, 0.78, 1], [0.88, 0.38, 0, 1, 0.78, 1]] },
  { key: 'wall', kind: 'solid', shape: 'wall', boxes: [[0, 0, 0.35, 1, 1, 0.65]] },
  { key: 'pad', kind: 'pad', shape: 'pad', boxes: [[0, 0, 0, 1, 0.12, 1]] },
  { key: 'crate', kind: 'solid', shape: 'crate', boxes: [[0.08, 0, 0.08, 0.92, 0.84, 0.92]] },
  { key: 'barrel', kind: 'solid', shape: 'barrel', boxes: [[0.2, 0, 0.2, 0.8, 0.9, 0.8]] },
  { key: 'tree', kind: 'solid', shape: 'tree', boxes: [[0.38, 0, 0.38, 0.62, 1, 0.62]] },
  { key: 'leaves', kind: 'solid', shape: 'leaves', boxes: [[0, 0, 0, 1, 1, 1]] },
  { key: 'bush', kind: 'none', shape: 'bush', boxes: [] },
  { key: 'hay', kind: 'solid', shape: 'hay', boxes: [[0.05, 0, 0.05, 0.95, 0.7, 0.95]] },
  { key: 'glass', kind: 'pass', shape: 'glass', boxes: [[0, 0, 0.45, 1, 1, 0.55]] },
  { key: 'decor', kind: 'none', shape: 'decor', boxes: [] },
  { key: 'rampOuter', kind: 'solid', shape: 'rampOuter', boxes: outer8, ramp: true },
  { key: 'rampInner', kind: 'solid', shape: 'rampInner', boxes: inner8, ramp: true },
  ...BLOCKS.map((b, block) => ({ key: 'b:' + b.name, kind: b.kind, shape: 'imported', boxes: b.boxes, ramp: !!b.ramp, face: b.face ?? 0, block, draw: b.mesh })),
];

export const PIECES = DEFS.map((d, id) => ({ id, blocksShots: d.kind === 'solid' || d.kind === 'pad', blocksPlayers: d.kind === 'solid' || d.kind === 'pass' || d.kind === 'pad', ...d }));
export const PIECE = Object.fromEntries(PIECES.map(p => [p.key, p.id]));

// A box rotated by ry quarter turns about the cell's centre (looking down, clockwise from +z to -x).
export function rotateBox([x0, y0, z0, x1, y1, z1], ry) {
  for (let i = 0; i < (ry & 3); i++) [x0, z0, x1, z1] = [z0, 1 - x1, z1, 1 - x0];
  return [Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1)];
}
// Unit direction a ry-rotated "+z" faces (stairs rise that way; a ladder's wall is that way).
export function facing(ry) { return [[0, 1], [1, 0], [0, -1], [-1, 0]][ry & 3]; }
// The wall a ladder piece placed at rotation ry hangs on (an imported ladder records its own side).
export const ladderFacing = (piece, ry) => facing((piece.face || 0) + ry);
// Precomputed rotated boxes per piece and rotation.
export const BOXES = PIECES.map(p => [0, 1, 2, 3].map(r => p.boxes.map(b => rotateBox(b, r))));

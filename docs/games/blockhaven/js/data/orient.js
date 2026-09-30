// Orientation helpers for block models and hitboxes, in pixel units (0..16 across a block).
// Six-way facings use Java Edition's order: 0 down, 1 up, 2 north (-Z), 3 south (+Z), 4 west (-X), 5 east (+X).
// Horizontal facings use its 2D order, which the rest of the game shares: 0 south, 1 west, 2 north, 3 east.

export const DIR6_OF_2D = [3, 4, 2, 5];
export const DIR2D_OF_6 = [-1, -1, 2, 0, 1, 3];
export const STEP6 = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
export const OPP6 = [1, 0, 3, 2, 5, 4];
// Mesher face index (+X -X +Y -Y +Z -Z) of each six-way direction, and back.
export const FACE_OF_DIR6 = [3, 2, 5, 4, 1, 0];
export const DIR6_OF_FACE = [5, 4, 1, 0, 3, 2];

// A point of a model built facing up, turned to face `d`.
export function up6(d, x, y, z, o) {
  switch (d) {
    case 0: o[0] = x; o[1] = 16 - y; o[2] = 16 - z; break;
    case 2: o[0] = x; o[1] = z; o[2] = 16 - y; break;
    case 3: o[0] = x; o[1] = 16 - z; o[2] = y; break;
    case 4: o[0] = 16 - y; o[1] = x; o[2] = z; break;
    case 5: o[0] = y; o[1] = 16 - x; o[2] = z; break;
    default: o[0] = x; o[1] = y; o[2] = z;
  }
  return o;
}
// A point turned about the vertical axis from facing south to horizontal facing `f`.
export function rotY(f, x, y, z, o) {
  for (let r = 0; r < f; r++) { const t = x; x = 16 - z; z = t; }
  o[0] = x; o[1] = y; o[2] = z;
  return o;
}
// Levers and buttons: a model built lying on the floor facing south, moved to the floor (0),
// a wall (1, sticking out towards `f`) or the ceiling (2), then turned to horizontal facing `f`.
export function attach(face, f, x, y, z, o) {
  if (face === 1) { const t = y; y = 16 - z; z = t; }
  else if (face === 2) { y = 16 - y; z = 16 - z; }
  return rotY(f, x, y, z, o);
}
// Axis-aligned bounds of a box after a point transform; returns [x0, y0, z0, x1, y1, z1] in blocks.
const T = [0, 0, 0];
export function orientBox(fn, a, b, box, scale = 1 / 16) {
  let x0 = 99, y0 = 99, z0 = 99, x1 = -99, y1 = -99, z1 = -99;
  for (let k = 0; k < 8; k++) {
    fn(a, b, k & 1 ? box[3] : box[0], k & 2 ? box[4] : box[1], k & 4 ? box[5] : box[2], T);
    if (T[0] < x0) x0 = T[0]; if (T[0] > x1) x1 = T[0];
    if (T[1] < y0) y0 = T[1]; if (T[1] > y1) y1 = T[1];
    if (T[2] < z0) z0 = T[2]; if (T[2] > z1) z1 = T[2];
  }
  return [x0 * scale, y0 * scale, z0 * scale, x1 * scale, y1 * scale, z1 * scale];
}
const up6Fn = (d, _, x, y, z, o) => up6(d, x, y, z, o);
export const boxUp6 = (d, box, scale) => orientBox(up6Fn, d, 0, box, scale);
export const boxAttach = (face, f, box, scale) => orientBox(attach, face, f, box, scale);

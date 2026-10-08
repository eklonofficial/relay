// Hats: the imported hats and accessories (cosmetics.js names them and gives each its mesh in the
// character bundle). Each is one mesh, placed where it sits on the egg.
import { HATS } from '../game/cosmetics.js?v=muztsdw7';
import { hatModel } from './models.js?v=muztsdw7';

const NODE = new Map(HATS.filter(h => h.node !== undefined).map(h => [h.id, h.node]));
export const HAT_IDS = [...NODE.keys()];
// A copy of a hat (null for none or an unknown id), its origin at the egg's base like the shell.
export function hatMesh(id) {
  const node = NODE.get(id);
  return node === undefined ? null : hatModel(node);
}

// End crystals: heal the dragon, explode when hit.
import { Entity } from './entity.js?v=munl5eht';
import { B } from '../data/blocks.js?v=munl5eht';
import { compose, translation, rotationX, rotationY, scaling } from '../core/math.js?v=munl5eht';

export class EndCrystal extends Entity {
  constructor(game, x, y, z) {
    super(game, 'end_crystal', x, y, z);
    this.hw = 1; this.h = 2; this.isLiving = true; this.persistent = true;
    this.def = { kind: 'object' };
  }
  hurt(amount, src) {
    if (this.dead) return false;
    this.dead = true;
    this.game.explode([this.pos[0], this.pos[1] + 1, this.pos[2]], 6, { source: this });
    return true;
  }
  update() {}
  render(ctx) {
    const t = this.age;
    const y = this.pos[1] + 1 + Math.sin(t * 2) * 0.25;
    for (const [id, s, sp] of [[B.GLASS, 0.9, 1], [B.GLASS, 0.7, -1.4], [B.PURPUR, 0.45, 2]]) {
      ctx.blockModels.push({ id, meta: 0, light: 1.3, matrix: compose(translation(this.pos[0], y + 0.4, this.pos[2]), rotationY(t * sp), rotationX(t * sp * 0.7 + 0.6), scaling(s, s, s), translation(-0.5, -0.5, -0.5)) });
    }
  }
  toJSON() { return { t: 'crystal', p: this.pos }; }
}

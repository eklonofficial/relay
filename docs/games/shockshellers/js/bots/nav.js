// Navigation graph for bots, built from the map grid at load (GDD §15): a node wherever an egg can
// stand, edges for walking, stepping, ramps/stairs, drops, jump-ups, ladders and jump pads. Doubtful
// edges are verified by running the real movement code, so a path the graph offers is one an egg can
// actually walk. A* over a binary heap finds routes; costs prefer short, safe paths.
import { PIECES, PIECE, facing } from '../maps/pieces.js?v=muwqkdzr';
import { makeBody, stepBody } from '../sim/movement.js?v=muwqkdzr';
import { CTRL, PLAYER } from '../sim/tuning.js?v=muwqkdzr';

const R = PLAYER.collideRadius;
export const EDGE = { walk: 0, jump: 1, drop: 2, ladder: 3, pad: 4 };

export class NavGraph {
  // gravity: the map's gravity multiplier (moon maps), so verified jumps and pad launches match play.
  constructor(grid, gravity = 1) {
    this.grid = grid; this.gravity = gravity;
    this.nodes = []; // { id, x, y, z, cx, cz, edges: [{to, cost, kind}], exposure }
    this.byCell = new Map(); // "x,z" → [node ids] (several floors per column)
    this.build();
  }
  key(x, z) { return x + ',' + z; }
  // Standing heights in a column: tops of player-blocking boxes under the cell centre (or anywhere
  // in the cell for partial pieces), each with room for an egg above.
  build() {
    const g = this.grid;
    for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) {
      const list = [];
      for (let y = 0; y < g.h; y++) {
        const p = PIECES[g.get(x, y, z)];
        if (!p.blocksPlayers) continue;
        // The floor under the egg's middle (the central half of the cell): on stairs and ramps that is
        // the higher part of the slope, where an egg actually rests.
        let top = -1;
        for (const b of g.boxes(x, y, z)) if (b[0] < 0.75 && b[3] > 0.25 && b[2] < 0.75 && b[5] > 0.25) top = Math.max(top, y + b[4]);
        if (top < 0) continue;
        const fy = top + 0.002;
        if (g.collides(x + 0.5, fy + R + 0.02, z + 0.5, R - 0.06)) continue;
        if (g.collides(x + 0.5, fy + 0.9, z + 0.5, 0.2)) continue; // headroom
        list.push(this.add(x, fy, z, p));
      }
      // Ladder columns: a node at the foot of each ladder run (its top node is the wall top).
      if (list.length) this.byCell.set(this.key(x, z), list);
    }
    // Ladders: from the floor in front of the bottom rung to the top of the wall it hangs on.
    for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) for (let y = 0; y < g.h; y++) {
      if (g.get(x, y, z) !== PIECE.ladder || g.get(x, y - 1, z) === PIECE.ladder) continue;
      let top = y; while (g.get(x, top + 1, z) === PIECE.ladder) top++;
      const [fx, fz] = facing(g.getRot(x, y, z));
      const foot = this.at(x, y, z, 0.6) ?? this.at(x - fx, y, z - fz, 0.6);
      const head = this.at(x + fx, top + 1, z + fz, 0.6) ?? this.at(x, top + 1, z, 0.6);
      if (foot != null && head != null) {
        this.link(foot, head, (top - y + 1) * 1.6 + 1, EDGE.ladder, { lx: x, lz: z, fx, fz });
        this.link(head, foot, (top - y + 1) * 1.2 + 1, EDGE.ladder, { lx: x, lz: z, fx, fz, down: true });
      }
    }
    // Neighbours.
    for (const n of this.nodes) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const list = this.byCell.get(this.key(n.cx + dx, n.cz + dz));
        if (!list) continue;
        // No cutting corners past walls.
        if (dx && dz && (!this.passable(n, n.cx + dx, n.cz) || !this.passable(n, n.cx, n.cz + dz))) continue;
        for (const m of list) this.tryEdge(n, m, dx, dz);
      }
      if (n.pad) this.padEdges(n);
    }
    this.clusterRegions();
    this.analyse();
  }
  add(x, y, z, piece) {
    const n = { id: this.nodes.length, x: x + 0.5, y, z: z + 0.5, cx: x, cz: z, edges: [], exposure: 0, ramp: !!piece.ramp, pad: piece.key === 'pad', ry: 0 };
    n.ry = this.grid.getRot(x, Math.floor(y - 0.01), z);
    this.nodes.push(n);
    return n.id;
  }
  // Node in column (x,z) standing within `tol` of height y.
  at(x, y, z, tol = 0.6) {
    const list = this.byCell.get(this.key(x, z)); if (!list) return null;
    let best = null, bd = tol;
    for (const id of list) { const d = Math.abs(this.nodes[id].y - y); if (d <= bd) { bd = d; best = id; } }
    return best;
  }
  nearest(x, y, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    let best = null, bd = Infinity;
    for (let r = 0; r <= 3 && best === null; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const list = this.byCell.get(this.key(cx + dx, cz + dz)); if (!list) continue;
      for (const id of list) { const n = this.nodes[id], d = (n.x - x) ** 2 + ((n.y - y) * 2) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; best = id; } }
    }
    return best;
  }
  passable(n, x, z) { return !this.grid.collides(x + 0.5, n.y + R + 0.05, z + 0.5, 0.2); }
  link(a, b, cost, kind, extra) { this.nodes[a].edges.push({ to: b, cost, kind, ...extra }); }
  tryEdge(n, mid, dx, dz) {
    const m = this.nodes[mid], dh = m.y - n.y, dist = Math.hypot(dx, dz);
    if (dh > 1.05 || dh < -4.2) return;
    if (dh <= 0.3 && dh >= -0.3) { if (this.verify(n, m, false)) this.link(n.id, mid, dist, EDGE.walk); return; }
    if (dh < -0.3) { if (this.verify(n, m, false)) this.link(n.id, mid, dist + (-dh) * 0.4, EDGE.drop); return; }
    // Up more than a step: ramps/stairs walk; otherwise try a jump.
    if ((n.ramp || m.ramp) && this.verify(n, m, false)) { this.link(n.id, mid, dist * 1.2, EDGE.walk); return; }
    if (dh <= 0.62 && this.verify(n, m, true)) this.link(n.id, mid, dist + 1, EDGE.jump);
  }
  // Run the real movement code from node a towards b; true if it arrives (within 0.35, same floor).
  verify(a, b, jump) {
    // Start a hair above the node, as a standing egg rests (exactly on a stair's step line it wedges).
    const body = makeBody(a.x, a.y + 0.002, a.z); body.onGround = PLAYER.coyoteTicks;
    body.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    for (let t = 0; t < 70; t++) {
      const ctrl = CTRL.up | (jump && t === 1 ? CTRL.jump : 0);
      body.yaw = Math.atan2(-(b.x - body.x), -(b.z - body.z));
      const ev = stepBody(this.grid, body, (b.x - body.x) ** 2 + (b.z - body.z) ** 2 < 0.01 ? 0 : ctrl, { gravity: this.gravity });
      // Stepping onto a jump pad launches the egg before it can settle: touching the pad is arriving.
      if (ev === 'pad' && b.pad && Math.floor(body.x) === b.cx && Math.floor(body.z) === b.cz) return true;
      if ((b.x - body.x) ** 2 + (b.z - body.z) ** 2 < 0.35 * 0.35 && Math.abs(body.y - b.y) < 0.35 && body.onGround > 0) return true;
      if (body.y < Math.min(a.y, b.y) - 1.5) return false;
    }
    return false;
  }
  // Jump pads: simulate a launch in eight directions and link to wherever the egg lands.
  padEdges(n) {
    for (let k = 0; k < 8; k++) {
      const yaw = k / 8 * Math.PI * 2;
      const body = makeBody(n.x, n.y, n.z); body.yaw = yaw; body.onGround = PLAYER.coyoteTicks;
      let airborne = false;
      for (let t = 0; t < 240; t++) {
        stepBody(this.grid, body, CTRL.up, { gravity: this.gravity });
        if (body.onGround <= 0) airborne = true;
        if (airborne && body.onGround === PLAYER.coyoteTicks && t > 6) {
          const land = this.nearest(body.x, body.y, body.z);
          if (land !== null && land !== n.id && Math.abs(this.nodes[land].y - body.y) < 0.5) this.link(n.id, land, Math.hypot(body.x - n.x, body.z - n.z) * 0.7 + 1, EDGE.pad, { yaw });
          break;
        }
        if (body.y < n.y - 6) break;
      }
    }
  }
  // Tactical map (computed once): how exposed each spot is (the share of sampled standing spots that
  // can see it), how long its sightlines are, and how busy it is (near the centre of the action).
  // Snipers look for exposed spots with long sightlines and height; shotguns for covered spots
  // next to busy ones.
  analyse(samples = 48) {
    const N = this.nodes, g = this.grid;
    let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pick = Array.from({ length: Math.min(samples, N.length) }, () => N[Math.floor(rnd() * N.length)]);
    let maxY = 0; for (const n of N) maxY = Math.max(maxY, n.y);
    for (const n of N) {
      let seen = 0, far = 0;
      for (const o of pick) {
        if (o === n) continue;
        if (g.visible(n.x, n.y + 0.4, n.z, o.x, o.y + 0.4, o.z)) { seen++; far += Math.hypot(o.x - n.x, o.z - n.z); }
      }
      n.exposure = seen / pick.length;
      n.sight = seen ? far / seen : 0;
      n.height = maxY ? n.y / maxY : 0;
    }
    // Busy-ness: closeness to the middle of the walkable area, smoothed by exposure.
    let cx = 0, cz = 0; for (const n of N) { cx += n.x; cz += n.z; } cx /= N.length; cz /= N.length;
    let maxD = 1; for (const n of N) maxD = Math.max(maxD, Math.hypot(n.x - cx, n.z - cz));
    for (const n of N) n.busy = (1 - Math.hypot(n.x - cx, n.z - cz) / maxD) * 0.7 + n.exposure * 0.3;
  }
  // Connected components (bots never path to an unreachable island).
  clusterRegions() {
    const comp = new Int32Array(this.nodes.length).fill(-1);
    let c = 0;
    for (const n of this.nodes) {
      if (comp[n.id] >= 0) continue;
      const stack = [n.id]; comp[n.id] = c;
      while (stack.length) { const i = stack.pop(); for (const e of this.nodes[i].edges) if (comp[e.to] < 0) { comp[e.to] = c; stack.push(e.to); } }
      c++;
    }
    this.comp = comp;
    // The main region is the largest; spawns and objectives should be in it.
    const size = new Map(); for (const v of comp) size.set(v, (size.get(v) || 0) + 1);
    this.main = [...size].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  }

  // A* from node a to node b; returns [node ids] (a excluded) or null. `avoid(node)` adds cost.
  path(a, b, avoid = null, maxExpand = 6000) {
    if (a === null || b === null) return null;
    if (a === b) return [];
    const N = this.nodes, open = new Heap(), g = new Map([[a, 0]]), came = new Map();
    const h = i => Math.hypot(N[i].x - N[b].x, (N[i].y - N[b].y) * 1.5, N[i].z - N[b].z);
    open.push(a, h(a));
    let expanded = 0;
    while (open.size && expanded++ < maxExpand) {
      const cur = open.pop();
      if (cur === b) {
        const out = []; let k = b;
        while (k !== a) { out.push(k); k = came.get(k).from; }
        return out.reverse().map(id => id);
      }
      const gc = g.get(cur);
      for (const e of N[cur].edges) {
        const cost = gc + e.cost + (avoid ? avoid(N[e.to]) : 0);
        if (cost < (g.get(e.to) ?? Infinity)) { g.set(e.to, cost); came.set(e.to, { from: cur, edge: e }); open.push(e.to, cost + h(e.to)); }
      }
    }
    return null;
  }
  edge(a, b) { return this.nodes[a].edges.find(e => e.to === b) || null; }
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    this.k.push(k); this.p.push(p);
    let i = this.k.length - 1;
    while (i > 0) { const j = (i - 1) >> 1; if (this.p[j] <= this.p[i]) break; this.swap(i, j); i = j; }
  }
  pop() {
    const top = this.k[0], lk = this.k.pop(), lp = this.p.pop();
    if (this.k.length) {
      this.k[0] = lk; this.p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < this.k.length && this.p[l] < this.p[m]) m = l;
        if (r < this.k.length && this.p[r] < this.p[m]) m = r;
        if (m === i) break; this.swap(i, m); i = m;
      }
    }
    return top;
  }
  swap(i, j) { [this.k[i], this.k[j]] = [this.k[j], this.k[i]]; [this.p[i], this.p[j]] = [this.p[j], this.p[i]]; }
}

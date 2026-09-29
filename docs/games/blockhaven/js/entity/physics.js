// Swept AABB movement against block collision boxes, with step-up for slabs and stairs.
// An entity has pos (feet centre), vel, hw (half width), h (height), onGround, stepHeight.
const EPS = 1e-5;
const boxes = [];

function sweep(world, e, dx, dy, dz) {
  const hw = e.hw, h = e.h, p = e.pos;
  const x0 = Math.min(p[0] - hw, p[0] - hw + dx), x1 = Math.max(p[0] + hw, p[0] + hw + dx);
  const y0 = Math.min(p[1], p[1] + dy), y1 = Math.max(p[1] + h, p[1] + h + dy);
  const z0 = Math.min(p[2] - hw, p[2] - hw + dz), z1 = Math.max(p[2] + hw, p[2] + hw + dz);
  world.collide(x0, y0, z0, x1, y1, z1, boxes);
  let ax0 = p[0] - hw, ay0 = p[1], az0 = p[2] - hw, ax1 = p[0] + hw, ay1 = p[1] + h, az1 = p[2] + hw;
  // Y
  for (const b of boxes) {
    if (b[3] <= ax0 + EPS || b[0] >= ax1 - EPS || b[5] <= az0 + EPS || b[2] >= az1 - EPS) continue;
    if (dy > 0 && b[1] >= ay1 - EPS) dy = Math.min(dy, b[1] - ay1);
    else if (dy < 0 && b[4] <= ay0 + EPS) dy = Math.max(dy, b[4] - ay0);
  }
  ay0 += dy; ay1 += dy;
  // X
  for (const b of boxes) {
    if (b[4] <= ay0 + EPS || b[1] >= ay1 - EPS || b[5] <= az0 + EPS || b[2] >= az1 - EPS) continue;
    if (dx > 0 && b[0] >= ax1 - EPS) dx = Math.min(dx, b[0] - ax1);
    else if (dx < 0 && b[3] <= ax0 + EPS) dx = Math.max(dx, b[3] - ax0);
  }
  ax0 += dx; ax1 += dx;
  // Z
  for (const b of boxes) {
    if (b[4] <= ay0 + EPS || b[1] >= ay1 - EPS || b[3] <= ax0 + EPS || b[0] >= ax1 - EPS) continue;
    if (dz > 0 && b[2] >= az1 - EPS) dz = Math.min(dz, b[2] - az1);
    else if (dz < 0 && b[5] <= az0 + EPS) dz = Math.max(dz, b[5] - az0);
  }
  return [dx, dy, dz];
}

// Moves the entity by (dx,dy,dz) and updates onGround / collision flags. Returns true if anything blocked.
export function moveEntity(world, e, dx, dy, dz) {
  if (e.noClip) { e.pos[0] += dx; e.pos[1] += dy; e.pos[2] += dz; e.onGround = false; return false; }
  // Sneaking stops at ledges.
  if (e.sneaking && e.onGround && dy <= 0) {
    const step = 0.05;
    while (dx !== 0 && !groundBelow(world, e, dx, 0)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
    while (dz !== 0 && !groundBelow(world, e, 0, dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    while (dx !== 0 && dz !== 0 && !groundBelow(world, e, dx, dz)) {
      dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
    }
  }
  let [mx, my, mz] = sweep(world, e, dx, dy, dz);
  const blockedH = Math.abs(mx - dx) > 1e-7 || Math.abs(mz - dz) > 1e-7;
  const stepH = e.stepHeight ?? 0.6;
  if (blockedH && stepH > 0 && (e.onGround || (dy < 0 && Math.abs(my - dy) > 1e-7))) {
    // Try stepping up.
    const saved = e.pos.slice();
    const [, uy] = sweep(world, e, 0, stepH, 0);
    e.pos[1] += uy;
    const [sx, , sz] = sweep(world, e, dx, 0, dz);
    e.pos[0] += sx; e.pos[2] += sz;
    const [, dy2] = sweep(world, e, 0, -uy, 0);
    e.pos[1] += dy2;
    if (sx * sx + sz * sz > mx * mx + mz * mz + 1e-6) {
      e.onGround = true; e.collidedH = false; e.stepped = true;
      return true;
    }
    e.pos[0] = saved[0]; e.pos[1] = saved[1]; e.pos[2] = saved[2];
  }
  e.pos[0] += mx; e.pos[1] += my; e.pos[2] += mz;
  e.collidedH = blockedH;
  e.collidedV = Math.abs(my - dy) > 1e-7;
  e.onGround = dy < 0 && e.collidedV;
  if (Math.abs(mx - dx) > 1e-7) e.vel[0] = 0;
  if (Math.abs(mz - dz) > 1e-7) e.vel[2] = 0;
  if (e.collidedV) e.vel[1] = 0;
  return blockedH || e.collidedV;
}

function groundBelow(world, e, dx, dz) {
  const p = e.pos, hw = e.hw;
  world.collide(p[0] - hw + dx, p[1] - 0.6, p[2] - hw + dz, p[0] + hw + dx, p[1] - 0.01, p[2] + hw + dz, boxes);
  return boxes.length > 0;
}

export function aabbOverlapsBlocks(world, e) {
  const p = e.pos, hw = e.hw;
  world.collide(p[0] - hw + EPS, p[1] + EPS, p[2] - hw + EPS, p[0] + hw - EPS, p[1] + e.h - EPS, p[2] + hw - EPS, boxes);
  return boxes.length > 0;
}

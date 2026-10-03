// Floating name tags over other players, drawn as a DOM overlay so the text stays crisp.
// Like the original they show at any distance and through walls (dimmed when something is in
// the way); a sneaking player's tag is hidden behind walls and faint in the open.
import { forward } from '../core/math.js?v=musmxd8k';

export class NameTags {
  constructor(root) {
    this.root = root;
    this.tags = new Map();
  }
  clear() { for (const el of this.tags.values()) el.remove(); this.tags.clear(); }
  update(cam, fov, players, world) {
    const seen = new Set();
    const W = window.innerWidth, H = window.innerHeight;
    const f = forward(cam.yaw, cam.pitch);
    const r = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const t = Math.tan(fov * Math.PI / 360);
    for (const rp of players) {
      if (!rp.visible) continue;
      const pos = [rp.pos[0], rp.pos[1] + (rp.sneaking ? 1.75 : 2.05), rp.pos[2]];
      const d = [pos[0] - cam.pos[0], pos[1] - cam.pos[1], pos[2] - cam.pos[2]];
      const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
      if (z < 0.2) continue;
      const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) / (z * t), y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (z * t);
      const sx = W / 2 + x * H / 2, sy = H / 2 - y * H / 2;
      if (sx < -200 || sx > W + 200 || sy < -50 || sy > H + 50) continue;
      const dist = Math.hypot(d[0], d[1], d[2]);
      const hit = world.raycast(cam.pos, [d[0] / dist, d[1] / dist, d[2] / dist], dist - 0.3);
      const blocked = !!hit;
      if (blocked && rp.sneaking) continue;
      let el = this.tags.get(rp);
      if (!el) { el = document.createElement('div'); el.className = 'nametag'; this.root.appendChild(el); this.tags.set(rp, el); }
      if (el.textContent !== rp.name) el.textContent = rp.name;
      // Fixed size in the world up close, never smaller than readable far away.
      const px = Math.max(11, Math.min(22, 260 / Math.max(1, dist) * (H / 720)));
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      el.style.fontSize = `${px.toFixed(1)}px`;
      el.style.opacity = rp.sneaking ? 0.45 : blocked ? 0.55 : 1;
      el.style.zIndex = String(Math.max(1, 10000 - Math.round(dist)));
      seen.add(rp);
    }
    for (const [rp, el] of this.tags) if (!seen.has(rp)) { el.remove(); this.tags.delete(rp); }
  }
}

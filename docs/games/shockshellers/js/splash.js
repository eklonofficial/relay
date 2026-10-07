// The start-up splash over the page while the modules download: the menu's sky gradient and a
// loading pill (index.html paints the gradient before any script runs). main.js reports progress
// and calls splash.ready(); the splash then fades out and removes itself. It never stands in the
// way for long, whatever goes wrong while starting.
import { surfaceDocument } from './surface.js?v=muymhhti';
// Before the page mounts, the splash is the native #boot; once the compositor mounts the markup, the
// live copy is the one in its layout tree. Look it up every frame.
const find = id => surfaceDocument.getElementById(id) || document.getElementById(id);
let progress = 0, shown = 0, done = false, fade = 1;
export const splash = {
  progress(p) { progress = Math.max(progress, p); },
  ready() { progress = 1; done = true; },
};
// Module downloads, counted against the module graph tools/stamp.mjs measured.
const expected = Number(document.getElementById('boot-script')?.dataset.modules) || 0;
const jsDir = import.meta.url.startsWith('blob:') ? '' : new URL('./', import.meta.url).href;
const poll = () => {
  if (done || !expected || !performance.getEntriesByType) return;
  const n = new Set(performance.getEntriesByType('resource').map(e => e.name.split('?')[0]).filter(x => x.startsWith(jsDir) && x.endsWith('.js'))).size;
  progress = Math.max(progress, 0.3 * Math.min(1, n / expected));
  setTimeout(poll, 100);
};
poll();
if (find('boot')) {
  const frame = () => {
    const root = find('boot'), canvas = find('boot-canvas');
    if (!root || !canvas) return;
    const x = canvas.getContext('2d');
    const d = Math.min(2, devicePixelRatio || 1), w = innerWidth, h = innerHeight;
    if (canvas.width !== Math.round(w * d)) { canvas.width = Math.round(w * d); canvas.height = Math.round(h * d); }
    x.setTransform(d, 0, 0, d, 0, 0);
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#2290b5'); g.addColorStop(1, '#a6dcef');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    shown += (progress - shown) * 0.15;
    const bw = Math.min(420, w * 0.6), bh = 26, bx = (w - bw) / 2, by = h * 0.62;
    x.lineWidth = 5; x.strokeStyle = '#5a3410'; x.fillStyle = '#fff';
    x.beginPath(); x.roundRect(bx, by, bw, bh, bh / 2); x.fill(); x.stroke();
    x.fillStyle = '#f39a25'; x.beginPath(); x.roundRect(bx + 3, by + 3, Math.max(0, (bw - 6) * shown), bh - 6, (bh - 6) / 2); x.fill();
    if (done && shown > 0.98) { fade -= 0.08; root.style.opacity = String(Math.max(0, fade)); }
    if (fade <= 0) { root.remove(); return; }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
setTimeout(() => splash.ready(), 30000);
addEventListener('error', () => splash.ready());

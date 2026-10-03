// The startup splash (render/splashart.js) over the page while the game loads, like Minecraft's
// loading overlay. index.html paints its colour before any script runs; this module, which loads
// ahead of main.js, puts the animation on a worker thread so it plays smoothly through the busy
// startup, and main.js reports how far along loading is:
//   0 - 0.3  modules downloaded (counted against the module graph, from the tools/stamp.mjs count)
//   0.3 - 1  main.js's own steps: textures, then the title panorama streaming in
// then calls splash.ready(). The splash plays its animation out, fades, and removes itself.
import { SplashArt } from './render/splashart.js?v=musmvdzj';

const root = document.getElementById('boot'), canvas = document.getElementById('boot-canvas');
const reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const size = () => { const dpr = window.devicePixelRatio || 1; return { w: Math.round(innerWidth * dpr), h: Math.round(innerHeight * dpr), dpr, cssW: innerWidth, cssH: innerHeight }; };

let send = () => {}, stopped = false, reported = false, isReady = false, sent = 0;
export const splash = {
  // Loading progress from main.js, 0.3 (modules in) to 1.
  progress(p) { reported = true; if (p > sent) { sent = p; send({ type: 'progress', p }); } },
  ready() { if (isReady) return; isReady = true; reported = true; send({ type: 'ready' }); },
};
function finish() {
  if (stopped) return;
  stopped = true;
  if (root) root.remove();
}

if (!root || !canvas) stopped = true;
else if ('transferControlToOffscreen' in canvas && typeof Worker === 'function') {
  const off = canvas.transferControlToOffscreen();
  const worker = new Worker(new URL('./render/splashworker.js?v=musmvdzj', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    if (e.data.type === 'painted') root.style.background = 'transparent';
    if (e.data.type === 'done') { worker.terminate(); finish(); }
  };
  worker.onerror = () => { worker.terminate(); finish(); }; // e.g. no module workers: just get out of the way
  worker.postMessage({ type: 'init', canvas: off, reduced, ...size() }, [off]);
  send = m => worker.postMessage(m);
} else {
  // No OffscreenCanvas: the same animation on this thread (it pauses while the page is busy).
  const art = new SplashArt({ reduced }), ctx = canvas.getContext('2d');
  let last = 0;
  send = m => { if (m.type === 'progress') art.setProgress(m.p); else if (m.type === 'ready') art.setReady(); else if (m.type === 'resize') { canvas.width = m.w; canvas.height = m.h; art.resize(m); } };
  send({ type: 'resize', ...size() });
  const frame = t => {
    art.step(last ? Math.min(0.1, (t - last) / 1000) : 0); last = t;
    art.draw(ctx);
    root.style.background = 'transparent';
    if (art.done) finish(); else requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
if (!stopped) addEventListener('resize', () => { if (!stopped) send({ type: 'resize', ...size() }); });

// Module downloads: our own module graph, of the size tools/stamp.mjs counted, fetched so far.
const expected = Number(document.getElementById('boot-script')?.dataset.modules) || 0;
const jsDir = import.meta.url.startsWith('blob:') ? '' : new URL('./', import.meta.url).href;
const pollModules = () => {
  if (reported || stopped || !expected || !performance.getEntriesByType) return;
  const names = new Set(performance.getEntriesByType('resource').map(e => e.name.split('?')[0]).filter(n => n.startsWith(jsDir) && n.endsWith('.js')));
  send({ type: 'progress', p: 0.3 * Math.min(1, names.size / expected) });
  setTimeout(pollModules, 100);
};
pollModules();

// Never stand in the way for long, whatever goes wrong while starting.
setTimeout(() => splash.ready(), 30000);
addEventListener('error', () => splash.ready());
import './page.js?v=musmvdzj';
import { surfaceDocument as document } from './surface.js?v=musmvdzj';

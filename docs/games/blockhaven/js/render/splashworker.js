// Runs the startup splash on its own thread (see js/splash.js), drawing into a canvas handed over
// with transferControlToOffscreen, so it keeps animating while the page builds the game.
import { SplashArt } from './splashart.js?v=muot8lcy';

let art = null, ctx = null, canvas = null, last = 0;
const raf = self.requestAnimationFrame ? f => self.requestAnimationFrame(f) : f => setTimeout(() => f(performance.now()), 16);

self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    canvas = m.canvas; ctx = canvas.getContext('2d');
    art = new SplashArt(m); size(m);
    raf(frame);
  } else if (!art) return;
  else if (m.type === 'progress') art.setProgress(m.p);
  else if (m.type === 'ready') art.setReady();
  else if (m.type === 'resize') size(m);
};

function size(m) { canvas.width = m.w; canvas.height = m.h; art.resize(m); }

function frame(t) {
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
  last = t;
  art.step(dt);
  art.draw(ctx);
  if (art.done) { self.postMessage({ type: 'done' }); return; }
  raf(frame);
}

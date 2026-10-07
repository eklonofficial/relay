import { surfaceDocument as document } from './surface.js?v=muyivii8';
let app, frame, shown = false, wasRunning = false;
let previousTitle, previousIcon;
const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%232f72dc'/%3E%3Cpath d='M5 25 C11 25 12 7 16 7 S21 25 27 25' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E";
export function registerApp(value) { app = value; }
function ensure() {
  if (frame) return frame;
  frame = document.createElement('iframe');
  frame.src = '../calc.html'; frame.title = 'Calculator';
  frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;display:none;background:#fff';
  frame.addEventListener('load', () => { if (shown) frame.contentWindow.postMessage({ bh: 'show' }, location.origin); });
  // The calculator has its own native canvas and stays outside the compositor.
  globalThis.document.body.appendChild(frame);
  return frame;
}
addEventListener('keydown', e => {
  const active = document.activeElement;
  if (e.code !== 'KeyJ' || shown || e.repeat || e.ctrlKey || e.metaKey || e.altKey || active?.matches('input,textarea,select,[contenteditable]')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  ensure(); shown = true; frame.style.display = 'block';
  previousTitle = globalThis.document.title; globalThis.document.title = 'Graphing Calculator';
  const badge = globalThis.document.querySelector('link[rel="icon"]');
  if (badge) { previousIcon = badge.href; badge.href = icon; }
  if (document.pointerLockElement) document.exitPointerLock();
  app?.keys.clear();
  const ctx = app?.sound?.ctx;
  wasRunning = ctx?.state === 'running'; if (wasRunning) ctx.suspend();
  frame.focus(); frame.contentWindow.postMessage({ bh: 'show' }, location.origin);
}, true);
addEventListener('message', e => {
  if (e.origin !== location.origin || !frame || e.source !== frame.contentWindow) return;
  // Another game's expression: switch games in this tab (same-origin sibling folder only).
  if (e.data?.bh === 'open' && /^[a-z0-9]+$/.test(e.data.game || '')) { location.href = `../${e.data.game}/index.html`; return; }
  if (e.data?.bh !== 'resume') return;
  shown = false; frame.style.display = 'none';
  globalThis.document.title = previousTitle;
  const badge = globalThis.document.querySelector('link[rel="icon"]'); if (badge && previousIcon) badge.href = previousIcon;
  if (wasRunning) app?.sound?.ctx.resume();
  window.focus();
});
addEventListener('load', ensure);

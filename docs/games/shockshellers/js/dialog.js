import { surfaceDocument as document } from './surface.js?v=muv65sre';
let pending = Promise.resolve();
function show(message, question) {
  const result = pending.then(() => new Promise(resolve => {
    const previous = document.activeElement;
    const layer = document.createElement('div');
    layer.className = 'screen';
    layer.style.cssText = 'z-index:100000;background:rgba(0,0,0,.8);justify-content:center;gap:24px;padding:24px';
    const label = document.createElement('div'); label.textContent = message;
    label.style.cssText = 'white-space:pre-wrap;max-width:800px;text-align:center;line-height:1.4';
    const row = document.createElement('div'); row.className = 'row';
    const done = value => { layer.remove(); previous?.focus?.(); resolve(value); };
    const ok = document.createElement('button'); ok.textContent = 'OK'; ok.onclick = () => done(true);
    row.append(ok);
    if (question) { const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.onclick = () => done(false); row.append(cancel); }
    layer.append(label, row); document.body.append(layer);
    layer.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(false); }
      if (e.key === 'Tab') { e.preventDefault(); const buttons = [...row.children]; buttons[(buttons.indexOf(document.activeElement) + (e.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus(); }
    });
    ok.focus();
  }));
  pending = result.catch(() => {}); return result;
}
export const ask = message => show(message, true);
export const tell = message => show(message, false);

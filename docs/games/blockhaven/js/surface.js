// The public document is a static surface. Native controls stay in a closed
// layout tree for keyboard navigation, IME, paste, file pickers and accessibility.
// Only the compositor paints them. This reduces ordinary DOM text exposure;
// it is not a security boundary against extensions or instrumented browser APIs.
let tree, layout, host, output, context, worldCanvas;
const native = globalThis.document;
const assets = new Map();
let textLayouts = new WeakMap();
let dirty = true, animated = false;
// Partial repaints: when only animations change (an enchantment glint, a fading overlay, the
// inventory's player canvas, a caret), just the area around them is cleared and drawn again.
// Each element's painted extent (its subtree, padded for shadows and overhangs) is kept from
// the last full paint; layout cannot have changed since, or the surface would be dirty.
let extents = new WeakMap(), live = new Set(), clipRect = null, lastSize = '', lastClip = null, lastTargets = [];
const PAD = 8;
const hints = new WeakMap();
let hint = '', hintTimer, pointer = { x: 0, y: 0 };
function captureHints(node) {
  if (node.nodeType !== 1) return;
  for (const el of [node, ...node.querySelectorAll('[title]')]) {
    if (!el.hasAttribute('title')) continue;
    hints.set(el, el.getAttribute('title')); el.removeAttribute('title');
  }
}

export function mount(markup, css) {
  for (const block of css.matchAll(/@font-face\s*\{([^}]+)\}/g)) {
    const get = key => block[1].match(new RegExp(`${key}:\\s*(${key === 'src' ? 'url\\([^)]*\\)\\s*(?:format\\([^)]*\\))?' : '[^;]+'})`))?.[1]?.trim();
    const face = new FontFace(get('font-family').replace(/"/g, ''), get('src'), { weight: get('font-weight') || '400', style: get('font-style') || 'normal', unicodeRange: get('unicode-range') || 'U+0-10FFFF' });
    native.fonts.add(face); face.load().then(() => { dirty = true; textLayouts = new WeakMap(); }).catch(() => {});
  }
  host = native.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;isolation:isolate;pointer-events:none;background:transparent';
  tree = host.attachShadow({ mode: 'closed' });
  const sheet = native.createElement('style');
  sheet.textContent = css.replace(/:root/g, ':host').replace(/html, body/g, ':host, .surface-layout').replace(/body\.ingame/g, '.surface-layout.ingame');
  tree.append(sheet);
  layout = native.createElement('div');
  layout.className = 'surface-layout';
  layout.style.cssText = 'position:absolute;inset:0;opacity:0;pointer-events:none';
  // Defaults must not override the original decorative overlays' hit testing.
  // The full-window layout itself must remain transparent to world clicks.
  sheet.textContent += '\n:where(.surface-layout > *) {pointer-events:auto}';
  // Parse before connection, so ordinary document observers never see the text.
  const template = native.createElement('template');
  template.innerHTML = markup;
  template.content.querySelectorAll('script').forEach(e => e.remove());
  layout.append(template.content);
  captureHints(layout);
  tree.append(layout);
  worldCanvas = tree.getElementById('game');
  if (worldCanvas) {
    // Pointer lock and raw input belong to a native canvas, outside the closed
    // layout tree. This avoids shadow-root retargeting differences across browsers.
    worldCanvas.removeAttribute('id');
    worldCanvas.tabIndex = -1;
    worldCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;outline:none';
    worldCanvas.remove();
  }
  for (const id of ['boot']) {
    const node = tree.getElementById(id);
    if (node) tree.insertBefore(node, layout);
  }
  output = native.createElement('canvas');
  output.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:100';
  tree.append(output);
  context = output.getContext('2d');
  native.body.replaceChildren(...(worldCanvas ? [worldCanvas, host] : [host]));
  const observer = new MutationObserver(records => {
    dirty = true;
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName === 'title') captureHints(r.target);
      if (r.type === 'childList') r.addedNodes.forEach(captureHints);
    }
  });
  observer.observe(layout, { subtree: true, childList: true, characterData: true, attributes: true });
  for (const name of ['input', 'change', 'focusin', 'focusout', 'mouseover', 'mouseout', 'scroll', 'pointermove', 'keydown', 'keyup']) {
    tree.addEventListener(name, () => { dirty = true; }, true);
  }
  tree.addEventListener('load', () => { dirty = true; }, true);
  addEventListener('resize', () => { dirty = true; });
  native.fonts?.ready.then(() => { dirty = true; });
  tree.addEventListener('pointermove', e => { pointer = { x: e.clientX, y: e.clientY }; });
  tree.addEventListener('mouseover', e => {
    clearTimeout(hintTimer); hint = ''; dirty = true;
    let el = e.target; while (el && !hints.has(el)) el = el.parentElement;
    const value = el && hints.get(el);
    if (value) hintTimer = setTimeout(() => { hint = value; dirty = true; }, 600);
  });
  host.addEventListener('mouseleave', () => { clearTimeout(hintTimer); hint = ''; dirty = true; });
  const frame = () => { requestAnimationFrame(frame); if (!native.hidden && (dirty || animated)) paint(); };
  requestAnimationFrame(frame);
}

// A module-local document facade, never installed on window or the native DOM.
export const surfaceDocument = new Proxy({}, { get(_, key) {
  if (key === 'getElementById') return id => (id === 'game' && worldCanvas) || tree?.getElementById(id) || native.getElementById(id);
  if (key === 'body') return layout || native.body;
  if (key === 'documentElement') return host || native.documentElement;
  if (key === 'activeElement') return tree?.activeElement || native.activeElement;
  if (key === 'pointerLockElement') return tree?.pointerLockElement || native.pointerLockElement;
  if (key === 'addEventListener' || key === 'removeEventListener') return (name, fn, options) => {
    // Global input must also see events outside the layout tree: the world,
    // drags released off a control, and keys after pointer lock changes focus.
    // Native inputs still stop propagation before these document listeners.
    const globalInput = /^(?:keydown|keyup|pointerrawupdate|pointermove|mousemove|mousedown|mouseup|wheel|contextmenu|visibilitychange|pointerlockchange|pointerlockerror|fullscreenchange)$/;
    // Delegated UI clicks still need the real target inside the closed tree
    // (for example, calculator popovers use target.closest()).
    (globalInput.test(name) ? native : tree || native)[key](name, fn, options);
  };
  const value = native[key];
  return typeof value === 'function' ? value.bind(native) : value;
} });

const split = value => value.split(/,(?![^()]*\))/);
const px = value => parseFloat(value) || 0;
const xml = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const visualProperties = ['background', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'border-image', 'box-shadow', 'mask-image', '-webkit-mask-image', 'mask-size', '-webkit-mask-size', 'image-rendering'];
function visual(style, w, h) {
  const properties = visualProperties.map(p => `${p}:${style.getPropertyValue(p)}`).join(';');
  if (!/url\(|gradient\(|shadow:[^;]*\d|radius:[^;]*[1-9]/.test(properties)) return null;
  const key = `${w},${h}:${properties}`;
  let img = assets.get(key);
  if (!img) {
    // CSS rasterizes complex nine-slice panels, gradients and masked effects once.
    // No DOM snapshot, external resource fetch, or temporary public iframe.
    img = new Image();
    img.onload = () => { dirty = true; };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="box-sizing:border-box;width:${w}px;height:${h}px;${xml(properties)}"></div></foreignObject></svg>`)}`;
    assets.set(key, img);
    // Bound memory for progress bars and different resolutions.
    if (assets.size > 2048) assets.delete(assets.keys().next().value);
  }
  return img.complete && img.naturalWidth ? img : null;
}
function styleOf(el, pseudo = '') {
  if (pseudo) return getComputedStyle(el, pseudo);
  // Hover/focus styles depend on ancestors and are cheap enough to read per paint.
  return getComputedStyle(el);
}
function box(ctx, s, r) {
  const { x, y, width: w, height: h } = r;
  const picture = visual(s, w, h);
  if (picture) { ctx.drawImage(picture, x, y, w, h); return; }
  if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') { ctx.fillStyle = s.backgroundColor; ctx.fillRect(x, y, w, h); }
  for (const [side, a, b, c, d] of [['Top', x, y, w, px(s.borderTopWidth)], ['Bottom', x, y + h - px(s.borderBottomWidth), w, px(s.borderBottomWidth)], ['Left', x, y, px(s.borderLeftWidth), h], ['Right', x + w - px(s.borderRightWidth), y, px(s.borderRightWidth), h]]) {
    if (s[`border${side}Style`] === 'none') continue;
    ctx.fillStyle = s[`border${side}Color`]; ctx.fillRect(a, b, c, d);
  }
}
function text(ctx, value, s, x, y) {
  ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = s.letterSpacing === 'normal' ? '0px' : s.letterSpacing;
  ctx.textBaseline = 'alphabetic';
  const metrics = ctx.measureText(value), baseline = y + (metrics.fontBoundingBoxAscent || px(s.fontSize) * .8);
  for (const shadow of split(s.textShadow).reverse()) {
    const lengths = shadow.match(/-?\d+(?:\.\d+)?px/g);
    if (!lengths) continue;
    ctx.fillStyle = shadow.replace(/-?\d+(?:\.\d+)?px/g, '').trim();
    ctx.fillText(value, x + px(lengths[0]), baseline + px(lengths[1]));
  }
  ctx.fillStyle = s.color; ctx.fillText(value, x, baseline);
}
function localRect(r, matrix) {
  const {a,b,c,d} = matrix, det = Math.abs(a) * Math.abs(d) - Math.abs(b) * Math.abs(c);
  // Recover the unrotated Range rectangle before mapping its top-left back.
  // getBoundingClientRect is an axis-aligned *bounding box*, not a glyph origin.
  const w = Math.abs(det) > 1e-6 ? (r.width * Math.abs(d) - r.height * Math.abs(c)) / det : 0;
  const h = Math.abs(det) > 1e-6 ? (r.height * Math.abs(a) - r.width * Math.abs(b)) / det : 0;
  const p = matrix.inverse().transformPoint({x:r.x - Math.min(0,a*w) - Math.min(0,c*h), y:r.y - Math.min(0,b*w) - Math.min(0,d*h)});
  return {x:p.x,y:p.y,width:w,height:h};
}
function textNode(ctx, node, s, matrix) {
  if (!node.textContent.trim()) return null;
  const range = native.createRange();
  range.selectNodeContents(node);
  const bounds = range.getBoundingClientRect();
  const key = [node.textContent,s.font,s.letterSpacing,bounds.x,bounds.y,bounds.width,bounds.height,matrix.toString()].join('|');
  const cached = textLayouts.get(node);
  if (cached?.key === key) { for (const line of cached.lines) text(ctx,line.value,s,line.x,line.y); return bounds; }
  // Range supplies browser wrapping, bidi, spacing and mixed inline layout.
  // Group characters sharing one line to preserve kerning and avoid per-glyph paint.
  let line = '', left = 0, top = 0;
  const lines = [];
  const flush = () => { if (line) { lines.push({value:line,x:left,y:top}); text(ctx, line, s, left, top); } };
  for (let i = 0; i < node.length; i++) {
    range.setStart(node, i); range.setEnd(node, i + 1);
    const r = localRect(range.getBoundingClientRect(), matrix);
    if (!r.height) continue;
    if (line && Math.abs(r.y - top) > 1) { flush(); line = ''; }
    if (!line) { left = r.x; top = r.y; }
    line += node.textContent[i];
  }
  flush();
  textLayouts.set(node,{key,lines});
  return bounds;
}
function pseudo(ctx, el, name, parent) {
  const s = styleOf(el, name);
  if (s.content === 'none' || s.content === 'normal' || s.display === 'none') return;
  const length = (v, size) => v.endsWith('%') ? px(v) * size / 100 : px(v);
  // Universal '*' rules do not include pseudo-elements. Their computed width
  // can therefore be content-box even when their parent's is border-box.
  const extraW = s.boxSizing === 'border-box' ? 0 : px(s.borderLeftWidth)+px(s.borderRightWidth)+px(s.paddingLeft)+px(s.paddingRight);
  const extraH = s.boxSizing === 'border-box' ? 0 : px(s.borderTopWidth)+px(s.borderBottomWidth)+px(s.paddingTop)+px(s.paddingBottom);
  const w = s.width === 'auto' ? parent.width - length(s.left,parent.width) - length(s.right,parent.width) : length(s.width,parent.width)+extraW;
  const h = s.height === 'auto' ? parent.height - length(s.top,parent.height) - length(s.bottom,parent.height) : length(s.height,parent.height)+extraH;
  const r = { x: s.left !== 'auto' ? parent.x + length(s.left,parent.width) : parent.x + parent.width - length(s.right,parent.width) - w, y: s.top !== 'auto' ? parent.y + length(s.top,parent.height) : parent.y + parent.height - length(s.bottom,parent.height) - h, width: w, height: h };
  box(ctx, s, r);
}
function control(ctx, el, s, r) {
  if (el.type === 'range') return; // existing custom slider draws its own face
  if (el.type === 'checkbox') {
    ctx.strokeStyle = s.color; ctx.strokeRect(r.x + 2, r.y + 2, r.width - 4, r.height - 4);
    if (el.checked) { ctx.fillStyle = s.color; ctx.fillRect(r.x + 5, r.y + 5, r.width - 10, r.height - 10); }
    return;
  }
  const value = el.value || el.placeholder || '';
  ctx.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  let x = r.x + px(s.borderLeftWidth) + px(s.paddingLeft) - el.scrollLeft;
  if (s.textAlign === 'center') x = r.x + (r.width - ctx.measureText(value).width) / 2;
  else if (s.textAlign === 'right') x = r.right - px(s.paddingRight) - ctx.measureText(value).width;
  const top = r.y + (r.height - px(s.fontSize)) / 2;
  ctx.save(); ctx.beginPath(); ctx.rect(r.x + px(s.borderLeftWidth), r.y, r.width - px(s.borderLeftWidth) - px(s.borderRightWidth), r.height); ctx.clip();
  text(ctx, value, !el.value && el.placeholder ? styleOf(el, '::placeholder') : s, x, top);
  if (tree.activeElement === el && el.selectionStart != null) {
    const a = ctx.measureText(value.slice(0, el.selectionStart)).width, b = ctx.measureText(value.slice(0, el.selectionEnd)).width;
    if (a !== b) { ctx.fillStyle = 'rgba(90,130,255,.4)'; ctx.fillRect(x + a, top, b - a, px(s.fontSize)); }
    else if (performance.now() % 1000 < 500) { ctx.fillStyle = s.color; ctx.fillRect(x + a, top, 1, px(s.fontSize)); }
    animated = true; live.add(el);
  }
  ctx.restore();
}
function draw(ctx, el, inherited = new DOMMatrix()) {
  if (clipRect) {
    const e = extents.get(el);
    if (e && (e.x1 < clipRect.x0 || e.x0 > clipRect.x1 || e.y1 < clipRect.y0 || e.y0 > clipRect.y1)) return null; // (unknown extent: draw it)
  }
  const s = styleOf(el), bounds = el.getBoundingClientRect();
  const own = s.transform === 'none' ? new DOMMatrix() : new DOMMatrix(s.transform);
  const matrix = inherited.multiply(own);
  const w = s.width === 'auto' ? el.offsetWidth || bounds.width : px(s.width), h = s.height === 'auto' ? el.offsetHeight || bounds.height : px(s.height);
  matrix.e = bounds.x - Math.min(0,matrix.a*w) - Math.min(0,matrix.c*h);
  matrix.f = bounds.y - Math.min(0,matrix.b*w) - Math.min(0,matrix.d*h);
  const r = {x:0,y:0,width:w,height:h,right:w,bottom:h};
  if (s.display === 'none' || s.visibility === 'hidden' || (!r.width && !r.height)) return null;
  const ext = { x0: bounds.left - PAD, y0: bounds.top - PAD, x1: bounds.right + PAD, y1: bounds.bottom + PAD };
  ctx.save();
  const dpr = Math.min(2, devicePixelRatio || 1);
  ctx.setTransform(dpr*matrix.a,dpr*matrix.b,dpr*matrix.c,dpr*matrix.d,dpr*matrix.e,dpr*matrix.f);
  ctx.imageSmoothingEnabled = s.imageRendering !== 'pixelated';
  ctx.globalAlpha *= Number(s.opacity);
  if (!ctx.globalAlpha) { ctx.restore(); extents.set(el, ext); return ext; }
  if (s.mixBlendMode !== 'normal') ctx.globalCompositeOperation = s.mixBlendMode;
  if (s.filter !== 'none') ctx.filter = s.filter;
  box(ctx, s, r);
  if (/hidden|scroll|auto/.test(s.overflow)) { ctx.beginPath(); ctx.rect(r.x, r.y, r.width, r.height); ctx.clip(); }
  pseudo(ctx, el, '::before', r);
  if (el.tagName === 'IMG' && el.complete && el.naturalWidth) { ctx.imageSmoothingEnabled = s.imageRendering !== 'pixelated'; ctx.drawImage(el, r.x, r.y, r.width, r.height); }
  else if (el.tagName === 'CANVAS') { ctx.imageSmoothingEnabled = s.imageRendering !== 'pixelated'; ctx.drawImage(el, r.x, r.y, r.width, r.height); animated = true; live.add(el); }
  else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') control(ctx, el, s, r);
  else if (el.tagName === 'svg') {
    const key = new XMLSerializer().serializeToString(el).replace(/currentColor/g, s.color);
    let img = assets.get(key);
    if (!img) { img = new Image(); img.onload = () => { dirty = true; }; img.src = `data:image/svg+xml,${encodeURIComponent(key)}`; assets.set(key, img); }
    if (img.complete && img.naturalWidth) ctx.drawImage(img, r.x, r.y, r.width, r.height);
  } else {
    const children = [...el.childNodes];
    // Position stacking within each layout container (tabs, tooltip, cursor).
    children.sort((a, b) => (a.nodeType === 1 ? px(styleOf(a).zIndex) : 0) - (b.nodeType === 1 ? px(styleOf(b).zIndex) : 0));
    for (const child of children) {
      if (child.nodeType === 1) {
        const c = draw(ctx, child, matrix);
        if (c) { ext.x0 = Math.min(ext.x0, c.x0); ext.y0 = Math.min(ext.y0, c.y0); ext.x1 = Math.max(ext.x1, c.x1); ext.y1 = Math.max(ext.y1, c.y1); }
      } else if (child.nodeType === 3) {
        // Text can run past its element's box.
        const t = textNode(ctx, child, s, matrix);
        if (t && (t.width || t.height)) { ext.x0 = Math.min(ext.x0, t.left - PAD); ext.y0 = Math.min(ext.y0, t.top - PAD); ext.x1 = Math.max(ext.x1, t.right + PAD); ext.y1 = Math.max(ext.y1, t.bottom + PAD); }
      }
    }
  }
  pseudo(ctx, el, '::after', r);
  if (el.scrollHeight > el.clientHeight && /auto|scroll/.test(s.overflowY)) {
    const width = 6 * (px(getComputedStyle(host).getPropertyValue('--gs')) || 1), height = Math.max(12, r.height * el.clientHeight / el.scrollHeight);
    ctx.fillStyle = '#000'; ctx.fillRect(r.right - width, r.y, width, r.height);
    ctx.fillStyle = '#c0c0c0'; ctx.fillRect(r.right - width, r.y + (r.height - height) * el.scrollTop / (el.scrollHeight - el.clientHeight), width, height);
  }
  ctx.restore();
  if (!clipRect) extents.set(el, ext);
  return ext;
}
export function paint() {
  if (!context) return;
  const running = layout.getAnimations({subtree:true}).filter(a => a.playState === 'running');
  // Last paint's animated elements too: one that just finished still needs its final look drawn.
  const targets = [...new Set([...running.map(a => a.effect && a.effect.target).filter(Boolean), ...lastTargets])];
  lastTargets = running.map(a => a.effect && a.effect.target).filter(Boolean);
  const dpr = Math.min(2, devicePixelRatio || 1), w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  const size = `${w}x${h}x${innerWidth}x${innerHeight}`;
  let clip = null;
  if (!dirty && size === lastSize) {
    // Only animations moved: the union of their areas now and as last painted (text and children
    // included), the live canvases and carets, and last frame's area (anything that moved away).
    const add = (x0, y0, x1, y1) => { clip = clip ? { x0: Math.min(clip.x0, x0), y0: Math.min(clip.y0, y0), x1: Math.max(clip.x1, x1), y1: Math.max(clip.y1, y1) } : { x0, y0, x1, y1 }; };
    for (const el of [...targets, ...live]) {
      if (!el.isConnected) continue;
      const b = el.getBoundingClientRect(), e = extents.get(el);
      if (b.width || b.height) add(b.left - PAD, b.top - PAD, b.right + PAD, b.bottom + PAD);
      if (e) add(e.x0, e.y0, e.x1, e.y1);
    }
    if (clip && lastClip) add(lastClip.x0, lastClip.y0, lastClip.x1, lastClip.y1);
    if (clip) clip = { x0: Math.floor(clip.x0), y0: Math.floor(clip.y0), x1: Math.ceil(clip.x1), y1: Math.ceil(clip.y1) };
  }
  lastClip = clip;
  dirty = false;
  animated = running.length > 0;
  if (output.width !== w || output.height !== h) { output.width = w; output.height = h; }
  lastSize = size;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (clip) {
    context.save();
    context.beginPath(); context.rect(clip.x0, clip.y0, clip.x1 - clip.x0, clip.y1 - clip.y0); context.clip();
    context.clearRect(clip.x0, clip.y0, clip.x1 - clip.x0, clip.y1 - clip.y0);
    clipRect = clip;
  } else {
    context.clearRect(0, 0, innerWidth, innerHeight);
    live = new Set();
  }
  const children = [...layout.children].sort((a, b) => px(styleOf(a).zIndex) - px(styleOf(b).zIndex));
  try { for (const child of children) draw(context, child); } finally { clipRect = null; }
  if (clip) context.restore();
  if (live.size) animated = true;
  if (hint) {
    const s = getComputedStyle(host); context.font = `${s.fontSize} ${s.fontFamily}`;
    const width = Math.min(innerWidth - 16, context.measureText(hint).width + 16), height = px(s.fontSize) + 12;
    const x = Math.max(8, Math.min(innerWidth - width - 8, pointer.x + 12)), y = Math.max(8, Math.min(innerHeight - height - 8, pointer.y + 20));
    context.fillStyle = '#100010'; context.fillRect(x, y, width, height); context.strokeStyle = '#703090'; context.strokeRect(x, y, width, height);
    context.save(); context.beginPath(); context.rect(x, y, width, height); context.clip(); text(context, hint, s, x + 8, y + 6); context.restore();
  }
}

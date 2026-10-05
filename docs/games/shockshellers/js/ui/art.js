// Drawn artwork for the interface: the logo (bubbly cream letters, dark-brown outline, the O in
// SHOCK is a fried egg; GDD §25) and the How to Play card (keyboard and mouse from the live
// bindings, an egg with a target; GDD §19.2). Drawn on canvases so nothing is fetched.
import { keyLabel, ACTION_NAMES } from '../game/input.js?v=muv8budv';

function word(x, text, cx, y, size, align) {
  x.font = `${size}px s, sans-serif`; x.textAlign = align; x.textBaseline = 'alphabetic'; x.lineJoin = 'round';
  x.lineWidth = size * 0.16; x.strokeStyle = '#5e321b'; x.fillStyle = '#5e321b';
  x.strokeText(text, cx + size * 0.04, y + size * 0.08); x.fillText(text, cx + size * 0.04, y + size * 0.08);
  x.strokeText(text, cx, y); x.fillStyle = '#fbeedd'; x.fillText(text, cx, y);
}
function friedEgg(x, cx, cy, r) {
  x.save(); x.translate(cx, cy); x.rotate(-0.14);
  x.beginPath();
  const pts = 14;
  for (let i = 0; i <= pts; i++) { const a = i / pts * Math.PI * 2, rr = r * (0.9 + 0.12 * Math.sin(i * 2.7) + 0.06 * Math.cos(i * 5.1)); const px = Math.cos(a) * rr * 1.08, py = Math.sin(a) * rr * 0.92; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
  x.closePath();
  x.lineWidth = r * 0.16; x.strokeStyle = '#5e321b'; x.lineJoin = 'round'; x.stroke(); x.fillStyle = '#fffaf0'; x.fill();
  const g = x.createRadialGradient(-r * 0.12, -r * 0.14, r * 0.05, 0, 0, r * 0.45);
  g.addColorStop(0, '#fff2a0'); g.addColorStop(1, '#f7a91e');
  x.beginPath(); x.arc(r * 0.04, r * 0.02, r * 0.42, 0, Math.PI * 2); x.fillStyle = g; x.fill(); x.lineWidth = r * 0.1; x.stroke();
  x.beginPath(); x.ellipse(-r * 0.1, -r * 0.12, r * 0.12, r * 0.07, -0.5, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,.85)'; x.fill();
  x.restore();
}
export function drawLogo(canvas) {
  const x = canvas.getContext('2d'), W = canvas.width, H = canvas.height, s = H / 340;
  x.clearRect(0, 0, W, H);
  const y1 = 150 * s, size = 128 * s, cx = W / 2;
  word(x, 'SH', cx - 70 * s, y1, size, 'right');
  word(x, 'CK', cx + 70 * s, y1, size, 'left');
  friedEgg(x, cx, y1 - 44 * s, 66 * s);
  word(x, 'SHELLERS', cx, y1 + 150 * s, 118 * s, 'center');
}

const KEY = (x, cx, cy, w, h, label, hi) => {
  x.fillStyle = hi ? '#f39a25' : '#fff'; x.strokeStyle = '#0e3440'; x.lineWidth = 4;
  x.beginPath(); x.roundRect(cx, cy, w, h, 10); x.fill(); x.stroke();
  x.fillStyle = hi ? '#fff' : '#0e3440'; x.font = `900 ${Math.min(26, h * 0.42)}px n, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(label, cx + w / 2, cy + h / 2 + 1);
};
export function drawHowTo(canvas, keys) {
  const x = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  x.clearRect(0, 0, W, H);
  const k = a => keyLabel(keys[a]);
  const cap = (t, cx, cy) => { x.fillStyle = '#0e3440'; x.font = '800 20px n, sans-serif'; x.textAlign = 'center'; x.fillText(t, cx, cy); };
  // Movement cluster.
  KEY(x, 120, 40, 74, 64, k('up'), true); cap(ACTION_NAMES.up, 157, 30);
  KEY(x, 40, 112, 74, 64, k('left'), true); KEY(x, 120, 112, 74, 64, k('down'), true); KEY(x, 200, 112, 74, 64, k('right'), true);
  cap('Move', 157, 200);
  KEY(x, 40, 230, 234, 56, k('jump')); cap(ACTION_NAMES.jump, 157, 304);
  KEY(x, 300, 40, 74, 64, k('reload')); cap(ACTION_NAMES.reload, 337, 122);
  KEY(x, 300, 140, 74, 64, k('swap')); cap('Swap', 337, 222);
  KEY(x, 400, 40, 74, 64, k('grenade')); cap('Grenade', 437, 122);
  KEY(x, 400, 140, 74, 64, k('melee')); cap(ACTION_NAMES.melee, 437, 222);
  KEY(x, 300, 240, 174, 56, 'Enter'); cap('Chat', 387, 314);
  KEY(x, 40, 340, 140, 56, 'Esc'); cap('Pause', 110, 414);
  KEY(x, 200, 340, 140, 56, 'J'); cap('Calculator', 270, 414);
  // Mouse.
  x.fillStyle = '#fff'; x.strokeStyle = '#0e3440'; x.lineWidth = 5;
  x.beginPath(); x.roundRect(540, 40, 150, 230, 75); x.fill(); x.stroke();
  x.beginPath(); x.moveTo(615, 40); x.lineTo(615, 130); x.moveTo(540, 130); x.lineTo(690, 130); x.stroke();
  x.fillStyle = '#f39a25'; x.beginPath(); x.roundRect(545, 45, 66, 82, [70, 0, 0, 0]); x.fill();
  cap(keys.fire === 'M0' ? 'Fire' : 'Left', 500, 90); cap(keys.scope === 'M2' ? 'Aim' : 'Right', 735, 90);
  cap('Look', 615, 300);
  // Egg with a target over its centre.
  const ex = 900, ey = 230;
  x.beginPath(); x.ellipse(ex, ey + 10, 90, 118, 0, 0, Math.PI * 2);
  const g = x.createRadialGradient(ex - 30, ey - 40, 10, ex, ey, 130); g.addColorStop(0, '#fffaf0'); g.addColorStop(1, '#e8d6b8');
  x.fillStyle = g; x.fill(); x.lineWidth = 5; x.strokeStyle = '#0e3440'; x.stroke();
  x.strokeStyle = '#e2463a'; x.lineWidth = 6;
  for (const r of [18, 44, 70]) { x.beginPath(); x.arc(ex, ey + 10, r, 0, Math.PI * 2); x.stroke(); }
  x.beginPath(); x.moveTo(ex - 90, ey + 10); x.lineTo(ex + 90, ey + 10); x.moveTo(ex, ey - 80); x.lineTo(ex, ey + 100); x.stroke();
}

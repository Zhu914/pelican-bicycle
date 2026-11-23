// Every texture in the scene is painted at runtime on a 2D canvas: no image assets.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

let maxAniso = 4;
export const setMaxAnisotropy = (n) => { maxAniso = Math.min(8, n || 1); };
export const FONT = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "Segoe UI", Roboto, sans-serif';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { srgb = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = maxAniso;
  return t;
}

/** Random speckle that wraps across tile edges so the texture stays seamless. */
function speckle(g, w, h, n, colors, rng, size = [1, 2.4], alpha = [0.05, 0.3]) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[(rng() * colors.length) | 0];
    g.globalAlpha = alpha[0] + rng() * (alpha[1] - alpha[0]);
    const s = size[0] + rng() * (size[1] - size[0]);
    const x = rng() * w;
    const y = rng() * h;
    g.fillRect(x, y, s, s);
    if (x > w - 3) g.fillRect(x - w, y, s, s);
    if (y > h - 3) g.fillRect(x, y - h, s, s);
  }
  g.globalAlpha = 1;
}

/** 10 m x 5 m asphalt tile: dashed yellow centre line, white edge lines. */
export function roadTexture() {
  const [c, g] = canvas(512, 256);
  const rng = mulberry32(7);
  g.fillStyle = '#2c2e33';
  g.fillRect(0, 0, 512, 256);
  speckle(g, 512, 256, 5200, ['#565a61', '#2b2d32', '#6a6e75', '#1f2125'], rng, [1, 3], [0.12, 0.4]);
  for (let i = 0; i < 5; i++) {
    g.fillStyle = 'rgba(18,19,22,0.10)';
    g.beginPath();
    g.ellipse(rng() * 512, rng() * 256, 30 + rng() * 60, 10 + rng() * 20, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  const lineY = (z) => (256 * (z + 3.75)) / 5;
  const line = (y, w, color) => { g.fillStyle = color; g.fillRect(0, y - w / 2, 512, w); };
  line(lineY(1.12), 6, '#e9e6dc');
  line(lineY(-3.62), 6, '#e9e6dc');
  g.fillStyle = '#e6b23a';
  g.fillRect(0, lineY(-1.25) - 4, 512 * 0.4, 8);
  speckle(g, 512, 256, 1400, ['#3a3d43', '#4a4d54'], rng, [1, 2.5], [0.15, 0.45]);
  return tex(c);
}

export function sidewalkTexture() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(11);
  g.fillStyle = '#a39a88';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 2600, ['#8f8676', '#b8af9d', '#7d7466'], rng, [1, 2.2], [0.15, 0.45]);
  g.fillStyle = 'rgba(70,66,60,0.28)';
  g.fillRect(0, 0, 3, 256);
  g.fillRect(0, 126, 256, 3);
  return tex(c);
}

export function sandTexture() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(23);
  g.fillStyle = '#e2cda2';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 4200, ['#cdb586', '#f0e0bb', '#bda57a'], rng, [1, 2.2], [0.2, 0.55]);
  speckle(g, 256, 256, 60, ['#fff7e6'], rng, [1.4, 2.6], [0.5, 0.9]);
  return tex(c);
}

export function grassGroundTexture() {
  const [c, g] = canvas(256, 256);
  const rng = mulberry32(31);
  g.fillStyle = '#5f8c43';
  g.fillRect(0, 0, 256, 256);
  speckle(g, 256, 256, 5200, ['#4a7233', '#79a552', '#3f6429', '#8db35f'], rng, [1, 3], [0.2, 0.6]);
  return tex(c);
}

export function wickerTexture() {
  const [c, g] = canvas(128, 128);
  const s = 16;
  for (let x = 0; x < 128; x += s) {
    const grad = g.createLinearGradient(x, 0, x + s, 0);
    grad.addColorStop(0, '#6f4a22');
    grad.addColorStop(0.5, '#c48f4f');
    grad.addColorStop(1, '#6f4a22');
    g.fillStyle = grad;
    g.fillRect(x, 0, s, 128);
  }
  for (let y = 0; y < 128; y += s) {
    for (let x = 0; x < 128; x += s) {
      if (((x / s + y / s) & 1) === 0) {
        const grad = g.createLinearGradient(0, y, 0, y + s);
        grad.addColorStop(0, '#5e3d1b');
        grad.addColorStop(0.5, '#d9a55f');
        grad.addColorStop(1, '#5e3d1b');
        g.fillStyle = grad;
        g.fillRect(x, y, s, s);
      }
    }
  }
  return tex(c);
}

/** v runs around the tyre tube: black tread, cream sidewalls. */
export function tireTexture() {
  const [c, g] = canvas(64, 128);
  g.fillStyle = '#17181a';
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#d9bd8f';
  g.fillRect(0, 13, 64, 33);
  g.fillRect(0, 82, 64, 33);
  g.fillStyle = 'rgba(70,70,74,0.5)';
  for (let x = 0; x < 64; x += 6) {
    g.fillRect(x, 0, 2, 11);
    g.fillRect(x + 3, 117, 2, 11);
  }
  return tex(c);
}

export function scaleTexture() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#e98b2f';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(150,70,10,0.55)';
  g.lineWidth = 1.6;
  for (let y = 0; y <= 64; y += 8) {
    for (let x = 0; x <= 64; x += 8) {
      const ox = (y / 8) % 2 ? 4 : 0;
      g.beginPath();
      g.arc(x + ox, y, 4.4, 0, Math.PI);
      g.stroke();
    }
  }
  return tex(c, { srgb: false });
}

export function plateTexture(text = 'PELI·1') {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#f6f2e6';
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#1d1f24';
  g.lineWidth = 8;
  g.strokeRect(6, 6, 244, 116);
  g.fillStyle = '#1d1f24';
  g.font = `800 66px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 70);
  return tex(c, { wrap: false });
}

/** Yellow diamond warning sign: a pelican on a bicycle, drawn with paths. */
export function signTexture() {
  const [c, g] = canvas(512, 512);
  g.translate(256, 256);
  g.rotate(Math.PI / 4);
  g.fillStyle = '#f8c800';
  g.strokeStyle = '#141414';
  g.lineWidth = 16;
  g.lineJoin = 'round';
  g.fillRect(-150, -150, 300, 300);
  g.strokeRect(-150, -150, 300, 300);
  g.rotate(-Math.PI / 4);
  g.translate(-256, -256);
  g.strokeStyle = '#141414';
  g.fillStyle = '#141414';
  g.lineWidth = 11;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const line = (a, b, c2, d) => { g.beginPath(); g.moveTo(a, b); g.lineTo(c2, d); g.stroke(); };
  // wheels
  for (const x of [176, 336]) { g.beginPath(); g.arc(x, 344, 46, 0, Math.PI * 2); g.stroke(); }
  // frame
  line(176, 344, 258, 344); line(258, 344, 232, 254); line(232, 254, 176, 344);
  line(258, 344, 316, 250); line(316, 250, 336, 344); line(232, 254, 316, 250);
  line(316, 250, 308, 232); line(300, 236, 330, 228);
  line(232, 254, 222, 240); line(206, 240, 236, 238);
  // pelican: body, neck, head, beak
  g.beginPath(); g.ellipse(222, 208, 50, 34, -0.25, 0, Math.PI * 2); g.fill();
  g.lineWidth = 20;
  g.beginPath(); g.moveTo(256, 196); g.quadraticCurveTo(292, 170, 296, 124); g.stroke();
  g.beginPath(); g.arc(300, 112, 21, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(316, 104); g.lineTo(408, 132); g.lineTo(318, 132); g.closePath(); g.fill();
  // leg to pedal
  g.lineWidth = 11;
  line(232, 236, 250, 300); line(250, 300, 258, 344);
  g.beginPath(); g.arc(258, 344, 9, 0, Math.PI * 2); g.fill();
  return tex(c, { wrap: false });
}

export function signPlateTexture(text) {
  const [c, g] = canvas(512, 128);
  g.fillStyle = '#f6f2e6';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#141414';
  g.lineWidth = 8;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#141414';
  g.font = `700 64px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 70);
  return tex(c, { wrap: false });
}

export function stripesTexture(color) {
  const [c, g] = canvas(256, 32);
  for (let i = 0; i < 10; i++) {
    g.fillStyle = i % 2 ? color : '#fbf6ec';
    g.fillRect(i * 25.6, 0, 26, 32);
  }
  return tex(c);
}

/** Radial alpha ramp for the spinning-wheel blur disc. */
export function blurTexture() {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(0,0,0,0)');
  r.addColorStop(0.18, 'rgba(90,90,90,0.25)');
  r.addColorStop(0.85, 'rgba(200,200,200,0.7)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return tex(c, { srgb: false, wrap: false });
}

export function grassBladeTexture() {
  const [c, g] = canvas(64, 128);
  g.clearRect(0, 0, 64, 128);
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, '#2c5520');
  grad.addColorStop(0.6, '#5f9a3c');
  grad.addColorStop(1, '#a6cf66');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(25, 128);
  g.quadraticCurveTo(16, 70, 40, 4);
  g.quadraticCurveTo(42, 66, 41, 128);
  g.closePath();
  g.fill();
  return tex(c, { wrap: false });
}

export function glowTexture() {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.22, 'rgba(255,255,255,0.72)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return tex(c, { srgb: false, wrap: false });
}

export function streakTexture() {
  const [c, g] = canvas(64, 16);
  g.save();
  g.translate(32, 8);
  g.scale(1, 0.22);
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(-32, -32, 64, 64);
  g.restore();
  return tex(c, { srgb: false, wrap: false });
}

export function puffTexture() {
  const [c, g] = canvas(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  return tex(c, { srgb: false, wrap: false });
}

export function featherTexture() {
  const [c, g] = canvas(64, 64);
  g.translate(32, 32);
  g.fillStyle = '#fffaf0';
  g.beginPath();
  g.moveTo(0, -28);
  g.bezierCurveTo(14, -16, 13, 12, 0, 28);
  g.bezierCurveTo(-13, 12, -14, -16, 0, -28);
  g.fill();
  g.strokeStyle = 'rgba(120,110,100,0.55)';
  g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(0, -26); g.lineTo(0, 30); g.stroke();
  g.strokeStyle = 'rgba(150,140,130,0.35)';
  g.lineWidth = 1;
  for (let y = -18; y < 22; y += 5) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(9, y + 7); g.moveTo(0, y); g.lineTo(-9, y + 7); g.stroke();
  }
  return tex(c, { wrap: false });
}

export function noteTexture() {
  const [c, g] = canvas(64, 64);
  g.font = `700 50px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(40,24,12,0.85)';
  g.strokeText('\u266A', 32, 34);
  g.fillStyle = '#fff3c4';
  g.fillText('\u266A', 32, 34);
  return tex(c, { wrap: false });
}

export function lampPoolTexture() {
  const [c, g] = canvas(128, 128);
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,214,150,0.85)');
  r.addColorStop(0.45, 'rgba(255,190,110,0.28)');
  r.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return tex(c, { wrap: false });
}

/** Comic speech bubble with a tail; redrawn when the language changes. */
export function bubbleTexture(text) {
  const [c, g] = canvas(256, 160);
  g.lineJoin = 'round';
  g.fillStyle = '#fffdf6';
  g.strokeStyle = '#1f1a1c';
  g.lineWidth = 9;
  // bubble first, then the tail (white fill erases the outline where they join)
  g.beginPath();
  g.roundRect(14, 12, 228, 98, 30);
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(60, 116); g.lineTo(40, 150); g.lineTo(114, 116); g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(68, 109); g.lineTo(40, 150); g.lineTo(106, 109);
  g.stroke();
  g.fillStyle = '#1f1a1c';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 62px ${FONT}`;
  g.fillText(text, 128, 62);
  return tex(c, { wrap: false });
}

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap = (v, m) => ((v % m) + m) % m;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
/** Shortest signed difference between two angles. */
export const angleDelta = (a, b) => wrap(b - a + Math.PI, TAU) - Math.PI;

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 3D value noise in [-1, 1]. */
export function noise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const h = (i, j, k) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7 + 0.0123) * 43758.5453;
    return s - Math.floor(s);
  };
  const a = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u);
  const b = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u);
  const c = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u);
  const d = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u);
  return (lerp(lerp(a, b, v), lerp(c, d, v), w) - 0.5) * 2;
}

export class Emitter {
  constructor() {
    this.m = new Map();
  }
  on(name, fn) {
    if (!this.m.has(name)) this.m.set(name, new Set());
    this.m.get(name).add(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) {
    this.m.get(name)?.delete(fn);
  }
  emit(name, ...args) {
    const set = this.m.get(name);
    if (set) for (const fn of set) fn(...args);
  }
}

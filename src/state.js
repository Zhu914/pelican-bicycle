// Shared app state. `speed` is in km/h (slider units); `time` is a day fraction:
// 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight.
import { Emitter, clamp, wrap } from './core/util.js';

export const MAX_SPEED = 12.5;        // m/s = 45 km/h
export const DEFAULT_TIME = 0.455;    // late golden hour: low warm sun, long shadows

export const COLORS = {
  teal: 0x19a7a0, coral: 0xef5b3f, cream: 0xf3e9d2, navy: 0x2740a8, rose: 0xd8346b, gold: 0xf2b134,
};

export const CAMERAS = {
  hero:   { p: [5.0, 1.9, -3.4], t: [-0.05, 1.2, 0] },
  side:   { p: [0.55, 1.25, -4.15], t: [0.55, 1.1, 0] },
  front:  { p: [6.3, 1.6, -0.7], t: [0, 1.35, 0] },
  chase:  { p: [-5.4, 2.3, -2.6], t: [1.0, 1.25, 1.2] },
  face:   { p: [1.5, 2.12, -1.25], t: [0.1, 1.95, 0] },
  detail: { p: [0.35, 0.6, 1.95], t: [-0.12, 0.5, 0] },
  top:    { p: [1.6, 7.6, 1.0], t: [0, 0.6, 0] },
  wide:   { p: [-3.0, 1.75, -2.9], t: [0.5, 1.15, 4.8] },
};
export const CAMERA_ORDER = Object.keys(CAMERAS);
export const CINE_ORDER = ['wide', 'chase', 'side', 'face', 'detail', 'front', 'hero'];

export const state = {
  speed: 15,
  time: DEFAULT_TIME,
  autoTime: false,
  cam: 'hero',
  autoRotate: true,
  cinematic: false,
  color: 'teal',
  bloom: true,
  wire: false,
  slow: false,
  paused: false,
  ui: true,
  sound: false,
};

export const bus = new Emitter();

export function set(key, value) {
  if (state[key] === value) return false;
  state[key] = value;
  bus.emit(key, value);
  bus.emit('*', key, value);
  return true;
}

export function readURL() {
  const q = new URLSearchParams(location.search);
  const num = (k) => {
    const v = parseFloat(q.get(k));
    return Number.isFinite(v) ? v : null;
  };
  const speed = num('speed');
  if (speed !== null) state.speed = clamp(speed, 0, 45);
  const time = num('time');
  if (time !== null) state.time = wrap(time, 1);
  const cam = q.get('cam');
  if (CAMERAS[cam]) state.cam = cam;
  const color = q.get('color');
  if (COLORS[color]) state.color = color;
  if (q.get('autotime') === '1') state.autoTime = true;
  if (q.get('ui') === '0') state.ui = false;
  if (q.get('rotate') === '0') state.autoRotate = false;
  if (q.get('cine') === '1') state.cinematic = true;
}

let timer = 0;
export function writeURL() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const q = new URLSearchParams();
    q.set('speed', String(Math.round(state.speed)));
    q.set('time', state.time.toFixed(3));
    q.set('cam', state.cam);
    q.set('color', state.color);
    if (getLangSafe() === 'en') q.set('lang', 'en');
    if (state.autoTime) q.set('autotime', '1');
    if (!state.ui) q.set('ui', '0');
    if (!state.autoRotate) q.set('rotate', '0');
    if (state.cinematic) q.set('cine', '1');
    if (/[?&]debug=1/.test(location.search)) q.set('debug', '1');
    try {
      history.replaceState(null, '', `${location.pathname}?${q}`);
    } catch {
      /* replaceState can be blocked in sandboxed frames */
    }
  }, 500);
}

function getLangSafe() {
  return document.documentElement.lang === 'en' ? 'en' : 'zh';
}

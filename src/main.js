// Bootstrap: renderer, camera, the world, input, UI bindings and the frame loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBicycle, B } from './bicycle.js';
import { createPelican } from './pelican.js';
import { createEnvironment } from './environment.js';
import { createParticles } from './particles.js';
import { createPostFX } from './postfx.js';
import { AudioEngine } from './audio.js';
import {
  state, set, bus, MAX_SPEED, DEFAULT_TIME, CAMERAS, CAMERA_ORDER, CINE_ORDER, COLORS, readURL, writeURL,
} from './state.js';
import { t, getLang, setLang, detectLang, timeLabel } from './i18n.js';
import { TAU, clamp, damp, smoothstep, wrap, angleDelta, easeInOutCubic } from './core/util.js';
import { setMaxAnisotropy } from './core/textures.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');

// ?debug=1 exposes the scene on window.__pelican and keeps the last console
// warnings and errors on window.__log, for troubleshooting.
const DEBUG = /[?&]debug=1/.test(location.search);
if (DEBUG) {
  const log = (window.__log = []);
  const push = (line) => {
    log.push(line.length > 1200 ? `${line.slice(0, 1200)}…` : line);
    if (log.length > 40) log.shift();
  };
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      push(args.map((a) => (a && a.stack) || String(a)).join(' '));
      original(...args);
    };
  }
  addEventListener('error', (e) => push(`onerror: ${e.message} (${e.filename}:${e.lineno})`));
  addEventListener('unhandledrejection', (e) => push(`unhandled rejection: ${e.reason}`));
}

function showFallback() {
  $('fallback').hidden = false;
  $('loader').style.display = 'none';
}

const hasWebGL2 = (() => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
})();

if (!hasWebGL2) {
  setLang(detectLang());
  showFallback();
} else {
  try {
    boot();
  } catch (err) {
    console.error(err);
    showFallback();
  }
}

function boot() {
  readURL();
  setLang(detectLang());
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // same query as the compact block in style.css
  const COMPACT = '(max-width: 720px), (orientation: portrait) and (max-width: 1024px), (max-height: 480px)';
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (!state.ui) document.body.classList.add('ui-hidden');
  if (reduced) state.autoRotate = false;
  console.info('鹈鹕骑士 · Pelican Rider  build', __BUILD__);

  // ---------- renderer ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

  // Quality only ever steps down, after a warm-up, when frames are consistently slow.
  const TIERS = [
    { dpr: 1, msaa: 0, bloom: false, shadow: 1024, grass: 1500 },
    { dpr: 1.5, msaa: 2, bloom: true, shadow: 1024, grass: 3000 },
    { dpr: 2, msaa: 4, bloom: true, shadow: 2048, grass: 5200 },
  ];
  let tier = coarse || (navigator.hardwareConcurrency || 8) <= 4 ? 1 : 2;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 3200);
  camera.position.fromArray(CAMERAS[state.cam].p);
  const controls = new OrbitControls(camera, canvas);
  controls.target.fromArray(CAMERAS[state.cam].t);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 0.9;
  controls.maxDistance = 16;
  controls.maxPolarAngle = 1.53;
  controls.minPolarAngle = 0.06;
  controls.zoomSpeed = 0.8;
  controls.autoRotateSpeed = 0.4;
  controls.update();

  // ---------- the world ----------
  const env = createEnvironment(scene, renderer, { grass: TIERS[2].grass, shadow: TIERS[tier].shadow });
  const bike = createBicycle();
  const pelican = createPelican();
  scene.add(bike.group, pelican.group);
  const particles = createParticles(scene);
  const fx = createPostFX(renderer, scene, camera, { msaa: TIERS[tier].msaa });
  const audio = new AudioEngine();
  bike.setColor(COLORS[state.color]);
  pelican.setLang(getLang());
  env.hooks.splash = (x, y, z) => {
    particles.splash(x, y, z);
    audio.splash();
  };
  const pickMeshes = [...pelican.pickMeshes, ...bike.pickMeshes];
  const materials = new Set();
  scene.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });

  // ---------- UI ----------
  const ui = {
    speed: $('speedRange'), speedVal: $('speedVal'), time: $('timeRange'), timeVal: $('timeVal'), autoTime: $('autoTime'),
    bloom: $('bloomChk'), wire: $('wireChk'), slow: $('slowChk'), autoRot: $('autoRotChk'), cine: $('cineChk'),
    sound: $('soundBtn'), night: $('nightBtn'), panel: $('panel'), panelToggle: $('panelToggle'), lang: $('langBtn'),
    sSpeed: $('statSpeed'), sCad: $('statCadence'), sDist: $('statDist'), sFps: $('statFps'), sMeta: $('statMeta'), toast: $('toast'),
  };
  const camButtons = [...document.querySelectorAll('.cam')];
  const swatches = $('swatches');
  const swatchEls = [];
  for (const [name, hex] of Object.entries(COLORS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.setProperty('--c', `#${hex.toString(16).padStart(6, '0')}`);
    b.dataset.color = name;
    b.setAttribute('aria-label', name);
    b.addEventListener('click', () => set('color', name));
    swatches.appendChild(b);
    swatchEls.push(b);
  }

  let toastTimer = 0;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('is-on'), 1600);
  }

  let fps = 60;
  let drawCalls = 0;
  const QUALITY_KEYS = ['qLow', 'qMid', 'qHigh'];
  function refreshHUD() {
    const kmh = sim.speed * 3.6;
    ui.sSpeed.textContent = kmh.toFixed(kmh < 10 ? 1 : 0);
    ui.sCad.textContent = String(Math.round(sim.coasting ? 0 : (sim.cadence * 60) / TAU));
    ui.sDist.textContent = (sim.dist / 1000).toFixed(2);
    ui.sFps.textContent = String(Math.round(fps));
    ui.sMeta.textContent = `${t(QUALITY_KEYS[tier])} · ${drawCalls} draw`;
    if (document.activeElement !== ui.time) ui.time.value = String(Math.round(sim.time * 1000));
    ui.timeVal.textContent = timeLabel(sim.time);
    const night = sim.time > 0.55 && sim.time < 0.95;
    ui.night.textContent = t(night ? 'day' : 'night');
  }

  function syncLang() {
    pelican.setLang(getLang());
    const zh = getLang() === 'zh';
    ui.lang.textContent = zh ? 'EN' : '中文';
    ui.lang.setAttribute('aria-label', zh ? 'Switch to English' : '切换到中文');
    ui.sound.querySelector('span').textContent = t(state.sound ? 'soundOn' : 'soundOff');
    refreshHUD();
  }

  let applied = '';
  function applyTier() {
    const dpr = Math.min(devicePixelRatio || 1, TIERS[tier].dpr);
    const key = `${innerWidth}x${innerHeight}@${dpr}#${tier}`;
    if (key === applied) return;
    applied = key;
    const T = TIERS[tier];
    renderer.setPixelRatio(dpr);
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    fx.composer.setPixelRatio(renderer.getPixelRatio());
    fx.setSize(innerWidth, innerHeight);
    fx.setMSAA(T.msaa);
    env.setGrassCount(T.grass);
    env.setShadowSize(T.shadow);
    applyFit();
  }

  // ---------- simulation ----------
  const sim = {
    speed: 0, crank: 0, scroll: 0, dist: 0, t: 0, sprint: 0, coasting: false, cadence: 0, decel: 0,
    time: state.time, timeTarget: state.time,
  };
  const keys = { up: false, down: false };
  const tmp = new THREE.Vector3();

  function ringBell() {
    bike.ring();
    audio.bell();
    bike.bellWorld(tmp);
    particles.notesAt(tmp.x, tmp.y + 0.05, tmp.z, 3);
    toast(t('toastBell'));
  }

  function honk(sprint) {
    if (sprint) sim.sprint = Math.max(sim.sprint, 2.6);
    if (!pelican.canHonk()) return;
    pelican.honk();
    audio.honk();
    pelican.tailWorld(tmp);
    particles.featherBurst(sprint ? 7 : 3, tmp);
    toast(t('toastHonk'));
  }

  function pokeFish() {
    bike.flopFish();
    bike.fishWorld(tmp);
    particles.splash(tmp.x, tmp.y + 0.22, tmp.z);
    audio.splash();
    pelican.lookAt(tmp, 1.8);
  }

  function toggleNight() {
    set('time', sim.time > 0.55 && sim.time < 0.95 ? DEFAULT_TIME : 0.72);
  }

  // ---------- camera ----------
  const _sph0 = new THREE.Spherical();
  const _sph1 = new THREE.Spherical();
  const _sph = new THREE.Spherical();
  const _off = new THREE.Vector3();
  let camTween = null;
  let cineTimer = 0;
  // Portrait screens have a narrow horizontal field of view, so the camera is kept
  // further out to frame the same width (fitK scales every preset's distance).
  let fitK = 1;
  function applyFit() {
    const k = camera.aspect < 1.25 ? Math.min(2, (1.25 / camera.aspect) ** 0.6) : 1;
    if (Math.abs(k - fitK) < 1e-3) return;
    camera.position.sub(controls.target).multiplyScalar(k / fitK).add(controls.target);
    fitK = k;
    camTween = null;
  }
  function goCam(name, instant = false) {
    const c = CAMERAS[name];
    if (!c) return;
    const target = new THREE.Vector3().fromArray(c.t);
    const p = new THREE.Vector3().fromArray(c.p).sub(target).multiplyScalar(fitK).add(target);
    cineTimer = 0;
    if (instant) {
      camera.position.copy(p);
      controls.target.copy(target);
      controls.update();
      camTween = null;
      return;
    }
    // orbit there instead of flying in a straight line through the subject
    _sph0.setFromVector3(_off.copy(camera.position).sub(controls.target));
    _sph1.setFromVector3(_off.copy(p).sub(target));
    camTween = { k: 0, t0: controls.target.clone(), t1: target, dTheta: angleDelta(_sph0.theta, _sph1.theta) };
  }
  function stepCamTween(rdt) {
    if (!camTween) return;
    camTween.k = Math.min(1, camTween.k + rdt / 1.5);
    const k = easeInOutCubic(camTween.k);
    controls.target.lerpVectors(camTween.t0, camTween.t1, k);
    _sph.theta = _sph0.theta + camTween.dTheta * k;
    _sph.phi = _sph0.phi + (_sph1.phi - _sph0.phi) * k;
    _sph.radius = (_sph0.radius + (_sph1.radius - _sph0.radius) * k) * (1 + 0.12 * Math.sin(Math.PI * k));
    camera.position.setFromSpherical(_sph).add(controls.target);
    if (camTween.k >= 1) camTween = null;
  }

  controls.addEventListener('start', () => {
    canvas.classList.add('is-dragging');
    camTween = null;
    if (state.autoRotate) set('autoRotate', false);
    if (state.cinematic) set('cinematic', false);
  });
  controls.addEventListener('end', () => canvas.classList.remove('is-dragging'));

  // ---------- picking ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(cx, cy) {
    ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    for (const hit of raycaster.intersectObjects(pickMeshes, false)) {
      if (hit.object.userData.pick) return hit.object.userData.pick;
    }
    return null;
  }
  const pointer = { x: 0, y: 0, fresh: false };
  let down = null;
  let hoverAt = 0;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, at: performance.now() };
    canvas.focus();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const held = performance.now() - down.at;
    down = null;
    if (moved > 8 || held > 600) return;      // that was a drag, not a click
    const hit = pickAt(e.clientX, e.clientY);
    if (hit === 'bell') ringBell();
    else if (hit === 'fish') pokeFish();
    else if (hit === 'honk') honk(false);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.fresh = true;
  });

  // ---------- keyboard ----------
  addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const tag = el?.tagName;
    // sliders and text fields keep their arrow keys; buttons and check boxes keep Space / Enter
    const ownsKeys = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'button');
    if (ownsKeys && e.code !== 'Escape') return;
    if ((tag === 'BUTTON' || (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio'))) && (e.code === 'Space' || e.code === 'Enter')) return;
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': keys.up = true; e.preventDefault(); break;
      case 'ArrowDown': case 'KeyS': keys.down = true; e.preventDefault(); break;
      case 'Space': honk(true); e.preventDefault(); break;
      case 'KeyB': ringBell(); break;
      case 'KeyN': toggleNight(); break;
      case 'KeyC': set('cam', CAMERA_ORDER[(CAMERA_ORDER.indexOf(state.cam) + 1) % CAMERA_ORDER.length]); break;
      case 'KeyP': set('paused', !state.paused); toast(t(state.paused ? 'toastPaused' : 'toastResumed')); break;
      case 'KeyH': set('ui', !state.ui); break;
      case 'KeyM': set('sound', !state.sound); break;
      case 'KeyL': setLang(getLang() === 'zh' ? 'en' : 'zh'); syncLang(); break;
      case 'KeyR': set('speed', 15); set('cam', 'hero'); break;
      case 'Escape': if (!state.ui) set('ui', true); break;
    }
  });
  addEventListener('keyup', (e) => {
    if (e.code === 'ArrowUp' || e.code === 'KeyW') keys.up = false;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') keys.down = false;
  });
  addEventListener('blur', () => { keys.up = keys.down = false; });

  // ---------- wiring controls to state ----------
  ui.speed.addEventListener('input', () => set('speed', +ui.speed.value));
  ui.time.addEventListener('input', () => set('time', +ui.time.value / 1000));
  ui.autoTime.addEventListener('change', () => set('autoTime', ui.autoTime.checked));
  ui.bloom.addEventListener('change', () => set('bloom', ui.bloom.checked));
  ui.wire.addEventListener('change', () => set('wire', ui.wire.checked));
  ui.slow.addEventListener('change', () => set('slow', ui.slow.checked));
  ui.autoRot.addEventListener('change', () => set('autoRotate', ui.autoRot.checked));
  ui.cine.addEventListener('change', () => set('cinematic', ui.cine.checked));
  for (const b of camButtons) b.addEventListener('click', () => set('cam', b.dataset.cam));
  $('bellBtn').addEventListener('click', ringBell);
  $('sprintBtn').addEventListener('click', () => honk(true));
  $('shotBtn').addEventListener('click', screenshot);
  $('shareBtn').addEventListener('click', share);
  $('hideBtn').addEventListener('click', () => set('ui', false));
  ui.sound.addEventListener('click', () => set('sound', !state.sound));
  ui.night.addEventListener('click', toggleNight);
  ui.lang.addEventListener('click', () => { setLang(getLang() === 'zh' ? 'en' : 'zh'); syncLang(); });
  ui.panelToggle.addEventListener('click', () => {
    const closed = ui.panel.classList.toggle('is-closed');
    ui.panelToggle.setAttribute('aria-expanded', String(!closed));
  });

  const markSelected = (buttons, key, value) => {
    for (const b of buttons) {
      const on = b.dataset[key] === value;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };
  bus.on('cam', (name) => {
    goCam(name);
    markSelected(camButtons, 'cam', name);
  });
  bus.on('speed', (v) => {
    ui.speed.value = String(Math.round(v));
    ui.speedVal.textContent = `${Math.round(v)} km/h`;
  });
  bus.on('time', (v) => {
    sim.timeTarget = v;
    if (state.autoTime) set('autoTime', false);
  });
  bus.on('autoTime', (v) => { ui.autoTime.checked = v; });
  bus.on('color', (name) => {
    bike.setColor(COLORS[name]);
    markSelected(swatchEls, 'color', name);
  });
  bus.on('bloom', (v) => { fx.bloom.enabled = v; ui.bloom.checked = v; });
  bus.on('wire', (v) => {
    for (const m of materials) m.wireframe = v;
    ui.wire.checked = v;
  });
  bus.on('slow', (v) => { ui.slow.checked = v; });
  bus.on('autoRotate', (v) => { ui.autoRot.checked = v; });
  bus.on('cinematic', (v) => {
    ui.cine.checked = v;
    cineTimer = 0;
    if (v && state.autoRotate) set('autoRotate', false);
  });
  bus.on('ui', (v) => {
    document.body.classList.toggle('ui-hidden', !v);
    if (!v) toast(t('toastHidden'));
  });
  bus.on('sound', (v) => {
    const on = audio.setEnabled(v);
    if (on !== v) state.sound = on;
    ui.sound.setAttribute('aria-pressed', String(on));
    ui.sound.querySelector('span').textContent = t(on ? 'soundOn' : 'soundOff');
  });
  bus.on('*', writeURL);

  function screenshot() {
    try {
      // render once more so the framebuffer is complete when it is read back
      renderer.info.reset();
      fx.render();
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `pelican-rider-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        toast(t('toastShot'));
      }, 'image/png');
    } catch (err) {
      console.error(err);
    }
  }

  async function share() {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast(t('toastShared'));
      return;
    } catch {
      // clipboard needs a secure context or permission; fall back to a hidden field
    }
    try {
      const field = document.createElement('textarea');
      field.value = url;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      toast(t(ok ? 'toastShared' : 'toastShareFail'));
    } catch {
      toast(t('toastShareFail'));
    }
  }

  // reflect the initial state (which may come from the URL) in the controls
  ui.speed.value = String(Math.round(state.speed));
  ui.speedVal.textContent = `${Math.round(state.speed)} km/h`;
  ui.time.value = String(Math.round(state.time * 1000));
  for (const [el, key] of [[ui.autoTime, 'autoTime'], [ui.bloom, 'bloom'], [ui.wire, 'wire'], [ui.slow, 'slow'], [ui.autoRot, 'autoRotate'], [ui.cine, 'cinematic']]) {
    el.checked = state[key];
  }
  fx.bloom.enabled = state.bloom;
  if (state.wire) for (const m of materials) m.wireframe = true;
  markSelected(camButtons, 'cam', state.cam);
  markSelected(swatchEls, 'color', state.color);
  syncLang();
  applyTier();
  goCam(state.cam, true);
  env.setTime(state.time);
  env.updateEnvMap();
  if (matchMedia(COMPACT).matches) {
    ui.panel.classList.add('is-closed');
    ui.panelToggle.setAttribute('aria-expanded', 'false');
  }
  addEventListener('resize', applyTier);
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  let freeze = false;
  if (DEBUG) {
    // named classes only: handing out the whole namespace would defeat tree shaking
    window.__pelican = {
      renderer, scene, camera, controls, fx, env, bike, pelican, particles, sim, state, set,
      Vector2: THREE.Vector2, Vector3: THREE.Vector3, Color: THREE.Color,
      freeze: (v) => { freeze = !!v; },
      render: () => { renderer.info.reset(); fx.render(); },
    };
  }

  // ---------- frame loop ----------
  let last = performance.now();
  let first = true;
  let hudAt = 0;
  let frames = 0;
  let frameAcc = 0;
  let warm = 4;
  let blurK = 0;
  let errorAt = 0;

  function step(dt, rdt, now) {
    if (freeze) return;
    sim.t += dt;

    // ride: arrow keys steer the target speed, a honk is a sprint
    if (keys.up) set('speed', clamp(state.speed + 14 * rdt, 0, 45));
    else if (keys.down) set('speed', clamp(state.speed - 20 * rdt, 0, 45));
    let target = state.speed / 3.6;
    const sprinting = sim.sprint > 0;
    if (sprinting) {
      sim.sprint -= rdt;
      target = Math.max(target, MAX_SPEED);
    }
    const prev = sim.speed;
    sim.speed = damp(sim.speed, target, sprinting ? 1.8 : 1.1, dt);
    if (target === 0 && sim.speed < 0.02) sim.speed = 0;
    sim.decel = dt > 0 ? (sim.speed - prev) / dt : 0;
    sim.coasting = target < sim.speed - 0.25 && sim.speed > 0.4;   // legs still, freewheel ticking
    sim.cadence = sim.speed / B.R / B.gearRatio;
    if (!sim.coasting) sim.crank += sim.cadence * dt;
    sim.scroll += sim.speed * dt;
    sim.dist += sim.speed * dt;

    // time of day glides toward whatever the slider, a key or the day cycle asked for
    if (state.autoTime && dt > 0) {
      state.time = wrap(state.time + dt / 240, 1);
      sim.timeTarget = state.time;
    }
    const turn = angleDelta(sim.time * TAU, sim.timeTarget * TAU) / TAU;
    sim.time = wrap(sim.time + turn * (1 - Math.exp(-3.5 * rdt)), 1);
    env.setTime(sim.time);

    if (state.cinematic) {
      cineTimer += rdt;
      if (cineTimer > 7.5 && !camTween) {
        const i = (CINE_ORDER.indexOf(state.cam) + 1) % CINE_ORDER.length;
        set('cam', CINE_ORDER[i]);
      }
    }

    const wobble = 0.018 * Math.sin(sim.t * 1.3) + (sprinting ? 0.012 * Math.sin(sim.t * 9) : 0);
    bike.update(dt, sim.speed, sim.crank, sim.t, env.cur.night, wobble);
    pelican.update(dt, { speed: sim.speed, crank: sim.crank, camera, bike, sprint: sprinting ? 1 : 0 });

    stepCamTween(rdt);
    controls.autoRotate = state.autoRotate && !camTween;
    controls.update();
    camera.lookAt(controls.target);
    if (!reduced && sim.speed > 0.5) {
      const k = (sim.speed / MAX_SPEED) ** 2 * 0.0014;
      camera.rotation.x += Math.sin(now * 0.043) * k;
      camera.rotation.y += Math.sin(now * 0.037 + 1.3) * k;
    }
    const fov = 42 + 9 * smoothstep(0.55, 1, sim.speed / MAX_SPEED);
    if (Math.abs(camera.fov - fov) > 0.02) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    if (pointer.fresh && !down && now - hoverAt > 120) {
      pointer.fresh = false;
      hoverAt = now;
      canvas.classList.toggle('is-hot', !!pickAt(pointer.x, pointer.y));
    }

    env.update(dt, rdt, sim.speed, sim.t, camera);
    particles.update(dt, {
      speed: sim.speed, sprint: sprinting ? 1 : 0, decel: -sim.decel, night: env.cur.night, time: sim.t, reduced,
      featherSpot: (out) => pelican.tailWorld(out),
    });
    audio.update({ dt: rdt, speed: sim.speed, cadence: sim.cadence, coasting: sim.coasting, night: env.cur.night });

    blurK = damp(blurK, reduced ? 0 : smoothstep(8, 12.5, sim.speed) * 0.7 + (sprinting ? 0.35 : 0), 4, rdt);
    fx.grade.uniforms.uBlur.value = blurK;
    fx.grade.uniforms.uTime.value = now / 1000;
    fx.grade.uniforms.uAberration.value = reduced ? 0 : 0.0005 + (sprinting ? 0.0012 : 0);
    fx.bloom.strength = 0.22 + env.cur.night * 0.3;

    renderer.info.reset();
    fx.render();
    drawCalls = renderer.info.render.calls;
    if (first) {
      first = false;
      requestAnimationFrame(() => document.body.classList.add('ready'));
    }

    // adaptive quality: drop a tier when the average frame stays slow
    fps = damp(fps, 1 / Math.max(rdt, 1e-3), 2, rdt);
    frames++;
    frameAcc += rdt;
    if (frameAcc >= 2) {
      const avg = frameAcc / frames;
      if (warm > 0) warm -= 1;
      else if (avg > 0.031 && tier > 0) {
        tier--;
        applyTier();
        warm = 1;
      }
      frames = 0;
      frameAcc = 0;
    }
    if (now - hudAt > 125) {
      hudAt = now;
      refreshHUD();
    }
  }

  requestAnimationFrame(function frame(now) {
    requestAnimationFrame(frame);
    const rdt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
    last = now;
    try {
      step(state.paused ? 0 : rdt * (state.slow ? 0.25 : 1), rdt, now);
    } catch (err) {
      if (now - errorAt > 1000) {
        errorAt = now;
        console.error(err);
      }
    }
  });
}

// The world: a shader sky (sun, moon, stars, clouds), a shader sea, a scrolling
// coastal road with props, and image-based lighting captured from the sky itself.
// The bike never moves; everything here streams past it along -x.
import * as THREE from 'three';
import { TAU, DEG, clamp, lerp, smoothstep, mulberry32, wrap } from './core/util.js';
import {
  loftGeometry, resampleSections, cylinderBetween, merge, setVertexColor, colorByAxis, orientBlade, sphereAt, UP,
} from './core/geometry.js';
import * as TX from './core/textures.js';

const SUNSET_AZ = 40;                 // degrees from +x toward +z: the sun sets over the sea
const HORIZON = 1500;                 // sky dome radius
const SPAN = 140;                     // wrap length for roadside props (m)
const SEA_TILE = 256;                 // the wave pattern repeats every 256 m along the shore

const NOISE_GLSL = /* glsl */ `
float vhash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vhash(i), vhash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(vhash(i + vec3(0.0, 1.0, 0.0)), vhash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(vhash(i + vec3(0.0, 0.0, 1.0)), vhash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(vhash(i + vec3(0.0, 1.0, 1.0)), vhash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir, uMoonDir, uSunCol, uZenith, uHorizon, uGlow, uCloudLit, uCloudShade;
uniform float uNight, uTime, uScroll, uSunVis;
varying vec3 vWorld;
${NOISE_GLSL}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(vec3(p, 1.7)); p = p * 2.02 + vec2(3.1, 7.3); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  float h = d.y;
  float hf = pow(1.0 - clamp(h, 0.0, 1.0), 4.0);
  vec3 col = mix(uZenith, uHorizon, hf);
  float sd = dot(d, uSunDir);
  col += uGlow * pow(max(sd, 0.0), 6.0) * (0.25 + 0.75 * hf) * 0.55;
  col += uGlow * pow(max(sd, 0.0), 64.0) * 0.5;
  col += uSunCol * smoothstep(0.99972, 0.99986, sd) * 5.5 * uSunVis;
  // moon with a simple phase shading
  float md = dot(d, uMoonDir);
  float moon = smoothstep(0.99955, 0.99975, md) * uNight;
  vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec3 my = cross(mx, uMoonDir);
  vec3 mn = normalize((d - uMoonDir) * 60.0 - mx * 0.35 + my * 0.25 + uMoonDir * 0.6);
  col += vec3(0.95, 0.96, 1.0) * moon * (0.12 + 1.5 * clamp(dot(mn, normalize(vec3(-0.6, 0.3, 0.5))), 0.0, 1.0));
  col += vec3(0.55, 0.65, 0.9) * pow(max(md, 0.0), 260.0) * 0.3 * uNight;
  // stars
  if (uNight > 0.001 && h > 0.0) {
    vec3 sp = d * 190.0;
    vec3 cell = floor(sp);
    float rnd = vhash(cell);
    float star = (1.0 - smoothstep(0.0, 0.34, length(fract(sp) - 0.5))) * step(0.9955, rnd);
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + rnd * 5.0) + rnd * 60.0);
    col += vec3(1.0, 0.96, 0.9) * star * tw * (0.4 + (rnd - 0.9955) * 180.0) * uNight * smoothstep(0.0, 0.2, h) * 2.2;
  }
  // clouds on a dome-projected plane
  if (h > 0.015) {
    vec2 uv = d.xz / (h + 0.15);
    uv.x += uScroll;
    uv += vec2(uTime * 0.004, 0.0);
    float n = fbm(uv * 0.9 + vec2(3.0, 1.0));
    float cov = smoothstep(0.63, 0.88, n);
    float fade = smoothstep(0.015, 0.14, h) * (1.0 - 0.35 * smoothstep(0.5, 1.0, h));
    vec3 lit = mix(uCloudShade, uCloudLit, clamp(0.45 + 0.55 * pow(max(sd, 0.0), 2.0), 0.0, 1.0));
    col = mix(col, lit, cov * fade * 0.82);
  }
  col = mix(col, uHorizon * 0.75, 1.0 - smoothstep(-0.08, 0.0, h));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SEA_VERT = /* glsl */ `
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const SEA_FRAG = /* glsl */ `
#include <fog_pars_fragment>
uniform vec3 uSunDir, uLightDir, uLightCol, uZenith, uHorizon, uGlow, uDeep, uShallow;
uniform float uTime, uScroll;
varying vec3 vWorld;

float h2(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// value noise whose lattice wraps every "period" cells, so the pattern tiles along the shore
float pnoise(vec2 p, float period) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec2 a = mod(i, period); vec2 b = mod(i + 1.0, period);
  return mix(mix(h2(a), h2(vec2(b.x, a.y)), f.x), mix(h2(vec2(a.x, b.y)), h2(b), f.x), f.y);
}
float waveH(vec2 q, float t) {
  float h = sin(q.x * 0.3436 + q.y * 0.9 + t * 1.1) * 0.22 + sin(q.x * -0.589 + q.y * 1.7 + t * 1.9) * 0.14 + sin(q.x * 1.3744 - q.y * 0.6 + t * 1.3) * 0.1;
  h += (pnoise(q * 0.875 + vec2(t * 0.15, -t * 0.3), 224.0) - 0.5) * 0.9;
  h += (pnoise(q * 2.25 + vec2(-t * 0.25, -t * 0.5), 576.0) - 0.5) * 0.6;
  h += (pnoise(q * 5.0 + vec2(t * 0.4, -t * 0.8), 1280.0) - 0.5) * 0.32;
  return h;
}
void main() {
  vec2 p = vWorld.xz;
  vec2 q = vec2(p.x + uScroll, p.y);
  float shore = 5.8;
  float toShore = p.y - shore;
  float camDist = length(vWorld - cameraPosition);
  float e = max(0.12, camDist * 0.012);
  float h0 = waveH(q, uTime);
  float amp = 0.4 * (1.0 - smoothstep(60.0, 320.0, camDist));
  vec3 n = normalize(vec3(-(waveH(q + vec2(e, 0.0), uTime) - h0) * amp / e, 1.0, -(waveH(q + vec2(0.0, e), uTime) - h0) * amp / e));
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
  vec3 R = reflect(-V, n);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
  sky += uGlow * pow(max(dot(R, uSunDir), 0.0), 8.0) * 0.45;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 26.0, toShore));
  body *= 0.75 + 0.35 * max(dot(n, uLightDir), 0.0);
  vec3 col = mix(body, sky, fres);
  float rs = max(dot(R, uLightDir), 0.0);
  col += uLightCol * (pow(rs, 900.0) * 7.0 + pow(rs, 80.0) * 0.22);
  // surf: a lace of foam that breathes in and out along the waterline
  float edge = shore + 1.3 + 0.45 * sin(q.x * 0.3436 + uTime * 0.9) + 0.5 * (pnoise(vec2(q.x * 0.25, uTime * 0.3), 64.0) - 0.5);
  float foam = (1.0 - smoothstep(edge - 0.3, edge + 1.0, p.y)) * smoothstep(shore - 0.5, shore + 0.15, p.y);
  float lace = pnoise(vec2(q.x * 3.5, p.y * 3.5 + uTime * 0.6), 896.0) * 0.6 + pnoise(vec2(q.x * 7.0 - uTime * 0.8, p.y * 7.0), 1792.0) * 0.4;
  foam *= 0.3 + 0.7 * smoothstep(0.3, 0.7, lace + 0.18 * sin(q.x * 1.3744 + uTime * 2.0 + p.y * 3.0));
  col = mix(col, vec3(0.93, 0.96, 1.0) * (0.35 + 0.65 * max(uLightDir.y, 0.25)), clamp(foam, 0.0, 1.0) * 0.9);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

/** Ribbon along x through a [[z, y], ...] profile; UVs in 4 m tiles. */
function strip(profile, xHalf) {
  const pos = [];
  const uv = [];
  const idx = [];
  let v = 0;
  for (let i = 0; i < profile.length; i++) {
    if (i > 0) v += Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]) / 4;
    pos.push(-xHalf, profile[i][1], profile[i][0], xHalf, profile[i][1], profile[i][0]);
    uv.push(0, v, xHalf / 2, v);
  }
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat leaf built along +x (used for palm leaflets). */
function leafGeo(len, w) {
  return loftGeometry(resampleSections([
    { p: [0, 0, 0], rx: 0.002, ry: 0.001 },
    { p: [len * 0.3, -0.01, 0], rx: w, ry: 0.0015 },
    { p: [len * 0.7, -0.035, 0], rx: w * 0.75, ry: 0.0012 },
    { p: [len, -0.08, 0], rx: 0.0015, ry: 0.0008 },
  ], 5), { radial: 4 });
}

function palmGeometry(rng) {
  const h = 4.6 + rng() * 1.8;
  const lean = (rng() - 0.5) * 1.6;
  const leanDir = rng() * TAU;
  const n = 9;
  const trunkSecs = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const bend = u * u * lean;
    trunkSecs.push({ p: new THREE.Vector3(Math.cos(leanDir) * bend, u * h, Math.sin(leanDir) * bend), rx: lerp(0.2, 0.12, u), ry: lerp(0.2, 0.12, u) });
  }
  const trunk = loftGeometry(resampleSections(trunkSecs, 16), { radial: 9, cap: true });
  {
    const pos = trunk.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const a = new THREE.Color(0x9a7a55);
    const b = new THREE.Color(0x5c4129);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.copy(b).lerp(a, 0.5 + 0.5 * Math.sin(pos.getY(i) * 24.0));
      col.set([c.r, c.g, c.b], i * 3);
    }
    trunk.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const top = trunkSecs[n - 1].p;
  const parts = [trunk, setVertexColor(sphereAt(0.2, top.x, top.y - 0.02, top.z, 10, 8), 0x6d7d3c)];
  const g0 = new THREE.Color(0x3f7a34);
  const g1 = new THREE.Color(0x86b04a);
  for (let k = 0; k < 3; k++) {
    const a = rng() * TAU;
    parts.push(setVertexColor(sphereAt(0.09, top.x + Math.cos(a) * 0.16, top.y - 0.2, top.z + Math.sin(a) * 0.16, 8, 6), 0x6b4a26));
  }
  for (let k = 0; k < 9; k++) {
    const yaw = (k / 9) * TAU + rng() * 0.4;
    const len = 1.9 + rng() * 0.6;
    const droop = 0.9 + rng() * 0.7;
    const lift = 0.25 + rng() * 0.35;
    const M = 8;
    const pts = [];
    const dirs = [];
    const p = top.clone().add(new THREE.Vector3(0, 0.05, 0));
    for (let i = 0; i <= M; i++) {
      const u = i / M;
      const ang = lift - droop * u * u;
      const d = new THREE.Vector3(Math.cos(ang) * Math.cos(yaw), Math.sin(ang), Math.cos(ang) * Math.sin(yaw));
      pts.push(p.clone());
      dirs.push(d);
      p.addScaledVector(d, len / M);
    }
    const rib = loftGeometry(pts.map((q, i) => ({ p: q, rx: lerp(0.03, 0.008, i / M), ry: lerp(0.03, 0.008, i / M) })), { radial: 5 });
    parts.push(setVertexColor(rib, 0x7c8a3e));
    const side = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
    const tint = g0.clone().lerp(g1, rng());
    for (let i = 1; i <= 13; i++) {
      const u = i / 14;
      const at = Math.min(M - 1, Math.floor(u * M));
      const f = u * M - at;
      const origin = pts[at].clone().lerp(pts[at + 1], f);
      const d = dirs[at];
      const ll = (0.75 - 0.4 * u) * (0.85 + rng() * 0.3);
      for (const s of [-1, 1]) {
        const dir = side.clone().multiplyScalar(s * 0.72).addScaledVector(d, 0.6).add(new THREE.Vector3(0, -0.12 - u * 0.18, 0)).normalize();
        parts.push(orientBlade(setVertexColor(leafGeo(ll, 0.032), tint), origin, dir, UP));
      }
    }
  }
  return merge(parts);
}

function treeGeometry(rng) {
  const trunk = setVertexColor(cylinderBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.08, 1.7, 0.04), 0.1, 0.16, 7), 0x6b4a30);
  const parts = [trunk];
  const a = new THREE.Color(0x3c6e34);
  const b = new THREE.Color(0x7fae4c);
  for (let k = 0; k < 4; k++) {
    const g = new THREE.IcosahedronGeometry(0.9 + rng() * 0.6, 1).scale(1, 0.85, 1).translate((rng() - 0.5) * 1.3, 2.2 + rng() * 0.9, (rng() - 0.5) * 1.3);
    parts.push(setVertexColor(g, a.clone().lerp(b, rng())));
  }
  return merge(parts);
}

/** Distant hills on a closed ring: height fades to nothing over the sea sector, so the ring can rotate forever. */
function hillsGeometry() {
  const N = 200;
  const radii = [150, 215, 300, 430];
  const pos = [];
  const col = [];
  const idx = [];
  const low = new THREE.Color(0x44713c);
  const high = new THREE.Color(0x76869c);
  const c = new THREE.Color();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * TAU;
    const land = smoothstep(0.08, -0.18, Math.sin(a));
    const h = (13 + 12 * Math.sin(3 * a + 1.0) + 8 * Math.sin(7 * a + 2.3) + 5 * Math.sin(13 * a + 0.7) + 2.5 * Math.sin(23 * a + 1.9) + 14) * land;
    const ys = [-1.5, h, h * 0.38, -3];
    for (let k = 0; k < 4; k++) {
      pos.push(Math.cos(a) * radii[k], ys[k], Math.sin(a) * radii[k]);
      c.copy(low).lerp(high, clamp((ys[k] / 36) * 0.85, 0, 1));
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < 3; k++) {
      const a = i * 4 + k;
      idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function jumpFishGeometry() {
  const body = loftGeometry(resampleSections([
    { p: [0, 0, 0], rx: 0.004, ry: 0.005 }, { p: [0.06, 0, 0], rx: 0.028, ry: 0.05 }, { p: [0.2, 0, 0], rx: 0.034, ry: 0.07 },
    { p: [0.34, 0.01, 0], rx: 0.014, ry: 0.024 }, { p: [0.4, 0.012, 0], rx: 0.002, ry: 0.003 },
  ], 8), { radial: 8 });
  const tail = orientBlade(
    loftGeometry(resampleSections([{ p: [0, 0, 0], rx: 0.002, ry: 0.006 }, { p: [0.05, 0.004, 0], rx: 0.0015, ry: 0.05 }, { p: [0.1, 0.008, 0], rx: 0.001, ry: 0.03 }], 4), { radial: 6 }),
    new THREE.Vector3(0.38, 0.012, 0), new THREE.Vector3(1, 0.1, 0), new THREE.Vector3(0, 0, 1),
  );
  return merge([body, tail]);
}

// Sun elevation over the day: a triangle wave so the slider spends more range near sunrise and sunset.
const elevationDeg = (t) => (t < 0.5 ? 72 * (1 - Math.abs(4 * (t - 0.25))) : -72 * (1 - Math.abs(4 * (t - 0.75))));

const PALETTE = {
  day: { zenith: 0x2a78d4, horizon: 0xc9e4f6, glow: 0xffffff, cloudLit: 0xffffff, cloudShade: 0xa9bccf, hemiSky: 0xb8d8f5, hemiGround: 0x8a8666, deep: 0x0a4a73, shallow: 0x2ec4b4, hemiI: 0.6, exposure: 1.0, envI: 0.7 },
  golden: { zenith: 0x3f74c4, horizon: 0xffc070, glow: 0xffd08a, cloudLit: 0xffdba6, cloudShade: 0xb9867a, hemiSky: 0xaabfe8, hemiGround: 0x8f6a4c, deep: 0x0c4266, shallow: 0x2fb3a6, hemiI: 0.42, exposure: 1.05, envI: 0.5 },
  twilight: { zenith: 0x2a2f6b, horizon: 0xf07a6a, glow: 0xff8f78, cloudLit: 0xa86a88, cloudShade: 0x4a3e66, hemiSky: 0x5d639c, hemiGround: 0x3c3440, deep: 0x101f3a, shallow: 0x1f4a5e, hemiI: 0.45, exposure: 1.3, envI: 0.5 },
  night: { zenith: 0x060a1c, horizon: 0x17224a, glow: 0x24305e, cloudLit: 0x1c2547, cloudShade: 0x0d1228, hemiSky: 0x24305e, hemiGround: 0x141622, deep: 0x050d1a, shallow: 0x0a1e2c, hemiI: 0.3, exposure: 1.7, envI: 0.4 },
};
const NUM_KEYS = ['hemiI', 'exposure', 'envI'];
const COLOR_KEYS = Object.keys(PALETTE.day).filter((k) => !NUM_KEYS.includes(k));
for (const name of Object.keys(PALETTE)) for (const k of COLOR_KEYS) PALETTE[name][k] = new THREE.Color(PALETTE[name][k]);

export function createEnvironment(scene, renderer, quality) {
  const rng = mulberry32(2024);
  const windU = { uTime: { value: 0 }, uWind: { value: 0 } };
  const hooks = { splash: null };
  const sunDir = new THREE.Vector3(0, 1, 0);
  const moonDir = new THREE.Vector3(0, -1, 0);
  const cur = { night: 0, sunI: 0, lightDir: new THREE.Vector3(0, 1, 0), lightCol: new THREE.Color(1, 1, 1) };
  for (const k of COLOR_KEYS) cur[k] = new THREE.Color();
  for (const k of NUM_KEYS) cur[k] = 0;

  // ---------------- sky ----------------
  const skyUniforms = {
    uSunDir: { value: sunDir }, uMoonDir: { value: moonDir }, uSunCol: { value: new THREE.Color(0xffe0b0) },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() }, uCloudShade: { value: new THREE.Color() },
    uNight: { value: 0 }, uTime: { value: 0 }, uScroll: { value: 0 }, uSunVis: { value: 1 },
  };
  const skyMat = new THREE.ShaderMaterial({ uniforms: skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false });
  const skyGeo = new THREE.SphereGeometry(HORIZON, 32, 16);
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  scene.add(sky);

  // ---------------- sea ----------------
  const seaUniforms = Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), {
    uSunDir: { value: sunDir }, uLightDir: { value: cur.lightDir }, uLightCol: { value: new THREE.Color(0xffffff) },
    uZenith: skyUniforms.uZenith, uHorizon: skyUniforms.uHorizon, uGlow: skyUniforms.uGlow,
    uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uTime: { value: 0 }, uScroll: { value: 0 },
  });
  const seaMat = new THREE.ShaderMaterial({ uniforms: seaUniforms, vertexShader: SEA_VERT, fragmentShader: SEA_FRAG, fog: true });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1900, 950).rotateX(-Math.PI / 2), seaMat);
  sea.position.set(0, -0.18, 4 + 475);
  sea.frustumCulled = false;
  scene.add(sea);

  // ---------------- ground ----------------
  const scrollTex = [];
  const scrolling = (tex, tile) => { scrollTex.push({ tex, tile }); return tex; };
  const roadTex = scrolling(TX.roadTexture(), 10);
  roadTex.repeat.set(90, 1);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(900, 5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92, metalness: 0 }));
  road.position.set(0, 0, -1.25);
  const walkTex = scrolling(TX.sidewalkTexture(), 2);
  walkTex.repeat.set(450, 0.825);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(900, 1.65).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: walkTex, roughness: 0.9 }));
  walk.position.set(0, 0.12, 2.125);
  const grassTex = scrolling(TX.grassGroundTexture(), 5);
  grassTex.repeat.set(180, 26);
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(900, 130).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  lawn.position.set(0, 0, -68.9);
  const sandTex = scrolling(TX.sandTexture(), 4);
  const beachProfile = [[3.0, 0.1], [3.6, 0.07], [4.4, 0.0], [5.2, -0.09], [5.8, -0.18], [7.0, -0.32], [9.0, -0.55], [12.5, -0.95]];
  const beach = new THREE.Mesh(strip(beachProfile, 450), new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 }));
  const wet = new THREE.Mesh(strip([[4.95, -0.025], [5.8, -0.176], [6.9, -0.316]], 450).translate(0, 0.004, 0), new THREE.MeshStandardMaterial({ color: 0x8f7756, transparent: true, opacity: 0.55, roughness: 0.5, depthWrite: false }));
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.9 });
  const curbA = new THREE.Mesh(new THREE.BoxGeometry(900, 0.14, 0.14), curbMat);
  curbA.position.set(0, 0.055, 1.27);
  const curbB = new THREE.Mesh(new THREE.BoxGeometry(900, 0.14, 0.16), curbMat);
  curbB.position.set(0, 0.055, -3.82);
  for (const m of [road, walk, lawn, beach, wet, curbA, curbB]) {
    m.receiveShadow = true;
    scene.add(m);
  }

  const hills = new THREE.Mesh(hillsGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  scene.add(hills);

  // ---------------- instanced scrolling props ----------------
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _c = new THREE.Color();
  const instancedSets = [];
  const writeItem = (mesh, it, i) => {
    _q.setFromAxisAngle(UP, it.ry || 0);
    _s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
    mesh.setMatrixAt(i, _m.compose(_p.set(it.x, it.y || 0, it.z), _q, _s));
    if (it.color !== undefined) mesh.setColorAt(i, _c.set(it.color));
  };
  function instanced(geo, mat, items, span = SPAN) {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    mesh.frustumCulled = false;
    items.forEach((it, i) => writeItem(mesh, it, i));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const set = { mesh, items, span };
    instancedSets.push(set);
    return set;
  }

  // Grass blades: two copies of one instance buffer, a period apart, cover the verge forever.
  const grassGeo = (() => {
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const g = merge([a, a.clone().rotateY(Math.PI / 2)]);
    const nrm = g.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    return g;
  })();
  const grassMat = new THREE.MeshStandardMaterial({ map: TX.grassBladeTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9 });
  grassMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windU.uTime;
    shader.uniforms.uWind = windU.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float sway = sin(uTime * 2.1 + iPos.x * 0.7 + iPos.z * 1.3) * 0.5 + sin(uTime * 3.7 + iPos.z * 2.1) * 0.25;
        float bend = uv.y * uv.y * (0.12 + uWind * 0.6) * (0.6 + 0.4 * sway);
        transformed.x += bend;
        transformed.z += bend * 0.3 * sway;`);
  };
  grassMat.customProgramCacheKey = () => 'grass-wind';
  const grassMax = quality.grass;
  const grassItems = [];
  for (let i = 0; i < grassMax; i++) {
    const sc = 0.26 + rng() * 0.3;
    grassItems.push({ x: (rng() - 0.5) * SPAN, y: 0, z: -4.05 - 19 * rng() * rng(), ry: rng() * TAU, sx: sc * 0.7, sy: sc, color: new THREE.Color(0x4f8434).lerp(new THREE.Color(0xa9cf62), rng()) });
  }
  const grassA = instanced(grassGeo, grassMat, grassItems);
  grassA.mesh.castShadow = false;
  const grassB = new THREE.InstancedMesh(grassGeo, grassMat, grassItems.length);
  grassB.instanceMatrix = grassA.mesh.instanceMatrix;
  grassB.instanceColor = grassA.mesh.instanceColor;
  grassB.frustumCulled = false;
  grassB.receiveShadow = true;
  scene.add(grassB);
  instancedSets.pop();          // grass scrolls by moving its two meshes, not per instance

  // palms, trees, bushes, flowers, railing posts
  const palmItems = [[], [], []];
  for (let i = 0; i < 6; i++) {
    const s = 0.9 + rng() * 0.35;
    palmItems[i % 3].push({ x: -SPAN / 2 + i * (SPAN / 6) + (rng() - 0.5) * 4, z: -7 - rng() * 2.5, ry: rng() * TAU, s, sy: s * (0.9 + rng() * 0.3) });
  }
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  palmItems.forEach((items) => instanced(palmGeometry(rng), palmMat, items));
  const treeItems = [[], []];
  for (let i = 0; i < 10; i++) {
    const s = 0.9 + rng() * 0.8;
    treeItems[i % 2].push({ x: -SPAN / 2 + ((i * SPAN) / 10 + rng() * 6) % SPAN, z: -10 - rng() * 7, ry: rng() * TAU, s });
  }
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  treeItems.forEach((items) => instanced(treeGeometry(rng), treeMat, items));
  const bushItems = [];
  for (let i = 0; i < 16; i++) {
    const s = 0.5 + rng() * 0.6;
    bushItems.push({ x: (rng() - 0.5) * SPAN, z: -5.3 - rng() * 2.4, ry: rng() * TAU, sx: s * 1.3, sy: s * 0.8, sz: s * 1.3, color: new THREE.Color(0x3d7434).lerp(new THREE.Color(0x86b350), rng()) });
  }
  instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.95 }), bushItems);
  const flowerItems = [];
  const flowerCols = [0xff6f9c, 0xffd23f, 0xfff6ea, 0xff8a3d, 0xd96bff];
  for (let i = 0; i < 240; i++) {
    flowerItems.push({ x: (rng() - 0.5) * SPAN, y: 0.2 + rng() * 0.12, z: -4.1 - rng() * 2.2, s: 0.7 + rng() * 0.8, color: flowerCols[(rng() * flowerCols.length) | 0] });
  }
  instanced(new THREE.IcosahedronGeometry(0.045, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), flowerItems);
  const postItems = [];
  for (let i = 0; i < SPAN / 2; i++) postItems.push({ x: -SPAN / 2 + i * 2, y: 0.67, z: 2.95 });
  instanced(new THREE.CylinderGeometry(0.022, 0.026, 1.1, 8), curbMat, postItems);
  const railMat = new THREE.MeshStandardMaterial({ color: 0xe9e4d6, roughness: 0.5, metalness: 0.3 });
  scene.add(new THREE.Mesh(merge([
    cylinderBetween(new THREE.Vector3(-450, 0.72, 2.95), new THREE.Vector3(450, 0.72, 2.95), 0.024),
    cylinderBetween(new THREE.Vector3(-450, 1.2, 2.95), new THREE.Vector3(450, 1.2, 2.95), 0.028),
  ]), railMat));

  // ---------------- one-off props ----------------
  const scroller = {
    items: [],
    add(o, x) { o.position.x = x; scene.add(o); this.items.push(o); },
    update(dx) { for (const o of this.items) { o.position.x -= dx; if (o.position.x < -SPAN / 2) o.position.x += SPAN; } },
  };
  const seaScroller = {
    items: [],
    add(o, x) { o.position.x = x; scene.add(o); this.items.push(o); },
    update(dx) { for (const o of this.items) { o.position.x -= dx; if (o.position.x < -600) o.position.x += 1200; } },
  };
  const shadow = (o) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; };

  // street lamps, with a light pool that fades in at night
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffd9a0, emissiveIntensity: 0 });
  const pools = [];
  const lampMetal = new THREE.MeshStandardMaterial({ color: 0x24352f, roughness: 0.5, metalness: 0.6 });
  const armPts = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    armPts.push(new THREE.Vector3(0, 4.35 + Math.sin(u * Math.PI * 0.5) * 0.42, u * 1.3));
  }
  const lampGeo = merge([
    cylinderBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 4.4, 0), 0.045, 0.075, 10),
    new THREE.CylinderGeometry(0.12, 0.15, 0.26, 10).translate(0, 0.13, 0),
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(armPts), 12, 0.035, 7, false),
    new THREE.CylinderGeometry(0.09, 0.24, 0.17, 14).translate(0, 4.7, 1.3),
  ]);
  const poolTex = TX.lampPoolTexture();
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), bulbMat);
    bulb.position.set(0, 4.63, 1.3);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 6.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    pool.position.set(0, 0.014, 1.3);
    pool.castShadow = pool.receiveShadow = false;
    g.add(new THREE.Mesh(lampGeo, lampMetal), bulb, pool);
    pools.push(pool.material);
    g.position.z = -4.6;
    shadow(g);
    pool.castShadow = pool.receiveShadow = false;
    scroller.add(g, -SPAN / 2 + i * (SPAN / 6) + 7);
  }

  // benches facing the sea
  const wood = new THREE.MeshStandardMaterial({ color: 0xa5713f, roughness: 0.75 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.5, metalness: 0.7 });
  const benchWood = merge([
    ...[0, 1, 2, 3].map((k) => new THREE.BoxGeometry(1.6, 0.035, 0.085).translate(0, 0.46, -0.16 + k * 0.105)),
    ...[0, 1, 2].map((k) => new THREE.BoxGeometry(1.6, 0.08, 0.03).translate(0, 0.64 + k * 0.11, -0.24 - k * 0.035)),
  ]);
  const benchIron = merge([-0.7, 0.7].map((x) => merge([
    new THREE.BoxGeometry(0.05, 0.46, 0.05).translate(x, 0.23, 0.16),
    new THREE.BoxGeometry(0.05, 0.95, 0.05).rotateX(-0.2).translate(x, 0.47, -0.22),
    new THREE.BoxGeometry(0.05, 0.05, 0.48).translate(x, 0.44, -0.02),
  ])));
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(benchWood, wood), new THREE.Mesh(benchIron, iron));
    g.position.z = 2.35;
    shadow(g);
    scroller.add(g, -SPAN / 2 + i * (SPAN / 3) + 24);
  }

  // beach umbrellas and towels
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xf1ece2, roughness: 0.5 });
  const umbCols = ['#e85d3a', '#1f9c9c', '#f2b134', '#d8467f'];
  const towelCols = [0x2f6fb0, 0xf0e2c0, 0x5aa35a, 0xf08a4a];
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.4, 10, 1, true).translate(0, 2.0, 0), new THREE.MeshStandardMaterial({ map: TX.stripesTexture(umbCols[i]), roughness: 0.8, side: THREE.DoubleSide }));
    const towel = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.012, 1.45), new THREE.MeshStandardMaterial({ color: towelCols[i], roughness: 0.95 }));
    towel.position.set(0.9, -0.03, 0.2);
    towel.rotation.y = 0.4;
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 2.25, 8).translate(0, 1.1, 0), poleMat), canopy, towel);
    g.rotation.z = (rng() - 0.5) * 0.25;
    g.position.z = 6.6 + rng() * 1.0;
    g.position.y = -0.28 - (g.position.z - 6.6) * 0.12;
    shadow(g);
    scroller.add(g, -SPAN / 2 + i * (SPAN / 4) + 16 + rng() * 10);
  }

  // road sign
  {
    const g = new THREE.Group();
    // the sign faces oncoming riders (-x); its back is plain sheet metal
    const signMat = new THREE.MeshStandardMaterial({ map: TX.signTexture(), transparent: true, alphaTest: 0.5, roughness: 0.6 });
    const plateMat = new THREE.MeshStandardMaterial({ map: TX.signPlateTexture('鹈鹕出没'), roughness: 0.6 });
    const backMat = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.45, metalness: 0.5 });
    const diamond = new THREE.Shape();
    diamond.moveTo(0, 0.41);
    diamond.lineTo(0.41, 0);
    diamond.lineTo(0, -0.41);
    diamond.lineTo(-0.41, 0);
    diamond.closePath();
    g.add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 2.9, 8).translate(0, 1.45, 0), iron),
      new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.82).rotateY(-Math.PI / 2).translate(-0.02, 2.35, 0), signMat),
      new THREE.Mesh(new THREE.ShapeGeometry(diamond).rotateY(Math.PI / 2).translate(-0.018, 2.35, 0), backMat),
      new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.215).rotateY(-Math.PI / 2).translate(-0.02, 1.78, 0), plateMat),
      new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.215).rotateY(Math.PI / 2).translate(-0.018, 1.78, 0), backMat),
    );
    g.position.z = -4.25;
    shadow(g);
    scroller.add(g, 24);
  }

  // lighthouse on a rock across the bay
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const lampGlassMat = new THREE.MeshStandardMaterial({ color: 0xfff6d0, emissive: 0xffe9a0, emissiveIntensity: 0 });
  const beam = new THREE.Group();
  {
    const white = new THREE.MeshStandardMaterial({ color: 0xf2eee4, roughness: 0.7 });
    const red = new THREE.MeshStandardMaterial({ color: 0xc2372b, roughness: 0.7 });
    const rock = new THREE.Mesh(new THREE.ConeGeometry(11, 5, 7).translate(0, -1.2, 0), new THREE.MeshStandardMaterial({ color: 0x5d5a55, flatShading: true, roughness: 1 }));
    const lighthouse = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      lighthouse.add(new THREE.Mesh(new THREE.CylinderGeometry(lerp(2.1, 1.5, (k + 1) / 4), lerp(2.1, 1.5, k / 4), 4.2, 18).translate(0, 1 + k * 4.2 + 2.1, 0), k % 2 ? red : white));
    }
    lighthouse.add(
      new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 0.35, 20).translate(0, 17.9, 0), iron),
      new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.7, 14).translate(0, 18.95, 0), lampGlassMat),
      new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.3, 14).translate(0, 20.4, 0), red),
      rock,
    );
    // A cone that starts at the lamp and fades out along its length, so it never shows a
    // hard rim or reaches the road when it sweeps toward the camera.
    const beamGeo = new THREE.ConeGeometry(3, 70, 16, 8, true).translate(0, -35, 0).rotateZ(Math.PI / 2);
    {
      const pos = beamGeo.attributes.position;
      const col = new Float32Array(pos.count * 4);
      for (let i = 0; i < pos.count; i++) col.set([1, 0.94, 0.72, (1 - pos.getX(i) / 70) ** 1.6 * 0.55], i * 4);
      beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    }
    beam.add(new THREE.Mesh(beamGeo, beamMat), new THREE.Mesh(beamGeo.clone().rotateY(Math.PI), beamMat));
    beam.position.y = 18.95;
    lighthouse.add(beam);
    seaScroller.add(lighthouse, -80);
    lighthouse.position.y = -0.6;
    lighthouse.position.z = 190;
  }

  // sailboats
  const sailMat = new THREE.MeshStandardMaterial({ color: 0xf6f2e8, roughness: 0.8, side: THREE.DoubleSide });
  const sailShape = new THREE.Shape();
  sailShape.moveTo(0, 0);
  sailShape.lineTo(0, 8.5);
  sailShape.quadraticCurveTo(2.6, 3.2, 4.6, 0.3);
  sailShape.lineTo(0, 0);
  const sailGeo = new THREE.ShapeGeometry(sailShape).rotateY(Math.PI / 2).translate(0, 0.6, 0);
  const boats = [];
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.01, 1, 7, 5, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 5).scale(1, 0.9, 0.42), new THREE.MeshStandardMaterial({ color: i ? 0x27466b : 0x8c2f26, roughness: 0.5 })),
      new THREE.Mesh(sailGeo, sailMat),
      new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 9.4, 6).translate(0, 5.0, 0), iron),
    );
    g.position.z = 70 + i * 55;
    g.position.y = -0.25;
    g.scale.setScalar(1.5 + i * 0.6);
    seaScroller.add(g, i ? 180 : -330);
    boats.push(g);
  }

  // seabirds
  const gullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const gullBody = merge([
    setVertexColor(new THREE.SphereGeometry(0.09, 10, 7).scale(1.9, 0.7, 0.75), 0xf4f1ea),
    setVertexColor(new THREE.ConeGeometry(0.02, 0.13, 6).rotateZ(-Math.PI / 2).translate(0.22, 0, 0), 0xe8a03a),
  ]);
  const gullWing = colorByAxis(new THREE.PlaneGeometry(0.16, 0.46).rotateX(-Math.PI / 2).translate(0, 0, 0.25), 2, 0.1, 0.48, 0xf4f1ea, 0x8e949c);
  const gulls = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const wr = new THREE.Mesh(gullWing, gullMat);
    const wl = new THREE.Mesh(gullWing, gullMat);
    wl.scale.z = -1;
    g.add(new THREE.Mesh(gullBody, gullMat), wr, wl);
    g.scale.setScalar(1.7);
    g.userData = { wr, wl, x: (rng() - 0.5) * 120, y: 6 + rng() * 5, z: -6 + rng() * 20, phase: rng() * TAU, speed: 2.5 + rng() * 2 };
    scene.add(g);
    gulls.push(g);
  }

  // a fish that leaps out of the surf now and then
  const jumper = new THREE.Mesh(jumpFishGeometry(), new THREE.MeshStandardMaterial({ color: 0xb9ccd8, metalness: 0.6, roughness: 0.28 }));
  jumper.visible = false;
  scene.add(jumper);
  const jump = { t: 0, dur: 0, z: 0, vx: 0, vy: 0, vz: 0, next: 4 };

  // ---------------- lights ----------------
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -14;
  sc.right = sc.top = 14;
  sc.near = 1;
  sc.far = 90;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.03;
  sun.target.position.set(-2, 0.5, -2);
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbcd9f5, 0x8c8a6a, 0.9);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xbcd9f5, 0.35);
  fill.position.set(6, 5, -8);
  scene.add(fill);
  scene.fog = new THREE.Fog(0xcfe6f5, 40, 300);

  // ---------------- image-based lighting, captured from the sky shader ----------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const cubeCam = new THREE.CubeCamera(1, HORIZON * 1.2, cubeRT);
  cubeCam.position.set(0, 2, 0);
  const envScene = new THREE.Scene();
  const sky2 = new THREE.Mesh(skyGeo, skyMat);
  sky2.position.y = 2;
  const envFloor = new THREE.Mesh(new THREE.CircleGeometry(HORIZON * 0.9, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0d4a6e }));
  envFloor.position.y = -1;
  envScene.add(sky2, envFloor);
  let envRT = null;
  let envDirty = true;
  let envTimer = 0;
  function updateEnvMap() {
    cubeCam.update(renderer, envScene);
    const rt = pmrem.fromCubemap(cubeRT.texture);
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
  }

  // ---------------- time of day ----------------
  const sunWhite = new THREE.Color(0xfff4e0);
  const sunLow = new THREE.Color(0xff9a52);
  const moonCol = new THREE.Color(0x9db4ff);
  const fogCol = new THREE.Color();
  let scroll = 0;
  function setTime(t) {
    t = wrap(t, 1);
    const el = elevationDeg(t);
    const az = (SUNSET_AZ + (t - 0.5) * 360) * DEG;
    const ce = Math.cos(el * DEG);
    sunDir.set(ce * Math.cos(az), Math.sin(el * DEG), ce * Math.sin(az)).normalize();
    moonDir.copy(sunDir).negate();
    // four looks blended by sun elevation: day, golden hour, twilight, night
    const wDay = smoothstep(16, 38, el);
    const wNight = 1 - smoothstep(-16, -6, el);
    const wGold = (1 - wDay) * smoothstep(-3, 4, el) * (1 - wNight);
    const wTwi = Math.max(0, 1 - wDay - wGold - wNight);
    const ws = [wDay, wGold, wTwi, wNight];
    const ps = [PALETTE.day, PALETTE.golden, PALETTE.twilight, PALETTE.night];
    for (const k of COLOR_KEYS) {
      cur[k].setRGB(
        ps[0][k].r * ws[0] + ps[1][k].r * ws[1] + ps[2][k].r * ws[2] + ps[3][k].r * ws[3],
        ps[0][k].g * ws[0] + ps[1][k].g * ws[1] + ps[2][k].g * ws[2] + ps[3][k].g * ws[3],
        ps[0][k].b * ws[0] + ps[1][k].b * ws[1] + ps[2][k].b * ws[2] + ps[3][k].b * ws[3],
      );
    }
    for (const k of NUM_KEYS) cur[k] = ps[0][k] * ws[0] + ps[1][k] * ws[1] + ps[2][k] * ws[2] + ps[3][k] * ws[3];

    const sunI = 3.2 * (0.45 + 0.55 * smoothstep(0, 30, el)) * smoothstep(-1.2, 1.5, el);
    const moonI = 0.42 * wNight;
    const low = 1 - smoothstep(2, 26, el);
    cur.night = wNight;
    cur.sunI = sunI;
    // one shadow-casting light: the sun by day, the moon by night
    if (sunI >= moonI) {
      cur.lightDir.copy(sunDir);
      sun.color.copy(sunWhite).lerp(sunLow, low);
      sun.intensity = sunI;
    } else {
      cur.lightDir.copy(moonDir);
      sun.color.copy(moonCol);
      sun.intensity = moonI;
    }
    sun.position.copy(sun.target.position).addScaledVector(cur.lightDir, 34);
    cur.lightCol.copy(sun.color).multiplyScalar(sun.intensity / 3.2);

    su.uZenith.value.copy(cur.zenith);
    su.uHorizon.value.copy(cur.horizon);
    su.uGlow.value.copy(cur.glow);
    su.uCloudLit.value.copy(cur.cloudLit);
    su.uCloudShade.value.copy(cur.cloudShade);
    su.uSunCol.value.copy(sunWhite).lerp(sunLow, low * 0.85);
    su.uNight.value = wNight;
    su.uSunVis.value = smoothstep(-1.0, 0.4, el);
    seaUniforms.uLightCol.value.copy(cur.lightCol);
    seaUniforms.uDeep.value.copy(cur.deep);
    seaUniforms.uShallow.value.copy(cur.shallow);
    envFloor.material.color.copy(cur.deep);

    hemi.color.copy(cur.hemiSky);
    hemi.groundColor.copy(cur.hemiGround);
    hemi.intensity = cur.hemiI;
    fill.color.copy(cur.hemiSky);
    fill.intensity = 0.1 + 0.08 * (sunI / 3.2);
    scene.environmentIntensity = cur.envI;
    fogCol.copy(cur.horizon).lerp(cur.zenith, 0.3);
    scene.fog.color.copy(fogCol);
    scene.fog.near = lerp(60, 22, wNight);
    scene.fog.far = lerp(420, 190, wNight);
    renderer.toneMappingExposure = cur.exposure;
    bulbMat.emissiveIntensity = wNight * 5;
    for (const m of pools) m.opacity = wNight * 0.9;
    beamMat.opacity = wNight * 0.9;
    lampGlassMat.emissiveIntensity = wNight * 6;
    envDirty = true;
  }
  const su = skyUniforms;

  function update(dt, realDt, speed, time, camera) {
    const dx = speed * dt;
    scroll += dx;
    for (const { tex, tile } of scrollTex) tex.offset.x = (scroll / tile) % 1;
    const s = scroll % SPAN;
    grassA.mesh.position.x = -s;
    grassB.position.x = SPAN - s;
    if (dx > 0) {
      for (const { mesh, items, span } of instancedSets) {
        const half = span / 2;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          it.x -= dx;
          if (it.x < -half) it.x += span;
          writeItem(mesh, it, i);
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    scroller.update(dx);
    seaScroller.update(dx);
    hills.rotation.y = scroll / 260;
    sky.position.copy(camera.position);
    windU.uTime.value = time;
    windU.uWind.value = clamp(speed / 12, 0, 1);
    su.uTime.value = time;
    su.uScroll.value = scroll * 0.0008;
    seaUniforms.uTime.value = time;
    seaUniforms.uScroll.value = scroll % SEA_TILE;
    beam.rotation.y = time * 0.6;

    for (const g of gulls) {
      const u = g.userData;
      u.x += (u.speed - speed) * dt;
      if (u.x > 85) u.x -= 170;
      else if (u.x < -85) u.x += 170;
      const ph = u.phase;
      g.position.set(u.x, u.y + Math.sin(time * 0.7 + ph) * 0.6, u.z + Math.sin(time * 0.4 + ph) * 2.2);
      g.rotation.set(0, 0, -0.2 * Math.cos(time * 0.4 + ph));
      const glide = 0.15 + 0.85 * smoothstep(0.25, 0.6, Math.sin(time * 0.33 + ph));
      const flap = Math.sin(time * 7.5 + ph) * 0.6 * glide;
      u.wr.rotation.x = flap;
      u.wl.rotation.x = -flap;
    }
    boats.forEach((b, i) => {
      b.rotation.z = Math.sin(time * 0.8 + i * 2.1) * 0.04;
      b.position.y = Math.sin(time * 0.9 + i * 2.3) * 0.12 - 0.25;
    });

    jumper.position.x -= dx;
    if (jump.dur > 0) {
      jump.t += dt;
      const u = jump.t;
      const y = -0.18 + jump.vy * u - 4.9 * u * u;
      const z = jump.z + jump.vz * u;
      jumper.position.set(jumper.position.x, y, z);
      const vy = jump.vy - 9.8 * u;
      jumper.rotation.set(0, -Math.atan2(jump.vz, jump.vx), Math.atan2(vy, Math.hypot(jump.vx, jump.vz)));
      if (y < -0.18 && u > 0.2) {
        jump.dur = 0;
        jumper.visible = false;
        hooks.splash?.(jumper.position.x, -0.16, z);
        jump.next = 4 + Math.random() * 7;
      }
    } else {
      jump.next -= dt;
      if (jump.next <= 0) {
        jump.dur = 1.15;
        jump.t = 0;
        jump.z = 10 + Math.random() * 18;
        jump.vx = (Math.random() - 0.5) * 2;
        jump.vz = (Math.random() - 0.5) * 2;
        jump.vy = 5.6;
        jumper.position.set(-12 + Math.random() * 26, -0.18, jump.z);
        jumper.visible = true;
        hooks.splash?.(jumper.position.x, -0.16, jump.z);
      }
    }

    // the environment map is re-captured from the sky at most ~8 times per second
    if (envDirty) {
      envTimer -= realDt;
      if (envTimer <= 0) {
        updateEnvMap();
        envDirty = false;
        envTimer = 0.12;
      }
    }
  }

  setTime(0.487);
  envDirty = false;

  return {
    sky, sea, sun, hemi, fill, cur, sunDir, moonDir, hooks,
    setTime, updateEnvMap, update,
    setGrassCount(n) {
      const c = clamp(Math.round(n), 0, grassMax);
      grassA.mesh.count = c;
      grassB.count = c;
    },
    setShadowSize(n) {
      if (sun.shadow.mapSize.x === n) return;
      sun.shadow.mapSize.set(n, n);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    },
  };
}

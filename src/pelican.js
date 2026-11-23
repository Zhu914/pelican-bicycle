// The rider: a white pelican. The rig is hand-made: the body bobs with the pedal
// stroke, the neck is re-skinned every frame, the legs are solved with two-bone IK
// onto the pedals, the throat pouch jiggles and the scarf is a Verlet ribbon.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, easeOutBack, noise3 } from './core/util.js';
import {
  loftGeometry, updateLoft, resampleSections, smoothSample, merge, mirrorZ, orientBlade,
  colorByAxis, setVertexColor, UP,
} from './core/geometry.js';
import * as TX from './core/textures.js';

// ---- proportions (pelican root space == bike space) ----
const C = new THREE.Vector3(-0.206, 1.175, 0);       // body centre
const LEAN = 0.62;                                     // body pitch, nose up
const L1 = 0.41;                                       // drumstick
const L2 = 0.455;                                      // shank
const HEAD = new THREE.Vector3(0.085, 1.985, 0);
const NECK_BASE_LOCAL = new THREE.Vector3(0.35, 0.21, 0);
const SHOULDER_LOCAL = new THREE.Vector3(0.17, 0.08, 0.175);
const HIP_LOCAL = new THREE.Vector3(-0.17, -0.14, 0.11);
const WING_L0 = 0.55;
const NECK_N = 18;
const SCARF_STEP = 1 / 90;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const DOWN = new THREE.Vector3(0, -1, 0);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _col = new THREE.Color();

/** Plumage with sheen plus a procedural feather bump (no UVs needed). */
function plumage({ vc = false, streaks = false, color = 0xf7f3ea, bump = 0.014 } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.86,
    metalness: 0,
    sheen: 0.7,
    sheenRoughness: 0.8,
    sheenColor: new THREE.Color(0xfff0d8),
    vertexColors: vc,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBump = { value: bump };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjPos;
        uniform float uBump;
        float plumHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float plumNoise(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(plumHash(i), plumHash(i + vec3(1.0, 0.0, 0.0)), f.x), mix(plumHash(i + vec3(0.0, 1.0, 0.0)), plumHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
                     mix(mix(plumHash(i + vec3(0.0, 0.0, 1.0)), plumHash(i + vec3(1.0, 0.0, 1.0)), f.x), mix(plumHash(i + vec3(0.0, 1.0, 1.0)), plumHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
        }
        float plumHeight(vec3 p) {
          vec3 q = ${streaks ? 'vec3(p.x * 12.0, p.y * 44.0, p.z * 44.0)' : 'p * 34.0'};
          return plumNoise(q) * 0.6 + plumNoise(q * 2.7 + 3.1) * 0.3 + plumNoise(q * 6.3 + 1.7) * 0.1;
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float ph = plumHeight(vObjPos);
          vec3 dpdx = dFdx(-vViewPosition);
          vec3 dpdy = dFdy(-vViewPosition);
          vec3 r1 = cross(dpdy, normal);
          vec3 r2 = cross(normal, dpdx);
          float det = dot(dpdx, r1);
          vec3 grad = sign(det) * (dFdx(ph) * r1 + dFdy(ph) * r2);
          vec3 bent = abs(det) * normal - uBump * grad;
          // a zero vector (possible on degenerate fragments) must not become NaN
          normal = normalize(dot(bent, bent) > 1e-18 ? bent : normal);
        }`);
  };
  m.customProgramCacheKey = () => `plumage-${streaks ? 1 : 0}`;
  return m;
}

/** A flat feather along +x: length len, half-width w, half-thickness th. */
function bladeGeo(len, w, th) {
  return loftGeometry(resampleSections([
    { p: [0, 0, 0], rx: w * 0.45, ry: th },
    { p: [len * 0.45, 0.004, 0], rx: w, ry: th },
    { p: [len * 0.8, 0.007, 0], rx: w * 0.62, ry: th * 0.6 },
    { p: [len, 0.009, 0], rx: 0.0015, ry: 0.0008 },
  ], 6), { radial: 6 });
}

function wingGeometry() {
  const L = WING_L0;
  const arm = resampleSections([
    [-0.1, 0.0, 0.075, 0.055], [0.0, 0.0, 0.088, 0.062], [0.15, 0.016, 0.098, 0.066], [0.35, 0.024, 0.088, 0.056],
    [0.55, 0.02, 0.072, 0.046], [0.75, 0.008, 0.056, 0.036], [0.9, 0.0, 0.046, 0.03], [1.02, 0.0, 0.03, 0.02],
  ].map(([t, y, rx, ry]) => ({ p: [t * L, y, 0], rx, ry })), 18);
  const parts = [setVertexColor(loftGeometry(arm, { radial: 14 }), 0xffffff)];
  // overlapping coverts on the upper surface
  const rows = 6;
  for (let r = 0; r < rows; r++) {
    const t = 0.1 + (r / (rows - 1)) * 0.6;
    const sec = arm[Math.round(t * (arm.length - 1))];
    const len = 0.07 + r * 0.012;
    for (const k of [-1, -0.33, 0.33, 1]) {
      const blade = bladeGeo(len, 0.03, 0.005);
      const z = k * sec.rx * 0.6;
      const y = sec.p.y + sec.ry * Math.sqrt(Math.max(0.15, 1 - (z / sec.rx) ** 2)) * 0.95;
      parts.push(setVertexColor(orientBlade(
        blade,
        new THREE.Vector3(sec.p.x + 0.02, y - 0.004, z),
        new THREE.Vector3(-1, -0.2 - (0.12 * r) / rows, k * 0.3).normalize(),
        UP,
      ), 0xffffff));
    }
  }
  // folded primaries with black tips
  for (let k = 0; k < 7; k++) {
    const u = k / 6;
    const len = 0.2 + 0.1 * Math.sin(u * Math.PI);
    const blade = colorByAxis(bladeGeo(len, 0.036, 0.005), 0, len * 0.3, len * 0.78, 0xf7f3ea, 0x17161a);
    parts.push(orientBlade(
      blade,
      new THREE.Vector3(L * (0.78 + 0.03 * k), -0.01 - 0.006 * k, 0.01 + 0.004 * k),
      new THREE.Vector3(-0.35 - 0.12 * u, -0.75 + 0.4 * u, 0.12 + 0.3 * u).normalize(),
      Z_AXIS,
    ));
  }
  return merge(parts);
}

function footGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.05, 0);
  s.quadraticCurveTo(-0.03, 0.045, 0.02, 0.05);
  s.quadraticCurveTo(0.07, 0.075, 0.11, 0.095);
  s.quadraticCurveTo(0.1, 0.05, 0.13, 0.03);
  s.quadraticCurveTo(0.15, 0.02, 0.2, 0);
  s.quadraticCurveTo(0.15, -0.02, 0.13, -0.03);
  s.quadraticCurveTo(0.1, -0.05, 0.11, -0.095);
  s.quadraticCurveTo(0.07, -0.075, 0.02, -0.05);
  s.quadraticCurveTo(-0.03, -0.045, -0.05, 0);
  const web = new THREE.ExtrudeGeometry(s, { depth: 0.011, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 8 })
    .rotateX(Math.PI / 2).translate(0, 0.014, 0);
  const toes = [
    [-0.03, 0.018, 0, 0.2, 0.014, 0],
    [-0.02, 0.018, 0.02, 0.11, 0.013, 0.095],
    [-0.02, 0.018, -0.02, 0.11, 0.013, -0.095],
  ];
  const parts = [web];
  for (const [x0, y0, z0, x1, y1, z1] of toes) {
    const a = new THREE.Vector3(x0, y0, z0);
    const b = new THREE.Vector3(x1, y1, z1);
    const dir = _a.subVectors(b, a).normalize();
    parts.push(cylinderBetweenLocal(a, b, 0.017, 0.009));
    parts.push(cylinderBetweenLocal(b, _b.copy(b).addScaledVector(dir, 0.022), 0.007, 0.001));
  }
  return merge(parts);
}

function cylinderBetweenLocal(a, b, ra, rb) {
  const dir = _c.subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(ra, rb, len, 8);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, _d.copy(dir).multiplyScalar(-1 / len));
  g.applyMatrix4(_m.compose(_e.addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}

function makeRibbon(n) {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const idx = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  geo.setIndex(idx);
  const red = new THREE.Color(0xd5282f);
  const cream = new THREE.Color(0xf6e7c8);
  const col = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    _col.copy(i >= n - 5 && i % 2 === 0 ? cream : red);
    for (let k = 0; k < 2; k++) col.set([_col.r, _col.g, _col.b], (i * 2 + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function createPelican() {
  const root = new THREE.Group();
  root.name = 'pelican';

  const M = {
    body: plumage({ vc: true, streaks: true }),
    plum: plumage(),
    wing: plumage({ vc: true, streaks: true }),
    crest: new THREE.MeshStandardMaterial({ color: 0xf2d27c, roughness: 0.8, side: THREE.DoubleSide }),
    beak: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.35 }),
    pouch: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.5, side: THREE.DoubleSide }),
    mouth: new THREE.MeshStandardMaterial({ color: 0xa83a22, roughness: 0.6, side: THREE.DoubleSide }),
    skin: new THREE.MeshStandardMaterial({ color: 0xe9b98a, roughness: 0.7 }),
    iris: new THREE.MeshStandardMaterial({ color: 0x3a1f0c, roughness: 0.15 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    leg: new THREE.MeshStandardMaterial({ color: 0xe8842c, roughness: 0.55 }),
    claw: new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.5 }),
    scarf: new THREE.MeshStandardMaterial({ color: 0xd5282f, roughness: 0.85 }),
    ribbon: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
  };

  // ---------------- body ----------------
  const bodyPivot = new THREE.Group();
  bodyPivot.position.copy(C);
  bodyPivot.rotation.z = LEAN;
  root.add(bodyPivot);
  const bodyGeo = loftGeometry(resampleSections([
    [-0.37, 0.07, 0.012, 0.012], [-0.33, 0.05, 0.07, 0.065], [-0.26, 0.02, 0.14, 0.125], [-0.16, 0.0, 0.19, 0.185],
    [-0.04, 0.0, 0.21, 0.225], [0.08, 0.02, 0.205, 0.225], [0.18, 0.06, 0.175, 0.205], [0.26, 0.12, 0.13, 0.165],
    [0.32, 0.18, 0.085, 0.115], [0.355, 0.22, 0.045, 0.07], [0.37, 0.24, 0.012, 0.02],
  ].map(([x, y, rx, ry]) => ({ p: [x, y, 0], rx, ry })), 38), { radial: 30 });
  // breeding-plumage wash on the breast
  {
    const pos = bodyGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const yellow = new THREE.Color(0xf1d696);
    for (let i = 0; i < pos.count; i++) {
      const t = smoothstep(0.0, 0.22, pos.getX(i)) * smoothstep(0.12, -0.14, pos.getY(i)) * 0.75;
      _col.set(0xffffff).lerp(yellow, t);
      col.set([_col.r, _col.g, _col.b], i * 3);
    }
    bodyGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const bodyMesh = new THREE.Mesh(bodyGeo, M.body);
  bodyMesh.userData.pick = 'honk';
  bodyPivot.add(bodyMesh);

  // tail fan
  const tail = new THREE.Group();
  const tailParts = [];
  for (let k = -3; k <= 3; k++) {
    const len = 0.15 + 0.05 * (1 - Math.abs(k) / 3);
    tailParts.push(orientBlade(
      colorByAxis(bladeGeo(len, 0.04, 0.005), 0, len * 0.5, len, 0xf7f3ea, 0xe9d7a0),
      new THREE.Vector3(-0.34, 0.055, k * 0.012),
      new THREE.Vector3(-1, 0.42 + 0.04 * (3 - Math.abs(k)), k * 0.2).normalize(),
      UP,
    ));
  }
  tail.add(new THREE.Mesh(merge(tailParts), M.wing));
  bodyPivot.add(tail);

  // ---------------- neck ----------------
  const neckSecs = [];
  for (let i = 0; i < NECK_N; i++) neckSecs.push({ p: new THREE.Vector3(), rx: 0.08, ry: 0.08 });
  const neckGeo = loftGeometry(neckSecs, { radial: 16, hint: new THREE.Vector3(1, 0, 0) });
  const neckMesh = new THREE.Mesh(neckGeo, M.plum);
  neckMesh.userData.pick = 'honk';
  neckMesh.frustumCulled = false;
  root.add(neckMesh);
  const cps = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  cps[0].set(0.14, 1.5, 0);
  cps[1].set(0.12, 1.67, 0);
  cps[2].set(0.14, 1.83, 0);
  cps[3].set(0.05, 1.94, 0);
  const neckCurve = new THREE.CatmullRomCurve3(cps, false, 'centripetal', 0.5);
  const neckR = (u) => 0.06 + 0.032 * (1 - smoothstep(0, 0.6, u)) + 0.01 * Math.exp(-(((u - 0.06) / 0.2) ** 2));

  // ---------------- head ----------------
  const headPivot = new THREE.Group();
  headPivot.position.copy(HEAD);
  root.add(headPivot);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.088, 28, 20).scale(1.1, 1, 0.92), M.plum);
  skull.userData.pick = 'honk';
  headPivot.add(skull);

  // upper mandible
  const beakCtrl = [
    [0, 0.004, 0.046, 0.036], [0.05, 0.004, 0.054, 0.04], [0.14, 0, 0.05, 0.032], [0.24, -0.006, 0.042, 0.026],
    [0.33, -0.014, 0.033, 0.02], [0.39, -0.024, 0.025, 0.016], [0.43, -0.038, 0.016, 0.012], [0.455, -0.056, 0.006, 0.008], [0.466, -0.066, 0.0015, 0.002],
  ];
  const beakSecs = resampleSections(beakCtrl.map(([x, y, rx, ry]) => ({ p: [x, y, 0], rx, ry })), 26, 0.8);
  const beakGeo = loftGeometry(beakSecs, { radial: 14 });
  {
    const pos = beakGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const base = new THREE.Color(0xf9b45c);
    const mid = new THREE.Color(0xf39a3e);
    const tip = new THREE.Color(0xe3552f);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      _col.copy(base).lerp(mid, smoothstep(0.0, 0.3, x)).lerp(tip, smoothstep(0.36, 0.44, x));
      col.set([_col.r, _col.g, _col.b], i * 3);
    }
    beakGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const beak = new THREE.Group();
  beak.position.set(0.068, -0.004, 0);
  beak.rotation.z = -0.1;
  const upperMesh = new THREE.Mesh(beakGeo, M.beak);
  upperMesh.userData.pick = 'honk';
  beak.add(upperMesh);
  headPivot.add(beak);

  // lower jaw: gular pouch (lower half-ellipses) plus the mouth floor.
  // Sampled at the upper mandible's own x stations so the seam never opens.
  const pouchCtrl = [
    [0, 0.085, 0.044], [0.05, 0.105, 0.052], [0.12, 0.13, 0.048], [0.2, 0.138, 0.04], [0.28, 0.128, 0.032],
    [0.35, 0.1, 0.025], [0.4, 0.062, 0.019], [0.44, 0.028, 0.012], [0.466, 0.006, 0.002],
  ];
  const pouchX = pouchCtrl.map((r) => r[0]);
  const pouchFrac = (x) => {
    for (let i = 1; i < pouchX.length; i++) {
      if (x <= pouchX[i]) return (i - 1 + (x - pouchX[i - 1]) / (pouchX[i] - pouchX[i - 1])) / (pouchX.length - 1);
    }
    return 1;
  };
  const pouchBase = beakSecs.map((s) => {
    const f = pouchFrac(s.p.x);
    return { px: s.p.x, top: s.p.y, d: smoothSample(pouchCtrl.map((r) => r[1]), f), w: smoothSample(pouchCtrl.map((r) => r[2]), f) };
  });
  const pouchSecs = [];
  const P_N = pouchBase.length;
  const floorPos = new Float32Array(P_N * 9);
  for (let i = 0; i < P_N; i++) {
    const s = pouchBase[i];
    pouchSecs.push({ p: new THREE.Vector3(s.px, s.top - s.d / 2, 0), rx: s.w, ry: s.d / 2 });
    floorPos.set([s.px, s.top - 0.004, s.w * 0.92, s.px, s.top - 0.016, 0, s.px, s.top - 0.004, -s.w * 0.92], i * 9);
  }
  const pouchGeo = loftGeometry(pouchSecs, { radial: 12, thetaStart: Math.PI / 2, thetaLength: Math.PI });
  {
    const pos = pouchGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c0 = new THREE.Color(0xf8a83e);
    const c1 = new THREE.Color(0xee7420);
    for (let i = 0; i < pos.count; i++) {
      _col.copy(c0).lerp(c1, smoothstep(0.0, 0.4, pos.getX(i)));
      col.set([_col.r, _col.g, _col.b], i * 3);
    }
    pouchGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute('position', new THREE.BufferAttribute(floorPos, 3));
  {
    const idx = [];
    for (let i = 0; i < P_N - 1; i++) {
      for (let k = 0; k < 2; k++) {
        const a = i * 3 + k;
        idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
    floorGeo.setIndex(idx);
    floorGeo.computeVertexNormals();
  }
  const jaw = new THREE.Group();
  jaw.position.set(0.068, -0.004, 0);
  jaw.rotation.z = -0.1;
  const pouchMesh = new THREE.Mesh(pouchGeo, M.pouch);
  pouchMesh.userData.pick = 'honk';
  pouchMesh.frustumCulled = false;
  jaw.add(pouchMesh, new THREE.Mesh(floorGeo, M.mouth));
  headPivot.add(jaw);

  // eyes: bare-skin ring, a rotatable eyeball and a glint; the lid is a Y scale
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(0.052, 0.03, s * 0.063);
    e.quaternion.setFromUnitVectors(Z_AXIS, _a.copy(e.position).normalize());
    const ball = new THREE.Group();
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0165, 16, 10).scale(1, 1, 0.55), M.iris);
    iris.position.z = 0.004;
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0044, 8, 6), M.glint);
    glint.position.set(0.005, 0.0065, 0.0125);
    ball.add(iris, glint);
    e.add(new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 10).scale(1, 1, 0.3), M.skin), ball);
    headPivot.add(e);
    eyes.push({ root: e, ball });
  }

  // yellow crest at the back of the head
  const crestParts = [];
  for (const [dz, len, tilt] of [[-0.02, 0.09, 0.25], [0, 0.115, 0], [0.02, 0.085, -0.2]]) {
    crestParts.push(orientBlade(
      bladeGeo(len, 0.013, 0.003),
      new THREE.Vector3(-0.07, 0.045, dz),
      new THREE.Vector3(-0.75, 0.66, tilt).normalize(),
      Z_AXIS,
    ));
  }
  headPivot.add(new THREE.Mesh(merge(crestParts), M.crest));

  // ---------------- wings ----------------
  const wingGeoR = wingGeometry();
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(s > 0 ? wingGeoR : mirrorZ(wingGeoR), M.wing);
    w.userData.pick = 'honk';
    w.frustumCulled = false;
    root.add(w);
    wings.push(w);
  }

  // ---------------- legs ----------------
  const thighGeo = loftGeometry(resampleSections([
    { p: [0, 0.06, 0], rx: 0.05, ry: 0.05 }, { p: [0, 0.0, 0], rx: 0.072, ry: 0.074 }, { p: [0, -0.09, 0], rx: 0.082, ry: 0.082 },
    { p: [0, -0.22, 0], rx: 0.066, ry: 0.066 }, { p: [0, -0.33, 0], rx: 0.05, ry: 0.05 }, { p: [0, -L1 - 0.02, 0], rx: 0.03, ry: 0.03 },
  ], 10), { radial: 12, cap: true });
  setVertexColor(thighGeo, 0xffffff);
  const shankGeo = loftGeometry(resampleSections([
    { p: [0, 0.0, 0], rx: 0.03, ry: 0.03 }, { p: [0, -0.08, 0], rx: 0.029, ry: 0.029 }, { p: [0, -0.24, 0], rx: 0.023, ry: 0.023 },
    { p: [0, -L2 + 0.02, 0], rx: 0.019, ry: 0.019 }, { p: [0, -L2 - 0.02, 0], rx: 0.022, ry: 0.022 },
  ], 8), { radial: 10, cap: true });
  const fGeo = footGeometry();
  const legs = [];
  for (const s of [-1, 1]) {
    const thigh = new THREE.Group();
    const shank = new THREE.Group();
    shank.position.y = -L1;
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.046, 14, 10), M.plum);
    knee.position.y = -L1;
    thigh.add(new THREE.Mesh(thighGeo, M.body), knee, shank);
    shank.add(new THREE.Mesh(shankGeo, M.leg));
    const foot = new THREE.Mesh(fGeo, M.leg);
    foot.userData.pick = 'honk';
    root.add(thigh, foot);
    legs.push({ thigh, shank, foot });
  }

  // ---------------- scarf ----------------
  const scarfRing = new THREE.Mesh(new THREE.TorusGeometry(0.107, 0.024, 10, 26).rotateX(Math.PI / 2), M.scarf);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.032, 12, 10), M.scarf);
  root.add(scarfRing, knot);
  const ribbons = [];
  const RIB_N = 17;
  for (const [count, seg, width, phase] of [[RIB_N, 0.046, 0.075, 0], [RIB_N - 3, 0.044, 0.062, 2.4]]) {
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const p = new THREE.Vector3(0.0 - seg * i, 1.62 - 0.01 * i, -0.03 + 0.012 * i);
      nodes.push({ p, q: p.clone() });
    }
    const mesh = new THREE.Mesh(makeRibbon(count), M.ribbon);
    mesh.frustumCulled = false;
    root.add(mesh);
    ribbons.push({ nodes, count, seg, width, phase, attr: mesh.geometry.attributes.position, geo: mesh.geometry });
  }

  // ---------------- speech bubble ----------------
  const bubbleMat = new THREE.SpriteMaterial({ map: TX.bubbleTexture('嘎！'), transparent: true, depthTest: false, depthWrite: false });
  const bubble = new THREE.Sprite(bubbleMat);
  bubble.position.set(0.0, 0.36, 0);
  bubble.renderOrder = 30;
  bubble.visible = false;
  headPivot.add(bubble);

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  // ---------------- animation state ----------------
  const st = { honkT: -1, blinkTimer: 2.5, blinkPhase: 0, blinkDouble: false, lookT: 0, lookDur: 1, lookTarget: new THREE.Vector3(), yaw: 0, pitch: 0, scarfAcc: 0, time: 0 };
  const prevSide = new THREE.Vector3(0, 1, 0);
  const anchor = new THREE.Vector3();
  const honkText = { zh: '嘎！', en: 'HONK!' };
  let lang = 'zh';

  function stepScarf(h, wind, time) {
    for (let r = 0; r < ribbons.length; r++) {
      const rb = ribbons[r];
      const n = rb.nodes;
      n[0].p.copy(anchor);
      n[0].q.copy(anchor);
      for (let i = 1; i < rb.count; i++) {
        const node = n[i];
        const p = node.p;
        const q = node.q;
        const vx = (p.x - q.x) * 0.986;
        const vy = (p.y - q.y) * 0.986;
        const vz = (p.z - q.z) * 0.986;
        q.copy(p);
        const k = i / rb.count;
        const tu = noise3(k * 3.1, time * 1.7, r * 7.7 + 3);
        const tv = noise3(k * 3.1 + 11, time * 2.3, r * 5.1);
        const ax = -wind * (0.8 + 0.2 * tu);
        const ay = -3.2 + tu * (2 + wind * 2.2);
        const az = tv * (2 + wind * 2.2);
        p.x += vx + ax * h * h;
        p.y += vy + ay * h * h;
        p.z += vz + az * h * h;
      }
      for (let it = 0; it < 5; it++) {
        for (let i = 1; i < rb.count; i++) {
          const a = n[i - 1].p;
          const p = n[i].p;
          _a.subVectors(p, a);
          const l = _a.length() || 1e-6;
          p.addScaledVector(_a, (rb.seg - l) / l);
        }
      }
    }
  }

  function updateRibbon(rb, time) {
    const pos = rb.attr.array;
    const n = rb.count;
    for (let i = 0; i < n; i++) {
      const p = rb.nodes[i].p;
      _a.subVectors(rb.nodes[Math.min(n - 1, i + 1)].p, rb.nodes[Math.max(0, i - 1)].p);
      if (_a.lengthSq() < 1e-10) _a.set(-1, 0, 0);
      _a.normalize();
      _b.crossVectors(_a, Z_AXIS);
      if (_b.lengthSq() > 1e-6) {
        prevSide.copy(_b.normalize());
      } else {
        _b.copy(prevSide);
      }
      _b.applyAxisAngle(_a, 0.55 * Math.sin(i * 0.75 - time * 9 + rb.phase));
      const w = rb.width * (1 - 0.5 * (i / (n - 1)));
      const k = i * 6;
      pos[k] = p.x - _b.x * w; pos[k + 1] = p.y - _b.y * w; pos[k + 2] = p.z - _b.z * w;
      pos[k + 3] = p.x + _b.x * w; pos[k + 4] = p.y + _b.y * w; pos[k + 5] = p.z + _b.z * w;
    }
    rb.attr.needsUpdate = true;
    rb.geo.computeVertexNormals();
    rb.geo.computeBoundingSphere();
  }

  function update(dt, ctx) {
    const th = ctx.crank;
    const t = (st.time += dt);
    const ride = smoothstep(0.2, 2.5, ctx.speed);
    if (st.honkT >= 0) {
      st.honkT += dt;
      if (st.honkT > 1.15) st.honkT = -1;
    }
    const hEnv = st.honkT >= 0 ? Math.sin(Math.PI * clamp(st.honkT / 0.95, 0, 1)) : 0;

    // body: bob twice per pedal stroke, sway once
    const hop = hEnv * 0.02 * Math.sin(Math.PI * clamp(st.honkT, 0, 1));
    bodyPivot.position.set(C.x, C.y + hop + 0.012 * Math.sin(2 * th) * ride, C.z + 0.012 * Math.sin(th) * ride);
    bodyPivot.rotation.set(0.03 * Math.sin(th) * ride, 0.025 * Math.sin(th + 1.2) * ride, LEAN + 0.012 * Math.sin(2 * th + 0.6) * ride - hEnv * 0.08);
    bodyPivot.updateMatrixWorld(true);
    bodyMesh.scale.setScalar(1 + 0.008 * Math.sin(t * 2.2));
    tail.rotation.x = 0.08 * Math.sin(th) * ride + hEnv * 0.2 * Math.sin(t * 20);

    // neck
    bodyPivot.localToWorld(_a.copy(NECK_BASE_LOCAL));
    _d.copy(HEAD);
    _d.y += 0.012 * Math.sin(2 * th + 1.2) * ride + hEnv * 0.06;
    _d.x += 0.006 * Math.sin(th) * ride - hEnv * 0.02;
    _d.z += 0.014 * Math.sin(th) * ride;
    const sway = 0.02 * Math.sin(th) * ride;
    cps[0].copy(_a).add(_b.set(-0.01, -0.07, 0));
    cps[1].copy(_a).add(_b.set(-0.03, 0.17, sway * 1.2));
    cps[2].copy(_a).add(_b.set(0.03, 0.34, sway * 0.6));
    cps[3].copy(_d).add(_b.set(-0.04, -0.045, 0));
    for (let i = 0; i < NECK_N; i++) {
      const u = i / (NECK_N - 1);
      neckCurve.getPoint(u, neckSecs[i].p);
      neckSecs[i].rx = neckSecs[i].ry = neckR(u);
    }
    updateLoft(neckGeo, neckSecs);

    // head orientation: rests slightly nose-down, follows the look target
    neckCurve.getTangent(1, _c);
    headPivot.position.copy(neckSecs[NECK_N - 1].p).addScaledVector(_c, 0.05);
    let lookW = 0.45;
    if (st.lookT > 0) {
      st.lookT -= dt;
      _e.copy(st.lookTarget);
      lookW = smoothstep(0, 0.2, st.lookT) * smoothstep(st.lookDur, st.lookDur - 0.35, st.lookT);
    } else {
      _e.copy(ctx.camera.position);
    }
    _e.sub(headPivot.position).normalize().multiplyScalar(0.75).add(_b.set(1, -0.12, 0).multiplyScalar(0.25));
    const yawT = clamp(Math.atan2(-_e.z, _e.x), -0.9, 0.9) * lookW;
    const pitchT = clamp(Math.asin(clamp(_e.y, -1, 1)), -0.6, 0.7) * lookW;
    st.yaw = damp(st.yaw, yawT, 9, dt);
    st.pitch = damp(st.pitch, pitchT, 9, dt);
    const pitch = -0.14 + st.pitch + hEnv * 0.22 + 0.02 * Math.sin(2 * th + 1.2) * ride;
    headPivot.rotation.set(0.04 * Math.sin(th) * ride, st.yaw, pitch);

    // beak and pouch
    const open = hEnv;
    jaw.rotation.z = -0.1 - open * 0.5;
    beak.rotation.z = -0.1 + open * 0.1;
    for (let i = 0; i < P_N; i++) {
      const s = pouchBase[i];
      const x = s.px;
      const jig = 1 + open * 0.4 * Math.sin(Math.PI * clamp(x / 0.4, 0, 1)) + (0.05 * Math.sin(t * 11 - x * 16) + 0.03 * Math.sin(t * 7.3 + 1.7)) * ride;
      const d = s.d * jig;
      pouchSecs[i].p.set(x, s.top - d / 2, 0.004 * Math.sin(t * 6.5 - x * 9) * ride);
      pouchSecs[i].ry = d / 2;
    }
    updateLoft(pouchGeo, pouchSecs);

    // eyes: random (sometimes double) blinks, pupils track the target
    st.blinkTimer -= dt;
    if (st.blinkTimer < 0) {
      st.blinkTimer = 2 + Math.random() * 4.5;
      st.blinkPhase = 1e-4;
      st.blinkDouble = Math.random() < 0.25;
    }
    let blink = 0;
    if (st.blinkPhase > 0) {
      st.blinkPhase += dt;
      const p = st.blinkPhase / 0.16;
      blink = p < 1 ? Math.sin(Math.PI * p) : st.blinkDouble && p < 2.4 ? Math.max(0, Math.sin(Math.PI * (p - 1.3))) : 0;
      if (p > 2.6) st.blinkPhase = 0;
    }
    for (const e of eyes) {
      e.root.scale.y = 1 - blink * 0.9;
      e.ball.rotation.set(clamp((pitchT - st.pitch) * 0.8, -0.45, 0.45), clamp((yawT - st.yaw) * 0.8, -0.5, 0.5), 0);
    }

    // wings rest on the grips; they flap up during a honk
    const flap = hEnv * Math.abs(Math.sin(t * 24));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const wing = wings[i];
      bodyPivot.localToWorld(_a.copy(SHOULDER_LOCAL).setZ(side * SHOULDER_LOCAL.z));
      ctx.bike.getGrip(side, _b);
      _b.y += 0.022 + flap * 0.2;
      _b.x -= flap * 0.08;
      _b.z += side * flap * 0.12;
      _c.subVectors(_b, _a);
      const L = _c.length();
      _c.multiplyScalar(1 / L);
      _d.crossVectors(_c, UP).normalize();
      _e.crossVectors(_d, _c);
      _m.makeBasis(_c, _e, _d);
      wing.quaternion.setFromRotationMatrix(_m);
      wing.position.copy(_a);
      wing.scale.set(L / WING_L0, 1, 1);
    }

    // legs: two-bone IK onto the pedals, the visible joint bends backwards
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const leg = legs[i];
      bodyPivot.localToWorld(_a.copy(HIP_LOCAL).setZ(side * HIP_LOCAL.z));
      ctx.bike.getPedal(side, _b);
      _c.copy(_b).add(_d.set(-0.085, 0.04, 0));
      let dx = _c.x - _a.x;
      let dy = _c.y - _a.y;
      let dist = Math.hypot(dx, dy);
      const maxD = L1 + L2 - 0.006;
      if (dist > maxD) {
        dx *= maxD / dist;
        dy *= maxD / dist;
        dist = maxD;
      }
      const phi = Math.atan2(dy, dx);
      const a1 = phi - Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
      leg.thigh.position.copy(_a);
      leg.thigh.rotation.z = a1 + Math.PI / 2;
      const kx = _a.x + Math.cos(a1) * L1;
      const ky = _a.y + Math.sin(a1) * L1;
      const a2 = Math.atan2(_c.y - ky, _c.x - kx);
      leg.shank.rotation.z = a2 - a1;
      leg.foot.position.copy(_b).add(_d.set(-0.085, 0, 0));
      leg.foot.rotation.set(0, -side * 0.14, 0.1 + 0.16 * Math.sin(th + (side > 0 ? 0 : Math.PI) - 0.5) * ride);
    }

    // scarf ring rides the neck; ribbons trail in the wind
    neckCurve.getPoint(0.15, scarfRing.position);
    neckCurve.getTangent(0.15, _c);
    scarfRing.quaternion.setFromUnitVectors(UP, _c);
    anchor.copy(scarfRing.position).add(_d.set(-0.105, 0.012, -0.03));
    knot.position.copy(anchor);
    st.scarfAcc += Math.min(dt, 0.05);
    const wind = 1.2 + ctx.speed * 0.75 + (ctx.sprint || 0) * 2.5;
    while (st.scarfAcc >= SCARF_STEP) {
      st.scarfAcc -= SCARF_STEP;
      stepScarf(SCARF_STEP, wind, t);
    }
    for (const rb of ribbons) updateRibbon(rb, t);

    // speech bubble pops with the honk
    if (st.honkT >= 0.04 && st.honkT < 0.98) {
      bubble.visible = true;
      const s = easeOutBack(clamp(st.honkT / 0.2, 0, 1)) * (st.honkT > 0.8 ? 1 - (st.honkT - 0.8) / 0.18 : 1);
      bubble.scale.set(0.62 * s, 0.39 * s, 1);
      bubble.position.set(0.02 + 0.02 * Math.sin(t * 9), 0.36, 0);
    } else {
      bubble.visible = false;
    }
  }

  return {
    group: root,
    update,
    pickMeshes: [bodyMesh, neckMesh, skull, upperMesh, pouchMesh, wings[0], wings[1], legs[0].foot, legs[1].foot],
    honk() {
      // restart only when no honk is in full swing
      if (st.honkT < 0 || st.honkT > 0.6) st.honkT = 0;
    },
    canHonk: () => st.honkT < 0 || st.honkT > 0.6,
    lookAt(target, dur = 1.6) {
      st.lookTarget.copy(target);
      st.lookT = dur;
      st.lookDur = dur;
    },
    headWorld(out) { return headPivot.getWorldPosition(out); },
    bodyWorld(out) { return bodyPivot.localToWorld(out.set(0, 0, 0)); },
    tailWorld(out) { return bodyPivot.localToWorld(out.set(-0.36, 0.06, 0)); },
    setLang(l) {
      lang = l === 'en' ? 'en' : 'zh';
      bubbleMat.map?.dispose();
      bubbleMat.map = TX.bubbleTexture(honkText[lang]);
      bubbleMat.needsUpdate = true;
    },
    get isOpen() { return st.honkT >= 0; },
  };
}

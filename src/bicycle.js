// The bicycle, built entirely from primitives. Axes: +x forward, +y up, +z to the
// rider's right (drive side). The bike never leaves the origin; the world scrolls past.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TAU, smoothstep, lerp } from './core/util.js';
import {
  loftGeometry, resampleSections, cylinderBetween, tube, merge, arcPoints, sphereAt,
  colorByAxis, setVertexColor, orientBlade, UP,
} from './core/geometry.js';
import * as TX from './core/textures.js';

export const B = {
  R: 0.34,                                   // wheel radius
  RA: new THREE.Vector2(-0.525, 0.34),       // rear axle
  FA: new THREE.Vector2(0.525, 0.34),        // front axle
  BB: new THREE.Vector2(-0.08, 0.29),        // bottom bracket
  crank: 0.17,                               // crank arm length
  ringR: 0.085,                              // chainring radius (42T)
  cogR: 0.046,                               // rear cog radius (18T)
  chainZ: 0.052,                             // chain plane
  SC: new THREE.Vector2(-0.245, 0.865),      // seat cluster
  HT: new THREE.Vector2(0.355, 0.975),       // head tube top
  HB: new THREE.Vector2(0.412, 0.795),       // head tube bottom
  grip: new THREE.Vector3(0.372, 1.108, 0.238),
  pedalZ: 0.108,
  gearRatio: 42 / 18,
};

const P = (v, z = 0) => new THREE.Vector3(v.x, v.y, z);
const box = (w, h, d, x, y, z, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  return g.translate(x, y, z);
};
const cylZ = (r, len, x, y, z, seg = 16, r2 = r) => new THREE.CylinderGeometry(r, r2, len, seg).rotateX(Math.PI / 2).translate(x, y, z);
const cylX = (r, len, x, y, z, seg = 16, r2 = r) => new THREE.CylinderGeometry(r, r2, len, seg).rotateZ(-Math.PI / 2).translate(x, y, z);
const cylY = (r, len, x, y, z, seg = 16, r2 = r) => new THREE.CylinderGeometry(r, r2, len, seg).translate(x, y, z);

/** Closed polyline with arc-length lookup: the chain's path around ring and cog. */
class LoopPath {
  constructor(pts) {
    this.p = pts;
    const n = pts.length;
    const cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      cum[i + 1] = cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    this.cum = cum;
    this.len = cum[n];
  }
  at(s, out) {
    s = ((s % this.len) + this.len) % this.len;
    const cum = this.cum;
    let lo = 0;
    let hi = this.p.length;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = this.p[lo];
    const b = this.p[(lo + 1) % this.p.length];
    const seg = cum[lo + 1] - cum[lo] || 1;
    const t = (s - cum[lo]) / seg;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    out.x = a[0] + dx * t;
    out.y = a[1] + dy * t;
    out.tx = dx / l;
    out.ty = dy / l;
    return out;
  }
}

/** Upper run, ring arc, lower run, cog arc: the two external tangents of unequal circles. */
function chainLoop(C1, r1, C2, r2) {
  const dx = C2.x - C1.x;
  const dy = C2.y - C1.y;
  const d = Math.hypot(dx, dy);
  const ux = dx / d;
  const uy = dy / d;
  const px = -uy;
  const py = ux;
  const ca = (r1 - r2) / d;
  const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const nu = { x: ux * ca - px * sa, y: uy * ca - py * sa };
  const nl = { x: ux * ca + px * sa, y: uy * ca + py * sa };
  const pts = [];
  const on = (c, r, n) => [c.x + r * n.x, c.y + r * n.y];
  const line = (a, b, n) => { for (let i = 0; i < n; i++) pts.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]); };
  const arc = (c, r, a0, a1, n) => { for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([c.x + r * Math.cos(a), c.y + r * Math.sin(a)]); } };
  line(on(C2, r2, nu), on(C1, r1, nu), 24);
  const aU = Math.atan2(nu.y, nu.x);
  let aL = Math.atan2(nl.y, nl.x);
  if (aL > aU) aL -= TAU;
  arc(C1, r1, aU, aL, 30);
  line(on(C1, r1, nl), on(C2, r2, nl), 24);
  arc(C2, r2, aL, aU - TAU, 18);
  return pts;
}

function makeWheel(M, isRear) {
  const R = B.R;
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(R - 0.021, 0.022, 14, 100), M.rubber);
  const rimPts = [[R - 0.08, -0.0125], [R - 0.048, -0.0125], [R - 0.0415, -0.0095], [R - 0.0415, 0.0095], [R - 0.048, 0.0125], [R - 0.08, 0.0125]]
    .map((p) => new THREE.Vector2(p[0], p[1]));
  const rim = new THREE.Mesh(new THREE.LatheGeometry(rimPts, 72).rotateX(Math.PI / 2), M.chrome);

  const spokes = [];
  const n = 32;
  const flangeR = 0.034;
  const rimR = R - 0.078;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const side = i % 2 ? 1 : -1;
    const lead = i % 4 < 2 ? 0.38 : -0.38;
    spokes.push(cylinderBetween(
      new THREE.Vector3(Math.cos(a + lead) * flangeR, Math.sin(a + lead) * flangeR, side * 0.03),
      new THREE.Vector3(Math.cos(a) * rimR, Math.sin(a) * rimR, 0),
      0.0017, 0.0017, 5,
    ));
  }
  const spokeMesh = new THREE.Mesh(merge(spokes), M.spoke);

  const hub = new THREE.Mesh(merge([
    cylZ(0.021, 0.085, 0, 0, 0, 18),
    cylZ(0.036, 0.005, 0, 0, 0.03, 20),
    cylZ(0.036, 0.005, 0, 0, -0.03, 20),
    cylZ(0.0075, 0.135, 0, 0, 0, 10),
    cylZ(0.012, 0.012, 0, 0, 0.068, 6),
    cylZ(0.012, 0.012, 0, 0, -0.068, 6),
  ]), M.steel);

  // valve stem and an orange spoke reflector make the rotation legible
  const va = 1.1;
  const extras = merge([
    cylinderBetween(new THREE.Vector3(Math.cos(va) * rimR, Math.sin(va) * rimR, 0), new THREE.Vector3(Math.cos(va) * (rimR - 0.038), Math.sin(va) * (rimR - 0.038), 0), 0.0035, 0.0035, 6),
  ]);
  const ra = 3.9;
  const reflector = new THREE.Mesh(box(0.02, 0.062, 0.009, 0, 0, 0).rotateZ(ra).translate(Math.cos(ra) * (R - 0.135), Math.sin(ra) * (R - 0.135), 0), M.orange);

  const blur = new THREE.Mesh(new THREE.RingGeometry(0.05, R - 0.046, 48, 1), M.blur);
  blur.renderOrder = 2;

  g.add(tire, rim, spokeMesh, hub, new THREE.Mesh(extras, M.steel), reflector, blur);
  if (isRear) {
    const teeth = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      teeth.push(box(0.006, 0.006, 0.0028, 0, 0, 0).rotateZ(a).translate(Math.cos(a) * 0.042, Math.sin(a) * 0.042, B.chainZ));
    }
    const cog = new THREE.Mesh(merge([cylZ(0.04, 0.003, 0, 0, B.chainZ, 32), ...teeth]), M.steel);
    g.add(cog);
  }
  return { group: g, spokeMesh, blur };
}

function fender(cx, cy, a0, a1) {
  const pts = arcPoints(cx, cy, B.R + 0.034, a0, a1, 30);
  return loftGeometry(pts.map((p) => ({ p, rx: 0.004, ry: 0.036 })), { radial: 10, hint: new THREE.Vector3(0, 0, 1) });
}

function fishGeometry() {
  const ctrl = [
    { p: [0, 0, 0], rx: 0.004, ry: 0.005 },
    { p: [0.03, 0, 0], rx: 0.014, ry: 0.024 },
    { p: [0.09, 0.002, 0], rx: 0.02, ry: 0.042 },
    { p: [0.16, 0, 0], rx: 0.016, ry: 0.034 },
    { p: [0.21, 0.004, 0], rx: 0.008, ry: 0.016 },
    { p: [0.235, 0.006, 0], rx: 0.002, ry: 0.003 },
  ];
  const body = colorByAxis(loftGeometry(resampleSections(ctrl, 14), { radial: 10 }), 1, -0.04, 0.04, 0xe4edf2, 0x3b5670);
  const tail = setVertexColor(orientBlade(
    loftGeometry(resampleSections([
      { p: [0, 0, 0], rx: 0.002, ry: 0.006 },
      { p: [0.045, 0.004, 0], rx: 0.002, ry: 0.022 },
      { p: [0.085, 0.008, 0], rx: 0.0015, ry: 0.042 },
      { p: [0.092, 0.009, 0], rx: 0.001, ry: 0.03 },
    ], 6), { radial: 8 }),
    new THREE.Vector3(0.222, 0.006, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1),
  ), 0x4a6a84);
  const dorsal = setVertexColor(orientBlade(
    loftGeometry(resampleSections([
      { p: [0, 0, 0], rx: 0.002, ry: 0.004 },
      { p: [0.03, 0, 0], rx: 0.002, ry: 0.022 },
      { p: [0.065, 0, 0], rx: 0.0015, ry: 0.012 },
      { p: [0.075, 0, 0], rx: 0.001, ry: 0.003 },
    ], 5), { radial: 8 }),
    new THREE.Vector3(0.07, 0.03, 0), new THREE.Vector3(1, 0.55, 0), new THREE.Vector3(0, 0, 1),
  ), 0x4a6a84);
  const eyes = [
    sphereAt(0.0045, 0.034, 0.012, 0.016, 8, 6), sphereAt(0.0045, 0.034, 0.012, -0.016, 8, 6),
  ].map((g) => setVertexColor(g, 0x0c0c10));
  return merge([body, tail, dorsal, ...eyes]);
}

export function createBicycle() {
  const root = new THREE.Group();
  root.name = 'bicycle';

  const wicker = TX.wickerTexture();
  wicker.repeat.set(5, 1.2);
  const wickerBump = TX.wickerTexture();
  wickerBump.colorSpace = THREE.NoColorSpace;
  wickerBump.repeat.set(5, 1.2);

  const M = {
    rubber: new THREE.MeshStandardMaterial({ map: TX.tireTexture(), roughness: 0.86, metalness: 0 }),
    paint: new THREE.MeshPhysicalMaterial({ color: 0x19a7a0, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.18, metalness: 1 }),
    spoke: new THREE.MeshStandardMaterial({ color: 0xe6e9ec, roughness: 0.18, metalness: 1 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.32, metalness: 0.95 }),
    chainPlate: new THREE.MeshStandardMaterial({ color: 0x51555c, roughness: 0.42, metalness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7, metalness: 0.15 }),
    cork: new THREE.MeshStandardMaterial({ color: 0x8a5a35, roughness: 0.92 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x6d4124, roughness: 0.5 }),
    wicker: new THREE.MeshStandardMaterial({ map: wicker, bumpMap: wickerBump, bumpScale: 0.012, roughness: 0.85, side: THREE.DoubleSide }),
    wickerDark: new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.8 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b0, emissiveIntensity: 0, roughness: 0.25 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8b1010, emissive: 0xff2a1a, emissiveIntensity: 0.1, roughness: 0.3 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff6a00, emissiveIntensity: 0.15, roughness: 0.35 }),
    bottle: new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.35 }),
    bottleCap: new THREE.MeshStandardMaterial({ color: 0x19a7a0, roughness: 0.4 }),
    fish: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.3 }),
    blur: new THREE.MeshBasicMaterial({ color: 0x3a3a40, alphaMap: TX.blurTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    plate: new THREE.MeshStandardMaterial({ map: TX.plateTexture(), roughness: 0.6, side: THREE.DoubleSide }),
  };
  const { RA, FA, BB, SC, HT, HB } = B;

  // ---------------- wheels ----------------
  const rear = makeWheel(M, true);
  const front = makeWheel(M, false);
  rear.group.position.set(RA.x, RA.y, 0);
  front.group.position.set(FA.x, FA.y, 0);
  root.add(rear.group);

  // ---------------- steering assembly (fork, bars, basket, front wheel) ----------------
  const steerAxis = new THREE.Vector3(HT.x - HB.x, HT.y - HB.y, 0).normalize();
  const qBase = new THREE.Quaternion().setFromUnitVectors(UP, steerAxis);
  const steer = new THREE.Group();
  steer.position.set(HT.x, HT.y, 0);
  steer.quaternion.copy(qBase);
  const holder = new THREE.Group();
  holder.position.set(-HT.x, -HT.y, 0);
  steer.add(holder);
  root.add(steer);
  holder.add(front.group);

  // ---------------- frame ----------------
  const paint = [];
  const chrome = [];
  const r = 0.0175;
  paint.push(cylinderBetween(P(SC), P(HT), r));
  paint.push(cylinderBetween(P(HB), P(BB), 0.0195));
  paint.push(cylinderBetween(P(BB), P(SC), r));
  paint.push(cylinderBetween(P(HB), P(HT), 0.0235, 0.0235, 16));
  paint.push(sphereAt(0.0215, SC.x, SC.y, 0, 14, 10), sphereAt(0.024, HT.x, HT.y, 0, 14, 10), sphereAt(0.026, HB.x, HB.y, 0, 14, 10));
  paint.push(cylZ(0.025, 0.072, BB.x, BB.y, 0, 18));
  for (const s of [-1, 1]) {
    const zSeat = s > 0 ? 0.075 : 0.062;   // the drive-side stay clears the chain
    paint.push(cylinderBetween(P(BB, s * 0.03), P(RA, s * 0.064), 0.0105, 0.0085, 8));
    paint.push(cylinderBetween(new THREE.Vector3(SC.x, SC.y, s * 0.014), P(RA, zSeat), 0.0095, 0.0075, 8));
    paint.push(box(0.05, 0.032, 0.007, RA.x, RA.y, zSeat));
  }
  const cup = (pt, rad, len, off = 0) => cylinderBetween(
    new THREE.Vector3(pt.x, pt.y, 0).addScaledVector(steerAxis, off - len / 2),
    new THREE.Vector3(pt.x, pt.y, 0).addScaledVector(steerAxis, off + len / 2), rad,
  );
  chrome.push(cup(HT, 0.027, 0.009), cup(HB, 0.027, 0.009));
  root.add(new THREE.Mesh(merge(paint), M.paint), new THREE.Mesh(merge(chrome), M.chrome));

  // fork crown, blades and steerer
  const tilt = Math.atan2(steerAxis.x, steerAxis.y);
  const crown = new THREE.Vector2(HT.x + (HB.x - HT.x) * 1.245, HT.y + (HB.y - HT.y) * 1.245);
  const forkParts = [box(0.05, 0.028, 0.12, crown.x, crown.y, 0, tilt)];
  for (const s of [-1, 1]) {
    forkParts.push(tube([
      new THREE.Vector3(crown.x, crown.y - 0.006, s * 0.05),
      new THREE.Vector3(crown.x + 0.012, 0.66, s * 0.055),
      new THREE.Vector3(crown.x + 0.034, 0.55, s * 0.058),
      new THREE.Vector3(FA.x - 0.035, 0.44, s * 0.06),
      new THREE.Vector3(FA.x, FA.y, s * 0.062),
    ], 0.0115, 18, 8));
  }
  const steerChrome = [
    cylinderBetween(new THREE.Vector3(HT.x, HT.y, 0).addScaledVector(steerAxis, 0.022), new THREE.Vector3(crown.x, crown.y, 0), 0.013),
    cup(HT, 0.017, 0.016, 0.028),
  ];
  holder.add(new THREE.Mesh(merge(forkParts), M.paint), new THREE.Mesh(merge(steerChrome), M.chrome));

  // stem and swept-back handlebar
  const bar = [
    new THREE.Vector3(0.355, 1.108, -0.265), new THREE.Vector3(0.385, 1.106, -0.215), new THREE.Vector3(0.418, 1.096, -0.165),
    new THREE.Vector3(0.44, 1.078, -0.09), new THREE.Vector3(0.447, 1.065, 0), new THREE.Vector3(0.44, 1.078, 0.09),
    new THREE.Vector3(0.418, 1.096, 0.165), new THREE.Vector3(0.385, 1.106, 0.215), new THREE.Vector3(0.355, 1.108, 0.265),
  ];
  const barChrome = [
    tube(bar, 0.0111, 48, 10),
    tube([new THREE.Vector3(0.348, 0.99, 0), new THREE.Vector3(0.345, 1.038, 0), new THREE.Vector3(0.356, 1.06, 0), new THREE.Vector3(0.40, 1.064, 0), new THREE.Vector3(0.447, 1.065, 0)], 0.0115, 20, 8),
  ];
  const grips = [];
  for (const s of [-1, 1]) {
    grips.push(cylinderBetween(new THREE.Vector3(0.385, 1.106, s * 0.215), new THREE.Vector3(0.357, 1.108, s * 0.262), 0.0175, 0.017, 14));
    barChrome.push(cylinderBetween(new THREE.Vector3(0.357, 1.108, s * 0.262), new THREE.Vector3(0.352, 1.108, s * 0.272), 0.012, 0.012, 10));
    // brake lever
    barChrome.push(cylinderBetween(new THREE.Vector3(0.432, 1.075, s * 0.2), new THREE.Vector3(0.472, 1.03, s * 0.212), 0.005, 0.0038, 6));
    barChrome.push(box(0.045, 0.016, 0.022, 0.44, 1.072, s * 0.2));
  }
  // brake cable sweeping back to the frame
  barChrome.push(tube([
    new THREE.Vector3(0.445, 1.062, 0.2), new THREE.Vector3(0.45, 1.0, 0.13), new THREE.Vector3(0.4, 0.93, 0.06),
    new THREE.Vector3(0.36, 0.86, 0.035), new THREE.Vector3(0.33, 0.8, 0.03),
  ], 0.0026, 20, 5));
  holder.add(new THREE.Mesh(merge(barChrome), M.chrome), new THREE.Mesh(merge(grips), M.cork));
  const gripMarks = [new THREE.Object3D(), new THREE.Object3D()];
  gripMarks[0].position.set(B.grip.x, B.grip.y, -B.grip.z);
  gripMarks[1].position.copy(B.grip);
  holder.add(gripMarks[0], gripMarks[1]);

  // bell (left of the stem, on the camera side of the hero view)
  const bell = new THREE.Group();
  bell.position.set(0.43, 1.104, -0.125);
  bell.add(
    new THREE.Mesh(merge([
      new THREE.SphereGeometry(0.026, 20, 10, 0, TAU, 0, Math.PI / 2),
      cylY(0.0275, 0.004, 0, 0.001, 0, 20),
      sphereAt(0.0055, 0, 0.027, 0, 10, 8),
    ]), M.chrome),
    new THREE.Mesh(box(0.034, 0.006, 0.008, -0.036, 0.004, 0), M.dark),
  );
  const bellMesh = bell.children[0];
  bellMesh.userData.pick = 'bell';
  bellMesh.userData.pickRoot = bell;
  holder.add(bell, new THREE.Mesh(cylY(0.006, 0.016, 0.43, 1.096, -0.125, 8), M.dark));

  // headlight under the stem
  const lampX = 0.49;
  const lampY = 1.028;
  const lensMesh = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24).rotateY(Math.PI / 2).translate(lampX + 0.036, lampY, 0), M.lens);
  const lampBody = new THREE.Mesh(merge([
    cylX(0.036, 0.07, lampX, lampY, 0, 20, 0.03),
    cylinderBetween(new THREE.Vector3(0.447, 1.06, 0), new THREE.Vector3(lampX - 0.01, lampY + 0.012, 0), 0.005),
  ]), M.chrome);
  holder.add(lampBody, lensMesh);
  const headlight = new THREE.SpotLight(0xfff1cc, 0, 26, 0.27, 0.75, 1.4);
  headlight.position.set(lampX + 0.05, lampY, 0);
  const headTarget = new THREE.Object3D();
  headTarget.position.set(lampX + 16, lampY - 2.4, 0);
  holder.add(headlight, headTarget);
  headlight.target = headTarget;

  // ---------------- fenders ----------------
  const rearFender = fender(RA.x, RA.y, 0.61, 3.75);
  const frontFender = fender(FA.x, FA.y, -0.61, 2.18);
  const rearEnd = new THREE.Vector3(RA.x + Math.cos(3.75) * (B.R + 0.034), RA.y + Math.sin(3.75) * (B.R + 0.034), 0);
  const frontEnd = new THREE.Vector3(FA.x + Math.cos(-0.61) * (B.R + 0.034), FA.y + Math.sin(-0.61) * (B.R + 0.034), 0);
  const fenderChrome = [];
  for (const s of [-1, 1]) {
    fenderChrome.push(cylinderBetween(new THREE.Vector3(RA.x, RA.y, s * 0.072), new THREE.Vector3(rearEnd.x, rearEnd.y, s * 0.034), 0.003, 0.003, 5));
  }
  const tailMesh = new THREE.Mesh(box(0.012, 0.034, 0.056, RA.x - 0.392, RA.y + 0.004, 0), M.tail);
  // licence plate dangling from the fender's rear end
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(0.12, 0.07).rotateY(-Math.PI / 2).rotateZ(0.18).translate(rearEnd.x + 0.006, rearEnd.y - 0.034, 0), M.plate,
  );
  root.add(new THREE.Mesh(rearFender, M.paint), tailMesh, plate, new THREE.Mesh(merge(fenderChrome), M.chrome));
  holder.add(new THREE.Mesh(frontFender, M.paint));
  const frontStays = [];
  for (const s of [-1, 1]) {
    frontStays.push(cylinderBetween(new THREE.Vector3(FA.x, FA.y, s * 0.07), new THREE.Vector3(frontEnd.x, frontEnd.y, s * 0.034), 0.003, 0.003, 5));
  }
  holder.add(new THREE.Mesh(merge(frontStays), M.chrome));

  // ---------------- saddle ----------------
  const saddleGeo = loftGeometry(resampleSections([
    { p: [-0.388, 0.925, 0], rx: 0.016, ry: 0.012 },
    { p: [-0.368, 0.927, 0], rx: 0.072, ry: 0.022 },
    { p: [-0.328, 0.928, 0], rx: 0.084, ry: 0.026 },
    { p: [-0.288, 0.925, 0], rx: 0.064, ry: 0.024 },
    { p: [-0.242, 0.927, 0], rx: 0.032, ry: 0.018 },
    { p: [-0.192, 0.933, 0], rx: 0.02, ry: 0.014 },
    { p: [-0.142, 0.938, 0], rx: 0.014, ry: 0.011 },
    { p: [-0.132, 0.938, 0], rx: 0.004, ry: 0.004 },
  ], 20), { radial: 16 });
  const seatDir = new THREE.Vector2(SC.x - BB.x, SC.y - BB.y).normalize();
  const postTop = new THREE.Vector3(SC.x + seatDir.x * 0.052, SC.y + seatDir.y * 0.052, 0);
  const postBot = new THREE.Vector3(SC.x - seatDir.x * 0.03, SC.y - seatDir.y * 0.03, 0);
  const saddleChrome = [cylinderBetween(postTop, postBot, 0.0135), cylZ(0.0175, 0.014, SC.x, SC.y, 0, 14)];
  for (const s of [-1, 1]) {
    saddleChrome.push(tube([
      new THREE.Vector3(-0.362, 0.906, s * 0.03), new THREE.Vector3(-0.29, 0.897, s * 0.026), new THREE.Vector3(-0.205, 0.92, s * 0.018),
    ], 0.0035, 12, 6));
  }
  saddleChrome.push(box(0.03, 0.018, 0.036, postTop.x, postTop.y - 0.004, 0));
  root.add(new THREE.Mesh(saddleGeo, M.leather), new THREE.Mesh(merge(saddleChrome), M.chrome));

  // ---------------- water bottle on the down tube ----------------
  const dt = new THREE.Vector2(BB.x - HB.x, BB.y - HB.y).normalize();
  const dn = new THREE.Vector2(dt.y, -dt.x);
  const bc = new THREE.Vector3((HB.x + BB.x) / 2 + dn.x * 0.056, (HB.y + BB.y) / 2 + dn.y * 0.056, 0);
  const bdir = new THREE.Vector3(dt.x, dt.y, 0);
  const cage = [];
  for (const k of [-0.045, 0.045]) {
    const ring = new THREE.TorusGeometry(0.031, 0.003, 6, 20);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), bdir);
    ring.applyMatrix4(new THREE.Matrix4().compose(bc.clone().addScaledVector(bdir, k), q, new THREE.Vector3(1, 1, 1)));
    cage.push(ring);
  }
  root.add(
    new THREE.Mesh(cylinderBetween(bc.clone().addScaledVector(bdir, -0.08), bc.clone().addScaledVector(bdir, 0.08), 0.028, 0.028, 16), M.bottle),
    new THREE.Mesh(cylinderBetween(bc.clone().addScaledVector(bdir, 0.08), bc.clone().addScaledVector(bdir, 0.1), 0.018, 0.016, 12), M.bottleCap),
    new THREE.Mesh(merge(cage), M.dark),
  );

  // ---------------- wicker basket with the day's catch ----------------
  const bx = 0.6;
  const by = 0.86;
  const basketGeo = new THREE.CylinderGeometry(1, 0.8, 1, 4, 1, true).rotateY(Math.PI / 4).scale(0.125, 0.17, 0.165).translate(bx, by, 0);
  const rim = [];
  for (const s of [-1, 1]) {
    rim.push(cylinderBetween(new THREE.Vector3(bx + s * 0.088, 0.945, -0.117), new THREE.Vector3(bx + s * 0.088, 0.945, 0.117), 0.008));
    rim.push(cylinderBetween(new THREE.Vector3(bx - 0.088, 0.945, s * 0.117), new THREE.Vector3(bx + 0.088, 0.945, s * 0.117), 0.008));
  }
  const basketStruts = [];
  for (const s of [-1, 1]) {
    basketStruts.push(cylinderBetween(new THREE.Vector3(bx - 0.08, 0.79, s * 0.09), new THREE.Vector3(crown.x + 0.004, crown.y - 0.01, s * 0.05), 0.005));
    basketStruts.push(cylinderBetween(new THREE.Vector3(bx - 0.084, 0.94, s * 0.1), new THREE.Vector3(0.44, 1.06, s * 0.085), 0.005));
  }
  // fish stand nose-down in the basket, tails sticking out above the rim
  const fishGeo = fishGeometry();
  const fishes = [];
  const fishSpots = [[-0.072, 1.38, -0.25], [0, 1.2, 0.1], [0.072, 1.5, 0.32]];
  for (const [z, roll, yaw] of fishSpots) {
    const f = new THREE.Group();
    const m = new THREE.Mesh(fishGeo, M.fish);
    m.userData.pick = 'fish';
    m.userData.pickRoot = f;
    f.add(m);
    f.position.set(bx - 0.015, 0.79, z);
    f.rotation.set(0, yaw, roll);
    f.userData.base = { roll, yaw };
    f.userData.phase = fishes.length * 2.1;
    fishes.push(f);
    holder.add(f);
  }
  holder.add(new THREE.Mesh(basketGeo, M.wicker), new THREE.Mesh(merge(rim), M.wickerDark), new THREE.Mesh(merge(basketStruts), M.chrome));
  holder.add(new THREE.Mesh(box(0.15, 0.012, 0.2, bx, 0.778, 0), M.wickerDark));

  // ---------------- drivetrain ----------------
  const crank = new THREE.Group();
  crank.position.set(BB.x, BB.y, 0);
  root.add(crank);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, B.ringR, 0, TAU, false);
  const hole = (cx, cy, rad) => { const h = new THREE.Path(); h.absarc(cx, cy, rad, 0, TAU, true); shape.holes.push(h); };
  hole(0, 0, 0.017);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; hole(Math.cos(a) * 0.052, Math.sin(a) * 0.052, 0.027); }
  const ringGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false, curveSegments: 40 }).translate(0, 0, B.chainZ - 0.0015);
  const teeth = [];
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * TAU;
    teeth.push(box(0.0055, 0.0075, 0.0028, 0, 0, 0).rotateZ(a).translate(Math.cos(a) * (B.ringR + 0.0015), Math.sin(a) * (B.ringR + 0.0015), B.chainZ));
  }
  const armGeo = new RoundedBoxGeometry(0.022, 0.2, 0.013, 2, 0.0055);
  const armR = new THREE.Mesh(armGeo, M.chrome);
  armR.position.set(0, -0.075, 0.0625);
  const armL = new THREE.Mesh(armGeo, M.chrome);
  armL.position.set(0, 0.075, -0.0625);
  const pedals = [];
  for (const s of [1, -1]) {
    const pedal = new THREE.Group();
    const y = -s * B.crank;
    pedal.position.set(0, y, s * B.pedalZ);
    pedal.add(
      new THREE.Mesh(new RoundedBoxGeometry(0.095, 0.016, 0.078, 2, 0.005), M.dark),
      new THREE.Mesh(merge([box(0.004, 0.011, 0.05, 0.049, 0, 0), box(0.004, 0.011, 0.05, -0.049, 0, 0)]), M.orange),
    );
    pedals.push(pedal);
    crank.add(pedal);
    crank.add(new THREE.Mesh(cylZ(0.006, 0.048, 0, y, s * 0.086, 8), M.steel));
  }
  crank.add(new THREE.Mesh(ringGeo, M.chrome), new THREE.Mesh(merge(teeth), M.steel), armR, armL, new THREE.Mesh(cylZ(0.0085, 0.125, 0, 0, 0, 10), M.steel));

  const loop = new LoopPath(chainLoop(BB, B.ringR, RA, B.cogR));
  const N = Math.round(loop.len / 0.0127);
  const pitch = loop.len / N;
  const plates = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.0105, 0.0014), M.chainPlate, N * 2);
  const rollers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0038, 0.0038, 0.0074, 8).rotateX(Math.PI / 2), M.steel, N);
  const pins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0019, 0.0019, 0.0155, 6).rotateX(Math.PI / 2), M.steel, N);
  plates.frustumCulled = rollers.frustumCulled = pins.frustumCulled = false;
  root.add(plates, rollers, pins);

  // ---------------- shadows ----------------
  const noCast = new Set([rear.blur, front.blur, rear.spokeMesh, front.spokeMesh, plates, rollers, pins, lensMesh]);
  root.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      o.castShadow = !noCast.has(o);
      o.receiveShadow = o.isMesh;
    }
  });
  for (const w of [rear, front]) {
    w.spokeMesh.material.transparent = true;
  }

  const api = {
    group: root,
    B,
    roll: 0,
    pickMeshes: [bellMesh, ...fishes.map((f) => f.children[0])],
    headlight,
    bell,
    steer,
    _q: new THREE.Quaternion(),
    _o: { x: 0, y: 0, tx: 1, ty: 0 },
    _m: new THREE.Matrix4(),
    _p: new THREE.Vector3(),
    _s: new THREE.Vector3(1, 1, 1),
    _z: new THREE.Vector3(0, 0, 1),
    bellAnim: 0,
    fishAnim: 0,
    t: 0,
    setColor(hex) { M.paint.color.set(hex); M.bottleCap.color.copy(M.paint.color); },
    ring() { api.bellAnim = 1; },
    flopFish() { api.fishAnim = 1.5; },
    fishWorld(out) { return fishes[1].getWorldPosition(out); },
    bellWorld(out) { return bell.getWorldPosition(out); },
    /** World position of a pedal's top face. side: +1 right, -1 left. */
    getPedal(side, out) {
      return out.set(BB.x - B.crank * Math.sin(api.theta), BB.y - B.crank * Math.cos(api.theta) * side, side * B.pedalZ).add(api._p.set(0, 0.008, 0));
    },
    getGrip(side, out) { return (side > 0 ? gripMarks[1] : gripMarks[0]).getWorldPosition(out); },
    update(dt, speed, theta, time, night, steerWobble = 0) {
      api.theta = theta;
      api.roll += (speed * dt) / B.R;
      rear.group.rotation.z = front.group.rotation.z = -api.roll;
      const blur = smoothstep(3.4, 9, speed) * 0.9;
      M.spoke.opacity = 1 - blur;
      M.blur.opacity = blur * 0.8;
      crank.rotation.z = -theta;
      pedals[0].rotation.z = pedals[1].rotation.z = theta;
      const off = ((theta * B.ringR) % loop.len + loop.len) % loop.len;
      const o = api._o;
      const m = api._m;
      for (let k = 0; k < N; k++) {
        const s = off + k * pitch;
        loop.at(s, o);
        m.makeTranslation(o.x, o.y, B.chainZ);
        rollers.setMatrixAt(k, m);
        pins.setMatrixAt(k, m);
        loop.at(s + pitch * 0.5, o);
        const ang = Math.atan2(o.ty, o.tx);
        api._q.setFromAxisAngle(api._z, ang);
        api._p.set(o.x, o.y, B.chainZ + (k % 2 ? 0.0037 : 0.0053));
        api._s.set(pitch * 0.92, k % 2 ? 0.84 : 1.05, 1);
        m.compose(api._p, api._q, api._s);
        plates.setMatrixAt(k * 2, m);
        api._p.z = B.chainZ - (k % 2 ? 0.0037 : 0.0053);
        m.compose(api._p, api._q, api._s);
        plates.setMatrixAt(k * 2 + 1, m);
      }
      plates.instanceMatrix.needsUpdate = rollers.instanceMatrix.needsUpdate = pins.instanceMatrix.needsUpdate = true;
      steer.quaternion.copy(qBase).multiply(api._q.setFromAxisAngle(UP, steerWobble));
      steer.updateMatrixWorld(true);
      api.t += dt;
      if (api.bellAnim > 0) {
        api.bellAnim = Math.max(0, api.bellAnim - dt * 2.2);
        bell.rotation.x = Math.sin(api.bellAnim * 46) * 0.28 * api.bellAnim;
      }
      if (api.fishAnim > 0) {
        api.fishAnim = Math.max(0, api.fishAnim - dt);
        const env = smoothstep(0, 0.15, api.fishAnim) * smoothstep(1.5, 1.1, api.fishAnim);
        for (const f of fishes) {
          const b = f.userData.base;
          f.rotation.set(0, b.yaw + Math.sin(api.t * 21 + f.userData.phase) * 0.35 * env, b.roll + Math.sin(api.t * 27 + f.userData.phase) * 0.5 * env);
        }
      }
      headlight.intensity = night * 30;
      M.lens.emissiveIntensity = night * 1.8;
      M.tail.emissiveIntensity = 0.1 + night * 2.4;
    },
  };
  api.update(0, 0, 0, 0, 0);
  return api;
}

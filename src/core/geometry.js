// Procedural geometry toolkit: lofts (skins a series of cross-sections along a path),
// static part helpers and merge utilities. Everything in the scene is built from these.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/**
 * Parallel-transport frames along a polyline. Returns per-point tangents, normals
 * (initially aligned with `hint`) and binormals = tangent x normal.
 */
export function computeFrames(points, hint = UP) {
  const n = points.length;
  const T = [];
  const N = [];
  const B = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3().subVectors(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]);
    if (t.lengthSq() < 1e-12) t.set(1, 0, 0);
    T.push(t.normalize());
  }
  let nrm = hint.clone().addScaledVector(T[0], -hint.dot(T[0]));
  if (nrm.lengthSq() < 1e-6) {
    const alt = Math.abs(T[0].y) < 0.9 ? _a.set(0, 1, 0) : _a.set(1, 0, 0);
    nrm = alt.clone().addScaledVector(T[0], -alt.dot(T[0]));
  }
  nrm.normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      _axis.crossVectors(T[i - 1], T[i]);
      const l = _axis.length();
      if (l > 1e-9) {
        _axis.multiplyScalar(1 / l);
        nrm.applyAxisAngle(_axis, Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1)));
      }
      nrm.addScaledVector(T[i], -nrm.dot(T[i])).normalize();
    }
    N.push(nrm.clone());
    B.push(new THREE.Vector3().crossVectors(T[i], nrm).normalize());
  }
  return { T, N, B };
}

const spow = (v, p) => (p === 1 ? v : v >= 0 ? Math.pow(v, p) : -Math.pow(-v, p));

/**
 * A section is { p: Vector3, rx, ry, pow? }: an ellipse of half-size rx (along the
 * binormal) and ry (along the normal), centred on p. `pow` < 1 boxier, > 1 pointier.
 */
export function loftGeometry(sections, opts = {}) {
  const radial = Math.max(3, Math.round(opts.radial ?? 12));
  const thetaStart = opts.thetaStart ?? 0;
  const thetaLength = opts.thetaLength ?? TAU;
  const closed = thetaLength >= TAU - 1e-6;
  const cap = !!opts.cap && closed;
  const n = sections.length;
  const count = n * radial + (cap ? 2 : 0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const idx = [];
  const cols = closed ? radial : radial - 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (cap) {
    const cs = n * radial;
    const ce = cs + 1;
    const last = (n - 1) * radial;
    for (let j = 0; j < radial; j++) {
      const a = j;
      const b = (j + 1) % radial;
      idx.push(cs, b, a, ce, last + a, last + b);
    }
  }
  geo.setIndex(idx);
  geo.userData.loft = { radial, thetaStart, thetaLength, hint: (opts.hint ?? UP).clone(), cap };
  updateLoft(geo, sections);
  return geo;
}

/** Re-skin an existing loft with new sections (same counts as at creation). */
export function updateLoft(geo, sections) {
  const o = geo.userData.loft;
  if (!o) return geo;
  const { radial, thetaStart, thetaLength } = o;
  const closed = thetaLength >= TAU - 1e-6;
  const frames = computeFrames(sections.map((s) => s.p), o.hint);
  const pos = geo.attributes.position.array;
  const n = sections.length;
  const denom = closed ? radial : radial - 1;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = sections[i];
    const p = s.p;
    const N = frames.N[i];
    const Bn = frames.B[i];
    const pw = s.pow ?? 1;
    for (let j = 0; j < radial; j++) {
      const th = thetaStart + (thetaLength * j) / denom;
      const cn = spow(Math.cos(th), pw) * s.ry;
      const cb = spow(Math.sin(th), pw) * s.rx;
      pos[k++] = p.x + N.x * cn + Bn.x * cb;
      pos[k++] = p.y + N.y * cn + Bn.y * cb;
      pos[k++] = p.z + N.z * cn + Bn.z * cb;
    }
  }
  if (o.cap) {
    const f = sections[0].p;
    const l = sections[n - 1].p;
    pos[k++] = f.x; pos[k++] = f.y; pos[k++] = f.z;
    pos[k++] = l.x; pos[k++] = l.y; pos[k++] = l.z;
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Catmull-Rom on a 1D value list; t in [0, 1] spans the whole list. */
export function smoothSample(v, t) {
  const n = v.length;
  const f = Math.min(Math.max(t, 0), 0.999999) * (n - 1);
  const i = Math.floor(f);
  const u = f - i;
  const p0 = v[Math.max(0, i - 1)];
  const p1 = v[i];
  const p2 = v[Math.min(n - 1, i + 1)];
  const p3 = v[Math.min(n - 1, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
}

/** Smooth a coarse list of sections into `n` evenly spaced ones (Catmull-Rom). */
export function resampleSections(ctrl, n, pow = 1) {
  const curve = new THREE.CatmullRomCurve3(
    ctrl.map((s) => (s.p.isVector3 ? s.p : new THREE.Vector3(s.p[0], s.p[1], s.p[2]))),
    false,
    'centripetal',
    0.5,
  );
  const rx = ctrl.map((s) => s.rx);
  const ry = ctrl.map((s) => s.ry);
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    out.push({ p: curve.getPoint(u), rx: Math.max(0.0012, smoothSample(rx, u)), ry: Math.max(0.0012, smoothSample(ry, u)), pow });
  }
  return out;
}

/** Sections along a point list with constant or functional radii. */
export function sectionsFromPoints(points, rx, ry, pow = 1) {
  const d = points.length - 1 || 1;
  return points.map((p, i) => {
    const u = i / d;
    return { p: p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]), rx: typeof rx === 'function' ? rx(u) : rx, ry: typeof ry === 'function' ? ry(u) : ry, pow };
  });
}

export function arcPoints(cx, cy, r, a0, a1, n, z = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push(new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), z));
  }
  return pts;
}

/** Cylinder whose `ra` end sits at point a and `rb` end at point b (already placed in space). */
export function cylinderBetween(a, b, ra, rb = ra, seg = 10) {
  _a.subVectors(b, a);
  const len = _a.length();
  const g = new THREE.CylinderGeometry(ra, rb, len, seg, 1, false);
  _b.copy(_a).multiplyScalar(-1 / len);
  _m.compose(_axis.addVectors(a, b).multiplyScalar(0.5), _q.setFromUnitVectors(UP, _b), ONE);
  return g.applyMatrix4(_m);
}

/** Smooth tube through control points. */
export function tube(points, radius = 0.01, seg = 24, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))),
    false,
    'catmullrom',
    0.5,
  );
  return new THREE.TubeGeometry(curve, seg, radius, radial, false);
}

export function sphereAt(r, x, y, z, w = 12, h = 8) {
  return new THREE.SphereGeometry(r, w, h).translate(x, y, z);
}

function swapTriangles(g) {
  const attrs = Object.values(g.attributes);
  for (const att of attrs) {
    const arr = att.array;
    const s = att.itemSize;
    for (let i = 0; i + 2 < att.count; i += 3) {
      for (let c = 0; c < s; c++) {
        const t = arr[(i + 1) * s + c];
        arr[(i + 1) * s + c] = arr[(i + 2) * s + c];
        arr[(i + 2) * s + c] = t;
      }
    }
  }
}

/** Mirror a geometry across z (winding fixed so faces still point outward). */
export function mirrorZ(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.scale(1, 1, -1);
  swapTriangles(g);
  g.computeVertexNormals();
  return g;
}

/** Vertex colours interpolated along a local axis: c0 at a0, c1 at a1. */
export function colorByAxis(geo, axis, a0, a1, c0, c1) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const A = new THREE.Color(c0);
  const Bc = new THREE.Color(c1);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = clamp((pos.array[i * 3 + axis] - a0) / (a1 - a0), 0, 1);
    tmp.copy(A).lerp(Bc, t);
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function setVertexColor(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * Map a geometry built along +x (width on z, thickness on y) onto a blade that
 * starts at `origin`, points along `dir` and whose flat face turns toward `faceHint`.
 */
export function orientBlade(geo, origin, dir, faceHint) {
  const X = dir.clone().normalize();
  const Z = new THREE.Vector3().crossVectors(X, faceHint);
  if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1).cross(X);
  Z.normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
  _m.makeBasis(X, Y, Z).setPosition(origin);
  return geo.applyMatrix4(_m);
}

/** Merge geometries into one draw call. Mixed attribute sets are normalised. */
export function merge(geos) {
  const list = [];
  for (const g0 of geos) {
    if (!g0) continue;
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    list.push(g);
  }
  if (!list.length) return null;
  if (!list.every((g) => g.attributes.color)) for (const g of list) if (g.attributes.color) g.deleteAttribute('color');
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return merged;
}

export { UP };

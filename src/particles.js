// GPU-instanced billboard particles: one draw call per pool, simulated on the CPU.
import * as THREE from 'three';
import { smoothstep } from './core/util.js';
import * as TX from './core/textures.js';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec3 iParam;
uniform float uAxis;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = uv;
  vColor = iColor;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 c = uv - 0.5;
  vec3 world;
  if (uAxis > 0.5) {
    // streak aligned with world x, the direction of travel
    vec3 vx = (viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
    float l = length(vx.xy);
    vec2 dir = l > 0.001 ? vx.xy / l : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 o = dir * c.x * iParam.x + perp * c.y * iParam.y;
    world = iPos + camRight * o.x + camUp * o.y;
    vColor.a *= smoothstep(0.0, 0.25, l);
  } else {
    float cr = cos(iParam.y);
    float sr = sin(iParam.y);
    vec2 r = vec2(c.x * cr - c.y * sr, c.x * sr + c.y * cr);
    world = iPos + (camRight * r.x + camUp * r.y) * iParam.x;
  }
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  // fade out right in front of the lens so nothing becomes a blob
  vColor.a *= smoothstep(0.25, 0.9, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, a);
}`;

const BASE = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grav: 0, drag: 0, sway: 0, swayFreq: 5, phase: 0, flow: 0, wrapX: 0,
  s0: 0.1, s1: 0.1, rot: 0, spin: 0, r: 1, g: 1, b: 1, a: 0.8, fade: 1, fadeIn: 0.02, mod: null, life: 1, rand: 0.5,
};

class Pool {
  constructor({ texture, max = 64, blending = THREE.NormalBlending, axis = false, renderOrder = 8 }) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    geo.setAttribute('uv', plane.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aParam = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iParam', this.aParam);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uAxis: { value: axis ? 1 : 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.axis = axis;
    this.max = max;
    this.list = [];
    this.n = 0;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  spawn(o) {
    if (this.n >= this.max) return;
    let p = this.list[this.n];
    if (!p) {
      p = {};
      this.list.push(p);
    }
    Object.assign(p, BASE, o);
    p.age = 0;
    this.n++;
  }

  update(dt, time, ctx) {
    let n = this.n;
    const P = this.aPos.array;
    const C = this.aColor.array;
    const M = this.aParam.array;
    const list = this.list;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      p.age += dt;
      if (p.age >= p.life) {
        // swap-remove so live particles stay packed at the front
        n--;
        list[i] = list[n];
        list[n] = p;
        i--;
        continue;
      }
      const dr = p.drag ? Math.exp(-p.drag * dt) : 1;
      p.vx *= dr;
      p.vz *= dr;
      p.vy = p.vy * dr + p.grav * dt;
      if (p.sway) {
        p.vx += Math.sin(p.age * p.swayFreq + p.phase) * p.sway * dt;
        p.vz += Math.cos(p.age * p.swayFreq * 0.8 + p.phase) * p.sway * 0.7 * dt;
      }
      p.x += (p.vx - (p.flow ? ctx.speed * p.flow : 0)) * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.wrapX && p.x < -p.wrapX) p.x += p.wrapX * 2;
      const u = p.age / p.life;
      const a = p.a * Math.pow(1 - u, p.fade) * Math.min(1, p.age / p.fadeIn) * (p.mod ? p.mod(p, time, ctx) : 1);
      p.rot += p.spin * dt;
      P[i * 3] = p.x;
      P[i * 3 + 1] = p.y;
      P[i * 3 + 2] = p.z;
      C[i * 4] = p.r;
      C[i * 4 + 1] = p.g;
      C[i * 4 + 2] = p.b;
      C[i * 4 + 3] = a;
      if (this.axis) {
        M[i * 3] = p.s0;
        M[i * 3 + 1] = p.s1;
      } else {
        M[i * 3] = p.s0 + (p.s1 - p.s0) * u;
        M[i * 3 + 1] = p.rot;
      }
    }
    this.n = n;
    this.mesh.geometry.instanceCount = n;
    this.aPos.needsUpdate = this.aColor.needsUpdate = this.aParam.needsUpdate = true;
  }
}

export function createParticles(scene) {
  const feathers = new Pool({ texture: TX.featherTexture(), max: 56 });
  const dust = new Pool({ texture: TX.puffTexture(), max: 72 });
  const notes = new Pool({ texture: TX.noteTexture(), max: 16, renderOrder: 12 });
  const glow = new Pool({ texture: TX.glowTexture(), max: 120, blending: THREE.AdditiveBlending });
  const streaks = new Pool({ texture: TX.streakTexture(), max: 56, blending: THREE.AdditiveBlending, axis: true });
  const pools = [feathers, dust, notes, glow, streaks];
  for (const p of pools) scene.add(p.mesh);
  const R = Math.random;
  const TAU = Math.PI * 2;
  const _v = new THREE.Vector3();

  // speed lines live forever and only become visible at high speed
  for (let i = 0; i < 44; i++) {
    const side = R() < 0.5 ? -1 : 1;
    streaks.spawn({
      x: (R() - 0.5) * 18, y: 0.3 + R() * 3.6, z: side * (1.4 + R() * 3.2), vx: -46, wrapX: 9,
      s0: 1.3 + R() * 2.0, s1: 0.018 + R() * 0.03, life: 1e9, a: 0.5, fadeIn: 1e-9, rand: R(),
      mod: (p, time, ctx) => ctx.streak * (0.3 + 0.7 * p.rand),
    });
  }
  // fireflies over the verge, visible only at night
  for (let i = 0; i < 40; i++) {
    glow.spawn({
      x: (R() - 0.5) * 60, y: 0.25 + R() * 1.3, z: -4.2 - R() * 5, flow: 1, wrapX: 30, sway: 0.9, swayFreq: 1.3, drag: 1,
      phase: R() * TAU, s0: 0.1 + R() * 0.08, life: 1e9, r: 1, g: 0.86, b: 0.36, a: 1, fadeIn: 1e-9, rand: R(),
      mod: (p, time, ctx) => ctx.night * (0.5 + 0.5 * Math.sin(time * (2 + p.rand * 3) + p.phase)) ** 2,
    });
  }

  function featherBurst(n, spot) {
    for (let i = 0; i < n; i++) {
      feathers.spawn({
        x: spot.x + (R() - 0.5) * 0.3, y: spot.y + (R() - 0.5) * 0.3, z: spot.z + (R() - 0.5) * 0.3,
        vx: -0.8 - R() * 1.2, vy: 0.2 + R() * 0.8, vz: (R() - 0.5) * 1.4, grav: -0.5, drag: 1.2,
        sway: 2.6, swayFreq: 4 + R() * 3, phase: R() * TAU, s0: 0.05 + R() * 0.04, rot: R() * TAU, spin: (R() - 0.5) * 5,
        life: 2.4 + R() * 1.6, a: 0.95, fadeIn: 0.05,
      });
    }
  }

  function notesAt(x, y, z, n = 3) {
    for (let i = 0; i < n; i++) {
      notes.spawn({
        x, y, z, vx: 0.1 + (R() - 0.5) * 0.5, vy: 0.8 + R() * 0.5, vz: (R() - 0.3) * 0.5, drag: 0.8, sway: 1.6, swayFreq: 5,
        phase: R() * TAU, s0: 0.13 + R() * 0.05, rot: (R() - 0.5) * 0.5, spin: (R() - 0.5) * 2, life: 1.2 + R() * 0.5, a: 1, fadeIn: 0.05,
      });
    }
  }

  function splash(x, y, z) {
    glow.spawn({ x, y, z, s0: 0.3, s1: 1.3, life: 0.5, r: 0.85, g: 0.93, b: 1, a: 0.5, fadeIn: 0.02, vx: -2 });
    for (let i = 0; i < 14; i++) {
      const a = R() * TAU;
      const sp = 0.8 + R() * 1.6;
      glow.spawn({
        x, y, z, vx: Math.cos(a) * sp * 0.6, vz: Math.sin(a) * sp * 0.6, vy: 1.8 + R() * 2.4, grav: -7,
        s0: 0.05 + R() * 0.05, s1: 0.02, life: 0.55 + R() * 0.35, r: 0.8, g: 0.9, b: 1, a: 0.9, fadeIn: 0.01,
      });
    }
  }

  let featherTimer = 1.5;
  let dustAcc = 0;

  function update(dt, ctx) {
    const sprint = ctx.sprint || 0;
    ctx.streak = ctx.reduced ? 0 : smoothstep(7.5, 12.5, ctx.speed) * 0.55 + sprint * 0.4;
    // a feather sheds now and then, and in a burst when sprinting
    featherTimer -= dt * (0.3 + ctx.speed * 0.1 + sprint * 9);
    if (featherTimer < 0) {
      featherTimer = 1;
      ctx.featherSpot(_v);
      featherBurst(1, _v);
    }
    // dust from the rear tyre under hard braking
    if (ctx.decel > 1.4 && ctx.speed > 0.8) {
      dustAcc += dt * ctx.decel * 5;
      while (dustAcc > 1) {
        dustAcc -= 1;
        dust.spawn({
          x: -0.55 + (R() - 0.5) * 0.2, y: 0.05, z: (R() - 0.5) * 0.2, vx: -1.2 - R() * 1.5, vy: 0.3 + R() * 0.6, vz: (R() - 0.5) * 1.2,
          grav: 0.25, drag: 2.6, s0: 0.1, s1: 0.5 + R() * 0.3, life: 0.7 + R() * 0.5, r: 0.78, g: 0.7, b: 0.58, a: 0.34, fadeIn: 0.04,
        });
      }
    }
    for (const p of pools) p.update(dt, ctx.time, ctx);
  }

  return { update, featherBurst, notesAt, splash, pools };
}

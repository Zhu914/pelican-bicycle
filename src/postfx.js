// Render pipeline: scene -> bloom -> tone mapping / sRGB -> final grade
// (speed blur, chromatic aberration, vignette, grain).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uBlur: { value: 0 },
    uVignette: { value: 0.36 },
    uGrain: { value: 0.026 },
    uAberration: { value: 0.0012 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uBlur;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    varying vec2 vUv;
    float gh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r = length(c);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
      // radial smear toward the edges while sprinting
      if (uBlur > 0.002) {
        vec3 acc = col;
        for (int i = 1; i <= 6; i++) {
          float f = float(i) / 6.0;
          acc += texture2D(tDiffuse, vUv - c * f * uBlur * 0.1).rgb;
        }
        col = acc / 7.0;
      }
      if (uAberration > 0.00001) {
        col.r = texture2D(tDiffuse, vUv + c * uAberration * r).r;
        col.b = texture2D(tDiffuse, vUv - c * uAberration * r).b;
      }
      col *= 1.0 - uVignette * smoothstep(0.32, 0.92, r);
      col += (gh(vUv * 1024.0 + fract(uTime) * 37.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export function createPostFX(renderer, scene, camera, { msaa = 4 } = {}) {
  const ext = renderer.extensions;
  const halfFloat = (ext.has ? ext.has('EXT_color_buffer_float') : ext.get('EXT_color_buffer_float') !== null)
    || (ext.has ? ext.has('EXT_color_buffer_half_float') : ext.get('EXT_color_buffer_half_float') !== null);
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: msaa });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.22, 0.4, 1.6);
  // The bloom blur would smear one NaN pixel across the whole frame, so scrub the input.
  // The anchor is the stock high-pass shader's texture fetch; fail loudly if a three.js
  // upgrade changes it, rather than silently losing the guard.
  const highPass = bloom.materialHighPassFilter;
  const ANCHOR = 'vec4 texel = texture2D( tDiffuse, vUv );';
  if (!highPass.fragmentShader.includes(ANCHOR)) {
    throw new Error('UnrealBloomPass high-pass shader changed: NaN scrub anchor not found');
  }
  highPass.fragmentShader = highPass.fragmentShader.replace(
    ANCHOR,
    'vec4 texel = texture2D( tDiffuse, vUv );\n    if ( any( isnan( texel.rgb ) ) || any( isinf( texel.rgb ) ) ) texel.rgb = vec3( 0.0 );',
  );
  highPass.needsUpdate = true;
  const output = new OutputPass();
  const grade = new ShaderPass(GradeShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  function setSize(w, h) {
    composer.setSize(w, h);
  }

  function setMSAA(n) {
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      target.samples = n;
      target.dispose();
    }
  }

  return {
    composer,
    bloom,
    grade,
    setSize,
    setMSAA,
    render() {
      composer.render();
    },
  };
}

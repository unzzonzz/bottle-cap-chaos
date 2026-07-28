import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
} from 'three';

/**
 * The one and only fullscreen pass.
 *
 * Everything that happens between "scene is in the render target" and "pixels on
 * screen" happens inside this single fragment shader: the nearest-neighbour
 * upscale, the 4x4 Bayer dither and the 15-bit (5:5:5) quantiser. No
 * EffectComposer, no ping-ponging between targets.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // PlaneGeometry(2, 2) already spans clip space; skip the matrices entirely.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uScene;
  uniform vec2  uTargetRes;   // low-res grid the scene was rendered at
  uniform float uBrightness;
  uniform float uDitherAmount;
  uniform float uColorLevels;

  varying vec2 vUv;

  // Ordered 4x4 Bayer, computed rather than looked up. three compiles
  // ShaderMaterial as GLSL ES 1.00, which does not allow indexing a const array
  // with a non-constant expression, so a hardcoded matrix would not portably
  // compile. This recursion reproduces the standard matrix exactly:
  //   0  8  2 10 / 12  4 14  6 / 3 11  1  9 / 15  7 13  5, all over 16.
  float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

  void main() {
    vec2 uv = vUv;

    // uScene uses NearestFilter, so this read is constant across each low-res
    // texel block — that is what makes the stair-stepping crisp.
    vec3 c = texture2D(uScene, uv).rgb;

    c *= uBrightness;

    // ── dither + colour reduction ──────────────────────────────────────────
    // The threshold is keyed off the LOW-RES texel index, never the screen
    // pixel. Dithering in display space pushes the 4x4 pattern below the size of
    // one source pixel, where it reads as faint noise instead of as ordered
    // dithering, and the whole effect is wasted.
    float bayer = bayer4(floor(uv * uTargetRes));
    c += (bayer - 0.5) * uDitherAmount / uColorLevels;
    c = floor(clamp(c, 0.0, 1.0) * uColorLevels + 0.5) / uColorLevels;

    gl_FragColor = vec4(c, 1.0);
  }
`;

/** 5 bits per channel, as the hardware had. `uColorLevels` at 255 is "off". */
export const PS1_COLOR_LEVELS = 31.0;

export class RetroPass {
  constructor({ resolution }) {
    this.uniforms = {
      uScene: { value: null },
      uTargetRes: { value: new Vector2().copy(resolution) },
      uBrightness: { value: 1.0 },
      uDitherAmount: { value: 1.0 },
      uColorLevels: { value: PS1_COLOR_LEVELS },
    };

    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.geometry = new PlaneGeometry(2, 2);
    this.quad = new Mesh(this.geometry, this.material);
    this.quad.frustumCulled = false;

    this.scene = new Scene();
    this.scene.add(this.quad);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setResolution(resolution) {
    this.uniforms.uTargetRes.value.copy(resolution);
  }

  /** @param {import('three').WebGLRenderer} renderer */
  render(renderer, sceneTexture) {
    this.uniforms.uScene.value = sceneTexture;
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.scene.clear();
  }
}

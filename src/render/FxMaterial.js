import {
  AddEquation,
  AdditiveBlending,
  CustomBlending,
  NormalBlending,
  OneFactor,
  OneMinusDstColorFactor,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  ZeroFactor,
} from 'three';

/**
 * The effects' material: unlit, snapped, tinted, and scrollable.
 *
 * Everything a card effect draws goes through this, and it goes through it for
 * the same reason the cards do — it has to land on the same pixel grid, get the
 * same dither and the same five bits a channel as the pitch behind it. An effect
 * drawn with a stock `MeshBasicMaterial` would be the one smooth thing on
 * screen, which is precisely the failure this project keeps having to avoid.
 *
 * Four things it does that `RetroMaterial` does not:
 *
 *   UNLIT       an additive spark has no normal worth shading and no side facing
 *               away from the key light.
 *   ADDITIVE    the era's glow, and the only one it had. `src + dst`, no bloom,
 *               no separate pass, no threshold.
 *   UV WINDOW   `uUvRect` selects one frame out of a sprite sheet, so a stepped
 *               animation is a uniform change rather than a texture swap.
 *   UV SCROLL   `uUvScroll` slides the window, which is how a trajectory line
 *               flows without a vertex moving.
 *
 * `uTint` is the palette. Cycling it through a handful of colours on a stepped
 * timer is what the hardware did with a CLUT, and it is why the chaos stars
 * change colour without a second texture existing.
 */

const VERT = /* glsl */ `
  uniform vec2  uTargetRes;
  uniform float uSnapAmount;
  uniform vec4  uUvRect;     // xy = origin, zw = size, in 0..1 of the sheet
  uniform vec2  uUvScroll;

  varying vec2 vUv;

  void main() {
    vUv = uUvRect.xy + (uv + uUvScroll) * uUvRect.zw;

    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    if (clip.w > 0.0001 && uSnapAmount > 0.0) {
      vec2 grid = uTargetRes * 0.5;
      vec3 ndc = clip.xyz / clip.w;
      ndc.xy = mix(ndc.xy, floor(ndc.xy * grid) / grid, uSnapAmount);
      clip.xyz = ndc * clip.w;
    }
    gl_Position = clip;
  }
`;

/** No texture, no tint: the blend function is the whole effect. */
const INVERT_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3  uTint;
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    gl_FragColor = vec4(tex.rgb * uTint, tex.a * uOpacity);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

export class FxMaterials {
  /** @param {import('three').Vector2} resolution  the low-res target's size */
  constructor({ resolution }) {
    /** Shared, so one slider moves every effect on screen. */
    this.shared = {
      uTargetRes: { value: new Vector2().copy(resolution) },
      uSnapAmount: { value: 1 },
    };
    this._materials = new Set();
  }

  setResolution(resolution) {
    this.shared.uTargetRes.value.copy(resolution);
  }

  /**
   * @param {import('three').Texture} map
   * @param {{additive?: boolean, depthTest?: boolean, depthWrite?: boolean}} opts
   */
  create(map, { additive = true, depthTest = false, depthWrite = false } = {}) {
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: additive ? AdditiveBlending : NormalBlending,
      depthTest,
      depthWrite,
      uniforms: {
        ...this.shared,
        uMap: { value: map },
        uTint: { value: new Vector3(1, 1, 1) },
        uOpacity: { value: 1 },
        uUvRect: { value: new Vector4(0, 0, 1, 1) },
        uUvScroll: { value: new Vector2(0, 0) },
      },
    });
    this._materials.add(material);
    const dispose = material.dispose.bind(material);
    material.dispose = () => {
      this._materials.delete(material);
      dispose();
    };
    return material;
  }

  /**
   * A full-frame colour inversion, done the way the hardware could have.
   *
   * `dst' = src * (1 - dst)` with `src` white is exactly `1 - dst`, so the whole
   * frame flips in the blender with no read-back, no second target and no pass:
   * one quad, one draw call, arithmetic the fixed-function pipeline had.
   *
   * There is deliberately no opacity on it. A partial inversion through this
   * blend is `k * (1 - dst)`, which darkens toward black rather than fading back
   * toward the picture, so a "half inverted" frame is simply a wrong one. It is
   * on or it is off, for a whole frame at a time — which is what the effect is
   * meant to be anyway, and why it is counted in frames rather than seconds.
   *
   * Alpha is left alone (`Zero`/`One`) so this cannot punch a hole in the target
   * the retro pass is about to sample.
   */
  createInvert() {
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: INVERT_FRAG,
      transparent: true,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneMinusDstColorFactor,
      blendDst: ZeroFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...this.shared,
        uUvRect: { value: new Vector4(0, 0, 1, 1) },
        uUvScroll: { value: new Vector2(0, 0) },
      },
    });
    this._materials.add(material);
    const dispose = material.dispose.bind(material);
    material.dispose = () => {
      this._materials.delete(material);
      dispose();
    };
    return material;
  }

  /**
   * Point a material's UV window at one frame of a horizontal sheet.
   *
   * Whole frames only. A fractional frame index would blend two poses of a
   * sprite that was drawn to step between them.
   */
  static setFrame(material, index, frames) {
    const n = Math.max(1, Math.round(frames));
    const i = ((Math.round(index) % n) + n) % n;
    material.uniforms.uUvRect.value.set(i / n, 0, 1 / n, 1);
  }

  dispose() {
    for (const m of this._materials) m.dispose();
    this._materials.clear();
  }
}

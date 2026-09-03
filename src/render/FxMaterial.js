import {
  AddEquation,
  AdditiveBlending,
  CustomBlending,
  NormalBlending,
  OneFactor,
  OneMinusDstColorFactor,
  ReverseSubtractEquation,
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

/**
 * The vertex stage is a projection and a UV window.
 *
 * A `uSnapAmount`/`uTargetRes` pair used to quantise the position onto the
 * framebuffer grid here, matching the world's stage. There is no low-resolution
 * target to have a grid, and nothing had written the uniform since PHASE 1 took
 * it away — the branch ran on every vertex and did nothing. See `HudMaterial`,
 * which carried the same dead pair.
 */
const VERT = /* glsl */ `
  uniform vec4  uUvRect;     // xy = origin, zw = size, in 0..1 of the sheet
  uniform vec2  uUvScroll;

  varying vec2 vUv;

  void main() {
    vUv = uUvRect.xy + (uv + uUvScroll) * uUvRect.zw;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

/**
 * The subtractive twin of `FRAG`.
 *
 * ── the alpha is folded into the COLOUR, and it has to be ───────────────────
 * Under `dst - src` the blend factors are both One and alpha does not reach the
 * arithmetic at all, so a transparent texel would subtract its full RGB and the
 * sprite would come out as a dark rectangle with a shape faintly inside it. So
 * the mask is multiplied in here instead: `rgb * a * opacity`, which makes a
 * fully transparent texel subtract exactly nothing, and a half-lit one subtract
 * half. Alpha is then written as 0 for tidiness — the blend ignores it.
 */
const DARKEN_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3  uTint;
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    gl_FragColor = vec4(tex.rgb * uTint * tex.a * uOpacity, 0.0);
  }
`;

export class FxMaterials {
  constructor() {
    /** Shared by every effect material. Empty since the snap pair left it. */
    this.shared = {};
    this._materials = new Set();
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
   * The same sprite pipeline, subtracting instead of adding.
   *
   * ── `dst - src` is a mode the hardware actually had ─────────────────────────
   * The console's four semi-transparency modes were `B/2 + F/2`, `B + F`,
   * `B - F` and `B + F/4`. `create` above is the second of them; this is the
   * third, and it is the ONLY period-correct way to put darkness into a frame.
   * The alternatives all fail on their own terms: an alpha-blended black quad is
   * a fade rather than a subtraction and cannot darken a colour without also
   * flattening it toward one hue, and a second pass reading the target back is
   * not something the fixed-function pipeline could do at all.
   *
   * 침묵 is the only card that needs it, and it needs it twice — the bolt that
   * reaches for the hand, and the one-or-two-frame flash when the seal lands.
   * Both are things being TAKEN from the picture, which is the card.
   *
   * Alpha is left untouched (`Zero`/`One`), for the same reason the inversion
   * leaves it alone: this must not punch a hole in the target the retro pass is
   * about to sample.
   */
  createDarken(map) {
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: DARKEN_FRAG,
      transparent: true,
      blending: CustomBlending,
      blendEquation: ReverseSubtractEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
      depthTest: false,
      depthWrite: false,
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

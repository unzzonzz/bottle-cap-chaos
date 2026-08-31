import { ShaderMaterial, Vector2, Vector3 } from 'three';

/**
 * The card material: unlit, textured, and snapped.
 *
 * ── it is not `RetroMaterial` ────────────────────────────────────────────────
 * That one does per-vertex Gouraud with a key, a fill and an ambient, which is
 * right for an object sitting in the world and wrong for a card: a card is a
 * printed thing, and shading it would make the art change colour as the fan
 * turned. So this is the same PS1 vertex stage with the lighting removed and
 * the texture passed straight through.
 *
 * The affine-UV machinery is not here either, and that is not an omission. The
 * card scene is drawn through an ORTHOGRAPHIC camera, where w is constant across
 * every triangle — affine interpolation and perspective-correct interpolation
 * are the same arithmetic. Carrying the varyings to reproduce an effect that
 * cannot occur would be decoration.
 *
 * ── the snap is deliberate and has its own dial ──────────────────────────────
 * Cards jitter. That is the look, and exempting them would leave the one part
 * of the screen that is not made of the same material as the rest. It gets a
 * separate strength from the game scene only so the two can be judged against
 * each other while tuning.
 *
 * ── the grey-out happens HERE ────────────────────────────────────────────────
 * Draining the colour out of the inactive hand is done in this fragment shader
 * rather than anywhere later, which puts it upstream of the dither and the
 * quantiser by construction. Done after them it would be desaturating colours
 * that had already been snapped to a 5-bit lattice, and the ordered pattern
 * would come apart.
 */

const VERT = /* glsl */ `
  uniform vec2  uTargetRes;
  uniform float uSnapAmount;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    // Same quantisation as the world's, same guard. Under an orthographic
    // camera w is 1, but the guard costs nothing and keeps the two stages
    // recognisably the same code.
    if (clip.w > 0.0001 && uSnapAmount > 0.0) {
      vec2 grid = uTargetRes * 0.5;
      vec3 ndc = clip.xyz / clip.w;
      ndc.xy = mix(ndc.xy, floor(ndc.xy * grid) / grid, uSnapAmount);
      clip.xyz = ndc * clip.w;
    }
    gl_Position = clip;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uDrain;      // 0 = full colour, 1 = fully grey
  uniform vec3  uTint;       // multiplied in; carries both dimming and the armed warm
  uniform float uOpacity;
  uniform float uFade;       // the whole hand at once; see the note on shared

  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);

    // Rec. 601 luma, which is the weighting the era's own converters used.
    float grey = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    vec3 c = mix(tex.rgb, vec3(grey), clamp(uDrain, 0.0, 1.0)) * uTint;

    gl_FragColor = vec4(c, tex.a * uOpacity * uFade);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

/**
 * The shadow. A dark quad behind the card, offset a few pixels.
 *
 * Not a rendered shadow, and not because one would be hard: a real one needs a
 * light, a caster, a receiver and a depth pass, to produce a hard-edged dark
 * rectangle a few pixels down and to the right of a card. That IS the rectangle.
 */
const SHADOW_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform float uFade;
  void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity * uFade); }
`;

export class CardMaterials {
  /** @param {import('three').Vector2} resolution  the low-res target's size */
  constructor({ resolution }) {
    /**
     * Shared by every card material, so one slider moves the whole hand.
     *
     * `uFade` takes the hand off screen as a whole, and it is separate from the
     * per-card `uOpacity` on purpose: that one is the hand's own business — how
     * far out of the edge it is, whether it is the live one — and something
     * outside the card system has to be able to hide all of it without
     * arguing with any of that. It is written once a frame, after the hand has
     * finished placing itself, and multiplied in last.
     *
     * What uses it: drawing a shot. Everything that is not the board gets out of
     * the way while the bow is drawn.
     */
    this.shared = {
      uTargetRes: { value: new Vector2().copy(resolution) },
      uSnapAmount: { value: 0 },
      uFade: { value: 1 },
    };
    this._materials = new Set();
  }

  setResolution(resolution) {
    this.shared.uTargetRes.value.copy(resolution);
  }

  /** @param {import('three').Texture} map */
  create(map) {
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      // The card scene is drawn after the game's depth is cleared and contains
      // nothing but cards, so paint order is the whole of the sorting. Doing it
      // by `renderOrder` rather than by depth means the fan's overlap is stated
      // once, in the layout, instead of being a consequence of z positions that
      // also have to avoid fighting.
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...this.shared,
        uMap: { value: map },
        uDrain: { value: 0 },
        uTint: { value: new Vector3(1, 1, 1) },
        uOpacity: { value: 1 },
      },
    });
    return this._track(material);
  }

  /** The offset dark quad. Shares the vertex stage so it snaps with its card. */
  createShadow() {
    return this._track(
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: SHADOW_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { ...this.shared, uOpacity: { value: 0.55 } },
      }),
    );
  }

  _track(material) {
    this._materials.add(material);
    const dispose = material.dispose.bind(material);
    material.dispose = () => {
      this._materials.delete(material);
      dispose();
    };
    return material;
  }

  dispose() {
    for (const m of this._materials) m.dispose();
    this._materials.clear();
  }
}

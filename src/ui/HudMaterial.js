import { ShaderMaterial, Vector2, Vector3 } from 'three';

/**
 * The HUD material: unlit, textured, snapped, and with its own snap dial.
 *
 * ── it is not `CardMaterial`, and the difference is one uniform ─────────────
 * Everything else about the two is the same — same PS1 vertex stage, same
 * orthographic overlay, same "paint order is the whole of the sorting". What is
 * different is that `uSnapAmount` here belongs to the HUD ALONE.
 *
 * That is not tidiness, it is the requirement. Vertex snapping quantises a
 * vertex onto the framebuffer grid, and on a shape it is the character of the
 * thing; on a row of 8-pixel digits it is the difference between a score you
 * can read and one that shimmers between two values as the camera drifts. The
 * game and the cards want it at 1. The HUD needs to be able to sit below that
 * without dragging the rest of the screen smooth with it — so it owns the
 * uniform, and the panel gets a separate slider for it.
 *
 * Sharing `CardMaterials.shared` would have been one line and would have made
 * that impossible; it would also have meant editing a card system file, which
 * is off limits.
 *
 * ── unlit, and that is the point ────────────────────────────────────────────
 * A readout is a printed thing. Shading it would make the score change
 * brightness with where the light happens to be, which for something whose only
 * job is to be legible is a defect. It still snaps to the framebuffer grid,
 * still goes through the same dither and the same five bits a channel — it is
 * unlit, not exempt.
 */

const VERT = /* glsl */ `
  uniform vec2  uTargetRes;
  uniform float uSnapAmount;

  varying vec2 vUv;

  void main() {
    vUv = uv;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

    // Same quantisation as the world's, same w guard. Under an orthographic
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
  uniform vec3      uTint;
  uniform float     uOpacity;

  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    gl_FragColor = vec4(tex.rgb * uTint, tex.a * uOpacity);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

/** Flat colour, for the debug hit-area boxes. No texture to look up. */
const SOLID_FRAG = /* glsl */ `
  uniform vec3  uTint;
  uniform float uOpacity;
  void main() { gl_FragColor = vec4(uTint, uOpacity); }
`;

export class HudMaterials {
  /** @param {import('three').Vector2} resolution  the low-res target's size */
  constructor({ resolution }) {
    /**
     * Shared by every HUD material, so one slider moves the whole readout.
     *
     * `uSnapAmount` starts at 1 — the same as everything else on screen. It is
     * a dial rather than a decision: the brief asks for it to come DOWN only if
     * the text turns out to shimmer, and starting it anywhere else would be
     * exempting the HUD from the look before finding out whether it needs to be.
     */
    this.shared = {
      uTargetRes: { value: new Vector2().copy(resolution) },
      uSnapAmount: { value: 1 },
    };
    this._materials = new Set();
  }

  setResolution(resolution) {
    this.shared.uTargetRes.value.copy(resolution);
  }

  /** @param {import('three').Texture} map */
  create(map) {
    return this._track(
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        // The HUD scene is drawn after the game's depth is cleared and holds
        // nothing but flat plates that never overlap each other, so paint order
        // by `renderOrder` is the whole of the sorting.
        depthTest: false,
        depthWrite: false,
        uniforms: {
          ...this.shared,
          uMap: { value: map },
          uTint: { value: new Vector3(1, 1, 1) },
          uOpacity: { value: 1 },
        },
      }),
    );
  }

  createSolid(opacity = 0.35) {
    return this._track(
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: SOLID_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          ...this.shared,
          uTint: { value: new Vector3(0, 1, 0.4) },
          uOpacity: { value: opacity },
        },
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

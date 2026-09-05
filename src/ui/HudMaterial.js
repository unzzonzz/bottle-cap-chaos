import { ShaderMaterial, Vector3 } from 'three';

/**
 * The HUD material: unlit, textured, and nothing else.
 *
 * ── unlit, and that is the point ────────────────────────────────────────────
 * A readout is a printed thing. Shading it would make the score change
 * brightness with where the light happens to be, which for something whose only
 * job is to be legible is a defect.
 *
 * ── the snap dial is gone, and it had already stopped doing anything ────────
 * `uSnapAmount` and `uTargetRes` were here, and the reason given was a good
 * one: vertex snapping quantises a vertex onto the framebuffer grid, which on a
 * shape is the character of the thing and on a row of 8-pixel digits is the
 * difference between a score you can read and one that shimmers between two
 * values. So the HUD owned its own dial and could sit below the rest of the
 * screen.
 *
 * There is no framebuffer grid to snap to any more — the low-resolution target,
 * the nearest-neighbour upscale and the five-bit quantiser all went in PHASE 1.
 * The uniform was left initialised to 0 with nothing writing it, so the branch
 * compiled, ran and did nothing on every vertex of every frame. A dial that
 * cannot move is not a dial.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  constructor() {
    /**
     * Kept, empty, because every material below is built with
     * `uniforms: { ...this.shared, ... }` and because the next uniform the whole
     * readout has to share will want to arrive without re-plumbing eight call
     * sites. It held the snap pair; see the header for where those went.
     */
    this.shared = {};
    this._materials = new Set();
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

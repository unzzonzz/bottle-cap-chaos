import {
  Color,
  DoubleSide,
  FrontSide,
  MeshPhysicalMaterial,
  Vector2,
} from 'three';
import { PALETTE } from './palette.js';

/**
 * Every world surface in the game, as `MeshPhysicalMaterial`.
 *
 * ── what this replaces ──────────────────────────────────────────────────────
 * `RetroMaterials`: one hand-written `ShaderMaterial` doing Gouraud lighting
 * from three direction uniforms, with a vertex snap and an affine UV warp bolted
 * on to reproduce two console artefacts. Both artefacts are banned by the
 * current direction, the snap and the warp were zeroed in PHASE 1, and what was
 * left was a lighting model that could not do the one thing this look is about:
 * a broad, wet specular with a glow around it.
 *
 * ── the API is deliberately the old one ─────────────────────────────────────
 * `new GlossMaterials({ resolution })`, `.create({ color, map, gloss, … })`,
 * `.shared`, `.setResolution()`. Some thirty call sites across `ArenaView`,
 * `PitchView`, `CurlingTableView`, `OrbView`, `Bottle`, `CapWipe`,
 * `MatchFoundLayer`, `VictoryLayer` and the mark editor pass exactly those
 * options, and rewriting all of them at the same time as changing the shading
 * model would have made a rendering bug indistinguishable from a call-site typo.
 * So the surface is kept and the inside is new.
 *
 * `snap` is accepted and ignored — it was "this surface's share of the vertex
 * wobble", and there is no wobble.
 *
 * ── `gloss` maps onto roughness, and that is the whole translation ──────────
 * The old option meant "this surface's share of the global gloss switch", 0 to
 * 1, and every call site is already tuned in it: 0 for the large flat grounds,
 * 0.35 for the cork liner, 0.6 for goal frames, 1 for a painted cap. Rather than
 * re-tune thirty numbers, `gloss` is read as a gloss-to-roughness ramp — 0 lands
 * on a genuinely matte 0.85 and 1 on 0.22. A call site that wants to be exact
 * passes `roughness` and overrides it.
 *
 * ── lighting comes from the SCENE now ───────────────────────────────────────
 * There are no light-direction uniforms here. PHASE 3 puts real lights and a
 * shadow map in the scene; until then `scene.environment` — the small procedural
 * PMREM this factory is handed — is what lights everything. That is deliberate
 * ordering: `metalness`, `clearcoat` and `transmission` are all reflections of
 * an environment, and with none they render as flat grey.
 */

/** `gloss` 0 -> matte, 1 -> wet. The two ends of the roughness ramp. */
const ROUGH_MATTE = 0.85;
const ROUGH_WET = 0.22;

/**
 * The rim term, injected into the standard shader.
 *
 * `MeshPhysicalMaterial` has no rim light and this look needs one: the caps are
 * a mid-value object against a sky of a similar value, and without a cool edge
 * they sit in the background rather than on the board. It is added AFTER
 * lighting rather than folded into it, because it is a cheat standing in for a
 * backlight that does not exist yet — PHASE 3 adds a real one, and this stays as
 * the part of the effect a directional light cannot give you at grazing angles.
 */
const RIM_PARS = /* glsl */ `
  uniform vec3 uRimColor;
  uniform float uRimStrength;
`;
const RIM_MAIN = /* glsl */ `
  {
    vec3 nrm = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);
    float fres = 1.0 - clamp(dot(nrm, viewDir), 0.0, 1.0);
    gl_FragColor.rgb += uRimColor * uRimStrength * pow(fres, 3.0);
  }
`;

/**
 * The named material specs from the brief, in one place.
 *
 * A call site says what a surface IS rather than restating four numbers, so the
 * cap on the board, the cap in the victory sequence, the cap in the wipe and the
 * cap in the mark editor cannot drift apart — which is exactly what happened to
 * their `gloss` values before this existed.
 */
const PRESETS = {
  /**
   * The crown cap. The brief's §17 override: this is the hero object and its
   * metal is the identity, so `metalness` stays high and a clearcoat goes over
   * it. What is banned is photographic environment mirroring, not gloss — the
   * environment it reflects is a three-stop gradient with a soft sun in it, so
   * there is nothing recognisable to mirror.
   */
  wetMetal: { metalness: 0.62, roughness: 0.24, clearcoat: 0.8, clearcoatRoughness: 0.1 },
  /**
   * Painted steel that is not the cap: goal frames, rails. Same family, less of
   * everything, because these are set dressing and must not out-shine a cap.
   */
  paintedMetal: { metalness: 0.35, roughness: 0.34, clearcoat: 0.4 },
  /** The board and the curling table: wood under a thin lacquer. */
  lacqueredWood: { metalness: 0, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.3 },
  /** Turf. The one surface in the game with no gloss at all. */
  matte: { metalness: 0, roughness: 0.92, clearcoat: 0 },
  /** The football, and the cap's cork liner: dry-ish plastic with a weak sheen. */
  plastic: { metalness: 0, roughness: 0.42, clearcoat: 0.3 },
};

export class GlossMaterials {
  constructor({ resolution } = {}) {
    /**
     * The global knobs, live for the debug panel.
     *
     * Plain numbers rather than `{ value }` uniform objects: nothing is shared
     * by reference any more, because a `MeshPhysicalMaterial` owns its own
     * properties. `apply()` is what pushes a change out to every live material,
     * and the panel calls it on change.
     */
    this.shared = {
      /**
       * 재질마다의 환경 반사 배수.
       *
       * PHASE 2 에서는 1.35 였다. 그때는 환경맵이 유일한 광원이라 노출 다이얼을
       * 겸했기 때문이다. PHASE 3 이 키·반구광·림을 씬에 넣었으므로 환경맵은
       * 원래 역할 — 금속과 클리어코트가 비추는 대상 — 로 돌아간다. 1.35 를
       * 그대로 두면 이제 전체가 과노출된다.
       */
      envIntensity: 1.0,
      /** The cool edge light. See `RIM_MAIN`. */
      rimStrength: 0.35,
      /** Scales each material's own clearcoat. 0 kills the wet layer entirely. */
      clearcoatAmount: 1.0,
      /** Scales the gloss ramp. 0 makes everything matte without re-tuning. */
      glossAmount: 1.0,
    };

    this.rimColor = new Color(PALETTE.light.rim);
    this._materials = new Set();
    this._environment = null;
    /** Kept only so `setResolution` has something to write. Nothing reads it. */
    this._resolution = new Vector2().copy(resolution ?? new Vector2(1, 1));
  }

  /**
   * @param {object} [opts]
   * @param {import('three').Texture|null} [opts.map]
   * @param {string|number} [opts.color]      multiplied with the map
   * @param {boolean} [opts.doubleSided]
   * @param {number}  [opts.gloss]            0 matte .. 1 wet. See the note above.
   * @param {number}  [opts.metalness]        explicit override
   * @param {number}  [opts.roughness]        explicit override, wins over `gloss`
   * @param {number}  [opts.clearcoat]
   * @param {number}  [opts.clearcoatRoughness]
   * @param {number}  [opts.transmission]
   * @param {number}  [opts.thickness]
   * @param {number}  [opts.ior]
   * @param {number}  [opts.opacity]
   * @param {boolean} [opts.rim]              opt out of the rim term
   * @param {[number, number]} [opts.uvScale]
   * @param {[number, number]} [opts.uvOffset]
   * @param {keyof typeof PRESETS} [opts.preset]  a named spec; explicit options win
   */
  create(opts = {}) {
    const spec = opts.preset ? PRESETS[opts.preset] : null;
    if (opts.preset && !spec) throw new Error(`unknown material preset: ${opts.preset}`);
    // Explicit options win over the preset, which wins over the defaults.
    const merged = { ...spec, ...opts };
    const {
      map = null,
      color = PALETTE.untinted,
      doubleSided = false,
      gloss = 1,
      metalness = 0,
      roughness,
      clearcoat = 0,
      clearcoatRoughness = 0.12,
      transmission = 0,
      thickness = 0,
      ior = 1.45,
      opacity = 1,
      alphaTest = 0,
      alphaToCoverage = false,
      /**
       * This surface's share of the global environment intensity.
       *
       * Needed because the environment is currently the ONLY light source, so
       * it doubles as the exposure dial — and a printed label is not lit the way
       * a lacquered board is. The bottle's decal is the brightest diffuse
       * surface in the game and at full intensity it went past the bloom
       * threshold and blew out to a white oval with no artwork visible at all.
       */
      envIntensity = 1,
      vertexColors = false,
      rim = true,
      uvScale = [1, 1],
      uvOffset = [0, 0],
    } = merged;

    /**
     * A per-material UV transform needs a per-material TEXTURE.
     *
     * The old shader carried `uUvScale`/`uUvOffset` uniforms, so several
     * materials could share one texture object and each pan it independently —
     * which the bottle's foam and its burst sheet both rely on. A standard
     * material reads the transform off `map.repeat`/`map.offset`, which lives on
     * the texture, so sharing one would make every user of it pan together.
     *
     * `clone()` shares the underlying image and gets its own transform, which is
     * exactly the split needed. Only done when a transform is actually asked
     * for, so the common case still shares one texture and one upload.
     */
    let texture = map;
    const wantsTransform = uvScale[0] !== 1 || uvScale[1] !== 1 || uvOffset[0] !== 0 || uvOffset[1] !== 0;
    if (map && wantsTransform) {
      texture = map.clone();
      texture.needsUpdate = true;
    }
    if (texture && wantsTransform) {
      texture.repeat.set(uvScale[0], uvScale[1]);
      texture.offset.set(uvOffset[0], uvOffset[1]);
    }

    const material = new MeshPhysicalMaterial({
      map: texture,
      color: new Color(color),
      side: doubleSided ? DoubleSide : FrontSide,
      vertexColors,
      metalness,
      roughness: roughness ?? this._roughnessFor(gloss),
      clearcoat: clearcoat * this.shared.clearcoatAmount,
      clearcoatRoughness,
      transmission,
      thickness,
      ior,
      opacity,
      alphaTest,
      alphaToCoverage,
      /**
       * `alphaTest` surfaces stay OPAQUE, and that is the point.
       *
       * A cut alpha writes depth and needs no sorting, which is what lets the
       * bottle's label sit inside a stack that already has a back glass wall, a
       * liquid and a front glass wall blending against each other. Made
       * `transparent` instead it becomes a fourth thing in that sort, and at
       * some angles it sorts behind the glass it is printed on and disappears.
       */
      transparent: alphaTest === 0 && (opacity < 1 || transmission > 0),
      /**
       * The environment, applied at CONSTRUCTION as well as by `setEnvironment`.
       *
       * `setEnvironment` walks the live registry, and the registry is empty when
       * it is called: the boot order is factory, environment, then every view
       * that creates materials. Without this line the environment reached
       * nothing that mattered and — with no lights in the scene until PHASE 3 —
       * every surface in the game rendered black.
       */
      envMap: this._environment,
      envMapIntensity: this.shared.envIntensity * envIntensity,
    });

    material.userData.gloss = gloss;
    material.userData.envIntensity = envIntensity;
    material.userData.clearcoatBase = clearcoat;
    material.userData.rim = rim;

    if (rim) this._installRim(material);

    // The registry exists so teardown can catch anything still alive, but it is
    // a strong reference: without this, a material disposed by its owner stays
    // reachable here forever and drags its texture along with it.
    this._materials.add(material);
    const dispose = material.dispose.bind(material);
    material.dispose = () => {
      this._materials.delete(material);
      dispose();
    };
    return material;
  }

  _roughnessFor(gloss) {
    const g = Math.max(0, Math.min(1, gloss * this.shared.glossAmount));
    return ROUGH_MATTE + (ROUGH_WET - ROUGH_MATTE) * g;
  }

  _installRim(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: this.rimColor };
      shader.uniforms.uRimStrength = { value: this.shared.rimStrength };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${RIM_PARS}\nvoid main() {`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${RIM_MAIN}`);
      material.userData.shader = shader;
    };
    // Changing `onBeforeCompile` after a material has been used needs a new
    // program; setting the key up front keeps three from re-compiling every
    // material that happens to share the same parameters.
    material.customProgramCacheKey = () => 'gloss-rim';
  }

  /**
   * The environment every reflective surface samples.
   *
   * @param {import('three').Texture|null} texture  a PMREM, from `buildEnvironment`
   */
  setEnvironment(texture) {
    this._environment = texture;
    for (const m of this._materials) {
      m.envMap = texture;
      m.needsUpdate = true;
    }
  }

  /** Push every shared knob onto every live material. For the debug panel. */
  apply() {
    for (const m of this._materials) {
      m.envMapIntensity = this.shared.envIntensity * (m.userData.envIntensity ?? 1);
      m.roughness = this._roughnessFor(m.userData.gloss ?? 1);
      m.clearcoat = (m.userData.clearcoatBase ?? 0) * this.shared.clearcoatAmount;
      const shader = m.userData.shader;
      if (shader?.uniforms?.uRimStrength) shader.uniforms.uRimStrength.value = this.shared.rimStrength;
    }
  }

  /**
   * No-op, kept because the viewport's resize listeners still call it.
   *
   * The old materials snapped vertices to the render target's texel grid and so
   * had to be told how big it was. Nothing here depends on resolution.
   */
  setResolution(resolution) {
    this._resolution.copy(resolution);
  }

  dispose() {
    for (const m of [...this._materials]) m.dispose();
    this._materials.clear();
  }
}

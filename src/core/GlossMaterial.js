import {
  Color,
  DoubleSide,
  FrontSide,
  MeshPhysicalMaterial,
} from 'three';
import { PALETTE } from './palette.js';
import { onQualityChange, QUALITY } from './quality.js';
import { trackTextureClone } from './textures.js';

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
 * `new GlossMaterials()`, `.create({ color, map, gloss, … })`, `.shared`. Some
 * thirty call sites across `ArenaView`, `PitchView`, `CurlingTableView`,
 * `OrbView`, `Bottle`, `IntroLayer`, `VictoryLayer` and the mark editor pass
 * exactly those options, and rewriting all of them at the same time as changing
 * the shading model would have made a rendering bug indistinguishable from a
 * call-site typo. So the surface is kept and the inside is new.
 *
 * The two members that did NOT survive are `{ resolution }` and
 * `setResolution()`. They existed to tell the old materials how big the render
 * target's texel grid was, so a vertex could be snapped onto it. There is no
 * such target, the field was written and never read, and the method said so in
 * its own doc comment — a no-op on the resize path of all three documents.
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
 * 환경맵이 **없을 때** `metalness` 에 곱하는 값. 가독성 하한이지 스타일이 아니다.
 *
 * `metalness` 는 "이 표면은 albedo 를 확산으로 내놓지 않고 환경을 비춘다" 는
 * 진술이다. 비출 것이 없으면 뚜껑은 확산 38% 짜리(1 − 0.62) 어두운 원반이 된다 —
 * 광원 세 개의 정반사만 남는다. 그건 "덜 예쁘다" 가 아니라 **1P 와 2P 를 색과
 * 명도로 구별한다** 는 조항이 깨지는 것이다. 0.25 를 곱하면 확산이 85% 로
 * 돌아오고, 남은 금속기와 직접광의 하이라이트가 곡면을 읽히게 한다. 즉 "금속
 * 없음" 이 아니라 **칠한 금속**이고, 최저 티어에서 유리가 `menuMaterials` 에서
 * 받는 대접(§가짜 유리)과 같은 종류의 대체다.
 *
 * 출시되는 표는 이 길을 쓰지 않는다 — 다섯 티어 전부 `envSize` 가 0 보다 크다.
 * 왜 "없음" 을 넣었다가 뺐는지는 `environment.buildEnvironment` 머리말에 있다.
 * 이 상수는 그 값을 다시 0 으로 적는 사람을 위한 바닥이다.
 */
const NO_ENV_METALNESS = 0.25;

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
  constructor() {
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
      /**
       * Scales each material's own clearcoat. 0 kills the wet layer entirely.
       *
       * 품질 티어가 여기에 쓴다 — 보통 이하가 0 이다. 디버그 패널도 여기에
       * 쓰므로 마지막에 쓴 쪽이 이기고, 티어를 만지면 티어가 다시 이긴다.
       * 패널은 개발 도구이니 그 순서가 맞다.
       */
      clearcoatAmount: QUALITY.clearcoat,
      /** Scales the gloss ramp. 0 makes everything matte without re-tuning. */
      glossAmount: 1.0,
    };

    this.rimColor = new Color(PALETTE.light.rim);
    this._materials = new Set();
    this._environment = null;
    this._offQuality = onQualityChange(() => this._applyQuality());
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
      /**
       * 사본을 `textures.js` 에 알린다. 품질 티어가 캔버스를 다시 그리기 때문이다.
       *
       * 원본과 캔버스를 공유하므로 다시 그릴 일은 없지만, three 는 텍스처 객체마다
       * 업로드 버전을 따로 세므로 사본에도 `needsUpdate` 가 필요하다. 알리지
       * 않으면 티어를 바꿨을 때 잔디와 보드 — UV 변환을 쓰는 바로 그것들 — 만
       * 옛 해상도에 남는다. 월드 텍스처가 아닌 사본(UI 쪽)은 레지스트리에 없으므로
       * 여기 등록해도 다시 그려지지 않고, 쓸데없는 `needsUpdate` 한 번이 전부다.
       */
      trackTextureClone(map, texture);
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
      metalness: this._metalnessFor(metalness),
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
    material.userData.metalnessBase = metalness;
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

  /** 비출 것이 있는가에 따라 갈린다. `NO_ENV_METALNESS` 를 보라. */
  _metalnessFor(metalness) {
    return this._environment ? metalness : metalness * NO_ENV_METALNESS;
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
      // 환경이 붙거나 떨어지면 금속기의 의미가 달라진다. `apply` 가 그 계산을
      // 들고 있으므로 여기서는 부르기만 한다.
      m.metalness = this._metalnessFor(m.userData.metalnessBase ?? m.metalness);
      m.needsUpdate = true;
    }
  }

  /** Push every shared knob onto every live material. For the debug panel. */
  apply() {
    for (const m of this._materials) {
      m.envMapIntensity = this.shared.envIntensity * (m.userData.envIntensity ?? 1);
      m.roughness = this._roughnessFor(m.userData.gloss ?? 1);
      m.metalness = this._metalnessFor(m.userData.metalnessBase ?? m.metalness);
      m.clearcoat = (m.userData.clearcoatBase ?? 0) * this.shared.clearcoatAmount;
      const shader = m.userData.shader;
      if (shader?.uniforms?.uRimStrength) shader.uniforms.uRimStrength.value = this.shared.rimStrength;
    }
  }

  /**
   * 티어 변경. 클리어코트 한 줄이지만, 그 한 줄이 서른 개 재질에 걸린다.
   *
   * `apply()` 가 이미 "공유 노브를 살아 있는 모든 재질에 밀어 넣는" 함수이므로
   * 새 경로를 만들지 않고 그것을 쓴다 — 디버그 패널이 값을 바꿨을 때와 정확히
   * 같은 일이 일어나야 하고, 두 경로가 다르면 그 차이는 패널에서만 재현된다.
   */
  _applyQuality() {
    this.shared.clearcoatAmount = QUALITY.clearcoat;
    this.apply();
  }

  dispose() {
    this._offQuality?.();
    for (const m of [...this._materials]) m.dispose();
    this._materials.clear();
  }
}

import { AdditiveBlending, BackSide, Color, DoubleSide, FrontSide, MeshPhysicalMaterial, NormalBlending, ShaderMaterial, Vector2, Vector3 } from 'three';
import { PALETTE } from '../core/palette.js';
import { QUALITY } from '../core/quality.js';
import { MM } from '../cap/capGeometry.js';

/**
 * Two materials the menu needs and `RetroMaterial` deliberately does not have.
 *
 * ── why not just extend RetroMaterial ───────────────────────────────────────
 * Its fragment stage ends `gl_FragColor = vec4(c, 1.0)`. That is not an
 * oversight — it is a statement that everything in the world is opaque, and the
 * whole game so far is. Glass is not, and `CardMaterial` already set the
 * precedent for how this codebase handles that: repeat the PS1 VERTEX stage
 * verbatim, change only the part that has to change, and say why in the file.
 * The alternative — an opacity uniform on the shared material — would put a
 * blend mode and a sorting problem on every cap in every match to serve one
 * bottle on one screen.
 *
 * The vertex stage below is the same snap, the same affine UV setup and the
 * same per-vertex lighting as `RetroMaterial`, and it takes that file's SHARED
 * uniform objects by reference. One vertex-snap slider still moves the whole
 * scene, glass included.
 *
 * ── the glass, and what is not in it ────────────────────────────────────────
 * Forbidden by the brief and absent here: refraction, physically-based
 * transmission, a smooth gradient, a real specular pass. What is here instead:
 *
 *   ALPHA BLENDING with a fixed base opacity.
 *   A BAKED TINT in the vertex colour — dark at the heel, clearing up the neck.
 *   A RIM term, per vertex, from 1 - |n . v|. It both darkens and thickens the
 *     glass toward the silhouette, which is the one optical fact about a
 *     cylinder of glass that reads at 320x240: you are looking through more of
 *     it at the edges. Per VERTEX, not per fragment — it interpolates across
 *     the triangle exactly as Gouraud does, and on a 30-column lathe you can
 *     see the facets in it, which is correct.
 *   A HIGHLIGHT MAP, added rather than multiplied, because a reflection is
 *     light coming off the surface and not light coming through the tint. Same
 *     argument `RetroMaterial` makes about its gloss term, and the reason the
 *     highlight can be white on brown glass instead of coming out brown.
 *
 * ── two draws, not one ──────────────────────────────────────────────────────
 * `createGlassMaterial` is called twice per bottle, once with BackSide and once
 * with FrontSide, and the drink is drawn between them. Alpha blending has no
 * opinion about depth, so a single double-sided pass composites the far wall
 * over the near one wherever the index buffer happens to reach it first — which
 * on a lathe walked bottom-to-top is most of the object. Splitting the pass is
 * the cheap, era-appropriate fix: back, contents, front, in that order, every
 * frame, with no sorting.
 */

const VERT = /* glsl */ `
  uniform vec3  uLightDir;
  uniform vec3  uLightColor;
  uniform vec3  uFillDir;
  uniform vec3  uFillColor;
  uniform vec3  uAmbientColor;
  uniform float uRimPower;
  uniform float uRimDark;
  uniform float uRimAlpha;
  uniform float uBaseAlpha;

  varying vec2  vUv;
  varying vec2  vUvW;
  varying float vW;
  varying vec3  vTint;
  varying float vAlpha;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mvPosition;

    gl_Position = clip;

    vUv  = uv;
    vUvW = uv * clip.w;
    vW   = clip.w;

    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 viewDir = normalize(cameraPosition - worldPos);

    // 1 at the silhouette, 0 face on. abs() so the inside of the far wall —
    // drawn by the BackSide pass, where the normal points away — gets the same
    // edge as the near one instead of a flat wash.
    float rim = pow(1.0 - abs(dot(n, viewDir)), uRimPower);

    vec3 lit = uAmbientColor
      + uLightColor * max(dot(n, uLightDir), 0.0)
      + uFillColor  * max(dot(n, uFillDir), 0.0);

    vTint  = color * lit * (1.0 - uRimDark * rim);
    vAlpha = clamp(uBaseAlpha + uRimAlpha * rim, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3      uColor;
  uniform sampler2D uMap;
  uniform float     uAffineAmount;
  uniform float     uHighlight;

  varying vec2  vUv;
  varying vec2  vUvW;
  varying float vW;
  varying vec3  vTint;
  varying float vAlpha;

  void main() {
    vec2 uvA = mix(vUv, vUvW / vW, uAffineAmount);
    vec3 c = uColor * vTint;

    // The highlight map is white strips on black. Added, and it raises the
    // alpha with it — a reflection you can see through is not a reflection.
    vec3 hl = texture2D(uMap, uvA).rgb * uHighlight;
    c += hl;

    float a = clamp(vAlpha + max(max(hl.r, hl.g), hl.b), 0.0, 1.0);
    gl_FragColor = vec4(c, a);
  }
`;

/**
 * ── the UV transform is done by hand, and it has to be ─────────────────────
 * three applies `texture.offset` and `texture.repeat` through a `uvTransform`
 * uniform that only its OWN shader chunks declare. A ShaderMaterial that writes
 * `texture2D(uMap, vUv)` ignores both, silently: the burst sprite's two-frame
 * sheet was being sampled whole into one quad and the frame counter did
 * nothing. So the scale and offset are uniforms here and are applied where they
 * can be seen.
 */
const SPRITE_VERT = /* glsl */ `
  uniform vec2  uUvScale;
  uniform vec2  uUvOffset;

  varying vec2 vUv;

  void main() {
    vUv = uv * uUvScale + uUvOffset;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip;
  }
`;

const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3      uTint;
  uniform float     uOpacity;

  varying vec2 vUv;

  void main() {
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(t.rgb * uTint, t.a * uOpacity);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

/**
 * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
 *   its `shared` uniforms are taken BY REFERENCE, so the panel's global
 *   vertex-snap and light-angle controls reach the glass too
 * @param {object} opts
 * @param {import('three').Texture} opts.map  the baked highlight strips
 * @param {'front'|'back'} opts.face
 */
/**
 * The menu shaders' own lighting, no longer borrowed from the material factory.
 *
 * These two shaders — the bottle's glass and the flat sprite — do their own
 * vertex lighting, and they used to take the direction and colour uniforms BY
 * REFERENCE out of `RetroMaterials.shared`, so one debug slider moved the bottle
 * and the board together. `GlossMaterials` has no such uniforms: it is a
 * `MeshPhysicalMaterial` factory and its lighting comes from the scene.
 *
 * So the glass carries its own copy, read from the palette at construction. It
 * is a stopgap with a known end date — the bottle redesign replaces this shader
 * with a real `transmission` material, at which point the whole set goes.
 */
function menuLightUniforms() {
  return {
    uLightDir: { value: new Vector3(-0.71, 0.44, 0.55).normalize() },
    uLightColor: { value: new Color(PALETTE.light.sun).multiplyScalar(1.15) },
    uFillDir: { value: new Vector3(0.5, -0.68, 0.54).normalize() },
    uFillColor: { value: new Color(PALETTE.light.fill).multiplyScalar(0.42) },
    uAmbientColor: { value: new Color(PALETTE.light.ambientSky).multiplyScalar(0.28) },
  };
}

/**
 * 유리가 유리로 보이게 하는 값들. 티어가 갈리는 유일한 자리.
 *
 * ── 호출부는 티어를 모른다 ─────────────────────────────────────────────────
 * `Bottle` 은 `createGlassMaterial(retro, { map, face })` 이라고만 말한다 — 그게
 * 의도 플래그다. "유리를 하나 줘" 이고 "투과율 0.92 짜리 물리 재질을 줘" 가
 * 아니다. 어느 구현이 나오는지는 이 함수 안에서만 갈리고, 그래서 티어 변경이
 * 호출부를 한 줄도 건드리지 않는다.
 *
 * ── 최저·낮음: `transmission: 0` 으로 끝내면 안 된다 ────────────────────────
 * 투과를 끄기만 하면 병은 불투명한 청록 덩어리가 된다. 그건 성능 설정이 아니라
 * 정체성 변경이다 — 이 화면은 병과 물과 거품이 전부이고, 병이 유리가 아니면
 * 화면이 무엇에 관한 것인지 말하지 않는다.
 *
 * 그래서 **가짜 유리**를 짓는다. 세 가지가 그 일을 나눠 한다:
 *
 *   `opacity` 0.55   뒤가 비친다. 유리라고 말하는 것의 절반은 이것이다.
 *   정점 틴트 램프    `vertexColors` 로 그대로 남는다. 액면 링과 두께감.
 *   하이라이트 스트립  `emissiveMap` 의 세로 띠. 투과 유리에서는 프레넬 테와
 *                    클리어코트가 곡면을 읽히게 하는데 둘 다 없어지므로, 이
 *                    띠가 그 몫을 혼자 진다. 그래서 강도를 0.12 에서 올린다 —
 *                    0.4 는 이 파일이 옛 셰이더 시절에 쓰던 0.55 를 반투명
 *                    셸에 맞춰 다시 잡은 값이고, 위 문단이 그 0.55 가 왜
 *                    그만큼이었는지 적어 두었다.
 *
 * `thickness` 와 `attenuationDistance` 는 굴절 경로 길이에 대한 진술이라 투과가
 * 없으면 아무 일도 하지 않는다. 남겨 둬도 무해하지만, 남기면 다음 사람이 저
 * 값들이 뭔가 하고 있다고 읽는다.
 */
export function applyGlassQuality(material, retro) {
  const real = QUALITY.glass;
  material.transmission = real ? 0.92 : 0;
  material.opacity = real ? 1 : 0.3;
  material.thickness = real ? 3 * MM : 0;
  material.emissiveIntensity = real ? 0.12 : 0.4;
  material.clearcoat = 0.6 * QUALITY.clearcoat;
  // 투과 재질은 three 가 알아서 `transparent` 로 다루지만, 가짜 유리는 알파
  // 블렌딩이 유일한 투명 수단이므로 명시해야 한다. 둘 다 참인 것이 맞다.
  material.transparent = true;
  material.envMap = retro?._environment ?? null;
  material.needsUpdate = true;
  return material;
}

export function createGlassMaterial(retro, { map, face = 'front', color = PALETTE.glass.tint } = {}) {
  /**
   * Real transmissive glass, not a hand-shaded translucent shell.
   *
   * ── what it replaced, and why that had to go ────────────────────────────
   * A `ShaderMaterial` doing its own vertex lighting with a rim term and an
   * added highlight strip, drawn at `uBaseAlpha` 0.42/0.6. Its own comments
   * record why it was that opaque: at 0.42 over a BLACK background every bit of
   * shading arrived at 42% contrast and was then flattened by a 5-bit
   * quantiser, so the flutes and the waist disappeared. Both of those premises
   * are gone — there is no quantiser, the background is a bright sky, and the
   * bottle has neither flutes nor a waist any more.
   *
   * What is left is a smooth cylinder of clear glass, which is exactly the case
   * `transmission` exists for: the refraction and the thickness do the work
   * that the rim term was faking.
   *
   * ── the highlight strips stay, and are now load-bearing ─────────────────
   * The ten vertical flutes used to break the reflection into ten separate
   * bands, and that is most of what made the silhouette read. A smooth cylinder
   * has one broad highlight and goes visually flat — the appendix calls this
   * out and asks for compensation. The strips are it: the same baked texture,
   * moved onto `emissiveMap`, which adds light exactly where the map is bright
   * and nothing where it is black. That is what it was doing additively before.
   */
  const glass = new MeshPhysicalMaterial({
    color: new Color(color),
    // Near-colourless and very smooth: cider glass, not a beer bottle.
    transmission: 0.92,
    roughness: 0.04,
    metalness: 0,
    ior: 1.45,
    // In world units. The bottle is built in millimetres scaled by `MM`, so this
    // is about 3 mm of wall — enough for the tint to say "glass" without the
    // whole bottle going green.
    thickness: 3 * MM,
    clearcoat: 0.6,
    clearcoatRoughness: 0.08,
    attenuationColor: new Color(PALETTE.glass.tint),
    attenuationDistance: 90 * MM,
    emissive: new Color(PALETTE.glass.specular),
    emissiveMap: map ?? null,
    // The strips are a glint, not a paint. The old shader wanted 0.55 of an
    // ADDED highlight over a half-opaque shell; against transmissive glass that
    // already carries a Fresnel edge and a clearcoat, a tenth of that is the
    // same amount of light on screen. At 0.38 the bottle read as frosted.
    emissiveIntensity: 0.12,
    vertexColors: true,
    side: face === 'back' ? BackSide : FrontSide,
    /**
     * Depth still not written, and the render order still lives in `Bottle`.
     *
     * A transmissive material is `transparent` as far as three is concerned, so
     * it sorts with the liquid, the fizz and the foam. The far wall must not
     * stamp depth over the drink drawn after it, and the near wall must not
     * stamp depth over the label — which is opaque and writes its own.
     */
    depthWrite: false,
    depthTest: true,
    transparent: true,
  });
  /**
   * 환경 반사를 전역값보다 높게 준다.
   *
   * 투과 재질이 화면에 내놓는 것의 대부분은 굴절된 환경이다. PHASE 3 이 실제
   * 광원을 넣으면서 환경 돔의 확산 성분을 0.34 로 크게 낮췄는데 — 안 그러면
   * 보드가 하얗게 탄다 — 그 값이 유리에도 그대로 걸리자 병이 회청색으로
   * 무거워졌다. 불투명한 표면에 맞춘 노출을 유리에 쓰면 안 된다는 뜻이고,
   * 그래서 여기만 되돌린다.
   */
  glass.envMapIntensity = (retro?.shared?.envIntensity ?? 1) * 2.2;
  return applyGlassQuality(glass, retro);
}

/**
 * Unlit, textured, snapped. The shadow ellipse, the light pool on the floor and
 * the two-frame burst at the mouth are all this.
 *
 * @param {'alpha'|'add'} [opts.blend]
 * @param {boolean} [opts.depthTest]
 *   off for anything that must be drawn OVER solid geometry rather than in
 *   amongst it. Every sprite here already has `depthWrite: false`, so it never
 *   stamps depth; this is about whether depth already in the buffer is allowed
 *   to reject it. A modal veil says no — see `ConfirmDialog`.
 */
export function createSpriteMaterial(
  retro,
  {
    map,
    blend = 'alpha',
    tint = PALETTE.untinted,
    opacity = 1,
    uvScale = [1, 1],
    uvOffset = [0, 0],
    side = DoubleSide,
    depthTest = true,
  } = {},
) {
  return new ShaderMaterial({
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest,
    side,
    blending: blend === 'add' ? AdditiveBlending : NormalBlending,
    uniforms: {
      uMap: { value: map },
      uTint: { value: new Color(tint) },
      uOpacity: { value: opacity },
      uUvScale: { value: new Vector2().fromArray(uvScale) },
      uUvOffset: { value: new Vector2().fromArray(uvOffset) },
    },
  });
}

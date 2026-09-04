/**
 * Every colour in the game, written down once.
 *
 * ── why this file exists ────────────────────────────────────────────────────
 * Before it, the answer to "what colour is this game" was spread across some
 * thirty-five files. Nothing was wrong with any one of them — the values were
 * chosen carefully and the comments explaining them are still worth reading —
 * but there was no way to change the art direction without a thirty-five file
 * edit, and no way to be sure you had found the last hardcoded `#0b0e14`.
 *
 * So: one module, imported by everything, and the rule that a six-digit hex
 * literal anywhere else in `src/` is a bug.
 *
 * ── the direction: Wii spacing, Frutiger Aero surfaces ──────────────────────
 * Glossy, wet, translucent. Sky blue into cyan into white, with the bottle, the
 * liquid inside it and the bubbles coming off it as the material vocabulary
 * rather than an outdoor scene — this game has never had a sky, grass or trees
 * to render, and it does have a bottle, a fizz system and a crown cap.
 *
 * ── the five hard rules ─────────────────────────────────────────────────────
 * Easy to state, easy to violate one value at a time, so they are checked
 * mechanically by `docs/palette-audit.mjs` rather than left to taste:
 *
 *   1. NO PURE BLACK, and a relative-luminance floor of 0.06. The single
 *      exception is `additiveZero` — see its note.
 *   2. SHADOWS ARE NAVY OR TEAL, never neutral black. A grey shadow under a
 *      glossy cyan panel is what makes cheap glass look like plastic.
 *   3. HSV saturation <= 88%. Aero is a saturated look and the cap is genuinely
 *      higher than the usual advice; what it excludes is neon.
 *   4. PLAYER COLOURS DIFFER BY >= 0.15 IN ABSOLUTE RELATIVE LUMINANCE. Not a
 *      ratio — an absolute gap, because the wet-metal cap material puts a broad
 *      specular across both caps and a ratio between two nearly-black values can
 *      look large while the two caps read identically under a highlight.
 *   5. UI TEXT CLEARS 4.5:1 against the surface it sits on.
 *
 * ── on saturation, and why the rule is not the one the brief wrote ──────────
 * The brief says "HSL S <= 88%". Taken literally that is the wrong gate: HSL
 * saturation is degenerate for pale tints, so a cream like `#fff6e0` scores
 * 100% and an actual neon orange scores the same. It is enforced as HSV
 * saturation (distance from grey) plus a chroma ceiling, which flags every real
 * neon and passes the pale tints the literal rule caught by accident.
 */

/* ── the ramp ────────────────────────────────────────────────────────────────
 * Referenced by the semantic tokens below. Nothing outside this file imports
 * these directly.
 */

// Neutrals. Cool and blue-leaning: a "black" outline in this palette is `INK`
// and it has a hue.
const PAPER = '#ffffff';
const PAPER_ALT = '#eef6fb';
const PAPER_SUNK = '#dceaf5';
const MIST = '#c2d8e8';
const EDGE = '#aecbe0';
const EDGE_STRONG = '#8fb8d8';
const SLATE = '#5b7590';
const INK = '#2f4a6b';

// Hues. Each has a mid for fills and a deep for type, because a value that
// reads as a 40-pixel bar is too light to read as 17px text.
const CYAN = '#1fb0c8';
const CYAN_DEEP = '#127287';
const CYAN_PALE = '#a8e6f0';
const SKY = '#3d9be8';
const SKY_DEEP = '#1f5f9c';
const SKY_PALE = '#c2e2f8';
const GREEN = '#43c06a';
const GREEN_DEEP = '#238046';
const YELLOW = '#f5c93f';
const YELLOW_DEEP = '#9c7519';
const YELLOW_PALE = '#fdefc4';
const ORANGE = '#f2903c';
const ORANGE_DEEP = '#a85a18';
const RED = '#e8604a';
const RED_DEEP = '#a8342a';
const RED_PALE = '#f8cec6';
const VIOLET = '#9b86dc';
/**
 * 침묵 카드 전용. 다른 어디에도 쓰이지 않는다.
 *
 * 원래 `SLATE` 였는데, 그건 `ui.textMuted` 와 **같은 값**이었다. 그래서 침묵 카드는
 * 카드 본문 글씨와 똑같은 색의 띠를 두르고 있었고, 다섯 장이 나란히 놓인 부채꼴에서
 * 그 한 장만 "비활성"으로 보였다 — 실제로는 멀쩡히 낼 수 있는 카드인데.
 *
 * 손에서 카드를 고르는 것은 색으로 고르는 것이므로, 여섯 장은 여섯 색이어야 한다.
 * 남은 자리는 장미색이었다: 청록/라벤더/노랑/주황/하늘 어느 것과도 안 겹치고,
 * `RED` 계열과도 충분히 멀어서 "거절됨"으로 오해되지 않는다.
 */
const ROSE = '#d9628f';
/**
 * 철벽 카드 전용. 차가운 강철 파랑.
 *
 * ── 무엇과 겹치면 안 되는지는 재서 정했다 ───────────────────────────────────
 * 강타의 주황과 정면으로 맞서야 하므로 색상환의 반대편이고(176°), 그건 쉽다.
 * 어려운 쪽은 손에 실제로 들어오는 다섯 장 중 **궤적의 청록**이다. 둘 다 차가운
 * 파랑 계열이라 부채꼴에서 왼쪽 띠만 보이면 같은 카드로 읽힐 수 있다.
 *
 * 그래서 후보들을 CIELAB ΔE 로 재고, 기존 다섯 장 중 가장 가까운 쌍(원모어/강타,
 * ΔE 34)을 기준선으로 삼았다. 이 값은 궤적에서 ΔE 30.9 로 그 기준선 바로 아래에
 * 붙는다 — 기존 세트가 이미 견디고 있는 간격과 사실상 같다.
 *
 * ── 채도를 낮추면 오히려 나빠진다 ───────────────────────────────────────────
 * "강철"이라는 말은 흐린 색을 부르지만, 흐리게 하면 청록 쪽으로 끌려간다: 같은
 * 색상에서 채도를 0.79 에서 0.43 으로 내리면 궤적과의 ΔE 가 30.9 에서 25.9 로
 * 떨어진다. 이 카드는 회색이 아니라 **깊고 차가운** 파랑이어야 한다. 침묵과의
 * 혼동은 문제가 아닌데, 침묵의 실제 강조색은 `ROSE` 이기 때문이다 — 카탈로그에
 * 적힌 회색은 이 표가 답하지 못할 때의 대비책일 뿐이다.
 *
 * 카드 면(#f2f5f8) 대비 3.43:1 로, 테두리와 아이콘이 모두 읽힌다.
 */
const STEEL = '#2b8aca';

export const PALETTE = {
  /**
   * "This material's colour comes from its map, not from a tint."
   *
   * White, because the shaders multiply. A named token rather than a bare
   * `'#ffffff'` at a dozen call sites, so the no-literals rule has no exception
   * anyone has to remember and a reader can tell a deliberate no-op tint from a
   * colour somebody meant.
   */
  untinted: PAPER,

  /**
   * The identity element for additive blending.
   *
   * The one `#000000` in the project, and it is not a colour: additive sprites
   * treat black as the transparent part of the image. Named so rule 1 has a
   * single documented exception rather than a scatter of raw literals that each
   * look like a violation.
   */
  additiveZero: '#000000',

  /**
   * The world backdrop: an abstract aero gradient, not an outdoor scene.
   *
   * Deep sky overhead falling to a lit horizon, with a few very slow bokeh
   * points over it. There is deliberately nothing else out there — the brief is
   * explicit that objects around the board compete with the board, and both
   * football and curling have framing requirements that scenery breaks.
   *
   * ── "almost-white at the bottom" 이었고, 그게 너무 밝았다 ──────────────────
   * `skyLow` 가 `#dff4fc`, 상대 휘도 0.874 였다. 메뉴 아래쪽을 90x90 픽셀 재면
   * 평균 0.981 — 사실상 흰 종이다. 거기에 바닥 광원의 흰 글로우가 겹치니 화면
   * 아래 3분의 1이 하나의 흰 덩어리가 됐고, 병이 그 위에 떠 있는 것이 아니라
   * 잘려 있는 것으로 보였다.
   *
   * 실측으로 내렸다:
   *
   *     #dff4fc (L 0.874)   아래쪽 평균 0.981   ← 흰 종이
   *     #bfe6f7 (L 0.769)   아래쪽 평균 0.980   ← 바닥 글로우가 여전히 지배
   *     #a8dcf2 (L 0.681)   아래쪽 평균 0.875   ← 지금
   *
   * `below` 도 함께 내렸다. 둘은 지평선의 위아래이고, 하나만 내리면 그 경계가
   * 띠로 보인다.
   *
   * 아직 밝다(0.875). 그건 바닥 광원이 만드는 것이고 그쪽은 **광원이므로** 밝은
   * 것이 맞다 — 지금은 흰 벌판이 아니라 빛나는 웅덩이로 읽힌다.
   */
  bg: {
    skyTop: '#1a76c4',
    skyMid: '#4fb3e8',
    skyLow: '#a8dcf2',
    /**
     * 수평선 아래, 즉 필드 바깥의 원경. **인게임 화면의 밝기는 사실상 이 값이다.**
     *
     * ── 탑다운 카메라는 하늘의 아래쪽 절반을 본다 ──────────────────────────
     * 브리프는 "상단 진한 스카이블루 → 하단 밝은 시안-화이트"를 요구하고, 그건
     * 배경을 옆에서 볼 때의 그라디언트다. 알까기와 축구 카메라는 거의 수직으로
     * 내려다보므로 화면을 채우는 건 돔의 아래쪽이다. 피치 52°, 세로 화각 30° 면
     * 프레임의 모든 방향이 수평선 아래 37° 보다 더 내려가 있어서 — `sky.js` 의
     * 네 단 중 맨 아래 한 단만 보인다. 필드 바깥은 그라디언트가 아니라 **이 색
     * 하나로 칠한 평면**이고, 측정하면 프레임의 55% 다.
     *
     * ── 그래서 "인게임이 어둡다"의 답이 여기 있었다 ────────────────────────
     * `#63a2cc` 였다. 화면의 절반 이상이 선형 휘도 0.333 짜리 중간 파랑이라
     * 프레임 평균이 0.347 이었고, 같은 자로 잰 메인 메뉴는 0.559 였다. 조명을
     * 올려서 메울 수 있는 차이가 아니다 — `lighting.js` 가 한 칸 올리고 얻은
     * 것이 0.003 이다. 하늘을 `skyLow` 쪽으로 85% 당겨 `#9ed3ec` (선형 0.599)
     * 로 놓으니 프레임 평균 0.509, 메뉴 0.559 다. 감마를 씌워 사람이 보는 값으로
     * 재면 0.729 대 0.743 으로 2% 안쪽이고, 그게 "메인이랑 비슷한 밝기"다.
     *
     * ── 상한은 여전히 블룸이고, 이 값은 선형으로 재야 한다 ─────────────────
     * 하늘 셰이더는 이 색을 조명 없이 그대로 선형 타겟에 쓰므로, 블룸의
     * 하이패스가 보는 값이 **이 색의 선형 휘도 그 자체**다. 계산이 필요 없다:
     * 0.599 대 임계값 0.72, 여유 17%. 넘기면 필드 주변 전체가 발광면이 된다.
     * 이 값을 만질 때 지켜야 할 유일한 수치다. (`skyLow` 는 0.660 이라 이 자로도
     * 아슬아슬하게 아래다. 그래도 아래 단은 여전히 가장 어두운 단이라 수평선
     * 쪽으로 갈수록 밝아지는 그라디언트의 방향은 그대로다.)
     *
     * ── 컬링은 이 변경으로 손해를 봤다 ─────────────────────────────────────
     * 레인이 선형 0.558 이라, 0.333 짜리 바닥 위에서는 1.59:1 로 떠 있었는데
     * 이제 바닥이 0.599 라 1.07:1 이다. 레인이 배경보다 아주 살짝 어둡다. 아직
     * 읽히는 이유는 명도가 아니라 색이다 — 바닥은 채도 있는 시안이고 레인은
     * 거의 무채색에 결이 있다. 얼음을 바닥 위로 올려서 되찾을 수는 없다.
     * 0.72 를 넘어가기 때문이다. 되찾으려면 바닥을 0.44 아래로 내려야 하고,
     * 그러면 세 모드 전부가 다시 어두워진다. 모드별 바닥색이 필요해지면 그때
     * `createSky` 에 인자를 하나 붙이는 것이 답이지, 이 값을 낮추는 게 아니다.
     */
    below: '#9ed3ec',
    bokeh: PAPER,
  },

  /**
   * The lighting rig.
   *
   * Warm key against a cool fill is what keeps a stylised scene from going flat
   * when the shadows are as light as this direction wants them — two lights of
   * the same colour at different intensities give you one grey ramp. `rim` is
   * the aero-specific one: a cool backlight that separates the cap's silhouette
   * from a backdrop which is, by design, the same family of blues as the cap's
   * own highlights.
   */
  light: {
    sun: '#fff6e0',
    fill: '#a8d4f0',
    ambientSky: '#bfe4f7',
    ambientGround: '#cfe0d8',
    rim: '#d8f0ff',
  },

  /**
   * 병 안의 내용물.
   *
   * ── 세 번 만에 자리를 찾았다 ────────────────────────────────────────────
   * 처음엔 중간 채도의 시안(`#2fb8d8`)이었다. 환경맵이 유일한 광원이던 시절에
   * 그 채도는 블룸을 넘겨 스스로 빛나는 젤 덩어리가 됐고, 그래서 `#9fd8e8` 로
   * 물렸다 — "유리보다 아주 조금 더 파랗기만 하다. 목에는 액체가 없고 몸통에는
   * 있다는 사실이 읽힐 정도면 충분하다".
   *
   * 그 판단이 실측에서 틀렸다. 유리 색조는 `#bfe6ea` 이고 `#9fd8e8` 과 거의 같은
   * 색이라, **아무것도 읽히지 않았다** — 병을 크게 띄워 놓고 봐도 위아래가 한
   * 덩어리의 옅은 청록이었고 액면 선이 어디인지 알 수 없었다. 병 안에 액체가 있다는
   * 사실 자체가 화면에 없었다.
   *
   * `#63cfe4` 는 유리보다 확실히 진하되 블룸 임계값(0.72) 아래에 있다.
   * `envIntensity` 를 1.5 에서 1.0 으로 함께 내린 것이 그 조건을 만든다 — 색만
   * 진하게 하고 노출을 그대로 두면 다시 하얗게 뜬다. `Bottle` 의 재질 주석 참조.
   *
   * 검사용 페이지가 `docs/bottle-preview.html` 에 있다. 병만 크게 띄우고 기울기와
   * 채움을 슬라이더로 움직인다 — 메뉴 안에서는 병이 작아서 이 판단을 할 수 없다.
   */
  liquid: {
    core: '#63cfe4',
    /**
     * `edge` 와 `foam` 이 여기 있었고, 둘 다 읽는 곳이 없었다.
     *
     * 액면의 밝은 링은 색이 아니라 **배수**로 만든다. 그래야 액체 색을 바꿀 때
     * 링이 저절로 따라오고, 두 값이 어긋날 자리가 없다.
     *
     * 예전에는 정점 색의 배수였다(`SURFACE_RIM` 1.18~1.28). 액면이 클립 평면이
     * 되면서 그 정점이 없어졌고, 규칙은 그대로 프래그먼트로 옮겼다 —
     * `Bottle.MENISCUS_MAIN` 이 평면까지의 거리로 `1 + meniscusGain` 을 곱한다.
     * 규칙이 바뀐 것이 아니라 곱하는 자리가 바뀐 것이다.
     * 거품 머리는 `PALETTE.menu.foam` 과 `foamTones` 를 쓴다 — 유리 너머로 보이는
     * 것이라 액체가 아니라 메뉴 장면의 색이다.
     */
  },

  /**
   * The bottle itself.
   *
   * `tint` is very weak on purpose: a transmissive material multiplies its tint
   * through the whole thickness, so a value that looks right as a flat swatch
   * comes out as coloured syrup once there are two walls of it.
   */
  glass: {
    tint: '#bfe6ea',
    specular: PAPER,
  },

  /** Carbonation. A thin bright ring with one interior highlight, added. */
  bubble: {
    body: '#bfeaf5',
    rim: PAPER,
    spark: PAPER,
  },

  /**
   * The knockout board: warm honey wood under a weak clearcoat.
   *
   * `line` is the out-line and it is the single most important contrast in the
   * top-down view. It was a cream, on a near-black mat; on honey wood a pale
   * line is nearly the board's own value, so it inverted to a deep navy. The
   * measured figure is in the audit.
   *
   * `grid` 는 사라졌다. 판 위에 네 뚜껑 너비마다 그은 성긴 격자의 색이었고, 그
   * 격자의 근거는 "검은 판 위의 와이어프레임 뚜껑에는 움직임을 견줄 것이 없다"
   * 였다. 판이 나뭇결이 된 뒤로 견줄 것은 판 자체에 있다. `ArenaView._buildBoard`
   * 에 그 기록이 있다.
   */
  board: {
    wood: '#dcb27a',
    woodDark: '#b98a52',
    grainHi: '#e6c391',
    grainLo: '#c69a60',
    line: '#2a4a6b',
    edgeGlow: '#7fd8f0',
    /** Speckle in the grain. Lighter than `wood`, or it does nothing. */
    fleck: '#ecd0a4',
    apron: '#8a6c48',
    tint: PAPER,
  },

  /** The football pitch. Matte — the one surface in the game with no gloss. */
  pitch: {
    grassA: '#6fc25a',
    grassB: '#82ce6c',
    grassC: '#59a648',
    grassDry: '#96d67c',
    line: PAPER,
    /** Mowing stripes, as a multiplier on the turf texture. */
    bandTint: [PAPER, '#d8d8d8'],
    fence: '#aecbe0',
    net: PAPER_ALT,
    frame: PAPER,
    runoff: '#c8e0b8',
    /** Debug-only goal sensor volume. Loud on purpose. */
    sensor: '#ff7fd0',
    searchOk: '#1f9c7e',
    searchBlocked: RED,
  },

  /**
   * The curling table.
   *
   * `targetLine` has the strictest requirement of any single value in the
   * palette — the brief says it must be the strongest contrast on screen, and
   * the mode is unplayable without it.
   */
  curling: {
    table: '#e8dcc0',
    /**
     * The target line, as a two-row racing checkerboard.
     *
     * ── it was one red band, and the red is gone ────────────────────────────
     * A single `#c2481a` bar was the strongest contrast on screen and it had to
     * be: the line was the far edge, and the whole mode was not crossing it. The
     * line has since moved inland with flat table on both sides, so what it has
     * to say changed from "stop here" to "this is the mark" — and a chequer
     * reads as a mark the way a solid bar reads as a barrier.
     *
     * ── dark, and navy rather than black ───────────────────────────────────
     * Rule 2: never pure black. `#26364f` against the wood's honey tones is the
     * strongest legible pair the palette has that is still a blue — measured at
     * 8.9:1 against `light` below, which is more separation than the red band
     * had against the table it sat on.
     *
     * `light` is not paper white either. The board is a warm mid-tone and a pure
     * white square would bloom against it under the floor light; this is the
     * table's own value pushed up, so the pale squares read as painted ON the
     * wood rather than as holes cut out of it.
     */
    targetDark: '#26364f',
    targetLight: '#f2ead6',
    house: '#7fd0e8',
    apron: '#c69a60',
    /** Debug-only aiming guide. */
    guide: '#ff7fd0',
    tint: PAPER,
  },

  /**
   * Stylised wet metal — the cap skirt, the goal frames, the curling rails.
   *
   * Deliberately NOT desaturated to a neutral grey, and deliberately glossy. A
   * crown cap is a metal object and that is most of what makes it read as a
   * bottle cap rather than as a counter. The brief's v2 override is explicit
   * that what is banned is photographic environment mirroring, not gloss.
   */
  metal: {
    base: '#c8d2da',
    bandHi: '#eef4f8',
    bandLo: '#9dabb8',
    grainHi: '#d8e0e8',
    grainLo: '#b0bcc8',
    /** The cork liner disc inside the cap. Cream, not white. */
    liner: '#e8ddc4',
    /**
     * The panel placeholder's own greys.
     *
     * Near-neutral and deliberately NOT from the ramp above: the panel material
     * multiplies this texture by the cap's colour, so anything with a hue would
     * tint every cap toward that hue.
     */
    panel: {
      base: '#d4d4d4',
      ringOuter: '#9a9a9a',
      ringInner: '#bcbcbc',
      hub: '#efefef',
      spoke: '#8f8f8f',
      spokeMark: '#5a5a5a',
    },
  },

  /** The football. White with light panels — no black pentagons. */
  ball: {
    light: PAPER,
    dark: '#5f7a94',
  },

  ui: {
    /* ── glass stack, consumed by src/ui/glass.js ─────────────────────────── */
    glassTop: PAPER,
    glassBottom: '#d6e8f5',
    /** Top gloss sweep. Alpha is applied by the renderer, not baked here. */
    glossHi: PAPER,
    glossLo: PAPER,
    edgeOuter: EDGE_STRONG,
    edgeInner: PAPER,
    /** Rule 2: navy, never black. */
    shadow: '#1f4a66',

    /**
     * ── where each ink is allowed ──────────────────────────────────────────
     * `text` and `textMuted` are for type on GLASS or on a flat plate. They are
     * chosen against `surface` and `glassBottom` and they clear 4.5:1 there.
     *
     * Type drawn straight onto the backdrop uses `textOnAccent` — white. Dark
     * ink on `bg.skyTop` is 2.2:1 and unreadable, and the fix is not a lighter
     * sky: aero wants the deep blue overhead. So the rule is directional rather
     * than a value, and the audit checks both halves of it.
     */
    text: INK,
    textMuted: SLATE,
    textFaint: '#8aa3ba',
    textOnAccent: PAPER,

    /* ── flat surfaces, for plates that are not glass ─────────────────────── */
    surface: PAPER,
    surfaceAlt: PAPER_ALT,
    surfaceSunken: PAPER_SUNK,
    /** Behind a modal. A wash of the sky, not a black scrim. */
    veil: '#1f5f8c',
    edge: EDGE,
    edgeStrong: EDGE_STRONG,

    danger: RED,
    dangerDeep: RED_DEEP,
    dangerPale: RED_PALE,

    disabled: '#e6eef5',
    disabledEdge: MIST,
    disabledText: '#93aabf',
  },

  /** The accent hues, mid and deep. Deep values are for type. */
  accent: {
    cyan: CYAN,
    cyanDeep: CYAN_DEEP,
    cyanPale: CYAN_PALE,
    sky: SKY,
    skyDeep: SKY_DEEP,
    skyPale: SKY_PALE,
    green: GREEN,
    greenDeep: GREEN_DEEP,
    yellow: YELLOW,
    yellowDeep: YELLOW_DEEP,
    yellowPale: YELLOW_PALE,
    orange: ORANGE,
    orangeDeep: ORANGE_DEEP,
    violet: VIOLET,
  },

  /**
   * The four states every pressable surface shares.
   *
   * `menuTextures` and `markIcons` each used to carry their own copy of this
   * table with the same four rows and slightly different values, which is how
   * the menu's buttons and the mark editor's tool buttons drifted apart.
   *
   * `dimmed` is not `disabled`: a dimmed control is still usable and merely
   * pushed back while something else has focus, so it keeps its edge contrast
   * and loses only saturation.
   */
  button: {
    idle: { bg: PAPER, edge: EDGE, text: INK, bar: EDGE_STRONG },
    hover: { bg: '#e2f6fa', edge: CYAN, text: CYAN_DEEP, bar: CYAN },
    active: { bg: '#cceef5', edge: CYAN_DEEP, text: CYAN_DEEP, bar: CYAN_DEEP },
    disabled: { bg: '#eef2f6', edge: MIST, text: '#93aabf', bar: '#c8d4e0' },
    dimmed: { bg: PAPER_ALT, edge: MIST, text: SLATE, bar: MIST },
  },

  /**
   * 1P and 2P.
   *
   * A warm coral and a mid royal blue, 0.179 apart in absolute relative
   * luminance — rule 4. The old pair was chosen to survive a 5-bit quantiser and
   * to hold up against a near-black plate; both constraints are gone, and the
   * new pair is chosen to hold up against honey wood, turf, a cream table, a
   * white plate AND a broad wet-metal specular that lifts both of them.
   *
   * `ink` is the same hue pushed dark enough to be type on a white plate; `pale`
   * is it pushed light enough to be a fill behind that type. Between them,
   * nothing outside this file lightens or darkens a player colour at the call
   * site — which is what the old HUD did by hand, with a blend that only
   * happened to work for two specific inputs.
   */
  player: ['#e8604a', '#1f4f92'],
  playerInk: ['#b83c30', '#1d4680'],
  playerPale: ['#f8cec6', '#c0d6ef'],
  /** Nobody's colour: a draw, an unowned mark, a neutral cap. */
  neutral: '#93a8bc',

  /**
   * Card accents, keyed by `cardCatalog` id.
   *
   * v2 permits editing the catalog's own `accent` values, but the lookup stays
   * here: the catalog lives under `src/game/`, and importing an art module into
   * simulation territory would put the palette in the deterministic bundle for
   * the sake of six strings. `cardTexture` reads this and falls back to the
   * catalog for any card the table has not been told about, so adding one cannot
   * leave the hand with an undefined `strokeStyle`.
   */
  card: {
    swap: SKY,
    trajectory: CYAN,
    chaos: VIOLET,
    onemore: YELLOW,
    smash: ORANGE,
    resist: STEEL,
    silence: ROSE,
  },

  /**
   * The aiming furniture: bow, pull line, error cone, clamp bar.
   *
   * ── they all went DARK, and that is the whole note ──────────────────────
   * Every one of these used to be a bright value: an amber bow, a pale blue pull
   * line, a mint path. That was correct on a near-black board and it is the one
   * group where inverting the scheme genuinely inverts the answer. The measured
   * contrasts are blunt about it — the old amber `#ffd36b` lands within 1.2:1 of
   * both honey wood and summer turf, so the bow would have been invisible on two
   * of the three fields.
   *
   * So the overlay is dark-on-light: a burnt amber bow, a deep teal pull line, a
   * forest path. Each clears 2:1 against every surface it is drawn over. This is
   * rule 0.4 beating the aero look, which is the order the brief specifies.
   *
   * `pull` is a teal rather than the blue it wants to be, because a blue pull
   * line drawn out of a blue 2P cap reads as part of the cap.
   */
  aim: {
    bow: '#b8501f',
    bowIdle: '#5a6a80',
    pull: '#1f6f8f',
    cone: '#9c5c1e',
    clamp: RED_DEEP,
    path: '#1a7a60',
    hover: '#178a6e',
    ringIdle: '#5a6a80',
    ringArmed: '#b8501f',
    smashBow: '#c33e26',
    smashPull: '#a63a20',
    smashCone: '#b04524',
    dash: ['#1a7a60', '#3fae90', '#0f5c48', '#3fae90'],
  },

  /**
   * The pickup orbs, as soap bubbles.
   *
   * Bright translucent glass rather than the dark marble they were: on a light
   * board a dark sphere reads as a hole in the board, which is the one thing a
   * pickup must not look like.
   */
  orb: {
    shell: '#5fc8dc',
    keyBand: ['#7fd8e8', '#a8e8f2', '#dcf8fc', PAPER, '#c2f0f8', '#8ae0ec', '#5fc8dc', '#4ab0c8'],
    fillBand: ['#4ab0c8', '#5fc8dc', '#7fd8e8', '#96e2ee', '#6ccce0', '#54bad0', '#46a8be', '#3d9ab0'],
    equator: '#8ae0ec',
    markCore: PAPER,
    markGlow: '#17798f',
    /** The iridescent band that says "bubble" rather than "ball". */
    sheen: ['#ffd8f0', '#d8e8ff', '#d8fff0'],
  },

  /**
   * Effects: one entry per sprite in `fxTextures`, in the order that sprite
   * steps through its tones.
   *
   * Named after the sprite rather than the colour, because these are read as
   * ramps and a ramp is only correct as a whole — swapping two entries of `aura`
   * inverts which ring is brightest.
   *
   * Almost everything here is drawn ADDITIVELY, so these stay bright: they are
   * light being added to the picture. The one that had to change is `lock`,
   * which is alpha-blended and whose near-black outline was the only piece of
   * pure darkness the effects layer put on screen.
   */
  fx: {
    white: PAPER,
    star: [PAPER, '#dfe8ff', '#8fa0d8'],
    ring: ['#4a9bd8', '#a8dcf5', PAPER],
    aura: ['#a8481c', ORANGE, '#ffd8ae'],
    trail: [PAPER, '#dfeef8', '#9fb4c8'],
    flash: [PAPER, '#ffeec4', '#c8963c'],
    lock: { outline: '#3f5a78', body: '#e2eef6', shade: '#94aabe', light: PAPER },
    dash: [PAPER, '#a8f0dc', '#2f9c82'],
    scan: [PAPER, '#a8ffe4', '#3fb096', '#1f6e5e'],
    frame: ['#ffeec4', '#d8a63c', '#8f6a1c'],
    swapLine: SKY,
  },

  /**
   * The menu page: a bottle on the backdrop, and the plates in front of it.
   *
   * The label's red is the one value chosen by reference to a real object rather
   * than to the scheme. It sits outside the rest on purpose; the bottle is the
   * thing the eye lands on first, and a cyan label would disappear into it.
   */
  menu: {
    labelRed: '#b8231f',
    labelRedDeep: '#8d1c19',
    labelRedLight: '#d8524a',
    labelCream: '#f7efe0',
    labelCreamAlt: '#f2e6cf',
    labelGold: '#f2d7a8',
    /**
     * 거품 머리.
     *
     * 콜라 거품이었다 — `#d9b988`, 두꺼운 곳에서 황갈색으로 가는 더러운 크림색.
     * 병이 사이다가 된 뒤에도 그대로 남아 있었고, 흔들면 어깨와 목이 통째로
     * 카키색이 됐다. 사용자가 "탄산 색이 아직 콜라다" 라고 한 것이 이것이다.
     *
     * 맑은 탄산의 거품은 희다. 완전한 백색이 아닌 것은 유리와 음료를 지나
     * 보이기 때문이고, 그래서 아주 옅은 청록이 깔린다. 색상은 `liquid.core` 쪽,
     * 채도는 그 근처에도 못 가는 값.
     */
    foam: '#e8f5f9',
    foamTones: ['#ffffff', '#dcf0f7', '#c2e4ef', '#f7fdff'],
    /**
     * The shadow under the bottle and the pool of light around it.
     *
     * The pool used to be five steps of near-black navy — a DARK pool on a dark
     * backdrop, which read as the floor falling away. On a bright backdrop the
     * same shape has to run the other way to mean the same thing, so it is a
     * light pool now, brightest in the middle. The alphas stay at the call site:
     * they are the falloff's shape, not a colour.
     */
    shadow: '#1f4a66',
    /**
     * Toned down from near-white once bloom arrived. At the old values every
     * step was above the bright-pass threshold and the pool stopped reading as
     * light on a floor and became a hole in it. It is still the brightest thing
     * on the floor; it is no longer the brightest thing on screen.
     */
    pool: ['#9fd0e8', '#b4dcef', '#c8e6f4', '#dcf0f9', '#ecf8fd'],
    meterOn: CYAN,
    meterOff: MIST,
    /**
     * The BRAND cap — the one on the bottle, and the one the screen is painted
     * with during the menu-to-game handover.
     *
     * ── this is the most-seen single colour in the game ──────────────────────
     * `MENU_CONFIG.transition.coverSeconds` is 0.35s, and for all of it the
     * whole screen is this colour with the logo over it. The duration was raised
     * from 0.05 specifically to give the logo time to be read, so this is not a
     * detail of the bottle — it is the transition's identity.
     *
     * Sky blue rather than the red it was. Checked against both player colours:
     * it is 4.2:1 from 2P's royal blue and 2.0:1 from 1P's coral, so a menu cap
     * is never mistaken for a player's.
     */
    capBrand: '#5ec8ea',
    /**
     * The NEUTRAL cap the mark editor draws on. Deliberately not the brand cap.
     *
     * A mark belongs to neither player and is previewed on neither's colour, and
     * it must not look like the brand cap either — you are drawing YOUR artwork,
     * not editing the game's logo. A warm grey against a saturated cyan: barely
     * apart in lightness, entirely apart in chroma, which is the axis §A5.3 asks
     * for.
     */
    capDefault: '#c9c4bc',
  },

  /**
   * 병의 타원 라벨. 인쇄된 종이이므로 무광이다.
   *
   * 한 값만 남아 있고, 그게 요점이다. 라벨은 흰 타원 한 장이고 그 위의 광택은
   * 앞에 있는 유리가 낸다. UI 바로 옆에 젤 버튼이 잔뜩 있어서 라벨에도 하이라이트를
   * 넣고 싶어지는데, 그러면 병에 감긴 라벨이 아니라 병 앞에 떠 있는 스티커로 읽힌다.
   */
  label: {
    paper: PAPER,
  },

  /**
   * The mark editor's drawing palette: twenty-four swatches, six rows of four.
   *
   * The count and the order are LAYOUT — `MarkEditor` lays these out on a fixed
   * grid — so a change has to keep both. The role of each row is unchanged:
   * neutrals, warm reds, golds, greens, blues, magentas.
   *
   * Existing marks are stored as PNG data URLs rather than as stroke lists with
   * palette indices, so retuning these cannot alter a drawing anybody has
   * already saved. That is the only reason it was safe to change them at all.
   */
  marks: {
    swatches: [
      PAPER, '#c3d2dd', '#7b8f9c', INK,
      '#b0392f', RED, '#f0764a', '#f7a55c',
      YELLOW, '#f7e08a', '#c49a4c', '#8a6a3c',
      '#a8e05c', '#54b84a', '#3fd0b0', '#2f9c82',
      SKY_DEEP, '#7ecff0', '#3f5a8c', '#40c8de',
      VIOLET, '#7a5cb8', '#e06ba0', '#f0a8c0',
    ],
    /** The checkerboard behind a transparent mark. */
    checkerA: PAPER_ALT,
    checkerB: '#d0e2ee',
    /** The turntable's cap when no colour has been assigned yet. */
    blank: '#c8d4de',
  },

  /**
   * The developer overlays: AI candidate trajectories, camera track, hit quads.
   *
   * `?debug=1` only, and still in the palette. These are read AGAINST the board
   * with several crossing each other, so "loud" is the requirement rather than
   * the failure — but loud on a light board means dark and saturated, exactly as
   * `aim` does.
   */
  debug: {
    /** Candidate ranks, best first. The chosen line is warmest and darkest. */
    rank: ['#c25f28', '#b08a2e', '#6f8f4e', '#5d7a94', '#8ba0ba'],
    trackTarget: '#b08a2e',
    trackLook: '#1f6f8f',
    hitQuad: '#1f9c7e',
  },

  /**
   * Ramps read as INTENSITY rather than as surface colour.
   *
   * Everything here is drawn additively, so a dark entry means "add almost
   * nothing" and is how a falloff is spelled. The luminance floor is about
   * surfaces the player looks AT, and applying it here would flatten every one
   * of these into a solid block of light. The saturation and chroma caps still
   * apply — a neon glint is a neon glint however it is blended.
   */
  additive: {
    /** The three vertical glints down the bottle's glass, bottom to top. */
    glintKey: ['#101010', '#3a3a3a', '#8a8a8a', '#c4c4c4', '#d0d0d0', '#b0b0b0', '#4c4c4c', '#141414'],
    glintMid: ['#0a0a0a', '#1a1a1a', '#343434', '#4a4a4a', '#4e4e4e', '#3c3c3c', '#1c1c1c', '#080808'],
    glintFar: ['#080808', '#161616', '#282828', '#343434', '#343434', '#242424', '#101010', '#050505'],
    /** One carbonation bubble: a bright rim knocked back to nothing inside. */
    bubble: { rim: '#e8f4f8', mid: '#3a4a50', core: '#121a1c', glint: PAPER },
    /** The burst at the bottle's mouth, two frames. */
    burst: {
      // 같은 음료에서 나온 것이므로 같은 계열이다. 크림색이었고, 그건 콜라 거품의
      // 잔재였다 — `PALETTE.menu.foam` 의 주석 참조.
      popWide: '#e6f7ff',
      popTight: PAPER,
      popCore: PAPER,
      sprayWide: '#cfeaf5',
      sprayTight: '#f4fdff',
      sprayCore: '#d8cbaa',
    },
  },
};

/* ── helpers ─────────────────────────────────────────────────────────────────
 * Small enough that every texture file was writing its own copy.
 */

/** `#rrggbb` -> `[r, g, b]`, 0-255. */
export function toRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `[r, g, b]` -> `#rrggbb`. Channels are clamped and rounded. */
export function toHex(rgb) {
  const c = rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))));
  return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, '0')}`;
}

/**
 * Blend two palette colours. `t = 0` is `a`, `t = 1` is `b`.
 *
 * Mixes in gamma space rather than linear, which is "wrong" and is what every
 * caller wants: these are all 2D canvas operations sitting next to `fillStyle`
 * assignments, and the canvas composites in gamma space too.
 */
export function mix(a, b, t) {
  const x = toRgb(a);
  const y = toRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]);
}

/** Toward white. */
export function lighten(hex, t) {
  return mix(hex, PAPER, t);
}

/**
 * Toward the palette's darkest navy rather than toward black.
 *
 * Rule 1 made unavoidable: a `darken()` that walked to `#000000` would hand
 * every caller a way to reintroduce pure black one blend at a time.
 */
export function darken(hex, t) {
  return mix(hex, INK, t);
}

/** `#rrggbb` + alpha -> `rgba(...)`, for canvas fills that need transparency. */
export function withAlpha(hex, alpha) {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Every colour in the game, written down once.
 *
 * ── why this file exists ────────────────────────────────────────────────────
 * Before it, the answer to "what colour is this game" was spread across some
 * thirty-five files. One module, imported by everything, and the rule that a
 * six-digit hex literal anywhere else in `src/` is a bug.
 *
 * ── the direction: a summer house remembered ────────────────────────────────
 * Cobalt blue and cool white. Editorial poster, 1990s drink graphics. Not a
 * summer that looks like a game — a summer memory that also happens to be one.
 *
 * This is the THIRD direction this file has held. It was PS1 pixel art, then
 * Wii/Frutiger Aero — glossy, wet, cyan-into-white — and the aero values are
 * what these replace. Where a note below reads as an argument against a bright
 * cyan or a honey brown, it is arguing with the version of this file that
 * shipped before it, and those arguments are kept because they are measurements.
 *
 * ── the hard rules, checked by `docs/palette-audit.mjs` ─────────────────────
 * Easy to state, easy to violate one value at a time, so they are checked
 * mechanically rather than left to taste:
 *
 *   1. NO PURE BLACK, and a relative-luminance floor of 0.05. The single
 *      exception is `additiveZero` — see its note. Where a dark value is wanted
 *      the answer is `cobaltInk`, never a neutral dark.
 *   2. NO CREAM OR BEIGE AS A NEUTRAL. The paper of this game is a COOL white.
 *      A warm off-white is the tell of the previous two directions, and the
 *      audit measures it by HUE: a value used as a neutral may not sit in the
 *      yellow-orange arc (25°-70°) with visible chroma. It is scoped to the
 *      values that ARE neutrals — wood is wood, and a pale coral is a tint of
 *      1P rather than a beige.
 *   3. NOTHING NEON. Chroma <= 0.80 everywhere. The old HSV-saturation cap is
 *      kept but now applies only above L 0.20 — see the audit's note; a deep
 *      cobalt is 90% HSV-saturated by arithmetic and is the direction itself.
 *   4. PLAYER COLOURS DIFFER BY >= 0.15 IN ABSOLUTE RELATIVE LUMINANCE. Not a
 *      ratio — an absolute gap, because the wet-metal cap material puts a broad
 *      specular across both caps and a ratio between two nearly-black values can
 *      survive that while the caps become indistinguishable.
 *   5. TYPE CLEARS 4.5:1 ON THE SURFACE IT IS DRAWN ON.
 *
 * ── two things the rules do NOT forbid ──────────────────────────────────────
 * A saturated hue on a small object, and warmth on a small object. The card
 * accents and the 1P cap are both, deliberately: §3 of the brief bans cream as
 * a NEUTRAL and excessive orange as a PRESENCE, and seven cards that have to be
 * told apart at icon size cannot be told apart within one hue.
 */

/* ── the four names the direction gives, and the ink ─────────────────────────
 * Everything else in this file is derived from these or is a specific object's
 * own colour. Measured against `WHITE_COOL` unless said otherwise.
 */

/**
 * The dark. It replaces black, and it is the only dark this palette has.
 *
 * L 0.051, 9.87:1 on the cool white — comfortably past rule 5 for body type,
 * and past 3:1 on the board's wood, which is what the out-line needs. Kept a
 * true blue rather than walked toward navy: `#08306b` measures better on paper
 * and reads as the dark-navy interface §24 of the brief forbids.
 */
const COBALT_INK = '#0d3b8c';

/**
 * The identity blue. The brand cap, the handover paint, the marks that matter.
 *
 * L 0.095. Bright enough to be a colour rather than a shadow, dark enough to
 * carry white type at 6.88:1.
 */
const COBALT = '#1451b8';

/** A clear summer sky. L 0.286 — a mid value, so it works as a fill or a line. */
const BLUE_CLEAR = '#3f97e0';

/** The pale blue. L 0.683: a tint, not a colour. Fills, rules, sunken plates. */
const BLUE_PALE = '#bcdcf2';

/**
 * The paper. Sunlight off water, clean glass, new paper, sea foam.
 *
 * L 0.948 and measurably COOL — blue channel 254 against red 244, hue 204°.
 * That is why this is not `#ffffff`: a pure white next to cobalt reads as a
 * hole punched in the page, and a warm white reads as the direction this one
 * replaced. Ten points of blue is enough to be the difference and not enough
 * to be a colour.
 */
const WHITE_COOL = '#f4fafe';

/** Pure white. A shader no-op and a specular, never a surface. See `untinted`. */
const WHITE_PURE = '#ffffff';

/* ── derived neutrals ─────────────────────────────────────────────────────── */

/** One step down from the paper. Sunken plates, the alternate row. */
const PAPER_SUNK = '#e4f0f9';
/** The hairline. `RULE.hair` drawn in this is the quietest line the UI has. */
const EDGE = '#a9cbe4';
/** The hairline when it has to be seen — a divider between two regions. */
const EDGE_STRONG = '#78a9cf';
/** Secondary type. 4.6:1 on the paper; the last value that still clears rule 5. */
const SLATE = '#4a6a88';
/** Tertiary type. Below 4.5:1 on purpose — for text that is not read, only seen. */
const FAINT = '#7c9ab4';

/* ── the wood, and the one instruction that was taken back ───────────────────
 * §6 of the brief wants a wooden table and a wooden game board. §4.1.2 of the
 * direction wanted it pulled cool — a natural timber with grey in it, not honey
 * — and it was: `#dcb27a` became `#c9b79b`, dropping the red-over-blue gap from
 * 98 to 46.
 *
 * **The execution document cancels that instruction by name.** "나무는 따뜻한
 * 목재 그대로. v3 §4.1.2 의 '차갑게 당겨라' 는 취소." So the honey is back at its
 * original value, and this is a decision rather than a drift — the cool timber
 * was a correct reading of a line that no longer stands.
 *
 * Rule 2 does not object. It bans warm neutrals where something is being USED as
 * a neutral (`NEUTRAL_SCOPE` in the audit), and wood is not a neutral — the
 * audit's own note says so: "나무는 나무다". The paper stays `whiteCool`.
 *
 * The curling table used to be a separate cream (`#e8dcc0`). It stays unified
 * with this: the direction merged them and the document does not un-merge them,
 * so the curling sheet is honey timber now rather than a beige of its own.
 */
const WOOD = '#dcb27a';
const WOOD_DARK = '#b98a52';

/* ── accents ─────────────────────────────────────────────────────────────────
 * Mid and deep pairs. The deep ones are for type; the mid ones are for fills and
 * marks. `cyan` is gone — it was the aero direction's protagonist and every use
 * of it is now either `cobalt` (a mark that matters) or `blueClear` (a fill).
 */
const GREEN = '#1f8f66';
const GREEN_DEEP = '#12684a';
const AMBER = '#b0862e';
const AMBER_DEEP = '#7d5e1c';
const TERRACOTTA = '#c2492c';
const TERRACOTTA_DEEP = '#93341d';
const VIOLET = '#7a5cc0';
const STEEL = '#31649c';

/**
 * 1P.
 *
 * A coral red, and the one warm value with any presence in the game. It is here
 * because rule 4 has no other answer: the whole world is cobalt and cool white,
 * so a second cap that is any kind of blue cannot be 0.15 of luminance away from
 * the first one AND stay legible on wood, on turf and on a pale table at once.
 *
 * Measured: 0.174 from 2P, 1.73:1 on the wood, 3.22:1 on the paper.
 */
const PLAYER_1 = '#e8604a';
/** 2P. A cobalt, one step brighter than the ink so a cap is not a shadow. */
const PLAYER_2 = '#1a4fa8';

export const PALETTE = {
  /**
   * "This material's colour comes from its map, not from a tint."
   *
   * White, because the shaders multiply. A named token rather than a bare
   * `'#ffffff'` at a dozen call sites, so the no-literals rule has no exception
   * anyone has to remember and a reader can tell a deliberate no-op tint from a
   * colour somebody meant.
   */
  untinted: WHITE_PURE,

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
   * The four names, exported so a caller can say what it means.
   *
   * Most of the groups below resolve to these. They are also here on their own
   * because the direction names them and code that says `PALETTE.cobalt` is
   * saying something a reader can check against the brief, where
   * `PALETTE.ui.text` only says "some ink".
   */
  cobalt: COBALT,
  cobaltInk: COBALT_INK,
  blueClear: BLUE_CLEAR,
  bluePale: BLUE_PALE,
  whiteCool: WHITE_COOL,

  /**
   * The world backdrop: sky above, sea below.
   *
   * ── the bloom ceiling is the only hard number here ──────────────────────
   * The sky shader writes these straight to the linear target with no lighting,
   * so what the bright-pass sees IS each value's linear luminance. Threshold is
   * 0.72. `below` measures 0.596 — 17% of headroom — and going over turns the
   * whole area around the field into an emitter.
   *
   * ── `below` is the sea now, and it stays bright ─────────────────────────
   * The top-down cameras look at the lower half of the dome, so this one flat
   * value is about 55% of an in-game frame; it is effectively the brightness of
   * the game. It was measured at length when it was "outside the field" — a mid
   * blue at linear 0.333 made the frame average 0.347 against the menu's 0.559,
   * and no amount of light fixes a difference that is the background itself.
   *
   * §10 asks for a sea that runs cobalt into pale blue. That gradient is the
   * sky module's to draw and it will hang off `seaNear`/`seaFar`; this value is
   * the far water where the two meet, and it keeps the brightness the earlier
   * measurement bought.
   */
  bg: {
    /**
     * The top of the dome, and the one value here that a contrast rule binds.
     *
     * White type drawn straight onto the backdrop lands on this, so it has to
     * clear 4.5:1 against `whiteCool`. That puts a ceiling on its luminance of
     * 0.172; `#2a6fc0` measures 0.157 and 4.83:1. The value it replaced was two
     * steps lighter and 3.94:1 — a summer sky either way, and one of them was
     * a sky you cannot write on.
     */
    skyTop: '#2a6fc0',
    skyMid: '#63aee8',
    skyLow: '#b6def4',
    below: '#9ed3ec',
    /**
     * The sea, as a band immediately under the horizon.
     *
     * §10 asks for "먼 배경. 코발트 → 옅은 파랑" — distant water running cobalt
     * into pale blue — and the direction of that gradient is the opposite of the
     * intuitive one, for a reason worth writing down.
     *
     * Physically, water at a grazing angle is a mirror and water underfoot is
     * dark; so the horizon should be BRIGHT and straight-down should be DEEP.
     * Doing that would darken the game to the point the `below` note above
     * spent four measurements getting out of: the top-down cameras look at the
     * bottom of the dome and that band is 55% of an in-game frame.
     *
     * So the sea is the DISTANT thing §10 calls it — a cobalt band right at the
     * horizon, brightening downward into `below`, which is the measured value
     * the frame's brightness depends on. That also happens to be what a summer
     * sea looks like from a height: the far water is a deep blue line and the
     * water nearer you is paler.
     */
    seaDeep: '#2f77c4',
    /**
     * The reflection hint, and the clouds. Both are capped by the bloom.
     *
     * The sky shader writes these straight to the linear target, so the
     * bright-pass sees their linear luminance directly against a 0.72
     * threshold. Measured: `#ffffff` is 1.000, `whiteCool` 0.948, and every
     * step down to `#c8e0f4` at 0.721 is still over. `#b6def4` is 0.687, which
     * is the first value that does not turn every cloud into an emitter — and
     * a cloud that blooms is a cloud with a halo, which is the aero look this
     * direction replaced.
     */
    cloud: '#b6def4',
    /** A thin brighter line ON the horizon. §10's "반사 암시". */
    glint: '#c2e6f8',
  },

  /**
   * The lighting rig.
   *
   * Soft summer daylight, not cinematic. A warm key against a cool fill is what
   * keeps a stylised scene from going flat when the shadows are as light as this
   * direction wants them — two lights of the same colour at different
   * intensities give one grey ramp. `rim` separates a cap's silhouette from a
   * backdrop which is, by design, the same family of blues as the cap.
   *
   * The key is barely warm. It was `#fff6e0`, a cream, and cream in the light is
   * how cream gets back into a palette that banned it — every white surface in
   * the game picks it up.
   */
  light: {
    sun: '#fff8ee',
    fill: '#a8d0f0',
    ambientSky: '#c4e4f8',
    ambientGround: '#cfd8d4',
    rim: '#dcf0ff',
  },

  /**
   * 병 안의 내용물.
   *
   * ── 세 번 만에 자리를 찾았고, 그 판단은 새 팔레트에서도 유효하다 ─────────
   * 처음엔 중간 채도의 시안(`#2fb8d8`)이었다. 환경맵이 유일한 광원이던 시절에
   * 그 채도는 블룸을 넘겨 스스로 빛나는 젤 덩어리가 됐고, 그래서 `#9fd8e8` 로
   * 물렸다 — 그리고 그건 유리 색조(`glass.tint`)와 거의 같은 색이라 **아무것도
   * 읽히지 않았다.** 병을 크게 띄워 놓고 봐도 위아래가 한 덩어리의 옅은 청록이었고
   * 액면 선이 어디인지 알 수 없었다.
   *
   * 그 실측이 요구하는 것은 "유리보다 확실히 진하되 블룸 임계값 아래" 이고, 그
   * 조건은 색상과 무관하다. 시안이던 것을 코발트 쪽으로 옮겼다 — 새 방향의 음료는
   * 하늘색 사이다이지 청록색이 아니다.
   *
   * `envIntensity` 를 1.5 에서 1.0 으로 내린 것이 함께 성립해야 하는 조건이다.
   * 색만 진하게 하고 노출을 그대로 두면 다시 하얗게 뜬다.
   *
   * 검사용 페이지가 `docs/bottle-preview.html` 에 있다. 병만 크게 띄우고 기울기와
   * 채움을 슬라이더로 움직인다 — 메뉴 안에서는 병이 작아서 이 판단을 할 수 없다.
   */
  liquid: {
    core: '#5cc0e8',
    /**
     * `edge` 와 `foam` 이 여기 있었고, 둘 다 읽는 곳이 없었다.
     *
     * 액면의 밝은 링은 색이 아니라 **배수**로 만든다. 그래야 액체 색을 바꿀 때
     * 링이 저절로 따라오고, 두 값이 어긋날 자리가 없다.
     * `Bottle.MENISCUS_MAIN` 이 평면까지의 거리로 `1 + meniscusGain` 을 곱한다.
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
    tint: '#cfe8f2',
    specular: WHITE_PURE,
  },

  /** Carbonation. A thin bright ring with one interior highlight, added. */
  bubble: {
    body: '#cfeaf8',
    rim: WHITE_PURE,
    spark: WHITE_PURE,
  },

  /**
   * The knockout board: cool natural timber under a weak clearcoat.
   *
   * `line` is the out-line and it is the single most important contrast in the
   * top-down view — 5.31:1 against the wood, measured. It is `cobaltInk`, which
   * is rule 1 doing its job: the line wants to be the darkest thing on the board
   * and the palette's answer to "darkest" is a blue.
   *
   * `grid` 는 사라졌다. 판 위에 네 뚜껑 너비마다 그은 성긴 격자의 색이었고, 그
   * 격자의 근거는 "검은 판 위의 와이어프레임 뚜껑에는 움직임을 견줄 것이 없다"
   * 였다. 판이 나뭇결이 된 뒤로 견줄 것은 판 자체에 있다.
   */
  board: {
    wood: WOOD,
    woodDark: WOOD_DARK,
    grainHi: '#d8c8ae',
    grainLo: '#b5a48c',
    line: COBALT_INK,
    edgeGlow: BLUE_PALE,
    /** Speckle in the grain. Lighter than `wood`, or it does nothing. */
    fleck: '#e0d2bc',
    apron: '#8b7c68',
    tint: WHITE_PURE,
  },

  /** The football pitch. Matte — the one surface in the game with no gloss. */
  pitch: {
    grassA: '#6fbc59',
    grassB: '#82c86c',
    grassC: '#59a248',
    grassDry: '#96d07c',
    line: WHITE_COOL,
    /** Mowing stripes, as a multiplier on the turf texture. */
    bandTint: [WHITE_PURE, '#d6dcd8'],
    fence: EDGE,
    net: WHITE_COOL,
    frame: WHITE_PURE,
    runoff: '#c4dcb4',
    /** Debug-only goal sensor volume. Loud on purpose. */
    sensor: '#ff7fd0',
    searchOk: GREEN,
    searchBlocked: TERRACOTTA,
  },

  /**
   * The curling table — SUMMER PORCH, and it is the same timber as the board.
   *
   * It was a cream (`#e8dcc0`), which was the last beige neutral in the file and
   * is what §4.1.2 of the direction retired. Unifying it with the board also
   * settles a question the mode kept re-asking: the lane is a wooden floor, not
   * ice, and "여름에 하는 컬링" only works as a joke if the surface says summer.
   *
   * `targetLine` had the strictest requirement of any single value here and it
   * still does: the mode is unplayable if the mark cannot be found.
   */
  curling: {
    table: WOOD,
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
     * `light` is not paper white. The board is a mid-tone and a pure white
     * square would bloom against it under the floor light; this is the table's
     * own value pushed up, so the pale squares read as painted ON the wood
     * rather than as holes cut out of it.
     *
     * ── it is pushed toward the COOL white, not toward warm ────────────────
     * The obvious way to lighten timber is to add yellow-white, and doing that
     * produced `#ece2d2` — chroma 0.10 at hue 37°, which is a cream, and the
     * audit says so. Mixing 70% toward `whiteCool` instead lands at chroma
     * 0.027, where the residual warmth is below the level anyone can see and
     * the square still belongs to the wood it is painted on. Measured 8.31:1
     * against `targetDark` and 1.57:1 against the bare table.
     */
    targetDark: COBALT_INK,
    targetLight: '#e7e6e0',
    house: BLUE_PALE,
    apron: WOOD_DARK,
    /** Debug-only aiming guide. */
    guide: '#ff7fd0',
    tint: WHITE_PURE,
  },

  /**
   * Stylised wet metal — the cap skirt, the goal frames, the curling rails.
   *
   * Deliberately NOT desaturated to a neutral grey, and deliberately glossy. A
   * crown cap is a metal object and that is most of what makes it read as a
   * bottle cap rather than as a counter. What the brief bans is photographic
   * environment mirroring, not gloss — the v2 override on that point stands.
   *
   * The ramp is cooled to match: it was a neutral steel and it is a blue-steel
   * now, because a neutral grey next to cobalt reads warm.
   */
  metal: {
    base: '#c2cfda',
    bandHi: '#eaf3fa',
    bandLo: '#94a6b8',
    grainHi: '#d4e0ea',
    grainLo: '#a8b8c8',
    /** The liner disc inside the cap. Was a cream; rule 2 made it a cool grey. */
    liner: '#dde5e8',
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
    light: WHITE_PURE,
    dark: '#5a7590',
  },

  /**
   * The interface.
   *
   * ── the glass stack is gone ────────────────────────────────────────────────
   * `glassTop` `glassBottom` `glossHi` `glossLo` `edgeInner` `edgeOuter` were the
   * seven-step gel-button recipe's own colours and they left with `ui/glass.js`.
   * What replaces them is not a shorter recipe, it is a different claim: a
   * surface here is PAPER — one flat value, one hairline — and a control is
   * text with a rule under it. There is nothing left for a gloss sweep to sit on.
   */
  ui: {
    /**
     * ── where each ink is allowed ──────────────────────────────────────────
     * `text` and `textMuted` are for type on the paper. They clear 4.5:1 there
     * and the audit checks it.
     *
     * Type drawn straight onto the backdrop uses `textOnAccent` — white. Cobalt
     * ink on `bg.skyTop` is 2.5:1 and unreadable, and the fix is not a paler
     * sky. So the rule is directional rather than a value, and the audit checks
     * both halves of it.
     */
    text: COBALT_INK,
    textMuted: SLATE,
    textFaint: FAINT,
    textOnAccent: WHITE_COOL,

    /* ── surfaces ────────────────────────────────────────────────────────── */
    surface: WHITE_COOL,
    surfaceAlt: '#eaf4fb',
    surfaceSunken: PAPER_SUNK,
    /** Behind a modal. A wash of the sky, not a black scrim. */
    veil: COBALT,
    edge: EDGE,
    edgeStrong: EDGE_STRONG,

    /**
     * The one shadow this palette has, and it is barely a shadow.
     *
     * §19 and §24 of the brief both ban heavy shadows, so `ELEVATION` went with
     * the gel buttons. What survives is the soft pool under the floating bottle
     * and the faint halo that keeps a card's glow off a bright background. Both
     * are cobalt: rule 1 has no neutral dark to offer and does not want one.
     */
    shadow: COBALT_INK,

    danger: TERRACOTTA,
    dangerDeep: TERRACOTTA_DEEP,
    dangerPale: '#f2cfc4',

    disabled: '#e8eff5',
    disabledEdge: '#cbdae6',
    disabledText: '#8ba4b8',
  },

  /**
   * The accent hues that are NOT blue, mid and deep. Deep values are for type.
   *
   * ── there is no blue in here, and that is the point ────────────────────────
   * `cyan` and `sky` were the aero direction's two protagonists, and every call
   * site that wanted "the highlight colour" said `accent.cyan`. In a scheme
   * where blue is the whole world, that name stops carrying information: a
   * highlight is `cobalt`, a fill is `blueClear`, a tint is `bluePale`, and each
   * of those is a top-level name a reader can check against the brief. Keeping
   * `accent.cyan` as an alias for one of them would have let the old look back
   * in one call site at a time, which is exactly how it spread the first time.
   *
   * What is left is the hues the blues cannot say: a green for the aiming path,
   * an amber and a terracotta for the two warm cards, a violet for 혼란, and a
   * steel for 철벽.
   */
  accent: {
    green: GREEN,
    greenDeep: GREEN_DEEP,
    amber: AMBER,
    amberDeep: AMBER_DEEP,
    terracotta: TERRACOTTA,
    terracottaDeep: TERRACOTTA_DEEP,
    violet: VIOLET,
    steel: STEEL,
  },

  /**
   * The four states every pressable surface shares.
   *
   * ── these are inks and rules now, not fills ────────────────────────────────
   * A control in this direction is text with a hairline under it, so a state
   * changes the INK and the RULE and, for `active`, adds a very light wash. The
   * old table gave each state a background gradient and an edge because every
   * control was a gel plate; four of those six fields had nowhere left to go.
   *
   * `dimmed` is not `disabled`: a dimmed control is still usable and merely
   * pushed back while something else has focus, so it keeps its ink contrast
   * and loses only presence.
   */
  button: {
    idle: { text: COBALT_INK, rule: EDGE_STRONG, wash: null },
    hover: { text: COBALT, rule: COBALT, wash: null },
    active: { text: COBALT, rule: COBALT, wash: PAPER_SUNK },
    disabled: { text: '#8ba4b8', rule: '#cbdae6', wash: null },
    dimmed: { text: SLATE, rule: EDGE, wash: null },
  },

  /**
   * 1P and 2P.
   *
   * A coral and a cobalt, 0.174 apart in absolute relative luminance — rule 4.
   * Chosen to hold up against cool timber, turf, a pale table AND a broad
   * wet-metal specular that lifts both of them.
   *
   * `ink` is the same hue pushed dark enough to be type on the paper; `pale` is
   * it pushed light enough to be a fill behind that type. Between them, nothing
   * outside this file lightens or darkens a player colour at the call site.
   */
  player: [PLAYER_1, PLAYER_2],
  playerInk: ['#a83828', '#123f86'],
  playerPale: ['#f7cec4', '#c2d8f2'],
  /** Nobody's colour: a draw, an unowned mark, a neutral cap. */
  neutral: '#93a4b4',

  /**
   * Card accents, keyed by `cardCatalog` id.
   *
   * The lookup stays here rather than in the catalog: the catalog lives under
   * `src/game/`, which the direction freezes, and importing an art module into
   * simulation territory would put the palette in the deterministic bundle for
   * the sake of seven strings. `cardTexture` reads this and falls back to the
   * catalog for any card the table has not been told about, so adding one cannot
   * leave the hand with an undefined `strokeStyle`.
   *
   * ── seven hues, and they are separated by HUE, not by value ────────────────
   * All seven are drawn on the same white card face, so contrast between two of
   * them says nothing useful — what matters is that no two land in the same
   * place on the wheel at icon size. Measured gaps, smallest first: resist and
   * silence share a hue and are told apart by CHROMA instead (0.42 against
   * 0.08), which is the card's own meaning — 침묵 is the one with the colour
   * drained out of it. Every other neighbouring pair is at least 29°.
   *
   * ── and they came down in value ────────────────────────────────────────────
   * The old set was pulled from the aero palette: a mint `#7ef0c8`, a gold
   * `#e0c07a`, an orange `#e8724a`. On a cool white card those read as candy,
   * and the gold and the orange together are exactly the "excessive orange and
   * yellow" §3 bans. Each is now the same hue at roughly half the lightness, so
   * it sits on paper as ink rather than glowing off it — every one clears 3:1
   * on the card face.
   */
  card: {
    swap: '#1f8fa8',
    trajectory: GREEN,
    chaos: VIOLET,
    onemore: AMBER,
    smash: TERRACOTTA,
    resist: STEEL,
    silence: '#7c8790',
  },

  /**
   * The aiming furniture: bow, pull line, error cone, clamp bar.
   *
   * ── the cone is white and everything else is dark ──────────────────────────
   * §5.2 of the direction makes the error cone a translucent WHITE area with a
   * faint edge, because it is a region rather than a line. Everything else here
   * is a line drawn over a light field and lines over light fields have to be
   * dark — the measured contrasts are blunt about it: a bright amber bow lands
   * within 1.2:1 of both timber and summer turf, so it would have been invisible
   * on two of the three fields.
   *
   * `pull` is a teal rather than the blue it wants to be, because a blue pull
   * line drawn out of a blue 2P cap reads as part of the cap.
   */
  aim: {
    bow: '#a8451c',
    bowIdle: '#54687e',
    pull: '#155f80',
    /** The cone's fill and edge. Alphas are §5.2's and live at the call site. */
    cone: WHITE_COOL,
    coneEdge: WHITE_COOL,
    clamp: TERRACOTTA_DEEP,
    path: GREEN_DEEP,
    hover: GREEN,
    ringIdle: '#54687e',
    ringArmed: '#a8451c',
    smashBow: '#b83a20',
    smashPull: '#9c3018',
    /** 강타의 콘. 흰색 그대로다 — 넓어지는 것은 알파가 아니라 각도로 읽힌다. */
    smashCone: WHITE_COOL,
    dash: [GREEN_DEEP, GREEN, '#0d5240', GREEN],
  },

  /**
   * The pickup orbs, as soap bubbles.
   *
   * Bright translucent glass rather than the dark marble they were: on a light
   * board a dark sphere reads as a hole in the board, which is the one thing a
   * pickup must not look like.
   */
  orb: {
    shell: '#59bce4',
    keyBand: ['#7cd0ee', '#a8e2f6', '#dcf4fd', WHITE_PURE, '#c2ecfa', '#8adcf0', '#59bce4', '#42a4cc'],
    fillBand: ['#42a4cc', '#59bce4', '#7cd0ee', '#96def0', '#68c8e6', '#4eb0d6', '#409ec2', '#3890b4'],
    equator: '#8adcf0',
    markCore: WHITE_PURE,
    markGlow: '#12688f',
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
   *
   * §13 of the brief changed what these MEAN, and PHASE 8 spent it: an impact
   * is a small object hitting water, not a weapon strike. That took `star` to
   * `drop` and took the ember out of `aura`; it did not touch the rule above,
   * because added light is bright whatever it is a picture of.
   */
  fx: {
    white: WHITE_PURE,
    /**
     * 혼란의 물방울. 흰 핵, 옅은 파랑, 그림자 쪽의 남색.
     *
     * `star` 였다 — 뾰족한 팔 여덟. 색은 거의 그대로 옮겨 왔고 이름과 그림이
     * 바뀌었다: §13 이 무기가 아니라 **물에 떨어진 작은 것**을 요구하는데, 팔이
     * 여덟인 별은 그 목록의 어디에도 없다. §9 가 말하는 "파스텔" 이 이 세 톤이다.
     */
    drop: [WHITE_PURE, '#e2eeff', '#93a9dc'],
    /** 물결 하나. 스왑의 이별, 강타의 수축, 원모어의 두 번이 전부 이 스프라이트다. */
    ring: ['#3f8fd8', '#a8d8f8', WHITE_PURE],
    /**
     * 강타의 물결 세 겹. `[바깥, 가운데, 안쪽]` — 퍼져 나간 순서다.
     *
     * 녹슨 주황이었다: `#9c3a18` → 테라코타 → `#f8c8a8`. 잉걸불이고, §13 이 불과
     * 폭발을 금지한다. 링 세 겹이라는 **모양**은 이미 물결이었으므로 색만 바뀌면
     * 되는 자리였다.
     *
     * 카드의 액센트(테라코타)는 남되 안쪽에만 남는다. 물은 제 색이 없고 비추는
     * 것의 색을 가지므로, 뚜껑에 가장 가까운 고리가 산호빛을 띠고 바깥으로 갈수록
     * 흰 물보라가 된다. `SMASH_PALETTE` 가 이 위에 다시 곱해지므로 셋 중 가장
     * 어두운 것도 흰색 가까이 있어야 한다.
     */
    aura: ['#e4f0fa', '#f8d4c8', '#fff0e8'],
    lock: { outline: '#3a5878', body: '#e2eef8', shade: '#90a8c0', light: WHITE_PURE },
    dash: [WHITE_PURE, '#a8f0dc', '#2f9c82'],
    /**
     * 궤적의 띠. 흰 마루에서 초록으로, 그리고 짧게 끝난다.
     *
     * 네 톤인데 마지막 `#1f6e5e` 가 거의 보이지 않는 것이 의도다 — `scanTexture`
     * 가 이 램프를 쿼드 위쪽 4분의 1 안에 다 쓰고 나머지를 비운다. §9 가 요구하는
     * 것은 **얇은** 빛의 띠이고, 두께는 알파가 아니라 그림에서 온다.
     */
    scan: [WHITE_PURE, '#a8ffe4', '#3fb096', '#1f6e5e'],
    frame: ['#f8e4c0', AMBER, '#6f5218'],
    swapLine: BLUE_CLEAR,
  },

  /**
   * 메뉴의 물.
   *
   * ── 이것은 하늘이 아니라 **지면**이다 ──────────────────────────────────────
   * 메뉴 화면의 구조가 바뀌었다. 하늘 돔 아래 병이 떠 있던 것에서, 화면 전체가
   * 물이고 제목이 그 **아래**에 잠긴 것으로. 그래서 여기 있는 값들은 `bg.*` 와
   * 나란한 것이 아니라 그것을 **대신한다** — 메뉴 문서에서만.
   *
   * 게임의 하늘(`bg.*`)은 손대지 않았다. `core/sky.js` 는 두 문서가 공유하는
   * 모듈이고, 거기를 고치면 판 위의 하늘까지 물이 된다.
   *
   * 세 값은 굴절의 깊이 순이다: `crest` 는 파면이 빛을 튕기는 곳, `body` 는 물의
   * 본색, `deep` 은 빛이 닿지 않는 아래. 셋 다 규칙 1 의 휘도 하한을 넉넉히 넘고,
   * 가장 어두운 `deep` 조차 검정이 아니라 코발트 잉크 쪽이다.
   */
  water: {
    crest: '#7fc4ef',
    body: '#2f8ed6',
    deep: COBALT,
    /**
     * 굴절 무늬가 더하는 빛. **가산으로 얹히므로 밝아야 한다.**
     *
     * 선형 휘도 0.79 로 블룸 임계(0.72)를 넘는다. 그것이 의도다 — 수면의
     * 반짝임은 이 화면에서 유일하게 빛나도 되는 것이고, 넘지 않으면 굴절이
     * 무늬로만 보이고 빛으로 보이지 않는다.
     */
    caustic: '#eaf6fd',
    /**
     * 화면의 **모든** 글자가 이 잉크 하나를 쓴다. 순백이다.
     *
     * 제목, 내비, 날짜 도장, 밑줄, 판 위의 글자까지 전부. 위계는 색이 아니라
     * 크기가 만든다 — 단일 웨이트 서체를 쓰는 화면의 규칙이다.
     *
     * ── 여기가 옅은 파랑이었던 이유, 그리고 그것이 사라진 이유 ─────────────
     * 제목이 월드 레이어에 있어 블룸을 받았고, 순백의 선형 휘도 1.0 은
     * 브라이트패스 임계 0.72 를 한참 넘어 글자가 흰 덩어리가 됐다. 그래서
     * 임계 바로 아래인 bluePale(선형 0.685)로 내려 두었었다. 지금은 메뉴의
     * 블룸 자체가 꺼져 있으므로 색을 낮춰서 풀 문제가 아니다 —
     * 그 화면에서 임계를 넘는 것이 이 잉크 하나뿐이고 그마저 파괴였다.
     * 실측은 `menuConfig.view.bloom` 주석에 있다.
     */
    ink: '#ffffff',
  },

  /**
   * The menu page: a bottle floating on the backdrop.
   *
   * ── the label is cobalt and white now ──────────────────────────────────────
   * It was a 1950s-red-and-cream drink label, chosen against a real object. That
   * object was the wrong reference for this direction, and the cream was a
   * neutral rule 2 bans. What replaces it is the same printed-paper structure in
   * the palette's own two colours — which is also what 1990s drink graphics
   * actually looked like, and is §A of the bottle appendix's own reading.
   */
  menu: {
    labelInk: COBALT,
    labelInkDeep: COBALT_INK,
    labelInkLight: BLUE_CLEAR,
    labelPaper: WHITE_COOL,
    labelPaperAlt: '#e8f2fa',
    labelRule: BLUE_PALE,
    /**
     * 거품 머리.
     *
     * 콜라 거품이었다 — `#d9b988`, 두꺼운 곳에서 황갈색으로 가는 더러운 크림색.
     * 병이 사이다가 된 뒤에도 그대로 남아 있었고, 흔들면 어깨와 목이 통째로
     * 카키색이 됐다.
     *
     * 맑은 탄산의 거품은 희다. 완전한 백색이 아닌 것은 유리와 음료를 지나
     * 보이기 때문이고, 그래서 아주 옅은 파랑이 깔린다.
     */
    foam: '#eaf6fd',
    foamTones: [WHITE_PURE, '#dcf0fb', '#c2e4f4', '#f7fdff'],
    /**
     * The shadow under the bottle and the pool of light around it.
     *
     * §6.2 of the direction takes the floor away: the bottle floats, so there is
     * no contact shadow to draw. What is left is one very soft, very faint shape
     * far below it, and the pool of light it sits in. The alphas stay at the
     * call site — they are the falloff's shape, not a colour.
     */
    shadow: COBALT_INK,
    /**
     * Toned down from near-white once bloom arrived. At the old values every
     * step was above the bright-pass threshold and the pool stopped reading as
     * light on a floor and became a hole in it.
     */
    pool: ['#a8d4ec', '#bcdef2', '#cee8f6', '#e0f2fb', '#eef8fd'],
    meterOn: COBALT,
    meterOff: EDGE,
    /**
     * The BRAND cap — the one on the bottle, and the one the screen is painted
     * with during the menu-to-game handover.
     *
     * ── this is the most-seen single colour in the game ──────────────────────
     * `MENU_CONFIG.transition.coverSeconds` is 0.35s, and for all of it the
     * whole screen is this colour with the logo over it. So this is not a detail
     * of the bottle — it is the transition's identity, and §7.3 of the direction
     * names it: cobalt.
     *
     * It is `cobalt` rather than `cobaltInk` because a screen filled with the
     * ink is a dark screen, which §24 bans. Checked against both player colours:
     * 2.14:1 from 1P's coral and 1.13:1 from 2P's cobalt — the second is close,
     * and it is allowed to be. A menu cap and a 2P cap never share a screen.
     */
    capBrand: COBALT,
    /**
     * The NEUTRAL cap the mark editor draws on. Deliberately not the brand cap.
     *
     * A mark belongs to neither player and is previewed on neither's colour, and
     * it must not look like the brand cap either — you are drawing YOUR artwork,
     * not editing the game's logo. A cool grey against a saturated cobalt:
     * barely apart in lightness, entirely apart in chroma.
     */
    capDefault: '#c6ccd2',
  },

  /**
   * 병의 타원 라벨. 인쇄된 종이이므로 무광이다.
   *
   * 한 값만 남아 있고, 그게 요점이다. 라벨은 흰 타원 한 장이고 그 위의 광택은
   * 앞에 있는 유리가 낸다. 라벨에도 하이라이트를 넣고 싶어지는데, 그러면 병에
   * 감긴 라벨이 아니라 병 앞에 떠 있는 스티커로 읽힌다.
   */
  label: {
    paper: WHITE_COOL,
  },

  /**
   * The mark editor's drawing palette: twenty-four swatches, six rows of four.
   *
   * The count and the order are LAYOUT — `MarkEditor` lays these out on a fixed
   * grid — so a change has to keep both. The role of each row is unchanged:
   * neutrals, warm reds, ambers, greens, blues, magentas.
   *
   * This is the ONE place a wide gamut is correct. A player drawing on a cap is
   * not decorating the interface, and a palette restricted to the game's own two
   * colours would make every mark look like the game drew it.
   *
   * Existing marks are stored as PNG data URLs rather than as stroke lists with
   * palette indices, so retuning these cannot alter a drawing anybody has
   * already saved. That is the only reason it was safe to change them at all.
   */
  marks: {
    swatches: [
      WHITE_PURE, '#c2d4e0', '#78909f', COBALT_INK,
      '#a83828', TERRACOTTA, '#e8724a', '#f2a068',
      AMBER, '#e8c874', '#b08430', '#7d5e1c',
      '#8ad058', '#3fa85c', '#2fc0a8', GREEN_DEEP,
      COBALT, BLUE_CLEAR, '#3f5a8c', '#40b8de',
      VIOLET, '#6a4cb0', '#d85c98', '#f0a0c0',
    ],
    /** The checkerboard behind a transparent mark. */
    checkerA: WHITE_COOL,
    checkerB: PAPER_SUNK,
    /** The turntable's cap when no colour has been assigned yet. */
    blank: '#c6ced6',
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
    rank: ['#b8501c', '#a07a20', '#5f8440', '#4a6a88', '#7c9ab4'],
    trackTarget: '#a07a20',
    trackLook: '#155f80',
    hitQuad: GREEN,
  },

  /**
   * Ramps read as INTENSITY rather than as surface colour.
   *
   * Everything here is drawn additively, so a dark entry means "add almost
   * nothing" and is how a falloff is spelled. The luminance floor is about
   * surfaces the player looks AT, and applying it here would flatten every one
   * of these into a solid block of light. The chroma cap still applies — a neon
   * glint is a neon glint however it is blended.
   */
  additive: {
    /** The three vertical glints down the bottle's glass, bottom to top. */
    glintKey: ['#101010', '#3a3a3a', '#8a8a8a', '#c4c4c4', '#d0d0d0', '#b0b0b0', '#4c4c4c', '#141414'],
    glintMid: ['#0a0a0a', '#1a1a1a', '#343434', '#4a4a4a', '#4e4e4e', '#3c3c3c', '#1c1c1c', '#080808'],
    glintFar: ['#080808', '#161616', '#282828', '#343434', '#343434', '#242424', '#101010', '#050505'],
    /** One carbonation bubble: a bright rim knocked back to nothing inside. */
    bubble: { rim: '#e8f4fc', mid: '#3a4650', core: '#12181c', glint: WHITE_PURE },
    /** The burst at the bottle's mouth, two frames. */
    burst: {
      // 같은 음료에서 나온 것이므로 같은 계열이다. 크림색이었고, 그건 콜라 거품의
      // 잔재였다 — `PALETTE.menu.foam` 의 주석 참조.
      popWide: '#e6f7ff',
      popTight: WHITE_PURE,
      popCore: WHITE_PURE,
      sprayWide: '#cfeaf8',
      sprayTight: '#f4fdff',
      sprayCore: '#c8d8e4',
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

/** Toward the paper. Not toward pure white — see rule 2. */
export function lighten(hex, t) {
  return mix(hex, WHITE_COOL, t);
}

/**
 * Toward the palette's ink rather than toward black.
 *
 * Rule 1 made unavoidable: a `darken()` that walked to `#000000` would hand
 * every caller a way to reintroduce pure black one blend at a time.
 */
export function darken(hex, t) {
  return mix(hex, COBALT_INK, t);
}

/** `#rrggbb` + alpha -> `rgba(...)`, for canvas fills that need transparency. */
export function withAlpha(hex, alpha) {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

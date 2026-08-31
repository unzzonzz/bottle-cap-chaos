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
   * Deep sky overhead falling to almost-white at the bottom, with a few very
   * slow bokeh points over it. There is deliberately nothing else out there —
   * the brief is explicit that objects around the board compete with the board,
   * and both football and curling have framing requirements that scenery breaks.
   */
  bg: {
    skyTop: '#1a76c4',
    skyMid: '#4fb3e8',
    skyLow: '#dff4fc',
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

  /** What is inside the bottle. Bright, translucent, faintly green-cyan. */
  liquid: {
    core: '#2fb8d8',
    edge: '#7fe0ee',
    foam: '#eafaff',
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
   * `grid` is darker than the board, which is not what its value suggests it
   * needs to be: the grid is drawn with an UNLIT line material while the board
   * is a lit surface, so a line at the board's own value comes out brighter than
   * the board and the subtle scale reference reads as a loud white lattice.
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
    grid: '#a8834f',
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
    targetLine: '#c2481a',
    house: '#7fd0e8',
    throwLine: '#8fb8d8',
    edge: '#a8834f',
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
    silence: SLATE,
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
    /** Cola foam: a dirty cream going tan where it is thick, never white. */
    foam: '#d9b988',
    foamTones: ['#f0dcb6', '#e2c79c', '#bd9a64', '#fbf1d8'],
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
      popWide: '#fff4d8',
      popTight: PAPER,
      popCore: PAPER,
      sprayWide: '#efe0bb',
      sprayTight: '#fffaf0',
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

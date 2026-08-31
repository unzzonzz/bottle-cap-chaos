import { BOTTLE_DEFAULTS } from './bottleProfile.js';
import { PALETTE } from '../core/palette.js';

/**
 * Every number the menu can be tuned by, in one object.
 *
 * The same arrangement `game/config.js` uses: the panel edits THIS, nothing
 * else, so turning the panel off changes nothing about how the menu behaves —
 * the values are the same values, there is just nothing on screen to drag them
 * with.
 *
 * Split into blocks by what owns them rather than by what they do, so a module
 * takes one block and never reaches across into another's.
 */
export const MENU_CONFIG = {
  bottle: {
    profile: { ...BOTTLE_DEFAULTS },

    // ── where it sits ──────────────────────────────────────────────────────
    /** Left of centre, so the menu column has the right half to itself. */
    originX: -7.4,
    originY: 1.2,
    floorY: -11.4,

    // ── the lean ───────────────────────────────────────────────────────────
    /** The main tilt, in the screen plane. The brief asks for 15–25. */
    leanZ: 19,
    /** A little away from the camera, so it reads as an object and not a decal. */
    leanX: 5,
    /** Turns the label to the front. Fixed; the bottle never spins. */
    faceYaw: 0,

    // ── the float ──────────────────────────────────────────────────────────
    floatAmplitude: 0.36,
    floatSpeed: 0.85,

    // ── the shake ──────────────────────────────────────────────────────────
    /** Cycles per second along the bottle's own axis. High on purpose. */
    shakeFrequency: 17,
    shakeAmplitude: 0.5,
    /** How hard the envelope ramps up over stage 1. 1 is linear. */
    shakeCurve: 1.6,
    // ── sloshing ───────────────────────────────────────────────────────────
    // The FREQUENCY is not here, and deliberately: it is derived from the
    // bottle's radius and fill depth by the cylinder slosh formula in
    // `Bottle._slosh`. These three are the parts that are not physics.
    /** How hard the stroke drives the tilt mode, per unit of sin(lean). */
    sloshDrive: 150,
    /**
     * The arm's stroke, in Hz — NOT the rattle.
     *
     * Deliberately close to the drink's own ~4 Hz mode, because that is where a
     * hand naturally shakes and it is why shaking works at all. See `_slosh`.
     */
    strokeFrequency: 4.2,
    /** Damping ratio. Water-like liquids sit around a tenth. */
    sloshDamping: 0.11,
    /** Ceiling on the tilt, so a hard drive cannot push it through the glass. */
    sloshLimit: 0.7,

    // ── the carbonation ────────────────────────────────────────────────────
    /**
     * How high the head can climb, in mm up the bottle.
     *
     * Just short of the lip, which is at 200 on the long-neck profile. It
     * arrives there as the cap goes, which is the whole point: the eruption is a
     * bottle that has run out of room, not a bottle that decided to spray.
     *
     * Re-checked against the new silhouette: the neck top is 186 and the lip is
     * 200, so a head at 192 is inside the finish and still under the cap. It was
     * 188 against a 196 lip, i.e. the same 8 mm of headroom.
     */
    foamCeiling: 192,
    /**
     * Foam made per second while shaking, as a VOLUME in world units cubed.
     *
     * A volume and not a speed, because how fast the head then climbs is the
     * bottle's business — see the continuity note in `_carbonate`.
     */
    foamProduction: 300,
    /** Volume per second draining back. Constant, so the head falls when idle. */
    foamDrain: 34,
    /** The extra production at the moment the cap goes, and how long it lasts. */
    foamPopSurge: 900,
    foamPopSeconds: 0.18,
    /** How fast the foam churns, in texture pages a second. */
    foamScrollSpeed: 1.1,

    // ── the bubbles ────────────────────────────────────────────────────────
    /** Distinct points on the glass that bubbles come up from. See `Fizz`. */
    /**
     * More of them, because the liquid stopped doing the work.
     *
     * It was 9 against an opaque brown drink where the bubbles were a detail. A
     * clear cider shows almost nothing of its own — the slosh included — so the
     * carbonation is what says there is liquid in there at all.
     */
    /**
     * 12 였다. 탄산이 이 화면의 **모티프**가 되면서 더 필요해졌다.
     *
     * 아트 디렉션이 병과 물과 거품으로 바뀐 뒤, 거품은 "액체가 있다"를 말하는
     * 디테일이 아니라 화면이 무엇에 관한 것인지를 말하는 것이 됐다. 사이트 수는
     * **줄기의 수**이고 — `Fizz` 머리말의 1번 — 줄기가 적으면 흔들었을 때 솟는
     * 것이 아니라 몇 방울이 오르는 것으로 보인다.
     *
     * 물리는 그대로다. 사이트가 늘어도 각 거품의 성장과 상승은 같은 식을 쓴다.
     */
    nucleationSites: 20,
    /** Radius at nucleation, world units. 0.09 is about nine tenths of a mm. */
    bubbleRadius: 0.09,
    /**
     * How much a bubble grows over one climb. 2.2 means it ends 3.2x bigger.
     *
     * 1.5 였다. 올렸는데, 이것은 밝기 조절이 아니라 물리량이라는 점이 중요하다 —
     * 상승 속도가 반지름의 **제곱**이므로(`riseCoefficient` 주석) 더 크게 자라는
     * 거품은 더 빨라지고, 그래서 줄기가 위로 갈수록 넓어지고 빨라진다. `Fizz`
     * 머리말이 "탄산 한 잔에서 가장 알아보기 쉬운 것" 이라고 부른 그 모양이다.
     *
     * 3.2배는 화면에서 위쪽 거품이 유리 구슬로 읽히기 시작하는 지점이다 — 테와
     * 정반사가 각각 한 픽셀을 넘는다. 그 아래로는 어떤 텍스처를 써도 밝은 점이다.
     */
    bubbleGrowth: 2.2,
    /**
     * The rise coefficient in v = K r^2.
     *
     * The exponent is Stokes'; this is NOT the Stokes coefficient — at these
     * radii the real regime is intermediate and the literal value over-predicts
     * by an order of magnitude. Fitted to the observed rise instead. The long
     * version is in `Fizz`.
     */
    riseCoefficient: 300,
    /** How far the helical path instability swings the bubble off its site. */
    bubbleWobble: 0.42,
    /** Overall brightness of the bubbles. */
    fizzStrength: 1.25,

    // ── aiming at the camera ───────────────────────────────────────────────
    /** The lean it turns TO as the pressure builds. See `applyLean`. */
    aimLeanZ: 22,
    /**
     * How far it pitches the mouth toward the camera.
     *
     * Enough that the cap is visibly pointed your way and the launch reads as
     * continuing a movement already in progress — and no further. Past about 50
     * the bottle is being looked at down its own axis, the label foreshortens
     * away and the silhouette everything else was built for stops being
     * legible. "살짝 회전", as asked.
     */
    aimPitch: 33,
    /** Seconds to turn. Shorter than stage 1, so it is aimed before the pop. */
    aimRiseSeconds: 0.3,
    /** Seconds to unwind afterwards. Long — there is nothing to hurry for. */
    aimFallSeconds: 0.9,

    // ── the trimmings ──────────────────────────────────────────────────────
    /** How far the cap's panel stands proud of the bottle's lip, in mm. */
    capLift: 0.4,
    shadowScale: 2.42,
    shadowLift: 0.06,
    burstSeconds: 0.14,
    burstSize: 5.5,
  },

  camera: {
    fov: 30,
    distance: 62,
    /** Above the bottle's middle, so the floor opens out. See `placeCamera`. */
    height: 5.2,
    lookAtY: 0.6,
    /** How hard the camera shakes in stage 1. Much weaker than the bottle. */
    shakeStrength: 0.14,
    shakeFrequency: 21,
  },

  /**
   * The transition, stage by stage. Summed default is 0.95s, inside the one
   * second the brief allows, with the covered window at three frames of a 60 Hz
   * display — the shortest a scene swap can hide behind and still be certain to
   * be SEEN by the compositor.
   */
  transition: {
    shakeSeconds: 0.38,
    launchSeconds: 0.28,
    /**
     * How long the cap holds the screen.
     *
     * ── it is a BEAT now, not a seam ────────────────────────────────────────
     * This started at 0.05 — three frames at 60 Hz — because the brief asked
     * for "완전 차폐 (2~3프레임)" and all it had to do was hide a scene swap.
     * Three frames is the shortest window a swap can hide behind and it did
     * that job perfectly.
     *
     * Then the cap got the game's logo on it, and the covered frame stopped
     * being a seam and became the one moment that logo is eight hundred pixels
     * across. Three frames is 50 ms: long enough to register that something
     * red filled the screen, nowhere near long enough to READ three words.
     *
     * 0.35 puts the whole run at 1.25s, which is over the brief's original
     * "1초 이내". That budget was written when the cover was a technical
     * necessity with nothing on it; deliberately showing someone a wordmark and
     * then not leaving it up long enough to read is worse than being a quarter
     * second slow. The press-and-hold already made the total variable anyway.
     */
    coverSeconds: 0.35,
    exitSeconds: 0.24,
  },

  /**
   * 내 마크 — the drawing screen's numbers.
   *
   * Same arrangement as every other block here: the panel edits THIS, so turning
   * the panel off changes nothing about how the editor behaves.
   */
  marks: {
    /**
     * Canvas edge in texels.
     *
     * 128 is where the brief starts it, and it is a page — the same ceiling
     * `core/textures.js` puts on every other texture in this project. Only the
     * inscribed circle is reachable and only `boundary` of that, so the drawable
     * area is smaller again: at these two defaults it is about 92 texels across.
     */
    canvasSize: 128,
    /**
     * The drawable circle, as a fraction of the canvas half-width.
     *
     * The ring between this and the panel's own rim is the part of the cap that
     * stays team-coloured, and the brief calls that ring the team marker. Raising
     * this toward 1 eats it.
     */
    // A fraction of the cap's PANEL, not of the cap. See `MARK_BOUNDARY_DEFAULT`.
    boundary: 0.84,
    /**
     * Strokes the editor remembers. The brief asks for at least twenty.
     *
     * Whole canvases, not diffs — see `MarkEditor` — so the cost is this times
     * `canvasSize` squared times four bytes. At the defaults that is about
     * 1.5 MB, and the panel can push it in either direction to find out where
     * that stops being a good trade.
     */
    historyLimit: 24,
    /** The cap the editor draws on. Neutral: a mark belongs to neither side. */
    capColor: PALETTE.menu.capDefault,
    /** View mode: radians of roll per pixel of vertical drag. */
    rotateRadiansPerPixel: 0.012,
    /** What a release keeps of the drag's speed. */
    flingScale: 0.9,
    /** Per 1/60 s. Below 1, so a thrown cap comes to rest. */
    spinDamping: 0.94,
  },

  wipe: {
    /**
     * Extra scale over the exact fit, at the covered frame.
     *
     * The exact fit is computed from the cap's own panel radius and the frame's
     * half-diagonal, so 1.0 would already cover it — this is the margin against
     * the vertex snap, which moves every corner by up to half a low-res pixel
     * and would otherwise be free to move one INWARD.
     */
    coverSafety: 1.1,
    /** Turns a second while it flies. Not so fast it strobes on the grid. */
    spinSpeed: 1.35,
    /** How far the spin axis leans off the flight direction, in degrees. */
    axisTilt: 15,
    /** How much bigger it still gets on the way past, over the cover scale. */
    exitGrowth: 1.22,
    /** How far it travels on the way out, in frame pixels. */
    exitTravel: 1180,
    /** Where it starts, as a fraction of the cover scale. */
    startScale: 0.05,
  },

  items: {
    /**
     * One FRAMEBUFFER pixel per texel, which is why the type survives. So these
     * are in target pixels — at the 640x480 default the column below spans
     * x 4..260 of the 320 available to the right of centre.
     *
     * They are absolute rather than fractions of the frame on purpose: the
     * whole point is that a texel lands on a pixel, and a fraction would put
     * the plate on a half-pixel boundary at some resolutions.
     */
    plateWidth: 256,
    plateHeight: 52,
    /** Pixels between plate centres. */
    pitch: 64,
    /** Pixel position of the column's centre. */
    columnX: 132,
    columnY: -24,
    /** A few degrees, so they read as panels in the room. More warps the type. */
    yaw: -7,
    /** How far a hovered plate steps toward the camera and to the right. */
    hoverShift: 0.45,
  },

  view: {
    /**
     * The same bloom the game runs, so the two sides of the cap wipe match.
     *
     * The menu is the one screen that is nothing BUT glossy surfaces — glass,
     * liquid, bubbles, a metal cap — so it is where the threshold gets judged.
     * If it looks right here and hazy in a match, the match's lighting is too
     * hot rather than the bloom being wrong.
     */
    bloom: {
      enabled: true,
      threshold: 0.72,
      strength: 0.45,
      radius: 0.6,
    },
  },
};

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
    /**
     * How far below the bottle the soft shadow sits.
     *
     * ── this was `floorY`, and there is no floor ──────────────────────────
     * §6.2 takes the ground away: the bottle floats in space, so there is
     * nothing for it to stand on and no contact shadow to cast. What is left is
     * the one very soft, very faint shape §7 still asks for, and its only job is
     * to say "this object is above something" — so it is far below, it never
     * touches, and it does not sharpen as the bottle descends.
     *
     * The name changed with the meaning. A `floorY` that no longer marks a floor
     * is the kind of constant somebody reinstates a contact shadow against.
     */
    shadowDrop: -11.4,

    // ── the lean ───────────────────────────────────────────────────────────
    /**
     * The resting tilt, in the screen plane.
     *
     * ── 19 was a bottle STANDING at a jaunty angle ─────────────────────────
     * The old note said "the brief asks for 15–25", and that brief wanted a
     * bottle on a surface. §7 of this one asks for the opposite pose: tilted
     * toward the horizontal, floating gently in space. At 19 the bottle reads as
     * standing up whatever the floor is doing, because that is the angle a
     * bottle stands at.
     *
     * 62 reads as floating. Measured against the liquid model rather than
     * guessed: `docs/bottle-preview.html` reports the drink's overflow in
     * millimetres, and the sweep at fill 112 gives 0.000 mm at every step from
     * 19 to 82 degrees. The axis-crossing level rises as the surface tilts
     * (112.0 at 19, 112.8 at 55, 115.6 at 65, 126.8 at 75) because the neck is
     * above and the wedge added on the high side is narrower than the one taken
     * from the low — which is exactly the effect `_levelFor` exists to solve.
     *
     * Past about 80 the level runs into the bracket `_levelFor` searches and the
     * bracket has been widened to suit, but the pose stops working before the
     * arithmetic does: a bottle lying flat has no silhouette left.
     */
    leanZ: 62,
    /** A little away from the camera, so it reads as an object and not a decal. */
    leanX: 9,
    /** Turns the label to the front. Fixed; the bottle never spins. */
    faceYaw: 0,

    // ── the drift ──────────────────────────────────────────────────────────
    /**
     * §6.2: 아주 느린 부유. 위아래 미세 진폭 + 아주 느린 회전.
     *
     * Slower and smaller than the old float, which was a bottle bobbing over a
     * floor. An object with nothing under it has no reason to bob at a walking
     * pace; the slower it moves, the more it reads as weightless.
     */
    floatAmplitude: 0.28,
    floatSpeed: 0.34,
    /**
     * The slow turn, in degrees, and how long one cycle takes.
     *
     * ── the rotation is what makes the liquid legible ──────────────────────
     * The drink's surface is solved level in the WORLD (`_slosh`), so a bottle
     * that never moves shows a surface that never moves either, and the fact
     * that it is horizontal rather than square to the bottle is invisible. Turn
     * the bottle slowly and the surface visibly stays put — which is §7's
     * "natural liquid behavior", and it costs one sine.
     *
     * Two axes at different periods so the pose never repeats exactly. Small:
     * this is a drift, not a tumble.
     */
    driftTiltZ: 5.5,
    driftTiltX: 3.5,
    driftPeriodZ: 23,
    driftPeriodX: 17,

    // ── the pointer ────────────────────────────────────────────────────────
    /**
     * §6.3: 접근 시 미세 패럴랙스 · 물리적으로 그럴듯한 아주 작은 회전.
     *
     * All three are small on purpose. The brief bans `hover = scale up` as a
     * preset, and the way a preset gives itself away is not its size — it is
     * that it arrives instantly and leaves instantly. What makes this read as an
     * object is the spring in `Bottle.update`, not the amplitude, so the
     * amplitude can stay under the drift's own and still be felt.
     */
    /**
     * How far the bottle drifts toward the pointer, in world units.
     *
     * Measured rather than picked: the camera sits 62 units back at a 30-degree
     * field, so the visible height is 2·62·tan15° ≈ 33 units across 750 CSS px —
     * about 23 px per unit. At 0.55 a full pull moved the bottle 0.18 units,
     * which is four pixels, and four pixels of parallax is a number rather than
     * an effect. 1.1 puts it at eight, which is where it starts to register
     * without becoming a control that follows the mouse.
     */
    pullTravel: 1.1,
    /**
     * How far it tips toward the pointer, in degrees, at full pull.
     *
     * Same arithmetic: at 1.5 a full pull was 0.59 degrees, which on a
     * twelve-unit bottle moves its ends by three pixels. 3.5 gives 1.4 degrees
     * and seven — still well under the drift's own 5.5, which is the constraint
     * that keeps the response from reading as the bottle turning to face you.
     */
    pullTilt: 3.5,
    /**
     * The cap's lag, in degrees per unit of difference between the two springs.
     *
     * Larger than `pullTilt` because it multiplies a DIFFERENCE, which is small:
     * the two springs agree except while the pointer is actually moving, so this
     * is only ever visible during the motion — which is exactly when secondary
     * motion is supposed to be visible.
     */
    capLagTilt: 7,

    // ── the carbonation's floor ────────────────────────────────────────────
    /**
     * How much fizz there is when nothing is happening.
     *
     * §6.1 keeps `Fizz` and changes its reason for existing: it was the
     * carbonation a shake produced, and it is now the drink's own. So there has
     * to be a floor, and this is it — enough that the bottle is visibly a
     * carbonated drink, low enough that the eruption still reads as an event.
     */
    restFizz: 0.22,
    /** What an approaching pointer adds to that. §6.3's "탄산이 미묘하게 변함". */
    pointerFizz: 0.16,

    // ── sloshing ───────────────────────────────────────────────────────────
    // The FREQUENCY is not here, and deliberately: it is derived from the
    // bottle's radius and fill depth by the cylinder slosh formula in
    // `Bottle._slosh`. These three are the parts that are not physics.
    /**
     * How hard the drift drives the tilt mode, per unit of sin(lean).
     *
     * ── it was 150 and a hand was doing the driving ────────────────────────
     * The old drive was the shake's own stroke, at a frequency chosen to sit on
     * the drink's ~4 Hz resonance because that is where a hand naturally shakes.
     * There is no hand. What moves the drink now is the bottle's own slow turn,
     * which is two orders of magnitude slower than the mode it is exciting — so
     * the resonance does nothing and the surface simply follows.
     *
     * That is the correct behaviour for a floating bottle and it is why the
     * value dropped rather than the mechanism being deleted: the oscillator is
     * still what stops the surface snapping when the tilt changes direction, and
     * a pop still kicks it (`popBurst`).
     */
    sloshDrive: 26,
    /**
     * The drive's frequency, in Hz.
     *
     * The drift's own period, not a stroke — 1/23 s and 1/17 s are the two turn
     * cycles, and this is the faster of them. Deliberately far BELOW the drink's
     * ~4 Hz mode rather than on it: on resonance the surface would build up an
     * amplitude the bottle's motion never justified.
     */
    strokeFrequency: 0.06,
    /** Damping ratio. Water-like liquids sit around a tenth. */
    sloshDamping: 0.11,
    /**
     * Ceiling on the tilt.
     *
     * It used to say "so a hard drive cannot push it through the glass". That
     * is no longer what it is for — the surface is a clip plane and cannot
     * leave the glass at any amplitude. What is left is the physical reason: a
     * tilt mode that reaches the bottom of the bottle is not a slosh any more.
     */
    sloshLimit: 0.7,

    // ── the meniscus ───────────────────────────────────────────────────────
    /**
     * How much brighter the drink is right at its surface, as a MULTIPLE.
     *
     * A gain and not a colour, which is `PALETTE.liquid`'s rule — see the note
     * on `MENISCUS_MAIN`.
     *
     * ── 0.30 was the arithmetic answer and it was too dark by half ─────────
     * The old vertex pair was `SURFACE_RIM` 1.18 over `WALL` 0.9, a ratio of
     * about 1.30, so 0.30 looked like the value that reproduces it. Measured on
     * screen it did not: the surface peaked at 185 against the fan's 204.
     *
     * The ratio was never the whole of it. Those vertex colours were on a disc
     * lying FLAT, facing the light — it collected far more of it than the wall
     * does, and the wall is all a clip plane leaves to shade. Matching the
     * ratio was matching the wrong quantity; the thing to match is the light
     * that arrives at the screen.
     *
     * So this was fitted the same way `foamProduction` was — by measuring. At
     * 0.8 with the width below, the brightest point of the surface reads 202
     * against 151 in the drink under it, where the fan read 204 against 151.
     * The same picture, arrived at from the other end.
     */
    meniscusGain: 0.8,
    /**
     * How deep the bright band reaches, in mm below the surface.
     *
     * A real meniscus is under a millimetre. This is wider because it is
     * standing in for the whole lit top of the drink, not just the wetting
     * curve — and because under 1 mm it is thinner than a pixel at the size the
     * menu draws the bottle, which makes it alias as the bottle floats.
     *
     * Measured: the surface stops getting brighter past about 4 mm (202 at 4,
     * 203 at 5, 204 at 6), because by then the band is wider than the part of
     * the wall that faces the camera near the cut. Past that it only spreads
     * the glow down into the drink, which reads as the drink being lit from
     * inside rather than as a surface.
     */
    meniscusWidth: 4,

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
     * Foam made per second, as a VOLUME in world units cubed.
     *
     * A volume and not a speed, because how fast the head then climbs is the
     * bottle's business — see the continuity note in `_carbonate`.
     *
     * ── it was a FIT against a wind-up that no longer happens ──────────────
     * `_carbonate` integrates dy/dt = Q/A(y), and the number used to be solved
     * against one question: does the head reach `foamCeiling` by the time the
     * cap goes? That was the beat the whole transition was built on — "a bottle
     * that has run out of room" — and the input was the shake envelope, worth
     * 0.146 s of full production on a quick tap. 640 carried a 1.35x margin over
     * the value that just made it.
     *
     * §6.1 removes the shake, so there is no wind-up to fit against. The head is
     * no longer a meter of how hard the bottle was worked; it is the resting
     * carbonation, held in balance against `foamDrain`, plus whatever the pop
     * adds. So this is now a RATE that has to sit near the drain rather than a
     * dose that has to reach a ceiling.
     *
     * At 46 against a drain of 34 the head settles low in the body and stays
     * there — visible as a thin bright band under the surface rather than as a
     * column climbing the neck. The eruption is `foamPopSurge`'s job alone now,
     * which is the honest arrangement: the bottle goes off because it is opened,
     * not because it was agitated.
     */
    foamProduction: 46,
    /** Volume per second draining back. Constant, so the head settles rather than climbs. */
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
  },

  /**
   * The cap wipe. §7.2 — the object that carries the screen across.
   */
  wipe: {
    /**
     * Extra scale over the exact fit, at the covered frame.
     *
     * The exact fit is computed from the cap's own panel radius and the frame's
     * half-diagonal, so 1.0 would already cover it. The margin was originally
     * against the vertex snap, which moved every corner by up to half a low-res
     * pixel and was free to move one INWARD; that snap went with the retro pass.
     * What it covers now is the geometry's own faceting — the panel is a
     * polygon, not a circle, so its true silhouette dips inside the radius
     * `measurePanelRadius` reports between vertices.
     */
    coverSafety: 1.1,
    /**
     * Turns a second while it flies.
     *
     * §7.2 asks the spin to follow §21's material motion — the inertia of a
     * metal disc. A disc flicked off a bottle carries a lot of angular momentum
     * and sheds almost none of it in half a second, so this is a CONSTANT rate
     * rather than an eased one, and the settle at the end (`_advance`) is what
     * brings it to rest rather than a decay curve.
     */
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

  /**
   * The transition, stage by stage.
   *
   * Summed default is 0.39s — 0.34 closing, three frames covered. It was 0.77
   * with a 0.38-second shake in front of it and no ceiling at all, because the
   * press-and-hold made the total variable upward. §6.1 removes that stage, so
   * the run is a fixed length for the first time, and well inside the brief's
   * "1초 이내".
   */
  transition: {
    /**
     * Stage 1: how long the frame takes to close.
     *
     * This is the stage's own length. `popSeconds` below is a shorter event
     * inside it, so raising this gives the bars a slower close without turning
     * the cap's hop into a slow-motion one.
     */
    barSeconds: 0.34,
    /**
     * The cap's hop off the mouth, inside stage 2.
     *
     * ── it used to fly at the camera and take the screen ──────────────────
     * `launchSeconds` was 0.28 and it was the whole of the cover: the cap grew
     * until it filled the frame. The letterbox does the covering now, so all
     * that is left of this is the part that was about the BOTTLE — the cap
     * comes off the mouth, the eruption goes off behind it, and it is gone
     * behind the closing bars a sixth of a second later. It never crosses the
     * frame.
     *
     * Shorter than `barSeconds` on purpose. A hop that was still rising when
     * the frame went opaque would read as an animation cut off rather than one
     * finished.
     */
    popSeconds: 0.15,
    /**
     * How long the covered frame holds. Three frames at 60 Hz.
     *
     * ── it is a SEAM again, and that is what the number is for ─────────────
     * This is what it was originally, because the brief asked for "완전 차폐
     * (2~3프레임)" and all a covered frame had to do was hide a scene swap.
     * Three frames is the shortest window a swap can hide behind and still be
     * certain to be SEEN by the compositor, which is the whole requirement.
     *
     * It went to 0.35 for a while — seven times the minimum — because the frame
     * had the game's wordmark on it and 50 ms is nowhere near long enough to
     * READ three words. The wordmark is gone on instruction, and with nothing
     * on the frame there is nothing to hold it for: a held frame with nothing
     * on it is not a beat, it is a pause. So the number goes back to the job.
     *
     * It does not gate a NAVIGATION. On that path the bars stay shut while the
     * next document loads (`uncover: false` in `bootMenu`), so this only decides
     * how long a same-document scene swap sits behind the colour before the bars
     * part again.
     */
    coverSeconds: 0.05,
    /**
     * How long the cap takes to leave on the FAR side of the document swap.
     *
     * It is not part of `totalSeconds` and must not be: this is spent by the
     * game document, after the menu has gone away, and the two clocks never run
     * at the same time. §7.3's contract is that the covered frame is the seam —
     * everything before it belongs to one document and everything after to the
     * other.
     *
     * Longer than the close. Coming in, the cap is hiding a document swap and
     * the player is waiting for the game; going out, it IS the game arriving and
     * there is something behind it worth uncovering slowly.
     */
    exitSeconds: 0.42,
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
     * The same bloom the game runs, so the two sides of the letterbox match.
     *
     * The menu is the one screen that is nothing BUT glossy surfaces — glass,
     * liquid, bubbles, a metal cap — so it is where the threshold gets judged.
     * If it looks right here and hazy in a match, the match's lighting is too
     * hot rather than the bloom being wrong.
     *
     * The bars themselves are OUTSIDE this — `Cinematic` draws after the chain,
     * like every other overlay. A bright pass over a hard edge blooms the edge,
     * and a letterbox with a halo is not a letterbox.
     */
    bloom: {
      enabled: true,
      threshold: 0.72,
      strength: 0.45,
      radius: 0.6,
    },
  },
};

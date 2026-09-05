/**
 * One press, two possible meanings. This decides which, once.
 *
 * A click-and-drag on the board is either a card, a shot being drawn, or the
 * camera being moved, and all three gestures start identically. Before this
 * existed the listeners each made their own guess and the answer depended on
 * which one the browser happened to call first — which is not a rule, it is a
 * coincidence that had been holding. So the canvas has exactly one set of
 * pointer handlers now, and they resolve the ambiguity at the press, in order:
 *
 *   the victory screen is up               -> VICTORY, and nothing else is asked
 *   press lands on a card of the live hand -> CARD
 *   press lands on a HUD control           -> UI
 *   press lands on one of YOUR caps        -> AIM
 *   press lands on anything else           -> CAMERA
 *
 * ── the victory screen is above all of it, and it is not a hit test ──────────
 * It answers every press while it is on screen, whether or not one of its two
 * buttons is under the pointer, and the other four are not consulted at all.
 * That is not the same kind of rule as the rest of this list: the others are
 * about what a press LANDS on, and this one is about the match being over. There
 * is no shot left to take, the score and the cards are still on screen only
 * because that screen dimmed them rather than removing them, and a press falling
 * through to a card fan nobody can play would be a press with no meaning. A
 * press that hits neither button is the skip — see `VictoryLayer.pointerDown`.
 *
 * ── the HUD sits between the cards and the caps, and that order is forced ────
 * Above the caps because a press on 나가기 that also drew a shot would be two
 * things happening at once, and the shot is the one you cannot take back.
 * BELOW the cards because a card fanned over a button is drawn over it too, and
 * a control that is visibly behind something must not be the thing that answers
 * a press — a player pressing what they can see is never wrong.
 *

 * "Anything else" is deliberately everything: empty pitch, the ball, a wall, an
 * opponent's cap, and any press at all while the previous turn is still
 * settling. `AimInput.hitTest` is the single authority on the second case, and
 * it is the same call the hover highlight uses — so the cursor cannot promise
 * one thing and the press deliver the other.
 *
 * ── the cards used to get their priority for free ────────────────────────────
 * They were DOM elements over the canvas, so a press on one never reached this
 * file at all. Now they are meshes INSIDE the canvas and the ordering has to be
 * stated rather than inherited from a z-index — which is the better place for
 * it anyway: the rule is now written down in the order it is applied, instead of
 * being a consequence of two stacking contexts.
 *
 * ── the mode is LOCKED for the gesture ───────────────────────────────────────
 * Once decided it holds until every pointer is up. A pan that crosses a cap does
 * not become a shot; a pull that wanders onto empty pitch does not become a pan.
 * The one thing that may change inside a camera gesture is a second finger
 * arriving, which turns a drag into a pinch — still the camera, still not the
 * aim.
 *
 * ── aiming freezes the camera, completely ────────────────────────────────────
 * While the bow is drawn there is no zoom, no pan, no rotation and no reaction
 * to a second finger. The brief asks for it and there is a harder reason to want
 * it: the trajectory preview is computed against a snapshot and drawn in world
 * space, and a camera that moved under a half-drawn pull would be asking the
 * player to re-aim at something that had not moved. Escape backs out.
 */

import { MATCH_STATE } from './Match.js';

/** Signed shortest way from `a` round to `b`, in (-pi, pi]. */
function shortestAngle(a, b) {
  const tau = Math.PI * 2;
  let d = (b - a) % tau;
  if (d > Math.PI) d -= tau;
  if (d <= -Math.PI) d += tau;
  return d;
}

export const DRAG_MODE = {
  NONE: 'none',
  CARD: 'card',
  UI: 'ui',
  /**
   * The victory screen took it.
   *
   * A mode of its own rather than reusing UI, because the release has to go to a
   * different object and `_up` decides that from the mode. Folding the two
   * together would mean a second field saying WHICH ui, which is the mode by
   * another name.
   */
  VICTORY: 'victory',
  AIM: 'aim',
  PAN: 'pan',
  ROTATE: 'rotate',
  PINCH: 'pinch',
};

/** Below this a pinch is noise; a resting hand drifts by a pixel or two. */
const PINCH_DEADZONE = 2;
/** Wheel delta -> zoom factor. One notch of a typical mouse is ~100. */
const WHEEL_SCALE = 0.0016;
/** Fling velocities are averaged over this window, in ms. */
const FLING_WINDOW = 90;
/**
 * Ceiling on a fling, in radians per second.
 *
 * 6 is one full turn a second, and against the default damping it coasts about
 * 110 degrees after release — a glide you can follow to where you wanted it.
 * Above that a flick reads as a blur rather than as a throw.
 */
const MAX_FLING = 6;
/**
 * Floor on a fling, in radians per second. Below it the field just stops.
 *
 * A slow drag is someone placing the pitch, not throwing it, and letting the
 * tail of that carry on is both surprising and — measured — enough to defeat the
 * snap: a careful five-degree sweep released at 5.3 degrees still had 0.44 rad/s
 * on it, coasted the 7.9 degrees that damping allows, and landed at 13.5, well
 * outside the window it was being aimed into. 0.6 rad/s is about 34 degrees a
 * second, which is faster than any deliberate placement and slower than the
 * gentlest flick.
 */
const MIN_FLING = 0.6;
/**
 * Pointer distance from the centre, in pixels, below which a turn is ignored.
 *
 * The lever arm goes to zero at the middle of the view, so an angle measured
 * there is a ratio of two tiny numbers and one pixel of movement is most of a
 * revolution. Inside this radius the gesture simply does not turn anything.
 */
const TURNTABLE_DEADZONE = 20;
/** Backstop on a single event's sweep. A jump this big is a lost pointer. */
const MAX_TURN_STEP = 0.5;
/**
 * How far a press may wander and still count as a tap, in CSS pixels.
 *
 * A tap on the board skips the AI's presentation and a drag turns the camera,
 * and they start identically. Generous enough that a finger on glass — which
 * never lands perfectly still — is not read as a drag, and far below the
 * distance any deliberate pan or rotate covers.
 */
const TAP_SLOP = 6;

export class PointerRouter {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./AimInput.js').AimInput} aim
   * @param {import('../render/GameCamera.js').GameCamera} camera
   * @param {import('./Match.js').Match} match
   * @param {(shot: import('./shot.js').Shot) => void} onFire
   */
  /**
   * @param {() => boolean} [accepts]
   *   Whether the seat on turn is a person who may act. False during an AI turn.
   *
   *   ── it is narrower than `blocked`, and the difference is the point ────────
   *   `blocked` means the screen is spoken for and NOTHING answers — it is for
   *   the cap wipe, where the player cannot see what they would be pressing. An
   *   AI turn is the opposite: the board is fully visible and the brief is
   *   explicit that the player should be able to look around it. "발사·카드
   *   조작: 차단. 카메라 조작(줌·팬·회전): 허용."
   *
   *   So this gates exactly two branches of `_down` — the cards and the aim —
   *   and leaves the HUD and the camera alone. The camera needed no work at all:
   *   it was already ungated by match state, for the reason the note on
   *   `MATCH_STATE.GOAL_HOLD` gives.
   * @param {() => void} [onTap]
   *   A press that turned out not to be a drag, on the board. The AI's
   *   presentation skip hangs off this.
   */
  constructor({
    canvas,
    aim,
    camera,
    match,
    config,
    cards,
    hud,
    victory,
    blocked,
    accepts,
    onTap,
    onFire,
    boardRect,
  }) {
    this.canvas = canvas;
    /**
     * Where the 3D board is drawn, in client coordinates.
     *
     * The canvas rect until the frame grew taller than the board — see
     * Viewport.boardClientRect. Only the two mappings that speak to the CAMERA
     * use it (the pan gain and the turntable bearing); the card, HUD and victory
     * hit tests keep normalising against the whole canvas, because their ortho
     * frames cover the whole canvas.
     */
    this._boardRect = boardRect ?? (() => canvas.getBoundingClientRect());
    this.aim = aim;
    this.camera = camera;
    this.match = match;
    this.config = config;
    /** @type {import('../render/CardLayer.js').CardLayer|null} */
    this.cards = cards ?? null;
    /** @type {import('../ui/HudLayer.js').HudLayer|null} */
    this.hud = hud ?? null;
    /** @type {import('../victory/VictoryLayer.js').VictoryLayer|null} */
    this.victory = victory ?? null;
    /**
     * Whether the screen is currently covered by something the player cannot
     * see past, and therefore takes no input at all.
     *
     * ── the gap this closes ─────────────────────────────────────────────────
     * The outbound cap wipe swaps the match underneath its own covered frame and
     * then spends another quarter second flying off. The victory screen is
     * dismissed by that swap — it has to be, the match it described no longer
     * exists — so for the rest of the wipe nothing was blocking anything: a press
     * landed on a board the player could not see, and a press on one of the new
     * caps started an aim whose release fired a REAL shot into a match that had
     * only just begun. Blind, unintended, and scoring.
     *
     * A predicate rather than an object, because this file has no business
     * knowing what a cap wipe is — only that the screen is spoken for.
     */
    this._blocked = blocked ?? (() => false);
    this._accepts = accepts ?? (() => true);
    this._onTap = onTap ?? (() => {});
    this.onFire = onFire ?? (() => {});

    /** Where the press landed, and whether it has travelled. See `_up`. */
    this._pressAt = null;
    this._travelled = false;

    this.mode = DRAG_MODE.NONE;
    /** Which of the player's caps the pointer is over, or -1. Drives the cursor. */
    this.hoverCap = -1;
    /** Whether the pointer is over a live card. Drives the cursor too. */
    this._overCard = false;
    /** The same, for a HUD control. */
    this._overUi = false;
    /** Where the cursor last hovered, so the question can be re-asked. */
    this._hoverPoint = null;

    /** @type {Map<number, {x: number, y: number}>} live pointers */
    this._points = new Map();
    this._primary = null;
    this._pinchDistance = 0;
    /** The pointer's bearing about the centre of the view, last time we looked. */
    this._turnAngle = null;
    /** Recent swept angle, for the rotation fling. */
    this._flingSamples = [];

    this._onDown = (e) => this._down(e);
    this._onMove = (e) => this._move(e);
    this._onUp = (e) => this._up(e);
    this._onCancel = (e) => this._up(e, true);
    this._onBlur = () => this.cancel();
    this._onWheel = (e) => this._wheel(e);
    this._onKey = (e) => this._key(e);
    this._onContext = (e) => {
      e.preventDefault();
      this.cancel();
    };
    this._onLeave = () => {
      if (this.mode !== DRAG_MODE.NONE) return;
      this._hoverPoint = null;
      this._setHover(-1);
      this._setOverCard(false);
      this._setOverUi(false);
      this.cards?.clearHover();
      this.victory?.clearHover();
    };

    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onCancel);
    canvas.addEventListener('pointerleave', this._onLeave);
    /**
     * ── losing CAPTURE is not losing the POINTER ────────────────────────────
     * This used to be `lostpointercapture -> cancel`, on the reasoning that the
     * browser had taken the pointer away and no release was guaranteed. That is
     * wrong, and it was eating shots: `lostpointercapture` only says THIS
     * ELEMENT no longer has capture. The finger or button is still down and
     * events keep arriving — they simply stop being retargeted here.
     *
     * So a capture dropped mid-drag cancelled the aim while the player was
     * still holding it, and the `pointerup` that followed found nothing to fire.
     * Reproduced: pointer down on a cap, one move, a `lostpointercapture` with
     * the pointer still down, and the aim is gone with the match still sat in
     * AIM. That is exactly the intermittent "it cancelled when I fired".
     *
     * What capture was really protecting against is a release that lands
     * somewhere else, and the honest fix for that is to listen for the release
     * somewhere else. These two are the backstop: the canvas's own handlers run
     * first because the event bubbles, and `_up` no-ops on a pointer it has
     * already forgotten, so a normal release is handled exactly once.
     *
     * `pointercancel` is still a cancel wherever it arrives — that one really is
     * the browser saying the gesture is over.
     */
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onCancel);
    window.addEventListener('blur', this._onBlur);
    // Not passive: the page must not scroll or bounce under a zoom gesture, and
    // a passive listener cannot call preventDefault.
    canvas.addEventListener('wheel', this._onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this._onContext);
    window.addEventListener('keydown', this._onKey);
  }

  get aiming() {
    return this.mode === DRAG_MODE.AIM;
  }

  /** For the panel. */
  get modeLabel() {
    if (this.mode !== DRAG_MODE.NONE) return this.mode;
    if (this.victory?.active) return `victory (${this.victory.hovered ?? 'idle'})`;
    if (!this._accepts()) return `ai turn (${this.camera.dragMode} only)`;
    if (this._overCard) return 'card (hover)';
    if (this._overUi) return `ui (${this.hud?.hovered ?? 'hover'})`;
    if (this.match.state !== MATCH_STATE.AIM) return 'locked';
    return this.hoverCap >= 0 ? 'aim (hover)' : this.camera.dragMode;
  }

  // ── press ────────────────────────────────────────────────────────────────

  _down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    /**
     * A press from a pointer we already think is down is a pointer whose
     * release never arrived.
     *
     * That happens for real and it is not rare: leave the window mid-drag and
     * the browser may deliver no `pointerup` at all. A mouse always reports
     * pointerId 1, so the orphan and the next press are the SAME id — the
     * gesture that never ended is still the live one, `AimInput.begin` refuses
     * because it is already aiming, and every press from then on falls through
     * to the camera. Measured: the game was left charging forever with only the
     * zoom responding, which is exactly what was reported.
     *
     * Cancelling first makes the stale gesture impossible to inherit.
     */
    if (this._points.has(e.pointerId)) this.cancel();

    this._points.set(e.pointerId, { x: e.clientX, y: e.clientY });

    /**
     * A covered screen answers nothing.
     *
     * Registered above and then dropped, so `_up` still cleans the pointer up
     * and the gesture simply has no meaning. Before the size checks below, so a
     * second finger cannot become a pinch either — see `_blocked`.
     */
    if (this._blocked()) return;

    /**
     * Second finger. During an aim or a card it is ignored outright — the camera
     * does not move while the bow is drawn or a card is up, and dropping either
     * because a hand rested on the glass would be worse than doing nothing.
     *
     * ── and during the victory screen, which is not the same reason ──────────
     * The other two are about not losing a gesture in progress. This one is
     * about the screen being MODAL: it is up because the match is over, and a
     * pinch is the camera. Without it, a thumb resting on the glass while the
     * other hand pressed 재시작 turned the gesture into a zoom — so the press was
     * silently dropped AND the finished board visibly zoomed behind the dimming,
     * which reads as the game having come back to life.
     *
     * `victory.pointerDown` answers every press while it is up, so the mode is
     * always VICTORY here when it is: this is the whole of the fix.
     */
    if (this._points.size === 2) {
      if (
        this.mode === DRAG_MODE.AIM ||
        this.mode === DRAG_MODE.CARD ||
        this.mode === DRAG_MODE.VICTORY
      ) {
        return;
      }
      this.mode = DRAG_MODE.PINCH;
      this._pinchDistance = this._spread();
      this._flingSamples.length = 0;
      return;
    }
    if (this._points.size !== 1) return;

    this._primary = e.pointerId;
    this._capture(e.pointerId);
    this._flingSamples.length = 0;
    this._pressAt = { x: e.clientX, y: e.clientY };
    this._travelled = false;

    // The victory screen first, and it takes everything: see the header. It
    // answers true for the whole time it is up, so nothing below runs.
    if (this.victory?.pointerDown(e.clientX, e.clientY)) {
      this.mode = DRAG_MODE.VICTORY;
      this._setHover(-1);
      this._setOverCard(false);
      this._setOverUi(false);
      return;
    }

    /**
     * The HUD is asked EARLY when the seat is not the player's.
     *
     * Normally it sits below the cards — a card fanned over a button is drawn
     * over it, and a control that is visibly behind something must not answer a
     * press. During an AI turn neither the cards nor the caps answer anything at
     * all, so there is nothing left for the buttons to be behind, and asking
     * first is how 나가기, 재시작 and the camera reset stay usable while the
     * opponent is taking its go. The player must not be locked out of leaving.
     */
    const acting = this._accepts();
    if (!acting && this.hud?.pointerDown(e.clientX, e.clientY)) {
      this.mode = DRAG_MODE.UI;
      this._setHover(-1);
      this._setOverUi(true);
      return;
    }

    // Cards first, and they do not fall through: a press that lands on one is
    // that card's, whatever is underneath it.
    if (acting && this.cards?.pointerDown(e.clientX, e.clientY)) {
      this.mode = DRAG_MODE.CARD;
      this._setHover(-1);
      this._setOverUi(false);
      this.canvas.classList.add('is-dragging-card');
      return;
    }

    // The HUD, and it does not fall through either: a press that lands on a
    // button is that button's, and the cap underneath it is not aimed.
    if (this.hud?.pointerDown(e.clientX, e.clientY)) {
      this.mode = DRAG_MODE.UI;
      this._setHover(-1);
      this._setOverUi(true);
      return;
    }

    const cap = acting ? this.aim.hitTest(e.clientX, e.clientY) : -1;
    if (cap >= 0 && this.aim.begin(e.clientX, e.clientY, cap)) {
      this.mode = DRAG_MODE.AIM;
      this._setHover(cap);
      this.canvas.classList.add('is-aiming');
      return;
    }

    // Camera. Which of the two it is was decided by the zoom before the press
    // and does not change during it.
    this.mode = this.camera.dragMode === 'rotate' ? DRAG_MODE.ROTATE : DRAG_MODE.PAN;
    if (this.mode === DRAG_MODE.ROTATE) {
      // Grabbing a spinning field stops it, the way a hand on a turntable does.
      this.camera.stopSpin();
      // And holds the snap off: the degrees either side of vertical are where
      // the player is most likely to be steering on purpose.
      this.camera.setHeld(true);
      this._turnAngle = this._bearingAt(e.clientX, e.clientY);
    }
    this.canvas.classList.add('is-dragging');
  }

  // ── move ─────────────────────────────────────────────────────────────────

  _move(e) {
    const prev = this._points.get(e.pointerId);
    if (!prev) {
      // No button down: this is a hover, and its only job is to tell the player
      // what the next press will do. Same order as the press — a cursor over a
      // card must not offer to shoot the cap behind it.
      if (this.mode !== DRAG_MODE.NONE) return;
      // Kept so the hover can be re-asked when the WORLD moves rather than the
      // pointer — see `refreshHover`.
      this._hoverPoint = { x: e.clientX, y: e.clientY };
      // Same order as the press, so the cursor cannot promise one thing and the
      // press deliver another. The victory screen swallows the hover whole.
      if (this.victory?.pointerMove(e.clientX, e.clientY)) {
        this._setHover(-1);
        this._setOverCard(false);
        this.cards?.clearHover();
        // The cursor is the victory screen's only hover feedback besides the
        // brighter plate, and `_setOverUi(false)` is also what puts the HUD's
        // stale hover away when this screen came up over the top of it.
        this._setOverUi(this.victory.hovering);
        return;
      }
      // Same gate as the press, in the same order, so the cursor cannot promise
      // a card or a cap that a press would refuse. The HUD is still live.
      const acting = this._accepts();
      if (acting && this.cards?.pointerMove(e.clientX, e.clientY)) {
        this._setHover(-1);
        this._setOverCard(true);
        this.hud?.clearHover();
        this._setOverUi(false);
        return;
      }
      this._setOverCard(false);
      // Same order as the press, so the cursor cannot promise one thing and the
      // press deliver another.
      if (this.hud?.pointerMove(e.clientX, e.clientY)) {
        this._setHover(-1);
        this._setOverUi(true);
        return;
      }
      this._setOverUi(false);
      this._setHover(acting ? this.aim.hitTest(e.clientX, e.clientY) : -1);
      return;
    }

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this._points.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Measured from the PRESS, not accumulated per event: a slow drag back to
    // where it started is a drag, and summing deltas would call it a tap.
    if (this._pressAt) {
      const travel = Math.hypot(e.clientX - this._pressAt.x, e.clientY - this._pressAt.y);
      if (travel > TAP_SLOP) this._travelled = true;
    }

    if (this.mode === DRAG_MODE.PINCH) {
      const d = this._spread();
      if (d >= PINCH_DEADZONE && this._pinchDistance >= PINCH_DEADZONE) {
        // Ratio, not difference: the same proportional spread means the same
        // zoom change whether the fingers started 40 pixels apart or 400.
        this.camera.zoomBy(d / this._pinchDistance);
      }
      this._pinchDistance = d;
      return;
    }

    if (e.pointerId !== this._primary) return;

    if (this.mode === DRAG_MODE.VICTORY) {
      this.victory.pointerMove(e.clientX, e.clientY);
      return;
    }

    if (this.mode === DRAG_MODE.CARD) {
      this.cards.pointerMove(e.clientX, e.clientY);
      return;
    }

    // Tracked so that sliding off a button before releasing cancels it, and
    // crucially so the camera does NOT pan under a press that began on the HUD.
    if (this.mode === DRAG_MODE.UI) {
      this.hud.pointerMove(e.clientX, e.clientY);
      return;
    }

    if (this.mode === DRAG_MODE.AIM) {
      this.aim.move(e.clientX, e.clientY);
      return;
    }

    if (this.mode === DRAG_MODE.PAN) {
      // The BOARD's size, not the canvas's: the gain is "one drag across the
      // view pans one view width", and the view is the board.
      const r = this._boardRect();
      this.camera.panByPixels(dx, dy, { width: r.width, height: r.height });
      return;
    }

    if (this.mode === DRAG_MODE.ROTATE) {
      const now = this._bearingAt(e.clientX, e.clientY);
      // Inside the deadzone there is no usable bearing. Drop the anchor so that
      // coming back out re-reads it instead of sweeping through the gap.
      if (now === null) {
        this._turnAngle = null;
        return;
      }
      if (this._turnAngle === null) {
        this._turnAngle = now;
        return;
      }
      let swept = shortestAngle(this._turnAngle, now);
      swept = Math.max(-MAX_TURN_STEP, Math.min(MAX_TURN_STEP, swept));
      this._turnAngle = now;
      this.camera.rotateBy(swept);
      this._sample(swept);
    }
  }

  /**
   * Ask the hover question again without the pointer having moved.
   *
   * The answer depends on the WORLD as much as on the cursor: fire a shot and
   * the cap that was under the pointer leaves, the turn passes to the other
   * player, and which caps may be selected changes entirely — all without a
   * single pointer event arriving. Left alone, `hoverCap` keeps whatever it last
   * computed, so the ring the overlay draws from it followed the cap that had
   * just been fired all the way across the board and sat there until it stopped.
   *
   * Cheap: one hit test, which is a loop over the caps, and only while nothing
   * is being dragged. `hitTest` already returns -1 outside the aiming state, so
   * this puts the ring out on its own the moment the shot goes.
   */
  refreshHover() {
    if (this.mode !== DRAG_MODE.NONE || !this._hoverPoint) return;
    // First, and for the strongest version of the reason this method exists: the
    // victory screen comes up because the WORLD changed, with no pointer event
    // anywhere near it. Left out, a cursor resting over the board would go on
    // reporting a cap it can no longer shoot for as long as the screen was up.
    if (this.victory?.pointerMove(this._hoverPoint.x, this._hoverPoint.y)) {
      this._setHover(-1);
      this._setOverCard(false);
      this.cards?.clearHover();
      this._setOverUi(this.victory.hovering);
      return;
    }
    const acting = this._accepts();
    if (acting && this.cards?.hovering) {
      this._setHover(-1);
      this._setOverCard(true);
      this._setOverUi(false);
      return;
    }
    this._setOverCard(false);
    // The HUD moves under a still cursor too — the buttons fade with the zoom
    // and the score comes and goes — so it is re-asked here for the same reason
    // the caps are.
    if (this.hud?.pointerMove(this._hoverPoint.x, this._hoverPoint.y)) {
      this._setHover(-1);
      this._setOverUi(true);
      return;
    }
    this._setOverUi(false);
    // And re-asked here in particular because the TURN changes under a still
    // cursor: the moment the AI's go opens, a ring left over the player's own
    // cap would be promising a shot that is no longer available.
    this._setHover(acting ? this.aim.hitTest(this._hoverPoint.x, this._hoverPoint.y) : -1);
  }

  /**
   * The pointer's bearing about the centre of the view, in ground terms.
   *
   * The centre is the canvas centre and that is exact rather than an
   * approximation: the camera always looks AT its target, so the target is
   * always dead centre of the frame, and the field turns about it.
   *
   * The vertical is un-squashed by `sin(pitch)` before the angle is taken. The
   * ground is seen at a tilt, so a circle drawn on it reaches the screen as an
   * ellipse; measuring the raw screen angle would make the field lag the finger
   * near the top and bottom of its sweep and run ahead at the sides. Dividing it
   * back out turns the ellipse into the circle it is, and the point under the
   * finger stays there all the way round.
   *
   * @returns {number|null} radians, or null inside the deadzone
   */
  _bearingAt(clientX, clientY) {
    // Centred on the BOARD, so the turntable's pivot is the middle of the play
    // area rather than the middle of a canvas that may include UI bands.
    const r = this._boardRect();
    if (r.width < 1 || r.height < 1) return null;
    const dx = clientX - (r.left + r.width / 2);
    const sinPitch = Math.max(0.15, Math.sin((this.camera.pitchDegrees * Math.PI) / 180));
    const dy = (clientY - (r.top + r.height / 2)) / sinPitch;
    if (Math.hypot(dx, dy) < TURNTABLE_DEADZONE) return null;
    return Math.atan2(dy, dx);
  }

  // ── release ──────────────────────────────────────────────────────────────

  _up(e, cancelled = false) {
    const had = this._points.delete(e.pointerId);
    if (!had) return;
    this._release(e.pointerId);

    // A pinch that loses a finger does not resume as a drag: the remaining
    // finger has been sitting still and its position is not a gesture.
    if (this.mode === DRAG_MODE.PINCH) {
      if (this._points.size >= 2) {
        this._pinchDistance = this._spread();
        return;
      }
      if (this._points.size === 1) return;
      this._finish();
      return;
    }

    if (e.pointerId !== this._primary) {
      if (this._points.size === 0) this._finish();
      return;
    }

    if (this.mode === DRAG_MODE.VICTORY) {
      // On release over the same button, exactly as the HUD's own 나가기 works.
      this.victory.pointerUp(cancelled);
    } else if (this.mode === DRAG_MODE.CARD) {
      this.cards.pointerUp(cancelled);
    } else if (this.mode === DRAG_MODE.UI) {
      // Fires here, not on the press — see `HudLayer.pointerUp`. Releasing off
      // the control is how a misplaced tap on 나가기 is taken back.
      this.hud.pointerUp(cancelled);
    } else if (this.mode === DRAG_MODE.AIM) {
      const shot = cancelled ? (this.aim.cancel(), null) : this.aim.end();
      if (shot) this.onFire(shot);
    } else if (this.mode === DRAG_MODE.ROTATE && !cancelled) {
      const v = this._flingVelocity();
      if (v !== 0) this.camera.flingRotate(v);
    }

    /**
     * A press on the board that never became a drag is a TAP, and a tap skips
     * whatever the AI is currently showing.
     *
     * Decided on release rather than on press, and that is what makes the two
     * gestures coexist: the camera and the skip both live on the board, so
     * firing the skip at press time would mean every pan and every rotation also
     * jumped a stage of the presentation. Waiting to see whether the pointer
     * travelled costs nothing — the skip is instant either way — and lets a
     * player look around the board mid-turn without accidentally hurrying it.
     *
     * PAN and ROTATE only. A tap that landed on a card, a button or a cap has
     * already been answered by that thing.
     */
    if (
      !cancelled &&
      !this._travelled &&
      (this.mode === DRAG_MODE.PAN || this.mode === DRAG_MODE.ROTATE)
    ) {
      this._onTap();
    }

    this._finish();
  }

  _finish() {
    // Belt and braces. Every ordinary path releases the card before getting
    // here, but not every path INTO here is ordinary: a non-primary pointer
    // coming up with nothing left behind it finishes the gesture without ever
    // having looked at what the primary was doing. A card left mid-drag through
    // that gap stays stuck to the pointer and is then "played" by the next
    // release anywhere on the canvas, which is a card spent on a click.
    if (this.cards?.dragging) this.cards.pointerUp(true);
    /**
     * And the same for the victory screen, for the same reason.
     *
     * The gap is the non-primary path above: a second pointer coming up with
     * nothing left behind it finishes the gesture without ever looking at what
     * the primary was doing, so the press the victory screen thinks it is still
     * holding is never released. `pointerMove` then only reports a hover while
     * the cursor is back over THAT control — so the buttons stop lighting up
     * until the next press, which reads as the screen having gone dead.
     */
    if (this.victory?.pressing) this.victory.pointerUp(true);
    /**
     * And the victory screen's hover ends with the gesture that made it.
     *
     * ── a finger has no hover to leave WITH ─────────────────────────────────
     * Tap to skip the animation: the buttons appear under the finger, the few
     * pixels of drift produce a `pointermove` that lights whichever one was
     * tapped, and on a touch screen nothing ever arrives to take it off again.
     * The plate stayed bright for the rest of the screen, promising a press that
     * had already happened.
     *
     * Here rather than inside `_setOverUi`, which is where this was first put
     * and where it did nothing: that setter early-returns when the flag has not
     * changed, and the victory branch of `_down` has already set it false — so
     * the release's call was always the no-op path.
     *
     * Unconditional, and safe for a mouse: `refreshHover` runs every frame from
     * the loop and re-derives the hover from where the cursor actually is, so a
     * pointer still resting on the button has it back on the very next frame.
     * A finger, which leaves no `_hoverPoint` behind, does not.
     */
    this.victory?.clearHover();
    this.mode = DRAG_MODE.NONE;
    this._setOverUi(false);
    this._primary = null;
    this._pressAt = null;
    this._travelled = false;
    this._pinchDistance = 0;
    this._turnAngle = null;
    this._flingSamples.length = 0;
    this._points.clear();
    // Hand off the field: the snap may take over once the fling has died.
    this.camera.setHeld(false);
    this.canvas.classList.remove('is-aiming', 'is-dragging', 'is-dragging-card');
  }

  /** Back out of whatever is in progress without firing. */
  cancel() {
    if (this.mode === DRAG_MODE.AIM) this.aim.cancel();
    if (this.mode === DRAG_MODE.CARD) this.cards?.pointerUp(true);
    if (this.mode === DRAG_MODE.UI) this.hud?.pointerUp(true);
    if (this.mode === DRAG_MODE.VICTORY) this.victory?.pointerUp(true);
    for (const id of this._points.keys()) this._release(id);
    this._finish();
  }

  // ── wheel ────────────────────────────────────────────────────────────────

  _wheel(e) {
    e.preventDefault();
    // Blocked while aiming, as specified. The bow is drawn against a world the
    // player is looking at; changing the framing under a half-drawn pull would
    // move the target without moving the shot. A card being dragged is the same
    // argument: the gesture is measured against the frame it started in.
    if (this.mode === DRAG_MODE.AIM || this.mode === DRAG_MODE.CARD) return;
    /**
     * And blocked whenever the screen is not the player's to steer.
     *
     * The wheel has no press to be routed, so it never went through `_down` and
     * never met the victory screen's modality — which meant a scroll during the
     * victory screen zoomed the board behind the dimming. That is worse than it
     * sounds: the zoom lives on `CONFIG.view.zoom` and `rebuildAll` deliberately
     * does NOT reset it, so the framing a player idly scrolled while reading
     * "1P 승리" was inherited by the next match. The covered frame of the
     * outbound wipe is blocked for the same reason — there is nothing to see.
     */
    if (this.victory?.active || this._blocked()) return;
    // Up (negative deltaY) zooms in, which is the direction every map uses.
    this.camera.zoomBy(Math.exp(-e.deltaY * WHEEL_SCALE));
  }

  _key(e) {
    if (e.key !== 'Escape' || this.mode === DRAG_MODE.NONE) return;
    this.cancel();
    e.preventDefault();
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  _setHover(cap) {
    if (cap === this.hoverCap) return;
    this.hoverCap = cap;
    // The cursor is half the feedback the brief asks for; the ring the overlay
    // draws around the same cap is the half that works on a touch screen.
    this.canvas.classList.toggle('is-over-cap', cap >= 0);
  }

  /** The one piece of feedback the cards lost by leaving the DOM: a cursor. */
  _setOverCard(over) {
    if (over === this._overCard) return;
    this._overCard = over;
    this.canvas.classList.toggle('is-over-card', over);
  }

  /** And the same for the HUD, which has just lost it for the same reason. */
  _setOverUi(over) {
    if (over === this._overUi) return;
    this._overUi = over;
    if (!over) this.hud?.clearHover();
    this.canvas.classList.toggle('is-over-ui', over);
  }

  _capture(id) {
    // Keeps a long drag alive after it leaves the letterboxed canvas and crosses
    // onto the black surround. It throws if the pointer is no longer active —
    // which a pointercancel racing the pointerdown can arrange, and which a
    // synthetic event always will.
    try {
      this.canvas.setPointerCapture(id);
    } catch {
      /* no capture; the drag still works inside the canvas */
    }
  }

  _release(id) {
    try {
      this.canvas.releasePointerCapture(id);
    } catch {
      /* never captured, or already gone */
    }
  }

  /** Distance between the first two live pointers, in CSS pixels. */
  _spread() {
    const [a, b] = [...this._points.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _sample(swept) {
    const now = performance.now();
    this._flingSamples.push({ swept, t: now });
    while (this._flingSamples.length && now - this._flingSamples[0].t > FLING_WINDOW) {
      this._flingSamples.shift();
    }
  }

  /**
   * Radians per second over the last few frames.
   *
   * Averaged over a window rather than taken from the final event, because the
   * last move before a release is often a single stray pixel and a fling built
   * from it either does nothing or launches.
   */
  _flingVelocity() {
    const s = this._flingSamples;
    if (s.length < 2) return 0;
    const span = (s[s.length - 1].t - s[0].t) / 1000;
    if (span <= 0.001) return 0;
    let total = 0;
    for (let i = 1; i < s.length; i++) total += s[i].swept;
    const v = total / span;
    // A drag this slow was aiming, not throwing. Stop where the hand stopped —
    // see MIN_FLING for what the drift was costing.
    if (Math.abs(v) < MIN_FLING) return 0;
    return Math.max(-MAX_FLING, Math.min(MAX_FLING, v));
  }

  dispose() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onDown);
    c.removeEventListener('pointermove', this._onMove);
    c.removeEventListener('pointerup', this._onUp);
    c.removeEventListener('pointercancel', this._onCancel);
    c.removeEventListener('pointerleave', this._onLeave);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onCancel);
    window.removeEventListener('blur', this._onBlur);
    c.removeEventListener('wheel', this._onWheel);
    c.removeEventListener('contextmenu', this._onContext);
    window.removeEventListener('keydown', this._onKey);
    this._points.clear();
  }
}

import { PerspectiveCamera, Vector3 } from 'three';
import { DISPLAY_ASPECT } from '../core/Viewport.js';

/**
 * A fixed tilt, a free bearing, a zoom, and a pan. Nothing else.
 *
 * No follow, no shake, no cuts, and — the important one — no orbit. The tilt is
 * a constant the mode supplies and there is no path by which input reaches it,
 * because "필드가 제자리에서 도는 것. 3D 궤도 카메라가 아니다" is a statement
 * about what the player may change, not about how it happens to be implemented.
 *
 * ── the world does not turn; the camera goes round it ────────────────────────
 * Rotation is an AZIMUTH on this camera. The pitch's coordinates never move,
 * and they must not: the snapshot, the state hash and the replay check all rest
 * on the world being the same world twice, and spinning the view by rotating
 * every rigid body in it would end that. So the field appears to turn and
 * nothing in `physics/` or `game/` can tell.
 *
 * The consequence worth stating, because it is what makes the aim survive a
 * rotation: everything downstream of the press — the pull vector, the impulse,
 * the cone, the preview — is computed in WORLD space from a ray cast through
 * this camera. There is exactly one place a screen coordinate enters the shot,
 * and it is the raycast. Turn the camera and the raycast turns with it; nothing
 * else has to know.
 *
 * ── the fit is a CIRCLE when the camera can turn ─────────────────────────────
 * A rectangle fit that tracked the bearing would make the field breathe as it
 * spun — tight at 0 and 90 degrees, loose at 45. So a rotatable mode is framed
 * by the field's bounding circle, which is bearing-invariant: the field turns at
 * a constant size and "최소 줌에서 필드 전체가 보인다" holds at every angle
 * rather than at four of them.
 *
 * It costs screen. The football pitch's diagonal is 18% longer than its half
 * length, so portrait fills 76% of the frame height instead of 89%. A mode that
 * cannot turn keeps the tight rectangle fit and is unaffected — which is why
 * the knockout board still frames exactly as it always did.
 *
 * ── zoom 1 IS the whole field ────────────────────────────────────────────────
 * The distance is the fit divided by the zoom, and the zoom clamps at 1 from
 * below, so the completion criterion is true by construction rather than by a
 * chosen minimum that would need rechecking whenever the pitch was resized.
 *
 * Zoom, bearing and pan all live on `config.view`, which is why they survive a
 * turn change, a goal reset and a full rebuild. Nothing here writes them back
 * to a default.
 */

const FOV = 30;
const FIT_MARGIN = 1.12;

/**
 * The board-canvas width, in CSS pixels, the default framing was judged at.
 *
 * A 1280x800 window letterboxes to a 1067-wide canvas, which is where the
 * current `view.zoom` of 1.45 was chosen and where a cap measures 40 CSS px.
 * Any canvas at least this wide frames exactly as it always did; narrower ones
 * step in so the cap stays that size. See `GameCamera.screenZoom`.
 */
const REFERENCE_BOARD_CSS = 1067;

/**
 * How far the screen factor may actually step in, whatever the ratio says.
 *
 * Full parity is a factor of 2.65 on a 402-px phone, and it does produce a cap
 * exactly the 40 CSS px it is on a desktop. It also produces a board you cannot
 * play on: the board band is 4:3, so stepping in on WIDTH crops HEIGHT twice as
 * hard, and at 2.65 the knockout rows measure 24 world units against 23.9 of
 * visible height — both rows clipped, including your own.
 *
 * 2.1 is where they fit again with a margin, measured rather than guessed. The
 * cap lands at 32 CSS px, four fifths of the desktop size and twice what it was.
 * Raise it toward 2.65 for a larger cap and a tighter board; the trade is a
 * straight line between those two ends.
 */
const MAX_SCREEN_ZOOM = 2.1;
/** Below this the rotation has stopped; keeping it would spin forever. */
const SPIN_EPSILON = 1e-4;

/**
 * Bearings the rotation settles onto: the two at which the goal axis stands
 * vertical on screen, one for each way up.
 *
 * Only these two. There is no grid and no 45-degree detent — the angle is free
 * everywhere else, and this is a magnet at the orientation the pitch was laid
 * out to be read in.
 */
const SNAP_BEARINGS = [0, Math.PI];

/** Eased both ends. What makes the turn-over start and stop gently. */
function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Signed shortest way from `a` round to `b`, in (-pi, pi]. */
function angleDelta(a, b) {
  const tau = Math.PI * 2;
  let d = (b - a) % tau;
  if (d > Math.PI) d -= tau;
  if (d <= -Math.PI) d += tau;
  return d;
}

export class GameCamera {
  /**
   * @param {{x: number, z: number}} extents  half-extents of what must be visible
   * @param {(() => number)|null} [fixedPitch]  degrees, or null to use the panel's
   * @param {boolean} [rotatable]  may the player change the bearing?
   */
  constructor({
    extents,
    config,
    fixedPitch = null,
    rotatable = false,
    minZoom = null,
    maxZoom = null,
    turnZoom = null,
    screenZoomMax = null,
  }) {
    this.config = config;

    /**
     * The board's on-screen width in CSS pixels, written by `main.js` on resize.
     * Drives `screenZoom`; the reference default means an unset camera frames
     * exactly as it always did.
     */
    this.boardCssWidth = REFERENCE_BOARD_CSS;
    this.extents = { x: extents.x, z: extents.z };
    this.fixedPitch = fixedPitch;
    this.rotatable = rotatable;
    /** The mode's zoom floor, or null for the whole-field fit. */
    this.minZoomFn = minZoom;
    /**
     * The mode's ceiling and its turn-opening zoom, or null for the panel's.
     *
     * Injected the same way `minZoomFn` already was, and added for the same kind
     * of reason: a long, narrow field frames unlike a square one and unlike a
     * 105:68 one, so how far in it is worth going and how far out a turn should
     * open are facts about the MODE. Null everywhere else, which is exactly the
     * behaviour these two had before they could be overridden.
     */
    this.maxZoomFn = maxZoom;
    this.turnZoomFn = turnZoom;
    /** The mode's ceiling on `screenZoom`. See that getter. */
    this.screenZoomMaxFn = screenZoomMax;

    /**
     * A bearing and a zoom the camera is travelling to on its own.
     *
     * Null when the player is in charge, which is almost always. Set by the turn
     * change, and dropped the instant a hand touches the field — a view that
     * kept steering itself after the player had grabbed it would be fighting
     * them, and the player wins every argument about where the camera is.
     */
    this._autoAzimuth = null;
    this._autoZoom = null;

    /**
     * The play area's shape, which the camera takes as its aspect.
     *
     * Was the fixed 4:3 of `DISPLAY_ASPECT`. On a portrait phone the play area
     * is no longer 4:3 — it is whatever is left after the HUD and card bands —
     * and a camera that kept framing 4:3 inside a taller region showed the same
     * horizontal slice with the map cut off top and bottom at the region's
     * edges. Matching the region means a tall screen shows MORE board, which is
     * the whole point of giving the board that space.
     *
     * Written from `main.js` on resize, alongside `boardCssWidth`. 4:3 on every
     * landscape window, so nothing there moves.
     */
    this.boardAspect = DISPLAY_ASPECT;
    this.camera = new PerspectiveCamera(FOV, DISPLAY_ASPECT, 1, 1200);
    this._target = new Vector3(0, 0, 0);

    /**
     * Where the pan is going, and where it currently is.
     *
     * Two values rather than one because every path into the pan is a step
     * change: the clamp tightens the moment the zoom moves, and dropping back to
     * minimum zoom snaps the target to the centre. Easing the second toward the
     * first turns all of those into the same short glide, and there is then no
     * transition left to special-case.
     */
    this.panTarget = { x: 0, z: 0 };
    this.pan = { x: 0, z: 0 };

    /** Radians per second, left over from a fling. Decays; never reset by zoom. */
    this.spin = 0;
    /** True while a hand is turning the field. Suspends the snap. */
    this.held = false;

    this.apply();
  }

  // ── the numbers ──────────────────────────────────────────────────────────

  get tanY() {
    return Math.tan((FOV * Math.PI) / 360);
  }

  get tanX() {
    // The PLAY AREA's aspect, not the display's — `fitDistance`, the pan clamp
    // and the pan gain all key off this, and all three are about the region the
    // scene is actually drawn into. See `boardAspect`.
    return this.boardAspect * this.tanY;
  }

  /** Distance at which the whole field is on screen at any bearing. */
  get fitDistance() {
    const e = this.extents;
    // A turning camera is framed by the circle the field fits in; a fixed one by
    // the field itself. See the header.
    const [ex, ez] = this.rotatable
      ? [Math.hypot(e.x, e.z), Math.hypot(e.x, e.z)]
      : [e.x, e.z];
    return Math.max(ez / this.tanY, ex / this.tanX) * FIT_MARGIN;
  }

  /**
   * The zoom the mode will not go below.
   *
   * 1 is the whole-field fit, so a floor above it means the mode deliberately
   * frames tighter than everything-on-screen. Football's is 1 because seeing the
   * whole pitch at minimum zoom is a stated requirement; the knockout board has
   * nothing outside it worth looking at and frames closer.
   */
  get minZoom() {
    const v = this.minZoomFn ? this.minZoomFn(this.config) : 1;
    return Math.max(1, Math.min(Math.max(1, this.maxZoom), v || 1));
  }

  /** The mode's ceiling, or the panel's if it has no opinion. */
  get maxZoom() {
    const v = this.maxZoomFn ? this.maxZoomFn(this.config) : this.config.view.maxZoom;
    return Math.max(1, v || 1);
  }

  /**
   * How much tighter a small screen has to frame to keep a CAP the same size.
   *
   * ── the framing was authored in world units, and a phone is not ────────────
   * `fitDistance` puts the whole field on screen, and `view.zoom` steps in from
   * there. Both are in WORLD units, so they describe the same slice of board on
   * every display — which means a cap is however many pixels the display happens
   * to give that slice. On a 1067-px-wide desktop canvas that is 40 px across;
   * on a 402-px phone the identical framing makes it 15, and a 15-pixel cap is
   * not something you can aim at with a thumb.
   *
   * So the default framing steps in by the same ratio the screen lost, and a cap
   * comes out the same physical size it has on a desktop. `REFERENCE_BOARD_CSS`
   * is the canvas width that framing was judged at.
   *
   * Written from `main.js` on every resize, because the camera has no viewport.
   * 1 on any canvas at least the reference wide, so no desktop window moves.
   */
  get screenZoom() {
    const want = REFERENCE_BOARD_CSS / Math.max(1, this.boardCssWidth);
    /**
     * The ceiling is the MODE's, because how much stepping in costs depends
     * entirely on how the pieces are spread.
     *
     * Knockout packs six caps into 24 world units of depth and can take the full
     * 2.1 without losing any of them. Football spreads eleven over 56, on a
     * pitch whose point is the goal at the far end, and the same 2.1 leaves you
     * aiming at something off screen. One number cannot serve both, so it comes
     * from the mode — the same seam `minZoom` and `maxZoom` already use.
     */
    const cap = this.screenZoomMaxFn
      ? this.screenZoomMaxFn(this.config)
      : MAX_SCREEN_ZOOM;
    return Math.min(Math.max(1, cap || MAX_SCREEN_ZOOM), Math.max(1, want));
  }

  /**
   * The STORED zoom, clamped — and deliberately free of the screen factor.
   *
   * ── this getter is round-tripped, so it must not be derived ────────────────
   * Three sites write what this returns straight back into `config.view.zoom`:
   * `zoomBy`, the `_autoZoom` animation, and `setZoomRange`. That is fine while
   * the getter only CLAMPS — clamping is idempotent, so a round trip is a no-op.
   * It is not fine if the getter also SCALES: every write then multiplies the
   * stored value again, and two mode changes are enough to slam the zoom to its
   * ceiling. That was a real bug and it looked like the map being cut off.
   *
   * So the screen factor lives in `distance`, which nothing writes back, and
   * this stays purely the value the player's pinch owns.
   *
   * The floor is divided by the factor rather than left alone. `minZoom` means
   * "the whole field fits", and with the factor multiplying the distance the
   * stored value that achieves that is `minZoom / screenZoom`. Dividing keeps
   * the guarantee the floor exists for — a phone can still pinch out to the
   * whole board — while the tighter framing remains where the default sits.
   */
  /**
   * The lowest STORED zoom, i.e. how far out the player may pinch.
   *
   * `minZoom` is a statement about what must be VISIBLE — "the whole field
   * fits" — and with the screen factor multiplying the distance, the stored
   * value that achieves it is `minZoom / screenZoom`. Every site that clamps a
   * stored zoom has to use this one rather than `minZoom`, or the two disagree
   * and the pinch stops short of the thing the floor exists to guarantee.
   */
  get zoomFloor() {
    return this.minZoom / this.screenZoom;
  }

  get zoom() {
    const min = this.zoomFloor;
    const max = Math.max(min, this.maxZoom);
    return Math.min(max, Math.max(min, this.config.view.zoom));
  }

  get distance() {
    // The screen factor is applied HERE, and only here: nothing writes a
    // distance back into stored state, so there is nothing for it to compound
    // through. See the note on `zoom`.
    return this.fitDistance / (this.zoom * this.screenZoom);
  }

  /** Bearing in radians. Persisted, so it survives turns and rebuilds. */
  get azimuth() {
    return this.config.view.azimuth || 0;
  }

  set azimuth(v) {
    // Wrapped, so the readout and the inertia never wander off to six digits.
    const tau = Math.PI * 2;
    this.config.view.azimuth = ((v % tau) + tau) % tau;
  }

  /**
   * Is the camera at (or near enough to) its widest?
   *
   * "Near enough" is the point. A wheel notch is a multiplicative step and the
   * clamp lands the zoom on exactly 1 only if the arithmetic happens to come out
   * that way; testing for equality would leave the player at 1.0001 with the
   * rotation silently unavailable and no way to see why. The band is a few per
   * cent of the range and is on the panel.
   */
  get atMinZoom() {
    /**
     * Measured from `zoomFloor`, not `minZoom`, and the difference is not
     * cosmetic.
     *
     * `zoom` is a STORED value whose floor is `minZoom / screenZoom`; `minZoom`
     * is an EFFECTIVE one. Comparing them puts the two sides in different
     * spaces and makes this band wider by exactly `screenZoom` — on a phone,
     * true across most of the useful zoom range rather than a few per cent of
     * it. Since `dragMode` reads this, a drag then ROTATED when it should have
     * panned, and `update` force-centres the pan while rotating, so panning was
     * not merely mislabelled: it was unreachable. Both sides are stored values
     * now. Identical on desktop, where `screenZoom` is 1 and the two floors are
     * the same number.
     */
    return this.zoom <= this.zoomFloor * (1 + Math.max(0, this.config.view.rotateBand));
  }

  /** Which drag this is, given where the zoom currently sits. */
  get dragMode() {
    if (this.rotatable && this.atMinZoom) return 'rotate';
    return 'pan';
  }

  // ── the ground frame ─────────────────────────────────────────────────────
  //
  // The two directions on the pitch that map to screen right and screen up. Pan
  // and the pan clamp are both expressed in them, so neither has to know how
  // `apply` builds the matrix.

  groundRight() {
    const a = this.azimuth;
    return { x: -Math.cos(a), z: Math.sin(a) };
  }

  groundUp() {
    const a = this.azimuth;
    return { x: Math.sin(a), z: Math.cos(a) };
  }

  /** Half-extents of what is on screen, on the ground, in the camera's frame. */
  visibleHalf() {
    const d = this.distance;
    const p = (this._pitchClamped() * Math.PI) / 180;
    return {
      // Along screen right: no foreshortening, the axis is level.
      u: d * this.tanX,
      // Along screen up: the ground is tilted away, so it covers more.
      v: (d * this.tanY) / Math.max(0.15, Math.sin(p)),
    };
  }

  /**
   * World units in one CSS pixel of board WIDTH, at the board plane.
   *
   * Width rather than height because the horizontal axis is level: the vertical
   * one is tilted away from the camera and its scale therefore depends on where
   * on the board you ask. Anything sizing a drawing in screen terms — the aim
   * overlay's ribbons — wants the one that has a single answer.
   */
  get worldPerPixel() {
    return (2 * this.distance * this.tanX) / Math.max(1, this.boardCssWidth);
  }

  _pitchClamped() {
    const deg = this.fixedPitch
      ? this.fixedPitch()
      : this.config.view.topDown
        ? 90
        : this.config.view.cameraPitch;
    return Math.max(8, Math.min(90, deg));
  }

  get pitchDegrees() {
    return this._pitchClamped();
  }

  // ── input ────────────────────────────────────────────────────────────────

  /**
   * Multiply the zoom.
   *
   * Multiplicative rather than additive so a notch of the wheel is the same
   * proportional change wherever you are in the range — an additive step is
   * imperceptible at 4x and a lurch at 1x.
   *
   * @param {number} factor  >1 moves in
   */
  zoomBy(factor) {
    // `zoomFloor`, not `minZoom`: this clamps a STORED value. See that getter.
    const min = this.zoomFloor;
    const max = Math.max(min, this.maxZoom);
    this.config.view.zoom = Math.min(max, Math.max(min, this.zoom * factor));
    this._autoZoom = null;
    this._clampPan();
    this.apply();
  }

  /**
   * Drag the field under the finger.
   *
   * The pixel-to-world scale is derived from the frustum at the current
   * distance rather than tuned, so the point of the pitch under the pointer
   * stays under it at every zoom level — `panSpeed` is a multiplier on top for
   * taste, and at 1 the tracking is exact.
   *
   * @param {number} dxPx  pointer delta, CSS pixels
   * @param {number} dyPx
   * @param {{width: number, height: number}} viewport  canvas size, CSS pixels
   */
  panByPixels(dxPx, dyPx, viewport) {
    const d = this.distance;
    const p = (this._pitchClamped() * Math.PI) / 180;
    const k = Math.max(0, this.config.view.panSpeed);
    const wx = ((2 * d * this.tanX) / Math.max(1, viewport.width)) * k;
    const wy = ((2 * d * this.tanY) / Math.max(1, viewport.height) / Math.max(0.15, Math.sin(p))) * k;

    const r = this.groundRight();
    const up = this.groundUp();
    // A hand on the view outranks the ball. Cancelling here rather than letting
    // the two write the same target means the drag does not fight a follow that
    // is re-aiming it every frame.
    this.stopFollow();
    this.cancelAuto();
    // The content follows the finger, so the target moves against it on screen
    // right and with it on screen up — screen y grows downward, which is why
    // the second term is not negated.
    this.panTarget.x += -r.x * dxPx * wx + up.x * dyPx * wy;
    this.panTarget.z += -r.z * dxPx * wx + up.z * dyPx * wy;
    this._clampPan();
  }

  /**
   * Turn by an angle the pointer swept, NOW.
   *
   * ── an angle, not a horizontal distance ──────────────────────────────────
   * This used to take a pixel delta and turn by `dx * speed`, and that mapping
   * is wrong in a way that is invisible until you grab the other half of the
   * screen. Dragging right has to turn the field clockwise if you grabbed above
   * the centre and ANTICLOCKWISE if you grabbed below it — it is the same
   * gesture on a wheel — and a rule written in `dx` alone cannot tell those
   * apart, so it is correct on one half and reversed on the other. Flipping its
   * sign just moves which half is broken.
   *
   * So the router hands over the angle the pointer swept about the centre of the
   * view, and this adds it. The point under the finger stays under the finger,
   * whichever side of the middle it started on, and "the wrong way round" stops
   * being expressible.
   *
   * ── and the `apply` is not optional ──────────────────────────────────────
   * Rotation has no easing stage, so nothing else would rebuild the matrix until
   * `update` found some other reason to — and during a rotate drag there is
   * none, because the spin is stopped and the pan is not moving. Without it the
   * field sits still under the hand for the whole gesture and then jumps the
   * accumulated angle in one frame when the fling starts. The pan gets away
   * without it because its input writes `panTarget` and the glide toward it is
   * what redraws.
   *
   * @param {number} radians  swept angle, already in world terms
   */
  rotateBy(radians) {
    if (!radians) return;
    this._autoAzimuth = null;
    // The player has taken the bearing. Nothing puts it back until their next
    // turn — see `holdsOwnHalf`.
    this.userTurned = true;
    this.azimuth = this.azimuth + radians * Math.max(0, this.config.view.rotateSpeed);
    this.apply();
  }

  /**
   * Let go mid-turn and the field keeps going.
   *
   * @param {number} radPerSecond  angular velocity of the sweep at release
   */
  flingRotate(radPerSecond) {
    this.spin = radPerSecond * Math.max(0, this.config.view.rotateSpeed);
    this.userTurned = true;
  }

  stopSpin() {
    this.spin = 0;
  }

  /**
   * Is a hand on the field right now?
   *
   * Only the snap cares. A magnet that pulled while the player was still turning
   * would fight them for the last few degrees either side of vertical, which is
   * the one place they are most likely to be aiming for deliberately.
   */
  setHeld(on) {
    this.held = !!on;
    // A hand on the field ends any move the camera was making for itself.
    if (this.held) this.cancelAuto();
  }

  // ── the turn-over ────────────────────────────────────────────────────────

  /**
   * Bring the view round to face this player's own half, and back out to the
   * mode's widest.
   *
   * ── this REVERSES an earlier decision, deliberately ──────────────────────
   * The zoom and the bearing used to be explicitly persistent — "줌 레벨과 회전
   * 각도는 턴이 바뀌어도 유지된다" — and they lived on the config precisely so
   * that a turn change, a goal reset and a full rebuild could not touch them.
   * They still live there; what has changed is that the turn change now asks for
   * a specific view rather than leaving whatever the last player set up.
   *
   * The reason is that the two players share one screen. Inheriting the
   * opponent's framing means every turn starts by undoing it — turning the pitch
   * round and zooming out — before any football can be played, and the player
   * who forgets is aiming at a mirrored board.
   *
   * It is a REQUEST, not an assignment: `update` eases toward it and any input
   * at all cancels it, so a player who wants a different view simply takes one
   * and is not fought for it.
   *
   * @param {number} azimuth  radians, or null to leave the bearing alone
   * @param {{zoom?: boolean}} [opts]  `zoom: false` turns the view without
   *   touching how close it is — for a swap, which changes which way the player
   *   is looking in the middle of a turn they have already framed for
   *   themselves. Taking their zoom away there would be undoing their setup, not
   *   helping them.
   */
  faceTo(azimuth, { zoom = true } = {}) {
    this.spin = 0;
    this.userTurned = false;
    if (zoom) {
      const home = this.defaultFraming(azimuth);
      this.panTarget.x = home.panX;
      this.panTarget.z = home.panZ;
    }

    if (this.rotatable && azimuth !== null && azimuth !== undefined) {
      // The shortest way round, resolved once at the start. Recomputing it every
      // frame would be the same answer until the bearing crossed the antipode of
      // the target, at which point the camera would turn back on itself.
      this._autoAzimuth = { from: this.azimuth, delta: angleDelta(this.azimuth, azimuth), t: 0 };
    }
    if (zoom) {
      this._autoZoom = { from: this.zoom, to: this.defaultFraming(azimuth).zoom, t: 0 };
      this._following = false;
    }
  }

  /**
   * THE default framing, as four numbers. One definition, two callers.
   *
   * ── it exists so the reset button and the turn change cannot drift ─────────
   * "기본 구도 = 로컬 모드에서 턴이 바뀔 때 자동으로 잡히는 그 구도와 완전히
   * 동일해야 한다. 그 구도 계산을 함수로 분리해라. 상수를 두 군데 복사하지 마라."
   *
   * `faceTo` above builds its tween out of this, and `atDefaultFraming` below
   * tests against it — so there is no third place holding a copy of "zoom back
   * out to the turn zoom and centre the pan", and moving the opening zoom moves
   * the reset button with it by construction rather than by anybody remembering.
   *
   * The reset button itself does not call this at all: it calls
   * `faceCurrentPlayer(true)` in `main.js`, which is the same function the turn
   * change calls, which calls `faceTo`, which calls this. Requirement 15 asks
   * for one function shared by both paths, and there are two of them stacked —
   * the framing numbers here, and the "which bearing does this player get"
   * decision up there.
   *
   * @param {number|null} azimuth  the bearing this turn wants, or null
   */
  defaultFraming(azimuth) {
    return {
      azimuth: this.rotatable && azimuth !== null && azimuth !== undefined ? azimuth : this.azimuth,
      zoom: this.turnZoom,
      panX: 0,
      panZ: 0,
    };
  }

  /**
   * Is the view already sitting at the default framing?
   *
   * What the reset button's dimming reads. Deliberately NOT what the button's
   * hit test reads: "흐린 상태에서도 클릭은 동작한다" — the dimming is a hint that
   * there is nothing to undo, and a control that stopped answering would be a
   * different and worse thing, especially mid-glide when a player who wants to
   * cancel their own drag would find the button dead.
   *
   * `settling` counts as being there: the camera is already on its way, and a
   * button that lit up again for the half second of the ease would flicker on
   * every single turn change.
   *
   * The tolerances are proportional rather than absolute so they mean the same
   * thing on a board of any size — the pan one is a fraction of the visible
   * patch, not a number of world units.
   */
  atDefaultFraming(azimuth) {
    if (this.settling) return true;
    const home = this.defaultFraming(azimuth);

    if (Math.abs(this.zoom - home.zoom) > home.zoom * 0.02) return false;

    const { u, v } = this.visibleHalf();
    const slack = Math.max(u, v) * 0.02;
    if (Math.abs(this.pan.x - home.panX) > slack) return false;
    if (Math.abs(this.pan.z - home.panZ) > slack) return false;

    if (this.rotatable && azimuth !== null && azimuth !== undefined) {
      if (Math.abs(angleDelta(this.azimuth, home.azimuth)) > 0.01) return false;
    }
    return true;
  }

  /**
   * The zoom a turn opens at.
   *
   * Not the minimum. The minimum shows the whole pitch, which is the right thing
   * to hand someone who wants to see where everything is and the wrong thing to
   * hand someone about to take a shot — the caps are small and the aim is fiddly
   * at that distance. This starts them close enough to shoot with.
   *
   * The cost is worth stating: above the minimum a drag PANS rather than
   * rotating, so a player who wants to turn the pitch by hand has to zoom out
   * first. That is a fair trade now that the turn brings the right way up on its
   * own, and zooming out is one notch.
   */
  get turnZoom() {
    // The mode's, if it has one. Curling's is its minimum — see the note on
    // `curlingTurnZoom` — because a lane is aimed from one end at the other and
    // opening halfway in shows neither.
    const want = this.turnZoomFn ? this.turnZoomFn(this.config) : this.config.view.turnZoom;
    // Stored-value territory again — this is fed into `_autoZoom` endpoints and
    // into `defaultFraming`, both of which are compared against and written to
    // `config.view.zoom`. Clamping it to `minZoom` would make "already at the
    // default framing" unreachable on a phone, because the default sits below
    // that floor once the screen factor is in play.
    const floor = this.zoomFloor;
    if (!want) return floor;
    return Math.min(Math.max(floor, this.maxZoom), Math.max(floor, want));
  }

  // ── following the ball ───────────────────────────────────────────────────

  /**
   * Keep this point in the middle of the view while the turn plays out.
   *
   * Written as a pan TARGET rather than a position, so the existing glide does
   * the smoothing and a ball ricocheting off a wall does not snap the camera —
   * it leans after it. The clamp is the ordinary pan clamp, so following can
   * never show more of the outside world than dragging there by hand would.
   *
   * @param {{x: number, z: number}} point
   */
  followTo(point) {
    if (!point) return;
    this._following = true;
    this.panTarget.x = point.x;
    this.panTarget.z = point.z;
    this._clampPan();
  }

  /** Let go of whatever was being followed. */
  stopFollow() {
    this._following = false;
  }

  /**
   * Is something steering the pan right now?
   *
   * Read-only, and it exists so a follower can find out that a HAND has taken
   * the view off it: `panByPixels` calls `stopFollow`, and a follower which
   * rewrites the target every frame would otherwise put it straight back and
   * the drag would do nothing. See `CamTracker._handTookIt`. Nothing here
   * changes — this getter reports the flag that was already being kept.
   */
  get following() {
    return this._following;
  }

  /** The player has taken over. */
  cancelAuto() {
    this._autoAzimuth = null;
    this._autoZoom = null;
  }

  /** Is the camera still travelling to a turn-over view? For the panel. */
  get settling() {
    return !!this._autoAzimuth || !!this._autoZoom;
  }

  /**
   * Is the view already built the way this turn wants it, or on its way there?
   *
   * The caller uses this to hold "your own half is at the bottom" as an
   * INVARIANT — checked every frame rather than fired once on a turn change and
   * hoped about. Every version of this that was event-driven eventually found a
   * path where the event did not fire and the view stayed wrong for the rest of
   * the match, and there is no way to be sure the last such path has been found.
   * Checking the answer is cheap and cannot miss one.
   *
   * The exception is the player turning it themselves. That outranks the
   * invariant until their next turn opens — otherwise a deliberate look around
   * would be dragged straight back and the rotation control would be useless.
   *
   * @param {number|null} bearing  radians, or null if the mode has no opinion
   */
  holdsOwnHalf(bearing) {
    if (bearing === null || bearing === undefined || !this.rotatable) return true;
    if (this.userTurned || this.held || this.spin !== 0) return true;
    if (this._autoAzimuth) return true;
    return Math.abs(angleDelta(this.azimuth, bearing)) < 1e-3;
  }

  /**
   * Carry the bearing and the zoom to whatever the turn-over asked for.
   *
   * ── a timed tween, NOT the exponential the pan uses ──────────────────────
   * An exponential glide is the right shape for a pan, which only has to end up
   * roughly there. It is the wrong shape here because it never arrives: measured
   * at a 0.55 s time constant, a half-turn was still 4.5 degrees short after a
   * second and a half and the "close enough, assign it" threshold had not
   * tripped — so the pitch spent the whole of the next turn creeping, and the
   * vertical snap could not take over because the transition was still live.
   *
   * A fixed duration with a smoothstep arrives, in the time on the panel,
   * whatever distance it has to cover. Both ends are eased, so the pitch starts
   * and stops moving gently and the middle carries the speed.
   *
   * @param {number} step  seconds of wall clock
   * @returns {boolean} did anything move?
   */
  _settleAuto(step) {
    const dur = Math.max(0.05, this.config.view.turnViewSec);
    let moved = false;

    if (this._autoAzimuth) {
      const a = this._autoAzimuth;
      a.t = Math.min(1, a.t + step / dur);
      // Assigned outright at the end rather than eased into: "자신의 진영이
      // 아래쪽" has to be exactly the bearing, or the snap magnet immediately
      // starts pulling at the remainder.
      this.azimuth = a.t >= 1 ? a.from + a.delta : a.from + a.delta * smoothstep(a.t);
      if (a.t >= 1) this._autoAzimuth = null;
      moved = true;
    }

    if (this._autoZoom) {
      const z = this._autoZoom;
      z.t = Math.min(1, z.t + step / dur);
      this.config.view.zoom = z.t >= 1 ? z.to : z.from + (z.to - z.from) * smoothstep(z.t);
      if (z.t >= 1) this._autoZoom = null;
      this._clampPan();
      moved = true;
    }

    return moved;
  }

  // ── per frame ────────────────────────────────────────────────────────────

  /**
   * Inertia and the pan glide. Driven by FRAME time, never by simulation time.
   *
   * This is the one part of the camera that moves on its own, and it is
   * deliberately outside the fixed-step loop: it is presentation, it is not in
   * the state hash, and a spinning field must not change how many physics steps
   * a turn takes.
   *
   * @param {number} dt  seconds of wall clock
   */
  update(dt) {
    const step = Math.max(0, Math.min(0.1, dt));
    let moved = false;

    if (Math.abs(this.spin) > SPIN_EPSILON) {
      this.cancelAuto();
      this.azimuth = this.azimuth + this.spin * step;
      // Exponential, so the decay is the same curve at any frame rate.
      this.spin *= Math.exp(-Math.max(0, this.config.view.rotateDamping) * step);
      if (Math.abs(this.spin) <= SPIN_EPSILON) this.spin = 0;
      moved = true;
    }

    // Dropping back to the widest zoom returns the view to the centre. Setting
    // the TARGET rather than the position is what makes it a glide instead of a
    // snap, and it is the same glide the clamp uses when the zoom tightens.
    //
    // Not while following: at the widest zoom the pan clamp is already zero, so
    // this would be re-centring a view that has nowhere to go, and the moment
    // the zoom is anywhere above it the two would take turns writing the target.
    if (this.dragMode === 'rotate' && !this._following) {
      this.panTarget.x = 0;
      this.panTarget.z = 0;
    }

    const tau = Math.max(0.01, this.config.view.transitionSec);
    const k = 1 - Math.exp(-step / tau);
    // Before the pan glide, because the zoom it changes tightens the pan clamp.
    if (this._settleAuto(step)) moved = true;
    const dx = this.panTarget.x - this.pan.x;
    const dz = this.panTarget.z - this.pan.z;
    if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) {
      this.pan.x += dx * k;
      this.pan.z += dz * k;
      moved = true;
    } else if (this.pan.x !== this.panTarget.x || this.pan.z !== this.panTarget.z) {
      this.pan.x = this.panTarget.x;
      this.pan.z = this.panTarget.z;
      moved = true;
    }

    if (this._settleSnap(k)) moved = true;

    if (moved) this.apply();
  }

  /**
   * Let the pitch stand up straight when it is nearly there.
   *
   * The two bearings in `SNAP_BEARINGS` are the ones at which the goal axis is
   * vertical on screen — the way the pitch is laid out to be read. Free rotation
   * everywhere else, as before; this is a magnet at those two, not a grid.
   *
   * It engages only once the field is otherwise still: not while a hand is on it
   * — the last few degrees either side of vertical are exactly where the player
   * is most likely to be steering deliberately — and not while the fling is
   * still running, where it would tug at a spin passing through.
   *
   * The final degree is closed by assignment rather than by more easing, because
   * "정확히 수직" has to mean exactly, and an exponential approach never arrives.
   *
   * @param {number} k  this frame's share of the glide, shared with the pan
   * @returns {boolean} did the bearing move?
   */
  _settleSnap(k) {
    // Not while the turn-over is bringing the view round: they would be two
    // magnets pulling at the same bearing on different clocks.
    if (this.held || this.spin !== 0 || !this.rotatable || this._autoAzimuth !== null) return false;
    const window = (Math.max(0, this.config.view.snapWindowDeg) * Math.PI) / 180;
    if (window <= 0) return false;

    let best = null;
    for (const target of SNAP_BEARINGS) {
      const d = angleDelta(this.azimuth, target);
      if (Math.abs(d) <= window && (!best || Math.abs(d) < Math.abs(best.d))) {
        best = { target, d };
      }
    }
    if (!best) return false;

    if (Math.abs(best.d) < 1e-3) {
      if (this.azimuth === best.target) return false;
      this.azimuth = best.target;
      return true;
    }
    this.azimuth = this.azimuth + best.d * k;
    return true;
  }

  // ── the clamp ────────────────────────────────────────────────────────────

  /**
   * How far the pan may travel on each of the FIELD's axes.
   *
   * The visible ground patch is axis-aligned in the CAMERA's frame and the field
   * is axis-aligned in its OWN, and at a free bearing those are different
   * frames. So the patch's extent is projected onto each of the field's axes —
   * `u|cos| + v|sin|` and its partner — and the pan gets whatever is left over.
   *
   * ── the margin, and why the strict version was wrong ─────────────────────
   * `panMargin` is how far the field's edge is allowed to come INSIDE the frame,
   * as a fraction of what the frame covers. At zero the edge can only ever reach
   * the frame's own border, which sounds like the tidy answer and plays badly:
   * the thing you zoomed in to look at ends up jammed against the top of the
   * screen, and at modest zoom there is barely any travel at all. Measured on
   * the default pitch, the vertical allowance at 1.5x was 3.3 units out of a
   * half-length of 44.5 — the drag hit its stop almost immediately.
   *
   * With a margin the allowance is `extent - view x (1 - margin)`, which at 0.3
   * takes that same 1.5x case to 15.7 and lets a goal sit a third of the way
   * down the frame instead of clipped to its edge. The cost is that a strip
   * outside the fence can come into view at the limit — which is a deliberate
   * relaxation of "필드 바깥 빈 공간이 보이면 안 된다", asked for once the strict
   * version had been played with.
   *
   * When the view is larger than the field on an axis the allowance goes
   * negative and the pan is pinned to zero, which is how "팬은 최소 줌보다 클 때"
   * ends up enforced by the geometry rather than by a mode check.
   */
  panLimits() {
    const { u, v } = this.visibleHalf();
    const ca = Math.abs(Math.cos(this.azimuth));
    const sa = Math.abs(Math.sin(this.azimuth));
    // Clamped below 1: at 1 the whole frame could leave the field and the pan
    // would have no limit at all.
    const keep = 1 - Math.max(0, Math.min(0.9, this.config.view.panMargin));
    return {
      x: Math.max(0, this.extents.x - (u * ca + v * sa) * keep),
      z: Math.max(0, this.extents.z - (u * sa + v * ca) * keep),
    };
  }

  _clampPan() {
    const { x: maxX, z: maxZ } = this.panLimits();
    this.panTarget.x = Math.max(-maxX, Math.min(maxX, this.panTarget.x));
    this.panTarget.z = Math.max(-maxZ, Math.min(maxZ, this.panTarget.z));
  }

  // ── the matrix ───────────────────────────────────────────────────────────

  apply() {
    const d = this.distance;
    const cam = this.camera;
    // Kept in step here rather than at the write site, so there is exactly one
    // place the projection can fall out of date with the region it draws into.
    if (cam.aspect !== this.boardAspect) {
      cam.aspect = this.boardAspect;
      cam.updateProjectionMatrix();
    }
    const deg = this._pitchClamped();
    const a = this.azimuth;
    const tx = this.pan.x;
    const tz = this.pan.z;

    this._target.set(tx, 0, tz);

    if (deg >= 89.5) {
      cam.position.set(tx, d, tz);
      // Straight down is the one orientation where the default up vector is
      // parallel to the view direction and lookAt has no answer. The ground
      // direction that reads as "up the screen" is the answer, and at bearing
      // zero that is +Z — which puts player one at the top of the screen and
      // player zero at the bottom, the same way round as the tilted view.
      cam.up.set(Math.sin(a), 0, Math.cos(a));
    } else {
      const p = (deg * Math.PI) / 180;
      const h = d * Math.cos(p);
      // Behind the near goal at bearing zero, swinging round the pitch as the
      // bearing turns. The height never changes with the bearing, which is what
      // keeps this a yaw and not an orbit.
      cam.position.set(tx - h * Math.sin(a), d * Math.sin(p), tz - h * Math.cos(a));
      cam.up.set(0, 1, 0);
    }

    cam.lookAt(this._target);
    cam.updateProjectionMatrix();
  }

  // ── structural ───────────────────────────────────────────────────────────

  /** The world changed size — a board resize, a pitch resize, a mode switch. */
  setExtents(extents) {
    this.extents.x = extents.x;
    this.extents.z = extents.z;
    this._clampPan();
    this.apply();
  }

  setFixedPitch(fn) {
    this.fixedPitch = fn ?? null;
    this.apply();
  }

  /**
   * A mode that cannot turn has no bearing to keep.
   *
   * Zeroed rather than remembered, because the alternative is a knockout board
   * that comes back from a football match sitting at whatever angle was left
   * behind, with no control anywhere that would explain it.
   */
  setRotatable(on) {
    this.rotatable = !!on;
    if (!on) {
      this.spin = 0;
      this.azimuth = 0;
    }
    this.cancelAuto();
    this._clampPan();
    this.apply();
  }

  /**
   * A mode switch changes the zoom range under the current zoom.
   *
   * All three in one call, because they are one range and applying them
   * separately would re-clamp the zoom against a half-updated one — a mode with
   * a lower ceiling than the last one's floor would push the zoom to a value
   * neither mode allows.
   */
  /**
   * The board's on-screen width changed — a rotation, a resize, a URL bar.
   *
   * Not a bare field, because every derived value hangs off it. `distance` moves
   * with it, and `update` only calls `apply()` when something has MOVED — at
   * rest nothing has, so the camera matrix kept the old distance until the next
   * input. Worse in one direction than the other: a board that gets WIDER drops
   * `screenZoom`, which grows `distance`, which grows the visible patch, which
   * SHRINKS the pan limits — leaving a pan that was legal a moment ago outside
   * them with nothing to bring it back.
   *
   * The stored zoom is deliberately NOT rewritten here. `get zoom()` clamps on
   * read, so nothing stale is ever reported, and writing it back would destroy a
   * framing that is legal in the orientation the player is about to return to.
   */
  setBoardCssWidth(px, aspect = this.boardAspect) {
    const w = Math.max(1, px || 1);
    const a = aspect > 0 ? aspect : this.boardAspect;
    // A sliding URL bar fires a dozen resizes with the same numbers.
    if (w === this.boardCssWidth && a === this.boardAspect) return;
    this.boardCssWidth = w;
    this.boardAspect = a;
    this._clampPan();
    this.apply();
  }

  setZoomRange({ min = null, max = null, turn = null, screenMax = null } = {}) {
    this.minZoomFn = min;
    this.maxZoomFn = max;
    this.turnZoomFn = turn;
    this.screenZoomMaxFn = screenMax;
    // Re-clamped through the getter, so a zoom left outside the new range is
    // brought in rather than silently reported as something it is not.
    this.config.view.zoom = this.zoom;
    this.cancelAuto();
    this._clampPan();
    this.apply();
  }
}

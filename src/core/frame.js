/**
 * The layout box every overlay is drawn in, and where the board sits inside it.
 *
 * ── why this file exists ─────────────────────────────────────────────────────
 * There were SEVEN copies of `{ width: 640, height: 480 }` in this project —
 * `HudLayer`, `CardLayer`, `ModalLayer`, `MatchFoundLayer`, `VictoryLayer`,
 * `CapWipe`, and a default argument in `safeArea` — and not one of them imported
 * from another. That was harmless while the number was a constant. It stops
 * being harmless the moment the box can change shape, because seven independent
 * constants cannot be changed together.
 *
 * ── the shape ────────────────────────────────────────────────────────────────
 * Both axes vary, and they vary for different reasons.
 *
 * The WIDTH is the UI SCALE. Every horizontal constant in the UI — the 208-wide
 * score plate, the 104-wide button, the 152-wide turn plate, the 128-wide card —
 * was chosen against 640, and none of them changes. What changes is how many CSS
 * pixels one frame pixel is worth: pinning the frame at 640 on a 402-px-wide
 * phone made every one of them a third of its desktop size, which is why the
 * text was unreadable and the buttons missed the 44pt touch minimum. Narrowing
 * the frame scales all of them together and leaves every PROPORTION exactly as
 * authored. See `MIN_CSS_PX_PER_FRAME_PX` — it is the one dial.
 *
 * The HEIGHT is the SHAPE. It is at least the board's height, because the board
 * has to fit; above that it grows to match the window, which on a phone in
 * portrait means the canvas fills the screen instead of sitting in a 4:3 band
 * with black above and below.
 *
 * ── the board keeps its own 4:3 ──────────────────────────────────────────────
 * The board is a sub-rectangle of the frame, the frame's full width and 4:3, and the 3D scene is drawn
 * into exactly that. The perspective camera therefore keeps a 4:3 aspect and the
 * framing of every mode is untouched — which is the whole point of doing it this
 * way rather than squeezing the board into a portrait frustum. What changes is
 * only that the HUD and the card hand now have their own room above and below it
 * instead of being drawn on top of the play area.
 *
 * In any landscape window the surplus is zero and the frame IS the board, so
 * there are no bands and every layer lays out exactly as it always did. What a
 * landscape PHONE still gets is the scale — a 419-wide frame rather than 640 —
 * because its canvas is narrow even though its window is not.
 *
 * The invariant worth remembering: a canvas at least 800 CSS px wide resolves to
 * the original 640x480 frame with zero bands, so every desktop window is
 * bit-identical to the way it was before this file existed. 800 is
 * 640 x MIN_CSS_PX_PER_FRAME_PX, and that is the whole of the reason.
 */

import { OrthographicCamera } from 'three';

/**
 * The widest the frame ever gets, and the size every UI constant was authored at.
 *
 * A desktop window resolves to exactly this, so nothing on a PC moves by a pixel.
 */
export const MAX_FRAME_WIDTH = 640;

/**
 * The floor, so the frame cannot shrink to the point of absurdity on a tiny
 * window. At 240 the 104-wide button is 43% of the frame, which is as far as
 * that idea can usefully be pushed.
 */
export const MIN_FRAME_WIDTH = 240;

/**
 * How many CSS pixels one frame pixel must be worth, at minimum.
 *
 * ── this is THE dial for how big the UI is on a phone ────────────────────────
 * Every UI constant in the project is in frame pixels — a 104-wide button, a
 * 208-wide score, 16px type — and how large any of them LOOKS is entirely
 * `canvasCssWidth / frame.width`. On a desktop window that ratio is about 1.97,
 * so the 나가기 button is 205 CSS px across and its label is 31 px. On a phone
 * with the frame pinned at 640 the same button is 65 CSS px with a 10 px label,
 * which is why it was unreadable: identical PROPORTIONS, a third of the size.
 *
 * Making the frame narrower on a narrow screen fixes it in one number, because
 * every constant scales together and none of the relationships between them
 * change. The proportions stay exactly as authored; only the ratio moves.
 *
 * ── why 1.25 and not PC parity ───────────────────────────────────────────────
 * Matching a desktop EXACTLY would need a ratio of ~1.97, i.e. a frame 204 wide
 * on a 402-px phone — and then the button is 205 CSS px, which is 51% of the
 * screen. That is what "the same physical size" actually costs when the screen
 * is a third as wide, and it is too much: one button would be half the width of
 * the game.
 *
 * 1.25 doubles the old size and lands where it matters:
 *
 *     button  130 x 42 CSS px   (hit quad 67 px — clears the 44pt minimum)
 *     label   20 CSS px         (was 10)
 *     note    16 CSS px         (was 8)
 *     card    173 CSS px wide   (was 80)
 *
 * Raise it if you want them bigger still; nothing else has to change.
 */
export const MIN_CSS_PX_PER_FRAME_PX = 1.25;

/** The play area's aspect. The perspective camera keeps this, always. */
export const BOARD_ASPECT = 4 / 3;

/**
 * The shape of the FIELD the current mode lays out, as width / depth.
 *
 * ── the play area should be the field's shape, not the screen's ──────────────
 * Two wrong answers were tried before this one. Pinning the play area to 4:3
 * cropped a square board top and bottom on a phone. Letting it take the whole
 * portrait canvas did the opposite: a 29x29 knockout board in a 0.46-tall view
 * fits by its WIDTH, so the camera pulls back until the board is small and two
 * fifths of the screen is empty floor below it — which is the "bottom 30% is
 * cut off" and the off-centre lean, both at once.
 *
 * Giving the region the field's own aspect removes both failure modes by
 * construction: nothing is cropped, because the field fits; nothing is wasted,
 * because the region is not bigger than the field in either axis. Whatever the
 * frame has left over goes to the bands, which is exactly what the bands are.
 *
 * 4:3 until a mode says otherwise, so nothing moves before `setFieldAspect`.
 */
let fieldAspect = BOARD_ASPECT;

/** @param {number} a  field half-width / half-depth. */
export function setFieldAspect(a) {
  const next = Number.isFinite(a) && a > 0 ? a : BOARD_ASPECT;
  if (next === fieldAspect) return false;
  fieldAspect = next;
  return true;
}

/**
 * The least of the frame the two bands keep between them.
 *
 * A long field — football's pitch, curling's lane — wants a region taller than
 * the frame can spare, so something has to give. This is the line: the hand and
 * the readouts never get less than a quarter of the frame, and the region takes
 * everything above that. Both degrade gracefully past it (the hand simply shows
 * less card; see `handExposure`).
 */
const BANDS_MIN_SHARE = 0.25;

/**
 * Exactly what each band has to HOLD, in frame pixels — no more.
 *
 * ── the bands take what they need and the BOARD takes the rest ──────────────
 * These used to be a ceiling on an even split of the surplus, which meant the
 * board stayed pinned at its 4:3 minimum and every pixel of extra screen went to
 * the bands. On a phone that left the play area a 4:3 strip across the middle
 * with the map cut off at its edges and two large empty margins around it —
 * a letterbox inside a letterbox.
 *
 * They are now a REQUIREMENT rather than a share. The top holds a 26-tall turn
 * plate, a 5-tall clock, a 22-tall note, a 42-tall score and the margins between
 * them; the bottom holds a 192-tall card plus the room the drag-to-play travel
 * needs above it. Whatever is left over is the board's, and the board is no
 * longer forced to be 4:3 — see `boardAspect`.
 */
const TOP_BAND_NEED = 190;
const BOTTOM_BAND_NEED = 230;

/**
 * Resolve the frame for a window shape.
 *
 * @param {number} windowW  CSS pixels
 * @param {number} windowH  CSS pixels
 * @returns {{width:number, height:number, boardWidth:number, boardHeight:number,
 *            boardTop:number, boardBottom:number, topBand:number,
 *            bottomBand:number, aspect:number}}
 *   `boardTop`/`boardBottom` are in FRAME-PIXEL coordinates measured from the
 *   frame's own top edge, so they can be handed straight to a scissor rectangle
 *   after the y-flip. The band heights are what the layers lay out against.
 */
/**
 * The largest box of `frameW:frameH` that fits the window — i.e. what
 * `Viewport._fit` will do. Duplicated here because the scale depends on it.
 */
function canvasWidthFor(frameW, frameH, w, h) {
  const aspect = frameW / frameH;
  let cw = w;
  let ch = Math.round(w / aspect);
  if (ch > h) {
    ch = h;
    cw = Math.round(h * aspect);
  }
  return Math.max(1, cw);
}

export function resolveFrame(windowW, windowH) {
  const w = Math.max(1, windowW);
  const h = Math.max(1, windowH);

  /**
   * The scale and the shape are mutually dependent, so this settles them.
   *
   * The UI scale is `canvasWidth / frameWidth`, and the CANVAS width depends on
   * the frame's ASPECT, which depends on the frame's width — a loop. It closes
   * in one step and is confirmed in a second, because after the first pass the
   * aspect is either the window's exactly (portrait, canvas fills the window) or
   * pinned at 4:3 by the board floor (landscape, canvas is height-limited), and
   * neither moves again.
   *
   * Doing this against the CANVAS rather than the WINDOW is what makes a phone
   * in landscape scale too. There the canvas is height-limited and much narrower
   * than the window — 524 of an 852-wide window — so sizing off the window would
   * have left landscape at the desktop scale and its buttons at 85x28 px.
   */
  let width = MAX_FRAME_WIDTH;
  let boardHeight = Math.round(width / BOARD_ASPECT);
  let height = Math.round(
    // No ceiling: the frame takes the window's shape and the board keeps
    // whatever the bands do not need. A ceiling here was the letterbox bug —
    // it threw the surplus away AND pinned the play area at its 4:3 minimum.
    Math.max(boardHeight, width * (h / w)),
  );

  for (let pass = 0; pass < 2; pass++) {
    const canvasW = canvasWidthFor(width, height, w, h);
    width = Math.round(
      Math.min(
        MAX_FRAME_WIDTH,
        Math.max(MIN_FRAME_WIDTH, canvasW / MIN_CSS_PX_PER_FRAME_PX),
      ),
    );
    boardHeight = Math.round(width / BOARD_ASPECT);
    height = Math.round(
      Math.max(boardHeight, width * (h / w)),
    );
  }

  // The board is the frame's full width and 4:3. Its SCREEN size is therefore
  // unchanged by the scale — it was always the full canvas width — and only the
  // UI around it grows.
  const boardWidth = width;


  /**
   * The bands take what they need; the board keeps everything else.
   *
   * `boardHeight` above is only the 4:3 MINIMUM — the shape the camera was
   * authored at and the least the play area may be. Anything the frame has past
   * that, less what the two bands actually hold, belongs to the board. So the
   * play area grows with the screen instead of staying a strip across the
   * middle of it, and the map stops being cut off at a band edge.
   *
   * When the surplus cannot cover both bands they shrink together rather than
   * one starving the other, and at zero surplus — every landscape window — both
   * are zero and the board is exactly the 4:3 it always was.
   */

  /**
   * The play area is the WHOLE frame. The bands are reserved space, not a hole
   * cut out of it.
   *
   * ── why this went back ──────────────────────────────────────────────────────
   * Confining the board to the gap between the bands sounded right and measured
   * wrong. On a phone the gap is 40% of the canvas, and the framing has to step
   * in 2.1x for a cap to be thumb-sized — so the map was being cropped to a
   * third of itself inside a strip covering a third of the screen, and it read
   * exactly as it was: letterboxed twice.
   *
   * Drawing the board across the whole frame gives that framing two and a half
   * times the area to spend, so the same cap size now comes with far more board
   * around it. The bands still do their job — the HUD anchors to the top edge
   * and the hand to the bottom, both of which are frame-edge anchored already —
   * they simply no longer take the space away from the play area. A portrait
   * screen has room for the readouts to sit over the far ends of the board
   * without covering anything that is being aimed at; a 4:3 one did not, which
   * is what the bands were invented for.
   */
  /**
   * The play area is the WHOLE frame. The bands are where the UI ANCHORS, not
   * a hole cut out of the board.
   *
   * ── the third answer, and why the first two were wrong ─────────────────────
   * Pinning the region to 4:3 cropped a square board top and bottom. Giving it
   * the FIELD's shape stopped the cropping but left the board occupying under
   * half the screen with dead margins above and below it — which reads as
   * letterboxing whatever the geometry says, because a black margin and a
   * cropped edge look identical from the sofa.
   *
   * The play area therefore takes the entire frame, exactly as the HUD does,
   * and the camera takes the frame's shape with it. On a phone that means a tall
   * narrow view: the whole depth of the field is on screen with room to spare
   * and the width is what the framing trades away — which is the right way round
   * for a game aimed along the board rather than across it, and the direction a
   * pinch can undo.
   *
   * `fieldAspect` is still tracked because `boardRect`/`boardRectCss` and the
   * pointer re-basing all read the region, and a mode that wants a different
   * one only has to change this line.
   */
  const playHeight = height;

  /**
   * The bands split whatever the region left, in the proportion they were
   * authored at — the top holds readouts, the bottom holds a card, and the card
   * is the taller of the two.
   */
  const leftover = Math.max(0, height - playHeight);
  const need = TOP_BAND_NEED + BOTTOM_BAND_NEED;
  const topBand = Math.round(leftover * (TOP_BAND_NEED / need));
  const bottomBand = leftover - topBand;

  return {
    width,
    height,
    boardWidth,
    /** The play area's ACTUAL height — the field's shape, within the bounds. */
    boardHeight: playHeight,
    /**
     * The play area's shape, which the perspective camera takes as its aspect.
     * The FIELD's shape wherever the frame can afford it, so nothing is cropped
     * and nothing is wasted. 4:3 on a landscape window, as it always was.
     */
    boardAspect: boardWidth / playHeight,
    topBand,
    bottomBand,
    boardTop: topBand,
    boardBottom: topBand + playHeight,
    aspect: width / height,
    /**
     * Is the frame taller than the 4:3 it was designed in?
     *
     * The one honest test for "portrait", and it must NOT be derived from the
     * band heights or the play area — both of those have changed meaning twice
     * during this work, and each time a consumer that keyed off them silently
     * flipped. The menu's stacked arrangement reads this.
     */
    tall: height > Math.round(width / BOARD_ASPECT),
  };
}

/**
 * The live frame. One object, mutated in place, shared by reference.
 *
 * Mutated rather than replaced because `CardLayer` hands the same object down to
 * every `CardHand`, and `main.js` hands it to `CardFx` and `CardFlight` — all of
 * which read `frame.height` per update. Replacing the object would leave those
 * holding the old one; mutating it means they follow for free and only the
 * things that CACHE a derived number (an orthographic frustum, a completed
 * `layout()`) need telling.
 *
 * Starts at the board's own size, so anything that reads it before the first
 * `_fit` sees exactly the 640x480 that used to be hard-coded.
 */
export const FRAME = resolveFrame(MAX_FRAME_WIDTH, Math.round(MAX_FRAME_WIDTH / BOARD_ASPECT));

/** Recompute `FRAME` in place. Returns true when the shape actually moved. */
export function updateFrame(windowW, windowH) {
  const next = resolveFrame(windowW, windowH);
  /**
   * Every field that anything downstream caches, not just the outer box.
   *
   * The width moves (it is the UI scale) and so does the play area (it is the
   * field's shape) — and the play area can change with the window untouched,
   * on a mode switch from a square board to a long lane. Comparing only the
   * outer box early-returned on exactly that case and left the region, the
   * camera aspect and every `layout()` stale.
   */
  if (
    next.height === FRAME.height &&
    next.width === FRAME.width &&
    next.boardHeight === FRAME.boardHeight &&
    next.topBand === FRAME.topBand
  ) {
    return false;
  }
  Object.assign(FRAME, next);
  return true;
}

/**
 * Where the board sits, as a fraction of the frame — the form a scissor
 * rectangle and a pointer re-basing both want.
 *
 * y is measured from the BOTTOM, because that is what WebGL's viewport and
 * scissor take and converting once here is better than remembering to flip at
 * each call site.
 */
export function boardRectNormalised() {
  return {
    x: 0,
    y: FRAME.bottomBand / FRAME.height,
    w: 1,
    h: FRAME.boardHeight / FRAME.height,
  };
}

/**
 * An orthographic camera covering exactly the frame, origin at its centre.
 *
 * Six layers built this identically — `HudLayer`, `CardLayer`, `ModalLayer`,
 * `MatchFoundLayer`, `VictoryLayer`, `CapWipe` — and none of them had a way to
 * rebuild it, which was fine while the frame was a constant. `near`/`far` and
 * `z` differ between them (the two that animate caps flying in from off-screen
 * need a deep box), so those stay parameters.
 */
export function frameCamera({ near = -100, far = 100, z = 10 } = {}) {
  const cam = new OrthographicCamera(
    -FRAME.width / 2,
    FRAME.width / 2,
    FRAME.height / 2,
    -FRAME.height / 2,
    near,
    far,
  );
  cam.position.z = z;
  return cam;
}

/**
 * Re-fit a camera made by `frameCamera` to the frame's current shape.
 *
 * Returns true when it actually moved, so a caller can skip the `layout()` that
 * usually follows. Cheap enough to call on every resize regardless.
 */
export function refitFrameCamera(cam) {
  const left = -FRAME.width / 2;
  const right = FRAME.width / 2;
  const top = FRAME.height / 2;
  const bottom = -FRAME.height / 2;
  if (cam.left === left && cam.right === right && cam.top === top && cam.bottom === bottom) {
    return false;
  }
  cam.left = left;
  cam.right = right;
  cam.top = top;
  cam.bottom = bottom;
  cam.updateProjectionMatrix();
  return true;
}

/**
 * Half the frame's diagonal — the radius that certainly clears every corner.
 *
 * `VictoryLayer` uses it to know when the losing cap has left the screen and
 * `CapWipe` to know how far the wipe has to reach to cover it. Both had it as a
 * module constant computed once from 640x480; both are wrong the moment the
 * frame gets taller (the cap vanishes while still visible; the wipe leaves a
 * gap). A function, because the answer now changes.
 */
export function halfDiagonal() {
  return Math.hypot(FRAME.width, FRAME.height) / 2;
}

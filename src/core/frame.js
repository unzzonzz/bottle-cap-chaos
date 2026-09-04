/**
 * The layout box every overlay is drawn in.
 *
 * ── why this file exists ─────────────────────────────────────────────────────
 * There were seven copies of `{ width: 640, height: 480 }` in this project —
 * `HudLayer`, `CardLayer`, `ModalLayer`, `IntroLayer`, `VictoryLayer`, the cap
 * wipe and the safe-area module — and not one of them imported from another.
 * That was harmless while the number was a constant. It stops being harmless the
 * moment the box can change size, because seven independent constants cannot be
 * changed together. Fifteen modules import from here now; the safe-area one is
 * gone with the mobile build.
 *
 * ── the shape is 4:3 and does not vary. The SIZE does ────────────────────────
 * One axis moves, and it is not the shape.
 *
 * The WIDTH is the UI SCALE. Every horizontal constant in the UI — the 300-wide
 * score plate, the 240-wide turn plate, the 160-wide button — was chosen against
 * 640, and none of them changes here. What changes is how many CSS pixels one
 * frame pixel is worth. Pinning the frame at 640 in an 800-px-wide window made
 * every one of them two thirds of its authored size; narrowing the frame scales
 * all of them together and leaves every PROPORTION exactly as authored. See
 * `MIN_CSS_PX_PER_FRAME_PX` in `tokens.js` — it is the one dial.
 *
 * The HEIGHT is width / 4:3, always. That is the whole of the shape rule.
 *
 * ── what used to be here, and why it went ────────────────────────────────────
 * This file used to let the frame grow TALLER than 4:3, and reserve two
 * horizontal bands out of the surplus for the HUD and the card hand to anchor
 * in. Both existed for one reason: a phone held in portrait, where a 4:3 canvas
 * is a strip across the middle of the screen with black above and below it.
 *
 * There is no phone any more. A desktop window that is taller than 4:3 gets the
 * same treatment every window that is WIDER than 4:3 already got — the canvas is
 * the largest 4:3 box that fits, centred, with `--msa-void` around it. That is
 * `Viewport._fit`, it is one code path now instead of two, and it is why every
 * band number below this line is gone rather than merely unused:
 *
 *   `topBand` `bottomBand`   surplus height to reserve. There is no surplus.
 *   `boardTop` `boardBottom` the play area's edges. It is the frame.
 *   `boardWidth` `boardHeight` `boardAspect`  the frame, the frame, `aspect`.
 *   `tall`                   height > 4:3 height. Never.
 *   `fieldAspect`            written by `setFieldAspect`, read by nothing. The
 *                            comment claiming `boardRect` read it was false.
 *
 * The invariant worth remembering: a canvas at least 800 CSS px wide resolves to
 * a 640x480 frame, so every window from that size up is bit-identical to the way
 * it was before this file existed. 800 is 640 x MIN_CSS_PX_PER_FRAME_PX, and
 * that is the whole of the reason.
 */

import { OrthographicCamera } from 'three';
import { MIN_CSS_PX_PER_FRAME_PX } from './tokens.js';

/**
 * The widest the frame ever gets, and the size every UI constant was authored at.
 *
 * Any window from 800 CSS px of canvas width up resolves to exactly this, which
 * is most of them, so nothing on a normal desktop moves by a pixel.
 */
export const MAX_FRAME_WIDTH = 640;

/**
 * The floor, so the frame cannot shrink to the point of absurdity.
 *
 * ── 240 was a phone's portrait width. This is not that ───────────────────────
 * The floor only binds below 400 CSS px of canvas — 320 x 1.25 — which is a
 * window narrower than any desktop browser is usable at. What it actually
 * guarantees is a ceiling on how large the UI can get RELATIVE to the frame:
 * half of 640 means no authored constant can take more than twice the share of
 * the screen it was drawn to take. At the old 240 the 160-wide button was 67% of
 * the frame, which is past the point where the layout means anything.
 */
export const MIN_FRAME_WIDTH = 320;

/** The frame's aspect, and the 3D camera's. Fixed. */
export const BOARD_ASPECT = 4 / 3;

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

/**
 * Resolve the frame for a window shape.
 *
 * @param {number} windowW  CSS pixels
 * @param {number} windowH  CSS pixels
 * @returns {{width:number, height:number, aspect:number}}
 */
export function resolveFrame(windowW, windowH) {
  const w = Math.max(1, windowW);
  const h = Math.max(1, windowH);

  /**
   * The scale is settled against the CANVAS, not the window, and that is why
   * this iterates.
   *
   * The UI scale is `canvasWidth / frameWidth`, and the canvas width depends on
   * the window's shape — a tall window is width-limited, a wide one is
   * height-limited. Two passes because the first one is computed against the
   * starting guess of 640 and the second confirms it against the width that
   * guess produced. With the aspect now fixed at 4:3 the second pass moves the
   * answer only when the first crossed one of the two clamps.
   *
   * Sizing off the CANVAS rather than the WINDOW is what makes a short, wide
   * window scale. There the canvas is height-limited and much narrower than the
   * window — 424 of a 716-wide one — so sizing off the window would leave the UI
   * at desktop scale inside a canvas half that size.
   */
  let width = MAX_FRAME_WIDTH;
  let height = Math.round(width / BOARD_ASPECT);

  for (let pass = 0; pass < 2; pass++) {
    const canvasW = canvasWidthFor(width, height, w, h);
    width = Math.round(
      Math.min(MAX_FRAME_WIDTH, Math.max(MIN_FRAME_WIDTH, canvasW / MIN_CSS_PX_PER_FRAME_PX)),
    );
    height = Math.round(width / BOARD_ASPECT);
  }

  return {
    width,
    height,
    /**
     * `width / height`, not `BOARD_ASPECT`.
     *
     * The two differ by up to 0.1% because the height is rounded to a whole
     * frame pixel, and `Viewport._fit` uses THIS one to size the canvas so that
     * the orthographic UI box and the canvas have the same shape exactly. Using
     * 4/3 there instead would put a fraction of a percent of vertical squash
     * into every overlay, for nothing.
     */
    aspect: width / height,
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
 * Starts at the authored size, so anything that reads it before the first `_fit`
 * sees exactly the 640x480 that used to be hard-coded.
 */
export const FRAME = resolveFrame(MAX_FRAME_WIDTH, Math.round(MAX_FRAME_WIDTH / BOARD_ASPECT));

/**
 * 저술 크기를 지금 프레임에 맞추는 배수. 1 이 상한이다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * `tokens.js` 의 SIZE / SPACE / TYPE 는 640 폭 프레임을 기준으로 골랐다. 그런데
 * `resolveFrame` 은 창이 작으면 프레임을 좁게 잡는다 — 그게 작은 창에서 UI 가
 * 커 보이게 하는 장치다. 그 결과 800x459 창(프레임 421x316)에서는 토큰이 프레임의
 * 훨씬 큰 비율을 차지하고, 여러 개가 쌓이는 곳에서는 그냥 넘친다: 모달은 프레임
 * 높이를 정확히 100% 먹었고, 설정 화면은 제목과 마지막 두 줄이 화면 밖이었다.
 *
 * 1 을 넘지 않는 이유는 640 이 **최대** 프레임 폭이기 때문이다. 더 큰 창에서는
 * 프레임이 640 에 머물고 캔버스만 커지므로, 저술 크기가 그대로 맞다.
 *
 * 여기 있는 이유는 `tokens.js` 에 둘 수 없기 때문이다 — 이 파일이 tokens 를
 * 읽으므로 반대 방향 import 는 순환이 된다. `MIN_CSS_PX_PER_FRAME_PX` 의 주석에
 * 그 사고의 전말이 있다.
 */
export function frameScale() {
  return Math.min(1, FRAME.width / MAX_FRAME_WIDTH);
}

/**
 * Recompute `FRAME` in place. Returns true when the shape actually moved.
 *
 * Comparing the width alone would do — the height is derived from it — but both
 * are compared because that is the pair every caller downstream caches, and a
 * change-detector that tests fewer fields than it protects is how the last one
 * went stale.
 */
export function updateFrame(windowW, windowH) {
  const next = resolveFrame(windowW, windowH);
  if (next.width === FRAME.width && next.height === FRAME.height) return false;
  Object.assign(FRAME, next);
  return true;
}

/**
 * An orthographic camera covering exactly the frame, origin at its centre.
 *
 * Six layers built this identically — `HudLayer`, `CardLayer`, `ModalLayer`,
 * `IntroLayer`, `VictoryLayer`, `Cinematic` — and none of them had a way to
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
 * It had two callers and both are gone: the victory screen used it to know when
 * the losing cap had left the frame, and the cap wipe to know how far it had to
 * grow to cover one. Both had it as a module constant computed once from
 * 640x480 and both were wrong the moment the frame changed size, which is why it
 * became a function.
 *
 * Kept, unused, because the fact it states — the radius from the centre that
 * certainly clears every corner — is the one thing anything covering this frame
 * from the middle has to know, and re-deriving it is how the stale constant got
 * written twice the first time.
 */
export function halfDiagonal() {
  return Math.hypot(FRAME.width, FRAME.height) / 2;
}

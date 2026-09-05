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
 * ── the HEIGHT is the scale. The WIDTH is the shape ──────────────────────────
 * Two axes now, and they answer different questions.
 *
 * The HEIGHT is the UI SCALE. Every authored constant — the 190-wide score
 * area, the 160-wide button, every `SPACE` and `TYPE` value — was chosen against
 * a 640x480 frame, and none of them changes here. What changes is how many CSS
 * pixels one frame pixel is worth. Pinning the frame at its authored size in a
 * small window made every one of them a fraction of its authored share;
 * shrinking the frame scales all of them together and leaves every PROPORTION
 * exactly as authored. See `MIN_CSS_PX_PER_FRAME_PX` in `tokens.js` — it is the
 * one dial. `frameScale()` reads the height for the same reason.
 *
 * The WIDTH is `height * aspect`, and the aspect FOLLOWS THE WINDOW between
 * 4:3 and 16:9. That is policy C, and the reasoning is worth keeping:
 *
 *   A window between those two shapes gets a canvas that fills it exactly. No
 *   bars at all. Narrower than 4:3 letterboxes top and bottom; wider than 16:9
 *   pillarboxes. A 21:9 monitor was 42.9% flat cobalt under the old fixed 4:3
 *   and is 23.9% now.
 *
 *   4:3 is the FLOOR rather than the shape, so nothing that was authored at
 *   640x480 moves: at 4:3 this file returns exactly what it returned before.
 *   Above it, the extra width is new room at the left and right edges — which
 *   is where the direction puts the UI, and big margins are its main tool.
 *
 *   16:9 is a ceiling rather than "no limit" because `MAX_FRAME_HEIGHT` only
 *   bounds how large a constant can be relative to the frame if there IS a
 *   bound. An unbounded frame means an authored width has no upper reference
 *   at all, and a layout solved against one stops meaning anything.
 *
 * ── the two camera rules are safe, and that is arithmetic ────────────────────
 * `GameCamera.tanX = boardAspect * tanY`, so widening the frame multiplies
 * horizontal ground coverage and leaves vertical coverage EXACTLY unchanged.
 * Measured in football at one zoom: the visible half-extent along screen-up is
 * 31.1 world units at 4:3, at 16:9 and at 21:9 alike, while the half-extent
 * along screen-right goes 39.5 -> 52.6 -> 69.0.
 *
 * Both §0.4 rules — the whole pitch at football's minimum zoom, the throwing end
 * and the target line together at curling's — are about fields that are TALLER
 * than they are wide, so vertical is what binds. Widening cannot break them; it
 * can only add side margin. Curling at minimum zoom sees 64.6 x 48.4 against
 * extents of 18.8 x 39, and that 1.24x vertical headroom is untouched by any of
 * this.
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
 * The invariant worth remembering: a canvas at least 600 CSS px TALL resolves to
 * a frame 480 high, so every window from that size up carries the UI at exactly
 * its authored scale. 600 is 480 x MIN_CSS_PX_PER_FRAME_PX, and that is the
 * whole of the reason. It used to be stated about the width, which was the same
 * statement while the shape was fixed and is not any more.
 */

import { OrthographicCamera } from 'three';
import { MIN_CSS_PX_PER_FRAME_PX } from './tokens.js';

/**
 * The widest the frame ever gets, and the size every UI constant was authored at.
 *
 * Any window from 800 CSS px of canvas width up resolves to exactly this, which
 * is most of them, so nothing on a normal desktop moves by a pixel.
 */
export const MAX_FRAME_HEIGHT = 480;

/**
 * The floor, so the frame cannot shrink to the point of absurdity.
 *
 * The floor only binds below 300 CSS px of canvas height — 240 x 1.25 — which is
 * a window shorter than any desktop browser is usable at. What it actually
 * guarantees is a ceiling on how large the UI can get RELATIVE to the frame:
 * half of 480 means no authored constant can take more than twice the share of
 * the screen it was drawn to take.
 */
export const MIN_FRAME_HEIGHT = 240;

/**
 * The narrowest the frame gets, and the shape everything was authored at.
 *
 * A window narrower than this letterboxes rather than making the frame taller —
 * a taller frame is what the phone bands were for, and there is no phone.
 */
export const MIN_FRAME_ASPECT = 4 / 3;

/**
 * The widest. Beyond this the canvas pillarboxes.
 *
 * Policy C's ceiling. The header says why there is one at all.
 */
export const MAX_FRAME_ASPECT = 16 / 9;

/** The authored box: 640x480. Every constant in `tokens.js` was chosen here. */
export const AUTHORED_WIDTH = Math.round(MAX_FRAME_HEIGHT * MIN_FRAME_ASPECT);

/** The widest the frame ever gets. Derived, so the two ceilings cannot drift. */
export const MAX_FRAME_WIDTH = Math.round(MAX_FRAME_HEIGHT * MAX_FRAME_ASPECT);

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
   * The shape comes from the WINDOW, and only from the window.
   *
   * That is what stops this being circular. `Viewport._fit` sizes the canvas to
   * the frame's aspect, so if the frame's aspect came from the canvas the two
   * would be defined in terms of each other — which is exactly why the old
   * version had to iterate twice to settle. Clamping the window's own aspect
   * settles it in one step, and the loop is gone rather than merely shorter.
   */
  const aspect = Math.min(MAX_FRAME_ASPECT, Math.max(MIN_FRAME_ASPECT, w / h));

  /**
   * The scale is settled against the CANVAS, not the window.
   *
   * Sizing off the canvas is what makes a window that is the wrong shape scale
   * correctly: there the canvas is bar-limited on one axis and much smaller than
   * the window, so sizing off the window would leave the UI at full scale inside
   * a canvas half that size. With the aspect already known the canvas height is
   * one `min` — the largest box of that shape is height-limited in a wide window
   * and width-limited in a tall one.
   */
  const canvasH = Math.min(h, w / aspect);
  const height = Math.round(
    Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, canvasH / MIN_CSS_PX_PER_FRAME_PX)),
  );
  const width = Math.round(height * aspect);

  return {
    width,
    height,
    /**
     * `width / height`, not the `aspect` above.
     *
     * The two differ by up to a tenth of a percent because the width is rounded
     * to a whole frame pixel, and `Viewport._fit` uses THIS one to size the
     * canvas so that the orthographic UI box and the canvas have the same shape
     * exactly. Using the unrounded value there would put a fraction of a percent
     * of horizontal squash into every overlay, for nothing.
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
 * Starts at the AUTHORED box, not at whatever `resolveFrame` makes of a
 * 640x480 window — that window's canvas is 480 tall, which is 384 frame pixels
 * once the 1.25 floor is applied, and a pre-fit reader would see 512x384. The
 * old comment here claimed 640x480 and the code did not deliver it. `_fit`
 * overwrites this on the first frame either way; what it buys is that anything
 * reading the frame during construction sees the shape its constants were drawn
 * against.
 */
export const FRAME = {
  width: AUTHORED_WIDTH,
  height: MAX_FRAME_HEIGHT,
  aspect: AUTHORED_WIDTH / MAX_FRAME_HEIGHT,
};

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
 * **폭이 아니라 높이를 읽는다.** 정책 C 에서 폭은 창의 모양을 따라 640~853 을
 * 오가므로 크기가 아니라 **모양**이고, 크기를 폭으로 재면 넓은 창에서 UI 가
 * 저절로 작아진다. 높이는 저술 축이라 그런 일이 없다. 프레임이 4:3 일 때 두 값이
 * 정확히 같으므로, 이 변경은 4:3 창에서 아무것도 바꾸지 않는다.
 *
 * 1 을 넘지 않는 이유는 480 이 **최대** 프레임 높이이기 때문이다. 더 큰 창에서는
 * 프레임 높이가 480 에 머물고 캔버스만 커지므로, 저술 크기가 그대로 맞다.
 *
 * 여기 있는 이유는 `tokens.js` 에 둘 수 없기 때문이다 — 이 파일이 tokens 를
 * 읽으므로 반대 방향 import 는 순환이 된다. `MIN_CSS_PX_PER_FRAME_PX` 의 주석에
 * 그 사고의 전말이 있다.
 */
export function frameScale() {
  return Math.min(1, FRAME.height / MAX_FRAME_HEIGHT);
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

/**
 * 캔버스 텍스처를 몇 배로 구울 것인가. **화면이 정한다.**
 *
 * ── 왜 상수 2 로는 안 되는가 ────────────────────────────────────────────────
 * 이 프로젝트의 글자는 전부 캔버스에 구워져 쿼드에 붙는다. 텍셀 하나가 디바이스
 * 픽셀 하나보다 크게 늘어나면 그만큼 흐려진다 — 확대된 비트맵이기 때문이다.
 *
 * 얼마나 늘어나는지는 세 값의 곱이다:
 *
 *   frameScale()                   저술값이 이 프레임에서 몇 배로 줄었나
 *   innerHeight * pixelRatio       화면이 실제로 몇 픽셀인가
 *   / FRAME.height                 그 픽셀이 저술 좌표로 몇인가
 *
 * 실측: 1024x600 창(dpr 2)에서 프레임이 433x316 이면 저술 1px 이 디바이스
 * 2.5px 이고 frameScale 이 0.658 이라, 제목을 scale 1 로 구우면 텍셀 하나가
 * 디바이스 픽셀 1.646 개로 늘어난다. 그만큼 흐리다.
 *
 * 그래서 배수를 화면에서 되읽는다. 결과가 1 이면 텍셀과 픽셀이 1:1 이다.
 *
 * ── 0.5 단위로 끊는 이유 ────────────────────────────────────────────────────
 * 창을 끄는 동안 이 값이 연속으로 변하면 프레임마다 모든 글자를 다시 굽는다.
 * 끊어 두면 몇 단계에서만 다시 굽고, 그 사이의 오차는 최대 0.5 텍셀이라 눈에
 * 보이지 않는다. 위로 올림하는 것은 모자란 쪽이 흐림이고 남는 쪽은 메모리뿐이기
 * 때문이다.
 *
 * 상한 4 는 메모리다. 제목은 853x243 저술이므로 4 배면 3412x972, 13MB 다.
 */
export function texelScale() {
  if (typeof window === 'undefined') return 2;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const devicePerAuthored = ((window.innerHeight || FRAME.height) * ratio) / FRAME.height;
  const want = frameScale() * devicePerAuthored;
  return Math.max(1, Math.min(4, Math.ceil(want * 2) / 2));
}

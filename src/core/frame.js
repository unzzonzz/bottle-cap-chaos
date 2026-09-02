/**
 * The layout box every overlay is drawn in, and where the board sits inside it.
 *
 * ── why this file exists ─────────────────────────────────────────────────────
 * There were SEVEN copies of `{ width: 640, height: 480 }` in this project —
 * `HudLayer`, `CardLayer`, `ModalLayer`, `IntroLayer`, `VictoryLayer`, the
 * cap wipe, and a default argument in `safeArea` — and not one of them imported
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
import { MIN_CSS_PX_PER_FRAME_PX, SIZE, SPACE } from './tokens.js';

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
 * 각 밴드가 담아야 하는 높이, 프레임 픽셀.
 *
 * ── 값이 아니라 계산이다 ────────────────────────────────────────────────────
 * 190 과 230 이라는 상수였고, 그 숫자는 26 짜리 턴 플레이트와 42 짜리 스코어와
 * 192 짜리 카드에서 나온 것이었다. 그 셋 다 크기가 바뀌었다 — `tokens.js` 의
 * SIZE 가 지금 값을 갖고 있으므로 거기서 유도한다. 안 그러면 UI 를 키울 때마다
 * 여기 숫자를 손으로 따라 고쳐야 하고, 한 번 잊으면 카드가 밴드 밖으로 나간다.
 *
 * 위: 여백 + 스코어판(턴 플레이트와 클럭 바가 같은 줄에 들어간다) + 여백.
 * 아래: 여백 + 손패에서 보이는 카드 높이 + 드래그가 올라갈 여유.
 */
const TOP_BAND_NEED = SPACE.screenMargin * 2 + SIZE.scorePlate.h;
const BOTTOM_BAND_NEED = SPACE.screenMargin + SIZE.cardExposure + SPACE.xl;

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
   * `fieldAspect` 는 `setFieldAspect` 가 쓰기만 하고 `resolveFrame` 은 읽지 않는다.
   * 예전 주석은 "`boardRect`/`boardRectCss` 와 포인터 리베이싱이 읽는다"고 했는데
   * 사실이 아니다 — 그것들이 읽는 것은 `FRAME.topBand` 와 `boardHeight` 이고, 그
   * 둘은 위의 `playHeight` 에서 나온다. 모듈 변수는 밴드가 켜질 때 `playHeight` 를
   * 필드 비율에 맞춰 자를 값으로서 남겨 둔다.
   */
  /**
   * ── 밴드가 켜졌다. 보드에서 잘라내는 것이 아니라 UI 가 **앵커**하는 자리다 ──
   * 이 파일에는 밴드를 두 번 시도하고 두 번 되돌린 기록이 길게 적혀 있다. 세 번째
   * 답이 그 두 essay 가 이미 내려 둔 결론이다: 보드는 프레임 전체를 쓰고, 밴드는
   * HUD 와 손패가 어디에 붙을지를 말하는 **예약 영역**일 뿐이다.
   *
   *   가로 화면  height === boardHeight  ->  여분 0  ->  밴드 0. 어제와 완전히 동일.
   *   세로 화면  height  >  boardHeight  ->  여분에서 필요한 만큼만 밴드가 가져감
   *
   * ── 왜 보드를 밴드 사이로 가두지 않는가: 실측 ─────────────────────────────
   * 가둬 봤다. 312x608 프레임에서 보드는 312x312 정사각형이 되고 `boardAspect` 는
   * 1.0 이 되는데, 월드는 캔버스 전체(312x608)에 그려지므로 두 비율이 어긋나
   * **뚜껑이 세로로 늘어난 타원이 된다**. 고치려면 월드를 보드 사각형에만 그리는
   * scissor 경로가 필요하고, 그건 PHASE 1 이 저해상도 타겟과 함께 지운 것을 블룸
   * 체인 위에 다시 만드는 일이다.
   *
   * 그 값을 치를 이유가 없다. 밴드가 필요한 것은 UI 가 붙을 자리이지 보드를 자르는
   * 것이 아니고 — HUD 는 위 가장자리에, 손패는 아래 가장자리에 이미 앵커돼 있다 —
   * 잘라서 얻는 것은 세로 화면에서 보드가 51% 로 줄어드는 것뿐이다.
   *
   * 그래서 `boardHeight` / `boardAspect` / `boardTop` / `boardBottom` 은 프레임
   * 전체를 그대로 가리킨다. 렌더 경로는 한 줄도 바뀌지 않는다.
   */
  const playHeight = height;
  const wanted = TOP_BAND_NEED + BOTTOM_BAND_NEED;

  /**
   * 밴드는 4:3 최소치를 넘는 **여분**에서만, 그것도 필요한 만큼만 가져간다.
   *
   * 여분에서만 가져가는 것이 가로 화면을 건드리지 않는 이유다: 가로에서는 프레임
   * 높이가 정확히 4:3 이라 여분이 0 이고, 따라서 밴드가 0 이며, 이 함수가 내놓는
   * 모든 값이 밴드를 켜기 전과 같다.
   *
   * 필요한 만큼만 가져가는 것이 세로에서 UI 가 화면의 절반을 먹지 않는 이유다.
   * 312x608 을 예로 들면 여분이 374 인데 두 밴드가 원하는 것은 296 뿐이다.
   */
  const leftover = Math.min(wanted, Math.max(0, height - boardHeight));
  const need = wanted;
  const topBand = Math.round(leftover * (TOP_BAND_NEED / need));
  const bottomBand = leftover - topBand;

  return {
    width,
    height,
    boardWidth,
    /** The play area's ACTUAL height — the field's shape, within the bounds. */
    boardHeight: playHeight,
    /**
     * 플레이 영역의 비율. 원근 카메라가 이 값을 aspect 로 쓴다.
     *
     * 밴드가 꺼져 있는 지금은 `playHeight === height` 이므로 이 값은 아래의
     * `aspect` 와 항상 같다. 두 필드를 다 두는 이유는 밴드가 켜지는 순간 갈라지기
     * 때문이고, 카메라는 이쪽을 읽어야 하기 때문이다.
     */
    boardAspect: boardWidth / playHeight,
    topBand,
    bottomBand,
    /**
     * 보드 사각형의 위/아래 가장자리. 프레임 그 자체다.
     *
     * 예전에는 `topBand` 와 `topBand + playHeight` 였다. 밴드가 보드를 잘라낸다는
     * 전제였고, 그 전제가 사라졌으므로 값도 사라진다 — 밴드가 0 이 아닌 세로
     * 화면에서 `boardBottom` 이 프레임 높이를 넘어(608 프레임에 748) 있었는데,
     * 아무도 읽지 않아 조용했을 뿐이다. 읽는 쪽이 생기면 바로 틀리는 값이라
     * 지금 맞춰 둔다.
     */
    boardTop: 0,
    boardBottom: playHeight,
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

/**
 * 저술 크기를 지금 프레임에 맞추는 배수. 1 이 상한이다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * `tokens.js` 의 SIZE / SPACE / TYPE 는 640 폭 프레임을 기준으로 골랐다. 그런데
 * `resolveFrame` 은 창이 작으면 프레임을 좁게 잡는다 — 그게 폰에서 UI 가 커 보이게
 * 하는 장치다. 그 결과 800x459 창(프레임 421x316)에서는 토큰이 프레임의 훨씬 큰
 * 비율을 차지하고, 여러 개가 쌓이는 곳에서는 그냥 넘친다: 모달은 프레임 높이를
 * 정확히 100% 먹었고, 설정 화면은 제목과 마지막 두 줄이 화면 밖이었다.
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
 * 640x480 and both were wrong the moment the frame got taller, which is why it
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

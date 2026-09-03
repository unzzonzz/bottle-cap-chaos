import { Mesh, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import { FRAME, frameCamera, refitFrameCamera } from '../core/frame.js';
import { controlScale, controlState, easeInOut, stepControl } from './motion.js';
import { MATCH_STATE } from '../game/Match.js';
import { scoreboardFor } from '../game/modes.js';
import { PLAYER_COLORS } from '../render/playerColors.js';
import { HudMaterials } from './HudMaterial.js';
import {
  clearHudTextureCache,
  iconButtonTexture,
  scorePlateTexture,
  turnPlateTexture,
} from './hudTextures.js';
import { PALETTE } from '../core/palette.js';
import { ROLE, SIZE, SPACE } from '../core/tokens.js';

/**
 * The readouts, as meshes.
 *
 * ── its own scene, and why not the card layer's ─────────────────────────────
 * `CardFx` puts its screen root straight into `cards.scene`, so the precedent
 * for sharing exists and was considered. Two things decided against it:
 *
 *   LIFETIME. The card layer is a GAME SYSTEM — built with the match, re-dealt
 *     every round, disabled while a turn plays out. The HUD is instrumentation
 *     that has to be on screen whenever the game is, including when the hand is
 *     empty or locked. Sharing the scene makes "is the score visible" a
 *     consequence of the card layer's lifecycle, which is a bug waiting for
 *     whoever next changes how cards are dealt.
 *   THE SNAP DIAL. The brief asks for the HUD's vertex snap to be adjustable
 *     separately from the game's. Inside the card scene that means editing
 *     `CardMaterials.shared`, and the card system is not to be modified. Its
 *     own layer gets its own uniform for free — see `HudMaterial`.
 *
 * The cost is one more `render()` call.
 *
 * ── it is drawn UNDER the cards ─────────────────────────────────────────────
 * Game scene, depth clear, HUD, cards. So a card fanned over the exit button
 * covers it, which is the same answer the input order gives: cards are tested
 * first and do not fall through. Having the two disagree — a button drawn on
 * top of a card but a press going to the card — is the kind of thing that reads
 * as the game being broken.
 *
 * ── the frame is virtual and 4:3 is guaranteed ──────────────────────────────
 * The camera covers the shared frame box whatever the render target is set to,
 * exactly as `CardLayer` does, and `Viewport._fit` letterboxes the canvas to
 * 4:3 at every window size. So the display aspect is a CONSTANT and there is no
 * frustum to reshape — a small window gets a smaller 4:3 box, never a different
 * shape. What the brief actually wants out of that requirement is
 * here regardless: every position below is derived from a frame edge and a
 * margin, and there is not a world coordinate hard-coded anywhere.
 */

/**
 * The layout box, in frame pixels — the shared, live one.
 *
 * Re-exported rather than redeclared so every existing `HUD_FRAME.width` read
 * keeps working, but it is the LIVE object from core/frame.js: 4:3 always, 640
 * wide in any window with 800 CSS px of canvas or more, narrower below that so
 * the UI scales up. See that file's header.
 */
export const HUD_FRAME = FRAME;

/**
 * ── 상대 손패에 매달리던 장치는 여기 있었다 ─────────────────────────────────
 * `parkedHandReach()` 와 `BACK_ROW_REACH` 와 `SCORE_GAP` 이 이 자리에 있었고,
 * 셋이 함께 "점수판은 상대의 세워 둔 카드 아래에 걸린다" 를 계산했다. 점수판이
 * 이제 다른 세 변과 같은 `MARGIN` 에 붙으므로 셋 다 읽는 곳이 없다 — `layout()`
 * 의 `scoreTop` 주석에 그 거래의 내역이 있다.
 *
 * (`BACK_ROW_REACH` 는 그 전부터 이미 아무도 읽지 않는 상수였다. 근거가 "판은
 * 상대 손패에 매달려 있다" 였으니, 남겨 두면 이제는 틀린 말이 된다.)
 */
/**
 * 배치 수치. 전부 `tokens.js` 에서 온다.
 *
 * ── 예전 상수는 하나도 남지 않았다 ─────────────────────────────────────────
 * 208x42 스코어, 104x34 버튼, 34 아이콘, 152x26 턴 플레이트, 12 여백. 촘촘한
 * 작은 요소들의 배치였고, 새 방향은 그 반대다 — 요소를 크게 하고 개수를 줄인다.
 * 좌표계(가상 640 폭)만 재사용하고 숫자는 전부 다시 골랐다.
 *
 * 여기서 직접 정하는 것은 두 개뿐이다: 클럭 바의 두께와 긴급 임계 초. 나머지는
 * `SIZE`/`SPACE` 를 그대로 읽는다 — UI 를 키울 때 고칠 곳이 한 군데여야 한다.
 */
const SCORE = { width: SIZE.scorePlate.w, height: SIZE.scorePlate.h };

/**
 * How far a cinematic may have taken the HUD away before it stops answering.
 *
 * A half is not a taste: below it a white plate over the board has less contrast
 * than the board's own highlights, so it is not something a player could aim at
 * on purpose. The same number `CardLayer` uses, and it has to be — the two are
 * driven by one scalar, and a hand that stopped taking presses at a different
 * point from the HUD would be a window in which exactly one was reachable.
 */
const INPUT_GATE = 0.5;
const TURN = { width: SIZE.turnPlate.w, height: SIZE.turnPlate.h };
/**
 * 아이콘 버튼 지름. **턴 플레이트 높이와 같은 수**이고, 정원이다.
 *
 * ── 프레임에 반응하던 함수였다 ──────────────────────────────────────────────
 * `Math.round(Math.max(44, Math.min(SIZE.buttonIcon.w, frameW * 0.15)))` 였다.
 * 토큰의 64 는 640 폭 기준인데 세로 프레임은 322 라 아이콘 둘이 폭의 41% 를 먹었고,
 * 그 결과 **같은 줄에 있던** 턴 플레이트가 "PLAYE" 로 잘렸다 — 그 줄어드는 규칙은
 * 순전히 그 이웃 때문에 있었다. 턴 플레이트가 좌측 하단으로 내려가면서 이웃이
 * 없어졌으므로 규칙도 없어진다.
 *
 * 남는 질문은 "그럼 얼마나 큰가" 뿐이고, 답을 새로 고르는 대신 이미 화면에 있는
 * 높이를 쓴다. 나가기·리센터와 이름표는 같은 급의 읽을거리이므로 같은 높이가
 * 맞고, 무엇보다 숫자가 하나 줄어든다.
 *
 * 44 는 손가락 기준을 그대로 통과한다. `MIN_CSS_PX_PER_FRAME_PX` 가 1.25 이므로
 * 44 프레임 픽셀은 최소 55 CSS 픽셀이고, 44pt 터치 타깃을 넘는다 — 예전 규칙의
 * **하한**이 정확히 이 44 였다. 히트 쿼드는 여기에 `ui.hitMargin` 을 더 두른다.
 *
 * `SIZE.buttonIcon` 은 메뉴의 도구 버튼이 계속 읽으므로 토큰에 남는다. 경기
 * 화면이 그 값을 쓰지 않을 뿐이다.
 */
const ICON = TURN.height;
/** 턴 플레이트 아래의 온라인 턴 클럭. */
const TIMER_HEIGHT = SIZE.clockBar.h;
const TIMER_GAP = SPACE.xs;
/** 이 초 아래로 내려가면 바가 깜박인다. 브리프의 5초. */
const TIMER_URGENT_SEC = 5;
const MARGIN = SPACE.screenMargin;

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class HudLayer {
  /**
   * @param {HTMLCanvasElement} canvas  for mapping pointer coordinates
   * @param {import('three').Vector2} resolution  the low-res target's size
   * @param {() => void} onExit
   */
  /**
   * @param {() => void} [onRecenter]
   *   Put the camera back to the framing a turn change gives you. Handed in
   *   rather than reached for: the HUD has no camera and no idea what the
   *   default framing IS — `main.js` passes the same `faceCurrentPlayer(true)`
   *   the turn change calls, which is the whole of requirement 15.
   * @param {() => boolean} [atDefaultView]
   *   Whether the view is already there, for the dimming. Not for the hit test:
   *   the button answers a press whatever this says.
   */
  constructor({
    canvas,
    config,
    resolution,
    onExit,
    onRecenter,
    atDefaultView,
    reserved,
  }) {
    this.canvas = canvas;
    this.config = config;
    this.onExit = onExit ?? (() => {});
    this.onRecenter = onRecenter ?? (() => {});
    this._atDefaultView = atDefaultView ?? (() => false);
    /**
     * Whether a point belongs to the BOARD whatever is drawn over it.
     *
     * ── the one place the UI-before-caps rule gives way ─────────────────────
     * The buttons sit in the top-right corner, and at minimum zoom the knockout
     * board reaches x = 222 of the frame's 320 while their hit areas start at
     * 194. Zoomed IN the board fills the frame entirely, so there is no corner
     * left that is not over it — no placement makes this collision go away, and
     * shrinking the buttons only makes them harder to hit.
     *
     * So a press that would grab one of YOUR OWN caps goes to the cap, and the
     * button does not take it. Everywhere else — empty board, an opponent's cap,
     * the run-off — the button still wins, which is the whole of the input
     * order the brief asks for. `CardLayer._reserved` makes exactly this
     * exception for exactly this reason, against the same predicate, so the
     * cards, the caps and the HUD all agree about what a cap is.
     *
     * The exception is narrow by construction: `AimInput.hitTest` only answers
     * for the current player's shootable caps, and only while a shot is legal.
     */
    this._isReserved = reserved ?? (() => false);

    this.scene = new Scene();
    this.camera = frameCamera();

    this.materials = new HudMaterials({ resolution });

    // Hidden until the first `update` gives them a texture. A plate whose
    // sampler has never been bound is undefined behaviour, and the one frame it
    // could happen on is the first one anybody sees.
    const plate = (renderOrder) => {
      const m = new Mesh(new PlaneGeometry(1, 1), this.materials.create(null));
      m.renderOrder = renderOrder;
      m.visible = false;
      this.scene.add(m);
      return m;
    };

    this.score = plate(10);
    this.turn = plate(11);

    /**
     * The online turn clock, as two rectangles.
     *
     * ── it is drawn as GEOMETRY, and that is not a style choice ─────────────
     * A countdown is the one readout whose content changes every frame, and
     * `hudTextures` caches by literal content and is only ever emptied
     * wholesale. Drawing "12.4초" as type would allocate a canvas and a GPU
     * texture per tick and never free one — a texture leak for the length of the
     * match, growing fastest exactly when the player is under pressure.
     *
     * `iconButtonTexture` exists in that file for the same reason and says so:
     * rectangles are immune. So this is a track and a fill, and the countdown is
     * `fill.scale.x` — one material, no texture, nothing to cache.
     *
     * `createSolid` also means no `uMap`, so these two are deliberately NOT in
     * the plate list: the shared fade loop writes `uOpacity` on plates and reads
     * `userData.want`, which these follow, but they are appended to that list
     * below rather than built by `plate()`.
     */
    const bar = (renderOrder, opacity) => {
      const m = new Mesh(new PlaneGeometry(1, 1), this.materials.createSolid(opacity));
      m.renderOrder = renderOrder;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.timerTrack = bar(11, 0.55);
    this.timerFill = bar(12, 1);
    /**
     * The track's colour, set once.
     *
     * `createSolid` defaults its tint to the debug hit-area green, which is the
     * right default for the one thing it was written for and very much the wrong
     * one here — the spent portion of the clock came out bright green, reading as
     * a second, growing gauge rather than as an empty groove.
     */
    this.timerTrack.material.uniforms.uTint.value.set(0.09, 0.11, 0.15);
    this.exit = plate(12);
    this.recenter = plate(12);

    /**
     * The press targets, as oversized invisible quads.
     *
     * A real raycast against a quad with some GIVE in it, rather than a box
     * test against the plate — the brief asks for a hit area with margin so the
     * button is comfortable on a phone, and putting the margin in the GEOMETRY
     * means the ray result is the answer instead of the start of one. Same
     * argument `CardLayer` makes for its own hit quads.
     *
     * The score is deliberately not among them. It is a readout, not a control,
     * and a press that lands on it must fall through to whatever is underneath.
     */
    this._hits = [
      { id: 'exit', mesh: this._hitQuad(), plate: this.exit, motion: controlState() },
      { id: 'recenter', mesh: this._hitQuad(), plate: this.recenter, motion: controlState() },
    ];

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    /** Which control the pointer is over, or null. */
    this.hovered = null;
    /** Which control the press went down on. Released over it = a click. */
    this._pressed = null;

    /** 0 hidden, 1 shown. Eased; see `update`. */
    this._scoreShown = 0;
    /** Pulse envelope, 1 at the change and decaying to 0. */
    this._pulse = 0;
    this._scoreKey = '';
    /** What the emphasis beat watches. Not the same thing — see `_updateScore`. */
    this._pulseKey = '';
    this._turnKey = '';
    this._buttonKey = '';
    this._texScale = -1;

    this.layout();
  }

  _hitQuad() {
    // Visible only when the panel asks — but drawn at a real opacity when it
    // does, which the first version got wrong by creating these at 0 and then
    // toggling `visible`. A toggle that reveals a fully transparent box answers
    // the question "where is the hit area" with nothing at all.
    const m = new Mesh(new PlaneGeometry(1, 1), this.materials.createSolid(0.28));
    m.visible = false;
    m.renderOrder = 20;
    this.scene.add(m);
    return m;
  }

  setResolution(resolution) {
    this.materials.setResolution(resolution);
    // The frame can now change SHAPE, not just the target its pixels land in —
    // so the ortho box has to follow, and everything anchored to a frame edge
    // has to be placed again. `layout()` was previously only reachable from the
    // constructor and a mode change; this is the third door and the reason it
    // needed one.
    if (refitFrameCamera(this.camera)) this.layout();
  }

  /**
   * Place everything against the frame's edges.
   *
   * Called on construction and whenever the panel moves an offset — never per
   * frame, because none of it depends on time and recomputing a fixed layout
   * sixty times a second is how a HUD ends up drifting by a pixel.
   */
  layout() {
    const ui = this.config.ui;
    const halfW = HUD_FRAME.width / 2;
    const halfH = HUD_FRAME.height / 2;
    const frameW = halfW * 2;

    /**
     * MARGIN, per edge, with whatever the device has taken added on.
     *
     * MARGIN stays a single scalar because it is a design decision — 12 pixels
     * of breathing room — and the insets are a fact about the hardware. Adding
     * rather than replacing keeps the breathing room on a phone too: the exit
     * button 12 pixels from the frame edge and 12 from the notch, not flush
     * against the notch.
     *
     * ── 아래 가장자리도 이제 이 레이어의 것이다 ─────────────────────────────
     * "There is no bottom edge in this layer; the card hand owns it" 라고 적혀
     * 있었고, 턴 플레이트가 좌측 하단으로 내려오면서 사실이 아니게 됐다. 손패는
     * 여전히 자기 몫의 inset 을 `CardHand.update` 에서 따로 먹지만, 그건 손패가
     * 가장자리에 **걸쳐** 있기 때문이고 — 여기 붙는 판은 가장자리에서 떨어져
     * 있어야 하므로 네 번째 여백이 필요하다.
     */
    const edgeTop = MARGIN;
    const edgeRight = MARGIN;
    const edgeLeft = MARGIN;
    const edgeBottom = MARGIN;

    /**
     * 상단 중앙. **네 번째 가장자리**로서, 좌우와 같은 여백에 붙는다.
     *
     * ── 예전에는 가장자리가 아니라 상대 손패에 매달려 있었다 ────────────────
     * `scoreTop` 은 `parkedHandReach() + SCORE_GAP` 만큼 내려와 있었다. 상대의
     * 세워 둔 카드가 프레임 위에서 뻗어 내려오는 만큼을 비켜 준다는 뜻이었고,
     * 그 자체로는 옳은 계산이었다. 값이 문제였다:
     *
     *     가로 640x480   48 + 8  = 56    좌우 여백은 28
     *     세로 322x700   59 + 8  = 67    좌우 여백은 28
     *
     * 상단만 여백의 두 배 이상이라 HUD 전체가 아래로 처져 보였다. `edgeTop` 은
     * 이 파일에 이미 계산돼 있었으면서 **아무도 읽지 않는 변수**였는데, 그게
     * 이 어긋남의 흔적이다.
     *
     * `frame.js` 의 밴드 예산도 같은 말을 하고 있었다. `TOP_BAND_NEED` 은
     * `screenMargin + scorePlate.h + screenMargin` 이다 — 여백 28 위에 점수판이
     * 놓인다는 전제. 매달린 점수판은 그 밴드를 밑으로 11 픽셀 넘어가 있었다.
     * 이제 둘이 같은 수를 말한다.
     *
     * ── 카드와 겹치는 것은 알고 받아들인 값이다 ─────────────────────────────
     * 상대가 실제로 카드를 들고 있고 **동시에** 점수판이 보이는 순간(최소 줌)에는
     * 부채꼴의 아랫단이 판의 위쪽을 덮는다 — 가로에서 20, 세로에서 31 픽셀이고,
     * 카드 레이어가 HUD 위에 그려지기 때문이다. 세로에서는 숫자의 윗머리까지
     * 닿는다. 실측 스크린샷을 보고 받아들인 값이지 놓친 경우가 아니다.
     *
     * 반대쪽 값이 더 컸다. 손패는 매치 시작에 비어 있고 필드에서 주워야 차므로
     * 대부분의 시간 동안 그 자리는 그냥 빈 하늘이었고, 그 빈 하늘을 비켜 주느라
     * HUD 전체가 항상 28 픽셀 내려가 있던 것이 원래의 거래였다.
     *
     * 되돌리려면 이 한 줄을 `halfH - Math.max(edgeTop, 상대손패도달 + SPACE.xs)`
     * 로 바꾸면 된다. 그러면 손패가 있을 때만 내려간다 — 대신 점수판이 카드를
     * 주울 때마다 자리를 옮긴다.
     */
    const scoreTop = halfH - edgeTop;
    this.score.scale.set(this._scoreWidth ?? SCORE.width, SCORE.height, 1);
    this._scoreHome = {
      x: ui.scoreOffsetX,
      y: scoreTop - SCORE.height / 2 + ui.scoreOffsetY,
    };
    this.score.position.set(this._scoreHome.x, this._scoreHome.y, 0);

    /**
     * ── 상단은 두 줄, 그리고 턴 플레이트는 더 이상 그 중 하나가 아니다 ──────
     * 예전에는 턴 플레이트(152), 스코어(208), 나가기(104), 리센터(34)가 모두
     * 프레임 최상단 같은 줄에 있었고 640 폭 안에 넉넉히 들어갔다. 새 크기로는
     * 240 + 300 + 64 + 64 에 여백까지 더해 640 을 넘어서 — 넷이 서로 겹쳐 읽을 수
     * 없었고 — 그래서 스코어가 최상단 중앙을 혼자 쓰고 턴 플레이트와 두 컨트롤이
     * 아래 줄을 나눠 쓰는 배치가 됐다.
     *
     * 이제 턴 플레이트가 좌측 하단으로 내려간다. 아래 줄에 남는 것은 나가기와
     * 리센터 둘뿐이고, 둘은 각각 프레임의 왼쪽 끝과 오른쪽 끝에 있으므로 이 줄은
     * 사실상 **가운데가 비어 있는 줄**이다. 폭 다툼이 사라졌다는 뜻이라, 아래에서
     * `_turnMax` 를 정하던 "두 컨트롤 사이" 라는 제약도 함께 사라진다.
     */
    /**
     * ── 아래 줄은 점수판이 실제로 보일 때만 그 자리를 비켜 준다 ─────────────
     * 점수판은 최소 줌에서만 나타난다 — `_updateScore` 를 보라 — 그래서 경기
     * 대부분의 시간 동안 화면에 없다. 그런데 자리는 계속 잡아먹고 있었고, 그
     * 결과 800x459 창(프레임 421x316)에서 아래 줄이 화면의 59% 지점, 즉
     * 한가운데보다 **아래**에 떠 있었다.
     *
     * 자리를 무조건 비워 두었던 이유는 튐이었다: 점수가 나타날 때 아래 줄이
     * 순간이동하면 그게 더 나쁘다. 그래서 비우지 않고 **미끄러지게** 한다.
     * `_scoreShown` 은 이미 `scoreFadeSeconds` 에 걸쳐 0..1 로 움직이므로, 두 Y
     * 사이를 같은 값으로 보간하면 점수가 페이드인하는 동안 아이콘 줄이 함께
     * 내려온다. 튐이 아니라 한 동작이 된다.
     *
     * 반높이가 `Math.max(TURN.height, ICON)/2` 였다가 `ICON/2` 가 된 것은 줄에서
     * 턴 플레이트가 빠졌기 때문이다. `ICON === TURN.height` 이므로 두 식은 지금도
     * 같은 수를 내지만, 없는 것을 재는 식은 다음에 토큰을 만지는 사람에게 거짓말이
     * 된다.
     */
    this._rowTwoUp = scoreTop - ICON / 2;
    this._rowTwoDown = this._scoreHome.y - SCORE.height / 2 - SPACE.sm - ICON / 2;
    const rowTwoY = this._rowTwoDown;
    this._rowTwoY = undefined;

    /**
     * ── 프레임 폭은 640 이 아니다. 창에 따라 변한다 ─────────────────────────
     * `tokens.js` 의 SIZE 는 가상 640 폭 기준으로 골랐는데, `resolveFrame` 은
     * 창이 가로로 길면 프레임을 더 낮고 좁게 잡는다 — 800x459 창에서 실측 422 였다.
     * 그 폭에서 300 짜리 스코어는 71% 를 먹고, 240 짜리 턴 플레이트는 오른쪽
     * 아이콘과 33 픽셀 겹쳤다.
     *
     * 그래서 두 판은 프레임에 반응한다. 토큰 값은 상한이고, 좁은 프레임에서는
     * 비율이 이긴다. 텍스처는 이 폭으로 구워지므로 글자가 리샘플되지 않는다.
     */
    this._scoreWidth = Math.min(SCORE.width, frameW * 0.55);
    /**
     * 턴 플레이트가 쓸 수 있는 폭. **프레임의 왼쪽 절반**이다.
     *
     * 예전에는 "두 컨트롤 사이" 였다 — 같은 줄의 나가기와 리센터가 양옆에서
     * 밀어 주는 값. 판이 좌측 하단으로 내려가면서 그 줄에서 빠졌으므로 그 제약은
     * 없어졌고, 대신 새 이웃이 생겼다: **자기 손패**다. 손패는 아래 가장자리
     * 한가운데에 부채꼴로 펼쳐지므로, 판이 중앙선을 넘지 않는 한 겹칠 여지가
     * 가장 작다. 그래서 상한이 `halfW - edgeLeft` 다.
     *
     * 640 프레임에서는 292 라 토큰의 240 이 그대로 이기고, 322 프레임에서는
     * 133 으로 줄어든다 — 예전 규칙이 그 폭에서 내놓던 120 과 같은 자리다.
     */
    const turnLeft = -halfW + edgeLeft;
    this._turnMax = Math.max(
      TURN.height * 2,
      Math.min(TURN.width, halfW - edgeLeft),
    );

    /**
     * 나가기는 HUD 의 **왼쪽 끝**이다. 부록 B1.3 — 물러나는 것은 왼쪽이다.
     *
     * 예전에는 리센터와 나란히 오른쪽 끝에 붙어 있었다. 그 모서리는 "지금 이
     * 화면에서 할 수 있는 일" 의 자리이고, 나가기는 그 중 하나가 아니라 화면을
     * 떠나는 것이다. 둘이 같은 모서리에서 같은 크기·같은 스킨으로 붙어 있으면
     * 그 차이가 어디에도 없다 — 조사표가 두 화면에서 같은 지적을 했다.
     *
     * ── 점수판 줄이 아니라 이 줄인 이유 ────────────────────────────────────
     * 처음에는 점수판 줄의 왼쪽 끝에 두었다. 실제로 겹쳤다: 점수판은 최소 줌에서만
     * 나타나므로 대부분의 시간 동안 아래 줄이 **위로 미끄러져 올라와** 점수판
     * 자리를 쓰고, 그 줄의 왼쪽 끝에는 턴 플레이트가 있다.
     *
     * 그래서 같은 줄의 왼쪽 끝을 나가기가 가져가고, 턴 플레이트가 그만큼 오른쪽에서
     * 시작한다. 줄이 하나뿐이라면 그 줄의 왼쪽이 화면의 왼쪽이다.
     */
    const left = -halfW + edgeLeft + ICON / 2 + ui.exitOffsetX;
    this.exit.scale.set(ICON, ICON, 1);
    this.exit.position.set(left, rowTwoY + ui.exitOffsetY, 0);

    /**
     * 카메라 리셋. 아래 줄 오른쪽 끝.
     *
     * 도구다 — 지금 화면을 다시 잡아 주는 것이지 화면을 떠나는 것이 아니다.
     * 그래서 나가기가 왼쪽 위로 간 뒤에도 여기 남는다: 사람이 컨트롤을 찾는
     * 모서리이고, 카드 팬은 중앙에 모여 있어 여기까지 오지 않는다.
     */
    const right = halfW - edgeRight - ICON / 2;
    this.recenter.scale.set(ICON, ICON, 1);
    this.recenter.position.set(right, rowTwoY, 0);

    /**
     * 누구 차례인가 — **좌측 하단**. 네 여백이 전부 같은 28 이다.
     *
     * ── 위가 아니라 아래인 이유 ────────────────────────────────────────────
     * 위쪽 두 줄은 경기의 **상태**다: 점수, 그리고 화면을 떠나거나 다시 잡는
     * 두 컨트롤. "지금 내 차례" 는 상태가 아니라 **지금 손이 할 일**에 대한
     * 것이고, 손이 있는 곳은 아래다 — 자기 카드가 아래 가장자리에 펼쳐지고,
     * 조준 드래그가 시작되는 곳도 보드 아래쪽이다. 시선이 이미 가 있는 자리에
     * 붙이는 편이, 화면 반대쪽 끝에서 이름표를 찾게 하는 것보다 낫다.
     *
     * 오른쪽이 아니라 왼쪽인 것은 나가기와 같은 이유다(부록 B1.3). 오른쪽 끝은
     * "지금 할 수 있는 일" 의 모서리라 리센터가 이미 쓰고 있고, 읽기만 하는
     * 이름표는 그 모서리를 뺏지 않는다.
     *
     * ── 손패와의 거리는 폭으로 지킨다 ───────────────────────────────────────
     * 자기 손패는 아래 가장자리 **한가운데**에 부채꼴로 걸쳐 있다. 판은
     * `_turnMax` 때문에 중앙선을 넘지 못하므로 부채꼴의 중심과는 만나지 않고,
     * 부채꼴 왼쪽 끝자락과는 겹칠 수 있다 — 카드가 HUD 위에 그려지므로 그때는
     * 카드가 이긴다. 손패는 매치 시작에 비어 있고 필드에서 주워야 차므로 그
     * 상태가 경기의 기본값이다.
     */
    const turnY = -halfH + edgeBottom + TURN.height / 2;
    this.turn.scale.set(Math.min(TURN.width, this._turnMax ?? TURN.width), TURN.height, 1);
    this.turn.position.set(turnLeft + TURN.width / 2, turnY, 0);
    /**
     * The plate's LEFT edge, kept because the plate is no longer a fixed width.
     *
     * `position` is a centre, so a plate that grew to fit a nickname and was not
     * re-anchored would grow in both directions and hang off the left of the
     * screen. `_updateTurn` re-centres it against this every time the width
     * changes.
     */
    this._turnLeft = turnLeft;

    /**
     * 클럭은 판 **바로 위**다. 예전에는 바로 아래였다.
     *
     * 붙어 있고 같은 폭이라는 관계는 그대로다 — 그게 바가 별개의 계기가 아니라
     * 위/아래의 이름표에 딸린 것으로 읽히게 하는 전부다. 뒤집은 이유는 여백
     * 하나뿐이다: 판이 아래 가장자리 28 에 앉았으므로 그 밑에는 바가 들어갈
     * 자리가 없고, 억지로 넣으면 판이 여백에서 18 픽셀 떠오른다 — 클럭이 없는
     * 로컬·AI 대전에서는 아무것도 없는 자리를 위해 떠 있는 셈이 된다.
     */
    this._timerY = turnY + TURN.height / 2 + TIMER_GAP + TIMER_HEIGHT / 2;
    this.timerTrack.scale.set(TURN.width, TIMER_HEIGHT, 1);
    this.timerTrack.position.set(this._turnLeft + TURN.width / 2, this._timerY, 0);
    this.timerFill.scale.set(TURN.width, TIMER_HEIGHT, 1);
    this.timerFill.position.copy(this.timerTrack.position);

    for (const h of this._hits) {
      const pad = Math.max(0, ui.hitMargin);
      /**
       * 판정 영역은 **저술 크기**에서 잰다. 판의 현재 배율이 아니라.
       *
       * 부록 B 가 되돌린 배율 피드백 때문이다 — `_updateButtons` 가 매 프레임
       * 판을 눌린 만큼 줄이므로, 눌린 프레임에 `layout()` 이 돌면 판정 영역이
       * 그 줄어든 크기를 물려받아 그대로 굳는다.
       */
      h.mesh.scale.set(ICON + pad * 2, ICON + pad * 2, 1);
      h.mesh.position.copy(h.plate.position);
    }
  }

  // ── per frame ──────────────────────────────────────────────────────────────

  /**
   * @param {number} dt              render seconds
   * @param {import('../game/Match.js').Match} match
   * @param {import('../render/GameCamera.js').GameCamera} gameCamera
   */
  /**
   * @param {number} [fade]
   *   Multiplied into everything. Drawing a shot takes it to 0: while the bow
   *   is out, the board is the only thing worth looking at, and a score sitting
   *   over the pitch you are aiming across is in the way at exactly the moment
   *   precision matters. Applied last so it cannot argue with the score's own
   *   zoom fade or the buttons' dimming — both still run underneath it.
   *
   *   Opacity ONLY. It does not gate the hit test, and that is deliberate:
   *   "흐린 상태에서도 클릭은 동작한다" is a rule about DIMMING, and a control
   *   faded under the player's own hand is still a control they meant to press.
   *   What gates the press is `gate` below.
   * @param {number} [gate]
   *   0..1, whether this layer is on screen at all. `Cinematic.uiGate`.
   *
   *   ── it gates the HIT TEST, and `fade` does not ─────────────────────────
   *   Two scalars because they are two different facts. `fade` is the player's
   *   own bow pushing the readouts out of the way, and it comes back the moment
   *   they let go. This one is a SEQUENCE owning the screen — the opening, or
   *   the ending — and while one does, a control that is invisible and still
   *   answers presses is worse than one that is visible and does not: you
   *   cannot even tell you hit it. Below `INPUT_GATE` the hit test reports
   *   nothing.
   *
   *   The two are multiplied for the opacity by the caller, never here; see the
   *   note on the two fades in `main.js`.
   */
  /**
   * @param {(player: number) => string} [labelFor]
   *   What to append after "PLAYER n" for a given seat. `" (AI)"` for a computer
   *   opponent, empty for a person.
   *
   *   A function of the PLAYER rather than a flag, because the HUD has no
   *   business knowing which seats are computers — it is handed the suffix by
   *   whoever built the controllers, the same way `usable` and `silenced` are
   *   handed to the card layer. Local play passes nothing and the plate is
   *   character for character what it was.
   */
  update({
    dt,
    match,
    gameCamera,
    fade = 1,
    gate = 1,
    labelFor = null,
    nameFor = null,
    outcomeFor = null,
    turnClock = null,
  }) {
    const ui = this.config.ui;
    this._fade = fade;
    this._gate = gate;

    if (ui.textureScale !== this._texScale) {
      // Every plate is re-asked for below and the cache has just been emptied,
      // so the swap happens before anything is drawn and no disposed texture is
      // ever bound.
      this._texScale = ui.textureScale;
      clearHudTextureCache();
      this._scoreKey = this._turnKey = this._buttonKey = '';
    }

    this._updateScore(dt, match, gameCamera);
    this._updateTurn(match, labelFor, nameFor, outcomeFor);
    this._updateTimer(turnClock);
    this._updateButtons(dt);

    /**
     * Last, over the top of whatever each updater decided for itself.
     *
     * Visibility is settled HERE, every frame, from `want` — never inside the
     * updaters. Two of them early-return when nothing they draw has changed, so
     * a plate hidden by the fade in one of those frames would never be told to
     * come back and would stay gone for the rest of the match.
     */
    for (const m of [
      this.score,
      this.turn,
      this.exit,
      this.recenter,
      this.timerTrack,
      this.timerFill,
    ]) {
      // ASSIGNED from the plate's own base, never multiplied into what is
      // already there. Multiplying looks equivalent and is not: `turn` does
      // not rewrite its opacity every frame, so the product
      // compounded on each one and both faded to nothing over a second of
      // aiming and never came back.
      const o = m.material.uniforms.uOpacity;
      o.value = (m.userData.base ?? 1) * fade;
      m.visible = m.userData.want === true && o.value >= 0.004;
    }

    for (const h of this._hits) h.mesh.visible = ui.showHitAreas && fade > 0.5;
  }

  /**
   * ── the score shares the camera's own threshold ──────────────────────────
   * `gameCamera.atMinZoom` is the SAME getter `GameCamera.dragMode` asks to
   * decide whether a drag turns the field. Not a copy of its arithmetic and not
   * a second constant that happens to match — the getter itself. So there is no
   * zoom at which the field rotates but the score has gone, which is the one
   * failure this requirement exists to prevent, and it stays true if the band
   * on the panel is moved.
   */
  _updateScore(dt, match, gameCamera) {
    const ui = this.config.ui;

    const forced = ui.forceScore;
    const want =
      forced === 'on' ? 1 : forced === 'off' ? 0 : gameCamera?.atMinZoom ? 1 : 0;
    const rate = dt / Math.max(0.02, ui.scoreFadeSeconds);
    this._scoreShown += Math.max(-rate, Math.min(rate, want - this._scoreShown));

    const board = scoreboardFor(match.mode, match.rules, this.config);

    /**
     * ── the beat is fired off `pulseKey`, the texture off `key` ─────────────
     * They are the same string in the modes whose caption never changes, and
     * they must not be assumed to be. Curling's caption counts the throws left,
     * so its `key` moves every single turn while the thing the flourish is about
     * — how many caps are in the house — has not; keyed on one string the score
     * would flash eight times a match at nothing. See `scoreboardFor`.
     */
    const pulseKey = board.pulseKey ?? board.key;
    if (pulseKey !== this._pulseKey) {
      // First build is not a change; pulsing on the opening frame would fire
      // the flourish at something nobody did.
      if (this._pulseKey !== '') this._pulse = 1;
      this._pulseKey = pulseKey;
    }

    const scoreKey = `${board.key}|${Math.round(this._scoreWidth ?? SCORE.width)}`;
    if (scoreKey !== this._scoreKey) {
      this._scoreKey = scoreKey;
      this.score.material.uniforms.uMap.value = scorePlateTexture(
        {
          key: board.key,
          left: { value: board.left, color: PLAYER_COLORS[0] },
          right: { value: board.right, color: PLAYER_COLORS[1] },
          caption: board.caption,
        },
        // 실제로 그려지는 폭으로 굽는다. 토큰 값으로 구운 뒤 메시만 줄이면
        // 글자가 리샘플되어 흐려진다. 캐시 키에 폭이 들어 있으므로 안전하다.
        { ...SCORE, width: this._scoreWidth ?? SCORE.width, scale: ui.textureScale },
      );
    }

    this._pulse = Math.max(0, this._pulse - dt / Math.max(0.05, ui.scorePulseSeconds));
    // Up and back down over the life of the envelope, so it reads as a beat
    // rather than as a size change that then relaxes.
    const bump = Math.sin(Math.PI * this._pulse) * ui.scorePulseScale;
    const shown = smoothstep(this._scoreShown);
    /**
     * 너비는 `layout()` 이 프레임에 맞춰 정한 값에서 출발한다.
     *
     * 여기서 `SCORE.width` 를 그대로 쓰면 좁은 프레임에서의 반응형 축소가 매
     * 프레임 덮어써진다 — `layout()` 이 231 로 잡아 놓은 것을 첫 프레임에 300 으로
     * 되돌리는 식이라, 화면에서는 축소가 아예 없던 것처럼 보였다.
     */
    const scoreW = this._scoreWidth ?? SCORE.width;
    this.score.scale.set(scoreW * (1 + bump), SCORE.height * (1 + bump), 1);
    this.score.userData.base = shown;
    this.score.userData.want = shown > 0.004;

    /**
     * 아래 줄은 점수판이 나타나는 만큼 내려간다. `_rowTwoUp`/`_rowTwoDown` 의
     * 주석에 왜 자리를 비워 두지 않고 미끄러지게 했는지 적혀 있다.
     *
     * 곡선이 페이드와 다르다. 페이드는 `smoothstep` 이고 — 불투명도는 양 끝에서
     * 천천히 시작하고 끝나면 된다 — 위치는 `MOTION.easeInOut` 이다. 두 지점 사이를
     * 움직여 **멈추는** 것이라 감속이 눈에 보여야 하고, 그게 이 곡선이 하는 일이다.
     */
    this._applyRowTwo(easeInOut(this._scoreShown));
  }

  /**
   * 아래 줄(나가기와 리센터)을 `shown` 위치에 놓는다.
   *
   * ── 턴 플레이트와 클럭은 더 이상 이 줄을 타지 않는다 ───────────────────────
   * 둘은 좌측 하단으로 내려갔고, 그쪽은 점수판이 나타나든 말든 움직일 이유가
   * 없는 자리다. 여기 남겨 두었다면 화면 아래에 붙은 판이 위쪽 점수판의
   * 페이드에 맞춰 위아래로 미끄러졌을 것이다 — `_timerY` 까지 같이 밀리면서.
   */
  _applyRowTwo(shown) {
    if (this._rowTwoUp === undefined || this._rowTwoDown === undefined) return;
    const y = this._rowTwoUp + (this._rowTwoDown - this._rowTwoUp) * shown;
    if (y === this._rowTwoY) return;
    const dy = y - (this._rowTwoY ?? this._rowTwoDown);
    this._rowTwoY = y;
    this.exit.position.y += dy;
    this.recenter.position.y += dy;
    for (const h of this._hits) h.mesh.position.y = h.plate.position.y;
  }

  _updateTurn(match, labelFor, nameFor, outcomeFor) {
    this.turn.userData.want = true;
    this.turn.userData.base = 1;
    const over = match.state === MATCH_STATE.OVER;
    const player = match.rules.currentPlayer;
    // The suffix is on the TURN line only. The result line names a winner, and
    // whether that winner was a computer is not what the player is reading it
    // for — "PLAYER 2 (AI) 승리" is a longer way of saying the same thing on a
    // 152-pixel plate that has to hold it.
    const suffix = labelFor ? labelFor(player) : '';
    /**
     * A whole name, when somebody has one.
     *
     * Online seats are people with nicknames, and "PLAYER 2 (온라인)" would be a
     * longer way of not saying who you are playing. `nameFor` replaces the
     * "PLAYER n" half outright rather than appending to it — a suffix cannot
     * express "call this seat 한별 instead" — and returning nothing falls back to
     * exactly the plate this always drew, which is what local and AI play do.
     */
    const named = (nameFor ? nameFor(player) : '') || '';
    const winnerName = (over && nameFor ? nameFor(match.winner) : '') || '';
    /**
     * The same sentence the victory screen uses, for the same reason.
     *
     * This plate sits behind that screen, so a "AI 승리" here under a "패배"
     * there would be the game contradicting itself in two places at once.
     * `outcomeFor` answers null when there are two people at the board, and the
     * winner's name comes back.
     */
    const outcome = over && match.winner >= 0 ? outcomeFor?.(match.winner) : null;
    const text = over
      ? match.winner === -1
        ? '무승부'
        : (outcome ?? `${winnerName || `PLAYER ${match.winner + 1}`} 승리`)
      : named || `PLAYER ${player + 1}${suffix}`;
    const color = over
      ? match.winner >= 0
        ? PLAYER_COLORS[match.winner]
        : PALETTE.neutral
      : PLAYER_COLORS[player];

    const key = `${text}|${color}`;
    if (key === this._turnKey) return;
    this._turnKey = key;
    const tex = turnPlateTexture(text, color, {
      ...TURN,
      // 프레임 왼쪽 절반까지가 이 판이 쓸 수 있는 전부다. `layout` 의 `_turnMax` 참조.
      maxWidth: this._turnMax ?? TURN.width,
      scale: this.config.ui.textureScale,
    });
    this.turn.material.uniforms.uMap.value = tex;
    // The plate sizes to its text now, so the quad has to follow it. Scaling to
    // anything else resamples the type.
    const w = tex.userData?.width ?? TURN.width;
    this.turn.scale.set(w, TURN.height, 1);
    if (this._turnLeft !== undefined) this.turn.position.x = this._turnLeft + w / 2;
    // The clock sits directly above the plate and is as wide as it is, so a long nickname
    // widens both together rather than leaving a bar that no longer lines up.
    this._timerWidth = w;
    if (this._timerY !== undefined) {
      this.timerTrack.scale.x = w;
      this.timerTrack.position.x = this._turnLeft + w / 2;
    }
  }

  /**
   * The turn clock.
   *
   * @param {{remaining: number, total: number}|null} clock
   *   Null in local and AI play — there is no clock, so there is no bar. The
   *   server owns the real timer; this is a readout of what it last said, which
   *   is why it takes a value rather than counting anything itself.
   */
  _updateTimer(clock) {
    const on = !!clock && clock.total > 0 && clock.remaining !== null;
    this.timerTrack.userData.want = on;
    this.timerFill.userData.want = on;
    this.timerTrack.userData.base = 1;
    if (!on) return;

    const t = Math.max(0, Math.min(1, clock.remaining / clock.total));
    // Scaled from the LEFT rather than about the centre: a bar that shrinks
    // toward its middle reads as two bars closing, not as time running out.
    const full = this._timerWidth ?? TURN.width;
    const w = Math.max(0.001, full * t);
    this.timerFill.scale.x = w;
    this.timerFill.position.x = this._turnLeft + w / 2;

    const urgent = clock.remaining <= TIMER_URGENT_SEC;
    const tint = this.timerFill.material.uniforms.uTint.value;
    if (urgent) {
      tint.set(1, 0.33, 0.25);
      /**
       * Flashing, on the clock's own value rather than on a frame counter.
       *
       * `remaining` is seconds, so this is 3 Hz whatever the frame rate — and it
       * cannot drift or stall on a throttled tab, which a per-frame counter
       * would. Never fully off: a bar that vanishes on alternate frames looks
       * broken rather than urgent.
       */
      const pulse = 0.55 + 0.45 * (Math.sin(clock.remaining * Math.PI * 6) * 0.5 + 0.5);
      this.timerFill.userData.base = pulse;
    } else {
      tint.set(0.88, 0.76, 0.42);
      this.timerFill.userData.base = 1;
    }
  }

  /**
   * ── the exit never leaves ────────────────────────────────────────────────
   * Zoomed in it drops to `dimOpacity` and stays there. It is not faded out and
   * it is not disabled: the opacity is a VISUAL weight so it stops competing
   * with the board, and the hit quad it is tested against does not know the
   * opacity exists. Hover brings it back to full and swaps in the brighter
   * plate.
   */
  _updateButtons(dt) {
    this.exit.userData.want = true;
    this.recenter.userData.want = true;
    const ui = this.config.ui;
    const dim = Math.min(1, Math.max(0, ui.dimOpacity));
    const shown = smoothstep(this._scoreShown);

    /**
     * Nothing to put back, so the button says so — and still works.
     *
     * "이미 기본 구도 상태면 흐리게 표시한다 (나가기 버튼의 줌인 시 처리와 동일한
     * 방식). 흐린 상태에서도 클릭은 동작한다." Same mechanism as the exit
     * button's zoom dimming, which is why it is the same `base` weight rather
     * than a second kind of fade — and `_hits` is untouched, so the hit quad
     * neither knows nor cares. A player who presses a dim reset gets the reset.
     */
    const settled = !!this._atDefaultView();

    for (const h of this._hits) {
      const hot = this.hovered === h.id;
      // Full weight when the board is wide (the same moment the score is up) or
      // when the pointer is on it; dimmed the rest of the time.
      let base = hot ? 1 : dim + (1 - dim) * shown;
      if (h.id === 'recenter' && settled && !hot) base = dim;
      h.plate.userData.base = base;
    }

    /**
     * 두 아이콘 버튼은 크기도 스킨도 바꾸지 않는다.
     *
     * 호버 텍스처는 여전히 idle 과 **다른 이름으로** 요청되지만 `skinFor` 가 둘을
     * 같은 스킨으로 접었으므로 그림이 같다. 이름을 남겨 두는 이유는 되돌리기가
     * 한 곳(`skinFor`)이면 끝나기 때문이다.
     *
     * 남는 피드백은 흐리기다 — 줌인 상태의 `dimOpacity` 와 호버 시의 복귀. 그건
     * 상호작용의 장식이 아니라 "이 버튼이 지금 얼마나 중요한가" 라서 남긴다.
     */
    /**
     * 크기는 눌린 만큼 줄고 얹힌 만큼 는다. 부록 B1.2 — 경기 화면은 예외다.
     *
     * 메뉴 판은 아무것도 하지 않는다. 여기가 다른 이유는 `ui/motion.js` 의
     * `controlState` 주석에 있다: 이 버튼들은 손가락으로 눌리고, 누르는 동안
     * 손가락이 판을 가린다. 색은 손가락 밑에서 바뀌고 크기는 테두리에서 바뀐다.
     *
     * 히트 쿼드는 따라가지 않는다. 눌러서 작아진 버튼의 판정 영역까지 같이
     * 작아지면, 가장자리를 누른 손가락이 누르는 순간 버튼 밖으로 나간다.
     */
    const size = ICON;
    for (const h of this._hits) {
      stepControl(
        h.motion,
        { hovered: this.hovered === h.id, pressed: this._pressed === h.id },
        dt,
      );
      const s = size * controlScale(h.motion);
      h.plate.scale.set(s, s, 1);
    }

    const key = `${this.hovered ?? '-'}|${ui.textureScale}|${size}`;
    if (key === this._buttonKey) return;
    this._buttonKey = key;
    /**
     * 둘 다 RETREAT 다 — 채우지 않은, 뜨지 않은 판.
     *
     * 부록 B: 나가기는 물러나는 것이고, 리센터는 도구다. 둘 중 어느 것도 이
     * 화면이 권하는 행동이 아니므로 채워진 판을 줄 이유가 없다. 채워진 판은
     * 경기 중에 딱 하나 — 카드 — 여야 하고, 그게 눈이 가야 할 곳이다.
     *
     * 둘을 가르는 것은 스킨이 아니라 **자리**다. 나가기는 왼쪽 위, 리센터는
     * 오른쪽 아래. 예전처럼 같은 모서리에 나란히 두면 자리도 스킨도 같아진다.
     */
    const iconBox = { size: ICON, scale: ui.textureScale, role: ROLE.RETREAT };
    this.exit.material.uniforms.uMap.value = iconButtonTexture(
      'exit',
      this.hovered === 'exit' ? 'hover' : 'idle',
      iconBox,
    );
    this.recenter.material.uniforms.uMap.value = iconButtonTexture(
      'recenter',
      this.hovered === 'recenter' ? 'hover' : 'idle',
      iconBox,
    );
  }

  // ── pointer ────────────────────────────────────────────────────────────────

  /**
   * Which control is under a point, or null.
   *
   * Tested against the oversized hit quads, never against the plates. The score
   * is not in the list at all rather than being tested and then ignored — a
   * readout that swallows a press it then does nothing with is worse than one
   * that was never asked.
   */
  hitAt(clientX, clientY) {
    // A sequence has the screen: see the note on `gate`. Not `fade`, which is
    // the player's own hand and leaves everything pressable.
    if ((this._gate ?? 1) < INPUT_GATE) return null;
    if (this._isReserved(clientX, clientY)) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    this.scene.updateMatrixWorld(true);

    const quads = this._hits.map((h) => h.mesh);
    const hits = this._ray.intersectObjects(quads, false);
    if (!hits.length) return null;
    return this._hits.find((h) => h.mesh === hits[0].object)?.id ?? null;
  }

  /** @returns {boolean} true if a control took the press and nothing else may have it. */
  pointerDown(clientX, clientY) {
    const id = this.hitAt(clientX, clientY);
    this._pressed = id;
    this.hovered = id;
    return !!id;
  }

  pointerMove(clientX, clientY) {
    // While a press is held, the hover follows whether it is still ON the
    // control it started on — that is what makes sliding off a cancel.
    const id = this.hitAt(clientX, clientY);
    this.hovered = this._pressed ? (id === this._pressed ? id : null) : id;
    return !!id;
  }

  /**
   * Fires on RELEASE over the same control, not on press.
   *
   * Ordinary button semantics, and it is what makes the gesture escapable: a
   * press that lands on 나가기 by mistake can be dragged off and released
   * harmlessly. The brief rules out a confirmation dialog for now, so this is
   * the only thing standing between a misplaced tap and leaving the match.
   */
  pointerUp(cancelled = false) {
    const id = this._pressed;
    this._pressed = null;
    if (!id || cancelled) return false;
    if (this.hovered !== id) return false;
    if (id === 'exit') this.onExit();
    else if (id === 'recenter') this.onRecenter();
    return true;
  }

  clearHover() {
    this.hovered = null;
  }

  get hovering() {
    return this.hovered !== null;
  }

  dispose() {
    for (const m of [
      this.score,
      this.turn,
      this.exit,
      this.recenter,
      this.timerTrack,
      this.timerFill,
    ]) {
      m.geometry.dispose();
    }
    for (const h of this._hits) h.mesh.geometry.dispose();
    this.materials.dispose();
    clearHudTextureCache();
    this.scene.clear();
  }
}

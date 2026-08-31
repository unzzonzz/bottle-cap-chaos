import { Mesh, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import { FRAME, frameCamera, refitFrameCamera } from '../core/frame.js';
import { CARD_ASPECT, cardScale, handExposure } from '../render/CardHand.js';
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
import { SIZE, SPACE } from '../core/tokens.js';

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
 * The camera covers a fixed 640x480 box whatever the render target is set to,
 * exactly as `CardLayer` does, and `Viewport._fit` letterboxes the canvas to
 * 4:3 at every window size. So the display aspect is a CONSTANT and there is no
 * frustum to recompute — a portrait phone gets a smaller 4:3 box, not a
 * different shape. What the brief actually wants out of that requirement is
 * here regardless: every position below is derived from a frame edge and a
 * margin, and there is not a world coordinate hard-coded anywhere.
 */

/** The layout box, in frame pixels. 4:3, matching the display. */
/**
 * The layout box, in frame pixels — now the shared one.
 *
 * Re-exported rather than redeclared so every existing `HUD_FRAME.width` read
 * keeps working, but it is the LIVE object from core/frame.js: 640 wide always,
 * 480 tall in landscape, taller in portrait. See that file's header.
 */
export const HUD_FRAME = FRAME;

/**
 * How far down the frame the opponent's parked hand reaches.
 *
 * Not a guess. `CardHand` places the top hand at `half - expose + grip` and
 * flips it, so its lowest point is `half - expose` — the `grip` term cancels
 * exactly, which is what it is there for. With `inactiveExposure` at 48 that is
 * y = +192, and it does not move with the hand's scale or its card count.
 *
 * The score sits below it. Anything above this line is the opponent's hand.
 */
/**
 * How far down the frame the opponent's parked hand reaches — ASKED, not assumed.
 *
 * This was the literal `48`, a hand-copied duplicate of `cards.inactiveExposure`,
 * and the note above explains the derivation that produced it. The derivation is
 * still right; what changed is that the answer is no longer a constant, because
 * a hand with a band of its own shows more of itself than one peeking over an
 * edge. Calling the same function the hand calls is what keeps the score from
 * drifting under the cards — the exact failure the old duplicate invited.
 */
function parkedHandReach(config) {
  const cfg = config.cards;
  const cardHeight = cfg.width * CARD_ASPECT;
  // 상대 손은 절대 들어 올려지지 않으므로 배율은 언제나 `inactiveScale` 이다 —
  // 부채꼴 전체에 걸리는 `cardScale` 을 곱해서. 이 곱을 빠뜨리면 점수판이 실제보다
  // 짧게 뻗은 손을 가정하고, 카드가 그 아래로 내려와 숫자를 덮는다.
  const scale = cfg.inactiveScale * cardScale(cfg);
  return handExposure(cfg, FRAME.topBand ?? 0, cardHeight, scale).parked;
}

/**
 * The other end of the score's band: the far row of pieces.
 *
 * The plate hangs from the parked hand — as high as it can go — and this is the
 * line it must not reach DOWN to. It therefore sets the plate's maximum HEIGHT
 * rather than its position, and the plate is 42 because of it: at the 64 it
 * started as, the bottom edge came to 120 and covered all three of the
 * opponent's caps, which on a board game is the score hiding the pieces.
 *
 * The number is the worst case across the two modes at their minimum zoom,
 * measured rather than guessed:
 *
 *   knockout, before the camera became rotatable   back row reached y = 143
 *   knockout, now that it frames the turning circle          y = 101
 *   football                                        the pitch is lower still
 *
 * 143 is kept because it is the tightest of them and a plate that fits the
 * tightest case fits all of them. It is a CHECK, not a coordinate — if the
 * framing ever changes again, this is the line to re-measure against.
 */
const BACK_ROW_REACH = 143;
/** Breathing room between the plate and the hand above it. */
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
/** 카메라 리셋 버튼. 단어가 아니라 아이콘이므로 정사각. */
/**
 * 아이콘 버튼 한 변. 좁은 프레임에서는 줄어든다.
 *
 * 토큰의 64 는 640 폭 프레임 기준이다. 세로 화면의 프레임은 312 폭이라 아이콘 두
 * 개가 폭의 41% 를 먹었고, 그 결과 턴 플레이트에 92 픽셀만 남아 "PLAYER 1" 이
 * "PLAYE" 로 잘렸다.
 *
 * 하한이 44 인 것은 손가락 때문이다. `MIN_CSS_PX_PER_FRAME_PX` 가 1.25 이므로 44
 * 프레임 픽셀은 최소 55 CSS 픽셀이고, 그건 44pt 터치 타깃 기준을 넘는다. 그 아래로는
 * 어떤 프레임 폭에서도 내려가지 않는다.
 */
function iconSize(frameW) {
  return Math.round(Math.max(44, Math.min(SIZE.buttonIcon.w, frameW * 0.15)));
}
const ICON_GAP = SPACE.sm;
const TURN = { width: SIZE.turnPlate.w, height: SIZE.turnPlate.h };
const SCORE_GAP = SPACE.xs;
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
      { id: 'exit', mesh: this._hitQuad(), plate: this.exit },
      { id: 'recenter', mesh: this._hitQuad(), plate: this.recenter },
    ];

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    /** Which control the pointer is over, or null. */
    this.hovered = null;
    /** Which control the press went down on. Released over it = a click. */
    this._pressed = null;
    /** 컨트롤별 호버/프레스 진행도. `motion.js` 가 민다. */
    this._motion = {};

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
    /**
     * Whether the opponent's hand is parked along the top edge.
     *
     * True for every mode that uses cards, which is every mode but curling. Only
     * `layout` reads it, and only to decide how far down the score hangs.
     */
    this._handParked = true;

    /**
     * How much of each frame edge iOS has taken, in frame pixels.
     *
     * Zero everywhere but on a notched phone, and zero even there in portrait —
     * the canvas is letterboxed to 4:3 and centred, so the notch lands in the
     * black band beside it rather than on the game. It is landscape that bites,
     * and only along the bottom, where the home indicator strip runs under the
     * card hand. `SafeArea` does that overlap arithmetic; this is only the
     * answer. See src/platform/safeArea.js.
     */
    this._safe = { top: 0, right: 0, bottom: 0, left: 0 };

    this.layout();
  }

  /**
   * Take the unsafe edges out of the layout box.
   *
   * Pushed in on change rather than read per frame, for the reason `layout`
   * itself is not called per frame — and a no-op when nothing moved, so the
   * resize path can call it unconditionally.
   *
   * @param {{top:number,right:number,bottom:number,left:number}} insets frame px
   */
  setSafeInsets(insets) {
    const next = {
      top: Math.max(0, insets?.top ?? 0),
      right: Math.max(0, insets?.right ?? 0),
      bottom: Math.max(0, insets?.bottom ?? 0),
      left: Math.max(0, insets?.left ?? 0),
    };
    const s = this._safe;
    if (
      next.top === s.top &&
      next.right === s.right &&
      next.bottom === s.bottom &&
      next.left === s.left
    ) {
      return;
    }
    this._safe = next;
    this.layout();
  }

  /**
   * A mode with no card system has nothing parked along the top edge.
   *
   * Pushed in on a mode change rather than asked for per frame, because the
   * layout is fixed and recomputing it sixty times a second is how a HUD ends up
   * drifting by a pixel — the reason `layout` is not called from `update`. A
   * no-op when nothing changed, so the mode switch can call it unconditionally.
   */
  setHandParked(on) {
    const next = !!on;
    if (next === this._handParked) return;
    this._handParked = next;
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
     * 아이콘 크기는 프레임에 따라 변하므로 텍스처도 그 크기로 구워야 한다.
     * `this._icon` 에 남기는 것은 `_updateButtons` 가 나중에 같은 값을 써야 하기
     * 때문이다 — 판 크기와 텍스처 크기가 어긋나면 아이콘이 리샘플된다.
     */
    const ICON = iconSize(frameW);
    this._icon = ICON;

    /**
     * MARGIN, per edge, with whatever the device has taken added on.
     *
     * MARGIN stays a single scalar because it is a design decision — 12 pixels
     * of breathing room — and the insets are a fact about the hardware. Adding
     * rather than replacing keeps the breathing room on a phone too: the exit
     * button 12 pixels from the frame edge and 12 from the notch, not flush
     * against the notch. There is no bottom edge in this layer; the card hand
     * owns it, and takes its own inset in `CardHand.update`.
     */
    const edgeTop = MARGIN + this._safe.top;
    const edgeRight = MARGIN + this._safe.right;
    const edgeLeft = MARGIN + this._safe.left;

    /**
     * Top centre, hung from the parked hand and reaching down no further than
     * it has to — see PARKED_HAND_REACH and BACK_ROW_REACH.
     *
     * HUNG rather than centred in the gap between the two. Centring looks more
     * balanced and is wrong: the gap is 49 pixels on one framing and 91 on
     * another, so its middle moves with the camera and the plate would drift
     * down over the board whenever the field got smaller. Hanging it puts it in
     * the same place — the top of the screen — under both.
     *
     * ── and it hangs from the MARGIN when there is no hand to hang from ──────
     * `PARKED_HAND_REACH` is 48 pixels reserved for the opponent's tucked cards.
     * A mode with the card system switched off does not draw them, so reserving
     * the space puts the plate 36 pixels lower than it needs to be over a strip
     * of empty screen — and on the curling lane those 36 pixels are exactly the
     * back out line, the line the whole overshoot penalty is judged at. Measured
     * at minimum zoom: the line lands at y = 170 and the plate's underside was at
     * 147, so the plate covered it outright.
     *
     * The number is a consequence of the card layer's layout, so it moves with
     * the card layer being there. See `setHandParked`.
     */
    /**
     * The top inset applies whichever branch this takes, but for two different
     * reasons. Hung from the parked hand, it follows because the HAND has moved
     * down by the inset (`CardHand.update` applies the same number) and the
     * plate hangs from the hand. Hung from the margin, it follows because it is
     * then an edge-anchored element like any other.
     */
    const scoreTop =
      halfH -
      this._safe.top -
      (this._handParked ? parkedHandReach(this.config) + SCORE_GAP : MARGIN);
    this.score.scale.set(this._scoreWidth ?? SCORE.width, SCORE.height, 1);
    this._scoreHome = {
      x: ui.scoreOffsetX,
      y: scoreTop - SCORE.height / 2 + ui.scoreOffsetY,
    };
    this.score.position.set(this._scoreHome.x, this._scoreHome.y, 0);

    /**
     * ── 상단은 이제 한 줄이 아니라 두 줄이다 ────────────────────────────────
     * 예전에는 턴 플레이트(152), 스코어(208), 나가기(104), 리센터(34)가 모두
     * 프레임 최상단 같은 줄에 있었고 640 폭 안에 넉넉히 들어갔다. 새 크기로는
     * 240 + 300 + 64 + 64 에 여백까지 더해 640 을 넘는다 — 실제로 넷이 서로
     * 겹쳐서 읽을 수 없었다. 요소를 크게 하면 배치가 따라와야 한다는 것이
     * PHASE 6 의 내용이다.
     *
     * 그래서 스코어가 최상단 중앙을 혼자 쓰고, 턴 플레이트와 두 컨트롤이 그 아래
     * 줄을 나눠 쓴다. 순서가 중요도이기도 하다: 점수는 화면 밖에서도 읽혀야 하고,
     * 누구 차례인지는 그 다음이고, 버튼은 찾을 때만 필요하다.
     */
    /**
     * ── 아래 줄은 점수판이 실제로 보일 때만 그 자리를 비켜 준다 ─────────────
     * 점수판은 최소 줌에서만 나타난다 — `_updateScore` 를 보라 — 그래서 경기
     * 대부분의 시간 동안 화면에 없다. 그런데 자리는 계속 잡아먹고 있었고, 그
     * 결과 800x459 창(프레임 421x316)에서 턴 플레이트가 화면의 59% 지점, 즉
     * 한가운데보다 **아래**에 떠 있었다. 위 여백의 내역이 이랬다:
     *
     *     상대 손패 48 + 간격 8 + 점수판 84 + 간격 14 + 턴 절반 22 = 186
     *
     * 316 높이의 절반이 158 이므로, 두 줄을 쌓는 것만으로 이미 중앙을 넘는다.
     *
     * 자리를 무조건 비워 두었던 이유는 튐이었다: 점수가 나타날 때 턴 플레이트가
     * 순간이동하면 그게 더 나쁘다. 그래서 비우지 않고 **미끄러지게** 한다.
     * `_scoreShown` 은 이미 `scoreFadeSeconds` 에 걸쳐 0..1 로 움직이므로, 두 Y
     * 사이를 같은 값으로 보간하면 점수가 페이드인하는 동안 턴 줄이 함께 내려온다.
     * 튐이 아니라 한 동작이 된다.
     */
    this._rowTwoUp = scoreTop - Math.max(TURN.height, ICON) / 2;
    this._rowTwoDown =
      this._scoreHome.y - SCORE.height / 2 - SPACE.sm - Math.max(TURN.height, ICON) / 2;
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
    // 턴 플레이트는 오른쪽 컨트롤 무리에 닿기 전에서 멈춘다.
    const controlsLeft = halfW - edgeRight - ICON * 2 - ICON_GAP;
    this._turnMax = Math.max(
      TURN.height * 2,
      Math.min(TURN.width, controlsLeft - (-halfW + edgeLeft) - SPACE.md),
    );

    // 아래 줄 오른쪽 끝: 나가기, 그 왼쪽에 리센터.
    const right = halfW - edgeRight - ICON / 2 + ui.exitOffsetX;
    this.exit.scale.set(ICON, ICON, 1);
    this.exit.position.set(right, rowTwoY + ui.exitOffsetY, 0);

    /**
     * 카메라 리셋. 나가기 바로 왼쪽, 같은 줄.
     *
     * "나가기 버튼 근처. 겹치지 않게." 아래가 아니라 옆인 이유는, 아래에 두면
     * 정사각 아이콘이 판 두 개 아래 매달려 세 번째 고장난 버튼처럼 읽히기
     * 때문이다. 옆에 두면 사람이 이미 컨트롤을 찾는 모서리 무리에 함께 있게 되고,
     * 카드 팬은 중앙에 모여 있어 여기까지 오지 않는다.
     */
    this.recenter.scale.set(ICON, ICON, 1);
    this.recenter.position.set(right - ICON - ICON_GAP, rowTwoY + ui.exitOffsetY, 0);

    // 아래 줄 왼쪽.
    this.turn.scale.set(Math.min(TURN.width, this._turnMax ?? TURN.width), TURN.height, 1);
    this.turn.position.set(-halfW + edgeLeft + TURN.width / 2, rowTwoY, 0);
    /**
     * The plate's LEFT edge, kept because the plate is no longer a fixed width.
     *
     * `position` is a centre, so a plate that grew to fit a nickname and was not
     * re-anchored would grow in both directions and hang off the left of the
     * screen. `_updateTurn` re-centres it against this every time the width
     * changes.
     */
    this._turnLeft = -halfW + edgeLeft;

    // Directly under the turn plate, the same width, so the clock reads as
    // belonging to the name above it rather than as a separate instrument.
    this._timerY = this.turn.position.y - TURN.height / 2 - TIMER_GAP - TIMER_HEIGHT / 2;
    this.timerTrack.scale.set(TURN.width, TIMER_HEIGHT, 1);
    this.timerTrack.position.set(this._turnLeft + TURN.width / 2, this._timerY, 0);
    this.timerFill.scale.set(TURN.width, TIMER_HEIGHT, 1);
    this.timerFill.position.copy(this.timerTrack.position);

    for (const h of this._hits) {
      const pad = Math.max(0, ui.hitMargin);
      h.mesh.scale.set(h.plate.scale.x + pad * 2, h.plate.scale.y + pad * 2, 1);
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
    labelFor = null,
    nameFor = null,
    outcomeFor = null,
    turnClock = null,
  }) {
    const ui = this.config.ui;
    this._fade = fade;

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

  /** 아래 줄(턴 플레이트, 두 컨트롤, 시계, 알림)을 `shown` 위치에 놓는다. */
  _applyRowTwo(shown) {
    if (this._rowTwoUp === undefined || this._rowTwoDown === undefined) return;
    const y = this._rowTwoUp + (this._rowTwoDown - this._rowTwoUp) * shown;
    if (y === this._rowTwoY) return;
    const dy = y - (this._rowTwoY ?? this._rowTwoDown);
    this._rowTwoY = y;
    this.turn.position.y += dy;
    this.exit.position.y += dy;
    this.recenter.position.y += dy;
    this.timerTrack.position.y += dy;
    this.timerFill.position.y += dy;
    this._timerY += dy;
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
      // 오른쪽 컨트롤에 닿기 전까지가 이 판이 쓸 수 있는 전부다. `_layout` 참조.
      maxWidth: this._turnMax ?? TURN.width,
      scale: this.config.ui.textureScale,
    });
    this.turn.material.uniforms.uMap.value = tex;
    // The plate sizes to its text now, so the quad has to follow it. Scaling to
    // anything else resamples the type.
    const w = tex.userData?.width ?? TURN.width;
    this.turn.scale.set(w, TURN.height, 1);
    if (this._turnLeft !== undefined) this.turn.position.x = this._turnLeft + w / 2;
    // The clock sits under the plate and is as wide as it is, so a long nickname
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
     * ── 두 아이콘 버튼의 움직임 ─────────────────────────────────────────────
     * 텍스처 교체만 있었다. 포인터가 닿으면 그림이 **순간이동**하듯 바뀌고,
     * 누르면 아무 일도 일어나지 않았다 — 눌린 것을 알려 주는 것은 그 뒤에 일어나는
     * 일(카메라가 돌아온다, 화면이 어두워진다)뿐이었다.
     *
     * `motion.js` 의 배율 한 줄을 얹는다. 닿으면 커지고 누르면 원래보다 작아진다.
     * 판 크기(`this._icon`)에 곱하는 것이라 히트 쿼드는 건드리지 않는다 — 커진
     * 버튼을 겨냥해 놓쳤다가 원래 크기로 돌아온 자리에 눌리는 일이 없어야 한다.
     */
    const size = this._icon ?? SIZE.buttonIcon.w;
    for (const b of [
      { mesh: this.exit, id: 'exit' },
      { mesh: this.recenter, id: 'recenter' },
    ]) {
      const st = (this._motion[b.id] ??= controlState());
      stepControl(st, { hovered: this.hovered === b.id, pressed: this._pressed === b.id }, dt);
      const k = controlScale(st);
      b.mesh.scale.set(size * k, size * k, 1);
    }

    const key = `${this.hovered ?? '-'}|${ui.textureScale}|${size}`;
    if (key === this._buttonKey) return;
    this._buttonKey = key;
    this.exit.material.uniforms.uMap.value = iconButtonTexture(
      'exit',
      this.hovered === 'exit' ? 'hover' : 'idle',
      { size: this._icon ?? SIZE.buttonIcon.w, scale: ui.textureScale },
    );
    this.recenter.material.uniforms.uMap.value = iconButtonTexture(
      'recenter',
      this.hovered === 'recenter' ? 'hover' : 'idle',
      { size: this._icon ?? SIZE.buttonIcon.w, scale: ui.textureScale },
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

import { Mesh, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import { FRAME as SHARED_FRAME, frameCamera, frameScale, refitFrameCamera } from '../core/frame.js';
import { FxMaterials } from '../render/FxMaterial.js';
import { HudMaterials } from '../ui/HudMaterial.js';
import {
  buttonTexture,
  notePlateTexture,
  scorePlateTexture,
  victoryPlateTexture,
} from '../ui/hudTextures.js';
import { VICTORY_STAGE, VictoryClock } from './VictoryClock.js';
import { ResultFizz } from './ResultFizz.js';
import { controlScale, controlState, stepControl } from '../ui/motion.js';
import { PALETTE, toRgb } from '../core/palette.js';
import { letterboxBar } from '../core/Cinematic.js';
import { ROLE, SIZE, SPACE } from '../core/tokens.js';

/**
 * How the match ended, as a thing that happens on screen.
 *
 * ── the board stays; this file only writes on it ────────────────────────────
 * There used to be a fight in here. Two 2D sprite caps on a tilted ground, an
 * afterimage trail, a charge across the frame, a collision with a white flash
 * and fourteen pixels of screen shake at 26 Hz, a loser flipping out of frame
 * and a winner settling on a spring. Sixty-seven kilobytes of it, and it is
 * gone.
 *
 * Three things were wrong with it. It replayed — non-interactively, and at a
 * quarter of the fidelity — the exact thing the player had just spent a whole
 * match doing with their hands, so the reward for winning was a worse version
 * of the game. It knew nothing about the MODE, so a football match won on goals
 * and a curling match won on a tiebreaker both ended with the same two caps
 * hitting each other, and neither said what had happened. And it looked like a
 * different program: nothing else in this game is a sprite on a tilted plane
 * with a trail behind it, and the direction forbids strong screen shake
 * outright.
 *
 * What is here instead is what a broadcast does. The board is still on screen
 * — the finishing position is the last thing the match said — and `main.js`
 * pushes the camera in on whatever decided it. The letterbox closes over that.
 * The result is stated in the band with the mode's OWN number in it, taken from
 * `scoreboardFor`, which is the same function the corner HUD reads: 3–0 caps
 * left, 2–1 goals, 2–1 rounds. Then the bars retreat and the two buttons come
 * up. Four stages, and the sequence is what `VictoryClock` walks.
 *
 * ── the bars are NOT this file's ────────────────────────────────────────────
 * `core/Cinematic.js` owns them, `main.js` drives them off `this.stage`, and
 * that division is the point of the redesign: the letterbox the match ENDS in
 * has to be the same object as the one it began in, or there are two of them
 * and the frame stops being a frame.
 *
 * ── its own overlay scene ───────────────────────────────────────────────────
 * `HudLayer` argues at length for not sharing the card layer's scene, and every
 * word of it applies here: this one needs its own snap dial so the winner line
 * can come down without taking anything else with it, and it is drawn after the
 * bloom chain because a bright pass over white type on a white plate is
 * unreadable type.
 *
 * ── it is MODAL, and that is an input rule ─────────────────────────────────
 * While it is up it takes every press on the canvas — see `pointerDown`, which
 * returns true unconditionally. `PointerRouter` tests it before the cards and
 * before the HUD, so nothing underneath can be reached: the match is over,
 * there is no shot to take, and a press landing on a card fan that is only
 * still on screen because it is fading out would be a press with no meaning.
 */

/** The layout box, in frame pixels. The shared, live one — see core/frame.js. */
export const VICTORY_FRAME = SHARED_FRAME;

/**
 * How much the full-frame quad overhangs the frame, in frame pixels.
 *
 * The vertex snap moves every corner by up to half a low-res pixel and it is
 * free to move one INWARD, which on the dimming quad would leave a bright line
 * down one edge of the screen. `Cinematic`'s bars carry the same number for the
 * same reason.
 */
const OVERHANG = 6;

/** The winner line's plate, in frame pixels. Big — see `victoryPlateTexture`. */
const PLATE = { width: 340, height: 72 };

/** The number under it. The HUD's own score plate, at the HUD's own size. */
const SCORE = { width: SIZE.scorePlate.w, height: SIZE.scorePlate.h };

/**
 * One line of explanation under the winner, when the mode has one.
 *
 * ── it exists because "who won" is not always the whole answer ──────────────
 * Knockout and football never need it: you won because the other side ran out
 * of caps, or because the score says 3–1, and both of those are now on screen
 * in the plate directly under the winner's name. Curling can end 2–2 and be
 * decided on which team owns the cap nearest the middle of the house, and a
 * player who cannot see that will read the result as arbitrary — so
 * "타이브레이커가 발동했다는 걸 결과 화면에 표시해라" is a requirement.
 *
 * The SAME plate the in-game note line uses, deliberately. It is one more thing
 * the player has already learned to read, it goes through the same thresholding
 * and the same cache, and it sizes itself to its text — so a mode that has
 * nothing to say simply does not pass one and nothing is drawn.
 */
const NOTE_HEIGHT = 24;
/** Frame pixels between the winner line and the note above it. */
const NOTE_GAP = 10;

/**
 * The buttons, in the existing UI's style and sized to their own labels.
 *
 * Not one shared width. The plate has to be as wide as what it says, which is
 * the same conclusion `notePlateTexture` reached — a 재시작 padded out to the
 * width of 메뉴로 나가기 would be three glyphs adrift in a box.
 *
 * ── 부록 B: 좌우가 반대였다 ─────────────────────────────────────────────────
 * B2.2-1 requires the retreat on the left and what the screen recommends on the
 * right. **배열 순서가 곧 화면 순서다** — `layout` places them left to right —
 * so obeying that rule is a matter of the order of these two lines.
 *
 * The height comes from the token rather than from a number this file invented:
 * how much room a label gets above and below it is a property of the COMPONENT,
 * not of what the label says. `buttonFooter` because that is the role — the
 * token's own comment says "COMMIT / RETREAT", and these two are exactly those.
 */
const BUTTONS = [
  { id: 'exit', label: '메뉴로 나가기', width: 192, height: SIZE.buttonFooter.h, role: ROLE.RETREAT },
  { id: 'restart', label: '재시작', width: 120, height: SIZE.buttonFooter.h, role: ROLE.COMMIT },
];
/** Frame pixels between the two plates. */
const BUTTON_GAP = 18;

/**
 * When the winner line, the number and each button come in.
 *
 * The first two are fractions of RESULT and the last two of RELEASE, because
 * they belong to different stages: the result is stated inside the letterbox
 * and the controls arrive as it opens.
 *
 * Overlapping rather than strictly sequential: three things that hard-cut in
 * turn read as three separate events, and each of these starts while the one
 * before it is still arriving, so it is one movement with an order to it.
 */
const TEXT_IN = [0.0, 0.4];
const SCORE_IN = [0.22, 0.62];
const RESTART_IN = [0.0, 0.6];
const EXIT_IN = [0.25, 0.85];

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** 0 before `from`, 1 after `to`, smoothly between. */
function window01(x, [from, to]) {
  return smoothstep((x - from) / Math.max(1e-4, to - from));
}

export class VictoryLayer {
  /**
   * @param {HTMLCanvasElement} canvas  for mapping pointer coordinates
   * @param {import('three').Vector2} resolution  the low-res target's size
   * @param {string[]} teamColors
   * @param {() => void} onRestart
   * @param {() => void} onExit
   */
  constructor({
    canvas,
    config,
    resolution,
    teamColors,
    onRestart,
    outcomeFor = null,
    onExit,
  }) {
    this.canvas = canvas;
    this.config = config;
    this.teamColors = teamColors;
    this.onRestart = onRestart ?? (() => {});
    /** @type {((winner: number) => string|null)|null} */
    this.outcomeFor = outcomeFor;
    this.onExit = onExit ?? (() => {});

    this.clock = new VictoryClock({ tuning: config.victory });

    this.scene = new Scene();
    // A flat overlay: everything in it is a quad on z = 0 and paint order is the
    // whole of the sorting. The deep range the old scene needed was for two cap
    // meshes depth-tested against each other, and there are no meshes now.
    this.camera = frameCamera({ near: -100, far: 100 });

    this.uiMaterials = new HudMaterials({ resolution });
    this.fxMaterials = new FxMaterials({ resolution });

    /** One quad for everything. Disposed once, at the end. */
    this._quad = new PlaneGeometry(1, 1);

    /**
     * 어두워진 판.
     *
     * 순수한 검정이 아니다. 어두운 UI 위에서는 맞았지만 밝은 유리 위에서 같은
     * 일을 하면 뒤가 **없어진다** — 팔레트의 깊은 파랑이고, `ModalLayer` 의
     * 가림막과 같은 잉크이며 같은 이유다(팔레트 감사 규칙 1: 순수한 검정은 없다).
     *
     * 세기가 0.72 에서 0.34 로 내려간 이유는 이 화면의 주어가 바뀌었기
     * 때문이다. 예전에는 판이 배경이었다 — 앞에서 뚜껑 두 개가 싸웠으므로. 지금은
     * 판이 **주어**다: 카메라가 방금 승부를 가른 것으로 밀고 들어갔고, 결과가
     * 읽히는 동안 그것이 계속 보여야 한다.
     */
    this.dim = new Mesh(this._quad, this.uiMaterials.createSolid(0));
    const dimRgb = toRgb(PALETTE.accent.skyDeep).map((v) => v / 255);
    this.dim.material.uniforms.uTint.value.set(dimRgb[0], dimRgb[1], dimRgb[2]);
    this.dim.scale.set(VICTORY_FRAME.width + OVERHANG * 2, VICTORY_FRAME.height + OVERHANG * 2, 1);
    this.dim.renderOrder = -50;
    this.dim.visible = false;
    this.scene.add(this.dim);

    /**
     * The carbonation. One of exactly two celebratory beats on this screen.
     *
     * The other is the glint on the winning caps, and `CardFx` draws that — the
     * 원모어 flourish played with no card behind it. Two, and no more: the
     * screen's argument is restraint, and confetti in particular is somebody
     * else's game. See `ResultFizz`.
     */
    this.fizz = new ResultFizz({ materials: this.fxMaterials, quad: this._quad });
    this.fizz.build(config.victory.bubbleCount, this.scene);

    // ── the type ────────────────────────────────────────────────────────────
    this.plate = new Mesh(this._quad, this.uiMaterials.create(null));
    this.plate.renderOrder = 20;
    this.plate.visible = false;
    this.scene.add(this.plate);

    /**
     * The mode's own number, under the winner's name.
     *
     * ── this is the half the old screen did not have ───────────────────────
     * "모드를 모른다. 축구는 골을 넣었고 컬링은 돌을 라인 가까이 놓았고 서바이벌은
     * 떨어뜨렸다. 셋 다 같은 캡-치기 애니메이션이 나온다." The fix is not a third
     * animation, it is a number — and the number already exists, because the
     * corner HUD has been showing it all match. `scoreboardFor` is the mode's
     * own answer and `scorePlateTexture` is the plate the player has been
     * reading it off; both are reused exactly, at the same size, so the result
     * screen says the thing the scoreboard said, larger and last.
     */
    this.score = new Mesh(this._quad, this.uiMaterials.create(null));
    this.score.renderOrder = 20;
    this.score.visible = false;
    this.scene.add(this.score);
    /** The frozen scoreboard, as `scoreboardFor` reported it. Set by `begin`. */
    this._board = null;
    this._scoreKey = '';

    // The explanation. Same render order as the winner line — they arrive
    // together and never overlap — and hidden until a mode hands one in.
    this.note = new Mesh(this._quad, this.uiMaterials.create(null));
    this.note.renderOrder = 20;
    this.note.visible = false;
    this.scene.add(this.note);
    /** What the note says, or null. Set by `begin`; drives the plate below. */
    this._note = null;
    this._noteKey = '';

    /** @type {Array<{id: string, label: string, width: number, height: number, plate: Mesh, hit: Mesh}>} */
    this._buttons = BUTTONS.map((spec) => {
      const plate = new Mesh(this._quad, this.uiMaterials.create(null));
      plate.renderOrder = 21;
      plate.visible = false;
      this.scene.add(plate);
      // An oversized invisible quad, raycast against, exactly as `HudLayer`
      // does — the give the brief asks for belongs in the GEOMETRY so the ray
      // result is the answer rather than the start of one.
      const hit = new Mesh(this._quad, this.uiMaterials.createSolid(0.28));
      hit.renderOrder = 25;
      hit.visible = false;
      this.scene.add(hit);
      // `aw`/`ah` 는 저술 크기(640 프레임 기준), `width`/`height` 는 실제 크기다.
      // `layout()` 이 `frameScale()` 을 곱해 후자를 채운다.
      return { ...spec, aw: spec.width, ah: spec.height, plate, hit, motion: controlState() };
    });

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    /** Which control the pointer is over, or null. */
    this.hovered = null;
    this._pressed = null;
    /**
     * A transition is running off one of the buttons.
     *
     * Set by the host the moment a press is honoured, and it swallows everything
     * after it. Without it, 재시작 pressed twice inside the moment the bars take
     * to close starts two rebuilds, and the second one runs against a world the
     * first has already thrown away.
     */
    this._busy = false;

    /** Frame pixels of the bottom edge the device owns. See `setSafeInsets`. */
    this._safeBottom = 0;

    /** -1 is a draw. Undefined until `begin`. */
    this.winnerIndex = -1;
    this._draw = false;
    /** Played from the panel rather than by a finished match. See `begin`. */
    this.forced = false;
    /** Seconds since the sequence began. */
    this._now = 0;
    /** How far the background has darkened, 0..1 of `bgOpacity`. */
    this._dimShown = 0;

    this.layout();
  }

  setResolution(resolution) {
    this.uiMaterials.setResolution(resolution);
    this.fxMaterials.setResolution(resolution);
    // Same as the HUD: a frame that changed shape needs the ortho box refitted
    // and everything anchored to an edge placed again.
    if (refitFrameCamera(this.camera)) this.layout();
  }

  /**
   * Lift the button row clear of a home indicator.
   *
   * The row is the only thing in this layer near an edge — the result band sits
   * well inside — and it had 30 frame pixels of clearance, which is not quite
   * enough: a landscape iPhone's indicator strip is about 26 of them, so the hit
   * quads finished 4 pixels above a region the OS treats as its own. `max`
   * rather than `+` because the existing clearance already covers most of the
   * inset; adding would push 재시작 and 나가기 visibly up the screen on a phone
   * for no reason a player could see.
   *
   * @param {{top:number,right:number,bottom:number,left:number}} insets frame px
   */
  setSafeInsets(insets) {
    const bottom = Math.max(0, insets?.bottom ?? 0);
    if (bottom === this._safeBottom) return;
    this._safeBottom = bottom;
    this.layout();
  }

  /**
   * Place the type and the buttons against the frame.
   *
   * Called on construction and whenever the panel moves an offset — never per
   * frame, because none of it depends on time.
   *
   * ── the band, and what may be written in it ─────────────────────────────
   * The result is laid out inside the letterbox band, which is the frame less
   * `letterboxBar()` at each edge. A bar is a margin, not a UI surface —
   * "바 안에 글자를 쓰지 마라" — so the winner line, the number and the note are
   * clamped into the band rather than merely placed near the middle and hoped
   * about, because the band's height moves with the frame's and a phone's is a
   * different shape from a desktop's.
   *
   * The two BUTTONS are deliberately outside that clamp. They arrive at RELEASE,
   * after the bars have retreated, so the band no longer exists when they are
   * on screen and confining them to it would push them up into the result for
   * no reason.
   */
  layout() {
    const c = this.config.victory;

    /**
     * ── 판 크기와 자리는 프레임에서 나온다 ────────────────────────────────
     * `PLATE` 는 340x72 이고 저술 좌표는 전부 640x480 기준이다. 421x316 프레임에서
     * 그대로 두면 판들이 서로 겹친다. `textY` / `scoreY` / `buttonY` 는 패널이
     * 움직이는 값이므로 없애지 않고 **배수를 곱한다** — 패널에서 한 칸 올리면
     * 어느 프레임에서나 그만큼 올라간다는 관계가 유지된다.
     */
    const k = frameScale();
    const bandTop = VICTORY_FRAME.height / 2 - letterboxBar();

    this._plateSize = {
      width: Math.round(Math.min(PLATE.width * k, VICTORY_FRAME.width - SPACE.md * 2)),
      height: Math.round(PLATE.height * k),
    };
    this._scoreSize = {
      width: Math.round(Math.min(SCORE.width * k, VICTORY_FRAME.width - SPACE.md * 2)),
      height: Math.round(SCORE.height * k),
    };

    const noteH = Math.round(NOTE_HEIGHT * k);
    /**
     * The tallest the stack can be, measured from the winner line's centre.
     *
     * Written as one clamp on the whole group rather than three separate ones,
     * because what has to fit in the band is the STACK: clamping each plate on
     * its own would let the note leave the band while the line that anchors it
     * stayed put.
     */
    const above = this._plateSize.height / 2 + (this._note ? NOTE_GAP * k + noteH : 0);
    const below = -c.scoreY * k + this._plateSize.height / 2 + this._scoreSize.height / 2;
    const wanted = c.textY * k;
    const textY = Math.min(bandTop - above, Math.max(-bandTop + below, wanted));

    this.plate.scale.set(this._plateSize.width, this._plateSize.height, 1);
    this.plate.position.set(0, textY, 0);
    this._textY = textY;

    this.score.scale.set(this._scoreSize.width, this._scoreSize.height, 1);
    this.score.position.set(0, textY + (c.scoreY - c.textY) * k, 0);

    this._noteH = noteH;
    this.note.position.set(0, textY + this._plateSize.height / 2 + NOTE_GAP * k + noteH / 2, 0);

    const pad = Math.max(0, c.hitMargin);
    /**
     * The row's floor: the lowest the HIT quad may reach, not the plate.
     *
     * The quad is what the OS competes with, and it hangs `hitMargin` below the
     * plate — so the constraint is written against the quad and the plate's
     * position is derived back from it. See `setSafeInsets`.
     */
    const floor = -VICTORY_FRAME.height / 2 + (this._safeBottom ?? 0);
    /**
     * 버튼 크기도 프레임을 따라간다. 폭에는 프레임 상한이 걸린다 — 두 버튼과
     * 간격을 합치면 저술 폭에서 330 이고, 421 프레임에서 그대로 두면 79% 다.
     */
    const room = VICTORY_FRAME.width - SPACE.md * 2 - BUTTON_GAP * (this._buttons.length - 1);
    const authored = this._buttons.reduce((sum, b) => sum + b.aw, 0);
    const wFit = Math.min(k, room / Math.max(1, authored));
    for (const b of this._buttons) {
      b.width = Math.round(b.aw * wFit);
      b.height = Math.round(b.ah * k);
    }
    const tallest = this._buttons.reduce((m, b) => Math.max(m, b.height), 0);
    const buttonY = Math.max(c.buttonY * k, floor + pad + tallest / 2);

    const total =
      this._buttons.reduce((sum, b) => sum + b.width, 0) + BUTTON_GAP * (this._buttons.length - 1);
    let x = -total / 2;
    for (const b of this._buttons) {
      b.plate.scale.set(b.width, b.height, 1);
      b.plate.position.set(x + b.width / 2, buttonY, 0);
      x += b.width + BUTTON_GAP;

      b.hit.scale.set(b.width + pad * 2, b.height + pad * 2, 1);
      b.hit.position.copy(b.plate.position);
    }

    this.dim.scale.set(VICTORY_FRAME.width + OVERHANG * 2, VICTORY_FRAME.height + OVERHANG * 2, 1);
    this.fizz.layout();
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  get active() {
    return this.clock.running;
  }

  /** True once the sequence is over and the buttons will answer a press. */
  get interactive() {
    return this.clock.done && !this._busy;
  }

  /** Was this run pressed through? The camera reads it, to land on its target. */
  get skipped() {
    return this.clock.skipped;
  }

  /**
   * Whether a transition has already been started off one of the buttons.
   *
   * Read by the host before it starts another one. The layer swallows presses on
   * its own once this is set — see `pointerDown` — but the two buttons hand out
   * work that only the host can refuse twice: a second fade would attach a
   * second veil and navigate again.
   */
  get busy() {
    return this._busy;
  }

  get stage() {
    return this.clock.stage;
  }

  /**
   * Play the sequence.
   *
   * @param {number} winner  0 or 1. Anything else — including the `undefined`
   *   `Match` leaves behind when a match ends because nobody can shoot — is a
   *   draw. The game's own judging is not touched to make this neater: `-1`
   *   really is what `KnockoutRules` reports when both sides clear, and reading
   *   `undefined` the same way is this file being defensive about a state it
   *   does not own.
   *
   *   A draw takes the SAME four stages. It used to jump straight to the text,
   *   on the grounds that there was no loser to be hit and therefore nothing for
   *   the animation to say — which had it exactly backwards, because a draw is
   *   the result that most needs explaining and it was getting the least. See
   *   `VictoryClock`'s header.
   * @param {object} [opts]
   * @param {boolean} [opts.forced]
   *   Played from the panel, over a match that has not finished. It is the ONLY
   *   difference this flag makes, and it is about who is allowed to take the
   *   screen away again: the loop puts an unforced sequence away the moment the
   *   match stops being over, which is what keeps the determinism replay button
   *   — `Match.replayLastTurn` sets the state back to AIM and leaves `winner`
   *   exactly where it was — from leaving a modal screen up over a live match.
   * @param {string|null} [opts.note]
   *   One line above the winner, from the mode's own verdict — see
   *   `RuleSet.resolveTurn`'s `resultNote`.
   * @param {object|null} [opts.board]
   *   The scoreboard as `scoreboardFor` reports it, frozen at the moment the
   *   match ended. Handed in rather than read per frame: this is the FINAL
   *   score, and a screen that re-asked the rules every frame would be a screen
   *   that could change its mind after the match was over.
   */
  begin(winner, { forced = false, note = null, board = null } = {}) {
    const valid = winner === 0 || winner === 1;
    this.winnerIndex = valid ? winner : -1;
    this._draw = !valid;
    this.forced = forced;
    this._note = note || null;
    this._board = board || null;

    this._now = 0;
    this._dimShown = 0;
    this.hovered = null;
    this._pressed = null;
    this._busy = false;
    this.fizz.reset();

    this.clock.begin();
    // The note changes how tall the stack is, so the band clamp has to be
    // re-solved before the first frame rather than at the next resize.
    this.layout();
    this._syncToStage(0);
  }

  /** Straight to the pressable screen. Every animated value lands on its end. */
  skip() {
    if (!this.clock.skip()) return false;
    this._syncToStage(0);
    return true;
  }

  /** Off screen, and back to knowing nothing. For a restart or a mode change. */
  dismiss() {
    this.clock.reset();
    this._busy = false;
    this.forced = false;
    this.hovered = null;
    this._pressed = null;
    this._dimShown = 0;
    this.dim.visible = false;
    this.plate.visible = false;
    this.score.visible = false;
    this.note.visible = false;
    this._note = null;
    this._board = null;
    this.fizz.reset();
    for (const b of this._buttons) {
      b.plate.visible = false;
      b.hit.visible = false;
    }
  }

  /** The host has started a transition off one of the buttons. */
  setBusy(on) {
    this._busy = !!on;
    if (on) {
      this.hovered = null;
      this._pressed = null;
    }
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  /** @param {number} dt  render seconds, already clamped by the caller */
  update(dt) {
    if (!this.active) return;
    this._now += dt;
    this.clock.update(dt);
    this._syncToStage(dt);
  }

  /** Everything the current stage says about what is on screen. */
  _syncToStage(dt) {
    this._updateDim(dt);
    this._updateFizz(dt);
    this._updateType(dt);
    this._refreshTextures();
  }

  /**
   * The board darkens once the bars are closing, and not before.
   *
   * Stage 1 is a replay of the match — the camera is pushing in on the thing
   * that decided it — and a replay behind a veil is a memory. The dimming is
   * what says "this is now a screen about the result", which is exactly what
   * the bars are saying at the same moment.
   */
  _updateDim(dt) {
    const c = this.config.victory;
    const target = this.clock.atOrPast(VICTORY_STAGE.BARS)
      ? Math.min(1, Math.max(0, c.bgOpacity))
      : 0;
    if (dt === 0 && this.clock.done) {
      // A skip lands on the darkened frame rather than fading from where it was.
      this._dimShown = target;
    } else {
      const rate = dt / Math.max(0.02, c.bgFadeSeconds);
      this._dimShown += Math.max(-rate, Math.min(rate, target - this._dimShown));
    }
    this.dim.material.uniforms.uOpacity.value = this._dimShown;
    this.dim.visible = this._dimShown > 0.004;
  }

  /**
   * The bubbles ride the dimming.
   *
   * One scalar rather than a window of their own: they are the ground the
   * result is read against, so they belong to the same moment the ground does.
   * They keep running under the buttons after RELEASE, because they are the
   * only thing moving on a screen that is otherwise waiting for a press — and a
   * completely still screen reads as a frozen one.
   */
  _updateFizz(dt) {
    const c = this.config.victory;
    const level = c.bgOpacity > 0 ? this._dimShown / c.bgOpacity : 0;
    this.fizz.update(dt, Math.min(1, level) * Math.max(0, c.bubbleStrength));
  }

  _updateType(dt = 0) {
    const c = this.config.victory;

    /**
     * Two stages, two envelopes.
     *
     * The result is stated during RESULT and the controls arrive during
     * RELEASE, so the two windows are measured against different `t`s. Past
     * either stage the value holds at 1 rather than being recomputed, which is
     * what makes DONE — and therefore a skip — land on exactly the frame the
     * sequence would have reached.
     */
    const inResult = this.clock.atOrPast(VICTORY_STAGE.RESULT);
    const resultT = this.clock.stage === VICTORY_STAGE.RESULT ? this.clock.t : inResult ? 1 : 0;
    const inRelease = this.clock.atOrPast(VICTORY_STAGE.RELEASE);
    const releaseT = this.clock.stage === VICTORY_STAGE.RELEASE ? this.clock.t : inRelease ? 1 : 0;

    const textK = window01(resultT, TEXT_IN);
    this.plate.material.uniforms.uOpacity.value = textK;
    this.plate.visible = textK > 0.004;
    // One beat on arrival, up and back down over the life of the envelope, so it
    // reads as an entrance rather than as a size that then relaxes. The same
    // shape — and the same slider range — as the score's own change pulse.
    const bump = Math.sin(Math.PI * textK) * Math.max(0, c.textPulseScale);
    /**
     * 박동은 `layout()` 이 푼 크기에 곱한다. 저술 크기가 아니라.
     *
     * `PLATE.width` 를 그대로 쓰면 프레임에 맞춰 줄여 놓은 값이 매 프레임 340 으로
     * 되돌아간다 — `HudLayer._updateScore` 에 있던 것과 같은 결함이고, 같은 이유로
     * 화면에서는 축소가 아예 없던 것처럼 보인다.
     */
    const box = this._plateSize ?? PLATE;
    this.plate.scale.set(box.width * (1 + bump), box.height * (1 + bump), 1);

    // The number comes in behind the name, and takes NO bump. The beat is the
    // result arriving; a second thing pulsing beside it reads as two separate
    // events, which is the same argument the button windows make.
    const scoreK = window01(resultT, SCORE_IN);
    this.score.material.uniforms.uOpacity.value = scoreK;
    this.score.visible = !!this._board && scoreK > 0.004;

    // The explanation rides the winner line's own envelope, because it is the
    // reason for what that line says.
    this.note.material.uniforms.uOpacity.value = textK;
    this.note.visible = !!this._note && textK > 0.004;

    const windows = { restart: RESTART_IN, exit: EXIT_IN };
    for (const b of this._buttons) {
      const k = window01(releaseT, windows[b.id] ?? RESTART_IN);
      // Full weight once it is up. There is no dimming here: the in-game buttons
      // drop to `ui.dimOpacity` so they stop competing with the board, and on
      // this screen there is nothing left for them to compete with.
      b.plate.material.uniforms.uOpacity.value = k;
      b.plate.visible = k > 0.004;
      b.hit.visible = c.showHitAreas && this.interactive;

      /**
       * 배율 피드백. 부록 B1.2 — 경기 화면 버튼은 유지한다.
       *
       * 등장 창(`k`)과는 곱해서 겹친다. 등장은 화면이 하는 일이고 배율은 손이
       * 하는 일이므로, 둘 중 하나가 다른 하나를 덮으면 안 된다 — 올라오는 중에
       * 눌러도 눌린 것이 보여야 한다.
       *
       * ── 이 배율은 좌표를 옮기지 않는다 ─────────────────────────────────
       * 부록 D6 의 요구는 "버튼이 최종 위치에서 투명도만으로 나온다" 이고, 이
       * 파일이 그것을 지키는 방식은 등장을 알파로만 하는 것이다. 눌림 배율은
       * 손이 만든 것이라 예외이고, 히트 쿼드는 따라가지 않으므로 누를 수 있는
       * 자리는 한 픽셀도 움직이지 않는다. `HudLayer` 의 같은 자리에 이유가 있다.
       */
      stepControl(
        b.motion,
        { hovered: this.hovered === b.id, pressed: this._pressed === b.id },
        dt,
      );
      const s = controlScale(b.motion);
      b.plate.scale.set(b.width * s, b.height * s, 1);
    }
  }

  /**
   * Re-ask for every plate, every frame.
   *
   * Deliberately unconditional. The cache this layer draws out of can be emptied
   * from under it — `HudLayer` calls `clearHudTextureCache` when the UI texture
   * slider moves — and a material still pointing at a disposed texture draws
   * NOTHING, silently, because a freed texture is not an error. Every call here
   * is a keyed cache hit and therefore free; the one frame after a clear it
   * regenerates, which is exactly when it needs to.
   */
  _refreshTextures() {
    const scale = this.config.ui.textureScale;
    const draw = this._draw;
    const color = draw ? PALETTE.neutral : this.teamColors[this.winnerIndex];
    /**
     * "2P 승리" is the right line for two people at one board and the wrong one
     * everywhere else.
     *
     * Against the computer, or online, there is one person at this screen — and
     * telling them their opponent won, in the third person, by seat number, is a
     * scoreboard rather than a result. `outcomeFor` is handed in by `main.js`,
     * which is the only layer that knows which seat the person watching
     * occupies; absent, this is character for character what it always was.
     *
     * The colour is deliberately still the WINNER's, which on a loss means the
     * word 패배 arrives in the other player's colour. That is the right way
     * round: the line is about who won.
     */
    const text = draw ? '무승부' : (this.outcomeFor?.(this.winnerIndex) ?? `${this.winnerIndex + 1}P 승리`);

    // 크기는 `layout()` 이 프레임에서 푼 값이다. `PLATE` 는 저술 크기일 뿐이다.
    this.plate.material.uniforms.uMap.value = victoryPlateTexture(text, color, {
      ...(this._plateSize ?? PLATE),
      scale,
    });

    /**
     * The number, drawn by the HUD's own score plate.
     *
     * Keyed so it is baked once: `scorePlateTexture` has its own cache and this
     * asks it for the same key every frame, which is a map lookup. The board is
     * frozen at `begin`, so unlike the HUD's there is nothing here that can
     * change between frames except the texture scale.
     */
    if (this._board) {
      const box = this._scoreSize ?? SCORE;
      const key = `${this._board.key}|${box.width}|${scale}`;
      if (key !== this._scoreKey) {
        this._scoreKey = key;
        this.score.material.uniforms.uMap.value = scorePlateTexture(
          {
            key: this._board.key,
            left: { value: this._board.left, color: this.teamColors[0] },
            right: { value: this._board.right, color: this.teamColors[1] },
            caption: this._board.caption,
          },
          { ...box, scale },
        );
      }
    }

    /**
     * The note, sized to its own text and hung ABOVE the winner line.
     *
     * Above rather than below, and that is a reading order rather than a
     * measurement: "동점 2:2 · 타이브레이커" and then "1P 승리" is the reason and
     * then the result, which is the order the player wants them in — the note is
     * not a footnote, it is why. Below is also where the number now lives.
     *
     * Re-asked every frame like everything else here, but the SCALE is only
     * recomputed when the text changes, because it comes out of the texture's
     * `userData` and writing it every frame would be two assignments to prove a
     * string had not changed. `layout()` cannot do it: the width is not known
     * until the text is.
     */
    if (this._note) {
      const noteH = this._noteH ?? Math.round(NOTE_HEIGHT * frameScale());
      const key = `${this._note}|${scale}|${noteH}`;
      const tex = notePlateTexture(this._note, 'normal', {
        height: noteH,
        scale,
        // Nearly the frame, so a tiebreaker sentence is never truncated. The
        // in-game note's tighter ceiling is about not covering the board; there
        // is nothing being aimed at here.
        maxWidth: VICTORY_FRAME.width - 48,
      });
      this.note.material.uniforms.uMap.value = tex;
      if (key !== this._noteKey) {
        this._noteKey = key;
        this.note.scale.set(tex.userData?.width ?? 200, noteH, 1);
      }
    }

    for (const b of this._buttons) {
      b.plate.material.uniforms.uMap.value = buttonTexture(
        b.label,
        this.hovered === b.id ? 'hover' : 'idle',
        { width: b.width, height: b.height, scale, role: b.role },
      );
    }
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  /**
   * Draw it over whatever is already in the bound target.
   *
   * The depth clear is not optional and it is not the caller's: everything here
   * is in front by definition, not by being nearer. `autoClear` goes off around
   * it so what is underneath survives, and back on afterwards because the next
   * frame's first render expects to be clearing.
   *
   * @param {import('three').WebGLRenderer} renderer
   */
  render(renderer) {
    if (!this.active) return;
    renderer.clearDepth();
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  /** Which control is under a point, or null. Tested against the hit quads. */
  hitAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    this.scene.updateMatrixWorld(true);

    const quads = this._buttons.map((b) => b.hit);
    const hits = this._ray.intersectObjects(quads, false);
    if (!hits.length) return null;
    return this._buttons.find((b) => b.hit === hits[0].object)?.id ?? null;
  }

  /**
   * @returns {boolean} true if the screen took the press.
   *
   * Unconditionally true while it is up. That is the modality: the match is
   * over, and a press must not reach a card fan or a 나가기 button that is only
   * still under the pointer because this screen is fading it out. See the header.
   */
  pointerDown(clientX, clientY) {
    if (!this.active) return false;
    if (this._busy) return true;
    // A press during the sequence is the skip, and it is ONLY the skip — it does
    // not also arm the button it happened to land on. Pressing through a
    // flourish is asking to see the screen, not to have chosen from it. And the
    // buttons are invisible for three of the four stages, so a press that also
    // chose would be a press on something the player could not see.
    if (!this.clock.done) {
      this.skip();
      return true;
    }
    const id = this.hitAt(clientX, clientY);
    this._pressed = id;
    this.hovered = id;
    return true;
  }

  pointerMove(clientX, clientY) {
    if (!this.active) return false;
    if (this._busy || !this.clock.done) return true;
    const id = this.hitAt(clientX, clientY);
    // While a press is held the hover follows whether it is still ON the control
    // it started on — that is what makes sliding off a cancel.
    this.hovered = this._pressed ? (id === this._pressed ? id : null) : id;
    return true;
  }

  /**
   * Fires on RELEASE over the same control, not on press.
   *
   * The same semantics `HudLayer` gives its own 나가기, and for the same reason:
   * both of these throw the match away and releasing off the button is the way
   * back from a misplaced tap.
   */
  pointerUp(cancelled = false) {
    const id = this._pressed;
    this._pressed = null;
    if (!this.active || this._busy) return false;
    if (!id || cancelled) return false;
    if (this.hovered !== id) return false;
    if (id === 'restart') this.onRestart();
    else if (id === 'exit') this.onExit();
    return true;
  }

  clearHover() {
    this.hovered = null;
  }

  get hovering() {
    return this.hovered !== null;
  }

  /** Whether a press is being held on one of the buttons. For the router's cleanup. */
  get pressing() {
    return this._pressed !== null;
  }

  dispose() {
    this.fizz.dispose();
    this._quad.dispose();
    this.uiMaterials.dispose();
    this.fxMaterials.dispose();
    this.scene.clear();
  }
}

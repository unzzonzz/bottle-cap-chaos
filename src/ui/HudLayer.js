import { Mesh, OrthographicCamera, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import { MATCH_STATE } from '../game/Match.js';
import { scoreboardFor } from '../game/modes.js';
import { PLAYER_COLORS } from '../render/ArenaView.js';
import { HudMaterials } from './HudMaterial.js';
import {
  buttonTexture,
  clearHudTextureCache,
  notePlateTexture,
  scorePlateTexture,
  turnPlateTexture,
} from './hudTextures.js';

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
export const HUD_FRAME = { width: 640, height: 480 };

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
const PARKED_HAND_REACH = 48;

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
const SCORE_GAP = 3;

const SCORE = { width: 208, height: 42 };
const BUTTON = { width: 104, height: 34 };
const TURN = { width: 152, height: 26 };
const NOTE_HEIGHT = 22;
const MARGIN = 12;

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class HudLayer {
  /**
   * @param {HTMLCanvasElement} canvas  for mapping pointer coordinates
   * @param {import('three').Vector2} resolution  the low-res target's size
   * @param {() => void} onExit
   * @param {() => void} onRestart
   */
  constructor({ canvas, config, resolution, onExit, onRestart, reserved }) {
    this.canvas = canvas;
    this.config = config;
    this.onExit = onExit ?? (() => {});
    this.onRestart = onRestart ?? (() => {});
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
    this.camera = new OrthographicCamera(
      -HUD_FRAME.width / 2,
      HUD_FRAME.width / 2,
      HUD_FRAME.height / 2,
      -HUD_FRAME.height / 2,
      -100,
      100,
    );
    this.camera.position.z = 10;

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
    this.note = plate(11);
    this.exit = plate(12);
    this.restart = plate(12);

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
      { id: 'restart', mesh: this._hitQuad(), plate: this.restart },
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
    this._noteKey = '';
    this._buttonKey = '';
    this._texScale = -1;
    /**
     * Whether the opponent's hand is parked along the top edge.
     *
     * True for every mode that uses cards, which is every mode but curling. Only
     * `layout` reads it, and only to decide how far down the score hangs.
     */
    this._handParked = true;

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
    const scoreTop = halfH - (this._handParked ? PARKED_HAND_REACH + SCORE_GAP : MARGIN);
    this.score.scale.set(SCORE.width, SCORE.height, 1);
    this._scoreHome = {
      x: ui.scoreOffsetX,
      y: scoreTop - SCORE.height / 2 + ui.scoreOffsetY,
    };
    this.score.position.set(this._scoreHome.x, this._scoreHome.y, 0);

    // Top right, clear of the hand's fan — which is centred on x = 0 and never
    // reaches this far out. Two buttons, stacked downward.
    const right = halfW - MARGIN - BUTTON.width / 2 + ui.exitOffsetX;
    const top = halfH - MARGIN - BUTTON.height / 2 + ui.exitOffsetY;
    this.exit.scale.set(BUTTON.width, BUTTON.height, 1);
    this.exit.position.set(right, top, 0);
    this.restart.scale.set(BUTTON.width, BUTTON.height, 1);
    this.restart.position.set(right, top - BUTTON.height - 6, 0);

    // Top left.
    this.turn.scale.set(TURN.width, TURN.height, 1);
    this.turn.position.set(-halfW + MARGIN + TURN.width / 2, halfH - MARGIN - TURN.height / 2, 0);
    this._noteLeft = -halfW + MARGIN;
    this._noteY = this.turn.position.y - TURN.height - 6;

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
  update({ dt, match, gameCamera, fade = 1 }) {
    const ui = this.config.ui;
    this.materials.shared.uSnapAmount.value = ui.vertexSnap;
    this._fade = fade;

    if (ui.textureScale !== this._texScale) {
      // Every plate is re-asked for below and the cache has just been emptied,
      // so the swap happens before anything is drawn and no disposed texture is
      // ever bound.
      this._texScale = ui.textureScale;
      clearHudTextureCache();
      this._scoreKey = this._turnKey = this._noteKey = this._buttonKey = '';
    }

    this._updateScore(dt, match, gameCamera);
    this._updateTurn(match);
    this._updateNote(match);
    this._updateButtons();

    /**
     * Last, over the top of whatever each updater decided for itself.
     *
     * Visibility is settled HERE, every frame, from `want` — never inside the
     * updaters. Two of them early-return when nothing they draw has changed, so
     * a plate hidden by the fade in one of those frames would never be told to
     * come back and would stay gone for the rest of the match.
     */
    for (const m of [this.score, this.turn, this.note, this.exit, this.restart]) {
      // ASSIGNED from the plate's own base, never multiplied into what is
      // already there. Multiplying looks equivalent and is not: `turn` and
      // `note` do not rewrite their opacity every frame, so the product
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

    if (board.key !== this._scoreKey) {
      this._scoreKey = board.key;
      this.score.material.uniforms.uMap.value = scorePlateTexture(
        {
          key: board.key,
          left: { value: board.left, color: PLAYER_COLORS[0] },
          right: { value: board.right, color: PLAYER_COLORS[1] },
          caption: board.caption,
        },
        { ...SCORE, scale: ui.textureScale },
      );
    }

    this._pulse = Math.max(0, this._pulse - dt / Math.max(0.05, ui.scorePulseSeconds));
    // Up and back down over the life of the envelope, so it reads as a beat
    // rather than as a size change that then relaxes.
    const bump = Math.sin(Math.PI * this._pulse) * ui.scorePulseScale;
    const shown = smoothstep(this._scoreShown);
    this.score.scale.set(SCORE.width * (1 + bump), SCORE.height * (1 + bump), 1);
    this.score.userData.base = shown;
    this.score.userData.want = shown > 0.004;
  }

  _updateTurn(match) {
    this.turn.userData.want = true;
    this.turn.userData.base = 1;
    const over = match.state === MATCH_STATE.OVER;
    const player = match.rules.currentPlayer;
    const text = over
      ? match.winner === -1
        ? '무승부'
        : `PLAYER ${match.winner + 1} 승리`
      : `PLAYER ${player + 1}`;
    const color = over
      ? match.winner >= 0
        ? PLAYER_COLORS[match.winner]
        : '#888888'
      : PLAYER_COLORS[player];

    const key = `${text}|${color}`;
    if (key === this._turnKey) return;
    this._turnKey = key;
    this.turn.material.uniforms.uMap.value = turnPlateTexture(text, color, {
      ...TURN,
      scale: this.config.ui.textureScale,
    });
  }

  _updateNote(match) {
    const v = match.lastVerdict;
    const text = match.goalPending
      ? match.goalPending.note
      : v
        ? `${v.note || '변화 없음'}${v.reason === 'timeout' ? '  ⏱ 강제 종료' : ''}`
        : '';
    const tone = !match.goalPending && v?.reason === 'timeout' ? 'timeout' : 'normal';

    const key = `${text}|${tone}`;
    if (key !== this._noteKey) {
      this._noteKey = key;
      if (text) {
        const tex = notePlateTexture(text, tone, {
          height: NOTE_HEIGHT,
          scale: this.config.ui.textureScale,
        });
        this.note.material.uniforms.uMap.value = tex;
        const w = tex.userData?.width ?? 120;
        this.note.scale.set(w, NOTE_HEIGHT, 1);
        // Left-aligned with the turn plate above it, so the column has an edge.
        this.note.position.set(this._noteLeft + w / 2, this._noteY, 0);
      }
    }
    this.note.userData.want = !!text;
    this.note.userData.base = 1;
  }

  /**
   * ── the exit never leaves ────────────────────────────────────────────────
   * Zoomed in it drops to `dimOpacity` and stays there. It is not faded out and
   * it is not disabled: the opacity is a VISUAL weight so it stops competing
   * with the board, and the hit quad it is tested against does not know the
   * opacity exists. Hover brings it back to full and swaps in the brighter
   * plate.
   */
  _updateButtons() {
    this.exit.userData.want = true;
    this.restart.userData.want = true;
    const ui = this.config.ui;
    const dim = Math.min(1, Math.max(0, ui.dimOpacity));
    const shown = smoothstep(this._scoreShown);

    for (const h of this._hits) {
      const hot = this.hovered === h.id;
      // Full weight when the board is wide (the same moment the score is up) or
      // when the pointer is on it; dimmed the rest of the time.
      h.plate.userData.base = hot ? 1 : dim + (1 - dim) * shown;
    }

    const key = `${this.hovered ?? '-'}|${ui.textureScale}`;
    if (key === this._buttonKey) return;
    this._buttonKey = key;
    const size = { ...BUTTON, scale: ui.textureScale };
    this.exit.material.uniforms.uMap.value = buttonTexture(
      '나가기',
      this.hovered === 'exit' ? 'hover' : 'idle',
      size,
    );
    this.restart.material.uniforms.uMap.value = buttonTexture(
      '재시작',
      this.hovered === 'restart' ? 'hover' : 'idle',
      size,
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
    else if (id === 'restart') this.onRestart();
    return true;
  }

  clearHover() {
    this.hovered = null;
  }

  get hovering() {
    return this.hovered !== null;
  }

  dispose() {
    for (const m of [this.score, this.turn, this.note, this.exit, this.restart]) {
      m.geometry.dispose();
    }
    for (const h of this._hits) h.mesh.geometry.dispose();
    this.materials.dispose();
    clearHudTextureCache();
    this.scene.clear();
  }
}

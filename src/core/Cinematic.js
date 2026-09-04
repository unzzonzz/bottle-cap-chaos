import { Mesh, PlaneGeometry, Scene } from 'three';
import { FRAME, frameCamera, frameScale, refitFrameCamera } from './frame.js';
import { HudMaterials } from '../ui/HudMaterial.js';
import { PALETTE, toRgb } from './palette.js';
import { cubicBezier, MOTION } from './tokens.js';

/**
 * The letterbox. One frame for the whole match — the way in and the way out.
 *
 * ── it is not physics ───────────────────────────────────────────────────────
 * Nothing here integrates anything and Rapier is not involved. Two rectangles
 * and a clock. That matters most at the end of a match: the victory sequence
 * plays at the one moment the world has stopped stepping, so anything simulated
 * here would be a second physics world running against a first one that is
 * deliberately frozen. It is a scripted path with a clock on it.
 *
 * ── ONE object, used four times ─────────────────────────────────────────────
 * The menu closes it to leave, the game document opens closed and unfolds it
 * for the intro, the victory sequence closes it again, and the release opens it
 * for the buttons. Written as two systems it would be two letterboxes, and the
 * whole point of the redesign is that a match begins and ends inside the SAME
 * frame — two of them and that reading is gone.
 *
 * ── the bars carry the document boundary ────────────────────────────────────
 * The menu and the game are separate documents and `location.assign` is how you
 * get from one to the other. There is a gap between the first going away and
 * the second's first drawn frame, it is not under anyone's control, and the
 * only thing that can be done about it is to make sure nothing CHANGES across
 * it. So the bars close to a full screen of one colour, the swap happens behind
 * that, and the new document opens on the same full screen of the same colour.
 *
 * That colour is `PALETTE.bg.skyTop` and not a black of its own, for two
 * reasons that happen to agree. The palette forbids pure black outright (rule
 * 1 in `core/palette.js`). And skyTop is ALREADY the colour of everything
 * outside the canvas — `--msa-void` in `cssPalette.js`, which is what the
 * browser paints around a 4:3 canvas in a window of any other shape. Picking
 * any other colour for the bars would mean
 * closing them produced a rectangle of one colour inside a window of another,
 * which is the seam this exists to remove. Closed, the whole SCREEN is one
 * colour, canvas and surround alike, and there is nothing left to see.
 *
 * ── it draws last, and outside the bloom ────────────────────────────────────
 * Its own scene and its own orthographic camera over the shared frame, drawn
 * after every other overlay. Outside the bright pass for the same reason the
 * cards and the HUD are: a bright-pass over a hard black edge blooms the edge,
 * and a letterbox with a halo is not a letterbox.
 */

/**
 * How tall each bar is at the letterbox position, in frame pixels — AUTHORED.
 *
 * 56 of the authored 480 is 11.7% a side: the shallow end of the cinema range
 * (2.35:1 on a 4:3 frame would be 26% a side and would leave a slot). It has to
 * be shallow because the picture behind it is a BOARD that the player is about
 * to play on or has just finished playing on. The bars are there to say "this
 * is presented to you", not to crop the game away.
 *
 * Read through `letterboxBar()` and never directly — like every other authored
 * size in this project it is quoted against the 640-wide frame and scaled to the
 * live one. A fixed 56 was tried first and it fails at the small end: a 240-wide
 * frame is 180 tall, and two fixed bars would take 112 of it and leave a 68-pixel
 * slot to play through. Scaling keeps the SHARE constant instead, which is what
 * "a letterbox" means.
 */
const LETTERBOX_BAR = 56;

/** The bar's height at the frame's current scale, in frame pixels. */
export function letterboxBar() {
  return LETTERBOX_BAR * frameScale();
}

/**
 * How much each bar overhangs the frame, in frame pixels.
 *
 * Written for a vertex snap that could move a corner half a low-resolution
 * pixel INWARD, which on a bar leaves a bright line along the top or bottom
 * edge of the screen. That snap is gone. The overhang is not, because the
 * failure it prevents is now reachable by a duller route: the bar is scaled by
 * `frameScale()` and positioned in frame pixels, both of which round, and a bar
 * that lands one pixel short of the edge is the same bright line.
 * `VictoryLayer.OVERHANG` is the same number for the same reason.
 */
const OVERHANG = 6;

const ease = cubicBezier(MOTION.easeInOut);

export class Cinematic {
  constructor() {
    this.scene = new Scene();
    this.camera = frameCamera({ near: -10, far: 10 });

    this.materials = new HudMaterials();
    this._quad = new PlaneGeometry(1, 1);

    /** 0 = fully open, 1 = fully closed. Anything between is the letterbox. */
    this._bars = 0;
    this._barsFrom = 0;
    this._barsTo = 0;
    this._barsT = 1;
    this._barsSpan = 0;

    /**
     * The UI gate, tweened separately from the bars.
     *
     * ── why it is not simply derived from `bars` ────────────────────────────
     * For three of the four movements it would be: the gate is 1 when the bars
     * are open and 0 when they are not, and deriving it would be one line.
     *
     * The fourth is the victory release, where the bars open ALL the way and
     * the match's own HUD must stay down — the two buttons that screen puts up
     * say the same things the corner HUD does, and 나가기 twice on one frame
     * reads as the game being broken. A derived gate cannot express "the bars
     * are open and the UI is still not yours", so the gate is its own value with
     * its own target and `open()` below is what ties the ordinary cases
     * together.
     */
    this._gate = 1;
    this._gateFrom = 1;
    this._gateTo = 1;
    this._gateT = 1;
    this._gateSpan = 0;

    const bar = () => {
      const m = new Mesh(this._quad, this.materials.createSolid(1));
      const rgb = toRgb(PALETTE.bg.skyTop).map((v) => v / 255);
      m.material.uniforms.uTint.value.set(rgb[0], rgb[1], rgb[2]);
      m.renderOrder = 10;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.top = bar();
    this.bottom = bar();

    /**
     * ── nothing is drawn ON the covered frame, and that is deliberate ───────
     * There was a wordmark here. The cap wipe's panel carried the game's logo
     * and at full cover it was eight hundred pixels across, which was the one
     * moment in the game that logo was ever large; when the cap went, the logo
     * was moved onto the bars so the moment would survive them.
     *
     * It is gone on instruction. What that leaves is the thing a covered frame
     * was for in the first place — one flat colour with a scene swap behind it —
     * and `MENU_CONFIG.transition.coverSeconds` went back to the three frames
     * that job actually needs. A held frame with nothing on it is not a beat,
     * it is a pause.
     */

    this.layout();
  }

  /** The `bars` value at which each bar is exactly `letterboxBar()` tall. */
  get letterbox() {
    return Math.min(1, letterboxBar() / Math.max(1, FRAME.height / 2));
  }

  /** 0 = fully open, 1 = fully closed (one colour, edge to edge). */
  get bars() {
    return this._bars;
  }

  /**
   * 0..1. The one scalar the match's own UI multiplies by.
   *
   * Opacity only. Nothing reads this to decide where anything GOES — see the
   * note in `main.js` on the two fades — because a control that slides while it
   * fades is a control whose hit area was somewhere else a moment ago.
   */
  get uiGate() {
    return this._gate;
  }

  /** Is every tween finished? */
  get settled() {
    return this._barsT >= 1 && this._gateT >= 1;
  }

  /** Where the bars are heading. Lets a caller ask before asking again. */
  get target() {
    return this._barsTo;
  }

  /**
   * Move the bars to `target` over `seconds`. Reversible at any point.
   *
   * Idempotent: asking for a target the bars are already travelling to leaves
   * the tween alone rather than restarting it, so a per-frame call site — the
   * intro's exit is one — cannot pin the movement at its first frame.
   */
  to(target, seconds) {
    const want = Math.min(1, Math.max(0, target));
    if (want === this._barsTo && this._barsSpan > 0) return;
    this._barsFrom = this._bars;
    this._barsTo = want;
    this._barsSpan = Math.max(0, seconds);
    this._barsT = this._barsSpan > 0 ? 0 : 1;
    if (this._barsT >= 1) this._bars = want;
  }

  /** The same, for the UI gate. See the note on `_gate`. */
  gateTo(target, seconds) {
    const want = Math.min(1, Math.max(0, target));
    if (want === this._gateTo && this._gateSpan > 0) return;
    this._gateFrom = this._gate;
    this._gateTo = want;
    this._gateSpan = Math.max(0, seconds);
    this._gateT = this._gateSpan > 0 ? 0 : 1;
    if (this._gateT >= 1) this._gate = want;
  }

  /** Bars to the letterbox, UI away. The pair every sequence starts with. */
  close(seconds) {
    this.to(this.letterbox, seconds);
    this.gateTo(0, seconds);
  }

  /** Bars away, UI back. The pair every sequence ends with — except one. */
  open(seconds) {
    this.to(0, seconds);
    this.gateTo(1, seconds);
  }

  /** All the way to one colour, edge to edge. What a document swap hides behind. */
  shut(seconds) {
    this.to(1, seconds);
    this.gateTo(0, seconds);
  }

  /**
   * Land on a value now, with no travel.
   *
   * Two callers: a document that boots closed, and a sequence being pressed
   * through. Both need the frame AFTER this call to be the frame the tween
   * would have reached, which a zero-second tween is not — that one still owes
   * an `update` before it lands.
   */
  snap(value, { gate = null } = {}) {
    const want = Math.min(1, Math.max(0, value));
    this._bars = want;
    this._barsFrom = want;
    this._barsTo = want;
    this._barsSpan = 0;
    this._barsT = 1;
    const g = gate === null ? (want > 0 ? 0 : 1) : Math.min(1, Math.max(0, gate));
    this._gate = g;
    this._gateFrom = g;
    this._gateTo = g;
    this._gateSpan = 0;
    this._gateT = 1;
    this._place();
  }

  /** @param {number} dt  render seconds, already clamped by the caller */
  update(dt) {
    const step = Math.max(0, dt);

    if (this._barsT < 1) {
      this._barsT = this._barsSpan > 0 ? Math.min(1, this._barsT + step / this._barsSpan) : 1;
      this._bars =
        this._barsT >= 1
          ? this._barsTo
          : this._barsFrom + (this._barsTo - this._barsFrom) * ease(this._barsT);
    }
    if (this._gateT < 1) {
      this._gateT = this._gateSpan > 0 ? Math.min(1, this._gateT + step / this._gateSpan) : 1;
      this._gate =
        this._gateT >= 1
          ? this._gateTo
          : this._gateFrom + (this._gateTo - this._gateFrom) * ease(this._gateT);
    }

    this._place();
  }

  _place() {
    const half = FRAME.height / 2;
    const h = this._bars * half;
    const w = FRAME.width + OVERHANG * 2;
    const drawn = h + OVERHANG;

    for (const [m, sign] of [
      [this.top, 1],
      [this.bottom, -1],
    ]) {
      m.visible = h > 0.5;
      if (!m.visible) continue;
      m.scale.set(w, drawn, 1);
      // Anchored to the frame's own edge and grown inward, so the overhang is
      // always outside and the moving edge is the inner one.
      m.position.set(0, sign * (half + OVERHANG - drawn / 2), 0);
    }

  }

  setResolution(_resolution) {
    if (refitFrameCamera(this.camera)) this.layout();
  }

  /** Re-place everything against the frame's current shape. */
  layout() {
    this._place();
  }

  /**
   * Draw it over whatever is already in the bound target.
   *
   * The depth clear is not optional and it is not the caller's: the bars are in
   * front by definition, not by being nearer. `autoClear` goes off around it so
   * what is underneath survives, and back on afterwards because the next frame's
   * first render expects to be clearing. Three lines, and they are the same
   * three every overlay in this project ends with.
   *
   * @param {import('three').WebGLRenderer} renderer
   */
  render(renderer) {
    if (this._bars <= 0) return;
    renderer.clearDepth();
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  dispose() {
    this._quad.dispose();
    this.materials.dispose();
    this.scene.clear();
  }
}

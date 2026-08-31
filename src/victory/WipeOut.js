import { CapWipe } from '../menu/CapWipe.js';

/**
 * The menu's transition, run the other way, from inside a match.
 *
 * ── it is the same cap and the same three stages ─────────────────────────────
 * `CapWipe` is untouched and does all the drawing: the cap grows out of the
 * middle, holds the screen opaque, and carries on out of frame. What is not
 * reused is `menu/Transition`, and the reason is its first stage — the bottle
 * being shaken. There is no bottle here. Borrowing that clock would mean either
 * a third of a second of nothing happening before the cap appears, or reaching
 * into `MENU_CONFIG.transition` to zero a number the menu is also reading.
 *
 * So the clock is these forty lines and the numbers come straight off
 * `MENU_CONFIG.transition` — the same launch, cover and exit lengths the menu
 * uses, so the two directions are the same length and the same shape without
 * either being able to change the other.
 *
 * ── the swap happens under the cover, and it happens once ────────────────────
 * `onCovered` fires on the FIRST opaque frame rather than at the midpoint, so
 * whatever it does has the whole window to get its first frame drawn in instead
 * of the tail of it. That is `Transition`'s own reasoning and its own guard: a
 * frame long enough to step over the entire cover window would otherwise skip
 * the callback and the exit would uncover the thing that was supposed to have
 * been replaced.
 *
 * ── it always uncovers ───────────────────────────────────────────────────────
 * There used to be a `uncover: false` mode that held the covered frame forever,
 * for leaving to the menu: the document was going away, so there was nothing on
 * this side left to reveal. Leaving is the short black fade now — see the note on
 * `onExit` in `main.js` — so the only thing this transition ever has to hide is a
 * scene swap, which is the job it was written for in the menu, and every run
 * finishes by getting out of the way.
 */

const STAGE = { IDLE: 'idle', LAUNCH: 'launch', COVER: 'cover', EXIT: 'exit' };

export class WipeOut {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {object} wipe        the live `MENU_CONFIG.wipe` block
   * @param {object} transition  the live `MENU_CONFIG.transition` block
   * @param {import('three').Texture} [panelMap]  the cap's top artwork
   */
  constructor({ retro, wipe, transition, panelMap = null, color }) {
    this.tuning = transition;
    this.cap = new CapWipe({ retro, tuning: wipe, panelMap, color });
    this.stage = STAGE.IDLE;
    this._clock = 0;
    this._covered = false;
    this._onCovered = null;
  }

  get running() {
    return this.stage !== STAGE.IDLE;
  }

  /**
   * @param {{x: number, y: number}} direction  which way it leaves, in frame px
   * @param {() => void} onCovered  run on the first fully opaque frame
   */
  begin({ direction, onCovered }) {
    if (this.running) return false;
    this.stage = STAGE.LAUNCH;
    this._clock = 0;
    this._covered = false;
    this._onCovered = onCovered ?? null;
    // From the middle of the frame, on the heading it will leave along — the
    // same aimed pose the menu's cap uses, so a player who has seen one has
    // seen this.
    this.cap.begin({ x: 0, y: 0 }, direction);
    // `begin` sets the cap visible but does not touch its SCALE, so a run that
    // gets drawn before its first `update` would show one frame of whatever the
    // last run left behind — which, the second time round, is a cap at full
    // cover. The ordinary path updates first, so this never fires; it costs one
    // call and removes a frame-order dependency from a transition whose whole
    // job is to hide a seam.
    this.cap.launch(0, 0);
    return true;
  }

  /** Fire the swap, once, whichever path got here. */
  _cover() {
    if (this._covered) return;
    this._covered = true;
    const fn = this._onCovered;
    this._onCovered = null;
    fn?.();
  }

  update(dt) {
    if (!this.running) return;
    const t = this.tuning;
    this._clock += dt;

    const launchEnd = Math.max(1e-4, t.launchSeconds);
    const coverEnd = launchEnd + Math.max(0, t.coverSeconds);
    const exitEnd = coverEnd + Math.max(1e-4, t.exitSeconds);
    const at = this._clock;

    if (at < launchEnd) {
      this.stage = STAGE.LAUNCH;
      this.cap.launch(at / launchEnd, dt);
      return;
    }

    if (at < coverEnd) {
      this.stage = STAGE.COVER;
      this.cap.cover(dt);
      this._cover();
      return;
    }

    // The backstop `Transition` also carries: a frame long enough to step over
    // the whole cover window must not lose the swap.
    this._cover();

    if (at < exitEnd) {
      this.stage = STAGE.EXIT;
      this.cap.exit((at - coverEnd) / (exitEnd - coverEnd), dt);
      return;
    }

    this.stage = STAGE.IDLE;
    this.cap.end();
  }

  /** @param {import('three').WebGLRenderer} renderer */
  render(renderer) {
    if (!this.running) return;
    this.cap.render(renderer);
  }

  dispose() {
    this.cap.dispose();
  }
}

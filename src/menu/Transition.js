/**
 * The three stages, and the clock that walks them.
 *
 * It owns no three.js objects and draws nothing. It answers two questions per
 * frame — which stage, and how far into it — and fires two callbacks at the two
 * moments that are not just "some more time passed": the cap leaving the bottle
 * and the screen going opaque.
 *
 *   1  POP      the cap leaves the mouth and comes at the camera, growing
 *   2  COVER    the cap fills the frame, and the scene is swapped underneath it
 *   3  EXIT     it carries on past the camera and out
 *
 * ── stage 3 only runs on a swap that STAYS in this document ────────────────
 * A navigation stops at the cover: `location.assign` does not tear this page
 * down synchronously, so a menu that uncovered on the way out would show itself
 * again for however long the next document takes to paint. The far side picks
 * the cap up instead and plays the exit there — `main.js`, and §7.3's contract
 * is that the covered frame is the seam. The clock still runs the stage; what
 * changes is what `bootMenu` does with it.
 *
 * ── stage 1 used to be a SHAKE, and the interaction went with it ───────────
 * There were three stages, and the first was the bottle being worked up: it
 * rattled along its own axis, the camera rattled with it, the carbonation
 * climbed, and holding the menu item down kept it there — press to shake it up,
 * release to open it. `shakeEnd`, `hold()`, `release()` and `_heldFor` were the
 * whole of that mechanism: the boundary was held a second in the future while
 * the press was down and froze wherever the clock had reached when it came up.
 *
 * §6.1 of the direction removes it. The bottle FLOATS now — there is no hand in
 * the picture to shake it with, and a floating object that rattles reads as a
 * physics glitch rather than as somebody building up pressure. The carbonation
 * survives with a different reason for existing: it is the drink's own, always
 * there, rather than something a gesture produces.
 *
 * What that costs is real and worth naming: the run is now a fixed length with
 * no way to make it longer, so a player who liked winding it up has nothing to
 * wind. What it buys is that choosing a menu item is one gesture again.
 *
 * ── stage 2 used to be a cap that ate the screen ────────────────────────────
 * There were four stages then. The cap came off, grew until it covered the
 * frame, held it for the swap, and flew out again — `menu/CapWipe.js`. The cover
 * became the letterbox's job and the cap was cut back to the part that was about
 * the BOTTLE. §7.2 sends it the other way again: the cap is the object that
 * carries the screen across, and `CapWipe` comes back for it. That is PHASE 2's
 * change and this file will feel it — but the CLOCK is the same clock, and the
 * two callbacks are the same two moments.
 *
 * ── it is not physics ───────────────────────────────────────────────────────
 * Nothing here integrates anything. Rapier is not involved and must not be: the
 * player sees this every time they choose a menu item, so it has to be the same
 * every time, and a simulated cap is by definition one that could come out
 * differently. It is a scripted path with a clock on it.
 *
 * ── the swap fires once, and only from inside COVER ─────────────────────────
 * `_swapped` guards it. The interesting case is not the ordinary one, it is a
 * jump: `skip()` moves the clock forward, and if the jump landed past the cover
 * window entirely then the swap would never have happened and the run would end
 * on the menu the player was trying to leave. `skip()` therefore lands ON the
 * start of the cover window rather than at the end of the run, which is both
 * correct and — since the frame is already one flat colour at that moment —
 * indistinguishable from an instant cut.
 *
 * Today the only thing that calls `skip` is the debug panel's 커버로 건너뛰기,
 * which exists because the cover window is three frames long and is not
 * something you can catch by looking. The rule stays because the swap still
 * lives inside that window and any future caller landing past it would uncover
 * the menu.
 */

export const STAGE = {
  IDLE: 'idle',
  POP: 'pop',
  COVER: 'cover',
  EXIT: 'exit',
};

export class Transition {
  /** @param {object} tuning  the live `MENU_CONFIG.transition` block */
  constructor({ tuning }) {
    this.tuning = tuning;
    this.stage = STAGE.IDLE;
    this.t = 0;
    this._clock = 0;
    this._swapped = false;
    this._popped = false;
    this.target = null;
    this.onPop = null;
    this.onSwap = null;
    this.onDone = null;
  }

  get running() {
    return this.stage !== STAGE.IDLE;
  }

  /** Seconds from the start of the run to the first fully covered frame. */
  get coverAt() {
    return this.tuning.barSeconds;
  }

  get totalSeconds() {
    const t = this.tuning;
    return t.barSeconds + t.coverSeconds + t.exitSeconds;
  }

  /**
   * @param {*} target  handed back to `onSwap`; this class never reads it
   * @param {{onPop?: Function, onSwap?: Function, onDone?: Function}} hooks
   */
  begin(target, hooks = {}) {
    if (this.running) return false;
    this.target = target;
    this.onPop = hooks.onPop ?? null;
    this.onSwap = hooks.onSwap ?? null;
    this.onDone = hooks.onDone ?? null;
    this._clock = 0;
    this._swapped = false;
    this._popped = false;
    this.stage = STAGE.POP;
    this.t = 0;
    /**
     * The pop fires on the FIRST update rather than here.
     *
     * `onPop` is a sound and a burst of foam, and firing it from `begin` would
     * put both of them a frame before anything moved. The `_popped` latch below
     * handles it on the first frame of the window, which is where every other
     * event in this class fires.
     */
    return true;
  }

  /**
   * Jump to the first fully covered frame.
   *
   * Not to the end. See the header — the swap lives inside the cover window,
   * and skipping past it would leave the player looking at the menu they just
   * left, from behind bars that have already parted.
   */
  skip() {
    if (!this.running || this._swapped) return;
    this._clock = this.coverAt;
    this._popped = true;
  }

  /**
   * @returns {{stage: string, t: number, pop: number}}
   *   `pop` is the cap's own hop, 0 outside its window. `t` runs 0..1 through
   *   whichever stage is current.
   */
  update(dt) {
    if (!this.running) return { stage: STAGE.IDLE, t: 0, pop: 0 };

    const c = this.tuning;
    this._clock += dt;

    const popEnd = c.barSeconds;
    const coverEnd = popEnd + c.coverSeconds;
    const exitEnd = coverEnd + c.exitSeconds;
    const at = this._clock;

    if (at < popEnd) {
      this.stage = STAGE.POP;
      this.t = at / Math.max(1e-4, c.barSeconds);
      if (!this._popped) {
        this._popped = true;
        this.onPop?.();
      }
    } else if (at < coverEnd) {
      this.stage = STAGE.COVER;
      this.t = (at - popEnd) / Math.max(1e-4, c.coverSeconds);
      // Fired on the first frame of the window rather than at its midpoint, so
      // the new scene has the whole window to have its first frame drawn in
      // instead of the tail of it.
      if (!this._swapped) {
        this._swapped = true;
        this.onSwap?.(this.target);
      }
    } else if (at < exitEnd) {
      this.stage = STAGE.EXIT;
      this.t = (at - coverEnd) / Math.max(1e-4, c.exitSeconds);
      /**
       * The swap is latched here too, for a frame long enough to step over the
       * whole cover window.
       *
       * It was only in the terminal branch before, which was correct while the
       * cover was the last thing that happened. With an exit after it, a 100 ms
       * frame lands here with the menu uncovering over a scene that was never
       * swapped — and the guard has to be on the first branch past the window,
       * not on the last branch of the run.
       */
      if (!this._swapped) {
        this._swapped = true;
        this.onSwap?.(this.target);
      }
    } else {
      this.stage = STAGE.IDLE;
      this.t = 0;
      // The guard for a frame long enough to step over the whole cover window —
      // an alt-tab, a slow first draw of the destination — where the swap would
      // otherwise be lost and the run would end on the screen it was leaving.
      if (!this._swapped) {
        this._swapped = true;
        this.onSwap?.(this.target);
      }
      const done = this.onDone;
      this.onDone = null;
      done?.();
    }

    /**
     * The bottle's own cap leaving the mouth, 0..1, over the FRONT of stage 1.
     *
     * Shorter than the stage. The crimp letting go is an event and the flight
     * is what fills the rest of the window — and the two are different objects
     * by then: the bottle hides its cap on the frame the overlay gains one.
     * Past `popSeconds` it stays at 1.
     */
    const pop = this.stage === STAGE.POP ? Math.min(1, at / Math.max(1e-4, c.popSeconds)) : 0;
    return { stage: this.stage, t: this.t, pop };
  }
}

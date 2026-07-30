/**
 * The five stages of the winning sequence, and the clock that walks them.
 *
 * It owns no three.js objects and draws nothing, exactly as `menu/Transition`
 * does for the cap wipe. It answers two questions per frame — which stage, and
 * how far into it — and everything about what that LOOKS like is next door in
 * `VictoryLayer`.
 *
 *   1  ENTER    the losing cap is on screen, floating
 *   2  CHARGE   the winning cap crosses the frame
 *   3  IMPACT   the hit: shake, inversion, ring
 *   4  RESULT   the loser flips out of frame, the winner settles
 *   5  UI       the winner line, then the buttons
 *   -  DONE     everything is up and pressable
 *
 * ── it is not physics ───────────────────────────────────────────────────────
 * Nothing here integrates anything and Rapier is not involved. The brief rules
 * it out and there is a harder reason to want it ruled out: this plays at the
 * one moment the match has finished and its world has stopped stepping, so a
 * simulated collision here would be a second physics world running against a
 * first one that is deliberately frozen. It is a scripted path with a clock.
 *
 * ── stage 3 is counted in FRAMES ────────────────────────────────────────────
 * Two to four of them, per the brief. A duration in seconds would land on a
 * different number of frames depending on the display, and at three frames that
 * is the difference between a flash and nothing at all — the same argument
 * `CardFx` makes for `smashInvertFrames`, and this clock is where it is spent:
 * `update` is told how many frames are owed and counts them down itself.
 *
 * ── the skip lands on DONE, not on the end of a stage ───────────────────────
 * A press during the animation goes straight to the pressable screen. That is
 * the whole of it — there is no half-skip and no fast-forward, because a player
 * pressing through a flourish wants the thing behind it, not a quicker version
 * of the flourish. `VictoryLayer.skip` snaps every animated value to its final
 * state in the same call, so the frame after a skip is identical to the frame
 * the sequence would have reached on its own.
 */

export const VICTORY_STAGE = {
  IDLE: 'idle',
  ENTER: 'enter',
  CHARGE: 'charge',
  IMPACT: 'impact',
  RESULT: 'result',
  UI: 'ui',
  DONE: 'done',
};

/** Stage order, for `atOrPast`. */
const ORDER = [
  VICTORY_STAGE.IDLE,
  VICTORY_STAGE.ENTER,
  VICTORY_STAGE.CHARGE,
  VICTORY_STAGE.IMPACT,
  VICTORY_STAGE.RESULT,
  VICTORY_STAGE.UI,
  VICTORY_STAGE.DONE,
];

export class VictoryClock {
  /** @param {typeof import('../game/config.js').CONFIG.victory} tuning  live block */
  constructor({ tuning }) {
    this.tuning = tuning;
    this.stage = VICTORY_STAGE.IDLE;
    /** 0..1 through the current stage. 1 while DONE. */
    this.t = 0;
    /** Seconds since `begin`, excluding the frames stage 3 held for. */
    this.elapsed = 0;
    /** Frames of stage 3 still owed. */
    this._impactLeft = 0;
    /** Frames of stage 3 already served. For the inversion's own counter. */
    this.impactFrame = 0;
    this._skipped = false;
  }

  get running() {
    return this.stage !== VICTORY_STAGE.IDLE;
  }

  get done() {
    return this.stage === VICTORY_STAGE.DONE;
  }

  /** Was this run pressed through? For the panel, and for nothing else. */
  get skipped() {
    return this._skipped;
  }

  /** True once `stage` has reached `name` — DONE counts as past everything. */
  atOrPast(name) {
    return ORDER.indexOf(this.stage) >= ORDER.indexOf(name);
  }

  begin() {
    this.stage = VICTORY_STAGE.ENTER;
    this.t = 0;
    this.elapsed = 0;
    this._impactLeft = Math.max(1, Math.round(this.tuning.impactFrames));
    this.impactFrame = 0;
    this._skipped = false;
  }

  /** Straight to the pressable screen. */
  skip() {
    if (!this.running || this.done) return false;
    this._skipped = true;
    this.stage = VICTORY_STAGE.DONE;
    this.t = 1;
    this._impactLeft = 0;
    // Left where the hit finished rather than zeroed, so anything reading it
    // after a skip sees "the inversion is over" and not "it never happened".
    this.impactFrame = Math.max(1, Math.round(this.tuning.impactFrames));
    return true;
  }

  /**
   * Drop straight into a named stage, mid-run.
   *
   * One caller: a DRAW, which has no loser to hit and therefore nothing for
   * stages 1 to 4 to say — see `VictoryLayer.begin`. It is a jump and not a
   * skip: `skipped` stays false, because nobody pressed anything.
   */
  jumpTo(stage) {
    if (!this.running) return;
    this.stage = stage;
    this.elapsed = 0;
    this.t = stage === VICTORY_STAGE.DONE ? 1 : 0;
    this._impactLeft = stage === VICTORY_STAGE.IMPACT ? Math.max(1, Math.round(this.tuning.impactFrames)) : 0;
  }

  reset() {
    this.stage = VICTORY_STAGE.IDLE;
    this.t = 0;
    this.elapsed = 0;
    this._impactLeft = 0;
    this.impactFrame = 0;
    this._skipped = false;
  }

  /**
   * One frame of the clock.
   *
   * ── stage 3 does not consume dt, and that is deliberate ──────────────────
   * It is a frame count, so it advances once per CALL however long the frame
   * was. A tab that comes back after a second hands `tick` a clamped 50 ms and
   * that is still one frame of inversion, not thirty — which is the behaviour
   * you want, because the inversion is a thing done to a FRAME.
   *
   * @param {number} dt  render seconds, already clamped by the caller
   * @returns {{stage: string, t: number}}
   */
  update(dt) {
    if (!this.running || this.done) return { stage: this.stage, t: this.t };

    const c = this.tuning;

    if (this.stage === VICTORY_STAGE.IMPACT) {
      this.impactFrame++;
      this._impactLeft--;
      const total = Math.max(1, Math.round(c.impactFrames));
      this.t = Math.min(1, this.impactFrame / total);
      if (this._impactLeft <= 0) {
        this.stage = VICTORY_STAGE.RESULT;
        this.t = 0;
        this.elapsed = 0;
      }
      return { stage: this.stage, t: this.t };
    }

    this.elapsed += dt;

    const span =
      this.stage === VICTORY_STAGE.ENTER
        ? c.enterSeconds
        : this.stage === VICTORY_STAGE.CHARGE
          ? c.chargeSeconds
          : this.stage === VICTORY_STAGE.RESULT
            ? c.resultSeconds
            : c.uiSeconds;

    this.t = Math.min(1, this.elapsed / Math.max(1e-4, span));

    if (this.elapsed >= span) {
      this.elapsed = 0;
      this.t = 0;
      if (this.stage === VICTORY_STAGE.ENTER) this.stage = VICTORY_STAGE.CHARGE;
      else if (this.stage === VICTORY_STAGE.CHARGE) {
        this.stage = VICTORY_STAGE.IMPACT;
        /**
         * The frame count is read HERE, at the hit, and not at `begin`.
         *
         * It was read at `begin` first, which is wrong twice over. The small
         * wrong is that dragging the slider mid-sequence then did nothing until
         * the next playthrough, on a panel whose whole purpose is that a value
         * moved while watching changes what is being watched. The real wrong is
         * that it made the count depend on how the stage was ARRIVED at — a jump
         * straight into `charge` left it at whatever the previous run had
         * finished on, and the hit lasted that long or not at all.
         */
        this._impactLeft = Math.max(1, Math.round(this.tuning.impactFrames));
        this.impactFrame = 0;
      } else if (this.stage === VICTORY_STAGE.RESULT) this.stage = VICTORY_STAGE.UI;
      else {
        this.stage = VICTORY_STAGE.DONE;
        this.t = 1;
      }
    }

    return { stage: this.stage, t: this.t };
  }
}

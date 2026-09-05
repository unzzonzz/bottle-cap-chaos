/**
 * The four stages of the ending, and the clock that walks them.
 *
 * It owns no three.js objects and draws nothing, exactly as `menu/Transition`
 * does for the way in. It answers two questions per frame — which stage, and
 * how far into it — and everything about what that LOOKS like is next door in
 * `VictoryLayer`, or in `main.js` for the one part of it that is the camera's.
 *
 *   1  FREEZE   the board holds; the camera pushes in on what decided it
 *   2  BARS     the letterbox closes over it
 *   3  RESULT   the winner, and the mode's own number, in the band
 *   4  RELEASE  the bars retreat and the two buttons come up
 *   -  DONE     everything is up and pressable
 *
 * ── it is not physics ───────────────────────────────────────────────────────
 * Nothing here integrates anything and Rapier is not involved. The brief rules
 * it out and there is a harder reason to want it ruled out: this plays at the
 * one moment the match has finished and its world has stopped stepping, so a
 * simulated anything here would be a second physics world running against a
 * first one that is deliberately frozen. It is a scripted path with a clock.
 *
 * ── there were five stages and they were a cap fight ────────────────────────
 * ENTER, CHARGE, IMPACT, RESULT, UI: the losing cap floated, the winning one
 * crossed the frame, they collided, the loser flipped out and the winner sprang
 * back. Stage 3 was counted in FRAMES rather than seconds — two to four of them
 * — because a whole-frame flash at that length lands on a different number of
 * frames depending on the display, and at three frames that is the difference
 * between a flash and nothing at all.
 *
 * There is no impact any more, so there is no frame count here. That discipline
 * did not go away with it: the one short beat left in this sequence is the
 * ripple on the winning caps, and `CardFx` draws it with its own timing — the
 * same 원모어 flourish the card plays, played with no card behind it. The
 * argument for counting it carefully is made in `CardFx._updateRipple`, which
 * is where it is actually spent. Two counters for one beat is two beats.
 *
 * ── a DRAW takes the same four stages ───────────────────────────────────────
 * There used to be a `jumpTo` and one caller: a draw, which had no loser to be
 * hit and therefore nothing for four of the five stages to say, so it skipped
 * straight to the text. That was backwards. A draw is the result that most
 * needs explaining — why did it stop, rounds or time? — and it was the one
 * getting the least. The camera has something to push in on either way, the
 * bars close either way, and the number in the band is what answers the
 * question. So there is no jump and no branch: 무승부 is a different string in
 * the same sequence.
 *
 * ── the skip lands on DONE, not on the end of a stage ───────────────────────
 * A press during the sequence goes straight to the pressable screen. That is
 * the whole of it — there is no half-skip and no fast-forward, because a player
 * pressing through a flourish wants the thing behind it, not a quicker version
 * of the flourish. `VictoryLayer.skip` snaps every animated value to its final
 * state in the same call and `main.js` lands the camera, so the frame after a
 * skip is identical to the frame the sequence would have reached on its own.
 */

export const VICTORY_STAGE = {
  IDLE: 'idle',
  FREEZE: 'freeze',
  BARS: 'bars',
  RESULT: 'result',
  RELEASE: 'release',
  DONE: 'done',
};

/** Stage order, for `atOrPast`. */
const ORDER = [
  VICTORY_STAGE.IDLE,
  VICTORY_STAGE.FREEZE,
  VICTORY_STAGE.BARS,
  VICTORY_STAGE.RESULT,
  VICTORY_STAGE.RELEASE,
  VICTORY_STAGE.DONE,
];

export class VictoryClock {
  /** @param {typeof import('../game/config.js').CONFIG.victory} tuning  live block */
  constructor({ tuning }) {
    this.tuning = tuning;
    this.stage = VICTORY_STAGE.IDLE;
    /** 0..1 through the current stage. 1 while DONE. */
    this.t = 0;
    /** Seconds inside the current stage. */
    this.elapsed = 0;
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
    this.stage = VICTORY_STAGE.FREEZE;
    this.t = 0;
    this.elapsed = 0;
    this._skipped = false;
  }

  /** Straight to the pressable screen. */
  skip() {
    if (!this.running || this.done) return false;
    this._skipped = true;
    this.stage = VICTORY_STAGE.DONE;
    this.t = 1;
    this.elapsed = 0;
    return true;
  }

  reset() {
    this.stage = VICTORY_STAGE.IDLE;
    this.t = 0;
    this.elapsed = 0;
    this._skipped = false;
  }

  /** How long the named stage lasts, in seconds. */
  _span(stage) {
    const c = this.tuning;
    if (stage === VICTORY_STAGE.FREEZE) return c.freezeSeconds;
    if (stage === VICTORY_STAGE.BARS) return c.barSeconds;
    if (stage === VICTORY_STAGE.RESULT) return c.resultSeconds;
    return c.releaseSeconds;
  }

  /**
   * One frame of the clock.
   *
   * The stage lengths are read HERE rather than latched at `begin`, so a slider
   * dragged mid-sequence changes what is being watched. That is the whole point
   * of the panel having them, and it is the mistake the old clock made and had
   * to fix: a length read once at the start left the panel doing nothing until
   * the next playthrough.
   *
   * @param {number} dt  render seconds, already clamped by the caller
   * @returns {{stage: string, t: number}}
   */
  update(dt) {
    if (!this.running || this.done) return { stage: this.stage, t: this.t };

    this.elapsed += dt;
    const span = Math.max(1e-4, this._span(this.stage));
    this.t = Math.min(1, this.elapsed / span);

    if (this.elapsed >= span) {
      this.elapsed = 0;
      this.t = 0;
      if (this.stage === VICTORY_STAGE.FREEZE) this.stage = VICTORY_STAGE.BARS;
      else if (this.stage === VICTORY_STAGE.BARS) this.stage = VICTORY_STAGE.RESULT;
      else if (this.stage === VICTORY_STAGE.RESULT) this.stage = VICTORY_STAGE.RELEASE;
      else {
        this.stage = VICTORY_STAGE.DONE;
        this.t = 1;
      }
    }

    return { stage: this.stage, t: this.t };
  }
}

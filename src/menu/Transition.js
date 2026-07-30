/**
 * The four stages, and the clock that walks them.
 *
 * It owns no three.js objects and draws nothing. It answers two questions per
 * frame — which stage, and how far into it — and fires two callbacks at the two
 * moments that are not just "some more time passed": the cap leaving the bottle
 * and the screen going opaque.
 *
 *   1  SHAKE    the bottle rattles along its own axis, the camera with it
 *   2  LAUNCH   the cap comes off and grows to fill the frame
 *   3  COVER    the frame is opaque, and the scene is swapped underneath it
 *   4  EXIT     the cap carries on and leaves
 *
 * ── it is not physics ───────────────────────────────────────────────────────
 * Nothing here integrates anything. Rapier is not involved and must not be: the
 * player sees this every time they choose a menu item, so it has to be the same
 * every time, and a simulated cap is by definition one that could come out
 * differently. It is a scripted path with a clock on it.
 *
 * ── the swap fires once, and only from inside COVER ─────────────────────────
 * `_swapped` guards it. The interesting case is not the ordinary one, it is the
 * skip: a press jumps the clock forward, and if the jump landed past the cover
 * window entirely then the swap would never have happened and the exit would
 * uncover the menu the player was trying to leave. `skip()` therefore lands ON
 * the start of the cover window rather than at the end of the run, which is
 * both correct and — since the cap is already the whole screen at that moment —
 * indistinguishable from an instant cut.
 */

export const STAGE = {
  IDLE: 'idle',
  SHAKE: 'shake',
  LAUNCH: 'launch',
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
    this._launched = false;
    /** Whether the press that started this run is still down. */
    this._held = false;
    /** Where the clock had got to when it was let go. */
    this._heldFor = 0;
    this.target = null;
    this.onLaunch = null;
    this.onSwap = null;
    this.onDone = null;
  }

  get running() {
    return this.stage !== STAGE.IDLE;
  }

  /**
   * When stage 1 ends.
   *
   * ── hold to shake it up ──────────────────────────────────────────────────
   * While the press is still down the boundary is kept a second ahead of the
   * clock, so stage 1 simply cannot end and the bottle goes on being worked:
   * the carbonation keeps climbing, the drink keeps sloshing, nothing fires.
   * Let go and the boundary freezes wherever the clock had reached, so the cap
   * goes on the release.
   *
   * The `max` against the nominal length is the other half of it, and it is
   * what makes a plain tap still feel like something: a press-and-release
   * inside a few frames does not skip the wind-up, it gets the full one. So the
   * interaction has a floor and no ceiling — you can always hold it longer, you
   * can never make it snappier than it is meant to be.
   */
  get shakeEnd() {
    const c = this.tuning;
    if (this._held) return Math.max(c.shakeSeconds, this._clock + 1);
    return Math.max(c.shakeSeconds, this._heldFor);
  }

  /** Seconds from the start of the run to the first opaque frame. */
  get coverAt() {
    return this.shakeEnd + this.tuning.launchSeconds;
  }

  get held() {
    return this._held;
  }

  /** The press is still down: keep shaking. */
  hold() {
    if (this.running) this._held = true;
  }

  /** Let go — fire on the next frame, or once the minimum wind-up is served. */
  release() {
    this._held = false;
  }

  get totalSeconds() {
    const t = this.tuning;
    return t.shakeSeconds + t.launchSeconds + t.coverSeconds + t.exitSeconds;
  }

  /**
   * @param {*} target  handed back to `onSwap`; this class never reads it
   * @param {{onLaunch?: Function, onSwap?: Function, onDone?: Function}} hooks
   */
  begin(target, hooks = {}, { held = false } = {}) {
    if (this.running) return false;
    this.target = target;
    this.onLaunch = hooks.onLaunch ?? null;
    this.onSwap = hooks.onSwap ?? null;
    this.onDone = hooks.onDone ?? null;
    this._clock = 0;
    this._swapped = false;
    this._launched = false;
    this._held = held;
    this._heldFor = 0;
    this.stage = STAGE.SHAKE;
    this.t = 0;
    return true;
  }

  /**
   * Jump to the first opaque frame.
   *
   * Not to the end. See the header — the swap lives inside the cover window,
   * and skipping past it would leave the player looking at the menu they just
   * left, from behind a cap that has already gone.
   *
   * ── nothing in the menu calls this any more ──────────────────────────────
   * It used to be the player's skip, and a press during the flight fired it.
   * That turned a double-tap into a way to enter the game with no animation at
   * all, so the menu dropped it — the press-and-hold's RELEASE is the escape
   * hatch now. What still needs this is the game page picking the transition up
   * after a document swap: it begins a run and immediately skips to the covered
   * frame, which is exactly where the other document left off.
   */
  skip() {
    if (!this.running || this._swapped) return;
    // Letting go first, so `coverAt` reads the frozen boundary rather than the
    // one that is being held a second in the future.
    this._held = false;
    this._clock = this.coverAt;
    this._launched = true;
  }

  /**
   * @returns {{stage: string, t: number, shake: number}}
   *   `shake` is the stage-1 envelope, 0 outside it.
   */
  update(dt) {
    if (!this.running) return { stage: STAGE.IDLE, t: 0, shake: 0 };

    const c = this.tuning;
    this._clock += dt;
    // Only while the press is down; once it is up this stops moving and the
    // boundary it feeds is frozen. See `shakeEnd`.
    if (this._held) this._heldFor = this._clock;

    const shakeEnd = this.shakeEnd;
    const launchEnd = shakeEnd + c.launchSeconds;
    const coverEnd = launchEnd + c.coverSeconds;
    const exitEnd = coverEnd + c.exitSeconds;
    const at = this._clock;

    if (at < shakeEnd) {
      this.stage = STAGE.SHAKE;
      // Against the NOMINAL length, not the held one: the shake ramps up over
      // its own wind-up and then stays at full strength for as long as it is
      // held. Dividing by the held length instead would make a long hold ramp
      // up in slow motion and never reach full.
      this.t = Math.min(1, at / Math.max(1e-4, c.shakeSeconds));
    } else if (at < launchEnd) {
      this.stage = STAGE.LAUNCH;
      this.t = (at - shakeEnd) / Math.max(1e-4, c.launchSeconds);
      if (!this._launched) {
        this._launched = true;
        this.onLaunch?.();
      }
    } else if (at < coverEnd) {
      this.stage = STAGE.COVER;
      this.t = (at - launchEnd) / Math.max(1e-4, c.coverSeconds);
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
      // The guard for a frame long enough to step over the whole cover window —
      // an alt-tab, a slow first draw of the destination — where the swap would
      // otherwise be skipped and the exit would reveal the old scene.
      if (!this._swapped) {
        this._swapped = true;
        this.onSwap?.(this.target);
      }
    } else {
      this.stage = STAGE.IDLE;
      this.t = 0;
      const done = this.onDone;
      this.onDone = null;
      done?.();
    }

    // Raw progress through stage 1, 0 outside it. The ramp that turns this into
    // an amplitude is the bottle's — `shakeCurve` is a fact about how a bottle
    // is worked up, not about how long the stage is, and it belongs with the
    // other bottle numbers rather than here.
    const shake = this.stage === STAGE.SHAKE ? this.t : 0;
    return { stage: this.stage, t: this.t, shake };
  }
}

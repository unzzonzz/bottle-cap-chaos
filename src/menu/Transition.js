/**
 * The three stages, and the clock that walks them.
 *
 * It owns no three.js objects and draws nothing. It answers two questions per
 * frame — which stage, and how far into it — and fires two callbacks at the two
 * moments that are not just "some more time passed": the cap leaving the bottle
 * and the screen going opaque.
 *
 *   1  SHAKE    the bottle rattles along its own axis, the camera with it
 *   2  POP      the cap hops off the mouth; the letterbox closes over it
 *   3  COVER    the frame is one colour, and the scene is swapped underneath it
 *
 * ── stage 2 used to be a cap that ate the screen ────────────────────────────
 * There were four stages. The cap came off, grew until it covered the frame,
 * held it for the swap, and flew out again — `menu/CapWipe.js`, and stage 4 was
 * picked up on the far side of the document change by `main.js`.
 *
 * The cover is the letterbox's job now (`core/Cinematic.js`), and the cap does
 * only the part that was about the BOTTLE: it hops off the mouth and the eruption
 * goes off behind it. It never crosses the frame. So stage 2 is as long as the
 * bars take to close and the hop is a short event at the front of it — see
 * `barSeconds` and `popSeconds` in `menuConfig` — and stage 4 has nothing left
 * to do, because what continues across the document boundary is a bar position
 * rather than a cap in flight.
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
 * That discipline outlived its first caller. The game page used to `begin` and
 * immediately `skip` to pick the cap up mid-flight; it now opens on a letterbox
 * that is already shut and has nothing to pick up, so today the only thing that
 * calls `skip` is the debug panel's 커버로 건너뛰기, which exists because the
 * cover window is three frames long and is not something you can catch by
 * looking. The rule stays because the swap still lives inside that window and
 * any future caller landing past it would uncover the menu.
 */

export const STAGE = {
  IDLE: 'idle',
  SHAKE: 'shake',
  POP: 'pop',
  COVER: 'cover',
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
    /** Whether the press that started this run is still down. */
    this._held = false;
    /** Where the clock had got to when it was let go. */
    this._heldFor = 0;
    this.target = null;
    this.onPop = null;
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

  /** Seconds from the start of the run to the first fully covered frame. */
  get coverAt() {
    return this.shakeEnd + this.tuning.barSeconds;
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
    return t.shakeSeconds + t.barSeconds + t.coverSeconds;
  }

  /**
   * @param {*} target  handed back to `onSwap`; this class never reads it
   * @param {{onPop?: Function, onSwap?: Function, onDone?: Function}} hooks
   */
  begin(target, hooks = {}, { held = false } = {}) {
    if (this.running) return false;
    this.target = target;
    this.onPop = hooks.onPop ?? null;
    this.onSwap = hooks.onSwap ?? null;
    this.onDone = hooks.onDone ?? null;
    this._clock = 0;
    this._swapped = false;
    this._popped = false;
    this._held = held;
    this._heldFor = 0;
    this.stage = STAGE.SHAKE;
    this.t = 0;
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
    // Letting go first, so `coverAt` reads the frozen boundary rather than the
    // one that is being held a second in the future.
    this._held = false;
    this._clock = this.coverAt;
    this._popped = true;
  }

  /**
   * @returns {{stage: string, t: number, shake: number, pop: number}}
   *   `shake` is the stage-1 envelope and `pop` the cap's own hop, both 0
   *   outside their windows. `t` runs 0..1 through whichever stage is current.
   */
  update(dt) {
    if (!this.running) return { stage: STAGE.IDLE, t: 0, shake: 0, pop: 0 };

    const c = this.tuning;
    this._clock += dt;
    // Only while the press is down; once it is up this stops moving and the
    // boundary it feeds is frozen. See `shakeEnd`.
    if (this._held) this._heldFor = this._clock;

    const shakeEnd = this.shakeEnd;
    const popEnd = shakeEnd + c.barSeconds;
    const coverEnd = popEnd + c.coverSeconds;
    const at = this._clock;

    if (at < shakeEnd) {
      this.stage = STAGE.SHAKE;
      // Against the NOMINAL length, not the held one: the shake ramps up over
      // its own wind-up and then stays at full strength for as long as it is
      // held. Dividing by the held length instead would make a long hold ramp
      // up in slow motion and never reach full.
      this.t = Math.min(1, at / Math.max(1e-4, c.shakeSeconds));
    } else if (at < popEnd) {
      this.stage = STAGE.POP;
      this.t = (at - shakeEnd) / Math.max(1e-4, c.barSeconds);
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

    // Raw progress through stage 1, 0 outside it. The ramp that turns this into
    // an amplitude is the bottle's — `shakeCurve` is a fact about how a bottle
    // is worked up, not about how long the stage is, and it belongs with the
    // other bottle numbers rather than here.
    const shake = this.stage === STAGE.SHAKE ? this.t : 0;
    /**
     * The cap's hop, 0..1, over the FRONT of stage 2 and not the whole of it.
     *
     * The stage is as long as the bars take to close and the hop is much
     * shorter — a cap that took the whole of the close to leave the bottle
     * would still be rising when the frame went opaque, which reads as the
     * animation being cut off rather than finished. Past `popSeconds` it stays
     * at 1, which is the pose the cap is hidden on.
     */
    const pop =
      this.stage === STAGE.POP
        ? Math.min(1, (at - shakeEnd) / Math.max(1e-4, c.popSeconds))
        : 0;
    return { stage: this.stage, t: this.t, shake, pop };
  }
}

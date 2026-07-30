import { secondsToSteps } from './Arena.js';

/**
 * When a turn is over. Three defences, because one is never enough.
 *
 * The engine's own sleep is not one of them. A cap that has fallen onto its side
 * and is rocking a hundredth of a unit at a time is above every sleep threshold
 * that is loose enough not to freeze a cap that is genuinely still crawling, and
 * it will happily do that for a minute. Waiting for sleep means waiting.
 *
 *  1. REST — every body under both velocity thresholds for N consecutive steps.
 *     Consecutive matters: a single quiet step happens at the top of every
 *     bounce, and ending the turn there would cut the shot in half.
 *
 *     "Every body" includes the ball, and the ball is judged against its OWN
 *     pair of thresholds rather than the caps'. It has to be: rest is the same
 *     physical state for both, but a sphere of radius 0.7 rolling at the caps'
 *     0.9 cm/s is turning at 1.25 rad/s, twice the caps' angular threshold, so
 *     one threshold pair for both either holds every turn open on a ball that
 *     has effectively stopped or lets the caps end one while still creeping.
 *     `Arena.atRest` owns the comparison; this file owns when to ask.
 *
 *  2. RAMP — from `rampStartSec`, damping climbs toward `rampMaxDamping`. Not a
 *     hard stop but a thumb on the scale: whatever is still creeping gets pulled
 *     down until it trips defence 1 on its own. Because it is damping and not a
 *     velocity clamp, a cap still genuinely travelling at five seconds slows down
 *     and arrives rather than stopping dead where it stands.
 *
 *  3. TIMEOUT — at `hardTimeoutSec`, velocities are zeroed. Blunt, visible, and
 *     never reached in normal play; it exists so that "the turn always ends" is a
 *     guarantee and not a hope.
 *
 * Everything here counts PHYSICS STEPS, never wall-clock seconds. A turn that
 * ran while the tab was throttled, or at 0.1x slow motion, has to end at exactly
 * the same point in the simulation as one that did not, or the replay check is
 * comparing two different turns.
 */

export const SETTLE_REASON = {
  REST: 'rest',
  TIMEOUT: 'timeout',
};

export class TurnSettle {
  /**
   * Takes no config, and that is the change the third mode forced.
   *
   * Every number this reads now comes off `arena.turnConfig`, which is the
   * shared `config.turn` with the loaded mode's overrides applied — see
   * `Layout.turnOverrides`. Holding a second reference to the raw config here
   * would be a second place the thresholds could come from, and the failure it
   * invites is silent: a ramp damping toward a rest threshold it is not being
   * judged against.
   */
  constructor() {
    this.steps = 0;
    this.quiet = 0;
    this.extraDamping = 0;
    this.reason = null;
    this.done = false;
    this.peaks = null;
  }

  begin(arena) {
    this.steps = 0;
    this.quiet = 0;
    this.extraDamping = 0;
    this.reason = null;
    this.done = false;
    this.peaks = null;
    // Clear whatever the last turn's ramp left behind, or the second turn of a
    // match starts with the damping the first one ended on.
    arena.setExtraDamping(0);
  }

  /**
   * Damping for the step about to run. Call immediately before `physics.step()`.
   *
   * ── the numbers come off the ARENA, not off the config ────────────────────
   * `arena.turnConfig` is `config.turn` with the mode's own overrides applied.
   * Every duration here has to be the same one `Arena.atRest` is judging
   * against, and reading them from two places is how a mode ends up with its
   * ramp on one clock and its rest thresholds on another — a turn that damps
   * toward a threshold it will never be tested at. See `Layout.turnOverrides`.
   */
  preStep(arena) {
    const t = arena.turnConfig;
    const rampStart = secondsToSteps(t.rampStartSec);
    const hard = secondsToSteps(t.hardTimeoutSec);

    let extra = 0;
    if (this.steps > rampStart && hard > rampStart) {
      const k = Math.min(1, (this.steps - rampStart) / (hard - rampStart));
      extra = t.rampMaxDamping * Math.pow(k, Math.max(0.1, t.rampCurve));
    }
    // Only written when it actually changes: setLinearDamping wakes nothing but
    // it does cross the WASM boundary once per body, and most steps of most
    // turns are before the ramp starts.
    if (extra !== this.extraDamping) {
      this.extraDamping = extra;
      arena.setExtraDamping(extra);
    }
  }

  /** Read the result of the step. Call immediately after `physics.step()`. */
  postStep(arena) {
    const t = arena.turnConfig;
    this.steps++;

    // Kept for the panel: which kind is still moving is the first thing you want
    // to know when a turn will not end.
    this.peaks = arena.peaks();

    if (arena.atRest()) this.quiet++;
    else this.quiet = 0;

    if (this.quiet >= Math.max(1, Math.round(t.quietSteps))) {
      this.done = true;
      this.reason = SETTLE_REASON.REST;
      arena.setExtraDamping(0);
      return true;
    }

    if (this.steps >= secondsToSteps(t.hardTimeoutSec)) {
      this.done = true;
      this.reason = SETTLE_REASON.TIMEOUT;
      arena.freezeAll();
      arena.setExtraDamping(0);
      return true;
    }

    return false;
  }

  /** Simulated seconds elapsed in this turn. For the HUD only. */
  get seconds() {
    return this.steps / 120;
  }
}

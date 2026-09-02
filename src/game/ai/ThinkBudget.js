/**
 * How much of THIS frame the search may have.
 *
 * ── the fixed 6 ms was a number about a machine, not about a frame ──────────
 * `config.ai.frameBudgetMs` is one constant for every device and every refresh
 * rate, and it is wrong at both ends of that range. Measured on an M3 at 120 Hz,
 * with the game's own work at about 4 ms of an 8.3 ms frame:
 *
 *     budget 6 ms   thinking frames ran 10–25 ms   search got 62% of the clock
 *
 * So on a fast machine the search is throttled to well under what the frame can
 * carry — it takes 3.1 s of wall clock to spend 1.9 s of solver — while on a
 * slow one the same 6 ms is a bigger share of a longer frame than anyone chose.
 * The dial says milliseconds and means "some fraction of a frame I cannot see".
 *
 * ── what a THINKING frame is allowed to cost, and why it is not 8.3 ms ──────
 * The obvious fix is to fill the vsync period, and it is the wrong one: at
 * 120 Hz that leaves 4 ms and the AI gets SLOWER than it is today.
 *
 * The thing worth noticing is what is on screen during `AiController`'s `think`
 * phase. Nothing has been fired, no cap is moving, no card is out; the only
 * animation is the camera easing into the turn's framing. A frame that is idle
 * except for a camera ease can be a good deal longer than one carrying a shot,
 * and the player cannot tell — which is the same argument `stepChunk` makes
 * about spreading solver work, one level up.
 *
 * So the target is a frame LENGTH rather than a slice: stretch a thinking frame
 * out to `thinkFrameMs` and give the search whatever is left after the rest of
 * the frame has taken its share. 17 ms — 60 Hz — is the floor a moving camera
 * still reads smoothly at, and it is deliberately not lower.
 *
 * ── the target has to be a WHOLE NUMBER of refresh intervals ────────────────
 * `requestAnimationFrame` is aligned to vsync, so a frame that misses its
 * deadline by a hair waits for the whole of the next interval. A target that
 * does not land on a multiple of the display's period therefore does not cost a
 * millisecond, it costs an interval — measured in the browser on a 120 Hz panel
 * with a flat 16 ms target: thinking frames came out at 30 ms, the search got
 * 14 ms of each, and the wall clock was worse than the 6 ms slice it replaced.
 *
 * So the period is measured and the target is rounded DOWN to a multiple of it,
 * at least one. 120 Hz takes two intervals and 60 Hz takes one, and both land on
 * the same 16.7 ms frame — which is the point: the thinking frame rate is 60 on
 * either panel rather than "whatever the arithmetic happened to give".
 *
 * ── it cannot change what the AI plays ──────────────────────────────────────
 * The budget decides how many rollouts fit in a frame and nothing else: the
 * candidate list, the order and the count are all fixed by
 * `ai.sampling.maxCandidates`, which is the whole reason that budget is a COUNT
 * — see the header in `AiPlanner.js`. A search that is handed a different number
 * of milliseconds every frame therefore reaches the same answer through a
 * different number of frames, and `npm run det:ai` digests are the proof:
 * 2b19511a / 449d0891, unmoved by this file existing.
 */

/**
 * The measured cost of everything in a frame that is NOT the search.
 *
 * Smoothed, because one expensive frame — a texture upload, a plate cache being
 * rebuilt, the GC — should not starve the search for the next one, and one cheap
 * frame should not let it overrun. An exponential average over about half a
 * second at 60 Hz.
 */
const SMOOTHING = 0.1;

/**
 * Never hand back less than this.
 *
 * A device where the game alone eats the whole target frame would otherwise get
 * a budget of zero and the search would never finish. It falls back to the
 * configured slice and the frame is simply long — a slow phone thinking slowly
 * is the honest outcome, a phone that never decides is not.
 */
const FLOOR_FROM_CONFIG = 1;

/**
 * And never more than this multiple of the configured slice.
 *
 * The clock is only read between chunks of `ai.stepChunk` steps, so the budget
 * is a target the frame overshoots rather than a limit it respects — see
 * `AiPlanner.tick`. A ceiling keeps a frame that has already gone long from
 * being handed the whole target on top of it.
 */
const CEILING_FROM_CONFIG = 4;

/**
 * Held back from the target, ms.
 *
 * The slice is a deadline the stepping honours to within one physics step, and
 * the frame still has `tick`'s own tail — folding the probe stage in, ranking —
 * on the far side of it. Both are small and neither is zero, and on a vsync
 * clock a frame that lands a hair over its interval costs the WHOLE next one. So
 * the target is approached from below with a millisecond in hand rather than hit
 * exactly: 1 ms of a 16.7 ms frame buys back the 8.3 ms a miss would cost.
 */
const MARGIN_MS = 1;

/**
 * How many un-stretched frame intervals the period is read out of.
 *
 * Short, because a display's refresh rate does not drift. It survives a whole
 * turn of thinking, during which nothing is added to it — see `note`.
 */
const PERIOD_WINDOW = 30;

/**
 * Below this much AI work, the frame counts as one the search did not stretch.
 *
 * `controller.update` is called every frame and costs essentially nothing
 * outside the `think` and `replan` phases — a presentation phase is a lerp and
 * a human controller's update is empty — so this separates the two cleanly
 * without the loop having to say which phase it is in.
 */
const IDLE_AI_MS = 0.5;

/** Sane bounds for a refresh interval: 144 Hz at one end, 30 Hz at the other. */
const MIN_PERIOD = 6;
const MAX_PERIOD = 34;

export class ThinkBudget {
  constructor() {
    /** Smoothed ms the frame spends on everything except the search. */
    this.otherMs = 0;
    this._seeded = false;
    /** @type {number[]} recent raw frame intervals, newest last. */
    this._intervals = [];
  }

  /**
   * Report what the frame just cost.
   *
   * @param {number} tickMs    wall time of the whole tick, search included
   * @param {number} aiMs      the part of it the search took
   * @param {number} [frameMs] raw interval since the previous frame, for the
   *   refresh period. Omitted, the period defaults to 60 Hz.
   */
  note(tickMs, aiMs, frameMs) {
    /**
     * The period is read ONLY off frames the search did not touch.
     *
     * ── otherwise it ratchets, and it was measured doing exactly that ────────
     * The whole point of the target is to stretch a thinking frame to a multiple
     * of the refresh interval — so a period learned from thinking frames reads
     * back the stretched value, quantises against it, stretches further, and
     * settles wherever the ceiling stops it. Measured in the browser on a 120 Hz
     * panel: the period was read as 30 ms, the target became 30 ms, the budget
     * pinned to its ceiling and thinking frames ran at 33 fps — worse than the
     * flat slice, which is the failure this class exists to fix.
     *
     * Taking the window's minimum was the first attempt and it is not enough: a
     * search runs for seconds and the window is a fraction of one, so every
     * sample in it is a stretched frame. `aiMs` is the honest discriminator —
     * a frame where the search did no work is a frame at the panel's own rate.
     */
    if (aiMs < IDLE_AI_MS && Number.isFinite(frameMs) && frameMs > 0 && frameMs < 1000) {
      this._intervals.push(frameMs);
      if (this._intervals.length > PERIOD_WINDOW) this._intervals.shift();
    }
    const other = Math.max(0, tickMs - aiMs);
    if (!Number.isFinite(other)) return;
    // The first reading is taken whole: an average seeded at zero would hand the
    // first thinking frame the entire target and spike it.
    if (!this._seeded) {
      this.otherMs = other;
      this._seeded = true;
      return;
    }
    this.otherMs += (other - this.otherMs) * SMOOTHING;
  }

  /**
   * The display's refresh interval, in ms.
   *
   * The MINIMUM of the recent window rather than the mean: only un-stretched
   * frames are in it (see `note`), and of those the shortest is the one nothing
   * at all was holding up — a settling turn or a texture upload lengthens the
   * others and neither is the panel's rate.
   */
  get periodMs() {
    if (!this._intervals.length) return 1000 / 60;
    let min = Infinity;
    for (const v of this._intervals) if (v < min) min = v;
    return Math.min(MAX_PERIOD, Math.max(MIN_PERIOD, min));
  }

  /**
   * Milliseconds of solver the next frame may spend.
   *
   * @param {{frameBudgetMs: number, thinkFrameMs?: number}} tuning
   *   the merged `config.ai` block for the mode being played
   */
  msFor(tuning) {
    const configured = Math.max(0.5, tuning.frameBudgetMs);
    const want = tuning.thinkFrameMs ?? 0;
    // 0 turns the whole thing off and hands back the configured slice, which is
    // exactly what the search saw before this class existed.
    if (!(want > 0)) return configured;
    // Down to a whole number of refresh intervals, at least one — see the header.
    const period = this.periodMs;
    const target = period * Math.max(1, Math.floor(want / period));
    return Math.min(
      configured * CEILING_FROM_CONFIG,
      Math.max(configured * FLOOR_FROM_CONFIG, target - this.otherMs - MARGIN_MS),
    );
  }
}

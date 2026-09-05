import { RAPIER } from '../physics/rapier.js';
import { CapFriction } from '../physics/capFriction.js';
import { applyIntegrationParams, FIXED_DT } from '../physics/PhysicsWorld.js';
import { applyResolved, resolveImpulse } from './shot.js';

/**
 * The trajectory preview: run the shot ahead of time and draw where it goes.
 *
 * Not an approximation. It is the SAME solver on a byte-identical copy of the
 * same world, so the line drawn is the path the cap will take — and that makes
 * the preview a live assertion about determinism. If the cap ever leaves the
 * line, determinism has broken somewhere and the preview is the thing that says
 * so. A hand-rolled ballistic estimate would have hidden exactly that.
 *
 * ── the snapshot is taken once ───────────────────────────────────────────────
 * While the player is aiming the sim is stopped dead, so the world cannot change
 * and one snapshot taken at the start of the turn stays valid for every
 * recomputation until the shot is fired. Restoring from it turns out to be nearly
 * free — 0.14 ms — because a six-body world is a small thing to deserialise.
 *
 * ── the cost is the stepping, and it is spread over frames ───────────────────
 * A second of preview is 120 solver steps at 0.33 ms each: 40 ms, in one frame,
 * on a 16 ms budget. Doing it in one go dropped the frame every aim change landed
 * on, so the drag stuttered during the one interaction whose feel is the entire
 * point. Measuring it was the only way to find it, because a preview that is
 * correct and late looks exactly like a preview that is correct.
 *
 * So the copy is kept alive between frames and stepped `stepBudget` at a time.
 * This changes nothing about the result: the same world takes the same steps in
 * the same order, just spread across a few frames of wall clock.
 *
 * ── the line is published as it grows ────────────────────────────────────────
 * A pull can move the aim on every frame it is dragged, and a slice takes six
 * frames, so a preview will often be abandoned before it finishes. There are two
 * things to draw in that case and the choice matters:
 *
 *   hold the last COMPLETE line  ->  always full length, but it belongs to an aim
 *                                    the player has already moved away from. It
 *                                    visibly trails the cursor.
 *   publish as it computes       ->  short while the hand is moving, but its head
 *                                    is always the aim being held right now.
 *
 * The second, because the brief asks for no perceptible lag and a line that is
 * short is not lagging — it is just short, and it grows out to full length the
 * moment the hand stops, which is exactly when the player is reading it. A line
 * that is confidently full and quietly wrong is the worse failure.
 *
 * `reach` is the one thing that is NOT taken from the growing line: the error
 * cone is drawn to it, and keying it off a length that restarts every frame would
 * make the cone pulse. It updates only on completion.
 *
 * ── the spread IS applied ────────────────────────────────────────────────────
 * The line is the shot that is going to happen, deviation and all — not the shot
 * being aimed. That is a reversal, and it follows from what this line is for.
 *
 * Drawn without the deviation it was the PLAN, which is the honest thing to show
 * a player who is about to commit: the cone next to it says how far off the plan
 * the result may land, and seeing the actual draw in advance would let them aim
 * off to cancel it, which is the same as having no error at all.
 *
 * But the line is not shipping to players — the release will not draw it, and
 * how hard to pull is meant to be learned by feel. What is left is an instrument
 * for development, and an instrument that deliberately reports something other
 * than what will happen is a broken instrument. So the seed is fixed when the
 * drag starts rather than when it ends, the preview draws with it, and the shot
 * fires with the same one. Preview and outcome agree exactly.
 *
 * The cone is still drawn, and now means what it always did — the set of places
 * this shot could have gone — with the line showing which one it took.
 */

/**
 * Quantisation of the aim, so that sub-visible movement does not restart a
 * preview that is already part way computed.
 *
 * Coarser than the pointer can resolve, deliberately. These are the throttle the
 * brief asks for: an aim change finer than these buckets is below the width of
 * the line it would redraw, and honouring it would cost 40 ms of solver to move
 * nothing.
 */
const POWER_BUCKETS = 16;
/** Buckets per radian of aim. ~0.4 degrees. */
const ANGLE_BUCKETS = 150;

export class TrajectoryPreview {
  constructor(config) {
    this.config = config;
    /** Flat xyz triples of the shooting cap's centre of mass. Grows as computed. */
    this.points = [];
    /**
     * Straight-line distance of the last COMPLETED preview. What the error cone
     * is drawn to, so it does not pulse while a new line is being computed.
     */
    this.reach = 0;
    this._key = null;
    this._world = null;
    this._body = null;
    this._steps = 0;
    this._total = 0;
    this._every = 1;
    this._cost = 0;
    this._budgetScale = 1;
  }

  /** True once the whole preview window has been simulated. */
  get complete() {
    return !!this._world && this._steps >= this._total;
  }

  /** Milliseconds of stepping spent on the current preview. */
  get cost() {
    return this._cost;
  }

  clear() {
    this._release();
    this.points = [];
    this.reach = 0;
    this._key = null;
    this._steps = 0;
    this._total = 0;
  }

  _release() {
    // WASM linear memory: nothing in JS can collect this, and a new copy is made
    // every time the aim moves far enough. Leaking here eats a gigabyte inside a
    // minute of dragging.
    this._world?.free();
    this._world = null;
    this._body = null;
    this._friction = null;
  }

  /**
   * @param {Uint8Array|null} snapshot  the world as it stands, frozen for aiming
   * @param {number} [seconds]  override the configured window. The trajectory
   *   card passes its own, per turn — a card cannot write to the config, because
   *   the config is what the panel is holding and the card would leave its value
   *   behind after it expired.
   */
  update({ snapshot, arena, shot, seconds, force = false }) {
    // `force` is the 궤적 card. The config switch is the DEVELOPER's line, off by
    // default because a permanent exact preview is not a game; the card is a
    // player buying one for a single turn, and it must not depend on a debug
    // toggle being left on.
    if ((!this.config.preview.enabled && !force) || !snapshot || !shot) {
      if (this.points.length || this._world) this.clear();
      return this.points;
    }

    const window = Math.max(0.05, seconds ?? this.config.preview.seconds);

    const key = [
      shot.capIndex,
      Math.round(Math.atan2(shot.dirZ, shot.dirX) * ANGLE_BUCKETS),
      Math.round(shot.power * POWER_BUCKETS),
      // The seed steers the shot now, so a new draw is a different trajectory.
      shot.seed,
      // The 강타 multipliers. Neither moves the angle bucket nor the power
      // bucket, so without them the key does not change when the card is played
      // and the line on screen stays the un-boosted trajectory while the boosted
      // shot fires — which, under 궤적, is the entire visible output of both
      // cards disagreeing with each other.
      shot.impulseMul ?? 1,
      shot.spreadMul ?? 1,
      this.config.shot.maxSpreadDeg,
      this.config.shot.spreadCurve,
      Math.round(window * 100),
      this.config.preview.sampleEvery,
    ].join(':');

    if (key !== this._key) {
      this._key = key;
      this._begin({ snapshot, arena, shot, window });
    }
    this._advance();
    return this.points;
  }

  _begin({ snapshot, arena, shot, window }) {
    this._release();

    const world = RAPIER.World.restoreSnapshot(snapshot);
    applyIntegrationParams(world, this.config.physics);

    const body = world.getRigidBody(arena.capBodies[shot.capIndex]);
    if (!body) {
      world.free();
      this.points = [];
      return;
    }

    // WITH the error cone's draw applied. The line is the shot that will happen,
    // deviation included — see the note at the top.
    const r = resolveImpulse(shot, this.config.shot);
    applyResolved(body, r);

    this._world = world;
    this._body = body;
    /**
     * The live world's rule, on this copy's own bookkeeping.
     *
     * The RULE is shared — one `CapFriction` class, one `arena.desc` — because a
     * second implementation of it would disagree with the sim precisely on the
     * shot that turns a cap over, which is the shot worth previewing. The
     * INSTANCE is not, because its cache holds collider wrappers belonging to
     * one world, and handing the arena's own instance a second world would make
     * it rebuild that cache every time the two took turns stepping.
     */
    this._friction = new CapFriction(arena.capBodies, arena.capColliders, arena.desc);
    this._steps = 0;
    this._total = Math.max(1, Math.round(window / FIXED_DT));
    /**
     * How much of the per-frame budget this window needs to grow at the same
     * RATE on screen as the ordinary one.
     *
     * A fixed budget is a fixed number of steps per frame, so a window three and
     * a half times longer takes three and a half times as many FRAMES to reach
     * full length — and the line restarts every time the aim crosses a bucket.
     * Measured: 6 frames at 1 s, 21 frames at 3.5 s. Nobody holds an aim
     * perfectly still for 21 frames while dragging, so the long line never
     * finished and the trajectory card looked like it did nothing at all.
     *
     * Scaling the budget with the window puts it back at 6 frames, at 6.7 ms of
     * solver a frame against the short one's 4.0 — still inside the frame.
     */
    this._budgetScale = Math.max(1, window / Math.max(0.05, this.config.preview.seconds));
    // The card's line must grow at a usable rate even when the ordinary preview
    // is switched off and `stepBudget` is whatever was last left on the panel.
    this._minBudget = Math.ceil(this._total / 8);
    this._every = Math.max(1, Math.round(this.config.preview.sampleEvery));
    this._cost = 0;

    const c = body.worldCom();
    this.points = [c.x, c.y, c.z];
  }

  /** Step as far as this frame's budget allows. */
  _advance() {
    if (!this._world || this._steps >= this._total) return;
    const budget = Math.max(
      this._minBudget ?? 1,
      Math.round(this.config.preview.stepBudget * (this._budgetScale ?? 1)),
    );
    const end = Math.min(this._total, this._steps + budget);

    const t0 = performance.now();
    while (this._steps < end) {
      this._friction?.sync(this._world);
      this._world.step();
      this._steps++;
      if (this._steps % this._every === 0 || this._steps === this._total) {
        const c = this._body.worldCom();
        this.points.push(c.x, c.y, c.z);
      }
    }
    this._cost += performance.now() - t0;

    if (this._steps >= this._total) {
      const n = this.points.length / 3;
      const dx = this.points[(n - 1) * 3] - this.points[0];
      const dz = this.points[(n - 1) * 3 + 2] - this.points[2];
      this.reach = Math.hypot(dx, dz);
    }
  }
}

/**
 * The whole preview in one call, for verification rather than for drawing.
 *
 * Shares `TrajectoryPreview`'s machinery rather than reimplementing the stepping
 * loop: a second copy of "restore, resolve, apply, step, sample" would be a
 * second thing that can quietly disagree with the sim, which is the one failure
 * this module exists to make impossible.
 *
 * @returns {number[]} flat xyz triples of the shooting cap's centre of mass
 */
export function predictTrajectory({ snapshot, arena, shot, config }) {
  const p = new TrajectoryPreview({
    ...config,
    // No budget: run it to completion in this call.
    preview: { ...config.preview, enabled: true, stepBudget: Number.MAX_SAFE_INTEGER },
  });
  try {
    p.update({ snapshot, arena, shot });
    return p.points.slice();
  } finally {
    p.clear();
  }
}

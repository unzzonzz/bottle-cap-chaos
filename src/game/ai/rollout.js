import { RAPIER } from '../../physics/rapier.js';
import { applyIntegrationParams } from '../../physics/PhysicsWorld.js';
import { BODY_KIND, ballInSensor, capsInSensor, secondsToSteps } from '../Arena.js';
import { TurnSettle } from '../TurnSettle.js';
import { nearestCapWithin } from '../Orbs.js';
import { applyResolved, resolveImpulse } from '../shot.js';

/**
 * A whole turn, played out on a throwaway copy of the world.
 *
 * ── this is `predict.js` widened, not a second predictor ─────────────────────
 * The trajectory preview already restores a snapshot into its own `RAPIER.World`,
 * configures it with `applyIntegrationParams`, resolves the shot through
 * `resolveImpulse`, and steps. All of that is correct and none of it is
 * reimplemented here. The one thing the preview cannot do is READ the result:
 * it samples the shooting cap's centre of mass and nothing else, because a line
 * on the board is all it was ever for.
 *
 * An AI needs the other five caps, whether any of them fell, and which orbs got
 * touched on the way. So this is the same machinery with the readout opened up,
 * and it runs to the turn's real end rather than to a fixed window.
 *
 * ── it is exact, and that is the whole reason the AI can work ────────────────
 * Measured against a live turn from the same snapshot with the same shot record:
 *
 *     live turn : 122 steps, target cap ends at z 47.229866
 *     rollout   : 122 steps, target cap ends at z 47.229866
 *
 * Identical step count, identical position to the last digit printed. The
 * evaluator is therefore not scoring an approximation of what would happen — it
 * is scoring what WILL happen, and a shot the search believes drops a cap is a
 * shot that drops it.
 *
 * ── and the BALL readout was measured the same way ──────────────────────────
 * The cap positions were the whole of the readout when the above was written.
 * Football needs the ball, a goal verdict and a crossing point, and every one of
 * those is a new opportunity to disagree with the live turn — so the same test
 * was run against `FootballRules`, from the football fixture's opening position
 * and from a position six turns in with the ball on the goal line:
 *
 *     shots compared      steps   ball x/y/z   goal latch   crossing point
 *     3 in play             ==        ==           ==            ==
 *     3 out over a line     ==        ==           ==            ==
 *     4 into a net          ==        ==           ==            ==
 *
 * Ten for ten, exact. Two of those are worth naming because they are the cases
 * a coordinate test would get wrong: a full-power clearance that crossed at
 * 284 steps and rolled on to rest 11 units past where it crossed, and an own
 * goal at 410 steps whose ball settled at z −33.101273 in both runs.
 *
 * The goal figure is a latch and not a position, so it agrees with the live
 * `resolveTurn` even when the ball comes back out — see `_observeBall`.
 *
 * One number from that sweep is worth carrying into the evaluator's design: of
 * 1152 shots fanned from the KICKOFF position, exactly zero scored. A goal is
 * not something a football search finds by looking one flick ahead, which is why
 * `footballEvaluate` cannot be built on `goal` alone.
 *
 * That property is worth more than any amount of aiming precision, and it is
 * bought entirely by not writing a second physics path. Every function this
 * calls is the one the real turn calls.
 *
 * ── it cannot touch the live world ──────────────────────────────────────────
 * `RAPIER.World.restoreSnapshot` builds a NEW world out of the bytes; nothing
 * here ever reaches for `physics.world`. Verified by hashing the live world
 * either side of a few hundred rollouts — `9eed1673` both times.
 *
 * The one thing that MUST be got right is `free()`. This is WASM linear memory
 * that no JS collector can see, and the search runs dozens of these per turn.
 * Every path out of `run` frees, including the throwing one.
 *
 * ── the turn ENDS the way a real turn ends ──────────────────────────────────
 * `TurnSettle` is used unmodified, driven through a duck-typed arena over the
 * copy. Reimplementing "everything has stopped" would be a second answer to the
 * question that decides how long a turn is, and the two would drift — a shot
 * scored on a world that had not finished moving is a shot scored somewhere the
 * cap is not going to be.
 */

/**
 * The slice of `Arena` that `TurnSettle` actually uses, over a copied world.
 *
 * Duck-typed rather than a second `Arena`, because building an `Arena` means
 * building BODIES — and the bodies already exist in the snapshot. What is left
 * is five methods and a getter, all of which are pure reads or per-body writes
 * over a handle list, and the handle list comes straight off the live arena's
 * public fields. Handles survive `restoreSnapshot` (that is the whole reason
 * `PhysicsWorld` traffics in handles rather than body objects), so cap 3 in the
 * copy is cap 3 in the original.
 *
 * The body order matches `Arena._bodies` exactly — caps first, ball last — which
 * is not needed for correctness here but keeps the two readable side by side.
 *
 * ── explicitly NOT `Object.create(arena)` with the world swapped ────────────
 * That is the shorter way to get a shadow arena and it fails open. A prototype
 * copy inherits `_prev`/`_curr` — the interpolation buffers the RENDERER reads —
 * so one stray `syncTransforms` in a rollout writes the live frame's transforms
 * out of a world the player is not looking at, and the caps jump. It also
 * inherits `settle()`, `placeCap()`, `stowCap()` and `rebuild()`, every one of
 * which would appear to work while quietly operating on the copy.
 *
 * Listing the five methods `TurnSettle` needs means anything else a rollout
 * reaches for is a `TypeError` on the first run rather than a rendering fault
 * three weeks later. The surface is small because the surface should be small.
 */
class RolloutArena {
  /**
   * @param {import('@dimforge/rapier3d-compat').World} world
   * @param {import('../Arena.js').Arena} live  read for its shape, never touched
   */
  constructor(world, live) {
    this.world = world;
    this.live = live;
    this.config = live.config;

    /** @type {{handle: number, kind: string}[]} */
    this.bodies = [];
    for (const handle of live.capBodies) this.bodies.push({ handle, kind: BODY_KIND.CAP });
    if (live.hasBall) this.bodies.push({ handle: live.ballBody, kind: BODY_KIND.BALL });

    /**
     * Handle -> body, exactly as `PhysicsWorld.body` caches for the live world.
     *
     * `getRigidBody` is not a field read: it builds a JS wrapper around a WASM
     * pointer on every call, and this class asks for one per body per reading —
     * `peaks`, `capCom`, `ballCom`, `setExtraDamping` — every step of every
     * rollout. The live arena has always cached; this one was the copy of that
     * code that did not.
     *
     * Safe for exactly as long as the world is: `restoreSnapshot` builds the
     * world once in the `Rollout` constructor and nothing adds or removes a body
     * afterwards, so a handle resolves to the same body for this object's whole
     * life. It dies with the world in `free()`.
     */
    this._cache = new Map();
  }

  /** The mode's turn clock, straight off the live arena. One set of numbers. */
  get turnConfig() {
    return this.live.turnConfig;
  }

  _body(handle) {
    let b = this._cache.get(handle);
    if (b === undefined) {
      b = this.world.getRigidBody(handle);
      this._cache.set(handle, b);
    }
    return b;
  }

  peaks() {
    const out = {
      [BODY_KIND.CAP]: { lin: 0, ang: 0 },
      [BODY_KIND.BALL]: { lin: 0, ang: 0 },
    };
    for (const rec of this.bodies) {
      const b = this._body(rec.handle);
      if (!b) continue;
      const v = b.linvel();
      const w = b.angvel();
      const slot = out[rec.kind];
      slot.lin = Math.max(slot.lin, Math.hypot(v.x, v.y, v.z));
      slot.ang = Math.max(slot.ang, Math.hypot(w.x, w.y, w.z));
    }
    return out;
  }

  /** @param {ReturnType<RolloutArena['peaks']>} [peaks]  see `Arena.atRest`. */
  atRest(peaks = this.peaks()) {
    const rest = this.turnConfig.rest;
    for (const kind of Object.keys(peaks)) {
      const t = rest[kind] ?? rest[BODY_KIND.CAP];
      if (peaks[kind].lin >= t.linear || peaks[kind].ang >= t.angular) return false;
    }
    return true;
  }

  _baseDamping(kind) {
    return kind === BODY_KIND.BALL
      ? { lin: this.config.ball.linearDamping, ang: this.config.ball.angularDamping }
      : { lin: this.config.physics.linearDamping, ang: this.config.physics.angularDamping };
  }

  setExtraDamping(extra) {
    for (const rec of this.bodies) {
      const base = this._baseDamping(rec.kind);
      const b = this._body(rec.handle);
      if (!b) continue;
      b.setLinearDamping(base.lin + extra);
      b.setAngularDamping(base.ang + extra);
    }
  }

  freezeAll() {
    const zero = { x: 0, y: 0, z: 0 };
    for (const rec of this.bodies) {
      const b = this._body(rec.handle);
      if (!b) continue;
      b.setLinvel(zero, false);
      b.setAngvel(zero, false);
      b.sleep();
    }
  }

  capCom(index) {
    return this._body(this.live.capBodies[index]).worldCom();
  }

  /**
   * The ball, in the copy. `Arena.ballCom` with the world swapped.
   *
   * It exists so the LAYOUT's own predicates can be asked of a rollout:
   * `FootballPitch.ballIsOut(arena)` reads nothing but `arena.ballCom()`, so
   * handing it this object answers "is the ball out" about the fork instead of
   * about the board the player is looking at. That is the same trick
   * `TurnSettle` is driven by, and it is why there is no second copy of the out
   * rule anywhere in the search.
   */
  ballCom() {
    if (!this.live.hasBall) return null;
    const b = this._body(this.live.ballBody);
    return b ? b.worldCom() : null;
  }
}

/**
 * Play one candidate shot out to the end of its turn.
 *
 * ── the orb touches are watched DURING the steps, not after ─────────────────
 * Because that is when they happen. `Orbs.step` runs the pickup test inside the
 * physics loop precisely so a card arrives the instant a cap arrives, and a cap
 * can roll over an orb and carry on — so a position check at rest would miss
 * every pickup that was not also a stopping place. The AI has to see the same
 * events the real turn would fire or it cannot value them.
 *
 * Nothing is drawn from the card deck here and no hand is touched: this records
 * WHO WOULD TOUCH WHAT, which is all the evaluator needs. Drawing would consume
 * the orb RNG, and that stream belongs to the turn that actually happens.
 *
 * @param {object} opts
 * @param {Uint8Array} opts.snapshot   the turn's snapshot, from `Match`
 * @param {import('../Arena.js').Arena} opts.arena
 * @param {{id: number, x: number, z: number}[]} opts.orbs  live orb list
 * @param {import('../shot.js').Shot} opts.shot
 * @param {typeof import('../config.js').CONFIG} opts.config
 * @param {number} [opts.maxSteps]  hard ceiling on top of the turn's own timeout
 * @returns {{
 *   steps: number, reason: string|null, out: boolean[],
 *   pos: {x: number, y: number, z: number}[],
 *   orbTouched: {id: number, player: number}[],
 * }}
 */
export class Rollout {
  /**
   * @param {boolean} [keepSnapshot]
   *   Take a snapshot of the settled world before freeing it, so a reply search
   *   can plan the opponent's answer from the position this shot produces. Off
   *   by default: it is ~90 kB and only the handful of candidates that reach the
   *   second ply need one.
   */
  constructor({
    snapshot,
    arena,
    orbs,
    shot,
    config,
    maxSteps = Infinity,
    samplePath = 0,
    keepSnapshot = false,
  }) {
    this.arena = arena;
    this.config = config;
    this.shot = shot;
    this.keepSnapshot = keepSnapshot;
    this.steps = 0;
    this.done = false;
    this.result = null;

    this.world = RAPIER.World.restoreSnapshot(snapshot);
    applyIntegrationParams(this.world, config.physics);

    const body = this.world.getRigidBody(arena.capBodies[shot.capIndex]);
    if (!body) {
      this.result = {
        steps: 0, reason: null, out: [], pos: [], orbTouched: [], path: null,
        // Same shape as the real one: a reader that has to check whether the
        // ball fields exist is a reader that will forget to.
        ball: null, goalConceded: -1, ballOut: null,
      };
      this.done = true;
      this.free();
      return;
    }
    // The SAME resolve the real shot uses, error cone and 강타 multipliers
    // included. A candidate scored without the draw would be scoring a shot the
    // game is not going to fire.
    applyResolved(body, resolveImpulse(shot, config.shot));

    this.ra = new RolloutArena(this.world, arena);
    this.settle = new TurnSettle();
    this.settle.begin(this.ra);

    /**
     * Orbs still on the field, and who has already reached one.
     *
     * A local copy: an orb is consumed by the first cap to touch it and must not
     * go on paying out for the rest of the rollout, exactly as `Orbs.step`
     * splices it from the live list. The live list is never written to.
     */
    this.pending = (orbs ?? []).map((o) => ({ id: o.id, x: o.x, z: o.z }));
    this.orbTouched = [];
    const reach = config.orbs.sensorRadius + arena.desc.radius;
    this.r2 = reach * reach;

    /**
     * The shooter's path, only when somebody is going to draw it.
     *
     * Off by default and gated on the panel's switch rather than always
     * collected, because there are dozens of these per turn and the array is
     * pure debugging weight — the evaluator scores the END of a shot and has no
     * use for the middle of it. Same sampling idea as `preview.sampleEvery`.
     */
    this.path = samplePath > 0 ? [] : null;
    this.every = Math.max(1, Math.round(samplePath));
    if (this.path) this._sample();

    /**
     * ── the ball readout, and it is gated on `hasBall` rather than on a mode ──
     * `RolloutArena` already SIMULATES the ball — it is in `bodies`, it takes
     * the ball's own damping, and `atRest` waits for it. What was missing was
     * only the reading. So this adds no physics and changes none: on a layout
     * with no ball every field below stays null and `_observeBall` is never
     * called, which is why knockout's digest cannot move.
     *
     * `arena.hasBall` and not `mode.id === 'football'` deliberately. Curling has
     * no ball today and a fourth mode that has one gets this for nothing; a mode
     * check here would be a second place to remember.
     */
    this.hasBall = !!arena.hasBall;
    /** Both goals' sensor handles, by the player who DEFENDS each. */
    this.goalSensors = this.hasBall ? [0, 1].map((p) => arena.layout.goalSensorOf?.(p) ?? -1) : null;
    /**
     * Latched in flight, exactly as `FootballRules._latched` is, and for the
     * reason given there: the Law is "has crossed", not "is across at the end".
     * A ball that enters the net, has the bounce killed, and trickles back out
     * has scored — measured live at two of eight shots — and a search that only
     * looked at the settled position would score those as corners and refuse the
     * shot that produced them.
     *
     * The player who CONCEDED, matching `pendingGoal().conceded`. -1 is no goal.
     */
    this.goalLatched = -1;
    /** Where the ball crossed the lines, from `FootballPitch.crossing`. */
    this.ballExit = null;
    /** The last sample with the ball inside: the other end of that segment. */
    this.ballInsideLast = null;

    this.ceiling = Math.min(maxSteps, secondsToSteps(arena.turnConfig.hardTimeoutSec));
  }

  _sample() {
    const c = this.ra.capCom(this.shot.capIndex);
    this.path.push(c.x, c.y, c.z);
  }

  /**
   * `FootballRules.observe()`, asked of the copy.
   *
   * ── the live rules object MUST NOT be called from here ────────────────────
   * `observe()` is a method on a STATEFUL object: it writes `_latched`,
   * `_exit` and `_inside`, and those three belong to the turn the player is
   * actually taking. A search that called it would leave a goal latched from a
   * hypothetical shot and the real turn would score it.
   *
   * So the state is duplicated and the JUDGEMENT is not. Every question below is
   * put to the same code the live turn puts it to — `ballInSensor` against the
   * same goal sensors, `layout.ballIsOut` and `layout.crossing` against the same
   * metrics — with `this.ra` standing in for the arena. If the two ever
   * disagreed about what a goal is, the AI would search for goals that the game
   * does not award, which is the one failure that makes the rest of this
   * worthless.
   *
   * The ORDER matches `Match._watchForGoal` -> `FootballRules.observe` exactly:
   * exit tracking first, then the goal latch, both after the step and before
   * `TurnSettle.postStep`. See the call site in `advance`.
   */
  _observeBall() {
    this._trackExit();
    if (this.goalLatched >= 0) return;
    for (let player = 0; player < 2; player++) {
      const sensor = this.goalSensors[player];
      if (sensor >= 0 && ballInSensor(this.world, this.arena.ballCollider, sensor)) {
        this.goalLatched = player;
        return;
      }
    }
  }

  /** `FootballRules._trackExit`, over the copy. Records a crossing; judges nothing. */
  _trackExit() {
    const layout = this.arena.layout;
    if (!layout.ballIsOut) return;
    const b = this.ra.ballCom();
    if (!b) return;
    const here = { x: b.x, z: b.z };

    if (!layout.ballIsOut(this.ra)) {
      this.ballInsideLast = here;
      // Back between the lines: whatever it did on the way out did not put it
      // out, and the next crossing is the one that counts.
      this.ballExit = null;
      return;
    }
    if (this.ballExit) return;
    this.ballExit = layout.crossing?.(this.ballInsideLast ?? here, here) ?? null;
  }

  /**
   * Step at most `budget` times. Returns true once the turn has resolved.
   *
   * ── the slicing is the whole reason this is a class ────────────────────────
   * A rollout is about 95 steps and cost 10.2 ms measured in the browser, which
   * is most of a 60 Hz frame on its own. Run atomically — which is how this
   * started — a search doing one per frame put 14 frames out of 122 over 16.7 ms
   * and peaked at 23.7 ms, and that is before a mobile webview multiplies it. So
   * "후보 평가를 여러 프레임에 분산" cannot stop at one candidate per frame; the
   * candidate itself has to be divisible.
   *
   * Which `TrajectoryPreview` already established is safe: the copy is kept
   * alive between frames and stepped a few at a time, and "This changes nothing
   * about the result: the same world takes the same steps in the same order,
   * just spread across a few frames of wall clock." The same argument holds
   * here, and it is what keeps the search's answer independent of frame timing.
   */
  advance(budget, deadline = 0) {
    if (this.done) return true;
    const end = Math.min(this.ceiling, this.steps + Math.max(1, budget));
    /**
     * Steps between clock readings when a deadline is given.
     *
     * ── the frame budget is only honest if the OVERSHOOT is bounded too ─────
     * `AiPlanner` used to check the clock only between chunks, so a slice always
     * ran one chunk past its budget — and a chunk is not small when the cap is
     * still travelling: 8 steps measured 5.3 ms against a 12 ms slice. That is
     * not a rounding error, because `requestAnimationFrame` is aligned to vsync
     * and a frame that misses its deadline waits for the whole of the next
     * interval. Measured on a 120 Hz panel: thinking frames aimed at 16.7 ms
     * came out at 30.
     *
     * So the deadline is checked in here, where the steps are. The objection to
     * doing it per step was that the measurement would cost a noticeable
     * fraction of the thing measured — true of a cheap step, and these are not:
     * a knockout step costs 95 us at rest and 670 us at launch against about
     * 25 ns for `performance.now()`, which is 0.03% of the cheapest of them. So
     * it is read every step and the overshoot is bounded by ONE step rather than
     * by a chunk — the difference between landing a frame at 16.7 ms and landing
     * it at 19, which on a vsync clock is the difference between 16.7 and 25.
     *
     * It changes nothing about the answer. The same world takes the same steps
     * in the same order; only the frame they land in moves — which is the same
     * argument the chunking itself rests on, and `npm run det:ai` is what checks
     * it: 2b19511a / 449d0891, unmoved.
     */
    while (this.steps < end) {
      if (deadline && performance.now() >= deadline) return false;
      this.settle.preStep(this.ra);
      this.world.step();
      this.steps++;

      if (this.path && this.steps % this.every === 0) this._sample();

      if (this.pending.length) {
        const comOf = (i) => this.ra.capCom(i);
        for (let i = this.pending.length - 1; i >= 0; i--) {
          const toucher = nearestCapWithin(comOf, this.arena.capCount, this.pending[i], this.r2);
          if (toucher < 0) continue;
          this.orbTouched.push({ id: this.pending[i].id, player: this.arena.capOwner[toucher] });
          this.pending.splice(i, 1);
        }
      }

      /**
       * Watched DURING the steps, for the same reason the orbs above are: a
       * goal and a crossing are both facts about a MOMENT, and by the time the
       * turn is judged that moment has gone and the ball is elsewhere. `Match`
       * puts `rules.observe()` in precisely this slot — after the step, after
       * the orb pickup, before `postStep` — so this is the same sequence and not
       * merely the same tests.
       */
      if (this.hasBall) this._observeBall();

      if (this.settle.postStep(this.ra)) return this._finish();
    }

    if (this.steps >= this.ceiling) return this._finish();
    return false;
  }

  _finish() {
    const arena = this.arena;
    const out = capsInSensor(this.world, arena.capColliders, arena.sensors?.pit ?? -1);
    const pos = [];
    for (let i = 0; i < arena.capCount; i++) {
      const c = this.ra.capCom(i);
      pos.push({ x: c.x, y: c.y, z: c.z });
    }
    if (this.path) this._sample();

    this.result = {
      steps: this.steps,
      reason: this.settle.reason,
      out,
      pos,
      orbTouched: this.orbTouched,
      path: this.path,
      /** Where the ball settled, or null on a layout without one. */
      ball: this.hasBall ? { ...this.ra.ballCom() } : null,
      /**
       * Which player's net it went into, latched in flight. -1 is no goal.
       *
       * The same number `FootballRules.resolveTurn` reads off its own latch, so
       * the scorer is `1 - goalConceded` and an own goal is the case where that
       * is not the shooter. The evaluator prices those two separately — see
       * `footballEvaluate` — which is why this is a player index rather than a
       * boolean.
       */
      goalConceded: this.hasBall ? this.goalLatched : -1,
      /**
       * Where it crossed the lines, or null for a ball still in play.
       *
       * The CROSSING, not the resting place: `FootballPitch.crossing` explains
       * why they are routinely metres apart, and the restart is taken from this
       * one. `{x, z, overGoalLine}`, ready for `findRespawn`.
       */
      ballOut: this.hasBall ? this.ballExit : null,
      /**
       * The settled world, for a reply search to plan from.
       *
       * Taken here rather than reconstructed from `pos`, because a position is
       * not a world: the caps are asleep in particular poses with particular
       * contact manifolds, and `Match._beginAim` is emphatic that a world
       * rebuilt from coordinates answers the same impulse differently from the
       * one that settled into them. The opponent's reply has to be planned
       * against the board that will actually exist.
       */
      snapshot: this.keepSnapshot ? this.world.takeSnapshot() : null,
    };
    this.done = true;
    this.free();
    return true;
  }

  /**
   * Release the copy. Idempotent, and it MUST be called on every path out.
   *
   * WASM linear memory: nothing in JS can collect it, and a search runs dozens
   * of these a turn. `TrajectoryPreview` records that leaking here eats a
   * gigabyte inside a minute of dragging — a rollout that is abandoned mid-flight
   * because the turn was cancelled is exactly that leak, which is why
   * `AiPlanner.cancel` frees the one in progress.
   */
  free() {
    this.world?.free();
    this.world = null;
    this.ra = null;
  }
}

/**
 * The whole rollout in one call. For verification and for tests, not for frames.
 *
 * Shares `Rollout`'s machinery rather than reimplementing the loop, exactly as
 * `predictTrajectory` shares `TrajectoryPreview`'s and for the reason stated
 * there: a second copy of "restore, resolve, step, judge" is a second thing that
 * can quietly disagree with the sim.
 */
export function rollShot(opts) {
  const r = new Rollout(opts);
  while (!r.advance(Number.MAX_SAFE_INTEGER));
  return r.result;
}

import { RAPIER } from '../../physics/rapier.js';
import { secondsToSteps } from '../Arena.js';

/**
 * The two teams trading places.
 *
 * ── it is a 1:1 exchange, by index ──────────────────────────────────────────
 * Cap `i` of team 0 goes exactly where cap `i` of team 1 was, and back. Keeper
 * for keeper, winger for winger — `formations.js` builds both teams from the
 * same list, so the index carries the role and nothing here has to know what a
 * keeper is.
 *
 * That the exchange is a permutation of the SAME set of positions is what makes
 * the overlap question answerable rather than hopeful: the set of occupied
 * points afterwards is the set that was occupied before, so if nothing was
 * overlapping at the start nothing is overlapping at the end. `overlap()` checks
 * it anyway, because "should be impossible" and "is" are different claims.
 *
 * ── kinematic, and FILTERED OUT, for the crossing ───────────────────────────
 * Two changes. KINEMATIC so the pose is commanded rather than solved for, and
 * gravity and contacts have no say in where a cap ends up. And the colliders'
 * collision groups are zeroed for the duration, so they interact with nothing —
 * eight kinematic bodies crossing each other in the middle of the pitch would
 * otherwise be eight infinitely heavy objects meeting head-on, and the ball is
 * sitting right where they meet.
 *
 * ── two wrong ways to switch a collider off, both measured ──────────────────
 * `setSensor(true/false)` was the first. A collider switched to a sensor and
 * back, while its body also went kinematic and back, comes out of the narrow
 * phase altogether — same `isSensor()`, same groups, same enabled flag, and
 * ZERO contact pairs where an untouched cap has 103. The cap then falls through
 * the pitch: "most of the caps vanish when you swap mid-match".
 *
 * `setEnabled(false/true)` was the second, and it is worse because it looks
 * fine. A disabled collider contributes no mass to its parent, so disabling all
 * eleven of a cap's parts sets the BODY's mass to zero — and re-enabling them
 * does not always bring it back. Measured after a second swap: masses came back
 * `0, 2.2, 0, 0, 0, 0, 0, 2.2`. A zero-mass body has infinite inertia, so
 * `applyImpulse` does nothing at all to it and the cap simply cannot be shot
 * again. That is "스왑하면 캐릭터가 아예 안움직인다", and it took two swaps to
 * appear, which is why it read as "어느 정도 턴이 지나고".
 *
 * Collision groups touch neither the broad phase nor the mass. `finish` checks
 * the masses anyway and says so if one is ever wrong again — the failure is
 * silent and total, and it cost two rounds of looking in the wrong place.
 *
 * ── counted in physics steps ────────────────────────────────────────────────
 * Not in frame time. The world is stepped while this runs, so how many steps it
 * takes is part of the state the next turn is snapshotted from; driving it off
 * the display would make the next turn depend on the frame rate. Same argument
 * as `BallRespawn`, and the same solution.
 */

/**
 * Rapier's collision groups: upper 16 bits are membership, lower 16 the filter.
 * All ones is the default — everything meets everything. Zero is a member of no
 * group that filters for no group, so the collider meets nothing at all.
 */
const ALL_GROUPS = 0xffffffff;
const NO_GROUPS = 0x00000000;

/** Ease-in-out. Leaves gently, arrives gently, quick in the middle. */
function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class CapSwap {
  constructor(config) {
    this.config = config;
    this.active = false;
    this.done = true;
    this.steps = 0;
    this.total = 0;
    /** @type {Array<{a: number, b: number, from: object, to: object}>} */
    this.moves = [];
  }

  /** How far through, 0..1. The renderer draws off this. */
  get progress() {
    return this.total > 0 ? Math.min(1, this.steps / this.total) : 1;
  }

  /**
   * Index pairs that trade places: team 0's nth cap with team 1's nth.
   *
   * Built from `capOwner` rather than assumed to be `i` and `i + 4`, so a
   * formation with a different cap count still pairs up — and an odd number of
   * caps on one side simply leaves the extras alone instead of swapping a cap
   * with nothing.
   *
   * ── caps that are out do not take part ──────────────────────────────────
   * Knockout does not delete an eliminated cap, it marks it dead and leaves the
   * body where it fell — thirty units down, on the catch floor. Pairing against
   * that list would send a LIVE cap down there to take its place, where it would
   * be off the board, invisible and out. So the pairing is over the caps still
   * in play, and the dead ones stay exactly where they are.
   *
   * @param {import('../Arena.js').Arena} arena
   * @param {boolean[]} [alive]  from the rule set. Absent means all of them.
   */
  static pairs(arena, alive) {
    const of = [[], []];
    for (let i = 0; i < arena.capCount; i++) {
      if (alive && !alive[i]) continue;
      of[arena.capOwner[i] % 2].push(i);
    }
    const n = Math.min(of[0].length, of[1].length);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ a: of[0][i], b: of[1][i] });
    return out;
  }

  /**
   * @param {import('../Arena.js').Arena} arena
   * @param {boolean[]} [alive]
   */
  begin(arena, alive) {
    this.moves = [];
    for (const { a, b } of CapSwap.pairs(arena, alive)) {
      const ba = arena.physics.body(arena.capBodies[a]);
      const bb = arena.physics.body(arena.capBodies[b]);
      const ta = { ...ba.translation() };
      const tb = { ...bb.translation() };
      // Rotation is NOT exchanged. A cap keeps its own facing; only where it
      // stands changes. Swapping the quaternions as well would flip a cap that
      // happened to be lying face down onto its front at the far end, which
      // reads as two different caps rather than as one that moved.
      this.moves.push({ index: a, from: ta, to: tb }, { index: b, from: tb, to: ta });
    }

    this.total = Math.max(1, secondsToSteps(this.config.cards.swapSeconds));
    this.steps = 0;
    this.active = true;
    this.done = false;

    for (const m of this.moves) {
      const body = arena.physics.body(arena.capBodies[m.index]);
      body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      for (const h of arena.capColliders[m.index]) {
        arena.physics.collider(h).setCollisionGroups(NO_GROUPS);
      }
    }
  }

  /** Command the next step's pose. Call immediately before `physics.step()`. */
  advance(arena) {
    if (!this.active || this.done) return;
    this.steps++;
    const k = ease(Math.min(1, this.steps / this.total));
    const lift = Math.max(0, this.config.cards.swapArcHeight);
    // A low arc, so the two halves of the exchange are visibly two paths rather
    // than one line with caps sliding both ways along it. Peaks at the midpoint.
    const arc = Math.sin(Math.PI * k) * lift;

    for (const m of this.moves) {
      const body = arena.physics.body(arena.capBodies[m.index]);
      body.setNextKinematicTranslation({
        x: m.from.x + (m.to.x - m.from.x) * k,
        y: m.from.y + (m.to.y - m.from.y) * k + arc,
        z: m.from.z + (m.to.z - m.from.z) * k,
      });
    }

    if (this.steps >= this.total) this.done = true;
  }

  /** Back to caps. */
  finish(arena) {
    if (!this.active) return;
    for (const m of this.moves) {
      const body = arena.physics.body(arena.capBodies[m.index]);
      for (const h of arena.capColliders[m.index]) {
        arena.physics.collider(h).setCollisionGroups(ALL_GROUPS);
      }
      // Landed exactly on the mark before the body type changes back, so the
      // dynamic body starts from the commanded pose rather than from wherever
      // the last kinematic substep left it.
      body.setTranslation(m.to, false);
      body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.active = false;
    this.done = true;

    /**
     * A cap that comes out of this weighing nothing cannot be shot again, ever,
     * and nothing else in the game would notice: no error, no warning, just a
     * cap that ignores every impulse. It has happened once — see the header —
     * so it is checked rather than assumed.
     */
    for (const m of this.moves) {
      const mass = arena.physics.body(arena.capBodies[m.index]).mass();
      if (mass > 0) continue;
      console.error(
        `[swap] cap ${m.index} came back with zero mass — it will not respond to a shot`,
      );
    }
  }

  /**
   * Any two caps closer than they can physically be, after the exchange.
   *
   * Not expected to find anything — see the header — and worth asking anyway,
   * because the alternative to asking is a pair of caps quietly resolving a
   * quarter-unit of overlap into a shove that looks like the swap kicked them.
   *
   * @returns {Array<{a: number, b: number, gap: number}>}
   */
  static overlap(arena, alive) {
    const r = arena.desc.radius;
    const out = [];
    for (let i = 0; i < arena.capCount; i++) {
      if (alive && !alive[i]) continue;
      const ci = arena.capCom(i);
      for (let j = i + 1; j < arena.capCount; j++) {
        if (alive && !alive[j]) continue;
        const cj = arena.capCom(j);
        // Board-plane only, and dead caps skipped above — a cap on the catch
        // floor is directly under the board and would otherwise report an
        // overlap with whatever is standing over it.
        const d = Math.hypot(ci.x - cj.x, ci.z - cj.z);
        if (d < r * 2) out.push({ a: i, b: j, gap: d - r * 2 });
      }
    }
    return out;
  }
}

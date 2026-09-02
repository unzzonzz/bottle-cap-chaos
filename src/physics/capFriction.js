import { RAPIER } from './rapier.js';

/**
 * A cap on its back slides. Which friction is in force, every step.
 *
 * ── why this cannot live in the collider description ─────────────────────────
 * `capCollider.js` describes a cap once, at build time, and everything in it is
 * a fact about the shape. Which face is DOWN is not: it is a fact about the
 * pose, it changes inside a turn, and the whole point of the feature is that it
 * changes at the moment the cap goes over. So it is written onto the colliders
 * as the world runs, and this file is the only thing that writes it.
 *
 * ── a pure function of the pose, and it has to stay one ──────────────────────
 * `frictionFor` reads the rotation and nothing else. No hysteresis band, no
 * memory of which way the cap was last time, no step counter.
 *
 * That restraint is the whole reason this is safe. A cap teetering at exactly
 * ninety degrees would be the obvious case for a hysteresis band, and a band is
 * STATE — state that lives in JS, that `takeSnapshot` knows nothing about, and
 * that a restored world would therefore disagree with the live one about. The
 * trajectory preview restores a snapshot and claims to draw the shot that will
 * happen; the AI's rollouts restore one and claim to search the real world. Both
 * claims end the moment the friction a cap gets depends on how it got there.
 *
 * So a cap rocking on its rim alternates, and that is the honest answer: it is
 * genuinely alternating between standing on its hem and lying on its crown.
 *
 * ── three worlds, one rule ───────────────────────────────────────────────────
 * The live sim, the preview, and every rollout each own a `RAPIER.World`, and
 * all three step it themselves. So this takes a bare world and a list of handles
 * — the same shape as `capsInSensor` and for the same reason: a second
 * implementation of the rule would eventually disagree with the first, and it
 * would disagree exactly on the shots where a cap flips, which are the ones the
 * preview is drawing and the search is looking for.
 */

/**
 * World-space y of a body's local +y, straight off the quaternion.
 *
 * The cap is built hem-at-zero with the crown at +y, so this IS the question:
 * +1 is a cap standing on its hem, -1 is one lying on its crown, 0 is one on
 * its rim.
 */
export function upY(q) {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

/**
 * The coefficient this pose gets.
 *
 * The threshold is 0 — the equator — because that is where the contact actually
 * changes hands. Past ninety degrees the crown is the lowest thing on the cap
 * and the hem is in the air, and no interpolation between the two is more true
 * than the step is: the board is touching one face or the other.
 *
 * @param {{x: number, y: number, z: number, w: number}} rotation
 * @param {{friction: number, flippedFriction: number}} desc
 */
export function frictionFor(rotation, desc) {
  return upY(rotation) < 0 ? desc.flippedFriction : desc.friction;
}

/**
 * Keeps a world's cap colliders agreeing with their caps' poses.
 *
 * One of these per world. `sync` is called immediately before `step`, in the
 * same place `TurnSettle.preStep` is called and for the same reason: the step
 * about to run is the one that has to use the new number.
 */
export class CapFriction {
  /**
   * @param {number[]} capBodies      body handle per cap
   * @param {number[][]} capColliders collider handles per cap
   * @param {{friction: number, flippedFriction: number}} desc
   */
  constructor(capBodies, capColliders, desc) {
    this.capBodies = capBodies;
    this.capColliders = capColliders;
    this.desc = desc;

    /**
     * What was last WRITTEN to each cap, and which world object it was written
     * to.
     *
     * A cache, and one that cannot change the answer: the value is recomputed
     * from the pose every step regardless, and this only decides whether to
     * spend eleven `setFriction` calls across the WASM boundary saying the same
     * thing again. Most steps of most turns nothing has flipped.
     *
     * Keyed on the world OBJECT because friction rides inside a snapshot, so a
     * restore hands back colliders this cache has never seen. `PhysicsWorld`
     * builds a new world for every `reset` and every `restore` — see its
     * `generation` counter, which exists for the same hazard — so an identity
     * check catches all of them without anything having to remember to say so.
     */
    this._world = null;
    this._written = [];

    /** Wrapper cache, exactly as `PhysicsWorld` and `RolloutArena` keep. */
    this._bodies = [];
    this._colliders = [];
  }

  /**
   * Forget what was written, so the next `sync` writes it again.
   *
   * For the live tuning path: a slider that changes `desc.friction` changes what
   * every cap should be carrying, and the cache's whole job is to skip writes
   * for caps whose pose has not changed — which is exactly the set of caps a
   * retune has to reach.
   */
  invalidate() {
    this._written.fill(Number.NaN);
  }

  /** @param {import('@dimforge/rapier3d-compat').World} world */
  sync(world) {
    if (world !== this._world) {
      this._world = world;
      this._written = new Array(this.capBodies.length).fill(Number.NaN);
      this._bodies = this.capBodies.map((h) => world.getRigidBody(h));
      this._colliders = this.capColliders.map((hs) => hs.map((h) => world.getCollider(h)));
    }

    for (let i = 0; i < this._bodies.length; i++) {
      const body = this._bodies[i];
      if (!body) continue;
      const want = frictionFor(body.rotation(), this.desc);
      if (this._written[i] === want) continue;
      this._written[i] = want;

      /**
       * MIN, not the default average.
       *
       * Rapier resolves a pair's rule by taking the stricter of the two
       * colliders', so a cap asking for Min gets Min against anything. Without
       * it the number above would be halved by whatever it is sliding on — the
       * board's own 0.34 averages 0.16 up to 0.25 — and the same card would mean
       * a different amount of slide on the board, the pitch and the table, none
       * of them the number that was written down.
       *
       * Restored to Average the moment the cap is back on its hem, so an upright
       * cap combines exactly as it always has and nothing else in any mode moves.
       */
      const rule =
        want === this.desc.friction
          ? RAPIER.CoefficientCombineRule.Average
          : RAPIER.CoefficientCombineRule.Min;
      for (const c of this._colliders[i]) {
        if (!c) continue;
        c.setFriction(want);
        c.setFrictionCombineRule(rule);
      }
    }
  }
}

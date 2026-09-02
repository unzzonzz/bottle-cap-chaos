import { RAPIER } from './rapier.js';
import { hashFloats } from './rng.js';

/**
 * The physics layer. Layer 1 of 3, and it owns no three.js and no game rules.
 *
 * ── the fixed step ───────────────────────────────────────────────────────────
 * `step()` advances exactly `FIXED_DT` and takes no argument. There is
 * deliberately no way to hand it a frame time: a solver fed a variable dt gives
 * a different answer on a 144 Hz machine than on a 60 Hz one, and on the same
 * machine gives a different answer to the same shot twice. The accumulator that
 * turns wall-clock time into a whole number of these steps lives up in the sim
 * loop, where it belongs.
 *
 * ── handles, not objects ─────────────────────────────────────────────────────
 * Everything above this layer refers to bodies by integer handle. `RigidBody`
 * and `Collider` are JS shims over WASM memory that `restoreSnapshot` throws
 * away wholesale — every cached wrapper is a dangling pointer the moment a
 * rewind happens, and rewinds happen constantly here (every trajectory preview
 * is one). Handles survive, because they are indices into arenas the snapshot
 * serialises intact.
 *
 * ── scale ────────────────────────────────────────────────────────────────────
 * 1 world unit = 1 cm, inherited from the render pipeline's MM = 0.1. Rapier's
 * internal tolerances — contact prediction, allowed penetration, sleep
 * thresholds — are all quoted in metres, so `lengthUnit` has to be told there
 * are 100 world units in one. Skip that and the engine thinks a 3 cm cap is a
 * 3 metre boulder, tolerates penetration a third of the cap deep, and the whole
 * thing turns to soup.
 */

/** 1/120 s. Not negotiable and not exposed — slow motion changes how many of
 *  these run per frame, never how long one is. */
export const FIXED_DT = 1 / 120;

/** World units per metre. See the note above. */
const LENGTH_UNIT = 100;

/** cm/s². 9.81 m/s² at this scale. */
export const GRAVITY_Y = -981;

/**
 * The integration parameters, applied identically everywhere.
 *
 * Exported because the trajectory preview builds its own `RAPIER.World` from a
 * snapshot and has to configure it the same way. A preview running at a
 * different solver iteration count than the sim it is predicting would be
 * subtly, unfalsifiably wrong — it would still draw a plausible line.
 */
export function applyIntegrationParams(world, { solverIterations, ccdSubsteps }) {
  const p = world.integrationParameters;
  p.dt = FIXED_DT;
  p.lengthUnit = LENGTH_UNIT;
  // Thin boxes stacked on thin boxes is the hard case for a projected-Gauss-
  // Seidel solver; the stock 4 iterations lets a cap sink visibly into another
  // before the constraint catches.
  p.numSolverIterations = solverIterations;
  // CCD is on per-body, but the substep count is global and 1 is not enough at
  // full charge: a cap doing 4 units a step against a 0.09-thick skirt box
  // needs several passes to find the first contact rather than the last.
  p.maxCcdSubsteps = ccdSubsteps;
}

export class PhysicsWorld {
  constructor({ solverIterations = 8, ccdSubsteps = 4 } = {}) {
    this.solverIterations = solverIterations;
    this.ccdSubsteps = ccdSubsteps;

    /** Steps run since the world was built. The sim's only clock. */
    this.steps = 0;

    /**
     * Bumped every time the WORLD IS REPLACED — `reset` and `restore`.
     *
     * Not a clock and not in the hash: it is a cache stamp for the one kind of
     * state that lives on a body and is not written every step. `Arena` keeps a
     * per-cap mass multiplier so 철벽 is applied at a state transition rather
     * than every frame, and a snapshot carries the mass with it — so after a
     * rewind the cache describes a world that no longer exists, and the cap it
     * describes may have come back heavier or lighter than the cache believes.
     *
     * A counter rather than a callback because there is no ordering to get
     * wrong: whoever caches something derived from a body compares stamps when
     * it next looks, and a rewind it never noticed cannot leave it stale.
     */
    this.generation = 0;

    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    this._applyIntegration();
    this._bodyCache = new Map();
    this._colliderCache = new Map();
  }

  _applyIntegration() {
    applyIntegrationParams(this.world, this);
  }

  /**
   * Empty world, same settings, handles counting from zero again.
   *
   * Used for structural rebuilds instead of removing bodies one by one. Rapier
   * reuses freed arena slots, so piecemeal removal leaves handles that resolve
   * to somebody ELSE'S cap — a stale index held anywhere upstream then silently
   * addresses the wrong body instead of failing. A fresh arena makes that
   * mistake loud.
   */
  reset() {
    this.world.free();
    this.world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    this._applyIntegration();
    this._bodyCache.clear();
    this._colliderCache.clear();
    this.steps = 0;
    this.generation++;
  }

  /** @param {number} handle */
  body(handle) {
    let b = this._bodyCache.get(handle);
    if (!b) {
      b = this.world.getRigidBody(handle);
      this._bodyCache.set(handle, b);
    }
    return b;
  }

  /** @param {number} handle */
  collider(handle) {
    let c = this._colliderCache.get(handle);
    if (!c) {
      c = this.world.getCollider(handle);
      this._colliderCache.set(handle, c);
    }
    return c;
  }

  step() {
    // No EventQueue, anywhere. Sensor verdicts are pulled from the narrow phase
    // at turn end instead, so the real sim and the preview sim run through an
    // identical call sequence and cannot diverge over a queue one of them
    // happens to be holding.
    this.world.step();
    this.steps++;
  }

  /** @returns {Uint8Array} */
  takeSnapshot() {
    return this.world.takeSnapshot();
  }

  /**
   * Rewind to a snapshot, in place.
   *
   * The old world is freed rather than left to the GC: it is WASM linear memory,
   * which no JS collector can see, and the preview path rewinds several times a
   * second.
   */
  restore(bytes) {
    const next = RAPIER.World.restoreSnapshot(bytes);
    this.world.free();
    this.world = next;
    this._bodyCache.clear();
    this._colliderCache.clear();
    this.generation++;
    // A snapshot carries its own integration parameters, so these are already
    // right — reapplied anyway so that a live tweak to solver iterations does
    // not silently revert on the next rewind and desync the preview from the
    // thing it is previewing.
    this._applyIntegration();
  }

  /**
   * A fingerprint of every dynamic body's position, orientation and velocity.
   *
   * This is what "the same shot gives the same result" is checked against, and
   * it is checked rather than eyeballed because the interesting failures are the
   * small ones: a cap that ends up a tenth of a unit further along is invisible
   * on screen and is still a broken guarantee.
   *
   * Iteration is over sorted handles, so the hash does not depend on whatever
   * order the arena happens to walk its slots in.
   */
  hashState() {
    const handles = [];
    this.world.forEachRigidBody((b) => {
      if (b.isFixed()) return;
      handles.push(b.handle);
    });
    handles.sort((a, b) => a - b);

    const v = [];
    for (const h of handles) {
      const b = this.body(h);
      const t = b.translation();
      const r = b.rotation();
      const lv = b.linvel();
      const av = b.angvel();
      v.push(t.x, t.y, t.z, r.x, r.y, r.z, r.w, lv.x, lv.y, lv.z, av.x, av.y, av.z);
    }
    return hashFloats(v);
  }

  free() {
    this.world.free();
    this._bodyCache.clear();
    this._colliderCache.clear();
  }
}

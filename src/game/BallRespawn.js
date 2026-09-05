import { RAPIER } from '../physics/rapier.js';
import { secondsToSteps } from './Arena.js';

/**
 * The ball rolling back into play.
 *
 * ── it rolls, and it is counted in physics steps ─────────────────────────────
 * Teleporting would be one line and would read as a bug: the ball is the thing
 * the player is tracking, and having it appear somewhere else between frames
 * costs them the thread of what just happened. So it travels, it eases out of
 * the move, and it TURNS by the distance it covers over its own radius — a ball
 * that slid to its new spot without rotating would look like it was being
 * dragged, which is exactly what it is and exactly what it must not look like.
 *
 * The length is a number of fixed steps derived from the configured seconds, and
 * the loop that drives it is the same accumulator the simulation uses. That is
 * what keeps "같은 시드·같은 입력이면 리스폰 위치까지 완전히 동일" true: the
 * animation is the same length in simulated time whatever the frame rate, so the
 * world the next turn is snapshotted from is the same world every run.
 *
 * ── it must not shove anything on the way ────────────────────────────────────
 * Two changes, and both are needed. KINEMATIC, so the position is commanded
 * rather than solved for and gravity has no say. And a SENSOR for the duration,
 * so it generates no contacts at all — a kinematic body is infinitely heavy to
 * the solver, and one crossing a cap would fire it off the pitch. Passing
 * through is safe because the spot at the far end was chosen to be clear of
 * every cap before any of this started.
 */

/** Ease-out cubic. Fast away from the old spot, gentle into the new one. */
function easeOut(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}

/** q = delta * start, both as {x,y,z,w}. */
function mulQuat(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export class BallRespawn {
  constructor(config) {
    this.config = config;
    this.active = false;
    this.done = true;
    this.kind = '';
    this.steps = 0;
    this.total = 0;
  }

  /**
   * @param {import('./Arena.js').Arena} arena
   * @param {{x: number, z: number, kind: string}} spot
   */
  begin(arena, spot) {
    const body = arena.physics.body(arena.ballBody);
    const t = body.translation();

    this.from = { x: t.x, y: t.y, z: t.z };
    this.to = { x: spot.x, y: t.y, z: spot.z };
    this.kind = spot.kind;
    this.startRotation = { ...body.rotation() };

    const dx = this.to.x - this.from.x;
    const dz = this.to.z - this.from.z;
    const distance = Math.hypot(dx, dz);

    this.total = Math.max(1, secondsToSteps(this.config.respawn.travelSeconds));
    this.steps = 0;
    this.active = true;
    this.done = false;

    // The roll. For a ball travelling along d on the ground, the axis that keeps
    // the contact point still is perpendicular to d in the plane: solving
    // `v + w x r = 0` at `r = (0, -R, 0)` gives `w ∝ (dz, 0, -dx)`.
    if (distance > 1e-6) {
      this._axis = { x: dz / distance, y: 0, z: -dx / distance };
      this._angle = distance / Math.max(1e-3, arena.ballRadius);
    } else {
      this._axis = { x: 0, y: 1, z: 0 };
      this._angle = 0;
    }

    body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    // No contacts for the duration. See the header.
    arena.physics.collider(arena.ballCollider).setSensor(true);
  }

  /** Command the next step's pose. Call immediately before `physics.step()`. */
  advance(arena) {
    if (!this.active || this.done) return;
    this.steps++;
    const t = Math.min(1, this.steps / this.total);
    const k = easeOut(t);

    const body = arena.physics.body(arena.ballBody);
    body.setNextKinematicTranslation({
      x: this.from.x + (this.to.x - this.from.x) * k,
      y: this.to.y,
      z: this.from.z + (this.to.z - this.from.z) * k,
    });

    const half = this._angle * k * 0.5;
    const s = Math.sin(half);
    body.setNextKinematicRotation(
      mulQuat(
        { x: this._axis.x * s, y: this._axis.y * s, z: this._axis.z * s, w: Math.cos(half) },
        this.startRotation,
      ),
    );

    if (t >= 1) this.done = true;
  }

  /** Back to a ball. */
  finish(arena) {
    if (!this.active) return;
    const body = arena.physics.body(arena.ballBody);
    arena.physics.collider(arena.ballCollider).setSensor(false);
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    // Zeroed rather than left to whatever the kinematic motion implied: the ball
    // has arrived, and arriving with the speed of the animation would launch it.
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.active = false;
    this.done = true;
  }

  /** Seconds of simulated time elapsed. For the HUD. */
  get seconds() {
    return this.steps / 120;
  }
}

import { RAPIER } from '../../physics/rapier.js';
import { Layout } from './Layout.js';

/**
 * 알까기's board: a square slab with a sloping rim, a catch floor, and nothing
 * else. Lifted out of `Arena` unchanged when the layout interface was added —
 * the geometry, the constants and the reasoning below are all as they were, and
 * the knockout mode plays exactly as it did.
 *
 * ── the board ────────────────────────────────────────────────────────────────
 * NO walls: this mode is board plus fall-off, so the edge is the whole hazard.
 * Under it, a long way down, a catch floor — a cap knocked off has to land on
 * something, or it falls forever and the settle detector waits for a body that
 * will never be still.
 *
 * ── out is a FALL, not a line ────────────────────────────────────────────────
 * A cap is out when it has left the board, and "left the board" means it is
 * lying on the catch floor thirty units down. There is no out line and no
 * in-bounds volume any more.
 *
 * That used to be a rectangle at `boardHalf` and a cap was out the moment no
 * part of it was over that rectangle — so a cap sitting perfectly still, fully
 * supported, a hair past the paint, was dead. Which is a rule you have to be
 * told; falling off is a rule you can see. The board's own edge does the
 * judging now: the slope is steeper than the friction angle, so a cap that gets
 * far enough over cannot rest there and goes, and one that can still hold on is
 * still in the game.
 *
 * ── it is still a VOLUME ─────────────────────────────────────────────────────
 * The pit is a sensor spanning everything below the board, and the question is
 * asked of the narrow phase exactly as it was before. A coordinate test would
 * have to pick a point on a body that is a compound of eleven parts and may be
 * lying at any angle — centre? lowest? average? — and every answer is wrong for
 * some pose.
 */

/** Top of the pit, in world units. Below the board's underside and its slope. */
const PIT_TOP = -6;
/** Floor of the pit. Below the catch floor, so a landed cap is wholly inside. */
const PIT_BOTTOM = -36;

export class KnockoutBoard extends Layout {
  constructor(config) {
    super(config);
    this.boardCollider = -1;
    this.floorCollider = -1;
  }

  get name() {
    return '알까기 보드';
  }

  /**
   * What the camera has to frame: the board's real OUTER edge, drop included.
   *
   * It used to be `boardHalf`, which was the out line — the only thing that
   * mattered when crossing it was what killed you, and the couple of units of
   * board past it could sit off-screen without costing anything. Now that a cap
   * dies by FALLING, the edge it falls off is the single most important thing on
   * screen and it has to be on it. Measured with the old extents: the board's
   * outer edge sat 1.2 units outside the frame at minimum zoom.
   */
  get extents() {
    const a = this.config.arena;
    const h = a.boardHalf + Math.max(0, a.edgeShelf) + Math.max(0, a.edgeSlopeRun);
    return { x: h, z: h };
  }

  buildStatic(arena) {
    const { arena: a } = this.config;
    const world = arena.physics.world;

    // ── board ──────────────────────────────────────────────────────────────
    // A fixed body rather than a parentless collider so it shows up in
    // `forEachRigidBody` filtered out as fixed, keeping the state hash to the
    // bodies that actually move.
    const boardBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -a.boardThickness * 0.5, 0),
    );

    // A TRUNCATED PYRAMID, not a slab: flat on top out to the out line, then
    // sloping down and outward to the underside.
    //
    // Two problems are being solved at once here and they pull in the same
    // direction. A plain cuboid's right-angled rim behaves as a wall — box-box
    // contact takes its normal along the axis of SHALLOWEST penetration, so a
    // skirt box overhanging the rim flips its normal from (0,1,0) to (0,0,±1) and
    // a cap fired toward the middle is stopped dead and thrown back, measured at
    // 136 cm/s in and -8.8 cm/s out one step later. Rounding the rim fixes that,
    // but leaves the second problem: whatever shape the rim is, a cap ALLOWED to
    // come to rest hanging over it rests partly on it, and a rim is a ramp. A
    // shove inward makes the overhanging part climb, converting the shot into a
    // hop, by an amount that depends on whether a flat skirt face or a corner is
    // on the ramp — which cycles with the skirt's 36 degrees and made travel a
    // function of the cap's yaw, varying threefold.
    //
    // A slope steeper than the friction angle cannot be rested on at all, so the
    // pathological pose stops existing rather than being tolerated: a cap that
    // crosses the line tips onto the slope and goes, tumbling as it drops.
    //
    // The flat carries `edgeShelf` past the out line before the slope starts, so
    // that a cap whose centre is still inside the line has nothing to slide down.
    const T = a.boardThickness;
    const run = Math.max(0, a.edgeSlopeRun);
    const flatHalf = a.boardHalf + Math.max(0, a.edgeShelf);
    const edgeR = Math.min(Math.max(a.boardEdgeRadius, 0.001), T * 0.3, flatHalf * 0.2);
    const topH = flatHalf - edgeR;
    const botH = flatHalf + run - edgeR;
    const hull = [];
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      hull.push(sx * topH, T * 0.5 - edgeR, sz * topH);
      hull.push(sx * botH, -(T * 0.5) + edgeR, sz * botH);
    }
    const boardDesc =
      RAPIER.ColliderDesc.roundConvexHull(new Float32Array(hull), edgeR) ??
      RAPIER.ColliderDesc.roundCuboid(flatHalf - edgeR, T * 0.5 - edgeR, flatHalf - edgeR, edgeR);
    this.boardCollider = world.createCollider(
      boardDesc.setFriction(a.boardFriction).setRestitution(a.boardRestitution),
      boardBody,
    ).handle;

    // ── catch floor ────────────────────────────────────────────────────────
    // Well below the in-bounds volume, and wide enough that nothing this phase
    // can launch will clear it.
    const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -32, 0));
    this.floorCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(400, 1, 400).setFriction(0.9).setRestitution(0),
      floorBody,
    ).handle;

    // ── the pit ────────────────────────────────────────────────────────────
    // Everything below the board. Its top is well clear of the slope's underside
    // so a cap still clinging to the rim cannot dip into it, and its bottom is
    // below the catch floor so a cap that has landed is wholly inside.
    const half = (PIT_TOP - PIT_BOTTOM) * 0.5;
    const pitBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, PIT_BOTTOM + half, 0),
    );
    this.sensors = {
      pit: world.createCollider(
        RAPIER.ColliderDesc.cuboid(600, half, 600).setSensor(true),
        pitBody,
      ).handle,
    };
  }

  placements() {
    const a = this.config.arena;
    const per = Math.max(1, Math.round(a.capsPerPlayer));
    const out = [];
    for (let player = 0; player < 2; player++) {
      const z = player === 0 ? -a.rowZ : a.rowZ;
      for (let i = 0; i < per; i++) {
        out.push({
          kind: 'cap',
          owner: player,
          role: '',
          x: (i - (per - 1) * 0.5) * a.rowSpacing,
          z,
        });
      }
    }
    return out;
  }

  retune(arena) {
    const board = arena.physics.collider(this.boardCollider);
    board.setFriction(this.config.arena.boardFriction);
    board.setRestitution(this.config.arena.boardRestitution);
  }

  describe() {
    const a = this.config.arena;
    return {
      kind: 'board',
      boardHalf: a.boardHalf,
      boardThickness: a.boardThickness,
      edgeShelf: Math.max(0, a.edgeShelf),
      edgeSlopeRun: Math.max(0, a.edgeSlopeRun),
    };
  }
}

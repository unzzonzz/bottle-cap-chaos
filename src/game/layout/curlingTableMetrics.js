/**
 * A curling table, in world units, derived from a width and a ratio.
 *
 * ── the width is measured in CAP DIAMETERS, and that is the whole design ─────
 * "뚜껑이 너무 작아 보이면 안 된다 → 책상이 좁아야 함 / 상대 뚜껑을 너무 쉽게 치면
 * 안 된다 → 책상이 넓어야 함." Those two pull against each other and neither is
 * about an absolute size: the camera frames the table's own extents, so the
 * table is always the same size on screen and the only thing that changes is how
 * much of it one cap covers. That single ratio IS the trade, and measuring the
 * width in cap diameters makes it the number on the slider.
 *
 * It is also the reason there is no cap-size slider next to it. A cap's diameter
 * lives in `CAP_DEFAULTS` and is shared by all three modes — moving it would
 * resize the survival board's caps and the football team, which the brief rules
 * out — and scaling the cap and the table together is a pure zoom that changes
 * nothing at all. One control, one degree of freedom.
 *
 * ── axes: the table runs AWAY from you ──────────────────────────────────────
 * Z is the LENGTH, X is the WIDTH. Both players throw from −Z and the target
 * line is the far edge at +Z. Same convention as the pitch and the survival
 * board's rows, so "away from you, up the screen" means one thing in all three
 * modes and the camera's neutral bearing is zero.
 *
 * ── there are no walls, so every edge is the same edge ──────────────────────
 * The old lane had two out lines and two fences and the four sides meant three
 * different things. Here they mean one: past the flat, the surface tips away and
 * a cap that gets far enough over goes off. The target line is the only marking
 * with a rule attached, and it is a rule about DISTANCE, not about crossing —
 * crossing it is just the most expensive way to be far from it.
 *
 * ── nothing here is a collider ──────────────────────────────────────────────
 * These are numbers. `CurlingTable` turns some of them into colliders and
 * `CurlingTableView` turns others into geometry, and keeping the arithmetic in
 * one pure module is what stops the two from disagreeing about where the target
 * line is — the one disagreement that would make a judging bug impossible to
 * find, because the line you measure to would not be the line you can see.
 */

/**
 * @param {number} capDiameter  the cap's own width, in world units
 * @param {object} opts
 */
export function curlingTableMetrics(capDiameter, opts) {
  const cap = Math.max(0.2, capDiameter);

  /**
   * Floored at three caps, which is not a taste call: the throw spot needs a
   * cap's width of clearance either side of it before a cap knocked back onto
   * it has anywhere to be dealt, and below three the fallback search in
   * `throwSpot` has no room to step sideways at all.
   */
  const widthCaps = Math.max(3, opts.widthCaps);
  const width = cap * widthCaps;
  /** Length : width. The brief's band is 2 to 2.5. */
  const ratio = Math.max(1.2, opts.ratio);
  const length = width * ratio;

  const halfX = width * 0.5;
  const halfZ = length * 0.5;

  const thickness = Math.max(0.2, opts.thickness);
  const slopeRun = Math.max(0.1, opts.slopeRun);
  /**
   * The fillet on the rim, clamped exactly as the survival board's is.
   *
   * A right-angled rim behaves as a wall — box-box contact takes its normal
   * along the axis of shallowest penetration, so a skirt box overhanging the
   * edge flips its normal from (0,1,0) to sideways and a cap sliding toward the
   * edge is stopped dead and thrown back. See `KnockoutBoard` for the measured
   * version of that. This is the same fix, sized against the same two limits.
   */
  const edgeRadius = Math.min(
    Math.max(opts.edgeRadius, 0.001),
    thickness * 0.3,
    Math.min(halfX, halfZ) * 0.2,
  );

  /**
   * The target line: the far edge of the flat, and the whole of the game.
   *
   * At `halfZ` exactly rather than set back by a shelf, and that is deliberate.
   * The survival board carries a shelf past its out line so that a cap whose
   * centre is still inside has nothing to slide down; here the line IS the edge,
   * so a cap parked with its centre a hair inside it has half of itself over the
   * slope and is one nudge from gone. "최대한 가깝게, 하지만 넘지 않게" is that
   * geometry, not a rule anyone has to be told.
   */
  const targetZ = halfZ;

  /**
   * The throw spot, measured in from the NEAR edge, and clamped off it.
   *
   * Clamped at a cap radius plus the fillet so a cap dealt there is standing on
   * flat table rather than half over the rim — a dealt cap that immediately
   * slides off would be a turn the player never got to take.
   */
  const throwInset = Math.min(
    Math.max(cap * 0.5 + edgeRadius, opts.throwFromEdge),
    length - cap,
  );
  const throwZ = -halfZ + throwInset;

  return {
    cap,
    width,
    length,
    widthCaps,
    ratio,
    halfX,
    halfZ,
    thickness,
    slopeRun,
    edgeRadius,

    /** Where the drop bottoms out. What the camera has to frame. */
    outerHalfX: halfX + slopeRun,
    outerHalfZ: halfZ + slopeRun,

    targetZ,
    throwZ,
    /** Throw spot to target line. The distance a full throw has to cover. */
    run: targetZ - throwZ,
  };
}

/**
 * Perpendicular distance from a point to the target line.
 *
 * The line runs along X at `targetZ`, so this is one subtraction — and it is a
 * function rather than that subtraction written at each call site because there
 * are four of them (the judge, the tiebreaker, the distance marks, the panel's
 * live readout) and every one of them has to be measuring the same thing. A
 * disagreement here would show up as the game awarding a round to the cap that
 * visibly lost it.
 *
 * Absolute, so a cap that has stopped just PAST the line without falling reads
 * as very close rather than as negative. It is close; it is also about to fall.
 */
export function distanceToTarget(metrics, z) {
  return Math.abs(metrics.targetZ - z);
}

/**
 * The flat markings, as plain geometry for the renderer.
 *
 * Three things and no more: the line that decides the game, the line the caps
 * arrive on, and the outline of where the flat stops on the other three sides.
 * There is no path by which any of them becomes a body — the target line is
 * "시각 요소일 뿐 물리 충돌 없음", and the strongest way to honour that is for it
 * to exist nowhere but in this list.
 */
export function curlingTableMarkings(m) {
  return {
    /** The far edge. Drawn as a solid band, not a hairline — see the view. */
    target: [
      [-m.halfX, m.targetZ],
      [m.halfX, m.targetZ],
    ],
    /** Where a cap is dealt. */
    throwLine: [
      [-m.halfX, m.throwZ],
      [m.halfX, m.throwZ],
    ],
    /**
     * The other three sides of the flat. Dim: falling off them costs a cap
     * exactly as much as falling off the far one, but nobody is aiming at them.
     */
    edges: [
      [
        [-m.halfX, -m.halfZ],
        [m.halfX, -m.halfZ],
      ],
      [
        [-m.halfX, -m.halfZ],
        [-m.halfX, m.halfZ],
      ],
      [
        [m.halfX, -m.halfZ],
        [m.halfX, m.halfZ],
      ],
    ],
  };
}

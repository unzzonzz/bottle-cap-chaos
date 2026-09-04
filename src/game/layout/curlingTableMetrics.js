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
 * Z is the LENGTH, X is the WIDTH. Both players throw from −Z toward +Z, and the
 * target line lies somewhere up that way. Same convention as the pitch and the survival
 * board's rows, so "away from you, up the screen" means one thing in all three
 * modes and the camera's neutral bearing is zero.
 *
 * ── there are no walls, so every edge is the same edge ──────────────────────
 * The old lane had two out lines and two fences and the four sides meant three
 * different things. Here they mean one: past the flat, the surface tips away and
 * a cap that gets far enough over goes off. The target line is the only marking
 * with a rule attached, and it is a rule about DISTANCE, not about crossing.
 *
 * ── the target line is NOT the edge, and that is the whole game ─────────────
 * `targetZ` is drawn fresh every round somewhere between half and nine tenths of
 * the way up the flat, so there is table on BOTH sides of it. Overshooting is
 * not punished — a cap that stops past the line is measured from the far side
 * exactly as one that stops short is measured from the near side, and playing
 * deliberately long to come back at the line from behind is a real shot rather
 * than a mistake.
 *
 * That is a change of KIND from the version this replaced, where the line sat on
 * `halfZ` and crossing it meant falling off. The flat still ends at `halfZ` and
 * the drop is still the drop; the line simply stopped being it. Anything that
 * reads `targetZ` as "the far edge" is now wrong — the edge is `halfZ`, and the
 * two are different numbers.
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
   * The target line's z. A round's, so it is an INPUT and not a calculation.
   *
   * ── why it is not drawn here ─────────────────────────────────────────────
   * The header says why this module is pure: the side that builds colliders and
   * the side that builds geometry have to see one number, or the line you
   * measure to stops being the line you can see. A `Math.random()` — or any
   * draw — inside this function would be taken TWICE, once per caller, and the
   * two answers would differ. `CurlingRules` draws it once at the top of each
   * round and hands it down; this module only ever receives it.
   *
   * ── clamped, because a line off the flat cannot be played ────────────────
   * Kept a cap's radius inside each edge. The caller's band is 0.5 to 0.9 of the
   * length and never reaches either limit, so this does nothing in normal play —
   * it is here so that a bad `targetZ` produces a hard line at a wrong place
   * rather than a line hanging over the slope, which would read as the table
   * being broken rather than as the number being wrong.
   *
   * Defaults to `halfZ` — the old far-edge line — so a caller that does not care
   * gets the geometry this module had before the line started moving.
   */
  const targetZ =
    opts.targetZ === undefined
      ? halfZ
      : Math.min(Math.max(opts.targetZ, -halfZ + cap * 0.5), halfZ);

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
 * are five of them (the judge, the tiebreaker, the distance marks, the panel's
 * live readout, and the view that draws the line) and every one of them has to
 * be measuring the same thing. A disagreement here would show up as the game
 * awarding a round to the cap that visibly lost it.
 *
 * ── absolute, and it now means what it says ─────────────────────────────────
 * A cap that has stopped PAST the line reads as exactly as close as one the same
 * distance short of it. That used to come with a caveat — the line was the far
 * edge, so an overshooting cap was close and also about to fall — and the caveat
 * is gone: there is flat table on both sides of the line, overshooting carries
 * no penalty, and coming back at the line from behind is a shot people take on
 * purpose. Symmetric distance is the rule, not a convenient approximation to it.
 */
export function distanceToTarget(metrics, z) {
  return Math.abs(metrics.targetZ - z);
}

/**
 * The flat markings, as plain geometry for the renderer.
 *
 * ONE thing: the line that decides the game. There is no path by which it
 * becomes a body — the target line is "시각 요소일 뿐 물리 충돌 없음", and the
 * strongest way to honour that is for it to exist nowhere but in this list.
 *
 * ── it used to return three, and the other two were noise ──────────────────
 * A throw line and an outline of the flat's other three sides were in here too.
 * Both are gone. The throw line marked a spot every cap is placed on
 * automatically — a label on something the player never chooses — and the edge
 * outline drew a rule that the table's own silhouette already states more
 * clearly than a hairline can: past the flat, the surface tips away. With the
 * target line now a checkerboard that has to be read at a glance from the far
 * end, every other mark on the flat was competing with the only one that
 * decides anything.
 *
 * They were deleted here rather than left returned-and-ignored, because a value
 * this module hands out that nobody draws is a lie told to whoever reads it
 * next.
 */
export function curlingTableMarkings(m) {
  return {
    /**
     * The line that decides the game, as its two ends.
     *
     * Drawn as a checkerboard band rather than a hairline — see the view. It
     * spans the full width because the rule is about z alone: every point on it
     * is the same line, and a mark that stopped short of the sides would suggest
     * a cap could be off the end of it.
     */
    target: [
      [-m.halfX, m.targetZ],
      [m.halfX, m.targetZ],
    ],
  };
}

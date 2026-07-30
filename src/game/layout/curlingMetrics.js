/**
 * A curling lane, in world units, derived from a length and a ratio.
 *
 * ── it is NOT a scale model, and that is deliberate ─────────────────────────
 * `pitchMetrics` next door takes every dimension off the Laws of the Game
 * because "실제 축구장 비율을 지킨다" is a requirement there. Here the brief says
 * the opposite: a real sheet is about 1:9 and "실제 컬링보다는 짧게 시작해라.
 * 1:4~1:5 정도" — because a lane long enough to be authentic is a lane the cap
 * cannot cross and a house nobody can see. So the ratio is a PARAMETER, not a
 * constant, and it is on the panel.
 *
 * ── axes: the lane stands UP, like the pitch ─────────────────────────────────
 * Z is the LENGTH, X is the WIDTH. Both players throw from −Z and the house is
 * at +Z. That is the same convention `pitchMetrics` uses and the same one the
 * knockout board uses for its rows, so "away from you, up the screen" means the
 * same thing in all three modes and the camera's neutral bearing is zero.
 *
 * ── the two ends are not symmetrical ────────────────────────────────────────
 * The FRONT line (−Z) is where the caps are thrown from; the BACK line (+Z) is
 * past the house. Both are out lines and both are judged by the same sensor —
 * the in-play volume between them — but only the back one has a house in front
 * of it, so `houseFromBack` measures from there.
 *
 * ── nothing here is a collider ──────────────────────────────────────────────
 * These are numbers. `CurlingLane` turns some of them into colliders and
 * `CurlingView` turns others into lines, and keeping the arithmetic in one pure
 * module is what stops the two from disagreeing about where the back line is —
 * the one disagreement that would make an overshoot bug impossible to find.
 */

/**
 * @param {number} length   distance between the two out lines, in world units
 * @param {object} opts
 */
export function curlingMetrics(length, opts) {
  const len = Math.max(20, length);
  // Width follows the ratio, so there is exactly one size control and the
  // proportion is what the panel actually edits. A width slider alongside a
  // length slider would be two ways to say the same thing and neither would be
  // the ratio the brief specifies.
  const ratio = Math.max(1.5, opts.ratio);
  const width = len / ratio;

  const halfX = width * 0.5;
  const halfZ = len * 0.5;

  const wallThickness = Math.max(0.1, opts.wallThickness);
  const wallHeight = Math.max(0.4, opts.wallHeight);
  const runoff = Math.max(0, opts.runoff);

  /**
   * The house, clamped so the gap to the walls survives.
   *
   * Two sliders that describe one piece of geometry, and this is where they are
   * reconciled. `houseRadius` is what you want the house to be; `houseMargin`
   * is the clearance the brief insists on — "하우스와 좌우 벽 사이 여백을 충분히
   * 둬라 ... 하우스가 벽에 닿으면 벽 반사 전략이 무의미해진다". The margin
   * wins, because a house that touches the walls deletes the whole point of the
   * mode, and a house one unit smaller than asked for does not.
   *
   * `houseMargin` is measured to the wall's INNER face, which is the surface a
   * cap actually bounces off — not to the lane's centre line or to the outside
   * of the fence, either of which would make the number a lie by a thickness.
   */
  const houseWanted = Math.max(1, opts.houseRadius);
  const houseRoom = Math.max(1, halfX - Math.max(0, opts.houseMargin));
  const houseRadius = Math.min(houseWanted, houseRoom);
  const houseClamped = houseRadius < houseWanted - 1e-6;

  /**
   * House centre, measured from the BACK line inward — so dragging the lane
   * longer leaves the house where it is relative to the end it belongs to.
   *
   * Floored at the house's own RADIUS, which keeps the whole circle inside the
   * lane. Without the floor, dragging the slider down puts part of the house
   * past the back line, and a cap resting in that part is drawn inside the house
   * and judged out of play — a rule the player can see being broken. Clamping is
   * the same answer `houseMargin` gets against the walls, for the same reason.
   */
  const houseZ = halfZ - Math.max(houseRadius, opts.houseFromBack);
  // And the throw spot from the FRONT line, for the same reason.
  const throwZ = -halfZ + Math.max(1, opts.throwFromFront);

  return {
    length: len,
    width,
    ratio,
    halfX,
    halfZ,
    wallThickness,
    wallHeight,
    runoff,
    /** Ground reaches this far past each out line. */
    outerHalfZ: halfZ + runoff,

    houseRadius,
    /** True when `houseMargin` bit. The panel says so; see the note above. */
    houseClamped,
    /** What the gap to the wall's inner face actually came out as. */
    houseMargin: halfX - houseRadius,
    houseZ,
    throwZ,

    /** Concentric rings, outermost first. VISUAL ONLY — see `CurlingLane`. */
    rings: [1, 0.62, 0.32, 0.11].map((k) => houseRadius * k),
    /** Line width for the markings, as a fraction of the lane's width. */
    lineWidth: Math.max(0.12, width * 0.006),
  };
}

/**
 * The flat markings, as plain geometry for the renderer.
 *
 * Lines and circles only. There is no path by which one of these becomes a
 * body: "링은 시각 요소일 뿐 물리 충돌 없음" is a requirement, and the strongest
 * way to honour it is for the rings to exist nowhere but in this list.
 */
export function curlingMarkings(m) {
  const circles = m.rings.map((r) => ({ x: 0, z: m.houseZ, r }));
  const segments = [
    // The two out lines, full width.
    [
      [-m.halfX, -m.halfZ],
      [m.halfX, -m.halfZ],
    ],
    [
      [-m.halfX, m.halfZ],
      [m.halfX, m.halfZ],
    ],
    // The throw line.
    [
      [-m.halfX, m.throwZ],
      [m.halfX, m.throwZ],
    ],
    // The centre line, from the throw line to the back of the house.
    [
      [0, m.throwZ],
      [0, m.houseZ + m.houseRadius],
    ],
    // The tee line, across the house.
    [
      [-m.houseRadius, m.houseZ],
      [m.houseRadius, m.houseZ],
    ],
  ];
  return { circles, segments };
}

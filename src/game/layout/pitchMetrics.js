/**
 * A football pitch, in world units, derived from one number.
 *
 * ── everything is a ratio ────────────────────────────────────────────────────
 * The brief is "실제 축구장 비율을 지킨다 — FIFA 표준 105:68". So the only free
 * parameter is how long the pitch is; every other dimension on it is a fixed
 * fraction of that length, taken from the IFAB Laws of the Game's reference
 * pitch. Nothing here is a tuned number and nothing here may be tuned — move
 * `length` on the slider and the goal, the penalty area and the centre circle
 * all move with it in lockstep, because that is what "to scale" means.
 *
 * The reference figures, in metres on a 105 x 68 pitch:
 *
 *   touchline           105          goal width            7.32
 *   goal line            68          goal height           2.44
 *   centre circle r       9.15       penalty area  40.32 x 16.5
 *   penalty spot         11          goal area     18.32 x  5.5
 *
 * Divided through by 105 they become the constants below, and the whole pitch
 * is `length` times them. `RATIO` is the one that the completion criterion is
 * measured against: `width / length` must come out at 68/105 exactly.
 *
 * ── axes: the pitch stands UP ────────────────────────────────────────────────
 * Z is the LENGTH, X is the WIDTH. Goals sit at z = ±halfLength — screen bottom
 * and screen top.
 *
 * This was the other way round, and the reason given for it was that a 4:3
 * letterbox frames a 1.544:1 pitch best lying down. That is true of the framing
 * and it is not the whole picture: portrait is what was asked for, and it also
 * puts the two goals where the two players sit, which is the same arrangement
 * the knockout board already uses — player 0 at −Z, player 1 at +Z. Both modes
 * now agree on which way is "yours", and the camera's neutral bearing is zero
 * rather than a right angle nobody can see the reason for.
 *
 * The cost is real and is paid in screen width: a 68:105 rectangle in a 4:3
 * frame leaves bars either side. `GameCamera` takes the rest of that trade.
 *
 * `halfX` and `halfZ` below are the ONLY place this mapping is written down.
 * Everything in this file and in `FootballPitch` is built out of them rather
 * than out of `halfLength`/`halfWidth` directly, so the pitch's orientation is
 * one line and not a hundred swapped literals.
 *
 * ── the pitch never rotates ──────────────────────────────────────────────────
 * The camera has a free yaw and the pitch does not move with it. Rotating the
 * world to spin the view would mean rotating every rigid body in it, and the
 * snapshot, the state hash and the replay check all rest on the world being the
 * same world twice. Rotation lives in `GameCamera` and reaches nothing here.
 *
 * ── nothing here is a collider ───────────────────────────────────────────────
 * These are numbers. `FootballPitch` turns some of them into colliders and
 * `PitchView` turns others into lines; keeping the arithmetic in one pure module
 * is what stops the two from disagreeing about where the goal line is, which is
 * the one disagreement that would make a scoring bug impossible to find.
 */

/** The one true ratio. Everything downstream is checked against this. */
export const RATIO = 68 / 105;

/** Fractions of the pitch LENGTH. Straight off the Laws of the Game. */
const F = {
  width: 68 / 105,
  centreCircleRadius: 9.15 / 105,
  penaltyAreaDepth: 16.5 / 105,
  penaltyAreaWidth: 40.32 / 105,
  goalAreaDepth: 5.5 / 105,
  goalAreaWidth: 18.32 / 105,
  penaltySpot: 11 / 105,
  goalWidth: 7.32 / 105,
  goalHeight: 2.44 / 105,
  /**
   * How far the net reaches back behind the goal line.
   *
   * The Laws do not fix this — they only require the net to be "adequately
   * supported" — so 2.4 m is taken from the goal frames actually in use, which
   * run 2.0-2.5 m deep at ground level. It matters here for a reason the Laws
   * do not care about: this depth is what the goal sensor lives in, and a
   * shallower box would give a ball arriving at three units per step nowhere to
   * come to rest.
   */
  netDepth: 2.4 / 105,
  /** Post diameter. Real posts are 12 cm; ours are fattened for the solver. */
  postRadius: 0.18 / 105,
  /** Line width, for the drawn markings only. */
  lineWidth: 0.12 / 105,
};

/**
 * Chord segments per quarter-turn of a rounded corner.
 *
 * Four, and the reasoning is the skirt ring's in `capCollider.js`: the polygon
 * is INSCRIBED, so its vertices sit on the true arc and its faces sit a little
 * inside it. That means the boundary can only ever be tighter than the arc, not
 * looser — no spur pokes out into the pitch at a seam — and the two ends of the
 * fan land exactly on the straight walls they join.
 *
 * At the default 6-unit radius the faces bow 0.11 units in from the arc, which
 * is a tenth of a pixel on screen and a sixth of a ball. Going to eight segments
 * would quarter that and double the collider count for something nobody can see.
 */
export const CORNER_SEGMENTS = 4;

/**
 * How many ball diameters deep the net must be, at minimum.
 *
 * One diameter is what it takes for the ball to be wholly behind the goal line
 * — the Law's own test — and one alone would have it touching the netting at
 * the exact instant it qualified. The extra half is somewhere to come to rest,
 * which is the job the `netDepth` note has always claimed for this dimension.
 */
const NET_BALL_DEPTHS = 1.5;

/**
 * @param {number} length  pitch length in world units (cm)
 * @param {object} [opts]
 * @param {number} [opts.fenceHeight]     visible boundary fence
 * @param {number} [opts.fenceThickness]
 * @param {number} [opts.cornerRadius]    fillet on the four boundary corners
 * @param {number} [opts.ballDiameter]    floors the net depth; see `netDepth`
 * @returns a flat record of world-unit dimensions
 */
export function pitchMetrics(length, opts = {}) {
  const L = Math.max(20, length);
  const width = L * F.width;

  const halfLength = L * 0.5;
  const halfWidth = width * 0.5;

  /**
   * The goal, and the one place a Law is deliberately not followed.
   *
   * Everything else on this pitch is the reference figure times the length, and
   * `goalScale` is the exception: a straight multiplier on the real 7.32 x 2.44,
   * because a goal at true scale is 5.9 units wide against a keeper 3.2 units
   * across standing on the line, and the game that produces is harder than it is
   * interesting.
   *
   * Width, height AND depth scale together. Widening alone would leave a 4:1
   * letterbox where a goal should be about 3:1, and the height costs nothing —
   * the ball peaks at about 0.65 units, so the crossbar is not what is stopping
   * anyone. Depth used to be left out of that and it was the odd one: a goal
   * scaled 2.4x across and up but still at the Laws' depth is a slot, not a goal,
   * and it is the dimension the BALL has to fit into.
   *
   * It does not touch the pitch. `RATIO`, the touchlines, the areas and the
   * spots are all still the Laws' figures, and `width / length` still comes out
   * at exactly 68/105.
   */
  const goalScale = Math.max(0.2, opts.goalScale ?? 1);
  const goalWidth = L * F.goalWidth * goalScale;
  const goalHeight = L * F.goalHeight * goalScale;

  /**
   * ── the net has to be deeper than the ball is wide ───────────────────────
   * The Laws' figure is 2.4 m of depth on a 105 m pitch, and on its own that is
   * the right number for a real ball — which is 22 cm across, a ninth of the
   * goal's depth. This ball is not that ball. It is sized against the CAPS so
   * the two can knock each other about, which at the defaults makes it 1.92
   * units wide on a 64-unit pitch: proportionally about fourteen times a real
   * football, and wider than the 1.46 units of net the Laws' fraction produced.
   *
   * A goal shallower than the ball is not a goal the ball can go into. The
   * sphere's own back was still outside the frame when its front hit the netting,
   * so "the whole of the ball has passed the line" — the actual Law, and what
   * the sensor was originally written against — could not be satisfied at any
   * position on this pitch, and a ball that scored had to be wedged into the
   * back of the net to be seen at all.
   *
   * So the depth is floored against the ball rather than only derived from the
   * pitch: enough for the ball to be wholly behind the line with a radius to
   * spare, so it can come to rest in there instead of resting on the frame. The
   * pitch-derived figure still wins whenever it is the larger of the two, which
   * at the shipped `goalScale` of 2.4 it is.
   */
  const ballDiameter = Math.max(0, opts.ballDiameter ?? 0);
  const netDepth = Math.max(L * F.netDepth * goalScale, ballDiameter * NET_BALL_DEPTHS);
  const penaltyAreaHalfWidth = L * F.penaltyAreaWidth * 0.5;

  /**
   * The strip of ground outside the touchlines, and the walls sit at ITS edge.
   *
   * This is the shape change that makes a ball against the wall survivable. With
   * the barrier standing on the touchline, a ball that came to rest against it
   * was in a place no cap could get behind — the wall occupied the whole half
   * of the approach — and no amount of restitution or friction fixes that,
   * because it is a fact about where the wall is rather than about how it
   * behaves. Pushing the wall out by more than a cap's width means every
   * resting place the ball can reach has room for a cap on every side of it.
   *
   * The pitch itself is untouched: still 105:68, still marked by the lines the
   * out rule is judged against. What is outside them is run-off, exactly as it
   * is at a real ground, and a ball that stops out there is brought back.
   */
  const runoff = Math.max(0, opts.runoffWidth ?? 0);
  const outerHalfX = halfWidth + runoff;
  const outerHalfZ = halfLength + runoff;

  return {
    length: L,
    width,
    halfLength,
    halfWidth,

    /**
     * The axis mapping, and the only statement of it.
     *
     * `halfLength`/`halfWidth` are facts about the PITCH; `halfX`/`halfZ` are
     * facts about where it lies in the world. Keeping them separate is what
     * makes standing the pitch up a two-line change instead of a hunt through
     * every coordinate in the layout.
     */
    halfX: halfWidth,
    halfZ: halfLength,

    /**
     * The run-off, and the wall's own half-extents.
     *
     * `halfX`/`halfZ` are the LINES — what the out rule is judged against and
     * what the markings draw. `outerHalfX`/`outerHalfZ` are the WALLS. Keeping
     * both named stops the two ideas from being confused again: for most of this
     * mode's life they were the same rectangle, and the whole of this change is
     * that they are not.
     */
    runoff,
    outerHalfX,
    outerHalfZ,

    centreCircleRadius: L * F.centreCircleRadius,
    penaltyAreaDepth: L * F.penaltyAreaDepth,
    penaltyAreaHalfWidth,
    goalAreaDepth: L * F.goalAreaDepth,
    goalAreaHalfWidth: L * F.goalAreaWidth * 0.5,
    penaltySpot: L * F.penaltySpot,

    goalScale,
    goalWidth,
    goalHalfWidth: goalWidth * 0.5,
    goalHeight,
    netDepth,
    postRadius: Math.max(0.06, L * F.postRadius),
    lineWidth: Math.max(0.05, L * F.lineWidth),

    /** Visible boundary fence. Not a pitch dimension — a game one. */
    fenceHeight: opts.fenceHeight ?? Math.max(1.2, L * 0.028),
    fenceThickness: opts.fenceThickness ?? Math.max(0.3, L * 0.007),

    /**
     * Fillet on the four WALL corners — the outer rectangle, not the pitch.
     *
     * A square corner is a trap, and not because it is tight: it is two
     * constraints meeting at a point, so every strike from the field drives the
     * ball further in and pushing it along one wall runs it into the other. An
     * arc has only one wall in contact at a time, so any roughly-sideways hit
     * sends the ball out along it.
     *
     * The run-off answers the same complaint from the other side and they are
     * worth keeping together: the run-off means a cap can always get behind the
     * ball, the fillet means the ball is never wedged between two walls, and the
     * out rule catches whatever is left.
     *
     * Clamped so it cannot eat into the pitch — see `clampCorner`.
     */
    cornerRadius: clampCorner(opts.cornerRadius ?? 0, outerHalfZ, outerHalfX, runoff),

    /**
     * Lid on the whole enclosure.
     *
     * The fence is low because the brief asks for a low fence, and a low fence
     * cannot on its own honour "공과 병뚜껑 모두 맵 밖으로 나갈 수 없다" — caps
     * tumble and hop, and a full-charge impulse carries enough energy to clear
     * anything short enough to see over. So the arena is a closed box: fence you
     * can see, ceiling you cannot, and nothing leaves by either route. Set well
     * clear of normal play, so it is a guarantee rather than a surface the game
     * is played against.
     */
    ceilingHeight: Math.max(6, L * 0.11),
  };
}

/**
 * How much fillet the wall can take.
 *
 * The binding one is the PITCH CORNER. The fillet is centred at
 * `(outerHalfX - r, outerHalfZ - r)`, so the pitch's own corner sits a distance
 * `sqrt(2)*|r - runoff|` from it and has to stay inside the arc — otherwise the
 * barrier cuts across a corner of the marked field and a ball that is in play by
 * the lines is behind a wall. Solving `sqrt(2)(r - runoff) <= r` gives the
 * multiple below: a fillet may be about three and a half times the run-off and
 * no more. On the defaults that is 19 against a fillet of 7.
 *
 * The second ceiling just leaves a straight for the fans to join at either end.
 */
function clampCorner(r, outerHalfZ, outerHalfX, runoff) {
  const fromPitch = runoff * (Math.SQRT2 / (Math.SQRT2 - 1));
  const max = Math.min(fromPitch, outerHalfZ * 0.4, outerHalfX * 0.6);
  return Math.min(Math.max(0, r), Math.max(0, max));
}

/**
 * The four corner fillets of the WALL, as chord segments in world space.
 *
 * On the outer rectangle, not the pitch: the barrier moved out past the run-off
 * and the painted touchline stayed where it was, so these are the wall's corners
 * and nothing draws a line along them. `FootballPitch` turns each segment into a
 * collider and `PitchView` into a fence panel.
 *
 * @returns {Array<{x: number, z: number, angle: number, halfLen: number,
 *   from: [number, number], to: [number, number]}>}
 *   `x, z` is the midpoint of the chord's INNER face; `angle` is the outward
 *   normal's bearing in the xz plane; `from`/`to` are its endpoints, which lie
 *   exactly on the arc.
 */
export function cornerChords(m) {
  const out = [];
  const R = m.cornerRadius;
  if (R <= 0.01) return out;

  const n = CORNER_SEGMENTS;
  const quarter = Math.PI / 2;
  const half = quarter / n / 2;
  /** Inscribed: the face sits this far from the centre, its ends on the arc. */
  const faceR = R * Math.cos(half);
  const halfLen = R * Math.sin(half);

  // Walked as a loop, not as four independent corners: consecutive quadrants
  // are traversed in opposite angular directions so that each fan ENDS where
  // the straight leading to the next one BEGINS. `boundaryPolygon` reads this
  // order straight out and gets a closed outline with no bookkeeping of its own.
  const quadrants = [
    { sx: 1, sz: 1, a0: 0, a1: quarter },
    { sx: -1, sz: 1, a0: quarter, a1: 0 },
    { sx: -1, sz: -1, a0: 0, a1: quarter },
    { sx: 1, sz: -1, a0: quarter, a1: 0 },
  ];

  for (const q of quadrants) {
    const cx = q.sx * (m.outerHalfX - R);
    const cz = q.sz * (m.outerHalfZ - R);
    const at = (t) => [cx + q.sx * R * Math.cos(t), cz + q.sz * R * Math.sin(t)];
    for (let i = 0; i < n; i++) {
      const t0 = q.a0 + ((q.a1 - q.a0) * i) / n;
      const t1 = q.a0 + ((q.a1 - q.a0) * (i + 1)) / n;
      const mid = (t0 + t1) * 0.5;
      const ux = q.sx * Math.cos(mid);
      const uz = q.sz * Math.sin(mid);
      out.push({
        x: cx + ux * faceR,
        z: cz + uz * faceR,
        angle: Math.atan2(uz, ux),
        halfLen,
        from: at(t0),
        to: at(t1),
      });
    }
  }
  return out;
}

/**
 * The WALL as a closed polyline: straights, then the corner chords.
 *
 * Not the touchline. The pitch's own outline is a plain rectangle with square
 * corners — it is paint, and paint has corners — and it is `pitchMarkings` that
 * draws it.
 */
export function boundaryPolygon(m) {
  const R = m.cornerRadius;
  if (R <= 0.01) {
    return [
      [-m.outerHalfX, -m.outerHalfZ],
      [m.outerHalfX, -m.outerHalfZ],
      [m.outerHalfX, m.outerHalfZ],
      [-m.outerHalfX, m.outerHalfZ],
    ];
  }
  const chords = cornerChords(m);
  const n = CORNER_SEGMENTS;
  const pts = [];
  // Quadrant order matches `cornerChords`, so consecutive fans are already
  // joined by the straight between them and the loop closes on itself.
  for (let q = 0; q < 4; q++) {
    for (let i = 0; i < n; i++) {
      const c = chords[q * n + i];
      pts.push(c.from);
      if (i === n - 1) pts.push(c.to);
    }
  }
  return pts;
}

/**
 * Where the four static line groups go, as plain polylines in world space.
 *
 * Shared by the renderer and by nothing else — the markings have no colliders,
 * as specified — but they live next to the metrics rather than in `render/` so
 * that a marking can never be drawn somewhere the physics does not agree with.
 *
 * @returns {{loops: number[][][], circles: Array, spots: Array}}
 */
export function pitchMarkings(m) {
  /**
   * A box measured the way the Laws measure it: `across` is half its extent
   * along the goal line, `depth` is how far it reaches out from the goal line
   * `end` (−1 or +1) into the pitch.
   *
   * Written in those terms rather than as raw (x, z) so that standing the pitch
   * up did not mean transposing four rectangles by hand and getting one of them
   * wrong — which is a mistake that draws a plausible pitch with the penalty
   * area in the wrong place.
   */
  const box = (end, across, depth) => [
    [-across, end * m.halfZ],
    [across, end * m.halfZ],
    [across, end * (m.halfZ - depth)],
    [-across, end * (m.halfZ - depth)],
  ];

  const loops = [
    // Touchlines and goal lines: the 105:68 rectangle, square corners, exactly
    // where the out rule is judged. It used to follow the fence's fillet because
    // the fence stood on it; the fence is out past the run-off now and this is
    // paint again.
    [
      [-m.halfX, -m.halfZ],
      [m.halfX, -m.halfZ],
      [m.halfX, m.halfZ],
      [-m.halfX, m.halfZ],
    ],
    // Penalty areas.
    box(-1, m.penaltyAreaHalfWidth, m.penaltyAreaDepth),
    box(1, m.penaltyAreaHalfWidth, m.penaltyAreaDepth),
    // Goal areas.
    box(-1, m.goalAreaHalfWidth, m.goalAreaDepth),
    box(1, m.goalAreaHalfWidth, m.goalAreaDepth),
  ];

  return {
    loops,
    /** The halfway line, as an open segment list. Across the pitch, so along X. */
    segments: [[[-m.halfX, 0], [m.halfX, 0]]],
    circles: [{ x: 0, z: 0, r: m.centreCircleRadius }],
    spots: [
      { x: 0, z: 0 },
      { x: 0, z: -m.halfZ + m.penaltySpot },
      { x: 0, z: m.halfZ - m.penaltySpot },
    ],
  };
}

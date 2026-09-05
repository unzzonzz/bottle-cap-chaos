/**
 * The bottle's silhouette, as numbers.
 *
 * Pure: parameters in, an array of profile rows out. No three.js, no geometry,
 * nothing that has to be disposed — the same split `capGeometry` uses, and for
 * the same reason: the shape is the thing that gets argued about, and it should
 * be possible to change it without touching a buffer.
 *
 * ── it is a long-neck cider bottle, and the neck is the whole job ───────────
 * Bottom to top: a short heel, a STRAIGHT cylindrical body, a short round
 * shoulder, a long straight neck, and a crown finish. The neck is about 23% of
 * the total height, which is what separates this silhouette from a soft-drink
 * bottle: the eye reads the ratio of neck to body long before it reads anything
 * else about the shape.
 *
 * ── it used to be a contour bottle, and every part of that is gone ──────────
 * Worth stating because the numbers below look arbitrary otherwise. The previous
 * shape was a contour bottle whose defining feature was a WAIST pinching to 85%
 * of the upper body, with ten vertical flutes running up it, a short neck, and a
 * label banded all the way round. All four are deliberately removed:
 *
 *   - `waistRatio` is 1.0. Three body control points at the same radius make the
 *     spline a straight line, which is the point — a cider bottle is a cylinder.
 *   - `ribDepth` is 0. The flutes are switched off at the amplitude rather than
 *     deleted, so the machinery survives for anything that wants it back. Same
 *     discipline as `mode.cards === false` turning cards off with the code left
 *     standing. `ribs` KEEPS its value — see `columns`.
 *   - `neckLength` went 12 -> 32.
 *   - the label is a front decal on a partial arc, not a band. See `labelSweep`.
 *
 * ── the parts are built by different maths, on purpose ──────────────────────
 * The BODY is a Catmull-Rom through five control points, resampled by arc
 * length. With every control point now at the same radius that resampling has
 * little to do, and it is kept because the heel still bends and because a
 * profile change should not also be a change of curve type.
 *
 * The SHOULDER is an S: it leaves the body vertically and arrives at the neck
 * vertically. A circular or superelliptic quadrant cannot do that — one end of a
 * quadrant is always horizontal, and a horizontal tangent at the neck is a
 * shelf, not a shoulder.
 *
 * The FINISH is an explicit point list. A crown finish is TOOLED glass: two
 * beads and an undercut between them, with corners that are meant to be corners.
 * Running a spline through it would round off the one part of the bottle whose
 * job is to be square enough for a cap to grip.
 *
 * ── the finish is FROZEN ────────────────────────────────────────────────────
 * `beadRadius`, `lipRadius`, `boreRadius`, `finishHeight` and `neckRadius` are
 * not adjustable. The cap that goes on this bottle is the same geometry the
 * three game modes throw — `capGeometry.js`, 32 mm across the crests — so a
 * finish that drifts is a cap that either floats above the bottle or sinks into
 * it, and a menu cap that is a different object from the game's. `neckLength`
 * may move freely; `neckRadius` may not.
 *
 * Units are millimetres throughout, as in `capGeometry`, and the conversion to
 * world units is that module's `MM`.
 */

export const BOTTLE_DEFAULTS = {
  // ── the body ─────────────────────────────────────────────────────────────
  /** Across the flat bottom. Rises to the body radius over `heelHeight`. */
  baseRadius: 29.2,
  /** The short foot. Enough to read as a heel and no more. */
  heelHeight: 3.0,
  /**
   * The lower, waist and upper body control points.
   *
   * All three at 30.0, which is the entire silhouette decision: a Catmull-Rom
   * through collinear points IS a straight line, so the body is a true cylinder
   * of 60 mm diameter with no residual bulge. The three y values are spread
   * evenly so the arc-length resampling puts rows at even heights rather than
   * bunching them where curvature used to be.
   */
  lowerRadius: 30.0,
  lowerY: 40,
  /**
   * The pinch, as a fraction of the upper body. ONE — there is no pinch.
   *
   * Kept as a parameter rather than deleted so the contour shape is one number
   * away, and because `buildBottleProfile` reports `waistRadius` to callers.
   */
  waistRatio: 1.0,
  waistY: 84,
  /** The body radius. 60 mm diameter against 200 mm tall — 3.33 : 1. */
  bodyRadius: 30.0,
  bodyY: 112,
  /** How far the body carries on above its widest point before the shoulder. */
  bodyRun: 16,

  // ── the shoulder ─────────────────────────────────────────────────────────
  /** Short. A cider bottle turns into its neck quickly. */
  shoulderHeight: 26,
  /**
   * Where the bend happens, 0..1.
   *
   * 0 starts turning in immediately off the body — a round, sloping shoulder.
   * 1 carries the body up and turns late — a square one. Low, because the
   * reference shoulder is round and short.
   */
  shoulderCurve: 0.26,

  // ── the neck ─────────────────────────────────────────────────────────────
  /** FROZEN. The finish starts here and the cap has to fit it. */
  neckRadius: 12.2,
  /** How much wider the neck is at its BASE. More, now the neck is long. */
  neckFlare: 2.2,
  /** Long. With the 14 mm finish on top this is 46 mm, 23% of the bottle. */
  neckLength: 32,

  // ── the crown finish — FROZEN, see the header ────────────────────────────
  /**
   * The bead the cap crimps under. A standard crown finish is 27.4 mm across
   * it, against 32 mm across the cap's crests — so the skirt overhangs, and it
   * is meant to.
   */
  beadRadius: 14.0,
  /** The lip ring above the undercut — the sealing face. */
  lipRadius: 13.6,
  finishHeight: 14,
  /** The bore. Never seen with a cap on, but it closes the mesh. */
  boreRadius: 10.4,

  // ── the flutes, switched off ─────────────────────────────────────────────
  /**
   * The flute count. KEPT at 10 even though the amplitude is zero.
   *
   * Setting this to 0 to "remove" the flutes is a trap the geometry used to
   * fall into: the column count was `ribs * radialPerRib` clamped to a minimum
   * of 6, so `ribs: 0` produced a SIX-SIDED bottle. Tessellation is `columns`
   * now and has nothing to do with this number, but the value is left standing
   * so that turning the flutes back on is one edit to `ribDepth`.
   */
  ribs: 10,
  /** Zero. The reference glass is completely smooth. */
  ribDepth: 0,
  ribFrom: 10,
  ribTo: 152,
  /** How far the flutes take to die out at each end of their band. */
  ribFade: 5,

  // ── the label decal ──────────────────────────────────────────────────────
  /**
   * A tall oval on the FRONT, not a band round the bottle.
   *
   * 66 mm of the bottle's 200 — a third of it — which is what makes the label
   * the thing you read rather than a stripe you notice.
   */
  labelFrom: 60,
  labelTo: 126,
  /** How far the label mesh stands off the glass. Thinner than a band. */
  labelOffset: 0.3,
  /** One. The artwork maps across the arc exactly once. */
  labelPanels: 1,
  /**
   * The arc the label occupies, in degrees.
   *
   * 360 is the old band. At 160 the decal covers only the front, which is what
   * a printed oval label does — and it means the whole texture is spent on the
   * oval instead of 78% of it being transparent margin. The same resolution for
   * 22% of the texels.
   *
   * `buildLabelGeometry` centres this on the camera-facing side; see the note
   * there about why the arc is 10..170 degrees and not 0..160.
   */
  labelSweep: 160,
  /**
   * The oval's width in mm — 70% of the body diameter.
   *
   * Its HEIGHT is decided by `labelTo - labelFrom`. This is only used by the
   * texture, to work out how much of the page the oval covers; the mesh is a
   * plain arc and the transparent margin is what shapes it.
   */
  labelOvalWidth: 42,

  // ── the contents ─────────────────────────────────────────────────────────
  /**
   * Where the drink stops. In the STRAIGHT BODY, and that is the whole point.
   *
   * ── 150 was mid-shoulder, and mid-shoulder is the worst place there is ────
   * It sat at 85% of the way from `shoulderStart` (128) to `neckBase` (154),
   * which is exactly where the envelope's curvature peaks. Everything that went
   * wrong with the liquid went wrong because of that one number:
   *
   *   - the surface ring is the TOP ROW of the liquid's side wall, and the row
   *     under it is the last profile row below the fill — at 150 that was
   *     146.57. Tilt the surface and slosh it and that one quad has to span
   *     146.57 to ~163 as a single flat chord, while the glass beside it is
   *     falling from 19.1 mm to 13.9 mm along an S. The chord's ENDS are
   *     clamped inside the glass; its MIDDLE is not, and there is no clamp that
   *     can fix that because there is no vertex there to clamp.
   *   - measured, by walking the chord against `envelopeAt`: at the shipped
   *     lean of 22 degrees with the slosh at its 7 mm limit, the chord stood
   *     1.58 mm OUTSIDE the glass. At 10 degrees with no slosh at all it was
   *     already 0.02 mm out. The earlier note in `Bottle._slosh` estimated
   *     0.5 mm; it was reading the vertex, not the face between two of them.
   *   - `solve()` in `Bottle._slosh` had to iterate against a steep envelope,
   *     and the residual after its twelve passes was 0.05 mm at 140 and rising.
   *
   * ── 130 is in the body, where the envelope is flat ───────────────────────
   * `waistRatio` is 1.0 and every body control point is 30.0, so from the heel
   * to `shoulderStart` the profile is a straight line to within 0.14 mm — the
   * residual wobble of a Catmull-Rom that also has to leave a 29.2 mm heel.
   * The slope there is 0.008 mm/mm against 1.0 mm/mm mid-shoulder.
   *
   * With the envelope flat, the chord has no curve to cut across: the same walk
   * measures 0.75 mm of CLEARANCE at 22 degrees and 7 mm of slosh, and still
   * 0.43 mm at 35 degrees — well past any lean this bottle reaches. `solve()`
   * starts within 0.07 mm of its own answer and lands at a 2 micron residual.
   *
   * ── why 130 and not further down the body ────────────────────────────────
   * Because the label is `labelFrom` 60 to `labelTo` 126, on a 160 degree arc
   * across the FRONT, and it is opaque. Put the fill line inside that band and
   * the drink's surface — and the slosh that `Bottle._slosh` spends a hundred
   * lines computing — is hidden behind cardboard from the only angle the menu
   * camera ever sees. 130 clears the label's top edge by 4 mm.
   *
   * It is 2 mm past `shoulderStart`, which sounds wrong and is not: the S
   * leaves the body VERTICALLY (see the header), so the radius at 130 is
   * 29.73 — 99.1% of the body — and the slope is still only 0.06 mm/mm. The
   * curvature that broke 150 has not started yet.
   *
   * Not 128 exactly, even though that is the named landmark: there is a profile
   * row at exactly 128.00, and `buildLiquidGeometry` selects rows with
   * `row.y < fill`. Landing the fill on a row makes that comparison decide the
   * mesh, and it would decide it on the last bit of a float.
   */
  fillLevel: 130,
  /**
   * 액체 반지름이 유리 외피의 몇 배인가.
   *
   * 0.92 는 유리 벽에서 8% 떨어진 값이라, 맑아진 유리 너머로 액체와 벽 사이의
   * 빈 껍질이 보였다. 실제 음료는 벽에 닿아 있다. 0.96 은 유리 두께만큼만
   * 안쪽이다.
   */
  liquidInset: 0.96,

  // ── tessellation ─────────────────────────────────────────────────────────
  /**
   * Columns around the bottle. Split from the flute count deliberately.
   *
   * It used to be `ribs * radialPerRib`, which made sense while the tessellation
   * existed to resolve the flutes — four columns per rib put a vertex on every
   * crest and every trough. With the flutes off it is a pure smoothness number
   * and tying it to `ribs` is how you get a hexagonal bottle by setting a flute
   * count to zero.
   *
   * 72 gives a 2.6 mm edge on a 30 mm radius: below the point where either the
   * smooth shading or a clearcoat highlight shows the facets.
   */
  columns: 72,
  bodyRows: 8,
  /** More than the body's. The shoulder is where all the curvature now is. */
  shoulderRows: 7,
};

/** Where the flutes fade in and out, as a smooth 0..1 gate. */
const gate = (x) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const axis = (a, b, c, d) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { r: axis(p0.r, p1.r, p2.r, p3.r), y: axis(p0.y, p1.y, p2.y, p3.y) };
}

/**
 * Walk a Catmull-Rom through `points` and hand back `count` rows spaced by ARC
 * LENGTH rather than by parameter.
 *
 * The difference is visible: the control points are far apart down the straight
 * lower body and close together through the waist, so uniform-in-parameter
 * sampling spends its rows where the profile is a straight line and starves the
 * one curve the silhouette is judged on.
 */
function resample(points, count) {
  const ctrl = [points[0], ...points, points[points.length - 1]];

  // Dense first, measured, then thinned. Cheaper to write than an analytic
  // arc-length parameterisation and exact enough at this density.
  const dense = [];
  const perSpan = 24;
  for (let i = 0; i < ctrl.length - 3; i++) {
    for (let s = 0; s < perSpan; s++) {
      dense.push(catmullRom(ctrl[i], ctrl[i + 1], ctrl[i + 2], ctrl[i + 3], s / perSpan));
    }
  }
  dense.push(points[points.length - 1]);

  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    cumulative.push(
      cumulative[i - 1] + Math.hypot(dense[i].r - dense[i - 1].r, dense[i].y - dense[i - 1].y),
    );
  }
  const total = cumulative[cumulative.length - 1] || 1;

  const out = [];
  let cursor = 0;
  for (let k = 0; k < count; k++) {
    const want = (k / (count - 1)) * total;
    while (cursor < cumulative.length - 2 && cumulative[cursor + 1] < want) cursor++;
    const span = cumulative[cursor + 1] - cumulative[cursor] || 1;
    const f = (want - cumulative[cursor]) / span;
    out.push({
      r: dense[cursor].r + (dense[cursor + 1].r - dense[cursor].r) * f,
      y: dense[cursor].y + (dense[cursor + 1].y - dense[cursor].y) * f,
    });
  }
  return out;
}

/**
 * @param {Partial<typeof BOTTLE_DEFAULTS>} [params]
 * @returns {{rows: {r: number, y: number, rib: number}[], height: number,
 *            waistRadius: number, mouthY: number, neckTop: number,
 *            envelopeAt: (y: number) => number}}
 *   `rows` is bottom to top, which is the winding the lathe below depends on.
 */
export function buildBottleProfile(params = {}) {
  const p = { ...BOTTLE_DEFAULTS, ...params };

  const bodyRadius = Math.max(6, p.bodyRadius);
  const waistRadius = bodyRadius * Math.min(0.99, Math.max(0.6, p.waistRatio));
  const shoulderStart = p.bodyY + Math.max(0, p.bodyRun);
  const neckBase = shoulderStart + Math.max(2, p.shoulderHeight);
  const neckTop = neckBase + Math.max(2, p.neckLength);
  const height = neckTop + Math.max(4, p.finishHeight);

  /** @type {{r: number, y: number}[]} */
  const pts = [];

  // ── the heel ─────────────────────────────────────────────────────────────
  // Two rows and no more. A heel with rows to spare turns into a taper, and a
  // bottle with a tapered foot does not sit on a table.
  pts.push({ r: p.baseRadius, y: 0 });
  pts.push({ r: p.baseRadius + 0.8, y: p.heelHeight });

  // ── the body ─────────────────────────────────────────────────────────────
  // The first control point repeats the heel's top so the spline leaves it
  // continuously; `resample` returns that row again, so it is dropped.
  const body = resample(
    [
      { r: p.baseRadius + 0.8, y: p.heelHeight },
      { r: p.lowerRadius, y: p.lowerY },
      { r: waistRadius, y: p.waistY },
      { r: bodyRadius, y: p.bodyY },
      // Barely narrower than the widest point, so the profile is still climbing
      // near-vertically where the shoulder takes over from it.
      { r: bodyRadius * 0.995, y: shoulderStart },
    ],
    Math.max(4, Math.round(p.bodyRows)),
  );
  for (let i = 1; i < body.length; i++) pts.push(body[i]);

  // ── the shoulder ─────────────────────────────────────────────────────────
  // Vertical at both ends — see the header. `bias` only moves where the middle
  // of the S sits; it never breaks either tangent, which is why it is clamped
  // at 1 from below.
  const shoulderRows = Math.max(3, Math.round(p.shoulderRows));
  const bias = 1 + Math.min(1, Math.max(0, p.shoulderCurve)) * 1.4;
  const neckFoot = p.neckRadius + p.neckFlare;
  for (let i = 1; i <= shoulderRows; i++) {
    const t = i / shoulderRows;
    const u = Math.pow(t, bias);
    const s = u * u * (3 - 2 * u);
    pts.push({
      r: bodyRadius * 0.995 + (neckFoot - bodyRadius * 0.995) * s,
      y: shoulderStart + (neckBase - shoulderStart) * t,
    });
  }

  // ── the neck ─────────────────────────────────────────────────────────────
  pts.push({ r: p.neckRadius, y: neckTop });

  // ── the finish ───────────────────────────────────────────────────────────
  // Tooled glass, as fractions of `finishHeight` so the whole thing scales with
  // one slider. Corners stay corners.
  //
  // The features are packed into the TOP of the finish on purpose. A crown cap
  // has about six millimetres of skirt and it crimps under a bead a few
  // millimetres below the lip; spread the bead and the lip over the full
  // fourteen and the cap can only reach the top third of it, which on screen is
  // a cap hovering over a bare glass tube.
  const f = height - neckTop;
  const finish = [
    [p.neckRadius + 0.6, 0.18],
    [p.beadRadius, 0.36],
    [p.beadRadius, 0.56],
    // The undercut. This is the gap the crimp folds into, and without it the
    // finish is a plain tube with a cap balanced on top of it.
    [p.neckRadius + 0.3, 0.66],
    [p.lipRadius, 0.76],
    [p.lipRadius, 0.94],
    [p.boreRadius, 1.0],
  ];
  for (const [r, t] of finish) pts.push({ r, y: neckTop + f * t });

  // ── the flute band ───────────────────────────────────────────────────────
  const fade = Math.max(0.5, p.ribFade);
  const rows = pts.map((pt) => {
    const inBand = gate((pt.y - p.ribFrom) / fade) * gate((p.ribTo - pt.y) / fade);
    // The label wraps smooth glass. Cut, not faded to a compromise: a flute
    // half-present under a label edge is a moulding fault, not a highlight.
    const clearOfLabel =
      1 - gate((pt.y - (p.labelFrom - fade)) / fade) * gate(((p.labelTo + fade) - pt.y) / fade);
    return { r: pt.r, y: pt.y, rib: inBand * clearOfLabel };
  });

  /** The outer silhouette at a height, by linear search. Used to sit the label
   *  and the liquid against the glass without duplicating the profile maths. */
  const envelopeAt = (y) => {
    if (y <= rows[0].y) return rows[0].r;
    for (let i = 1; i < rows.length; i++) {
      if (y <= rows[i].y) {
        const span = rows[i].y - rows[i - 1].y || 1;
        const t = (y - rows[i - 1].y) / span;
        return rows[i - 1].r + (rows[i].r - rows[i - 1].r) * t;
      }
    }
    return rows[rows.length - 1].r;
  };

  /**
   * `neckTop` is reported because the DRINK stops there.
   *
   * `buildLiquidGeometry` fills the bottle to this height and lets a clip plane
   * decide where the liquid actually ends — so it needs to know where the glass
   * stops being a vessel and starts being a finish. Above this the profile is
   * the tooled crown: two beads, an undercut and a bore, none of which is a
   * shape any liquid is ever inside of.
   *
   * It is also the last height below which `rows` is safe to lathe blindly: the
   * finish's point list doubles back (14.0 -> 12.5 -> 13.6), so a lathe run
   * through it has rows that step outward again.
   */
  return { rows, height, waistRadius, mouthY: height, neckTop, envelopeAt, params: p };
}

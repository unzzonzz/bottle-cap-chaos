/**
 * The bottle's silhouette, as numbers.
 *
 * Pure: parameters in, an array of profile rows out. No three.js, no geometry,
 * nothing that has to be disposed — the same split `capGeometry` uses, and for
 * the same reason: the shape is the thing that gets argued about, and it should
 * be possible to change it without touching a buffer.
 *
 * ── it is a contour bottle, and the contour is the whole job ────────────────
 * Bottom to top: a short heel, a lower body that swells, a WAIST that pinches
 * in, the upper body at its widest with the label wrapped round it, a shoulder
 * that S-curves into a narrow neck, and a crown finish. Miss the waist and the
 * thing reads as a milk bottle; overdo it and it reads as an hourglass. The
 * default is 87% of the upper body, in the middle of the 85–90% the brief asks
 * for.
 *
 * The shape is deliberately NOT anyone's registered bottle. The proportions
 * here are its own — a slightly taller neck, a shallower pinch, a straighter
 * lower body — and the label that goes on it carries this game's name.
 *
 * ── the parts are built by different maths, on purpose ──────────────────────
 * The BODY is a Catmull-Rom through five control points, resampled by arc
 * length so rows land where the curvature is rather than where the parameter
 * happens to be — that is what keeps the waist from being cut by two rows while
 * the straight lower body gets four.
 *
 * The SHOULDER is an S: it leaves the body vertically and arrives at the neck
 * vertically, which is what "부드럽게 벌어지는 곡선 구간" means. A circular or
 * superelliptic quadrant cannot do that — one end of a quadrant is always
 * horizontal, and a horizontal tangent at the neck is a shelf, not a shoulder.
 *
 * The FINISH is an explicit point list. A crown finish is TOOLED glass: two
 * beads and an undercut between them, with corners that are meant to be
 * corners. Running a spline through it would round off the one part of the
 * bottle whose job is to be square enough for a cap to grip.
 *
 * ── the rib weight rides on the row ─────────────────────────────────────────
 * Each row carries `rib`, 0..1, which is how much of the flute amplitude
 * applies there. That is where "라벨 띠 구간에는 리브를 넣지 마라" lives: it is
 * a property of the PROFILE, decided once here, rather than a special case in
 * the mesh builder or — worse — two meshes with a join between them.
 *
 * Units are millimetres throughout, as in `capGeometry`, and the conversion to
 * world units is that module's `MM`.
 */

export const BOTTLE_DEFAULTS = {
  // ── the body ─────────────────────────────────────────────────────────────
  /** Across the flat bottom. */
  baseRadius: 25.6,
  /** The short foot. Enough to read as a heel and no more. */
  heelHeight: 2.6,
  /**
   * Widest point of the LOWER body, below the waist.
   *
   * Nearly as wide as the upper body, and that is what makes the pinch a pinch.
   * The first version had this at 28.8 against an upper body of 31 and a waist
   * of 27, and the waist was then only 6% narrower than the widest thing below
   * it — on a 45-pixel-wide bottle that is one pixel a side and the silhouette
   * read as a straight tube.
   */
  lowerRadius: 30.0,
  lowerY: 36,
  /**
   * The pinch, as a fraction of the upper body.
   *
   * The single most recognisable number on the bottle. The brief's range is
   * 85–90%; this sits at the tight end of it, because the shape has to survive
   * being 45 pixels wide and 5-bit shaded.
   */
  waistRatio: 0.85,
  waistY: 74,
  /** Widest point of the whole bottle. The label wraps this. */
  bodyRadius: 31.0,
  bodyY: 116,
  /** How far the body carries on above its widest point before the shoulder. */
  bodyRun: 20,

  // ── the shoulder ─────────────────────────────────────────────────────────
  shoulderHeight: 34,
  /**
   * Where the bend happens, 0..1.
   *
   * 0 starts turning in immediately off the body — a round, sloping shoulder.
   * 1 carries the body up and turns late — a square one. Both ends of the range
   * still leave and arrive vertically; this only moves the middle.
   */
  shoulderCurve: 0.42,

  // ── the neck ─────────────────────────────────────────────────────────────
  neckRadius: 12.2,
  /** How much wider the neck is at its BASE. "위에서 아래로 완만히 넓어짐". */
  neckFlare: 1.4,
  neckLength: 12,

  // ── the crown finish ─────────────────────────────────────────────────────
  /**
   * The bead the cap crimps under. A standard crown finish is 27.4 mm across
   * it, against 32 mm across the cap's crests — so the skirt overhangs, and it
   * is meant to. Too far under and the cap reads as balanced on top of the
   * bottle rather than gripping it.
   */
  beadRadius: 14.0,
  /** The lip ring above the undercut — the sealing face. */
  lipRadius: 13.6,
  finishHeight: 14,
  /** The bore. Never seen with a cap on, but it closes the mesh. */
  boreRadius: 10.4,

  // ── the flutes ───────────────────────────────────────────────────────────
  /**
   * NOT the cap's 21. That number is a bottling standard about crimping; this
   * one is a moulding choice about how a bottle catches light, and the two have
   * nothing to do with each other.
   */
  ribs: 10,
  /**
   * Half the peak-to-trough, in mm — the same convention as `toothDepth`.
   *
   * At FOUR columns per rib a vertex lands on every crest and every trough, so
   * the groove is twice this and no correction is needed. At three the trough
   * is only sampled at cos(120 degrees) and reaches 75% of it.
   */
  ribDepth: 1.15,
  ribFrom: 10,
  ribTo: 152,
  /** How far the flutes take to die out at each end of their band. */
  ribFade: 5,

  // ── the label band ───────────────────────────────────────────────────────
  /**
   * A little below the widest point rather than centred on it.
   *
   * Centred, the band's fade-out reached 138 mm and the shoulder starts at 136,
   * so every flute above the label was on the SHOULDER and the upper body had
   * none at all — which is not the "몸통 상하부" the brief asks for. Dropping it
   * leaves a band of body above the label for the flutes to come back on.
   */
  labelFrom: 94,
  labelTo: 126,
  /** How far the label mesh stands off the glass. Purely anti-z-fighting. */
  labelOffset: 0.45,
  /** How many times the artwork goes round. 2 = a front panel and a back one. */
  labelPanels: 2,

  // ── the contents ─────────────────────────────────────────────────────────
  /** Where the drink stops. Above the label, below the shoulder's top. */
  fillLevel: 143,
  /** The liquid's radius as a fraction of the glass envelope. */
  liquidInset: 0.9,

  // ── tessellation ─────────────────────────────────────────────────────────
  /**
   * Columns per rib.
   *
   * 4, and it is not interchangeable with 3 here the way it is on the cap. At 3
   * the lathe has exactly three facets per rib, so the facet edges and the rib
   * period are the same frequency: the two alias together and the flutes read
   * as nothing but a coarsely tessellated cylinder. Measured that way on
   * screen — the body came out smooth with the modulation running at full
   * amplitude. At 4 a vertex lands on every crest and every trough and the
   * scallop is a scallop.
   */
  radialPerRib: 4,
  bodyRows: 10,
  shoulderRows: 5,
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
 *            waistRadius: number, mouthY: number, envelopeAt: (y: number) => number}}
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

  return { rows, height, waistRadius, mouthY: height, envelopeAt, params: p };
}

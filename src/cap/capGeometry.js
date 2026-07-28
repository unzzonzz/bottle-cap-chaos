import { BufferGeometry, Float32BufferAttribute } from 'three';

/**
 * The crown cap, generated from numbers. No model files anywhere.
 *
 * Pure: hand it a params object, get a BufferGeometry back. It owns no three.js
 * state beyond the geometry it returns, so the three game modes can each call it
 * with their own numbers (or the same ones) without going through the viewer.
 *
 * ── what a real crown cap actually is ──────────────────────────────────────
 * A flat-ish panel about 26.5 mm across, a skirt about 6 mm deep, and 21 flutes
 * crimped into that skirt. 21 is not a style choice — it is the standard, and
 * it is odd on purpose so opposing teeth never line up and the crimp grips
 * evenly. The crests of those flutes are the widest part of the whole object, at
 * about 32 mm, which is why `capDiameter` is measured across them and not across
 * the panel.
 *
 * The flutes are REAL POLYGONS, not a normal map. Radius is modulated around the
 * cap as `r(theta) = base + amp * cos(teeth * theta)`, with `amp` ramped from
 * zero at the panel junction to its maximum at the hem — which is what makes the
 * crimp look like it opens up as it comes down, the way a bent one does.
 *
 * `base` is NOT an independent taper. It is `envelope - amp`, where the envelope
 * is the outer silhouette, and getting this wrong is the difference between a
 * bottle cap and a lampshade. Ramping `amp` against a base that tapers on its own
 * puts the crests on a line that leans outward all the way down — a cone with a
 * frilled hem. Pinning the crests to the envelope instead makes them near-
 * vertical and sends the TROUGHS inward as they descend, which is what a crimp
 * actually is: metal pressed in, not ribs pulled out. Same formula either way;
 * only the definition of `base` differs.
 *
 * ── the shell ─────────────────────────────────────────────────────────────
 * `shell: true` builds the inside as well: the sheet's own edge at the hem, the
 * inner skirt wall carrying the same flutes offset inward, the underside of the
 * panel, and the liner pad sitting on it. That is roughly double the triangles
 * and none of it is ever visible with the cap the right way up, so it is a
 * parameter rather than a fact — the customiser builds with it, the game modes
 * build without it and stay inside the 1500 budget.
 *
 * ── units ─────────────────────────────────────────────────────────────────
 * Every parameter is in MILLIMETRES, because that is how the object is actually
 * specified. Output is in world units at 1 unit = 10 mm, so a default cap is
 * 3.2 units across and 0.635 tall. Local space has y = 0 at the hem (the open
 * end) and +y up through the panel, so a cap dropped on a table sits at y = 0.
 *
 * ── budget ────────────────────────────────────────────────────────────────
 * 1176 triangles with the shell off, 2520 with it on. `userData.triangles` is
 * the real number and `userData.gameTriangles` is what the same parameters cost
 * without the shell, which is the one the 1500 ceiling applies to.
 */

const TAU = Math.PI * 2;

/** Millimetres -> world units. */
export const MM = 0.1;

/** Index into the geometry's groups, and into the material array a mesh needs. */
export const CAP_GROUP = { BODY: 0, PANEL: 1, LINER: 2 };

export const CAP_DEFAULTS = {
  // ── shape, in millimetres ────────────────────────────────────────────────
  /** The standard. Parameterised because the game modes may want odd caps. */
  teeth: 21,
  /** Across the flute CRESTS at the hem — the widest point of the object. */
  capDiameter: 32.0,
  /** The flat panel on top. Narrower than the cap; that is what a crown is. */
  topDiameter: 26.4,
  /** Hem to panel. */
  skirtHeight: 6.0,
  /** How far a trough cuts in below the crest, halved. Peak-to-trough is 2x. */
  toothDepth: 0.9,
  /**
   * How the flute opens up on the way down, as an exponent on the ramp.
   * 1 is a straight taper; above 1 holds the crimp tight under the panel and
   * spreads it near the hem, which is what a real one does.
   */
  toothCurve: 1.4,
  /** How far the hem's envelope kicks out past the waist of the skirt. */
  flare: 0.55,
  /** Sagitta of the panel dome. Nearly flat on purpose. */
  domeRise: 0.35,
  /**
   * Vertical extent of the rolled corner between panel and skirt.
   *
   * Generous, because on a real cap this corner is where nearly all of the
   * radial distance between the panel and the skirt gets covered — about 2.2 mm
   * of it. Shrink it and the shoulder becomes a horizontal flange.
   */
  shoulder: 2.0,

  // ── the inside ───────────────────────────────────────────────────────────
  /** Build the interior. Off for gameplay, on for the customiser. */
  shell: true,
  /** Sheet gauge. Real crown stock is about a quarter of a millimetre. */
  wallThickness: 0.25,
  /** How far the liner stops short of the inner wall, leaving bare metal. */
  linerInset: 1.5,
  /** How far the liner pad stands proud of the panel's underside. */
  linerThickness: 0.5,

  // ── tessellation ─────────────────────────────────────────────────────────
  /**
   * Columns per flute. 4 lands one vertex on each crest and each trough, so the
   * modulation is sampled at its full depth. 3 renders the flute as a triangle
   * at 3/4 depth — cheaper, and arguably more period-correct.
   */
  radialPerTooth: 4,
  /** Rows up the straight part of the skirt. */
  skirtSeg: 3,
  /** Rows across the rolled corner. */
  shoulderSeg: 2,
  /** Rings across the panel, apex included. */
  domeSeg: 2,
};

/**
 * How far round its quarter turn the shoulder fillet is allowed to go.
 *
 * NOT 1, and this is the whole reason the cap has a top EDGE. A fillet run to a
 * full quarter turn arrives exactly horizontal, and the panel it hands off to is
 * also very nearly horizontal — so the two meet tangentially and there is no
 * corner there to break the normals across, however hard the split. Stopping the
 * fillet short leaves the shoulder still climbing at about 14 degrees where the
 * panel leaves at 3, and that ~11 degree crease is what reads as the rim.
 */
const SHOULDER_ARC = 0.78;

/**
 * Exponent on the flare.
 *
 * A linear flare over the whole skirt is a cone, and a cone reads as a plant pot.
 * Squaring it holds the wall near-vertical for most of its height and kicks it
 * out only in the last millimetre, which is the shape a crimped hem actually has.
 */
const FLARE_CURVE = 2.2;

/**
 * The ring the bottle's lip presses into the liner: where its centre sits and
 * how wide it is, both as fractions of the liner's radius, and how deep it goes
 * as a fraction of the liner's thickness.
 *
 * The single most recognisable thing about the inside of a used crown cap. A
 * liner without it is a grey circle.
 *
 * The width is what makes or breaks it. Spread the impression over a fifth of
 * the liner and it stops being a groove: the flanks fall to about four degrees,
 * which under Gouraud is no shading break at all, and the whole thing renders as
 * a flat disc that cost 500 triangles. Narrow enough that the flanks sit around
 * fifteen degrees is what puts a visible ring on it.
 */
const SEAL_RADIUS = 0.8;
const SEAL_WIDTH = 0.08;
const SEAL_PRESS = 0.55;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * @param {Partial<typeof CAP_DEFAULTS>} [params]
 * @returns {BufferGeometry} groups per CAP_GROUP: body, panel (the artwork
 *   slot), and — only when `shell` is on — the liner.
 */
export function buildCapGeometry(params = {}) {
  const p = { ...CAP_DEFAULTS, ...params };

  const teeth = Math.max(3, Math.round(p.teeth));
  const cols = teeth * Math.max(2, Math.round(p.radialPerTooth));
  const skirtSeg = Math.max(1, Math.round(p.skirtSeg));
  const shoulderSeg = Math.max(1, Math.round(p.shoulderSeg));
  const domeSeg = Math.max(1, Math.round(p.domeSeg));
  const shell = p.shell !== false;

  // ── the profile, in world units ──────────────────────────────────────────
  // Clamps are guards against a slider being dragged somewhere degenerate, not
  // design decisions; the defaults are nowhere near any of them.
  const capR = Math.max(0.2, p.capDiameter * 0.5 * MM);
  const toothDepth = clamp(p.toothDepth * MM, 0, capR * 0.3);
  const flare = clamp(p.flare * MM, 0, capR * 0.2);

  /** Outer silhouette where the skirt meets the shoulder. */
  const waistR = capR - flare;
  /** The panel. Kept clear of the waist or the shoulder inverts. */
  const topR = clamp(p.topDiameter * 0.5 * MM, capR * 0.2, waistR - 0.15 * MM);

  const skirtH = Math.max(0.05 * MM, p.skirtHeight * MM);
  const shoulderH = clamp(p.shoulder * MM, 0.02 * MM, skirtH * 0.6);
  const domeRise = Math.max(0, p.domeRise * MM);

  // The wall has to stay thin relative to the trough depth. A sheet thicker than
  // the crimp is deep would push the inner wall's crests through its own troughs.
  const wall = clamp(p.wallThickness * MM, 0.01 * MM, Math.min(topR * 0.25, skirtH * 0.2));

  /** Where the straight wall stops and the shoulder starts. */
  const yWaist = skirtH - shoulderH;

  // ── side profile, hem -> panel edge ──────────────────────────────────────
  // This is the ENVELOPE: where the crests sit. The flutes are cut inward from
  // it below. Built bottom-to-top on purpose: the normal below is
  // T_v x T_theta, which only points OUT of the cap if +index walks up.
  const pts = [];

  for (let i = 0; i <= skirtSeg; i++) {
    const t = 1 - i / skirtSeg; // 1 at the hem, 0 at the waist
    pts.push({ r: waistR + flare * Math.pow(t, FLARE_CURVE), y: yWaist * (1 - t) });
  }

  // Elliptical fillet: vertical tangent where it leaves the wall, so the wall
  // and the shoulder are one continuous surface with no crease between them.
  const arc = SHOULDER_ARC * Math.PI * 0.5;
  const dR = (waistR - topR) / (1 - Math.cos(arc));
  for (let i = 1; i <= shoulderSeg; i++) {
    const a = (i / shoulderSeg) * arc;
    pts.push({
      r: waistR - dR + dR * Math.cos(a),
      y: yWaist + shoulderH * Math.sin(a),
    });
  }

  const rows = pts.length;
  /** Height of the panel edge — the top of the side surface. */
  const panelY = pts[rows - 1].y;

  // The flute ramp. Zero exactly at the panel junction, full at the hem, which
  // is what the spec's "amp is 0 at the seam and maximum at the bottom" means.
  const amps = pts.map((pt) =>
    toothDepth * Math.pow(clamp((panelY - pt.y) / panelY, 0, 1), Math.max(0.2, p.toothCurve)),
  );

  /** The panel's own surface, as a height over radius. */
  const domeY = (r) => panelY + domeRise * (1 - (r / topR) ** 2);

  // ── the inner profile ────────────────────────────────────────────────────
  // Offset along the profile's own NORMAL, not radially. A radial offset thins
  // the shell wherever the surface leans — and the shoulder leans hard, so a
  // radial offset would put the thinnest metal exactly where a real cap has its
  // fold. The hem is then pinned back to y = 0 so the sheet's edge there is a
  // clean flat annulus rather than a ring at a slight angle.
  const inner = pts.map((pt, j) => {
    const prev = pts[Math.max(0, j - 1)];
    const next = pts[Math.min(rows - 1, j + 1)];
    let tr = next.r - prev.r;
    let ty = next.y - prev.y;
    const len = Math.hypot(tr, ty) || 1;
    tr /= len;
    ty /= len;
    // Outward 2D normal of a profile walked bottom-to-top is (ty, -tr). The y
    // floor is for the degenerate end of the sliders only: squash the skirt to a
    // millimetre and the flare's tangent tilts far enough that offsetting along
    // it puts the inner wall below the hem plane, and a cap has to be able to
    // sit on y = 0 whatever the numbers say.
    return { r: pt.r - ty * wall, y: Math.max(0, pt.y + tr * wall) };
  });
  inner[0].y = 0;

  const innerTopR = Math.max(wall, inner[rows - 1].r);
  const innerTopY = inner[rows - 1].y;
  /** Underside of the panel: the panel's own curve, pinned to where the wall ends. */
  const underY = (r) => innerTopY + domeY(r) - domeY(innerTopR);
  const linerR = clamp(innerTopR - p.linerInset * MM, innerTopR * 0.2, innerTopR - wall);
  // Capped against the headroom under the panel, not just at zero: on a cap
  // squashed down to a millimetre there is less depth inside than the liner is
  // thick, and an unclamped pad would hang out through the open end.
  const linerT = clamp(p.linerThickness * MM, 0, Math.max(0, underY(linerR) * 0.6));

  // ── buffers ──────────────────────────────────────────────────────────────
  const pos = [];
  const nor = [];
  const uv = [];
  /** One list per group; concatenated in group order at the end. */
  const body = [];
  const panel = [];
  const liner = [];

  /** Cheap trig table; every ring reuses it. */
  const ring = [];
  for (let i = 0; i <= cols; i++) {
    const th = (i / cols) * TAU;
    ring.push({
      c: Math.cos(th),
      s: Math.sin(th),
      cn: Math.cos(teeth * th),
      sn: Math.sin(teeth * th),
    });
  }

  /**
   * The surface radius. `envelope - amp * (1 - cos)` is `base + amp * cos` with
   * `base = envelope - amp`: crests land exactly on the envelope at every
   * height, troughs cut in by twice the amplitude.
   */
  const radiusAt = (profile, j, cn) => profile[j].r - amps[j] * (1 - cn);

  const push = (x, y, z, nx, ny, nz, u, v) => {
    const index = pos.length / 3;
    pos.push(x, y, z);
    nor.push(nx, ny, nz);
    uv.push(u, v);
    return index;
  };

  /**
   * One revolved wall, from a profile walked bottom to top.
   *
   * `facing` is +1 for a surface whose outside is away from the axis and -1 for
   * one seen from within, which flips both the normal and the winding — the
   * inner skirt is the identical surface viewed from the other side.
   */
  function wallSection(profile, facing, out, wrap) {
    const stride = wrap ? cols + 1 : cols;
    const base = pos.length / 3;

    for (let j = 0; j < rows; j++) {
      const jp = Math.max(0, j - 1);
      const jn = Math.min(rows - 1, j + 1);
      const yv = profile[jn].y - profile[jp].y;

      for (let i = 0; i < stride; i++) {
        const t = ring[i];
        const r = radiusAt(profile, j, t.cn);
        // Same index span for both derivatives, so the ratio is right even where
        // the difference is one-sided at the ends of the profile.
        const rv = radiusAt(profile, jn, t.cn) - radiusAt(profile, jp, t.cn);
        // d/dtheta of (base + amp*cos(N theta)).
        const rth = -teeth * amps[j] * t.sn;

        // n = T_v x T_theta for S(theta, v) = (R cos, Y, R sin). Analytic rather
        // than from the triangles: computeVertexNormals would light the
        // duplicated seam column differently from its twin and draw a bright line
        // down the cap, and it cannot see the flute's sideways curvature at all —
        // precisely the thing that has to catch the light for 21 teeth to read.
        let nx = yv * (rth * t.s + r * t.c);
        let ny = -r * rv;
        let nz = yv * (r * t.s - rth * t.c);
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) {
          nx = t.c;
          ny = 0;
          nz = t.s;
        } else {
          nx /= len;
          ny /= len;
          nz /= len;
        }

        push(
          r * t.c,
          profile[j].y,
          r * t.s,
          nx * facing,
          ny * facing,
          nz * facing,
          i / cols,
          profile[j].y / panelY,
        );
      }
    }

    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols; i++) {
        const a = base + j * stride + i;
        const b = base + j * stride + ((i + 1) % stride);
        const c = a + stride;
        const d = b + stride;
        if (facing > 0) out.push(a, c, b, b, c, d);
        else out.push(a, b, c, b, d, c);
      }
    }
    return base;
  }

  /**
   * A flat-ish ring between two same-column rings, facing DOWN.
   *
   * Used for both the sheet's edge at the hem and the bare metal around the
   * liner. `outer` is the larger-radius ring; the winding is what makes these
   * visible from below and invisible from above.
   */
  function downRing(outerBase, innerBase, out) {
    for (let i = 0; i < cols; i++) {
      const i2 = (i + 1) % cols;
      out.push(outerBase + i, outerBase + i2, innerBase + i);
      out.push(outerBase + i2, innerBase + i2, innerBase + i);
    }
  }

  // ── 1. the outer skirt ───────────────────────────────────────────────────
  // The wrap flag buys a duplicated seam column so u can reach 1.0. It costs
  // vertices, never triangles, and it is what keeps a future skirt texture from
  // running backwards across the seam quad. Nothing inside the cap is textured,
  // so the interior does without it.
  wallSection(pts, 1, body, true);
  const sideTris = (rows - 1) * cols * 2;

  // ── 2. the underside ─────────────────────────────────────────────────────
  let shellTris = 0;

  if (!shell) {
    // Closed with a single flat disc. Nothing in a game mode ever looks inside a
    // cap, and a shell there would be triangles spent on a view that never
    // happens.
    const centre = push(0, 0, 0, 0, -1, 0, 0.5, 0.5);
    const rim = pos.length / 3;
    for (let i = 0; i < cols; i++) {
      const t = ring[i];
      const r = radiusAt(pts, 0, t.cn); // matches the skirt's first ring exactly
      push(r * t.c, 0, r * t.s, 0, -1, 0, 0.5 + (r * t.c) / (2 * capR), 0.5 + (r * t.s) / (2 * capR));
    }
    for (let i = 0; i < cols; i++) {
      body.push(centre, rim + i, rim + ((i + 1) % cols));
    }
  } else {
    // ── the sheet's edge at the hem ────────────────────────────────────────
    // The one part of the interior that shows with the cap the right way up: it
    // is what stops the skirt reading as infinitely thin foil.
    const hemOuter = pos.length / 3;
    for (let i = 0; i < cols; i++) {
      const t = ring[i];
      const r = radiusAt(pts, 0, t.cn);
      push(r * t.c, 0, r * t.s, 0, -1, 0, 0.5 + (r * t.c) / (2 * capR), 0.5 + (r * t.s) / (2 * capR));
    }
    const hemInner = pos.length / 3;
    for (let i = 0; i < cols; i++) {
      const t = ring[i];
      const r = radiusAt(inner, 0, t.cn);
      push(r * t.c, 0, r * t.s, 0, -1, 0, 0.5 + (r * t.c) / (2 * capR), 0.5 + (r * t.s) / (2 * capR));
    }
    downRing(hemOuter, hemInner, body);

    // ── the inner skirt ───────────────────────────────────────────────────
    // The same fluted surface, offset in and turned inside out. The crimp goes
    // through the metal, so the inside is corrugated exactly as the outside is —
    // it is one sheet, not a rib glued to a tube.
    wallSection(inner, -1, body, false);

    // ── the panel's underside, out as far as the liner ────────────────────
    const underOuter = pos.length / 3;
    const underInner = underOuter + cols;
    for (const r of [innerTopR, linerR]) {
      // A surface y = f(r) seen from below has downward normal (f'(r), -1): the
      // radial term follows the slope rather than opposing it. The panel is
      // domed up, so f' is negative and the normal leans IN toward the axis,
      // which is what a dish does.
      const y = underY(r);
      const dy = (underY(r + 1e-4) - underY(r - 1e-4)) / 2e-4;
      const len = Math.hypot(1, dy) || 1;
      for (let i = 0; i < cols; i++) {
        const t = ring[i];
        push(
          r * t.c,
          y,
          r * t.s,
          (dy / len) * t.c,
          -1 / len,
          (dy / len) * t.s,
          0.5 + (r * t.c) / (2 * topR),
          0.5 - (r * t.s) / (2 * topR),
        );
      }
    }
    downRing(underOuter, underInner, body);

    // ── the liner ─────────────────────────────────────────────────────────
    // A separate group, because it is a plastic pad and not the cap's paint —
    // it must not take the cap colour with it.
    const edgeTop = pos.length / 3;
    for (const drop of [0, linerT]) {
      const y = underY(linerR) - drop;
      for (let i = 0; i < cols; i++) {
        const t = ring[i];
        push(linerR * t.c, y, linerR * t.s, t.c, 0, t.s, i / cols, drop > 0 ? 1 : 0);
      }
    }
    const edgeBottom = edgeTop + cols;
    for (let i = 0; i < cols; i++) {
      const i2 = (i + 1) % cols;
      liner.push(edgeTop + i, edgeTop + i2, edgeBottom + i);
      liner.push(edgeTop + i2, edgeBottom + i2, edgeBottom + i);
    }

    // The face, as a profile walked outer to inner: flat rim, the near flank of
    // the seal ring, its floor, the far flank, and the middle back at full
    // thickness. Everything but the two flanks is at the liner's own surface, so
    // the impression is a groove cut into a flat pad rather than a dish.
    const sealR = linerR * SEAL_RADIUS;
    const sealHalf = linerR * SEAL_WIDTH;
    const at = (r, press) => ({ r, y: underY(r) - linerT + press });
    const face = [
      at(linerR, 0),
      at(Math.min(linerR, sealR + sealHalf), 0),
      at(sealR, linerT * SEAL_PRESS),
      at(Math.max(linerR * 0.05, sealR - sealHalf), 0),
      at(0, 0),
    ];

    const faceBase = pos.length / 3;
    for (let j = 0; j < face.length - 1; j++) {
      const prev = face[Math.max(0, j - 1)];
      const next = face[j + 1];
      // Downward-facing lathe normal for a profile walked outer to inner is
      // (-y', r'). Straight (y', -r') is the same surface lit from the wrong
      // side, and the seal ring would read as a raised bead instead of a groove.
      let nr = -(next.y - prev.y);
      let ny = next.r - prev.r;
      const len = Math.hypot(nr, ny) || 1;
      nr /= len;
      ny /= len;
      for (let i = 0; i < cols; i++) {
        const t = ring[i];
        push(
          face[j].r * t.c,
          face[j].y,
          face[j].r * t.s,
          nr * t.c,
          ny,
          nr * t.s,
          0.5 + (face[j].r * t.c) / (2 * topR),
          0.5 - (face[j].r * t.s) / (2 * topR),
        );
      }
    }
    // The middle is one vertex, so its normal has no direction to take from the
    // surface — straight down is the only unbiased answer, and the face is
    // almost flat there anyway.
    const faceCentre = push(0, face[2].y, 0, 0, -1, 0, 0.5, 0.5);

    for (let j = 0; j < face.length - 2; j++) {
      downRing(faceBase + j * cols, faceBase + (j + 1) * cols, liner);
    }
    const faceLast = faceBase + (face.length - 2) * cols;
    for (let i = 0; i < cols; i++) {
      liner.push(faceCentre, faceLast + i, faceLast + ((i + 1) % cols));
    }

    shellTris =
      cols * 2 + // the sheet's edge at the hem
      (rows - 1) * cols * 2 + // the inner skirt
      cols * 2 + // bare metal round the liner
      cols * 2 + // the liner's edge
      (face.length - 2) * cols * 2 +
      cols; // the liner's face
  }

  // ── 3. the panel ─────────────────────────────────────────────────────────
  // A separate section, so its normals are its own and the junction with the
  // skirt is a hard edge rather than a smoothed one.
  //
  // No seam column here: the UVs are planar, so the vertex at theta = 0 and the
  // one at theta = 2pi would carry identical coordinates anyway.
  const domeBase = pos.length / 3;

  for (let k = 0; k < domeSeg; k++) {
    const r = topR * (1 - k / domeSeg);
    const rp = topR * (1 - Math.max(0, k - 1) / domeSeg);
    const rn = topR * (1 - Math.min(domeSeg, k + 1) / domeSeg);
    const rv = rn - rp;
    const yv = domeY(rn) - domeY(rp);
    const y = domeY(r);

    for (let i = 0; i < cols; i++) {
      const t = ring[i];
      let nx = yv * t.c;
      let ny = -rv;
      let nz = yv * t.s;
      const len = Math.hypot(nx, ny, nz) || 1;
      // Planar UV over the panel's own bounding square: this is the slot the
      // player's artwork drops into, and it wants a plain top-down projection.
      push(
        r * t.c,
        y,
        r * t.s,
        nx / len,
        ny / len,
        nz / len,
        0.5 + (r * t.c) / (2 * topR),
        0.5 - (r * t.s) / (2 * topR),
      );
    }
  }

  const apex = push(0, domeY(0), 0, 0, 1, 0, 0.5, 0.5);

  for (let k = 0; k < domeSeg - 1; k++) {
    for (let i = 0; i < cols; i++) {
      const i2 = (i + 1) % cols;
      const a = domeBase + k * cols + i;
      const b = domeBase + k * cols + i2;
      panel.push(a, a + cols, b, b, a + cols, domeBase + (k + 1) * cols + i2);
    }
  }
  const lastRing = domeBase + (domeSeg - 1) * cols;
  for (let i = 0; i < cols; i++) {
    panel.push(lastRing + i, apex, lastRing + ((i + 1) % cols));
  }
  const panelTris = (domeSeg - 1) * cols * 2 + cols;

  // ── assembly ─────────────────────────────────────────────────────────────
  // Group order is load-bearing: a geometry group is a contiguous run of the
  // index buffer, so everything on one material has to be written before
  // anything on the next.
  const index = [...body, ...panel, ...liner];

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.addGroup(0, body.length, CAP_GROUP.BODY);
  geometry.addGroup(body.length, panel.length, CAP_GROUP.PANEL);
  if (liner.length) {
    geometry.addGroup(body.length + panel.length, liner.length, CAP_GROUP.LINER);
  }

  geometry.userData.triangles = index.length / 3;
  // What these same parameters would cost without the interior — the number the
  // 1500 budget is actually about, since no game mode builds the shell.
  geometry.userData.gameTriangles = sideTris + panelTris + cols;
  geometry.userData.shellTriangles = shellTris;
  geometry.userData.height = domeY(0);
  geometry.userData.radius = capR;

  return geometry;
}

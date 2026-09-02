/**
 * The cap's collider, as a compound of primitives.
 *
 * ── why not the mesh, and why not a hull ─────────────────────────────────────
 * A crown cap is a CUP. The visual mesh is an open shell and a convex hull of it
 * is a solid slug — the hull fills the mouth in, and once the mouth is filled no
 * cap can ever get inside another one. Stacking, wedging, riding up over a hem:
 * all of it becomes geometrically impossible, and it fails silently, because a
 * solid disc still slides and collides and looks fine until you notice nothing
 * ever overlaps. So: a lid and a ring of walls, with nothing in between.
 *
 * ── independent from the flutes ──────────────────────────────────────────────
 * `skirtSegments` is 8-12 and has NOTHING to do with the 21 crimped flutes on
 * the visual mesh. Matching them would mean 21 boxes per cap; with six caps in
 * play that is 126 convex parts and the broad phase starts quoting numbers in
 * the thousands of pairs. The collider is a proxy for the silhouette, not a copy
 * of it.
 *
 * Vertex snapping is likewise a shader-stage effect and is not modelled here.
 * The physics cap does not wobble.
 *
 * ── mass ─────────────────────────────────────────────────────────────────────
 * Set as an explicit total in grams and split by `SKIRT_MASS_SHARE`, rather than
 * left to a density. The skirt boxes are deliberately thicker than real 0.25 mm
 * crown stock (a box that thin is a bad constraint at any timestep), so a
 * physical density would put the mass wildly wrong. Splitting an explicit total
 * lets the collider be as thick as the solver wants while the centre of mass
 * still sits where a real cap's does: down in the skirt, which is what makes it
 * pitch over instead of skating flat.
 *
 * The split is a CONSTANT, not a parameter. Where the centre of mass sits is a
 * fact about what a crown cap is — the skirt is most of the metal — rather than
 * a dial to be turned, and leaving it adjustable meant every other measurement
 * on this collider was only true for whatever the dial happened to be on.
 *
 * Units throughout are the render pipeline's: 1 world unit = 10 mm = 1 cm.
 * Masses are grams, so forces come out in g·cm/s² and gravity is 981.
 */

const TAU = Math.PI * 2;

/**
 * Fraction of the cap's mass carried by the skirt ring rather than the lid.
 *
 * Fixed at the value a real crown cap has. Measured by area, the skirt wall is
 * roughly 600 mm² against the panel's 550, and the skirt is thicker where it is
 * crimped — so the metal, and therefore the centre of mass, sits low. That puts
 * the compound's centre of mass at 62% of its height, which is what `Arena`
 * reads back off Rapier and what the impulse height axis is measured against.
 */
const SKIRT_MASS_SHARE = 0.72;

export const COLLIDER_DEFAULTS = {
  /**
   * Boxes around the skirt. Ten is a good ring: enough that a cap rim does not
   * catch on a corner, few enough that six caps stay cheap. Never 21.
   */
  skirtSegments: 10,
  /** Radial thickness of a skirt box. Thicker than real stock, on purpose. */
  skirtThickness: 0.09,
  /**
   * Fillet on the skirt boxes' edges, in world units.
   *
   * The other half of the board-rim fix, and it needs both halves. Rounding only
   * the board leaves ten sharp cap corners to catch on it; a cap resting over the
   * rim then digs a corner into the lip, and the solver clears that penetration
   * by throwing the cap upward instead of letting it slide. Measured, that turned
   * a shot's travel into a function of the cap's YAW — a 3x swing on a 36 degree
   * cycle, which is one skirt segment.
   *
   * A real crimped hem is a rolled edge rather than a machined corner, so this is
   * also the more honest shape. Capped below half the skirt thickness, since the
   * fillet is swept out of the box rather than added to it.
   */
  skirtEdgeRadius: 0.03,
  /** Vertical thickness of the lid. */
  topThickness: 0.07,
  /**
   * Lid radius as a fraction of the cap's outer radius.
   *
   * This one number decides whether caps can nest. It tracks the visual cap's
   * own proportions — a 27.4 mm panel on a 32 mm cap, so 0.856 — and that is
   * what makes the lid narrower than the mouth it has to drop into. Push it to
   * 1.0 and the lid is as wide as the mouth, nothing ever goes inside anything,
   * and the compound has quietly become the hull this module exists to avoid.
   *
   * Not derived from `topDiameter` automatically, because the collider is a
   * proxy and is allowed to disagree with the mesh: the readout in the debug
   * panel is the check that it still leaves a hole, whatever it is set to.
   */
  topRadiusScale: 0.856,
  /** A real crown cap is about 2.2 g. */
  massGrams: 2.2,
  friction: 0.34,
  /**
   * Friction while the cap is lying on its CROWN rather than on its hem.
   *
   * ── it is a different surface, so it is a different number ──────────────────
   * The two faces a cap can lie on are not the same object. The hem is a crimped
   * edge — twenty-one folded corners standing on the board, biting into it. The
   * crown is a stamped panel: one smooth disc of sheet metal. A real cap knocked
   * onto its back skates, and it skates because what is touching the table
   * changed, not because anything about the cap did.
   *
   * Applied to the WHOLE cap rather than to the lid collider alone, and that is
   * measured rather than assumed. An upended cap's skirt boxes are exactly as
   * tall as the lid — both end at `height` — so the ring lands with it and takes
   * 50 of the 55 contacts. Friction on the lid alone therefore reaches almost
   * nothing: 0.02 on the lid moved a 150 cm/s slide from 32.0 units to 33.7.
   *
   * ── what the number buys, measured on the knockout board ────────────────────
   * Slide from 150 cm/s, against 32.0 units at the hem's 0.34:
   *
   *     0.24  44.4  1.4x        0.12   83.0  2.6x
   *     0.20  52.6  1.6x        0.10   97.1  3.0x
   *     0.16  64.4  2.0x        0.08  116.7  3.6x
   *
   * 0.16 is double, which is the point where a flipped cap reads as being on a
   * different surface rather than as a cap that was hit slightly harder. Below
   * about 0.10 a nudge carries it clean across a 56-unit board, which stops being
   * a hazard and becomes a death sentence for whoever it happened to.
   *
   * Combined by MIN while it is in force — see `capFriction.js` — so this is the
   * coefficient the contact actually gets, on any surface, in any mode.
   */
  flippedFriction: 0.16,
  // Low. Metal on metal sounds like it should bounce, but two 2.2 g caps meeting
  // edge-on at a third of a metre a second mostly deform and scrape; a springy
  // restitution here makes caps ping off each other like billiard balls and the
  // whole board turns into a break shot.
  restitution: 0.14,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * @param {{radius: number, height: number}} dims  outer radius and total height,
 *   in world units — straight off `geometry.userData`
 * @param {Partial<typeof COLLIDER_DEFAULTS>} [cfg]
 * @returns {{parts: Array, mouthRadius: number, topRadius: number}} a plain
 *   description: no Rapier types, no three.js types. Serialisable, diffable, and
 *   testable without a physics world.
 */
export function describeCapColliders(dims, cfg = {}) {
  const c = { ...COLLIDER_DEFAULTS, ...cfg };

  const radius = Math.max(0.05, dims.radius);
  const height = Math.max(0.02, dims.height);

  const n = clamp(Math.round(c.skirtSegments), 4, 24);
  const t = clamp(c.skirtThickness, 0.01, radius * 0.45);
  const topT = clamp(c.topThickness, 0.01, height * 0.6);
  const topR = clamp(c.topRadiusScale, 0.2, 1) * radius;
  const share = SKIRT_MASS_SHARE;
  const mass = Math.max(1e-3, c.massGrams);

  /**
   * The ring is INSCRIBED in `radius`: the box corners land exactly on it and the
   * flat faces sit a little inside. Getting this backwards is a real bug with a
   * long tail, so it is worth being explicit about.
   *
   * The obvious construction is to put the outer FACES on `radius` and size the
   * half-width with `tan(pi/n)` so neighbours overlap and the ring has no gaps.
   * That was here, and it makes the box CORNERS the widest part of the cap:
   * `radius / cos(pi/n)`, which at ten segments is 1.678 against a nominal 1.6 —
   * a 5% spur sticking out at each seam, in a direction that depends on the cap's
   * yaw.
   *
   * What that costs shows up at the board's rim. A spur hanging over the edge
   * sits inside the board's rounded lip rather than on it, and the solver
   * resolves that penetration by throwing the cap into the air: measured, a shot
   * fired at 136 cm/s came out of the first step at 44 cm/s with 32 cm/s of
   * VERTICAL velocity it did not have before, and travelled a fifth as far. It
   * reproduced on a 36 degree cycle in the cap's yaw — one full segment — which
   * is what identified the ring rather than the rim as the cause.
   *
   * Inscribing puts the maximum radius back at exactly `radius`. Adjacent boxes
   * then meet corner-to-corner precisely instead of overlapping, which is a
   * zero-width seam rather than a gap — nothing in this game is thin enough to
   * find it, and it is a far better trade than a cap that is secretly 5% too wide
   * in ten directions.
   *
   * It also happens to match the real object better. A crown cap's surface
   * oscillates between the flute crests at `radius` and the troughs about 1.4;
   * corners on the crests and faces at `radius * cos(pi/n)` lands squarely inside
   * that band, where the circumscribed ring sat outside it everywhere.
   */
  const faceR = radius * Math.cos(Math.PI / n);
  const halfW = radius * Math.sin(Math.PI / n);
  /** Centreline of the wall: the boxes straddle it. */
  const rMid = faceR - t * 0.5;
  const halfH = height * 0.5;

  const parts = [];

  // The lid goes in FIRST and the skirt boxes follow in index order. Rapier sums
  // mass properties and builds islands in collider insertion order, and the
  // determinism guarantee is over the exact sequence of API calls — so this loop
  // order is part of the contract, not an implementation detail.
  parts.push({
    kind: 'cylinder',
    halfHeight: topT * 0.5,
    radius: topR,
    translation: { x: 0, y: height - topT * 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    mass: mass * (1 - share),
  });

  // Swept out of the box, not added to it, so the ring keeps the size the
  // inscribing above gave it. A rounded box is the Minkowski sum of a box and a
  // sphere, so every half-extent loses the border radius and gets it back as a
  // fillet — the overall envelope is unchanged and the corners only ever move
  // inward.
  const edgeR = clamp(c.skirtEdgeRadius, 0, Math.min(t * 0.45, halfW * 0.4, halfH * 0.4));

  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    // A box's local +z is its thin axis and has to point radially outward. A
    // rotation of phi about y sends (0,0,1) to (sin phi, 0, cos phi), so
    // phi = pi/2 - theta lands it on (cos theta, 0, sin theta).
    const phi = Math.PI * 0.5 - th;
    parts.push({
      kind: edgeR > 1e-4 ? 'roundCuboid' : 'cuboid',
      halfExtents: {
        x: halfW - edgeR,
        y: halfH - edgeR,
        z: t * 0.5 - edgeR,
      },
      borderRadius: edgeR,
      translation: { x: rMid * Math.cos(th), y: halfH, z: rMid * Math.sin(th) },
      rotation: { x: 0, y: Math.sin(phi * 0.5), z: 0, w: Math.cos(phi * 0.5) },
      mass: (mass * share) / n,
    });
  }

  return {
    parts,
    /**
     * Clear radius of the open end. What has to be bigger than `topRadius`.
     *
     * Measured off the inner FACES, not off `radius`, because the faces are the
     * ring's closest approach to the axis — the corners sit further out. With the
     * ring inscribed rather than circumscribed the two differ by `cos(pi/n)`, and
     * using the wrong one would overstate the mouth by 5% and quietly break the
     * one invariant this collider exists to hold.
     */
    mouthRadius: faceR - t,
    topRadius: topR,
    friction: c.friction,
    flippedFriction: Math.max(0, c.flippedFriction),
    restitution: c.restitution,
    height,
    radius,
  };
}

/**
 * Does this description actually leave a cap-shaped hole in itself?
 *
 * The one invariant worth asserting at runtime: a lid wider than the mouth means
 * no cap can ever enter another, which is the exact failure a convex hull would
 * have caused. Surfaced in the debug panel rather than thrown, because a slider
 * is allowed to pass through a bad value on its way to a good one.
 */
export function nestingClearance(desc) {
  return desc.mouthRadius - desc.topRadius;
}

import { BufferGeometry, Float32BufferAttribute } from 'three';

/**
 * The ball, built as the solid it actually is.
 *
 * ── panels, not a picture of panels ─────────────────────────────────────────
 * A football is a truncated icosahedron: twelve pentagons and twenty hexagons,
 * stitched and inflated. It was drawn here as a black-and-white TEXTURE on a
 * sphere, and that had two problems a texture cannot solve. A sphere's
 * equirectangular UV smears the polar panels into bands, so two of the twelve
 * pentagons were caps rather than pentagons; and the silhouette was a circle,
 * so the ball read as a marble with a pattern on it rather than as a stitched
 * object.
 *
 * Built as geometry, the panels ARE the panels: every edge on screen is a real
 * seam, the outline is faceted, and the pattern cannot drift or stretch because
 * there is no mapping between it and the surface. It is also exactly the sort
 * of object the hardware this pipeline imitates was good at — flat facets, hard
 * colour boundaries, no texture fetch at all.
 *
 * ── how it is constructed ───────────────────────────────────────────────────
 * By truncating an icosahedron, which is the definition rather than a table of
 * coordinates: take each edge, cut it at a third and two thirds, and every
 * original vertex becomes a pentagon while every original face becomes a
 * hexagon. Doing it this way means the code says what the shape IS, and the 60
 * vertices fall out instead of being typed in.
 *
 * ── slightly inflated ───────────────────────────────────────────────────────
 * The corner points are pushed out to the sphere, which is what stitching and
 * inflating a real ball does to it. The faces stop being exactly planar, but
 * each is triangulated as a fan from its own centre — also on the sphere — so
 * the panels bulge very slightly rather than creasing. 180 triangles against
 * the 80 the sphere used, on an object that shares the screen with a 3024
 * triangle cap.
 */

/** Where along each icosahedron edge the cut falls. A third, as the solid has. */
const CUT = 1 / 3;

/** Face groups, so the renderer can hand each its own material. */
export const BALL_GROUP = { PENTAGON: 0, HEXAGON: 1 };

function key(v) {
  return `${v[0].toFixed(5)},${v[1].toFixed(5)},${v[2].toFixed(5)}`;
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** The 12 vertices and 20 faces of an icosahedron, on the unit sphere. */
function icosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const vertices = raw.map(norm);
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { vertices, faces };
}

/**
 * Order a face's corner points anticlockwise as seen from outside.
 *
 * A pentagon's five points are collected by walking the faces around a vertex,
 * which does not come out in ring order; sorting them by angle in the face's own
 * tangent plane does. Necessary because a fan triangulation over unordered
 * points produces a star rather than a polygon.
 */
function sortRing(points, centre) {
  const n = norm(centre);
  // Any vector not parallel to the normal gives a tangent basis.
  const seed = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm([
    seed[1] * n[2] - seed[2] * n[1],
    seed[2] * n[0] - seed[0] * n[2],
    seed[0] * n[1] - seed[1] * n[0],
  ]);
  const v = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];
  return points
    .map((p) => {
      const d = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
      return { p, a: Math.atan2(d[0] * v[0] + d[1] * v[1] + d[2] * v[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) };
    })
    .sort((x, y) => x.a - y.a)
    .map((x) => x.p);
}

/**
 * @param {number} radius  world units
 * @returns {BufferGeometry} two groups: pentagons then hexagons
 */
export function buildBallGeometry(radius = 1) {
  const ico = icosahedron();

  // ── cut every edge at a third and two thirds ──────────────────────────────
  const cuts = new Map();
  const cutPoint = (a, b) => {
    const va = ico.vertices[a];
    const vb = ico.vertices[b];
    const p = norm([
      va[0] + (vb[0] - va[0]) * CUT,
      va[1] + (vb[1] - va[1]) * CUT,
      va[2] + (vb[2] - va[2]) * CUT,
    ]);
    const k = key(p);
    if (!cuts.has(k)) cuts.set(k, p);
    return cuts.get(k);
  };

  /** Hexagon per original face: the six cuts on its three edges. */
  const hexagons = ico.faces.map(([a, b, c]) => [
    cutPoint(a, b), cutPoint(b, a),
    cutPoint(b, c), cutPoint(c, b),
    cutPoint(c, a), cutPoint(a, c),
  ]);

  /**
   * Pentagon per original vertex: the cut nearest it on each of its five edges.
   *
   * Collected by scanning the faces rather than from an adjacency table — the
   * icosahedron's vertex figure is a pentagon by definition, so every vertex is
   * guaranteed to produce exactly five and there is nothing to keep in step.
   */
  const pentagons = ico.vertices.map((_, i) => {
    const near = new Map();
    for (const [a, b, c] of ico.faces) {
      const tri = [a, b, c];
      if (!tri.includes(i)) continue;
      for (const j of tri) {
        if (j === i) continue;
        const p = cutPoint(i, j);
        near.set(key(p), p);
      }
    }
    return [...near.values()];
  });

  // ── triangulate, fanning each panel from its own centre ───────────────────
  const position = [];
  const normal = [];
  const counts = [0, 0];

  const emit = (ring, group) => {
    const c = norm(ring.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]));
    const ordered = sortRing(ring, c);
    for (let i = 0; i < ordered.length; i++) {
      const p0 = ordered[i];
      const p1 = ordered[(i + 1) % ordered.length];
      // Wound so the outward face is front-facing: the ring is sorted
      // anticlockwise about the outward normal, so centre -> p0 -> p1 is too.
      for (const p of [c, p0, p1]) {
        position.push(p[0] * radius, p[1] * radius, p[2] * radius);
        // Smooth normals off the sphere. The panels are meant to look inflated,
        // not chiselled — the seams are carried by the colour change, which is
        // hard whatever the shading does.
        normal.push(p[0], p[1], p[2]);
      }
      counts[group] += 1;
    }
  };

  // Pentagons first so `BALL_GROUP` indices match the group order.
  for (const ring of pentagons) emit(ring, BALL_GROUP.PENTAGON);
  for (const ring of hexagons) emit(ring, BALL_GROUP.HEXAGON);

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geo.addGroup(0, counts[0] * 3, BALL_GROUP.PENTAGON);
  geo.addGroup(counts[0] * 3, counts[1] * 3, BALL_GROUP.HEXAGON);
  geo.userData = {
    radius,
    triangles: counts[0] + counts[1],
    pentagons: pentagons.length,
    hexagons: hexagons.length,
  };
  return geo;
}

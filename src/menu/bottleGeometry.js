import { BufferGeometry, Float32BufferAttribute } from 'three';
import { MM } from '../cap/capGeometry.js';

/**
 * The bottle's meshes, revolved from the profile.
 *
 * Three geometries come out of here and they are deliberately separate objects
 * rather than groups of one: the glass is alpha-blended and gets drawn twice
 * (back faces, then front), the liquid is opaque and has to be sandwiched
 * BETWEEN those two passes, and the label is opaque and drawn after all of it.
 * There is no ordering of geometry groups on a single mesh that produces that.
 *
 * ── the flutes use the cap's formula, and its convention ────────────────────
 *     r(theta) = base + amp * cos(n * theta),  base = envelope - amp
 * Written as `envelope - amp * (1 - cos)`, exactly as `capGeometry.radiusAt`
 * does. Pinning the CRESTS to the envelope and sending the troughs inward is
 * what makes a moulded flute instead of a rib glued to a tube — the same
 * argument that file makes about the crimp, and worth keeping identical so the
 * two objects cannot drift into disagreeing about what a flute is.
 *
 * `amp` is scaled per row by the profile's own `rib` weight, so the label band
 * comes out smooth without this file knowing a label exists.
 *
 * ── normals are analytic ────────────────────────────────────────────────────
 * `computeVertexNormals` cannot see the flutes' sideways curvature at all — it
 * only averages triangle normals, and at three columns per flute that averages
 * the flute away. It would also light the duplicated seam column differently
 * from its twin and draw a bright line down the bottle. So the normal is
 * T_v x T_theta, as in the cap.
 *
 * ── the vertex colour is the glass tint ─────────────────────────────────────
 * Every glass vertex carries a colour: darker toward the base, where a real
 * bottle has thick glass and a full depth of drink behind it, lightening up the
 * neck where there is nothing but air. Baked here rather than computed in the
 * shader because it is a property of the OBJECT — it does not change when the
 * bottle moves — and per-vertex is the only place the era would have put it.
 * The view-dependent half of the glass look, the rim, is per-vertex too but
 * lives in the material, since it depends on where the camera is.
 */

const TAU = Math.PI * 2;

/**
 * Revolve a profile.
 *
 * @param {{r: number, y: number, rib: number}[]} rows  bottom to top; the
 *   winding below only faces outward if the index walks UP.
 * @param {object} opts
 * @param {number} opts.cols
 * @param {number} opts.ribs
 * @param {number} opts.ribDepth   world units, half peak-to-trough
 * @param {number} opts.height     for the v coordinate
 * @param {boolean} [opts.wrap]    duplicate the seam column so u reaches 1
 * @param {boolean} [opts.flipU]
 *   Run u the other way round the bottle.
 *
 *   The ring below is built with theta increasing anticlockwise in xz, and the
 *   camera is on +z — so as theta grows, the surface point moves LEFT across
 *   the screen. u therefore runs right to left, and anything with a reading
 *   direction printed on it comes out mirrored. It did: the first label said
 *   ƎⅼTTAꓭ. Symmetric artwork like the glass highlight does not care and is left
 *   alone; the label sets this.
 * @param {(y: number) => [number, number, number]} [opts.tint]  vertex colour
 */
function revolve(
  rows,
  {
    cols,
    ribs,
    ribDepth,
    height,
    wrap = true,
    flipU = false,
    tint = null,
    vFrom = 0,
    vTo = 1,
    sweepFrom = 0,
    sweepTo = TAU,
  },
) {
  const stride = wrap ? cols + 1 : cols;
  const sweep = sweepTo - sweepFrom;
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const index = [];

  const ring = [];
  for (let i = 0; i <= cols; i++) {
    const th = sweepFrom + (i / cols) * sweep;
    ring.push({
      c: Math.cos(th),
      s: Math.sin(th),
      cn: Math.cos(ribs * th),
      sn: Math.sin(ribs * th),
    });
  }

  const amps = rows.map((row) => ribDepth * row.rib);
  const radiusAt = (j, cn) => rows[j].r - amps[j] * (1 - cn);
  const span = vTo - vFrom || 1;

  for (let j = 0; j < rows.length; j++) {
    const jp = Math.max(0, j - 1);
    const jn = Math.min(rows.length - 1, j + 1);
    const yv = rows[jn].y - rows[jp].y;

    for (let i = 0; i < stride; i++) {
      const t = ring[i];
      const r = radiusAt(j, t.cn);
      // Same index span for both derivatives, so the ratio stays right where
      // the difference is one-sided at the ends of the profile.
      const rv = radiusAt(jn, t.cn) - radiusAt(jp, t.cn);
      const rth = -ribs * amps[j] * t.sn;

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

      pos.push(r * t.c, rows[j].y, r * t.s);
      nor.push(nx, ny, nz);
      uv.push(flipU ? 1 - i / cols : i / cols, (rows[j].y / height - vFrom) / span);
      if (tint) col.push(...tint(rows[j].y));
    }
  }

  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i;
      const b = j * stride + ((i + 1) % stride);
      index.push(a, a + stride, b, b, a + stride, b + stride);
    }
  }

  return { pos, nor, uv, col, index, stride };
}

function assemble({ pos, nor, uv, col, index }) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  if (col.length) g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.userData.triangles = index.length / 3;
  return g;
}

/**
 * The glass.
 *
 * Closed at the bottom with a flat fan — the base is opaque in the sense that
 * matters, which is that there is no hole in the silhouette — and closed at the
 * top with a small disc across the bore. Nothing ever sees the bore with a cap
 * on it; the disc is there so the alpha pass does not have a rim of doubled
 * blending where an open edge would be.
 */
export function buildGlassGeometry(profile) {
  const p = profile.params;
  /**
   * Tessellation, from `columns` — NOT from the flute count.
   *
   * It was `ribs * radialPerRib` clamped to a floor of 6, which was correct
   * while the columns existed to resolve the flutes. With `ribDepth: 0` the two
   * have nothing to do with each other, and the old form had a trap in it:
   * setting `ribs: 0` to switch the flutes off gave `max(6, 0)` — a SIX-SIDED
   * bottle. See the note on `BOTTLE_DEFAULTS.columns`.
   */
  const cols = Math.max(12, Math.round(p.columns));
  const rows = profile.rows.map((r) => ({ r: r.r * MM, y: r.y * MM, rib: r.rib }));
  const height = profile.height * MM;

  /**
   * Barely tinted, and smooth all the way up.
   *
   * It used to run from 0.52 at the heel to 1.0 at the neck in a squared ramp,
   * with the curve chosen to fake two hard stops because a 15-bit framebuffer
   * turned a long smooth gradient into visible banding. There is no 15-bit
   * framebuffer and no dither any more, so the shape can be what it should be —
   * and the floor was far too dark regardless: clear cider glass is bright at
   * the heel, not smoked.
   *
   * 0.86 -> 1.00, linear, with a faint cool cast. The remaining darkening is
   * there only because more glass is between you and the far wall down at the
   * base, and the tint is the cheapest way to say so.
   */
  const tint = (y) => {
    const t = Math.min(1, Math.max(0, y / height));
    const k = 0.86 + 0.14 * t;
    return [k * 0.97, k, k * 0.99];
  };

  const mesh = revolve(rows, {
    cols,
    ribs: Math.max(1, Math.round(p.ribs)),
    ribDepth: p.ribDepth * MM,
    height,
    tint,
  });

  const { pos, nor, uv, col, index } = mesh;

  // ── the base ─────────────────────────────────────────────────────────────
  const baseCentre = pos.length / 3;
  pos.push(0, rows[0].y, 0);
  nor.push(0, -1, 0);
  uv.push(0.5, 0);
  col.push(...tint(rows[0].y));
  const baseRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    const r = rows[0].r;
    pos.push(r * Math.cos(th), rows[0].y, r * Math.sin(th));
    nor.push(0, -1, 0);
    uv.push(0.5 + Math.cos(th) * 0.5, 0);
    col.push(...tint(rows[0].y));
  }
  for (let i = 0; i < cols; i++) {
    index.push(baseCentre, baseRim + i, baseRim + ((i + 1) % cols));
  }

  // ── across the bore ──────────────────────────────────────────────────────
  const top = rows[rows.length - 1];
  const boreCentre = pos.length / 3;
  pos.push(0, top.y, 0);
  nor.push(0, 1, 0);
  uv.push(0.5, 1);
  col.push(...tint(top.y));
  const boreRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    pos.push(top.r * Math.cos(th), top.y, top.r * Math.sin(th));
    nor.push(0, 1, 0);
    uv.push(0.5 + Math.cos(th) * 0.5, 1);
    col.push(...tint(top.y));
  }
  for (let i = 0; i < cols; i++) {
    index.push(boreCentre, boreRim + ((i + 1) % cols), boreRim + i);
  }

  const g = assemble({ pos, nor, uv, col, index });
  g.userData.height = height;
  g.userData.columns = cols;
  g.userData.rows = rows.length;
  g.userData.wallTriangles = (rows.length - 1) * cols * 2;
  return g;
}

/**
 * The drink.
 *
 * A second lathe inside the first, stopping at the fill line with a visible
 * surface on top — the neck is empty, which is what makes the fill line read as
 * a fill line rather than as the glass simply being brown up to there.
 *
 * The surface ring is recorded on `userData` so the shake can push it about
 * without this file having to know what a shake is. That is one ring plus a
 * centre vertex: sixteen numbers to touch per frame, against a particle system
 * that the brief rules out and that would not look like liquid anyway.
 */
export function buildLiquidGeometry(profile) {
  const p = profile.params;
  // Fewer columns than the glass: it is seen THROUGH the glass, at a fraction
  // of the contrast, and nothing about it survives to the framebuffer that a
  // finer ring would have improved.
  const cols = Math.max(8, Math.round(p.columns / 2));
  const fill = Math.min(profile.height - 4, p.fillLevel);

  const surfaceR = profile.envelopeAt(fill) * p.liquidInset;
  const rows = [];
  const steps = 7;
  for (let i = 0; i <= steps; i++) {
    const y = (fill * i) / steps;
    rows.push({ r: profile.envelopeAt(y) * p.liquidInset * MM, y: y * MM, rib: 0 });
  }

  /**
   * Vertex colours, so the meniscus is brighter than the drink under it.
   *
   * ── the fill line stopped reading when the drink went clear ─────────────
   * It used to be an opaque brown, so its top surface was obvious and the slosh
   * with it. A pale cider inside pale glass is nearly the same value as its
   * container, and `Bottle._slosh` — which tilts that surface every frame — was
   * computing something nobody could see.
   *
   * A real drink is most visible at its surface: the meniscus catches the light
   * and the rim where it meets the glass catches more. This is that, as a
   * multiplier the shader already applies. The rim goes ABOVE 1 deliberately —
   * the render target is half-float, so a value over white survives to the bloom
   * pass and the ring picks up a faint glow, which is the one place on this
   * bottle where that is physically what would happen.
   *
   * It costs nothing to animate: the slosh already rewrites these vertices'
   * POSITIONS, so the bright ring tilts with the surface for free.
   */
  const WALL = [0.92, 0.97, 1.0];
  const BASE = [0.72, 0.8, 0.86];
  const SURFACE_MID = [1.15, 1.3, 1.35];
  const SURFACE_RIM = [1.7, 1.85, 1.9];

  const mesh = revolve(rows, {
    cols,
    ribs: 1,
    ribDepth: 0,
    height: profile.height * MM,
    wrap: false,
    tint: () => WALL,
  });
  const { pos, nor, uv, col, index } = mesh;

  // ── the base, so the drink is not a shell ────────────────────────────────
  const baseCentre = pos.length / 3;
  pos.push(0, 0, 0);
  nor.push(0, -1, 0);
  uv.push(0.5, 0.5);
  col.push(...BASE);
  const baseRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    pos.push(rows[0].r * Math.cos(th), 0, rows[0].r * Math.sin(th));
    nor.push(0, -1, 0);
    uv.push(0.5, 0.5);
    col.push(...BASE);
  }
  for (let i = 0; i < cols; i++) index.push(baseCentre, baseRim + i, baseRim + ((i + 1) % cols));

  // ── the surface ──────────────────────────────────────────────────────────
  const surfaceCentre = pos.length / 3;
  pos.push(0, fill * MM, 0);
  nor.push(0, 1, 0);
  uv.push(0.5, 0.5);
  col.push(...SURFACE_MID);
  const surfaceRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    pos.push(surfaceR * MM * Math.cos(th), fill * MM, surfaceR * MM * Math.sin(th));
    nor.push(0, 1, 0);
    uv.push(0.5, 0.5);
    col.push(...SURFACE_RIM);
  }
  for (let i = 0; i < cols; i++) {
    index.push(surfaceCentre, surfaceRim + ((i + 1) % cols), surfaceRim + i);
  }

  const g = assemble({ pos, nor, uv, col, index });
  // Where the slosh writes. Centre first, then the ring, in column order.
  g.userData.surfaceCentre = surfaceCentre;
  g.userData.surfaceRim = surfaceRim;
  g.userData.surfaceCols = cols;
  g.userData.surfaceY = fill * MM;
  return g;
}

/**
 * The head of foam, and the bubbles under it.
 *
 * ── the foam is rewritten every frame, not rebuilt ──────────────────────────
 * It has to grow from the fill line up through the shoulder and into the neck,
 * and it has to hug the inside of the glass the whole way — so it cannot be a
 * cylinder that gets scaled, and it certainly cannot be a new geometry per
 * frame. It is a fixed lathe of `FOAM_ROWS` rings whose vertex POSITIONS get
 * rewritten from a single height parameter, which is six rings by twenty
 * columns: a hundred and twenty vertices, once a frame, on the CPU. That is the
 * same trick the liquid's surface uses for its slosh, with one more dimension.
 *
 * `userData` carries what the rewrite needs. Normals are set once and left:
 * they are radial on the wall and up on the head, which for a short column of
 * something with no specular is indistinguishable from doing it properly and
 * saves recomputing a cross product per vertex per frame.
 *
 * ── it is opaque, and that is deliberate ────────────────────────────────────
 * Foam is not translucent — a head thick enough to see through is not a head.
 * Being opaque also puts it in the depth pass, which is what stops the far wall
 * of the glass drawing through it and what lets the near wall tint it. It gets
 * the glass over the top of it for free, exactly like the drink does.
 */
const FOAM_ROWS = 6;

export function buildFoamGeometry(profile) {
  const p = profile.params;
  const cols = Math.max(8, Math.round(p.columns / 2));

  const pos = [];
  const nor = [];
  const uv = [];
  const index = [];

  // Placeholder ring positions; `Bottle` writes the real ones before the first
  // draw. Only the topology and the UVs are decided here.
  for (let j = 0; j < FOAM_ROWS; j++) {
    for (let i = 0; i <= cols; i++) {
      const th = (i / cols) * TAU;
      pos.push(Math.cos(th), j, Math.sin(th));
      nor.push(Math.cos(th), 0, Math.sin(th));
      // v repeats up the column so the scroll has something to move. u wraps
      // twice round, which at twenty columns keeps the cells roughly square.
      uv.push((i / cols) * 2, (j / (FOAM_ROWS - 1)) * 2);
    }
  }
  const stride = cols + 1;
  for (let j = 0; j < FOAM_ROWS - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i;
      index.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }

  // The head: a disc across the top of the column, so the foam has a surface
  // rather than an open pipe.
  const headCentre = pos.length / 3;
  pos.push(0, FOAM_ROWS - 1, 0);
  nor.push(0, 1, 0);
  uv.push(1, 1);
  const headRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    pos.push(Math.cos(th), FOAM_ROWS - 1, Math.sin(th));
    nor.push(0, 1, 0);
    uv.push(0.5 + Math.cos(th), 0.5 + Math.sin(th));
  }
  for (let i = 0; i < cols; i++) {
    index.push(headCentre, headRim + ((i + 1) % cols), headRim + i);
  }

  const g = assemble({ pos, nor, uv, col: [], index });
  g.userData.foamRows = FOAM_ROWS;
  g.userData.foamCols = cols;
  g.userData.foamStride = stride;
  g.userData.headCentre = headCentre;
  g.userData.headRim = headRim;
  return g;
}

/**
 * The label: a slice of the bottle's own profile, pushed out by a fraction of a
 * millimetre.
 *
 * Following the profile rather than being a straight cylinder is what gives the
 * decal's edges their slight curve, for free and correctly, instead of faking
 * it in the texture.
 *
 * ── a front decal on a PARTIAL arc, not a band ─────────────────────────────
 * It used to wrap the whole bottle twice — `labelPanels: 2` — because at 128
 * texels across the full circumference the logo landed on about twenty texels
 * and two panels was the difference between a word and a smudge.
 *
 * A cider bottle carries one oval label on the front. Building the mesh for
 * only the front arc means the texture is spent entirely on the oval instead of
 * three quarters of it being transparent margin: the same texel density for
 * about a fifth of the pixels.
 *
 * ── the arc is 10..170 degrees, and 0..160 is the bug ──────────────────────
 * `revolve` starts its ring at theta = 0, which is +x. The camera sits on +z.
 * So the front of the bottle — the part facing the viewer — is theta = 90
 * degrees, NOT 0. An arc of `labelSweep` laid down from 0 puts the label round
 * the right-hand side of the bottle, visibly rotated away. It is centred on 90
 * instead.
 *
 * `wrap` is false because a partial arc has no seam to duplicate, and `flipU`
 * stays true for the reason the header gives: the ring winds anticlockwise and
 * the camera is on +z, so without it the artwork is mirrored. The first band
 * ever built read ƎⅼTTAꓭ.
 */
export function buildLabelGeometry(profile) {
  const p = profile.params;
  const cols = Math.max(12, Math.round(p.columns));
  const steps = 4;
  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const y = p.labelFrom + ((p.labelTo - p.labelFrom) * i) / steps;
    rows.push({ r: (profile.envelopeAt(y) + p.labelOffset) * MM, y: y * MM, rib: 0 });
  }

  // Centred on the camera-facing side. See the note above on why this is not
  // simply 0 .. sweep.
  const sweep = (Math.max(1, Math.min(360, p.labelSweep)) * Math.PI) / 180;
  const sweepFrom = Math.PI / 2 - sweep / 2;

  const mesh = revolve(rows, {
    cols,
    ribs: 1,
    ribDepth: 0,
    height: profile.height * MM,
    wrap: false,
    flipU: true,
    sweepFrom,
    sweepTo: sweepFrom + sweep,
    // v spans the band exactly, so the artwork is not cropped by where the band
    // happens to sit up the bottle.
    vFrom: (p.labelFrom * MM) / (profile.height * MM),
    vTo: (p.labelTo * MM) / (profile.height * MM),
  });

  const g = assemble({ ...mesh, col: [] });
  g.userData.panels = Math.max(1, Math.round(p.labelPanels));
  return g;
}

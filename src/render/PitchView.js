import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
} from 'three';
import { TURF_TILE, makeTurfTexture } from './pitchTexture.js';
// The caps' own colours. The goal a player defends is painted in theirs, so the
// two are the same fact told twice rather than two colour schemes to learn.
import { PLAYER_COLORS } from './ArenaView.js';

/**
 * The football pitch, drawn.
 *
 * ── the fence is drawn from the colliders, not from the metrics ──────────────
 * Every box and cylinder here comes out of `description.shapes`, which
 * `FootballPitch` fills in as it CREATES each collider. Nothing in this file
 * computes where a wall goes.
 *
 * That is deliberate and it is the whole point of the brief's "벽은 눈에 보여야
 * 한다". A visible wall is only useful if what you see is where the collision
 * is, and the reliable way to get a drawn fence that is 2.4 tall against a
 * collider that is 3.2 tall is to derive both from the same numbers in two
 * places and then change one of them. So there is one place, and the renderer is
 * downstream of it.
 *
 * The ceiling is the single exception and it is not in the list at all: it is a
 * containment backstop rather than a surface the game is played on, and drawing
 * a lid across the pitch would black out the view.
 *
 * ── the markings have no colliders and cannot get one ────────────────────────
 * Lines are `LineSegments` in this module and a `pitchMarkings` call in the
 * layout. There is no path by which one becomes a body, which is what the brief
 * asks for — the centre circle is a thing you can see and shoot across.
 *
 * ── the stripes are geometry ─────────────────────────────────────────────────
 * Mown bands are groups on one surface mesh rather than anything in the texture,
 * so they stay a fixed count across the pitch at any pitch length and never
 * carry a seam where a texture tile happened to end.
 */

/** The lines. The brightest thing on the pitch, and the thing being read. */
const LINE_COLOR = '#e6efe4';
/** Mown bands: identical map, one tint down. Stripes are luminance, not hue. */
const BAND_TINT = ['#ffffff', '#c6c6c6'];
/**
 * Mown bands, counted ALONG THE PITCH — so each stripe runs touchline to
 * touchline and the bands step goal-ward.
 *
 * That is the way a pitch is actually cut: the mower runs across the short way
 * and advances along the long way, which is why every overhead shot of a ground
 * has stripes lying across the length. Banding the other axis gives stripes
 * running goal to goal, which is the same pattern turned ninety degrees and
 * reads immediately as wrong even if you cannot say why.
 *
 * Worth stating as an axis and not as an `x`, because standing the pitch up
 * swapped which world axis the length is and quietly took the stripes with it.
 */
const BAND_COUNT = 12;

const FENCE_COLOR = '#6b7688';
const NET_COLOR = '#aeb6c2';
const FRAME_COLOR = '#e8ecf2';

/**
 * A player's colour, taken most of the way to the net's grey.
 *
 * Mixed in sRGB and rounded to whole bytes, because the 5-bit quantiser is
 * going to round it again anyway and there is no sense carrying precision that
 * cannot survive the trip.
 */
function washed(hex, toward = NET_COLOR, amount = 0.62) {
  const split = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = split(hex);
  const b = split(toward);
  return `#${a
    .map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0'))
    .join('')}`;
}
/** The goal sensor outline, when the panel asks for it. */
const SENSOR_COLOR = '#ff7fd0';
/**
 * The run-off, one step down from the pitch.
 *
 * A tint and no more. It is not a different surface and it is not out of play in
 * the sense that anything stops there — it is the strip past the lines, and the
 * lines are what the rule reads. Making it loud would put the emphasis on the
 * one part of the ground nothing happens on.
 */
const RUNOFF_TINT = '#b0b8ab';
/** Candidate spots the respawn search walked. Debug only. */
const SEARCH_OK = '#7ef0c8';
const SEARCH_BLOCKED = '#e0553f';
const MAX_SEARCH_MARKS = 256;

/**
 * The ground's share of the vertex wobble. Zero, and measured.
 *
 * The snap rounds each vertex onto the framebuffer grid, which is the whole
 * character of the look on an OBJECT: a cap is small, its vertices land on the
 * same few pixels, and the whole thing shivers together. A ground plane is the
 * opposite case — it spans the screen, so every one of its vertices rounds to a
 * different boundary and the spans between them shear against each other. The
 * texture inside goes with them, and the surface swims.
 *
 * Measured on the default pitch, nudging the zoom by 2%: 37.7% of the turf's
 * pixels changed with the snap on, 3.0% with it off. The caps, the ball, the
 * fence and the goals all keep it — this is the floor and nothing else.
 */
const GROUND_SNAP = 0;

/** Board-plane y for the flat markings. Above the turf, below everything else. */
const MARK_Y = 0.03;

export class PitchView {
  /**
   * @param {import('../core/RetroMaterial.js').RetroMaterials} retro
   * @param {ReturnType<import('../game/layout/FootballPitch.js').FootballPitch['describe']>} description
   * @param {import('../game/layout/FootballPitch.js').FootballPitch} layout  for the
   *   live debug readouts only; the geometry all comes from `description`
   */
  constructor({ retro, description, config, layout }) {
    this.retro = retro;
    this.config = config;
    this.desc = description;
    this.layout = layout ?? null;

    this.root = new Group();
    this._geometries = [];
    this._materials = [];
    this._lineMaterials = [];

    this.turfTexture = makeTurfTexture();

    this._buildRunoff();
    this._buildTurf();
    this._buildMarkings();
    this._buildShapes();
    this._buildSensorOutlines();
    this._buildSearchMarks();
  }

  /** Called from the render loop; everything here that changes at runtime. */
  update() {
    if (this.sensorOutlines) this.sensorOutlines.visible = !!this.config.view.goalSensors;
    if (this.runoff) this.runoff.visible = this.config.view.showRunoff !== false;
    this._updateSearchMarks();
  }

  setWireframe(on) {
    for (const m of this._materials) m.wireframe = on;
    // The turf is a single flat sheet; in wireframe it becomes a dense mesh of
    // diagonals that swamps the markings, which are the only thing the
    // wireframe view is for.
    if (this.turf) this.turf.visible = !on;
  }

  // ── turf ─────────────────────────────────────────────────────────────────

  /**
   * The run-off, as its own slab under the pitch.
   *
   * A separate mesh rather than extra groups on the pitch's, because the
   * touchline has to be an exact edge. A quad belongs wholly to one material, so
   * a boundary running through the middle of the turf grid would be rounded to
   * the nearest quad and the tint would not line up with the line the out rule
   * is judged by — off by up to half a quad, which is most of a cap.
   */
  _buildRunoff() {
    const r = this.desc.runoff;
    if (!r) return;
    // SUBDIVIDED, for the same reason the pitch slab is and with the same
    // consequence for getting it wrong. This was two triangles spanning the
    // whole arena — 66 by 95 units — which is the exact worst case the pitch
    // slab's own comment warns about: affine UVs with no perspective correction
    // shear by an amount that grows with how much depth a single triangle
    // covers, so the grain slid across the ground every time the camera moved.
    const geo = grid(r.halfX, r.halfZ);
    this._geometries.push(geo);

    const mat = this.retro.create({
      map: this.turfTexture,
      color: RUNOFF_TINT,
      gloss: 0.05,
      snap: GROUND_SNAP,
    });
    this._materials.push(mat);
    this.runoff = new Mesh(geo, mat);
    // Below the pitch slab, which sits at -0.01. Both below the markings.
    this.runoff.position.y = -0.02;
    this.root.add(this.runoff);
  }

  _buildTurf() {
    const m = this.desc.metrics;
    // Exactly the pitch. The run-off is its own slab underneath, so this one
    // stops at the touchline and the mown bands divide the marked field rather
    // than the field plus whatever was around it.
    const halfX = m.halfX;
    const halfZ = m.halfZ;

    // SUBDIVIDED, and not for the lighting. UVs in this pipeline are
    // interpolated affinely — no perspective correction, which is the point —
    // and the error that introduces grows with how much `w` varies across one
    // triangle. Two triangles spanning the whole pitch is the worst case there
    // is: the grain would visibly shear across the field as the camera moved.
    // Tiles about the size of one texture repeat keep each triangle's depth
    // range small enough that the warp stays a texture. This is the same reason
    // the era's own floors were tessellated.
    //
    // ── the bands and the quads are ONE grid ─────────────────────────────
    // A quad belongs wholly to one mown band, so a band edge that falls inside a
    // quad cannot be drawn — it gets rounded to the nearest quad boundary and
    // twelve even stripes come out as a ragged run of ones and twos.
    //
    // So the count along the banded axis is derived from the bands rather than
    // checked against them: take the subdivision the texture wants, round it UP
    // to a whole number of quads per band, and the seams land on quad boundaries
    // by construction at any pitch size. Rounding up rather than down because a
    // finer grid only ever helps the affine-UV problem above.
    //
    // The banded axis is Z — the pitch's LENGTH. See `BAND_COUNT`.
    const wantZ = Math.max(8, Math.round((halfZ * 2) / TURF_TILE) * 3);
    const quadsPerBand = Math.max(1, Math.ceil(wantZ / BAND_COUNT));
    const nz = BAND_COUNT * quadsPerBand;
    const nx = Math.max(8, Math.round((halfX * 2) / TURF_TILE) * 3);

    const pos = [];
    const nor = [];
    const uv = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = -halfX + (i / nx) * halfX * 2;
        const z = -halfZ + (j / nz) * halfZ * 2;
        pos.push(x, 0, z);
        nor.push(0, 1, 0);
        // Tiled in world units, so the grain stays the same physical size
        // whatever the pitch is resized to.
        uv.push(x / TURF_TILE, z / TURF_TILE);
      }
    }

    // Two index lists, one per mown band parity. The band is counted straight
    // off the ROW index — the two grids are the same grid now, so there is no
    // world coordinate to round and every stripe is exactly `quadsPerBand` deep
    // and runs the full width.
    const idx = [[], []];
    const row = nx + 1;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const band = Math.floor(j / quadsPerBand) & 1;
        const a = j * row + i;
        idx[band].push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex([...idx[0], ...idx[1]]);
    geo.addGroup(0, idx[0].length, 0);
    geo.addGroup(idx[0].length, idx[1].length, 1);
    this._geometries.push(geo);

    const mats = BAND_TINT.map((color) =>
      this.retro.create({
        map: this.turfTexture,
        color,
        // Near-matte. Turf with any real specular reads as wet plastic, and a
        // highlight sliding across it under the fixed key light would compete
        // with the ball for attention.
        gloss: 0.06,
        snap: GROUND_SNAP,
      }),
    );
    this._materials.push(...mats);

    this.turf = new Mesh(geo, mats);
    // A hair below zero so the markings at y = 0.03 are unambiguously above it.
    this.turf.position.y = -0.01;
    this.root.add(this.turf);
  }

  // ── markings ─────────────────────────────────────────────────────────────

  _buildMarkings() {
    const mk = this.desc.markings;
    const v = [];

    const push = (x0, z0, x1, z1) => {
      v.push(x0, MARK_Y, z0, x1, MARK_Y, z1);
    };

    for (const loop of mk.loops) {
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        push(a[0], a[1], b[0], b[1]);
      }
    }
    for (const seg of mk.segments) push(seg[0][0], seg[0][1], seg[1][0], seg[1][1]);

    for (const c of mk.circles) arc(push, c.x, c.z, c.r, 48);
    // Spots, as tiny rings. A single point would be one pixel at the far zoom
    // and gone entirely under the quantiser.
    for (const s of mk.spots) arc(push, s.x, s.z, this.desc.metrics.lineWidth * 2, 8);

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(v, 3));
    this._geometries.push(geo);

    const mat = new LineBasicMaterial({ color: LINE_COLOR, fog: false });
    this._lineMaterials.push(mat);
    this.markings = new LineSegments(geo, mat);
    this.root.add(this.markings);
  }

  // ── fence, net, frame ────────────────────────────────────────────────────

  _buildShapes() {
    const byKind = {
      fence: this.retro.create({ color: FENCE_COLOR, gloss: 0.3 }),
      // Netting reads as a pale surface rather than as a mesh: at this internal
      // resolution an actual net texture is finer than the pixel grid and
      // collapses into a flat grey anyway, so it is drawn as what it collapses
      // to and the frame carries the shape.
      net: this.retro.create({ color: NET_COLOR, gloss: 0.15 }),
      frame: this.retro.create({ color: FRAME_COLOR, gloss: 0.6 }),
    };
    this._materials.push(...Object.values(byKind));

    /**
     * A goal painted in the colour of whoever has to defend it.
     *
     * The pitch is symmetrical, both ends look the same, and the camera turns
     * freely — so "which goal is mine" was a thing to remember rather than a
     * thing to see, and remembering it wrongly costs a goal. The frame takes the
     * player's own colour outright; the net takes a washed-out version of it,
     * because a fully saturated net behind a fully saturated frame turns the
     * whole end of the pitch into one block of colour and the mouth stops
     * reading as an opening.
     */
    const goalMaterials = PLAYER_COLORS.map((hex) => ({
      frame: this.retro.create({ color: hex, gloss: 0.6 }),
      net: this.retro.create({ color: washed(hex), gloss: 0.15 }),
    }));
    for (const set of goalMaterials) this._materials.push(set.frame, set.net);

    for (const s of this.desc.shapes) {
      // The undrawn half of the box. It is in the shape list because the list is
      // a complete account of what was built; the decision not to draw it is
      // made here, once, where it can be seen. `FootballPitch` explains why it
      // exists — turn on the collider wireframe to look at it.
      if (s.kind === 'shell') continue;

      const geo =
        s.shape === 'cylinder'
          ? new CylinderGeometry(s.radius, s.radius, s.halfHeight * 2, 8, 1)
          : new BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2);
      this._geometries.push(geo);

      const owned = s.defender !== undefined ? goalMaterials[s.defender % 2]?.[s.kind] : null;
      const mesh = new Mesh(geo, owned ?? byKind[s.kind] ?? byKind.fence);
      mesh.position.set(s.cx, s.cy, s.cz);
      // The corner fans are the only turned pieces. Same convention the
      // collider uses — a rotation about +Y — so the drawn box sits exactly on
      // the one the ball hits.
      mesh.rotation.y = s.rotY ?? 0;
      this.root.add(mesh);
    }
  }

  // ── the goal sensors, when asked for ─────────────────────────────────────

  /**
   * Every spot the respawn search looked at, green where it was free.
   *
   * Debug only, and the reason it exists is that the search is invisible when it
   * works: the ball simply appears somewhere sensible, and there is no way to
   * tell a good answer from a lucky one. Drawn as a fixed-capacity buffer that
   * is refilled rather than rebuilt, because it changes on turn boundaries.
   */
  _buildSearchMarks() {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(MAX_SEARCH_MARKS * 6 * 3), 3));
    geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(MAX_SEARCH_MARKS * 6 * 3), 3));
    this._geometries.push(geo);
    const mat = new LineBasicMaterial({ vertexColors: true, fog: false, depthTest: false, transparent: true, opacity: 0.9 });
    this._lineMaterials.push(mat);
    this.searchMarks = new LineSegments(geo, mat);
    this.searchMarks.renderOrder = 11;
    this.searchMarks.frustumCulled = false;
    this.searchMarks.visible = false;
    this.root.add(this.searchMarks);
    this._okColor = new Color(SEARCH_OK);
    this._badColor = new Color(SEARCH_BLOCKED);
  }

  _updateSearchMarks() {
    const marks = this.searchMarks;
    if (!marks) return;
    const on = !!this.config.respawn?.showSearch && !!this.layout?.lastSearch?.length;
    marks.visible = on;
    if (!on) return;

    const tried = this.layout.lastSearch;
    const n = Math.min(MAX_SEARCH_MARKS, tried.length);
    const pos = marks.geometry.getAttribute('position');
    const col = marks.geometry.getAttribute('color');
    const r = this.desc.metrics.lineWidth * 6;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const t = tried[i];
      const c = t.ok ? this._okColor : this._badColor;
      // A little cross, so a blocked spot and a free one are told apart by
      // colour and a dense cluster still reads as separate points.
      for (const [dx, dz] of [[-r, 0], [r, 0], [0, -r], [0, r]]) {
        pos.array[w] = t.x + dx;
        pos.array[w + 1] = MARK_Y + 0.02;
        pos.array[w + 2] = t.z + dz;
        col.array[w] = c.r;
        col.array[w + 1] = c.g;
        col.array[w + 2] = c.b;
        w += 3;
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    marks.geometry.setDrawRange(0, n * 4);
  }

  _buildSensorOutlines() {
    const boxes = Object.values(this.desc.sensorBoxes ?? {});
    if (!boxes.length) return;

    const v = [];
    for (const b of boxes) {
      const x0 = b.cx - b.hx;
      const x1 = b.cx + b.hx;
      const y0 = b.cy - b.hy;
      const y1 = b.cy + b.hy;
      const z0 = b.cz - b.hz;
      const z1 = b.cz + b.hz;
      const c = [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
      ];
      const edges = [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ];
      for (const [a, d] of edges) v.push(...c[a], ...c[d]);
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(v, 3));
    this._geometries.push(geo);

    const mat = new LineBasicMaterial({
      color: SENSOR_COLOR,
      fog: false,
      // Through the net and the crossbar: the point of the toggle is to see
      // exactly where a goal starts counting, and half of that volume is behind
      // solid geometry.
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    this._lineMaterials.push(mat);

    this.sensorOutlines = new LineSegments(geo, mat);
    this.sensorOutlines.renderOrder = 9;
    this.sensorOutlines.frustumCulled = false;
    this.sensorOutlines.visible = false;
    this.root.add(this.sensorOutlines);
  }

  dispose() {
    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) m.dispose();
    for (const m of this._lineMaterials) m.dispose();
    this.turfTexture.dispose();
    this._geometries.length = 0;
    this._materials.length = 0;
    this._lineMaterials.length = 0;
  }
}

/**
 * A flat, upward-facing, UV-tiled grid of quads.
 *
 * Shared by the pitch slab and the run-off so that the run-off cannot quietly
 * end up as two triangles again. `TURF_TILE` sets both the UV scale and the
 * subdivision: about three quads per texture repeat, which keeps the depth range
 * of any one triangle small enough that affine UVs stay a texture instead of
 * becoming a special effect.
 *
 * Wound (bl, tl, br) then (br, tl, tr). The other way round is back-facing here
 * and fails silently — the mesh exists, reports visible, carries the right
 * material, and draws nothing.
 */
function grid(halfX, halfZ, opts = {}) {
  const nx = opts.nx ?? Math.max(4, Math.round((halfX * 2) / TURF_TILE) * 3);
  const nz = opts.nz ?? Math.max(4, Math.round((halfZ * 2) / TURF_TILE) * 3);

  const pos = [];
  const nor = [];
  const uv = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = -halfX + (i / nx) * halfX * 2;
      const z = -halfZ + (j / nz) * halfZ * 2;
      pos.push(x, 0, z);
      nor.push(0, 1, 0);
      uv.push(x / TURF_TILE, z / TURF_TILE);
    }
  }
  const idx = [];
  const row = nx + 1;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * row + i;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** Push a closed polygon approximating a circle onto a segment list. */
function arc(push, cx, cz, r, segments) {
  let px = cx + r;
  let pz = cz;
  for (let i = 1; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    push(px, pz, x, z);
    px = x;
    pz = z;
  }
}

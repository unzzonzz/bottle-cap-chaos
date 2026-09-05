import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
} from 'three';
import { makeBoardTexture, BOARD_TILE } from './boardTexture.js';
import { PALETTE } from '../core/palette.js';

/**
 * The curling table, drawn.
 *
 * ── the same wood as the survival board, from the same function ─────────────
 * The table was brushed aluminium and is now a plank, and it is the survival
 * board's plank: `makeBoardTexture` and `BOARD_TILE`, imported rather than
 * reimplemented. That is the point of it. Two modes with two different woods
 * read as two different games, and the difference would not be a style — it
 * would be an accident of two functions drifting apart, which is what a second
 * wood texture guarantees the moment either one is touched.
 *
 * So there is no curling wood. There is THE wood, at the same world scale, and
 * the table is a longer piece of it.
 *
 * ── the target line is the loudest thing on the table ────────────────────────
 * "이 라인이 시각적으로 명확해야 한다. 여기가 게임의 전부다." So it is not a
 * hairline. `LineBasicMaterial` gives one device pixel whatever the projection,
 * and one pixel on a 320-wide framebuffer that is then dithered and quantised is
 * a dashed suggestion. The line is filled geometry, two rows deep.
 *
 * It is a racing chequer rather than the red bar it used to be, because what it
 * has to say changed. The line was the far edge and the bar meant "stop"; the
 * line now sits inland with table on both sides, and a chequered flag is the
 * mark you aim AT — which is the rule as it now stands. See `_buildTargetBand`.
 *
 * ── and it MOVES, which is why so little of this is built once ──────────────
 * `targetZ` is drawn fresh every round. The band is therefore built once, at the
 * origin, and slid — `update` watches the metrics for a change and re-places it.
 * The metrics object it watches is the layout's own, handed over by `describe()`
 * and mutated in place by `CurlingTable.setTargetFrac` precisely so that this
 * view and the judge cannot end up looking at two different lines.
 *
 * ── one marking, where there were three ─────────────────────────────────────
 * The throw line and the outline of the flat are gone; see
 * `curlingTableMarkings`, which stopped returning them. What is left on the flat
 * is the one mark that decides anything, which is the only way a chequer at this
 * distance stays readable.
 *
 * ── nothing here is a collider ──────────────────────────────────────────────
 * "시각 요소일 뿐 물리 충돌 없음." The markings are geometry in this file and
 * numbers in `curlingTableMetrics`, and there is no path from either to a body.
 */

/** The table's own colour lives in its texture; this is a tint on top. */
const WOOD_TINT = PALETTE.curling.tint;
/** The two squares of the target checkerboard. See `_buildTargetBand`. */
const TARGET_DARK = PALETTE.curling.targetDark;
const TARGET_LIGHT = PALETTE.curling.targetLight;

/**
 * How many squares the checkerboard is cut into across the table's width.
 *
 * EVEN, which is the whole reason this is a count and not a size. An odd count
 * puts a square straddling the centre of the table and brings both ends of the
 * band out the same colour, so the board reads as having been laid from one
 * side. An even one divides the width exactly in half, and mirroring the band
 * about that centre maps it onto itself with its two rows exchanged — which for
 * a two-row chequer is the same figure. Nothing about it favours a side.
 *
 * A count rather than a world size, so the squares scale with the table: at the
 * default 33.6-unit width a square is 0.99 units, within a hair of the 0.84-unit
 * red band this replaced, and the band is two rows deep — the squares have to be
 * square — so it comes out at twice that. The width slider runs 5 to 18 cap
 * diameters and the squares follow it, exactly as the old band's own fraction
 * of the width did.
 */
const TARGET_CELLS = 34;
/** The bottom of the rim, dimmer still — so the drop has a visible end. */
const APRON_COLOR = PALETTE.curling.apron;
/** The guides, when the panel asks. Matching the other views' pink. */
const GUIDE_COLOR = PALETTE.curling.guide;


/** Board-plane y for the flat markings. Above the wood, below everything else. */
const MARK_Y = 0.03;

export class CurlingTableView {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {ReturnType<import('../game/layout/CurlingTable.js').CurlingTable['describe']>} description
   */
  constructor({ retro, description, config }) {
    this.retro = retro;
    this.config = config;
    this.desc = description;

    this.root = new Group();
    this._geometries = [];
    this._materials = [];
    this._lineMaterials = [];

    this.woodTexture = makeBoardTexture();

    this._buildSlab();
    this._buildTargetBand();
    this._buildMarkings();
    this._buildGuides();
  }

  /** Called from the render loop; everything here that changes at runtime. */
  update() {
    // The round's line. Cheap enough to check every frame, and checking is what
    // means nothing has to remember to tell this view that the round rolled
    // over — see `_placeTargetBand`.
    this._placeTargetBand();
    if (this.guides) this.guides.visible = !!this.config.view.curlingGuides;
  }

  setWireframe(on) {
    for (const m of this._materials) m.wireframe = on;
    // The slab is a dense grid of quads; in wireframe it becomes a mesh of
    // diagonals that swamps the markings, which are the only thing the
    // wireframe view is for. Same call `PitchView` and the old lane made.
    if (this.slab) this.slab.visible = !on;
  }

  // ── the table ────────────────────────────────────────────────────────────

  /**
   * The slab: flat on top out to the edges, then tipping away on all four sides.
   *
   * Subdivided rather than drawn as two triangles, and NOT for lighting. UVs in
   * this pipeline are interpolated affinely and the error grows with how much
   * depth a single triangle covers, so two triangles spanning a fifty-unit table
   * would make the grain visibly shear as the camera moved. Tiles about one
   * texture repeat across keep the warp a texture rather than a special effect.
   * The same construction `PitchView` and the survival board use, and the same
   * `round(span / TILE) * 3` idiom — the tile constant sets the subdivision as
   * well as the UV divisor.
   *
   * Normals are taken from the height field by central difference rather than
   * written out per region. The surface has a flat, four ramps and four corner
   * wedges, and hand-authoring nine cases is nine chances to get a sign wrong in
   * a way that shows up only as one edge of the table being lit from the wrong
   * side.
   */
  _buildSlab() {
    const m = this.desc.metrics;
    const halfX = m.outerHalfX;
    const halfZ = m.outerHalfZ;

    const nx = Math.max(6, Math.round((halfX * 2) / BOARD_TILE) * 3);
    const nz = Math.max(6, Math.round((halfZ * 2) / BOARD_TILE) * 3);

    const height = (x, z) => {
      const past = Math.max(
        (Math.abs(x) - m.halfX) / m.slopeRun,
        (Math.abs(z) - m.halfZ) / m.slopeRun,
      );
      return -m.thickness * Math.max(0, Math.min(1, past));
    };

    const pos = [];
    const nor = [];
    const uv = [];
    // A tenth of the smaller cell, so the difference straddles the crease at the
    // rim rather than sampling twice inside one face of it.
    const eps = Math.min((halfX * 2) / nx, (halfZ * 2) / nz) * 0.1;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = -halfX + (i / nx) * halfX * 2;
        const z = -halfZ + (j / nz) * halfZ * 2;
        pos.push(x, height(x, z), z);

        const dx = (height(x + eps, z) - height(x - eps, z)) / (2 * eps);
        const dz = (height(x, z + eps) - height(x, z - eps)) / (2 * eps);
        const len = Math.hypot(-dx, 1, -dz) || 1;
        nor.push(-dx / len, 1 / len, -dz / len);

        // World-unit UVs, so the grain stays the same physical size whatever the
        // table is resized to.
        uv.push(x / BOARD_TILE, z / BOARD_TILE);
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
    this._geometries.push(geo);

    const mat = this.retro.create({
      map: this.woodTexture,
      // WHITE. `uColor` multiplies the map, and the map is already painted in
      // the final honey tones — tinting it with those same tones would square
      // them and take the table to near-black. The survival board's own
      // `BOARD_TINT` records having made exactly that mistake.
      color: WOOD_TINT,
      /**
       * A lacquered surface rather than the near-matte it was.
       *
       * The old note is worth keeping in mind and no longer applies: the
       * highlight was baked into the texture and a per-vertex specular on top of
       * it made a second, blotchier one that slid against the baked one as the
       * camera turned. There is no per-vertex specular now — the highlight comes
       * from a real environment reflection, which moves the way a reflection
       * should — so the surface can have one.
       */
      preset: 'lacqueredWood',
    });
    this._materials.push(mat);

    this.slab = new Mesh(geo, mat);
    // 테이블은 받기만 한다.
    this.slab.receiveShadow = true;
    this.root.add(this.slab);
  }

  /**
   * The target line, as a two-row racing chequer.
   *
   * ── built at the origin and slid, because the line moves ─────────────────
   * Every vertex here is written relative to z = 0 and the whole band is then
   * placed with `position.z`. The line lands somewhere new every round, and
   * rebuilding two dozen quads four times a match to move them by a few units
   * would be a geometry churn that buys nothing — worse, it would be a second
   * place where the band's z is computed, and the one thing this file must not
   * do is arrive at a different answer from the judge. One assignment, in
   * `_placeTargetBand`, off the metrics the rules themselves measure to.
   *
   * ── two rows, and the squares are square ─────────────────────────────────
   * The width is cut into `TARGET_CELLS` squares and the band is two of them
   * deep, so a square is a square and the thing reads as a chequered flag
   * rather than as a dashed line. See `TARGET_CELLS` for why the count is even.
   *
   * ── centred ON the line, not hanging off one side ────────────────────────
   * The old red bar sat on the far edge and reached inward only, because half a
   * bar over the slope would have drawn the line somewhere it was not. There is
   * no slope here any more — the line is inland with table on both sides — and
   * the rule is now symmetric: a cap short of the line and a cap the same
   * distance past it are equally close. A band centred on the line says that;
   * one reaching inward only would say the near side was the side that counted.
   *
   * ── two meshes, one per colour ───────────────────────────────────────────
   * Rather than one mesh with vertex colours, because `GlossMaterials` takes a
   * flat `color` and adding a vertex-colour path to it for one chequerboard
   * would put a branch in every material in the project. Two draw calls of a
   * few dozen triangles is not a cost worth a shader for.
   */
  _buildTargetBand() {
    const m = this.desc.metrics;

    const cells = Math.max(2, Math.round(TARGET_CELLS / 2) * 2);
    const cell = (m.halfX * 2) / cells;

    const dark = [];
    const light = [];
    for (let j = 0; j < 2; j++) {
      // Row 0 is the near half of the band, row 1 the far half — so the band
      // straddles the line rather than sitting to one side of it.
      const z0 = (j - 1) * cell;
      const z1 = j * cell;
      for (let i = 0; i < cells; i++) {
        const x0 = -m.halfX + i * cell;
        const x1 = x0 + cell;
        const into = (i + j) % 2 === 0 ? dark : light;
        into.push(
          x0, MARK_Y, z0,
          x0, MARK_Y, z1,
          x1, MARK_Y, z0,
          x1, MARK_Y, z0,
          x0, MARK_Y, z1,
          x1, MARK_Y, z1,
        );
      }
    }

    this.targetBand = new Group();
    this.targetBand.add(this._quads(dark, TARGET_DARK), this._quads(light, TARGET_LIGHT));
    this.root.add(this.targetBand);

    /** Where the band is currently standing. Compared against, never trusted. */
    this._bandZ = null;
    this._placeTargetBand();
  }

  /**
   * Slide the band onto the round's line, if it is not already there.
   *
   * The metrics object is the layout's own and is mutated in place when the
   * round draws a new line, so this is a read of the live number rather than of
   * a copy that could be stale. Guarded on the value rather than on a dirty flag
   * because a flag is a second thing to keep true, and the comparison is one
   * float against another once a frame.
   */
  _placeTargetBand() {
    const z = this.desc.metrics.targetZ;
    if (z === this._bandZ) return;
    this._bandZ = z;
    if (this.targetBand) this.targetBand.position.z = z;
    if (this.targetGuide) this.targetGuide.position.z = z;
  }

  /**
   * A list of triangles as one flat-shaded mesh.
   *
   * No map, and `matte`: these are painted marks and the one thing they must not
   * do is pick up a highlight that makes part of a square brighter than the rest
   * of it — on a chequer that would read as a square of a third colour.
   */
  _quads(vertices, color) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    const n = [];
    for (let i = 0; i < vertices.length / 3; i++) n.push(0, 1, 0);
    geo.setAttribute('normal', new Float32BufferAttribute(n, 3));
    this._geometries.push(geo);

    const mat = this.retro.create({ color, preset: 'matte' });
    this._materials.push(mat);
    return new Mesh(geo, mat);
  }

  // ── markings ─────────────────────────────────────────────────────────────

  /**
   * What is left after the throw line and the flat's outline were deleted.
   *
   * Just the apron, which is not a rule and never was: it is the bottom of the
   * rim, and without it the drop has no visible end and the table looks like it
   * fades out into the background rather than stopping.
   *
   * The two that went were both marks on the FLAT, and both were competing with
   * the target band for the same glance. The throw line labelled a spot no
   * player chooses — every cap is dealt there — and the outline drew a boundary
   * the table's own silhouette states better than a hairline can. See
   * `curlingTableMarkings`, which no longer returns either.
   */
  _buildMarkings() {
    const m = this.desc.metrics;

    const apron = [];
    const c = [
      [-m.outerHalfX, -m.outerHalfZ],
      [m.outerHalfX, -m.outerHalfZ],
      [m.outerHalfX, m.outerHalfZ],
      [-m.outerHalfX, m.outerHalfZ],
    ];
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      apron.push(a[0], -m.thickness + 0.02, a[1], b[0], -m.thickness + 0.02, b[1]);
    }
    this.apron = this._lines(apron, APRON_COLOR);
  }

  _lines(vertices, color) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    this._geometries.push(geo);
    const mat = new LineBasicMaterial({ color, fog: false });
    this._lineMaterials.push(mat);
    const seg = new LineSegments(geo, mat);
    this.root.add(seg);
    return seg;
  }

  // ── the guides, when asked for ───────────────────────────────────────────

  /**
   * The two things the rules actually ask about, drawn through everything.
   *
   * The target line as a standing plane, because it is a line on the ground and
   * every distance in the mode is measured perpendicular to it — seen from above
   * a mark on the floor and the line itself are the same picture, and the point
   * of the toggle is to check that they agree. And the fall volume as a box,
   * clipped to something that fits on screen: the real sensor is 1200 units
   * across because a cap has to land in it from anywhere, and drawing that would
   * be a rectangle somewhere off past the horizon. Its TOP is the number that
   * matters — how far a cap has to get below the table before it counts as
   * fallen — so the box is drawn at the table's own footprint with the sensor's
   * real height.
   */
  _buildGuides() {
    const m = this.desc.metrics;
    const v = [];

    /**
     * The target plane, at the ORIGIN, and slid by `_placeTargetBand` with the
     * band it is checking.
     *
     * Split into its own object rather than left in the list below, because the
     * line moves every round and the pit box does not. Drawn where the band is
     * drawn, from the same one number — which is the entire point of the toggle:
     * if the plane and the chequer ever separate on screen, the view and the
     * judge have come apart and this is what says so.
     */
    const plane = [];
    const high = Math.max(2, m.thickness * 3);
    for (const x of [-m.halfX, m.halfX]) plane.push(x, 0, 0, x, high, 0);
    plane.push(-m.halfX, high, 0, m.halfX, high, 0);
    plane.push(-m.halfX, 0, 0, m.halfX, 0, 0);

    const pit = this.desc.pitBox;
    if (pit) {
      const x0 = -m.outerHalfX;
      const x1 = m.outerHalfX;
      const z0 = -m.outerHalfZ;
      const z1 = m.outerHalfZ;
      const y0 = pit.cy - pit.hy;
      const y1 = pit.cy + pit.hy;
      const c = [
        [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
        [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1],
      ];
      for (const [a, b] of [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ]) {
        v.push(...c[a], ...c[b]);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(v, 3));
    this._geometries.push(geo);
    const mat = new LineBasicMaterial({
      color: GUIDE_COLOR,
      fog: false,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    this._lineMaterials.push(mat);

    this.guides = new LineSegments(geo, mat);
    this.guides.renderOrder = 9;
    this.guides.frustumCulled = false;
    this.guides.visible = false;
    this.root.add(this.guides);

    const pgeo = new BufferGeometry();
    pgeo.setAttribute('position', new Float32BufferAttribute(plane, 3));
    this._geometries.push(pgeo);
    this.targetGuide = new LineSegments(pgeo, mat);
    this.targetGuide.renderOrder = 9;
    this.targetGuide.frustumCulled = false;
    this.guides.add(this.targetGuide);
    // Built after the band, so the band's first placement missed it. Placed now,
    // and every round after this by the same call.
    this._bandZ = null;
    this._placeTargetBand();
  }

  dispose() {
    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) m.dispose();
    for (const m of this._lineMaterials) m.dispose();
    this.woodTexture.dispose();
    this._geometries.length = 0;
    this._materials.length = 0;
    this._lineMaterials.length = 0;
  }
}

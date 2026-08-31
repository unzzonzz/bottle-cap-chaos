import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
} from 'three';
import { makeMetalTexture, METAL_TILE } from './metalTexture.js';
import { PALETTE } from '../core/palette.js';

/**
 * The curling table, drawn.
 *
 * ── the target line is the loudest thing on the table ────────────────────────
 * "목표 지점은 책상의 반대편 끝 가장자리 … 이 라인이 시각적으로 명확해야 한다.
 * 여기가 게임의 전부다." So it is not a hairline. `LineBasicMaterial` gives one
 * device pixel whatever the projection, and one pixel on a 320-wide framebuffer
 * that is then dithered and quantised is a dashed suggestion — the old lane's
 * house rings were filled discs for exactly this reason. The target line is a
 * flat quad a real world-space width across, so it is the same object at every
 * zoom and cannot thin out to nothing.
 *
 * The other three edges are lines, and dim ones. Falling off them costs a cap
 * exactly as much, but nobody is aiming at them and drawing all four the same
 * would say the table has four target lines.
 *
 * ── it has no colliders in it, and it cannot get one ─────────────────────────
 * Every line and quad here is geometry in a `Group`. There is no path by which
 * one becomes a body: "라인은 시각 요소일 뿐 물리 충돌 없음", and the strongest
 * way to honour that is for the markings to exist nowhere but in
 * `curlingTableMarkings` and here.
 *
 * ── the slab is drawn from the same numbers the collider was built from ──────
 * Not from the collider, because a round convex hull has no vertex list worth
 * reading, but from the same `metrics` — one module, called twice. The rim in
 * particular has to be honest: it is the fall, and a drawn edge in a different
 * place from the real one would have the player playing to a line that is not
 * there. Same discipline `PitchView` states at length for its fence.
 */

/** The table's own colour lives in its texture; this is a tint on top. */
const METAL_TINT = PALETTE.curling.tint;
/** The target line. The single most important thing on screen. */
const TARGET_COLOR = PALETTE.curling.targetLine;
/**
 * Where a cap is dealt. Present, not shouting.
 *
 * Deliberately dimmer than the target line, and it started out brighter — which
 * inverted the whole table: the throw line is where every cap starts and is
 * therefore obvious anyway, and having it out-shout the one line the game is
 * played to made the far end read as an edge rather than as a target.
 */
const THROW_COLOR = PALETTE.curling.throwLine;
/** The other three edges of the flat. Dim: a hazard, not a target. */
const EDGE_COLOR = PALETTE.curling.edge;
/** The bottom of the rim, dimmer still — so the drop has a visible end. */
const APRON_COLOR = PALETTE.curling.apron;
/** The guides, when the panel asks. Matching the other views' pink. */
const GUIDE_COLOR = PALETTE.curling.guide;

/**
 * The ground's share of the vertex wobble. Zero, and for the reason `PitchView`
 * measured: the snap is the look on an OBJECT, whose vertices land on the same
 * few pixels and shiver together, and it is a swimming mess on a plane spanning
 * the screen, where every vertex rounds to a different boundary and the spans
 * shear against each other.
 */
const GROUND_SNAP = 0;

/** Board-plane y for the flat markings. Above the metal, below everything else. */
const MARK_Y = 0.03;

export class CurlingTableView {
  /**
   * @param {import('../core/RetroMaterial.js').RetroMaterials} retro
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

    this.metalTexture = makeMetalTexture();

    this._buildSlab();
    this._buildTargetLine();
    this._buildMarkings();
    this._buildGuides();
  }

  /** Called from the render loop; everything here that changes at runtime. */
  update() {
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

    const nx = Math.max(6, Math.round((halfX * 2) / METAL_TILE) * 3);
    const nz = Math.max(6, Math.round((halfZ * 2) / METAL_TILE) * 3);

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
        uv.push(x / METAL_TILE, z / METAL_TILE);
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
      map: this.metalTexture,
      // WHITE, not a metal grey. `uColor` multiplies the map, and the map is
      // already painted in the final aluminium tones — tinting it with those
      // same tones would square them and take the table to near-black. Same
      // mistake the survival board's `BOARD_TINT` records having made.
      color: METAL_TINT,
      // Near-matte. The metal's highlight is in the texture; see the header of
      // `metalTexture`. Left at anything real, the per-vertex specular puts a
      // second, blotchier highlight on top of the baked one and the two slide
      // against each other as the camera turns.
      gloss: 0.06,
      snap: GROUND_SNAP,
    });
    this._materials.push(mat);

    this.slab = new Mesh(geo, mat);
    this.root.add(this.slab);
  }

  /**
   * The target line, as a flat band rather than a line.
   *
   * Width is a fraction of the table's own width, so it is the same relative
   * weight on a narrow table and a wide one. The fraction is measured rather
   * than chosen: the table runs about 4.95 target pixels per world unit framed
   * whole, so 2.5% of the default 33.6-unit width is 0.84 units and a little
   * over four pixels — thick enough to survive the dither, thin enough that it
   * is a line and not a zone. At the 0.8% it started as it was one pixel, which
   * is to say a dashed suggestion. Sitting on the far edge and reaching INWARD only
   * — a band that straddled the edge would have half of itself hanging over a
   * slope, which is the one place a cap can be while its distance is still being
   * measured, and it would read as the line being somewhere it is not.
   */
  _buildTargetLine() {
    const m = this.desc.metrics;
    const w = Math.max(0.5, m.width * 0.025);

    const z0 = m.targetZ - w;
    const z1 = m.targetZ;
    const geo = new BufferGeometry();
    geo.setAttribute(
      'position',
      new Float32BufferAttribute(
        [
          -m.halfX, MARK_Y, z0,
          -m.halfX, MARK_Y, z1,
          m.halfX, MARK_Y, z0,
          m.halfX, MARK_Y, z0,
          -m.halfX, MARK_Y, z1,
          m.halfX, MARK_Y, z1,
        ],
        3,
      ),
    );
    geo.setAttribute(
      'normal',
      new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3),
    );
    this._geometries.push(geo);

    // No map, and `gloss` at zero: this is a painted mark and the one thing it
    // must not do is pick up a highlight that makes part of it brighter than the
    // rest. Flat colour, shaded only by the scene's own lighting.
    const mat = this.retro.create({ color: TARGET_COLOR, gloss: 0, snap: GROUND_SNAP });
    this._materials.push(mat);

    this.targetLine = new Mesh(geo, mat);
    this.root.add(this.targetLine);
  }

  // ── markings ─────────────────────────────────────────────────────────────

  _buildMarkings() {
    const m = this.desc.metrics;
    const mk = this.desc.markings;

    const seg = (into, s) => into.push(s[0][0], MARK_Y, s[0][1], s[1][0], MARK_Y, s[1][1]);

    const throwLine = [];
    seg(throwLine, mk.throwLine);
    this.throwLine = this._lines(throwLine, THROW_COLOR);

    const edges = [];
    for (const e of mk.edges) seg(edges, e);
    this.edges = this._lines(edges, EDGE_COLOR);

    // The bottom of the rim, all the way round. Not a rule — the edges above are
    // — but without it the drop has no visible end and the table looks like it
    // simply fades out into the background.
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

    const high = Math.max(2, m.thickness * 3);
    for (const x of [-m.halfX, m.halfX]) v.push(x, 0, m.targetZ, x, high, m.targetZ);
    v.push(-m.halfX, high, m.targetZ, m.halfX, high, m.targetZ);
    v.push(-m.halfX, 0, m.targetZ, m.halfX, 0, m.targetZ);

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
  }

  dispose() {
    for (const g of this._geometries) g.dispose();
    for (const m of this._materials) m.dispose();
    for (const m of this._lineMaterials) m.dispose();
    this.metalTexture.dispose();
    this._geometries.length = 0;
    this._materials.length = 0;
    this._lineMaterials.length = 0;
  }
}

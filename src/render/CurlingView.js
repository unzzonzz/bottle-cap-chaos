import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
} from 'three';
import { ICE_TILE, makeIceTexture } from './iceTexture.js';

/**
 * The curling lane, drawn.
 *
 * ── the fences come from the COLLIDERS, not from the metrics ─────────────────
 * Every box here is read out of `description.shapes`, which `CurlingLane` fills
 * in as it creates each collider. Nothing in this file works out where a wall
 * goes. That is the same discipline `PitchView` states and it is the whole of
 * "벽은 눈에 보여야 한다": a wall you can see is only useful if what you see is
 * where the collision is, and the reliable way to get a fence drawn 2.2 tall
 * against a collider 3.0 tall is to derive both from the same numbers twice and
 * then change one of them.
 *
 * The shell above the fence and the lid over the lane are the exceptions and are
 * skipped rather than absent: they are containment backstops nothing reaches in
 * play, and drawing them would put an opaque box round the game. Turn on the
 * collider wireframe and they are there.
 *
 * ── the house rings have no colliders and cannot get one ─────────────────────
 * They are `LineSegments` here and a list of radii in `curlingMetrics`. There is
 * no path by which one becomes a body and no place where one carries a score:
 * "링은 시각 요소일 뿐 물리 충돌 없음 ... 개수 방식이므로". The rings say where
 * the house IS; the single sensor says who is in it.
 *
 * ── the run-off is a different surface, visibly ──────────────────────────────
 * Past either out line the ground is tinted down and the line itself is drawn
 * bright. The overshoot penalty is the only thing holding a full-power throw
 * back, so where it starts has to be the most legible thing on the lane after
 * the house.
 */

/** The lines. The brightest thing on the lane. */
const LINE_COLOR = '#e8f2f6';
/** The out lines specifically — the two that end a cap's match. */
const OUT_LINE_COLOR = '#f0d090';
/** Ice. Pale, near-white, a step in from pure so the quantiser has somewhere to go. */
const ICE_TINT = '#dfe9f0';
/** Past the lines. One step down, so the boundary is a change of surface. */
const RUNOFF_TINT = '#8d9aa6';
const FENCE_COLOR = '#6e7a8c';
/** The sensor outlines, when the panel asks. Matching `PitchView`'s pink. */
const SENSOR_COLOR = '#ff7fd0';
/** The house rings, alternating, from the outside in. */
const RING_COLORS = ['#4f7fb8', '#e8f2f6', '#c0433c', '#e8f2f6'];

/**
 * The ground's share of the vertex wobble. Zero, and for the reason `PitchView`
 * measured: the snap is the look on an OBJECT, whose vertices land on the same
 * few pixels and shiver together, and it is a swimming mess on a plane spanning
 * the screen, where every vertex rounds to a different boundary and the spans
 * shear against each other.
 */
const GROUND_SNAP = 0;

/** Board-plane y for the flat markings. Above the ice, below everything else. */
const MARK_Y = 0.03;

export class CurlingView {
  /**
   * @param {import('../core/RetroMaterial.js').RetroMaterials} retro
   * @param {ReturnType<import('../game/layout/CurlingLane.js').CurlingLane['describe']>} description
   */
  constructor({ retro, description, config }) {
    this.retro = retro;
    this.config = config;
    this.desc = description;

    this.root = new Group();
    this._geometries = [];
    this._materials = [];
    this._lineMaterials = [];

    this.iceTexture = makeIceTexture();

    this._buildRunoff();
    this._buildIce();
    this._buildHouse();
    this._buildMarkings();
    this._buildShapes();
    this._buildSensorOutlines();
  }

  /** Called from the render loop; everything here that changes at runtime. */
  update() {
    if (this.sensorOutlines) {
      this.sensorOutlines.visible = !!this.config.view.curlingSensors;
    }
  }

  setWireframe(on) {
    for (const m of this._materials) m.wireframe = on;
    // The ice and the run-off are flat sheets; in wireframe they become a dense
    // mesh of diagonals that swamps the markings, which are the only thing the
    // wireframe view is for.
    if (this.ice) this.ice.visible = !on;
    if (this.runoff) this.runoff.visible = !on;
  }

  // ── the ground ───────────────────────────────────────────────────────────

  /**
   * Everything the ground covers, tinted as run-off.
   *
   * Drawn first and whole rather than as two strips past the lines, so there is
   * no seam down the middle of the lane where two meshes met. The ice sits on
   * top of it and covers the part that is in play.
   */
  _buildRunoff() {
    const m = this.desc.metrics;
    const geo = grid(m.halfX + m.wallThickness, m.outerHalfZ);
    this._geometries.push(geo);
    const mat = this.retro.create({
      map: this.iceTexture,
      color: RUNOFF_TINT,
      gloss: 0.05,
      snap: GROUND_SNAP,
    });
    this._materials.push(mat);
    this.runoff = new Mesh(geo, mat);
    this.runoff.position.y = -0.02;
    this.root.add(this.runoff);
  }

  /**
   * The lane itself: exactly between the two out lines.
   *
   * A separate mesh from the run-off rather than extra groups on one grid,
   * because the out line has to be an exact edge. A quad belongs wholly to one
   * material, so a boundary running through the middle of a shared grid would be
   * rounded to the nearest quad — off by up to half a quad, which is most of a
   * cap, from the line the removal rule is actually judged by.
   */
  _buildIce() {
    const m = this.desc.metrics;
    const geo = grid(m.halfX, m.halfZ);
    this._geometries.push(geo);
    const mat = this.retro.create({
      map: this.iceTexture,
      color: ICE_TINT,
      // Near-matte. Ice with a real specular reads as wet plastic, and a
      // highlight sliding along a lane this long under the fixed key light would
      // be the most distracting thing on screen.
      gloss: 0.08,
      snap: GROUND_SNAP,
    });
    this._materials.push(mat);
    this.ice = new Mesh(geo, mat);
    this.ice.position.y = -0.01;
    this.root.add(this.ice);
  }

  /**
   * The house, as filled concentric discs.
   *
   * Discs rather than rings-as-lines, because the house is the thing the whole
   * mode is aimed at and at minimum zoom a one-pixel outline of it disappears
   * into the dither. They are stacked outermost first at rising heights, each a
   * hair above the last, so the painter's order is the geometry's rather than a
   * `renderOrder` that would have to be kept in step with the ring count.
   *
   * Every one of them is drawn and NONE of them is a collider or a score. See
   * the header.
   */
  _buildHouse() {
    const m = this.desc.metrics;
    this.house = new Group();
    m.rings.forEach((r, i) => {
      const geo = new CylinderGeometry(r, r, 0.02, 28, 1);
      this._geometries.push(geo);
      const mat = this.retro.create({
        color: RING_COLORS[i % RING_COLORS.length],
        gloss: 0.05,
        snap: GROUND_SNAP,
      });
      this._materials.push(mat);
      const disc = new Mesh(geo, mat);
      // Stacked by a hundredth each, which is under the depth buffer's
      // resolution at this range but above the z-fighting threshold — and the
      // order is what actually decides it, since they are all drawn opaque and
      // sorted front to back by distance.
      disc.position.set(0, 0.004 + i * 0.006, m.houseZ);
      this.house.add(disc);
    });
    this.root.add(this.house);
  }

  // ── markings ─────────────────────────────────────────────────────────────

  _buildMarkings() {
    const mk = this.desc.markings;
    const m = this.desc.metrics;

    // Two line sets, because the two out lines are a different rule from the
    // rest and have to look like it: crossing one of them ends a cap's match,
    // and crossing the centre line does nothing at all.
    const plain = [];
    const out = [];
    const push = (into, x0, z0, x1, z1) => {
      into.push(x0, MARK_Y, z0, x1, MARK_Y, z1);
    };

    for (const seg of mk.segments) {
      const isOutLine = Math.abs(Math.abs(seg[0][1]) - m.halfZ) < 1e-6;
      push(isOutLine ? out : plain, seg[0][0], seg[0][1], seg[1][0], seg[1][1]);
    }
    for (const c of mk.circles) {
      arc((x0, z0, x1, z1) => push(plain, x0, z0, x1, z1), c.x, c.z, c.r, 40);
    }

    this.markings = this._lines(plain, LINE_COLOR);
    this.outLines = this._lines(out, OUT_LINE_COLOR);
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

  // ── the fences ───────────────────────────────────────────────────────────

  _buildShapes() {
    const fence = this.retro.create({ color: FENCE_COLOR, gloss: 0.3 });
    this._materials.push(fence);

    for (const s of this.desc.shapes) {
      // The undrawn half of the box. It is in the shape list because the list is
      // a complete account of what was built; the decision not to draw it is
      // made here, once, where it can be seen.
      if (s.kind === 'shell') continue;
      const geo = new BoxGeometry(s.hx * 2, s.hy * 2, s.hz * 2);
      this._geometries.push(geo);
      const mesh = new Mesh(geo, fence);
      mesh.position.set(s.cx, s.cy, s.cz);
      this.root.add(mesh);
    }
  }

  // ── the sensors, when asked for ──────────────────────────────────────────

  /**
   * The two volumes the rules actually ask about.
   *
   * The in-play box as a wireframe box and the house as a wireframe cylinder,
   * both drawn through everything in front of them — the point of the toggle is
   * to see exactly where a cap stops being on the lane, and half of each volume
   * is behind the fence.
   */
  _buildSensorOutlines() {
    const v = [];
    for (const b of Object.values(this.desc.sensorBoxes ?? {})) {
      if (b.shape === 'cylinder') {
        for (const y of [b.cy - b.hy, b.cy + b.hy]) {
          arc((x0, z0, x1, z1) => v.push(x0, y, z0, x1, y, z1), b.cx, b.cz, b.radius, 32);
        }
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const x = b.cx + Math.cos(a) * b.radius;
          const z = b.cz + Math.sin(a) * b.radius;
          v.push(x, b.cy - b.hy, z, x, b.cy + b.hy, z);
        }
        continue;
      }
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
      for (const [a, d] of [
        [0, 1], [1, 2], [2, 3], [3, 0],
        [4, 5], [5, 6], [6, 7], [7, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ]) {
        v.push(...c[a], ...c[d]);
      }
    }
    if (!v.length) return;

    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(v, 3));
    this._geometries.push(geo);
    const mat = new LineBasicMaterial({
      color: SENSOR_COLOR,
      fog: false,
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
    this.iceTexture.dispose();
    this._geometries.length = 0;
    this._materials.length = 0;
    this._lineMaterials.length = 0;
  }
}

/**
 * A flat, upward-facing, UV-tiled grid of quads.
 *
 * The same construction `PitchView` uses and for the same reason: UVs in this
 * pipeline are interpolated affinely, and the error that introduces grows with
 * how much depth a single triangle covers. Two triangles spanning a hundred-unit
 * lane is the worst case there is — the grain would visibly shear along it as
 * the camera moved. Tiles about one texture repeat across keep the warp a
 * texture instead of a special effect.
 *
 * Wound (bl, tl, br) then (br, tl, tr). The other way round is back-facing and
 * fails silently — the mesh exists, reports visible, and draws nothing.
 */
function grid(halfX, halfZ) {
  const nx = Math.max(4, Math.round((halfX * 2) / ICE_TILE) * 3);
  const nz = Math.max(4, Math.round((halfZ * 2) / ICE_TILE) * 3);

  const pos = [];
  const nor = [];
  const uv = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = -halfX + (i / nx) * halfX * 2;
      const z = -halfZ + (j / nz) * halfZ * 2;
      pos.push(x, 0, z);
      nor.push(0, 1, 0);
      uv.push(x / ICE_TILE, z / ICE_TILE);
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

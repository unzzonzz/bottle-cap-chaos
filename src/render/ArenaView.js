import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { buildCapGeometry, CAP_DEFAULTS, CAP_GROUP, MM } from '../cap/capGeometry.js';
import { makeCapTopTexture } from '../cap/capTexture.js';
import { BOARD_TILE, makeBoardTexture } from './boardTexture.js';
import { BALL_GROUP, buildBallGeometry } from './ballGeometry.js';
import { PitchView } from './PitchView.js';
import { CurlingView } from './CurlingView.js';

/**
 * Layer 3: the physics state, drawn.
 *
 * Strictly one-directional. This module reads transforms out of the arena and
 * writes them onto meshes; nothing here ever writes back. That is what lets the
 * physics run at 120 Hz on its own clock while the display runs at whatever the
 * monitor happens to be, and it is what makes the trajectory preview possible at
 * all — a preview is just this layer being pointed at a different world.
 *
 * ── interpolation ────────────────────────────────────────────────────────────
 * A 60 Hz frame lands between two 120 Hz steps as often as not, and drawing the
 * older of the two throws away half the simulation and reads as a judder that
 * looks exactly like a solver problem. So the arena keeps the previous and
 * current transform of every cap and this lerps across them by `alpha`.
 *
 * ── geometry is shared ───────────────────────────────────────────────────────
 * One `BufferGeometry` for all six caps, interior included.
 */

/** Player colours. Red is the traditional crown cap; blue is the other one. */
export const PLAYER_COLORS = ['#c8342f', '#3f7ec4'];

/**
 * Off-white PVC, the usual liner stock. Same value the viewer uses.
 *
 * Shared by both players rather than tinted with the cap, because a real liner
 * is not painted with the shell — tinting it is the fastest way to make the
 * inside read as moulded plastic instead of a fitted seal.
 */
const LINER_COLOR = '#ddd6c2';

/**
 * The cap, INTERIOR AND ALL.
 *
 * This used to build with `shell: false` on the reasoning that nothing in a game
 * mode ever looks inside a cap. That reasoning was simply wrong here: caps flip
 * when they go over the rim and land face down, and 367 of them did so across
 * 300 test shots. The underside is on screen constantly, and without the shell
 * it was a flat disc where the sheet's edge, the fluted inner wall, the panel's
 * underside and the liner's seal ring should be.
 *
 * It costs: 3024 triangles against 1176, so the phase-one in-game budget of 1500
 * is exceeded nearly twofold. Dropping `radialPerTooth` from 4 to 3 brings it to
 * about 2270 and is argued in capGeometry.js to be more period-correct anyway;
 * going to 2 would land back under 1500. Worth doing if the budget is real, but
 * the budget is not worth a cap with no inside.
 *
 * The COLLIDER is unaffected: it was always hollow, and it is sized from
 * `userData.radius`/`height`, neither of which the shell changes.
 */
export function buildGameCapGeometry() {
  return buildCapGeometry({ ...CAP_DEFAULTS, shell: true });
}

/** Radius and total height in world units, for the collider builder. */
export function capDimensions(geometry) {
  return { radius: geometry.userData.radius, height: geometry.userData.height };
}

/** The mat's own colour lives in its texture; this is just a tint on top. */
const BOARD_TINT = '#ffffff';
/** The out line. The single most important line on screen in the top-down view. */
const BOARD_EDGE_COLOR = '#f0e8c8';
/** Where the surface itself stops. Dim: it is not a rule, only a floor. */
const APRON_EDGE_COLOR = '#3a4250';
/**
 * Distance marks, one every four cap widths.
 *
 * Dimmer than they were: the weave now carries the fine-grain motion reference
 * these lines existed to provide, so all they still have to do is mark scale.
 * At the old brightness they sat on top of the mat rather than in it.
 */
const GRID_COLOR = '#333b47';

/**
 * The ball's two panel colours.
 *
 * Not pure black and pure white. The chain quantises to five bits a channel and
 * the pitch behind is dark, so a pure white panel is the brightest thing on
 * screen by a distance and pulls the eye off the caps; a pure black one goes to
 * the same value as the shadow under the goal. These are a step in from each
 * end, which survives the quantiser and still reads as a black-and-white ball.
 */
const BALL_LIGHT = '#e8e8e0';
const BALL_DARK = '#14161a';

export class ArenaView {
  /**
   * @param {import('../core/RetroMaterial.js').RetroMaterials} retro
   * @param {import('../game/Arena.js').Arena} arena
   */
  /**
   * @param {(player: number) => import('three').Texture} [panelTextureFor]
   *   The artwork each team's cap top wears, injected. Omitted, the caps fall
   *   back to the built-in placeholder — which is what the cap VIEWER and any
   *   caller with no mark book still wants. See the note where it is used.
   */
  constructor({ retro, arena, config, capGeometry, panelTextureFor = null }) {
    this.retro = retro;
    this.arena = arena;
    this.config = config;

    this.root = new Group();

    // Handed in rather than built here: the arena needs the cap's radius and
    // height before any of this exists, so the geometry is made once up in
    // main.js and its userData is what sizes the collider.
    this.capGeometry = capGeometry ?? buildGameCapGeometry();
    this.triangles = this.capGeometry.userData.triangles;

    /**
     * The panel carries the artwork slot, exactly as it does in the viewer.
     *
     * Leaving it off — which is what this did at first — costs more than
     * prettiness: seen from directly above, a cap's 21 flutes are silhouette
     * only and the face is a flat disc of colour, so an upright cap and a
     * flipped one are the same shape in the same colour and the single most
     * important piece of board state is invisible.
     *
     * ── injected when there is a mark book, placeholder when there is not ────
     * With `panelTextureFor` the panel wears whatever that player has chosen in
     * 내 마크 — including NOTHING, which is a bake of plain cap colour and is what
     * a device that has never drawn anything gets. That is the brief's "아무
     * 그림도 없는 깨끗한 뚜껑", and it is why the greyscale placeholder is no
     * longer the default: it was artwork nobody asked for.
     *
     * The fallback is kept because `bootViewer` builds an `ArenaView` with no
     * menu behind it, and a cap with no face at all in the viewer would be a
     * worse default than a placeholder.
     */
    this.panelTexture = panelTextureFor ? null : makeCapTopTexture();
    // Soft plastic under the same gloss switch as the paint but at a fraction of
    // it: a liner as shiny as the lacquer reads as a second metal disc. One
    // instance, shared by both players — see LINER_COLOR.
    this.linerMaterial = retro.create({ color: LINER_COLOR, gloss: 0.35 });
    // Indexed by CAP_GROUP: body, panel, liner. The array has to have an entry
    // for every group the geometry declares — with the shell on there are three,
    // and a mesh handed only two silently drops the liner.
    this._materials = PLAYER_COLORS.map((color, player) => {
      const set = [];
      set[CAP_GROUP.BODY] = retro.create({ color });
      /**
       * An injected mark is a FULL-COLOUR bake that already contains the cap's
       * paint, so it multiplies by white. The placeholder is near-greyscale and
       * is meant to be tinted, so it multiplies by the team colour. Getting
       * these the wrong way round squares the tint — `capTexture.js` states the
       * contract and `CapWipe` makes the same distinction.
       */
      set[CAP_GROUP.PANEL] = panelTextureFor
        ? retro.create({ map: panelTextureFor(player), color: '#ffffff' })
        : retro.create({ map: this.panelTexture, color });
      set[CAP_GROUP.LINER] = this.linerMaterial;
      return set;
    });

    /**
     * The ball's two panel colours. No texture at all any more.
     *
     * The pentagons and hexagons are real faces — see `ballGeometry` — so the
     * pattern is carried by which material a face is in rather than by a picture
     * wrapped around a sphere. Nothing to minify, nothing to smear at the poles,
     * and the boundary between a black panel and a white one is exact at every
     * distance because it is an edge rather than a texel.
     *
     * A stitched panel is not lacquered metal: enough gloss to catch the key
     * light and tell the eye it is round, well short of the caps' shine.
     */
    this.ballMaterials = [];
    this.ballMaterials[BALL_GROUP.PENTAGON] = retro.create({ color: BALL_DARK, gloss: 0.22 });
    this.ballMaterials[BALL_GROUP.HEXAGON] = retro.create({ color: BALL_LIGHT, gloss: 0.3 });

    this.meshes = [];
    this.ball = null;
    this._buildBodies(arena);

    this.field = null;
    /** The view that owns this mode's surface, or null when it is the board. */
    this.surface = null;
    this._buildField(arena);

    this._p = new Vector3();
    this._qa = new Quaternion();
    this._qb = new Quaternion();
    this._q = new Quaternion();

    this.setWireframe(config.view.wireframe);
  }

  /** The caps, and the ball if this mode has one. */
  _buildBodies(arena) {
    for (let i = 0; i < arena.capCount; i++) {
      const mesh = new Mesh(this.capGeometry, this._materials[arena.capOwner[i] % 2]);
      // NOT recentred. The viewer parks the cap on its mid-height because that
      // is what it orbits about; a physics body's origin is its own hem, which
      // is exactly how capGeometry builds it, so the mesh goes on unshifted.
      this.root.add(mesh);
      this.meshes.push(mesh);
    }

    if (arena.hasBall) {
      // Built at the arena's radius rather than scaled from a unit solid: the
      // ball's size is a structural parameter that rebuilds the collider
      // anyway, and a scaled mesh would put a non-unit scale into the matrix
      // the vertex-snap shader works in.
      this.ballGeometry = buildBallGeometry(arena.ballRadius);
      this.ball = new Mesh(this.ballGeometry, this.ballMaterials);
      this.root.add(this.ball);
    }
  }

  /**
   * Whatever this mode is played on. Dispatched on the layout's own account of
   * itself — a `kind` string out of `describe()`, never on which mode is loaded.
   *
   * `surface` is whichever view is in charge, or null for the board, which this
   * file still draws itself. Everything downstream — wireframe, update, dispose —
   * goes through that one field rather than through a chain of null checks per
   * kind, so a fourth surface is one branch here and nothing anywhere else.
   */
  _buildField(arena) {
    const desc = arena.layout.describe();

    if (desc.kind === 'pitch') {
      this.surface = new PitchView({
        retro: this.retro,
        description: desc,
        config: this.config,
        layout: arena.layout,
      });
      this.field = this.surface.root;
    } else if (desc.kind === 'lane') {
      this.surface = new CurlingView({
        retro: this.retro,
        description: desc,
        config: this.config,
      });
      this.field = this.surface.root;
    } else {
      this.surface = null;
      this.field = this._buildBoard(desc);
    }
    this.root.add(this.field);
  }

  _buildBoard(desc) {
    const g = new Group();
    const boardHalf = desc.boardHalf;
    const boardThickness = desc.boardThickness;

    // Only the top face is ever seen, so the board is one grid of quads rather
    // than a box.
    //
    // SUBDIVIDED, and not for the lighting. UVs in this pipeline are interpolated
    // affinely — no perspective correction, which is the point — and the error
    // that introduces grows with how much `w` varies across a single triangle.
    // Two triangles spanning the whole board is the worst case there is: in any
    // view but dead top-down the weave would visibly slide and shear across the
    // board as the camera moved. Cutting it into tiles roughly the size of one
    // texture repeat keeps each triangle's depth range small enough that the
    // warp stays a texture and does not become a special effect. This is the same
    // reason the era's own floors were tessellated.
    // The MESH follows the collider: flat to the out line, then tilting away and
    // down. The drop is what tells the player, before they shoot, that going over
    // the line is a fall and not a step.
    const h = boardHalf;
    const run = desc.edgeSlopeRun;
    /** Where the flat stops — the out line plus the shelf. */
    const flat = boardHalf + desc.edgeShelf;
    const sh = flat + run;
    const drop = boardThickness;
    const seg = Math.max(6, Math.round((sh * 2) / BOARD_TILE) * 3);
    const pos = [];
    const nor = [];
    const uv = [];
    for (let j = 0; j <= seg; j++) {
      for (let i = 0; i <= seg; i++) {
        const x = -sh + (i / seg) * sh * 2;
        const z = -sh + (j / seg) * sh * 2;
        // Square frustum: height depends only on the Chebyshev distance, so the
        // four slopes meet cleanly along the diagonals.
        const d = Math.max(Math.abs(x), Math.abs(z));
        const over = run > 1e-4 ? Math.max(0, d - flat) / run : 0;
        pos.push(x, -drop * Math.min(1, over), z);

        if (over <= 0 || over >= 1) {
          nor.push(0, 1, 0);
        } else {
          // Gradient of the Chebyshev distance is the dominant axis; the surface
          // falls at drop/run along it.
          const gx = Math.abs(x) >= Math.abs(z) ? Math.sign(x) : 0;
          const gz = gx === 0 ? Math.sign(z) : 0;
          const k = drop / run;
          const len = Math.hypot(k, 1);
          nor.push((k * gx) / len, 1 / len, (k * gz) / len);
        }
        // Tiled in world units, so the weave stays the same physical size
        // whatever the board is resized to.
        uv.push(x / BOARD_TILE, z / BOARD_TILE);
      }
    }
    const idx = [];
    const row = seg + 1;
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * row + i;
        idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);

    this.boardTexture = this.boardTexture ?? makeBoardTexture();
    this.boardMaterial = this.retro.create({
      map: this.boardTexture,
      // White, not the board colour. The shader multiplies the map by uColor, so
      // tinting with the same dark grey the texture is already painted in would
      // square it and the mat would come out near black.
      color: BOARD_TINT,
      // Near-matte. A mat with any real specular reads as polished stone, and a
      // highlight sliding across it under the fixed key light would compete with
      // the caps for attention.
      gloss: 0.08,
    });
    this.boardMesh = new Mesh(geo, this.boardMaterial);
    this.boardMesh.position.y = -boardThickness * 0.01;
    g.add(this.boardMesh);

    // The rim: where the flat stops and the drop begins.
    //
    // Drawn at `flat` and not at `boardHalf`, which is where it used to be. That
    // was the out LINE — cross it and you were gone — and there is no such line
    // any more: a cap is out when it falls. Leaving the bright line where it was
    // would have it marking a rule that has been deleted, which is worse than
    // not drawing it, because the player would still be playing to it.
    //
    // Still drawn as lines rather than left to the slab's silhouette: in the
    // top-down wireframe view the slab is invisible and this is the only thing
    // that says where the board ends.
    const edge = [];
    const corners = [
      [-flat, -flat],
      [flat, -flat],
      [flat, flat],
      [-flat, flat],
    ];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % 4];
      edge.push(a[0], 0.02, a[1], b[0], 0.02, b[1]);
    }
    const edgeGeo = new BufferGeometry();
    edgeGeo.setAttribute('position', new Float32BufferAttribute(edge, 3));
    this.edgeMaterial = new LineBasicMaterial({ color: BOARD_EDGE_COLOR, fog: false });
    g.add(new LineSegments(edgeGeo, this.edgeMaterial));

    // The bottom of the slope, dim. Not the rule — the bright line above is —
    // but without it the drop has no visible end and the board looks like it
    // just fades out.
    if (sh > h + 1e-3) {
      const outer = [];
      const oc = [
        [-sh, -sh],
        [sh, -sh],
        [sh, sh],
        [-sh, sh],
      ];
      for (let i = 0; i < 4; i++) {
        const a = oc[i];
        const b = oc[(i + 1) % 4];
        outer.push(a[0], -boardThickness + 0.02, a[1], b[0], -boardThickness + 0.02, b[1]);
      }
      const outerGeo = new BufferGeometry();
      outerGeo.setAttribute('position', new Float32BufferAttribute(outer, 3));
      this.apronMaterial = new LineBasicMaterial({ color: APRON_EDGE_COLOR, fog: false });
      g.add(new LineSegments(outerGeo, this.apronMaterial));
    }

    // A coarse grid, purely so distance and speed are readable when the caps are
    // wireframes on a black board and there is nothing else to judge motion
    // against. One line every four cap widths.
    const step = CAP_DEFAULTS.capDiameter * MM * 4;
    const grid = [];
    for (let v = -h + step; v < h - 1e-3; v += step) {
      grid.push(-h, 0.01, v, h, 0.01, v);
      grid.push(v, 0.01, -h, v, 0.01, h);
    }
    const gridGeo = new BufferGeometry();
    gridGeo.setAttribute('position', new Float32BufferAttribute(grid, 3));
    this.gridMaterial = new LineBasicMaterial({ color: GRID_COLOR, fog: false });
    g.add(new LineSegments(gridGeo, this.gridMaterial));

    return g;
  }

  /**
   * @param {number} alpha  0..1 between the previous physics step and the current one
   * @param {boolean[]} alive
   * @param {{capVisual: (i: number) => ({dx:number,dy:number,dz:number,scale:number}|null)}} [fx]
   *   card effects, asked AFTER the physics transform has been written. Strictly
   *   a drawing offset: the body is wherever the solver put it and this moves the
   *   picture of it, which is what keeps a shake or a shrink out of the sim.
   */
  update(alpha, alive, fx) {
    const prev = this.arena.prevTransforms;
    const curr = this.arena.currTransforms;
    const t = Math.max(0, Math.min(1, alpha));

    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      if (alive && !alive[i]) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      this._place(mesh, prev, curr, i, t);

      const v = fx?.capVisual(i) ?? null;
      if (v) {
        mesh.position.x += v.dx;
        mesh.position.y += v.dy;
        mesh.position.z += v.dz;
        mesh.scale.setScalar(v.scale);
      } else if (mesh.scale.x !== 1) {
        mesh.scale.setScalar(1);
      }
    }

    // The ball's slot comes after every cap's, which is why the caps could be
    // walked by mesh index above without knowing the ball existed.
    if (this.ball) this._place(this.ball, prev, curr, this.arena.ballSlot, t);

    this.surface?.update();
  }

  _place(mesh, prev, curr, slot, t) {
    const o = slot * 7;
    this._p.set(
      prev[o] + (curr[o] - prev[o]) * t,
      prev[o + 1] + (curr[o + 1] - prev[o + 1]) * t,
      prev[o + 2] + (curr[o + 2] - prev[o + 2]) * t,
    );
    this._qa.set(prev[o + 3], prev[o + 4], prev[o + 5], prev[o + 6]);
    this._qb.set(curr[o + 3], curr[o + 4], curr[o + 5], curr[o + 6]);
    // Slerp, not lerp: a cap mid-tumble covers a large angle in 1/120 s and a
    // component-wise blend of two quaternions that far apart visibly shrinks
    // the cap as it turns. The ball spins faster still.
    this._q.slerpQuaternions(this._qa, this._qb, t);

    mesh.position.copy(this._p);
    mesh.quaternion.copy(this._q);
  }

  setWireframe(on) {
    // The liner instance is shared, so it gets set twice. Harmless and cheaper
    // than de-duplicating for a toggle that fires on a click.
    for (const set of this._materials) for (const m of set) (m.wireframe = on);
    for (const m of this.ballMaterials) m.wireframe = on;

    if (this.surface) {
      this.surface.setWireframe(on);
      return;
    }
    this.boardMaterial.wireframe = on;
    // The board slab is two triangles; in wireframe it becomes a diagonal across
    // an empty square and reads as a crack down the middle of the board. The rim
    // line already says where the board is, so the slab just goes away.
    this.boardMesh.visible = !on;
  }

  /**
   * Structural rebuild: new bodies, possibly a whole new kind of world.
   *
   * Also the mode switch's only path. A cap count change, a pitch resize and a
   * jump from board to pitch are the same operation from here — throw away what
   * is on screen and build what the arena says is there now — and giving them
   * separate paths is how one of them ends up leaking the old GPU buffers.
   */
  rebuild(arena) {
    for (const m of this.meshes) this.root.remove(m);
    this.meshes.length = 0;
    if (this.ball) {
      this.root.remove(this.ball);
      this.ballGeometry.dispose();
      this.ball = null;
    }

    this.arena = arena;
    this._buildBodies(arena);
    this._disposeField();
    this._buildField(arena);
    this.setWireframe(this.config.view.wireframe);
  }

  /**
   * Let go of the current field's GPU buffers.
   *
   * Board size and pitch length are both on sliders, so a session's worth of
   * dragging is a session's worth of orphaned geometry if this is skipped —
   * and none of it is reachable from JS to be collected, because it lives on
   * the GPU behind a handle the dropped `Group` was the last reference to.
   */
  _disposeField() {
    this.root.remove(this.field);
    if (this.surface) {
      this.surface.dispose();
      this.surface = null;
    } else {
      this.field.traverse((o) => o.geometry?.dispose());
      this.boardMaterial.dispose();
      this.edgeMaterial.dispose();
      this.gridMaterial.dispose();
      this.apronMaterial?.dispose();
    }
    this.field = null;
  }
}

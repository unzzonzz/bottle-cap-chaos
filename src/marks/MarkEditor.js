import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { PALETTE } from '../core/palette.js';
import { buildCapGeometry, CAP_DEFAULTS, CAP_GROUP } from '../cap/capGeometry.js';
import { createSpriteMaterial } from '../menu/menuMaterials.js';
import { menuPlateTexture } from '../menu/menuTextures.js';
import { iconTexture, saveButtonTexture, solidTexture, tileTexture } from './markIcons.js';
import {
  bakeCapPanel,
  clipToBoundary,
  createMarkCanvas,
  MARK_BOUNDARY_DEFAULT,
  MARK_CANVAS_DEFAULT,
  toMarkTexture,
} from './markTextures.js';
import { DEFAULT_MARK } from './MarkBook.js';

/**
 * The drawing screen: a cap you paint on, and the tools to paint it with.
 *
 * ── the pointer is mapped by RAYCASTING THE CAP, not by projecting a circle ──
 * The obvious way to turn a click into a canvas pixel is to work out where the
 * cap's top disc lands on screen and invert it. That works only while the cap is
 * exactly where you expect, and it silently produces plausible-but-wrong
 * coordinates the moment anything moves it — a camera tweak, a different
 * `unitsPerPixel`, the resize this menu does not currently handle.
 *
 * So the ray is cast at the real mesh and the intersection's UV is used
 * directly. `capGeometry` gives the panel a planar projection over the top's
 * bounding square, which IS the canvas — so `uv * size` is the texel under the
 * pointer, exactly, with no arithmetic that can drift from the geometry. Hits on
 * the skirt and the liner carry their own UVs and are rejected by
 * `face.materialIndex`, which is the same `CAP_GROUP.PANEL` the material array
 * is indexed by.
 *
 * ── two masks, because the boundary is the team's ───────────────────────────
 * Every paint operation is clipped to the circle, and the bake in
 * `markTextures` clips again. The brief says the ring outside it is what tells
 * the teams apart and must survive, so it is guarded in the editor AND on the
 * way to the cap — a single mask would be one mistake away from a mark that
 * covers the whole panel.
 *
 * ── undo is whole canvases ──────────────────────────────────────────────────
 * One `ImageData` per stroke, not a diff and not a command log. At 128 texels a
 * state is 64 kB and the limit is twenty of them, so the whole history is about
 * a megabyte and a half — cheap enough that the simple thing is also the right
 * one. Diffs would be smaller and would have to be correct about the eraser's
 * `destination-out`, which is exactly the kind of cleverness that produces an
 * undo that ALMOST restores what was there.
 *
 * ── the eraser removes alpha ────────────────────────────────────────────────
 * `destination-out`, never a fill in the cap's colour. The editor does not know
 * what colour the cap is — it cannot, because one mark is worn by both teams —
 * and painting a guess would put a red disc on a blue cap. See `markTextures`.
 */

/** Frame pixels. */
const L = {
  capY: 14,
  /** Screen pixels across the cap's widest point. */
  capWidth: 236,
  toolX: 236,
  /**
   * Left edge of the palette's first column.
   *
   * Moved out from −246 when the grid grew a fourth column. At −246 the new
   * column's right edge landed at −129 against the cap's own left edge at −118,
   * which is eleven frame pixels and reads as the swatches touching the cap.
   * −270 puts the same clearance on both sides of the block: about 35 to the
   * frame's edge and about 35 to the cap.
   */
  paletteX: -270,
  swatch: 30,
  tool: 34,
  modeY: 176,
  saveY: -178,
  backY: -178,
};

/**
 * The drawing palette, as rows of `PALETTE_COLUMNS`.
 *
 * ── the values moved to `core/palette.js`; the ORDER is still layout ─────────
 * `_buildPalette` fills left to right, so each run of four in `marks.swatches`
 * is a row on screen and each row is a family. That is the whole reason the
 * array is written four to a line over there rather than sorted by hue:
 * reordering it rearranges the grid, and a grid you can scan by family is the
 * difference between picking a colour and hunting for one.
 *
 * The constraint that used to shape the list is gone. It was chosen so that
 * every entry landed on its own 5-bit-per-channel triple, because the chain
 * quantised to five bits and two swatches less than a thirty-second apart
 * arrived as the same colour. There is no quantiser now, so the twenty-four
 * were re-tuned for the bright scheme instead — the row of near-blacks became a
 * row of navies, and every hue came up in lightness.
 *
 * Nothing saved depends on any of this. A mark is stored as canvas pixels, not
 * as palette indices, so re-tinting a swatch cannot change a drawing anybody has
 * already made.
 *
 * Named `MARK_SWATCHES` rather than `PALETTE`, which is what it was called when
 * it was the only palette in the project.
 */
export const MARK_SWATCHES = PALETTE.marks.swatches;

/**
 * Swatches across, which decides how far down the grid reaches.
 *
 * Four rather than the three it was, and it is a fit rather than a taste: at
 * three columns twenty-four colours are eight rows deep and the bottom of the
 * grid lands on 목록으로. Four columns is six rows, which clears that button by
 * about fifty frame pixels, and the extra column is what `paletteX` moved left
 * to make room for — see the note there.
 */
const PALETTE_COLUMNS = 4;

/**
 * Brush diameters in canvas texels, one per size icon.
 *
 * Exported and MUTATED IN PLACE by the panel — the editor reads it on every dab,
 * so a dragged slider changes the next stroke rather than the next session.
 */
export const BRUSH_SIZES = [2, 5, 10];

export const EDITOR_MODE = { DRAW: 'draw', VIEW: 'view' };

export class MarkEditor {
  /**
   * @param {import('../core/RetroMaterial.js').RetroMaterials} retro
   * @param {number} unitsPerPixel
   * @param {import('./MarkBook.js').MarkBook} book
   * @param {import('./ConfirmDialog.js').ConfirmDialog} confirm
   * @param {typeof import('../menu/menuConfig.js').MENU_CONFIG.marks} tuning
   * @param {() => void} onExit  leave the editor. Only called once it is safe to.
   */
  constructor({ retro, unitsPerPixel, book, confirm, tuning, onExit }) {
    const u = unitsPerPixel;
    this._u = u;
    this.retro = retro;
    this.book = book;
    this.confirm = confirm;
    this.tuning = tuning;
    this.onExit = onExit ?? (() => {});

    this.root = new Group();
    this.mode = EDITOR_MODE.DRAW;
    /** Which slot is being edited, or DEFAULT_MARK when just looking. */
    this.ref = 0;
    this.colour = MARK_SWATCHES[0];
    this.brush = 1;
    this.erasing = false;

    // ── the canvas ──────────────────────────────────────────────────────────
    this.size = tuning.canvasSize;
    this.canvas = createMarkCanvas(this.size);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this._history = [];
    this._historyAt = -1;
    this._savedAt = -1;

    // ── the cap ─────────────────────────────────────────────────────────────
    this.pivot = new Group();
    this.pivot.position.set(0, L.capY * u, 0);
    this.root.add(this.pivot);

    this.geometry = buildCapGeometry({ ...CAP_DEFAULTS, shell: true });
    /**
     * The panel wears a BAKE of the canvas, not the canvas.
     *
     * The obvious thing is to hand the editor's RGBA canvas straight to the
     * panel and let a coloured `uColor` show through the transparent parts. It
     * does not work, and the reason is the one `markTextures` opens with:
     * `RetroMaterial`'s panel shader is `uColor * texture(uMap).rgb` and it never
     * reads alpha. Unpainted canvas is `rgba(0,0,0,0)`, so the multiply is by
     * ZERO and the whole cap top comes out black — which is exactly what it did.
     *
     * So the editor bakes on every stroke, the same way the game's caps do:
     * cap colour underneath, mark composited over, `uColor` white. One extra
     * 128x128 composite per dab, which is nothing, and it means the editor is
     * previewing the identical pipeline the cap will actually wear.
     */
    this._bakeCanvas = bakeCapPanel(null, tuning.capColor, this.size, tuning.boundary);
    this.panelTexture = toMarkTexture(this._bakeCanvas);
    this.materials = [];
    this.materials[CAP_GROUP.BODY] = retro.create({ color: tuning.capColor });
    this.materials[CAP_GROUP.PANEL] = retro.create({
      map: this.panelTexture,
      color: PALETTE.untinted,
    });
    this.materials[CAP_GROUP.LINER] = retro.create({ color: PALETTE.metal.liner, gloss: 0.35 });

    this.cap = new Mesh(this.geometry, this.materials);
    // Panel toward the camera, and parked on its mid-height so the view mode
    // rolls it about its middle rather than swinging it around its hem.
    this.cap.rotation.x = Math.PI / 2;
    this.cap.position.z = -(this.geometry.userData.height ?? 0) * 0.5;
    const capR = this.geometry.userData.radius ?? 1.6;
    const perCapUnit = L.capWidth / (capR * 2);
    this.pivot.scale.setScalar(perCapUnit * u);
    this.pivot.add(this.cap);

    /** View mode's roll, in radians, and its inertia. */
    this.spin = 0;
    this.spinVel = 0;

    // ── the boundary ring ───────────────────────────────────────────────────
    /**
     * The circle, drawn as a thin ring ON the cap.
     *
     * The brief asks for the boundary to be visible, and it has to be visible
     * where the drawing happens rather than as a frame around the screen — the
     * question a player is asking is "can I paint HERE", and only a mark on the
     * cap answers it.
     *
     * ── the quad is the PANEL, not the cap ────────────────────────────────
     * `ringTexture` puts its circle at `half * boundary` of whatever quad it is
     * on, and `boundary` is a fraction of the panel — so the quad has to BE the
     * panel or the ring lands somewhere paint cannot follow. It used to be the
     * full `capWidth`, which drew the guide at `outerRadius * boundary` while
     * the clip stopped at `panelRadius * boundary`: a ring of cap inside the
     * line that silently refused the brush. Same number, two different circles.
     */
    const panelWidth = L.capWidth * (this.geometry.userData.panelRadius / capR);
    this.ring = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: ringTexture(tuning.boundary), blend: 'add' }),
    );
    this.ring.scale.set(panelWidth * u, panelWidth * u, 1);
    this.ring.position.set(0, L.capY * u, 40 * u);
    this.root.add(this.ring);

    // ── controls ────────────────────────────────────────────────────────────
    this._controls = [];
    this._buildModes(retro);
    this._buildPalette(retro);
    this._buildTools(retro);
    this._buildFooter(retro);

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this._hover = null;
    /** The stroke in progress: null when the pointer is up. */
    this._stroke = null;
    this._lastUv = null;
    this._drag = null;

    this.refresh();
  }

  // ── construction helpers ──────────────────────────────────────────────────

  _add(retro, { id, kind, map, x, y, w, h, z = 0 }) {
    const u = this._u;
    const mesh = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(retro, { map }));
    mesh.scale.set(w * u, h * u, 1);
    mesh.position.set(x * u, y * u, (50 + z) * u);
    this.root.add(mesh);
    const control = { id, kind, mesh, x, y, w, h };
    this._controls.push(control);
    return control;
  }

  _buildModes(retro) {
    this.modeButtons = [
      { id: 'mode:draw', icon: 'pencil', x: -L.tool / 2 - 3 },
      { id: 'mode:view', icon: 'eye', x: L.tool / 2 + 3 },
    ].map((def) =>
      Object.assign(
        this._add(retro, {
          id: def.id,
          kind: 'mode',
          map: iconTexture(def.icon, 'idle', { size: L.tool }),
          x: def.x,
          y: L.modeY,
          w: L.tool,
          h: L.tool,
        }),
        { icon: def.icon },
      ),
    );
  }

  _buildPalette(retro) {
    this.swatches = MARK_SWATCHES.map((colour, i) => {
      const col = i % PALETTE_COLUMNS;
      const row = Math.floor(i / PALETTE_COLUMNS);
      return Object.assign(
        this._add(retro, {
          id: `colour:${i}`,
          kind: 'colour',
          map: swatchTexture(colour, false),
          x: L.paletteX + col * (L.swatch + 4),
          y: 78 - row * (L.swatch + 4),
          w: L.swatch,
          h: L.swatch,
        }),
        { colour },
      );
    });
  }

  _buildTools(retro) {
    const defs = [
      { id: 'brush:0', icon: 'brush1' },
      { id: 'brush:1', icon: 'brush2' },
      { id: 'brush:2', icon: 'brush3' },
      { id: 'eraser', icon: 'eraser' },
      { id: 'undo', icon: 'undo' },
      { id: 'redo', icon: 'redo' },
      { id: 'clear', icon: 'clear' },
    ];
    this.tools = defs.map((def, i) =>
      Object.assign(
        this._add(retro, {
          id: def.id,
          kind: 'tool',
          map: iconTexture(def.icon, 'idle', { size: L.tool }),
          x: L.toolX,
          y: 96 - i * (L.tool + 5),
          w: L.tool,
          h: L.tool,
        }),
        { icon: def.icon },
      ),
    );
  }

  _buildFooter(retro) {
    this.saveButton = this._add(retro, {
      id: 'save',
      kind: 'save',
      map: saveButtonTexture('idle'),
      x: 176,
      y: L.saveY,
      w: 108,
      h: 34,
    });
    this.backButton = this._add(retro, {
      id: 'back',
      kind: 'back',
      map: menuPlateTexture('◀ 목록으로', 'idle', { width: 180, height: 40 }),
      x: -170,
      y: L.backY,
      w: 180,
      h: 40,
    });
    this._backMaps = {
      idle: menuPlateTexture('◀ 목록으로', 'idle', { width: 180, height: 40 }),
      hover: menuPlateTexture('◀ 목록으로', 'hover', { width: 180, height: 40 }),
    };
  }

  // ── opening ───────────────────────────────────────────────────────────────

  /**
   * Load a mark and show it.
   *
   * A `+` opens an empty slot in DRAW; an existing mark opens in VIEW, which the
   * brief asks for so that looking at a mark cannot accidentally change it. The
   * built-in logo can only ever be looked at.
   *
   * ── history starts HERE ─────────────────────────────────────────────────
   * "기존 마크 수정 시 되돌리기 이력은 없다. 진입 시점이 시작점이다." The stack is
   * emptied and seeded with whatever was loaded, so the earliest thing undo can
   * reach is the mark as it was opened — never the previous session's strokes.
   */
  open(ref, image = null) {
    this.ref = ref;
    this.readOnly = ref === DEFAULT_MARK;
    this.mode = this.readOnly || image ? EDITOR_MODE.VIEW : EDITOR_MODE.DRAW;
    this.spin = 0;
    this.spinVel = 0;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (image) {
      this.ctx.save();
      clipToBoundary(this.ctx, this.canvas.width, this.tuning.boundary);
      this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
    }
    this._rebake();

    this._history = [this._snapshot()];
    this._historyAt = 0;
    this._savedAt = 0;
    this.refresh();
  }

  get dirty() {
    return this._historyAt !== this._savedAt;
  }

  // ── history ───────────────────────────────────────────────────────────────

  _snapshot() {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  _restore(state) {
    this.ctx.putImageData(state, 0, 0);
    this._rebake();
  }

  /**
   * Composite the canvas onto the cap's paint and push it to the texture.
   *
   * The one place the preview is produced, so a stroke, an undo, a clear and a
   * load cannot disagree about what the cap looks like.
   */
  _rebake() {
    const baked = bakeCapPanel(
      this.canvas,
      this.tuning.capColor,
      this._bakeCanvas.width,
      this.tuning.boundary,
    );
    const ctx = this._bakeCanvas.getContext('2d');
    ctx.clearRect(0, 0, this._bakeCanvas.width, this._bakeCanvas.height);
    ctx.drawImage(baked, 0, 0);
    this.panelTexture.needsUpdate = true;
  }

  /** Called once per completed stroke, and by clear. */
  _commit() {
    // Anything redoable is now unreachable: the timeline has branched and the
    // branch nobody took is gone. Standard, and the alternative is a tree.
    this._history.length = this._historyAt + 1;
    this._history.push(this._snapshot());
    // Read live rather than captured, so the panel's slider takes effect on
    // the next stroke instead of the next session.
    const limit = Math.max(1, Math.round(this.tuning.historyLimit));
    while (this._history.length > limit + 1) {
      this._history.shift();
      // The saved point slides with the window. Without this, trimming past it
      // would leave `dirty` permanently true on a mark nobody had touched.
      this._savedAt = Math.max(-1, this._savedAt - 1);
    }
    this._historyAt = this._history.length - 1;
    this.refresh();
  }

  undo() {
    if (this._historyAt <= 0) return;
    this._historyAt--;
    this._restore(this._history[this._historyAt]);
    this.refresh();
  }

  redo() {
    if (this._historyAt >= this._history.length - 1) return;
    this._historyAt++;
    this._restore(this._history[this._historyAt]);
    this.refresh();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._rebake();
    // A stroke like any other, so undo brings the drawing back — which is why
    // the brief allows it to skip its own confirmation.
    this._commit();
  }

  // ── painting ──────────────────────────────────────────────────────────────

  /**
   * One dab, in canvas texels. Square, hard-edged, no antialiasing anywhere.
   *
   * `fillRect` on whole pixels rather than `arc`: a circle at this size is
   * rasterised with soft edges whatever `imageSmoothingEnabled` says, and the
   * brief rules out a soft brush. A square dab IS the pixel-art brush.
   */
  _dab(x, y) {
    const d = BRUSH_SIZES[this.brush] ?? 4;
    const half = Math.floor(d / 2);
    this.ctx.fillRect(Math.round(x) - half, Math.round(y) - half, d, d);
  }

  /** Dabs along a segment, so a fast drag is a line rather than dots. */
  _line(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 0; i <= steps; i++) {
      this._dab(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    }
  }

  _paintTo(uv) {
    const size = this.canvas.width;
    const point = { x: uv.x * size, y: (1 - uv.y) * size };
    this.ctx.save();
    // THE mask. Everything that puts pixels on this canvas goes through it.
    clipToBoundary(this.ctx, size, this.tuning.boundary);
    if (this.erasing) {
      // Alpha out, not paint over. See the header.
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.fillStyle = PALETTE.ui.text;
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.fillStyle = this.colour;
    }
    if (this._lastUv) this._line(this._lastUv, point);
    else this._dab(point.x, point.y);
    this.ctx.restore();
    this._lastUv = point;
    this._rebake();
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  _setRay(canvas, camera, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, camera);
    this.root.updateMatrixWorld(true);
    return true;
  }

  /** The panel UV under a point, or null if the pointer is not on the panel. */
  _panelUv(canvas, camera, clientX, clientY) {
    if (!this._setRay(canvas, camera, clientX, clientY)) return null;
    for (const hit of this._ray.intersectObject(this.cap, false)) {
      // Only the artwork slot. The skirt and the liner have UVs of their own and
      // painting through them would put marks on the far side of the cap.
      if (hit.face?.materialIndex === CAP_GROUP.PANEL && hit.uv) return hit.uv;
    }
    return null;
  }

  pick(canvas, camera, clientX, clientY) {
    if (this.confirm?.open) {
      return { kind: 'dialog', hit: this.confirm.pick(canvas, camera, clientX, clientY) };
    }
    if (!this._setRay(canvas, camera, clientX, clientY)) return null;
    for (const c of this._controls) {
      if (!c.mesh.visible) continue;
      if (this._ray.intersectObject(c.mesh, false).length) return { kind: c.kind, id: c.id, control: c };
    }
    // Not a control: the cap itself, which is a canvas in draw mode and a
    // turntable in view mode.
    const uv = this._panelUv(canvas, camera, clientX, clientY);
    if (this.mode === EDITOR_MODE.DRAW) {
      return uv ? { kind: 'canvas', uv } : null;
    }
    return { kind: 'turntable' };
  }

  /**
   * Is a turntable drag in progress?
   *
   * `move` returns true for a brush stroke as well, and the two want opposite
   * cursors — a stroke stays a crosshair on the point it is painting, a spin
   * becomes a closed hand. The caller cannot tell them apart from `move`'s
   * boolean, so it asks here.
   */
  get spinning() {
    return !!this._drag;
  }

  setHover(hit) {
    this._hover = hit;
    if (this.confirm?.open) {
      this.confirm.setHover(hit?.hit ?? null);
      return;
    }
    this.refresh();
  }

  /** @returns {boolean} whether the press was consumed. */
  press(hit, clientX, clientY) {
    if (!hit) return false;

    if (hit.kind === 'dialog') {
      this.confirm.activate(hit.hit);
      return true;
    }
    if (hit.kind === 'canvas') {
      if (this.readOnly) return true;
      this._stroke = true;
      this._lastUv = null;
      this._paintTo(hit.uv);
      return true;
    }
    if (hit.kind === 'turntable') {
      this._drag = { y: clientY, vel: 0 };
      this.spinVel = 0;
      return true;
    }
    return this._activate(hit.id);
  }

  move(canvas, camera, clientX, clientY) {
    if (this._stroke) {
      const uv = this._panelUv(canvas, camera, clientX, clientY);
      // Off the panel mid-stroke: the dab is dropped and the chain is broken, so
      // coming back on does not draw a line across the gap.
      if (uv) this._paintTo(uv);
      else this._lastUv = null;
      return true;
    }
    if (this._drag) {
      const dy = clientY - this._drag.y;
      this._drag.y = clientY;
      const rate = this.tuning.rotateRadiansPerPixel;
      this.spin += dy * rate;
      // Kept for the throw. Averaged lightly so one stray pixel at release does
      // not become the whole velocity.
      this._drag.vel = this._drag.vel * 0.6 + dy * rate * 0.4;
      return true;
    }
    return false;
  }

  release() {
    if (this._stroke) {
      this._stroke = false;
      this._lastUv = null;
      this._commit();
      return;
    }
    if (this._drag) {
      this.spinVel = this._drag.vel * this.tuning.flingScale;
      this._drag = null;
    }
  }

  _activate(id) {
    if (id === 'mode:draw') {
      if (!this.readOnly) this.mode = EDITOR_MODE.DRAW;
      this.refresh();
      return true;
    }
    if (id === 'mode:view') {
      this.mode = EDITOR_MODE.VIEW;
      this.refresh();
      return true;
    }
    if (id === 'eraser') {
      this.erasing = !this.erasing;
      this.refresh();
      return true;
    }
    if (id === 'undo') {
      this.undo();
      return true;
    }
    if (id === 'redo') {
      this.redo();
      return true;
    }
    if (id === 'clear') {
      this.clear();
      return true;
    }
    if (id?.startsWith('brush:')) {
      this.brush = Number(id.slice(6));
      /**
       * The size does NOT put the eraser away, and the colour below does.
       *
       * They look like the same kind of control sitting in the same row and they
       * are two different axes. A COLOUR is a paint-only idea — picking one is
       * picking to paint, and leaving the eraser armed would rub out in a colour
       * the player just chose. A SIZE belongs to whichever tool is in hand:
       * `_dab` reads `BRUSH_SIZES[this.brush]` for the eraser exactly as it does
       * for the brush, so the eraser has always had a width and it has always
       * been this one.
       *
       * It used to clear `erasing` here too, copied from the colour branch, and
       * that made the eraser's width unreachable: the only way to change it was
       * to leave eraser mode, pick a size, and arm the eraser again — three
       * presses to do what the row looks like it does in one, with nothing on
       * screen explaining why the middle press turned the eraser off.
       */
      this.refresh();
      return true;
    }
    if (id?.startsWith('colour:')) {
      this.colour = MARK_SWATCHES[Number(id.slice(7))];
      // Choosing a colour is choosing to paint. Leaving the eraser armed would
      // make the next stroke rub out in a colour the player just picked.
      this.erasing = false;
      this.refresh();
      return true;
    }
    if (id === 'save') {
      this._askSave();
      return true;
    }
    if (id === 'back') {
      this.requestExit();
      return true;
    }
    return false;
  }

  _askSave() {
    if (this.readOnly) return;
    const existed = this.book.hasSlot(this.ref);
    this.confirm.ask(
      existed ? '이 마크를 수정하시겠습니까?' : '이 마크를 저장하시겠습니까?',
      {
        onConfirm: () => {
          this.book.setSlot(this.ref, this.canvas.toDataURL('image/png'));
          this._savedAt = this._historyAt;
          this.refresh();
        },
      },
    );
  }

  /**
   * Leave — but not silently over unsaved work.
   *
   * "저장하지 않고 나가면 저장되지 않는다 … 소리 없이 날리지 마라." So the exit is
   * a request rather than an action: clean, it goes; dirty, it asks first and
   * the discard only happens on an explicit 확인.
   */
  requestExit() {
    if (!this.dirty) {
      this.onExit();
      return;
    }
    this.confirm.ask('저장하지 않고 나가시겠습니까?', { onConfirm: () => this.onExit() });
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  update(dt) {
    const drawing = this.mode === EDITOR_MODE.DRAW;
    if (drawing) {
      // Top-down and locked. The brief fixes the camera in draw mode so a stroke
      // lands where it looked like it would.
      this.spin = 0;
      this.spinVel = 0;
    } else if (!this._drag && this.spinVel !== 0) {
      this.spin += this.spinVel * dt * 60;
      // Exponential decay, framerate-independent at the step sizes this loop
      // sees. Stops rather than crawling forever.
      this.spinVel *= Math.pow(Math.max(0, this.tuning.spinDamping), dt * 60);
      if (Math.abs(this.spinVel) < 1e-4) this.spinVel = 0;
    }
    this.pivot.rotation.x = this.spin;
  }

  /** Push every control's texture to match the current state. */
  refresh() {
    const drawing = this.mode === EDITOR_MODE.DRAW && !this.readOnly;
    const hoverId = this._hover?.id ?? null;

    for (const b of this.modeButtons) {
      const wants = b.id === (drawing ? 'mode:draw' : 'mode:view');
      const state = b.id === 'mode:draw' && this.readOnly
        ? 'disabled'
        : wants
          ? 'active'
          : b.id === hoverId
            ? 'hover'
            : 'idle';
      b.mesh.material.uniforms.uMap.value = iconTexture(b.icon, state, { size: L.tool });
    }

    /**
     * TOOLS AND PALETTE EXIST ONLY IN DRAW MODE.
     *
     * "팔레트와 그리기 도구는 표시되지 않는다" for view mode, and hiding them is
     * also what makes the mode legible: a screen with no tools on it is
     * obviously not a screen you are painting on.
     */
    for (const s of this.swatches) {
      s.mesh.visible = drawing;
      s.mesh.material.uniforms.uMap.value = swatchTexture(
        s.colour,
        !this.erasing && s.colour === this.colour,
      );
    }
    for (const t of this.tools) {
      t.mesh.visible = drawing;
      let state = t.id === hoverId ? 'hover' : 'idle';
      /**
       * TWO controls in this row can be lit at once, and that is the point.
       *
       * The row looks like one set of four radio buttons and is two axes: which
       * tool is in hand (brush or eraser) and how wide it is. The size used to be
       * lit only while painting — `&& !this.erasing` — so arming the eraser left
       * the whole row showing one highlight on the eraser and nothing about its
       * width, while `_dab` went on using the width the player could no longer
       * see. The setting was in force and unreadable, which is the worst of the
       * three possible states.
       *
       * So the size is lit whichever tool it is sizing. With the eraser armed
       * the row reads "eraser, this wide", which is what it has always been
       * doing.
       */
      if (t.id === `brush:${this.brush}`) state = 'active';
      if (t.id === 'eraser' && this.erasing) state = 'active';
      // Greyed when there is nothing to go back to or forward to, which the
      // brief asks for explicitly.
      if (t.id === 'undo' && this._historyAt <= 0) state = 'disabled';
      if (t.id === 'redo' && this._historyAt >= this._history.length - 1) state = 'disabled';
      t.mesh.material.uniforms.uMap.value = iconTexture(t.icon, state, { size: L.tool });
    }

    this.saveButton.mesh.visible = !this.readOnly;
    this.saveButton.mesh.material.uniforms.uMap.value = saveButtonTexture(
      this.readOnly ? 'disabled' : hoverId === 'save' ? 'hover' : 'idle',
    );
    this.backButton.mesh.material.uniforms.uMap.value =
      hoverId === 'back' ? this._backMaps.hover : this._backMaps.idle;
    // The boundary belongs to drawing. In view mode it would be a ring floating
    // in front of a cap being turned.
    this.ring.visible = drawing;
  }

  setCanvasSize(size) {
    if (size === this.canvas.width) return;
    const prev = this.canvas;
    this.size = size;
    this.canvas = createMarkCanvas(size);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.save();
    clipToBoundary(this.ctx, size, this.tuning.boundary);
    this.ctx.drawImage(prev, 0, 0, size, size);
    this.ctx.restore();
    this._bakeCanvas = bakeCapPanel(null, this.tuning.capColor, size, this.tuning.boundary);
    this.panelTexture.image = this._bakeCanvas;
    this._rebake();
    this._history = [this._snapshot()];
    this._historyAt = 0;
    this._savedAt = -1;
    this.refresh();
  }

  /** The panel edited the palette. Drop the cached chips and redraw. */
  refreshPalette() {
    swatchCache.clear();
    for (let i = 0; i < this.swatches.length; i++) this.swatches[i].colour = MARK_SWATCHES[i];
    if (!MARK_SWATCHES.includes(this.colour)) this.colour = MARK_SWATCHES[0];
    this.refresh();
  }

  setBoundary(boundary) {
    this.tuning.boundary = boundary;
    this.ring.material.uniforms.uMap.value = ringTexture(boundary);
  }

  dispose() {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.panelTexture.dispose();
    for (const c of this._controls) {
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
    }
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.root.clear();
  }
}

// ── textures owned by this screen alone ─────────────────────────────────────

const swatchCache = new Map();

/** A colour chip. The selected one gets the toolbar's gold edge. */
function swatchTexture(colour, selected) {
  const key = `${colour}:${selected}`;
  const hit = swatchCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = L.swatch;
  canvas.height = L.swatch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = selected ? PALETTE.accent.cyan : PALETTE.ui.edge;
  ctx.fillRect(0, 0, L.swatch, L.swatch);
  ctx.fillStyle = colour;
  ctx.fillRect(3, 3, L.swatch - 6, L.swatch - 6);
  const tex = toMarkTexture(canvas);
  swatchCache.set(key, tex);
  return tex;
}

const ringCache = new Map();

/**
 * The boundary, as a one-texel ring on a transparent field.
 *
 * Additive, so it brightens the cap under it rather than covering it — a solid
 * ring would hide the outermost paint, which is exactly the paint a player is
 * checking when they look at the boundary.
 */
function ringTexture(boundary) {
  const key = String(boundary);
  const hit = ringCache.get(key);
  if (hit) return hit;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const half = size / 2;
  const r = half * Math.max(0.05, Math.min(1, boundary));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - half, y + 0.5 - half);
      // Two texels wide, hard-edged. No falloff — a soft ring is a gradient.
      if (d >= r - 1 && d <= r + 1) {
        ctx.fillStyle = PALETTE.ui.textMuted;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  const tex = toMarkTexture(canvas);
  ringCache.set(key, tex);
  return tex;
}

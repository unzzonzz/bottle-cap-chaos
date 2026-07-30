import { CanvasTexture, ClampToEdgeWrapping, NearestFilter } from 'three';
import { CAP_PANEL_RATIO } from '../cap/capGeometry.js';
import { DEFAULT_MARK, isSlotRef } from './MarkStorage.js';

/**
 * A mark, turned into the texture a cap's panel wears.
 *
 * ── the editor draws in ALPHA, the cap wears an OPAQUE bake ──────────────────
 * These are two different images and the difference is the whole of this file.
 *
 * The brief requires the eraser to remove paint rather than paint over it —
 * "배경색으로 덮는 방식이 아니라 알파를 지우는 방식" — so the editor's canvas is
 * RGBA with a transparent background and the eraser is a
 * `destination-out` composite. That canvas is what gets stored, and storing it
 * is what lets ONE mark be worn by both teams: it carries no cap colour, so it
 * is not red or blue until something puts it on a cap.
 *
 * The cap cannot wear it directly. `RetroMaterial`'s panel shader is
 * `base = uColor; base *= texture(uMap).rgb;` and it writes `vec4(c, 1.0)` — it
 * is the game's lit surface shader, it has no opacity term and no alpha
 * blending. Hand it a transparent mark and the unpainted area comes out as
 * whatever the RGB happens to be under an alpha nobody reads, which is black.
 *
 * So the panel texture is BAKED per team: fill the cap's own paint, composite
 * the mark over it, and set the material's `uColor` to white so the bake arrives
 * exactly as authored. Where the player erased, the fill shows through — which
 * is the cap colour, which is what "원래 뚜껑 색이 드러난다" asks for, arrived at
 * without the editor ever knowing what colour the cap is.
 *
 * ── the ring outside the circle is the team's, and it is never drawn on ─────
 * The bake fills the WHOLE square before compositing, so the area outside the
 * editor's circular boundary is cap paint by construction rather than by the
 * mark happening to be transparent there. Even a mark that somehow carried
 * pixels outside the circle could not put them on a cap: `drawImage` is clipped
 * to the same circle here as well. Two independent guarantees for the one thing
 * the brief says must not break.
 *
 * ── decoding is async, wearing a cap is not ─────────────────────────────────
 * A stored mark is a PNG data URL and turning one back into pixels goes through
 * `Image.decode`. Caps are built synchronously. So a texture is handed back
 * immediately — filled with the cap's paint, i.e. a clean cap — and repainted in
 * place the moment the image lands. On a cold start that is one frame of a plain
 * cap before the mark appears, which is invisible behind the menu's own fade and
 * is the only honest alternative to blocking the boot on a decode.
 */

/** Canvas edge, in texels. A slider in the panel; this is where it starts. */
export const MARK_CANVAS_DEFAULT = 128;

/**
 * How much of the half-width the drawable circle takes.
 *
 * ── this is a fraction of the PANEL, not of the cap ─────────────────────────
 * The panel's UVs map the cap's flat top onto the texture's INSCRIBED circle,
 * so `half * boundary` here is `panelRadius * boundary` on a cap — and the
 * panel is only about 0.856 of the cap's outer radius (`CAP_PANEL_RATIO`).
 * Anything that draws this circle somewhere else — the editor's guide ring, the
 * grid's thumbnail — has to multiply by that ratio or it will sit further out
 * than paint can actually reach. Both did, which is why the guide ring used to
 * enclose a band of cap that refused to take paint.
 *
 * Not 1. A boundary at 1.0 would let paint reach the panel's own rim and the
 * only team colour left would be the skirt. The gap between this circle and the
 * cap's edge is a ring of unpainted cap that reads as the team's from across the
 * board — the brief calls that ring the team marker and says to preserve it, so
 * it is a number with a job rather than a margin.
 *
 * 0.84 of the panel is 0.72 of the whole cap, which leaves that ring 28% of the
 * cap's radius — the width it has always had on screen. The number moved from
 * 0.72 to 0.84 only because it stopped being measured against the wrong circle.
 */
export const MARK_BOUNDARY_DEFAULT = 0.84;

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // Governs SCALING, not glyph rasterisation — there is no text here, so this is
  // the whole of what it takes to keep the bake hard-edged.
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

/** A blank drawing surface: fully transparent, ready to be painted into. */
export function createMarkCanvas(size = MARK_CANVAS_DEFAULT) {
  const { canvas, ctx } = makeCanvas(Math.max(16, Math.round(size)));
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Clip a context to the drawable circle. Every paint path goes through this. */
export function clipToBoundary(ctx, size, boundary = MARK_BOUNDARY_DEFAULT) {
  const half = size / 2;
  ctx.beginPath();
  ctx.arc(half, half, half * Math.max(0.05, Math.min(1, boundary)), 0, Math.PI * 2);
  ctx.clip();
}

/**
 * Cap paint plus the mark, as one opaque square.
 *
 * @param {HTMLCanvasElement|HTMLImageElement|null} mark  alpha artwork, or null
 * @param {string} capColor  the team's paint, as the cap would be without a mark
 * @param {number} size
 * @param {number} boundary
 * @param {number} [rotation]
 *   radians to turn the mark by before it goes on. The cap is a disc, so this is
 *   the only thing that decides which way up a drawing reads — see
 *   `MarkTextures`'s note on the two players facing each other.
 */
export function bakeCapPanel(
  mark,
  capColor,
  size = MARK_CANVAS_DEFAULT,
  boundary = MARK_BOUNDARY_DEFAULT,
  rotation = 0,
) {
  const { canvas, ctx } = makeCanvas(Math.max(16, Math.round(size)));
  ctx.fillStyle = capColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (mark) {
    ctx.save();
    // The second of the two guarantees. See the header. Clipped BEFORE the
    // rotation so the circle is the panel's, not a turned copy of it — they are
    // the same circle for any angle, but only because it is centred, and stating
    // it in this order means a future off-centre boundary cannot quietly rotate.
    clipToBoundary(ctx, canvas.width, boundary);
    if (rotation) {
      const half = canvas.width / 2;
      ctx.translate(half, half);
      ctx.rotate(rotation);
      ctx.translate(-half, -half);
    }
    ctx.drawImage(mark, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
  return canvas;
}

/** The project's texture settings. Every mark texture goes through here. */
export function toMarkTexture(canvas) {
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A slot's thumbnail: the mark on a cap top, seen from above.
 *
 * ── the disc is NEUTRAL, and that is a decision ─────────────────────────────
 * A slot belongs to the shared pool, not to a team — either player can wear it
 * and both can wear it at once — so painting the thumbnail red or blue would be
 * asserting an ownership the mark does not have. The grey disc says "a mark",
 * and the `1P`/`2P` badges on the tile say who is wearing it, which is the one
 * place that question is actually answered.
 *
 * The ring outside the drawable circle is drawn a shade darker so the boundary
 * the editor enforces is visible here too: what you see in the grid is the
 * shape of what you are allowed to paint.
 *
 * The disc here is the whole CAP, so everything measured in panel space has to
 * come back through `CAP_PANEL_RATIO` — including the mark itself, whose square
 * covers the panel on a real cap and must not be stretched to the silhouette
 * here or the grid would advertise a bigger drawing than the game will wear.
 */
export function markThumbnail(mark, size = 64, boundary = MARK_BOUNDARY_DEFAULT) {
  const { canvas, ctx } = makeCanvas(Math.max(16, Math.round(size)));
  const half = canvas.width / 2;
  const capR = half - 1;
  const panelR = capR * CAP_PANEL_RATIO;
  const drawR = panelR * Math.max(0.05, Math.min(1, boundary));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // The cap top: a plain disc, with the untouchable ring a step darker.
  ctx.fillStyle = '#6e737d';
  ctx.beginPath();
  ctx.arc(half, half, capR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#878d98';
  ctx.beginPath();
  ctx.arc(half, half, drawR, 0, Math.PI * 2);
  ctx.fill();

  if (mark) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, drawR, 0, Math.PI * 2);
    ctx.clip();
    // The mark's own inscribed circle is the panel, so its square is the panel's
    // bounding square — the same relationship `bakeCapPanel` gets for free by
    // being drawn in panel space to begin with.
    ctx.drawImage(mark, half - panelR, half - panelR, panelR * 2, panelR * 2);
    ctx.restore();
  }
  return canvas;
}

/**
 * One texture per (mark, cap colour), kept alive and repainted in place.
 *
 * ── repainted, never replaced ───────────────────────────────────────────────
 * The cap materials hold a reference to whatever texture they were built with,
 * and `RetroMaterials.create` bakes `USE_RETRO_MAP` at construction — a material
 * made without a map can never sample one afterwards. So the contract here is
 * that a caller gets a texture ONCE per team and this class redraws its canvas
 * underneath: a changed assignment, a freshly decoded image and an edited mark
 * all arrive as a `needsUpdate` on the same object. Nothing above ever swaps a
 * texture, which means nothing above can leak one either.
 */
export class MarkTextures {
  /**
   * @param {import('./MarkBook.js').MarkBook} book
   * @param {string[]} capColors  indexed by player
   * @param {HTMLImageElement|HTMLCanvasElement|null} defaultMark
   *   The built-in logo, already decoded. Injected rather than imported so this
   *   module owns no artwork of its own.
   * @param {number[]} [rotations]
   *   Which way up each player's mark goes on, in radians. Defaults to zero for
   *   everyone — as drawn, which is what a screen showing caps to ONE viewer
   *   wants.
   *
   *   ── the caller decides, because only the caller knows the seating ────────
   *   The panel's UVs are the same projection on every cap, so a mark baked
   *   identically for both players points the same way on both. Whether that is
   *   right depends entirely on where the two players are: across a board from
   *   each other they should be turned to face one another, and on a result
   *   screen they should both face the camera. Same book, same artwork, two
   *   different correct answers — so this class only carries the angles.
   *
   *   Measured, for whoever needs it next: with a rotation of zero the artwork's
   *   TOP comes out pointing toward the near edge of the board (down the screen),
   *   because `CanvasTexture` flips Y and the panel's `v` runs opposite the
   *   cap's local +z. So it is the NEAR player's mark that needs the half turn.
   *
   *   Baked rather than applied as a texture transform because
   *   `RetroMaterial`'s panel shader samples `uMap` directly and never looks at
   *   `texture.matrix`.
   */
  constructor({
    book,
    capColors,
    defaultMark = null,
    size = MARK_CANVAS_DEFAULT,
    boundary = MARK_BOUNDARY_DEFAULT,
    rotations = null,
  }) {
    this.book = book;
    this.capColors = capColors;
    this.defaultMark = defaultMark;
    this.size = size;
    this.boundary = boundary;
    this.rotations = rotations ?? capColors.map(() => 0);

    /** One entry per player: the canvas its panel texture is drawn on. */
    this._canvas = capColors.map(() => null);
    this._texture = capColors.map(() => null);
    /** Decoded slot images, by slot index. Populated asynchronously. */
    this._decoded = new Map();
    /** Bumped on every refresh so a late decode knows if it is still wanted. */
    this._generation = 0;

    this._unsubscribe = book.onChange(() => this.refresh());
  }

  /**
   * The texture this player's cap panel should wear. Stable for the session.
   *
   * Built on first ask and then only repainted, so a caller may hold it for as
   * long as the cap exists.
   */
  textureFor(player) {
    if (!this._texture[player]) {
      this._canvas[player] = bakeCapPanel(null, this.capColors[player], this.size, this.boundary);
      this._texture[player] = toMarkTexture(this._canvas[player]);
      this._paint(player);
    }
    return this._texture[player];
  }

  /**
   * The material tint that goes with it: always white.
   *
   * The bake already contains the cap's paint, so multiplying by the team colour
   * a second time would square it — a red cap would come out maroon and the
   * mark's own colours would be dragged toward red with it. `capTexture.js`
   * states the same contract from the other side, and `CapWipe` and the victory
   * screen both already honour it.
   */
  get panelTint() {
    return '#ffffff';
  }

  /** Re-bake both players. Called on every book change. */
  refresh() {
    this._generation++;
    for (let p = 0; p < this.capColors.length; p++) {
      if (this._texture[p]) this._paint(p);
    }
  }

  /** Change the cap colours (the panel can). Re-bakes. */
  setCapColors(colors) {
    this.capColors = colors;
    this.refresh();
  }

  setSize(size) {
    if (size === this.size) return;
    this.size = Math.max(16, Math.round(size));
    // The canvas is the texture's source, so it has to be rebuilt rather than
    // resized — and the texture object must survive, per the class note.
    for (let p = 0; p < this.capColors.length; p++) {
      if (!this._texture[p]) continue;
      this._canvas[p] = bakeCapPanel(null, this.capColors[p], this.size, this.boundary);
      this._texture[p].image = this._canvas[p];
      this._paint(p);
    }
  }

  setBoundary(boundary) {
    this.boundary = boundary;
    this.refresh();
  }

  /** Draw whatever this player is currently wearing onto their canvas. */
  _paint(player) {
    const canvas = this._canvas[player];
    if (!canvas) return;
    const ref = this.book.assignedTo(player);
    const art = this._artFor(ref, player);
    const baked = bakeCapPanel(
      art,
      this.capColors[player],
      canvas.width,
      this.boundary,
      this.rotations[player] ?? 0,
    );
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baked, 0, 0);
    this._texture[player].needsUpdate = true;
  }

  /**
   * The artwork for a reference, or null for a clean cap.
   *
   * A slot whose PNG has not been decoded yet returns null and schedules the
   * decode; when it lands, the player is repainted. `null` is also the honest
   * answer for an unassigned player and for a slot that has been deleted, and
   * all three produce the same picture — a cap with nothing on it — which is
   * exactly what the brief asks for in each case.
   */
  _artFor(ref, player) {
    if (ref === DEFAULT_MARK) return this.defaultMark;
    if (!isSlotRef(ref)) return null;
    const url = this.book.slotImage(ref);
    if (!url) return null;

    const hit = this._decoded.get(url);
    if (hit) return hit;
    this._decode(url, player);
    return null;
  }

  _decode(url, player) {
    const generation = this._generation;
    const img = new Image();
    img.onload = () => {
      this._decoded.set(url, img);
      // Only if nothing has changed since. A player who reassigned while the
      // decode was in flight must not have the old mark painted over the new.
      if (generation === this._generation) this._paint(player);
    };
    // A stored URL that will not decode is treated as no mark rather than as an
    // error: it is one slot's artwork, and the menu has to keep working.
    img.onerror = () => {};
    img.src = url;
  }

  dispose() {
    this._unsubscribe?.();
    for (const t of this._texture) t?.dispose();
    this._texture.fill(null);
    this._canvas.fill(null);
    this._decoded.clear();
  }
}

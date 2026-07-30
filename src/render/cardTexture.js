import { CanvasTexture, NearestFilter, ClampToEdgeWrapping } from 'three';

/**
 * A card face, drawn at whatever resolution it is asked for.
 *
 * ── two resolutions, and why ────────────────────────────────────────────────
 * A card in the hand is small on screen and 128x192 is plenty for it. The same
 * texture on a card that has been raised and enlarged to be READ is not: the
 * description line is the first thing to go, and a card you cannot read is a
 * card you cannot choose. So the hovered card swaps up to a larger texture and
 * swaps back down when it drops — the same idea as a mesh LOD, for the same
 * reason, and the only thing that differs between the two is how many texels
 * the drawing gets. Filtering, wrapping and the post chain are identical, so a
 * card does not change its LOOK when it changes its detail.
 *
 * ── the text has to be aliased ──────────────────────────────────────────────
 * `imageSmoothingEnabled = false` does not do it: that flag governs image
 * SCALING, and the font rasteriser antialiases glyph edges regardless. Left
 * alone, every letter arrives with a halo of intermediate values, and those get
 * flattened by the 5-bit quantiser downstream into fringing that reads as a
 * compression artefact.
 *
 * So text is drawn to a scratch canvas and its alpha is pushed to fully on or
 * fully off before it is composited. Hard edges, no halo, and it survives the
 * quantiser because there is nothing left in between to quantise.
 *
 * ── cached ──────────────────────────────────────────────────────────────────
 * Keyed by card and size. Building one of these is a handful of canvas calls
 * and several `getImageData` round trips, which is nothing once and unthinkable
 * every frame.
 */

const BG = '#12161d';
const PANEL = '#0c0f15';
const RULE = '#262d3a';
const BODY = '#98a1af';
const BACK_A = '#1b2230';
const BACK_B = '#141a25';
const BACK_MARK = '#3d4756';

/** Alpha at or above this survives; everything else is dropped. */
const ALPHA_CUT = 110;

const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

/**
 * Draw text with hard edges.
 *
 * Rasterised on a scratch canvas, thresholded, then blitted. Doing it in place
 * would mean thresholding the card art underneath it as well.
 */
function crispText(target, scratch, { text, x, y, font, color, align = 'left' }) {
  const { canvas, ctx } = scratch;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= ALPHA_CUT ? 255 : 0;
  ctx.putImageData(img, 0, 0);

  target.drawImage(canvas, 0, 0);
}

/** Wrap `text` to `width` px in the current font, by measuring. */
function wrap(ctx, text, width, font) {
  ctx.font = font;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {import('../game/cards/cardCatalog.js').CardDef} card
 * @param {number} width  texels. Height follows the card's 2:3 proportion.
 */
export function cardFaceTexture(card, width) {
  const w = Math.max(48, Math.round(width));
  const h = Math.round(w * 1.5);
  const key = `face:${card.id}:${w}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(w, h);
  const scratch = makeCanvas(w, h);
  /** Everything below is authored against a 128-wide card and scaled. */
  const u = w / 128;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);

  // Border, and a chamfer at two corners. Sharp — a radius is the fastest way
  // to make this look like it came from a different program than the pitch.
  ctx.strokeStyle = card.accent;
  ctx.lineWidth = Math.max(1, Math.round(u));
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = '#000000';
  const ch = Math.round(9 * u);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(ch, 0);
  ctx.lineTo(0, ch);
  ctx.closePath();
  ctx.moveTo(w, h);
  ctx.lineTo(w - ch, h);
  ctx.lineTo(w, h - ch);
  ctx.closePath();
  ctx.fill();

  // Name, then a rule under it.
  crispText(ctx, scratch, {
    text: card.name,
    x: Math.round(7 * u),
    y: Math.round(19 * u),
    font: `${Math.round(14 * u)}px ui-monospace, Menlo, monospace`,
    color: card.accent,
  });
  ctx.fillStyle = RULE;
  ctx.fillRect(Math.round(5 * u), Math.round(25 * u), w - Math.round(10 * u), Math.max(1, Math.round(u)));

  // Art panel and its glyph. One angular character rather than an
  // illustration — see `cardCatalog`.
  const artY = Math.round(31 * u);
  const artH = Math.round(78 * u);
  ctx.fillStyle = PANEL;
  ctx.fillRect(Math.round(6 * u), artY, w - Math.round(12 * u), artH);
  crispText(ctx, scratch, {
    text: card.glyph,
    x: Math.round(w / 2),
    y: artY + Math.round(artH * 0.68),
    font: `${Math.round(46 * u)}px ui-monospace, Menlo, monospace`,
    color: card.accent,
    align: 'center',
  });

  // Description, wrapped to the card.
  const bodyFont = `${Math.round(10 * u)}px ui-monospace, Menlo, monospace`;
  const lines = wrap(ctx, card.text, w - Math.round(14 * u), bodyFont);
  let ty = artY + artH + Math.round(14 * u);
  for (const line of lines.slice(0, 3)) {
    crispText(ctx, scratch, {
      text: line,
      x: Math.round(7 * u),
      y: ty,
      font: bodyFont,
      color: BODY,
    });
    ty += Math.round(12 * u);
  }

  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** The back. One texture for every card — that is what a back is. */
export function cardBackTexture(width) {
  const w = Math.max(48, Math.round(width));
  const h = Math.round(w * 1.5);
  const key = `back:${w}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(w, h);
  const scratch = makeCanvas(w, h);
  const u = w / 128;

  // Hard-stop diagonal stripes: a pattern, not a gradient.
  ctx.fillStyle = BACK_B;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = BACK_A;
  const band = Math.max(2, Math.round(6 * u));
  for (let i = -h; i < w + h; i += band * 2) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + band, 0);
    ctx.lineTo(i + band + h, h);
    ctx.lineTo(i + h, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = BACK_MARK;
  ctx.lineWidth = Math.max(1, Math.round(u));
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  crispText(ctx, scratch, {
    text: '✶',
    x: Math.round(w / 2),
    y: Math.round(h / 2 + 12 * u),
    font: `${Math.round(30 * u)}px ui-monospace, Menlo, monospace`,
    color: BACK_MARK,
    align: 'center',
  });

  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * A one-line plate: why a card cannot be played.
 *
 * Sized to the text rather than to a fixed box, so the plate is as wide as what
 * it says and no wider — a fixed-width tooltip either truncates the long reason
 * or leaves a slab of empty plate next to the short one.
 *
 * Drawn at one texel per frame pixel, like the cards, so it lands on the
 * framebuffer grid and the type survives. `width`/`height` come back on the
 * texture's `userData` because the caller has to scale the quad to match, and
 * scaling it to anything else would resample the very thing this exists to keep
 * readable.
 */
export function noticeTexture(text) {
  const key = `notice:${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const font = '11px ui-monospace, Menlo, monospace';
  const probe = makeCanvas(8, 8);
  probe.ctx.font = font;
  const w = Math.ceil(probe.ctx.measureText(text).width) + 16;
  const h = 20;

  const { canvas, ctx } = makeCanvas(w, h);
  const scratch = makeCanvas(w, h);
  ctx.fillStyle = '#0c0f15';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e0553f';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  crispText(ctx, scratch, {
    text,
    x: 8,
    y: 14,
    font,
    color: '#f0a090',
  });

  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  tex.userData = { width: w, height: h };
  cache.set(key, tex);
  return tex;
}

/** Drop every cached texture. For a resolution change from the panel. */
export function clearCardTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

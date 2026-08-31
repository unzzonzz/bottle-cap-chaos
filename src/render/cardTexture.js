import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from 'three';
import { PALETTE } from '../core/palette.js';
import { registerTextureCache } from '../ui/fonts.js';

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

const BG = PALETTE.ui.surface;
const PANEL = PALETTE.ui.surfaceAlt;
const RULE = PALETTE.ui.edge;
const BODY = PALETTE.ui.textMuted;
const BACK_A = PALETTE.ui.surfaceAlt;
const BACK_B = PALETTE.ui.surfaceSunken;
const BACK_MARK = PALETTE.ui.edgeStrong;

/**
 * A card's accent, from the palette rather than from the catalog.
 *
 * `cardCatalog` still carries an `accent` per card and it is deliberately not
 * the source of truth: the catalog lives under `src/game/`, which is simulation
 * territory that art work does not edit, and its six accents were chosen against
 * a near-black card face. This looks the id up in `PALETTE.card` and falls back
 * to the catalog value for a card the palette has not been told about, so adding
 * one cannot leave the hand with an undefined `strokeStyle`.
 */
function accentOf(card) {
  return PALETTE.card[card.id] ?? card.accent;
}


const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

/**
 * 텍스트를 그린다. 임계 처리 없이, 대상 컨텍스트에 바로.
 *
 * ── 스크래치 캔버스와 알파 이진화가 사라졌다 ────────────────────────────────
 * 예전 이름은 `crispText` 였고, 스크래치 캔버스에 글자를 그린 뒤 알파를 110 에서
 * 0 아니면 255 로 자르고 그것을 blit 했다. 제자리에서 자르면 밑에 이미 그려진
 * 그림까지 같이 잘리기 때문에 캔버스가 하나 더 필요했다.
 *
 * 그 임계 처리는 저해상도 타겟에 nearest 로 확대되는 파이프라인에서 글자 가장자리의
 * 중간 알파가 디더와 5비트 양자화를 거치며 지저분해지는 것을 막으려던 것이다. 셋 다
 * 없다.
 *
 * 없애서 얻은 것이 셋이다: 글자가 부드럽고, 고DPI 에서 선명하고, 텍스처 하나마다
 * 있던 `getImageData` / `putImageData` 왕복이 사라졌다 — 그건 GPU 파이프라인을
 * 세우는 동기 호출이라 공짜가 아니었다.
 */
function drawText(target, { text, x, y, font, color, align = 'left' }) {
  target.save();
  target.font = font;
  target.textAlign = align;
  target.textBaseline = 'alphabetic';
  target.fillStyle = color;
  target.fillText(text, x, y);
  target.restore();
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
  ctx.strokeStyle = accentOf(card);
  ctx.lineWidth = Math.max(1, Math.round(u));
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  // The chamfer's cut corners. The palette's edge rather than the black they
  // were: on a white face a black triangle is not a cut corner, it is a hole.
  ctx.fillStyle = PALETTE.ui.edge;
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
  drawText(ctx, {
    text: card.name,
    x: Math.round(7 * u),
    y: Math.round(19 * u),
    font: `${Math.round(14 * u)}px ui-monospace, Menlo, monospace`,
    color: accentOf(card),
  });
  ctx.fillStyle = RULE;
  ctx.fillRect(Math.round(5 * u), Math.round(25 * u), w - Math.round(10 * u), Math.max(1, Math.round(u)));

  // Art panel and its glyph. One angular character rather than an
  // illustration — see `cardCatalog`.
  const artY = Math.round(31 * u);
  const artH = Math.round(78 * u);
  ctx.fillStyle = PANEL;
  ctx.fillRect(Math.round(6 * u), artY, w - Math.round(12 * u), artH);
  drawText(ctx, {
    text: card.glyph,
    x: Math.round(w / 2),
    y: artY + Math.round(artH * 0.68),
    font: `${Math.round(46 * u)}px ui-monospace, Menlo, monospace`,
    color: accentOf(card),
    align: 'center',
  });

  // Description, wrapped to the card.
  const bodyFont = `${Math.round(10 * u)}px ui-monospace, Menlo, monospace`;
  const lines = wrap(ctx, card.text, w - Math.round(14 * u), bodyFont);
  let ty = artY + artH + Math.round(14 * u);
  for (const line of lines.slice(0, 3)) {
    drawText(ctx, {
      text: line,
      x: Math.round(7 * u),
      y: ty,
      font: bodyFont,
      color: BODY,
    });
    ty += Math.round(12 * u);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
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
  drawText(ctx, {
    text: '✶',
    x: Math.round(w / 2),
    y: Math.round(h / 2 + 12 * u),
    font: `${Math.round(30 * u)}px ui-monospace, Menlo, monospace`,
    color: BACK_MARK,
    align: 'center',
  });

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * The drop guide: a card-shaped slot, in hard yellow, hollow in the middle.
 *
 * ── it is an AFFORDANCE, and it is placed where the rule already is ──────────
 * The gesture that plays a card is vertical travel out of the fan — see
 * `CardHand._checkArmed` — and that is deliberately not "land inside a target",
 * for the reason written there: a target is a small thing to find, and it makes
 * the same gesture succeed or fail depending on which end of the hand the card
 * started from. None of that changes because there is now something drawn.
 *
 * What the drawing is for is the other half of the problem, which is real: a
 * threshold you cannot see is a threshold you have to discover by failing at it.
 * So this is drawn at exactly the height the card arms at, and following it
 * therefore always works. It is a signpost on the rule, not a second rule.
 *
 * ── hollow, and bigger than the card ────────────────────────────────────────
 * Hollow because the card has to be readable through it while it is being
 * carried. Bigger — see `guideMargin` — because a border exactly the card's size
 * is a border the card covers completely the moment it arrives, so the guide
 * would vanish at precisely the moment it is confirming something.
 *
 * ── corner brackets ─────────────────────────────────────────────────────────
 * The border alone reads as a panel. Four brackets read as a SLOT, and they are
 * the one shape that says "put it here" without a word on it. Drawn as whole
 * pixels at hard values, like everything else in this file — a soft glow around
 * a drop target is the single most modern thing this screen could grow.
 *
 * @param {number} width   texels across, matching the on-screen size
 * @param {number} height  texels down. Not derived: the guide carries a margin,
 *                         so its proportion is the card's only when that is 0.
 */
export function useGuideTexture(width, height) {
  const w = Math.max(24, Math.round(width));
  const h = Math.max(24, Math.round(height));
  const key = `guide:${w}:${h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(w, h);
  const u = w / 128;

  const EDGE = PALETTE.accent.yellow;
  const CORE = PALETTE.accent.yellowPale;
  const SHADE = PALETTE.accent.yellowDeep;

  const line = Math.max(1, Math.round(2 * u));
  const rect = (x, y, rw, rh, style) => {
    ctx.fillStyle = style;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(rw)), Math.max(1, Math.round(rh)));
  };

  // The frame: one lit band with a darker one inside it. Two hard tones, not a
  // falloff — three would already start reading as a gradient at this width.
  const band = (inset, t, style) => {
    rect(inset, inset, w - inset * 2, t, style);
    rect(inset, h - inset - t, w - inset * 2, t, style);
    rect(inset, inset, t, h - inset * 2, style);
    rect(w - inset - t, inset, t, h - inset * 2, style);
  };
  band(0, line, EDGE);
  band(line, Math.max(1, Math.round(u)), SHADE);

  // Brackets: a longer, brighter run at each corner, drawn over the frame.
  const arm = Math.max(4, Math.round(22 * u));
  const t = Math.max(1, Math.round(3 * u));
  for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const x = cx ? w - arm : 0;
    const y = cy ? h - t : 0;
    rect(x, y, arm, t, CORE);
    rect(cx ? w - t : 0, cy ? h - arm : 0, t, arm, CORE);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
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
  ctx.fillStyle = PALETTE.ui.surface;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = PALETTE.ui.danger;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  drawText(ctx, {
    text,
    x: 8,
    y: 14,
    font,
    color: PALETTE.ui.dangerDeep,
  });

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
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
export const clearCardTextureCache = registerTextureCache(() => {
  for (const t of cache.values()) t.dispose();
  cache.clear();});

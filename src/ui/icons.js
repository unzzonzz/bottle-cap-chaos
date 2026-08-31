import { PALETTE, withAlpha } from '../core/palette.js';

/**
 * Every icon in the game, drawn as vector paths.
 *
 * ── why they stopped being type ─────────────────────────────────────────────
 * The cards used single Unicode glyphs, and `cardCatalog.js` records how they
 * were chosen: by rendering candidates at 46px and COUNTING INKED PIXELS, because
 * the pipeline thresholded alpha to hard 0/255 and then quantised to five bits a
 * channel, so anything with fill in it arrived as a lump. The note records the
 * measurements — a lozenge at 402 pixels blocked up, a double chevron at 228
 * passed.
 *
 * That constraint is gone once PHASE 4 removes the alpha threshold, and with it
 * the reason to accept whatever shape a font happened to provide. These are
 * drawn instead, which also means they share a stroke weight, a corner radius
 * and a visual density that six glyphs from one typeface never did.
 *
 * ── the signature is `(ctx, size, color)` ───────────────────────────────────
 * Each entry draws inside a `size` x `size` box with its origin at 0,0 and
 * leaves the context as it found it. `drawIcon` below is what callers use — it
 * handles placement and the aero gloss pass.
 *
 * ── `glyph` is now a KEY ────────────────────────────────────────────────────
 * `cardCatalog.js` still has a `glyph` field. It is no longer rendered; it is
 * looked up in `CARD_ICON` to find the drawing function. That keeps the mapping
 * out of `src/game/`, which art work does not edit, and means a card whose icon
 * has not been drawn yet falls back rather than throwing.
 */

/** Stroke weight as a fraction of the icon box. One value, every icon. */
const STROKE = 0.11;
/** How far icon geometry stays inside the box, so strokes never clip. */
const PAD = 0.16;

function setup(ctx, size, color) {
  ctx.lineWidth = size * STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

/** An arrowhead at (x, y) pointing along `angle`, sized off the stroke. */
function arrowHead(ctx, size, x, y, angle) {
  const a = size * 0.17;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - a * Math.cos(angle - 0.45), y - a * Math.sin(angle - 0.45));
  ctx.moveTo(x, y);
  ctx.lineTo(x - a * Math.cos(angle + 0.45), y - a * Math.sin(angle + 0.45));
  ctx.stroke();
}

/* ── card icons ──────────────────────────────────────────────────────────── */

/** 교체 — two arrows passing each other. */
function iconSwap(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * PAD;
  const r = size * (1 - PAD);
  const yTop = size * 0.36;
  const yBot = size * 0.64;
  ctx.beginPath();
  ctx.moveTo(l, yTop);
  ctx.lineTo(r, yTop);
  ctx.stroke();
  arrowHead(ctx, size, r, yTop, 0);
  ctx.beginPath();
  ctx.moveTo(r, yBot);
  ctx.lineTo(l, yBot);
  ctx.stroke();
  arrowHead(ctx, size, l, yBot, Math.PI);
}

/** 궤적 — a launch arc with its landing point. */
function iconTrajectory(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * PAD;
  const r = size * (1 - PAD);
  const base = size * 0.74;
  ctx.beginPath();
  ctx.moveTo(l, base);
  ctx.quadraticCurveTo(size * 0.5, size * 0.02, r, base);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(l, base, size * 0.085, 0, Math.PI * 2);
  ctx.fill();
  arrowHead(ctx, size, r, base, Math.PI * 0.42);
}

/** 혼돈 — an unequal six-arm burst. Deliberately not a symmetric asterisk. */
function iconChaos(ctx, size, color) {
  setup(ctx, size, color);
  const c = size / 2;
  const arms = [
    [-Math.PI / 2, 0.40],
    [-Math.PI / 6, 0.32],
    [Math.PI / 6, 0.38],
    [Math.PI / 2, 0.30],
    [(Math.PI * 5) / 6, 0.36],
    [(-Math.PI * 5) / 6, 0.29],
  ];
  for (const [a, len] of arms) {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * size * len, c + Math.sin(a) * size * len);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(c, c, size * 0.085, 0, Math.PI * 2);
  ctx.fill();
}

/** 한 번 더 — a circular arrow, open at the top right. */
function iconOnemore(ctx, size, color) {
  setup(ctx, size, color);
  const c = size / 2;
  const r = size * 0.30;
  const from = -Math.PI * 0.35;
  const to = Math.PI * 1.35;
  ctx.beginPath();
  ctx.arc(c, c, r, from, to);
  ctx.stroke();
  const hx = c + Math.cos(from) * r;
  const hy = c + Math.sin(from) * r;
  arrowHead(ctx, size, hx, hy, from - Math.PI / 2);
}

/** 강타 — a double chevron. The one shape that survived from the glyph set. */
function iconSmash(ctx, size, color) {
  setup(ctx, size, color);
  const mid = size * 0.5;
  const top = size * 0.24;
  const bot = size * 0.76;
  for (const x of [size * 0.3, size * 0.56]) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + size * 0.2, mid);
    ctx.lineTo(x, bot);
    ctx.stroke();
  }
}

/**
 * 침묵 — a padlock.
 *
 * The glyph was a slashed circle, which is the generic "no". A padlock says the
 * specific thing this card does, and it is the SAME shape `fxTextures.lockTexture`
 * stamps on a silenced cap — so the card in the hand and the mark on the board
 * are one vocabulary rather than two.
 */
function iconSilence(ctx, size, color) {
  setup(ctx, size, color);
  const bw = size * 0.52;
  const bh = size * 0.34;
  const bx = (size - bw) / 2;
  const by = size * 0.5;
  const r = size * 0.08;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, r);
  else ctx.rect(bx, by, bw, bh);
  ctx.fill();
  ctx.lineWidth = size * 0.095;
  ctx.beginPath();
  ctx.arc(size / 2, by, size * 0.17, Math.PI, 0);
  ctx.stroke();
}

/* ── UI icons ────────────────────────────────────────────────────────────── */

/** Recentre — four corner brackets around a dot. Kept from the old HUD. */
function iconRecenter(ctx, size, color) {
  setup(ctx, size, color);
  const p = size * 0.22;
  const q = size * (1 - 0.22);
  const arm = size * 0.16;
  const corners = [
    [p, p, 1, 1], [q, p, -1, 1], [p, q, 1, -1], [q, q, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.075, 0, Math.PI * 2);
  ctx.fill();
}

/** Exit — a door with an arrow leaving it. */
function iconExit(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * 0.22;
  const t = size * 0.2;
  const b = size * 0.8;
  ctx.beginPath();
  ctx.moveTo(size * 0.52, t);
  ctx.lineTo(l, t);
  ctx.lineTo(l, b);
  ctx.lineTo(size * 0.52, b);
  ctx.stroke();
  const y = size / 2;
  ctx.beginPath();
  ctx.moveTo(size * 0.46, y);
  ctx.lineTo(size * 0.8, y);
  ctx.stroke();
  arrowHead(ctx, size, size * 0.8, y, 0);
}

/** Back — a single chevron, left. */
function iconBack(ctx, size, color) {
  setup(ctx, size, color);
  ctx.beginPath();
  ctx.moveTo(size * 0.62, size * 0.22);
  ctx.lineTo(size * 0.36, size * 0.5);
  ctx.lineTo(size * 0.62, size * 0.78);
  ctx.stroke();
}

/** Confirm — a tick. */
function iconCheck(ctx, size, color) {
  setup(ctx, size, color);
  ctx.beginPath();
  ctx.moveTo(size * 0.22, size * 0.53);
  ctx.lineTo(size * 0.42, size * 0.72);
  ctx.lineTo(size * 0.78, size * 0.28);
  ctx.stroke();
}

/** Dismiss — a cross. */
function iconClose(ctx, size, color) {
  setup(ctx, size, color);
  const a = size * 0.28;
  const b = size * 0.72;
  ctx.beginPath();
  ctx.moveTo(a, a);
  ctx.lineTo(b, b);
  ctx.moveTo(b, a);
  ctx.lineTo(a, b);
  ctx.stroke();
}

/** Sound — a speaker with one arc. */
function iconSound(ctx, size, color) {
  setup(ctx, size, color);
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.4);
  ctx.lineTo(size * 0.34, size * 0.4);
  ctx.lineTo(size * 0.5, size * 0.24);
  ctx.lineTo(size * 0.5, size * 0.76);
  ctx.lineTo(size * 0.34, size * 0.6);
  ctx.lineTo(size * 0.2, size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = size * 0.085;
  ctx.beginPath();
  ctx.arc(size * 0.54, size * 0.5, size * 0.18, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();
}

export const ICON = {
  swap: iconSwap,
  trajectory: iconTrajectory,
  chaos: iconChaos,
  onemore: iconOnemore,
  smash: iconSmash,
  silence: iconSilence,
  lock: iconSilence,
  recenter: iconRecenter,
  exit: iconExit,
  back: iconBack,
  check: iconCheck,
  close: iconClose,
  sound: iconSound,
};

/**
 * `cardCatalog` glyph -> icon name.
 *
 * Keyed on the glyph rather than the card id because the glyph is the field the
 * brief allows to change and the id is the field it does not. A card whose glyph
 * is not in here falls through to the id, and then to nothing drawn — never to a
 * throw, because a missing icon must not take the hand down mid-match.
 */
export const CARD_ICON = {
  '⇄': 'swap',
  '⌁': 'trajectory',
  '✳': 'chaos',
  '↻': 'onemore',
  '≫': 'smash',
  '⊘': 'silence',
};

/** Which icon a catalog card should draw. */
export function iconForCard(card) {
  return CARD_ICON[card?.glyph] ?? (ICON[card?.id] ? card.id : null);
}

/**
 * Draw an icon, with the aero gloss pass.
 *
 * ── the gloss goes through an offscreen canvas, and it has to ───────────────
 * The highlight is "white over the top 45% of the icon's own pixels", which is
 * `globalCompositeOperation = 'source-atop'`. Run against the destination canvas
 * that would composite onto everything already drawn there — the plate, its
 * gradient, its border. So the icon is rendered to its own surface, glossed
 * there where it is the only content, and blitted.
 */
export function drawIcon(ctx, name, { x, y, size, color, gloss = true }) {
  const fn = ICON[name];
  if (!fn) return;

  if (!gloss) {
    ctx.save();
    ctx.translate(x, y);
    fn(ctx, size, color);
    ctx.restore();
    return;
  }

  // Rounded up so a fractional frame-pixel size still gets whole texels, and
  // floored at 8 because the gloss gradient needs somewhere to land.
  const edge = Math.max(8, Math.ceil(size));
  const off = document.createElement('canvas');
  off.width = edge;
  off.height = edge;
  const octx = off.getContext('2d');
  fn(octx, edge, color);

  octx.globalCompositeOperation = 'source-atop';
  const g = octx.createLinearGradient(0, 0, 0, edge * 0.55);
  g.addColorStop(0, withAlpha(PALETTE.ui.glossHi, 0.55));
  g.addColorStop(1, withAlpha(PALETTE.ui.glossLo, 0));
  octx.fillStyle = g;
  octx.fillRect(0, 0, edge, edge);

  ctx.drawImage(off, x, y, size, size);
}

import { withAlpha } from '../core/palette.js';
import { RULE } from '../core/tokens.js';

/**
 * The decorative vocabulary: eight marks, and one meaning each.
 *
 * ── this is not `src/marks/` ────────────────────────────────────────────────
 * `src/marks/` is the mark EDITOR — the artwork a player draws on their own cap,
 * stored per player, previewed on a turntable. Nothing here touches that. The
 * word collides because the brief calls both of them 마크; these are the
 * interface's own small graphics and they are authored, not drawn by anybody.
 *
 * ── the rule that makes it a vocabulary ─────────────────────────────────────
 * §20 of the brief hands over a fixed set of motifs and the direction adds the
 * only thing that makes a set of motifs worth having:
 *
 *   > 각 모티프에 쓰임을 정하고 지켜라. 아무 데나 쓰면 어휘가 아니라 장식이 된다.
 *
 * So each function below states what it MEANS, and that meaning is enforced by
 * nothing but this comment and review. The table, in one place:
 *
 *   `*`  asterisk   this has a condition attached. Footnotes, costs, caveats.
 *   `✦`  sparkle    something was just gained. A new mark, a card drawn, a point.
 *   `·`  dot        where you are. The item under the cursor, the current page.
 *   `○`  ring       a PLAYER. 1P/2P markers, turn order, nothing else.
 *   `~`  wave       water, and by extension movement. Never a decorative squiggle.
 *   ripple          something arrived. A card arming, an impact landing.
 *   halftone        this is an AREA rather than a line. The error cone's texture.
 *   hairline        two things are separate. Dividers, rules, underlines.
 *
 * Adding a ninth is allowed. Using one of these eight for something outside its
 * row is not — that is how a vocabulary becomes a pile of ornaments, and the
 * pile is what §24 means when it bans decorative clutter.
 *
 * ── every function is (ctx, …, color) and leaves the context as it found it ──
 * Sizes are in the caller's current units, which for every UI surface is frame
 * pixels. Nothing here reads the palette: the colour is always an argument, so
 * a mark can be drawn in a player's colour or a card's accent without this file
 * having to know either exists.
 */

/**
 * `*` — this has a condition attached.
 *
 * Six strokes through the centre rather than a glyph, because the face's own
 * asterisk sits high on the line (it is a superscript mark) and this one has to
 * centre on whatever it annotates.
 */
export function asterisk(ctx, x, y, size, color, weight = RULE.thin) {
  const r = size / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * `✦` — something was just gained.
 *
 * A four-point star with concave sides. Drawn as a filled path rather than as
 * strokes: it is the one mark that is allowed to be solid, because "new" has to
 * out-read everything next to it and this vocabulary has no other way to shout.
 *
 * The waist at 0.28 is what makes the points read as points. At 0.5 it is a
 * diamond and stops saying anything.
 */
export function sparkle(ctx, x, y, size, color) {
  const r = size / 2;
  const w = r * 0.28;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + w * 0.4, y - w * 0.4, x + r, y);
  ctx.quadraticCurveTo(x + w * 0.4, y + w * 0.4, x, y + r);
  ctx.quadraticCurveTo(x - w * 0.4, y + w * 0.4, x - r, y);
  ctx.quadraticCurveTo(x - w * 0.4, y - w * 0.4, x, y - r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** `·` — where you are. The item under the cursor, the current page. */
export function dot(ctx, x, y, size, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * `○` — a player.
 *
 * Hollow, always. A filled circle is a `dot` and means something else, so the
 * two never collide even at the sizes where they are three pixels across.
 */
export function ring(ctx, x, y, r, weight, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r - weight / 2), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * `~` — water, and movement.
 *
 * One period of a sine, `w` wide and `amp` tall, centred on `y`. Sampled at 24
 * points: at 12 the crest visibly flattens at the sizes this is drawn, and at 48
 * nothing changes.
 */
export function wave(ctx, x, y, w, amp, color, weight = RULE.thin) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const px = x + w * t;
    const py = y + Math.sin(t * Math.PI * 2) * amp;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Something arrived: one expanding ring, fading as it goes.
 *
 * `phase` is 0..1 and owns BOTH the radius and the alpha — a ripple that grows
 * without fading reads as a target, not as an event. The caller drives the
 * phase, so this is a drawing and never an animation: nothing here holds time.
 *
 * @param {number} r  the radius at phase 1. The ring starts at a quarter of it.
 */
export function ripple(ctx, x, y, r, phase, color, weight = RULE.thin) {
  const t = Math.max(0, Math.min(1, phase));
  const radius = r * (0.25 + t * 0.75);
  const alpha = (1 - t) ** 1.5;
  if (alpha <= 0.002) return;
  ctx.save();
  ctx.strokeStyle = withAlpha(color, alpha);
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * This is an AREA: a field of small dots over a rectangle.
 *
 * ── the grid is offset row by row, and it has to be ────────────────────────
 * A square grid of dots at low density reads as a grid — the eye finds the
 * columns immediately and the fill stops being a texture and becomes a pattern.
 * Offsetting alternate rows by half a step is the cheapest fix and is what a
 * real halftone screen does for the same reason.
 *
 * `density` is 0..1 and moves the DOT SIZE, not the spacing. Moving the spacing
 * would change the texture's scale as it fades, which reads as the area moving
 * toward the viewer.
 *
 * @param {{x:number,y:number,w:number,h:number}} rect
 */
export function halftone(ctx, rect, density, color, step = 6) {
  const d = Math.max(0, Math.min(1, density));
  const r = step * 0.28 * d;
  if (r <= 0.05) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.fillStyle = color;
  let row = 0;
  for (let py = rect.y; py <= rect.y + rect.h + step; py += step, row++) {
    const offset = row % 2 ? step / 2 : 0;
    for (let px = rect.x + offset; px <= rect.x + rect.w + step; px += step) {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Two things are separate.
 *
 * ── the half-pixel is the whole function ───────────────────────────────────
 * A 1px line drawn on an integer coordinate straddles two device rows and comes
 * out as two half-covered greys, which at `RULE.hair` is the difference between
 * a line and a smudge. Snapping to the half-pixel is only correct when the line
 * is axis-aligned, so the snap is applied per axis and only where the two ends
 * agree — a diagonal is left exactly where the caller put it.
 */
export function hairline(ctx, x1, y1, x2, y2, color, weight = RULE.hair) {
  const snap = (v) => Math.round(v) + 0.5;
  const horizontal = Math.abs(y1 - y2) < 0.01;
  const vertical = Math.abs(x1 - x2) < 0.01;
  const ax = vertical ? snap(x1) : x1;
  const bx = vertical ? snap(x2) : x2;
  const ay = horizontal ? snap(y1) : y1;
  const by = horizontal ? snap(y2) : y2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
}

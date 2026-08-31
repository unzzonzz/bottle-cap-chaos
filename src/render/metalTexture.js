import { makeCanvasTexture } from '../core/textures.js';
import { PALETTE } from '../core/palette.js';

/**
 * Brushed aluminium, drawn — including the highlight, which is the whole point.
 *
 * ── the gloss is BAKED, and it has to be ────────────────────────────────────
 * "재질은 금속/알루미늄 계열 광택. 하이라이트는 텍스처에 구워라. 실시간 스페큘러
 * 쓰지 마라." That is not a stylistic preference here, it is the only thing that
 * works. `RetroMaterial`'s specular is real and view-dependent but computed PER
 * VERTEX and interpolated across the triangle, with a deliberately tight
 * exponent — so on a ground plane the lobe falls between vertices and comes out
 * as a blotchy wash sliding over the table rather than as a streak. Turning it
 * up makes the blotches brighter, not sharper. So the surface is left near-matte
 * (`gloss` 0.06, the same near-zero the turf and the board use) and every bit of
 * the metal's look is in these texels.
 *
 * ── the banding is PERIODIC because it has to tile ──────────────────────────
 * A rolled aluminium sheet under a strip light has broad bright and dark bands
 * running along the direction it was rolled. Painting one band across the middle
 * of the tile would put a band across the middle of every repeat, which reads as
 * corrugation rather than as sheen. So the band is one full cosine period across
 * the tile: it wraps into itself at the seam by construction, and with the tile
 * sized as below there is roughly one bright band and one dark band across the
 * table's width, which is what a sheet that size actually looks like.
 *
 * The band varies with U (the table's WIDTH) and the grain runs along V (its
 * LENGTH), so the scratches point the way the cap travels. That gives the throw
 * something to move against, which matters more here than on the other two
 * surfaces: a curling slide is the slowest-looking thing in the game and speed is
 * the entire thing the player is judging.
 *
 * ── low contrast, and that is load-bearing ──────────────────────────────────
 * The chain quantises to five bits a channel — 32 levels, about 8 of 255 per
 * step. Two tones closer than that collapse into one and the grain vanishes;
 * bands taken near white land on the same clipped value as the target line
 * painted over them and the line stops reading. So the whole palette sits in the
 * middle greys, two to four quantiser steps apart, well inside both endpoints.
 */

/**
 * World units (cm) covered by one repeat. This number is a MEASUREMENT.
 *
 * There are no mipmaps in this pipeline, so a texture minified past one texel
 * per screen pixel does not soften — it picks one texel out of however many fell
 * inside that pixel, and which one it picks changes as the camera moves by a
 * fraction of a pixel. That crawls, and a table-sized field of it swims under
 * any camera movement at all.
 *
 * Measured on the running game rather than extrapolated from the lane's: at the
 * default table, framed whole at minimum zoom on the 640x480 target, the ground
 * runs 4.95 target pixels per world unit. A 128-texel tile therefore wants to
 * span 128/4.95 ≈ 26 units.
 *
 * The first version of this was 18, reasoned across from the old lane's 38 by
 * the ratio of the two bounding circles, and it was wrong by a third — one texel
 * came out at half a target pixel, so the grain was being minified 2:1 and
 * crawled exactly as the note above says it would. It looked like corduroy. The
 * lesson is the one `pitchTexture` already records about reusing the board's
 * number: this constant has to be measured against the framing it will actually
 * be seen at.
 *
 * Re-measure if the table's default proportions or the render resolution move a
 * long way. It is load-bearing twice over: it sets the UV divisor AND the
 * geometry's subdivision count.
 */
export const METAL_TILE = 26;

/**
 * Bright, faintly warm grey. Everything else is either side of it.
 *
 * It was a mid grey chosen to sit "a shade up from the turf and the mat", both
 * of which were dark. They are honey wood and summer turf now and the metal has
 * come up with them — a cap skirt that stayed at the old value would read as a
 * dirty smear on a sunlit board.
 */
const BASE = PALETTE.metal.base;
/** The bright half of the roll band. */
const BAND_HI = PALETTE.metal.bandHi;
/** And the dark half. */
const BAND_LO = PALETTE.metal.bandLo;
/**
 * Brush scratches. Two tones, so the grain has a lit side and a shaded one — and
 * both only about two quantiser steps off the base.
 *
 * They were four steps off and much longer, and the result was the surface
 * reading as corrugation rather than as metal: the grain is meant to be the
 * thing you notice a cap moving ACROSS, not the thing you notice.
 */
const GRAIN_HI = PALETTE.metal.grainHi;
const GRAIN_LO = PALETTE.metal.grainLo;

const SIZE = 512;

export function makeMetalTexture() {
  return makeCanvasTexture(SIZE, drawMetal);
}

function drawMetal(ctx, size) {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, size, size);

  /**
   * The roll band: one full period across the tile, in flat steps.
   *
   * Quantised to columns two texels wide rather than drawn as a smooth gradient,
   * for the same reason every other feature in this pipeline is at least two
   * texels: a per-texel ramp has energy at exactly the frequency the sampler
   * cannot represent, and a smooth gradient would be flattened into arbitrary
   * bands by the five-bit quantiser anyway — bands chosen by rounding rather
   * than by anybody. Choosing them here means they land where they are meant to.
   */
  const steps = 8;
  const step = size / steps;
  for (let i = 0; i < steps; i++) {
    // cos over one full period: bright at the tile's edges, dark in the middle,
    // so the seam has the same value on both sides of it.
    const k = Math.cos((i / steps) * Math.PI * 2);
    ctx.fillStyle = mix(BASE, k > 0 ? BAND_HI : BAND_LO, Math.abs(k));
    ctx.fillRect(Math.round(i * step), 0, Math.ceil(step), size);
  }

  /**
   * The brush grain: short thin streaks down the tile, so they run along the
   * table's length and give a sliding cap something to cross.
   *
   * Two texels wide — the floor every feature in this pipeline has, because a
   * one-texel feature has energy at exactly the frequency the sampler cannot
   * represent and sparkles in place even at a clean 1:1 — and 5 to 16 long,
   * which at the tile above is between one and three target pixels wide and
   * under a cap's diameter tall. Long streaks were the corduroy; the grain has
   * to be finer than the object sliding over it or it becomes the subject.
   *
   * They wrap in Y by being drawn twice when they run off the bottom, because a
   * streak clipped at the seam is a streak that stops halfway down the table for
   * no reason anybody can see.
   */
  for (let i = 0; i < 320; i++) {
    const h = hash2(i, 0x3d);
    const x = h % size;
    const y = Math.floor(h / size) % size;
    const len = 5 + ((h >>> 7) % 12);
    ctx.fillStyle = (h >>> 3) & 1 ? GRAIN_HI : GRAIN_LO;
    ctx.fillRect(x, y, 2, len);
    if (y + len > size) ctx.fillRect(x, y - size, 2, len);
  }
}

/** Blend two `#rrggbb` strings. Canvas has no colour arithmetic of its own. */
function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const out = [16, 8, 0].map((sh) => {
    const va = (pa >> sh) & 0xff;
    const vb = (pb >> sh) & 0xff;
    return Math.round(va + (vb - va) * k);
  });
  return `rgb(${out[0]},${out[1]},${out[2]})`;
}

/**
 * Deterministic 32-bit integer hash. Same table every run — see `boardTexture`
 * for why that matters: nothing here touches the simulation, but a surface that
 * differs on every reload makes two screenshots impossible to compare, and
 * comparing screenshots is how this is judged.
 *
 * Duplicated rather than imported, as the other three texture files duplicate
 * it, and given its own salt above so its scatter does not correlate with
 * theirs.
 */
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ b, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

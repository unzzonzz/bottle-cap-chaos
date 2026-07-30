import { makeCanvasTexture } from '../core/textures.js';

/**
 * Pebbled ice, drawn rather than loaded — the same argument the turf and the
 * board's weave make.
 *
 * A flat pale sheet under per-vertex Gouraud has no shading variation anywhere
 * on it, so a cap sliding down it has nothing to slide across: no texture flow,
 * no scale reference, nothing for the eye to measure speed against. That matters
 * more here than on either of the other two surfaces, because a curling throw is
 * the slowest-looking thing in the game — it covers seventy units over a second
 * and a half with almost no rotation — and speed is the entire thing the player
 * is judging.
 *
 * ── it is PEBBLE, not noise ──────────────────────────────────────────────────
 * Real curling ice is sprayed with droplets that freeze into a fine bumpy layer,
 * which is what a stone actually rides on. Drawing that literally is also the
 * right answer for this pipeline: round, isolated, two-to-three texel specks are
 * the largest feature that reads as texture rather than as pattern, and unlike
 * the turf's tufts they have no direction — so nothing about the surface says
 * which way is down the lane, which the painted lines are there to say.
 *
 * ── low contrast, and that is load-bearing ───────────────────────────────────
 * The chain quantises to five bits a channel and the lines drawn on top of this
 * are near-white. A pebble layer with real contrast would come out of the
 * quantiser as a field of hard flecks the same value as the markings, and the
 * house rings — the thing the whole mode is aimed at — would be competing with
 * the surface they are painted on.
 */

/**
 * World units (cm) covered by one repeat. This number is a MEASUREMENT.
 *
 * There are no mipmaps in this pipeline, so a texture minified past one texel
 * per screen pixel does not soften — it picks one texel out of however many fell
 * inside that pixel, and which one it picks changes as the camera moves by a
 * fraction of a pixel. That crawls, and a lane-sized field of it swims under any
 * camera movement at all.
 *
 * So the tile is sized so the widest view lands near 1:1. Measured on the
 * 640x480 target with the default lane framed by its bounding circle, the ground
 * runs about 3.4 target pixels per world unit; a 128-texel tile therefore wants
 * to span about 128/3.4 ≈ 38 units.
 *
 * It is close to the turf's 36 and that is not a coincidence — both are ground
 * planes framed whole in the same frame. Changing the lane's length or the
 * render resolution a long way from the defaults is what would make this need
 * re-measuring.
 */
export const ICE_TILE = 38;

const BASE = '#b9c6d0';
const PEBBLE_HI = '#ccd8e0';
const PEBBLE_LO = '#a9b7c3';
/** Long, faint scars from the sweep. Barely there; they only break the field. */
const SCRATCH = '#c2ced7';

export function makeIceTexture() {
  return makeCanvasTexture(128, drawIce);
}

function drawIce(ctx, size) {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, size, size);

  // Scratches first, so the pebble sits on top of them the way it does on real
  // ice. Two texels tall for the reason `pitchTexture` gives about its tufts: a
  // one-texel feature has energy at exactly the frequency the sampler cannot
  // represent and sparkles in place even at a clean 1:1.
  for (let i = 0; i < 14; i++) {
    const h = hash2(i, 61);
    ctx.fillStyle = SCRATCH;
    ctx.fillRect(h % size, Math.floor(h / size) % size, 10 + ((h >>> 7) % 22), 2);
  }

  // The pebble. Two texels square, in two tones, at scattered positions — a
  // droplet catches the light on one side and shades on the other, and two flat
  // values is how that reads once the quantiser has been at it.
  for (let i = 0; i < 260; i++) {
    const h = hash2(i, 17);
    const x = h % size;
    const y = Math.floor(h / size) % size;
    ctx.fillStyle = (h >>> 3) & 1 ? PEBBLE_HI : PEBBLE_LO;
    ctx.fillRect(x, y, 2, 2);
  }
}

/** Deterministic 32-bit integer hash. Same lane every run — see boardTexture. */
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ b, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

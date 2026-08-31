import { makeCanvasTexture } from '../core/textures.js';
import { PALETTE } from '../core/palette.js';

/**
 * Turf, drawn rather than loaded — the same argument the board's weave makes.
 *
 * A flat green field under per-vertex Gouraud has no shading variation anywhere
 * on it, so a ball crossing it has nothing to cross: no texture flow, no scale
 * reference, nothing for the eye to measure speed against. On a pitch two and a
 * half times the width of the knockout board that matters more, not less,
 * because a ball travelling the same speed covers a smaller fraction of what is
 * on screen and looks slower for it.
 *
 * ── the grain is here, the stripes are not ───────────────────────────────────
 * Mown stripes belong to the PITCH, not to the texture: they are a fixed number
 * of bands across a fixed length, so baking them into a tile that repeats every
 * ten units would put a seam wherever the tile edge fell and change the band
 * count whenever the pitch was resized. `PitchView` cuts the surface into bands
 * of geometry and gives alternate ones a slightly different tint, which is the
 * same trick a groundsman uses and survives any pitch length.
 *
 * So this texture is only the grain: fine, near-monochrome, and low contrast on
 * purpose. It has to read as grass under a 5-bit quantiser without competing
 * with the white lines drawn on top of it, which are the things the player is
 * actually reading the pitch by.
 */

/**
 * World units (cm) covered by one repeat. This number is a MEASUREMENT.
 *
 * There are no mipmaps in this pipeline, so a texture minified past one texel
 * per screen pixel does not soften — it picks one texel out of however many fell
 * inside that pixel, and which one it picks changes as the camera moves by a
 * fraction of a pixel. That is not a static artefact, it crawls, and a
 * ground-plane-sized field of it swims under any camera movement at all.
 *
 * So the tile is sized so that the widest view lands at about 1:1. Measured on
 * the 640x480 target with the pitch standing up and framed by its bounding
 * circle, the ground runs about 3.0 screen pixels per world unit; a 128-texel
 * tile therefore wants to span about 128/3.0 ≈ 36 units.
 *
 * It was 12, carried over from the board — which is a third of the size, seen
 * from a third of the distance, and worked out at 1.07 texels per pixel. On the
 * pitch the same number came to 2.9 and the whole field shimmered. Changing the
 * pitch's size or the render resolution a long way from the defaults is the
 * thing that would make this need re-measuring.
 */
export const TURF_TILE = 36;

const BASE = PALETTE.pitch.grassA;
const BLADE_A = PALETTE.pitch.grassB;
const BLADE_B = PALETTE.pitch.grassC;
const DRY = PALETTE.pitch.grassDry;

export function makeTurfTexture() {
  return makeCanvasTexture(128, drawTurf);
}

function drawTurf(ctx, size) {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, size, size);

  // Tufts, two texels wide, at scattered positions. Taller than they are wide,
  // because that asymmetry is most of what separates grass from noise.
  //
  // The width is the point and it used to be one texel. A one-texel feature has
  // energy at exactly the frequency the sampler cannot represent, so even at a
  // clean 1:1 it sparkles the moment anything moves — the tile size stops the
  // texture being minified, and this stops what is left of it from twinkling in
  // place. Fewer of them too: at two texels each, 900 covered most of the tile
  // and the tones averaged out into a flat wash.
  for (let i = 0; i < 320; i++) {
    const h = hash2(i, 11);
    const x = h % size;
    const y = Math.floor(h / size) % size;
    const len = 3 + ((h >>> 9) % 3);
    ctx.fillStyle = (h >>> 3) & 1 ? BLADE_A : BLADE_B;
    ctx.fillRect(x, y, 2, len);
  }

  // A handful of drier patches, to break up the regularity at a scale the eye
  // picks up before it picks up individual tufts.
  for (let i = 0; i < 40; i++) {
    const h = hash2(i, 29);
    ctx.fillStyle = DRY;
    ctx.fillRect(h % size, Math.floor(h / size) % size, 4 + ((h >>> 7) % 4), 3);
  }
}

/** Deterministic 32-bit integer hash. Same pitch every run — see boardTexture. */
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ b, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

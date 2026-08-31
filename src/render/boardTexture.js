import { makeCanvasTexture } from '../core/textures.js';
import { PALETTE } from '../core/palette.js';

/**
 * The playing surface: a woven mat, drawn rather than loaded.
 *
 * The board was two triangles of flat colour, which under per-vertex Gouraud
 * means four lit vertices and therefore no shading variation anywhere on it at
 * all. A cap sliding across it had nothing to slide across — no texture flow, no
 * scale reference, nothing for the eye to measure speed against. That is not a
 * small thing when the entire question this phase is asking is "does the
 * movement feel right".
 *
 * ── the tile size is a resolution decision ───────────────────────────────────
 * There are no mipmaps anywhere in this pipeline, on purpose, so a texture
 * minified past about 1 texel per pixel does not soften — it aliases, and a
 * board-sized field of aliasing crawls every time the camera so much as
 * breathes. At the default 640x480 the board covers roughly 430 pixels across
 * its 36 units, so about 12 pixels per unit; a 128-texel tile therefore wants to
 * span around 10 units to land near 1:1. Hence BOARD_TILE. Change the render
 * resolution a long way from the default and this is the first thing that will
 * start to shimmer.
 */

/** World units (cm) covered by one repeat of the texture. See the note above. */
export const BOARD_TILE = 10;

// Honey wood, not the near-black cloth this was. The weave the drawing code
// below lays down still reads — as a woven mat in warm tones rather than as a
// dark one — and it is PHASE 4 that replaces the weave itself with grain.
const BASE = PALETTE.board.wood;
const WARP = PALETTE.board.grainHi;
const WEFT = PALETTE.board.grainLo;
const FLECK = PALETTE.board.fleck;

export function makeBoardTexture() {
  return makeCanvasTexture(128, drawBoard);
}

function drawBoard(ctx, size) {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, size, size);

  // A plain over-under weave. Three-texel threads, because at this tile size
  // that is a little under 2 mm of real mat — coarse enough to survive the
  // 5-bit quantiser, fine enough not to read as a checkerboard.
  //
  // The alternation is the entire point and is not decoration. Drawing the warp
  // as continuous full-height bars and the weft as continuous full-width ones —
  // which is the obvious way and was the first way — gives every warp thread an
  // unbroken run down the whole tile, and an unbroken vertical line repeated
  // every few pixels across a dark surface does not read as cloth. It reads as
  // scanlines, which on a CRT-styled renderer is the one artifact that must not
  // appear by accident. Interrupting each thread where it passes under the other
  // breaks those runs into dashes and the surface becomes fabric.
  const thread = 3;
  const pitch = thread * 2;
  const n = Math.ceil(size / pitch);

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = i * pitch;
      const y = j * pitch;
      // Over one, under one: at each crossing the thread on top is whichever the
      // parity says, so neither direction ever runs straight for long.
      const warpOnTop = (i + j) % 2 === 0;
      ctx.fillStyle = warpOnTop ? WARP : WEFT;
      ctx.fillRect(x, y, thread, pitch);
      ctx.fillStyle = warpOnTop ? WEFT : WARP;
      ctx.fillRect(x, y, pitch, thread);
      // Re-lay the top thread's own crossing square so it sits over the other.
      ctx.fillStyle = warpOnTop ? WARP : WEFT;
      ctx.fillRect(x, y, thread, thread);
    }
  }

  // Flecks, from a hash rather than Math.random. Nothing here touches the
  // simulation, but a texture that comes out different on every reload makes
  // two screenshots of the same board impossible to compare, and comparing
  // screenshots is most of how this phase gets judged.
  ctx.fillStyle = FLECK;
  for (let i = 0; i < 220; i++) {
    const h = hash2(i, 7);
    const x = Math.floor(h % size);
    const y = Math.floor((h / size) % size);
    ctx.fillRect(x, y, 1, 1);
  }
}

/** Deterministic 32-bit integer hash. Same board every run. */
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ b, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

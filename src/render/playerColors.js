import { PALETTE } from '../core/palette.js';

/**
 * Which colour each player is. One fact, one file, no dependencies.
 *
 * ── it was in `ArenaView`, and that was a circular import ───────────────────
 * `ArenaView` imports `PitchView`, and `PitchView` imported `PLAYER_COLORS` back
 * out of `ArenaView` to paint the goals. That cycle happens to resolve — the
 * constant is hoisted and evaluated before either class is constructed — but it
 * resolves by luck rather than by design, and the next thing either file needs
 * from the other at module scope would break it.
 *
 * The second reason is the one that forced the move: the opponent-select screen
 * shows the two players' caps in their own colours, and it lives in `menu/`.
 * Importing `ArenaView` for two hex strings would drag the board texture, the
 * football pitch, the curling table and the ball geometry onto a page that draws
 * a bottle.
 *
 * Re-exported from `ArenaView` so nothing that already imports it from there has
 * to change, and so there is still only one place the values are written down.
 *
 * ── the values live in the palette now ─────────────────────────────────────
 * They were written down here, with a note explaining that a mid red and a mid
 * blue were chosen because both survive the 5-bit-per-channel quantiser as
 * distinct hues and both hold up against the near-black HUD plates. Neither
 * reason exists any more — there is no quantiser and the plates are white — so
 * the pair was re-chosen against honey wood, summer turf and a white plate, and
 * it now lives in `core/palette.js` with the rest of the scheme. See the note on
 * `PALETTE.player` for why the two differ in lightness and not only in hue.
 *
 * This file stays because the import graph reason for it stays: `ArenaView`
 * re-exports it, and the opponent-select screen needs two colours without
 * dragging the board texture, the football pitch and the curling table onto a
 * page that draws a bottle.
 */
export const PLAYER_COLORS = PALETTE.player;

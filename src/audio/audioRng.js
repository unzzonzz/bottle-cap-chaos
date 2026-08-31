import { Rng } from '../physics/rng.js';

/**
 * The audio layer's randomness, and the reason it is a file of its own.
 *
 * ── it must not be the game's stream ────────────────────────────────────────
 * `nextSeed()` in `physics/rng.js` is a single global counter, and its two
 * legitimate consumers are the shot seed (`AimInput.begin`) and the card seed
 * (`Match.playCard`). Every call advances it. So one call from here — to jitter
 * a pitch, say — shifts every subsequent shot and every subsequent card draw,
 * and "a run started from the same reset button plays out the same sequence"
 * quietly stops being true.
 *
 * The failure would also be INVISIBLE to the project's own instrument. The
 * replay check re-fires the seed stored on `lastTurn.shot`, so a replayed turn
 * still agrees with itself; only a whole run compared against another whole run
 * would show it, and nothing does that automatically. A guarantee that cannot
 * be checked has to be protected structurally instead, which is what this file
 * is.
 *
 * ── and it must not be `Math.random()` either ───────────────────────────────
 * Same reasoning one step further out. `physics/rng.js` states the ban as a
 * project-wide rule rather than a rule about the shot path, and a module that
 * reaches for `Math.random` is one refactor away from being imported somewhere
 * that matters. A named private stream costs one line and cannot drift.
 *
 * The `Rng` CLASS is imported, not the counter — it is a pure factory over
 * `mulberry32` and touches no shared state.
 *
 * ── a fixed seed, deliberately ─────────────────────────────────────────────
 * Seeded from a constant rather than from the clock, so two runs of the same
 * match produce the same pitch jitter. That is worth having while tuning: a
 * collision that sounded wrong can be listened to again. Nothing about the game
 * depends on it, because nothing about the game can see it.
 */

/** Not derived from anything. Any 32-bit constant would do. */
const AUDIO_SEED = 0x0a0d10be;

const rng = new Rng(AUDIO_SEED);

/** [0, 1) */
export function audioFloat() {
  return rng.float();
}

/** [-1, 1) */
export function audioSigned() {
  return rng.signed();
}

/**
 * A multiplier around 1, `spread` wide either side.
 *
 * The one shape every caller actually wants: `jitter(0.05)` is ±5%, which is
 * what "같은 소리가 반복되지 않게 피치를 미세하게 랜덤 변조" asks for.
 */
export function jitter(spread) {
  if (!(spread > 0)) return 1;
  return 1 + rng.signed() * spread;
}

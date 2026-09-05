/**
 * The one scale every pitched event in this game lands on.
 *
 * ── the problem is repetition, not tuning ───────────────────────────────────
 * `cap_cap` is the most-heard sound in the project by an order of magnitude —
 * a single flick can fire eight of them inside 150 ms, and a match fires
 * hundreds. Wandering its pitch on a CONTINUOUS random multiplier (which is
 * what `audioRng.jitter` alone does) means no two hits agree about anything:
 * eight collisions in a chain arrive as eight unrelated frequencies, the ear
 * gets no interval it can name, and the result reads as a smear rather than as
 * eight events. It is also tiring in the specific way that mistuned repetition
 * is tiring.
 *
 * Quantising the same wander to a scale costs nothing and fixes both. Two hits
 * are now an INTERVAL, a chain is a phrase, and the pitch still moves.
 *
 * ── why the major pentatonic, specifically ──────────────────────────────────
 * Semitones 0, 2, 4, 7, 9. It contains no semitone and no tritone, so ANY two
 * of its degrees played in ANY order are consonant — which is the whole
 * requirement, because nothing chooses the order here. A collision chain is
 * decided by physics, a card is played when the player plays it, and no part of
 * this system can look ahead. A scale that can produce a wrong pair would
 * eventually produce one, on somebody's best shot.
 *
 * It is also the reason the degree may be assigned from ORDER rather than from
 * strength (see `ContactAudio._chain`): every walk up it sounds deliberate.
 *
 * ── this file has no randomness of its own, on purpose ──────────────────────
 * `scaleRate` is a pure function of an integer. Whoever picks the degree owns
 * the choice, and when that choice is random it must come from `audioRng` —
 * never `Math.random`, never `nextSeed()`. See the header of `audioRng.js` for
 * why the audio layer keeps its own stream.
 */

/** Semitone offsets of the major pentatonic. Five to the octave. */
export const PENTATONIC = [0, 2, 4, 7, 9];

/** Twelfth root of two. */
const SEMITONE = Math.pow(2, 1 / 12);

/**
 * One rung of the scale, as a frequency multiplier.
 *
 * Degree 0 is the root and returns exactly 1 — so a sound that is given no
 * degree, or given zero, plays at precisely the frequency its definition
 * writes. Past 4 the octave rises; negatives run down, which is what `%` is
 * being corrected for below.
 *
 * @param {number} degree  rungs above the root. May be negative.
 * @returns {number} multiply a frequency by this.
 */
export function scaleRate(degree) {
  const d = Math.round(degree || 0);
  const octave = Math.floor(d / PENTATONIC.length);
  const step = PENTATONIC[((d % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length];
  return Math.pow(SEMITONE, step + octave * 12);
}

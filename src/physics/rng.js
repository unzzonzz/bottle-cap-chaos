/**
 * Seeded randomness and state hashing.
 *
 * `Math.random()` is banned everywhere downstream of the physics world. Not as a
 * style rule — the whole phase rests on "same seed, same input, same result",
 * and one unseeded call anywhere in the shot path silently destroys that while
 * still looking correct on any single playthrough.
 *
 * mulberry32 is used rather than anything fancier because it is built entirely
 * from `Math.imul` and 32-bit shifts. Those are exact integer operations in
 * every JS engine, so the sequence is identical on every machine — which a
 * float-based generator would not guarantee.
 */

/** @param {number} seed  any 32-bit value */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A generator plus the seed it came from, so a shot can carry the seed it used
 * and be replayed byte for byte later.
 */
export class Rng {
  constructor(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
  }

  /** [0, 1) */
  float() {
    return this._next();
  }

  /** [-1, 1) */
  signed() {
    return this._next() * 2 - 1;
  }

  reset() {
    this._next = mulberry32(this.seed);
  }
}

/**
 * A fresh seed for a shot, a card, or an orb the player did not pin.
 *
 * Derived from a counter rather than from `Math.random()` or the clock: given
 * the same starting value it plays out the same sequence of "random" shots,
 * which is what makes a whole MATCH reproducible and not just one turn.
 *
 * ── the starting value is the whole question, and it used to be a constant ───
 * This counter was initialised to a literal, which made the sequence a property
 * of the SOURCE FILE rather than of a match. Every page load rewound it to the
 * same number, and entering a match from the menu is a document navigation —
 * so the first match of every session drew the identical orb, on the identical
 * turn, at the identical spot, forever. Reported exactly that way.
 *
 * The counter is not the bug and is not being replaced; `seedRun` is what was
 * missing. Determinism was never supposed to mean "one match" — it means the
 * same seed replays, and until there was a way to START from a different seed
 * there was only ever one seed.
 */
let seedCounter = 0x9e3779b9;
export function nextSeed() {
  seedCounter = (Math.imul(seedCounter, 1664525) + 1013904223) >>> 0;
  return seedCounter;
}

/**
 * The counter's current value, without advancing it.
 *
 * Read-only, and it exists for the input log rather than for the game: a
 * recorded match is replayed by restoring this before each event, which is the
 * only way a log survives the one thing an event list cannot describe — a draw
 * that happened and produced no event. `AimInput` takes its seed when the drag
 * STARTS, so a press that is dragged back inside the deadzone and released
 * advances the counter and fires nothing. Replaying such a log from the event
 * list alone would run every later card off a counter one step behind the one
 * that recorded it, and the divergence would be reported as a physics failure.
 *
 * Nothing in the simulation calls this. See `replay/InputLog.js`.
 */
export function peekSeed() {
  return seedCounter >>> 0;
}

/**
 * Point the counter at a new starting value. One call, at the top of a match.
 *
 * Everything a match draws — shot seeds, card seeds, and through them every orb
 * spawn and every card drawn from one — descends from here, so this single
 * number reproduces the whole match. That is what makes the seed worth showing
 * to a player and worth accepting from a URL.
 *
 * @param {number} seed  any 32-bit value
 */
export function seedRun(seed) {
  seedCounter = seed >>> 0;
}

/**
 * An unpredictable 32-bit seed, for a match nobody pinned.
 *
 * ── the one sanctioned entropy call in the project, and why it is not a hole ──
 * The rule this file opens with — no `Math.random()` downstream of the physics
 * world — is about the SIMULATION: an unseeded call inside the shot path makes a
 * turn unreproducible while still looking correct. This is not in that path and
 * cannot be. It runs once, before a match exists, to CHOOSE the seed; from the
 * first step onward every number still comes out of `nextSeed`, and the match
 * still replays byte for byte from the value this returned.
 *
 * The distinction is worth stating precisely, because "we banned randomness"
 * read too literally is what left the game with one match in it: the ban is on
 * randomness the replay cannot see. A seed the replay is HANDED is the opposite.
 *
 * `crypto` where it exists, the clock mixed with a counter where it does not —
 * two page loads in the same millisecond must not collide, which the clock alone
 * would allow.
 */
let fallbackEntropy = 0;
export function freshSeed() {
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const out = new Uint32Array(1);
    c.getRandomValues(out);
    return out[0] >>> 0;
  }
  fallbackEntropy = (fallbackEntropy + 1) >>> 0;
  return (Math.imul(Date.now() >>> 0, 2654435761) ^ Math.imul(fallbackEntropy, 40503)) >>> 0;
}

/** FNV-1a over raw bytes. */
export function fnv1a(bytes, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Hash a run of numbers as float32.
 *
 * Rapier's numbers are f32 that JS has widened to f64, so writing them back into
 * a Float32Array is lossless — and it means the hash compares the bits the
 * engine actually holds rather than a decimal rendering of them.
 */
export function hashFloats(values) {
  const f = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) f[i] = values[i];
  return fnv1a(new Uint8Array(f.buffer)).toString(16).padStart(8, '0');
}

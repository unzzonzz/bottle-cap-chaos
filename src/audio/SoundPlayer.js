/**
 * What a sound source IS, as far as the game is concerned.
 *
 * ── the seam a sample bank would arrive through ─────────────────────────────
 * The brief asks for the playback interface to be abstracted so procedural
 * generation is one implementation of it rather than the only thing there is.
 * This is that interface, and `Synth` is the implementation that exists.
 *
 * The split is drawn where it has to be drawn: a player is handed a sound
 * DEFINITION and a set of per-trigger modifiers, and hands back a handle. It is
 * not handed an oscillator type or a filter frequency, because a sample bank
 * would have no use for either — it would key off the definition's `id` and
 * read `gain`, `rate` and the envelope tail to decide how loud, how fast and
 * how long. Everything a synth needs beyond that lives INSIDE the definition,
 * where an implementation that does not care can ignore it wholesale.
 *
 * ── the handle, and why every player must return one ────────────────────────
 * Loops are the reason. A one-shot could be fire-and-forget, but the sliding
 * cap, the bow being drawn, the bottle being shaken and the stun hum are all
 * continuous sounds whose level and pitch are written every render frame — so
 * the caller needs something to write to, and `VoicePool` needs something to
 * count and something to steal.
 *
 * `MockPlayer` is here for the same reason `MemoryMarks` is in `MarkStorage`:
 * it proves the seam is real, and it is what a headless run gets.
 */

/**
 * @typedef {object} PlayOptions
 * @property {number} [gain]      linear, multiplied into the definition's own
 * @property {number} [rate]      playback-rate / pitch multiplier
 * @property {number} [intensity] 0..1 physical strength, before the definition's
 *                                own velocity mapping is applied
 * @property {boolean} [loop]     hold at sustain until `stop` rather than decay
 */

/**
 * A sound that has been started.
 *
 * `set` is a no-op on a one-shot in every implementation — a caller that holds
 * a handle and writes to it should not have to know which kind it got.
 */
export class Voice {
  /** Seconds on the audio clock at which this voice is finished. */
  get endsAt() {
    return 0;
  }

  get playing() {
    return false;
  }

  /** @param {{gain?: number, rate?: number}} _v */
  set(_v) {}

  /** @param {number} [_fade] seconds to ramp out over */
  stop(_fade) {}
}

/**
 * The contract. Subclass it, or hand in anything with these methods.
 *
 * Deliberately synchronous, like `MarkStorage`: a synth has nothing to wait
 * for, and a sample bank that did would resolve its loading once at startup
 * rather than per trigger.
 */
export class SoundPlayer {
  /** Whether the audio device is up. Nothing plays before it is. */
  get ready() {
    return false;
  }

  /**
   * @param {object} _def   a sound definition from `soundBank`
   * @param {PlayOptions} [_opts]
   * @returns {Voice|null} null when the device is not up or the graph refused
   */
  play(_def, _opts) {
    return null;
  }

  /** Seconds on whatever clock `Voice.endsAt` is quoted against. */
  get now() {
    return 0;
  }
}

/** Counts calls and produces no sound. For a headless run and for tests. */
export class MockPlayer extends SoundPlayer {
  constructor() {
    super();
    this.calls = [];
    this._t = 0;
  }

  get ready() {
    return true;
  }

  get now() {
    return this._t;
  }

  play(def, opts = {}) {
    this.calls.push({ id: def?.id, opts });
    const t = this._t;
    return new (class extends Voice {
      get endsAt() {
        return t;
      }
      get playing() {
        return false;
      }
    })();
  }
}

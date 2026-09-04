import { peekSeed } from '../physics/rng.js';

/**
 * A match, written down as the inputs that produced it.
 *
 * ── why this is the FIRST thing built, before any networking ────────────────
 * Lockstep multiplayer is a bet: that both machines, handed the same seed and
 * the same inputs, walk the same path through the same simulation. Nothing about
 * that bet is obvious — it is a claim about floating point, about WASM, and
 * about every line of JS between the input and the solver. This file is how the
 * claim gets tested before anything is built on top of it.
 *
 * So the format here is not a debug convenience that happens to resemble the
 * wire format. It IS the wire format, minus the transport: an event in this log
 * is exactly what a client will send when a player shoots, in the same fields
 * and the same order. A recorded match and a received match are the same stream,
 * which means the replay harness tests the real thing rather than a model of it.
 *
 * ── what is in an event, and what is deliberately not ───────────────────────
 * No positions. No velocities. No hashes of anything the physics owns. Sending
 * or storing simulation STATE is the failure mode this whole design exists to
 * avoid: two machines that exchange state stay in agreement by overwriting each
 * other, which hides divergence rather than detecting it. Inputs only, and then
 * the hashes are compared to find out whether it worked.
 *
 * ── the RNG counter, which is the part that is easy to get wrong ────────────
 * Each event carries the global seed counter as it stood immediately before the
 * event was applied. That looks redundant — replaying the same events from the
 * same match seed should advance the counter identically — and it is not, for
 * one reason: `AimInput` draws a shot's seed when the drag STARTS, not when it
 * fires. A press that is dragged back inside the deadzone and released has
 * advanced the counter and produced no event. Any log replayed purely from its
 * event list would then run every later CARD off a counter one step behind, and
 * the resulting mismatch would be reported as a solver bug.
 *
 * Restoring the counter before each event makes the log exact regardless of what
 * happened between events. See `peekSeed`.
 */

export const LOG_FORMAT = 'msa-inputlog';
export const LOG_VERSION = 1;

/**
 * What a player can do that the simulation sees.
 *
 * Shared with the network protocol — see `net/protocol.js`. The test for
 * belonging here is not "is it a move": it is whether the WORLD is different
 * afterwards. Camera work is not, and menu navigation ends the match rather than
 * changing it.
 *
 * `FLIP` is the one that makes that distinction worth stating. It costs no turn,
 * has no limit, and does not touch the score — by every ordinary reading it is
 * not a move at all. It turns a cap over, which changes which face is on the
 * table, which changes the friction the next shot gets. A log that left it out
 * would replay every subsequent shot on the wrong surface.
 */
export const INPUT_KIND = {
  SHOT: 'shot',
  CARD: 'card',
  /**
   * A cap turned over. See `Match.flipCap`.
   *
   * Carries nothing but the seat. Which cap is not in it: only one cap is
   * flippable at a time — the one whose turn it is — and `Match.flipCap` works
   * that out from the rules rather than being told. An index in the payload
   * would be a second opinion about whose cap it is, and the two could differ.
   */
  FLIP: 'flip',
  /**
   * Nobody moved in time, and the turn passed.
   *
   * An input that is the ABSENCE of one, which is why it is in this list rather
   * than left out of it. The turn advanced, so the next event happens against a
   * different board, and a log that skipped over it would replay every
   * subsequent shot as the wrong player. It carries no payload beyond the seat
   * it happened to — there is nothing to carry, which is the point of the rule.
   */
  SKIP: 'skip',
};

/**
 * One input, as recorded and as sent.
 *
 * @typedef {object} InputEvent
 * @property {number} seq        event ordinal, from zero, gap-free
 *
 *   An EVENT ordinal, not a turn one — it was described as a turn ordinal when
 *   every kind here ended a turn, and `FLIP` does not. A turn can now carry
 *   several events, and `seq` still counts every one of them exactly once,
 *   which is what `parse` checks and what the relay orders by.
 * @property {string} kind       an `INPUT_KIND`
 * @property {number} player     who acted
 * @property {number} rngState   `peekSeed()` immediately before applying
 * @property {number} [capIndex] SHOT: which cap
 * @property {number} [dirX]     SHOT: travel direction, normalised
 * @property {number} [dirZ]
 * @property {number} [power]    SHOT: 0..1
 * @property {number} [seed]     SHOT: the shot's own seed
 * @property {number} [impulseMul]
 * @property {number} [spreadMul]
 * @property {string} [cardId]   CARD: which card
 */

export class InputLog {
  /**
   * @param {{mode: string, seed: number, label?: string}} head
   */
  constructor({ mode, seed, label = '' }) {
    this.format = LOG_FORMAT;
    this.version = LOG_VERSION;
    this.mode = mode;
    /** The match's root seed. Everything else descends from it. */
    this.seed = seed >>> 0;
    this.label = label;
    /** @type {InputEvent[]} */
    this.events = [];
  }

  get length() {
    return this.events.length;
  }

  /**
   * Record a shot.
   *
   * The seed is taken off the shot rather than drawn here: it was fixed when the
   * drag started and the trajectory preview has already been drawn from it, so
   * drawing a second one would record a different shot from the one the player
   * watched themselves aim.
   *
   * @param {number} player
   * @param {import('../game/shot.js').Shot} shot
   */
  recordShot(player, shot) {
    this.events.push({
      seq: this.events.length,
      kind: INPUT_KIND.SHOT,
      player,
      rngState: peekSeed(),
      capIndex: shot.capIndex,
      dirX: shot.dirX,
      dirZ: shot.dirZ,
      power: shot.power,
      seed: shot.seed >>> 0,
      impulseMul: shot.impulseMul ?? 1,
      spreadMul: shot.spreadMul ?? 1,
    });
  }

  /** @param {number} player @param {string} cardId */
  recordCard(player, cardId) {
    this.events.push({
      seq: this.events.length,
      kind: INPUT_KIND.CARD,
      player,
      rngState: peekSeed(),
      cardId,
    });
  }

  /**
   * Record a cap being turned over.
   *
   * Carries `rngState` like everything else here even though a flip draws no
   * random number, and that is deliberate rather than sloppy: a replay restores
   * the counter before each event, so an event that omitted it would leave the
   * counter wherever the last one happened to end and the restore would silently
   * stop being exact. Every event carries it or the guarantee has a hole in the
   * shape of whichever kind was special.
   *
   * @param {number} player
   */
  recordFlip(player) {
    this.events.push({
      seq: this.events.length,
      kind: INPUT_KIND.FLIP,
      player,
      rngState: peekSeed(),
    });
  }

  /** @param {number} player  whose turn ran out */
  recordSkip(player) {
    this.events.push({
      seq: this.events.length,
      kind: INPUT_KIND.SKIP,
      player,
      rngState: peekSeed(),
    });
  }

  /** Rebuild the `Shot` an event describes. */
  static shotOf(ev) {
    return {
      capIndex: ev.capIndex,
      dirX: ev.dirX,
      dirZ: ev.dirZ,
      power: ev.power,
      seed: ev.seed >>> 0,
      impulseMul: ev.impulseMul ?? 1,
      spreadMul: ev.spreadMul ?? 1,
    };
  }

  toJSON() {
    return {
      format: this.format,
      version: this.version,
      mode: this.mode,
      seed: this.seed,
      label: this.label,
      events: this.events,
    };
  }

  serialize() {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  /**
   * Parse, and refuse anything that is not certainly one of these.
   *
   * Strict on purpose. A log is fed straight into the simulation, so a
   * half-recognised one produces a run that looks like a determinism failure and
   * is really a parsing failure — the single most expensive way for this to go
   * wrong, because the conclusion drawn from it would be that the physics is
   * broken.
   *
   * @param {string|object} src
   */
  /**
   * ── `LOG_VERSION` did not move when `FLIP` was added, on purpose ──────────
   * The version describes the SHAPE of the file, and adding a kind does not
   * change it: every field of every existing event means what it meant, and a
   * log recorded before flips existed replays byte for byte. What a version bump
   * would buy is a loud failure when a new log meets an old build — and the kind
   * check below already gives exactly that, naming the offending event and the
   * kind it did not recognise, which is more use than a version number would be.
   * Bumping it would instead have invalidated every determinism fixture on disk
   * to say something the parser was already saying better.
   */
  static parse(src) {
    const raw = typeof src === 'string' ? JSON.parse(src) : src;
    if (raw?.format !== LOG_FORMAT) {
      throw new Error(`not an input log (format=${JSON.stringify(raw?.format)})`);
    }
    if (raw.version !== LOG_VERSION) {
      throw new Error(`input log version ${raw.version}, expected ${LOG_VERSION}`);
    }
    if (typeof raw.mode !== 'string') throw new Error('input log has no mode');
    if (!Number.isFinite(raw.seed)) throw new Error('input log has no seed');
    if (!Array.isArray(raw.events)) throw new Error('input log has no events');

    const log = new InputLog({ mode: raw.mode, seed: raw.seed, label: raw.label ?? '' });
    const kinds = new Set(Object.values(INPUT_KIND));
    raw.events.forEach((ev, i) => {
      if (!kinds.has(ev.kind)) {
        throw new Error(`event ${i}: unknown kind ${JSON.stringify(ev.kind)}`);
      }
      if (ev.seq !== i) throw new Error(`event ${i}: seq is ${ev.seq}, expected ${i}`);
      if (!Number.isFinite(ev.rngState)) throw new Error(`event ${i}: no rngState`);
      if (ev.kind === INPUT_KIND.SHOT) {
        for (const k of ['capIndex', 'dirX', 'dirZ', 'power', 'seed']) {
          if (!Number.isFinite(ev[k])) throw new Error(`event ${i}: shot has no ${k}`);
        }
      } else if (ev.kind === INPUT_KIND.CARD && typeof ev.cardId !== 'string') {
        throw new Error(`event ${i}: card has no cardId`);
      }
      log.events.push(ev);
    });
    return log;
  }
}

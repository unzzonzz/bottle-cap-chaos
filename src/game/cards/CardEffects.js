import { canUseCard } from './cardCatalog.js';

/**
 * What the cards have DONE, as state the turn loop can read.
 *
 * Three flags and a seed. Deliberately tiny, and deliberately serialisable:
 * `Match` rewinds the physics world and the rule set together for the
 * determinism replay, and a card effect left out of that rewind would make a
 * replayed turn a different turn — a shot deviated on the first run and true on
 * the second, reported as a solver bug.
 *
 * ── nothing in here touches the world ───────────────────────────────────────
 * This module holds no bodies, applies no impulses and moves nothing. Swap is
 * the only card with a physical effect and it is carried out by `CapSwap` under
 * `Match`'s own step loop; what lives here is the record that it happened.
 *
 * ── the chaos deviation is a pure function ──────────────────────────────────
 * Not a stored number. `deviationFor(angle)` hashes the card's seed together
 * with the QUANTISED aim angle, so the same heading always yields the same
 * deviation and any other heading yields a different one. That is both halves of
 * what was asked for in one property: it re-rolls as the player turns, and
 * turning back gives the old value rather than a third one.
 *
 * Storing a value and re-rolling it on change would fail the second half, and
 * would also be a hidden piece of aim state that the replay would have to carry.
 */

/** Buckets per full turn. ~0.35 degrees — finer than the player can hold. */
const ANGLE_BUCKETS = 1024;

/** One round of a 32-bit integer mix. Same family as the hash in `rng.js`. */
function mix(a, b) {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

export class CardEffects {
  constructor(config) {
    this.config = config;
    this.reset();
  }

  reset() {
    this._clearEffects();
    /** Every card played, newest last. For the panel only. */
    this.log = [];
  }

  /**
   * Every armed effect, gone. The one list of what an effect IS.
   *
   * Shared by `reset` and `onRoundEnd` so the two cannot drift: a fifth card
   * with its own state added here is cleared by both, and adding it to only one
   * of two copies is the kind of omission that shows up as a card that survives
   * a kickoff for no reason anybody can reproduce.
   */
  _clearEffects() {
    /**
     * ONE SLOT PER VICTIM, indexed by the player being deviated.
     *
     * `chaos[p]` is `{by, seed}` while player `p`'s next shot is being twisted,
     * and null when it is not. The seed is fixed when the card is played rather
     * than per shot, so the victim's whole aim is drawn from one consistent field
     * of deviations — sweeping the aim back and forth retraces the same values.
     *
     * ── it used to be a single record, and that was a rule the player could see ──
     * One `{victim, by, seed}` meant only one person could be confused at a time,
     * so casting 혼란 while you were the victim OVERWROTE your own — it pointed the
     * slot at the opponent and the deviation on your own shot simply vanished.
     * That is a one-click self-cure, so the card had to be blocked for the victim,
     * and the player was then told they could not confuse an opponent because they
     * were confused — which is not a rule anybody would design, it is an
     * implementation detail leaking out as one.
     *
     * Two slots removes the leak at the source: confusing someone no longer clears
     * your own, so both players can be under it at once and the block is not
     * needed. What survives is the CASTER's block — a second 혼란 on an already
     * confused opponent still does nothing, because the deviation is bounded by
     * `chaosMaxDeg` rather than accumulated.
     */
    this.chaos = [null, null];
    /** Who has banked an extra turn. Null when nobody has. */
    this.oneMore = null;
    /** Who has the long preview armed for this turn. Null when nobody has. */
    this.trajectory = null;
    /**
     * Who has the boosted shot armed. Null when nobody has.
     *
     * The only per-SHOT effect here — everything else above lasts a turn. It
     * carries no numbers: the multipliers live on the config so the panel can
     * move them, and are read once, at the moment the gesture ends, into the
     * shot record. See `impulseMulFor`.
     */
    this.smash = null;
  }

  // ── queries ──────────────────────────────────────────────────────────────

  /** The state a card's `canUse` is asked about. */
  stateFor(player) {
    return {
      player,
      chaosOnMe: this.chaosOn(player),
      /**
       * I already have a chaos running on my opponent.
       *
       * 혼란's self-block, and the equivalent of the other three cards' `*Armed`
       * flags — it was missing, which made 혼란 the one card that could be spent
       * twice for one effect. Read off the OPPONENT's slot rather than stored
       * separately, so it cannot disagree with the effect it describes.
       *
       * No longer mutually exclusive with `chaosOnMe`: with a slot each, a player
       * can be confused AND have confused the other, and both flags are then true.
       * That combination is legal and is exactly the case the old single record
       * could not represent.
       */
      chaosCastByMe: this.castChaosOnOpponent(player),
      oneMoreArmed: this.oneMore?.player === player,
      trajectoryArmed: this.trajectory?.player === player,
      smashArmed: this.smash?.player === player,
    };
  }

  /** @returns {{ok: boolean, reason?: string}} */
  usable(cardId, player) {
    return canUseCard(cardId, this.stateFor(player));
  }

  chaosOn(player) {
    return !!this.chaos[player];
  }

  /** Whether this player has a live chaos running on the other one. */
  castChaosOnOpponent(player) {
    const onThem = this.chaos[1 - player];
    return !!onThem && onThem.by === player;
  }

  trajectoryOn(player) {
    return !!this.trajectory && this.trajectory.player === player;
  }

  smashOn(player) {
    return !!this.smash && this.smash.player === player;
  }

  /**
   * What this player's next shot is multiplied by. 1 when nothing is armed.
   *
   * ── two multipliers, and they are deliberately independent ──────────────────
   * Strength and accuracy are what the card trades between, so they have to be
   * tunable against each other: the whole question the card poses is how much
   * cone a given amount of extra impulse is worth, and a single number cannot
   * ask it. They start equal and are expected not to stay that way.
   *
   * Neutral rather than absent when the card is not armed, exactly as
   * `deviationFor` returns 0 — so the shot path calls these unconditionally and
   * has no branch in it about a card existing.
   *
   * Read ONCE, when the gesture ends, and written into the shot record. Not read
   * at fire time: `Match.fire` and the trajectory preview both resolve a shot
   * from the record alone, the preview has no access to this object at all, and
   * a slider dragged between a shot and its replay would otherwise make the
   * replay a different shot. See `AimInput.end`.
   */
  impulseMulFor(player) {
    return this.smashOn(player) ? Math.max(0, this.config.cards.smashImpulseMul) : 1;
  }

  /** The same, for the charge cone's half-angle. See `impulseMulFor`. */
  spreadMulFor(player) {
    return this.smashOn(player) ? Math.max(0, this.config.cards.smashSpreadMul) : 1;
  }

  /**
   * How far this player's shot is twisted, for a given heading.
   *
   * Radians, in ±`chaosMaxDeg`. Zero when this player is not under chaos, which
   * is what lets the aim path call it unconditionally.
   *
   * @param {number} player
   * @param {number} angle  the aim heading, radians
   */
  deviationFor(player, angle) {
    const live = this.chaos[player];
    if (!live) return 0;
    const max = (Math.max(0, this.config.cards.chaosMaxDeg) * Math.PI) / 180;
    if (max <= 0) return 0;
    // Quantise BEFORE hashing. Two headings a thousandth of a radian apart are
    // the same heading as far as a hand on a mouse is concerned, and hashing the
    // raw float would make the deviation jitter while the player held still.
    const tau = Math.PI * 2;
    const bucket = Math.round((((angle % tau) + tau) % tau) * (ANGLE_BUCKETS / tau)) % ANGLE_BUCKETS;
    const h = mix(live.seed >>> 0, bucket);
    // [-1, 1), the same shape `Rng.signed` produces.
    return ((h / 4294967296) * 2 - 1) * max;
  }

  // ── playing one ──────────────────────────────────────────────────────────

  /**
   * Record a card as played. The caller has already checked `usable`.
   *
   * Returns what the turn loop has to do about it: `physical` cards need the
   * world moved and the turn re-snapshotted, the rest are bookkeeping.
   *
   * @param {string} cardId
   * @param {number} player
   * @param {number} seed  drawn by the caller, so it lands in the replay record
   */
  play(cardId, player, seed) {
    this.log.push({ cardId, player });

    switch (cardId) {
      case 'chaos':
        // Into the OPPONENT's slot. Mine, if I have one, is untouched — which is
        // the whole of why a victim may now cast this.
        this.chaos[1 - player] = { by: player, seed: seed >>> 0 };
        return { physical: false };
      case 'onemore':
        this.oneMore = { player };
        return { physical: false };
      case 'trajectory':
        this.trajectory = { player };
        return { physical: false };
      // Not physical: it moves nothing. `physical: true` is the swap's path —
      // it runs the kinematic exchange and re-snapshots the turn — and a card
      // with no exchange behind it would come out of that branch without
      // reopening the aim.
      case 'smash':
        this.smash = { player };
        return { physical: false };
      case 'swap':
        return { physical: true };
      default:
        return { physical: false };
    }
  }

  // ── turn boundaries ──────────────────────────────────────────────────────

  /**
   * A shot has just been fired. The long preview was for that shot only.
   *
   * And so was the boost — this is where "이번 턴 발사 1회에만" is enforced, and
   * it is the reason 원모어's extra turn comes out unboosted: the second shot of
   * a chain is a second call to `fire`, and the flag is gone by then.
   *
   * Called from `Match.fire` AFTER the turn record is built, so the record still
   * shows the card armed and a replay of that turn re-expires it in the same
   * place. Clearing it any earlier would desync the two.
   */
  onFire(player) {
    if (this.trajectory?.player === player) this.trajectory = null;
    if (this.smash?.player === player) this.smash = null;
  }

  /**
   * The turn has resolved. Consume what was banked, clear what has expired.
   *
   * Called from `Match._endTurn` between the verdict and `advanceTurn`.
   *
   * @param {number} shooter  the player whose turn just ended
   * @returns {boolean} whether the same player takes the next turn
   */
  onTurnEnd(shooter) {
    // Chaos was cast on the opponent's NEXT shot; that shot has now happened.
    // Only the shooter's OWN slot. A chaos they cast on the other player is
    // waiting for that player's shot and must survive this.
    this.chaos[shooter] = null;
    // A card played but not fired with still expires — the turn is over.
    if (this.trajectory?.player === shooter) this.trajectory = null;
    // The same safety net for the boost. `onFire` is the ordinary expiry; this
    // catches the turn that ended without a shot in it at all.
    if (this.smash?.player === shooter) this.smash = null;

    if (this.oneMore?.player === shooter) {
      this.oneMore = null;
      return true;
    }
    return false;
  }

  /**
   * The round is over. Nothing a card did survives the whistle.
   *
   * Called from `Match._resetField`, so it is the goal that clears these rather
   * than the turn — a chaos cast on a player who then conceded would otherwise
   * be waiting for them on the kickoff of a round it was never played in, and a
   * chaos cast BY the scorer survives `onTurnEnd` by construction (that only
   * expires the shooter's own).
   *
   * The log is deliberately kept: it is the record of what was played this
   * match, not an effect, and the panel reads it to show the match's history.
   */
  onRoundEnd() {
    this._clearEffects();
  }

  // ── serialisation ────────────────────────────────────────────────────────
  //
  // Round-trips through `load`, and has to: the replay rewinds to the start of
  // the turn and re-fires, so the chaos that twisted the shot the first time has
  // to be back in place to twist it the same way the second time.

  save() {
    return {
      chaos: this.chaos.map((v) => (v ? { ...v } : null)),
      oneMore: this.oneMore ? { ...this.oneMore } : null,
      trajectory: this.trajectory ? { ...this.trajectory } : null,
      smash: this.smash ? { ...this.smash } : null,
    };
  }

  load(s) {
    if (!s) return;
    // Tolerates the single-record shape a state saved before the split would
    // have: the replay restores whatever `save` wrote, and a mid-turn reload of
    // an old snapshot must not come back as a chaos nobody can clear.
    this.chaos = Array.isArray(s.chaos)
      ? s.chaos.map((v) => (v ? { ...v } : null))
      : s.chaos
        ? Object.assign([null, null], { [s.chaos.victim]: { by: s.chaos.by, seed: s.chaos.seed } })
        : [null, null];
    this.oneMore = s.oneMore ? { ...s.oneMore } : null;
    this.trajectory = s.trajectory ? { ...s.trajectory } : null;
    this.smash = s.smash ? { ...s.smash } : null;
  }
}

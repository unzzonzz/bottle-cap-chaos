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
    /**
     * ONE SLOT PER VICTIM, indexed by the player who may not play cards.
     *
     * `silence[p]` is `{by, turns}` while player `p` is sealed and null when
     * they are not. `turns` is what is LEFT, counted down at the end of each of
     * that player's own turns — see `onTurnEnd` — so the whole duration lives in
     * one number the panel can move.
     *
     * Two slots for the reason `chaos` has two, and the note above is the long
     * version of it: a single record would make sealing someone clear your own
     * seal, which is a one-click self-cure, and blocking the victim to hide that
     * would tell the player a rule nobody designed.
     *
     * ── the seal is on the PLAYER, not on the controller ────────────────────
     * Nothing in here knows or asks whether player `p` is a person or an AI, and
     * nothing downstream does either: the hand greys because `canUseCard` was
     * refused, and an AI will be refused by the same call for the same reason.
     * That is the whole of what "컨트롤러 종류와 무관하게" needs, and it needs it
     * to still be true when the AI arrives.
     */
    this.silence = [null, null];
    /**
     * ONE SLOT PER BENEFICIARY, indexed by the player whose caps are braced.
     *
     * `resist[p]` is `{}` while player `p` has 철벽 armed and null when they do
     * not. It carries nothing: the multiplier is derived from 강타's — see
     * `massMulFor` — and there is no seed, because nothing about this card is
     * random.
     *
     * ── it is a slot per player for the reason chaos and silence are ─────────
     * Not because a second one would overwrite something, but because both
     * players can be braced at once and a single record could not say so. Both
     * of the other two have the long version of this note above.
     *
     * ── armed is not the same as LIVE, and Match owns the difference ─────────
     * §2-A: the brace covers the OPPONENT's next shot, never the holder's own.
     * That is a fact about whose turn it is, and whose turn it is lives in the
     * rule set rather than here — so this records only that the card is armed,
     * and `Match._syncCapMass` decides when the world carries it. Storing a
     * `live` flag here instead would have to be flipped at a turn boundary, and
     * it would then be wrong for 원모어: the holder's SECOND shot is still their
     * own, and a flag flipped at the first turn end would brace them against it.
     */
    this.resist = [null, null];
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
      /** The seal on ME. Read by `canUseCard`'s gate, which refuses everything. */
      silencedMe: this.silencedOn(player),
      /** 침묵's self-block, and the exact analogue of `chaosCastByMe`. */
      silenceCastByMe: this.castSilenceOnOpponent(player),
      /**
       * 철벽's self-block, and the analogue of `smashArmed` rather than of
       * `chaosCastByMe`: this card is cast on MYSELF, so the slot to read is my
       * own and there is no `~CastByMe` counterpart to write.
       */
      resistArmed: this.resistOn(player),
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

  /**
   * Whether this player's hand is sealed. The one question the view asks.
   *
   * A method rather than a field so there is nothing for a second copy of the
   * answer to disagree with, and so the AI work later has exactly one call to
   * reach for. Whoever is holding the hand, this is what decides.
   */
  silencedOn(player) {
    return !!this.silence[player];
  }

  /** Turns of seal left on this player, 0 when they are not sealed. For the panel. */
  silenceTurnsLeft(player) {
    return this.silence[player]?.turns ?? 0;
  }

  /** Whether this player has a live seal running on the other one. */
  castSilenceOnOpponent(player) {
    const onThem = this.silence[1 - player];
    return !!onThem && onThem.by === player;
  }

  /** Whether this player has 철벽 armed. The one question `Match` asks. */
  resistOn(player) {
    return !!this.resist[player];
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
   * What this player's caps are multiplied in MASS by. 1 when nothing is armed.
   *
   * ── the number is 강타's, and it is not written down twice ─────────────────
   * The card's promise is that a braced cap is shoved less by the ratio 강타
   * shoves more, so a second `resistMassMul` on the config would be a second
   * dial for one number — and the first time somebody tuned 강타 alone the two
   * would stop cancelling, silently, while the card face went on claiming it.
   * So this is a function of `smashImpulseMul` and there is no key for it.
   *
   * ── but the function is NOT 1/k, and that took measuring ───────────────────
   * The obvious derivation is the one a fixed impulse gives:
   *
   *     강타   v = k·J / m
   *     철벽   v = J / (k·m)      ← so multiply mass by k, and they cancel
   *
   * That is right for an impulse applied TO the cap — a shot, a flick — and a
   * braced cap is not shot, it is HIT. A collision does not deliver a fixed
   * impulse: it delivers whatever the two masses agree on. For a striker `m1`
   * arriving at `v1` into a stationary `m2`,
   *
   *     v2' = m1(1 + e)·v1 / (m1 + m2)
   *
   * so with `m2 = a·m1` the struck cap's response falls as `2 / (1 + a)`, not as
   * `1 / a`. Measured on the real compound collider at three ranges, the two
   * agree to three decimals — a = 1.5 gives 0.797/0.796/0.793 against a
   * predicted 0.800, and a = 4 gives 0.394/0.393/0.382 against 0.400.
   *
   * Setting `2 / (1 + a) = 1 / k` and solving gives the multiplier below:
   *
   *     a = 2k − 1
   *
   * At the default k = 1.5 that is 2.0, and it does what the card says: a plain
   * shot moves a braced cap at 0.662 of the speed it moves a bare one, against
   * the 1/k = 0.667 the card promises. Used naively, `a = k` gives 0.797 — the
   * card would be delivering barely half the effect written on it.
   *
   * ── what still does not cancel exactly, and why nothing can fix it ─────────
   * 강타 + 철벽 lands at 0.961 / 0.999 / 1.170 of a plain shot at gaps of 6, 12
   * and 24 units. The residue is 강타's own RANGE amplification: friction takes
   * energy per unit distance, so a boosted cap arrives with more than k times
   * the speed of an unboosted one and by more the further it has come — 1.45x at
   * six units and 1.77x at twenty-four. Cancelling that would need a multiplier
   * that knew how far the shot had travelled, which is not a card. The card face
   * therefore says "덜 밀려난다" and does not promise a cancellation.
   *
   * ── it is a method here rather than a getter on the config ────────────────
   * `config.js` does `structuredClone(CONFIG)` at module scope to build
   * `CONFIG_DEFAULTS`, and `structuredClone` evaluates a getter and writes down
   * the VALUE — so a derived key would be live on `CONFIG` and frozen on the
   * defaults `ReplayRunner` starts from. Deriving at the read site has neither
   * problem, and keeps `cards` one key smaller on the wire.
   *
   * Clamped at 1, not at 0. `impulseMulFor` clamps at 0 because a zero impulse
   * is merely a shot that does nothing; a mass multiplier below 1 would make the
   * braced cap LIGHTER than it started, which is the opposite of the card.
   */
  massMulFor(player) {
    if (!this.resistOn(player)) return 1;
    return Math.max(1, 2 * Math.max(0, this.config.cards.smashImpulseMul) - 1);
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
      /**
       * Into the OPPONENT's slot, exactly as 혼란 goes. Mine is untouched, so
       * being sealed does not stop me sealing — except that a sealed player
       * never reaches this call at all, because `canUseCard` refused them.
       *
       * The length is read from the config HERE, at the moment of the cast,
       * rather than at each turn end. A slider dragged mid-seal would otherwise
       * change a lockout the player is already inside, and — the half that
       * matters — the replay re-reads the record instead of the slider, so a
       * turn replayed after a drag is still the turn that was played.
       *
       * No seed. Nothing about this card is random: it is a duration and a
       * victim, and both are decided by the cast.
       */
      case 'silence':
        this.silence[1 - player] = {
          by: player,
          turns: Math.max(1, Math.round(this.config.cards.silenceTurns)),
        };
        return { physical: false };
      /**
       * Into MY OWN slot — the only card here that is cast on the caster.
       *
       * Not physical, and that is not an oversight. §2-A applies the brace for
       * the OPPONENT's reply, so nothing about the world changes on this turn:
       * the mass lands when the opponent's `_beginAim` puts it there, which is
       * before that turn's snapshot is taken. The world the shot about to be
       * fired will be fired into is unchanged, so the turn's existing snapshot
       * stays valid and `physical: true` would re-snapshot a world that never
       * moved — and reopen the aim through the swap's path, which has a
       * kinematic exchange behind it and this does not.
       *
       * No seed and no duration. It is a fact about one player for exactly one
       * opposing shot, and `onTurnEnd` is where that gets spent.
       */
      case 'resist':
        this.resist[player] = {};
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

    /**
     * The seal is spent by the turn it was serving on, and only the SHOOTER's.
     *
     * The same rule as chaos's line above and for the same reason: a seal I cast
     * on the other player is waiting for THEIR turn and has to survive the end
     * of mine. Only the person whose turn just ended pays a turn off theirs.
     *
     * Counted down rather than cleared outright, because the length is a dial:
     * at the default 1 this is exactly "cleared when their turn ends", and at 2
     * it is the same code doing the obvious thing.
     *
     * Not gated on a shot having been fired. A turn that ended without one — a
     * goal reset, a settle with nothing struck — is still a turn the player did
     * not get to use their cards in, and the seal has to expire on it or a
     * player could sit under a lockout that never counts down.
     */
    const seal = this.silence[shooter];
    if (seal) {
      seal.turns -= 1;
      if (seal.turns <= 0) this.silence[shooter] = null;
    }

    /**
     * The OPPONENT's brace is spent by the shot that just ended this turn.
     *
     * `1 - shooter`, and the mirror of chaos's line at the top of this method:
     * that one clears the slot belonging to the player who just shot, because a
     * deviation is bought against their OWN shot. A brace is bought against the
     * other player's, so it is the other index that expires here.
     *
     * Which also gets 원모어 right without knowing about it. A holder who takes
     * two turns in a row runs this twice, and both runs clear the opponent's
     * slot rather than their own — so their brace survives to meet the reply it
     * was played for, and the opponent's brace covers the FIRST of the two shots
     * and not the second. One shot, as the face says.
     *
     * Not gated on a shot having been fired, for the reason the seal is not: a
     * turn that passed is still the turn the card was waiting for.
     */
    this.resist[1 - shooter] = null;

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
      // Copied per slot, not by reference: `turns` is MUTATED in place by
      // `onTurnEnd`, so a shared object would let a replayed turn count down a
      // snapshot that the next replay is going to be restored from.
      silence: this.silence.map((v) => (v ? { ...v } : null)),
      // Per slot and by value, like `silence`. The record is empty today, and
      // copying it anyway is what stops a field added to it later from being
      // shared between a live effect and the snapshot a replay restores from.
      resist: this.resist.map((v) => (v ? { ...v } : null)),
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
    // Tolerates a state saved before this card existed, the way `chaos` above
    // tolerates the shape from before its own split: a mid-turn reload of an old
    // snapshot must come back unsealed rather than as `undefined[player]`.
    this.silence = Array.isArray(s.silence)
      ? s.silence.map((v) => (v ? { ...v } : null))
      : [null, null];
    // Tolerates a state saved before this card existed, exactly as `silence`
    // above does — an old mid-turn snapshot has to come back unbraced rather
    // than as `undefined[player]`.
    this.resist = Array.isArray(s.resist)
      ? s.resist.map((v) => (v ? { ...v } : null))
      : [null, null];
  }
}

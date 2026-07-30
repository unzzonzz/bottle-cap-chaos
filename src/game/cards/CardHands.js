import { CARDS } from './cardCatalog.js';

/**
 * What each player is HOLDING.
 *
 * ── the hand used to live in the renderer, and that was the blocker ─────────
 * `CardHand.cards` was the only record of what anyone held: it was filled by
 * `dealHand` straight out of the catalog, and `main.js` threw it away and dealt
 * again on every round change. That was fine while a hand was four fixed cards
 * handed out at the start to exercise the effects.
 *
 * It cannot survive cards being FOUND. Five separate requirements all need the
 * hand to be state the game owns rather than a picture the view keeps:
 *
 *   · zero at the start, and reset only when a new match begins
 *   · kept across a goal reset and a round change — the old code reset there
 *   · a five-card ceiling, which needs a count to test before a pickup
 *   · duplicates, which need instances rather than a set of card types
 *   · the same seed producing the same cards, which needs the draw to be part
 *     of the simulation rather than of the drawing of it
 *
 * So this owns it, `Match` owns this, and the view syncs to it. Nothing about a
 * card's EFFECT is here — that is still `CardEffects`, untouched. This is only
 * the question of who is holding what.
 *
 * ── instances, not counts ──────────────────────────────────────────────────
 * A hand is a LIST of `{key, cardId}` and never a tally. Two 혼란 are two
 * separate things that are held in two separate places in the fan, are dragged
 * independently and are spent one at a time — merging them into "혼란 x2" is
 * explicitly not wanted, and a count could not represent the order the player
 * has arranged them in either.
 *
 * `key` is what the view tracks a card by across a sync, so it has to be stable
 * for the life of the card and unique for all time. A counter gives both, and
 * being a counter rather than a random id is what keeps it deterministic.
 */

/** Card ids that can be found, in a fixed order. Determinism starts here. */
export const DRAWABLE = CARDS.map((c) => c.id);

export class CardHands {
  /** @param {typeof import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    /** @type {{key: number, cardId: string}[][]} indexed by player */
    this.hands = [[], []];
    /**
     * Next instance id. Monotonic and never reused, so a key identifies one
     * card for the whole match and the view can tell "the same card moved" from
     * "a different card arrived".
     */
    this._nextKey = 1;
  }

  /**
   * Empty both hands.
   *
   * Called when a MATCH starts and at no other time. Not on a round change and
   * not on a goal — the brief is explicit that a hand survives both, and the
   * old per-round deal was the thing that made that impossible.
   */
  reset() {
    this.hands = [[], []];
    this._nextKey = 1;
  }

  /** @returns {{key: number, cardId: string}[]} live reference; do not splice. */
  get(player) {
    return this.hands[player] ?? [];
  }

  count(player) {
    return this.get(player).length;
  }

  get limit() {
    return Math.max(0, Math.round(this.config.cards.handLimit));
  }

  isFull(player) {
    return this.count(player) >= this.limit;
  }

  /**
   * Put a card in a hand.
   *
   * @returns {{key: number, cardId: string}|null}
   *   null when the hand is already full. The caller has to be able to tell,
   *   because a pickup that fails must leave the orb on the field and say so
   *   rather than silently swallowing it.
   */
  add(player, cardId) {
    if (this.isFull(player)) return null;
    const card = { key: this._nextKey++, cardId };
    this.get(player).push(card);
    return card;
  }

  /** @returns {boolean} whether anything was there to remove. */
  remove(player, key) {
    const hand = this.get(player);
    const at = hand.findIndex((c) => c.key === key);
    if (at < 0) return false;
    hand.splice(at, 1);
    return true;
  }

  /**
   * Spend the FIRST card of a type. For the play path, which knows a card id
   * and not which of the duplicates the player dragged.
   */
  removeFirstOfType(player, cardId) {
    const hand = this.get(player);
    const at = hand.findIndex((c) => c.cardId === cardId);
    if (at < 0) return false;
    hand.splice(at, 1);
    return true;
  }

  /** Move a card within a hand. The drag-to-reorder gesture's whole effect. */
  reorder(player, from, to) {
    const hand = this.get(player);
    if (from < 0 || from >= hand.length) return false;
    const clamped = Math.max(0, Math.min(hand.length - 1, to));
    if (clamped === from) return false;
    const [card] = hand.splice(from, 1);
    hand.splice(clamped, 0, card);
    return true;
  }

  /**
   * Which card a pickup yields.
   *
   * ── it takes an Rng, it does not own one ────────────────────────────────
   * The caller passes the generator so the draw is part of whatever seeded
   * sequence the turn is already running on. A generator owned here would be a
   * second stream that a replay would have to reproduce separately, and the
   * whole point is that one seed reproduces everything.
   *
   * Weights are read fresh each time so the panel's sliders are live, and the
   * order of `DRAWABLE` is fixed so the same roll always picks the same card.
   * A zero weight simply never comes up.
   *
   * @param {import('../../physics/rng.js').Rng} rng
   * @returns {string|null} a card id, or null if every weight is zero
   */
  draw(rng) {
    const weights = this.config.cards.orbWeights ?? {};
    let total = 0;
    for (const id of DRAWABLE) total += Math.max(0, weights[id] ?? 0);
    if (total <= 0) return null;

    let roll = rng.float() * total;
    for (const id of DRAWABLE) {
      roll -= Math.max(0, weights[id] ?? 0);
      if (roll < 0) return id;
    }
    // Floating point landed on the far edge. The last non-zero weight is the
    // honest answer rather than a null the caller would have to handle.
    for (let i = DRAWABLE.length - 1; i >= 0; i--) {
      if ((weights[DRAWABLE[i]] ?? 0) > 0) return DRAWABLE[i];
    }
    return null;
  }

  save() {
    return {
      hands: this.hands.map((h) => h.map((c) => ({ ...c }))),
      nextKey: this._nextKey,
    };
  }

  load(s) {
    if (!s) return;
    this.hands = (s.hands ?? [[], []]).map((h) => h.map((c) => ({ ...c })));
    this._nextKey = s.nextKey ?? 1;
  }
}

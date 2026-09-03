/**
 * What each card IS: its name, its art, and the one question that decides
 * whether it can be played right now.
 *
 * ── availability is data, not a branch ───────────────────────────────────────
 * Every card carries its own `canUse(state)`. That is the whole rule — there is
 * no list somewhere of "cards that cannot be used during chaos", and adding a
 * fifth card with its own restriction touches nothing but this file.
 *
 * It matters more than it looks. The same predicate is asked in three places
 * that must never disagree: the hand greys the card with it, the hover reads its
 * reason out of it, and the drag refuses with it. One of those getting a
 * different answer from the others is a card that looks playable and is not, and
 * the player has no way to tell which of the three is lying.
 *
 * The reason string is part of the answer for the same reason: a boolean would
 * force the UI to invent an explanation, and the UI does not know why.
 */

/**
 * @typedef {object} CardState
 * @property {number} player            whose turn it is
 * @property {boolean} chaosOnMe        this player's next shot is being deviated
 * @property {boolean} chaosCastByMe    this player is the one who cast the live chaos
 * @property {boolean} oneMoreArmed     an extra turn is already banked
 * @property {boolean} trajectoryArmed  the long preview is already on
 * @property {boolean} smashArmed       this player's next shot is already boosted
 * @property {boolean} silencedMe       this player may not play ANY card this turn
 * @property {boolean} silenceCastByMe  this player has already sealed the opponent
 * @property {boolean} resistArmed      this player's caps are already braced
 */

/** @typedef {{ok: true}|{ok: false, reason: string}} Usable */

const OK = { ok: true };

/**
 * @typedef {object} CardDef
 * @property {string} id       stable; what everything else refers to
 * @property {string} name
 * @property {string} glyph    one angular character; the artwork slot
 * @property {string} text     one line, short enough to read while it is lifted
 * @property {string} accent   border and glyph colour
 * @property {(s: CardState) => Usable} canUse
 */

/**
 * Cards that exist but are not dealt.
 *
 * ── swap is shelved, not deleted ────────────────────────────────────────────
 * Exchanging both teams' positions is too strong: it undoes a whole match's
 * worth of build-up in one card, and the player who has spent three turns
 * working the ball up the pitch loses that to a shuffle they cannot answer.
 *
 * Everything it needs is still here and still working — `CapSwap`, the
 * kinematic exchange, the ring-and-line effect, the camera's response to it.
 * Moving this entry back into `CARDS` is the whole of putting it back, which is
 * why it is parked here rather than torn out.
 */
export const SHELVED = [
  {
    id: 'swap',
    name: '스왑',
    glyph: '⇄',
    text: '양 팀 뚜껑 위치를 맞바꾼다',
    accent: '#7ec8f0',
    canUse: () => OK,
  },
];

/** @type {CardDef[]} */
export const CARDS = [
  {
    id: 'trajectory',
    name: '궤적',
    glyph: '⌁',
    text: '이번 발사의 궤적을 길게 예측한다',
    accent: '#7ef0c8',
    // The one interaction between two cards, and it is deliberate: chaos exists
    // to take the shot away from the player, and a card that hands back an exact
    // preview of the deviated shot would hand the shot straight back.
    //
    // The refusal says what the CARD cannot do, not what state you are in. It
    // used to read "혼란 상태에서는 사용할 수 없습니다", which is the condition
    // restated as its own reason — and 혼란 refused with the very same sentence,
    // so two cards blocked for completely different reasons gave the player one
    // identical and uninformative line. See the note on 혼란 below.
    canUse: (s) =>
      s.chaosOnMe
        ? { ok: false, reason: '혼란 중인 발사는 예측할 수 없습니다' }
        : s.trajectoryArmed
          ? { ok: false, reason: '이미 궤적이 켜져 있습니다' }
          : OK,
  },
  {
    id: 'chaos',
    name: '혼란',
    glyph: '✳',
    text: '상대의 다음 발사 방향을 흐트러뜨린다',
    accent: '#b9a0e8',
    /**
     * One refusal, and it is about the OPPONENT's state, never about your own.
     *
     * ── being confused does not stop you confusing someone ──────────────────
     * It used to. `CardEffects` held a single `chaos` record, so casting this
     * while it pointed at YOU overwrote it with one pointing at the opponent and
     * cleared your own deviation on the way past — a one-click self-cure, which
     * had to be blocked. But the block was a lie about the game: what the player
     * was told is that they cannot confuse an opponent because they are confused,
     * and that is not a rule anybody designed, it is a data-structure limit
     * wearing a rule's clothes.
     *
     * `chaos` is now a slot per victim, so confusing someone no longer touches
     * your own and both players can be under it at once. The victim's block went
     * with the reason for it.
     *
     * ── what is still refused: a second one on the same target ──────────────
     * Not stackable, for the reason 원모어 and 강타 are not. The deviation is
     * bounded by `chaosMaxDeg` rather than accumulated, so `play` would rewrite
     * the opponent's slot with the same victim, the same caster and the same
     * range — a different SEED and nothing else. Measured before this guard
     * existed: two casts, both cards spent, one of them for no effect a player
     * could ever see.
     *
     * The reason says what would have happened, not what state you are in. It
     * used to share one sentence with 궤적 — "혼란 상태에서는 사용할 수 없습니다" —
     * which names the condition and calls it the reason; the player already knows
     * they are confused, and what they cannot know is why THIS card is greyed.
     */
    canUse: (s) =>
      s.chaosCastByMe
        ? { ok: false, reason: '이미 상대가 혼란입니다 — 겹쳐도 효과가 커지지 않습니다' }
        : OK,
  },
  {
    id: 'onemore',
    name: '원모어',
    glyph: '↻',
    text: '이번 턴 뒤에 한 번 더 발사한다',
    accent: '#e0c07a',
    // Not stackable. Two of these would be a third turn, then a fourth, and the
    // opponent never moves again — which is not a strong card, it is a broken
    // one.
    canUse: (s) =>
      s.oneMoreArmed ? { ok: false, reason: '이미 추가 턴이 활성화되어 있습니다' } : OK,
  },
  {
    id: 'smash',
    name: '강타',
    // Line art, like the other three, and that is a measurement rather than a
    // preference. The art slot is one character at 46px, thresholded to hard
    // alpha and then quantised to five bits a channel; a FILLED glyph comes
    // through that as a lump. Measured on this card set, ⌁ ✳ ↻ lay down 162-292
    // inked pixels — ◈ lays down 402 and reads as an orange blob. ≫ is 228, in
    // the middle of the set, and says thrust.
    //
    // THIS CONSTRAINT NO LONGER HOLDS. The alpha threshold and the 5-bit
    // quantiser it was measured against were both removed in PHASE 1, so a
    // filled glyph no longer comes through as a lump and the ink-pixel budget
    // is not a reason to refuse one. The glyphs are unchanged because they read
    // well, not because they have to be these. See `render/cardTexture.js`.
    glyph: '≫',
    // The cost is IN the card, not in a tooltip. A player who reads only the
    // name plays this expecting a free upgrade, and the shot that then misses
    // by a cone twice the usual width reads as the game cheating rather than as
    // the price of the card. Both halves, on the face, in the same sentence.
    text: '세게 친다 대신 오차가 크게 벌어진다',
    accent: '#e8724a',
    // Not stackable with itself, for the same reason 원모어 is not: the boost is
    // a multiplier and two of them is a square. One is a strong shot; two is a
    // cap through a wall.
    canUse: (s) =>
      s.smashArmed ? { ok: false, reason: '이미 강타가 걸려 있습니다' } : OK,
  },
  {
    id: 'resist',
    name: '철벽',
    /**
     * 철벽 — stacked horizontal courses, drawn in `ui/icons.js`.
     *
     * The glyph is a key into `CARD_ICON` and is no longer rendered; this one is
     * a lookalike for the courses the icon draws, so a build where the icon
     * table has not caught up still falls back to something wall-shaped.
     *
     * NOT a shield. There is no shield anywhere in this game, and a shield is a
     * thing you CARRY — it says "I am protected wherever I go", where this card
     * says "I do not move from here". The icon is the opposite reading of 강타's
     * `≫`: that one is an open stroke thrusting right, this one is the closed
     * course it runs into.
     */
    glyph: '▤',
    // §2-A. Purely defensive: the brace is applied for the OPPONENT's reply and
    // this player's own fire is untouched, so there is no price to write on the
    // face and writing one would be a lie. 강타 states its cost because it has
    // one; the symmetry between the two cards is in the mechanism — a mass
    // multiplier that exactly cancels an impulse multiplier — not in the
    // sentence.
    text: '다음 상대 발사에 덜 밀려난다',
    /**
     * Cold steel blue. Opposite 강타's warm orange, which is the card it exists
     * to answer, so a board carrying both reads as two opposed forces.
     *
     * A FALLBACK, like every accent in this file. `PALETTE.card` is what the
     * hand actually draws — see the note on `accentOf` — and the reasoning about
     * which card this must not be confused with lives there, with the
     * measurements, because the answer depends on the other five palette values
     * and not on the five written here.
     */
    accent: '#2b8aca',
    /**
     * Not stackable, for the reason 원모어 and 강타 are not: the brace is a
     * MULTIPLIER on mass, so two of them is a square. One is a cap that is hard
     * to move; two is a cap that does not move, and a piece that cannot be
     * pushed off has left the game the card was played in.
     *
     * The reason says what a second one would have bought rather than restating
     * the state, exactly as 혼란's and 침묵's do.
     */
    canUse: (s) =>
      s.resistArmed
        ? { ok: false, reason: '이미 철벽이 걸려 있습니다 — 겹쳐도 더 버티지 않습니다' }
        : OK,
  },
  {
    id: 'silence',
    name: '침묵',
    // Line art at 46px, like the other four, and picked by the same measurement
    // the 강타 note describes: a FILLED glyph comes through the alpha threshold
    // and the 5-bit quantiser as a lump. ⊘ inks 214 pixels — between ✳'s 292 and
    // ↻'s 162, so it sits inside the set rather than next to it — and a struck-
    // through circle is the one shape that reads as "no" at a glance.
    glyph: '⊘',
    // Says WHOSE turn and WHAT is sealed. "카드를 봉인한다" alone would be read as
    // sealing this turn's own hand, which is the opposite of the card.
    text: '다음 턴 상대 카드 사용 봉인',
    // Cold and drained, against 혼란's violet: the two are the only cards that
    // are cast ON the opponent, and they must not be confusable in the fan.
    accent: '#8f9aa8',
    /**
     * One refusal, and it is about the OPPONENT, exactly as 혼란's is.
     *
     * Not stackable, for the reason 원모어 and 강타 are not. The seal is a
     * DURATION on the victim's next turn, and a second cast would rewrite the
     * same victim's slot with the same caster and the same length — a card spent
     * for nothing the player could ever see. Refreshing the count instead would
     * be worse: two 침묵 in a hand would be a two-turn lockout, which is a
     * different card from the one written on the face.
     *
     * The reason says what would have happened rather than restating the state,
     * for the reason the note on 혼란 gives at length.
     *
     * Being silenced YOURSELF is not refused here, and deliberately not: that
     * block belongs to every card at once and lives in `canUseCard` below, where
     * it is asked once instead of being copied into six predicates that could
     * drift apart.
     */
    canUse: (s) =>
      s.silenceCastByMe
        ? { ok: false, reason: '이미 상대가 침묵입니다 — 겹쳐도 턴이 늘지 않습니다' }
        : OK,
  },
];

/**
 * Shelved cards are still LOOKUPABLE, deliberately.
 *
 * The debug panel can still force one, and a saved card state from before it was
 * shelved still resolves rather than throwing. What can actually turn up in a
 * hand is `CARDS` alone — see `CardHands.DRAWABLE`, which is built from it.
 */
export const CARD_BY_ID = new Map([...CARDS, ...SHELVED].map((c) => [c.id, c]));

/**
 * The one refusal that belongs to no card in particular.
 *
 * ── 침묵 seals the HAND, so it cannot live in a card's own predicate ─────────
 * Every other rule in this file is a property of one card: 궤적 refuses under
 * 혼란, 강타 refuses itself. 침묵 refuses ALL SIX, which through the per-card
 * pattern would mean pasting the same clause into six `canUse` bodies — six
 * copies of one rule, five of them in cards this task is explicitly not to
 * touch, and every one of them a place for the rule to drift.
 *
 * So it is asked HERE, before the card is consulted at all. Nothing about the
 * existing five changes, a seventh card is sealed by existing, and the three
 * places that must never disagree — the grey-out, the hover reason, the drag —
 * still ask exactly one function.
 *
 * BEFORE the card's own predicate rather than after, so a silenced player whose
 * 강타 is also already armed is told about the seal. The seal is the one they
 * can do nothing about, and it is the one that explains the whole hand rather
 * than one card of it.
 *
 * It seals 침묵 itself too, which is correct and worth saying out loud: a
 * silenced player cannot answer a seal with a seal.
 */
function sealed(state) {
  return state.silencedMe
    ? { ok: false, reason: '침묵 상태입니다 — 이번 턴은 카드를 쓸 수 없습니다' }
    : null;
}

/**
 * @param {string} id
 * @param {CardState} state
 * @returns {Usable}
 */
export function canUseCard(id, state) {
  const card = CARD_BY_ID.get(id);
  if (!card) return { ok: false, reason: '알 수 없는 카드' };
  return sealed(state) ?? card.canUse(state);
}

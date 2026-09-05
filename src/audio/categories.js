/**
 * The mixer's buses, and the priority ladder that decides what survives a pile-up.
 *
 * ── why a category is not just a volume ─────────────────────────────────────
 * The brief asks for two separate things that both key off the same grouping:
 * a per-category trim on the debug panel, and "상한 초과 시 낮은 우선순위
 * 사운드를 버린다 (예: 카드 사용음 > 뚜껑 충돌음)". Keeping them on one list
 * means the answer to "is a card louder than a collision" and the answer to
 * "which one is dropped" cannot drift apart.
 *
 * ── the order IS the ladder ────────────────────────────────────────────────
 * Later in the array outranks earlier. A sound's own definition may nudge its
 * priority either way, but the floor is its category's rank — so no amount of
 * per-sound tuning can make a cap collision outrank a goal.
 *
 *   AMBIENT  the continuous beds: sliding, the stun hum, the orb shimmer, the
 *            bottle being worked up. Quietest and first to go, because a bed
 *            that stops for a moment is not noticed and a bed that masks a hit is.
 *   IMPACT   collisions. The most numerous by an order of magnitude, which is
 *            exactly why they sit low: eight caps in a chain must never be able
 *            to push the card that was played out of earshot.
 *   DRAW     the mark editor's brush. Its own bus because it is the one sound
 *            in the game that fires continuously under the player's hand, and
 *            the brief singles it out as "과하면 극도로 피로하다".
 *   UI       hovers, clicks, screen changes.
 *   ORB      spawns, pickups, refusals.
 *   CARD     the hand, and the five effects.
 *   STINGER  goals, outs, wins, the transition. The things the match is about.
 */

/** @type {const} */
export const CATEGORY = {
  AMBIENT: 'ambient',
  IMPACT: 'impact',
  DRAW: 'draw',
  UI: 'ui',
  ORB: 'orb',
  CARD: 'card',
  STINGER: 'stinger',
};

/** Bus order, lowest priority first. See the header. */
export const CATEGORIES = [
  CATEGORY.AMBIENT,
  CATEGORY.IMPACT,
  CATEGORY.DRAW,
  CATEGORY.UI,
  CATEGORY.ORB,
  CATEGORY.CARD,
  CATEGORY.STINGER,
];

/** Korean labels, for the panel and the settings screen. */
export const CATEGORY_LABEL = {
  [CATEGORY.AMBIENT]: '지속음',
  [CATEGORY.IMPACT]: '충돌',
  [CATEGORY.DRAW]: '그리기',
  [CATEGORY.UI]: 'UI',
  [CATEGORY.ORB]: '오브',
  [CATEGORY.CARD]: '카드',
  [CATEGORY.STINGER]: '연출',
};

/** The floor a sound in this category may not rank below. */
export function categoryRank(category) {
  const at = CATEGORIES.indexOf(category);
  return at < 0 ? 0 : at;
}

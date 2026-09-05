/**
 * Whether to spend a card, and which.
 *
 * ── the six cards here are the six cards that EXIST ─────────────────────────
 * 궤적, 혼란, 원모어, 강타, 철벽, 침묵. Not 스왑 — that one is in `cardCatalog.SHELVED`
 * and is not in `CardHands.DRAWABLE`, so no orb can ever yield one and no hand
 * can ever hold one. Writing a judgment for it would be a rule for a card that
 * cannot be played, and the first person to read this file would reasonably
 * assume it could.
 *
 * 침묵 is the one that arrived in its place and it is the most interesting of
 * the five to judge, because its value is entirely about WHEN: sealing a hand
 * that is empty does nothing at all.
 *
 * ── "무조건 쓰지 마라. 아끼는 판단도 있어야 한다" ───────────────────────────
 * Every rule below is a threshold, not a preference. A card is played when the
 * position says it will pay, and held otherwise — so a hand that is never in the
 * right position never spends anything, which is correct play and not a bug. The
 * decision log records the holds as well as the plays, because "why did it not
 * use 강타 there" is the question that gets asked.
 *
 * ── it never asks whether it MAY ────────────────────────────────────────────
 * `Match.playCard` refuses through `cards.usable`, which is `canUseCard`, which
 * is the same predicate the human's hand greys itself with. This file filters on
 * exactly that call rather than reproducing the restrictions — 혼란 not stacking,
 * 궤적 refused under 혼란, 강타 and 원모어 not doubling, and the whole hand sealed
 * under 침묵. A second copy of those rules here would be a second rule book, and
 * the AI would eventually try to play something the game refuses.
 *
 * ── one card per CALL, not one per turn ────────────────────────────────────
 * `decideCard` returns at most one id, and the controller may call it again.
 * The brief did say one card per turn; "궤적 + 강타 조합도 사용" replaced that,
 * and the two cannot be chosen together in a single pass — whether the shot
 * needs 궤적 is a question about the shot 강타 produces, which does not exist
 * until 강타 has been played and the search has re-run. So the loop is
 * decide → play → replan → decide, and this function stays a judgment about
 * one position rather than a combination planner.
 *
 * `config.ai.cards.maxPerTurn` bounds it, and the reveals play in sequence
 * rather than overlapping, so a two-card turn is two full reveals long.
 */

/**
 * @typedef {object} CardSituation
 * @property {number} player
 * @property {{key: number, cardId: string}[]} hand
 * @property {(cardId: string) => {ok: boolean, reason?: string}} usable
 * @property {number} opponentHandCount
 * @property {number} myCaps          living caps I have
 * @property {number} foeCaps         living caps the opponent has
 * @property {number} bestScore       the search's best move, already evaluated
 * @property {number} secondScore     the next best. The gap is what "decisive" means.
 * @property {boolean} bestDropsCap   does the best move take an opponent off?
 * @property {boolean} bestRisksOwn   does it cost one of mine?
 * @property {number} myEdgeRisk      how exposed my caps are, 0..1-ish
 * @property {number} foeEdgeRisk     how exposed theirs are
 * @property {boolean} hasRobustKill  a kill that lands at BOTH cone edges — needs no card
 * @property {boolean} hasPrecisionKill  a kill down the middle that dies at the edges — 궤적 buys it
 * @property {boolean} boostOpensKill  with 강타 applied, a kill that lands across the whole cone
 * @property {boolean} boostOpensPrecisionKill  with 강타, a kill down the middle only — needs 궤적 too
 * @property {boolean} precise        궤적 is already active this turn
 * @property {object} tuning          `config.ai.cards`
 */

/**
 * @param {CardSituation} s
 * @returns {{cardId: string|null, log: {cardId: string, play: boolean, why: string}[]}}
 */
export function decideCard(s) {
  const t = s.tuning;
  const log = [];
  /** @type {{cardId: string, why: string, rank: number}[]} */
  const wants = [];

  const held = new Set(s.hand.map((c) => c.cardId));

  const consider = (cardId, rank, test) => {
    if (!held.has(cardId)) return;
    // The game's own answer, never a reimplementation of it. See the header.
    const allowed = s.usable(cardId);
    if (!allowed.ok) {
      log.push({ cardId, play: false, why: `사용 불가: ${allowed.reason ?? '규칙'}` });
      return;
    }
    const verdict = test();
    log.push({ cardId, play: verdict.play, why: verdict.why });
    if (verdict.play) wants.push({ cardId, why: verdict.why, rank });
  };

  /**
   * 강타 — hit harder, at the cost of a much wider cone.
   *
   * ── the search fires the boosted shot and looks ────────────────────────────
   * This used to be a threshold on `reachShortfall`, a proxy for "the target is
   * nearly in range". The proxy was measured and it was meaningless: it read how
   * close to the rim the nearest enemy was left STANDING, which is a fact about
   * the board rather than about any shot. With two caps parked near a corner it
   * sat at 0.068 at every range from 16 to 48 units — so the card was spent at
   * 40, 44 and 48, losing the shooter each time, and held at 24 through 36 where
   * it would have arrived. Exactly inverted.
   *
   * So the planner now re-fires the shortlisted attacks with 강타's own
   * multipliers applied, at the boosted cone's centre and both its edges, and
   * reports what it saw. The rule is the question itself: does this card open a
   * kill that does not otherwise exist?
   *
   *   `boostOpensKill`           — boosted, it lands across the whole cone.
   *   `boostOpensPrecisionKill`  — boosted, it lands only down the middle, so
   *                                it is worth playing ONLY if 궤적 can follow
   *                                and remove the cone. That pair is the
   *                                long-range finisher.
   *
   * Held when a kill already exists unboosted: the card would only widen the
   * cone on a shot that already works.
   *
   * Rank 0: it changes what the shot can DO, so it is decided before the cards
   * that only change what the AI knows.
   */
  consider('smash', 0, () => {
    if (s.hasRobustKill) {
      return { play: false, why: '이미 확실한 낙사수가 있음 — 오차만 커진다' };
    }
    if (s.boostOpensKill) {
      return { play: true, why: '강타면 낙사 사거리에 든다' };
    }
    if (s.boostOpensPrecisionKill) {
      // The reach is only worth buying if the accuracy to use it is also for
      // sale. `usable` rather than mere possession — 궤적 is refused under 혼란,
      // and buying reach that cannot be aimed is how the AI killed itself.
      const canFollow = held.has('trajectory') && s.usable('trajectory').ok && !s.precise;
      return canFollow
        ? { play: true, why: '강타로 닿고 궤적으로 맞힌다 — 조합' }
        : { play: false, why: '강타로 닿아도 오차가 커서 못 맞힌다 (궤적 없음)' };
    }
    return { play: false, why: '강타로도 낙사가 열리지 않는다' };
  });

  /**
   * 원모어 — an extra turn after this one.
   *
   * Worth it when this turn is already good and the follow-up compounds: a shot
   * that drops a cap and leaves the AI ahead means the second turn is taken
   * against a thinner board. Held when the turn is a retreat, because banking an
   * extra go at a position you are trying to get out of is a card spent to move
   * twice in the wrong direction.
   */
  consider('onemore', 1, () => {
    if (s.bestRisksOwn) {
      return { play: false, why: '이번 수가 자기 뚜껑을 잃는다 — 연속으로 둘 수가 아님' };
    }
    if (!s.bestDropsCap && s.bestScore < t.oneMoreMinScore) {
      return { play: false, why: `이번 수의 이득이 작다 (${s.bestScore.toFixed(0)})` };
    }
    return { play: true, why: s.bestDropsCap ? '낙사수 뒤 연속 공격' : '유리한 수를 두 번' };
  });

  /**
   * 궤적 — a long, exact preview of this shot.
   *
   * ── the card sells the CONE, and that is worth a great deal ────────────────
   * It was written off here as "information the AI already has", on the grounds
   * that the search simulates its own shot anyway. That was wrong, and
   * `predict.js` says why in as many words: the preview draws the deviated path,
   * so a player who reads it "would let them aim off to cancel it, WHICH IS THE
   * SAME AS HAVING NO ERROR AT ALL". For one turn the cone stops existing.
   *
   * Which makes it the answer to one specific and very valuable position: a kill
   * that exists down the middle of the cone and dies at its edges. The search
   * reports exactly that as `hasPrecisionKill` — the shot lands if and only if
   * the draw is known. Without the card such a shot is a gamble the evaluator
   * correctly refuses; with it, it is a certainty.
   *
   * So this is no longer a knife-edge tiebreak. It is played whenever precision
   * is the only thing standing between the AI and a cap, at any range — which is
   * what "아무리 멀리있어도 궤적으로 죽일 수 있으면 죽이고" asks for. Combined with
   * 강타 it is the long-range finisher: 강타 supplies the reach, 궤적 removes the
   * spread that reach costs.
   *
   * Held when a kill already survives its own cone — there is nothing to buy.
   */
  consider('trajectory', 1, () => {
    if (s.precise) return { play: false, why: '이미 궤적이 켜져 있음' };
    if (s.hasRobustKill) {
      return { play: false, why: '오차와 무관하게 이미 낙사수가 있음 — 아껴둔다' };
    }
    if (!s.hasPrecisionKill) {
      return { play: false, why: '정확도로 열리는 낙사수가 없음' };
    }
    return { play: true, why: '오차만 없으면 낙사 — 궤적으로 확정' };
  });

  /**
   * 혼란 — twist the opponent's next shot.
   *
   * Cast when the opponent is in a position to hurt: their caps well placed and
   * mine exposed. Deviating a shot that was going nowhere is a card thrown away,
   * which is why this reads the BOARD rather than simply firing whenever it is
   * legal.
   *
   * Rank 2 — it acts on the opponent's turn rather than this one, so a card that
   * improves this shot goes first.
   */
  consider('chaos', 2, () => {
    if (s.foeCaps === 0) return { play: false, why: '상대에게 남은 뚜껑이 없다' };
    const threat = s.myEdgeRisk - s.foeEdgeRisk;
    if (threat < t.chaosThreatMin) {
      return { play: false, why: `상대가 유리한 상황이 아니다 (위협 ${threat.toFixed(2)})` };
    }
    return { play: true, why: `상대가 유리 — 다음 발사를 흐트러뜨린다 (위협 ${threat.toFixed(2)})` };
  });

  /**
   * 철벽 — brace my own caps against the opponent's reply.
   *
   * ── the only card here judged on MY position rather than on my SHOT ────────
   * 강타 and 궤적 are decided by simulating the shot about to be taken. 혼란 and
   * 침묵 are decided by what the opponent can do next. This one is decided by
   * where my own caps are standing, which is a question none of the other four
   * asks — and it is the whole of the card's value, because a brace is worth
   * exactly as much as the shove it prevents.
   *
   * ── a cap in the middle of the board cannot be pushed off ──────────────────
   * That is why the threshold is on exposure and not simply "am I under
   * threat". Being shoved is only fatal near the brink; a cap in the middle
   * takes the same hit, travels the same distance, and is still on the board.
   * Playing the card there spends it to prevent an outcome that was not going
   * to happen, which is the failure mode the header calls "무조건 쓰지 마라".
   *
   * `myEdgeRisk` is the worst of my caps rather than the average, deliberately:
   * a brace covers every cap I own, so what it is worth is set by the one that
   * is actually in danger. Averaging would let three safe caps talk the AI out
   * of saving the fourth.
   *
   * ── it reads the same in football, which is why the field is shared ────────
   * There `myEdgeRisk` is the pressure on my NET, and the rule comes out as
   * "brace when they are close to scoring" — which is when my caps being shoved
   * out of the lane is what loses the goal. The scales differ, so the threshold
   * is overridden per mode; see `config.ai.football.cards`.
   *
   * Rank 2, with 혼란 and 침묵: like those two it acts on the opponent's turn, so
   * a card that improves THIS shot is decided first.
   */
  consider('resist', 2, () => {
    if (s.myCaps === 0) return { play: false, why: '지킬 뚜껑이 없다' };
    if (s.foeCaps === 0) return { play: false, why: '상대에게 남은 뚜껑이 없다 — 밀 사람이 없다' };
    if (s.myEdgeRisk < t.resistEdgeMin) {
      return {
        play: false,
        why: `내 뚜껑이 판 안쪽에 있다 (노출 ${s.myEdgeRisk.toFixed(2)}) — 밀려도 죽지 않는다`,
      };
    }
    return {
      play: true,
      why: `가장자리에 몰려 있다 (노출 ${s.myEdgeRisk.toFixed(2)}) — 다음 발사를 버틴다`,
    };
  });

  /**
   * 침묵 — seal the opponent's hand for their next turn.
   *
   * ── the brief does not cover this card, so the rule is stated here ────────
   * It was written when 스왑 was the fifth card; 침묵 replaced it. Its value is
   * entirely a function of what the opponent is holding — sealing an empty hand
   * is a card spent for literally nothing, and sealing a full one denies a whole
   * turn of options. So the threshold is a card COUNT, which is information the
   * AI legitimately has: hand sizes are visible to both players, which is why the
   * brief has the AI's own count visible too.
   *
   * Second condition: it is worth more when the opponent has something to answer
   * WITH — i.e. when the AI is ahead and they need a card to change that.
   */
  consider('silence', 2, () => {
    if (s.opponentHandCount < t.silenceMinCards) {
      return {
        play: false,
        why: `상대 손패가 ${s.opponentHandCount}장뿐 — 봉인 가치가 없다`,
      };
    }
    return { play: true, why: `상대 손패 ${s.opponentHandCount}장 봉인` };
  });

  if (!wants.length) return { cardId: null, log };

  // One card per call, and the ranking is the tie-break rather than hand order —
  // which the player controls by dragging, and must not be able to steer the AI
  // with. The rest are not refused, only deferred: the controller replans and
  // asks again, and a card that still pays after the first one is played is the
  // second half of a combination.
  wants.sort((a, b) => a.rank - b.rank);
  const chosen = wants[0];
  for (const w of wants) {
    if (w === chosen) continue;
    log.push({ cardId: w.cardId, play: false, why: '이번 판단에서는 보류 — 다시 계산 후 재고' });
  }
  return { cardId: chosen.cardId, log };
}

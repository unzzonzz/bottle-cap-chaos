import { evaluateFootball, footballPreTurn, pressureOn, restingPlace } from './footballEvaluate.js';
import { footballCandidates } from './footballCandidates.js';
import { registerStrategy } from './strategy.js';

/**
 * 알까기 축구, behind the `AiStrategy` interface.
 *
 * ── the context is where the pitch lives ────────────────────────────────────
 * Survival's context carries `safeRadius` and a threat model built out of "how
 * much board is behind you". None of that exists here: the pitch is fenced,
 * nothing is ever eliminated, and `alive` is all true for the whole match — see
 * `FootballRules`. What this mode's evaluator needs instead is geometry, and it
 * is gathered once per turn and handed round:
 *
 *   `goals`     where each player's NET is, indexed by the player who DEFENDS
 *               it. Read off the layout's own metrics rather than guessed, so a
 *               resized pitch moves them and nothing here knows which end is
 *               which. (`FootballPitch._buildGoal`: defender 0 is at −Z.)
 *   `ball`      where the ball is BEFORE the shot. The evaluator's whole
 *               gradient is a delta against this.
 *   `metrics`   for `findRespawn`, so a ball that goes out is scored where it
 *               will actually be put back.
 *   `pitch`     the distances the threat terms measure with, in world units.
 *
 * ── nothing in here reads `alive`, and that is on purpose ──────────────────
 * `livingCapsOf` in this mode is just "that player's caps". A generator that
 * filtered on `alive` would work today and would be a lie about why, so the
 * filters are on `capOwner` and the trap in §11.8 cannot be walked into.
 */

/** @type {import('./strategy.js').AiStrategy} */
export const footballStrategy = {
  id: 'football',

  buildContext({ player, arena, config, tuning, precise }) {
    const cfg = tuning;
    const m = arena.layout.metrics;

    const before = [];
    for (let i = 0; i < arena.capCount; i++) {
      const c = arena.capCom(i);
      before.push({ x: c.x, y: c.y, z: c.z });
    }
    const b = arena.ballCom();

    return {
      player,
      capOwner: arena.capOwner.slice(),
      before,
      /** Where the ball starts. Never null in this mode — the layout has one. */
      ball: b ? { x: b.x, z: b.z } : { x: 0, z: 0 },
      capRadius: arena.desc.radius,
      ballRadius: arena.ballRadius,
      /**
       * Indexed by DEFENDER, matching `layout.goalSensorOf`. Player 0's net is
       * at −Z; the sign is the layout's and is not restated as a literal
       * anywhere in the search.
       */
      goals: [
        { x: 0, z: -m.halfZ },
        { x: 0, z: m.halfZ },
      ],
      goalHalfWidth: m.goalHalfWidth,
      halfX: m.halfX,
      halfZ: m.halfZ,
      metrics: m,
      respawnCfg: config.respawn,
      weights: cfg.weights,
      pitch: cfg.pitch,
      precise,
    };
  },

  preTurn(ctx) {
    return footballPreTurn(ctx);
  },

  candidates({ ctx, orbs, preTurn, sampling }) {
    return footballCandidates({ ctx, orbs, preTurn, sampling });
  },

  evaluate(result, ctx) {
    return evaluateFootball(result, ctx);
  },

  /**
   * The board this shot leaves, seen from the other seat.
   *
   * Two things move and `alive` is not one of them. The caps go to where they
   * came to rest, and — the part that is easy to forget and silent when wrong —
   * so does the BALL. Planning the opponent's answer against a ball that has not
   * moved yet would have the reply search aim every candidate at the centre spot
   * while the ball sits in a corner.
   *
   * Null after a goal: `resolveTurn` sets `resetField`, so the position this
   * would describe is about to be swept away and replaced with the kickoff
   * formation. There is no reply to search for.
   */
  replyContext(ctx, result) {
    if (result.goalConceded >= 0) return null;
    // Where it will be PUT BACK, not where it stopped — the same function the
    // evaluator scores with and the same one the rules will call. See
    // `restingPlace`.
    const b = restingPlace(result, ctx);
    return { ...ctx, player: 1 - ctx.player, before: result.pos, ball: { x: b.x, z: b.z } };
  },

  hasReply(replyCtx) {
    return !!replyCtx;
  },

  /**
   * Only the GOALS come off the score, never the reply's whole value.
   *
   * The survival file records what subtracting the full reply did there — zero
   * caps taken across five matches, because after any committal move the
   * opponent has some decent answer, so every attack was penalised and standing
   * still was not. The football version of that failure is worse: subtract their
   * `ballAdvance` and every shot that leaves the ball anywhere reachable is
   * penalised, so the AI's best move becomes not touching the ball at all. It
   * would look exactly like the failure this mode is most prone to.
   *
   * A goal against is nearly binary and a handful of reply candidates estimate
   * it well, which is the same property that makes kills the right thing to
   * count next door.
   */
  replyPenalty(terms) {
    return terms.goal;
  },

  /** What one unit of that penalty costs me on the first ply's scale. */
  replyUnit(weights) {
    return weights.ownGoal;
  },

  /**
   * The NET a card rule is allowed to call "a kill".
   *
   * Goals for minus goals against, so `cardPolicy` needs no football branch:
   * "does this card open a kill I cannot otherwise get" reads as "does it open a
   * GOAL", and a shot that scores at one end and concedes at the other reads 0
   * and buys nothing. Same arithmetic, same reason — see `survivalStrategy`.
   *
   * It is deliberately NOT widened to "meaningful progress". A card spent on
   * advancing the ball would be a card spent every single turn, which is the
   * "무조건 쓰지 마라" the policy exists to refuse.
   */
  netGain(terms) {
    return terms.goal - terms.ownGoal;
  },

  /** Which candidates are worth re-firing as 강타 would fire them. */
  isAttack(candidate) {
    return /^(ball|shoot|clear)/.test(candidate.intent);
  },

  situation({ ctx, scored, precise, tuning, extra }) {
    const best = scored[0];
    const second = scored[1] ?? best;

    let myCaps = 0;
    let foeCaps = 0;
    for (let i = 0; i < ctx.capOwner.length; i++) {
      if (ctx.capOwner[i] === ctx.player) myCaps++;
      else foeCaps++;
    }

    /**
     * ── the five cards are the same five, so the FIELDS are the same fields ──
     * `decideCard` is untouched and knows nothing about football. What it reads
     * are questions like "is a kill available", "is the opponent in a position
     * to hurt me", "is this turn worth taking twice" — and every one of those
     * has a football answer. The mapping is stated here, once:
     *
     *   bestDropsCap / bestRisksOwn   a goal / an own goal
     *   myEdgeRisk / foeEdgeRisk      how much danger each NET is in, from the
     *                                 same `goalThreat` the evaluator scores
     *                                 with. 혼란's rule then reads "they are
     *                                 closer to scoring than I am", which is
     *                                 what that card is for in this mode.
     *   hasRobustKill etc.            a GOAL that survives its own cone. The
     *                                 planner's probe machinery produces these
     *                                 from `netGain`, so 강타 and 궤적 are
     *                                 decided by simulating the boosted shot
     *                                 rather than by a threshold — see
     *                                 `cardPolicy`, which argues at length why
     *                                 a proxy for that was measured to be
     *                                 inverted.
     */
    return {
      player: ctx.player,
      myCaps,
      foeCaps,
      bestScore: best.score,
      secondScore: second.score,
      bestDropsCap: best.terms.goal > 0,
      bestRisksOwn: best.terms.ownGoal > 0,
      myEdgeRisk: pressureOn(ctx.player, ctx),
      foeEdgeRisk: pressureOn(1 - ctx.player, ctx),
      boostOpensKill: scored.some((e) => (e.boostRobust ?? 0) > 0),
      boostOpensPrecisionKill: scored.some(
        (e) => (e.boostBlind ?? 0) > 0 && (e.boostRobust ?? 1) <= 0,
      ),
      // Unprobed reads 0 — unknown, not robust. The reasoning is survival's and
      // is written out there; it fails safe in the direction of spending a card
      // that was not strictly needed rather than refusing the one that wins.
      hasRobustKill: scored.some(
        (e) => (e.robustKills ?? (precise ? e.terms.goal - e.terms.ownGoal : 0)) > 0,
      ),
      hasPrecisionKill: scored.some(
        (e) => (e.blindKills ?? e.terms.goal - e.terms.ownGoal) > 0 && (e.robustKills ?? 1) <= 0,
      ),
      precise,
      tuning,
      /**
       * Football's `meta.foeEdgeMax`: how close the best shot got the ball to
       * their net. 0 means it went in, small means it nearly did, large means it
       * was never going to reach. `decideCard` does not read it — 강타 is decided
       * by simulating the boosted shot, which strictly dominates any threshold
       * on this — but the panel does, and it is the number to look at first when
       * the AI does something inexplicable near a goal.
       */
      ballGoalGap: best.meta?.ballGoalGap ?? null,
      ballTouched: !!best.meta?.ballTouched,
      ...extra,
    };
  },
};

registerStrategy(footballStrategy);

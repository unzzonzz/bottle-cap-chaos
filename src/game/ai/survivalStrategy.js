import { dangerMap, evaluateSurvival, exposureOf } from './evaluate.js';
import { survivalCandidates } from './candidates.js';
import { registerStrategy } from './strategy.js';

/**
 * Knockout, behind the `AiStrategy` interface.
 *
 * ── this file adds nothing and decides nothing ──────────────────────────────
 * Every line of judgement is still in `evaluate.js` and `candidates.js`, where
 * it was measured and where its reasons are written down. This is the adapter
 * that lets `AiPlanner` reach them without importing them by name — the
 * arguments it assembles are the arguments the planner used to assemble inline,
 * in the same order, from the same fields.
 *
 * That is worth stating plainly because it is the completion criterion for the
 * refactor, and it was checked rather than asserted. `tools/determinism/
 * ai-harness.mjs` plays the AI against itself and digests every decision it
 * makes, so a weight that moved or a candidate that got truncated one place
 * earlier shows up — none of which `harness.mjs` can see, because a recorded
 * input log has already decided what to play. Thirty AI-vs-AI turns from the
 * knockout fixture, run against the planner before this file existed and again
 * after:
 *
 *     before   digest=2b19511a  final=ca2f3be5   30 turns
 *     after    digest=2b19511a  final=ca2f3be5   30 turns
 *
 * Same moves, same board, and `npm run det:node`'s three fixtures unmoved at
 * a58b162c / c767e52d / fd87a7c8. A strategy that "tidied" a weight on the way
 * past would be a change to the game wearing a refactor's clothes, and this is
 * the measurement that would have caught it.
 *
 * Those three are a record of THAT check and are deliberately not updated as
 * the fixtures move. Football's is now afaddf2e: 철벽 made the draw pool six, so
 * the regenerated log plays a different card at one turn. The knockout and
 * curling figures still reproduce.
 *
 * ── what is survival-shaped here, and would not port ────────────────────────
 * Almost all of it, which is the point:
 *
 *   `safeRadius`   the line a cap falls off. Football has a fence and no fall.
 *   `threat`       reach and push distance — "can somebody shove you over".
 *   `alive`        a cap can be removed. In football it never is.
 *   `replyPenalty` counts the caps the opponent takes in their answer.
 *
 * Football's context has none of those and carries goal mouths instead. Neither
 * strategy can see the other's fields, because the planner passes the context
 * through opaquely — see `strategy.js`.
 */

/**
 * Which of a player's caps may fire, and which caps they may aim at.
 *
 * Lifted verbatim out of `AiPlanner.begin`, where it read the rules' `alive`
 * flags directly. It lives here now because "who can shoot" is a rule, and the
 * rule differs: this mode loses caps and football does not.
 */
function sides(ctx) {
  const shooters = [];
  const opponents = [];
  for (let i = 0; i < ctx.capOwner.length; i++) {
    if (!ctx.alive[i]) continue;
    if (ctx.capOwner[i] === ctx.player) shooters.push(i);
    else opponents.push(i);
  }
  return { shooters, opponents };
}

/** @type {import('./strategy.js').AiStrategy} */
export const survivalStrategy = {
  id: 'knockout',

  buildContext({ player, arena, rules, tuning, precise }) {
    const cfg = tuning;
    const before = [];
    for (let i = 0; i < arena.capCount; i++) {
      const c = arena.capCom(i);
      before.push({ x: c.x, y: c.y, z: c.z });
    }

    /**
     * Where the brink is.
     *
     * `layout.extents` is the outer edge the camera has to frame — board half
     * plus shelf plus slope — which is the line a cap genuinely falls off, not
     * the old painted out line. Read off the layout so a resized board moves it
     * without this file knowing the board is square.
     */
    const extents = arena.layout.extents;
    const safeRadius = Math.max(1e-3, Math.min(extents.x, extents.z));

    return {
      player,
      capOwner: arena.capOwner.slice(),
      alive: rules.alive.slice(),
      before,
      safeRadius,
      capRadius: arena.desc.radius,
      weights: cfg.weights,
      precise,
      /**
       * The geometry the threat model measures with. Absolute world units, so
       * they are read against `arena.desc.radius` and the board's own size
       * rather than being fractions of something.
       */
      threat: {
        reach: cfg.threat.reach,
        pushDistance: cfg.threat.pushDistance,
      },
      /**
       * Each cap's mass multiplier, so the threat model can be told which caps
       * are braced. 1 for everything on a board with no 철벽 on it.
       *
       * ── read off the WORLD, and that is what makes it work both ways ───────
       * `capMassMul` asks the body. So a brace the HUMAN played is already in
       * the arena by the time this runs — `Match._syncCapMass` puts it there
       * before the turn's snapshot is taken — and the AI answers the opponent's
       * card without anything here knowing whose card it was. Reading
       * `CardEffects` instead would have needed the caster and the beneficiary
       * kept straight, and would have been a second copy of §2-A's own rule
       * about when the brace is live.
       *
       * The ROLLOUTS need none of this: they restore the same snapshot into a
       * real Rapier world, and mass rides along in the bytes. What is corrected
       * here is only the closed-form summary — `dangerMap` and the two threat
       * terms — which is the part that never runs a solver.
       */
      massMul: Array.from({ length: arena.capCount }, (_, i) => arena.capMassMul(i)),
    };
  },

  /**
   * Which of my caps are already in trouble, so the generator can aim them
   * somewhere safer rather than hoping a centre-ward shot helps.
   *
   * Computed once per turn rather than per candidate: it describes the board
   * the AI is looking at, not any particular move.
   */
  preTurn(ctx) {
    return dangerMap(ctx.player, ctx);
  },

  candidates({ ctx, orbs, preTurn, sampling }) {
    const { shooters, opponents } = sides(ctx);
    return survivalCandidates({
      player: ctx.player,
      shooters,
      comOf: (i) => ctx.before[i],
      opponents,
      orbs,
      danger: preTurn,
      capRadius: ctx.capRadius,
      safeRadius: ctx.safeRadius,
      sampling,
    });
  },

  evaluate(result, ctx) {
    return evaluateSurvival(result, ctx);
  },

  /**
   * The opponent's answer, as a board rather than as a score.
   *
   * `alive` has to be recomputed because this mode REMOVES caps: a cap this
   * shot pushed off cannot shoot in the reply and cannot be aimed at. `before`
   * moves to where the shot left everything. Football overrides this to carry
   * the ball instead, and keeps `alive` untouched because nothing is ever out.
   */
  replyContext(ctx, result) {
    const foe = 1 - ctx.player;
    const alive = ctx.alive.map((a, i) => a && !result.out[i]);
    return { ...ctx, player: foe, alive, before: result.pos };
  },

  /**
   * Is there a reply worth generating at all?
   *
   * A side with nothing left to shoot, or nothing left to shoot at, has no
   * answer to search — and `survivalCandidates` handed an empty target list
   * produces only retreats, which would price the reply as harmless when the
   * real reason is that the match is already decided.
   */
  hasReply(replyCtx) {
    // Null-safe because the interface allows `replyContext` to refuse — football
    // does, after a goal, since the field is about to be reset. This mode never
    // returns null, and the guard is here so the two implementations answer the
    // same shape of question rather than one of them being special.
    if (!replyCtx) return false;
    const { shooters, opponents } = sides(replyCtx);
    return shooters.length > 0 && opponents.length > 0;
  },

  /**
   * Only the KILLS come off the score, never the reply's whole value.
   *
   * The full-subtraction version turtled the AI to zero caps taken across five
   * matches — see `AiPlanner._applySamples` and `config.ai.replyWeight`, where
   * the numbers are. This is that decision, expressed as one function so
   * football can name its own equivalent without re-arguing it.
   */
  replyPenalty(terms) {
    return terms.dropOpponent;
  },

  /** What one unit of that penalty is worth on the first ply's scale. */
  replyUnit(weights) {
    return weights.loseOwn;
  },

  /**
   * The NET a card rule is allowed to call "a kill".
   *
   * Opponent caps minus my own, not a raw count: a shot that takes one and
   * throws one away reads 0 and buys no card. See `AiPlanner._applyProbes`,
   * where spending 강타 and 궤적 to reach a 1-for-1 trade is recorded as the bug
   * this arithmetic fixed.
   */
  netGain(terms) {
    return terms.dropOpponent - terms.loseOwn;
  },

  /** Which candidates are worth re-firing as 강타 would fire them. */
  isAttack(candidate) {
    return /^(attack|drive):/.test(candidate.intent);
  },

  situation({ ctx, scored, precise, tuning, extra }) {
    const best = scored[0];
    const second = scored[1] ?? best;

    let myCaps = 0;
    let foeCaps = 0;
    for (let i = 0; i < ctx.capOwner.length; i++) {
      if (!ctx.alive[i]) continue;
      if (ctx.capOwner[i] === ctx.player) myCaps++;
      else foeCaps++;
    }

    return {
      player: ctx.player,
      myCaps,
      foeCaps,
      bestScore: best.score,
      secondScore: second.score,
      bestDropsCap: best.terms.dropOpponent > 0,
      bestRisksOwn: best.terms.loseOwn > 0,
      myEdgeRisk: exposureOf(ctx.player, ctx),
      foeEdgeRisk: exposureOf(1 - ctx.player, ctx),
      /**
       * ── what 강타 would actually buy, simulated ───────────────────────────
       * `boostOpensKill`: some shortlisted attack kills at the boosted cone's
       * centre AND both its edges — 강타 alone is enough.
       *
       * `boostOpensPrecisionKill`: it kills down the boosted cone's middle but
       * not at its edges — 강타 supplies the reach, and only 궤적 makes the
       * reach landable. That pair IS the long-range finisher.
       *
       * Both are false when 강타 is already in effect, since the shortlist is
       * then already boosted and probing it again would recommend a second copy
       * of a card that does not stack.
       */
      boostOpensKill: scored.some((e) => (e.boostRobust ?? 0) > 0),
      boostOpensPrecisionKill: scored.some(
        (e) => (e.boostBlind ?? 0) > 0 && (e.boostRobust ?? 1) <= 0,
      ),
      /**
       * ── the two facts the card decisions actually turn on ─────────────────
       * A kill either survives its own cone or it does not, and that difference
       * is exactly what 궤적 sells. `robustKills` is the net at the cone's edges;
       * `blindKills` is the net down the middle. A candidate that wins blind but
       * not robustly is a shot the AI can land only if it knows its draw — which
       * is the card, precisely.
       *
       * Both are NETS, not kill counts — see `AiPlanner._applyProbes`. A cap
       * traded for a cap reads 0 and buys nothing, which is why the AI no longer
       * spends two cards to reach a move it has already scored as losing.
       *
       * ── only a PROBED candidate may claim to be robust ──────────────────────
       * `spreadPool` is 12 and `scored` holds up to `maxCandidates` — 64 — so
       * ranks 13 and below never get `robustKills` at all. This fell back to the
       * blind net for those, which is the stage-1 result fired with the cone
       * switched off: it says the shot lands down the middle and says nothing
       * whatever about the edges. So an unprobed candidate could assert "a kill
       * that needs no card", and since BOTH card rules hold on this flag, one
       * such candidate at rank 13 vetoed the entire 강타+궤적 combo while the
       * shot actually fired was a probed, fragile one.
       *
       * Unprobed now reads 0 — unknown, not robust — which is the direction that
       * fails safe: the AI may spend a card it did not strictly need, rather than
       * refuse the one that wins. Under 궤적 the fallback is the blind net again,
       * and correctly so: the card removes the cone, so the centre sample IS the
       * whole story and there are no edges left to survive.
       */
      hasRobustKill: scored.some(
        (e) => (e.robustKills ?? (precise ? e.terms.dropOpponent - e.terms.loseOwn : 0)) > 0,
      ),
      hasPrecisionKill: scored.some(
        (e) =>
          (e.blindKills ?? e.terms.dropOpponent - e.terms.loseOwn) > 0 && (e.robustKills ?? 1) <= 0,
      ),
      /** Already planning with 궤적 in hand, so it cannot be the answer again. */
      precise,
      tuning,
      ...extra,
    };
  },
};

registerStrategy(survivalStrategy);

import { findRespawn } from '../layout/respawn.js';

/**
 * What a pitch is worth, from one player's seat.
 *
 * ── the gradient problem is the same one, and it is much worse here ─────────
 * `evaluate.js` records why survival could not be scored on kills alone:
 *
 *     `dropOpponent` is all or nothing, so shoving a cap to within a hair of
 *     the edge scored exactly the same zero as missing it entirely. So there
 *     was never a reason to attack unless the kill landed this turn, and
 *     "retreat to the middle" won every other position by default.
 *
 * A goal is rarer than a kill by a wide margin. Measured on this pitch, 768
 * shots fanned from the kickoff scored zero, and the best single strike moves
 * the ball 31 units against a goal line 32 away — so from the centre spot a goal
 * is not merely unlikely, it is unreachable. An evaluator built on `goal` would
 * return the identical number for every candidate in most positions, and the AI
 * would pick whichever one the tie-break happened to favour. Not "play badly" —
 * play ARBITRARILY, which is worse and looks like a bug.
 *
 * So `ballAdvance` is the spine of this file. Everything else adjusts it.
 *
 * ── and it does discriminate, which was checked rather than assumed ─────────
 * A gradient is only worth having if candidates actually come out different.
 * Measured on one mid-match position, the shipped 64-candidate list scored and
 * sorted:
 *
 *     64 candidates -> 62 DISTINCT scores, range -78.8 .. 2600.0
 *
 *     2600.0  shoot:l  pow 0.61   [goal 1.00]
 *      278.3  shoot:l  pow 0.61   [ballAdvance 21.15  ballThreat 0.23]
 *      258.5  ball     pow 0.42   [ballAdvance 19.72  ballThreat 0.21  support 0.02]
 *        ...
 *      -78.8  ball     pow 0.80   [ballRetreat 5.31  support 0.09]
 *
 * Two ties in sixty-four, a goal found and ranked first by a factor of nine over
 * the best non-scoring move, and the shots that shove the ball back toward my
 * own end correctly scoring NEGATIVE. That is the property `goal` alone could
 * not have: without `ballAdvance` every row but the first would read 0.00 and
 * the move played would be whichever one the tie-break reached.
 *
 * ── the terms are NOT folded together ──────────────────────────────────────
 * `goal` and `ownGoal` are the pair `dropOpponent` and `loseOwn` are next door,
 * and they are kept apart for the identical reason: a search willing to trade a
 * goal for an own goal plays a completely different game from one that is not.
 * `ownGoal` is the heavier of the two and the asymmetry is real rather than
 * taste — conceding hands over the score AND the kickoff (`_kickoffBy`), so the
 * opponent gets the next move as well. A goal for and a goal against are not
 * mirror images of each other.
 *
 * The same goes for `ballAdvance` and `ballRetreat`, which are two measurements
 * and not one signed number: they are distances to DIFFERENT goals, and a ball
 * shoved sideways across the halfway line scores near zero on both, which is the
 * truth about that move.
 *
 * ── what it actually plays like, measured ──────────────────────────────────
 * Four AI-vs-AI matches from fixed seeds, 148 turns in total
 * (`npm run det:ai:stats`):
 *
 *     goals                    9   (0.061 a turn — a goal every ~16 turns)
 *     own goals                0   (0.0% of goals)
 *     turns that moved the ball    79.7%
 *     ball advance             +7.59 units a turn, toward the net being attacked
 *     turns that pushed it the wrong way   16.9%
 *     cards played            11
 *
 * The own-goal column is the one worth dwelling on. It is zero across every run,
 * which is what `ownGoal` being the heaviest weight in the file buys — and the
 * risk is real rather than theoretical: the very first scoring shots found
 * during development were own goals, a full-power clearance from a ball sitting
 * on the opponent's line travelling 66 units back down the pitch and in. See
 * `rollout.js`, where two of them are recorded as accuracy fixtures.
 *
 * `ballAdvance` being positive on every seed is the other one. It is the whole
 * claim of this file — that a mode where a goal is a two-turn object can still
 * be searched one turn at a time — and a negative number there would mean the
 * gradient pointed the wrong way while every other statistic looked busy.
 *
 * ── and it finishes matches, from either end ───────────────────────────────
 * Run to `football.winningGoals` rather than to a turn cap:
 *
 *     seed 5e6f7a8b   28 turns   0–3   own goals 0
 *     seed 11117777   51 turns   3–1   own goals 0
 *
 * Both won, one by each side, in 28 and 51 turns. That is the shortest available
 * statement that this evaluator plays football rather than merely produces
 * plausible-looking numbers: a search that could not finish would stall at 0–0
 * for as many turns as it was given, and 0/768 shots score from a standing
 * start.
 *
 * ── the SCORELINE is deliberately not in here ──────────────────────────────
 * Whether to make the AI play differently when it is three goals down was left
 * open, and the answer is no. Two reasons, and the second is the real one.
 *
 * It would need a term nothing else in the project has: every weight here prices
 * a fact about the BOARD, and "I am losing" is a fact about the match. Mixing
 * the two means the same position scores differently at 0–0 and 0–3, so the
 * panel's `terms` stop explaining the move — which is the one thing they are
 * for.
 *
 * And the behaviour it would buy is not obviously right. A side three down with
 * `winningGoals` to reach does need to take more risk, but "more risk" in this
 * mode means shooting from further out and leaving the net open, which is
 * exactly the play `goalUncovered` exists to refuse. Encoding desperation would
 * mean deciding how much of that refusal to switch off, and there is no
 * measurement to set that dial against — an AI that abandons its goal when
 * behind loses by more, and nothing here can tell whether losing by more is
 * worse than losing.
 *
 * If it is ever wanted it belongs as its OWN term, read off `rules.score`
 * through the context, and never folded into the weights above.
 *
 * ── it takes a RESULT, not a world ─────────────────────────────────────────
 * Positions in, numbers out. Nothing here knows what Rapier is and nothing here
 * can step anything, which is what lets the same planner run both modes.
 */

/**
 * How exposed something is, as `near x aligned`.
 *
 * ── the same product `threatOn` uses, and deliberately so ──────────────────
 * `evaluate.js` argues it at length: a threat needs BOTH halves, because either
 * one at zero means no threat. An attacker who cannot reach cannot do anything
 * however well lined up, and an attacker with no line has nothing to do however
 * close. Multiplied, never summed.
 *
 * What could not be shared is the geometry inside it. Survival's `exitDistance`
 * asks "how much board is left behind you before you fall off", and this mode
 * has a fence and no fall — the football question is "how far is the ball from
 * my net", which is a distance to a point rather than a ray-square intersection.
 * So the shape is imported and the measurement is not, and that is stated here
 * so the two cannot silently become two different ideas of danger.
 *
 * @param {{x: number, z: number}} ball    where the ball is
 * @param {{x: number, z: number}} goal    the net it would be driven into
 * @param {{x: number, z: number}[]} strikers  the caps that could drive it
 * @param {{reach: number, strikeRange: number}} cfg
 */
function goalThreat(ball, goal, strikers, cfg) {
  const reach = Math.max(1e-3, cfg.reach);
  const range = Math.max(1e-3, cfg.strikeRange);

  // NEAR, in the ball's own terms: a ball further from the net than one good
  // strike carries it cannot be put in from here whoever is standing behind it.
  const gap = Math.hypot(ball.x - goal.x, ball.z - goal.z);
  const near = 1 - Math.min(1, gap / range);
  if (near <= 0) return 0;

  // ALIGNED: somebody close enough to arrive, standing on the far side of the
  // ball from the goal. Worst case over the strikers, not the sum — two
  // attackers do not make a ball twice as likely to go in, and summing would
  // make a crowd at range read as more dangerous than one lined up on it.
  const gx = goal.x - ball.x;
  const gz = goal.z - ball.z;
  const glen = Math.hypot(gx, gz) || 1;
  let worst = 0;
  for (const s of strikers) {
    const dx = ball.x - s.x;
    const dz = ball.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3 || d > reach) continue;
    const arrive = 1 - d / reach;
    // The cosine between "my approach" and "the way to the goal". Negative means
    // the striker is on the wrong side and would knock it further away.
    const dot = (dx / d) * (gx / glen) + (dz / d) * (gz / glen);
    const t = arrive * Math.max(0, dot);
    if (t > worst) worst = t;
  }
  return near * worst;
}

/**
 * How much of the line from my net to the ball nobody of mine is standing in.
 *
 * ── the football-only term, and it is what makes the AI defend ─────────────
 * There is no survival counterpart. Survival's defensive question is "can this
 * cap be pushed off", which is answered per cap; this one is answered about a
 * PLACE — the mouth of my goal — and it stays true whether or not any particular
 * cap is in trouble.
 *
 * It is a product like the one above: how much danger there is to cover
 * (`exposure`, the ball being near enough to my net to matter) times how little
 * of it is covered. A goal nobody is guarding is free only when there is a ball
 * near it, so the two have to multiply — a keeper who wanders upfield while the
 * ball is in the opponent's box has done nothing wrong.
 *
 * The blocking measure is the perpendicular distance from the cap to the
 * segment, restricted to caps that are actually BETWEEN the two ends. A cap
 * behind the goal line or out past the ball is not covering anything, and
 * without the restriction the keeper could satisfy this by standing in the net.
 */
function uncovered(ball, goal, mine, cfg) {
  const range = Math.max(1e-3, cfg.coverRange);
  const width = Math.max(1e-3, cfg.coverWidth);
  const gap = Math.hypot(ball.x - goal.x, ball.z - goal.z);
  const exposure = 1 - Math.min(1, gap / range);
  if (exposure <= 0) return 0;

  const sx = ball.x - goal.x;
  const sz = ball.z - goal.z;
  const len2 = sx * sx + sz * sz;
  let cover = 0;
  for (const c of mine) {
    // Projection onto the segment, as a fraction of its length.
    const t = len2 < 1e-6 ? 0 : ((c.x - goal.x) * sx + (c.z - goal.z) * sz) / len2;
    if (t <= 0 || t >= 1) continue;
    const px = goal.x + sx * t;
    const pz = goal.z + sz * t;
    const perp = Math.hypot(c.x - px, c.z - pz);
    cover = Math.max(cover, 1 - Math.min(1, perp / width));
  }
  return exposure * (1 - cover);
}

/**
 * Where the ball will BE when the next turn opens.
 *
 * ── out is not a turnover, and this is the whole of §7.4 ──────────────────
 * `FootballRules._judgeOut` puts the ball back at a throw-in or a corner and
 * then `advanceTurn` passes the turn exactly as it would have anyway — only a
 * GOAL sets `_kickoffBy`. So a ball that goes out costs nothing except its
 * position, and charging a flat penalty for it would teach the AI to refuse the
 * one clearance every defender in the world plays.
 *
 * What it does change is where the ball is, sometimes by a lot: measured, a ball
 * that crossed 4.4 units right of centre came to rest 5.9 units LEFT of it. So
 * the honest thing to score is the RESTART, and `findRespawn` is the same
 * function the rules will call — not a guess at what it would decide.
 *
 * Cheap in the common case: the first candidate spot is free unless a cap is
 * standing in it.
 *
 * Exported because the REPLY search needs the same answer: the opponent plans
 * from where the ball will be when their turn opens, and that is the restart
 * rather than the resting place. Two derivations of it would put the two plies
 * on different pitches.
 */
export function restingPlace(result, ctx) {
  if (!result.ballOut) return result.ball;
  const spot = findRespawn({
    ball: { x: result.ballOut.x, z: result.ballOut.z },
    over: result.ballOut.overGoalLine,
    caps: result.pos,
    metrics: ctx.metrics,
    ballRadius: ctx.ballRadius,
    capRadius: ctx.capRadius,
    cfg: ctx.respawnCfg,
  });
  return { x: spot.x, z: spot.z };
}

/**
 * Score one rolled-out candidate. Higher is better for `ctx.player`.
 *
 * @param {object} result  from `Rollout`
 * @param {object} ctx     from `footballStrategy.buildContext`
 * @returns {{score: number, terms: Record<string, number>, meta: object}}
 */
export function evaluateFootball(result, ctx) {
  const w = ctx.weights;
  const me = ctx.player;
  const foe = 1 - me;
  const myGoal = ctx.goals[me];
  const foeGoal = ctx.goals[foe];

  const terms = {
    /** Into their net. The win condition, and it must dominate. */
    goal: 0,
    /** Into mine. Heavier than `goal` — see the header. */
    ownGoal: 0,
    /** World units the ball got closer to their net. The gradient. */
    ballAdvance: 0,
    /** World units it got closer to mine. Not the negative of the above. */
    ballRetreat: 0,
    /** Could I put it in NEXT turn from this position, 0..1. */
    ballThreat: 0,
    /** Could they, 0..1. */
    foeBallThreat: 0,
    /** How much of the road to my net is unguarded, 0..1. */
    goalUncovered: 0,
    /** My caps within a strike of the ball. Options for the next move. */
    shooterSupport: 0,
    /** My caps stranded in the run-off, outside the lines. */
    capStranded: 0,
    orbGain: 0,
    orbGift: 0,
  };

  // ── the goal, latched in flight ───────────────────────────────────────────
  // `goalConceded` is who it went in against, so the scorer is the other one.
  // Never a branch on who took the shot: there is no version of football where
  // knocking it into your own net is not a goal. See `FootballRules`.
  const conceded = result.goalConceded;
  if (conceded === foe) terms.goal = 1;
  else if (conceded === me) terms.ownGoal = 1;
  const scored = conceded >= 0;

  /**
   * Where the ball ends up, as the next turn will find it.
   *
   * `null` on a goal, and that is not laziness. `resolveTurn` sets
   * `resetField`, so every cap and the ball go back to the kickoff formation —
   * the settled position is about to stop existing. Scoring it would also charge
   * twice for one event in both directions: a ball in their net reads as
   * maximally advanced ON TOP of `goal`, and a ball in mine reads as maximally
   * retreated on top of `ownGoal`. The goal terms carry the whole verdict.
   */
  const after = scored ? null : restingPlace(result, ctx);

  const mine = [];
  const theirs = [];
  for (let i = 0; i < ctx.capOwner.length; i++) {
    (ctx.capOwner[i] === me ? mine : theirs).push(result.pos[i]);
  }

  if (after) {
    const b0 = ctx.ball;
    const toFoe = (p) => Math.hypot(p.x - foeGoal.x, p.z - foeGoal.z);
    const toMine = (p) => Math.hypot(p.x - myGoal.x, p.z - myGoal.z);

    /**
     * ── the spine: did the ball get closer to their net ───────────────────
     * A delta in world units, not a fraction, so the number means something
     * fixed: one unit of advance is one unit of pitch whatever end it happens
     * at. Both halves are clamped at zero and priced separately, so the weights
     * can say "I will not push it three units toward my own goal to gain three
     * toward theirs" — which they do, because `ballRetreat` is the heavier.
     */
    const gain = toFoe(b0) - toFoe(after);
    terms.ballAdvance = Math.max(0, gain);
    terms.ballRetreat = Math.max(0, toMine(b0) - toMine(after));

    /**
     * ── and whether this position is worth anything NEXT turn ─────────────
     * `ballAdvance` alone would happily leave the ball in a corner it took two
     * turns to advance into and nobody can reach. These are the terms that ask
     * "is this a position I can shoot from", which is the football version of
     * survival's `foeEdge`: progress that has not resolved yet but is real.
     */
    terms.ballThreat = goalThreat(after, foeGoal, mine, ctx.pitch);
    terms.foeBallThreat = goalThreat(after, myGoal, theirs, ctx.pitch);
    terms.goalUncovered = uncovered(after, myGoal, mine, ctx.pitch);

    const support = Math.max(1e-3, ctx.pitch.supportRadius);
    for (const p of mine) {
      const d = Math.hypot(p.x - after.x, p.z - after.z);
      if (d < support) terms.shooterSupport += 1 - d / support;
    }
  }

  /**
   * ── caps in the run-off ───────────────────────────────────────────────────
   * `FootballRules` is explicit that "there is no out for a cap in this mode",
   * so this is not a loss — the cap is still on the field and still selectable.
   * It is simply somewhere useless: outside the lines, behind a goal or against
   * a fence, several turns from being any part of the game. Priced as a mild,
   * per-cap cost so the search prefers a shot that keeps its pieces in play,
   * and nowhere near the price of losing one, because it has not lost one.
   */
  for (const p of mine) {
    if (Math.abs(p.x) > ctx.halfX || Math.abs(p.z) > ctx.halfZ) terms.capStranded += 1;
  }

  /**
   * Orbs, and both directions of them. Identical to survival's reasoning: the
   * pickup goes to the OWNER OF THE CAP THAT TOUCHED IT, so driving an opponent
   * across one hands them a card.
   */
  for (const touch of result.orbTouched) {
    if (touch.player === me) terms.orbGain += 1;
    else terms.orbGift += 1;
  }

  const score =
    terms.goal * w.goal -
    terms.ownGoal * w.ownGoal +
    terms.ballAdvance * w.ballAdvance -
    terms.ballRetreat * w.ballRetreat +
    terms.ballThreat * w.ballThreat -
    terms.foeBallThreat * w.foeBallThreat -
    terms.goalUncovered * w.goalUncovered +
    terms.shooterSupport * w.shooterSupport -
    terms.capStranded * w.capStranded +
    terms.orbGain * w.orbGain -
    terms.orbGift * w.orbGift;

  /**
   * How near their net this shot left the ball.
   *
   * Not part of the score. It is survival's `meta.foeEdgeMax` in football's
   * terms — the number that separates "the shot nearly worked" from "the shot
   * was never going to reach", which the score cannot express because both are
   * near zero.
   *
   * 0 means it went in, and ONLY a goal for me reads 0. An own goal is the
   * furthest thing from scoring there is, so it reports the real distance from
   * my own net to theirs — the length of the pitch — rather than borrowing the
   * "a goal happened" zero and reading, on the panel, as a perfect shot.
   */
  const finalBall = after ?? { x: result.ball.x, z: result.ball.z };
  const ballGoalGap = terms.goal ? 0 : Math.hypot(finalBall.x - foeGoal.x, finalBall.z - foeGoal.z);

  return {
    score,
    terms,
    meta: {
      ballGoalGap,
      /** Did the ball move at all? A turn that misses it is worth naming. */
      ballTouched: !!result.ball && !!ctx.ball && Math.hypot(
        (result.ball.x ?? 0) - ctx.ball.x,
        (result.ball.z ?? 0) - ctx.ball.z,
      ) > 0.05,
    },
  };
}

/**
 * How much danger this player's goal is in RIGHT NOW, 0..1.
 *
 * The board as it stands, before any shot — `exposureOf`'s job in the other
 * mode, and read by the same card rule. 혼란 is judged on "상대가 유리한 위치일
 * 때", which is a statement about the position rather than about the move being
 * considered, so it cannot be read off a candidate.
 *
 * Shared with the evaluator's own `goalThreat` so the two cannot disagree about
 * what a dangerous position is.
 */
export function pressureOn(player, ctx) {
  const goal = ctx.goals[player];
  const strikers = [];
  for (let i = 0; i < ctx.capOwner.length; i++) {
    if (ctx.capOwner[i] !== player) strikers.push(ctx.before[i]);
  }
  return goalThreat(ctx.ball, goal, strikers, ctx.pitch);
}

/**
 * What the generator needs computed once per turn.
 *
 * `dangerMap`'s counterpart, and much smaller because football's danger is about
 * one object rather than about every cap: there is one ball, one net worth
 * defending, and the only per-cap question is which opponents are standing in
 * front of it.
 */
export function footballPreTurn(ctx) {
  const myGoal = ctx.goals[ctx.player];
  const foeGoal = ctx.goals[1 - ctx.player];
  const gap = Math.hypot(ctx.ball.x - myGoal.x, ctx.ball.z - myGoal.z);
  const range = Math.max(1e-3, ctx.pitch.coverRange);

  /**
   * The mouth of the goal I am ATTACKING, one cover-width infield of the line.
   *
   * ── it is THEIR net, and which net it is decides what the move means ──────
   * `clear-defender` exists to answer the position `shoot:c` cannot: the ball is
   * in range of their goal and one of their caps is standing in the mouth, so
   * every aim point is blocked and the only move that helps is shifting the cap.
   * That is the "수비수 치우기" the brief names, and it is the attacking half of
   * this generator.
   *
   * Aimed at their defenders rather than at their attackers deliberately.
   * Shoving an opponent away from MY net is the other thing this could mean, and
   * it is the weaker move: when the ball is in front of my goal the answer is to
   * move the BALL, which `clear` already does at wave 0 and which does not
   * depend on a cap being conveniently placed.
   *
   * Offset infield rather than sitting on the line so the push direction is "out
   * of the mouth" rather than "along the goal line" — on a 10.7-unit mouth the
   * latter leaves the defender still in the way.
   */
  const inward = Math.sign(-foeGoal.z) || 1;
  const goalFront = { x: foeGoal.x, z: foeGoal.z + inward * ctx.pitch.coverWidth };

  const blockers = [];
  for (let i = 0; i < ctx.capOwner.length; i++) {
    if (ctx.capOwner[i] === ctx.player) continue;
    const p = ctx.before[i];
    if (Math.hypot(p.x - goalFront.x, p.z - goalFront.z) < range) blockers.push(i);
  }

  return {
    /** 0 when the ball is nowhere near MY net, rising to 1 in the mouth. */
    ballDanger: 1 - Math.min(1, gap / range),
    /** In front of THEIR net. See above — the two are easy to confuse. */
    goalFront,
    blockers,
  };
}

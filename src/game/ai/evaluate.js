/**
 * What a position is worth, from one player's seat.
 *
 * ── the AI's strength lives HERE, and that is a measurement, not a slogan ────
 * "조준 정확도로 강하게 만들지 마라. AI의 강함은 무엇을 노릴지 판단하는 데서
 * 나온다." That was handed down as a design instruction and it turns out to be
 * the arithmetic of this mode. Rolling a 160-shot grid out from a position with
 * an opponent parked near the rim:
 *
 *     shots that drop an opponent cap : 12 / 160
 *     shots that lose one of my own   : 78 / 160
 *
 * Self-destruction outnumbers success six to one, and a full-power flick travels
 * 62 units on a 56-unit board — it leaves the table by itself. So an AI that
 * aimed perfectly and scored naively would be catastrophically bad, and one that
 * aims adequately and scores well is strong. Precision was never the lever.
 *
 * ── the terms are the brief's, one for one ──────────────────────────────────
 * Every weight below is a line from the specification and every one of them is
 * on the panel. They are deliberately not folded together: `dropOpponent` and
 * `loseOwn` are not one "cap difference" term, because the brief prices them
 * separately and because a search that would trade its own cap for an opponent's
 * one-for-one plays a completely different game from one that will not.
 *
 * ── it takes a RESULT, not a world ──────────────────────────────────────────
 * The rollout hands over positions, an out-flags array and a list of orb
 * touches; nothing here knows what Rapier is, and nothing here can step
 * anything. That is what makes the function swappable per mode — football's
 * evaluator scores goals off the same shape of record, and this file has no
 * survival-specific import to stop it.
 */

/**
 * @typedef {object} EvalContext
 * @property {number} player                whose seat we are scoring from
 * @property {number[]} capOwner            owning player per cap index
 * @property {boolean[]} alive              rules' alive flags BEFORE the shot
 * @property {{x: number, z: number}[]} before  cap positions before the shot
 * @property {number} safeRadius            distance from centre at which a cap is on the brink
 * @property {number} capRadius
 * @property {object} weights               `config.ai.weights`
 */

/**
 * How far from the middle of the board a cap is, as a fraction of the brink.
 *
 * 0 is dead centre, 1 is the edge it falls off. The board is square, so the
 * honest measure of "how close to going over" is the CHEBYSHEV distance — the
 * larger of |x| and |z| — because that is the axis the cap is nearest to
 * leaving by. Euclidean distance says a cap in the corner is further from
 * danger than it is, which is exactly backwards: a corner is the one place two
 * edges are close at once.
 */
function edgeFraction(p, safeRadius) {
  return Math.max(Math.abs(p.x), Math.abs(p.z)) / Math.max(1e-3, safeRadius);
}

/**
 * How far a cap could travel from `p` along `(ux, uz)` before leaving the board.
 *
 * The board is a square, so the exit is whichever of the four sides the ray
 * meets first. This is the quantity that decides whether a cap is in danger:
 * being near an edge is not itself fatal, being near an edge WITH SOMEBODY
 * LINED UP BEHIND YOU is.
 */
function exitDistance(p, ux, uz, safeRadius) {
  const R = Math.max(1e-3, safeRadius);
  const tx = ux > 1e-6 ? (R - p.x) / ux : ux < -1e-6 ? (-R - p.x) / ux : Infinity;
  const tz = uz > 1e-6 ? (R - p.z) / uz : uz < -1e-6 ? (-R - p.z) / uz : Infinity;
  return Math.max(0, Math.min(tx, tz));
}

/**
 * How exposed one cap is to being knocked off by the other side, 0..1.
 *
 * ── "죽을 확률이 높은 위치는 계산해서" ──────────────────────────────────────
 * Distance from the middle was the old proxy and it is a poor one: a cap parked
 * on the rim with every enemy on the far side of the board is perfectly safe,
 * and a cap in the middle with an enemy lined up behind it pointing at the near
 * edge is not. What actually decides it is whether somebody can reach you AND
 * whether the push would take you over.
 *
 * So a threat is the product of two things, and it needs both:
 *
 *   NEAR      the enemy is close enough to arrive with force. Falls off to zero
 *             at `reach`, past which a shot has spent itself getting there.
 *   EXPOSED   the line from that enemy THROUGH this cap runs out of board
 *             quickly. This is what makes it directional — the same enemy at
 *             the same distance is harmless from one side and lethal from the
 *             other.
 *
 * Multiplied rather than added, because either one at zero means no threat: an
 * enemy who cannot reach cannot push you off however exposed you are, and a cap
 * with the whole board behind it is safe however close the enemy is.
 *
 * Worst case over the enemies, not the sum. Two attackers do not make a cap
 * twice as dead, and summing would make a crowd of distant caps read as more
 * dangerous than one lined up at point-blank range.
 *
 * ── `push` is PER CAP, and defaults to the shared figure ────────────────────
 * 철벽 makes a cap heavier, so the same hit moves it less and the run to the
 * edge it can survive is longer. A single global constant here would price a
 * braced cap exactly as it prices a bare one, and the AI would spend its turn
 * answering a danger the card has already removed — and, on the other side of
 * the board, refuse an attack that has genuinely stopped working. See
 * `pushDistanceFor`, which is what every caller passes.
 */
function threatOn(p, enemies, cfg, safeRadius, push = cfg.pushDistance) {
  const reach = Math.max(1e-3, cfg.reach);
  push = Math.max(1e-3, push);
  let worst = 0;
  for (const e of enemies) {
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3 || d > reach) continue;
    const near = 1 - d / reach;
    const exit = exitDistance(p, dx / d, dz / d, safeRadius);
    const exposed = 1 - Math.min(1, exit / push);
    const t = near * exposed;
    if (t > worst) worst = t;
  }
  return worst;
}

/**
 * How far a shot actually shifts THIS cap, in world units.
 *
 * ── both halves of this are measured, and neither is the obvious one ────────
 * SPEED: a cap is not shot, it is HIT, and a collision does not deliver a fixed
 * impulse — it delivers `m1(1+e)v1 / (m1+m2)`. So a cap whose mass is multiplied
 * by `a` takes `2 / (1 + a)` of the shove, not `1 / a`. `CardEffects.massMulFor`
 * has the measurements; the short version is that at a = 1.5 the two predictions
 * differ by 0.80 against 0.67, which is most of the card.
 *
 * DISTANCE: friction decelerates at `a = μg` and is therefore mass-independent,
 * so a cap that starts at `v` travels `v²/2a` whatever it weighs. Distance goes
 * as the SQUARE of the speed ratio. Measured on an isolated cap: 21.59 units
 * bare against 9.69 braced, a ratio of 0.449 against a prediction of 0.444.
 *
 * So the factor is `(2/(1+a))²`, and a linear one would price the card at about
 * half of what it does.
 *
 * `capMassMul` reads the live body rather than the card state, which is what
 * makes this right for BOTH sides: a brace the human played is in the world by
 * the time the AI's context is built, so the AI answers the opponent's card
 * without anything here knowing whose it was.
 */
function pushDistanceFor(ctx, i) {
  const a = ctx.massMul?.[i] ?? 1;
  if (!(a > 1)) return ctx.threat.pushDistance;
  const speed = 2 / (1 + a);
  return ctx.threat.pushDistance * speed * speed;
}

/**
 * Score one rolled-out candidate. Higher is better for `ctx.player`.
 *
 * @param {import('./rollout.js').rollShot extends (...a: any) => infer R ? R : never} result
 * @param {EvalContext} ctx
 * @returns {{score: number, terms: Record<string, number>}}
 *   `terms` is kept because the panel draws it: an AI that plays a strange move
 *   is unreadable from a single number, and the brief asks to be able to see WHY
 *   a move was chosen. It costs an object per candidate and buys the only
 *   debugging surface this thing has.
 */
export function evaluateSurvival(result, ctx) {
  const w = ctx.weights;
  const me = ctx.player;
  const foe = 1 - me;
  const terms = {
    dropOpponent: 0,
    loseOwn: 0,
    edgeRisk: 0,
    /** Own caps an enemy could push off next turn. The defensive term. */
    selfThreat: 0,
    /** Opponent caps left near the brink. Progress toward a kill. */
    foeEdge: 0,
    /** Opponent caps THIS side could push off next turn. A shot set up. */
    foeThreat: 0,
    centre: 0,
    orbGain: 0,
    orbGift: 0,
    clump: 0,
  };

  /** Caps that were in play before this shot. A dead cap cannot be re-killed. */
  const live = [];
  for (let i = 0; i < ctx.capOwner.length; i++) if (ctx.alive[i]) live.push(i);

  // ── who went off ───────────────────────────────────────────────────────────
  // Counted, not merely detected: two opponents in one shot is worth twice one,
  // which is what "개수만큼 가산" asks for. The same on the debit side, and it
  // matters more there — a shot that takes two of mine with it is the shot the
  // search most needs to hate.
  for (const i of live) {
    if (!result.out[i]) continue;
    if (ctx.capOwner[i] === foe) terms.dropOpponent += 1;
    else terms.loseOwn += 1;
  }

  /**
   * ── the board as it ends up, from both sides ────────────────────────────
   * Survivors only. A cap that fell is already priced by `dropOpponent` or
   * `loseOwn`, and its final position is thirty units down in the pit — which
   * would read as an enormous edge risk and charge twice for one event.
   *
   * The two lists are built before scoring because the threat terms need them:
   * "can anybody push this cap off" is a question about where EVERYTHING is
   * after the shot, not about the cap on its own.
   */
  const mineAfter = [];
  const foeAfter = [];
  for (const i of live) {
    if (result.out[i]) continue;
    (ctx.capOwner[i] === me ? mineAfter : foeAfter).push({ i, p: result.pos[i] });
  }

  for (const { i, p } of mineAfter) {
    const nowEdge = edgeFraction(p, ctx.safeRadius);
    const wasEdge = edgeFraction(ctx.before[i], ctx.safeRadius);

    /**
     * Nearness to the brink, weighted so it bites late.
     *
     * Squared rather than linear because the danger is not linear: a cap at 40%
     * of the way out is in no trouble at all and a cap at 90% is one nudge from
     * gone. A linear term spends most of its range pricing positions that are
     * all equally safe, and then under-prices the only one that is not.
     */
    terms.edgeRisk += nowEdge * nowEdge;

    /**
     * And whether anybody can actually do anything about it.
     *
     * This is the term that answers "죽을 확률이 높은 위치는 계산해서 그곳에
     * 있으면 안전한 위치로 옮길 수 있게": a cap with an enemy lined up behind it
     * and a short run to the edge scores here, a cap sitting on the same rim
     * with nobody in range does not. Retreating is now driven by BEING IN
     * DANGER rather than by inward being generically good.
     */
    terms.selfThreat += threatOn(
      p,
      foeAfter.map((f) => f.p),
      ctx.threat,
      ctx.safeRadius,
      pushDistanceFor(ctx, i),
    );

    // A small credit for moving inward, kept as a tiebreaker. It used to be the
    // main reason the AI ever retreated, which is why it retreated constantly.
    terms.centre += Math.max(0, wasEdge - nowEdge);
  }

  /**
   * ── the same two questions asked of the opponent, with the sign flipped ───
   *
   * This is the gradient the evaluator was missing, and the reason the AI
   * played the way it did. `dropOpponent` is all-or-nothing: shove a cap to
   * within a hair of the edge and score exactly the same zero as missing it
   * entirely. So there was never a reason to attack unless the kill landed this
   * turn, and "retreat to the middle" won every other position by default.
   *
   * Pricing the opponent's edge and the opponent's exposure turns a near miss
   * into progress: pushing a cap out to the rim is worth something, and lining
   * up behind one is worth something, so the AI can build a position over two
   * turns instead of only ever taking shots that resolve immediately.
   */
  // `i` as well as `p`, which it did not need until 철벽: how far an opponent's
  // cap can be shoved is now a fact about WHICH cap it is.
  for (const { i, p } of foeAfter) {
    const edge = edgeFraction(p, ctx.safeRadius);
    terms.foeEdge += edge * edge;
    terms.foeThreat += threatOn(
      p,
      mineAfter.map((m) => m.p),
      ctx.threat,
      ctx.safeRadius,
      pushDistanceFor(ctx, i),
    );
  }

  const mineLeft = mineAfter.length;

  /**
   * My own caps bunched together.
   *
   * The cost is real and specific to this mode: caps in contact transmit a hit,
   * so one shot into a cluster can take the whole cluster over the edge. Scored
   * as pairs within a few diameters rather than as a variance, because it is
   * proximity that chains, not spread.
   */
  const clumpRange = ctx.capRadius * Math.max(0, w.clumpRadiusCaps) * 2;
  if (clumpRange > 0 && mineLeft > 1) {
    for (let a = 0; a < mineAfter.length; a++) {
      for (let b = a + 1; b < mineAfter.length; b++) {
        const pa = mineAfter[a].p;
        const pb = mineAfter[b].p;
        const d = Math.hypot(pa.x - pb.x, pa.z - pb.z);
        if (d < clumpRange) terms.clump += 1 - d / clumpRange;
      }
    }
  }

  /**
   * Orbs, and both directions of them.
   *
   * The pickup goes to the OWNER OF THE CAP THAT TOUCHED IT — see `Orbs.step` —
   * not to whoever is shooting. So driving an opponent's cap across an orb hands
   * them a card, and that is a real cost the brief calls out. It is the same
   * event with the sign flipped, which is why both come off one list.
   */
  for (const touch of result.orbTouched) {
    if (touch.player === me) terms.orbGain += 1;
    else terms.orbGift += 1;
  }

  const score =
    terms.dropOpponent * w.dropOpponent -
    terms.loseOwn * w.loseOwn -
    terms.edgeRisk * w.edgeRisk -
    terms.selfThreat * w.selfThreat +
    terms.foeEdge * w.foeEdge +
    terms.foeThreat * w.foeThreat +
    terms.centre * w.centre +
    terms.orbGain * w.orbGain -
    terms.orbGift * w.orbGift -
    terms.clump * w.clump;

  /**
   * How near the brink the nearest SURVIVING opponent cap ended up.
   *
   * Not part of the score — it is what the card policy reads to tell "the shot
   * nearly worked" from "the shot was never going to reach". 강타 is worth
   * playing on the first and worthless on the second, and the difference is not
   * visible in the score, which is near zero for both.
   *
   * A shot that already dropped every opponent leaves this at 1: nothing is
   * short of anything, so no boost is wanted.
   */
  let foeEdgeMax = 0;
  let foeStanding = 0;
  for (const i of live) {
    if (ctx.capOwner[i] !== foe || result.out[i]) continue;
    foeStanding++;
    foeEdgeMax = Math.max(foeEdgeMax, edgeFraction(result.pos[i], ctx.safeRadius));
  }

  return {
    score,
    terms,
    meta: { foeEdgeMax: foeStanding ? foeEdgeMax : 1, foeStanding },
  };
}

/**
 * How exposed one player's caps are right now, 0..1-ish.
 *
 * The board as it stands, before any shot — which is what 혼란 is judged on:
 * "상대가 유리한 위치일 때" is a statement about the position, not about the move
 * being considered. Shared with the evaluator's own notion of the brink so the
 * two cannot disagree about where the edge is.
 */
export function exposureOf(player, { capOwner, alive, before, safeRadius }) {
  let worst = 0;
  let n = 0;
  for (let i = 0; i < capOwner.length; i++) {
    if (!alive[i] || capOwner[i] !== player) continue;
    n++;
    worst = Math.max(worst, edgeFraction(before[i], safeRadius));
  }
  return n ? worst : 0;
}

/**
 * Which of this player's caps are in trouble RIGHT NOW, and how badly.
 *
 * The same `threatOn` the evaluator scores with, asked of the board as it
 * stands rather than of a hypothetical outcome — so the generator can aim a
 * threatened cap somewhere safer instead of hoping a centre-ward shot happens
 * to help. One definition of danger, two readers.
 *
 * @returns {Map<number, {threat: number, from: {x: number, z: number}|null}>}
 *   per cap index, its worst threat and which enemy is making it — the escape
 *   direction is "away from that one", which is what the caller needs.
 */
export function dangerMap(player, ctx) {
  const { capOwner, alive, before, safeRadius, threat } = ctx;
  const enemies = [];
  for (let i = 0; i < capOwner.length; i++) {
    if (alive[i] && capOwner[i] !== player) enemies.push(before[i]);
  }

  const out = new Map();
  for (let i = 0; i < capOwner.length; i++) {
    if (!alive[i] || capOwner[i] !== player) continue;
    const p = before[i];
    const push = pushDistanceFor(ctx, i);
    const level = threatOn(p, enemies, threat, safeRadius, push);
    // The enemy responsible, so the caller can run the other way.
    let from = null;
    let worst = -1;
    for (const e of enemies) {
      const one = threatOn(p, [e], threat, safeRadius, push);
      if (one > worst) {
        worst = one;
        from = e;
      }
    }
    out.set(i, { threat: level, from });
  }
  return out;
}

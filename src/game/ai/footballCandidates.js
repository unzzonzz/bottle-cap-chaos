import { fanOffsets, powerSteps } from './candidates.js';

/**
 * Which shots are worth simulating, on a pitch.
 *
 * ── the same argument as `candidates.js`, and the numbers are worse ─────────
 * A blind fan is unaffordable there and useless here. Measured from the football
 * kickoff, 768 shots across 4 caps x 48 headings x 4 powers:
 *
 *     shots that scored              0 / 768
 *     shots that TOUCHED THE BALL   34 / 768   (4%)
 *
 * Ninety-six per cent of a blind sweep is a cap flicked at empty turf. Football
 * is worse than knockout for this because there is one object that matters
 * instead of three, and it is small: the ball is 1.92 units across on a pitch
 * 41 x 64. So every candidate here points at something, and the thing it points
 * at is almost always the ball.
 *
 * ── and no single flick can score from the middle ───────────────────────────
 * That zero is not a bug in the sweep. Measured travel on this pitch, a cap
 * aimed dead at the ball from 9.6 units away:
 *
 *     power   0.32   0.42   0.50   0.61   0.71   0.81   0.90   1.00
 *     ball    6.40   7.15   7.25   7.55  15.10  30.86  23.71  10.99
 *     cap     7.27   9.37  11.62  14.52  16.43  18.70  19.35  20.89
 *
 * The goal line is 32 units from the centre spot and the best single strike
 * moves the ball 31. So a goal is a TWO-turn object at least, which is the whole
 * reason `footballEvaluate` cannot be built on `goal` alone and why the
 * generator has to produce moves that are worth making without scoring.
 *
 * That table also says the obvious power curve does not exist. Ball travel is
 * not monotonic in power — 1.00 moves it a third as far as 0.81, because a
 * harder strike arrives with the cap tumbling and clips it — so there is no
 * football-specific power ladder to derive. `powerSteps` is imported from
 * `candidates.js` unchanged: what a power buys is REACH, the cap's own travel,
 * and that column is monotonic and is what the survival ladder was measured
 * against. See the note on the export there.
 *
 * ── the fan is narrower than survival's, and that is the cone talking ───────
 * The error cone at these powers is 1.5° to 7.0° measured, and a cap aimed at a
 * ball 9.6 units away hit it on 96 of 96 draws through the real cone. Aiming is
 * not what fails in this mode. What fails is choosing the wrong thing to aim at,
 * so the budget goes on more TARGETS rather than on a wider fan around each.
 */

/** @typedef {import('./candidates.js').Candidate} Candidate */

/** Unit vector, or null for a degenerate one. */
function unit(x, z) {
  const len = Math.hypot(x, z);
  return len < 1e-6 ? null : { x: x / len, z: z / len };
}

function rotate(v, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

/**
 * Where to aim so the BALL leaves along `d`. The pool player's ghost ball.
 *
 * ── same formula as survival's `drive`, different radius, and it matters ────
 * Two circles part along the line joining their centres at the moment of
 * contact, so to send the target along `d` the striker's centre has to arrive at
 * `target - (r_striker + r_target) * d`. Survival hits caps with caps and folds
 * that to `2 * capRadius`; here a cap hits a BALL, and on this pitch the two
 * radii are 1.60 and 0.96. Using survival's figure would aim 0.64 units past the
 * contact point — a quarter of the offset, and on a 10.7-unit goal mouth at
 * thirty units' range that is the difference between a post and a goal.
 *
 * Returns null when the shot does not exist, and there are two ways for that:
 *
 *   ON TOP OF IT   the ghost point is inside the shooter. No heading points at
 *                  a place you are already standing.
 *   WRONG SIDE     the shooter is between the ball and the target. The ghost
 *                  point is then BEYOND the ball from where the cap stands, so
 *                  the cap reaches the ball first and strikes its near face —
 *                  driving it directly away from the thing it was aimed at.
 *
 * The second is worth filtering rather than leaving to the rollout to reject.
 * It is not a shot that happens to be bad in this position; it is geometrically
 * incapable of the thing it is generated for, and with three aim points times a
 * fan times five powers behind it, one badly-placed shooter can spend a
 * meaningful slice of the candidate budget on shots that push the ball the
 * wrong way. The evaluator would score every one of them correctly and the
 * budget would still be gone.
 *
 * `dot > 0` is exactly "the shooter is on the far side of the ball from the
 * target". Perpendicular is allowed through — a glancing strike is a real shot
 * and the rollout is the right judge of it.
 */
function ghostAim(from, ball, dir, capRadius, ballRadius) {
  const toBall = unit(ball.x - from.x, ball.z - from.z);
  if (!toBall || toBall.x * dir.x + toBall.z * dir.z <= 0) return null;
  const gx = ball.x - (capRadius + ballRadius) * dir.x;
  const gz = ball.z - (capRadius + ballRadius) * dir.z;
  const dx = gx - from.x;
  const dz = gz - from.z;
  if (Math.hypot(dx, dz) <= capRadius) return null;
  return unit(dx, dz);
}

/**
 * Build the ordered candidate list for one football turn.
 *
 * @param {object} o
 * @param {object} o.ctx        from `footballStrategy.buildContext`
 * @param {{x: number, z: number}[]} o.orbs
 * @param {object} o.preTurn    from `footballStrategy.preTurn`
 * @param {object} o.sampling   the merged `config.ai.sampling`
 * @returns {Candidate[]}
 */
export function footballCandidates({ ctx, orbs, preTurn, sampling }) {
  const angles = Math.max(1, Math.round(sampling.anglesPerTarget));
  const powers = powerSteps(Math.max(1, Math.round(sampling.powerSteps)));
  const spread = (Math.max(0, sampling.angleSpreadDeg) * Math.PI) / 180;
  const offsets = fanOffsets(angles, spread);
  const capBudget = Math.max(1, Math.round(sampling.maxShooters));

  const { ball, capRadius, ballRadius, before, capOwner, player } = ctx;
  const foe = 1 - player;
  const myGoal = ctx.goals[player];
  const foeGoal = ctx.goals[foe];

  /**
   * Which of my caps to shoot with.
   *
   * Nearest the BALL first, where survival ranks nearest an opponent — same
   * reasoning, different centre of gravity: a shot's whole value here is what it
   * can reach, and what is worth reaching is the ball.
   *
   * ── the keeper gets no special treatment, and that is a decision ──────────
   * `FootballRules.onFieldReset` puts both cursors on cap 0 and calls it the
   * keeper, so it was tempting to pin it into the list or to keep it out of it.
   * Neither: a side has four caps and `maxShooters` defaults to four, so at the
   * shipped settings this ranking never cuts anybody and the question is moot.
   * When it does cut — a lowered slider — nearest-the-ball is still the right
   * order, because a keeper far from the ball has nothing to do and a keeper
   * ON the ball is the only cap that can clear it.
   *
   * What stops the AI abandoning its net is not the generator refusing to
   * consider it. It is `goalUncovered` in the evaluator pricing the empty goal,
   * which is the honest place for it: leaving the line is sometimes right, and a
   * rule here could never tell which times those are.
   */
  const shooters = [];
  for (let i = 0; i < capOwner.length; i++) if (capOwner[i] === player) shooters.push(i);
  const ranked = shooters
    .map((i) => {
      const p = before[i];
      return { i, d: Math.hypot(p.x - ball.x, p.z - ball.z) };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, capBudget)
    .map((r) => r.i);

  /** @type {Candidate[]} */
  const out = [];
  const push = (capIndex, dirX, dirZ, power, intent, wave) => {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return;
    out.push({ capIndex, dirX: dirX / len, dirZ: dirZ / len, power, intent, wave });
  };
  /** A fanned, powered spray around one heading. */
  const spray = (capIndex, dir, intent, baseWave, halfFan = 1) => {
    if (!dir) return;
    const base = Math.atan2(dir.z, dir.x);
    for (const d of offsets) {
      const a = base + d.offset * halfFan;
      for (const p of powers) {
        push(capIndex, Math.cos(a), Math.sin(a), p.power, intent, baseWave + d.rank + p.rank);
      }
    }
  };

  /**
   * ── where to aim at the goal, and why three points rather than one ────────
   * The mouth is 10.708 units wide and the ball is 1.92, so the ball's CENTRE
   * has to finish within ±4.394 of the goal's centre for the whole of it to be
   * inside — 82% of the mouth is usable and the middle of it is exactly where a
   * defending cap stands. Aiming only at the centre therefore means every shot
   * this generator produces is blocked by one cap in the one place a keeper
   * naturally sits.
   *
   * The post points are inset by the ball's own radius so they are places the
   * ball can actually END UP rather than lines it would half-cross.
   */
  const mouth = Math.max(0, ctx.goalHalfWidth - ballRadius);
  const aimPoints = [
    { x: 0, z: foeGoal.z, tag: 'c' },
    { x: -mouth, z: foeGoal.z, tag: 'l' },
    { x: mouth, z: foeGoal.z, tag: 'r' },
  ];

  const emergency = preTurn.ballDanger > 0;

  for (const capIndex of ranked) {
    const from = before[capIndex];

    /**
     * ── straight at the ball ──────────────────────────────────────────────
     * Wave 0, at every power, for every shooter. It is the crudest move in the
     * mode and it is the one that must never be missing: a shot that merely
     * CONTACTS the ball keeps the search's `ballAdvance` gradient alive, and the
     * measured 4% contact rate of a blind sweep is what a list without this
     * looks like from the outside — an AI wandering around near the ball.
     */
    spray(capIndex, unit(ball.x - from.x, ball.z - from.z), 'ball', 0);

    // ── shoot: send the ball at the goal, not merely away from me ───────────
    for (const aim of aimPoints) {
      const d = unit(aim.x - ball.x, aim.z - ball.z);
      if (!d) continue;
      // Centre in wave 0 with the direct shot; the posts one wave back, so a
      // truncated search always has the plain attempt on the goal.
      spray(
        capIndex,
        ghostAim(from, ball, d, capRadius, ballRadius),
        `shoot:${aim.tag}`,
        aim.tag === 'c' ? 0 : 1,
        0.5,
      );
    }

    /**
     * ── clear: get it away from my own net, anywhere ──────────────────────
     * Only when the ball is actually in trouble, and in wave 0 when it is — a
     * ball sitting in front of my goal is the football equivalent of a cap about
     * to be knocked off, and survival puts its escape shots in wave 0 for
     * exactly that reason.
     *
     * Three headings rather than one: straight out, and the two diagonals. A
     * clearance up the middle is the one that gets charged down, which is why
     * real defenders put it into touch — and `_judgeOut` makes that cheap here,
     * since a ball that goes out comes back at a throw-in and the turn passes to
     * the opponent either way. See `footballEvaluate` on why out is not a loss.
     */
    if (emergency) {
      const away = unit(ball.x - myGoal.x, ball.z - myGoal.z);
      if (away) {
        for (const [rad, tag] of [
          [0, 'clear'],
          [Math.PI / 4, 'clear:l'],
          [-Math.PI / 4, 'clear:r'],
        ]) {
          spray(
            capIndex,
            ghostAim(from, ball, rotate(away, rad), capRadius, ballRadius),
            tag,
            rad === 0 ? 0 : 1,
            0.5,
          );
        }
      }

      /**
       * ── block: a move that does not touch the ball at all ────────────────
       * Get a cap onto the line between the ball and my goal. It scores nothing
       * this turn by construction, which is precisely why it needs to be in the
       * list rather than left to emerge: every other candidate here is an
       * attempt on the ball, so without this the search literally cannot
       * consider defending, in the same way survival's could not consider
       * retreating until `candidates.js` put the retreat in its own wave.
       */
      const target = {
        x: ball.x + (myGoal.x - ball.x) * 0.4,
        z: ball.z + (myGoal.z - ball.z) * 0.4,
      };
      for (const p of powers) {
        push(capIndex, target.x - from.x, target.z - from.z, p.power, 'block', p.rank);
      }
    }

    /**
     * ── clear-defender: move a cap that is standing in my way ─────────────
     * Survival's ghost ball applied to an opponent cap, with the direction being
     * "out of the mouth of the goal I am attacking" rather than "off the board"
     * — there is no off. Cap against cap, so the offset is `2 * capRadius` and
     * not the ball's; see `ghostAim`.
     *
     * It is the answer to the one position `shoot:*` cannot solve. The mouth is
     * 10.7 wide and the ball has to finish within ±4.39 of its centre, so a
     * single cap parked in it blocks the centre aim outright and the two post
     * aims are the narrowest shots on the pitch. Moving the cap is then worth
     * more than any amount of re-aiming.
     *
     * Restricted to the caps in `preTurn.blockers` — the ones actually in the
     * mouth. Every opponent cap is a legal target and most of them are nowhere
     * near it, and 4v4 makes that four times the waste survival's 3v3 would.
     */
    for (const o of preTurn.blockers) {
      const t = before[o];
      const d = unit(t.x - preTurn.goalFront.x, t.z - preTurn.goalFront.z);
      if (!d) continue;
      const gx = t.x - 2 * capRadius * d.x;
      const gz = t.z - 2 * capRadius * d.z;
      const aim = unit(gx - from.x, gz - from.z);
      if (aim && Math.hypot(gx - from.x, gz - from.z) > capRadius) {
        spray(capIndex, aim, `clear-defender:${o}`, 1, 0.5);
      }
    }

    // ── orbs: a card is worth going for ──────────────────────────────────
    // Straight at it only, exactly as survival does — an orb is a point, not a
    // thing to be struck at an angle, and the fan would buy nothing but budget.
    for (const orb of orbs) {
      const d = unit(orb.x - from.x, orb.z - from.z);
      if (!d) continue;
      const base = Math.atan2(d.z, d.x);
      for (const p of powers) {
        push(capIndex, Math.cos(base), Math.sin(base), p.power, 'orb', p.rank + 1);
      }
    }
  }

  /**
   * Breadth first, and STABLY so.
   *
   * The tie-break is the generation order, which is deterministic — same
   * position, same list, on every machine and every replay. A comparator that
   * left ties to the engine's sort would make the truncation point, and
   * therefore the move played, an implementation detail of the JS runtime. This
   * is `candidates.js`'s last block for the same reason it is there.
   */
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.wave - b.c.wave || a.i - b.i)
    .map((e) => e.c);
}

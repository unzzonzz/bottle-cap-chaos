/**
 * Which shots are worth simulating at all.
 *
 * ── a blind grid is not affordable, and the number is not close ─────────────
 * An exact rollout costs 14.5 ms — measured, full settle, 95 steps at ~153 us a
 * step on a desktop, and a mobile webview should be assumed several times worse.
 * So the honest budget of ~700 ms buys somewhere around 45 candidates, and a
 * blind sweep of 3 caps x 24 angles x 4 powers is 288 of them: four seconds of
 * solver for a turn that is supposed to feel immediate.
 *
 * Discretising each axis evenly, which is the obvious reading of "각 축을 적당한
 * 간격으로 이산화", spends that budget almost entirely on shots aimed at empty
 * board. So the axes are discretised — but AROUND SOMETHING. Every candidate
 * points at a thing that exists: an opponent cap, an orb, or the middle of the
 * board. The angular offsets and the power steps are the discretisation, and
 * they are applied to a heading that already means something.
 *
 * The measured hit rate is what justifies it. In a blind sweep from the opening
 * position, zero of 288 candidates dropped an opponent cap — not because the
 * search was wrong but because from a standing start no single flick can push a
 * cap 16 units past its neighbour and off. The shots that matter are aimed ones,
 * and there are not many of them.
 *
 * ── ordered BREADTH FIRST, and that ordering was a bug fix ─────────────────
 * The list is truncated to a fixed count the search can afford, so the order
 * decides what gets considered at all. Sorting by intent — every attack, then
 * every orb run, then the retreats — looks like the right priority and is not:
 * three caps fanned at three angles across three opponents at four powers is 108
 * attacking candidates, so a budget of 48 never reached a single retreat. The
 * search could not consider pulling a cap back off the edge, which is precisely
 * the move the brief asks for when every attack is a losing trade.
 *
 * So candidates come out in WAVES. Wave 0 is the straight line at each target at
 * the most useful draw strength, plus the retreat, for every cap — the coarse
 * pass, about fifteen shots that span every option. Later waves add the angular
 * fan and the remaining powers. Truncation now costs precision within a plan
 * rather than removing whole plans from consideration.
 *
 * ── nothing here is survival-specific except the caller ─────────────────────
 * It is handed positions, an owner table and a target list. Football's generator
 * aims at the ball and the goal instead, and swaps in without this file
 * changing — which is the "모드에 종속되지 않게 분리" the brief asks for.
 */

/**
 * @typedef {object} Candidate
 * @property {number} capIndex
 * @property {number} dirX
 * @property {number} dirZ
 * @property {number} power
 * @property {string} intent  what this shot is FOR. Panel-facing; never scored.
 * @property {number} wave  refinement level; lower is evaluated first
 */

/**
 * The way off the board that is nearest to a point, as a unit vector.
 *
 * The board is a square, so it is whichever of the four sides the point is
 * closest to — the axis with the larger coordinate wins. This is the direction
 * a cap has to be sent to fall, and it is what `drive` candidates aim to push a
 * target along.
 *
 * Null in the middle of the board, where no side is meaningfully nearer than
 * another and driving toward one is no better than any other heading.
 */
function nearestExit(p, safeRadius) {
  const R = Math.max(1e-3, safeRadius);
  const fx = Math.abs(p.x) / R;
  const fz = Math.abs(p.z) / R;
  if (Math.max(fx, fz) < 0.15) return null;
  return fx >= fz ? { x: Math.sign(p.x) || 1, z: 0 } : { x: 0, z: Math.sign(p.z) || 1 };
}

/**
 * Aim headings as offsets around a target bearing, paired with a refinement
 * rank: 0 for straight at it, rising as the fan widens.
 */
function fanOffsets(count, spreadRad) {
  if (count <= 1) return [{ offset: 0, rank: 0 }];
  const out = [{ offset: 0, rank: 0 }];
  const half = Math.floor((count - 1) / 2);
  for (let i = 1; i <= half; i++) {
    const t = (i / half) * spreadRad;
    out.push({ offset: t, rank: i }, { offset: -t, rank: i });
  }
  return out.slice(0, count);
}

/**
 * Power steps.
 *
 * ── evenly spaced in PULL, and the curve it replaced hid whole shots ────────
 * Measured travel on the default board: 0.25 -> 4.7 units, 0.50 -> 18.6,
 * 0.75 -> 26.7, 1.00 -> 62.5. See the note inside for why the old quadratic
 * bias made a third of that range unreachable.
 */
function powerSteps(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    /**
     * ── linear in PULL, and the quadratic it replaced was a blind spot ──────
     * This was `0.18 + 0.82t²`, which at four steps produces 0.18, 0.27, 0.54
     * and 1.00. Measured travel for those: about 2, 5, 20 and 62 units. So
     * everything between twenty and sixty units was unreachable — the AI could
     * not express a shot at a target thirty units away, and every measurement
     * came back "average power 0.54" because that was the only usable value it
     * had, not because it was the right one.
     *
     * The curve was written to bias toward low power on the grounds that full
     * draws overshoot. That reasoning is sound and belongs in the EVALUATOR,
     * which already punishes a cap that sails off the board; expressing it as a
     * gap in what can be attempted just makes whole shots invisible.
     */
    out.push({ power: 0.22 + 0.78 * t, index: i });
  }
  /**
   * ...and then ranked from the middle outward, so the coarse wave tries a
   * plausible draw rather than the weakest one.
   *
   * Index order would put 0.18 first — a shot that travels about three units and
   * reaches nothing — and the strongest last, which is where the search is most
   * likely to be truncated. Both ends are the unhelpful ones here: the bottom
   * cannot reach and the top overshoots the board. The middle is where the game
   * is played, so the middle is what a truncated search sees.
   */
  const mid = (count - 1) / 2;
  const ranked = out.slice().sort(
    (a, b) =>
      Math.abs(a.index - mid) - Math.abs(b.index - mid) ||
      /**
       * ── ties go to the STRONGER draw, and this was a real bug ────────────
       * The two powers either side of the middle are equidistant from it, so
       * the comparator tied and a stable sort kept the weaker one first. The
       * firm draw therefore landed a whole wave later than the gentle one and
       * the budget was spent before it arrived: measured, the search evaluated
       * 64 of 285 candidates and tried only powers 0.61 and 0.42 — never 0.81,
       * never 1.0, in any position.
       *
       * Two failures fall straight out of that, and both were reported from
       * play. A target twenty-four units away needs about 0.8 to reach and the
       * AI could not attempt it, so mid-range kills simply did not exist for
       * it. And where a firm shot would have finished a cap, the only draws on
       * offer nudged it — "가까이 있어도 살살쳐서 나를 살려줄 때가 많다".
       *
       * Reaching further is the more useful direction to be wrong in: a shot
       * that overshoots is punished by the evaluator, which can see the cap
       * leave the board, whereas a shot that falls short is invisible — it
       * simply achieves nothing and looks safe.
       */
      b.index - a.index,
  );
  return ranked.map((p, rank) => ({ power: p.power, rank }));
}

/**
 * Build the ordered candidate list for one turn.
 *
 * @param {object} opts
 * @param {number} opts.player
 * @param {number[]} opts.shooters       cap indices this player may fire
 * @param {(i: number) => {x: number, z: number}} opts.comOf
 * @param {number[]} opts.opponents      live opponent cap indices
 * @param {{x: number, z: number}[]} opts.orbs
 * @param {Map<number, {threat: number, from: {x: number, z: number}|null}>} [opts.danger]
 *   which of this player's caps are already in trouble, and who from. Drives the
 *   escape candidates below.
 * @param {number} opts.capRadius        for the ghost-ball offset
 * @param {number} opts.safeRadius       half-extent of the board
 * @param {object} opts.sampling         `config.ai.sampling`
 * @returns {Candidate[]}
 */
export function survivalCandidates({
  player,
  shooters,
  comOf,
  opponents,
  orbs,
  danger,
  capRadius,
  safeRadius,
  sampling,
}) {
  const angles = Math.max(1, Math.round(sampling.anglesPerTarget));
  const powers = powerSteps(Math.max(1, Math.round(sampling.powerSteps)));
  const spread = (Math.max(0, sampling.angleSpreadDeg) * Math.PI) / 180;
  const offsets = fanOffsets(angles, spread);
  const capBudget = Math.max(1, Math.round(sampling.maxShooters));

  /**
   * Which of my caps to shoot with.
   *
   * Capped, and the cap is spent on the caps nearest the action: with three
   * caps a side there is usually nothing to trim, but the count is a slider and
   * a board with six a side would otherwise triple the list. Nearest-to-an-
   * opponent first, because a shot's whole value here is what it can reach.
   */
  const ranked = shooters
    .map((i) => {
      const p = comOf(i);
      let nearest = Infinity;
      for (const o of opponents) {
        const q = comOf(o);
        nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.z - q.z));
      }
      return { i, nearest };
    })
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, capBudget)
    .map((r) => r.i);

  /** @type {Candidate[]} */
  const out = [];
  const push = (capIndex, dirX, dirZ, power, intent, wave) => {
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-6) return;
    out.push({ capIndex, dirX: dirX / len, dirZ: dirZ / len, power, intent, wave });
  };

  for (const capIndex of ranked) {
    const from = comOf(capIndex);

    // ── attack: at each opponent, fanned ────────────────────────────────────
    for (const o of opponents) {
      const to = comOf(o);
      const base = Math.atan2(to.z - from.z, to.x - from.x);
      for (const d of offsets) {
        const a = base + d.offset;
        for (const p of powers) {
          push(capIndex, Math.cos(a), Math.sin(a), p.power, `attack:${o}`, d.rank + p.rank);
        }
      }

      /**
       * ── drive: hit it so it goes OFF, not merely away ──────────────────────
       * Aiming at a cap's centre sends it straight away from the shooter, which
       * is only a kill when the shooter happens to be lined up with an edge.
       * From anywhere else the AI was pushing caps ACROSS the board — the shot
       * connects, the cap moves, nothing falls, and it reads as an opponent that
       * cannot finish.
       *
       * This is the pool player's ghost ball. Two circles part along the line
       * joining their centres at the moment of contact, so to send the target
       * along `d` the shooter's centre has to arrive at `target - 2r*d`. Aim
       * there and the target leaves along `d` — and `d` is chosen as the way out
       * of the board that is nearest, so the shot is a push toward the drop
       * rather than a push in whatever direction the geometry happened to give.
       *
       * It is an approximation: caps are compounds of eleven colliders rather
       * than discs, and it ignores the target's own spin. It does not need to be
       * exact — the rollout tells the truth about what actually happens, and
       * this only has to put a shot worth simulating into the list. Which is
       * exactly what the coarse fan could not do.
       */
      const exit = sampling.ghostBall === false ? null : nearestExit(to, safeRadius);
      if (exit) {
        const gx = to.x - 2 * capRadius * exit.x;
        const gz = to.z - 2 * capRadius * exit.z;
        const dx = gx - from.x;
        const dz = gz - from.z;
        // Behind me, or on top of me: no shot exists at that ghost point.
        if (Math.hypot(dx, dz) > capRadius) {
          const base2 = Math.atan2(dz, dx);
          for (const d of offsets) {
            const a = base2 + d.offset * 0.5;
            for (const p of powers) {
              push(capIndex, Math.cos(a), Math.sin(a), p.power, `drive:${o}`, d.rank + p.rank);
            }
          }
        }
      }
    }

    // ── orbs: a card is worth going for ─────────────────────────────────────
    // Straight at it only — an orb is a point, not a thing to be struck at an
    // angle, and the fan would buy nothing but budget.
    for (const orb of orbs) {
      const base = Math.atan2(orb.z - from.z, orb.x - from.x);
      for (const p of powers) {
        push(capIndex, Math.cos(base), Math.sin(base), p.power, 'orb', p.rank);
      }
    }

    /**
     * ── escape: away from whoever is lining this cap up ───────────────────
     * Only for a cap that is ACTUALLY in trouble, and pointed away from the
     * specific enemy making the trouble rather than at the middle of the board.
     *
     * "죽을 확률이 높은 위치는 계산해서 그곳에 있으면 안전한 위치로 옮길 수 있게."
     * Running to the centre is one way out and often not the best one: a cap
     * pinned against the north rim by an enemy to the south escapes by going
     * EAST or WEST, and heading for the middle runs straight into the shot. So
     * the escape heading is the reverse of the threat, plus the two
     * perpendiculars — the three ways off a firing line.
     *
     * Wave 0, because a cap about to be knocked off is not a refinement.
     */
    const d = danger?.get(capIndex);
    if (d && d.from && d.threat > 0.02) {
      const ax = from.x - d.from.x;
      const az = from.z - d.from.z;
      const len = Math.hypot(ax, az) || 1;
      const ux = ax / len;
      const uz = az / len;
      for (const [ex, ez, tag] of [
        [ux, uz, 'flee'],
        [-uz, ux, 'sidestep'],
        [uz, -ux, 'sidestep'],
      ]) {
        for (const p of powers) push(capIndex, ex, ez, p.power, tag, p.rank);
      }
    }

    /**
     * ── retreat: toward the middle ────────────────────────────────────────
     * Kept, and demoted. A turn where every attack is a losing trade is a real
     * position — 78 of 160 candidates lost a cap in the measured rim test — and
     * pulling a cap in off the edge is the right answer to it.
     *
     * But it used to be in wave 0 with a weight that made it the DEFAULT, and
     * the AI spent most of its turns shuffling toward the middle for no reason:
     * "지금처럼 무능력하게 가운데로만 가려는 성질." It is now one wave back, so a
     * truncated search reaches every attack and every escape first, and the
     * evaluator's `centre` credit has been cut to a tiebreaker. It wins when
     * nothing else is on offer, which is what it is for.
     *
     * A cap already in the middle generates nothing: `push` drops a zero-length
     * heading, so there is no special case to write.
     */
    for (const p of powers) {
      push(capIndex, -from.x, -from.z, p.power, 'centre', p.rank + 1);
    }
  }

  /**
   * Breadth first, and STABLY so.
   *
   * The tie-break is the generation order, which is deterministic — same
   * position, same list, on every machine and every replay. A comparator that
   * left ties to the engine's sort would make the truncation point, and
   * therefore the move played, an implementation detail of the JS runtime.
   */
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.wave - b.c.wave || a.i - b.i)
    .map((e) => e.c);
}

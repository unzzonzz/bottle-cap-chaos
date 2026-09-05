/**
 * Where a ball that stopped outside the lines comes back.
 *
 * ── it has to read as football, not as a rule ────────────────────────────────
 * Nobody is going to be told what this does, so it has to be a thing they have
 * already seen. Out over the side is a throw-in and comes back where it left;
 * out over the goal line without going in is a corner and comes back at the
 * flag. Those two are the whole vocabulary, and they cover every way a ball can
 * leave a rectangle.
 *
 * ── "where it left" means where it CROSSED ───────────────────────────────────
 * Not where it stopped. The caller hands in the crossing point — see
 * `FootballPitch.crossing` for why the two are so far apart — and everything
 * below reads off that: which line, which side, which corner, which point on the
 * touchline. Nothing here knows about the run-off, because nothing here is ever
 * given a point in it any more.
 *
 * A ball put back in front of the goal it just went behind would be a free shot
 * handed to whoever is on strike, which is why the goal line case goes to the
 * corner and not to the nearest point on the line.
 *
 * ── the search is a fixed sequence ───────────────────────────────────────────
 * A spot is no good if a cap is standing in it, and there is no bound on how
 * many caps might be piled around the flag. So there is a search, and every step
 * of it is ordered: same world, same ball, same answer, every time. Nothing here
 * calls a random number generator, and nothing here reads a clock.
 *
 * That matters beyond tidiness. The replay check rewinds to the snapshot a turn
 * started from and fires the same shot again; if the respawn that follows landed
 * anywhere else the second time, the world the NEXT turn starts in would differ
 * and the determinism guarantee would end at the first ball that went out.
 *
 * ── the caps do not move ─────────────────────────────────────────────────────
 * Ever. The ball is what is being placed; the caps are where the players put
 * them. A search that shoved a cap aside would be quietly undoing someone's
 * turn.
 */

export const RESPAWN_KIND = {
  THROW_IN: 'throwIn',
  CORNER: 'corner',
};

/** Ordered offsets for the last-resort spiral, in units of `slideStep`. */
const SPIRAL_TURNS = 3;
const SPIRAL_PER_TURN = 8;

/**
 * @param {object} a
 * @param {{x: number, z: number}} a.ball        where it left the pitch
 * @param {boolean|null} [a.over]  true if it left over a GOAL line. Null asks
 *   this function to work it out from `ball`, which is only right when `ball` is
 *   a point beyond the lines rather than one exactly on them.
 * @param {Array<{x: number, z: number}>} a.caps every cap, world space
 * @param {ReturnType<import('./pitchMetrics.js').pitchMetrics>} a.metrics
 * @param {number} a.ballRadius
 * @param {number} a.capRadius
 * @param {typeof import('../config.js').CONFIG.respawn} a.cfg
 * @returns {{x: number, z: number, kind: string, tried: Array<{x: number, z: number, ok: boolean}>}}
 */
export function findRespawn({ ball, over = null, caps, metrics, ballRadius, capRadius, cfg }) {
  const m = metrics;
  const inset = Math.max(ballRadius, cfg.inset);
  const clearance = ballRadius + capRadius + Math.max(0, cfg.margin);

  // How far in from each line a candidate may sit. Anything beyond this is not
  // a throw-in any more, it is a pass.
  const limX = Math.max(0, m.halfX - inset);
  const limZ = Math.max(0, m.halfZ - inset);

  /**
   * Which line it crossed.
   *
   * The goal line wins when it crossed both — a ball that went out diagonally
   * past the corner flag went out at the corner, and that is a corner however
   * the touchline feels about it.
   *
   * Carried in when the caller watched the crossing happen, because the crossing
   * point sits exactly ON the line and `> halfZ` reads false there. The
   * subtraction is the fallback for a ball that was only ever seen at rest.
   */
  const overGoalLine = over ?? Math.abs(ball.z) > m.halfZ;
  const kind = overGoalLine ? RESPAWN_KIND.CORNER : RESPAWN_KIND.THROW_IN;

  const sx = ball.x >= 0 ? 1 : -1;
  const sz = ball.z >= 0 ? 1 : -1;

  let base;
  if (overGoalLine) {
    // The corner on the side it crossed at. `sx` decides the side even for a
    // ball that went out dead centre, which is arbitrary but fixed — and fixed
    // is the property that matters.
    base = { x: sx * limX, z: sz * limZ };
  } else {
    // The nearest point on the touchline, brought inboard.
    base = { x: sx * limX, z: clamp(ball.z, -limZ, limZ) };
  }

  const tried = [];
  const free = (p) => {
    const ok =
      Math.abs(p.x) <= limX + 1e-6 &&
      Math.abs(p.z) <= limZ + 1e-6 &&
      caps.every((c) => Math.hypot(p.x - c.x, p.z - c.z) >= clearance);
    tried.push({ x: p.x, z: p.z, ok });
    return ok;
  };

  // 1 ── the spot itself.
  if (free(base)) return { ...base, kind, tried };

  // 2 ── slide along the line, both ways, nearest first.
  //
  // Along Z in both cases: for a throw-in that is up and down the touchline, and
  // for a corner it walks out of the corner along the touchline rather than
  // along the goal line — which would carry it toward the goal, the one place
  // this must not put the ball. Candidates that fall outside the pitch are
  // skipped, so at a corner the outward half simply has nothing in it.
  const step = Math.max(0.2, cfg.slideStep);
  const maxSlide = Math.max(0, cfg.maxSlideFraction) * m.halfZ * 2;
  const slides = Math.floor(maxSlide / step);

  const sweep = (depth) => {
    const x = base.x - sx * depth;
    for (let i = 1; i <= slides; i++) {
      for (const dir of [-1, 1]) {
        const p = { x, z: base.z + dir * i * step };
        if (Math.abs(p.z) > limZ + 1e-6) continue;
        if (free(p)) return p;
      }
    }
    return null;
  };

  const found = sweep(0);
  if (found) return { ...found, kind, tried };

  // 3 ── push in off the line, and sweep again at each depth.
  const inward = Math.max(0.2, cfg.inwardStep);
  const depths = Math.max(0, Math.round(cfg.inwardSteps));
  for (let d = 1; d <= depths; d++) {
    const x = base.x - sx * d * inward;
    if (Math.abs(x) > limX + 1e-6) break;
    if (free({ x, z: base.z })) return { x, z: base.z, kind, tried };
    const p = sweep(d * inward);
    if (p) return { ...p, kind, tried };
  }

  // 4 ── a spiral out of the base, as the last thing to try.
  //
  // Clockwise from straight inboard, always, so two runs of the same match walk
  // the same ring of candidates in the same order.
  for (let turn = 1; turn <= SPIRAL_TURNS; turn++) {
    const radius = turn * step;
    for (let k = 0; k < SPIRAL_PER_TURN; k++) {
      const a = (k / SPIRAL_PER_TURN) * Math.PI * 2;
      const p = { x: base.x - sx * radius * Math.cos(a), z: base.z + radius * Math.sin(a) };
      if (free(p)) return { ...p, kind, tried };
    }
  }

  // Nothing was free. Put it on the base anyway rather than inventing a place
  // the player cannot account for — a ball overlapping a cap is resolved by the
  // solver in one step, and a ball teleported to the centre circle is not.
  return { ...base, kind, tried };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

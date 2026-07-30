/**
 * Opening placements for 4 v 4, as fractions of the pitch.
 *
 * ── relative, and in the PITCH's own terms ───────────────────────────────────
 * Every coordinate here is a fraction, and it is named for what it means on a
 * pitch rather than for a world axis: `along` runs goal to goal, `across` runs
 * touchline to touchline. Nothing here is in world units and nothing here knows
 * which way the pitch is lying, so the length slider can move by a factor of
 * three — and the whole pitch can be stood on end — and the formation is still
 * the same formation: keeper in front of his own goal area, wingers on the
 * flanks, instead of four caps in a heap at one end.
 *
 * `along` runs from −1 at a team's own goal line to 0 at the halfway line. Team
 * 1's placement is team 0's with both components negated, which is a 180°
 * rotation of the pitch rather than a mirror: the right winger stays the right
 * winger from that team's own point of view.
 *
 * ── the keeper is a cap that stands somewhere else ───────────────────────────
 * `role` is a label. It reaches the renderer for nothing and the rules for
 * nothing; `FootballRules` has no branch on it. The brief is explicit that the
 * keeper has no special ability, and the cheapest way to keep that true is for
 * the rules layer never to learn which cap it is.
 *
 * ── the order is part of the determinism contract ────────────────────────────
 * Bodies are created in array order and Rapier hands out handles in creation
 * order, so reordering this array reorders the world. Add to the end.
 */

/**
 * @typedef {object} Placement
 * @property {string} role    label only — see the note above
 * @property {number} along   −1 (own goal line) .. 0 (halfway) .. +1 (theirs)
 * @property {number} across  −1 (one touchline) .. +1 (the other)
 */

/** @type {Record<string, {ball: {along: number, across: number}, caps: Placement[]}>} */
export const FORMATIONS = {
  '기본 (1-3 넓게)': {
    ball: { along: 0, across: 0 },
    caps: [
      // Just outside the goal area line, which sits at −1 + 5.5/52.5 ≈ −0.895.
      { role: 'GK', along: -0.87, across: 0.0 },
      { role: 'LW', along: -0.42, across: -0.54 },
      { role: 'CF', along: -0.3, across: 0.0 },
      { role: 'RW', along: -0.42, across: 0.54 },
    ],
  },

  '공격형 (1-3 전진)': {
    ball: { along: 0, across: 0 },
    caps: [
      { role: 'GK', along: -0.87, across: 0.0 },
      { role: 'LW', along: -0.2, across: -0.44 },
      { role: 'CF', along: -0.12, across: 0.0 },
      { role: 'RW', along: -0.2, across: 0.44 },
    ],
  },

  '수비형 (1-2-1)': {
    ball: { along: 0, across: 0 },
    caps: [
      { role: 'GK', along: -0.87, across: 0.0 },
      { role: 'LB', along: -0.62, across: -0.38 },
      { role: 'RB', along: -0.62, across: 0.38 },
      { role: 'CF', along: -0.26, across: 0.0 },
    ],
  },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS);
export const DEFAULT_FORMATION = FORMATION_KEYS[0];

/**
 * A formation resolved into world-unit placements for both teams.
 *
 * Team 0 first, then team 1, keeper first within each — so cap index 0 is P1's
 * keeper and cap index 4 is P2's. Anything that wants to talk about a specific
 * cap talks about it by index, and that index is stable for a given formation.
 *
 * The one place `along`/`across` become world axes, and the only line in this
 * file that knows the pitch stands up: `along` is Z, `across` is X.
 *
 * @param {string} key
 * @param {{halfZ: number, halfX: number}} m  from `pitchMetrics`
 */
export function resolveFormation(key, m) {
  const f = FORMATIONS[key] ?? FORMATIONS[DEFAULT_FORMATION];
  const place = (p, s) => ({ x: p.across * m.halfX * s, z: p.along * m.halfZ * s });

  const caps = [];
  for (let player = 0; player < 2; player++) {
    // Team 1 is team 0 rotated by half a turn, not reflected. See above.
    const s = player === 0 ? 1 : -1;
    for (const p of f.caps) {
      caps.push({ owner: player, role: p.role, ...place(p, s) });
    }
  }

  return { caps, ball: place(f.ball, 1) };
}

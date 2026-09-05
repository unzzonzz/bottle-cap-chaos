import { Rng } from '../physics/rng.js';

/**
 * A shot, and what it does to a cap.
 *
 * ── power comes from a distance, never from a clock ──────────────────────────
 * The whole of `power` is a function of how far the bow is pulled back. There is
 * no term anywhere in this file, or upstream of it, that reads elapsed time. That
 * is the point of the input: the previous scheme ramped power while the button
 * was held and clamped at the top, so a shot could be made stronger but never
 * weaker, and "aiming" degenerated into waiting. Pull distance is bidirectional —
 * drag out, drag back, the number follows — and the only way to keep that
 * property honest is for time not to be an input at all.
 *
 * ── pure translation ─────────────────────────────────────────────────────────
 * The impulse goes through the centre of mass, via `applyImpulse`. Not through a
 * point on the cap's side at centre-of-mass HEIGHT, which is the same thing in
 * exact arithmetic and not quite the same thing in floating point — the yaw term
 * of that cross product is a difference of two products that are equal on paper
 * and can differ in the last bit. Through the centre of mass there is no cross
 * product to get wrong: the torque is zero because nothing computes one.
 *
 * The strike-height axis that used to live here is gone. It ran from the hem to
 * the crown, anchored to the centre of mass, and paired with a one-sided couple
 * to model the finger dragging over the top against the ground reaction; a high
 * strike tumbled the cap and a low one slid it. What that cost is worth writing
 * down, because it is the reason caps no longer flip when struck:
 *
 *   An impulse at a point, on its own, CANNOT flip a crown cap. The cap is 32 mm
 *   across with its centre of mass 3.9 mm up, so turning it over means walking
 *   that centre over a rim 16 mm out — a 76 degree tipping angle against a
 *   barrier of M·g·(sqrt(R²+c²) − c) ≈ 2700. The strike height buys a lever arm
 *   of at most 2.3 mm against that. Measured, the cap needs about 90 rad/s to go
 *   over and a full-power strike at the very top delivered 52. The couple was
 *   what closed the gap.
 *
 * Caps still turn over — 385 flips observed across 300 randomised shots — but
 * from falling off the rim rather than from being hit. To bring the axis back:
 * restore `heightT` on the Shot, compute `lift = (heightT - comFraction) *
 * height` and `spinMag = power * strikeSpin * max(0, offset) * radius`, apply
 * with `applyImpulseAtPoint` at `com - dir * radius` raised by `lift`, and add
 * `applyTorqueImpulse` about the board-plane perpendicular of the aim.
 *
 * ── the error cone ───────────────────────────────────────────────────────────
 * Pull buys distance and pays in accuracy. The deviation is a seeded draw from a
 * uniform distribution across the cone, uniform on purpose: the cone drawn on the
 * board is then the exact set of directions the shot can take, so what the player
 * is shown is what the player is subject to. A bell curve would make the drawn
 * edges near-unreachable and turn an honest visualisation into a lie.
 */

/**
 * @typedef {object} Shot
 * @property {number} capIndex
 * @property {number} dirX    travel direction, normalised — OPPOSITE the pull
 * @property {number} dirZ
 * @property {number} power   0..1, from pull distance alone
 * @property {number} seed    uint32; replaying with this reproduces the shot
 * @property {number} [impulseMul]  per-shot impulse scale. Absent means 1.
 * @property {number} [spreadMul]   per-shot cone scale. Absent means 1.
 */

/**
 * ── the multipliers are ON THE SHOT, not read from anywhere ─────────────────
 * Both are optional and both default to 1, so every existing record and every
 * existing call site is unchanged by their existence.
 *
 * They are fields rather than a lookup for the same reason `dirX` already
 * carries the chaos twist: `Match.replayLastTurn` re-fires from the record and
 * `config.shot`, and NOTHING else. A multiplier fetched from the card state at
 * fire time would be right in the sim and wrong in the trajectory preview —
 * which resolves the same shot against a throwaway world it has no card state
 * for — and a slider dragged between a shot and its replay would silently make
 * the replay a different shot and be reported as a determinism failure.
 *
 * Baked at the end of the gesture. See `AimInput.end`.
 */

/** Pull distance -> power, before the max-distance clamp is applied. */
export const PULL_CURVES = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
};

/** Rotate a board-plane direction about +y. Matches three.js' handedness. */
export function rotateY(x, z, radians) {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/**
 * Pull distance in world units -> power in 0..1.
 *
 * ABSOLUTE, and deliberately not scaled by the board. A shot carries the same
 * energy whatever size the board is, so a bigger board is a proportionally
 * bigger place and the same full draw gets you a smaller fraction of the way
 * across it. That is the intended relationship, not a bug to be corrected: the
 * board size is what changes, the cap and the flick do not.
 *
 * Clamped at `maxPullDistance`, so dragging past it keeps the pointer moving and
 * the number pinned at 1. The deadzone does NOT enter here: it decides whether a
 * release fires at all, not how strong the shot is, and folding it in would make
 * the weakest legal shot a zero-power one.
 */
export function pullToPower(distance, cfg) {
  const max = Math.max(0.01, cfg.maxPullDistance);
  const t = Math.min(1, Math.max(0, distance / max));
  return (PULL_CURVES[cfg.pullCurve] ?? PULL_CURVES.linear)(t);
}

/**
 * Half-angle of the error cone for a given amount of DELIVERED impulse.
 *
 * ── the argument is no longer clamped at 1, and that is the change ─────────
 * It used to take `power`, which is a pull distance and therefore cannot exceed
 * 1, so clamping was free. It now takes power SCALED BY the shot's impulse
 * multiplier — see `shotSpread` — and 강타 pushes that to 1.5. Clamping there
 * would put a ceiling on the cone at exactly the point the card is supposed to
 * start costing something.
 *
 * Below zero is still clamped: a negative multiplier is not a shot.
 */
export function spreadRadians(power, cfg) {
  const t = Math.max(0, power);
  const max = (cfg.maxSpreadDeg * Math.PI) / 180;
  return max * Math.pow(t, Math.max(0.1, cfg.spreadCurve));
}

/**
 * The half-angle a PARTICULAR shot is drawn from, boost included.
 *
 * One function, because there are two consumers that must never disagree: the
 * seeded draw in `aimAfterSpread` and the cone `AimOverlay` draws on the board.
 * The whole claim the cone makes is that it is the exact set of directions the
 * shot can take, so a second implementation of this arithmetic anywhere would
 * eventually turn that claim into a lie — and a cone that is smaller than the
 * truth is worse than no cone at all.
 *
 * ── the cone follows the IMPULSE, not the pull ─────────────────────────────
 * This read `spreadRadians(shot.power)`, and the difference matters exactly
 * once: 강타. That card multiplies the impulse and leaves the pull alone, so
 * under the old arithmetic it bought 50% more reach at the cone of whatever
 * pull was used — and the cheapest way to play it was a SHORT pull, where the
 * cone is small, boosted into a long shot. Measured against the AI, which found
 * this immediately: at power 0.54 boosted, it covered 30 units with a ±3.5°
 * cone — about one cap radius of lateral error — and landed 88% of long shots.
 * "세게 친다 대신 오차가 크게 벌어진다" was written on the card and was not true.
 *
 * Scaling by `impulseMul` makes the card's own sentence hold: the shot that
 * travels half again as far is drawn from a cone half again as wide, and a
 * short pull no longer launders the boost into free accuracy. An ordinary shot
 * is untouched — `impulseMul` is 1 and this is the identity.
 *
 * `spreadMul` stays a separate factor on top. It is the card's own accuracy
 * price, tunable independently of what the impulse did, which is the whole
 * reason the two multipliers were split apart in the first place — see
 * `CardEffects.impulseMulFor`.
 *
 * @param {{power: number, impulseMul?: number, spreadMul?: number}} shot
 */
export function shotSpread(shot, cfg) {
  const delivered = Math.max(0, shot.power) * Math.max(0, shot.impulseMul ?? 1);
  return spreadRadians(delivered, cfg) * Math.max(0, shot.spreadMul ?? 1);
}

/**
 * Impulse magnitude at this power, in g·cm/s.
 *
 * Linear in power, because the shaping already happened in `pullToPower`. A
 * second exponent here would be a second curve on the same axis, and tuning
 * either of them would move the other's meaning.
 */
export function impulseMagnitude(power, cfg) {
  return cfg.maxImpulse * Math.max(0, Math.min(1, power));
}

/**
 * Where the shot actually points, once the cone has had its say.
 *
 * Pure and seeded: called by the real sim and by the replay check, and they must
 * agree bit for bit.
 */
export function aimAfterSpread(shot, cfg) {
  const half = shotSpread(shot, cfg);
  if (half <= 0) return { x: shot.dirX, z: shot.dirZ, deviation: 0 };
  const deviation = new Rng(shot.seed).signed() * half;
  const d = rotateY(shot.dirX, shot.dirZ, deviation);
  return { x: d.x, z: d.z, deviation };
}

/**
 * The impulse a shot comes out as.
 *
 * Split out from `applyShot` because the trajectory preview needs exactly this
 * computation against a DIFFERENT world's copy of the same body, and any second
 * implementation of it would eventually disagree with the first — at which point
 * the preview stops matching the shot and there is no way to tell whether the
 * preview is wrong or the determinism is.
 *
 * Horizontal, and that is all of it. No point, no lever arm, no couple.
 *
 * The error cone's draw is always applied. There used to be a switch to leave it
 * out, for the trajectory preview to draw the un-deviated aim; the preview now
 * wants the shot that will actually happen, so nothing turns it off and the
 * branch is gone. One code path, one answer.
 */
export function resolveImpulse(shot, cfg) {
  const dir = aimAfterSpread(shot, cfg);
  // OUTSIDE `impulseMagnitude`, deliberately. That function clamps power to 1,
  // so folding the boost into `shot.power` instead would do nothing at all on a
  // full draw — and would also widen the cone through `spreadRadians`, welding
  // the two multipliers into one and making neither tunable.
  const power = impulseMagnitude(shot.power, cfg) * Math.max(0, shot.impulseMul ?? 1);

  return {
    impulse: { x: dir.x * power, y: 0, z: dir.z * power },
    dirX: dir.x,
    dirZ: dir.z,
    deviation: dir.deviation,
    power,
  };
}

/**
 * Fire, for real.
 * @returns the resolved impulse, for the HUD and for the replay record
 */
export function applyShot(arena, shot, cfg) {
  const body = arena.physics.body(arena.capBodies[shot.capIndex]);
  const r = resolveImpulse(shot, cfg);
  applyResolved(body, r);
  return r;
}

/**
 * Put a resolved shot onto a body.
 *
 * `applyImpulse`, which Rapier applies at the centre of mass — so the angular
 * part is zero by construction rather than by arithmetic that happens to cancel.
 *
 * Shared with the trajectory preview on purpose, so the line and the shot cannot
 * drift apart.
 */
export function applyResolved(body, r) {
  body.applyImpulse(r.impulse, true);
}

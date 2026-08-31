import { FIXED_DT, PhysicsWorld } from '../physics/PhysicsWorld.js';
import { seedRun } from '../physics/rng.js';
import { Match, MATCH_STATE } from '../game/Match.js';
import { modeByKey } from '../game/modes.js';
import { CONFIG_DEFAULTS } from '../game/config.js';
import { INPUT_KIND, InputLog } from './InputLog.js';

/**
 * Run an input log and report what the simulation did, in numbers.
 *
 * ── this file imports no three.js, and that is the point ────────────────────
 * `src/game/` is already free of the renderer — every file in it except
 * `AimInput` — so a match can be driven with no canvas, no WebGL and no display
 * at all. That buys the one thing the cross-machine check actually needs: the
 * same run under two JS ENGINES, headless, compared byte for byte. Two browser
 * tabs on the same machine share an engine and prove very little; Node and
 * JavaScriptCore do not.
 *
 * So nothing here may reach for the renderer, and `capDims` is a parameter
 * rather than something this derives — deriving it means importing the cap
 * geometry, which imports three.
 *
 * ── the clock is a fiction, deliberately ────────────────────────────────────
 * `pump` feeds `Match.update` exactly one `FIXED_DT` at a time. The accumulator
 * then produces exactly one step per call and lands back on precisely zero, so a
 * replay runs the same number of steps whatever the machine is doing. Feeding it
 * real frame times would reintroduce the display into a measurement whose entire
 * purpose is to show the display is not in there.
 */

/** A turn is one shot plus its settle; nothing legitimate comes close to this. */
const MAX_PUMP_STEPS = 200000;

/**
 * A fresh, unshared config.
 *
 * Cloned per run because a `Match` and its rule sets write to the thing they are
 * handed — mode overrides, tuning the panel changed — and two runs that share
 * one object are not two runs of the same match.
 */
export function replayConfig(overrides = {}) {
  const config = structuredClone(CONFIG_DEFAULTS);
  // Slow motion multiplies the time going INTO the accumulator. At 1 the pump's
  // single FIXED_DT is exactly one step; at anything else it is not, and the
  // replay would run a different number of steps than the recording.
  config.view.slowmo = 1;
  return Object.assign(config, overrides);
}

/**
 * Every dynamic body's final placement, at full precision.
 *
 * The hash answers "did these two runs agree"; this answers "where exactly did
 * they stop", which is what a mismatch report has to contain to be actionable.
 * Written as raw f64 bit patterns rather than decimals: a value printed to
 * seventeen digits and read back is the same number, and a value printed to six
 * is a different one that looks equal.
 */
export function dumpBodies(physics) {
  const handles = [];
  physics.world.forEachRigidBody((b) => {
    if (b.isFixed()) return;
    handles.push(b.handle);
  });
  handles.sort((a, b) => a - b);

  const out = [];
  handles.forEach((h, i) => {
    const b = physics.body(h);
    const t = b.translation();
    const r = b.rotation();
    out.push({
      // Position in the sorted list, not the raw handle. Rapier hands back a
      // handle that is an arena index packed into a double, so it prints as a
      // denormal like `1.5e-323` — the same value on every engine, and useless
      // in a report a human has to read. The ordinal is what identifies a body
      // across two runs anyway, since both sort the same way.
      i,
      t: [t.x, t.y, t.z],
      r: [r.x, r.y, r.z, r.w],
    });
  });
  return out;
}

/** Advance until the match is waiting for input again, or is over. */
function pump(match) {
  let n = 0;
  while (
    match.state !== MATCH_STATE.AIM &&
    match.state !== MATCH_STATE.OVER &&
    n < MAX_PUMP_STEPS
  ) {
    match.update(FIXED_DT);
    n++;
  }
  if (n >= MAX_PUMP_STEPS) {
    throw new Error(`match stuck in state "${match.state}" after ${n} pumped steps`);
  }
  return n;
}

/**
 * @param {InputLog} log
 * @param {{capDims: {radius: number, height: number}, config?: object}} opts
 * @returns a per-event trace plus the final state, all comparable across machines
 */
export function runLog(log, { capDims, config = replayConfig() }) {
  const mode = modeByKey(log.mode);
  if (!mode) throw new Error(`unknown mode "${log.mode}"`);

  const physics = new PhysicsWorld({
    solverIterations: config.physics.solverIterations,
    ccdSubsteps: config.physics.ccdSubsteps,
  });

  const match = new Match({ physics, capDims, config, mode, seed: log.seed });

  const turns = [];
  let applied = 0;
  let refused = null;

  for (const ev of log.events) {
    if (match.state === MATCH_STATE.OVER) break;
    pump(match);
    if (match.state === MATCH_STATE.OVER) break;

    // The counter as it stood when this event was recorded. See `InputLog`.
    seedRun(ev.rngState);

    if (ev.kind === INPUT_KIND.SKIP) {
      // Nothing was played and the turn passed. Recorded because the BOARD moved
      // on: every later event belongs to a different player than it would have.
      if (!match.skipTurn()) {
        refused = { seq: ev.seq, kind: ev.kind, reason: `not aiming (state=${match.state})` };
        break;
      }
      pump(match);
      turns.push({ seq: ev.seq, kind: ev.kind, hash: physics.hashState() });
    } else if (ev.kind === INPUT_KIND.CARD) {
      const res = match.playCard(ev.cardId);
      if (!res.ok) {
        // Not an error in itself — a log may outlive the hand that could play it
        // — but it ends the run, because every later event was recorded against a
        // world in which this card WAS played. Continuing would compare two
        // different matches and call the difference a determinism failure.
        refused = { seq: ev.seq, kind: ev.kind, reason: res.reason };
        break;
      }
      pump(match);
      turns.push({
        seq: ev.seq,
        kind: ev.kind,
        cardId: ev.cardId,
        hash: physics.hashState(),
      });
    } else {
      const resolved = match.fire(InputLog.shotOf(ev));
      if (!resolved) {
        refused = { seq: ev.seq, kind: ev.kind, reason: `not aiming (state=${match.state})` };
        break;
      }
      const startHash = match.startHash;
      pump(match);
      turns.push({
        seq: ev.seq,
        kind: ev.kind,
        capIndex: ev.capIndex,
        startHash,
        endHash: match.endHash,
        steps: match.lastTurn?.steps ?? 0,
        // The deviation the error cone drew. Seeded, so it is part of what has to
        // reproduce — and a mismatch HERE rather than in the hash localises the
        // failure to `shot.js` instead of to the solver.
        deviation: resolved.deviation,
        hash: physics.hashState(),
      });
    }
    applied++;
  }

  const result = {
    mode: log.mode,
    seed: log.seed,
    events: log.events.length,
    applied,
    refused,
    winner: match.winner ?? null,
    over: match.state === MATCH_STATE.OVER,
    finalHash: physics.hashState(),
    turns,
    bodies: dumpBodies(physics),
  };

  physics.free();
  return result;
}

/**
 * Fold a run into one line.
 *
 * Two machines that print the same digest agree about every turn, not only about
 * where the caps stopped: the per-turn hashes and the step counts are inside it.
 * A run that agreed only at the end would still be a broken guarantee — it would
 * mean the turns diverged and happened to converge, which cannot be relied on.
 */
export function digestOf(result) {
  const parts = [
    result.mode,
    result.seed,
    result.applied,
    result.winner,
    result.finalHash,
    ...result.turns.map((t) => `${t.seq}:${t.kind}:${t.hash}:${t.steps ?? ''}:${t.endHash ?? ''}`),
    ...result.bodies.map((b) => `${b.i}:${b.t.join(',')}:${b.r.join(',')}`),
  ];
  const text = parts.join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

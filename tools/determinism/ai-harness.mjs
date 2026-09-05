/**
 * The AI, played against itself, headless and reproducibly.
 *
 * ── why this is a SECOND harness and not a case in the first one ────────────
 * `harness.mjs` replays an `InputLog`: a recorded list of shots, generated once
 * and then fed to the simulation on every engine. That is exactly right for what
 * it proves — the same inputs make the same world — and it is structurally
 * unable to test an AI, because an AI is not an input. It is the thing that
 * DECIDES the input, and a recorded log has already decided.
 *
 * So this drives `AiController` for both seats and records what the AI chose, in
 * the order it chose it. The digest therefore covers a strictly larger surface
 * than the replay one: the physics AND the search that steered it. A weight that
 * changed, a candidate that got truncated one place earlier, a sort that tied
 * differently — none of those move `harness.mjs`'s digests and all of them move
 * these.
 *
 * Nothing here is imported by the game and nothing in the game imports it. The
 * existing harness is untouched: its three fixtures still produce the digests
 * they produced before this file existed, which is the property that makes it
 * usable as a regression baseline while the AI is being built.
 *
 * ── the clock is a fiction, exactly as it is next door ──────────────────────
 * `FIXED_DT` per pump, so the presentation phases advance a fixed number of
 * frames and the search gets a fixed number of slices. Wall-clock still reaches
 * the planner through `frameBudgetMs`, and by design that changes only HOW LONG
 * the search takes rather than what it decides — `maxCandidates` is the budget.
 * `cutShort` is the case where that stops being true, so it is counted and
 * reported rather than absorbed: a run with a non-zero `cutShort` is not a
 * reproducible run and its digest means nothing.
 *
 * ── the baseline ───────────────────────────────────────────────────────────
 * `npm run det:ai` prints one digest per fixture. These are the reference; a
 * change to the search that moves either of them changed how the AI plays, and
 * that is either the point of the change or a regression:
 *
 *     knockout  seed=1a2b3c4d  digest=2b19511a  final=ca2f3be5   30 turns
 *     football  seed=5e6f7a8b  digest=449d0891  final=a0ac2e07   28 turns
 *
 * Football's fixture asks for 40 and stops at 28 because the MATCH ENDS: the AI
 * wins it 3–0 inside the fixture, which is the shortest statement of "this thing
 * plays football" available. A change that makes the run last longer is a change
 * that made the AI worse at scoring, and the turn count is inside the digest.
 *
 * The knockout one is load-bearing beyond its own mode. It is what proved the
 * strategy extraction was a pure refactor — same digest before and after the
 * planner stopped importing `evaluateSurvival` by name — which `harness.mjs`
 * structurally cannot check, because its fixtures are recorded shots and a
 * recorded shot has already decided.
 *
 * `npm run det:ai:stats` adds the play metrics: goals, own goals, how often the
 * turn touched the ball, how far the ball moved toward the net being attacked,
 * and the search's own timing.
 *
 * ── and it reproduces, which is the thing being claimed ────────────────────
 * The same seed run twice in one process, twenty football turns each:
 *
 *     run A  digest=595e634d  final=9492d967
 *     run B  digest=595e634d  final=9492d967
 *
 * Identical, which is what `maxCandidates` being a COUNT rather than a deadline
 * buys — see the header in `ai/AiPlanner.js`. Two runs of a wall-clock-budgeted
 * search would not agree, and `?seed=` would stop reproducing a match.
 *
 *   usage:  node tools/determinism/ai-harness.mjs [run|stats] [--mode=football]
 *                                                 [--turns=N] [--decisions]
 */

import { initRapier } from '../../src/physics/rapier.js';
import { FIXED_DT, PhysicsWorld } from '../../src/physics/PhysicsWorld.js';
import { Match, MATCH_STATE } from '../../src/game/Match.js';
import { modeByKey } from '../../src/game/modes.js';
import { replayConfig } from '../../src/replay/ReplayRunner.js';
import { AiController } from '../../src/game/ai/Controller.js';
import { capDimsHeadless } from './capDims.mjs';
import { pathToFileURL } from 'node:url';

/**
 * Fixed per mode, as `harness.mjs`'s are, so a re-run reproduces the fixture.
 *
 * `turns` is a CEILING rather than a count — a match that reaches
 * `football.winningGoals` ends and the run stops there. Football's 40 currently
 * yields 28 because the AI wins 3–0 before reaching it.
 */
export const AI_FIXTURES = {
  knockout: { seeds: [0x1a2b3c4d], turns: 30 },
  football: { seeds: [0x5e6f7a8b], turns: 40 },
};

/** A turn is one shot plus its settle plus the AI's whole reveal sequence. */
const MAX_FRAMES_PER_TURN = 40000;

/**
 * `replayConfig` with the search's safety valve lifted.
 *
 * ── the valve is a frame-rate protection, and there are no frames here ──────
 * `totalBudgetMs` exists so a pathologically slow device cannot hang a turn, and
 * `AiPlanner` is explicit that tripping it means "this turn is not reproducible"
 * — the search abandoned its configured candidate list part-way, so which
 * candidates it saw became a fact about the machine. Measured on this harness at
 * the shipped 2500 ms: one turn in thirty tripped it, and that one turn would
 * make the digest depend on how busy the laptop was.
 *
 * A determinism fixture cannot contain that. Headless there is nothing to
 * protect — no frame is being rendered and nobody is waiting — so the valve is
 * opened and the run is allowed to take as long as the configured
 * `maxCandidates` actually costs. `cutShort` is still counted and still
 * reported, and a run that trips it even here is a real problem rather than a
 * slow machine.
 *
 * Nothing else is touched, so the SEARCH is the shipped one: same
 * `maxCandidates`, same weights, same waves, same probe and reply pools.
 */
export function aiConfig(overrides = {}) {
  const config = replayConfig();
  config.ai.totalBudgetMs = Number.MAX_SAFE_INTEGER;
  return Object.assign(config, overrides);
}

/**
 * Play one AI-vs-AI match and report every decision.
 *
 * @param {object} o
 * @param {string} o.mode
 * @param {number} o.seed
 * @param {number} o.turns   stop after this many AI turns
 * @param {{radius: number, height: number}} o.capDims
 */
export function runAiMatch({ mode: modeKey, seed, turns, capDims, config = aiConfig() }) {
  const mode = modeByKey(modeKey);
  const physics = new PhysicsWorld({
    solverIterations: config.physics.solverIterations,
    ccdSubsteps: config.physics.ccdSubsteps,
  });
  const match = new Match({ physics, capDims, config, mode, seed });
  const controllers = [new AiController(0, config), new AiController(1, config)];

  const decisions = [];
  const stats = {
    turns: 0,
    cutShort: 0,
    generated: 0,
    evaluated: 0,
    cards: 0,
    /** Turns in which the ball ended up somewhere other than where it started. */
    ballTouched: 0,
    /** Turns that moved neither the ball nor any opponent cap. */
    idle: 0,
    goals: [0, 0],
    ownGoals: 0,
    ballOut: 0,
    thinkMsMax: 0,
    /** Every turn's search time, for a distribution rather than a worst case. */
    thinkMs: [],
    /**
     * World units the ball moved toward the goal the SHOOTER was attacking,
     * summed. §10.3's first question — "does it push the ball at its own net" —
     * is this number's sign, and it is the one failure mode that would still
     * look busy on every other stat.
     */
    advance: 0,
    /** Turns where that was negative: the ball ended up nearer their own net. */
    wrongWay: 0,
    /** Turns whose shooter was the cap closest to their OWN goal at the time. */
    keeperShots: 0,
    /**
     * Idle turns split by whether the ball was REACHABLE when the turn opened.
     *
     * ── "무의미 턴" is two different failures wearing one number ─────────────
     * The brief's metric is "touched neither the ball nor an opponent cap", and
     * on this pitch that conflates two things with opposite fixes. Measured cap
     * travel tops out at 20.9 units at full power on a pitch 64 long, so a ball
     * that is 40 units from every one of my caps CANNOT be touched this turn by
     * anybody — walking a cap toward it is the correct move and scores as idle.
     *
     * `idleReachable` is the one that means something is wrong: the ball was
     * inside one flick and the turn still did not reach it. That is the number
     * that says to fix candidate generation rather than weights.
     */
    idleReachable: 0,
    idleUnreachable: 0,
  };

  /** Full-power cap travel, measured on this pitch. See `config.ai.perMode`. */
  const FLICK_REACH = 21;

  const snap = () => {
    const caps = [];
    for (let i = 0; i < match.arena.capCount; i++) {
      const c = match.arena.capCom(i);
      caps.push({ x: c.x, z: c.z });
    }
    const b = match.arena.ballCom();
    return { caps, ball: b ? { x: b.x, z: b.z } : null };
  };
  const moved = (a, b, eps) => Math.hypot(a.x - b.x, a.z - b.z) > eps;

  let frames = 0;
  while (stats.turns < turns && match.state !== MATCH_STATE.OVER) {
    const player = match.rules.currentPlayer;
    const controller = controllers[player];
    const before = snap();
    const scoreBefore = mode.key === 'football' ? match.rules.score.slice() : null;

    controller.begin({ match });

    // Drive the AI's phases and the sim together, exactly as `main.js` does.
    let n = 0;
    while (controller.phase !== 'idle' && n++ < MAX_FRAMES_PER_TURN) {
      controller.update(FIXED_DT, { match });
      match.update(FIXED_DT);
      frames++;
    }
    if (n >= MAX_FRAMES_PER_TURN) throw new Error(`AI turn never finished (mode=${modeKey})`);

    // Then let the turn settle and whatever follows it play out.
    let m = 0;
    while (
      match.state !== MATCH_STATE.AIM &&
      match.state !== MATCH_STATE.OVER &&
      m++ < MAX_FRAMES_PER_TURN
    ) {
      match.update(FIXED_DT);
      frames++;
    }
    if (m >= MAX_FRAMES_PER_TURN) throw new Error(`turn never settled (mode=${modeKey})`);

    const plan = controller.plan;
    const after = snap();
    stats.turns++;
    if (controller.planner.cutShort) stats.cutShort++;
    stats.generated += controller.planner.generated;
    stats.evaluated += controller.planner.evaluated;
    stats.cards += controller.cardsPlayed?.length ?? 0;
    stats.thinkMsMax = Math.max(stats.thinkMsMax, controller.thinkMs);
    stats.thinkMs.push(controller.thinkMs);

    /**
     * ── which way did the ball actually go ────────────────────────────────
     * Toward the net this player is attacking, in world units. It is the one
     * measurement that catches an AI busily shovelling the ball at its own
     * goal: every other stat here would call that a productive turn.
     */
    if (before.ball && after.ball && mode.key === 'football') {
      // The net this player attacks: player 0 defends −Z, so they attack +Z.
      // `FootballPitch._buildGoal` is where that sign is decided.
      const halfZ = match.arena.layout.metrics.halfZ;
      const target = { x: 0, z: player === 0 ? halfZ : -halfZ };
      const own = { x: 0, z: player === 0 ? -halfZ : halfZ };
      const to = (p, g) => Math.hypot(p.x - g.x, p.z - g.z);
      const gain = to(before.ball, target) - to(after.ball, target);
      stats.advance += gain;
      if (gain < -0.05) stats.wrongWay++;
      // Which cap was nearest their own net when the turn opened.
      let keeper = -1;
      let nd = Infinity;
      for (let i = 0; i < before.caps.length; i++) {
        if (match.arena.capOwner[i] !== player) continue;
        const d = to(before.caps[i], own);
        if (d < nd) { nd = d; keeper = i; }
      }
      if (plan && plan.shot.capIndex === keeper) stats.keeperShots++;
    }

    /**
     * "Did this turn do anything", measured on the BOARD rather than on the
     * plan. A candidate whose intent says `ball` and which then misses is an
     * idle turn, and the intent would have called it an attack.
     */
    const ballMoved = before.ball && after.ball && moved(before.ball, after.ball, 0.05);
    const foeMoved = before.caps.some(
      (p, i) => match.arena.capOwner[i] !== player && moved(p, after.caps[i], 0.05),
    );
    if (ballMoved) stats.ballTouched++;
    if (!ballMoved && !foeMoved) {
      stats.idle++;
      if (before.ball) {
        let nearest = Infinity;
        for (let i = 0; i < before.caps.length; i++) {
          if (match.arena.capOwner[i] !== player) continue;
          nearest = Math.min(
            nearest,
            Math.hypot(before.caps[i].x - before.ball.x, before.caps[i].z - before.ball.z),
          );
        }
        if (nearest <= FLICK_REACH) stats.idleReachable++;
        else stats.idleUnreachable++;
      }
    }

    if (scoreBefore) {
      const s = match.rules.score;
      for (let p = 0; p < 2; p++) if (s[p] > scoreBefore[p]) stats.goals[p] += s[p] - scoreBefore[p];
      // The scorer is whoever does NOT defend the goal it went into, so a goal
      // credited to the side that did not shoot is an own goal.
      if (s[1 - player] > scoreBefore[1 - player]) stats.ownGoals++;
    }

    decisions.push({
      turn: stats.turns,
      player,
      capIndex: plan?.shot.capIndex ?? -1,
      // Six digits: enough that a different decision is visible, few enough that
      // the line is readable. The HASH is what the comparison rests on.
      dirX: plan ? plan.shot.dirX.toFixed(6) : '',
      dirZ: plan ? plan.shot.dirZ.toFixed(6) : '',
      power: plan ? plan.shot.power.toFixed(6) : '',
      intent: plan?.entry.candidate.intent ?? '',
      cards: (controller.cardsPlayed ?? []).join('+'),
      hash: physics.hashState(),
    });
  }

  const result = {
    mode: modeKey,
    seed,
    frames,
    finalHash: physics.hashState(),
    decisions,
    stats,
  };
  physics.free();
  return result;
}

/**
 * Fold a run into one line.
 *
 * Every decision is in it, not only the final position: an AI that reached the
 * same board by different moves has still changed, and a digest that only
 * covered the endpoint would call that a pass.
 */
export function aiDigest(result) {
  const text = [
    result.mode,
    result.seed,
    result.finalHash,
    ...result.decisions.map(
      (d) => `${d.turn}:${d.player}:${d.capIndex}:${d.dirX}:${d.dirZ}:${d.power}:${d.cards}:${d.hash}`,
    ),
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ── cli ────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

/**
 * Only when this file is what was RUN.
 *
 * `runAiMatch` and `aiConfig` are exported so a tuning sweep can drive many
 * matches with different weights in one process — and without this guard,
 * importing them ran the whole default fixture first. Which is not a subtle
 * failure: the sweep printed a knockout digest it never asked for and then sat
 * there, because the CLI's own `await` at module scope blocks the importer
 * until the fixture finishes.
 */
const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (!isMain) {
  // Imported as a library. Nothing runs; the caller drives.
} else {
  const cmd = process.argv[2] ?? 'run';
  await initRapier();
  const capDims = await capDimsHeadless();
  const only = arg('mode', null);
  const modes = only ? [only] : Object.keys(AI_FIXTURES);
  const turnsOverride = arg('turns', null);

  if (cmd === 'run' || cmd === 'stats') {
    console.log(`engine: node ${process.version} (V8 ${process.versions.v8})`);
    for (const modeKey of modes) {
      const f = AI_FIXTURES[modeKey];
      if (!f) throw new Error(`no AI fixture for mode "${modeKey}"`);
      const turns = turnsOverride ? Number(turnsOverride) : f.turns;
      for (const seed of f.seeds) {
        const r = runAiMatch({ mode: modeKey, seed, turns, capDims });
        const s = r.stats;
        console.log(
          `  ${modeKey.padEnd(9)} seed=${seed.toString(16)} digest=${aiDigest(r)}  ` +
            `final=${r.finalHash}  turns=${s.turns}` +
            (s.cutShort ? `  CUT-SHORT x${s.cutShort}` : ''),
        );
        if (cmd === 'stats') {
          const pct = (n) => `${((100 * n) / Math.max(1, s.turns)).toFixed(1)}%`;
          const t = s.thinkMs.slice().sort((a, b) => a - b);
          const q = (f) => t[Math.min(t.length - 1, Math.floor(f * t.length))] ?? 0;
          console.log(
            `      evaluated ${s.evaluated}/${s.generated} (${(s.evaluated / Math.max(1, s.turns)).toFixed(0)}/turn)` +
              `  cards ${s.cards}` +
              `  think p50 ${q(0.5).toFixed(0)} p95 ${q(0.95).toFixed(0)} max ${s.thinkMsMax.toFixed(0)} ms`,
          );
          if (modeKey === 'football') {
            const total = s.goals[0] + s.goals[1];
            console.log(
              `      goals ${s.goals[0]}:${s.goals[1]} (${total} in ${s.turns} turns)` +
                `  own ${s.ownGoals}` +
                (total ? ` (${((100 * s.ownGoals) / total).toFixed(0)}% of goals)` : '') +
                `  ball touched ${pct(s.ballTouched)}  idle ${pct(s.idle)}` +
                ` (reachable ${pct(s.idleReachable)} / out of range ${pct(s.idleUnreachable)})`,
            );
            console.log(
              `      advance ${(s.advance / Math.max(1, s.turns)).toFixed(2)} units/turn` +
                `  wrong-way ${pct(s.wrongWay)}  keeper shots ${pct(s.keeperShots)}`,
            );
            const ii = Object.entries(s.idleIntents).sort((a, b) => b[1] - a[1]);
            if (ii.length) {
              console.log(
                `      idle turns were trying: ${ii.map(([k, v]) => `${k} x${v}`).join(', ')}`,
              );
            }
          } else {
            console.log(`      idle ${pct(s.idle)}`);
          }
        }
        if (process.argv.includes('--decisions')) {
          for (const d of r.decisions) {
            console.log(
              `      t${String(d.turn).padStart(2)} p${d.player} cap${d.capIndex} ` +
                `pow ${d.power} ${d.intent.padEnd(16)} ${d.cards.padEnd(20)} ${d.hash}`,
            );
          }
        }
      }
    }
  } else {
    console.error('usage: ai-harness.mjs [run|stats] [--mode=X] [--turns=N] [--decisions]');
    process.exit(2);
  }
}

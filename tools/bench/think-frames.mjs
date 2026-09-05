/**
 * How long the AI's turn makes the player WAIT, in wall clock.
 *
 * ── the harness next door measures the wrong thing for this question ────────
 * `ai-harness.mjs` reports `thinkMs`, which is solver time, and solver time is
 * not what anybody sits through: the search is sliced across rendered frames, so
 * the wait is `thinkMs` divided by the share of each frame the search gets. That
 * share is the thing `ThinkBudget` and `ai.thinkFrameMs` exist to set, and it
 * cannot be read off a number that has frames divided out of it.
 *
 * So this counts FRAMES — how many times `AiController.update` is called while
 * the phase is `think` or `replan` — and multiplies by what a frame costs. Two
 * things are modelled rather than measured, because Node has no display:
 *
 *   OTHER_MS   what the frame costs without the search: render, physics, HUD.
 *   PERIOD     the refresh interval, and it is applied as a QUANTUM rather than
 *              a floor. `requestAnimationFrame` is aligned to vsync, so a frame
 *              that runs one millisecond over its interval waits for the whole
 *              of the next one — model it as a floor and a budget that overruns
 *              looks free when it actually costs 8.3 ms.
 *
 * `FLAT=1` pins `thinkFrameMs` to 0, which is the flat `frameBudgetMs` slice the
 * adaptive budget replaced. That is the A/B:
 *
 *     FLAT=1 node tools/bench/think-frames.mjs 12 4 16.7    # 60 Hz, before
 *            node tools/bench/think-frames.mjs 12 4 16.7    # 60 Hz, after
 *            node tools/bench/think-frames.mjs 12 4 8.33    # 120 Hz, after
 *
 * It is a bench and not a test: nothing here is asserted and the numbers move
 * with the machine. What must NOT move is `npm run det:ai` — the budget changes
 * how long the search takes and never what it decides, and that is the check.
 *
 *   usage:  node tools/bench/think-frames.mjs [turns] [otherMs] [periodMs]
 */
import { initRapier } from '../../src/physics/rapier.js';
import { FIXED_DT, PhysicsWorld } from '../../src/physics/PhysicsWorld.js';
import { Match, MATCH_STATE } from '../../src/game/Match.js';
import { modeByKey } from '../../src/game/modes.js';
import { AiController } from '../../src/game/ai/Controller.js';
import { aiConfig } from '../determinism/ai-harness.mjs';
import { ThinkBudget } from '../../src/game/ai/ThinkBudget.js';
import { capDimsHeadless } from '../determinism/capDims.mjs';

await initRapier();
const capDims = await capDimsHeadless();

const TURNS = Number(process.argv[2] ?? 12);
/** What the rest of the frame costs on the machine being modelled, ms. */
const OTHER_MS = Number(process.argv[3] ?? 4);
/** Display period, ms. */
const PERIOD = Number(process.argv[4] ?? 16.7);
for (const [modeKey, seed] of [['knockout', 0x1a2b3c4d], ['football', 0x5e6f7a8b]]) {
  const config = aiConfig();
  if (process.env.FLAT) config.ai.thinkFrameMs = 0;
  const mode = modeByKey(modeKey);
  const physics = new PhysicsWorld({
    solverIterations: config.physics.solverIterations,
    ccdSubsteps: config.physics.ccdSubsteps,
  });
  const match = new Match({ physics, capDims, config, mode, seed });
  const controllers = [new AiController(0, config), new AiController(1, config)];
  const think = [], show = [], ms = [];
  const budget = new ThinkBudget();
  for (let i = 0; i < 40; i++) budget.note(OTHER_MS, 0, PERIOD);

  let turns = 0;
  while (turns < TURNS && match.state !== MATCH_STATE.OVER) {
    const c = controllers[match.rules.currentPlayer];
    c.begin({ match });
    let tf = 0, sf = 0, n = 0;
    while (c.phase !== 'idle' && n++ < 40000) {
      if (c.phase === 'think' || c.phase === 'replan') tf++;
      else sf++;
      c.update(FIXED_DT, { match, thinkBudget: budget });
      match.update(FIXED_DT);
    }
    while (match.state !== MATCH_STATE.AIM && match.state !== MATCH_STATE.OVER) match.update(FIXED_DT);
    think.push(tf); show.push(sf); ms.push(c.thinkMs);
    turns++;
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const perFrame = sum(ms) / sum(think);
  // rAF is vsync-aligned: a frame that overruns waits for the next interval.
  const frameLen = PERIOD * Math.max(1, Math.ceil((perFrame + OTHER_MS) / PERIOD));
  console.log(
    `${modeKey.padEnd(9)} think ${med(think)} frames x ${frameLen.toFixed(1)}ms = ` +
      `${((med(think) * frameLen) / 1000).toFixed(2)}s   ` +
      `(solver ${med(ms).toFixed(0)}ms at ${perFrame.toFixed(1)}ms/frame, ` +
      `${((100 * perFrame) / frameLen).toFixed(0)}% duty, ${(1000 / frameLen).toFixed(0)} fps)`,
  );
  physics.free();
}

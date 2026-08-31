import { FIXED_DT, PhysicsWorld } from '../physics/PhysicsWorld.js';
import { nextSeed, peekSeed, Rng } from '../physics/rng.js';
import { Match, MATCH_STATE } from '../game/Match.js';
import { modeByKey } from '../game/modes.js';
import { InputLog } from './InputLog.js';
import { replayConfig } from './ReplayRunner.js';

/**
 * Manufacture an input log by playing a match with a scripted hand.
 *
 * ── why a generated log and not a recorded one ──────────────────────────────
 * The cross-engine check needs a log that is long, that hits every mode, and
 * that is identical on both machines before either of them starts. A log
 * recorded from real play is all three of those only by luck: it is however long
 * somebody felt like playing, and getting the identical file onto the second
 * machine is a file transfer that can itself go wrong. A generator takes a seed.
 *
 * It is not a substitute for recording real play — `InputLog` records that, and
 * the debug panel exports it. It is what makes the check reproducible.
 *
 * ── the script's randomness is NOT the match's ─────────────────────────────
 * Shot directions and powers come from a private `Rng` seeded by `scriptSeed`.
 * They must not come from `nextSeed()`, which is the match's own stream: drawing
 * the script's choices out of it would make the CHOICE of shot depend on how
 * many cards happened to be played, and a generator whose output shifts when the
 * game logic changes is not a fixture.
 *
 * The one thing that does come from the match's stream is each shot's own seed,
 * via `nextSeed()` — because that is where `AimInput` takes it from, and the
 * point of this log is to be indistinguishable from a recorded one.
 */

/**
 * @param {object} opts
 * @param {string} opts.mode        a `MODES` key
 * @param {number} opts.seed        the match's root seed
 * @param {number} opts.scriptSeed  chooses the shots; independent of the match
 * @param {number} [opts.turns]     how many inputs to attempt
 * @param {number} [opts.cardChance] 0..1, how often to play a held card
 * @param {number} [opts.powerMin]  weakest shot the script will take, 0..1
 * @param {number} [opts.powerMax]  strongest
 * @param {{radius: number, height: number}} opts.capDims
 */
export function generateLog({
  mode: modeKey,
  seed,
  scriptSeed,
  turns = 24,
  cardChance = 0.25,
  powerMin = 0.45,
  powerMax = 1,
  capDims,
}) {
  const mode = modeByKey(modeKey);
  if (!mode) throw new Error(`unknown mode "${modeKey}"`);

  const config = replayConfig();
  const physics = new PhysicsWorld({
    solverIterations: config.physics.solverIterations,
    ccdSubsteps: config.physics.ccdSubsteps,
  });
  const match = new Match({ physics, capDims, config, mode, seed });
  const log = new InputLog({ mode: modeKey, seed: match.seed, label: `synth/${modeKey}` });
  const script = new Rng(scriptSeed >>> 0);

  const pump = () => {
    let n = 0;
    while (match.state !== MATCH_STATE.AIM && match.state !== MATCH_STATE.OVER && n < 200000) {
      match.update(FIXED_DT);
      n++;
    }
  };

  for (let i = 0; i < turns; i++) {
    pump();
    if (match.state === MATCH_STATE.OVER) break;

    const player = match.rules.currentPlayer;

    // A card first, sometimes, so the log exercises the effects as well as the
    // solver. Recorded BEFORE the counter moves — `recordCard` reads `peekSeed`.
    if (mode.cards !== false && script.float() < cardChance) {
      const hand = match.hands.get(player) ?? [];
      if (hand.length) {
        const pick = hand[Math.floor(script.float() * hand.length) % hand.length];
        const cardId = typeof pick === 'string' ? pick : pick.cardId;
        if (cardId) {
          const before = peekSeed();
          const res = match.playCard(cardId);
          if (res.ok) {
            log.events.push({
              seq: log.events.length,
              kind: 'card',
              player,
              rngState: before,
              cardId,
            });
            pump();
            if (match.state === MATCH_STATE.OVER) break;
          }
        }
      }
    }

    const capIndex = match.shooter;
    if (capIndex < 0) break;

    // The heading is a unit vector from an angle, exactly as the aim input
    // produces one, rather than a normalised random pair — which would put a
    // division in the log's provenance for no benefit.
    const angle = script.signed() * Math.PI;
    const shot = {
      capIndex,
      dirX: Math.cos(angle),
      dirZ: Math.sin(angle),
      // Never a limp tap: a shot that does not reach anything settles in a dozen
      // steps and tests nothing. The range is per mode, because the two that end
      // by knocking caps off the board end in three turns at full power — and a
      // log that stops early tests the solver for three turns. Weaker shots there
      // buy a long game full of contacts, which is where a divergence shows up.
      power: powerMin + script.float() * (powerMax - powerMin),
      seed: nextSeed(),
    };

    const shooterPlayer = match.rules.currentPlayer;
    log.recordShot(shooterPlayer, shot);
    if (!match.fire(shot)) break;
    pump();
  }

  const result = {
    log,
    finalHash: physics.hashState(),
    winner: match.winner ?? null,
    over: match.state === MATCH_STATE.OVER,
  };
  physics.free();
  return result;
}

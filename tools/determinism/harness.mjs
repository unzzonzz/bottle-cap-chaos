/**
 * The determinism check, as a program.
 *
 * ── what this has to prove, and why two tabs would not prove it ─────────────
 * Online play here is lockstep: the server relays inputs, never state, and both
 * clients simulate. That rests entirely on the claim that the same seed and the
 * same inputs produce the same world everywhere. If the claim is false the
 * failure is not a crash — it is two players watching different games and
 * neither of them being told.
 *
 * So the check is run under two different JAVASCRIPT ENGINES rather than two
 * browsers, because two browsers is usually one engine wearing two hats, and
 * because the engine is where the risk lives: `Math.sin`, `Math.pow`, `atan2`
 * and `hypot` are "implementation-approximated" in the language spec and DO
 * differ between V8 and JavaScriptCore. Rapier itself is WebAssembly compiled
 * from Rust with its own libm, so it is not exposed to that; the JS above it is.
 *
 * ── the shape of the run ────────────────────────────────────────────────────
 *   emit  — generate one log per mode from fixed seeds and write them out
 *   run   — load those logs, simulate, print a digest per mode
 *   check — do both and compare against a previously written result file
 *
 * Generation happens ONCE, on one machine. Every engine then loads the identical
 * log file. A generator run separately on each machine would be testing the
 * generator as well as the simulation, and a mismatch could not be attributed.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initRapier } from '../../src/physics/rapier.js';
import { InputLog } from '../../src/replay/InputLog.js';
import { runLog, digestOf } from '../../src/replay/ReplayRunner.js';
import { generateLog } from '../../src/replay/synthLog.js';
import { MODE_KEYS } from '../../src/game/modes.js';
import { capDimsHeadless } from './capDims.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = join(HERE, 'logs');

/**
 * Fixed per mode, so re-running the generator reproduces the same fixtures.
 *
 * Two independent numbers because they steer different things: `seed` is the
 * match's luck (orbs, cards, the error cone) and `script` is which shots get
 * taken. Sharing one would couple them, and a change to how many draws the game
 * makes would then silently change the shots as well.
 */
const FIXTURES = {
  // Gentle shots: at full power a random heading puts a cap off the board almost
  // every turn and the match is over in three, which would leave the check
  // reading a three-turn simulation.
  knockout: { seed: 0x1a2b3c4d, script: 0x51ee0001, turns: 40, cardChance: 0.3, power: [0.15, 0.5] },
  // Nothing leaves the field here, so the shots can be as hard as they like —
  // and hard shots are the interesting ones: more contacts, more solver work.
  football: { seed: 0x5e6f7a8b, script: 0x51ee0002, turns: 40, cardChance: 0.3, power: [0.45, 1] },
  // Cards are off in curling by design (`mode.cards === false`), and a throw
  // that overshoots the table is out — so the same restraint as knockout.
  curling: { seed: 0x9c0d1e2f, script: 0x51ee0003, turns: 40, cardChance: 0, power: [0.15, 0.5] },
};

function logPath(mode) {
  return join(LOG_DIR, `${mode}.json`);
}

async function emit() {
  mkdirSync(LOG_DIR, { recursive: true });
  const capDims = await capDimsHeadless();
  for (const mode of MODE_KEYS) {
    const f = FIXTURES[mode];
    if (!f) throw new Error(`no fixture for mode "${mode}"`);
    const { log, over, winner } = generateLog({
      mode,
      seed: f.seed,
      scriptSeed: f.script,
      turns: f.turns,
      cardChance: f.cardChance,
      powerMin: f.power[0],
      powerMax: f.power[1],
      capDims,
    });
    writeFileSync(logPath(mode), log.serialize());
    console.log(
      `emitted ${mode}: ${log.length} events` +
        (over ? `, match ended (winner=${winner})` : ', match still running'),
    );
  }
}

async function run({ json = false, wire = false } = {}) {
  const capDims = await capDimsHeadless();
  const engine =
    typeof process !== 'undefined' && process.versions?.node
      ? `node ${process.version} (V8 ${process.versions.v8})`
      : 'unknown';

  const out = { engine, capDims, modes: {} };
  for (const mode of MODE_KEYS) {
    const path = logPath(mode);
    if (!existsSync(path)) throw new Error(`missing log ${path} — run "emit" first`);
    const log = InputLog.parse(readFileSync(path, 'utf8'));
    const result = runLog(log, { capDims });
    out.modes[mode] = {
      digest: digestOf(result),
      finalHash: result.finalHash,
      applied: result.applied,
      events: result.events,
      over: result.over,
      winner: result.winner,
      refused: result.refused,
      turns: result.turns,
      bodies: result.bodies,
    };
  }

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  if (wire) {
    // Byte-for-byte the format `jsc-entry.js` prints, so the two engines' output
    // can be compared with `diff` and a mismatch points at a body or a turn
    // rather than at a digest that says only "somewhere".
    const lines = [`engine: ${engine}`, `capDims: r=${capDims.radius} h=${capDims.height}`];
    for (const mode of MODE_KEYS) {
      const m = out.modes[mode];
      lines.push(
        `  ${mode.padEnd(9)} digest=${m.digest}  final=${m.finalHash}  ` +
          `turns=${m.applied}/${m.events}  bodies=${m.bodies.length}` +
          (m.refused ? `  REFUSED@${m.refused.seq}: ${m.refused.reason}` : ''),
      );
      for (const b of m.bodies) {
        lines.push(`#BODY ${mode} ${b.i} ${b.t.join(' ')} ${b.r.join(' ')}`);
      }
      for (const t of m.turns) {
        lines.push(`#TURN ${mode} ${t.seq} ${t.kind} ${t.hash} ${t.steps ?? ''} ${t.endHash ?? ''}`);
      }
    }
    console.log(lines.join('\n'));
    return out;
  }

  console.log(`engine: ${engine}`);
  console.log(`capDims: r=${capDims.radius} h=${capDims.height}`);
  for (const mode of MODE_KEYS) {
    const m = out.modes[mode];
    console.log(
      `  ${mode.padEnd(9)} digest=${m.digest}  final=${m.finalHash}  ` +
        `turns=${m.applied}/${m.events}  bodies=${m.bodies.length}` +
        (m.refused ? `  REFUSED@${m.refused.seq}: ${m.refused.reason}` : ''),
    );
  }
  return out;
}

const cmd = process.argv[2] ?? 'run';
await initRapier();

if (cmd === 'emit') {
  await emit();
} else if (cmd === 'run') {
  await run({ json: process.argv.includes('--json'), wire: process.argv.includes('--wire') });
} else if (cmd === 'dump') {
  // Full per-turn detail for one mode, for diffing a failure by hand.
  const mode = process.argv[3];
  const capDims = await capDimsHeadless();
  const log = InputLog.parse(readFileSync(logPath(mode), 'utf8'));
  console.log(JSON.stringify(runLog(log, { capDims }), null, 2));
} else {
  console.error(`usage: harness.mjs [emit|run|dump <mode>] [--json]`);
  process.exit(2);
}

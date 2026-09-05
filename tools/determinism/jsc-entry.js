/**
 * The same check, built to run under JavaScriptCore's `jsc` shell.
 *
 * ── why this file exists at all ─────────────────────────────────────────────
 * The Node harness proves the simulation is reproducible under V8. That is half
 * an answer: V8 is also what Chrome and Edge run, so "it matches on two machines"
 * could still mean "it matches on two copies of the same engine". The interesting
 * question is whether Safari agrees, and Safari is JavaScriptCore.
 *
 * It matters because the language does not promise it. `Math.sin`, `cos`, `pow`,
 * `atan2` and `hypot` are specified as implementation-approximated, and V8 and
 * JSC really do return different last bits for them — measured, not assumed.
 * Everything downstream of those calls is a candidate for divergence.
 *
 * ── the shell is not a browser and needs a little furniture ─────────────────
 * `jsc` has WebAssembly and `atob`, which is what Rapier's inlined module needs,
 * but no `console`, no `TextDecoder`, and no `structuredClone`. Each is
 * polyfilled below with the smallest thing that is actually correct. None of
 * them touch arithmetic, so none of them can influence the result being measured.
 *
 * The logs are imported as JSON and inlined by the bundler, so this runs with no
 * filesystem: `jsc` has one, but reading files from it differs between versions
 * and the check should not fail for that reason.
 */

/* eslint-disable no-undef */

// FIRST: installs console/TextDecoder/structuredClone before any other module
// is evaluated. See the file for why it cannot be inline here.
import './jsc-polyfills.js';

import { initRapier } from '../../src/physics/rapier.js';
import { InputLog } from '../../src/replay/InputLog.js';
import { runLog, digestOf } from '../../src/replay/ReplayRunner.js';
import { buildCapGeometry } from '../../src/cap/capGeometry.js';

import knockoutLog from './logs/knockout.json';
import footballLog from './logs/football.json';
import curlingLog from './logs/curling.json';

const LOGS = { knockout: knockoutLog, football: footballLog, curling: curlingLog };

function capDims() {
  const g = buildCapGeometry();
  return { radius: g.userData.radius, height: g.userData.height };
}

async function main() {
  await initRapier();
  const dims = capDims();
  const lines = [];
  lines.push('engine: JavaScriptCore (jsc)');
  lines.push(`capDims: r=${dims.radius} h=${dims.height}`);
  for (const mode of ['knockout', 'football', 'curling']) {
    const log = InputLog.parse(LOGS[mode]);
    const result = runLog(log, { capDims: dims });
    lines.push(
      `  ${mode.padEnd(9)} digest=${digestOf(result)}  final=${result.finalHash}  ` +
        `turns=${result.applied}/${result.events}  bodies=${result.bodies.length}` +
        (result.refused ? `  REFUSED@${result.refused.seq}: ${result.refused.reason}` : ''),
    );
    // The full body dump, so a mismatch can be localised to a cap rather than
    // just observed. Prefixed so the comparison script can pick it out.
    for (const b of result.bodies) {
      lines.push(`#BODY ${mode} ${b.i} ${b.t.join(' ')} ${b.r.join(' ')}`);
    }
    for (const t of result.turns) {
      lines.push(`#TURN ${mode} ${t.seq} ${t.kind} ${t.hash} ${t.steps ?? ''} ${t.endHash ?? ''}`);
    }
  }
  print(lines.join('\n'));
}

main().catch((e) => {
  print('FAILED: ' + (e && e.stack ? e.stack : e));
});

// `jsc` exits when the script returns, before pending microtasks run, so an
// async main would otherwise produce no output at all. This is the shell's
// documented way to flush them.
if (typeof drainMicrotasks === 'function') drainMicrotasks();

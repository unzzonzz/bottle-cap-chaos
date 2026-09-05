import { initRapier } from '../../src/physics/rapier.js';
import { InputLog } from '../../src/replay/InputLog.js';
import { runLog, digestOf } from '../../src/replay/ReplayRunner.js';
import { buildCapGeometry } from '../../src/cap/capGeometry.js';

import knockoutLog from './logs/knockout.json';
import footballLog from './logs/football.json';
import curlingLog from './logs/curling.json';

/**
 * The same check, in a real browser.
 *
 * ── what this adds over the two headless engines ────────────────────────────
 * The Node and `jsc` runs already compare V8 against JavaScriptCore, which is
 * the arithmetic question. This one answers a different and smaller question:
 * whether the BROWSER environment changes anything the shells did not have —
 * a different WebAssembly tier-up path, a different module loader, a bundler
 * between the source and the engine.
 *
 * It should be boring, and boring is the result worth having. Open it on two
 * machines and compare the three digests by eye.
 */

const LOGS = { knockout: knockoutLog, football: footballLog, curling: curlingLog };

const digestsEl = document.getElementById('digests');
const outEl = document.getElementById('out');

async function main() {
  await initRapier();
  const g = buildCapGeometry();
  const capDims = { radius: g.userData.radius, height: g.userData.height };

  const lines = [`engine: ${navigator.userAgent}`, `capDims: r=${capDims.radius} h=${capDims.height}`];
  const summary = [];

  for (const mode of ['knockout', 'football', 'curling']) {
    const log = InputLog.parse(LOGS[mode]);
    const result = runLog(log, { capDims });
    const digest = digestOf(result);
    summary.push(
      `<span class="mode">${mode.padEnd(9)}</span> digest=<b>${digest}</b> final=${result.finalHash}`,
    );
    lines.push(
      `  ${mode.padEnd(9)} digest=${digest}  final=${result.finalHash}  ` +
        `turns=${result.applied}/${result.events}  bodies=${result.bodies.length}` +
        (result.refused ? `  REFUSED@${result.refused.seq}: ${result.refused.reason}` : ''),
    );
    for (const b of result.bodies) {
      lines.push(`#BODY ${mode} ${b.i} ${b.t.join(' ')} ${b.r.join(' ')}`);
    }
    for (const t of result.turns) {
      lines.push(`#TURN ${mode} ${t.seq} ${t.kind} ${t.hash} ${t.steps ?? ''} ${t.endHash ?? ''}`);
    }
  }

  digestsEl.innerHTML = summary.join('<br>');
  outEl.textContent = lines.join('\n');

  // Report back, if asked to. `?report=<url>` only — never on by default, so
  // opening this page is never a network call the reader did not ask for.
  // It exists so a browser that cannot be scripted (Safari, or a phone on the
  // same network) can still be compared automatically instead of by eye.
  const report = new URLSearchParams(location.search).get('report');
  if (report) {
    fetch(report, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: lines.join('\n'),
    }).catch(() => {});
  }
  // For the automated comparison — read off the page rather than scraped from
  // the rendered text, which wraps.
  globalThis.__BCC_WIRE__ = lines.join('\n');
  globalThis.__BCC_DONE__ = true;
}

main().catch((e) => {
  digestsEl.innerHTML = `<span class="bad">FAILED: ${e.message}</span>`;
  outEl.textContent = e.stack ?? String(e);
  globalThis.__BCC_DONE__ = true;
  globalThis.__BCC_WIRE__ = `FAILED: ${e.stack ?? e}`;
});

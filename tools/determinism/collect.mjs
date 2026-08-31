/**
 * Catch the result a browser posts back, and diff it against this machine's.
 *
 * ── why a collector rather than reading the screen ─────────────────────────
 * The check has to run in browsers that cannot be driven programmatically —
 * Safari here, and a phone on the same network later, which is the case that
 * actually matters for "두 기기에서 같은 결과". Reading a digest off a screen is
 * slow, manual, and exactly the kind of comparison that gets eyeballed as equal
 * when it is not. Posting the full dump and diffing it is neither.
 *
 *   node tools/determinism/collect.mjs
 *
 * then open the URL it prints on the other browser or the other device.
 */

import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initRapier } from '../../src/physics/rapier.js';
import { InputLog } from '../../src/replay/InputLog.js';
import { runLog, digestOf } from '../../src/replay/ReplayRunner.js';
import { MODE_KEYS } from '../../src/game/modes.js';
import { capDimsHeadless } from './capDims.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.COLLECT_PORT) || 7788;

/** This machine's answer, to compare arrivals against. */
async function localWire() {
  await initRapier();
  const capDims = await capDimsHeadless();
  const lines = [];
  for (const mode of MODE_KEYS) {
    const path = join(HERE, 'logs', `${mode}.json`);
    if (!existsSync(path)) throw new Error(`missing log ${path} — run "harness.mjs emit" first`);
    const result = runLog(InputLog.parse(readFileSync(path, 'utf8')), { capDims });
    lines.push(
      `  ${mode.padEnd(9)} digest=${digestOf(result)}  final=${result.finalHash}  ` +
        `turns=${result.applied}/${result.events}  bodies=${result.bodies.length}`,
    );
    for (const b of result.bodies) lines.push(`#BODY ${mode} ${b.i} ${b.t.join(' ')} ${b.r.join(' ')}`);
    for (const t of result.turns) {
      lines.push(`#TURN ${mode} ${t.seq} ${t.kind} ${t.hash} ${t.steps ?? ''} ${t.endHash ?? ''}`);
    }
  }
  return lines;
}

/** Every address this machine can be reached on, so a phone can find it. */
function addresses() {
  const out = [];
  for (const [, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

const mine = await localWire();
const mineComparable = mine.filter((l) => l.startsWith('#') || l.includes('digest='));

const server = createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method !== 'POST') return res.writeHead(404).end();

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    res.writeHead(204).end();
    const theirs = body.split('\n');
    const engine = theirs.find((l) => l.startsWith('engine:')) ?? 'engine: (unknown)';

    // Written down before anything is printed. The verdict below is the useful
    // output and it is also the easiest thing to lose — the collector runs in
    // the background and whatever holds it can be killed between the POST
    // arriving and the console flushing. A file survives that.
    try {
      mkdirSync(join(HERE, 'received'), { recursive: true });
      const tag =
        (engine.match(/(Chrome|Firefox|Version)\/(\d+)/) ?? [, 'engine', '0']).slice(1).join('-') +
        (/Electron/.test(engine) ? '-electron' : '');
      writeFileSync(join(HERE, 'received', `${tag}.txt`), body);
    } catch {
      /* the report is a convenience; never fail a run over it */
    }
    const comparable = theirs.filter((l) => l.startsWith('#') || l.includes('digest='));

    console.log('\n────────────────────────────────────────────────────────');
    console.log(engine);
    for (const l of theirs.filter((l) => l.includes('digest='))) console.log(l);

    const diffs = [];
    const n = Math.max(mineComparable.length, comparable.length);
    for (let i = 0; i < n; i++) {
      if (mineComparable[i] !== comparable[i]) {
        diffs.push(`  line ${i}\n    here:  ${mineComparable[i] ?? '(missing)'}\n    there: ${comparable[i] ?? '(missing)'}`);
      }
    }
    if (!diffs.length) {
      console.log(`\n  ✅ MATCH — ${mineComparable.length}/${mineComparable.length} lines identical`);
    } else {
      console.log(`\n  ❌ MISMATCH — ${diffs.length} of ${n} lines differ`);
      console.log(diffs.slice(0, 12).join('\n'));
      if (diffs.length > 12) console.log(`  … and ${diffs.length - 12} more`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`collector on :${PORT}, holding ${mineComparable.length} comparable lines`);
  console.log('open this on the other browser / device (dev server must be running):\n');
  const dev = process.env.DEV_ORIGIN || 'http://<this-machine>:5173';
  for (const a of ['localhost', ...addresses()]) {
    const origin = dev.replace('<this-machine>', a).replace('localhost', a);
    console.log(`  ${origin}/tools/determinism/browser.html?report=http://${a}:${PORT}/`);
  }
  console.log('');
});

/**
 * Give every mode route a real file, because a static host has no router.
 *
 * ── the menu navigates with `location.assign`, not `pushState` ──────────────
 * That is a deliberate choice made elsewhere — `main.js` fades the screen out
 * and then loads the next page, and the game and the menu are genuinely
 * different documents. It means a mode's address is a real HTTP request, and on
 * GitHub Pages a request for `/midsummer-alkkagi/football` with no such file is a
 * 404. Not on a deep link or a refresh: on the FIRST navigation out of the menu,
 * which is the only way anybody reaches a mode.
 *
 * `modes.js` anticipated this in as many words — "on a static host that
 * implements the route by putting a copy of the page in a directory it is
 * `/football/index.html`" — and this is that, done after the build.
 *
 * ── the list comes from `modes.js`, never from a literal here ───────────────
 * A fourth mode is meant to be "one entry in `modes.js` and two files". If the
 * routes were spelled out in this script that would quietly become three files,
 * and the one that got forgotten would fail only in production and only on the
 * new mode. So this asks the modes themselves, through `modePath`, which is
 * already the single place a URL segment is written down.
 *
 * ── it is a COPY, and every copy is byte-identical ─────────────────────────
 * The page does not vary by route: `modeKeyFromPath` reads `location.pathname`
 * at runtime and loads whichever mode the address names. So there is nothing to
 * template, and a copy keeps the 200 that a `404.html` fallback would not — a
 * crawler, an uptime check or a share preview all read the status code, and a
 * page that works while reporting "not found" is a page that reports it to
 * everything except the person looking at it.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MODE_KEYS, modePath } from '../src/game/modes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const INDEX = join(DIST, 'index.html');

if (!existsSync(INDEX)) {
  console.error(`no ${INDEX} — run "vite build" first`);
  process.exit(1);
}

const written = [];
for (const key of MODE_KEYS) {
  const segment = modePath(key);
  // A mode with no path is not routable and needs no file. There are none
  // today; the guard is here so adding one is not a crash in a deploy job.
  if (!segment) continue;
  const dir = join(DIST, segment);
  mkdirSync(dir, { recursive: true });
  copyFileSync(INDEX, join(dir, 'index.html'));
  written.push(`${segment}/index.html`);
}

console.log(`pages routes: ${written.length ? written.join(', ') : 'none'}`);

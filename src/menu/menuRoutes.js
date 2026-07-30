import { isModePath, modePath } from '../game/modes.js';

/**
 * Where the menu's items go, and how the game gets back here.
 *
 * ── the menu is the ROOT ────────────────────────────────────────────────────
 * `/` is the menu, `/survival` `/football` `/curling` are the three games, and
 * that is the whole route table.
 *
 * It was the other way round — `/` opened knockout and the menu lived behind
 * `?view=menu` — which put the game at the front door and made the menu the
 * special case. Turning it round makes the menu the thing an address without an
 * opinion resolves to, and that is worth more than it sounds: there is now no
 * "menu route" to recognise at all. A path either names a mode or it does not,
 * and everything that does not — `/`, `/menu`, `?view=menu`, a typo, a stale
 * bookmark — is the menu, with no aliases written down anywhere.
 *
 * ── the segment is not the mode's key ──────────────────────────────────────
 * `/survival` runs the mode whose key is `knockout`. See the note on
 * `MODES.knockout.path`; `modePath` is the only thing that turns one into the
 * other, and it lives with the modes rather than here.
 *
 * ── destinations are resolved RELATIVE to where the menu is ─────────────────
 * `/football` hard-coded would be wrong the moment this is deployed anywhere
 * but a domain root. So the base is the menu's own path with any mode segment
 * and any `menu` segment stripped off the end, and the destinations hang off
 * that. Under `/bottle-cap-chaos/` the football item goes to
 * `/bottle-cap-chaos/football`, which is the same reasoning `modeKeyFromPath`
 * gives for searching the path backwards.
 *
 * ── `from=menu` is the handover flag ────────────────────────────────────────
 * The transition cannot survive a document swap on its own: the menu page is
 * torn down at the moment the cap is covering the screen, and something on the
 * other side has to pick the animation up mid-flight. That flag is the whole of
 * the protocol — `main.js` reads it, paints the page the cap's own colour
 * before it does anything else, and plays stage 4 out of its own overlay.
 */

/**
 * The menu's OLD address, kept for one job only: stripping.
 *
 * `/menu` is no longer a route — it is simply a path that names no mode, which
 * the new rule already resolves to the menu. But an old link can still land
 * there, and `basePath` has to take the segment off or the 서바이벌 item would
 * lead to `/menu/survival`. It is a legacy segment to discard, not a route to
 * recognise.
 */
const LEGACY_MENU_SEGMENT = 'menu';

/**
 * Set by the menu just before it navigates, read by the game as it starts.
 *
 * The flag is exported because `main.js` strips it from the address bar once
 * stage 4 has played — a refresh should not replay a transition that has
 * already happened — and a magic string in two files is a magic string.
 */
export const HANDOVER_FLAG = 'from';
const HANDOVER_VALUE = 'menu';
/**
 * The same flag, the other way round: this page arrived from a match.
 *
 * The outbound trip needed a flag because the cap's flight had to be picked up
 * mid-air on the far side. The return trip needs one for the milder version of
 * the same problem: the game fades to black before it navigates, so the menu has
 * to fade back IN or the arrival is a hard cut from black to a fully lit menu —
 * and it must do that ONLY when it was arrived at that way. Typing the menu's
 * address, or refreshing it, is not a transition and must not open with one.
 */
const RETURN_VALUE = 'game';

/** The path with any trailing mode segment, or a legacy `menu`, removed. */
function basePath(pathname = location.pathname) {
  const segments = String(pathname || '/').split('/');
  while (segments.length > 1) {
    const last = segments[segments.length - 1].toLowerCase();
    if (last === '' || last === LEGACY_MENU_SEGMENT || isModePath(last)) segments.pop();
    else break;
  }
  return `${segments.join('/')}/`.replace(/\/{2,}$/, '/');
}

/**
 * There is no `isMenuRoute` any more, and its absence is the point.
 *
 * It used to hunt for a `menu` segment or a `view=menu` query, so every new way
 * of writing the menu's address was another clause in it. The menu is now
 * whatever `modeKeyFromPath` returns null for, which `main.js` already has to
 * compute to know which mode to load — so the question answers itself at the one
 * place the decision is made, and there is no second predicate to keep in step
 * with the first.
 */

/** Is this page the far side of a menu transition? */
export function isHandover(loc = location) {
  return new URLSearchParams(loc.search).get(HANDOVER_FLAG) === HANDOVER_VALUE;
}

/** Is this page the far side of a match's fade back to the menu? */
export function isReturnFromGame(loc = location) {
  return new URLSearchParams(loc.search).get(HANDOVER_FLAG) === RETURN_VALUE;
}

/**
 * The URL a menu item leads to.
 *
 * `debug=1` is carried across deliberately. Someone tuning the transition needs
 * the panel on BOTH sides of it — the half that plays on the game page is the
 * half that is hardest to catch.
 */
export function destinationUrl(id, loc = location) {
  const base = basePath(loc.pathname);
  const search = new URLSearchParams(loc.search);
  const debug = search.get('debug') === '1';

  const params = new URLSearchParams();
  params.set(HANDOVER_FLAG, HANDOVER_VALUE);
  if (debug) params.set('debug', '1');

  // Every mode has a segment now, knockout's included — it is `/survival`, not
  // the root. The root is the menu, so there is no longer a mode to special-case
  // as "the one that lives at the base".
  return `${base}${modePath(id)}?${params.toString()}`;
}

/** The URL back to the menu, from wherever the game happens to be served. */
export function menuUrl(loc = location) {
  const search = new URLSearchParams();
  /**
   * Every caller of this fades to black first — the corner HUD's 나가기 and the
   * victory screen's, and there is no third way out of a match. So the flag goes
   * on here rather than at the two call sites: the fade and the fade back are one
   * transition, and a URL built by one half that the other half cannot recognise
   * is how they end up looking different.
   */
  search.set(HANDOVER_FLAG, RETURN_VALUE);
  if (new URLSearchParams(loc.search).get('debug') === '1') search.set('debug', '1');
  return `${basePath(loc.pathname)}?${search.toString()}`;
}

/**
 * Ask the browser to fetch the destination now, while stage 1 is still running.
 *
 * The gap between `location.assign` and the new document's first paint is the
 * one place the brief's "로딩 노출이 없다" can be broken, and it is not under
 * this code's control once the navigation has started. What IS under its
 * control is starting the fetch four hundred milliseconds early, which is most
 * of a shake. `prefetch` rather than `modulepreload` because the destination is
 * a DOCUMENT — the module graph behind it is the browser's problem, and it will
 * warm what it needs.
 *
 * Best-effort by construction: an unsupported `rel` is ignored by the browser
 * and the transition is unaffected, which is why nothing here checks.
 */
export function prefetch(url) {
  if (document.querySelector(`link[data-menu-prefetch="${CSS.escape(url)}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.as = 'document';
  link.href = url;
  link.dataset.menuPrefetch = url;
  document.head.appendChild(link);
}

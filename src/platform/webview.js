/**
 * The browser's own gestures, turned off at the document.
 *
 * ── what this is NOT ───────────────────────────────────────────────────────────
 * Most of the job is already done, declaratively, in `styles.css`, and
 * duplicating it here would only hide where the real switch is:
 *
 *   scroll / rubber band   `touch-action: none` + `position: fixed` on body
 *   pull to refresh        `overscroll-behavior: none`, same pair
 *   double-tap zoom        `touch-action: none` — `manipulation` would leave it
 *   long-press callout     `-webkit-touch-callout: none`
 *   text selection         `user-select: none`
 *
 * What is left is the handful with no CSS form: three WebKit-only events, and
 * three DOM defaults that fire even with selection disabled.
 *
 * ── this is not a mobile file ─────────────────────────────────────────────────
 * It reads like one because the gestures it names were first met on a phone, and
 * every one of them survives on the desktop the game now targets. `gesture*` is
 * how Safari — macOS Safari included — reports a trackpad pinch, and it predates
 * `touch-action`, so that property does not cover it. `contextmenu` is the
 * right-click menu. `dragstart` is what turns a slow press on a canvas into a
 * drag of the rendered image. None of those needs a touch screen.
 */

/** A press inside one of these must keep every default it has. */
function isTextField(target) {
  const tag = target?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable === true;
}

/**
 * Install the guards. Idempotent, and safe to call before anything else exists.
 *
 * Called at module scope from main.js, which is the single entry for all three
 * pages (the viewer, the menu and a match), so every document gets it — and gets
 * it before `initRapier()` resolves, which is when the first presses arrive.
 */
export function hardenWebView(doc = globalThis.document) {
  if (!doc || doc.__msaHardened) return;
  doc.__msaHardened = true;

  const block = (e) => {
    if (isTextField(e.target)) return;
    e.preventDefault();
  };

  /**
   * `gesturestart` / `gesturechange` / `gestureend` — WebKit only.
   *
   * Safari synthesises these from a two-finger gesture — a trackpad pinch on a
   * Mac — and they are the events that drive its page zoom. They are NOT
   * covered by `touch-action: none`: that property governs the standard
   * touch-action machinery, and these predate it. Without this the game's own
   * pinch-to-zoom, which the router builds from two pointers, fights the page
   * zoom for the same two fingers.
   *
   * Non-passive by necessity: a passive listener may not preventDefault, and
   * preventing the default IS the entire point.
   */
  const opts = { passive: false };
  doc.addEventListener('gesturestart', block, opts);
  doc.addEventListener('gesturechange', block, opts);
  doc.addEventListener('gestureend', block, opts);

  /**
   * The double-click's own default — selecting the word under the pointer, and
   * on some browsers a zoom.
   *
   * `touch-action: none` already stops the touch path; this is the mouse one,
   * which is the path that actually matters now.
   */
  doc.addEventListener('dblclick', block, opts);

  /**
   * The right-click / long-press menu, at the DOCUMENT.
   *
   * `PointerRouter` already blocks this on the canvas, and that was enough while
   * the canvas was the only thing under the pointer. It is not: the canvas is
   * letterboxed to 4:3, so any window that is not 4:3 shows bars of bare
   * document beside or above it, and a right-click there raised the menu over
   * the game.
   */
  doc.addEventListener('contextmenu', block, opts);

  /**
   * Selection and drag, which survive `user-select: none`.
   *
   * `user-select: none` stops a selection being PAINTED; it does not stop the
   * events firing, and WebKit still starts a drag of whatever is under the
   * pointer — on a canvas, that is a drag of the rendered image, which is very
   * easy to trigger by accident while aiming.
   */
  doc.addEventListener('selectstart', block, opts);
  doc.addEventListener('dragstart', block, opts);
}

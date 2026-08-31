/**
 * The web view's own gestures, turned off at the document.
 *
 * ── what this is NOT ───────────────────────────────────────────────────────────
 * Most of the job is already done and done better elsewhere, and duplicating it
 * here would only hide where the real switch is:
 *
 *   scroll / rubber band   `touch-action: none` + `position: fixed` on body
 *                          (styles.css), and `ios.scrollEnabled: false` in
 *                          capacitor.config.json, which turns it off on the
 *                          WKWebView's own UIScrollView.
 *   double-tap zoom        `touch-action: none` — `manipulation` would leave it.
 *   pinch zoom             `ios.zoomEnabled: false` in capacitor.config.json.
 *   long-press callout     `-webkit-touch-callout: none` (styles.css) and
 *                          `ios.allowsLinkPreview: false`.
 *   text selection         `user-select: none` (styles.css).
 *   the system edge swipes `preferredScreenEdgesDeferringSystemGestures` in
 *                          ios/App/App/GameViewController.swift.
 *
 * What is left is the handful that has no CSS or config form: three WebKit-only
 * events, and two DOM defaults that fire even with selection disabled. That is
 * all this file does. It exists so the browser build behaves like the packaged
 * one — every switch above except `touch-action` is native, and none of them is
 * in effect when the game is opened in mobile Safari for a quick check.
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
  if (!doc || doc.__bccHardened) return;
  doc.__bccHardened = true;

  const block = (e) => {
    if (isTextField(e.target)) return;
    e.preventDefault();
  };

  /**
   * `gesturestart` / `gesturechange` / `gestureend` — WebKit only.
   *
   * Safari synthesises these from a two-finger touch and they are the events
   * that drive its page zoom. They are NOT covered by `touch-action: none`:
   * that property governs the standard touch-action machinery, and these
   * predate it. Without this the game's own pinch-to-zoom — which the router
   * builds from two pointers — fights the page zoom for the same two fingers.
   *
   * Non-passive by necessity: a passive listener may not preventDefault, and
   * preventing the default IS the entire point.
   */
  const opts = { passive: false };
  doc.addEventListener('gesturestart', block, opts);
  doc.addEventListener('gesturechange', block, opts);
  doc.addEventListener('gestureend', block, opts);

  /**
   * The double-tap zoom's mouse-event shadow.
   *
   * `touch-action: none` already stops the touch path. This catches the case
   * where the web view has decided the input is a mouse — a trackpad on iPadOS,
   * or a desktop browser being used to check the build.
   */
  doc.addEventListener('dblclick', block, opts);

  /**
   * The right-click / long-press menu, at the DOCUMENT.
   *
   * `PointerRouter` already blocks this on the canvas, and that was enough while
   * the canvas was the only thing under a finger. It is not: the canvas is
   * letterboxed to 4:3, so a phone shows bars of bare document beside or above
   * it, and a long press there raised the menu over the game.
   */
  doc.addEventListener('contextmenu', block, opts);

  /**
   * Selection and drag, which survive `user-select: none`.
   *
   * `user-select: none` stops a selection being PAINTED; it does not stop the
   * events firing, and on a long press WebKit still starts a drag of whatever is
   * under the finger — on a canvas, that is a drag of the rendered image.
   */
  doc.addEventListener('selectstart', block, opts);
  doc.addEventListener('dragstart', block, opts);
}

import { PALETTE, withAlpha } from '../core/palette.js';

/**
 * The palette, pushed into CSS custom properties.
 *
 * ── why the stylesheet cannot just have the colours in it ───────────────────
 * Almost none of this game's UI is DOM — the HUD, the cards, the menu plates and
 * the victory screen are all meshes with canvas textures — so `styles.css` is a
 * short file that dresses four things: the letterbox around the 4:3 canvas, the
 * page fade, the nickname `<input>` the Hangul IME needs a real field for, and
 * the two developer overlays. Four things is few enough that hardcoding six hex
 * values there looks harmless, and it is exactly how the palette got scattered
 * in the first place. A colour that lives in two files is a colour that will be
 * changed in one of them.
 *
 * So the stylesheet names `var(--bcc-*)` and never a literal, and this module is
 * the only thing that writes them.
 *
 * ── the unstyled gap, and why it is fine now ────────────────────────────────
 * `main.js` is a module, so it runs after the document has been parsed, and for
 * the frame or two before this function is called those variables do not exist.
 * A `var()` with no fallback resolves to the property's initial value, which for
 * a background is transparent — so the page starts as the browser's own white
 * and then becomes the palette's own near-white surround.
 *
 * That was NOT survivable under the old scheme, where the same gap was a flash
 * of white before a near-black UI, and it is the reason the old stylesheet hard
 * coded `#000000` at the top. Inverting the scheme inverted the hazard: white to
 * light blue is a transition nobody will see. Fallbacks would put the values
 * back in two places to solve a problem that no longer exists.
 *
 * The one thing this cannot cover is the paint BEFORE the web view has any
 * document at all — the native splash. That colour lives in
 * `capacitor.config.json` and in the Android resources, and there is no way to
 * make those read a JavaScript module; they are called out in `docs/palette.md`
 * as the two places that have to be changed by hand alongside this file.
 */
export function applyCssPalette(root = document.documentElement) {
  const set = (name, value) => root.style.setProperty(name, value);

  // The letterbox. Sky rather than a neutral, so the bars either side of the
  // canvas read as the scene continuing past the frame instead of as a border.
  set('--bcc-void', PALETTE.bg.skyTop);
  set('--bcc-text', PALETTE.ui.text);
  // 닉네임 필드의 플레이스홀더. 의사 요소라 인라인으로 쓸 수 없어서 여기 있다.
  set('--bcc-text-muted', PALETTE.ui.textMuted);
  set('--bcc-edge', PALETTE.ui.edge);
  set('--bcc-surface', PALETTE.ui.surface);
  set('--bcc-accent', PALETTE.accent.cyan);

  // Leaving a match for the menu. Fades to the UI's own surface, not to black —
  // the menu's first frame is a bright page and this is the seam into it.
  set('--bcc-fade', PALETTE.ui.surface);

  // ── developer overlays ─────────────────────────────────────────────────────
  // `?debug=1` only. Kept in the palette anyway: a metrics panel that does not
  // match the game it is measuring is a panel you misread at a glance, and this
  // one is read on a phone in bright light, which is what the opaque plate and
  // the heavy ink are for.
  set('--bcc-debug-bg', withAlpha(PALETTE.ui.surface, 0.86));
  set('--bcc-debug-edge', PALETTE.ui.edgeStrong);
  set('--bcc-debug-ink', PALETTE.ui.text);
  set('--bcc-debug-accent', PALETTE.accent.greenDeep);
  set('--bcc-debug-warn-ink', PALETTE.accent.orangeDeep);
  set('--bcc-debug-warn-edge', PALETTE.accent.orange);

  // The WASM either loads or it does not, and a blank canvas says neither.
  set('--bcc-error-bg', withAlpha(PALETTE.ui.dangerPale, 0.96));
  set('--bcc-error-edge', PALETTE.ui.danger);
  set('--bcc-error-ink', PALETTE.ui.dangerDeep);
}

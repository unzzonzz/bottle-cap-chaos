import { PALETTE, withAlpha } from '../core/palette.js';
import { MOTION } from '../core/tokens.js';

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
 * So the stylesheet names `var(--msa-*)` and never a literal, and this module is
 * the only thing that writes them.
 *
 * ── the unstyled gap, and why it is fine now ────────────────────────────────
 * `main.js` is a module, so it runs after the document has been parsed, and for
 * the frame or two before this function is called those variables do not exist.
 * A `var()` with no fallback resolves to the property's initial value, which for
 * a background is transparent — so the page would start as the browser's own
 * white and then become the void's cobalt.
 *
 * That was NOT survivable under the first scheme, where the same gap was a flash
 * of white before a near-black UI, and it is the reason the old stylesheet hard
 * coded `#000000` at the top. Inverting the scheme softened the hazard; the
 * handover then sharpened it again, because the two documents now meet on a
 * single flat cobalt and a white frame between them is exactly the flash the
 * covered frame exists to remove. So `--msa-void` DOES carry a fallback, in
 * `styles.css`, and that rule states its own reasoning. Everything else here
 * still needs none.
 *
 * The one thing this cannot cover is the paint BEFORE the stylesheet has been
 * applied — the browser's own initial canvas. `index.html` pins that with
 * `<meta name="color-scheme" content="light">`, which is why a reload does not
 * flash dark. That meta tag is the one place outside this module with an opinion
 * about the background, and `docs/palette.md` names it.
 */
export function applyCssPalette(root = document.documentElement) {
  const set = (name, value) => root.style.setProperty(name, value);

  // The letterbox. Sky rather than a neutral, so the bars either side of the
  // canvas read as the scene continuing past the frame instead of as a border.
  set('--msa-void', PALETTE.bg.skyTop);
  set('--msa-text', PALETTE.ui.text);
  // 닉네임 필드의 플레이스홀더. 의사 요소라 인라인으로 쓸 수 없어서 여기 있다.
  set('--msa-text-muted', PALETTE.ui.textMuted);
  set('--msa-edge', PALETTE.ui.edge);
  set('--msa-surface', PALETTE.ui.surface);
  set('--msa-accent', PALETTE.cobalt);

  // Leaving a match for the menu. Fades to the UI's own surface, not to black —
  // the menu's first frame is a bright page and this is the seam into it.
  set('--msa-fade', PALETTE.ui.surface);
  /**
   * 그 페이드의 길이. `MOTION.screen` 은 왕복이므로 절반이 한 방향이다.
   *
   * 숫자가 세 곳(`pageFade.js`, `styles.css`, 토큰)에 적혀 있었다. 스타일시트는
   * 모듈을 읽지 못하므로 이 함수가 다리를 놓는다 — 이제 고칠 곳은 토큰 하나다.
   */
  set('--msa-fade-ms', `${(MOTION.screen / 2) * 1000}ms`);

  // ── developer overlays ─────────────────────────────────────────────────────
  // `?debug=1` only. Kept in the palette anyway: a metrics panel that does not
  // match the game it is measuring is a panel you misread at a glance, and this
  // one is read on a phone in bright light, which is what the opaque plate and
  // the heavy ink are for.
  set('--msa-debug-bg', withAlpha(PALETTE.ui.surface, 0.86));
  set('--msa-debug-edge', PALETTE.ui.edgeStrong);
  set('--msa-debug-ink', PALETTE.ui.text);
  set('--msa-debug-accent', PALETTE.accent.greenDeep);
  set('--msa-debug-warn-ink', PALETTE.accent.terracottaDeep);
  set('--msa-debug-warn-edge', PALETTE.accent.terracotta);

  // The WASM either loads or it does not, and a blank canvas says neither.
  set('--msa-error-bg', withAlpha(PALETTE.ui.dangerPale, 0.96));
  set('--msa-error-edge', PALETTE.ui.danger);
  set('--msa-error-ink', PALETTE.ui.dangerDeep);
}

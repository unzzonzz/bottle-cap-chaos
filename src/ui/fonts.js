import { FONT_WEIGHTS } from '../core/tokens.js';

/**
 * The type family, and the gate that stops textures being baked before it loads.
 *
 * ── the bug this exists to prevent ──────────────────────────────────────────
 * Every piece of type in this game is baked into a canvas texture and cached —
 * `hudTextures`, `cardTexture`, `fxTextures` and `markIcons` all hold maps keyed
 * on content. If the first frame draws before the webfont is ready, those
 * textures are baked with the FALLBACK face and then cached, and the real font
 * never appears no matter how long you wait. Nothing invalidates them, because
 * from the cache's point of view nothing changed.
 *
 * It was survivable while the alpha threshold was flattening every glyph to hard
 * 0/255 — the bundled face and the fallback looked more alike after thresholding
 * than before. That threshold is gone, so the difference is obvious and this is
 * load-bearing. It became more so with the face change: Gowun Dodum's strokes
 * are noticeably lighter than any system fallback, so a texture baked early is
 * not merely the wrong shape, it is the wrong WEIGHT next to one baked late.
 *
 * ── the registry, rather than importing the four caches ─────────────────────
 * This module could import `clearHudTextureCache` and its three siblings
 * directly. It does not, because the menu page does not load `cardTexture` and
 * importing it here would drag the card face, the card back and the guide frame
 * onto a page that draws a bottle. Each caching module registers itself instead,
 * which also means a NEW cache is opted in by one line at its own definition
 * rather than by remembering to edit this file.
 */

/**
 * The stack.
 *
 * `MSA Sans` is the bundled subset of **Gowun Dodum** — see `NOTICE`. It leads
 * because it is the only entry guaranteed to be there; everything after it is
 * what a machine falls back to while the woff2 is still in flight, and every one
 * of them has Hangul.
 *
 * ── it was Pretendard, and the swap is the direction, not a preference ─────
 * Pretendard is a Korean-first humanist sans with a full weight range, and the
 * note here used to argue for it on exactly that basis: the aero look is usually
 * described with Frutiger, Myriad and Segoe UI, none of which has any Hangul, so
 * a humanist sans with a wide weight axis was the closest available voice.
 *
 * The new direction wants the opposite of a wide axis. §5 asks for a display
 * voice and a utility voice far apart, and it settles the display half by
 * DRAWING it (`ui/lettering.js`); what is left for the face is the utility half,
 * where "quiet, small, precise" is the whole brief. Gowun Dodum is a single
 * weight with slightly modulated strokes and open counters — a text face with no
 * ambition to be a headline — which is what that half wants, and having only one
 * weight is now a feature rather than the compromise it would have been.
 */
export const FONT_FAMILY =
  '"MSA Sans", "Gowun Dodum", "Pretendard", -apple-system, "Segoe UI", system-ui, sans-serif';

/**
 * 디스플레이 서체. 제목과 큰 숫자.
 *
 * ── §5 가 요구하는 대비의 한쪽이다 ────────────────────────────────────────
 * "표현적 디스플레이 ↔ 정밀한 유틸리티" 의 대비를 만들려면 목소리가 둘이어야
 * 한다. `MSA Sans`(고운돋움)는 조용한 쪽을 맡고, 이쪽이 말하는 쪽이다 — 획
 * 대비가 큰 명조. 레퍼런스 셋 중 둘이 이 계열이었다.
 *
 * ── 이것이 `lettering.js` 를 대신하는 것은 아니다 ─────────────────────────
 * 벡터 획은 임의의 한글을 합성할 수 있고 이 서체는 서브셋에 든 글자만 낸다.
 * 둘은 다른 도구다: 사용자 입력이 섞일 수 있는 자리는 계속 획으로 그리고,
 * **저술된 문자열**만 이쪽으로 온다. 서브셋을 좁게 잡을 수 있는 이유가 그것이다.
 *
 * 새 디스플레이 문자열을 넣으면 그 글자를 서브셋에 추가해야 한다 — 없으면
 * 조용히 두부가 된다. NOTICE 에 지금 든 글자 목록이 있다.
 */
export const DISPLAY_FAMILY = '"MSA Display", "Nanum Myeongjo", serif';

/**
 * The numerals.
 *
 * ── nothing sets numbers in this stack any more ────────────────────────────
 * The score is the largest thing on a screen and it is drawn, not typed —
 * `lettering.drawNumber`. This seam existed so the score could be given a
 * heavier face later without hunting through every `display`-sized call site,
 * and the answer it was reserving space for turned out not to be a face at all.
 *
 * Kept because small numbers inside sentences ("3 / 5", a clock) are still set
 * in type, and pointing them at their own name means a future decision to give
 * THOSE a different treatment is one line here.
 */
export const NUMERAL_FAMILY = FONT_FAMILY;

const clears = new Set();
let ready = false;

/**
 * Register a texture cache to be dropped once the real font is in.
 *
 * Safe to call at module scope. Returns the function, so a module can write
 * `export const clearFooCache = registerTextureCache(() => { … })`.
 */
export function registerTextureCache(clear) {
  clears.add(clear);
  return clear;
}

/** Has the font settled? Callers baking type early can check rather than guess. */
export function fontsAreReady() {
  return ready;
}

/**
 * Wait for the face, then drop every registered cache.
 *
 * ── `document.fonts.ready` alone is not enough ──────────────────────────────
 * It resolves when the document has finished loading the fonts it KNOWS it
 * needs, and a font used only inside a canvas is not one of those: nothing in
 * the DOM references it, so the browser has no reason to fetch it. So the face
 * is explicitly requested first, with a Hangul sample, because a face can report
 * loaded for Latin and still be fetching its Korean range.
 *
 * `FONT_WEIGHTS` has one entry now. The loop is kept over the list rather than
 * unrolled to the single value, because the list is the thing `tokens.js`
 * validates `TYPE` against — if a second weight is ever bundled it has to be
 * fetched here too, and a loop cannot forget.
 *
 * Never rejects. A font that fails to arrive leaves the fallback in place, which
 * is a legible UI in the wrong face — the failure mode the brief asks for. A
 * throw here would take the boot down over a cosmetic problem.
 */
export async function whenFontsReady() {
  if (ready) return;
  try {
    if (typeof document !== 'undefined' && document.fonts) {
      await Promise.all(
        FONT_WEIGHTS.map((w) =>
          // The sample carries Hangul, a Latin pair and a digit, so a face that
          // splits its coverage across unicode-ranges is forced to fetch all
          // three of the ranges this UI actually draws from.
          document.fonts.load(`${w} 20px ${FONT_FAMILY}`, '가힣AZ09').catch(() => {}),
        ),
      );
      /**
       * 디스플레이 서체도 같은 문 안에서 기다린다.
       *
       * 제목이 캔버스 텍스처로 구워지므로 본문 서체와 정확히 같은 함정이 있다 —
       * 늦게 오면 폴백으로 구워진 텍스처가 캐시에 남고 영영 안 바뀐다. 샘플이
       * 제목의 글자인 것은 서브셋이 그 글자만 갖고 있기 때문이다.
       */
      await document.fonts.load(`400 40px ${DISPLAY_FAMILY}`, '한여름알까기09').catch(() => {});
      await document.fonts.ready;
    }
  } catch {
    // Older WKWebViews expose no `document.fonts` at all. Fall through: the
    // fallback face is already in use and the caches below are still worth
    // dropping, since some of them may hold textures baked mid-layout.
  }
  ready = true;
  for (const clear of clears) {
    try {
      clear();
    } catch {
      // One bad cache must not stop the others being dropped.
    }
  }
}

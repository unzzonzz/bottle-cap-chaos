/**
 * The notch, the home indicator, and how much of each actually lands on the game.
 *
 * ── why this is not four CSS rules ─────────────────────────────────────────────
 * Every other project answers safe area with `padding: env(safe-area-inset-top)`
 * on a container and stops. That does not work here for two independent reasons,
 * and both of them have to be dealt with in JS:
 *
 *   1. The UI is not DOM. The turn plate, 나가기, the camera reset and the card
 *      hand are three.js meshes drawn into the low-res target (`HudLayer`,
 *      `CardLayer`, `VictoryLayer`), positioned in a virtual 640x480 "frame
 *      pixel" box. There is no element to pad. The inset has to arrive as a
 *      NUMBER, in frame pixels, and be added to `MARGIN`.
 *
 *   2. The canvas is letterboxed and the insets are not. `Viewport._fit` fits the
 *      largest 4:3 box into the window and centres it, so on a portrait phone the
 *      canvas is a band in the middle with black above and below — and the notch
 *      is in the black, not on the game. Handing `env(safe-area-inset-top)`
 *      straight to the HUD there would push the turn plate down by 59 pixels to
 *      dodge something that was never over it.
 *
 * So this module reports the OVERLAP between each unsafe band and the canvas
 * rectangle, which is the only quantity the layout actually wants. On a 393x852
 * portrait iPhone that overlap is 0 on all four sides and the HUD is untouched.
 * In landscape the canvas is full-height, the home indicator strip is under the
 * bottom edge — under the card hand — and the overlap is real.
 *
 * ── reading env() at all ───────────────────────────────────────────────────────
 * `getComputedStyle(root).getPropertyValue('--x')` returns the literal text
 * `env(safe-area-inset-top)` for a custom property, not the resolved length, so
 * the usual trick of declaring a variable and reading it back does not work. A
 * hidden probe element whose PADDING is set from env() does: padding resolves to
 * pixels, and `getComputedStyle` reports resolved values for real properties.
 *
 * ── this depends on viewport-fit=cover ─────────────────────────────────────────
 * Set in index.html. Without it iOS letterboxes the whole web view itself, every
 * inset reads 0, and the game sits in a smaller box for nothing. With it the web
 * view gets the whole screen and this module is what hands the unsafe part back.
 */

import { FRAME } from '../core/frame.js';

/** Nothing is unsafe. The answer on a desktop browser, and in portrait on a phone. */
const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/**
 * The probe.
 *
 * `position: fixed` at the origin with zero size: it must not be able to affect
 * layout, must not be able to take a press, and must not be findable by anything
 * walking the DOM for game UI. `visibility: hidden` rather than `display: none`
 * because a display-none element has no computed padding to read.
 */
function mountProbe() {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top,0px)',
    'padding-right:env(safe-area-inset-right,0px)',
    'padding-bottom:env(safe-area-inset-bottom,0px)',
    'padding-left:env(safe-area-inset-left,0px)',
  ].join(';');
  document.body.appendChild(el);
  return el;
}

/**
 * Watches the four insets and reports how much of each covers the canvas.
 *
 * Push, not poll: `main.js` already has a `viewport.onResize` fan-out and the
 * layout call belongs on the same edge. Polling this per frame would mean four
 * `getComputedStyle` calls a frame, which is a forced style recalculation each
 * time — on the frame budget this module exists to help measure.
 */
export class SafeArea {
  /**
   * @param {HTMLCanvasElement} canvas  the letterboxed 4:3 canvas
   * @param {{width: number, height: number}} [frame]
   *   The virtual layout box the insets are reported in — the shared live one
   *   from core/frame.js by default. Still a parameter so a test can hand in a
   *   fixed box without standing up a Viewport.
   */
  constructor(canvas, frame = FRAME) {
    this.canvas = canvas;
    this.frame = frame;

    /** Raw window insets, CSS pixels. What iOS reports. */
    this.window = { ...NO_INSETS };
    /** The part of each that lies over the canvas, CSS pixels. */
    this.canvasCss = { ...NO_INSETS };
    /** The same overlap, in frame pixels. What a layout wants. */
    this.frameInsets = { ...NO_INSETS };

    this._probe = null;
    this._listeners = new Set();

    try {
      this._probe = mountProbe();
    } catch {
      // A document that will not take an element is a document with no notch to
      // dodge. Every reader below sees zeroes and lays out exactly as before.
      this._probe = null;
    }

    this.measure();
  }

  /** @param {(insets: {top:number,right:number,bottom:number,left:number}) => void} fn */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * Re-read the insets and the canvas rect.
   *
   * Returns true when the frame-pixel answer CHANGED, so the caller can skip a
   * relayout on the resizes that do not move anything — which is most of them,
   * because a URL bar sliding around fires resize without touching a notch.
   */
  measure() {
    const win = this._readWindowInsets();
    const rect = this._canvasRect();

    /**
     * The overlap, edge by edge.
     *
     * The unsafe top band is [0, top] in client coordinates and the canvas
     * occupies [rect.top, rect.bottom], so what the band actually covers is
     * `top - rect.top` — negative, and clamped away, whenever the letterbox has
     * already kept the canvas clear of it. The other three are the same
     * statement rotated.
     */
    const viewW = window.innerWidth;
    const viewH = window.innerHeight;
    /**
     * Clamped at BOTH ends, and the upper clamp is not cosmetic.
     *
     * The band is only `win.top` pixels tall, so no part of the canvas can be
     * covered by more than that however the subtraction comes out — and it can
     * come out larger, whenever `rect.top` is negative because the canvas is
     * taller than the viewport it is centred in. Without the upper clamp a
     * degenerate viewport (a zero-height window, a canvas measured before the
     * first `_fit`) produces a nonsense overlap out of insets that are all zero,
     * and then multiplies it by a nonsense pixel ratio. Taking the smaller of
     * the two makes "no inset" mean "no inset" unconditionally.
     */
    const band = (inset, overlap) => Math.min(inset, Math.max(0, overlap));
    const css = {
      top: band(win.top, win.top - rect.top),
      left: band(win.left, win.left - rect.left),
      bottom: band(win.bottom, rect.bottom - (viewH - win.bottom)),
      right: band(win.right, rect.right - (viewW - win.right)),
    };

    // Frame pixels per CSS pixel. The canvas is always `frame.width` frame
    // pixels wide by construction, whatever its CSS size, and `Viewport._fit`
    // fits the canvas to the FRAME's aspect — so the frame and the canvas have
    // the same shape and this one ratio still converts both axes, whatever
    // shape that is.
    const perCss = rect.width > 0 ? this.frame.width / rect.width : 0;

    const next = {
      top: Math.round(css.top * perCss),
      right: Math.round(css.right * perCss),
      bottom: Math.round(css.bottom * perCss),
      left: Math.round(css.left * perCss),
    };

    const changed =
      next.top !== this.frameInsets.top ||
      next.right !== this.frameInsets.right ||
      next.bottom !== this.frameInsets.bottom ||
      next.left !== this.frameInsets.left;

    this.window = win;
    this.canvasCss = css;
    this.frameInsets = next;

    if (changed) for (const fn of this._listeners) fn(next);
    return changed;
  }

  _readWindowInsets() {
    if (!this._probe) return { ...NO_INSETS };
    try {
      const s = getComputedStyle(this._probe);
      const px = (v) => {
        const n = Number.parseFloat(v);
        return Number.isFinite(n) && n > 0 ? n : 0;
      };
      return {
        top: px(s.paddingTop),
        right: px(s.paddingRight),
        bottom: px(s.paddingBottom),
        left: px(s.paddingLeft),
      };
    } catch {
      return { ...NO_INSETS };
    }
  }

  _canvasRect() {
    try {
      const r = this.canvas.getBoundingClientRect();
      // A canvas with no box yet — measured before the first `_fit` — must not
      // produce a divide-by-zero ratio or an overlap against a zero rectangle.
      if (r.width > 0 && r.height > 0) return r;
    } catch {
      /* fall through */
    }
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  dispose() {
    this._listeners.clear();
    this._probe?.remove();
    this._probe = null;
  }
}

/**
 * The null object, for the two boot paths that have no notch to care about.
 *
 * Same shape, always zero, no probe and no listeners — so a caller can hold one
 * of these without branching on whether safe area is in play.
 */
export const NO_SAFE_AREA = {
  window: NO_INSETS,
  canvasCss: NO_INSETS,
  frameInsets: NO_INSETS,
  onChange: () => () => {},
  measure: () => false,
  dispose: () => {},
};

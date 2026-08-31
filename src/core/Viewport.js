import {
  ColorManagement,
  NoToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { BOARD_ASPECT, FRAME, MAX_FRAME_WIDTH, updateFrame } from './frame.js';

/**
 * Colour management ON.
 *
 * It was off, and the reason it was off is gone: hex values were meant to land
 * on screen exactly as authored and then be crushed by a 5-bit quantiser, so
 * letting three.js convert sRGB<->linear would have shifted every colour before
 * the quantiser ever saw it. There is no quantiser now, and there IS a bloom
 * chain — which sums light and therefore has to work in linear space or a
 * highlight blooms by the wrong amount. Everything downstream assumes it.
 */
ColorManagement.enabled = true;

/**
 * The 3D camera's aspect. Still 4:3.
 *
 * ── this is the BOARD's aspect, not necessarily the canvas's ────────────────
 * On the match page the canvas may be taller than 4:3, with the play area in a
 * 4:3 sub-rectangle — see `core/frame.js`. The 3D camera still frames 4:3, so
 * every consumer talking about the CAMERA (GameCamera, the menu's, the viewer's)
 * is correct to use this. `_fit` asks the frame instead, because the CANVAS is
 * not necessarily 4:3.
 */
export const DISPLAY_ASPECT = 4 / 3;

/**
 * How far above 1 the drawing buffer is allowed to go.
 *
 * A safety valve, not a quality dial. Pixel count goes with the square of this,
 * and the chain behind it is no longer cheap — MSAA, a bloom pyramid and a
 * 2048² shadow map all scale with it. On a 3x phone, 3 costs 2.25x the fill of 2
 * for a difference nobody has been able to pick out on a 5-inch screen.
 *
 * `MetricsOverlay` is how this gets revisited: raise it only against a measured
 * 1% low, never on the assumption that more is better.
 */
const PIXEL_RATIO_CAP = 2;

/**
 * Owns the WebGLRenderer and every sizing concern. Knows nothing about what
 * gets rendered, and no longer owns a render target — the bloom chain does, so
 * that the world can be post-processed while the UI drawn afterwards is not.
 * See `core/Composer.js`.
 */
export class Viewport {
  /**
   * @param {boolean} [portrait]
   *   Let the canvas grow taller than the board's 4:3 and report a frame with
   *   bands above and below it. The match page turns this on; the menu and the
   *   cap viewer leave it off, because both lay out against a 4:3 canvas top to
   *   bottom and neither has a board to keep square.
   */
  constructor({ canvas, portrait = false, pixelRatioCap = PIXEL_RATIO_CAP }) {
    this.canvas = canvas;
    this.portrait = portrait;
    this.pixelRatioCap = Math.max(1, pixelRatioCap);

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    /**
     * No tone mapping, deliberately.
     *
     * The brief bans cinematic grading and this is where that is enforced:
     * ACES or Reinhard here would roll the highlights off, and the whole point
     * of the direction is that highlights stay bright and bloom. The bloom pass
     * gives the HDR headroom; a tone mapper would spend it.
     */
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.autoClear = true;

    /** Drawing-buffer size in DEVICE pixels — CSS size times the pixel ratio. */
    this.resolution = new Vector2(1, 1);
    /** Letterboxed canvas size, in CSS pixels. */
    this.displaySize = new Vector2(1, 1);

    this._listeners = new Set();

    // The letterbox is derived from the window rather than from a measured
    // element, so the window's own events are the signal — a ResizeObserver on
    // the container would report the same numbers one layout pass later.
    this._onResize = () => this._fit();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);

    this._fit();
  }

  /**
   * The board's rectangle inside the drawing buffer, in DEVICE pixels, y-UP.
   *
   * With `portrait` off — and, today, with it on as well, because `frame.js`'s
   * bands resolve to zero — this is the whole buffer. It is kept because
   * PHASE 5 decides whether the band system comes back, and because the pointer
   * mapping below is derived from the same numbers.
   */
  boardRect() {
    if (!this.portrait) {
      return { x: 0, y: 0, w: this.resolution.x, h: this.resolution.y };
    }
    const per = this.resolution.x / FRAME.width;
    return {
      x: 0,
      y: Math.round(FRAME.bottomBand * per),
      w: this.resolution.x,
      h: Math.round(FRAME.boardHeight * per),
    };
  }

  /**
   * The same rectangle inside the CANVAS, in CSS pixels, y-DOWN.
   *
   * The form a pointer wants: `clientY - rect.top - boardRectCss().y` is the
   * offset into the board.
   */
  boardRectCss() {
    const s = this.displaySize;
    if (!this.portrait) return { x: 0, y: 0, w: s.x, h: s.y };
    const per = s.x / FRAME.width;
    return { x: 0, y: FRAME.topBand * per, w: s.x, h: FRAME.boardHeight * per };
  }

  /**
   * The board's rectangle in CLIENT coordinates — a drop-in for the
   * `canvas.getBoundingClientRect()` every pointer mapping used to call.
   *
   * That is the point of the shape: with `portrait` off it returns exactly the
   * canvas rect, so every call site can switch to it unconditionally.
   */
  boardClientRect() {
    const r = this.canvas.getBoundingClientRect();
    const b = this.boardRectCss();
    return {
      left: r.left + b.x,
      top: r.top + b.y,
      width: b.w,
      height: b.h,
      right: r.left + b.x + b.w,
      bottom: r.top + b.y + b.h,
    };
  }

  /**
   * Re-run the fit without a window resize.
   *
   * The frame's shape depends on the FIELD as well as the window — a mode change
   * can alter it with nothing about the window having moved — and `_fit` is
   * where every consumer is notified.
   */
  refit() {
    this._fit();
  }

  /** @param {(size: {resolution: Vector2, displaySize: Vector2}) => void} fn */
  onResize(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * Largest box of the FRAME's aspect that fits the window, centred by the
   * flexbox in styles.css.
   *
   * No debounce: the box comes from `window.innerWidth`/`Height` rather than
   * from a measured element, so there is no layout feedback loop to chase, and a
   * mobile URL bar sliding around just moves the letterbox.
   */
  _fit() {
    const availW = Math.max(2, window.innerWidth);
    const availH = Math.max(2, window.innerHeight);

    if (this.portrait) updateFrame(availW, availH);
    const aspect = this.portrait
      ? FRAME.aspect
      : MAX_FRAME_WIDTH / Math.round(MAX_FRAME_WIDTH / BOARD_ASPECT);

    let w = availW;
    let h = Math.round(w / aspect);
    if (h > availH) {
      h = availH;
      w = Math.round(h * aspect);
    }

    this.displaySize.set(w, h);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;

    /**
     * The drawing buffer is the canvas at the device's own ratio, capped.
     *
     * ── what this replaces ────────────────────────────────────────────────
     * It used to be `setPixelRatio(1)` plus an elaborate calculation whose job
     * was to guarantee the final blit was an UPSCALE rather than a downscale —
     * because the scene was drawn into a 640x480 target and nearest-sampled onto
     * the canvas, and on a phone that was a 0.63x minification which DROPPED
     * whole texel rows. The visible symptom was Korean UI text losing strokes:
     * 나가기 came out as ㄴ| ㄱ| ㄱ| because the one-texel horizontal bar of ㅏ
     * fell in a dropped row.
     *
     * There is no intermediate low-resolution target any more, so there is no
     * blit to keep on the right side of 1:1 and none of that arithmetic is
     * needed. What replaces it is the ordinary rule: draw at the device's
     * resolution, and cap it so the fill cost stays bounded.
     */
    const ratio = Math.min(Math.max(1, window.devicePixelRatio || 1), this.pixelRatioCap);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);

    this.resolution.set(Math.round(w * ratio), Math.round(h * ratio));

    for (const fn of this._listeners) {
      fn({ resolution: this.resolution, displaySize: this.displaySize });
    }
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this._listeners.clear();
    this.renderer.dispose();
  }
}

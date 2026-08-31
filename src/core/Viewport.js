import {
  ColorManagement,
  LinearSRGBColorSpace,
  NearestFilter,
  NoToneMapping,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { BOARD_ASPECT, FRAME, MAX_FRAME_WIDTH, updateFrame } from './frame.js';

/**
 * Colour management OFF, on purpose.
 *
 * Hex values are meant to land on screen as authored and then get crushed by the
 * 5-bit quantiser in RetroPass. Letting three.js do sRGB<->Linear conversion
 * would shift every colour before we ever get to quantise it.
 */
ColorManagement.enabled = false;

/**
 * The console drew into a low-res framebuffer and the TV stretched it to 4:3
 * regardless of how many texels were in it. So the display box is always 4:3 and
 * the render target's own aspect is free — 256x224 gets non-square pixels here
 * exactly as it did then.
 *
 * ── this is now the BOARD's aspect, not necessarily the canvas's ─────────────
 * On the match page the canvas may be taller than 4:3, with the play area
 * occupying a 4:3 sub-rectangle and the HUD and card hand in the bands above and
 * below it — see src/core/frame.js. The 3D camera still frames 4:3, so every
 * consumer of this constant that is talking about the CAMERA (GameCamera, the
 * menu's own camera, the viewer's) is still correct.
 *
 * What is no longer true is that the CANVAS is 4:3. `Viewport._fit` therefore
 * asks the frame, not this constant. The menu and the cap viewer keep a 4:3
 * canvas by leaving `portrait` off.
 */
export const DISPLAY_ASPECT = 4 / 3;

/**
 * Internal render resolutions.
 *
 * The first five are as the hardware had them; 320x240 is the authentic one.
 * The two above 640x480 are NOT period-correct and are here for the physics
 * prototype: a cap is 84 columns around, so at 320x240 its wireframe is finer
 * than the pixel grid and collapses into a solid blob — which makes the one view
 * the core-feel work has to be judged in the least legible one available. They
 * keep every other part of the chain (snapping, dither, 15-bit quantiser) intact
 * and only give it more grid to work on.
 */
export const RENDER_MODES = {
  '256x224': [256, 224],
  '320x240': [320, 240],
  '384x288': [384, 288],
  '512x384': [512, 384],
  '640x480': [640, 480],
  '800x600': [800, 600],
  '960x720': [960, 720],
};

/**
 * Owns the WebGLRenderer, the low-resolution render target the scene is drawn
 * into, and every sizing concern. Knows nothing about what gets rendered.
 */
export class Viewport {
  /**
   * @param {boolean} [portrait]
   *   Let the canvas grow taller than the board's 4:3 and report a frame with
   *   bands above and below it. The match page turns this on; the menu and the
   *   cap viewer leave it off, because both lay out against a 4:3 canvas from
   *   top to bottom and neither has a board to keep square. Off, every number
   *   this class produces is what it produced before frame.js existed.
   */
  constructor({ canvas, mode = '320x240', portrait = false }) {
    this.canvas = canvas;
    this.portrait = portrait;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // PS1 had no AA and the upscale must stay crunchy
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    // Set per-fit now, not once here — see `_fit`. It is still 1 on every
    // display where the canvas is at least as wide as the render target, which
    // is every desktop window this was built in.
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = LinearSRGBColorSpace; // pass-through
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.autoClear = true;

    /**
     * The BOARD's resolution, in target pixels. This is what `renderMode` names.
     * `resolution` below is this plus however much taller the frame is.
     */
    this.boardResolution = new Vector2(1, 1);
    /** Low-res render target size, in target pixels. */
    this.resolution = new Vector2(1, 1);
    /** Letterboxed canvas size, in CSS pixels. */
    this.displaySize = new Vector2(1, 1);

    this.renderTarget = null;
    this._listeners = new Set();
    this._mode = null;

    // The letterbox is derived from the window, not from a measured element, so
    // the window's own events are the signal — a ResizeObserver on the container
    // would only be reporting the same numbers one layout pass later.
    this._onResize = () => this._fit();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);

    this.setMode(mode);
  }

  /** Bind the scene render target. Pair with `unbind()`. */
  bind() {
    this.renderer.setRenderTarget(this.renderTarget);
  }

  /**
   * Bind the target with drawing confined to the board's 4:3 band.
   *
   * ── why this is not `renderer.setViewport` ───────────────────────────────
   * Because that one is in CANVAS pixels and multiplies by `pixelRatio` before
   * it reaches GL. Against a render target — whose size has nothing to do with
   * the device ratio — a ratio of 2 puts the viewport at twice the intended
   * offset and twice the size, i.e. entirely off the target, and the screen goes
   * black. The render target carries its OWN `viewport`/`scissor`/`scissorTest`
   * for exactly this case, and `setRenderTarget` applies them unscaled.
   *
   * The scissor matters as much as the viewport: the viewport alone confines
   * drawing but not CLEARING, so the sky would still wash over the bands.
   *
   * A no-op shape when the frame is the board — landscape and every desktop
   * window — so this is the normal path rather than a portrait special case.
   */
  bindBoard() {
    const b = this.boardRect();
    const t = this.renderTarget;
    t.viewport.set(b.x, b.y, b.w, b.h);
    t.scissor.set(b.x, b.y, b.w, b.h);
    t.scissorTest = true;
    this.renderer.setRenderTarget(t);
  }

  /**
   * Bind the target with the whole frame drawable again.
   *
   * Everything laid out in frame pixels — the HUD, the cards, the victory
   * screen, the wipes — covers the bands and must not be clipped to the board.
   */
  bindFull() {
    const t = this.renderTarget;
    t.viewport.set(0, 0, this.resolution.x, this.resolution.y);
    t.scissor.set(0, 0, this.resolution.x, this.resolution.y);
    t.scissorTest = false;
    this.renderer.setRenderTarget(t);
  }

  /** Back to the default framebuffer for the fullscreen pass. */
  unbind() {
    this.renderer.setRenderTarget(null);
  }

  /**
   * The board's rectangle inside the render target, in TARGET pixels, y-UP.
   *
   * The form `renderer.setViewport`/`setScissor` want. Must be applied AFTER
   * `bind()` — `setRenderTarget` resets the GL viewport and scissor to the
   * target's full size, so issuing them first is a silent no-op.
   *
   * With `portrait` off this is the whole target, which is what every caller
   * wants when there are no bands.
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
   * offset into the board. Every raycast that used to normalise against the
   * whole canvas has to normalise against this instead, or a press lands as far
   * out as the top band is tall.
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
   * canvas rect, so every call site can switch to it unconditionally and
   * landscape keeps behaving to the pixel. With it on, it is the 4:3 band the
   * board is actually drawn in, which is what an aim ray and a pan gain both
   * have to be measured against — normalising against the whole canvas would
   * put every press out by however tall the top band is.
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
   * The frame's shape depends on the FIELD as well as the window — a mode
   * change can alter it with nothing about the window having moved — and
   * `_fit` is where every consumer is notified. Public so `main.js` can say
   * "the frame changed underneath you" at the one place that knows.
   */
  refit() {
    this._fit();
  }

  /** @param {keyof typeof RENDER_MODES} mode */
  setMode(mode) {
    const size = RENDER_MODES[mode];
    if (!size || mode === this._mode) return;
    this._mode = mode;
    this.boardResolution.set(size[0], size[1]);
    this._fit();
  }

  /**
   * The render target's size, derived from the mode and the frame's shape.
   *
   * The mode names the BOARD's resolution — `'640x480'` still means the play
   * area is drawn at 640x480 — and the target is however much taller the frame
   * is, at the same texel density. So the bands above and below the board get
   * the same dither lattice and the same 5-bit quantiser as the board, which is
   * the whole reason the overlays were being drawn inside this target already.
   *
   * In landscape the frame IS the board and this returns the mode unchanged.
   */
  _targetSizeFor(frame) {
    const w = this.boardResolution.x;
    const perFramePx = w / frame.width;
    return [w, Math.max(1, Math.round(frame.height * perFramePx))];
  }

  get mode() {
    return this._mode;
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
   * No debounce: the box is derived from window.innerWidth/Height rather than
   * from a measured element, so there is no layout feedback loop for a resize to
   * chase, and a mobile URL bar sliding around just moves the letterbox.
   *
   * ── the aspect is asked for rather than assumed ─────────────────────────────
   * With `portrait` off this resolves to 4:3 and every line below behaves
   * exactly as it did when `DISPLAY_ASPECT` was read here directly — the menu
   * and the cap viewer are unchanged. With it on, `resolveFrame` returns the
   * board's 4:3 for any window at least that wide (so landscape is also
   * unchanged) and something taller for a portrait phone.
   */
  _fit() {
    const availW = Math.max(2, window.innerWidth);
    const availH = Math.max(2, window.innerHeight);

    if (this.portrait) updateFrame(availW, availH);
    const aspect = this.portrait ? FRAME.aspect : DISPLAY_ASPECT;

    // The target has to be rebuilt before the listeners run, because they are
    // handed `resolution` and several of them copy it straight into a shader
    // uniform. A frame that got taller and a target that had not caught up
    // would dither the bands on the previous lattice for one frame.
    const [tw, th] = this._targetSizeFor(
      this.portrait
        ? FRAME
        : { width: MAX_FRAME_WIDTH, height: Math.round(MAX_FRAME_WIDTH / BOARD_ASPECT) },
    );
    if (tw !== this.resolution.x || th !== this.resolution.y) {
      this.resolution.set(tw, th);
      this._rebuildTarget();
    }

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
     * The drawing buffer must never be SMALLER than the render target.
     *
     * ── the pipeline assumes the last step is an upscale, and on a phone it was
     *    a downscale ────────────────────────────────────────────────────────
     * The whole look rests on `RetroPass` blowing a small image up with
     * `NearestFilter`. `setPixelRatio(1)` made the drawing buffer exactly the
     * canvas's CSS size, which is fine while that is bigger than the target —
     * true in every desktop window this was built in, where 640x480 goes to
     * 900-odd pixels wide.
     *
     * It is false on a phone. A 402 CSS-px-wide canvas against a 640-wide target
     * is a 0.63x MINIFICATION, and nearest minification does not soften, it
     * DROPS: whole texel rows are never sampled. The visible symptom was Korean
     * UI text losing strokes — 나가기 rendering as ㄴ| ㄱ| ㄱ| because the one-texel
     * horizontal bar of ㅏ fell in a dropped row. Latin text survived because its
     * strokes are mostly vertical and two texels wide.
     *
     * So the ratio is whatever it takes to keep the final blit an upscale, and
     * no more — `ceil` of the shortfall, capped at the device's own ratio.
     * On a 3x iPhone that is 2, not 3: 804x604 already covers a 640x480 target,
     * and asking for 1206x906 would cost 2.25x the fill for no extra texel.
     *
     * This does NOT soften the look or hand the upscale to the GPU. The scene is
     * still drawn into the same low-res target, still quantised to 5 bits,
     * still dithered on the same lattice, still magnified with NearestFilter.
     * The only thing that changes is that the magnification is now genuinely a
     * magnification.
     */
    const shortfall = Math.max(this.resolution.x / w, this.resolution.y / h);
    const ratio = Math.min(
      Math.max(1, window.devicePixelRatio || 1),
      Math.max(1, Math.ceil(shortfall)),
    );
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);

    this.renderer.setSize(w, h, false);

    for (const fn of this._listeners) {
      fn({ resolution: this.resolution, displaySize: this.displaySize });
    }
  }

  _rebuildTarget() {
    // Leaking render targets across mode changes is the classic way to eat all
    // the GPU memory. Always dispose the old one.
    this.renderTarget?.dispose();

    this.renderTarget = new WebGLRenderTarget(this.resolution.x, this.resolution.y, {
      minFilter: NearestFilter,
      magFilter: NearestFilter, // the whole look rests on this one line
      generateMipmaps: false,
      format: RGBAFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this._listeners.clear();
    this.renderTarget?.dispose();
    this.renderTarget = null;
    this.renderer.dispose();
  }
}

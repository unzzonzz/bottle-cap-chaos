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
  constructor({ canvas, mode = '320x240' }) {
    this.canvas = canvas;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // PS1 had no AA and the upscale must stay crunchy
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    // The low-res render target is what does the scaling. A device pixel ratio
    // above 1 here would quietly hand the upscale back to the GPU at native
    // resolution and soften everything the pass is trying to keep sharp.
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = LinearSRGBColorSpace; // pass-through
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.autoClear = true;

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

  /** Back to the default framebuffer for the fullscreen pass. */
  unbind() {
    this.renderer.setRenderTarget(null);
  }

  /** @param {keyof typeof RENDER_MODES} mode */
  setMode(mode) {
    const size = RENDER_MODES[mode];
    if (!size || mode === this._mode) return;
    this._mode = mode;
    this.resolution.set(size[0], size[1]);
    this._rebuildTarget();
    this._fit();
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
   * Largest 4:3 box that fits the window, centred by the flexbox in styles.css.
   *
   * No debounce: the box is derived from window.innerWidth/Height rather than
   * from a measured element, so there is no layout feedback loop for a resize to
   * chase, and a mobile URL bar sliding around just moves the letterbox.
   */
  _fit() {
    const availW = Math.max(2, window.innerWidth);
    const availH = Math.max(2, window.innerHeight);

    let w = availW;
    let h = Math.round(w / DISPLAY_ASPECT);
    if (h > availH) {
      h = availH;
      w = Math.round(h * DISPLAY_ASPECT);
    }

    this.displaySize.set(w, h);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
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

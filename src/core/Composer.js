import { HalfFloatType, LinearFilter, LinearSRGBColorSpace, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * The world's post-processing chain: render, bloom, output. Nothing else.
 *
 * ── the chain is deliberately three passes and will stay three ──────────────
 * `RenderPass -> UnrealBloomPass -> OutputPass`. Chromatic aberration, film
 * grain, vignette, motion blur, depth of field and cinematic colour grading are
 * all banned by the brief and none of them is one line away — adding a pass here
 * is a decision, not a tweak.
 *
 * ── bloom is meant to be SEEN ───────────────────────────────────────────────
 * The earlier direction asked for a bloom so subtle that noticing it counted as
 * failure. That was overridden: in this look a specular highlight without a
 * glow around it is just a white smear, and the glow is most of what says "wet".
 * Hence a threshold low enough to catch the cap's highlight (0.72) and a
 * strength that reads (0.45) rather than the 0.15 a restrained pass would use.
 *
 * ── why the UI is NOT in here ───────────────────────────────────────────────
 * This composer renders the WORLD and nothing else. Every overlay — HUD, cards,
 * victory, match-found, modal, wipes — is drawn straight to the canvas after
 * `render()` returns, because bloom on UI text is unreadable UI text: white type
 * on a white plate is exactly the input the bright-pass is looking for, and it
 * halates into mush at any strength worth having on the world.
 *
 * That is a change of structure, not just of order. Previously every overlay was
 * drawn INSIDE the low-resolution target so that all of it took the same dither
 * lattice and the same 5-bit quantiser as the board — sharing one image was the
 * point. Now sharing one image is the problem, and the split is the fix.
 *
 * The cost is that a full-frame effect which used to blend against the finished
 * picture — the victory screen's colour inversion — now blends against the world
 * only. That flash is being redesigned anyway (it darkens a bright palette,
 * which is the wrong direction), so it is not a regression that needs covering
 * here.
 */
export class SceneComposer {
  /**
   * @param {import('./Viewport.js').Viewport} viewport
   * @param {import('three').Scene} scene
   * @param {import('three').Camera} camera
   * @param {{threshold?: number, strength?: number, radius?: number, enabled?: boolean}} [bloom]
   */
  constructor({ viewport, scene, camera, bloom = {} }) {
    this.viewport = viewport;
    this.scene = scene;
    this.camera = camera;

    const { x, y } = viewport.resolution;

    /**
     * The world target: MSAA, half-float, linear.
     *
     * `samples: 4` is the antialiasing. The renderer's own `antialias: true`
     * covers the default framebuffer, which is what the UI is drawn into — it
     * does nothing for a render target, and the world is drawn into one, so
     * without this line the board's edges are hard-aliased while the UI is not.
     *
     * `HalfFloatType` is what makes the bloom threshold mean anything: in 8-bit
     * everything above white clips to white before the bright-pass runs, so a
     * highlight and a plain white surface become indistinguishable and both
     * bloom equally. Half-float keeps the headroom that lets one glow and the
     * other not.
     *
     * `LinearSRGBColorSpace` because bloom sums light and light sums linearly.
     * `OutputPass` is what converts to sRGB at the very end.
     */
    this.target = new WebGLRenderTarget(x, y, {
      samples: 4,
      type: HalfFloatType,
      colorSpace: LinearSRGBColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.composer = new EffectComposer(viewport.renderer, this.target);
    this.composer.setPixelRatio(1); // the target is already in device pixels
    this.composer.setSize(x, y);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(
      new Vector2(x, y),
      bloom.strength ?? 0.45,
      bloom.radius ?? 0.6,
      bloom.threshold ?? 0.72,
    );
    this.bloomPass.enabled = bloom.enabled ?? true;
    this.composer.addPass(this.bloomPass);

    // Last, and the only pass that writes the canvas. Converts linear to the
    // renderer's output colour space and applies tone mapping — which is
    // `NoToneMapping`, so it is the colour-space half that matters here.
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this._off = viewport.onResize(({ resolution }) => this.setSize(resolution.x, resolution.y));
  }

  /** Swap the camera the world is rendered from. */
  setCamera(camera) {
    this.camera = camera;
    this.renderPass.camera = camera;
  }

  /** Live bloom knobs, for the debug panel. */
  configure({ threshold, strength, radius, enabled } = {}) {
    if (threshold !== undefined) this.bloomPass.threshold = threshold;
    if (strength !== undefined) this.bloomPass.strength = strength;
    if (radius !== undefined) this.bloomPass.radius = radius;
    if (enabled !== undefined) this.bloomPass.enabled = enabled;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  /**
   * Draw the world to the canvas.
   *
   * Leaves the renderer bound to the default framebuffer with `autoClear` ON,
   * which is the state the overlay renders that follow expect to change for
   * themselves. `EffectComposer` restores neither, so it is done here rather
   * than at each of the six call sites.
   */
  render() {
    const r = this.viewport.renderer;
    this.composer.render();
    r.setRenderTarget(null);
    r.autoClear = true;
  }

  dispose() {
    this._off?.();
    this.composer.dispose?.();
    this.bloomPass.dispose?.();
    this.target.dispose();
  }
}

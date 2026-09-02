import { HalfFloatType, LinearFilter, LinearSRGBColorSpace, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { onQualityChange, QUALITY } from './quality.js';

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
     * 패스 셋은 타겟보다 오래 산다. 그래서 여기서 만들고, 체인만 다시 세운다.
     *
     * MSAA 는 렌더 타겟의 **생성 시 속성**이라 티어가 바뀌면 타겟을 버리고 새로
     * 만들어야 하는데, 패스는 타겟을 모른다 — `EffectComposer` 가 매 프레임
     * 자기 버퍼를 넘겨줄 뿐이다. 그러니 다시 세우는 것은 타겟과 컴포저뿐이고
     * 패스는 그대로 옮겨 붙는다. 블룸의 다섯 단계 밉 체인도 살아남는다.
     */
    this.renderPass = new RenderPass(scene, camera);

    /**
     * 블룸은 타겟보다 **낮은 해상도**로 돈다. `QUALITY.bloomScale` 을 보라.
     *
     * `UnrealBloomPass.setSize` 가 정하는 것은 밝은 부분 추출과 다섯 단계 블러가
     * 도는 내부 타겟의 크기이고, 마지막 합성은 어차피 전체 해상도의 전면 패스다.
     * 그래서 여기를 절반으로 내리면 블러 체인의 면적이 4분의 1이 되고, 화면에
     * 도착하는 그림은 사실상 같다 — 블룸은 정의상 저주파다. 보통 티어가 그걸
     * 한 번 더 해서 4분의 1로 돌린다.
     */
    this.bloomPass = new UnrealBloomPass(
      this._bloomSize(x, y),
      bloom.strength ?? 0.45,
      bloom.radius ?? 0.6,
      bloom.threshold ?? 0.72,
    );

    /**
     * 설정이 원하는 값과 티어가 허락하는 값은 다른 것이다.
     *
     * `configure({enabled})` 는 디버그 패널의 것이고 저것을 쓴다. 실제로 켜지는
     * 것은 둘의 AND 이고, 그래야 패널에서 껐다가 티어를 만졌을 때 블룸이 혼자
     * 되살아나지 않는다.
     */
    this._bloomWanted = bloom.enabled ?? true;

    // Last, and the only pass that writes the canvas. Converts linear to the
    // renderer's output colour space and applies tone mapping — which is
    // `NoToneMapping`, so it is the colour-space half that matters here.
    this.outputPass = new OutputPass();

    this._samples = QUALITY.msaaSamples;
    this._buildChain(x, y);

    this._off = viewport.onResize(({ resolution }) => this.setSize(resolution.x, resolution.y));

    /**
     * 티어 변경. 샘플 수가 달라졌을 때만 타겟을 다시 만든다.
     *
     * 뷰포트의 품질 구독이 `_fit` 을 태우고, 그것이 이 클래스의 리사이즈 리스너를
     * 부른다 — 즉 크기는 이미 저쪽 경로로 따라온다. 여기서 하는 일은 크기로는
     * 해결되지 않는 것 하나, `samples` 뿐이다. 두 구독의 순서는 상관없다:
     * 리사이즈가 먼저 오면 옛 샘플 수의 타겟이 새 크기로 잡혔다가 곧바로 버려지고,
     * 이쪽이 먼저 오면 새 타겟이 옛 크기로 잡혔다가 곧바로 `setSize` 를 받는다.
     */
    this._offQuality = onQualityChange(() => {
      this._applyBloomEnabled();
      if (QUALITY.msaaSamples === this._samples) return;
      this._samples = QUALITY.msaaSamples;
      this._rebuild();
    });
  }

  /** 블룸 블러 체인이 도는 크기. 생성과 리사이즈가 같은 식을 쓴다. */
  _bloomSize(w, h) {
    return new Vector2(
      Math.max(1, Math.round(w * QUALITY.bloomScale)),
      Math.max(1, Math.round(h * QUALITY.bloomScale)),
    );
  }

  _applyBloomEnabled() {
    this.bloomPass.enabled = this._bloomWanted && QUALITY.bloom;
  }

  /**
   * The world target: MSAA, half-float, linear. 그리고 그것을 두른 체인.
   *
   * `samples` 가 안티에일리어싱이다. 렌더러 자신의 `antialias: true` 는 기본
   * 프레임버퍼 — UI 가 그려지는 곳 — 를 덮을 뿐 렌더 타겟에는 아무 일도 하지
   * 않고, 월드는 렌더 타겟에 그려진다. 이 줄이 없으면 보드의 모서리만 계단지고
   * UI 는 멀쩡한 그림이 나온다. 0 이면 그 상태가 최저 티어의 의도된 모습이다.
   *
   * `HalfFloatType` 은 블룸 임계값이 의미를 갖게 하는 것이다: 8비트에서는 흰색
   * 위의 모든 것이 밝은 부분 추출 전에 흰색으로 잘려서, 하이라이트와 그냥 흰
   * 표면이 구별되지 않고 둘 다 똑같이 번진다. 반정밀도가 그 여유를 남긴다.
   * **티어와 무관하게 유지된다** — 이걸 8비트로 내리면 절약되는 것은 대역폭이고
   * 잃는 것은 무엇이 빛나는가에 대한 판단 전체다.
   *
   * `LinearSRGBColorSpace` 인 것은 블룸이 빛을 더하고 빛은 선형으로 더해지기
   * 때문이다. 맨 끝에서 sRGB 로 바꾸는 것은 `OutputPass` 다.
   */
  _buildChain(w, h) {
    this.target = new WebGLRenderTarget(w, h, {
      samples: this._samples,
      type: HalfFloatType,
      colorSpace: LinearSRGBColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.composer = new EffectComposer(this.viewport.renderer, this.target);
    this.composer.setPixelRatio(1); // the target is already in device pixels
    this.composer.setSize(w, h);

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.outputPass);
    this._applyBloomEnabled();
    this.setSize(w, h);
  }

  /**
   * 타겟을 버리고 다시 만든다. 샘플 수가 바뀌었을 때만.
   *
   * `EffectComposer.dispose()` 가 자기 renderTarget1/2 를 버리는데, 1 번은 우리가
   * 넘긴 `this.target` 이고 2 번은 그 `clone()` 이다 — 즉 이 한 줄이 둘 다
   * 정리한다. 패스는 버리지 않으므로 그대로 새 체인에 다시 붙는다.
   */
  _rebuild() {
    const { x, y } = this.viewport.resolution;
    this.composer.dispose?.();
    this._buildChain(x, y);
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
    if (enabled !== undefined) {
      this._bloomWanted = enabled;
      this._applyBloomEnabled();
    }
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    // 블룸만 예산 배율을 받는다. 컴포저의 읽기/쓰기 버퍼는 전체 해상도여야 한다 —
    // 마지막 패스가 캔버스에 그대로 쓰기 때문이다.
    const size = this._bloomSize(w, h);
    this.bloomPass.setSize(size.x, size.y);
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
    this._offQuality?.();
    this.composer.dispose?.();
    this.bloomPass.dispose?.();
    this.target.dispose();
  }
}

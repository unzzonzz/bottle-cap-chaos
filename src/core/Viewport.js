import {
  Color,
  ColorManagement,
  NoToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { FRAME, updateFrame } from './frame.js';
import { PALETTE } from './palette.js';
import { onQualityChange, QUALITY } from './quality.js';

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
 * ── it is the frame's aspect too, and that is new ───────────────────────────
 * The canvas could once be taller than 4:3, with the play area in a 4:3
 * sub-rectangle, which is why this constant and the frame's own aspect were two
 * different numbers. They are the same number now — see `core/frame.js` on why
 * the frame no longer grows. This stays as the DEFAULT a camera is built with;
 * `main.js` still pushes `FRAME.aspect` in on resize, which differs from 4/3 by
 * the height's rounding and is what the canvas is actually shaped to.
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
 *
 * ── 이제 티어가 이 값을 **내린다**. 올리지는 않는다 ─────────────────────────
 * `QUALITY.pixelRatioCap` 의 최대 티어 값이 정확히 이 2 이고, 아래 티어들이
 * 1.5·1.25·1 로 내려간다. 위 문단의 판단 — 2 위로는 보이지 않는다 — 은 그대로
 * 남아 있으므로 이 상수는 사라지지 않고 **천장**으로 남는다: `resolve` 가 티어
 * 값과 이것 중 작은 쪽을 쓴다. 표에 3 을 적는 것으로는 이 판단을 못 뒤집는다.
 */
const PIXEL_RATIO_CAP = 2;

/** 인자, 티어, 천장 셋 중 실제로 쓰이는 값. 두 호출부가 같은 식을 쓰게 한다. */
function resolvePixelRatioCap(override) {
  return Math.max(1, Math.min(PIXEL_RATIO_CAP, override ?? QUALITY.pixelRatioCap));
}

/**
 * Owns the WebGLRenderer and every sizing concern. Knows nothing about what
 * gets rendered, and no longer owns a render target — the bloom chain does, so
 * that the world can be post-processed while the UI drawn afterwards is not.
 * See `core/Composer.js`.
 */
export class Viewport {
  constructor({ canvas, pixelRatioCap = null }) {
    this.canvas = canvas;
    /**
     * 인자로 준 값이 이기고, 없으면 티어가 정한다.
     *
     * 인자가 남아 있는 것은 캡 뷰어처럼 설정을 꿰지 않는 진입점 때문이 아니라 —
     * 그쪽은 `QUALITY` 의 초기값을 그대로 받아 오늘의 그림이 나온다 — 이 클래스가
     * 렌더 파이프라인의 조립부이지 정책의 소유자가 아니기 때문이다.
     */
    this._pixelRatioOverride = pixelRatioCap;
    this.pixelRatioCap = resolvePixelRatioCap(pixelRatioCap);

    this.renderer = new WebGLRenderer({
      canvas,
      /**
       * 켜 둔다. **티어에 걸지 않는다.**
       *
       * 컨텍스트 속성이라 생성 후에는 바꿀 수 없다는 것이 첫 번째 이유이고, 그보다
       * 중요한 두 번째 이유는 이것이 무엇을 부드럽게 하는가다: 월드는 오프스크린
       * 타겟에 그려지므로 여기 AA 가 닿지 않고(`Composer` 의 `samples` 가 그 몫),
       * 이 플래그가 실제로 다루는 것은 기본 프레임버퍼 — 즉 **UI** 다. 조준 활,
       * 당김 선, 오차 콘, 카드 테두리가 전부 그쪽에 그려진다. 최저 티어에서
       * 꺼야 할 것은 월드의 MSAA 이지 UI 의 계단이 아니다.
       */
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
    /**
     * 렌더러 쪽 그림자 스위치. 티어가 0 을 주면 그림자 패스 자체가 돌지 않는다.
     *
     * 광원의 `castShadow` 와 맵 크기는 `lighting.js` 가 쥐고 있고, 이건 그보다
     * 위의 스위치다 — 둘 다 있어야 하는 이유는 하나를 끄면 다른 하나가 의미를
     * 잃기 때문이 아니라, 리그가 씬의 것이고 이 플래그는 렌더러의 것이기 때문이다.
     */
    this.renderer.shadowMap.enabled = QUALITY.shadowMapSize > 0;
    /**
     * `PCFShadowMap`. `PCFSoftShadowMap` 이 아니다.
     *
     * 브리프는 `PCFSoftShadowMap` 을 지정하지만 three 0.185 에서 그건 폐기됐고,
     * 지정해도 조용히 `PCFShadowMap` 으로 대체되면서 콘솔에 경고를 남긴다.
     * 실제로 그리는 것과 코드가 말하는 것이 다르면 안 되므로 실제 쪽에 맞췄다.
     *
     * 부드러움은 `lighting.js` 의 `sun.shadow.radius` 가 담당한다 — 브리프의
     * "하드 엣지 금지"는 그쪽에서 지켜진다.
     */
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.autoClear = true;
    /**
     * 지워지는 색이 검정이 아니다.
     *
     * 안전망이다. 하늘은 `core/sky.js` 의 돔이 그리는데, 그게 어떤 이유로든
     * 안 그려지면 — 카메라 far 밖으로 나갔다든가 — 남는 건 clear color 다.
     * 기본값은 검정이고, 그러면 "검정이 화면 어디에도 지배적이지 않다"는 조항이
     * 조용히 깨진다. 실제로 메뉴에서 그렇게 됐다. 지워지는 색을 하늘색으로 두면
     * 최악의 경우가 단색 하늘이지 검은 화면이 아니다.
     */
    this.renderer.setClearColor(new Color(PALETTE.bg.skyMid), 1);

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

    /**
     * 티어가 바뀌면 배율 상한이 바뀌고, 그러면 드로잉 버퍼 크기가 바뀐다.
     *
     * `_fit` 을 그대로 다시 태우는 것이 핵심이다 — 리사이즈와 품질 변경이 버퍼
     * 크기를 정하는 방식이 둘로 갈리면, 그 둘이 어긋났을 때 증상은 "창을 한 번
     * 흔들면 고쳐지는" 종류가 된다. 리스너들도 같은 알림을 받으므로 컴포저의
     * 타겟까지 한 경로로 따라온다.
     */
    this._offQuality = onQualityChange(() => {
      this.pixelRatioCap = resolvePixelRatioCap(this._pixelRatioOverride);
      this.renderer.shadowMap.enabled = QUALITY.shadowMapSize > 0;
      /**
       * 그림자 패스를 한 번 강제로 돌린다.
       *
       * 게임 문서는 `shadowMap.autoUpdate` 를 꺼 두고 뚜껑이 움직였을 때만 켠다
       * (`main.js`, `ArenaView.moved`). 그러니 티어를 바꿔 맵 크기가 달라져도
       * 아무것도 움직이지 않으면 다음 패스가 영영 오지 않고, 화면에는 옛 크기의
       * 그림자가 남는다 — 정지 화면에서 티어를 만졌을 때 정확히 그렇게 됐다.
       */
      this.renderer.shadowMap.needsUpdate = true;
      this._fit();
    });

    this._fit();
  }

  /**
   * The board's rectangle inside the drawing buffer, in DEVICE pixels, y-UP.
   *
   * 언제나 버퍼 전체다. 보드는 프레임이고 프레임은 캔버스이므로, 이 셋 사이에
   * 오프셋이 생길 자리가 없다.
   *
   * 그런데도 함수로 남는 이유는 호출부다: `boardClientRect` 가 포인터 매핑
   * 전체를 여기에 걸고 있다. 상수 `{x:0,y:0}` 를 호출부마다 인라인하면 보드가
   * 다시 프레임의 일부가 되는 날 고칠 곳이 세 곳이 된다.
   */
  boardRect() {
    return { x: 0, y: 0, w: this.resolution.x, h: this.resolution.y };
  }

  /**
   * The same rectangle inside the CANVAS, in CSS pixels, y-DOWN.
   *
   * The form a pointer wants: `clientY - rect.top - boardRectCss().y` is the
   * offset into the board.
   */
  boardRectCss() {
    const s = this.displaySize;
    return { x: 0, y: 0, w: s.x, h: s.y };
  }

  /**
   * The board's rectangle in CLIENT coordinates — a drop-in for the
   * `canvas.getBoundingClientRect()` every pointer mapping used to call.
   *
   * That is the point of the shape: it returns exactly the canvas rect, so every
   * call site can use it unconditionally.
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

    /**
     * One path, where there were two.
     *
     * The match page used to resolve a frame that could be taller than 4:3 and
     * fit the canvas to THAT, while the menu and the cap viewer fitted to a
     * fixed 4:3. The frame is 4:3 for everyone now, so both branches compute the
     * same shape and the flag that chose between them is gone. `FRAME.aspect`
     * rather than `BOARD_ASPECT` so the canvas matches the orthographic UI box
     * exactly — see the note on `aspect` in `frame.js`.
     */
    updateFrame(availW, availH);
    const aspect = FRAME.aspect;

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
    this._offQuality?.();
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('orientationchange', this._onResize);
    this._listeners.clear();
    this.renderer.dispose();
  }
}

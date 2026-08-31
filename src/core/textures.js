import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

/**
 * 절차적 텍스처의 래스터화 정책. 이 프로젝트에 이미지 파일은 하나도 없다.
 *
 * ── 무엇이 "픽셀처럼 보이게" 만들고 있었나 ──────────────────────────────────
 * 저해상도 렌더 타겟은 PHASE 1 에서 사라졌지만 화면은 여전히 계단졌고, 보드와
 * 잔디는 모아레로 끓었다. 원인은 레이아웃이 아니라 이 파일의 네 줄이었다:
 *
 *   MAX_TEXTURE = 128        모든 텍스처가 128 텍셀 상한
 *   NearestFilter (mag/min)  확대는 계단, 축소는 텍셀 행을 통째로 버림
 *   generateMipmaps: false   축소할 밉이 아예 없음
 *   anisotropy = 1           비스듬히 누운 바닥에서 최악
 *
 * 넷이 같이 있어야 콘솔 룩이 나오고, 넷 다 없어져야 계단이 사라진다. 특히
 * 밉맵 없는 nearest 축소는 부드럽게 만드는 게 아니라 **버린다** — 텍셀 행이
 * 통째로 샘플되지 않고, 그게 보드 weave 가 화면에서 끓던 이유다.
 *
 * ── 해상도만 올리면 같은 그림이 흐릿하게 커질 뿐이다 ────────────────────────
 * 이 상한을 올리는 것만으로는 아무것도 나아지지 않는다. 드로잉 코드가 128 을
 * 전제로 쓰였기 때문이다 — "실 두께 3텍셀"은 128 에서 2.3% 지만 1024 에서는
 * 0.3% 라 다른 그림이 된다. 그래서 이 파일의 상한을 올리는 것과 각 텍스처의
 * 좌표를 정규화하는 것은 같은 커밋에서 함께 일어나야 한다.
 */

/**
 * 텍스처 한 변의 상한.
 *
 * 128 이었다. 콘솔의 텍스처 캐시가 128x128 페이지였기 때문인데, 그 제약을
 * 재현하는 것이 이 프로젝트의 목표가 아니게 됐다. 1024 는 보드가 화면에서
 * 차지하는 픽셀 수를 넉넉히 넘기면서 — 2048 은 넘긴 만큼을 낭비다 — 모든
 * 텍스처를 합쳐도 GPU 메모리에서 문제가 되지 않는 선이다.
 */
export const MAX_TEXTURE = 1024;

/**
 * 이방성 필터링의 상한. 렌더러가 있어야 알 수 있다.
 *
 * 보드와 피치는 거의 눕혀서 보는 평면이라 이방성이 가장 크게 듣는 경우다.
 * 렌더러보다 먼저 만들어지는 텍스처가 있을 수 있으므로, 이미 만든 것들을
 * 레지스트리에 들고 있다가 렌더러가 생기면 소급 적용한다.
 */
let maxAnisotropy = 1;
const created = new Set();

/**
 * 렌더러를 알려준다. `Viewport` 생성 직후 한 번.
 *
 * @param {import('three').WebGLRenderer} renderer
 */
export function setTextureRenderer(renderer) {
  maxAnisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
  for (const t of created) {
    t.anisotropy = maxAnisotropy;
    t.needsUpdate = true;
  }
}

/**
 * 캔버스에 그린 텍스처. 모든 필터링 정책이 여기 한 곳에 있다.
 *
 * @param {number} size  한 변의 텍셀 수, `MAX_TEXTURE` 로 클램프
 * @param {(ctx: CanvasRenderingContext2D, size: number) => void} draw
 */
export function makeCanvasTexture(size, draw, options = {}) {
  const edge = Math.max(8, Math.min(MAX_TEXTURE, Math.round(size)));

  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;

  const ctx = canvas.getContext('2d');
  // 켠다. 껐던 이유는 이미지 스케일링이 계단져야 했기 때문이다.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  draw(ctx, edge);

  const texture = new CanvasTexture(canvas);
  /**
   * 캔버스는 sRGB 값을 담고 있으므로 그렇게 선언해야 한다.
   *
   * 기본값은 색 공간 없음이고 three 는 그걸 이미 선형이라고 본다. 여기 캔버스는
   * 전부 팔레트의 sRGB 리터럴로 칠해지므로, 그대로 두면 렌더러가 출력에서 한 번
   * 더 변환해 화면 전체가 허옇게 뜬다.
   */
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = options.wrapS ?? RepeatWrapping;
  texture.wrapT = options.wrapT ?? RepeatWrapping;
  texture.anisotropy = options.anisotropy ?? maxAnisotropy;
  texture.needsUpdate = true;

  created.add(texture);
  const dispose = texture.dispose.bind(texture);
  texture.dispose = () => {
    created.delete(texture);
    dispose();
  };

  return texture;
}

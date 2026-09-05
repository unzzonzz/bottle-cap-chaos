import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  Source,
  SRGBColorSpace,
} from 'three';
import { onQualityChange, QUALITY } from './quality.js';

/**
 * 절차적 **월드** 텍스처의 래스터화 정책. 이 프로젝트에 이미지 파일은 하나도 없다.
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
 * 상한을 올리는 것만으로는 아무것도 나아지지 않는다. 드로잉 코드가 128 을
 * 전제로 쓰였기 때문이다 — "실 두께 3텍셀"은 128 에서 2.3% 지만 1024 에서는
 * 0.3% 라 다른 그림이 된다. 그래서 이 파일의 상한을 올리는 것과 각 텍스처의
 * 좌표를 정규화하는 것은 같은 커밋에서 함께 일어났다. 그 정규화가 끝나 있다는
 * 것이 아래의 **다시 굽기**를 가능하게 하는 조건이기도 하다.
 *
 * ── 여기 오는 것은 **월드 텍스처뿐**이다. 그리고 그게 안전장치다 ────────────
 * 실제 호출부는 넷이고 전부 3D 표면이다: `boardTexture`, `pitchTexture`,
 * `metalTexture`, `cap/capTexture`. UI 는 한 줄도 여기를 지나지 않는다 — HUD,
 * 카드, 마크, FX, 메뉴 판은 각자 캔버스를 만들어 `toMarkTexture` 로 올리고,
 * 그것들의 크기는 프레임 픽셀에서 나온다.
 *
 * 그 분리가 우연이 아니라 **가독성 하한**이라는 점이 중요하다. 품질 티어는 이
 * 파일의 상한을 256 까지 내리는데, 같은 상한이 UI 에 걸리면 최저 티어에서 한글
 * 글자가 뭉개진다. 글자가 안 읽히면 게임이 안 되는 것이지 느린 게 아니다.
 * 그러니 UI 텍스처를 이 함수로 옮기고 싶어지면, 그때 갈라야 하는 것은 이
 * 파일이 아니라 그 텍스처다.
 *
 * ── 티어가 바뀌면 **텍스처 객체는 그대로 두고 캔버스만 다시 그린다** ─────────
 * `MarkTextures` 가 원격 마크를 위해 지키는 계약과 같은 것을 여기서도 지킨다.
 * 새 텍스처 객체를 만들어 돌려주면 이미 그걸 들고 있는 재질 서른 개를 전부
 * 찾아다녀야 하고, `GlossMaterials.create` 가 UV 변환을 위해 떠 둔 `clone()`
 * 들은 찾을 방법조차 없다.
 *
 * ── `needsUpdate` 한 줄로는 안 된다. GL 이 조용히 두 번 거절한다 ────────────
 * 처음에는 캔버스를 키우고 `needsUpdate = true` 만 올렸다. 최저(256)에서
 * 낮음(512)으로 올릴 때 GL 이 오류를 냈고, **화면에는 아무 증상이 없었다** —
 * 텍스처가 조용히 옛 해상도에 머문다. 콘솔에도 아무것도 안 나온다.
 *
 * 이유는 three 의 업로드 경로 두 곳이 각각 **다른 것**을 기준으로 판단하기 때문이다:
 *
 *   `initTexture`   GL 텍스처를 새로 만드는 조건은 **캐시 키가 바뀌었는가** 다.
 *                   `getTextureCacheKey` 는 래핑·필터·이방성·포맷만 본다 —
 *                   `Source` 도 이미지 크기도 들어 있지 않다.
 *   `uploadTexture` 저장소를 새로 잡는 조건은 **소스가 처음인가**
 *                   (`sourceProperties.__version === undefined`) 다.
 *
 * 그래서 소스만 갈아 끼우면 둘이 어긋난다: 저장소는 새로 잡으려 하는데
 * (`texStorage2D`) GL 텍스처는 옛 것 그대로라 이미 256 으로 불변 할당되어 있어
 * INVALID_OPERATION 이 나고, 이어지는 `texSubImage2D` 는 512 짜리 캔버스를 256
 * 저장소에 밀어 넣으려다 INVALID_VALUE 를 낸다. 실측한 오류 쌍이 정확히 그것이다.
 *
 * 티어 조합에 따라 나기도 하고 안 나기도 했다. 이방성이 캐시 키에 들어 있기
 * 때문이다 — 최저↔낮음은 둘 다 1 이라 키가 같아서 실패하고, 최저↔보통은 1 대 4 라
 * 키가 달라져 새 GL 텍스처가 생기면서 우연히 성공한다. 우연에 기대고 있었다.
 *
 * 그래서 크기가 바뀌면 **두 가지를 함께** 한다: 텍스처를 three 의 `dispose` 로
 * 놓아 주어(`properties.remove` 가 `__cacheKey` 와 `__webglTexture` 를 지운다)
 * 다음 사용에서 GL 텍스처가 새로 생기게 하고, `Source` 도 새 것으로 갈아 끼워
 * 저장소가 새 크기로 잡히게 한다. 순서가 중요하다 — `dispose` 는 **옛** 소스를
 * 통해 GL 텍스처를 찾으므로 소스를 바꾸기 **전**에 불러야 한다.
 *
 * 텍스처 객체와 `repeat`/`offset` 은 그대로 살아남는다. 그것이 이 파일이 지키는
 * 계약이고, `MarkTextures` 가 원격 마크를 위해 지키는 것과 같은 계약이다.
 * 사본은 GL 텍스처를 원본과 **공유**하므로 같이 놓아 주고 같은 새 소스를 받아야
 * 한다 — 그것이 `trackTextureClone` 이 사본과 원본을 함께 기억하는 이유다.
 */

/**
 * 월드 텍스처 한 변의 상한. 품질 티어가 정한다.
 *
 * 최대 티어에서 1024 다. 128 이었던 것은 콘솔의 텍스처 캐시가 128x128 페이지였기
 * 때문인데 그 제약을 재현하는 것이 이 프로젝트의 목표가 아니게 됐고, 1024 는
 * 보드가 화면에서 차지하는 픽셀 수를 넉넉히 넘기면서 — 2048 은 넘긴 만큼이
 * 낭비다 — 모든 텍스처를 합쳐도 GPU 메모리에서 문제가 되지 않는 선이다.
 */
function worldTextureMax() {
  return QUALITY.worldTexture;
}

/**
 * 이방성 필터링의 상한. 렌더러가 있어야 알 수 있다.
 *
 * 보드와 피치는 거의 눕혀서 보는 평면이라 이방성이 가장 크게 듣는 경우다.
 * 렌더러보다 먼저 만들어지는 텍스처가 있을 수 있으므로, 이미 만든 것들을
 * 레지스트리에 들고 있다가 렌더러가 생기면 소급 적용한다. 티어의 상한과
 * 기기의 상한 중 작은 쪽이 실제로 쓰인다.
 */
let deviceAnisotropy = 1;

function anisotropyNow() {
  return Math.max(1, Math.min(deviceAnisotropy, QUALITY.anisotropy));
}

/**
 * 살아 있는 월드 텍스처. 다시 구울 방법과 함께 들고 있는다.
 *
 * 값이 `null` 인 항목은 UV 변환용 사본이다 — 자기 그림이 없고 원본의 `Source` 를
 * 따라간다. 원본은 자기 사본들을 `clones` 에 들고 있다.
 *
 * @type {Map<import('three').Texture, {draw: Function, size: number,
 *   fixedAnisotropy: number|undefined, clones: Set<import('three').Texture>}|null>}
 */
const created = new Map();

/**
 * 렌더러를 알려준다. `Viewport` 생성 직후 한 번.
 *
 * @param {import('three').WebGLRenderer} renderer
 */
export function setTextureRenderer(renderer) {
  deviceAnisotropy = renderer.capabilities.getMaxAnisotropy?.() ?? 1;
  applyAnisotropy();
}

function applyAnisotropy() {
  const a = anisotropyNow();
  for (const [t, entry] of created) {
    // 명시적으로 지정된 것은 건드리지 않는다. 사본은 여기서 원본과 같이 받는다.
    if (entry?.fixedAnisotropy !== undefined || t.anisotropy === a) continue;
    t.anisotropy = a;
    t.needsUpdate = true;
  }
}

/**
 * 캔버스에 그린 월드 텍스처. 모든 필터링 정책이 여기 한 곳에 있다.
 *
 * `size` 는 **저자가 원하는 크기**이고 상한이 아니다. 티어가 상한을 내리면 여기서
 * 잘리고, 올리면 저자가 적은 크기까지 돌아온다 — 그래서 다시 굽기가 상한만 보고
 * 원래 값을 잊지 않으려면 원래 값을 들고 있어야 한다. 그것이 레지스트리가 텍스처
 * 하나당 `{draw, size}` 를 함께 담는 이유다.
 *
 * @param {number} size  한 변의 텍셀 수, 티어 상한으로 클램프
 * @param {(ctx: CanvasRenderingContext2D, size: number) => void} draw
 */
export function makeCanvasTexture(size, draw, options = {}) {
  const canvas = document.createElement('canvas');
  /**
   * 이 캔버스가 월드 텍스처의 것이라는 표시. 진단용이고 렌더에는 쓰이지 않는다.
   *
   * GL 오류는 텍스처가 아니라 이미지를 들고 온다 — `texSubImage2D(..., canvas)`.
   * 티어를 바꿀 때 어느 캔버스가 문제인지 알아내려면 캔버스 자신이 답할 수
   * 있어야 하고, 그게 없어서 한 번 헤맸다.
   */
  canvas.dataset.msa = `world:${size}`;
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

  // three 자신의 `dispose` 를 아래 래퍼로 덮기 **전에** 붙잡아 둔다. 크기가 바뀔 때
  // 부르는 것은 이쪽이다 — 래퍼를 부르면 레지스트리에서 빠져 다시 못 굽는다.
  created.set(texture, {
    draw,
    size,
    fixedAnisotropy: options.anisotropy,
    release: texture.dispose.bind(texture),
    clones: new Map(),
  });
  // 첫 칠은 `CanvasTexture` 가 방금 만든 소스를 그대로 쓴다. 갈아 끼우는 것은
  // 이미 GPU 에 올라간 뒤 크기가 바뀔 때뿐이다.
  paint(texture, false);

  const dispose = texture.dispose.bind(texture);
  texture.dispose = () => {
    created.delete(texture);
    dispose();
  };

  return texture;
}

/**
 * 한 텍스처의 캔버스를 지금 티어의 크기로 다시 그린다.
 *
 * @param {import('three').Texture} texture
 * @param {boolean} reallocate  `Source` 를 갈아 끼울 것인가. 머리말을 보라.
 */
function paint(texture, reallocate) {
  const entry = created.get(texture);
  if (!entry) return;
  const edge = Math.max(8, Math.min(worldTextureMax(), Math.round(entry.size)));

  const canvas = texture.image;
  // 같은 크기라도 다시 그린다. 이 함수의 호출자는 둘뿐이고 — 생성과 티어 변경 —
  // 후자에서 크기가 그대로인 경우는 `refreshWorldTextures` 가 이미 걸러 낸다.
  canvas.width = edge;
  canvas.height = edge;

  const ctx = canvas.getContext('2d');
  // 켠다. 껐던 이유는 이미지 스케일링이 계단져야 했기 때문이다.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  entry.draw(ctx, edge);

  const anisotropy = entry.fixedAnisotropy ?? anisotropyNow();

  if (reallocate) {
    // 놓아 주는 것이 먼저다. 머리말을 보라 — `dispose` 는 옛 소스를 통해 GL
    // 텍스처를 찾으므로, 소스를 바꾼 뒤에 부르면 옛 것이 그대로 남아 샌다.
    entry.release();
    for (const release of entry.clones.values()) release();

    const source = new Source(canvas);
    texture.source = source;
    for (const clone of entry.clones.keys()) {
      clone.source = source;
      // 이방성도 같이. 티어 하나가 크기와 이방성을 **동시에** 바꾸는 칸이 있다 —
      // 최저에서 보통으로 가면 256->512 이면서 1->4 다. 여기서 사본을 빼먹으면
      // 잔디만 이방성 1 로 남고, 증상은 비스듬한 바닥이 한쪽에서만 흐린 것이다.
      clone.anisotropy = anisotropy;
      clone.needsUpdate = true;
    }
  }

  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
}

/**
 * `GlossMaterials.create` 가 UV 변환을 위해 뜬 사본을 등록한다.
 *
 * 사본은 캔버스를 **공유**한다 — `Texture.clone()` 은 `Source` 를 복사하지 않고
 * 같은 것을 가리킨다. 그래서 다시 그릴 일은 없지만, 원본이 소스를 갈아 끼울 때
 * 같은 새 소스를 받아야 한다. 안 그러면 사본만 옛 소스에 남아서 보드는 새
 * 해상도로 바뀌고 잔디는 옛 해상도에 머문다.
 *
 * 원본이 월드 텍스처가 아니면(UI 쪽에서 온 사본) 조용히 무시한다. 등록되지
 * 않으므로 티어 변경 때 아무 일도 일어나지 않는 것이 맞다.
 *
 * @param {import('three').Texture} source  `clone()` 을 부른 원본
 * @param {import('three').Texture} clone
 */
export function trackTextureClone(source, clone) {
  const entry = created.get(source);
  if (!entry || created.has(clone)) return clone;
  const dispose = clone.dispose.bind(clone);
  // 사본 -> three 자신의 `dispose`. 원본이 크기를 바꿀 때 같이 놓아 준다.
  entry.clones.set(clone, dispose);
  created.set(clone, { clone: true });
  clone.dispose = () => {
    entry.clones.delete(clone);
    created.delete(clone);
    dispose();
  };
  return clone;
}

/**
 * 티어가 바뀌었다. 살아 있는 월드 텍스처를 새 상한으로 다시 굽는다.
 *
 * **UI 텍스처는 여기 없다.** `ui/fonts.js` 의 레지스트리가 비우는 네 캐시(HUD,
 * 카드, 마크 아이콘, FX)는 폰트가 도착했을 때만 비워지고 티어와는 무관하다 —
 * 글자 해상도를 티어에 거는 것이 이 작업에서 금지된 한 가지다.
 *
 * 캐시가 아니라 살아 있는 객체의 목록이므로 "티어를 키에 넣는" 문제도 없다.
 * 올렸다 내렸다 하면 매번 전부 다시 그려지고, 각 텍스처는 자기가 원래 원했던
 * 크기(`entry.size`)를 기억하고 있으므로 되돌아갈 곳도 정확하다.
 */
function refreshWorldTextures() {
  const max = worldTextureMax();
  for (const [texture, entry] of created) {
    // 사본은 원본이 처리한다 — 소스를 공유하므로 원본이 갈아 끼울 때 같이 받는다.
    if (entry.clone) continue;
    const edge = Math.max(8, Math.min(max, Math.round(entry.size)));
    if (texture.image && texture.image.width === edge) {
      // 크기가 그대로면 그림도 그대로다. 이방성만 손본다.
      const a = entry.fixedAnisotropy ?? anisotropyNow();
      if (texture.anisotropy !== a) {
        texture.anisotropy = a;
        for (const clone of entry.clones.keys()) clone.anisotropy = a;
        texture.needsUpdate = true;
      }
      continue;
    }
    paint(texture, true);
  }
}

/**
 * 모듈 스코프에서 구독한다. 부팅 경로가 기억할 일이 아니다.
 *
 * 이 파일이 이미 `maxAnisotropy` 라는 모듈 상태와 소급 적용 레지스트리를 들고
 * 있고, 티어는 정확히 같은 성질의 두 번째 입력이다. 두 문서(메뉴·게임)가 각자
 * 부팅하지만 각 문서에서 이 모듈은 한 번만 평가되므로 구독도 하나다.
 */
onQualityChange(refreshWorldTextures);

/**
 * 지금 이 기기가 어느 품질로 그리고 있는가. 렌더 쪽이 묻는 한 곳.
 *
 * ── 왜 모듈 싱글턴인가 ──────────────────────────────────────────────────────
 * 품질 티어를 읽어야 하는 것은 `Viewport`, `Composer`, `lighting`, `textures`,
 * `sky`, `menuMaterials`, 그리고 필드 뷰 넷이다. 이걸 전부 생성자 인자로 꿰면
 * 메뉴와 게임 두 부팅 경로가 각각 아홉 군데를 기억해야 하고, 하나를 빠뜨렸을 때
 * 증상은 "티어를 바꿔도 저것만 안 바뀐다" 라는 조용한 것이 된다.
 *
 * 이 프로젝트에는 이미 같은 성질의 것이 있다 — `textures.setTextureRenderer` 는
 * 모듈 변수 하나(`maxAnisotropy`)와 소급 적용용 레지스트리를 들고 있고, `BUDGET`
 * 과 `PALETTE` 와 `CONFIG` 는 전부 모듈 싱글턴이다. 여기도 같은 자리다.
 *
 * ── 이것은 **저장소가 아니다** ──────────────────────────────────────────────
 * 플레이어가 고른 값은 `GraphicsSettings` 의 문서에 있다. 여기 있는 것은 그 숫자
 * 하나를 표에 넣어 푼 **결과**이고, 페이지가 살아 있는 동안만 산다. 두 개를
 * 잇는 것은 부팅 경로 한 줄(`configureQuality`)과 `onChange` 구독 하나뿐이다.
 *
 * ── 시뮬레이션은 이 파일을 임포트하지 않는다 ────────────────────────────────
 * `physics/`, `game/`, `net/`, `replay/`, `server/` 중 어느 것도 여기를 읽지
 * 않으며, 읽으면 안 된다. 품질이 물리에 닿는 순간 같은 기기끼리 품질이 다르면
 * 다른 게임이 된다. `core/` 에 있는 것은 이것이 렌더 파이프라인의 것이기
 * 때문이고, `core/` 는 game 을 임포트하지 않는다 — 그래서 표는 여기가 아니라
 * `CONFIG.view.graphics` 에 있고 부팅 때 주입된다.
 */

/** 티어 수. 0 = 최저 … 4 = 최대. */
export const TIER_COUNT = 5;

/**
 * 화면에 쓰는 이름. **숫자가 아니라 이름이다.**
 *
 * 설정 화면의 읽기 판이 이것을 쓴다. "5/5" 는 아무 의미가 없다 — 5 단계가 몇
 * 단계인지 아는 사람만 읽을 수 있는 값이고, 그건 이 화면을 만든 사람뿐이다.
 */
export const TIER_NAMES = ['최저', '낮음', '보통', '높음', '최대'];

/** 기본이자 상한. 저장된 적 없는 기기가 여기서 시작한다. */
export const TIER_MAX = TIER_COUNT - 1;

/**
 * 그림자를 **던지는** 것의 등급.
 *
 * 캐스터는 켜고 끄는 것이 아니라 줄 세우는 것이다: 그림자가 답하는 유일한
 * 질문은 "이 뚜껑이 판에 붙어 있나 떠 있나" 이므로(`lighting.js`), 예산이 줄면
 * 그 질문에 답하는 것부터 남기고 무대 장치부터 버린다.
 *
 *   HERO     뚜껑, 공, 메뉴의 병. 접지감이 여기서 나온다.
 *   ORB      오브. 게임플레이 객체지만 접지가 판정에 쓰이지는 않는다.
 *   DRESSING 골대, 펜스, 레일 — 놓여 있을 뿐 아무 질문에도 답하지 않는다.
 */
export const SHADOW_RANK = { HERO: 1, ORB: 2, DRESSING: 3 };

/**
 * 지금 유효한 값들. **읽기 전용으로 다루라** — 쓰는 것은 `setQualityTier` 뿐이다.
 *
 * 객체 정체성이 유지된다는 것이 계약의 일부다. 소비자가
 * `import { QUALITY }` 로 잡아 두고 매 프레임 필드를 읽어도 최신값이 나온다.
 *
 * 초기값은 **최대 티어 그대로**다. 부팅 경로가 `configureQuality` 를 부르기 전에
 * 무언가가 읽더라도 오늘 출시되는 그림이 나오고, 캡 뷰어처럼 설정을 아예 꿰지
 * 않는 진입점은 여기 머문다.
 */
export const QUALITY = {
  tier: TIER_MAX,
  /** `Viewport` 의 드로잉 버퍼 배율 상한. */
  pixelRatioCap: 2,
  /** 월드 렌더 타겟의 MSAA 샘플 수. 0 이면 끔. 생성 시 고정이다. */
  msaaSamples: 4,
  /** 블룸 패스를 돌릴 것인가. */
  bloom: true,
  /** 블룸 블러 체인을 타겟의 몇 배로 돌릴 것인가. `BUDGET.bloomScale` 을 대체한다. */
  bloomScale: 0.5,
  /** 그림자 맵 한 변. 0 이면 그림자 자체를 끈다. */
  shadowMapSize: 2048,
  /** `SHADOW_RANK` 이하의 것들이 그림자를 던진다. 0 이면 아무것도 안 던진다. */
  shadowCasters: SHADOW_RANK.DRESSING,
  /** 병이 진짜 투과 유리인가. 거짓이면 `menuMaterials` 가 대체 재질을 쓴다. */
  glass: true,
  /** 모든 재질의 클리어코트 배수. `GlossMaterials.shared.clearcoatAmount`. */
  clearcoat: 1,
  /** PMREM 한 변. 0 이면 환경맵 없음 — `GlossMaterial` 의 금속 보정을 보라. */
  envSize: 256,
  /** 이방성 필터링 상한. 렌더러가 말하는 최대치로 다시 클램프된다. */
  anisotropy: 16,
  /** 월드 캔버스 텍스처 한 변의 상한. **UI 텍스처는 여기 걸리지 않는다.** */
  worldTexture: 1024,
  /** 병의 원주 분할. 메뉴 장식이다. */
  bottleColumns: 72,
  /** 기포 수의 배율. 1 이 오늘 출시되는 값. */
  fizzScale: 1,
  /** 하늘의 보케 광점 개수. 씬에 여섯 개가 있다. */
  bokeh: 6,
};

/** 최대 티어의 값. 표가 없을 때의 답이자, 표의 각 칸이 비었을 때의 기본값. */
const TOP = { ...QUALITY };

/** @type {Array<Partial<typeof QUALITY>>|null} 부팅이 주입한 표. */
let table = null;

const listeners = new Set();

/**
 * 정수 티어로 자른다. 저장 문서와 디버그 패널 양쪽에서 들어오므로 여기서 한 번.
 *
 * `NaN` 이나 문자열이 들어오면 **최대**로 떨어진다 — 최저가 아니다. 알 수 없는
 * 입력에 대한 안전한 답은 "덜 예쁘게" 가 아니라 "설정을 가진 적 없는 기기와
 * 같게" 이고, 그건 `defaultGraphicsSettings` 와 같은 값이어야 한다.
 */
export function clampTier(tier) {
  const n = Math.round(Number(tier));
  if (!Number.isFinite(n)) return TIER_MAX;
  return Math.max(0, Math.min(TIER_MAX, n));
}

/**
 * 표를 꽂고 첫 티어를 푼다. 부팅 경로에서 한 번, `Viewport` 보다 **먼저**.
 *
 * 먼저여야 하는 이유는 `pixelRatioCap` 과 `worldTexture` 다: 전자는 뷰포트가
 * 생성자에서 읽고, 후자는 뷰가 텍스처를 굽는 시점에 읽힌다. 순서가 뒤집히면
 * 첫 프레임만 최대 티어로 그려지고 그 다음부터 티어가 듣는, 가장 알아보기 어려운
 * 종류의 어긋남이 생긴다.
 *
 * @param {{table: Array<Partial<typeof QUALITY>>, tier: number}} opts
 */
export function configureQuality({ table: rows, tier }) {
  table = Array.isArray(rows) && rows.length ? rows : null;
  setQualityTier(tier);
}

/**
 * 티어를 바꾼다. 표에 없는 필드는 최대 티어의 값으로 되돌아간다.
 *
 * 항상 알린다 — 값이 같아도 그렇다. 부팅 경로가 이 한 번의 알림으로 파이프라인
 * 전체를 세우기 때문이고, "안 바뀌었으니 조용히" 는 그 자리에서 아무 일도 하지
 * 않는 부팅이 된다.
 */
export function setQualityTier(tier) {
  const t = clampTier(tier);
  const row = table?.[t] ?? null;
  for (const key of Object.keys(TOP)) {
    QUALITY[key] = row && row[key] !== undefined ? row[key] : TOP[key];
  }
  QUALITY.tier = t;
  for (const fn of [...listeners]) {
    try {
      fn(QUALITY);
    } catch (err) {
      // 한 소비자가 던져도 나머지는 갱신되어야 한다. 반쯤 적용된 파이프라인이
      // 적용 안 된 것보다 나쁘다 — `whenFontsReady` 가 캐시를 비울 때 같은 이유로
      // 같은 것을 한다.
      console.error('[quality] listener failed', err);
    }
  }
  return QUALITY;
}

/**
 * 티어가 바뀔 때 알림을 받는다.
 *
 * @returns {() => void} 자기 해제 함수. 소비자가 `dispose()` 에서 버린다.
 */
export function onQualityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 이 등급의 것이 지금 그림자를 던지는가.
 *
 * @param {number} rank `SHADOW_RANK` 중 하나
 */
export function castsShadow(rank) {
  return QUALITY.shadowMapSize > 0 && QUALITY.shadowCasters >= rank;
}

/**
 * 씬을 훑어 `userData.shadowRank` 가 붙은 메시의 `castShadow` 를 다시 정한다.
 *
 * 뷰마다 구독을 심는 대신 이걸 쓴다. 뷰는 만들 때 등급만 적어 두고(`tagShadow`),
 * 부팅 경로가 티어 변경 때 씬 하나를 훑는다 — 모드 전환으로 뷰가 통째로
 * 갈아끼워지는 이 게임에서, 구독을 들고 있는 쪽이 뷰가 되면 해제를 빠뜨리는
 * 자리가 뷰의 수만큼 생긴다.
 */
export function refreshShadowCasters(scene) {
  scene?.traverse?.((o) => {
    const rank = o.userData?.shadowRank;
    if (rank) o.castShadow = castsShadow(rank);
  });
}

/**
 * 메시에 등급을 적고 지금 값을 적용한다. 뷰가 메시를 만들 때 한 줄.
 *
 * @param {import('three').Object3D} object
 * @param {number} rank `SHADOW_RANK` 중 하나
 */
export function tagShadow(object, rank) {
  object.userData.shadowRank = rank;
  object.castShadow = castsShadow(rank);
  return object;
}

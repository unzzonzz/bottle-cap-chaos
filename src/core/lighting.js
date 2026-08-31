import { DirectionalLight, HemisphereLight, Object3D } from 'three';
import { PALETTE } from './palette.js';
import { BUDGET } from './budget.js';

/**
 * 씬의 조명 리그. 키 하나, 반구광 하나, 림 하나.
 *
 * ── 이 프로젝트에는 조명 객체가 하나도 없었다 ───────────────────────────────
 * PHASE 2 까지 모든 빛은 손으로 쓴 셰이더의 방향 유니폼이었고, 그 다음엔
 * 환경맵 하나가 전부였다. 환경맵만으로도 금속과 클리어코트는 살지만, 두 가지를
 * 못 한다: 그림자를 못 만들고, 방향이 없어서 뚜껑의 21개 주름이 다 같은 밝기로
 * 나온다. 주름을 읽히게 하는 건 스치듯 지나가는 빛이다.
 *
 * ── 세 개이고, 각자 다른 일을 한다 ──────────────────────────────────────────
 * `sun`   유일하게 그림자를 던진다. 접지감이 여기서 나온다.
 * `hemi`  그림자 안을 채운다. 이게 없으면 그림자가 검은 덩어리가 되는데,
 *         브리프가 명시적으로 금지하는 것이다 — 그림자 안에서도 색이 보여야 한다.
 * `rim`   카메라 반대편의 차가운 역광. 뚜껑 실루엣을 배경에서 떼어낸다.
 *
 * ── 그림자 프러스텀은 필드마다 다시 조여야 한다 ─────────────────────────────
 * 모드마다 필드 크기가 다르다. 커링 레인에 맞춘 프러스텀을 알까기 보드에 쓰면
 * 2048 텍셀의 대부분이 빈 공간에 쓰이고 그림자가 뭉개진다. 반대면 보드 밖의
 * 뚜껑이 그림자를 잃는다. `setExtents` 를 모드 전환마다 불러야 하는 이유다.
 */

/** 태양의 방향. `environment.js` 의 `uSunDir` 과 같은 값이어야 한다. */
const SUN_DIR = { x: -0.55, y: 0.72, z: 0.42 };

/**
 * ── 문서별 노출 배율을 넣었다가 뺐다 ────────────────────────────────────────
 * "경기 화면은 어둡고 메뉴는 밝다" 는 보고를 받고 `scale` 인자를 넣었는데, 재보니
 * 메뉴에서 이 리그는 거의 아무 일도 하지 않는다: 강도를 2배로 바꿔도 병 몸통의
 * 평균 휘도가 0.78 에서 0.761 로 2% 움직인다.
 *
 * 메뉴가 밝았던 것은 조명이 아니라 **하늘**이었다 — `PALETTE.bg.skyLow` 가 휘도
 * 0.874 라 화면 아래쪽이 평균 0.981, 사실상 흰 종이였다. 거기를 고쳤다.
 * 병의 하이라이트는 환경맵의 태양이 유리에 비친 것이라 어느 쪽과도 무관하고,
 * 그래서 요구대로 그대로 남았다.
 *
 * 쓰지 않는 인자를 남기지 않는다. 필요해지면 여기 세 줄에 `* k` 를 붙이면 된다.
 */
export function createLightRig(scene, { shadows = true, shadowMapSize = BUDGET.shadowMapSize } = {}) {
  /**
   * 키 라이트. 그림자를 던지는 유일한 광원이다.
   *
   * 방향은 `environment.js` 가 돔에 그려 넣은 태양 위치와 같다. 두 개가
   * 어긋나면 하이라이트가 생기는 쪽과 밝은 쪽이 달라져서, 스타일이 아니라
   * 렌더링 결함으로 읽힌다.
   */
  /**
 * 강도는 브리프의 2.4 가 아니라 재서 정한 값이다.
 *
 * 2.4 는 환경맵이 없다는 전제로 쓰인 숫자다. 이 씬에는 PMREM 환경맵이 있고
 * 그것도 확산광에 기여하므로, 2.4 를 그대로 쓰면 보드의 조도가 albedo 를 넘어
 * 화면 전체가 하얗게 날아간다. 실제로 그렇게 됐다.
 *
 * ── 0.95 / 0.42 / 0.35 였고, 실측으로 올렸다 ───────────────────────────────
 * 판 한가운데를 120x120 픽셀 읽어 상대 휘도를 재면:
 *
 *     0.95 / 0.42 / 0.35   평균 0.578  최대 0.607   ← 어두웠다
 *     1.15 / 0.50 / 0.40   평균 0.604  최대 0.632
 *     1.30 / 0.56 / 0.44   평균 0.623  최대 0.652   ← 지금
 *     1.45 / 0.62 / 0.48   평균 0.641  최대 0.672
 *
 * 상한을 정하는 것은 블룸 임계값 0.72 다. 판이 그것을 넘으면 나무가 빛나기
 * 시작하는데, 빛나야 하는 것은 젖은 금속이지 나무가 아니다. 1.45 조는 최대
 * 0.672 로 여유가 5% 밖에 없어서, 밝은 뚜껑이 겹치는 순간 넘는다. 1.30 조는
 * 10% 를 남긴다.
 */
const sun = new DirectionalLight(PALETTE.light.sun, 1.3);
  sun.position.set(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z).multiplyScalar(120);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  /**
   * `bias` 는 음수, `normalBias` 가 실제로 일하는 쪽.
   *
   * 뚜껑은 지름 32mm 에 높이 6mm 인 얇은 원반이라 그림자 아크네가 나기 쉽다.
   * `bias` 만으로 지우려면 값을 크게 줘야 하고, 그러면 접지 그림자가 뚜껑에서
   * 떨어져 나가는 피터패닝이 생긴다 — 하필 이 게임에서 그림자가 답해야 하는
   * 유일한 질문("이 뚜껑이 보드에 붙어 있나 떠 있나")이 그것이다. 표면 노멀
   * 방향으로 샘플을 밀어내는 `normalBias` 가 그 트레이드오프를 피한다.
   */
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  /** PCFSoft 의 부드러움. 하드 엣지 금지가 브리프 조항이다. */
  sun.shadow.radius = 3;
  // 타겟은 씬에 들어가 있어야 매트릭스가 갱신된다. 원점에 두고 프러스텀만 옮긴다.
  const target = new Object3D();
  scene.add(target);
  sun.target = target;
  scene.add(sun);

  /**
   * 하늘/땅 바운스. 그림자 안의 색을 담당한다.
   *
   * 위는 하늘색, 아래는 지면색. 키가 닿지 않는 면이 검게 죽지 않고 하늘색을
   * 띠게 만드는 게 전부이고, 그게 "그림자 안에서도 색이 보인다"의 구현이다.
   */
  const hemi = new HemisphereLight(PALETTE.light.ambientSky, PALETTE.light.ambientGround, 0.56);
  scene.add(hemi);

  /**
   * 림 라이트. 그림자를 던지지 않는다.
   *
   * 키의 대략 반대편, 낮은 각도. 뚜껑은 하늘과 비슷한 명도의 중간값 물체라서
   * 이게 없으면 배경에 가라앉는다. 그림자를 끄는 건 성능 문제가 아니라 정확성
   * 문제다 — 역광이 그림자를 던지면 카메라 쪽으로 그림자가 나와서 접지 그림자와
   * 싸운다.
   */
  const rim = new DirectionalLight(PALETTE.light.rim, 0.44);
  rim.position.set(0.62, 0.28, -0.74).multiplyScalar(120);
  rim.castShadow = false;
  scene.add(rim);

  /**
   * 그림자 카메라를 필드에 맞춘다. 모드 전환마다 불러야 한다.
   *
   * @param {{x: number, z: number}} extents  필드의 half-extent, 월드 단위
   */
  function setExtents(extents) {
    // 뚜껑이 보드 밖으로 날아가도 그림자를 잃지 않을 만큼의 여유. 필드에
    // 비례시키는 이유는 커링 레인과 알까기 보드가 세 배 넘게 차이 나기 때문이다.
    const pad = 1.35;
    const half = Math.max(extents.x, extents.z) * pad;
    const cam = sun.shadow.camera;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    // 광원이 120 만큼 떨어져 있으므로 그 뒤까지 덮는다.
    cam.far = 400;
    cam.updateProjectionMatrix();
    sun.shadow.needsUpdate = true;
  }

  function dispose() {
    sun.shadow?.map?.dispose();
    scene.remove(sun, hemi, rim, target);
    sun.dispose();
    hemi.dispose();
    rim.dispose();
  }

  return { sun, hemi, rim, setExtents, dispose };
}

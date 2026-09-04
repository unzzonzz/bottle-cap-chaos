import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from './palette.js';
import { onQualityChange, QUALITY } from './quality.js';

/**
 * 배경: 여름 하늘 돔, 그 위의 구름 몇 점, 수평선 아래의 바다.
 *
 * ── 야외 풍경이지만, 읽을 것이 있는 풍경은 아니다 ──────────────────────────
 * §10 이 하늘과 바다를 요구한다 — 맑은 여름 파랑, 소량의 부드러운 흰 구름, 먼
 * 코발트 바다. 그런데 §10 은 같은 절에서 **보드 주변에 오브젝트를 놓지 말라**고
 * 하고, 그 이유는 카메라 프레이밍이다: 축구는 "최소 줌에서 필드 전체가 보인다"
 * 가, 컬링은 "라인이 화면 밖으로 나가면 게임이 성립하지 않는다" 가 완료 기준이다.
 * 배경에 읽을 것이 있으면 그 두 조건이 흐려진다.
 *
 * 그 둘은 모순이 아니다. 하늘과 바다는 **거리**에 있고, 거리에 있는 것은 세부가
 * 없다. 여기 있는 것은 그라디언트 넷, 아주 느린 구름 여섯, 수평선의 밝은 선
 * 하나가 전부이고, 셋 다 어느 프레임에서도 세지 않고 지나칠 수 있는 것들이다.
 *
 * ── 구름은 보케를 물려받았다 ────────────────────────────────────────────────
 * 여기 있던 것은 보케 광점 여섯이었다 — 에어로 방향의 렌즈 효과. 기구는 그대로
 * 쓰고(돔 위의 부드러운 원반 몇 개, 티어로 개수를 줄이는 상수) 뜻만 바꿨다:
 * 가산 합성이 아니라 **덮는** 것이 됐고, 세로로 눌려 넓적해졌고, 수평선 위에만
 * 산다. 광점은 빛이고 구름은 물체다.
 *
 * ── 왜 `scene.background` 텍스처가 아니라 메시인가 ──────────────────────────
 * `scene.background` 에 그라디언트 텍스처를 넣으면 화면 공간에 고정되어 카메라가
 * 돌아도 따라오지 않는다. 알까기 카메라는 회전하고 팬하므로, 하늘이 붙박이면
 * 회전할 때 배경만 정지해 있어서 오히려 회전이 안 보인다. 돔은 월드에 있으므로
 * 카메라가 도는 게 배경에서 읽힌다.
 *
 * ── 시계는 프레임 클럭이다 ──────────────────────────────────────────────────
 * `update(dt)` 는 렌더 루프의 dt 를 받고 게임 상태를 읽지도 쓰지도 않는다.
 * `MatchAudio` 가 읽기 전용인 것과 같은 이유이고, 같은 강도로 지켜야 한다:
 * 배경이 시뮬레이션에 손대면 온라인 락스텝이 깨진다.
 */

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uMid;
  uniform vec3 uLow;
  uniform vec3 uBelow;
  uniform vec3 uSeaDeep;
  uniform vec3 uGlint;
  uniform vec3 uCloudColor;
  uniform vec3 uCloud[SEED_COUNT];   // xyz = 방향
  uniform float uCloudSize[SEED_COUNT];
  uniform float uCloudAlpha[SEED_COUNT];
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky;
    if (t > 0.5) {
      // 위 절반. 완만하게 — §10 의 "완만한 그라디언트".
      sky = mix(uMid, uTop, smoothstep(0.5, 1.0, t));
    } else if (t > 0.47) {
      // 수평선 바로 위, 하늘이 가장 옅어지는 좁은 띠.
      sky = mix(uLow, uMid, smoothstep(0.47, 0.5, t));
    } else if (t > 0.40) {
      /**
       * 바다의 먼 쪽. 수평선에서 코발트, 내려오며 옅어진다.
       *
       * 이 방향이 물리적으로 거꾸로라는 것은 PALETTE.bg.seaDeep 에 적혀 있다.
       * 요약하면, 탑다운 카메라가 보는 것은 돔의 맨 아래이고 그 띠가 인게임
       * 프레임의 55% 라, 물리대로 그리면 게임이 어두워진다.
       */
      sky = mix(uBelow, uSeaDeep, smoothstep(0.40, 0.47, t));
    } else {
      // 아래로 갈수록 측정된 'below' 로 수렴한다. 여기가 프레임의 밝기다.
      sky = uBelow;
    }

    /**
     * 수평선의 밝은 선 하나. §10 의 "반사 암시".
     *
     * 물 위의 반사는 **수평선에 붙어 있고** 위아래로 좁다. 폭을 좁게 잡는 것이
     * 요점이다 — 넓히면 반사가 아니라 안개가 된다. 가산이 아니라 mix 인 이유는
     * 가산이면 블룸 임계값을 넘기 때문이고, uGlint 자체가 이미 그 아래로
     * 골라진 값이다.
     */
    float glint = exp(-pow((t - 0.472) * 90.0, 2.0));
    sky = mix(sky, uGlint, glint * 0.55);

    /**
     * 구름. **덮는** 것이지 더하는 것이 아니다.
     *
     * 개수는 전처리기 상수다 — 티어를 내리면 이 루프가 컴파일 단계에서 사라진다.
     * 유니폼 알파를 0 으로 만드는 것으로는 셰이더가 여전히 여섯 번 돈다.
     *
     * 세로로 눌러서 넓적하게 만든다(diff.y * 3.4). 누르지 않으면 원반이고,
     * 원반은 하늘에 뚫린 구멍으로 읽힌다. 안쪽 로브를 하나 더 겹치는 것은
     * 뭉게구름의 가장 싼 흉내다 — 가장자리가 부드럽고 가운데가 두껍다.
     */
    for (int i = 0; i < CLOUD_COUNT; i++) {
      vec3 diff = d - normalize(uCloud[i]);
      diff.y *= 3.4;
      float r = length(diff);
      float s = uCloudSize[i];
      float a = 1.0 - smoothstep(s * 0.25, s, r);
      a += (1.0 - smoothstep(s * 0.08, s * 0.55, r)) * 0.45;
      /**
       * 수평선 아래에는 구름이 없다. 바다 위에 구름이 뜨면 그건 안개다.
       *
       * 게이트가 좁다(0.498..0.515, 즉 수평선에서 위로 1.7도). 먼 구름은 수평선에
       * 붙어 있고, 넓은 게이트는 그것들을 지워 버린다 — 씨앗의 y 를 내리고 나서
       * 0.50..0.56 게이트가 가장 낮은 두 개를 반쯤 먹고 있었다.
       */
      a *= smoothstep(0.498, 0.515, t);
      sky = mix(sky, uCloudColor, clamp(a, 0.0, 1.0) * uCloudAlpha[i]);
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

/** 손으로 정한 씨앗의 수. 셰이더 배열의 크기이기도 하다. */
const SEEDS = 6;

/**
 * 티어에 따라 실제로 도는 구름 개수.
 *
 * `QUALITY.bokeh` 라는 이름을 그대로 읽는다. 그 값이 정하는 것 — 돔 위의 부드러운
 * 원반을 몇 개나 도는가 — 은 바뀌지 않았고, 티어 표는 `core/quality.js` 에 있어
 * 이름을 고치면 그 표와 `CONFIG.view.graphics` 를 함께 고쳐야 한다. 뜻이 바뀐
 * 것은 그리는 쪽이지 세는 쪽이 아니다.
 *
 * 능력 표는 0/0/4/8/8 이라고 적었는데 이 씬의 씨앗은 손으로 정한 여섯 개다
 * (아래 `seeds`). 없는 것을 새로 만드는 대신 있는 것을 나누었다: 0/0/3/6/6.
 * 표의 의도 — 최저·낮음은 없고, 보통은 절반, 위는 전부 — 는 그대로다.
 */
function cloudCount() {
  return Math.max(0, Math.min(SEEDS, Math.round(QUALITY.bokeh)));
}

/**
 * 하늘 돔을 만들어 씬에 넣는다.
 *
 * @param {import('three').Scene} scene
 * @returns {{ mesh: Mesh, update: (dt: number) => void, dispose: () => void }}
 */
export function createSky(scene, { radius = 200 } = {}) {
  /**
   * 구름 여섯 점. 위치는 손으로 정한 고정값이다.
   *
   * `Math.random` 을 쓰지 않는 이유는 텍스처 파일들이 해시를 쓰는 이유와 같다:
   * 매번 다르게 나오면 두 스크린샷을 비교할 수 없고, 이 단계는 대부분 스크린샷을
   * 비교해서 판단한다.
   *
   * 전부 수평선 **위**에 있고, 셰이더가 한 번 더 확인한다 — 바다 위의 구름은
   * 구름이 아니라 안개다.
   *
   * 알파가 0.10~0.30 으로 올랐다. 보케는 눈치채면 실패하는 종류였고 구름은
   * 보여야 한다 — §10 이 요구하는 것은 "소량" 이지 "거의 없음" 이 아니다. 크기도
   * 함께 커졌다: 눌러서 넓적하게 만들면 같은 반경이 훨씬 작아 보인다.
   *
   * ── y 를 전부 내렸다. 카메라가 하늘을 거의 안 본다 ────────────────────────
   * 보케의 y 는 0.20~0.66 이었고, 하늘 어디에 있어도 상관없는 종류였으니 맞았다.
   * 구름은 보여야 하는데, 메뉴 카메라는 세로 화각 30도에 살짝 아래를 보므로
   * 프레임 위쪽이 수평선에서 겨우 14도다 — 방향 좌표로 `d.y` 0.24, 즉 위 여섯 중
   * **하나도** 프레임에 들어오지 않았다. 셰이더는 정상이었고 구름은 화면 밖에서
   * 잘 그려지고 있었다.
   *
   * 0.07~0.22 로 내렸다. 먼 구름이 수평선에 붙어 있는 것은 낮은 시점에서 실제로
   * 그렇기도 하다.
   *
   * ── 방위각도 함께 좁혔다. y 만 내리는 것으로는 부족했다 ──────────────────
   * 메뉴 카메라는 (0, 5.2, 62) 에서 −z 를 보고 세로 화각이 30도다. 가로는 4:3 이라
   * 약 40도이므로, 프레임에 들어오는 방향은 대략 `|x/z| < 0.36`, `|y/z| < 0.27`,
   * `z < 0` 인 원뿔 하나뿐이다. y 를 내린 뒤에도 여섯 개를 NDC 로 투영해 보니
   * (−5.46, 1.61) (3.38, 0.81) (−1.25, 1.40) … 여섯 개 **전부** 프레임 밖이었다.
   *
   * 그래서 넷을 그 원뿔 안에 놓고 둘은 밖에 남긴다. 게임 카메라는 방위가 바뀌므로
   * 밖의 둘도 언젠가 보이고, 메뉴는 고정이라 안의 넷만 본다.
   */
  const seeds = [
    { dir: new Vector3(-0.30, 0.15, -0.94), size: 0.30, alpha: 0.30, speed: 0.019 },
    { dir: new Vector3(0.24, 0.08, -0.97), size: 0.22, alpha: 0.24, speed: -0.014 },
    { dir: new Vector3(-0.05, 0.22, -0.97), size: 0.36, alpha: 0.16, speed: 0.011 },
    { dir: new Vector3(0.36, 0.19, -0.91), size: 0.19, alpha: 0.26, speed: -0.021 },
    { dir: new Vector3(-0.90, 0.07, 0.43), size: 0.26, alpha: 0.14, speed: 0.016 },
    { dir: new Vector3(0.20, 0.21, 0.96), size: 0.33, alpha: 0.10, speed: -0.009 },
  ];
  for (const s of seeds) s.dir.normalize();

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    /**
     * 광점 개수가 전처리기 상수다. 티어가 바뀌면 셰이더를 다시 컴파일한다.
     *
     * 비싸 보이지만 티어 변경은 사람이 판을 누를 때만 일어나고, 그 대가로 최저
     * 티어에서 이 프래그먼트 셰이더가 하늘 픽셀마다 도는 여섯 번의 길이 계산과
     * 두 번의 `smoothstep` 이 통째로 사라진다. 하늘은 화면의 절반이 넘는 유일한
     * 표면이라 여기서 아끼는 것이 실제로 재진다.
     */
    defines: { SEED_COUNT: SEEDS, CLOUD_COUNT: cloudCount() },
    side: BackSide,
    // 하늘은 모든 것의 뒤에 있고 깊이를 남기면 안 된다.
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTop: { value: new Color(PALETTE.bg.skyTop) },
      uMid: { value: new Color(PALETTE.bg.skyMid) },
      uLow: { value: new Color(PALETTE.bg.skyLow) },
      uBelow: { value: new Color(PALETTE.bg.below) },
      uSeaDeep: { value: new Color(PALETTE.bg.seaDeep) },
      uGlint: { value: new Color(PALETTE.bg.glint) },
      uCloudColor: { value: new Color(PALETTE.bg.cloud) },
      uCloud: { value: seeds.map((s) => s.dir.clone()) },
      uCloudSize: { value: seeds.map((s) => s.size) },
      uCloudAlpha: { value: seeds.map((s) => s.alpha) },
    },
  });

  const mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
  // 하늘이 먼저 그려지고 나머지가 그 위에 온다.
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  const offQuality = onQualityChange(() => {
    const n = cloudCount();
    if (material.defines.CLOUD_COUNT === n) return;
    material.defines.CLOUD_COUNT = n;
    material.needsUpdate = true;
  });

  let t = 0;
  const axis = new Vector3(0, 1, 0);

  /**
   * 구름을 아주 느리게 흘린다. 한 바퀴에 최소 5분.
   *
   * 각 구름이 자기 속도를 가지므로 서로에 대해서도 움직이는데, 가장 빠른 것이
   * 초당 0.021 라디안이다. 눈치채면 실패인 종류의 움직임이고, 구름이 되면서도
   * 그 판단은 그대로다 — 여름 하늘의 구름은 서 있는 것처럼 보인다.
   */
  /**
   * @param {number} dt
   * @param {import('three').Camera} [camera]
   *   주면 돔이 카메라를 따라다닌다. **주는 것이 사실상 필수다.**
   *
   *   ── 반경 900 짜리 돔을 far 400 카메라로 보면 아무것도 안 보인다 ────────
   *   `frustumCulled = false` 는 three 의 컬링만 끈다. far plane 클리핑은 GL
   *   단계라 막을 수 없다. 게임 카메라는 far 가 1200 이라 우연히 괜찮았고 메뉴는
   *   400 이라 돔이 통째로 잘려나가서, 배경이 clear color — 검정 — 이 됐다.
   *   브리프가 "검정이 화면 어디에도 지배적이지 않다"를 완료 기준으로 두는데
   *   메뉴 전체가 검게 나왔다.
   *
   *   돔을 카메라에 붙이면 반경이 near 와 far 사이이기만 하면 되고, 어느 카메라를
   *   쓰든 상관없어진다. `depthTest: false` 라 깊이와도 무관하다.
   */
  function update(dt, camera) {
    if (camera) mesh.position.copy(camera.position);
    if (!Number.isFinite(dt) || dt <= 0) return;
    t += dt;
    const dirs = material.uniforms.uCloud.value;
    for (let i = 0; i < seeds.length; i++) {
      dirs[i].copy(seeds[i].dir).applyAxisAngle(axis, seeds[i].speed * t);
    }
  }

  function dispose() {
    offQuality();
    scene.remove(mesh);
    mesh.geometry.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}

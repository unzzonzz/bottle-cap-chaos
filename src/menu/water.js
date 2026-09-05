import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector2 } from 'three';
import { PALETTE } from '../core/palette.js';

/**
 * 메뉴의 배경: 물.
 *
 * ── 왜 `core/sky.js` 를 고치지 않고 새로 만드는가 ───────────────────────────
 * 하늘 돔은 두 문서가 **공유하는** 모듈이다. 거기를 물로 바꾸면 판 위의 하늘까지
 * 물이 되고, 그건 3D 세계를 손대지 않는다는 이 작업의 전제를 깬다. 그래서 이
 * 파일은 `src/menu/` 에 있고, 메뉴 문서만 이것을 부른다.
 *
 * 인터페이스는 `createSky` 와 같은 모양이다 — `{ mesh, update, dispose }`. 그래야
 * `bootMenu` 에서 한 줄만 갈아 끼우면 되고, 되돌리는 것도 한 줄이다.
 *
 * ── 돔인 이유도 하늘과 같다 ────────────────────────────────────────────────
 * 화면 공간에 붙은 배경은 카메라가 움직여도 따라오지 않아서, 카메라의 움직임을
 * 오히려 지운다. 안쪽을 보는 구는 월드에 있으므로 시차가 생긴다.
 *
 * ── 굴절 무늬는 두 겹이고, 그 둘의 속도가 다른 것이 요점이다 ───────────────
 * 한 겹만 쓰면 무늬가 통째로 흘러가는 것으로 보인다 — 벽지가 움직이는 것이지
 * 물이 아니다. 두 겹을 서로 다른 방향·속도로 겹치면 교차점이 생겼다 사라지고,
 * 그 명멸이 물의 인상을 만든다. 실제 수면의 커스틱도 파면 여럿이 겹쳐 만드는
 * 초점이다.
 */

/**
 * 값 노이즈와 fbm. 제목의 굴절이 같은 물을 써야 하므로 밖으로 낸다.
 *
 * `sin` 해시를 쓰는 이유는 텍스처를 하나도 안 쓰기 위해서다 — 이 프로젝트에는
 * 이미지 파일이 없고(`fxTextures` 머리말 참조), 배경 하나 때문에 그 규칙을 깨는
 * 것보다 산술 해시 쪽이 싸다.
 */
export const WATER_NOISE_GLSL = /* glsl */ `
  float wHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float wNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x),
               mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float wFbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * wNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  /**
   * 세 옥타브짜리. 시안의 feTurbulence numOctaves="3" 을 그대로 옮긴 것이다.
   *
   * 네 옥타브와 눈으로는 거의 구별이 안 되지만 lag 프로파일에서는 갈린다 —
   * 옥타브가 하나 더 있으면 에너지가 잔 쪽으로 퍼져서 큰 얼룩이 약해진다.
   * 실측에서 긴 거리(lag 64)의 변화량이 시안보다 낮게 나온 것이 그것이었다.
   * 제목의 UV 흔들림은 계속 네 옥타브 wFbm 을 쓴다 — 거기선 잔 결이 이득이다.
   */
  float wFbm3(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * wNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  /**
   * 구름 한 겹. 시안의 feTurbulence fractalNoise 에 대응한다.
   *
   * 전에는 여기서 abs(a - b) 로 fbm 을 접어 **능선**을 세웠다. 물의 커스틱처럼
   * 보이라고 그랬는데, 시안에는 능선이 없다 — fractalNoise 를 그대로 알파로
   * 쓰는 옅은 구름이다. 능선은 가늘고 밝은 실을 만들고 그 실의 밝기가 흔들리면
   * 번개가 된다. 두 겹을 서로 다른 속도로 흘려 평균 내는 것만 남겼다.
   *
   * (이 주석에 백틱을 쓰지 마라. 템플릿 리터럴 안이라 문자열이 거기서 끊긴다.)
   */
  float wClouds(vec2 p, float t) {
    /**
     * 두 겹을 **평균 내지 않는다.** 한 겹으로 다른 한 겹의 좌표를 민다.
     *
     * 평균을 내면 분산이 절반이 된다. 실험실에서 시안과 전 화면 통계를 맞대니
     * 표준편차가 빨강에서 21.6 대 27.1 로 20% 밋밋했다 — 무늬가 있긴 한데
     * 힘이 없었다. 이유가 이 한 줄이었다. 도메인 워프로 바꾸면 흐름은 여전히
     * 두 방향으로 가면서 분산은 한 겹 그대로 남는다.
     */
    float w = wFbm3(p * 1.31 + vec2(t * -0.04, t * 0.045) + 31.4);
    return clamp(wFbm3(p + vec2(t * 0.05, t * -0.035) + (w - 0.5) * 0.6), 0.0, 1.0);
  }
  /**
   * sRGB 왕복. 시안의 산수를 하려면 필요하다.
   *
   * three 의 색 관리가 Color 를 선형으로 넣어 주는데, CSS 는 그라디언트도
   * blend 도 sRGB 에서 한다. 여기서 펴고, 다 섞은 뒤 다시 굽힌다.
   */
  vec3 wToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055,
               step(0.0031308, c));
  }
  vec3 wToLinear(vec3 c) {
    return mix(c / 12.92, pow((max(c, 0.0) + 0.055) / 1.055, vec3(2.4)),
               step(0.04045, c));
  }
`;

const VERT = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3  uCrest;
  uniform vec3  uBody;
  uniform vec3  uDeep;
  uniform vec3  uCaustic;
  uniform vec2  uResolution;
  uniform float uTime;
  uniform float uStir;
  /* 손잡이. docs/water-lab.html 이 이 값들을 직접 민다. (여기 백틱 금지) */
  uniform float uAmount;
  uniform float uFreq;
  uniform float uSoft;
  uniform float uSpeed;
  uniform float uStirBright;
  uniform float uAniso;

  ${WATER_NOISE_GLSL}

  void main() {
    /**
     * 바탕은 **화면 좌표의 타원**이다. 돔의 방향이 아니라.
     *
     * 시안이 radial-gradient(70% 55% at 30% 22%) 였다. 처음에 시선 방향으로 위아래
     * 그라디언트를 만들었더니 밝은 곳이 화면 위쪽 전체로 퍼졌고, 그래서 오른쪽
     * 아래에 앉는 내비의 대비가 깨져 비네트를 따로 넣어야 했다. 타원으로 돌리면
     * 밝은 곳이 왼쪽 위 한 군데에 모이고 오른쪽 아래가 저절로 가장 깊어진다 —
     * 가독성 장치를 덧붙일 필요가 없다. 구도가 문제를 푼 것이지 보정이 푼 것이
     * 아니다.
     */
    vec2 uv = gl_FragCoord.xy / uResolution;
    uv.y = 1.0 - uv.y;

    /**
     * 시안의 그라디언트 요소는 inset: -12% 다 — 프레임보다 24% 크다.
     *
     * 그 사실을 빼먹고 프레임 좌표를 그대로 썼더니 같은 정지점에 훨씬 빨리 닿아서
     * 화면이 통째로 어두워졌다. 실험실에서 시안과 나란히 놓고 보고서야 보였다.
     * 프레임의 점 f 는 그 요소 안에서 (f + 0.12) / 1.24 에 있다.
     */
    vec2 e = (uv + 0.12) / 1.24;
    vec2 d = (e - vec2(0.30, 0.22)) / vec2(0.70, 0.55);
    float r = length(d);

    /**
     * ── 여기부터 sRGB 공간이다 ──────────────────────────────────────────────
     *
     * CSS 는 그라디언트 보간도 blend 도 sRGB 에서 한다. 유니폼의 Color 는 three
     * 의 색 관리를 거쳐 **선형**으로 들어오므로, 시안과 같은 산수를 하려면 먼저
     * 펴야 한다. 마지막에 다시 굽혀 넘긴다 — 컴포저의 중간 타깃이 선형이고
     * OutputPass 가 끝에서 한 번만 변환하기 때문이다.
     */
    vec3 sCrest = wToSrgb(uCrest);
    vec3 sBody = wToSrgb(uBody);
    vec3 sDeep = wToSrgb(uDeep);

    /**
     * 정지점 사이는 **선형 보간**이다. smoothstep 이 아니다.
     *
     * CSS 그라디언트의 0% / 42% / 88% 는 직선으로 이어진다. smoothstep 을 쓰면
     * S 자가 되어 중간톤이 시안보다 밝은 쪽으로 눌린다.
     */
    vec3 base = mix(sCrest, sBody, clamp(r / 0.42, 0.0, 1.0));
    base = mix(base, sDeep, clamp((r - 0.42) / 0.46, 0.0, 1.0));

    // 굴절 무늬. 화면 좌표를 그대로 쓰되 세로를 눌러 수면처럼 눕힌다.
    /**
     * 세로 주파수가 가로보다 **높다.** 반대로 두고 있었다.
     *
     * 시안은 feTurbulence baseFrequency 0.008 0.02 다 — y 가 2.5 배 촘촘하다는
     * 뜻이고, 촘촘하면 그 축으로 무늬가 짧아져 **가로로 눕는다.** 수면을 비스듬히
     * 볼 때 보이는 그 모양이다. 나는 y 에 0.55 를 곱해 정확히 반대로, 세로로
     * 늘어진 줄무늬를 만들고 있었다.
     *
     * (시안의 굴절 층은 inset −20% 라 좌표가 1.4 배 넓지만, 그건 무늬의 크기일
     *  뿐이라 uFreq 가 흡수한다.)
     */
    float n = wClouds(vec2(uv.x, uv.y * uAniso) * uFreq * 1.95, uTime * uSpeed);

    /**
     * 알파 곡선은 시안의 feColorMatrix 를 그대로 옮긴 것이다:
     *
     *   A = uSoft - 1.6 * n,  clamp 0..1        (시안의 uSoft 는 1.05)
     *
     * 노이즈가 0.656 을 넘으면 굴절이 아예 없고 0.03 아래면 꽉 찬다. 평균 알파가
     * 0.3 근처라 화면의 3분의 2 정도에 옅게 깔린다. 마스크는 없다 — 시안의 굴절
     * 층은 반지름 감쇠 없이 화면 전체를 균일하게 덮고, 감쇠는 바탕 그라디언트가
     * 이미 하고 있다.
     */
    float a = clamp(uSoft - 1.6 * n, 0.0, 1.0) * uAmount;

    /**
     * ── 커서는 물의 **밝기**를 건드리지 않는다 ──────────────────────────────
     * 여기가 c *= 0.55 + min(0.75, uStir) 였다. 커서 속도가 무늬의 밝기를 최대
     * 2.4 배까지 밀어 올렸고, 고주파 무늬의 밝기를 펌프질하면 **번쩍인다** —
     * 사용자가 "마우스 움직이면 천둥 치는 것 같다" 고 한 것이 이것이다.
     *
     * 시안의 물도 커서에 반응하지만 반응하는 것은 위치이지 밝기가 아니다. 물은
     * 밀리는 것이지 켜지는 것이 아니다. 그래서 기본값이 0 이고, 손잡이는
     * docs/water-lab.html 이 다시 켜 볼 수 있게 남겨 둔다.
     */
    a *= 1.0 + uStirBright * uStir;

    /**
     * ── screen 합성. 더하기가 아니다 ────────────────────────────────────────
     *
     * 시안은 mix-blend-mode: screen 에 opacity .5 다. 풀면
     *
     *   Cr = Cb + Ae * Cs * (1 - Cb)
     *
     * 이고 저 (1 - Cb) 가 전부다 — 바탕이 밝을수록 굴절이 덜 얹힌다. 그래서
     * 시안의 물은 아무리 흔들려도 흰색으로 날아가지 않는다. 나는 이걸 빼고
     * base + uCaustic * c * uAmount 로 선형 공간에서 그냥 더하고 있었고,
     * 실험실에서 재니 화면 중앙이 (255,255,255) 로 포화되어 있었다.
     */
    vec3 col = base + a * wToSrgb(uCaustic) * (1.0 - base);

    gl_FragColor = vec4(wToLinear(col), 1.0);
  }
`;

/**
 * @param {import('three').Scene} scene
 * @param {{radius?: number}} [opts]
 */
export function createWater(scene, { radius = 200 } = {}) {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: BackSide,
    // 물은 모든 것의 뒤에 있고 깊이를 남기면 안 된다. 하늘과 같은 이유다.
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uCrest: { value: new Color(PALETTE.water.crest) },
      uBody: { value: new Color(PALETTE.water.body) },
      uDeep: { value: new Color(PALETTE.water.deep) },
      uResolution: { value: new Vector2(1, 1) },
      uCaustic: { value: new Color(PALETTE.water.caustic) },
      uTime: { value: 0 },
      uStir: { value: 0 },
      /**
       * ── 이 네 값은 눈이 아니라 **실측**으로 정했다 ─────────────────────────
       *
       * 시안의 숫자를 그대로 베끼면 틀린다. 시안의 굴절은 feTurbulence 이고 이건
       * 값 노이즈 fbm 이라, 같은 opacity 를 넣어도 알파 분포가 달라 결과가 다른
       * 그림이 된다. 그래서 숫자 대신 **화면 통계**를 맞췄다. docs/water-lab.html
       * 이 시안의 SVG 를 실제 픽셀로 굽고 853x480 전 화면에서 넷을 비교한다:
       *
       *              시안                        여기
       *   평균     62.1 / 129.4 / 206.4      61.7 / 128.2 / 205.6
       *   표준편차  27.1 /  31.6 /  15.0      27.4 /  31.9 /  15.1
       *   lag x     1.8/3.6/6.7/11.3/16.7     2.1/4.0/7.3/12.0/17.6
       *   lag y     4.7/8.5/13.5/18.3/21.0    4.9/8.7/13.8/19.0/21.8
       *
       * 앞의 둘은 밝기와 대비, lag 은 무늬의 **크기**다 — 거리 d 만큼 떨어진 두
       * 픽셀의 평균 차이. 앞의 둘만 맞추면 밝기는 같은데 무늬가 4 배 성긴 그림이
       * 나온다. 실제로 한 번 그렇게 만들었다.
       *
       * 픽셀 단위로 더 맞추려 들지 마라. RMSE 가 13.2 인데 시안의 시드만 바꿔
       * 다시 구운 것끼리도 16.1 이다 — 이미 시안이 자기 자신과 닮은 것보다 더
       * 닮았고, 그 아래는 노이즈를 맞추는 일이라 뜻이 없다.
       */
      uAmount: { value: 0.44 },
      uFreq: { value: 6.5 },
      uSoft: { value: 0.95 },
      uSpeed: { value: 1 },
      /**
       * 0. 커서는 물을 **밀 뿐** 켜지 않는다.
       *
       * 0 이 아니면 커서를 움직일 때마다 무늬가 번쩍인다. 값을 남겨 둔 것은
       * 실험실에서 다시 켜 보기 위해서지 켜 두기 위해서가 아니다.
       */
      uStirBright: { value: 0 },
      uAniso: { value: 1.4 },
    },
  });

  const mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  /** 젓는 세기. 포인터 속도가 밀어 넣고, 여기서 저절로 잦아든다. */
  let stir = 0;

  return {
    mesh,
    /** 시간을 민다. `dt` 는 렌더 클럭이고 게임 상태를 읽지 않는다. */
    /**
     * @param {number} dt
     * @param {{x: number, y: number}} [size]  드로잉 버퍼 크기. 화면 좌표 그라디언트가 쓴다
     */
    update(dt, size) {
      if (size) material.uniforms.uResolution.value.set(size.x || 1, size.y || 1);
      material.uniforms.uTime.value += dt;
      // 지수 감쇠. 스프링이 아닌 이유는 이 값이 0 으로만 돌아가면 되기 때문이다.
      stir *= Math.exp(-dt * 1.6);
      material.uniforms.uStir.value = stir;
      // 제목이 같은 물을 써야 하므로 돌려준다. 두 셰이더가 각자 감쇠를 계산하면
      // 언젠가 갈리고, 갈린 뒤에는 배경과 글자가 다른 물에서 흔들린다.
      return stir;
    },
    /**
     * 물을 젓는다. 커서 **속도**가 부르는 것이지 위치가 부르는 것이 아니다 —
     * 가만히 올려 둔 커서는 물을 젓지 않는다.
     *
     * @param {number} amount 0..1 정도의 세기
     */
    stir(amount) {
      stir = Math.min(1.2, stir + Math.max(0, amount));
    },
    dispose() {
      scene.remove(mesh);
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

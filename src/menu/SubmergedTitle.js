import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { FRAME, frameScale } from '../core/frame.js';
import { PALETTE } from '../core/palette.js';
import { submergedTitleTexture } from './menuTextures.js';
import { WATER_NOISE_GLSL } from './water.js';

/**
 * 물에 잠긴 제목.
 *
 * ── 왜 `MenuItems` 에서 나왔는가 ───────────────────────────────────────────
 * 제목은 열의 머리글이었다 — 항목들 바로 위에 붙어 한 덩어리로 배치됐다. 이 구조
 * 에서는 그 관계가 없다. 제목은 화면을 가로지르는 **오브제**이고 내비는 구석의
 * 작은 글자다. 둘을 한 클래스가 배치하면 한쪽을 옮길 때마다 다른 쪽이 따라온다.
 *
 * ── 굴절은 물과 같은 노이즈를 쓴다 ────────────────────────────────────────
 * 배경과 제목이 서로 다른 노이즈로 흔들리면 두 개의 물이 겹친 것으로 보인다.
 * `water.js` 가 GLSL 조각을 내보내는 이유가 이것이고, 두 셰이더가 같은 `uTime`
 * 을 받는 이유도 같다.
 *
 * ── 잘리는 것이 구조다 ────────────────────────────────────────────────────
 * 쿼드가 프레임보다 넓고, 왼쪽으로 밀려 나가 있다. 안전하게 안쪽에 들어오면
 * 그냥 큰 글자가 되고, 잘려야 "화면 밖에도 계속된다" 가 된다.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3  uTint;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uAmount;
  varying vec2  vUv;

  ${WATER_NOISE_GLSL}

  void main() {
    /**
     * 굴절. 두 방향의 fbm 을 각각 x 와 y 에 먹인다.
     *
     * 한 노이즈를 두 축에 쓰면 글자가 대각선으로만 흔들려서 전단으로 보인다.
     * 물은 축마다 다른 위상으로 민다.
     */
    float nx = wFbm(vUv * 3.4 + vec2(uTime * 0.05, uTime * -0.03));
    float ny = wFbm(vUv * 3.4 + vec2(uTime * -0.04, uTime * 0.045) + 17.3);
    /**
     * ── 이름은 커서에 반응하지 않는다 ──────────────────────────────────────
     * 여기가 uAmount * (1.0 + uStir * 1.6) 이었다. uStir 은 1.2 까지 누적되므로
     * (water.js 의 stir 클램프) 커서를 빠르게 움직이면 유효 세기가 0.016 에서
     * 0.0467 로, 2.9 배까지 올라갔다 — 아래 uAmount 주석이 "0.05 를 넘으면
     * 받침이 무너진다" 고 적어 둔 그 임계의 93% 다.
     *
     * 실측(제목만 렌더해서 굴절 없는 판과 윤곽을 비교):
     *   커서 정지  평균 획 이동 0.67 px
     *   커서 최대  평균 획 이동 1.88 px
     *
     * 사진을 굴절시키는 것은 괜찮다. 한글을 굴절시키는 것은 다르다 — 획이 얇고
     * 속공간이 좁아서, 같은 변위가 사진에서는 물결이고 글자에서는 흔들림이다.
     * water.js 가 밝기에 대해 이미 배운 교훈이고(uStirBright 기본 0), 그때
     * 기하학에는 적용하지 않았다.
     *
     * 물은 계속 커서에 반응한다. 그 대비가 옳다 — 물은 움직이고 이름은 움직이지
     * 않는다.
     */
    vec2 uv = vUv + (vec2(nx, ny) - 0.5) * uAmount;

    vec4 texel = texture2D(uMap, uv);
    /**
     * 색은 위아래로 **변하지 않는다.**
     *
     * 아래로 갈수록 물빛이 섞이는 그라디언트가 있었다 — 깊이의 단서였다. 화면의
     * 모든 글자가 같은 잉크여야 한다는 결정에 따라 없앴다: 제목 안에서 색이
     * 변하면 내비와도 같지 않고 자기 자신과도 같지 않다. 깊이는 굴절이 말한다.
     */
    gl_FragColor = vec4(uTint, texel.a * uOpacity);
  }
`;

export class SubmergedTitle {
  /** @param {number} unitsPerPixel */
  constructor({ unitsPerPixel }) {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uMap: { value: null },
        /**
         * 잉크는 **흰색이 아니라 옅은 파랑**이다.
         *
         * 두 이유가 같은 값을 가리킨다. 물리적으로는 물 아래의 흰 것이 파랗게
         * 어두워지고, 기술적으로는 순백이 블룸 브라이트패스(선형 0.72)를 한참
         * 넘어 글자가 통째로 흰 덩어리가 된다 — 실측으로 그렇게 됐다.
         * `bluePale` 의 선형 휘도는 0.685 로 임계 바로 아래다.
         */
        uTint: { value: new Color(PALETTE.water.ink) },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        /**
         * 굴절의 세기, UV 단위. **0.010.**
         *
         * ── 이 값을 어떻게 골랐나 ────────────────────────────────────────
         * 0.006 부터 올리며 제목만 렌더해서, 굴절 없는 판과 행마다 잉크의 좌우
         * 끝을 비교했다 (853x480 저술 프레임 기준):
         *
         *   0.006   평균 획 이동 0.92 px   0 과 구별되지 않는다
         *   0.010   평균 획 이동 2.41 px   ← 이것
         *   0.014   평균 획 이동 3.12 px   알의 ㄹ 가로획이 눈에 띄게 휜다
         *   0.020   평균 획 이동 4.84 px   획이 물결친다
         *
         * 기준은 "물 속으로 보이되 불안정해 보이지 않는다" 이고, 그 경계가
         * ㄹ 의 가운데 가로획과 ㅇ 의 속공간에서 갈렸다. 0.014 에서 가로획이
         * 휘기 시작하고 0.020 에서 ㄹ 이 무너진다.
         *
         * 예전 값은 0.016 이었고, 커서가 곱해서 0.0467 까지 갔다 — 그 이야기는
         * 위 `uv` 주석에 있다.
         */
        uAmount: { value: 0.010 },
      },
    });

    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = -500;
    this.mesh.frustumCulled = false;
    this.root = this.mesh;
    this._key = '';
    this.layout(unitsPerPixel);
  }

  /**
   * 다음 `layout()` 에서 제목을 다시 굽게 한다.
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────────────
   * 제목은 캔버스 텍스처로 구워지고, 그 텍스처를 이 머티리얼의 유니폼이 쥔다.
   * `bootMenu` 는 `whenFontsReady()` 를 기다리지 않고 부르므로(그래야 첫 프레임이
   * 늦지 않는다) 이 객체는 디스플레이 서체가 도착하기 **전에** 만들어지고,
   * 폴백 서체로 구워진 텍스처가 그대로 남는다. `layout()` 의 가드가
   * `if (!uMap.value)` 라 다시 굽지도 않는다.
   *
   * 실측: 살아 있는 텍스처의 잉크가 43,323 픽셀, 폰트가 붙은 뒤 다시 구우면
   * 72,115 픽셀이었다. 40% 가 사라져 있었다 — 화면에서는 명조 대신 실처럼 가는
   * 폴백 획이 보였고, 그게 "폰트가 달라서 퀄리티가 낮다" 의 정체였다.
   *
   * `ui/fonts.js` 의 등록부가 이것을 부른다. 그쪽 머리말이 같은 함정을 네 개의
   * 다른 캐시에 대해 설명하고 있다 — `menuTextures` 만 빠져 있었다.
   */
  invalidate() {
    this.material.uniforms.uMap.value?.dispose();
    this.material.uniforms.uMap.value = null;
  }

  /** @param {number} unitsPerPixel */
  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;

    if (!this.material.uniforms.uMap.value) {
      this.material.uniforms.uMap.value = submergedTitleTexture({ scale: 1 });
    }
    const box = this.material.uniforms.uMap.value.userData;

    /**
     * 시안의 좌표를 그대로 놓는다.
     *
     * `.subWrap` 은 left −56 / top 6 이고 폭이 853+112, 높이가 행 상자 두 개다.
     * 회전은 그 블록의 **중심**을 축으로 −7 도. 중심을 프레임 좌표로 옮기면
     * x 는 정확히 프레임 가운데(−56 + 965/2 = 426.5)이고, y 는 6 + 높이/2 다.
     *
     * 프레임이 넓어지면(정책 C, 최대 853) 이 값들은 그대로 두고 가운데 정렬만
     * 따라간다 — 시안이 853 폭에서 그려졌으므로 그것이 기준 폭이다.
     */
    /**
     * 시안의 좌표에 **프레임 배율**을 태운다.
     *
     * 시안은 853x480 에서 그려졌고 텍스처도 그 크기로 굽는다. 작은 창에서
     * 프레임은 그보다 작아지므로(정책 C 에서 높이가 크기 축이다) 그대로 놓으면
     * 제목만 프레임보다 커진다 — 실측으로 프레임 562 에서 965 폭 제목이 앉아
     * 첫 줄이 통째로 화면 밖이었다.
     *
     * `frameScale()` 은 이 프로젝트의 모든 저술값이 쓰는 그 배율이다. 제목만
     * 다른 규칙을 쓰면 창을 줄일 때 제목만 어긋난다.
     */
    const k = frameScale();
    const cx = 0;
    // 중심은 **내용** 높이로 잡는다. 캔버스의 여백은 대칭이라 중심을 옮기지 않는다.
    const cy = FRAME.height / 2 - (6 + (box.contentH ?? box.height) / 2) * k;

    this.mesh.scale.set(box.width * k * u, box.height * k * u, 1);
    this.mesh.position.set(cx * u, cy * u, 0);
    /**
     * 부호를 **뒤집는다.** CSS 와 three 의 회전 방향이 반대다.
     *
     * `box.rotation` 은 시안의 CSS 값 그대로 −7 이다. CSS 의 rotate() 는 y 가
     * 아래로 가는 좌표계에서 양수가 시계 방향이므로 −7deg 는 **반시계** 7 도다.
     * three 는 y 가 위로 가고 rotation.z 양수가 반시계이므로, 같은 그림을 얻는
     * 값은 +7 이다. 그대로 넣으면 제목이 정확히 반대로 기운다.
     *
     * 저술값 쪽을 +7 로 바꾸지 않는 이유는 그것이 시안에서 온 숫자이기 때문이다 —
     * 출처가 CSS 인 값은 CSS 의 부호로 남기고, 변환은 쓰는 자리에서 한다.
     *
     * 실측(제목만 렌더해서 시안 기하학과 겹친 IoU):
     *   z = −7  →  0.202,  주축 16.76도
     *   z = +7  →  0.601,  주축  6.93도   (시안 6.88도)
     * 남은 0.4 는 굴절이 획을 밀어서 생기는 차이다 — 시안 기준판에는 굴절이 없다.
     */
    this.mesh.rotation.z = (-box.rotation * Math.PI) / 180;
  }

  /**
   * @param {number} dt
   * @param {number} stir  물을 젓는 세기. `water.stir` 과 같은 값을 받는다
   * @param {number} fade
   */
  /**
   * @param {number} dt
   * @param {number} fade
   *
   * 커서를 받지 않는다. 예전에는 `water.update` 가 돌려주는 stir 을 그대로
   * 받아 굴절 세기에 곱했다 — 셰이더의 `uv` 주석 참조.
   */
  update(dt, fade = 1) {
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uOpacity.value = fade;
  }

  dispose() {
    this.material.uniforms.uMap.value?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

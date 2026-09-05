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
  uniform float uStir;
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
    float amt = uAmount * (1.0 + uStir * 1.6);
    vec2 uv = vUv + (vec2(nx, ny) - 0.5) * amt;

    vec4 texel = texture2D(uMap, uv);
    // 수면 아래로 갈수록 물빛이 섞인다. 글자가 물 **안에** 있다는 유일한 단서다.
    float depth = smoothstep(0.15, 1.0, vUv.y);
    vec3 rgb = mix(uTint, uTint * 0.72, depth);
    gl_FragColor = vec4(rgb, texel.a * uOpacity);
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
        uTint: { value: new Color(PALETTE.bluePale) },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        /**
         * 굴절의 세기, UV 단위.
         *
         * 0.05 를 넘으면 받침이 무너져서 읽히지 않는다. §0.4 가 미학보다 위이고,
         * 이 화면에서 반드시 읽혀야 하는 것은 게임의 이름 하나다.
         */
        uAmount: { value: 0.016 },
        uStir: { value: 0 },
      },
    });

    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.renderOrder = -500;
    this.mesh.frustumCulled = false;
    this.root = this.mesh;
    this._key = '';
    this.layout(unitsPerPixel);
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
    this.mesh.rotation.z = (box.rotation * Math.PI) / 180;
  }

  /**
   * @param {number} dt
   * @param {number} stir  물을 젓는 세기. `water.stir` 과 같은 값을 받는다
   * @param {number} fade
   */
  update(dt, stir = 0, fade = 1) {
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uStir.value = stir;
    this.material.uniforms.uOpacity.value = fade;
  }

  dispose() {
    this.material.uniforms.uMap.value?.dispose();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

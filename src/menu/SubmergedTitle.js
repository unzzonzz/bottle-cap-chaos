import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { FRAME } from '../core/frame.js';
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

    /**
     * 상자는 `submergedTitleTexture` 가 글자를 재서 정한다. 여기서는 그것을
     * 프레임 왼쪽에 걸쳐 놓기만 한다 — 잘리는 것이 구조이고, 잘리는 **양**은
     * 글자 크기에 비례해야 창이 바뀌어도 같은 그림이 된다.
     */
    /**
     * 글자 크기를 **프레임에서** 정한다.
     *
     * 0.135 는 실측이다. `lettering.js` 는 획으로 그리므로 em 상자를 거의 꽉
     * 채운다 — 처음에 0.25 로 잡았더니 글자 하나가 프레임 높이의 절반이었고
     * 두 줄이 서로를 덮었다. 지금은 글자 하나가 프레임 높이의 약 4분의 1이고,
     * 두 줄이 겹치지 않으면서 첫 줄의 왼쪽만 잘린다.
     */
    const size = Math.round(FRAME.width * 0.135);
    const key = `${size}`;
    if (key !== this._key) {
      this._key = key;
      this.material.uniforms.uMap.value?.dispose();
      this.material.uniforms.uMap.value = submergedTitleTexture({ size, scale: 1 });
    }
    const box = this.material.uniforms.uMap.value.userData ?? { width: size * 4, height: size * 2 };

    this.mesh.scale.set(box.width * u, box.height * u, 1);
    // 왼쪽으로 밀고 살짝 위. 기울기는 레퍼런스의 각도다.
    /**
     * 첫 줄의 왼쪽만 프레임 밖으로. 상자의 왼쪽 끝이 프레임 왼쪽에서 글자
     * 하나의 5분의 1만큼 더 나가도록 놓는다 — 잘렸다는 것이 보이면서 무엇인지도
     * 읽히는 지점이다.
     */
    const left = -FRAME.width / 2 - size * 0.2;
    this.mesh.position.set((left + box.width / 2) * u, FRAME.height * 0.1 * u, 0);
    this.mesh.rotation.z = (-6.5 * Math.PI) / 180;
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

import { Mesh, PlaneGeometry, ShaderMaterial, Color } from 'three';
import { PALETTE } from '../core/palette.js';

/**
 * 하위 화면으로 들어가면 **더 깊이 잠긴다.**
 *
 * ── 이것이 흰 카드를 대신한다 ───────────────────────────────────────────────
 * 설정·상대·컬렉션·마크는 전부 물 위에 뜬 흰 둥근 카드였다. 카드는 대비 문제를
 * 확실히 풀지만 홈 화면과 다른 언어를 쓴다 — 홈은 물 위에 흰 활자만 있고 판이
 * 하나도 없다. 두 화면을 나란히 놓으면 다른 앱으로 보인다.
 *
 * 그런데 판을 그냥 없애면 글자가 안 읽힌다. 실측으로 프레임을 12 칸으로 나눠
 * 각 칸에서 가장 밝은 물에 대한 흰 글자의 대비를 재면
 *
 *   1.75  1.73  1.19  1.26
 *   2.15  2.19  1.10  1.04
 *   3.25  3.42  3.67  1.79
 *
 * 로, AA 본문 기준 4.5 를 넘는 칸이 하나도 없다. 홈의 내비가 통과한 것은 그것이
 * 물이 가장 깊은 오른쪽 아래에 **짧은 한 줄**로 앉기 때문이지 흰 글자가 이 물
 * 위에서 일반적으로 읽히기 때문이 아니다.
 *
 * 그래서 판 대신 물을 어둡게 한다. 화면에 들어가는 것이 곧 가라앉는 것이고,
 * 가라앉으면 빛이 줄어든다 — 대비 장치가 아니라 그림의 사실로 푸는 쪽이다.
 *
 * ── 왜 단색이 아니라 세로 그라디언트인가 ────────────────────────────────────
 * 균일하게 어둡게 하면 위쪽의 밝은 극까지 눌려서 물이 물처럼 보이지 않는다.
 * 아래로 갈수록 짙어지게 하면 두 가지가 동시에 맞는다: 목록이 앉는 아래쪽이
 * 가장 어둡고, 위쪽에는 빛이 남아 수면이 어디인지 계속 말한다.
 */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3  uDeep;
  uniform float uAmount;
  uniform float uTop;
  uniform float uBottom;
  varying vec2  vUv;

  void main() {
    /**
     * vUv.y 는 아래가 0 이다. 위에서 아래로 짙어지므로 1 - y 로 뒤집는다.
     * smoothstep 의 두 정지점이 "빛이 남는 구간" 과 "다 잠긴 구간" 을 가른다.
     */
    /**
     * 위에서도 0 이 되지 않는다. 0.72 에서 1.0 사이를 오간다.
     *
     * 처음에는 위쪽을 완전히 비워 두었는데, 그러면 목록의 윗줄들이 밝은 물 위에
     * 그대로 남아 안 읽힌다. 필요한 것은 "위쪽에 빛이 조금 더 남는 것" 이지
     * "위쪽은 그대로" 가 아니다.
     */
    float t = mix(0.72, 1.0, smoothstep(uTop, uBottom, 1.0 - vUv.y));
    gl_FragColor = vec4(uDeep, t * uAmount);
  }
`;

/**
 * @param {object} o
 * @param {number} [o.top]     이 높이(0=위)부터 어두워지기 시작한다
 * @param {number} [o.bottom]  이 높이에서 최대 농도에 닿는다
 */
export function createDepth({ top = 0.0, bottom = 0.62 } = {}) {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: {
      uDeep: { value: new Color(PALETTE.water.deep) },
      uAmount: { value: 0 },
      uTop: { value: top },
      uBottom: { value: bottom },
    },
  });

  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  /**
   * 물(-1000)보다 앞, 제목(-500)보다 뒤.
   *
   * 제목이 이 막 **위**에 있어야 한다. 아래에 두면 하위 화면에서 게임 이름이
   * 같이 잠겨 사라지는데, 이름은 어느 화면에서나 같은 밝기로 있어야 한다.
   * 잠기는 것은 물이지 활자가 아니다.
   */
  mesh.renderOrder = -900;
  mesh.frustumCulled = false;

  let target = 0;

  return {
    mesh,
    /** 화면 전체를 덮는다. 프레임 픽셀이 아니라 뷰 크기로 잡는다. */
    layout(width, height) {
      mesh.scale.set(width, height, 1);
      mesh.position.set(0, 0, 0);
    },
    /** @param {number} v 0 이면 맑고 1 이면 가장 깊다 */
    setDepth(v) {
      target = Math.max(0, Math.min(1, v));
    },
    update(dt) {
      // 지수 접근. 화면 전환의 페이드와 같은 속도라야 둘이 한 동작으로 읽힌다.
      const u = material.uniforms.uAmount;
      u.value += (target - u.value) * Math.min(1, dt * 6.5);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

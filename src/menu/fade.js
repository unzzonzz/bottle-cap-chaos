import { Color, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial } from 'three';
import { PALETTE } from '../core/palette.js';

/**
 * 화면 전환. **페이드 하나뿐이다.**
 *
 * ── 여기 있던 것: 병뚜껑이 카메라로 날아와 화면을 덮었다 ────────────────────
 * `core/CapWipe` 가 그것이다. 뚜껑이 병의 주둥이에서 튀어나와 회전하며 커지고,
 * 화면을 가득 덮은 프레임에서 씬을 바꾸고, 카메라를 지나 빠져나갔다. 두 문서를
 * 잇는 장치이기도 했다 — 메뉴에서 덮으면 게임 페이지가 그 뚜껑을 이어받아
 * 날려 보냈다.
 *
 * 병이 화면에서 사라지면서 근거가 없어졌다. 뚜껑이 떠날 병이 없으면 그것은
 * 허공에서 튀어나오는 금속 원반이고, 그건 이 화면의 어느 것과도 닮지 않았다 —
 * 남은 것은 물과 활자뿐이다.
 *
 * ── 왜 페이드인가 ───────────────────────────────────────────────────────────
 * 이 화면들은 이미 "같은 물 속의 다른 자리" 다. 자리를 옮기는 데 필요한 것은
 * 물이 잠깐 짙어졌다 옅어지는 것이지 다른 물건이 지나가는 것이 아니다. 그래서
 * 덮는 색이 검정이 아니라 **가장 깊은 물빛**이다 — 화면이 꺼지는 것이 아니라
 * 더 깊이 내려갔다 올라온다.
 *
 * 자기 씬을 갖는 이유는 `CapWipe` 와 같다: 월드 패스가 다 끝난 뒤 맨 위에
 * 그려져야 하고, 그러려면 블룸 체인 밖의 별도 씬이어야 한다.
 */
const VERT = /* glsl */ `
  void main() {
    gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uCover;
  void main() {
    gl_FragColor = vec4(uColor, uCover);
  }
`;

export function createFade() {
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(PALETTE.water.deep) },
      uCover: { value: 0 },
    },
  });

  const mesh = new Mesh(new PlaneGeometry(1, 1), material);
  mesh.frustumCulled = false;

  const scene = new Scene();
  scene.add(mesh);
  // 정점 셰이더가 클립 좌표를 직접 쓰므로 카메라는 형식이다. 그래도 필요하다 —
  // three 는 카메라 없이 씬을 그리지 않는다.
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    scene,
    /** @param {number} t 0 이면 맑고 1 이면 완전히 덮인다 */
    setCover(t) {
      material.uniforms.uCover.value = Math.max(0, Math.min(1, t));
    },
    get cover() {
      return material.uniforms.uCover.value;
    },
    render(renderer) {
      if (material.uniforms.uCover.value <= 0.001) return;
      renderer.render(scene, camera);
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}

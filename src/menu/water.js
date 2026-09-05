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
   * 커스틱 한 겹. 능선을 세우려고 fbm 을 접는다.
   *
   * abs(a - b) 로 접으면 두 겹이 만나는 자리가 골이 되고, 그것을 뒤집어
   * 거듭제곱하면 가는 능선만 남는다. fbm 을 그냥 밝기로 쓰면 구름이 되지 물이
   * 되지 않는다.
   *
   * (이 주석에 백틱을 쓰지 마라. 템플릿 리터럴 안이라 문자열이 거기서 끊긴다.)
   */
  float wCaustic(vec2 p, float t) {
    float a = wFbm(p + vec2(t * 0.05, t * -0.035));
    float b = wFbm(p * 1.31 + vec2(t * -0.04, t * 0.045) + 31.4);
    float ridge = 1.0 - abs(a - b) * 1.55;
    // smoothstep 이지 pow 가 아니다. 거듭제곱은 가늘고 밝은 실을 만들고,
    // 실측하니 그건 물이 아니라 **번개**로 보였다. 부드러운 띠라야 물이다.
    return smoothstep(0.52, 0.99, clamp(ridge, 0.0, 1.0));
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
    vec2 d = (uv - vec2(0.30, 0.22)) / vec2(0.70, 0.55);
    float r = length(d);

    vec3 base = mix(uCrest, uBody, smoothstep(0.0, 0.42, r));
    base = mix(base, uDeep, smoothstep(0.42, 0.88, r));

    // 굴절 무늬. 화면 좌표를 그대로 쓰되 세로를 눌러 수면처럼 눕힌다.
    float c = wCaustic(vec2(uv.x, uv.y * 0.55) * 3.4, uTime);
    // 밝은 쪽에서 가장 잘 보인다 — 빛이 드는 곳에 굴절이 있다.
    c *= 1.0 - smoothstep(0.25, 0.95, r);
    c *= 0.55 + min(0.75, uStir);

    /**
     * 0.26 이 상한이다. 가산 백색이라 1.0 이면 바탕색이 통째로 날아간다 —
     * 처음에 그렇게 두었더니 파랑은 사라지고 흰 그물만 남았다.
     */
    gl_FragColor = vec4(base + uCaustic * c * 0.26, 1.0);
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

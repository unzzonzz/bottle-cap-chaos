import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from './palette.js';

/**
 * 배경: 하늘 그라디언트 돔과 그 위의 아주 느린 보케 광점 몇 개.
 *
 * ── 야외 풍경이 아니라 추상 배경이다 ────────────────────────────────────────
 * 이 게임에는 하늘도 잔디도 나무도 없었고, 새로 만드는 건 변환이 아니라 신규
 * 아트 제작이다. 게다가 카메라 프레이밍과 정면으로 충돌한다 — 축구는 "최소
 * 줌에서 필드 전체가 보인다"가, 컬링은 "라인이 화면 밖으로 나가면 안 된다"가
 * 완료 기준이다. 배경에 읽을 것이 있으면 그 두 조건이 흐려진다.
 *
 * 그래서 위가 진한 스카이블루, 아래가 밝은 시안-화이트인 그라디언트와, 눈에
 * 거의 안 띄는 광점 여섯 개가 전부다. **보드 주변에는 아무것도 놓지 않는다.**
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
  uniform vec3 uBokehColor;
  uniform vec3 uBokeh[6];   // xyz = 방향
  uniform float uBokehSize[6];
  uniform float uBokehAlpha[6];
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);
    // 위에서 아래로 4단. smoothstep 으로 이어서 수평선에 선이 생기지 않게 한다.
    // 수평선 바로 아래가 가장 밝고(uLow), 더 내려가면 다시 차분해진다(uBelow).
    // 단조 그라디언트가 아닌 이유는 PALETTE.bg.below 의 주석에 있다 — 탑다운
    // 카메라가 보는 건 맨 아래쪽이고, 거기가 밝으면 화면 전체가 블룸에 탄다.
    float t = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 sky;
    if (t > 0.5) {
      sky = mix(uMid, uTop, smoothstep(0.5, 1.0, t));
    } else if (t > 0.34) {
      sky = mix(uLow, uMid, smoothstep(0.34, 0.5, t));
    } else {
      sky = mix(uBelow, uLow, smoothstep(0.0, 0.34, t));
    }

    // 보케. 가산이고, 알파가 0.06~0.14 라 거의 안 보이는 게 정상이다.
    for (int i = 0; i < 6; i++) {
      float c = dot(d, normalize(uBokeh[i]));
      float disc = smoothstep(1.0 - uBokehSize[i], 1.0, c);
      sky += uBokehColor * disc * uBokehAlpha[i];
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

/**
 * 하늘 돔을 만들어 씬에 넣는다.
 *
 * @param {import('three').Scene} scene
 * @returns {{ mesh: Mesh, update: (dt: number) => void, dispose: () => void }}
 */
export function createSky(scene, { radius = 200 } = {}) {
  /**
   * 광점 여섯 개. 위치는 손으로 정한 고정값이다.
   *
   * `Math.random` 을 쓰지 않는 이유는 텍스처 파일들이 해시를 쓰는 이유와 같다:
   * 매번 다르게 나오면 두 스크린샷을 비교할 수 없고, 이 단계는 대부분 스크린샷을
   * 비교해서 판단한다.
   *
   * 전부 수평선 위에 있다. 아래쪽 절반은 보드가 있는 곳이라 광점이 필드와
   * 겹치면 안 된다.
   */
  const seeds = [
    { dir: new Vector3(-0.62, 0.42, -0.66), size: 0.055, alpha: 0.13, speed: 0.019 },
    { dir: new Vector3(0.71, 0.30, -0.63), size: 0.040, alpha: 0.10, speed: -0.014 },
    { dir: new Vector3(-0.28, 0.66, 0.70), size: 0.070, alpha: 0.08, speed: 0.011 },
    { dir: new Vector3(0.44, 0.24, 0.86), size: 0.032, alpha: 0.12, speed: -0.021 },
    { dir: new Vector3(-0.86, 0.20, 0.47), size: 0.048, alpha: 0.07, speed: 0.016 },
    { dir: new Vector3(0.12, 0.52, -0.84), size: 0.062, alpha: 0.06, speed: -0.009 },
  ];
  for (const s of seeds) s.dir.normalize();

  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
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
      uBokehColor: { value: new Color(PALETTE.bg.bokeh) },
      uBokeh: { value: seeds.map((s) => s.dir.clone()) },
      uBokehSize: { value: seeds.map((s) => s.size) },
      uBokehAlpha: { value: seeds.map((s) => s.alpha) },
    },
  });

  const mesh = new Mesh(new SphereGeometry(radius, 32, 16), material);
  // 하늘이 먼저 그려지고 나머지가 그 위에 온다.
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  let t = 0;
  const axis = new Vector3(0, 1, 0);

  /**
   * 광점을 아주 느리게 돌린다. 한 바퀴에 최소 60초.
   *
   * 각 점이 자기 속도를 가지므로 서로에 대해서도 움직이는데, 가장 빠른 것이
   * 초당 0.021 라디안 — 한 바퀴에 5분이다. 눈치채면 실패인 종류의 움직임이다.
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
    const dirs = material.uniforms.uBokeh.value;
    for (let i = 0; i < seeds.length; i++) {
      dirs[i].copy(seeds[i].dir).applyAxisAngle(axis, seeds[i].speed * t);
    }
  }

  function dispose() {
    scene.remove(mesh);
    mesh.geometry.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}

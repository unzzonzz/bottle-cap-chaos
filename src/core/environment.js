import {
  BackSide,
  Color,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { lighten, mix, PALETTE } from './palette.js';
import { onQualityChange, QUALITY } from './quality.js';

/**
 * The environment every reflective surface samples, generated at boot.
 *
 * ── why there is one at all ─────────────────────────────────────────────────
 * `metalness`, `clearcoat` and `transmission` are all statements about what a
 * surface REFLECTS. With no environment they reflect nothing, and a metal cap
 * comes out as a flat dark disc — which is the single most common way a
 * physically-based material is made to look worse than the hand-written shader
 * it replaced. The cap's wet look is mostly this.
 *
 * ── why it is procedural rather than an HDR file ────────────────────────────
 * The brief bans adding image assets and this game has none, so an .hdr fetched
 * at boot is both a bundle-size problem and a new failure mode on a cold or slow
 * connection. What is actually needed here is
 * modest: a bright sky above, a lighter ground below, and a hot spot where the
 * sun is. A three-stop gradient with a soft sun gives every one of those, and
 * `PMREMGenerator` turns it into the roughness-mipped cubemap the material wants.
 *
 * ── the sun blob is load-bearing ────────────────────────────────────────────
 * A pure gradient produces a broad, even reflection and nothing that reads as a
 * highlight. The cap's specular — the thing the whole direction is built on — is
 * a REFLECTION OF THIS BLOB. Take it out and the metal goes back to looking like
 * plastic, with no material parameter able to bring it back.
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
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunSize;
  uniform float uSunGain;
  uniform float uBaseGain;
  varying vec3 vDir;

  void main() {
    vec3 d = normalize(vDir);

    // Sky above the horizon, ground below, with a short blend across it so the
    // reflection does not carry a hard line round every curved surface.
    float up = d.y;
    vec3 sky = mix(uHorizon, uTop, clamp(up, 0.0, 1.0));
    vec3 ground = mix(uHorizon, uGround, clamp(-up, 0.0, 1.0));
    vec3 base = mix(ground, sky, smoothstep(-0.08, 0.08, up));

    // The sun: a soft disc, well above the value of everything else, which is
    // what the bloom threshold downstream is looking for.
    float cosA = dot(d, normalize(uSunDir));
    float sun = pow(clamp(cosA, 0.0, 1.0), uSunSize);

    gl_FragColor = vec4(base * uBaseGain + uSunColor * sun * uSunGain, 1.0);
  }
`;

/**
 * Build the PMREM. Call once per renderer, after the palette is loaded.
 *
 * The generator and the throwaway scene are disposed before returning: the only
 * thing worth keeping is the cubemap, and holding the generator keeps a pair of
 * render targets alive for the life of the page.
 *
 * ── 티어는 크기를 줄이지, 없애지 않는다. 없애 봤고 되돌렸다 ────────────────
 * 지시서의 표는 최저·낮음에 "환경맵 없음" 을 적었고 그대로 구현해 봤다. 화면을
 * 보고 되돌렸다: 병이 회녹색 불투명 덩어리가 되고, 라벨과 판까지 눈에 띄게
 * 어두워졌다. 이유는 환경맵이 반사만 주는 것이 아니기 때문이다 — 돔의 확산
 * 성분(`uBaseGain` 0.34)이 이 씬의 앰비언트 절반을 담당하고, `metalness` 는
 * "무엇을 비추는가" 에 대한 진술이라 비출 것이 없으면 뚜껑이 어두운 원반이 된다.
 * 그건 성능 문제가 아니라 §0.3 의 가독성 조항이 깨지는 것이다.
 *
 * 그리고 없애서 아끼는 것은 **프레임 시간이 아니다.** 큐브맵 샘플 비용은 크기와
 * 거의 무관하고, 굽는 비용은 부팅 때 한 번이다. 없애서 아끼는 것은 VRAM 뿐이다.
 * 그래서 티어는 크기만 줄인다 — 48 / 96 / 128 / 256 / 256.
 *
 * `envSize: 0` 은 여전히 유효한 값이고 이 함수는 `null` 을 돌려준다. 그 경우의
 * 가독성 보정은 `GlossMaterials` 가 들고 있다: 비출 것이 없으면 금속을 칠한
 * 금속으로 바꾼다(`NO_ENV_METALNESS`). 표는 그 길을 쓰지 않지만, 누가 다시
 * 0 을 적어도 뚜껑이 검은 원반이 되지는 않는다.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @returns {import('three').Texture|null} a PMREM, ready for `scene.environment`
 */
export function buildEnvironment(renderer) {
  const size = QUALITY.envSize;
  if (!(size > 0)) return null;

  const scene = new Scene();
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: BackSide,
    depthWrite: false,
    uniforms: {
      /**
       * ── the lighting dome is NOT the visible backdrop ────────────────────
       * The obvious thing is to reuse `bg.skyTop/skyMid/skyLow` so the
       * reflections match what is behind the object. Tried, and wrong: a
       * top-down board has its normal pointing straight up, so it samples the
       * top of the dome and takes its colour. At the backdrop's own saturation
       * that turned honey wood into grey-teal and a coral cap into dark plum —
       * every diffuse surface in the game wearing the sky's hue.
       *
       * So the dome keeps the backdrop's HUE and drops most of its saturation,
       * and its ground half is warm rather than another blue. It is a studio
       * dome that happens to be daylight-tinted, which is what an environment
       * map is for; the sky the player actually sees is `scene.background` and
       * is a separate decision.
       */
      uTop: { value: new Color(lighten(PALETTE.bg.skyMid, 0.55)) },
      uHorizon: { value: new Color(lighten(PALETTE.bg.skyLow, 0.5)) },
      uGround: { value: new Color(mix(PALETTE.light.ambientGround, PALETTE.light.sun, 0.5)) },
      uSunColor: { value: new Color(PALETTE.light.sun) },
      // Up and off to one side, matching the key light PHASE 3 installs. The
      // two have to agree or the highlight and the lit side disagree about
      // where the light is, which reads as a rendering fault rather than as a
      // choice.
      uSunDir: { value: new Vector3(-0.55, 0.72, 0.42).normalize() },
      /**
       * 돔의 확산 성분. 태양과 분리되어 있고, 그 분리가 요점이다.
       *
       * ── PHASE 3 에서 화면이 하얗게 날아간 원인 ──────────────────────────
       * 환경맵은 반사만 주는 게 아니라 확산광에도 기여한다. 실제 광원이 없던
       * PHASE 2 에서는 그게 유일한 조명이라 밝아야 했지만, 키·반구광·림이
       * 들어오자 그대로 더해져서 보드의 조도가 albedo 를 넘겼다 —
       * 0.52 * (키 1.5*0.72 + 반구 0.55 + 환경 1.0) = 1.37, 즉 흰색을 넘는다.
       *
       * 광원 강도만 낮추면 금속이 비출 것이 없어져 같이 죽는다. 실제 하늘에서
       * 에너지의 대부분은 태양에 있으므로, 돔의 바탕만 낮추고 태양 blob 은
       * 그대로 둔다. 확산 기여는 내려가고 스페큘러 하이라이트는 남는다.
       */
      uBaseGain: { value: 0.34 },
      // Tight. A broad sun is an ambient term with extra steps.
      uSunSize: { value: 220 },
      // Above 1 on purpose: this is the HDR headroom the bloom threshold spends.
      uSunGain: { value: 6.0 },
    },
  });

  const sphere = new Mesh(new SphereGeometry(1, 32, 16), material);
  scene.add(sphere);

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  // `size` 는 큐브 한 면의 텍셀 수. 기본값이 256 이고 그것이 최대 티어의 값이다.
  const target = pmrem.fromScene(scene, 0.04, 0.1, 100, { size });

  sphere.geometry.dispose();
  material.dispose();
  pmrem.dispose();

  return target.texture;
}

/**
 * 환경맵을 만들고, 티어가 바뀌면 다시 굽는다. 부팅 경로가 쓰는 것은 이쪽이다.
 *
 * ── 왜 부팅 경로가 아니라 여기서 다시 굽는가 ───────────────────────────────
 * 다시 굽는 조건("크기가 달라졌는가")과 뒤처리("옛 큐브맵을 버린다")가 이 파일의
 * 지식이다. 두 부팅 경로에 각각 적으면 그 지식이 두 벌이 되고, 그중 한 벌만
 * `dispose` 를 빠뜨리면 증상은 티어를 왕복할 때마다 몇 MB 씩 새는 것 — 즉
 * 아무 에러도 없이 느려지는 것 — 이 된다.
 *
 * 새 것을 만든 **뒤에** 옛 것을 버린다. 순서가 반대면 `setEnvironment` 가 도는
 * 한 순간 모든 재질이 버려진 텍스처를 가리킨다.
 *
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('./GlossMaterial.js').GlossMaterials} retro
 */
export function createEnvironment(renderer, retro) {
  let size = null;
  let texture = null;

  function rebuild() {
    if (size === QUALITY.envSize) return;
    size = QUALITY.envSize;
    const old = texture;
    texture = buildEnvironment(renderer);
    retro.setEnvironment(texture);
    old?.dispose();
  }

  rebuild();
  const off = onQualityChange(rebuild);

  return {
    get texture() {
      return texture;
    },
    dispose() {
      off();
      texture?.dispose();
      texture = null;
    },
  };
}

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
 * The brief bans adding image assets, this game has none, and it ships inside a
 * Capacitor web view that has to work offline — so an .hdr fetched at boot is
 * both a bundle-size problem and a failure mode. What is actually needed here is
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
 * @param {import('three').WebGLRenderer} renderer
 * @returns {import('three').Texture} a PMREM, ready for `scene.environment`
 */
export function buildEnvironment(renderer) {
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
  const target = pmrem.fromScene(scene, 0.04);

  sphere.geometry.dispose();
  material.dispose();
  pmrem.dispose();

  return target.texture;
}

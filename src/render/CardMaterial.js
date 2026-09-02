import { ShaderMaterial, Vector2, Vector3 } from 'three';
import { PALETTE, toRgb } from '../core/palette.js';

/**
 * 카드 재질: 조명 없이 텍스처를 그대로 내보내고, 테두리에만 빛을 얹는다.
 *
 * ── `RetroMaterial` 이 아니다 ───────────────────────────────────────────────
 * 저쪽은 키·필·앰비언트로 정점 Gouraud 를 한다. 판 위에 놓인 물건에는 맞고 카드에는
 * 틀리다 — 카드는 인쇄된 물건이고, 거기에 조명을 걸면 부채꼴이 돌 때마다 그림의
 * 색이 변한다. 그래서 조명을 뺀 정점 단계와 통과된 텍스처다.
 *
 * 어파인 UV 기계도 없고 그건 누락이 아니다. 카드 씬은 **직교 카메라**로 그려서 삼각형
 * 안에서 w 가 상수다 — 어파인 보간과 원근 보정 보간이 같은 산술이 된다.
 *
 * ── 정점 스냅은 사라졌다 ────────────────────────────────────────────────────
 * `uSnapAmount` 와 `uTargetRes` 가 여기 있었고, 헤더는 "카드는 떤다. 그것이 그 룩이다"
 * 라고 적혀 있었다. 저해상도 타겟도, nearest 확대도, 5비트 양자화도 남아 있지 않으므로
 * 카드만 격자에 물릴 이유가 없다. 마지막에는 호출부가 세기를 0 으로 써서 코드가
 * 돌기는 하되 아무 일도 하지 않고 있었다 — 스냅이 없다는 사실을 유니폼 하나로
 * 숨겨 놓은 상태였다. 정점 단계는 이제 투영 하나다.
 *
 * ── 회색화는 **여기서** 일어난다 ────────────────────────────────────────────
 * 못 쓰는 손패의 색을 빼는 일은 이 프래그먼트 셰이더가 한다. 예전 근거는 "디더와
 * 양자화의 상류"였고 그 둘은 없다. 남은 근거는 더 단순하다: 회색화는 카드 **한 장의**
 * 상태고 텍스처는 여섯 장이 공유하는 캐시 항목이라, 텍스처를 다시 굽는 대신 유니폼
 * 하나로 말해야 캐시가 상태 수만큼 갈라지지 않는다.
 *
 * ── 홀로그램은 시야각으로 만들 수 없다 ──────────────────────────────────────
 * 직교 카메라에서는 시선 벡터가 상수고 카드는 노멀이 일정한 평면 쿼드다. `dot(N, V)`
 * 로 만든 이리데선스는 모든 카드가 한 가지 단색으로 나온다 — 포일이 아니라 색종이다.
 *
 * 실제 포일이 어른거리는 이유는 하이라이트가 **광원 공간에 고정**되어 있고 카드가 그
 * 안을 지나가기 때문이다. 그래서 무지개의 위상을 카드의 화면 위치와 각도에서 만든다:
 * 부채꼴에서는 카드마다 각도가 달라 띠가 다른 자리에 뜨고, 끌면 띠가 쓸려 지나가고,
 * 스프링이 정착하는 동안 어른거린다. `uHoloTime` 이 아주 느린 드리프트를 얹어, 아무도
 * 손대지 않는 손패도 죽은 그림이 되지 않게 한다.
 *
 * 더하지, 섞지 않는다 — 표면 **위의 빛**이지 표면의 색이 아니다. 그리고 `uDrain` 과
 * `uFade` 를 함께 곱한다: 낼 수 없어 회색으로 빠진 카드의 테두리만 무지개면 "쓸 수
 * 있어 보이는" 오독이 생기고, 조준 중 물러나는 손패에 빛만 남으면 판 위에 이유 없는
 * 광택이 뜬다.
 */

const VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * 라운드 사각형까지의 부호 있는 거리. 안이 음수다.
 *
 * 카드 면과 그림자가 같은 함수를 쓴다. 둘은 같은 모양의 서로 다른 쓰임 — 하나는 그
 * 경계에 빛을 얹고 하나는 그 경계에서 어둠을 흘린다 — 이라 두 벌이 있으면 언젠가
 * 한쪽의 반지름만 고쳐진다.
 */
const SDF = /* glsl */ `
  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uDrain;      // 0 = full colour, 1 = fully grey
  uniform vec3  uTint;       // multiplied in; carries both dimming and the armed cool
  uniform float uOpacity;
  uniform float uFade;       // the whole hand at once; see the note on shared

  // ── 테두리 홀로그램 ──────────────────────────────────────────────────────
  uniform vec2  uCardSize;   // 그려지는 크기. 손 로컬 단위 (부채꼴 배율 이전)
  uniform float uCardRadius; // 같은 단위의 모서리 반지름
  uniform vec2  uCardPos;    // 손 로컬 좌표의 카드 중심. 광원 공간의 위상을 만든다
  uniform float uCardAngle;  // z 회전. 같은 곳에서 온다
  uniform float uHolo;       // 0..1 세기. 뒷면은 거의 0, 무장하면 올라간다
  uniform float uHoloScale;  // 단위 길이당 위상
  uniform float uHoloSat;    // 0 = 흰빛, 1 = 완전 포화. 파스텔은 중간이다
  uniform float uHoloRim;    // 짧은 변에 대한 테두리 폭의 비율
  uniform float uHoloTime;   // 아주 느린 드리프트

  varying vec2 vUv;

  ${SDF}

  void main() {
    vec4 tex = texture2D(uMap, vUv);

    // Rec. 601 luma, which is the weighting the era's own converters used.
    float grey = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    float drain = clamp(uDrain, 0.0, 1.0);
    vec3 c = mix(tex.rgb, vec3(grey), drain) * uTint;

    float holo = uHolo * (1.0 - drain) * uFade;
    if (holo > 0.001) {
      vec2 local = (vUv - 0.5) * uCardSize;
      // 반지름은 짧은 변의 절반을 넘을 수 없다. 카드는 뒤집히는 여덟 프레임 동안
      // 가로로만 눌리고 (flipWidth), 그 사이에 반지름만 원래 크기로 남으면 SDF 가
      // 상자가 아닌 것을 재기 시작한다. 캔버스의 roundRectPath 가 같은 자리에서
      // 같은 죔쇠를 갖고 있다.
      float r = min(uCardRadius, min(uCardSize.x, uCardSize.y) * 0.5);
      float d = sdRoundBox(local, uCardSize * 0.5, r);
      // 경계 안쪽에서 피크. 바깥은 텍스처의 알파가 이미 0 이라 잘려 있지만,
      // 모서리의 반투명 픽셀에 띠가 걸치면 윤곽이 두꺼워 보이므로 여기서도 닫는다.
      float rim = max(1.5, min(uCardSize.x, uCardSize.y) * uHoloRim);
      float band = smoothstep(-rim, -rim * 0.35, d) * (1.0 - smoothstep(-rim * 0.12, 0.0, d));

      // 광원 공간: 카드를 그 각도로 돌려 화면 위 자리에 놓고, 고정된 방향으로 투영한다.
      float ca = cos(uCardAngle);
      float sa = sin(uCardAngle);
      vec2 p = vec2(local.x * ca - local.y * sa, local.x * sa + local.y * ca) + uCardPos;
      float phase = dot(p, normalize(vec2(0.6, 1.0))) * uHoloScale + uHoloTime;

      vec3 rainbow = cos(phase + vec3(0.0, 2.094, 4.189)) * 0.5 + 0.5;
      // 파스텔. 완전 포화 무지개는 네온이고, 이 화면에 네온은 없다.
      c += mix(vec3(1.0), rainbow, clamp(uHoloSat, 0.0, 1.0)) * band * holo;
    }

    gl_FragColor = vec4(c, tex.a * uOpacity * uFade);
    if (gl_FragColor.a < 0.01) discard;
  }
`;

/**
 * 그림자. 카드 뒤에 떨어지는 **부드러운** 얼룩이다.
 *
 * ── 각진 검은 쿼드였다 ──────────────────────────────────────────────────────
 * 알파 0.55 의 순검정 사각형을 몇 픽셀 밀어 놓았고, 주석은 진짜 그림자를 계산하면
 * "몇 픽셀 아래 오른쪽의 각진 어두운 사각형"이 나오므로 "그것이 바로 그 사각형이다"
 * 라고 적어 두었다. 그 문장이 사실인 것은 하드 섀도우일 때뿐이다. 이 화면의 모든
 * 판은 `ELEVATION` 을 통해 흐린 그림자를 갖고 있고, 그 사이에서 각진 검은 사각형
 * 하나는 카드가 떠 있는 것이 아니라 카드 뒤에 검은 카드가 한 장 더 있는 것으로 보인다.
 *
 * ── 캔버스 텍스처가 아니라 SDF 다 ───────────────────────────────────────────
 * 흐린 그림자를 텍스처로 구우면 카드 크기마다 한 장씩 필요하고, 카드는 호버에서
 * 확대되므로 크기가 연속이다. 거리로 감쇠시키면 유니폼 둘이면 되고 어떤 크기에서도
 * 같은 흐림을 준다.
 *
 * 쿼드는 카드보다 `uBlur` 만큼 사방으로 크다 — `CardHand._place` 가 그렇게 키운다.
 * 흐림이 퍼질 자리가 쿼드 안에 있어야 하고, 없으면 그림자가 카드 경계에서 잘린다.
 *
 * 색은 검정이 아니라 팔레트의 네이비다. 밝은 하늘과 나무판 위에서 순검정 얼룩은
 * 그림자가 아니라 구멍으로 보인다.
 */
const SHADOW_FRAG = /* glsl */ `
  uniform float uOpacity;
  uniform float uFade;
  uniform vec2  uSize;   // 카드 자체의 크기
  uniform float uRadius;
  uniform float uBlur;   // 사방으로 새어 나가는 거리. 쿼드는 이만큼 크다
  uniform vec3  uColor;

  varying vec2 vUv;

  ${SDF}

  void main() {
    vec2 local = (vUv - 0.5) * (uSize + uBlur * 2.0);
    // 카드 면과 같은 죔쇠, 같은 이유다. 뒤집히는 카드의 그림자도 같이 눌린다.
    float d = sdRoundBox(local, uSize * 0.5, min(uRadius, min(uSize.x, uSize.y) * 0.5));
    // 안쪽은 꽉 차고 바깥으로 나가며 사라진다. 제곱을 한 번 더 먹여 가장자리가
    // 길게 끌리도록 — 선형 감쇠는 흐림이 아니라 그라디언트 테두리로 보인다.
    float a = 1.0 - smoothstep(0.0, max(0.001, uBlur), d);
    a *= a;
    gl_FragColor = vec4(uColor, a * uOpacity * uFade);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

/** `#rrggbb` -> 0..1 셋. 팔레트는 16진 문자열이고 셰이더는 그렇지 않다. */
function shaderColor(hex) {
  const [r, g, b] = toRgb(hex);
  return new Vector3(r / 255, g / 255, b / 255);
}

export class CardMaterials {
  constructor() {
    /**
     * Shared by every card material, so one slider moves the whole hand.
     *
     * `uFade` takes the hand off screen as a whole, and it is separate from the
     * per-card `uOpacity` on purpose: that one is the hand's own business — how
     * far out of the edge it is, whether it is the live one — and something
     * outside the card system has to be able to hide all of it without
     * arguing with any of that. It is written once a frame, after the hand has
     * finished placing itself, and multiplied in last.
     *
     * What uses it: drawing a shot. Everything that is not the board gets out of
     * the way while the bow is drawn.
     *
     * 홀로그램의 셋도 여기 있다. 카드마다 다른 것은 **위상**이지 무늬의 성질이
     * 아니므로, 폭·채도·드리프트는 손패 전체가 한 값을 봐야 한다. `uHoloTime` 은
     * `CardLayer` 가 프레임마다 한 번 쓴다.
     *
     * ── 해상도를 더 받지 않는다 ─────────────────────────────────────────────
     * 생성자가 `{ resolution }` 을 받았고 `setResolution` 이 그것을 `uTargetRes` 에
     * 써 넣었다. 그 유니폼은 정점 스냅의 격자였고 스냅과 함께 사라졌다 — 카드는
     * 고정된 프레임 상자 안에 직교로 놓이므로 렌더 타겟이 몇 픽셀이든 레이아웃이
     * 같다. 아무도 읽지 않는 값을 받아 두면 다음 사람이 그것을 근거로 무언가를
     * 계산한다.
     */
    this.shared = {
      uFade: { value: 1 },
      // 넷 다 `CardLayer.update` 가 `config.cardFx` 에서 프레임마다 덮어쓴다.
      // 여기 값은 첫 프레임이 그려지기 전의 자리지킴이지 설정이 아니다 — 튜닝은
      // config 한 곳에서만 한다.
      uHoloScale: { value: 0 },
      uHoloSat: { value: 0 },
      uHoloRim: { value: 0.05 },
      uHoloTime: { value: 0 },
    };
    this._materials = new Set();
  }

  /** @param {import('three').Texture} map */
  create(map) {
    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      // The card scene is drawn after the game's depth is cleared and contains
      // nothing but cards, so paint order is the whole of the sorting. Doing it
      // by `renderOrder` rather than by depth means the fan's overlap is stated
      // once, in the layout, instead of being a consequence of z positions that
      // also have to avoid fighting.
      depthTest: false,
      depthWrite: false,
      uniforms: {
        ...this.shared,
        uMap: { value: map },
        uDrain: { value: 0 },
        uTint: { value: new Vector3(1, 1, 1) },
        uOpacity: { value: 1 },
        // 카드가 아닌 쿼드 — 드롭 가이드, 거절 사유판, 자물쇠 — 도 이 재질을 쓴다.
        // 세기가 0 이면 위의 분기가 통째로 건너뛰어지므로, 그 셋은 아무 값도 쓰지
        // 않고 홀로그램을 갖지 않는다.
        uHolo: { value: 0 },
        uCardSize: { value: new Vector2(1, 1) },
        uCardRadius: { value: 0 },
        uCardPos: { value: new Vector2(0, 0) },
        uCardAngle: { value: 0 },
      },
    });
    return this._track(material);
  }

  /** The soft drop shadow. Its quad is grown by `uBlur` on every side. */
  createShadow() {
    return this._track(
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: SHADOW_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          ...this.shared,
          uOpacity: { value: 0.3 },
          uSize: { value: new Vector2(1, 1) },
          uRadius: { value: 0 },
          uBlur: { value: 1 },
          uColor: { value: shaderColor(PALETTE.ui.shadow) },
        },
      }),
    );
  }

  _track(material) {
    this._materials.add(material);
    const dispose = material.dispose.bind(material);
    material.dispose = () => {
      this._materials.delete(material);
      dispose();
    };
    return material;
  }

  dispose() {
    for (const m of this._materials) m.dispose();
    this._materials.clear();
  }
}

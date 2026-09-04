import { DoubleSide, Group, Mesh, Plane, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { buildCapGeometry, CAP_DEFAULTS, MM } from '../cap/capGeometry.js';
import { buildBottleProfile } from './bottleProfile.js';
import {
  buildFoamGeometry,
  buildGlassGeometry,
  buildLabelGeometry,
  buildLiquidGeometry,
} from './bottleGeometry.js';
import { Fizz, FIZZ_COUNT, G_WORLD } from './Fizz.js';
import { applyGlassQuality, createGlassMaterial, createSpriteMaterial } from './menuMaterials.js';
import {
  burstSheet,
  capLogoTexture,
  foamTexture,
  glassHighlightTexture,
  labelTexture,
  shadowTexture,
} from './menuTextures.js';
import { PALETTE } from '../core/palette.js';
import { onQualityChange, QUALITY } from '../core/quality.js';

/**
 * The bottle on the menu: five meshes, a fixed lean, and two ways of moving.
 *
 * ── the draw order is the design ────────────────────────────────────────────
 * Alpha blending has no depth sorting of its own, so this has to be arranged
 * rather than left to happen. Two mechanisms do it, and it is worth being exact
 * about which does what:
 *
 * three draws EVERY opaque object before ANY transparent one — `renderOrder`
 * only sorts within one of those passes, never across them. So:
 *
 *   opaque pass       foam, label and cap. All write depth.
 *   transparent pass  glass BACK (0), drink (1), fizz (2), glass FRONT (3).
 *
 * and the depth buffer the opaque pass left behind does the rest:
 *
 *   · the near wall is rejected everywhere the LABEL is in front of it, which
 *     is the whole reason the label can be red. A label with the bottle wall
 *     blended over it comes out brown, and that is the classic tell that
 *     someone drew the glass as one double-sided pass.
 *   · the head of foam is opaque, so both walls are rejected behind it — a head
 *     you can see through is not a head.
 *
 * 음료가 불투명 패스에 있었다. 콜라이던 시절의 배치이고, 그때는 깊이를 찍어
 * 뒷벽을 지우는 것이 맞았다. 맑은 음료는 뒤가 비쳐야 하므로 이제 투명 패스에서
 * **뒷벽 다음**에 그려지고, 깊이를 쓰지 않는다.
 *
 * No glass pass writes depth, and neither does the drink, so they compose
 * rather than fighting.
 *
 * ── two glass draws, not one ────────────────────────────────────────────────
 * A single double-sided pass composites the far wall over the near one wherever
 * the index buffer reaches it first, which on a lathe walked bottom-to-top is
 * most of the object. Back faces, contents, front faces — in that order, every
 * frame, with no sorting to do — is the cheap, era-appropriate fix.
 *
 * ── it FLOATS, and that changed three things at once ────────────────────────
 * §6.2 of the direction takes the floor away: the bottle hangs in space, tilted
 * well off vertical, drifting. So —
 *
 *   the POSE   `leanZ` went 19 -> 62. At 19 a bottle reads as standing at a
 *              jaunty angle whatever is or is not under it, because that is the
 *              angle a bottle stands at.
 *   the FLOOR  `floorY` is `shadowDrop` and the contact shadow is a soft shape
 *              far below that never touches. There is nothing to make contact
 *              with.
 *   the SHAKE  gone. It rattled along `_localUp` — the bottle's own axis, so
 *              the lean stayed constant and it read as someone working the
 *              pressure up. There is no hand in this picture, and a floating
 *              object that rattles reads as a physics glitch.
 *
 * ── it still does not spin, and now it turns ────────────────────────────────
 * Those are different things. A hero object rotating on a turntable is the
 * default thing to build and it is explicitly not what this is. What it does
 * instead is DRIFT: a few degrees on two axes at two long periods, so the pose
 * never repeats and the label never leaves the front.
 *
 * The drift earns its place rather than decorating: the drink's surface is
 * solved level in the WORLD, so a bottle that never moves shows a surface whose
 * horizontality is invisible. Turn it slowly and the surface visibly stays put.
 *
 * ── the pointer ─────────────────────────────────────────────────────────────
 * §6.3 asks for a glass object that reacts to being approached — parallax, the
 * highlight moving, a small physically plausible rotation, the carbonation
 * changing, secondary motion on the cap. `_lookAt` is that, as one critically
 * damped spring per axis with the cap's own spring running a beat behind. The
 * inertia is the point: `hover = scale up` is the preset the direction bans.
 */

/**
 * The meniscus, as a fragment effect.
 *
 * ── it used to be two vertex colours, and it cannot be any more ────────────
 * `buildLiquidGeometry` had a triangle fan across the fill line whose rim
 * carried `SURFACE_RIM`. The fan is gone — the surface is a clip plane now —
 * so there are no vertices at the surface to colour. This does the same job
 * from the other end: every fragment of the drink knows how far it is from the
 * plane that cut it, so the ones just under it can be brightened.
 *
 * ── it is a GAIN, not a colour, and that is deliberate ────────────────────
 * `PALETTE.liquid` states the rule: the bright ring is a multiple of the
 * drink's own colour, never a second colour, so that recolouring the drink
 * brings the ring with it and the two cannot drift apart. The old pair kept it
 * by construction — 1.18/0.9 is a ratio of about 1.30 — and multiplying here
 * keeps exactly that ratio without naming a colour.
 *
 * Over 1 on purpose. The render target is half-float and the bloom picks up
 * what goes past white, and the line where a drink meets its glass is the one
 * place on this bottle where that is physically what happens.
 *
 * ── why this is better than the vertices were ─────────────────────────────
 * The band is measured in world units from the actual cutting plane, so it is
 * the same width at every angle, it is smooth per pixel rather than per column,
 * and it lands exactly where the drink ends however the plane is tilted. The
 * vertex version could only ever be as smooth as `columns` and drew the ring on
 * the polygon the ring was made of.
 *
 * `vClipPosition` and `clippingPlanes` are three's own — declared by
 * `<clipping_planes_pars_fragment>` whenever a material has a clip plane, in
 * VIEW space, which is metric, so `uMeniscusWidth` is in world units. The guard
 * matters: with no plane those names do not exist and the shader will not link.
 */
const MENISCUS_PARS = /* glsl */ `
  uniform float uMeniscusGain;
  uniform float uMeniscusWidth;
`;
const MENISCUS_MAIN = /* glsl */ `
  #if NUM_CLIPPING_PLANES > 0
  {
    vec4 mPlane = clippingPlanes[0];
    // three keeps the fragment where dot(vClipPosition, n) <= w, so this is the
    // depth BELOW the surface: zero at the cut, growing down into the drink.
    float below = mPlane.w - dot(vClipPosition, mPlane.xyz);
    float m = 1.0 - smoothstep(0.0, uMeniscusWidth, below);
    gl_FragColor.rgb *= 1.0 + uMeniscusGain * m;
  }
  #endif
`;

/** Bottle-cap red, the same one the viewer starts its picker at. */
/**
 * The brand cap. See `PALETTE.menu.capBrand` for why this one value matters more
 * than most: `main.js` paints the whole screen with it during the handover.
 */
const CAP_COLOR = PALETTE.menu.capBrand;
const LINER_COLOR = PALETTE.metal.liner;

/**
 * How far the cap hops off the mouth, in mm up the bottle's own axis.
 *
 * 34 is about a sixth of the bottle's height, which is far enough that the gap
 * between the cap and the lip is unmistakable at the size the bottle is drawn
 * and short enough that the cap is still over the neck when the bars take it.
 * Any further and it reads as being thrown rather than as being popped.
 */
const POP_RISE = 34;
/** Turns about the cap's own normal over the hop. Under one: a nudge, not a spin. */
const POP_TURNS = 0.35;

export class Bottle {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {object} tuning  the live `MENU_CONFIG.bottle` block
   */
  constructor({ retro, tuning }) {
    this.retro = retro;
    this.tuning = tuning;
    this.params = {};

    /**
     * 액면. **정점이 아니라 평면이다.** 재질보다 먼저 만들어야 한다 —
     * `liquidMaterial` 이 생성 시점에 이것을 참조한다.
     */
    this._surfacePlane = new Plane(new Vector3(0, 1, 0), 0);

    /** Moved by the float and the pointer's pull. Never rotated — see `lean`. */
    this.root = new Group();
    /** Carries the lean, and nothing else ever writes to it. */
    this.lean = new Group();
    this.root.add(this.lean);

    this.highlightMap = glassHighlightTexture();
    this.labelMap = labelTexture();
    this.capTopMap = capLogoTexture();
    this.shadowMap = shadowTexture();
    this.burstMap = burstSheet();
    this.foamMap = foamTexture();

    this.glassBackMaterial = createGlassMaterial(retro, { map: this.highlightMap, face: 'back' });
    this.glassFrontMaterial = createGlassMaterial(retro, { map: this.highlightMap, face: 'front' });
    /**
     * 유리 안에 담긴 음료. **투명하다.**
     *
     * `vertexColors` 가 액면 링을 보이게 하는 장치다 — `buildLiquidGeometry` 의
     * 주석 참조. `envIntensity` 가 1.0 인 것은 "스스로 빛나지 않게" 하려고 재서
     * 넣은 값이다: 액체는 유리 안쪽에 있어서 바깥 표면만큼 빛을 받을 수 없는데,
     * 환경맵이 사실상 노출 다이얼이므로 그대로 두면 병 전체가 한 덩어리로
     * 발광한다.
     *
     * ── 불투명이었고, 그건 콜라의 유산이다 ──────────────────────────────────
     * 예전 주석이 근거를 적어 두었다: "갈색 유리 너머로 보이는 액체에 정반사를
     * 얹으면 고체로 보인다." 갈색 유리도 콜라도 없어졌다. 맑은 탄산은 뒤가
     * 비치고, 안 비치면 그건 음료가 아니라 색칠한 속이다.
     *
     * 알파 블렌딩이지 `transmission` 이 아니다. three 의 투과는 전용 렌더 타겟을
     * 샘플링하는데 그 타겟에는 **투과 물체가 빠져 있다** — 유리가 이미 투과이므로,
     * 액체까지 투과로 만들면 둘이 서로를 보지 못한 채 각자 배경만 굴절시킨다.
     * 한 겹의 틴트를 겹쳐 쌓는 것이 이 구성에서 실제로 맞는 그림이고, 값도 싸다.
     */
    this.liquidMaterial = retro.create({
      color: PALETTE.liquid.core,
      gloss: 0.5,
      clearcoat: 0.15,
      /**
       * 유리보다 진하되 뒤가 비칠 만큼. 실측으로 고른 값이다.
       *
       * 0.55 로 시작했고 메뉴에서 병이 **비어 보였다** — 채운 곳과 빈 목의
       * 픽셀 차이가 파랑 채널 17단계뿐이었다. 병이 하늘을 등지고 있고 유리가
       * 이미 투과라, 얇은 틴트 한 겹은 유리 한 겹과 구별되지 않는다.
       *
       * 0.4 아래는 액체가 아니라 유리가 한 겹 더 있는 것으로 보이고, 0.8 위는
       * 다시 색칠한 속이 된다. 0.68 에서 물이 있다는 것이 읽히고 뒤도 비친다.
       */
      opacity: 0.68,
      envIntensity: 1.0,
      vertexColors: true,
    });
    /**
     * 깊이를 쓰지 않는다. 이것이 없으면 액체가 자기 뒤의 유리를 지운다.
     *
     * `GlossMaterials.create` 에 이 스위치가 없는 것은 지금까지 필요한 곳이
     * 없었기 때문이다 — 이 파일의 유리 두 장은 자기 재질을 직접 만든다.
     */
    this.liquidMaterial.depthWrite = false;
    /**
     * ── 액면을 자르는 평면. 여기가 F2 의 전부다 ─────────────────────────────
     * 액체 메시는 목 끝까지 차 있고(`buildLiquidGeometry`), 이 평면이 매 프레임
     * 중력에서 다시 놓이면서 그 위를 버린다. 정점을 옮겨 액면을 만들던 것 —
     * 고정점 반복, 링 두 개, 재클램프, 법선 다시 쓰기 — 이 전부 사라진 자리다.
     *
     * **`renderer.localClippingEnabled` 이 켜져 있어야 한다.** `bootMenu` 가
     * 켠다. 안 켜면 조용히 아무 일도 일어나지 않는다 — 오류도 경고도 없이
     * 액체가 목까지 가득 찬 병이 되고, 실제로 그렇게 한 번 나왔다. `Bottle` 을
     * 다른 곳에서 만들 일이 생기면 그쪽도 켜야 한다.
     *
     * `clipShadows` 는 꺼 둔다. 액체는 그림자를 던지지 않고(`castShadow` 가
     * 없다), 켜 두면 그림자 패스마다 클리핑 유니폼이 하나씩 더 붙는다.
     *
     * `DoubleSide` 여야 한다. 평면이 껍데기를 자르면 그 단면이 열리는데,
     * `FrontSide` 면 안쪽을 향한 뒷면이 컬링되어 잘린 자리로 배경이 그대로
     * 보인다 — 액체에 구멍이 뚫린다. 뒷면을 살리면 그 구멍이 반대편 벽의
     * 안쪽으로 메워지고, 그것이 화면에서 액면으로 읽히는 면이다.
     */
    this.liquidMaterial.clippingPlanes = [this._surfacePlane];
    this.liquidMaterial.clipShadows = false;
    this.liquidMaterial.side = DoubleSide;
    /**
     * 메니스커스를 프래그먼트 셰이더에 얹는다. `MENISCUS_MAIN` 을 보라.
     *
     * `GlossMaterials.create` 가 이미 `onBeforeCompile` 에 림 항을 걸어 두었으
     * 므로 **덮어쓰지 않고 이어 붙인다** — 덮어쓰면 이 병에서만 림이 사라진다.
     *
     * `customProgramCacheKey` 도 반드시 바꾼다. three 는 이 키로 컴파일된
     * 프로그램을 재사용하는데, 림 재질 전부가 `'gloss-rim'` 하나를 쓰고 있다.
     * 그대로 두면 액체가 남의 프로그램을 물려받아 메니스커스가 아예 컴파일되지
     * 않거나, 반대로 다른 재질이 액체의 프로그램을 받아 `clippingPlanes` 가
     * 없는 채로 `vClipPosition` 을 읽는다.
     */
    const rimCompile = this.liquidMaterial.onBeforeCompile;
    this.liquidMaterial.onBeforeCompile = (shader, renderer) => {
      rimCompile?.call(this.liquidMaterial, shader, renderer);
      shader.uniforms.uMeniscusGain = { value: this.tuning.meniscusGain };
      shader.uniforms.uMeniscusWidth = { value: this.tuning.meniscusWidth * MM };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${MENISCUS_PARS}\nvoid main() {`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${MENISCUS_MAIN}`);
      this._liquidShader = shader;
    };
    this.liquidMaterial.customProgramCacheKey = () => 'gloss-rim-meniscus';
    /**
     * The oval decal. `alphaTest`, never `transparent`.
     *
     * The texture is an oval in a rectangular page, so the margin has to vanish.
     * Blending it would make the label a fourth participant in a sort that
     * already has the back wall, the liquid and the front wall in it, and at
     * some angles it lost and disappeared behind the glass it is printed on.
     * A cut alpha is opaque: it writes depth, needs no sorting, and — because
     * the decal stands 0.3 mm proud of the envelope — correctly occludes the
     * front wall behind it, which is where a real label sits.
     *
     * `alphaToCoverage` is what keeps the cut edge clean now that PHASE 1 turned
     * MSAA on.
     */
    this.labelMaterial = retro.create({
      map: this.labelMap,
      uvScale: [1, 1],
      alphaTest: 0.5,
      alphaToCoverage: true,
      preset: 'plastic',
      /**
       * 다른 무엇보다 어둡게, 그리고 그 값은 재서 정했다.
       *
       * 라벨은 흰 종이고 카메라와 태양을 동시에 마주 본다. 환경 강도를 그대로 주면
       * 타원 전체가 블룸 임계값을 넘어 하얗게 날아가서, 병에 구멍이 뚫린 것처럼 보인다.
       * 브라우저에서 세 번 재봤다 — 0.75 는 날아가고, 0.35 는 흰 종이가 회색으로
       * 보이고, 0.5 가 흰색으로 읽히면서 임계값 아래에 머문다.
       */
      envIntensity: 0.5,
    });

    this.capBodyMaterial = retro.create({ color: CAP_COLOR });
    // WHITE, not the cap colour. The panel map used to be a greyscale
    // placeholder that got its red by being multiplied by this; the logo brings
    // its own, and multiplying red by red would come out nearly black.
    this.capPanelMaterial = retro.create({ map: this.capTopMap, color: PALETTE.untinted });
    this.capLinerMaterial = retro.create({ color: LINER_COLOR, gloss: 0.35 });

    // Foam is OPAQUE and lit — a head you can see through is not a head, and
    // being in the depth pass is what stops the far wall of the glass drawing
    // through it and what lets the near wall tint it. Barely glossy: wet foam
    // catches a little light, shiny foam is plastic.
    this.foamMaterial = retro.create({ map: this.foamMap, gloss: 0.18 });

    // The carbonation is a field of billboards posed from a closed-form rise
    // model, not a scrolling page and not a particle system. See `Fizz`.
    this.fizz = new Fizz({ retro, tuning });

    this.glassBack = new Mesh(undefined, this.glassBackMaterial);
    this.glassFront = new Mesh(undefined, this.glassFrontMaterial);
    this.liquid = new Mesh(undefined, this.liquidMaterial);
    this.foam = new Mesh(undefined, this.foamMaterial);
    this.label = new Mesh(undefined, this.labelMaterial);
    this.cap = new Mesh(undefined, [
      this.capBodyMaterial,
      this.capPanelMaterial,
      this.capLinerMaterial,
    ]);

    /**
     * ── 액체가 투명해지면서 순서가 하나 바뀌었다 ────────────────────────────
     * 액체가 불투명 패스에 있을 때는 순서를 깊이 버퍼가 정해 줬다 — 액체가 깊이를
     * 찍고, 뒷벽이 그 뒤에서 걸러졌다. 이제 액체는 투명 패스의 일원이므로 자기
     * 자리를 스스로 말해야 하고, **뒷벽 다음**이다. 반대로 두면 뒷벽이 액체 위에
     * 덮인다.
     *
     * 뒷벽이 이제 액체 너머로 보이는 것은 결함이 아니라 결과다. 맑은 액체를 통해
     * 병의 먼 쪽 벽이 보이는 것이 맞다 — 예전에 그것을 지웠던 이유는 액체가
     * 불투명해서 뒤를 가려야 했기 때문이다.
     *
     * `foam` 과 `label` 은 여전히 불투명 패스이고, 번호는 뜻이 읽히도록 맞춰만 둔다.
     */
    this.glassBack.renderOrder = 0;
    this.liquid.renderOrder = 1;
    this.foam.renderOrder = 1;
    // Bubbles are inside the glass, so the near wall is drawn over them and
    // tints them — which is what puts them behind the glass rather than on it.
    this.fizz.mesh.renderOrder = 2;
    this.glassFront.renderOrder = 3;
    this.label.renderOrder = 4;
    this.foam.visible = false;

    this.lean.add(
      this.liquid,
      this.foam,
      this.fizz.mesh,
      this.glassBack,
      this.glassFront,
      this.label,
      this.cap,
    );

    // ── the shadow ───────────────────────────────────────────────────────────
    // In the SCENE, not under the lean: parenting it to the bottle would tip it
    // over with the bottle and slide it about with the drift, and a shadow is
    // not attached to the thing that casts it.
    this.shadow = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: this.shadowMap, opacity: 0.85 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = -1;

    // ── the burst ────────────────────────────────────────────────────────────
    // One billboard at the mouth, two frames, off unless the launch is running.
    // Half the sheet wide: one frame. `_updateBurst` slides the window.
    this.burstMaterial = createSpriteMaterial(retro, {
      map: this.burstMap,
      blend: 'add',
      opacity: 1,
      uvScale: [0.5, 1],
    });
    // A sibling of `root`, not a child: it is placed by a world position every
    // frame, and a child would have the root's own float added to that twice.
    this.burst = new Mesh(new PlaneGeometry(1, 1), this.burstMaterial);
    this.burst.visible = false;
    this.burst.renderOrder = 6;
    this._burstTime = 0;

    /** Where the cap sits, in the LEAN's space. Recomputed on every rebuild. */
    this._mouthLocal = new Vector3();
    /** The opposite end, for putting the shadow under it. */
    this._baseLocal = new Vector3();
    this._scratch = new Vector3();
    this._centreOffset = 0;
    this._localUp = new Vector3(0, 1, 0);
    this._q = new Quaternion();

    this._clock = 0;
    /**
     * The pointer's pull, as a spring per axis, plus the cap's lagging copy.
     *
     * Two springs rather than one eased value because §6.3 asks for momentum
     * and secondary motion by name: the body arrives, and then the cap arrives.
     * A single lerp gives neither — everything moves together and stops
     * together, which is the tell of UI motion rather than of an object.
     */
    this._pull = { x: 0, y: 0, vx: 0, vy: 0 };
    this._capLag = { x: 0, y: 0, vx: 0, vy: 0 };
    /** Where the pointer is, in -1..1 of the frame. Written by `setPointer`. */
    this._aimAt = { x: 0, y: 0, near: 0 };
    /**
     * 액체 부피의 y(mm) 방향 누적표. `rebuild` 가 채운다.
     *
     * 기울어진 평면 아래의 부피를 매 프레임 풀기 위한 것이다 — `_levelFor`.
     */
    this._vol = null;
    /** 보존해야 할 부피. 기울기 0 에서 `fillLevel` 아래의 부피다. */
    this._vol0 = 0;
    /** 이번 프레임 액면이 병 축을 지나는 높이, 로컬 mm. */
    this._level = 0;
    /**
     * 액면의 수평을 푸는 데 쓰는 스크래치.
     *
     * 필드로 두는 이유는 매 프레임이기 때문이다 — `new Quaternion()` 과
     * `new Vector3()` 를 프레임마다 두 개씩 만들면 GC 가 그만큼 자주 돈다.
     */
    this._surfQ = new Quaternion();
    this._surfUp = new Vector3();
    this._surfN = new Vector3();
    this._surfP = new Vector3();
    /** The head's front, in world units up the bottle. Integrated by continuity. */
    this._foamTop = 0;
    /** The same, normalised over its travel, for everything that wants 0..1. */
    this._foam = 0;
    /** The eruption impulse, decaying. Set by `popBurst`. */
    this._pop = 0;
    this._foamScroll = 0;
    /** Slosh state: displacement and its rate. A real oscillator has both. */
    this._sloshX = 0;
    this._sloshV = 0;
    /** How far round toward the camera the bottle has turned, 0..1. */
    this._aim = 0;

    this.rebuild();

    /**
     * 품질 티어. 병은 이 화면에서 티어가 실제로 만지는 것 전부를 들고 있다.
     *
     * 유리의 구현(§투과 대 가짜 유리), 원주 분할, 거품 수 — 셋이 한 객체에
     * 모여 있으므로 구독도 하나다. `rebuild` 가 지오메트리와 사이트 배치를 모두
     * 다시 푸므로 순서는 재질 먼저, 형상 나중이면 된다.
     */
    this._offQuality = onQualityChange(() => {
      applyGlassQuality(this.glassBackMaterial, this.retro);
      applyGlassQuality(this.glassFrontMaterial, this.retro);
      this.fizz.setCount(FIZZ_COUNT * QUALITY.fizzScale);
      this.rebuild();
    });
    this.fizz.setCount(FIZZ_COUNT * QUALITY.fizzScale);
    this.applyLean();
  }

  // ── construction ───────────────────────────────────────────────────────────

  /** Throw the meshes away and build them again from `tuning.profile`. */
  rebuild() {
    /**
     * 원주 분할은 저자가 적은 값과 티어의 상한 중 **작은 쪽**이다.
     *
     * 천장이지 대체가 아니다. `bottleProfile.BOTTLE_DEFAULTS.columns` 의 72 는
     * "30 mm 반경에서 2.6 mm 모서리 — 스무딩도 클리어코트 하이라이트도 면을
     * 드러내지 않는 지점" 이라는 판단이고, 티어가 그 위로 올려 주는 것은 그
     * 판단을 뒤집는 일이지 품질을 높이는 일이 아니다. 아래로는 내려간다.
     */
    const columns = Math.min(this.tuning.profile.columns, QUALITY.bottleColumns);
    const profile = buildBottleProfile({ ...this.tuning.profile, columns });
    this.profile = profile;

    const glass = buildGlassGeometry(profile);
    const liquid = buildLiquidGeometry(profile);
    const label = buildLabelGeometry(profile);

    // One geometry, two meshes. The back pass is the same triangles seen from
    // the other side, so sharing it is not an optimisation — it is the only way
    // the two walls cannot disagree. Disposed once, by hand, for the same
    // reason: `_swap` would either miss it or free it twice.
    const oldGlass = this.glassBack.geometry;
    this.glassBack.geometry = glass;
    this.glassFront.geometry = glass;
    if (oldGlass && oldGlass !== glass) oldGlass.dispose();

    this._swap(this.liquid, liquid);
    this._swap(this.label, label);
    this._swap(this.foam, buildFoamGeometry(profile));
    this.fizz.setProfile(profile);
    this._foamTop = profile.params.fillLevel * MM;

    // The label material owns a CLONE of the label texture — see
    // `GlossMaterials.create` on why a per-material UV transform needs one —
    // so setting the repeat here cannot pan anybody else's copy.
    this.labelMaterial.map?.repeat.set(label.userData.panels, 1);

    if (!this.capGeometry) {
      // The game's own cap, straight out of the shared module. `shell: false`
      // because the inside of this one is under a bottle finish and is never
      // seen from any angle the menu camera can reach.
      this.capGeometry = buildCapGeometry({ ...CAP_DEFAULTS, shell: false });
      this.cap.geometry = this.capGeometry;
    }

    // Park the bottle so its middle is on the origin — that is what the lean
    // turns about, and building it base-at-zero would swing it round a point
    // below itself.
    this._centreOffset = -(profile.height * MM) / 2;
    for (const m of [
      this.glassBack,
      this.glassFront,
      this.liquid,
      this.foam,
      this.fizz.mesh,
      this.label,
    ]) {
      m.position.y = this._centreOffset;
    }

    /**
     * Seat the cap by its PANEL, not by its hem.
     *
     * The cap's local space has y = 0 at the hem, so the naive seating is a
     * depth to drop the hem to — and it is wrong the moment any cap parameter
     * moves, because a taller skirt then pushes the panel up off the bottle.
     * Measuring back from the cap's own height means the panel sits a fixed
     * fraction of a millimetre proud of the lip whatever the cap is shaped
     * like, which is the thing that actually has to be true.
     *
     * Written with `set` rather than `+=`: this runs again on every rebuild,
     * and `+=` would walk the cap a further half-bottle down on each one.
     */
    const capHeight = this.capGeometry.userData.height;
    /** Where the cap sits when it is on. `popCap` lifts off this and returns to it. */
    this._capSeatY = profile.height * MM - capHeight + this.tuning.capLift * MM + this._centreOffset;
    this.cap.position.set(0, this._capSeatY, 0);

    this._mouthLocal.set(0, profile.height * MM + this._centreOffset, 0);
    this._baseLocal.set(0, this._centreOffset, 0);

    this._buildVolumeTable();

    // A CIRCLE on the floor, not an ellipse. The ellipse the brief asks for is
    // what perspective makes of a circle seen from a camera a little above it —
    // squashing it here as well would squash it twice.
    const r = profile.params.bodyRadius * MM * this.tuning.shadowScale;
    this.shadow.scale.set(r, r, 1);

    this.triangles = {
      glass: glass.userData.triangles,
      liquid: liquid.userData.triangles,
      label: label.userData.triangles,
      cap: this.capGeometry.userData.triangles,
    };
  }

  /**
   * The drink's volume against height, integrated once per rebuild.
   *
   * ── why a table and not a formula ────────────────────────────────────────
   * The bottle is a lathe, so its volume to a height is `∫ π r(y)² dy` — but
   * `r(y)` is a resampled Catmull-Rom through the body and a smoothstep S
   * through the shoulder, and neither has an antiderivative worth writing down.
   * Sampling it is exact enough at a quarter of a millimetre and costs one pass
   * over 800 cells at rebuild, against a shape that only changes when the panel
   * moves a slider.
   *
   * Midpoint rule, cell `i` covering `[i·dy, (i+1)·dy]` with its radius read at
   * the centre. `cum[i]` is therefore the volume of everything BELOW cell `i`,
   * which is the form `_volumeBelow` wants: it takes whole cells from the table
   * and only integrates the band the tilted surface actually cuts through.
   *
   * Units are mm and mm³ throughout — the profile's own units. Nothing here
   * reaches the screen, so converting to world units would only add a place to
   * get the cube of `MM` wrong.
   */
  _buildVolumeTable() {
    const p = this.profile.params;
    const inset = p.liquidInset;
    const dy = 0.25;
    const n = Math.ceil(this.profile.height / dy);
    const radius = new Float64Array(n);
    const cum = new Float64Array(n + 1);
    let rMax = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.max(0, this.profile.envelopeAt((i + 0.5) * dy) * inset);
      radius[i] = r;
      if (r > rMax) rMax = r;
      cum[i + 1] = cum[i] + Math.PI * r * r * dy;
    }
    this._vol = { dy, n, radius, cum, rMax };
    this._vol0 = this._volumeBelow(p.fillLevel, 0);
    this._level = p.fillLevel;
  }

  /**
   * Volume of drink below the plane that passes through `(0, level, 0)` and
   * rises by `K` per unit of horizontal distance.
   *
   * ── it is a stack of circular segments, and that part IS closed form ─────
   * Slice at a height `y`. The drink there is a disc of radius `r(y)`; the
   * plane crosses that disc along a straight chord, and the part of the disc
   * under the plane is a circular segment. So the only thing being sampled is
   * the profile — the geometry at each height is solved, not approximated:
   *
   *     s = (level - y) / K        signed distance from the axis to the chord
   *     A = r² · acos(-s/r) + s · √(r² - s²)
   *
   * `s ≥ r` is the whole disc (the slice is entirely under the plane), `s ≤ -r`
   * is none of it. Those two cases are most of the bottle, which is why the
   * table above exists: only the band `|level - y| < K · rMax` needs the acos.
   */
  _volumeBelow(level, K) {
    const { dy, n, radius, cum, rMax } = this._vol;
    if (K < 1e-6) {
      // Upright: every cell is all-in or all-out, so the table answers directly.
      const f = level / dy - 0.5;
      const i = Math.max(0, Math.min(n, Math.ceil(f)));
      return cum[i];
    }
    const band = K * rMax;
    const first = Math.max(0, Math.min(n, Math.ceil((level - band) / dy - 0.5)));
    let v = cum[first];
    for (let i = first; i < n; i++) {
      const y = (i + 0.5) * dy;
      if (y - level >= band) break;
      const r = radius[i];
      const s = (level - y) / K;
      if (s >= r) v += Math.PI * r * r * dy;
      else if (s > -r) v += (r * r * Math.acos(-s / r) + s * Math.sqrt(Math.max(0, r * r - s * s))) * dy;
    }
    return v;
  }

  /**
   * The height at which a surface of slope `K` holds the drink it started with.
   *
   * ── tilting about the middle does NOT conserve volume ────────────────────
   * The obvious thing — pivot the surface about the centre of the bottle — is
   * only right where the bottle is a cylinder over the whole swing of the
   * surface. It is not: at the shipped lean the high edge of the surface is up
   * at y ≈ 140, inside the shoulder, where the bottle has already begun to
   * close in. So the wedge added on the high side is NARROWER than the wedge
   * taken from the low side, the drink loses volume, and the level has to rise
   * to put it back.
   *
   * Measured on this profile at `fillLevel` 130: +0.21 mm at the 19 degree
   * resting lean, +0.31 mm at the 22 degree aim, +1.20 mm at 35. That is a
   * third of a pixel at the size the menu draws the bottle — it is not why the
   * drink looks right. It is here because the alternative is a surface that
   * silently gains and loses drink as the bottle moves, and because at a fill
   * up in the shoulder (which the panel can still ask for) the same numbers are
   * three times bigger.
   *
   * `_volumeBelow` is monotonic in `level`, so bisection cannot miss.
   *
   * ── the bracket has to cover the tilt, and 30 mm did not ────────────────
   * It was `fillLevel ± 30`, which was ample while the bottle leaned 19 degrees
   * and the level moved 0.21 mm. §6.2 tilts it to 62, and the level moves with
   * the tilt because the neck is above: measured on this profile at fill 112,
   * 112.0 at 19 degrees, 112.8 at 55, 115.6 at 65, 126.8 at 75, and 142.0 at 82
   * — where it is not really 142, it is the old bracket's ceiling, silently
   * clamped. A bisection that cannot reach its answer does not fail, it returns
   * the nearest end, and the visible result is a surface that stops responding
   * past a tilt nobody wrote down.
   *
   * The bracket is the whole bottle now. It costs four more halvings to keep
   * the same precision — sixteen passes over 190 mm lands inside 0.003 mm,
   * against twelve over 60 mm landing inside 0.015 — and buys the guarantee
   * that no pose can be outside it.
   */
  _levelFor(K) {
    if (K < 1e-6) return this.profile.params.fillLevel;
    let lo = 0;
    let hi = this.profile.height;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) * 0.5;
      if (this._volumeBelow(mid, K) < this._vol0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  _swap(mesh, geometry) {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    if (old && old !== geometry) old.dispose();
  }

  /**
   * Re-read the lean from `tuning`, and refresh the bottle's own up-axis.
   *
   * Built by multiplying axis quaternions rather than from an `Euler`, because
   * the ORDER is the whole point and a three-letter order string is a poor way
   * to state it: the yaw has to happen in the bottle's own frame — it is what
   * turns the label to the front — and the leans have to happen after it, in
   * the world's, or changing the yaw would tip the bottle over sideways as well
   * as turning it.
   *
   * ── the aim ───────────────────────────────────────────────────────────────
   * `aim` runs 0 at rest to 1 as the pressure builds, and swings the bottle
   * round to point its mouth at the camera.
   *
   * This is a deliberate exception to the brief's "회전 없음", asked for after
   * the fact and for a good reason: with the bottle locked at its resting lean
   * the cap left pointing up and to the left, and then had to bend through most
   * of a right angle to arrive at the camera. It looked like the cap changed
   * its mind. Turning the whole bottle to aim first means the cap leaves along
   * the axis it was already on, which is the only way the launch reads as one
   * continuous movement.
   *
   * It is still not a spin. It happens once, over the run, it is driven by that
   * run's own envelope, and it unwinds when the bottle settles.
   *
   * ── three things add to the lean, and they add in this order ─────────────
   *   1. the AIM     a big one-off turn toward the camera, above
   *   2. the DRIFT   a few degrees on two long periods. §6.2's "아주 느린 회전"
   *   3. the PULL    the pointer's, a degree or two, spring-driven
   *
   * They are summed as ANGLES and composed once, rather than composed as three
   * quaternions. Composing separately would make the drift's axis depend on how
   * far the aim had already turned, so the same drift would look different at
   * different points of a run — which reads as the drift speeding up.
   */
  applyLean(aim = this._aim) {
    const t = this.tuning;
    const deg = (d) => (d * Math.PI) / 180;
    // Eased at both ends so the turn starts and stops rather than snapping into
    // and out of the aimed pose.
    const a = aim * aim * (3 - 2 * aim);
    const driftZ = Math.sin((this._clock / t.driftPeriodZ) * Math.PI * 2) * t.driftTiltZ;
    const driftX = Math.sin((this._clock / t.driftPeriodX) * Math.PI * 2) * t.driftTiltX;
    /**
     * The pointer tips the bottle TOWARD the pointer, not away.
     *
     * Away would be the physical answer for something being pushed. Nothing is
     * pushing it — the reading §6.3 asks for is a glass object noticing you,
     * and an object that leans in is noticing. It is one and a half degrees at
     * full pull, which is under the drift's own amplitude on purpose: the
     * response has to be felt rather than seen.
     */
    const leanZ = t.leanZ + (t.aimLeanZ - t.leanZ) * a + driftZ - this._pull.x * t.pullTilt;
    const leanX = t.leanX + (t.aimPitch - t.leanX) * a + driftX + this._pull.y * t.pullTilt;

    const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), deg(leanZ));
    const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), deg(leanX));
    const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(t.faceYaw));
    this.lean.quaternion.copy(qz).multiply(qx).multiply(qy);
    this._q.copy(this.lean.quaternion);
    this._localUp.set(0, 1, 0).applyQuaternion(this._q);

    /**
     * The cap carries its own rotation, one beat behind the body's.
     *
     * A crown cap sitting on a bottle's mouth is a separate object, and the
     * whole of §6.3's "캡의 2차 모션" is that it does not turn at the same
     * instant the bottle does. `_capLag` is the body's pull with a slower
     * spring on it, so the difference between the two IS the lag — no phase
     * offset is authored anywhere, and at rest the difference is zero and the
     * cap sits square.
     */
    if (this.cap) {
      this.cap.rotation.z = deg((this._capLag.x - this._pull.x) * t.capLagTilt);
      this.cap.rotation.x = deg((this._pull.y - this._capLag.y) * t.capLagTilt);
    }
  }

  // ── per frame ──────────────────────────────────────────────────────────────

  /**
   * Where the pointer is, so the glass can react to it.
   *
   * ── it takes a DIRECTION and a proximity, not a hit ────────────────────────
   * The bottle is not a control and must not behave like one: there is no
   * hover state to enter and leave, because entering and leaving is what
   * produces the on/off snap §6.3 calls a preset. What it gets instead is where
   * the pointer is relative to the frame's centre and how close it has come, and
   * everything below is continuous in both.
   *
   * @param {number} x  -1..1 across the frame, 0 at the centre
   * @param {number} y  -1..1 down the frame
   * @param {number} near  0 far away, 1 right on it
   */
  setPointer(x, y, near) {
    this._aimAt.x = Math.max(-1, Math.min(1, x));
    this._aimAt.y = Math.max(-1, Math.min(1, y));
    this._aimAt.near = Math.max(0, Math.min(1, near));
  }

  /**
   * @param {number} dt
   * @param {object} state
   * @param {number} state.aim    1 while a run is playing out, 0 otherwise
   * @param {import('three').Camera} state.camera  for billboarding the fizz
   */
  update(dt, { aim = 0, camera } = {}) {
    this._clock += dt;
    const t = this.tuning;

    // ── the turn toward the camera ─────────────────────────────────────────
    // Rises faster than it falls: the bottle has to be aimed before the cap
    // goes, and it has all the time in the world to unwind afterwards.
    const rate = dt / Math.max(0.02, aim > this._aim ? t.aimRiseSeconds : t.aimFallSeconds);
    this._aim += Math.max(-rate, Math.min(rate, aim - this._aim));
    this.applyLean(this._aim);

    // ── the float ────────────────────────────────────────────────────────────
    // Position only. The sideways term is a different, slower frequency so the
    // two never line up into a diagonal bob.
    const rise = Math.sin(this._clock * t.floatSpeed) * t.floatAmplitude;
    const drift = Math.sin(this._clock * t.floatSpeed * 0.61) * t.floatAmplitude * 0.28;

    /**
     * ── the pointer's pull ─────────────────────────────────────────────────
     * A critically damped spring per axis. `omega` is what makes it feel like
     * mass rather than like a lerp: the bottle starts late, overshoots nothing,
     * and keeps moving for a moment after the pointer stops.
     *
     * Critically damped rather than under-damped on purpose. A bottle that
     * bounces back is a bottle on a spring; one that coasts to a stop is one
     * with weight, and weight is what §6.3's "물리적으로 그럴듯한" asks for.
     */
    const omega = 4.6;
    for (const [k, vk, target] of [
      ['x', 'vx', this._aimAt.x * this._aimAt.near],
      ['y', 'vy', this._aimAt.y * this._aimAt.near],
    ]) {
      const a = omega * omega * (target - this._pull[k]) - 2 * omega * this._pull[vk];
      this._pull[vk] += a * dt;
      this._pull[k] += this._pull[vk] * dt;
    }
    /**
     * The cap's own spring, chasing the body's rather than the pointer's.
     *
     * Slower, so it arrives after. That one beat of delay is the whole of the
     * secondary motion — the cap is a separate object sitting on the mouth, and
     * a separate object does not accelerate at the same instant the thing under
     * it does.
     */
    const capOmega = omega * 0.55;
    for (const [k, vk] of [['x', 'vx'], ['y', 'vy']]) {
      const a = capOmega * capOmega * (this._pull[k] - this._capLag[k]) - 2 * capOmega * this._capLag[vk];
      this._capLag[vk] += a * dt;
      this._capLag[k] += this._capLag[vk] * dt;
    }

    this.root.position.set(
      t.originX + drift + this._pull.x * t.pullTravel,
      t.originY + rise - this._pull.y * t.pullTravel,
      this._pull.y * t.pullTravel * 0.5,
    );

    /**
     * Under the bottle's MIDDLE now, not under its base.
     *
     * It was under the base, and the reasoning was sound for a bottle that
     * stood on something: the lean turns the bottle about its own centre, so at
     * 19 degrees the base is a third of a half-height off to one side and a
     * shadow parked under the centre sits beside the bottle rather than under
     * it. That argument assumes the shadow marks where the object TOUCHES.
     *
     * §6.2 removes the contact. What is left is one very soft shape a long way
     * below a floating object, and the thing directly above it is the bottle's
     * body — at 62 degrees the base is off to one side by most of the bottle's
     * length, and a shadow out there reads as a second object.
     *
     * It does not shrink with the rise either. `shadowLift` was a height cue for
     * something approaching a floor; a shadow that sharpens as the bottle
     * descends is exactly the contact this pose does not have.
     */
    this.shadow.position.set(this.root.position.x, t.shadowDrop, this.root.position.z);
    const r = this.profile.params.bodyRadius * MM * t.shadowScale;
    this.shadow.scale.set(r, r, 1);

    this._surface(dt);
    this._carbonate(dt);
    /**
     * The carbonation is always on, and the pointer stirs it.
     *
     * §6.1: the fizz survives the shake's removal with a different reason for
     * existing — it is the drink's own carbonation rather than something a
     * gesture produced. `restFizz` is that floor. §6.3 asks for it to react to
     * an approaching pointer, which is the `near` term, and the foam head still
     * carries the eruption.
     */
    this.fizz.update(dt, {
      intensity: Math.max(t.restFizz + this._aimAt.near * t.pointerFizz, this._foam),
      camera,
      worldQuaternion: this.lean.quaternion,
    });
    this._updateBurst(dt);
  }

  /**
   * The drink going off.
   *
   * ── the head is a VOLUME being poured into a shape ─────────────────────
   * See the note on the front below: its height is integrated from a production
   * rate divided by the bottle's own cross-section, so the bottle's geometry
   * decides how fast the foam climbs at every height. Nothing here is eased by
   * hand.
   *
   * ── it used to be a meter of how hard the bottle had been worked ────────
   * Production was `shake * foamProduction`, so the head recorded the wind-up
   * and the eruption was a bottle that had run out of room. With no shake the
   * production is constant and sits just above the drain, so the head settles
   * low in the body instead of climbing — a drink that is fizzy, not one that
   * is about to go. The eruption is `foamPopSurge` alone now, which is the
   * honest arrangement: the bottle goes off because it is opened.
   *
   * ── the geometry is rewritten, not rebuilt ─────────────────────────────
   * Six rings of twenty, positions only, once a frame. Each ring is placed up
   * the bottle by the foam's current height and given the radius the GLASS has
   * at that height, so the column hugs the inside all the way — narrowing
   * through the shoulder and into the neck without anything here knowing what a
   * shoulder is. Normals are left alone: they are radial, and a radial normal
   * on a near-vertical column of matte foam is right at every height.
   *
   * The bubbles under it are their own thing entirely — see `Fizz`.
   */
  _carbonate(dt) {
    const t = this.tuning;
    const g = this.foam.geometry;
    const data = g.userData;

    const fillY = this.profile.params.fillLevel * MM;
    const ceilY = t.foamCeiling * MM;
    const inset = this.profile.params.liquidInset;

    /**
     * ── the front rises by CONTINUITY, not by a lerp ────────────────────────
     * Foam is being made at some volume per second down at the surface, and it
     * has nowhere to go but up. So the speed of the front is not a constant and
     * not an eased curve — it is
     *
     *     dy/dt = Q / A(y)
     *
     * the production rate over the cross-section it is currently passing
     * through. Which means the foam crawls up the wide body and then, as the
     * shoulder closes in and the neck takes over, ACCELERATES HARD through the
     * last stretch. Between the body and the neck the area falls by a factor of
     * six, so the front moves six times faster up there, out of one division.
     *
     * That single line is most of what makes a fizzing bottle look like a fizzing
     * bottle, and no hand-authored curve was going to find it by accident.
     *
     * Production tracks entrained gas; drainage is constant, so when the
     * shaking stops the net goes negative and the head sinks back down — fast
     * in the neck and slowly in the body, for the same reason and by the same
     * arithmetic.
     */
    const r = Math.max(0.05, this.profile.envelopeAt(this._foamTop / MM) * inset * MM);
    const area = Math.PI * r * r;
    const production = t.foamProduction + this._pop * t.foamPopSurge;
    this._pop = Math.max(0, this._pop - dt / Math.max(0.01, t.foamPopSeconds));
    const net = production - t.foamDrain;

    this._foamTop = Math.max(fillY, Math.min(ceilY, this._foamTop + (net * dt) / area));
    // 0..1 across the head's travel, for everything that wants "how worked up
    // is this bottle" rather than a height.
    this._foam = (this._foamTop - fillY) / Math.max(1e-4, ceilY - fillY);

    const active = this._foam > 0.002;
    this.foam.visible = active;
    if (!active) return;

    // Churn. Faster while the eruption is running.
    this._foamScroll -= dt * t.foamScrollSpeed * (0.5 + this._pop);
    if (this.foamMaterial.map) this.foamMaterial.map.offset.y = this._foamScroll;

    const topY = this._foamTop;
    const pos = g.getAttribute('position');
    const rows = data.foamRows;
    const cols = data.foamCols;
    const stride = data.foamStride;

    /**
     * ── 거품은 **액면 위에** 앉는다. 병 바닥에 대해 수평이 아니라 ────────────
     * 밑줄이 `y = fillY` 인 평평한 링이었다. 그건 병 축에 수직인 면이고, 액면은
     * `_slosh` 가 중력에서 푸는 월드 수평면이다. 병이 20도 기울면 두 면이 20도
     * 어긋나서 같은 높이에 서로 다른 각도의 경계가 **둘** 생긴다 — 한쪽은 액면
     * 위에 떠 있고 다른 쪽은 액체에 잠긴다. 화면에서는 어깨에서 액체가 한 겹 더
     * 삐져나온 것처럼 보였고, 실제로 사용자가 그렇게 읽었다.
     *
     * 밑줄을 액면의 **바로 그 정점에서** 읽는다. 같은 값을 다시 계산하지 않는
     * 이유는 액면에 출렁임까지 얹혀 있기 때문이다 — 다시 풀면 그 항이 빠져서
     * 흔드는 동안 실밥만 한 틈이 계속 생긴다.
     *
     * 머리도 같은 평면으로 기운다. 목에서는 반지름이 작아 기울기가 덜 보이지만,
     * 밑은 기울고 위는 안 기울면 기둥이 비틀린 것으로 보인다.
     */
    const kx = this._surfKx ?? 0;
    const kz = this._surfKz ?? 0;
    const ceil = (this.profile.height - 2) * MM;
    const clampY = (v) => Math.max(2 * MM, Math.min(ceil, v));

    const headR = this.profile.envelopeAt(topY / MM) * inset * MM;

    for (let i = 0; i <= cols; i++) {
      const th = (i / cols) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);

      /**
       * 이 컬럼에서 액면이 어디 있는가.
       *
       * 예전에는 액면 링의 정점을 그대로 읽었다. 그 정점이 없어졌으므로 —
       * 액면은 이제 평면이다 — 평면과 벽의 교점을 푼다. `_surfaceAt` 이 그
       * 계산이고, 출렁임은 이미 평면의 법선에 들어가 있으므로 여기서 따로
       * 더할 것이 없다. 예전 주석이 "다시 풀면 출렁임 항이 빠진다" 고 경고한
       * 것은 출렁임이 정점에만 있던 시절의 이야기다.
       */
      const foot = this._surfaceAt(kx * c + kz * sn);
      const footY = foot.y;
      const footR = foot.r;

      // 머리도 같은 평면 위. 그 컬럼에서 액면보다 낮으면 거품이 없다는 뜻이다.
      const capY = Math.max(footY, clampY(topY + (kx * c + kz * sn) * headR));

      for (let j = 0; j < rows; j++) {
        const t = j / (rows - 1);
        const y = footY + (capY - footY) * t;
        // 밑줄만 액면의 반지름을 그대로 쓴다. 그래야 이음매가 없다.
        const r = j === 0 ? footR : this.profile.envelopeAt(y / MM) * inset * MM;
        pos.setXYZ(j * stride + i, r * c, y, r * sn);
      }

      if (i < cols) {
        const rimY = Math.max(footY, clampY(topY + (kx * c + kz * sn) * headR));
        pos.setXYZ(data.headRim + i, headR * c, rimY, headR * sn);
      }
    }

    pos.setXYZ(data.headCentre, 0, topY, 0);
    pos.needsUpdate = true;
  }

  /**
   * The fill line, sloshing at its OWN frequency — as a PLANE.
   *
   * ── the liquid is an oscillator, not a follower ─────────────────────────
   * The first version drove the surface directly off the bottle's own motion,
   * at the bottle's own frequency. That is wrong in a way you can feel: a liquid
   * in a container has a natural sloshing frequency of its own, it responds to
   * being driven rather than copying the drive, and it keeps going after the
   * driving stops. Copying the drive makes the surface look welded to the
   * bottle.
   *
   * The fundamental (m = 1) mode in a cylinder is
   *
   *     omega^2 = g (eps/R) tanh(eps h / R),     eps = 1.8412
   *
   * — eps being the first zero of J1', the derivative of the first-order Bessel
   * function. For this bottle, R about 2.9 units and h about 13, that lands at
   * roughly 4 Hz. The bottle's drift is at a sixtieth of that, so the surface is
   * far BELOW resonance now and simply follows the drive with almost no lag —
   * which is the correct answer for a bottle turning slowly in space, and is why
   * the oscillator survived the shake's removal rather than being replaced by a
   * lerp. What it is still doing is refusing to snap when the drift reverses,
   * and carrying the kick a pop gives it.
   *
   * It is integrated as a damped driven oscillator, sub-stepped so a slow frame
   * cannot make it explode — omega * dt already reaches 1.3 at the loop's 50 ms
   * clamp, which is past where semi-implicit Euler stays well behaved.
   *
   * ── the mode is a TILT, which is why a plane can carry all of it ─────────
   * m = 1 is the surface tipping like a saucer: high on one side, low on the
   * other, still in the middle. That is a plane. The earlier `sin(2 theta)` was
   * the m = 2 mode, which is a real mode but not the one that dominates, and it
   * read as the drink rippling rather than swaying.
   *
   * So the whole of this function is now three numbers — a normal, a height and
   * the slope that the foam reads — where it used to be a fixed-point solve, two
   * rings of seventy-two vertices, a re-clamp and a normal rewrite. See the note
   * on `_surfacePlane`, and `buildLiquidGeometry` for what went away.
   *
   * ── and the drive comes from the LEAN ───────────────────────────────────
   * Motion along a perfectly upright bottle's own axis excites no tilt at all —
   * it is symmetric about the axis. This bottle leans hard, so its axial motion
   * has a horizontal component of sin(lean), and THAT is what tips the drink.
   * The coupling falls out of the geometry rather than being asserted, and it
   * means standing the bottle upright would correctly calm the surface down.
   */
  _surface(dt) {
    /**
     * 이 프레임의 월드 행렬을 먼저 세운다.
     *
     * 평면의 통과점을 `localToWorld` 로 얻는데, three 는 월드 행렬을 렌더 직전에
     * 갱신한다 — 그냥 두면 액면이 병보다 한 프레임 늦게 따라와서, 부유의 가장
     * 빠른 지점에서 0.3 mm 어긋난다. 예전 코드는 쿼터니언만 읽었고 기울기는
     * 상수라 티가 나지 않았다. 위치를 읽기 시작했으니 갱신도 시작해야 한다.
     */
    this.liquid.updateWorldMatrix(true, false);

    const t = this.tuning;
    const p = this.profile.params;
    const R = Math.max(0.2, this.profile.envelopeAt(p.fillLevel) * p.liquidInset * MM);
    const h = Math.max(0.2, p.fillLevel * MM);
    const k = 1.8412 / R;
    const omega = Math.sqrt(G_WORLD * k * Math.tanh(k * h));

    /**
     * ── the drive is the DRIFT ─────────────────────────────────────────────
     * It used to be an arm: a stroke of a few hertz with a 17 Hz rattle riding
     * on it, and the stroke sat on the drink's own ~4 Hz mode because that is
     * precisely why shaking a bottle works. The rattle itself did almost
     * nothing, which was not a bug but the answer — a linear oscillator driven
     * at seven times resonance responds as F/omega_d², a fiftieth of what it
     * gives on resonance.
     *
     * The arm is gone. What moves the drink is the bottle's own slow turn, far
     * BELOW resonance, where the response is quasi-static: the surface follows
     * the drive almost exactly and lags by almost nothing. That is right. A
     * bottle drifting in space does not have waves in it.
     *
     * Horizontal share from the current lean: `_localUp` is the bottle's axis
     * in world space, so its horizontal length IS sin(lean). Stand the bottle
     * upright and the drive correctly goes to zero — axial motion of an upright
     * cylinder is symmetric and cannot excite a tilt.
     */
    const tipping = Math.hypot(this._localUp.x, this._localUp.z);
    const drive =
      t.sloshDrive * tipping * Math.sin(this._clock * Math.PI * 2 * t.strokeFrequency);

    const steps = Math.max(1, Math.ceil(dt * 240));
    const step = dt / steps;
    for (let n = 0; n < steps; n++) {
      const accel = -omega * omega * this._sloshX - 2 * t.sloshDamping * omega * this._sloshV + drive;
      this._sloshV += accel * step;
      this._sloshX += this._sloshV * step;
    }
    const amp = Math.max(-t.sloshLimit, Math.min(t.sloshLimit, this._sloshX));

    /**
     * ── 액면은 병이 아니라 **중력**을 따른다 ─────────────────────────────────
     * 평형면은 중력에 수직인 평면, 즉 월드에서 수평인 평면이다. 병이 22도 기울면
     * 액면은 그대로 수평이어야 하고, 병을 따라 22도 기울면 그건 액체가 아니라
     * 병 안에 굳어 있는 것이다.
     *
     * 그래서 평면의 법선을 **월드 위쪽**에서 시작한다. 예전에는 그 월드 수평면을
     * 병의 로컬 좌표계로 끌어와서 정점마다 풀었는데, 이제 클립 평면 자체가 월드
     * 공간이므로 끌어올 일이 없다 — 중력이 사는 곳에서 그대로 쓴다.
     *
     * ── 출렁임은 그 법선을 기울이는 것이다 ──────────────────────────────────
     * 예전 코드는 컬럼마다 `y + cos(theta) * amp` 를 더했다. `cos(theta)` 는 병의
     * 로컬 +x 축에 고정된 값이라, 기울기 방향(`kx`, `kz`)과 어긋나 있었다 —
     * `leanX` 가 0 이 아니면 술이 기운 쪽이 아니라 옆쪽으로 몰렸다. 주석은
     * "기울기와 같은 축을 돌므로" 라고 적고 있었지만 코드는 그렇지 않았다.
     *
     * 평면으로 하면 그 축을 말할 수밖에 없고, 말하면 맞출 수 있다: 병 축의 수평
     * 성분이 술이 몰리는 방향이다. 진폭 `amp` 는 테두리에서의 높이였으므로
     * 기울기는 `amp / R` 이다.
     */
    const hx = this._localUp.x;
    const hz = this._localUp.z;
    const hl = Math.hypot(hx, hz);
    const slope = amp / R;
    const dx = hl > 1e-6 ? hx / hl : 0;
    const dz = hl > 1e-6 ? hz / hl : 0;
    this._surfN.set(-slope * dx, 1, -slope * dz).normalize();

    /**
     * 그 법선을 병의 로컬 좌표계로 되가져온다. 두 곳이 필요로 한다: 부피 적분
     * (기울기 K)과 거품 기둥의 밑면(`kx`, `kz`). 둘 다 프로파일을 읽으므로
     * 프로파일과 같은 좌표계에 있어야 한다.
     */
    this.liquid.getWorldQuaternion(this._surfQ);
    this._surfUp.copy(this._surfN).applyQuaternion(this._surfQ.invert());
    const upy = this._surfUp.y;
    const level = Math.abs(upy) > 1e-3;
    const kx = level ? -this._surfUp.x / upy : 0;
    const kz = level ? -this._surfUp.z / upy : 0;
    /**
     * 평형면의 기울기를 남겨 둔다. 거품이 이것을 읽는다.
     *
     * 거품 기둥의 밑면은 액면 **위에** 앉아야 하는데, 액면은 월드에서 수평이고
     * 거품은 병 축에 수직인 링이었다. 병이 기울면 둘이 그 각도만큼 어긋나고,
     * 화면에서는 같은 높이에 서로 다른 각도의 면이 둘 보인다 — 한쪽은 액면 위에
     * 떠 있고 다른 쪽은 액체에 잠긴다.
     */
    this._surfKx = kx;
    this._surfKz = kz;

    /**
     * 축을 지나는 높이는 **부피가 정한다.** `_levelFor` 를 보라.
     *
     * 로컬 mm 로 풀고 월드로 곱해 쓴다. 프로파일이 mm 이고 부피표도 mm 이므로
     * 변환은 마지막 한 번뿐이다.
     */
    this._level = this._levelFor(Math.hypot(kx, kz));

    /**
     * 평면을 월드에 놓는다.
     *
     * 통과점은 병 축 위의 그 높이다. `localToWorld` 로 옮기므로 조상 전부 —
     * 부유, 흔들림, 기울기 — 가 자동으로 들어간다. `lean` 뿐 아니라 `root` 의
     * 위아래 부유까지 따라가야 액면이 화면에서 가만히 있는다.
     */
    /**
     * `_centreOffset` 은 **더하지 않는다.** `rebuild` 가 그것을 메시의
     * `position.y` 에 넣어 두었고(`m.position.y = this._centreOffset`),
     * `localToWorld` 가 그 행렬을 이미 적용한다. 여기서 또 더하면 병 높이의
     * 절반만큼 아래에 평면이 놓여서 액체가 통째로 잘려 나가거나 — 실제로는
     * 하나도 잘리지 않아 목까지 가득 찬다.
     *
     * `_mouthLocal` 과 `_baseLocal` 이 그것을 더하는 것은 저쪽이 메시가 아니라
     * `lean` 의 좌표계에서 쓰이기 때문이다. 좌표계가 다르면 규칙도 다르다.
     */
    this._surfP.set(0, this._level * MM, 0);
    this.liquid.localToWorld(this._surfP);
    this._surfacePlane.setFromNormalAndCoplanarPoint(this._surfN, this._surfP);
    /**
     * 그리고 **뒤집는다.** three 는 법선이 가리키는 쪽을 남긴다.
     *
     * 셰이더의 판정은 `dot(vClipPosition, n) > w` 이면 버리는 것이고,
     * `vClipPosition` 이 `-mvPosition` 이라 부호가 한 번 더 뒤집힌다 —
     * 정리하면 법선 쪽이 살고 반대쪽이 잘린다. `_surfN` 은 위를 향하므로
     * 그대로 쓰면 액체의 **윗부분만** 남고 몸통이 사라진다. 실제로 그렇게 나왔다:
     * 목이 차 있고 몸통이 비었다.
     *
     * `_surfN` 자체를 아래로 만들지 않는 이유는 그 벡터를 부피와 거품이 위쪽
     * 방향으로 읽기 때문이다. 평면만 뒤집는 편이 두 의미를 섞지 않는다.
     */
    this._surfacePlane.negate();
  }

  /**
   * Where the surface meets the inside of the glass, at one azimuth.
   *
   * Only the FOAM needs this now. The drink itself is cut by the plane and has
   * no idea where the wall is; the head of foam is a separate mesh that has to
   * stand ON the drink, so it needs the actual point.
   *
   * Two conditions at once — on the surface plane, and against the glass:
   *
   *     y = level + (kx·cos + kz·sin) · r        on the plane
   *     r = envelope(y) · liquidInset            on the inside of the wall
   *
   * Their intersection, by damped fixed-point iteration. The damping is not
   * decoration: through the shoulder `dr/dy` is steep enough that an undamped
   * step oscillates. The final `min` is the guarantee — whatever the iteration
   * converged to, the foot cannot be wider than the wall at its own height.
   *
   * @returns {{r: number, y: number}} world units
   */
  _surfaceAt(dir) {
    const p = this.profile.params;
    const inset = p.liquidInset;
    const ceil = (this.profile.height - 2) * MM;
    const floorY = 2 * MM;
    const clampY = (v) => Math.max(floorY, Math.min(ceil, v));
    const y0 = this._level * MM;
    let r = this.profile.envelopeAt(this._level) * inset * MM;
    for (let n = 0; n < 12; n++) {
      const want = this.profile.envelopeAt(clampY(y0 + dir * r) / MM) * inset * MM;
      r += (want - r) * 0.35;
    }
    const y = clampY(y0 + dir * r);
    const wall = this.profile.envelopeAt(y / MM) * inset * MM;
    return { r: Math.max(0, Math.min(r, wall)), y };
  }

  // ── the burst at the mouth ─────────────────────────────────────────────────

  /**
   * Fire the two-frame spray. Called once, when the cap leaves.
   *
   * It also slams the pressure to full, so the head is at the top of the neck
   * on the frame the cap goes rather than wherever the drift happened to have
   * pushed it. Whatever the player skipped, the bottle erupts.
   */
  popBurst() {
    this._burstTime = 0;
    this.burst.visible = true;
    // An impulse into the production rate rather than a jump in the height:
    // the pressure release makes foam violently for a moment, and how fast that
    // foam then travels is still the bottle's cross-section's business. Which
    // means the surge is slow through the shoulder and explosive in the neck,
    // for free, out of the same division.
    this._pop = 1;
  }

  _updateBurst(dt) {
    if (!this.burst.visible) return;
    this._burstTime += dt;
    const life = this.tuning.burstSeconds;
    if (this._burstTime >= life) {
      this.burst.visible = false;
      return;
    }
    // Two frames, stepped. No cross-fade — a sprite sheet on this hardware
    // changed frames, it did not blend them. Through the material's own uv
    // uniforms and not `texture.offset`, which a ShaderMaterial ignores; see
    // the note on the sprite vertex stage.
    const frame = this._burstTime < life * 0.4 ? 0 : 1;
    if (this.burstMaterial.map) this.burstMaterial.map.offset.x = frame * 0.5;

    const grow = 1 + (this._burstTime / life) * 1.6;
    const size = this.tuning.burstSize * grow;
    this.burst.scale.set(size, size, 1);
    this.burst.position.copy(this.mouthWorld());
  }

  /** Where the cap leaves from, in world space. The wipe launches from here. */
  mouthWorld(out = new Vector3()) {
    return out.copy(this._mouthLocal).applyQuaternion(this.lean.quaternion).add(this.root.position);
  }

  /** Which way the mouth points, in world space. The wipe flies along this. */
  mouthDirection(out = new Vector3()) {
    return out.copy(this._localUp);
  }

  /**
   * The hop, stage 2 of the transition.
   *
   * ── it leaves the BOTTLE; it does not leave the frame ────────────────────
   * The cap used to come off here and keep going — across the screen, growing,
   * until it covered the frame and the document was swapped behind it. That is
   * the letterbox's job now, and what is left is the part that was always about
   * this object: the crimp lets go, the cap is thrown a little way up its own
   * axis, and the eruption goes off underneath it. It is out of sight behind
   * the closing bars a sixth of a second later, which is why nothing here has
   * to decide how it lands.
   *
   * Along the bottle's OWN axis — `this.cap` is a child of the lean — so a cap
   * leaving a bottle that is tipped toward the camera goes the way the bottle is
   * pointing rather than straight up the screen. The tumble is small and about
   * the cap's own normal, which is the one rotation a crown cap can take without
   * showing the viewer its edge.
   *
   * @param {number} t  0..1 through the hop. Any value outside seats it again.
   */
  popCap(t) {
    if (!(t > 0)) {
      this.cap.visible = true;
      this.cap.position.y = this._capSeatY ?? this.cap.position.y;
      this.cap.rotation.set(0, 0, 0);
      return;
    }
    const k = Math.min(1, t);
    // Fast off the mouth and easing as it goes — the crimp releasing, not a
    // thing being lifted. It never comes back down: the bars arrive first.
    const rise = (1 - (1 - k) * (1 - k)) * POP_RISE * MM;
    this.cap.position.y = (this._capSeatY ?? 0) + rise;
    this.cap.rotation.y = k * POP_TURNS * Math.PI * 2;
    this.cap.visible = true;
  }

  /** Hide the cap for the frames the bottle is meant to be open. */
  setCapVisible(on) {
    this.cap.visible = on;
  }

  setWireframe(on) {
    for (const m of [
      this.glassBackMaterial,
      this.glassFrontMaterial,
      this.liquidMaterial,
      this.foamMaterial,
      this.labelMaterial,
      this.capBodyMaterial,
      this.capPanelMaterial,
      this.capLinerMaterial,
    ]) {
      m.wireframe = on;
    }
  }

  dispose() {
    this._offQuality?.();
    for (const m of [this.glassBack, this.liquid, this.foam, this.label, this.shadow, this.burst]) {
      m.geometry?.dispose();
    }
    this.capGeometry?.dispose();
    this.fizz.dispose();
    for (const t of [
      this.highlightMap,
      this.labelMap,
      this.capTopMap,
      this.shadowMap,
      this.burstMap,
      this.foamMap,
    ]) {
      t.dispose();
    }
    this.glassBackMaterial.dispose();
    this.glassFrontMaterial.dispose();
    this.burstMaterial.dispose();
    this.shadow.material.dispose();
    this.root.clear();
    this.lean.clear();
  }
}

/**
 * Which way the cap flies, in frame axes, once the bottle has aimed.
 *
 * The menu projects the real thing through its own camera. This is for the
 * GAME page, which has to pick stage 4 up after a document swap with no bottle
 * to ask — and a cap that covered the screen travelling up and left, then left
 * it travelling somewhere else, would give the whole trick away.
 *
 * Rz(leanZ) applied to Rx(pitch) applied to the bottle's up vector; the frame's
 * x and y are the world's, so the horizontal part drops straight out.
 */
export function aimedLaunchDirection(tuning) {
  const z = (tuning.aimLeanZ * Math.PI) / 180;
  const x = (tuning.aimPitch * Math.PI) / 180;
  const horizontal = Math.cos(x);
  return { x: -horizontal * Math.sin(z), y: horizontal * Math.cos(z) };
}

export { CAP_COLOR };

import { Group, Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { buildCapGeometry, CAP_DEFAULTS, MM } from '../cap/capGeometry.js';
import { buildBottleProfile } from './bottleProfile.js';
import {
  buildFoamGeometry,
  buildGlassGeometry,
  buildLabelGeometry,
  buildLiquidGeometry,
} from './bottleGeometry.js';
import { Fizz, G_WORLD } from './Fizz.js';
import { createGlassMaterial, createSpriteMaterial } from './menuMaterials.js';
import {
  burstSheet,
  capLogoTexture,
  foamTexture,
  glassHighlightTexture,
  labelTexture,
  shadowTexture,
} from './menuTextures.js';
import { PALETTE } from '../core/palette.js';

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
 * ── it does not spin ────────────────────────────────────────────────────────
 * Not at idle, not while shaking, not ever. The lean is fixed so the label
 * faces front and stays there, and the idle motion is a slow rise and fall with
 * a much smaller sideways drift — position only. A rotating hero object is the
 * default thing to build and it is explicitly not what this is.
 *
 * ── the shake runs along the bottle's OWN axis ──────────────────────────────
 * `_localUp` is the tilt quaternion applied to (0, 1, 0), so it points up
 * through the bottle rather than up through the world. The shake is a scalar
 * along that vector added to the root's position. Nothing touches the
 * quaternion, which is what keeps the lean constant while the thing is being
 * shaken — and what makes it read as someone shaking a bottle to build the
 * pressure up rather than as the bottle bouncing on a floor.
 */

/** Bottle-cap red, the same one the viewer starts its picker at. */
/**
 * The brand cap. See `PALETTE.menu.capBrand` for why this one value matters more
 * than most: `main.js` paints the whole screen with it during the handover.
 */
const CAP_COLOR = PALETTE.menu.capBrand;
const LINER_COLOR = PALETTE.metal.liner;

export class Bottle {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {object} tuning  the live `MENU_CONFIG.bottle` block
   */
  constructor({ retro, tuning }) {
    this.retro = retro;
    this.tuning = tuning;
    this.params = {};

    /** Moved by the float and the shake. Never rotated. */
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
    // In the SCENE, not under the lean: a shadow lies on the floor whatever the
    // thing above it is doing, and parenting it to the bottle would tip it over
    // with the bottle and slide it about with the shake.
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
    this._shake = 0;
    /** Baseline y of the liquid's surface ring, kept for the slosh to work off. */
    this._surfaceBase = null;
    /** Whether the surface ring currently holds anything but its rest shape. */
    this._sloshed = false;
    /**
     * 액면의 수평을 푸는 데 쓰는 스크래치.
     *
     * 필드로 두는 이유는 매 프레임이기 때문이다 — `new Quaternion()` 과
     * `new Vector3()` 를 프레임마다 두 개씩 만들면 GC 가 그만큼 자주 돈다.
     */
    this._surfQ = new Quaternion();
    this._surfUp = new Vector3();
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
    this.applyLean();
  }

  // ── construction ───────────────────────────────────────────────────────────

  /** Throw the meshes away and build them again from `tuning.profile`. */
  rebuild() {
    const profile = buildBottleProfile(this.tuning.profile);
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
    this.cap.position.set(
      0,
      profile.height * MM - capHeight + this.tuning.capLift * MM + this._centreOffset,
      0,
    );

    this._mouthLocal.set(0, profile.height * MM + this._centreOffset, 0);
    this._baseLocal.set(0, this._centreOffset, 0);

    const surface = liquid.userData;
    const pos = liquid.getAttribute('position');
    this._surfaceBase = { attr: pos, normal: liquid.getAttribute('normal'), ...surface };

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

  _swap(mesh, geometry) {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    if (old && old !== geometry) old.dispose();
  }

  /**
   * Re-read the lean from `tuning`, and refresh the axis the shake runs along.
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
   * It is still not a spin. It happens once, over the third of a second the
   * carbonation takes to climb, it is driven by that same envelope, and it
   * unwinds when the bottle settles. At rest the bottle does not rotate at all,
   * and the SHAKE adds no rotation either — that is still pure axial travel.
   */
  applyLean(aim = this._aim) {
    const t = this.tuning;
    const deg = (d) => (d * Math.PI) / 180;
    // Eased at both ends so the turn starts and stops rather than snapping into
    // and out of the aimed pose.
    const a = aim * aim * (3 - 2 * aim);
    const leanZ = t.leanZ + (t.aimLeanZ - t.leanZ) * a;
    const leanX = t.leanX + (t.aimPitch - t.leanX) * a;

    const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), deg(leanZ));
    const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), deg(leanX));
    const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(t.faceYaw));
    this.lean.quaternion.copy(qz).multiply(qx).multiply(qy);
    this._q.copy(this.lean.quaternion);
    this._localUp.set(0, 1, 0).applyQuaternion(this._q);
  }

  // ── per frame ──────────────────────────────────────────────────────────────

  /**
   * @param {number} dt
   * @param {object} state
   * @param {number} state.shake  0 at rest, 1 at the peak of stage 1
   * @param {number} state.aim    1 while a run is playing out, 0 otherwise
   * @param {import('three').Camera} state.camera  for billboarding the fizz
   */
  update(dt, { shake = 0, aim = 0, camera } = {}) {
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

    // ── the shake ────────────────────────────────────────────────────────────
    // Along `_localUp`, which is the bottle's own axis. See the header.
    const wobble =
      shake > 0
        ? Math.sin(this._clock * Math.PI * 2 * t.shakeFrequency) * t.shakeAmplitude * shake
        : 0;
    this._shake = wobble;

    this.root.position.set(
      t.originX + drift + this._localUp.x * wobble,
      t.originY + rise + this._localUp.y * wobble,
      this._localUp.z * wobble,
    );

    /**
     * Under the BASE of the bottle, not under its middle.
     *
     * The lean turns the bottle about its own centre, so a bottle leaning
     * nineteen degrees has its base a third of its half-height off to one side
     * — three whole units here. A shadow parked under the centre therefore sits
     * beside the bottle rather than under it, which is exactly what the first
     * version looked like. Asking the lean where the base actually ended up
     * costs one vector rotation and cannot drift out of agreement with it.
     *
     * It tracks the horizontal drift and not the rise, because it is on the
     * floor. It does shrink a little as the bottle goes up, which is the whole
     * of the height cue and costs one multiply.
     */
    this._scratch.copy(this._baseLocal).applyQuaternion(this.lean.quaternion);
    this.shadow.position.set(this.root.position.x + this._scratch.x, t.floorY + 0.02, this._scratch.z);
    const lift = 1 - (rise + wobble * this._localUp.y) * t.shadowLift;
    const r = this.profile.params.bodyRadius * MM * t.shadowScale * lift;
    this.shadow.scale.set(r, r, 1);

    this._slosh(dt, shake);
    this._carbonate(dt, shake);
    this.fizz.update(dt, {
      intensity: Math.max(shake, this._foam),
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
   * hand and nothing tracks the shake directly — a head that rose and fell with
   * each individual wobble would read as a level meter, and shaking a bottle
   * does not do that. It makes foam, and foam does not go back in.
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
  _carbonate(dt, shake) {
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
     * That single line is most of what makes a shaken bottle look like a shaken
     * bottle, and no hand-authored curve was going to find it by accident.
     *
     * Production tracks entrained gas; drainage is constant, so when the
     * shaking stops the net goes negative and the head sinks back down — fast
     * in the neck and slowly in the body, for the same reason and by the same
     * arithmetic.
     */
    const r = Math.max(0.05, this.profile.envelopeAt(this._foamTop / MM) * inset * MM);
    const area = Math.PI * r * r;
    const production = shake * t.foamProduction + this._pop * t.foamPopSurge;
    this._pop = Math.max(0, this._pop - dt / Math.max(0.01, t.foamPopSeconds));
    const net = production - t.foamDrain;

    this._foamTop = Math.max(fillY, Math.min(ceilY, this._foamTop + (net * dt) / area));
    // 0..1 across the head's travel, for everything that wants "how worked up
    // is this bottle" rather than a height.
    this._foam = (this._foamTop - fillY) / Math.max(1e-4, ceilY - fillY);

    const active = this._foam > 0.002;
    this.foam.visible = active;
    if (!active) return;

    // Churn. Faster while it is actually being shaken.
    this._foamScroll -= dt * t.foamScrollSpeed * (0.5 + shake);
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
    const base = this._surfaceBase;
    const surfAttr = base?.attr;
    const surfRim = base?.surfaceRim;
    const surfCols = base?.surfaceCols ?? cols;
    const kx = this._surfKx ?? 0;
    const kz = this._surfKz ?? 0;
    const ceil = (this.profile.height - 2) * MM;
    const clampY = (v) => Math.max(2 * MM, Math.min(ceil, v));

    const headR = this.profile.envelopeAt(topY / MM) * inset * MM;

    for (let i = 0; i <= cols; i++) {
      const th = (i / cols) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);

      // 이 컬럼에서 액면이 어디 있는가. 없으면(액면 링이 아직 없으면) 채움 높이.
      let footY = fillY;
      let footR = this.profile.envelopeAt(fillY / MM) * inset * MM;
      if (surfAttr && surfRim !== undefined) {
        const v = surfRim + (i % surfCols);
        const sx = surfAttr.getX(v);
        const sz = surfAttr.getZ(v);
        footY = surfAttr.getY(v);
        footR = Math.hypot(sx, sz);
      }

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
   * The fill line, sloshing at its OWN frequency.
   *
   * ── the liquid is an oscillator, not a follower ─────────────────────────
   * The first version drove the surface directly off the shake, at the shake's
   * frequency. That is wrong in a way you can feel: a liquid in a container has
   * a natural sloshing frequency of its own, it responds to being driven rather
   * than copying the drive, and it keeps going after the driving stops. Copying
   * the drive makes the surface look welded to the bottle.
   *
   * The fundamental (m = 1) mode in a cylinder is
   *
   *     omega^2 = g (eps/R) tanh(eps h / R),     eps = 1.8412
   *
   * — eps being the first zero of J1', the derivative of the first-order Bessel
   * function. For this bottle, R about 2.8 units and h about 14, that lands at
   * roughly 4 Hz, against a shake at seventeen. So the surface moves at a
   * quarter of the rate the bottle does, which is exactly the lag you see when
   * someone shakes a bottle in front of you, and it could not possibly have
   * come out of driving it at the shake frequency.
   *
   * It is integrated as a damped driven oscillator, sub-stepped so a slow frame
   * cannot make it explode — omega * dt already reaches 1.3 at the loop's 50 ms
   * clamp, which is past where semi-implicit Euler stays well behaved.
   *
   * ── the mode is a TILT, not a two-lobed wave ────────────────────────────
   * m = 1 is the surface tipping like a saucer: high on one side, low on the
   * other, still in the middle. The earlier `sin(2 theta)` was the m = 2 mode,
   * which is a real mode but not the one that dominates, and it read as the
   * drink rippling rather than swaying.
   *
   * ── and the drive comes from the LEAN ───────────────────────────────────
   * A perfectly vertical shake excites no tilt at all — it is symmetric about
   * the axis. This bottle is leaning, so shaking it along its own axis has a
   * horizontal component of sin(lean), and THAT is what tips the drink. The
   * coupling falls out of the geometry rather than being asserted, and it means
   * standing the bottle upright would correctly calm the surface down.
   */
  _slosh(dt, shake) {
    const base = this._surfaceBase;
    if (!base || !base.surfaceCols) return;

    const t = this.tuning;
    const p = this.profile.params;
    const R = Math.max(0.2, this.profile.envelopeAt(p.fillLevel) * p.liquidInset * MM);
    const h = Math.max(0.2, p.fillLevel * MM);
    const k = 1.8412 / R;
    const omega = Math.sqrt(G_WORLD * k * Math.tanh(k * h));

    /**
     * ── the drive is the STROKE, not the rattle ────────────────────────────
     * Driving this at the shake's own 17 Hz produced almost nothing, and that
     * is not a bug — it is the answer. 17 Hz is nearly seven times the drink's
     * natural 4 Hz, and a linear oscillator driven far above resonance responds
     * as F/omega_d^2, which here is a fiftieth of what it would give at
     * resonance. A high-frequency rattle genuinely does not slosh a bottle.
     *
     * What sloshes a bottle is the arm. Shaking one is a stroke of a few hertz
     * with the rattle riding on top, and a few hertz is right on top of the
     * drink's own mode — which is precisely WHY shaking works, and why you
     * instinctively shake at that rate rather than faster. So the drive is at
     * `strokeFrequency`, the resonance does the amplifying, and the shake's own
     * frequency stays what it always was: the bottle's motion, not the drink's.
     *
     * Horizontal share from the current lean: `_localUp` is the bottle's axis
     * in world space, so its horizontal length IS sin(lean). Stand the bottle
     * upright and the drive correctly goes to zero — an axial shake of an
     * upright cylinder is symmetric and cannot excite a tilt.
     */
    const tipping = Math.hypot(this._localUp.x, this._localUp.z);
    const drive =
      shake * t.sloshDrive * tipping * Math.sin(this._clock * Math.PI * 2 * t.strokeFrequency);

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
     * 여기서 출렁임만 쓰고 있었다. 출렁임은 평형면 **둘레의** 진동이라 그것만으로는
     * 부족했다 — 평형면 자체가 병의 축에 수직이었기 때문이다. 병이 22도 기울면
     * 액면도 22도 기울어 따라갔고, 그건 액체가 아니라 병 안에 굳어 있는 것이다.
     *
     * 평형면은 중력에 수직인 평면, 즉 월드에서 수평인 평면이다. 병의 로컬 좌표계
     * 에서 그 평면을 구하려면 월드의 위쪽 벡터를 로컬로 가져오면 된다:
     *
     *     up · (P - C) = 0,   C = 액면 중심 (0, y0, 0)
     *     -> y = y0 - (up.x * x + up.z * z) / up.y
     *
     * `up` 은 액체 메시의 **월드** 쿼터니언을 뒤집어 얻는다. 조상 전부가 계산에
     * 들어가야 하기 때문이다 — 기울기(`lean`)만 쓰면 뜨는 동작이나 흔들림이 축을
     * 돌릴 때 액면이 그만큼 어긋난다.
     *
     * `up.y` 가 0 에 가까우면 병이 눕는다는 뜻이고 그때는 수평면이 병을 가로지르지
     * 않는다. 여기서는 일어나지 않지만(최대 기울기가 22도) 0 으로 나누는 자리를
     * 남겨 둘 이유는 없다.
     */
    this.liquid.getWorldQuaternion(this._surfQ);
    this._surfUp.set(0, 1, 0).applyQuaternion(this._surfQ.invert());
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
     * 떠 있고 다른 쪽은 액체에 잠긴다. 사용자가 "요소를 겹쳐서 이중으로" 라고
     * 지적한 것이 그 상태다.
     */
    this._surfKx = kx;
    this._surfKz = kz;

    /**
     * 액면이 유리 밖으로 나가지 않게 묶는다.
     *
     * 기울어진 수평면의 높은 쪽은 `r * tan(기울기)` 만큼 올라간다. 22도에 반지름이
     * 액면 높이에서 16 프로파일 단위면 6.5 단위이고 병 높이 안에 들어가지만,
     * `fillLevel` 을 패널에서 올리면 목을 뚫고 나갈 수 있다. 위아래 모두 묶는다 —
     * 아래로 뚫으면 옆벽이 액면 위로 삐져나온다.
     */
    const ceil = (this.profile.height - 2) * MM;
    const floorY = 2 * MM;

    /**
     * ── 링의 반지름은 **높이를 따라간다**. 이것이 빠져서 액면이 유리를 뚫었다 ──
     * 처음에는 y 만 기울이고 반지름은 원래 액면 높이에서 잰 값 하나로 두었다. 병이
     * 원통이면 그래도 맞지만 이 병에는 어깨가 있다 — `fillLevel` 150 근처에서
     * 반지름이 프로파일 14 단위마다 눈에 띄게 줄어든다. 수평면이 한쪽을 올리고
     * 다른 쪽을 내리면, 올라간 쪽은 병이 좁아진 자리에 넓은 원이 놓여 **유리를 뚫고
     * 나오고** 내려간 쪽은 벽에서 떨어져 틈이 생긴다.
     *
     * 실측: 34도로 기울인 병에서 액면이 유리 오른쪽으로 검은 쐐기처럼 튀어나왔다.
     *
     * 그래서 컬럼마다 (r, y) 두 개를 함께 푼다:
     *
     *     y = y0 + (kx*cos + kz*sin) * r      수평면 위에 있을 것
     *     r = envelope(y) * liquidInset       유리 안쪽 벽에 닿아 있을 것
     *
     * 두 식의 교점이고, 감쇠를 준 고정점 반복으로 푼다 — 어깨에서는 dr/dy 가 커서
     * 감쇠 없이는 진동한다.
     */
    const inset = p.liquidInset;
    const y0 = base.surfaceY;
    const clampY = (v) => Math.max(floorY, Math.min(ceil, v));
    /**
     * ── 반복은 수렴하지 않을 수 있다. 그래서 마지막에 **자른다** ─────────────
     * 0.6 완화로 6번 돌렸다. 원통이면 넉넉하고 어깨에서는 아니다: 낮은 쪽
     * (`dir < 0`)에서 r 이 커지면 y 가 내려가고, 내려가면 포락선이 **커진다**.
     * 그 되먹임의 이득은 |envelope'| · inset 이고 어깨에서는 그것이 1 을 넘는다 —
     * 반복이 발산한다.
     *
     * 실측: fill 150 · 기울기 22도에서 액면 테가 어깨 왼쪽에서 유리를 뚫고
     * 나왔다. 사용자가 "액체가 살짝 삐져나온다" 고 한 것이 그것이다.
     *
     * 완화를 낮추고(0.35) 횟수를 늘려(12) 발산을 늦추지만, 그것만으로는 보장이
     * 아니다. 보장은 마지막 줄이다: **자기 높이에서의 벽보다 넓을 수 없다.**
     * 수렴하지 못하면 모자란 쪽으로 남고, 벽과 액체 사이의 가는 틈은 벽을 뚫고
     * 나온 테보다 언제나 덜 보인다.
     */
    const solve = (dir) => {
      let r = base.surfaceRadius ?? 0;
      for (let n = 0; n < 12; n++) {
        const yy = clampY(y0 + dir * r);
        const want = this.profile.envelopeAt(yy / MM) * inset * MM;
        r += (want - r) * 0.35;
      }
      const y = clampY(y0 + dir * r);
      const wall = this.profile.envelopeAt(y / MM) * inset * MM;
      return { r: Math.max(0, Math.min(r, wall)), y };
    };

    /**
     * 링이 **둘**이다: 부채꼴의 테두리와 옆벽 맨 윗줄. 같은 각도, 같은 자리, 다른
     * 정점. 하나만 움직이면 벽 끝이 액면 위로 삐져나오거나 사이가 벌어진다.
     * `bottleGeometry` 의 `wallTopRim` 주석에 왜 둘인지 적혀 있다.
     *
     * y 만이 아니라 x·z 도 쓴다. 반지름이 컬럼마다 다르므로 링은 더 이상 원이
     * 아니고, y 만 옮기면 반지름이 옛 값 그대로 남는다 — 그게 유리를 뚫던 원인이다.
     */
    const attr = base.attr;
    const wall = base.wallTopRim;
    for (let i = 0; i < base.surfaceCols; i++) {
      const th = (i / base.surfaceCols) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const { r, y } = solve(kx * c + kz * sn);
      // 출렁임은 수평면 **위에** 얹힌다. 기울기와 같은 축을 돌므로, 기울어진 병에서
      // 술이 낮은 쪽으로 몰리지 아무 상관 없는 쪽으로 몰리지 않는다.
      const yy = clampY(y + c * amp);
      /**
       * 출렁임이 y 를 옮겼으면 반지름도 **다시** 자른다.
       *
       * `solve` 가 (r, y) 한 쌍을 풀고 벽에 맞춰 잘라 주지만, 그 뒤에 `amp` 가
       * y 를 위아래로 밀면 그 짝이 깨진다. 위로 밀린 쪽은 병이 좁아진 자리에
       * 넓은 원이 놓이고, 그게 유리를 뚫는다.
       *
       * 정지 상태에서는 `amp` 가 0 이라 아무 일도 없다. 그래서 앞선 수정으로도
       * 멈춰 있는 병은 멀쩡했고, 흔들리는 동안에만 아주 살짝 삐져나왔다 —
       * 사용자가 "자꾸 아주 살짝" 이라고 한 것이 그 상태다. 실측으로 최대
       * 0.5 mm.
       */
      const rr = Math.min(r, this.profile.envelopeAt(yy / MM) * inset * MM);
      attr.setXYZ(base.surfaceRim + i, rr * c, yy, rr * sn);
      if (wall !== undefined) attr.setXYZ(wall + i, rr * c, yy, rr * sn);
    }
    // 가운데는 기울기의 피벗이다. 수평면도 출렁임도 여기서는 0 이므로 움직이지
    // 않고, 그것이 이것을 기울기로 만든다 — 액면 전체가 위아래로 까딱이는 것이 아니라.
    attr.setY(base.surfaceCentre, base.surfaceY);
    attr.needsUpdate = true;

    /**
     * 부채꼴의 법선도 수평면을 따라간다.
     *
     * 위치만 기울이면 법선은 여전히 로컬 +Y 를 가리키고, 그건 병의 축이지 위쪽이
     * 아니다. 조명이 액면을 병의 기울기대로 비추게 되어, 기울일수록 액면이 어두워
     * 지거나 밝아진다 — 표면은 그대로인데 빛만 도는 것으로 보인다.
     */
    const nor = base.normal;
    if (nor) {
      const nx = this._surfUp.x;
      const ny = this._surfUp.y;
      const nz = this._surfUp.z;
      nor.setXYZ(base.surfaceCentre, nx, ny, nz);
      for (let i = 0; i < base.surfaceCols; i++) nor.setXYZ(base.surfaceRim + i, nx, ny, nz);
      nor.needsUpdate = true;
    }
  }

  // ── the burst at the mouth ─────────────────────────────────────────────────

  /**
   * Fire the two-frame spray. Called once, when the cap leaves.
   *
   * It also slams the pressure to full, so the head is at the top of the neck
   * on the frame the cap goes rather than wherever the shake happened to have
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

  /** Hide the cap at the moment it becomes the wipe's cap. */
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

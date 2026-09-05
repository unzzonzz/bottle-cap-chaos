import { Color, Group, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { GlossMaterials } from '../core/GlossMaterial.js';
import { createEnvironment } from '../core/environment.js';
import { createLightRig } from '../core/lighting.js';
import { createWater } from './water.js';
import { SubmergedTitle } from './SubmergedTitle.js';
import { setTextureRenderer } from '../core/textures.js';
import {
  onQualityChange,
  refreshShadowCasters,
  SHADOW_RANK,
  tagShadow,
} from '../core/quality.js';
import { DISPLAY_ASPECT, Viewport } from '../core/Viewport.js';
import { SceneComposer } from '../core/Composer.js';
import { FRAME, MIN_FRAME_ASPECT, frameScale } from '../core/frame.js';
import { aimedLaunchDirection, Bottle } from './Bottle.js';
import { PALETTE, withAlpha } from '../core/palette.js';
import { whenFontsReady } from '../ui/fonts.js';
import { clearLegacyStorage } from '../core/legacyStorage.js';
import { CapWipe, WIPE_FRAME } from '../core/CapWipe.js';
import { MenuItems } from './MenuItems.js';
import { SettingsScene } from './SettingsScene.js';
import { OpponentScene } from './OpponentScene.js';
import { MarksScreen } from '../marks/MarksScreen.js';
import { BRUSH_SIZES, MarkEditor, MARK_SWATCHES } from '../marks/MarkEditor.js';
import { ConfirmDialog } from '../marks/ConfirmDialog.js';
import { MarkBook } from '../marks/MarkBook.js';
import { LocalStorageMarks } from '../marks/MarkStorage.js';
import { LocalStorageNicknames, Profile } from '../profile/NicknameStorage.js';
import { OnlineScene } from './OnlineScene.js';
import { CollectionScene } from './CollectionScene.js';
import { ModalLayer } from '../ui/ModalLayer.js';
import { DEFAULT_MARK } from '../marks/MarkStorage.js';
import { STAGE, Transition } from './Transition.js';
import { MENU_CONFIG } from './menuConfig.js';
import { capLogoTexture } from './menuTextures.js';
import { destinationUrl, placeOf, prefetch } from './menuRoutes.js';
// What counts as a mode, from the one place that decides it. See `swapTo`.
import { MODES } from '../game/modes.js';
// The audio mix lives with every other tunable, in the one CONFIG the panel
// edits. `MENU_CONFIG` is this page's own layout numbers and nothing else.
import { CONFIG } from '../game/config.js';
import { bootMenuDebug } from './MenuDebug.js';
import { MenuAudio } from '../audio/MenuAudio.js';

/**
 * The main menu, on the same pipeline as everything else.
 *
 * ── the render order, and why it is this one ────────────────────────────────
 *
 *     camera.layers.set(WORLD)         물, 병, 액체, 기포
 *     composer.render()                MSAA target -> bloom -> canvas
 *     camera.layers.set(UI)            the plates, unbloomed
 *     clearDepth(); render(scene)
 *     modal.render(); wipe.render()        their own overlay scenes
 *
 * That is `main.js`'s arrangement with one addition: here the plates are WORLD
 * objects rather than a separate scene, so the split between what bloom touches
 * and what it does not is done with layers instead. See `asUiLayer`.
 *
 * The letterbox is last, over the modal included, for the reason the cap wipe
 * was before it: it has the screen while it runs, and what it hands over to is
 * the other document.
 *
 * ── two ways out, and only one of them is a navigation ──────────────────────
 * 설정 swaps scene roots in place, so the whole run happens in one continuous
 * sequence of frames. The two game modes cannot: the game owns its own renderer
 * and its own Rapier world, and there is no honest way to host that inside this
 * page without rebuilding `main.js` around it. So they hand over — at the
 * covered frame, with the destination already prefetched.
 *
 * Nothing repaints the page for that hand-over any more, and its absence is the
 * fix rather than an omission. The bars close to `PALETTE.bg.skyTop`, which is
 * already `--msa-void` — the colour the stylesheet paints the document and the
 * browser paints around a letterboxed canvas. So the covered frame, the gap
 * between the two documents and the game page's first frame are all the same
 * colour without anybody assigning it. See `core/Cinematic.js`.
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{audio?: import('../audio/AudioSystem.js').AudioSystem,
 *          audioSettings?: import('../audio/AudioSettings.js').AudioSettingsBook,
 *          graphicsSettings?: import('../core/GraphicsSettings.js').GraphicsSettingsBook,
 *          viewSettings?: import('../core/ViewSettings.js').ViewSettingsBook}} [deps]
 *   All three are built once in `main.js`, before the branch that chose this
 *   page — see the note there. Absent, every call below is optional-chained and
 *   the menu is exactly what it was.
 *
 *   그래픽만 성질이 조금 다르다: 티어는 `main.js` 가 이미 `configureQuality` 로
 *   `core/quality.js` 에 꽂아 두었으므로 **파이프라인은 이 인자가 없어도 맞다.**
 *   여기 넘기는 것은 설정 화면이 고르게 하기 위한 모델이지, 렌더러가 값을 받는
 *   경로가 아니다.
 */
/**
 * Which layer an object is drawn on, and therefore whether bloom touches it.
 *
 * ── the menu's UI lives in the WORLD scene, unlike the match page's ─────────
 * On the match page the HUD, the cards and the victory screen are separate
 * scenes with their own orthographic cameras, so keeping them out of the bloom
 * chain is just a matter of rendering them afterwards. Here the plates ARE world
 * objects: real quads in the perspective scene, sitting in front of the bottle,
 * because that is what gives them the slight yaw and the hover shift that make
 * them read as panels standing in a room.
 *
 * So the separation is done with layers instead of scenes. The world draws on
 * layer 0 through the bloom chain, the plates draw on layer 1 straight to the
 * canvas afterwards, and one camera serves both by having its mask flipped
 * between the two passes.
 *
 * Without this the four menu plates — which are white, and therefore about as
 * far above the bloom threshold as a surface can be — merge into one glowing
 * block and the labels on them stop being readable. That is the exact failure
 * §0.4 names: bloom must not bleed into UI text.
 */
const WORLD_LAYER = 0;
const UI_LAYER = 1;

/** Put an object and everything under it on the no-bloom layer. */
function asUiLayer(root) {
  root.traverse((o) => o.layers.set(UI_LAYER));
  return root;
}

export function bootMenu(
  canvas,
  { audio = null, audioSettings = null, graphicsSettings = null, viewSettings = null } = {},
) {
  const cfg = MENU_CONFIG;

  /**
   * This canvas is the menu's, not a match's.
   *
   * The two pages share `#view` and share `styles.css`, and the base cursor
   * there is `grab` because on the game page the default press moves the
   * camera. Nothing on the menu is draggable except the mark editor's
   * turntable, so the menu opts out and names its own cursors — see `setCursor`
   * and the `.is-menu` block in the stylesheet.
   */
  canvas.classList.add('is-menu');

  // ── pipeline ─────────────────────────────────────────────────────────────
  // Portrait, like the match page. The menu has no board to keep square, so it
  // simply takes the window's shape and the arrangement below stacks instead of
  // sitting side by side. See src/core/frame.js.
  const viewport = new Viewport({ canvas });
  setTextureRenderer(viewport.renderer);
  const retro = new GlossMaterials();

  /**
   * The environment every reflective surface samples.
   *
   * Built once, from the palette, and handed to the material factory rather than
   * to the scene: `scene.environment` would only reach THIS scene, and the caps
   * also appear in the victory sequence and the match-found layer,
   * each of which owns its own scene. Setting it per material covers all of them
   * from one place.
   */
  createEnvironment(viewport.renderer, retro);


  // Same fire-and-forget as `main.js`: the menu bakes its plates into cached
  // canvas textures too, and this is what stops them being baked in the
  // fallback face and kept.
  whenFontsReady();

  // `main.js` 와 같은 이유로 여기서도 부른다. 지우는 연산이라 두 번 해도 같다.
  clearLegacyStorage();

  const scene = new Scene();
  /**
   * 게임 페이지와 같은 하늘과 같은 조명 리그.
   *
   * 캡 와이프가 두 document 사이를 잇는데, 양쪽 조명이 다르면 전환 직후 병뚜껑의
   * 밝기가 튄다. 같은 모듈을 쓰는 게 두 화면이 같은 장면이라는 유일한 보장이다.
   *
   * 메뉴에는 필드가 없으므로 그림자 프러스텀은 병 하나를 덮을 만큼만 준다.
   */
  /**
   * 배경은 하늘이 아니라 **물**이다.
   *
   * 메뉴의 구조가 바뀌었다 — 하늘 돔 아래 병이 뜬 그림에서, 화면 전체가 물이고
   * 제목이 그 아래 잠긴 그림으로. `core/sky.js` 는 게임 문서와 공유하므로 손대지
   * 않았다: 거기를 물로 바꾸면 판 위의 하늘까지 물이 된다.
   *
   * 인터페이스가 같아서 되돌리는 것은 이 한 줄이다.
   */
  const water = createWater(scene);
  const lights = createLightRig(scene);
  lights.setExtents({ x: 26, z: 26 });

  /**
   * 티어가 바뀌었을 때 이 문서가 직접 해야 하는 것: 씬의 그림자 캐스터.
   *
   * `main.js` 의 같은 자리와 같은 이유다 — 씬을 아는 쪽만 할 수 있다. 이 화면에서
   * 그림자를 던지는 것은 병 하나뿐이지만, 그 하나가 최저·낮음에서 사라지고
   * 보통 이상에서 돌아오는 것이 여기서 처리된다.
   */
  onQualityChange(() => refreshShadowCasters(scene));

  const camera = new PerspectiveCamera(cfg.camera.fov, DISPLAY_ASPECT, 1, 400);

  /**
   * The menu's own bloom chain. Same parameters as the match page's, so the two
   * sides of the letterbox are the same picture — see `MENU_CONFIG.view.bloom`.
   */
  const composer = new SceneComposer({ viewport, scene, camera, bloom: cfg.view.bloom });

  /**
   * The authored arrangement, kept because `applyArrangement` overwrites it.
   *
   * `cfg.items` is scaled in place on every resize, so the authored numbers have
   * to survive somewhere or the second resize scales an already-scaled value and
   * the column walks itself to nothing.
   */
  /**
   * How far the camera has been pulled back to hold the visible WIDTH.
   *
   * Written by `placeCamera`, read by the per-frame camera placement and by
   * `unitsPerPixel`. It has to be shared: the frame loop sets `camera.position`
   * every frame from `cfg.camera.distance`, so a pull-back applied only in
   * `placeCamera` is undone before the first frame is drawn — which is exactly
   * why the bottle stayed enormous after the aspect was fixed.
   */
  let camWiden = 1;

  const LANDSCAPE_POSE = {
    originX: cfg.bottle.originX,
    originY: cfg.bottle.originY,
    shadowDrop: cfg.bottle.shadowDrop,
    columnX: cfg.items.columnX,
    columnY: cfg.items.columnY,
    plateWidth: cfg.items.plateWidth,
    plateHeight: cfg.items.plateHeight,
    pitch: cfg.items.pitch,
  };

  /**
   * 항목 열은 프레임에 비례한다. 640 에서 저술한 값을 그 비율로 줄인다.
   *
   * ── 실측: 판이 화면 밖으로 나가고 있었다 ────────────────────────────────
   * `plateWidth` 256, `columnX` 132 은 640 폭 프레임 기준이다. 그 프레임의 반폭은
   * 320 이라 판은 x 4..260 을 쓰고 넉넉히 들어간다. 그런데 800x459 창의 프레임은
   * 421 폭이고 반폭은 210 이다 — 판의 오른쪽 50 픽셀이 화면 밖이었다.
   *
   * 각진 흰 판일 때는 오른쪽 가장자리가 원래 안 보여서 티가 안 났다. 젤 버튼은
   * 모서리가 둥글어서 그게 없어진 것이 바로 보인다.
   *
   * 비례로 줄이면 판은 어느 프레임에서나 폭의 같은 비율(40%)을 차지한다. 화면
   * CSS 픽셀로 치면 늘 같은 크기라는 뜻이고, 그게 메뉴가 원하는 것이다. "텍셀
   * 하나가 픽셀 하나" 라는 옛 제약은 이제 없다 — 밉맵과 선형 필터가 켜져 있고
   * 알파 이진화는 PHASE 1 에 사라졌다. 대신 `PLATE_TEXEL_SCALE` 로 판 자체를 두
   * 배 해상도로 굽는다.
   */
  function scaleColumn() {
    const k = frameScale();
    cfg.items.plateWidth = Math.round(LANDSCAPE_POSE.plateWidth * k);
    cfg.items.plateHeight = Math.round(LANDSCAPE_POSE.plateHeight * k);
    cfg.items.pitch = Math.round(LANDSCAPE_POSE.pitch * k);
    return k;
  }

  /**
   * The authored pose, rescaled to whatever width the frame resolved to.
   *
   * ── there was a second arrangement here ─────────────────────────────────────
   * A `tall` branch stacked the bottle above the column instead of placing it
   * left of one, for a portrait phone where the side-by-side layout squeezed
   * both into a narrow half. `FRAME.tall` was the switch and it is gone with the
   * band system — 4:3 is the frame's NARROWEST shape now (정책 C widens it up to
   * 16:9 and never past it in the other direction), so the stacked pose could
   * never be reached again and a pose nothing can reach is a pose that will be
   * wrong the next time the tokens move. Side by side gets BETTER as the frame
   * widens, which is what the wide-window screenshots show.
   *
   * `u` is still taken: `scaleColumn` is about to make the plates smaller and
   * the caller has already computed the units-per-pixel that goes with them.
   */
  function applyArrangement(_u) {
    const k = scaleColumn();
    Object.assign(cfg.bottle, {
      originX: LANDSCAPE_POSE.originX,
      originY: LANDSCAPE_POSE.originY,
      shadowDrop: LANDSCAPE_POSE.shadowDrop,
    });
    cfg.items.columnX = Math.round(LANDSCAPE_POSE.columnX * k);
    cfg.items.columnY = Math.round(LANDSCAPE_POSE.columnY * k);
  }

  // ── contents ─────────────────────────────────────────────────────────────
  /**
   * 재질별 클리핑을 켠다. `Bottle` 의 액면이 클립 평면이다.
   *
   * 전역 스위치이고 렌더러는 게임과 공유하는 물건이므로 어디서 켜는지가 중요하다.
   * 여기가 맞는 자리인 이유: 문서는 메뉴이거나 게임이지 둘 다가 아니고
   * (`main.js` 가 갈라 놓는다), 이 줄은 메뉴 문서에서만 실행된다.
   *
   * 켜도 클립 평면이 없는 재질은 값을 치르지 않는다 — three 는 재질마다
   * 평면 수를 세고, 0 이면 `NUM_CLIPPING_PLANES` 가 0 이라 그 분기 전체가
   * 전처리기에서 사라진다. 실측으로도 프레임 시간 차이가 측정 오차 안이었다.
   */
  viewport.renderer.localClippingEnabled = true;

  const bottle = new Bottle({ retro, tuning: cfg.bottle });
  const items = new MenuItems({ retro, tuning: cfg.items });

  /**
   * ── the floor is gone, and the pool of light with it ────────────────────
   * There was a 30x30 quad lying flat under the bottle with a bright radial
   * wash printed on it — "the one light in the room, and the bottle is what it
   * is lighting". It read well and it was a FLOOR, which is exactly what §6.2
   * takes away: the bottle hangs in space, there is nothing under it, and a
   * pool of light on nothing is a hole in the picture. Measured on screen it
   * was also the brightest thing in the menu by a distance, past the bloom
   * threshold, so the bottom third of the frame was a white blur.
   *
   * What replaces it is the SEA — `core/sky.js` draws the world below the
   * horizon now, so the lower half of the menu has somewhere to be without
   * anything being placed there. `floorPoolTexture` is still exported and has
   * no caller; it is left for the moment because the victory screen's own wash
   * may want it, and PHASE 5 is where that is decided.
   */
  const menuRoot = new Group();
  /**
   * 병은 그림자를 던지고 바닥은 받는다.
   *
   * `bottle.shadow` 는 손으로 그린 타원 스프라이트인데, 그걸 지우지 않는 이유는
   * 병이 공중에 떠 있기 때문이다 — 실제 그림자는 바닥의 광원 반대편에 생기지만
   * 이 연출의 그림자는 "병이 떠 있다"를 말하려고 병 바로 아래에 있다. 둘은 다른
   * 일을 한다.
   */
  /**
   * 병은 여전히 그림자를 던진다 — **받을 것이 없을 뿐이다.**
   *
   * 태그를 남기는 이유는 티어 시스템이 이 목록으로 캐스터를 세기 때문이고
   * (`core/quality.refreshShadowCasters`), 던지는 쪽이 목록에서 빠지면 게임
   * 화면으로 넘어갔을 때 등급이 어긋난다. `bottle.shadow` 는 손으로 그린 타원
   * 스프라이트이고 그것이 이 화면의 유일한 그림자다 — 실제 그림자는 광원 반대편에
   * 생기지만, 이 연출의 그림자는 "병이 떠 있다" 를 말하려고 병 아래 멀리 있다.
   */
  bottle.root.traverse((o) => {
    if (o.isMesh) tagShadow(o, SHADOW_RANK.HERO);
  });
  // The shadow and the burst are siblings of the bottle rather than children of
  // it: one is placed by a world position every frame and the other hangs a
  // fixed distance below. Parenting either would add the float to it twice.
  /**
   * 물에 잠긴 제목. 병보다 **뒤**에 그린다.
   *
   * `renderOrder -500` 은 물(-1000)과 나머지 사이다. 글자가 병 앞에 오면 병이
   * 종이에 인쇄된 것이 되고, 이 화면에서 병은 물 속의 물건이다.
   */
  const title = new SubmergedTitle({ unitsPerPixel: unitsPerPixel() });
  /** 지난 프레임의 정규화 포인터. 물을 젓는 것은 그 차이다. */
  const lastPointerN = { x: 0, y: 0 };
  /**
   * 제목은 **월드 레이어**에 둔다. `asUiLayer` 를 씌우지 않는다.
   *
   * UI 레이어는 월드가 다 그려진 뒤 별도 패스로 올라간다. 거기 두면 제목이 병
   * **앞**에 오고, 그러면 병이 글자에 인쇄된 것이 된다 — 이 화면에서 병은 물
   * 속의 물건이고 글자는 그보다 더 깊은 곳에 있다.
   *
   * 월드에 있으므로 **블룸도 받는다.** 그래서 잉크를 순백이 아니라 옅은 파랑으로
   * 잡았다 — 처음에 흰색으로 두었더니 글자가 통째로 타서 흰 덩어리가 됐다.
   * UI 레이어가 존재하는 이유는 크기가 아니라 휘도였고, 그 문제는 레이어를
   * 바꾸는 것이 아니라 값을 임계 아래로 내려서 푼다. `SubmergedTitle` 의
   * `uTint` 주석에 수치가 있다.
   */
  menuRoot.add(title.root, bottle.root, bottle.shadow, bottle.burst, asUiLayer(items.root));
  scene.add(menuRoot);

  let settings = null;
  /** 컬렉션. 처음 열 때 만든다 — 나머지 화면과 같은 규칙이다. */
  let collection = null;
  /**
   * 내 마크, and the things it needs.
   *
   * The book is built eagerly because the menu bottle wears whatever P1 has
   * chosen and therefore needs the answer before its first frame; the SCREEN is
   * built on first entry, like the settings scene, because most sessions never
   * open it. `LocalStorageMarks` is the only place in the menu that names a
   * storage implementation — everything downstream takes a `MarkStorage`.
   */
  const markBook = new MarkBook(new LocalStorageMarks());
  /**
   * This player's name and preferred relay.
   *
   * Constructed here and in `main.js`, and nowhere else — the same discipline
   * `LocalStorageMarks` follows one line up. Everything downstream takes a
   * `Profile`, which is the seam an account system replaces.
   */
  const profile = new Profile(new LocalStorageNicknames());

  /**
   * Every typed-in or asked question on this document, drawn as geometry.
   *
   * Handed to the screens rather than reached for by them: a scene that
   * imported its own dialog would be a second one to keep in step, and this one
   * has to be RENDERED — which only this file can arrange, because only this
   * file owns the pass order.
   */
  const modal = new ModalLayer({ canvas, config: CONFIG });
  viewport.onResize(({ resolution }) => modal.setResolution(resolution));

  /**
   * The menu's ears.
   *
   * Told rather than polled, unlike the game page's, because the interesting
   * moment on this page is the CALL — `pick` then `activate` — and two of the
   * four screens leave no edge behind to poll. It is given the book so a badge
   * press can be read BEFORE the assignment changes; putting a mark on and
   * taking one off must not sound the same.
   */
  const menuAudio = audio
    ? new MenuAudio({ audio, audioConfig: CONFIG.audio, book: markBook, settings: audioSettings })
    : null;

  let marks = null;
  /** 내 마크에 들어온 문. `menu` 또는 `settings`. */
  let marksOrigin = 'settings';
  let editor = null;
  let confirm = null;
  /** 상대 선택. Rebuilt on every entry so the choice cannot persist. */
  let opponent = null;
  /**
   * The matchmaking screen, and the socket it holds.
   *
   * Rebuilt on every entry like `opponent`, and for a stronger reason: it owns a
   * live connection. A cached instance would keep a socket open behind whatever
   * screen you wandered off to, and the relay would go on believing that player
   * was sitting in a queue.
   */
  let online = null;
  /** Which scene root is live. Swapped under the cap at the covered frame. */
  let current = 'menu';

  /**
   * The cap that covers the screen. Its own overlay scene and camera.
   *
   * ── it was a letterbox, and §7.1 retires that ────────────────────────────
   * `Cinematic` closed two bars to a full screen of one colour, the swap
   * happened behind it, and the game document opened on the same colour. It
   * worked, and what it could not do is §9: the transition has to be an OBJECT
   * the player recognises, because the chain the brief draws — bottle, cap,
   * playing piece, board — is a claim about the world rather than about the
   * transitions.
   *
   * The letterbox is still in the project. It frames the match's own opening
   * and ending, which is a different job (`core/Cinematic.js`), and the menu no
   * longer instantiates one.
   */
  const wipe = new CapWipe({
    retro,
    tuning: cfg.wipe,
    panelMap: capLogoTexture(),
  });

  const transition = new Transition({ tuning: cfg.transition });

  /** World position -> the overlay's frame pixels. */
  function toFrame(world) {
    const p = world.clone().project(camera);
    return { x: (p.x * WIPE_FRAME.width) / 2, y: (p.y * WIPE_FRAME.height) / 2 };
  }
  const mouth = new Vector3();
  const mouthDir = new Vector3();
  /** Whether THIS document plays the cap's exit. Written by `runTransition`. */
  let uncoverRun = true;

  // ── layout ───────────────────────────────────────────────────────────────
  /**
   * How many world units one framebuffer pixel is worth on the z = 0 plane.
   *
   * ── it is the TARGET's height, not the overlay's virtual frame ───────────
   * This was the virtual 640x480 to begin with, matching the overlay, and it
   * was wrong in a way worth recording: the target is 320x240, so a plate
   * authored 128 texels wide landed on 64 real pixels and every piece of type
   * on it was resampled to half size — after `crispText` had gone to the
   * trouble of thresholding its alpha specifically so it would not be.
   *
   * The overlay's frame is virtual on purpose, so the letterbox keeps its share
   * of the screen at any internal resolution. The plates want the opposite: one
   * texel on one pixel, whatever that resolution happens to be. Reading it off
   * `viewport.resolution` gets that at every mode, and the resize hook below
   * re-lays them out when the panel changes it.
   */
  function unitsPerPixel() {
    const visibleHeight =
      2 * cfg.camera.distance * camWiden * Math.tan((cfg.camera.fov * Math.PI) / 360);
    /**
     * World units per FRAME pixel, not per target pixel.
     *
     * It was `resolution.y`, which is the same number whenever the frame and the
     * render target move together — true at the 640x480 default, which is why
     * this is a no-op on a desktop. It stops being the same the moment the frame
     * carries the UI scale: dividing by the target would keep the plates the
     * same fraction of a screen that just got narrower, i.e. would undo exactly
     * the scaling the frame exists to provide. Dividing by the frame makes the
     * menu's plates grow on a phone in step with the game's buttons.
     */
    return visibleHeight / FRAME.height;
  }

  /**
   * Aimed once and then only translated.
   *
   * The slight downward pitch is what makes the floor a floor: from dead level
   * a horizontal plane is a line, and the shadow on it is a dash. Four or five
   * degrees is enough to open the ellipse out without the scene starting to
   * read as a top-down view of a bottle lying on its back.
   *
   * The camera shake later writes `position` and deliberately does NOT re-aim,
   * which is what keeps it a translation. Rotating the camera instead would
   * swing the entire frame and read as an earthquake.
   */
  function placeCamera() {
    camera.fov = cfg.camera.fov;
    /**
     * The canvas's aspect, not the 4:3 constant.
     *
     * This is the whole of the camera fix, and it covers all seven menu pick
     * sites at once: every one of them raycasts THIS camera from the full canvas
     * rect, so a projection that disagreed with the canvas would put every press
     * in the wrong place — not just draw the room stretched.
     */
    camera.aspect = FRAME.width / FRAME.height;
    /**
     * Pull back far enough that the WIDTH the camera sees does not change.
     *
     * `fov` is vertical. Narrowing the aspect while holding it therefore narrows
     * the visible width in proportion, and backing off by the same ratio
     * restores it exactly — so the bottle keeps the size it was designed at
     * whatever shape the projection is.
     *
     * ── it used to earn its keep. Now it corrects a rounding residue ──────────
     * This was written for a portrait phone, where the aspect fell to 0.46, the
     * camera saw a third of the world it saw at 4:3, and the bottle — a seventh
     * of the width — became half of it. That was never a scale bug; it was a
     * field-of-view one.
     *
     * 4:3 is the frame's NARROWEST shape now, not its only one (정책 C). So the
     * `max(1, …)` is what carries the change: at 4:3 this is 1 to within the
     * width's rounding, and at anything wider the ratio drops below 1 and the
     * clamp holds it at 1. That is right — a wider canvas already sees more
     * horizontally, so there is nothing to pull back from.
     *
     * What it still corrects is a canvas NARROWER than 4:3, which happens in a
     * tall window: there the frame stays 4:3 and the canvas letterboxes, and
     * this is the tenth-of-a-percent that the width's rounding leaves.
     */
    camWiden = Math.max(1, MIN_FRAME_ASPECT / camera.aspect);
    camera.position.set(0, cfg.camera.height * camWiden, cfg.camera.distance * camWiden);
    camera.lookAt(0, cfg.camera.lookAtY * camWiden, 0);
    camera.updateProjectionMatrix();
    const u = unitsPerPixel();
    applyArrangement(u);
    items.layout(u);
    title.layout(u);
    /**
     * 하위 화면들도 다시 배치한다.
     *
     * 이 넷은 필요할 때 만들어지고 만들어질 때의 프레임에 맞춰 배치된다. 그 뒤에
     * 창이 바뀌면 — 폰을 돌리면 — 판 크기와 간격이 둘 다 달라져야 하는데,
     * 예전에는 아무도 말해 주지 않아서 옛 프레임의 배치가 그대로 남았다. 지금은
     * 설정 화면만 `layout` 을 갖고 있으므로 선택적으로 부른다.
     *
     * `confirm` 도 여기 있다. 화면이 아니라 화면 위에 뜨는 것이지만, 부록 B 이후
     * 크기를 `solvePanel` 에서 받으므로 프레임이 바뀌면 다시 풀어야 하는 것은
     * 똑같다.
     */
    for (const scene of [settings, collection, opponent, online, marks, editor, confirm]) {
      scene?.layout?.(u);
    }
  }
  placeCamera();
  // A resolution change moves what one texel is worth, so the plates have to be
  // re-sized for it or they stop being 1:1 the moment the panel touches the
  // render mode.
  viewport.onResize(() => placeCamera());

  // ── pointer ──────────────────────────────────────────────────────────────
  const pointer = { x: 0, y: 0, inside: false };

  function onMove(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;
    /**
     * A stroke and a turntable drag both continue THROUGH a move, so the editor
     * is asked before the hover is. It answers true while it is holding the
     * gesture, and a hover recomputed mid-stroke would repaint the toolbar on
     * every dab for nothing.
     */
    if (current === 'editor' && editor?.move(canvas, camera, e.clientX, e.clientY)) {
      // A held gesture keeps whatever cursor it started with — the crosshair for
      // a stroke — except a turntable spin, which closes the hand.
      canvas.classList.toggle('is-dragging', editor.spinning);
      return;
    }
    refreshHover();
  }

  /**
   * The cursor, as one of four intents rather than one boolean.
   *
   * ── why not a single `is-over-item` toggle ─────────────────────────────────
   * That is what this was, and it left the menu's cursor saying `grab` — the
   * base in `styles.css` — everywhere a plate was not. `grab` is right on the
   * GAME page, where the default press moves the camera. It was never right
   * here: the main menu, 설정 and 내 마크 respond only to presses, and the one
   * drag on the whole page is the editor's turntable. Most of every menu screen
   * was offering a drag that does not exist.
   *
   * So each screen now says what the point under the pointer actually IS and
   * the stylesheet decides how to draw it. `null` means "nothing here", which
   * on `.is-menu` is a plain arrow.
   */
  const CURSORS = ['is-over-item', 'is-over-cap', 'is-turntable'];
  function setCursor(intent) {
    const want =
      intent === 'item' ? 'is-over-item' : intent === 'cap' ? 'is-over-cap'
      : intent === 'turntable' ? 'is-turntable' : null;
    for (const c of CURSORS) canvas.classList.toggle(c, c === want);
  }

  /**
   * What a press on this hit would do, as a cursor intent.
   *
   * A point on the confirm dialog's veil is a hit — deliberately, so the screen
   * underneath stops looking at it — but pressing it does nothing, so it must
   * not promise a control. Both screens that can raise the dialog share this;
   * the editor branch used to skip the check and lit the pointer over the whole
   * veil while `activate` was quietly swallowing presses.
   */
  function intentOf(hit) {
    if (!hit) return null;
    // `onDown` skips a disabled item, so the cursor skips it too.
    if (hit.disabled) return null;
    if (hit.kind === 'dialog') return hit.hit?.id ? 'item' : null;
    // The editor's cap: a drawing surface in draw mode, a turntable in view.
    if (hit.kind === 'canvas') return 'cap';
    if (hit.kind === 'turntable') return 'turntable';
    return 'item';
  }

  function refreshHover() {
    if (transition.running || !pointer.inside) {
      items.setHover(null);
      settings?.setHover(false);
      setCursor(null);
      return;
    }
    if (current === 'collection') {
      const hit = collection?.pick(canvas, camera, pointer.x, pointer.y);
      collection?.setHover(hit);
      setCursor(intentOf(hit));
      return;
    }
    if (current === 'settings') {
      const hit = settings?.pick(canvas, camera, pointer.x, pointer.y);
      settings?.setHover(hit);
      setCursor(intentOf(hit));
      return;
    }
    if (current === 'editor') {
      const hit = editor?.pick(canvas, camera, pointer.x, pointer.y);
      editor?.setHover(hit);
      setCursor(intentOf(hit));
      return;
    }
    if (current === 'opponent') {
      const hit = opponent?.pick(canvas, camera, pointer.x, pointer.y);
      opponent?.setHover(hit);
      setCursor(intentOf(hit));
      return;
    }
    if (current === 'online') {
      const hit = online?.pick(canvas, camera, pointer.x, pointer.y);
      online?.setHover(hit);
      setCursor(intentOf(hit));
      return;
    }
    if (current === 'marks') {
      const hit = marks?.pick(canvas, camera, pointer.x, pointer.y);
      marks?.setHover(hit);
      setCursor(intentOf(hit));
      return;
    }
    const hit = items.pick(canvas, camera, pointer.x, pointer.y);
    items.setHover(hit);
    setCursor(intentOf(hit));
  }

  /**
   * ── press to open. That is the whole of it now ───────────────────────────
   * There used to be a wind-up: holding a menu item kept the bottle in a shake
   * stage — it went on being shaken, the head went on climbing, and letting go
   * fired it. A plain tap got the full minimum, so the quick way and the fun way
   * both felt deliberate.
   *
   * §6.1 removes the shake, and the interaction goes with it: there is no hand
   * in this picture to hold the bottle with. Choosing a menu item is one gesture
   * again, and the run is a fixed length for the first time.
   *
   * ── a run in flight is still NOT interruptible ──────────────────────────
   * There used to be a skip here too: a press during the animation jumped
   * straight to the covered frame. It went because with a press-and-hold opening
   * it turned double-tapping into a cheat — the first tap started the run, the
   * second landed while the cap was still in the air and cut the whole thing to
   * nothing, so hammering an item entered the game with no animation at all.
   *
   * That reasoning survives the hold's removal, and more simply: the run is
   * 0.39 s. There is nothing to escape from.
   */
  function onDown(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;

    if (transition.running) return;

    if (current === 'collection') {
      const hit = collection?.pick(canvas, camera, e.clientX, e.clientY);
      if (!hit) return;
      menuAudio?.press('menu', hit);
      if (hit.id === 'back') returnToMenu();
      return;
    }
    if (current === 'settings') {
      const hit = settings?.pick(canvas, camera, e.clientX, e.clientY);
      if (!hit) return;
      /**
       * The screen acts FIRST here, unlike every other branch.
       *
       * Nothing on this screen needs pre-press state — and one control needs
       * the opposite. 음소거 is a toggle, and a click played before it runs is a
       * click played while the mute it is about to LIFT is still in force, so
       * turning the sound back on was the one press in the game that made no
       * sound. Acting first means the press is heard in the state it produced.
       */
      const consumed = settings.activate(hit);
      menuAudio?.press('settings', hit);
      // The sound rows are the screen's own; navigation is this file's, because
      // this file owns every screen change.
      if (consumed) return;
      if (hit.id === 'back') returnToMenu();
      // Sideways between two sub-screens, so it takes the short fade rather
      // than the letterbox: the transition is the menu's way of ENTERING
      // something, and spending a second on it to move one row deeper would
      // read as leaving.
      else if (hit.id === 'marks') fadeTo('marks');
      return;
    }
    if (current === 'opponent') {
      const hit = opponent?.pick(canvas, camera, e.clientX, e.clientY);
      if (!hit) return;
      // The screen takes the two choice rows; navigation is this file's, for the
      // reason every other branch here gives — one place owns screen changes.
      const consumed = opponent.activate(hit);
      menuAudio?.press('menu', hit);
      if (consumed) return;
      /**
       * 시작 gets the letterbox; 뒤로 gets the short fade.
       *
       * The same division the rest of the menu already makes and states: the
       * bars are what you get for STARTING something, and coming back is not an
       * event. Entering this screen closed them, leaving it for the match closes
       * them, and backing out to the menu is the same 180 ms fade that leaves a
       * match.
       */
      if (hit.id === 'start') launch();
      else if (hit.id === 'back') returnToMenu();
      return;
    }
    if (current === 'online') {
      const hit = online?.pick(canvas, camera, e.clientX, e.clientY);
      if (!hit) return;
      // The screen owns creating, joining, queueing and cancelling; the only
      // thing it hands back is 뒤로, because this file owns every screen change.
      const consumed = online.activate(hit);
      menuAudio?.press('menu', hit);
      if (consumed) return;
      if (hit.id === 'back') fadeTo('opponent');
      return;
    }
    if (current === 'marks') {
      const hit = marks?.pick(canvas, camera, e.clientX, e.clientY);
      // BEFORE `activate`, which is the whole reason it is a separate call: a
      // badge press has to be read while it is still known which way it goes.
      menuAudio?.press('marks', hit);
      marks?.activate(hit);
      return;
    }
    if (current === 'editor') {
      const hit = editor?.pick(canvas, camera, e.clientX, e.clientY);
      // Also before: undo and redo report nothing about whether they did
      // anything, so the only way to tell a real one from a no-op is to ask the
      // history the same question the toolbar asks when it greys the icon.
      menuAudio?.press('editor', hit, { editor });
      editor?.press(hit, e.clientX, e.clientY);
      return;
    }

    const hit = items.pick(canvas, camera, e.clientX, e.clientY);
    if (hit && !hit.disabled) {
      menuAudio?.press('menu', hit);
      run(hit.id);
    }
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  // On WINDOW, not the canvas: a stroke that ends with the pointer off the
  // letterboxed canvas still has to end, or the next move would go on painting
  // with no button held.
  // Every way a gesture can end has to put the hand back, or a spin that ended
  // off the canvas leaves `grabbing` on a page nothing is being dragged on.
  const endGesture = () => {
    editor?.release();
    menuAudio?.release();
    canvas.classList.remove('is-dragging');
    refreshHover();
  };
  window.addEventListener('pointerup', endGesture);
  window.addEventListener('pointercancel', endGesture);
  // A window that loses focus mid-press never delivers the pointerup.
  window.addEventListener('blur', endGesture);
  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
    refreshHover();
  });

  // ── the run ──────────────────────────────────────────────────────────────

  /**
   * The letterbox closing, with whatever should happen behind it.
   *
   * ── this used to BE `run`, and the opponent screen split it ───────────────
   * There are two things a covered frame can hide: a scene swap, which is what
   * 설정 and 상대 선택 are, and a document change, which is what starting a
   * match is. They were one function because a mode item did both at once —
   * pick 서바이벌 and you got the transition and the navigation together.
   *
   * A mode item no longer navigates. It opens a screen, and the navigation
   * happens one press later from that screen, so the two have to be separable —
   * and the transition itself, which is identical for both, should not be
   * written twice to achieve it.
   *
   * @param {() => void} onSwap  runs on the first fully covered frame
   * @param {{uncover?: boolean}} [opts]
   *   `uncover` false leaves the bars shut when the run ends. That is the
   *   navigation case and it is not a detail: `location.assign` does not tear
   *   this document down synchronously, so a document that opened its bars on
   *   the way out would show the menu again for however long the next one takes
   *   to paint — which is exactly the flash the covered frame exists to prevent.
   */
  function runTransition(onSwap, { uncover = true } = {}) {
    if (transition.running) return false;
    items.setHover(null);
    items.enabled = false;
    /**
     * Read by `tick` on the exit stage, not branched on here.
     *
     * The clock runs the same three stages either way; what differs is whether
     * this document is the one that plays the last of them. A navigation leaves
     * the cap where the cover put it and the next document flies it out.
     */
    uncoverRun = uncover;

    transition.begin(
      null,
      {
        /**
         * ── the cap only comes OFF THE BOTTLE when the bottle is there ───────
         * On the menu this is the bottle being opened: the crimp lets go, the
         * cap hops off the mouth along the axis the bottle has turned toward
         * the camera, and the eruption goes off underneath it.
         *
         * Every other screen has no bottle on it, and nothing takes its place.
         * The cap used to be fired out of thin air there — out of the point the
         * bottle WOULD have occupied, off to one side of a screen it was not
         * on — which was reported exactly that way. The bars are what covers
         * the frame now, so a screen with no bottle simply gets the bars: there
         * is no longer a hole to fill.
         */
        /**
         * ── the cap only comes OFF THE BOTTLE when the bottle is there ───────
         * On the menu this is the bottle being opened: the crimp lets go, the
         * cap leaves the mouth along the axis the bottle has turned toward the
         * camera, and the eruption goes off underneath it.
         *
         * Every other screen has no bottle on it. This used to run regardless,
         * so pressing 시작 on the opponent screen fired a cap out of thin air —
         * out of the point the bottle WOULD have occupied, off to one side of a
         * screen it was not on, and it was reported exactly that way. With
         * nothing to leave, the cap simply comes at the camera from dead
         * centre, which is also how the game page plays it coming back.
         *
         * Two caps for one frame, or none for one frame, are both visible at
         * 60 Hz — so the bottle loses its cap on the frame the overlay gains
         * one, not a frame either side.
         */
        onPop: () => {
          if (current !== 'menu') {
            wipe.begin({ x: 0, y: 0 }, aimedLaunchDirection(cfg.bottle));
            return;
          }
          bottle.setCapVisible(false);
          bottle.popBurst();
          bottle.mouthWorld(mouth);
          bottle.mouthDirection(mouthDir);
          const from = toFrame(mouth);
          // The heading is the bottle's own axis, projected — and by now the
          // bottle has turned to point that axis at the camera. A cap that came
          // off a leaning bottle and then flew straight up the screen would read
          // as two unrelated events.
          const ahead = toFrame(mouth.clone().addScaledVector(mouthDir, 4));
          wipe.begin(from, { x: ahead.x - from.x, y: ahead.y - from.y });
        },
        onSwap,
        onDone: () => {
          items.enabled = true;
          refreshHover();
          /**
           * `uncover` false leaves the cap where the cover put it.
           *
           * That is the navigation case: `location.assign` does not tear this
           * document down synchronously, so a document that uncovered on the way
           * out would show the menu again for however long the next one takes to
           * paint. The far side picks the cap up and flies it out — §7.3's
           * contract, and the only thing that crosses the boundary is which
           * frame the cap is on.
           */
          if (!uncover) return;
          wipe.end();
          bottle.setCapVisible(true);
          bottle.popCap(0);
        },
      },
    );
    return true;
  }

  /**
   * Which mode the opponent screen is currently choosing an opponent FOR.
   *
   * Held here rather than on the screen, because the screen is deliberately
   * mode-agnostic — it takes a name to put in its heading and never reads it
   * again. This file owns routing, so this file remembers where the 시작 button
   * is going to lead.
   */
  let pendingMode = null;

  /**
   * A menu item was chosen.
   *
   * 설정 swaps a scene. A game MODE now swaps a scene too — the opponent screen —
   * where it used to navigate. That is the whole routing change, and it is why
   * there is no `prefetch` on this path any more: nothing is being fetched, so
   * warming the destination four hundred milliseconds early would be warming a
   * document the player has not chosen to open yet. The prefetch moved to
   * `launch` below, which is where a navigation actually begins.
   */
  function run(target, opts) {
    /**
     * ── two of the home's three rows do not leave this column ──────────────
     * `PLAY` and `뒤로` only change what the column is showing, and a cap wipe
     * for that would be the menu covering the screen to redraw three words. The
     * cap is what the menu spends on ENTERING something, and the same division
     * `설정` and `상대 선택` already make: a swap gets the wipe, a page does not.
     *
     * There is no fade either. `pageFade` is for a document, and the column's
     * own items already fade in `MenuItems.update`.
     */
    if (target === 'play' || target === 'home') {
      items.setPage(target);
      refreshHover();
      return true;
    }
    if (Object.hasOwn(MODES, target)) {
      pendingMode = target;
      return runTransition(() => swapTo('opponent'), opts);
    }
    return runTransition(() => swapTo(target), opts);
  }

  /**
   * 시작 — leave for the match, opponent and all.
   *
   * The same transition the menu item played, so entering the game is one
   * continuous gesture across two screens rather than two different flourishes.
   * The URL is built BEFORE it starts so the prefetch has the whole run to work
   * with, which is the timing `menuRoutes.prefetch` explains — and that window
   * got shorter when the shake stage went, so the prefetch matters more.
   */
  function launch() {
    if (!pendingMode || !opponent) return;
    /**
     * 온라인 does not start a match — it goes looking for one.
     *
     * The other two choices have an opponent already (the person next to you, or
     * nobody) so 시작 is a navigation. Online has to find somebody first, and the
     * navigation happens on the far side of that, from `onMatched`. Sideways to
     * another menu screen, so it takes the short fade rather than the
     * letterbox: the bars are what the menu spends on ENTERING a match, and this
     * is not one yet.
     */
    if (opponent.choice === 'online') {
      fadeTo('online');
      return;
    }
    const url = destinationUrl(pendingMode, location, { vs: opponent.choice });
    prefetch(url);
    runTransition(() => navigateTo(url), { uncover: false });
  }

  /**
   * This player's mark, as the wire wants it.
   *
   * Three cases, and they are genuinely different — a clean cap is a CHOICE, not
   * a missing mark, and the built-in logo has no data URL to send because both
   * ends already have it. See `MARK_KIND` in the protocol.
   */
  function wireMark(player) {
    const ref = markBook.assignedTo(player);
    if (ref === DEFAULT_MARK) return { kind: 'default' };
    const dataUrl = markBook.slotImage(ref);
    return dataUrl ? { kind: 'png', dataUrl } : { kind: 'none' };
  }

  /**
   * Hand over to the game's document.
   *
   * Lifted out of `swapTo` unchanged when modes stopped being a swap target.
   * Every line of it is about the SEAM between two documents and none of it is
   * about which mode is being opened, which is why it now takes a finished URL.
   */
  function navigateTo(url) {
    /**
     * The page is about to be replaced, and the gap between this document going
     * away and the next one's first frame is not under anyone's control. What
     * fills it is the document's own background.
     *
     * ── the handover paint is back, in cobalt, on instruction ─────────────
     * Two lines here used to paint the window the cap's own red, because the
     * covered frame was a red cap. They went when the letterbox took over,
     * because a letterbox closes to `--msa-void` and the gap was then the same
     * flat colour with nothing assigned anywhere — which was genuinely better
     * while the cover was a colour.
     *
     * §7.2 makes the cover an OBJECT again, and an object is lit. The panel
     * measures around `#8a9aaf` at full cover against a `#2a6fc0` surround, so
     * "nothing assigned" is a visible step at the seam. §7.3 says what to do
     * about it: paint the handover cobalt. It is one value, it is
     * `PALETTE.menu.capBrand`, and it is the same value `styles.css` carries as
     * its `--msa-void` fallback for the frames before a module script runs.
     *
     * It does not perfectly match the lit panel and cannot — the panel takes
     * light and the document does not. What it does is make the step small and
     * in the same hue, instead of a step to the sky's own blue.
     */
    document.documentElement.style.background = PALETTE.menu.capBrand;
    document.body.style.background = PALETTE.menu.capBrand;
    // The document — and the AudioContext with it — is gone within a frame or
    // two. Ramped on the audio clock so the last voice fades rather than being
    // cut off, which is a click on the one frame that is supposed to be seamless.
    audio?.fadeOutForNavigation(0.12);
    location.assign(url);
  }

  /**
   * The scene change, performed under a screen that is entirely cap.
   *
   * Everything expensive that a destination needs happens on this line and
   * nowhere else, which is the point of having a covered window at all.
   */
  /**
   * Out of the settings screen, on a short black fade.
   *
   * NOT the letterbox, and the same fade the HUD's 메뉴 button uses to leave a
   * match — literally the same function, so the two ways back cannot drift
   * apart. The brief puts it as "복귀 시에는 전환 연출 없이 짧은 페이드": the bars
   * are what you get for STARTING something. Coming back is not an event, and
   * playing the same flourish in both directions makes leaving feel as
   * ceremonious as arriving, which is exactly backwards.
   */
  /**
   * 다른 화면으로 바꾼다. **덮개 없이, 그 자리에서.**
   *
   * ── 흰 페이드를 걷어낸 이유 ─────────────────────────────────────────────
   * `fadeThrough` 로 감쌌었다. 화면이 `PALETTE.ui.surface` — 거의 흰색 — 로
   * 덮였다가 다시 걷혔고, 한 번에 400 밀리초쯤 걸렸다. 이 문서 안에서 화면을
   * 옮기는 길이 다섯이라(설정↔마크, 마크↔편집기, 상대↔온라인, 그리고 되돌아
   * 가기 둘) 메뉴를 조금만 돌아다녀도 흰 화면이 계속 지나갔다. 사용자가
   * "하얀색 페이드 남발" 이라고 한 것이 그것이다.
   *
   * 덮개는 **가릴 것이 있을 때** 쓰는 것이다. 문서를 바꾸는 이동은 새 문서가
   * 뜨는 동안 빈 화면이 보이므로 가릴 것이 있고, 그래서 `fadeOut` 은 남는다.
   * 이 이동에는 없다 — 씬 그래프에서 루트 하나를 빼고 다른 하나를 넣는 일이고,
   * 다음 프레임에 이미 끝나 있다. 가릴 것이 없는데 덮으면 그건 지연일 뿐이다.
   *
   * 화면이 통째로 바뀌는 것이 급작스럽지 않은 것은, 각 화면이 자기 패널을 들고
   * 있어서 바뀌는 것이 배경이 아니라 패널이기 때문이다.
   */
  function fadeTo(target) {
    menuAudio?.screenChange();
    swapTo(target);
    items.enabled = true;
    refreshHover();
  }

  function returnToMenu() {
    fadeTo('menu');
  }

  /**
   * Open the drawing screen on a mark.
   *
   * The grid is the only door in, and this is the door's other side.
   *
   * An existing mark has to be DECODED before the editor can load it, and a data
   * URL decodes asynchronously — so the swap waits for the image rather than
   * opening on a blank cap and popping the artwork in a frame later. The black
   * fade covers the wait, which is the same thing it covers on every other move
   * between these screens.
   */
  function openEditor(ref) {
    const url = ref === 'default' ? null : markBook.slotImage(ref);
    const enter = (image) => {
      if (!editor) {
        editor = new MarkEditor({
          retro,
          unitsPerPixel: unitsPerPixel(),
          book: markBook,
          confirm,
          tuning: cfg.marks,
          onExit: () => fadeTo('marks'),
        });
        // The one dialog, shared. Re-parented on each entry so it is always a
        // child of whatever screen is currently up — it has to be drawn, and
        // only the live screen's root is in the scene.
      }
      editor.open(ref, image);
      fadeTo('editor');
    };

    if (ref === 'default') {
      // The built-in logo is already pixels — it is the canvas the bottle's cap
      // wears — so there is nothing to decode.
      enter(capLogoTexture().image);
      return;
    }
    if (!url) {
      enter(null);
      return;
    }
    const img = new Image();
    img.onload = () => enter(img);
    // A slot whose PNG will not decode opens empty rather than not at all.
    img.onerror = () => enter(null);
    img.src = url;
  }

  function swapTo(id) {
    // A mode is no longer a swap target: choosing one opens `opponent`, and the
    // navigation is `navigateTo`, called from `launch`. Nothing here handles a
    // document change any more.

    // Whatever is showing, stop showing it. One line rather than a subtraction
    // per screen, so adding a third cannot forget to remove the second.
    scene.remove(menuRoot);
    if (collection) scene.remove(collection.root);
    if (settings) scene.remove(settings.root);
    if (marks) scene.remove(marks.root);
    if (editor) scene.remove(editor.root);
    if (opponent) scene.remove(opponent.root);
    if (online) scene.remove(online.root);

    /**
     * Leaving matchmaking closes the socket, not just the screen.
     *
     * Every other screen here is inert once it is off the graph. This one holds
     * a live connection, and a connection that outlives its screen leaves the
     * relay believing this player is still sitting in a queue — so somebody else
     * gets paired with a room nobody is watching, and waits out the handoff
     * timeout for an opponent who wandered back to the main menu.
     *
     * Disposed here rather than in the branch that builds it, because the case
     * that matters is swapping AWAY, and that branch never runs.
     */
    if (id !== 'online' && online) {
      online.dispose();
      online = null;
    }

    if (id === 'online') {
      online?.dispose();
      online = new OnlineScene({
        retro,
        unitsPerPixel: unitsPerPixel(),
        mode: pendingMode,
        /**
         * The PLACE, not the mode's own name.
         *
         * §7.4 gives each mode a name in the world — SUMMER TABLE, SUMMER LAWN,
         * SUMMER PORCH — and the opponent screen is where a player last sees
         * the mode named before they are in it, so it is where the world's name
         * belongs. The rules' own name (알까기 컬링) is what the mode IS and stays
         * in `modes.js`; this is where it happens.
         */
        modeName: placeOf(pendingMode) || (MODES[pendingMode]?.name ?? ''),
        profile,
        config: CONFIG,
        modal,
        markOf: () => wireMark(0),
        onMatched: (session) => {
          // Everything the game document needs, parked where a navigation cannot
          // destroy it. See `OnlineSession.stash`.
          session.stash();
          const url = destinationUrl(pendingMode, location, { vs: 'online' });
          prefetch(url);
          runTransition(() => navigateTo(url), { uncover: false });
        },
      });
      scene.add(asUiLayer(online.root));
      current = 'online';
      return;
    }

    if (id === 'opponent') {
      /**
       * Rebuilt on EVERY entry, and disposed on the way out.
       *
       * Every other screen here is built once and cached, which is the right
       * trade for a settings page nobody's state depends on. This one must not
       * be: "선택을 저장하지 마라. 매번 기본 상태로 시작한다", and the cheapest
       * way to guarantee a default is for there to be no previous instance
       * holding a choice. It also picks up a mark edited since the last visit,
       * which a cached screen would show stale.
       */
      opponent?.dispose();
      opponent = new OpponentScene({
        retro,
        unitsPerPixel: unitsPerPixel(),
        book: markBook,
        defaultMark: capLogoTexture().image,
        marks: cfg.marks,
        /**
         * The PLACE, not the mode's own name.
         *
         * §7.4 gives each mode a name in the world — SUMMER TABLE, SUMMER LAWN,
         * SUMMER PORCH — and the opponent screen is where a player last sees
         * the mode named before they are in it, so it is where the world's name
         * belongs. The rules' own name (알까기 컬링) is what the mode IS and stays
         * in `modes.js`; this is where it happens.
         */
        modeName: placeOf(pendingMode) || (MODES[pendingMode]?.name ?? ''),
        // The mode's own answer. See `MODES.knockout.ai`.
        aiAvailable: !!MODES[pendingMode]?.ai,
      });
      scene.add(asUiLayer(opponent.root));
      current = 'opponent';
      return;
    }

    if (id === 'collection') {
      if (!collection) {
        collection = new CollectionScene({ retro, unitsPerPixel: unitsPerPixel() });
      }
      scene.add(asUiLayer(collection.root));
      current = 'collection';
      return;
    }

    if (id === 'settings') {
      if (!settings) {
        settings = new SettingsScene({
          retro,
          unitsPerPixel: unitsPerPixel(),
          // The sound rows are only built when there is a model behind them.
          audioSettings,
          // 같은 규칙. 이 줄이 그래픽 판과 다섯 칸 칩 줄을 만든다.
          graphicsSettings,
          // 그리고 이 줄이 카메라 추적 토글을 만든다.
          viewSettings,
          profile,
          modal,
        });
      }
      scene.add(asUiLayer(settings.root));
      current = 'settings';
      return;
    }

    if (id === 'marks') {
      // 지금 어느 화면에서 들어왔는가. 위 `onBack` 이 읽는다.
      marksOrigin = current === 'settings' ? 'settings' : 'menu';
      if (!marks) {
        const u = unitsPerPixel();
        confirm = new ConfirmDialog({ retro, unitsPerPixel: u });
        marks = new MarksScreen({
          retro,
          unitsPerPixel: u,
          book: markBook,
          // The built-in logo, as pixels. The same canvas the bottle's cap
          // wears, so "기본 로고" in the grid is the logo that is actually on a
          // cap rather than a second drawing of it.
          defaultMark: capLogoTexture().image,
          confirm,
          onOpen: (ref) => openEditor(ref),
          /**
           * 온 곳으로 돌아간다.
           *
           * 예전에는 설정으로 고정이었다 — 그때 내 마크로 가는 문이 설정 안에
           * 하나뿐이었기 때문이다. 부록 B3.2 가 메인 메뉴에 두 번째 문을 냈으므로,
           * 어디서 왔는지가 답을 바꾼다. 설정에서 들어와 메뉴로 나가면 한 화면을
           * 건너뛴 것이 되고, 메뉴에서 들어와 설정으로 나가면 가 본 적 없는 곳에
           * 도착한다.
           */
          onBack: () => fadeTo(marksOrigin),
          backLabel: marksOrigin === 'settings' ? '◀ 설정으로' : '◀ 메뉴로',
        });
        marks.root.add(confirm.root);
      }
      // The dialog belongs to whichever screen is up: it is a child of that
      // root, so it is only drawn while that root is in the scene.
      if (confirm) marks.root.add(asUiLayer(confirm.root));
      scene.add(asUiLayer(marks.root));
      current = 'marks';
      return;
    }

    if (id === 'editor') {
      if (confirm) editor.root.add(asUiLayer(confirm.root));
      scene.add(asUiLayer(editor.root));
      current = 'editor';
      return;
    }

    scene.add(menuRoot);
    current = 'menu';
  }

  // ── debug ────────────────────────────────────────────────────────────────
  const debug = bootMenuDebug({
    config: cfg,
    bottle,
    wipe,
    items,
    transition,
    retro,
    composer,
    viewport,
    overlay: wipe.scene,
    onRebuild: () => bottle.rebuild(),
    onLean: () => bottle.applyLean(),
    onLayout: () => placeCamera(),
    onPlay: () => run('settings'),
    // ── 내 마크 ──
    markBook,
    palette: MARK_SWATCHES,
    brushSizes: BRUSH_SIZES,
    onPalette: () => editor?.refreshPalette(),
    onCanvasSize: (v) => {
      cfg.marks.canvasSize = v;
      editor?.setCanvasSize(v);
    },
    onBoundary: (v) => {
      editor?.setBoundary(v);
      // The grid draws the same circle on its thumbnails, so it has to be told
      // too or the two screens would disagree about where the edge is.
      marks?.refresh();
    },
    onPreviewMark: () => previewMarkTextures(),
    // ── 사운드 ──
    audio,
    audioSettings,
    // ── 그래픽 ──
    graphicsSettings,
  });

  /**
   * Every mark texture, as it will reach a cap, in a DOM overlay.
   *
   * DOM rather than in the scene, deliberately: this is the tuning panel, which
   * is already a DOM surface, and the thing being inspected is the TEXTURE
   * rather than how it looks in the world — the scene is where you check the
   * latter, and it is one keypress away.
   */
  function previewMarkTextures() {
    document.querySelectorAll('#mark-preview').forEach((n) => n.remove());
    const wrap = document.createElement('div');
    wrap.id = 'mark-preview';
    wrap.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:9999;' +
      `background:${withAlpha(PALETTE.ui.surface, 0.93)};` +
      `padding:10px;border:1px solid ${PALETTE.ui.edgeStrong};` +
      `font:11px ui-monospace;color:${PALETTE.ui.text};display:flex;gap:10px`;
    const shot = (label, canvas) => {
      const cell = document.createElement('div');
      cell.style.textAlign = 'center';
      const cv = document.createElement('canvas');
      cv.width = 96;
      cv.height = 96;
      cv.style.cssText =
        `image-rendering:pixelated;width:96px;height:96px;border:1px solid ${PALETTE.ui.edgeStrong}`;
      const c2 = cv.getContext('2d');
      c2.imageSmoothingEnabled = false;
      if (canvas) c2.drawImage(canvas, 0, 0, 96, 96);
      cell.appendChild(cv);
      const cap = document.createElement('div');
      cap.textContent = label;
      cell.appendChild(cap);
      wrap.appendChild(cell);
    };
    const snap = markBook.snapshot();
    snap.slots.forEach((url, i) => {
      if (!url) return shot(`슬롯${i + 1} (빔)`, null);
      const img = new Image();
      img.onload = () => {
        const cv = wrap.children[i]?.querySelector('canvas');
        cv?.getContext('2d').drawImage(img, 0, 0, 96, 96);
      };
      img.src = url;
      shot(`슬롯${i + 1}`, null);
    });
    if (editor) shot('에디터 베이크', editor._bakeCanvas);
    const close = document.createElement('button');
    close.textContent = '닫기';
    close.onclick = () => wrap.remove();
    wrap.appendChild(close);
    document.body.appendChild(wrap);
  }

  // ── loop ─────────────────────────────────────────────────────────────────
  let raf = 0;
  let last = 0;
  /** Scratch for projecting the bottle to screen space. Reused every frame. */
  const bottleAt = new Vector3();

  function tick(dt) {

    const state = transition.update(dt);

    /**
     * Where the pointer is, in -1..1 of the CANVAS, and how close it has come.
     *
     * ── it is not a hit test, deliberately ────────────────────────────────
     * §6.3 asks the glass to react to being approached, and a raycast against
     * the bottle answers a different question: it is inside or it is outside,
     * which is a switch, and a switch is what produces the on/off snap the
     * direction bans. So the bottle is handed a direction and a proximity and
     * decides for itself — everything downstream of `setPointer` is continuous.
     *
     * `near` falls off over roughly a third of the canvas from the bottle's
     * own screen position, which is close enough that walking the pointer
     * across the menu column does not stir it.
     */
    if (pointer.inside) {
      const rect = canvas.getBoundingClientRect();
      const nx = ((pointer.x - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ny = ((pointer.y - rect.top) / Math.max(1, rect.height)) * 2 - 1;
      bottleAt.copy(bottle.root.position).project(camera);
      const d = Math.hypot(nx - bottleAt.x, ny + bottleAt.y);
      bottle.setPointer(nx, ny, Math.max(0, 1 - d / 0.9));
      /**
       * 물을 젓는 것은 커서의 **속도**다. 위치가 아니다.
       *
       * 가만히 올려 둔 커서가 물을 계속 젓고 있으면 그건 물이 아니라 소음이다.
       * 지난 프레임에서 얼마나 움직였는지를 재서, 움직인 만큼만 넣는다.
       */
      const moved = Math.hypot(nx - lastPointerN.x, ny - lastPointerN.y);
      water.stir(Math.min(0.5, moved * 2.6));
      lastPointerN.x = nx;
      lastPointerN.y = ny;
    } else {
      bottle.setPointer(0, 0, 0);
    }

    // The bottle turns its mouth toward the camera for the whole run and
    // unwinds once it is over — see `Bottle.applyLean`. Driven by the STAGE, so
    // it is fully aimed before the cap goes.
    bottle.update(dt, { aim: transition.running ? 1 : 0, camera });
    // 배경의 물. 렌더 클럭이고 게임 상태를 읽지도 쓰지도 않는다.
    // 젓는 세기를 돌려받아 제목에 그대로 넘긴다 — 둘이 같은 물이어야 한다.
    const stirred = water.update(dt, viewport.resolution);
    // The burst is a billboard. The camera is fixed now that the shake is gone,
    // so this could be done once — it is not, because a sprite that is visibly
    // edge-on is the failure and one quaternion copy a frame is not worth the
    // risk of the camera ever moving again.
    bottle.burst.quaternion.copy(camera.quaternion);

    title.update(dt, stirred, current === 'menu' ? 1 : 0);
    items.update(dt, current === 'menu' ? 1 : 0);
    settings?.update(dt);
    // 마크 목록도 호버가 움직인다. 예전에는 `update` 가 빈 함수라 부를 이유가 없었다.
    if (current === 'marks') marks?.update(dt);
    // 모달의 등장. `render()` 에는 dt 가 없으므로 여기서 민다.
    modal.update(dt);
    online?.update(dt);
    if (current === 'opponent') opponent?.update(dt);
    // The view mode's inertia lives here; nothing else in the editor moves.
    if (current === 'editor') editor?.update(dt);

    /**
     * ── the camera had a shake of its own, and it has gone ────────────────
     * Same frequency family as the bottle's at a fraction of the amplitude,
     * position only — rotating it would have swung the whole frame and read as
     * an earthquake rather than as a hand on a bottle. There is no hand.
     *
     * The camera is still written every frame rather than once in
     * `placeCamera`, because `camWiden` moves on every resize and this is the
     * only place that reads it per frame.
     */
    camera.position.set(0, cfg.camera.height * camWiden, cfg.camera.distance * camWiden);

    /**
     * The cap, off the transition's clock.
     *
     * Stepped rather than given a target, unlike the letterbox it replaced: the
     * wipe has no clock of its own and is a pure function of `state.t`, which is
     * what makes it impossible for the cover to arrive at a different moment
     * from the swap. `Cinematic` owned its own tween because four different
     * sequences drove it; this one has exactly one driver.
     */
    switch (state.stage) {
      case STAGE.POP:
        wipe.launch(state.t, dt);
        break;
      case STAGE.COVER:
        wipe.cover(dt);
        break;
      case STAGE.EXIT:
        // Held at the cover on a navigation. See `uncoverRun`.
        if (uncoverRun) wipe.exit(state.t, dt);
        else wipe.cover(dt);
        break;
      default:
        break;
    }

    // The sound, after everything else has written this frame's state.
    menuAudio?.update(dt, { state });
    audio?.update(dt);

    debug.frame(state);
    render();
  }

  // The same console handle the match page exposes as `__cap`. The menu had
  // none, which meant every question about its camera or its frame had to be
  // answered by reading source instead of by asking the running page.
  window.__menu = { viewport, composer, camera, scene, cfg, items, bottle, placeCamera };

  function render() {
    const r = viewport.renderer;

    // 1. The world — water, bottle, liquid, fizz — through the bloom chain.
    //    This page is almost entirely the glossy surfaces that pass exists for.
    camera.layers.set(WORLD_LAYER);
    composer.render();

    // 2. The plates, on top and unbloomed. See `asUiLayer`.
    //
    //    `scene.background` has to come off for this pass, and that is not
    //    optional. A scene with a Colour background forces a colour clear
    //    inside `render()` REGARDLESS of `autoClear` — three sets `forceClear`
    //    when it paints one — so rendering the same scene a second time
    //    repaints the backdrop over the bloomed world and the bottle disappears.
    //    That is exactly what it did. The match page never hits this because
    //    its overlays are separate scenes with no background of their own.
    camera.layers.set(UI_LAYER);
    const sky = scene.background;
    scene.background = null;
    r.autoClear = false;
    r.clearDepth();
    r.render(scene, camera);
    scene.background = sky;

    // 3. The modal and the cap wipe, which own their own scenes. Both are
    //    outside the bloom: the modal is nothing but type, and the cap carries
    //    the game's name at six times its texel size, which a bright pass would
    //    smear.
    modal.render(r);
    // Last of all, over the modal included: at the covered frame it is the only
    // thing on screen.
    wipe.render(r);
    r.autoClear = true;

    // Back to the world layer, so anything that reads the camera between frames
    // — a raycast, a projection — sees the mask it expects.
    camera.layers.set(WORLD_LAYER);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    // Clamped at both ends, as the game's loop is: a hidden tab that comes back
    // hands you a multi-second jump, and feeding that to a 0.95 second
    // transition would step over the whole of it in one frame.
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) || 0;
    last = now;
    tick(dt);
  }

  function start() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    start();
  });

  start();

  // The same handle the game exposes, for driving frames by hand while
  // verifying — the covered frame is three frames long and is not something you
  // can catch by looking.
  window.__menu = {
    config: cfg, bottle, wipe, items, transition, camera, viewport, retro, tick,
    run, scene,
    // The screens, for the same reason `tick` is here: a sub-screen sits behind
    // a covered frame and a fade, and neither is something you can step through
    // by hand from the outside.
    swapTo, markBook, openEditor, audio, menuAudio, launch,
    // 조명 리그. 노출을 손으로 재려면 있어야 한다 — `createLightRig` 의 `scale`
    // 주석에 왜 이 문서가 경기 화면과 다른 배율을 쓰는지 적혀 있다.
    lights,
    get marks() { return marks; }, get settings() { return settings; },
    get editor() { return editor; },
    get opponent() { return opponent; },
    // 온라인만 빠져 있었다. 이 화면은 세션과 함께 만들어지고 함께 버려지므로
    // getter 여야 하고, 없으면 화면이 떠 있는데 핸들이 `undefined` 다.
    get online() { return online; },
  };
}

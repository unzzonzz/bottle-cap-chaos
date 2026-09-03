import { Color, Scene, Vector3 } from 'three';
import { GlossMaterials } from './core/GlossMaterial.js';
import { createEnvironment } from './core/environment.js';
import { createLightRig } from './core/lighting.js';
import { createSky } from './core/sky.js';
import { Viewport } from './core/Viewport.js';
import { SceneComposer } from './core/Composer.js';
import { setTextureRenderer } from './core/textures.js';
import { initRapier } from './physics/rapier.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { CONFIG, CONFIG_DEFAULTS } from './game/config.js';
import { Match, MATCH_STATE } from './game/Match.js';
import { modeByKey, modeKeyFromPath, scoreboardFor } from './game/modes.js';
import { AimInput } from './game/AimInput.js';
import { DRAG_MODE, PointerRouter } from './game/PointerRouter.js';
import { TrajectoryPreview } from './game/predict.js';
import {
  ArenaView,
  buildGameCapGeometry,
  capDimensions,
  PLAYER_COLORS,
} from './render/ArenaView.js';
import { MarkBook } from './marks/MarkBook.js';
import { LocalStorageMarks } from './marks/MarkStorage.js';
import { MarkTextures } from './marks/markTextures.js';
import { ColliderView } from './render/ColliderView.js';
import { OrbView } from './render/OrbView.js';
import { DistanceMarks } from './render/DistanceMarks.js';
import { AimOverlay } from './render/AimOverlay.js';
import { GameCamera } from './render/GameCamera.js';
import { CamTracker } from './render/CamTracker.js';
import { TrackPathView } from './render/TrackPathView.js';
import { AiCandidateView } from './render/AiCandidateView.js';
import { HudLayer } from './ui/HudLayer.js';
import { VictoryLayer } from './victory/VictoryLayer.js';
import { VICTORY_STAGE } from './victory/VictoryClock.js';
import { fadeIn, fadeOut } from './ui/pageFade.js';
import { isAiOpponent, isOnlineOpponent, menuUrl } from './menu/menuRoutes.js';
import { OnlineSession } from './net/OnlineSession.js';
import { defaultServerUrl } from './net/Transport.js';
import { LocalStorageNicknames, Profile } from './profile/NicknameStorage.js';
import { OnlineMatch } from './net/OnlineMatch.js';
import { OnlineController } from './net/OnlineController.js';
import { IntroLayer } from './intro/IntroLayer.js';
import { ModalLayer } from './ui/ModalLayer.js';
import { AiController, HumanController } from './game/ai/Controller.js';
import { ThinkBudget } from './game/ai/ThinkBudget.js';
import { CardLayer, FRAME } from './render/CardLayer.js';
import { CardFx } from './render/CardFx.js';
import { CardFlight } from './render/CardFlight.js';
import { setFieldAspect, updateFrame } from './core/frame.js';
import { bootPhysicsDebug } from './debug/PhysicsDebug.js';
import { MetricsOverlay, NO_METRICS } from './debug/MetricsOverlay.js';
import { hardenWebView } from './platform/webview.js';
import { bootViewer } from './viewer/bootViewer.js';
import { bootMenu } from './menu/bootMenu.js';
import { Cinematic } from './core/Cinematic.js';
import { MENU_CONFIG } from './menu/menuConfig.js';
import { HANDOVER_FLAG, isHandover, isReturnFromGame } from './menu/menuRoutes.js';
import { PALETTE } from './core/palette.js';
import { applyCssPalette } from './ui/cssPalette.js';
import { whenFontsReady } from './ui/fonts.js';
import { capLogoTexture } from './menu/menuTextures.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { AudioSettingsBook, LocalStorageAudioSettings } from './audio/AudioSettings.js';
import { GraphicsSettingsBook, LocalStorageGraphicsSettings } from './core/GraphicsSettings.js';
import { LocalStorageViewSettings, ViewSettingsBook } from './core/ViewSettings.js';
import {
  configureQuality,
  onQualityChange,
  refreshShadowCasters,
  setQualityTier,
  TIER_NAMES,
} from './core/quality.js';
import { FirstRunProbe } from './core/FirstRunProbe.js';
import { MatchAudio } from './audio/MatchAudio.js';

/**
 * Wiring, and the one place the three layers are allowed to see each other.
 *
 *   PHYSICS  physics/        Rapier, fixed 1/120 steps, snapshots, hashes.
 *   RULES    game/           turns, shots, settle detection, out judging.
 *   RENDER   render/, ui/    reads state, draws it, and never writes back.
 *
 * The loop below is the only thing that touches all three, and it does so in one
 * direction: input feeds the rules, the rules step the physics, the render layer
 * reads what came out. Nothing draws from inside a physics step and nothing
 * steps from inside a draw.
 *
 * Phase 1's cap viewer is still here, at `?view=cap`.
 *
 * ── the URL picks the mode, and the ROOT is the menu ─────────────────────────
 * `/survival`, `/football` and `/curling` open a match; `/` opens the menu, and
 * so does anything else that is not one of those three. See `menuRoutes` for why
 * the absence of a mode is the rule rather than the menu having an address of
 * its own, and `MODES.knockout.path` for why the survival mode's segment is not
 * its key.
 *
 * The mode is written onto `CONFIG.mode` rather than passed to `Match` alone,
 * because `CONFIG.mode` is what the restart button and the panel's mode dropdown
 * both rebuild from — set only the match's mode and 재시작 would drop you back
 * into knockout.
 */

const canvas = document.getElementById('view');

// Before `boot`, so the config is already right by the time anything reads it.
const routed = modeKeyFromPath(location.pathname);
if (routed) {
  CONFIG.mode = routed;
  // And into the defaults too, because the URL is not a preference — it is what
  // this page IS. `CONFIG_DEFAULTS` was cloned at config.js import time, which is
  // strictly before this line, so without it the panel's 전체 리셋 restores
  // knockout onto a page whose address still says `/football`.
  CONFIG_DEFAULTS.mode = routed;
}

/**
 * Arriving from the menu, mid-transition.
 *
 * ── there is nothing to paint any more, and that is the fix ────────────────
 * Two lines here used to set `documentElement` and `body` to the cap's own red
 * before anything else ran, because the covered frame the menu left on was a
 * red cap filling the screen and the gap between the two documents had to be
 * that same red or it was a flash.
 *
 * The frame the menu leaves on is now a shut letterbox, and `Cinematic` closes
 * it to `PALETTE.bg.skyTop` precisely because that is already `--bcc-void` —
 * what the line below paints the document, and what the browser paints around a
 * letterboxed canvas. So the menu's last frame, the gap, and this page's first
 * frame are one colour with nothing assigned anywhere, and there is no longer an
 * inline style that has to be kept in agreement with other files.
 */
// The stylesheet names `var(--bcc-*)` and nothing else, so this has to run
// before the letterbox, the page fade or either developer overlay is painted.
// It is cheap — a dozen `setProperty` calls.
applyCssPalette();

/**
 * Kick the webfont, and drop every baked text texture once it lands.
 *
 * Deliberately NOT awaited. The caches this empties are all re-filled on the
 * next frame that asks for a plate, so the cost of being early is one frame of
 * fallback type and the cost of awaiting would be a blank screen until a font
 * request that may never succeed either resolves or times out.
 */
whenFontsReady();


/**
 * Sound, built BEFORE the branch and shared by every destination.
 *
 * ── one construction site, like the marks store ─────────────────────────────
 * `LocalStorageMarks` is deliberately named in exactly two places and says so;
 * the same discipline applies here and this file can do better than two, because
 * the three "pages" are three branches of one module rather than three
 * documents. So the storage implementation is named once, right here, and both
 * boots are handed the result.
 *
 * ── and BEFORE `await initRapier()`, which is the load-bearing part ─────────
 * `install()` attaches the first-gesture listener. The game branch is async on
 * the WASM and `PointerRouter` — which owns every pointer listener on that page
 * — does not exist until it resolves, so an unlock hung off the router would
 * miss every press made while the physics core was still loading. Registered at
 * module scope it cannot be missed, which is the same argument the handover
 * repaint above makes for running where it does.
 *
 * The listener is additive and passive. It does not go through the router or
 * `bootMenu.onDown`, both of which return early in exactly the states where a
 * press still has to unlock audio — during a transition, behind the cap wipe.
 */
const audioSettings = new AudioSettingsBook(new LocalStorageAudioSettings());
const audio = new AudioSystem({ config: CONFIG.audio, settings: audioSettings }).install();

/**
 * 그래픽 품질. 소리와 같은 자리에, 같은 이유로.
 *
 * ── 이 세 줄의 **순서와 위치**가 전부다 ────────────────────────────────────
 * 아래 세 갈래(캡 뷰어 · 경기 · 메뉴) 중 어느 것도 아직 `Viewport` 를 만들지
 * 않았다는 것이 요점이다. `QUALITY.pixelRatioCap` 은 뷰포트가 생성자에서 읽고
 * `QUALITY.worldTexture` 는 뷰가 텍스처를 구울 때 읽으므로, 티어가 그보다 늦게
 * 정해지면 첫 프레임만 최대 티어로 그려진다 — 그 어긋남은 화면에 아무 흔적도
 * 남기지 않는 종류다.
 *
 * ── 두 문서가 같은 키를 읽는다 ─────────────────────────────────────────────
 * 메뉴와 경기는 `location.assign` 으로 오가는 별개 document 이고, 이 파일은 둘
 * 다의 진입점이다. 즉 두 문서가 각자 부팅하면서 각자 이 세 줄을 돌리고, 같은
 * `localStorage` 키를 읽으므로 같은 값이 나온다. 설정 화면에서 고른 티어가
 * 경기 화면에 반영되는 것은 그 사실 하나로 끝난다 — 넘겨줄 것이 없다.
 *
 * 표는 `CONFIG.view.graphics` 에 있고 저장되지 않는다. 저장되는 것은 문서 쪽
 * 숫자 하나뿐이다. `core/GraphicsSettings.js` 머리말에 그 분리의 근거가 있다.
 */
const graphicsSettings = new GraphicsSettingsBook(new LocalStorageGraphicsSettings());
configureQuality({ table: CONFIG.view.graphics, tier: graphicsSettings.tier });
graphicsSettings.onChange((book) => setQualityTier(book.tier));

/**
 * 카메라 추적. 소리·그래픽과 같은 자리에, 같은 이유로.
 *
 * ── 왜 여기이고 왜 `CONFIG_DEFAULTS` 에도 쓰는가 ────────────────────────────
 * 두 문서가 같은 키를 읽는다. 설정 화면은 메뉴 문서에 있고 `CamTracker` 는 경기
 * 문서에 있으므로, 넘겨줄 것은 없고 각자 부팅하면서 각자 이 줄을 돌린다 — 그래픽
 * 티어가 화면을 넘어가는 것과 정확히 같은 방식이다.
 *
 * `CONFIG_DEFAULTS` 에도 쓰는 것은 `CONFIG.mode` 가 그러는 것과 같은 이유다:
 * 이건 개발자의 기본값이 아니라 **이 사람이 고른 것**이므로, 패널의 전체 리셋이
 * 되돌려야 할 대상이 아니다. 안 쓰면 리셋 한 번에 설정 화면은 "끔" 이라고 말하는데
 * 카메라는 따라가는 상태가 된다.
 */
const viewSettings = new ViewSettingsBook(new LocalStorageViewSettings());
const applyViewSettings = (book) => {
  CONFIG.view.track = book.trackCamera;
  CONFIG_DEFAULTS.view.track = book.trackCamera;
};
applyViewSettings(viewSettings);
viewSettings.onChange(applyViewSettings);

/**
 * The web view's own gestures, off — for all three destinations below.
 *
 * At module scope for the same reason `install()` above is: the guards are
 * document-level and additive, and the game branch does not exist until the WASM
 * resolves. A pinch made while the physics core is still loading would otherwise
 * be handled by the browser, which zooms the page and leaves it zoomed.
 *
 * Most of the blocking is CSS; this is only the handful with no declarative
 * form. See src/platform/webview.js for what lives where.
 */
hardenWebView();

/**
 * Three destinations, in the one order that works.
 *
 * ── the viewer FIRST, and that ordering is now load-bearing ─────────────────
 * `?view=cap` is a query on whatever path it is typed at, so under the new rule
 * — "no mode segment means the menu" — `/?view=cap` names no mode and the menu
 * would answer it. It used to be safe to ask the menu first because the menu had
 * an address of its own and the root was a game; it is not safe now. The viewer
 * is the most specific of the three, so it is asked first, and the menu is the
 * fallthrough because it is the least specific.
 */
if (new URLSearchParams(location.search).get('view') === 'cap') {
  bootViewer(canvas);
} else if (routed) {
  boot(canvas).catch((err) => {
    console.error(err);
    const p = document.createElement('pre');
    p.className = 'boot-error';
    p.textContent = `물리 코어 부팅 실패\n\n${err?.stack || err}`;
    document.getElementById('app').appendChild(p);
  });
} else {
  bootMenu(canvas, { audio, audioSettings, graphicsSettings, viewSettings });
  /**
   * The far side of a match's fade back to the menu.
   *
   * The game fades to black and then navigates, so this document opens on a
   * black screen — and used to paint itself at full brightness the instant it
   * was ready, which was the one hard cut in the whole app: the game faded out
   * through `fadeOut` and the menu simply arrived. Same veil, same colour, same
   * 180 ms, now on both sides of the navigation.
   *
   * 문서 **안에서** 화면을 바꾸는 이동에는 덮개가 없다. 가릴 것이 없기 때문이고,
   * 왜 없앴는지는 `ui/pageFade.js` 끝에 적혀 있다. 덮개는 문서가 바뀌는 이 한
   * 자리에만 남았다.
   *
   * AFTER `bootMenu`, and that ordering is the whole reason this is two lines
   * rather than a callback: `bootMenu` schedules its first frame before it
   * returns, so that frame is drawn under the veil and `fadeIn` — which waits
   * two frames of its own — lifts onto a menu that is already there.
   */
  if (isReturnFromGame()) {
    fadeIn();
    // So a refresh does not replay a transition that has already happened. The
    // same thing the outbound handover does to this flag on the other side.
    const url = new URL(location.href);
    url.searchParams.delete(HANDOVER_FLAG);
    history.replaceState(null, '', url);
  }
}

/**
 * 조사를 붙인다. `높음으로` / `최대로`.
 *
 * "(으)로" 로 도망가지 않는 이유는 이 화면의 다른 어떤 글도 그렇게 쓰지 않기
 * 때문이다. 받침이 있으면 `으로`, 없거나 ㄹ 이면 `로` — 한글 음절의 종성은
 * 코드포인트에서 바로 나오므로 사전도 예외 목록도 필요 없다.
 *
 * 티어 이름 다섯 개(최저·낮음·보통·높음·최대)에만 쓰이지만, 이름이 바뀌어도
 * 문장이 어색해지지 않는다는 것이 규칙으로 쓴 이유다.
 */
function withRo(word) {
  const last = word.codePointAt(word.length - 1);
  const isHangul = last >= 0xac00 && last <= 0xd7a3;
  if (!isHangul) return `${word}로`;
  const jong = (last - 0xac00) % 28;
  // 0 = 받침 없음, 8 = ㄹ. 둘 다 `로` 를 받는다.
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`;
}

const _flightPoint = new Vector3();

async function boot(canvas) {
  // Nothing in physics/ can be constructed before the WASM is up.
  await initRapier();

  /**
   * `portrait: true` — 켜져 있고, 그게 하는 일은 하나다.
   *
   * ── 예전 주석 두 개가 서로를 부정하고 있었다 ──────────────────────────────
   * 하나는 "이 플래그가 HUD 와 손패를 보드 위아래 밴드에 놓는다"고 했고, 바로
   * 아래 것은 "밑 밴드에 미해결 렌더링 아티팩트가 있어서 OFF 로 나간다"고 했다.
   * 인자는 `true` 다. 둘 다 틀렸다기보다, 서로 다른 두 가지를 같은 것으로 부르고
   * 있었다.
   *
   * 이 플래그가 하는 일은 프레임이 보드의 4:3 보다 높아질 수 있게 하는 것뿐이다.
   * 세로 폰에서 캔버스가 위아래 검은 띠 없이 화면을 채우는 게 그 결과다. 가로
   * 창에서는 정확히 4:3 으로 떨어지므로 데스크톱은 이 플래그와 무관하다.
   *
   * HUD 와 손패를 밴드에 놓는 것은 **다른 문제**이고, `frame.js` 의 `playHeight`
   * 한 줄로 꺼져 있다. 이유와 켜는 조건은 그쪽 주석에 있다.
   *
   * 메뉴와 캡 뷰어는 이 플래그를 끈다 — 둘 다 4:3 캔버스에 위아래로 배치하고
   * 정사각으로 지켜야 할 보드가 없다.
   */
  const viewport = new Viewport({ canvas, portrait: true });
  // 이방성 상한은 렌더러가 있어야 알 수 있다. 텍스처가 만들어지기 전에.
  setTextureRenderer(viewport.renderer);
  const retro = new GlossMaterials({ resolution: viewport.resolution });

  const scene = new Scene();
  /**
   * `scene.background` 는 쓰지 않는다 — 하늘은 메시다.
   *
   * 배경 텍스처는 화면 공간에 고정되어 카메라가 돌아도 따라오지 않는다. 알까기
   * 카메라는 회전하고 팬하므로 붙박이 하늘은 회전을 오히려 안 보이게 만든다.
   * `core/sky.js` 참조.
   */
  const sky = createSky(scene);
  const lights = createLightRig(scene);
  /**
   * 그림자 맵은 자동으로 갱신되지 않는다. `ArenaView.moved` 가 켠다.
   *
   * 여기서 한 번만 끄는 이유는 이것이 이 문서의 성질이기 때문이다 — 이 장면에서
   * 그림자를 던지는 것은 뚜껑과 공뿐이고, 둘 다 언제 움직였는지 정확히 알 수 있다.
   * 어디서 켜는지는 틱 안의 주석에, 왜 물리 스텝 수로는 부족한지는
   * `ArenaView.update` 에 적혀 있다.
   */
  viewport.renderer.shadowMap.autoUpdate = false;

  viewport.onResize(({ resolution }) => retro.setResolution(resolution));

  /**
   * The environment every reflective surface samples.
   *
   * Built once, from the palette, and handed to the material factory rather than
   * to the scene: `scene.environment` would only reach THIS scene, and the caps
   * also appear in the victory sequence, the cap wipe and the match-found layer,
   * each of which owns its own scene. Setting it per material covers all of them
   * from one place.
   */
  // 반환값을 받지 않는다. 이 문서는 해체되지 않는다 — 경기를 떠나는 것은
  // `location.assign` 이고 그 순간 문서 전체가 사라진다. `sky` 와 `lights` 도
  // 같은 이유로 `dispose` 가 불리는 자리가 없다.
  createEnvironment(viewport.renderer, retro);

  /**
   * 티어가 바뀌었을 때 이 문서가 직접 해야 하는 것: 씬의 그림자 캐스터.
   *
   * 나머지는 각자 자기 것을 안다 — 뷰포트는 배율, 컴포저는 샘플 수, 리그는 맵
   * 크기, 재질 공장은 클리어코트, 텍스처 모듈은 상한. 캐스터만은 **씬을 아는
   * 쪽**이 해야 하고, 이 게임은 모드가 바뀔 때마다 필드 뷰를 통째로 갈아끼우므로
   * 그걸 아는 것은 여기뿐이다. 뷰가 자기 구독을 들고 있으면 해제를 빠뜨리는
   * 자리가 뷰의 수만큼 생긴다 — `core/quality.refreshShadowCasters` 를 보라.
   */
  onQualityChange(() => refreshShadowCasters(scene));


  // ── the cap, measured once ───────────────────────────────────────────────
  // The collider is sized off the geometry's own userData rather than off the mm
  // parameters, so the two can never drift apart: change `capDiameter` and the
  // physics cap changes with the visual one.
  const capGeometry = buildGameCapGeometry();
  const capDims = capDimensions(capGeometry);

  // ── layers ───────────────────────────────────────────────────────────────
  const physics = new PhysicsWorld({
    solverIterations: CONFIG.physics.solverIterations,
    ccdSubsteps: CONFIG.physics.ccdSubsteps,
  });

  // A mode is a layout plus a rule set — the world's shape and what happens in
  // it. Everything either side of those two is shared, which is why switching
  // modes below is a rebuild and not a second copy of this function.
  /**
   * A match pinned from the address bar: `?seed=12345`.
   *
   * The whole match comes out of this one number — every orb, every turn it
   * appears on, every card it yields — so a seed is enough to hand somebody an
   * exact match, which is what makes a bug report about "the orb on turn 3"
   * something anybody else can look at.
   *
   * Only the OPENING match. Restarting from here draws a fresh one, because a
   * URL that pinned every subsequent match too would be a game with one match in
   * it wearing a query string — which is the thing this whole change is fixing.
   * The panel's seed field is where a match is re-pinned deliberately.
   *
   * Base 10 or `0x`-prefixed hex, since that is how the panel shows it. Anything
   * unparseable is ignored rather than becoming `NaN >>> 0` — seed 0 by typo.
   */
  const pinnedSeed = (() => {
    const raw = new URLSearchParams(location.search).get('seed');
    if (!raw) return undefined;
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n >>> 0 : undefined;
  })();

  /**
   * This player's name and preferred relay.
   *
   * Named here and in `bootMenu`, and nowhere else — the discipline
   * `LocalStorageMarks` follows two lines below. The game document needs it for
   * the server ADDRESS: the menu may have been pointed at a relay on another
   * machine, and that choice has to survive the navigation.
   */
  const profile = new Profile(new LocalStorageNicknames());

  const onlineStash = isOnlineOpponent() ? OnlineSession.recall() : null;
  const online = onlineStash ? new OnlineSession({ config: CONFIG }) : null;
  // Seat, seed and opponent are known from the stash alone, before any socket
  // exists — which is what lets the controllers below be built once, correctly.
  if (online) online.adopt(onlineStash);
  /**
   * Consumed immediately.
   *
   * Left in place it would re-attach this tab to a finished room the next time
   * the page loaded — including when the player deliberately started a LOCAL
   * game afterwards.
   */
  if (onlineStash) OnlineSession.clearStash();

  /**
   * Which seat the person at THIS screen occupies.
   *
   * Zero for local and AI play, as it has always been. Online it is whatever the
   * server assigned, and that is not cosmetic: `match.rules.currentPlayer` and
   * every cap index are seat numbers, so putting the local human anywhere other
   * than their real seat would mean translating between two numbering schemes at
   * every boundary — the aim input, the hand, the camera, the turn plate. One
   * mistranslation is a player shooting the opponent's caps.
   *
   * Instead the seat is honoured and the two places that assumed "local means 0"
   * ask this instead.
   */
  const localSeat = online ? online.mySeat : 0;
  const remoteSeat = localSeat === 0 ? 1 : 0;

  const match = new Match({
    physics,
    capDims,
    config: CONFIG,
    mode: modeByKey(CONFIG.mode),
    seed: pinnedSeed,
  });

  /**
   * The online match's per-frame work: applying what the opponent did, and
   * reporting what this machine got.
   *
   * Null in local and AI play, and every use below is guarded — the game runs
   * exactly the code it always did with one `?.` per frame.
   */
  const netMatch = online ? new OnlineMatch({ session: online, match }) : null;
  /**
   * The relay's coin toss, applied before anybody can move.
   *
   * Done here rather than inside `OnlineMatch` because it is a property of the
   * MATCH's opening position, not of the connection — and it must happen before
   * the first frame, while the opening snapshot is still the one being taken.
   * Both clients receive the same `first` and run the same call, so the two
   * worlds stay identical across it.
   */
  if (online) match.setFirstPlayer(online.match.first);

  /** The opponent's name for the turn plate, when they have one. */
  function onlineNameFor(player) {
    if (!online) return '';
    if (player === online.opponentSeat) return online.opponent?.nickname ?? '';
    return online.nickname ?? '';
  }

  /**
   * The marks each player chose in the menu.
   *
   * ── the game reads the same store the menu wrote ────────────────────────────
   * These are two DOCUMENTS — the menu navigates here rather than swapping a
   * scene — so nothing can be handed across in memory. `LocalStorageMarks` is
   * the shared ground, and it is named in exactly two places in the project:
   * here and in `bootMenu`. Everything else takes a `MarkStorage`, which is the
   * seam an account system replaces.
   *
   * `MarkTextures` hands out ONE texture per player and repaints its canvas
   * underneath forever after, which is what lets a material built now keep
   * showing the right mark later — including a mark that arrives from the
   * network mid-match. See the note on `MarkTextures` itself.
   */
  const markBook = new MarkBook(new LocalStorageMarks());
  const markOptions = {
    book: markBook,
    capColors: PLAYER_COLORS,
    defaultMark: capLogoTexture().image,
    size: MENU_CONFIG.marks.canvasSize,
    boundary: MENU_CONFIG.marks.boundary,
  };

  /**
   * On the board the two marks face each other; in the opening sequence they
   * both face the camera. Two bakes of the same book, because a cap's mark has no
   * up of its own — the panel's UVs are the same projection on every cap, so
   * which way a drawing reads is decided entirely here.
   *
   * ── the board ────────────────────────────────────────────────────────────
   * The players sit on opposite edges: 1P's caps start at the near one, 2P's at
   * the far one. A drawing belongs to its owner, so each is turned to be upright
   * from that owner's seat, which puts the pair looking at one another across
   * the board rather than both pointing the same way.
   *
   * `Math.PI` lands on the NEAR player, which is the opposite of what it looks
   * like it should be: a rotation of zero already comes out pointing toward the
   * near edge, so it is 1P's that has to turn. Verified against the mesh rather
   * than reasoned about — `CanvasTexture` flips Y and the panel's `v` runs
   * against the cap's local +z, and two sign flips are one too many to trust.
   *
   * ── the opening sequence ─────────────────────────────────────────────────
   * There is only one viewer there, and both caps are being held up TO them, so
   * "upright from your own seat" stops meaning anything. Everything faces front.
   *
   * The victory screen used to take this bake too, back when it was two caps
   * fighting. It holds no caps now — the board stays on screen and the camera
   * does the work — so the front-facing bake has one consumer, which is why it
   * is no longer called `frontMarks`.
   */
  /**
   * Online, this player's mark is book entry 0 whatever seat they were given.
   *
   * The menu sends `wireMark(0)` — one person at this device, one chosen mark,
   * entry 0. The server then seats them wherever it likes, and a player handed
   * seat 1 was painting their own cap from entry 1: a slot they had never chosen
   * anything for. Their opponent's mark showed (it is an override that arrives
   * over the wire) and their own did not.
   *
   * Identity in local and AI play, where seat and entry really are the same
   * thing — two people at one board, one entry each.
   */
  const bookSlotFor = online
    ? (player) => (player === online.mySeat ? 0 : 1)
    : null;

  const marks = new MarkTextures({ ...markOptions, rotations: [Math.PI, 0], bookSlotFor });
  const frontMarks = new MarkTextures({ ...markOptions, rotations: [0, 0], bookSlotFor });

  /**
   * The opponent's cap art, when they are on another machine.
   *
   * Applied to BOTH texture sets, because the opening sequence holds up the same
   * two caps and would otherwise introduce a stranger with a clean cap and then
   * put their mark on the board a second later.
   *
   * Only the opponent's seat: this player's own mark comes out of their own book
   * exactly as it always has, and overriding it with the copy that went over the
   * wire would be a round trip for a picture we already have.
   */
  /**
   * The opening sequence — the two players, before the board.
   *
   * ── every mode gets it, not only online ──────────────────────────────────
   * It was built for 매칭 성립 and the placement is what makes it worth having
   * everywhere: opponent top-left, you bottom-right, sliding into the corners
   * the match itself keeps those two hands in. That reading is the same whether
   * the other cap belongs to a stranger over a socket, to the computer, or to
   * the person holding the other end of the table.
   *
   * ── it takes the FRONT-FACING bake, not the board's ──────────────────────
   * `marks` is baked `[Math.PI, 0]` because on the table the two players sit
   * across from each other and each mark has to read upright from ITS OWNER's
   * seat — so 1P's is turned through half a circle. This sequence is not a
   * table: both caps are held up to one viewer, exactly as the victory screen
   * and the opponent-select screen do it, and both of those bake `[0, 0]` for
   * that reason.
   *
   * Handed `marks`, 1P's mark came out upside down — which is the board's
   * rotation being correct in the wrong place rather than anything being wrong
   * with the bake. `frontMarks` is the same artwork, including a mark that
   * arrived over the wire (`setRemoteMark` below paints both sets), with the
   * rotation this camera wants.
   *
   * "자기가 그린 뚜껑이 소개에 뜨는 것은 마크 시스템 전체의 보상이다." This is
   * the one screen in the game that holds a player's own drawing up at size,
   * which is why it takes the marks rather than the placeholder panel.
   */
  const introLayer = new IntroLayer({
    retro,
    resolution: viewport.resolution,
    config: CONFIG,
    panelFor: (player) => frontMarks.textureFor(player),
  });
  viewport.onResize(({ resolution }) => introLayer.setResolution(resolution));

  /**
   * The match's questions — leaving, a dropped opponent, a desync — as geometry.
   *
   * Modal by construction: it takes the pointer at the capture phase while it is
   * open, so `PointerRouter` never sees a press aimed at a dialog and no branch
   * anywhere else has to know one exists.
   */
  const modal = new ModalLayer({ canvas, resolution: viewport.resolution, config: CONFIG });
  viewport.onResize(({ resolution }) => modal.setResolution(resolution));

  /**
   * 첫 매치에서 한 번 재고, 못 버티면 한 칸 내린다. `core/FirstRunProbe.js`.
   *
   * 여기 있는 이유는 `modal` 때문이다 — 알리는 방법은 문서마다 다르고, 이 문서의
   * 방법은 이것이다. 메뉴 쪽에는 재고 있을 첫 매치가 없으므로 프로브도 없다.
   *
   * 되돌리기가 그냥 친절이 아니다: `setTier` 가 `userSet` 을 켜므로, 되돌린
   * 사람은 그 한 번으로 이후의 모든 자동 개입에서 빠져나간다. 사용자의 결정이
   * 측정을 이긴다는 규칙이 그 한 줄로 지켜진다.
   */
  const firstRunProbe = new FirstRunProbe({
    settings: graphicsSettings,
    onDemote: ({ from, to, fpsLow }) => {
      modal
        .confirm({
          title: '그래픽 품질을 낮췄습니다',
          body:
            `이 기기에서 화면이 초당 ${Math.round(fpsLow)}프레임까지 떨어져 ` +
            `${TIER_NAMES[from]}에서 ${withRo(TIER_NAMES[to])} 한 단계 내렸습니다.\n` +
            '설정 화면에서 언제든 바꿀 수 있습니다.',
          confirmLabel: '확인',
          cancelLabel: '되돌리기',
        })
        .then((ok) => {
          if (!ok) graphicsSettings.setTier(from);
        })
        .catch(() => {});
    },
  });

  if (online?.opponent?.mark) {
    const seat = online.opponentSeat;
    marks.setRemoteMark(seat, online.opponent.mark);
    frontMarks.setRemoteMark(seat, online.opponent.mark);
  }

  const view = new ArenaView({
    retro,
    arena: match.arena,
    config: CONFIG,
    capGeometry,
    panelTextureFor: (player) => marks.textureFor(player),
  });
  const colliderView = new ColliderView();
  const overlay = new AimOverlay({ config: CONFIG });
  // In the WORLD scene: an orb is an object on the board, so it takes the game
  // camera, the depth buffer and the retro pass exactly as a cap does.
  const orbView = new OrbView({ retro, config: CONFIG });
  /**
   * Whatever the rules measured on the field, drawn where they measured it.
   *
   * In the WORLD scene and built unconditionally, exactly as the orb view is:
   * it draws a list, the list comes from `RuleSet.distanceMarks`, and a mode
   * that measures nothing hands it an empty one and it disappears. There is no
   * mode branch here and there is not meant to be — see `DistanceMarks`.
   */
  const distanceMarks = new DistanceMarks();
  /**
   * The camera's own trails, for tuning the follow. Off unless the panel says.
   *
   * Unconditional in the scene for the same reason the two above are: it draws
   * two arrays, an empty pair is nothing, and a mode that never tracks simply
   * never fills them.
   */
  const trackPath = new TrackPathView();
  /**
   * What the AI considered, drawn where it considered it.
   *
   * In the world scene and unconditional, exactly as the three above are: it
   * draws a list, an empty list is nothing, and a mode with no AI in it never
   * fills one. Its objects are added lazily as ranks are needed, so a session
   * that never switches the panel's toggle on builds nothing at all.
   */
  const aiCandidates = new AiCandidateView();
  scene.add(
    view.root,
    overlay.root,
    colliderView.object,
    orbView.root,
    distanceMarks.root,
    aiCandidates.root,
    ...trackPath.objects,
  );

  /**
   * The frame has to know the field's shape before anything is laid out against
   * it. `rebuildAll` repeats this on every mode change; this is the first one,
   * and without it the opening match gets the 4:3 default region regardless of
   * what it actually plays on.
   */
  setFieldAspect(match.arena.layout.extents.x / match.arena.layout.extents.z);
  updateFrame(window.innerWidth, window.innerHeight);
  viewport.refit();

  const gameCamera = new GameCamera({
    extents: match.arena.layout.extents,
    config: CONFIG,
    fixedPitch: pitchFor(match.mode),
    rotatable: !!match.mode.camera?.rotatable,
    ...zoomRangeFor(match.mode),
  });
  const preview = new TrajectoryPreview(CONFIG);

  /**
   * The world's post-processing chain.
   *
   * Built here rather than beside the viewport because it needs the camera, and
   * the camera needs the arena's extents. Only the WORLD goes through it — see
   * `core/Composer.js` for why the UI deliberately does not.
   */
  const composer = new SceneComposer({
    viewport,
    scene,
    camera: gameCamera.camera,
    bloom: CONFIG.view.bloom,
  });

  /** The mode's fixed camera angle, if it has one. */
  function pitchFor(mode) {
    const f = mode.camera?.fixedPitch;
    return f ? () => f(CONFIG) : null;
  }

  /**
   * The mode's zoom range: floor, ceiling, and where a turn opens.
   *
   * All three together rather than three getters, because they are one range —
   * see `GameCamera.setZoomRange`. A mode that names none of them gets nulls and
   * the camera falls back to the panel's values, which is what every mode but
   * curling does for the last two.
   */
  function zoomRangeFor(mode) {
    const pick = (name) => {
      const f = mode.camera?.[name];
      return f ? () => f(CONFIG) : null;
    };
    return {
      minZoom: pick('minZoom'),
      maxZoom: pick('maxZoom'),
      turnZoom: pick('turnZoom'),
      screenZoomMax: pick('screenZoomMax'),
    };
  }

  /**
   * Bring the view round to the player whose turn it now is.
   *
   * Watched here rather than pushed from the rules, because whose turn it is is
   * a fact about the match and how it is FRAMED is a fact about the camera, and
   * neither should have to know about the other. One comparison a frame.
   *
   * Both modes get the zoom pulled back to the mode's widest; only a rotatable
   * mode gets the bearing, and only football answers `ownHalfBearing` — a square
   * board has no own half to face.
   */
  let shownPlayer = -1;
  let shownTurn = -1;

  /**
   * ON YOUR TURN, YOUR OWN HALF IS AT THE BOTTOM. That is the whole rule.
   *
   * Held as an INVARIANT, checked every frame. Every earlier version of this was
   * event-driven — fire on a turn change, on a player change, on the bearing
   * changing — and every one of them eventually found a path where the event did
   * not fire and the view then stayed wrong for the rest of the match. There is
   * no way to know the last such path has been found, so the answer is not
   * checked for anymore: the QUESTION is asked, every frame, and if the view is
   * not the way this turn needs it, it is put right.
   *
   * `ownHalfBearing` is a constant per player — your half is the end your goal
   * is at, and goals do not move — so there is nothing here that can drift or
   * tie, and the correction is a no-op on almost every frame.
   *
   * Two things are allowed to be different from this:
   *
   *   THE PLAYER. Turning the pitch by hand outranks the invariant until their
   *     next turn opens. Otherwise the rotation control would be unusable.
   *   ONE-MORE. An extra turn keeps the zoom and pan the player set up, because
   *     it is another go at the same shot rather than a new turn. The bearing is
   *     already correct in that case, so the invariant has nothing to do.
   *
   * ── it is THE definition of the default framing, and has one more caller ──
   * `CamTracker` calls it with `force` when a tracked turn ends without the seat
   * changing — an AI or online opponent, or an extra-turn card — because there
   * is then nothing else to put the view back. It calls THIS rather than
   * reproducing what it does, so "the framing the camera returns to" and "the
   * framing a turn change gives you" are the same sentence and cannot drift
   * apart when the bearing rule or the opening zoom is next changed.
   *
   * @returns {boolean} did it reset the framing outright?
   */
  /**
   * Does this match keep the player's zoom across a turn change?
   *
   * Both halves have to be true: somebody has to be playing the computer (so
   * there is no incoming player to reset the view for) and the mode has to ask
   * for it. Read live rather than latched — `setOpponent` can swap the far seat
   * mid-match, and the very next handover has to behave like the new one.
   */
  function aiKeepsZoom() {
    return hasAi() && !!match.mode.camera?.keepZoomVsAi;
  }

  /**
   * @param {boolean} [force]  reset the framing whether or not the turn changed
   * @param {{keepZoom?: boolean}} [opts]
   *   Override the zoom half of that reset. `CamTracker` passes it because its
   *   hand-back is a forced reframe that is NOT the player asking for the
   *   default framing — see the call site. Omitted, the policy below decides,
   *   which is what keeps the reset button meaning what it says.
   */
  function faceCurrentPlayer(force = false, { keepZoom = null } = {}) {
    /**
     * Not while the ending owns the camera.
     *
     * This is an INVARIANT — it is re-asserted every frame, deliberately, so
     * that no path can leave the view wrong for a whole turn — and that is
     * exactly why it has to be told when the view is not its business. The
     * push-in sets a pan and a zoom that this would spend the next second
     * arguing with, and the argument would be visible: `holdsOwnHalf` would
     * find the bearing right and leave the framing alone on most frames and not
     * on others.
     *
     * The bookkeeping below is skipped with it, which is safe because a match
     * that is over changes neither its turn nor its current player, so there is
     * no handover for the two shown values to miss.
     */
    if (victory.active) return false;
    const p = match.rules.currentPlayer;
    /**
     * ── against an AI the bearing is PINNED to the person's own half ────────
     * "AI 모드에는 플레이어 시점 전환이 없다. 턴이 바뀌어도 카메라 시점이 전환되지
     * 않는다. P1 시점 고정."
     *
     * The rule this replaces exists because two people share one screen and each
     * needs their own half at the bottom. With one person there is nobody to
     * turn the board round FOR, and doing it anyway would mirror the board twice
     * a turn under a player who never moved seats — they would spend the AI's go
     * looking at their own half from behind.
     *
     * Against an AI nothing else about the framing is reset either — see the
     * `keep` decision below. Two people at one board still get the full reset,
     * which is what keeps `faceCurrentPlayer` one function with one behaviour
     * and what makes the reset button's target identical in both modes. See
     * `GameCamera.defaultFraming`.
     */
    const bearing = turnBearing();
    const handover = match.rules.turn !== shownTurn && p !== shownPlayer;
    shownTurn = match.rules.turn;
    shownPlayer = p;

    /**
     * A turn that has changed hands resets the framing outright — bearing, zoom
     * and pan — whatever the last player left behind and whatever cards were
     * played to get here.
     *
     * ── unless there is nobody arriving to reset it FOR ─────────────────────
     * The reset is a courtesy to the INCOMING player on a shared screen: the
     * board turns round, comes back out to the opening zoom and re-centres, so
     * whoever picks the device up next starts from the same view every time.
     *
     * Against an AI there is no incoming player. The same person is still
     * sitting there looking at the same board, and resetting the view for them
     * is not a courtesy, it is taking their view away — twice a turn in
     * knockout, because `CamTracker` rides the thrown cap and then hands the
     * camera back through here as well.
     *
     * ── the pan used to be reset even so, and it is the visible half ────────
     * `keep` governed only the ZOOM: `{ zoom: false, pan: true }`, on the
     * grounds that the pan at that moment is where the TRACKER left it rather
     * than where the player put it, so recentring it undoes the automatic
     * camera's work and not the player's.
     *
     * That is true of where the pan IS and false about what it costs. Every
     * turn of a survival match against the computer went: ride the cap to
     * wherever it stopped, then glide all the way back to the middle, then ride
     * the next cap. The return is the longest single movement in the turn and it
     * happens between two things the player is watching, so the mode reads as a
     * camera that will not sit still — reported exactly that way. Leaving the
     * view where the shot finished is both less motion and the more honest
     * picture: that IS where the game is.
     *
     * The player is not stranded by it. Zooming out to the minimum re-centres on
     * its own (`GameCamera.update`), the HUD's 기본 구도 button is a forced
     * reset, and a drag is a drag.
     *
     * NOTE: `MODES.knockout.camera.keepZoomVsAi`'s own note still says the
     * tracker's return "keeps the zoom too and still recentres the pan". That
     * sentence is now out of date and this is the code, not that.
     *
     * `force` wins, and that is what keeps the reset button honest: it calls
     * this with `force` and must always pull the framing back to default.
     */
    if (force || handover) {
      const keep = keepZoom ?? (!force && aiKeepsZoom());
      gameCamera.faceTo(bearing, keep ? { zoom: false, pan: false } : undefined);
      return true;
    }

    // Otherwise: hold the bearing, and leave the zoom alone.
    if (!gameCamera.holdsOwnHalf(bearing)) gameCamera.faceTo(bearing, { zoom: false });
    return false;
  }

  /**
   * What the ending's camera pushes in on: whatever decided the match.
   *
   * ── it asks the STATE, not the mode ──────────────────────────────────────
   * The obvious home for this is a hook on the mode, next to `camera.track` and
   * `scoreboard`, and that is where it would go if `game/modes.js` were open to
   * this change. It is not, so the question is asked of the world instead — and
   * the three answers happen to be distinguishable without a mode name, because
   * what makes each mode different is exactly what it ends on:
   *
   *   a ball        only football has one, and at the end it is in a goal
   *   `closest`     only curling keeps one, and it is the cap the match is
   *                 judged on — including when a tiebreaker decided it
   *   what is left  survival, where winning IS being the last cap standing
   *
   * The order matters: football has surviving caps too, so the ball has to be
   * asked about first. The board's centre is the fallback, which is where the
   * camera already is.
   *
   * @param {number} winner  0, 1, or anything else for a draw
   * @returns {{x: number, z: number}}
   */
  function decisivePoint(winner) {
    const arena = match.arena;
    const rules = match.rules;

    if (arena.hasBall) {
      const ball = arena.ballCom();
      if (ball) return { x: ball.x, z: ball.z };
    }

    const closest = rules.closest;
    if (closest && Number.isInteger(closest.cap)) {
      const c = arena.capCom(closest.cap);
      if (c) return { x: c.x, z: c.z };
    }

    // A draw has no winner to follow, so it takes everything still standing —
    // which for a draw is the honest subject: what is left is why it is a draw.
    const caps =
      winner === 0 || winner === 1
        ? rules.livingCapsOf(winner)
        : [...rules.livingCapsOf(0), ...rules.livingCapsOf(1)];
    if (caps.length) {
      let x = 0;
      let z = 0;
      for (const i of caps) {
        const c = arena.capCom(i);
        x += c.x;
        z += c.z;
      }
      return { x: x / caps.length, z: z / caps.length };
    }

    return { x: 0, z: 0 };
  }

  /**
   * The camera's ride-along with the thrown cap.
   *
   * Built here and not inside `GameCamera` because it is a POLICY — which cap,
   * for how long, and what a fall is worth — over a rig that deliberately knows
   * none of those things. See its header, and `MODES.*.camera.track` for which
   * modes it runs in.
   */
  const camTracker = new CamTracker({ config: CONFIG, camera: gameCamera });

  /**
   * Who is sitting in each seat.
   *
   * ── one array, and the game never looks inside it ────────────────────────
   * `Match` has no idea these exist. An AI turn ends by `match.fire()` being
   * called with a shot record and an AI card is played through
   * `match.playCard()` — the identical calls the router makes for a person — so
   * every rule, refusal and effect runs the same code path for both. See the
   * header in `ai/Controller.js`.
   *
   * Seat 0 is always a person: this is one screen, and the brief adds an AI
   * OPPONENT rather than a second AI. The far seat is whatever the menu handed
   * over in the address, and `setOpponent` below lets the panel change its mind
   * mid-match.
   */
  /**
   * Can this mode be played against the computer at all?
   *
   * Only survival claims it — see `MODES.knockout.ai`. A hand-typed
   * `/football?vs=ai` therefore opens local play rather than running the
   * survival evaluator against a pitch, which would score goals as though they
   * were caps falling off a board.
   */
  const aiAvailable = () => !!modeByKey(CONFIG.mode).ai;
  /**
   * The online session, if the menu handed one over.
   *
   * ── the flag alone is not enough, and that is deliberate ─────────────────
   * `?vs=online` says this document was MEANT to be an online match; the stash
   * says the matchmaker actually made one. A hand-typed URL has the first and
   * not the second, and falls through to local play rather than to a broken
   * screen waiting for an opponent who was never found.
   */
  const controllers = [];
  controllers[localSeat] = new HumanController(localSeat);
  controllers[remoteSeat] = online
    ? new OnlineController(remoteSeat, online)
    : isAiOpponent() && aiAvailable()
      ? new AiController(remoteSeat, CONFIG)
      : new HumanController(remoteSeat);

  /**
   * Change who is in the far seat, mid-match. The panel's override.
   *
   * Declared here and used far below, so the cancels it performs reach objects
   * that exist by then — it is never called during this function's own body,
   * where `input` and `router` are still in their temporal dead zone.
   */
  function setOpponent(kind) {
    const want = kind === 'ai' && aiAvailable();
    if (want === !!controllers[1]?.isAi) return;
    controllers[1].cancel?.();
    controllers[1] = want ? new AiController(1, CONFIG) : new HumanController(1);
    // A seat that just changed hands must not inherit a half-drawn bow or a
    // pointer gesture that was legal against the previous occupant.
    input.cancel();
    router.cancel();
    // The hand pinning and the turn plate both change with this, and both are
    // per-frame reads — but the FRAMING is not, so it is put right here.
    faceCurrentPlayer(true);
  }

  /** The controller whose turn it is. Never null; falls back to seat 0. */
  function active() {
    return controllers[match.rules.currentPlayer] ?? controllers[0];
  }

  /** Is any seat a computer? Decides the pinned hand and the fixed viewpoint. */
  function hasAi() {
    return controllers.some((c) => c?.isAi);
  }

  /**
   * The bearing the camera's default framing is measured against.
   *
   * Extracted because two callers need the same answer and they are far apart:
   * `faceCurrentPlayer` builds the reset FROM it, and the HUD's reset button
   * dims against `atDefaultFraming` OF it. A second copy of the pinning rule
   * would let the button call the view "already default" at a bearing the turn
   * change would not have chosen.
   */
  function turnBearing() {
    const fn = match.mode.camera?.ownHalfBearing;
    if (!fn) return null;
    return fn(hasAi() ? localSeat : match.rules.currentPlayer);
  }

  // The bow. It owns no DOM events any more — see its header and the router's.
  const input = new AimInput({
    canvas,
    camera: gameCamera.camera,
    match,
    config: CONFIG,
    // The board is a 4:3 band inside a canvas that may be taller than it. An
    // aim ray normalised against the whole canvas would be out by the height of
    // the HUD band above it. Identical to the canvas rect in landscape.
    boardRect: () => viewport.boardClientRect(),
  });

  // The hands. Their own scene and their own orthographic camera, drawn into the
  // same low-res target as the pitch so one dither and one quantiser cover both
  // — see the header in CardLayer for why that is the whole point.
  //
  // Built before the router because the router asks it first: the cards used to
  // get their priority from being DOM over the canvas, and now that they are
  // inside it, the order has to be stated.
  //
  // Both directions go through the match, and that is the whole wiring: the hand
  // asks it what may be played and tells it what was. Nothing about a card's
  // EFFECT is known on this side of the line — see `cardCatalog` and `Match`.
  const cards = new CardLayer({
    canvas,
    config: CONFIG,
    resolution: viewport.resolution,
    usable: (cardId, player) =>
      player === match.rules.currentPlayer
        ? match.cards.usable(cardId, player)
        : { ok: true },
    /**
     * Whether 침묵 has this hand sealed.
     *
     * Asked for BOTH hands, unlike `usable` above, and that difference is the
     * point. `usable` answers `ok` for whoever is not on turn because greying an
     * opponent's parked hand for rules that will not apply until it is theirs
     * would be noise. The seal is not that: it is a standing condition that was
     * put there ON PURPOSE by the other player, and it has to be visible from
     * the moment it lands — the effect's whole ending is a padlock being stamped
     * onto that hand.
     *
     * It asks the player index and nothing else. Whether that player is a person
     * or, later, an AI does not enter into it, which is what keeps the seal a
     * rule rather than a property of the input path.
     */
    silenced: (player) => match.mode.cards !== false && match.cards.silencedOn(player),
    // A point that would grab one of your own caps belongs to the board, even
    // with a card drawn over it — see `CardLayer._reserved`. The same call the
    // router and the hover ring use, so all three agree about what a cap is.
    reserved: (x, y) => input.hitTest(x, y) >= 0,
    // Dragging a card sideways moves it in the STATE, live, and the fans follow
    // on the next sync — which is what opens the gap. See `CardHand._updateSort`.
    onReorder: (player, from, to) => match.hands.reorder(player, from, to),
    onCardUsed: (cardId, player) => {
      // Before the local apply, for the reason `onFire` gives: `playCard` draws
      // from the seeded counter and the opponent has to start from the same one.
      netMatch?.localCard(cardId);
      match.playCard(cardId);
      window.dispatchEvent(new CustomEvent('cardused', { detail: { cardId, player } }));
    },
  });
  // The card scene snaps to the same framebuffer grid, because it is drawn into
  // the same target — there is only one grid for either of them to snap to.
  viewport.onResize(({ resolution }) => cards.setResolution(resolution));

  // The effects. Two roots: one in the world, drawn with the game camera, and
  // one in the CARD scene, drawn with its orthographic camera — both inside the
  // same low-res target, so a stun star gets the same dither as the turf.
  const cardFx = new CardFx({
    config: CONFIG,
    resolution: viewport.resolution,
    frame: FRAME,
  });
  cardFx.setArena(match.arena);
  scene.add(cardFx.world);
  cards.scene.add(cardFx.screen);
  viewport.onResize(({ resolution }) => cardFx.setResolution(resolution));

  // Found cards, flying from the board into the hand. Same overlay scene and
  // same materials as the fan, so the card that lands is the card that flew.
  const cardFlight = new CardFlight({
    materials: cards.materials,
    config: CONFIG,
    frame: FRAME,
  });

  /**
   * The letterbox. The far side of the menu's transition, and every sequence
   * this document plays afterwards.
   *
   * ── it opens SHUT, and that is the whole document seam ───────────────────
   * The menu closed its bars, swapped the document behind them, and went away.
   * This page has to come up in exactly that state or the join is a cut. So the
   * bars are snapped closed here, before anything is drawn, and the opening
   * sequence is what parts them — see `playOpening`.
   *
   * Unconditionally, not only on a handover. A cold `/survival` typed into an
   * address bar gets the same opening, which is right twice over: every match
   * begins the same way, and the shut frame also covers the WASM boot that a
   * cold load spends on a blank canvas. There is nothing left for `isHandover`
   * to change about how this page looks, and the flag survives only to be
   * stripped from the address bar below.
   *
   * ── it is presentation and nothing else ──────────────────────────────────
   * It does not touch the match, the physics, the rules or the cards. It draws
   * last, into the same bound target as every other overlay, so it goes through
   * the identical dither and quantiser — and outside the bloom chain, because a
   * bright pass over a hard bar edge blooms the edge.
   */
  const cinematic = new Cinematic({ resolution: viewport.resolution });
  cinematic.snap(1);
  viewport.onResize(({ resolution }) => cinematic.setResolution(resolution));

  /**
   * Who currently owns the bars, and where the ending's camera is going.
   *
   * Declared beside the letterbox rather than down in the loop with the rest of
   * the per-frame state, because `playOpening` reads the first of them and runs
   * during boot — a `let` further down the file is still in its temporal dead
   * zone at that point, which is a `ReferenceError` on the opening frame of
   * every match.
   */
  let victoryHeldBars = false;
  /**
   * Who to introduce once the bars have finished opening, or null.
   *
   * The two are STRICTLY in order and not merely started together: the bars part
   * to the letterbox, and THEN the first player arrives. Kicking both off at
   * once was the first version and it read wrong — by the time the frame had
   * settled into its letterbox both caps were most of the way in, so the
   * movement the frame was making and the movement the caps were making
   * happened on top of each other and neither was an event.
   *
   * Spent by `tick` rather than awaited, because the bars are advanced BY tick:
   * anything resolved from elsewhere would be on a different clock from the one
   * drawing them.
   */
  let pendingIntro = null;
  /**
   * Both the point and the zoom, resolved ONCE when the ending is armed. A press
   * lands the move immediately, and a target recomputed at that moment would be
   * measured from a camera that had already travelled — the zoom would compound
   * and the framing would be a notch and a half tighter again. See
   * `GameCamera.pushIn`.
   */
  let victoryShot = null;

  /**
   * So a refresh does not replay a transition that has already happened.
   *
   * The flag only ever meant "the frame you are opening on was left covered by
   * somebody else", and the bars are shut on every load now — so all this does
   * is keep the address bar honest.
   */
  if (isHandover()) {
    const url = new URL(location.href);
    url.searchParams.delete(HANDOVER_FLAG);
    history.replaceState(null, '', url);
  }

  /**
   * The readouts. Meshes now, not DOM — see `ui/HudLayer` for why it is its own
   * scene rather than a second root inside the card layer's.
   *
   * Built before the router because the router has to test it between the cards
   * and the caps, and cannot be handed something that does not exist yet.
   * `rebuildAll` below is a hoisted declaration, so the restart closure is safe
   * to make here.
   */
  const hud = new HudLayer({
    canvas,
    config: CONFIG,
    resolution: viewport.resolution,
    // 재시작 is gone from the in-game HUD. It was the one control that could
    // throw the match away mid-play, and online it could not be honoured at all
    // — a client rebuilding its own world is a desync by definition, and the
    // relay has no message for "start again". The victory screen still offers
    // one, which is where starting over belongs: after a result, not during.
    //
    // The same fade the menu's own return uses, so leaving a match looks the
    // same however you got here.
    //
    // The sound is faded on the AUDIO clock rather than from the loop, because
    // this document is thrown away 180 ms from now and a context torn down
    // mid-voice clicks. Same 180 ms as `pageFade`, so they land together.
    onExit: () => {
      audio.play('ui_click');
      /**
       * Online, leaving is LOSING, so it asks first.
       *
       * "게임 중 나가기를 눌러도 몰수패다. 나가기 전에 확인 메시지를 띄워라."
       * Local play is unchanged and still leaves immediately — there is nothing
       * to lose and nobody waiting, and making a solo player confirm an exit
       * would be a worse screen for the common case.
       *
       * `netHalted` means the match is already over by disconnect or desync;
       * there is no longer anything to forfeit, so it leaves like a local one.
       */
      if (online && !netHalted) {
        leaveOnline();
        return;
      }
      leaveLocal();
    },
    /**
     * The camera reset, and it is deliberately not a camera call.
     *
     * `faceCurrentPlayer(true)` is the SAME function the turn change runs —
     * literally the one the per-frame invariant calls and the one `CamTracker`
     * hands back through — so "기본 구도 = 턴 전환 때 잡히는 그 구도" is true by
     * construction rather than by two places agreeing. There is no zoom, no
     * bearing and no pan written here; the framing numbers live once, in
     * `GameCamera.defaultFraming`, and `faceTo` eases to them over
     * `view.turnViewSec`.
     *
     * `force` because the seat has not changed — that is the whole point of the
     * button. Without it the invariant would find the bearing already correct
     * and leave the zoom and pan exactly where the player put them.
     */
    onRecenter: () => {
      audio.play('ui_click');
      faceCurrentPlayer(true);
    },
    // Whether there is anything to put back, for the dimming only. Asked of the
    // same bearing the reset would target — see `turnBearing`.
    atDefaultView: () => gameCamera.atDefaultFraming(turnBearing()),
    // A point that would grab one of your own caps belongs to the board, even
    // with a button drawn over it — see `HudLayer._isReserved`. The same call
    // the cards and the hover ring use, so all three agree what a cap is.
    reserved: (x, y) => input.hitTest(x, y) >= 0,
  });
  viewport.onResize(({ resolution }) => hud.setResolution(resolution));

  /**
   * UI 텍스처의 오버샘플 배수를, 화면이 실제로 몇 픽셀인지에서 계산한다.
   *
   * ── 왜 상수로 둘 수 없나 ────────────────────────────────────────────────
   * UI 는 `frame.js` 의 가상 640 폭 좌표계로 그려지고, 그 프레임이 화면에서
   * 몇 픽셀을 차지하는지는 기기마다 다르다. 3배 폰의 세로 화면에서는 프레임
   * 픽셀 하나가 화면 픽셀 여러 개가 되므로, 텍스처를 프레임 크기 그대로 구우면
   * 글자가 흐려진다 — PHASE 4 가 알파 이진화를 없애면서 그 흐림이 가려지지도
   * 않게 됐다.
   *
   * 상한 3 은 성능 안전장치다. 텍스처 면적이 배수의 제곱으로 늘고, 이 캐시에는
   * 점수판·턴 표시·버튼·카드가 전부 들어 있다.
   */
  function syncTextureScale() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const perFramePx = viewport.displaySize.x / FRAME.width;
    const next = Math.max(1, Math.min(3, Math.round(dpr * perFramePx * 2) / 2));
    if (next === CONFIG.ui.textureScale) return;
    CONFIG.ui.textureScale = next;
    /**
     * 카드만 명시적으로 비운다.
     *
     * `HudLayer` 는 매 프레임 `ui.textureScale` 을 자기 사본과 비교해서 달라졌으면
     * 스스로 캐시를 비운다 — 여기서 또 비우면 같은 일을 두 번 하는 것이다.
     * `CardLayer` 는 그 감시가 없고 `refreshTextures` 를 불러 줘야 한다.
     *
     * 캐시 키에는 이미 배수가 들어 있으므로 잘못된 해상도의 텍스처가 나오지는
     * 않는다. 비우지 않으면 이전 배수의 항목이 남을 뿐인데, 화면을 회전할 때마다
     * 한 벌씩 쌓이므로 그것도 누수다.
     */
    cards.refreshTextures();
  }
  syncTextureScale();
  viewport.onResize(syncTextureScale);
  // 그림자 프러스텀도 이 페이지가 열린 모드에 한 번 맞춘다. `rebuildAll` 은
  // 그 뒤의 전환에서만 돌므로, 이게 없으면 첫 매치가 기본 프러스텀으로 간다.
  lights.setExtents(match.arena.layout.extents);

  /**
   * Who won, and the screen that says so.
   *
   * ── it is presentation, and it is armed off a state it only READS ─────────
   * The sequence plays because `match.state` has become `OVER`, which is decided
   * in one place — `Match._endTurn`, off the rule set's verdict — and nothing
   * below touches any of it. The physics has already stopped stepping by then
   * (see the guard in `Match.update`), so there is no world left for an
   * animation to disturb even if it wanted to.
   *
   * ── it holds no caps any more, and that is most of the redesign ──────────
   * It used to be handed `capGeometry`, the board's cap artwork and both teams'
   * mark textures, because the screen was two caps fighting. There is no fight:
   * the BOARD stays on screen, this file pushes the camera in on whatever
   * decided the match, and the layer writes the result over it. All it needs is
   * the team colours, for the number's own plate.
   *
   * Built before the router, like the HUD, because the router has to test it
   * ahead of everything else and cannot be handed something that does not exist.
   */
  const victory = new VictoryLayer({
    canvas,
    config: CONFIG,
    resolution: viewport.resolution,
    teamColors: PLAYER_COLORS,
    /**
     * The result, from the seat of whoever is watching.
     *
     * Only when there IS one seat to speak from. `hasAi()` is the existing test
     * for "one person at this screen" — it is what already pins their hand to
     * the bottom and stops the viewpoint flipping between turns — and it covers
     * the online case too, because `OnlineController` reports `isAi` for exactly
     * these presentation questions.
     *
     * Two people at one board get the seat numbers back, which is right: there
     * is no "you" to address, and both of them are looking at it.
     */
    outcomeFor: (winner) => (hasAi() ? (winner === localSeat ? '승리' : '패배') : null),
    onRestart: () => {
      audio.play('ui_click');
      restartFromVictory();
    },
    /**
     * ── LEAVING is a page change, so it fades to black like every other one ──
     * Not the letterbox. Restarting and leaving look like the same button from
     * here and they are not the same event: a restart swaps the match UNDER the
     * bars and parts them again, which is one continuous shot. Leaving throws
     * the document away, and every other way out of somewhere in this project is
     * the short fade: the corner HUD's own 나가기, and the way back out of the
     * settings screen. See `ui/pageFade` for why that one is DOM rather than
     * drawn — it has to cover the letterbox bars and outlive the renderer, and
     * an in-canvas overlay drawn by a renderer that is about to stop can do
     * neither.
     *
     * `setBusy` still runs, because `.page-fade` is `pointer-events: none` and
     * therefore blocks nothing on its own — see `styles.css`. It is the victory
     * screen staying modal that stops a second press during the fade.
     */
    onExit: () => {
      if (victory.busy) return;
      victory.setBusy(true);
      audio.play('ui_click');
      audio.fadeOutForNavigation();
      fadeOut(() => location.assign(menuUrl()));
    },
  });
  viewport.onResize(({ resolution }) => victory.setResolution(resolution));

  /**
   * The camera's screen scale, so a cap is the same physical size in any window.
   *
   * The framing is authored in world units, which makes a cap however many CSS
   * pixels the canvas gives that slice of board — 40 at the reference width, and
   * proportionally fewer in a small window. `GameCamera.screenZoom` steps the
   * default framing in by whatever the canvas lost; this is the only thing that
   * has to tell it how wide the board actually is. See the note on
   * `REFERENCE_BOARD_CSS`.
   */
  const syncCameraScale = () => {
    gameCamera.setBoardCssWidth(viewport.boardClientRect().width, FRAME.boardAspect);
  };
  syncCameraScale();
  viewport.onResize(syncCameraScale);

  /**
   * Restart, under the letterbox.
   *
   * ── the same bars, run the other way ─────────────────────────────────────
   * The screen is already sitting behind an open letterbox when 재시작 is
   * pressed — the sequence ended by parting the bars — so this shuts them, the
   * world is rebuilt on the covered frame, and `playOpening` unfolds them again
   * onto the new match. That is the same object and the same movement the menu
   * used to get here, which is the point: there is one frame in this game and
   * everything happens inside it.
   *
   * It used to be `WipeOut`, a second cap wipe pointed the other way, with its
   * own forty-line clock reading `MENU_CONFIG.transition` so the two directions
   * would stay the same length. Two systems agreeing by hand, replaced by one.
   *
   * `victory.setBusy` is what stops a second press during the moment the bars
   * take to close — without it, 재시작 pressed twice starts two rebuilds and the
   * second runs against a world the first has already thrown away. `_covering`
   * is the same guard from this side, because the layer is dismissed by the
   * rebuild and stops answering before the bars have finished opening.
   */
  let _covering = false;
  function restartFromVictory() {
    if (_covering) return;
    _covering = true;
    victory.setBusy(true);
    router.cancel();
    cinematic.shut(MENU_CONFIG.transition.barSeconds);
    // On the covered frame, exactly as the menu's own swap is. `waitForCover`
    // resolves off the render loop rather than a timer, so the rebuild lands on
    // a frame that has actually been drawn opaque.
    waitForCover().then(() => {
      rebuildAll();
      _covering = false;
      playOpening().catch((err) => console.error('[intro] failed', err));
    });
  }

  /**
   * Resolve once the bars are fully shut and a frame has been drawn that way.
   *
   * Polled rather than driven by a callback on `Cinematic`, for the reason the
   * intro's own stall guard gives at length: `requestAnimationFrame` stops in a
   * background tab, and a promise that could only be settled from inside a
   * render frame would never settle there. `setInterval` keeps running when
   * throttled, so this arrives late rather than never — and arriving late is
   * survivable, because nothing is on screen but the covered frame.
   */
  function waitForCover() {
    /**
     * A wall-clock deadline on top of the bars' own progress, for the same
     * reason the opening sequence has one: `requestAnimationFrame` stops
     * entirely in a background tab, so a player who switches away between
     * pressing 재시작 and the frame going opaque would come back to a shut
     * letterbox over a match that was never rebuilt, with `_covering` still
     * refusing every press. `setInterval` keeps running when throttled, so this
     * arrives late rather than never.
     *
     * Generous, because the ordinary path takes `barSeconds` and this must never
     * fire on a machine that is merely slow.
     */
    const deadline = Date.now() + (MENU_CONFIG.transition.barSeconds + 3) * 1000;
    return new Promise((resolve) => {
      const poll = setInterval(() => {
        if (cinematic.bars < 1 && Date.now() < deadline) return;
        clearInterval(poll);
        resolve();
      }, 16);
    });
  }

  // The only thing on the canvas listening to a pointer. It decides, once per
  // press, whether the gesture is the victory screen, a card, the HUD, a shot or
  // the camera, and holds that decision until release.
  const router = new PointerRouter({
    canvas,
    aim: input,
    camera: gameCamera,
    match,
    config: CONFIG,
    cards,
    hud,
    victory,
    // The camera gestures — pan gain and turntable pivot — are measured against
    // the board, not the canvas. The overlay hit tests are not: their ortho
    // frames cover the whole canvas. See PointerRouter._boardRect.
    boardRect: () => viewport.boardClientRect(),
    /**
     * Nothing on the BOARD is pressable while a sequence owns the screen.
     *
     * Two of them. A restart shuts the bars and rebuilds the match behind them,
     * so without this there was a moment of the bars parting during which a
     * press reached the board and one of the freshly built caps fired a real
     * shot into a match the player could not yet see. And the opening sequence
     * is on screen over a match that is already sitting in AIM, so a press
     * during it would start an aim on a board the player cannot properly see.
     *
     * A press still SKIPS either sequence. That listener is `playOpening`'s for
     * the intro, and `VictoryLayer.pointerDown` for the ending — the victory
     * screen is tested BEFORE this gate, because it is a screen rather than a
     * board. See `PointerRouter._blocked`.
     */
    blocked: () => _covering || !!introLayer?.active,
    /**
     * Whether the seat on turn is a person who may act.
     *
     * The whole of "발사·카드 조작: 차단. 카메라 조작: 허용" — the router gates
     * exactly the aim and the cards on this and leaves the camera and the HUD
     * alone. Nothing had to be added for the camera: it was already ungated by
     * match state, and the note on `MATCH_STATE.GOAL_HOLD` explains why.
     */
    accepts: () => active().acceptsInput,
    /**
     * A tap on the board that was not a drag. The AI's presentation skip.
     *
     * "연출 스킵: 클릭하면 즉시 다음 단계로 점프." A no-op for a human turn,
     * because a human controller has nothing to skip.
     */
    onTap: () => active().skip?.(),
    onFire: (shot) => {
      /**
       * Sent BEFORE it is applied, and that ordering is the seed discipline.
       *
       * `OnlineMatch.localShot` reads the global seed counter as it stands right
       * now and puts it on the wire; the receiving client restores it before
       * applying. A send placed after `match.fire` would read a counter the shot
       * had already moved, and the two machines would disagree about every card
       * played afterwards. See `OnlineMatch.localShot`.
       */
      netMatch?.localShot(shot);
      match.fire(shot);
      preview.clear();
    },
  });

  /**
   * The match's ears.
   *
   * After the router, because it reads `router.mode` to tell a hover from a
   * press that has slid off its control. It only ever READS — every field it
   * touches is one the renderer already reads, its randomness is its own
   * stream, and the only physics calls it makes are queries. A match played
   * with the sound on and one played with it off produce the same hashes.
   */
  const matchAudio = new MatchAudio({
    audio,
    config: CONFIG,
    match,
    input,
    router,
    cards,
    hud,
    victory,
  });

  /**
   * One path for every structural change: a slider that changes what a cap IS,
   * the new-match button, the restart button, a mode switch.
   *
   * They are all the same operation from the world's point of view — throw it
   * away and build it again — and giving them separate paths is how one of them
   * ends up forgetting to rebuild the meshes, or refit the camera, or clear a
   * preview that is still holding a copy of a world that no longer exists.
   *
   * The ZOOM and the BEARING are deliberately not touched. They live on the
   * config and survive all of this, which is what "줌 레벨과 회전 각도는 턴이
   * 바뀌어도 유지된다" asks for — and a rebuild is a much bigger event than a
   * turn change, so if anything were going to reset them, it would be this. The
   * only thing that clears the bearing is moving to a mode that cannot turn,
   * which `setRotatable` does and explains.
   */
  /**
   * @param {number} [seed]
   *   the new match's root seed. Omitted means "draw a fresh one", which is what
   *   every way a PLAYER starts a match wants: 재시작, 새 매치, a mode switch.
   *
   *   Passed means "the same luck again". Two callers want that and they are
   *   both tuning tools rather than play: the panel's structural sliders, which
   *   rebuild the world on every drag and must not reroll the orbs out from
   *   under the thing being judged, and its explicit 같은 시드로 재시작.
   */
  function rebuildAll(nextMode = null, seed) {
    if (nextMode && nextMode !== match.mode) match.setMode(nextMode, seed);
    else match.start(seed);

    // Whatever brought us here — the victory screen's own 재시작, the panel's
    // 새 매치, a mode switch, a slider that changed what a cap IS — the match
    // that was won no longer exists, so the screen announcing it must not still
    // be up. Here rather than in the restart path, for the reason this whole
    // function exists: giving them separate paths is how one of them forgets.
    victory.dismiss();
    view.rebuild(match.arena);
    cardFx.setArena(match.arena);
    gameCamera.setFixedPitch(pitchFor(match.mode));
    gameCamera.setRotatable(!!match.mode.camera?.rotatable);
    /**
     * The play area takes the FIELD's shape, so the frame has to be told what
     * that is — a square knockout board and a long curling lane want very
     * different regions, and giving both the screen's shape wastes half of it
     * on one and crops the other. Before `setExtents`, so the camera's own
     * re-fit below already sees the region it will be drawn into.
     */
    const ext = match.arena.layout.extents;
    if (setFieldAspect(ext.x / ext.z)) {
      updateFrame(window.innerWidth, window.innerHeight);
      viewport.refit();
    }
    gameCamera.setExtents(ext);
    /**
     * 그림자 카메라도 같은 필드에 맞춘다.
     *
     * 여기서 빼먹으면 커링 레인에 맞춘 프러스텀이 알까기 보드에 그대로 남아
     * 2048 텍셀의 대부분이 빈 공간에 쓰인다. 모드를 바꿀 때마다 그림자가
     * 뭉개지는데, 원인이 그림자 코드가 아니라 이 한 줄의 부재라 찾기 어렵다.
     */
    lights.setExtents(ext);
    // 프러스텀이 바뀌었으므로 맵도 한 번 다시 그려야 한다. `view.rebuild` 를 거치는
    // 모드 전환은 `_shadowLast` 가 비워져 저절로 갱신되지만, 필드 비율만 바뀌는
    // 경로는 그러지 않는다 — 그 한 경로 때문에 여기 한 줄이 있다.
    viewport.renderer.shadowMap.needsUpdate = true;
    // After the extents, because the range is re-clamped against the new fit and
    // clamping against the old one would put the zoom somewhere neither mode
    // allows for a frame.
    const range = zoomRangeFor(match.mode);
    gameCamera.setZoomRange({
      min: range.minZoom,
      max: range.maxZoom,
      turn: range.turnZoom,
      screenMax: range.screenZoomMax,
    });
    /**
     * And the sound's memory of the match that no longer exists.
     *
     * Every audio observation is a comparison against the previous frame, and
     * this is the one event that makes the previous frame describe a DIFFERENT
     * match — new rules, new bodies, the score back to zero. Without it a
     * restarted football match announces a goal on its first turn, because the
     * observer still remembers the score the last one finished on.
     *
     * Alongside `view.rebuild` and `cardFx.setArena` for the reason this whole
     * function exists: giving each of these its own path is how one of them ends
     * up forgetting.
     */
    matchAudio.reset();
    /**
     * And the camera's memory of a throw that no longer exists.
     *
     * Same reason again, and it has one of its own: the tracker holds cap
     * INDICES and a list of which caps were in the pit, and the world those
     * describe has just been thrown away. Without this a rebuild taken mid-turn
     * — a structural slider, a mode switch — leaves it following an index into a
     * different arena, and every cap in the new one reads as having just fallen.
     */
    camTracker.reset();
    preview.clear();
    router.cancel();
    /**
     * And whatever the opponent was in the middle of deciding.
     *
     * Same reason as `camTracker.reset` above and stated the same way: the
     * controller holds cap INDICES, a plan built against a world that has just
     * been thrown away, and a snapshot of it. Left alone, a rebuild taken during
     * an AI turn — a structural slider, a mode switch, 재시작 — would fire a
     * planned shot into a completely different arena.
     */
    for (const c of controllers) c?.cancel?.();
    // No deal. Hands are the match's now and `match.start()` has just emptied
    // them; the per-frame sync in `tick` puts the (empty) fans on screen.
    // A new match opens on the first player's own half at the widest zoom, the
    // same view every turn change asks for. `force`, because the player may not
    // have changed and the framing still has to be put right.
    faceCurrentPlayer(true);
  }


  /**
   * The measurement panel. NOT behind `?debug=1`, and that is the whole point.
   *
   * `?debug=1` is a query on the launch URL, and a packaged app has no address
   * bar to put one in — so every existing readout in this project is unreachable
   * on the device it most needs to be read on. This one is gated on a tap
   * instead, and remembers where it was left.
   *
   * `performance.now()` here is milliseconds since navigation start, so it is
   * the honest boot cost of this document: the module graph, the Rapier WASM
   * compile, every texture generated at startup, and the first world build. It
   * is taken at the end of `boot()`'s body rather than at the first frame
   * because the first frame is the thing it is timing the run-up to.
   */
  const debugRequested = new URLSearchParams(location.search).get('debug') === '1';

  /**
   * Off unless asked for. The stub keeps the loop's two calls honest.
   *
   * It was unconditional once, back when the question was "does this run at all"
   * — it is wrong as a thing sitting in the corner of a game nobody is
   * measuring. The instrument stays: every sampling call site and the whole
   * readout are intact, it simply does not mount itself unless the flag is on.
   *
   * Note that the panel is not free — see docs/metrics.md on why a frame time
   * read with `?debug=1` on is not the frame time of the shipping build.
   */
  const metrics = debugRequested ? new MetricsOverlay({ bootMs: performance.now() }) : NO_METRICS;

  /**
   * What the frame costs WITHOUT the AI, so the search can be given the rest.
   *
   * Unconditional, unlike `metrics` above: this is not an instrument, it is how
   * the search is sized, and a build without `?debug=1` is exactly the build
   * that has to be fast. It is fed from the same two numbers `metrics.endFrame`
   * is handed at the bottom of the tick. See `ThinkBudget`.
   */
  const thinkBudget = new ThinkBudget();

  /**
   * The tuning panel, behind `?debug=1`.
   *
   * It is a hundred sliders over the top-right quarter of the screen, and it is
   * for building the game rather than for playing it. Off by default; the stub
   * keeps the loop's two calls honest so neither has to know whether the panel
   * exists.
   *
   * Every value it edits still lives on `CONFIG`, so nothing about the game
   * changes when it is absent — the numbers are the same numbers, there is just
   * nothing on screen to drag them with.
   */
  const debug = debugRequested
    ? bootPhysicsDebug({
        match,
        view,
        camera: gameCamera,
        tracker: camTracker,
        router,
        retro,
        composer,
        viewport,
        config: CONFIG,
        preview,
        cards,
        cardFx,
        hud,
        victory,
        audio,
        audioSettings,
        graphicsSettings,
        // Structural sliders keep the seed: dragging 뚜껑 크기 rebuilds the world
        // on every step, and rerolling the orbs each time would change the thing
        // being judged along with the thing being dragged.
        onRebuild: () => rebuildAll(null, match.seed),
        onModeChange: () => rebuildAll(modeByKey(CONFIG.mode)),
        // ...and these two are explicit about which they want.
        onNewMatch: () => rebuildAll(),
        onReplaySeed: (seed) => rebuildAll(null, seed),
        // The seats, so the panel can force one either way mid-match, and the
        // SAME reset the HUD button and the turn change both go through.
        controllers,
        setOpponent,
        onRecenter: () => faceCurrentPlayer(true),
        // Null in local and AI play, which is what makes the panel leave the
        // online folder out entirely rather than showing one full of dashes.
        online,
        profile,
        onReplayIntro: () => playOpening(),
        onForceDesync: () => {
          if (netMatch) netMatch.forceDesync = true;
        },
        onDumpLog: () => console.log(netMatch?.log?.serialize() ?? '(no log)'),
        onExportLog: () => exportInputLog(),
      })
    : { refresh() {}, refreshCamera() {} };

  // ── online lifecycle ──────────────────────────────────────────────────────

  /**
   * True once the match has been stopped by the network rather than by the game.
   *
   * A forfeit, a dropped opponent or a desync all end the match from OUTSIDE the
   * rules, so `match.winner` is not set and the victory sequence will not fire.
   * This is what the exit path and the input gate read instead.
   */
  let netHalted = false;

  async function startOnline() {
    if (!online) return;
    online.on('desync', () => {
      // Loud, and the match stops. "조용히 넘어가지 마라. 서로 다른 게임을 하게
      // 되는 게 최악이다." The dump is on the session for the debug panel.
      console.error('[online] DESYNC', online.desync);
    });

    online.on('over', (m) => {
      if (netHalted) return;
      netHalted = true;
      const won = m.winner === online.mySeat;
      /**
       * Three endings, three messages, and they are deliberately not the same
       * screen as a normal win. A forfeit win is an ANNOUNCEMENT, not a
       * celebration — "통쾌함이 아니라 안내다".
       */
      const text =
        m.reason === 'desync'
          ? { title: '게임 중단', body: '두 기기의 시뮬레이션이 어긋나 게임을 중단했습니다.' }
          : m.reason === 'disconnect'
            ? { title: '상대 연결 끊김', body: m.message ?? '상대방의 연결이 끊어졌습니다. 부전승으로 처리됩니다.' }
            : m.reason === 'forfeit'
              ? { title: '상대 기권', body: m.message ?? '상대방이 게임을 나갔습니다. 부전승으로 처리됩니다.' }
              : { title: won ? '승리' : '패배', body: '' };
      if (m.reason === 'played') return; // the ordinary victory sequence owns this
      modal.tell({ ...text }).then(() => {
        audio.fadeOutForNavigation();
        fadeOut(() => location.assign(menuUrl()));
      });
    });

    const url = profile.server || defaultServerUrl();
    try {
      await online.connect(url);
    } catch {
      await modal.tell({
        title: '연결 실패',
        body: '서버에 연결할 수 없습니다. 메뉴로 돌아갑니다.',
      });
      location.assign(menuUrl());
      return;
    }
    online.resume();

    /**
     * The sequence runs BEFORE `ready`, and that ordering is the fairness rule.
     *
     * The server starts no clock until both clients have reported ready, so the
     * two-and-a-half seconds spent watching this come out of nobody's fifteen.
     * "연출 때문에 시간을 잃으면 부당하다" — the cheapest way to honour that is
     * for the clock not to exist yet, rather than for it to be paused and
     * resumed and to hope the two clients pause for the same length of time.
     */
    await playOpening();
    online.ready();
  }

  /**
   * Play the match-found sequence to its end, or until somebody skips it.
   *
   * Resolves rather than blocking: the render loop is already running and is
   * what advances it — this only waits. A sequence driven from here with its own
   * timer would run on a different clock from the one drawing it.
   */
  /**
   * What the two caps are called, whoever they belong to.
   *
   * Online it is the two nicknames. Against the computer the far seat is 'AI',
   * which is what the turn plate has always called it. Two people at one screen
   * get PLAYER 1 and PLAYER 2, because that is who they are — the local player
   * may have a nickname set for online play, and using it here would label one
   * seat with a name and the other with a number.
   */
  function introNames() {
    if (online) {
      return {
        selfSeat: online.mySeat,
        selfName: online.nickname || '나',
        opponentName: online.opponent?.nickname || '상대',
      };
    }
    const vsComputer = !!controllers[remoteSeat]?.planner;
    return {
      selfSeat: localSeat,
      selfName: vsComputer && profile.named ? profile.nickname : `PLAYER ${localSeat + 1}`,
      opponentName: vsComputer ? 'AI' : `PLAYER ${remoteSeat + 1}`,
    };
  }

  /**
   * The whole way in: the bars unfold, the two players are introduced, the bars
   * retreat and the UI fades up.
   *
   * ── stage 1 and stage 5 happen whatever `intro.enabled` says ─────────────
   * The document opens on a shut letterbox, so SOMETHING has to part it. With
   * the introduction off this is the bars opening and the UI arriving and
   * nothing else, which is still the right opening: cutting from a covered
   * frame straight to a live board is the hard cut the bars exist to replace.
   *
   * ── it resolves off the render loop, not off a timer ─────────────────────
   * The loop is already running and is what advances both the bars and the
   * layer. A sequence driven from here with its own timer would run on a
   * different clock from the one drawing it, and the two would disagree on any
   * machine that dropped a frame.
   *
   * @returns {Promise<void>} settled when the match is playable
   */
  function playOpening() {
    // The bars are this function's from here on. See the note in `tick`.
    victoryHeldBars = false;

    const introduce = !!introLayer && CONFIG.intro?.enabled !== false;
    if (introduce) {
      // Stage 1. The bars part to the LETTERBOX and the gate stays shut, so the
      // board is on screen and none of the UI over it is. The introduction
      // starts when they arrive — `pendingIntro`, spent in `tick` — and what
      // opens them the rest of the way is that introduction reaching its last
      // segment, which is the `introLayer.exiting` branch there.
      cinematic.close(CONFIG.intro.barSeconds);
      pendingIntro = introNames();
    } else {
      // Nobody to introduce, so there is nothing for a letterbox to hold: the
      // bars go straight from shut to open and the UI comes up with them. Still
      // the bars, though — "바를 통째로 건너뛰지 마라". Cutting from a covered
      // frame to a live board is the hard cut they exist to replace, and it is
      // also what a cold `/survival` would open on.
      cinematic.open(CONFIG.intro.barSeconds);
    }

    /**
     * Cut the whole thing to its end. NOT a player control — see below.
     *
     * ── nothing is bound to a press, and that is on instruction ────────────
     * A window listener sat here for one revision, because 부록 D6.3 asked for
     * the opening to be skippable. It is gone again on instruction, and the
     * mechanism is deliberately absent rather than merely unbound: the only
     * caller is the stall guard, and a live listener that only fires on a dead
     * frame clock cannot be pressed by accident.
     *
     * The board underneath already refuses every press for the whole of this
     * (`blocked` on the router) and the HUD and the hand are gated to nothing by
     * `uiGate` — so a press during the opening now does nothing at all, which is
     * the whole of the rule.
     *
     * Online it costs nobody anything, which is worth stating because it is the
     * only place it could: `ready` is sent after this resolves, and the server
     * starts no clock until both clients have reported it. Sitting through the
     * opening is not sitting on your own turn timer.
     */
    const cutToEnd = () => {
      // Called before the bars had finished: there is nothing to introduce yet,
      // and the introduction must not start after this has ended it.
      pendingIntro = null;
      if (introduce) introLayer.skip();
      // Straight to the frame the sequence would have reached: bars open, gate
      // up. `snap` rather than a zero-length tween, which would still owe an
      // `update` before it landed.
      cinematic.snap(0, { gate: 1 });
    };

    return new Promise((resolve) => {
      /**
       * A wall-clock deadline on top of the sequence's own progress.
       *
       * ── found by backgrounding a tab, and it forfeited the match ──────────
       * The sequence is advanced from `tick`, which is driven by
       * `requestAnimationFrame` — and a browser stops calling rAF entirely in a
       * background tab. So a player who switched away during the intro never
       * finished it, never sent `ready`, and the room sat in HANDOFF until the
       * server timed it out and awarded the game to the other side. Losing a
       * match for looking at another tab during a two-second animation is not a
       * rule anybody agreed to.
       *
       * `setInterval` keeps running when throttled — at about 1 Hz, but running
       * — so a deadline measured against `Date.now()` survives exactly the case
       * that breaks the rAF clock. Generous, because it must never cut short a
       * sequence that is merely playing on a slow machine.
       *
       * The budget covers the bars at both ends as well as the introduction,
       * because they are part of what this is waiting for now.
       */
      const span =
        CONFIG.intro.barSeconds +
        (introduce ? introLayer.duration : CONFIG.intro.exitSec) +
        3;
      const deadline = Date.now() + span * 1000;
      const poll = setInterval(() => {
        const stalled = Date.now() > deadline;
        const running = (introduce && (pendingIntro || introLayer.active)) || !cinematic.settled;
        if (running && !stalled) return;
        // The safety net for a frame clock that has stopped — see above. It is
        // the ONLY caller of `cutToEnd`: there is no player skip.
        if (stalled) cutToEnd();
        clearInterval(poll);
        resolve();
      }, 50);
    });
  }

  startOnline().catch((err) => console.error('[online] start failed', err));

  /**
   * Local and AI matches open on the same sequence.
   *
   * Not called for an online match: `startOnline` plays it there, and it has to
   * happen at a specific point in that sequence — after the socket is attached
   * and BEFORE `ready`, so the server's clock cannot start while it runs.
   * Kicking off a second one here would play it twice.
   */
  if (!online) playOpening().catch((err) => console.error('[intro] failed', err));

  /**
   * Write the match's input log out as a file.
   *
   * The same format `tools/determinism` replays, so a match that desynced can be
   * re-run offline under two engines rather than described from memory. That is
   * the whole reason the log exists in the online path at all.
   */
  function exportInputLog() {
    const log = netMatch?.log;
    if (!log) return;
    const blob = new Blob([log.serialize()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bcc-${log.mode}-${online?.match?.roomId ?? 'log'}.json`;
    a.click();
    // Revoked on the next tick: revoking synchronously can beat the download
    // starting, and the object is a few kilobytes held for one frame.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  /**
   * Leave an online match on purpose.
   *
   * The concession is sent BEFORE the navigation and the fade, because the
   * document is about to be destroyed and with it the socket: a forfeit posted
   * after `location.assign` may never leave the machine, and the opponent would
   * then sit through the heartbeat timeout instead of being told immediately.
   * Reported as a forfeit rather than a disconnect so they get the right message.
   */
  /**
   * Leave a local match on purpose.
   *
   * ── 부록 B: 이제 묻는다 ──────────────────────────────────────────────────
   * 예전에는 바로 나갔고, 근거는 "브리프가 확인 단계를 배제한다. 버튼에서
   * 손을 떼면 잘못 누른 것은 되돌릴 수 있다" 였다. 그 근거의 뒷부분은 여전히
   * 참이지만, 손을 떼는 것은 **누르는 동안** 알아차렸을 때만 듣는다.
   *
   * 부록 B 는 나가기를 DESTRUCTIVE 로 못박았다. 진행 중인 경기는 저장되지 않고,
   * 이 문서는 곧 버려진다 — 되돌릴 수 없다는 뜻이고, 되돌릴 수 없는 것은 묻는다.
   * 온라인이 이미 그렇게 하고 있었으므로(몰수패), 다른 것은 문장뿐이다.
   */
  async function leaveLocal() {
    const go = await modal.confirm({
      title: '게임 나가기',
      body: '진행 중인 경기는 저장되지 않습니다. 나가시겠습니까?',
      confirmLabel: '나가기',
      cancelLabel: '계속하기',
      danger: true,
    });
    if (!go) return;
    audio.fadeOutForNavigation();
    fadeOut(() => location.assign(menuUrl()));
  }

  async function leaveOnline() {
    const go = await modal.confirm({
      title: '게임 나가기',
      body: '지금 나가면 몰수패로 처리되고 상대가 승리합니다. 나가시겠습니까?',
      confirmLabel: '나가기',
      cancelLabel: '계속하기',
      danger: true,
    });
    if (!go) return;
    netHalted = true;
    netMatch?.forfeit();
    audio.fadeOutForNavigation();
    fadeOut(() => location.assign(menuUrl()));
  }

  // ── loop ─────────────────────────────────────────────────────────────────
  let raf = 0;
  let last = 0;
  /** 클램프 전의 프레임 간격, ms. `frame` 이 쓰고 `tick` 이 읽는다. */
  let rawFrameMs = 0;
  /** 1 = the HUD and the hand are up, 0 = a shot is being drawn. See `tick`. */
  let uiFade = 1;
  /** Whether the victory sequence has already been started for this match. */
  let victoryArmed = false;

  /**
   * One whole frame, given a time step.
   *
   * Split out from the rAF callback so a frame can be driven by hand — which is
   * the only way to verify any of this. Determinism, "the turn always ends
   * inside eight seconds", "a cap hit high flips": every one of those is a claim
   * about a specific number of simulated steps, and watching for it in real time
   * is neither repeatable nor precise. Calling this in a loop from the console
   * runs the identical code path the display does.
   */
  function tick(dt) {
    const tickT0 = performance.now();
    /**
     * The network's frame, first.
     *
     * Before anything else in the tick, because what it does is APPLY the
     * opponent's move — and a move applied after the match has already stepped
     * this frame lands one step late on this machine and on time on the other,
     * which is a divergence for free. It is also where the turn report goes out,
     * and that has to see the state the previous frame ended in.
     */
    netMatch?.update();
    // The frame has finished arriving; now somebody can walk into it.
    if (pendingIntro && cinematic.settled) {
      introLayer.begin(pendingIntro);
      pendingIntro = null;
    }
    introLayer?.update(dt);

    /**
     * The bow is drawn only while the router says a shot is being drawn.
     *
     * Checked every frame rather than trusted, because the thing that breaks it
     * is the browser declining to deliver an event: leave the window mid-charge
     * and the `pointerup` may simply never arrive, and `AimInput` is then stuck
     * aiming forever. `begin` refuses to start a second aim while one is live,
     * so every press after that fell through to the camera and the game looked
     * frozen with only the zoom working.
     *
     * The router has its own handlers for every way a gesture can die. This is
     * the invariant those handlers exist to maintain, enforced where it cannot
     * be missed — one comparison a frame against a whole class of lockup.
     */
    if (input.aiming && router.mode !== DRAG_MODE.AIM) input.cancel();

    // No input.update(dt). The bow has no time term at all — power is a pull
    // distance, so there is nothing for a frame time to advance.
    //
    // Bracketed rather than instrumented from inside: `Match.update` owns the
    // accumulator and `PhysicsWorld.step` is the hot call, and neither is a
    // place to put a timer. Everything the panel reports about physics is read
    // from OUTSIDE — the wall time of this call, the step counter's delta, and
    // the accumulator's leftover — so nothing in the sim knows it is measured
    // and the numbers are the same whether the panel is up or not.
    const physT0 = performance.now();
    const stepsBefore = physics.steps;
    match.update(dt);
    const physicsMs = performance.now() - physT0;
    const steps = physics.steps - stepsBefore;

    /**
     * The seat on turn gets a frame.
     *
     * ── the turn is OPENED here, off the state rather than an event ─────────
     * The same reasoning `faceCurrentPlayer` gives at length for being an
     * invariant: every event-driven version of "the AI's turn has begun" has a
     * path that does not fire. There are five of them here — a fresh match, a
     * settled turn, the far side of a card effect, a 원모어 extra turn, and a
     * rebuild from the panel — and `_beginAim` is reached differently by each.
     * Asking `is it an idle AI's go and is a shot legal` covers all five and
     * cannot miss a sixth.
     *
     * `phase === 'idle'` is what keeps it from re-arming: the controller is
     * mid-sequence for the whole of its turn, including the stretch where the
     * match sits back in AIM after its card effect has played.
     *
     * A human controller's `begin` and `update` are empty, so local play runs
     * exactly the code it always did plus two calls that do nothing.
     */
    const controller = active();
    if (
      controller.isAi &&
      controller.phase === 'idle' &&
      match.state === MATCH_STATE.AIM &&
      !victory.active &&
      // ...and not while the opening sequence is on screen. The AI would
      // otherwise think, choose and fire behind it, and the sequence would hand
      // over to a board where a turn had already been taken.
      !introLayer?.active
    ) {
      controller.begin({ match });
    }
    // The AI's search is sliced across frames and is by far the largest single
    // cost in the app — up to ~100 rollouts of ~95 solver steps each, three
    // times over on a turn that plays two cards. Timed separately from the
    // physics above because it steps a DIFFERENT world (a snapshot restored into
    // its own `RAPIER.World`), so it never shows up in `physics.steps`.
    const aiT0 = performance.now();
    // How much of THIS frame it may have, worked out from what the last few
    // frames cost WITHOUT it. See `ThinkBudget` — it changes how long the search
    // takes and nothing about what it decides.
    controller.update(dt, { match, thinkBudget });
    const aiMs = performance.now() - aiT0;
    const aiThinking = !!controller.isAi && controller.phase !== 'idle';

    /**
     * The winning sequence, armed on the EDGE into `OVER`.
     *
     * An edge and not a state test, because `begin` restarts the animation from
     * frame one: driven off `match.state === OVER` directly it would re-arm every
     * frame and the loser would hang in the middle forever, never being hit.
     *
     * `match.winner` is read once, here, and passed in. It is `-1` for a draw and
     * `undefined` on the one path that reaches `OVER` without a verdict — the
     * `shooterFor() < 0` branch in `Match._beginAim` — and `VictoryLayer.begin`
     * treats both as a draw rather than the game's judging being changed to suit
     * the animation.
     *
     * `router.cancel()` because a gesture in progress belongs to a match that has
     * just ended; the screen about to come up is modal and a camera pan surviving
     * underneath it would keep turning the board behind the dimming.
     */
    if (match.state === MATCH_STATE.OVER) {
      if (!victoryArmed) {
        victoryArmed = true;
        router.cancel();
        hud.clearHover();
        /**
         * The tracker is let GO of, not merely switched off.
         *
         * It hands the camera back when a turn ends — `_release` calls
         * `faceCurrentPlayer(true)` through its callback — and that reset would
         * fight the push-in for the whole of stage 1, on its own clock. `reset`
         * drops the ride and the hand-back together, and the gate below keeps it
         * from starting another one while the screen is up.
         */
        camTracker.reset();
        victory.begin(match.winner, {
          // The mode's own line under the winner, if it has one to give — see
          // `RuleSet.resolveTurn`'s `resultNote`. Undefined in the two modes
          // whose result explains itself.
          note: match.lastVerdict?.resultNote ?? null,
          /**
           * And the mode's own NUMBER, frozen here.
           *
           * The same function the corner HUD has been reading all match, so the
           * result screen says the thing the scoreboard said rather than a
           * second opinion about it: 3–0 caps left, 2–1 goals, 2–1 rounds. This
           * is what the old screen could not do — it played the same two caps
           * hitting each other whatever the mode was.
           */
          board: scoreboardFor(match.mode, match.rules, CONFIG),
        });
        victoryShot = {
          point: decisivePoint(match.winner),
          zoom: gameCamera.zoom * Math.max(0.01, CONFIG.victory.pushZoom),
        };
        gameCamera.pushIn(victoryShot.point, victoryShot.zoom, CONFIG.victory.freezeSeconds);
        /**
         * One of the ending's two celebratory beats, and it is borrowed whole.
         *
         * `CardFx` already draws a glint and one soft ring over a player's caps
         * — it is the 원모어 flourish — so the winning caps get that, with no
         * card behind it. The other beat is the carbonation in `ResultFizz`.
         * There is no third, and there is no new effect system: a result screen
         * with its own particle vocabulary is a result screen that looks like a
         * different program, which is the mistake the old one made.
         */
        if (match.winner === 0 || match.winner === 1) {
          cardFx.play('onemore', match.winner, CONFIG.victory.sparkleSeconds);
        }
      }
      /**
       * A press through the sequence lands the camera where it was going.
       *
       * "눌러서 건너뛰면 그 다음 프레임이 시퀀스가 도달했을 프레임과 동일하다" —
       * the layer snaps its own values inside `skip`, and this is the half of
       * that frame the layer does not own.
       */
      if (victory.skipped && victoryShot) {
        gameCamera.pushIn(victoryShot.point, victoryShot.zoom, 0);
        // And the frame with it. A skip jumps the clock straight past BARS, so
        // the branch below never runs `close()` and the gate would still be
        // open — the match's own HUD would come back up beside the result
        // screen's two buttons, which is the one thing the gate exists to
        // prevent. `snap` rather than a zero-length tween, which would still
        // owe an `update` before it landed.
        cinematic.snap(0, { gate: 0 });
        victoryShot = null;
      }
    } else {
      victoryArmed = false;
      victoryShot = null;
      /**
       * The match is no longer over, so the screen saying it was must not be up.
       *
       * The path that needs this is the panel's determinism replay:
       * `Match.replayLastTurn` puts the state back to AIM and re-fires the stored
       * shot, and it deliberately does not touch `winner` — so without this a
       * modal victory screen would sit over a live turn, taking every press, and
       * the only ways out would be the two buttons that throw the match away.
       *
       * `forced` is what keeps the panel's own 강제 재생 alive: that one is played
       * over a match that was never over in the first place, and the loop has no
       * business taking it back down. See `VictoryLayer.begin`.
       */
      if (victory.active && !victory.forced) victory.dismiss();
    }

    /**
     * The letterbox, driven off whichever sequence owns the screen.
     *
     * Asked for a TARGET every frame rather than stepped on a stage edge.
     * `Cinematic.to` is idempotent, so the two are the same thing when nothing
     * is missed — and unlike an edge this cannot be missed by a frame long
     * enough to step over a whole stage, which is what a tab coming back from
     * the background hands the loop.
     *
     * RELEASE opens the bars and deliberately does NOT re-open the UI gate. The
     * match's own HUD says the same things this screen says — the score, and a
     * 나가기 — and two 나가기 buttons on one frame reads as the game being
     * broken. `Cinematic` keeps the gate as its own tween for exactly this
     * case; see the note there.
     */
    if (_covering) {
      /**
       * The restart owns the bars and nothing else may write them.
       *
       * It shut them on purpose and the world is being rebuilt behind them, and
       * every other branch here would open them again — the ending's, because
       * the screen is still up until `rebuildAll` dismisses it, and the
       * hand-back below, because it fires the moment that dismissal lands. This
       * is checked first rather than added as a condition to each of them: a
       * gate written three times is a gate that will be written twice.
       */
    } else if (victory.active) {
      const vc = CONFIG.victory;
      victoryHeldBars = true;
      if (victory.clock.atOrPast(VICTORY_STAGE.RELEASE)) cinematic.to(0, vc.releaseSeconds);
      else if (victory.clock.atOrPast(VICTORY_STAGE.BARS)) cinematic.close(vc.barSeconds);
    } else if (victoryHeldBars) {
      /**
       * The screen has gone and the bars are still its. Hand them back.
       *
       * Written as "whoever had them, has them no longer" rather than as a call
       * at each of the three sites that can take the screen away — the loop's
       * own dismiss on a replayed turn, `rebuildAll`, and the panel's 연출
       * 내리기. Three call sites is three chances to forget one and leave the
       * player looking at a shut letterbox with no way out of it.
       *
       * `playOpening` clears this on its way in, because a restart shuts the
       * bars ON PURPOSE and owns them from that moment.
       */
      victoryHeldBars = false;
      cinematic.open(CONFIG.victory.releaseSeconds);
    } else if (introLayer?.active && introLayer.exiting) {
      // The way IN: the bars retreat on the same window the two caps slide to
      // the corners the match keeps their hands in, so the introduction does not
      // end and then get uncovered — it ends BY being uncovered.
      cinematic.open(CONFIG.intro.exitSec);
    }

    // A goal used to re-deal both hands here. It must not: a hand is carried
    // across goals and rounds now, and the only thing that empties one is a new
    // match. See `CardHands.reset`.

    // Before the camera's own update, so the turn-over it may have just asked
    // for is eased on this frame rather than on the next one.
    //
    // The answer is kept because the tracker needs it: it tells the difference
    // between a turn that has just been reframed for the next player and one
    // that nobody is going to reframe at all. See `CamTracker._release`.
    const reframed = faceCurrentPlayer();

    /**
     * Ride with the ball while the turn is being played out.
     *
     * Only while LIVE: the moment the turn resolves, `faceCurrentPlayer` takes
     * the view back for the next player, and a follow still holding the pan
     * target would drag against it. `stopFollow` is unconditional for the same
     * reason — it is the state leaving LIVE that ends the follow, not the ball
     * happening to stop.
     */
    if (
      // ── 설정 화면의 "카메라 추적" 은 이 줄도 끈다 ──────────────────────────
      // `view.track` 은 오랫동안 `CamTracker` 만 가리켰고, 축구는 그 트래커를
      // 켜지 않는다 — 축구가 따라가는 것은 공이고 그건 바로 아래의 다른 기전이다.
      // 그래서 추적을 끈 사람이 축구에서는 아무 변화도 얻지 못했다. 화면에 스위치는
      // 하나뿐이고 그 스위치가 말하는 것은 "카메라가 알아서 따라가는가" 이므로,
      // 모드마다 무엇을 따라가든 그 하나가 끈다.
      //
      // 턴이 넘어갈 때 시점이 도는 것은 여기에 들어오지 않는다. 그건 따라가는
      // 것이 아니라 다음 사람에게 판을 건네는 것이고, 끄면 상대편 끝에서 조준하게
      // 된다 — `faceCurrentPlayer` 를 보라.
      CONFIG.view.track &&
      CONFIG.view.followBall &&
      match.state === MATCH_STATE.LIVE &&
      match.arena.hasBall
    ) {
      gameCamera.followTo(match.arena.ballCom());
    } else if (match.state !== MATCH_STATE.LIVE) {
      gameCamera.stopFollow();
    }

    /**
     * And ride with the CAP in the two modes that are watched that way.
     *
     * Beside the ball follow rather than folded into it, because they are two
     * different behaviours that happen to end at the same method: that one is a
     * bare pan target on a ball and exists only in football; this one is a
     * spring, a fall cut and a hand-back, and exists only where a mode says
     * `camera.track`. Football names no such flag, so the two can never both be
     * live — `hasBall` is football-only and `track` is the other two — and the
     * football camera is exactly the camera it was.
     *
     * Everything it needs is handed in, so it imports nothing from `game/`:
     * `match.shooter` is the cap the shot was fired with (`_liveShooter` while
     * the turn plays out), and the line to keep on screen is the mode's.
     */
    camTracker.update({
      dt,
      live: match.state === MATCH_STATE.LIVE,
      arena: match.arena,
      shooter: match.shooter,
      // ...and not once the ending has the camera. `reset` dropped whatever it
      // was holding when the sequence armed; this is what stops it starting
      // another ride, and what keeps its hand-back from firing behind the
      // push-in. See the `camTracker.reset()` above.
      enabled: !!match.mode.camera?.track && !victory.active,
      keepZ: match.mode.camera?.keepLineZ?.(match.arena) ?? null,
      reframed,
      /**
       * The other half of "nobody is arriving to reset it for".
       *
       * `faceCurrentPlayer` above stops moving the pan against an AI, and the
       * tracker has a SECOND path to the same place: when a turn ends without
       * changing hands — an extra-turn card — nothing reframes, so it eases the
       * pan home itself. Left alone that would put the yank back on exactly the
       * turns the handover no longer yanks, which is worse than either rule on
       * its own.
       */
      keepView: aiKeepsZoom(),
      /**
       * The tracker has finished riding the shot and is handing the view back.
       *
       * `force`, because this is not a turn change and the framing has to be
       * reasserted anyway — but NOT a request for the default zoom. Against an
       * AI this fires after every single shot, so left as a plain
       * `faceCurrentPlayer(true)` it pulled the player's zoom back out twice a
       * turn no matter what the handover did.
       */
      onReturn: () => faceCurrentPlayer(true, { keepZoom: aiKeepsZoom() }),
    });

    // The camera does have one: rotation inertia and the pan glide run on WALL
    // CLOCK, deliberately outside the fixed-step loop. Neither is in the state
    // hash, and a field that happened to be spinning must not change how many
    // physics steps a turn takes.
    gameCamera.update(dt);
    // 배경의 광점. 렌더 클럭이고, 게임 상태를 읽지도 쓰지도 않는다 —
    // `MatchAudio` 가 읽기 전용인 것과 같은 이유다.
    sky.update(dt, gameCamera.camera);

    updateAim();

    // Before the view, so a cap's shake and shrink are on this frame's transform
    // rather than on the last one's.
    /**
     * The frame's collisions, read once and shared.
     *
     * `MatchAudio` owns the only collision observer in the project — there is no
     * `EventQueue` anywhere, deliberately — and 철벽's ring has to flash on the
     * frame a braced cap is hit. So the reading is pulled forward to here and
     * both the sound and the ring see the same one. `matchAudio.update` below
     * does not read it again; see the note on `observe`.
     *
     * Still read-only, so this changes nothing about the simulation: a match
     * played with the sound off produces the same hashes as one played with it
     * on, and that is still true with the call moved.
     */
    matchAudio.observe();
    cardFx.update({ dt, match, camera: gameCamera.camera, struck: matchAudio.struckCaps });
    view.update(match.alpha, match.rules.alive, cardFx);

    /**
     * 그림자 맵은 그림자를 던지는 것이 움직였을 때만 다시 그린다.
     *
     * `ArenaView.update` 가 방금 실제 변환을 비교해 `moved` 를 채웠다 — 왜 물리
     * 스텝 수로는 부족한지도 거기 적혀 있다. 조준하고 카드를 고르고 상대를 기다리는
     * 동안, 즉 경기 시간의 대부분, 이 값은 거짓이고 장면을 한 번 덜 그린다.
     *
     * 끄는 것(`autoUpdate = false`)은 부팅에서 한 번 한다 — `createLightRig` 옆.
     * 메뉴 문서는 그대로 자동인데, 저쪽에서 그림자를 던지는 것은 병 하나뿐이고
     * 그건 매 프레임 떠 있으므로 자동이 맞다.
     */
    if (view.moved) viewport.renderer.shadowMap.needsUpdate = true;
    // After the view, so a mark and the cap it is measured from are drawn off
    // the same frame's transforms rather than a frame apart — which on a
    // measurement drawn to a hundredth of a unit would be visible.
    distanceMarks.update(match.rules.distanceMarks?.(), match.arena.desc.radius);
    trackPath.update(camTracker.targetPath, camTracker.lookPath, CONFIG.view.trackPath);
    /**
     * The AI's runners-up, while it still has some.
     *
     * `scored` survives the search and is only replaced on the next `begin`, so
     * the lines stay up for the whole of the turn they explain — including while
     * the shot is actually being played out, which is when comparing the
     * prediction against what happens is most useful. The label's world size is
     * derived from the board so it reads the same at any zoom.
     */
    aiCandidates.update(
      controllers.find((c) => c?.isAi)?.planner?.scored ?? null,
      CONFIG.ai.showCandidates,
      Math.max(0, Math.round(CONFIG.ai.candidateCount)),
      match.arena.desc.radius * 0.09,
    );
    colliderView.update(physics.world, CONFIG.view.colliders);
    /**
     * ── everything that is not the board gets out of the way to aim ────────
     * The bow, the pull line, the clamp bar and the error cone are all drawn ON
     * the board, in the place the player is looking. A score across the top and
     * a fan of cards along the bottom are competing with that at exactly the
     * moment precision matters — and the hand in particular sits over the half
     * the shot is being taken from.
     *
     * One scalar drives both layers so they cannot fall out of step, eased so
     * they leave and arrive rather than blinking. `input.aiming` and not the
     * router's mode: it is the bow being DRAWN that matters, and that is the
     * thing which owns the answer.
     */
    const wantUi = input.aiming ? 0 : 1;
    const uiRate = dt / Math.max(0.02, CONFIG.ui.aimHideSeconds);
    uiFade += Math.max(-uiRate, Math.min(uiRate, wantUi - uiFade));

    /**
     * ── there are TWO scalars, and they are multiplied ─────────────────────
     * `uiFade` above is the AIM fade: the player's own bow pushing the readouts
     * out of the way, back the moment they let go, and pressable throughout
     * because "흐린 상태에서도 클릭은 동작한다".
     *
     * `uiGate` is a SEQUENCE owning the screen — the opening, or the ending.
     * Different owner, different lifetime, and one extra consequence: while it
     * is down nothing under it may be pressed, because a control that is
     * invisible and still answers is worse than one that is visible and does
     * not. The layers take it separately for exactly that reason; see `gate` on
     * `HudLayer.update` and `CardLayer.update`.
     *
     * Multiplied rather than one overwriting the other. They can legitimately
     * overlap — a shot half-drawn when the match ends leaves the aim fade
     * partway home while the bars close over it — and either one winning
     * outright would make the other's movement vanish.
     *
     * NEITHER of them moves anything. `uiFade` was described as parking the
     * hand and does not: it is `uFade` on the shared card material and an
     * opacity multiplier in the HUD, both pure alpha. So "버튼의 좌표가 페이드
     * 중에 한 픽셀도 움직이지 않는다" holds for both terms, by construction
     * rather than by care.
     */
    const uiGate = cinematic.uiGate;
    // After `cards.update` has finished placing the hand, so it multiplies the
    // per-card opacity rather than fighting it. See `CardMaterials.shared`.
    cards.materials.shared.uFade.value = uiFade * uiGate;

    /**
     * `gameCamera` rather than a copy of its zoom: the score's visibility asks
     * the camera's OWN `atMinZoom`, which is the same getter `dragMode` uses to
     * decide whether a drag turns the field. See `HudLayer._updateScore`.
     *
     * ── the victory screen used to zero this outright, and no longer does ──
     * `fade: victory.active ? 0 : uiFade` was the old line, and its reasoning
     * still stands: the score and the two buttons up there say the same things
     * the result screen says, and two 나가기 buttons on one frame reads as the
     * game being broken. What has changed is WHO says so. The gate takes the
     * HUD down as the bars close and holds it down for the rest of the
     * sequence, so the readouts leave WITH the letterbox instead of blinking
     * out on the frame the match ended — and the push-in in stage 1 is watched
     * with the score still up, which is what a replay should look like.
     */
    hud.update({
      dt,
      match,
      gameCamera,
      // The product, exactly as the hand's `uFade` is. `gate` below is the same
      // number again and is the PRESS, not the paint — see the two scalars.
      fade: uiFade * uiGate,
      gate: uiGate,
      // "PLAYER 2 (AI)". A function of the seat, so the HUD never learns what an
      // AI is — see the note on `HudLayer.update`.
      labelFor: (player) => controllers[player]?.label ?? '',
      // A seat with a real name says it instead of "PLAYER n" — see
      // `HudLayer._updateTurn`. Local and AI seats have none and are unchanged.
      nameFor: (player) => onlineNameFor(player),
      // The same answer the victory screen gives — see its `outcomeFor`.
      outcomeFor: (winner) => (hasAi() ? (winner === localSeat ? '승리' : '패배') : null),
      /**
       * The server's clock, for display only.
       *
       * The HUD counts nothing: `remaining` is derived from the deadline the
       * relay last sent, rebuilt against THIS machine's clock so two devices
       * whose system time differs do not show different countdowns. Null in
       * local and AI play, where there is no clock and no bar.
       */
      turnClock: online
        ? { remaining: online.remaining, total: online.turnMs / 1000 }
        : null,
    });
    // After the HUD, and that order matters: a texture-scale change empties the
    // shared plate cache from inside `hud.update`, and this re-asks for its own
    // plates every frame — so it must run on the far side of the clear rather
    // than a frame behind it, holding a texture that has just been disposed.
    victory.update(dt);
    // 모달의 등장. `render()` 에는 dt 가 없으므로 여기서 민다.
    modal.update(dt);
    // Cards are usable only while a shot is: not while the turn is being played
    // out, not during a goal hold, not while an effect is on screen, not once
    // the match is over.
    // Reconciled BEFORE the fans are laid out, so a card picked up inside this
    // frame's physics steps is in the hand the springs are solving for rather
    // than one frame behind it. Cheap when nothing changed — see `syncTo`.
    /**
     * The orbs, and whatever was picked up since the last frame.
     *
     * `drainEvents` rather than a callback from inside the step: a pickup
     * happens in the middle of a physics step and the renderer must not be
     * re-entered from there. The events queue up and are spent here, on the
     * render clock, which is also what keeps the pickup animation from having
     * any say over the simulation — requirement 5.
     */
    orbView.update(dt, match.orbs, gameCamera.camera);
    const picked = match.orbs.drainEvents();
    // Handed on rather than drained a second time: `drainEvents` is destructive
    // and this is the one call to it, so the audio layer is given the same array
    // the burst and the flight are built from.
    matchAudio.notePickups(picked);
    if (picked) {
      for (const ev of picked) {
        // A refusal has no card and no flight — the orb stays where it is and
        // `OrbView` flashes it. Nothing to launch.
        if (ev.full) continue;
        orbView.burst(ev.x, ev.z);
        cardFlight.launch(
          cards.scene,
          ev.key,
          ev.cardId,
          toFrame(ev.x, CONFIG.orbs.hover, ev.z),
          handAnchor(ev.player),
        );
      }
    }
    cardFlight.update(dt, cards.scene);

    cards.syncTo(match.hands, cardFlight.pendingKeys);
    cards.update({
      dt,
      currentPlayer: match.rules.currentPlayer,
      /**
       * Cards are usable only while a shot is — and only while the shot would be
       * the PLAYER's.
       *
       * The second half is new and it is load-bearing. `Match.playCard` plays for
       * `rules.currentPlayer`, so a hand left live during the AI's go would let a
       * player drag one of their own cards and have it spent as the AI's. The
       * router already refuses the press, and this is the other half of the same
       * refusal: the fans grey out, which is the picture that says whose turn it
       * is, and there is nothing to drag in the first place.
       */
      enabled: match.state === MATCH_STATE.AIM && active().acceptsInput,
      /**
       * Against an AI the seats do not swap. See `CardLayer.update` — the swap
       * exists so two people can each have their own hand in front of them, and
       * with one person there is nobody to swap for.
       */
      pinnedBottom: hasAi() ? localSeat : null,
      // Opacity is the product above; this is the PRESS. See the two scalars.
      gate: uiGate,
      // The AI's card, being drawn out of its face-down fan and turned over.
      reveal: aiReveal(),
      /**
       * A mode may not have cards at all, in which case there is no hand to
       * draw — "손패 UI를 표시하지 마라". Distinct from `enabled`, which greys the
       * fans at the edges of the screen and is the right picture for a turn
       * being played out.
       *
       * The layer is still built and still holds whatever the players have; the
       * state is not touched and nothing here empties a hand. Switch back to a
       * mode with cards and it comes straight up. See `MODES.curling.cards`.
       */
      visible: match.mode.cards !== false,
    });
    // Per frame, unlike the rest of the panel: this one tracks the hand.
    debug.refreshCamera();

    // Presentation only, and last, so it is over the finished frame.
    cinematic.update(dt);

    /**
     * And the sound, last of all.
     *
     * Every layer above has written this frame's state, so a poll-and-diff
     * observer sees a settled frame rather than half of one. Strictly after
     * `match.update(dt)`, which is the only place physics steps — the same rule
     * the orb drain above states, for the same reason.
     */
    matchAudio.update(dt);
    audio.update(dt);

    render();

    /**
     * What this frame cost, handed to the panel in one call.
     *
     * At the very end so `render()` is inside `tickMs` — the GPU submission is
     * part of what a frame costs, and leaving it out would report a loop that
     * looks comfortable while the frame rate says otherwise.
     *
     * `_acc` is the accumulator's leftover, read rather than exported: it is the
     * one number that says whether the sim is keeping up, and there is no getter
     * for it. `steps >= MAX_STEPS_PER_FRAME` (20, Match.js) is a saturated
     * drain, which the main loop's own 0.05 s clamp should make unreachable —
     * that clamp allows 6 steps — so anything but zero here means something
     * other than `frame` is driving the accumulator.
     */
    const tickMs = performance.now() - tickT0;
    // Fed BEFORE the overlay and unconditionally, because this one is load
    // bearing: it is what sizes the next frame's search slice.
    thinkBudget.note(tickMs, aiMs, dt * 1000);
    // 클램프 **전**의 간격을 준다. 클램프된 값은 50 ms 를 넘지 않으므로 그걸로는
    // 느린 기기를 영원히 찾지 못한다. `FirstRunProbe.note` 에 근거가 있다.
    firstRunProbe.note(rawFrameMs, aiMs);
    metrics.endFrame({
      tickMs,
      physicsMs,
      steps,
      backlogSec: match._acc ?? 0,
      saturated: steps >= 20,
      aiMs,
      aiThinking,
      label: `${match.mode?.key ?? '?'} vs ${controllers[remoteSeat]?.isAi ? 'ai' : online ? 'online' : 'local'}`,
      // The render chain: the low-res target the world is drawn into, and the
      // canvas it is scaled up onto. The gap between the two is the upscale, and
      // it is the first thing to check when the picture looks softer than it
      // should.
      note: `${viewport.resolution.x}x${viewport.resolution.y} → ${viewport.displaySize.x}x${viewport.displaySize.y}`,
    });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);

    // The RAW interval, before the clamp below sees it. The clamped value is
    // what the simulation gets; this is what actually happened, and the gap
    // between the two is exactly the time the game is losing.
    metrics.beginFrame(now);
    // 같은 간격을 `tick` 도 봐야 한다 — 자동 강등이 재는 것이 이 값이다.
    // 클로저 변수인 것은 `aiMs` 가 `tick` 안에서야 정해지기 때문이고, 그 둘이
    // 같은 프레임의 것이어야 판단이 성립한다.
    rawFrameMs = last ? now - last : 0;

    // Clamped at both ends, same as the viewer's: a hidden tab that comes back
    // hands you a multi-second jump, and feeding that to the accumulator would
    // burn the whole per-frame step budget catching up on a turn that is over.
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) || 0;
    last = now;
    tick(dt);
  }

  function updateAim() {
    /**
     * The bow, from whichever hand is drawing it.
     *
     * ── the AI's aim goes through the SAME overlay ─────────────────────────
     * `AiController.aim` has the identical shape `AimInput.preview` has, so
     * everything below — the pull line, the clamp bar, the error cone, the
     * trajectory line, the 강타 recolouring, the chaos blinding — draws for the
     * AI without a single branch. That is not a convenience: the brief asks the
     * player to be able to read what the opponent is doing, and the only drawing
     * they already know how to read is their own.
     *
     * Null for a human controller, so `input.preview` wins whenever a person is
     * actually dragging. The two can never both be set — the router refuses to
     * start an aim while the AI holds the seat.
     */
    const p = input.preview ?? active().aim ?? null;

    // Re-asked every frame rather than only when the pointer moves. Firing a
    // shot changes what is under a stationary cursor — the cap leaves, the turn
    // passes — and without this the answer was whatever it had been at the press.
    router.refreshHover();

    // The hover ring: which cap a press would grab, drawn on the board so the
    // answer survives on a touch screen where there is no cursor to change.
    //
    // Only while a press could actually grab something. It is a promise about
    // what the NEXT press will do, and during a turn being played out the answer
    // is "nothing" — leaving it up meant the ring rode the cap that had just
    // been fired all the way across the board.
    //
    // Suppressed during a pull too, when the deadzone ring is already on that cap.
    //
    // ── and during the opening sequence, for the reason stated above ────────
    // The match is already sitting in AIM behind the intro — the world is built
    // and waiting — so the state test alone said "a press would grab this" while
    // the router was refusing every press. The ring promised something that
    // could not happen, on a cap the player could not even see properly.
    const canGrab = match.state === MATCH_STATE.AIM && !p && !introLayer?.active;
    const hovered = canGrab && router.hoverCap >= 0 ? router.hoverCap : -1;
    /**
     * ── and the AI's own "this is the one I am about to hit" ────────────────
     * "조준할 뚜껑이 짧게 강조된다." The same ring, on the same call: it is
     * already the drawing that means "a press would grab this cap", which is
     * near enough to "this cap is about to be used" that giving the AI a second
     * highlight of its own would be inventing a symbol the player has to learn.
     *
     * It takes priority over the hover, and cannot collide with one: the router
     * stops reporting a hovered cap the moment the AI takes the seat.
     */
    const marked = active().highlight ?? -1;
    const ring = marked >= 0 ? marked : hovered;
    // How wide to draw the bow, in a unit the overlay can turn into world
    // offsets. Handed in every frame because the camera's distance eases — see
    // `AimOverlay.setPixelScale`, and note that the hover ring goes through it
    // too, so it has to be set before this call rather than beside the aim.
    overlay.setPixelScale(gameCamera.worldPerPixel, viewport.renderer.getPixelRatio());
    overlay.setHover(
      ring >= 0 ? match.arena.capCom(ring) : null,
      match.arena.desc.radius * Math.max(1, CONFIG.view.grabRadius),
    );

    if (match.state !== MATCH_STATE.AIM || !p) {
      overlay.setVisible(false);
      preview.clear();
      return;
    }

    // `p` already carries the seed the input fixed when the drag started, so the
    // preview and the shot that eventually fires are the same shot down to the
    // error cone's draw. It also carries the chaos twist, applied at the source
    // in `AimInput` — so the line, the arrow and the cap all take the same
    // heading without anything here knowing a card exists.
    const shooter = match.rules.currentPlayer;

    /**
     * Chaos: the shot is drawn blind.
     *
     * The twist being applied at the source is what makes every drawing here
     * honest, and it is therefore also what makes every drawing here a readout
     * of the deviation — see the note in `AimOverlay.update`. So under chaos the
     * outcome is not drawn at all, and the prediction that would produce it is
     * not even computed: `preview.clear()` rather than a path thrown away, so
     * that turning the developer preview on from the panel cannot put the line
     * back on screen.
     */
    const blind = match.cards.chaosOn(shooter);
    // Chaos and the trajectory card cannot legally overlap — `canUse` refuses
    // the card outright while chaos is on you. This is the guard for the panel
    // forcing one anyway, and blind is the answer that stays safe when they do.
    const far = !blind && match.cards.trajectoryOn(shooter);

    let path = null;
    if (blind) preview.clear();
    else {
      path = preview.update({
        snapshot: match.turnSnapshot,
        arena: match.arena,
        shot: p,
        seconds: far ? CONFIG.cards.trajectorySeconds : undefined,
        // The card is what turns the line on now — the ordinary preview is off.
        force: far,
      });
    }

    overlay.update({
      com: match.arena.capCom(p.capIndex),
      dirX: p.dirX,
      dirZ: p.dirZ,
      power: p.power,
      pullX: p.pullX,
      pullZ: p.pullZ,
      clampedDistance: p.clampedDistance,
      atClamp: p.atClamp,
      armed: p.armed,
      path,
      reach: preview.reach,
      geom: { radius: match.arena.desc.radius },
      // The trajectory card's line: dashes marching along the samples, with the
      // colour cycling behind them. Stepped, on the render clock — it is a way
      // of drawing the same points, not a different prediction.
      dashed: far,
      dashPhase: -performance.now() * 0.001 * CONFIG.cardFx.dashSamplesPerSecond,
      hideCone: far,
      blind,
      // 강타: the whole aim recoloured, and a cone that is visibly the price of
      // it. Both read off the preview, so they are the shot that will fire.
      smash: !!p.smash,
      spreadMul: p.spreadMul,
      // The cone follows the delivered impulse now, so the boost has to reach
      // the drawing as well as the draw. See `shotSpread`.
      impulseMul: p.impulseMul,
    });
  }

  /**
   * The cards, over whatever was just drawn.
   *
   * Depth is cleared first because the hand is not in the world and must not be
   * sorted against it — a card is in front of the pitch by definition, not by
   * being nearer. The renderer's auto-clear is then off so the pitch survives.
   *
   * Note where this sits in `render` below: INSIDE the bound render target, so
   * the retro pass upscales one image containing both. Drawing the cards after
   * the pass — the obvious alternative — would put them on their own dither
   * lattice at native resolution, and the join between card and pitch would be
   * the first thing anyone noticed.
   */
  /**
   * The overlays, over whatever was just drawn.
   *
   * Depth is cleared once, before both: neither the HUD nor the hand is in the
   * world and neither must be sorted against it — they are in front by
   * definition, not by being nearer. The renderer's auto-clear is then off so
   * the pitch survives.
   *
   * ── the HUD goes UNDER the cards ─────────────────────────────────────────
   * Both are orthographic overlays with depth testing off, so this call order
   * IS the stacking, and it is chosen to agree with the input order: cards are
   * tested first and draw last. A button drawn on top of a card that then
   * refused the press would look like a bug, because it would be one.
   *
   * Note where this sits in `render` below: INSIDE the bound render target, so
   * the retro pass upscales one image containing all three. Drawing the HUD
   * after the pass — the obvious alternative, and what the DOM version was
   * effectively doing — would put it on its own dither lattice at native
   * resolution, which is the whole thing this conversion exists to stop.
   */
  /**
   * A world point in the card overlay's frame coordinates.
   *
   * The two live in different spaces — one is the board seen through the game
   * camera, the other a fixed 640x480 box — so a flight that starts on the
   * board has to be projected into the box before it can be animated in it.
   */
  function toFrame(x, y, z) {
    _flightPoint.set(x, y, z).project(gameCamera.camera);
    return { x: (_flightPoint.x * FRAME.width) / 2, y: (_flightPoint.y * FRAME.height) / 2 };
  }

  /**
   * The AI's card reveal, tagged with whose hand it is coming out of.
   *
   * The controller knows the card and how far through the animation it is; it
   * does not know which fan that is, because it has never heard of a fan. The
   * seat is added here, which is the same seam every other hand-off in this file
   * uses — `game/` says what happened and `render/` decides what to do about it.
   */
  function aiReveal() {
    for (const c of controllers) {
      const r = c?.cardReveal;
      if (r) return { ...r, player: c.player };
    }
    return null;
  }

  /** Where a flight lands: the middle of that player's fan. */
  function handAnchor(player) {
    const hand = cards.hands[player];
    return { x: hand.root.position.x, y: hand.root.position.y };
  }

  function render() {
    /**
     * Two stages, and the split is the whole shape of this function.
     *
     * ── 1. the world, through the bloom chain ────────────────────────────
     * `composer.render()` draws the scene into an MSAA half-float target, runs
     * the bright-pass and the blur pyramid over it, converts to sRGB and writes
     * the canvas. It leaves the renderer on the default framebuffer.
     *
     * ── 2. the overlays, straight onto that ──────────────────────────────
     * `autoClear` off and one `clearDepth`, then each overlay scene in order.
     * They do NOT go through the composer: bloom on UI text is unreadable UI
     * text, and white type on a white plate is precisely what a bright-pass is
     * looking for.
     *
     * ── the ORDER below is load-bearing and must not be rearranged ───────
     * It matches `PointerRouter`'s hit-test order, which tests cards before the
     * HUD. Draw the HUD last and you get a button that is visibly on top of a
     * card and cannot be pressed, because the card is still winning the press.
     * The three after them are each modal over the last: the victory screen has
     * taken the screen, match-found is handing the screen over, and a modal
     * question is the last thing on it. The letterbox is over all of them,
     * because it is the frame everything else is inside — and at a covered
     * frame it is the only thing on screen.
     */
    composer.setCamera(gameCamera.camera);
    composer.render();

    const r = viewport.renderer;
    r.autoClear = false;
    r.clearDepth();
    r.render(hud.scene, hud.camera);
    r.render(cards.scene, cards.camera);
    victory.render(r);
    introLayer?.render(r);
    modal.render(r);
    cinematic.render(r);
    r.autoClear = true;
  }

  // The panel's readouts change on turn boundaries and on rebuilds, not per
  // frame, so they are polled slowly rather than pushed from six places.
  const refreshLoop = setInterval(() => debug.refresh(), 400);

  function start() {
    if (raf) return;
    last = performance.now();
    // The interval chain restarts here too. Without this the first frame back
    // from a background stay reports the length of the stay as one frame time,
    // and one 40-second outlier poisons every percentile in the window.
    metrics.resume();
    raf = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      // A press that was in progress when the tab went away would otherwise come
      // back as a fully charged shot the player never released.
      router.cancel();
      return;
    }
    start();
  });

  window.addEventListener('beforeunload', () => clearInterval(refreshLoop));

  start();

  // A handle for poking at the sim from the console while tuning, and for
  // driving frames by hand when verifying.
  window.__cap = {
    lights,
    sky,
    composer,
    match, physics, view, colliderView, overlay, input, router, preview, CONFIG,
    gameCamera, camTracker, viewport, tick, rebuildAll, modeByKey, cards, cardFx,
    // The seats, and the switch between them. `tick` can be driven by hand
    // alongside these, which is the only way to step through an AI turn's
    // phases — several of them are shorter than a frame at 0.2x.
    controllers, setOpponent, faceCurrentPlayer, turnBearing,
    cinematic, hud, victory, retro, audio, audioSettings, matchAudio, distanceMarks,
    // The panel itself, so its per-frame readouts — and the rows the flight
    // greys out — can be driven by hand alongside `tick`. It is the stub when
    // the panel is off, so this is always safe to call.
    debug,
    // The measurement panel. `metrics.snapshot()` returns every number the
    // readout shows as plain data, so a run's figures can be copied out of the
    // console rather than read off a screenshot. See docs/metrics.md.
    metrics,
    // The two sequences, so a covered frame and a result band can be stepped
    // through by hand alongside `tick` — neither is something you can catch by
    // looking.
    introLayer, playOpening,
  };
}

import { Color, Scene, Vector3 } from 'three';
import { GlossMaterials } from './core/GlossMaterial.js';
import { buildEnvironment } from './core/environment.js';
import { createLightRig } from './core/lighting.js';
import { createSky } from './core/sky.js';
import { Viewport } from './core/Viewport.js';
import { SceneComposer } from './core/Composer.js';
import { setTextureRenderer } from './core/textures.js';
import { initRapier } from './physics/rapier.js';
import { PhysicsWorld } from './physics/PhysicsWorld.js';
import { CONFIG, CONFIG_DEFAULTS } from './game/config.js';
import { Match, MATCH_STATE } from './game/Match.js';
import { modeByKey, modeKeyFromPath } from './game/modes.js';
import { AimInput } from './game/AimInput.js';
import { DRAG_MODE, PointerRouter } from './game/PointerRouter.js';
import { TrajectoryPreview } from './game/predict.js';
import {
  ArenaView,
  buildGameCapGeometry,
  capDimensions,
  PLAYER_COLORS,
} from './render/ArenaView.js';
import { makeCapTopTexture } from './cap/capTexture.js';
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
import { HudLayer, HUD_FRAME } from './ui/HudLayer.js';
import { VictoryLayer } from './victory/VictoryLayer.js';
import { WipeOut } from './victory/WipeOut.js';
import { fadeIn, fadeOut } from './ui/pageFade.js';
import { isAiOpponent, isOnlineOpponent, menuUrl } from './menu/menuRoutes.js';
import { OnlineSession } from './net/OnlineSession.js';
import { defaultServerUrl } from './net/Transport.js';
import { LocalStorageNicknames, Profile } from './profile/NicknameStorage.js';
import { OnlineMatch } from './net/OnlineMatch.js';
import { OnlineController } from './net/OnlineController.js';
import { MatchFoundLayer } from './net/MatchFoundLayer.js';
import { ModalLayer } from './ui/ModalLayer.js';
import { AiController, HumanController } from './game/ai/Controller.js';
import { CardLayer, FRAME } from './render/CardLayer.js';
import { CardFx } from './render/CardFx.js';
import { CardFlight } from './render/CardFlight.js';
import { setFieldAspect, updateFrame } from './core/frame.js';
import { bootPhysicsDebug } from './debug/PhysicsDebug.js';
import { MetricsOverlay, NO_METRICS } from './debug/MetricsOverlay.js';
import { SafeArea } from './platform/safeArea.js';
import { hardenWebView } from './platform/webview.js';
import { bootViewer } from './viewer/bootViewer.js';
import { bootMenu } from './menu/bootMenu.js';
import { CapWipe } from './menu/CapWipe.js';
import { MENU_CONFIG } from './menu/menuConfig.js';
import { STAGE, Transition } from './menu/Transition.js';
import { HANDOVER_FLAG, isHandover, isReturnFromGame } from './menu/menuRoutes.js';
import { PALETTE } from './core/palette.js';
import { applyCssPalette } from './ui/cssPalette.js';
import { whenFontsReady } from './ui/fonts.js';
import { aimedLaunchDirection, CAP_COLOR } from './menu/Bottle.js';
import { capLogoTexture } from './menu/menuTextures.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { AudioSettingsBook, LocalStorageAudioSettings } from './audio/AudioSettings.js';
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
 * Set BEFORE anything else runs and outside `boot`, because `boot` is async —
 * it waits on the WASM — and the whole point of this line is to be in effect
 * during the gap between the menu's document going away and this one's first
 * drawn frame. Painted the cap's own red, that gap is invisible: the menu's
 * last frame was a screen full of that colour and this page's first frame will
 * be too. Left as the default black it is a flash, which is the one thing the
 * covered window exists to prevent.
 */
// The stylesheet names `var(--bcc-*)` and nothing else, so this has to run
// before the letterbox, the page fade or either developer overlay is painted.
// It is cheap — a dozen `setProperty` calls — and it is deliberately ahead of
// the handover paint below, which sets inline styles that must win over it.
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

const handover = isHandover();
if (handover) {
  document.documentElement.style.background = CAP_COLOR;
  document.body.style.background = CAP_COLOR;
}

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
 * The web view's own gestures, off — for all three destinations below.
 *
 * At module scope for the same reason `install()` above is: the guards are
 * document-level and additive, and the game branch does not exist until the WASM
 * resolves. A pinch made while the physics core is still loading would otherwise
 * be handled by the browser, which zooms the page and leaves it zoomed.
 *
 * Most of the blocking is CSS and native config; this is only the handful with
 * no declarative form. See src/platform/webview.js for what lives where.
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
  bootMenu(canvas, { audio, audioSettings });
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
  retro.setEnvironment(buildEnvironment(viewport.renderer));


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
   * On the board the two marks face each other; on the victory screen they both
   * face the camera. Two bakes of the same book, because a cap's mark has no
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
   * ── the victory screen ───────────────────────────────────────────────────
   * There is only one viewer there, and both caps are being shown TO them, so
   * "upright from your own seat" stops meaning anything. Everything faces front.
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
  const victoryMarks = new MarkTextures({ ...markOptions, rotations: [0, 0], bookSlotFor });

  /**
   * The opponent's cap art, when they are on another machine.
   *
   * Applied to BOTH texture sets, because the victory screen shows the same two
   * caps and would otherwise put a clean cap next to the name of somebody whose
   * mark was on the board a second earlier.
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
   * with the bake. `victoryMarks` is the same artwork, including a mark that
   * arrived over the wire (`setRemoteMark` below paints both sets), with the
   * rotation this camera wants.
   */
  const matchFound = new MatchFoundLayer({
    retro,
    resolution: viewport.resolution,
    config: CONFIG,
    panelFor: (player) => victoryMarks.textureFor(player),
  });
  viewport.onResize(({ resolution }) => matchFound.setResolution(resolution));

  /**
   * The match's questions — leaving, a dropped opponent, a desync — as geometry.
   *
   * Modal by construction: it takes the pointer at the capture phase while it is
   * open, so `PointerRouter` never sees a press aimed at a dialog and no branch
   * anywhere else has to know one exists.
   */
  const modal = new ModalLayer({ canvas, resolution: viewport.resolution, config: CONFIG });
  viewport.onResize(({ resolution }) => modal.setResolution(resolution));

  if (online?.opponent?.mark) {
    const seat = online.opponentSeat;
    marks.setRemoteMark(seat, online.opponent.mark);
    victoryMarks.setRemoteMark(seat, online.opponent.mark);
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
  function faceCurrentPlayer(force = false) {
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
     * Only the bearing is pinned. The rest of the framing — the zoom back out,
     * the pan to centre — still happens on a handover exactly as it does in
     * local play, which is what keeps `faceCurrentPlayer` one function with one
     * behaviour and what makes the reset button's target identical in both
     * modes. See `GameCamera.defaultFraming`.
     */
    const bearing = turnBearing();
    const handover = match.rules.turn !== shownTurn && p !== shownPlayer;
    shownTurn = match.rules.turn;
    shownPlayer = p;

    // A turn that has changed hands resets the framing outright — bearing, zoom
    // and pan — whatever the last player left behind and whatever cards were
    // played to get here.
    if (force || handover) {
      gameCamera.faceTo(bearing);
      return true;
    }

    // Otherwise: hold the bearing, and leave the zoom alone.
    if (!gameCamera.holdsOwnHalf(bearing)) gameCamera.faceTo(bearing, { zoom: false });
    return false;
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
   * The far side of the menu's transition.
   *
   * ── why any of this is here ──────────────────────────────────────────────
   * The menu's cap covers the screen, the scene is swapped underneath it, and
   * the cap flies off to reveal what is now there. For 설정 that swap is two
   * lines in the menu's own loop. For a game mode it cannot be: this page owns
   * its own renderer and its own Rapier world, and there is no honest way to
   * host that inside the menu's page. So the swap is a DOCUMENT change, and
   * stage 4 has to be picked up on this side — which is all this block does.
   *
   * It is presentation and nothing else. It does not touch the match, the
   * physics, the rules or the cards; it borrows `retro` for the cap's materials
   * and draws itself after everything else, into the same bound target, so it
   * goes through the identical dither and quantiser. `CapWipe` owns its own
   * overlay camera precisely so this is three lines rather than a rebuild of
   * the card layer's depth range.
   *
   * `begin` then `skip` is the public way to say "start at the covered frame":
   * `skip` exists for the player pressing through the animation and lands on
   * exactly the same instant. See `Transition`.
   */
  const wipeIn = handover
    ? (() => {
        // The SAME panel artwork the menu's cap was wearing. Without it the cap
        // is a plain red disc on this side of the navigation and a logo on the
        // other, so the one frame that is supposed to be seamless is the frame
        // where the object visibly changes.
        const panelMap = capLogoTexture();
        const wipe = new CapWipe({
          retro,
          tuning: MENU_CONFIG.wipe,
          panelMap,
          color: CAP_COLOR,
        });
        const clock = new Transition({ tuning: MENU_CONFIG.transition });
        let cleared = false;

        // Nothing to hide any more. The HUD used to be DOM over the canvas, so
        // no amount of cap INSIDE the canvas could cover it and a frame that was
        // meant to be completely opaque had the score and two buttons sitting on
        // top of it — it had to be hidden by a body class for the duration. Now
        // that it is meshes in the overlay, the cap covers it the same way it
        // covers the pitch, and the workaround has gone with the DOM.

        const clearLetterbox = () => {
          if (cleared) return;
          cleared = true;
          // Back to the stylesheet's black. Done at the START of the exit,
          // while the canvas is still entirely cap, so the bars change colour
          // on the frame the cap starts moving rather than after it has gone.
          document.documentElement.style.background = '';
          document.body.style.background = '';
          // So a refresh does not replay a transition that has already happened.
          const url = new URL(location.href);
          url.searchParams.delete(HANDOVER_FLAG);
          history.replaceState(null, '', url);
        };

        clock.begin(null, { onDone: () => wipe.end() });
        clock.skip();
        // The same heading the menu's cap was already on, from the same numbers
        // rather than guessed: a cap that covered the screen travelling up and
        // left, then left it travelling somewhere else, would read as two
        // different caps. It is the AIMED pose, not the resting lean — by the
        // time the cap goes, the bottle has turned to point at the camera.
        wipe.begin({ x: 0, y: 0 }, aimedLaunchDirection(MENU_CONFIG.bottle));
        wipe.snapToCover();

        return {
          render: (r) => wipe.render(r),
          update(dt) {
            const s = clock.update(dt);
            if (s.stage === STAGE.COVER) wipe.cover(dt);
            else if (s.stage === STAGE.EXIT) {
              clearLetterbox();
              wipe.exit(s.t, dt);
            } else clearLetterbox();
          },
        };
      })()
    : null;

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
   * ── the cap is the board's cap, and the artwork is handed in ──────────────
   * The same `capGeometry` the six caps on the pitch are drawn from, the same
   * `PLAYER_COLORS` the score's bars use, and the same panel placeholder — which
   * is passed rather than imported by the layer, because the customiser is
   * coming and this is the seam it arrives through. See `VictoryLayer`.
   *
   * Built before the router, like the HUD, because the router has to test it
   * ahead of everything else and cannot be handed something that does not exist.
   */
  let wipeOut = null;
  const victory = new VictoryLayer({
    canvas,
    config: CONFIG,
    retro,
    capGeometry,
    resolution: viewport.resolution,
    teamColors: PLAYER_COLORS,
    panelTexture: makeCapTopTexture(),
    // The same MARKS the board's caps wear, but turned to face the camera —
    // both of them, whichever won. See the note on `victoryMarks`.
    teamTextures: [victoryMarks.textureFor(0), victoryMarks.textureFor(1)],
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
     * Not the cap wipe. Restarting and leaving look like the same button from
     * here and they are not the same event: a restart swaps the match UNDER the
     * cover and uncovers it again, which is what the cap is for — it is one
     * continuous shot and the cap is what hides the join. Leaving throws the
     * document away, and every other way out of somewhere in this project is the
     * short black fade: the corner HUD's own 나가기, and the way back out of the
     * settings screen. See `ui/pageFade` for why that one is DOM rather than
     * drawn — it has to cover the letterbox bars and outlive the renderer, and
     * a cap wipe drawn by a renderer that is about to stop can do neither.
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
   * The notch and the home indicator, converted into this frame's own pixels.
   *
   * Registered LAST of the seven resize listeners, deliberately: `_fit` has
   * already written `canvas.style.width/height` by the time any listener runs,
   * but `getBoundingClientRect` reads the laid-out box, and putting this after
   * the others keeps the read as far from the write as the fan-out allows.
   *
   * `measure()` returns true only when the frame-pixel answer actually moved, so
   * the three `layout()` calls behind these setters fire on an orientation
   * change and not on the dozen resizes a sliding URL bar produces. Every one of
   * them is a no-op on identical insets in any case; this just avoids the work.
   *
   * The insets are zero on a desktop browser and — because the canvas is
   * letterboxed to 4:3 and centred — zero in portrait on a phone as well. See
   * src/platform/safeArea.js.
   */
  /**
   * The camera's screen scale, so a cap is the same physical size on a phone.
   *
   * The framing is authored in world units, which makes a cap however many
   * pixels the display gives that slice of board — 40 CSS px on a desktop
   * canvas, 15 on a phone. `GameCamera.screenZoom` steps the default framing in
   * by whatever the screen lost; this is the only thing that has to tell it how
   * wide the board actually is. See the note on `REFERENCE_BOARD_CSS`.
   */
  const syncCameraScale = () => {
    gameCamera.setBoardCssWidth(viewport.boardClientRect().width, FRAME.boardAspect);
  };
  syncCameraScale();
  viewport.onResize(syncCameraScale);

  const safeArea = new SafeArea(canvas, HUD_FRAME);
  const applySafeArea = () => {
    const insets = safeArea.frameInsets;
    hud.setSafeInsets(insets);
    cards.setSafeInsets(insets);
    victory.setSafeInsets(insets);
  };
  applySafeArea();
  viewport.onResize(() => {
    if (safeArea.measure()) applySafeArea();
  });

  /**
   * Restart, through the menu's own cap wipe.
   *
   * The brief asks for the wipe to be reused on the way OUT of the victory
   * screen and not on the way IN — the sequence has to grow out of the game
   * darkening, and a cap covering the screen first would hide the very thing it
   * is announcing.
   *
   * This is now the only caller: leaving goes through the black fade above, so
   * the cap only ever has a scene swap to hide, which is the job it was written
   * for in the menu.
   *
   * Built on first use rather than at boot: it owns a second cap geometry and a
   * 128-pixel logo canvas, and a match nobody finishes should not pay for them.
   * `victory.setBusy` is what stops a second press during the quarter second the
   * cap takes to cover — without it, 재시작 pressed twice starts two rebuilds and
   * the second runs against a world the first has already thrown away.
   */
  function restartFromVictory() {
    if (wipeOut?.running) return;
    victory.setBusy(true);
    wipeOut ??= new WipeOut({
      retro,
      wipe: MENU_CONFIG.wipe,
      transition: MENU_CONFIG.transition,
      // The same panel artwork the menu's cap wears, for the same reason the
      // arriving cap does: one object, seen twice, not two red discs.
      panelMap: capLogoTexture(),
      color: CAP_COLOR,
    });
    wipeOut.begin({
      // The same aimed heading the menu's cap leaves on, from the same numbers.
      direction: aimedLaunchDirection(MENU_CONFIG.bottle),
      onCovered: () => rebuildAll(),
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
     * Nothing is pressable while the cap is covering the screen.
     *
     * The outbound wipe swaps the match under its own covered frame, which
     * dismisses the victory screen — so without this there was a quarter second
     * of the cap flying off during which a press reached the BOARD, and a press
     * on one of the freshly built caps fired a real shot into a match the player
     * could not yet see. See `PointerRouter._blocked`.
     */
    // The opening sequence has the screen while it runs, so a press during it
    // must not start an aim on the board underneath — the same reason the
    // victory wipe blocks. A press still SKIPS the sequence; that listener is
    // `playMatchFound`'s and is unaffected by this.
    blocked: () => !!wipeOut?.running || !!matchFound?.active,
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
   * It was unconditional, because the whole point of it was to be readable on a
   * phone where `?debug=1` cannot be typed. That was right while the question
   * was "does this run at all on the device"; it is wrong as a thing sitting in
   * the corner of a game nobody is measuring. The instrument stays — every
   * sampling call site and the whole readout are intact — it simply does not
   * mount itself unless the flag is on.
   *
   * To read numbers on a DEVICE, where there is no address bar to put the flag
   * in: change this one expression to `true`, rebuild, and change it back. That
   * is what was done for every measurement in docs/ios.md.
   */
  const metrics = debugRequested ? new MetricsOverlay({ bootMs: performance.now() }) : NO_METRICS;

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
        onReplayIntro: () => playMatchFound(),
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
    await playMatchFound();
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

  function playMatchFound() {
    if (!matchFound) return Promise.resolve();
    if (CONFIG.intro?.enabled === false) return Promise.resolve();

    matchFound.begin(introNames());

    return new Promise((resolve) => {
      /**
       * ── it is NOT skippable ──────────────────────────────────────────────
       * A press used to cut it to the end. Removed on instruction: the sequence
       * runs once at the top of a match, it is under three seconds, and online
       * it is also the window in which neither player's clock has started — so
       * one player skipping ahead buys them nothing and leaves them staring at a
       * board that is waiting for somebody else's animation to finish.
       *
       * The board underneath is already refusing input while this runs
       * (`blocked` on the router), so a press during it now does nothing at all
       * rather than doing something surprising.
       */

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
       */
      const deadline = Date.now() + (matchFound.duration + 3) * 1000;
      const poll = setInterval(() => {
        const stalled = Date.now() > deadline;
        if (matchFound.active && !stalled) return;
        // Not a skip: the sequence is unskippable by the PLAYER. This is the
        // safety net for a frame clock that has stopped — see the note above.
        if (stalled) matchFound.skip();
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
  if (!online) playMatchFound().catch((err) => console.error('[intro] failed', err));

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
    matchFound?.update(dt);

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
      !matchFound?.active
    ) {
      controller.begin({ match });
    }
    // The AI's search is sliced across frames and is by far the largest single
    // cost in the app — up to ~100 rollouts of ~95 solver steps each, three
    // times over on a turn that plays two cards. Timed separately from the
    // physics above because it steps a DIFFERENT world (a snapshot restored into
    // its own `RAPIER.World`), so it never shows up in `physics.steps`.
    const aiT0 = performance.now();
    controller.update(dt, { match });
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
        // The mode's own line under the winner, if it has one to give — see
        // `RuleSet.resolveTurn`'s `resultNote`. Undefined in the two modes whose
        // result explains itself, and the screen is then exactly as it was.
        victory.begin(match.winner, { note: match.lastVerdict?.resultNote ?? null });
      }
    } else {
      victoryArmed = false;
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
    if (CONFIG.view.followBall && match.state === MATCH_STATE.LIVE && match.arena.hasBall) {
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
      enabled: !!match.mode.camera?.track,
      keepZ: match.mode.camera?.keepLineZ?.(match.arena) ?? null,
      reframed,
      onReturn: () => faceCurrentPlayer(true),
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
    cardFx.update({ dt, match, camera: gameCamera.camera });
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
    // After `cards.update` has finished placing the hand, so it multiplies the
    // per-card opacity rather than fighting it. See `CardMaterials.shared`.
    cards.materials.shared.uFade.value = uiFade;

    /**
     * `gameCamera` rather than a copy of its zoom: the score's visibility asks
     * the camera's OWN `atMinZoom`, which is the same getter `dragMode` uses to
     * decide whether a drag turns the field. See `HudLayer._updateScore`.
     *
     * The fade goes to 0 for the whole of the victory screen. The score and the
     * two buttons up there say the same things this screen says, larger and in
     * the middle, and two 나가기 buttons on one frame is the kind of thing that
     * reads as the game being broken. It is the fade rather than a new flag
     * because `HudLayer.update` already hides a plate whose opacity reaches zero
     * — see the visibility pass at the end of it — so there is nothing to add.
     * Input is not relying on this: the router stops at the victory screen.
     */
    hud.update({
      dt,
      match,
      gameCamera,
      fade: victory.active ? 0 : uiFade,
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

    // Presentation only, and last, so they are over the finished frame.
    wipeOut?.update(dt);
    wipeIn?.update(dt);

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
    metrics.endFrame({
      tickMs: performance.now() - tickT0,
      physicsMs,
      steps,
      backlogSec: match._acc ?? 0,
      saturated: steps >= 20,
      aiMs,
      aiThinking,
      label: `${match.mode?.key ?? '?'} vs ${controllers[remoteSeat]?.isAi ? 'ai' : online ? 'online' : 'local'}`,
      // The render chain and what the device has taken out of it. On a phone
      // this is the only way to read the safe-area answer without a debugger
      // attached — and the answer is orientation-dependent, so it has to be
      // legible while the phone is being turned over.
      note:
        `${viewport.resolution.x}x${viewport.resolution.y} → ${viewport.displaySize.x}x${viewport.displaySize.y}\n` +
        `safe  T${safeArea.frameInsets.top} R${safeArea.frameInsets.right} ` +
        `B${safeArea.frameInsets.bottom} L${safeArea.frameInsets.left} (frame px)`,
    });
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);

    // The RAW interval, before the clamp below sees it. The clamped value is
    // what the simulation gets; this is what actually happened, and the gap
    // between the two is exactly the time the game is losing.
    metrics.beginFrame(now);

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
    const canGrab = match.state === MATCH_STATE.AIM && !p && !matchFound?.active;
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
     * question is the last thing on it. The wipes cover everything because they
     * are the transition out.
     */
    composer.setCamera(gameCamera.camera);
    composer.render();

    const r = viewport.renderer;
    r.autoClear = false;
    r.clearDepth();
    r.render(hud.scene, hud.camera);
    r.render(cards.scene, cards.camera);
    victory.render(r);
    matchFound?.render(r);
    modal.render(r);
    wipeOut?.render(r);
    wipeIn?.render(r);
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
    wipeIn, hud, victory, retro, audio, audioSettings, matchAudio, distanceMarks,
    // The panel itself, so its per-frame readouts — and the rows the flight
    // greys out — can be driven by hand alongside `tick`. It is the stub when
    // the panel is off, so this is always safe to call.
    debug,
    // The measurement panel and the notch arithmetic. `metrics.snapshot()` is
    // the one call to make from Safari's Web Inspector while the app is on a
    // phone — it returns every number the report wants as plain data, so the
    // figures can be copied out rather than read off a screenshot.
    metrics, safeArea,
    // A getter, unlike `wipeIn`: this one is built on first use, so a captured
    // value would be `null` for the whole session.
    get wipeOut() {
      return wipeOut;
    },
  };
}

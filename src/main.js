import { Color, Scene, Vector3 } from 'three';
import { RetroMaterials } from './core/RetroMaterial.js';
import { RetroPass } from './core/RetroPass.js';
import { Viewport } from './core/Viewport.js';
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
import { AimOverlay } from './render/AimOverlay.js';
import { GameCamera } from './render/GameCamera.js';
import { HudLayer } from './ui/HudLayer.js';
import { VictoryLayer } from './victory/VictoryLayer.js';
import { WipeOut } from './victory/WipeOut.js';
import { fadeIn, fadeOut } from './ui/pageFade.js';
import { menuUrl } from './menu/menuRoutes.js';
import { CardLayer, FRAME } from './render/CardLayer.js';
import { CardFx } from './render/CardFx.js';
import { CardFlight } from './render/CardFlight.js';
import { bootPhysicsDebug } from './debug/PhysicsDebug.js';
import { bootViewer } from './viewer/bootViewer.js';
import { bootMenu } from './menu/bootMenu.js';
import { CapWipe } from './menu/CapWipe.js';
import { MENU_CONFIG } from './menu/menuConfig.js';
import { STAGE, Transition } from './menu/Transition.js';
import { HANDOVER_FLAG, isHandover, isReturnFromGame } from './menu/menuRoutes.js';
import { aimedLaunchDirection, CAP_COLOR } from './menu/Bottle.js';
import { capLogoTexture } from './menu/menuTextures.js';

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
const handover = isHandover();
if (handover) {
  document.documentElement.style.background = CAP_COLOR;
  document.body.style.background = CAP_COLOR;
}

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
  bootMenu(canvas);
  /**
   * The far side of a match's fade back to the menu.
   *
   * The game fades to black and then navigates, so this document opens on a
   * black screen — and used to paint itself at full brightness the instant it
   * was ready, which is the one hard cut in the whole app: swapping to 설정 goes
   * out and back through `fadeThrough` and reads as one movement, while leaving a
   * match went out through `fadeOut` and simply arrived. Same veil, same colour,
   * same 180 ms, now on both sides of the navigation.
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

  // ── render pipeline (phase 1, untouched) ─────────────────────────────────
  const viewport = new Viewport({ canvas, mode: CONFIG.view.renderMode });
  const retroPass = new RetroPass({ resolution: viewport.resolution });
  const retro = new RetroMaterials({ resolution: viewport.resolution });

  const scene = new Scene();
  scene.background = new Color('#0a0c10');

  viewport.onResize(({ resolution }) => {
    retroPass.setResolution(resolution);
    retro.setResolution(resolution);
  });

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
  const match = new Match({ physics, capDims, config: CONFIG, mode: modeByKey(CONFIG.mode) });

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
   * showing the right mark later — `RetroMaterials.create` bakes `USE_RETRO_MAP`
   * at construction, so a swapped texture object would be ignored.
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
  const marks = new MarkTextures({ ...markOptions, rotations: [Math.PI, 0] });
  const victoryMarks = new MarkTextures({ ...markOptions, rotations: [0, 0] });

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
  scene.add(view.root, overlay.root, colliderView.object, orbView.root);

  const gameCamera = new GameCamera({
    extents: match.arena.layout.extents,
    config: CONFIG,
    fixedPitch: pitchFor(match.mode),
    rotatable: !!match.mode.camera?.rotatable,
    ...zoomRangeFor(match.mode),
  });
  const preview = new TrajectoryPreview(CONFIG);

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
    return { minZoom: pick('minZoom'), maxZoom: pick('maxZoom'), turnZoom: pick('turnZoom') };
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
   */
  function faceCurrentPlayer(force = false) {
    const p = match.rules.currentPlayer;
    const fn = match.mode.camera?.ownHalfBearing;
    const bearing = fn ? fn(p) : null;
    const handover = match.rules.turn !== shownTurn && p !== shownPlayer;
    shownTurn = match.rules.turn;
    shownPlayer = p;

    // A turn that has changed hands resets the framing outright — bearing, zoom
    // and pan — whatever the last player left behind and whatever cards were
    // played to get here.
    if (force || handover) {
      gameCamera.faceTo(bearing);
      return;
    }

    // Otherwise: hold the bearing, and leave the zoom alone.
    if (!gameCamera.holdsOwnHalf(bearing)) gameCamera.faceTo(bearing, { zoom: false });
  }

  // The bow. It owns no DOM events any more — see its header and the router's.
  const input = new AimInput({ canvas, camera: gameCamera.camera, match, config: CONFIG });

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
    // A point that would grab one of your own caps belongs to the board, even
    // with a card drawn over it — see `CardLayer._reserved`. The same call the
    // router and the hover ring use, so all three agree about what a cap is.
    reserved: (x, y) => input.hitTest(x, y) >= 0,
    // Dragging a card sideways moves it in the STATE, live, and the fans follow
    // on the next sync — which is what opens the gap. See `CardHand._updateSort`.
    onReorder: (player, from, to) => match.hands.reorder(player, from, to),
    onCardUsed: (cardId, player) => {
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
    onRestart: () => rebuildAll(),
    // The same fade the menu's own return uses, so leaving a match looks the
    // same however you got here. No confirmation step: the brief rules one out
    // for now, and releasing off the button is the way back from a misplaced tap.
    onExit: () => fadeOut(() => location.assign(menuUrl())),
    // A point that would grab one of your own caps belongs to the board, even
    // with a button drawn over it — see `HudLayer._isReserved`. The same call
    // the cards and the hover ring use, so all three agree what a cap is.
    reserved: (x, y) => input.hitTest(x, y) >= 0,
  });
  viewport.onResize(({ resolution }) => hud.setResolution(resolution));
  // And once for the mode this page opened on. `rebuildAll` does it on every
  // change after that; without this the first match of a cardless mode would
  // hang its score off a hand that is not drawn.
  hud.setHandParked(match.mode.cards !== false);

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
    onRestart: () => restartFromVictory(),
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
      fadeOut(() => location.assign(menuUrl()));
    },
  });
  viewport.onResize(({ resolution }) => victory.setResolution(resolution));

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
    /**
     * Nothing is pressable while the cap is covering the screen.
     *
     * The outbound wipe swaps the match under its own covered frame, which
     * dismisses the victory screen — so without this there was a quarter second
     * of the cap flying off during which a press reached the BOARD, and a press
     * on one of the freshly built caps fired a real shot into a match the player
     * could not yet see. See `PointerRouter._blocked`.
     */
    blocked: () => !!wipeOut?.running,
    onFire: (shot) => {
      match.fire(shot);
      preview.clear();
    },
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
  function rebuildAll(nextMode = null) {
    if (nextMode && nextMode !== match.mode) match.setMode(nextMode);
    else match.start();

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
    gameCamera.setExtents(match.arena.layout.extents);
    // After the extents, because the range is re-clamped against the new fit and
    // clamping against the old one would put the zoom somewhere neither mode
    // allows for a frame.
    const range = zoomRangeFor(match.mode);
    gameCamera.setZoomRange({ min: range.minZoom, max: range.maxZoom, turn: range.turnZoom });
    // The score hangs off the opponent's parked hand, and a mode with the card
    // system off has none — see `HudLayer.setHandParked`. Here rather than in
    // the per-frame update because the layout is fixed and this is the one event
    // that can change it.
    hud.setHandParked(match.mode.cards !== false);
    preview.clear();
    router.cancel();
    // No deal. Hands are the match's now and `match.start()` has just emptied
    // them; the per-frame sync in `tick` puts the (empty) fans on screen.
    // A new match opens on the first player's own half at the widest zoom, the
    // same view every turn change asks for. `force`, because the player may not
    // have changed and the framing still has to be put right.
    faceCurrentPlayer(true);
  }


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
  const debugRequested = new URLSearchParams(location.search).get('debug') === '1';
  const debug = debugRequested
    ? bootPhysicsDebug({
        match,
        view,
        camera: gameCamera,
        router,
        retro,
        retroPass,
        viewport,
        config: CONFIG,
        preview,
        cards,
        cardFx,
        hud,
        victory,
        onRebuild: () => rebuildAll(),
        onModeChange: () => rebuildAll(modeByKey(CONFIG.mode)),
      })
    : { refresh() {}, refreshCamera() {} };

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
    match.update(dt);

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
    faceCurrentPlayer();

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

    // The camera does have one: rotation inertia and the pan glide run on WALL
    // CLOCK, deliberately outside the fixed-step loop. Neither is in the state
    // hash, and a field that happened to be spinning must not change how many
    // physics steps a turn takes.
    gameCamera.update(dt);

    updateAim();

    // Before the view, so a cap's shake and shrink are on this frame's transform
    // rather than on the last one's.
    cardFx.update({ dt, match, camera: gameCamera.camera });
    view.update(match.alpha, match.rules.alive, cardFx);
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
    hud.update({ dt, match, gameCamera, fade: victory.active ? 0 : uiFade });
    // After the HUD, and that order matters: a texture-scale change empties the
    // shared plate cache from inside `hud.update`, and this re-asks for its own
    // plates every frame — so it must run on the far side of the clear rather
    // than a frame behind it, holding a texture that has just been disposed.
    victory.update(dt);
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
      enabled: match.state === MATCH_STATE.AIM,
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

    render();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);

    // Clamped at both ends, same as the viewer's: a hidden tab that comes back
    // hands you a multi-second jump, and feeding that to the accumulator would
    // burn the whole per-frame step budget catching up on a turn that is over.
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) || 0;
    last = now;
    tick(dt);
  }

  function updateAim() {
    const p = input.preview;

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
    const canGrab = match.state === MATCH_STATE.AIM && !p;
    const hovered = canGrab && router.hoverCap >= 0 ? router.hoverCap : -1;
    overlay.setHover(
      hovered >= 0 ? match.arena.capCom(hovered) : null,
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

  /** Where a flight lands: the middle of that player's fan. */
  function handAnchor(player) {
    const hand = cards.hands[player];
    return { x: hand.root.position.x, y: hand.root.position.y };
  }

  function renderOverlays() {
    const r = viewport.renderer;
    r.clearDepth();
    r.autoClear = false;
    r.render(hud.scene, hud.camera);
    r.render(cards.scene, cards.camera);
    r.autoClear = true;
  }

  function render() {
    const camera = gameCamera.camera;

    if (CONFIG.view.ps1) {
      retro.shared.uSnapAmount.value = CONFIG.view.vertexSnap;
      viewport.bind();
      viewport.renderer.render(scene, camera);
      renderOverlays();
      /**
       * The victory screen, over the finished frame and INSIDE the bound target.
       *
       * Over the cards as well as the HUD, because it is not competing with
       * either — it has taken the screen. And inside the target for the reason
       * every other overlay here is: the retro pass upscales ONE image, so the
       * caps flying about up there get the identical dither lattice and the
       * identical five bits a channel as the board they are flying over. Drawn
       * after the pass — the obvious alternative — the whole sequence would be
       * the one smooth thing on a deliberately crunchy screen.
       *
       * It also carries the colour-inversion flash, which is a blend against
       * whatever is already in this target: game, HUD, cards and caps all flip
       * together, which is the only version of a full-frame flash that does not
       * look like a rendering fault.
       */
      victory.render(viewport.renderer);
      // Inside the bound target, so the arriving cap gets the same dither
      // lattice and the same five bits a channel as the pitch it is uncovering.
      wipeOut?.render(viewport.renderer);
      wipeIn?.render(viewport.renderer);
      viewport.unbind();
      retroPass.render(viewport.renderer, viewport.renderTarget.texture);
    } else {
      // Straight to the canvas at its native size. Snapping goes off with it —
      // it is a consequence of the low-res framebuffer, so leaving it on while
      // bypassing the framebuffer would quantise to a grid that is not there.
      // The cards' own snap goes off for exactly the same reason, and is put
      // back from the config on the next frame that runs the chain.
      retro.shared.uSnapAmount.value = 0;
      cards.materials.shared.uSnapAmount.value = 0;
      hud.materials.shared.uSnapAmount.value = 0;
      // Both of the victory screen's material sets, for the same reason: its
      // type is on the UI's dial and its sprites are on the effects', and either
      // left snapping would quantise to a grid that is not there.
      victory.uiMaterials.shared.uSnapAmount.value = 0;
      victory.fxMaterials.shared.uSnapAmount.value = 0;
      viewport.unbind();
      viewport.renderer.render(scene, camera);
      renderOverlays();
      victory.render(viewport.renderer);
      wipeOut?.render(viewport.renderer);
      wipeIn?.render(viewport.renderer);
    }
  }

  // The panel's readouts change on turn boundaries and on rebuilds, not per
  // frame, so they are polled slowly rather than pushed from six places.
  const refreshLoop = setInterval(() => debug.refresh(), 400);

  function start() {
    if (raf) return;
    last = performance.now();
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
    match, physics, view, colliderView, overlay, input, router, preview, CONFIG,
    gameCamera, viewport, tick, rebuildAll, modeByKey, cards, cardFx, wipeIn, hud,
    victory, retro,
    // A getter, unlike `wipeIn`: this one is built on first use, so a captured
    // value would be `null` for the whole session.
    get wipeOut() {
      return wipeOut;
    },
  };
}

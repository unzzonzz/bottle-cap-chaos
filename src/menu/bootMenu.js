import { Color, Group, Mesh, PerspectiveCamera, PlaneGeometry, Scene, Vector3 } from 'three';
import { RetroMaterials } from '../core/RetroMaterial.js';
import { RetroPass } from '../core/RetroPass.js';
import { DISPLAY_ASPECT, Viewport } from '../core/Viewport.js';
import { Bottle, CAP_COLOR } from './Bottle.js';
import { CapWipe, WIPE_FRAME } from './CapWipe.js';
import { MenuItems } from './MenuItems.js';
import { SettingsScene } from './SettingsScene.js';
import { MarksScreen } from '../marks/MarksScreen.js';
import { BRUSH_SIZES, MarkEditor, PALETTE } from '../marks/MarkEditor.js';
import { ConfirmDialog } from '../marks/ConfirmDialog.js';
import { MarkBook } from '../marks/MarkBook.js';
import { LocalStorageMarks } from '../marks/MarkStorage.js';
import { STAGE, Transition } from './Transition.js';
import { MENU_CONFIG } from './menuConfig.js';
import { capLogoTexture, floorPoolTexture } from './menuTextures.js';
import { createSpriteMaterial } from './menuMaterials.js';
import { destinationUrl, prefetch } from './menuRoutes.js';
// What counts as a mode, from the one place that decides it. See `swapTo`.
import { MODES } from '../game/modes.js';
import { fadeThrough } from '../ui/pageFade.js';
import { bootMenuDebug } from './MenuDebug.js';

/**
 * The main menu, on the same pipeline as everything else.
 *
 * ── the render order, and why it is this one ────────────────────────────────
 *
 *     viewport.bind()                  the low-res target
 *     render(world, perspective)       floor, bottle, plates
 *     clearDepth()                     the wipe is not part of the room
 *     render(overlay, orthographic)    the cap
 *     viewport.unbind()
 *     retroPass.render(...)            one upscale, one dither, one quantiser
 *
 * That is `main.js`'s card arrangement, unchanged, for the reason `CardLayer`
 * gives at length: the dither threshold is keyed to the low-res texel grid, so
 * it is a property of the FRAMEBUFFER and not of any object in it. Anything
 * drawn into the target before the pass comes out on the same 4x4 lattice as
 * everything else. A cap composited after the pass — or worse, as a DOM element
 * over the canvas — would be the one smooth thing on the screen at the exact
 * moment the whole screen is made of it.
 *
 * ── two ways out, and only one of them is a navigation ──────────────────────
 * 설정 swaps scene roots in place, so the whole four-stage run happens in one
 * continuous sequence of frames. The two game modes cannot: the game owns its
 * own renderer and its own Rapier world, and there is no honest way to host
 * that inside this page without rebuilding `main.js` around it. So they hand
 * over — at the covered frame, with the destination already prefetched, and
 * with the page repainted the cap's own red first so the seam between the two
 * documents is red-on-red rather than a flash of black. `main.js` picks stage 4
 * up on the other side out of its own overlay. See `menuRoutes`.
 */

export function bootMenu(canvas) {
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
  const viewport = new Viewport({ canvas, mode: cfg.view.renderMode });
  const retroPass = new RetroPass({ resolution: viewport.resolution });
  const retro = new RetroMaterials({ resolution: viewport.resolution });

  viewport.onResize(({ resolution }) => {
    retroPass.setResolution(resolution);
    retro.setResolution(resolution);
  });

  const scene = new Scene();
  scene.background = new Color('#05060a');

  const camera = new PerspectiveCamera(cfg.camera.fov, DISPLAY_ASPECT, 1, 400);

  // ── contents ─────────────────────────────────────────────────────────────
  const bottle = new Bottle({ retro, tuning: cfg.bottle });
  const items = new MenuItems({ retro, tuning: cfg.items });

  const floorMap = floorPoolTexture();
  const floor = new Mesh(
    new PlaneGeometry(1, 1),
    createSpriteMaterial(retro, { map: floorMap, opacity: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.scale.set(30, 30, 1);
  floor.renderOrder = -2;

  // The shadow and the burst are siblings of the bottle rather than children of
  // it: one lies on the floor whatever the bottle above it is doing, and the
  // other is placed by a world position every frame. Parenting either would add
  // the float to it twice.
  const menuRoot = new Group();
  menuRoot.add(floor, bottle.root, bottle.shadow, bottle.burst, items.root);
  scene.add(menuRoot);

  let settings = null;
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
  let marks = null;
  let editor = null;
  let confirm = null;
  /** Which scene root is live. Swapped under the cap at the covered frame. */
  let current = 'menu';
  /** True while the black fade back from settings is running. Blocks input. */
  let fading = false;

  // Its own overlay scene and camera; see the note in `CapWipe`.
  const wipe = new CapWipe({
    retro,
    tuning: cfg.wipe,
    panelMap: bottle.capTopMap,
    color: CAP_COLOR,
  });

  const transition = new Transition({ tuning: cfg.transition });

  // ── layout ───────────────────────────────────────────────────────────────
  /**
   * How many world units one framebuffer pixel is worth on the z = 0 plane.
   *
   * ── it is the TARGET's height, not the wipe's virtual frame ──────────────
   * This was the virtual 640x480 to begin with, matching the overlay, and it
   * was wrong in a way worth recording: the target is 320x240, so a plate
   * authored 128 texels wide landed on 64 real pixels and every piece of type
   * on it was resampled to half size — after `crispText` had gone to the
   * trouble of thresholding its alpha specifically so it would not be.
   *
   * The wipe's frame is virtual on purpose, so the cap keeps its share of the
   * screen at any internal resolution. The plates want the opposite: one texel
   * on one pixel, whatever that resolution happens to be. Reading it off
   * `viewport.resolution` gets that at every mode, and the resize hook below
   * re-lays them out when the panel changes it.
   */
  function unitsPerPixel() {
    const visibleHeight = 2 * cfg.camera.distance * Math.tan((cfg.camera.fov * Math.PI) / 360);
    return visibleHeight / viewport.resolution.y;
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
    camera.position.set(0, cfg.camera.height, cfg.camera.distance);
    camera.lookAt(0, cfg.camera.lookAtY, 0);
    camera.updateProjectionMatrix();
    items.layout(unitsPerPixel());
    // The pool goes under the BOTTLE, not under the middle of the frame. It is
    // the one light in the room and the bottle is what it is lighting.
    floor.position.set(cfg.bottle.originX, cfg.bottle.floorY, 0);
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
    if (transition.running || fading || !pointer.inside) {
      items.setHover(null);
      settings?.setHover(false);
      setCursor(null);
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
   * ── press to shake it up, release to open it ─────────────────────────────
   * Holding a menu item keeps the bottle in stage 1: it goes on being shaken,
   * the head goes on climbing, and nothing fires. Letting go opens it. A plain
   * tap still gets the full wind-up — the minimum is a floor, not a target —
   * so the quick way and the fun way both feel deliberate. `Transition.shakeEnd`
   * is where that floor lives.
   *
   * The release is caught on the WINDOW rather than the canvas. A press that
   * leaves the canvas before it comes up would otherwise never be released, and
   * the bottle would shake forever with no way to fire it.
   *
   * ── a run in flight is NOT interruptible, and that is the fix ────────────
   * There used to be a skip here: a press during the animation jumped straight
   * to the covered frame. It had to go, because with a press-and-hold opening
   * it turns double-tapping into a cheat — the first tap starts the run, the
   * second lands while the cap is still in the air and cuts the whole thing to
   * nothing, so hammering an item entered the game with no animation at all.
   *
   * Nothing is lost by removing it. The brief wanted the animation skippable
   * because you see it on every single menu choice; the RELEASE is now that
   * escape hatch, and a better one — you end the wind-up whenever you like and
   * the only thing you cannot do is go below the minimum. Which is precisely
   * what a skip that fires on the second tap of a double-tap was doing wrong.
   */
  function onDown(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.inside = true;

    if (transition.running || fading) return;

    if (current === 'settings') {
      const hit = settings?.pick(canvas, camera, e.clientX, e.clientY);
      if (!hit) return;
      if (hit.id === 'back') returnToMenu();
      // Sideways between two sub-screens, so it takes the short fade rather
      // than the cap: the cap wipe is the menu's way of ENTERING something, and
      // spending a second on it to move one row deeper would read as leaving.
      else if (hit.id === 'marks') fadeTo('marks');
      return;
    }
    if (current === 'marks') {
      const hit = marks?.pick(canvas, camera, e.clientX, e.clientY);
      marks?.activate(hit);
      return;
    }
    if (current === 'editor') {
      const hit = editor?.pick(canvas, camera, e.clientX, e.clientY);
      editor?.press(hit, e.clientX, e.clientY);
      return;
    }

    const hit = items.pick(canvas, camera, e.clientX, e.clientY);
    if (hit && !hit.disabled) run(hit.id, { held: true });
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
    transition.release();
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
  const mouth = new Vector3();
  const dir = new Vector3();

  /** World position -> the overlay's frame pixels. */
  function toFrame(world) {
    const p = world.clone().project(camera);
    return { x: (p.x * WIPE_FRAME.width) / 2, y: (p.y * WIPE_FRAME.height) / 2 };
  }

  function run(target, { held = false } = {}) {
    if (transition.running) return;
    items.setHover(null);
    items.enabled = false;

    // Started here rather than at the swap: by the time the cap is covering the
    // screen it is far too late for a fetch to help. Four hundred milliseconds
    // of shake is what this is buying.
    // The same question `swapTo` asks, asked the same way: a mode is a document
    // and everything else is a scene. Two hand-maintained lists of the same two
    // names is how curling ended up prefetching nothing and then not navigating.
    const navigating = Object.hasOwn(MODES, target);
    if (navigating) prefetch(destinationUrl(target));

    transition.begin(
      target,
      {
        onLaunch: () => {
          // The cap leaves the bottle and becomes the overlay's cap on the same
          // frame. Two caps for one frame, or none for one frame, are both
          // visible at 60 Hz.
          bottle.setCapVisible(false);
          bottle.popBurst();

          bottle.mouthWorld(mouth);
          bottle.mouthDirection(dir);
          const from = toFrame(mouth);
          // The heading is the bottle's own axis, projected — and by now the
          // bottle has turned to point that axis at the camera. A cap that came
          // off a leaning bottle and then flew straight up the screen would read
          // as two unrelated events.
          const ahead = toFrame(mouth.clone().addScaledVector(dir, 4));
          wipe.begin(from, { x: ahead.x - from.x, y: ahead.y - from.y });
        },
        onSwap: (id) => swapTo(id),
        onDone: () => {
          wipe.end();
          bottle.setCapVisible(true);
          items.enabled = true;
          refreshHover();
        },
      },
      { held },
    );
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
   * NOT the cap wipe, and the same fade the HUD's 메뉴 button uses to leave a
   * match — literally the same function, so the two ways back cannot drift
   * apart. The brief puts it as "복귀 시에는 전환 연출 없이 짧은 페이드": the cap
   * is what you get for STARTING something. Coming back is not an event, and
   * playing the same flourish in both directions makes leaving feel as
   * ceremonious as arriving, which is exactly backwards.
   */
  /**
   * Swap to any screen behind the short black fade.
   *
   * `returnToMenu` was this with the destination hard-coded, and a second
   * sub-screen made that a copy waiting to happen. The fade is the right
   * transition for every move that is not entering the menu's own items — see
   * the note on the settings press.
   */
  function fadeTo(target) {
    if (fading) return;
    fading = true;
    items.enabled = false;
    fadeThrough(
      () => swapTo(target),
      () => {
        fading = false;
        items.enabled = true;
        refreshHover();
      },
    );
  }

  function returnToMenu() {
    if (fading) return;
    fading = true;
    items.enabled = false;
    fadeThrough(
      () => swapTo('menu'),
      () => {
        fading = false;
        items.enabled = true;
        refreshHover();
      },
    );
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
    /**
     * A game MODE is a different document; everything else is a scene swap.
     *
     * ── it used to name the two modes, and adding a third broke it silently ──
     * The test was `id === 'knockout' || id === 'football'`, which is a list of
     * what happened to exist. Curling fell past it into the scene-swap branch,
     * which removes the menu root, matches none of the screens below, and lands
     * on the final `scene.add(menuRoot)` — so the transition played all five
     * stages, the cap flew off, and the menu was still there. No error, nothing
     * in the console, and the item simply did not work.
     *
     * `MODES` already decides everywhere else what a mode is — `menuRoutes`
     * strips mode segments with it, `modeKeyFromPath` reads them with it. Asking
     * the same object here means a fourth mode is an entry in `modes.js` and
     * nothing in this file.
     */
    if (Object.hasOwn(MODES, id)) {
      // The page is about to be replaced, and the gap between this document
      // going away and the next one's first frame is not under anyone's
      // control. What IS controllable is what fills it: with the whole window
      // painted the cap's own red — the letterbox included, so there is no edge
      // between the two — the gap is the same colour as the frames either side
      // of it and there is nothing to see. The game page sets the same colour
      // synchronously at module load and clears it once the cap has flown off.
      document.documentElement.style.background = CAP_COLOR;
      document.body.style.background = CAP_COLOR;
      location.assign(destinationUrl(id));
      return;
    }

    // Whatever is showing, stop showing it. One line rather than a subtraction
    // per screen, so adding a third cannot forget to remove the second.
    scene.remove(menuRoot);
    if (settings) scene.remove(settings.root);
    if (marks) scene.remove(marks.root);
    if (editor) scene.remove(editor.root);

    if (id === 'settings') {
      if (!settings) settings = new SettingsScene({ retro, unitsPerPixel: unitsPerPixel() });
      scene.add(settings.root);
      current = 'settings';
      return;
    }

    if (id === 'marks') {
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
          onBack: () => fadeTo('settings'),
        });
        marks.root.add(confirm.root);
      }
      // The dialog belongs to whichever screen is up: it is a child of that
      // root, so it is only drawn while that root is in the scene.
      if (confirm) marks.root.add(confirm.root);
      scene.add(marks.root);
      current = 'marks';
      return;
    }

    if (id === 'editor') {
      if (confirm) editor.root.add(confirm.root);
      scene.add(editor.root);
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
    retroPass,
    viewport,
    overlay: wipe.scene,
    onRebuild: () => bottle.rebuild(),
    onLean: () => bottle.applyLean(),
    onLayout: () => placeCamera(),
    onPlay: () => run('settings'),
    // ── 내 마크 ──
    markBook,
    palette: PALETTE,
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
      'position:fixed;left:12px;bottom:12px;z-index:9999;background:#05070bee;' +
      'padding:10px;border:1px solid #3c4759;font:11px ui-monospace;color:#8ea4c6;display:flex;gap:10px';
    const shot = (label, canvas) => {
      const cell = document.createElement('div');
      cell.style.textAlign = 'center';
      const cv = document.createElement('canvas');
      cv.width = 96;
      cv.height = 96;
      cv.style.cssText = 'image-rendering:pixelated;width:96px;height:96px;border:1px solid #3c4759';
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
  const shakeOffset = new Vector3();

  function tick(dt) {
    retro.shared.uSnapAmount.value = cfg.view.vertexSnap;

    const state = transition.update(dt);
    const shake = Math.pow(state.shake, cfg.bottle.shakeCurve);

    // The bottle turns its mouth toward the camera for the whole run and
    // unwinds once it is over — see `Bottle.applyLean`. Driven by the STAGE
    // rather than by the shake envelope, so it is fully aimed before the cap
    // goes rather than only as far round as the last wobble left it.
    bottle.update(dt, { shake, aim: transition.running ? 1 : 0, camera });
    // The burst is a billboard and the camera is very nearly fixed, but "very
    // nearly" is what leaves a sprite visibly edge-on when the camera shakes.
    bottle.burst.quaternion.copy(camera.quaternion);

    items.update(dt, current === 'menu' ? 1 : 0);
    settings?.update(dt);
    // The view mode's inertia lives here; nothing else in the editor moves.
    if (current === 'editor') editor?.update(dt);

    // ── the camera's own shake ─────────────────────────────────────────────
    // Same frequency family as the bottle's and a fraction of the amplitude.
    // Position only; rotating the camera would swing the whole frame and read
    // as an earthquake rather than as a hand shaking a bottle.
    if (shake > 0) {
      const c = cfg.camera;
      const t = performance.now() * 0.001;
      shakeOffset.set(
        Math.sin(t * Math.PI * 2 * c.shakeFrequency) * c.shakeStrength * shake,
        Math.sin(t * Math.PI * 2 * c.shakeFrequency * 1.31) * c.shakeStrength * shake,
        0,
      );
    } else {
      shakeOffset.set(0, 0, 0);
    }
    camera.position.set(shakeOffset.x, cfg.camera.height + shakeOffset.y, cfg.camera.distance);

    switch (state.stage) {
      case STAGE.LAUNCH:
        wipe.launch(state.t, dt);
        break;
      case STAGE.COVER:
        wipe.cover(dt);
        break;
      case STAGE.EXIT:
        wipe.exit(state.t, dt);
        break;
      default:
        break;
    }

    debug.frame(state);
    render();
  }

  function render() {
    const r = viewport.renderer;
    viewport.bind();
    r.render(scene, camera);
    wipe.render(r);
    viewport.unbind();
    retroPass.render(r, viewport.renderTarget.texture);
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
    run, toFrame, scene,
    // The screens, for the same reason `tick` is here: a sub-screen sits behind
    // a cap wipe and a fade, and neither is something you can step through by
    // hand from the outside.
    swapTo, markBook, openEditor,
    get marks() { return marks; }, get settings() { return settings; },
    get editor() { return editor; },
  };
}

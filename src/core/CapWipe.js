import { Group, Mesh, Scene, Vector2 } from 'three';
import { FRAME as SHARED_FRAME, frameCamera, halfDiagonal } from './frame.js';
import { buildCapGeometry, CAP_DEFAULTS, CAP_GROUP } from '../cap/capGeometry.js';
import { PALETTE } from './palette.js';

/**
 * The cap that flies at the camera and takes the screen with it.
 *
 * ── it was deleted, and it is back on instruction ──────────────────────────
 * This file shipped, was replaced by a letterbox, and is restored by §7.2. The
 * letterbox's own argument for taking over was sound as far as it went — a
 * covered frame only has to hide a document swap, and two bars closing do that
 * with no geometry at all. What it could not do is §9's chain:
 *
 *     소다 병 → 병뚜껑 → 알까기 말 → 게임 보드 → 축구 필드
 *
 * That is a claim about the game's world, not about its transitions: the cap
 * you flick across a board is the cap that comes off the bottle, and the way to
 * say so is to let the same object carry the screen from one place to the next.
 * Bars are a cut with a decoration on it; an object is a continuity.
 *
 * ── what changed on the way back ───────────────────────────────────────────
 * The original leaned on a pipeline that no longer exists — its header explained
 * that the overlay was drawn inside the bound low-resolution target so the wipe
 * got the same dither lattice, the same five bits a channel and the same
 * nearest-neighbour upscale as whatever it was covering. All three went with the
 * retro pass. The overlay arrangement stays anyway, for the one reason that
 * survived: an orthographic overlay with its own camera is how a cap can be
 * scaled three hundred times without meeting a near plane.
 *
 * It is cobalt now rather than red, and that is the transition's identity rather
 * than a detail of the cap — see `PALETTE.menu.capBrand`.
 *
 * ── it lives in an ORTHOGRAPHIC overlay, and that is not a shortcut ─────────
 * The obvious way to build this is a perspective camera and a cap pushed toward
 * the near plane. It does not work: the near plane clips it, and long before
 * that the cap's own skirt — six millimetres of it, blown up three hundred
 * times — reaches past the camera and turns inside out. An orthographic camera
 * with a growing scale says the same thing ("this is getting closer") with no
 * near plane to hit and no depth range to run out of.
 *
 * The overlay is the card scene's arrangement: its own scene, its own
 * orthographic camera over the shared frame, drawn after a depth clear. It is
 * not a DOM element and not a post-pass, because it has to be an OBJECT — lit
 * by the same rig, wearing the same wet-metal material, carrying the same
 * artwork as the cap on the bottle. A CSS circle growing to fill the screen
 * would cover the frame just as well and would say nothing.
 *
 * ── the cap is the game's cap ──────────────────────────────────────────────
 * Straight out of `capGeometry`, `shell: false`. Nothing here builds a special
 * flat disc for the covering frame, and the reason is that the covering frame
 * has to be the SAME OBJECT the player just watched leave the bottle. That is
 * the whole of §9 in one line of construction.
 *
 * ── coverage is computed, not eyeballed ─────────────────────────────────────
 * `_panelRadius` is measured off the geometry the mesh is actually drawing: the
 * largest radius in the PANEL group, which is the flat disc on top of the cap.
 * Conservative on purpose — the skirt reaches further out than the panel does,
 * but its outline is scalloped by the 21 flutes, and the guaranteed-opaque disc
 * is the one that fits inside the troughs. The panel is that disc.
 *
 * From it, `coverScale` is
 *
 *     (halfDiagonal + offset) / (panelRadius * cos(axisTilt)) * safety
 *
 * — the cosine because a disc turned away from the camera projects to an
 * ellipse whose minor axis is that much shorter, and the spin about its own
 * normal is free precisely because a disc has no opinion about it. `margin()`
 * reports the same arithmetic as a number of frame pixels, which is what the
 * panel's gap check reads.
 */

/** The layout box, in frame pixels. The shared, live one — see core/frame.js. */
export const WIPE_FRAME = SHARED_FRAME;

// See core/frame.js: `halfDiagonal()` is a function now, because the wipe has
// to cover a frame whose diagonal can change. A stale constant left a gap.

/** Largest radius in the geometry's panel group — the guaranteed-opaque disc. */
function measurePanelRadius(geometry) {
  const index = geometry.getIndex();
  const pos = geometry.getAttribute('position');
  const group = geometry.groups.find((g) => g.materialIndex === CAP_GROUP.PANEL);
  if (!index || !group) return geometry.userData.radius ?? 1;

  let max = 0;
  for (let i = group.start; i < group.start + group.count; i++) {
    const v = index.getX(i);
    const r = Math.hypot(pos.getX(v), pos.getZ(v));
    if (r > max) max = r;
  }
  return max || (geometry.userData.radius ?? 1);
}

export class CapWipe {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {object} tuning  the live `MENU_CONFIG.wipe` block
   * @param {import('three').Texture} [panelMap]  the cap's top artwork
   */
  constructor({ retro, tuning, panelMap = null, color = PALETTE.menu.capBrand, panelColor = PALETTE.untinted }) {
    this.tuning = tuning;

    this.root = new Group();
    this.root.visible = false;

    /**
     * Its own scene and its own camera, rather than borrowing the host's.
     *
     * It has two hosts — the menu and the game — and the game's existing
     * overlay is the CARD layer, whose camera has a depth range of ±100 because
     * a card is flat. A cap blown up three hundred times is two hundred units
     * deep from hem to panel and would be clipped in half by it. Owning the
     * camera is also what lets both call sites be three lines each.
     *
     * The frame is virtual and fixed at 640x480 whatever the render target is,
     * so dropping the internal resolution makes the cap coarser along with
     * everything else instead of doubling its size on screen. Same reasoning as
     * `CardLayer`'s.
     */
    this.scene = new Scene();
    this.camera = frameCamera({ near: -3000, far: 3000 });
    this.scene.add(this.root);

    this.geometry = buildCapGeometry({ ...CAP_DEFAULTS, shell: false });
    this.materials = [
      retro.create({ color, preset: 'wetMetal' }),
      /**
       * The top is what fills the screen at the covered frame, so its artwork is
       * the one texture in this project that gets magnified past all reason —
       * about six times, to 800 pixels off 128 texels. It carries the game's
       * name, laid out for exactly this: see `capLogoTexture`, which keeps
       * everything readable inside the largest 4:3 rectangle that fits in the
       * disc, because that rectangle is all of it you can see at full cover.
       *
       * The name is VECTOR LETTERING there, which matters more here than
       * anywhere else: this is the one texture whose type is magnified six
       * times, so a webfont that had not loaded when it was baked would be six
       * times as obviously wrong.
       *
       * `panelColor` is white by default and that matters — the map brings its
       * own ink, and multiplying it by the cap's cobalt as well would come out
       * nearly black. Only a greyscale placeholder wants tinting.
       */
      /**
       * ── the panel is PRINT, not mirror, and only here ──────────────────
       * The cap on the bottle wears `wetMetal` on both groups and should: it is
       * a small metal object and its metal is the identity. At 300x it is not a
       * small object. `metalness` 0.62 means the surface takes its colour from
       * the environment rather than from its own albedo, and a cobalt field
       * under a three-stop gradient came out at `#8c9dbd` — measured — against
       * a `#2a6fc0` surround. A washed grey-blue frame inside a cobalt window
       * is exactly the seam §7.3 asks to be closed.
       *
       * So the wipe's panel is ink on metal: almost no metalness, a clearcoat
       * for the sheen, and half the environment. The SKIRT above keeps
       * `wetMetal` — that is the part you see spinning during the flight, at a
       * size where it really is a small metal object.
       */
      panelMap
        ? retro.create({
            map: panelMap,
            color: panelColor,
            metalness: 0.04,
            roughness: 0.52,
            clearcoat: 0.35,
            clearcoatRoughness: 0.2,
            envIntensity: 0.5,
          })
        : retro.create({ color, preset: 'wetMetal' }),
    ];
    this.mesh = new Mesh(this.geometry, this.materials);

    /**
     * Three nested groups rather than three Euler angles on one object.
     *
     * Each rotation has to happen about a different frame, and an Euler triple
     * cannot say that — its three angles share one frame and the order string
     * only shuffles them within it. Nesting states it exactly:
     *
     *   precess  about the VIEW axis, so the lean sweeps round as it tumbles
     *   tilt     off the view axis, and the one term that costs coverage
     *   spin     about the CAP'S OWN normal, which is what turns the artwork
     *
     * The mesh's own quarter turn is the last link: the cap is built with +y up
     * through the panel and the overlay camera looks down -z, so +90 degrees
     * about x is what puts the panel face-on. Anything less and the covering
     * frame would be showing the screen the inside of the skirt.
     */
    this.precess = new Group();
    this.tilt = new Group();
    this.spin = new Group();
    this.mesh.rotation.x = Math.PI / 2;
    this.spin.add(this.mesh);
    this.tilt.add(this.spin);
    this.precess.add(this.tilt);
    this.root.add(this.precess);

    this._panelRadius = measurePanelRadius(this.geometry);
    /** Set by `begin`. Frame pixels, from the frame's centre. */
    this._from = new Vector2();
    this._dir = new Vector2(0, 1);
    this._spin = 0;
    this._scale = 0;
    /** Latched orientation targets for the settle. Null while tumbling free. */
    this._settleSpin = null;
    this._settlePrecess = 0;
  }

  /**
   * The scale at which the panel alone certainly covers the frame.
   *
   * `offset` is how far the cap's centre is from the frame's, in frame pixels;
   * a cap that covers from the middle needs less of it than one that covers
   * from off to one side.
   */
  coverScale(offset = 0) {
    const tilt = (this.tuning.axisTilt * Math.PI) / 180;
    const usable = this._panelRadius * Math.max(0.2, Math.cos(tilt));
    return ((halfDiagonal() + offset) / usable) * this.tuning.coverSafety;
  }

  /**
   * How many frame pixels of the panel stick out past the frame's far corner
   * right now. Negative means there is a gap, and the panel's gap check is
   * exactly this number.
   */
  margin() {
    // The tilt it is ACTUALLY at, not the budgeted worst case — this is a
    // readout of what is on screen, and by the covered frame the cap has
    // squared up and is doing better than `coverScale` paid for.
    const reach = this._panelRadius * this._scale * Math.cos(this.tilt.rotation.x);
    return reach - this.root.position.length() - halfDiagonal();
  }

  /**
   * @param {{x: number, y: number}} from  where it launches, in frame pixels
   * @param {{x: number, y: number}} direction  which way it flies; normalised here
   */
  begin(from, direction) {
    this._from.set(from.x, from.y);
    this._dir.set(direction.x, direction.y);
    if (this._dir.lengthSq() < 1e-6) this._dir.set(0, 1);
    this._dir.normalize();
    this._spin = 0;
    this.root.visible = true;
  }

  /**
   * ── stage 2 ──────────────────────────────────────────────────────────────
   * From the bottle's mouth to dead centre, growing from a speck to full cover.
   * The scale runs on a cubic so almost all of the growth is in the last third:
   * a linear ramp reads as a disc being inflated in front of the camera rather
   * than as something coming AT it, because a real approach is 1/distance.
   */
  launch(t, dt) {
    const cfg = this.tuning;
    const target = this.coverScale(0);
    /**
     * Cubic, so almost all of the growth is in the last third.
     *
     * §21 asks for material motion rather than preset easing, and for a disc
     * approaching the camera the material fact is that apparent size goes as
     * 1/distance — which at constant speed is very nearly a cubic over this
     * range. A linear ramp reads as a disc being inflated in front of the
     * camera rather than as one coming AT it, and that is a difference anybody
     * can see without being able to name.
     */
    const ease = t * t * t;
    this._scale = target * (cfg.startScale + (1 - cfg.startScale) * ease);

    // Toward the middle, on a softer curve than the scale, so it has arrived
    // before it has finished growing — otherwise the last frames of the growth
    // happen while it is still sliding and one corner opens up.
    const arrive = 1 - (1 - t) * (1 - t);
    this.root.position.set(this._from.x * (1 - arrive), this._from.y * (1 - arrive), 0);
    // Free to tumble for the first half of the flight, then squaring up so the
    // logo is level by the time the frame is opaque. See `_advance`.
    this._advance(dt, Math.max(0, (t - 0.5) / 0.5));
  }

  /**
   * ── stage 3 ──────────────────────────────────────────────────────────────
   * Dead centre, at full cover, still turning. The scene swap happens under
   * this, and nothing in here may move the cap off the middle: `margin()` is
   * computed for offset 0 and this is the only stage where that is asserted.
   */
  cover(dt) {
    this._scale = this.coverScale(0);
    this.root.position.set(0, 0, 0);
    // Held square and level: this is the frame the logo is presented on.
    this._advance(dt, 1);
  }

  /**
   * ── stage 4 ──────────────────────────────────────────────────────────────
   * Straight on, along the same heading, and out of the frame.
   *
   * It keeps GROWING as it goes, which is what makes it read as passing the
   * camera rather than sliding away like a door. Accelerating, so the near edge
   * appears at a plausible speed and then whips off instead of drifting.
   *
   * It never fades and it is never hidden — by the time this stage ends the cap
   * is outside the frame under its own steam, and `margin()` has gone
   * comfortably negative, which is the same test that proved it covered.
   */
  exit(t, dt) {
    const cfg = this.tuning;
    const base = this.coverScale(0);
    const travel = Math.pow(t, 1.7) * cfg.exitTravel;
    this._scale = base * (1 + (cfg.exitGrowth - 1) * t);
    this.root.position.set(this._dir.x * travel, this._dir.y * travel, 0);
    // Picking the tumble back up as it goes, so it leaves the way it arrived.
    this._advance(dt, Math.max(0, 1 - t / 0.4));
  }

  /** Jump straight to full cover. The skip, and the game page's cold start. */
  snapToCover() {
    this.root.visible = true;
    this.cover(0);
  }

  end() {
    this.root.visible = false;
  }

  /**
   * Draw it over whatever is already in the bound target.
   *
   * The depth clear is not optional: the cap is not part of the world under it
   * and must not be sorted against it — it is in front by definition, not by
   * being nearer. `autoClear` goes off around it so the scene underneath
   * survives, and back on afterwards because the next frame's first render
   * expects to be clearing.
   *
   * @param {import('three').WebGLRenderer} renderer
   */
  render(renderer) {
    if (!this.root.visible) return;
    renderer.clearDepth();
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  /**
   * @param {number} settle
   *   0 = tumbling freely. 1 = square on to the camera and the right way up.
   *
   * ── the logo has to LAND ────────────────────────────────────────────────
   * The cap's panel carries the game's logo and the covered frame is the one
   * moment it is eight hundred pixels across. Left tumbling, it arrives at
   * whatever angle the spin happened to be at — the screen fills with the right
   * image, lying on its side. So the spin eases into the nearest whole turn and
   * the axis tilt eases to zero over the end of the flight, holds there for the
   * covered frames, and unwinds again on the way out. Tumble, land, tumble.
   *
   * The target is LATCHED the first time it is needed rather than recomputed:
   * `_spin` is still growing during the settle, so a target computed fresh each
   * frame would jump a whole turn the moment the spin crossed it, and the cap
   * would visibly flick. A quarter turn of lead-in means it always eases
   * FORWARD into place instead of reversing to get there.
   */
  _advance(dt, settle = 0) {
    const TAU = Math.PI * 2;
    this._spin += dt * this.tuning.spinSpeed * TAU;
    this.root.scale.setScalar(this._scale);

    const s = settle * settle * (3 - 2 * settle);
    // Slower than the spin, and deliberately not a whole-number ratio of it, so
    // the tumble never settles into a period the eye can lock onto over the
    // half second it is on screen.
    const precess = this._spin * 0.37;

    if (s <= 0) {
      this._settleSpin = null;
    } else if (this._settleSpin === null) {
      this._settleSpin = Math.ceil((this._spin + 0.25) / TAU) * TAU;
      this._settlePrecess = Math.round(precess / TAU) * TAU;
    }

    if (s > 0) {
      this.spin.rotation.z = this._spin + (this._settleSpin - this._spin) * s;
      this.precess.rotation.z = precess + (this._settlePrecess - precess) * s;
    } else {
      this.spin.rotation.z = this._spin;
      this.precess.rotation.z = precess;
    }

    // Face-on at full settle, which also means the covering frame is not paying
    // the cosine that `coverScale` conservatively budgets for.
    this.tilt.rotation.x = ((this.tuning.axisTilt * Math.PI) / 180) * (1 - s);
  }

  dispose() {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.root.clear();
    this.scene.clear();
  }
}

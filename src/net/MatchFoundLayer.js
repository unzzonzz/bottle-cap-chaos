import { Group, Mesh, PlaneGeometry, Scene } from 'three';
import { FRAME as SHARED_FRAME, frameCamera, refitFrameCamera } from '../core/frame.js';
import { buildCapGeometry, CAP_DEFAULTS, CAP_GROUP } from '../cap/capGeometry.js';
import { PLAYER_COLORS } from '../render/playerColors.js';
import { HudMaterials } from '../ui/HudMaterial.js';
import { turnPlateTexture } from '../ui/hudTextures.js';
import { PALETTE } from '../core/palette.js';

/**
 * 매칭 성립 — the two players, before the board.
 *
 * ── the placement is the point, and it is not decorative ─────────────────
 * The opponent comes in TOP-LEFT and you come in BOTTOM-RIGHT, and those are
 * the corners the game itself uses: in a match the opponent's hand is parked at
 * the top of the screen and yours is at the bottom. So the sequence does not
 * merely announce who you are playing, it teaches the reading of the screen you
 * are about to be dropped into — and it ends by sliding both caps to exactly
 * those places, so the cut into the match is a continuation rather than a jump.
 *
 * That is why the exit is a MOVE and not a fade. A fade would say "that screen
 * is over"; the slide says "this is where those two things live".
 *
 * ── it draws into the low-res target, like everything else ───────────────
 * `render` is called between the world and `retroPass`, so this layer goes
 * through the identical dither, the identical five-bits-a-channel quantiser and
 * the identical upscale. `RetroPass` keys its dither to the framebuffer texel
 * grid — the pattern belongs to the FRAMEBUFFER, not to any object in it — so a
 * layer composited after the pass would sit on its own lattice at its own phase
 * and the seam would be the most visible thing on screen.
 *
 * ── the effect vocabulary is the sanctioned one ──────────────────────────
 * Alpha-blended sprites, and that is all of it. No bloom, no particles, no
 * motion blur — none of which exist anywhere in this project and all of which
 * would be a different game's look. The caps are real geometry lit by the same
 * `RetroMaterial` the board uses, so they are the same objects the player is
 * about to be handed.
 *
 * There was a white arrival flash here and it is gone, on instruction. It was
 * within the sanctioned vocabulary and it still read as a blown-out square
 * rather than as an impact — a quad that can only be a rectangle is a poor
 * flash, and the entrance already lands with an ease-out that reads as weight.
 */

/** The virtual frame every overlay in this project is authored against. */
/** The layout box, in frame pixels. The shared, live one — see core/frame.js. */
const FRAME = SHARED_FRAME;

/**
 * Where the two caps live, in frame pixels.
 *
 * `from` is off-screen, `at` is the standoff, and `to` is where the match's own
 * UI keeps that player — which is what makes the exit a continuation.
 */
const SPOTS = {
  opponent: {
    from: { x: -420, y: 320 },
    at: { x: -150, y: 96 },
    to: { x: -150, y: 300 },
  },
  self: {
    from: { x: 420, y: -320 },
    at: { x: 150, y: -96 },
    to: { x: 150, y: -300 },
  },
};

/** Cap width on screen, in frame pixels. */
const CAP_WIDTH = 132;
/** How far under a cap its name plate sits. */
const PLATE_DROP = 96;

const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

export class MatchFoundLayer {
  /**
   * @param {object} opts
   * @param {import('../core/RetroMaterial.js').RetroMaterials} opts.retro
   * @param {import('three').Vector2} opts.resolution
   * @param {object} opts.config
   * @param {(player: number) => import('three').Texture} opts.panelFor
   *   The same mark textures the board uses, so the cap shown here is the cap
   *   that is about to be on the table — including an opponent's mark that
   *   arrived over the wire.
   */
  constructor({ retro, resolution, config, panelFor }) {
    this._retro = retro;
    this.config = config;
    this.panelFor = panelFor;
    this.active = false;
    this.done = false;
    /** Seconds since `begin`. Advanced by `update`, never by a clock. */
    this.t = 0;

    this.scene = new Scene();
    // Depth is generous and the camera is off the origin because this holds real
    // cap geometry: at the origin the view vector through a cap on z = 0 is
    // degenerate and the gloss term in the shared vertex shader goes to noise.
    this.camera = frameCamera({ near: -3000, far: 3000 });
    this.camera.position.z = 1000;

    this.ui = new HudMaterials({ resolution });
    this._geometry = buildCapGeometry({ ...CAP_DEFAULTS, shell: true });
    const capR = this._geometry.userData.radius ?? 1.6;
    this._capScale = CAP_WIDTH / (capR * 2);

    this._quad = new PlaneGeometry(1, 1);
    this.seats = [null, null];
    this._plates = [null, null];
    this._labels = [null, null];
  }

  /**
   * @param {object} opts
   * @param {number} opts.selfSeat
   * @param {string} opts.selfName
   * @param {string} opts.opponentName
   */
  begin({ selfSeat, selfName, opponentName }) {
    this.reset();
    this.selfSeat = selfSeat;
    this.oppSeat = selfSeat === 0 ? 1 : 0;
    this._names = { [selfSeat]: selfName, [this.oppSeat]: opponentName };

    for (const role of ['opponent', 'self']) {
      const player = role === 'self' ? selfSeat : this.oppSeat;
      const pivot = new Group();
      pivot.scale.setScalar(this._capScale);

      const materials = [];
      const retro = this._retro;
      materials[CAP_GROUP.BODY] = this._sortable(retro.create({ color: PLAYER_COLORS[player] }));
      // White, because the mark bake already contains the cap's paint — the
      // paired contract `markTextures` states. Tinting it again would double it.
      materials[CAP_GROUP.PANEL] = this._sortable(
        retro.create({ map: this.panelFor?.(player) ?? null, color: PALETTE.untinted }),
      );
      materials[CAP_GROUP.LINER] = this._sortable(
        retro.create({ color: PALETTE.metal.liner, gloss: 0.35 }),
      );

      const cap = new Mesh(this._geometry, materials);
      // The editor's pose: panel toward the camera, parked on its mid-height.
      cap.rotation.x = Math.PI / 2;
      cap.position.z = -(this._geometry.userData.height ?? 0) * 0.5;
      pivot.add(cap);
      pivot.renderOrder = 20;
      this.scene.add(pivot);

      const plate = new Mesh(this._quad, this.ui.create(null));
      plate.renderOrder = 21;
      this.scene.add(plate);

      this.seats[player] = { role, pivot, plate };
    }

    this.active = true;
    this.done = false;
    this.t = 0;
    this._layout();
  }

  /** Segment lengths, all live off the config so the panel can move them. */
  get _timing() {
    const c = this.config.intro ?? {};
    return {
      self: Math.max(0, c.selfSec ?? 0.55),
      opponent: Math.max(0, c.opponentSec ?? 0.55),
      hold: Math.max(0, c.holdSec ?? 0.9),
      exit: Math.max(0, c.exitSec ?? 0.5),
    };
  }

  get duration() {
    const t = this._timing;
    return t.self + t.opponent + t.hold + t.exit;
  }

  /**
   * Advance. Takes a dt rather than reading a clock, so the sequence runs at the
   * same speed on a 144 Hz display as on a 60 Hz one and can be stepped by hand.
   */
  update(dt) {
    if (!this.active) return;
    this.t += Math.max(0, dt);
    if (this.t >= this.duration) {
      this.t = this.duration;
      this._layout();
      this.active = false;
      this.done = true;
      return;
    }
    this._layout();
  }

  /**
   * Cut to the end.
   *
   * ── not a player control ─────────────────────────────────────────────────
   * This was bound to a press and is not any more: the sequence is unskippable
   * by instruction. What still calls it is `main.js`'s stall guard — a frame
   * clock that has stopped, which a backgrounded tab really does cause, and
   * which would otherwise leave a player waiting forever on an animation that
   * is not advancing.
   *
   * Not "stop drawing": the sequence is jumped to its final frame, which is the
   * frame whose whole job is to be continuous with the match behind it. Simply
   * hiding the layer would drop the two caps from wherever they had got to,
   * which is the one thing the ending is designed to avoid.
   */
  skip() {
    if (!this.active) return;
    this.t = this.duration;
    this._layout();
    this.active = false;
    this.done = true;
  }

  _layout() {
    const T = this._timing;
    const selfIn = clamp01(this.t / (T.self || 1e-6));
    const oppIn = clamp01((this.t - T.self) / (T.opponent || 1e-6));
    const exitStart = T.self + T.opponent + T.hold;
    const out = clamp01((this.t - exitStart) / (T.exit || 1e-6));

    for (const player of [0, 1]) {
      const seat = this.seats[player];
      if (!seat) continue;
      const spot = SPOTS[seat.role];
      const enter = seat.role === 'self' ? selfIn : oppIn;

      // In on an ease-out — it arrives and settles — and out on an ease-in, so
      // the departure accelerates into the cut rather than drifting.
      const a = easeOut(enter);
      const b = easeIn(out);
      const x = lerp(lerp(spot.from.x, spot.at.x, a), spot.to.x, b);
      const y = lerp(lerp(spot.from.y, spot.at.y, a), spot.to.y, b);

      seat.pivot.position.set(x, y, 0);
      /**
       * A turn that ARRIVES, plus a small breath. Not a spin.
       *
       * This used to add `t * 0.35`, an unbounded accumulation — so the longer
       * the sequence ran the further the cap rotated, and past about four
       * seconds it was edge-on: a crown cap seen from the side is a striped
       * cylinder and reads as broken geometry rather than as a bottle cap. It
       * was invisible at the 2.5 s default and obvious the moment the segment
       * sliders were opened up, which is what those sliders are for.
       *
       * The entrance swing is bounded by `a`, and the idle motion is a ±3°
       * oscillation — enough that the cap is not a dead sprite, small enough
       * that it never turns away from the viewer however long it is held.
       */
      seat.pivot.rotation.y = (1 - a) * -0.9 + Math.sin(this.t * 1.6) * 0.055;

      const shown = enter > 0 ? 1 - b : 0;
      this._setOpacity(seat.pivot, shown);

      // The name plate rides under its cap.
      this._syncPlate(player, x, y - PLATE_DROP, shown);

    }
  }

  _syncPlate(player, x, y, shown) {
    const seat = this.seats[player];
    const name = this._names?.[player] ?? '';
    if (!name) {
      seat.plate.visible = false;
      return;
    }
    if (this._labels[player] !== name) {
      this._labels[player] = name;
      const tex = turnPlateTexture(name, PLAYER_COLORS[player], {
        width: 152,
        height: 26,
        scale: this.config.ui?.textureScale ?? 1,
      });
      seat.plate.material.uniforms.uMap.value = tex;
      const w = tex.userData?.width ?? 152;
      seat.plate.scale.set(w, 26, 1);
    }
    seat.plate.position.set(x, y, 2);
    seat.plate.material.uniforms.uOpacity.value = shown;
    seat.plate.visible = shown > 0.004;
  }

  _setOpacity(pivot, value) {
    pivot.visible = value > 0.004;
    for (const child of pivot.children) {
      for (const m of child.material ?? []) {
        if (m?.uniforms?.uOpacity) m.uniforms.uOpacity.value = value;
      }
    }
  }

  /**
   * A lit material in an overlay must be transparent.
   *
   * three.js draws every opaque object before every transparent one and honours
   * `renderOrder` only WITHIN each half. An opaque cap here would be drawn
   * before the name plate regardless of the order set on it — see
   * `VictoryLayer._sortable`, which says the same thing at more length after
   * hitting the same wall.
   */
  _sortable(material) {
    material.transparent = true;
    return material;
  }

  setResolution(resolution) {
    this.ui.setResolution(resolution);
    refitFrameCamera(this.camera);
  }

  render(renderer) {
    if (!this.visible) return;
    // In front by definition rather than by being nearer. Same three lines as
    // `VictoryLayer.render` and `CapWipe.render`, for the same reason.
    renderer.clearDepth();
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  /** Drawn while running, and on the final frame so the cut is not a pop. */
  get visible() {
    return this.active;
  }

  reset() {
    for (const seat of this.seats) {
      if (!seat) continue;
      this.scene.remove(seat.pivot, seat.plate);
      for (const child of seat.pivot.children) {
        for (const m of child.material ?? []) m?.dispose();
      }
      seat.plate.material.dispose();
    }
    this.seats = [null, null];
    this._labels = [null, null];
    this.active = false;
    this.t = 0;
  }

  dispose() {
    this.reset();
    this._geometry.dispose();
    this._quad.dispose();
    this.ui.dispose();
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

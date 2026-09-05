import { Group, Mesh, PlaneGeometry, Scene } from 'three';
import {
  FRAME as SHARED_FRAME,
  frameCamera,
  frameScale,
  refitFrameCamera,
} from '../core/frame.js';
import { buildCapGeometry, CAP_DEFAULTS, CAP_GROUP } from '../cap/capGeometry.js';
import { PLAYER_COLORS } from '../render/playerColors.js';
import { HudMaterials } from '../ui/HudMaterial.js';
import { turnPlateTexture } from '../ui/hudTextures.js';
import { PALETTE } from '../core/palette.js';
import { letterboxBar } from '../core/Cinematic.js';
import { SIZE } from '../core/tokens.js';

/**
 * 경기 시작 — the two players, before the board.
 *
 * ── it was `net/MatchFoundLayer.js`, and the move is not cosmetic ─────────
 * It was written for 매칭 성립, the moment an online room fills, which is why it
 * lived among the sockets. It has never had a line of networking in it — two
 * caps, two name plates and a clock — and it has opened LOCAL and AI matches for
 * as long as it has opened online ones. `config.intro` was lifted out of the
 * online group for exactly this reason and says so.
 *
 * The redesign made the misfiling expensive rather than untidy: `src/net/` is
 * one of the directories this work is forbidden to touch, and the layout below
 * had to change to fit inside the letterbox. Moving it means that rule stays
 * meaningful — after this, a diff in `src/net/` really is a change to the
 * network — instead of being spent on a file that was only there by accident.
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
 * ── it plays inside the LETTERBOX, and that is a layout constraint ───────
 * `core/Cinematic.js` has the bars at the letterbox position for the whole of
 * this sequence, so the band is the frame less `letterboxBar()` at each edge and
 * everything here has to fit inside it. A bar is a margin, not a UI surface —
 * "바 안에 글자를 쓰지 마라" — and a name plate half under one is worse than no
 * name plate.
 *
 * `_layout` therefore solves the standoff and the plate drop against the band
 * rather than taking them as given. It has to be solved and not merely checked,
 * because the band's height moves with the frame's while the bar does not: on a
 * landscape phone the frame is 314 tall, the two bars take 112 of it, and the
 * authored positions put the near player's plate 16 pixels into the bottom one.
 *
 * The UI underneath is not merely hidden while this runs, it is UNPRESSABLE —
 * see `uiGate` in `main.js`. A button you can see and cannot press is
 * indistinguishable from a broken one, and one you cannot see and CAN press is
 * worse. Nor does a press do anything ELSE: the sequence is unskippable, so for
 * its whole length the screen simply does not answer. See `skip`.
 *
 * ── it draws onto the finished frame, like every other overlay ───────────
 * `render` is called after the world's bloom chain, not inside it. It used to be
 * the opposite — everything went into one low-resolution target so that the
 * whole screen took one dither lattice and one quantiser — but this layer is
 * two caps and a line of type, and type is what a bright-pass ruins.
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
    at: { x: -150, y: 84 },
    to: { x: -150, y: 300 },
  },
  self: {
    from: { x: 420, y: -320 },
    at: { x: 150, y: -84 },
    to: { x: 150, y: -300 },
  },
};

/**
 * Cap width on screen, in frame pixels — at the authored 640-wide frame.
 *
 * 여기 숫자들은 전부 640x480 기준이다. `_layout` 이 `frameScale()` 을 곱한다.
 * 곱하지 않으면 421 프레임에서 뚜껑 두 개가 프레임 폭의 63% 를 차지하고, 시작
 * 위치(-420, 320)는 프레임 밖의 두 배 거리라 등장 동작의 대부분이 화면 밖에서
 * 일어난다 — 뚜껑이 갑자기 나타나는 것처럼 보인다.
 */
const CAP_WIDTH = 132;
/**
 * From a cap's centre to its name plate's centre, in frame pixels.
 *
 * DERIVED by `plateDrop` below, because it is not a taste — it is "the plate
 * hangs clear of the cap". The cap is a disc and the plate is directly under its
 * middle, so the clearance is the disc's own radius plus half the plate plus
 * this. Writing the whole distance as a literal is how it went wrong the first
 * time: 78 was measured against a 26-tall plate and left exactly one pixel, so
 * raising the plate to the token height put it straight through the cap's hem.
 */
const PLATE_GAP = 8;

/**
 * The name plate. Width is authored; HEIGHT comes from the token.
 *
 * ── 26 was a number this file invented, and the type did not fit in it ─────
 * `turnPlateTexture` insets the pill by 5 and draws `TYPE.label` at 17px, so a
 * 26-tall plate is a 16-tall pill holding a 17-pixel line: the glyphs were
 * taller than the box around them and there was no padding above or below them
 * at all. The in-game turn plate says the same kind of thing with the same type
 * at `SIZE.turnPlate.h`, and it looks right because 44 is what that type needs.
 *
 * How much room a label gets above and below it is a property of the COMPONENT,
 * not of what the label says — the same argument `VictoryLayer`'s buttons make
 * for taking their height from `SIZE.buttonFooter`. So the height is the token
 * and only the width stays authored, because the width really is about the text.
 */
const PLATE = { width: 152, height: SIZE.turnPlate.h };

/**
 * Clearance between the near player's plate and the bottom bar, in frame pixels.
 *
 * Without it the stack is solved to exactly touch, and "exactly touching a bar"
 * is a plate that reads as clipped the moment the vertex snap moves an edge.
 */
const BAND_MARGIN = 12;

/**
 * The plate's drawn size at a given frame scale.
 *
 * ── the height has a floor and the width does not ─────────────────────────
 * 44 scaled by a 421-wide frame is 29, and the label inside it is what has to
 * survive: `SIZE.turnPlate.h * 0.5` is the point below which the pill's own
 * inset and the type stop both fitting. The name is the only information on this
 * screen, so it may shrink and may not disappear.
 */
function plateBox(k) {
  return {
    width: Math.round(PLATE.width * k),
    height: Math.max(Math.round(SIZE.turnPlate.h * 0.5), Math.round(PLATE.height * k)),
  };
}

/**
 * From a cap's centre to its plate's centre, at a given frame scale.
 *
 * Solved from the DRAWN box rather than from an authored number times `k`,
 * because the box has a floor: below about half scale the plate stops shrinking
 * while the cap carries on, so a drop scaled from the authored size would let
 * the cap's hem sit over its own name.
 */
function plateDrop(k) {
  return (CAP_WIDTH * k) / 2 + PLATE_GAP * k + plateBox(k).height / 2;
}

const easeOut = (t) => 1 - (1 - t) * (1 - t) * (1 - t);
const easeIn = (t) => t * t;
const clamp01 = (t) => Math.min(1, Math.max(0, t));

export class IntroLayer {
  /**
   * @param {object} opts
   * @param {import('../core/GlossMaterial.js').GlossMaterials} opts.retro
   * @param {object} opts.config
   * @param {(player: number) => import('three').Texture} opts.panelFor
   *   The same mark textures the board uses, so the cap shown here is the cap
   *   that is about to be on the table — including an opponent's mark that
   *   arrived over the wire.
   */
  constructor({ retro, config, panelFor }) {
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

    this.ui = new HudMaterials();
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
      materials[CAP_GROUP.BODY] = this._sortable(retro.create({ color: PLAYER_COLORS[player], preset: 'wetMetal' }));
      // White, because the mark bake already contains the cap's paint — the
      // paired contract `markTextures` states. Tinting it again would double it.
      materials[CAP_GROUP.PANEL] = this._sortable(
        retro.create({ map: this.panelFor?.(player) ?? null, color: PALETTE.untinted, preset: 'wetMetal' }),
      );
      materials[CAP_GROUP.LINER] = this._sortable(
        retro.create({ color: PALETTE.metal.liner, preset: 'plastic' }),
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
   * Has the sequence reached its last segment?
   *
   * `main.js` reads this to start the bars retreating, so the letterbox opens on
   * the same window the caps slide to their corners rather than after it. A
   * getter off the layer's own clock and not a timer of its own: two clocks for
   * one movement is how the two end up a frame apart on a slow machine.
   */
  get exiting() {
    if (!this.active) return this.done;
    const t = this._timing;
    return this.t >= t.self + t.opponent + t.hold;
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
   * ── it is NOT a player control ───────────────────────────────────────────
   * Nothing is bound to a press. That has been decided three times and landed
   * in the same place twice, so it is worth writing down: the sequence runs once
   * at the top of a match and is under three seconds, and online it is the
   * window in which neither player's clock has started — `main.js` sends `ready`
   * after it resolves — so skipping buys nobody any of their own time and leaves
   * them on a still frame instead of a moving one.
   *
   * The one caller is `main.js`'s stall guard: a frame clock that has stopped,
   * which a backgrounded tab really does cause, would otherwise leave a player
   * waiting forever on an animation that is not advancing.
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

  /**
   * How much of the authored STANDOFF survives the band.
   *
   * ── the drop is not part of what shrinks, and that was the bug ───────────
   * It was: standoff and drop scaled together, "so the arrangement keeps its
   * proportions on a short frame". It does not keep them — the cap's RADIUS is
   * not in that proportion, so shrinking the drop walks the plate up into the
   * cap it is supposed to hang below. It survived only because the old plate was
   * 26 tall and the drop had a pixel to give.
   *
   * The drop is a clearance and clearances do not scale away. What gives is the
   * standoff, which is the one number here that is genuinely a taste: how far
   * from the middle the two seats sit.
   *
   * Both ends are solved at once, because the two seats are mirrored — the near
   * player's PLATE is the lowest thing on screen and the far player's CAP is the
   * highest, so capping the standoff by whichever is tighter satisfies both.
   */
  _fit(k) {
    const bandHalf = Math.max(1, FRAME.height / 2 - letterboxBar());
    const room = bandHalf - BAND_MARGIN * k;
    const byPlate = room - plateDrop(k) - plateBox(k).height / 2;
    const byCap = room - (CAP_WIDTH * k) / 2;
    const want = Math.abs(SPOTS.self.at.y) * k;
    return Math.min(1, Math.max(0, Math.min(byPlate, byCap)) / Math.max(1, want));
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
      const k = frameScale();
      const fit = this._fit(k);
      const x = lerp(lerp(spot.from.x, spot.at.x, a), spot.to.x, b) * k;
      // The band fit applies to the STANDOFF only. `from` and `to` are both off
      // the frame — the entrance comes in from outside it and the exit leaves
      // through it — so pulling those in would shorten a movement whose whole
      // job is to start and end where the eye cannot follow it.
      const y = lerp(lerp(spot.from.y * k, spot.at.y * k * fit, a), spot.to.y * k, b);
      seat.pivot.scale.setScalar(this._capScale * k);

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

      // The plate hangs a fixed clearance under its cap — see `plateDrop`. The
      // band fit is NOT applied to it: it is what keeps the plate off the cap.
      this._syncPlate(player, x, y - plateDrop(k), shown);

    }
  }

  _syncPlate(player, x, y, shown) {
    const seat = this.seats[player];
    const name = this._names?.[player] ?? '';
    if (!name) {
      seat.plate.visible = false;
      return;
    }
    const k = frameScale();
    const box = plateBox(k);
    const key = `${name}:${box.width}x${box.height}`;
    if (this._labels[player] !== key) {
      this._labels[player] = key;
      /**
       * `width` 는 최소이고 `maxWidth` 가 상한이다.
       *
       * `turnPlateTexture` 는 자기가 말하는 것만큼 넓어지되 상한에서 멈춘다. 둘을
       * 같은 값으로 주면 이름이 그 폭에 갇혀 "PLAYER 1" 이 "PLA…" 가 된다 —
       * 실제로 그랬다. 상한은 프레임의 42% 로, 두 판이 좌우에 놓여도 겹치지 않는
       * 폭이다.
       */
      const tex = turnPlateTexture(name, PLAYER_COLORS[player], {
        ...box,
        maxWidth: Math.round(FRAME.width * 0.42),
        scale: this.config.ui?.textureScale ?? 1,
      });
      seat.plate.material.uniforms.uMap.value = tex;
      const w = tex.userData?.width ?? box.width;
      seat.plate.scale.set(w, box.height, 1);
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

  setResolution(_resolution) {
    refitFrameCamera(this.camera);
  }

  render(renderer) {
    if (!this.visible) return;
    // In front by definition rather than by being nearer. Same three lines as
    // `VictoryLayer.render` and `Cinematic.render`, for the same reason.
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

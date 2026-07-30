import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
} from 'three';
import { rotateY, shotSpread } from '../game/shot.js';

/**
 * Everything the player needs to see while the bow is drawn.
 *
 * ── the pull and the shot point opposite ways ────────────────────────────────
 * Which is the one thing about this input that has to be unambiguous on screen,
 * because it is the one thing that is counter-intuitive the first time. So both
 * ends are drawn and they are drawn differently: the PULL is a cold line running
 * back to the cursor, the SHOT is a warm line running the other way. Drawing only
 * the aim would leave the player with no feedback on the gesture they are
 * actually making; drawing only the pull would leave them guessing where the cap
 * goes.
 *
 * ── the clamp has to be visible ──────────────────────────────────────────────
 * Past `maxPullDistance` the power stops rising but the cursor keeps moving, so
 * without a mark there is nothing to tell the player their last two centimetres
 * of drag did nothing. The pull line stops dead at the clamp point and grows a
 * crossbar there. The cursor carries on; the string does not.
 *
 * ── the ring is the deadzone ─────────────────────────────────────────────────
 * Not decoration: it is the radius inside which a release fires nothing. It is
 * the only way "I let go and nothing happened" reads as a rule rather than a
 * bug, so it is drawn dim while the pull is inside it and bright once the shot
 * is armed.
 *
 * ── the error cone is not optional ───────────────────────────────────────────
 * A shot that goes somewhere other than where it was aimed, with no warning, is
 * indistinguishable from a bug. So the cone is drawn to the exact half-angle the
 * seeded draw is taken from — draw it narrower than it is and it is worse than
 * not drawing it, because now the game has lied.
 *
 * ── and under chaos it is all taken away ─────────────────────────────────────
 * The one exception to the paragraph above, and it comes from the same place.
 * `AimInput` twists the heading AT THE SOURCE, so under the chaos card every
 * line here is already drawn along the deviated direction rather than the aimed
 * one — which is what stops the picture from lying, and is also exactly what
 * hands the deviation back. Sweep the pull until the arrow points at the target
 * and the card has been undone by reading it off the screen.
 *
 * So `blind` removes everything that points ANYWHERE: the arrow, the cone, the
 * predicted path. Nothing is substituted for them, because a fake aim line is a
 * lie and a true one is the leak. What stays is everything about the GESTURE —
 * the string back to the cursor, the clamp crossbar, the deadzone ring — none of
 * which says where the cap will go, and without which a drag under chaos would
 * read as broken rather than as blind.
 */

/** Warm: where the cap is going. */
const AIM_COLOR = '#ffd36b';
/** Cold: where the hand is. */
const PULL_COLOR = '#7fa8e8';

/**
 * The 강타 pair. Hotter than both, and it replaces both.
 *
 * The card lasts until the shot, which means a player can arm it, look at the
 * board, think, and start a drag having forgotten. The widened cone says so, but
 * only once the pull is long enough for the cone to have opened — and the string
 * is on screen from the first pixel of the drag. So the aim's own colour carries
 * it too: the moment a boosted drag begins it is a different colour from an
 * ordinary one, at any power.
 */
const SMASH_AIM_COLOR = '#ff7a3c';
const SMASH_PULL_COLOR = '#e8724a';
const SMASH_CONE_COLOR = '#ff5a2a';
const PULL_CLAMP_COLOR = '#e0553f';
const CONE_COLOR = '#c8863c';
const PATH_COLOR = '#7ef0c8';
const RING_ARMED_COLOR = '#ffd36b';
const RING_IDLE_COLOR = '#5a6373';
/** The "press here and it is a shot" ring. Drawn when nothing is being pulled. */
const HOVER_COLOR = '#8fe6c0';

/** Plenty for a 1 s preview at any sample rate the panel allows — and for the
 *  trajectory card's four. */
const MAX_PATH_POINTS = 512;
/** Dash pattern along the sampled path: this many samples lit out of that many. */
const DASH_ON = 3;
const DASH_PERIOD = 5;
/** The cycled palette. Four entries, stepped — see `_writeDashes`. */
const DASH_PALETTE = ['#7ef0c8', '#a8fff0', '#4fbfa0', '#a8fff0'];
const CONE_ARC_SEGMENTS = 24;
const RING_SEGMENTS = 28;
/** Board-plane y for the flat overlays. Above the grid, below the caps. */
const DECK = 0.06;

function lineGeometry(maxPoints) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(maxPoints * 3), 3));
  return g;
}

export class AimOverlay {
  constructor({ config }) {
    this.config = config;
    this.root = new Group();

    this.pathGeo = lineGeometry(MAX_PATH_POINTS);
    this.path = new Line(this.pathGeo, new LineBasicMaterial({ color: PATH_COLOR, fog: false }));
    this.path.frustumCulled = false;
    this.root.add(this.path);

    /**
     * The same path, broken into marching dashes. The trajectory card's line.
     *
     * A separate object rather than a mode on the first one, because the two are
     * different primitives: a `Line` is one continuous strip and a dashed path
     * is a segment list with holes in it. Only one is ever visible.
     *
     * The dashes advance by whole SAMPLES, not by a distance — each sample is a
     * fixed slice of simulated time, so the pattern flows at a constant rate
     * along the path instead of racing where the cap is fast. That is the same
     * trick as scrolling a texture's UV, done on the index instead, and it steps
     * rather than sliding because stepping is what the hardware did.
     */
    this.dashGeo = lineGeometry(MAX_PATH_POINTS * 2);
    this.dashMaterial = new LineBasicMaterial({ color: PATH_COLOR, fog: false });
    this.dash = new LineSegments(this.dashGeo, this.dashMaterial);
    this.dash.frustumCulled = false;
    this.dash.visible = false;
    this.root.add(this.dash);

    // Apex -> edge, the arc across the far end, edge -> apex: one closed outline
    // as a segment list, because a LineLoop cannot do the two straight flanks and
    // the arc without doubling back.
    this.coneGeo = lineGeometry((CONE_ARC_SEGMENTS + 4) * 2);
    this.coneMaterial = new LineBasicMaterial({ color: CONE_COLOR, fog: false });
    this.cone = new LineSegments(this.coneGeo, this.coneMaterial);
    this.cone.frustumCulled = false;
    this.root.add(this.cone);

    this.aimGeo = lineGeometry(8);
    this.aimMaterial = new LineBasicMaterial({ color: AIM_COLOR, fog: false });
    this.aim = new LineSegments(this.aimGeo, this.aimMaterial);
    this.aim.frustumCulled = false;
    this.root.add(this.aim);

    this.pullGeo = lineGeometry(12);
    this.pullMaterial = new LineBasicMaterial({ color: PULL_COLOR, fog: false });
    this.pull = new LineSegments(this.pullGeo, this.pullMaterial);
    this.pull.frustumCulled = false;
    this.root.add(this.pull);

    // No strike-height marker. It existed to show an axis the player could move;
    // the height is fixed now, so it would be a tick that is always in the same
    // place relative to the cap.
    this.ringGeo = lineGeometry(RING_SEGMENTS);
    this.ringMaterial = new LineBasicMaterial({ color: RING_IDLE_COLOR, fog: false });
    this.ring = new LineLoop(this.ringGeo, this.ringMaterial);
    this.ring.frustumCulled = false;
    this.root.add(this.ring);

    /**
     * The hover ring, and it is not decoration.
     *
     * A press on the board means one of two things — draw a shot, or move the
     * camera — and the player has to know which before committing. A cursor
     * change says it on a desktop and says nothing at all on a touch screen, so
     * the cap that would be grabbed is ringed on the board itself. Drawn only
     * when no pull is in progress, because during a pull the deadzone ring is
     * already there and two rings on one cap is noise.
     */
    this.hoverGeo = lineGeometry(RING_SEGMENTS);
    this.hoverMaterial = new LineBasicMaterial({ color: HOVER_COLOR, fog: false });
    this.hover = new LineLoop(this.hoverGeo, this.hoverMaterial);
    this.hover.frustumCulled = false;
    this.hover.visible = false;
    this.root.add(this.hover);

    this.setVisible(false);
  }

  /**
   * Show or hide everything that belongs to a draw in progress.
   *
   * Walks the children rather than naming them. It used to be a hand-written
   * list of five, and the sixth — the trajectory card's dashed line — was added
   * to the scene and not to the list, so releasing the aim hid every other part
   * and left the dashes on the pitch. A ghost of the last shot, drawn over the
   * next one.
   *
   * The hover ring is the one exception and it is an exception by rule, not by
   * omission: it says which cap a press would grab, which is a question about
   * the board rather than about a draw, and `setHover` owns it outright.
   */
  setVisible(on) {
    for (const child of this.root.children) {
      if (child === this.hover) continue;
      child.visible = on;
    }
  }

  /**
   * Ring the cap a press would grab, or hide it.
   * @param {{x: number, z: number}|null} com  centre of mass, or null
   * @param {number} radius  the cap's pick radius, in world units
   */
  setHover(com, radius) {
    if (!com) {
      this.hover.visible = false;
      return;
    }
    const attr = this.hoverGeo.getAttribute('position');
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      attr.array[i * 3] = com.x + Math.cos(a) * radius;
      attr.array[i * 3 + 1] = DECK;
      attr.array[i * 3 + 2] = com.z + Math.sin(a) * radius;
    }
    attr.needsUpdate = true;
    this.hoverGeo.setDrawRange(0, RING_SEGMENTS);
    this.hover.visible = true;
  }

  /**
   * @param {object} s
   * @param {{x:number,y:number,z:number}} s.com   pulled cap's centre of mass
   * @param {number} s.dirX   travel direction (opposite the pull)
   * @param {number} s.dirZ
   * @param {number} s.power  0..1
   * @param {number} s.pullX  raw pull vector, unclamped
   * @param {number} s.pullZ
   * @param {number} s.clampedDistance
   * @param {boolean} s.atClamp
   * @param {boolean} s.armed
   * @param {number[]} s.path  flat xyz from the preview, may be short or empty
   * @param {number} s.reach   length of the last completed preview
   * @param {{radius:number}} s.geom
   * @param {boolean} [s.blind]  chaos: draw the gesture, never the outcome
   * @param {boolean} [s.smash]  강타: say so in the colour of the whole aim
   * @param {number} [s.spreadMul]  강타: how much wider the cone is
   */
  update(s) {
    this.setVisible(true);

    const blind = !!s.blind;
    const dashed = !blind && !!s.dashed;
    const smash = !!s.smash;

    // The whole aim recoloured, not a badge added to it. Every line of this
    // gesture belongs to the same shot, so they change together or the picture
    // says two different things about one drag.
    this.aimMaterial.color.set(smash ? SMASH_AIM_COLOR : AIM_COLOR);
    this.coneMaterial.color.set(smash ? SMASH_CONE_COLOR : CONE_COLOR);

    // Both buffers are emptied when blind rather than just hidden. A geometry
    // left holding the last frame's points is a ghost waiting for something to
    // turn it visible again — which is exactly how the trajectory card's dashes
    // once survived onto the following shot.
    if (blind) {
      this._writePath(null);
      this._writeDashes(null, 0);
    } else if (dashed) this._writeDashes(s.path, s.dashPhase ?? 0);
    else this._writePath(s.path);
    this.path.visible = !blind && !dashed;
    this.dash.visible = dashed;

    // The gesture, which is drawn under chaos exactly as it is drawn without it.
    this._writeRing(s.com, s.armed);
    this._writePull(s.com, s.pullX, s.pullZ, s.clampedDistance, s.atClamp, smash);

    // The cone and the aim line reach as far as the shot does. A fixed length
    // would say the same thing about a nudge as about a full draw, when the whole
    // point is that the full draw's error is enormous and the nudge's is nothing.
    const reach = Math.max(s.geom.radius * 2.5, s.reach || 0);
    // The trajectory card takes the cone away, and that is not a decoration.
    // The cone says "it will go somewhere in here"; the card's whole claim is
    // that it will go exactly THERE, and the line already draws the exact shot.
    // Leaving both up would be the card promising precision next to a drawing of
    // the imprecision it just removed.
    //
    // Chaos takes it away for the opposite reason: the cone is symmetric about
    // the heading, so its bisector IS the deviated aim, drawn slightly less
    // legibly. Hiding the arrow and keeping the cone would leak the same number.
    if (blind || s.hideCone) this.coneGeo.setDrawRange(0, 0);
    else this._writeCone(s.com, s.dirX, s.dirZ, s.power, reach, s.spreadMul ?? 1);

    if (blind) this.aimGeo.setDrawRange(0, 0);
    else this._writeAim(s.com, s.dirX, s.dirZ, reach);
  }

  _writePath(points) {
    const attr = this.pathGeo.getAttribute('position');
    if (!points || points.length < 6) {
      this.pathGeo.setDrawRange(0, 0);
      return;
    }
    const n = Math.min(MAX_PATH_POINTS, points.length / 3);
    attr.array.set(points.slice(0, n * 3));
    attr.needsUpdate = true;
    this.pathGeo.setDrawRange(0, n);
  }

  /**
   * The path as marching dashes, with the colour rotating behind them.
   *
   * Three lit samples in five, offset by `phase`. Both halves of the motion are
   * whole numbers — which sample the dash starts on, and which entry of a
   * four-colour palette it is drawn in — so nothing here interpolates and the
   * line reads as an index being cycled rather than as an animation being
   * tweened.
   */
  _writeDashes(points, phase) {
    const attr = this.dashGeo.getAttribute('position');
    if (!points || points.length < 6) {
      this.dashGeo.setDrawRange(0, 0);
      return;
    }
    const n = Math.min(MAX_PATH_POINTS, points.length / 3);
    // Floored to a whole sample, and brought positive before the modulo: the
    // phase runs backwards so the dashes march AWAY from the cap, and JS's `%`
    // keeps the sign of its left operand, which would make every test fail on
    // the half of the cycle where it is negative.
    const p = ((Math.floor(phase) % DASH_PERIOD) + DASH_PERIOD) % DASH_PERIOD;
    let w = 0;
    for (let i = 0; i + 1 < n; i++) {
      if (((i + p) % DASH_PERIOD) >= DASH_ON) continue;
      if (w + 6 > attr.array.length) break;
      attr.array[w++] = points[i * 3];
      attr.array[w++] = points[i * 3 + 1];
      attr.array[w++] = points[i * 3 + 2];
      attr.array[w++] = points[(i + 1) * 3];
      attr.array[w++] = points[(i + 1) * 3 + 1];
      attr.array[w++] = points[(i + 1) * 3 + 2];
    }
    attr.needsUpdate = true;
    this.dashGeo.setDrawRange(0, w / 3);
    this.dashMaterial.color.set(DASH_PALETTE[p % DASH_PALETTE.length]);
  }

  _writeRing(com, armed) {
    // The deadzone, to scale. Release inside this and nothing fires.
    const r = Math.max(this.config.shot.deadzone, 0.05);
    const attr = this.ringGeo.getAttribute('position');
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2;
      attr.array[i * 3] = com.x + Math.cos(a) * r;
      attr.array[i * 3 + 1] = DECK;
      attr.array[i * 3 + 2] = com.z + Math.sin(a) * r;
    }
    attr.needsUpdate = true;
    this.ringGeo.setDrawRange(0, RING_SEGMENTS);
    this.ringMaterial.color.set(armed ? RING_ARMED_COLOR : RING_IDLE_COLOR);
  }

  _writePull(com, px, pz, clamped, atClamp, smash = false) {
    const attr = this.pullGeo.getAttribute('position');
    const a = attr.array;
    const len = Math.hypot(px, pz);
    if (len < 1e-4) {
      this.pullGeo.setDrawRange(0, 0);
      return;
    }
    const ux = px / len;
    const uz = pz / len;
    const ex = com.x + ux * clamped;
    const ez = com.z + uz * clamped;

    // The string.
    a[0] = com.x;
    a[1] = DECK;
    a[2] = com.z;
    a[3] = ex;
    a[4] = DECK;
    a[5] = ez;

    // A crossbar at the far end. It marks the clamp, so it is only worth drawing
    // once the clamp is doing something.
    let count = 2;
    if (atClamp) {
      const k = this.config.shot.deadzone * 0.8;
      a[6] = ex - uz * k;
      a[7] = DECK;
      a[8] = ez + ux * k;
      a[9] = ex + uz * k;
      a[10] = DECK;
      a[11] = ez - ux * k;
      count = 4;
    }
    attr.needsUpdate = true;
    this.pullGeo.setDrawRange(0, count);
    // The clamp still wins: "you have stopped gaining power" is a fact about
    // this instant of the drag, and 강타 is a fact about the whole of it.
    this.pullMaterial.color.set(
      atClamp ? PULL_CLAMP_COLOR : smash ? SMASH_PULL_COLOR : PULL_COLOR,
    );
  }

  _writeCone(com, dx, dz, power, reach, spreadMul = 1) {
    // Through `shotSpread`, not `spreadRadians`, so the drawn cone is the same
    // half-angle the seeded draw is taken from — boost included. See shot.js.
    const half = shotSpread({ power, spreadMul }, this.config.shot);
    const attr = this.coneGeo.getAttribute('position');
    const a = attr.array;
    let w = 0;

    const push = (x, z) => {
      a[w++] = x;
      a[w++] = DECK;
      a[w++] = z;
    };

    if (half <= 1e-5) {
      this.coneGeo.setDrawRange(0, 0);
      return;
    }

    const edge = (sign) => {
      const d = rotateY(dx, dz, sign * half);
      return { x: com.x + d.x * reach, z: com.z + d.z * reach };
    };

    const e0 = edge(-1);
    const e1 = edge(1);

    push(com.x, com.z);
    push(e0.x, e0.z);
    push(com.x, com.z);
    push(e1.x, e1.z);

    // The far arc. Drawn on the arc rather than as a chord because a chord makes
    // the reachable set look like a triangle, and the corners of that triangle
    // are places the shot cannot actually reach.
    let prev = e0;
    for (let i = 1; i <= CONE_ARC_SEGMENTS; i++) {
      const t = -half + (i / CONE_ARC_SEGMENTS) * half * 2;
      const d = rotateY(dx, dz, t);
      const p = { x: com.x + d.x * reach, z: com.z + d.z * reach };
      push(prev.x, prev.z);
      push(p.x, p.z);
      prev = p;
    }

    attr.needsUpdate = true;
    this.coneGeo.setDrawRange(0, w / 3);
  }

  _writeAim(com, dx, dz, reach) {
    const attr = this.aimGeo.getAttribute('position');
    const a = attr.array;
    const tipX = com.x + dx * reach;
    const tipZ = com.z + dz * reach;

    a[0] = com.x;
    a[1] = DECK;
    a[2] = com.z;
    a[3] = tipX;
    a[4] = DECK;
    a[5] = tipZ;

    // An arrowhead, so the warm line reads as a direction rather than as a second
    // string. BOTH barbs — one alone just looks like the line frayed.
    const back = reach * 0.06;
    const side = back * 0.55;
    a[6] = tipX;
    a[7] = DECK;
    a[8] = tipZ;
    a[9] = tipX - dx * back - dz * side;
    a[10] = DECK;
    a[11] = tipZ - dz * back + dx * side;

    a[12] = tipX;
    a[13] = DECK;
    a[14] = tipZ;
    a[15] = tipX - dx * back + dz * side;
    a[16] = DECK;
    a[17] = tipZ - dz * back - dx * side;

    attr.needsUpdate = true;
    this.aimGeo.setDrawRange(0, 6);
  }

}

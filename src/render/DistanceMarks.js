import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import { PALETTE } from '../core/palette.js';


/**
 * The measurements the rules made, drawn on the field.
 *
 * ── it exists because the eye cannot do this ────────────────────────────────
 * "거리 표시: … 이게 없으면 누가 더 가까운지 눈으로 판단이 안 된다. 필수다." And
 * that is literally true rather than a convenience: at the widest zoom the
 * curling table is about 300 framebuffer pixels long, so a cap-and-a-half of
 * difference between two caps at the far end is three or four pixels before the
 * dither has been at it. The judge already computed the answer to a hundredth of
 * a unit; this draws that answer instead of asking the player to guess it.
 *
 * ── it draws a LIST, and knows nothing about what was measured ──────────────
 * Every mark carries both of its endpoints — see `RuleSet.distanceMarks` — so
 * there is no target line in this file, no house, no mode name and no import
 * from `game/`. Hand it an empty list and it disappears. That is what lets it
 * sit in the world scene unconditionally, next to the orb view, which is also
 * built for every mode and populated by one.
 *
 * ── there is no NUMBER on the mark, and that was tried both ways ───────────
 * A written distance was built twice and kept neither time. In the world, as
 * vector glyphs, it could not survive this scene's dither: thin strokes are one
 * pixel and are dropped, strokes thick enough to survive close up their own
 * counters, and the gap inside a digit is the same few pixels as the stroke
 * making it — so there is no width in between that works, at any size the table
 * has room for. As real type in the HUD, pinned over the mark, it read
 * perfectly and was the wrong thing anyway: a hard number beside two caps turns
 * a judgement you make by eye into one you make by arithmetic, and the marks
 * already answer the only question being asked between the two throws, which is
 * which of them is closer.
 *
 * So the mark is the reading. It is drawn to the hundredth because the judge
 * measured it to the hundredth, and the length of the line IS the number.
 *
 * ── there is no winning mark any more ───────────────────────────────────────
 * A `best` flag used to thicken one mark: it was drawn three times, offset
 * sideways, because `LineBasicMaterial.linewidth` is ignored by every WebGL
 * renderer and weight has to be geometry. It is gone with the round-end marks
 * that were the only thing that ever set it — see `CurlingRules.resolveTurn`.
 * These are drawn in one situation only, between a round's two throws, and at
 * that moment nothing has won.
 *
 * ── the ring is the cap ─────────────────────────────────────────────────────
 * Every mark carries a ring at its origin, the size of a cap. It reads as "this
 * cap, from here", which is what stops the number floating unattached to
 * anything, and it survives the cap being knocked out of the way by the throw
 * that is being aimed while these are on screen.
 *
 * ── rebuilt on CHANGE, not per frame ────────────────────────────────────────
 * The marks move when a turn settles and at no other time, so the buffer is
 * rebuilt off a key rather than every frame. Two allocations per turn against
 * two per frame, and — more to the point — a buffer rewritten every frame would
 * be rewritten during the flight as well, when the list is deliberately empty.
 */

/** Segments in the ring drawn where the cap was. Enough to read as a circle. */
const RING_SEGMENTS = 14;
const MARK_INKS = PALETTE.playerInk;
/** Board-plane height. Above the markings, below the caps. */
const Y = 0.06;
/** Fallback cap radius, for a caller that does not know one. */
const DEFAULT_RADIUS = 1.6;

export class DistanceMarks {
  constructor() {
    /**
     * A group holding the one `LineSegments`, rather than being it.
     *
     * It was the LineSegments, and the wrapper stayed after the digit meshes
     * that needed it were moved to the HUD: `root` is what `main.js` adds to
     * the scene and what everything toggles, so making that a stable container
     * means the drawing inside it can change shape without the caller caring.
     */
    this.root = new Group();
    this.root.visible = false;

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute([], 3));
    this.geometry.setAttribute('color', new Float32BufferAttribute([], 3));
    this.material = new LineBasicMaterial({ vertexColors: true, fog: false });
    this.lines = new LineSegments(this.geometry, this.material);

    // The marks are flat on the board and the caps stand on it, so without this
    // a mark passing under a cap z-fights with the board it is drawn a
    // sixteenth of a unit above. Not `depthTest: false`: a mark that drew
    // through the cap it belongs to would look like it went past it.
    this.lines.renderOrder = 4;
    this.lines.frustumCulled = false;
    this.root.add(this.lines);

    this._key = '';
    this._c = new Color();
  }

  /**
   * @param {{x: number, z: number, toX: number, toZ: number, player: number,
   *          distance: number}[]} marks
   * @param {number} [capRadius]
   *   How big to draw the ring at each mark's origin. Handed in rather than
   *   assumed, because the ring is standing in for the cap and has to be the
   *   cap's size to do it — see the note on the ring below.
   */
  update(marks, capRadius = DEFAULT_RADIUS) {
    const list = marks ?? [];
    const radius = Math.max(0.2, capRadius);
    // Rounded into the key, not raw: the positions come out of the solver and
    // the last bits of a resting body still twitch, which would rebuild the
    // buffer every frame for a picture nobody could tell apart.
    const key = list
      .map(
        (m) =>
          `${m.player}:${m.x.toFixed(2)}:${m.z.toFixed(2)}:` +
          `${m.toX.toFixed(2)}:${m.toZ.toFixed(2)}`,
      )
      .join('|');
    if (key === this._key) return;
    this._key = key;

    if (!list.length) {
      this.root.visible = false;
      return;
    }

    const pos = [];
    const col = [];

    for (const m of list) {
      this._c.set(MARK_INKS[m.player] ?? PALETTE.neutral);
      const r = this._c.r;
      const g = this._c.g;
      const b = this._c.b;

      const push = (x0, z0, x1, z1) => {
        pos.push(x0, Y, z0, x1, Y, z1);
        col.push(r, g, b, r, g, b);
      };

      // The measurement itself.
      push(m.x, m.z, m.toX, m.toZ);

      /**
       * A ring the size of a cap, where the cap was.
       *
       * It is standing in for the cap rather than decorating it, and that is why
       * it is the cap's own radius. These are on screen while the second player
       * of the round is aiming at exactly the cap being ringed, so the ring is
       * what keeps the measurement attached to something once that throw has
       * moved the cap out from under it.
       */
      let ax = m.x + radius;
      let az = m.z;
      for (let i = 1; i <= RING_SEGMENTS; i++) {
        const a = (i / RING_SEGMENTS) * Math.PI * 2;
        const bx = m.x + Math.cos(a) * radius;
        const bz = m.z + Math.sin(a) * radius;
        push(ax, az, bx, bz);
        ax = bx;
        az = bz;
      }
    }

    this.geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.geometry.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.geometry.computeBoundingSphere();
    this.root.visible = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

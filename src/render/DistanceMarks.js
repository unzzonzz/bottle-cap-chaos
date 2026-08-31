import { BufferGeometry, Color, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import { PLAYER_COLORS } from './playerColors.js';
import { PALETTE } from '../core/palette.js';

/** The darker cut of each player's colour, for the mark that won. */
const PLAYER_INKS = PALETTE.playerInk;

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
 * ── the winner is drawn THICKER, because line width is not a thing ──────────
 * `LineBasicMaterial.linewidth` is ignored by every WebGL renderer, so a
 * one-pixel line is the only kind there is. The emphasis is therefore geometry:
 * the winning mark is drawn three times, offset sideways by a fraction of a cap,
 * which is a band rather than a line and survives both the low resolution and
 * the dither. Its ring is doubled for the same reason.
 *
 * ── the ring is the cap ─────────────────────────────────────────────────────
 * Every mark carries a ring at its origin, the size of a cap. That is not
 * decoration: curling sweeps its table the instant a round is judged, so the
 * caps are gone on the very frame the result exists, and without the rings the
 * outcome would be two lines reaching out of nothing. With them the round's
 * result stays legible for the whole of the next aim — which is also why this
 * mode needs no pause on the result. The caps came off, and the picture of what
 * they did did not.
 *
 * ── rebuilt on CHANGE, not per frame ────────────────────────────────────────
 * The marks move when a turn settles and at no other time, so the buffer is
 * rebuilt off a key rather than every frame. Two allocations per turn against
 * two per frame, and — more to the point — a buffer rewritten every frame would
 * be rewritten during the flight as well, when the list is deliberately empty.
 */

/** How far the emphasis band's outriggers sit either side, in world units. */
const BAND_OFFSET = 0.28;
/** Segments in the ring drawn where the cap was. Enough to read as a circle. */
const RING_SEGMENTS = 14;
/**
 * How far a losing mark is washed toward the table it is drawn on.
 *
 * ── the emphasis used to run the other way, and it had to be turned around ──
 * The winning mark was lifted halfway to white and the losing one multiplied
 * down to 82% brightness. Both of those are "brighter is louder", which was
 * right when the table was near-black and is exactly backwards on a cream one:
 * a mark lifted toward white DISAPPEARS into a light table, and a losing mark
 * multiplied darker becomes the more visible of the pair. On a curling table
 * that is not a cosmetic error — the whole mode is judged off these two lines.
 *
 * So the winner is now drawn in `PALETTE.playerInk` and the loser in
 * `PALETTE.player` washed toward the table. That keeps HUE as the answer to
 * "whose mark is this" — which lifting toward white and darkening toward navy
 * both destroy, and destroy asymmetrically, since 2P is already a blue — and
 * leaves VALUE to answer "which one won".
 */
const PLAIN_WASH = 0.32;
/** Board-plane height. Above the markings, below the caps. */
const Y = 0.06;
/** Fallback cap radius, for a caller that does not know one. */
const DEFAULT_RADIUS = 1.6;

export class DistanceMarks {
  constructor() {
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new Float32BufferAttribute([], 3));
    this.geometry.setAttribute('color', new Float32BufferAttribute([], 3));

    this.material = new LineBasicMaterial({ vertexColors: true, fog: false });
    this.root = new LineSegments(this.geometry, this.material);
    // The marks are flat on the board and the caps stand on it, so without this
    // a mark passing under a cap z-fights with the board it is drawn a
    // sixteenth of a unit above. Not `depthTest: false`: a mark that drew
    // through the cap it belongs to would look like it went past it.
    this.root.renderOrder = 4;
    this.root.frustumCulled = false;
    this.root.visible = false;

    this._key = '';
    this._c = new Color();
  }

  /**
   * @param {{x: number, z: number, toX: number, toZ: number, player: number,
   *          distance: number, best?: boolean}[]} marks
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
          `${m.player}:${m.best ? 1 : 0}:${m.x.toFixed(2)}:${m.z.toFixed(2)}:` +
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
      const base = m.best ? PLAYER_INKS[m.player] : PLAYER_COLORS[m.player];
      this._c.set(base ?? PALETTE.neutral);
      if (!m.best) this._c.lerp(WASH, PLAIN_WASH);
      const r = this._c.r;
      const g = this._c.g;
      const b = this._c.b;

      const push = (x0, z0, x1, z1) => {
        pos.push(x0, Y, z0, x1, Y, z1);
        col.push(r, g, b, r, g, b);
      };

      // The measurement itself, and its two outriggers when this is the one that
      // won. Offset across the mark rather than along it, so the band stays a
      // band whichever way the measurement happens to run.
      const dx = m.toX - m.x;
      const dz = m.toZ - m.z;
      const len = Math.hypot(dx, dz) || 1;
      const px = -dz / len;
      const pz = dx / len;

      const offsets = m.best ? [-BAND_OFFSET, 0, BAND_OFFSET] : [0];
      for (const o of offsets) {
        push(m.x + px * o, m.z + pz * o, m.toX + px * o, m.toZ + pz * o);
      }

      /**
       * A ring the size of a cap, where the cap was.
       *
       * It is standing in for the cap rather than decorating it, and that is why
       * it is the cap's own radius. Curling sweeps the table the instant a round
       * is judged — the caps are gone on the very frame the result exists — so
       * without this the round's outcome is two lines reaching out of empty
       * space. With it, the result reads as what it is: here is where each cap
       * finished, and here is how far each one was.
       *
       * The winner gets a second ring outside the first, which is the same
       * emphasis device as the band on its line and for the same reason: line
       * width is not a thing a WebGL renderer will honour, so weight has to be
       * geometry.
       */
      for (const r of m.best ? [radius, radius + BAND_OFFSET * 1.6] : [radius]) {
        let ax = m.x + r;
        let az = m.z;
        for (let i = 1; i <= RING_SEGMENTS; i++) {
          const a = (i / RING_SEGMENTS) * Math.PI * 2;
          const bx = m.x + Math.cos(a) * r;
          const bz = m.z + Math.sin(a) * r;
          push(ax, az, bx, bz);
          ax = bx;
          az = bz;
        }
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

/** What a losing mark is washed toward: the curling table it is drawn on. */
const WASH = new Color(PALETTE.curling.table);

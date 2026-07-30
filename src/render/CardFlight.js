import { Mesh, PlaneGeometry } from 'three';
import { CARD_BY_ID } from '../game/cards/cardCatalog.js';
import { cardBackTexture } from './cardTexture.js';
import { CARD_ASPECT } from './CardHand.js';

/**
 * A found card, flying from the field into the hand.
 *
 * ── it lives in the CARD scene, in frame coordinates ───────────────────────
 * The same orthographic overlay the hand is laid out in, so the flight ends in
 * exactly the coordinate system the fan is drawn in and the two cannot disagree
 * about where "the hand" is. The start point is the orb's WORLD position pushed
 * through the game camera and into that same frame — which is the whole reason
 * the card appears to leave the board rather than to appear from an edge.
 *
 * ── it runs on the render clock and holds nothing up ───────────────────────
 * The pickup already happened: the card is in `CardHands` from the moment the
 * cap touched the orb, inside a physics step. This is only the picture catching
 * up, so the simulation never waits for it — requirement 5. Cancel it, drop a
 * frame, alt-tab through it, and the game state is unaffected.
 *
 * ── it flies FACE DOWN ─────────────────────────────────────────────────────
 * The card is drawn with its back for the whole flight, so the pickup tells you
 * that you got something and nothing about what. Finding out is the payoff, and
 * a face-up card crossing the screen spends it a third of a second early — by
 * the time it lands you have already read it and the fan opening is an
 * anticlimax.
 *
 * It costs nothing to do: the back is the same texture the opponent's hand is
 * already drawn with, and the reveal happens for free when the flight ends and
 * the fan opens for the card face-up.
 *
 * ── the fan does not open until the card lands ─────────────────────────────
 * The card is held OUT of the fan for the length of the flight, by key. Without
 * that the hand would gain its new card instantly and then a second copy would
 * fly in and land on top of it. `pendingKeys` is what `CardLayer.syncTo` skips,
 * and the moment a flight ends the key is released and the fan opens for it —
 * which is what makes the arrival read as the card slotting in.
 */

const QUAD = new PlaneGeometry(1, 1);

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class CardFlight {
  /**
   * @param {import('./CardMaterial.js').CardMaterials} materials
   * @param {{width: number, height: number}} frame
   */
  constructor({ materials, config, frame }) {
    this.materials = materials;
    this.config = config;
    this.frame = frame;
    /** @type {{key: number, mesh: object, mat: object, from: object, to: object, t: number, spin: number, lift: number}[]} */
    this.flights = [];
    /** Keys the fan must not show yet. Read by `CardLayer.syncTo`. */
    this.pendingKeys = new Set();
  }

  /**
   * @param {object} root   the card scene's root to add to
   * @param {number} key    the hand instance this flight delivers
   * @param {string} cardId
   * @param {{x: number, y: number}} from  frame coordinates
   * @param {{x: number, y: number}} to    frame coordinates
   */
  launch(root, key, cardId, from, to) {
    // The id is still validated — an unknown card should not produce a flight —
    // but it is deliberately not used to pick the artwork. See the header.
    if (!CARD_BY_ID.has(cardId) || key === null || key === undefined) return;

    const mat = this.materials.create(cardBackTexture(this.config.cards.textureWidth));
    const mesh = new Mesh(QUAD, mat);
    mesh.renderOrder = 800;
    root.add(mesh);

    this.pendingKeys.add(key);
    this.flights.push({
      key,
      mesh,
      mat,
      from: { ...from },
      to: { ...to },
      t: 0,
      // A fixed quarter turn plus a bit, rather than a random spin: the card is
      // arriving somewhere specific and should look placed, not thrown.
      spin: Math.PI * 1.5,
      // How far the arc bows away from the straight line. Signed off the
      // travel direction so it always bows upward on screen.
      lift: Math.max(60, Math.abs(to.x - from.x) * 0.45),
    });
  }

  update(dt, root) {
    if (!this.flights.length) return;
    const cfg = this.config.cards;
    const life = Math.max(0.05, this.config.orbs.pickupSeconds);
    const w = cfg.width;
    const h = cfg.width * CARD_ASPECT;

    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt / life;

      if (f.t >= 1) {
        root.remove(f.mesh);
        f.mat.dispose();
        // Released HERE, so the fan opens for it on the very next sync. Any
        // later and there is a frame with the card nowhere; any earlier and
        // there are two of it.
        this.pendingKeys.delete(f.key);
        this.flights.splice(i, 1);
        continue;
      }

      const k = smoothstep(f.t);
      // Quadratic bezier through a control point lifted off the straight line.
      // A straight slide would read as a UI element being moved; the bow is
      // what makes it read as something thrown across the table.
      const cx = (f.from.x + f.to.x) / 2;
      const cy = (f.from.y + f.to.y) / 2 + f.lift;
      const inv = 1 - k;
      f.mesh.position.set(
        inv * inv * f.from.x + 2 * inv * k * cx + k * k * f.to.x,
        inv * inv * f.from.y + 2 * inv * k * cy + k * k * f.to.y,
        40,
      );

      f.mesh.rotation.z = f.spin * (1 - k);
      // Starts small — it is far away on the board — and reaches the hand at the
      // size the fan draws its cards.
      const s = 0.25 + 0.75 * k;
      f.mesh.scale.set(w * s, h * s, 1);
      // Fades in over the first fifth so it does not pop into existence on top
      // of the orb's own burst.
      f.mat.uniforms.uOpacity.value = Math.min(1, f.t * 5);
    }
  }

  dispose(root) {
    for (const f of this.flights) {
      root.remove(f.mesh);
      f.mat.dispose();
    }
    this.flights.length = 0;
    this.pendingKeys.clear();
  }
}

import { Mesh, OrthographicCamera, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import { CardMaterials } from './CardMaterial.js';
import { CardHand, CARD_ASPECT } from './CardHand.js';
import { clearCardTextureCache, noticeTexture } from './cardTexture.js';

/**
 * The card scene: its own scene, its own orthographic camera, its own raycaster.
 *
 * ── it is drawn into the SAME low-resolution target ──────────────────────────
 * This is the point of the whole conversion, so it is worth being exact about
 * why. `RetroPass` keys its dither threshold to the low-res texel grid:
 *
 *     float bayer = bayer4(floor(uv * uTargetRes));
 *
 * The pattern is therefore a property of the FRAMEBUFFER, not of any object in
 * it. Anything drawn into that framebuffer before the pass runs comes out on the
 * same 4x4 lattice as the pitch, quantised to the same 5-bit levels, upscaled by
 * the same nearest-neighbour blit — one continuous image. Post-processing the
 * cards separately, or compositing them after the pass, would put them on their
 * own lattice with its own phase, and the seam between card and pitch would be
 * the most visible thing on screen.
 *
 * So the render order is:
 *
 *     viewport.bind()                    // the 640x480 target
 *     render(game scene, game camera)
 *     clearDepth()                       // cards are not part of the world
 *     render(card scene, ortho camera)
 *     viewport.unbind()
 *     retroPass.render(...)              // one upscale covers both
 *
 * ── orthographic, and what follows from it ──────────────────────────────────
 * A perspective camera would put the cards at the edges of the hand into
 * keystone, and a card you have to read is the last thing that should be
 * distorted. Two things follow from the choice, and neither is an oversight:
 * `w` is constant across a triangle, so affine UV interpolation IS perspective-
 * correct interpolation and there is no warp to reproduce; and depth carries no
 * size information, so z is free to be used as a paint order.
 *
 * ── the frame is virtual ────────────────────────────────────────────────────
 * The camera covers a fixed 640x480 box whatever the render target is set to.
 * That keeps the hand the same fraction of the screen at every internal
 * resolution — drop the target to 320x240 and the cards get coarser along with
 * everything else instead of doubling in size.
 */

/** The layout box, in frame pixels. 4:3, matching the display. */
export const FRAME = { width: 640, height: 480 };

/** How far up a hand must be before a single card will lift out of it. */
const RAISED_ENOUGH = 0.8;

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class CardLayer {
  /**
   * @param {HTMLCanvasElement} canvas  for mapping pointer coordinates
   * @param {import('three').Vector2} resolution  the low-res target's size
   * @param {(cardId: string, player: number) => void} onCardUsed
   */
  /**
   * @param {(cardId: string, player: number) => void} onCardUsed
   * @param {(cardId: string, player: number) => {ok: boolean, reason?: string}} [usable]
   *   the game's own answer to "may this be played". Handed in rather than
   *   worked out here: the hand is a view, and a view that decided for itself
   *   what was legal would be a second rule book.
   */
  /**
   * @param {(clientX: number, clientY: number) => boolean} [reserved]
   *   whether this point belongs to the board no matter what is drawn over it.
   *   See `_reserved`.
   */
  constructor({ canvas, config, resolution, onCardUsed, onReorder, usable, reserved }) {
    this.canvas = canvas;
    this.config = config;
    this.onCardUsed = onCardUsed ?? (() => {});
    this.usable = usable ?? (() => ({ ok: true }));
    this._isReserved = reserved ?? (() => false);

    this.scene = new Scene();
    this.camera = new OrthographicCamera(
      -FRAME.width / 2,
      FRAME.width / 2,
      FRAME.height / 2,
      -FRAME.height / 2,
      -100,
      100,
    );
    this.camera.position.z = 10;

    this.materials = new CardMaterials({ resolution });

    /** @type {CardHand[]} index is the player. */
    this.hands = [0, 1].map(
      (player) => new CardHand({ materials: this.materials, config, player, frame: FRAME }),
    );
    for (const h of this.hands) {
      // Handed down rather than reached up for: the hand reports a move and the
      // GAME owns the order. See `CardHand._updateSort`.
      h.onReorder = onReorder ?? null;
      this.scene.add(h.root);
    }

    /**
     * Swap progress. 1 = player 0 holds the bottom, 0 = player 1 does.
     *
     * One scalar for both hands rather than one each, because the two are
     * always exactly complementary and two of them could drift apart.
     */
    this._swap = 1;
    this._enabled = false;
    /** Whether this mode uses cards at all. See `update`. */
    this._visible = true;
    /** Raise progress per hand, 0 tucked into the edge, 1 up and playable. */
    this._raise = [0, 0];
    /** Whether the pointer is anywhere on a hand, per hand. */
    this._onHand = [false, false];

    /** The card-only raycaster. Nothing in the game scene is ever in its list. */
    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this._quads = [];

    /** Last pointer, so hover survives a hand that moved under a still cursor. */
    this._pointer = null;
    this._dragHand = null;
    this.hovering = false;

    // The "why not" plate. One mesh, re-textured as the reason changes, because
    // there is only ever one card under the pointer.
    this.notice = new Mesh(new PlaneGeometry(1, 1), this.materials.create(noticeTexture(' ')));
    this.notice.visible = false;
    this.notice.renderOrder = 900;
    this.scene.add(this.notice);
    this._noticeText = '';
  }

  setResolution(resolution) {
    this.materials.setResolution(resolution);
  }

  /**
   * Make both fans match what the two players are holding.
   *
   * Called every frame from the loop rather than pushed on a change: the hand
   * can now change from inside a physics step — a cap touching an orb mid-turn
   * is a pickup — and there is no single moment for a "cards changed" event to
   * be raised from that the view could subscribe to. Reconciling is cheap when
   * nothing moved; see `CardHand.syncTo`.
   *
   * @param {import('../game/cards/CardHands.js').CardHands} hands
   */
  syncTo(hands, pending = null) {
    for (const h of this.hands) {
      const held = hands.get(h.player);
      // A card still flying in from the field is not in the fan yet — see
      // `CardFlight`. Filtered here rather than inside the hand so the hand
      // stays a plain mirror of the state it is given.
      h.syncTo(pending && pending.size ? held.filter((c) => !pending.has(c.key)) : held);
    }
  }

  /**
   * Re-draw every card face, for a texture-resolution change from the panel.
   *
   * The cards are left alone — only what is uploaded to them changes. Marking
   * them dirty rather than re-fetching here means the swap happens inside the
   * next `update`, before anything is drawn, so no disposed texture is ever
   * bound.
   */
  refreshTextures() {
    clearCardTextureCache();
    for (const h of this.hands) {
      for (const c of h.cards) {
        c.texWidth = -1;
        c.texFace = null;
      }
    }
  }

  get dragging() {
    return this._dragHand !== null;
  }

  /** The hand currently at the bottom of the screen. */
  get activeHand() {
    return this.hands[this._swap >= 0.5 ? 0 : 1];
  }

  // ── per frame ────────────────────────────────────────────────────────────

  /**
   * @param {number} dt              render seconds; never a physics step
   * @param {number} currentPlayer
   * @param {boolean} enabled        false while the turn plays out or the match is over
   * @param {boolean} [visible]
   *   false when the MODE does not use cards at all. Distinct from `enabled`,
   *   which is "not right now" and draws both hands greyed at the edges of the
   *   screen — the correct picture for a turn being played out and the wrong one
   *   for curling, where "손패 UI를 표시하지 마라" means there is no hand. The
   *   layer is still built, still holds both fans, still answers `hitAt` with
   *   nothing (there are no cards in either hand's quad list once the roots are
   *   off), and comes straight back on a mode switch.
   */
  update({ dt, currentPlayer, enabled, visible = true }) {
    const cfg = this.config.cards;

    this._visible = visible;
    if (!visible) {
      for (const h of this.hands) h.root.visible = false;
      this.notice.visible = false;
      // Hover state goes with it, or a pointer that was over a card when the
      // mode changed would keep reporting one that is no longer drawn — and the
      // router asks the cards before it asks the board, so that press would be
      // swallowed by a hand nobody can see.
      this.clearHover();
      this._enabled = false;
      return;
    }
    for (const h of this.hands) h.root.visible = true;
    this.materials.shared.uSnapAmount.value = cfg.vertexSnap;
    this._enabled = enabled;

    const want = currentPlayer === 0 ? 1 : 0;
    const rate = dt / Math.max(0.05, cfg.turnSwapSeconds);
    this._swap += Math.max(-rate, Math.min(rate, want - this._swap));

    // Eased at the ends so the hands leave and arrive rather than starting and
    // stopping dead. The raw value stays linear so the two hands cannot
    // desynchronise through the easing.
    const p0 = this._swap * this._swap * (3 - 2 * this._swap);
    // A hand that is mid-swap is not answering the pointer, whoever's turn it is.
    const settled = this._swap > 0.999 || this._swap < 0.001;
    const lock = enabled ? 0 : cfg.greyStrength;

    // Re-read the pointer BEFORE the hands move, so the raise and the per-card
    // hover are decided against the same frame the player is looking at.
    if (this._pointer && !this.dragging) this._updateHover();

    const raiseRate = dt / Math.max(0.05, cfg.raiseSeconds);
    for (const hand of this.hands) {
      const place = hand.player === 0 ? p0 : 1 - p0;
      const live = enabled && settled && place > 0.999;

      // Held up while the pointer is on it, while a card is being dragged out of
      // it, and while one is flying away — letting the hand drop out from under
      // a card in mid-use would be the animation pulling the rug out.
      const wanted =
        live &&
        (this._onHand[hand.player] ||
          this._dragHand === hand ||
          hand.cards.some((c) => c.flying > 0))
          ? 1
          : 0;
      const r = this._raise[hand.player];
      this._raise[hand.player] = r + Math.max(-raiseRate, Math.min(raiseRate, wanted - r));

      hand.update(dt, {
        place,
        raise: smoothstep(this._raise[hand.player]),
        live,
        lock,
        usable: (cardId) => this.usable(cardId, hand.player),
      });
    }

    this._updateNotice();
  }

  /**
   * Park the reason plate over the hovered card, or hide it.
   *
   * Above the card rather than beside it, and clamped to the frame, so the plate
   * for the leftmost card does not hang off the screen — which is where the
   * explanation is needed most, since that card is the one furthest from where
   * the player is looking.
   */
  _updateNotice() {
    const hand = this.hands.find((h) => h.hovered && h.hovered.blocked && h.raise > RAISED_ENOUGH);
    const card = hand?.hovered;
    if (!card || !card.reason) {
      this.notice.visible = false;
      return;
    }

    if (card.reason !== this._noticeText) {
      this._noticeText = card.reason;
      this.notice.material.uniforms.uMap.value = noticeTexture(card.reason);
    }
    const tex = this.notice.material.uniforms.uMap.value;
    const w = tex.userData?.width ?? 120;
    const h = tex.userData?.height ?? 20;
    this.notice.scale.set(w, h, 1);

    // The card's top edge, in frame coordinates.
    const cardH = this.config.cards.width * CARD_ASPECT * card.s.value * hand.root.scale.y;
    const top = hand.root.position.y + (card.y.value + cardH / hand.root.scale.y) * hand.root.scale.y;
    const halfW = FRAME.width / 2 - w / 2 - 4;
    this.notice.position.set(
      Math.max(-halfW, Math.min(halfW, (card.x.value + card.shakeX) * hand.root.scale.x)),
      Math.min(FRAME.height / 2 - h / 2 - 4, top + h),
      50,
    );
    this.notice.material.uniforms.uOpacity.value = 1;
    this.notice.visible = true;
  }

  // ── pointer ──────────────────────────────────────────────────────────────

  /**
   * The card under a point, topmost first, or null.
   *
   * A real raycast rather than a 2D box test, and against a set of oversized
   * quads rather than against the cards themselves — the brief asks for a hit
   * area with some give, and putting the give in the GEOMETRY means the ray
   * result is the answer instead of the start of one. The quads are invisible
   * unless the panel switches them on, and they are never in the game scene's
   * raycast: this raycaster only ever sees the list built below.
   */
  /**
   * Is this point the BOARD's, whatever is drawn over it?
   *
   * ── the one place the card-first rule gives way, and why it has to ──────────
   * The hand lives at the bottom of the screen and, in football, so do the
   * caps the player is about to shoot: it is their own half. Raised, the hand
   * reaches to y −120 and a hovered card reaches to −18 — and the four caps sit
   * at −133, −63, −44 and −63. Measured: three of the four had a card over them,
   * the shooter included. Pressing your own cap picked up a card instead, so
   * after playing one card you could not fire at all.
   *
   * A press on a cap you can actually shoot therefore goes to the cap, and the
   * hand does not even raise for it. Everywhere else — empty pitch, the ball, an
   * opponent's cap, the run-off — the card still wins, which is the whole of the
   * original rule: it exists to stop a press on a CARD leaking through to the
   * board, and this does not weaken that.
   *
   * The alternative was to make the hand smaller until it stopped overlapping,
   * which is not a fix — it is the same collision with less of it.
   */
  _reserved(clientX, clientY) {
    return this._isReserved(clientX, clientY);
  }

  hitAt(clientX, clientY) {
    // A hand that is not drawn takes no presses. Tested here rather than relying
    // on the roots being hidden, because whether an invisible mesh is skipped by
    // a raycast is a three.js implementation detail and this is the difference
    // between a shot firing and a press vanishing.
    if (this._visible === false) return null;
    if (this._reserved(clientX, clientY)) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    this._quads.length = 0;
    for (const h of this.hands) h.hitQuads(this._quads);
    if (!this._quads.length) return null;

    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    this.scene.updateMatrixWorld(true);

    // Overlapping cards are separated by a small z that follows the paint
    // order, so "nearest" and "on top" are the same card. Under a parallel
    // projection nothing else would distinguish them.
    const hits = this._ray.intersectObjects(this._quads, false);
    if (!hits.length) return null;
    for (const hand of this.hands) {
      const card = hand.cardForHit(hits[0].object);
      if (card) return { hand, card, point: hits[0].point };
    }
    return null;
  }

  /** @returns {boolean} true if a card took the press and nothing else may have it. */
  pointerDown(clientX, clientY) {
    this._pointer = { x: clientX, y: clientY };
    const hit = this.hitAt(clientX, clientY);
    if (!hit) {
      this.hovering = false;
      return false;
    }
    const world = this._toFrame(clientX, clientY);
    if (!hit.hand.beginDrag(hit.card, world.x, world.y)) return false;
    this._dragHand = hit.hand;
    this.hovering = true;
    return true;
  }

  pointerMove(clientX, clientY) {
    this._pointer = { x: clientX, y: clientY };
    if (this._dragHand) {
      const world = this._toFrame(clientX, clientY);
      this._dragHand.moveDrag(world.x, world.y);
      return true;
    }
    return this._updateHover();
  }

  pointerUp(cancelled = false) {
    const hand = this._dragHand;
    this._dragHand = null;
    if (!hand) return false;
    const used = hand.endDrag(cancelled);
    // Fired on release, so the effect and the card's flight to the middle of the
    // screen start on the same frame.
    if (used) this.onCardUsed(used.cardId, hand.player);
    if (this._pointer) this._updateHover();
    return true;
  }

  /** The pointer left the canvas entirely. */
  clearHover() {
    this._pointer = null;
    this.hovering = false;
    this._onHand[0] = false;
    this._onHand[1] = false;
    for (const h of this.hands) if (h !== this._dragHand) h.hovered = null;
  }

  _updateHover() {
    const hit = this._pointer ? this.hitAt(this._pointer.x, this._pointer.y) : null;
    const frame = this._pointer ? this._toFrame(this._pointer.x, this._pointer.y) : null;
    for (const h of this.hands) {
      // A card under the pointer raises the hand; the hand's own box KEEPS it
      // raised. See `CardHand.bounds` — without the second half the fan drops
      // out from under the pointer while it is rearranging and cannot come back.
      const inBox =
        h.live &&
        h.raise > 0.01 &&
        !!frame &&
        !this._reserved(this._pointer.x, this._pointer.y) &&
        (() => {
          const b = h.bounds();
          return frame.x >= b.minX && frame.x <= b.maxX && frame.y >= b.minY && frame.y <= b.maxY;
        })();
      this._onHand[h.player] = (!!hit && hit.hand === h) || inBox;
      if (h === this._dragHand) continue;
      // Two stages, and the order matters. Reaching the hand raises the WHOLE
      // hand; only once it is up does a single card come out of the fan. Lifting
      // one card out of a tucked hand would mean picking a card before you could
      // see what you were picking.
      const raised = h.raise > RAISED_ENOUGH;
      h.hovered = hit && hit.hand === h && raised ? hit.card : null;
    }
    this.hovering = !!hit;
    return this.hovering;
  }

  /** Client pixels -> the virtual frame the cards are laid out in. */
  _toFrame(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width) - 0.5) * FRAME.width,
      y: (0.5 - (clientY - rect.top) / Math.max(1, rect.height)) * FRAME.height,
    };
  }

  dispose() {
    for (const h of this.hands) h.dispose();
    this.materials.dispose();
    clearCardTextureCache();
  }
}

import { Mesh, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import { FRAME as SHARED_FRAME, frameCamera, refitFrameCamera } from '../core/frame.js';
import { CardMaterials } from './CardMaterial.js';
import { CardHand, CARD_ASPECT } from './CardHand.js';
import { clearCardTextureCache, noticeTexture, useGuideTexture } from './cardTexture.js';
import { lockTexture } from './fxTextures.js';

/**
 * The card scene: its own scene, its own orthographic camera, its own raycaster.
 *
 * ── it is drawn OUTSIDE the bloom chain, and that is a reversal ─────────────
 * The cards used to be drawn into the same low-resolution target as the world,
 * so that both took one dither lattice, one 5-bit quantiser and one nearest
 * upscale — sharing a single image was the entire point, and compositing the
 * cards separately would have put them on their own lattice at their own phase.
 *
 * Sharing one image is now the problem. The world goes through a bloom chain and
 * a card face is a white plate with dark type on it, which is precisely the
 * input a bright-pass is looking for: at any strength worth having on the world,
 * the cards halate into mush. So the order is:
 *
 *     composer.render()                  // world -> MSAA target -> bloom
 *     autoClear = false; clearDepth()    // cards are not part of the world
 *     render(card scene, ortho camera)   // straight to the canvas, no bloom
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

/**
 * The layout box, in frame pixels — the shared, live one.
 *
 * Re-exported under the name this module has always used, so `CardHand`,
 * `CardFx` and `CardFlight` (which are all handed this exact object) follow a
 * change of shape for free. See src/core/frame.js.
 */
export const FRAME = SHARED_FRAME;

/** How far up a hand must be before a single card will lift out of it. */
const RAISED_ENOUGH = 0.8;

/**
 * Where a sealed hand's padlock sits, in frame coordinates.
 *
 * ── only ever the bottom hand, so there is no side to choose ────────────────
 * The marker is drawn on the sealed player's OWN turn and at no other time —
 * see `_updateSeals` — and on their own turn their hand is the one at the
 * bottom of the screen. So this takes no "which edge" argument: there is one
 * place a seal marker can be, and asking would only create a second answer.
 *
 * X is measured out from the middle of the hand and Y up from the bottom edge,
 * because that is how the hand itself is laid out and the marker has to move
 * with it when either is dragged in the panel.
 */
export function sealAnchor(cfg, frame) {
  return { x: cfg.sealIconX, y: -frame.height / 2 + cfg.sealIconY };
}

/**
 * 침묵's palette. Three entries, and they barely move.
 *
 * Against 혼란's five and 강타's four, so no two of the three cycles line up — a
 * player carrying two of them must not see one beat. But the real difference is
 * the RANGE: those two walk across hues, and this one walks between three greys
 * with a trace of cold in them. 침묵 takes colour away from the hand it lands
 * on, and a marker that pulsed through violet and pink would be advertising the
 * opposite of what the card does.
 */
const SEAL_PALETTE = [
  [1.0, 1.0, 1.0],
  [0.78, 0.82, 0.9],
  [0.62, 0.66, 0.76],
];

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * How faint the hand may get and still answer a press. See `update`'s `gate`.
 *
 * The same number `HudLayer` uses, and it has to be: the two are driven by one
 * scalar, and a hand that stopped taking presses at a different point from the
 * HUD would be a window in which exactly one of them was reachable.
 */
const INPUT_GATE = 0.5;

export class CardLayer {
  /**
   * @param {HTMLCanvasElement} canvas  for mapping pointer coordinates
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
  /**
   * @param {(player: number) => boolean} [silenced]
   *   whether 침묵 has this player's hand sealed. Handed in from the game for the
   *   reason `usable` is: the view does not decide what is legal.
   *
   *   Separate from `usable` even though the seal is what makes every card
   *   answer `ok: false`, because the two are asked about different things. That
   *   one is per CARD and is what greys them; this is about the HAND, and it is
   *   what puts the padlock next to it and what times the colour coming back.
   *   Deriving "sealed" from "every card is blocked" would be a guess — a hand
   *   holding one 강타 that is already armed satisfies it too.
   */
  constructor({ canvas, config, onCardUsed, onReorder, usable, reserved, silenced }) {
    this.canvas = canvas;
    this.config = config;
    this.onCardUsed = onCardUsed ?? (() => {});
    this.usable = usable ?? (() => ({ ok: true }));
    this._isReserved = reserved ?? (() => false);
    this._isSilenced = silenced ?? (() => false);

    this.scene = new Scene();
    this.camera = frameCamera();

    this.materials = new CardMaterials();

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
    /** How much of the hand is on screen. Gates the hit test — see `update`. */
    this._gate = 1;
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

    /**
     * The drop guide: where a card has to come to be played.
     *
     * ── it sits BETWEEN the fan and the card being carried ──────────────────
     * The card has to pass over it — a slot on a table is under the thing you
     * are putting in it — but the rest of the hand must not, and that is not a
     * taste call: the raised fan reaches to about frame y −120 and the slot's
     * bottom edge is at −151, so a guide under everything has its lower corners
     * covered by whichever cards happen to be next to the one being dragged.
     * Measured on a five-card hand; the guide read as an open-bottomed bracket.
     *
     * The order is therefore set per frame in `_updateGuide`, against the same
     * arithmetic `CardHand._place` uses, rather than being a constant here.
     *
     * `guideMargin` is the other half of being under the dragged card: a border
     * exactly the card's size would sit beneath the card's own edge and be
     * invisible at the one moment it is confirming something.
     *
     * One mesh, re-textured when the size changes, because there is only ever one
     * card being dragged.
     */
    this.guide = new Mesh(new PlaneGeometry(1, 1), this.materials.create(useGuideTexture(64, 96)));
    this.guide.visible = false;
    this.scene.add(this.guide);
    this._guideKey = '';
    /** The PADDED size the guide texture wants to be drawn at. See its note. */
    this._guideDraw = { w: 1, h: 1 };

    /**
     * 무장하는 순간 한 번 터지는 링. 가이드와 **같은 텍스처**를 쓴다.
     *
     * ── 왜 확인이 따로 필요한가 ────────────────────────────────────────────
     * 슬롯은 이제 게이지다: 카드를 끌어 올릴수록 연속으로 밝아진다. 연속인 것이
     * 개선이고 동시에 문제다 — 끝에 도달했다는 사실 자체가 그 연속 안에 묻힌다.
     * 예전에는 `guideArmedGrow` 로 한 번 커지는 것뿐이라 놓쳤는지 아닌지가
     * 애매했고, 게이지가 되면 그 애매함이 오히려 커진다.
     *
     * 그래서 1 에 닿는 프레임에 링 하나가 가이드 밖으로 퍼지며 사라진다. 슬롯의
     * 모양 그대로라 새 텍스처가 없다 — 같은 그림이 한 번 커지며 없어지는 것이고,
     * 그것이 "여기 놓으면 된다"의 확인이다.
     *
     * ── 프레임으로 센다 ────────────────────────────────────────────────────
     * `cardFx.smashFlashFrames` 와 같은 이유다: 이 길이의 창은 주사율이 다르면
     * 다른 프레임 수에 걸리고, 1~2 프레임에서는 그것이 "보임"과 "아무것도 아님"의
     * 차이다.
     *
     * ── 가이드가 사라져도 끝까지 돈다 ──────────────────────────────────────
     * 무장한 그 순간에 손을 놓는 것은 흔한 일이고, 그러면 카드가 날아가면서
     * 가이드가 꺼진다. 확인이 그 프레임에 같이 꺼지면 확인한 적이 없는 것이다.
     * 그래서 터지는 자리를 붙잡아 두고 자기 프레임 수만큼 혼자 돈다.
     */
    this.burst = new Mesh(new PlaneGeometry(1, 1), this.materials.create(useGuideTexture(64, 96)));
    this.burst.visible = false;
    this.scene.add(this.burst);
    /** Frames of burst still owed. Counted DOWN in frames, not seconds. */
    this._burstLeft = 0;
    /** Where it plays, captured on the latching frame. */
    this._burstAt = { x: 0, y: 0, w: 1, h: 1, order: 0 };
    /** Whether the dragged card was armed last frame. The rising edge arms it. */
    this._wasArmed = false;

    /**
     * 지난 프레임에 아직 날아오고 있던 카드의 키.
     *
     * 이번 프레임에 없어진 것이 **이번 프레임에 착지한 것**이다. 비행이 끝나는
     * 순간을 `CardFlight` 에서 알려 주게 하지 않는 것은, 그러면 도착 연출이
     * 비행의 일이 되기 때문이다 — 비행은 그림 하나고, 부채꼴이 열리는 것은 손패의
     * 일이다. 여기서 두 집합의 차를 보면 어느 쪽도 상대를 알 필요가 없다.
     */
    this._wasPending = new Set();
    this._landed = new Set();

    /**
     * The padlock that stands on a sealed hand. One per player.
     *
     * ── it is NOT parented to the hand, and that is deliberate ────────────────
     * The parked hand's root is rotated by π so its fan opens the right way off
     * the top edge — see `CardHand.update` — and a lock inherited into that
     * would hang upside down, which reads as a bug rather than as a seal. So the
     * markers live in the scene and are placed from `sealAnchor`, which is also
     * where the effect's stamp lands.
     *
     * ── and it is drawn on the hand, not on the cards ────────────────────────
     * Which is what makes it work for a FACE-DOWN hand. The AI's cards will show
     * their backs, the grey-out happens in the card material and is blind to
     * which texture is bound, and this marker never touched a card in the first
     * place — so a sealed AI hand is greyed and padlocked by exactly this code,
     * with nothing added.
     */
    this._seals = [0, 1].map(() => {
      const mesh = new Mesh(new PlaneGeometry(1, 1), this.materials.create(lockTexture(16)));
      mesh.visible = false;
      // Above the fan, below the reason plate: the plate is an answer to
      // something the player is doing right now and the lock is a standing
      // condition, so the momentary thing wins.
      mesh.renderOrder = 880;
      this.scene.add(mesh);
      return mesh;
    });
    /**
     * Whether each hand's marker was DRAWN last frame.
     *
     * Not "was sealed": the marker only exists on that player's own turn, so
     * this is the edge both the stamp and the release hang off. See the note on
     * `_updateSeals` for why the release needs the seal's own state as well.
     */
    this._wasShown = [false, false];
    /** 1 the frame a seal lifts, decaying to 0. See `CardHand.update`. */
    this._sealFade = [0, 0];
    /** 1 the frame the marker arrives, decaying to 0. Drives the stamp. */
    this._sealIn = [0, 0];
    /** Wall-clock seconds, for the marker's palette walk. Render only. */
    this._now = 0;
    /** Last frame's AI reveal, so its start and end can be caught as edges. */
    this._reveal = null;
  }

  /**
   * 프레임이 모양을 바꿀 수 있으므로 직교 상자가 따라가야 한다.
   *
   * 재질에는 더 넘기지 않는다. `CardMaterials` 가 해상도를 받던 것은 정점 스냅의
   * 격자 때문이었고, 스냅과 함께 사라졌다 — 카드는 고정된 프레임 상자 안에 놓이므로
   * 렌더 타겟이 몇 픽셀이든 레이아웃이 같다.
   */
  setResolution(_resolution) {
    refitFrameCamera(this.camera);
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
    /**
     * 착지한 키 = 지난 프레임엔 보류였는데 이번 프레임엔 아닌 것.
     *
     * 이 차집합이 곧 "비행이 방금 끝났다"이고, 그것과 그냥 손패에 카드가 하나 는
     * 것 — 첫 배분, 되돌린 무대 — 은 다른 사건이다. 후자에 착지 연출을 붙이면
     * 판이 열릴 때마다 다섯 장이 한꺼번에 뒤집힌다.
     */
    this._landed.clear();
    for (const k of this._wasPending) {
      if (!pending || !pending.has(k)) this._landed.add(k);
    }
    this._wasPending.clear();
    if (pending) for (const k of pending) this._wasPending.add(k);

    for (const h of this.hands) {
      const held = hands.get(h.player);
      // A card still flying in from the field is not in the fan yet — see
      // `CardFlight`. Filtered here rather than inside the hand so the hand
      // stays a plain mirror of the state it is given.
      h.syncTo(
        pending && pending.size ? held.filter((c) => !pending.has(c.key)) : held,
        this._landed.size ? this._landed : null,
      );
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
    // The two meshes that are not cards cache by CONTENT rather than by size, so
    // an unchanged key would leave them pointing at a texture this call has just
    // disposed — which draws nothing, silently, because a freed texture is not an
    // error. Forgetting the guide's would have been a border that vanished the
    // first time anyone touched the resolution slider.
    this._guideKey = '';
    this._noticeText = '';
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
   * @param {number|null} [pinnedBottom]
   *   A player index whose hand stays at the bottom whatever the turn says, or
   *   null for the ordinary swap.
   *
   *   ── this is what "핸드 자리 교체 연출도 없다" is ─────────────────────────
   *   The swap exists because two people share one screen and each needs their
   *   own hand in front of them. Against an AI there is one person, so there is
   *   nothing to swap FOR — and swapping anyway spends half a second of every
   *   turn sliding an opponent's face-down cards into the seat the player is
   *   sitting in, then sliding them back out. Pinned, the player's hand is
   *   always the one at the bottom and the AI's is always the strip along the
   *   top, which is what somebody playing a computer expects to look at.
   *
   *   Null in local play, where every line below behaves exactly as it did.
   * @param {{player: number, cardId: string, phase: string, t: number}|null} [reveal]
   *   The AI's card being turned over. See `CardHand.beginReveal`.
   * @param {number} [gate]
   *   0..1, how much of the hand is on screen at all.
   *
   *   ── it gates the HIT TEST, and nothing else here ──────────────────────
   *   The OPACITY is applied by the host, straight onto `materials.shared.uFade`
   *   — see the two scalars in `main.js` — because that uniform already
   *   multiplies through every card and is the one place a whole-hand fade
   *   belongs. What the layer needs the number for is the press: the intro and
   *   the ending fade the hand away and hold it there, and a card you cannot see
   *   but can still drag is worse than one you can see and cannot. Below
   *   `INPUT_GATE` there is nothing to hit.
   *
   *   Distinct from `enabled`, which greys a hand that is on screen and is the
   *   right picture for somebody else's turn, and from `visible`, which is a
   *   mode having no cards at all.
   */
  update({
    dt,
    currentPlayer,
    enabled,
    visible = true,
    pinnedBottom = null,
    reveal = null,
    gate = 1,
  }) {
    const cfg = this.config.cards;

    this._gate = gate;
    this._now += dt;
    /**
     * 홀로그램에서 손패 전체가 공유하는 넷. 프레임당 한 번 쓴다.
     *
     * 카드마다 다른 것은 **위상**이고 그건 각자의 위치와 각도가 만든다 —
     * `CardHand._place` 가 그 둘을 넘긴다. 여기 있는 것은 무늬의 성질(띠 간격,
     * 채도, 테두리 폭)과 시간이고, 그 셋이 카드마다 다르면 다섯 장이 서로 다른
     * 재질로 만들어진 것으로 보인다.
     *
     * 매 프레임 쓰는 것은 패널 때문이다. 생성자에서 한 번만 읽으면 슬라이더를
     * 움직여도 화면이 변하지 않고, 그건 패널에 대한 거짓말이다. 재질이 유니폼
     * 객체를 공유하므로 비용은 한 번의 대입 넷이다.
     *
     * 시간은 아주 느린 드리프트다. 아무도 손대지 않는 손패가 완전히 정지한 그림이
     * 되지 않을 만큼만 흐른다.
     */
    const fxCfg = this.config.cardFx;
    const shared = this.materials.shared;
    shared.uHoloScale.value = fxCfg.holoScale;
    shared.uHoloSat.value = fxCfg.holoSaturation;
    shared.uHoloRim.value = fxCfg.holoRimWidth;
    shared.uHoloTime.value = this._now * fxCfg.holoDriftPerSecond;

    this._visible = visible;
    if (!visible) {
      for (const h of this.hands) h.root.visible = false;
      for (const s of this._seals) s.visible = false;
      this.notice.visible = false;
      this.guide.visible = false;
      this.burst.visible = false;
      this._burstLeft = 0;
      this._wasArmed = false;
      // Hover state goes with it, or a pointer that was over a card when the
      // mode changed would keep reporting one that is no longer drawn — and the
      // router asks the cards before it asks the board, so that press would be
      // swallowed by a hand nobody can see.
      this.clearHover();
      this._enabled = false;
      return;
    }
    for (const h of this.hands) h.root.visible = true;
    this._enabled = enabled;

    // Pinned, the seat is a constant and the swap simply never has anywhere to
    // travel to — so the easing below runs, finds itself already there, and
    // costs nothing. One expression rather than a branch around the whole block.
    const seated = pinnedBottom ?? currentPlayer;
    const want = seated === 0 ? 1 : 0;
    const rate = dt / Math.max(0.05, cfg.turnSwapSeconds);
    this._swap += Math.max(-rate, Math.min(rate, want - this._swap));

    this._updateReveal(reveal);

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

    // And the seals before them, for the same reason: the hands are handed
    // `_sealFade` below, so advancing it afterwards would give them last frame's
    // value. Measured — it cost exactly one frame, and that frame is the one the
    // seal lifts on, so the hand flashed to full colour and then dropped back to
    // grey to start the transition it had already finished.
    this._updateSeals(dt, p0);

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
        sealFade: this._sealFade[hand.player],
        reveal: reveal && reveal.player === hand.player ? reveal : null,
      });
    }

    this._updateGuide();
    this._updateBurst();
    this._updateNotice();
  }

  /**
   * The slot the dragged card has to reach, drawn at the height it arms at.
   *
   * ── the position is DERIVED from the rule, never a number of its own ────────
   * `useLiftFactor` is a live slider and `homeY` moves with the fan's curvature,
   * so anything written down here would be right at today's settings and quietly
   * wrong at tomorrow's — a guide pointing somewhere the card does not arm is
   * worse than no guide, because the player would trust it. So the same three
   * terms `_checkArmed` tests are the ones that place this: the card's own
   * resting height, the threshold, and the hand's scale.
   *
   * ── shown while the gesture is still undecided ─────────────────────────────
   * `dragMode` is null until the drag commits to use-or-sort, and that is exactly
   * the moment guidance is worth anything — a guide that waited for the decision
   * would arrive after the player had made it. It goes the instant the gesture
   * turns out to be a sort.
   *
   * A blocked card never gets one. It cannot be played however far it travels,
   * and drawing it somewhere to aim for would be an invitation to a refusal.
   */
  /**
   * ── 이제 드래그 전에도 나온다 ───────────────────────────────────────────────
   * 슬롯은 드래그가 시작된 뒤에만 그려졌다. 그건 "얼마나 올려야 하는가" 를 이미
   * 올리기 시작한 사람에게만 알려 준다는 뜻이고, 처음 보는 사람은 한 번 실패한
   * 뒤에야 그 문턱을 알게 된다 — 이 가이드가 없애려던 바로 그 문제가 시작 지점에
   * 그대로 남아 있었다.
   *
   * 그래서 카드에 손이 얹히는 순간(호버) 같은 슬롯을 **옅게** 미리 보여 준다.
   * 위치를 정하는 식은 아래와 한 글자도 다르지 않다 — 같은 `_checkArmed` 항이다 —
   * 그러니 미리보기와 실제가 어긋날 방법이 없다.
   *
   * 손이 다 올라오기 전에는 그리지 않는다(`RAISED_ENOUGH`). 부채꼴이 아직 움직이는
   * 동안 슬롯이 떠 있으면 두 개가 서로 다른 속도로 움직이는 것으로 보인다.
   */
  _updateGuide() {
    const cfg = this.config.cards;
    const dragHand = this._dragHand;
    /** 드래그가 없을 때만 호버가 슬롯을 부른다. 둘이 겹칠 일은 없다. */
    const hoverHand = dragHand ? null : this.hands.find((h) => h.hovered && h.raise > RAISED_ENOUGH);
    const hand = dragHand ?? hoverHand;
    const card = dragHand ? dragHand.dragging : hoverHand?.hovered;
    const preview = !dragHand;

    if (
      !cfg.showUseGuide || !hand || !card
      || (!preview && hand.dragMode === 'sort')
      || card.blocked || card.flying > 0
    ) {
      this.guide.visible = false;
      // 슬롯이 없으면 무장도 없다. 에지를 남겨 두면 다음에 같은 카드를 집었을 때
      // 이미 무장한 상태로 시작해 확인이 나오지 않는다.
      this._wasArmed = false;
      return;
    }

    const scale = hand.root.scale.y;
    const cardH = cfg.width * CARD_ASPECT;
    // The card is carried at `hoverScale` — see `CardHand.update` — so the slot
    // is sized to the card as it will actually arrive, not as it sits in the fan.
    const margin = Math.max(0, cfg.guideMargin);
    const w = (cfg.width * cfg.hoverScale + margin * 2) * scale;
    const h = (cardH * cfg.hoverScale + margin * 2) * scale;

    /**
     * Re-textured only when the SLOT size changes, so the border stays one texel
     * per pixel instead of being stretched off the grid.
     *
     * 그려지는 크기는 슬롯보다 크다. 다크 헤일로와 흰 글로우가 퍼질 자리가 텍스처
     * 안에 있어야 하고, 그 여백만큼 쿼드도 커져야 슬롯의 실제 크기가 `guideMargin`
     * 이 정한 값 그대로 남는다 — 여백을 무시하고 슬롯 크기로 그리면 빛이 눌려
     * 들어와 테두리가 다시 굵은 선이 된다. 텍스처가 `userData` 로 그 크기를 준다.
     */
    const key = `${Math.round(w)}:${Math.round(h)}`;
    if (key !== this._guideKey) {
      this._guideKey = key;
      const tex = useGuideTexture(w, h);
      this.guide.material.uniforms.uMap.value = tex;
      this.burst.material.uniforms.uMap.value = tex;
      this._guideDraw = { w: tex.userData.width, h: tex.userData.height };
    }

    /**
     * 문턱까지의 진행도. 미리보기에는 없다 — 아직 끌고 있지 않으므로.
     *
     * `CardHand.armProgress` 는 `_checkArmed` 와 **같은 식**에서 나온다. 문턱을
     * 옮기는 것이 아니라 그 식의 값을 노출하는 것이고, 그래서 여기서 무엇을 하든
     * 카드가 무장되는 높이는 한 픽셀도 움직이지 않는다.
     */
    const p = preview ? 0 : hand.armProgress;

    // Where the card's GRIP sits at the instant it arms — the identical
    // expression `_checkArmed` compares against — and the body rises from there.
    const gripY = hand.root.position.y + (card.homeY + cfg.useLiftFactor * cardH) * scale;
    /**
     * 이산 점프가 아니라 연속이다.
     *
     * `guideArmedGrow` 의 주석은 "카드가 선을 넘는 것은 EVENT 고, 매끄럽게 자란
     * 슬롯은 과정을 보고하는 것"이라고 적어 두었다. 그 문장은 슬롯의 **확대**가
     * 확인을 맡고 있을 때 맞았다. 이제 확인은 무장 프레임에 터지는 링이 맡고
     * (`_updateBurst`), 슬롯은 과정을 보고하는 쪽으로 옮겼다 — 보고할 과정이
     * 실제로 있고, 그것이 보이지 않는 것이 원래의 문제였기 때문이다.
     */
    const grow = 1 + Math.max(0, cfg.guideArmedGrow) * p;

    this.guide.position.set(0, gripY + (cardH * cfg.hoverScale * scale) / 2, -1);
    this.guide.scale.set(this._guideDraw.w * grow, this._guideDraw.h * grow, 1);

    /**
     * Above the resting fan, and ALWAYS below the card being carried.
     *
     * `CardHand._place` gives a card `level + forward * (n + 2)`, where `level`
     * is its index and `forward` climbs from 0 to 1 over the same travel this
     * guide is drawn at the end of. So a resting card is at most `n - 1` and a
     * card that has arrived is at least `n + 2`; `n` sits in that gap.
     *
     * The `min` is what handles the START of the drag, and it is not a
     * refinement — it is a case a fixed `n` gets visibly wrong. `forward` is
     * still 0 down there, so the card is drawn at its bare level while its TOP
     * has already climbed into the slot's lower edge, and a fixed `n` put the
     * guide's bottom border straight across the card's title. Measured, on the
     * frame the gesture commits.
     *
     * Below the card costs the guide's bottom corners to whichever cards are
     * beside the dragged one, for the part of the drag where the card is low.
     * That is the right trade: a corner behind a card reads as depth, a line
     * across a card's name reads as a bug.
     */
    /**
     * 미리보기는 부채꼴 **위**다. 드래그 중일 때만 카드 밑으로 들어간다.
     *
     * `min` 이 필요했던 것은 드래그가 막 시작된 순간, 카드는 아직 낮은 level 에
     * 있는데 그 위쪽 끝이 이미 슬롯 아래 테두리에 걸치는 경우 때문이었다. 호버
     * 미리보기에는 그 순간이 없다 — 슬롯은 손패에서 한참 위에 떠 있고 카드는
     * 아직 부채꼴 안에 있으므로, 쉬고 있는 카드 전부보다 위에 그리면 된다.
     */
    this.guide.renderOrder = preview
      ? hand.cards.length
      : Math.min(hand.cards.length, card.mesh.renderOrder - 0.5);

    const u = this.guide.material.uniforms;
    /**
     * 미리보기는 **표적이 아니라 예고**라서 옅다. 그 다음은 게이지다.
     *
     * `cards` 는 시뮬레이션 쪽 설정이라 새 키를 넣지 않는다 — `config.cards` 의
     * 주석에 그 경계가 적혀 있다. 그래서 이미 있는 `guideOpacity` 와
     * `guideArmedOpacity` 에서 유도한다: 그 둘이 여전히 양 끝을 정하고, 새로 생긴
     * 것은 그 사이를 잇는 방법뿐이다.
     *
     * 드래그를 시작하면 같은 슬롯이 그 자리에서 진해지므로, 미리보기와 게이지가
     * 서로 다른 물건이 아니라 같은 것의 두 단계로 읽힌다.
     */
    u.uOpacity.value = preview
      ? cfg.guideOpacity * 0.55
      : cfg.guideOpacity + (cfg.guideArmedOpacity - cfg.guideOpacity) * p;
    u.uDrain.value = 0;
    u.uTint.value.setScalar(1);
    this.guide.visible = true;

    /**
     * 무장하는 프레임을 잡는다.
     *
     * `card.armed` 는 카드 객체에 남는 값이라 프레임 사이에 비교할 수 있다 —
     * `CardFx._burst` 처럼 매 프레임 새로 만들어지는 것이 아니다. 그래도 상승
     * 에지를 여기서 따로 기억하는 것은, 끌고 있는 카드가 프레임 사이에 바뀔 수
     * 있기 때문이다(놓고 다른 장을 집는다). 그때는 새 카드의 `armed` 가 false 이므로
     * 에지가 다시 서고, 확인은 카드마다 한 번씩 일어난다.
     */
    if (card.armed && !this._wasArmed) {
      this._burstLeft = Math.max(0, Math.round(this.config.cardFx.guideBurstFrames));
      this._burstAt = {
        x: this.guide.position.x,
        y: this.guide.position.y,
        w: this._guideDraw.w,
        h: this._guideDraw.h,
        order: this.guide.renderOrder,
      };
    }
    this._wasArmed = card.armed;
  }

  /**
   * 확인의 링. 잡아 둔 자리에서 자기 프레임 수만큼 혼자 돈다.
   *
   * 가이드와 독립인 것이 요점이다 — 무장한 그 순간에 손을 놓으면 카드가 날아가고
   * 가이드가 꺼지는데, 확인이 같이 꺼지면 확인한 적이 없는 것이 된다.
   */
  _updateBurst() {
    if (this._burstLeft <= 0) {
      this.burst.visible = false;
      return;
    }
    const frames = Math.max(1, Math.round(this.config.cardFx.guideBurstFrames));
    const k = this._burstLeft / frames;
    this._burstLeft -= 1;

    const at = this._burstAt;
    const spread = 1 + Math.max(0, this.config.cardFx.guideBurstGrow) * (1 - k);
    this.burst.position.set(at.x, at.y, -1);
    this.burst.scale.set(at.w * spread, at.h * spread, 1);
    // 가이드 바로 위. 확인은 슬롯이 하는 말의 마지막 한 마디라 그 위에 놓인다.
    this.burst.renderOrder = at.order + 0.25;
    const u = this.burst.material.uniforms;
    // 제곱으로 떨어뜨려 끝이 끌리지 않는다. 여섯 프레임에 꼬리까지 있으면 그건
    // 번쩍임이 아니라 짧은 페이드다.
    u.uOpacity.value = k * k;
    u.uDrain.value = 0;
    u.uTint.value.setScalar(1);
    this.burst.visible = true;
  }

  /**
   * Start and finish the AI's card reveal on the edges of `reveal`.
   *
   * Edge-driven rather than state-driven because both ends are one-shot: the
   * card has to be PICKED once, out of whichever duplicates are in the fan, and
   * handed to the ordinary fly-out once. Re-picking every frame would let the
   * card change identity mid-flip if the hand were reordered underneath it.
   *
   * The hand-off at the end is what stops the card vanishing. `Match.playCard`
   * removes it from the state the instant the effect starts, and the next
   * `syncTo` destroys anything the state no longer holds — unless it is flying.
   * `endReveal` sets that flag, so the card dissolves out of the middle of the
   * screen exactly as a human's played card does.
   */
  _updateReveal(reveal) {
    const was = this._reveal;
    this._reveal = reveal;
    if (reveal && !was) {
      const hand = this.hands[reveal.player];
      if (hand && !hand.beginReveal(reveal.cardId)) {
        // The card is not in the fan — it can only be a flight that has not
        // landed. Not worth failing the turn over; the effect still plays.
        console.warn(`[cards] nothing to reveal for "${reveal.cardId}"`);
      }
      return;
    }
    if (!reveal && was) this.hands[was.player]?.endReveal();
  }

  /**
   * The padlock, and the colour coming back off the hand when it lifts.
   *
   * ── it is drawn on the VICTIM'S OWN TURN and at no other time ───────────────
   * The seal is armed the moment the card is played, and for a while the marker
   * was drawn from that moment too — a padlock sitting on the opponent's parked
   * hand across the top of the screen for the whole of the caster's turn. That is
   * a badge, not a state: it tells the caster something they already know, at a
   * moment when nothing about it is actionable, and by the time it MATTERS the
   * player has been looking at it for a turn and stopped seeing it.
   *
   * So it waits for the hand it belongs to to come down to the bottom of the
   * screen, and it arrives by being STAMPED. That is the moment the sealed
   * player needs it: their turn has opened, their whole hand is grey, and the
   * question in their head is why.
   *
   * `atBottom` is therefore not asked — the marker only ever exists for the hand
   * in play, so the anchor is always the bottom one. That also means it cannot
   * jump across the frame mid-release when the swap crosses its midpoint.
   *
   * ── two edges, and they are deliberately not the same edge ──────────────────
   * `show` falls both when the seal LIFTS and when the turn merely swaps away
   * from a hand that is still sealed — which is a real case at `silenceTurns`
   * above 1. Only the first of those is a release, so the transition is armed on
   * `show` falling AND the seal being gone. Armed on `show` alone, a two-turn
   * seal would play "you may play again" halfway through itself.
   */
  _updateSeals(dt, p0) {
    const cfg = this.config.cards;
    const fxCfg = this.config.cardFx;

    // Re-pointed every frame rather than on a change: a cache hit costs a map
    // lookup, and it is the only thing that survives another panel slider
    // emptying the texture cache out from under a material still pointing into
    // it. A freed texture is not an error — it just draws nothing, silently.
    const tex = lockTexture(fxCfg.sealLockTexels);
    for (const s of this._seals) s.material.uniforms.uMap.value = tex;

    const rate = dt / Math.max(0.05, cfg.silenceReleaseSeconds);
    const stampRate = dt / Math.max(0.05, fxCfg.sealStampSeconds);
    const at = sealAnchor(fxCfg, FRAME);
    const size = Math.max(1, fxCfg.sealIconSize);

    for (const hand of this.hands) {
      const p = hand.player;
      const sealed = !!this._isSilenced(p);
      // Settled at the bottom — the same test `live` uses for the fans, so the
      // stamp lands once the hand has arrived rather than while it is still
      // sliding under it.
      const show = sealed && (p === 0 ? p0 : 1 - p0) > 0.999;

      if (this._wasShown[p] && !show && !sealed) this._sealFade[p] = 1;
      // Sealed again mid-fade: drop the transition rather than let the two run
      // against each other. Coming back to grey while a "you may play again"
      // animation is still going is the one message that must not be sent.
      if (show) this._sealFade[p] = 0;
      // Armed on the rising edge, so the stamp plays once per turn rather than
      // every frame the hand happens to be down.
      if (show && !this._wasShown[p]) this._sealIn[p] = 1;
      this._wasShown[p] = show;

      if (this._sealFade[p] > 0) this._sealFade[p] = Math.max(0, this._sealFade[p] - rate);
      if (this._sealIn[p] > 0) this._sealIn[p] = Math.max(0, this._sealIn[p] - stampRate);

      const mesh = this._seals[p];
      const fade = this._sealFade[p];
      if (!show && fade <= 0) {
        mesh.visible = false;
        continue;
      }

      mesh.position.set(at.x, at.y, 60);

      const u = mesh.material.uniforms;
      u.uDrain.value = 0;
      if (show) {
        /**
         * The stamp: it arrives oversized and lands, in a handful of jumps.
         *
         * A thing coming from in front of the picture and being pressed onto it,
         * which is the one gesture that says a seal was APPLIED rather than that
         * an icon faded in. Quantised to `sealStampSteps` because a smooth
         * contraction is a tween and this is meant to be a blow.
         */
        const jumps = Math.max(1, Math.round(fxCfg.sealStampSteps));
        const drop = Math.ceil(this._sealIn[p] * jumps) / jumps;
        const s = size * (1 + drop * Math.max(0, fxCfg.sealStampStart - 1));
        mesh.scale.set(s, s, 1);
        const c = SEAL_PALETTE[
          Math.floor(this._now * fxCfg.sealPaletteCyclesPerSecond * SEAL_PALETTE.length) %
            SEAL_PALETTE.length
        ];
        u.uTint.value.set(c[0], c[1], c[2]);
        u.uOpacity.value = 1;
      } else {
        /**
         * The unlock: two hard beats and gone, over the release clock.
         *
         * Stepped rather than faded for the reason every flash in `CardFx` is —
         * a smooth dissolve is a modern transition and would be the one part of
         * this card that did not go through the era's vocabulary. Two beats is
         * the count 원모어's screen edge uses.
         */
        mesh.scale.set(size, size, 1);
        const on = Math.floor((1 - fade) * 4) % 2 === 0;
        u.uTint.value.setScalar(1);
        u.uOpacity.value = on ? fade : 0;
      }
      mesh.visible = u.uOpacity.value > 0.02;
    }
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
   *
   * ── re-measured when 철벽 made the draw pool six ──────────────────────────
   * A sixth card in `CardHands.DRAWABLE` does NOT make the hand six: the
   * ceiling is `config.cards.handLimit`, still 5, and the pool has never had
   * anything to do with it — duplicates already meant five cards could be any
   * five. Measured on a 900x620 viewport with a full five-card hand held fully
   * raised, one of the four own caps had a card quad over it and the reserved
   * rule handed all four back to the board. So the fan's footprint is exactly
   * what it was, and the numbers above stand.
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
    // And a hand that has been faded away by a cinematic takes none either. See
    // `gate` on `update`; the aim fade never reaches this on its own.
    if (this._gate < INPUT_GATE) return null;
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

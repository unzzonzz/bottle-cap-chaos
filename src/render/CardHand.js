import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { CARD_BY_ID } from '../game/cards/cardCatalog.js';
import { accentOf, cardFaceTexture, cardBackTexture, cardGlowTexture } from './cardTexture.js';
import { PALETTE, toRgb } from '../core/palette.js';
import { RADIUS, SIZE, SPACE } from '../core/tokens.js';

/**
 * One player's hand, as meshes.
 *
 * ── the layout space is the FRAME, not the window ────────────────────────────
 * Everything here is in "frame pixels": a fixed 640x480 box that the ortho
 * camera covers exactly, whatever the render target or the window happen to be.
 * That is the one decision the whole file rests on. The DOM version laid out in
 * CSS pixels of the WINDOW, which meant the hand's size relative to the pitch
 * changed with the browser; here a card is a fixed fraction of the frame, so it
 * sits against the pitch the same way on every screen — and at the default
 * 640x480 target one frame pixel is exactly one texel, which is what lets the
 * card art land on the framebuffer grid without resampling.
 *
 * ── the fan ─────────────────────────────────────────────────────────────────
 * Cards are held at their bottom edge, not their middle: the geometry is
 * translated so the origin is the point the hand grips, and every rotation is
 * about that point. A fan pivoting about card centres splays outward instead of
 * opening from a grip, which is what a hand of cards does not do.
 *
 * ── springs, not easing ─────────────────────────────────────────────────────
 * Each card carries four independent spring channels (x, y, scale, angle). The
 * damping is deliberately under critical, so a card let go of comes back past
 * its mark and settles. An eased tween cannot do that, and the overshoot is
 * most of what separates a card from a panel sliding into a slot.
 *
 * Nothing in here is stepped by the physics clock. It runs on the render frame
 * and writes nothing anyone else reads, which is what keeps it out of the
 * determinism story entirely.
 */

/**
 * 카드의 세로:가로. 텍스처 생성기와 같은 값이어야 한다.
 *
 * 1.5 라고 손으로 적혀 있었고 `cardTexture.js` 에도 같은 숫자가 또 적혀 있었다.
 * 이제 둘 다 `SIZE.card` 에서 나온다 — 두 곳에 적힌 같은 숫자는 언젠가 한 곳만
 * 고쳐지고, 그러면 텍스처가 메시에 늘어나 붙는다.
 */
export const CARD_ASPECT = SIZE.card.h / SIZE.card.w;

/**
 * 부채꼴 전체에 걸리는 배율.
 *
 * ── 왜 여기에 있고 config 에 없나 ───────────────────────────────────────────
 * 카드의 크기는 `config.cards.width` 가 정하고 그 키는 **수정 금지**다. 그 아래에
 * `spacing`, `neighbourPush`, `hoverScale`, `hitMargin` 이 전부 128 폭에 맞춰
 * 조율돼 있어서, 폭만 바꾸면 그 넷이 전부 틀어진다.
 *
 * 그래서 폭이 아니라 **손 전체**를 키운다. `root.scale` 하나에 곱하면 간격도
 * 밀림도 히트 영역도 같은 비율로 따라 커지므로, 조율된 관계는 그대로 있고 화면에
 * 도착하는 크기만 `SIZE.card` 가 정한 값이 된다.
 *
 * 부채꼴 밖에서 카드를 그리는 것 — `CardFlight` 는 `cards.scene` 에 직접 붙는다 —
 * 은 이 값을 스스로 곱해야 한다. 손의 자식이 아니라서 `root.scale` 을 못 받는다.
 */
export function cardScale(cfg) {
  return SIZE.card.w / cfg.width;
}

/**
 * How much of a hand shows, given the band it has to live in.
 *
 * ── why this is a function and not three config numbers ─────────────────────
 * `idleExposure`, `activeExposure` and `inactiveExposure` were authored against
 * a hand that hangs off the EDGE of a 4:3 frame with the board behind it: 54
 * pixels of card peeking up, raised to 120 when the pointer comes near. That is
 * the right shape when the alternative is covering the play area.
 *
 * In portrait the hand has a band of its own and the reasoning inverts. Nothing
 * is behind it to protect, so peeking 54 pixels into a 333-pixel band just looks
 * like the cards fell off the bottom of the screen. Worse, the tuck-until-hovered
 * behaviour those numbers exist to serve cannot work on a phone at all: there is
 * no hover on a touch screen, so a hand that only comes up when the pointer
 * approaches is a hand that comes up when you are already dragging it.
 *
 * So with a band the exposures are derived from the band instead — a share of it,
 * capped by the card's own height so a very tall band never blows the card up
 * past its own size. Without one, the authored numbers are returned untouched
 * and every existing layout is bit-identical.
 *
 * Exported because `HudLayer` has to agree about where the OPPONENT's parked
 * hand reaches down to — it hangs the score off that line, and the two drifting
 * apart is exactly the bug `PARKED_HAND_REACH` used to be.
 *
 * @param {number} band       frame pixels of band this hand lives in, 0 if none
 * @param {number} cardHeight the card's own height in frame pixels
 * @param {number} rootScale  the hand's current scale
 */
export function handExposure(cfg, band, cardHeight, rootScale) {
  if (!(band > 0)) {
    return { idle: cfg.idleExposure, active: cfg.activeExposure, parked: cfg.inactiveExposure };
  }
  const card = cardHeight * rootScale;
  return {
    // The WHOLE card, sitting on the frame's bottom edge. `expose` is measured
    // from that edge to the card's top, so an exposure of exactly the card's
    // height puts its lower edge on the edge and all of it in view. Anything
    // more would float the hand off the bottom of the screen, which reads as a
    // bug rather than as a hand on a table; anything less goes back to peeking.
    // The band's own share caps it so a short band never over-exposes.
    idle: Math.min(card, band * 0.55),
    // Clear of the idle line by enough that the lift is unmistakable.
    active: Math.min(card + 40, band * 0.78),
    // The opponent's, at the top. Smaller — it is not yours and not playable.
    parked: Math.min(card * 0.62, band * 0.42),
  };
}

/**
 * Unit quad, gripped at the bottom edge.
 *
 * Two triangles. There is no reason for more: the card is flat, it is unlit,
 * and under an orthographic camera a subdivided quad snaps to exactly the same
 * pixels a two-triangle one does.
 */
const QUAD = new PlaneGeometry(1, 1);
QUAD.translate(0, 0.5, 0);

/** How the springs are integrated, in seconds. */
const SUB_STEP = 1 / 240;

/**
 * 카드의 accent 를 0..1 셋으로. 소멸의 빛이 그 색으로 퍼진다.
 *
 * 색은 `cardTexture.accentOf` 에서 온다 — 카드 면을 물들이는 그 값이다. 여기서
 * 다시 고르면 팔레트에 없는 카드에서 면과 빛이 다른 색을 갖게 된다.
 */
const ACCENT_RGB = (c) => {
  const [r, g, b] = toRgb(accentOf(c.data));
  return [r / 255, g / 255, b / 255];
};

const _v = new Vector3();

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * 카드 텍스처를 실제로 몇 텍셀로 구울 것인가.
 *
 * ── `config.cards` 는 수정 금지 구역이다 ────────────────────────────────────
 * `cards.textureWidth` 는 128 이고, 그 값이 정해진 근거는 "NearestFilter, 밉맵
 * 없음, 128 텍셀 카드를 96 프레임 픽셀에 그린다" 였다. 셋 다 사실이 아니게 됐고
 * 카드는 이제 150 프레임 픽셀 폭이라 128 텍셀로는 흐리다.
 *
 * 그런데 `cards` 는 시뮬레이션 최상위 키라 아트 작업이 건드릴 수 없다. 그래서
 * 값을 고치는 대신 렌더 쪽에서 배수를 곱한다 — `cardCatalog` 의 accent 를
 * 팔레트가 덮어쓰는 것과 같은 방식이고, 같은 이유다.
 *
 * 배수는 둘을 곱한 것이다. `ui.textureScale` 은 화면 픽셀 밀도를 위한 것이고 —
 * 카드와 HUD 판이 나란히 놓이는데 둘의 선명도가 다르면 그게 제일 먼저 보인다 —
 * `cardScale` 은 카드가 프레임에서 커진 만큼이다. 후자를 빼먹으면 카드만 부드럽게
 * 흐려진다.
 */
export function texelsFor(config, base) {
  const scale = Math.max(1, Math.min(3, config.ui?.textureScale ?? 1));
  return Math.round(base * scale * cardScale(config.cards));
}

/** One spring channel. Semi-implicit Euler, sub-stepped so it cannot blow up. */
function advance(ch, target, k, c, dt) {
  const steps = Math.max(1, Math.ceil(dt / SUB_STEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    ch.vel += (k * (target - ch.value) - c * ch.vel) * h;
    ch.value += ch.vel * h;
  }
}

function channel(value) {
  return { value, vel: 0 };
}

export class CardHand {
  /**
   * @param {import('./CardMaterial.js').CardMaterials} materials
   * @param {number} player  0 or 1; reported when one of these is used
   * @param {{width: number, height: number}} frame  the virtual layout box
   */
  constructor({ materials, config, player, frame }) {
    this.materials = materials;
    this.config = config;
    this.player = player;
    this.frame = frame;

    this.root = new Group();
    /** @type {Array<ReturnType<CardHand['_makeCard']>>} */
    this.cards = [];

    /** 0 = parked at the top, inactive. 1 = at the bottom, in play. */
    this.place = player === 0 ? 1 : 0;
    /** 0 = tucked into the bottom edge, 1 = brought up to be played. */
    this.raise = 0;
    /** Whether this hand answers the pointer at all. */
    this.live = false;
    /** How much of a just-lifted 침묵's grey is still on this hand, 1..0. */
    this.sealFade = 0;

    this.hovered = null;
    this.dragging = null;
    /** The card being turned over for an AI play, or null. See `beginReveal`. */
    this.revealing = null;

    /**
     * How far in from each frame edge the device has taken, in frame pixels.
     *
     * Only `top` and `bottom` are read — a hand hangs off a horizontal edge —
     * but the whole set is stored so the field has the same shape everywhere it
     * appears. `CardLayer.setSafeInsets` writes it. See src/platform/safeArea.js.
     */
    this.safeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

    /**
     * 도착과 소멸의 빛. 손 하나에 **한 장**이다.
     *
     * 카드마다 메시를 달면 손패가 다섯 장일 때 쓰이지 않는 쿼드가 다섯 장 있게 되고,
     * 뽑기는 한 번에 한 장이라 그 중 넷은 영원히 안 쓰인다. 같은 프레임에 둘이
     * 도착하는 경우 — 한 턴에 오브 두 개를 스치는 일은 실제로 있다 — 빛은 나중 것에
     * 붙는다. 두 자리에 동시에 필요한 물건이 아니라, 빛이 하나면 도착도 하나로
     * 읽히기 때문이다. 소멸도 같은 한 장을 쓰고(`_place` 를 보라), 같은 이유로
     * 마지막 한 장이 이긴다.
     */
    this._glow = new Mesh(QUAD, this.materials.create(cardGlowTexture(SIZE.card.w, SIZE.card.h)));
    this._glow.visible = false;
    this.root.add(this._glow);

    this._grab = { x: 0, y: 0 };
  }

  get faceDown() {
    return this.place < 0.5;
  }

  /**
   * Start turning one card over, out of a face-down hand.
   *
   * ── the AI's cards are backs, so a play has to SHOW what was played ────────
   * A human's card is face up in their own hand the whole time, so playing it is
   * just a fly-out. The AI's hand is parked at the top and therefore face down —
   * `faceDown` is already `place < 0.5`, so the backs come for free — and a card
   * that simply vanished from it would tell the player nothing at all about what
   * had just been done to them.
   *
   * So the card is drawn out of the fan, brought to the middle, and turned over
   * where it can be read. The 0.6 s the brief insists on is not padding: it is
   * how long it takes to notice a thing move, follow it, and read a word off it.
   *
   * It reuses the card already in the fan rather than building a second mesh —
   * same geometry, same material, same texture cache — so the thing that lands
   * in the middle is visibly the thing that came out of the hand.
   *
   * @param {string} cardId
   * @returns {boolean} whether a card of that type was there to reveal
   */
  beginReveal(cardId) {
    const card = this.cards.find((c) => c.data.cardId === cardId && c.flying <= 0);
    if (!card) return false;
    this.revealing = card;
    card.faceUp = false;
    // Where it was sitting when it was picked, so the pull starts from the fan
    // rather than from wherever the springs happened to have got to.
    card.revealFrom = { x: card.x.value, y: card.y.value, s: card.s.value, a: card.a.value };
    return true;
  }

  /** Hand the revealed card back to the ordinary play path. */
  endReveal() {
    const card = this.revealing;
    this.revealing = null;
    if (!card) return;
    // `flying` is what `syncTo` checks to keep a card whose state entry has gone,
    // and what `_fly` drives. Handing over here means the card dissolves out of
    // the middle of the screen exactly as a human's played card does — it is
    // already at the destination, so what plays is the dissolve alone.
    card.flying = 0.0001;
    card.faceUp = null;
    card.flipWidth = 1;
  }

  // ── contents ─────────────────────────────────────────────────────────────

  /**
   * Make the fan match what the player is actually holding.
   *
   * ── it reconciles, it does not re-deal ──────────────────────────────────
   * This replaced `setCount`, which destroyed every card and built a fresh hand
   * from the catalog. That was fine when a hand was four fixed cards handed out
   * once; it is impossible now that cards are found one at a time, because
   * rebuilding the fan would throw away the springs, the hover, the drag and
   * the fly-out of every card that was already there — on the frame a new one
   * arrived.
   *
   * So cards are matched by `key`, which `CardHands` guarantees is unique for
   * the life of a match. What is already here stays here, keeps its springs and
   * simply slides to a new index; what is gone is destroyed; what is new is
   * built. The order of `this.cards` is made to match the order of the state,
   * which is what makes drag-reordering a change to the STATE rather than to
   * the picture.
   *
   * ── a card in flight is not gone yet ────────────────────────────────────
   * Playing a card removes it from the state immediately, because the effect
   * starts immediately — but the view is still flying it to the middle of the
   * screen. Destroying it on the next sync would make it vanish mid-arc. So a
   * card with `flying > 0` is kept until its own animation retires it, and it
   * is held at the END of the list where it is out of the fan's way.
   *
   * @param {{key: number, cardId: string}[]} instances
   * @param {Set<number>|null} [landed]
   *   Keys whose FLIGHT ended this frame. See `_beginLanding` — an ordinary
   *   arrival (the opening deal, a hand rebuilt after a swap) is not a landing
   *   and must not play one.
   */
  syncTo(instances, landed = null) {
    const byKey = new Map(this.cards.map((c) => [c.key, c]));
    const wanted = new Set(instances.map((i) => i.key));

    for (const c of this.cards) {
      if (wanted.has(c.key) || c.flying > 0) continue;
      if (this.hovered === c) this.hovered = null;
      if (this.dragging === c) this.dragging = null;
      this._destroy(c);
      byKey.delete(c.key);
    }

    const next = [];
    const arrived = [];
    for (const inst of instances) {
      const existing = byKey.get(inst.key);
      if (existing) {
        next.push(existing);
        continue;
      }
      const def = CARD_BY_ID.get(inst.cardId);
      if (!def) continue;
      const card = this._makeCard({ ...def, key: inst.key, cardId: inst.cardId }, inst.key);
      next.push(card);
      arrived.push(card);
    }
    // Flyers ride along at the end so `_place` does not give them a slot in the
    // fan; their own animation owns their transform until it retires them.
    for (const c of this.cards) if (c.flying > 0) next.push(c);

    this.cards = next;

    /**
     * Only the ARRIVALS are placed. Everything else springs.
     *
     * `_resetSprings` snaps every card to its target with zero velocity, which
     * is right for a hand dealt all at once and wrong for one card joining a
     * fan that is already there: it would teleport the neighbours into their
     * new slots instead of letting them open up for the newcomer, and opening
     * up is the whole of what makes a card look like it was slotted in.
     *
     * A new card still has to be placed rather than sprung, because its springs
     * start at zero — sprung, it would fly in from the corner of the frame.
     */
    if (!arrived.length) return;
    const t = this._targets();
    for (const c of arrived) {
      const i = this.cards.indexOf(c);
      if (i < 0 || !t[i]) continue;
      c.x.value = t[i].x;
      c.y.value = t[i].y;
      c.s.value = t[i].s;
      c.a.value = t[i].a;
      c.homeY = t[i].restY;
      if (landed && landed.has(c.key)) this._beginLanding(c);
    }
  }

  /**
   * 날아온 카드가 부채꼴에 앉는 순간.
   *
   * ── 여기가 비어 있었다 ────────────────────────────────────────────────────
   * `CardFlight` 는 뒷면으로 날아와서, 끝나면 메시를 지우고 `pendingKeys` 를 풀고,
   * 다음 sync 에서 부채꼴이 앞면으로 열렸다. 그 파일의 헤더는 그것을 "the reveal
   * happens for free" 라고 적었는데, free 라는 것은 **뒤집기가 없다**는 뜻이다.
   * 뒷면으로 화면을 가로질러 온 카드가 앞면으로 그냥 나타났다. 무엇을 찾았는지
   * 알게 되는 순간이 있기는 한데 그 순간에 아무 일도 일어나지 않았다.
   *
   * 세 가지가 일어난다. 새 경로는 하나도 없다:
   *
   *   뒤집기   AI 의 공개가 쓰는 것과 같은 수평 스케일 통과다. 반쯤에서 쿼드의 폭이
   *            0 이 되고 거기서 텍스처가 바뀌므로, 뒷면이 앞면이 되는 순간은 둘 다
   *            보이지 않는 순간이다. 크로스페이드는 둘을 동시에 보여 주고, 그건
   *            뒤집힘이 아니라 녹아 바뀜이다.
   *   밀림     이웃 카드의 스프링에 속도를 한 번 준다. 목표를 옮기는 것이 아니라
   *            **한 번 흔드는** 것이고, 부채꼴은 이미 언더댐프드라 밀렸다가 되돌아
   *            온다. 카드가 자리를 만들며 들어가는 것으로 보이는 것은 그 되돌아옴이다.
   *            `snapKick` 이 카드의 크기 채널에 하는 일과 같은 종류다.
   *   빛       도착한 자리에서 짧게 퍼지는 흰 빛. 프레임으로 센다.
   *
   * ── 뒤집기는 앞면인 손에서만 ──────────────────────────────────────────────
   * 상대의 손패는 엎어져 있다. 거기서 뒤집으면 뒷면에서 뒷면으로 가는 통과라,
   * 카드가 한 번 납작해졌다 돌아오는 것 외에 아무것도 말하지 않는다. 밀림과 빛은
   * 양쪽 다 한다 — 그 둘은 "한 장 늘었다"이고 그건 엎어진 손에서도 사실이다.
   */
  _beginLanding(c) {
    const fx = this.config.cardFx;
    if (!this.faceDown) {
      c.landFlip = 1;
      c.faceUp = false;
    }
    c.landGlow = Math.max(0, Math.round(fx.landGlowFrames));

    const at = this.cards.indexOf(c);
    if (at < 0) return;
    for (let i = 0; i < this.cards.length; i++) {
      const o = this.cards[i];
      if (o === c || o.flying > 0) continue;
      const d = i - at;
      // 멀수록 덜 밀린다. 손패 전체가 같은 만큼 밀리면 부채꼴이 통째로 옮겨간
      // 것으로 보이고, 자리를 내주는 것으로는 보이지 않는다.
      o.x.vel += Math.sign(d) * (fx.landPushAmount / Math.abs(d));
    }
  }

  _makeCard(data, key) {
    const mat = this.materials.create(
      cardFaceTexture(data, texelsFor(this.config, this.config.cards.textureWidth)),
    );
    const shadowMat = this.materials.createShadow();

    const mesh = new Mesh(QUAD, mat);
    const shadow = new Mesh(QUAD, shadowMat);
    // The hit quad is deliberately not a child of the card: it is a different
    // SIZE, and parenting it would mean dividing the margin back out through
    // the card's own scale every frame. It lives in the root so its world
    // matrix is maintained for free, and it is invisible unless the panel asks.
    const hit = new Mesh(QUAD, new MeshBasicMaterial({
      color: PALETTE.debug.hitQuad,
      wireframe: true,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
      depthWrite: false,
    }));
    hit.visible = false;

    this.root.add(shadow, mesh, hit);

    return {
      data,
      /** The state instance this card draws. Stable for its whole life. */
      key,
      mesh,
      shadow,
      hit,
      mat,
      shadowMat,
      /** Which texture width is currently uploaded, so it is only swapped once. */
      texWidth: texelsFor(this.config, this.config.cards.textureWidth),
      texFace: true,
      x: channel(0),
      y: channel(0),
      s: channel(1),
      a: channel(0),
      /** Where the fan wants it — the datum the use threshold is measured from. */
      homeY: 0,
      armed: false,
      flying: 0,
      /**
       * Face override for the AI's reveal: null follows the hand, true/false
       * forces. Every other card leaves it null and behaves exactly as before.
       */
      faceUp: null,
      /** Horizontal squash while turning over. 1 at rest. See `_reveal`. */
      flipWidth: 1,
      /** Whether the game would refuse this card right now, and why. */
      blocked: false,
      reason: '',
      /** Refusal shake: 1 at the moment of refusal, decaying to 0. */
      shake: 0,
      shakeX: 0,
      /** 착지 뒤집기: 도착 순간 1, 0 으로 내려간다. See `_beginLanding`. */
      landFlip: 0,
      /** 도착 빛에 남은 **프레임** 수. 초가 아닌 이유는 `cardFx` 의 주석에 있다. */
      landGlow: 0,
    };
  }

  _destroy(c) {
    if (this.revealing === c) this.revealing = null;
    this.root.remove(c.shadow, c.mesh, c.hit);
    c.mat.dispose();
    c.shadowMat.dispose();
    c.hit.material.dispose();
  }

  /** Drop every card onto its mark without animating in from nowhere. */
  _resetSprings() {
    const t = this._targets();
    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      c.x.value = t[i].x;
      c.y.value = t[i].y;
      c.s.value = t[i].s;
      c.a.value = t[i].a;
      c.x.vel = c.y.vel = c.s.vel = c.a.vel = 0;
      c.homeY = t[i].restY;
    }
  }

  // ── the fan ──────────────────────────────────────────────────────────────

  /**
   * Where every card would sit if nothing were moving.
   *
   * Hover is part of this rather than an effect layered on top: the neighbours
   * lean away by moving their TARGETS, so the same springs carry both the rise
   * and the push and the two cannot get out of step.
   */
  _targets() {
    const cfg = this.config.cards;
    const n = this.cards.length;
    const mid = (n - 1) / 2;
    const spread = (cfg.spreadDeg * Math.PI) / 180;
    const hoverIndex = this.hovered ? this.cards.indexOf(this.hovered) : -1;

    /**
     * How far the rest of the hand steps aside for the raised card.
     *
     * Derived, not a taste value. A raised card no longer jumps to the front of
     * the stack — see `_forward` — so being READABLE is now a question of
     * geometry: whatever the neighbour would have covered, it has to move out
     * of. That distance is half the raised card plus half a neighbour, less the
     * spacing they already have, and it changes with every one of those three,
     * so a fixed number would be right at one card width and wrong at the rest.
     *
     * `neighbourPush` is the daylight left on top of it.
     */
    const clear =
      Math.max(0, (cfg.width * cfg.hoverScale + cfg.width) / 2 - cfg.spacing) + cfg.neighbourPush;

    const cardH = cfg.width * CARD_ASPECT;
    const halfFrame = this.frame.width / 2;

    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i - mid;
      let x = t * cfg.spacing;
      // The ends sag. Quadratic in the slot, so the fan reads as an arc rather
      // than as a row that has been rotated.
      let y = mid > 0 ? -cfg.curvature * (t / mid) ** 2 : 0;
      // Where the fan holds this card with nothing happening to it. The use
      // threshold is measured from HERE and not from `y`, which by the end of
      // this loop may include the hover lift — the distance a card has to be
      // dragged must not depend on whether it was raised on the way past.
      const restY = y;
      // Left of centre leans left. Anticlockwise is positive here, so the sign
      // is the opposite of the DOM's rotate().
      let a = n > 1 ? -spread * (t / (n - 1)) : 0;
      let s = 1;

      if (hoverIndex >= 0) {
        if (i === hoverIndex) {
          y += cfg.hoverLift;
          s = cfg.hoverScale;
          // Straightened. A card being looked at is held up, not held in the fan.
          a = 0;
        } else {
          const d = i - hoverIndex;
          // The step falls off with distance, but slowly. The card next door
          // takes the whole clearance and the ones behind it take enough to
          // stay out of its way; the falloff is what keeps the far end of a
          // seven-card hand on screen.
          //
          // `1/d`, which is the obvious shape, is far too steep now that the
          // clearance is a card width rather than a nudge: it steps the first
          // neighbour 109 and the second 55, and they were only 59 apart, so
          // the two would sit on top of each other. This never steps adjacent
          // slots by more than about a third of the clearance.
          x += Math.sign(d) * (clear / (1 + (Math.abs(d) - 1) * 0.4));

          // ...and then stop at the edge of the screen. The clearance is most
          // of a card wide, so an end card shoved aside by it runs off the
          // frame — and a card cut in half by the screen edge is a worse thing
          // to look at than two cards overlapping a little more than they did.
          //
          // The reach is measured with the TILT in it. These cards are gripped
          // at the bottom edge, so a leaning one puts its top corner a long way
          // past its own half-width: 56 further, on the default fan, which is
          // most of the difference between fitting and not.
          const reach =
            Math.abs((cfg.width * s * Math.cos(a)) / 2) + Math.abs(cardH * s * Math.sin(a));
          // Against a fully raised hand — scale 1 — because that is when the
          // fan is at its widest and the only time this can bite.
          const limit = Math.max(0, halfFrame - reach);
          x = Math.max(-limit, Math.min(limit, x));
        }
      }
      out.push({ x, y, a, s, restY });
    }
    return out;
  }

  // ── per frame ────────────────────────────────────────────────────────────

  /**
   * @param {number} dt        render seconds
   * @param {number} place     0 parked at the top, 1 in play at the bottom
   * @param {boolean} live     may be hovered and dragged
   * @param {number} lock      extra grey, 0..1, for a hand that cannot act
   * @param {(cardId: string) => {ok: boolean, reason?: string}} usable
   *   asked once per card per frame. The SAME predicate the game will apply when
   *   the card is played — see `cardCatalog` — so a card that looks playable is
   *   playable and one that does not, is not.
   * @param {number} [sealFade]
   *   1 the instant a 침묵 seal lifts off this hand, decaying to 0. The colour
   *   coming BACK, and nothing else — the seal itself is already gone by the time
   *   this is non-zero, and every card is answering `usable` with `ok` again.
   *
   *   It exists because the release is otherwise invisible. The seal greys the
   *   whole hand through the ordinary blocked path, and when it lifts the hand
   *   would snap from grey to colour between two frames, which tells the player
   *   nothing about the thing they most need to know. `CardLayer` owns the
   *   timer; this only reads it, so a hand rebuilt mid-fade does not restart it.
   * @param {{cardId: string, phase: string, t: number}|null} [reveal]
   *   The AI turning one of its face-down cards over. See `beginReveal`.
   */
  update(dt, { place, raise, live, lock, usable, sealFade = 0, reveal = null }) {
    const cfg = this.config.cards;
    /** 그리기 전용 노브. `cards` 와 달리 `configHash` 에 들어가지 않는다. */
    const fxCfg = this.config.cardFx;
    this.place = place;
    this.raise = raise;
    this.live = live;
    this.sealFade = Math.max(0, Math.min(1, sealFade));
    if (!live && !this.dragging) this.hovered = null;

    const h = cfg.width * CARD_ASPECT;

    // Each hand retreats off the edge it is leaving and rises back up the one it
    // is arriving at, rather than sliding across the middle of the screen. Both
    // ends read as "a hand at the edge of the table"; the straight line between
    // them reads as a hand walking over the pitch.
    const atBottom = place >= 0.5;
    const swapFrac = Math.abs(place * 2 - 1);

    // ── tucked until it is wanted ────────────────────────────────────────
    // Your own hand sits at the bottom the way the opponent's sits at the top:
    // small, drained and showing an edge. It comes up when the pointer reaches
    // it and drops back when the pointer leaves. The hand is a THING ON THE
    // TABLE that you pick up, not a panel that is always in the way — and the
    // pitch is what the player is actually looking at.
    //
    // The top hand is never raised, so `present` is the one number that says how
    // far out of the edge a hand is, whichever edge it is at.
    const r = atBottom ? raise : 0;
    const present = atBottom ? r : 0;
    /**
     * ── 부채꼴은 프레임을 넘지 않는다 ─────────────────────────────────────
     * `cardScale` 은 카드가 `SIZE.card` 만해지도록 곱하는 값이고, 그건 640 폭
     * 프레임을 전제로 고른 크기다. 세로 화면의 프레임은 312 폭이라 다섯 장이
     * 펼쳐지면 427 프레임 픽셀을 먹는다 — 양쪽 끝 카드가 화면 밖으로 나간다.
     *
     * 그래서 실제 펼침 폭을 재서 필요하면 조인다. 폭을 고정 상수로 가정하지 않는
     * 이유는 손에 든 장수와 정렬 드래그 상태에 따라 실제 폭이 변하기 때문이다.
     * 손이 좁아지면 배율은 저절로 돌아온다.
     */
    const wide = this._halfSpan() * 2 + SPACE.md * 2;
    const fit = wide > 0 ? this.frame.width / wide : 1;
    const rootScale = Math.min(
      lerp(cfg.inactiveScale, 1, present) * cardScale(cfg),
      Math.max(cfg.inactiveScale, fit),
    );

    // The band this hand lives in — its own edge's, not the other one's. Zero
    // in landscape, where `handExposure` hands back the authored numbers.
    const band = atBottom ? (this.frame.bottomBand ?? 0) : (this.frame.topBand ?? 0);
    const ex = handExposure(cfg, band, h, rootScale);
    const endExposure = atBottom ? lerp(ex.idle, ex.active, r) : ex.parked;
    const expose = swapFrac * endExposure;
    /**
     * The edge the hand hangs off, moved in by whatever iOS has taken.
     *
     * `expose` is literally how many frame pixels of card stick out past the
     * screen edge — the `grip` term cancels — so an inset here does exactly the
     * right thing: the same amount of card is visible, on the near side of the
     * home indicator instead of under it. That matters more than it sounds. In
     * landscape on a notched iPhone the bottom inset is ~26 frame pixels against
     * an idle exposure of 54, so half of the only visible part of your own hand
     * was sitting under the indicator strip.
     *
     * Zero on every desktop browser, and zero in portrait as well — see the note
     * on `_safe` in HudLayer, and src/platform/safeArea.js for the arithmetic.
     */
    const half = this.frame.height / 2;
    const edge = half - (atBottom ? this.safeInsets.bottom : this.safeInsets.top);
    const grip = h * rootScale;
    this.root.position.set(0, atBottom ? -edge + expose - grip : edge - expose + grip, 0);
    this.root.rotation.z = atBottom ? 0 : Math.PI;
    this.root.scale.setScalar(rootScale);

    const opacity = lerp(cfg.inactiveOpacity, 1, present);
    // A tucked hand is drained but not as far as a parked one: yours is dimmed
    // to stay out of the way, the opponent's is greyed because it is not yours,
    // and the two should not read as the same state. The lock adds on top.
    const idleDrain = cfg.greyStrength * (atBottom ? cfg.idleGrey : 1);
    const drain = Math.max(lerp(idleDrain, 0, present), lock);

    const targets = this._targets();
    const level = this._levels();
    const wantFace = !this.faceDown;
    /** @type {typeof this.cards} */
    const done = [];

    // 한 장뿐이므로 매 프레임 끄고 시작한다. 착지 중인 카드가 `_place` 에서 켠다.
    this._glow.visible = false;

    for (let i = 0; i < this.cards.length; i++) {
      const c = this.cards[i];
      const t = targets[i];
      c.homeY = t.restY;

      /**
       * 착지 뒤집기와 도착 빛. 스프링 분기와 **나란히** 돈다.
       *
       * 분기 안에 넣지 않는 것은, 뒤집는 동안에도 카드가 자기 슬롯으로 스프링해야
       * 하기 때문이다. 뒤집기는 위치를 만들지 않는다 — `flipWidth` 하나와 어느
       * 면을 보이느냐뿐이다.
       */
      if (c.landFlip > 0) {
        c.landFlip = Math.max(0, c.landFlip - dt / Math.max(0.05, fxCfg.landFlipSeconds));
        const k = 1 - c.landFlip;
        // `|cos(pi t)|`, `_reveal` 과 같은 식이다: 양 끝에서 폭이 가득 차고 정확히
        // 가운데에서 0 이 된다. `1 - |cos|` 은 그 반대라 카드가 접혔다 펴진다.
        c.flipWidth = Math.max(0.02, Math.abs(Math.cos(Math.PI * k)));
        // 폭이 0 인 그 프레임에 면을 넘긴다. null 은 "손패를 따른다" 이므로,
        // 넘긴 뒤에는 이 카드도 그냥 손패의 한 장이 된다.
        c.faceUp = k >= 0.5 ? null : false;
        if (c.landFlip === 0) c.flipWidth = 1;
      }
      if (c.landGlow > 0) c.landGlow -= 1;

      // Asked every frame rather than latched, because the answer changes under
      // the player's hand: chaos lands, and the trajectory card in the opponent's
      // hand has to go grey where it lies.
      const verdict = usable ? usable(c.data.cardId) : { ok: true };
      c.blocked = !verdict.ok;
      c.reason = verdict.reason ?? '';

      if (c === this.revealing && reveal) {
        // Scripted, not sprung: the whole point is that it takes a known length
        // of time to read. A spring would arrive when it arrived.
        this._reveal(c, reveal, h);
      } else if (c.flying > 0) {
        this._fly(c, dt);
      } else if (c === this.dragging) {
        // Under the hand there is no spring: the card is where the pointer is.
        c.s.value += (cfg.hoverScale - c.s.value) * Math.min(1, dt * 18);
        advance(c.a, 0, cfg.stiffness, cfg.damping, dt);
        if (this.dragMode !== 'sort') this._checkArmed(c, h);
      } else {
        advance(c.x, t.x, cfg.stiffness, cfg.damping, dt);
        advance(c.y, t.y, cfg.stiffness, cfg.damping, dt);
        advance(c.s, t.s, cfg.stiffness, cfg.damping, dt);
        advance(c.a, t.a, cfg.stiffness, cfg.damping, dt);
        c.armed = false;
      }

      // The refusal shake, on its own clock and decaying. It is added to the
      // spring's position rather than driving it, so the card still returns to
      // exactly its slot — a shake fed into the spring would leave it settling
      // somewhere slightly else every time it was refused.
      if (c.shake > 0) {
        c.shake = Math.max(0, c.shake - dt / Math.max(0.05, cfg.refuseShakeSeconds));
        c.shakeX = Math.sin(c.shake * Math.PI * 2 * cfg.refuseShakeCycles) * cfg.refuseShakeAmount * c.shake;
      } else {
        c.shakeX = 0;
      }

      // A revealed card overrides the hand's face/back rule for itself: the
      // whole hand is still face down and this one card is being turned over.
      const face = c.faceUp ?? wantFace;
      this._applyTexture(c, face, c === this.hovered || c === this.dragging || c === this.revealing);
      this._place(c, i, cfg, h, opacity, drain, level);

      if (c.flying > 1) done.push(c);
    }

    // Removal is deferred out of the loop on purpose. Splicing the array being
    // walked skips the next card, and the failure that produces is a read of
    // `undefined` several frames later, nowhere near the splice.
    for (const c of done) {
      const at = this.cards.indexOf(c);
      if (at >= 0) this.cards.splice(at, 1);
      if (this.hovered === c) this.hovered = null;
      this._destroy(c);
    }
  }

  /**
   * Where each card sits in the stack when nothing is happening.
   *
   * Left to right, strictly increasing: every card overlaps the one to its left
   * and is overlapped by the one to its right. Which is how a hand of cards
   * actually sits when it is spread with one thumb, and — more to the point —
   * it is the only arrangement where the rule can be read off the picture. The
   * eye works along the fan in one direction and the depth agrees with it the
   * whole way.
   *
   * ── it used to meet at the centre, and that read as a fault ────────────────
   * The old order tucked in from BOTH ends so the middle card sat on top. It is
   * a real fan shape and it survived three cards looking merely odd; at four it
   * put the second card of the pair above the third — the rightmost card in the
   * hand under its own neighbour — and there is no way to see that as anything
   * but a z-order bug, because from the right-hand end the depth reverses for no
   * reason the player can see.
   *
   * Still a strict order, and that part was never negotiable: two cards sharing
   * a `renderOrder` are drawn in whatever order the renderer's sort happens to
   * leave them, which is stable right up until a card is played and then is not.
   * The index IS the order now, so there is nothing left to tie-break.
   */
  _levels() {
    return this.cards.map((_, i) => i);
  }

  /**
   * How far this card has come forward out of the stack, 0..1.
   *
   * ── this used to be a boolean, and that was the bug ─────────────────────
   * Touching a card sent it straight to the front of the hand in one frame. The
   * gesture it was hanging off — "the pointer is over it" — commits to nothing,
   * so a card jumped a whole layer for a cursor passing across the hand, and
   * jumped back when it left. Worse, it jumped the moment the card started to
   * rise rather than when it had risen, so the layer change and the movement
   * were not even the same event.
   *
   * The order now follows the card's HEIGHT. Nothing happens through the hover
   * rise — a card that is being looked at is still IN the hand, and it overlaps
   * its neighbours exactly as it did — and it climbs past them over the rest of
   * the pull. There is no discrete event left for it to jump on.
   *
   * The ramp starts above where the hover settles, not at it. The spring is
   * under-damped by design and goes about a tenth past its mark on the way up;
   * starting at the mark would let that wobble change layers, which is the same
   * jump in a smaller size.
   */
  _forward(c, cfg, h) {
    if (c.flying > 0) return 1;
    const from = cfg.hoverLift * 1.15;
    const to = Math.max(from + 1, cfg.useLiftFactor * h);
    return smoothstep((c.y.value - c.homeY - from) / (to - from));
  }

  /** Position the three meshes that make up one card. */
  _place(c, i, cfg, h, opacity, drain, level) {
    const w = cfg.width;
    // A card being played dissolves on its way to the middle. Its shadow has to
    // go with it: left on the hand's own alpha it stayed fully black all the way
    // across the screen and then blinked out of existence when the card was
    // removed, which is the one frame anybody would notice.
    const alpha = opacity * (c.flying > 0 ? 1 - smoothstep(c.flying) : 1);
    // Painting order is the whole of the sorting here — the materials do not
    // test depth — so this is the only thing that decides what is in front.
    // `+ 2` so a fully drawn card clears the tallest stack a hand can build.
    const order = level[i] + this._forward(c, cfg, h) * (this.cards.length + 2);

    // `flipWidth` is 1 for every card that is not mid-flip, so this is the
    // identity everywhere except the eight frames an AI card is turning over.
    const sx = w * c.s.value * (c.flipWidth ?? 1);
    const sy = h * c.s.value;
    /** The spring's place, plus whatever the refusal shake is adding. */
    const px = c.x.value + c.shakeX;

    // z carries the same order. It changes nothing on screen under a parallel
    // projection, and it is what makes the raycast agree with the paint: the
    // nearest hit and the topmost card are the same card by construction.
    c.mesh.position.set(px, c.y.value, order * 0.05);
    c.mesh.rotation.z = c.a.value;
    c.mesh.scale.set(sx, sy, 1);
    c.mesh.renderOrder = order;

    /**
     * 그림자.
     *
     * ── 쿼드가 카드보다 크다 ────────────────────────────────────────────────
     * 흐림은 셰이더가 거리로 만들고(`CardMaterial` 의 `SHADOW_FRAG`), 그 흐림이
     * 퍼질 자리는 쿼드 안에 있어야 한다. 카드와 같은 크기의 쿼드는 카드 경계에서
     * 그림자를 잘라내고, 잘린 흐림은 흐림이 아니라 그라디언트로 끝나는 사각형이다.
     *
     * 흐림 반경이 카드의 **그려지는** 크기를 따라간다 — 호버로 확대된 카드는 더
     * 크게 뜬 것이므로 더 넓은 그림자를 만든다. `flipWidth` 는 빼고 잰다: 뒤집히는
     * 중에 그림자의 흐림까지 납작해지면 카드가 눌린 것으로 보인다.
     */
    const fxCfg = this.config.cardFx;
    const blur = Math.max(0.5, fxCfg.shadowBlur * ((w * c.s.value) / SIZE.card.w));
    const radius = RADIUS.card * ((w * c.s.value) / SIZE.card.w);

    // Offset along the card's own axes, so a tilted card's shadow tilts with it.
    const sin = Math.sin(c.a.value);
    const cos = Math.cos(c.a.value);
    const ox = cfg.shadowOffsetX;
    // 그립이 아래 모서리라 쿼드를 키우면 위로만 자란다. 절반을 도로 내려 카드와
    // 같은 중심에 놓는다 — 그림자의 오프셋은 그 위에 더해지는 것이지, 흐림의
    // 여백이 오프셋 노릇을 해서는 안 된다.
    const oy = cfg.shadowOffsetY - blur;
    c.shadow.position.set(
      px + ox * cos - oy * sin,
      c.y.value + ox * sin + oy * cos,
      c.mesh.position.z - 0.005,
    );
    c.shadow.rotation.z = c.a.value;
    c.shadow.scale.set(sx + blur * 2, sy + blur * 2, 1);
    // Half a layer under its own card rather than a whole one: the levels are
    // whole numbers at rest, so a shadow a full step down would land exactly on
    // the layer of the card below it and the two would be tied.
    c.shadow.renderOrder = order - 0.5;
    const su = c.shadowMat.uniforms;
    su.uOpacity.value = cfg.shadowOpacity * alpha;
    su.uSize.value.set(sx, sy);
    su.uRadius.value = radius;
    su.uBlur.value = blur;

    /**
     * 카드 뒤의 빛. 같은 한 장이 두 가지 일을 한다: **도착**과 **소멸**.
     *
     * 도착은 흰빛으로 좁게 퍼지고, 소멸은 카드의 accent 색으로 넓게 퍼진다.
     * 색이 하나 다르다는 것 말고는 같은 그림이고, 그건 우연이 아니라 의도다 —
     * 카드가 손패에 들어오고 나가는 것은 같은 문의 양쪽이다.
     *
     * ── 소멸이 왜 필요했나 ─────────────────────────────────────────────────
     * `Match.playCard` 는 효과가 시작되는 즉시 상태에서 카드를 지운다. 그래도
     * 카드가 증발하지 않는 것은 `flying` 인 것만 `syncTo` 가 파괴하지 않기
     * 때문이고 — 그 계약을 깨면 카드가 그 프레임에 사라진다 — 그래서 낸 카드는
     * 화면 가운데로 가서 옅어진다. 옅어지기만 하는 것이 문제였다: 페이드는
     * 물건이 없어지는 그림이 아니라 물건이 **투명해지는** 그림이다. accent 색이
     * 그 자리에서 한 번 퍼지면 카드가 흩어진 자리가 남는다.
     *
     * ── 텍스처는 매 프레임 다시 물어본다 ──────────────────────────────────
     * 캐시 적중은 맵 조회 하나고, 그것이 패널의 해상도 슬라이더가 캐시를 비우고
     * 지나갔을 때 살아남는 유일한 방법이다 — 해제된 텍스처는 오류가 아니라 그냥
     * 아무것도 안 그리는 것이라 조용히 사라진다. `CardLayer._updateSeals` 가
     * 같은 이유로 같은 일을 한다.
     */
    const glowing = c.landGlow > 0 || c.flying > 0;
    if (glowing) {
      const tex = cardGlowTexture(SIZE.card.w, SIZE.card.h);
      const gu = this._glow.material.uniforms;
      let g;
      let spread;
      if (c.flying > 0) {
        // 소멸. 카드가 옅어지는 만큼 빛이 퍼지고, 그 둘의 합이 일정해 보인다.
        const k = smoothstep(Math.min(1, c.flying));
        g = Math.max(0, 1 - k) * 0.85;
        spread = 1 + k * 0.9;
        gu.uTint.value.set(...ACCENT_RGB(c));
      } else {
        // 도착. 좁게, 짧게, 희게. 프레임으로 센다 — `cardFx` 의 주석에 이유가 있다.
        g = c.landGlow / Math.max(1, Math.round(fxCfg.landGlowFrames));
        g *= g;
        spread = 1 + (1 - g) * 0.35;
        gu.uTint.value.setScalar(1);
      }
      const gw = sx * (tex.userData.width / SIZE.card.w) * spread;
      const gh = sy * (tex.userData.height / SIZE.card.h) * spread;
      const gy = -(gh - sy) / 2;
      gu.uMap.value = tex;
      gu.uOpacity.value = g * opacity;
      this._glow.position.set(
        px - gy * sin,
        c.y.value + gy * cos,
        c.mesh.position.z - 0.004,
      );
      this._glow.rotation.z = c.a.value;
      this._glow.scale.set(gw, gh, 1);
      this._glow.renderOrder = order - 0.25;
      this._glow.visible = true;
    }

    // Grown by the hit margin on every side, about the same grip point, so the
    // extra room is even rather than hanging off the top.
    const m = cfg.hitMargin;
    c.hit.position.set(
      c.x.value + m * sin,
      c.y.value - m * cos,
      c.mesh.position.z + 0.005,
    );
    c.hit.rotation.z = c.a.value;
    c.hit.scale.set(sx + m * 2, sy + m * 2, 1);
    c.hit.visible = this.live && cfg.showHitAreas;
    c.hit.renderOrder = order + 0.25;

    const u = c.mat.uniforms;
    u.uOpacity.value = alpha;

    /**
     * 테두리 홀로그램의 **위상**은 카드가 화면 어디에 어떤 각도로 있느냐다.
     *
     * 직교 카메라에서 시야각 이리데선스가 왜 안 되는지는 `CardMaterial` 헤더에
     * 있다. 여기서 할 일은 그 대신 쓰는 두 값을 넘겨 주는 것뿐이고, 둘 다 바로
     * 위에서 메시를 놓는 데 쓴 그 값이다 — 두 번째 계산 경로를 만들면 언젠가
     * 띠가 카드에서 떨어져 나온다.
     *
     * 뒷면은 거의 빛나지 않는다. `cardBackTexture` 의 주석에 근거가 있다: 상대의
     * 손패는 화면 위쪽에 늘 떠 있어서 대비를 일부러 낮춰 뒀고, 그 다섯 장이
     * 무지개로 빛나면 판 위에서 눈이 계속 그쪽으로 간다.
     *
     * 무장하면 올라간다. 슬롯이 밝아지는 것과 같은 말을 카드 쪽에서 한 번 더 하는
     * 것이고, 그 중복은 의도다 — 무장은 손이 카드를 보고 있을 때 일어난다.
     */
    u.uCardSize.value.set(sx, sy);
    u.uCardRadius.value = radius;
    u.uCardPos.value.set(px, c.y.value);
    u.uCardAngle.value = c.a.value;
    u.uHolo.value =
      (c.texFace ? fxCfg.holoStrength : fxCfg.holoBackStrength) *
      (c.armed ? Math.max(0, fxCfg.holoArmedBoost) : 1);

    /**
     * The card being turned over is exempt from every drain there is.
     *
     * A parked hand is greyed BECAUSE it is not yours — `idleDrain` is the full
     * `greyStrength` for the top hand whatever else is happening — and the whole
     * point of the reveal is that this one card must be read. Left on the hand's
     * drain it arrives at the middle of the screen desaturated and dim, which is
     * the one outcome that makes the 0.6 seconds pointless.
     *
     * Full opacity too, not just full colour: `inactiveOpacity` is 0.55 on a
     * parked hand, and a card at just over half alpha over a busy board is not
     * legible however saturated it is.
     */
    if (c === this.revealing) {
      u.uOpacity.value = 1;
      u.uDrain.value = 0;
      u.uTint.value.setScalar(1);
      return;
    }

    /**
     * The seal lifting, as a fraction of the blocked look still hanging on.
     *
     * Zero unless a 침묵 has just expired off this hand, so every path below is
     * bit-for-bit what it was for every other card. It is applied to the
     * UNBLOCKED branches only: a card that is still refused for its own reasons
     * — an armed 강타, say — is at the full blocked look already and must not
     * brighten partway through somebody else's transition.
     */
    const seal = this.sealFade ?? 0;

    // An unplayable card is drained and dimmed WHERE IT LIES, before anyone
    // touches it. Finding out by dragging it to the top and having it bounce is
    // the version of this that reads as the game being broken — the card has to
    // say no before the gesture starts, not after it has been completed.
    u.uDrain.value = c.blocked
      ? Math.max(drain, cfg.blockedGrey)
      : Math.max(drain, cfg.blockedGrey * seal);

    /**
     * 무장하면 색조가 바뀐다. 두 번째 텍스처로 바꾸지 않는 이유는 그대로다 —
     * 카드가 움직이는 중에 한눈에 읽혀야 하고, 색조는 메모리도 캐시 항목도 쓰지
     * 않는다.
     *
     * ── 따뜻한 금색이었다. 이제 차갑다 ──────────────────────────────────────
     * `(1.3, 1.16, 0.72)` 는 파란 채널을 깎아 카드를 금빛으로 물들였다. 그 색이
     * 나오는 순간은 슬롯 안에 카드가 들어간 순간인데, 그 슬롯이 이제 CYAN 이라
     * 확인해 주는 두 물건이 서로 다른 색으로 말하게 된다. 금색은 이 화면의
     * 언어가 아니다 — `cardTexture.useGuideTexture` 의 주석에 그 사정이 있다.
     *
     * 파란 채널을 가장 많이 올려 유리가 빛을 받는 쪽으로 민다. 밝기 자체가
     * 오르므로("무언가 일어났다") 색맹인 사람에게도 신호가 남고, 그건 금색이
     * 하던 일과 같다.
     */
    const tint = u.uTint.value;
    if (c.blocked) tint.setScalar(cfg.blockedBrightness);
    else if (c.armed) tint.set(1.12, 1.26, 1.34);
    else tint.setScalar(lerp(1, cfg.blockedBrightness, seal));
  }

  /** Swap the LOD, and the face, only when what is wanted actually changes. */
  _applyTexture(c, wantFace, big) {
    const cfg = this.config.cards;
    const want = texelsFor(this.config, big && wantFace ? cfg.hoverTextureWidth : cfg.textureWidth);
    if (c.texWidth === want && c.texFace === wantFace) return;
    c.texWidth = want;
    c.texFace = wantFace;
    c.mat.uniforms.uMap.value = wantFace
      ? cardFaceTexture(c.data, want)
      : cardBackTexture(want);
  }

  /**
   * 무장 문턱까지 얼마나 왔는가. 0 = 부채꼴, 1 = 문턱.
   *
   * ── 문턱은 여기서 한 번만 표현된다 ────────────────────────────────────────
   * `_checkArmed` 의 판정도, 드롭 가이드의 밝기도, 가이드가 그려지는 **높이**도
   * 전부 이 한 식에서 나온다. 셋이 각자 같은 항을 다시 적으면 언젠가 하나만
   * 고쳐지고, 그러면 가이드가 카드가 실제로 무장되는 곳이 아닌 데를 가리킨다 —
   * 그건 표지판이 없는 것보다 나쁘다. 플레이어가 그것을 믿기 때문이다.
   *
   * 1 을 넘어서도 잘리지 않는다. 자르는 것은 읽는 쪽의 일이고, 판정은 `>= 1` 로
   * 물어야 원래의 `>=` 와 한 글자도 다르지 않다.
   *
   * VERTICAL travel from where the fan holds it. Not proximity to a target in
   * the middle of the screen: a target is a small thing to find, and it makes
   * the same gesture succeed or fail depending on which end of the hand the
   * card came from.
   */
  _armFraction(c, h) {
    const to = this.config.cards.useLiftFactor * h;
    if (!(to > 0)) return 0;
    return (c.y.value - c.homeY) / to;
  }

  /**
   * 지금 끌리고 있는 카드의 진행도, 0..1. 아무것도 없으면 0.
   *
   * ── 왜 불리언이 아니라 진행도인가 ─────────────────────────────────────────
   * `useGuideTexture` 의 주석이 스스로 문제를 이렇게 적었다 — "보이지 않는 문턱은
   * 실패해 봐야만 알게 되는 문턱이다." 슬롯이 그려지면서 문턱의 **위치**는 보이게
   * 됐지만, 얼마나 왔는지는 여전히 안 보였다: 가이드는 세 단계 이산이라 무장하는
   * 순간에만 한 번 바뀌었고, 그때는 이미 알 필요가 없다.
   *
   * 진행도에 연동하면 카드를 끌어 올릴수록 슬롯이 밝아진다. 비용은 0 이다 —
   * 텍스처는 그대로 정적이고 모양을 담당하며, 유니폼이 세기를 담당한다.
   *
   * 정렬 드래그에서는 0 이다. 그때 카드는 낼 수 있는 곳으로 가고 있지 않다.
   * 막힌 카드도 0 이다 — `_checkArmed` 가 그 카드를 절대 무장시키지 않으므로,
   * 밝아지는 슬롯은 오지 않을 확인을 약속하는 것이 된다.
   */
  get armProgress() {
    const c = this.dragging;
    if (!c || c.blocked || this.dragMode === 'sort') return 0;
    const h = this.config.cards.width * CARD_ASPECT;
    return Math.max(0, Math.min(1, this._armFraction(c, h)));
  }

  _checkArmed(c, h) {
    const cfg = this.config.cards;
    // A blocked card never arms, however far it is dragged. It still MOVES with
    // the pointer — refusing to lift at all would read as the card being stuck
    // rather than as the play being illegal — it simply never crosses the line.
    if (c.blocked) {
      c.armed = false;
      return;
    }
    const armed = this._armFraction(c, h) >= 1;
    if (armed && !c.armed) c.s.vel += cfg.snapKick;
    c.armed = armed;
  }

  /**
   * The AI's card, on its way out of the hand and over.
   *
   * ── four phases, and the flip is the only interesting one ─────────────────
   * Pull and move are a lift and a glide. The flip is a horizontal scale through
   * zero with the texture swapped at the crossing, which is the cheapest honest
   * card flip there is: at the halfway point the quad has no width, so the
   * moment the back becomes the face is a moment when neither is visible. A
   * cross-fade would show both at once, which reads as a dissolve rather than as
   * something turning over.
   *
   * `|cos(pi t)|` and not `1 - |cos|`: the card has to be full width at both
   * ends and edge-on exactly in the middle.
   *
   * ── it ends up UPRIGHT, which takes a pi ──────────────────────────────────
   * This hand's root is rotated by pi so its fan opens downward off the top edge
   * (see `update`), and a card left at angle 0 inside it hangs upside down. The
   * target is therefore pi, which cancels the root exactly — animated alongside
   * the glide, so the card turns the right way up as it comes in rather than
   * snapping at the end.
   *
   * @param {{phase: string, t: number}} reveal
   */
  _reveal(c, reveal, h) {
    const cfg = this.config.cards;
    const from = c.revealFrom ?? { x: c.x.value, y: c.y.value, s: c.s.value, a: c.a.value };
    const t = smoothstep(reveal.t);

    // Where the middle of the frame is, in this hand's own coordinates. The same
    // conversion `_fly` makes, and for the same reason: the hand is parked and
    // rotated, so "the centre of the screen" is not (0, 0) in here.
    _v.set(0, 0, 0);
    this.root.worldToLocal(_v);

    // Big enough to read against the board, expressed in FRAME terms and then
    // divided back through the parked hand's own shrink — otherwise the reveal
    // would come out `inactiveScale` smaller than asked for.
    const target = cfg.revealScale / Math.max(0.01, this.root.scale.x);
    const lift = cfg.hoverLift * 1.4;

    /**
     * Half a card, ADDED, because a card is gripped at its bottom edge.
     *
     * `QUAD` is translated so the origin is the point the hand holds — which is
     * what makes the fan pivot from a grip rather than splaying from centres —
     * so a card placed AT the middle of the frame hangs entirely off that point
     * instead of straddling it, and half of it lands off the screen.
     *
     * ── the sign is the pi, and it caught me out ────────────────────────────
     * There are TWO pi rotations here and they cancel for ORIENTATION while
     * stacking for EXTENT. The parked hand's root is turned pi so its fan opens
     * downward; the card is turned pi inside it so it reads upright again. The
     * card therefore looks the right way up, and it grows from its grip in the
     * direction a naive reading of the root alone says it should not.
     *
     * Measured rather than reasoned in the end: with the offset subtracted, the
     * grip sat at world y +125 and the card ran from +125 to +374 — entirely
     * above a frame whose top edge is +240. Added, it spans −125 to +125.
     */
    const midY = _v.y + (h * target) / 2;

    switch (reveal.phase) {
      case 'cardPull':
        // Straight up out of the fan, still where it sat horizontally, so the
        // eye can see WHICH card was taken.
        c.x.value = from.x;
        c.y.value = from.y + lift * t;
        c.s.value = lerp(from.s, cfg.hoverScale, t);
        c.a.value = lerp(from.a, 0, t);
        break;
      case 'cardMove':
        c.x.value = lerp(from.x, _v.x, t);
        c.y.value = lerp(from.y + lift, midY, t);
        c.s.value = lerp(cfg.hoverScale, target, t);
        c.a.value = lerp(0, Math.PI, t);
        break;
      case 'cardFlip':
        c.x.value = _v.x;
        c.y.value = midY;
        c.s.value = target;
        c.a.value = Math.PI;
        // Swapped at the crossing, where the quad is edge-on and neither face is
        // visible. Held on the card so `_applyTexture` does the actual upload.
        c.faceUp = reveal.t >= 0.5;
        break;
      case 'cardHold':
      default:
        c.x.value = _v.x;
        c.y.value = midY;
        c.s.value = target;
        c.a.value = Math.PI;
        c.faceUp = true;
        break;
    }

    c.x.vel = 0;
    c.y.vel = 0;
    c.s.vel = 0;
    c.a.vel = 0;
    c.armed = false;
    /** How wide the card is drawn, near zero at the crossing. See `_place`. */
    c.flipWidth =
      reveal.phase === 'cardFlip' ? Math.max(0.02, Math.abs(Math.cos(Math.PI * reveal.t))) : 1;
    // `_forward` reads this to decide the paint order, and a card being turned
    // over has to be in front of everything else in the hand.
    c.homeY = c.y.value - cfg.useLiftFactor * h;
  }

  _fly(c, dt) {
    const cfg = this.config.cards;
    c.flying += dt / Math.max(0.05, cfg.useFlySeconds);
    const k = smoothstep(Math.min(1, c.flying));
    // Straight to the middle of the frame, in this hand's own coordinates.
    _v.set(0, 0, 0);
    this.root.worldToLocal(_v);
    c.x.value = lerp(c.x.value, _v.x, k * 0.35);
    c.y.value = lerp(c.y.value, _v.y, k * 0.35);
    c.s.value = lerp(c.s.value, cfg.hoverScale * 1.25, k * 0.2);
    c.a.value *= 1 - k * 0.2;
  }

  // ── pointer ──────────────────────────────────────────────────────────────

  /** @returns {boolean} whether this hand took the press. */
  beginDrag(card, worldX, worldY) {
    if (!this.live || card.flying > 0) return false;
    _v.set(worldX, worldY, 0);
    this.root.worldToLocal(_v);
    this.dragging = card;
    this.hovered = card;
    card.armed = false;
    this._grab.x = _v.x - card.x.value;
    this._grab.y = _v.y - card.y.value;
    /** Where the gesture started, for deciding what kind of gesture it is. */
    this._dragFrom = { x: _v.x, y: _v.y };
    /** null until the gesture commits to a meaning. See `moveDrag`. */
    this.dragMode = null;
    return true;
  }

  /**
   * ── one gesture, two meanings, decided once ─────────────────────────────
   * A card is dragged both to PLAY it and to REORDER the hand, and the two
   * start identically. So the direction of the first real movement decides
   * which it is, and the decision is LOCKED until release:
   *
   *   mostly upward, and far enough up   -> USE
   *   anything else                      -> SORT
   *
   * Locking is the important half. Deciding per frame would let a card that was
   * being carried left across the fan flick into use mode the moment the hand
   * wobbled upward, which is the one misfire that costs the player a card they
   * did not mean to spend. Once it is a sort it stays a sort however high it
   * goes, and vice versa.
   *
   * `sortDeadzone` is what stops a press with a pixel of jitter in it from
   * being read as anything at all.
   */
  moveDrag(worldX, worldY) {
    const c = this.dragging;
    if (!c) return;
    _v.set(worldX, worldY, 0);
    this.root.worldToLocal(_v);

    const cfg = this.config.cards;
    if (!this.dragMode && this._dragFrom) {
      const dx = _v.x - this._dragFrom.x;
      const dy = _v.y - this._dragFrom.y;
      const dead = Math.max(1, cfg.sortDeadzone);
      if (Math.abs(dx) >= dead || Math.abs(dy) >= dead) {
        this.dragMode = dy > Math.abs(dx) && dy > 0 ? 'use' : 'sort';
      }
    }

    c.x.value = _v.x - this._grab.x;
    c.x.vel = 0;

    if (this.dragMode === 'sort') {
      // Held just clear of the fan rather than followed vertically: a sort is a
      // horizontal gesture, and letting it rise would take it toward the use
      // threshold it has already been decided not to cross.
      c.y.value += (c.homeY + cfg.sortLift - c.y.value) * 0.4;
      c.y.vel = 0;
      this._updateSort(c);
      return;
    }

    c.y.value = _v.y - this._grab.y;
    c.y.vel = 0;
  }

  /**
   * Put the dragged card in whichever slot the pointer is nearest.
   *
   * ── the reorder is applied to the STATE, live ───────────────────────────
   * Not previewed here and committed on release. The hand's order lives in
   * `CardHands` now, so telling it straight away means the next sync reorders
   * this fan and every OTHER card springs to its new slot — which is exactly
   * the "others open a gap in real time" the brief asks for, for free, out of
   * the springs that are already there. A view-local preview would be a second
   * copy of the order that could disagree with the real one.
   */
  _updateSort(c) {
    if (!this.onReorder) return;
    const from = this.cards.indexOf(c);
    if (from < 0) return;
    const t = this._targets();
    let best = from;
    let bestD = Infinity;
    for (let i = 0; i < this.cards.length; i++) {
      if (this.cards[i].flying > 0 || !t[i]) continue;
      const d = Math.abs(t[i].x - c.x.value);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best !== from) this.onReorder(this.player, from, best);
  }

  /**
   * Let go.
   *
   * @returns {{cardId: string}|null} the card that was played, or null
   */
  endDrag(cancelled) {
    const c = this.dragging;
    const mode = this.dragMode;
    this.dragging = null;
    this.dragMode = null;
    this._dragFrom = null;
    if (!c) return null;

    // A sort is never a play, however it ended. The new order is already in the
    // state — applied as the pointer crossed each slot — so letting go simply
    // hands the card back to the springs, which settle it into the gap the rest
    // of the fan has been holding open.
    if (mode === 'sort') {
      c.armed = false;
      return null;
    }

    if (!cancelled && c.blocked) {
      // Dragged all the way and refused. The shake is the whole of the feedback
      // and it has to happen HERE rather than at the threshold, because a card
      // that shook while you were still holding it would read as a warning you
      // could push past.
      const h = this.config.cards.width * CARD_ASPECT;
      if (c.y.value - c.homeY >= this.config.cards.useLiftFactor * h) c.shake = 1;
      c.armed = false;
      return null;
    }
    if (cancelled || !c.armed) {
      // Straight back to the springs, which overshoot on the way home.
      c.armed = false;
      return null;
    }
    // Reported the moment it is released, not when the fly-out lands: the effect
    // and its animation should start together, and the card's flight to the
    // middle of the screen is part of that animation rather than a preamble.
    c.flying = 0.0001;
    this.hovered = null;
    return { cardId: c.data.cardId };
  }

  /**
   * The box the whole hand occupies, in frame coordinates.
   *
   * ── it is what keeps the hand UP ────────────────────────────────────────
   * Raising on "a card is under the pointer" alone is unstable, because raising
   * MOVES the cards: the fan parts around whichever card is hovered, and during
   * that rearrangement the pointer can be over nothing for a frame or two. The
   * hand then drops, and once it is down the pointer is far above the tucked
   * strip and it can never come back — the hand simply stops responding until
   * you go all the way to the bottom of the screen again.
   *
   * So the hand stays up while the pointer is anywhere in this box, and only the
   * first raise needs an actual card under the pointer. Generous on purpose: the
   * cost of being too big is that the hand lingers, and the cost of being too
   * small is that it becomes unusable.
   */
  /**
   * 부채꼴의 반폭, `root.scale` 이전의 로컬 단위로.
   *
   * `bounds()` 와 `_layout` 이 둘 다 필요로 한다. 후자는 이 값으로 손 전체가 프레임
   * 밖으로 나가지 않게 배율을 조인다 — 그래서 이 계산은 배율을 **참조하면 안 된다**.
   * 참조하면 배율이 자기 자신에 의존하게 된다.
   */
  _halfSpan() {
    const cfg = this.config.cards;
    let halfSpan = cfg.width / 2;
    for (const c of this.cards) {
      halfSpan = Math.max(halfSpan, Math.abs(c.x.value) + (cfg.width * c.s.value) / 2);
    }
    return halfSpan;
  }

  bounds() {
    const cfg = this.config.cards;
    const s = this.root.scale.x;
    const h = cfg.width * CARD_ASPECT;
    const halfSpan = this._halfSpan();
    const pad = cfg.hitMargin * 2;
    const top = this.root.position.y + (h * cfg.hoverScale + Math.max(0, cfg.hoverLift)) * s;
    return {
      minX: -halfSpan * s - pad,
      maxX: halfSpan * s + pad,
      minY: -this.frame.height,
      maxY: top + pad,
    };
  }

  /** Every card that can currently be pressed, for the raycast. */
  hitQuads(out) {
    if (!this.live) return out;
    for (const c of this.cards) if (c.flying <= 0) out.push(c.hit);
    return out;
  }

  cardForHit(object) {
    return this.cards.find((c) => c.hit === object) ?? null;
  }

  dispose() {
    for (const c of this.cards) this._destroy(c);
    this.cards.length = 0;
    // 카드가 아니라 손의 것이라 위 루프가 잡지 못한다. 재질 자체는
    // `CardMaterials.dispose` 가 추적해 두고 있지만, 메시는 여기서 떼야 한다.
    this.root.remove(this._glow);
    this._glow.material.dispose();
  }
}

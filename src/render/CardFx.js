import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
  Vector3,
} from 'three';
import { CapSwap } from '../game/cards/CapSwap.js';
import { FxMaterials } from './FxMaterial.js';
import {
  auraTexture,
  braceTexture,
  dashTexture,
  flashTexture,
  flatTexture,
  frameTexture,
  ringTexture,
  scanTexture,
  stunSheet,
} from './fxTextures.js';
import { PALETTE } from '../core/palette.js';

/**
 * What a card LOOKS like happening.
 *
 * ── two roots, one pipeline ─────────────────────────────────────────────────
 * `world` goes into the game scene and is drawn with the perspective camera:
 * stun stars over caps, rings at the ends of a swap, the line between them.
 * `screen` goes into the CARD scene and is drawn with its orthographic camera:
 * the scanline sweep and the edge flash, which are about the frame rather than
 * about the pitch.
 *
 * ── 그래서 둘은 서로 다른 파이프라인을 받는다 ─────────────────────────────
 * 이 자리에는 "둘 다 같은 저해상도 렌더 타겟에 들어가 레트로 패스 이전에 그려지므로
 * 스턴 별이 잔디와 똑같은 디더 격자와 채널당 5비트를 받는다"고 적혀 있었다. 그
 * 파이프라인은 없다. 저해상도 타겟도, 디더도, 양자화도 남아 있지 않다.
 *
 * 지금 사실인 것은 이렇다. `world` 는 게임 씬이므로 **블룸을 받는다** — 가산으로
 * 그려지는 별과 링은 브라이트 패스가 찾는 바로 그 입력이라, 판 위에서 실제로
 * 빛난다. `screen` 은 카드 씬이므로 **받지 않는다**: 카드 씬은 블룸 밖이고
 * (`CardLayer` 헤더에 이유가 있다), 전폭 효과에 블룸이 걸리면 번지는 것이 효과가
 * 아니라 화면 전체다.
 *
 * 이 갈림은 우연이 아니라 각 효과가 무엇에 관한 것이냐를 따른다. 뚜껑 위의 표시는
 * 판 위의 물건이고, 프레임을 쓸고 지나가는 띠는 그림에 일어나는 일이다.
 *
 * ── it runs on the render clock and writes nothing back ─────────────────────
 * Every number in this file is derived from wall-clock seconds and from state it
 * only reads. Nothing here is in the state hash, nothing here can change a shot,
 * and the cap "shake" is a mesh offset applied after the physics transform has
 * been written — the body does not move, the drawing of it does.
 *
 * ── 무엇으로 만들어도 되고, 무엇으로는 안 되는가 ────────────────────────────
 * 이 목록의 예전 근거는 "시대의 기법만"이었다 — 빌보드 알파 스프라이트, 가산
 * 블렌딩, 스텝 스프라이트 시트, 팔레트 사이클, UV 스크롤, 전폭 1회 스윕. 그 근거는
 * 폐기됐다. 하지만 목록을 그냥 지우면 안 된다. 예전 주석이 스스로 밝힌 이유가
 * 그대로 남아 있기 때문이다 — "전부 존재하고 전부 한 줄이면 되기 때문에, 이 규칙은
 * 취향에 맡기지 않고 적어 둬야 한다." 지우기만 하면 다섯 카드 전부에 파티클이 붙는다.
 *
 * 그래서 근거를 새로 적는다.
 *
 *   허용                          왜
 *   빌보드 스프라이트, 가산       싸고, 겹쳐도 정렬 문제가 없다. 판 위에서 블룸을
 *                                 받으므로 세기를 낮춰도 빛으로 읽힌다
 *   부드러운 방사 그라디언트      팔레트가 밝아져 밴딩이 없다. `fxTextures` 의 링과
 *                                 오라가 이미 그렇게 다시 그려져 있다
 *   스프라이트 시트               한 텍스처, 유니폼 하나로 프레임을 고른다
 *   팔레트 사이클                 **서로 다른 주기가 정보다** — 아래를 보라
 *   UV 스크롤                     정점 하나 움직이지 않고 흐른다
 *   전폭 1회 스윕                 프레임에 일어나는 일을 프레임으로 말한다
 *
 *   금지                          왜
 *   파티클 시스템                 다섯 효과 × 수백 파티클은 모바일 예산 밖이다.
 *                                 `budget` 의 `sat` 이 0 이어야 한다
 *   블러 패스                     카드 씬은 블룸 밖이고, 두 번째 흐림 체인을 세울
 *                                 이유가 없다. 흐림이 필요하면 텍스처에 굽는다
 *   전폭 효과의 블룸              화면 전체가 번진다. `screen` 이 카드 씬인 이유다
 *   지속 효과의 부드러운 페이드   오라와 별은 **상태 표시**다. 페이드는 그 상태가
 *                                 끝나가는 중이라고 말하는데, 상태는 끝나가지 않는다
 *   화면 흔들림 증가              v2 §25
 *
 * ── 스텝은 남기는 것과 없애는 것이 갈린다 ──────────────────────────────────
 * 여기 있는 양자화는 거의 전부 "시대의 기법"에서 나왔으므로 전부 재검토 대상이지만,
 * 전부 없애는 것은 틀린 답이다. 기준은 하나다 — **스텝이 기계적 성격을 표현하면
 * 남기고, 해상도 한계를 흉내 내는 것이면 없앤다.**
 *
 *   남는다   혼란 별의 궤도와 프레임(둘이 **같이** 스텝해야 한다. 따로 놀면
 *            스프라이트가 모션에 뒤처져 보인다), 강타의 수축 링(부드러운 수축은
 *            트윈이고 스텝은 기계가 장전되는 것이다), 원모어의 프레임 2박자와
 *            침묵 해제의 2박자(두 번 치는 것이 정보다), 침묵의 도장(일격이다)
 *   없앴다   팔레트 사이클의 하드 스텝(CLUT 흉내였다), 뚜껑의 답례 펄스 둘
 *            (강타·원모어. 힘이 도착하는 것은 기계가 아니라 몸이다), 원모어의
 *            뚜껑 섬광(대신 짧아졌다)
 */

/** Unit quad, centred. Billboards are placed by their middles. */
const QUAD = new PlaneGeometry(1, 1);

/**
 * The chaos palette. Walked through smoothly, on its own period.
 *
 * ── 스텝이 없어진 것은 흉내 낼 하드웨어가 없기 때문이다 ────────────────────
 * 항목 사이를 딱딱 건너뛰었고, 근거는 CLUT 로테이션의 흉내였다. 그 근거가 사라진
 * 뒤에 남는 것은 색이 튀는 별 하나뿐이고, 튀는 것 자체는 아무것도 말하지 않는다 —
 * 혼란은 뚜껑이 **계속** 걸고 있는 상태라, 그 표시는 도는 것이지 깜빡이는 것이
 * 아니다.
 *
 * 사라지지 않은 것은 **길이**다. 다섯 항목인 것은 강타의 넷, 침묵의 셋과 서로
 * 소이기 위해서고, 그건 두 카드를 동시에 건 뚜껑에서 두 표시가 한 박자로 보이지
 * 않게 하는 장치다. 길이를 바꾸더라도 서로 소를 유지하라.
 *
 * Cool-to-warm rather than a hue sweep, because a full rainbow reads as a modern
 * shader effect no matter how few steps it has.
 */
const CHAOS_PALETTE = [
  [1.0, 1.0, 1.0],
  [0.72, 0.86, 1.0],
  [0.78, 0.62, 1.0],
  [1.0, 0.74, 0.92],
  [0.72, 0.86, 1.0],
];

/**
 * The 강타 palette. Hotter, and shorter than the chaos one.
 *
 * Four entries against chaos's five, so the two cycles never line up even when
 * both are on screen — an armed cap under 혼란 has both a star and an aura, and
 * two markers pulsing in unison would read as one effect.
 *
 * 이쪽도 부드럽게 걷는다. 오라는 한 턴 내내 깔려 있는 **상태 표시**고, 상태 표시가
 * 딱딱 색을 갈면 무언가가 방금 일어난 것으로 읽힌다.
 */
const SMASH_PALETTE = [
  [1.0, 0.94, 0.78],
  [1.0, 0.62, 0.26],
  [1.0, 0.36, 0.14],
  [1.0, 0.72, 0.40],
];

/**
 * 철벽의 팔레트. 일곱 항목이고, 그 길이가 요점이다.
 *
 * ── 주기가 서로 소여야 하는 이유 ────────────────────────────────────────────
 * 혼란 다섯, 강타 넷, 침묵 셋. 한 뚜껑이 강타와 철벽을 동시에 걸 수 있고 — 내
 * 뚜껑에 강타를 장전한 채 상대 턴을 맞으면 그렇게 된다 — 두 표시가 한 박자로
 * 돌면 그건 두 카드가 아니라 하나로 읽힌다. 일곱은 3·4·5 어느 것과도 서로 소이므로
 * 세 표시가 다 겹쳐도 105 주기가 지나야 한 번 만난다.
 *
 * ── 그리고 아주 느리게 걷는다 ───────────────────────────────────────────────
 * `resistPaletteCyclesPerSecond` 는 강타의 2.2 에 대해 0.55 다. 강타의 오라는
 * 맥동한다 — 장전된 것이니까. 철벽은 **움직이지 않는 상태**이고, 맥동하는 단단함은
 * 자기모순이다. 그래도 완전히 정지시키지 않은 것은, 아무것도 변하지 않는 스프라이트는
 * 판에 인쇄된 무늬로 보이기 때문이다. 눈에 띄지 않을 만큼만 걷는다.
 *
 * 값의 폭이 좁은 것도 같은 이유다: 혼란의 팔레트는 흰색에서 분홍까지 가고, 이것은
 * 강철빛 안에서만 움직인다. 밝기가 아니라 온도가 조금 바뀐다.
 */
const RESIST_PALETTE = [
  [0.70, 0.84, 0.96],
  [0.62, 0.79, 0.94],
  [0.58, 0.74, 0.92],
  [0.66, 0.81, 0.95],
  [0.60, 0.77, 0.93],
  [0.72, 0.86, 0.97],
  [0.64, 0.80, 0.94],
];

const ONEMORE_TINT = [1.0, 0.86, 0.42];

const SWAP_TINT = [0.72, 0.9, 1.0];
const SWAP_LINE_COLOR = PALETTE.fx.swapLine;

/** Rings drawn at both ends of every swapped pair. */
const MAX_SWAP_RINGS = 32;

/** Scratch. 오라와 링이 같은 색을 받으므로 프레임마다 한 번만 푼다. */
const _tint = new Vector3();
/** 철벽의 것. `_tint` 와 따로인 것은 두 효과가 같은 프레임에 뜨기 때문이다. */
const _braceTint = new Vector3();

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/**
 * 팔레트를 한 바퀴 걷는다. 이웃한 두 항목 사이를 보간해서.
 *
 * 목록의 길이가 곧 주기이고, 그 길이들이 서로 소인 것이 이 파일의 장치다 —
 * `CHAOS_PALETTE` 의 주석을 보라. 보간은 그 위상 관계를 바꾸지 않는다: 같은 속도로
 * 같은 순환을 도는데 사이가 이어져 있을 뿐이다.
 *
 * `%` 뒤에 한 번 더 `+ n` 을 거치는 것은 음수 방어가 아니라 습관이다 — `_now` 는
 * 단조 증가라 음수가 될 수 없지만, 이 함수가 다른 시계에 붙는 날 조용히 틀리는
 * 대신 조용히 맞기를 바란다.
 *
 * @param {number[][]} list  RGB 0..1 셋의 목록
 * @param {number} now       seconds
 * @param {number} rate      cycles per second, over the WHOLE list
 * @param {import('three').Vector3} out
 */
function cyclePalette(list, now, rate, out) {
  const n = list.length;
  const at = (((now * rate * n) % n) + n) % n;
  const i = Math.floor(at);
  const a = list[i];
  const b = list[(i + 1) % n];
  const t = smoothstep(at - i);
  return out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}

export class CardFx {
  /**
   * @param {typeof import('../game/config.js').CONFIG} config
   * @param {import('three').Vector2} resolution
   * @param {{width: number, height: number}} frame  the card scene's layout box
   */
  constructor({ config, resolution, frame }) {
    this.config = config;
    this.frame = frame;

    this.materials = new FxMaterials({ resolution });
    this.world = new Group();
    this.screen = new Group();

    /** Seconds of wall clock since boot. Drives every orbit and every cycle. */
    this._now = 0;
    /** A one-shot effect in progress: {cardId, player, t}. */
    this._burst = null;
    /** Set by `play` when the panel asks for an effect with no game behind it. */
    this._demo = null;

    this.arena = null;
    /**
     * Live caps per player, rebuilt every frame. See `_aliveOwnedCaps`.
     *
     * Initialised here because `capVisual` is called from `ArenaView` and there
     * is no ordering guarantee that the first `update` has run before the first
     * frame is drawn — an undefined set would throw rather than simply not mark.
     */
    this._aliveOwned = [new Set(), new Set()];
    this.chaosCaps = [];
    /** Which caps are standing on a boosted shot. Empty when nobody is. */
    this.smashCaps = [];
    /** Frames of flash still owed. Counted DOWN in frames, not seconds. */
    this._flashLeft = 0;
    /** Whether a smash burst was running last frame. The leading edge arms it. */
    this._wasSmashing = false;
    /** Frames of darkening still owed, and the same leading-edge latch. */
    this._darkenLeft = 0;
    this._wasSealing = false;

    /** Which caps are braced. Empty when nobody is. */
    this.resistCaps = [];
    /**
     * The cast's three beats, counted DOWN in frames. See `_updateResist`.
     *
     * Frames rather than a fraction of `burst.t`, for the reason
     * `smashFlashFrames` is: at two or three frames a window measured in seconds
     * lands on a different number of them at 60 Hz and at 120, which is the
     * difference between a beat and nothing.
     */
    this._braceLeft = 0;
    this._wasBracing = false;
    /**
     * Frames of white flash owed PER CAP, when a braced cap takes a hit.
     *
     * Per cap because the caps are hit separately, and this is the one marker in
     * the file that answers an event on a particular body rather than a state
     * the whole side is in.
     */
    this._hitLeft = [];

    this._buildStun();
    this._buildSwap();
    this._buildFlash();
    this._buildSmash();
    this._buildScreen();
    this._buildSeal();
    this._buildResist();
  }

  setResolution(resolution) {
    this.materials.setResolution(resolution);
  }

  /** A rebuild changed the cap count. Sprites are pooled to the new maximum. */
  setArena(arena) {
    this.arena = arena;
    this._ensureStun(arena?.capCount ?? 0);
    this._ensureFlash(arena?.capCount ?? 0);
    this._ensureSmash(arena?.capCount ?? 0);
    this._ensureResist(arena?.capCount ?? 0);
  }

  // ── construction ─────────────────────────────────────────────────────────

  _buildStun() {
    this.stunGroup = new Group();
    this.world.add(this.stunGroup);
    /** @type {Array<{mesh: Mesh, mat: object}>} */
    this.stun = [];
    this._stunFrames = 0;
  }

  _stunTexture() {
    const cfg = this.config.cardFx;
    return stunSheet(cfg.stunFrames, cfg.stunTexels);
  }

  _ensureStun(n) {
    while (this.stun.length < n) {
      const mat = this.materials.create(this._stunTexture());
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      mesh.renderOrder = 20;
      this.stunGroup.add(mesh);
      this.stun.push({ mesh, mat });
    }
    for (let i = n; i < this.stun.length; i++) this.stun[i].mesh.visible = false;
  }

  _buildSwap() {
    this.swapGroup = new Group();
    this.world.add(this.swapGroup);
    this.rings = [];
    const tex = ringTexture(this.config.cardFx.ringTexels);
    for (let i = 0; i < MAX_SWAP_RINGS; i++) {
      const mat = this.materials.create(tex);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      mesh.renderOrder = 18;
      this.swapGroup.add(mesh);
      this.rings.push({ mesh, mat });
    }

    // The path between a swapped pair. Lines, like the aim overlay's, because
    // the one thing this has to do is say WHICH cap is going WHERE and a line is
    // the cheapest unambiguous way to say it.
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(MAX_SWAP_RINGS * 6), 3));
    this.swapLineGeo = geo;
    this.swapLineMat = new LineBasicMaterial({
      color: SWAP_LINE_COLOR,
      fog: false,
      transparent: true,
      opacity: 1,
      depthTest: false,
    });
    this.swapLines = new LineSegments(geo, this.swapLineMat);
    this.swapLines.frustumCulled = false;
    this.swapLines.renderOrder = 17;
    this.swapLines.visible = false;
    this.swapGroup.add(this.swapLines);
  }

  _buildFlash() {
    this.flashGroup = new Group();
    this.world.add(this.flashGroup);
    this.flashes = [];
  }

  _ensureFlash(n) {
    const tex = flashTexture(this.config.cardFx.ringTexels);
    while (this.flashes.length < n) {
      const mat = this.materials.create(tex);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      mesh.renderOrder = 19;
      this.flashGroup.add(mesh);
      this.flashes.push({ mesh, mat });
    }
    for (let i = n; i < this.flashes.length; i++) this.flashes[i].mesh.visible = false;
  }

  /**
   * 강타's two per-cap sprites: the ring that closes, and the aura that stays.
   *
   * Two pools rather than one, because they are on screen at different times and
   * for different reasons — the ring is a quarter-second event, the aura holds
   * until the shot — and sharing one would mean a mesh whose meaning changed
   * halfway through its own life.
   */
  _buildSmash() {
    this.smashGroup = new Group();
    this.world.add(this.smashGroup);
    /** @type {Array<{mesh: Mesh, mat: object}>} */
    this.smashRings = [];
    /** @type {Array<{mesh: Mesh, mat: object}>} */
    this.auras = [];
  }

  _ensureSmash(n) {
    const ring = ringTexture(this.config.cardFx.ringTexels);
    const aura = auraTexture(this.config.cardFx.ringTexels);
    while (this.smashRings.length < n) {
      const mat = this.materials.create(ring);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      mesh.renderOrder = 19;
      this.smashGroup.add(mesh);
      this.smashRings.push({ mesh, mat });
    }
    while (this.auras.length < n) {
      const mat = this.materials.create(aura);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      // Under the ring and under the stars: it is the quietest of the three and
      // the only one that is always there.
      mesh.renderOrder = 16;
      this.smashGroup.add(mesh);
      this.auras.push({ mesh, mat });
    }
    for (let i = n; i < this.smashRings.length; i++) this.smashRings[i].mesh.visible = false;
    for (let i = n; i < this.auras.length; i++) this.auras[i].mesh.visible = false;
  }

  /**
   * 철벽's one sprite per cap, and there is deliberately only one.
   *
   * 강타 has two — a ring that closes and an aura that stays — because it has
   * two things to say: force gathering, then force held. 철벽 has one thing to
   * say and says it in one shape, which matters more here than it does there:
   * this marker appears on THREE OR FOUR CAPS AT ONCE, and two sprites apiece
   * would be eight objects on a board the player is trying to aim across.
   */
  _buildResist() {
    this.resistGroup = new Group();
    this.world.add(this.resistGroup);
    /** @type {Array<{mesh: Mesh, mat: object}>} */
    this.braces = [];
  }

  _ensureResist(n) {
    const tex = braceTexture(this.config.cardFx.resistRingSides, this.config.cardFx.ringTexels);
    while (this.braces.length < n) {
      const mat = this.materials.create(tex);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      // Under 강타's aura, which is at 16. A cap can carry both — armed with 강타
      // and then braced when the opponent's turn opens — and the brace is the
      // quieter of the two, so it goes below rather than over.
      mesh.renderOrder = 15;
      this.resistGroup.add(mesh);
      this.braces.push({ mesh, mat });
    }
    for (let i = n; i < this.braces.length; i++) this.braces[i].mesh.visible = false;
    if (this._hitLeft.length !== n) this._hitLeft = new Array(n).fill(0);
  }

  /**
   * The two full-frame effects.
   *
   * In the card scene rather than the world, because they are about the SCREEN:
   * a scanline sweep that followed the pitch as the camera turned would be a
   * thing in the world rather than a thing happening to the picture.
   */
  _buildScreen() {
    this.scanMat = this.materials.create(scanTexture(this.config.cardFx.scanTexels));
    this.scan = new Mesh(QUAD, this.scanMat);
    this.scan.visible = false;
    this.scan.renderOrder = 1000;
    this.screen.add(this.scan);

    this.frameMat = this.materials.create(frameTexture());
    this.frameQuad = new Mesh(QUAD, this.frameMat);
    this.frameQuad.scale.set(this.frame.width, this.frame.height, 1);
    this.frameQuad.visible = false;
    this.frameQuad.renderOrder = 1001;
    this.screen.add(this.frameQuad);

    /**
     * 강타의 섬광. 카드까지 포함해 모든 것 위에.
     *
     * 그림의 어느 부분이라도 빠지면 섬광이 아니라 렌더링 오류로 보이므로, 이것은
     * 언제나 프레임 전체다.
     *
     * ── 색 반전에서 흰 섬광으로 ─────────────────────────────────────────────
     * `createInvert` 였다 — `src * (1 - dst)`. 화면이 거의 검던 시절에는 훌륭했다:
     * 어두운 판이 순간 밝아지니 번쩍인다.
     *
     * 지금 팔레트는 반대다. 나무판도 유리 카드도 하늘도 밝아서, 반전하면 화면이
     * **어두워진다** — 번쩍임이 아니라 정전이다. 승리 화면의 충격 섬광이 같은
     * 이유로 같은 수정을 받았고(`VictoryLayer.flash`), 이것이 그 나머지 절반이다.
     *
     * 흰 quad 는 어느 팔레트에서나 같은 방향으로 작동한다. 세기가 1 이 아닌 것은
     * 완전히 흰 프레임이 판 위의 뚜껑을 지워 버리기 때문이다 — §0.4 는 효과가
     * 도는 동안에도 무엇이 어디 있는지 읽혀야 한다고 요구한다.
     */
    this.flashMat = this.materials.create(flatTexture());
    this.flashMat.uniforms.uTint.value.set(1, 1, 1);
    this.flashQuad = new Mesh(QUAD, this.flashMat);
    this.flashQuad.scale.set(this.frame.width, this.frame.height, 1);
    this.flashQuad.visible = false;
    this.flashQuad.renderOrder = 1002;
    this.screen.add(this.flashQuad);
  }

  /**
   * 침묵's cast, which is one flash of darkness and nothing else.
   *
   * ── it used to reach, and the reach had to go ───────────────────────────────
   * There was a dark bolt that grew from the caster's hand to the victim's and
   * stamped a padlock where it landed. It read as smoke drifting across the
   * pitch — a soft, drifting thing on a board where nothing else drifts — and it
   * spent half a second saying what the padlock on the victim's own turn says
   * better and at the moment it actually matters.
   *
   * What is left is the one part that was never the problem: `dst - src` over
   * the whole frame for a frame or two. It is the mirror of 강타's inversion,
   * it is over before the eye resolves it, and it is the only thing on screen
   * that has to happen at CAST time — the seal itself is a thing the victim
   * meets on their own turn, and `CardLayer` draws it there.
   *
   * ── nothing here goes near a cap, and that is still the card ────────────────
   * 혼란 puts stars over the caps because it twists a SHOT. 침묵 does not touch a
   * shot: it seals a HAND. An effect on the caps would send the player to look
   * at the board for a change that is not there.
   */
  _buildSeal() {
    // Over everything, including the cards — a darkening that the hand escaped
    // would read as the hand being lit rather than as the frame being dimmed.
    this.sealDarkenMat = this.materials.createDarken(flatTexture());
    this.sealDarken = new Mesh(QUAD, this.sealDarkenMat);
    this.sealDarken.scale.set(this.frame.width, this.frame.height, 1);
    this.sealDarken.visible = false;
    this.sealDarken.renderOrder = 1003;
    this.screen.add(this.sealDarken);
  }

  /**
   * The cast flash: counted in FRAMES, armed on the leading edge.
   *
   * Identical bookkeeping to 강타's inversion, and identical reasoning: a window
   * measured in seconds lands on a different number of frames at a different
   * refresh rate, and at one or two frames that is the difference between a hit
   * and nothing at all. `Match.cardFx` builds a fresh object every frame, so the
   * latch is a BOOLEAN transition rather than an identity test on the burst.
   *
   * The texture is re-fetched every frame rather than on a change. It is a cache
   * hit — one map lookup — and it is the only thing that survives the panel's
   * stun sliders emptying the whole texture cache out from under a material that
   * is still pointing into it. A freed texture is not an error; it just draws
   * nothing, silently.
   */
  _updateSeal() {
    const cfg = this.config.cardFx;
    this.sealDarkenMat.uniforms.uMap.value = flatTexture();

    const sealing = this._burst?.cardId === 'silence';
    if (sealing && !this._wasSealing) {
      this._darkenLeft = Math.max(0, Math.round(cfg.sealDarkenFrames));
    }
    this._wasSealing = sealing;
    this.sealDarken.visible = this._darkenLeft > 0;
    if (this._darkenLeft > 0) {
      this.sealDarkenMat.uniforms.uOpacity.value = Math.max(0, Math.min(1, cfg.sealDarkenStrength));
      this._darkenLeft--;
    }
  }

  // ── the trajectory line's flow ───────────────────────────────────────────

  /**
   * The dash texture the aim overlay's path line borrows while the card is on.
   *
   * Handed out rather than applied here so there is still exactly one path line
   * in the scene — two would be two things to keep in step.
   */
  get dashTexture() {
    return dashTexture(this.config.cardFx.dashLength);
  }

  // ── per frame ────────────────────────────────────────────────────────────

  /**
   * @param {number} dt      render seconds
   * @param {import('../game/Match.js').Match} match
   * @param {import('three').Camera} camera  for billboarding
   */
  update({ dt, match, camera, struck }) {
    this._now += dt;

    // The match's own effect wins; the panel's demo fills in when there is none.
    const live = match?.cardFx ?? null;
    if (live) {
      this._burst = live;
      this._demo = null;
    } else if (this._demo) {
      this._demo.elapsed += dt;
      const s = Math.max(0.05, this._demo.seconds);
      this._burst = {
        cardId: this._demo.cardId,
        player: this._demo.player,
        t: Math.min(1, this._demo.elapsed / s),
      };
      if (this._demo.elapsed >= s) this._demo = null;
    } else {
      this._burst = null;
    }

    /**
     * FIRST, because everything below marks caps and every one of them has to
     * agree about which caps are still there. See `_aliveOwnedCaps`.
     *
     * It is also what `capVisual` reads, and that call comes from `ArenaView`
     * later in the same frame rather than from here — so this has to be built
     * on the frame's own state before anything can ask.
     */
    this._aliveOwned = this._aliveOwnedCaps(match);

    this.chaosCaps = this._chaosCaps(match);
    this.smashCaps = this._smashCaps(match);
    this.resistCaps = this._resistCaps(match);
    this._updateStun(camera);
    this._updateSwap(match, camera);
    this._updateFlash(match, camera);
    this._updateSmash(camera);
    this._updateResist(camera, struck);
    this._updateScreen();
    // After `_updateScreen`, which owns the other two full-frame effects. The
    // order is only bookkeeping — they cannot be on at once — but keeping the
    // frame-counted latches next to each other is what stops the second one
    // being written as a timer by somebody reading only half the file.
    this._updateSeal();
  }

  /**
   * A cap that is still on the board.
   *
   * ── dead caps were getting the effects ──────────────────────────────────
   * Both pickers below asked only who OWNS a cap, never whether it is still in
   * play. `ArenaView` hides a cap that has fallen, so the cap itself vanished —
   * but the aura, the ring and the palette flash are drawn by this file at the
   * cap's last transform, and they carried on burning at the bottom of the
   * board over nothing. Reported against 강타; 혼란 had it too, and the note on
   * `_smashCaps` says the two must answer alike, so both are fixed here rather
   * than one of them being patched.
   *
   * `rules.alive` is the same array `ArenaView.update` is handed to decide what
   * to draw, so the effect and the cap it belongs to now agree by construction.
   */
  _isAlive(match, i) {
    const alive = match?.rules?.alive;
    return !alive || alive[i] !== false;
  }

  /**
   * The caps a player still has ON THE BOARD. One answer, asked once a frame.
   *
   * ── "is it theirs" and "is it still there" are one question, not two ────────
   * Five places in this file mark a cap because of who owns it: the stun stars,
   * 강타's standing aura, 강타's closing ring, 원모어's flash, and the two pulses
   * in `capVisual`. Every one of them wants the owner's LIVE caps, and for a
   * long time only the first two said so — the pickers were given an `_isAlive`
   * test and the burst-driven loops were left asking `capOwner` alone.
   *
   * That is not a small inconsistency, it is a reported bug and it was reported
   * twice: the aura was fixed for it once, and 강타's ring kept doing the same
   * thing on the same caps, because a second copy of the rule was never written.
   * Measured on a knockout board with two caps eliminated: `smashCaps` was `[2]`
   * and the rings were drawn on `[0, 1, 2]` — two of them burning on the bodies.
   *
   * So there is now one set, built once in `update`, and every marker reads it.
   * A sixth effect that marks a cap gets the rule by using the set, and the way
   * to get it wrong is to write a new loop over `capOwner` — which is now the
   * only thing in this file that would look out of place.
   *
   * A Set rather than an array: these are membership tests inside per-cap loops,
   * and `capVisual` is called once per cap per frame from `ArenaView`.
   *
   * @returns {Set<number>[]} indexed by player
   */
  _aliveOwnedCaps(match) {
    const arena = this.arena;
    const out = [new Set(), new Set()];
    if (!arena) return out;
    for (let i = 0; i < arena.capCount; i++) {
      if (this._isAlive(match, i)) out[arena.capOwner[i]]?.add(i);
    }
    return out;
  }

  /** Whether `index` is a live cap of `player`'s. The one test every marker uses. */
  _marks(player, index) {
    return !!this._aliveOwned?.[player]?.has(index);
  }

  /**
   * Which caps are currently under chaos. Empty when nobody is.
   *
   * Asks `chaosOn(owner)` rather than reading the record's shape. It used to
   * compare against a single `chaos.victim`, which could only ever mark one
   * player's caps — and chaos is a slot per victim now, so BOTH sides can be
   * carrying it at once and both sets of caps have to show the stars.
   */
  _chaosCaps(match) {
    const cards = match?.cards;
    const arena = this.arena;
    if (!cards || !arena) return [];
    const out = [];
    for (let i = 0; i < arena.capCount; i++) {
      if (cards.chaosOn(arena.capOwner[i]) && this._isAlive(match, i)) out.push(i);
    }
    return out;
  }

  /**
   * Which caps are standing on a boosted shot.
   *
   * ALL of the armed player's, not the one currently offered. The boost is on
   * the player's next shot and any of their caps can be the one that takes it —
   * marking a single cap would be a promise about which one, and the player
   * would find it broken the moment they pressed a different one.
   *
   * Same shape as `_chaosCaps`, deliberately: two effects that answer the same
   * kind of question should not answer it two different ways.
   */
  _smashCaps(match) {
    const smash = match?.cards?.smash;
    if (!smash) return [];
    return [...(this._aliveOwned[smash.player] ?? [])];
  }

  /**
   * Which caps are braced.
   *
   * ── it asks the CARD, not the world ────────────────────────────────────────
   * The obvious source is `arena.capMassMul(i) > 1`, which is the thing that is
   * actually true of the body. It is the wrong source, because §2-A applies the
   * mass only for the OPPONENT's turn — so on the turn the card is played the
   * caps would carry no marker at all, and the player would spend a card and see
   * nothing happen. What the marker means is "this is armed", which is exactly
   * what 강타's aura means on the turn IT is played, and `smashOn` is what that
   * one asks.
   *
   * Same shape as `_smashCaps` and `_chaosCaps`, deliberately: three effects
   * that answer the same kind of question should not answer it three ways.
   */
  _resistCaps(match) {
    const cards = match?.cards;
    const arena = this.arena;
    if (!cards || !arena) return [];
    const out = [];
    for (let p = 0; p < 2; p++) {
      if (cards.resistOn(p)) out.push(...(this._aliveOwned[p] ?? []));
    }
    return out;
  }

  /**
   * The stun stars: one per afflicted cap, orbiting above it.
   *
   * The orbit angle and the sprite frame step TOGETHER and in the same number of
   * steps, so the star arrives at each of its positions in the pose it was drawn
   * for. Advancing the position smoothly and the frame in steps — which is what
   * happens if you forget — looks like the sprite is lagging the motion.
   */
  _updateStun(camera) {
    const cfg = this.config.cardFx;
    const frames = Math.max(1, Math.round(cfg.stunFrames));
    // Keyed on the texel count as well as the frame count. The panel's texture
    // slider clears the cache, and a material still pointing at the disposed
    // texture draws nothing — silently, since a freed texture is not an error.
    const key = `${frames}:${cfg.stunTexels}`;
    if (key !== this._stunKey) {
      this._stunKey = key;
      this._stunFrames = frames;
      const tex = this._stunTexture();
      for (const s of this.stun) s.mat.uniforms.uMap.value = tex;
    }

    const active = new Set(this.chaosCaps);
    for (let i = 0; i < this.stun.length; i++) {
      const s = this.stun[i];
      if (!active.has(i) || !this.arena) {
        s.mesh.visible = false;
        continue;
      }
      const com = this.arena.capCom(i);

      // Stepped: `floor`, not the raw angle. This is the whole look.
      const turns = this._now * cfg.stunRotationsPerSecond;
      // A per-cap phase so four caps are not one rigid constellation.
      const step = Math.floor(turns * frames + i * 1.7);
      const angle = (step / frames) * Math.PI * 2;

      s.mesh.position.set(
        com.x + Math.cos(angle) * cfg.stunOrbitRadius,
        com.y + cfg.stunHeight,
        com.z + Math.sin(angle) * cfg.stunOrbitRadius,
      );
      s.mesh.scale.setScalar(cfg.stunSize);
      if (camera) s.mesh.quaternion.copy(camera.quaternion);
      FxMaterials.setFrame(s.mat, step, frames);

      // Palette cycling, on its own slower period so the colour is not simply the
      // frame number in disguise. 궤도와 프레임은 스텝이고 이것만 부드럽다 —
      // 그 둘은 기계적 회전이고, 색은 회전이 아니기 때문이다.
      cyclePalette(CHAOS_PALETTE, this._now, cfg.paletteCyclesPerSecond, s.mat.uniforms.uTint.value);
      s.mat.uniforms.uOpacity.value = 1;
      s.mesh.visible = true;
    }
  }

  /** Rings at both ends of every pair, and the line between them. */
  _updateSwap(match, camera) {
    const burst = this._burst?.cardId === 'swap' ? this._burst : null;
    if (!burst || !this.arena) {
      for (const r of this.rings) r.mesh.visible = false;
      this.swapLines.visible = false;
      return;
    }

    const cfg = this.config.cardFx;
    const t = burst.t;
    // Out and back: bright at the ends of the exchange, gone in the middle,
    // which is when the caps themselves are away.
    const pulse = Math.max(0, 1 - Math.abs(t * 2 - 1)) ** 0.6;

    // The real exchange publishes where every cap came from and is going to.
    // The panel's replay button has no exchange behind it, so the same pairs are
    // derived from where the caps are standing right now — the effect is then
    // drawn against the real board rather than against nothing.
    const real = match?.swap?.moves ?? [];
    const moves = this._demo || !real.length ? this._pairMoves() : real;
    const attr = this.swapLineGeo.getAttribute('position');
    let ring = 0;
    let w = 0;

    for (const m of moves) {
      if (ring >= this.rings.length) break;
      const r = this.rings[ring++];
      // The ring stays at the departure point rather than travelling with the
      // cap: it marks where the cap WAS, which is the half of the exchange that
      // is otherwise invisible.
      r.mesh.position.set(m.from.x, m.from.y + cfg.ringHeight, m.from.z);
      r.mesh.scale.setScalar(cfg.ringSize * (0.4 + smoothstep(t) * 1.6));
      if (camera) r.mesh.quaternion.copy(camera.quaternion);
      r.mat.uniforms.uTint.value.set(...SWAP_TINT);
      r.mat.uniforms.uOpacity.value = pulse;
      r.mesh.visible = true;

      if (w + 6 <= attr.array.length) {
        attr.array[w++] = m.from.x;
        attr.array[w++] = m.from.y + cfg.ringHeight;
        attr.array[w++] = m.from.z;
        attr.array[w++] = m.to.x;
        attr.array[w++] = m.to.y + cfg.ringHeight;
        attr.array[w++] = m.to.z;
      }
    }
    for (let i = ring; i < this.rings.length; i++) this.rings[i].mesh.visible = false;

    attr.needsUpdate = true;
    this.swapLineGeo.setDrawRange(0, w / 3);
    this.swapLineMat.opacity = pulse;
    this.swapLines.visible = w > 0;
  }

  /** The exchange the caps on the board right now WOULD make. For the replay button. */
  _pairMoves() {
    if (!this.arena) return [];
    const out = [];
    for (const { a, b } of CapSwap.pairs(this.arena)) {
      const ca = this.arena.capCom(a);
      const cb = this.arena.capCom(b);
      out.push(
        { index: a, from: { x: ca.x, y: ca.y, z: ca.z }, to: { x: cb.x, y: cb.y, z: cb.z } },
        { index: b, from: { x: cb.x, y: cb.y, z: cb.z }, to: { x: ca.x, y: ca.y, z: ca.z } },
      );
    }
    return out;
  }

  /** One-more: a hard flash on the player's own caps. */
  _updateFlash(match, camera) {
    const burst = this._burst?.cardId === 'onemore' ? this._burst : null;
    if (!burst || !this.arena) {
      for (const f of this.flashes) f.mesh.visible = false;
      return;
    }

    const cfg = this.config.cardFx;
    /**
     * Short and hard: full at the start, gone before the effect is.
     *
     * ── 계단이 사라지고 대신 짧아졌다 ─────────────────────────────────────
     * `ceil(k * 4) / 4` 였다. 근거는 시대의 기법이었고, 그것이 사라진 뒤에 남는
     * 것은 네 칸으로 끊기며 꺼지는 빛뿐이다 — 그건 섬광이 아니라 저속 촬영이다.
     *
     * 그런데 계단을 그냥 빼면 같은 길이의 페이드가 되고, "화면 전체를 페이드로
     * 끄지 마라"는 이 파일의 규칙이 뚜껑 위에서 그대로 반복된다. 그래서 계단을
     * 뺀 만큼 창을 좁혔다: 4분의 1 지점에서 이미 없다. 제곱으로 떨어뜨리는 것도
     * 같은 이유로, 앞쪽이 강하고 꼬리가 없어야 섬광이다.
     */
    const k = Math.max(0, 1 - burst.t * 4);
    const level = k * k;

    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      // `_marks`, not `capOwner`: a cap that has gone off the board is still a
      // body at a position, and flashing it lights up a corpse.
      if (!this._marks(burst.player, i) || level <= 0.004) {
        f.mesh.visible = false;
        continue;
      }
      const com = this.arena.capCom(i);
      f.mesh.position.set(com.x, com.y + cfg.ringHeight, com.z);
      f.mesh.scale.setScalar(cfg.ringSize * (1 + (1 - k) * 0.8));
      if (camera) f.mesh.quaternion.copy(camera.quaternion);
      f.mat.uniforms.uTint.value.set(...ONEMORE_TINT);
      f.mat.uniforms.uOpacity.value = level;
      f.mesh.visible = true;
    }
  }

  /**
   * 강타: a ring that closes onto the cap, and an aura that stays behind it.
   *
   * ── it contracts, and that is the whole idea ────────────────────────────────
   * Every other ring in this file expands. An expanding ring is something
   * LEAVING the cap — the swap uses one to say "this piece departed from here" —
   * and the same sprite run the other way says the opposite: force arriving,
   * gathering, being held. Reversing the direction is the difference between
   * "released" and "loaded", and it is free.
   *
   * Quantised to `smashRingSteps` so it arrives in a handful of jumps. A smooth
   * contraction is a tween; a stepped one is a mechanism winding up.
   */
  _updateSmash(camera) {
    const cfg = this.config.cardFx;
    const burst = this._burst?.cardId === 'smash' ? this._burst : null;

    // ── the aura: on for exactly as long as the card is armed ──
    // Driven off `smashCaps` rather than off the burst, so it survives the
    // effect ending and holds until the shot expires the card. It is the only
    // thing on screen that says "you are still holding this".
    const armed = new Set(this.smashCaps);
    cyclePalette(SMASH_PALETTE, this._now, cfg.smashPaletteCyclesPerSecond, _tint);
    const tint = _tint;
    for (let i = 0; i < this.auras.length; i++) {
      const a = this.auras[i];
      if (!armed.has(i) || !this.arena) {
        a.mesh.visible = false;
        continue;
      }
      const com = this.arena.capCom(i);
      a.mesh.position.set(com.x, com.y + cfg.smashAuraHeight, com.z);
      a.mesh.scale.setScalar(cfg.smashAuraSize);
      if (camera) a.mesh.quaternion.copy(camera.quaternion);
      a.mat.uniforms.uTint.value.copy(tint);
      a.mat.uniforms.uOpacity.value = Math.max(0, cfg.smashAuraStrength);
      a.mesh.visible = true;
    }

    // ── the ring: only while the card is landing ──
    if (!burst || !this.arena) {
      for (const r of this.smashRings) r.mesh.visible = false;
      return;
    }

    // Closed well before the effect ends, so the cap's answering pulse — which
    // `capVisual` puts on the back half — lands after the ring rather than with
    // it. Two beats, in order: gather, then hit.
    const close = Math.max(0.05, Math.min(1, cfg.smashRingFraction));
    const k = Math.min(1, burst.t / close);
    const steps = Math.max(1, Math.round(cfg.smashRingSteps));
    const stepped = Math.ceil((1 - k) * steps) / steps;
    const size = cfg.ringSize * (stepped * Math.max(0, cfg.smashRingStart - 1) + 1) * stepped;

    for (let i = 0; i < this.smashRings.length; i++) {
      const r = this.smashRings[i];
      // The reported bug, and the reason `_marks` exists: the aura above was
      // given the alive test and this loop was not, so an eliminated cap kept
      // its closing ring while the aura beside it had already stopped.
      if (!this._marks(burst.player, i) || stepped <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const com = this.arena.capCom(i);
      r.mesh.position.set(com.x, com.y + cfg.ringHeight, com.z);
      r.mesh.scale.setScalar(size);
      if (camera) r.mesh.quaternion.copy(camera.quaternion);
      r.mat.uniforms.uTint.value.copy(tint);
      // Brighter as it closes: the energy is going INTO the cap, so the last
      // frame before it vanishes is the strongest one.
      r.mat.uniforms.uOpacity.value = 0.35 + (1 - stepped) * 0.65;
      r.mesh.visible = true;
    }
  }

  /**
   * 철벽: an angular ring lying flat on the board, and the one flash that says
   * it did something.
   *
   * ── it is the quietest marker in this file, and that is a constraint ───────
   * Every other per-cap effect here marks ONE cap: 혼란's stars go on the
   * victim, 강타's aura on the cap about to shoot, 원모어's flash is a quarter
   * of a second long. This one is on every cap the player owns — three in
   * survival, four in football — for the whole of the opponent's turn, while
   * that opponent is trying to read the board and aim across it. So the size,
   * the alpha and the motion are all sized down from 강타's rather than across
   * from them. See `config.cardFx.resistRingSize`.
   *
   * ── and it does not pulse ──────────────────────────────────────────────────
   * 강타's aura pulses because something is being LOADED. A brace is a state
   * that is not going anywhere, and a "hardness" that throbs is a contradiction.
   * The palette walks — see `RESIST_PALETTE` — slowly enough not to read as
   * motion, only slowly enough not to read as printed on the board.
   */
  _updateResist(camera, struck) {
    const cfg = this.config.cardFx;
    const burst = this._burst?.cardId === 'resist' ? this._burst : null;

    // The cast, armed on the leading edge and counted down in frames. The same
    // bookkeeping as 강타's inversion and 침묵's darkening, and for the reason
    // given at length on `_updateSeal`: `Match.cardFx` builds a fresh object
    // every frame, so the latch has to be a BOOLEAN transition.
    const bracing = !!burst;
    if (bracing && !this._wasBracing) {
      this._braceLeft =
        Math.max(0, Math.round(cfg.resistPressFrames)) +
        Math.max(0, Math.round(cfg.resistSettleFrames)) +
        Math.max(0, Math.round(cfg.resistGlintFrames));
    }
    this._wasBracing = bracing;

    const settleFrames = Math.max(1, Math.round(cfg.resistSettleFrames));
    const glintFrames = Math.max(1, Math.round(cfg.resistGlintFrames));
    const owed = this._braceLeft;
    if (owed > 0) this._braceLeft--;

    /**
     * Where in the three beats we are, read off the countdown.
     *
     * `owed` runs press+settle+glint down to zero, so the press is the top of
     * the count, the settle is the middle, and the glint is the tail. Reading it
     * backwards from one counter keeps the three beats in a fixed order at any
     * frame rate — which is the whole reason they are counted rather than timed.
     */
    const inSettle = owed > glintFrames && owed <= glintFrames + settleFrames;
    const inGlint = owed > 0 && owed <= glintFrames;
    // 1 at the moment it is flung out, 0 once it has sat down.
    const settleK = inSettle ? (owed - glintFrames) / settleFrames : 0;

    cyclePalette(RESIST_PALETTE, this._now, cfg.resistPaletteCyclesPerSecond, _braceTint);

    const armed = new Set(this.resistCaps);
    for (let i = 0; i < this.braces.length; i++) {
      const b = this.braces[i];
      if (!armed.has(i) || !this.arena) {
        b.mesh.visible = false;
        // The debt is dropped with the marker. A cap whose brace expired while a
        // flash was owed must not light up again when it is next braced.
        this._hitLeft[i] = 0;
        continue;
      }

      /**
       * ── the hit flash: the card's ONLY visible output ────────────────────
       * What 철벽 does is make something NOT happen — the cap that would have
       * gone off the board stays on it. With no marker for that, a player cannot
       * tell the card working from the card doing nothing, and the honest
       * reading of a quiet turn is that they wasted a card.
       *
       * `struck` is the frame's collision set from `ContactAudio`, which is the
       * one collision observer in the project — there is no `EventQueue`
       * anywhere, deliberately. A second detector written for this would be a
       * second answer to the same question, and the day the two disagreed the
       * crack and the flash would land on different frames.
       *
       * The mass is asked as well as the card, and the two are genuinely
       * different questions. The ring is drawn while the card is ARMED, which
       * under §2-A includes the holder's own turn — when the brace is not yet in
       * the world and the cap is its ordinary weight. A flash on a cap that was
       * not actually heavier would be the marker claiming credit for a shove it
       * did nothing about, which is the one lie this effect exists to prevent.
       */
      if (struck?.has(i) && this.arena.capMassMul(i) > 1) {
        this._hitLeft[i] = Math.max(0, Math.round(cfg.resistHitFrames));
      }

      const hit = this._hitLeft[i];
      if (hit > 0) this._hitLeft[i]--;

      const com = this.arena.capCom(i);
      b.mesh.position.set(com.x, com.y + cfg.resistRingHeight, com.z);

      /**
       * Whose cast this is. `_marks` rather than `capOwner`, which is the bug
       * this file has had reported twice — the aura was given the alive test and
       * the ring beside it was not, and two markers went on burning on a body at
       * the bottom of the board.
       *
       * It matters here beyond the dead-cap case: both players can be braced at
       * once, so a cast lands while the OTHER side's rings are already standing,
       * and the beats belong only to the caps that just got them.
       */
      const mine = burst ? this._marks(burst.player, i) : false;

      // Flung out, then sat down. Only on the cast, and only on the caster's own.
      const grow = mine && settleK > 0
        ? 1 + settleK * settleK * Math.max(0, cfg.resistSettleOvershoot - 1)
        : 1;
      b.mesh.scale.setScalar(cfg.resistRingSize * grow);

      /**
       * Billboarded like every other sprite here, and it should not be.
       *
       * §6.2 asks for a ring that LIES ON THE BOARD rather than standing up, and
       * a flat quad laid in the xz plane is the honest way to draw that. It is
       * not what happens, because `capCom` is the only anchor these markers have
       * and the camera in this game tilts a long way toward the horizon: a quad
       * lying flat collapses to a line at the shallow end of the tilt range, and
       * a marker that vanishes at some camera angles is worse than one that is
       * merely upright. The flatness is carried by the SHAPE instead — a hard
       * octagon at low alpha reads as something the cap is sitting in, where the
       * aura's soft radial reads as something rising off it.
       */
      if (camera) b.mesh.quaternion.copy(camera.quaternion);

      // Toward white on a hit, from the steel-blue walk otherwise. Not a
      // separate sprite: the ring flashing is the ring saying it held, and a
      // second object would be a second thing that happened.
      const k = hit > 0 ? Math.max(0, Math.min(1, cfg.resistHitStrength)) : 0;
      b.mat.uniforms.uTint.value.set(
        _braceTint.x + (1 - _braceTint.x) * k,
        _braceTint.y + (1 - _braceTint.y) * k,
        _braceTint.z + (1 - _braceTint.z) * k,
      );
      const base = Math.max(0, cfg.resistRingStrength);
      // The glint is one frame-counted lift at the tail of the cast, not a fade.
      // A fade would say the state is ending; the state has just begun.
      const glint = inGlint && mine ? 0.5 : 0;
      b.mat.uniforms.uOpacity.value = Math.min(1, base + glint + (1 - base) * k);
      b.mesh.visible = true;
    }
  }

  /** The frame-wide pair: the sweep, and the edge. */
  _updateScreen() {
    const cfg = this.config.cardFx;
    const burst = this._burst;

    // ── the trajectory sweep: one pass, top to bottom ──
    if (burst?.cardId === 'trajectory') {
      const h = Math.max(4, cfg.scanHeight);
      const span = this.frame.height + h;
      const y = this.frame.height / 2 + h / 2 - burst.t * span;
      this.scan.position.set(0, y, 0);
      this.scan.scale.set(this.frame.width, h, 1);
      this.scanMat.uniforms.uTint.value.set(1, 1, 1);
      this.scanMat.uniforms.uOpacity.value = 1;
      this.scan.visible = true;
    } else {
      this.scan.visible = false;
    }

    // ── the one-more edge ──
    if (burst?.cardId === 'onemore') {
      // Two hard beats rather than one fade. The era's own screen flashes were
      // whole frames of a colour, and a stepped double-blink is the closest
      // thing to that which does not make the pitch unreadable.
      const beats = Math.max(1, Math.round(cfg.edgeBeats));
      const phase = Math.floor(burst.t * beats * 2);
      const on = phase % 2 === 0 && burst.t < 1;
      this.frameMat.uniforms.uTint.value.set(...ONEMORE_TINT);
      this.frameMat.uniforms.uOpacity.value = on ? 1 - burst.t * 0.5 : 0;
      this.frameQuad.visible = on;
    } else {
      this.frameQuad.visible = false;
    }

    // ── 강타의 섬광 ──
    // Counted in FRAMES, and armed once per burst rather than driven off `t`.
    // A time-based window would land on a different number of frames depending
    // on the frame rate, and at 1-2 frames that is the difference between a hit
    // and nothing at all. Armed on the leading edge; the counter does the rest.
    //
    // The edge is a BOOLEAN transition, not an identity check on the burst.
    // `Match.cardFx` builds a fresh object every frame, so `burst !== lastBurst`
    // is true on every one of them — which re-armed the counter each frame and
    // left the flash up for the whole effect instead of for two frames.
    const smashing = burst?.cardId === 'smash';
    if (smashing && !this._wasSmashing) {
      this._flashLeft = Math.max(0, Math.round(cfg.smashFlashFrames));
    }
    this._wasSmashing = smashing;

    /**
     * 남은 프레임 수에 비례해 옅어진다.
     *
     * 세 장이 같은 세기면 섬광이 툭 끊긴다. 옅어지면 짧은 잔상이 되어, 뒤이어
     * 열리는 링과 오라로 이어진다.
     */
    const owed = this._flashLeft;
    this.flashQuad.visible = owed > 0;
    if (owed > 0) {
      const total = Math.max(1, Math.round(cfg.smashFlashFrames));
      const k = owed / total;
      this.flashMat.uniforms.uOpacity.value =
        Math.max(0, Math.min(1, cfg.smashFlashStrength)) * k;
      this._flashLeft--;
    }
  }

  // ── what the caps do about it ────────────────────────────────────────────

  /**
   * The visual offset for one cap, or null.
   *
   * Read by `ArenaView` AFTER it has written the interpolated physics transform,
   * so this is strictly a drawing offset — the body is where the solver put it
   * and this moves the picture of it. That distinction is the whole reason the
   * shake cannot affect a shot.
   *
   * @returns {{dx: number, dy: number, dz: number, scale: number}|null}
   */
  capVisual(index) {
    const cfg = this.config.cardFx;
    let dx = 0;
    let dz = 0;
    let scale = 1;
    let touched = false;

    // Chaos: a small, fast, per-cap wobble. Two frequencies that do not divide
    // into each other, so four caps never fall into step and start to look like
    // one rigid object being shaken.
    if (this.chaosCaps.includes(index)) {
      const phase = index * 2.399;
      dx += Math.sin(this._now * cfg.shakeHz * Math.PI * 2 + phase) * cfg.shakeAmount;
      dz += Math.sin(this._now * cfg.shakeHz * Math.PI * 2 * 1.37 + phase * 1.7) * cfg.shakeAmount * 0.6;
      touched = true;
    }

    // 강타: a fast, small tremble, held for as long as the card is. Faster and
    // tighter than the chaos wobble on purpose — that one is a cap that has been
    // confused, this one is a cap straining against something. Two frequencies
    // again, and both prime-ish against chaos's, so a cap carrying both cards
    // does not fall into a single beat.
    if (this.smashCaps.includes(index)) {
      const cfg2 = this.config.cardFx;
      const phase = index * 1.117;
      const w = cfg2.smashJitterHz * Math.PI * 2;
      dx += Math.sin(this._now * w + phase) * cfg2.smashJitterAmount;
      dz += Math.cos(this._now * w * 1.23 + phase * 2.1) * cfg2.smashJitterAmount * 0.8;
      touched = true;
    }

    const burst = this._burst;
    if (burst?.cardId === 'swap' && this.arena) {
      // Shrink out, stay gone, grow back. From a near-top-down camera a vertical
      // squash is almost invisible — the cap is a disc either way — so the
      // disappearance is a uniform scale instead.
      const t = burst.t;
      const edge = Math.max(0.05, cfg.swapVanishFraction);
      const k = t < edge ? 1 - t / edge : t > 1 - edge ? (t - (1 - edge)) / edge : 0;
      scale *= Math.max(0.02, k);
      touched = true;
    }

    /**
     * The answering pulse, on the BACK half of the effect — after the ring has
     * finished closing. The order is the whole statement: the force gathers,
     * then it lands.
     *
     * ── 여기의 계단은 없앴고, 링의 계단은 남겼다 ─────────────────────────────
     * 둘 다 `ceil` 이었고 근거도 같았다. 그런데 두 가지가 서로 다른 것을 말한다.
     * 수축하는 링은 **기계**다 — 무언가가 장전되고 있고, 장전은 딱딱 걸린다.
     * 뚜껑이 부풀었다 돌아오는 것은 기계가 아니라 **맞은 몸**이고, 세 칸으로
     * 끊기며 부푸는 몸은 없다.
     *
     * 계단이 하던 다른 일 — "이건 방금 일어난 일이지 숨쉬기가 아니다" — 는 사인이
     * 아니라 **한 번만** 도는 것과 앞이 무거운 곡선이 맡는다. 아래의 `k * k` 다.
     */
    if (burst?.cardId === 'smash' && this._marks(burst.player, index)) {
      const cfg2 = this.config.cardFx;
      const close = Math.max(0.05, Math.min(1, cfg2.smashRingFraction));
      const after = (burst.t - close) / Math.max(0.05, 1 - close);
      if (after > 0) {
        const k = Math.max(0, 1 - after * 1.8);
        scale *= 1 + k * k * cfg2.smashPulseAmount;
        touched = true;
      }
    }

    /**
     * 철벽's press: the cap settles down onto the board for a few frames.
     *
     * DOWN, not out. Every other cap gesture in this file grows — 강타 swells
     * when the force lands, 원모어 blinks bigger — because they are all things
     * arriving at the cap. This one is the cap taking a set, so it goes the
     * other way, and it is small: a cap that visibly shrank would read as
     * leaving rather than as bracing.
     *
     * Counted in frames by `_updateResist` and read back here, so the press,
     * the ring and the glint stay in the same order at any refresh rate. Read
     * rather than recomputed, because two counters for one beat is two beats.
     */
    if (burst?.cardId === 'resist' && this._marks(burst.player, index)) {
      const press = Math.max(1, Math.round(cfg.resistPressFrames));
      const glint = Math.max(1, Math.round(cfg.resistGlintFrames));
      const settle = Math.max(1, Math.round(cfg.resistSettleFrames));
      // The press is the TOP of the countdown — see `_updateResist`.
      if (this._braceLeft > glint + settle) {
        const k = (this._braceLeft - glint - settle) / press;
        scale *= 1 - k * Math.max(0, cfg.resistPressAmount);
        touched = true;
      }
    }

    if (burst?.cardId === 'onemore' && this._marks(burst.player, index)) {
      // 강타의 답례 펄스와 같은 곡선, 같은 이유다. 한 번 부풀고 돌아온다 — 사인이
      // 아닌 것은 그대로다: 매끄러운 호흡은 방금 일어난 일이 아니라 상시 애니메이션이다.
      const k = Math.max(0, 1 - burst.t * 2.5);
      scale *= 1 + k * k * cfg.pulseAmount;
      touched = true;
    }

    return touched ? { dx, dy: 0, dz, scale } : null;
  }

  // ── the panel's replay button ────────────────────────────────────────────

  /** Play an effect with no game effect behind it. */
  play(cardId, player = 0, seconds = 0.6) {
    this._demo = { cardId, player, seconds, elapsed: 0 };
  }

  dispose() {
    this.materials.dispose();
    this.swapLineGeo.dispose();
    this.swapLineMat.dispose();
  }
}

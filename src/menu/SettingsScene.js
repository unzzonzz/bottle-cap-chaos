import { Group, Mesh, Plane, PlaneGeometry, Raycaster, Vector2, Vector3 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, panelTexture, titleTexture } from './menuTextures.js';
import { toMarkTexture } from '../marks/markTextures.js';
import { PALETTE, withAlpha } from '../core/palette.js';
import { RADIUS, ROLE, RULE } from '../core/tokens.js';
import { ROW, anchorFooter, anchorHead, anchorTopLeft, solvePanel, stackRows } from './panelLayout.js';
import { TIER_COUNT, TIER_NAMES } from '../core/quality.js';
import { plate, roundRectPath } from '../ui/paper.js';
import { dot, hairline } from '../ui/marks.js';
import { FRAME, frameScale } from '../core/frame.js';

/**
 * 설정 — a heading, the things it holds, and a way back.
 *
 * It was empty on purpose for a long time: "설정 화면 내용은 스코프 밖. 진입만
 * 되면 된다" was the whole brief, and filling it with plausible-looking sliders
 * would have invented scope. It still exists as a real scene rather than a stub
 * because it is what proves the transition end to end WITHOUT a page
 * navigation: cap covers, scene swaps underneath, cap flies out and reveals
 * something that was already there.
 *
 * 내 마크 is its first actual contents, and it is a LIST rather than the marks
 * themselves — the grid needs the whole frame, so it is its own screen and this
 * one points at it. That also keeps the brief's "유일한 진입점" honest: there is
 * one door into the mark editor and it is this row.
 *
 * ── the sound rows, and why the volume is STEPPED ───────────────────────────
 * This screen has exactly one control idiom — a 256x52 plate that answers a
 * press — and the brief asks for the existing style to be followed rather than
 * for a new one to be designed. A continuous drag slider is a new one: it needs
 * a track, a thumb, a grab, a drag that survives leaving the plate, and a
 * pointer protocol this page does not have (nothing on the menu is draggable
 * except the mark editor's turntable, which is why `bootMenu` says so in its
 * cursor table).
 *
 * Ten chips is the same control the page already has, ten times. It reads at a
 * glance, it is one press per change, it needs no new gesture, and it is exactly
 * the arrangement `MarkEditor` uses for its palette — a row of small quads whose
 * selected state is recomputed from the model on every refresh rather than
 * stored. The percentage is on the plate above it, so the value is legible as a
 * number as well as as a bar.
 *
 * ── 음소거 is the eraser ────────────────────────────────────────────────────
 * The mute row is the editor's eraser button in plate form: a boolean flipped on
 * press, drawn by re-deriving the label and the skin in `refresh`. Nothing about
 * its state is held here; the settings model owns it and this subscribes, so a
 * change made from the debug panel repaints this screen without either of them
 * knowing about the other.
 *
 * A 브러시 소리 row sat below it until the stroke tick was removed on the
 * player's instruction. Its absence is why the two link rows moved up.
 *
 * ── 부록 B: 제목이 탭이 되고, 뒤로 가기가 열에서 나갔다 ─────────────────────
 * 조사표가 이 화면을 두고 "푸터도 구분선도 없고, 뒤로 가기가 열의 마지막 줄이며
 * 크기도 같다" 고 적었다. 그 상태에서 `메뉴로` 는 고를 수 있는 설정 항목 중
 * 하나로 읽힌다 — 위의 다섯 줄과 판도 크기도 색도 같으니 그렇게 읽지 않을 근거가
 * 없다.
 *
 * 지금은 골격이 넷으로 나뉜다: 이름은 패널 모서리에 걸친 **탭**, 고르는 것은
 * 패널 안의 **열**, 화면을 떠나는 것은 구분선 아래 **푸터**의 RETREAT 다.
 * 세 구역의 좌표는 `menu/panelLayout.solvePanel` 이 푼다.
 */

/**
 * 이 화면만의 크기. 나머지 세로 배치는 `panelLayout.solvePanel` 이 푼다.
 *
 * ── 좌표가 아니라 순서를 저술한다 ───────────────────────────────────────────
 * 예전에는 titleY 176, 행 y 가 124 / 22 / -36 / -94 / -152 / -210 이었다. 위에서
 * 아래까지 452 픽셀이고 480 짜리 프레임에서는 들어간다. 800x459 창의 프레임은
 * 316 이라 제목도 마지막 두 줄도 화면 밖이었다. 이유와 해법은 `panelLayout.js`
 * 머리말에 있다.
 */
/**
 * 목록이 보이는 띠의 위·아래 여백, 저술 픽셀.
 *
 * 위는 난외 표제(22 + 11)의 자리에 숨 쉴 틈을 더한 값이고, 아래는 나가는 문의
 * 자리다 — 여백 28 에 줄 높이와 틈을 더해 74. 이보다 작으면 목록의 마지막 줄이
 * 나가는 문과 겹쳐 둘 다 안 읽힌다.
 */
const SCROLL_TOP = 62;
const SCROLL_BOTTOM = 74;
/** 휠 한 픽셀이 목록을 몇 프레임픽셀 미는가. */
const SCROLL_RATE = 0.5;

const L = {
  chip: { width: 22, height: 22, gap: 5 },
  steps: 10,
  /** 그래픽 티어의 칸 수. `core/quality.js` 가 다섯 단계를 정의한다. */
  graphicsSteps: TIER_COUNT,
};

/**
 * 칩 줄의 정의. 볼륨과 그래픽이 **같은 컨트롤**이고 칸 수만 다르다.
 *
 * ── 다섯 칸을 열 칸의 폭으로 그리지 않는다 ──────────────────────────────────
 * 같은 칩 폭으로 다섯 개를 놓으면 줄이 절반만 차고, 그러면 나머지 절반이 아직
 * 안 만들어진 것으로 읽힌다. 볼륨 줄과 **같은 전체 폭**을 다섯이 나눠 갖는다:
 * 열 칸의 스팬에서 줄어드는 간격 넷을 빼고 다섯으로 나눈 값 — 22·10 + 5·9 −
 * 5·4 = 245, 나누기 5 는 49 다.
 *
 * 배열로 저술하는 이유는 `layout` 과 `refresh` 와 `pick` 세 곳이 같은 순서를
 * 알아야 하기 때문이다. 줄이 하나 늘 때 고칠 곳이 한 곳이 된다.
 */
const CHIP_ROWS = [
  { id: 'volume', prefix: 'vol', steps: L.steps, width: L.chip.width },
  {
    id: 'graphics',
    prefix: 'gfx',
    steps: L.graphicsSteps,
    width: Math.round((L.steps * L.chip.width + (L.steps - 1) * L.chip.gap - 4 * L.chip.gap) / L.graphicsSteps),
  },
];

/**
 * Row order, top to bottom.
 *
 * 닉네임 is an `action`: a row this screen handles itself, like the audio rows,
 * rather than a `link` that `bootMenu` turns into a navigation. It is not gated
 * on `audioSettings` — see the filter in the constructor — because a player with
 * no audio model still has a name.
 */
const ROWS = [
  { id: 'volume', kind: 'readout' },
  // 칩 줄은 이 바로 아래에 들어간다. `layout` 의 `slots` 를 보라.
  { id: 'mute', kind: 'toggle' },
  /**
   * 그래픽 품질. 소리 묶음과 계정 묶음 사이가 자연스러운 경계다.
   *
   * 볼륨과 같은 `readout` + 칩 줄이다. 이 화면에는 컨트롤 관용구가 정확히 하나 —
   * 눌림에 답하는 판 — 뿐이고, 칩 줄은 그것을 여러 번 놓은 것이다. 다섯 단계를
   * 위해 새 관용구(드롭다운, 좌우 화살표, 연속 슬라이더)를 들여올 이유가 없다.
   *
   * COMMIT 도 재시작 안내도 없다. 여기서 고른 것은 즉시 적용되고, 즉시 적용되지
   * 않는 항목이 생긴다면 그건 안내로 덮을 문제가 아니라 고칠 문제다 — 이 화면에
   * 확인 버튼이 없는 이유가 `FOOTER` 에 적혀 있다.
   */
  { id: 'graphics', kind: 'readout' },
  /**
   * 카메라 추적. 그래픽 바로 아래 — 둘 다 "화면이 어떻게 보이는가" 다.
   *
   * 음소거와 같은 `toggle` 이다. 이 화면의 컨트롤 관용구는 눌림에 답하는 판
   * 하나뿐이고, 켬/끔 두 값에 새 것을 들여올 이유가 없다.
   *
   * 그래픽 티어와 한 문서에 담지 않은 이유는 `core/ViewSettings.js` 머리말에
   * 있다 — 티어는 측정이 고쳐도 되는 값이고 이건 사람만 고칠 수 있는 값이다.
   */
  { id: 'track', kind: 'toggle' },
  /**
   * 조준 보조. §5.3.
   *
   * 카메라 추적과 같은 문서, 같은 `toggle`, 같은 분류다 — 이 사람이 무엇을 보고
   * 싶은가에 대한 답이고 아무것도 자동으로 그것을 바꾸지 않는다.
   *
   * **기본 끔**이다. 그리고 무엇이 꺼지는지가 이 줄의 요점이다: 당김 선과 클램프
   * 바뿐이고, 오차 콘은 이 스위치와 무관하게 언제나 그려진다. 콘은 가이드가 아니라
   * 게임 상태이고 — 강타가 파는 상품이 "콘이 두 배로 벌어진다" 이다 — 그걸 끄면
   * 카드 두 장이 파는 것이 화면에서 사라진다.
   */
  { id: 'assist', kind: 'toggle' },
  { id: 'nickname', kind: 'action' },
  /**
   * 서버 주소는 `?debug=1` 뒤로 접었다 (PHASE 5 승인 항목 3).
   *
   * LAN 개발용이다 — 비워 두면 이 페이지가 온 곳에서 주소를 유도하고, 그게 같은
   * 네트워크의 두 기기가 아무것도 입력하지 않고 붙는 이유다. 그러니 평소에는
   * 고를 것이 없는 줄이고, 세로 화면에서는 그 한 줄 때문에 다른 줄이 잘렸다.
   */
  { id: 'server', kind: 'action', debugOnly: true },
  { id: 'marks', kind: 'link' },
];

/**
 * 푸터. 부록 B2.2-1 — RETREAT 는 **왼쪽**이다.
 *
 * 이 화면에 COMMIT 이 없는 것은 여기서 고른 것이 즉시 적용되기 때문이다. 확인할
 * 것이 없는 화면에 확인 버튼을 두면 그 버튼은 아무것도 하지 않으면서 오른쪽
 * 자리만 차지하고, 그러면 다음 화면에서 그 자리에 진짜 COMMIT 이 나타났을 때
 * 둘이 같은 것으로 읽힌다.
 */
const FOOTER = [
  { id: 'back', role: ROLE.RETREAT, side: -1 },
];

/** `?debug=1` 인가. 모듈 로드 시 한 번. */
const DEBUG = (() => {
  try {
    return new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
})();

export class SettingsScene {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {number} unitsPerPixel
   * @param {import('../audio/AudioSettings.js').AudioSettingsBook} [audioSettings]
   *   The sound rows are only built when there is a model behind them, so a
   *   caller that has no audio gets exactly the screen this used to be.
   * @param {import('../core/GraphicsSettings.js').GraphicsSettingsBook} [graphicsSettings]
   *   같은 규칙. 모델이 없으면 그래픽 줄도 칩도 만들지 않는다.
   * @param {import('../core/ViewSettings.js').ViewSettingsBook} [viewSettings]
   *   또 같은 규칙. 모델이 없으면 카메라 추적 줄도 만들지 않는다.
   */
  constructor({
    retro,
    unitsPerPixel,
    audioSettings = null,
    graphicsSettings = null,
    viewSettings = null,
    profile = null,
    modal = null,
  }) {
    this.root = new Group();
    /** 굴러가는 것들. 줄과 칩만 여기 들어간다. */
    this.list = new Group();
    /**
     * 목록을 자르는 두 평면. 위와 아래.
     *
     * 굴러간 줄이 난외 표제나 나가는 문 위로 올라가면 두 글자가 겹쳐 둘 다
     * 안 읽힌다. 스크롤이 있는 목록은 자기 띠 안에서만 보여야 한다.
     *
     * 월드 좌표라 `layout` 이 프레임에 맞춰 상수를 다시 넣는다.
     */
    this._clip = [new Plane(new Vector3(0, -1, 0), 0), new Plane(new Vector3(0, 1, 0), 0)];
    this.root.add(this.list);
    this.audioSettings = audioSettings;
    this.graphicsSettings = graphicsSettings;
    this.viewSettings = viewSettings;
    /**
     * The nickname model, or null.
     *
     * Injected exactly as `audioSettings` is, and for the same reason: this
     * screen subscribes and repaints, so a name changed from anywhere else —
     * the online menu asks for one too — shows up here without either side
     * knowing about the other.
     */
    this.profile = profile;
    /** The scene's questions, drawn as geometry. See `ui/ModalLayer.js`. */
    this.modal = modal;
    const u = unitsPerPixel;
    this._u = u;
    this._retro = retro;

    /** 이번 프레임에서 푼 배치. `layout()` 이 채운다. */
    this._box = null;
    this._chip = L.chip;

    /**
     * 화면의 바탕. 모든 줄보다 **뒤에** 그려진다.
     *
     * `renderOrder` 로 정한다. 여기 메시는 전부 z=0 의 같은 평면이고
     * `createSpriteMaterial` 은 깊이를 쓰지 않으므로, 순서를 정하지 않으면
     * 그리는 차례가 씬 그래프에 넣은 순서에 달린다 — 그건 우연이다.
     */
    this.panel = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    this.panel.renderOrder = -1;
    this.root.add(this.panel);

    /** @type {Array<{id: string, kind: string, mesh: object, maps: object, label: string}>} */
    this.items = [];
    for (const def of ROWS) {
      // The audio rows need a model behind them; 닉네임 and the two links do not.
      if (def.id === 'graphics') {
        if (!graphicsSettings) continue;
      } else if (def.id === 'track' || def.id === 'assist') {
        if (!viewSettings) continue;
      } else if (!audioSettings && def.kind !== 'link' && def.kind !== 'action') continue;
      // Both profile rows need a model behind them, the same way the audio rows
      // need theirs.
      if ((def.id === 'nickname' || def.id === 'server') && !profile) continue;
      if (def.debugOnly && !DEBUG) continue;
      this.items.push(this._buildRow(def));
    }

    /** @type {Array<{id: string, role: string, side: number, mesh: object, maps: object, label: string}>} */
    this.footer = FOOTER.map((def) => this._buildRow(def));

    /** @type {Array<{row: string, prefix: string, index: number, mesh: object}>} */
    this.chips = [];
    this._buildChips();
    /** 줄마다 실제로 그려지는 칩 크기. `layout` 이 채운다. */
    this._chipSize = new Map();
    this.layout(u);

    this._ray = new Raycaster();
    // 모든 레이어를 본다. `MenuItems` 의 같은 줄에 왜 필요한지 적혀 있다 —
    // 판은 `asUiLayer` 때문에 레이어 1 에 있고, 광선의 기본은 레이어 0 뿐이다.
    this._ray.layers.enableAll();
    this._ndc = new Vector2();
    this._hovered = null;

    this._off = audioSettings?.onChange(() => this.refresh());
    this._offGraphics = graphicsSettings?.onChange(() => this.refresh());
    this._offView = viewSettings?.onChange(() => this.refresh());
    this._offProfile = profile?.onChange(() => this.refresh());
    this.refresh();
  }

  _buildRow(def) {
    const u = this._u;
    const maps = { idle: null, hover: null };
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(this._retro, { map: null }),
    );
    // 푸터는 굴러가지 않는다 — 나가는 문은 목록의 일부가 아니다.
    if (def.side === undefined) {
      mesh.material.clippingPlanes = this._clip;
      this.list.add(mesh);
    } else {
      // 푸터는 굴러가지 않으므로 자를 이유도 없다.
      this.root.add(mesh);
    }
    return { ...def, mesh, maps, label: null };
  }

  /**
   * The volume chips.
   *
   * Ten of them, so one press is ten percent and the whole range is two presses
   * from either end. Zero is not a chip: that is what 음소거 is for, and a slider
   * that can be dragged to silence AND a mute toggle are two controls for one
   * state, which is how they end up disagreeing.
   */
  _buildChips() {
    for (const row of CHIP_ROWS) {
      if (!this._hasRow(row.id)) continue;
      for (let i = 0; i < row.steps; i++) {
        const mesh = new Mesh(
          new PlaneGeometry(1, 1),
          createSpriteMaterial(this._retro, { map: null }),
        );
        mesh.material.clippingPlanes = this._clip;
        this.list.add(mesh);
        this.chips.push({ row: row.id, prefix: row.prefix, index: i, mesh });
      }
    }
  }

  /** 이 줄의 모델이 있는가. 행과 칩이 같은 답을 써야 한다. */
  _hasRow(id) {
    return id === 'graphics' ? !!this.graphicsSettings : !!this.audioSettings;
  }

  /**
   * 제목 · 행 · 칩 줄을 위에서 아래로 쌓고, 덩어리를 프레임 세로 가운데에 놓는다.
   *
   * ── 좌표가 아니라 순서가 저술된 이유 ────────────────────────────────────
   * 행 하나가 사라질 수 있다: 오디오 모델이 없으면 볼륨과 음소거가 없고, 프로필이
   * 없으면 닉네임이 없고, `?debug=1` 이 아니면 서버 줄이 없다. 좌표를 손으로
   * 적어 두면 그 조합마다 구멍이 생긴다. 쌓으면 어떤 조합이든 붙어서 내려온다.
   *
   * 리사이즈에도 다시 불린다 — 프레임이 바뀌면 판 크기와 간격이 둘 다 바뀐다.
   */
  /**
   * 스크롤을 민다. 휠 한 칸이 한 줄쯤이다.
   *
   * @param {number} dy  화면 픽셀. 아래로 굴리면 양수
   */
  scroll(dy) {
    if (!this._scrollMax) return false;
    const next = Math.max(0, Math.min(this._scrollMax, (this._scroll ?? 0) + dy * SCROLL_RATE));
    if (next === this._scroll) return false;
    this._scroll = next;
    this._applyScroll();
    return true;
  }

  /**
   * 스크롤 값을 루트에 얹는다.
   *
   * 루트의 **기준 y** 를 따로 들고 있는 이유는 `anchorTopLeft` 가 매 배치마다
   * 루트를 다시 놓기 때문이다. 스크롤을 루트에 직접 더하면 다음 리사이즈에서
   * 그 값이 사라진다.
   */
  _applyScroll() {
    this.list.position.y = (this._scroll ?? 0) * (this._u ?? 1);
  }

  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;

    /** 어느 읽기 판 아래에 칩 줄이 붙는가. 정의는 `CHIP_ROWS` 한 곳에 있다. */
    const chipRowFor = (id) => CHIP_ROWS.find((r) => r.id === id && this._hasRow(id));

    const slots = [];
    for (const item of this.items) {
      slots.push({ id: item.id });
      if (chipRowFor(item.id)) slots.push({ id: `#chips:${item.id}`, h: L.chip.height });
    }

    const box = solvePanel({ title: true, rows: slots, footer: FOOTER.length });
    this._box = box;
    const at = (id) => box.rows.find((r) => r.id === id);

    /**
     * 줄 높이와 간격은 `stackRows` 가 정한다 — 모든 목록 화면이 같은 리듬이다.
     * 눈금 줄만 위 줄에 붙는다: 그것은 다음 항목이 아니라 위 줄의 **값**이다.
     */
    stackRows(box);

    this.panel.scale.set(box.panel.w * u, box.panel.texH * u, 1);
    // 난외 표제의 자리는 아래 `anchorHead` 가 정한다 — 프레임의 여백에 직접 붙는다.

    for (const item of this.items) {
      const row = at(item.id);
      item.size = { width: box.plate.width, height: row.h, scale: box.scale };
      item.mesh.scale.set(box.plate.width * u, row.h * u, 1);
      item.mesh.position.set(0, row.y * u, 0);
    }

    /**
     * 칩 줄은 **내용 폭**에 맞춘다. 세로 축소와는 무관하다.
     *
     * 여러 개가 나란히 놓이는 유일한 줄이라 가로가 먼저 모자란다. 세로 축소율을
     * 쓰면 좁고 높은 프레임에서 칩이 이유 없이 작아진다.
     *
     * 두 줄이 **같은 축소율**을 쓴다. 각자 자기 스팬으로 축소하면 좁은 프레임에서
     * 다섯 칸 줄은 아직 여유가 있고 열 칸 줄만 줄어들어, 두 줄의 전체 폭이
     * 달라진다 — 같은 폭을 나눠 갖게 한 것이 이 줄들의 요점인데 그게 무너진다.
     */
    const span = L.steps * L.chip.width + (L.steps - 1) * L.chip.gap;
    const kc = Math.min(1, box.plate.width / span);
    const cg = Math.max(1, Math.round(L.chip.gap * kc));
    this._chipSize.clear();
    for (const def of CHIP_ROWS) {
      if (!this._hasRow(def.id)) continue;
      const row = at(`#chips:${def.id}`);
      if (!row) continue;
      const cw = Math.max(3, Math.round(def.width * kc));
      const used = def.steps * cw + (def.steps - 1) * cg;
      /**
       * 두 줄의 칸 **높이가 같다.**
       *
       * `Math.min(row.h, ...)` 이라 줄 높이가 다르면 칸 높이도 달라졌다 —
       * 볼륨의 눈금과 그래픽의 눈금이 같은 재료(선 하나)가 된 지금, 높이가
       * 다르면 두 줄의 선이 다른 굵기로 보인다. 같은 것은 같아 보여야 한다.
       */
      const size = { width: cw, height: Math.round(L.chip.height * kc), gap: cg };
      this._chipSize.set(def.id, size);
      let i = 0;
      for (const chip of this.chips) {
        if (chip.row !== def.id) continue;
        /**
         * 칩도 **왼쪽**에 건다. 줄의 가운데가 아니다.
         *
         * `-used / 2` 는 칩 묶음을 자기 폭의 가운데에 맞추는 값이었고, 판이
         * 있을 때는 그것이 판의 가운데와 같았다. 판이 없어진 지금 기준은 목록의
         * 왼쪽 선이다 — 칩만 가운데 남으면 그 줄이 목록에서 튀어나온다.
         */
        const x = -box.plate.width / 2 + cw / 2 + i * (cw + cg);
        chip.mesh.scale.set(size.width * u, size.height * u, 1);
        chip.mesh.position.set(x * u, row.y * u, 0);
        i++;
      }
    }
    // 판 텍스처 키가 이 값을 쓴다. 볼륨 줄이 없는 화면에서도 정의되어야 한다.
    this._chip = this._chipSize.get('volume') ?? L.chip;

    /**
     * 푸터도 **본문과 같은 왼쪽 선**에 선다.
     *
     * 푸터 버튼은 자기 폭(`box.footer.button.w`)을 갖고 좌우 끝에 나뉘어 앉았다 —
     * 알약 두 개가 판의 아래 모서리를 잡던 배치다. 판이 없어진 지금 그 폭은
     * 본문 줄과 달라서, 글자가 쿼드의 왼쪽 끝에서 시작하므로 시작점이 몇 픽셀
     * 어긋난다. 목록이 기울어 보이는 원인이 이것이었다.
     *
     * 폭을 본문과 같게 주면 모든 줄의 왼쪽 끝이 정확히 한 선이 된다.
     */
    /**
     * 푸터는 **열의 왼쪽 선**에서 시작한다. 폭은 자기 것을 쓴다.
     *
     * 쿼드를 열 폭으로 넓혔더니 텍스처가 가로로 늘어나 글자가 커졌다 — 캔버스는
     * 자기 폭으로 구워지고 쿼드가 그것을 늘리기 때문이다. 폭은 그대로 두고
     * **왼쪽 끝**만 열에 맞춘다. 글자가 쿼드의 왼쪽에서 시작하므로 그러면
     * 본문 줄들과 같은 세로선에 선다.
     *
     * 오른쪽 항목(COMMIT)은 열의 오른쪽 끝에 붙는다. 나가는 문과 실행하는 것이
     * 같은 자리에 있으면 안 된다.
     */
    /**
     * 푸터도 목록과 **같은 줄 높이**를 쓴다.
     *
     * 솔버의 푸터 버튼 높이는 알약 시절의 값이라 목록보다 한참 크다. 글자
     * 크기가 줄 높이에서 나오므로(`menuPlateTexture`), 그대로 두면 나가는 문만
     * 목록의 두 배 크기로 선다.
     */
    const fb = { w: box.footer.button.w, h: Math.round(ROW * box.ky) };
    for (const item of this.footer) {
      item.size = { width: fb.w, height: fb.h, scale: box.scale };
      item.mesh.scale.set(fb.w * u, fb.h * u, 1);
    }

    // 판 크기가 바뀌었으면 텍스처를 다시 굽는다. `refresh` 는 라벨이 같으면
    // 건너뛰므로, 라벨을 지워서 강제한다.
    const key = `${box.panel.w}x${box.panel.texH}`;
    if (key !== this._panelKey) {
      this._panelKey = key;
      const old = this.panel.material.uniforms.uMap.value;
      this.panel.material.uniforms.uMap.value = panelTexture({
        w: box.panel.w,
        h: box.panel.h,
        tabHeight: box.panel.tabHeight,
        title: '설정',
        footerHeight: box.footer.height,
        padTop: box.pad.top,
        padX: box.pad.x,
        scale: box.scale,
      });
      old?.dispose();
      for (const item of [...this.items, ...this.footer]) item.label = null;
      chipCache.clear();
    }

    anchorTopLeft(this.root, box, u);
    anchorHead(this.panel, box, this.root, u);
    // 나가는 문은 프레임 아래에 고정한다. 목록이 길어져도 자리가 안 변한다.
    for (const item of this.footer) anchorFooter(item.mesh, { w: fb.w, h: fb.h }, this.root, u);

    /**
     * ── 목록이 프레임보다 길면 **스크롤한다** ──────────────────────────────
     *
     * 지금 여덟 줄은 들어가지만 간격을 벌린 만큼 여유가 없고, 좁은 프레임에서는
     * 솔버가 줄 높이를 눌러 글자가 작아지는 방식으로 버텨 왔다 — 읽히지 않는
     * 작은 글자보다 넘치는 목록을 미는 편이 낫다.
     *
     * 스크롤할 수 있는 거리는 내용의 높이에서 보이는 높이를 뺀 만큼이다. 0 이면
     * 다 보이는 것이고 휠은 아무 일도 하지 않는다.
     */
    const first = box.rows[0];
    const last = box.rows[box.rows.length - 1];
    const contentH = first && last ? first.y + first.h / 2 - (last.y - last.h / 2) : 0;
    const visibleH = FRAME.height - (SCROLL_TOP + SCROLL_BOTTOM) * frameScale();
    this._scrollMax = Math.max(0, contentH - visibleH);
    /**
     * 평면의 상수. 월드 좌표라 프레임 배율과 `unitsPerPixel` 을 둘 다 태운다.
     * 위 평면은 아래를 향하고(법선 -y) 아래 평면은 위를 향한다 — 둘 사이가 띠다.
     */
    const k = frameScale();
    const topY = (FRAME.height / 2 - SCROLL_TOP * k) * u;
    const bottomY = (-FRAME.height / 2 + SCROLL_BOTTOM * k) * u;
    this._clip[0].constant = topY;
    this._clip[1].constant = -bottomY;
    this._applyScroll();

    this.refresh();
  }

  // ── state ─────────────────────────────────────────────────────────────────

  /** What each row says right now. Derived, never stored. */
  _labelFor(id) {
    const s = this.audioSettings;
    switch (id) {
      case 'volume':
        return `마스터 볼륨\t${Math.round((s?.volume ?? 0) * 100)}%`;
      case 'mute':
        return `음소거\t${s?.muted ? '켬' : '끔'}`;
      /**
       * 이름이지 숫자가 아니다.
       *
       * 볼륨이 판에 퍼센트를 쓰는 자리에 티어의 **이름**을 쓴다. "5/5" 는 다섯
       * 단계가 몇 단계인지 아는 사람만 읽을 수 있는 값이고, 그건 이 화면을 만든
       * 사람뿐이다. 칩 줄이 이미 "다섯 중 몇 번째" 를 그림으로 말하고 있으므로
       * 판이 또 그걸 말할 이유도 없다.
       */
      case 'graphics':
        return `그래픽\t${TIER_NAMES[this.graphicsSettings?.tier ?? 0] ?? ''}`;
      /**
       * "카메라 추적" 이지 "발사 뚜껑 추적" 이 아니다.
       *
       * 개발자 패널의 같은 값은 뒤쪽 이름을 쓴다 — 거기서는 무엇을 따라가는지가
       * 요점이기 때문이다. 여기서는 움직이는 것이 카메라라는 쪽이 요점이고, 이
       * 줄을 끄러 오는 사람은 "카메라가 자꾸 움직인다" 를 고치러 온 것이다.
       */
      case 'track':
        return `카메라 추적\t${this.viewSettings?.trackCamera ? '켬' : '끔'}`;
      case 'assist':
        return `조준 보조\t${this.viewSettings?.aimAssist ? '켬' : '끔'}`;
      case 'nickname':
        // '없음' rather than a blank: an empty right-hand column reads as a
        // broken row, and "you have not chosen one" is the thing worth saying.
        return `닉네임\t${this.profile?.nickname || '없음'}`;
      case 'server':
        /**
         * '자동' is a real answer, not an empty one.
         *
         * Unset means the address is derived from wherever this page came from
         * — which is what makes two devices on one network work with nothing
         * typed. Showing a blank there would read as broken; showing the
         * derived URL would read as a setting somebody had chosen.
         */
        return `서버\t${this.profile?.server || '자동'}`;
      case 'marks':
        return '내 마크';
      case 'back':
        return '← 메뉴';
      default:
        return id;
    }
  }

  /**
   * Re-derive every control from the model.
   *
   * One function pushes the whole screen, exactly as `MarkEditor.refresh` does —
   * handlers mutate and call this rather than updating at the point of change,
   * so there is one place where what is on screen is decided.
   *
   * `menuPlateTexture` allocates a fresh texture per call and nothing caches it,
   * so a row whose text changed disposes its old pair before building the new
   * one. A row whose text did not change is left entirely alone.
   */
  refresh() {
    for (const item of [...this.items, ...this.footer]) {
      const label = this._labelFor(item.id);
      /**
       * 읽는 줄은 판을 두르지 않는다.
       *
       * 볼륨 줄은 `kind: 'readout'` 이고 `pick` 이 건너뛰므로 눌리지 않는데,
       * 위아래 줄과 똑같은 알약을 입고 있었다. 눌리지 않는 것에 눌리는 것의
       * 모양을 주면 그건 헷갈리라고 만든 것이다 — 사용자가 그대로 지적했다.
       *
       * `OnlineScene` 의 상태 줄이 같은 이유로 같은 것을 한다.
       */
      if (item.kind === 'readout') {
        /**
         * 읽는 줄도 **같은 함수**로 굽는다. `titleTexture` 가 아니라.
         *
         * 그쪽을 쓴 이유는 눌리지 않는 것에 알약을 입히지 않기 위해서였다.
         * 지금은 눌리는 줄도 알약이 없으므로 두 함수가 그리는 것이 같아졌고,
         * 다른 것은 `titleTexture` 가 판 높이에 맞춰 글자를 **줄인다**는 점뿐이다
         * — 줄 높이를 시안대로 22 로 낮추자 그 줄들만 작아졌다.
         *
         * 눌리지 않는다는 것은 `pick` 이 건너뛰는 것으로 말한다. 모양으로 말할
         * 필요가 없다: 이 화면에는 누를 수 있다고 주장하는 모양이 하나도 없다.
         */
        if (label !== item.label) {
          item.maps.idle?.dispose();
          item.maps.idle = menuPlateTexture(label, { state: 'idle' }, { ...item.size, onWater: true });
          item.label = label;
        }
        item.mesh.material.uniforms.uMap.value = item.maps.idle;
        continue;
      }
      if (label !== item.label) {
        item.maps.idle?.dispose();
        item.maps.hover?.dispose();
        const spec = { role: item.role ?? ROLE.CHOICE };
        item.maps.idle = menuPlateTexture(label, { ...spec, state: 'idle' }, item.size);
        item.maps.hover = menuPlateTexture(label, { ...spec, state: 'hover' }, item.size);
        item.label = label;
      }
      const hot = this._hovered === item.id;
      item.mesh.material.uniforms.uMap.value = hot ? item.maps.hover : item.maps.idle;
    }

    const volume = this.audioSettings?.volume ?? 0;
    const muted = !!this.audioSettings?.muted;
    const tier = this.graphicsSettings?.tier ?? 0;
    for (const chip of this.chips) {
      // Recomputed rather than stored, so there is one source of truth — the
      // same rule `MarkEditor`'s swatches follow.
      //
      // 두 줄의 채움 규칙이 다르다. 볼륨은 연속량이라 "이 칸까지 도달했는가" 이고,
      // 그래픽은 서수라 "이 칸 이하인가" 다 — 같은 부등호로 보이지만 볼륨 쪽은
      // 음소거가 끼어들고 그래픽 쪽은 티어 0 도 한 칸이 차는 값이다.
      const filled =
        chip.row === 'graphics'
          ? chip.index <= tier
          : !muted && volume >= (chip.index + 1) / L.steps - 1e-6;
      const hot = this._hovered === `${chip.prefix}:${chip.index}`;
      const size = this._chipSize.get(chip.row) ?? L.chip;
      chip.mesh.material.uniforms.uMap.value = chipTexture(
        filled,
        hot ? 'hover' : 'idle',
        size,
        chip.row === 'graphics' ? 'step' : 'meter',
      );
    }
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  /** @returns {{id: string}|null} */
  pick(canvas, camera, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, camera);
    this.root.updateMatrixWorld(true);
    // The chips are asked first: they are small and they sit between two plates,
    // and registration order is pick order.
    for (const chip of this.chips) {
      if (this._ray.intersectObject(chip.mesh, false).length) {
        return { id: `${chip.prefix}:${chip.index}` };
      }
    }
    for (const item of [...this.items, ...this.footer]) {
      // A readout is not a control. It must not answer a press, or the row
      // showing the volume would swallow one aimed at the chips below it.
      if (item.kind === 'readout') continue;
      if (this._ray.intersectObject(item.mesh, false).length) return { id: item.id };
    }
    return null;
  }

  /**
   * @param {{id: string}|boolean|null} hit
   *   A boolean is still accepted because that is what this took when there was
   *   one row to hover, and `bootMenu` has more than one caller shape.
   */
  setHover(hit) {
    const id = hit && typeof hit === 'object' ? hit.id : hit ? 'back' : null;
    if (id === this._hovered) return;
    this._hovered = id;
    this.refresh();
  }

  /**
   * Act on a press this screen owns.
   *
   * @returns {boolean} true when it was consumed. `marks` and `back` are
   *   navigation and are deliberately NOT consumed — they belong to `bootMenu`,
   *   which owns every screen change.
   */
  activate(hit) {
    const id = hit?.id;
    if (!id) return false;

    // ABOVE the audio guard, deliberately: the nickname has nothing to do with
    // sound, and a build with no audio model must still be able to set a name.
    if (id === 'server' && this.profile) {
      this._editServer().catch((err) => console.error('[settings] server entry failed', err));
      return true;
    }

    if (id === 'nickname' && this.profile) {
      // Reported rather than dropped. `activate` must return a boolean now, so
      // this cannot be awaited — and an unawaited rejection is invisible: a
      // syntax error in the entry module made this row do nothing at all, with
      // no console output and no failed press, which took far longer to find
      // than it should have.
      this._editNickname().catch((err) => console.error('[settings] nickname entry failed', err));
      return true;
    }

    /**
     * 오디오보다 **위**다. 소리 없는 빌드에서도 그래픽은 고를 수 있어야 한다.
     *
     * `setTier` 는 값이 같아도 `userSet` 을 켠다 — 최대에서 다시 최대를 고른 것은
     * "이대로 두겠다" 는 결정이고, 그 뒤로 자동 강등이 끼어들면 그 결정을 덮는
     * 것이 된다. 근거는 `GraphicsSettings.setTier` 에 있다.
     */
    if (id.startsWith('gfx:') && this.graphicsSettings) {
      this.graphicsSettings.setTier(Number(id.slice(4)));
      return true;
    }

    // 오디오보다 위인 것도 그래픽과 같은 이유다: 소리 없는 빌드에서도 카메라는
    // 끌 수 있어야 한다.
    if (id === 'track' && this.viewSettings) {
      this.viewSettings.toggleTrackCamera();
      return true;
    }

    if (id === 'assist' && this.viewSettings) {
      this.viewSettings.toggleAimAssist();
      return true;
    }

    if (!this.audioSettings) return false;

    if (id.startsWith('vol:')) {
      const step = Number(id.slice(4)) + 1;
      this.audioSettings.setVolume(step / L.steps);
      // Choosing a volume is choosing to hear something. Leaving mute on would
      // make the chips move and nothing happen — the same argument the editor
      // makes for a colour press clearing the eraser.
      this.audioSettings.setMuted(false);
      return true;
    }
    if (id === 'mute') {
      this.audioSettings.toggleMuted();
      return true;
    }
    return false;
  }

  /**
   * Open the text field, and put whatever comes back into the model.
   *
   * Async and unawaited: `activate` is called from a pointer handler that has to
   * return a boolean immediately, and the overlay lives for as long as somebody
   * is typing into it. The row repaints through the model's own change
   * notification rather than from here, so the two paths into a nickname — this
   * and the online menu — cannot repaint differently.
   */
  async _editNickname() {
    if (!this.modal) return;
    const { validateNickname } = await import('../net/protocol.js');
    const value = await this.modal.prompt({
      title: '닉네임',
      body: '한글 또는 영문 2~10자. 숫자·공백·특수문자는 쓸 수 없습니다.',
      initial: this.profile.nickname,
      maxLength: 10,
      // The SAME rule the server enforces, imported rather than restated — a
      // second copy is how the two come to disagree about a name.
      validate: (raw) => validateNickname(raw),
    });
    if (value === null) return;
    this.profile.setNickname(value);
    this.refresh();
  }

  /**
   * Where the relay is.
   *
   * Blank clears it back to automatic. Validated only for being a WebSocket URL
   * — whether anything is listening there is a question only connecting can
   * answer, and refusing an address because it is not up yet would be worse than
   * letting the connection fail with a message.
   */
  async _editServer() {
    if (!this.modal) return;
    const value = await this.modal.prompt({
      title: '서버 주소',
      body: '비워두면 접속한 주소에서 자동으로 찾습니다. 예: ws://192.168.0.9:8787',
      initial: this.profile.server,
      placeholder: '자동',
      maxLength: 120,
      validate: (raw) => {
        if (!raw) return { ok: true, value: '' };
        if (!/^wss?:\/\/.+/i.test(raw)) {
          return { ok: false, message: 'ws:// 또는 wss:// 로 시작해야 합니다' };
        }
        return { ok: true, value: raw };
      },
    });
    if (value === null) return;
    this.profile.setServer(value);
    this.refresh();
  }

  /**
   * 이 화면은 프레임마다 할 일이 없다.
   *
   * 호버 배율을 밀던 자리다. 버튼이 상호작용에 반응하지 않기로 했으므로 밀 것이
   * 없어졌다 — `glass.skinFor` 의 호버 분기에 근거가 있다. 텍스처 교체는 여전히
   * `refresh` 가 하고, 그건 라벨이 바뀔 때만 일어난다.
   *
   * 빈 함수로 남는 이유는 `bootMenu` 가 화면 종류를 가리지 않고 부르기 때문이다.
   */
  update() {}

  dispose() {
    this._off?.();
    this._offGraphics?.();
    this._offView?.();
    this._offProfile?.();
    this.panel.geometry.dispose();
    this.panel.material.uniforms.uMap.value?.dispose();
    this.panel.material.dispose();
    for (const item of [...this.items, ...this.footer]) {
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      // Safe to dispose: `menuTextures` has no cache and allocated these for us.
      item.maps.idle?.dispose();
      item.maps.hover?.dispose();
    }
    for (const chip of this.chips) {
      chip.mesh.geometry.dispose();
      chip.mesh.material.dispose();
    }
    this.root.clear();
  }
}

/**
 * 볼륨 칩 하나. 캐시된다.
 *
 * 모듈 사설 캐시를 쓰는 것은 `MarkEditor.swatchTexture` 가 세운 패턴이다: 한
 * 화면에서만 쓰는 컨트롤 그림은 그 화면이 들고 있는다. 공용 `markIcons` 에 넣으면
 * `clearIconCache()` 가 이 화면 아래에서 그걸 없애 버린다.
 *
 * ── 각진 사각형에서, 알약을 거쳐, 작은 칩으로 ──────────────────────────────
 * 처음에는 1픽셀 테두리 사각형에 안쪽 사각형을 채운 것이었고 필터가 꺼져 있었다
 * ("`imageSmoothingEnabled = false`"). 이 화면에서 유일하게 각진 것이었고, 열 개가
 * 나란히 있으니 유일하다는 사실이 눈에 띄었다. 그래서 알약이 됐다.
 *
 * 토큰에서 핏 반경이 없어지면서 알약도 없어졌다 — 그 모양은 젤 컨트롤의 것이고
 * 새 방향이 그것을 금지한다. 지금은 `RADIUS.chip` 의 작은 모서리이고, 채워진 칩은
 * `selected` 스킨을, 빈 칩은 가라앉은 종이를 쓴다. 어휘가 이 화면의 다른 컨트롤과
 * 같다는 성질은 그대로다.
 */
const chipCache = new Map();

function chipTexture(filled, state, size = L.chip, kind = 'step') {
  const w = Math.max(4, Math.round(size.width));
  const h = Math.max(4, Math.round(size.height));
  const key = `${kind}:${filled}:${state}:${w}x${h}`;
  const hit = chipCache.get(key);
  if (hit) return hit;

  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.scale(scale, scale);

  /**
   * ── 두 줄이 다른 그림이 됐다. 값의 종류가 다르기 때문이다 ─────────────────
   * 둘 다 알약이었다. 핏 반경이 §4.2 에서 없어졌으므로 어차피 다시
   * 그려야 했고, 그 김에 PHASE 4 의 감사가 지적한 것을 고친다: 볼륨 줄은 값
   * 하나를 **열 개의 물체**로 말하면서 같은 줄에 숫자로도 말하고 있었다.
   *
   *   `meter`  볼륨. **연속값**이라 선 하나에 표식이 지나간다. 칸마다 선을
   *            폭 전체에 그으므로 열 개가 이어져 한 줄로 읽힌다.
   *   `step`   그래픽. **이름이 있는 이산값**이라 칸이 정보다. 다섯은 셀 수
   *            있고, 티어를 고르는 것은 값을 미는 것과 다른 동작이다.
   *
   * 히트 영역은 둘 다 그대로 칸 하나씩이다. 바뀐 것은 그림뿐이다.
   */
  if (kind === 'meter') {
    /**
     * 눈금은 **선 하나**다. 점을 얹지 않는다.
     *
     * 채워진 칸마다 가운데에 원을 찍고 있었다. 선이 이미 채워짐과 비어 있음을
     * 말하는데 원이 같은 말을 한 번 더 하고, 작은 원이 줄지어 있으면 눈금이
     * 아니라 구슬로 보인다. 채워진 칸은 잉크가 밝고 빈 칸은 흐리다 — 그것으로
     * 충분하고, 그 대비가 이 화면의 다른 모든 상태 표시와 같은 방식이다.
     */
    hairline(ctx, 0, h / 2, w, h / 2,
      filled ? PALETTE.water.ink : withAlpha(PALETTE.water.ink, 0.3), RULE.thin);
  } else {
    /**
     * 티어 칸도 **선**이다. 채운 알약이 아니다.
     *
     * 고른 칸을 짙은 코발트로 채우고 있었다. 물 위에서 짙은 파랑을 채우면 그건
     * 강조가 아니라 구멍이고 — 배경보다 어두우니까 — 다섯 개가 나란히 있으면
     * 판 위의 버튼처럼 보인다. 이 화면에 판은 없다.
     *
     * 고른 칸은 **두꺼운 선**, 나머지는 흐린 선. 볼륨 눈금과 같은 재료이고,
     * 다른 것은 볼륨이 왼쪽부터 차오르는 데 비해 여기는 하나만 켜진다는 점이다.
     * 그 차이는 그림이 아니라 값이 말한다.
     */
    const y = h - RULE.thin * 2;
    hairline(ctx, 0, y, w, y,
      filled ? PALETTE.water.ink : withAlpha(PALETTE.water.ink, state === 'hover' ? 0.62 : 0.28),
      filled ? RULE.thin * 2 : RULE.thin);
  }

  const tex = toMarkTexture(canvas);
  chipCache.set(key, tex);
  return tex;
}

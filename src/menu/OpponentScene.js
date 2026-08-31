import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { buildCapGeometry, CAP_DEFAULTS, CAP_GROUP } from '../cap/capGeometry.js';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, titleTexture } from './menuTextures.js';
import { MarkTextures } from '../marks/markTextures.js';
import { PLAYER_COLORS } from '../render/playerColors.js';
import { PALETTE } from '../core/palette.js';
import { FRAME } from '../core/frame.js';
import { PLATE_TEXEL_SCALE, solveColumn } from './columnLayout.js';

/**
 * 상대 선택 — two caps facing each other, and who is behind the far one.
 *
 * ── it sits between the mode and the match, and it knows about neither ──────
 * "이 화면을 모드에 종속되지 않게 만들어라. 나중에 축구·컬링에도 붙는다." So the
 * mode arrives as a string to put in the heading and is otherwise never read:
 * there is no branch on it, nothing sized against a board, and no import from
 * `game/` beyond the mark store the caps already wear. Attaching it to a third
 * mode is a routing change in `bootMenu` and nothing here.
 *
 * ── two caps, and the right-hand one keeps its P2 mark ─────────────────────
 * "AI를 골라도 뚜껑 마크는 P2 마크 그대로다. AI 전용 마크 만들지 마라." The caps
 * are built once, wear `MarkTextures` slots 0 and 1, and the choice does not
 * touch them — picking AI changes which row is lit and nothing else. That is not
 * laziness: a distinct AI mark would mean the cap the player faces in the menu is
 * not the cap they face on the board, and it would also quietly need a fifth
 * mark slot in a screen that has four.
 *
 * The pair face one another rather than both facing front, which is the same
 * decision `main.js` makes for the board — a mark belongs to its owner and is
 * turned to be upright from that owner's seat. Here that reads as two players
 * across a table, which is what the screen is about.
 *
 * ── nothing is saved ───────────────────────────────────────────────────────
 * "선택을 저장하지 마라. 매번 기본 상태로 시작한다." The choice lives in this
 * object for as long as the screen is up and is handed to the URL when 시작 is
 * pressed. There is no storage call in this file and the screen is rebuilt on
 * every entry, so a session that played against the AI and came back finds
 * 플레이어 selected — which is the stated default.
 */

/**
 * Frame pixels. The whole layout, in one place, as `SettingsScene` does it.
 *
 * ── every plate is 256x52, and that is not laziness ────────────────────────
 * `menuPlateTexture` authors against a 256-wide plate and scales everything —
 * type included — by `width / 256`. So a 120-wide plate does not get a smaller
 * BOX with the same label in it, it gets an 11px font. Measured on the first
 * pass: 시작 and 메뉴로 were built at 168 and 120 and came out with type half the
 * size of the rows above them, reading as a different and broken control.
 *
 * One size is also what "기존 UI 스타일 그대로" means here — it is the size every
 * other row in this menu is, and matching it costs nothing.
 */
/**
 * ── the column was RE-CENTRED for the third choice, not extended ───────────
 * These `y` values are absolute hand-placed pixels, so adding 온라인 at the
 * existing pitch of 58 would have put 메뉴로 at −248 — past the −240 half-height
 * of the 480-tall frame, i.e. off the bottom of the screen. Appending a row to a
 * hand-placed column is exactly the edit that looks free and is not.
 *
 * So everything moved up together and the caps and title came with it. The
 * wider gap that used to sit before 시작 is gone as part of that: three choices
 * already read as a group by being three, and the space it bought is the space
 * the third row needed. 메뉴로 now sits at −212, whose plate bottom is −238.
 */
const L = {
  /** 카드 두 장이 마주 보는 줄. 판 높이의 배수로 잡는다. */
  capRow: 100,
  /** How far out from the middle each cap sits, as a share of the frame width. */
  capXShare: 0.19,
  /** Cap width in frame pixels. The two are the same — it is a match. */
  capWidth: 72,
  titleHeight: 72,
  rows: [
    { id: 'human' },
    { id: 'ai' },
    { id: 'online' },
    { id: 'start' },
    { id: 'back' },
  ],
};

export class OpponentScene {
  /**
   * @param {object} opts
   * @param {import('../core/GlossMaterial.js').GlossMaterials} opts.retro
   * @param {number} opts.unitsPerPixel
   * @param {import('../marks/MarkBook.js').MarkBook} opts.book
   * @param {HTMLCanvasElement|HTMLImageElement} opts.defaultMark
   * @param {{canvasSize: number, boundary: number}} opts.marks
   * @param {string} opts.modeName  for the heading only. Never branched on.
   * @param {boolean} [opts.aiAvailable]
   *   Whether this mode has a computer opponent to offer. False greys the AI row
   *   and refuses to select it.
   *
   *   ── the screen stays mode-agnostic; the MODE answers this ───────────────
   *   Passed in rather than derived, so there is still no mode name anywhere in
   *   this file. `MODES.knockout.ai` is the one place it is declared, and
   *   football gets the row by adding that line rather than by editing here.
   */
  constructor({ retro, unitsPerPixel, book, defaultMark, marks, modeName, aiAvailable = true }) {
    this.aiAvailable = aiAvailable;
    this.root = new Group();
    const u = unitsPerPixel;
    this._u = u;
    this._retro = retro;

    /**
     * The default, and it is re-derived on every construction.
     *
     * A field rather than anything durable. See the header — this must not
     * survive the screen being closed.
     */
    this.choice = 'human';

    this._modeName = modeName ?? '';
    this.title = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    this.root.add(this.title);

    /**
     * The marks, baked per player exactly as the board bakes them.
     *
     * `rotations` is [0, 0] rather than the board's [pi, 0] because these two
     * caps are TURNED to face each other below — the drawing is upright from its
     * owner's side either way, and rotating the texture as well would turn one
     * of them upside down.
     */
    this._marks = new MarkTextures({
      book,
      capColors: PLAYER_COLORS,
      defaultMark,
      size: marks.canvasSize,
      boundary: marks.boundary,
      rotations: [0, 0],
    });

    this._geometry = buildCapGeometry({ ...CAP_DEFAULTS, shell: true });
    this._capRadius = this._geometry.userData.radius ?? 1.6;

    /** @type {Mesh[]} index is the player. */
    this.caps = [0, 1].map((player) => {
      const materials = [];
      materials[CAP_GROUP.BODY] = retro.create({ color: PLAYER_COLORS[player] });
      materials[CAP_GROUP.PANEL] = retro.create({
        map: this._marks.textureFor(player),
        color: PALETTE.untinted,
      });
      materials[CAP_GROUP.LINER] = retro.create({ color: PALETTE.metal.liner, preset: 'plastic' });

      const pivot = new Group();

      /**
       * Turned toward the middle, on the PIVOT rather than on the cap.
       *
       * `rotation.x = PI/2` on the cap is the editor's pose — panel toward the
       * camera, parked on its mid-height. Yawing the pivot after that swings the
       * whole thing about the vertical, so each cap turns to look across the gap
       * at the other one. That is the "마주 보고 놓인 구성" the brief asks for.
       *
       * Rolling the cap on its own z was the first attempt and it does not read:
       * a disc seen face-on has no visible front to point anywhere, so a roll
       * about the view axis just tilts the mark. It has to be a yaw, and the
       * yaw has to be on a parent, or it would compose with the x rotation into
       * a tumble.
       */
      pivot.rotation.y = player === 0 ? 0.42 : -0.42;

      const cap = new Mesh(this._geometry, materials);
      cap.rotation.x = Math.PI / 2;
      cap.position.z = -(this._geometry.userData.height ?? 0) * 0.5;
      pivot.add(cap);
      this.root.add(pivot);
      return pivot;
    });

    /** @type {{id: string, mesh: Mesh, maps: object, label: string|null}[]} */
    this.items = L.rows.map((row) => this._plate(row.id));
    this.layout(u);

    this._ray = new Raycaster();
    // 모든 레이어를 본다. `MenuItems` 의 같은 줄에 왜 필요한지 적혀 있다 —
    // 판은 `asUiLayer` 때문에 레이어 1 에 있고, 광선의 기본은 레이어 0 뿐이다.
    this._ray.layers.enableAll();
    this._ndc = new Vector2();
    this._hovered = null;
    this.refresh();
  }

  _plate(id) {
    const mesh = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(this._retro, { map: null }));
    this.root.add(mesh);
    return { id, mesh, maps: { idle: null, hover: null }, label: null, size: null };
  }

  /**
   * 제목 · 뚜껑 두 개 · 다섯 줄을 하나의 열로 쌓는다.
   *
   * 뚜껑 줄도 슬롯 하나로 참여한다. 예전에는 `capY: 100` 으로 따로 고정돼 있었고,
   * 316 짜리 프레임에서는 제목과 겹쳤다. 열에 넣으면 어떤 프레임에서도 제목 아래,
   * 첫 줄 위에 있다.
   */
  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;

    const box = solveColumn([
      { id: '#title', h: L.titleHeight },
      { id: '#caps', h: L.capRow },
      ...L.rows.map((r) => ({ id: r.id })),
    ]);
    this._box = box;
    const at = (id) => box.rows.find((r) => r.id === id);

    const title = at('#title');
    this.title.scale.set(box.plate.width * u, title.h * u, 1);
    this.title.position.set(0, title.y * u, 0);
    this._titleHeight = title.h;

    const caps = at('#caps');
    const capWidth = Math.min(L.capWidth * box.k, caps.h * 0.72);
    const capX = FRAME.width * L.capXShare;
    const perCapUnit = (capWidth / (this._capRadius * 2)) * u;
    this.caps.forEach((pivot, player) => {
      pivot.position.set((player === 0 ? -capX : capX) * u, caps.y * u, 0);
      pivot.scale.setScalar(perCapUnit);
    });

    for (const item of this.items) {
      const row = at(item.id);
      item.size = { width: box.plate.width, height: row.h, scale: PLATE_TEXEL_SCALE };
      item.mesh.scale.set(box.plate.width * u, row.h * u, 1);
      item.mesh.position.set(0, row.y * u, 0);
    }

    const key = `${box.plate.width}x${box.plate.height}`;
    if (key !== this._plateKey) {
      this._plateKey = key;
      for (const item of this.items) item.label = null;
      const old = this.title.material.uniforms.uMap.value;
      this.title.material.uniforms.uMap.value = titleTexture('상대 선택', this._modeName, {
        width: box.plate.width,
        height: this._titleHeight,
        scale: PLATE_TEXEL_SCALE,
      });
      old?.dispose();
    }
    this.refresh();
  }

  /**
   * What each row says. Derived every refresh, never stored — the same rule
   * `SettingsScene._labelFor` follows, so there is one place the screen's text
   * is decided and the selection marker cannot go stale against it.
   */
  _labelFor(id) {
    const pick = (on, text) => `${on ? '▶ ' : '   '}${text}`;
    switch (id) {
      case 'human':
        return pick(this.choice === 'human', '플레이어');
      case 'ai':
        /**
         * Just "AI", greyed or not.
         *
         * A "(서바이벌 전용)" suffix was the first attempt and it collided on
         * screen: `menuPlateTexture`'s disabled skin already right-aligns 준비 중
         * onto the plate, so the two pieces of type overlapped in the middle.
         * The skin is the menu's existing way of saying "not yet" — it is what
         * the unfinished main-menu items wear — so saying it twice was both
         * unreadable and a second vocabulary for one idea.
         */
        return pick(this.aiAvailable && this.choice === 'ai', 'AI');
      case 'online':
        /**
         * Never greyed. Every mode is playable online — "3개 모드 모두 지원한다"
         * — which is the difference between this row and the AI one: the AI row
         * exists in modes that have no evaluator for it, and this one does not
         * have that problem because the network does not care what is being
         * simulated.
         */
        return pick(this.choice === 'online', '온라인');
      case 'start':
        return '시작';
      case 'back':
        return '◀ 메뉴로';
      default:
        return id;
    }
  }

  refresh() {
    for (const item of this.items) {
      const label = this._labelFor(item.id);
      if (label !== item.label) {
        item.maps.idle?.dispose();
        item.maps.hover?.dispose();
        item.maps.disabled?.dispose();
        item.maps.idle = menuPlateTexture(label, 'idle', item.size);
        item.maps.hover = menuPlateTexture(label, 'hover', item.size);
        // Built for every row rather than only the AI one: it costs a canvas
        // that is never sampled on the other three, and branching here would
        // mean `dead` and the texture set could disagree about which rows can
        // be greyed.
        item.maps.disabled = menuPlateTexture(label, 'disabled', item.size);
        item.label = label;
      }
      /**
       * The SELECTED row wears the hover skin whether or not the pointer is on
       * it.
       *
       * There is no third plate state in this menu's vocabulary and inventing
       * one would be designing a new control — "기존 UI 스타일 그대로". The
       * brighter skin plus the ▶ in the label is enough to say which of two rows
       * is chosen, and the arrow is what still reads once the quantiser has been
       * at the two backgrounds.
       */
      /**
       * Compared against the choice directly rather than enumerated.
       *
       * This was two hard-coded `id === '...' && choice === '...'` clauses, which
       * silently does the wrong thing the moment a third option exists: 온라인
       * would have been selectable and never drawn as selected. The rows that
       * are not choices — 시작, 메뉴로 — never match a choice value, so they are
       * excluded by the comparison rather than by a list that has to be kept in
       * step with `L.rows`.
       */
      const chosen = item.id === this.choice;
      const dead = item.id === 'ai' && !this.aiAvailable;
      const hot = !dead && (this._hovered === item.id || chosen);
      item.mesh.material.uniforms.uMap.value = dead
        ? item.maps.disabled
        : hot
          ? item.maps.hover
          : item.maps.idle;
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
    for (const item of this.items) {
      if (this._ray.intersectObject(item.mesh, false).length) return { id: item.id };
    }
    return null;
  }

  setHover(hit) {
    const id = hit && typeof hit === 'object' ? hit.id : null;
    if (id === this._hovered) return;
    this._hovered = id;
    this.refresh();
  }

  /**
   * Act on a press this screen owns.
   *
   * @returns {boolean} true when consumed. `start` and `back` are navigation and
   *   are deliberately NOT consumed — `bootMenu` owns every screen change, which
   *   is the same division `SettingsScene.activate` uses.
   */
  activate(hit) {
    const id = hit?.id;
    // Consumed even when refused, so a press on a greyed AI row does nothing at
    // all rather than falling through to `bootMenu`'s navigation branch.
    if (id === 'ai' && !this.aiAvailable) return true;
    if (id === 'human' || id === 'ai' || id === 'online') {
      this.choice = id;
      this.refresh();
      return true;
    }
    return false;
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
    for (const item of this.items) {
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      item.maps.idle?.dispose();
      item.maps.hover?.dispose();
      item.maps.disabled?.dispose();
    }
    for (const pivot of this.caps) {
      for (const cap of pivot.children) {
        for (const m of cap.material) m?.dispose();
      }
    }
    this._geometry.dispose();
    this.title.geometry.dispose();
    this.title.material.uniforms.uMap.value.dispose();
    this.title.material.dispose();
    this.root.clear();
  }
}

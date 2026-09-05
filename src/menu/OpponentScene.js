import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { capDiscTexture, menuPlateTexture, panelTexture } from './menuTextures.js';
import { MarkTextures } from '../marks/markTextures.js';
import { PLAYER_COLORS } from '../render/playerColors.js';
import { PALETTE } from '../core/palette.js';
import { ROLE } from '../core/tokens.js';
import { anchorHead, anchorTopLeft, solvePanel } from './panelLayout.js';

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
 * 이 화면만의 크기. 나머지는 `menu/panelLayout.solvePanel` 이 푼다.
 *
 * ── 부록 B: 고르는 것과 하는 것을 갈랐다 ────────────────────────────────────
 * 조사표가 이 화면에 대해 적은 것은 두 가지다. 하나, `시작` 이 열 안에 있어서
 * 세 선택지와 같은 판·같은 크기로 보인다 — 그러니 넷 중 하나를 고르는 화면으로
 * 읽힌다. 둘, 선택은 `▶` 라는 **글자 하나**로만 표시된다.
 *
 * 지금은 셋만 열에 남고, `시작` 은 푸터 오른쪽의 COMMIT, `메뉴로` 는 푸터
 * 왼쪽의 RETREAT 다. 선택은 링(`roleButton` 의 `selected`)이 말한다 — 글자가
 * 아니라 판의 상태이므로, 라벨을 다시 짜지 않아도 어느 것이 골라졌는지 보인다.
 */
const L = {
  /** 뚜껑 두 장이 마주 보는 줄. 열의 슬롯 하나로 참여한다. */
  capRow: 104,
  /**
   * 가운데에서 얼마나 벌어지는가. **뚜껑 지름**에 대한 비율이다.
   *
   * 프레임 폭의 0.19 였다. 그러면 뚜껑 크기와 벌어짐이 서로 모르는 값이 되고,
   * 좁은 패널에서 둘이 서로를 파고들었다 — 212 폭 패널에서 지름 83 짜리 두 장이
   * ±40 에 놓였다.
   */
  capXShare: 0.85,
  /**
   * 뚜껑 지름, 프레임 픽셀. 둘은 같다 — 대결이니까.
   *
   * 72 였고, 그건 256 폭 열에 맞춘 값이다. 패널이 448 이 되면서 같은 72 가
   * 버튼 옆에서 작아 보였다 — 화면의 주인공이 두 뚜껑인데 버튼보다 작으면
   * 그렇게 읽히지 않는다.
   *
   * 한 번 104 까지 올렸다가 되돌렸다. 뚜껑은 프레임 한가운데보다 위에 있고,
   * 원근 투영에서 축을 벗어난 원은 중심에서 멀어지는 방향으로 늘어난다 —
   * 커질수록 그 왜곡이 같이 커져서 뚜껑이 세로로 긴 덩어리로 보였다.
   */
  capWidth: 88,
  /** 열에 남는 것. 고르는 것만이다. */
  rows: [
    { id: 'human' },
    { id: 'ai' },
    { id: 'online' },
  ],
  /** 푸터. 부록 B2.2-1 — RETREAT 왼쪽, COMMIT 오른쪽. */
  footer: [
    { id: 'back', role: ROLE.RETREAT, side: -1 },
    { id: 'start', role: ROLE.COMMIT, side: 1 },
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
    /**
     * 화면의 바탕. 모든 줄보다 뒤에 그려진다 — `SettingsScene` 의 같은 줄에
     * `renderOrder` 로 정하는 이유가 적혀 있다.
     */
    this.panel = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    this.panel.renderOrder = -1;
    this.root.add(this.panel);

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

    /**
     * 뚜껑 둘은 **평면**이다. 3D 메시가 아니다.
     *
     * `buildCapGeometry` 로 만든 진짜 원반이었다 — 조명을 받고 환경 맵을
     * 반사하고 서로를 향해 돌아 있었다. 잘 만든 물건이지만 이 화면의 나머지가
     * 전부 평면 활자라, 입체 하나가 섞이면 그것만 다른 공간에서 온 것으로 보인다.
     * 무엇을 고르는지 말하는 데 필요한 것은 색과 마크이지 입체감이 아니다.
     *
     * 마주 보게 하던 yaw 도 함께 나갔다. 평면 원반에는 향할 앞이 없고, 기울이면
     * 타원이 되어 뚜껑이 아니라 접시로 보인다.
     */
    /** @type {Mesh[]} index is the player. */
    this.caps = [0, 1].map(() => {
      const mesh = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(retro, { map: null }));
      mesh.renderOrder = 10;
      this.root.add(mesh);
      return mesh;
    });
    this._capKey = '';

    /** @type {{id: string, mesh: Mesh, maps: object, label: string|null}[]} */
    this.items = L.rows.map((row) => this._plate(row.id));
    /** @type {{id: string, role: string, side: number, mesh: Mesh, maps: object}[]} */
    this.footer = L.footer.map((row) => ({ ...this._plate(row.id), ...row }));
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

  /** 열과 푸터를 한 줄로. 여덟 군데가 두 배열을 이어 붙이고 있었다. */
  get _all() {
    return [...this.items, ...this.footer];
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

    const box = solvePanel({
      title: true,
      caption: !!this._modeName,
      rows: [{ id: '#caps', h: L.capRow }, ...L.rows.map((r) => ({ id: r.id }))],
      footer: L.footer.length,
    });
    this._box = box;
    const at = (id) => box.rows.find((r) => r.id === id);

    this.panel.scale.set(box.panel.w * u, box.panel.texH * u, 1);
    // 난외 표제의 자리는 아래 `anchorHead` 가 정한다 — 프레임의 여백에 직접 붙는다.

    const caps = at('#caps');
    /**
     * 뚜껑은 **내용 폭**과 줄 높이 둘 다에 갇힌다.
     *
     * 예전에는 프레임 폭을 봤고, 그때는 열이 화면 전체를 쓰는 화면이었으므로
     * 맞았다. 이제 뚜껑은 패널 안에 있으므로 패널이 좁아지면 같이 좁아져야
     * 한다 — 안 그러면 두 장이 서로를, 혹은 패널의 옆벽을 파고든다.
     */
    const capWidth = Math.min(L.capWidth, box.plate.width * 0.28, caps.h * 0.8);
    const capX = capWidth * L.capXShare;
    // 평면 뚜껑이라 지오메트리 반지름을 거칠 이유가 없다. 폭이 곧 지름이다.
    const capPx = Math.round(capWidth);
    /**
     * 뚜껑을 패널 **앞으로** 밀어낸다.
     *
     * ── 잘려 보이던 이유 ────────────────────────────────────────────────────
     * 뚜껑은 불투명 메시라 투명한 패널보다 먼저 그려지고 깊이를 찍는다. 그런데
     * 피벗이 ±0.42 rad 돌아가 있으므로 뚜껑의 몸통 절반이 z = 0 **뒤로** 넘어가고,
     * 패널 쿼드는 정확히 z = 0 에 있다. 그 뒤쪽 절반에서는 깊이 검사를 패널이
     * 통과하므로, 패널이 뚜껑 위에 덮인다 — 화면에서는 뚜껑이 수직으로 싹둑
     * 잘린 것으로 보인다. 두 개가 각각 바깥쪽으로 잘린 것도 그래서다.
     *
     * 뚜껑 높이만큼 앞으로 밀면 어느 각도에서도 전부 패널 앞이다. 원근 확대는
     * 무시할 만하다 — 카메라가 896 픽셀 뒤에 있고 이 값은 20 픽셀 남짓이다.
     */
    /**
     * 뚜껑을 굽는다. 크기가 바뀌었을 때만.
     *
     * 마크는 `MarkTextures` 가 캔버스를 제자리에서 다시 칠하므로, 여기서 굽는
     * 텍스처는 그 순간의 그림을 복사한 것이다 — 마크가 바뀌면 `refresh` 가
     * 키를 흔들어 다시 굽는다.
     */
    const capKey = `${capPx}`;
    if (capKey !== this._capKey) {
      this._capKey = capKey;
      this.caps.forEach((mesh, player) => {
        mesh.material.uniforms.uMap.value?.dispose();
        mesh.material.uniforms.uMap.value = capDiscTexture({
          color: PLAYER_COLORS[player],
          mark: this._marks.textureFor(player)?.image ?? null,
          size: capPx,
        });
      });
    }
    this.caps.forEach((mesh, player) => {
      mesh.scale.set(capPx * u, capPx * u, 1);
      mesh.position.set((player === 0 ? -capX : capX) * u, caps.y * u, 0);
    });

    for (const item of this.items) {
      const row = at(item.id);
      item.size = { width: box.plate.width, height: row.h, scale: box.scale };
      item.mesh.scale.set(box.plate.width * u, row.h * u, 1);
      item.mesh.position.set(0, row.y * u, 0);
    }

    const fb = box.footer.button;
    for (const item of this.footer) {
      item.size = { width: fb.w, height: fb.h, scale: box.scale };
      item.mesh.scale.set(fb.w * u, fb.h * u, 1);
      // 나가는 문은 열의 왼쪽 끝, 실행하는 것은 오른쪽 끝. 폭은 자기 것을 쓴다 —
      // 쿼드를 열 폭으로 넓히면 캔버스가 늘어나 글자가 커진다.
      const left = -box.plate.width / 2;
      const x = item.side < 0 ? left + fb.w / 2 : left + box.plate.width - fb.w / 2;
      item.mesh.position.set(x * u, box.footer.y * u, 0);
    }

    const key = `${box.panel.w}x${box.panel.texH}`;
    if (key !== this._panelKey) {
      this._panelKey = key;
      for (const item of this._all) item.label = null;
      const old = this.panel.material.uniforms.uMap.value;
      this.panel.material.uniforms.uMap.value = panelTexture({
        w: box.panel.w,
        h: box.panel.h,
        tabHeight: box.panel.tabHeight,
        title: '상대 선택',
        caption: this._modeName,
        footerHeight: box.footer.height,
        padTop: box.pad.top,
        padX: box.pad.x,
        scale: box.scale,
      });
      old?.dispose();
    }
    this.refresh();
  
    anchorTopLeft(this.root, box, u);
    anchorHead(this.panel, box, this.root, u);
  }

  /**
   * What each row says. Derived every refresh, never stored — the same rule
   * `SettingsScene._labelFor` follows, so there is one place the screen's text
   * is decided and the selection marker cannot go stale against it.
   */
  _labelFor(id) {
    switch (id) {
      case 'human':
        return '플레이어';
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
        return 'AI';
      case 'online':
        /**
         * Never greyed. Every mode is playable online — "3개 모드 모두 지원한다"
         * — which is the difference between this row and the AI one: the AI row
         * exists in modes that have no evaluator for it, and this one does not
         * have that problem because the network does not care what is being
         * simulated.
         */
        return '온라인';
      case 'start':
        return '시작';
      case 'back':
        return '← MENU';
      default:
        return id;
    }
  }

  /**
   * 판 하나를 다시 굽는다. 라벨과 **상태**가 둘 다 캐시 키다.
   *
   * ── 왜 라벨만으로는 부족해졌나 ──────────────────────────────────────────
   * 예전에는 선택이 라벨 안의 `▶` 였다. 그래서 라벨이 바뀌면 선택도 바뀌었고,
   * 라벨 하나만 비교하면 충분했다. 지금 선택은 링이고 링은 라벨에 없다 —
   * 라벨만 비교하면 플레이어에서 AI 로 옮겨도 두 판 다 예전 그림 그대로다.
   */
  _bake(item) {
    const label = this._labelFor(item.id);
    const role = item.role ?? ROLE.CHOICE;
    const chosen = item.id === this.choice;
    const dead = item.id === 'ai' && !this.aiAvailable;
    const key = `${label}|${role}|${chosen}|${dead}`;
    if (key === item.label) return { chosen, dead };
    item.maps.idle?.dispose();
    item.maps.hover?.dispose();
    item.maps.disabled?.dispose();
    const spec = { role, selected: chosen };
    item.maps.idle = menuPlateTexture(label, { ...spec, state: 'idle' }, item.size);
    item.maps.hover = menuPlateTexture(label, { ...spec, state: 'hover' }, item.size);
    // Built for every row rather than only the AI one: it costs a canvas
    // that is never sampled on the other three, and branching here would
    // mean `dead` and the texture set could disagree about which rows can
    // be greyed.
    item.maps.disabled = menuPlateTexture(label, { ...spec, state: 'disabled' }, item.size);
    item.label = key;
    return { chosen, dead };
  }

  refresh() {
    for (const item of this._all) {
      const { chosen, dead } = this._bake(item);
      /**
       * 선택된 줄은 **링**을 두른다. 밝은 스킨이 아니다.
       *
       * 예전에는 선택된 줄이 호버 스킨을 입었다. 그때는 그것 말고 표현할 방법이
       * 없었고 — 판 상태가 idle/hover/disabled 셋뿐이었다 — 그래서 라벨에 `▶`
       * 까지 붙여야 했다. 부록 B 가 `selected` 를 판의 상태로 만들었으므로
       * 이제 둘 다 필요 없다. 호버 스킨은 어차피 idle 과 같은 것을 돌려준다.
       */
      const hot = !dead && this._hovered === item.id;
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
    for (const item of this._all) {
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
    for (const item of this._all) {
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      item.maps.idle?.dispose();
      item.maps.hover?.dispose();
      item.maps.disabled?.dispose();
    }
    for (const mesh of this.caps) {
      mesh.geometry.dispose();
      mesh.material.uniforms.uMap.value?.dispose();
      mesh.material.dispose();
    }
    this.panel.geometry.dispose();
    this.panel.material.uniforms.uMap.value?.dispose();
    this.panel.material.dispose();
    this.root.clear();
  }
}

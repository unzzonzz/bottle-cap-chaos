import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { CARDS } from '../game/cards/cardCatalog.js';
import { ROLE, SIZE, SPACE } from '../core/tokens.js';
import { createSpriteMaterial } from './menuMaterials.js';
import { collectionCardTexture, menuPlateTexture, panelTexture } from './menuTextures.js';
import { anchorTopLeft, solvePanel } from './panelLayout.js';

/**
 * 컬렉션 — 카드 일곱 장의 카탈로그.
 *
 * ── §18 은 "레트로 음료 카탈로그" 를 요구하고, 그 말은 두 부분이다 ───────────
 * 형식(카탈로그)과 인상(레트로 음료). 인상은 이미 있다 — 카드 면이 흰 종이에 색
 * 잉크이고, 뚜껑과 병이 같은 어휘를 쓴다. 없던 것은 형식이다.
 *
 * ── 무엇을 모으는가에 대한 답이 아니다. 무엇이 **있는가**에 대한 답이다 ─────
 * 사용자가 "마크 시스템으로 때우지 말고 별도 화면" 을 골랐고, PHASE 4 의 감사가
 * 그 화면의 문제를 적었다: **수집 대상이 되는 시스템이 아직 없다.** 모을 것이
 * 없는데 격자를 만들면 빈 격자다.
 *
 * 그래서 이 화면은 수집물이 아니라 **목록**이다. 오늘 게임에 있는 것 중 하나의
 * 세트를 이루고, 각각 이름과 그림과 설명을 가지며, 지금 어디에서도 읽을 수 없는
 * 것 — 카드다. 경기 중에는 자기 손패만 보이고 상대 것은 뒤집혀 있으므로,
 * 상대가 낼 수 있는 것이 무엇인지 알 방법이 없었다.
 *
 * 수집 시스템이 생기면 이 화면이 그것을 담는다. 그때 바뀌는 것은 `CARDS` 를 읽는
 * 한 줄이고, 격자도 배치도 그대로다.
 *
 * ── 카드 면은 게임의 것을 그대로 쓴다 ──────────────────────────────────────
 * `cardFaceTexture` 는 경기 중 손패가 쓰는 바로 그 함수다. 카탈로그용 그림을 따로
 * 그리면 카드가 바뀔 때 두 곳이 갈리고, 갈린 쪽은 언제나 아무도 안 보는 쪽이다.
 */

/**
 * 격자의 열 수. 카드 **수에서** 나온다.
 *
 * ── 처음에 4 로 고정하고 캡션에 "일곱 장" 이라고 적었다. 여섯이었다 ─────────
 * `CARDS` 는 여섯이고 스왑은 `SHELVED` 에 있다 — 카탈로그에 되돌릴 수 있게 남겨
 * 둔 것이지 오늘의 카드가 아니다. 4열이면 4+2 로 앉아 두 번째 줄이 반쯤 비고,
 * 캡션은 있지도 않은 일곱 번째를 약속한다.
 *
 * 그래서 둘 다 세어서 만든다. 스왑이 돌아오면 일곱이 되고 4열이 되며 캡션도
 * 따라온다 — 고칠 곳이 없다.
 */
const COLS = CARDS.length <= 6 ? 3 : 4;

export class CollectionScene {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {number} unitsPerPixel
   */
  constructor({ retro, unitsPerPixel }) {
    this.root = new Group();

    this.panel = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(retro, { map: null }));
    this.panel.renderOrder = 5;
    this.root.add(this.panel);

    /** 카드 한 장당 쿼드 하나. 텍스처는 `layout` 이 폭을 알고 나서 굽는다. */
    this.cards = CARDS.map((card) => {
      const mesh = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(retro, { map: null }));
      mesh.renderOrder = 10;
      this.root.add(mesh);
      return { card, mesh, map: null, width: 0 };
    });

    this.back = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(retro, { map: null }));
    this.back.renderOrder = 10;
    this.root.add(this.back);
    this._backKey = '';
    this._panelKey = '';

    /**
     * 이 화면에서 누를 수 있는 것은 뒤로 하나다. 카드는 **읽는 것**이다.
     *
     * 카드를 누를 수 있게 만들지 않는 것이 결정이다 — 누를 수 있으면 무슨 일이
     * 일어나야 하고, 이 화면에는 일어날 일이 없다. §11 의 "최소 정보" 는 요소
     * 수에 대한 말이기도 하지만 **약속**의 수에 대한 말이기도 하다.
     */
    this.hovered = null;

    /**
     * 광선이 **모든 레이어**를 봐야 한다.
     *
     * `MenuItems` 가 같은 함정에 빠진 적이 있다: 판이 `asUiLayer` 로 레이어 1 에
     * 있는데 `new Raycaster()` 의 기본은 0 하나뿐이라, 광선이 판을 시험조차 하지
     * 않았다. 오류도 없고 화면도 멀쩡하고 누르면 아무 일도 안 일어난다.
     */
    this._ray = new Raycaster();
    this._ray.layers.enableAll();
    this._ndc = new Vector2();

    this.layout(unitsPerPixel);
  }

  /** @param {number} unitsPerPixel */
  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;

    /**
     * 카드 격자는 `solvePanel` 의 행이 아니라 **한 덩어리**다.
     *
     * 행 솔버는 세로로 쌓이는 컨트롤을 위한 것이고 여기 있는 것은 격자다. 격자의
     * 높이는 폭에서 나오므로(카드 비율이 고정), 슬롯 하나를 요청하고 그 안을 직접
     * 나눈다 — 그리고 그 슬롯의 높이를 격자가 실제로 필요로 하는 값으로 준다.
     */
    const rows = Math.ceil(this.cards.length / COLS);
    const probe = solvePanel({ title: true, caption: true, rows: [{ id: '#grid' }], footer: 1 });
    const gap = Math.round(SPACE.sm * probe.ky);
    const cellW = Math.floor((probe.plate.width - gap * (COLS - 1)) / COLS);
    const cellH = Math.round(cellW * (SIZE.card.h / SIZE.card.w));
    const gridH = cellH * rows + gap * (rows - 1);

    const box = solvePanel({
      title: true,
      caption: true,
      rows: [{ id: '#grid', h: gridH }],
      footer: 1,
    });
    const grid = box.rows[0];

    const key = `${Math.round(box.panel.w)}x${Math.round(box.panel.texH)}`;
    if (key !== this._panelKey) {
      this._panelKey = key;
      this.panel.material.uniforms.uMap.value?.dispose();
      this.panel.material.uniforms.uMap.value = panelTexture({
        w: box.panel.w,
        h: box.panel.h,
        tabHeight: box.panel.tabHeight,
        title: '컬렉션',
        caption: `카드 ${CARDS.length}장`,
        footerHeight: box.footer.height,
        padTop: box.pad.top,
        padX: box.pad.x,
        scale: box.scale,
        divider: true,
      });
    }
    this.panel.scale.set(box.panel.w * u, box.panel.texH * u, 1);
    // `panelTexture` 는 탭까지 포함한 캔버스를 만들고, 그 캔버스의 세로 한가운데는
    // 몸통의 한가운데보다 탭 높이의 절반만큼 위다. 메시는 캔버스를 그리므로 그 만큼
    // 올려 놓아야 몸통이 `solvePanel` 이 푼 자리에 온다.
    this.panel.position.set(0, (box.panel.tabHeight / 2) * u, 0);

    const left = -box.plate.width / 2 + cellW / 2;
    const top = grid.y + grid.h / 2 - cellH / 2;
    this.cards.forEach((entry, i) => {
      const cx = left + (i % COLS) * (cellW + gap);
      const cy = top - Math.floor(i / COLS) * (cellH + gap);
      if (entry.width !== cellW) {
        /**
         * **버리지 않는다.** `cardFaceTexture` 는 폭으로 캐시된다.
         *
         * 경기 화면의 손패가 같은 캐시를 쓰므로, 여기서 dispose 하면 다음에 그
         * 폭을 요청하는 쪽이 이미 버려진 GL 텍스처를 받는다. 창을 끌면 폭이
         * 계속 바뀌므로 이 코드는 자주 돈다.
         */
        /**
         * 게임의 `cardFaceTexture` 가 아니라 메뉴 전용으로 굽는다.
         *
         * 그건 흰 유리판이고 판 위에서는 그게 맞다. 컬렉션은 판이 아니라 물
         * 속이고, 이 화면에서 흰 종이는 유일하게 남은 다른 재료였다.
         * 바뀌는 것은 재료뿐이다 — 이름·강조색·무늬·아이콘은 게임의 것을
         * 그대로 부른다. 자세한 것은 `collectionCardTexture` 머리말.
         *
         * `locked` 는 아직 false 고정이다 — 이 화면에는 소유 개념이 없다.
         * 카탈로그의 여섯 장이 전부 보이고, 잠금은 카드 자신의 설명이 말한다.
         * 인자를 미리 둔 것은 그 개념이 생겼을 때 여기 한 줄이면 되게 하려는 것이다.
         */
        entry.map = collectionCardTexture(entry.card, cellW, { locked: false });
        entry.width = cellW;
        entry.mesh.material.uniforms.uMap.value = entry.map;
      }
      entry.mesh.scale.set(cellW * u, cellH * u, 1);
      entry.mesh.position.set(cx * u, cy * u, 0);
    });

    const fb = box.footer.button;
    const bk = `${Math.round(fb.w)}x${Math.round(fb.h)}`;
    if (bk !== this._backKey) {
      this._backKey = bk;
      this.back.material.uniforms.uMap.value?.dispose();
      this.back.material.uniforms.uMap.value = menuPlateTexture(
        '← MENU',
        { role: ROLE.RETREAT, state: 'idle' },
        { width: Math.round(fb.w), height: Math.round(fb.h), scale: box.scale },
      );
    }
    this.back.scale.set(fb.w * u, fb.h * u, 1);
    this.back.position.set(box.footer.left * u, box.footer.y * u, 0);
  
    anchorTopLeft(this.root, box, u);
  }

  /**
   * Nothing here animates, and the method exists so the caller does not branch.
   *
   * `bootMenu` calls `update` on whichever screen is live; a screen missing one
   * is a screen the loop has to know about by name.
   */
  update() {}

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
    return this._ray.intersectObject(this.back, false).length ? { id: 'back' } : null;
  }

  setHover(hit) {
    this.hovered = hit?.id ?? null;
  }

  dispose() {
    // 카드 면은 공유 캐시의 것이다. 위의 주석 참조.
    this.panel.material.uniforms.uMap.value?.dispose();
    this.back.material.uniforms.uMap.value?.dispose();
    this.root.clear();
  }
}

import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { CARDS } from '../game/cards/cardCatalog.js';
import { ROLE } from '../core/tokens.js';
import { createSpriteMaterial } from './menuMaterials.js';
import { collectionRowTexture, menuPlateTexture, panelTexture } from './menuTextures.js';
import { anchorHead, anchorTopLeft, solvePanel } from './panelLayout.js';

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
     * 격자가 아니라 **목록**이다. 한 줄에 카드 하나.
     *
     * 3 x 2 격자에 세로 카드를 놓고 있었다. 카드는 손에 쥐고 부채꼴로 펼치는
     * 물건의 형태이고, 컬렉션에서 하는 일은 쥐는 것이 아니라 훑는 것이다.
     * 줄로 눕히면 설정 화면과 같은 구조가 된다 — 왼쪽에서 시작하고, 한 줄에
     * 한 가지이고, 눈이 세로로만 움직인다.
     *
     * 그래서 격자를 직접 나누던 코드가 통째로 없어지고 행 솔버를 그대로 쓴다.
     * 카드 수가 늘면 줄이 늘어나고 `solvePanel` 이 알아서 눌러 준다.
     */
    const box = solvePanel({
      title: true,
      caption: true,
      rows: this.cards.map((entry) => ({ id: entry.card.id })),
      footer: 1,
    });

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
      });
    }
    this.panel.scale.set(box.panel.w * u, box.panel.texH * u, 1);
    // 난외 표제의 자리는 아래 `anchorHead` 가 정한다 — 프레임의 여백에 직접 붙는다.

    this.cards.forEach((entry, i) => {
      const row = box.rows[i];
      const size = { width: box.plate.width, height: row.h };
      const rk = `${Math.round(size.width)}x${Math.round(size.height)}`;
      if (entry.rowKey !== rk) {
        entry.rowKey = rk;
        entry.mesh.material.uniforms.uMap.value?.dispose();
        entry.mesh.material.uniforms.uMap.value = collectionRowTexture(entry.card, size);
      }
      entry.mesh.scale.set(size.width * u, size.height * u, 1);
      entry.mesh.position.set(0, row.y * u, 0);
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
    // 열의 왼쪽 끝. 폭은 자기 것 — 쿼드를 넓히면 텍스처가 늘어나 글자가 커진다.
    this.back.position.set((-box.plate.width / 2 + fb.w / 2) * u, box.footer.y * u, 0);
  
    anchorTopLeft(this.root, box, u);
    anchorHead(this.panel, box, this.root, u);
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

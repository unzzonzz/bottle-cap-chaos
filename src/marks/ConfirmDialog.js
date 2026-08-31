import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from '../menu/menuMaterials.js';
import { menuPlateTexture, panelTexture } from '../menu/menuTextures.js';
import { messageTexture, solidTexture } from './markIcons.js';
import { PALETTE } from '../core/palette.js';
import { ROLE } from '../core/tokens.js';
import { solvePanel } from '../menu/panelLayout.js';

/**
 * "정말?" — asked in the scene, never in a `window.confirm`.
 *
 * ── why it is geometry ──────────────────────────────────────────────────────
 * The brief rules out a DOM dialog and the reason is the same one that keeps
 * every other overlay in this project inside the render target: a browser
 * dialog is drawn by the operating system at native resolution, so it arrives
 * on top of a 320x240 image as the one crisp, un-dithered, un-quantised thing on
 * the screen. It would also be modal in the JavaScript sense — `window.confirm`
 * blocks the event loop, which stops the render loop, which freezes the menu
 * behind it.
 *
 * So it is three quads and a veil, in the menu's own plate palette.
 *
 * ── it is modal, and that is enforced by the CALLER ─────────────────────────
 * This class has no opinion about the rest of the screen; it reports whether it
 * is open and whether a point hit one of its two buttons. The screen that owns
 * it is expected to ask `open` FIRST in its own pick order and to stop there —
 * the same arrangement `PointerRouter` uses for the victory screen, and for the
 * same reason: a press that lands on a dialog must not also reach what the
 * dialog is asking about.
 *
 * ── one shape for three questions ───────────────────────────────────────────
 * Deleting a slot, saving a drawing and leaving with unsaved changes are all
 * "are you sure", and they differ only in the sentence. Giving each its own
 * dialog would be three chances for them to look slightly different.
 *
 * ── 부록 B: 좌우가 반대였다 ─────────────────────────────────────────────────
 * 조사표가 잡아낸 두 위반 중 하나가 여기다. `확인` 이 왼쪽(side −1)이고 `취소` 가
 * 오른쪽(side +1)이었다 — B2.2-1 은 그 반대를 요구한다. 물러나는 것이 왼쪽,
 * 실행하는 것이 오른쪽이다.
 *
 * 그리고 세 질문이 **같은 무게가 아니다.** 마크를 지우는 것과 저장하는 것은
 * 되돌릴 수 있는 정도가 다르고, 그건 버튼이 말해야 한다 — 그래서 실행 버튼의
 * 역할을 호출부가 고른다. 기본은 COMMIT 이고, 잃을 것이 있는 질문만
 * DESTRUCTIVE 를 준다.
 */

/**
 * Above every screen this can be a child of, and above anything a screen adds
 * later.
 *
 * ── why this is not a z offset ──────────────────────────────────────────────
 * The obvious move is "park the dialog in front", and it was what this did:
 * veil at 1px, buttons at 2px. It did not work, for two reasons that a bigger
 * number does not fix.
 *
 * The menu scene is PERSPECTIVE. `unitsPerPixel` is the size of one framebuffer
 * pixel at the z = 0 plane exactly, so that a 128-texel plate covers 128
 * pixels; move the plate toward the camera and it is magnified by
 * `camZ / (camZ - z)`. The camera sits 896 pixels back, so 200px forward is a
 * 29% blow-up — a nearest-sampled plate at 1.29x is a stair-stepped plate. z is
 * the one axis this project cannot spend freely.
 *
 * And it would not have been enough anyway. `MarkEditor`'s cap is an OPAQUE
 * mesh, so it draws in the opaque pass, stamps the depth buffer, and then
 * rejects any depth-tested fragment behind its near face — which is where the
 * dialog was. The whole message and the 취소 button were inside the cap's
 * silhouette and simply gone. The editor's own controls sit at 50px, above
 * whatever the dialog could afford, so those punched through too.
 *
 * So the dialog stays on the crisp plane and states its order the way `Bottle`
 * does: by `renderOrder`, with the depth test switched off so solid geometry
 * cannot veto it. Both halves are needed — `renderOrder` only sorts within the
 * transparent pass, and the cap is not in it.
 */
const DIALOG_ORDER = 2000;

/** 질문 한 줄이 차지하는 높이. 448 패널 기준. */
const MESSAGE_HEIGHT = 56;

export class ConfirmDialog {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {number} unitsPerPixel  frame pixels to world units, as the menu uses
   */
  constructor({ retro, unitsPerPixel }) {
    const u = unitsPerPixel;
    this.root = new Group();
    this.root.visible = false;
    this.open = false;
    this._onConfirm = null;
    this._onCancel = null;
    this._u = u;
    this._panelKey = null;
    this._text = null;

    /**
     * The veil, and it is a MESH rather than a `.page-fade`.
     *
     * The DOM veil exists to cover the letterbox on the way out of a document;
     * this one has the opposite job — it must dim the menu and nothing else, and
     * it must be inside the render target so it is dithered with everything
     * under it. Drawn large enough to cover the frame at any sane camera.
     *
     * A real white texel rather than `map: null`: the sprite shader multiplies
     * the sampled alpha and discards below 0.004, so a mapless quad is an
     * invisible one however opaque its tint. See `solidTexture`.
     */
    this.veil = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, {
        map: solidTexture(),
        tint: PALETTE.ui.veil,
        opacity: 0.52,
        depthTest: false,
      }),
    );
    this.veil.scale.set(1400 * u, 1000 * u, 1);
    this.veil.position.set(0, 0, 0);
    this.veil.renderOrder = DIALOG_ORDER;
    this.root.add(this.veil);

    /**
     * 골격은 다른 화면과 같은 것을 쓴다 — 제목 탭 · 내용 · 구분선 · 푸터.
     *
     * 예전에는 질문 판 한 장과 버튼 두 개가 허공에 떠 있었다. 그것도 읽히기는
     * 하지만, 부록 B 가 골격을 정한 이유가 화면마다 다른 모양이 생기는 것을
     * 막기 위해서이므로 이것도 예외일 이유가 없다.
     */
    this.panel = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null, depthTest: false }),
    );
    this.panel.renderOrder = DIALOG_ORDER + 1;
    this.root.add(this.panel);

    this.message = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: solidTexture(), depthTest: false }),
    );
    this.message.renderOrder = DIALOG_ORDER + 2;
    this.root.add(this.message);

    /**
     * 두 버튼. **물러나는 것이 왼쪽이다.**
     *
     * 크기와 자리는 `solvePanel` 이 준다. 128x40 고정이었고, 640 프레임에서는
     * 맞지만 421 프레임에서는 둘이 합쳐 프레임 폭의 66% 가 됐다.
     */
    this._buttons = [
      { id: 'cancel', label: '취소', role: ROLE.RETREAT, side: -1 },
      { id: 'confirm', label: '확인', role: ROLE.COMMIT, side: 1 },
    ].map((def) => {
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        createSpriteMaterial(retro, { map: null, depthTest: false }),
      );
      mesh.renderOrder = DIALOG_ORDER + 3;
      this.root.add(mesh);
      return { ...def, mesh, maps: {}, baked: null };
    });

    this.layout(u);

    this._ray = new Raycaster();
    // 모든 레이어를 본다. `MenuItems` 의 같은 줄에 왜 필요한지 적혀 있다 —
    // 판은 `asUiLayer` 때문에 레이어 1 에 있고, 광선의 기본은 레이어 0 뿐이다.
    this._ray.layers.enableAll();
    this._ndc = new Vector2();
    this._hovered = null;
  }

  /**
   * 프레임에 맞춰 판을 푼다. 다른 세 화면과 같은 solver 다.
   *
   * 다시 굽는 것은 크기가 실제로 바뀌었을 때만이다 — 이 대화상자는 화면이
   * 살아 있는 내내 존재하고, 리사이즈마다 텍스처 넷을 새로 만들면 누수다.
   */
  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;

    const box = solvePanel({
      title: true,
      rows: [{ id: '#msg', h: MESSAGE_HEIGHT }],
      footer: this._buttons.length,
    });
    this._box = box;

    this.panel.scale.set(box.panel.w * u, box.panel.texH * u, 1);
    const msg = box.rows[0];
    this.message.scale.set(box.plate.width * u, msg.h * u, 1);
    this.message.position.set(0, msg.y * u, 0);

    const fb = box.footer.button;
    for (const b of this._buttons) {
      b.mesh.scale.set(fb.w * u, fb.h * u, 1);
      const x = b.side < 0 ? box.footer.left : box.footer.right;
      b.mesh.position.set(x * u, box.footer.y * u, 0);
    }

    const key = `${box.panel.w}x${box.panel.texH}`;
    if (key !== this._panelKey) {
      this._panelKey = key;
      const old = this.panel.material.uniforms.uMap.value;
      this.panel.material.uniforms.uMap.value = panelTexture({
        w: box.panel.w,
        h: box.panel.h,
        tabHeight: box.panel.tabHeight,
        title: '확인',
        footerHeight: box.footer.height,
        padTop: box.pad.top,
        padX: box.pad.x,
        scale: box.scale,
      });
      old?.dispose();
      for (const b of this._buttons) b.baked = null;
      this._text = null;
    }
    this._bakeButtons();
  }

  /** 두 버튼을 굽는다. 라벨과 역할이 캐시 키다. */
  _bakeButtons() {
    const fb = this._box.footer.button;
    const size = { width: fb.w, height: fb.h, scale: this._box.scale };
    for (const b of this._buttons) {
      const key = `${b.label}|${b.role}`;
      if (key === b.baked) continue;
      b.maps.idle?.dispose();
      b.maps.hover?.dispose();
      b.maps.idle = menuPlateTexture(b.label, { role: b.role, state: 'idle' }, size);
      b.maps.hover = menuPlateTexture(b.label, { role: b.role, state: 'hover' }, size);
      b.baked = key;
      b.mesh.material.uniforms.uMap.value = b.maps.idle;
    }
  }

  /**
   * Ask. `onConfirm` runs on the right-hand button; `onCancel` on the left one
   * and on nothing else — there is no dismiss-by-clicking-away, because the
   * questions this asks are all about work the player might be about to lose.
   *
   * @param {object} [o]
   * @param {string} [o.confirmLabel]
   *   실행 버튼이 뭐라고 말하는가. 기본 `확인` 은 아무것도 말하지 않으므로,
   *   무엇이 일어나는지 아는 호출부는 그것을 적어 주는 편이 낫다.
   * @param {boolean} [o.destructive]
   *   되돌릴 수 없는가. 세 질문이 같은 무게가 아니다 — 마크를 지우는 것과
   *   저장하는 것은 잃을 것이 다르고, 그건 버튼 색이 말해야 한다.
   */
  ask(text, { onConfirm, onCancel = null, confirmLabel = '확인', destructive = false } = {}) {
    const commit = this._buttons.find((b) => b.id === 'confirm');
    commit.label = confirmLabel;
    commit.role = destructive ? ROLE.DESTRUCTIVE : ROLE.COMMIT;
    this._bakeButtons();

    if (text !== this._text) {
      this._text = text;
      const box = { width: this._box.plate.width, height: this._box.rows[0].h, plate: false };
      this.message.material.uniforms.uMap.value = messageTexture(text, box);
    }
    this._onConfirm = onConfirm ?? null;
    this._onCancel = onCancel;
    this.open = true;
    this.root.visible = true;
    this.setHover(null);
  }

  close() {
    this.open = false;
    this.root.visible = false;
    this._onConfirm = null;
    this._onCancel = null;
    this.setHover(null);
  }

  /** @returns {{id: string}|null} */
  pick(canvas, camera, clientX, clientY) {
    if (!this.open) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, camera);
    this.root.updateMatrixWorld(true);
    for (const b of this._buttons) {
      if (this._ray.intersectObject(b.mesh, false).length) return { id: b.id };
    }
    // Open but not on a button: still a hit, so the caller knows to stop. The
    // veil swallows everything behind it — see the note on modality.
    return { id: null };
  }

  setHover(hit) {
    const id = hit?.id ?? null;
    if (id === this._hovered) return;
    this._hovered = id;
    for (const b of this._buttons) {
      b.mesh.material.uniforms.uMap.value = b.id === id ? b.maps.hover : b.maps.idle;
    }
  }

  /** Run whatever the press chose. Returns true if the dialog handled it. */
  activate(hit) {
    if (!this.open || !hit) return false;
    if (hit.id === 'confirm') {
      const fn = this._onConfirm;
      this.close();
      fn?.();
      return true;
    }
    if (hit.id === 'cancel') {
      const fn = this._onCancel;
      this.close();
      fn?.();
      return true;
    }
    // A press on the veil. Swallowed, deliberately.
    return true;
  }

  dispose() {
    this.veil.geometry.dispose();
    this.veil.material.dispose();
    this.panel.geometry.dispose();
    this.panel.material.uniforms.uMap.value?.dispose();
    this.panel.material.dispose();
    this.message.geometry.dispose();
    this.message.material.dispose();
    for (const b of this._buttons) {
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      b.maps.idle?.dispose();
      b.maps.hover?.dispose();
    }
    this.root.clear();
  }
}

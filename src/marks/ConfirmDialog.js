import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from '../menu/menuMaterials.js';
import { menuPlateTexture } from '../menu/menuTextures.js';
import { messageTexture, solidTexture } from './markIcons.js';
import { PALETTE } from '../core/palette.js';
import { frameScale } from '../core/frame.js';
import { SPACE } from '../core/tokens.js';
import { PLATE_TEXEL_SCALE } from '../menu/columnLayout.js';

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

    this.message = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: solidTexture(), depthTest: false }),
    );
    this.message.position.set(0, 34 * u, 0);
    this.message.renderOrder = DIALOG_ORDER + 1;
    this.root.add(this.message);

    /**
     * 두 버튼. 크기는 프레임을 따라간다.
     *
     * 128x40 고정이었다. 640 프레임에서는 맞고 421 프레임에서는 둘이 합쳐 프레임
     * 폭의 66% 가 된다 — 질문 판보다 버튼이 커 보이는 구도다.
     */
    const k = frameScale();
    const btn = { width: Math.round(128 * k), height: Math.round(40 * k) };
    this._btn = btn;
    this._buttons = [
      { id: 'confirm', label: '확인', side: -1 },
      { id: 'cancel', label: '취소', side: 1 },
    ].map((def) => {
      const box = { ...btn, scale: PLATE_TEXEL_SCALE };
      const maps = {
        idle: menuPlateTexture(def.label, 'idle', box),
        hover: menuPlateTexture(def.label, 'hover', box),
      };
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        createSpriteMaterial(retro, { map: maps.idle, depthTest: false }),
      );
      const x = def.side * (btn.width / 2 + SPACE.sm * k);
      mesh.scale.set(btn.width * u, btn.height * u, 1);
      mesh.position.set(x * u, -(btn.height / 2 + SPACE.xs * k) * u, 0);
      mesh.renderOrder = DIALOG_ORDER + 2;
      this.root.add(mesh);
      return { ...def, x, mesh, maps };
    });

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this._hovered = null;
    this._u = u;
  }

  /**
   * Ask. `onConfirm` runs on 확인; `onCancel` on 취소 and on nothing else —
   * there is no dismiss-by-clicking-away, because the questions this asks are
   * all about work the player might be about to lose.
   */
  ask(text, { onConfirm, onCancel = null } = {}) {
    const k = frameScale();
    const box = { width: Math.round(320 * k), height: Math.round(46 * k) };
    const map = messageTexture(text, box);
    this.message.material.uniforms.uMap.value = map;
    this.message.scale.set(box.width * this._u, box.height * this._u, 1);
    // 질문 판은 버튼 줄 바로 위에 앉는다. 예전에는 34 로 고정이라 421 프레임에서
    // 버튼과 겹쳤다.
    this.message.position.set(0, (box.height / 2 + SPACE.xs * k) * this._u, 0);
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
    this.message.geometry.dispose();
    this.message.material.dispose();
    for (const b of this._buttons) {
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
      b.maps.idle.dispose();
      b.maps.hover.dispose();
    }
    this.root.clear();
  }
}

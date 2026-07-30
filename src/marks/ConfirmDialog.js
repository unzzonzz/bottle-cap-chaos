import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from '../menu/menuMaterials.js';
import { menuPlateTexture } from '../menu/menuTextures.js';
import { messageTexture, solidTexture } from './markIcons.js';

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
   * @param {import('../core/RetroMaterial.js').RetroMaterials} retro
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
        tint: '#05070b',
        opacity: 0.74,
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

    this._buttons = [
      { id: 'confirm', label: '확인', x: -70 },
      { id: 'cancel', label: '취소', x: 70 },
    ].map((def) => {
      const maps = {
        idle: menuPlateTexture(def.label, 'idle', { width: 128, height: 40 }),
        hover: menuPlateTexture(def.label, 'hover', { width: 128, height: 40 }),
      };
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        createSpriteMaterial(retro, { map: maps.idle, depthTest: false }),
      );
      mesh.scale.set(128 * u, 40 * u, 1);
      mesh.position.set(def.x * u, -22 * u, 0);
      mesh.renderOrder = DIALOG_ORDER + 2;
      this.root.add(mesh);
      return { ...def, mesh, maps };
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
    const map = messageTexture(text, { width: 320, height: 46 });
    this.message.material.uniforms.uMap.value = map;
    this.message.scale.set(320 * this._u, 46 * this._u, 1);
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

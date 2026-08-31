import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, titleTexture } from './menuTextures.js';

/**
 * The four items, as flat plates standing in the scene.
 *
 * ── plates, not objects ─────────────────────────────────────────────────────
 * The temptation with a menu in a 3D scene is to make the items into things —
 * bottle crates, caps laid out on a table, letters extruded. At 320x240 with a
 * 15-bit quantiser on the way out, all of those stop being readable, and a menu
 * you cannot read is not a menu. So: quads, facing very nearly the camera,
 * carrying type drawn at ONE TEXEL PER FRAME PIXEL.
 *
 * That last part is the whole trick and it is why `MENU_CONFIG.items` is in
 * frame pixels rather than in world units. The plate is authored 128x26 and
 * placed at exactly the world size that lands on 128x26 of the 640x480 virtual
 * frame, so every texel of thresholded type meets one pixel of framebuffer and
 * nothing is resampled. Scale it by anything at all and the hard edges the
 * texture went to some trouble to have get averaged back into grey.
 *
 * The seven degrees of yaw is the concession to "in 3D space". It is enough to
 * see they are panels standing in a room and small enough that the affine UV
 * warp across one is under a texel.
 *
 * ── unlit, on purpose ───────────────────────────────────────────────────────
 * `createSpriteMaterial` rather than `retro.create`, so the plate arrives on
 * screen as the exact colours it was drawn in. Under the scene's key and fill a
 * plate would change brightness with where it sat, which for a signpost is a
 * defect. It still snaps to the framebuffer grid, still goes through the same
 * dither and the same five bits — it is unlit, not unfiltered.
 */

/** Frame pixels to world units at the plates' depth. Filled in by `layout`. */
const DEFAULT_ITEMS = [
  { id: 'knockout', label: '서바이벌' },
  { id: 'football', label: '축구' },
  { id: 'curling', label: '컬링' },
  { id: 'settings', label: '설정' },
];

export class MenuItems {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {object} tuning  the live `MENU_CONFIG.items` block
   */
  constructor({ retro, tuning, items = DEFAULT_ITEMS }) {
    this.tuning = tuning;
    this.root = new Group();

    this.title = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: titleTexture('BOTTLE CAP CHAOS', '메인 메뉴') }),
    );
    this.root.add(this.title);

    this.items = items.map((def) => {
      // Three textures per item and no re-drawing later. Building one is a
      // handful of canvas calls and two `getImageData` round trips — nothing
      // once, unthinkable on every hover.
      const size = { width: tuning.plateWidth, height: tuning.plateHeight };
      const maps = {
        idle: menuPlateTexture(def.label, 'idle', size),
        hover: menuPlateTexture(def.label, 'hover', size),
        disabled: menuPlateTexture(def.label, 'disabled', size),
      };
      const material = createSpriteMaterial(retro, {
        map: def.disabled ? maps.disabled : maps.idle,
      });
      const mesh = new Mesh(new PlaneGeometry(1, 1), material);
      mesh.renderOrder = 10;
      this.root.add(mesh);
      return { ...def, mesh, material, maps, hovered: false, shift: 0 };
    });

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    /** The item under the pointer, or null. */
    this.hovered = null;
    this.enabled = true;
    this._picks = this.items.filter((i) => !i.disabled).map((i) => i.mesh);
  }

  /**
   * Place everything, given how many world units one frame pixel is worth.
   *
   * Called once at boot and again whenever the panel moves the layout, rather
   * than every frame: none of it depends on time, and recomputing a fixed
   * layout sixty times a second is how a menu ends up drifting by a pixel.
   */
  layout(unitsPerPixel) {
    const t = this.tuning;
    const u = unitsPerPixel;
    const yaw = (t.yaw * Math.PI) / 180;

    const w = t.plateWidth * u;
    const h = t.plateHeight * u;
    const n = this.items.length;

    const title = this.title.material.uniforms.uMap.value.userData ?? { width: 256, height: 80 };
    this.title.scale.set(title.width * u, title.height * u, 1);
    this.title.position.set(t.columnX * u, (t.columnY + (n * t.pitch) / 2 + title.height * 0.72) * u, 0);
    this.title.rotation.y = yaw;

    this.items.forEach((item, i) => {
      const y = t.columnY + ((n - 1) / 2 - i) * t.pitch;
      item.home = { x: t.columnX * u, y: y * u };
      item.mesh.scale.set(w, h, 1);
      item.mesh.rotation.y = yaw;
      item.mesh.position.set(item.home.x, item.home.y, 0);
    });

    this._unitsPerPixel = u;
  }

  /**
   * @param {number} dt
   * @param {number} fade  0 hides the whole column; used while a run plays out
   */
  update(dt, fade = 1) {
    const t = this.tuning;
    for (const item of this.items) {
      // Eased rather than snapped, so the step forward reads as the plate
      // answering the pointer rather than as it teleporting.
      const want = item.hovered ? 1 : 0;
      const rate = dt / 0.09;
      item.shift += Math.max(-rate, Math.min(rate, want - item.shift));

      const push = item.shift * t.hoverShift;
      item.mesh.position.set(item.home.x + push, item.home.y, push * 1.4);
      item.material.uniforms.uOpacity.value = fade;
    }
    this.title.material.uniforms.uOpacity.value = fade;
  }

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('three').Camera} camera
   * @returns {object|null} the item under the pointer
   */
  pick(canvas, camera, clientX, clientY) {
    if (!this.enabled) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, camera);
    this.root.updateMatrixWorld(true);

    // Disabled plates are not in the list at all, rather than being tested and
    // then rejected. A 준비 중 item that lights up under the pointer before
    // refusing the press is worse than one that never responds.
    const hits = this._ray.intersectObjects(this._picks, false);
    const mesh = hits[0]?.object ?? null;
    return this.items.find((i) => i.mesh === mesh) ?? null;
  }

  setHover(item) {
    if (this.hovered === item) return;
    this.hovered = item;
    for (const it of this.items) {
      const on = it === item && !it.disabled;
      if (on === it.hovered) continue;
      it.hovered = on;
      if (it.disabled) continue;
      it.material.uniforms.uMap.value = on ? it.maps.hover : it.maps.idle;
    }
  }

  dispose() {
    this.title.geometry.dispose();
    this.title.material.uniforms.uMap.value.dispose();
    this.title.material.dispose();
    for (const item of this.items) {
      item.mesh.geometry.dispose();
      item.material.dispose();
      for (const m of Object.values(item.maps)) m.dispose();
    }
    this.root.clear();
  }
}

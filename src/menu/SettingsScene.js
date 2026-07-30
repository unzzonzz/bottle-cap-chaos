import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, titleTexture } from './menuTextures.js';

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
 */
export class SettingsScene {
  constructor({ retro, unitsPerPixel }) {
    this.root = new Group();
    const u = unitsPerPixel;

    this.title = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: titleTexture('설정', '') }),
    );
    // Same 1:1 texel-to-pixel rule as the menu's plates — see `MenuItems`.
    this.title.scale.set(256 * u, 80 * u, 1);
    this.title.position.set(0, 74 * u, 0);
    this.root.add(this.title);

    this.items = [
      { id: 'marks', label: '내 마크', y: 6 },
      { id: 'back', label: '◀ 메뉴로', y: -60 },
    ].map((def) => {
      const maps = {
        idle: menuPlateTexture(def.label, 'idle'),
        hover: menuPlateTexture(def.label, 'hover'),
      };
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        createSpriteMaterial(retro, { map: maps.idle }),
      );
      mesh.scale.set(256 * u, 52 * u, 1);
      mesh.position.set(0, def.y * u, 0);
      this.root.add(mesh);
      return { ...def, mesh, maps };
    });

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this._hovered = null;
  }

  /** @returns {{id: 'marks'|'back'}|null} */
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

  /**
   * @param {{id: string}|boolean|null} hit
   *   A boolean is still accepted because that is what this took when there was
   *   one row to hover, and `bootMenu` has more than one caller shape.
   */
  setHover(hit) {
    const id = hit && typeof hit === 'object' ? hit.id : hit ? 'back' : null;
    if (id === this._hovered) return;
    this._hovered = id;
    for (const item of this.items) {
      item.mesh.material.uniforms.uMap.value =
        item.id === id ? item.maps.hover : item.maps.idle;
    }
  }

  update() {}

  dispose() {
    this.title.geometry.dispose();
    this.title.material.uniforms.uMap.value.dispose();
    this.title.material.dispose();
    for (const item of this.items) {
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      item.maps.idle.dispose();
      item.maps.hover.dispose();
    }
    this.root.clear();
  }
}

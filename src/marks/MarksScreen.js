import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from '../menu/menuMaterials.js';
import { menuPlateTexture, titleTexture } from '../menu/menuTextures.js';
import { badgeTexture, iconTexture, tileTexture } from './markIcons.js';
import { markThumbnail, toMarkTexture } from './markTextures.js';
import { DEFAULT_MARK, SLOT_COUNT } from './MarkBook.js';

/**
 * 내 마크 — the grid, and the only way into the editor.
 *
 * ── the shape of the screen ─────────────────────────────────────────────────
 * A heading, the built-in logo on its own, five slots in a row, and a way back.
 * Everything is a quad in the shared menu scene at one texel per frame pixel,
 * which is `MenuItems`' arrangement — see its header for why plates beat objects
 * at this resolution. The one thing not copied from it is the seven degrees of
 * yaw: the brief asks for this screen to be square to the camera, and a slot
 * thumbnail seen at an angle is a thumbnail with a warped circle in it.
 *
 * ── assignment is two badges per tile, and that is the whole UI ─────────────
 * The brief wants P1 and P2 each able to choose from: the logo, any filled slot,
 * or nothing — with the current choice visible, both players allowed the same
 * mark, and every change immediate.
 *
 * A `1P` and a `2P` badge on every tile answers all of it at once. Pressing one
 * dresses that player in that mark; pressing a lit one takes it off, which IS
 * the "없음" option rather than a separate control for it. Two players wearing
 * one mark is two lit badges on one tile and nothing anywhere refuses it. And
 * because the badge lives ON the tile, "what is P1 wearing" is answered by
 * looking rather than by remembering.
 *
 * The alternative — a pair of pickers underneath — needs a list, a scroll, a
 * notion of a current selection, and it still has to show the answer somewhere.
 *
 * ── the logo tile is deliberately not a slot ────────────────────────────────
 * It sits apart, wears the gold edge the toolbar uses for "chosen", carries no
 * bin and does not open the editor for editing — pressing it opens the editor in
 * view mode, which is all the brief allows. Its badges work exactly like the
 * others, because being undeletable has nothing to do with being unwearable.
 */

/** Frame pixels. The whole layout, in one place. */
const L = {
  titleY: 168,
  logoY: 82,
  slotY: -30,
  tile: 76,
  /**
   * Wide enough for the badges to hang BELOW each tile without touching the
   * next one's. They were inside the tile first and covered the thumbnail —
   * a control for reading the assignment that hides the thing being assigned.
   */
  gap: 22,
  backY: -150,
  badge: { w: 32, h: 18 },
  /** How far under the tile the badge row sits. */
  badgeDrop: 12,
  trash: 22,
};

export class MarksScreen {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {number} unitsPerPixel
   * @param {import('./MarkBook.js').MarkBook} book
   * @param {HTMLCanvasElement|HTMLImageElement|null} defaultMark  the built-in logo
   * @param {(ref: number|typeof DEFAULT_MARK) => void} onOpen  open the editor
   * @param {() => void} onBack
   * @param {import('./ConfirmDialog.js').ConfirmDialog} confirm
   */
  constructor({ retro, unitsPerPixel, book, defaultMark, onOpen, onBack, confirm }) {
    const u = unitsPerPixel;
    this._u = u;
    this.book = book;
    this.defaultMark = defaultMark;
    this.onOpen = onOpen ?? (() => {});
    this.onBack = onBack ?? (() => {});
    this.confirm = confirm;
    this.root = new Group();

    this.title = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: titleTexture('내 마크', '뚜껑에 새길 그림') }),
    );
    this.title.scale.set(256 * u, 80 * u, 1);
    this.title.position.set(0, L.titleY * u, 0);
    this.root.add(this.title);

    /** @type {Array<ReturnType<MarksScreen['_buildTile']>>} */
    this.tiles = [];
    // The logo, alone above the row it is not part of.
    this.tiles.push(this._buildTile(retro, { ref: DEFAULT_MARK, x: 0, y: L.logoY, accent: true }));
    const span = SLOT_COUNT * L.tile + (SLOT_COUNT - 1) * L.gap;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = -span / 2 + L.tile / 2 + i * (L.tile + L.gap);
      this.tiles.push(this._buildTile(retro, { ref: i, x, y: L.slotY, accent: false }));
    }

    this.backMaps = {
      idle: menuPlateTexture('◀ 설정으로', 'idle'),
      hover: menuPlateTexture('◀ 설정으로', 'hover'),
    };
    this.back = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: this.backMaps.idle }),
    );
    this.back.scale.set(256 * u, 52 * u, 1);
    this.back.position.set(0, L.backY * u, 0);
    this.root.add(this.back);

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this._hover = null;
    this._unsubscribe = book.onChange(() => this.refresh());
    this.refresh();
  }

  _buildTile(retro, { ref, x, y, accent }) {
    const u = this._u;
    const maps = {
      idle: tileTexture('idle', { size: L.tile, accent }),
      hover: tileTexture('hover', { size: L.tile, accent }),
    };
    const plate = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(retro, { map: maps.idle }));
    plate.scale.set(L.tile * u, L.tile * u, 1);
    plate.position.set(x * u, y * u, 0);
    this.root.add(plate);

    // The thumbnail is redrawn in place rather than swapped, so nothing above
    // ever holds a disposed texture — the same contract `MarkTextures` keeps.
    const thumbCanvas = markThumbnail(null, 64);
    const thumb = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: toMarkTexture(thumbCanvas) }),
    );
    thumb.scale.set(62 * u, 62 * u, 1);
    thumb.position.set(x * u, y * u, 1 * u);
    this.root.add(thumb);

    const plus = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: iconTexture('plus', 'idle', { size: 28, plate: false }) }),
    );
    plus.scale.set(28 * u, 28 * u, 1);
    plus.position.set(x * u, y * u, 2 * u);
    this.root.add(plus);

    const trash = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: iconTexture('trash', 'hover', { size: L.trash, plate: true }) }),
    );
    trash.scale.set(L.trash * u, L.trash * u, 1);
    trash.position.set((x + L.tile / 2 - 13) * u, (y + L.tile / 2 - 13) * u, 3 * u);
    trash.visible = false;
    this.root.add(trash);

    const badges = [0, 1].map((player) => {
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        createSpriteMaterial(retro, { map: badgeTexture(player, false, L.badge) }),
      );
      mesh.scale.set(L.badge.w * u, L.badge.h * u, 1);
      // Under the tile, not on it: the thumbnail is the thing being chosen and
      // must stay entirely visible while choosing.
      mesh.position.set(
        (x + (player === 0 ? -L.badge.w / 2 - 1 : L.badge.w / 2 + 1)) * u,
        (y - L.tile / 2 - L.badgeDrop) * u,
        3 * u,
      );
      this.root.add(mesh);
      return { player, mesh, on: null };
    });

    return { ref, x, y, accent, plate, maps, thumb, thumbCanvas, plus, trash, badges };
  }

  // ── state ─────────────────────────────────────────────────────────────────

  /** Redraw every tile from the book. Cheap enough to run on any change. */
  refresh() {
    for (const tile of this.tiles) {
      const isDefault = tile.ref === DEFAULT_MARK;
      const filled = isDefault || this.book.hasSlot(tile.ref);

      // Empty slots show the `+` and no thumbnail; filled ones the reverse.
      tile.plus.visible = !filled;
      tile.thumb.visible = filled;
      if (filled) this._paintThumb(tile);

      for (const badge of tile.badges) {
        const on = this.book.assignedTo(badge.player) === tile.ref;
        // Only worn marks get a lit badge, and an empty slot cannot be worn —
        // its badges stay dark and pressing one does nothing. Enforced in
        // `activate` too; this is the half the player can see.
        if (badge.on !== on) {
          badge.on = on;
          badge.mesh.material.uniforms.uMap.value = badgeTexture(badge.player, on, L.badge);
        }
        badge.mesh.visible = filled;
      }
    }
    // A hover that pointed at something that has just gone needs re-resolving.
    this.setHover(this._hover);
  }

  _paintThumb(tile) {
    const art =
      tile.ref === DEFAULT_MARK ? this.defaultMark : this._decodedFor(tile.ref, tile);
    const fresh = markThumbnail(art, tile.thumbCanvas.width);
    const ctx = tile.thumbCanvas.getContext('2d');
    ctx.clearRect(0, 0, tile.thumbCanvas.width, tile.thumbCanvas.height);
    ctx.drawImage(fresh, 0, 0);
    tile.thumb.material.uniforms.uMap.value.needsUpdate = true;
  }

  /**
   * The decoded image for a slot, or null while it is still decoding.
   *
   * Same arrangement as `MarkTextures`: a stored mark is a PNG data URL, turning
   * one into pixels is asynchronous, and a grid cannot wait. The tile shows a
   * bare cap for a frame and is repainted when the image lands.
   */
  _decodedFor(index, tile) {
    const url = this.book.slotImage(index);
    if (!url) return null;
    this._decoded ??= new Map();
    const hit = this._decoded.get(url);
    if (hit) return hit;
    const img = new Image();
    img.onload = () => {
      this._decoded.set(url, img);
      // Only if this tile still wants this mark — the book may have moved on.
      if (this.book.slotImage(index) === url) this._paintThumb(tile);
    };
    img.onerror = () => {};
    img.src = url;
    return null;
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  /**
   * @returns {{kind: string, ref?: any, player?: number}|null}
   *   The dialog is asked FIRST and swallows everything while it is open — see
   *   `ConfirmDialog`'s note on modality.
   */
  pick(canvas, camera, clientX, clientY) {
    if (this.confirm?.open) {
      return { kind: 'dialog', hit: this.confirm.pick(canvas, camera, clientX, clientY) };
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, camera);
    this.root.updateMatrixWorld(true);

    for (const tile of this.tiles) {
      // Badges and the bin sit ON the tile, so they have to be asked first or
      // the tile underneath answers for them.
      for (const badge of tile.badges) {
        if (badge.mesh.visible && this._hits(badge.mesh)) {
          return { kind: 'badge', ref: tile.ref, player: badge.player };
        }
      }
      if (tile.trash.visible && this._hits(tile.trash)) {
        return { kind: 'trash', ref: tile.ref };
      }
      if (this._hits(tile.plate)) return { kind: 'tile', ref: tile.ref };
    }
    if (this._hits(this.back)) return { kind: 'back' };
    return null;
  }

  _hits(mesh) {
    return this._ray.intersectObject(mesh, false).length > 0;
  }

  setHover(hit) {
    this._hover = hit;
    if (this.confirm?.open) {
      this.confirm.setHover(hit?.hit ?? null);
      return;
    }
    const overRef = hit && (hit.kind === 'tile' || hit.kind === 'trash' || hit.kind === 'badge')
      ? hit.ref
      : null;
    for (const tile of this.tiles) {
      const on = tile.ref === overRef;
      tile.plate.material.uniforms.uMap.value = on ? tile.maps.hover : tile.maps.idle;
      /**
       * THE BIN APPEARS ON HOVER, AND NEVER ON THE LOGO.
       *
       * Two conditions, both from the brief: a filled slot shows it while the
       * pointer is over the tile, and the built-in logo does not show it at all
       * because it cannot be deleted. An empty slot has nothing to throw away.
       */
      tile.trash.visible =
        on && tile.ref !== DEFAULT_MARK && this.book.hasSlot(tile.ref);
    }
    this.back.material.uniforms.uMap.value =
      hit?.kind === 'back' ? this.backMaps.hover : this.backMaps.idle;
  }

  /** Act on a press. Returns true if this screen consumed it. */
  activate(hit) {
    if (!hit) return false;

    if (hit.kind === 'dialog') {
      this.confirm.activate(hit.hit);
      return true;
    }
    if (hit.kind === 'back') {
      this.onBack();
      return true;
    }
    if (hit.kind === 'badge') {
      // An empty slot cannot be worn. Nothing to say about it — the badge is
      // hidden anyway, and this is the guard for the hidden one being hit.
      if (hit.ref !== DEFAULT_MARK && !this.book.hasSlot(hit.ref)) return true;
      const already = this.book.assignedTo(hit.player) === hit.ref;
      // Pressing a lit badge is how "없음" is chosen. See the header.
      this.book.assign(hit.player, already ? null : hit.ref);
      return true;
    }
    if (hit.kind === 'trash') {
      this.confirm.ask('이 마크를 삭제하시겠습니까?', {
        onConfirm: () => this.book.clearSlot(hit.ref),
      });
      return true;
    }
    if (hit.kind === 'tile') {
      this.onOpen(hit.ref);
      return true;
    }
    return false;
  }

  update() {}

  dispose() {
    this._unsubscribe?.();
    for (const tile of this.tiles) {
      for (const m of [tile.plate, tile.thumb, tile.plus, tile.trash, ...tile.badges.map((b) => b.mesh)]) {
        m.geometry.dispose();
        m.material.dispose();
      }
      tile.maps.idle.dispose();
      tile.maps.hover.dispose();
      tile.thumb.material.uniforms.uMap.value?.dispose();
    }
    this.title.geometry.dispose();
    this.title.material.uniforms.uMap.value.dispose();
    this.title.material.dispose();
    this.back.geometry.dispose();
    this.back.material.dispose();
    this.backMaps.idle.dispose();
    this.backMaps.hover.dispose();
    this.root.clear();
  }
}

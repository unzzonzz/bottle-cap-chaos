import { anchorTopLeft } from '../menu/panelLayout.js';
import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from '../menu/menuMaterials.js';
import { menuPlateTexture, titleTexture } from '../menu/menuTextures.js';
import { badgeTexture, iconTexture, tileTexture } from './markIcons.js';
import { markThumbnail, toMarkTexture } from './markTextures.js';
import { DEFAULT_MARK, SLOT_COUNT } from './MarkBook.js';
import { FRAME, texelScale } from '../core/frame.js';
import { SPACE } from '../core/tokens.js';
import { PLATE_TEXEL_SCALE, solveColumn } from '../menu/columnLayout.js';

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
  titleHeight: 72,
  /** 640 프레임 기준의 칸 한 변. `frameScale()` 이 곱해진다. */
  tile: 76,
  /**
   * Wide enough for the badges to hang BELOW each tile without touching the
   * next one's. They were inside the tile first and covered the thumbnail —
   * a control for reading the assignment that hides the thing being assigned.
   */
  gap: 22,
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
  constructor({ retro, unitsPerPixel, book, defaultMark, onOpen, onBack, confirm, backLabel = '← BACK' }) {
    const u = unitsPerPixel;
    this._u = u;
    this.book = book;
    this.defaultMark = defaultMark;
    this.onOpen = onOpen ?? (() => {});
    this.onBack = onBack ?? (() => {});
    this.confirm = confirm;
    /** 뒤로가기가 무엇이라고 말하는가. `bootMenu` 가 들어온 문에서 정한다. */
    this.backLabel = backLabel;
    this.root = new Group();

    /**
     * 이 화면의 크기와 자리. `layout()` 이 프레임마다 다시 푼다.
     *
     * 예전에는 titleY 168 / logoY 82 / slotY -30 / backY -150 이 고정이었고, 480
     * 프레임에서만 들어갔다. 316 프레임에서는 제목이 위로, 뒤로 가기가 아래로
     * 잘렸고 칸 다섯 개가 좌우로 넘쳤다. 나머지 메뉴 화면들과 같은 해법을 쓴다 —
     * `columnLayout.solveColumn`.
     */
    this._box = null;

    this.title = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    this.root.add(this.title);

    /** @type {Array<ReturnType<MarksScreen['_buildTile']>>} */
    this.tiles = [];
    // The logo, alone above the row it is not part of.
    this.tiles.push(this._buildTile(retro, { ref: DEFAULT_MARK, accent: true }));
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.tiles.push(this._buildTile(retro, { ref: i, accent: false }));
    }

    this.backMaps = { idle: null, hover: null };
    this.back = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    this.root.add(this.back);
    this.layout(u);

    this._ray = new Raycaster();
    // 모든 레이어를 본다. `MenuItems` 의 같은 줄에 왜 필요한지 적혀 있다 —
    // 판은 `asUiLayer` 때문에 레이어 1 에 있고, 광선의 기본은 레이어 0 뿐이다.
    this._ray.layers.enableAll();
    this._ndc = new Vector2();
    this._hover = null;
    this._unsubscribe = book.onChange(() => this.refresh());
    this.refresh();
  }

  _buildTile(retro, { ref, accent }) {
    const plate = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(retro, { map: null }));
    this.root.add(plate);

    // The thumbnail is redrawn in place rather than swapped, so nothing above
    // ever holds a disposed texture — the same contract `MarkTextures` keeps.
    /**
     * 썸네일 캔버스 256. 64 였다.
     *
     * 칸은 화면에서 100 저술픽셀 안팎이고 디바이스 픽셀로는 그 2.5 배쯤 된다.
     * 64 짜리 그림을 거기 늘리면 그만큼 뭉개진다 — "저화질 감성" 의 정체가
     * 이것이었다. 256 이면 어느 창에서도 축소만 일어난다.
     */
    const thumbCanvas = markThumbnail(null, 256);
    const thumb = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: toMarkTexture(thumbCanvas) }),
    );
    this.root.add(thumb);

    const plus = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    this.root.add(plus);

    const trash = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    trash.visible = false;
    this.root.add(trash);

    const badges = [0, 1].map((player) => {
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        createSpriteMaterial(retro, { map: null }),
      );
      this.root.add(mesh);
      return { player, mesh, on: null };
    });

    return { ref, accent, plate, maps: { idle: null, hover: null }, thumb, thumbCanvas, plus, trash, badges };
  }

  /**
   * 제목 · 로고 칸 · 슬롯 줄 · 뒤로 가기를 한 열로 쌓고, 칸 크기를 프레임에 맞춘다.
   *
   * 슬롯 줄은 가로로도 넘칠 수 있다 — 다섯 칸에 간격까지 486 프레임 픽셀이라
   * 421 프레임에서는 양 끝이 화면 밖이었다. 세로로 푼 높이와 가로로 들어가는 폭 중
   * 작은 쪽을 칸 한 변으로 쓴다.
   */
  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;

    const box = solveColumn([
      { id: '#title', h: L.titleHeight },
      { id: '#logo', h: L.tile + L.badgeDrop + L.badge.h },
      { id: '#slots', h: L.tile + L.badgeDrop + L.badge.h },
      { id: '#back' },
    ]);
    this._box = box;
    const at = (id) => box.rows.find((r) => r.id === id);

    // 칸 한 변: 줄 높이가 허락하는 것과 프레임 폭이 허락하는 것 중 작은 쪽.
    const rowH = at('#slots').h;
    const gap = Math.round(L.gap * box.k);
    const wide = (FRAME.width - SPACE.md * 2 - (SLOT_COUNT - 1) * gap) / SLOT_COUNT;
    const badgeH = Math.round(L.badge.h * box.k);
    const drop = Math.round(L.badgeDrop * box.k);
    const tile = Math.max(24, Math.min(wide, rowH - drop - badgeH));
    const badge = { w: Math.round(L.badge.w * box.k), h: badgeH };
    const trashSize = Math.round(L.trash * box.k);
    this._tile = tile;
    this._badge = badge;
    this._trash = trashSize;

    const titleRow = at('#title');
    this.title.scale.set(box.plate.width * u, titleRow.h * u, 1);
    this.title.position.set(0, titleRow.y * u, 0);

    const backRow = at('#back');
    this.back.scale.set(box.plate.width * u, backRow.h * u, 1);
    this.back.position.set(0, backRow.y * u, 0);

    const span = SLOT_COUNT * tile + (SLOT_COUNT - 1) * gap;
    this.tiles.forEach((t, i) => {
      const logo = i === 0;
      const row = at(logo ? '#logo' : '#slots');
      // 칸의 중심은 배지 줄만큼 위로 올라간다 — 슬롯의 높이에는 배지가 포함된다.
      const cy = row.y + (drop + badge.h) / 2;
      /**
       * 칸도 **왼쪽**에 건다. 줄의 가운데가 아니다.
       *
       * `-span / 2` 는 칸 묶음을 자기 폭의 가운데에 맞추는 값이었고, 판이
       * 있을 때는 그것이 판의 가운데와 같았다. 판이 없어진 지금 기준은 목록의
       * 왼쪽 선이다 — `anchorTopLeft` 가 루트를 거기 갖다 놓는다.
       */
      const left = -box.plate.width / 2;
      const x = logo ? left + tile / 2 : left + tile / 2 + (i - 1) * (tile + gap);
      t.x = x;
      t.y = cy;
      t.plate.scale.set(tile * u, tile * u, 1);
      t.plate.position.set(x * u, cy * u, 0);
      t.thumb.scale.set(tile * 0.82 * u, tile * 0.82 * u, 1);
      t.thumb.position.set(x * u, cy * u, 1 * u);
      t.plus.scale.set(tile * 0.36 * u, tile * 0.36 * u, 1);
      t.plus.position.set(x * u, cy * u, 2 * u);
      t.trash.scale.set(trashSize * u, trashSize * u, 1);
      t.trash.position.set(
        (x + tile / 2 - trashSize / 2) * u,
        (cy + tile / 2 - trashSize / 2) * u,
        3 * u,
      );
      for (const b of t.badges) {
        b.mesh.scale.set(badge.w * u, badge.h * u, 1);
        b.mesh.position.set(
          (x + (b.player === 0 ? -badge.w / 2 - 1 : badge.w / 2 + 1)) * u,
          (cy - tile / 2 - drop) * u,
          3 * u,
        );
      }
    });

    const key = `${Math.round(tile)}:${box.plate.width}x${box.plate.height}`;
    if (key !== this._sizeKey) {
      this._sizeKey = key;
      for (const t of this.tiles) {
        t.maps.idle?.dispose();
        t.maps.hover?.dispose();
        // 칸의 테두리도 화면 배수로 굽는다. `tile` 은 저술 픽셀이라 그대로 쓰면
        // 레티나에서 선 하나가 두 픽셀에 걸쳐 흐려진다.
        const ts = Math.round(tile * texelScale());
        t.maps.idle = tileTexture('idle', { size: ts, accent: t.accent });
        t.maps.hover = tileTexture('hover', { size: ts, accent: t.accent });
        t.plus.material.uniforms.uMap.value = iconTexture('plus', 'idle', {
          size: Math.round(tile * 0.36),
        });
        t.trash.material.uniforms.uMap.value = iconTexture('trash', 'hover', {
          size: trashSize,
        });
        for (const b of t.badges) b.on = null;
      }
      this.backMaps.idle?.dispose();
      this.backMaps.hover?.dispose();
      const plateSize = { ...box.plate, scale: PLATE_TEXEL_SCALE };
      /**
       * 라벨이 고정 문자열이 아니다.
       *
       * "◀ 설정으로" 였고, 내 마크로 가는 문이 설정 안에 하나뿐일 때는 맞았다.
       * 메인 메뉴에서도 들어올 수 있게 되면서 그 문장이 거짓이 될 수 있다 —
       * 가 본 적 없는 곳으로 돌아간다고 말하는 버튼이다.
       */
      this.backMaps.idle = menuPlateTexture(this.backLabel, 'idle', plateSize);
      this.backMaps.hover = menuPlateTexture(this.backLabel, 'hover', plateSize);
      this.back.material.uniforms.uMap.value = this.backMaps.idle;
      this.title.material.uniforms.uMap.value?.dispose();
      this.title.material.uniforms.uMap.value = titleTexture('내 마크', '뚜껑에 새길 그림', {
        width: box.plate.width,
        height: titleRow.h,
        scale: PLATE_TEXEL_SCALE,
      });
    }
    this.refresh();
  
    anchorTopLeft(this.root, box, u);
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
          badge.mesh.material.uniforms.uMap.value = badgeTexture(badge.player, on, this._badge ?? L.badge);
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
        // 되돌릴 수 없다. 그림은 이 슬롯에만 있다.
        confirmLabel: '삭제',
        destructive: true,
      });
      return true;
    }
    if (hit.kind === 'tile') {
      this.onOpen(hit.ref);
      return true;
    }
    return false;
  }

  /**
   * 이 화면도 프레임마다 할 일이 없다.
   *
   * 칸의 호버 배율을 밀던 자리다. 특히 이 화면에서는 없는 편이 맞다 — 칸이
   * 커지면 그 안의 **그림**이 커지는데, 마크를 고르는 화면에서 그림 크기가 포인터에
   * 따라 변하면 비교가 안 된다. 액자 텍스처 교체는 `setHover` 가 그대로 한다.
   */
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

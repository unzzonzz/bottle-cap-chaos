import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, titleTexture } from './menuTextures.js';
import { FRAME } from '../core/frame.js';
import { MOTION, SPACE } from '../core/tokens.js';
import { approach } from '../ui/motion.js';

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

/**
 * 메뉴 판 텍스처의 텍셀 배수.
 *
 * 게임 쪽 `config.ui.textureScale` 과 같은 일을 하지만, 메뉴는 별도 문서라 그
 * 설정을 읽지 않는다. 2 인 이유는 레티나(DPR 2)에서 텍셀 하나가 화면 픽셀 하나가
 * 되는 지점이기 때문이고, 그 위는 메뉴 판 열두 장에 쓰기엔 낭비다.
 */
const PLATE_TEXEL_SCALE = 2;

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
      createSpriteMaterial(retro, {
        map: titleTexture('BOTTLE CAP CHAOS', '메인 메뉴', {
          width: Math.round(tuning.plateWidth),
          height: Math.round(tuning.plateWidth * 0.5),
          scale: PLATE_TEXEL_SCALE,
        }),
      }),
    );
    this.root.add(this.title);

    this.items = items.map((def) => {
      // Three textures per item and no re-drawing later. Building one is a
      // handful of canvas calls — nothing once, unthinkable on every hover.
      const maps = this._bake(def.label);
      const material = createSpriteMaterial(retro, {
        map: def.disabled ? maps.disabled : maps.idle,
      });
      const mesh = new Mesh(new PlaneGeometry(1, 1), material);
      mesh.renderOrder = 10;
      this.root.add(mesh);
      return { ...def, mesh, material, maps, hovered: false, shift: 0 };
    });

    this._ray = new Raycaster();
    /**
     * 이 레이캐스터는 **모든 레이어**를 본다.
     *
     * ── 메뉴 버튼이 눌리지 않던 이유 ──────────────────────────────────────
     * PHASE 1 이 블룸을 들이면서 `bootMenu.asUiLayer` 가 생겼다. 판에 블룸이 먹으면
     * 글자가 뭉개지므로, 판과 그 자식 전부를 `UI_LAYER`(1)로 옮기고 월드 패스와 UI
     * 패스를 카메라 레이어로 갈라 그린다.
     *
     * `new Raycaster()` 의 기본 레이어는 0 하나다. 판은 1 에 있으므로 `layers.test`
     * 가 언제나 거짓이 되고, 광선은 판을 **시험조차 하지 않는다** — 아무 오류도
     * 나지 않고, 화면은 멀쩡하고, 누르면 아무 일도 일어나지 않는다.
     *
     * 여기서 `enableAll` 이 안전한 이유는 이 광선이 언제나 명시적인 객체 목록을
     * 받기 때문이다. 레이어는 무엇을 **그릴지** 고르는 장치이지 무엇을 **맞힐지**
     * 고르는 장치가 아니고, 이 파일에서 후자는 목록이 정한다.
     */
    this._ray.layers.enableAll();
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
  /**
   * 한 항목의 세 상태 텍스처.
   *
   * 판 크기가 프레임에 따라 변하므로 — `bootMenu.applyArrangement` 를 보라 —
   * 부팅 때 한 번이 아니라 크기가 바뀔 때마다 필요하다. 그래서 함수로 뺐다.
   */
  _bake(label) {
    const t = this.tuning;
    const size = {
      width: Math.round(t.plateWidth),
      height: Math.round(t.plateHeight),
      scale: PLATE_TEXEL_SCALE,
    };
    return {
      idle: menuPlateTexture(label, 'idle', size),
      hover: menuPlateTexture(label, 'hover', size),
      disabled: menuPlateTexture(label, 'disabled', size),
    };
  }

  /**
   * 판 크기가 바뀌었으면 텍스처를 다시 굽는다.
   *
   * ── 왜 필요한가 ────────────────────────────────────────────────────────
   * 가로 화면에서 판 폭은 프레임에 비례한다. 640 폭 프레임에서 256 이던 판은 421
   * 프레임에서 168 이고, 텍스처를 그대로 두면 168 폭 쿼드에 256 폭 그림이 눌려
   * 붙는다 — 글자가 가로로 압축돼 보인다.
   *
   * 크기가 같으면 아무것도 하지 않는다. `layout()` 은 리사이즈마다 불리므로
   * 이 가드가 없으면 창을 끌 때마다 항목 수 x 3 장을 다시 굽는다.
   */
  _rebakeIfResized() {
    const t = this.tuning;
    const key = `${Math.round(t.plateWidth)}x${Math.round(t.plateHeight)}`;
    if (key === this._plateKey) return;
    this._plateKey = key;
    for (const item of this.items) {
      const next = this._bake(item.label);
      for (const tex of Object.values(item.maps)) tex.dispose();
      item.maps = next;
      item.material.uniforms.uMap.value = item.disabled
        ? next.disabled
        : item.hovered
          ? next.hover
          : next.idle;
    }
    const title = this.title.material.uniforms.uMap.value;
    const titleW = Math.round(t.plateWidth);
    this.title.material.uniforms.uMap.value = titleTexture('BOTTLE CAP CHAOS', '메인 메뉴', {
      width: titleW,
      height: Math.round(titleW * 0.5),
      scale: PLATE_TEXEL_SCALE,
    });
    title.dispose();
  }

  layout(unitsPerPixel) {
    const t = this.tuning;
    const u = unitsPerPixel;
    const yaw = (t.yaw * Math.PI) / 180;
    this._rebakeIfResized();

    const w = t.plateWidth * u;
    const h = t.plateHeight * u;
    const n = this.items.length;

    /**
     * 제목판과 항목들은 **하나의 덩어리**로 배치되고, 그 덩어리가 프레임에 맞춰
     * 잘리지 않도록 위로 밀린 만큼 다시 내려온다.
     *
     * 예전에는 제목을 항목 열 위에 `title.height * 0.72` 만큼 띄워 놓기만 했다.
     * 제목판이 52 였을 때는 우연히 화면 안에 들어갔고, 두 줄 머리글을 담느라 84 가
     * 되자 위쪽이 프레임 밖으로 나갔다. 덩어리 전체 높이를 재서 배치하면 판이 몇
     * 픽셀이든 그런 일이 없다.
     */
    const title = this.title.material.uniforms.uMap.value.userData ?? { width: 256, height: 80 };
    // 판 사이 간격은 항목 사이와 같아야 한 열로 읽힌다. 제목만 더 붙으면
    // 제목이 첫 항목의 머리처럼 보인다.
    const titleGap = Math.max(SPACE.md, Math.round(t.pitch - t.plateHeight));
    const itemsTop = t.columnY + ((n - 1) / 2) * t.pitch + t.plateHeight / 2;
    let titleY = itemsTop + titleGap + title.height / 2;

    /**
     * 프레임 위 가장자리를 넘으면 덩어리 전체를 그만큼 내린다.
     *
     * 제목만 내리면 항목과 겹친다 — 겹친 두 판은 잘린 한 판보다 나쁘다.
     */
    const ceiling = FRAME.height / 2 - SPACE.md;
    const over = Math.max(0, titleY + title.height / 2 - ceiling);
    titleY -= over;
    const shift = -over;

    this.title.scale.set(title.width * u, title.height * u, 1);
    this.title.position.set(t.columnX * u, titleY * u, 0);
    this.title.rotation.y = yaw;

    this.items.forEach((item, i) => {
      const y = t.columnY + ((n - 1) / 2 - i) * t.pitch + shift;
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
    const u = this._unitsPerPixel ?? 1;
    for (const item of this.items) {
      /**
       * ── 호버는 아무것도 하지 않는다 ──────────────────────────────────────
       * 판이 `hoverShift` 만큼 앞으로(그리고 오른쪽으로) 나왔다. 사용자가 상호작용
       * 효과를 전부 빼 달라고 했고, 이 이동도 그 하나다.
       *
       * `shift` 는 계속 민다. 값을 읽는 곳이 없어졌지만 진행도 자체는 이 열이
       * 호버를 안다는 사실이고, 되돌리려면 여기 한 줄이면 된다 — `hoverShift` 도
       * `menuConfig` 에 그대로 있다. 지운 것은 **적용**이지 개념이 아니다.
       */
      item.shift = approach(item.shift, item.hovered ? 1 : 0, dt, MOTION.hover);
      item.mesh.position.set(item.home.x, item.home.y, 0);
      item.mesh.scale.set(t.plateWidth * u, t.plateHeight * u, 1);
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

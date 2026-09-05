import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { iconPlateTexture, menuPlateTexture, navMarkerTexture } from './menuTextures.js';
import { FRAME } from '../core/frame.js';
import { MOTION, ROLE, SIZE, SPACE } from '../core/tokens.js';

/** 저술 기준 판 폭. 아이콘 버튼이 프레임 배수를 되읽는 기준이다. */
const DEFAULT_PLATE_WIDTH = 256;
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

/**
 * 열에 서는 것. **두 페이지다.**
 *
 * ── 한 페이지였고, 모드 셋이 전부였다 ──────────────────────────────────────
 * 설정이 여기 있다가 아이콘으로 내려간 적이 있고, 그 근거는 좋았다: 네 판이 같은
 * 크기·같은 모양·같은 열에 있었는데 앞의 셋은 모드 선택이고 설정은 화면 이동이며,
 * 메뉴에 온 사람은 게임을 하러 온 것이다.
 *
 * §14 가 홈에 `PLAY / COLLECTION / SETTINGS` 를 요구하고 사용자가 그 구조를
 * 골랐으므로, 모드 셋은 `PLAY` 안으로 들어간다. 게임까지 한 번 더 눌러야 하고
 * 그것이 이 결정의 값이다 — 홈이 **게임의 목차**가 되고, 목차에는 모드 이름이
 * 아니라 할 수 있는 일이 적혀 있다.
 *
 * ── 페이지는 새 씬이 아니라 열의 내용이다 ──────────────────────────────────
 * `PlayScene` 을 새로 만들지 않는 이유는 그것이 이 열과 같은 것을 다시 짓는
 * 일이기 때문이다 — 같은 배치, 같은 레이캐스트, 같은 굽기. 열이 무엇을 담는지만
 * 바꾸면 되고, 그러면 레이캐스트 목록이 하나로 남는다는 성질도 그대로다.
 */
const PAGES = {
  home: [
    { id: 'play', label: 'PLAY' },
    { id: 'collection', label: 'COLLECTION' },
    { id: 'settings', label: 'SETTINGS' },
  ],
  play: [
    { id: 'knockout', label: '서바이벌' },
    { id: 'football', label: '축구' },
    { id: 'curling', label: '컬링' },
    { id: 'home', label: '뒤로', role: ROLE.RETREAT },
  ],
};

/**
 * 열 밖의 것: 필요할 때만 찾는 것.
 *
 * 내 마크만 남는다. 설정이 열로 돌아갔으므로 아이콘은 하나이고, 그 하나는
 * 설정 안에 묻혀 있었다는 이유로 여기 있다 — 뚜껑에 새길 그림은 이 게임에서
 * 사람들이 실제로 바꾸는 유일한 것인데 음량 슬라이더 아래 네 번째 줄에 있었다.
 */
const DEFAULT_TOOLS = [{ id: 'marks', icon: 'marks' }];

export class MenuItems {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {object} tuning  the live `MENU_CONFIG.items` block
   */
  constructor({ retro, tuning, tools = DEFAULT_TOOLS }) {
    this.tuning = tuning;
    this.root = new Group();
    this._retro = retro;
    /** Which page the column is showing. `setPage` swaps it. */
    this.page = 'home';

    /**
     * 두 페이지 중 **긴 쪽**만큼 메시를 만들어 두고 재사용한다.
     *
     * 페이지마다 메시를 짓고 버리면 레이캐스트 목록과 머티리얼을 매번 다시
     * 엮어야 하고, 그 배선이 이 파일에서 이미 한 번 틀렸던 곳이다(레이어 1).
     * 슬롯을 고정해 두면 페이지 전환은 텍스처와 `visible` 만 바꾸는 일이 된다.
     */
    const slots = Math.max(...Object.values(PAGES).map((p) => p.length));
    this.items = Array.from({ length: slots }, () => {
      const material = createSpriteMaterial(retro, { map: null });
      const mesh = new Mesh(new PlaneGeometry(1, 1), material);
      mesh.renderOrder = 10;
      this.root.add(mesh);
      return { id: null, label: '', role: null, mesh, material, maps: null, hovered: false, shift: 0 };
    });

    /**
     * 열 밖의 아이콘 버튼. 판과 **같은 목록**에 들어가야 눌린다.
     *
     * 별도의 레이캐스트를 만들지 않는 이유는 부록 B3.3 이 지적한 것과 같다:
     * 판은 `asUiLayer` 때문에 레이어 1 에 있고, 기본 레이어만 보는 광선은 그것을
     * 시험조차 하지 않는다. 목록이 하나면 그 사실을 한 번만 맞히면 된다.
     */
    this.tools = tools.map((def) => {
      const maps = this._bakeTool(def.icon);
      const material = createSpriteMaterial(retro, { map: maps.idle });
      const mesh = new Mesh(new PlaneGeometry(1, 1), material);
      mesh.renderOrder = 10;
      this.root.add(mesh);
      return { ...def, mesh, material, maps, hovered: false, isTool: true };
    });

    /**
     * 지금 가리키는 항목 옆에 서는 고리. 항목 사이를 **미끄러진다.**
     *
     * 호버를 텍스처 교체로만 표현하면 상태가 두 개인 스위치가 되고, 그 사이에
     * 아무 일도 일어나지 않는다. 이 하나가 열에 **연속성**을 준다 — 어디서
     * 어디로 갔는지가 보인다.
     */
    this.marker = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: navMarkerTexture(), opacity: 0 }),
    );
    this.marker.renderOrder = 11;
    this.root.add(this.marker);
    /** 마커의 스프링 상태. 위치와 불투명도가 따로 움직인다. */
    this._mark = { y: 0, vy: 0, o: 0, vo: 0, has: false };

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
    this._plateKey = '';
    this.setPage('home');
  }

  /**
   * Which page the column is showing, and everything that follows from it.
   *
   * ── the live items are the visible ones, and that is the whole guard ─────
   * `_picks` is rebuilt from the slots this page actually fills, so a slot left
   * over from the longer page cannot be hovered or pressed. Hiding a mesh is
   * not enough on its own — `Raycaster` skips invisible objects, but `hovered`
   * could still be holding one from before the swap, which is why it is cleared
   * here rather than left to the next `pick`.
   */
  setPage(name) {
    const defs = PAGES[name] ?? PAGES.home;
    this.page = name;
    this.hovered = null;
    this.items.forEach((item, i) => {
      const def = defs[i] ?? null;
      item.id = def?.id ?? null;
      item.label = def?.label ?? '';
      item.role = def?.role ?? null;
      item.disabled = def?.disabled ?? false;
      item.hovered = false;
      item.mesh.visible = !!def;
    });
    this._plateKey = '';
    this._rebakeIfResized();
    this._picks = [
      ...this.items.filter((i) => i.id && !i.disabled),
      ...this.tools,
    ].map((i) => i.mesh);
    if (this._unitsPerPixel) this.layout(this._unitsPerPixel);
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
  _bake(label, role) {
    const t = this.tuning;
    const size = {
      width: Math.round(t.plateWidth),
      height: Math.round(t.plateHeight),
      scale: PLATE_TEXEL_SCALE,
      // 이 열은 종이가 아니라 물 위에 앉는다. 잉크가 뒤집힌다.
      onWater: true,
    };
    // `role` is passed through so 뒤로 gets its left arrow. Everything else on
    // these two pages is a CHOICE and takes the default.
    const spec = (state) => (role ? { role, state } : state);
    return {
      idle: menuPlateTexture(label, spec('idle'), size),
      hover: menuPlateTexture(label, spec('hover'), size),
      disabled: menuPlateTexture(label, spec('disabled'), size),
    };
  }

  /** 아이콘 버튼 한 개의 두 상태. */
  _bakeTool(icon) {
    const size = Math.round(SIZE.buttonIcon.w * this._toolScale());
    return {
      idle: iconPlateTexture(icon, 'idle', { size, scale: PLATE_TEXEL_SCALE, onWater: true }),
      hover: iconPlateTexture(icon, 'hover', { size, scale: PLATE_TEXEL_SCALE, onWater: true }),
    };
  }

  /**
   * 아이콘 버튼의 프레임 배수.
   *
   * 판과 같은 비율로 줄어야 한다 — `bootMenu.scaleColumn` 이 `plateWidth` 를
   * 저술값에서 줄이므로, 그 비율을 여기서 되읽는다. 따로 계산하면 좁은 프레임에서
   * 아이콘만 크게 남는다.
   */
  _toolScale() {
    return Math.min(1, this.tuning.plateWidth / DEFAULT_PLATE_WIDTH);
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
      if (item.maps) for (const tex of Object.values(item.maps)) tex.dispose();
      if (!item.id) {
        item.maps = null;
        continue;
      }
      const next = this._bake(item.label, item.role);
      item.maps = next;
      item.material.uniforms.uMap.value = item.disabled
        ? next.disabled
        : item.hovered
          ? next.hover
          : next.idle;
    }
    for (const tool of this.tools) {
      const next = this._bakeTool(tool.icon);
      for (const tex of Object.values(tool.maps)) tex.dispose();
      tool.maps = next;
      tool.material.uniforms.uMap.value = tool.hovered ? next.hover : next.idle;
    }

  }

  layout(unitsPerPixel) {
    const t = this.tuning;
    const u = unitsPerPixel;
    const yaw = (t.yaw * Math.PI) / 180;
    this._rebakeIfResized();

    const w = t.plateWidth * u;
    const h = t.plateHeight * u;
    const live = this.items.filter((i) => i.id);
    const n = live.length;

    /**
     * 열은 **오른쪽 아래**에 오른쪽 맞춤으로 선다.
     *
     * ── 왜 가운데 열이 아니라 구석인가 ──────────────────────────────────────
     * 제목이 화면을 가로지르는 오브제가 되면서 가운데를 비워야 했다. 그리고 이
     * 구조에서 내비는 주인공이 아니다 — 작고, 조용하고, 구석에 있다가 커서가
     * 오면 대답하는 것이다.
     *
     * 오른쪽 맞춤인 이유는 제목이 왼쪽에서 잘려 들어오기 때문이다. 둘이 같은
     * 쪽에 몰리면 화면 한쪽만 무거워진다.
     */
    const margin = SPACE.xl;
    const right = FRAME.width / 2 - margin;
    const bottom = -FRAME.height / 2 + margin;

    live.forEach((item, i) => {
      // 배열의 첫 항목이 **위**에 오도록 아래에서부터 쌓는다.
      const y = bottom + (n - 1 - i) * t.pitch + t.plateHeight / 2;
      const x = right - t.plateWidth / 2;
      item.home = { x: x * u, y: y * u };
      item.mesh.scale.set(w, h, 1);
      item.mesh.rotation.y = yaw;
      item.mesh.position.set(item.home.x, item.home.y, 0);
    });

    /**
     * 아이콘 버튼은 열 **위**, 같은 오른쪽 선에 맞춘다.
     *
     * 아래가 아니라 위인 것은 열이 이미 프레임 바닥에 붙어 있기 때문이다.
     */
    const icon = Math.round(SIZE.buttonIcon.w * this._toolScale());
    const gap = Math.round(SPACE.md * this._toolScale());
    const topY = bottom + (n - 1) * t.pitch + t.plateHeight / 2;
    const toolY = topY + t.plateHeight / 2 + gap + icon / 2;
    const last = this.tools.length - 1;
    this.tools.forEach((tool, i) => {
      const x = right - icon / 2 - (last - i) * (icon + gap);
      tool.home = { x: x * u, y: toolY * u };
      tool.mesh.scale.set(icon * u, icon * u, 1);
      tool.mesh.rotation.y = yaw;
      tool.mesh.position.set(tool.home.x, tool.home.y, 0);
    });

    /** 마커는 열의 왼쪽 바깥에 선다. 크기는 프레임을 따라 줄어든다. */
    const md = Math.round(10 * this._toolScale());
    this._markerX = (right - t.plateWidth - SPACE.sm) * u;
    this.marker.scale.set(md * u, md * u, 1);
    this.marker.position.set(this._markerX, this._mark.y, 0);

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
      // 빈 슬롯. 이 페이지가 안 쓰는 자리이고 `home` 이 없으므로 배치도 없다.
      if (!item.id) continue;
      /**
       * ── 호버가 다시 무언가를 한다. 다만 판이 아니라 **열**이 반응한다 ──────
       * 예전에 뺀 것은 판이 앞으로 튀어나오는 것이었다 — 판이 물체처럼 굴었고,
       * 사용자가 그걸 원하지 않았다. 여기 있는 것은 다른 종류다: 판은 그대로
       * 있고 **가리켜진 것 말고 나머지가 물러난다.** 인쇄물에서 한 줄을 손가락으로
       * 짚으면 나머지가 뒤로 가는 것과 같고, 판이 물체가 되지 않는다.
       *
       * 짚은 줄만 가장자리 쪽으로 아주 조금 나간다 — 6 프레임픽셀. 그보다 크면
       * 열이 흔들리는 것으로 보인다.
       */
      item.shift = approach(item.shift, item.hovered ? 1 : 0, dt, MOTION.hover);
      const any = this.hovered != null;
      const dim = any && !item.hovered ? 0.42 : 1;
      item.dim = approach(item.dim ?? 1, dim, dt, MOTION.hover);
      item.mesh.position.set(item.home.x + item.shift * 6 * u, item.home.y, 0);
      item.mesh.scale.set(t.plateWidth * u, t.plateHeight * u, 1);
      item.material.uniforms.uOpacity.value = fade * item.dim;
    }

    /**
     * 마커. 가리켜진 줄로 미끄러지고, 아무것도 안 가리키면 사라진다.
     *
     * 임계 감쇠 스프링을 손으로 적분한다 — `approach` 는 지수 접근이라 목표에
     * 붙기만 하고 **미끄러지지** 않는다. 열 사이를 건너뛰는 움직임에는 속도가
     * 필요하고, 속도가 있어야 어디서 왔는지가 보인다.
     */
    const m = this._mark;
    const target = this.hovered && this.hovered.home ? this.hovered.home.y : m.y;
    const has = !!(this.hovered && this.hovered.home);
    const spring = (x, v, to, w) => {
      const f = 1 + 2 * dt * w, oo = w * w, dtoo = dt * oo, det = f + dt * dtoo;
      const nv = (v + dtoo * (to - x)) / det;
      return [(f * x + dt * nv + dt * dtoo * to) / det, nv];
    };
    [m.y, m.vy] = spring(m.y, m.vy, target, 13);
    [m.o, m.vo] = spring(m.o, m.vo, has ? 1 : 0, 16);
    this.marker.position.set(this._markerX ?? 0, m.y, 0);
    this.marker.material.uniforms.uOpacity.value = fade * Math.max(0, m.o);
    this.marker.visible = m.o > 0.004;
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
    return [...this.items, ...this.tools].find((i) => i.mesh === mesh) ?? null;
  }

  setHover(item) {
    if (this.hovered === item) return;
    this.hovered = item;
    for (const it of [...this.items, ...this.tools]) {
      const on = it === item && !it.disabled;
      if (on === it.hovered) continue;
      it.hovered = on;
      if (it.disabled) continue;
      it.material.uniforms.uMap.value = on ? it.maps.hover : it.maps.idle;
    }
  }

  dispose() {
    this.marker.geometry.dispose();
    this.marker.material.uniforms.uMap.value?.dispose();
    this.marker.material.dispose();
    for (const item of [...this.items, ...this.tools]) {
      item.mesh.geometry.dispose();
      item.material.dispose();
      for (const m of Object.values(item.maps)) m.dispose();
    }
    this.root.clear();
  }
}

import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { PALETTE } from '../core/palette.js';
import { createSpriteMaterial } from './menuMaterials.js';
import { dateStampTexture, iconPlateTexture, navLabelTexture, ruleTexture } from './menuTextures.js';
import { FRAME, frameScale } from '../core/frame.js';
import { MOTION, ROLE, RULE, SIZE, SPACE } from '../core/tokens.js';

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

/* ── 내비의 값. 전부 C 시안에서 그대로 옮긴 것이다 (프레임 853x480 기준) ──── */
/** 첫 항목. 이 화면의 주된 행동이라 한 단계 크다. */
const NAV_LEAD = 12;
/** 나머지. */
const NAV_SIZE = 10;
/** 자간, em 배수. 시안의 `letter-spacing: .2em`. */
const NAV_TRACKING = 0.2;
/** 항목 사이. 시안의 `gap: 24px`. */
const NAV_GAP = 24;
/** 오른쪽·아래 여백. 시안의 `right: 30; bottom: 28`. */
const NAV_RIGHT = 30;
const NAV_BOTTOM = 28;
/** 밑줄이 글자 아래로 떨어지는 거리. 시안의 `bottom: -6px`. */
const NAV_RULE_DROP = 6;
/** 좌하단 숫자. 시안의 `left: 30; bottom: 26`. */
const STAMP_LEFT = 30;
const STAMP_BOTTOM = 26;

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
      const ruleMat = createSpriteMaterial(retro, { map: this._ruleMap, opacity: 0 });
      const rule = new Mesh(new PlaneGeometry(1, 1), ruleMat);
      rule.renderOrder = 11;
      this.root.add(rule);
      return {
        id: null, label: '', role: null, mesh, material, map: null,
        rule, ruleMat, hovered: false, shift: 0, grow: { x: 0, v: 0 },
      };
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
     * 항목마다 밑줄 쿼드 하나. C 시안의 상호작용이 이것이다.
     *
     * 텍스처에 구워 넣지 않는 이유는 **자라야** 하기 때문이다. 호버에서 왼쪽부터
     * 오른쪽으로 늘어나고, 손을 떼면 같은 방향으로 줄어든다 — 두 상태 사이에
     * 실제로 무슨 일이 일어나는지가 보여야 상호작용이 된다.
     */
    this._ruleMap = ruleTexture();

    /**
     * 좌하단의 숫자. 눌리지 않으므로 `_picks` 에 넣지 않는다.
     *
     * 구도의 추다 — 제목이 왼쪽 위에서 들어오고 내비가 오른쪽 아래에 앉으면
     * 왼쪽 아래가 빈다. 자세한 것은 `dateStampTexture`.
     */
    this.stamp = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: dateStampTexture() }),
    );
    this.stamp.renderOrder = 10;
    this.root.add(this.stamp);

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
      item.lead = i === 0;
      item.mesh.visible = !!def;
      if (item.rule) item.rule.visible = !!def;
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
  /**
   * 한 항목의 텍스처. **글자만**, 자기 폭에 맞춰.
   *
   * C 시안의 값이다: 첫 항목 12px 차가운 흰색, 나머지 10px 옅은 파랑, 자간
   * 0.2em. 첫 항목이 큰 것은 그것이 이 화면의 주된 행동이기 때문이고, 그
   * 위계를 굵기가 아니라 **크기와 색**으로 만드는 것이 단일 웨이트 서체의 규칙이다.
   *
   * 상태별 텍스처가 없다. 호버는 밑줄과 불투명도가 맡고, 둘 다 매 프레임 움직이는
   * 값이라 구울 수 없다.
   */
  _bake(label, lead) {
    const size = lead ? NAV_LEAD : NAV_SIZE;
    return navLabelTexture(label, {
      size,
      // 색은 하나다. 위계는 크기가 만든다 — `PALETTE.water.ink` 의 주석 참조.
      color: PALETTE.water.ink,
      tracking: size * NAV_TRACKING,
      scale: PLATE_TEXEL_SCALE,
    });
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
  /**
   * 항목 텍스처를 다시 굽는다.
   *
   * 예전에는 판 크기가 프레임에 비례해 바뀌므로 크기를 키로 삼았다. 지금 항목은
   * 저술 크기(12/10px)로 굽고 배치할 때 `frameScale()` 로 줄이므로, 다시 구울
   * 이유는 **페이지가 바뀌어 라벨이 달라졌을 때**뿐이다.
   */
  /**
   * 다음 `layout()` 에서 글자를 전부 다시 굽게 한다.
   *
   * 폰트가 늦게 도착했을 때 `ui/fonts.js` 의 등록부가 부른다. 자세한 것은
   * `SubmergedTitle.invalidate` 의 머리말 — 같은 함정이고 같은 원인이다.
   *
   * 라벨 키를 지우는 것으로 충분한 이유는 `_rebakeIfResized` 가 그 키로만 다시
   * 굽기를 결정하기 때문이다. 날짜 도장은 그 경로에 없으므로 여기서 직접 굽는다.
   */
  invalidate() {
    this._plateKey = null;
    const map = this.stamp.material.uniforms.uMap;
    map.value?.dispose();
    map.value = dateStampTexture();
  }

  _rebakeIfResized() {
    const key = this.items.map((i) => i.label).join('|');
    if (key === this._plateKey) return;
    this._plateKey = key;
    this.items.forEach((item, i) => {
      item.map?.dispose();
      if (!item.id) {
        item.map = null;
        return;
      }
      item.map = this._bake(item.label, i === 0);
      item.material.uniforms.uMap.value = item.map;
    });
    for (const tool of this.tools) {
      const next = this._bakeTool(tool.icon);
      for (const tex of Object.values(tool.maps)) tex.dispose();
      tool.maps = next;
      tool.material.uniforms.uMap.value = tool.hovered ? next.hover : next.idle;
    }
  }

  layout(unitsPerPixel) {
    const u = unitsPerPixel;
    this._rebakeIfResized();

    const live = this.items.filter((i) => i.id);
    const k = frameScale();

    /**
     * 오른쪽 아래에서 **왼쪽으로** 쌓는 가로줄. C 시안의 배치다.
     *
     * 마지막 항목의 오른쪽 끝이 프레임 오른쪽에서 30, 글자 밑선이 아래에서 28.
     * 항목 사이는 24. 전부 시안의 CSS px 이고, 프레임이 작아지면 `frameScale()`
     * 이 함께 줄인다 — 저술값을 쓰는 이 프로젝트의 모든 것과 같은 규칙이다.
     */
    const right = FRAME.width / 2 - NAV_RIGHT * k;
    const baseline = -FRAME.height / 2 + NAV_BOTTOM * k;

    /**
     * 오른쪽에서 왼쪽으로 커서를 옮기며 놓는다.
     *
     * 상자에는 좌우로 `pad` 가 있고 글자는 그 안에 가운데로 앉는다. 그래서
     * **잉크 폭**으로 전진하고 상자는 잉크 중심에 맞춰 씌운다 — 상자 폭으로
     * 전진하면 여백이 두 번 들어가 간격이 시안의 24 보다 넓어지고, 처음에
     * 그렇게 짜서 세 항목이 서로 겹쳤다.
     */
    let cursor = right;
    for (let i = live.length - 1; i >= 0; i--) {
      const item = live[i];
      const box = item.map?.userData ?? { width: 40, height: 22, inkW: 30, pad: 5 };
      const ink = box.inkW * k;
      const cx = cursor - ink / 2;
      const size = (item.lead ? NAV_LEAD : NAV_SIZE) * k;

      item.home = { x: cx * u, y: (baseline + size * 0.5) * u };
      item.mesh.scale.set(box.width * k * u, box.height * k * u, 1);
      item.mesh.position.set(item.home.x, item.home.y, 0);

      item.inkW = ink * u;
      item.ruleLeft = (cx - ink / 2) * u;
      item.ruleY = (baseline - NAV_RULE_DROP * k) * u;

      cursor -= ink + NAV_GAP * k;
    }

    /** 아이콘 버튼은 열 **위**, 같은 오른쪽 선. */
    const icon = Math.round(SIZE.buttonIcon.w * this._toolScale());
    const gap = Math.round(SPACE.md * this._toolScale());
    const toolY = baseline + NAV_LEAD * k + gap + icon / 2;
    const last = this.tools.length - 1;
    this.tools.forEach((tool, i) => {
      const tx = right - icon / 2 - (last - i) * (icon + gap);
      tool.home = { x: tx * u, y: toolY * u };
      tool.mesh.scale.set(icon * u, icon * u, 1);
      tool.mesh.position.set(tool.home.x, tool.home.y, 0);
    });

    /** 날짜 도장: 왼쪽 30 / 아래 26. 시안 그대로. */
    const st = this.stamp.material.uniforms.uMap.value.userData;
    this.stamp.scale.set(st.width * k * u, st.height * k * u, 1);
    this.stamp.position.set(
      (-FRAME.width / 2 + STAMP_LEFT * k + st.inkW * k / 2) * u,
      (-FRAME.height / 2 + STAMP_BOTTOM * k + st.height * k / 2 - st.pad * k) * u,
      0,
    );

    this._ruleH = RULE.thin * k * u;
    this._unitsPerPixel = u;
  }

  /**
   * @param {number} dt
   * @param {number} fade  0 hides the whole column; used while a run plays out
   */
  update(dt, fade = 1) {
    const any = this.hovered != null;
    /** 임계 감쇠. 밑줄이 자라는 것은 붙는 것이 아니라 **뻗는** 것이다. */
    const spring = (st, to, w) => {
      const f = 1 + 2 * dt * w, oo = w * w, dtoo = dt * oo, det = f + dt * dtoo;
      st.v = (st.v + dtoo * (to - st.x)) / det;
      st.x = (f * st.x + dt * st.v + dt * dtoo * to) / det;
    };

    for (const item of this.items) {
      if (!item.id || !item.home) continue;

      /**
       * ── 호버는 판이 아니라 **열**을 움직인다 ────────────────────────────
       * 예전에 뺀 것은 판이 앞으로 튀어나오는 것이었다. 여기 있는 것은 다른
       * 종류다: 가리킨 것 말고 나머지가 물러나고, 가리킨 것 아래로 밑줄이
       * 왼쪽부터 뻗는다. 판은 여전히 아무 데도 안 간다.
       */
      item.shift = approach(item.shift, item.hovered ? 1 : 0, dt, MOTION.hover);
      item.dim = approach(item.dim ?? 1, any && !item.hovered ? 0.45 : 1, dt, MOTION.hover);
      spring(item.grow, item.hovered ? 1 : 0, 12);

      item.mesh.position.set(item.home.x, item.home.y + item.shift * -1.5 * (this._unitsPerPixel ?? 1), 0);
      item.material.uniforms.uOpacity.value = fade * item.dim;

      // 밑줄: 왼쪽 끝을 고정하고 폭만 자란다
      const w = Math.max(0, item.grow.x) * (item.inkW ?? 0);
      item.rule.visible = w > 0.0001 && fade > 0.004;
      if (item.rule.visible) {
        item.rule.scale.set(w, this._ruleH ?? 1, 1);
        item.rule.position.set((item.ruleLeft ?? 0) + w / 2, item.ruleY ?? 0, 0);
        item.ruleMat.uniforms.uTint.value.set(PALETTE.water.ink);
        item.ruleMat.uniforms.uOpacity.value = fade;
      }
    }

    for (const tool of this.tools) {
      tool.dim = approach(tool.dim ?? 1, any && !tool.hovered ? 0.45 : 1, dt, MOTION.hover);
      tool.material.uniforms.uOpacity.value = fade * tool.dim;
    }
    /**
     * 숫자는 호버에 반응하지 않는다 — 누를 수 있는 것이 아니다.
     *
     * 불투명도가 0.85 였다. 잉크가 같아도 0.85 로 그리면 **다른 색으로 보인다** —
     * 실측으로 peak 가 rgb(112,167,220) 이었고 제목은 (188,220,242) 였다.
     * 화면의 모든 글자가 같은 잉크여야 한다면 알파도 같아야 한다.
     */
    this.stamp.material.uniforms.uOpacity.value = fade;
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
    this._ruleMap?.dispose();
    this.stamp.geometry.dispose();
    this.stamp.material.uniforms.uMap.value?.dispose();
    this.stamp.material.dispose();
    for (const item of this.items) {
      item.rule?.geometry.dispose();
      item.ruleMat?.dispose();
      item.map?.dispose();
    }
    for (const item of [...this.items, ...this.tools]) {
      item.mesh.geometry.dispose();
      item.material.dispose();
      // 항목은 `map` 하나, 도구는 상태별 `maps` 를 갖는다. 둘이 다르다.
      if (item.maps) for (const m of Object.values(item.maps)) m.dispose();
    }
    this.root.clear();
  }
}

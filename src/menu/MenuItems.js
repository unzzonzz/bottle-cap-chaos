import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { PALETTE } from '../core/palette.js';
import { createSpriteMaterial } from './menuMaterials.js';
import { dateStampTexture, navLabelTexture, ruleTexture } from './menuTextures.js';
import { FRAME, frameScale } from '../core/frame.js';
import { MOTION, ROLE, RULE } from '../core/tokens.js';

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
    { id: 'play', label: 'PLAY →', eyebrow: 'BOTTLE-CAP GAME', action: true },
    { id: 'collection', label: 'COLLECTION' },
    { id: 'settings', label: 'SETTINGS' },
  ],
  play: [
    { id: 'knockout', label: '서바이벌', eyebrow: 'SUMMER TABLE', mode: true },
    { id: 'football', label: '축구', eyebrow: 'SUMMER LAWN', mode: true },
    { id: 'curling', label: '컬링', eyebrow: 'SUMMER SLIDE', mode: true },
    { id: 'home', label: '← 뒤로', role: ROLE.RETREAT },
  ],
};

/* ── 내비의 값. 프레임 853x480 기준 ─────────────────────────────────────── */
/** 홈의 주 행동. 12px 일 때 보조 내비와 실루엣이 같아져 22px 로 분리했다. */
const NAV_LEAD = 22;
/** 나머지. */
const NAV_SIZE = 10;
/** 모드명은 화면 제목 다음의 두 번째 디스플레이 계층이다. */
const MODE_SIZE = 26;
/** 자간, em 배수. 시안의 `letter-spacing: .2em`. */
const NAV_TRACKING = 0.2;
/** 항목 사이. 시안의 `gap: 24px`. */
const NAV_GAP = 24;
/** 홈 PLAY의 시작점부터 오른쪽 끝까지. 폭이 4:3으로 줄어도 보조 내비와 안 겹친다. */
const HOME_ACTION_RIGHT_SPAN = 353;
/** 모드 그룹의 시작점부터 오른쪽 끝까지. 화면 폭이 아니라 우측 가장자리에 묶는다. */
const MODE_GROUP_RIGHT_SPAN = 423;
const MODE_GAP = 38;
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
  /**
   * ── 열 밖의 아이콘 버튼은 없다 ──────────────────────────────────────────
   * 내 마크 아이콘 하나가 내비 위에 떠 있었다. 뚜껑에 새길 그림이 설정의 네 번째
   * 줄에 묻혀 있다는 이유로 꺼내 둔 것이었는데, 이 화면에 글자가 아닌 것이 그
   * 하나만 남으면서 오히려 이물이 됐다 — 배경과 활자만 남은 구성에서 아이콘
   * 하나는 어디에도 속하지 않는다.
   *
   * 들어가는 길은 설정에 그대로 있다 (`SettingsScene` 의 `{ id: 'marks' }`).
   */
  constructor({ retro, tuning }) {
    this.tuning = tuning;
    this.root = new Group();
    this._retro = retro;
    /** Which page the column is showing. `setPage` swaps it. */
    this.page = 'home';

    /** 모든 항목이 나눠 쓰는 1px 밑줄. 메시보다 먼저 만들어 머티리얼에 건다. */
    this._ruleMap = ruleTexture();

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
        id: null, label: '', eyebrow: '', role: null, mesh, material, map: null,
        action: false, mode: false,
        rule, ruleMat, hovered: false, grow: { x: 0, v: 0 },
      };
    });

    /**
     * 항목마다 밑줄 쿼드 하나. C 시안의 상호작용이 이것이다.
     *
     * 텍스처에 구워 넣지 않는 이유는 **자라야** 하기 때문이다. 호버에서 왼쪽부터
     * 오른쪽으로 늘어나고, 손을 떼면 같은 방향으로 줄어든다 — 두 상태 사이에
     * 실제로 무슨 일이 일어나는지가 보여야 상호작용이 된다.
     */
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
      item.eyebrow = def?.eyebrow ?? '';
      item.role = def?.role ?? null;
      item.action = def?.action ?? false;
      item.mode = def?.mode ?? false;
      item.disabled = def?.disabled ?? false;
      item.hovered = false;
      item.lead = item.action;
      item.mesh.visible = !!def;
      if (item.rule) item.rule.visible = !!def;
    });
    this._plateKey = '';
    this._rebakeIfResized();
    this._picks = this.items.filter((i) => i.id && !i.disabled).map((i) => i.mesh);
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
   * 홈의 PLAY는 22px 산세리프, 모드명은 26px 명조, 보조 내비는 10px 산세리프다.
   * 모두 같은 흰색이므로 계층은 서체 역할과 크기 차이만으로 만든다. 작은 영문
   * 설명은 버튼 밖의 장식이 아니라 같은 텍스처 안에서 기준선을 공유한다.
   *
   * 상태별 텍스처가 없다. 호버는 밑줄과 불투명도가 맡고, 둘 다 매 프레임 움직이는
   * 값이라 구울 수 없다.
   */
  _bake(item) {
    if (item.mode) {
      return navLabelTexture(item.label, {
        size: MODE_SIZE,
        color: PALETTE.water.ink,
        // 큰 한글에는 촘촘한 명조, 영문 설명에는 성긴 산세리프를 쓴다.
        tracking: MODE_SIZE * -0.025,
        eyebrow: item.eyebrow,
        eyebrowTracking: 1.35,
        display: true,
        scale: PLATE_TEXEL_SCALE,
      });
    }

    const size = item.action ? NAV_LEAD : NAV_SIZE;
    return navLabelTexture(item.label, {
      size,
      // 색은 하나다. 위계는 크기가 만든다 — `PALETTE.water.ink` 의 주석 참조.
      color: PALETTE.water.ink,
      tracking: size * (item.action ? 0.11 : NAV_TRACKING),
      eyebrow: item.eyebrow,
      eyebrowTracking: 1.35,
      scale: PLATE_TEXEL_SCALE,
    });
  }

  /**
   * 항목 텍스처를 다시 굽는다.
   *
   * 예전에는 판 크기가 프레임에 비례해 바뀌므로 크기를 키로 삼았다. 지금 항목은
   * 저술 크기(22/26/10px)로 굽고 배치할 때 `frameScale()` 로 줄이므로, 다시 구울
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
    const key = this.items
      .map((i) => `${i.label}/${i.eyebrow}/${i.action ? 'a' : ''}/${i.mode ? 'm' : ''}`)
      .join('|');
    if (key === this._plateKey) return;
    this._plateKey = key;
    this.items.forEach((item, i) => {
      item.map?.dispose();
      if (!item.id) {
        item.map = null;
        return;
      }
      item.map = this._bake(item);
      item.material.uniforms.uMap.value = item.map;
    });
  }

  layout(unitsPerPixel) {
    const u = unitsPerPixel;
    this._rebakeIfResized();

    const live = this.items.filter((i) => i.id);
    const k = frameScale();

    const right = FRAME.width / 2 - NAV_RIGHT * k;
    const baseline = -FRAME.height / 2 + NAV_BOTTOM * k;

    /**
     * 텍스처 상자가 아니라 **주 글자의 잉크**를 기준으로 놓는다.
     *
     * 위의 영문 설명이 주 글자보다 길 수 있으므로 캔버스 중심과 잉크 중심은
     * 같지 않다. `pad` 와 `inkW` 로 캔버스 중심을 역산해야 PLAY의 시작선과
     * 모드 사이 간격이 실제 화면에서도 저술값과 일치한다.
     */
    const placeLeft = (item, left) => {
      const box = item.map?.userData ?? { width: 40, height: 22, inkW: 30, pad: 5 };
      const ink = box.inkW * k;
      const cx = left + (box.width / 2 - box.pad) * k;
      const lift = (box.anchorLift ?? (item.lead ? NAV_LEAD : NAV_SIZE) * 0.5) * k;

      item.home = { x: cx * u, y: (baseline + lift) * u };
      item.mesh.scale.set(box.width * k * u, box.height * k * u, 1);
      item.mesh.position.set(item.home.x, item.home.y, 0);

      item.inkW = ink * u;
      item.ruleLeft = left * u;
      item.ruleY = (baseline - NAV_RULE_DROP * k) * u;
      return left + ink;
    };

    const placeRight = (item, edge) => {
      const box = item.map?.userData ?? { inkW: 30 };
      const left = edge - box.inkW * k;
      placeLeft(item, left);
      return left;
    };

    if (this.page === 'home') {
      // PLAY를 병 바로 왼쪽에 독립시켜 시선이 제목 → 병 → 행동으로 이어진다.
      placeLeft(live[0], FRAME.width / 2 - HOME_ACTION_RIGHT_SPAN * k);

      // 컬렉션과 설정은 여전히 오른쪽 아래의 작은 편집 정보다.
      let cursor = right;
      for (let i = live.length - 1; i >= 1; i--) {
        cursor = placeRight(live[i], cursor);
        cursor -= NAV_GAP * k;
      }
    } else {
      // 모드는 카드가 아니라 한 줄의 큰 제목들이다. 한글과 작은 영문이 한 쌍이다.
      let cursor = FRAME.width / 2 - MODE_GROUP_RIGHT_SPAN * k;
      for (const item of live) {
        cursor = placeLeft(item, cursor);
        cursor += MODE_GAP * k;
      }
    }

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
      item.dim = approach(item.dim ?? 1, any && !item.hovered ? 0.45 : 1, dt, MOTION.hover);
      spring(item.grow, item.hovered ? 1 : 0, 12);

      /**
       * ── 항목은 **움직이지 않는다** ──────────────────────────────────────
       * 가리킨 항목이 오른쪽으로 2px, 위로 1.5px 흘렀다. 방향을 알린다는 근거로
       * 넣은 것이었는데, 밑줄이 이미 왼쪽부터 오른쪽으로 자라며 같은 말을 하고
       * 있다. 두 장치가 같은 말을 하면 하나는 소음이고, 소음인 쪽은 글자를
       * 움직이는 쪽이다 — 자간이 넓은 작은 활자가 몇 픽셀 흔들리면 읽는 중에
       * 줄이 미끄러진 것처럼 보인다.
       *
       * 호버가 말하는 것은 이제 둘이다: 밑줄이 자라고, 나머지가 흐려진다.
       * 둘 다 자리를 건드리지 않는다.
       */
      item.mesh.position.set(item.home.x, item.home.y, 0);
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
    return this.items.find((i) => i.mesh === mesh) ?? null;
  }

  /**
   * 호버는 **플래그만** 세운다. 텍스처를 바꾸지 않는다.
   *
   * ── 여기 텍스처 교체가 있었고, 그것은 터질 자리였다 ─────────────────────
   * `it.material.uniforms.uMap.value = on ? it.maps.hover : it.maps.idle` 이
   * 있었다. 상태별 텍스처 쌍(`maps`)을 갖는 것은 아이콘 버튼뿐이었고 내비
   * 항목은 `map` 한 장만 갖는다 — 즉 내비에 커서를 올리면 `it.maps` 가
   * undefined 라 그 줄에서 예외가 났다. 아이콘이 있던 시절의 잔재다.
   *
   * 지금 호버가 보이는 방식은 밑줄이 자라는 것과 나머지가 흐려지는 것 둘이고,
   * 둘 다 매 프레임 움직이는 값이라 애초에 구울 수 없다 — `update` 가 한다.
   */
  setHover(item) {
    if (this.hovered === item) return;
    this.hovered = item;
    for (const it of this.items) it.hovered = it === item && !it.disabled;
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
    for (const item of this.items) {
      item.mesh.geometry.dispose();
      item.material.dispose();
    }
    this.root.clear();
  }
}

import { AmbientLight, Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { PALETTE } from '../core/palette.js';
import { buildCapGeometry, CAP_DEFAULTS, CAP_GROUP } from '../cap/capGeometry.js';
import { createSpriteMaterial } from '../menu/menuMaterials.js';
import { menuPlateTexture } from '../menu/menuTextures.js';
import { iconTexture, saveButtonTexture, solidTexture, tileTexture } from './markIcons.js';
import {
  bakeCapPanel,
  clipToBoundary,
  createMarkCanvas,
  MARK_BOUNDARY_DEFAULT,
  MARK_CANVAS_DEFAULT,
  toMarkTexture,
} from './markTextures.js';
import { DEFAULT_MARK } from './MarkBook.js';
import { frameScale } from '../core/frame.js';
import { focusRing, roundRectPath } from '../ui/paper.js';

/**
 * The drawing screen: a cap you paint on, and the tools to paint it with.
 *
 * ── the pointer is mapped by RAYCASTING THE CAP, not by projecting a circle ──
 * The obvious way to turn a click into a canvas pixel is to work out where the
 * cap's top disc lands on screen and invert it. That works only while the cap is
 * exactly where you expect, and it silently produces plausible-but-wrong
 * coordinates the moment anything moves it — a camera tweak, a different
 * `unitsPerPixel`, the resize this menu does not currently handle.
 *
 * So the ray is cast at the real mesh and the intersection's UV is used
 * directly. `capGeometry` gives the panel a planar projection over the top's
 * bounding square, which IS the canvas — so `uv * size` is the texel under the
 * pointer, exactly, with no arithmetic that can drift from the geometry. Hits on
 * the skirt and the liner carry their own UVs and are rejected by
 * `face.materialIndex`, which is the same `CAP_GROUP.PANEL` the material array
 * is indexed by.
 *
 * ── two masks, because the boundary is the team's ───────────────────────────
 * Every paint operation is clipped to the circle, and the bake in
 * `markTextures` clips again. The brief says the ring outside it is what tells
 * the teams apart and must survive, so it is guarded in the editor AND on the
 * way to the cap — a single mask would be one mistake away from a mark that
 * covers the whole panel.
 *
 * ── undo is whole canvases ──────────────────────────────────────────────────
 * One `ImageData` per stroke, not a diff and not a command log. At 128 texels a
 * state is 64 kB and the limit is twenty of them, so the whole history is about
 * a megabyte and a half — cheap enough that the simple thing is also the right
 * one. Diffs would be smaller and would have to be correct about the eraser's
 * `destination-out`, which is exactly the kind of cleverness that produces an
 * undo that ALMOST restores what was there.
 *
 * ── the eraser removes alpha ────────────────────────────────────────────────
 * `destination-out`, never a fill in the cap's colour. The editor does not know
 * what colour the cap is — it cannot, because one mark is worn by both teams —
 * and painting a guess would put a red disc on a blue cap. See `markTextures`.
 *
 * ── 이 화면은 뚜껑을 세워 놓는다. 그래서 작업등이 하나 있다 ────────────────
 * 그리려면 패널이 카메라를 봐야 하고, 그러려면 뚜껑을 옆으로 세워야 한다
 * (`cap.rotation.x = π/2`). 조명은 게임과 같은 리그인데, 판 위에 누워 있을 때
 * 하늘을 보던 면이 이제 지평선을 본다. 그 각도 차이가 그대로 밝기 차이다:
 *
 *     판 위에 누운 뚜껑의 패널   조도 = 알베도의 0.45 / 0.48 / 0.46
 *     이 화면에 세워 둔 패널      조도 = 알베도의 0.24 / 0.30 / 0.32  ← 실측
 *
 * 태양이 법선과 65° 로 스치고(0.72 → 0.42), 림 라이트는 뒤로 돌아가 아예 빠지고,
 * three 의 물리 조명은 거기서 다시 `1/π` 를 곱한다. 흰색을 칠하면 화면에
 * [133,147,152] 이 나온다. 회색이다. 그리고 바로 왼쪽 팔레트의 흰 스와치는 UI
 * 스프라이트라 조명을 받지 않아 [255,255,255] 이므로, 고른 색과 칠한 색이
 * 나란히 놓인 채로 다르다. 그것이 이 등이 있는 이유다.
 *
 * ── 왜 앰비언트인가 ────────────────────────────────────────────────────────
 * (1) three 의 앰비언트는 **확산광에만** 더해져 스페큘러를 만들지 않는다.
 *     카메라 쪽에서 비추는 방향광은 러프니스 0.22 짜리 패널 한가운데에
 *     하이라이트를 찍는데, 그 자리가 정확히 그림을 그리는 자리다.
 * (2) 같은 이유로 금속은 반응이 거의 없다 — 스커트는 `metalness 0.62` 라 확산
 *     성분이 얼마 없어서, 테두리의 젖은 금속은 그대로 두고 그림판만 밝아진다.
 * (3) 하늘도 UI 스프라이트도 조명을 받지 않는 재질이라, 이 화면에서 이 등이
 *     닿는 것은 뚜껑 하나뿐이다. `root` 의 자식이므로 화면이 닫히면 같이 빠진다.
 *
 * ── 두 모드 모두에서 켜 둔다 ───────────────────────────────────────────────
 * 처음엔 그리기 모드에서만 켜고 보기 모드에서는 껐다. "보기 모드는 게임에서
 * 어떻게 보일지를 보여 주는 곳"이라는 이유였는데, 재 보니 틀렸다 — 보기 모드도
 * 뚜껑을 세워 두고 돌릴 뿐이라 조도는 0.24~0.32 그대로이고, 판 위의 0.45~0.48
 * 보다 오히려 더 멀다. 등을 켜면 0.65~0.68 로 반대쪽으로 어긋나지만 그 어긋남이
 * 더 작다. 즉 끄는 쪽은 **정확한 색도 아니고 정확한 예보도 아니다.** 그래서 이
 * 등은 화면이 열려 있는 동안 계속 켜져 있고, 모드는 조명에 관여하지 않는다.
 *
 * 이 화면이 게임보다 밝다는 것은 남는다. 의도한 것이다 — 여기서 하는 일은 색을
 * 고르는 것이고, 고른 색이 칠한 색과 같아 보이는 쪽이 이 화면의 일이다.
 */

/**
 * 작업등의 세기와 색. 중성 백색이고, 상한은 블룸이다.
 *
 * ── 니스를 벗기고 나니 이 등이 그림판의 **유일한** 광원이 됐다 ─────────────
 * 등을 끄고 재면 패널에 남는 조도가 0.010/0.017/0.023 이다. 사실상 0 이다 —
 * 키 라이트는 이 각도에서 패널 뒤로 돌아가 있어서 확산 성분이 0 이고, 그
 * 자리를 채우고 있던 것이 전부 환경맵이었다. `PANEL_ENV` 로 그것을 걷었으므로
 * 이제 그림판을 비추는 것은 이 등 하나뿐이다.
 *
 * 그게 오히려 이 화면이 원하던 조건이다. **광원이 하나면 오차가 이득 하나로
 * 줄어든다** — 색조도 채도도 흔들리지 않고 전 채널이 같은 배율로만 내려간다.
 * 그래서 색을 따뜻하게 잡을 이유도 없어졌다: 지울 푸른 캐스트가 이미 없다.
 *
 * 2.1 이면 `2.1/π` 가 그대로 조도가 된다. 팔레트에서 여섯 색과 흰색을 칠해
 * 스와치의 원래 값과 나란히 재면:
 *
 *              고른 값          칠해진 값        배율
 *     흰색     255,255,255  ->  217,218,218   0.851 0.855 0.855
 *     남색      47, 74,107  ->   39, 62, 91   0.830 0.838 0.850
 *     주홍     232, 96, 74  ->  197, 81, 62   0.849 0.844 0.838
 *     노랑     245,201, 63  ->  208,171, 53   0.849 0.851 0.841
 *     초록      84,184, 74  ->   70,157, 62   0.833 0.853 0.838
 *     감청      31, 95,156  ->   25, 80,133   0.806 0.842 0.853
 *     분홍     224,107,160  ->  190, 90,136   0.848 0.841 0.850
 *
 * 스물한 개 채널이 전부 0.84 근처의 **같은 배율** 하나다. 색조도 채도도 움직이지
 * 않는다 — 남은 것은 노출뿐이고, 그게 광원을 하나로 만든 이유다. (0.806 은
 * 원본이 31 이라 1바이트 차이가 그 비율로 보이는 것이다.)
 *
 * ── 왜 여기서 멈추는가 ─────────────────────────────────────────────────────
 * 블룸 임계값이 0.72(선형)다 — `core/Composer.js`. 뚜껑은 UI 와 달리 월드
 * 컴포저 안에서 그려지므로, 넘으면 흰 물감이 발광하고 그림 가장자리가 번진다.
 * 흰 물감의 실측 최대가 0.700 이라 여유가 3% 뿐이다. 즉 남은 16% 는 **조명이
 * 정한 값이 아니라 블룸 임계값이 정한 값**이고, 이 등을 더 올려서 지울 수 없다.
 * 지우려면 이 화면에서 블룸 패스를 끄는 수밖에 없는데, 그러면 스커트의 젖은
 * 금속에서 글로가 사라진다 — 색 정확도와 이 게임의 간판을 맞바꾸는 거래라
 * 여기서 멈춰 두고 결정을 남긴다.
 */
const FILL_COLOR = PALETTE.untinted;
const FILL_INTENSITY = 2.1;

/**
 * 그림판에서 니스를 벗긴다. 게임의 뚜껑이 아니라 이 화면의 그림판에서만.
 *
 * 등을 켜고 나서도 남은 오차를 색깔별로 재 보면 두 가지가 섞여 있었다:
 *
 *     흰색   255,255,255 -> 210,214,207   (0.82 배)
 *     남색    47, 74,107 ->  44, 66, 89   (0.94/0.89/0.83 배)
 *     감청    31, 95,156 ->  35, 83,127   (1.13/0.87/0.81 배)
 *
 * 밝은 색은 어두워지고 **어두운 색은 오히려 밝아진다**. 두 번째가 니스다:
 * 유전체 표면의 F0 는 0.04 이고 그 위에 하늘색 환경맵이 비치므로, 어떤 색을
 * 칠해도 선형 0.03 남짓의 푸른 막이 얹힌다. 흰색 위에서는 4% 라 안 보이지만
 * 감청색(선형 0.012) 위에서는 색보다 막이 더 크다 — 그래서 어두운 색이 뜨고,
 * 짙은 색일수록 채도가 빠진다. 밝기 하나만 올려서는 절대 안 지워지는 오차다.
 *
 * `gloss` 를 내려 반사를 넓게 퍼뜨리고 `envIntensity` 로 비칠 것을 없앤다.
 * 남는 것은 물감과 등뿐이다. 게임의 뚜껑은 그대로 클리어코트를 쓰고, 스커트의
 * 젖은 금속도 그대로다 — 바뀌는 것은 이 화면에서 **그림이 얹히는 면 하나**다.
 */
const PANEL_GLOSS = 0.12;
const PANEL_ENV = 0.1;

/** Frame pixels. */
const L = {
  capY: 14,
  /** Screen pixels across the cap's widest point. */
  capWidth: 236,
  toolX: 236,
  /**
   * Left edge of the palette's first column.
   *
   * Moved out from −246 when the grid grew a fourth column. At −246 the new
   * column's right edge landed at −129 against the cap's own left edge at −118,
   * which is eleven frame pixels and reads as the swatches touching the cap.
   * −270 puts the same clearance on both sides of the block: about 35 to the
   * frame's edge and about 35 to the cap.
   */
  paletteX: -270,
  swatch: 30,
  tool: 34,
  modeY: 176,
  saveY: -178,
  backY: -178,
};

/**
 * The drawing palette, as rows of `PALETTE_COLUMNS`.
 *
 * ── the values moved to `core/palette.js`; the ORDER is still layout ─────────
 * `_buildPalette` fills left to right, so each run of four in `marks.swatches`
 * is a row on screen and each row is a family. That is the whole reason the
 * array is written four to a line over there rather than sorted by hue:
 * reordering it rearranges the grid, and a grid you can scan by family is the
 * difference between picking a colour and hunting for one.
 *
 * The constraint that used to shape the list is gone. It was chosen so that
 * every entry landed on its own 5-bit-per-channel triple, because the chain
 * quantised to five bits and two swatches less than a thirty-second apart
 * arrived as the same colour. There is no quantiser now, so the twenty-four
 * were re-tuned for the bright scheme instead — the row of near-blacks became a
 * row of navies, and every hue came up in lightness.
 *
 * Nothing saved depends on any of this. A mark is stored as canvas pixels, not
 * as palette indices, so re-tinting a swatch cannot change a drawing anybody has
 * already made.
 *
 * Named `MARK_SWATCHES` rather than `PALETTE`, which is what it was called when
 * it was the only palette in the project.
 */
export const MARK_SWATCHES = PALETTE.marks.swatches;

/**
 * Swatches across, which decides how far down the grid reaches.
 *
 * Four rather than the three it was, and it is a fit rather than a taste: at
 * three columns twenty-four colours are eight rows deep and the bottom of the
 * grid lands on 목록으로. Four columns is six rows, which clears that button by
 * about fifty frame pixels, and the extra column is what `paletteX` moved left
 * to make room for — see the note there.
 */
const PALETTE_COLUMNS = 4;

/**
 * Brush diameters in canvas texels, one per size icon.
 *
 * Exported and MUTATED IN PLACE by the panel — the editor reads it on every dab,
 * so a dragged slider changes the next stroke rather than the next session.
 */
export const BRUSH_SIZES = [2, 5, 10];

export const EDITOR_MODE = { DRAW: 'draw', VIEW: 'view' };

export class MarkEditor {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {number} unitsPerPixel
   * @param {import('./MarkBook.js').MarkBook} book
   * @param {import('./ConfirmDialog.js').ConfirmDialog} confirm
   * @param {typeof import('../menu/menuConfig.js').MENU_CONFIG.marks} tuning
   * @param {() => void} onExit  leave the editor. Only called once it is safe to.
   */
  constructor({ retro, unitsPerPixel, book, confirm, tuning, onExit }) {
    const u = unitsPerPixel;
    this._u = u;
    this.retro = retro;
    this.book = book;
    this.confirm = confirm;
    this.tuning = tuning;
    this.onExit = onExit ?? (() => {});

    this.root = new Group();
    this.mode = EDITOR_MODE.DRAW;
    /** Which slot is being edited, or DEFAULT_MARK when just looking. */
    this.ref = 0;
    this.colour = MARK_SWATCHES[0];
    this.brush = 1;
    this.erasing = false;

    // ── the canvas ──────────────────────────────────────────────────────────
    this.size = tuning.canvasSize;
    this.canvas = createMarkCanvas(this.size);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this._history = [];
    this._historyAt = -1;
    this._savedAt = -1;

    // ── the cap ─────────────────────────────────────────────────────────────
    this.pivot = new Group();
    this.pivot.position.set(0, L.capY * u, 0);
    this.root.add(this.pivot);

    this.geometry = buildCapGeometry({ ...CAP_DEFAULTS, shell: true });
    /**
     * The panel wears a BAKE of the canvas, not the canvas.
     *
     * The obvious thing is to hand the editor's RGBA canvas straight to the
     * panel and let a coloured `uColor` show through the transparent parts. It
     * does not work, and the reason is the one `markTextures` opens with:
     * `RetroMaterial`'s panel shader is `uColor * texture(uMap).rgb` and it never
     * reads alpha. Unpainted canvas is `rgba(0,0,0,0)`, so the multiply is by
     * ZERO and the whole cap top comes out black — which is exactly what it did.
     *
     * So the editor bakes on every stroke, the same way the game's caps do:
     * cap colour underneath, mark composited over, `uColor` white. One extra
     * 128x128 composite per dab, which is nothing, and it means the editor is
     * previewing the identical pipeline the cap will actually wear.
     */
    this._bakeCanvas = bakeCapPanel(null, tuning.capColor, this.size, tuning.boundary);
    this.panelTexture = toMarkTexture(this._bakeCanvas);
    this.materials = [];
    this.materials[CAP_GROUP.BODY] = retro.create({ color: tuning.capColor, preset: 'wetMetal' });
    this.materials[CAP_GROUP.PANEL] = retro.create({
      map: this.panelTexture,
      color: PALETTE.untinted,
      // 그리는 동안 그림판은 종이다. 근거는 파일 머리말의 "니스를 벗긴다".
      gloss: PANEL_GLOSS,
      envIntensity: PANEL_ENV,
    });
    this.materials[CAP_GROUP.LINER] = retro.create({ color: PALETTE.metal.liner, preset: 'plastic' });

    this.cap = new Mesh(this.geometry, this.materials);
    // Panel toward the camera, and parked on its mid-height so the view mode
    // rolls it about its middle rather than swinging it around its hem.
    this.cap.rotation.x = Math.PI / 2;
    this.cap.position.z = -(this.geometry.userData.height ?? 0) * 0.5;
    const capR = this.geometry.userData.radius ?? 1.6;
    const perCapUnit = L.capWidth / (capR * 2);
    this.pivot.scale.setScalar(perCapUnit * u);
    this.pivot.add(this.cap);

    /**
     * 그림판을 위한 작업등. 근거는 파일 머리말에.
     *
     * `root` 의 자식인 것이 중요하다 — 조명은 위치와 무관하게 씬 전체에
     * 작용하므로, 화면이 닫힌 뒤에도 씬에 남아 있으면 메뉴의 병까지 밝힌다.
     * 이 화면과 수명을 같이 하는 유일한 방법이 여기 매다는 것이다.
     */
    this.fill = new AmbientLight(FILL_COLOR, FILL_INTENSITY);
    this.root.add(this.fill);

    /** View mode's roll, in radians, and its inertia. */
    this.spin = 0;
    this.spinVel = 0;

    // ── the boundary ring ───────────────────────────────────────────────────
    /**
     * The circle, drawn as a thin ring ON the cap.
     *
     * The brief asks for the boundary to be visible, and it has to be visible
     * where the drawing happens rather than as a frame around the screen — the
     * question a player is asking is "can I paint HERE", and only a mark on the
     * cap answers it.
     *
     * ── the quad is the PANEL, not the cap ────────────────────────────────
     * `ringTexture` puts its circle at `half * boundary` of whatever quad it is
     * on, and `boundary` is a fraction of the panel — so the quad has to BE the
     * panel or the ring lands somewhere paint cannot follow. It used to be the
     * full `capWidth`, which drew the guide at `outerRadius * boundary` while
     * the clip stopped at `panelRadius * boundary`: a ring of cap inside the
     * line that silently refused the brush. Same number, two different circles.
     */
    const panelWidth = L.capWidth * (this.geometry.userData.panelRadius / capR);
    this.ring = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: ringTexture(tuning.boundary), blend: 'add' }),
    );
    this.ring.scale.set(panelWidth * u, panelWidth * u, 1);
    this.ring.position.set(0, L.capY * u, 40 * u);
    this.root.add(this.ring);

    // ── controls ────────────────────────────────────────────────────────────
    this._controls = [];
    this._buildModes(retro);
    this._buildPalette(retro);
    this._buildTools(retro);
    this._buildFooter(retro);

    this._ray = new Raycaster();
    // 모든 레이어를 본다. `MenuItems` 의 같은 줄에 왜 필요한지 적혀 있다 —
    // 판은 `asUiLayer` 때문에 레이어 1 에 있고, 광선의 기본은 레이어 0 뿐이다.
    this._ray.layers.enableAll();
    this._ndc = new Vector2();
    this._hover = null;
    /** The stroke in progress: null when the pointer is up. */
    this._stroke = null;
    this._lastUv = null;
    this._drag = null;

    this.layout(u);
  }

  // ── construction helpers ──────────────────────────────────────────────────

  /**
   * 컨트롤 하나. 저술 좌표(`ax` 등)와 실제 좌표(`x` 등)를 둘 다 들고 있다.
   *
   * 저술 좌표는 640x480 프레임 기준이고, 실제 좌표는 거기에 `frameScale()` 을
   * 곱한 것이다. 둘 다 필요한 이유는 리사이즈다: 실제 좌표만 들고 있으면 배율을
   * 다시 곱할 때 이미 곱해진 값에 또 곱하게 되어 화면이 매번 작아진다.
   */
  _add(retro, { id, kind, map, x, y, w, h, z = 0 }) {
    const mesh = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(retro, { map }));
    this.root.add(mesh);
    const control = { id, kind, mesh, ax: x, ay: y, aw: w, ah: h, az: z, x, y, w, h };
    this._controls.push(control);
    return control;
  }

  /**
   * 편집기 전체를 지금 프레임에 맞춘다.
   *
   * ── 실측: 421 폭 프레임에서 편집기의 절반이 화면 밖이었다 ─────────────────
   * 이 화면의 좌표는 전부 640x480 기준이다 — 뚜껑 폭 236, 팔레트 왼쪽 끝 -270,
   * 도구 열 x 236, 저장 버튼 y -178. 800x459 창의 프레임은 421x316 이라 팔레트
   * 네 열 중 두 열이 왼쪽으로 잘려 나갔고, 도구 열과 저장/뒤로 버튼은 아예 없었다.
   * 뚜껑만 프레임의 56% 를 차지하며 남아 있었다.
   *
   * 전부 하나의 배수로 줄인다. 4:3 프레임에서는 가로 세로가 같은 비율로 줄므로
   * 배치가 그대로 보존된다 — 640x480 을 축소한 그림이 된다.
   */
  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;
    const k = frameScale();

    const capR = this.geometry.userData.radius ?? 1.6;
    this.pivot.position.set(0, L.capY * k * u, 0);
    this.pivot.scale.setScalar(((L.capWidth * k) / (capR * 2)) * u);

    const panelWidth = L.capWidth * k * (this.geometry.userData.panelRadius / capR);
    this.ring.scale.set(panelWidth * u, panelWidth * u, 1);
    this.ring.position.set(0, L.capY * k * u, 40 * u);

    for (const c of this._controls) {
      c.x = c.ax * k;
      c.y = c.ay * k;
      c.w = c.aw * k;
      c.h = c.ah * k;
      c.mesh.scale.set(c.w * u, c.h * u, 1);
      c.mesh.position.set(c.x * u, c.y * u, (50 + c.az) * u);
    }

    // 텍스처는 실제 크기로 굽는다. 배수가 바뀌지 않았으면 아무것도 하지 않는다.
    if (k !== this._k) {
      this._k = k;
      this._rebake();
    }
    this.refresh();
  }

  /** 판 크기가 바뀌었을 때 컨트롤 텍스처를 다시 굽는다. */
  _rebake() {
    const size = Math.max(12, Math.round(L.tool * this._k));
    for (const b of this.modeButtons ?? []) b.size = size;
    for (const t of this.tools ?? []) t.size = size;
    for (const sw of this.swatches ?? []) {
      sw.mesh.material.uniforms.uMap.value = swatchTexture(sw.colour, false, sw.w);
      sw.selected = null;
    }
    if (this.saveButton) {
      this.saveButton.mesh.material.uniforms.uMap.value = saveButtonTexture('idle', {
        width: Math.round(this.saveButton.w),
        height: Math.round(this.saveButton.h),
      });
      this.saveButton.tone = null;
    }
    if (this.backButton) {
      const box = {
        width: Math.round(this.backButton.w),
        height: Math.round(this.backButton.h),
        scale: 2,
      };
      this._backMaps.idle?.dispose();
      this._backMaps.hover?.dispose();
      this._backMaps = {
        idle: menuPlateTexture('◀ 목록으로', 'idle', box),
        hover: menuPlateTexture('◀ 목록으로', 'hover', box),
      };
      this.backButton.mesh.material.uniforms.uMap.value = this._backMaps.idle;
    }
  }

  _buildModes(retro) {
    this.modeButtons = [
      { id: 'mode:draw', icon: 'pencil', x: -L.tool / 2 - 3 },
      { id: 'mode:view', icon: 'eye', x: L.tool / 2 + 3 },
    ].map((def) =>
      Object.assign(
        this._add(retro, {
          id: def.id,
          kind: 'mode',
          map: iconTexture(def.icon, 'idle', { size: L.tool }),
          x: def.x,
          y: L.modeY,
          w: L.tool,
          h: L.tool,
        }),
        { icon: def.icon },
      ),
    );
  }

  _buildPalette(retro) {
    this.swatches = MARK_SWATCHES.map((colour, i) => {
      const col = i % PALETTE_COLUMNS;
      const row = Math.floor(i / PALETTE_COLUMNS);
      return Object.assign(
        this._add(retro, {
          id: `colour:${i}`,
          kind: 'colour',
          map: swatchTexture(colour, false),
          x: L.paletteX + col * (L.swatch + 4),
          y: 78 - row * (L.swatch + 4),
          w: L.swatch,
          h: L.swatch,
        }),
        { colour },
      );
    });
  }

  _buildTools(retro) {
    const defs = [
      { id: 'brush:0', icon: 'brush1' },
      { id: 'brush:1', icon: 'brush2' },
      { id: 'brush:2', icon: 'brush3' },
      { id: 'eraser', icon: 'eraser' },
      { id: 'undo', icon: 'undo' },
      { id: 'redo', icon: 'redo' },
      { id: 'clear', icon: 'clear' },
    ];
    this.tools = defs.map((def, i) =>
      Object.assign(
        this._add(retro, {
          id: def.id,
          kind: 'tool',
          map: iconTexture(def.icon, 'idle', { size: L.tool }),
          x: L.toolX,
          y: 96 - i * (L.tool + 5),
          w: L.tool,
          h: L.tool,
        }),
        { icon: def.icon },
      ),
    );
  }

  _buildFooter(retro) {
    this.saveButton = this._add(retro, {
      id: 'save',
      kind: 'save',
      map: saveButtonTexture('idle'),
      x: 176,
      y: L.saveY,
      w: 108,
      h: 34,
    });
    this.backButton = this._add(retro, {
      id: 'back',
      kind: 'back',
      map: menuPlateTexture('◀ 목록으로', 'idle', { width: 180, height: 40 }),
      x: -170,
      y: L.backY,
      w: 180,
      h: 40,
    });
    this._backMaps = {
      idle: menuPlateTexture('◀ 목록으로', 'idle', { width: 180, height: 40 }),
      hover: menuPlateTexture('◀ 목록으로', 'hover', { width: 180, height: 40 }),
    };
  }

  // ── opening ───────────────────────────────────────────────────────────────

  /**
   * Load a mark and show it.
   *
   * A `+` opens an empty slot in DRAW; an existing mark opens in VIEW, which the
   * brief asks for so that looking at a mark cannot accidentally change it. The
   * built-in logo can only ever be looked at.
   *
   * ── history starts HERE ─────────────────────────────────────────────────
   * "기존 마크 수정 시 되돌리기 이력은 없다. 진입 시점이 시작점이다." The stack is
   * emptied and seeded with whatever was loaded, so the earliest thing undo can
   * reach is the mark as it was opened — never the previous session's strokes.
   */
  open(ref, image = null) {
    this.ref = ref;
    this.readOnly = ref === DEFAULT_MARK;
    this.mode = this.readOnly || image ? EDITOR_MODE.VIEW : EDITOR_MODE.DRAW;
    this.spin = 0;
    this.spinVel = 0;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (image) {
      this.ctx.save();
      clipToBoundary(this.ctx, this.canvas.width, this.tuning.boundary);
      this.ctx.drawImage(image, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx.restore();
    }
    this._rebake();

    this._history = [this._snapshot()];
    this._historyAt = 0;
    this._savedAt = 0;
    this.refresh();
  }

  get dirty() {
    return this._historyAt !== this._savedAt;
  }

  // ── history ───────────────────────────────────────────────────────────────

  _snapshot() {
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  _restore(state) {
    this.ctx.putImageData(state, 0, 0);
    this._rebake();
  }

  /**
   * Composite the canvas onto the cap's paint and push it to the texture.
   *
   * The one place the preview is produced, so a stroke, an undo, a clear and a
   * load cannot disagree about what the cap looks like.
   */
  _rebake() {
    const baked = bakeCapPanel(
      this.canvas,
      this.tuning.capColor,
      this._bakeCanvas.width,
      this.tuning.boundary,
    );
    const ctx = this._bakeCanvas.getContext('2d');
    ctx.clearRect(0, 0, this._bakeCanvas.width, this._bakeCanvas.height);
    ctx.drawImage(baked, 0, 0);
    this.panelTexture.needsUpdate = true;
  }

  /** Called once per completed stroke, and by clear. */
  _commit() {
    // Anything redoable is now unreachable: the timeline has branched and the
    // branch nobody took is gone. Standard, and the alternative is a tree.
    this._history.length = this._historyAt + 1;
    this._history.push(this._snapshot());
    // Read live rather than captured, so the panel's slider takes effect on
    // the next stroke instead of the next session.
    const limit = Math.max(1, Math.round(this.tuning.historyLimit));
    while (this._history.length > limit + 1) {
      this._history.shift();
      // The saved point slides with the window. Without this, trimming past it
      // would leave `dirty` permanently true on a mark nobody had touched.
      this._savedAt = Math.max(-1, this._savedAt - 1);
    }
    this._historyAt = this._history.length - 1;
    this.refresh();
  }

  undo() {
    if (this._historyAt <= 0) return;
    this._historyAt--;
    this._restore(this._history[this._historyAt]);
    this.refresh();
  }

  redo() {
    if (this._historyAt >= this._history.length - 1) return;
    this._historyAt++;
    this._restore(this._history[this._historyAt]);
    this.refresh();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._rebake();
    // A stroke like any other, so undo brings the drawing back — which is why
    // the brief allows it to skip its own confirmation.
    this._commit();
  }

  // ── painting ──────────────────────────────────────────────────────────────

  /**
   * One dab, in canvas texels. Square, hard-edged, no antialiasing anywhere.
   *
   * `fillRect` on whole pixels rather than `arc`: a circle at this size is
   * rasterised with soft edges whatever `imageSmoothingEnabled` says, and the
   * brief rules out a soft brush. A square dab IS the pixel-art brush.
   */
  _dab(x, y) {
    const d = BRUSH_SIZES[this.brush] ?? 4;
    const half = Math.floor(d / 2);
    this.ctx.fillRect(Math.round(x) - half, Math.round(y) - half, d, d);
  }

  /** Dabs along a segment, so a fast drag is a line rather than dots. */
  _line(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
    for (let i = 0; i <= steps; i++) {
      this._dab(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    }
  }

  _paintTo(uv) {
    const size = this.canvas.width;
    const point = { x: uv.x * size, y: (1 - uv.y) * size };
    this.ctx.save();
    // THE mask. Everything that puts pixels on this canvas goes through it.
    clipToBoundary(this.ctx, size, this.tuning.boundary);
    if (this.erasing) {
      // Alpha out, not paint over. See the header.
      this.ctx.globalCompositeOperation = 'destination-out';
      this.ctx.fillStyle = PALETTE.ui.text;
    } else {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.fillStyle = this.colour;
    }
    if (this._lastUv) this._line(this._lastUv, point);
    else this._dab(point.x, point.y);
    this.ctx.restore();
    this._lastUv = point;
    this._rebake();
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  _setRay(canvas, camera, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, camera);
    this.root.updateMatrixWorld(true);
    return true;
  }

  /** The panel UV under a point, or null if the pointer is not on the panel. */
  _panelUv(canvas, camera, clientX, clientY) {
    if (!this._setRay(canvas, camera, clientX, clientY)) return null;
    for (const hit of this._ray.intersectObject(this.cap, false)) {
      // Only the artwork slot. The skirt and the liner have UVs of their own and
      // painting through them would put marks on the far side of the cap.
      if (hit.face?.materialIndex === CAP_GROUP.PANEL && hit.uv) return hit.uv;
    }
    return null;
  }

  pick(canvas, camera, clientX, clientY) {
    if (this.confirm?.open) {
      return { kind: 'dialog', hit: this.confirm.pick(canvas, camera, clientX, clientY) };
    }
    if (!this._setRay(canvas, camera, clientX, clientY)) return null;
    for (const c of this._controls) {
      if (!c.mesh.visible) continue;
      if (this._ray.intersectObject(c.mesh, false).length) return { kind: c.kind, id: c.id, control: c };
    }
    // Not a control: the cap itself, which is a canvas in draw mode and a
    // turntable in view mode.
    const uv = this._panelUv(canvas, camera, clientX, clientY);
    if (this.mode === EDITOR_MODE.DRAW) {
      return uv ? { kind: 'canvas', uv } : null;
    }
    return { kind: 'turntable' };
  }

  /**
   * Is a turntable drag in progress?
   *
   * `move` returns true for a brush stroke as well, and the two want opposite
   * cursors — a stroke stays a crosshair on the point it is painting, a spin
   * becomes a closed hand. The caller cannot tell them apart from `move`'s
   * boolean, so it asks here.
   */
  get spinning() {
    return !!this._drag;
  }

  setHover(hit) {
    this._hover = hit;
    if (this.confirm?.open) {
      this.confirm.setHover(hit?.hit ?? null);
      return;
    }
    this.refresh();
  }

  /** @returns {boolean} whether the press was consumed. */
  press(hit, clientX, clientY) {
    if (!hit) return false;

    if (hit.kind === 'dialog') {
      this.confirm.activate(hit.hit);
      return true;
    }
    if (hit.kind === 'canvas') {
      if (this.readOnly) return true;
      this._stroke = true;
      this._lastUv = null;
      this._paintTo(hit.uv);
      return true;
    }
    if (hit.kind === 'turntable') {
      this._drag = { y: clientY, vel: 0 };
      this.spinVel = 0;
      return true;
    }
    return this._activate(hit.id);
  }

  move(canvas, camera, clientX, clientY) {
    if (this._stroke) {
      const uv = this._panelUv(canvas, camera, clientX, clientY);
      // Off the panel mid-stroke: the dab is dropped and the chain is broken, so
      // coming back on does not draw a line across the gap.
      if (uv) this._paintTo(uv);
      else this._lastUv = null;
      return true;
    }
    if (this._drag) {
      const dy = clientY - this._drag.y;
      this._drag.y = clientY;
      const rate = this.tuning.rotateRadiansPerPixel;
      this.spin += dy * rate;
      // Kept for the throw. Averaged lightly so one stray pixel at release does
      // not become the whole velocity.
      this._drag.vel = this._drag.vel * 0.6 + dy * rate * 0.4;
      return true;
    }
    return false;
  }

  release() {
    if (this._stroke) {
      this._stroke = false;
      this._lastUv = null;
      this._commit();
      return;
    }
    if (this._drag) {
      this.spinVel = this._drag.vel * this.tuning.flingScale;
      this._drag = null;
    }
  }

  _activate(id) {
    if (id === 'mode:draw') {
      if (!this.readOnly) this.mode = EDITOR_MODE.DRAW;
      this.refresh();
      return true;
    }
    if (id === 'mode:view') {
      this.mode = EDITOR_MODE.VIEW;
      this.refresh();
      return true;
    }
    if (id === 'eraser') {
      this.erasing = !this.erasing;
      this.refresh();
      return true;
    }
    if (id === 'undo') {
      this.undo();
      return true;
    }
    if (id === 'redo') {
      this.redo();
      return true;
    }
    if (id === 'clear') {
      this.clear();
      return true;
    }
    if (id?.startsWith('brush:')) {
      this.brush = Number(id.slice(6));
      /**
       * The size does NOT put the eraser away, and the colour below does.
       *
       * They look like the same kind of control sitting in the same row and they
       * are two different axes. A COLOUR is a paint-only idea — picking one is
       * picking to paint, and leaving the eraser armed would rub out in a colour
       * the player just chose. A SIZE belongs to whichever tool is in hand:
       * `_dab` reads `BRUSH_SIZES[this.brush]` for the eraser exactly as it does
       * for the brush, so the eraser has always had a width and it has always
       * been this one.
       *
       * It used to clear `erasing` here too, copied from the colour branch, and
       * that made the eraser's width unreachable: the only way to change it was
       * to leave eraser mode, pick a size, and arm the eraser again — three
       * presses to do what the row looks like it does in one, with nothing on
       * screen explaining why the middle press turned the eraser off.
       */
      this.refresh();
      return true;
    }
    if (id?.startsWith('colour:')) {
      this.colour = MARK_SWATCHES[Number(id.slice(7))];
      // Choosing a colour is choosing to paint. Leaving the eraser armed would
      // make the next stroke rub out in a colour the player just picked.
      this.erasing = false;
      this.refresh();
      return true;
    }
    if (id === 'save') {
      this._askSave();
      return true;
    }
    if (id === 'back') {
      this.requestExit();
      return true;
    }
    return false;
  }

  _askSave() {
    if (this.readOnly) return;
    const existed = this.book.hasSlot(this.ref);
    this.confirm.ask(
      existed ? '이 마크를 수정하시겠습니까?' : '이 마크를 저장하시겠습니까?',
      {
        // 저장은 COMMIT 이다. 덮어쓰는 경우에도, 잃는 것은 화면 밖의 예전
        // 그림이 아니라 방금까지 그린 것을 남기지 않는 쪽이다.
        confirmLabel: existed ? '수정' : '저장',
        onConfirm: () => {
          this.book.setSlot(this.ref, this.canvas.toDataURL('image/png'));
          this._savedAt = this._historyAt;
          this.refresh();
        },
      },
    );
  }

  /**
   * Leave — but not silently over unsaved work.
   *
   * "저장하지 않고 나가면 저장되지 않는다 … 소리 없이 날리지 마라." So the exit is
   * a request rather than an action: clean, it goes; dirty, it asks first and
   * the discard only happens on an explicit 확인.
   */
  requestExit() {
    if (!this.dirty) {
      this.onExit();
      return;
    }
    this.confirm.ask('저장하지 않고 나가시겠습니까?', {
      onConfirm: () => this.onExit(),
      // 그린 것이 사라진다. 이 화면에서 유일하게 되돌릴 수 없는 것이다.
      confirmLabel: '나가기',
      destructive: true,
    });
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  update(dt) {
    const drawing = this.mode === EDITOR_MODE.DRAW;
    if (drawing) {
      // Top-down and locked. The brief fixes the camera in draw mode so a stroke
      // lands where it looked like it would.
      this.spin = 0;
      this.spinVel = 0;
    } else if (!this._drag && this.spinVel !== 0) {
      this.spin += this.spinVel * dt * 60;
      // Exponential decay, framerate-independent at the step sizes this loop
      // sees. Stops rather than crawling forever.
      this.spinVel *= Math.pow(Math.max(0, this.tuning.spinDamping), dt * 60);
      if (Math.abs(this.spinVel) < 1e-4) this.spinVel = 0;
    }
    this.pivot.rotation.x = this.spin;
  }

  /** Push every control's texture to match the current state. */
  refresh() {
    const drawing = this.mode === EDITOR_MODE.DRAW && !this.readOnly;
    const hoverId = this._hover?.id ?? null;

    for (const b of this.modeButtons) {
      const wants = b.id === (drawing ? 'mode:draw' : 'mode:view');
      const state = b.id === 'mode:draw' && this.readOnly
        ? 'disabled'
        : wants
          ? 'active'
          : b.id === hoverId
            ? 'hover'
            : 'idle';
      b.mesh.material.uniforms.uMap.value = iconTexture(b.icon, state, {
        size: Math.max(12, Math.round(b.w)),
      });
    }

    /**
     * TOOLS AND PALETTE EXIST ONLY IN DRAW MODE.
     *
     * "팔레트와 그리기 도구는 표시되지 않는다" for view mode, and hiding them is
     * also what makes the mode legible: a screen with no tools on it is
     * obviously not a screen you are painting on.
     */
    for (const s of this.swatches) {
      s.mesh.visible = drawing;
      s.mesh.material.uniforms.uMap.value = swatchTexture(
        s.colour,
        !this.erasing && s.colour === this.colour,
        s.w,
      );
    }
    for (const t of this.tools) {
      t.mesh.visible = drawing;
      let state = t.id === hoverId ? 'hover' : 'idle';
      /**
       * TWO controls in this row can be lit at once, and that is the point.
       *
       * The row looks like one set of four radio buttons and is two axes: which
       * tool is in hand (brush or eraser) and how wide it is. The size used to be
       * lit only while painting — `&& !this.erasing` — so arming the eraser left
       * the whole row showing one highlight on the eraser and nothing about its
       * width, while `_dab` went on using the width the player could no longer
       * see. The setting was in force and unreadable, which is the worst of the
       * three possible states.
       *
       * So the size is lit whichever tool it is sizing. With the eraser armed
       * the row reads "eraser, this wide", which is what it has always been
       * doing.
       */
      if (t.id === `brush:${this.brush}`) state = 'active';
      if (t.id === 'eraser' && this.erasing) state = 'active';
      // Greyed when there is nothing to go back to or forward to, which the
      // brief asks for explicitly.
      if (t.id === 'undo' && this._historyAt <= 0) state = 'disabled';
      if (t.id === 'redo' && this._historyAt >= this._history.length - 1) state = 'disabled';
      t.mesh.material.uniforms.uMap.value = iconTexture(t.icon, state, {
        size: Math.max(12, Math.round(t.w)),
      });
    }

    this.saveButton.mesh.visible = !this.readOnly;
    this.saveButton.mesh.material.uniforms.uMap.value = saveButtonTexture(
      this.readOnly ? 'disabled' : hoverId === 'save' ? 'hover' : 'idle',
    );
    this.backButton.mesh.material.uniforms.uMap.value =
      hoverId === 'back' ? this._backMaps.hover : this._backMaps.idle;
    // The boundary belongs to drawing. In view mode it would be a ring floating
    // in front of a cap being turned.
    this.ring.visible = drawing;
  }

  setCanvasSize(size) {
    if (size === this.canvas.width) return;
    const prev = this.canvas;
    this.size = size;
    this.canvas = createMarkCanvas(size);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.ctx.save();
    clipToBoundary(this.ctx, size, this.tuning.boundary);
    this.ctx.drawImage(prev, 0, 0, size, size);
    this.ctx.restore();
    this._bakeCanvas = bakeCapPanel(null, this.tuning.capColor, size, this.tuning.boundary);
    this.panelTexture.image = this._bakeCanvas;
    this._rebake();
    this._history = [this._snapshot()];
    this._historyAt = 0;
    this._savedAt = -1;
    this.refresh();
  }

  /** The panel edited the palette. Drop the cached chips and redraw. */
  refreshPalette() {
    swatchCache.clear();
    for (let i = 0; i < this.swatches.length; i++) this.swatches[i].colour = MARK_SWATCHES[i];
    if (!MARK_SWATCHES.includes(this.colour)) this.colour = MARK_SWATCHES[0];
    this.refresh();
  }

  setBoundary(boundary) {
    this.tuning.boundary = boundary;
    this.ring.material.uniforms.uMap.value = ringTexture(boundary);
  }

  dispose() {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
    this.panelTexture.dispose();
    for (const c of this._controls) {
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
    }
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.fill.dispose();
    this.root.clear();
  }
}

// ── textures owned by this screen alone ─────────────────────────────────────

const swatchCache = new Map();

/** A colour chip. The selected one gets the toolbar's gold edge. */
function swatchTexture(colour, selected, size = L.swatch) {
  const edge = Math.max(8, Math.round(size));
  const key = `${colour}:${selected}:${edge}`;
  const hit = swatchCache.get(key);
  if (hit) return hit;

  /**
   * 색 견본. 둥근 사각형에 유리 테두리.
   *
   * 각진 두 사각형에 필터 끔이었다. 그 파이프라인의 것이고, 이 화면에서 각진 것은
   * 견본뿐이 됐다. 안쪽은 **평평하게** 칠한다 — 광택을 올리면 고른 색이 화면에서
   * 다른 색으로 보이고, 색을 고르는 화면에서 그건 치명적이다. 광택은 테두리에만.
   */
  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = edge * scale;
  canvas.height = edge * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.scale(scale, scale);

  const r = edge * 0.22;
  roundRectPath(ctx, 0, 0, edge, edge, r);
  ctx.fillStyle = selected ? PALETTE.cobalt : PALETTE.ui.edge;
  ctx.fill();
  roundRectPath(ctx, edge * 0.12, edge * 0.12, edge * 0.76, edge * 0.76, r * 0.7);
  ctx.fillStyle = colour;
  ctx.fill();
  if (selected) {
    focusRing(ctx, {
      x: 0.5,
      y: 0.5,
      w: edge - 1,
      h: edge - 1,
      radius: r,
      accent: PALETTE.cobalt,
    });
  }

  const tex = toMarkTexture(canvas);
  swatchCache.set(key, tex);
  return tex;
}

const ringCache = new Map();

/**
 * The boundary, as a one-texel ring on a transparent field.
 *
 * Additive, so it brightens the cap under it rather than covering it — a solid
 * ring would hide the outermost paint, which is exactly the paint a player is
 * checking when they look at the boundary.
 */
function ringTexture(boundary) {
  const key = String(boundary);
  const hit = ringCache.get(key);
  if (hit) return hit;
  /**
   * 경계선. 획 하나로 그린 원이다.
   *
   * 예전에는 128x128 픽셀을 전부 돌면서 중심까지의 거리가 `r ± 1` 인 텍셀만
   * 칠했다 — "두 텍셀 폭, 하드 엣지. 감쇠 없음: 부드러운 링은 그라디언트다".
   * nearest 확대를 전제한 계산이고, 그 전제가 사라진 지금 화면에서는 계단진
   * 점선처럼 보인다. 실제로 편집기 스크린샷에서 원이 아니라 점들의 고리였다.
   *
   * `arc` 한 번이면 어느 크기에서도 원이다. 파선인 것은 이것이 **경계**이지
   * 그림의 일부가 아니라는 것을 말하기 위해서다 — 실선 원은 사용자가 그린 것으로
   * 오해될 수 있고, 그건 지울 수 없는 원을 그린 것처럼 보이는 일이다.
   */
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  const half = size / 2;
  const r = half * Math.max(0.05, Math.min(1, boundary));

  /**
   * 밝은 색이어야 한다. 이 쿼드는 **가산** 블렌드로 그려진다.
   *
   * 예전 코드는 `ui.textMuted` 를 썼고 그건 어두운 청회색이다. 텍셀을 하드 엣지로
   * 찍을 때는 알파가 1 이라 그래도 보였지만, 안티에일리어스된 획은 가장자리 알파가
   * 낮고 가산 블렌드에서는 더한 양이 그만큼 줄어든다. 가산으로 그릴 것은 더할 빛이
   * 있는 색이어야 한다.
   */
  ctx.save();
  ctx.setLineDash([size * 0.035, size * 0.028]);
  ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.018;
  ctx.strokeStyle = PALETTE.bluePale;
  ctx.beginPath();
  ctx.arc(half, half, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const tex = toMarkTexture(canvas);
  ringCache.set(key, tex);
  return tex;
}

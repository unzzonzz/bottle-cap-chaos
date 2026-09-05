import { FRAME, frameScale, texelScale } from '../core/frame.js';
import { PANEL, SIZE, SPACE, TYPE } from '../core/tokens.js';

/**
 * 부록 B 의 골격 — 제목 탭 · 내용 · 구분선 · 푸터 — 을 프레임에 맞춰 푼다.
 *
 * ── `columnLayout` 이 있는데 왜 또 만드나 ───────────────────────────────────
 * 저쪽은 **판을 쌓는** 문제를 푼다. 판 여섯 장을 위에서 아래로 놓고 프레임에
 * 넘치면 줄인다. 그게 전부이고, 그래서 조사표가 지적한 것 — 뒤로 가기가 목록의
 * 마지막 항목처럼 보인다 — 을 만들어 낸 것도 저쪽이다. 쌓기만 하는 solver 는
 * 쌓인 것들을 다 같은 종류로 만든다.
 *
 * 여기서 푸는 것은 **네 구역**이다: 이름(탭), 고르는 것(내용), 하는 것(푸터),
 * 그리고 둘을 가르는 선. 구역이 다르면 좌표계도 다르므로 계산도 여기 따로 있다.
 *
 * ── 가로와 세로는 다른 문제다 ───────────────────────────────────────────────
 * 가로는 **자르기**다. 패널은 저술된 448 을 쓰되 프레임이 좁으면 그만큼 좁아지고,
 * 버튼은 언제나 패널 폭에서 좌우 여백을 뺀 값이다. 그래서 `SIZE.buttonChoice.w`
 * 400 은 여기서 읽히지 않는다 — 그건 448 프레임에서의 결과이지 독립된 사실이
 * 아니고, 두 곳에 적혀 있으면 언젠가 하나만 바뀐다.
 *
 * 세로는 **접기**다. 800x459 창의 프레임은 421x316 이고, 여기에 탭 36 + 여백 30 +
 * 줄 넷 + 푸터 80 을 저술된 크기로 넣으면 480 이 필요하다. 그러니 세로는 반드시
 * 줄어들 수 있어야 하고, 줄어드는 순서는 `columnLayout` 이 세운 것과 같다:
 * **간격 먼저, 그다음 전부**. 간격이 먼저인 이유는 빽빽한 화면은 읽히지만 잘린
 * 화면은 고장 나 보이기 때문이다.
 *
 * 두 번째 단계가 줄 높이만이 아니라 탭·여백·푸터까지 함께 줄이는 것은, 넷 중
 * 하나만 버티면 그 하나가 화면을 다 먹기 때문이다 — 316 짜리 프레임에서 푸터
 * 80 을 지키면 내용에 남는 것이 126 이다.
 */

/** 패널 텍스처의 텍셀 배수. 레티나에서 텍셀 하나가 화면 픽셀 하나. */
/**
 * 텍셀 배수. 화면에서 되읽는다 — `core/frame.texelScale` 머리말 참조.
 *
 * 상수 2 였다. 큰 창에서 모자라 글자가 흐려졌다.
 */
export const PANEL_TEXEL_SCALE = 2;

/**
 * 세로 축소의 바닥.
 *
 * 0.45 는 최악의 경우(가로로 긴 창의 설정 화면)에서 실제로 필요한 값이다. 그
 * 아래로 내려가도 되는 화면은 없으므로 바닥이고, 바닥에 닿으면 넘치는 대신
 * 붙어서 조금 잘린다 — 잘리는 것은 언제나 푸터 아래의 여백이다.
 */
const MIN_VERTICAL = 0.45;

/**
 * @param {object} o
 * @param {boolean} [o.title]   제목 탭이 있는가
 * @param {boolean} [o.caption] 탭 아래 부제가 있는가
 * @param {Array<{id: string, h?: number}>} o.rows
 *   위에서 아래로. `h` 는 448 패널 기준 높이이며, 없으면 CHOICE 버튼 높이.
 * @param {boolean|number} [o.footer]
 *   푸터가 있는가, 그리고 버튼 몇 개인가. `true` 는 1 과 같다. 개수가 필요한
 *   것은 버튼이 하나뿐인 화면에서 그 하나가 절반만 쓸 이유가 없기 때문이다.
 * @returns {{
 *   kx: number, ky: number,
 *   panel: {w: number, h: number, tabHeight: number, texH: number},
 *   pad: {x: number, top: number},
 *   scale: number,
 *   plate: {width: number, height: number},
 *   gap: number,
 *   rows: Array<{id: string, y: number, h: number}>,
 *   footer: {height: number, y: number, button: {w: number, h: number},
 *            left: number, right: number},
 * }}
 *   모든 y 는 프레임 **세로 한가운데**를 0 으로 하고 위가 양수다. 이 화면들이
 *   메시를 놓는 좌표계가 그렇다.
 */
export function solvePanel({ title = false, caption = false, rows = [], footer = true }) {
  const footerCount = footer === true ? 1 : (footer || 0);
  // ── 가로.
  const w = Math.min(PANEL.width, FRAME.width - SPACE.md * 2);
  const kx = w / PANEL.width;
  const padX = Math.round(PANEL.padX * kx);
  const plateWidth = Math.max(1, w - padX * 2);

  // ── 세로. 저술된 크기로 먼저 재 보고, 넘치면 접는다.
  const captionH = caption ? SIZE.captionLine : 0;
  const authored = {
    tab: title ? PANEL.titleTabHeight : 0,
    padTop: PANEL.padTop + captionH,
    footer: footerCount > 0 ? PANEL.footerHeight : 0,
  };
  /**
   * CHOICE 버튼의 높이는 **폭도** 본다. 세로 접기보다 먼저 정해진다.
   *
   * 알약의 둥근 끝 두 개가 폭에서 먹는 것은 정확히 `h` 다. 저술된 400x64 에서
   * 평평한 가운데는 336, 곧 폭의 84% 다. 좁은 프레임에서 폭만 190 으로 줄고
   * 높이가 64 로 남으면 그 비율이 66% 로 떨어지고, 그만큼 라벨이 잘린다 —
   * 실측: 256 폭 프레임에서 "마스터 볼륨 70%" 가 "마스터 볼륨 7..." 이 됐다.
   *
   * 가운데가 폭의 75% 아래로 내려가지 않게 상한을 건다. 84% 가 아니라 75% 인
   * 것은, 완전히 비례시키면 좁은 화면에서 버튼이 글자보다 얇아지기 때문이다 —
   * 바닥이 그 경우를 막는다.
   *
   * 세로 접기(`ky`)보다 **먼저** 정한다. 이것은 폭만 보고 답이 나오는 값이고,
   * 접기는 이 값이 정해진 뒤의 총 높이를 보고 정해진다. 순서가 반대면 순환이다.
   */
  const rowHeight = Math.max(
    Math.round(TYPE.body.size * 1.7),
    Math.min(SIZE.buttonChoice.h, Math.round(plateWidth * 0.25)),
  );
  const raw = rows.map((r) => ({ id: r.id, h: r.h ?? rowHeight }));
  const gaps = Math.max(0, raw.length - 1);
  const room = FRAME.height - SPACE.md * 2;

  const fixed = () => authored.tab + authored.padTop + authored.footer
    + raw.reduce((a, r) => a + r.h, 0);

  let gap = SPACE.sm;
  if (fixed() + gaps * gap > room && gaps > 0) {
    gap = Math.max(4, Math.floor((room - fixed()) / gaps));
  }
  let ky = 1;
  if (fixed() + gaps * gap > room) {
    ky = Math.max(MIN_VERTICAL, (room - gaps * gap) / fixed());
  }

  const tabHeight = Math.round(authored.tab * ky);
  const padTop = Math.round(authored.padTop * ky);
  const footerHeight = Math.round(authored.footer * ky);
  const plateHeight = Math.max(1, Math.round(rowHeight * ky));
  const heights = raw.map((r) => Math.max(1, Math.round(r.h * ky)));

  const bodyH = padTop + heights.reduce((a, h) => a + h, 0) + gaps * gap + footerHeight;
  const texH = tabHeight + bodyH;

  // ── 배치. 덩어리를 프레임 세로 한가운데에 놓고 위에서 아래로 채운다.
  const top = texH / 2;
  let y = top - tabHeight - padTop;
  const out = raw.map((r, i) => {
    const row = { id: r.id, y: y - heights[i] / 2, h: heights[i] };
    y -= heights[i] + gap;
    return row;
  });

  /**
   * 푸터 버튼은 **줄 수 있는 만큼** 넓다. 저술된 150 이 상한이다.
   *
   * `SIZE.buttonFooter.w * kx` 였고, 256 폭 프레임에서 71 이 나왔다. 71 짜리
   * 알약에서 둥근 끝을 빼면 라벨에 34 픽셀이 남고, "◀ 메뉴로" 는 거기서 "◀ …"
   * 이 된다. 푸터 버튼은 열처럼 여러 장이 쌓이지 않으므로 좁힐 이유가 없다.
   */
  const fw = Math.round(
    Math.min(SIZE.buttonFooter.w, (plateWidth - SPACE.sm * (footerCount - 1)) / Math.max(1, footerCount)),
  );
  // 같은 알약 논리. 폭의 절반보다 높으면 평평한 가운데가 남지 않는다.
  const fh = Math.round(Math.min(SIZE.buttonFooter.h * ky, footerHeight - SPACE.xs, fw * 0.5));

  return {
    kx,
    ky,
    panel: { w, h: bodyH, tabHeight, texH },
    pad: { x: padX, top: padTop },
    /**
     * 텍셀 배수는 상한에 걸린다.
     *
     * 세로로 긴 창에서는 패널이 600 픽셀을 넘고, 거기에 2 를 곱하면 텍스처가
     * 1200 텍셀이 된다. `core/textures.js` 가 세운 1024 상한은 이 파일을 거치지
     * 않는 캔버스에도 같은 이유로 적용된다 — 그보다 큰 것은 화면에 보이지 않는
     * 해상도를 메모리에 들고 있는 것이다.
     */
    /**
     * 배수는 화면이 정하고, 텍스처 한 변이 1024 를 넘지 않는 선에서 깎인다.
     *
     * `PANEL_TEXEL_SCALE` 은 이제 하한이 아니라 이름만 남은 상수다 — 실제
     * 배수는 `texelScale()` 이 frameScale 과 디바이스 픽셀 비로 낸다.
     */
    scale: Math.max(1, Math.min(texelScale(), 1024 / Math.max(w, texH))),
    plate: { width: plateWidth, height: plateHeight },
    gap,
    rows: out,
    footer: {
      height: footerHeight,
      y: -top + footerHeight / 2,
      button: { w: fw, h: Math.max(1, fh) },
      left: -w / 2 + padX + fw / 2,
      right: w / 2 - padX - fw / 2,
    },
  };
}

/**
 * 푼 배치를 프레임의 **왼쪽 위**에 붙인다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * `solvePanel` 은 판 하나를 화면 가운데에 놓는 것을 전제로 x=0 을 중심으로 모든
 * 줄을 푼다. 판이 있을 때는 그게 맞았다 — 카드가 구도의 중심이었으니까. 판을
 * 걷어낸 지금(`menuTextures.panelTexture` 머리말) 가운데 정렬은 근거를 잃었다:
 * 남은 것은 활자뿐이고, 홈 화면의 활자는 전부 프레임 가장자리에 붙는다. 제목은
 * 왼쪽 위로 흘러 나가고 내비와 날짜 도장은 30 의 여백에 선다.
 *
 * 줄 사이의 관계는 `solvePanel` 이 이미 맞춰 놓았으므로 다시 풀지 않는다.
 * 바뀌어야 하는 것은 그 덩어리가 어디에 앉느냐 하나이고, 그래서 루트만 옮긴다.
 *
 * 여백 30 은 홈의 내비·날짜 도장과 **같은 값**이다. 화면마다 다른 값을 쓰면
 * 오갈 때 글자가 좌우로 흔들린다 — 같은 세로선에 서야 제자리에 있는 것처럼
 * 보인다. 세로도 마찬가지로 위에 건다: 가운데 정렬이면 줄 수가 다른 화면끼리
 * 첫 줄의 높이가 달라져 화면을 바꿀 때 목록이 위아래로 뛴다.
 *
 * @param {import('three').Object3D} root  화면의 루트
 * @param {{plate: {width: number}, rows: {y: number, h: number}[]}} box  solvePanel 의 결과
 * @param {number} unitsPerPixel
 * @param {number} [topPx]  프레임 위쪽에서 첫 줄까지, 저술 픽셀
 */
export function anchorTopLeft(root, box, unitsPerPixel, topPx = 52) {
  const k = frameScale();
  const margin = 30 * k;
  // 줄 쿼드는 x=0 에 중심이 있고 글자는 그 왼쪽 끝에서 시작한다.
  root.position.x = (-FRAME.width / 2 + margin + box.plate.width / 2) * unitsPerPixel;
  const first = box.rows?.length ? box.rows[0].y + box.rows[0].h / 2 : 0;
  root.position.y = (FRAME.height / 2 - topPx * k - first) * unitsPerPixel;
}

/**
 * 난외 표제를 프레임의 **왼쪽 위 여백**에 정확히 붙인다.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * `panelTexture` 는 화면 이름을 캔버스의 왼쪽 위 모서리에 그린다. 그 캔버스를
 * 입은 쿼드는 판이 있던 시절 화면 한가운데에 놓였고, 그래서 이름도 판의 위쪽
 * 모서리에 따라갔다. 판을 걷어낸 지금 그 쿼드는 여전히 판 크기이고 여전히
 * `anchorTopLeft` 가 옮긴 루트를 따라 움직이므로, 이름이 프레임 위로 밀려나
 * 잘리거나 여백 밖에 선다 — 화면마다 다른 자리에서.
 *
 * 쿼드의 **왼쪽 위 모서리**가 여백에 오도록 직접 놓는다. 루트가 이미 옮겨져
 * 있으므로 그만큼 빼야 한다 — 이 함수가 루트 위치를 받는 이유가 그것이다.
 *
 * 여백은 왼쪽 30, 위 22 다. 왼쪽은 목록·내비·날짜 도장과 같은 값이고, 위가
 * 그보다 작은 것은 이것이 제목이 아니라 난외 표제이기 때문이다 — 페이지의
 * 맨 위에 붙어 있어야 머리글로 읽힌다.
 *
 * @param {import('three').Object3D} panel  `panelTexture` 를 입은 쿼드
 * @param {{panel: {w: number, texH: number}}} box
 * @param {import('three').Object3D} root   `anchorTopLeft` 가 옮긴 루트
 * @param {number} unitsPerPixel
 */
export function anchorHead(panel, box, root, unitsPerPixel) {
  const k = frameScale();
  const u = unitsPerPixel;
  const wantX = (-FRAME.width / 2 + 30 * k + box.panel.w / 2) * u;
  const wantY = (FRAME.height / 2 - 22 * k - box.panel.texH / 2) * u;
  panel.position.set(wantX - root.position.x, wantY - root.position.y, 0);
}

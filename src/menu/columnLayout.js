import { FRAME } from '../core/frame.js';
import { SPACE } from '../core/tokens.js';

/**
 * 메뉴의 세로 열 배치. 세 화면(설정 · 상대 선택 · 온라인)이 같은 답을 쓴다.
 *
 * ── 고정 좌표가 왜 틀렸나 ───────────────────────────────────────────────────
 * 세 화면 모두 행의 y 를 손으로 적어 두고 있었다 — 설정은 176 / 124 / 22 / -36 /
 * -94 / -152 / -210 같은 식으로. 그 숫자들은 480 픽셀 높이의 프레임에서만 맞고,
 * `resolveFrame` 은 창이 가로로 길면 프레임을 316 까지 낮춘다. 800x459 창에서 세
 * 화면 다 위아래가 잘려 나갔고, 설정 화면은 제목과 마지막 두 줄이 아예 안 보였다.
 *
 * 좌표를 적는 대신 **순서와 높이**만 주고 여기서 푼다. 행이 조건부로 사라지는
 * 화면들이라 — 오디오 모델이 없으면 볼륨 줄이 없고, `?debug=1` 이 아니면 서버 줄이
 * 없다 — 좌표를 손으로 적으면 조합마다 구멍이 생긴다는 문제도 같이 사라진다.
 *
 * ── 줄이는 순서: 간격 -> 높이 ───────────────────────────────────────────────
 * 덩어리가 프레임보다 크면 먼저 간격을 깎는다. 간격이 0 이 되어도 넘치면 그때
 * 높이를 깎는다. 이 순서인 이유는, 빽빽한 화면은 읽을 수 있고 잘린 화면은 고장 나
 * 보이기 때문이다. 높이는 60% 아래로는 내려가지 않는다 — 그 아래는 판 안의 글자가
 * 알약 두께보다 커지기 시작한다.
 */

/** 640 폭 프레임 기준의 판. 다른 모든 크기가 여기서 나온다. */
export const PLATE = { width: 256, height: 52 };

/** 판 텍스처의 텍셀 배수. 레티나에서 텍셀 하나가 화면 픽셀 하나가 되는 값. */
export const PLATE_TEXEL_SCALE = 2;

/**
 * @param {Array<{id: string, h?: number}>} slots
 *   위에서 아래로. `h` 는 640 프레임 기준 높이이며, 없으면 판 높이.
 * @returns {{
 *   k: number,
 *   plate: {width: number, height: number},
 *   gap: number,
 *   rows: Array<{id: string, y: number, h: number}>,
 * }}
 */
export function solveColumn(slots) {
  /**
   * 판 폭은 프레임에 **들어가는 한** 저술된 크기 그대로다.
   *
   * 처음에는 폭도 `FRAME.width / 640` 으로 줄였는데, 그러면 312 폭 세로 화면에서
   * 판이 125 가 됐다 — 프레임의 40% 이고, 위아래로는 자리가 남아도는데 좌우로만
   * 쪼그라든 모양이다. 이 화면들은 화면을 혼자 쓰므로 폭을 양보할 이유가 없다.
   * 세로로 모자랄 때만 줄이면 되고, 그건 아래에서 따로 푼다.
   *
   * 메뉴 열(`MenuItems`)이 다른 규칙을 쓰는 것은 거기가 병 옆이라 폭의 절반밖에
   * 못 쓰기 때문이다. 제약이 다르면 답도 다르다.
   */
  const width = Math.min(PLATE.width, FRAME.width - SPACE.md * 2);
  const k = width / PLATE.width;
  const plate = { width: Math.round(width), height: Math.round(PLATE.height * k) };

  const raw = slots.map((sl) => ({ id: sl.id, h: Math.round((sl.h ?? PLATE.height) * k) }));
  const room = FRAME.height - SPACE.md * 2;
  const gaps = Math.max(0, raw.length - 1);
  let heights = raw.reduce((a, sl) => a + sl.h, 0);

  /**
   * 간격에는 **바닥**이 있다.
   *
   * 처음에는 간격을 0 까지 깎고 나서 높이를 줄였는데, 그러면 판 여섯 장이 서로
   * 맞닿아 하나의 긴 덩어리로 보인다. 알약 모양이라 더 그렇다 — 둥근 끝끼리 붙으면
   * 어디가 경계인지 알 수 없다. 그래서 최소 간격을 먼저 떼어 놓고, 남는 높이에
   * 판들을 맞춘다. 빽빽한 목록은 읽을 수 있지만 경계가 없는 목록은 아니다.
   */
  const minGap = Math.max(2, Math.round(SPACE.xs * k));
  let gap = Math.round(SPACE.sm * k);
  if (heights + gaps * gap > room && gaps > 0) {
    gap = Math.max(minGap, Math.floor((room - heights) / gaps));
  }
  if (heights + gaps * gap > room && heights > 0) {
    const f = Math.max(0.6, (room - gaps * gap) / heights);
    plate.height = Math.round(plate.height * f);
    for (const sl of raw) sl.h = Math.max(1, Math.round(sl.h * f));
    heights = raw.reduce((a, sl) => a + sl.h, 0);
  }

  const total = raw.reduce((a, sl) => a + sl.h, 0) + gaps * gap;
  let y = total / 2;
  const rows = raw.map((sl) => {
    const row = { id: sl.id, y: y - sl.h / 2, h: sl.h };
    y -= sl.h + gap;
    return row;
  });

  return { k, plate, gap, rows };
}

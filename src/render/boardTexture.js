import { makeCanvasTexture } from '../core/textures.js';
import { PALETTE } from '../core/palette.js';

/**
 * 알까기 보드의 표면: 허니 브라운 목재, 그려서 만든다.
 *
 * 보드는 원래 단색 삼각형 두 개였다. 정점 단위 셰이딩에서 그건 조명된 정점 네
 * 개라는 뜻이고, 표면 어디에도 명암 변화가 없다 — 뚜껑이 미끄러질 때 미끄러질
 * 대상이 없었다. 흐름도, 스케일 기준도, 눈이 속도를 잴 것도 없다.
 *
 * ── 짜임(weave)이었고, 이제 나뭇결이다 ──────────────────────────────────────
 * 원래는 어두운 천 매트의 평직이었다. 아트 디렉션이 바뀌면서 색만 허니 톤으로
 * 바꿔 뒀는데, 그 상태가 남긴 문제가 둘이었다: 짜임은 목재가 아니고, 3텍셀짜리
 * 실이 화면에서 1픽셀 밑으로 축소되면서 보드 전체가 모아레로 끓었다.
 *
 * 나뭇결은 그 두 가지를 동시에 푼다. 결은 한 방향으로 길게 이어지므로 축소될 때
 * 방향을 따라 뭉개질 뿐 격자처럼 간섭하지 않는다.
 *
 * ── 좌표가 전부 정규화되어 있고, 그게 이 파일의 규칙이다 ────────────────────
 * 예전 코드는 "실 두께 3텍셀"처럼 절대 텍셀로 쓰여 있었다. 128 텍셀에서 3은
 * 2.3% 지만 1024 에서는 0.3% 라, 상한만 올리면 같은 그림이 커지는 게 아니라
 * 다른 그림이 된다. 여기서는 모든 치수가 `size` 에 대한 비율이므로 해상도를
 * 바꿔도 같은 나무가 나온다.
 *
 * ── 이음매 없이 반복된다 ────────────────────────────────────────────────────
 * 결은 x 에 대한 주기함수의 합이고 주파수가 전부 정수라, 좌우가 정확히 이어진다.
 * y 방향 흔들림도 정수 주파수여서 위아래도 이어진다. 이게 아니면 보드마다
 * 타일 경계에 세로 줄이 보인다.
 */

/** 한 반복이 덮는 월드 단위(cm). */
export const BOARD_TILE = 14;

const BASE = PALETTE.board.wood;
const GRAIN_HI = PALETTE.board.grainHi;
const GRAIN_LO = PALETTE.board.grainLo;
const FLECK = PALETTE.board.fleck;

/** 텍셀 한 변. `MAX_TEXTURE` 가 상한이다. */
const SIZE = 512;

export function makeBoardTexture() {
  return makeCanvasTexture(SIZE, drawBoard);
}

/** `#rrggbb` 를 [r,g,b] 로. 이 파일 안에서만 쓴다. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function drawBoard(ctx, size) {
  const base = rgb(BASE);
  const hi = rgb(GRAIN_HI);
  const lo = rgb(GRAIN_LO);

  const img = ctx.createImageData(size, size);
  const d = img.data;

  /**
   * 결의 주파수. 전부 정수라서 타일이 이어진다.
   *
   * 낮은 주파수 둘이 널판의 큰 흐름을, 높은 것 셋이 실제 결을 만든다. 진폭은
   * 위로 갈수록 작아진다 — 브리프가 "결은 매우 은은하게"를 요구하고, 목재는
   * 무늬가 아니라 표면이기 때문이다.
   */
  const bands = [
    { fx: 3, fy: 1, amp: 0.16, phase: 0.0, wobble: 0.020 },
    { fx: 7, fy: 2, amp: 0.13, phase: 1.7, wobble: 0.014 },
    { fx: 15, fy: 1, amp: 0.10, phase: 3.1, wobble: 0.010 },
    { fx: 31, fy: 3, amp: 0.07, phase: 0.8, wobble: 0.006 },
    { fx: 61, fy: 2, amp: 0.05, phase: 2.4, wobble: 0.004 },
  ];

  /**
   * 결 전체의 대비를 한 번 더 눌러 주는 배수.
   *
   * 첫 시도는 진폭도 흔들림도 이보다 두 배 컸는데, 나무가 아니라 대리석이 나왔다.
   * 실제 널판의 결은 멀리서 보면 거의 무늬가 없고 색이 살짝 흐를 뿐이다 —
   * 브리프도 "결은 매우 은은하게"라고 못박는다. 보드는 뚜껑이 미끄러지는 바닥이지
   * 보는 대상이 아니다.
   */
  const CONTRAST = 0.55;

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;

      // 결 값. -1..1 근처로 모인다.
      let g = 0;
      for (const b of bands) {
        // y 로 흔들어야 결이 자로 그은 직선이 아니라 나무가 된다.
        const warp = b.wobble * Math.sin(TAU * b.fy * v);
        g += b.amp * Math.sin(TAU * b.fx * (u + warp) + b.phase);
      }

      /**
       * 부드러운 결 위에 가끔 진한 선을 얹는다.
       *
       * 실제 널판은 완만한 명암 사이에 뚜렷한 늦여름 결이 몇 줄 있다. 사인 합만
       * 쓰면 그게 없어서 표면이 나무가 아니라 천처럼 물결친다. `pow` 로 마루만
       * 남겨 그 몇 줄을 만든다.
       */
      const ridge = Math.pow(Math.max(0, Math.sin(TAU * 13 * (u + 0.015 * Math.sin(TAU * v)))), 14);
      const t = Math.max(-1, Math.min(1, (g - ridge * 0.35) * CONTRAST));

      const mixTo = t >= 0 ? hi : lo;
      const k = Math.abs(t);
      const i = (y * size + x) * 4;
      d[i] = base[0] + (mixTo[0] - base[0]) * k;
      d[i + 1] = base[1] + (mixTo[1] - base[1]) * k;
      d[i + 2] = base[2] + (mixTo[2] - base[2]) * k;
      d[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);

  /**
   * 반점. `Math.random` 이 아니라 해시에서 나온다.
   *
   * 시뮬레이션과는 무관하지만, 새로 고칠 때마다 다른 보드가 나오면 두 스크린샷을
   * 비교할 수 없고 이 단계는 대부분 스크린샷을 비교해서 판단한다.
   */
  ctx.fillStyle = FLECK;
  ctx.globalAlpha = 0.35;
  const flecks = Math.round(size * size * 0.0012);
  const dot = Math.max(1, size * 0.0025);
  for (let i = 0; i < flecks; i++) {
    const h = hash2(i, 7);
    const x = h % size;
    const y = Math.floor(h / size) % size;
    // 결과 같은 방향으로 늘여 놓아야 반점이 결의 일부로 읽힌다.
    ctx.fillRect(x, y, dot, dot * (2 + ((h >>> 11) % 4)));
  }
  ctx.globalAlpha = 1;
}

const TAU = Math.PI * 2;

/** 결정론적 32비트 해시. 매번 같은 보드. */
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ b, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

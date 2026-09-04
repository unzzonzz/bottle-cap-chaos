import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from 'three';
import { PALETTE, withAlpha } from '../core/palette.js';
import { RADIUS, SIZE, SPACE, TYPE } from '../core/tokens.js';
import { applyTracking, fontSpec, panel, roundRectPath } from '../ui/paper.js';
import { drawIcon, iconForCard } from '../ui/icons.js';

/** 카드의 세로:가로. `tokens.js` 가 정한다. */
const CARD_RATIO = SIZE.card.h / SIZE.card.w;
import { registerTextureCache } from '../ui/fonts.js';

/**
 * 카드 면. 요구받은 해상도로 그린다.
 *
 * ── 해상도가 둘인 이유 ──────────────────────────────────────────────────────
 * 손에 든 카드는 화면에서 작고, 거기엔 낮은 해상도로 충분하다. 같은 텍스처가
 * **읽히기 위해** 들어 올려 확대된 카드에서는 충분하지 않다: 설명 줄이 가장 먼저
 * 무너지고, 읽을 수 없는 카드는 고를 수 없는 카드다. 그래서 호버된 카드는 더 큰
 * 텍스처로 바꿔 달았다가 내려놓으면 되돌린다 — 메시 LOD 와 같은 발상이고 같은
 * 이유다. 둘 사이에 다른 것은 그림이 받는 텍셀 수뿐이라, 카드가 디테일을 바꿀 때
 * **생김새**는 바뀌지 않는다.
 *
 * ── 글자를 이진화하던 것은 사라졌다 ─────────────────────────────────────────
 * 예전에는 글자를 스크래치 캔버스에 그린 뒤 알파를 0 아니면 255 로 자르고 합성했다.
 * 저해상도 타겟에 nearest 로 확대되고 5비트로 양자화되는 파이프라인에서 글자
 * 가장자리의 중간 알파가 디더와 함께 압축 아티팩트처럼 보였기 때문이다. 그 셋 —
 * 저해상도 타겟, nearest 확대, 양자화 — 이 모두 사라졌으므로 이진화도 사라졌다.
 * `drawText` 의 주석에 자세히 적혀 있다.
 *
 * ── 좌표는 프레임 픽셀이다 ──────────────────────────────────────────────────
 * 이 파일의 숫자는 `tokens.js` 의 `SIZE.card` (150x220) 기준이고, 캔버스 자체에
 * 배율이 걸린다. 예전에는 128 폭 기준으로 저술하고 모든 숫자에 `u = w / 128` 을
 * 곱했는데, 그러면 코드를 읽어서는 카드가 실제로 몇 픽셀인지 알 수 없었다.
 *
 * ── 캐시된다 ────────────────────────────────────────────────────────────────
 * 카드와 크기로 키를 만든다. 하나 만드는 데 캔버스 호출 수십 번이 들고, 그건 한 번은
 * 아무것도 아니지만 매 프레임이면 생각할 수 없다.
 */

/**
 * A card's accent, from the palette rather than from the catalog.
 *
 * `cardCatalog` still carries an `accent` per card and it is deliberately not
 * the source of truth: the catalog lives under `src/game/`, which is simulation
 * territory that art work does not edit, and its six accents were chosen against
 * a near-black card face. This looks the id up in `PALETTE.card` and falls back
 * to the catalog value for a card the palette has not been told about, so adding
 * one cannot leave the hand with an undefined `strokeStyle`.
 */
export function accentOf(card) {
  return PALETTE.card[card.id] ?? card.accent;
}


/**
 * 아트 패널의 배경 무늬. 카드마다 다르다.
 *
 * ── 왜 필요했나 ─────────────────────────────────────────────────────────────
 * 구조는 유리 패널 → 이름 → 아트 패널 → 아이콘 → 설명 세 줄이었고, 아트 패널이
 * 사실상 비어 있었다: accent 12% 의 옅은 사각형 하나 위에 아이콘 하나. 그래서
 * 여섯 장이 **accent 색과 아이콘 모양만** 달랐다. 부채꼴에서 카드는 왼쪽 끝이 조금
 * 나오거나 기울어 겹쳐 있고, 그 상태에서 구분되는 것은 색 하나뿐이었다.
 *
 * ── 일러스트가 아니라 절차적 배경이다 ───────────────────────────────────────
 * 카드마다 그림을 그리면 파이프라인이 하나 늘고, 여섯 장이 서로 다른 손에서 나온
 * 것처럼 보이기 시작한다. 여기 있는 것은 전부 같은 규칙을 따르는 추상 무늬다:
 * accent 계열 안에서만, 알파 0.10~0.25, 그리고 **아이콘보다 뒤로 물러난다.**
 * 아이콘이 여전히 주역이고, 배경이 아이콘을 읽기 어렵게 하면 그건 실패다.
 *
 * ── 물방울과 기포는 금지다 ──────────────────────────────────────────────────
 * 병(`menu/Bottle`)과 오브(`OrbView`)가 이미 그 언어를 쓴다. 카드까지 쓰면 화면에서
 * 같은 것이 세 번 나오고, 그러면 그건 모티프가 아니라 이 게임의 기본 무늬가 된다.
 *
 * ── 난수가 없다 ─────────────────────────────────────────────────────────────
 * 전부 닫힌 식이다. 텍스처는 해상도마다 다시 구워지고 패널의 슬라이더 하나로도
 * 캐시가 비므로, 난수를 쓰면 같은 카드가 다시 구워질 때 무늬가 바뀐다 — 플레이어가
 * 보기에 그건 카드가 바뀐 것이다.
 *
 * @param {CanvasRenderingContext2D} ctx  카드 프레임 좌표
 * @param {string} id     카탈로그의 카드 id
 * @param {{x:number,y:number,w:number,h:number,accent:string}} panel
 */
function drawArtMotif(ctx, id, { x, y, w, h, accent }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.save();
  roundRectPath(ctx, x, y, w, h, RADIUS.chip);
  ctx.clip();
  ctx.lineCap = 'round';

  switch (id) {
    /**
     * 궤적 — 아래에서 위로 흐르는 곡선 다발. 한 줄만 진하다.
     *
     * 카드가 하는 일이 "길게 내다본다" 이므로 선이 패널 밖으로 나가야 한다. 다발
     * 안의 한 줄만 진한 것은 예측선이 여럿 중 **고른 하나**이기 때문이다.
     */
    case 'trajectory': {
      for (let i = 0; i < 5; i++) {
        const k = i / 4;
        const lead = i === 3;
        ctx.strokeStyle = withAlpha(accent, lead ? 0.34 : 0.13);
        ctx.lineWidth = lead ? 3 : 1.6;
        ctx.beginPath();
        ctx.moveTo(x - 4, y + h - 2 - k * h * 0.18);
        ctx.bezierCurveTo(
          x + w * 0.3, y + h * (0.86 - k * 0.5),
          x + w * 0.55, y + h * (0.5 - k * 0.28),
          x + w + 4, y + h * (0.34 - k * 0.24),
        );
        ctx.stroke();
      }
      break;
    }

    /**
     * 혼란 — 어긋난 파형 두 겹.
     *
     * 주기가 서로 나누어떨어지지 않아(3 과 4.5) 두 줄이 만났다 벌어졌다 한다. 그
     * 간섭무늬가 곧 "흐트러진다"이고, 같은 주기 두 개는 그냥 굵은 선 하나로 보인다.
     * `CardFx` 가 팔레트 주기를 서로 소로 잡는 것과 같은 이유의 같은 장치다.
     */
    case 'chaos': {
      for (const [cycles, phase, alpha] of [[3, 0, 0.22], [4.5, 1.1, 0.14]]) {
        ctx.strokeStyle = withAlpha(accent, alpha);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (let i = 0; i <= 48; i++) {
          const t = i / 48;
          const px = x + t * w;
          const py = cy + Math.sin(t * Math.PI * 2 * cycles + phase) * h * 0.3;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      break;
    }

    /**
     * 강타 — 중심으로 수렴하는 방사선. 중앙이 가장 밝다.
     *
     * 선이 중심에서 **멈추지 않고** 조금 못 미쳐 끝난다. 다 만나면 별이 되고, 별은
     * 혼란의 것이다. 못 미치면 힘이 아직 도착하지 않은 것으로 읽힌다.
     */
    case 'smash': {
      const r0 = Math.min(w, h) * 0.16;
      const r1 = Math.max(w, h) * 0.72;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + 0.26;
        ctx.strokeStyle = withAlpha(accent, i % 3 === 0 ? 0.22 : 0.11);
        ctx.lineWidth = i % 3 === 0 ? 3 : 1.8;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        ctx.stroke();
      }
      break;
    }

    /**
     * 원모어 — 겹쳐 도는 링 셋. 끊긴 곳이 서로 어긋난다.
     *
     * 끊김이 한 자리에 모이면 고리가 아니라 괄호가 된다. 어긋나 있어야 눈이 한
     * 고리에서 다음 고리로 넘어가고, 그 넘어감이 "한 번 더"다.
     */
    case 'onemore': {
      // 아이콘도 고리다. 그래서 링은 아이콘 **밖에서** 시작해야 한다 — 안쪽에서
      // 돌면 배경이 아니라 아이콘의 일부로 읽히고, 이 카드만 무늬가 없는 것이 된다.
      const base = Math.min(w, h) * 0.3;
      for (let i = 0; i < 3; i++) {
        const r = base + i * Math.min(w, h) * 0.17;
        ctx.strokeStyle = withAlpha(accent, 0.22 - i * 0.05);
        ctx.lineWidth = 3 - i * 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0.9 + i * 2.1, 0.9 + i * 2.1 + Math.PI * 1.55);
        ctx.stroke();
      }
      break;
    }

    /**
     * 침묵 — 촘촘한 격자에 한 칸씩 어긋난 결. 가장 어둡고 조용하다.
     *
     * 여섯 장 중 유일하게 곡선이 없다. 다른 다섯 장이 전부 흐르거나 도는 무늬라,
     * 격자 하나만으로 이 카드는 "멈춘 것"이 된다. 세로선을 가로선보다 옅게 해서
     * 결이 한 방향으로 눕는다 — 완전히 균질한 격자는 배경이 아니라 무늬가 된다.
     */
    case 'silence': {
      const cell = Math.min(w, h) * 0.19;
      ctx.lineWidth = 1.2;
      for (let gx = x + cell * 0.5; gx < x + w; gx += cell) {
        ctx.strokeStyle = withAlpha(accent, 0.1);
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + h);
        ctx.stroke();
      }
      let row = 0;
      for (let gy = y + cell * 0.5; gy < y + h; gy += cell, row++) {
        // 한 줄 걸러 반 칸 밀린다. 자물쇠의 결이지 방안지가 아니다.
        const off = row % 2 ? cell * 0.5 : 0;
        ctx.strokeStyle = withAlpha(accent, 0.2);
        ctx.beginPath();
        ctx.moveTo(x + off - cell, gy);
        ctx.lineTo(x + w, gy);
        ctx.stroke();
      }
      break;
    }

    /**
     * 철벽 — 아래로 눌린 두꺼운 수평 층. 겹칠수록 진해진다.
     *
     * ── 여섯 장 중 **움직이지 않는 유일한 무늬**다 ──────────────────────────
     * 궤적은 흐르고, 혼란은 어긋나고, 강타는 수렴하고, 원모어는 돌고, 스왑은
     * 교차한다. 침묵조차 격자가 한 줄 걸러 밀려 있어서 결이 한 방향으로 눕는다.
     * 이것만 아무 데도 가지 않는다 — 그게 카드의 뜻이고, 다섯 장이 전부 움직이는
     * 세트 안에서는 정지 자체가 가장 눈에 띄는 성질이다.
     *
     * ── 두께가 아래로 갈수록 늘고 알파도 같이 는다 ──────────────────────────
     * 균일한 줄무늬는 무늬지 무게가 아니다. 아래쪽 층이 두껍고 진한 것은 위에서
     * 눌리고 있다는 뜻이고, 눌려서 다져진 것이 이 카드가 뚜껑에 하는 일이다.
     * 곡선은 하나도 없다 — 침묵과 이 카드만 곡선이 없는데, 저쪽은 자물쇠의 결이고
     * 이쪽은 쌓인 층이라 형태가 겹치지 않는다.
     */
    case 'resist': {
      const rows = 5;
      // 위에서부터 쌓아 내려온다. 하나씩 더해 가므로 층의 위치는 그 위에 쌓인
      // 것들의 합이고, 두께와 틈을 바꾸면 아래가 따라 움직인다.
      let ry = y + h * 0.06;
      for (let i = 0; i < rows; i++) {
        const k = i / (rows - 1);
        // 아래로 갈수록 두껍고, 층 사이의 틈은 반대로 좁아진다 — 다져지는 것.
        const th = h * (0.055 + k * 0.075);
        const gap = h * (0.055 - k * 0.03);
        // 패널 밖으로 넘겨 그린다. 층이 카드 안에서 끝나면 쌓인 벽이 아니라
        // 떠 있는 막대 다섯 개가 된다. 클립은 이 함수 첫머리에 걸려 있다.
        // 옅다. 아이콘이 벽돌이라 잔 무늬가 많고, 배경까지 진하면 둘이 같은
        // 자리에서 싸운다 — 이 파일 첫머리의 규칙대로 아이콘이 이긴다.
        ctx.fillStyle = withAlpha(accent, 0.05 + k * 0.07);
        ctx.fillRect(x - 4, ry, w + 8, th);
        ry += th + gap;
      }
      break;
    }

    /**
     * 스왑 — 서로를 지나쳐 가는 두 호.
     *
     * 부록의 표에는 이 카드가 없지만 비워 두면 여섯 장 중 한 장만 배경이 없고,
     * 그건 "즉시 구분된다"를 다섯 장에서만 만족한다는 뜻이다. 두 호가 **교차한 뒤
     * 반대쪽으로 나가는** 것이 이 카드가 하는 일 그대로다.
     */
    case 'swap':
    default: {
      for (const dir of [1, -1]) {
        ctx.strokeStyle = withAlpha(accent, dir > 0 ? 0.22 : 0.13);
        ctx.lineWidth = dir > 0 ? 3 : 2.2;
        ctx.beginPath();
        ctx.moveTo(x - 4, cy - dir * h * 0.3);
        ctx.bezierCurveTo(
          cx - w * 0.1, cy - dir * h * 0.3,
          cx + w * 0.1, cy + dir * h * 0.3,
          x + w + 4, cy + dir * h * 0.3,
        );
        ctx.stroke();
      }
      break;
    }
  }

  /**
   * ── 위쪽에 아주 옅은 흰 광택이 있었다 ──────────────────────────────────
   * 근거는 "이건 인쇄물이 아니라 **코팅된** 카드고, 아트 패널은 유리 아래에
   * 있는 것으로 보여야 한다" 였다. 그 전제가 뒤집혔다 — §8.2 는 카드 면을
   * **종이**로 정의한다. 코팅이 없으므로 코팅의 반사도 없다.
   */
  ctx.restore();
}

const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

/**
 * 텍스트를 그린다. 임계 처리 없이, 대상 컨텍스트에 바로.
 *
 * ── 스크래치 캔버스와 알파 이진화가 사라졌다 ────────────────────────────────
 * 예전 이름은 `crispText` 였고, 스크래치 캔버스에 글자를 그린 뒤 알파를 110 에서
 * 0 아니면 255 로 자르고 그것을 blit 했다. 제자리에서 자르면 밑에 이미 그려진
 * 그림까지 같이 잘리기 때문에 캔버스가 하나 더 필요했다.
 *
 * 그 임계 처리는 저해상도 타겟에 nearest 로 확대되는 파이프라인에서 글자 가장자리의
 * 중간 알파가 디더와 5비트 양자화를 거치며 지저분해지는 것을 막으려던 것이다. 셋 다
 * 없다.
 *
 * 없애서 얻은 것이 셋이다: 글자가 부드럽고, 고DPI 에서 선명하고, 텍스처 하나마다
 * 있던 `getImageData` / `putImageData` 왕복이 사라졌다 — 그건 GPU 파이프라인을
 * 세우는 동기 호출이라 공짜가 아니었다.
 */
function drawText(target, { text, x, y, font, color, align = 'left' }) {
  target.save();
  target.font = font;
  target.textAlign = align;
  target.textBaseline = 'alphabetic';
  target.fillStyle = color;
  target.fillText(text, x, y);
  target.restore();
}

/**
 * 캔버스를 텍스처로. 네 군데가 같은 여덟 줄을 반복하고 있었다.
 *
 * `mips` 는 카드 면/뒷면에만 켠다. 손에 든 카드는 부채꼴로 기울어 있고 화면에서
 * 축소돼 보이므로 밉이 있어야 한다. 반대로 드롭 가이드와 알림 판은 화면에 정면으로,
 * 텍셀 하나가 픽셀 하나가 되게 놓이는 쿼드라 밉이 낭비이자 흐림이다.
 */
function toTexture(canvas, { mips = true } = {}) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter;
  tex.generateMipmaps = mips;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = mips ? 4 : 1;
  tex.needsUpdate = true;
  return tex;
}

/** Wrap `text` to `width` px in the current font, by measuring. */
function wrap(ctx, text, width, font) {
  ctx.font = font;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {import('../game/cards/cardCatalog.js').CardDef} card
 * @param {number} width  texels. Height follows the card's 2:3 proportion.
 */
export function cardFaceTexture(card, width) {
  const w = Math.max(48, Math.round(width));
  const h = Math.round(w * CARD_RATIO);
  const key = `face:${card.id}:${w}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(w, h);
  /**
   * 프레임 좌표로 그린다. 텍셀은 `w` 가 정한다.
   *
   * 예전에는 128 폭 카드를 기준으로 저술하고 `u = w / 128` 을 모든 숫자에 곱했다.
   * 이제 캔버스 자체에 배율을 걸어 두면 아래 숫자가 `tokens.js` 의 프레임 픽셀과
   * 같은 단위가 된다 — 카드가 150 폭이라는 사실이 코드에 그대로 보인다.
   */
  const fw = SIZE.card.w;
  const fh = SIZE.card.h;
  ctx.scale(w / fw, h / fh);

  const accent = accentOf(card);

  /**
   * 카드 면은 유리 패널이다. 모서리는 둥글고, 잘라낸 모서리(chamfer)는 없다.
   *
   * 예전에는 각진 테두리에 두 모서리를 사선으로 잘라냈고, 주석이 그 이유를
   * "라운드를 주면 피치와 다른 프로그램에서 온 것처럼 보인다"고 적어 두었다.
   * 지금은 정반대다 — UI 전체가 pill 과 라운드 패널이고, 각진 카드가 남으면
   * 그것만 다른 프로그램에서 온 것으로 보인다.
   */
  panel(ctx, { x: 0, y: 0, w: fw, h: fh, radius: RADIUS.card, accent, alpha: 1 });

  /**
   * ── 이름 위의 색 띠는 없앴다 ────────────────────────────────────────────────
   * 위쪽 가장자리를 따라 5픽셀짜리 accent 막대가 있었다. 근거는 "손에 쥐었을 때
   * 부채꼴로 겹쳐도 보이는 자리" 였고, 그건 사실이었다 — 부채꼴에서는 카드마다
   * 왼쪽 띠 한 줄만 나오니까. 그런데 그 값을 치르고 얻는 것이 겹쳤을 때의 색
   * 하나뿐이고, 카드가 펼쳐진 순간에는 유리판·아트 패널·아이콘이 이미 전부 같은
   * accent 로 물들어 있어서 막대는 같은 말을 네 번째로 하는 선 하나였다.
   *
   * 남은 여백 5픽셀은 돌려받는다. 이름의 baseline 이 `SPACE.sm + SPACE.md` 로
   * 올라가고 아래가 전부 5 씩 따라 올라오므로, 위 여백이 좌우와 같은 `SPACE.sm`
   * 이 된다.
   */
  const nameY = SPACE.sm + SPACE.md;
  applyTracking(ctx, TYPE.label.tracking);
  drawText(ctx, {
    text: card.name,
    x: fw / 2,
    y: nameY,
    font: fontSpec(TYPE.label),
    color: PALETTE.ui.text,
    align: 'center',
  });
  applyTracking(ctx, 0);

  /**
   * 아트 패널과 아이콘.
   *
   * 패널은 세 겹이다: accent 12% 의 물, 카드마다 다른 절차적 무늬(`drawArtMotif`),
   * 그 위의 아이콘. 무늬가 생기기 전에는 이 셋 중 가운데가 없어서 여섯 장이 색과
   * 아이콘만으로 갈렸다 — 부채꼴에서 겹쳐 있으면 색 하나뿐이었다.
   *
   * 유니코드 글리프가 아니라 `icons.js` 의 벡터다. 글리프 다섯 개는 46px 에서
   * 잉크 픽셀 수를 세어 고른 것이었고, 그 측정은 알파 이진화를 전제로 했다.
   * 이진화가 없으므로 제약도 없다 — `iconForCard` 가 카탈로그의 `glyph` 를
   * 아이콘 이름으로 옮긴다.
   */
  const artY = nameY + SPACE.sm;
  const artH = fh * 0.42;
  const artX = SPACE.sm;
  const artW = fw - SPACE.sm * 2;
  ctx.save();
  roundRectPath(ctx, artX, artY, artW, artH, RADIUS.chip);
  ctx.fillStyle = withAlpha(accent, 0.12);
  ctx.fill();
  ctx.restore();
  drawArtMotif(ctx, card.id, { x: artX, y: artY, w: artW, h: artH, accent });

  const icon = iconForCard(card);
  if (icon) {
    const size = Math.min(artH * 0.72, fw * 0.44);
    drawIcon(ctx, icon, { x: (fw - size) / 2, y: artY + (artH - size) / 2, size, color: accent });
  }

  // 설명. 카드 폭에 맞춰 접는다.
  const bodyFont = fontSpec(TYPE.caption);
  const lines = wrap(ctx, card.text, fw - SPACE.md * 2, bodyFont);
  let ty = artY + artH + SPACE.md;
  applyTracking(ctx, TYPE.caption.tracking);
  for (const line of lines.slice(0, 3)) {
    drawText(ctx, {
      text: line,
      x: fw / 2,
      y: ty,
      font: bodyFont,
      color: PALETTE.ui.textMuted,
      align: 'center',
    });
    ty += TYPE.caption.size + 4;
  }
  applyTracking(ctx, 0);

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}

/** The back. One texture for every card — that is what a back is. */
export function cardBackTexture(width) {
  const w = Math.max(48, Math.round(width));
  const h = Math.round(w * CARD_RATIO);
  const key = `back:${w}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(w, h);
  const fw = SIZE.card.w;
  const fh = SIZE.card.h;
  ctx.scale(w / fw, h / fh);

  // 앞면과 같은 유리 패널. 뒷면만 각지면 부채꼴에서 그것만 튀어 보인다.
  panel(ctx, {
    x: 0,
    y: 0,
    w: fw,
    h: fh,
    radius: RADIUS.card,
    accent: PALETTE.blueClear,
    alpha: 1,
  });

  /**
   * 사선 줄무늬. 그라디언트가 아니라 무늬다.
   *
   * 패널 안쪽으로 클리핑해서 라운드 모서리를 넘지 않게 한다 — 예전에는 각진
   * 사각형이라 클립이 필요 없었다.
   *
   * 아주 옅다. 상대의 손은 화면 위쪽에 **늘 떠 있는** 것이라, 앞면 한 장만큼의
   * 대비를 가지면 판 위에서 눈이 그쪽으로 계속 끌린다. 처음 넣었을 때 `edgeStrong`
   * 을 알파 0.5 로 칠했더니 카드 다섯 장이 회색 빗금 덩어리가 됐다.
   */
  ctx.save();
  roundRectPath(ctx, 0, 0, fw, fh, RADIUS.card);
  ctx.clip();
  ctx.fillStyle = withAlpha(PALETTE.blueClear, 0.14);
  const band = 9;
  for (let i = -fh; i < fw + fh; i += band * 2) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + band, 0);
    ctx.lineTo(i + band + fh, fh);
    ctx.lineTo(i + fh, fh);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 가운데 표식. 이 게임의 물건인 왕관 뚜껑.
  const size = fw * 0.4;
  drawIcon(ctx, 'cap', {
    x: (fw - size) / 2,
    y: (fh - size) / 2,
    size,
    color: withAlpha(PALETTE.cobaltInk, 0.32),
  });

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}

/**
 * 경계에서 `grow` 만큼 밖(음수면 안)으로 밀린 라운드 사각형 하나를 긋는다.
 *
 * 부드러운 층은 전부 이것의 반복이다. 같은 경로를 굵기만 키워 여러 번 긋는 대신
 * **경로를 옮겨 가며** 긋는 것은, 그래야 감쇠가 한쪽으로만 갈 수 있기 때문이다 —
 * 같은 자리에서 굵기를 키우면 언제나 안팎 대칭이 되고, 드롭 가이드의 다크 헤일로는
 * 대칭이면 안 된다. 안쪽 절반이 슬롯 안을 어둡게 만들어, 흰 글로우가 앉을 자리를
 * 먼저 없앤다.
 */
function roundRing(ctx, { x, y, w, h, radius }, grow, lineWidth, style) {
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = style;
  roundRectPath(ctx, x - grow, y - grow, w + grow * 2, h + grow * 2, radius + grow);
  ctx.stroke();
}

/**
 * 겹친 링으로 감쇠 한 층을 쌓는다. `from` 에서 `to` 로 가며 옅어진다.
 *
 * `shadowBlur` 로도 되지만 캔버스 그림자는 한 번에 한 색이라 층마다 상태를 갈아야
 * 하고, 감쇠 곡선을 손에 쥘 수 없다. 링을 겹치면 곡선이 `weight` 하나다.
 *
 * 링의 굵기를 간격의 두 배로 잡아 이웃끼리 겹치게 한다 — 안 겹치면 감쇠가 아니라
 * 줄무늬가 된다. 그래서 한 점을 대략 두 링이 덮고, 목표 알파의 절반씩을 넣는다.
 */
function ringFalloff(ctx, rect, from, to, peak, weight, color) {
  const STEPS = 14;
  const span = to - from;
  const step = Math.abs(span) / STEPS;
  for (let i = STEPS; i >= 1; i--) {
    const t = i / STEPS;
    roundRing(ctx, rect, from + span * t, step * 2, withAlpha(color, peak * 0.5 * weight(1 - t)));
  }
}

/**
 * 드롭 가이드: 카드 모양의 빈 슬롯.
 *
 * ── 이건 **어포던스**고, 이미 있는 규칙 위에 놓인다 ──────────────────────────
 * 카드를 내는 동작은 부채꼴에서 위로 벗어나는 것이다 — `CardHand._checkArmed` 를
 * 보라 — 그리고 그것은 의도적으로 "표적 안에 착지하기"가 아니다. 거기 적힌 이유
 * 대로, 표적은 찾아야 하는 작은 것이고, 손의 어느 쪽 끝에서 시작했느냐에 따라 같은
 * 동작이 되기도 하고 안 되기도 하게 만든다. 그림이 생겼다고 그 중 무엇도 변하지
 * 않는다.
 *
 * 그림이 맡는 것은 문제의 나머지 절반, 실재하는 쪽이다: 보이지 않는 문턱은 실패해
 * 봐야만 알게 되는 문턱이다. 그래서 이것은 카드가 무장되는 바로 그 높이에 그려지고,
 * 따라서 이걸 따라가면 언제나 성공한다. 두 번째 규칙이 아니라 규칙 위의 표지판이다.
 *
 * ── 비어 있고, 카드보다 크다 ────────────────────────────────────────────────
 * 비어 있는 것은 옮기는 동안 카드가 그 너머로 읽혀야 하기 때문이다. 큰 것은 —
 * `guideMargin` 을 보라 — 카드와 정확히 같은 크기의 테두리는 카드가 도착하는 순간
 * 완전히 덮이는 테두리라, 무언가를 확인해 주는 바로 그 순간에 사라지기 때문이다.
 *
 * ── 선이 아니라 **빛**이다 ──────────────────────────────────────────────────
 * 이 자리의 주석은 두 번 뒤집혔고, 두 번 다 이유가 반쯤만 맞았다. 처음에는 두 톤의
 * 각진 띠였고, 근거는 "드롭 타깃 둘레의 부드러운 글로우는 이 화면이 기를 수 있는
 * 가장 현대적인 것"이었다 — 저해상도·양자화 파이프라인에서는 맞는 말이었다. 다음에는
 * 그 문장을 뒤집어 라운드 모서리와 시안 점선과 모서리 꺾쇠가 되었다. 파이프라인이
 * 사라졌다는 관찰은 옳았고 착지점이 틀렸다: 점선과 꺾쇠는 CAD 와 에디터 UI 의
 * 관용구고, 시안은 버튼 테두리·포커스 링과 같은 색이라 "여기가 특별한 자리다"를
 * 말하지 못한다. 둘 다 **선**이라는 점에서는 첫 번째 판본과 같은 물건이었다.
 *
 * 지금은 빛이다. 바깥에서 안쪽으로 네 층이고, 순서가 곧 이 그림이다:
 *
 *   1. 다크 헤일로   경계 바깥으로 넓게 감쇠하는 어두운 링. 팔레트의 네이비.
 *                    **이것이 없으면 나무판 위에서 가이드가 사라진다** — 흰 빛은
 *                    밝은 배경 위에서 없는 것과 같고, 새 팔레트는 나무판도 잔디도
 *                    컬링 테이블도 전부 밝다. 국소 대비를 만드는 받침이다.
 *   2. 흰 글로우     경계에서 주로 안쪽으로 감쇠하는 흰 빛. 바깥으로는 거의 나가지
 *                    않는다 — 나가면 1 을 씻어내고, 그러면 받침이 사라진다.
 *   3. 흰 코어       경계를 따라 얇고 단단한 흰 선. 형태를 유지하는 유일한 요소다.
 *                    글로우만 있으면 밝은 배경에서 **모양**이 사라진다.
 *   4. 안쪽 필       아주 옅은 흰색. "여기가 자리다". 카드가 그 위를 지나야 하므로
 *                    옅다.
 *
 * ── 구운 글로우다. 두 번째 블렌딩 모드가 아니다 ─────────────────────────────
 * 카드 씬은 블룸 밖이라(`CardLayer` 헤더) 빛나는 것은 전부 텍스처가 갖고 있어야
 * 한다. 그리고 네 층을 **한 장에** 굽는다: 다크 헤일로와 흰 글로우가 같은 텍스처
 * 안에 있으면 가산 블렌딩이 필요 없고, 따라서 `CardMaterials` 에 새 재질 종류가
 * 늘지 않고 `refreshTextures` 경로가 그대로 산다. 가산으로 갔다면 밝은 배경 대응을
 * 위해 어두운 층을 따로 알파로 그려야 했고, 그건 쿼드 두 장이다.
 *
 * ── 그래서 텍스처가 슬롯보다 크다 ───────────────────────────────────────────
 * 글로우와 헤일로가 퍼질 자리가 텍스처 안에 있어야 한다. 슬롯 사각형은 `bleed`
 * 만큼 안쪽으로 물러나 있고, 그리는 쪽이 쿼드를 그만큼 키워야 슬롯의 실제 크기가
 * `guideMargin` 이 정한 값 그대로 남는다 — 그 크기가 `userData` 로 돌아간다.
 * `noticeTexture` 가 같은 이유로 같은 일을 한다.
 *
 * 그 여백은 짧은 프레임에서 위 가장자리를 넘을 수 있다. 슬롯은 카드가 무장하는
 * 높이에 그려지고 그 높이는 `_checkArmed` 가 정하므로, 쿼드를 프레임 안으로
 * 밀어 넣는 것은 슬롯을 문턱이 아닌 곳으로 옮기는 것이라 할 수 없다. 넘어가는
 * 부분이 무엇인지 재 보면 괜찮다: 16:9 창(프레임 512x384)에서 잘리는 것은 헤일로
 * 바깥 13픽셀이고 그 구간의 알파는 0.004~0.06 이다. 형태를 지키는 코어와 흰
 * 글로우는 경계에서 4픽셀 안쪽이라 어떤 프레임에서도 잘리지 않는다.
 *
 * @param {number} width   slot texels across, matching the on-screen size
 * @param {number} height  slot texels down. Not derived: the guide carries a
 *                         margin, so its proportion is the card's only when
 *                         that is 0.
 * @returns {import('three').Texture} `userData` carries the padded DRAW size.
 */
export function useGuideTexture(width, height) {
  const sw = Math.max(24, Math.round(width));
  const sh = Math.max(24, Math.round(height));
  const key = `guide:${sw}:${sh}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const u = sw / SIZE.card.w;
  /** 형태를 유지하는 선. 1.5 프레임픽셀 아래로는 내려가지 않는다. */
  const core = Math.max(1.5, 2 * u);
  /** 글로우의 폭. 두께의 7배 — 6~8배 사이면 빛으로 읽히고 그 밖이면 띠가 된다. */
  const glow = core * 7;
  /** 헤일로는 그보다 넓다. 넓고 옅어야 받침이지 테두리가 아니다. */
  const halo = glow * 1.7;
  const bleed = Math.ceil(halo);
  const w = sw + bleed * 2;
  const h = sh + bleed * 2;

  const { canvas, ctx } = makeCanvas(w, h);
  const rect = { x: bleed, y: bleed, w: sw, h: sh, radius: RADIUS.card * u };
  ctx.lineJoin = 'round';

  // 1a. 넓고 아주 옅은 헤일로. 국소 대비의 대부분은 이것이 만든다.
  ringFalloff(ctx, rect, core * 0.5, halo, 0.13, (k) => k, PALETTE.ui.shadow);
  // 1b. 경계 바로 바깥의 좁고 진한 윤곽. 흰 선이 어느 배경에서도 끊기지 않게 한다.
  ringFalloff(ctx, rect, core * 0.4, core * 3.2, 0.2, (k) => k * k, PALETTE.ui.shadow);

  // 4. 안쪽 필. 유리다 — 슬롯 안쪽이 주변보다 아주 조금 밝아야 "빈 자리"로 읽힌다.
  roundRectPath(ctx, bleed + core * 0.5, bleed + core * 0.5, sw - core, sh - core, rect.radius);
  ctx.fillStyle = withAlpha(PALETTE.whiteCool, 0.12);
  ctx.fill();

  // 2. 흰 글로우. 주로 안쪽으로 — 바깥으로 나가면 1 을 씻어낸다.
  ringFalloff(ctx, rect, -core * 0.6, -glow, 0.42, (k) => k * k, PALETTE.whiteCool);
  ringFalloff(ctx, rect, core * 0.4, core * 1.6, 0.3, (k) => k, PALETTE.whiteCool);

  // 3. 흰 코어. 형태를 지키는 하나.
  roundRing(ctx, rect, 0, core, withAlpha(PALETTE.whiteCool, 0.92));

  /**
   * 밉은 여전히 없다.
   *
   * 이 쿼드는 화면에 정면으로, 텍셀 하나가 프레임 픽셀 하나가 되게 놓인다. 무장할 때
   * `guideArmedGrow` 로 최대 6% 커지지만 그건 **확대**라 이중선형이면 충분하고,
   * 밉은 축소에만 쓰인다. 예전 판본이 계단을 걱정했던 것은 그리는 것이 단단한 점선
   * 스트로크였기 때문이고, 부드러운 감쇠에는 확대할 계단이 없다.
   */
  const tex = toTexture(canvas, { mips: false });
  tex.userData = { width: w, height: h };
  cache.set(key, tex);
  return tex;
}

/**
 * 도착 글로우: 카드 뒤에서 짧게 퍼지는 흰 빛.
 *
 * 드롭 가이드와 같은 층 쌓기지만 **어두운 것이 하나도 없다.** 가이드는 밝은 판 위에
 * 놓이는 표지판이라 국소 대비를 만드는 받침이 필요하고, 이것은 카드 **뒤에서** 잠깐
 * 새어 나오는 빛이라 받침을 깔면 도착이 아니라 그림자가 떨어진 것으로 보인다.
 *
 * 카드가 뽑혀 부채꼴에 앉는 순간에만 쓰인다 — `CardHand._landing`. 몇 프레임 만에
 * 사라지므로 형태를 지키는 코어도 없다: 있으면 그 자리에 카드가 한 장 더 나타났다
 * 사라진 것으로 보인다.
 *
 * @returns {import('three').Texture} `userData` carries the padded DRAW size.
 */
export function cardGlowTexture(width, height) {
  const sw = Math.max(24, Math.round(width));
  const sh = Math.max(24, Math.round(height));
  const key = `glow:${sw}:${sh}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const u = sw / SIZE.card.w;
  const glow = Math.max(10, 20 * u);
  const bleed = Math.ceil(glow);
  const w = sw + bleed * 2;
  const h = sh + bleed * 2;

  const { canvas, ctx } = makeCanvas(w, h);
  const rect = { x: bleed, y: bleed, w: sw, h: sh, radius: RADIUS.card * u };
  ctx.lineJoin = 'round';

  roundRectPath(ctx, bleed, bleed, sw, sh, rect.radius);
  ctx.fillStyle = withAlpha(PALETTE.whiteCool, 0.55);
  ctx.fill();
  ringFalloff(ctx, rect, 0, glow, 0.55, (k) => k * k, PALETTE.whiteCool);

  const tex = toTexture(canvas, { mips: false });
  tex.userData = { width: w, height: h };
  cache.set(key, tex);
  return tex;
}

/**
 * A one-line plate: why a card cannot be played.
 *
 * Sized to the text rather than to a fixed box, so the plate is as wide as what
 * it says and no wider — a fixed-width tooltip either truncates the long reason
 * or leaves a slab of empty plate next to the short one.
 *
 * Drawn at one texel per frame pixel, like the cards, so it lands on the
 * framebuffer grid and the type survives. `width`/`height` come back on the
 * texture's `userData` because the caller has to scale the quad to match, and
 * scaling it to anything else would resample the very thing this exists to keep
 * readable.
 */
export function noticeTexture(text) {
  const key = `notice:${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const font = fontSpec(TYPE.caption);
  const probe = makeCanvas(8, 8);
  probe.ctx.font = font;
  applyTracking(probe.ctx, TYPE.caption.tracking);
  const w = Math.ceil(probe.ctx.measureText(text).width) + SPACE.md * 2;
  const h = TYPE.caption.size + SPACE.md;

  const { canvas, ctx } = makeCanvas(w, h);
  /**
   * 거절 사유는 알약 모양 판이다.
   *
   * 색은 `danger` 계열을 유지한다 — 이건 "못 낸다"는 말이고, 유리의 중립색으로
   * 칠하면 다른 안내와 구별되지 않는다. `plate` 을 쓰지 않는 것도 같은 이유로,
   * 저건 누를 수 있는 것의 모양이고 이건 읽는 것이다.
   */
  panel(ctx, {
    x: 0,
    y: 0,
    w,
    h,
    radius: h / 2,
    tint: withAlpha(PALETTE.ui.danger, 0.16),
    accent: PALETTE.ui.danger,
  });
  applyTracking(ctx, TYPE.caption.tracking);
  drawText(ctx, {
    text,
    x: w / 2,
    y: h / 2 + TYPE.caption.size * 0.36,
    font,
    color: PALETTE.ui.dangerDeep,
    align: 'center',
  });
  applyTracking(ctx, 0);

  const tex = toTexture(canvas, { mips: false });
  tex.userData = { width: w, height: h };
  cache.set(key, tex);
  return tex;
}

/** Drop every cached texture. For a resolution change from the panel. */
export const clearCardTextureCache = registerTextureCache(() => {
  for (const t of cache.values()) t.dispose();
  cache.clear();});

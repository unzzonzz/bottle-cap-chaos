import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
} from 'three';
import { PALETTE, withAlpha } from '../core/palette.js';
import { RADIUS, SIZE, SPACE, TYPE } from '../core/tokens.js';
import { applyTracking, fontSpec, glassPanel, roundRectPath } from '../ui/glass.js';
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

const BACK_MARK = PALETTE.ui.edgeStrong;

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
function accentOf(card) {
  return PALETTE.card[card.id] ?? card.accent;
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
  glassPanel(ctx, { x: 0, y: 0, w: fw, h: fh, radius: RADIUS.card, accent, alpha: 1 });

  // 카드 색 띠. 위쪽 가장자리를 따라, 손에 쥐었을 때 부채꼴로 겹쳐도 보이는 자리.
  ctx.fillStyle = accent;
  roundRectPath(ctx, SPACE.sm, SPACE.sm, fw - SPACE.sm * 2, 5, 2.5);
  ctx.fill();

  // 이름.
  applyTracking(ctx, TYPE.label.tracking);
  drawText(ctx, {
    text: card.name,
    x: fw / 2,
    y: SPACE.sm + 5 + SPACE.md,
    font: fontSpec(TYPE.label),
    color: PALETTE.ui.text,
    align: 'center',
  });
  applyTracking(ctx, 0);

  /**
   * 아트 패널과 아이콘.
   *
   * 유니코드 글리프가 아니라 `icons.js` 의 벡터다. 글리프 다섯 개는 46px 에서
   * 잉크 픽셀 수를 세어 고른 것이었고, 그 측정은 알파 이진화를 전제로 했다.
   * 이진화가 없으므로 제약도 없다 — `iconForCard` 가 카탈로그의 `glyph` 를
   * 아이콘 이름으로 옮긴다.
   */
  const artY = SPACE.sm + 5 + SPACE.md + SPACE.sm;
  const artH = fh * 0.42;
  ctx.save();
  roundRectPath(ctx, SPACE.sm, artY, fw - SPACE.sm * 2, artH, RADIUS.chip);
  ctx.fillStyle = withAlpha(accent, 0.12);
  ctx.fill();
  ctx.restore();

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
  glassPanel(ctx, {
    x: 0,
    y: 0,
    w: fw,
    h: fh,
    radius: RADIUS.card,
    accent: PALETTE.accent.sky,
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
  ctx.fillStyle = withAlpha(PALETTE.accent.sky, 0.14);
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
    color: withAlpha(PALETTE.accent.skyDeep, 0.32),
  });

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
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
 * ── 하드 밴드에서 부드러운 슬롯으로 ─────────────────────────────────────────
 * 예전에는 두 톤의 각진 띠와 정수 픽셀 사각형이었고, 주석이 그 이유를 "드롭 타깃
 * 둘레의 부드러운 글로우는 이 화면이 기를 수 있는 가장 현대적인 것"이라고 적어
 * 두었다. 그 문장은 이제 목표의 반대다. 모서리는 카드와 같은 `RADIUS.card` 로
 * 둥글고, 테두리는 점선이며 — 점선은 "여기는 아직 비어 있다"를 실선보다 잘 말한다 —
 * 모서리 꺾쇠만 실선으로 남겨 슬롯이라는 사실을 유지한다.
 *
 * @param {number} width   texels across, matching the on-screen size
 * @param {number} height  texels down. Not derived: the guide carries a margin,
 *                         so its proportion is the card's only when that is 0.
 */
export function useGuideTexture(width, height) {
  const w = Math.max(24, Math.round(width));
  const h = Math.max(24, Math.round(height));
  const key = `guide:${w}:${h}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(w, h);
  const u = w / SIZE.card.w;
  const radius = RADIUS.card * u;
  const line = Math.max(1.5, 2 * u);
  const pad = line;

  // 옅은 물. 슬롯 안쪽이 주변보다 아주 조금 밝아야 "빈 자리"로 읽힌다.
  roundRectPath(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
  ctx.fillStyle = withAlpha(PALETTE.accent.yellowPale, 0.1);
  ctx.fill();

  // 점선 테두리.
  ctx.save();
  ctx.setLineDash([10 * u, 7 * u]);
  ctx.lineCap = 'round';
  ctx.lineWidth = line;
  ctx.strokeStyle = withAlpha(PALETTE.accent.yellow, 0.85);
  roundRectPath(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
  ctx.stroke();
  ctx.restore();

  /**
   * 모서리 꺾쇠. 실선으로, 라운드를 따라 돈다.
   *
   * 테두리만 있으면 패널로 읽힌다. 꺾쇠 넷이 있어야 **슬롯**으로 읽히고, 그것이
   * 한 글자도 없이 "여기 놓아라"를 말하는 유일한 모양이다.
   */
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = line * 1.6;
  ctx.strokeStyle = PALETTE.accent.yellowPale;
  const arm = Math.max(6, 20 * u);
  const l = pad;
  const r = w - pad;
  const t = pad;
  const b = h - pad;
  const corners = [
    [l, t + radius, l, t, l + radius, t],
    [r, t + radius, r, t, r - radius, t],
    [l, b - radius, l, b, l + radius, b],
    [r, b - radius, r, b, r - radius, b],
  ];
  for (const [ax, ay, cx, cy, bx, by] of corners) {
    ctx.beginPath();
    ctx.moveTo(ax, ay + Math.sign(cy - ay) * -arm);
    ctx.arcTo(cx, cy, bx, by, radius);
    ctx.lineTo(bx + Math.sign(bx - cx) * arm, by);
    ctx.stroke();
  }
  ctx.restore();

  const tex = toTexture(canvas, { mips: false });
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
   * 칠하면 다른 안내와 구별되지 않는다. `gelButton` 을 쓰지 않는 것도 같은 이유로,
   * 저건 누를 수 있는 것의 모양이고 이건 읽는 것이다.
   */
  glassPanel(ctx, {
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

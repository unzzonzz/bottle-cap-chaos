import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { PALETTE, withAlpha } from '../core/palette.js';
import { registerTextureCache } from '../ui/fonts.js';
import { drawIcon } from '../ui/icons.js';

/**
 * 카드 효과의 그림.
 *
 * ── 이 파일 전체가 사라진 파이프라인을 위해 쓰여 있었다 ─────────────────────
 * 예전 머리말의 세 문단은 이렇게 주장했다:
 *
 *   "여기 있는 것은 전부 작고, 그것이 기법이다." 기절 별은 24 텍셀, 링은 32.
 *     "장면 전체가 640x480 버퍼로 해상되고 채널당 5비트로 양자화되므로, 256 텍셀
 *     스프라이트는 nearest 샘플러가 디테일 대부분을 버린다 — 그건 디테일로 보이지
 *     않고 노이즈로 보인다."
 *   "그라디언트 없음." "부드러운 방사형 그라디언트는 2D 캔버스가 만들 수 있는
 *     가장 현대적인 것이고, 5비트 양자화기가 어차피 밴딩으로 만든다."
 *   "프레임 적은 시트." 여덟 프레임의 45도 스텝, "매끄럽게 회전하는 쿼드는 공짜지만
 *     다른 게임에서 온 것처럼 보인다."
 *
 * 저해상도 버퍼도, nearest 샘플러도, 5비트 양자화기도 없다. 세 근거가 다 사라졌고,
 * 남은 것은 결과뿐이었다 — 승리 화면의 충격 링이 300 화면 픽셀을 32 텍셀로 채워
 * 네 개의 각진 사각형으로 보였다.
 *
 * ── 지금의 규칙 ─────────────────────────────────────────────────────────────
 * 그라디언트가 **기본**이다. Frutiger Aero 의 빛은 가장자리가 없다 — 유리에 맺힌
 * 반사도, 물속의 광선도, 거품의 하이라이트도 전부 부드럽게 사라진다. 하드 스텝은
 * 이제 그 반대의 신호이므로, 하나 남은 곳(대시 패턴)에만 이유를 적어 두었다.
 *
 * 크기는 화면에서 차지할 크기를 따라간다. 링이 300 픽셀에 걸쳐 그려지면 256 텍셀로
 * 굽는다. 밉맵도 켜져 있으므로 작게 나올 때도 손해가 없다 — `core/textures.js` 의
 * 머리말에 왜 밉맵 없는 축소가 부드럽게 만드는 것이 아니라 **버리는** 것인지 적혀
 * 있다.
 *
 * ── 가독성은 그대로다 (§0.4) ────────────────────────────────────────────────
 * 부드러워지는 것과 밝아지는 것은 다르다. 여기 스프라이트는 대부분 가산 블렌드로
 * 판 위에 올라가고, 판이 밝아진 지금 가산으로 더할 수 있는 여유는 예전보다 적다.
 * 그래서 알파의 상한이 전보다 낮다 — 뚜껑 위에 얹혀도 뚜껑이 보여야 한다.
 */

/** Every texture in this file, so a mode change can drop them all. */
const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas: c, ctx };
}

function finish(key, cv, { repeat = false, mips = true } = {}) {
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter;
  tex.generateMipmaps = mips;
  tex.anisotropy = 1;
  tex.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * 방사형 그라디언트를 정지점 목록으로.
 *
 * `stops` 는 `[반지름 0..1, 색, 알파]` 의 배열이다. 반지름을 정규화해 두는 이유는
 * 이 파일의 모든 스프라이트가 정사각형이고 크기가 호출부마다 다르기 때문이다 —
 * 0.62 는 어느 크기에서나 같은 자리를 가리키지만 20 은 그렇지 않다.
 */
function radial(ctx, size, stops) {
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  for (const [at, colour, alpha] of stops) g.addColorStop(at, withAlpha(colour, alpha));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

/**
 * 기절 별 한 장. `(ox, oy)` 에서 `size` 안에.
 *
 * ── 픽셀을 걸어 찍던 것에서 획으로 ──────────────────────────────────────────
 * 예전에는 네 팔을 텍셀 단위로 걸으며 세 톤을 찍었고, 주석이 `ctx.rotate` 를
 * 피하는 이유를 "캔버스 회전은 가장자리를 안티에일리어스하고, 안티에일리어스된
 * 스프라이트는 이 파이프라인에서 양자화기가 먼지로 만든다" 고 적어 두었다.
 * 그 파이프라인이 없으므로 회전해도 된다. 회전할 수 있으면 별은 한 번만 그리면
 * 된다.
 *
 * 빛나는 사각별이다 — 긴 팔 넷, 짧은 팔 넷, 그리고 가운데 광원. 뾰족한 것은
 * "아프다"를 말하고, 가운데가 밝은 것은 그것이 빛이라는 것을 말한다.
 */
function drawStar(ctx, ox, oy, size, angle) {
  const c = size / 2;
  const tones = PALETTE.fx.star;

  ctx.save();
  ctx.translate(ox + c, oy + c);
  ctx.rotate(angle);

  // 가운데 광원. 별의 팔이 여기서 자라 나오는 것으로 보여야 한다.
  ctx.save();
  ctx.translate(-c, -c);
  radial(ctx, size, [
    [0, tones[0], 0.95],
    [0.16, tones[1], 0.7],
    [0.42, tones[2], 0.12],
    [1, tones[2], 0],
  ]);
  ctx.restore();

  // 팔 여덟. 긴 것 넷과 짧은 것 넷이 번갈아 난다.
  const long = c * 0.94;
  const short = c * 0.42;
  const waist = c * 0.13;
  for (let k = 0; k < 8; k++) {
    const len = k % 2 === 0 ? long : short;
    ctx.save();
    ctx.rotate((k * Math.PI) / 4);
    const g = ctx.createLinearGradient(0, 0, 0, -len);
    g.addColorStop(0, withAlpha(tones[0], 0.9));
    g.addColorStop(0.45, withAlpha(tones[1], 0.55));
    g.addColorStop(1, withAlpha(tones[2], 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-waist, 0);
    ctx.quadraticCurveTo(-waist * 0.35, -len * 0.55, 0, -len);
    ctx.quadraticCurveTo(waist * 0.35, -len * 0.55, waist, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

/**
 * The stun star, `frames` of it in a row.
 *
 * ── 프레임 수가 늘었다 ──────────────────────────────────────────────────────
 * 여덟 장이었고 그건 한 바퀴에 45도, 눈에 띄게 툭툭 끊긴다 — 예전 주석은 그것이
 * **의도**라고 적었다. 부드럽게 도는 쿼드가 "다른 게임에서 온 것처럼 보인다"는
 * 이유였는데, 지금은 그 다른 게임 쪽이 목표다.
 *
 * 쿼드를 회전시키지 않고 시트를 유지하는 이유는 `CardFx` 다: UV 창을 옮기는
 * 애니메이션이 이미 있고, 그걸 쿼드 회전으로 바꾸는 것은 이펙트 코드의 변경이지
 * 그림의 변경이 아니다. 장수를 늘리는 편이 같은 결과를 더 적은 위험으로 낸다.
 *
 * @param {number} frames  한 바퀴를 나눌 장수
 * @param {number} size    장당 텍셀
 */
export function stunSheet(frames = 16, size = 96) {
  const f = Math.max(1, Math.round(frames));
  const s = Math.max(8, Math.round(size));
  const key = `stun:${f}:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(f * s, s);
  ctx.clearRect(0, 0, f * s, s);
  // 한 바퀴가 아니라 45도만 돌면 된다. 별에 여덟 겹 대칭이 있으므로 그 이상은
  // 같은 그림의 반복이고, 시트만 여덟 배로 길어진다.
  for (let i = 0; i < f; i++) drawStar(ctx, i * s, 0, s, (i / f) * (Math.PI / 4));
  return finish(key, cv);
}

/**
 * 가산 링: 밝은 테, 빈 가운데.
 *
 * 교체의 펼침-수축과 승리 화면의 충격에 쓰인다. 가운데가 빈 이유는 그대로다 —
 * 뚜껑에서 채워진 원반이 커지면 뚜껑이 커지는 것으로 읽히고, 링은 무언가가
 * 떠나는 것으로 읽힌다.
 *
 * 하드 밴드 넷에서 부드러운 테 하나로. 밴드는 5비트 양자화기가 어차피 만들 밴딩을
 * 미리 그려 두려던 것이었고, 양자화기가 없으니 밴딩도 없다.
 */
export function ringTexture(size = 256) {
  const s = Math.max(8, Math.round(size));
  const key = `ring:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const [hot, mid, cool] = PALETTE.fx.ring;
  radial(ctx, s, [
    [0, cool, 0],
    [0.34, cool, 0],
    [0.52, mid, 0.35],
    [0.68, hot, 0.85],
    [0.78, mid, 0.42],
    [0.94, cool, 0],
    [1, cool, 0],
  ]);
  return finish(key, cv);
}

/**
 * 강타의 오라. 무장한 뚜껑 **아래** 깔린다.
 *
 * 분리된 링 세 겹인 이유는 그대로다: 이것은 사건이 아니라 카드가 유지되는 내내
 * 있는 것이고, 뚜껑 밑에 꽉 찬 후광이 한 턴 내내 있으면 두 초 뒤부터 읽히지
 * 않는다. 사이가 벌어져 있어야 눈이 형태를 계속 찾을 수 있고, 그 틈이 팔레트
 * 순환이 보이는 자리다.
 */
export function auraTexture(size = 192) {
  const s = Math.max(8, Math.round(size));
  const key = `aura:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const [outer, mid, inner] = PALETTE.fx.aura;
  radial(ctx, s, [
    [0, inner, 0],
    [0.36, inner, 0],
    [0.44, inner, 0.5],
    [0.52, inner, 0],
    [0.62, mid, 0],
    [0.68, mid, 0.62],
    [0.76, mid, 0],
    [0.86, outer, 0],
    [0.92, outer, 0.44],
    [1, outer, 0],
  ]);
  return finish(key, cv);
}

/**
 * ── 색을 입히는 스프라이트는 회색이어야 한다 ────────────────────────────────
 * `trailTexture` 는 `flashTexture` 를 회색으로 다시 칠한 것이다. 승리 화면이
 * 이긴 쪽의 **팀 색**으로 잔상을 물들이는데, 틴트는 곱셈이므로 원본이 중립이 아니면
 * 원본의 색조가 이긴다. 실측이다: `flashTexture` 의 금색에 대고 파란 뚜껑이 금색
 * 불꽃 셋을 달고 들어왔고, 그건 그 뚜껑이 어디서 왔는지가 아니라 근처에서 다른
 * 효과가 일어난 것으로 읽혔다.
 */

/**
 * `flashTexture` 의 모양을 회색으로. 색 입힌 잔상용.
 *
 * 링이 아니라 채워진 원반이다 — 이것은 뚜껑이 **있던 자리**를 표시하고, 그 크기에서
 * 빈 모양은 지나간 뚜껑의 유령이 아니라 더 작은 두 번째 뚜껑으로 읽힌다.
 */
export function trailTexture(size = 128) {
  const s = Math.max(8, Math.round(size));
  const key = `trail:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const [hot, mid, cool] = PALETTE.fx.trail;
  radial(ctx, s, [
    [0, hot, 0.92],
    [0.34, mid, 0.7],
    [0.66, cool, 0.32],
    [0.94, cool, 0],
    [1, cool, 0],
  ]);
  return finish(key, cv);
}

/** 원모어가 뚜껑 위에서 터질 때의 빛. */
export function flashTexture(size = 128) {
  const s = Math.max(8, Math.round(size));
  const key = `flash:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const [hot, mid, cool] = PALETTE.fx.flash;
  radial(ctx, s, [
    [0, hot, 0.95],
    [0.28, mid, 0.72],
    [0.6, cool, 0.3],
    [0.92, cool, 0],
    [1, cool, 0],
  ]);
  return finish(key, cv);
}

/**
 * One opaque white texel.
 *
 * For the full-frame flash, which has no shape — the strength is a uniform and
 * the quad is the whole frame. It exists so the material can keep ONE fragment
 * shader for both the bolt and the flash: a second shader with the texture read
 * taken out would be the same arithmetic written twice, and the two would
 * eventually disagree about what `uOpacity` means.
 */
export function flatTexture() {
  const key = 'flat';
  if (cache.has(key)) return cache.get(key);
  const { canvas: cv, ctx } = canvas(1, 1);
  ctx.fillStyle = PALETTE.fx.white;
  ctx.fillRect(0, 0, 1, 1);
  return finish(key, cv, { mips: false });
}

/**
 * 자물쇠. 침묵의 어휘 전부.
 *
 * 이 파일에서 유일하게 알파 블렌드다 — 나머지는 전부 그림에 **더해지는** 빛이고,
 * 봉인은 그 반대의 진술이다. 어두운 피치 위의 가산 자물쇠는 빛나는 자물쇠이고,
 * 그건 파워업으로 읽힌다.
 *
 * ── 텍셀을 걸어 그리던 것에서 `ui/icons.js` 의 벡터로 ───────────────────────
 * 몸통 사각형, 픽셀로 걸은 아치, 두 픽셀짜리 열쇠 구멍이었다. 그 그림이 이제
 * `icons.js` 에 벡터로 있고 카드의 침묵 아이콘과 **같은 것**이다 — 손에 든 카드와
 * 판 위의 도장이 같은 그림이어야 한다는 것은 원래 주석의 요구이기도 했다.
 *
 * 윤곽선은 남는다. 그것이 없으면 밝은 피치 끝에서 창백한 자물쇠가 사라진다.
 */
export function lockTexture(size = 96) {
  const s = Math.max(8, Math.round(size));
  const key = `lock:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);

  const { outline: OUTLINE, body: BODY } = PALETTE.fx.lock;
  const pad = s * 0.12;
  const inner = s - pad * 2;

  // 윤곽. 같은 그림을 그림자로 세 번 깔고 그 위에 본체를 얹는다. 밝은 판 위에서도
  // 어두운 판 위에서도 형태가 남는 유일한 방법이다.
  ctx.save();
  ctx.shadowColor = OUTLINE;
  ctx.shadowBlur = s * 0.07;
  for (let i = 0; i < 3; i++) {
    drawIcon(ctx, 'silence', { x: pad, y: pad, size: inner, color: OUTLINE, gloss: false });
  }
  ctx.restore();
  drawIcon(ctx, 'silence', { x: pad, y: pad, size: inner, color: BODY, gloss: false });

  return finish(key, cv);
}

/**
 * 대시 패턴. 한 텍셀 높이, 타일링.
 *
 * U 를 따라 스크롤해 궤적선이 흐르는 것처럼 보이게 한다.
 *
 * ── 이 파일에서 유일하게 하드 스텝이 남은 곳 ────────────────────────────────
 * 대시는 **패턴**이지 빛이 아니다. 부드럽게 만들면 점선이 아니라 밝기가 오르내리는
 * 선이 되고, 그건 흐르는 것이 아니라 깜빡이는 것으로 보인다. 양 끝만 부드럽게
 * 해서 각 대시가 잘린 토막이 아니라 하나의 획으로 읽히게 한다.
 */
export function dashTexture(length = 64) {
  const n = Math.max(8, Math.round(length));
  const key = `dash:${n}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(n, 1);
  ctx.clearRect(0, 0, n, 1);
  const [hot, mid, cool] = PALETTE.fx.dash;
  const period = n / 4;
  for (let i = 0; i < 4; i++) {
    const x0 = i * period;
    const g = ctx.createLinearGradient(x0, 0, x0 + period * 0.62, 0);
    g.addColorStop(0, withAlpha(cool, 0));
    g.addColorStop(0.3, withAlpha(mid, 0.85));
    g.addColorStop(0.6, withAlpha(hot, 1));
    g.addColorStop(1, withAlpha(cool, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, period * 0.62, 1);
  }
  return finish(key, cv, { repeat: true, mips: false });
}

/**
 * 스캔 스윕: 가로 띠 하나, 한 텍셀 폭.
 *
 * 프레임을 가로질러 늘여 한 번 내려 보낸다. V 로만 그리는 이유는 X 로 변하지 않기
 * 때문이다 — 전체 프레임 이미지는 변하지 않는 모양에 300 kB 를 쓰는 일이다.
 *
 * 선두는 여전히 밝고 꼬리는 길다. 스윕에는 방향이 있어야 한다.
 */
export function scanTexture(height = 128) {
  const h = Math.max(8, Math.round(height));
  const key = `scan:${h}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(1, h);
  ctx.clearRect(0, 0, 1, h);
  const S = PALETTE.fx.scan;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, withAlpha(S[0], 0));
  g.addColorStop(0.06, withAlpha(S[0], 0.9));
  g.addColorStop(0.16, withAlpha(S[1], 0.62));
  g.addColorStop(0.42, withAlpha(S[2], 0.3));
  g.addColorStop(0.72, withAlpha(S[3], 0.1));
  g.addColorStop(1, withAlpha(S[3], 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1, h);
  return finish(key, cv, { mips: false });
}

/**
 * 화면 가장자리에서 들어오는 빛. 가운데는 비어 있다.
 *
 * 원모어의 테두리 섬광. 네 개의 쿼드가 아니라 한 장의 텍스처인 이유는 모서리가
 * 같은 그림의 일부여야 벌어지지 않기 때문이다.
 *
 * ── 얇아야 하고 안쪽으로 사라져야 한다 ──────────────────────────────────────
 * 첫 판은 프레임의 7분의 1 깊이에 납작한 금색이었고, 그건 가장자리의 빛이 아니라
 * 그림이 금색이 되는 것이었다 — 피치가 상자에 들어가고 HUD 가 그 너머로 읽히지
 * 않았다. 20분의 1, 바깥에서 가장 밝고 안으로 사라지는 띠라야 화면 밖에서 빛이
 * 들어오는 것으로 읽힌다.
 *
 * 세 톤의 하드 스텝이 부드러운 감쇠가 됐다. 스텝이 있던 이유는 양자화기가 어차피
 * 밴딩을 만들 것이라는 계산이었고, 그 계산이 사라졌다.
 */
export function frameTexture(size = 256) {
  const s = Math.max(16, Math.round(size));
  const key = `frame:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const tones = PALETTE.fx.frame;
  const depth = Math.max(3, Math.round(s * 0.055));

  // 네 변. 각각 바깥에서 안으로 사라지는 선형 그라디언트다. 겹치는 모서리는
  // 두 번 더해져 저절로 밝아지는데, 빛이 모서리에서 모이는 것은 맞는 그림이다.
  const edge = (x, y, w, h, x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, withAlpha(tones[0], 0.85));
    g.addColorStop(0.35, withAlpha(tones[1], 0.4));
    g.addColorStop(1, withAlpha(tones[tones.length - 1], 0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  edge(0, 0, s, depth, 0, 0, 0, depth);
  edge(0, s - depth, s, depth, 0, s, 0, s - depth);
  edge(0, 0, depth, s, 0, 0, depth, 0);
  edge(s - depth, 0, depth, s, s, 0, s - depth, 0);

  return finish(key, cv);
}

/** Drop every cached texture. For a resolution or frame-count change. */
export const clearFxTextureCache = registerTextureCache(() => {
  for (const t of cache.values()) t.dispose();
  cache.clear();});

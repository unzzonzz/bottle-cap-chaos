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
 * 그라디언트가 **기본**이다. §13 이 충돌의 은유를 "물에 떨어지는 작은 물체" 로
 * 놓았고, 물이 만드는 빛에는 가장자리가 없다 — 물결도, 튀김도, 수면의 반짝임도
 * 전부 부드럽게 사라진다. 하드 스텝은 이제 그 반대의 신호이므로, 하나 남은
 * 곳(대시 패턴)에만 이유를 적어 두었다.
 *
 * 어휘 자체 — 무엇의 그림이냐 — 는 PHASE 8 이 바꿨고, 그 표는 `CardFx` 머리말에
 * 있다. 여기 적힌 것은 가장자리를 어떻게 다루는가이고, 두 답이 같은 쪽을 가리켰다:
 * 물의 어휘에는 부드러운 가장자리가 필요하고 그라디언트가 이미 기본이었다.
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
 * 혼란의 물방울 한 장. `(ox, oy)` 에서 `size` 안에, 머리가 `angle` 쪽을 본다.
 *
 * ── 별이었다 ────────────────────────────────────────────────────────────────
 * 긴 팔 넷과 짧은 팔 넷이 난 사각별이었고, 예전 주석은 뾰족한 것이 "아프다"를
 * 말한다고 적었다. §13 이 그 어휘를 통째로 바꾼다 — 충돌은 무기가 닿는 것이
 * 아니라 **작은 것이 물에 떨어지는 것**이고, 그 목록에 별은 없다.
 *
 * ── 방향이 있는 것이 요점이다 ───────────────────────────────────────────────
 * 별은 네 겹 대칭이라 어느 쪽을 봐도 같았고, 그래서 시트가 90도만 담으면 됐다.
 * 물방울은 대칭이 없다: 머리와 꼬리가 있고, 궤도를 도는 물방울은 꼬리를 안쪽으로
 * 끌고 돈다. 그래서 시트가 한 바퀴를 담고(`stunSheet` 참조), 그 한 바퀴가
 * `CardFx` 의 궤도 각과 **같은 수**에서 나온다 — 물방울은 자기가 도는 방향을
 * 본다. 따로 계산하지 않는다.
 *
 * 가운데가 비지 않고 머리가 가장 밝은 것은 물방울이 렌즈이기 때문이다. 뒤에
 * 깔리는 옅은 광채는 젖은 것 주위의 번짐이고, 이것이 별의 "가운데 광원" 이
 * 남긴 유일한 부분이다.
 */
function drawDrop(ctx, ox, oy, size, angle) {
  const c = size / 2;
  const tones = PALETTE.fx.drop;

  ctx.save();
  ctx.translate(ox + c, oy + c);
  ctx.rotate(angle);

  /**
   * 물방울이 상자를 다 쓰지 않는다.
   *
   * 별은 팔이 상자 끝(0.94c)까지 갔지만 팔 사이가 비어 있어서 가벼웠다. 물방울은
   * 속이 찬 모양이라 같은 크기면 훨씬 무겁고, `stunSize` 는 뚜껑 지름의 1.5배다 —
   * 실측으로 뚜껑 옆에 흰 덩어리가 앉았다. 상자의 3분의 2만 쓰고 나머지를 번짐에
   * 넘긴다. `stunSize` 자체는 `game/config.js` 에 있어 손댈 수 없고, 손댈 이유도
   * 없다: 문제는 차지하는 자리가 아니라 그 자리를 얼마나 채우느냐였다.
   */
  const r = c * 0.25;
  const hx = c * 0.2;
  const tip = -c * 0.72;

  // 젖은 것 주위의 번짐. 물방울 자체보다 넓고 훨씬 옅다.
  ctx.save();
  ctx.translate(-c, -c);
  radial(ctx, size, [
    [0, tones[1], 0.34],
    [0.3, tones[1], 0.16],
    [0.62, tones[2], 0.05],
    [1, tones[2], 0],
  ]);
  ctx.restore();

  // 물방울. 머리는 원이고 꼬리는 거기서 뽑혀 나온다.
  ctx.beginPath();
  ctx.arc(hx, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.quadraticCurveTo(hx - r * 0.45, r * 0.95, tip, 0);
  ctx.quadraticCurveTo(hx - r * 0.45, -r * 0.95, hx, -r);
  ctx.closePath();
  const body = ctx.createLinearGradient(tip, 0, hx + r, 0);
  body.addColorStop(0, withAlpha(tones[2], 0));
  body.addColorStop(0.34, withAlpha(tones[2], 0.4));
  body.addColorStop(0.72, withAlpha(tones[1], 0.72));
  body.addColorStop(1, withAlpha(tones[1], 0.84));
  ctx.fillStyle = body;
  ctx.fill();

  // 머리 안의 하이라이트 하나. 물방울이 렌즈라는 말이고, 이것이 있어야 흰 얼룩과
  // 갈라진다 — 얼룩에는 안쪽이 없다.
  ctx.beginPath();
  ctx.ellipse(hx + r * 0.18, -r * 0.3, r * 0.3, r * 0.2, -0.5, 0, Math.PI * 2);
  ctx.fillStyle = withAlpha(tones[0], 0.9);
  ctx.fill();

  ctx.restore();
}

/**
 * The stun drop, `frames` of it in a row.
 *
 * 쿼드를 회전시키지 않고 시트를 쓰는 이유는 `CardFx` 다: UV 창을 옮기는
 * 애니메이션이 이미 있고, 그걸 쿼드 회전으로 바꾸는 것은 이펙트 코드의 변경이지
 * 그림의 변경이 아니다.
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
  /**
   * **한 바퀴 전체.** 90도였다.
   *
   * 별은 네 겹 대칭이라 90도면 긴 팔이 긴 팔 자리에 왔고, 그래서 시트가 사분원만
   * 담아도 됐다. 물방울에는 대칭이 없으므로 사분원을 담으면 네 바퀴마다 머리가
   * 순간이동한다.
   *
   * 한 바퀴를 담으면 프레임 번호가 곧 각도가 되고, `CardFx._updateStun` 의 궤도
   * 각이 바로 그 프레임 번호에서 나온다 — 그래서 물방울은 자기가 도는 쪽을
   * 본다. 장수를 바꿔도 둘은 같이 움직인다: 둘 다 `frames` 로 나눈 같은 `step`
   * 이기 때문이다.
   */
  for (let i = 0; i < f; i++) drawDrop(ctx, i * s, 0, s, (i / f) * Math.PI * 2);
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
 * 강타의 물결. 무장한 뚜껑 **아래** 깔린다.
 *
 * ── 오라였고, 그림은 그대로다 ───────────────────────────────────────────────
 * 분리된 링 세 겹인 이유는 그대로다: 이것은 사건이 아니라 카드가 유지되는 내내
 * 있는 것이고, 뚜껑 밑에 꽉 찬 후광이 한 턴 내내 있으면 두 초 뒤부터 읽히지
 * 않는다. 사이가 벌어져 있어야 눈이 형태를 계속 찾을 수 있고, 그 틈이 팔레트
 * 순환이 보이는 자리다.
 *
 * 바뀐 것은 색뿐이다 — `PALETTE.fx.aura` 의 주석을 보라. 링 세 겹은 처음부터
 * 물결의 모양이었고 잉걸불 색을 입고 있었을 뿐이라, §13 이 불을 금지했을 때
 * 여기서 지울 것이 없었다. 그것이 이 그림이 옳았다는 증거이기도 하다.
 */
export function auraTexture(size = 192) {
  const s = Math.max(8, Math.round(size));
  const key = `aura:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  /**
   * 알파가 낮다. 이것은 **한 턴 내내** 뚜껑 밑에 깔려 있는 것이다.
   *
   * 처음에는 0.5 / 0.62 / 0.44 로 잡았는데 — 예전 하드 밴드와 비슷한 세기 —
   * 부드러운 감쇠는 같은 알파에서 훨씬 넓은 면적을 덮으므로 실측하니 뚜껑 셋이
   * 흰 후광에 거의 지워졌다. §0.4 는 효과가 도는 동안에도 무엇이 어디 있는지
   * 읽혀야 한다고 요구한다.
   *
   * 램프가 흰색 가까이로 옮겨 온 뒤에도 이 값들은 그대로다. 알파는 색이 아니라
   * **덮는 면적**에 대한 답이고, 면적은 바뀌지 않았다.
   *
   * 링 사이의 **틈**이 여전히 요점이다. 틈이 있어야 눈이 형태를 계속 찾고, 그
   * 틈에서 팔레트 순환이 보인다.
   */
  const [outer, mid, inner] = PALETTE.fx.aura;
  radial(ctx, s, [
    [0, inner, 0],
    [0.38, inner, 0],
    [0.44, inner, 0.2],
    [0.5, inner, 0],
    [0.63, mid, 0],
    [0.68, mid, 0.26],
    [0.74, mid, 0],
    [0.87, outer, 0],
    [0.92, outer, 0.2],
    [1, outer, 0],
  ]);
  return finish(key, cv);
}

/**
 * ── 색을 입히는 스프라이트는 중립이어야 한다 ────────────────────────────────
 * `uTint` 는 곱셈이므로, 텍스처가 이미 색을 갖고 있으면 틴트가 그 색을 **누르지
 * 못한다** — 두 색이 곱해진 제삼의 색이 나온다. 실측으로 배웠다: 금색으로 구운
 * 스프라이트에 파란 팀 색을 걸었더니 파란 뚜껑이 금색 불꽃을 달고 들어왔고, 그건
 * 그 뚜껑이 누구 것인지가 아니라 근처에서 다른 효과가 일어난 것으로 읽혔다.
 *
 * 그래서 팀 색이나 팔레트 순환을 받는 스프라이트(`ringTexture`, `auraTexture`,
 * 시트의 물방울)는 흰색 가까이에서 굽는다. 자기 색을 갖는 것은 그 색이 곧 카드의
 * 뜻인 것들뿐이다 — `scanTexture` 의 초록, `frameTexture` 의 호박색.
 */

/**
 * 철벽의 링. 이 파일에서 유일하게 **각지고 가장자리가 단단한** 스프라이트다.
 *
 * ── 규칙을 어기는 것이 아니라 규칙이 반대를 가리킨다 ────────────────────────
 * 이 파일의 머리말은 그라디언트를 기본으로 삼고 하드 스텝을 "반대의 신호"라고
 * 부른다. 여기가 바로 그 반대다. 다른 모든 표시는 뚜껑에 **일어나는 일**이라
 * 빛처럼 번지는 것이 맞다 — 오라는 장전된 힘이고, 별은 어지러움이고, 링은 떠나는
 * 것이다. 철벽은 일어나는 일이 아니라 뚜껑이 **된 것**이고, 단단해진 것의
 * 가장자리가 흐리면 그건 단단하지 않다.
 *
 * 그래서 팔각형이고, 획 하나이고, 안팎으로 감쇠가 없다. 각짐이 곧 굳음이다.
 *
 * ── 그런데 완전한 하드 엣지는 아니다 ────────────────────────────────────────
 * 획 자체는 균일하지만 바깥으로 한 겹 아주 옅은 후광이 있다. 순수한 1픽셀 계단은
 * 밉맵과 원근 축소를 지나면서 사라졌다 나타났다 하고 — 판 위에 눕는 표시라
 * 카메라가 기울면 반드시 축소된다 — 깜빡이는 링은 맥동하는 링이다. §6.2 가
 * 금지하는 바로 그것이므로, 얇은 후광이 그것을 막는다.
 *
 * ── 세 개나 네 개가 동시에 뜬다 ─────────────────────────────────────────────
 * 알파가 이 파일에서 가장 낮은 축인 이유다. 강타의 오라는 한 뚜껑에 하나 뜨지만
 * 이것은 서바이벌 셋, 축구 넷에 한꺼번에 뜨고, 그동안 플레이어는 그 사이로 판을
 * 읽어야 한다.
 *
 * @param {number} sides  팔각 또는 육각. `cardFx.resistRingSides`.
 * @param {number} size   텍셀
 */
export function braceTexture(sides = 8, size = 192) {
  const n = Math.max(3, Math.round(sides));
  const s = Math.max(16, Math.round(size));
  const key = `brace:${n}:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const c = s / 2;
  // 꼭짓점이 텍스처 가장자리에 닿지 않게. 획 두께와 후광이 밖으로 나가야 한다.
  const r = c * 0.78;
  const path = (radius) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      // 한 변이 위를 향하도록 반 칸 돌린다. 꼭짓점이 위로 오면 별처럼 보이고,
      // 별은 혼란의 것이다.
      const a = ((i + 0.5) / n) * Math.PI * 2;
      const px = c + Math.cos(a) * radius;
      const py = c + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  };

  ctx.lineJoin = 'miter';
  // 마이터 그대로. 둥근 모서리는 각진 링을 다시 원으로 되돌린다.
  ctx.miterLimit = 8;

  // 바깥 후광 먼저, 그 위에 획. 축소될 때 획이 사라져도 형태가 남는다.
  ctx.strokeStyle = withAlpha(PALETTE.fx.white, 0.16);
  ctx.lineWidth = s * 0.075;
  path(r);
  ctx.stroke();

  ctx.strokeStyle = withAlpha(PALETTE.fx.white, 0.95);
  ctx.lineWidth = s * 0.032;
  path(r);
  ctx.stroke();

  // 꼭짓점마다 짧은 안쪽 턱. 팔각형만으로는 "링"이고, 턱이 있으면 "받치는 것"이다.
  ctx.lineCap = 'butt';
  ctx.lineWidth = s * 0.028;
  ctx.strokeStyle = withAlpha(PALETTE.fx.white, 0.55);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r * 0.995, c + Math.sin(a) * r * 0.995);
    ctx.lineTo(c + Math.cos(a) * r * 0.80, c + Math.sin(a) * r * 0.80);
    ctx.stroke();
  }

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
    drawIcon(ctx, 'silence', { x: pad, y: pad, size: inner, color: OUTLINE });
  }
  ctx.restore();
  drawIcon(ctx, 'silence', { x: pad, y: pad, size: inner, color: BODY });

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
 * 선두가 밝고 꼬리가 그 뒤로 짧게 붙는다. 스윕에는 방향이 있어야 하고, 그 방향은
 * 길이가 아니라 **비대칭**에서 온다 — 아래를 보라.
 */
export function scanTexture(height = 128) {
  const h = Math.max(8, Math.round(height));
  const key = `scan:${h}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(1, h);
  ctx.clearRect(0, 0, 1, h);
  const S = PALETTE.fx.scan;
  /**
   * ── 띠가 얇아졌다. 쿼드가 아니라 그림이 얇아진 것이다 ─────────────────────
   * 감쇠가 쿼드 바닥까지 갔고 — 0.72 지점에도 알파가 남아 있었다 — 그래서 화면에
   * 있는 것은 띠가 아니라 40픽셀짜리 초록 물결 앞머리였다. §9 는 **얇은** 빛의
   * 띠를 요구한다.
   *
   * 쿼드 높이는 `cardFx.scanHeight` 이고 그 파일은 손댈 수 없으므로, 두께를
   * 그림에서 뺀다: 램프를 위쪽 3분의 1 안에 다 쓰고 나머지를 비운다. 실효 두께가
   * 40에서 약 13픽셀로 줄고, 마루가 한 텍셀 안에 서 있으므로 지나간 자리가
   * 선으로 읽힌다 — 쓸고 지나가는 것에는 앞이 있어야 한다.
   */
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, withAlpha(S[0], 0));
  g.addColorStop(0.02, withAlpha(S[0], 0.95));
  g.addColorStop(0.06, withAlpha(S[1], 0.7));
  g.addColorStop(0.14, withAlpha(S[2], 0.34));
  g.addColorStop(0.26, withAlpha(S[3], 0.09));
  g.addColorStop(0.34, withAlpha(S[3], 0));
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

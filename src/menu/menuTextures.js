import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from 'three';
import { PALETTE, withAlpha } from '../core/palette.js';
import { RADIUS, ROLE, SIZE, SPACE, TYPE } from '../core/tokens.js';
import { drawIcon, iconForCard } from '../ui/icons.js';
import { drawLettering } from '../ui/lettering.js';
import { DISPLAY_FAMILY, FONT_FAMILY } from '../ui/fonts.js';
import { applyTracking, fitText, fontSpec, roleSkin, roundRectPath } from '../ui/paper.js';
import { ring } from '../ui/marks.js';
import { accentOf } from '../render/cardTexture.js';
import { texelScale } from '../core/frame.js';

/**
 * Every pixel the menu needs, drawn at runtime. No image files, same as
 * everywhere else in this project.
 *
 * The 128-texel page limit from `core/textures.js` holds here too. That helper
 * is square-only and two of these are not, so they build their canvases
 * directly — exactly as `render/cardTexture.js` does — but nothing below is
 * wider or taller than a page.
 *
 * ── text has to be aliased ──────────────────────────────────────────────────
 * `imageSmoothingEnabled = false` governs image SCALING; the font rasteriser
 * antialiases glyph edges regardless, and those intermediate values come out of
 * the 5-bit quantiser as coloured fringing. So type is drawn to a scratch
 * canvas and its alpha is pushed to fully on or fully off before compositing.
 * Lifted from `cardTexture.js`, which explains it at length.
 */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

/**
 * UI 텍스처의 필터 정책.
 *
 * `LinearFilter` 이고 밉맵은 없다. UI 판은 화면과 거의 1:1 로 대응하는
 * 쿼드에 붙으므로 축소되는 일이 없고, 밉맵은 만들 이유가 없는 메모리다.
 * 확대는 일어난다 — 그래서 mag 가 nearest 면 안 된다.
 */
function toTexture(canvas, { wrapS = ClampToEdgeWrapping, wrapT = ClampToEdgeWrapping, mips = false } = {}) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = mips ? LinearMipmapLinearFilter : LinearFilter;
  tex.generateMipmaps = mips;
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 밉맵과 이방성이 있는 텍스처. 이 파일에서 그게 필요한 하나를 위해.
 *
 * 나머지는 화면과 거의 1:1 인 UI 판이라 `toTexture` 로 충분하다. 라벨은 다르다 —
 * 512x768 데칼이 곡면에 감겨 있고 가장자리를 스치듯 보게 되는데, 그건 축소
 * 필터링이 가장 크게 듣는 경우다. 알파도 블렌딩이 아니라 컷이라, 거칠게 샘플된
 * 알파는 어떤 `alphaTest` 임계값으로도 구제되지 않는 너덜너덜한 타원이 된다.
 */
function toSmoothTexture(canvas) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
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
function drawText(target, { text, x, y, font, color, align = 'left', slant = 0 }) {
  target.save();
  target.font = font;
  target.textAlign = align;
  target.textBaseline = 'alphabetic';
  target.fillStyle = color;
  if (slant) {
    // 이탤릭 페이스가 아니라 전단. 쓸 수 있는 폰트는 기기에 있는 것뿐이라
    // italic 을 요구하면 OS 마다 다른 글꼴이 나온다. 변환은 어디서나 같은 기울기다.
    target.translate(x, y);
    target.transform(1, 0, -slant, 1, 0, 0);
    target.fillText(text, 0, 0);
  } else {
    target.fillText(text, x, y);
  }
  target.restore();
}

/**
 * The cap's top: the game's logo, on a disc.
 *
 * ── it replaces the placeholder, and only where it should ───────────────────
 * `cap/capTexture.js` draws a generic panel — concentric rings, eight spokes and
 * an orientation mark — and that is still exactly right for the PLAYING pieces,
 * which are a customisable slot for a player's own artwork, and for the phase-1
 * viewer, whose spoke is a debugging aid for watching the UVs spin. Neither
 * wants the game's name stamped on it. This one is for the menu's bottle and for
 * the built-in mark, which do.
 *
 * ── the layout was sized for a frame that no longer exists ─────────────────
 * The cap wipe used to blow this up until the panel's radius was the frame's
 * half-DIAGONAL, so the part you saw was the largest 4:3 rectangle inside the
 * disc — about 102 by 77 of these 128 texels. Everything that has to be read
 * lives inside that box because of it, and the rim rings outside it were for the
 * other end of the scale, where this is a twelve-pixel dot on a bottle.
 *
 * There is no such frame any more: the wipe is gone and so is the wordmark that
 * briefly replaced it on the letterbox. The constraint is kept anyway, and not
 * out of inertia — it is what stops the lockup being a ring of type around an
 * empty middle, which is what a design laid out to the disc's own edge becomes
 * at the size this is actually drawn.
 *
 * ── it is the label's design, made round ────────────────────────────────────
 * Same red, same sheared white grotesque, same stacked lockup, same rule above
 * and below. The rules are concentric ARCS rather than the label's parabolas,
 * because on a disc that is what "follows the curvature" means. Nothing here is
 * anyone's trademark: a red cap with white type on it is the whole of it.
 */
/** @param {number} [texels] */
export function capLogoTexture(texels = 512) {
  /**
   * 좌표는 128 기준으로 저술되고, 캔버스에 배율을 건다.
   *
   * ── 왜 512 로 굽나 ──────────────────────────────────────────────────────
   * 이 그림은 축소와 확대를 둘 다 겪는다 — 병 위에서는 열두 픽셀짜리 점이고,
   * 내 마크 격자에서는 기본 마크 타일로 그 몇 배가 된다. 128 텍셀로 구우면
   * 확대 쪽에서 계단진 글자가 그대로 보였다.
   *
   * 800 픽셀까지 커지던 시절(캡 와이프의 덮인 프레임)에 정한 값이라 지금 쓰임에는
   * 넉넉하다. 줄일 여지가 있지만, 줄이면 격자 타일에서 다시 재 봐야 한다.
   *
   * 저술 좌표를 512 로 옮기지 않고 배율을 거는 이유는 위의 설계 근거 때문이다 —
   * "읽혀야 하는 것은 128 텍셀 중 102x77 안에 있다" 는 계산이 이 함수의 모든
   * 숫자에 걸려 있고, 그 관계는 텍셀 수와 무관하게 유지되어야 한다.
   */
  const size = 128;
  const scale = Math.max(1, Math.round(texels / size));
  const c = size / 2;
  const { canvas, ctx } = makeCanvas(size * scale, size * scale);
  ctx.scale(scale, scale);

  /**
   * ── the field is COBALT, and that is the document seam ──────────────────
   * This texture is the covered frame. §7.3 puts the handover paint on cobalt —
   * `--msa-void`, the `styles.css` fallback and `PALETTE.menu.capBrand` are all
   * the same value — and the covered frame has to BE that value or the join
   * between the two documents is a flash from one blue to another.
   *
   * It was the other way round for one revision, paper with cobalt letters, and
   * the measured result was a pale grey-blue frame against a cobalt surround.
   * Inverting it also makes the better poster: white letters on a saturated
   * field is what a bottle cap actually looks like.
   *
   * The corners are never sampled — the panel is the inscribed circle — but
   * filling them costs nothing and means a rounding error at the rim cannot
   * pick up a transparent texel.
   */
  ctx.fillStyle = PALETTE.menu.labelInk;
  ctx.fillRect(0, 0, size, size);

  /**
   * 테두리 원. 실제 호를 그린다.
   *
   * ── 사각형을 360번 찍던 것에서 ────────────────────────────────────────────
   * 예전에는 원 위를 360 스텝으로 걸으며 정수 좌표에 사각형을 찍었고, 바로 아래
   * `arc` 헬퍼의 주석이 이유를 적어 두었다: "`ctx.arc` 를 스트로크하면 끝이
   * 안티에일리어스된다". 그 파이프라인에서는 안티에일리어스가 먼지가 됐다.
   *
   * 지금은 반대다. 512 텍셀로 구우면 정수 좌표에 찍은 사각형이 4x4 블록이 되고,
   * 블록 사이에 틈이 벌어져 원이 점선이 된다. 진짜 호는 어느 배율에서나 원이다.
   */
  const ring = (radius, thickness, color) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(c, c, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  /** 호 한 토막. 각도는 도. 위와 같은 이유로 진짜 호다. */
  const arc = (radius, thickness, fromDeg, toDeg, color) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, radius, (fromDeg * Math.PI) / 180, (toDeg * Math.PI) / 180);
    ctx.stroke();
    ctx.restore();
  };

  // Rim. Outside the box the lockup is confined to — see the header — so it is
  // the half of the design that only reads where the disc is drawn whole, which
  // today is the mark grid's tile.
  ring(60, 3, PALETTE.menu.labelInkDeep);
  ring(52, 1.5, PALETTE.menu.labelPaper);

  // The two rules, inside the crop so they frame the wordmark at full cover.
  arc(37, 1.5, 202, 338, PALETTE.menu.labelRule);
  arc(37, 1.5, 22, 158, PALETTE.menu.labelRule);

  /**
   * ── it said BOTTLE / CAP / CHAOS, in a weight that no longer exists ──────
   * Two fossils in one lockup. The words were the game's OLD name — the rename
   * to 한여름 알까기 reached the title bar, the routes and the package and never
   * reached the label on the bottle, because nothing that reads the label reads
   * the name. And all three lines asked for `weight: 700`, which the single-face
   * bundle cannot supply: the browser would have synthesised it, and canvas 2D
   * bakes a synthesised bold into a texture where it cannot be undone.
   *
   * Both are fixed by the same change. The wordmark is VECTOR LETTERING now
   * (`ui/lettering.js`), so it carries the right name, it cannot ask for a
   * weight, and it does not depend on the webfont having loaded — which matters
   * more here than anywhere: this texture is baked once and cached, and it is
   * the one piece of type that is part of an OBJECT rather than of the
   * interface.
   *
   * The slant went with it. It was a 0.22 shear standing in for an italic the
   * bundle did not have; stroked letterforms do not need one, and a sheared
   * stroke system reads as a mistake rather than as a style.
   */
  drawLettering(ctx, '한여름', {
    x: c,
    y: 48,
    size: 15,
    color: PALETTE.menu.labelPaper,
    tracking: 1.2,
    align: 'center',
  });
  drawLettering(ctx, '알까기', {
    x: c,
    y: 68,
    size: 21,
    color: PALETTE.menu.labelPaper,
    tracking: 1.6,
    align: 'center',
  });

  /**
   * 밉맵을 켠다. 이 그림은 축소와 확대를 **둘 다** 겪는 유일한 텍스처다 — 내 마크
   * 격자에서는 타일만큼 커지고, 병 위에서는 열두 픽셀짜리 점이 된다. 밉이 없으면
   * 후자에서 텍셀 행이 통째로 버려진다(`core/textures.js` 머리말).
   */
  return toTexture(canvas, { mips: true });
}

/**
 * 거품 하나. 가산 블렌드로 액체 위에 올라간다.
 *
 * ── 세 겹 원반에서 유리 구슬로 ──────────────────────────────────────────────
 * 예전 것은 16 텍셀에 채워진 원 셋(테 · 중간 · 코어)과 2x2 정사각형 반짝이였다.
 * 가산 블렌드에서 채워진 원은 **덩어리**로 더해지므로, 화면에서는 구슬이 아니라
 * 밝은 점이었다.
 *
 * 진짜 거품에서 보이는 것은 몸통이 아니라 **가장자리**다. 액체와 기체의 경계에서
 * 빛이 크게 꺾이므로 테두리가 밝고 가운데는 거의 그냥 뒤가 비친다. 가산으로 그리면
 * 그 사실이 그대로 옮겨진다 — 테는 더하고 가운데는 아무것도 더하지 않는다.
 *
 * 여기 얹는 세 가지:
 *   테        얇고 밝다. 이것 하나가 "구"라고 말한다.
 *   정반사    왼쪽 위, 작고 뜨겁다. 장면의 키 라이트와 같은 방향.
 *   되비침    오른쪽 아래, 넓고 어둡다. 액체에서 되올라온 빛이라 테보다 약하다.
 *
 * 셋의 관계가 물방울을 물방울로 만든다. 하나라도 빠지면 원이 되고, 넷이 되면
 * 유리구슬 렌더가 된다 — 여기 크기에서는 후자가 그냥 지저분해진다.
 *
 * 이것은 §7 이 요구하는 "tiny carbonation bubbles" 이고, 유리 안의 물성이라
 * 광택 금지(§19 · §24)의 대상이 아니다 — 그쪽은 **컨트롤**에 대한 규칙이다.
 *
 * 64 텍셀인 것은 화면에서 거품이 커야 20 픽셀쯤 되기 때문이다. 밉맵이 있으므로
 * 작을 때 손해가 없고, 큰 거품이 계단지지 않는다.
 */
export function bubbleTexture() {
  const size = 64;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = PALETTE.additiveZero;
  ctx.fillRect(0, 0, size, size);

  const c = size / 2;
  const r = size * 0.44;
  const B = PALETTE.additive.bubble;

  // 되비침. 가장 먼저, 가장 넓게, 가장 약하게. 오른쪽 아래에서 올라온다.
  const bounce = ctx.createRadialGradient(
    c + r * 0.3, c + r * 0.34, 0,
    c + r * 0.3, c + r * 0.34, r * 0.72,
  );
  bounce.addColorStop(0, withAlpha(B.rim, 0.3));
  bounce.addColorStop(0.5, withAlpha(B.mid, 0.12));
  bounce.addColorStop(1, withAlpha(B.core, 0));
  ctx.fillStyle = bounce;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();

  /**
   * 테. 안쪽 가장자리에서 시작해 바깥으로 빠르게 사라진다.
   *
   * 정지점 사이가 좁은 것이 요점이다 — 넓으면 테가 아니라 후광이 되고, 후광은
   * 거품이 아니라 빛나는 점이다.
   */
  const rim = ctx.createRadialGradient(c, c, r * 0.6, c, c, r);
  rim.addColorStop(0, withAlpha(B.rim, 0));
  rim.addColorStop(0.62, withAlpha(B.mid, 0.22));
  rim.addColorStop(0.86, withAlpha(B.rim, 0.92));
  rim.addColorStop(1, withAlpha(B.rim, 0));
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  // 정반사. 왼쪽 위. 작고 뜨겁다.
  const gx = c - r * 0.34;
  const gy = c - r * 0.38;
  const glint = ctx.createRadialGradient(gx, gy, 0, gx, gy, r * 0.3);
  glint.addColorStop(0, withAlpha(B.glint, 1));
  glint.addColorStop(0.4, withAlpha(B.glint, 0.5));
  glint.addColorStop(1, withAlpha(B.glint, 0));
  ctx.fillStyle = glint;
  ctx.fillRect(0, 0, size, size);

  return toTexture(canvas);
}

/**
 * 메뉴 항목. 판이 아니라 **글자와 밑줄**이다.
 *
 * ── 두 번에 걸쳐 비워졌다 ──────────────────────────────────────────────────
 * 처음 판은 각진 사각형에 2px 테두리, 왼쪽 가장자리에 상태를 알리는 세로 막대가
 * 있었다. 막대의 근거는 "글씨보다 멀리서 읽힌다" 였고 각진 판에서는 맞았지만,
 * 젤 버튼이 되면서 몸통 전체가 상태를 말하게 되어 막대가 중복이 됐다.
 *
 * 이제 몸통도 없다. §11 이 UI 를 필드 주변에 조용히 앉히라고 하고 §24 가 젤
 * 컨트롤을 금지하므로, 남은 것은 `roleButton` 이 그리는 글자 한 줄과 그 아래
 * 밑줄이다. 이 파일은 여전히 텍스처를 굽는다 — 항목이 3D 쿼드이기 때문이고, 그
 * 사실은 판이 있든 없든 바뀌지 않는다.
 *
 * 라벨은 가운데다. 왼쪽 정렬은 막대가 있을 때 그 옆에 붙는 것이었고, 막대가
 * 사라지면 왼쪽에 이유 없는 여백만 남는다.
 *
 * @param {string} label
 * @param {string|{role?: string, state?: string, selected?: boolean}} state
 */
/**
 * 물 속의 **창**. 흰 종이가 아니다.
 *
 * ── 왜 이것이 필요한가 ──────────────────────────────────────────────────────
 * 판을 전부 걷어내고 글자만 남기는 것이 이 화면의 언어인데, 내용이 **그림**인
 * 자리에서는 그게 안 된다. 마크의 빈 칸, 컬렉션의 카드, 색 견본은 글자로 바꿀
 * 수 있는 것이 아니고, 바탕 없이 물 위에 놓으면 경계가 사라져 어디까지가 하나의
 * 칸인지 읽히지 않는다.
 *
 * 그래서 바탕은 남기되 **재료를 바꾼다.** 흰 종이는 이 화면에 없는 물건이다 —
 * 이 화면에 있는 것은 물이고, 물 속에서 무언가를 담는 것은 더 깊은 물이다.
 * 채우기는 코발트를 반투명으로 얹어 한 단 가라앉히고, 경계는 순백 헤어라인
 * 하나로만 긋는다. 그림자도 그라디언트도 없다 — 둘 다 종이의 성질이다.
 *
 * 헤어라인이 0.34 인 것은 실측이다. 0.6 이면 선이 내용보다 먼저 보이고
 * (칸이 아니라 격자가 화면의 주인공이 된다), 0.2 아래면 밝은 물 위에서 사라진다.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {number} o.w
 * @param {number} o.h
 * @param {number} [o.radius]
 * @param {number} [o.fill]    코발트를 얹는 세기
 * @param {number} [o.line]    헤어라인의 불투명도. 0 이면 선이 없다
 * @param {boolean} [o.accent] 강조 칸. 선이 진해진다
 */
/** 컬렉션 카드의 캐시. 폰트가 늦게 오면 등록부가 비운다. */
const cardCache = new Map();

export function deepWindow(ctx, { w, h, radius = RADIUS.chip, fill = 0.55, line = 0.34, accent = false }) {
  roundRectPath(ctx, 0.5, 0.5, w - 1, h - 1, radius);
  ctx.fillStyle = withAlpha(PALETTE.water.deep, fill);
  ctx.fill();
  if (line > 0) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(PALETTE.water.ink, accent ? Math.min(1, line * 2.1) : line);
    ctx.stroke();
  }
}

export function menuPlateTexture(label, state, { width = 256, height = 52, scale = 1, onWater = false } = {}) {
  /**
   * `scale` 는 텍셀 배수다. 좌표는 프레임 픽셀 그대로 두고 캔버스만 키운다.
   *
   * 예전에는 텍셀 하나가 프레임 픽셀 하나여야 했다 — 알파 이진화된 글자가
   * 리샘플되면 안 됐기 때문이다. 이진화도, 저해상도 타겟도, 5비트 양자화도 없으므로
   * 그 제약은 사라졌고, 남은 것은 반대다: 레티나에서 텍셀 하나는 화면 픽셀 두 개를
   * 덮으므로 그만큼 흐리다.
   */
  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);

  /**
   * `state` 는 문자열이거나 `{ role, state, selected }` 다.
   *
   * 부록 B 가 요구한 확장이다. 문자열도 계속 받는 이유는 호출부가 여덟 곳이고
   * 그 중 대부분이 역할을 하나만 쓰기 때문이다 — 전부 고치는 것보다 기본값이
   * 옳은 편이 낫다. 문자열이면 CHOICE 로 본다: 이 함수가 그리는 것은 메뉴 열의
   * 판이고, 열에 있는 것은 정의상 고르는 것이다.
   */
  const spec = typeof state === 'string' ? { state } : (state ?? {});
  const role = spec.role ?? ROLE.CHOICE;
  const selected = !!spec.selected;
  const SKIN_STATE = { active: 'pressed', dimmed: 'disabled', idle: 'idle', hover: 'hover' };
  const skinState = SKIN_STATE[spec.state] ?? spec.state ?? 'idle';

  /**
   * "준비 중" 도장. `disabled` 일 때만.
   *
   * ── `dimmed` 는 판정이 빠진 `disabled` 다 ─────────────────────────────
   * `disabled` 는 오른쪽에 도장을 찍는다. 그건 **기능이 아직 없다**는 말이고, AI
   * 없는 모드에는 맞지만 지금 이 순간만 못 누르는 줄에는 틀리다. 온라인 화면은
   * 이미 대기열에 들어간 동안 세 줄을 흐리는데, 셋 다 자기가 미완성 기능이라고
   * 말하고 있었다. 같은 색, 도장 없음. 어느 문장인지는 호출부가 고른다.
   */
  const stamp = spec.state === 'disabled' ? '준비 중' : '';
  /**
   * 좌우 여백은 알약이므로 높이에 비례한다.
   *
   * `SPACE.lg * 2` 고정은 256 폭 판에서 28% 지만 168 폭 판에서는 43% 다 — 실제로
   * "마스터 볼륨   70%" 가 "마스터 볼륨   7..." 이 됐다. 둥근 끝이 먹는 공간은
   * 폭이 아니라 **높이**를 따라간다.
   */
  const pad = Math.max(SPACE.sm, height * 0.45);

  let stampW = 0;
  if (stamp) {
    const probe = makeCanvas(8, 8);
    probe.ctx.font = fontSpec(TYPE.caption);
    applyTracking(probe.ctx, TYPE.caption.tracking);
    stampW = probe.ctx.measureText(stamp).width + SPACE.md;
  }

  /**
   * 모서리는 **끝까지** 둥글다. `RADIUS.panel`(20) 이었다.
   *
   * 이 판은 256x52 비율 그대로 커지므로 고정 반경은 판이 커질수록 상대적으로
   * 작아진다 — 작은 창에서 둥글던 것이 큰 창에서는 모서리만 살짝 깎인 사각형이
   * 된다. `RADIUS.chip` 은 `roundRectPath` 가 높이의 절반으로 죄므로 어느
   * 크기에서도 같은 비율이다.
   */
  /**
   * 물 위에 앉는 열의 잉크는 **흰색**이다.
   *
   * 실측: 내비 자리의 물이 선형 휘도 0.234~0.309 다. 어두운 잉크(`cobaltInk`,
   * 0.0596)는 거기서 2.59:1 이고, 4.5:1 을 내려면 배경이 0.44 여야 하는데 그건
   * 블룸을 넘는 밝기다. 배경을 어둡게 하고 잉크를 뒤집는 것이 유일한 길이다.
   * 물의 아래쪽을 `water.js` 가 그만큼 어둡게 만든다.
   */
  const waterSkin = onWater
    ? {
        ...roleSkin(role, skinState),
        text: PALETTE.water.ink,
        rule: PALETTE.water.ink,
        accent: PALETTE.water.ink,
      }
    : null;

  /**
   * ── 판이 아니라 **글자만** 그린다 ────────────────────────────────────────
   *
   * 여기 `roleButton` 이 있었다 — 둥근 알약에 잉크와 워시와 테두리. 하위 화면
   * 넷이 전부 그 알약을 흰 카드 위에 쌓고 있었고, 홈 화면은 물 위에 흰 활자만
   * 있다. 두 화면을 나란히 놓으면 다른 앱이었다.
   *
   * 그래서 판을 걷어내고 홈의 언어를 그대로 가져온다: 하나의 잉크(순백), 판
   * 없음, 테두리 없음, 왼쪽 정렬, 상태는 **밝기**로만 말한다. 호버의 밑줄은
   * 여기서 굽지 않는다 — 자라야 하므로 쿼드가 맡는다(`MenuItems` 와 같은 이유).
   *
   * 대비는 물을 어둡게 해서 얻는다. `depth.js` 가 그 장치이고, 왜 카드가 아니라
   * 그쪽인지는 거기 머리말에 실측과 함께 있다.
   */
  const size = Math.max(11, Math.round(height * 0.30));
  applyTracking(ctx, size * 0.06);
  drawText(ctx, {
    text: label,
    x: 0,
    // 캡 높이의 절반을 베이스라인 보정으로 쓴다. 행 상자 한가운데에 앉는다.
    y: height / 2 + size * 0.36,
    font: `400 ${size}px ${FONT_FAMILY}`,
    /**
     * 흐린 줄이 없다. **모든 글자가 같은 순백**이다.
     *
     * 0.42 였다가 0.62 로 올렸다가, 결국 없앴다. 흐리게 하는 것이 말하려던 것은
     * "지금은 고를 수 없다" 인데, 물 위에서 알파를 내리면 그냥 안 보인다 —
     * 배경이 균일한 종이가 아니라 밝기가 변하는 물이라, 같은 알파가 자리마다
     * 다른 밝기로 읽힌다. 상태를 알파로 말하는 것은 종이 위에서만 되는 방법이다.
     *
     * 못 고르는 줄은 눌러도 아무 일이 없는 것으로, 그리고 `준비 중` 도장으로
     * 말한다. 색으로는 말하지 않는다.
     */
    color: PALETTE.water.ink,
    align: 'left',
  });
  /**
   * 고른 줄에는 앞에 짧은 선을 둔다.
   *
   * 색으로 말할 수 없다 — 잉크가 하나이기 때문이다. 크기로도 말할 수 없다 —
   * 목록의 줄들은 같은 크기여야 읽힌다. 남은 것이 자리이고, 글자 앞의 빈칸에
   * 놓인 선은 목록을 흩뜨리지 않으면서 어느 줄인지 말한다.
   */
  if (selected) {
    ctx.fillStyle = PALETTE.water.ink;
    ctx.fillRect(-size * 0.9, height / 2 - 1, size * 0.55, 1.5);
  }
  applyTracking(ctx, 0);

  if (stamp) {
    applyTracking(ctx, TYPE.caption.tracking);
    drawText(ctx, {
      text: stamp,
      x: width - pad,
      y: height / 2 + TYPE.caption.size * 0.36,
      font: fontSpec(TYPE.caption),
      color: PALETTE.ui.disabledText,
      align: 'right',
    });
    applyTracking(ctx, 0);
  }

  const tex = toTexture(canvas);
  tex.userData = { width, height };
  return tex;
}

/**
 * 화면 하나의 바탕 — 제목 탭 · 몸통 · 푸터 구분선.
 *
 * 그림은 전부 `glass.dialogPanel` 이 그리고 여기는 캔버스와 텍스처만 만든다.
 * 나누는 이유는 `ui/ModalLayer` 도 같은 골격을 2D 캔버스에 직접 그리기 때문이다 —
 * 골격이 두 벌이 되면 두 화면이 다른 모양으로 갈라진다.
 *
 * 크기는 `menu/panelLayout.solvePanel` 이 푼 것을 그대로 받는다. 여기서 다시
 * 계산하지 않는 것은, 메시를 놓는 쪽과 그리는 쪽이 같은 수를 따로 구하면
 * 반드시 어긋나기 때문이다.
 */
export function panelTexture(o) {
  const {
    w, h, tabHeight = 0, title = '', caption = '',
    footerHeight = 0, padTop = 0, padX = 0, scale = 1, divider = false,
  } = o;
  const texH = tabHeight + h;
  const { canvas, ctx } = makeCanvas(Math.round(w * scale), Math.round(texH * scale));
  ctx.scale(scale, scale);
  /**
   * ── 판이 없다. 머리글만 남는다 ──────────────────────────────────────────
   *
   * 여기 `dialogPanel` 이 있었다 — 흰 종이, 둥근 모서리, 탭, 구분선, 그림자.
   * 하위 화면 넷이 전부 그 카드를 물 위에 띄우고 있었고 홈은 활자만 있었다.
   * 카드를 걷어내면 남는 것은 화면의 이름 하나이고, 그것이 있어야 할 전부다.
   *
   * 이름은 홈의 내비와 같은 목소리로 쓴다 — 작고, 자간이 넓고, 순백이고,
   * 왼쪽 위에 붙는다. 신문의 난외 표제(running head)이지 제목이 아니다:
   * 이 화면에서 큰 활자는 게임의 이름 하나뿐이고 그것은 홈에 있다.
   *
   * 대비는 물을 어둡게 해서 얻는다 — `depth.js`.
   */
  if (title) {
    const size = 11;
    applyTracking(ctx, size * 0.24);
    drawText(ctx, {
      text: title.toUpperCase(),
      x: 0,
      y: size,
      font: `400 ${size}px ${FONT_FAMILY}`,
      color: PALETTE.water.ink,
      align: 'left',
    });
    applyTracking(ctx, 0);
  }
  if (caption) {
    const size = 10;
    applyTracking(ctx, size * 0.1);
    drawText(ctx, {
      text: caption,
      x: 0,
      y: (title ? 11 : 0) + size + 8,
      font: `400 ${size}px ${FONT_FAMILY}`,
      color: withAlpha(PALETTE.water.ink, 0.55),
      align: 'left',
    });
    applyTracking(ctx, 0);
  }
  const tex = toTexture(canvas);
  tex.userData = { width: w, height: texH };
  return tex;
}

/**
 * 한 줄에 안 들어가는 제목을 최대 `maxRows` 줄로 접는다.
 *
 * 단어 경계에서만 접는다 — 한 단어를 잘라 넘기면 그건 접은 것이 아니라 부순 것이다.
 * `maxRows` 줄로도 안 들어가면 `fitText` 에 넘겨 크기를 줄이고, 그래도 안 되면 자른다.
 *
 * @returns {{rows: string[], font: string, size: number}}
 */
function wrapToFit(ctx, text, type, maxWidth, maxRows) {
  const measure = (t, size) => {
    ctx.font = fontSpec({ ...type, size });
    return ctx.measureText(t).width;
  };

  for (let size = type.size; size >= Math.round(type.size * 0.76); size -= 1) {
    const rows = [];
    let line = '';
    let ok = true;
    for (const word of String(text).split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next, size) <= maxWidth || !line) {
        // 단어 하나가 이미 넘치면 접을 곳이 없다. 다음 크기로.
        if (!line && measure(next, size) > maxWidth) { ok = false; break; }
        line = next;
      } else {
        rows.push(line);
        line = word;
      }
    }
    if (!ok) continue;
    if (line) rows.push(line);
    if (rows.length <= maxRows) return { rows, font: fontSpec({ ...type, size }), size };
  }

  const fitted = fitText(ctx, text, type, maxWidth);
  return { rows: [fitted.text], font: fitted.font, size: fitted.size };
}

/**
 * 좌하단의 두 줄 숫자. C 시안의 `07 / 06`.
 *
 * 무엇을 가리키는 숫자가 아니라 **구도의 추**다 — 제목이 왼쪽 위에서 잘려 들어오고
 * 내비가 오른쪽 아래에 앉으면 왼쪽 아래가 빈다. 레퍼런스 3 이 같은 자리에 절기
 * 날짜를 놓았고, 여기서는 그것이 오늘 날짜다. 디스플레이 서체를 쓰는 두 번째
 * 자리이고, 그래서 서브셋에 숫자가 들어 있다.
 *
 * 시안 값: 26px, 행간 0.92, 자간 0.04em, 왼쪽 30 / 아래 26.
 */
export function dateStampTexture({ text = ['07', '06'], scale = 2 } = {}) {
  const SIZE = 26;
  const LINE = SIZE * 0.92;
  const TRACK = SIZE * 0.04;
  const probe = makeCanvas(8, 8);
  probe.ctx.font = `400 ${SIZE}px ${DISPLAY_FAMILY}`;
  applyTracking(probe.ctx, TRACK);
  const inkW = Math.max(...text.map((t) => probe.ctx.measureText(t).width - TRACK));
  const pad = Math.round(SIZE * 0.25);
  const width = Math.round(inkW + pad * 2);
  const height = Math.round(LINE * text.length + pad * 2);

  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);
  ctx.font = `400 ${SIZE}px ${DISPLAY_FAMILY}`;
  applyTracking(ctx, TRACK);
  ctx.fillStyle = PALETTE.water.ink;
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText('0');
  const ascent = m.fontBoundingBoxAscent || SIZE * 0.8;
  text.forEach((t, i) => {
    ctx.fillText(t, pad, pad + (LINE - SIZE) / 2 + ascent + i * LINE);
  });

  const tex = toTexture(canvas);
  tex.userData = { width, height, inkW, pad };
  return tex;
}

/** 1x1 흰 텍셀. 밑줄 쿼드가 쓴다 — 색은 `uTint` 가 준다. */
export function ruleTexture() {
  const { canvas, ctx } = makeCanvas(2, 2);
  ctx.fillStyle = PALETTE.fx.white;
  ctx.fillRect(0, 0, 2, 2);
  return toTexture(canvas);
}

/**
 * 내비 한 항목. **글자만** 굽는다.
 *
 * ── 왜 `menuPlateTexture` 가 아닌가 ────────────────────────────────────────
 * 저쪽은 `roleButton` 이 밑줄까지 그려 넣는다. C 시안의 밑줄은 호버에서 왼쪽부터
 * 자라나므로 그림이 아니라 **지오메트리**여야 한다 — 텍스처에 구우면 두 상태
 * 사이에 아무 일도 일어나지 않는다. 그래서 여기서는 글자만 굽고 밑줄은
 * `MenuItems` 가 쿼드로 그린다.
 *
 * 상자를 글자에 맞춰 재서 `userData` 로 돌려준다. 가로줄로 늘어놓으려면 각
 * 항목의 실제 폭이 필요하고, 고정 폭 판으로는 자간이 제멋대로가 된다.
 */
export function navLabelTexture(label, {
  size = 12,
  color = PALETTE.water.ink,
  tracking = 0,
  scale = 2,
  eyebrow = '',
  eyebrowTracking = 1.2,
  display = false,
} = {}) {
  const family = display ? DISPLAY_FAMILY : FONT_FAMILY;
  const probe = makeCanvas(8, 8);
  probe.ctx.font = `400 ${size}px ${family}`;
  applyTracking(probe.ctx, tracking);
  // 마지막 글자 뒤의 자간은 상자에 넣지 않는다. 넣으면 오른쪽 정렬이 어긋난다.
  const inkW = Math.max(1, probe.ctx.measureText(label).width - tracking);

  const microSize = 8;
  const microProbe = makeCanvas(8, 8);
  microProbe.ctx.font = `400 ${microSize}px ${FONT_FAMILY}`;
  applyTracking(microProbe.ctx, eyebrowTracking);
  const eyebrowW = eyebrow
    ? Math.max(1, microProbe.ctx.measureText(eyebrow).width - eyebrowTracking)
    : 0;
  const pad = Math.round(size * 0.5);
  const width = Math.round(Math.max(inkW, eyebrowW) + pad * 2);
  const height = eyebrow ? Math.round(size * 2.35) : Math.round(size * 2.2);

  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);
  if (eyebrow) {
    ctx.font = `400 ${microSize}px ${FONT_FAMILY}`;
    applyTracking(ctx, eyebrowTracking);
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(eyebrow, pad, microSize + 2);
  }

  ctx.font = `400 ${size}px ${family}`;
  applyTracking(ctx, tracking);
  ctx.fillStyle = color;
  ctx.textBaseline = eyebrow ? 'alphabetic' : 'middle';
  ctx.textAlign = 'left';
  const mainY = eyebrow ? height - Math.round(size * 0.35) : height / 2;
  ctx.fillText(label, pad, mainY);

  const tex = toTexture(canvas);
  /**
   * `anchorLift` 는 주 글자의 시각 중심이 하단 기준선에서 size/2 위에 오게 하는 값.
   * 영문 설명 때문에 캔버스가 위로 커져도 PLAY와 모드명의 기준선은 움직이지 않는다.
   */
  const mainCenterY = eyebrow ? mainY - size * 0.43 : height / 2;
  const anchorLift = size * 0.5 + mainCenterY - height / 2;
  tex.userData = { width, height, inkW, pad, anchorLift };
  return tex;
}

/**
 * 물에 잠기는 제목. C 시안의 값을 그대로 옮긴 것이다.
 *
 * ── 시안이 곧 명세다 ──────────────────────────────────────────────────────
 * 서체 `MSA Display`(나눔명조 ExtraBold 서브셋), 206px, 행간 0.78, 자간 −0.035em,
 * 둘째 줄 들여쓰기 176px, 블록 회전 −7도. 프레임 853x480 기준이고 시안의 CSS px 이
 * 곧 프레임 픽셀이므로 환산이 없다. 배치는 `SubmergedTitle` 이 한다.
 *
 * ── 왜 `lettering.js` 가 아닌가 ───────────────────────────────────────────
 * 벡터 획은 임의의 한글을 합성하지만 획 굵기가 일정한 기하 서체다. 레퍼런스가
 * 요구하는 것은 획 대비가 큰 명조이고, 그건 획을 그려서 흉내 낼 수 있는 것이
 * 아니다. 사용자 입력이 섞이는 자리는 계속 `lettering.js` 가 맡는다.
 *
 * 잉크는 흰색으로 굽는다. 화면에 나가는 실제 색은 `SubmergedTitle` 의 셰이더가
 * 정하고, 셰이더는 여기서 알파만 읽는다.
 */
/**
 * 제목 둘째 줄의 **가림 마스크**. 색이 없다.
 *
 * ── 무엇을 하는 물건인가 ────────────────────────────────────────────────────
 * `알까기` 의 획을 굵게 부풀린 실루엣이다. 화면에는 아무것도 그리지 않고
 * **깊이 버퍼에만** 쓴다(`SubmergedTitle` 이 `colorWrite: false` 로 그린다).
 * 그 뒤에 그려지는 것들이 깊이 검사에서 걸러지므로, 제목 아래를 지나는 것이
 * 그 자리에서 사라지고 **물이 그대로 보인다.**
 *
 * 색을 칠해서 가리는 것과 다르다. 물빛으로 테를 두르면 그 테가 하나의 그림이
 * 되어 제목이 오려 붙인 스티커가 되고, 물이 움직이는데 테만 안 움직여서
 * 어긋난다. 파내면 뒤에 있던 물이 그대로 드러나므로 아무것도 덧그려지지 않는다.
 *
 * 획을 두 번 그리는 이유는 stroke 가 윤곽선만 굵히기 때문이다 — fill 을 같이
 * 해야 속이 찬 실루엣이 된다. `lineJoin: 'round'` 인 것은 miter 면 획이 만나는
 * 뾰족한 곳에서 마스크가 길게 튀어나오기 때문이다.
 *
 * 첫 줄은 마스크가 없다. 프레임 위쪽이라 지나갈 것이 없고, 둘 다 가리면 제목
 * 전체가 구멍이 되어 이름이 떠오르는 것이 아니라 뚫린 것으로 보인다.
 */
export function submergedTitleMaskTexture({ scale = 1 } = {}) {
  const m = TITLE_METRICS;
  const { canvas, ctx } = makeCanvas(Math.round(m.width * scale), Math.round(m.height * scale));
  ctx.scale(scale, scale);
  ctx.font = `400 ${m.size}px ${DISPLAY_FAMILY}`;
  applyTracking(ctx, m.track);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = m.size * 0.17;
  const x = m.padL + m.indent;
  const y = m.base1 + m.line;
  ctx.strokeText('알까기', x, y);
  ctx.fillText('알까기', x, y);
  applyTracking(ctx, 0);
  const tex = toTexture(canvas);
  tex.userData = { width: m.width, height: m.height };
  return tex;
}

/**
 * 제목의 저술값 한 벌. 본문과 마스크가 **같은 값**을 써야 한다.
 *
 * 두 함수가 각자 상수를 갖고 있으면 언젠가 하나만 고쳐지고, 그때 마스크가
 * 글자와 어긋난 자리를 파낸다 — 화면에는 이유 없이 잘린 물체로 보인다.
 * 그래서 한 곳에서 계산해 둘 다 읽는다.
 *
 * 값의 근거는 아래 `submergedTitleTexture` 의 주석에 있다.
 */
const TITLE_METRICS = (() => {
  const size = 112;
  const line = size * 0.78;
  const contentH = Math.round(line * 2);
  const padY = Math.round(size * 0.3);
  // 어센트는 서체가 알려 주는 값이지만 모듈 로드 시점에는 잴 수 없다. 0.8em 은
  // 실측값이고, `submergedTitleTexture` 가 서체가 붙은 뒤 다시 재서 덮어쓴다.
  const ascent = size * 0.8;
  return {
    size,
    line,
    track: -size * 0.035,
    indent: Math.round(size * (176 / 206)),
    padL: Math.round(30 + size * 0.021),
    width: 853,
    contentH,
    padY,
    height: contentH + padY * 2,
    base1: padY + (line - size) / 2 + ascent,
  };
})();

export function submergedTitleTexture({ scale = 1 } = {}) {
  /**
   * ── 시안의 206 이 아니라 **112** 다. 그리고 프레임 안에 든다 ──────────────
   *
   * 시안의 제목은 프레임보다 큰 상자(853 + 56*2)에 206px 로 앉아 좌우로 흘러
   * 나갔다. 잘린 거대 활자는 편집 디자인의 장치이고, 그 장치는 **받쳐 줄 것이
   * 있을 때** 성립한다 — 시안에는 오른쪽에 병이 있었다. 병이 없어진 지금
   * 화면에 남은 것이 그 한 낱말뿐이라, 잘린 활자는 의도가 아니라 사고로 보인다.
   *
   * 그래서 크기를 줄이고 프레임 안에 넣는다. 왼쪽 여백 30 은 내비·날짜 도장·
   * 하위 화면 목록과 **같은 값**이다 — 화면의 모든 것이 한 세로선에서 시작한다.
   *
   * 112 는 두 줄이 프레임 높이의 절반 아래로 내려오지 않는 가장 큰 값이다:
   * 행 상자 두 개가 112 * 0.78 * 2 = 175 이고, 위 여백 46 을 더하면 221 로
   * 480 의 46% 다. 그보다 크면 제목이 화면의 절반을 넘고, 그러면 줄인 이유가
   * 없어진다.
   */
  const SIZE = 112;
  const LINE = SIZE * 0.78;
  const TRACK = -SIZE * 0.035;
  /** 둘째 줄의 들여쓰기. 시안의 176/206 을 비로 옮긴 것이다. */
  const INDENT = Math.round(SIZE * (176 / 206));
  /**
   * 첫 글자의 **잉크**가 30 에서 시작하도록 펜을 놓는다.
   *
   * 이 서체의 왼쪽 사이드베어링이 −0.021em 이라(실측: 206px 에서 −4.4), 펜을
   * 그냥 30 에 놓으면 획이 25.6 에서 시작해 다른 줄들보다 왼쪽으로 튀어나온다.
   */
  const PAD_L = Math.round(30 + SIZE * 0.021);
  /** 프레임 폭 그대로. 넘치지 않으므로 상자를 키울 이유가 없다. */
  const width = 853;
  /**
   * 행 상자 두 개가 **내용** 높이이고, 캔버스는 그보다 위아래로 더 크다.
   *
   * 행간이 0.78 이라 글자가 자기 행 상자 위아래로 넘친다 — 그것이 시안의 촘촘한
   * 두 줄을 만드는 값이다. CSS 는 넘친 것을 그대로 그리지만 캔버스는 잘라내므로,
   * 실측으로 첫 글자의 윗획이 통째로 없어졌다. 여백을 대칭으로 주면 블록의
   * 중심이 안 움직이므로 배치 계산은 `contentH` 를 그대로 쓴다.
   */
  const contentH = Math.round(LINE * 2);
  const padY = Math.round(SIZE * 0.3);
  const height = contentH + padY * 2;

  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);

  ctx.font = `400 ${SIZE}px ${DISPLAY_FAMILY}`;
  applyTracking(ctx, TRACK);
  // 셰이더가 알파만 읽으므로 색은 형식이지만, 잉크의 출처를 하나로 둔다.
  ctx.fillStyle = PALETTE.water.ink;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  /**
   * 베이스라인. CSS 의 반행간 계산을 그대로 옮긴다.
   *
   * 행 상자가 글자보다 작으므로(0.78) 반행간이 음수이고, 글자가 상자 위아래로
   * 넘친다 — 그것이 시안의 촘촘한 두 줄을 만드는 값이다. 어센트는 실측으로
   * 0.8em 을 쓴다(`measureText` 의 `fontBoundingBoxAscent` 가 있으면 그것을).
   */
  const half = (LINE - SIZE) / 2;
  const m = ctx.measureText('한');
  const ascent = m.fontBoundingBoxAscent || SIZE * 0.8;
  const base1 = padY + half + ascent;

  ctx.fillText('한여름', PAD_L, base1);

  ctx.fillText('알까기', PAD_L + INDENT, base1 + LINE);

  const tex = toTexture(canvas);
  tex.userData = { width, height, contentH, rotation: 0 };
  return tex;
}

/**
 * 메뉴 열 위의 제목판, 그리고 설정 화면의 머리글.
 *
 * ── 유리판이 생겼다 ────────────────────────────────────────────────────────
 * 예전에는 `clearRect` 로 투명하게 두고 흰 글씨를 배경 위에 얹었다. 판이 없으니
 * 잉크가 흰색일 수밖에 없었고, 그 아래 빨간 줄 하나가 유일한 구조였다. 이제 판이
 * 있으므로 두 줄 다 `ui.text` 로 돌아간다 — 이 함수의 옛 주석이 PHASE 6 에서
 * 그렇게 될 것이라고 적어 둔 그대로다.
 */
export function titleTexture(text, sub, { width = 256, height = 80, scale = 1, withPlate = true } = {}) {
  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);

  /**
   * 판은 선택이다.
   *
   * 이것이 화면 전체에 홀로 떠 있는 제목일 때는 판이 있어야 한다 — 배경이
   * 하늘이라 글자만으로는 대비가 모자란다. 부록 B 의 패널 **안**에 들어가는
   * 읽기 전용 줄일 때는 없어야 한다: 떠 보이는 둥근 판은 그 자체로 누를 수
   * 있다는 말이고, 누를 수 없는 것에 그 말을 붙이는 것이 부록 B 가 없애려는
   * 바로 그 혼동이다.
   */
  /**
   * 판은 없다. `withPlate` 는 남기지만 아무것도 그리지 않는다.
   *
   * 예전에는 하늘 배경 위에서 대비가 모자라 판이 필요했다. 지금 배경은 물이고,
   * 대비는 `depth.js` 가 물을 어둡게 해서 만든다 — 글자 뒤에 종이를 깔지 않는다.
   * 인자를 지우지 않는 것은 호출부가 넷이고 그 중 둘이 "판 없음"을 명시적으로
   * 요구하고 있어서다: 지금은 둘 다 같은 그림이지만, 그 구분이 있었다는 사실이
   * 다음 사람에게 왜 여기 판이 없는지 말해 준다.
   */
  void withPlate;

  /**
   * 글자는 **왼쪽**에서 시작한다. 가운데가 아니다.
   *
   * 판이 있을 때는 가운데가 맞았다 — 종이 위의 제목은 종이를 기준으로 놓인다.
   * 판이 없어지면 기준도 없어지고, 남은 기준은 프레임의 왼쪽 선이다. 이 줄들이
   * 가운데에 남아 있으면 왼쪽에 붙은 나머지 목록과 어긋나 보인다.
   */

  /**
   * 머리글은 줄이기 전에 **접는다**.
   *
   * ── 실측 ────────────────────────────────────────────────────────────────
   * 판이 168 폭일 때 안쪽 여백을 빼면 124 가 남는다.
   *
   * 지금 제목인 "한여름 알까기" 는 26px 에서 141, 24px 에서 130 으로 넘치고
   * 22px 에서 119 가 되어 **한 줄로 들어간다.** 즉 오늘의 제목은 접기까지 가지
   * 않고 `fitText` 의 축소만으로 끝난다.
   *
   * 접기를 남겨 두는 이유는 그것이 이 제목을 위한 코드가 아니기 때문이다.
   * 개명 전 제목 "BOTTLE CAP CHAOS" 는 26px 에서 255, 최소 크기인 20px 에서도
   * 196 이라 어떤 크기로도 한 줄에 못 들어갔고 — `fitText` 만 쓰면 "BOTTLE..."
   * 이 되었다 — 두 줄로 접어야 "BOTTLE CAP" 이 20px 에서 121 로 들어갔다.
   * 제목이 다시 길어지면 같은 문제가 그대로 돌아온다.
   *
   * 제목은 스캔하는 것이 아니라 한 번 읽는 것이므로, 작은 한 줄보다 온전한 두
   * 줄이 낫다. 단어 경계에서만 접고, 두 줄로도 안 되면 그때 `fitText` 가
   * 줄이거나 자른다.
   */
  const probe = makeCanvas(8, 8);
  const room = width - Math.max(SPACE.sm, height * 0.22) * 2;

  /**
   * 판 높이에 맞춰 글자를 줄인다.
   *
   * ── 실측 ────────────────────────────────────────────────────────────────
   * `columnLayout` 이 세로가 모자라면 슬롯 높이를 깎는다. 제목 슬롯도 예외가 아니라
   * 72 가 48 이 되는 일이 있는데, 그 안에 26px 제목과 15px 부제를 그리면 부제가
   * 판 아래로 흘러나간다 — 마크 화면에서 "뚜껑에 새길 그림" 이 반만 보였다.
   *
   * 폭에 대해서는 접고, 높이에 대해서는 줄인다. 접을 축이 하나뿐이기 때문이다.
   */
  const fitK = (() => {
    const probeLines = wrapToFit(probe.ctx, text, TYPE.body, room, 2);
    const rows = probeLines.rows.length;
    const need =
      rows * TYPE.body.size +
      (rows - 1) * Math.round(TYPE.body.size * 0.18) +
      (sub ? TYPE.caption.size + SPACE.xs : 0) +
      SPACE.sm * 2;
    return Math.max(0.55, Math.min(1, height / Math.max(1, need)));
  })();
  const titleType = { ...TYPE.body, size: Math.round(TYPE.body.size * fitK) };
  const subType = { ...TYPE.caption, size: Math.round(TYPE.caption.size * fitK) };

  const lines = wrapToFit(probe.ctx, text, titleType, room, 2);

  const headSize = lines.size;
  const gap = Math.round(headSize * 0.18);
  const headBlock = lines.rows.length * headSize + (lines.rows.length - 1) * gap;
  const subH = sub ? subType.size + SPACE.xs : 0;
  let y = Math.round((height - headBlock - subH) / 2 + headSize * 0.82);

  applyTracking(ctx, titleType.tracking);
  for (const row of lines.rows) {
    drawText(ctx, {
      text: row,
      x: 0,
      y,
      font: lines.font,
      color: PALETTE.ui.text,
      align: 'left',
    });
    y += headSize + gap;
  }
  applyTracking(ctx, 0);

  if (sub) {
    const line = fitText(probe.ctx, sub, subType, room);
    applyTracking(ctx, subType.tracking);
    drawText(ctx, {
      text: line.text,
      x: 0,
      y: y - gap + SPACE.xs,
      font: line.font,
      color: PALETTE.ui.textMuted,
      align: 'left',
    });
    applyTracking(ctx, 0);
  }

  const tex = toTexture(canvas);
  tex.userData = { width, height };
  return tex;
}

/**
 * 컬렉션의 한 줄. **카드가 아니라 목록의 줄이다.**
 *
 * ── 세로 카드를 왜 버렸는가 ─────────────────────────────────────────────────
 * 처음에는 게임의 카드 얼굴을 메뉴 재료로 다시 구웠다 — 흰 유리판이 물 속의
 * 창이 되고 잉크가 순백이 되는 식으로. 재료는 맞았지만 **형태**가 틀렸다:
 * 세로로 긴 판에 이름·그림·설명이 3단으로 쌓인 것은 손에 쥐고 부채꼴로 펼치는
 * 물건의 형태다. 컬렉션에서 하는 일은 쥐는 것이 아니라 훑는 것이다.
 *
 * 그래서 줄로 눕힌다. 설정 화면의 줄들과 같은 구조 — 왼쪽에서 시작하고, 한 줄에
 * 한 가지이고, 눈이 세로로만 움직인다. 이 화면이 목록이라는 사실을 형태가 말한다.
 *
 * ── 그림은 남는다 ──────────────────────────────────────────────────────────
 * 아이콘과 강조색은 게임의 것을 그대로 쓴다(`iconForCard`, `accentOf`). 이
 * 화면에서 색을 갖는 것은 카드뿐이고, 그것이 카드가 여섯 종류라는 사실을 말하는
 * 유일한 장치다 — 나머지는 전부 한 잉크다. 절차적 무늬는 뺐다: 24px 아이콘 뒤에
 * 깔면 무늬가 아니라 얼룩이고, 그 크기에서 여섯 장을 가르는 것은 아이콘 모양이다.
 *
 * @param {object} card
 * @param {object} o
 * @param {number} o.width   줄의 폭, 저술 픽셀
 * @param {number} o.height  줄의 높이, 저술 픽셀
 */
export function collectionRowTexture(card, { width, height }) {
  const scale = texelScale();
  const key = `crow:${card.id}:${Math.round(width)}x${Math.round(height)}:${scale}`;
  const hit = cardCache.get(key);
  if (hit) return hit;

  const w = Math.round(width);
  const h = Math.round(height);
  const { canvas, ctx } = makeCanvas(Math.round(w * scale), Math.round(h * scale));
  ctx.scale(scale, scale);

  const accent = accentOf(card);
  const ink = PALETTE.water.ink;
  const mid = h / 2;

  // 아이콘. 줄 높이에 비례하고 강조색이다.
  const icon = iconForCard(card);
  const iconSize = Math.round(h * 0.56);
  if (icon) drawIcon(ctx, icon, { x: 0, y: mid - iconSize / 2, size: iconSize, color: accent });

  /**
   * 이름과 설명이 **고정된 두 열**에 선다.
   *
   * 설명을 이름 바로 뒤에 붙이면 이름 길이에 따라 설명의 시작점이 줄마다
   * 달라진다. 여섯 줄이 세로로 쌓이는 화면에서 그건 오른쪽 가장자리가 톱니가
   * 되는 것과 같다 — 열이 둘이면 둘 다 세로선을 가져야 한다.
   */
  const nameX = Math.round(h * 1.05);
  const textX = Math.round(w * 0.34);
  const size = Math.max(11, Math.round(h * 0.34));

  applyTracking(ctx, size * 0.04);
  drawText(ctx, {
    text: card.name,
    x: nameX,
    y: mid + size * 0.36,
    font: `400 ${size}px ${FONT_FAMILY}`,
    color: ink,
    align: 'left',
  });
  const sub = Math.max(10, Math.round(size * 0.84));
  drawText(ctx, {
    text: card.text,
    x: textX,
    y: mid + sub * 0.36,
    font: `400 ${sub}px ${FONT_FAMILY}`,
    // 설명은 이름보다 한 단 물러난다. 위계는 크기가 아니라 밝기로 — 이 화면의 규칙.
    color: withAlpha(ink, 0.66),
    align: 'left',
  });
  applyTracking(ctx, 0);

  const tex = toTexture(canvas);
  tex.userData = { width: w, height: h };
  cardCache.set(key, tex);
  return tex;
}


/**
 * 뚜껑 하나를, 평면으로. **3D 메시가 아니다.**
 *
 * ── 왜 굽는가 ───────────────────────────────────────────────────────────────
 * 상대 선택 화면의 뚜껑 둘은 `buildCapGeometry` 로 만든 진짜 3D 원반이었다.
 * 조명을 받고 환경 맵을 반사하고 서로를 향해 돌아 있었다 — 판 위의 물건과 같은
 * 재료로 만든, 잘 만든 물건이다.
 *
 * 그런데 이 화면의 나머지는 전부 평면 활자다. 입체가 하나 섞이면 그것만 다른
 * 공간에서 온 것으로 보이고, 다섯 화면을 같은 언어로 맞춘 뒤에는 그 하나가
 * 유일하게 튀는 것이 된다. 무엇을 고르는지 말하는 데 필요한 것은 색과 마크이지
 * 입체감이 아니다.
 *
 * ── 크림프는 남긴다 ────────────────────────────────────────────────────────
 * 테두리의 짧은 방사 눈금이 병뚜껑을 병뚜껑으로 만드는 유일한 형태다. 원만
 * 그리면 그건 동그라미이고, 이 게임의 이름이 알까기다.
 *
 * @param {object} o
 * @param {string} o.color       뚜껑 몸통 색
 * @param {CanvasImageSource|null} o.mark  가운데에 얹을 마크. 없으면 빈 뚜껑
 * @param {number} o.size        저술 픽셀
 */
export function capDiscTexture({ color, mark = null, size = 96 }) {
  const scale = texelScale();
  const px = Math.max(24, Math.round(size * scale));
  const { canvas, ctx } = makeCanvas(px, px);
  const half = px / 2;
  const r = half - 1;

  // 몸통.
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(half, half, r, 0, Math.PI * 2);
  ctx.fill();

  /**
   * 크림프. 21 개인 것은 실제 왕관 뚜껑의 이 수다.
   *
   * 색을 칠하지 않고 **파낸다**(`destination-out`). 밝은 눈금을 얹으면 색이
   * 밝은 뚜껑에서 사라지고, 어두운 눈금을 얹으면 어두운 뚜껑에서 사라진다 —
   * 파내면 뒤의 물이 비쳐서 어느 색에서나 같은 모양으로 읽힌다.
   */
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = Math.max(1, px * 0.02);
  ctx.lineCap = 'butt';
  for (let i = 0; i < 21; i++) {
    const a = (i / 21) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(half + c * r, half + s * r);
    ctx.lineTo(half + c * (r - px * 0.075), half + s * (r - px * 0.075));
    ctx.stroke();
  }
  ctx.restore();

  // 마크가 앉는 패널. 뚜껑 반지름의 0.72 — `markTextures` 의 CAP_PANEL_RATIO 와 같다.
  const panelR = r * 0.72;
  ctx.fillStyle = withAlpha(PALETTE.water.ink, 0.14);
  ctx.beginPath();
  ctx.arc(half, half, panelR, 0, Math.PI * 2);
  ctx.fill();

  if (mark) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, panelR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(mark, half - panelR, half - panelR, panelR * 2, panelR * 2);
    ctx.restore();
  }

  const tex = toTexture(canvas);
  tex.userData = { width: size, height: size };
  return tex;
}

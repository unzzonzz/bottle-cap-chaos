import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { PALETTE, withAlpha } from '../core/palette.js';
import { RADIUS, ROLE, RULE, SPACE, TYPE } from '../core/tokens.js';
import { drawIcon } from '../ui/icons.js';
import { drawLettering, letteringWidth } from '../ui/lettering.js';
import {
  applyTracking,
  dialogPanel,
  fitText,
  fontSpec,
  plate,
  panel,
  roleButton,
  roleSkin,
  skinFor,
} from '../ui/paper.js';
import { ring } from '../ui/marks.js';

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
 * The glass highlight, baked.
 *
 * Two vertical white strips at fixed angles and one dark band opposite them,
 * over black. Added by the glass shader, so black contributes nothing and only
 * the strips show — which is why this is a black image rather than a grey one.
 *
 * Two strips and not one: a single strip reads as a seam. Two, at different
 * widths, read as a window and a lamp.
 *
 * The u axis is the way round the bottle, so a strip is a fixed angle and stays
 * put as the bottle floats. The v axis fades them out at the very top and
 * bottom in HARD STEPS, not a ramp — a smooth falloff here is exactly the
 * gradient the brief rules out, and it would band anyway.
 */
export function glassHighlightTexture() {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = PALETTE.additiveZero;
  ctx.fillRect(0, 0, 128, 128);

  /** @param {number} u0  left edge in texels @param {string[]} steps  bottom to top */
  const strip = (u0, width, steps) => {
    const band = 128 / steps.length;
    for (let i = 0; i < steps.length; i++) {
      ctx.fillStyle = steps[i];
      ctx.fillRect(u0, Math.round(128 - (i + 1) * band), width, Math.ceil(band));
    }
  };

  // ── where the strips sit, and why not in the middle ──────────────────────
  // u = 0 is +x and the camera is on +z, so the front of the bottle is u =
  // 0.25 — texel 32. A strip there runs straight down the centre of the
  // silhouette and reads as a painted stripe rather than as a reflection,
  // because a reflection you are looking at head-on is the one place a real one
  // never is. Both are set off to one side of it.
  //
  // Narrow, too. Wide is what makes it paint: at three texels the strip is
  // about two pixels of a 320-wide framebuffer, which is a glint.
  strip(20, 3, PALETTE.additive.glintKey);
  // Its companion, dimmer and further round: a window next to the lamp.
  strip(44, 2, PALETTE.additive.glintMid);
  // Round the back, catching the same light from the other side. Seen through
  // two walls of glass, so dimmer again.
  strip(92, 3, PALETTE.additive.glintFar);

  return toTexture(canvas, { wrapS: RepeatWrapping, wrapT: ClampToEdgeWrapping });
}

/**
 * The label.
 *
 * ── what this is not ────────────────────────────────────────────────────────
 * It carries the GAME's name. There is no Spencerian script here, no swash, no
 * ribbon or wave device of any kind, and the type is a sheared grotesque rather
 * than a connected hand. What is borrowed is the FORM LANGUAGE that a hundred
 * soda labels share and nobody owns: a red band round the middle of the bottle,
 * white type on it, and a rule above and below that curves with the glass.
 *
 * ── it is authored at the size it is DISPLAYED at ───────────────────────────
 * The band is drawn once and wrapped twice round the bottle (see
 * `buildLabelGeometry`), so this image is one panel, and one panel covers the
 * whole visible front of the bottle.
 *
 * At the 640x480 target and this framing, that front is about ninety
 * framebuffer pixels across and fifty tall — so 128x64 lands within about a
 * third of one texel per pixel. That ratio is the whole design constraint here,
 * not the page size: authored at twice what it is shown at, every texel of
 * carefully thresholded type gets averaged away on the trip to the screen and
 * the logo arrives as a red smear with a lighter streak through it. (Measured,
 * at the 320x240 target, where 128x64 was exactly twice too big.)
 *
 * Same rule the menu plates follow, and the same one `cardTexture` follows for
 * a card in the hand. Bold, three words, nothing thinner than a texel.
 */
export function labelTexture() {
  const w = 512;
  const h = 768;
  const { canvas, ctx } = makeCanvas(w, h);
  // 그려지는 것이지 찍히는 것이 아니라, 이 파일에서 유일하게 스무딩을 켠다.
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, w, h);

  /**
   * 흰 타원 하나, 그 위에 이름 하나.
   *
   * ── 한때 인쇄물 흉내를 냈고, 그건 과했다 ─────────────────────────────────
   * 아치형 라틴 문자, 가운데 왕관 뚜껑 일러스트, 한글 제목, 하단 미세 인쇄 밴드까지
   * 얹혀 있었다. 라벨은 화면에서 세로 200픽셀 남짓이고 그 위에 유리 한 겹과 블룸이
   * 올라가므로, 요소를 넣을수록 읽히는 게 아니라 지저분해진다. 그래서 전부 걷어내고
   * 종이 한 장만 남겼다.
   *
   * ── 그 판단은 다섯 요소에 대한 것이었고, 하나는 다르다 ──────────────────
   * 걷어낸 뒤로 라벨은 **빈 스티커**였다. §7 이 1990년대 음료 그래픽을 이 세계의
   * 목소리로 삼는데, 음료병에서 그 목소리가 사는 자리가 바로 여기다. 그래서 하나만
   * 돌아온다: 이름, 벡터 획으로.
   *
   * 다섯이 실패한 이유가 하나에는 걸리지 않는 근거는 그때의 근거 그 자체다 —
   * "요소를 넣을수록 지저분해진다" 는 요소 수에 대한 말이었다. 그리고 이건 폰트가
   * 아니라 획이라 유리와 블룸 아래에서 얇아지지 않는다.
   *
   * 타원의 가로 지름은 페이지 폭의 절반이다. 메시가 `bodyRadius` 30mm 병을 160도
   * 도는 호라서 페이지가 대응하는 호장이 2*pi*30*(160/360) = 83.8mm 이고, 라벨은
   * `labelOvalWidth` 42mm — 거의 정확히 그 절반이다. 이 비율이 틀어지면 타원의
   * 이심률이 틀어져서 "늘어난 라벨"로 즉시 읽힌다.
   */
  ctx.beginPath();
  ctx.ellipse(w / 2, h / 2, (w * 0.5) / 2, (h * 0.96) / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE.label.paper;
  ctx.fill();

  /**
   * ── 페이지의 세로축이 병을 **감는다.** 축을 따라가지 않는다 ─────────────
   * 처음엔 반대로 놓았고 화면에서 이름이 90도 누워 나왔다. 메시는 `bodyRadius`
   * 30mm 병을 160도 도는 호이고, 페이지의 h 가 그 호를 따라간다 — 타원이 화면에서
   * 세로로 길어 보이는 것은 **감긴** 결과이지 페이지가 세로라서가 아니다.
   *
   * 그래서 텍스트 블록 전체를 90도 돌려서 그린다. 페이지 좌표를 다시 저술하지
   * 않는 이유는 타원의 이심률 계산(위)이 지금의 w/h 관계에 걸려 있기 때문이다 —
   * 축을 바꾸면 그 계산도 같이 바꿔야 하고, 회전은 한 줄이다.
   */
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(Math.PI / 2);
  // 회전 뒤의 좌표계: x 가 병의 축 방향, y 가 감기는 방향. 그래서 두 덩이는
  // y 로 벌리고, 각 덩이는 x 로 가운데를 잡는다.
  //
  // 부호는 실측으로 정했다. -PI/2 는 글자가 뒤집혀 나온다 — 페이지의 y 가 병에
  // 감기면서 방향이 한 번 더 뒤집히기 때문이고, 그건 UV 를 읽어서 알아내는 것보다
  // 두 번 돌려 보는 쪽이 빠르다.
  drawLettering(ctx, '한여름', {
    x: 0,
    y: -h * 0.1,
    size: 96,
    color: PALETTE.menu.labelInk,
    tracking: 8,
    align: 'center',
  });
  drawLettering(ctx, '알까기', {
    x: 0,
    y: h * 0.05,
    size: 96,
    color: PALETTE.menu.labelInk,
    tracking: 8,
    align: 'center',
  });
  // 아래를 받치는 줄 하나. §20 의 어휘이고, 인쇄물의 규칙선이다.
  ctx.strokeStyle = PALETTE.menu.labelRule;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-w * 0.22, h * 0.2);
  ctx.lineTo(w * 0.22, h * 0.2);
  ctx.stroke();
  ctx.restore();

  return toSmoothTexture(canvas);
}

/**
 * The shadow under the bottle: one very soft, very faint ellipse.
 *
 * Not a rendered shadow, and not because one would be hard — a real one needs a
 * light, a caster, a receiver and a depth pass to produce a dark blob on the
 * floor. That IS the blob.
 *
 * ── it was four hard steps, and it was a CONTACT shadow ──────────────────
 * 0.62 in the middle falling to 0.07 at the rim, in four discrete rings. That
 * darkness is what a shadow looks like where an object meets a surface, and it
 * was right while the bottle stood on one.
 *
 * §6.2 takes the surface away. What is left has one job — saying the bottle is
 * ABOVE something — and §7 gives it one adjective, "very soft". So it is a
 * continuous gradient rather than steps, it peaks at a fifth of what it did,
 * and it reaches zero well inside the quad. A hard-edged shadow under a
 * floating object is the thing that puts the floor back.
 *
 * The resolution went up with it: 64 texels was ample for four flat rings and
 * is not for a gradient, which bands visibly when it is stretched across the
 * two-and-a-half-unit quad `shadowScale` asks for.
 */
export function shadowTexture() {
  const size = 128;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // The alphas are the falloff's shape and stay here; only the ink is the
  // palette's. Squared-off in the middle so the core is broad rather than a
  // point, then gone by 0.9 — the last tenth is what keeps the quad's own edge
  // from ever being visible.
  g.addColorStop(0, withAlpha(PALETTE.menu.shadow, 0.13));
  g.addColorStop(0.35, withAlpha(PALETTE.menu.shadow, 0.1));
  g.addColorStop(0.7, withAlpha(PALETTE.menu.shadow, 0.035));
  g.addColorStop(0.9, withAlpha(PALETTE.menu.shadow, 0));
  g.addColorStop(1, withAlpha(PALETTE.menu.shadow, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(canvas);
}

/**
 * The pool of light on the floor.
 *
 * Concentric hard rings, brightest in the middle. Four steps, because the brief
 * bans smooth gradients and because four is what a 15-bit framebuffer would
 * have given anyway once the quantiser had finished with a smooth one.
 */
export function floorPoolTexture() {
  const size = 128;
  const { canvas, ctx } = makeCanvas(size, size);
  // TRANSPARENT outside the pool, not black. Filled black it is an opaque
  // square with a circle drawn on it, and the square's corners are a visible
  // hard edge across the middle of the scene — darker than the background it is
  // sitting on, which is how you notice a floor that is not supposed to have a
  // boundary at all.
  ctx.clearRect(0, 0, size, size);
  // The outermost ring stops at 0.84 of the page and everything beyond it is
  // clear, so the pool has died out well before the quad it is drawn on ends.
  // Run out to the edge and the quad's own straight far edge is a horizontal
  // line across the back of the scene where the floor's tint stops.
  const P = PALETTE.menu.pool;
  const steps = [
    [0.84, withAlpha(P[0], 0.45)],
    [0.66, withAlpha(P[1], 0.8)],
    [0.48, P[2]],
    [0.3, P[3]],
    [0.14, P[4]],
  ];
  for (const [r, color] of steps) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size / 2) * r, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas);
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
 * Foam.
 *
 * Cells rather than a froth: hard-edged blobs of three tones on a pale ground,
 * packed on a jittered grid so no row lines up with the one above it. Tiles in
 * both directions, because the foam column scrolls this upward as it rises and
 * a seam crossing the bottle every half second is the one thing that would give
 * the trick away.
 *
 * Cola foam is not white. It is a dirty cream that goes tan where it is thick,
 * and painting it white is the fastest way to make a bottle of cola look like a
 * bottle of beer.
 */
export function foamTexture() {
  const size = 64;
  const { canvas, ctx } = makeCanvas(size, size);
  // Light enough to survive being seen through a wall of brown glass at 60%
  // opacity, which is the only place it is ever seen.
  ctx.fillStyle = PALETTE.menu.foam;
  ctx.fillRect(0, 0, size, size);

  const tones = PALETTE.menu.foamTones;
  // A fixed pattern rather than a random one: this is drawn once at boot and
  // has to look the same every run, and `Math.random` in a texture is how you
  // get a bug that only reproduces one time in twenty.
  const cells = [
    [6, 5, 7], [22, 3, 5], [38, 7, 8], [54, 4, 6], [13, 14, 6], [30, 16, 9],
    [47, 13, 5], [59, 17, 7], [3, 24, 8], [19, 27, 6], [36, 29, 7], [51, 25, 5],
    [10, 37, 6], [26, 39, 8], [43, 36, 6], [58, 40, 7], [5, 49, 7], [21, 52, 5],
    [34, 48, 8], [49, 54, 6], [61, 50, 5], [14, 60, 6], [30, 61, 7], [45, 62, 5],
  ];
  cells.forEach(([x, y, r], i) => {
    ctx.fillStyle = tones[i % tones.length];
    // Drawn four times, wrapped, so a blob crossing an edge comes back on the
    // other side and the page tiles seamlessly.
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  return toTexture(canvas, { wrapS: RepeatWrapping, wrapT: RepeatWrapping });
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
 * 입구에서 터지는 것. 128x64 한 장에 두 프레임.
 *
 * ── 각진 삼각 가시에서 뿜어지는 빛으로 ─────────────────────────────────────
 * 예전 것은 하드 엣지 삼각형 여섯 개와 아홉 개, 그리고 채워진 원이었다. 브리프가
 * "저해상도 스프라이트 1~2프레임" 을 허용하고 파티클 시스템을 배제한 것이 근거였고,
 * 프레임 수는 여전히 옳다 — 이 일은 10분의 1초 만에 끝난다.
 *
 * 각진 것이 틀렸다. 탄산이 터지는 것은 **액체와 빛**이지 파편이 아니다. 같은 두
 * 프레임을 부드러운 방사 스프레이로 다시 그린다: 뜨거운 심, 거기서 뻗는 가는
 * 빛줄기, 그리고 함께 튀어 오르는 작은 방울들.
 *
 * 방울이 요점이다. 빛만 있으면 폭발이고, 방울이 섞여야 **탄산**이다 — 병에서
 * 올라오던 거품과 같은 것이 한꺼번에 터져 나온 것으로 읽힌다.
 */
export function burstSheet() {
  const { canvas, ctx } = makeCanvas(128, 64);
  ctx.clearRect(0, 0, 128, 64);
  const B = PALETTE.additive.burst;

  /** 가운데에서 뻗는 빛줄기. 끝으로 갈수록 얇아지고 사라진다. */
  const rays = (cx, cy, count, r0, r1, width, colour, phase) => {
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      const g = ctx.createLinearGradient(r0, 0, r1, 0);
      g.addColorStop(0, withAlpha(colour, 0.85));
      g.addColorStop(0.45, withAlpha(colour, 0.4));
      g.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(r0, -width);
      ctx.quadraticCurveTo((r0 + r1) / 2, -width * 0.3, r1, 0);
      ctx.quadraticCurveTo((r0 + r1) / 2, width * 0.3, r0, width);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  /** 뜨거운 심. 빛줄기가 여기서 나오는 것으로 보여야 한다. */
  const core = (cx, cy, r, colour) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, withAlpha(colour, 1));
    g.addColorStop(0.35, withAlpha(colour, 0.62));
    g.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  /**
   * 튀어 오른 방울들.
   *
   * ── 속이 빈 테로 그렸다가 되돌렸다 ────────────────────────────────────────
   * 병 안의 거품과 같은 것이니 같은 방식(테 + 정반사 + 빈 가운데)으로 그렸는데,
   * 반지름이 2~3 텍셀이라 테가 테로 읽히지 않았다 — 작은 "o" 자국이 흩어진 것처럼
   * 보였고, 그건 방울이 아니라 지저분함이다.
   *
   * 이 크기에서는 **채운다**. 날아가는 방울은 어차피 흐려지고, 눈이 찾는 것은 형태가
   * 아니라 반짝임이다. 크기도 키웠다: 3 텍셀짜리 방울은 어떤 방식으로 그려도 점이다.
   */
  const drops = (cx, cy, list, colour) => {
    for (const [dx, dy, dr] of list) {
      const x = cx + dx;
      const y = cy + dy;
      const g = ctx.createRadialGradient(x, y, 0, x, y, dr);
      g.addColorStop(0, withAlpha(PALETTE.additive.bubble.glint, 0.95));
      g.addColorStop(0.42, withAlpha(colour, 0.6));
      g.addColorStop(1, withAlpha(colour, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, dr, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // 프레임 0: 터지는 순간. 심이 밝고 줄기는 아직 짧다.
  core(32, 32, 13, B.popCore);
  rays(32, 32, 7, 5, 27, 4.5, B.popWide, 0);
  rays(32, 32, 5, 4, 17, 3, B.popTight, Math.PI / 6);
  drops(32, 32, [[-14, -10, 5.5], [12, -13, 4.6], [5, 15, 4], [-9, 13, 3.4]], B.popWide);

  // 프레임 1: 흩어지는 순간. 심은 식고 줄기는 길고 가늘어졌으며 방울이 멀리 갔다.
  core(96, 32, 7, B.sprayCore);
  rays(96, 32, 10, 10, 31, 2.6, B.sprayWide, 0.2);
  rays(96, 32, 6, 7, 22, 2, B.sprayTight, 0.9);
  drops(
    96,
    32,
    [[-21, -15, 4.4], [18, -18, 3.8], [8, 22, 3.4], [-15, 19, 3], [25, 7, 2.6]],
    B.sprayWide,
  );

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
        text: PALETTE.ui.textOnAccent,
        rule: PALETTE.ui.textOnAccent,
        accent: PALETTE.ui.textOnAccent,
      }
    : null;

  roleButton(ctx, {
    x: 0,
    y: 0,
    w: width,
    h: height,
    radius: RADIUS.chip,
    role,
    state: skinState,
    skin: waterSkin,
    selected,
    label,
    // 도장이 오른쪽을 먹으므로 라벨은 남은 왼쪽에서 가운데를 잡는다.
    labelWidth: width - stampW,
    /**
     * ── 여기에 그림자가 있었고, 두 번 없어졌다 ─────────────────────────────
     * 처음에는 이 판이 10 픽셀 번지고 3 픽셀 내려가는 그림자를 지고 있었는데,
     * 캔버스가 판에 딱 맞으므로 그 번짐이 네 변에서 직선으로 잘렸다 — 둥근 판
     * 주위에 사각형 자국이 남았고 화면에서 제일 눈에 띄는 결함이었다. 캔버스를
     * 키우는 것이 다른 답이고, 그러려면 판 쿼드도 같이 커져 슬롯 밖으로 나간다.
     *
     * 그래서 이 판만 그림자를 뺐다. 두 번째로 없어진 것은 그림자라는 개념
     * 자체이고(§19 · §24), 그때 판도 같이 없어졌다 — 지금 여기 있는 것은 글자와
     * 밑줄이다. 이 주석이 남는 이유는 캔버스를 판에 딱 맞추는 규칙이 그대로이고,
     * 무엇이든 판 밖으로 번지는 것을 다시 넣으면 같은 사각형 자국이 돌아오기
     * 때문이다.
     */
  });

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
  dialogPanel(ctx, { w, h, title, caption, tabHeight, footerHeight, padTop, padX, divider });
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
 * 아이콘 버튼 한 장. 라벨 없이 그림만.
 *
 * ── RETREAT 계열 시각인 이유 ────────────────────────────────────────────────
 * 부록 B3.2 가 그렇게 정했고, 근거가 있다: 이 둘(설정·내 마크)은 게임을 시작하지
 * 않는다. 메인 메뉴에 온 사람이 하려는 것은 모드를 고르는 것이고, 이 둘은 필요할
 * 때만 찾는 것이다. **채워지지 않고 떠 있지 않은** 모양이 그 사실을 말한다 —
 * 열의 세 판은 떠 있고 이 둘은 평평하다.
 *
 * 툴팁은 없다. 터치 기기에 호버가 없으므로 툴팁은 절반의 사용자에게 존재하지 않는
 * 설명이고, 존재하지 않을 수 있는 설명에 의미를 맡길 수 없다. 그래서 그림이 혼자
 * 서야 하고, `icons.js` 의 두 주석이 왜 그 그림이어야 하는지 적고 있다.
 */
export function iconPlateTexture(icon, state = 'idle', { size = 64, scale = 1, onWater = false } = {}) {
  const { canvas, ctx } = makeCanvas(Math.round(size * scale), Math.round(size * scale));
  ctx.scale(scale, scale);

  /**
   * ── the plate is gone, and the name is kept ─────────────────────────────
   * This drew a `roleButton` behind the icon and then the icon on top. PHASE 4's
   * audit removed it: two rounded squares under two icons at the foot of the
   * home column are §24's "generic rounded UI cards" in the one place the page
   * is supposed to be quietest, and the icons are already different shapes from
   * each other, so the plate contributed nothing to telling them apart.
   *
   * The function keeps its name because what it makes is still a texture for an
   * icon BUTTON — the hit quad is the mesh, and that is unchanged. Renaming it
   * would touch four call sites to say the same thing.
   *
   * `hover` and `pressed` fold to `idle` in `skinFor` (the menu's plates react
   * to nothing), so the two baked states differ only for `disabled`. That is
   * kept rather than collapsed: `disabled` is a state of the thing.
   */
  const SKIN_STATE = { active: 'pressed', dimmed: 'disabled' };
  const skin = skinFor(SKIN_STATE[state] ?? state);

  const inner = size * 0.62;
  ctx.globalAlpha = skin.alpha;
  drawIcon(ctx, icon, {
    x: (size - inner) / 2,
    y: (size - inner) / 2,
    size: inner,
    // 열과 같은 이유로 뒤집힌다 — 이 아이콘도 종이가 아니라 물 위에 앉는다.
    // `menuPlateTexture` 의 `onWater` 주석에 실측이 있다.
    color: onWater ? PALETTE.ui.textOnAccent : skin.text,
  });
  ctx.globalAlpha = 1;

  const tex = toTexture(canvas);
  tex.userData = { width: size, height: size };
  return tex;
}


/**
 * 내비의 표식. 지금 가리키는 항목 옆에 서는 작은 고리.
 *
 * §20 의 어휘에서 `○` 하나를 골라 쓴다. 이것이 스프라이트인 이유는 항목 사이를
 * **미끄러져야** 하기 때문이다 — 텍스처에 그려 넣으면 항목마다 굽고 지워야 하고,
 * 그러면 움직일 수 없다. 움직이는 것은 지오메트리여야 한다.
 */
export function navMarkerTexture({ size = 12, scale = 2 } = {}) {
  const px = Math.round(size * scale);
  const { canvas, ctx } = makeCanvas(px, px);
  ctx.scale(scale, scale);
  ring(ctx, size / 2, size / 2, size / 2 - RULE.thin, RULE.thin, PALETTE.ui.textOnAccent);
  const tex = toTexture(canvas);
  tex.userData = { width: size, height: size };
  return tex;
}

/**
 * 물에 잠기는 제목. 두 줄로 쌓고, 프레임에 잘리도록 크게 굽는다.
 *
 * ── 없어진 `homeTitleTexture` 를 대신한다 ──────────────────────────────────
 * 저쪽은 한 줄이었고 열의 머리글로 판 안에 **들어가도록** em 을 줄였다. 이 구조
 * 에서 제목은 열의 일부가 아니라 화면을 가로지르는 오브제이고, 프레임에 잘리는
 * 것이 구조다 — 들어가야 한다는 전제가 사라졌으므로 그 함수도 같이 없앴다.
 *
 * 잉크가 흰색인 것은 이 화면에서 파랑이 지면이기 때문이다. 종이에 잉크가 아니라
 * 물에 빛이다. 화면에 나갈 때의 실제 색은 `SubmergedTitle` 의 셰이더가 정한다 —
 * 여기서 굽는 것은 **모양**뿐이고 셰이더는 알파만 읽는다.
 *
 * 둘째 줄을 들여쓰는 것은 레퍼런스의 계단식 배치다. 두 줄을 왼쪽으로 맞추면
 * 블록이 되고, 어긋내면 흐름이 생긴다.
 */
export function submergedTitleTexture({ size = 120, scale = 1 } = {}) {
  /**
   * 상자를 **글자에서** 잰다. 받지 않는다.
   *
   * 폭을 밖에서 주면 글자가 그 안 어디에 앉는지를 부르는 쪽이 알 수 없고,
   * 실측으로 그것 때문에 블록이 화면 왼쪽으로 통째로 빠졌다. 여기서 재서
   * `userData` 로 돌려주면 배치하는 쪽은 상자만 놓으면 된다.
   */
  const tracking = -size * 0.03;
  const indent = size * 0.62;
  const pad = size * 0.16;
  const w1 = letteringWidth('한여름', size, tracking);
  const w2 = indent + letteringWidth('알까기', size, tracking);
  const width = Math.round(Math.max(w1, w2) + pad * 2);
  const height = Math.round(size * 1.82 + pad * 2);

  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);

  drawLettering(ctx, '한여름', {
    x: pad, y: pad, size, color: PALETTE.ui.textOnAccent, tracking, align: 'left',
  });
  drawLettering(ctx, '알까기', {
    x: pad + indent, y: pad + size * 0.82, size, color: PALETTE.ui.textOnAccent, tracking, align: 'left',
  });

  const tex = toTexture(canvas);
  tex.userData = { width, height };
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
  if (withPlate) {
    panel(ctx, {
      x: 0,
      y: 0,
      w: width,
      h: height,
      radius: RADIUS.panel,
      accent: PALETTE.cobalt,
    });
  }

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
      x: width / 2,
      y,
      font: lines.font,
      color: PALETTE.ui.text,
      align: 'center',
    });
    y += headSize + gap;
  }
  applyTracking(ctx, 0);

  if (sub) {
    const line = fitText(probe.ctx, sub, subType, room);
    applyTracking(ctx, subType.tracking);
    drawText(ctx, {
      text: line.text,
      x: width / 2,
      y: y - gap + SPACE.xs,
      font: line.font,
      color: PALETTE.ui.textMuted,
      align: 'center',
    });
    applyTracking(ctx, 0);
  }

  const tex = toTexture(canvas);
  tex.userData = { width, height };
  return tex;
}

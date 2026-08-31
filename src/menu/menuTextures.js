import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { PALETTE, withAlpha } from '../core/palette.js';
import { ELEVATION, RADIUS, SPACE, TYPE } from '../core/tokens.js';
import {
  applyTracking,
  fitText,
  fontSpec,
  gelButton,
  glassPanel,
  skinFor,
} from '../ui/glass.js';

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
   * 흰 타원 하나. 그게 전부다.
   *
   * ── 한때 인쇄물 흉내를 냈고, 그건 과했다 ─────────────────────────────────
   * 아치형 라틴 문자, 가운데 왕관 뚜껑 일러스트, 한글 제목, 하단 미세 인쇄 밴드까지
   * 얹혀 있었다. 라벨은 화면에서 세로 200픽셀 남짓이고 그 위에 유리 한 겹과 블룸이
   * 올라가므로, 요소를 넣을수록 읽히는 게 아니라 지저분해진다. 지금은 종이 한 장이고,
   * 그 위에서 빛나는 건 앞에 있는 유리가 맡는다.
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

  return toSmoothTexture(canvas);
}

/**
 * The shadow under the bottle: one dark ellipse, in hard steps.
 *
 * Not a rendered shadow, and not because one would be hard — a real one needs a
 * light, a caster, a receiver and a depth pass to produce a dark blob on the
 * floor. That IS the blob. The same argument `CardMaterial` makes about the
 * offset quad behind a card.
 */
export function shadowTexture() {
  const size = 64;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  // A deep blue-grey rather than black, at the same four opacities. The alphas
  // are the falloff's shape and stay here; only the ink moved to the palette.
  const steps = [
    [0.5, withAlpha(PALETTE.menu.shadow, 0.62)],
    [0.68, withAlpha(PALETTE.menu.shadow, 0.4)],
    [0.86, withAlpha(PALETTE.menu.shadow, 0.19)],
    [1.0, withAlpha(PALETTE.menu.shadow, 0.07)],
  ];
  for (let i = steps.length - 1; i >= 0; i--) {
    ctx.fillStyle = steps[i][1];
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size / 2) * steps[i][0], 0, Math.PI * 2);
    ctx.fill();
  }
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
 * The cap's top: the game's logo, on the disc that fills the screen.
 *
 * ── it replaces the placeholder, and only where it should ───────────────────
 * `cap/capTexture.js` draws a generic panel — concentric rings, eight spokes and
 * an orientation mark — and that is still exactly right for the PLAYING pieces,
 * which are a customisable slot for a player's own artwork, and for the phase-1
 * viewer, whose spoke is a debugging aid for watching the UVs spin. Neither
 * wants the game's name stamped on it. This one is for the menu's bottle and
 * for the cap that covers the screen, which do.
 *
 * ── the design is sized for ONE frame ───────────────────────────────────────
 * At the covered frame the panel's radius is the frame's half-DIAGONAL, so the
 * part you actually see is the largest 4:3 rectangle inside the disc — about
 * 102 by 77 of these 128 texels. Everything that has to be read therefore lives
 * inside that box, and everything outside it (the rim rings) exists only for
 * the other end of the scale, where this is a twelve-pixel dot on a bottle.
 *
 * Draw the logo out to the disc's edge instead and the covering frame crops the
 * first and last letters off every line.
 *
 * ── it is the label's design, made round ────────────────────────────────────
 * Same red, same sheared white grotesque, same stacked lockup, same rule above
 * and below. The rules are concentric ARCS rather than the label's parabolas,
 * because on a disc that is what "follows the curvature" means. Nothing here is
 * anyone's trademark: a red cap with white type on it is the whole of it.
 */
export function capLogoTexture(texels = 512) {
  /**
   * 좌표는 128 기준으로 저술되고, 캔버스에 배율을 건다.
   *
   * ── 왜 512 로 굽나 ──────────────────────────────────────────────────────
   * 이 그림은 이 프로젝트에서 유일하게 말도 안 되게 확대되는 텍스처다. 캡 와이프의
   * 덮인 프레임에서 뚜껑 윗면이 화면을 채우므로 800 프레임 픽셀쯤 된다. 128 텍셀로
   * 구우면 6배 확대이고, 실제로 화면에 계단진 글자가 그대로 보였다.
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

  // The corners are never sampled — the panel is the inscribed circle — but
  // filling them costs nothing and means a rounding error at the rim cannot
  // pick up a transparent texel.
  ctx.fillStyle = PALETTE.menu.labelRed;
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

  // Rim. Outside the covering frame's crop and invisible there — this is the
  // half of the design that only ever shows on the bottle.
  ring(60, 3, PALETTE.menu.labelRedDeep);
  ring(52, 2, PALETTE.menu.labelRedLight);

  // The two rules, inside the crop so they frame the wordmark at full cover.
  arc(37, 2, 202, 338, PALETTE.menu.labelCreamAlt);
  arc(37, 2, 22, 158, PALETTE.menu.labelCreamAlt);

  drawText(ctx, {
    text: 'BOTTLE',
    x: c,
    y: 54,
    font: fontSpec({ size: 15, weight: 700 }),
    color: PALETTE.menu.labelCream,
    align: 'center',
    slant: 0.22,
  });
  drawText(ctx, {
    text: 'CAP',
    x: c,
    y: 76,
    font: fontSpec({ size: 22, weight: 700 }),
    color: PALETTE.menu.labelCream,
    align: 'center',
    slant: 0.22,
  });
  drawText(ctx, {
    text: 'CHAOS',
    x: c,
    y: 92,
    font: fontSpec({ size: 13, weight: 700 }),
    color: PALETTE.menu.labelGold,
    align: 'center',
    slant: 0.22,
  });

  /**
   * 밉맵을 켠다. 이 그림은 축소와 확대를 **둘 다** 겪는 유일한 텍스처다 — 캡
   * 와이프에서는 800 픽셀로 커지고, 병 위에서는 열두 픽셀짜리 점이 된다. 밉이
   * 없으면 후자에서 텍셀 행이 통째로 버려진다(`core/textures.js` 머리말).
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
 * 셋의 관계가 Frutiger Aero 의 물방울 그 자체다. 하나라도 빠지면 원이 되고, 넷이
 * 되면 유리구슬 렌더가 된다 — 여기 크기에서는 후자가 그냥 지저분해진다.
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
 * 메뉴 항목의 판. 젤 버튼이다.
 *
 * ── 왼쪽 세로 막대가 없어졌다 ───────────────────────────────────────────────
 * 예전 판은 각진 사각형에 2px 테두리, 왼쪽 가장자리에 상태를 알리는 세로 막대가
 * 있었다. 막대의 근거는 "글씨보다 멀리서 읽힌다" 였고 각진 판에서는 맞았지만,
 * 젤 버튼은 몸통 전체가 상태에 따라 밝아지므로 같은 일을 더 크게 한다. 라운드
 * 카드에 색 레일을 붙인 모양은 지금 어디서나 보이는 기본값이기도 하다.
 *
 * 라벨은 가운데다. 왼쪽 정렬은 막대가 있을 때 그 옆에 붙는 것이었고, 막대가
 * 사라지면 왼쪽에 이유 없는 여백만 남는다.
 *
 * @param {string} label
 * @param {'idle'|'hover'|'pressed'|'selected'|'disabled'|'dimmed'} state
 */
export function menuPlateTexture(label, state, { width = 256, height = 52, scale = 1 } = {}) {
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
   * `dimmed` 는 판정이 빠진 `disabled` 다.
   *
   * ── 두 문장이 한 껍데기를 입고 있었다 ─────────────────────────────────
   * `disabled` 는 오른쪽에 "준비 중"을 찍는다. 그건 **기능이 아직 없다**는 말이고,
   * AI 없는 모드에는 맞지만 지금 이 순간만 못 누르는 줄에는 틀리다. 온라인 화면은
   * 이미 대기열에 들어간 동안 방 만들기 / 코드로 참가 / 랜덤 매칭 셋을 흐리는데,
   * 셋 다 자기가 미완성 기능이라고 말하고 있었다.
   *
   * 같은 색, 도장 없음. 어느 문장인지는 호출부가 고른다.
   */
  /**
   * 호출부의 상태 이름을 `skinFor` 의 어휘로 옮긴다.
   *
   * 메뉴는 `active` 와 `dimmed` 라는 이름을 쓰고 `skinFor` 는 `pressed` 와
   * `disabled` 를 안다. 이 표가 없으면 둘 다 `default` 로 떨어져 idle 로 그려진다 —
   * 눌러도 반응이 없고 흐려져야 할 줄이 멀쩡해 보이는데, 어느 쪽도 오류를 내지
   * 않으므로 화면을 봐야만 안다.
   */
  const SKIN_STATE = { active: 'pressed', dimmed: 'disabled' };
  const skinState = SKIN_STATE[state] ?? state;
  const skin = skinFor(skinState, PALETTE.accent.sky);

  /**
   * 모서리는 **끝까지** 둥글다. `RADIUS.panel`(20) 이었다.
   *
   * ── 20 은 큰 화면에서 애매해진다 ────────────────────────────────────────
   * 이 판은 가로로 길다 — 저술 크기가 256x52 이고, 화면이 커지면 그 비율 그대로
   * 커진다. 고정 반경은 판이 커질수록 **상대적으로** 작아지므로, 작은 창에서
   * 둥글어 보이던 것이 큰 창에서는 모서리만 살짝 깎인 사각형이 된다. 둥근 것도
   * 각진 것도 아닌 상태이고, 그게 애매함의 정체다.
   *
   * `RADIUS.pill` 은 9999 이고 `roundRectPath` 가 `min(r, w/2, h/2)` 로 죈다 —
   * 즉 언제나 높이의 절반이다. 판이 얼마나 커지든 양 끝이 반원인 알약이고, 비율이
   * 바뀌지 않으므로 어느 크기에서도 같은 물건으로 보인다.
   *
   * 제목판(`titleTexture`)은 그대로 `RADIUS.panel` 이다. 누를 수 없는 것과 누를 수
   * 있는 것이 다른 모양이어야 하고, 이제 그 구분이 반경 하나로 선다.
   */
  gelButton(ctx, {
    x: 0,
    y: 0,
    w: width,
    h: height,
    radius: RADIUS.pill,
    state: skinState,
    accent: PALETTE.accent.sky,
  });

  /**
   * 라벨은 판에 **맞춰** 줄어든다.
   *
   * ── 형제 함수에 있던 것과 같은 결함 ──────────────────────────────────
   * `titleTexture` 의 주석에 "BOTTLE CAP CHAOS" 가 화면에 "BOTTLE CAP CHA" 로
   * 도착했다는 기록이 있다. 이쪽에는 같은 처리가 없어서 같은 결함이 대기하고
   * 있었다: 고정 크기 라벨이 오른쪽 가장자리 밖으로 조용히 흘러나갔고, 말줄임도
   * 없고 뭔가 빠졌다는 표시도 없었다.
   *
   * 매칭 화면에서 드러났다. 상태 줄이 "상대를 찾는 중  0:12" 인데 그 줄에서
   * 유일하게 변하는 부분인 경과 시간이 통째로 판 밖에 있었다. "시간이 다 짤려서
   * 하나도 안보여" 로 보고됐다.
   *
   * `fitText` 가 크기를 줄이고, 그래도 안 되면 자른다. 판정 도장이 있는 줄은
   * 그만큼 자리를 덜 쓴다.
   */
  const stamp = state === 'disabled' ? '준비 중' : '';
  const probe = makeCanvas(8, 8);
  applyTracking(probe.ctx, TYPE.label.tracking);
  let stampW = 0;
  if (stamp) {
    probe.ctx.font = fontSpec(TYPE.caption);
    stampW = probe.ctx.measureText(stamp).width + SPACE.md;
  }
  /**
   * 좌우 여백. 알약이므로 높이에 비례한다.
   *
   * `SPACE.lg * 2` 를 고정으로 쓰면 640 프레임의 256 폭 판에서는 28% 지만 421
   * 프레임의 168 폭 판에서는 43% 다 — 실제로 "마스터 볼륨   70%" 가 "마스터 볼륨
   * 7..." 이 됐다. 둥근 끝이 먹는 공간은 폭이 아니라 **높이**를 따라가므로, 여백도
   * 높이를 따라가는 것이 맞다.
   */
  const pad = Math.max(SPACE.sm, height * 0.45);
  const room = width - pad * 2 - stampW;
  const fitted = fitText(probe.ctx, label, TYPE.label, room);

  ctx.save();
  ctx.font = fitted.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  applyTracking(ctx, TYPE.label.tracking);
  const cx = (width - stampW) / 2;
  // 타입 밑의 1픽셀 흰 그림자. `gelButton` 이 자기 라벨에 쓰는 것과 같은 엠보스다.
  ctx.fillStyle = withAlpha(PALETTE.ui.glossHi, 0.35);
  ctx.fillText(fitted.text, cx, height / 2 + 1);
  ctx.fillStyle = skin.text;
  ctx.fillText(fitted.text, cx, height / 2);
  applyTracking(ctx, 0);
  ctx.restore();

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
 * 메뉴 열 위의 제목판, 그리고 설정 화면의 머리글.
 *
 * ── 유리판이 생겼다 ────────────────────────────────────────────────────────
 * 예전에는 `clearRect` 로 투명하게 두고 흰 글씨를 배경 위에 얹었다. 판이 없으니
 * 잉크가 흰색일 수밖에 없었고, 그 아래 빨간 줄 하나가 유일한 구조였다. 이제 판이
 * 있으므로 두 줄 다 `ui.text` 로 돌아간다 — 이 함수의 옛 주석이 PHASE 6 에서
 * 그렇게 될 것이라고 적어 둔 그대로다.
 */
export function titleTexture(text, sub, { width = 256, height = 80, scale = 1 } = {}) {
  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);

  glassPanel(ctx, {
    x: 0,
    y: 0,
    w: width,
    h: height,
    radius: RADIUS.panel,
    accent: PALETTE.accent.cyan,
    elevation: ELEVATION.raised,
  });

  /**
   * 머리글은 줄이기 전에 **접는다**.
   *
   * ── 실측 ────────────────────────────────────────────────────────────────
   * 판이 168 폭일 때 안쪽 여백을 빼면 124 가 남는다. "BOTTLE CAP CHAOS" 는 26px
   * 에서 255, 최소 크기인 20px 에서도 196 이라 한 줄로는 어떤 크기에서도 안
   * 들어간다 — `fitText` 만 쓰면 "BOTTLE..." 이 된다.
   *
   * 두 줄로 접으면 "BOTTLE CAP" 이 20px 에서 121 로 들어간다. 제목은 스캔하는
   * 것이 아니라 한 번 읽는 것이므로, 작은 한 줄보다 온전한 두 줄이 낫다.
   * 단어 경계에서만 접고, 두 줄로도 안 되면 그때 `fitText` 가 줄이거나 자른다.
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
    const probeLines = wrapToFit(probe.ctx, text, TYPE.title, room, 2);
    const rows = probeLines.rows.length;
    const need =
      rows * TYPE.title.size +
      (rows - 1) * Math.round(TYPE.title.size * 0.18) +
      (sub ? TYPE.caption.size + SPACE.xs : 0) +
      SPACE.sm * 2;
    return Math.max(0.55, Math.min(1, height / Math.max(1, need)));
  })();
  const titleType = { ...TYPE.title, size: Math.round(TYPE.title.size * fitK) };
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

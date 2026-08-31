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
function toTexture(canvas, { wrapS = ClampToEdgeWrapping, wrapT = ClampToEdgeWrapping } = {}) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
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
export function capLogoTexture() {
  const size = 128;
  const c = size / 2;
  const { canvas, ctx } = makeCanvas(size, size);
  const scratch = makeCanvas(size, size);

  // The corners are never sampled — the panel is the inscribed circle — but
  // filling them costs nothing and means a rounding error at the rim cannot
  // pick up a transparent texel.
  ctx.fillStyle = PALETTE.menu.labelRed;
  ctx.fillRect(0, 0, size, size);

  const ring = (radius, thickness, color) => {
    ctx.fillStyle = color;
    const steps = 360;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ctx.fillRect(
        Math.round(c + Math.cos(a) * radius),
        Math.round(c + Math.sin(a) * radius),
        thickness,
        thickness,
      );
    }
  };

  /** Hard-pixel arc. `ctx.arc` with a stroke would antialias the ends. */
  const arc = (radius, thickness, fromDeg, toDeg, color) => {
    ctx.fillStyle = color;
    const steps = 220;
    for (let i = 0; i <= steps; i++) {
      const a = ((fromDeg + (toDeg - fromDeg) * (i / steps)) * Math.PI) / 180;
      ctx.fillRect(
        Math.round(c + Math.cos(a) * radius),
        Math.round(c + Math.sin(a) * radius),
        thickness,
        thickness,
      );
    }
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
    font: 'bold 15px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelCream,
    align: 'center',
    slant: 0.22,
  });
  drawText(ctx, {
    text: 'CAP',
    x: c,
    y: 76,
    font: 'bold 22px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelCream,
    align: 'center',
    slant: 0.22,
  });
  drawText(ctx, {
    text: 'CHAOS',
    x: c,
    y: 92,
    font: 'bold 13px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelGold,
    align: 'center',
    slant: 0.22,
  });

  return toTexture(canvas);
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
 * One bubble, as a sprite.
 *
 * A bubble in a dark drink is not a white dot. It is a lens: the light that
 * reaches your eye comes round the EDGE of it, so what you see is a bright ring
 * with a dimmer middle, plus one hard glint where the key light reflects off
 * the top of the sphere. Painting it as a filled disc is what makes CG fizz
 * look like grains of rice.
 *
 * Sixteen texels, because the thing is two to seven pixels across on screen and
 * anything more detailed than this is a decision the framebuffer will not
 * record. Added, so the black surround contributes nothing.
 */
export function bubbleTexture() {
  const size = 16;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = PALETTE.additiveZero;
  ctx.fillRect(0, 0, size, size);

  const c = size / 2;
  // The rim, then the middle knocked back out of it.
  ctx.fillStyle = PALETTE.additive.bubble.rim;
  ctx.beginPath();
  ctx.arc(c, c, 6.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.additive.bubble.mid;
  ctx.beginPath();
  ctx.arc(c, c, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.additive.bubble.core;
  ctx.beginPath();
  ctx.arc(c, c, 2.6, 0, Math.PI * 2);
  ctx.fill();
  // The glint, up and to the left, matching the scene's key.
  ctx.fillStyle = PALETTE.additive.bubble.glint;
  ctx.fillRect(c - 3, c - 4, 2, 2);

  return toTexture(canvas);
}

/**
 * The burst at the mouth. Two frames side by side in one 128x64 page.
 *
 * Two frames is the whole animation: a tight star, then a wider ragged ring.
 * The brief allows "저해상도 스프라이트 1~2프레임" and rules out a particle
 * system, and there is nothing a hundred quads would say here that these two do
 * not — the fizz is over in a tenth of a second.
 */
export function burstSheet() {
  const { canvas, ctx } = makeCanvas(128, 64);
  ctx.clearRect(0, 0, 128, 64);

  /** Radial spikes, hard-edged, drawn as triangles. */
  const spikes = (cx, cy, count, r0, r1, width, color, phase) => {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(r0, -width);
      ctx.lineTo(r1, 0);
      ctx.lineTo(r0, width);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  // Frame 0: the pop.
  spikes(32, 32, 6, 4, 26, 5, PALETTE.additive.burst.popWide, 0);
  spikes(32, 32, 6, 3, 15, 4, PALETTE.additive.burst.popTight, Math.PI / 6);
  ctx.fillStyle = PALETTE.additive.burst.popCore;
  ctx.beginPath();
  ctx.arc(32, 32, 7, 0, Math.PI * 2);
  ctx.fill();

  // Frame 1: the spray, wider and already breaking up.
  spikes(96, 32, 9, 10, 30, 3, PALETTE.additive.burst.sprayWide, 0.2);
  spikes(96, 32, 5, 6, 20, 3, PALETTE.additive.burst.sprayTight, 0.9);
  ctx.fillStyle = PALETTE.additive.burst.sprayCore;
  ctx.beginPath();
  ctx.arc(96, 32, 4, 0, Math.PI * 2);
  ctx.fill();

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

  gelButton(ctx, {
    x: 0,
    y: 0,
    w: width,
    h: height,
    radius: RADIUS.panel,
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

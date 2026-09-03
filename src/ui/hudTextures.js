import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from 'three';
import { darken, PALETTE, withAlpha } from '../core/palette.js';
import { registerTextureCache } from './fonts.js';
import { ELEVATION, PANEL, RADIUS, SIZE, SPACE, TYPE } from '../core/tokens.js';
import {
  applyTracking,
  fitText,
  focusRing,
  fontSpec,
  dialogPanel,
  gelButton,
  glassPanel,
  roleButton,
  roleSkin,
  skinFor,
} from './glass.js';
import { drawIcon } from './icons.js';

/**
 * Every plate the HUD draws, as a canvas texture.
 *
 * ── the cache is not an optimisation, it is the rule ────────────────────────
 * A score plate is a handful of canvas calls and four `getImageData` round
 * trips for the thresholding. Once per score change that is free; once per
 * frame it is a stall you can measure, and it would also mean uploading a new
 * texture to the GPU sixty times a second to show the same two digits. So
 * everything here is keyed by exactly the content that is drawn on it, and the
 * layer above asks for a texture every frame and gets the same object back
 * until something it can actually see has changed.
 *
 * ── one texel per framebuffer pixel ─────────────────────────────────────────
 * Sizes are given in FRAME units, and the frame is the overlay's virtual
 * 640x480 — the same box `CardLayer` lays out in. At the default 640x480 render
 * target that is one texel on one pixel, which is the whole reason the type
 * survives: `crispText` thresholds every glyph's alpha to fully on or fully
 * off, and a texture resampled on its way to the screen averages that straight
 * back into the grey fringing it was thresholded to avoid.
 *
 * `scale` is the panel's texture-resolution dial. It multiplies the texel count
 * without moving the plate, so 2 authors at twice the density and lets the
 * hardware minify — which is the wrong thing for legibility and exactly why it
 * defaults to 1 and is exposed as a knob rather than a setting.
 */


const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
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
function toTexture(canvas) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 1;
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
 * 없다. 지금은 그냥 안티에일리어싱된 글자가 그대로 화면에 간다.
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
 * The plate, its border and its type.
 *
 * These three were a near-black, a slate border and a pale grey, and every other
 * colour in this file was chosen against them. They are a white plate, a soft
 * blue-grey border and a dark navy ink now, and the inversion is genuinely an
 * inversion rather than a swap: the hover state used to LIGHTEN the plate to
 * separate itself from the idle one, and lightening a white plate does nothing.
 * Hover is now a pale cyan wash with a cyan border, which is the same idea —
 * "the marker bar and the border change, the ground behind the type barely
 * does" — carried onto a light scheme.
 */
const TEXT = PALETTE.ui.text;

/** The four pressable states, shared with the menu and the mark editor. */
const BTN = PALETTE.button;

/**
 * The scoreboard.
 *
 * ── it is handed its content, it does not work it out ───────────────────────
 * `board` comes from the MODE (see `modes.js`). Nothing in this file knows what
 * a goal is or what a surviving cap is, and there is no branch here on which
 * game is being played — football's headline is a score, knockout's is a count
 * of what is left alive, and both arrive as the same two coloured strings.
 *
 * Put a mode check in here and the next mode needs a third one.
 *
 * ── the numbers are as big as the plate allows ──────────────────────────────
 * They are the one thing on screen that has to be readable at a glance from
 * across a 640x480 frame, so they get 26 of the plate's 42 pixels and the
 * caption gets what is left. Each is drawn in its OWN player ink, and that ink
 * is the whole of the colour coding — the pair of solid bars down the outer
 * edges said the same thing a second time and have gone.
 *
 * 42 tall and not the 64 it started at, because of what is above and below it
 * on a knockout board — see the band `HudLayer.layout` has to fit it into.
 */
export function scorePlateTexture(board, { width, height, scale = 1 }) {
  const key = `score:${board.key}:${width}x${height}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  /**
   * 프레임 좌표로 그린다.
   *
   * 캔버스를 `scale` 배로 만들고 컨텍스트에 같은 배수를 걸어 두면, 아래 모든
   * 숫자가 `tokens.js` 의 프레임 픽셀 그대로가 된다. 예전에는 `u(n)` 로 하나씩
   * 곱했는데, 그러면 토큰 값과 코드의 숫자가 달라 보여서 대조가 안 된다.
   */
  ctx.scale(scale, scale);
  const fw = width;
  const fh = height;

  glassPanel(ctx, { x: 0, y: 0, w: fw, h: fh, radius: RADIUS.panel });

  /**
   * 팀 색 바는 없다. 색은 **숫자 자체**가 말한다.
   *
   * 예전에는 양쪽 바깥 가장자리에 팀 색 막대가 한 줄씩 서 있었다. 그것이 하던
   * 일 — 어느 쪽 숫자가 누구 것인지 — 은 `inkFor` 가 숫자를 그 팀의 잉크로
   * 칠하는 것으로 이미 되어 있고, 두 번 말하는 쪽이 막대였다. 알파 이진화를
   * 걷어낸 뒤로는 44px 숫자의 색조가 그대로 살아 나오므로, 막대가 보험이던
   * 이유(양자화가 두 색을 뭉갠다)도 남아 있지 않다.
   */

  const mid = fw / 2;
  const numberY = fh * 0.56;
  applyTracking(ctx, TYPE.display.tracking);
  drawText(ctx, {
    text: board.left.value,
    x: mid - SPACE.md,
    y: numberY,
    font: fontSpec(TYPE.display),
    color: inkFor(board.left.color),
    align: 'right',
  });
  drawText(ctx, {
    text: board.right.value,
    x: mid + SPACE.md,
    y: numberY,
    font: fontSpec(TYPE.display),
    color: inkFor(board.right.color),
    align: 'left',
  });
  applyTracking(ctx, 0);
  drawText(ctx, {
    text: ':',
    x: mid,
    y: numberY - 4,
    font: fontSpec(TYPE.title),
    color: PALETTE.ui.textFaint,
    align: 'center',
  });

  if (board.caption) {
    applyTracking(ctx, TYPE.caption.tracking);
    drawText(ctx, {
      text: board.caption,
      x: mid,
      y: fh - SPACE.sm,
      font: fontSpec(TYPE.caption),
      color: PALETTE.ui.textMuted,
      align: 'center',
    });
    applyTracking(ctx, 0);
  }

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}

/**
 * 팀 색을 흰 판 위의 글자로 읽히는 값으로.
 *
 * 점수 숫자는 44px 이고 흰 유리 위에 앉는다. 팀 색 자체는 그 위에서 대비가
 * 모자라므로 어두운 쪽 짝을 쓴다 — `victoryPlateTexture` 가 같은 이유로 같은
 * 것을 한다. 팔레트에 없는 색(무승부의 중립색 등)은 `darken` 으로 떨어뜨린다.
 */
function inkFor(color) {
  const i = PALETTE.player.indexOf(color);
  return i >= 0 ? PALETTE.playerInk[i] : darken(color, 0.45);
}

/**
 * A pressable plate.
 *
 * Three states drawn as three separate textures rather than one tinted at
 * runtime: the hover state brightens the marker bar and the border but NOT the
 * plate behind the type, and a uniform tint cannot do that — it would lift the
 * background toward the text and cost contrast exactly when the player is
 * looking at it.
 *
 * ── 부록 B: 역할을 받는다 ──────────────────────────────────────────────────
 * 없으면 예전 그대로 `gelButton` — 역할이 없던 시절의 그림이고, 이 파일이 그리는
 * 것 중에는 아직 역할이 없는 표면도 있다. 역할이 오면 `roleButton` 이 그린다.
 *
 * @param {'idle'|'hover'|'pressed'} state
 * @param {string} [o.role]  `ROLE.*`. 없으면 역할 없는 젤 버튼
 */
export function buttonTexture(label, state, { width, height, scale = 1, role = null }) {
  const key = `btn:${label}:${state}:${width}x${height}@${scale}:${role ?? '-'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.scale(scale, scale);

  /**
   * 세 상태를 세 장의 텍스처로 굽는다. 런타임 틴트가 아니다.
   *
   * 호버는 테두리와 바닥 반사광을 바꾸되 글자 뒤 바탕은 거의 건드리지 않는데,
   * 균일한 틴트로는 그렇게 할 수 없다 — 바탕을 글자 쪽으로 끌어올려서 하필
   * 사람이 보고 있는 순간에 대비를 깎는다.
   *
   * 그림자가 판 밖으로 번지므로 캔버스 안쪽에 여백을 두고 그린다. 없으면
   * `ELEVATION.raised` 의 blur 10 이 텍스처 가장자리에서 잘려 한쪽만 그림자가
   * 있는 것처럼 보인다.
   */
  const pad = 6;
  const box = { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2, label, state };
  if (role) roleButton(ctx, { ...box, role, radius: RADIUS.pill });
  else gelButton(ctx, { ...box, align: 'center' });

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}

/**
 * A square, icon-only version of the plate above.
 *
 * ── the icon is DRAWN, not typed ───────────────────────────────────────────
 * The obvious way is a glyph through `crispText`, and `cardTexture` records why
 * it is not: at this size a font character is thresholded to hard alpha and then
 * quantised to five bits a channel, and anything with fill in it arrives as a
 * lump. The card set was chosen by counting inked pixels for exactly this
 * reason. Rectangles are immune — they are already axis-aligned and already hard
 * edged, so what is authored is what reaches the screen.
 *
 * The recentre mark is four corner brackets around a centre dot: a frame being
 * brought back around its subject, which is what the button does. It reads at 26
 * pixels, which a two-character label would not.
 *
 * Same plate, same border, same hover treatment and the same cache as
 * `buttonTexture`, because "기존 UI 스타일 그대로" is a requirement and the way to
 * honour it is to share the drawing rather than to match it by eye.
 *
 * @param {'recenter'} icon
 * @param {'idle'|'hover'} state
 */
export function iconButtonTexture(icon, state, { size, scale = 1, role = null }) {
  const key = `icon:${icon}:${state}:${size}@${scale}:${role ?? '-'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const s2 = Math.round(size * scale);
  const { canvas, ctx } = makeCanvas(s2, s2);
  ctx.scale(scale, scale);

  /**
   * 정원이다. 모서리가 둥근 정사각형이 아니라.
   *
   * `RADIUS.panel`(20) 을 넘기고 있었다. 64 짜리 버튼에서 본체는 52 이고 반지름
   * 20 은 그 절반인 26 보다 작으므로, 그려지던 것은 **모서리가 둥근 사각형**이었다.
   * `RADIUS.pill` 은 측정값이 아니라 센티널이고 — `tokens.js` 참조 — canvas
   * `roundRect` 가 반지름을 짧은 변의 절반으로 깎으므로, 정사각형 본체에 주면
   * 크기가 얼마든 정원이 된다. `gelButton`/`roleButton` 의 기본값이기도 해서
   * 사실 넘기지 않는 것과 같지만, 여기서는 **의도**라서 적어 둔다.
   *
   * 여백이 6 에서 5 로 내려간 것은 턴 플레이트와 나란히 재기 위해서다.
   * `turnPlateTexture` 의 유리판이 `pad = 5` 로 들어가 있어서, 6 을 쓰면 같은 44
   * 쿼드 안에서 원만 2 픽셀 작게 그려진다 — 쿼드는 같은데 눈에는 작아 보이는,
   * 가장 설명하기 어려운 종류의 어긋남이다.
   */
  const pad = 5;
  const box = size - pad * 2;
  const frame = { x: pad, y: pad, w: box, h: box, state, radius: RADIUS.pill };
  if (role) roleButton(ctx, { ...frame, role });
  else gelButton(ctx, frame);

  /**
   * 아이콘은 `icons.js` 의 벡터다. 사각형으로 손으로 찍던 것을 대체했다.
   *
   * 예전에는 네 모서리 브래킷과 가운데 점을 `fillRect` 로 직접 놓았고, 그 이유는
   * 이 파이프라인에서 글리프가 알파 이진화를 거치면 덩어리가 되기 때문이었다.
   * 이진화가 없으므로 그 제약도 없고, 벡터는 어느 해상도에서든 같은 모양이다.
   */
  const inner = box * 0.5;
  drawIcon(ctx, icon, {
    x: pad + (box - inner) / 2,
    y: pad + (box - inner) / 2,
    size: inner,
    // 역할이 있으면 그 스킨의 글자색. RETREAT 는 채워지지 않으므로 획이 흐린
    // 판 위에 그대로 놓이고, 그때 `skinFor` 의 색은 대비가 다르다.
    color: (role ? roleSkin(role, state) : skinFor(state)).text,
  });

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}

/**
 * The turn line: whose go it is, or who won. Also the intro's name plate.
 *
 * "PLAYER 2" and "PLAYER 1" are four pixels apart at this size, so something on
 * the plate has to carry the colour. It used to be a swatch beside the text; it
 * is the text itself now, in the same team ink the score's numbers use.
 */
/**
 * ── it grows to fit its text now, and it had to ───────────────────────────
 * This was a fixed 152-pixel box, which is exactly wide enough for
 * "PLAYER 2 (AI)" and for nothing longer. Online play puts a NICKNAME here, up
 * to ten characters, and Korean is rendered from an OS fallback font that is not
 * monospace — so there is no character count that is safely inside the box. The
 * old version did not clip or ellipsise; it simply drew off the end of the
 * canvas and the name lost its tail with no indication that anything was wrong.
 *
 * Measured with a probe canvas and handed back through `userData`, exactly as
 * `notePlateTexture` does — the caller rescales the quad to match, because
 * scaling it to anything else resamples the type and the whole point of this
 * pipeline is that it does not.
 *
 * `width` is now a MINIMUM rather than the size, so a short label is the plate
 * it always was and only a long one moves.
 */
export function turnPlateTexture(text, color, { width, height, scale = 1, maxWidth = 300 }) {
  const key = `turn:${text}:${color}:${width}x${height}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const probe = makeCanvas(8, 8);
  applyTracking(probe.ctx, TYPE.label.tracking);
  /**
   * 글자가 들어갈 수 있는 폭. 판의 상한에서 색 알약과 좌우 여백을 뺀 것.
   *
   * `fitText` 가 이 안에 들어가도록 크기를 줄이고, 그래도 안 되면 자른다. 예전에는
   * 판만 `maxWidth` 로 좁히고 글자는 원래 크기로 그려서, 좁은 프레임에서 캔버스
   * 밖으로 나간 부분이 그냥 잘려 나갔다.
   *
   * ── 여백은 고정이 아니라 **높이 비례**다 ──────────────────────────────────
   * `SPACE.lg + SPACE.md` = 58 을 고정으로 쓰고 있었다. 240 폭 판에서는 24% 지만,
   * 375x812 폰(프레임 312)에서 판이 126 으로 줄면 46% 다 — 실측으로 "PLAYER 1" 이
   * "PLAYE…" 가 됐다. 색 알약과 둥근 끝이 먹는 공간은 폭이 아니라 높이를 따라간다.
   */
  const inner = maxWidth - Math.max(SPACE.md, height * 0.8);
  const fitted = fitText(probe.ctx, text, TYPE.label, inner);
  const font = fitted.font;
  const label = fitted.text;
  const textW = Math.ceil(fitted.width);
  // 판은 자기가 말하는 것만큼 넓다. 라벨을 고정 폭 안에 넣으면 짧은 이름이
  // 상자 안에서 떠다니고, 긴 닉네임은 잘린다.
  const frameW = Math.min(maxWidth, Math.max(width, textW + SPACE.lg + SPACE.md));

  const w = Math.round(frameW * scale);
  const h = Math.round(height * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.scale(scale, scale);

  const pad = 5;
  glassPanel(ctx, {
    x: pad,
    y: pad,
    w: frameW - pad * 2,
    h: height - pad * 2,
    radius: RADIUS.pill,
    elevation: ELEVATION.raised,
  });

  /**
   * 색 알약은 없다. 팀 색은 **글자**가 입는다.
   *
   * 알약은 판 왼쪽 안쪽에 세로로 선 8픽셀짜리 색 막대였다. 판이 pill 이라 그
   * 안의 표시도 pill 이면 같은 언어라는 게 이유였지만, 실제로 보이는 것은
   * 이름 앞에 붙은 정체 불명의 막대 하나였다 — 이름표에도, 턴 판에도.
   *
   * 그 막대가 하던 일은 "PLAYER 1 과 PLAYER 2 를 글자를 읽기 전에 구분하기"
   * 하나이고, 그건 라벨을 그 팀의 잉크(`inkFor`)로 칠하면 같은 자리에서 같은
   * 거리에서 그대로 된다. 막대를 지우면 왼쪽 여백이 라벨의 것이 되므로 글자는
   * 판 가운데로 간다 — 뚜껑 아래 걸리는 이름표는 원래 가운데 정렬이어야 했다.
   */
  applyTracking(ctx, TYPE.label.tracking);
  drawText(ctx, {
    text: label,
    x: frameW / 2,
    y: height / 2 + fitted.size * 0.36,
    font,
    color: inkFor(color),
    align: 'center',
  });
  applyTracking(ctx, 0);

  const tex = toTexture(canvas);
  tex.userData = { width: frameW, height };
  cache.set(key, tex);
  return tex;
}

/**
 * The note line: what just happened.
 *
 * Sized to its text rather than to a fixed box, so the plate is as wide as what
 * it says and no wider — the same reasoning `cardTexture.noticeTexture` gives.
 * `userData` carries the frame size back because the caller has to scale the
 * quad to match, and scaling it to anything else would resample the type.
 */
export function notePlateTexture(text, tone, { height, scale = 1, maxWidth = 360 }) {
  const key = `note:${text}:${tone}:${height}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const accent = tone === 'timeout' ? PALETTE.ui.danger : PALETTE.accent.yellow;
  const ink = tone === 'timeout' ? PALETTE.ui.dangerDeep : PALETTE.accent.yellowDeep;

  const probe = makeCanvas(8, 8);
  applyTracking(probe.ctx, TYPE.caption.tracking);
  const pad = Math.max(SPACE.sm, height * 0.42);
  const fitted = fitText(probe.ctx, text, TYPE.caption, maxWidth - pad * 2);
  const frameW = Math.min(maxWidth, Math.ceil(fitted.width) + pad * 2);

  const w = Math.round(frameW * scale);
  const h = Math.round(height * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.scale(scale, scale);

  /**
   * 알약이고, 색조를 띤다.
   *
   * 예전에는 각진 판 왼쪽 가장자리에 3픽셀 색 막대였다. 그 막대가 유일하게 하던
   * 일 — 이 줄이 어떤 종류인지 읽기 전에 말하기 — 을 색조가 대신한다. 판 전체가
   * 옅게 물들면 3픽셀보다 멀리서 읽히고, 라운드 판에 붙은 직각 막대가 아니다.
   */
  glassPanel(ctx, {
    x: 0,
    y: 0,
    w: frameW,
    h: height,
    radius: RADIUS.pill,
    accent,
    tint: withAlpha(accent, 0.18),
    alpha: 1,
    elevation: ELEVATION.raised,
  });

  applyTracking(ctx, TYPE.caption.tracking);
  drawText(ctx, {
    text: fitted.text,
    x: frameW / 2,
    y: height / 2 + fitted.size * 0.36,
    font: fitted.font,
    color: ink,
    align: 'center',
  });
  applyTracking(ctx, 0);

  const tex = toTexture(canvas);
  tex.userData = { width: frameW, height };
  cache.set(key, tex);
  return tex;
}

/**
 * Mix a hex colour toward white. Returns `#rrggbb`.
 *
 * For the winner line below, and it is not decoration. See the note there.
 */


/**
 * A team colour, taken to the value that reads as 42px type on a white plate.
 *
 * A lookup rather than a blend, because the palette already names the answer for
 * the only two inputs that matter and a blend would be a second opinion about
 * them. Anything else — the neutral a draw is drawn in, or a colour a future
 * mode invents — falls back to the palette's own `darken`, which walks toward
 * the UI ink rather than toward black.
 */
function teamInk(color) {
  const i = PALETTE.player.indexOf(color);
  return i >= 0 ? PALETTE.playerInk[i] : darken(color, 0.45);
}

/**
 * The winner line. The one piece of type on this screen that has to be read.
 *
 * ── it lives here, with the rest of the UI, on purpose ──────────────────────
 * The victory screen is its own overlay scene — see `victory/VictoryLayer` — and
 * putting its plate in its own texture module was the obvious arrangement. It is
 * the wrong one: "가독성 원칙은 기존 UI와 동일" is a requirement, and the only
 * way to guarantee that is for the winner line to go through the SAME
 * `crispText` thresholding, the same `toTexture` filter settings, the same
 * content-keyed cache and the same `clearHudTextureCache` as the score does. A
 * second copy of that machinery would be a second thing that could drift.
 *
 * ── the type is a DARKENED team colour, and the bar is the real one ────────
 * The division of labour is the one `scorePlateTexture` uses and it has not
 * changed: the type is the team colour moved far enough from the plate to be
 * read at 42px, and the UNMIXED colour is repeated as a solid bar down each end,
 * because the bar is the half that still reads as a COLOUR rather than as a
 * value once it is only a few pixels wide.
 *
 * What changed is the direction. It used to mix most of the way to white, on a
 * near-black plate; on a white one that lands the type back on the plate. So it
 * takes the darker cut of the team's own hue instead — see `PALETTE.playerInk`,
 * which is that value chosen once for the whole project rather than derived here
 * by a blend that only happened to work for two specific inputs.
 *
 * A draw has no team, so it is passed the palette's neutral and the bars come
 * out neutral with it.
 */
export function victoryPlateTexture(text, color, { width, height, scale = 1 }) {
  const key = `win:${text}:${color}:${width}x${height}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.scale(scale, scale);

  /**
   * 유리판, 강조색은 이긴 쪽의 색.
   *
   * 예전에는 각진 흰 판 양 끝에 두꺼운 팀 색 막대 두 개였다. 막대의 근거는 "몇
   * 픽셀 폭이 되어도 값이 아니라 **색**으로 읽히는 쪽" 이었고, 근처의 다른 판들이
   * 전부 같은 어휘를 쓰고 있을 때는 맞았다. 지금은 이 판만 그렇다.
   *
   * `gelButton` 이 아니라 `glassPanel` 인 이유는 이것이 누를 수 있는 것이 아니기
   * 때문이다. 아래에 진짜 버튼 두 개가 있고, 그 둘과 같은 모양이면 안 된다.
   */
  glassPanel(ctx, {
    x: 0,
    y: 0,
    w: width,
    h: height,
    radius: RADIUS.panel,
    accent: color,
    alpha: 1,
    elevation: ELEVATION.modal,
  });

  /**
   * 글자는 팀 색의 **어두운 쪽**이다.
   *
   * 분업은 `scorePlateTexture` 의 것과 같다: 42px 에서 읽히려면 판에서 충분히 멀어야
   * 하고, 순수한 팀 색은 그 거리를 주지 않는다. `PALETTE.playerInk` 가 그 값이고,
   * 여기서 블렌드로 유도하지 않는 이유는 그 블렌드가 두 입력에만 우연히 맞기
   * 때문이다. 무승부에는 팀이 없으므로 중립색이 들어온다.
   */
  const probe = makeCanvas(8, 8);
  const fitted = fitText(probe.ctx, text, TYPE.display, width - SPACE.lg * 2);
  applyTracking(ctx, TYPE.display.tracking);
  drawText(ctx, {
    text: fitted.text,
    x: width / 2,
    y: height / 2 + fitted.size * 0.36,
    font: fitted.font,
    color: teamInk(color),
    align: 'center',
  });
  applyTracking(ctx, 0);

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}

/**
 * Drop every cached plate. For a texture-resolution change from the panel.
 *
 * The layer above re-asks for its textures on the next frame, so this is safe
 * to call at any point: nothing holds a plate across a frame boundary.
 */
/**
 * Break a line to a width, in a way that works for Korean AND for Latin.
 *
 * ── two scripts, two rules, and the naive one breaks one of them ──────────
 * Splitting on spaces is correct English and useless Korean: a Korean sentence
 * has spaces between phrases, not between the syllables that would have to
 * break, so a long clause simply overruns. Splitting on every character is
 * correct Korean and mangles English, which reads as words.
 *
 * So: break between characters when the pair is Hangul, and only at spaces
 * otherwise. That is what a Korean text renderer does, and the sentences this
 * wraps are mixed by nature — "상대방이 게임을 나갔습니다" next to a nickname
 * that may be Latin.
 */
function wrapText(ctx, text, maxWidth) {
  const hangul = (ch) => ch >= '가' && ch <= '힣';
  const lines = [];
  let line = '';

  for (const raw of String(text).split('\n')) {
    line = '';
    const chars = [...raw];
    for (let i = 0; i < chars.length; i++) {
      const next = line + chars[i];
      if (ctx.measureText(next).width <= maxWidth || !line) {
        line = next;
        continue;
      }
      // Too wide. Break here if Korean allows it, otherwise walk back to the
      // last space so a Latin word is not cut in half.
      const breakable = hangul(chars[i]) || hangul(chars[i - 1] ?? '') || chars[i] === ' ';
      if (breakable) {
        lines.push(line.trimEnd());
        line = chars[i] === ' ' ? '' : chars[i];
      } else {
        const at = line.lastIndexOf(' ');
        if (at > 0) {
          lines.push(line.slice(0, at));
          line = line.slice(at + 1) + chars[i];
        } else {
          lines.push(line);
          line = chars[i];
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/**
 * A modal panel: border, fill, heading, wrapped body — one texture.
 *
 * ── one texture rather than a little scene of quads ───────────────────────
 * The dialog is a fixed arrangement that only ever changes when the words
 * change, so composing it from six meshes would mean six positions to keep in
 * step for something that is really one picture. `ConfirmDialog` builds its
 * message as a texture for the same reason.
 *
 * Height comes back through `userData`, because the body decides it: a
 * two-line question and a four-line one are different-sized dialogs, and the
 * caller has to scale its quad to match or the type is resampled.
 */
export function modalTexture(
  {
    title, body, width = 320, scale = 1, accent = PALETTE.accent.cyan,
    extra = 0, footerHeight = 0, k = 1,
  },
) {
  const key = `modal:${title}:${body}:${width}:${accent}:${extra}:${footerHeight}:${k}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  /**
   * `k` 는 프레임 배수다 — `frameScale()`. 여백과 글자가 함께 줄어든다.
   *
   * 하나만 줄이면 비율이 무너진다: 여백만 줄이면 글자가 판을 꽉 채우고, 글자만
   * 줄이면 작은 글씨가 넓은 여백 안에서 헤엄친다.
   */
  const body2 = { ...TYPE.body, size: Math.round(TYPE.body.size * k) };
  const pad = Math.round(SPACE.lg * k);

  const probe = makeCanvas(8, 8);
  probe.ctx.font = fontSpec(body2);
  applyTracking(probe.ctx, body2.tracking);
  const inner = width - pad * 2;
  const lines = body ? wrapText(probe.ctx, body, inner) : [];

  const lineH = body2.size + Math.round(SPACE.xs * k);
  /**
   * `extra` 는 판이 **자기 안에** 비워 두어야 하는 아래쪽 공간이다.
   *
   * 입력 칸과 버튼 줄이 거기 놓인다. 예전에는 셋이 각각 떠 있는 별개의 물체였고,
   * 어두운 스크림 위에서 판 하나 · 홈 하나 · 버튼 두 개가 서로 관계없이 흩어져
   * 보였다. 한 장의 카드 안에 들어가면 그게 하나의 질문이 된다.
   */
  /**
   * 부록 B 의 골격. 제목은 **탭**이고 버튼 줄 위에는 **구분선**이 있다.
   *
   * 예전에는 제목이 판 안의 첫 줄이었고, 그러면 그것은 이름이 아니라 첫 번째
   * 내용이다. 버튼 줄과 본문 사이에는 아무 경계도 없어서, 판 하나에 글 두 줄과
   * 버튼 두 개가 같은 무게로 들어 있었다.
   *
   * 그림은 `glass.dialogPanel` 이 그린다 — 메뉴 네 화면이 쓰는 바로 그 함수다.
   * 골격이 두 벌이 되면 두 화면이 다른 모양으로 갈라진다.
   */
  const tabH = title ? Math.round(PANEL.titleTabHeight * k) : 0;
  /**
   * 본문과 구분선 사이의 숨. 없으면 선이 마지막 줄의 디센더를 지나간다.
   *
   * `dialogPanel` 은 푸터를 판 **아래에서** 재므로, 내용의 끝과 구분선이 정확히
   * 같은 y 가 된다 — 위쪽 여백(`pad`)만 있고 아래쪽 여백이 없었다는 뜻이다.
   */
  const bodyGap = Math.round(SPACE.md * k);
  const bodyH = Math.round(pad + lines.length * lineH + extra + bodyGap + footerHeight);
  const frameH = tabH + bodyH;

  const w = Math.round(width * scale);
  const h = Math.round(frameH * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.scale(scale, scale);

  /**
   * 모달은 유리판이다. 왼쪽 세로 색 막대는 없어졌다.
   *
   * 예전에는 테두리 사각형 안에 채운 사각형, 그리고 왼쪽 가장자리에 강조색 막대가
   * 있었다. 근거는 "턴 플레이트와 알림 줄이 그렇게 하고 있으니 같은 집합에 속한다"
   * 였는데, 그 둘이 이제 그렇게 하지 않는다. 남겨 두면 이것만 다른 집합이 된다.
   *
   * `ELEVATION.modal` 은 이 화면에서 가장 높이 뜨는 것이다 — 모달은 뒤의 모든 것을
   * 막고 있으므로, 그림자도 그만큼 깊어야 뒤에 무언가가 있다는 것이 읽힌다.
   */
  const geom = dialogPanel(ctx, {
    w: width,
    h: bodyH,
    title,
    tabHeight: tabH,
    footerHeight,
    padTop: pad,
    padX: pad,
    accent,
  });

  let y = geom.contentTop + body2.size * 0.82;
  applyTracking(ctx, body2.tracking);
  for (const line of lines) {
    drawText(ctx, {
      text: line,
      x: width / 2,
      y,
      font: fontSpec(body2),
      color: PALETTE.ui.textMuted,
      align: 'center',
    });
    y += lineH;
  }
  applyTracking(ctx, 0);

  const tex = toTexture(canvas);
  tex.userData = { width, height: frameH };
  cache.set(key, tex);
  return tex;
}

/**
 * 텍스트 입력 칸의 홈.
 *
 * ── 어두운 사각형에서 눌린 유리로 ──────────────────────────────────────────
 * 예전에는 rgb(0.05, 0.07, 0.1) 짜리 어두운 quad 에 금색 테두리 quad 를 겹친
 * 것이었다. 두 색 다 팔레트가 아니라 셰이더 uniform 에 손으로 적힌 숫자였고,
 * 밝은 유리 모달 위에 검은 구멍이 뚫린 것처럼 보였다.
 *
 * 이제 `pressed` 스킨을 쓴다 — 그라디언트가 반대로 흘러 표면이 **눌린** 것으로
 * 읽히는 스킨이고, 그게 정확히 입력 칸이 원하는 것이다. 누를 수 있는 것과
 * 헷갈리지 않는 이유는 라벨이 없기 때문이다: 젤 버튼은 늘 글자를 달고 있다.
 *
 * @param {boolean} focused  포커스 링을 그릴 것인가
 */
export function slotTexture(width, height, { focused = false, scale = 1, accent = PALETTE.accent.cyan } = {}) {
  const key = `slot:${width}x${height}:${focused}:${accent}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pad = 4;
  const { canvas, ctx } = makeCanvas(Math.round(width * scale), Math.round(height * scale));
  ctx.scale(scale, scale);
  gelButton(ctx, {
    x: pad,
    y: pad,
    w: width - pad * 2,
    h: height - pad * 2,
    radius: RADIUS.chip,
    state: 'pressed',
    accent,
  });
  if (focused) {
    focusRing(ctx, {
      x: pad,
      y: pad,
      w: width - pad * 2,
      h: height - pad * 2,
      radius: RADIUS.chip,
      accent,
    });
  }

  const tex = toTexture(canvas);
  tex.userData = { width, height };
  cache.set(key, tex);
  return tex;
}

export const clearHudTextureCache = registerTextureCache(() => {
  for (const t of cache.values()) t.dispose();
  cache.clear();});

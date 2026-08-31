import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from 'three';
import { darken, PALETTE } from '../core/palette.js';
import { registerTextureCache } from './fonts.js';
import { ELEVATION, RADIUS, SIZE, SPACE, TYPE } from '../core/tokens.js';
import { applyTracking, focusRing, fontSpec, gelButton, glassPanel, roundRectPath, skinFor } from './glass.js';
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
const PLATE = PALETTE.ui.surface;
const EDGE = PALETTE.ui.edge;
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
 * caption gets what is left. Each is drawn in its OWN player colour, and the
 * same colour is repeated as a solid bar down the outer edge — the bar is what
 * you can still tell apart once the quantiser has been at two similar hues.
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

  // 팀 색 바. 색으로 읽히려면 선이 아니라 면이어야 한다.
  const bar = 10;
  for (const [color, x] of [[board.left.color, SPACE.sm], [board.right.color, fw - SPACE.sm - bar]]) {
    ctx.fillStyle = color;
    roundRectPath(ctx, x, SPACE.sm, bar, fh - SPACE.sm * 2, bar / 2);
    ctx.fill();
  }

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
 * @param {'idle'|'hover'} state
 */
export function buttonTexture(label, state, { width, height, scale = 1 }) {
  const key = `btn:${label}:${state}:${width}x${height}@${scale}`;
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
  gelButton(ctx, {
    x: pad,
    y: pad,
    w: width - pad * 2,
    h: height - pad * 2,
    label,
    state,
    align: 'center',
  });

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
export function iconButtonTexture(icon, state, { size, scale = 1 }) {
  const key = `icon:${icon}:${state}:${size}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const s2 = Math.round(size * scale);
  const { canvas, ctx } = makeCanvas(s2, s2);
  ctx.scale(scale, scale);

  const pad = 6;
  const box = size - pad * 2;
  gelButton(ctx, { x: pad, y: pad, w: box, h: box, state, radius: RADIUS.panel });

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
    color: skinFor(state).text,
  });

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
}

/**
 * The turn line: whose go it is, or who won.
 *
 * The colour swatch survives the move out of the DOM because it is doing real
 * work — "PLAYER 2" and "PLAYER 1" are four pixels apart at this size and the
 * block of colour is what actually distinguishes them at a glance.
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

  const font = fontSpec(TYPE.label);
  const probe = makeCanvas(8, 8);
  probe.ctx.font = font;
  const textW = Math.ceil(probe.ctx.measureText(text).width);
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

  // 팀 색 알약. 판이 pill 이므로 안쪽 표시도 pill 이어야 같은 언어가 된다.
  const bar = 8;
  ctx.fillStyle = color;
  roundRectPath(ctx, pad + SPACE.xs, pad + SPACE.xs, bar, height - (pad + SPACE.xs) * 2, bar / 2);
  ctx.fill();

  applyTracking(ctx, TYPE.label.tracking);
  drawText(ctx, {
    text,
    x: pad + SPACE.xs * 2 + bar + SPACE.xs,
    y: height / 2 + TYPE.label.size * 0.36,
    font,
    color: PALETTE.ui.text,
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

  const u = (n) => Math.max(1, Math.round(n * scale));
  const font = `${u(13)}px ui-monospace, Menlo, monospace`;

  const probe = makeCanvas(8, 8);
  probe.ctx.font = font;
  const textW = Math.ceil(probe.ctx.measureText(text).width);
  const frameW = Math.min(maxWidth, Math.round(textW / scale) + 16);

  const w = Math.round(frameW * scale);
  const h = Math.round(height * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  const scratch = makeCanvas(w, h);

  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = tone === 'timeout' ? PALETTE.ui.danger : PALETTE.accent.yellow;
  ctx.fillRect(0, 0, u(3), h);

  drawText(ctx, {
    text,
    x: u(9),
    y: Math.round(h / 2 + u(5)),
    font,
    color: tone === 'timeout' ? PALETTE.ui.dangerDeep : PALETTE.accent.yellowDeep,
  });

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
  const scratch = makeCanvas(w, h);
  const u = (n) => Math.max(1, Math.round(n * scale));

  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = u(1);
  ctx.strokeRect(u(0.5), u(0.5), w - u(1), h - u(1));

  // The team bars, full saturation, at both ends.
  ctx.fillStyle = color;
  ctx.fillRect(u(3), u(3), u(9), h - u(6));
  ctx.fillRect(w - u(12), u(3), u(9), h - u(6));

  drawText(ctx, {
    text,
    x: w / 2,
    // Baseline rather than a centred box: `textBaseline` is alphabetic in
    // `crispText`, so the descender-free Korean glyphs sit high without this.
    y: Math.round(h / 2 + u(15)),
    font: `bold ${u(42)}px ui-monospace, Menlo, monospace`,
    color: teamInk(color),
    align: 'center',
  });

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
  { title, body, width = 320, scale = 1, accent = PALETTE.accent.cyan },
) {
  const key = `modal:${title}:${body}:${width}:${accent}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const u = (n) => Math.max(1, Math.round(n * scale));
  const pad = 14;
  const titleFont = `bold ${u(15)}px ui-monospace, Menlo, monospace`;
  const bodyFont = `${u(12)}px ui-monospace, Menlo, monospace`;

  const probe = makeCanvas(8, 8);
  probe.ctx.font = bodyFont;
  const inner = (width - pad * 2) * scale;
  const lines = body ? wrapText(probe.ctx, body, inner) : [];

  const titleH = title ? u(22) : 0;
  const lineH = u(17);
  const frameH = Math.round(
    (pad * 2 * scale + titleH + lines.length * lineH + (title && lines.length ? u(6) : 0)) / scale,
  );

  const w = Math.round(width * scale);
  const h = Math.round(frameH * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  const scratch = makeCanvas(w, h);

  // Border, then fill inset by two — the same two-rectangle construction every
  // plate in this project uses, so the dialog belongs to the same set.
  ctx.fillStyle = PALETTE.ui.edge;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = PALETTE.ui.surface;
  ctx.fillRect(u(2), u(2), w - u(4), h - u(4));
  // The accent bar down the left edge, as the turn plate and the note line have.
  ctx.fillStyle = accent;
  ctx.fillRect(u(2), u(2), u(3), h - u(4));

  let y = u(pad) + u(14);
  if (title) {
    drawText(ctx, {
      text: title,
      x: u(pad),
      y,
      font: titleFont,
      color: PALETTE.ui.text,
    });
    y += titleH;
  }
  for (const line of lines) {
    drawText(ctx, {
      text: line,
      x: u(pad),
      y,
      font: bodyFont,
      color: PALETTE.ui.textMuted,
    });
    y += lineH;
  }

  const tex = toTexture(canvas);
  tex.userData = { width, height: frameH };
  cache.set(key, tex);
  return tex;
}

export const clearHudTextureCache = registerTextureCache(() => {
  for (const t of cache.values()) t.dispose();
  cache.clear();});

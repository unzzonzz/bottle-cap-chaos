import { CanvasTexture, ClampToEdgeWrapping, NearestFilter, SRGBColorSpace } from 'three';
import { darken, PALETTE } from '../core/palette.js';
import { registerTextureCache } from './fonts.js';

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

/** Alpha at or above this survives; everything else is dropped. */
const ALPHA_CUT = 110;

const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

function toTexture(canvas) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Draw text with hard edges.
 *
 * Rasterised on a scratch canvas, thresholded, then blitted. Doing it in place
 * would threshold whatever art is already underneath it as well. Lifted from
 * `render/cardTexture.js`, which explains at length why
 * `imageSmoothingEnabled = false` is not enough on its own — that flag governs
 * image SCALING, and the font rasteriser antialiases glyph edges regardless.
 */
function crispText(target, scratch, { text, x, y, font, color, align = 'left' }) {
  const { canvas, ctx } = scratch;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= ALPHA_CUT ? 255 : 0;
  ctx.putImageData(img, 0, 0);

  target.drawImage(canvas, 0, 0);
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
  const scratch = makeCanvas(w, h);
  /** Authored against the plate's frame size, then scaled. */
  const u = (n) => Math.max(1, Math.round(n * scale));

  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = u(1);
  ctx.strokeRect(u(0.5), u(0.5), w - u(1), h - u(1));

  // The team bars. Wide enough to read as a colour rather than a line.
  ctx.fillStyle = board.left.color;
  ctx.fillRect(u(3), u(3), u(7), h - u(6));
  ctx.fillStyle = board.right.color;
  ctx.fillRect(w - u(10), u(3), u(7), h - u(6));

  const mid = w / 2;
  const numberY = u(29);
  const numberFont = `bold ${u(26)}px ui-monospace, Menlo, monospace`;

  crispText(ctx, scratch, {
    text: board.left.value,
    x: mid - u(22),
    y: numberY,
    font: numberFont,
    color: board.left.color,
    align: 'right',
  });
  crispText(ctx, scratch, {
    text: ':',
    x: mid,
    y: numberY - u(2),
    font: `bold ${u(19)}px ui-monospace, Menlo, monospace`,
    color: PALETTE.ui.textFaint,
    align: 'center',
  });
  crispText(ctx, scratch, {
    text: board.right.value,
    x: mid + u(22),
    y: numberY,
    font: numberFont,
    color: board.right.color,
    align: 'left',
  });

  if (board.caption) {
    crispText(ctx, scratch, {
      text: board.caption,
      x: mid,
      y: h - u(4),
      font: `${u(10)}px ui-monospace, Menlo, monospace`,
      color: PALETTE.ui.textMuted,
      align: 'center',
    });
  }

  const tex = toTexture(canvas);
  cache.set(key, tex);
  return tex;
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
  const scratch = makeCanvas(w, h);
  const u = (n) => Math.max(1, Math.round(n * scale));

  const hover = state === 'hover';
  /**
   * A third state, for a button that is there but cannot be pressed yet.
   *
   * `menuPlateTexture`'s disabled skin stamps "준비 중" onto the plate, which is
   * the menu's way of saying a FEATURE is unfinished. That is the wrong sentence
   * here: 확인 on a half-typed nickname is not unbuilt, it is waiting. So this
   * one only dims — everything recedes toward the plate colour, including the
   * accent bar, so the button reads as present and inert rather than as missing.
   */
  const dead = state === 'disabled';
  const skin = hover ? BTN.hover : dead ? BTN.disabled : BTN.idle;
  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = skin.edge;
  ctx.lineWidth = u(1);
  ctx.strokeRect(u(0.5), u(0.5), w - u(1), h - u(1));

  ctx.fillStyle = skin.bar;
  ctx.fillRect(u(3), u(3), u(4), h - u(6));

  crispText(ctx, scratch, {
    text: label,
    x: u(13),
    y: Math.round(h / 2 + u(6)),
    font: `bold ${u(16)}px ui-monospace, Menlo, monospace`,
    color: skin.text,
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

  const s = Math.round(size * scale);
  const { canvas, ctx } = makeCanvas(s, s);
  const u = (n) => Math.max(1, Math.round(n * scale));

  const hover = state === 'hover';
  const skin = hover ? BTN.hover : BTN.idle;
  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = skin.edge;
  ctx.lineWidth = u(1);
  ctx.strokeRect(u(0.5), u(0.5), s - u(1), s - u(1));

  ctx.fillStyle = skin.text;

  // Four corner brackets, inset from the plate's own border so the two do not
  // read as one thick frame.
  const pad = u(9);
  const arm = u(6);
  const thick = u(2);
  const far = s - pad - thick;
  for (const [x, y, sx, sy] of [
    [pad, pad, 1, 1],
    [far, pad, -1, 1],
    [pad, far, 1, -1],
    [far, far, -1, -1],
  ]) {
    // Horizontal and vertical arm of each bracket, drawn from the corner inward.
    ctx.fillRect(sx > 0 ? x : x + thick - arm, y, arm, thick);
    ctx.fillRect(x, sy > 0 ? y : y + thick - arm, thick, arm);
  }

  // The subject, back in the middle of them.
  const dot = u(4);
  ctx.fillStyle = skin.bar;
  ctx.fillRect(Math.round((s - dot) / 2), Math.round((s - dot) / 2), dot, dot);

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
export function turnPlateTexture(text, color, { width, height, scale = 1, maxWidth = 260 }) {
  const key = `turn:${text}:${color}:${width}x${height}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const u = (n) => Math.max(1, Math.round(n * scale));
  const font = `bold ${u(15)}px ui-monospace, Menlo, monospace`;

  const probe = makeCanvas(8, 8);
  probe.ctx.font = font;
  const textW = Math.ceil(probe.ctx.measureText(text).width);
  const frameW = Math.min(maxWidth, Math.max(width, Math.round(textW / scale) + 22));

  const w = Math.round(frameW * scale);
  const h = Math.round(height * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  const scratch = makeCanvas(w, h);

  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, u(4), h);

  crispText(ctx, scratch, {
    text,
    x: u(11),
    y: Math.round(h / 2 + u(6)),
    font,
    color: TEXT,
  });

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

  crispText(ctx, scratch, {
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

  crispText(ctx, scratch, {
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
    crispText(ctx, scratch, {
      text: title,
      x: u(pad),
      y,
      font: titleFont,
      color: PALETTE.ui.text,
    });
    y += titleH;
  }
  for (const line of lines) {
    crispText(ctx, scratch, {
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

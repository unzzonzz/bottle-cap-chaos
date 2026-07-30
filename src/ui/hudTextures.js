import { CanvasTexture, ClampToEdgeWrapping, NearestFilter } from 'three';

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

const PLATE = '#0b0e14';
const EDGE = '#39435a';
const TEXT = '#d3dae6';

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
    color: '#5c6880',
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
      color: '#7b8699',
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
  ctx.fillStyle = hover ? '#1d2740' : PLATE;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = hover ? '#93a6c8' : EDGE;
  ctx.lineWidth = u(1);
  ctx.strokeRect(u(0.5), u(0.5), w - u(1), h - u(1));

  ctx.fillStyle = hover ? '#d8b45c' : '#5c6a82';
  ctx.fillRect(u(3), u(3), u(4), h - u(6));

  crispText(ctx, scratch, {
    text: label,
    x: u(13),
    y: Math.round(h / 2 + u(6)),
    font: `bold ${u(16)}px ui-monospace, Menlo, monospace`,
    color: hover ? '#ffffff' : TEXT,
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
export function turnPlateTexture(text, color, { width, height, scale = 1 }) {
  const key = `turn:${text}:${color}:${width}x${height}@${scale}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const { canvas, ctx } = makeCanvas(w, h);
  const scratch = makeCanvas(w, h);
  const u = (n) => Math.max(1, Math.round(n * scale));

  ctx.fillStyle = PLATE;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, u(4), h);

  crispText(ctx, scratch, {
    text,
    x: u(11),
    y: Math.round(h / 2 + u(6)),
    font: `bold ${u(15)}px ui-monospace, Menlo, monospace`,
    color: TEXT,
  });

  const tex = toTexture(canvas);
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
  ctx.fillStyle = tone === 'timeout' ? '#e0553f' : '#e0c07a';
  ctx.fillRect(0, 0, u(3), h);

  crispText(ctx, scratch, {
    text,
    x: u(9),
    y: Math.round(h / 2 + u(5)),
    font,
    color: tone === 'timeout' ? '#f0a090' : '#e0c07a',
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
function lighten(hex, amount) {
  const h = String(hex).replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  const k = Math.min(1, Math.max(0, amount));
  const up = (v) => Math.round(v + (255 - v) * k);
  const r = up((n >> 16) & 0xff);
  const g = up((n >> 8) & 0xff);
  const b = up(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
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
 * ── the type is a LIGHTENED team colour, and the bar is the real one ────────
 * `PLAYER_COLORS[0]` is #c8342f — a mid red. On this file's near-black plate
 * that is about 3:1, which is thin for 42px type and thinner still after the
 * 5-bit quantiser has moved it. So the type is mixed most of the way to white,
 * which lifts it clear of the plate while keeping the hue that says whose it is,
 * and the UNMIXED colour is repeated as a solid bar down each end — the same
 * division of labour `scorePlateTexture` uses, and for the same reason: the bar
 * is what still reads as a colour once the quantiser has been at two hues.
 *
 * A draw has no team, so it is passed a grey and the bars come out grey with it.
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
    color: lighten(color, 0.45),
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
export function clearHudTextureCache() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}

import { PALETTE, mix, toRgb, withAlpha } from '../core/palette.js';
import { ELEVATION, RADIUS, TYPE } from '../core/tokens.js';
import { FONT_FAMILY } from './fonts.js';

/**
 * The gel button and the glass panel, as canvas 2D recipes.
 *
 * ── one file, because the look IS the stacking order ────────────────────────
 * A Frutiger Aero control is not a colour, it is a sequence: shadow, a base
 * gradient with a value break at the waist, a gloss sweep inset from the top, a
 * one-pixel inner highlight, a bounce of accent light off the bottom, then the
 * border. Get the order wrong and you get a flat rounded rectangle with a white
 * smear on it. Every surface in the game goes through these two functions so the
 * order is written down once.
 *
 * ── everything is in FRAME PIXELS ───────────────────────────────────────────
 * Callers oversample by setting `canvas.width = frameW * uiScale` and calling
 * `ctx.scale(uiScale, uiScale)` before drawing. Nothing here knows about that:
 * it draws at frame scale and the transform does the rest. That is also why the
 * shadow blurs below are not multiplied by anything — `shadowBlur` is in the
 * current transform's units, so it scales with everything else.
 *
 * ── the panel does not blur what is behind it ───────────────────────────────
 * A canvas texture is static; blurring the live 3D behind it would need a render
 * target read-back and a blur pass every frame, for a UI that is mostly opaque
 * anyway. Translucency plus the gloss sweep is what reads as glass. The Wii
 * menu did not blur either.
 */

/* ── shape ───────────────────────────────────────────────────────────────── */

/**
 * `roundRect` as a path, with a fallback.
 *
 * `CanvasRenderingContext2D.roundRect` is in every engine this ships to except
 * the older WKWebView on iOS 15, which the Capacitor build still supports. The
 * fallback is arcs rather than quadratics because a quadratic corner is visibly
 * not a circle at `RADIUS.panel` and the two would not match across devices.
 */
export function roundRectPath(ctx, x, y, w, h, r) {
  /**
   * 반경은 절대 음수가 될 수 없다.
   *
   * `Math.min(r, w/2, h/2)` 만으로는 부족하다. 판이 저술된 것보다 작아지면 —
   * 프레임에 맞춰 줄어들 때, 또는 안쪽 여백이 판보다 커질 때 — `w` 나 `h` 가
   * 음수가 되고 그러면 반경도 음수가 된다. Canvas 는 거기서 `RangeError` 를 던지고,
   * 그건 그리는 도중이라 그 프레임 전체가 사라진다. 실제로 매칭 화면의 이름판이
   * 17 픽셀로 줄었을 때 게임 부팅이 통째로 죽었다.
   *
   * 0 으로 죄면 그냥 각진 사각형이 나온다 — 못생겼지만 화면은 살아 있고, 그
   * 크기에서는 어차피 모서리가 안 보인다.
   */
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** Pull a colour toward its own luminance. `amount` 1 is fully grey. */
function desaturate(hex, amount) {
  const [r, g, b] = toRgb(hex);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = Math.max(0, Math.min(1, amount));
  const c = [r + (y - r) * k, g + (y - g) * k, b + (y - b) * k].map((v) =>
    Math.max(0, Math.min(255, Math.round(v))),
  );
  return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, '0')}`;
}

/** Apply an ELEVATION step to the context. Colour is always the palette's navy. */
function applyElevation(ctx, step) {
  ctx.shadowColor = withAlpha(PALETTE.ui.shadow, step.alpha);
  ctx.shadowBlur = step.blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = step.dy;
}

function clearShadow(ctx) {
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

/**
 * The skin for a state: which colours the seven steps use.
 *
 * Separated from the drawing so that a state is a data change rather than a
 * branch inside every step, and so a caller can ask what a state looks like
 * without drawing it — `CardHand` tints meshes directly and needs the same
 * answer the texture would have given.
 */
export function skinFor(state = 'idle', accent = PALETTE.accent.cyan) {
  const base = {
    top: PALETTE.ui.glassTop,
    bottom: PALETTE.ui.glassBottom,
    edge: PALETTE.ui.edgeOuter,
    text: PALETTE.ui.text,
    glossAlpha: 0.85,
    bounceAlpha: 0.2,
    innerAlpha: 0.55,
    elevation: ELEVATION.raised,
    accent,
    flip: false,
    alpha: 1,
  };
  switch (state) {
    case 'hover':
      return { ...base, glossAlpha: 0.95, edge: accent, bounceAlpha: 0.3 };
    case 'pressed':
      // The gradient runs the other way, so the surface reads as pushed IN, and
      // the shadow goes flat because a pressed control is not floating.
      return {
        ...base,
        flip: true,
        glossAlpha: 0.6,
        edge: accent,
        elevation: ELEVATION.flat,
        bounceAlpha: 0.1,
      };
    case 'selected':
      return { ...base, edge: accent, glossAlpha: 0.9, bounceAlpha: 0.34 };
    case 'disabled':
      return {
        ...base,
        top: desaturate(PALETTE.ui.glassTop, 0.6),
        bottom: desaturate(PALETTE.ui.glassBottom, 0.6),
        edge: desaturate(PALETTE.ui.edgeOuter, 0.6),
        text: PALETTE.ui.disabledText,
        accent: desaturate(accent, 0.6),
        glossAlpha: 0,
        innerAlpha: 0,
        bounceAlpha: 0,
        elevation: ELEVATION.flat,
        alpha: 0.5,
      };
    default:
      return base;
  }
}

/* ── the gel button ──────────────────────────────────────────────────────── */

/**
 * Steps 1-6 of the recipe: everything but the label.
 *
 * Split out because the panel wants the same stack with two steps changed, and
 * because the card face wants the body without a label on it.
 */
function drawGelBody(ctx, { x, y, w, h, radius, skin, waist, glossFraction, glossInset }) {
  ctx.save();
  ctx.globalAlpha = skin.alpha;

  // 1. Drop shadow, applied to the base fill only — every later step draws
  //    inside this shape and would otherwise stamp its own shadow on top.
  applyElevation(ctx, skin.elevation);

  // 2. Base fill. The break at `waist` is the whole trick: a smooth gradient
  //    reads as plastic, and one hard step of value across the middle reads as
  //    the waist of a piece of moulded glass.
  const top = skin.flip ? skin.bottom : skin.top;
  const bottom = skin.flip ? skin.top : skin.bottom;
  const base = ctx.createLinearGradient(0, y, 0, y + h);
  base.addColorStop(0, top);
  base.addColorStop(waist, mix(top, bottom, 0.35));
  base.addColorStop(Math.min(1, waist + 0.01), mix(top, bottom, 0.62));
  base.addColorStop(1, bottom);
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = base;
  ctx.fill();

  clearShadow(ctx);

  // Everything below is clipped to the body, so a gloss or a bounce can be
  // specified in plain rectangles without leaking past the rounded corners.
  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();

  // 5. Bottom bounce. Drawn BEFORE the gloss: it is light coming back up off
  //    whatever the control is sitting on, so the gloss sits over it.
  if (skin.bounceAlpha > 0) {
    const bh = h * 0.3;
    const bounce = ctx.createLinearGradient(0, y + h - bh, 0, y + h);
    bounce.addColorStop(0, withAlpha(skin.accent, 0));
    bounce.addColorStop(1, withAlpha(skin.accent, skin.bounceAlpha));
    ctx.fillStyle = bounce;
    ctx.fillRect(x, y + h - bh, w, bh);
  }

  // 3. Top gloss, inset from the body so a sliver of the base shows around it.
  if (skin.glossAlpha > 0) {
    const inset = h * glossInset;
    const glossH = h * glossFraction;
    const gloss = ctx.createLinearGradient(0, y + inset, 0, y + inset + glossH);
    gloss.addColorStop(0, withAlpha(PALETTE.ui.glossHi, skin.glossAlpha));
    gloss.addColorStop(1, withAlpha(PALETTE.ui.glossLo, 0));
    roundRectPath(ctx, x + inset, y + inset, w - inset * 2, glossH, radius);
    ctx.fillStyle = gloss;
    ctx.fill();
  }

  ctx.restore();

  // 4. The inner highlight line along the top curve. This is the step that
  //    reads as THICKNESS — without it the gloss looks painted on rather than
  //    seen through something.
  if (skin.innerAlpha > 0) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.strokeStyle = withAlpha(PALETTE.ui.edgeInner, skin.innerAlpha);
    ctx.lineWidth = 1;
    roundRectPath(ctx, x + 1, y + 1.25, w - 2, h - 2, radius);
    ctx.stroke();
    ctx.restore();
  }

  // 6. Outer border, last, so nothing above has softened it.
  ctx.strokeStyle = skin.edge;
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, radius);
  ctx.stroke();

  ctx.restore();
}

/**
 * A pressable gel button, label included.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {string} [o.label]
 * @param {'idle'|'hover'|'pressed'|'selected'|'disabled'} [o.state]
 * @param {string} [o.accent]  drives the border and the bottom bounce
 * @param {'left'|'center'} [o.align]
 */
export function gelButton(ctx, o) {
  const { x, y, w, h, label, align = 'center', radius = RADIUS.pill } = o;
  const skin = skinFor(o.state, o.accent);

  drawGelBody(ctx, { x, y, w, h, radius, skin, waist: 0.52, glossFraction: 0.46, glossInset: 0.1 });

  if (!label) return;

  ctx.save();
  /**
   * The label does NOT take the body's alpha.
   *
   * The brief specifies `alpha 0.5` for a disabled control, and that is right
   * for the PLATE — it is how the control recedes. Applied to the type as well
   * it makes the label unreadable over the backdrop, and "disabled" has to stay
   * legible: §0.4 requires the usable / unusable / silenced states of the card
   * hand to be told apart, and a button whose label you cannot read is not
   * distinguishable from one that failed to draw. So the body recedes and the
   * word stays.
   */
  ctx.globalAlpha = skin.alpha < 1 ? 0.85 : 1;
  ctx.font = fontSpec(TYPE.label);
  ctx.textAlign = align === 'left' ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  applyTracking(ctx, TYPE.label.tracking);
  const tx = align === 'left' ? x + h * 0.42 : x + w / 2;
  // A one-pixel white shadow UNDER the type. Emboss, not drop shadow — it lifts
  // the label off the gradient without darkening anything, which is what would
  // happen if this went the other way.
  ctx.fillStyle = withAlpha(PALETTE.ui.glossHi, 0.35);
  ctx.fillText(label, tx, y + h / 2 + 1);
  ctx.fillStyle = skin.text;
  ctx.fillText(label, tx, y + h / 2);
  applyTracking(ctx, 0);
  ctx.restore();
}

/* ── the glass panel ─────────────────────────────────────────────────────── */

/**
 * A floating glass panel: the score plate, a modal, a menu card.
 *
 * Three differences from the button, all from §2.4 of the brief:
 *   - translucent, so the scene shows through faintly
 *   - NO waist break, because a panel is a flat sheet rather than a moulded key
 *   - a shorter gloss (32% against 46%), so the sheet does not read as domed
 */
export function glassPanel(ctx, o) {
  const {
    x, y, w, h,
    radius = RADIUS.panel,
    alpha = 0.88,
    accent = PALETTE.accent.cyan,
    elevation = ELEVATION.floating,
    tint = null,
  } = o;

  const skin = { ...skinFor('idle', accent), elevation, alpha, bounceAlpha: 0.12 };

  ctx.save();
  ctx.globalAlpha = alpha;
  applyElevation(ctx, elevation);
  const base = ctx.createLinearGradient(0, y, 0, y + h);
  base.addColorStop(0, skin.top);
  base.addColorStop(1, skin.bottom);
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = base;
  ctx.fill();
  clearShadow(ctx);

  ctx.save();
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.clip();

  /**
   * 색조. 판이 무엇에 관한 것인지를 말해야 할 때만.
   *
   * 유리의 기본 바탕은 중립이고 그게 맞다 — 대부분의 판은 담고 있는 내용이 말을
   * 하지 판 자체가 하지 않는다. 하지만 "이 카드는 낼 수 없다" 같은 판은 읽기 전에
   * 이미 무슨 종류인지 보여야 하므로, 바탕 위에 옅은 물을 한 겹 올린다. 광택과
   * 가장자리보다 **아래**에 올려야 유리 아래에 색이 있는 것으로 보이고, 위에
   * 올리면 유리에 색을 칠한 것으로 보인다.
   */
  if (tint) {
    ctx.fillStyle = tint;
    ctx.fillRect(x, y, w, h);
  }

  const bh = h * 0.28;
  const bounce = ctx.createLinearGradient(0, y + h - bh, 0, y + h);
  bounce.addColorStop(0, withAlpha(accent, 0));
  bounce.addColorStop(1, withAlpha(accent, skin.bounceAlpha));
  ctx.fillStyle = bounce;
  ctx.fillRect(x, y + h - bh, w, bh);

  const inset = h * 0.06;
  const glossH = h * 0.32;
  const gloss = ctx.createLinearGradient(0, y + inset, 0, y + inset + glossH);
  gloss.addColorStop(0, withAlpha(PALETTE.ui.glossHi, 0.8));
  gloss.addColorStop(1, withAlpha(PALETTE.ui.glossLo, 0));
  roundRectPath(ctx, x + inset, y + inset, w - inset * 2, glossH, radius);
  ctx.fillStyle = gloss;
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = withAlpha(PALETTE.ui.edgeInner, 0.5);
  ctx.lineWidth = 1;
  roundRectPath(ctx, x + 1, y + 1.25, w - 2, h - 2, radius);
  ctx.stroke();

  ctx.strokeStyle = PALETTE.ui.edgeOuter;
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, x + 0.75, y + 0.75, w - 1.5, h - 1.5, radius);
  ctx.stroke();
  ctx.restore();
}

/**
 * The focus / selection ring: an accent stroke outside the shape, plus a glow.
 *
 * Outside rather than inside, so it cannot be confused with the border and so it
 * survives on a control whose border is already the accent colour in `hover`.
 */
export function focusRing(ctx, { x, y, w, h, radius = RADIUS.pill, accent = PALETTE.accent.cyan }) {
  ctx.save();
  ctx.shadowColor = withAlpha(accent, 0.55);
  ctx.shadowBlur = 12;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRectPath(ctx, x - 2, y - 2, w + 4, h + 4, radius);
  ctx.stroke();
  ctx.restore();
}

/* ── type ────────────────────────────────────────────────────────────────── */

/** A `TYPE` entry as a canvas `font` string. The stack lives in `fonts.js`. */
export function fontSpec(t, family = FONT_FAMILY) {
  return `${t.weight} ${t.size}px ${family}`;
}

/**
 * 주어진 폭 안에 들어가는 폰트 스펙과 문자열을 고른다.
 *
 * ── 자르기 전에 줄인다 ──────────────────────────────────────────────────────
 * 판은 자기가 말하는 것만큼 넓지만 프레임에 상한이 있고, 상한에 걸리면 지금까지는
 * 글자가 캔버스 밖으로 나가 잘렸다 — 세로 화면 312 폭 프레임에서 턴 플레이트가
 * "PLAYER 1" 대신 "PLAYE" 였다.
 *
 * 사람 이름이 들어오는 자리이므로 순서가 중요하다. 먼저 글자 크기를 줄이고 —
 * 조금 작은 이름은 여전히 그 사람의 이름이다 — 최소 크기에서도 안 들어갈 때만
 * 자른다. 최소 크기는 원래의 76% 로, 그 아래는 옆의 다른 라벨과 다른 글씨체처럼
 * 보이기 시작하는 지점이다.
 *
 * @param {CanvasRenderingContext2D} ctx  측정에만 쓴다. 상태는 되돌려 놓는다.
 * @param {string} text
 * @param {{size: number, weight: number, tracking?: number}} type
 * @param {number} maxWidth
 * @returns {{font: string, text: string, size: number, width: number}}
 */
export function fitText(ctx, text, type, maxWidth) {
  const prev = ctx.font;
  const measure = (t, size) => {
    ctx.font = fontSpec({ ...type, size });
    return ctx.measureText(t).width;
  };

  let size = type.size;
  let width = measure(text, size);
  const floor = Math.max(9, Math.round(type.size * 0.76));
  while (width > maxWidth && size > floor) {
    size -= 1;
    width = measure(text, size);
  }

  let out = text;
  if (width > maxWidth && out.length > 1) {
    // 말줄임표까지 포함해서 들어가야 하므로 한 글자씩 줄이며 다시 잰다.
    while (out.length > 1 && measure(`${out}…`, size) > maxWidth) out = out.slice(0, -1);
    out = `${out}…`;
    width = measure(out, size);
  }

  ctx.font = prev;
  return { font: fontSpec({ ...type, size }), text: out, size, width };
}

/**
 * Letter spacing, where the engine has it.
 *
 * `ctx.letterSpacing` is a 2023 addition and this ships to a WKWebView that may
 * predate it. Setting an unsupported property is a silent no-op rather than a
 * throw, so the guard is only here to keep the value from sticking on a context
 * that DOES support it and was last used with different tracking.
 */
export function applyTracking(ctx, tracking) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking || 0}px`;
}

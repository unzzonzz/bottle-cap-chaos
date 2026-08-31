import { PALETTE, mix, toRgb, withAlpha } from '../core/palette.js';
import { ELEVATION, PANEL, RADIUS, ROLE, SIZE, SPACE, TYPE } from '../core/tokens.js';
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
    /**
     * 바탕 채우기에만 걸리는 알파. 테두리와 글자는 이것을 받지 않는다.
     *
     * `alpha` 로는 안 된다 — 그건 몸통 전체에 걸려서 테두리와 글자까지 흐려지고,
     * RETREAT 는 **채워지지 않되 테두리는 또렷해야** 하는 버튼이다.
     * 색에 `rgba()` 를 넣는 것도 안 된다: `drawGelBody` 가 `mix()` 로 중간 정지점을
     * 만드는데 `mix` 는 16진 문자열만 읽는다. 실제로 그렇게 했다가 RETREAT 가
     * 새까맣게 나왔다.
     */
    fillAlpha: 1,
  };
  switch (state) {
    /**
     * ── 호버와 프레스는 **아무것도 바꾸지 않는다** ──────────────────────────
     * 셋을 차례로 뺐고, 결국 전부 뺐다:
     *
     *   테두리   호버가 `edge: accent` 였다. 목록을 훑으면 줄마다 파란 상자가
     *            켜졌다 꺼진다.
     *   크기     닿으면 4% 커지고 누르면 3% 작아졌다. 알약이 세로로 쌓인 목록에서
     *            하나가 커지면 위아래 간격이 달라져 줄이 정렬을 잃은 것처럼 보인다.
     *   광택·그림자  호버가 광택을 0.85에서 0.95로, 아래 반사를 0.2에서 0.3으로
     *            올렸고, 프레스는 그라디언트를 뒤집고 그림자를 평평하게 했다.
     *
     * 마지막 것까지 뺀 것은 사용자의 판단이고, 이 화면 구성에서 근거가 있다: 판이
     * 이미 유리이고 광택을 갖고 있어서, 거기에 **또** 광택을 얹으면 반응이 아니라
     * 재질이 흔들리는 것으로 보인다.
     *
     * 남는 피드백은 커서다 — `styles.css` 의 `#view.is-over-item` 등. 캔버스 안의
     * 판은 자기 커서를 가질 수 없으므로 그쪽이 원래부터 그 일을 하고 있었다.
     *
     * `selected` 와 `disabled` 는 남는다. 그 둘은 상호작용의 **효과**가 아니라
     * 컨트롤의 **상태**다 — 고른 도구, 고른 색, 지금은 누를 수 없는 줄. 손을 떼면
     * 사라지는 것과 그대로 있는 것은 다른 것이고, 후자는 말해야 한다.
     */
    case 'hover':
    case 'pressed':
      return base;
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


/* ── roles ───────────────────────────────────────────────────────────────── */

/**
 * 역할이 스킨에 얹는 변형.
 *
 * ── 레시피를 역할마다 다시 쓰지 않는다 ─────────────────────────────────────
 * `drawGelBody` 의 여섯 단계가 이 프로젝트의 버튼이고, 역할은 그 위의 **차이**다.
 * 역할마다 그리기를 새로 쓰면 여섯 단계가 네 벌이 되고, 그 중 하나가 언젠가
 * 다르게 움직인다.
 *
 * 핵심은 RETREAT 다: **채워지지 않고 그림자가 없다.** 나머지 셋은 떠 있고 이것만
 * 평평하다. 그 하나로 "이건 앞으로, 저건 뒤로" 가 색을 읽기 전에 읽힌다.
 *
 * @param {string} role  `ROLE` 의 값
 * @param {string} state `skinFor` 의 상태
 */
export function roleSkin(role, state = 'idle') {
  const accentFor = {
    [ROLE.CHOICE]: PALETTE.accent.cyan,
    [ROLE.COMMIT]: PALETTE.accent.cyan,
    [ROLE.RETREAT]: PALETTE.ui.edgeStrong,
    [ROLE.DESTRUCTIVE]: PALETTE.accent.orange,
  };
  const base = skinFor(state, accentFor[role] ?? PALETTE.accent.cyan);
  if (state === 'disabled') return base;

  switch (role) {
    case ROLE.COMMIT:
      return {
        ...base,
        top: PALETTE.accent.cyanPale,
        bottom: PALETTE.accent.cyan,
        edge: PALETTE.accent.cyanDeep,
        text: PALETTE.ui.textOnAccent,
        glossAlpha: 0.9,
        bounceAlpha: 0,
      };
    case ROLE.DESTRUCTIVE:
      return {
        ...base,
        top: mix(PALETTE.accent.orange, PALETTE.ui.glossHi, 0.45),
        bottom: PALETTE.accent.orange,
        edge: PALETTE.accent.orangeDeep,
        text: PALETTE.ui.textOnAccent,
        glossAlpha: 0.9,
        bounceAlpha: 0,
      };
    case ROLE.RETREAT:
      /**
       * 채우지 않는다. 흰색 알파 0.35 한 겹이 전부다.
       *
       * `top` 과 `bottom` 이 같은 값이라 `drawGelBody` 의 허리선이 만들어지지
       * 않는다 — 그라디언트의 두 끝이 같으면 중간 정지점도 같은 색이 된다.
       * 부록이 "허리선 없음" 이라고 적은 것을 그리기 코드를 건드리지 않고 얻는다.
       */
      return {
        ...base,
        top: PALETTE.ui.glossHi,
        bottom: PALETTE.ui.glossHi,
        fillAlpha: 0.35,
        edge: PALETTE.ui.edgeOuter,
        text: PALETTE.ui.textMuted,
        glossAlpha: 0.4,
        innerAlpha: 0,
        bounceAlpha: 0,
        elevation: ELEVATION.flat,
      };
    default:
      return base;
  }
}

/**
 * 역할을 가진 버튼 한 장.
 *
 * `gelButton` 을 대체하지 않는다 — 저쪽은 역할이라는 개념이 없던 시절의 것이고
 * 카드 뒷면·칩·타일처럼 역할이 없는 표면도 그린다. 이쪽은 **누르면 무언가가
 * 일어나는 것**만 그린다.
 *
 * @param {object} o
 * @param {string} o.role
 * @param {string} [o.state]
 * @param {boolean} [o.selected]  CHOICE 가 선택된 상태인가 (바깥 링)
 */
export function roleButton(ctx, o) {
  const {
    x, y, w, h, label, role, state = 'idle', selected = false,
    align = 'center', radius = RADIUS.pill, elevation = null,
    /**
     * 라벨이 쓸 수 있는 폭과 그 중심. 기본은 버튼 전체.
     *
     * 도장이 붙는 판("준비 중")은 오른쪽 일부를 도장에 내주므로, 라벨은 남은
     * 왼쪽에서 가운데를 잡아야 한다. 그걸 호출부가 직접 그리면 라벨을 그리는 곳이
     * 둘이 되고, 둘이 되면 서체나 엠보스가 언젠가 갈린다.
     */
    labelWidth = w,
  } = o;
  const skin = roleSkin(role, state);

  // RETREAT 는 테두리가 2px 다. 채워지지 않은 것이 얇은 선까지 두르면 사라진다.
  const border = role === ROLE.RETREAT ? 2 : 1.5;
  drawGelBody(ctx, {
    x, y, w, h, radius, skin,
    waist: 0.52,
    glossFraction: 0.46,
    glossInset: 0.1,
    border,
    elevation,
  });

  /**
   * 선택 표시는 판 **안쪽**에 그린다.
   *
   * `focusRing` 은 판 바깥으로 2px 나가고 12px 번진다. 판 텍스처의 캔버스는 판과
   * 정확히 같은 크기라, 그 링은 네 변에서 직선으로 잘렸다 — 둥근 끝 좌우에 청록색
   * 조각이 사각형으로 남았고, 사용자가 "선택 표시가 이상하게 잘려 보인다" 고 한
   * 것이 그것이다.
   *
   * 캔버스를 키우는 것이 다른 답이지만 그러면 판 쿼드가 슬롯보다 커져 이웃과
   * 겹치고, 그 겹침은 레이캐스트 순서로 임의로 갈린다. 링을 안으로 들이는 쪽이
   * 잃는 것이 없다 — 선택은 판의 상태이지 판 주변의 사건이 아니다.
   */
  if (selected) {
    ctx.save();
    ctx.strokeStyle = PALETTE.accent.cyan;
    ctx.lineWidth = 2.5;
    const p = border + 2;
    roundRectPath(ctx, x + p, y + p, w - p * 2, h - p * 2, radius);
    ctx.stroke();
    ctx.restore();
  }

  if (!label) return;
  ctx.save();
  ctx.globalAlpha = skin.alpha < 1 ? 0.85 : 1;
  const type = role === ROLE.CHOICE ? TYPE.title : TYPE.label;
  const probe = ctx;
  const fitted = fitText(probe, label, type, labelWidth - Math.max(SPACE.md, h * 0.7));
  ctx.font = fitted.font;
  ctx.textAlign = align === 'left' ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  applyTracking(ctx, type.tracking);
  const tx = align === 'left' ? x + h * 0.42 : x + labelWidth / 2;
  /**
   * 엠보스는 밝은 판에서만. 채워진 COMMIT·DESTRUCTIVE 위의 흰 글자에 흰 그림자를
   * 깔면 글자가 두꺼워 보이기만 하고 떠 보이지 않는다.
   */
  if (role === ROLE.CHOICE || role === ROLE.RETREAT) {
    ctx.fillStyle = withAlpha(PALETTE.ui.glossHi, 0.35);
    ctx.fillText(fitted.text, tx, y + h / 2 + 1);
  }
  ctx.fillStyle = skin.text;
  ctx.fillText(fitted.text, tx, y + h / 2);
  applyTracking(ctx, 0);
  ctx.restore();
}

/* ── the gel button ──────────────────────────────────────────────────────── */

/**
 * Steps 1-6 of the recipe: everything but the label.
 *
 * Split out because the panel wants the same stack with two steps changed, and
 * because the card face wants the body without a label on it.
 */
function drawGelBody(
  ctx,
  { x, y, w, h, radius, skin, waist, glossFraction, glossInset, border = 1.5, elevation = null },
) {
  ctx.save();
  ctx.globalAlpha = skin.alpha;

  // 1. Drop shadow, applied to the base fill only — every later step draws
  //    inside this shape and would otherwise stamp its own shadow on top.
  applyElevation(ctx, elevation ?? skin.elevation);

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
  ctx.save();
  // 채우기에만 걸리는 알파. `skin.fillAlpha` 의 주석에 왜 `alpha` 로는 안 되는지 있다.
  ctx.globalAlpha = skin.alpha * (skin.fillAlpha ?? 1);
  ctx.fillStyle = base;
  ctx.fill();
  ctx.restore();

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

  /**
   * 3. 윗면 광택. 몸통 안쪽으로 들어가 있어서 둘레로 바탕이 한 줄 보인다.
   *
   * ── 가로 안쪽 여백이 세로와 같으면 안 된다 ──────────────────────────────
   * `x + inset` 이었다. 알약에서 그건 틀리다: 알약의 왼쪽 벽은 수직이 아니라
   * 반지름 `r` 의 원이므로, 광택의 **윗변**이 있는 높이에서 벽은 아직 한참
   * 안쪽에 있다. 그래서 광택이 벽을 뚫고 나갔고, 클립에 걸려 둥근 끝 위에
   * 수직으로 잘린 자국이 남았다 — 화면에서 그대로 보였다.
   *
   * 벽이 어디 있는지는 계산할 수 있다. 광택 윗변의 깊이 `d = inset` 에서
   * 모서리 원의 중심으로부터의 세로 거리는 `r - d` 이고, 그 높이에서 원이
   * 안쪽으로 들어온 양은 `r - sqrt(r² - (r-d)²)` 다. 그만큼 더 들여 놓으면
   * 광택은 어느 높이에서도 몸통 안이다.
   *
   * 윗변에서 재는 것은 그곳이 가장 좁기 때문이다. 아래로 갈수록 벽은 벌어진다.
   */
  if (skin.glossAlpha > 0) {
    const inset = h * glossInset;
    const glossH = h * glossFraction;
    const r = Math.min(radius, w / 2, h / 2);
    const dy = Math.max(0, r - inset);
    const dx = r - Math.sqrt(Math.max(0, r * r - dy * dy));
    const gx = inset + dx;
    const gw = Math.max(1, w - gx * 2);
    const gloss = ctx.createLinearGradient(0, y + inset, 0, y + inset + glossH);
    gloss.addColorStop(0, withAlpha(PALETTE.ui.glossHi, skin.glossAlpha));
    gloss.addColorStop(1, withAlpha(PALETTE.ui.glossLo, 0));
    roundRectPath(ctx, x + gx, y + inset, gw, glossH, r);
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
  ctx.lineWidth = border;
  roundRectPath(ctx, x + border / 2, y + border / 2, w - border, h - border, radius);
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
  const tx = align === 'left' ? x + h * 0.42 : x + labelWidth / 2;
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

/* ── the dialog skeleton ─────────────────────────────────────────────────── */

/**
 * 다이얼로그 패널 한 장: 제목 탭 · 몸통 · 푸터 구분선.
 *
 * ── 구분선이 이 함수의 존재 이유다 ─────────────────────────────────────────
 * 부록 B 가 "푸터 구분선은 생략 불가" 라고 적은 근거는 실측 가능한 것이다:
 * 여백만으로는 구역이 갈리지 않는다. 선택지 **사이에도** 여백이 있으므로, 마지막
 * 선택지와 뒤로가기 사이의 여백은 그저 조금 넓은 여백이고, 그러면 뒤로가기가
 * 목록의 마지막 항목처럼 보인다. 조사해 보니 이 프로젝트의 네 화면이 정확히 그
 * 상태였다.
 *
 * ── 제목 탭은 패널의 **모서리에 걸친다** ───────────────────────────────────
 * 패널 안에 제목을 쓰면 그것은 첫 번째 내용이다. 모서리에 걸친 탭은 내용이
 * 아니라 이름이고, 그 차이를 만드는 것은 탭이 패널의 상단 선을 **끊는다**는
 * 사실이다. 그래서 여기서 상단 선을 탭 폭만큼 비워 두고 다시 그린다.
 *
 * @param {object} o
 * @param {number} o.w  패널 폭
 * @param {number} o.h  패널 높이 (탭 제외)
 * @param {string} [o.title]
 * @param {number} [o.footerHeight]  0 이면 구분선도 푸터도 없다
 * @returns {{top: number, contentTop: number, contentBottom: number, footerTop: number}}
 *   `top` 은 탭까지 포함한 전체 상단이 패널 상단으로부터 얼마나 위인가 (음수).
 */
export function dialogPanel(ctx, o) {
  const {
    w, h, title = '', caption = '', footerHeight = PANEL.footerHeight,
    tabHeight = PANEL.titleTabHeight, padTop = PANEL.padTop, padX = PANEL.padX,
    divider = true,
    accent = PALETTE.accent.cyan,
  } = o;
  const tabH = title ? tabHeight : 0;

  /**
   * 탭 폭은 글자에 맞춘다. 고정 폭이면 짧은 제목이 상자 안에서 떠다니고 긴
   * 제목은 잘린다 — 이 프로젝트가 판마다 반복해서 배운 것이다.
   */
  let tabW = 0;
  if (title) {
    ctx.save();
    ctx.font = fontSpec(TYPE.label);
    applyTracking(ctx, TYPE.label.tracking);
    tabW = Math.min(
      w - PANEL.titleTabInset * 2,
      Math.ceil(ctx.measureText(title).width) + PANEL.titleTabPadX * 2,
    );
    tabW = Math.max(tabW, tabH * 2);
    ctx.restore();
  }

  const tabX = PANEL.titleTabInset;
  const bodyY = tabH;

  // ── 탭. 몸통보다 먼저 그린다: 몸통이 탭의 아랫변을 덮어 하나로 이어 준다.
  if (title) {
    ctx.save();
    applyElevation(ctx, ELEVATION.raised);
    ctx.beginPath();
    const r = RADIUS.chip;
    ctx.moveTo(tabX, bodyY);
    ctx.lineTo(tabX, bodyY - tabH + r);
    ctx.arcTo(tabX, 0, tabX + r, 0, r);
    ctx.lineTo(tabX + tabW - r, 0);
    ctx.arcTo(tabX + tabW, 0, tabX + tabW, r, r);
    ctx.lineTo(tabX + tabW, bodyY);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, bodyY);
    g.addColorStop(0, PALETTE.ui.glassTop);
    g.addColorStop(1, PALETTE.ui.glassBottom);
    ctx.fillStyle = g;
    ctx.fill();
    clearShadow(ctx);
    ctx.strokeStyle = PALETTE.ui.edgeOuter;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  // ── 몸통.
  glassPanel(ctx, {
    x: 0,
    y: bodyY,
    w,
    h,
    radius: RADIUS.panel,
    accent,
    alpha: 1,
    elevation: ELEVATION.modal,
  });

  /**
   * 탭이 걸친 자리에서 몸통의 상단 선을 지운다.
   *
   * 지우지 않으면 탭 아래에 선이 하나 지나가고, 그러면 탭은 패널의 일부가 아니라
   * 패널 위에 올려 둔 다른 물건이 된다.
   */
  if (title) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(tabX + 1.5, bodyY - 2, tabW - 3, 4);
    ctx.clip();
    const g = ctx.createLinearGradient(0, bodyY - 2, 0, bodyY + 2);
    g.addColorStop(0, PALETTE.ui.glassTop);
    g.addColorStop(1, PALETTE.ui.glassTop);
    ctx.fillStyle = g;
    ctx.fillRect(tabX, bodyY - 2, tabW, 4);
    ctx.restore();

    applyTracking(ctx, TYPE.label.tracking);
    ctx.save();
    ctx.font = fontSpec(TYPE.label);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ui.text;
    ctx.fillText(title, tabX + tabW / 2, tabH / 2);
    ctx.restore();
    applyTracking(ctx, 0);
  }

  /**
   * 부제. 탭 바로 아래, 내용 위.
   *
   * 탭은 화면의 **이름**이고 이것은 그 화면이 지금 무엇에 대한 것인가다 — 어느
   * 모드의 상대를 고르는 중인가, 어느 모드로 접속하는가. 탭에 이어 붙이면 탭이
   * 길어져 이름으로 읽히지 않고, 내용 열에 넣으면 누를 수 있는 것으로 읽힌다.
   */
  let capH = 0;
  if (caption) {
    capH = SIZE.captionLine;
    ctx.save();
    ctx.font = fontSpec(TYPE.caption);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ui.textMuted;
    applyTracking(ctx, TYPE.caption.tracking);
    const fitted = fitText(ctx, caption, TYPE.caption, w - padX * 2);
    ctx.font = fitted.font;
    ctx.fillText(fitted.text, w / 2, bodyY + padTop * 0.5 + capH * 0.5);
    ctx.restore();
    applyTracking(ctx, 0);
  }

  /**
   * ── 푸터 구분선. 있을 수도 없을 수도 있다 ────────────────────────────────
   * 메뉴 화면은 그리지 않는다. 거기서는 푸터에 버튼이 한둘뿐이고, 그 버튼들이
   * 이미 열의 판과 크기도 모양도 색도 다르다 — 선까지 있으면 말이 두 번이다.
   * 모달은 계속 그린다: 거기서는 푸터 위가 흐르는 문장이라 어디까지가 읽는
   * 것이고 어디부터가 누르는 것인지 선이 아니면 알 수 없다.
   */
  const footerTop = bodyY + h - footerHeight;
  if (footerHeight > 0 && divider) {
    ctx.save();
    ctx.strokeStyle = withAlpha(PALETTE.ui.edge, 0.9);
    ctx.lineWidth = PANEL.dividerWeight;
    ctx.beginPath();
    ctx.moveTo(padX, footerTop + 0.5);
    ctx.lineTo(w - padX, footerTop + 0.5);
    ctx.stroke();
    ctx.restore();
  }

  return {
    tabHeight: tabH,
    contentTop: bodyY + padTop + capH,
    contentBottom: footerTop,
    footerTop,
  };
}

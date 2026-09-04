import { PALETTE, withAlpha } from '../core/palette.js';
import { CTA, PANEL, RADIUS, ROLE, RULE, SIZE, SPACE, TYPE } from '../core/tokens.js';
import { FONT_FAMILY } from './fonts.js';
import { hairline } from './marks.js';

/**
 * The surface language: paper, rules, and controls that are text.
 *
 * ── this file replaces `ui/glass.js`, and it is not a port ──────────────────
 * The file before it drew a Frutiger Aero control, and its opening note was
 * right about what that meant: "a gel control is not a colour, it is a sequence
 * — shadow, a base gradient with a value break at the waist, a gloss sweep inset
 * from the top, a one-pixel inner highlight, a bounce of accent light off the
 * bottom, then the border." Seven steps, and every surface in the game went
 * through them so the order was written down once.
 *
 * §19 and §24 of the new brief ban every one of those steps. What is left is not
 * a shorter recipe, it is a different claim about what a surface IS:
 *
 *   a SURFACE is one flat value of paper with one hairline around it
 *   a CONTROL is a word, a rule under the word, and — if it moves the screen —
 *     an arrow
 *
 * There is no gradient, no gloss, no elevation and no inner highlight, because
 * a sheet of paper has none of those. `ELEVATION` went with them.
 *
 * ── everything is in FRAME PIXELS ───────────────────────────────────────────
 * Callers oversample by setting `canvas.width = frameW * uiScale` and calling
 * `ctx.scale(uiScale, uiScale)` before drawing. Nothing here knows about that:
 * it draws at frame scale and the transform does the rest.
 */

/* ── shape ───────────────────────────────────────────────────────────────── */

/**
 * `roundRect` as a path, with a fallback.
 *
 * `CanvasRenderingContext2D.roundRect` landed late — Chrome 99, Safari 16.4,
 * Firefox 112 — so it is present in every current desktop browser and absent in
 * one a year or two old. Kept because the cost is a dozen lines that never run,
 * and the failure without it is a thrown TypeError at texture-bake time rather
 * than a square corner.
 *
 * The fallback is arcs rather than quadratics because a quadratic corner is
 * visibly not a circle even at `RADIUS.panel`, and a UI whose corners change
 * shape depending on the browser is worse than one whose corners are square.
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
 * 글자가 캔버스 밖으로 나가 잘렸다 — 좁은 프레임에서 턴 표시가 "PLAYER 1" 대신
 * "PLAYE" 였다.
 *
 * 사람 이름이 들어오는 자리이므로 순서가 중요하다. 먼저 글자 크기를 줄이고 —
 * 조금 작은 이름은 여전히 그 사람의 이름이다 — 최소 크기에서도 안 들어갈 때만
 * 자른다. 최소 크기는 원래의 76% 로, 그 아래는 옆의 다른 라벨과 다른 글씨체처럼
 * 보이기 시작하는 지점이다.
 *
 * ── 바닥이 9px 인 것은 이제 더 중요하다 ─────────────────────────────────────
 * 획이 얇은 단일 웨이트 서체로 바뀌었으므로 작은 글자가 예전보다 빨리 무너진다.
 * `TYPE.micro` 가 10px 이니 이 바닥은 그 한 칸 아래이고, 거기까지 줄여도 안 들어가면
 * 줄이는 것을 그만두고 자르는 것이 맞다.
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
 * `ctx.letterSpacing` is a 2023 addition. Setting an unsupported property is a
 * silent no-op rather than a throw, so the guard is only here to keep the value
 * from sticking on a context that DOES support it and was last used with
 * different tracking.
 *
 * It matters more than it did. Under a single-weight face the tracking in
 * `TYPE` is doing part of the job weight used to do — `micro` is tracked to
 * 0.6px specifically so 10px Hangul does not run together — so an engine that
 * silently drops it renders a measurably tighter UI. That is a degradation and
 * not a break, which is the right trade for one property.
 */
export function applyTracking(ctx, tracking) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${tracking || 0}px`;
}

/* ── skins ───────────────────────────────────────────────────────────────── */

/**
 * The ink, the rule and the wash for a state.
 *
 * Separated from the drawing so a state is a data change rather than a branch
 * inside every step, and so a caller can ask what a state looks like without
 * drawing it — `hudTextures` and `menuTextures` both tint things directly and
 * need the same answer the drawing would have given.
 *
 * ── hover and pressed are deliberately identical to idle ───────────────────
 * A standing decision, recorded at length in `menu/MenuItems.js`: the menu's
 * plates react to nothing. Border, size, gloss, shadow and movement were removed
 * one at a time until nothing was left, because a sign does not respond to being
 * looked at. The fold happens HERE rather than at each call site, so a screen
 * that asks for `hover` gets `idle` and no screen has to remember to.
 *
 * `selected` and `disabled` are STATES OF THE THING rather than states of the
 * pointer, so both survive.
 *
 * @returns {{text: string, rule: string, wash: ?string, accent: string,
 *            ruleWeight: number, alpha: number}}
 */
export function skinFor(state = 'idle', accent = PALETTE.cobalt) {
  const base = {
    text: PALETTE.ui.text,
    rule: PALETTE.ui.edgeStrong,
    wash: null,
    accent,
    ruleWeight: RULE.thin,
    alpha: 1,
  };

  switch (state) {
    case 'selected':
      return { ...base, text: accent, rule: accent, ruleWeight: RULE.mark };
    case 'disabled':
      return {
        ...base,
        text: PALETTE.ui.disabledText,
        rule: PALETTE.ui.disabledEdge,
        ruleWeight: RULE.hair,
        alpha: 0.5,
      };
    case 'dimmed':
      return { ...base, text: PALETTE.ui.textMuted, rule: PALETTE.ui.edge };
    default:
      // idle, hover, pressed. See the note above.
      return base;
  }
}

/**
 * 역할이 무엇으로 보이는가.
 *
 * ── 채워진 액센트 판이 화살표가 됐다 ───────────────────────────────────────
 * 이전 판에서 역할을 구분하던 것은 채우기였다: COMMIT 은 액센트로 채워진 유일한
 * 버튼, RETREAT 은 채우지 않고 테두리만, DESTRUCTIVE 는 경고색으로 채운 것. 채울
 * 판이 없어졌으므로 그 표는 통째로 다시 쓴다.
 *
 * 새 표에서 **방향은 화살표가, 무게는 밑줄이** 말한다:
 *
 *   COMMIT       →  오른쪽 화살표, 밑줄 mark, 잉크 cobalt
 *   RETREAT      ←  왼쪽 화살표,   밑줄 hair, 잉크 textMuted
 *   DESTRUCTIVE  →  오른쪽 화살표, 밑줄 mark, 잉크 danger
 *   CHOICE          화살표 없음,   밑줄 thin
 *
 * 화살표가 COMMIT 과 DESTRUCTIVE 에 둘 다 붙는 것은 둘 다 앞으로 가기 때문이고,
 * 둘은 색으로 갈린다 — 그리고 §부록 B 대로 한 화면에 동시에 있을 수 없다.
 *
 * @param {string} role  `ROLE` 의 값
 * @param {string} state `skinFor` 의 상태
 */
export function roleSkin(role, state = 'idle') {
  const base = skinFor(state, PALETTE.cobalt);
  if (state === 'disabled') return { ...base, arrow: null };

  switch (role) {
    case ROLE.COMMIT:
      return {
        ...base,
        text: PALETTE.cobalt,
        rule: PALETTE.cobalt,
        ruleWeight: RULE.mark,
        arrow: 'right',
      };
    case ROLE.DESTRUCTIVE:
      return {
        ...base,
        text: PALETTE.ui.danger,
        rule: PALETTE.ui.danger,
        accent: PALETTE.ui.danger,
        ruleWeight: RULE.mark,
        arrow: 'right',
      };
    case ROLE.RETREAT:
      return {
        ...base,
        text: PALETTE.ui.textMuted,
        rule: PALETTE.ui.edge,
        ruleWeight: RULE.hair,
        arrow: 'left',
      };
    default:
      return { ...base, arrow: null };
  }
}

/* ── surfaces ────────────────────────────────────────────────────────────── */

/**
 * A sheet of paper: one flat value, one hairline.
 *
 * Replaces `gelButton`, and the name changed because what it draws changed. It
 * is no longer a button — a button has no box under this direction — it is the
 * surface a few things still need: a card's back, a chip, a settings row, the
 * plate a menu item is printed on.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {string} [o.label]
 * @param {'idle'|'hover'|'pressed'|'selected'|'disabled'|'dimmed'} [o.state]
 * @param {string} [o.accent]  the ink and rule when `selected`
 * @param {'left'|'center'} [o.align]
 * @param {?string} [o.fill]  overrides the paper. `null` draws no fill at all.
 */
export function plate(ctx, o) {
  const {
    x, y, w, h, label, align = 'center', radius = RADIUS.chip,
    fill = PALETTE.ui.surface, border = true, labelWidth = w,
  } = o;
  const skin = skinFor(o.state, o.accent);

  ctx.save();
  ctx.globalAlpha = skin.alpha;

  if (fill) {
    roundRectPath(ctx, x, y, w, h, radius);
    ctx.fillStyle = skin.wash ?? fill;
    ctx.fill();
  }

  if (border) {
    /**
     * 테두리는 안쪽으로 반 픽셀 들여 그린다.
     *
     * `roundRectPath` 로 딱 맞는 경로를 그리고 `stroke()` 하면 선의 절반이 판
     * 바깥으로 나간다. 판이 자기 캔버스에 딱 맞게 구워지는 경우 — 메뉴 판이
     * 그렇다 — 그 절반은 잘린다. 그러면 테두리가 실제 굵기의 절반으로 나오고,
     * `RULE.hair` 에서 그것은 선이 아니라 얼룩이다.
     */
    const inset = skin.ruleWeight / 2;
    roundRectPath(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, radius);
    ctx.strokeStyle = skin.rule;
    ctx.lineWidth = skin.ruleWeight;
    ctx.stroke();
  }
  ctx.restore();

  if (!label) return;

  ctx.save();
  /**
   * The label does NOT take the body's alpha.
   *
   * A disabled control recedes, and that is right for the PLATE. Applied to the
   * type as well it makes the label unreadable over the backdrop, and "disabled"
   * has to stay legible: §11 requires the usable / unusable / silenced states of
   * the card hand to be told apart, and a button whose label you cannot read is
   * not distinguishable from one that failed to draw. So the sheet recedes and
   * the word stays.
   */
  ctx.globalAlpha = skin.alpha < 1 ? 0.85 : 1;
  ctx.font = fontSpec(TYPE.label);
  ctx.textAlign = align === 'left' ? 'left' : 'center';
  ctx.textBaseline = 'middle';
  applyTracking(ctx, TYPE.label.tracking);
  ctx.fillStyle = skin.text;
  ctx.fillText(label, align === 'left' ? x + SPACE.md : x + labelWidth / 2, y + h / 2);
  applyTracking(ctx, 0);
  ctx.restore();
}

/**
 * A panel: the same paper, opaque, with a larger radius.
 *
 * Replaces `glassPanel`. The three differences that file listed — translucency,
 * no waist break, a shorter gloss — were all differences from a gel button, and
 * two of the three no longer exist to differ from. What is left is the radius
 * and the fact that a panel does not carry a label.
 *
 * ── it is opaque, and that is the change ───────────────────────────────────
 * The glass panel let the scene through at alpha 0.88 because translucency was
 * what read as glass. Paper is not translucent, and on a bright backdrop a panel
 * at 0.88 picked up whatever was behind it — which for a modal is the game, so
 * the type sat on a moving background. `alpha` survives as a parameter because
 * the layers fade panels in and out; its DEFAULT is 1.
 */
export function panel(ctx, o) {
  const {
    x, y, w, h,
    radius = RADIUS.panel,
    alpha = 1,
    fill = PALETTE.ui.surface,
    rule = PALETTE.ui.edge,
    ruleWeight = RULE.thin,
  } = o;

  ctx.save();
  ctx.globalAlpha = alpha;
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  const inset = ruleWeight / 2;
  roundRectPath(ctx, x + inset, y + inset, w - inset * 2, h - inset * 2, radius);
  ctx.strokeStyle = rule;
  ctx.lineWidth = ruleWeight;
  ctx.stroke();
  ctx.restore();
}

/**
 * The focus / selection ring.
 *
 * ── the glow is gone ───────────────────────────────────────────────────────
 * It was a 2px accent stroke plus a 12px blurred glow of the same colour. The
 * glow was an aero halo and §24 bans it; it also cost this project a visible
 * bug, because a blurred ring drawn outside a shape gets square-clipped by a
 * canvas sized to the shape. What is left is a `RULE.mark` stroke, inset rather
 * than outset, which cannot be clipped and cannot be confused with the hairline
 * it sits inside because it is twice the weight and a different colour.
 */
export function focusRing(ctx, { x, y, w, h, radius = RADIUS.chip, accent = PALETTE.cobalt }) {
  ctx.save();
  ctx.strokeStyle = accent;
  ctx.lineWidth = RULE.mark;
  roundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, Math.max(0, radius - 1));
  ctx.stroke();
  ctx.restore();
}

/* ── the control ─────────────────────────────────────────────────────────── */

/**
 * An arrow, drawn rather than typed.
 *
 * `→` exists in the bundled subset, and using it would still be wrong: at 13px
 * the face's arrow is a hairline stem with a small head, it sits on the text
 * baseline rather than on the label's optical centre, and its weight is the
 * face's rather than `RULE`'s. Three strokes give an arrow that matches the rule
 * under it, which is the point — the arrow and the underline are one mark.
 */
function arrowHead(ctx, x, y, size, dir, color, weight) {
  /**
   * 인자 하나가 빠지면 **보이지 않는 화살표**가 그려진다.
   *
   * 실제로 그랬다. `dir` 을 빼고 부르니 `color` 자리에 굵기가, `dir` 자리에
   * 색 문자열이 들어갔고 — canvas 는 `strokeStyle` 에 숫자를 넣으면 조용히
   * 무시하므로 — 이전 획 색 그대로, 흰 종이 위에 흰 화살표가 그려졌다. 오류도
   * 없고 스크린샷에도 아무것도 없었다.
   */
  if (dir !== 'left' && dir !== 'right') throw new Error(`arrowHead: bad dir ${dir}`);
  const s = dir === 'left' ? -1 : 1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - (s * size) / 2, y);
  ctx.lineTo(x + (s * size) / 2, y);
  ctx.moveTo(x + (s * size) / 2 - s * size * 0.34, y - size * 0.28);
  ctx.lineTo(x + (s * size) / 2, y);
  ctx.lineTo(x + (s * size) / 2 - s * size * 0.34, y + size * 0.28);
  ctx.stroke();
  ctx.restore();
}

/**
 * 역할을 가진 컨트롤 하나. 상자가 아니라 **글자와 밑줄**이다.
 *
 * ── 무엇이 그려지는가 ──────────────────────────────────────────────────────
 *
 *     선택됨 ·  라벨            ← CHOICE, 선택 상태면 앞에 점
 *              ─────
 *
 *     ← 뒤로          시작 →    ← RETREAT / COMMIT, 화살표가 방향을 말한다
 *       ────          ─────
 *
 * 밑줄은 **라벨 폭만큼만** 긋는다. 슬롯 폭만큼 그으면 그것은 밑줄이 아니라 칸을
 * 나누는 선이고, 세로로 쌓인 CHOICE 여러 개가 표처럼 보인다.
 *
 * ── 히트 영역은 여기서 그리지 않는다 ───────────────────────────────────────
 * `CTA.hitPadX/Y` 가 그리는 것과 누를 수 있는 것의 차이이고, 그 quad 는 각 레이어가
 * 자기 좌표계에서 만든다. 이 함수는 자기가 실제로 칠한 폭을 돌려주므로 — `width`,
 * `x` — 호출부가 거기에 패딩을 더해 quad 를 만들 수 있다.
 *
 * @param {object} o
 * @param {string} o.role
 * @param {string} [o.state]
 * @param {boolean} [o.selected]  CHOICE 가 선택된 상태인가
 * @returns {{x: number, width: number, height: number}} 실제로 칠한 자리
 */
export function roleButton(ctx, o) {
  const {
    x, y, w, h, label = '', role, state = 'idle', selected = false,
    align = 'center',
    /**
     * 라벨이 쓸 수 있는 폭과 그 중심. 기본은 슬롯 전체.
     *
     * 도장이 붙는 항목("준비 중")은 오른쪽 일부를 도장에 내주므로, 라벨은 남은
     * 왼쪽에서 가운데를 잡아야 한다. 그걸 호출부가 직접 그리면 라벨을 그리는 곳이
     * 둘이 되고, 둘이 되면 서체나 자간이 언젠가 갈린다.
     */
    labelWidth = w,
    type = TYPE.body,
  } = o;
  const skin = roleSkin(role, state);
  const effective = selected && state !== 'disabled' ? skinFor('selected', skin.accent) : skin;
  const arrow = skin.arrow;

  const cy = y + h / 2;
  const arrowSize = type.size * 0.72;
  const markSize = type.size * 0.34;

  ctx.save();
  ctx.globalAlpha = skin.alpha < 1 ? 0.85 : 1;
  applyTracking(ctx, type.tracking);
  const fitted = fitText(
    ctx,
    label,
    type,
    labelWidth - (arrow ? arrowSize + CTA.arrowGap : 0) - (selected ? markSize * 3 : 0),
  );
  ctx.font = fitted.font;
  ctx.textBaseline = 'middle';

  /**
   * 전체 폭을 먼저 구하고 나서 정렬한다.
   *
   * 화살표와 선택 점이 라벨의 일부이므로, 라벨만 가운데 맞추면 화살표가 붙는
   * 쪽으로 덩어리 전체가 밀린다. 눈에 띄는 크기다 — 13px 라벨에 9px 화살표면
   * 중심이 5px 어긋난다.
   */
  const markRoom = selected ? markSize * 3 : 0;
  const arrowRoom = arrow ? arrowSize + CTA.arrowGap : 0;
  const total = markRoom + fitted.width + arrowRoom;
  const left = align === 'left' ? x : x + (labelWidth - total) / 2;

  let cursor = left;
  if (selected) {
    // `·` — 지금 있는 곳. `ui/marks.js` 의 표.
    ctx.fillStyle = effective.accent;
    ctx.beginPath();
    ctx.arc(cursor + markSize, cy, markSize / 2, 0, Math.PI * 2);
    ctx.fill();
    cursor += markRoom;
  }
  if (arrow === 'left') {
    arrowHead(ctx, cursor + arrowSize / 2, cy, arrowSize, 'left', effective.text, effective.ruleWeight);
    cursor += arrowRoom;
  }

  const textX = cursor;
  ctx.textAlign = 'left';
  ctx.fillStyle = effective.text;
  ctx.fillText(fitted.text, textX, cy);
  cursor += fitted.width;

  if (arrow === 'right') {
    arrowHead(
      ctx,
      cursor + CTA.arrowGap + arrowSize / 2,
      cy,
      arrowSize,
      'right',
      effective.text,
      effective.ruleWeight,
    );
  }
  applyTracking(ctx, 0);

  // 밑줄. 라벨 폭만큼, 베이스라인 아래로 `CTA.underlineGap`.
  hairline(
    ctx,
    textX,
    cy + type.size * 0.5 + CTA.underlineGap,
    textX + fitted.width,
    cy + type.size * 0.5 + CTA.underlineGap,
    effective.rule,
    effective.ruleWeight,
  );
  ctx.restore();

  return { x: textX, width: fitted.width, height: type.size + CTA.underlineGap };
}

/* ── the dialog skeleton ─────────────────────────────────────────────────── */

/**
 * 다이얼로그 패널 한 장: 제목 탭 · 몸통 · 푸터 구분선.
 *
 * ── 구분선이 이 함수의 존재 이유다 ─────────────────────────────────────────
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
 * ── 종이가 되면서 잃은 것과 얻은 것 ────────────────────────────────────────
 * 그림자 세 단(`ELEVATION.raised` 탭, `.modal` 몸통)이 사라졌다. 그것이 패널을
 * 배경에서 떼어 놓고 있었으므로, 대신 테두리가 `RULE.thin` 으로 올라간다 — 몸통의
 * 유일한 경계다. 탭은 `RULE.hair` 로 남긴다: 탭이 몸통보다 굵은 선을 두르면 탭이
 * 앞에 있는 것으로 읽히는데, 탭은 몸통의 일부다.
 *
 * @param {object} o
 * @param {number} o.w  패널 폭
 * @param {number} o.h  패널 높이 (탭 제외)
 * @param {string} [o.title]
 * @param {number} [o.footerHeight]  0 이면 구분선도 푸터도 없다
 */
export function dialogPanel(ctx, o) {
  const {
    w, h, title = '', caption = '', footerHeight = PANEL.footerHeight,
    tabHeight = PANEL.titleTabHeight, padTop = PANEL.padTop, padX = PANEL.padX,
    divider = true,
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
    ctx.beginPath();
    const r = RADIUS.chip;
    ctx.moveTo(tabX, bodyY);
    ctx.lineTo(tabX, bodyY - tabH + r);
    ctx.arcTo(tabX, 0, tabX + r, 0, r);
    ctx.lineTo(tabX + tabW - r, 0);
    ctx.arcTo(tabX + tabW, 0, tabX + tabW, r, r);
    ctx.lineTo(tabX + tabW, bodyY);
    ctx.closePath();
    ctx.fillStyle = PALETTE.ui.surface;
    ctx.fill();
    ctx.strokeStyle = PALETTE.ui.edge;
    ctx.lineWidth = RULE.hair;
    ctx.stroke();
    ctx.restore();
  }

  // ── 몸통.
  panel(ctx, { x: 0, y: bodyY, w, h, radius: RADIUS.panel });

  /**
   * 탭이 걸친 자리에서 몸통의 상단 선을 지운다.
   *
   * 지우지 않으면 탭 아래에 선이 하나 지나가고, 그러면 탭은 패널의 일부가 아니라
   * 패널 위에 올려 둔 다른 물건이 된다.
   */
  if (title) {
    ctx.save();
    ctx.fillStyle = PALETTE.ui.surface;
    ctx.fillRect(tabX + RULE.thin, bodyY - 2, tabW - RULE.thin * 2, 4);
    ctx.restore();

    ctx.save();
    ctx.font = fontSpec(TYPE.label);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = PALETTE.ui.text;
    applyTracking(ctx, TYPE.label.tracking);
    ctx.fillText(title, tabX + tabW / 2, tabH / 2);
    applyTracking(ctx, 0);
    ctx.restore();
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
    applyTracking(ctx, 0);
    ctx.restore();
  }

  /**
   * ── 푸터 구분선. 있을 수도 없을 수도 있다 ────────────────────────────────
   * 메뉴 화면은 그리지 않는다. 거기서는 푸터에 버튼이 한둘뿐이고, 그 버튼들이
   * 이미 화살표를 달고 있어 열의 항목과 다르다 — 선까지 있으면 말이 두 번이다.
   * 모달은 계속 그린다: 거기서는 푸터 위가 흐르는 문장이라 어디까지가 읽는
   * 것이고 어디부터가 누르는 것인지 선이 아니면 알 수 없다.
   */
  const footerTop = bodyY + h - footerHeight;
  if (footerHeight > 0 && divider) {
    hairline(ctx, padX, footerTop, w - padX, footerTop, PALETTE.ui.edge, PANEL.dividerWeight);
  }

  return {
    tabHeight: tabH,
    contentTop: bodyY + padTop + capH,
    contentBottom: footerTop,
    footerTop,
  };
}

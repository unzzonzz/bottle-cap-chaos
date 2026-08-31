/**
 * The shape language: radii, sizes, spacing, type, elevation, motion.
 *
 * ── the unit is a FRAME PIXEL ───────────────────────────────────────────────
 * Everything here is in the virtual 640-wide box `core/frame.js` lays out in.
 * That coordinate system is kept and the old CONSTANTS are not: the previous UI
 * was authored as 104-wide buttons, 42-tall score plates and 16px type, which is
 * a dense arrangement of small elements. The direction asks for the opposite —
 * fewer things, larger. So the coordinate system is reused and every number in
 * it was re-picked.
 *
 * ── these are the only numbers ──────────────────────────────────────────────
 * A layout file that invents a constant is a layout file that will disagree with
 * the next one. If something is missing, add it HERE and reference it.
 *
 * ── touch targets ──────────────────────────────────────────────────────────
 * `frame.js` guarantees at least `MIN_CSS_PX_PER_FRAME_PX` (1.25) CSS pixels per
 * frame pixel, so a frame-pixel size multiplied by 1.25 is the smallest it can
 * ever be rendered. `buttonSecondary` at 160x56 is 200x70 CSS px at the floor,
 * and `buttonIcon` at 64x64 is 80x80 — both clear the 44pt minimum with room.
 * `assertTouchTarget` below is the check, so a future size cannot quietly drop
 * under it.
 */

/**
 * ── 이 상수가 `frame.js` 가 아니라 여기 있는 이유는 순환 import 다 ──────────
 * 원래 `frame.js` 에 있었고 이 파일이 거기서 가져왔는데, `frame.js` 는 밴드 높이를
 * 계산하려고 이 파일의 `SIZE` 와 `SPACE` 를 module 스코프에서 읽는다. 둘이 서로를
 * module 스코프에서 읽으면 **먼저 평가되는 쪽이 상대의 절반만 본다** — 어느 쪽이
 * 먼저인지는 import 그래프의 우연이라, 앱에서는 우연히 맞고 이 파일 하나만 실행하면
 * `Cannot access 'SPACE' before initialization` 으로 죽었다.
 *
 * 화면 픽셀당 프레임 픽셀 수는 **크기**에 관한 사실이지 레이아웃에 관한 사실이
 * 아니므로 여기가 원래 자리다. 이제 의존은 한 방향이다: frame -> tokens.
 */
/**
 * How many CSS pixels one frame pixel must be worth, at minimum.
 *
 * ── this is THE dial for how big the UI is on a phone ────────────────────────
 * Every UI constant in the project is in frame pixels — a 104-wide button, a
 * 208-wide score, 16px type — and how large any of them LOOKS is entirely
 * `canvasCssWidth / frame.width`. On a desktop window that ratio is about 1.97,
 * so the 나가기 button is 205 CSS px across and its label is 31 px. On a phone
 * with the frame pinned at 640 the same button is 65 CSS px with a 10 px label,
 * which is why it was unreadable: identical PROPORTIONS, a third of the size.
 *
 * Making the frame narrower on a narrow screen fixes it in one number, because
 * every constant scales together and none of the relationships between them
 * change. The proportions stay exactly as authored; only the ratio moves.
 *
 * ── why 1.25 and not PC parity ───────────────────────────────────────────────
 * Matching a desktop EXACTLY would need a ratio of ~1.97, i.e. a frame 204 wide
 * on a 402-px phone — and then the button is 205 CSS px, which is 51% of the
 * screen. That is what "the same physical size" actually costs when the screen
 * is a third as wide, and it is too much: one button would be half the width of
 * the game.
 *
 * 1.25 doubles the old size and lands where it matters:
 *
 *     button  130 x 42 CSS px   (hit quad 67 px — clears the 44pt minimum)
 *     label   20 CSS px         (was 10)
 *     note    16 CSS px         (was 8)
 *     card    173 CSS px wide   (was 80)
 *
 * Raise it if you want them bigger still; nothing else has to change.
 */
export const MIN_CSS_PX_PER_FRAME_PX = 1.25;

/**
 * Corner radii.
 *
 * `pill` is a sentinel rather than a measurement: canvas `roundRect` clamps a
 * radius to half the shorter side, so any large number gives a true pill and the
 * call site never has to know the height.
 */
export const RADIUS = {
  pill: 9999,
  panel: 20,
  card: 16,
  chip: 12,
};

/**
 * Element sizes, in frame pixels.
 *
 * `scorePlate` is 300x84 against the old 208x42 — four times the area. That is
 * the single clearest expression of the direction in this file: the score is the
 * one thing read from across the room, and it was previously the same size as
 * the buttons next to it.
 *
 * `cardExposure` is how much of a card shows above the bottom edge while it is
 * parked in the hand. It is NOT `card.h` minus a margin — the fan rotates each
 * card, so the exposed height is measured on the rotated card and the fan radius
 * has to be re-solved when this changes. See `CardHand`.
 */
export const SIZE = {
  buttonPrimary: { w: 200, h: 64 },
  buttonSecondary: { w: 160, h: 56 },
  buttonIcon: { w: 64, h: 64 },

  scorePlate: { w: 300, h: 84 },
  turnPlate: { w: 240, h: 44 },
  clockBar: { w: 240, h: 10 },

  card: { w: 150, h: 220 },
  /**
   * CHOICE. 패널 폭에서 `PANEL.padX * 2` 를 뺀 값에 맞춘다.
   *
   * 448 - 24*2 = 400. 두 숫자가 따로 적혀 있으면 언젠가 하나만 바뀌므로, 이
   * 관계는 `panelLayout.js` 가 계산해서 쓴다 — 여기 400 은 저술된 기준값이다.
   */
  buttonChoice: { w: 400, h: 64 },
  /** COMMIT / RETREAT / DESTRUCTIVE. 푸터 안. */
  buttonFooter: { w: 150, h: 52 },
  cardExposure: 72,

  modal: { w: 440, h: 260 },
};

/**
 * Spacing scale. Multiples of roughly 1.5, so two steps is a clear jump.
 *
 * `screenMargin` is the distance from the frame edge to anything anchored
 * against it, and it is deliberately larger than `md`: the Wii look is mostly
 * this number. `groupGap` separates information that answers different questions
 * — the score and the turn indicator are two groups, not one stack.
 */
export const SPACE = {
  xs: 8,
  sm: 14,
  md: 22,
  lg: 36,
  xl: 56,
  screenMargin: 28,
  groupGap: 36,
};

/**
 * Type scale, in frame pixels.
 *
 * `tracking` is in frame pixels per character, applied by the text renderer —
 * canvas 2D has `letterSpacing` in newer engines but not everywhere this ships,
 * so anything relying on it has to degrade to zero rather than throw.
 *
 * `display` is negative-tracked because at 44px the default spacing of a
 * monospace-ish numeral pair reads as two separate numbers rather than a score.
 */
export const TYPE = {
  display: { size: 44, weight: 700, tracking: -0.5 },
  title: { size: 26, weight: 700, tracking: 0 },
  body: { size: 20, weight: 400, tracking: 0 },
  label: { size: 17, weight: 700, tracking: 0.3 },
  caption: { size: 15, weight: 400, tracking: 0.2 },
};

/**
 * The weights that actually exist. Nothing above may name another one.
 *
 * ── why 400/700 and not the 400/500/600/700 this scale wanted ──────────────
 * Two static faces are bundled — see `NOTICE`. A weight this list does not
 * contain is not a slightly-off weight, it is a SYNTHESISED one: the browser
 * fakes 500 by smearing 400 and fakes 600 by smearing 700, and canvas 2D bakes
 * that smear into a texture where it cannot be undone. Faux-bold Hangul at 17px
 * closes the counters in 받침 and the text turns to mud.
 *
 * A variable font would have given the intermediate weights honestly, and is
 * not used on purpose: weight-axis selection through canvas 2D is unreliable in
 * the WKWebView this ships inside, and every piece of UI text here goes through
 * canvas.
 *
 * `body` and `caption` took 500 -> 400; `label` took 600 -> 700, because a label
 * is the one that has to hold up small and against a gradient.
 */
export const FONT_WEIGHTS = [400, 700];

for (const [name, t] of Object.entries(TYPE)) {
  if (!FONT_WEIGHTS.includes(t.weight)) {
    throw new Error(`TYPE.${name} asks for weight ${t.weight}, which is not bundled`);
  }
}

/**
 * Drop shadows, as canvas 2D parameters.
 *
 * The colour is always `PALETTE.ui.shadow` — a navy — and only the blur, the
 * vertical offset and the alpha change. Four steps, because a fifth would not be
 * distinguishable and because four maps onto the four things that exist: flat
 * surfaces, buttons, floating panels, and the modal.
 *
 * There is no horizontal offset anywhere. The key light is overhead; a sideways
 * shadow would contradict it and is the usual tell of UI assembled without one.
 */
export const ELEVATION = {
  flat: { blur: 0, dy: 0, alpha: 0 },
  raised: { blur: 10, dy: 3, alpha: 0.18 },
  floating: { blur: 20, dy: 6, alpha: 0.22 },
  modal: { blur: 34, dy: 10, alpha: 0.28 },
};

/**
 * Durations in seconds, and easing as cubic-bezier control points.
 *
 * No linear anywhere. `overshoot` passes 1 before settling — it is what makes a
 * button release feel sprung rather than merely fast, and it is the one curve
 * that must not be used on anything that would look wrong overshooting (a
 * progress bar, a clock).
 */
/**
 * 버튼의 역할. 모양이 아니라 **결과**로 나눈다.
 *
 * ── 시각적 차이는 장식이 아니라 정보다 ─────────────────────────────────────
 * 화면에서 무엇이 앞으로 나아가고 무엇이 물러나는지를 읽는 데 0.2초가 걸리면 안
 * 된다. 조사해 보니 이 프로젝트에는 그 구분이 아예 없었다 — 모든 버튼이 같은
 * 그림이었고, 그 결과 두 화면에서 확인과 취소의 좌우가 **반대로** 놓여 있었다.
 * 규칙이 없으면 맞는 화면도 우연히 맞은 것이다.
 *
 * 역할 없는 버튼을 만들지 마라. 하나를 고르지 못하겠다면 그것은 버튼이 무엇을
 * 하는지 아직 정하지 못했다는 뜻이다.
 */
export const ROLE = {
  /**
   * 고르는 것. 콘텐츠 구역에만 존재한다.
   *
   * 이것을 누르는 것이 이 화면에 온 이유다. 가장 크고, 가로로 길고, 세로로
   * 쌓인다. 여러 개가 나란히 있을 수 있고 그중 하나가 선택 상태다.
   */
  CHOICE: 'choice',
  /**
   * 확정하고 나아간다. 푸터 오른쪽에만.
   *
   * 화면당 최대 하나. 액센트로 **채워진** 유일한 버튼이므로, 화면에서 채워진
   * 액센트가 보이면 그것이 다음 단계다.
   */
  COMMIT: 'commit',
  /**
   * 물러난다. 푸터 왼쪽에만.
   *
   * 뒤로, 취소, 닫기. 테두리만 있고 채워지지 않으며 그림자도 없다. 채우지 않는
   * 이유는 물러나는 것이 이 화면의 목적이 아니기 때문이다 — 목적이 아닌 것이
   * 목적과 같은 무게를 가지면 안 된다.
   */
  RETREAT: 'retreat',
  /**
   * 되돌릴 수 없는 것. 마크 삭제 등.
   *
   * 경고색. 푸터 오른쪽에 오되 COMMIT 과 동시에 존재할 수 없다. 확인
   * 다이얼로그 안에서만 쓴다 — 목록 화면에 바로 두지 마라.
   */
  DESTRUCTIVE: 'destructive',
};

/**
 * 다이얼로그 패널의 골격. 단위는 프레임 픽셀.
 *
 * 이 값들이 만드는 것은 하나다: **고르는 구역과 끝내는 구역이 다른 구역이다.**
 * 그 둘을 가르는 것은 여백이 아니라 `dividerWeight` 의 선이다 — 여백은 선택지
 * 사이에도 있으므로 여백만으로는 "다른 구역"이 되지 않는다.
 */
export const PANEL = {
  /** 기본 크기. 내용에 따라 세로만 늘어난다. */
  width: 448,
  minHeight: 240,
  maxHeight: 400,
  /** 제목 탭. 패널 상단 모서리에 절반 걸친다. */
  titleTabHeight: 36,
  /** 탭 안쪽 좌우 여백. 탭 폭은 글자 폭 + 이것의 두 배. 고정 폭이 아니다. */
  titleTabPadX: 20,
  /** 패널 왼쪽 모서리에서 탭까지. */
  titleTabInset: 24,
  padX: 24,
  /** 제목 탭 아래. */
  padTop: 30,
  /** 0 인 것은 푸터가 바닥까지 가기 때문이다. */
  padBottom: 0,
  footerHeight: 80,
  dividerWeight: 1,
};

export const MOTION = {
  hover: 0.12,
  press: 0.07,
  release: 0.18,
  panel: 0.24,
  /**
   * 화면 하나가 다른 화면으로 바뀌는 데 걸리는 시간, **왕복**.
   *
   * `ui/pageFade.js` 의 `FADE_MS` 두 번이다 — 나가는 180ms 와 들어오는 180ms.
   * 그 파일에 왜 180 인지, 왜 가운데 정지가 따로 있어야 했는지가 실측과 함께
   * 적혀 있고, 여기는 그 합을 이름으로 들고 있을 뿐이다. 숫자를 바꾸려면 그
   * 파일과 `styles.css` 의 transition 을 함께 봐야 한다 — 셋이 같은 하나다.
   */
  screen: 0.36,

  easeOut: [0.16, 1, 0.3, 1],
  easeInOut: [0.65, 0, 0.35, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
};

/** Interaction scales. Small on purpose — 4% reads, 10% wobbles. */
export const SCALE = {
  hoverUp: 1.04,
  pressDown: 0.96,
};

/**
 * A cubic-bezier as a function of t, for driving the motion above.
 *
 * Newton's method on x(t), then y at that t. Four iterations from a linear seed
 * is well inside a pixel for every curve in `MOTION`, and it cannot fail to
 * converge for control points in [0, 1] — `overshoot` has y1 > 1, which affects
 * only the OUTPUT and never the x solve.
 */
export function cubicBezier([x1, y1, x2, y2]) {
  const ax = 3 * x1 - 3 * x2 + 1;
  const bx = 3 * x2 - 6 * x1;
  const cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1;
  const by = 3 * y2 - 6 * y1;
  const cy = 3 * y1;
  const xAt = (t) => ((ax * t + bx) * t + cx) * t;
  const dxAt = (t) => (3 * ax * t + 2 * bx) * t + cx;

  return (p) => {
    const x = Math.min(1, Math.max(0, p));
    let t = x;
    for (let i = 0; i < 4; i++) {
      const d = dxAt(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (xAt(t) - x) / d;
    }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}

/**
 * Does a frame-pixel size clear the 44pt touch minimum at the worst scale?
 *
 * Returns the CSS-pixel size so a caller can report it. Exported rather than run
 * at module load: sizes are picked here, but hit QUADS are sometimes larger than
 * the drawn plate (the cards' are), so the check belongs where the quad is.
 */
export function touchTargetCssPx({ w, h }) {
  return { w: w * MIN_CSS_PX_PER_FRAME_PX, h: h * MIN_CSS_PX_PER_FRAME_PX };
}

/** Throws if a size would render smaller than 44 CSS px on either axis. */
export function assertTouchTarget(name, size) {
  const css = touchTargetCssPx(size);
  if (css.w < 44 || css.h < 44) {
    throw new Error(
      `${name} is ${css.w.toFixed(0)}x${css.h.toFixed(0)} CSS px at the minimum ` +
        `frame scale, under the 44pt touch target`,
    );
  }
  return css;
}

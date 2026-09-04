/**
 * The shape language: radii, spacing, type, motion, and the one control recipe.
 *
 * ── the unit is a FRAME PIXEL ───────────────────────────────────────────────
 * Everything here is in the virtual 640-wide box `core/frame.js` lays out in.
 *
 * ── the scale runs the OTHER WAY now ────────────────────────────────────────
 * The version of this file before it made everything bigger. Its opening note
 * said so plainly: "the previous UI was authored as 104-wide buttons, 42-tall
 * score plates and 16px type, which is a dense arrangement of small elements.
 * The direction asks for the opposite — fewer things, larger." That was the Wii
 * reading, and §11 of the new brief asks for its inverse:
 *
 *   > Keep the HUD minimal. The gameplay field should dominate the screen.
 *   > UI should sit quietly around it. Use small typography, thin lines,
 *   > subtle symbols, minimal information, precise spacing.
 *
 * So the 300x84 score plate, the 200x64 primary button and the 44px display
 * type are gone, and what replaced them is smaller than either version: type
 * tops out at 15px, the heaviest line in the interface is 1.5px, and a control
 * is text with a rule under it rather than a plate with a label on it.
 *
 * ── these are the only numbers ──────────────────────────────────────────────
 * A layout file that invents a constant is a layout file that will disagree with
 * the next one. If something is missing, add it HERE and reference it.
 * `docs/tokens-audit.mjs` checks that every `SIZE.x` / `TYPE.y` in `src/`
 * resolves, because a missing key is `undefined`, and `undefined` in arithmetic
 * is a `NaN` that kills the canvas at bake time rather than at build time.
 */

/**
 * How many CSS pixels one frame pixel must be worth, at minimum.
 *
 * ── this is THE dial for how big the UI is ───────────────────────────────────
 * Every UI constant in the project is in frame pixels, and how large any of them
 * LOOKS is entirely `canvasCssWidth / frame.width`. On a desktop window that
 * ratio is about 1.97, so 15px body type is 30 CSS px. Pinning the frame at 640
 * inside a small window would make every one of them a third of that size —
 * identical PROPORTIONS, a third of the size — which is what this floor exists
 * to stop. Narrowing the frame on a narrow window scales all of them together
 * and leaves every proportion exactly as authored.
 *
 * ── this file no longer ships to a phone, and the number stayed ─────────────
 * It was picked against a 402-px phone, where 1.25 doubled the old sizes. There
 * is no phone build any more (see `core/frame.js`), so what it now guarantees is
 * a ceiling on how large the UI can get RELATIVE to the frame: half of 640 means
 * no authored constant can take more than twice the share of the screen it was
 * drawn to take. That is worth keeping on a desktop window dragged narrow, and
 * it is why the constant survived the mobile removal rather than going with it.
 */
export const MIN_CSS_PX_PER_FRAME_PX = 1.25;

/**
 * Corner radii.
 *
 * ── `pill` is gone, and so is most of the rest ─────────────────────────────
 * `pill` was 9999 — a sentinel that let `roundRect` clamp to a true pill — and
 * every horizontally long button used it. There are no pill buttons: §19 and
 * §24 of the brief ban gel controls, and a control here is text with a rule
 * under it, which has no corners at all.
 *
 * What is left is for the two things that are still surfaces: a modal panel and
 * a card. Both are small numbers, because a large radius is the tell of the
 * mobile-game card §24 names.
 */
export const RADIUS = {
  panel: 10,
  card: 8,
  chip: 6,
};

/**
 * Element sizes, in frame pixels.
 *
 * ── what is missing, and what changed meaning ──────────────────────────────
 * `buttonPrimary` `buttonSecondary` `cardExposure` are gone: a button is not a
 * box any more, and the exposure was a property of a fan of gel cards.
 *
 * `scorePlate` became `score` and it is not a rename. The old one was a 300x84
 * PLATE with numbers on it; this is the AREA the numbers occupy, with nothing
 * drawn behind them (§8.1). Everything else here is the same distinction: what
 * survives is a rectangle something is laid out in, never a rectangle something
 * is drawn as.
 *
 * `buttonIcon` and `buttonFooter` are HIT areas. Nothing is painted at either
 * size — something still has to be 44pt for a pointer to find it, and §8.1 is
 * explicit that the hit area is larger than the visible mark.
 */
export const SIZE = {
  /** Hit quad for an icon control. Nothing is drawn at this size. */
  buttonIcon: { w: 44, h: 44 },
  /** Hit quad for a footer control. Wider than its label, per `CTA.hitPad*`. */
  buttonFooter: { w: 120, h: 40 },
  /** Hit quad for a stacked choice. Full panel width minus the padding. */
  buttonChoice: { w: 400, h: 44 },

  /** The turn indicator's width, which is also the clock line's full length. */
  turnPlate: { w: 180, h: 28 },
  /**
   * The area the SCORE occupies. Not a plate — nothing is drawn behind it.
   *
   * It exists because `HudLayer` still has to reserve a rectangle in the corner
   * and hand a canvas that size to the texture. `h` is the lettering's em box
   * plus the caption line under it; `w` is what two three-digit numbers and a
   * colon need at that em, measured rather than guessed.
   */
  score: { w: 190, h: 52 },
  /**
   * The online turn clock.
   *
   * `w` must equal `turnPlate.w`: the clock sits under the turn indicator and a
   * line that starts wider or narrower than the thing it belongs to reads as a
   * different object. `h` is `RULE.mark` — it is a LINE, and §8.1 says it gets
   * shorter rather than emptier, so its thickness never changes.
   */
  clockBar: { w: 180, h: 1.5 },

  card: { w: 150, h: 220 },
  /**
   * 제목 아래 부제 한 줄이 차지하는 높이.
   *
   * `TYPE.caption.size * 1.4` 다. 그리는 쪽과 자리를 비우는 쪽이 서로 다른
   * 파일이라 — `ui/paper.dialogPanel` 과 `menu/panelLayout` — 둘이 같은 수를
   * 따로 계산하면 언젠가 한 픽셀씩 어긋난다.
   */
  captionLine: 17,

  modal: { w: 400, h: 230 },
};

/**
 * Spacing scale.
 *
 * §11 calls for "precise spacing", and on a page with no boxes and one line
 * weight, WHITESPACE IS THE PRIMARY TOOL — it is the only thing left that
 * groups. So the scale is longer at the top than the old one: `xl` and `xxl`
 * exist to separate regions that used to be separated by a panel edge.
 *
 * `screenMargin` is the distance from the frame edge to anything anchored
 * against it. It went up, not down: pushing the HUD further into the corners is
 * what lets the field dominate.
 */
export const SPACE = {
  xs: 6,
  sm: 10,
  md: 18,
  lg: 32,
  xl: 56,
  xxl: 88,
  screenMargin: 32,
};

/**
 * Line weights. There is nothing heavier than `mark`.
 *
 * §11 asks for thin lines and this is where that is enforceable: a caller that
 * wants a heavier rule has to add a step here, in front of the rule it is
 * breaking, rather than writing `lineWidth = 3` somewhere.
 */
export const RULE = {
  /** The quietest line the interface has. Sub-pixel on purpose. */
  hair: 0.75,
  thin: 1.0,
  /** Emphasis. The heaviest line in the game's UI. */
  mark: 1.5,
};

/**
 * Type scale, in frame pixels.
 *
 * ── every entry is weight 400, because there is only one weight ────────────
 * Gowun Dodum ships as a single static face. Asking for 700 does not give a
 * slightly-off weight, it gives a SYNTHESISED one: the browser fakes bold by
 * smearing the 400 outlines, canvas 2D bakes that smear into a texture where it
 * cannot be undone, and different engines smear by different amounts — so the
 * same build renders differently on two machines. Faux-bold Hangul at 13px
 * closes the counters in 받침 and the text turns to mud.
 *
 * That removes the usual way of making hierarchy. What is left is SIZE, COLOUR,
 * TRACKING and SPACE, and the two loudest things on any screen — the title and
 * the score — are not set in this face at all: they are vector letterforms in
 * `ui/lettering.js`. §5 of the brief asks for exactly that contrast, an
 * expressive display voice against a precise utility one, and a single-weight
 * face can only supply the second half of it.
 *
 * ── `display` and `title` are gone ─────────────────────────────────────────
 * They were 44px/700 and 26px/700. Both were the display voice, and the display
 * voice is drawn now.
 *
 * `tracking` is in frame pixels per character, applied by the text renderer.
 * The small sizes are tracked OPEN — at 10px, Gowun Dodum's thin strokes run
 * together without it, and the extra space is what buys back the legibility a
 * heavier weight would have provided.
 */
export const TYPE = {
  body: { size: 15, weight: 400, tracking: 0 },
  label: { size: 13, weight: 400, tracking: 0.4 },
  caption: { size: 12, weight: 400, tracking: 0.3 },
  /** Utility. §5's "tiny precise". See the legibility note in `fonts.js`. */
  micro: { size: 10, weight: 400, tracking: 0.6 },
};

/**
 * The weights that actually exist. Nothing above may name another one.
 *
 * One entry, and the loop below is what stops a second one being added by
 * accident. A variable font would have given intermediate weights honestly and
 * is not used on purpose: weight-axis selection through canvas 2D is unreliable,
 * and every piece of UI text here goes through canvas.
 */
export const FONT_WEIGHTS = [400];

for (const [name, t] of Object.entries(TYPE)) {
  if (!FONT_WEIGHTS.includes(t.weight)) {
    throw new Error(`TYPE.${name} asks for weight ${t.weight}, which is not bundled`);
  }
}

/**
 * A control, as a recipe rather than as a size.
 *
 * ── a button is not a box ──────────────────────────────────────────────────
 * It is a label, a rule under the label, and — when it moves the screen forward
 * or back — an arrow. `ui/paper.js` draws it; these are the numbers that draw
 * is made of.
 *
 * `hitPadX`/`hitPadY` are the gap between what is DRAWN and what is PRESSABLE.
 * The visible mark is now a line of 13px text, which is nowhere near 44 CSS px
 * tall, so the hit quad has to be grown deliberately and invisibly. At the
 * minimum frame scale a 13px label padded by 12 is 46 CSS px — `assertTouchTarget`
 * below is what keeps that true if either number moves.
 */
export const CTA = {
  /** Text baseline to the rule. */
  underlineGap: 5,
  underlineWeight: RULE.thin,
  /** Between the label and its arrow, as in `PLAY →`. */
  arrowGap: 8,
  hitPadX: 14,
  hitPadY: 12,
};

/**
 * 다이얼로그 패널의 골격. 단위는 프레임 픽셀.
 *
 * 이 값들이 만드는 것은 하나다: **고르는 구역과 끝내는 구역이 다른 구역이다.**
 * 그 둘을 가르는 것은 여백이 아니라 `dividerWeight` 의 선이다 — 여백은 선택지
 * 사이에도 있으므로 여백만으로는 "다른 구역"이 되지 않는다.
 *
 * 값이 전부 작아졌다. 판이 유리에서 종이가 되면서 테두리와 그림자가 만들던 여유가
 * 사라졌고, 그 여유를 여백으로 다시 사면 판이 프레임을 먹는다.
 */
export const PANEL = {
  width: 400,
  minHeight: 200,
  maxHeight: 360,
  /** 제목 탭. 패널 상단 모서리에 절반 걸친다. */
  titleTabHeight: 28,
  /** 탭 안쪽 좌우 여백. 탭 폭은 글자 폭 + 이것의 두 배. 고정 폭이 아니다. */
  titleTabPadX: 16,
  /** 패널 왼쪽 모서리에서 탭까지. */
  titleTabInset: 20,
  padX: 20,
  /** 제목 탭 아래. */
  padTop: 24,
  /** 0 인 것은 푸터가 바닥까지 가기 때문이다. */
  padBottom: 0,
  footerHeight: 62,
  dividerWeight: RULE.hair,
};

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
 *
 * 역할이 **무엇으로** 표현되는지는 바뀌었다. 채워진 액센트 판이 아니라 화살표의
 * 방향과 밑줄의 무게다 — `ui/paper.roleMark` 가 그 표다.
 */
export const ROLE = {
  /**
   * 고르는 것. 콘텐츠 구역에만 존재한다.
   *
   * 이것을 누르는 것이 이 화면에 온 이유다. 세로로 쌓이고, 여러 개가 나란히 있을
   * 수 있으며 그중 하나가 선택 상태다.
   */
  CHOICE: 'choice',
  /**
   * 확정하고 나아간다. 푸터 오른쪽에만.
   *
   * 화면당 최대 하나. **오른쪽 화살표를 가진 유일한 것**이므로, 화면에서 오른쪽
   * 화살표가 보이면 그것이 다음 단계다.
   */
  COMMIT: 'commit',
  /**
   * 물러난다. 푸터 왼쪽에만.
   *
   * 뒤로, 취소, 닫기. 왼쪽 화살표를 달고, 밑줄이 가장 얇다. 무게를 주지 않는
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
 * Durations in seconds, and easing as cubic-bezier control points.
 *
 * No linear anywhere. `overshoot` passes 1 before settling — it is what makes a
 * release feel sprung rather than merely fast, and it is the one curve that must
 * not be used on anything that would look wrong overshooting (a progress bar, a
 * clock).
 *
 * ── `hover` and `press` are still here, and the menu plates still ignore them ─
 * The menu's plates react to nothing, by an explicit and standing decision
 * recorded in `MenuItems.js`; §21 of the brief is satisfied by the split rather
 * than violated by it — a sign does not move, an object does. These durations
 * are for the objects.
 */
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
 * the drawn mark — under this direction they nearly always are — so the check
 * belongs where the quad is.
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

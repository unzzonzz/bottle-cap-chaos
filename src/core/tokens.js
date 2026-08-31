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

import { MIN_CSS_PX_PER_FRAME_PX } from './frame.js';

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
export const MOTION = {
  hover: 0.12,
  press: 0.07,
  release: 0.18,
  panel: 0.24,
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

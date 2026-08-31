import { MOTION, cubicBezier } from '../core/tokens.js';

/**
 * UI 의 움직임. 곡선 셋과, 값 하나를 목표로 끌고 가는 것 하나.
 *
 * ── 왜 스프링이 아닌가 ──────────────────────────────────────────────────────
 * 이 프로젝트에는 이미 스프링이 있다. `CardHand` 의 카드마다 x/y/scale/angle 네
 * 채널이 임계 미만 감쇠로 돌고 있고, 그 파일의 머리말이 왜 그래야 하는지 적어
 * 두었다 — 손에서 놓은 카드는 제자리를 지나쳤다가 돌아와야 하고, 이징 트윈은 그걸
 * 못 한다.
 *
 * 버튼은 다르다. 버튼의 호버는 **상태**이고 상태는 목표가 있다. 스프링을 붙이면
 * 포인터가 두 버튼 사이를 빠르게 지날 때 진동이 겹쳐 쌓이고, 그건 반응이 아니라
 * 노이즈다. 그래서 여기는 시간이 정해진 이징이다. 튀는 느낌이 필요한 곳 —
 * 나타나는 판, 눌렸다 놓인 버튼 — 에는 `overshoot` 곡선이 따로 있다.
 *
 * ── 곡선은 세 개뿐이고 시간은 다섯 개뿐이다 ─────────────────────────────────
 * `tokens.js` 의 `MOTION` 이 전부다. 한 화면에서 여섯 가지 속도로 움직이는 것들은
 * 서로 다른 프로그램에서 온 것처럼 보이고, 그건 이 작업이 없애려는 바로 그것이다.
 */

export const easeOut = cubicBezier(MOTION.easeOut);
export const easeInOut = cubicBezier(MOTION.easeInOut);
export const overshoot = cubicBezier(MOTION.overshoot);

/**
 * `value` 를 `target` 쪽으로 한 프레임만큼 옮긴다. 선형 진행이다.
 *
 * 곡선은 여기서 적용하지 않는다 — 결과에 `easeOut()` 을 씌우는 것은 호출부의
 * 일이다. 이유는 되돌아갈 때다: 진행도 자체에 곡선이 걸려 있으면 절반쯤 켜진
 * 상태에서 방향이 바뀔 때 속도가 튄다. 진행도를 선형으로 유지하고 읽는 쪽에서
 * 곡선을 씌우면, 어느 지점에서 방향이 바뀌어도 연속이다.
 *
 * @param {number} value    현재 진행도 0..1
 * @param {number} target   0 또는 1
 * @param {number} dt       초
 * @param {number} seconds  0 -> 1 에 걸리는 시간. `MOTION` 에서 고른다.
 */
export function approach(value, target, dt, seconds) {
  const step = dt / Math.max(1e-4, seconds);
  const d = target - value;
  if (Math.abs(d) <= step) return target;
  return value + Math.sign(d) * step;
}

/**
 * 컨트롤 하나의 호버·프레스 진행도.
 *
 * ── 한 번 없앴다가 되돌린 것이다. 범위가 다르기 때문이다 ────────────────────
 * 사용자가 "버튼이 커지거나 border 가 강조되는 효과 없애줘", "translate 도
 * 없애줘" 라고 했고, 그래서 `controlState`/`stepControl`/`controlScale`/
 * `hoverPlates` 넷을 지웠다. 그 지시가 가리킨 것은 **메뉴 판**이다 — 그때 화면에
 * 있던 것이 그것이고, `glass.skinFor` 가 호버와 프레스를 idle 로 접은 것도 거기다.
 *
 * 부록 B 는 그 규칙의 범위를 메뉴 판으로 못박고, 경기 화면의 버튼과 카드는 v2
 * §9.2 의 배율 피드백을 유지한다고 적었다. 경기 화면은 사정이 다르다: 마우스가
 * 아니라 손가락으로 누르고, 누르는 순간 손가락이 버튼을 가린다. 색이 바뀌는 것은
 * 손가락 밑에서 일어나므로 보이지 않고, 크기가 바뀌는 것은 테두리에서 일어나므로
 * 보인다. 카드는 이미 `hoverScale`/`hoverLift` 로 그렇게 하고 있었다.
 *
 * 그래서 메뉴는 여전히 아무것도 하지 않고, 여기 있는 것은 경기 화면 전용이다.
 * 호버 +4% / 프레스 −3%.
 */

/** @returns {{hover: number, press: number}} */
export function controlState() {
  return { hover: 0, press: 0 };
}

/**
 * 한 프레임만큼 민다.
 *
 * 켜지는 시간과 꺼지는 시간이 다르다. 켜지는 것은 사람의 동작에 대한 응답이라
 * 즉시여야 하고, 꺼지는 것은 그 동작이 끝났다는 보고라 여유가 있어도 된다 —
 * 같은 시간으로 하면 포인터가 버튼 위를 지나가기만 해도 깜빡인다.
 */
export function stepControl(state, { hovered = false, pressed = false }, dt) {
  state.hover = approach(state.hover, hovered ? 1 : 0, dt, hovered ? MOTION.hover : MOTION.release);
  state.press = approach(state.press, pressed ? 1 : 0, dt, pressed ? MOTION.press : MOTION.release);
  return state;
}

/**
 * 진행도를 배율로. 1 을 중심으로 위아래.
 *
 * 진행도에 곡선을 씌우는 것은 **읽는 쪽**이다 — `approach` 의 주석에 왜 진행도
 * 자체는 선형이어야 하는지 적혀 있다.
 */
export function controlScale(state) {
  const press = easeOut(state.press);
  /**
   * 눌림이 얹힘을 **덮는다**. 더하지 않는다.
   *
   * 처음에는 `1 + 0.04*hover - 0.03*press` 였고, 그러면 눌린 상태는 두 항이 같이
   * 켜져 있으므로 1.01 이다 — 실측했다. 손가락에는 호버가 없어서 누르는 순간 둘이
   * 동시에 켜지고, 결과는 1% 다. 아무도 못 본다.
   *
   * 눌림이 켜지는 만큼 얹힘을 끄면 누른 것은 언제나 0.97 이다. §9.2 가 두 숫자로
   * 말하려던 것 — 가리키면 커지고 누르면 작아진다 — 이 그제서야 화면에 나온다.
   */
  return 1 + 0.04 * easeOut(state.hover) * (1 - press) - 0.03 * press;
}

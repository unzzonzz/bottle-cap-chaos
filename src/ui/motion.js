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
 * ── 호버·프레스 진행도를 밀던 것들이 여기 있었다 ────────────────────────────
 * `controlState` / `stepControl` / `controlScale` / `hoverPlates` 넷이 있었고,
 * 넷 다 없어졌다. 버튼이 상호작용에 반응하지 않기로 했으므로 — `glass.skinFor` 의
 * 호버 분기에 그 결정과 근거가 적혀 있다 — 밀 진행도가 없다.
 *
 * 남은 것은 곡선 셋과 `approach` 다. 그쪽은 여전히 쓰인다: 모달의 등장, HUD 아래
 * 줄의 미끄러짐, 메뉴 열의 호버 진행도(값을 읽는 곳은 없지만 열이 호버를 안다는
 * 사실은 남는다).
 */

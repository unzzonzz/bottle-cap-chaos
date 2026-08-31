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
 * 눌리고 놓이는 컨트롤의 진행도 한 쌍을 한 번에 밀어 준다.
 *
 * 호버와 프레스가 서로 다른 시간을 쓰는 것이 요점이다. 누르는 것은 즉각이어야
 * 하고(`MOTION.press`, 0.07초) 놓는 것은 그보다 느긋해야 한다(`MOTION.release`,
 * 0.18초) — 손가락보다 빨리 돌아오는 버튼은 눌린 적이 없는 것처럼 보인다.
 *
 * @param {{hover: number, press: number}} state  제자리에서 갱신된다
 */
export function stepControl(state, { hovered, pressed }, dt) {
  state.hover = approach(state.hover, hovered ? 1 : 0, dt, MOTION.hover);
  state.press = approach(
    state.press,
    pressed ? 1 : 0,
    dt,
    pressed ? MOTION.press : MOTION.release,
  );
  return state;
}

/** 새 컨트롤의 진행도. 둘 다 꺼진 상태에서 시작한다. */
export function controlState() {
  return { hover: 0, press: 0 };
}

/**
 * 호버와 프레스를 하나의 배율로.
 *
 * ── 커지고, 눌리면 다시 작아진다 ────────────────────────────────────────────
 * Wii 의 버튼은 포인터가 오면 조금 커지고 누르면 원래보다 조금 작아진다. 두
 * 방향이 다 있어야 "닿았다"와 "눌렀다"가 구별된다 — 커지기만 하면 누르는 순간
 * 아무 일도 안 일어나고, 작아지기만 하면 닿은 것을 알 수 없다.
 *
 * 값이 작은 것은 의도다. 판이 8% 커지면 옆의 판과 간격이 눈에 띄게 달라지고,
 * 그러면 한 줄이 정렬을 잃은 것처럼 보인다. 4% 는 느껴지되 줄을 흔들지 않는다.
 */
export function controlScale(state, { hover = 0.04, press = 0.03 } = {}) {
  return 1 + easeOut(state.hover) * hover - easeOut(state.press) * (hover + press);
}

/**
 * 한 화면의 판들에 호버 배율을 먹인다.
 *
 * ── 왜 화면마다 쓰지 않고 여기 있나 ─────────────────────────────────────────
 * 설정 · 상대 선택 · 온라인 · 내 마크 네 화면이 전부 같은 모양의 목록이고, 전부
 * 호버에 텍스처만 갈아 끼우고 있었다. 네 곳에 같은 열 줄을 쓰면 그 중 하나가
 * 언젠가 다르게 움직인다. 목록이 하나면 그럴 곳이 없다.
 *
 * 진행도는 `states` 에 id 로 담긴다 — 화면이 들고 있고, 화면이 사라지면 같이
 * 사라진다. 항목이 조건부로 없어지는 화면들이라 배열 인덱스가 아니라 id 여야 한다.
 *
 * @param {Array<{id: string, mesh: object, w: number, h: number}>} items
 *   `w`/`h` 는 프레임 픽셀. 화면 단위 변환은 `unit` 이 한다.
 * @param {string|null} hovered
 * @param {number} dt
 * @param {number} unit  프레임 픽셀당 월드 단위 (`unitsPerPixel`)
 * @param {Record<string, {hover: number, press: number}>} states  제자리 갱신
 */
export function hoverPlates(items, hovered, dt, unit, states) {
  for (const it of items) {
    if (!it?.mesh || !(it.w > 0)) continue;
    const st = (states[it.id] ??= controlState());
    stepControl(st, { hovered: hovered === it.id, pressed: false }, dt);
    const k = controlScale(st);
    it.mesh.scale.set(it.w * unit * k, it.h * unit * k, 1);
  }
}

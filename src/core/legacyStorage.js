/**
 * 개명 이전의 저장 데이터를 한 번 지운다.
 *
 * ── 키만 바꾸면 옛 문서가 남는다 ────────────────────────────────────────────
 * `bcc.*` 를 `msa.*` 로 옮긴 것은 새 이름의 첫 스키마를 뜻하고, 사용자는 데이터가
 * 사라지는 것에 동의했다. 하지만 동의한 것은 "값을 잃는 것"이지 "옛 값이 브라우저
 * 안에 영원히 남는 것"이 아니다. 지우지 않으면 용량을 먹고, 나중에 개발자 도구를
 * 열어 본 사람에게 어느 쪽이 살아 있는 키인지 알 수 없게 만든다.
 *
 * ── try 가 필요한 이유 ──────────────────────────────────────────────────────
 * `AudioSettings.js` 가 자기 자리에서 같은 이유를 적어 두었다 — 프라이빗 모드와
 * 사이트 데이터를 막아 둔 브라우저에서는 `localStorage` 에 **접근만 해도** throw
 * 한다. 부팅 경로에서 불리므로, 여기서 던지면 지울 것도 없는 브라우저에서 게임이
 * 뜨지 않는다.
 *
 * ── 삭제 예정: 2027-03 ──────────────────────────────────────────────────────
 * 그 뒤로는 이 코드가 매 부팅마다 존재하지 않는 키 일곱 개를 지우고 있을 뿐이다.
 */

/** 개명 전 키. 새 키를 여기 넣지 마라 — 이 목록은 과거이지 현재가 아니다. */
const LEGACY_LOCAL_KEYS = [
  'bcc.marks.v1',
  'bcc.audio.v1',
  'bcc.graphics.v1',
  'bcc.view.v1',
  'bcc.profile.v1',
  'bcc.metrics.v1',
];

/**
 * 핸드오프만 `sessionStorage` 다.
 *
 * 탭과 함께 사라지므로 남아서 문제를 일으킬 창은 좁다. 그래도 지우는 이유는,
 * 메뉴 document 가 개명 전 빌드이고 게임 document 가 개명 후인 순간 — 즉 배포가
 * 진행되는 동안 — 옛 키가 하나 남고 아무도 읽지 않기 때문이다.
 */
const LEGACY_SESSION_KEYS = ['bcc.online.handoff'];

let done = false;

/**
 * 부팅 경로에서 한 번 부른다.
 *
 * ── 부팅 경로가 둘이다 ──────────────────────────────────────────────────────
 * 메뉴와 게임은 별개 document 이므로 `src/menu/bootMenu.js` 와 `src/main.js`
 * **양쪽**에서 불려야 한다. 한 쪽에만 두면 그 화면을 지나지 않는 사용자에게는
 * 옛 키가 남는다 — 게임 URL 로 바로 들어오는 경우가 정확히 그것이다.
 *
 * `done` 가드는 같은 document 안에서 두 번 불릴 때를 위한 것이지 document 사이의
 * 중복을 막는 것이 아니다. 그쪽은 애초에 막을 필요가 없다: 지우는 연산이라 두 번
 * 해도 결과가 같다.
 */
export function clearLegacyStorage() {
  if (done) return;
  done = true;

  for (const key of LEGACY_LOCAL_KEYS) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* 접근 불가 — 지울 것도 없다 */
    }
  }

  for (const key of LEGACY_SESSION_KEYS) {
    try {
      globalThis.sessionStorage?.removeItem(key);
    } catch {
      /* 같음 */
    }
  }
}

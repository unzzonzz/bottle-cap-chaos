# 한여름 알까기 / Midsummer Alkkagi

병뚜껑 알까기. Three.js + Rapier, 데스크톱 브라우저.

세 모드가 같은 물리 위에 올라간다.

| 경로 | 모드 | 이기는 법 |
|---|---|---|
| `/survival` | 서바이벌 (`knockout`) | 상대 뚜껑을 전부 판 밖으로 |
| `/football` | 축구 (`football`) | 공을 골대에 |
| `/curling` | 컬링 (`curling`) | 하우스 중심에 가깝게 |

`/` 는 메뉴다. 모드를 이름으로 말하지 않는 경로는 전부 메뉴로 떨어진다 —
`/menu` 도, 오타도, 오래된 북마크도.

---

## 시작

```bash
npm install
npm run dev
```

온라인 대전을 보려면 릴레이 서버도 같이 띄운다:

```bash
npm run server
```

---

## 아키텍처 — 세 줄

**`src/physics/` → `src/game/` → `src/render/`. 단방향이다.**
물리는 게임을 모르고, 게임은 렌더를 모른다. 렌더가 물리를 만지면 그건 버그다.

**결정론이 척추다.** 온라인은 락스텝이라 서버가 입력만 중계하고 양쪽이 각자
시뮬레이션한다. 같은 시드 + 같은 입력 = 같은 세계가 거짓이면 실패 모드는
크래시가 아니라 **두 사람이 서로 다른 게임을 보면서 아무도 모르는 것**이다.

**좌표계는 하나다.** UI 는 DOM 이 아니라 three.js 메시고, 가상 640×480 "프레임
픽셀" 상자에 배치된다. 그 상자는 항상 4:3 이고, 폭만 창 크기를 따라 움직인다 —
그게 작은 창에서 UI 가 커 보이게 하는 유일한 장치다. `src/core/frame.js`.

---

## `npm run det:node` — 이게 뭐고 왜 반드시 통과해야 하나

**결정론 회귀 검사다. 이 저장소에서 가장 중요한 명령이다.**

고정 시드로 만들어 둔 입력 로그를 세 모드에 대해 다시 돌리고, 매 턴 월드
상태의 해시를 찍는다. 숫자 하나라도 달라지면 digest 가 달라진다.

```bash
npm run det:node
```

```
  knockout  digest=5e7386a0  final=c7343d7e  turns=42/42  bodies=6
  football  digest=afaddf2e  final=8d836f9b  turns=41/41  bodies=9
  curling   digest=2c6db64c  final=b54064ad  turns=8/8  bodies=8
```

**작업 전에 기준선을 떠 두고, 작업 후에 대조한다:**

```bash
npm run det:node > /tmp/det-baseline.txt   # 깨끗한 트리에서 한 번
# ... 작업 ...
npm run det:node                            # digest 세 줄이 같아야 한다
```

digest 가 바뀌었는데 **물리를 의도적으로 바꾼 게 아니라면 그건 버그다.**
렌더·UI·서버 작업은 전부 해시 중립이어야 한다. 바뀌었다면 되돌리고 원인을
찾아라 — 온라인 대전에서 데스싱크로 나타날 변경을 방금 만든 것이다.

물리를 의도적으로 바꿨다면 기준선을 다시 뜨고, **커밋 메시지에 그렇게 적어라.**

### 왜 엔진을 두 개 도나

```bash
npm run det:jsc      # JavaScriptCore (macOS 내장)
npm run det:collect
```

`Math.sin` `Math.pow` `atan2` `hypot` 는 명세가 "구현 근사"로 두는 함수라
V8 과 JavaScriptCore 에서 **실제로 다른 값을 낸다.** 브라우저 두 개를 여는
것은 대개 엔진 하나를 두 번 여는 것이라 이걸 못 잡는다.

Rapier 자체는 Rust 를 WASM 으로 컴파일한 것이고 자기 libm 을 들고 다니므로
노출되지 않는다. 위험한 것은 그 위의 JS 다.

---

## npm 스크립트

### 개발

| | |
|---|---|
| `npm run dev` | Vite 개발 서버 |
| `npm run build` | `dist/` 로 프로덕션 빌드 |
| `npm run preview` | 빌드 결과를 로컬에서 서빙 |
| `npm run build:pages` | GitHub Pages 용 빌드 (`/<repo>/` 서브패스 + 라우트 폴백) |
| `npm run preview:pages` | 위 결과를 Pages 와 같은 경로로 서빙 |

### 검사

| | |
|---|---|
| `npm test` | `det:node` + `server:test` + `det:ai`. 커밋 전에 이거 |
| `npm run det:node` | **결정론 회귀 검사.** 위 절 참조 |
| `npm run det:jsc` | 같은 검사를 JavaScriptCore 에서 (macOS 전용) |
| `npm run det:collect` | 두 엔진의 결과를 모아 대조 |
| `npm run det:emit` | 입력 로그를 다시 생성. **평소에는 하지 마라** — 로그가 바뀌면 기준선이 무의미해진다 |
| `npm run det:ai` | AI 결정론. 같은 상황에서 같은 수를 두는가 |
| `npm run det:ai:stats` | AI 하네스의 통계 요약 |
| `npm run server:test` | 릴레이 서버 56 케이스 (흐름 36 · 락스텝 8 · 이탈 감지 12) |

### 릴레이 서버

| | |
|---|---|
| `npm run server` | 릴레이를 띄운다. 기본 `0.0.0.0:8787` |
| `npm run server:lan` | 붙을 LAN 주소를 먼저 찍고 띄운다 |
| `npm run server:live` | 실제 소켓으로 두 클라이언트를 붙여 보는 수동 확인 |

---

## 릴레이 서버

상태를 들고 있지 않다. 입력만 중계하고, 데이터베이스도 파일 쓰기도 없다 —
그래서 닉네임은 프로세스가 사는 동안만 유지된다.

```bash
npm run server
curl localhost:8787/health     # 허브 카운터. 게임을 탓하기 전에 여기부터
```

전부 환경변수로 움직인다. 하드코딩된 `localhost` 도, 오리진 목록도 없다:

| | 기본값 |
|---|---|
| `SERVER_PORT` 또는 `PORT` | `8787` |
| `HOST` | `0.0.0.0` |
| `TURN_MS` `HEARTBEAT_MS` `HASH_TIMEOUT_MS` … | `src/net/protocol.js` 의 `TIMING` |
| `MSG_BURST` / `MSG_PER_SECOND` | `200` / `50` — 연결당 메시지 예산 (토큰 버킷) |

메시지 예산을 넘긴 연결은 `rate_limited` 를 받고 끊긴다. 기본값은 LAN 과
테스트 하네스 기준으로 넉넉하게 잡혀 있다 — 공개된 곳에 띄운다면 조인다.

다른 기계에서 붙을 때는 **메뉴 → 설정 → 서버 주소** 에 `ws://<주소>:8787` 을
넣는다. 비워 두면 `location.hostname` 에서 유도한다.

### 두 클라이언트가 같은 빌드인지 어떻게 아는가

접속할 때 `configHash` 를 보낸다 — 시뮬레이션에 들어가는 설정 블록
(`SYNCED_CONFIG_PATHS`) 만 골라 뜬 지문이다. 다르면 매칭을 거절한다.
슬라이더 하나가 다른 두 사람이 만나면 조용히 데스싱크가 나기 때문이다.

---

## 어디에 뭐가 있나

```
src/physics/    Rapier 래퍼, 콜라이더, 결정론 RNG.   ← 해시가 여기서 나온다
src/game/       규칙, 턴, 카드, AI, 레이아웃.        ← 시뮬레이션
src/render/     three.js 뷰. 물리를 읽기만 한다
src/core/       프레임 좌표계, 뷰포트, 팔레트, 품질 티어
src/ui/         HUD · 모달 (캔버스 안의 메시)
src/menu/       메뉴 문서 전체
src/net/        프로토콜, 트랜스포트, 온라인 세션
src/replay/     입력 로그와 리플레이 러너.          ← det 하네스가 쓴다
src/audio/      합성 오디오. 오디오 파일 없음
src/marks/      뚜껑에 그리는 마크 편집기
server/         릴레이
tools/          결정론 하네스, 벤치, 밸런스 스크립트
docs/           측정 절차, 팔레트, 토큰
```

---

## 문서

| | |
|---|---|
| [docs/metrics.md](docs/metrics.md) | 프레임을 재는 법. `?debug=1` 이 프레임을 부풀린다는 경고 포함 |
| [docs/palette.md](docs/palette.md) | 색과 셰이프 토큰을 어디서 고치나 |
| `docs/tokens-preview.html` | 스펙 시트. 개발 서버에서 `/docs/tokens-preview.html` |

---

## 규칙 두 개

**색은 `src/core/palette.js` 에만 있다.** `src/` 안에 여섯 자리 hex 리터럴이
또 있으면 버그다 (`node docs/palette-audit.mjs` 가 검사한다).

**주석은 설계 일지다.** 이 저장소의 주석은 "무엇을" 이 아니라 "왜 이것이고
저것이 아닌가" 를 적는다. 그건 주석이 **참일 때만** 자산이고, 거짓이면 부채다.
코드를 고치면 그 코드를 설명하는 주석도 같이 고쳐라.

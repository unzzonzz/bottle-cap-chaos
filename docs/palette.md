# 디자인 토큰 — 색과 셰이프를 바꾸려면 어디를 고치나

지시서 **v3** PHASE 0 의 산출물. 여섯 개의 파일이 전부다.

| 파일 | 무엇 |
|---|---|
| `src/core/palette.js` | 모든 색. `src/` 안에 여섯 자리 hex 리터럴이 또 있으면 버그다 |
| `src/core/tokens.js` | RADIUS / SIZE / SPACE / RULE / TYPE / CTA / PANEL / ROLE / MOTION |
| `src/ui/paper.js` | 종이 면 · 헤어라인 · **글자와 밑줄로 된 컨트롤** · 다이얼로그 골격 |
| `src/ui/marks.js` | 장식 모티프 여덟. 하나에 뜻 하나 |
| `src/ui/lettering.js` | 제목과 숫자의 **벡터 획**. 자모 조합이라 임의의 한글이 된다 |
| `src/ui/icons.js` | 카드 7종 + UI 아이콘 벡터 렌더러 |
| `src/ui/fonts.js` | 폰트 스택 + `document.fonts.ready` 게이트 + 텍스처 캐시 무효화 |

스펙 시트: 개발 서버를 띄우고 **`/docs/tokens-preview.html`**.
목업이 아니라 위 파일들을 그대로 import 해서 그린 것이라, 여기 보이는 것과
게임에 나오는 것이 다를 수 없다.

```bash
grep -rInE "#[0-9a-fA-F]{6}" src/ | grep -v "^src/core/palette.js"
```

> 예외 하나: `src/game/cards/cardCatalog.js`. 그 파일은 시뮬레이션 디렉터리라
> 팔레트를 import 시키지 않는다 — 일곱 개 문자열 때문에 결정론 번들에 아트
> 모듈이 들어가게 된다. `PALETTE.card` 가 id 로 덮어쓰므로 카탈로그의 값은
> 화면에 나오지 않는다. `render/cardTexture.js` 의 `accentOf()` 참조.

## v2 에서 없어진 것

되돌리기 전에 왜 없어졌는지 읽어라. 전부 지시서 v3 이 명시적으로 금지한 것들이다.

| 없어진 것 | 어디로 | 근거 |
|---|---|---|
| `src/ui/glass.js` | `paper.js` + `marks.js` | 젤 버튼 7단계 레시피. §19 · §24 가 광택 컨트롤을 금지 |
| `ELEVATION` | — | 그림자가 없으면 높이도 없다. §19 · §24 |
| `RADIUS.pill` | — | 핏 버튼이 없다. 컨트롤에는 모서리가 아예 없다 |
| `SCALE.hoverUp/pressDown` | — | 판은 상호작용에 반응하지 않는다 (`MenuItems.js` 의 기록) |
| `TYPE.display` `TYPE.title` | `lettering.js` | 디스플레이 목소리는 **그린다**. 웨이트가 하나뿐이라 타입으로는 못 만든다 |
| `SIZE.scorePlate` | `SIZE.score` | 이름이 아니라 뜻이 바뀌었다 — 판이 아니라 숫자가 차지하는 **영역**이다 |
| `accent.cyan` `accent.sky` | `PALETTE.cobalt` / `.blueClear` / `.bluePale` | 파랑이 세계 전체이므로 "액센트 시안" 이 정보를 안 나른다 |
| `ui.glassTop/glassBottom/gloss*/edgeInner/edgeOuter` | — | 젤 스택의 색. 얹을 면이 없다 |
| `menu.labelRed/Cream/Gold` | `menu.labelInk/Paper/Rule` | 병 라벨이 코발트와 흰색이 됐다 |
| `curling.table` 의 크림 | `board.wood` | 목재로 통일. 파일에 남아 있던 마지막 베이지 |
| `msa-sans-700.woff2` | — | 존재하지 않는 웨이트를 요청하면 브라우저가 합성한다 |

## 색 규칙 (`node docs/palette-audit.mjs` 가 검사한다)

| # | 규칙 | 메모 |
|---|---|---|
| 1 | `#000000` 금지 · 상대 휘도 ≥ 0.05 · 어두운 값은 `cobaltInk` | 예외는 `PALETTE.additiveZero` 하나. 가산 합성의 항등원이라 색이 아니라 투명이다. `PALETTE.additive.*` 램프도 휘도 하한 면제 — 어두운 항목은 "거의 더하지 않음"이지 어두운 표면이 아니다 |
| 2 | **크림·베이지를 뉴트럴로 쓰지 마라** | 종이는 `whiteCool` `#f4fafe`, 파랑이 빨강보다 10 높다. 감사는 **색상**으로 잰다 — 낮은 채도 + 25~70도 = 크림. 옅은 산호(`playerPale[0]`, 12도)가 걸리지 않게 하려면 그 자여야 한다. 적용 범위는 뉴트럴로 쓰이는 값뿐 (`NEUTRAL_SCOPE`) — 나무는 나무다 |
| 3 | 네온 금지 | 크로마 ≤ 0.80 은 전부에. HSV 채도 ≤ 88% 는 **L ≥ 0.20 인 값에만** — 코발트 `#0d3b8c` 은 산술적으로 91% 이고 네온과 무관하다. 네온은 밝고 채도가 높은 것이다 |
| 4 | 1P/2P 절대 휘도차 ≥ 0.15 | 현재 **0.174**. 비율이 아니라 절대차인 이유: wet metal 이 두 뚜껑 모두에 넓은 스페큘러를 얹기 때문에, 비율이 커 보여도 하이라이트 아래서는 같아 보일 수 있다 |
| 5 | UI 텍스트 대비 ≥ 4.5:1 | 아래 "잉크 방향" 참조 |

카드 일곱 장은 별도로 검사한다. **대비가 아니라 색상환**이다 — 전부 같은 흰
종이 위에 그려지므로 서로에 대한 대비는 아무 말도 안 한다. 이웃한 두 색이
20도 안에 있으면서 크로마도 0.2 안에 있으면 실패다. 철벽(211도, C 0.42)과
침묵(207도, C 0.08)이 색상은 같고 크로마로 갈리는 유일한 쌍이고, 그것이 침묵의
뜻이다 — 색이 빠진 것.

### 잉크 방향 — 이게 규칙 5의 절반이다

- **종이 위** → `ui.text` (`cobaltInk`). `surface` 기준 9.87:1
- **백드롭 위 직접** → `ui.textOnAccent` (`whiteCool`). `bg.skyTop` 이 4.83:1 을
  내도록 값을 내렸다 — 하늘을 밝히는 것은 답이 아니다

## 게임플레이 대비 (§11 — 미학보다 우선)

조준 관련 색은 **콘만 흰색이고 나머지는 전부 어둡다.** 콘은 선이 아니라 면이라
§5.2 가 반투명 흰색으로 못박았고, 나머지는 밝은 필드 위의 선이므로 어두워야
한다. 밝은 앰버 활 `#ffd36b` 은 목재와 잔디 양쪽에서 1.2:1 밖에 안 나와서 세
필드 중 두 곳에서 사실상 보이지 않았다. `PALETTE.aim` 주석에 자세히 있다.

## 셰이프 규칙

- **스케일이 v2 와 반대로 간다.** v2 는 "적게, 크게" 였고 §11 은 그 역이다 —
  타입은 15px 에서 멈추고, 인터페이스에서 가장 굵은 선이 1.5px 다
- 새 상수를 즉석에서 만들지 마라. `tokens.js` 에 추가하고 참조한다.
  `node docs/tokens-audit.mjs` 가 없는 키를 잡는다 (import 한 그룹만 검사하므로
  `capTexture.js` 의 지역 `PANEL` 같은 오탐이 없다)
- 터치 타깃: 그리는 것과 누를 수 있는 것이 **다르다**. `CTA.hitPadX/Y` 가 그
  차이이고, `assertTouchTarget()` 이 프레임 최소 배율에서 44pt 를 검사한다

## 타이포그래피

**MSA Sans = Gowun Dodum 서브셋, 400 하나.** 자세한 것은 저장소 루트의 `NOTICE`.

- 한글 완성형 11172자 전부 포함. 닉네임이 사용자 입력이고 `NICKNAME_RE` 가
  `가-힣` 전체를 허용하므로 서브셋을 좁히면 특정 닉네임만 두부가 된다
- 웨이트가 하나이므로 **위계를 굵기로 만들 수 없다.** 크기 · 색 · 자간 · 여백,
  그리고 제목과 숫자를 `lettering.js` 로 그리는 것이 그 대신이다
- `micro` 10px 실측 (2026-09-04): 게임은 이것을 10 CSS px 로 그리지 않는다.
  `MIN_CSS_PX_PER_FRAME_PX` 가 1.25 를 보장하므로 바닥이 **12.5 CSS px**, 보통의
  데스크톱 창은 약 1.97 배로 **19.7 CSS px** 다. 둘 다 받침이 열려 있다
- `lettering.js` 는 자모를 조합한다. 11172자 전부가 빠진 글자 없이 합성되는 것을
  확인했고, 없는 글자는 **빈 상자**로 그린다 — 조용히 건너뛰면 짧아진 단어가
  검토를 통과한다

## 자바스크립트가 닿지 않는 곳

| 위치 | 무엇 | 현재 |
|---|---|---|
| `index.html` | `<meta name="color-scheme">` | `light`. 스타일시트가 적용되기 전 브라우저가 칠하는 초기 캔버스와, 폼 컨트롤·스크롤바의 기본 색을 정한다 |

`src/ui/styles.css` 는 닿는다 — `src/ui/cssPalette.js` 가 `--msa-*` 커스텀
프로퍼티로 밀어 넣는다. 스타일시트에 hex 리터럴을 쓰지 마라. **예외 하나**:
`html, body` 의 `background` 는 `var(--msa-void, #1451b8)` 로 폴백을 갖는다.
모듈 스크립트가 돌기 전 한두 프레임 동안 이 값이 필요하고, 그 프레임이 메뉴와
경기 문서 사이의 이음매이기 때문이다. 그 값은 `PALETTE.menu.capBrand` —
전환의 코발트다. 바꾸면 여기도 손으로 맞춰라.

## 커밋 전

```bash
node docs/palette-audit.mjs
node docs/tokens-audit.mjs
npm run det:node      # /tmp/det-baseline.txt 와 digest 줄이 일치
npm run server:test
npm run build
```

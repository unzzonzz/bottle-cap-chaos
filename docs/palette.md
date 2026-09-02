# 디자인 토큰 — 색과 셰이프를 바꾸려면 어디를 고치나

지시서 v2 PHASE 0의 산출물. 네 개의 파일이 전부다.

| 파일 | 무엇 |
|---|---|
| `src/core/palette.js` | 모든 색. `src/` 안에 여섯 자리 hex 리터럴이 또 있으면 버그다 |
| `src/core/tokens.js` | RADIUS / SIZE / SPACE / TYPE / ELEVATION / MOTION / SCALE |
| `src/ui/glass.js` | 젤 버튼 · 유리 패널 · 포커스 링 렌더러 |
| `src/ui/icons.js` | 카드 6종 + UI 아이콘 벡터 렌더러 |
| `src/ui/fonts.js` | 폰트 스택 + `document.fonts.ready` 게이트 + 텍스처 캐시 무효화 |

스펙 시트: 개발 서버를 띄우고 **`/docs/tokens-preview.html`**.
목업이 아니라 위 파일들을 그대로 import 해서 그린 것이라, 여기 보이는 것과
게임에 나오는 것이 다를 수 없다.

```bash
grep -rInE "#[0-9a-fA-F]{6}" src/ | grep -v "^src/core/palette.js"
```

> 예외 하나: `src/game/cards/cardCatalog.js`. v2 §0.1이 `accent` 값 수정을
> 허용하지만, 그 파일은 시뮬레이션 디렉터리라 팔레트를 import 시키지 않는다 —
> 여섯 개 문자열 때문에 결정론 번들에 아트 모듈이 들어가게 된다.
> `PALETTE.card` 가 id로 덮어쓰므로 카탈로그의 값은 화면에 나오지 않는다.
> `render/cardTexture.js` 의 `accentOf()` 참조.

## 색 규칙 (`node docs/palette-audit.mjs` 가 검사한다)

| # | 규칙 | 메모 |
|---|---|---|
| 1 | `#000000` 금지 · 상대 휘도 ≥ 0.06 | 예외는 `PALETTE.additiveZero` 하나. 가산 합성의 항등원이라 색이 아니라 투명이다. `PALETTE.additive.*` 램프도 휘도 하한 면제 — 어두운 항목은 "거의 더하지 않음"이지 어두운 표면이 아니다 |
| 2 | 그림자는 남색/청록 | `ui.shadow` `#1f4a66`. 감사 스크립트가 파랑 채널이 빨강보다 높은지 검사한다 |
| 3 | 채도 상한 | 지시서는 "HSL S ≤ 88%"라고 쓰지만 문자 그대로 쓰면 안 된다 — HSL 채도는 옅은 틴트에서 무너져 크림색 `#fff6e0`이 100%로 나온다. **HSV 채도 ≤ 88% + 크로마 ≤ 0.80** 으로 건다 |
| 4 | 1P/2P 절대 휘도차 ≥ 0.15 | 현재 **0.181**. 비율이 아니라 절대차인 이유: wet metal 이 두 뚜껑 모두에 넓은 스페큘러를 얹기 때문에, 비율이 커 보여도 하이라이트 아래서는 같아 보일 수 있다 |
| 5 | UI 텍스트 대비 ≥ 4.5:1 | 아래 "잉크 방향" 참조 |

### 잉크 방향 — 이게 규칙 5의 절반이다

- **유리/플레이트 위** → `ui.text` (남색). `surface` 와 `glassBottom` 기준으로 골랐고 4.5:1을 넘는다
- **백드롭 위 직접** → `ui.textOnAccent` (흰색). `bg.skyTop` 위의 남색은 2.2:1 이고, 해결책은 하늘을 밝히는 게 아니다 — 에어로는 위쪽이 진한 파랑이어야 한다

## 게임플레이 대비 (§0.4 — 미학보다 우선)

밝은 팔레트로 뒤집으면서 **조준 관련 색이 전부 어두워졌다.** 기존의 밝은 앰버
활 `#ffd36b` 은 허니 목재와 잔디 양쪽에서 1.2:1 밖에 안 나와서 세 필드 중 두
곳에서 사실상 보이지 않았다. `PALETTE.aim` 주석에 자세히 있다.

같은 이유로 `DistanceMarks` 의 강조 방향도 뒤집었다. 이긴 마크를 흰색 쪽으로
50% 올리던 것이 밝은 테이블에서는 이긴 쪽을 사라지게 만든다.

## 셰이프 규칙

- **배치 상수는 재사용하지 않는다. 좌표계만 재사용한다.** 기존 UI는 104폭 버튼 ·
  42높이 스코어 · 16px 타입이었다. 전부 다시 골랐다 — 스코어 플레이트는 208×42
  에서 300×84 로 면적 4배
- 새 상수를 즉석에서 만들지 마라. `tokens.js` 에 추가하고 참조한다
- 터치 타깃: `frame.js` 가 프레임 픽셀당 최소 1.25 CSS px 를 보장하므로
  `assertTouchTarget()` 로 44pt 를 검사할 수 있다. 현재 최소는 `buttonIcon`
  80×80 CSS px

## 폰트 — 아직 남은 작업

`src/ui/fonts.js` 의 파이프라인은 완성되어 있다:

- 스택은 `"BCC Sans" → Pretendard → SUIT → -apple-system → …`
- `whenFontsReady()` 가 각 웨이트를 한글 샘플(`가힣AZ09`)로 명시적으로 요청한 뒤
  `document.fonts.ready` 를 기다리고, 등록된 텍스처 캐시를 전부 비운다
- 캐시는 `registerTextureCache()` 로 자기 자신을 등록한다 (현재 4곳:
  `hudTextures` `cardTexture` `fxTextures` `markIcons`)
- 실패해도 절대 throw 하지 않는다. 폴백 폰트로 읽히는 UI가 원하는 실패 모드다

**남은 것: `BCC Sans` 로 등록할 woff2 파일이 없다.** 지금은 개발 머신에 설치된
Pretendard 로 해결되지만 Capacitor 빌드에는 들어가지 않는다. 필요한 것:

1. Pretendard woff2 (OFL) 를 `src/ui/fonts/` 에 넣고 라이선스 파일 동봉
2. 서브셋: UI 문자 + **완성형 한글 전체(11172자)**. 닉네임이 사용자 입력이고
   `NICKNAME_RE` 가 `가-힣` 전체를 허용한다 — 서브셋을 좁히면 닉네임이 두부가 된다
3. `@font-face { font-family: 'BCC Sans'; … }` 를 `styles.css` 에 추가

이 머신에는 `fonttools` / `brotli` / `woff2_compress` 가 없다.

## 자바스크립트가 닿지 않는 곳

| 위치 | 무엇 | 현재 |
|---|---|---|
| `capacitor.config.json` | 웹뷰 배경 3곳 | `#1a76c4` = `bg.skyTop`. 팔레트가 바뀌면 손으로 맞춰라 |
| `ios/App/App/Info.plist` | `UIUserInterfaceStyle` | `Light`. 없으면 다크모드 폰에서 런치 스크린이 검다 |
| `ios/.../Splash.imageset/` | 스플래시 PNG 3장 | 아직 Capacitor 기본값. 재생성 필요 |
| `android/.../drawable*/splash.png` | 스플래시 PNG 10장 | 아직 Capacitor 기본값. 재생성 필요 |

`src/ui/styles.css` 는 닿는다 — `src/ui/cssPalette.js` 가 `--bcc-*` 커스텀
프로퍼티로 밀어 넣는다. 스타일시트에 hex 리터럴을 쓰지 마라. **예외 하나**:
`html, body` 의 `background` 는 `var(--bcc-void, #1a76c4)` 로 폴백을 갖는다.
모듈 스크립트가 돌기 전 한두 프레임 동안 이 값이 필요하고, 그 프레임이 메뉴와
경기 문서 사이의 이음매이기 때문이다 — 이유는 그 규칙 옆에 적혀 있다. 팔레트의
`bg.skyTop` 을 바꾸면 여기도 손으로 맞춰라.

## 커밋 전

```bash
node docs/palette-audit.mjs
npm run det:node      # /tmp/det-baseline.txt 와 완전 일치
npm run server:test
npm run build
```

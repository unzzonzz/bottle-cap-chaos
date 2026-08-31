# iOS — 빌드하고, 실기에 올리고, 재는 법

Capacitor 8 + Swift Package Manager. **CocoaPods 는 필요 없다** — Capacitor 6부터
네이티브 의존성이 SPM 으로 옮겨갔고, 이 프로젝트는 플러그인을 하나도 쓰지 않는다.

---

## 0. 한 번만 하는 준비

### Xcode

```bash
xcode-select -p
```

`/Library/Developer/CommandLineTools` 가 나오면 **Xcode 가 없는 것이다.** Command
Line Tools 만으로는 `xcodebuild` 도 시뮬레이터도 돌지 않는다. App Store 에서
Xcode 를 받고, 받은 뒤 한 번:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
```

### iOS 플랫폼 컴포넌트 — 별도 다운로드다

**Xcode 를 깔았다고 iOS 빌드가 되는 게 아니다.** Xcode 26 은 플랫폼을 본체에서
분리해서 따로 받게 한다. 안 받은 상태의 증상이 헷갈리는데, 이렇게 나온다:

```
xcodebuild: error: Found no destinations for the scheme 'App' and action build.
  Ineligible destinations:
    { platform:iOS, ... error:iOS 26.5 is not installed. }
```

시뮬레이터 목적지가 **하나도** 안 뜨는 게 특징이다. `xcrun simctl` 은 멀쩡히
돌고 런타임도 보이기 때문에 시뮬레이터 문제로 착각하기 쉽다. 확인:

```bash
du -sh /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform
```

몇백 MB 면 **스텁이다** (제대로 깔리면 GB 단위). 받는 법:

```bash
xcodebuild -downloadPlatform iOS
```

> **디스크.** Xcode 본체 ~40 GB 에 더해 이 컴포넌트가 몇 GB 더 든다. 시뮬레이터
> 런타임도 하나에 8 GB 씩이다 (`xcrun simctl runtime list` 로 확인, 안 쓰는 건
> `xcrun simctl runtime delete <UDID>`). `df -h /System/Volumes/Data` 로 먼저 봐라.

### 스킴은 커밋되어 있다

`cap add ios` 는 스킴을 만들지 않는다. Xcode 가 처음 열릴 때 `xcuserdata` 안에
만드는데 그건 사용자별이라 gitignore 대상이고, 그래서 **Xcode 를 한 번도 안 연
기계에서는 `xcodebuild -scheme App` 이 실패한다.**

`ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` 를 공유 스킴으로
커밋해뒀다. 새로 클론해도 CLI 빌드가 바로 된다.

### 무료 Apple ID 로 서명

유료 개발자 계정은 필요 없다. Xcode → Settings → Accounts 에서 Apple ID 를 추가하면
Personal Team 이 생긴다.

1. `ios/App/App.xcodeproj` 를 열고 App 타겟 → Signing & Capabilities
2. **Automatically manage signing** 체크
3. Team 을 방금 만든 Personal Team 으로
4. Bundle Identifier 가 `com.seungchan.bottlecapchaos` 다. 이미 쓰이고 있다는
   에러가 나면 뒤에 아무거나 붙여라 (`...chaos.dev`). 이 값은
   `capacitor.config.json` 의 `appId` 와 같아야 하는 건 아니다 — Xcode 쪽이 실제
   서명에 쓰이는 값이다.

무료 계정의 프로비저닝은 **7일 뒤 만료된다.** 앱이 "더 이상 사용할 수 없습니다"
로 죽으면 다시 빌드해서 덮어씌우면 된다. 검증에는 충분하다.

### 기기 신뢰

첫 설치 직후 앱은 실행되지 않는다. 기기에서
**설정 → 일반 → VPN 및 기기 관리 → (개발자 앱) → 신뢰**.

---

## 1. 매번 하는 루프

```bash
npm run ios
```

`build → cap sync ios → cap open ios` 를 한 번에 한다. Xcode 가 열리면 기기를
고르고 ⌘R.

웹만 고쳤을 때는 Xcode 를 다시 열 필요 없이:

```bash
npm run ios:sync
```

그리고 Xcode 에서 ⌘R.

> `cap sync` 는 `dist/` 를 `ios/App/App/public/` 으로 복사한다. **빌드를 먼저 하지
> 않으면 지난 번 `dist` 가 그대로 들어간다.** 위 두 스크립트는 build 를 포함하고
> 있으니 직접 `npx cap sync` 를 치지 마라.

### 라우팅이 왜 깨지지 않는가

메뉴와 게임은 별개 문서고 `/survival` 같은 경로로 이동한다 (`location.assign`).
Capacitor 의 iOS 에셋 핸들러(`CapacitorRouter.route(for:)`)는 **확장자가 없는
경로를 전부 `index.html` 로 돌려준다.** SPA 폴백이 공짜로 되는 셈이라 별도 설정이
필요 없다.

---

## 2. 화면에서 수치 읽기

왼쪽 위 초록색 숫자 배지가 **측정 오버레이**다. `?debug=1` 과 무관하게 항상 있다 —
패키징된 앱에는 주소창이 없어서 쿼리 파라미터를 넣을 방법이 없기 때문이다.

**배지를 탭하면** 접힘 → 요약 → 전체 → 꺼짐 순으로 돈다. 선택은
`bcc.metrics.v1` 로 저장돼서 다시 켜도 유지된다.

배지가 **주황색**이면 프레임을 흘리고 있다는 뜻이다.

전체 모드가 보여주는 것:

| 줄 | 뜻 |
|---|---|
| `boot` | 네비게이션 시작 → 첫 프레임. Rapier WASM 컴파일 포함 |
| `fps` / `low` | 평균 FPS, 그리고 1% low (하위 1% 프레임의 FPS) |
| `frame` | 실제 프레임 간격. rAF 가 주는 값 |
| `tick` | `tick()` 전체 — 물리 + 게임 + 렌더 제출 |
| `phys` | `match.update(dt)` 만 |
| `steps` | 이번 프레임에 돈 물리 스텝 수. **60fps 면 2가 정상** |
| `acc` | 어큐뮬레이터에 남은 시간 |
| `drop` | 프레임 간격이 50ms 를 넘어 **실제 시간이 버려진** 프레임 수 + 버린 총 초 |
| `sat` | 스텝 드레인이 자체 상한(20)에 닿은 프레임 수. **0이어야 한다** |
| `ai` | 직전 AI 턴이 쓴 총 CPU, 그리고 한 프레임 최대치 |
| `mem` | **iOS 에서는 항상 `n/a`.** 아래 참조 |

### `drop` 이 왜 "밀림"의 정답인가

이 게임의 어큐뮬레이터는 **폭주할 수 없다.** 두 개의 클램프가 막는다:

- `Match.update` 는 한 프레임에 최대 20 스텝만 돌고 나머지는 `_acc = 0` 으로 버린다
- `main.js:frame` 은 프레임 delta 를 **0.05초로 자르고** 어큐뮬레이터에 넘긴다.
  1/120 기준 6 스텝이라, 위의 20 상한은 메인 루프에서 도달조차 하지 않는다

그래서 실패 모드는 죽음의 나선이 아니라 **조용한 시간 손실**이다. 프레임이 50ms 를
넘으면 클램프가 진짜 시간을 버리고, 개별 스텝은 전부 정확한 채로 시뮬레이션만
벽시계보다 느려진다. `drop` 이 그 프레임 수와 버린 초를 센다. `sat` 은 별개로
20-스텝 상한을 세는데, 여기가 0이 아니면 메인 루프 말고 뭔가가 어큐뮬레이터를
돌리고 있다는 뜻이다.

### 메모리

`performance.memory` 는 Chromium 확장이고 **WebKit 에는 없다.** iOS 에서 JS 로
메모리를 읽을 방법은 없고 WASM 힙도 마찬가지다. 실제 수치는 Xcode 를 붙인 채로
**Debug navigator → Memory 게이지**, 또는 Instruments 의 Allocations 로 봐라.

### 숫자를 복사해 오기

Mac 의 Safari → 개발자 메뉴 → (기기 이름) → 앱 을 열면 Web Inspector 가 붙는다
(`capacitor.config.json` 에 `webContentsDebuggingEnabled: true` 가 있어서 개발
빌드에서 켜져 있다). 콘솔에서:

```js
copy(JSON.stringify(__cap.metrics.snapshot(), null, 2))
```

`__cap` 에는 `match`, `physics`, `hud`, `cards`, `safeArea`, `tick` 등도 들어 있다.

---

## 3. 로컬 서버에 붙이기

### 맥에서

```bash
npm run server:lan
```

붙일 주소를 먼저 찍고 서버를 띄운다. 서버는 이미 `0.0.0.0` 에 바인딩된다.

### 폰에서

**메뉴 → 설정 → 서버 주소** 에 위에서 찍힌 값을 그대로 넣는다:

```
ws://172.30.6.33:8787
```

`ws://` 또는 `wss://` 로 시작해야 통과한다. 빈칸으로 두면 자동 유도로 돌아간다.

> **자동 유도는 iOS 에서 절대 동작하지 않는다.** `defaultServerUrl()` 은
> `location.hostname` 에서 호스트를 따오는데, 패키징된 앱에서 그건 `localhost` —
> 즉 폰 자신이다. 실기에서 온라인 대전을 하려면 이 값을 **반드시** 넣어야 한다.

주소는 `bcc.profile.v1` 키로 localStorage 에 저장되므로 한 번만 넣으면 된다.
`?debug=1` 패널의 "서버 주소" 필드도 같은 값을 쓴다.

### 네이티브 쪽에 이미 되어 있는 것

`ios/App/App/Info.plist`:

- `NSAppTransportSecurity` → `NSAllowsArbitraryLoads` — 평문 `ws://` 허용.
  **개발 전용이다.** 실제 서버가 `wss://` 로 가면 이 키는 빼라
- `NSLocalNetworkUsageDescription` — iOS 14+ 는 LAN 주소로 나가는 연결마다 권한을
  묻고, 이 문자열이 없으면 **프롬프트조차 못 띄우고 조용히 실패한다**

첫 접속 시 "로컬 네트워크에서 기기를 찾도록 허용" 프롬프트가 뜬다. 거부했다면
설정 → 개인정보 보호 및 보안 → 로컬 네트워크 에서 다시 켜라.

---

## 4. 네이티브 쪽에 손댄 곳

`cap add ios` 가 만든 템플릿에서 바뀐 파일은 넷뿐이다. `cap sync` 는 이것들을
덮어쓰지 않는다.

| 파일 | 무엇을 | 왜 |
|---|---|---|
| `App/GameViewController.swift` | 새 파일. `CAPBridgeViewController` 서브클래스 | 홈 인디케이터와 화면 가장자리 시스템 제스처를 한 번의 스와이프로 뺏기지 않게 |
| `App/SceneDelegate.swift` | 루트 VC 를 위 클래스로 | 한 줄 |
| `App/AppDelegate.swift` | `AVAudioSession` 설정 + 인터럽션 복귀 | 무음 스위치, 타 앱 음악, 전화 후 복구 |
| `App/Info.plist` | 상태바 숨김, ATS, 로컬 네트워크 문구 | 위 3절 참조 |

### 시스템 제스처

`preferredScreenEdgesDeferringSystemGestures = .all` 과
`prefersHomeIndicatorAutoHidden = true`. 둘 다 제스처를 **끄지 않는다** — 한 번의
스와이프를 두 번으로 만든다. 카드는 아래에서 위로 끌어 쓰는데 그게 홈 제스처와
같은 획이라서 필요하다.

### 오디오 세션

`.playback` + `.mixWithOthers`:

- **무음 스위치를 무시하고 소리가 난다.** 이 스위치는 JS 에서 읽을 방법이 전혀
  없어서 안내를 띄우는 것도 불가능하다. 무시하는 카테고리를 고르는 게 우회가 아니라
  유일한 답이다
- 다른 앱 음악을 끊지 않고 그 위에 얹는다

전화·시리 등으로 세션을 뺏기면 iOS 는 알아서 돌려주지 않는다. `AppDelegate` 가
`.shouldResume` 이 붙은 인터럽션 종료를 받아 세션을 다시 활성화하고, 웹 쪽에서는
`Mixer.needsResume` 이 WebKit 전용 `'interrupted'` 상태를 재개 대상으로 친다.
**둘 다 있어야 복구된다.**

---

## 5. safe area 가 어떻게 처리되는가

UI 가 DOM 이 아니라 **three.js 메시**다 (`HudLayer`, `CardLayer`,
`VictoryLayer` — 가상 640x480 "프레임 픽셀" 상자에 배치된다). 그래서
`padding: env(safe-area-inset-top)` 같은 CSS 한 줄로는 닿지 않는다.

`src/platform/safeArea.js` 가 하는 일:

1. 숨은 프로브 엘리먼트의 **padding** 을 `env()` 로 채우고 `getComputedStyle` 로
   읽는다 (커스텀 프로퍼티로는 `env()` 가 리터럴로 돌아와서 안 된다)
2. 그 밴드가 **레터박스된 캔버스와 겹치는 만큼만** 계산한다
3. 프레임 픽셀로 환산해서 세 레이어에 밀어 넣는다

2번이 핵심이다. 캔버스는 4:3 으로 레터박스되어 가운데 정렬되므로, 노치가 캔버스
위가 아니라 옆 검은 띠에 떨어지는 경우가 대부분이다. 실측:

| 기기 / 방향 | 캔버스 | 프레임 px 인셋 |
|---|---|---|
| iPhone 16 세로 | 393x295 @ (0,279) | **전부 0** |
| iPhone 16 가로 | 524x393 @ (164,0) | **bottom 26**, 나머지 0 |
| iPhone SE 세로 | 375x281 | 전부 0 |
| iPad 11 세로 | 834x626 | 전부 0 |

즉 **가로 방향 하단 26 프레임 픽셀이 유일한 실제 노출이고, 거기가 카드 손패가
있는 자리다.** 손패의 기본 노출이 54 프레임 픽셀이니 보이는 카드의 절반이 홈
인디케이터 밑에 깔려 있었다.

`HudLayer.layout()` 과 `VictoryLayer.layout()` 은 원래 리사이즈에 연결되어 있지
않았다 (생성자와 모드 변경에서만 불렸다). 회전을 허용하기로 했으므로
`main.js` 의 리사이즈 팬아웃에 `safeArea.measure()` 를 달고, 프레임 픽셀 답이
**바뀌었을 때만** 세 레이어의 `setSafeInsets` 를 호출한다.

---

## 6. 웹뷰 기본 동작이 어디서 막히는가

한 군데가 아니라서 표로 둔다. 뭘 고치려면 해당 줄을 봐라.

| 동작 | 어디서 막는가 |
|---|---|
| 스크롤 / 러버밴드 | `styles.css` — `touch-action: none` + `body { position: fixed }`, 그리고 `capacitor.config.json` 의 `ios.scrollEnabled: false` |
| 더블탭 줌 | `touch-action: none` (`manipulation` 이면 안 막힌다) |
| 핀치 줌 (브라우저) | `ios.zoomEnabled: false`, 그리고 `webview.js` 의 `gesturestart/change/end` — 이 셋은 WebKit 전용이라 `touch-action` 이 못 잡는다 |
| 길게 눌러 선택 | `user-select: none`, `-webkit-touch-callout: none`, `selectstart`/`dragstart` |
| 풀 투 리프레시 | `overscroll-behavior: none` + `body { position: fixed }` |
| 탭 하이라이트 | `-webkit-tap-highlight-color: transparent` |
| 링크 프리뷰 | `ios.allowsLinkPreview: false` |
| 시스템 가장자리 제스처 | `GameViewController.swift` |
| 상태바 | `Info.plist` 의 `UIStatusBarHidden` |

`styles.css` 에는 `input, textarea` 예외가 하나 있다 — 닉네임 필드는 한글 IME
조합 때문에 실제 `<input>` 이어야 하고, 캐럿을 놓을 수 없는 필드는 필드가 아니다.

---

## 7. Android

플랫폼만 추가되어 있고 이번엔 빌드하지 않았다. 나중에 손대기 전에 **먼저 정해야
하는 것 하나**:

`capacitor.config.json` 의 `server.androidScheme` 기본값은 `https` 다. 그러면
페이지가 https 오리진이 되고 **평문 `ws://` 는 혼합 콘텐츠로 차단된다.** LAN 서버에
붙이려면 `http` 로 바꿔야 한다.

바꾸는 시점이 중요하다: **스킴을 바꾸면 오리진이 바뀌고 localStorage 가 통째로
날아간다** (마크, 닉네임, 서버 주소, 사운드 설정 전부). Android 에 사용자가 생기기
전에 정해라. iOS 의 `iosScheme` 도 같은 성질이라 지금 기본값(`capacitor`)에서
움직이지 않는 게 좋다.

---

## 8. 저장소

키는 넷이다. 전부 try/catch 로 감싼 동기 API 다.

| 키 | 소유자 |
|---|---|
| `bcc.marks.v1` | `MarkStorage` — 마크 |
| `bcc.profile.v1` | `NicknameStorage` — 닉네임 + 서버 주소 |
| `bcc.audio.v1` | `AudioSettings` — 볼륨/음소거 |
| `bcc.metrics.v1` | `MetricsOverlay` — 오버레이 표시 상태 |
| `bcc.online.handoff` (sessionStorage) | `OnlineSession` — 문서 간 핸드오프 |

WKWebView 의 localStorage 는 앱 컨테이너 안에 있고 앱을 지우지 않는 한 유지된다.
iOS 가 임의로 비우는 건 **Safari 의 7일 규칙**(ITP)인데 그건 브라우저 얘기고
WKWebView 앱에는 적용되지 않는다. 다만 저장 계층이 이미 추상화되어 있으므로 실기에서
문제가 확인되면 `@capacitor/preferences` 로 갈아끼우는 건 클래스 세 개를 바꾸는
일이다 — **단, Preferences 는 async 라서 인터페이스가 동기에서 비동기로 바뀐다.**
호출부가 전부 동기 가정이므로 그 부분이 실제 작업량이다.

/**
 * 첫 실행에서 한 번, **재 보고** 티어를 내린다. 추측하지 않는다.
 *
 * ── 기본값이 최대인 것의 대가를 갚는 자리 ──────────────────────────────────
 * `defaultGraphicsSettings` 가 최대인 이유는 이 게임이 뚜껑 대여섯 개와 판 하나가
 * 전부인 장면이고, 기본을 낮춰 두면 대부분의 기기가 이유 없이 못생긴 화면을 보게
 * 되기 때문이다. 그 판단의 대가는 반대쪽 끝에 있다: 못 버티는 기기에서 첫인상이
 * "그냥 느린 게임" 이 되고, 설정을 찾지 않는 사람은 그대로 나간다.
 *
 * ── 왜 기기 힌트가 아니라 측정인가 ─────────────────────────────────────────
 * `hardwareConcurrency`, `deviceMemory`, `MAX_TEXTURE_SIZE` 로 첫 실행 때 추정하는
 * 방법이 있고, 그건 추측이라 자주 틀린다 — 코어가 여덟 개인 저가 폰과 코어가 넷인
 * 노트북이 같은 답을 내고, 어느 쪽으로 틀렸는지 사용자에게는 보이지 않는다.
 * 여기서는 이 기기에서 이 게임이 실제로 몇 프레임을 내는지를 잰다.
 *
 * ── 사용자의 결정을 절대 덮지 않는다 ───────────────────────────────────────
 * 개입은 `GraphicsSettingsBook.demoteTo` 를 통해서만 일어나고, 그 함수는
 * `userSet` 이 참이면 아무 일도 하지 않는다. 한 번이라도 설정 화면에서 칩을
 * 누른 기기에서는 이 클래스가 존재하지 않는 것과 같다. 거절이 저기 한 곳에
 * 있는 것이 요점이다 — 여기서 `userSet` 을 읽고 판단하면 그 판단이 두 군데가
 * 되고, 언젠가 한쪽이 잊는다.
 *
 * ── 그리고 **한 단계만**, **한 번만** ──────────────────────────────────────
 * 내려간 뒤 다시 재지 않는다. 두 번 내리려면 다시 재야 하고, 다시 재려면 방금
 * 내린 것이 효과가 있었는지를 기다려야 하고, 그러면 첫 매치 내내 화면이 계단으로
 * 내려간다. 한 단계로 부족한 기기는 사용자가 설정에서 마저 내린다 — 그때는
 * `userSet` 이 켜지고 이 클래스는 영원히 물러난다.
 */

/**
 * 시작 직후 이만큼은 버린다, ms.
 *
 * 부팅 직후의 프레임은 이 게임의 프레임이 아니다: 셰이더 컴파일, 첫 텍스처
 * 업로드, 폰트 도착에 따른 UI 캐시 전면 재구축이 전부 첫 1~2초에 몰려 있다.
 * 그걸 세면 어떤 기기든 강등당한다.
 */
const WARMUP_MS = 3000;

/** 판단에 쓰는 표본 수의 창. 60 Hz 에서 약 6초. */
const WINDOW = 360;

/**
 * 이만큼 모이기 전에는 판단하지 않는다.
 *
 * 백분위수는 표본이 적으면 한 프레임이 결과를 정한다. 180 이면 1% 지점이
 * 두 번째로 느린 프레임 근처이므로, 우연한 히치 하나로는 움직이지 않는다.
 */
const MIN_SAMPLES = 180;

/**
 * 이 아래면 내린다. 1% low, fps.
 *
 * 30 이다. 평균이 아니라 **1% low** 라는 점이 이 숫자를 정한다 — 평균 30 은
 * 느린 게임이고, 1% low 30 은 "가장 느린 백 분의 일이 33 ms 였다" 즉 대부분의
 * 프레임은 그보다 낫다는 뜻이다. 그 아래로 내려간 기기는 최대 티어를 감당하지
 * 못하고 있는 것이 맞다.
 */
const MIN_FPS_LOW = 30;

/**
 * 이보다 긴 간격은 프레임레이트가 아니다, ms.
 *
 * 탭이 뒤로 갔다 오거나 OS 가 잠깐 스케줄에서 뺀 경우다. `MetricsOverlay` 는
 * 같은 자리에 2000 을 쓰는데 그쪽은 보여 주는 것이 일이라 관대해도 되고, 여기는
 * 백분위수 하나로 사용자 설정을 바꾸므로 더 좁게 잡는다.
 */
const MAX_SANE_MS = 1000;

/**
 * 이만큼이라도 AI 가 일했으면 그 프레임은 세지 않는다, ms.
 *
 * ── 이걸 빠뜨리면 모든 기기가 강등된다 ─────────────────────────────────────
 * `ThinkBudget` 은 탐색이 도는 프레임을 **일부러** 리프레시 간격의 배수까지
 * 늘린다 — 120 Hz 화면에서 16.7 ms, 즉 60 fps 다. 카메라가 이징하는 것 말고는
 * 아무것도 움직이지 않는 프레임이라 사람은 알아채지 못하고, 그 대가로 탐색이
 * 프레임의 나머지를 전부 받는다.
 *
 * 그 프레임들은 정의상 느리고, 느린 것이 의도다. 세면 AI 와 두는 첫 매치가
 * 곧바로 강등 판정을 받는다. `ThinkBudget.note` 가 리프레시 주기를 읽을 때
 * 같은 값으로 같은 프레임을 걸러 내는 것과 같은 이유, 같은 문턱이다.
 */
const IDLE_AI_MS = 0.5;

/** p 번째 백분위수. 원본을 건드리지 않는다. */
function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

export class FirstRunProbe {
  /**
   * @param {object} opts
   * @param {import('./GraphicsSettings.js').GraphicsSettingsBook} opts.settings
   * @param {(info: {from: number, to: number, fpsLow: number}) => void} [opts.onDemote]
   *   실제로 내려갔을 때 한 번. 알리는 방법은 문서마다 다르므로 여기서 정하지
   *   않는다 — 경기 화면은 `ModalLayer.tell` 을 쓴다.
   */
  constructor({ settings, onDemote = null }) {
    this.settings = settings;
    this.onDemote = onDemote;
    this._elapsed = 0;
    this._frames = [];
    this._done = false;
  }

  /** 더 볼 것이 없는가. 판정했거나, 사용자가 이미 골랐거나, 바닥이거나. */
  get done() {
    return this._done || this.settings.userSet || this.settings.tier <= 0;
  }

  /**
   * 프레임 하나를 보고한다. 루프의 끝에서, 프레임마다.
   *
   * @param {number} rawMs 클램프 **전**의 실제 간격. 시뮬레이션이 받는 값이
   *   아니라 실제로 흐른 시간이어야 한다 — 클램프된 값은 정의상 50 ms 를 넘지
   *   않으므로 그걸로는 느린 기기를 영원히 못 찾는다.
   * @param {number} aiMs 이 프레임에서 탐색이 쓴 시간
   */
  note(rawMs, aiMs) {
    if (this.done) return;

    if (!(rawMs > 0) || rawMs > MAX_SANE_MS) return;
    this._elapsed += rawMs;
    if (this._elapsed < WARMUP_MS) return;
    if ((aiMs ?? 0) >= IDLE_AI_MS) return;

    this._frames.push(rawMs);
    if (this._frames.length > WINDOW) this._frames.shift();
    if (this._frames.length < MIN_SAMPLES) return;

    this._decide();
  }

  _decide() {
    // 판정은 한 번뿐이다. 내리든 안 내리든 여기서 끝난다 — "지금은 괜찮았지만
    // 나중에 다시 볼게" 는 매치 내내 화면이 계단으로 내려가는 그 동작이다.
    this._done = true;

    const p99 = percentile(this._frames, 99);
    const fpsLow = p99 > 0 ? 1000 / p99 : 0;
    if (fpsLow >= MIN_FPS_LOW) return;

    const from = this.settings.tier;
    if (!this.settings.demoteTo(from - 1)) return;
    this.onDemote?.({ from, to: this.settings.tier, fpsLow });
  }
}

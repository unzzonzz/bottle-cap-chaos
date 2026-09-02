/**
 * 플레이어가 그래픽에 대해 고른 것, 그리고 그것이 사는 곳.
 *
 * ── 오디오 문서에 얹지 않는다 ───────────────────────────────────────────────
 * `AudioSettings.sanitise` 는 기본값에서 시작해 `volume` 과 `muted` 만 필드별로
 * 복사하고, `save` 는 나가는 길에도 다시 정화한다 — 그러니 그 문서에 밀어 넣은
 * 그래픽 필드는 누군가 볼륨을 한 칸 움직이는 순간 조용히 사라진다. 자기 키,
 * 자기 버전, 자기 검증기.
 *
 * ── 나머지는 전부 `AudioSettings` 를 그대로 베낀 것이다 ─────────────────────
 * 그리고 그건 `AudioSettings` 가 `MarkStorage` 를 베낀 것이다. 기본값을 돌려주는
 * 추상 베이스(그래서 타입이 아니라 널 객체로 쓸 수 있다), 호출마다 개별 try 를
 * 두른 브라우저 구현, 위의 어느 것도 구현을 이름으로 부르지 않음을 증명하는
 * 인메모리 쌍둥이. 구조를 발명할 자리가 아니다.
 *
 * ── `load` 의 try 가 둘인 것은 중복이 아니다 ────────────────────────────────
 * `localStorage` 는 프라이빗 모드나 샌드박스 프레임에서 **접근만으로도** 던진다.
 * 손상된 blob 과는 다른 실패이고, 둘을 합치면 프라이빗 브라우징 세션이 JSON
 * 경로로 들어가 거기서 죽는다.
 *
 * ── 여기 **없는** 것 ───────────────────────────────────────────────────────
 * 티어가 실제로 무엇을 바꾸는지의 표. 그건 개발자의 것이라 `CONFIG.view.graphics`
 * 에 있고, `CONFIG` 는 이 프로젝트 어디에도 저장되지 않는다. 여기 있는 것은
 * 설정 화면이 내놓는 두 가지뿐이다 — 어느 칸인가, 그리고 그걸 사람이 골랐는가.
 */

import { clampTier, TIER_MAX } from './quality.js';

/** 저장 스키마 버전. 저장하는 모양이 바뀌면 올린다. */
const VERSION = 1;
const KEY = 'bcc.graphics.v1';

/**
 * @typedef {object} GraphicsSettingsData
 * @property {number} tier      0..4. 0 = 최저, 4 = 최대
 * @property {boolean} userSet  사람이 직접 골랐는가
 *
 * `userSet` 은 자동 강등이 존재하기 때문에 있다. 첫 매치에서 측정한 값으로 한
 * 단계 내리는 일이 일어나는데, 그 결과를 그냥 `tier` 에 쓰면 다음 부팅에서 그게
 * 사용자가 고른 값과 구별되지 않는다. 강등은 **사용자가 아직 아무 말도 하지
 * 않았을 때만** 허용되고, 이 필드가 그 조건이다.
 */

/**
 * 저장한 적 없는 기기의 기본값.
 *
 * 4(최대)다. 이 게임은 뚜껑 대여섯 개와 판 하나가 전부인 장면이고, 기본을 낮춰
 * 두면 대부분의 기기가 이유 없이 못생긴 화면을 보게 된다. 못 버티는 기기는
 * `FirstRunProbe` 의 자동 강등이 처리한다 — 추측이 아니라 첫 매치에서 실제로
 * 잰 1% low 로.
 *
 * `userSet` 은 거짓으로 시작한다. 아직 아무도 아무것도 고르지 않았다.
 */
export function defaultGraphicsSettings() {
  return { tier: TIER_MAX, userSet: false };
}

function sanitise(raw) {
  const out = defaultGraphicsSettings();
  if (!raw || typeof raw !== 'object') return out;

  // 필드별로 타입 AND 범위를 본다. 전체 형태 검사는 하지 않는다 — 필드가 둘인
  // 빌드가 쓴 문서도, 셋인 빌드가 쓴 문서도 버려지는 대신 쓸 수 있게 돌아온다.
  if (typeof raw.tier === 'number' && Number.isFinite(raw.tier)) out.tier = clampTier(raw.tier);
  if (typeof raw.userSet === 'boolean') out.userSet = raw.userSet;
  return out;
}

/**
 * 계약. 상속하거나, 이 세 메서드를 가진 무엇이든 건네라.
 *
 * `AudioSettingsStorage` 와 같이 동기다. 이유도 같다: 존재하는 유일한 구현이
 * 동기이고, 부팅 경로가 씬을 세우는 도중에 읽는다.
 */
export class GraphicsSettingsStorage {
  /** @returns {GraphicsSettingsData} 절대 null 이 아니다. */
  load() {
    return defaultGraphicsSettings();
  }

  /** @param {GraphicsSettingsData} _s */
  save(_s) {}

  /** 이 기기가 설정을 가진 적 없게 만든다. */
  delete() {}
}

/** 브라우저 구현. 키 하나 아래 JSON 문서 하나. */
export class LocalStorageGraphicsSettings extends GraphicsSettingsStorage {
  /** @param {string} [key] */
  constructor(key = KEY) {
    super();
    this.key = key;
  }

  load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return defaultGraphicsSettings();
    }
    if (!raw) return defaultGraphicsSettings();
    try {
      return sanitise(JSON.parse(raw));
    } catch {
      // 파싱 불가. 고치는 대신 없는 것으로 친다 — 손상된 blob 에서 추측할 만한
      // 것은 없다.
      return defaultGraphicsSettings();
    }
  }

  /** @returns {boolean} 실제로 내려앉았는가. */
  save(settings) {
    try {
      window.localStorage.setItem(
        this.key,
        JSON.stringify({ version: VERSION, ...sanitise(settings) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  delete() {
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      /* 어쩔 도리도 없고, 성공에 매달린 것도 없다 */
    }
  }
}

/** 인메모리. 패널의 리셋과 테스트를 위한 것. */
export class MemoryGraphicsSettings extends GraphicsSettingsStorage {
  constructor(settings = defaultGraphicsSettings()) {
    super();
    this._s = sanitise(settings);
  }

  load() {
    return sanitise(this._s);
  }

  save(settings) {
    this._s = sanitise(settings);
    return true;
  }

  delete() {
    this._s = defaultGraphicsSettings();
  }
}

/**
 * 모델: 문서를 들고, 규칙을 적용하고, 써 내리고, 알린다.
 *
 * `AudioSettingsBook` 의 모양 그대로다. 세부처럼 보이지만 아닌 부분들 포함:
 * 저장소는 **주입**되고 생성자에서 즉시 로드되며(부팅이 첫 프레임 전에 티어를
 * 알아야 한다), 모든 변경자는 던지는 대신 불리언을 돌려주고, `_commit` 은
 * **무조건** 알린다 — 쿼터 실패는 경고할 이유이지 움직이지 않는 칩을 보여줄
 * 이유가 아니다 — 그리고 `onChange` 는 자기 해제 함수를 돌려주어 소비자가
 * `dispose()` 에서 버릴 수 있게 한다.
 */
export class GraphicsSettingsBook {
  /** @param {GraphicsSettingsStorage} storage */
  constructor(storage) {
    this.storage = storage;
    /** @type {GraphicsSettingsData} */
    this._data = storage.load();
    this._listeners = new Set();
  }

  get tier() {
    return this._data.tier;
  }

  /** 사람이 고른 적이 있는가. 자동 강등이 이걸 보고 물러선다. */
  get userSet() {
    return this._data.userSet;
  }

  snapshot() {
    return { ...this._data };
  }

  /**
   * 사람이 고른 티어.
   *
   * `userSet` 을 켠다. 값이 같아도 켠다 — 최대에서 다시 최대를 고른 것은 "이대로
   * 두겠다" 는 결정이고, 그 뒤에 자동 강등이 끼어드는 것은 그 결정을 덮는 것이다.
   */
  setTier(tier) {
    const next = clampTier(tier);
    const same = next === this._data.tier && this._data.userSet;
    this._data.tier = next;
    this._data.userSet = true;
    if (same) return true;
    return this._commit();
  }

  /**
   * 측정이 고른 티어. **사용자가 이미 골랐다면 아무 일도 하지 않는다.**
   *
   * 자동 강등의 유일한 입구이고, 거절이 여기 한 곳에 있는 것이 요점이다 —
   * 호출부가 `userSet` 을 보고 판단하게 두면 그 판단이 두 군데가 되고, 언젠가
   * 한쪽이 잊는다.
   *
   * @returns {boolean} 실제로 내려갔는가
   */
  demoteTo(tier) {
    if (this._data.userSet) return false;
    const next = clampTier(tier);
    if (next >= this._data.tier) return false;
    this._data.tier = next;
    return this._commit();
  }

  /**
   * 첫 실행으로 되돌리고 키를 **잊는다**.
   *
   * `AudioSettingsBook.reset` 이 그렇지 않은 것과 같은 이유로 일부러 `_commit`
   * 을 타지 않는다: 저장하는 리셋은 기본값을 곧바로 도로 쓰는 것이지 이 기기가
   * 설정을 가진 적 없게 만드는 것이 아니다. `userSet` 이 거짓으로 돌아가므로
   * 자동 강등도 다시 한 번 기회를 얻는다.
   */
  reset() {
    this._data = defaultGraphicsSettings();
    this.storage.delete();
    this._emit();
    return true;
  }

  /** @returns {() => void} unsubscribe */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _commit() {
    const ok = this.storage.save(this._data) !== false;
    this._emit();
    return ok;
  }

  _emit() {
    for (const fn of this._listeners) fn(this);
  }
}

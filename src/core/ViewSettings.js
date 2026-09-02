/**
 * 플레이어가 카메라에 대해 고른 것, 그리고 그것이 사는 곳.
 *
 * ── `GraphicsSettings` 와 같은 모양이고, 같은 이유로 자기 문서다 ────────────
 * 그 파일 머리말이 왜 오디오 문서에 얹지 않았는지를 길게 적어 두었다: 남의
 * `sanitise` 는 자기가 아는 필드만 복사하므로, 얹은 필드는 그쪽 화면을 한 번
 * 만지는 순간 조용히 사라진다. 자기 키, 자기 버전, 자기 검증기 — 그 셋이 이
 * 파일이 존재하는 전부다.
 *
 * 그래픽 문서에 얹지 않은 것은 기술이 아니라 **분류** 때문이다. 티어는 이 기기가
 * 무엇을 감당하는가에 대한 답이고 `FirstRunProbe` 의 자동 강등이 그것을 건드린다.
 * 카메라 추적은 이 사람이 무엇을 보고 싶은가에 대한 답이고 아무것도 자동으로
 * 그것을 바꾸지 않는다. 둘을 한 문서에 담으면 "측정이 고쳐도 되는 값"과 "사람만
 * 고칠 수 있는 값"이 같은 blob 안에 섞인다.
 *
 * ── 여기 **없는** 것 ───────────────────────────────────────────────────────
 * 추적이 실제로 무엇을 하는지. 그건 `render/CamTracker.js` 와 `CONFIG.view.track`
 * 이고, `CONFIG` 는 이 프로젝트 어디에도 저장되지 않는다. 여기 있는 것은 설정
 * 화면이 내놓는 한 가지 — 켰는가 껐는가 — 뿐이다.
 */

/** 저장 스키마 버전. 저장하는 모양이 바뀌면 올린다. */
const VERSION = 1;
const KEY = 'bcc.view.v1';

/**
 * @typedef {object} ViewSettingsData
 * @property {boolean} trackCamera  발사한 뚜껑을 카메라가 따라가는가
 */

/**
 * 저장한 적 없는 기기의 기본값.
 *
 * 켬이다. 추적은 이 게임의 기본 연출이고 — 뚜껑이 판 끝으로 날아가 떨어지는
 * 것이 서바이벌의 사건 그 자체다 — 끄는 쪽이 선택이어야 한다.
 */
export function defaultViewSettings() {
  return { trackCamera: true };
}

function sanitise(raw) {
  const out = defaultViewSettings();
  if (!raw || typeof raw !== 'object') return out;
  // 필드별로 타입을 본다. 전체 형태 검사는 하지 않는다 — 필드가 하나인 빌드가
  // 쓴 문서도, 둘인 빌드가 쓴 문서도 버려지는 대신 쓸 수 있게 돌아온다.
  if (typeof raw.trackCamera === 'boolean') out.trackCamera = raw.trackCamera;
  return out;
}

/**
 * 계약. 상속하거나, 이 세 메서드를 가진 무엇이든 건네라.
 *
 * `GraphicsSettingsStorage` 와 같이 동기다. 이유도 같다: 존재하는 유일한 구현이
 * 동기이고, 부팅 경로가 첫 프레임 전에 읽는다.
 */
export class ViewSettingsStorage {
  /** @returns {ViewSettingsData} 절대 null 이 아니다. */
  load() {
    return defaultViewSettings();
  }

  /** @param {ViewSettingsData} _s */
  save(_s) {}

  /** 이 기기가 설정을 가진 적 없게 만든다. */
  delete() {}
}

/** 브라우저 구현. 키 하나 아래 JSON 문서 하나. */
export class LocalStorageViewSettings extends ViewSettingsStorage {
  /** @param {string} [key] */
  constructor(key = KEY) {
    super();
    this.key = key;
  }

  load() {
    /**
     * try 가 둘인 것은 중복이 아니다.
     *
     * `localStorage` 는 프라이빗 모드나 샌드박스 프레임에서 **접근만으로도**
     * 던진다. 손상된 blob 과는 다른 실패이고, 둘을 합치면 프라이빗 브라우징
     * 세션이 JSON 경로로 들어가 거기서 죽는다.
     */
    let raw = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return defaultViewSettings();
    }
    if (!raw) return defaultViewSettings();
    try {
      return sanitise(JSON.parse(raw));
    } catch {
      return defaultViewSettings();
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
export class MemoryViewSettings extends ViewSettingsStorage {
  constructor(settings = defaultViewSettings()) {
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
    this._s = defaultViewSettings();
  }
}

/**
 * 모델: 문서를 들고, 써 내리고, 알린다.
 *
 * `GraphicsSettingsBook` 의 모양 그대로다. 저장소는 **주입**되고 생성자에서
 * 즉시 로드되며(부팅이 첫 프레임 전에 값을 알아야 한다), 변경자는 던지는 대신
 * 불리언을 돌려주고, `_commit` 은 **무조건** 알린다 — 쿼터 실패는 경고할 이유이지
 * 움직이지 않는 판을 보여줄 이유가 아니다 — 그리고 `onChange` 는 자기 해제
 * 함수를 돌려주어 소비자가 `dispose()` 에서 버릴 수 있게 한다.
 */
export class ViewSettingsBook {
  /** @param {ViewSettingsStorage} storage */
  constructor(storage) {
    this.storage = storage;
    /** @type {ViewSettingsData} */
    this._data = storage.load();
    this._listeners = new Set();
  }

  get trackCamera() {
    return this._data.trackCamera;
  }

  snapshot() {
    return { ...this._data };
  }

  /** @returns {boolean} 실제로 내려앉았는가 */
  setTrackCamera(on) {
    this._data.trackCamera = !!on;
    return this._commit();
  }

  toggleTrackCamera() {
    return this.setTrackCamera(!this._data.trackCamera);
  }

  /**
   * 첫 실행으로 되돌리고 키를 **잊는다**.
   *
   * `GraphicsSettingsBook.reset` 과 같은 이유로 일부러 `_commit` 을 타지 않는다:
   * 저장하는 리셋은 기본값을 곧바로 도로 쓰는 것이지 이 기기가 설정을 가진 적
   * 없게 만드는 것이 아니다.
   */
  reset() {
    this._data = defaultViewSettings();
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

import { CATEGORIES, CATEGORY_LABEL } from './categories.js';
import { SOUNDS, SOUND_IDS, resetSounds } from './soundBank.js';

/**
 * The sound folder, for both panels.
 *
 * ── one builder, two hosts ─────────────────────────────────────────────────
 * `bootPhysicsDebug` and `bootMenuDebug` are separate panels on separate pages
 * with no code in common, and both pages make sound. Two copies of this would be
 * two copies to keep in step, and the one that fell behind would be the menu's —
 * which is where the bottle, the cap wipe and the whole mark editor live.
 *
 * ── the brief asks for live parameter editing and means it ─────────────────
 * "이게 있어야 톤을 잡을 수 있다. 반드시 넣어라." Seventy sounds times twenty
 * parameters is fourteen hundred rows, which is not a panel — so the editor is a
 * PICKER plus a set of rows rebuilt for whatever is selected. `lil-gui` destroys
 * and rebuilds cleanly, and the rows bind straight to the leaf objects inside
 * `soundBank`, so a drag is audible on the very next trigger with no plumbing.
 *
 * That is also why `resetSounds` restores key by key instead of replacing the
 * definition objects: these controllers hold references to `SOUNDS.goal.tone`,
 * and swapping the parent would leave every row writing into an orphan.
 *
 * ── the panel must not be load-bearing ─────────────────────────────────────
 * Every handle is optional-chained. Turning the panel off changes nothing about
 * what the game does, which is the rule stated in `config.js`, `main.js` and
 * `MenuDebug` alike.
 */

/** Waveforms, as Korean labels over the values the synth wants. */
const WAVES = { '사각파': 'square', '삼각파': 'triangle', '톱니파': 'sawtooth', '사인파': 'sine' };
const FILTERS = { '로우패스': 'lowpass', '밴드패스': 'bandpass', '하이패스': 'highpass' };
const CURVES = { '지수': 'exp', '선형': 'lin' };

/**
 * @param {object} gui  a lil-gui instance or folder
 * @param {{audio: import('./AudioSystem.js').AudioSystem,
 *          config: object,
 *          settings: import('./AudioSettings.js').AudioSettingsBook}} ctx
 * @returns {{refresh: () => void, folder: object}}
 */
export function addAudioFolder(gui, { audio, config, settings }) {
  const folder = gui.addFolder('사운드');

  // ── readouts ─────────────────────────────────────────────────────────────
  const stats = { device: '', voices: '', crush: '' };
  const deviceRow = folder.add(stats, 'device').name('오디오 장치').disable();
  const voiceRow = folder.add(stats, 'voices').name('재생 중 (보이스/루프)').disable();
  const crushRow = folder.add(stats, 'crush').name('크러시 상태').disable();

  folder
    .add(
      {
        unlock: () => {
          audio?.unlock();
          refresh();
        },
      },
      'unlock',
    )
    .name('▶ 오디오 시작 (제스처 대신)');
  /**
   * The panic button.
   *
   * A held sound that will not stop is the one audio failure a player cannot
   * work around and cannot diagnose — it is not attached to anything on screen,
   * so there is nothing to look at. This kills every voice at once, which both
   * silences it and ANSWERS the question: if the noise stops, it was a stuck
   * voice in this graph; if it does not, it was never ours.
   */
  folder
    .add(
      {
        panic: () => {
          audio?.stopAll(0.02);
          refresh();
        },
      },
      'panic',
    )
    .name('■ 모든 소리 즉시 정지');

  // ── the player's own settings ────────────────────────────────────────────
  //
  // Bound through getter/setter proxies rather than to a plain object, because
  // these live behind a storage model that has to write through and notify —
  // the same escape hatch `MenuDebug` uses for the editor's brush sizes.
  const pref = folder.addFolder('설정 (저장됨)');
  pref
    .add(
      {
        get v() {
          return settings?.volume ?? 0;
        },
        set v(x) {
          settings?.setVolume(x);
        },
      },
      'v',
      0,
      1,
      0.01,
    )
    .name('마스터 볼륨');
  pref
    .add(
      {
        get v() {
          return settings?.muted ?? false;
        },
        set v(x) {
          settings?.setMuted(x);
        },
      },
      'v',
    )
    .name('음소거');
  pref
    .add(
      {
        clear: () => {
          if (!window.confirm('저장된 사운드 설정을 지웁니다. 계속할까요?')) return;
          settings?.reset();
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
        },
      },
      'clear',
    )
    .name('↺ 저장된 설정 지우기');

  // ── the space ────────────────────────────────────────────────────────────
  /**
   * 공간이 톤보다 위에 있는 이유는 이제 이쪽이 전역 톤이기 때문이다.
   * 크러셔는 유니티로 남겨 둔 옛 장치이고, 소리를 한 기계의 것으로 만드는 것은
   * 잔향이다 — `config.audio.space` 주석 참조.
   */
  const space = folder.addFolder('공간 (전역)');
  space.add(config.space, 'mix', 0, 1.5, 0.01).name('보내기 배율').onChange(() => audio?.applyConfig());
  for (const name of Object.keys(config.space.category)) {
    space
      .add(config.space.category, name, 0, 1, 0.01)
      .name(name)
      .onChange(() => audio?.applyConfig());
  }
  space.open();

  // ── the tone ─────────────────────────────────────────────────────────────
  const tone = folder.addFolder('톤 (전역)');
  tone.add(config, 'masterTrim', 0, 1.5, 0.01).name('마스터 트림');
  tone
    .add(config, 'crushBits', 2, 16, 1)
    .name('비트 심도 (16 = 끔)')
    .onChange(() => audio?.applyConfig());
  tone
    .add(config, 'crushRateHz', 2000, 48000, 500)
    .name('샘플레이트 (Hz)')
    .onChange(() => audio?.applyConfig());
  tone.add(config, 'pitchJitter', 0, 0.25, 0.005).name('피치 변조 폭 (±)');
  tone.add(config, 'smoothingSeconds', 0.002, 0.12, 0.002).name('지속음 스무딩 (s)');
  tone.open();

  // ── overload control ─────────────────────────────────────────────────────
  const load = folder.addFolder('과부하 방지');
  load.add(config, 'maxVoices', 2, 48, 1).name('동시 재생 상한 (전체)');
  load.add(config, 'voicesPerSound', 1, 8, 1).name('동시 재생 상한 (종류별)');
  load.add(config, 'cooldownScale', 0, 4, 0.05).name('쿨다운 배율 (0 = 끔)');
  load.add(config, 'repeatWindowScale', 1, 8, 0.1).name('반복 감쇠 구간 (배)');
  load.add(config, 'repeatDuck', 0, 1, 0.01).name('반복 감쇠 하한');
  load
    .add(
      {
        clear: () => {
          audio?.pool.resetCounters();
          refresh();
        },
      },
      'clear',
    )
    .name('↺ 누락/탈취 카운터 초기화');
  load.open();

  // ── per-category trims ───────────────────────────────────────────────────
  const cats = folder.addFolder('카테고리 볼륨');
  for (const name of CATEGORIES) {
    cats
      .add(config.category, name, 0, 1.5, 0.01)
      .name(CATEGORY_LABEL[name] ?? name)
      .onChange(() => audio?.applyConfig());
  }

  // ── collisions ───────────────────────────────────────────────────────────
  const hit = folder.addFolder('충돌 판정');
  hit.add(config.impact, 'minDeltaV', 4, 120, 1).name('최소 속도 변화 (cm/s)');
  hit.add(config.impact, 'gravityBias', 0, 30, 0.5).name('스텝당 중력 보정 (cm/s)');
  hit.add(config.impact, 'fullDeltaV', 60, 900, 10).name('최대 세기 기준 (cm/s)');
  hit.add(config.impact, 'perFrame', 1, 8, 1).name('프레임당 최대 충돌음');
  hit.add(config.impact, 'groundGain', 0, 1, 0.02).name('바닥 착지 볼륨');
  hit.add(config.impact, 'pairRadius', 1, 6, 0.1).name('짝 판정 반경 (반지름 배)');

  // ── the continuous sounds ────────────────────────────────────────────────
  const held = folder.addFolder('지속음');
  held.add(config.slide, 'minSpeed', 0, 80, 1).name('미끄러짐 최소 속도');
  held.add(config.slide, 'fullSpeed', 40, 600, 5).name('미끄러짐 최대 속도');
  held.add(config.slide, 'gain', 0, 1, 0.01).name('미끄러짐 볼륨');
  held.add(config.slide, 'rateAtFull', 0.5, 3, 0.05).name('미끄러짐 피치 (최대)');
  held.add(config, 'chaosGain', 0, 1, 0.01).name('혼란 지속음 볼륨');
  held.add(config, 'shakeGain', 0, 1, 0.01).name('병 흔들림 볼륨');
  held.add(config, 'flipMinSpin', 0, 20, 0.5).name('뒤집힘 최소 회전 (rad/s)');
  held.add(config, 'fallY', -20, 2, 0.5).name('낙하 판정 높이 (y)');

  // ── audition ─────────────────────────────────────────────────────────────
  //
  // One button per sound, grouped by bus. Separate from the editor below on
  // purpose, exactly as the card panel keeps '연출만 재생' apart from '효과 강제
  // 발동': one is for listening, the other is for changing.
  const audition = folder.addFolder('사운드 재생 (전체 목록)');
  for (const category of CATEGORIES) {
    const ids = SOUND_IDS.filter((id) => SOUNDS[id].category === category);
    if (!ids.length) continue;
    const sub = audition.addFolder(`${CATEGORY_LABEL[category] ?? category} (${ids.length})`);
    for (const id of ids) {
      sub
        .add(
          {
            go: () => {
              // Full intensity, so a collision auditions as the hit it is
              // designed around rather than as whatever the last one happened
              // to be. Loops audition as a one-shot of their held shape.
              //
              // And it WALKS the scale on a sound that has one: pressing the
              // same button eight times is the only way to hear the thing the
              // quantiser actually does, and a fixed degree would make every
              // press identical — which is exactly the failure it was added to
              // fix. See `scale.js`.
              audio?.play(id, { intensity: 1, degree: nextDegree(id) });
            },
          },
          'go',
        )
        .name(`▶ ${id}`);
    }
  }

  /**
   * A walking degree per sound id, for the audition buttons.
   *
   * Panel-local and deliberately not `ContactAudio`'s counter: that one belongs
   * to a shot, and pressing a button on the debug panel is not a shot.
   */
  const degrees = new Map();
  function nextDegree(id) {
    const d = degrees.get(id) ?? 0;
    degrees.set(id, (d + 1) % 8);
    return d;
  }

  // ── the live parameter editor ────────────────────────────────────────────
  const editor = folder.addFolder('사운드 파라미터 편집');
  const pick = { id: SOUND_IDS[0] };
  /** @type {object[]} folders rebuilt whenever the selection changes. */
  let rows = [];

  editor
    .add(pick, 'id', SOUND_IDS)
    .name('사운드')
    .onChange(() => buildRows());
  editor
    .add({ go: () => audio?.play(pick.id, { intensity: 1, degree: nextDegree(pick.id) }) }, 'go')
    .name('▶ 선택한 사운드 재생');
  editor
    .add(
      {
        reset: () => {
          if (!window.confirm('모든 사운드 파라미터를 초기값으로 되돌립니다.')) return;
          resetSounds();
          buildRows();
        },
      },
      'reset',
    )
    .name('↺ 사운드 전체 초기화');

  function buildRows() {
    for (const f of rows) f.destroy();
    rows = [];
    const def = SOUNDS[pick.id];
    if (!def) return;

    const meta = editor.addFolder('공통');
    meta.add(def, 'gain', 0, 1.5, 0.01).name('볼륨');
    meta.add(def, 'priority', 0, 9, 1).name('우선순위 (카테고리 내)');
    addOptional(meta, def, 'cooldown', 0, 1, 0.005, '쿨다운 (s)');
    addOptional(meta, def, 'voices', 1, 8, 1, '동시 재생 상한');
    addOptional(meta, def, 'jitter', 0, 3, 0.05, '피치 변조 배율');
    addOptional(meta, def, 'velGain', 0, 1, 0.02, '세기 → 볼륨');
    addOptional(meta, def, 'velPitch', 0, 1, 0.02, '세기 → 피치 (충돌음은 0)');
    addOptional(meta, def, 'velLength', 0, 1, 0.02, '세기 → 길이');
    addOptional(meta, def, 'velBright', 0, 1, 0.02, '세기 → 밝기');
    /**
     * 보내기는 0 일 수 있고 `addOptional` 은 `undefined` 만 거른다 — 0 을 적어 둔
     * 소리(호버, 루프)에도 행이 서야 한다. `scale` 은 불리언이라 범위가 없다.
     */
    addOptional(meta, def, 'send', 0, 1, 0.01, '공간 보내기 (미지정 = 카테고리)');
    if (def.scale !== undefined) meta.add(def, 'scale').name('음계 양자화');
    meta.open();
    rows.push(meta);

    for (const [key, label] of [
      ['tone', '오실레이터 1'],
      ['tone2', '오실레이터 2'],
    ]) {
      const layer = def[key];
      if (!layer) continue;
      const f = editor.addFolder(label);
      f.add(layer, 'wave', WAVES).name('파형');
      /**
       * 한 레이어는 헤르츠나 배음비 중 하나로만 음정을 말한다 — `soundBank` 의
       * `tone()` 이 요청받은 쪽만 내보낸다. 그래서 행도 있는 쪽에만 선다.
       *
       * 무조건 `add` 하면 없는 키에 슬라이더가 걸려서 폴더 전체가 죽는다. 이
       * 패널이 정확히 그렇게 한 번 죽었다.
       */
      addOptional(f, layer, 'freq', 20, 6000, 1, '주파수 (Hz)');
      addOptional(f, layer, 'freqEnd', 20, 6000, 1, '도착 주파수 (Hz)');
      addOptional(f, layer, 'ratio', 0.25, 12, 0.05, '기음 대비 배음비');
      addOptional(f, layer, 'ratioEnd', 0.25, 12, 0.05, '도착 배음비');
      f.add(layer, 'gain', 0, 1, 0.01).name('레이어 볼륨');
      f.add(layer, 'attack', 0.0005, 0.4, 0.0005).name('어택 (s)');
      f.add(layer, 'hold', 0, 0.4, 0.005).name('홀드 (s)');
      f.add(layer, 'decay', 0.005, 1.2, 0.005).name('디케이 (s)');
      f.add(layer, 'curve', CURVES).name('디케이 곡선');
      f.add(layer, 'steps', 1, 8, 1).name('반복 횟수');
      f.add(layer, 'stepGap', 0.005, 0.4, 0.005).name('반복 간격 (s)');
      f.add(layer, 'stepRatio', 0.25, 4, 0.01).name('반복 음정 비');
      f.add(layer, 'stepGain', 0.2, 1.4, 0.01).name('반복 감쇠');
      addFilterRows(f, layer);
      rows.push(f);
    }

    if (def.noise) {
      const f = editor.addFolder('노이즈');
      f.add(def.noise, 'gain', 0, 1, 0.01).name('레이어 볼륨');
      f.add(def.noise, 'rate', 0.2, 3, 0.05).name('재생 속도');
      f.add(def.noise, 'attack', 0.0005, 0.4, 0.0005).name('어택 (s)');
      f.add(def.noise, 'hold', 0, 0.4, 0.005).name('홀드 (s)');
      f.add(def.noise, 'decay', 0.005, 1.2, 0.005).name('디케이 (s)');
      f.add(def.noise, 'curve', CURVES).name('디케이 곡선');
      addFilterRows(f, def.noise);
      rows.push(f);
    }
  }

  function addFilterRows(f, layer) {
    if (!layer.filter) return;
    const g = f.addFolder('필터');
    g.add(layer.filter, 'type', FILTERS).name('종류');
    g.add(layer.filter, 'freq', 40, 12000, 10).name('주파수 (Hz)');
    g.add(layer.filter, 'freqEnd', 40, 12000, 10).name('도착 주파수 (Hz)');
    g.add(layer.filter, 'q', 0.1, 18, 0.1).name('Q');
    addOptional(g, layer.filter, 'sweep', 0.005, 0.6, 0.005, '스윕 시간 (s)');
  }

  /** A row only if the definition actually carries that key. */
  function addOptional(f, obj, key, min, max, step, label) {
    if (obj[key] === undefined) return;
    f.add(obj, key, min, max, step).name(label);
  }

  buildRows();

  // ── the poll ─────────────────────────────────────────────────────────────
  function refresh() {
    const s = audio?.stats;
    if (!s) {
      stats.device = '— 오디오 없음';
      stats.voices = '—';
      stats.crush = '—';
    } else {
      // `running` and AUDIBLE are different questions — the output device can
      // take a second or more to open, and everything scheduled before it does
      // is discarded. See `Mixer.playing`.
      stats.device = !s.ready
        ? '⚠ 첫 제스처 대기 중'
        : !s.playing
          ? `${s.state} · ⚠ 출력 장치 여는 중${s.pending ? ` (대기: ${s.pending})` : ''}`
          : `${s.state} · ${Math.round(s.sampleRate / 100) / 10} kHz ✓`;
      stats.voices =
        `${s.voices}/${Math.round(config.maxVoices)} · 루프 ${s.loops} · ` +
        `누락 ${s.dropped} · 탈취 ${s.stolen}`;
      stats.crush = s.holdReady
        ? `✓ ${Math.round(config.crushBits)}bit / ${Math.round(config.crushRateHz / 100) / 10} kHz`
        : `${Math.round(config.crushBits)}bit · 샘플레이트 저하 없음${s.holdError ? ` (${s.holdError})` : ''}`;
    }
    deviceRow.updateDisplay();
    voiceRow.updateDisplay();
    crushRow.updateDisplay();
  }

  refresh();
  return { refresh, folder };
}

import GUI from 'lil-gui';
import { Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { FRAME } from '../core/frame.js';
import { STAGE } from './Transition.js';
import { CONFIG } from '../game/config.js';
import { onQualityChange, QUALITY, TIER_NAMES } from '../core/quality.js';
import { addAudioFolder } from '../audio/audioDebug.js';

/**
 * The panel, behind `?debug=1`.
 *
 * Everything it edits lives on `MENU_CONFIG`, so turning it off changes nothing
 * about how the menu behaves — the numbers are the same numbers, there is just
 * nothing on screen to drag them with. Same arrangement as the game's.
 *
 * ── the gap check is the one control here that is not a slider ──────────────
 * "완전 차폐 프레임 시각화 (빈틈 확인용)" cannot be answered by looking. The
 * covered window is a third of a second and a one-pixel wedge of background
 * along an edge is both entirely possible and easy to miss.
 *
 * It used to be measured, because the cover was a spinning cap and how far its
 * opaque disc reached past the frame's furthest corner was a real number that
 * could go negative. Two rectangles cannot: `Cinematic` anchors each bar to the
 * frame's own edge, grows it inward and overhangs it, so at `bars = 1` the two
 * meet in the middle and coverage is a fact about the arithmetic rather than a
 * measurement.
 *
 * What is left is the visual half, and the cap wipe brings back the reason it
 * was worth keeping. Two bars meeting in the middle cover the frame by
 * arithmetic; a spinning tilted disc covers it by a computation with a cosine
 * and a safety factor in it (`CapWipe.coverScale`), and a computation can be
 * wrong. The checkerboard sits behind the cap in its own overlay scene, so if
 * any of it is visible on a frame the readout calls covered, the cap is not
 * covering the screen.
 *
 * The readout beside it is `margin()` — how many frame pixels of the panel
 * stick out past the far corner. Negative is a gap, and it is the same
 * arithmetic the cover scale is built from, reported rather than trusted.
 */

const CHECKER_FRAG = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 c = floor(vUv * vec2(16.0, 12.0));
    float odd = mod(c.x + c.y, 2.0);
    gl_FragColor = vec4(mix(vec3(1.0, 0.0, 0.6), vec3(0.1, 1.0, 0.3), odd), 1.0);
  }
`;

const CHECKER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export function bootMenuDebug(ctx) {
  if (new URLSearchParams(location.search).get('debug') !== '1') {
    return { frame() {}, gui: null };
  }

  const { config, wipe, transition, retro, composer, viewport, overlay } = ctx;
  /** Frame counter for the audio readouts' slow poll. See the return below. */
  let audioTick = 0;
  const gui = new GUI({ title: 'MENU / 전환' });

  // ── readouts ─────────────────────────────────────────────────────────────
  const stats = { stage: '', cover: '' };
  const stageRow = gui.add(stats, 'stage').name('단계').disable();
  const coverRow = gui.add(stats, 'cover').name('레터박스').disable();

  // ── the gap check ────────────────────────────────────────────────────────
  const checker = new Mesh(
    new PlaneGeometry(FRAME.width, FRAME.height),
    new ShaderMaterial({
      vertexShader: CHECKER_VERT,
      fragmentShader: CHECKER_FRAG,
      depthTest: false,
      depthWrite: false,
    }),
  );
  // Behind the cap in its overlay, and only ever on when the check is on.
  checker.position.z = -5;
  checker.renderOrder = -1000;
  checker.visible = false;
  overlay.add(checker);

  let lastStage = STAGE.IDLE;

  // ── the transition ───────────────────────────────────────────────────────
  const run = gui.addFolder('전환 연출');
  const total = { seconds: '' };
  const totalRow = run.add(total, 'seconds').name('전체 길이').disable();
  const refreshTotal = () => {
    const s = transition.totalSeconds;
    total.seconds = `${s.toFixed(2)}s${s > 1 ? '  ⚠ 1초 초과' : ''}`;
    totalRow.updateDisplay();
  };
  refreshTotal();

  run.add(config.transition, 'barSeconds', 0.05, 1, 0.01).name('1 바 닫힘 (s)').onChange(refreshTotal);
  run.add(config.transition, 'popSeconds', 0.02, 0.6, 0.01).name('1 뚜껑 튀어오름 (s)');
  run.add(config.transition, 'coverSeconds', 0.016, 1.2, 0.008).name('2 차폐 (s)').onChange(refreshTotal);
  run.add({ play: () => ctx.onPlay() }, 'play').name('▶ 전환 강제 재생 (설정으로)');
  /**
   * The other half of that button, and the reason `Transition.skip` still
   * exists. The covered frame is three frames long — it is where the scene swap
   * happens and it is the one part of the run you cannot catch by looking. This
   * lands on its FIRST frame; see `Transition.skip` for why it lands there and
   * not at the end of the run.
   */
  run
    .add({ go: () => transition.skip() }, 'go')
    .name('▶ 커버로 건너뛰기');

  const checks = gui.addFolder('검증');
  const flags = { checker: false };
  // Only ever on while the cap is out. Left on permanently it would hide the
  // menu behind a checkerboard, which answers a question nobody asked.
  checks.add(flags, 'checker').name('차폐 검사 배경 (빈틈 = 체크무늬)');
  checks.add({ reset: () => (worstMargin = Infinity) }, 'reset').name('최저 여유 초기화');

  // ── menu items ───────────────────────────────────────────────────────────
  const menu = gui.addFolder('메뉴 항목');
  const relayout = () => ctx.onLayout();
  menu.add(config.items, 'columnX', -300, 300, 1).name('가로 위치 (px)').onChange(relayout);
  menu.add(config.items, 'columnY', -200, 200, 1).name('세로 위치 (px)').onChange(relayout);
  menu.add(config.items, 'pitch', 20, 80, 1).name('간격 (px)').onChange(relayout);
  menu.add(config.items, 'yaw', -30, 30, 1).name('패널 각도 (도)').onChange(relayout);
  menu.add(config.items, 'hoverShift', 0, 2, 0.01).name('호버 이동량');
  menu.add(config.camera, 'fov', 12, 60, 0.5).name('카메라 화각').onChange(relayout);
  menu.add(config.camera, 'distance', 20, 140, 0.5).name('카메라 거리').onChange(relayout);
  menu.add(config.camera, 'height', -10, 20, 0.1).name('카메라 높이').onChange(relayout);

  // ── bloom ────────────────────────────────────────────────────────────────
  // What replaced the PS1 folder. The chain is one pass now and these are its
  // only three dials — see `core/Composer.js`.
  const bloomCfg = config.view.bloom;
  /**
   * 그래픽 품질 티어. 경기 화면의 같은 컨트롤과 같은 것을 한다.
   *
   * 메뉴에도 있어야 하는 이유는 이 화면이 티어가 가장 많이 보이는 곳이기
   * 때문이다 — 유리, 원주 분할, 기포, 보케가 전부 여기 있고 경기 화면에는
   * 하나도 없다. `?debug=1` 뒤에 있다.
   */
  const quality = gui.addFolder('그래픽 품질');
  const qualityProxy = {
    get tier() {
      return TIER_NAMES[QUALITY.tier];
    },
    set tier(name) {
      const next = TIER_NAMES.indexOf(name);
      if (next >= 0) ctx.graphicsSettings?.setTier(next);
    },
  };
  const qualityStats = { resolved: '' };
  const qualityRow = quality.add(qualityProxy, 'tier', [...TIER_NAMES]).name('티어');
  // 마지막 칸의 이름이 '보케' 가 아니라 '구름' 인 것은 그 값이 지금 무엇을 세는지가
  // 바뀌었기 때문이다. 키 이름(`QUALITY.bokeh`)은 그대로다 — 이유는 `core/sky.js`.
  const qualityResolved = quality.add(qualityStats, 'resolved').name('구름').disable();
  if (!ctx.graphicsSettings) qualityRow.disable();
  function refreshQuality() {
    qualityStats.resolved =
      `${QUALITY.bokeh}장`;
    qualityRow.updateDisplay();
    qualityResolved.updateDisplay();
  }
  refreshQuality();
  onQualityChange(refreshQuality);

  const bloom = gui.addFolder('블룸');
  const applyBloom = () => composer?.configure(bloomCfg);
  bloom.add(bloomCfg, 'enabled').name('켜기').onChange(applyBloom);
  bloom.add(bloomCfg, 'threshold', 0, 1.5, 0.01).name('임계값').onChange(applyBloom);
  bloom.add(bloomCfg, 'strength', 0, 1.5, 0.01).name('세기').onChange(applyBloom);
  bloom.add(bloomCfg, 'radius', 0, 1.5, 0.01).name('반경').onChange(applyBloom);

  /** Called once a frame from the loop. */
  function frame(state) {
    // Only while the cap is on screen: at rest the overlay is empty and a
    // checkerboard behind nothing is a checkerboard over the whole menu.
    checker.visible = flags.checker && wipe.root.visible;

    if (state.stage !== lastStage) {
      lastStage = state.stage;
      stats.stage = state.stage;
      stageRow.updateDisplay();
    }

    const m = wipe.root.visible ? wipe.margin() : 0;
    stats.cover = wipe.root.visible
      ? `여백 ${m.toFixed(1)}px${m < 0 ? '  ⚠ 틈' : '  덮음'}`
      : '뚜껑 없음';
    coverRow.updateDisplay();
  }

  /**
   * ── 내 마크 ───────────────────────────────────────────────────────────────
   * Everything here edits `MENU_CONFIG.marks` or the book, so turning the panel
   * off changes nothing about how the editor behaves.
   *
   * The two structural ones are called out: canvas size and boundary change what
   * a mark IS, so they rebuild the editor's surface rather than being read on
   * the next stroke.
   */
  const marksFolder = gui.addFolder('내 마크');
  const mk = config.marks;

  const markStats = { slots: '', assigned: '' };
  const slotRow = marksFolder.add(markStats, 'slots').name('슬롯 상태').disable();
  const assignRow = marksFolder.add(markStats, 'assigned').name('P1 / P2 배정').disable();

  const refreshMarks = () => {
    const book = ctx.markBook;
    if (!book) return;
    const snap = book.snapshot();
    markStats.slots = snap.slots
      .map((v, i) => `${i + 1}${v ? '\u25cf' : '\u25cb'}`)
      .join('  ');
    const name = (r) => (r === null ? '없음' : r === 'default' ? '기본로고' : `슬롯${r + 1}`);
    markStats.assigned = `${name(snap.assigned[0])}  /  ${name(snap.assigned[1])}`;
    slotRow.updateDisplay();
    assignRow.updateDisplay();
  };
  refreshMarks();
  ctx.markBook?.onChange(refreshMarks);

  marksFolder
    .add(mk, 'canvasSize', [64, 96, 128, 160, 192, 256])
    .name('캔버스 해상도 (변경 시 재구성)')
    .onChange((v) => ctx.onCanvasSize?.(Number(v)));
  marksFolder
    .add(mk, 'boundary', 0.3, 1, 0.01)
    .name('원형 경계 반경 (비율)')
    .onChange((v) => ctx.onBoundary?.(v));
  marksFolder
    .add(mk, 'historyLimit', 4, 60, 1)
    .name('되돌리기 이력 단계 수');
  marksFolder.add(mk, 'rotateRadiansPerPixel', 0.002, 0.05, 0.001).name('보기 회전 감도');
  marksFolder.add(mk, 'flingScale', 0, 2, 0.05).name('관성 세기');
  marksFolder.add(mk, 'spinDamping', 0.8, 0.995, 0.001).name('관성 감쇠');

  const brush = marksFolder.addFolder('브러시 크기 (텍셀)');
  for (let i = 0; i < 3; i++) {
    brush
      .add({ get [`b${i + 1}`]() { return ctx.brushSizes?.[i] ?? 0; },
             set [`b${i + 1}`](v) { if (ctx.brushSizes) ctx.brushSizes[i] = Math.max(1, Math.round(v)); } },
        `b${i + 1}`, 1, 32, 1)
      .name(`${i + 1}단계`);
  }

  /**
   * The palette, editable in place.
   *
   * `lil-gui`'s colour control writes a `#rrggbb` string straight back into the
   * array the editor reads, so a swatch changes the moment it is dragged — which
   * is the whole point of putting it here rather than in a constant.
   */
  const paletteFolder = marksFolder.addFolder('팔레트');
  if (ctx.palette) {
    for (let i = 0; i < ctx.palette.length; i++) {
      paletteFolder
        .addColor(ctx.palette, i)
        .name(`${i + 1}`)
        .onChange(() => ctx.onPalette?.());
    }
  }

  const markTools = marksFolder.addFolder('도구');
  markTools
    .add({ go: () => ctx.onPreviewMark?.() }, 'go')
    .name('\u25b6 마크 텍스처 미리보기');
  markTools
    .add({
      go: () => {
        // The one destructive control in the panel, and the brief asks for it.
        // Confirmed in the browser rather than in the scene: this is the tuning
        // panel, not the game, and it is already a DOM surface.
        if (!window.confirm('저장된 마크를 전부 지웁니다. 계속할까요?')) return;
        ctx.markBook?.reset();
        refreshMarks();
      },
    }, 'go')
    .name('\u21ba localStorage 강제 초기화');

  /**
   * ── 사운드 ────────────────────────────────────────────────────────────────
   * The same folder the game page's panel builds, from the same file. The menu
   * owns four sound-producing things the match page has never heard of — the
   * bottle being worked up, the transition, the mark editor's brush and every
   * one of the confirm dialogs — and they are tuned by these very sliders, so the
   * folder belongs on both panels or on neither.
   */
  const audioPanel = ctx.audio
    ? addAudioFolder(gui, {
        audio: ctx.audio,
        config: CONFIG.audio,
        settings: ctx.audioSettings,
      })
    : null;

  return {
    gui,
    frame: (state) => {
      frame(state);
      // MenuDebug has no slow poll of its own, so the audio readouts are ticked
      // from the per-frame hook at a fraction of its rate. Voice counts move on
      // a turn boundary, not on a frame, and rebuilding three strings sixty
      // times a second to show a number that changed twice would be the panel
      // costing more than the thing it is measuring.
      audioTick = (audioTick + 1) % 24;
      if (audioTick === 0) audioPanel?.refresh();
    },
  };
}

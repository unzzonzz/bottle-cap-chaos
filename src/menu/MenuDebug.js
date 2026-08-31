import GUI from 'lil-gui';
import { Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { WIPE_FRAME } from './CapWipe.js';
import { STAGE } from './Transition.js';
import { CONFIG } from '../game/config.js';
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
 * covered window is three frames long, the cap is spinning through it, and a
 * one-pixel wedge of background at a corner for two frames is both entirely
 * possible and completely invisible at speed.
 *
 * So it is measured instead. `CapWipe.margin()` is how far the panel's opaque
 * disc reaches past the frame's furthest corner, in frame pixels, computed from
 * the panel radius measured off the geometry the mesh is drawing. The readout
 * shows it live and remembers the WORST value seen during the last covered
 * window; anything at or below zero is a gap and is reported as one. The
 * checkerboard behind the overlay is the visual half of the same thing — if any
 * of it is ever visible during stage 3, the cap did not cover the screen.
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

  const { config, bottle, wipe, transition, retro, composer, viewport, overlay } = ctx;
  /** Frame counter for the audio readouts' slow poll. See the return below. */
  let audioTick = 0;
  const gui = new GUI({ title: 'MENU / 병 + 전환' });

  // ── readouts ─────────────────────────────────────────────────────────────
  const stats = { tris: '', stage: '', cover: '' };
  const triRow = gui.add(stats, 'tris').name('삼각형').disable();
  const stageRow = gui.add(stats, 'stage').name('단계').disable();
  const coverRow = gui.add(stats, 'cover').name('차폐 여유 (px)').disable();

  /** The bottle's own budget from the brief. The cap is measured separately. */
  const BUDGET = [1200, 2000];
  const refreshTris = () => {
    const t = bottle.triangles;
    const glass = t.glass;
    const flag = glass < BUDGET[0] ? '  ↓적음' : glass > BUDGET[1] ? '  ⚠ OVER' : '';
    stats.tris = `유리 ${glass}${flag} · 액체 ${t.liquid} · 라벨 ${t.label} · 뚜껑 ${t.cap}`;
    triRow.updateDisplay();
  };

  const rebuild = () => {
    ctx.onRebuild();
    refreshTris();
  };
  refreshTris();

  // ── the gap check ────────────────────────────────────────────────────────
  const checker = new Mesh(
    new PlaneGeometry(WIPE_FRAME.width, WIPE_FRAME.height),
    new ShaderMaterial({
      vertexShader: CHECKER_VERT,
      fragmentShader: CHECKER_FRAG,
      depthTest: false,
      depthWrite: false,
    }),
  );
  // Behind the cap in the overlay, and only ever on when the check is on.
  checker.position.z = -500;
  checker.renderOrder = -1000;
  checker.visible = false;
  overlay.add(checker);

  let worstMargin = Infinity;
  let lastStage = STAGE.IDLE;

  // ── the bottle's profile ─────────────────────────────────────────────────
  const p = config.bottle.profile;
  const shape = gui.addFolder('병 실루엣');
  shape.add(p, 'bodyRadius', 20, 42, 0.1).name('몸통 반지름 (mm)').onChange(rebuild);
  shape.add(p, 'waistRatio', 0.7, 1, 0.005).name('허리 잘록함 (몸통 대비)').onChange(rebuild);
  shape.add(p, 'waistY', 40, 110, 1).name('허리 높이 (mm)').onChange(rebuild);
  shape.add(p, 'lowerRadius', 18, 36, 0.1).name('하단 몸통 반지름 (mm)').onChange(rebuild);
  shape.add(p, 'baseRadius', 16, 34, 0.1).name('바닥 반지름 (mm)').onChange(rebuild);
  shape.add(p, 'shoulderHeight', 12, 60, 0.5).name('어깨 높이 (mm)').onChange(rebuild);
  shape.add(p, 'shoulderCurve', 0, 1, 0.01).name('어깨 곡률').onChange(rebuild);
  shape.add(p, 'neckLength', 4, 40, 0.5).name('목 길이 (mm)').onChange(rebuild);
  shape.add(p, 'neckRadius', 8, 20, 0.1).name('목 반지름 (mm)').onChange(rebuild);
  shape.add(p, 'neckFlare', 0, 5, 0.05).name('목 하단 벌어짐 (mm)').onChange(rebuild);
  shape.add(p, 'bodyRows', 5, 20, 1).name('몸통 세로 세그먼트').onChange(rebuild);
  shape.add(p, 'shoulderRows', 3, 12, 1).name('어깨 세로 세그먼트').onChange(rebuild);

  const rib = gui.addFolder('세로 리브');
  rib.add(p, 'ribs', 4, 24, 1).name('리브 개수 (뚜껑 돌기와 별개)').onChange(rebuild);
  rib.add(p, 'ribDepth', 0, 2, 0.01).name('리브 깊이 (mm)').onChange(rebuild);
  rib.add(p, 'ribFrom', 0, 120, 1).name('리브 시작 높이 (mm)').onChange(rebuild);
  rib.add(p, 'ribTo', 40, 190, 1).name('리브 끝 높이 (mm)').onChange(rebuild);
  rib.add(p, 'ribFade', 0.5, 20, 0.5).name('리브 페이드 (mm)').onChange(rebuild);
  rib.add(p, 'radialPerRib', 2, 6, 1).name('리브당 세로줄').onChange(rebuild);

  const label = gui.addFolder('라벨 / 내용물');
  label.add(p, 'labelFrom', 40, 160, 1).name('라벨 하단 (mm)').onChange(rebuild);
  label.add(p, 'labelTo', 50, 175, 1).name('라벨 상단 (mm)').onChange(rebuild);
  label.add(p, 'labelPanels', 1, 4, 1).name('라벨 반복 횟수').onChange(rebuild);
  label.add(p, 'fillLevel', 40, 180, 1).name('음료 수위 (mm)').onChange(rebuild);
  label.add(p, 'liquidInset', 0.6, 0.99, 0.01).name('음료 반지름 비율').onChange(rebuild);

  // ── pose and motion ──────────────────────────────────────────────────────
  const pose = gui.addFolder('자세 / 부유');
  const relean = () => ctx.onLean();
  pose.add(config.bottle, 'leanZ', -40, 40, 0.5).name('기울기 (도)').onChange(relean);
  pose.add(config.bottle, 'leanX', -25, 25, 0.5).name('앞뒤 기울기 (도)').onChange(relean);
  pose.add(config.bottle, 'faceYaw', -180, 180, 1).name('라벨 방향 (도)').onChange(relean);
  pose.add(config.bottle, 'floatAmplitude', 0, 2, 0.01).name('부유 진폭');
  pose.add(config.bottle, 'floatSpeed', 0.1, 4, 0.01).name('부유 주기 (rad/s)');
  pose.add(config.bottle, 'originX', -16, 16, 0.1).name('가로 위치');
  pose.add(config.bottle, 'originY', -8, 8, 0.1).name('세로 위치');
  pose.add(config.bottle, 'shadowScale', 0, 6, 0.05).name('그림자 크기');

  const shake = gui.addFolder('단계 1 — 흔들림');
  shake.add(config.bottle, 'shakeFrequency', 2, 40, 0.5).name('흔들림 주파수 (Hz)');
  shake.add(config.bottle, 'shakeAmplitude', 0, 2, 0.01).name('흔들림 진폭');
  shake.add(config.bottle, 'shakeCurve', 0.2, 4, 0.05).name('진폭 커브 (지수)');
  shake.add(config.camera, 'shakeStrength', 0, 1, 0.01).name('카메라 흔들림 강도');
  shake.add(config.camera, 'shakeFrequency', 2, 40, 0.5).name('카메라 흔들림 주파수');
  shake.add(config.bottle, 'aimLeanZ', -50, 50, 0.5).name('조준 기울기 (도)').onChange(() => ctx.onLean());
  shake.add(config.bottle, 'aimPitch', -10, 85, 0.5).name('조준 피치 — 카메라 향함 (도)').onChange(() => ctx.onLean());
  shake.add(config.bottle, 'aimRiseSeconds', 0.05, 1.5, 0.01).name('조준에 걸리는 시간 (s)');
  shake.add(config.bottle, 'aimFallSeconds', 0.1, 3, 0.05).name('원위치까지 시간 (s)');

  // ── the carbonation ──────────────────────────────────────────────────────
  const fizz = gui.addFolder('탄산 / 거품');
  fizz.add(config.bottle, 'nucleationSites', 1, 24, 1).name('기포 생성점 개수').onChange(rebuild);
  fizz.add(config.bottle, 'bubbleRadius', 0.02, 0.3, 0.005).name('기포 초기 반지름').onChange(rebuild);
  fizz.add(config.bottle, 'bubbleGrowth', 0, 4, 0.05).name('상승 중 성장률').onChange(rebuild);
  fizz.add(config.bottle, 'riseCoefficient', 50, 900, 5).name('부력 계수 K (v = K r²)').onChange(rebuild);
  fizz.add(config.bottle, 'bubbleWobble', 0, 2, 0.01).name('나선 흔들림');
  fizz.add(config.bottle, 'fizzStrength', 0, 2, 0.01).name('기포 밝기');
  fizz.add(config.bottle, 'foamCeiling', 100, 196, 1).name('거품 최고 높이 (mm)');
  fizz.add(config.bottle, 'foamProduction', 0, 600, 5).name('거품 생성량 (부피/s)');
  fizz.add(config.bottle, 'foamDrain', 0, 200, 1).name('거품 배수량 (부피/s)');
  fizz.add(config.bottle, 'foamPopSurge', 0, 3000, 10).name('개봉 순간 분출량');
  fizz.add(config.bottle, 'foamPopSeconds', 0.02, 0.8, 0.01).name('분출 지속 (s)');
  fizz.add(config.bottle, 'foamScrollSpeed', 0, 4, 0.05).name('거품 요동 속도');
  fizz.add(config.bottle, 'sloshDrive', 0, 900, 5).name('출렁임 구동력');
  fizz.add(config.bottle, 'strokeFrequency', 0.5, 15, 0.1).name('팔 스트로크 (Hz, 공진 ~4)');
  fizz.add(config.bottle, 'sloshDamping', 0.01, 0.6, 0.005).name('출렁임 감쇠비');
  fizz.add(config.bottle, 'sloshLimit', 0, 2, 0.01).name('출렁임 최대 진폭');

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

  run.add(config.transition, 'shakeSeconds', 0, 1, 0.01).name('1 흔들림 (s)').onChange(refreshTotal);
  run.add(config.transition, 'launchSeconds', 0.05, 1, 0.01).name('2 발사 (s)').onChange(refreshTotal);
  run.add(config.transition, 'coverSeconds', 0.016, 1.2, 0.008).name('3 차폐 — 로고 노출 (s)').onChange(refreshTotal);
  run.add(config.transition, 'exitSeconds', 0.05, 1, 0.01).name('4 빠져나가기 (s)').onChange(refreshTotal);
  run.add(config.wipe, 'spinSpeed', 0, 6, 0.05).name('뚜껑 회전 속도 (rev/s)');
  run.add(config.wipe, 'axisTilt', 0, 45, 0.5).name('회전축 기울기 (도)');
  run.add(config.wipe, 'startScale', 0.005, 0.4, 0.005).name('시작 스케일 비율');
  run.add(config.wipe, 'coverSafety', 1, 1.6, 0.01).name('차폐 여유 배수');
  run.add(config.wipe, 'exitGrowth', 1, 2.5, 0.01).name('빠질 때 확대율');
  run.add(config.wipe, 'exitTravel', 400, 2500, 10).name('빠질 때 이동 거리 (px)');
  run.add(config.bottle, 'burstSeconds', 0, 0.5, 0.01).name('분출 지속 (s)');
  run.add(config.bottle, 'burstSize', 0, 20, 0.1).name('분출 크기');
  run.add({ play: () => ctx.onPlay() }, 'play').name('▶ 전환 강제 재생 (설정으로)');

  const checks = gui.addFolder('검증');
  const flags = { checker: false, wireframe: false };
  // Only ever on while the cap is out. Left on permanently it would hide the
  // menu behind a checkerboard, which answers a question nobody asked.
  checks.add(flags, 'checker').name('차폐 검사 배경 (빈틈 = 체크무늬)');
  checks
    .add(flags, 'wireframe')
    .name('병 와이어프레임')
    .onChange((v) => bottle.setWireframe(v));
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
  const bloom = gui.addFolder('블룸');
  const applyBloom = () => composer?.configure(bloomCfg);
  bloom.add(bloomCfg, 'enabled').name('켜기').onChange(applyBloom);
  bloom.add(bloomCfg, 'threshold', 0, 1.5, 0.01).name('임계값').onChange(applyBloom);
  bloom.add(bloomCfg, 'strength', 0, 1.5, 0.01).name('세기').onChange(applyBloom);
  bloom.add(bloomCfg, 'radius', 0, 1.5, 0.01).name('반경').onChange(applyBloom);

  const glass = gui.addFolder('유리 재질');
  const gm = bottle.glassFrontMaterial.uniforms;
  const gb = bottle.glassBackMaterial.uniforms;
  const pair = (key, min, max, step, name) =>
    glass
      .add({ v: gm[key].value }, 'v', min, max, step)
      .name(name)
      .onChange((v) => {
        gm[key].value = v;
        gb[key].value = key === 'uBaseAlpha' ? v * 0.72 : v;
      });
  pair('uBaseAlpha', 0, 1, 0.01, '기본 불투명도');
  pair('uRimAlpha', 0, 1, 0.01, '가장자리 불투명도');
  pair('uRimDark', 0, 1, 0.01, '가장자리 어두워짐');
  pair('uRimPower', 0.5, 6, 0.05, '가장자리 폭');
  pair('uHighlight', 0, 2, 0.01, '하이라이트 세기');

  /** Called once a frame from the loop. */
  function frame(state) {
    checker.visible = flags.checker && wipe.root.visible;

    if (state.stage !== lastStage) {
      lastStage = state.stage;
      stats.stage = state.stage;
      stageRow.updateDisplay();
      if (state.stage === STAGE.LAUNCH) worstMargin = Infinity;
    }

    // Sampled only while the frame is meant to be opaque. Outside stage 3 the
    // margin is negative by design and averaging that in would make the worst
    // case meaningless.
    if (state.stage === STAGE.COVER) {
      const m = wipe.margin();
      if (m < worstMargin) worstMargin = m;
    }

    const now = wipe.root.visible ? wipe.margin() : NaN;
    const worst = Number.isFinite(worstMargin) ? worstMargin : null;
    stats.cover =
      `현재 ${Number.isFinite(now) ? now.toFixed(0) : '—'}` +
      (worst === null
        ? '  · 차폐 최저 —'
        : `  · 차폐 최저 ${worst.toFixed(0)}${worst <= 0 ? '  ⚠ 빈틈' : '  OK'}`);
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
   * bottle being worked up, the cap wipe, the mark editor's brush and every one
   * of the confirm dialogs — and they are tuned by these very sliders, so the
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

import GUI from 'lil-gui';
import { PS1_COLOR_LEVELS } from '../core/RetroPass.js';
import { RENDER_MODES } from '../core/Viewport.js';
import { describeCapColliders, nestingClearance } from '../physics/capCollider.js';
import { resetConfig } from '../game/config.js';
import { MODES, MODE_KEYS } from '../game/modes.js';
import { FORMATION_KEYS } from '../game/layout/formations.js';
import { RATIO } from '../game/layout/pitchMetrics.js';
import { FRAME as CARD_FRAME } from '../render/CardLayer.js';
import { clearFxTextureCache } from '../render/fxTextures.js';
// Both used by the orb-weight folder below and both previously missing, which
// made `?debug=1` throw a ReferenceError partway through building the panel —
// so every folder after the weights, this file's own victory section included,
// was unreachable. Nothing about the panel's behaviour changes; it now gets as
// far as the end.
import { DRAWABLE } from '../game/cards/CardHands.js';
import { CARD_BY_ID } from '../game/cards/cardCatalog.js';

/** The card scene's layout box is a fixed width whatever the target is. */
const CARD_FRAME_WIDTH = CARD_FRAME.width;

/**
 * The panel. This phase IS this panel — the brief is "find out whether the core
 * feels good", and that is done by dragging these while playing, not by reading
 * the numbers off a page.
 *
 * Two kinds of control, kept visually apart because they behave differently:
 *
 *   LIVE — friction, damping, impulse, thresholds, timeouts. Read on the step
 *     they are used, so a slider moved mid-slide changes that slide.
 *   STRUCTURAL — collider shape, mass split, board size, cap count. These change
 *     what a cap IS, so they tear the world down and build it again. Marked with
 *     a rebuild note, because losing a match halfway through to a stray drag is
 *     otherwise a mystery.
 *
 * The two readouts at the top are the ones worth watching. NESTING CLEARANCE is
 * the collider design's single load-bearing invariant: lid narrower than mouth,
 * or no cap will ever go inside another and the compound has silently become the
 * convex hull it exists to avoid. PREVIEW is what the trajectory line costs, so
 * winding the preview length up has a visible price.
 */

export function bootPhysicsDebug({
  match,
  view,
  camera,
  router,
  retro,
  retroPass,
  viewport,
  config,
  preview,
  cards,
  cardFx,
  hud,
  victory,
  onRebuild,
  onModeChange,
}) {
  const gui = new GUI({ title: 'BOTTLE CAP CHAOS — 물리 코어' });

  // ── mode ─────────────────────────────────────────────────────────────────
  // First, because it decides which half of this panel is meaningful. A mode
  // is a layout plus a rule set, so switching it is a structural change to the
  // world and takes the same rebuild path a board resize does.
  const modeNames = Object.fromEntries(MODE_KEYS.map((k) => [MODES[k].name, k]));
  gui
    .add(config, 'mode', modeNames)
    .name('모드')
    .onChange(() => {
      onModeChange();
      syncMode();
      refresh();
    });

  // ── readouts ─────────────────────────────────────────────────────────────
  const stats = { nesting: '', cost: '', hash: '', pitch: '', cam: '', hold: '' };
  const nestingRow = gui.add(stats, 'nesting').name('겹침 여유 (mouth-lid)').disable();
  const costRow = gui.add(stats, 'cost').name('프리뷰 / 삼각형').disable();
  const hashRow = gui.add(stats, 'hash').name('턴 종료 해시').disable();
  // The completion criterion, as a readout. Measured off the built pitch rather
  // than off the config, so it is checking the geometry that exists and not the
  // arithmetic that was supposed to produce it.
  const pitchRow = gui.add(stats, 'pitch').name('필드 비율 (105:68)').disable();
  // Live, not polled with the rest: the camera moves under the hand and a
  // readout that lagged by 400 ms would be useless for the one thing it is for
  // — seeing which mode a press is about to take, and why.
  const camRow = gui.add(stats, 'cam').name('카메라 (줌/각/팬/모드)').disable();
  // Ticked with the camera rather than with the slow readouts: the hold is under
  // a second and a 400 ms poll would show it once, if at all.
  const holdRow = gui.add(stats, 'hold').name('골 딜레이 상태').disable();

  const refresh = () => {
    const desc = describeCapColliders(
      { radius: match.arena.desc.radius, height: match.arena.desc.height },
      config.collider,
    );
    const clear = nestingClearance(desc);
    stats.nesting = `${clear.toFixed(3)}  ${clear > 0.02 ? '✓ 포개짐 가능' : '⚠ 뚜껑이 막힘'}`;
    stats.cost = `${preview.cost.toFixed(1)} ms  ·  ${view.triangles} tri/cap`;
    stats.hash = match.endHash
      ? `${match.endHash}  (${match.lastVerdict?.steps ?? 0} steps)`
      : '—';

    // Football's ratio check, and only football's. The curling lane also carries
    // a `metrics` with a length and a width, and its ratio is a PARAMETER rather
    // than the Laws' constant — reading it here would print a permanent ⚠ next
    // to a number that is exactly what it is supposed to be. Curling has its own
    // readout in its own folder.
    const m = config.mode === 'football' ? match.arena.layout.metrics : null;
    if (m) {
      const r = m.width / m.length;
      stats.pitch = `${m.length.toFixed(1)} x ${m.width.toFixed(1)}  ·  ${r.toFixed(
        6,
      )}  ${Math.abs(r - RATIO) < 1e-9 ? '✓' : '⚠'}  ·  공 ⌀${(
        match.arena.ballRadius * 2
      ).toFixed(2)}`;
    } else {
      stats.pitch = '—';
    }

    nestingRow.updateDisplay();
    costRow.updateDisplay();
    hashRow.updateDisplay();
    pitchRow.updateDisplay();
    refreshCamera();
    // Which cards are live changes on turn boundaries, which is exactly the beat
    // this slow poll is for.
    refreshCards();
    refreshHands();
    refreshCurling();
  };

  /** The camera's whole state in one line. Ticked every frame from the loop. */
  const refreshCamera = () => {
    const deg = ((camera.azimuth * 180) / Math.PI).toFixed(1);
    const lim = camera.panLimits();
    stats.cam =
      `z${camera.zoom.toFixed(2)}${camera.atMinZoom ? '·min' : ''}  ` +
      `${deg}°  ` +
      `pan ${camera.pan.x.toFixed(1)},${camera.pan.z.toFixed(1)} ` +
      `/${lim.x.toFixed(0)},${lim.z.toFixed(0)}  ` +
      `${router ? router.modeLabel : '—'}`;
    camRow.updateDisplay();

    const holding = match.state === 'goalHold';
    stats.hold = holding
      ? `⚽ 정지 중  ${(match.goalHoldProgress * 100).toFixed(0)}%  ` +
        `(${config.football.goalHoldMode === 'ballStop' ? 'A 공 정지' : 'B 턴 종료'})`
      : match.goalPending
        ? '⚽ 골 확정 — 턴 진행 중'
        : '—';
    holdRow.updateDisplay();

    // Ticked with the camera and not with the slow poll, for the same reason
    // the goal hold is: the whole sequence is under two seconds and a 400 ms
    // poll would show three of its five stages, if that.
    refreshVictory();
  };

  const rebuild = () => {
    onRebuild();
    refresh();
  };
  const retune = () => match.arena.applyMaterialTuning();

  // ── determinism ──────────────────────────────────────────────────────────
  const det = gui.addFolder('결정론 검증');
  det.add(config.shot, 'lockSeed').name('시드 고정');
  det.add(config.shot, 'lockedSeed', 0, 0xffffff, 1).name('고정 시드값');
  det
    .add(
      {
        replay: () => {
          if (!match.replayLastTurn()) window.alert('아직 발사 기록이 없다.');
        },
      },
      'replay',
    )
    // The completion criterion, as a button. Rewinds to the snapshot the last
    // turn started from, fires the identical shot record, and compares the
    // end-state hash and step count. The verdict lands in the HUD banner.
    .name('▶ 같은 시드로 재발사 (검증)');
  det.open();

  // ── physics ──────────────────────────────────────────────────────────────
  const phys = gui.addFolder('물리');
  phys.add(config.collider, 'friction', 0, 1.5, 0.01).name('뚜껑 마찰').onChange(retune);
  phys.add(config.collider, 'restitution', 0, 1, 0.01).name('뚜껑 반발계수').onChange(retune);
  phys.add(config.arena, 'boardFriction', 0, 1.5, 0.01).name('보드 마찰').onChange(retune);
  phys.add(config.arena, 'boardRestitution', 0, 1, 0.01).name('보드 반발계수').onChange(retune);
  phys.add(config.physics, 'linearDamping', 0, 4, 0.01).name('선형 damping').onChange(retune);
  phys.add(config.physics, 'angularDamping', 0, 4, 0.01).name('각 damping').onChange(retune);
  phys.add(config.shot, 'maxImpulse', 50, 2000, 5).name('최대 임펄스');

  // ── the bow ──────────────────────────────────────────────────────────────
  const bow = gui.addFolder('당김 (발사 입력)');
  bow.add(config.shot, 'maxPullDistance', 2, 30, 0.5).name('최대 당김 거리');
  bow.add(config.shot, 'deadzone', 0, 6, 0.1).name('최소 임계 거리');
  bow
    .add(config.shot, 'pullCurve', ['linear', 'easeIn', 'easeOut'])
    .name('당김→세기 커브');
  // Nothing here for a strike height: the impulse goes through the centre of
  // mass, so there is no such axis to tune.
  bow.open();

  // ── collider ─────────────────────────────────────────────────────────────
  const col = gui.addFolder('콜라이더 (변경 시 재구성)');
  // 8-12 as specified. Never 21: the visual flute count and the collider
  // segment count are independent numbers and matching them explodes the
  // contact pairs for no gain in shape.
  col.add(config.collider, 'skirtSegments', 6, 16, 1).name('skirt 세그먼트').onChange(rebuild);
  col.add(config.collider, 'skirtThickness', 0.02, 0.4, 0.005).name('skirt 두께').onChange(rebuild);
  col.add(config.collider, 'topThickness', 0.02, 0.3, 0.005).name('상판 두께').onChange(rebuild);
  col
    .add(config.collider, 'topRadiusScale', 0.4, 1, 0.005)
    .name('상판 반경 비율')
    .onChange(rebuild);
  col.add(config.collider, 'massGrams', 0.5, 12, 0.05).name('질량 (g)').onChange(rebuild);
  // The skirt/lid mass split used to be a slider here. It is a constant in
  // capCollider.js now — where the centre of mass sits is a property of the
  // object, not a dial, and every tuned number on this panel was only correct
  // for whatever the dial happened to be on.
  col.add(config.view, 'colliders').name('콜라이더 와이어프레임');

  // ── spread ───────────────────────────────────────────────────────────────
  const err = gui.addFolder('오차');
  err.add(config.shot, 'maxSpreadDeg', 0, 25, 0.1).name('최대 오차각 (°)');
  err.add(config.shot, 'spreadCurve', 0.3, 4, 0.05).name('당김-오차 계수');
  err.add(config.preview, 'enabled').name('궤적 프리뷰');
  err.add(config.preview, 'seconds', 0.2, 3, 0.1).name('프리뷰 길이 (s)');
  err.add(config.preview, 'sampleEvery', 1, 12, 1).name('프리뷰 샘플 간격');
  // The preview is stepped a slice at a time so charging does not drop frames.
  // This is the size of the slice — the readout above shows what it costs.
  err.add(config.preview, 'stepBudget', 2, 120, 1).name('프리뷰 프레임당 스텝');

  // ── the ball ─────────────────────────────────────────────────────────────
  // Size and mass rebuild — they change what the object IS. Surface and damping
  // are live, so a ball can be made slipperier while it is rolling.
  const ball = gui.addFolder('공 (크기·질량 변경 시 재구성)');
  ball
    .add(config.ball, 'diameterScale', 0.3, 0.7, 0.01)
    .name('지름 (뚜껑 대비)')
    .onChange(rebuild);
  ball.add(config.ball, 'massGrams', 0.15, 3, 0.05).name('질량 (g)').onChange(rebuild);
  ball.add(config.ball, 'friction', 0, 1.2, 0.01).name('공 마찰').onChange(retune);
  ball.add(config.ball, 'restitution', 0, 1, 0.01).name('공 반발계수').onChange(retune);
  // Rolling resistance, and the reason turns end. A sphere is not stopped by
  // friction; drag these to zero and a struck ball runs to the 8 s timeout every
  // time. See the note in config.js.
  ball.add(config.ball, 'linearDamping', 0, 3, 0.01).name('공 선형 damping').onChange(retune);
  ball.add(config.ball, 'angularDamping', 0, 8, 0.05).name('공 각 damping').onChange(retune);

  // ── turn end ─────────────────────────────────────────────────────────────
  const turn = gui.addFolder('턴 종료');
  const capRestRows = [
    turn.add(config.turn.rest.cap, 'linear', 0.05, 6, 0.05).name('뚜껑 정지 임계 (선속도)'),
    turn.add(config.turn.rest.cap, 'angular', 0.05, 6, 0.05).name('뚜껑 정지 임계 (각속도)'),
  ];
  // Separate from the caps', and much looser on the angular axis. A sphere of
  // radius 0.7 rolling at the caps' 0.9 cm/s is turning at 1.25 rad/s — twice
  // their angular threshold — so one pair for both would hold every turn open
  // on a ball that has visibly stopped. Drag these down toward the caps' to
  // watch turn length climb with nothing changing on screen.
  const ballRestRows = [
    turn.add(config.turn.rest.ball, 'linear', 0.05, 10, 0.05).name('공 정지 임계 (선속도)'),
    turn.add(config.turn.rest.ball, 'angular', 0.05, 14, 0.1).name('공 정지 임계 (각속도)'),
  ];
  const quietRow = turn
    .add(config.turn, 'quietSteps', 5, 120, 1)
    .name('정지 유지 스텝')
    .onChange(() => {
      quietRow.name(`정지 유지 스텝 (${(config.turn.quietSteps / 120).toFixed(2)}s)`);
    });
  quietRow.name(`정지 유지 스텝 (${(config.turn.quietSteps / 120).toFixed(2)}s)`);
  /**
   * The rows curling replaces with its own. Hidden in that mode.
   *
   * Not disabled and not left on screen: `Arena.turnConfig` overlays the lane's
   * values on top of these, so in curling every one of them is being read past.
   * A slider that visibly does nothing is worse than an absent one, and this is
   * the exact folder someone opens when a turn will not end.
   */
  const sharedTurnRows = [
    ...capRestRows,
    quietRow,
    turn.add(config.turn, 'rampStartSec', 0.5, 7.5, 0.1).name('damping 램프 시작 (s)'),
    turn.add(config.turn, 'rampCurve', 0.3, 5, 0.05).name('램프 커브'),
    turn.add(config.turn, 'rampMaxDamping', 0, 30, 0.1).name('램프 최대 damping'),
    turn.add(config.turn, 'hardTimeoutSec', 1, 20, 0.1).name('하드 타임아웃 (s)'),
  ];
  turn.open();

  // ── arena ────────────────────────────────────────────────────────────────
  const board = gui.addFolder('보드 (변경 시 재구성)');
  board.add(config.arena, 'boardHalf', 8, 40, 0.5).name('보드 반폭').onChange(rebuild);
  // Drag toward zero to watch caps resting on the lip get pinned by the board's
  // own side face and thrown backward — the sharp-edge contact artifact this
  // fillet exists to remove. Measured: 8 of 12 edge shots fail at 0.001, none at
  // 0.15. See the note in Arena.
  board
    .add(config.arena, 'boardEdgeRadius', 0.001, 0.4, 0.001)
    .name('보드 모서리 반경')
    .onChange(rebuild);
  board.add(config.arena, 'capsPerPlayer', 1, 6, 1).name('플레이어당 뚜껑').onChange(rebuild);
  board.add(config.arena, 'rowZ', 3, 30, 0.5).name('시작 줄 거리').onChange(rebuild);
  board.add(config.arena, 'rowSpacing', 3.4, 14, 0.2).name('뚜껑 간격').onChange(rebuild);

  // ── pitch ────────────────────────────────────────────────────────────────
  // There is one size control and it is the LENGTH. Width, penalty area, goal
  // and centre circle are all fixed fractions of it — a width slider would be
  // the fastest way to break 105:68, so there isn't one. The readout at the top
  // of the panel is what checks that.
  /** Rows that only mean anything in a mode with a ball to put back. */
  const respawnRows = [];
  const pitch = gui.addFolder('축구장 (변경 시 재구성)');
  pitch.add(config.football, 'pitchLength', 40, 160, 1).name('필드 길이').onChange(rebuild);
  // The only dimension here that is not the Laws'. 1 is the real goal and is
  // measurably too hard; the note in config.js has the numbers.
  pitch.add(config.football, 'goalScale', 1, 2, 0.05).name('골대 크기 (실물 배수)').onChange(rebuild);
  pitch
    .add(config.football, 'formation', FORMATION_KEYS)
    .name('초기 배치 프리셋')
    .onChange(rebuild);
  pitch.add(config.football, 'winningGoals', 1, 10, 1).name('승리 골 수');
  // 0 is the old behaviour exactly: no hold, the reset fires the instant the
  // turn ends and the goal is gone before it registers.
  pitch.add(config.football, 'goalHoldSeconds', 0, 3, 0.05).name('골 정지 딜레이 (s)');
  // Which one feels right is a question about playing it. `ballStop` overlaps
  // the tail of the turn — the caps are still settling during the hold — while
  // `turnEnd` waits for a completely still screen and then adds the pause.
  pitch
    .add(config.football, 'goalHoldMode', {
      'B: 턴 종료 후': 'turnEnd',
      'A: 공 정지 직후': 'ballStop',
    })
    .name('딜레이 시작 시점');
  // Too bouncy and every clearance ricochets twice more; too dead and the ball
  // stops against the fence and the game is played in the corners.
  pitch.add(config.football, 'wallRestitution', 0, 1, 0.01).name('벽 반발계수').onChange(retune);
  pitch.add(config.football, 'wallFriction', 0, 1.2, 0.01).name('벽 마찰').onChange(retune);
  pitch.add(config.football, 'netFriction', 0, 1.5, 0.01).name('골망 마찰').onChange(retune);
  pitch.add(config.football, 'pitchFriction', 0, 1.5, 0.01).name('잔디 마찰').onChange(retune);
  pitch
    .add(config.football, 'pitchRestitution', 0, 1, 0.01)
    .name('잔디 반발계수')
    .onChange(retune);
  // The wall stands at the outer edge of this. It has to clear a cap, because
  // "a cap can get behind a ball on the wall" is the whole specification.
  pitch
    .add(config.football, 'runoffWidth', 0, 16, 0.2)
    .name('런오프 폭')
    .onChange(rebuild);
  pitch.add(config.football, 'fenceHeight', 0.8, 6, 0.1).name('펜스 높이').onChange(rebuild);
  pitch
    .add(config.football, 'fenceThickness', 0.2, 2, 0.05)
    .name('펜스 두께')
    .onChange(rebuild);
  // Drag to 0 for the square corner and watch a ball tuck into it: from there
  // only a narrow wedge of aims frees it, because both walls push it back into
  // the other one. The fillet is the fix, and this is the demonstration.
  pitch
    .add(config.football, 'cornerRadius', 0, 16, 0.5)
    .name('구석 라운드 반경')
    .onChange(rebuild);
  // Where a goal starts counting, drawn as a box. Its near face is set back by a
  // whole ball diameter, which is what "the whole of the ball crossed the line"
  // looks like as a volume.
  pitch.add(config.view, 'goalSensors').name('골 센서 와이어프레임');
  pitch.add(config.view, 'showRunoff').name('런오프 존 표시');
  pitch.open();

  // ── curling ──────────────────────────────────────────────────────────────
  // Its own folder and its own numbers, top to bottom. Nothing in here touches
  // `config.arena` or `config.football`: "다른 모드의 물리 파라미터 수정 — 컬링
  // 전용값으로 분리한다", so the lane's friction, its walls and its turn-end
  // clock are all separate values that only this mode reads.
  const curl = gui.addFolder('컬링 (변경 시 재구성)');

  const curlStats = { lane: '', house: '' };
  // The completion criteria, as readouts. Measured off the BUILT lane rather
  // than off the config, so they check the geometry that exists and not the
  // arithmetic that was supposed to produce it — the house clamp in particular
  // is invisible from the sliders alone.
  const laneRow = curl.add(curlStats, 'lane').name('레인 / 하우스 여백').disable();
  // The tiebreaker's own working, shown live. It is the one thing about this
  // mode that cannot be checked by looking at the board: two caps a millimetre
  // apart decide a 2–2, and which of them is nearer is not a thing the eye can
  // resolve at this zoom.
  const houseRow = curl.add(curlStats, 'house').name('하우스 안 (거리순)').disable();

  const refreshCurling = () => {
    const layout = match.arena.layout;
    const m = layout?.metrics;
    if (!m || match.arena.layout.describe?.().kind !== 'lane') {
      curlStats.lane = '—';
      curlStats.house = '—';
    } else {
      curlStats.lane =
        `${m.length.toFixed(0)} x ${m.width.toFixed(1)}  ·  1:${m.ratio.toFixed(2)}  ·  ` +
        `하우스 r${m.houseRadius.toFixed(1)}${m.houseClamped ? ' (여백에 걸림)' : ''}  ·  ` +
        `벽 여백 ${m.houseMargin.toFixed(1)}`;
      const list = match.rules.inHouse?.() ?? [];
      curlStats.house = list.length
        ? list.map((e) => `P${e.player + 1}#${e.cap} ${e.distance.toFixed(2)}`).join('  ·  ')
        : '없음';
    }
    laneRow.updateDisplay();
    houseRow.updateDisplay();
  };

  // ── the lane ─────────────────────────────────────────────────────────────
  curl.add(config.curling, 'laneLength', 40, 200, 2).name('레인 길이').onChange(rebuild);
  // The brief's band is 1:4 to 1:5. It goes wider both ways so the reason for
  // the band is visible: at 2 the walls are so far apart that a reflection never
  // comes back, and at 8 there is no room to miss.
  curl.add(config.curling, 'laneRatio', 2, 8, 0.1).name('레인 비율 (길이:너비)').onChange(rebuild);
  curl.add(config.curling, 'runoff', 2, 40, 1).name('라인 뒤 런오프').onChange(rebuild);
  curl.add(config.curling, 'wallHeight', 0.6, 6, 0.1).name('벽 높이').onChange(rebuild);
  curl.add(config.curling, 'wallThickness', 0.3, 3, 0.05).name('벽 두께').onChange(rebuild);
  curl.add(config.curling, 'capsPerTeam', 1, 8, 1).name('팀당 뚜껑 수').onChange(rebuild);

  // ── the house ────────────────────────────────────────────────────────────
  curl.add(config.curling, 'houseRadius', 2, 24, 0.5).name('하우스 크기 (반경)').onChange(rebuild);
  // Clamps the radius above rather than merely being checked against it — a
  // house touching the walls deletes the wall-reflection game, which is the
  // mode. The readout says when the clamp bit.
  curl.add(config.curling, 'houseMargin', 0, 20, 0.5).name('하우스-벽 여백 (최소)').onChange(rebuild);
  curl
    .add(config.curling, 'houseFromBack', 2, 60, 1)
    .name('하우스 위치 (뒤 라인에서)')
    .onChange(rebuild);
  curl
    .add(config.curling, 'throwFromFront', 1, 40, 1)
    .name('발사 지점 (앞 라인에서)')
    .onChange(rebuild);
  curl.add(config.curling, 'throwClearance', 0, 4, 0.1).name('발사 지점 여유 간격');

  // ── materials ────────────────────────────────────────────────────────────
  // Low, and the number the cap actually gets: the lane combines friction by
  // `Min` against the cap's own 0.34, so this slider is not averaged with
  // anything. Drag it toward 0.3 and the throw stops arriving.
  curl.add(config.curling, 'laneFriction', 0.01, 0.6, 0.005).name('표면 마찰 (컬링)').onChange(retune);
  curl
    .add(config.curling, 'laneRestitution', 0, 0.5, 0.01)
    .name('표면 반발계수 (컬링)')
    .onChange(retune);
  // Combined by `Max`, so this one is not averaged either. High enough that the
  // reflection angle reads; drop it and a wall shot dies against the fence.
  curl
    .add(config.curling, 'wallRestitution', 0, 1, 0.01)
    .name('벽 반발계수 (컬링)')
    .onChange(retune);
  curl.add(config.curling, 'wallFriction', 0, 0.6, 0.01).name('벽 마찰 (컬링)').onChange(retune);

  // ── turn end, curling's own ──────────────────────────────────────────────
  // The shared values in 턴 종료 above are for a cap on a 0.34 mat. These
  // override them for this mode only; see `Layout.turnOverrides`.
  const curlTurn = curl.addFolder('턴 종료 (컬링 전용)');
  curlTurn.add(config.curling.turn.rest.cap, 'linear', 0.05, 6, 0.05).name('정지 임계 (선속도)');
  curlTurn.add(config.curling.turn.rest.cap, 'angular', 0.05, 6, 0.05).name('정지 임계 (각속도)');
  curlTurn.add(config.curling.turn, 'quietSteps', 5, 120, 1).name('정지 유지 스텝');
  curlTurn.add(config.curling.turn, 'rampStartSec', 1, 18, 0.5).name('damping 램프 시작 (s)');
  curlTurn.add(config.curling.turn, 'rampCurve', 0.3, 5, 0.05).name('램프 커브');
  curlTurn.add(config.curling.turn, 'rampMaxDamping', 0, 30, 0.5).name('램프 최대 damping');
  curlTurn.add(config.curling.turn, 'hardTimeoutSec', 2, 30, 0.5).name('하드 타임아웃 (s)');
  curlTurn.open();

  // ── camera ───────────────────────────────────────────────────────────────
  // Curling's own range. A 1:4.5 lane frames unlike a square board and unlike a
  // 105:68 pitch — see the note on `curlingMinZoom`.
  //
  // The camera already holds getters onto these three, so dragging one changes
  // the range immediately — but the LIVE zoom is only re-clamped when the range
  // is set, so raising the floor above where the player is sitting would leave
  // them below it until the next mode switch. Guarded on the mode because these
  // rows are curling's and pushing curling's range at a knockout camera would be
  // the reset bug this file already has a note about.
  const applyZoom = () => {
    if (config.mode !== 'curling') return;
    camera.setZoomRange({
      min: () => config.view.curlingMinZoom,
      max: () => config.view.curlingMaxZoom,
      turn: () => config.view.curlingTurnZoom,
    });
  };
  const curlZoom = curl.addFolder('줌 범위 (컬링 전용)');
  curlZoom.add(config.view, 'curlingMinZoom', 1, 3, 0.05).name('최소 줌').onChange(applyZoom);
  curlZoom.add(config.view, 'curlingMaxZoom', 1.5, 8, 0.1).name('최대 줌').onChange(applyZoom);
  curlZoom.add(config.view, 'curlingTurnZoom', 1, 4, 0.05).name('턴 시작 줌').onChange(applyZoom);

  curl.add(config.view, 'curlingSensors').name('하우스/아웃 라인 와이어프레임');
  curl.open();

  // ── the ball coming back ─────────────────────────────────────────────────
  // All live: read at the moment a turn ends. The search that uses them walks a
  // fixed sequence, so the same world gives the same spot every time — which is
  // what keeps the replay check meaningful through a respawn.
  const back = gui.addFolder('아웃 리스폰');
  respawnRows.push(
    back.add(config.respawn, 'inset', 0.4, 8, 0.1).name('경계선 안쪽 오프셋'),
    // At 0 a spot counts as free when the ball would be touching a cap.
    back.add(config.respawn, 'margin', 0, 4, 0.05).name('여유 공간 마진'),
    back.add(config.respawn, 'slideStep', 0.5, 8, 0.1).name('경계선 슬라이드 간격'),
    back
      .add(config.respawn, 'maxSlideFraction', 0.02, 0.6, 0.01)
      .name('슬라이드 최대 (길이 비율)'),
    back.add(config.respawn, 'inwardStep', 0.5, 8, 0.1).name('안쪽 밀어내기 간격'),
    back.add(config.respawn, 'inwardSteps', 0, 16, 1).name('안쪽 밀어내기 횟수'),
    back.add(config.respawn, 'travelSeconds', 0.1, 2, 0.05).name('리스폰 이동 시간 (s)'),
    // The search is invisible when it works — the ball just appears somewhere
    // sensible, and a good answer looks exactly like a lucky one.
    back.add(config.respawn, 'showSearch').name('탐색 후보 표시'),
  );
  back.open();

  // ── view ─────────────────────────────────────────────────────────────────
  const look = gui.addFolder('뷰');
  const topDownRow = look
    .add(config.view, 'topDown')
    .name('탑다운 뷰')
    .onChange(() => camera.apply());
  const pitchAngleRow = look
    .add(config.view, 'cameraPitch', 10, 88, 1)
    .name('카메라 각도 (탑다운 해제 시)')
    .onChange(() => camera.apply());
  // The football angle is fixed by the brief and the player gets zoom instead,
  // so this is a readout you can move rather than a control the mode exposes.
  const footballAngleRow = look
    .add(config.view, 'footballPitchAngle', 40, 90, 1)
    .name('축구 카메라 각도 (고정)')
    .onChange(() => camera.apply());
  look.add(config.view, 'maxZoom', 1.5, 10, 0.5).name('최대 줌 배율');

  // ── camera control ───────────────────────────────────────────────────────
  const cam = gui.addFolder('카메라 조작');
  cam.add(config.view, 'panSpeed', 0.2, 3, 0.05).name('팬 속도 (1 = 정확 추종)');
  // Drag to 0 for the strict clamp — the field's edge stops dead at the frame's
  // edge, and at 1.5x there is almost no travel left. That is what this fixes.
  cam.add(config.view, 'panMargin', 0, 0.6, 0.01).name('팬 여백 (화면 비율)');
  // A gain on the angle the hand sweeps, not a pixel rate. 1 is exact tracking:
  // the point you grabbed stays under the finger. Move it and it stops doing so.
  cam.add(config.view, 'rotateSpeed', 0.25, 2.5, 0.05).name('회전 속도 (1 = 정확 추종)');
  cam.add(config.view, 'rotateDamping', 0.3, 12, 0.1).name('회전 관성 감쇠 (1/s)');
  // A magnet at the two bearings where the goals stand vertical, not a grid.
  // 0 turns it off and the angle is free everywhere.
  cam.add(config.view, 'snapWindowDeg', 0, 30, 0.5).name('수직 스냅 범위 (°)');
  // Drag toward 0 and the rotation stops engaging: the zoom lands on 1.0001
  // after a wheel notch and an equality test never fires. That is what the band
  // is for, and this is the demonstration.
  cam
    .add(config.view, 'rotateBand', 0, 0.4, 0.005)
    .name('최소 줌 판정 여유 (배율)');
  // The line between "this press fires" and "this press moves the camera". The
  // hover ring on the board is drawn at exactly this radius.
  cam.add(config.view, 'grabRadius', 1, 3.5, 0.05).name('뚜껑 집기 여유 반경 (배)');
  cam.add(config.view, 'transitionSec', 0.02, 1, 0.01).name('모드 전환 보간 (s)');
  cam
    .add(
      { centre: () => { config.view.azimuth = 0; camera.stopSpin(); camera.apply(); } },
      'centre',
    )
    .name('↺ 회전각 0으로');
  cam.open();
  look
    .add(config.view, 'wireframe')
    .name('와이어프레임')
    .onChange((v) => view.setWireframe(v));
  look.add(config.view, 'ps1').name('PS1 셰이더');
  // Worth having next to the wireframe toggle rather than buried: a cap is 84
  // columns around, so at 320x240 its wireframe is finer than the pixels and
  // collapses into a solid disc. Step the internal target up and the mesh reads
  // again — including which way up a cap is lying, which is a solid ring one way
  // and an open starburst of flutes the other.
  look
    .add(config.view, 'renderMode', Object.keys(RENDER_MODES))
    .name('내부 렌더 해상도')
    .onChange((v) => {
      viewport.setMode(v);
      // The cards are drawn into that target too, so their texel budget just
      // changed even though nothing in the card folder was touched.
      refreshTexels();
    });
  look.add(config.view, 'slowmo', 0.05, 2, 0.05).name('물리 슬로모션');
  look.add(config.view, 'vertexSnap', 0, 1, 0.01).name('버텍스 스냅');
  look
    .add({ quantise: true }, 'quantise')
    .name('컬러 양자화 (15bit)')
    .onChange((v) => {
      retroPass.uniforms.uColorLevels.value = v ? PS1_COLOR_LEVELS : 255;
    });

  // ── cards ────────────────────────────────────────────────────────────────
  // All live: the hand is on screen while these move, which is the only way to
  // judge any of them. None of it reaches the simulation — the cards are a
  // separate scene animated on the render clock.
  //
  // Every length here is in FRAME PIXELS: the card scene's orthographic camera
  // covers a fixed 640x480 box whatever the window and the internal target are
  // set to. So 128 means "a fifth of the screen's width", not "128 CSS pixels".
  const hand = gui.addFolder('카드 핸드');

  /**
   * The ceiling, not a deal.
   *
   * There used to be a "핸드 장수" slider here that re-dealt both hands on the
   * spot. It went with the deal itself: hands start empty and fill from the
   * field, so the only number left worth setting is how many a player may hold
   * before a pickup starts failing. Lowering it below what someone is already
   * carrying does not discard anything — it just stops them taking more.
   */
  hand.add(config.cards, 'handLimit', 1, 10, 1).name('손패 상한');

  const handStats = { held: '' };
  const heldRow = hand.add(handStats, 'held').name('보유 (P1 / P2)').disable();
  const refreshHands = () => {
    handStats.held = `${match.hands.count(0)} / ${match.hands.count(1)}  (상한 ${match.hands.limit})`;
    heldRow.updateDisplay();
  };
  refreshHands();

  const weights = hand.addFolder('오브 카드 가중치');
  for (const id of DRAWABLE) {
    weights.add(config.cards.orbWeights, id, 0, 5, 0.1).name(CARD_BY_ID.get(id)?.name ?? id);
  }

  hand
    .add(
      {
        clear: () => {
          match.hands.reset();
          refreshHands();
        },
      },
      'clear',
    )
    .name('손패 강제 초기화');

  // ── texture ──────────────────────────────────────────────────────────────
  // The one readout worth watching on this folder. A card drawn smaller than
  // its texture is being POINT-SAMPLED down — there are no mipmaps, by design —
  // and columns of the description simply do not reach the screen. At 1.00 the
  // card lands one texel per framebuffer pixel and every stroke survives.
  //
  // Measured against the RENDER TARGET, not against the card's layout size. The
  // card scene's camera covers a fixed 640-wide frame however big the target
  // is, so a 128 px card is 128 target pixels at 640x480 and 64 of them at
  // 320x240 — the same card, twice the minification. Dividing texels by the
  // layout width would report a flat 1.00 at every resolution, which is exactly
  // 1.00-and-wrong at the one this panel invites you to switch to.
  const texStats = { base: '', hover: '' };
  const baseRow = hand.add(texStats, 'base').name('텍스처 (기본) 텍셀/픽셀').disable();
  const hoverRow = hand.add(texStats, 'hover').name('텍스처 (호버) 텍셀/픽셀').disable();
  const refreshTexels = () => {
    const c = config.cards;
    const perFrame = viewport.resolution.x / CARD_FRAME_WIDTH;
    const base = c.textureWidth / (c.width * perFrame);
    const hov = c.hoverTextureWidth / (c.width * c.hoverScale * perFrame);
    const mark = (r) => (r <= 1.02 ? '✓' : r < 1.35 ? '~' : '⚠ 글자 손실');
    texStats.base = `${base.toFixed(2)}  ${mark(base)}`;
    texStats.hover = `${hov.toFixed(2)}  ${mark(hov)}`;
    baseRow.updateDisplay();
    hoverRow.updateDisplay();
  };
  const TEX_SIZES = [64, 96, 128, 144, 160, 192, 224, 256, 384, 512];
  hand
    .add(config.cards, 'textureWidth', TEX_SIZES)
    .name('카드 텍스처 해상도 (기본)')
    .onChange(() => {
      cards.refreshTextures();
      refreshTexels();
    });
  hand
    .add(config.cards, 'hoverTextureWidth', TEX_SIZES)
    .name('카드 텍스처 해상도 (호버)')
    .onChange(() => {
      cards.refreshTextures();
      refreshTexels();
    });

  // ── the fan ──────────────────────────────────────────────────────────────
  hand.add(config.cards, 'width', 64, 256, 2).name('카드 크기 (폭)').onChange(refreshTexels);
  hand.add(config.cards, 'spreadDeg', 0, 90, 1).name('부채꼴 전체 각도');
  hand.add(config.cards, 'spacing', 10, 140, 1).name('카드 간 간격');
  hand.add(config.cards, 'curvature', 0, 40, 0.5).name('호 곡률 (끝 처짐)');
  hand.add(config.cards, 'hoverLift', 0, 200, 1).name('호버 솟음 높이');
  hand.add(config.cards, 'hoverScale', 1, 2.2, 0.01).name('호버 확대 배율').onChange(refreshTexels);
  hand.add(config.cards, 'neighbourPush', 0, 100, 1).name('인접 카드 밀림');

  // ── the springs ──────────────────────────────────────────────────────────
  // Below about 30 the spring overshoots, which is what gives a released card
  // its bounce. Drag it up and the hand starts to feel like a set of panels.
  hand.add(config.cards, 'stiffness', 40, 600, 5).name('스프링 강성');
  hand.add(config.cards, 'damping', 4, 60, 0.5).name('스프링 감쇠');
  hand.add(config.cards, 'snapKick', 0, 8, 0.1).name('임계 통과 팝');
  // In card heights. Low on purpose — a card that will not go reads as broken
  // long before it reads as strict.
  hand.add(config.cards, 'useLiftFactor', 0.2, 2, 0.05).name('사용 임계 (카드 높이 배수)');
  hand.add(config.cards, 'useFlySeconds', 0.1, 1, 0.02).name('사용 연출 시간 (s)');

  // ── tucked / raised ──────────────────────────────────────────────────────
  hand.add(config.cards, 'idleExposure', 0, 200, 2).name('핸드 노출 (대기)');
  hand.add(config.cards, 'idleGrey', 0, 1, 0.01).name('대기 흑백 비율');
  hand.add(config.cards, 'raiseSeconds', 0.05, 1, 0.01).name('핸드 올라오는 시간 (s)');

  // ── the two hands ────────────────────────────────────────────────────────
  hand.add(config.cards, 'activeExposure', 40, 300, 2).name('핸드 노출 (호버)');
  hand.add(config.cards, 'inactiveExposure', 0, 200, 2).name('핸드 노출 (비활성)');
  hand.add(config.cards, 'inactiveScale', 0.4, 1, 0.01).name('비활성 축소');
  hand.add(config.cards, 'inactiveOpacity', 0.1, 1, 0.01).name('비활성 투명도');
  hand.add(config.cards, 'turnSwapSeconds', 0.1, 2, 0.05).name('턴 전환 시간 (s)');

  // ── the look, and the raycast ────────────────────────────────────────────
  // Separate from the game scene's snap so the two can be compared, not so the
  // cards can be let off it: at 1 a card jitters exactly as the pitch does, and
  // that is the whole reason the hand is drawn through this pipeline.
  hand.add(config.cards, 'vertexSnap', 0, 1, 0.01).name('카드 버텍스 스냅');
  hand.add(config.cards, 'greyStrength', 0, 1, 0.01).name('흑백 처리 강도');
  hand.add(config.cards, 'shadowOffsetX', -12, 12, 1).name('그림자 오프셋 X');
  hand.add(config.cards, 'shadowOffsetY', -12, 12, 1).name('그림자 오프셋 Y');
  hand.add(config.cards, 'shadowOpacity', 0, 1, 0.01).name('그림자 농도');
  hand.add(config.cards, 'hitMargin', 0, 40, 1).name('레이캐스트 여유 (px)');
  hand.add(config.cards, 'showHitAreas').name('레이캐스트 히트 영역 표시');
  hand.add(config.cards, 'blockedGrey', 0, 1, 0.01).name('사용 불가 흑백');
  hand.add(config.cards, 'blockedBrightness', 0.2, 1, 0.01).name('사용 불가 밝기');
  hand.add(config.cards, 'refuseShakeAmount', 0, 30, 1).name('거절 흔들림 (px)');
  hand.add(config.cards, 'refuseShakeSeconds', 0.05, 1, 0.01).name('거절 흔들림 시간 (s)');
  refreshTexels();

  // ── card effects ─────────────────────────────────────────────────────────
  // What the four cards DO, and what that looks like. The effect values are read
  // by the turn loop; everything under 연출 is read by `CardFx`, which runs on
  // the render clock and cannot reach the simulation.
  const fx = gui.addFolder('카드 효과');

  const fxStats = { active: '' };
  const activeRow = fx.add(fxStats, 'active').name('활성 효과').disable();
  const refreshCards = () => {
    const c = match.cards;
    const bits = [];
    // One slot per victim now, so both can be lit at once.
    const confused = [0, 1].filter((v) => c.chaos[v]).map((v) => `P${v + 1}`);
    bits.push(confused.length ? `혼란 → ${confused.join(',')}` : '혼란 —');
    bits.push(c.oneMore ? `원모어 P${c.oneMore.player + 1}` : '원모어 —');
    bits.push(c.trajectory ? `궤적 P${c.trajectory.player + 1}` : '궤적 —');
    // The multipliers are shown WITH the state, because the whole question the
    // card asks is what those two numbers are — "강타 P1" alone says nothing
    // about whether this shot is a bargain or a gamble.
    bits.push(
      c.smash
        ? `강타 P${c.smash.player + 1} ×${config.cards.smashImpulseMul.toFixed(2)}/오차×${config.cards.smashSpreadMul.toFixed(2)}`
        : '강타 —',
    );
    const bad = match.swapOverlap?.length ?? 0;
    if (bad) bits.push(`⚠ 스왑 후 겹침 ${bad}`);
    fxStats.active = bits.join('  ·  ');
    activeRow.updateDisplay();
  };

  fx.add(config.cards, 'chaosMaxDeg', 0, 180, 1).name('혼란 편차 범위 (°)');
  fx.add(config.cards, 'trajectorySeconds', 0.5, 6, 0.1).name('궤적 예측 시간 (s)');
  // The two 강타 dials, and they are separate because the card IS the ratio
  // between them. The impulse range stops at 2.0: past that a 1/120 step moves
  // a cap further than a wall is thick and the CCD is being asked to catch what
  // it has already passed. `refreshCards` shows both live.
  fx.add(config.cards, 'smashImpulseMul', 1.2, 2.0, 0.05)
    .name('강타 임펄스 배율')
    .onChange(refreshCards);
  fx.add(config.cards, 'smashSpreadMul', 1.0, 4.0, 0.05)
    .name('강타 오차 배율')
    .onChange(refreshCards);
  fx.add(config.cards, 'swapSeconds', 0.1, 1.5, 0.05).name('스왑 이동 시간 (s)');
  fx.add(config.cards, 'swapArcHeight', 0, 6, 0.1).name('스왑 호 높이');

  // Per card, because they are different lengths of statement: a swap has two
  // ends to read and a one-more has none.
  const lengths = fx.addFolder('연출 길이 (s)');
  for (const [id, label] of [
    ['swap', '스왑'],
    ['trajectory', '궤적'],
    ['chaos', '혼란'],
    ['onemore', '원모어'],
    ['smash', '강타'],
  ]) {
    lengths.add(config.cards.fxSeconds, id, 0.1, 1, 0.05).name(label);
  }

  // Effect only, no game state touched — for judging the look without spending a
  // card, and without the turn moving underneath it.
  const previewFx = fx.addFolder('연출만 재생');
  for (const [id, label] of [
    ['swap', '스왑'],
    ['trajectory', '궤적'],
    ['chaos', '혼란'],
    ['onemore', '원모어'],
    ['smash', '강타'],
  ]) {
    previewFx
      .add({ go: () => cardFx?.play(id, match.rules.currentPlayer, config.cards.fxSeconds[id]) }, 'go')
      .name(`▶ ${label}`);
  }

  // The real thing, on the current player, bypassing the hand. For testing the
  // rules rather than the drag.
  const force = fx.addFolder('효과 강제 발동');
  for (const [id, label] of [
    ['swap', '스왑'],
    ['trajectory', '궤적'],
    ['chaos', '혼란'],
    ['onemore', '원모어'],
    ['smash', '강타'],
  ]) {
    force
      .add(
        {
          go: () => {
            const r = match.playCard(id);
            if (!r.ok) console.warn(`[card] ${id}: ${r.reason}`);
            refreshCards();
          },
        },
        'go',
      )
      .name(`▶ ${label}`);
  }

  // ── how the effects are drawn ────────────────────────────────────────────
  const fxLook = fx.addFolder('연출 (그리기)');
  fxLook.add(config.cardFx, 'vertexSnap', 0, 1, 0.01).name('연출 버텍스 스냅');

  fxLook
    .add(config.cardFx, 'stunFrames', 2, 16, 1)
    .name('스턴 프레임 수')
    .onChange(() => clearFxTextureCache());
  fxLook
    .add(config.cardFx, 'stunTexels', 8, 64, 4)
    .name('스턴 텍스처 해상도')
    .onChange(() => clearFxTextureCache());
  fxLook.add(config.cardFx, 'stunRotationsPerSecond', 0.1, 4, 0.05).name('스턴 회전 속도 (회/s)');
  fxLook.add(config.cardFx, 'stunOrbitRadius', 0, 8, 0.1).name('스턴 궤도 반경');
  fxLook.add(config.cardFx, 'stunHeight', 0, 8, 0.1).name('스턴 높이');
  fxLook.add(config.cardFx, 'stunSize', 0.5, 8, 0.1).name('스턴 크기');
  fxLook.add(config.cardFx, 'paletteCyclesPerSecond', 0, 6, 0.1).name('팔레트 순환 속도');
  fxLook.add(config.cardFx, 'shakeAmount', 0, 1, 0.01).name('뚜껑 흔들림 강도');
  fxLook.add(config.cardFx, 'shakeHz', 0, 20, 0.5).name('뚜껑 흔들림 주기 (Hz)');

  fxLook.add(config.cardFx, 'ringSize', 1, 16, 0.5).name('링/플래시 크기');
  fxLook.add(config.cardFx, 'swapVanishFraction', 0.05, 0.5, 0.01).name('스왑 사라짐 비율');
  fxLook.add(config.cardFx, 'pulseAmount', 0, 1, 0.01).name('원모어 펄스 크기');
  fxLook.add(config.cardFx, 'edgeBeats', 1, 6, 1).name('원모어 가장자리 점멸 수');
  fxLook.add(config.cardFx, 'scanHeight', 8, 160, 4).name('스캔 밴드 높이 (px)');
  fxLook.add(config.cardFx, 'dashSamplesPerSecond', 0, 60, 1).name('궤적 점선 흐름 속도');

  // ── 강타 ────────────────────────────────────────────────────────────────
  // Its own folder because it has two halves that are judged separately: the
  // half-second the card lands in, and the whole turn it then sits there for.
  const smashLook = fxLook.addFolder('강타');
  smashLook.add(config.cardFx, 'smashInvertFrames', 0, 6, 1).name('반전 플래시 (프레임)');
  smashLook.add(config.cardFx, 'smashRingStart', 1, 8, 0.1).name('링 시작 크기 (배)');
  smashLook.add(config.cardFx, 'smashRingFraction', 0.1, 1, 0.02).name('링 수축 속도 (연출 비율)');
  smashLook.add(config.cardFx, 'smashRingSteps', 2, 20, 1).name('링 수축 단계 수');
  smashLook.add(config.cardFx, 'smashPulseAmount', 0, 1.5, 0.05).name('뚜껑 펄스 크기');
  smashLook.add(config.cardFx, 'smashAuraSize', 1, 12, 0.1).name('오라 크기');
  smashLook.add(config.cardFx, 'smashAuraHeight', 0, 4, 0.05).name('오라 높이');
  smashLook.add(config.cardFx, 'smashAuraStrength', 0, 1, 0.01).name('오라 발광 강도');
  smashLook
    .add(config.cardFx, 'smashPaletteCyclesPerSecond', 0, 8, 0.1)
    .name('오라 팔레트 순환 속도');
  smashLook.add(config.cardFx, 'smashJitterAmount', 0, 0.5, 0.005).name('뚜껑 진동 강도');
  smashLook.add(config.cardFx, 'smashJitterHz', 0, 40, 0.5).name('뚜껑 진동 주기 (Hz)');

  refreshCards();

  /**
   * ── the winning sequence ─────────────────────────────────────────────────
   * Everything below edits `config.victory` and nothing else, so turning the
   * panel off changes nothing about how the sequence behaves.
   *
   * The two force buttons are the only way to see both outcomes without playing
   * two matches to the end, and they are why the layer takes a winner index
   * rather than reading `match.winner` for itself — see `VictoryLayer.begin`.
   * They play the real thing, not a demo: the same call the loop makes when a
   * match actually ends, so what is judged here is what ships. The match is left
   * exactly where it was, because the sequence writes nothing back to it.
   */
  const win = gui.addFolder('승리 연출');

  const winStats = { state: '' };
  const winStateRow = win.add(winStats, 'state').name('연출 상태').disable();
  const refreshVictory = () => {
    const v = victory;
    winStats.state = !v
      ? '—'
      : !v.active
        ? `대기  ·  매치 ${match.state}`
        : `${v.stage}${v.clock.skipped ? ' (스킵됨)' : ''}  ·  ` +
          `${v.winnerIndex < 0 ? '무승부' : `${v.winnerIndex + 1}P`}  ·  ` +
          `버튼 ${v.interactive ? '활성' : '비활성'}`;
    winStateRow.updateDisplay();
  };

  const winForce = win.addFolder('연출 강제 재생');
  for (const [index, label] of [
    [0, '1P 승리'],
    [1, '2P 승리'],
    [-1, '무승부'],
  ]) {
    winForce
      .add(
        {
          go: () => {
            // `forced`, because the match on the board has almost certainly not
            // finished — this is here so both outcomes can be judged without
            // playing two matches out. The loop leaves a forced sequence alone.
            victory?.begin(index, { forced: true });
            refreshVictory();
          },
        },
        'go',
      )
      .name(`▶ ${label}`);
  }
  winForce
    .add({ go: () => { victory?.dismiss(); refreshVictory(); } }, 'go')
    .name('■ 연출 내리기');
  winForce.open();

  // Per stage, because they are different lengths of statement: the wait before
  // the hit and the settle after it are watched, and the charge is read.
  const winLen = win.addFolder('단계별 길이');
  winLen.add(config.victory, 'enterSeconds', 0.1, 2, 0.05).name('1 패자 등장 (s)');
  winLen.add(config.victory, 'chargeSeconds', 0.1, 1.5, 0.02).name('2 승자 돌진 (s)').onChange(() => refreshWinSpeed());
  // Frames, not seconds. See the note on `impactFrames` in the config.
  winLen.add(config.victory, 'impactFrames', 1, 8, 1).name('3 충돌 (프레임)');
  winLen.add(config.victory, 'resultSeconds', 0.2, 2.5, 0.05).name('4 결과 (s)');
  winLen.add(config.victory, 'uiSeconds', 0.1, 1.5, 0.05).name('5 UI 등장 (s)');
  winLen.open();

  const winEnter = win.addFolder('승자 진입');
  winEnter.add(config.victory, 'enterAngleDeg', 0, 359, 1).name('진입 방향 (° 0=우 90=상)');
  winEnter.add(config.victory, 'enterDistance', 300, 1200, 10).name('진입 거리 (px)').onChange(() => refreshWinSpeed());
  /**
   * The entry SPEED, as a readout rather than a fourth dial.
   *
   * The brief asks for a speed control and there are already two numbers that
   * between them are one: the distance it crosses and the time it is given (that
   * second one lives with the other stage lengths, because it is also what the
   * stage costs). Adding an independent speed slider would make three numbers for
   * two degrees of freedom, and whichever two the code chose to believe, the
   * third would sit there lying.
   *
   * So the speed is derived and shown. Drag either dial and this moves. `peak`
   * is the interesting one: the charge eases on t^1.55, so the cap arrives a good
   * half again faster than the average — which is the number that decides whether
   * the hit reads as thrown or as slid.
   */
  const winSpeed = { line: '' };
  const winSpeedRow = winEnter.add(winSpeed, 'line').name('진입 속도 (px/s, 파생)').disable();
  const refreshWinSpeed = () => {
    const cv = config.victory;
    const dist = Math.max(0, cv.enterDistance - cv.capScale * 1.35);
    const secs = Math.max(1e-3, cv.chargeSeconds);
    const avg = dist / secs;
    winSpeed.line = `평균 ${avg.toFixed(0)}  ·  도달 순간 ${(avg * 1.55).toFixed(0)}`;
    winSpeedRow.updateDisplay();
  };
  refreshWinSpeed();
  winEnter.add(config.victory, 'trailCount', 0, 6, 1).name('잔상 개수');
  winEnter.add(config.victory, 'trailSpacing', 10, 120, 2).name('잔상 간격 (px)');
  winEnter.add(config.victory, 'trailSize', 8, 120, 2).name('잔상 크기 (px)');

  const winHit = win.addFolder('충돌');
  winHit.add(config.victory, 'invertFrames', 0, 8, 1).name('반전 플래시 (프레임)');
  winHit.add(config.victory, 'shakeStrength', 0, 48, 1).name('화면 흔들림 강도 (px)');
  winHit.add(config.victory, 'shakeSeconds', 0.02, 1, 0.01).name('흔들림 지속 (s)');
  winHit.add(config.victory, 'shakeHz', 2, 60, 1).name('흔들림 주기 (Hz)');
  winHit.add(config.victory, 'ringStart', 4, 200, 2).name('링 시작 크기 (px)');
  winHit.add(config.victory, 'ringEnd', 40, 640, 5).name('링 최대 크기 (px)');
  winHit.add(config.victory, 'ringSeconds', 0.05, 1.5, 0.01).name('링 확장 시간 (s)');

  const winOut = win.addFolder('패자 이탈');
  winOut.add(config.victory, 'flipSpeedTurns', 0.1, 6, 0.1).name('뒤집힘 속도 (회/s)');
  winOut.add(config.victory, 'exitSpeed', 200, 4000, 25).name('이탈 속도 (px/s)');

  const winSettle = win.addFolder('승자 정착');
  winSettle.add(config.victory, 'overshoot', 0, 260, 2).name('관성 오버슈트 (px)');
  winSettle.add(config.victory, 'springStiffness', 20, 900, 5).name('스프링 강성');
  winSettle.add(config.victory, 'springDamping', 1, 80, 0.5).name('스프링 감쇠');
  winSettle.add(config.victory, 'floatAmount', 0, 40, 1).name('부유 폭 (px)');
  winSettle.add(config.victory, 'floatHz', 0, 3, 0.05).name('부유 주기 (Hz)');

  const winLook = win.addFolder('배치와 배경');
  const winRelayout = () => victory?.layout();
  winLook.add(config.victory, 'groundTiltDeg', 0, 60, 1).name('바닥 기울기 (° 0=탑뷰)');
  winLook.add(config.victory, 'bgOpacity', 0, 1, 0.01).name('배경 페이드 강도');
  winLook.add(config.victory, 'bgFadeSeconds', 0.02, 1.5, 0.01).name('배경 페이드 (s)');
  winLook.add(config.victory, 'capScale', 16, 120, 1).name('뚜껑 크기 (px/unit)').onChange(() => refreshWinSpeed());
  winLook.add(config.victory, 'capY', -160, 200, 2).name('뚜껑 Y 위치');
  winLook.add(config.victory, 'textY', -240, 200, 2).name('텍스트 Y 위치').onChange(winRelayout);
  winLook.add(config.victory, 'buttonY', -240, 200, 2).name('버튼 Y 위치').onChange(winRelayout);
  winLook.add(config.victory, 'textPulseScale', 0, 0.6, 0.01).name('텍스트 등장 펄스');
  winLook
    .add(config.victory, 'hitMargin', 0, 40, 1)
    .name('버튼 히트 여유 (px)')
    .onChange(winRelayout);
  winLook.add(config.victory, 'showHitAreas').name('히트 영역 표시');

  // ── mode gating ──────────────────────────────────────────────────────────
  // Half of this panel describes a world that is not loaded. Hiding rather than
  // disabling, because a greyed-out row still reads as "this applies here but
  // is locked", which is the wrong thing to say about a board size on a pitch.
  function syncMode() {
    const football = config.mode === 'football';
    const curling = config.mode === 'curling';
    const knockout = !football && !curling;
    board.show(knockout);
    pitch.show(football);
    curl.show(curling);
    // The ball, its rest thresholds and its way back only exist in a mode that
    // has a ball.
    ball.show(football);
    back.show(football);
    for (const r of ballRestRows) r.show(football);
    for (const r of respawnRows) r.show(football);
    // The shared turn-end folder still applies to curling — the lane only
    // REPLACES the values it names — but the two that it does replace are in the
    // curling folder, and leaving both copies on screen is how you tune the one
    // that is not being read. See `Arena.turnConfig`.
    for (const r of sharedTurnRows) r.show(!curling);
    // Both non-football modes use the panel's own top-down toggle; only football
    // fixes its angle.
    topDownRow.show(!football);
    pitchAngleRow.show(!football);
    footballAngleRow.show(football);
  }
  syncMode();

  // ── reset ────────────────────────────────────────────────────────────────
  gui
    .add(
      {
        reset: () => {
          resetConfig();
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
          // Through the mode path: the reset restores `config.mode` too, so a
          // reset taken while football is loaded has to be able to put the
          // knockout board back.
          onModeChange();
          syncMode();
          camera.apply();
          view.setWireframe(config.view.wireframe);
          /**
           * `resetConfig` restores numbers and nothing else, and both overlays
           * only read their offsets when they lay themselves out — so without
           * these the plates stay where the sliders had dragged them while the
           * panel reports the defaults, and nothing short of nudging the same
           * slider again puts them back.
           *
           * The HUD's call was already missing before the victory screen
           * existed: `HudLayer.layout` is the only reader of `ui.scoreOffsetX/Y`,
           * `ui.exitOffsetX/Y` and `ui.hitMargin`, and the only thing that ever
           * called it was its own constructor and those sliders' `onChange`.
           */
          victory?.layout();
          hud?.layout();
          refresh();
        },
      },
      'reset',
    )
    .name('↺ 전체 리셋 (기본값 + 새 매치)');

  gui.add({ newMatch: rebuild }, 'newMatch').name('새 매치 (설정 유지)');

  /**
   * ── the HUD, which is meshes now ─────────────────────────────────────────
   * Everything below edits `config.ui` and nothing else, so turning the panel
   * off changes nothing about how the readouts behave.
   *
   * The zoom readout the brief asks for is already in the camera line above —
   * it prints `z1.00·min`, and the `·min` is `camera.atMinZoom`, the SAME
   * getter the score's visibility and the rotate drag both ask. Adding a second
   * one here would be a second thing that could disagree.
   */
  const ui = gui.addFolder('UI (HUD)');
  const relayout = () => hud?.layout();

  ui.add(config.ui, 'vertexSnap', 0, 1, 0.01).name('UI 버텍스 스냅 (게임과 별도)');
  ui.add(config.ui, 'textureScale', [0.5, 1, 1.5, 2, 3]).name('UI 텍스처 배율 (1 = 1:1)');
  ui.add(config.ui, 'forceScore', ['auto', 'on', 'off']).name('스코어 강제 표시');
  ui.add(config.ui, 'scoreFadeSeconds', 0.02, 1.5, 0.01).name('스코어 페이드 (s)');
  ui.add(config.ui, 'scorePulseSeconds', 0.05, 0.3, 0.01).name('점수 변화 강조 (s)');
  ui.add(config.ui, 'scorePulseScale', 0, 0.6, 0.01).name('강조 스케일');
  ui.add(config.ui, 'dimOpacity', 0, 1, 0.01).name('줌인 시 버튼 투명도');
  ui.add(config.ui, 'aimHideSeconds', 0, 0.6, 0.01).name('조준 시 UI 숨김 (s)');
  ui.add(config.ui, 'hitMargin', 0, 40, 1).name('버튼 히트 여유 (px)').onChange(relayout);
  ui.add(config.ui, 'showHitAreas').name('히트 영역 표시');
  ui.add(config.ui, 'scoreOffsetX', -300, 300, 1).name('스코어 X 오프셋').onChange(relayout);
  ui.add(config.ui, 'scoreOffsetY', -220, 220, 1).name('스코어 Y 오프셋').onChange(relayout);
  ui.add(config.ui, 'exitOffsetX', -300, 300, 1).name('나가기 X 오프셋').onChange(relayout);
  ui.add(config.ui, 'exitOffsetY', -220, 220, 1).name('나가기 Y 오프셋').onChange(relayout);

  /**
   * The determinism check, which used to be a banner across the top of the
   * screen.
   *
   * It only ever says anything after the replay button above has been pressed —
   * `match.verify` is populated by `replayLastTurn` and by nothing else — so it
   * was a player-facing element that no player could ever reach. It belongs
   * next to the button that fills it in.
   */
  const verify = { line: '—' };
  const verifyRow = ui.add(verify, 'line').name('결정론 검증').disable();
  const refreshVerify = () => {
    const v = match.verify;
    verify.line = !v
      ? '—'
      : v.ok
        ? `OK  ${v.actualHash} · ${v.actualSteps}스텝`
        : `불일치  ${v.expectedHash}→${v.actualHash} · ${v.expectedSteps}→${v.actualSteps}스텝`;
    verifyRow.updateDisplay();
  };
  refreshVerify();

  refresh();
  return {
    gui,
    refresh: () => {
      refresh();
      refreshVerify();
    },
    refreshCamera,
  };
}

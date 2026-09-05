import GUI from 'lil-gui';
import { describeCapColliders, nestingClearance } from '../physics/capCollider.js';
import { resetConfig } from '../game/config.js';
import { MODES, MODE_KEYS, scoreboardFor } from '../game/modes.js';
// Both for the curling folder's round-stepper: it fires a real shot through the
// real path, so it needs the same seed source every other unpinned shot uses and
// the state enum to know whether a turn is open or still being played out.
import { MATCH_STATE } from '../game/Match.js';
import { nextSeed } from '../physics/rng.js';
import { FORMATION_KEYS } from '../game/layout/formations.js';
import { RATIO } from '../game/layout/pitchMetrics.js';
import { FRAME as CARD_FRAME } from '../render/CardLayer.js';
import { clearFxTextureCache } from '../render/fxTextures.js';
import { onQualityChange, QUALITY, TIER_NAMES } from '../core/quality.js';
// Both used by the orb-weight folder below and both previously missing, which
// made `?debug=1` throw a ReferenceError partway through building the panel —
// so every folder after the weights, this file's own victory section included,
// was unreachable. Nothing about the panel's behaviour changes; it now gets as
// far as the end.
import { DRAWABLE } from '../game/cards/CardHands.js';
import { CARD_BY_ID } from '../game/cards/cardCatalog.js';
import { addAudioFolder } from '../audio/audioDebug.js';

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
  tracker,
  router,
  retro,
  composer,
  viewport,
  config,
  preview,
  cards,
  cardFx,
  hud,
  victory,
  audio,
  audioSettings,
  graphicsSettings = null,
  onRebuild,
  onModeChange,
  onNewMatch,
  onReplaySeed,
  controllers,
  setOpponent,
  onRecenter,
  online = null,
  profile = null,
  onReplayIntro,
  onForceDesync,
  onDumpLog,
  onExportLog,
}) {
  const gui = new GUI({ title: '한여름 알까기 — 물리 코어' });

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
  // Its own stash rather than a seventh field on `stats`, because its row lives
  // down in the follow folder next to the sliders it explains rather than up
  // here with the readouts about the world.
  const trackStats = { line: '—' };

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
    // Last, and on the slow poll rather than per frame: it only ever changes
    // when a match starts, and every path that starts one comes back through
    // here. Defined further down — `refresh` is not called until it exists.
    refreshSeed();
    seedDisplay.updateDisplay();
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

    /**
     * What the follow is doing, and the one row the flight greys out.
     *
     * Both here rather than on the 400 ms poll: a throw is a second or two and
     * a fall snap is a quarter of one, so a slow poll would show neither the
     * hand-over from the spring to the fall nor the hand-back.
     *
     * `'live'` is the literal `MATCH_STATE.LIVE`, spelt the way the goal-hold
     * test above spells its own state — the panel compares state strings rather
     * than importing the enum.
     */
    trackStats.line = tracker ? tracker.label : '—';
    trackRow.updateDisplay();
    centreRow.enable(match.state !== 'live');

    // Ticked with the camera and not with the slow poll, for the same reason
    // the goal hold is: the whole sequence is under two seconds and a 400 ms
    // poll would show three of its five stages, if that.
    refreshVictory();

    // The relay's readouts, when there is a relay. Declared below and called
    // here so the network shares the panel's single refresh rather than adding
    // a second clock — the ping and the countdown both want to be live.
    netRefresh?.();
  };

  const rebuild = () => {
    onRebuild();
    refresh();
  };
  const retune = () => match.arena.applyMaterialTuning();

  // ── the opening sequence ─────────────────────────────────────────────────
  //
  // Its own folder rather than a corner of the online one: every mode plays it,
  // so a local match must be able to reach these without a relay in sight.
  const intro = gui.addFolder('시작 연출');
  intro.add(config.intro, 'enabled').name('연출 사용');
  // Runs whatever `enabled` says: the document opens on a shut letterbox and
  // something has to part it. See the note on the key in the config.
  intro.add(config.intro, 'barSeconds', 0.05, 1.5, 0.02).name('레터박스 열림 (초)');
  intro.add(config.intro, 'selfSec', 0, 3, 0.05).name('본인 등장 (초)');
  intro.add(config.intro, 'opponentSec', 0, 3, 0.05).name('상대 등장 (초)');
  intro.add(config.intro, 'holdSec', 0, 3, 0.05).name('대치 (초)');
  intro.add(config.intro, 'exitSec', 0, 3, 0.05).name('퇴장 (초)');
  intro.add({ replay: () => onReplayIntro?.() }, 'replay').name('▶ 다시 재생');

  // ── online ───────────────────────────────────────────────────────────────

  /** Filled in by the online folder below, if there is one. */
  let netRefresh = null;

  /**
   * The relay, when there is one.
   *
   * Built only for an online match. In local and AI play there is nothing here
   * to inspect and a folder full of dashes is worse than no folder — the panel
   * is read to find out what IS happening.
   */
  if (online) {
    const net = gui.addFolder('온라인');

    const netRow = {
      state: '',
      ping: '',
      room: '',
      seat: '',
      turn: '',
      mine: '',
      theirs: '',
    };
    const stateRow = net.add(netRow, 'state').name('연결 상태').disable();
    const pingRow = net.add(netRow, 'ping').name('핑 (ms)').disable();
    const roomRow = net.add(netRow, 'room').name('방 / 모드').disable();
    const seatRow = net.add(netRow, 'seat').name('내 자리 / 상대').disable();
    const turnRow = net.add(netRow, 'turn').name('턴 / 남은 시간').disable();
    /**
     * The two hashes, side by side.
     *
     * This is the readout the desync rule exists for: when the relay stops a
     * match it sends BOTH clients' reports, and being able to see them next to
     * each other is the difference between "it desynced" and knowing which turn
     * and by how much. Blank until one happens, which is the normal state.
     */
    const mineRow = net.add(netRow, 'mine').name('내 해시').disable();
    const theirsRow = net.add(netRow, 'theirs').name('상대 해시').disable();

    net.add(config.online, 'turnMs', 3000, 60000, 500).name('턴 제한 (ms)');
    net.add(config.online, 'heartbeatTimeoutMs', 3000, 60000, 500).name('heartbeat 타임아웃 (ms)');
    /**
     * Bound to the PROFILE, not to the config.
     *
     * This used to write `config.online.server`, which nothing read — the panel
     * showed a field, the field accepted an address, and the client went on
     * connecting to the derived one. Pointed at the model the connection
     * actually consults, and it persists, which a config value would not.
     */
    if (profile) {
      const relay = {
        get url() {
          return profile.server;
        },
        set url(v) {
          profile.setServer(v);
        },
      };
      net
        .add(relay, 'url')
        .name('서버 주소 (빈칸 = 자동)')
        // Takes effect on the NEXT connection: this one is already open, and
        // re-pointing a live match at another relay is not a thing to offer.
        .onFinishChange(() => {});
    }

    /**
     * The two failure modes, on demand.
     *
     * Both are paths that must never run in normal play, which is exactly why
     * they need a button: a disconnect handler nobody has watched fire is a
     * disconnect handler nobody has tested. The desync one lies in the REPORT
     * rather than damaging the world — see `OnlineMatch.forceDesync` — because a
     * half-corrupted simulation is a worse thing to leave behind than a stopped
     * match.
     */
    net
      .add({ drop: () => online.transport.close() }, 'drop')
      .name('▶ 강제 연결 끊기 (몰수패 테스트)');
    /**
     * The one that matters: silence WITHOUT a close.
     *
     * A killed mobile app, a phone that walks out of range, a laptop lid — none
     * of them produce a close event, and that is precisely the case the server's
     * heartbeat exists for. Closing the socket tests the easy path; this tests
     * the path that was actually broken.
     */
    net
      .add(
        {
          mute: () => {
            online.transport.muted = !online.transport.muted;
            netRow.state = online.transport.muted ? '무응답 모드' : '연결됨';
          },
        },
        'mute',
      )
      .name('▶ 강제 무응답 (close 없이 멈춤)');
    net
      .add({ desync: () => onForceDesync?.() }, 'desync')
      .name('▶ 강제 데스싱크');

    const log = net.addFolder('입력 로그');
    log.add({ dump: () => onDumpLog?.() }, 'dump').name('▶ 콘솔에 출력');
    log.add({ save: () => onExportLog?.() }, 'save').name('▶ 파일로 내보내기');

    netRefresh = () => {
      const t = online.transport;
      netRow.state = t.muted
        ? '무응답 모드 (테스트)'
        : !t.connected
          ? (t.lastError ?? t.state)
          : t.unstable
            ? '연결 불안정'
            : '연결됨';
      netRow.ping = String(Math.round(t.ping));
      netRow.room = `${online.match?.roomId ?? '-'} / ${online.match?.mode ?? '-'}`;
      netRow.seat = `${online.mySeat} (${online.nickname}) vs ${online.opponent?.nickname ?? '-'}`;
      const left = online.remaining;
      netRow.turn = `${online.turn} · ${online.current === online.mySeat ? '내 차례' : '상대'}` +
        (left === null ? '' : `  ${left.toFixed(1)}s`);
      netRow.turn +=
        online.over?.cause ? `   [${online.over.cause}]` : '';
      const d = online.desync;
      netRow.mine = d ? String(d.reports?.[online.mySeat]?.hash ?? '') : '';
      netRow.theirs = d ? String(d.reports?.[online.opponentSeat]?.hash ?? '') : '';
      stateRow.updateDisplay();
      pingRow.updateDisplay();
      roomRow.updateDisplay();
      seatRow.updateDisplay();
      turnRow.updateDisplay();
      mineRow.updateDisplay();
      theirsRow.updateDisplay();
    };
  }

  // ── determinism ──────────────────────────────────────────────────────────
  const det = gui.addFolder('결정론 검증');

  /**
   * The MATCH's root seed: the whole match's luck in one number.
   *
   * Two different things are called a seed in this folder and they must not be
   * confused. `lockSeed` below pins one SHOT so the same flick can be fired
   * twice; this pins the match — every shot seed, every card seed, and through
   * those every orb spawn and every card an orb yields.
   *
   * It is shown as hex because that is what `?seed=` accepts back and what a
   * player would copy into a bug report. Read live rather than latched: the
   * value changes under this panel every time a match is started.
   */
  const seedRow = { seed: '', pin: '' };
  const refreshSeed = () => {
    seedRow.seed = `0x${(match.seed >>> 0).toString(16).padStart(8, '0')}`;
  };
  refreshSeed();
  const seedDisplay = det.add(seedRow, 'seed').name('매치 시드').disable();
  det
    .add(
      {
        again: () => {
          onReplaySeed?.(match.seed);
          refresh();
        },
      },
      'again',
    )
    // The other half of the fix this folder is about. A new match now draws a
    // fresh seed — which is the point — so getting the SAME one again has to be
    // something you can ask for rather than something you get by default.
    .name('▶ 같은 시드로 재시작');
  det
    .add(
      {
        fresh: () => {
          onNewMatch?.();
          refresh();
        },
      },
      'fresh',
    )
    .name('▶ 새 시드로 재시작');
  det.add(seedRow, 'pin').name('시드 지정 (0x… 또는 10진)').onFinishChange((raw) => {
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n)) {
      // Silently seeding 0 off a typo is the one outcome worth guarding: it is a
      // legal seed, so nothing downstream would ever report it as wrong.
      window.alert('시드를 읽을 수 없다. 10진수나 0x… 형식으로 입력해라.');
      return;
    }
    onReplaySeed?.(n >>> 0);
    refresh();
  });

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
  // 뒤집힌 뚜껑이 딛는 면은 크림프 헴이 아니라 매끈한 상판이다. 위의 마찰과 한 쌍으로
  // 읽어야 하는 값이라 바로 아래에 둔다 — 0.16 은 정확히 절반, 미끄러지는 거리는 두 배.
  phys
    .add(config.collider, 'flippedFriction', 0, 1.5, 0.01)
    .name('뒤집힌 뚜껑 마찰')
    .onChange(retune);
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
  // 전용값으로 분리한다", so the table's friction and its turn-end clock are
  // separate values that only this mode reads.
  const curl = gui.addFolder('컬링 (변경 시 재구성)');

  const curlStats = { table: '', marks: '', round: '' };
  /**
   * The size trade, as a readout, measured off the BUILT table.
   *
   * Off the geometry rather than off the config, so it checks what exists and
   * not the arithmetic that was supposed to produce it. The cap's diameter is in
   * it because the whole tuning problem is the ratio between the two numbers —
   * see the note on `widthCaps` — and the throw's RUN is in it because that is
   * what the friction slider has to be tuned against: a full-power throw has to
   * be able to cover it and then some.
   */
  const tableRow = curl.add(curlStats, 'table').name('책상 / 뚜껑 / 던지는 거리').disable();
  /**
   * Every cap's distance to the target line, live.
   *
   * The one thing about this mode that cannot be checked by looking at the
   * board: two caps a centimetre apart decide a round, and which of them is
   * nearer is not something the eye can resolve at this zoom — that is the whole
   * reason the marks are drawn on the table at all. This is the same number the
   * judge uses, read straight off the rules, so a disagreement between what the
   * game awarded and what this says is a bug in one place rather than two.
   *
   * Live rather than the settled marks: it answers "where is everything right
   * now", including mid-slide, which is what you want while dragging friction.
   */
  const marksRow = curl.add(curlStats, 'marks').name('목표 라인까지 거리 (실시간)').disable();
  /** The round bookkeeping, so the alternation can be watched rather than assumed. */
  const roundRow = curl.add(curlStats, 'round').name('라운드 / 선공 / 승수').disable();

  const refreshCurling = () => {
    const rules = match.rules;
    const m = match.arena.layout?.metrics;
    if (!m || match.arena.layout.describe?.().kind !== 'table') {
      curlStats.table = '—';
      curlStats.marks = '—';
      curlStats.round = '—';
    } else {
      curlStats.table =
        `${m.width.toFixed(1)} x ${m.length.toFixed(1)}  ·  ` +
        `폭 ${m.widthCaps.toFixed(1)}뚜껑 (⌀${m.cap.toFixed(2)})  ·  ` +
        `1:${m.ratio.toFixed(2)}  ·  던지는 거리 ${m.run.toFixed(1)}`;

      const live = rules.standings?.() ?? [];
      curlStats.marks = live.length
        ? live.map((e) => `P${e.player + 1}#${e.cap} ${e.distance.toFixed(2)}`).join('  ·  ')
        : '책상 위에 없음';

      const total = rules.rounds ?? 0;
      const now = Math.min((rules.round ?? 0) + 1, total);
      const lead = rules.leadFor?.(Math.min(rules.round ?? 0, total - 1)) ?? 0;
      curlStats.round =
        `${now}/${total}R  ·  이번 선공 P${lead + 1}  ·  ` +
        `승수 ${rules.wins?.[0] ?? 0} : ${rules.wins?.[1] ?? 0}` +
        `${rules.draws ? `  ·  무승부 ${rules.draws}R` : ''}` +
        `${rules.closest ? `  ·  최근접 P${rules.closest.player + 1} ${rules.closest.distance.toFixed(2)}` : ''}`;
    }
    tableRow.updateDisplay();
    marksRow.updateDisplay();
    roundRow.updateDisplay();
  };

  // ── the table ────────────────────────────────────────────────────────────
  /**
   * The width, in CAP DIAMETERS, and it is the cap-size control as well.
   *
   * The brief asks for a width, a length and a cap size. There are only two
   * degrees of freedom here and this row is one of them: the camera frames the
   * table's own extents, so the table is always the same size on screen and the
   * only thing a cap-size slider could change is how much of it one cap covers —
   * which is exactly what this changes. A real cap slider would also have to
   * move `CAP_DEFAULTS`, which is shared by the survival board and the football
   * team, and "다른 모드 건드리지 마라" rules that out. See `curlingTableMetrics`.
   *
   * The brief's starting band was 6 to 8 and playing it moved the default to
   * 10.5 — see the note in `config.js`. The slider goes well past both ends of
   * that so the two failure modes stay visible: at 5 the opponent's cap is
   * unmissable, at 18 it is unhittable and the far line is out of reach at full
   * draw. The readout above says what each end costs in world units, and the
   * friction row below is what has to move with it.
   */
  curl.add(config.curling, 'widthCaps', 5, 18, 0.25).name('책상 폭 (뚜껑 지름 배수)').onChange(rebuild);
  // Length. The brief's band is 2 to 2.5; it goes to 3.5 so the point at which
  // the far line stops being reachable can be found rather than guessed at.
  curl.add(config.curling, 'ratio', 1.2, 3.5, 0.05).name('책상 길이 (폭 배수)').onChange(rebuild);
  curl
    .add(config.curling, 'throwFromEdge', 1, 20, 0.5)
    .name('발사 지점 (앞 가장자리에서)')
    .onChange(rebuild);
  curl.add(config.curling, 'throwClearance', 0, 4, 0.1).name('발사 지점 여유 간격');
  // The fall itself. The slope is thickness / run, and it has to stay steeper
  // than the friction angle or a cap can come to rest hanging over the edge —
  // drag the run out past 6 and watch caps start balancing on the rim instead of
  // going over it.
  curl.add(config.curling, 'tableThickness', 0.4, 4, 0.1).name('책상 두께').onChange(rebuild);
  curl.add(config.curling, 'slopeRun', 0.4, 6, 0.1).name('가장자리 경사 길이').onChange(rebuild);

  // ── the match ────────────────────────────────────────────────────────────
  // Structural: the number of rounds IS the number of caps each player gets, so
  // changing it rebuilds the world. One throw each per round, always.
  curl.add(config.curling, 'rounds', 1, 8, 1).name('라운드 수').onChange(rebuild);
  curl
    .add(config.curling, 'firstLead', { 'P1 선공': 'p1', 'P2 선공': 'p2', '시드 랜덤': 'random' })
    .name('1R 선공')
    .onChange(rebuild);
  // Only read when the row above is on 시드 랜덤. Rebuilds, because the draw is
  // taken once when the rule set is created.
  curl.add(config.curling, 'leadSeed', 0, 0xffff, 1).name('선공 시드').onChange(rebuild);

  // ── materials ────────────────────────────────────────────────────────────
  // The number the cap actually gets: the table combines friction by `Min`
  // against the cap's own 0.34, so this slider is not averaged with anything.
  // It is the mode's single most important value — drag it up and nothing
  // reaches the line, drag it down and everything goes over it.
  curl
    .add(config.curling, 'tableFriction', 0.02, 0.6, 0.005)
    .name('표면 마찰 (컬링 전용)')
    .onChange(retune);
  curl
    .add(config.curling, 'tableRestitution', 0, 0.5, 0.01)
    .name('표면 반발계수 (컬링 전용)')
    .onChange(retune);

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
  // Curling's own range. A 1:2.2 table frames unlike a square board and unlike a
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
  // Bounded at 1 from below because 1 IS the whole-table fit, and "최소 줌에서
  // 책상 전체가 보인다" is a completion criterion — anything above 1 here breaks
  // it, which is why the row says what 1 means rather than leaving it a number.
  curlZoom
    .add(config.view, 'curlingMinZoom', 1, 3, 0.05)
    .name('최소 줌 (1 = 책상 전체)')
    .onChange(applyZoom);
  curlZoom.add(config.view, 'curlingMaxZoom', 1.5, 8, 0.1).name('최대 줌').onChange(applyZoom);
  curlZoom.add(config.view, 'curlingTurnZoom', 1, 4, 0.05).name('턴 시작 줌').onChange(applyZoom);

  curl.add(config.view, 'curlingGuides').name('목표 라인 / 낙하 판정 와이어프레임');

  /**
   * Move the round on without playing it out.
   *
   * Not a shortcut around the turn loop: it goes through the same two doors a
   * player does. While a turn is LIVE it stops the world, which trips the settle
   * detector's rest branch on the next steps and ends the turn exactly as coming
   * to a halt would; while a turn is open it fires a real shot down the middle
   * at a fixed power. So the verdict, the judging, the sweep and the replay
   * record are all produced by the ordinary path and are worth the same as a
   * played round's.
   *
   * The shot's seed comes from `nextSeed()`, which is the same counter every
   * other unpinned shot in the project draws from — so a session driven by this
   * button is still reproducible from the reset button.
   *
   * Two presses is one round, because a round is two throws.
   */
  curl
    .add(
      {
        step: () => {
          if (match.state === MATCH_STATE.LIVE) {
            match.arena.freezeAll();
            return;
          }
          const cap = match.shooter;
          if (cap < 0) return;
          // Straight up the table at three-quarter draw: hard enough to arrive,
          // short of the power that puts a cap over the far edge every time.
          match.fire({ capIndex: cap, dirX: 0, dirZ: 1, power: 0.75, seed: nextSeed() });
          refresh();
        },
      },
      'step',
    )
    .name('▶ 라운드 강제 진행 (1투)');

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

  /**
   * 그래픽 품질 티어. 성능 측정을 하려면 여기서 왕복시켜야 한다.
   *
   * 드롭다운이지 슬라이더가 아니다 — 설정 화면의 칩 줄과 달리 여기서 중요한
   * 것은 "다음 칸" 이 아니라 "저 칸으로" 이고, 다섯 개를 이름으로 보는 편이
   * 측정 중에 어디 있는지 헷갈리지 않는다.
   *
   * 아래 읽기 줄들은 티어가 실제로 무엇으로 풀렸는지를 보여 준다. 표를 고쳤을 때
   * 그 값이 정말 파이프라인에 도착했는지를 확인할 곳이 필요하고, 그게 없으면
   * "표는 고쳤는데 화면이 안 바뀐다" 를 코드를 읽어서 판단하게 된다.
   */
  const qualityFolder = look.addFolder('그래픽 품질');
  const qualityProxy = {
    get tier() {
      return TIER_NAMES[QUALITY.tier];
    },
    set tier(name) {
      const next = TIER_NAMES.indexOf(name);
      if (next >= 0) graphicsSettings?.setTier(next);
    },
  };
  const qualityStats = { resolved: '', casters: '' };
  const qualityRow = qualityFolder.add(qualityProxy, 'tier', [...TIER_NAMES]).name('티어');
  const qualityResolvedRow = qualityFolder.add(qualityStats, 'resolved').name('해상도 · MSAA · 그림자').disable();
  const qualityCasterRow = qualityFolder.add(qualityStats, 'casters').name('블룸 · 환경 · 캐스터 · 텍스처').disable();
  if (!graphicsSettings) qualityRow.disable();
  qualityFolder
    .add(
      {
        forget: () => {
          // `reset` 은 저장 키를 지운다 — 기본값을 다시 쓰는 것이 아니라 이 기기가
          // 설정을 가진 적 없게 만드는 것이다. 자동 강등을 다시 시험할 유일한 방법.
          graphicsSettings?.reset();
        },
      },
      'forget',
    )
    .name('저장 잊기 (자동 강등 재시험)');

  function refreshQuality() {
    qualityStats.resolved =
      `x${QUALITY.pixelRatioCap}  ·  MSAA ${QUALITY.msaaSamples}  ·  ` +
      `그림자 ${QUALITY.shadowMapSize || '끔'}`;
    qualityStats.casters =
      `블룸 ${QUALITY.bloom ? QUALITY.bloomScale : '끔'}  ·  환경 ${QUALITY.envSize || '없음'}  ·  ` +
      `캐스터 ${QUALITY.shadowCasters}  ·  ${QUALITY.worldTexture}px`;
    qualityRow.updateDisplay();
    qualityResolvedRow.updateDisplay();
    qualityCasterRow.updateDisplay();
  }
  refreshQuality();
  onQualityChange(refreshQuality);

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
  /**
   * The camera reset, and the one control the flight takes away.
   *
   * "카메라 리셋 버튼: 발사 도중 비활성. 흐리게 표시하거나 반응하지 않게 처리."
   * `.disable()` is lil-gui's own greying, which is the same treatment every
   * read-only row in this panel already wears — so an unavailable control looks
   * unavailable here in exactly the way it does everywhere else, and it stops
   * taking the press as well as stops inviting it. Re-enabled by `refreshCamera`
   * the frame the turn ends; see there.
   *
   * It is a real reset and not a cosmetic one, which is why it cannot be left
   * live: it writes the bearing straight to zero, and doing that in the middle
   * of a tracked throw would spin the field under a camera that is mid-follow.
   */
  const centreRow = cam
    .add(
      { centre: () => { config.view.azimuth = 0; camera.stopSpin(); camera.apply(); } },
      'centre',
    )
    .name('↺ 회전각 0으로');
  cam.open();

  /**
   * ── riding the thrown cap ────────────────────────────────────────────────
   * Its own folder rather than more rows on `카메라 조작`, because everything
   * above is about what the HAND does to the view and everything here is about
   * what the view does on its own while nobody is touching it. They are tuned in
   * different sittings and against different things.
   *
   * A subfolder of the camera controls all the same — it is still the camera —
   * which is the arrangement `줌 범위 (컬링 전용)` already uses inside the
   * curling folder.
   */
  const follow = cam.addFolder('발사 추적 (서바이벌 · 컬링)');
  // The master switch. Off gives the fixed view the two modes had before, with
  // the fall snap and the hand-back off with it.
  /**
   * 개발자 쪽 스위치다. 플레이어에게는 설정 화면의 "카메라 추적" 이 있고, 그쪽은
   * `core/ViewSettings.js` 에 저장된다 — 여기서 끈 것은 이 세션에만 남는다.
   */
  follow.add(config.view, 'track').name('발사 뚜껑 추적 (설정 화면에도 있음)');
  /**
   * The spring, and the pair that decides whether this is watchable.
   *
   * Critical damping is 2*sqrt(stiffness) — 19.0 at the default 90 — and the
   * default damping sits just above it. Below that line the camera overshoots
   * the cap and swings back, which at this resolution reads as the board
   * wobbling rather than as the camera settling. Above about 160 the follow
   * stops improving and only the jerk goes up; see the note in `config.view`.
   */
  follow.add(config.view, 'trackStiffness', 5, 400, 1).name('스프링 강성 (k)');
  follow.add(config.view, 'trackDamping', 1, 45, 0.5).name('스프링 감쇠 (c)');
  // A duration, not a rate: the cut onto a fallen cap takes the same time
  // whatever distance it covers. Under ~0.15 it reads as a hard cut.
  follow.add(config.view, 'trackFallSnapSec', 0.05, 0.8, 0.01).name('낙사 스냅 전환 (s)');
  // Only ever used on a turn that ended without the seat changing — an AI or
  // online opponent, or today an extra-turn card. A local handover is put back
  // by the turn-over reset and never reaches this.
  follow.add(config.view, 'trackReturnSec', 0.1, 1.2, 0.01).name('턴 종료 후 복귀 (s)');
  // How far inside the frame's edge the curling target line is kept — and, by
  // the same number, the cap. Nothing at all at the opening zoom, where the
  // whole table is already on screen.
  follow.add(config.view, 'trackLineInset', 0, 24, 0.5).name('컬링 목표 라인 여유 (거리)');
  // The two trails on the board: where it aimed, where it looked. The GAP is
  // the spring, and it is the only way to see whether the pair above is right.
  follow.add(config.view, 'trackPath').name('추적 경로 표시');
  /**
   * What it is following, live.
   *
   * Ticked per frame with the camera rather than on the 400 ms poll, for the
   * reason the goal hold is: a fall snap is a quarter of a second start to
   * finish and a slow poll would miss the whole of it.
   */
  const trackRow = follow.add(trackStats, 'line').name('현재 추적 대상').disable();
  follow.open();
  look
    .add(config.view, 'wireframe')
    .name('와이어프레임')
    .onChange((v) => view.setWireframe(v));
  look.add(config.view, 'slowmo', 0.05, 2, 0.05).name('물리 슬로모션');

  /**
   * Bloom, live.
   *
   * The three that matter and no more. All of them move the world's look
   * substantially and none of them reaches the simulation — the chain runs after
   * the step, on whatever the frame produced.
   *
   * `threshold` is the one to reach for first: it decides WHAT glows, and every
   * complaint about bloom is really a complaint about the threshold being low
   * enough to catch a diffuse surface.
   */
  const bloom = look.addFolder('블룸');
  bloom.add(config.view.bloom, 'enabled').name('켜기').onChange(applyBloom);
  bloom.add(config.view.bloom, 'threshold', 0, 1.5, 0.01).name('임계값').onChange(applyBloom);
  bloom.add(config.view.bloom, 'strength', 0, 1.5, 0.01).name('세기').onChange(applyBloom);
  bloom.add(config.view.bloom, 'radius', 0, 1.5, 0.01).name('반경').onChange(applyBloom);
  function applyBloom() {
    composer?.configure(config.view.bloom);
  }

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
  // `cards.vertexSnap` 의 슬라이더가 여기 있었다. 카드의 정점 스냅은 `CardMaterial`
  // 에서 사라졌고 — 저해상도 타겟도 nearest 확대도 양자화도 없으므로 카드만 격자에
  // 물릴 이유가 없다 — 그래서 아무것도 읽지 않는 값이 남았다. 키 자체는 지울 수
  // 없다: `cards` 는 `SYNCED_CONFIG_PATHS` 안이라 키를 빼면 `configHash` 가 바뀐다.
  // 슬라이더는 지운다. 움직여도 화면이 변하지 않는 슬라이더는 패널에 대한 거짓말이다.
  hand.add(config.cards, 'greyStrength', 0, 1, 0.01).name('흑백 처리 강도');
  hand.add(config.cards, 'shadowOffsetX', -12, 12, 1).name('그림자 오프셋 X');
  hand.add(config.cards, 'shadowOffsetY', -12, 12, 1).name('그림자 오프셋 Y');
  hand.add(config.cards, 'shadowOpacity', 0, 1, 0.01).name('그림자 농도');
  // 흐림 반경은 `cardFx` 다 — `cards` 에 키를 더할 수 없기 때문. 슬라이더는
  // 나머지 세 개 옆에 있어야 셋이 한 물건이라는 것이 보인다.
  hand.add(config.cards, 'hitMargin', 0, 40, 1).name('레이캐스트 여유 (px)');
  hand.add(config.cards, 'showHitAreas').name('레이캐스트 히트 영역 표시');
  hand.add(config.cards, 'blockedGrey', 0, 1, 0.01).name('사용 불가 흑백');
  hand.add(config.cards, 'blockedBrightness', 0.2, 1, 0.01).name('사용 불가 밝기');
  hand.add(config.cards, 'refuseShakeAmount', 0, 30, 1).name('거절 흔들림 (px)');
  hand.add(config.cards, 'refuseShakeSeconds', 0.05, 1, 0.01).name('거절 흔들림 시간 (s)');

  // The drop guide. No position dial, and that is deliberate: it is placed from
  // `useLiftFactor` and the card's own resting height, so dragging the threshold
  // above moves the slot with it. A separate position would be a second answer
  // to a question the rule already answers.
  hand.add(config.cards, 'showUseGuide').name('사용 가이드 표시');
  hand.add(config.cards, 'guideMargin', 0, 40, 1).name('가이드 여백 (px)');
  hand.add(config.cards, 'guideOpacity', 0, 1, 0.01).name('가이드 농도 (도달 전)');
  hand.add(config.cards, 'guideArmedOpacity', 0, 1, 0.01).name('가이드 농도 (임계 통과)');
  hand.add(config.cards, 'guideArmedGrow', 0, 0.4, 0.01).name('가이드 확대 (임계 통과)');
  // 무장 확인. 프레임으로 세는 이유는 `cardFx.guideBurstFrames` 의 주석에 있다.
  hand.add(config.cardFx, 'guideBurstFrames', 0, 20, 1).name('가이드 확인 링 (프레임)');
  hand.add(config.cardFx, 'guideBurstGrow', 0, 0.8, 0.02).name('가이드 확인 링 확대');

  /**
   * 카드 면의 노브.
   *
   * `cards` 가 아니라 `cardFx` 에 있다 — 저쪽은 `SYNCED_CONFIG_PATHS` 안이라
   * 키를 더하면 `configHash` 가 바뀌고 구버전과 매칭이 거절된다. 슬라이더가
   * 손패 폴더 안에 있는 것과 값이 어느 블록에 있는지는 별개다.
   */
  const cardLook = hand.addFolder('카드 면 (그리기 전용)');
  cardLook.add(config.cardFx, 'holoStrength', 0, 1.5, 0.01).name('테두리 홀로그램 세기');
  cardLook.add(config.cardFx, 'holoBackStrength', 0, 1, 0.01).name('홀로그램 세기 (뒷면)');
  cardLook.add(config.cardFx, 'holoArmedBoost', 1, 4, 0.05).name('홀로그램 배수 (무장)');
  cardLook.add(config.cardFx, 'holoScale', 0.005, 0.2, 0.005).name('홀로그램 띠 간격');
  cardLook.add(config.cardFx, 'holoSaturation', 0, 1, 0.01).name('홀로그램 채도');
  cardLook.add(config.cardFx, 'holoRimWidth', 0.01, 0.2, 0.005).name('홀로그램 테두리 폭');
  cardLook.add(config.cardFx, 'holoDriftPerSecond', 0, 4, 0.05).name('홀로그램 드리프트 (rad/s)');
  cardLook.add(config.cardFx, 'shadowBlur', 0, 40, 1).name('그림자 흐림 반경 (px)');

  const landLook = hand.addFolder('뽑기 착지');
  landLook.add(config.cardFx, 'landFlipSeconds', 0.05, 1, 0.01).name('착지 뒤집기 시간 (s)');
  landLook.add(config.cardFx, 'landPushAmount', 0, 120, 2).name('이웃 밀림 세기');
  landLook.add(config.cardFx, 'landGlowFrames', 0, 30, 1).name('도착 빛 (프레임)');

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
    /**
     * Who is sealed, by whom, and for how much longer.
     *
     * All three, because any two of them are ambiguous: "침묵 → P2" does not say
     * whether P2 can answer it (they cannot if P1 cast it — 침묵 is refused to a
     * sealed player), and a victim with no count does not say whether the next
     * turn end will clear it. Same shape as the 혼란 line above, which is also a
     * per-victim slot and is read the same way.
     */
    const silenced = [0, 1]
      .filter((v) => c.silencedOn(v))
      .map((v) => `P${v + 1}←P${c.silence[v].by + 1} ${c.silenceTurnsLeft(v)}턴`);
    bits.push(silenced.length ? `침묵 ${silenced.join(' / ')}` : '침묵 —');
    /**
     * Who is braced, and what the WORLD actually did about it.
     *
     * Two facts rather than one, because under §2-A they are legitimately
     * different: the card is armed from the moment it is played and the mass is
     * only applied for the opponent's turn, so "철벽 P1" alone cannot answer the
     * question this readout exists for — whether the cap in front of you is
     * heavy right now. `capMassMul` asks the body, so the ×배율 shown is the one
     * the solver is using and not the one the card intends.
     */
    const braced = [0, 1]
      .filter((v) => c.resistOn(v))
      .map((v) => {
        const caps = match.arena.capOwner
          .map((o, i) => (o === v ? i : -1))
          .filter((i) => i >= 0);
        const live = caps.some((i) => match.arena.capMassMul(i) > 1);
        return `P${v + 1}${live ? ` ×${c.massMulFor(v).toFixed(2)}` : ' 대기'}`;
      });
    bits.push(braced.length ? `철벽 ${braced.join(' / ')}` : '철벽 —');
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
  // Whole turns, from 1. Read at the CAST, so dragging this never changes a
  // lockout somebody is already inside — see `CardEffects.play`.
  fx.add(config.cards, 'silenceTurns', 1, 5, 1).name('침묵 지속 턴 수').onChange(refreshCards);
  fx.add(config.cards, 'silenceReleaseSeconds', 0.05, 1.5, 0.05).name('침묵 해제 전환 (s)');

  // Per card, because they are different lengths of statement: a swap has two
  // ends to read and a one-more has none.
  const lengths = fx.addFolder('연출 길이 (s)');
  for (const [id, label] of [
    ['swap', '스왑'],
    ['trajectory', '궤적'],
    ['chaos', '혼란'],
    ['onemore', '원모어'],
    ['smash', '강타'],
    ['resist', '철벽'],
    ['silence', '침묵'],
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
    ['silence', '침묵'],
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
    ['resist', '철벽'],
    ['silence', '침묵'],
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

  /**
   * 침묵, in a stated direction. The one card whose force button needs two.
   *
   * ── why the other five get away with one ────────────────────────────────────
   * Every other card acts for whoever is on turn, so `playCard` — which is
   * `currentPlayer`'s by definition — is the whole of forcing one. 침묵 is about
   * a PAIR, and the thing worth testing is the victim's turn: the greyed hand,
   * the padlock, the refusal, the release. Waiting for the turn to come round
   * before you can arm the state you want to look at is most of the reason a
   * force button exists.
   *
   * So when the caster is on turn this is the real path, effect and hand-spend
   * and all. When they are not, the state is armed directly and the effect is
   * replayed on top of it — the same picture, without pretending it was a legal
   * play by somebody whose turn it is not.
   */
  const forceSilence = fx.addFolder('침묵 강제 발동');
  for (const by of [0, 1]) {
    forceSilence
      .add(
        {
          go: () => {
            if (match.rules.currentPlayer === by) {
              const r = match.playCard('silence');
              if (!r.ok) console.warn(`[card] silence: ${r.reason}`);
            } else {
              // Straight into the effect state. The seed is unused by this card
              // — nothing about a seal is random — so there is no sequence here
              // for a forced cast to pull out from under a replay.
              match.cards.play('silence', by, 0);
              cardFx?.play('silence', by, config.cards.fxSeconds.silence);
            }
            refreshCards();
          },
        },
        'go',
      )
      .name(`▶ P${by + 1} → P${2 - by}`);
  }
  // The seal has no other way off the board: it is spent by the victim's own
  // turn ending, which is a long way to go to re-test the arming.
  forceSilence
    .add(
      {
        go: () => {
          match.cards.silence = [null, null];
          refreshCards();
        },
      },
      'go',
    )
    .name('■ 침묵 즉시 해제');

  // ── how the effects are drawn ────────────────────────────────────────────
  const fxLook = fx.addFolder('연출 (그리기)');
  // `cardFx.vertexSnap` 의 슬라이더가 여기 있었다. `cards.vertexSnap` 과 같은
  // 이유로 아무것도 읽지 않았는데, 이쪽은 키까지 지웠다 — `cardFx` 는
  // `SYNCED_CONFIG_PATHS` 밖이라 `configHash` 를 건드리지 않는다.
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
  smashLook.add(config.cardFx, 'smashFlashFrames', 0, 6, 1).name('섬광 (프레임)');
  smashLook.add(config.cardFx, 'smashFlashStrength', 0, 1, 0.01).name('섬광 세기');
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

  // ── 침묵 ────────────────────────────────────────────────────────────────
  // Its own folder for the reason 강타 has one, and the two halves are the same
  // two: the half-second the seal lands in, and the turn the padlock then sits
  // there for. Every length below is in FRAME PIXELS — this card is drawn in the
  // card scene's fixed 640x480 box and never touches the world.
  const sealLook = fxLook.addFolder('침묵');
  // No cache clear on this one, unlike the stun pair above. Each size is its own
  // cache key and the lock is re-fetched every frame, so a new value simply
  // draws a new texture — and clearing would take every OTHER effect's texture
  // with it for no reason.
  sealLook.add(config.cardFx, 'sealLockTexels', 8, 48, 4).name('자물쇠 텍스처 해상도');
  // The cast, which is the flash and nothing else.
  sealLook.add(config.cardFx, 'sealDarkenFrames', 0, 6, 1).name('어두운 플래시 (프레임)');
  sealLook.add(config.cardFx, 'sealDarkenStrength', 0, 1, 0.01).name('어두운 플래시 강도');
  // And the arrival, which happens on the VICTIM's turn rather than the cast.
  sealLook.add(config.cardFx, 'sealStampStart', 1, 8, 0.1).name('봉인 찍힘 시작 크기 (배)');
  sealLook.add(config.cardFx, 'sealStampSteps', 1, 8, 1).name('봉인 찍힘 단계 수');
  sealLook.add(config.cardFx, 'sealStampSeconds', 0.05, 1, 0.01).name('봉인 찍힘 시간 (s)');
  // Size and place of the padlock. The one marker the sealed player reads on
  // their own turn, so it is worth being able to move it off whatever it
  // happens to collide with on a given board.
  sealLook.add(config.cardFx, 'sealIconSize', 6, 64, 1).name('봉인 아이콘 크기 (px)');
  sealLook.add(config.cardFx, 'sealIconX', 0, 300, 2).name('봉인 아이콘 X (중앙 기준)');
  sealLook.add(config.cardFx, 'sealIconY', 0, 240, 2).name('봉인 아이콘 Y (아래쪽 기준)');
  sealLook.add(config.cardFx, 'sealPaletteCyclesPerSecond', 0, 6, 0.1).name('봉인 팔레트 순환 속도');

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
            //
            // The live scoreboard goes with it, so the number in the band is a
            // real one rather than a blank: what is judged here has to be what
            // ships, and the band is half of what ships.
            victory?.begin(index, {
              forced: true,
              board: scoreboardFor(match.mode, match.rules, config),
            });
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

  /**
   * Per stage, because they are four different lengths of statement.
   *
   * The freeze is WATCHED — it is the replay, and the camera is moving through
   * it — so it is the long one. The result is READ. The two bar movements are
   * the frame arriving and leaving and want to be quick.
   */
  const winLen = win.addFolder('단계별 길이');
  winLen.add(config.victory, 'freezeSeconds', 0.2, 3, 0.05).name('1 정지 · 카메라 (s)');
  winLen.add(config.victory, 'barSeconds', 0.1, 1.5, 0.02).name('2 레터박스 닫힘 (s)');
  winLen.add(config.victory, 'resultSeconds', 0.2, 2.5, 0.05).name('3 결과 (s)');
  winLen.add(config.victory, 'releaseSeconds', 0.1, 1.5, 0.02).name('4 바 물러남 · 버튼 (s)');
  winLen.open();

  /**
   * The push-in, and what it is pushing in ON.
   *
   * The zoom is a multiplier on wherever the match ended, so the readout below
   * is derived rather than absolute — there is no single number to show, and a
   * fixed one would be a lie on any board the player had already zoomed.
   */
  const winCam = win.addFolder('카메라 밀어넣기');
  const winZoom = { line: '' };
  const winZoomRow = winCam.add(winZoom, 'line').name('줌 (현재 → 목표, 파생)').disable();
  const refreshWinZoom = () => {
    const now = camera?.zoom ?? 1;
    winZoom.line = `${now.toFixed(2)} → ${(now * config.victory.pushZoom).toFixed(2)}`;
    winZoomRow.updateDisplay();
  };
  refreshWinZoom();
  winCam.add(config.victory, 'pushZoom', 1, 2.5, 0.01).name('밀어넣기 배수').onChange(refreshWinZoom);
  winCam
    .add(config.victory, 'sparkleSeconds', 0, 2, 0.05)
    .name('승자 반짝임 (s) — CardFx 원모어');
  winCam.open();

  /**
   * The result band.
   *
   * `textY` and `scoreY` are clamped into the letterbox band by `layout()`, so
   * dragging one past the bars moves it until it touches and then stops. That
   * is the constraint doing its job rather than the slider being broken — see
   * the note on the band in `VictoryLayer.layout`.
   */
  const winRelayout = () => victory?.layout();
  const winLook = win.addFolder('결과 화면');
  winLook.add(config.victory, 'bgOpacity', 0, 1, 0.01).name('배경 어둡기');
  winLook.add(config.victory, 'bgFadeSeconds', 0.02, 1.5, 0.01).name('배경 페이드 (s)');
  winLook.add(config.victory, 'bubbleCount', 0, 90, 1).name('기포 개수').onChange(() => {
    victory?.fizz.build(config.victory.bubbleCount, victory.scene);
  });
  winLook.add(config.victory, 'bubbleStrength', 0, 2, 0.05).name('기포 밝기');
  winLook.add(config.victory, 'textY', -200, 200, 2).name('승자 줄 Y').onChange(winRelayout);
  winLook.add(config.victory, 'scoreY', -200, 200, 2).name('점수판 Y').onChange(winRelayout);
  winLook.add(config.victory, 'buttonY', -240, 200, 2).name('버튼 Y').onChange(winRelayout);
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

  /**
   * ── the sound folder ─────────────────────────────────────────────────────
   * Built by `audio/audioDebug.js` so this panel and the menu's are the same
   * folder rather than two copies that drift. Everything in it edits
   * `config.audio` and `soundBank`, so turning the panel off changes nothing
   * about what the game sounds like — the numbers are the same numbers.
   */
  const audioPanel = audio
    ? addAudioFolder(gui, { audio, config: config.audio, settings: audioSettings })
    : null;

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
          /**
           * And the audio graph, for exactly the same reason as the two above.
           * A `WaveShaper` curve is built from the bit depth when the bit depth
           * CHANGES; restoring the number without re-applying it leaves the old
           * curve in the chain forever, and the panel would report a default
           * the game is not running at.
           */
          audio?.applyConfig();
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

  // `ui.vertexSnap` 의 슬라이더도 같이 나갔다. 셋 중 키가 남은 것은 `cards` 뿐이다.
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

  /**
   * ── AI ─────────────────────────────────────────────────────────────────────
   *
   * Everything the opponent does, and everything needed to find out why it did
   * it. The readouts matter as much as the sliders here: a search that evaluates
   * dozens of exact rollouts and keeps one answer is otherwise a black box, and
   * "the AI played a strange move" is not a reproducible bug report without the
   * runners-up and the score that beat them.
   *
   * Built unconditionally, like the rest of this panel. A match against a person
   * simply has an AI folder whose readouts say nothing, which is cheaper than a
   * conditional that would have to be re-evaluated on every opponent switch.
   */
  const ai = gui.addFolder('AI 상대');
  const aiCfg = config.ai;

  // Same distinction: a seat driven over the network is not the AI override's
  // business, and offering to swap it for a computer mid-match would desync it.
  const opponent = { kind: controllers?.[1]?.planner ? 'ai' : 'human' };
  ai.add(opponent, 'kind', { 플레이어: 'human', AI: 'ai' })
    .name('상대 타입')
    .onChange((v) => setOpponent?.(v));

  const aiStats = { think: '—', chose: '—', cards: '—' };
  // Per-frame like the camera row, not on the 400 ms poll: a search finishes
  // inside half a second and a slow poll would miss it entirely.
  const thinkRow = ai.add(aiStats, 'think').name('계산 (ms / 후보)').disable();
  const choseRow = ai.add(aiStats, 'chose').name('선택한 수').disable();
  const cardRow = ai.add(aiStats, 'cards').name('카드 판단').disable();

  const aiSampling = ai.addFolder('후보 샘플링');
  aiSampling.add(aiCfg.sampling, 'maxShooters', 1, 8, 1).name('뚜껑 개수 상한');
  aiSampling.add(aiCfg.sampling, 'anglesPerTarget', 1, 9, 2).name('표적당 각도 수');
  aiSampling.add(aiCfg.sampling, 'angleSpreadDeg', 0, 40, 0.5).name('각도 폭 (°)');
  aiSampling.add(aiCfg.sampling, 'powerSteps', 1, 10, 1).name('세기 단계');
  /**
   * The one that actually costs time, and the one that must stay a COUNT.
   *
   * At the measured 14.5 ms a rollout this is the whole compute budget. It is a
   * count rather than a millisecond deadline because a deadline made the AI pick
   * a different move on two identical runs — see the header in `ai/AiPlanner.js`.
   */
  aiSampling.add(aiCfg.sampling, 'maxCandidates', 4, 200, 1).name('평가 후보 수 (=예산)');
  aiSampling.add(aiCfg, 'frameBudgetMs', 1, 16, 0.5).name('프레임당 상한 (ms)');
  aiSampling.add(aiCfg, 'stepChunk', 4, 120, 1).name('중단 단위 (물리 스텝)');
  aiSampling.add(aiCfg, 'maxRolloutSteps', 60, 960, 10).name('시뮬 최대 길이 (스텝)');
  /**
   * The second ply. `replyCandidates` at 0 makes the search one-ply again,
   * which is the setting to reach for if a slow device cannot afford it.
   */
  aiSampling.add(aiCfg, 'replyPool', 0, 12, 1).name('상대 응수 검토 후보 수');
  aiSampling.add(aiCfg, 'replyCandidates', 0, 24, 1).name('응수 후보 수 (0=1수만)');
  aiSampling.add(aiCfg, 'replyWeight', 0, 1.5, 0.05).name('응수 반영 비중');
  // The cone probe — 0 turns it off and gives back the old, spread-blind ranking
  // where a forty-unit full charge rates as safely as a tap. These replace the
  // `robustness*` pair, which were bound to a value no code read.
  aiSampling.add(aiCfg, 'spreadProbes', 0, 4, 1).name('콘 가장자리 검증 (0=오차 무시)');
  aiSampling.add(aiCfg, 'spreadPool', 1, 24, 1).name('콘 검증 후보 수');
  aiSampling.add(aiCfg, 'totalBudgetMs', 200, 8000, 50).name('전체 상한 (ms, 안전밸브)');

  const aiWeights = ai.addFolder('평가 가중치');
  aiWeights.add(aiCfg.weights, 'dropOpponent', 0, 400, 1).name('상대 낙사 (+)');
  aiWeights.add(aiCfg.weights, 'loseOwn', 0, 400, 1).name('자책 낙사 (−)');
  aiWeights.add(aiCfg.weights, 'edgeRisk', 0, 200, 1).name('내 뚜껑 가장자리 (−)');
  aiWeights.add(aiCfg.weights, 'selfThreat', 0, 300, 1).name('내 뚜껑 피격 위험 (−)');
  aiWeights.add(aiCfg.weights, 'foeEdge', 0, 200, 1).name('상대 가장자리로 밀기 (+)');
  aiWeights.add(aiCfg.weights, 'foeThreat', 0, 300, 1).name('상대 조준 확보 (+)');
  aiWeights.add(aiCfg.weights, 'centre', 0, 100, 1).name('중앙 이동 (+, 동점 처리용)');
  aiWeights.add(aiCfg.weights, 'orbGain', 0, 200, 1).name('오브 획득 (+)');
  aiWeights.add(aiCfg.weights, 'orbGift', 0, 200, 1).name('오브 헌납 (−)');
  aiWeights.add(aiCfg.weights, 'clump', 0, 100, 1).name('아군 뭉침 (−)');
  aiWeights.add(aiCfg.weights, 'clumpRadiusCaps', 0, 5, 0.1).name('뭉침 판정 (뚜껑 지름)');
  // The geometry the two threat terms are measured with — see `config.ai.threat`.
  aiWeights.add(aiCfg.threat, 'reach', 4, 60, 1).name('위협 사거리 (단위)');
  aiWeights.add(aiCfg.threat, 'pushDistance', 2, 40, 1).name('피격 시 밀리는 거리 (단위)');

  /**
   * Football's overrides, which are a different set of numbers entirely.
   *
   * ── a value with no dial is as bad as a dial with no value ────────────────
   * `config.ai.perMode.football` exists because a goal and a dropped cap are not
   * measured in the same units, so the two modes cannot share one weights block
   * — see `ai/strategy.js: aiTuning`. That reasoning would be worth very little
   * if the football numbers were then the only ones in the project that could
   * not be dragged while playing, which is the whole point of this panel.
   *
   * The common folder above still tunes knockout, and it still tunes every
   * football value that is NOT overridden here. Nothing is duplicated: these are
   * bound to the override objects themselves.
   */
  const fb = aiCfg.perMode?.football;
  if (fb) {
    const aiFootball = ai.addFolder('축구 전용 평가');
    aiFootball.add(fb.sampling, 'maxCandidates', 4, 240, 1).name('평가 후보 수 (=예산)');
    aiFootball.add(fb.sampling, 'maxShooters', 1, 4, 1).name('사용할 뚜껑 수');
    aiFootball.add(fb.sampling, 'angleSpreadDeg', 0, 30, 0.5).name('부채꼴 폭 (°)');
    aiFootball.add(fb, 'maxRolloutSteps', 60, 960, 10).name('시뮬 최대 길이 (스텝)');
    aiFootball.add(fb.weights, 'goal', 0, 6000, 10).name('득점 (+)');
    aiFootball.add(fb.weights, 'ownGoal', 0, 6000, 10).name('자책골 (−)');
    aiFootball.add(fb.weights, 'ballAdvance', 0, 60, 0.5).name('공 전진 (+, 단위당)');
    aiFootball.add(fb.weights, 'ballRetreat', 0, 60, 0.5).name('공 후퇴 (−, 단위당)');
    aiFootball.add(fb.weights, 'ballThreat', 0, 800, 5).name('내 다음 턴 득점각 (+)');
    aiFootball.add(fb.weights, 'foeBallThreat', 0, 800, 5).name('상대 득점각 (−)');
    aiFootball.add(fb.weights, 'goalUncovered', 0, 800, 5).name('골문 비움 (−)');
    aiFootball.add(fb.weights, 'shooterSupport', 0, 100, 1).name('공 근처 아군 (+)');
    aiFootball.add(fb.weights, 'capStranded', 0, 200, 1).name('런오프에 방치 (−)');
    // The distances the pitch terms are measured with — see `config.ai.perMode`.
    aiFootball.add(fb.pitch, 'reach', 4, 60, 1).name('뚜껑 도달 사거리 (단위)');
    aiFootball.add(fb.pitch, 'strikeRange', 4, 60, 1).name('슛 사거리 (단위)');
    aiFootball.add(fb.pitch, 'coverRange', 4, 60, 1).name('수비 반응 거리 (단위)');
    aiFootball.add(fb.pitch, 'coverWidth', 0.5, 15, 0.1).name('커버 폭 (단위)');
    aiFootball.add(fb.pitch, 'supportRadius', 2, 40, 1).name('지원 판정 반경 (단위)');
    aiFootball.add(fb.cards, 'oneMoreMinScore', 0, 1200, 5).name('원모어: 최소 이득 (축구)');
    aiFootball.add(fb.cards, 'resistEdgeMin', 0, 1, 0.01).name('철벽: 최소 노출도 (축구)');
  }

  const aiSkill = ai.addFolder('실력 조절');
  // Both default to 0 and are meant to. See the block header in `config.js` for
  // why aim error is the wrong dial and `pickRandomness` is the right one.
  aiSkill.add(aiCfg, 'executionErrorDeg', 0, 20, 0.1).name('실행 오차 폭 (°, 기본 0)');
  aiSkill.add(aiCfg, 'pickRandomness', 0, 1, 0.01).name('상위 후보 랜덤성 (기본 0)');
  aiSkill.add(aiCfg, 'pickPoolSize', 1, 20, 1).name('랜덤 선택 풀 크기');

  const cardJudge = ai.addFolder('카드 판단 기준');
  // 강타 has no threshold to show: it is decided by re-simulating the boosted
  // shot, so its dial is the probe's size rather than a number to compare against.
  cardJudge.add(aiCfg, 'boostPool', 0, 12, 1).name('강타: 부스트 시뮬 후보 수');
  cardJudge.add(aiCfg.cards, 'oneMoreMinScore', 0, 200, 1).name('원모어: 최소 이득');
  cardJudge.add(aiCfg.cards, 'chaosThreatMin', -1, 1, 0.01).name('혼란: 최소 위협도');
  cardJudge.add(aiCfg.cards, 'silenceMinCards', 0, 5, 1).name('침묵: 상대 최소 손패');
  cardJudge.add(aiCfg.cards, 'resistEdgeMin', 0, 1, 0.01).name('철벽: 최소 노출도');

  const aiShow = ai.addFolder('턴 연출 길이');
  aiShow.add(aiCfg.show, 'cardPullSeconds', 0, 1, 0.01).name('카드 뽑기 (s)');
  aiShow.add(aiCfg.show, 'cardMoveSeconds', 0, 1, 0.01).name('카드 이동 (s)');
  aiShow.add(aiCfg.show, 'cardFlipSeconds', 0, 1, 0.01).name('카드 뒤집기 (s)');
  aiShow.add(aiCfg.show, 'cardHoldSeconds', 0, 1.5, 0.01).name('뒤집힌 채 정지 (s)');
  aiShow.add(aiCfg.show, 'gapSeconds', 0, 1, 0.01).name('카드↔조준 정지 (s)');
  aiShow.add(aiCfg.show, 'aimHighlightSeconds', 0, 1, 0.01).name('뚜껑 강조 (s)');
  aiShow.add(aiCfg.show, 'aimDrawSeconds', 0, 2, 0.01).name('당김 (s)');
  aiShow.add(aiCfg.show, 'aimHoldSeconds', 0, 1, 0.01).name('발사 전 정지 (s)');
  /**
   * The floor the brief puts on the card animation, as a readout rather than a
   * clamp.
   *
   * "0.6초 아래로 무리하게 줄이지 마라" is a design instruction, not a rule the
   * code should enforce — someone tuning this needs to be able to go under it to
   * see WHY. So the panel adds the three up, shows the total, and says when it
   * has gone below the line.
   */
  const aiShowStats = { total: '' };
  const showRow = aiShow.add(aiShowStats, 'total').name('뽑기~뒤집기 합계').disable();

  const aiViz = ai.addFolder('후보 시각화');
  aiViz.add(aiCfg, 'showCandidates').name('상위 후보 궤적 표시');
  aiViz.add(aiCfg, 'candidateCount', 1, 12, 1).name('표시 개수');
  aiViz.add(aiCfg, 'candidateSampleEvery', 1, 12, 1).name('궤적 샘플 간격');

  ai.add(
    {
      recenter: () => onRecenter?.(),
    },
    'recenter',
  ).name('▶ 카메라 기본 구도로');

  /**
   * The AI readouts, per frame.
   *
   * Read straight off the controller rather than pushed to it, the same way the
   * camera row reads the camera: an AI that had to report itself would be an AI
   * that knows a panel exists.
   */
  function refreshAi() {
    /**
     * The controller with a PLANNER, not the one that claims to be a computer.
     *
     * `isAi` is overloaded: `main.js` uses it as the drive gate AND as the
     * presentation switch, and `OnlineController` reports true for both of those
     * on purpose — one person at this screen, opponent's hand face down, no
     * viewpoint flip, all correct. It has no planner, so reading `c.planner`
     * off it threw and took the whole panel down with it.
     *
     * Asking for the thing this readout actually needs is the fix, rather than
     * adding an "and not online" clause that the next controller kind would have
     * to be added to as well.
     */
    const c = controllers?.find((x) => x?.planner);
    if (!c) {
      aiStats.think = '— (사람 상대)';
      aiStats.chose = '—';
      aiStats.cards = '—';
    } else {
      const p = c.planner;
      const per = p.evaluated ? (c.thinkMs / p.evaluated).toFixed(1) : '—';
      aiStats.think =
        `${c.thinkMs.toFixed(0)}ms · ${p.evaluated}/${p.generated}개 · ${per}ms/개` +
        (p.cutShort ? '  ⚠ 상한 도달' : '') +
        (c.phase === 'idle' ? '' : `  [${c.phase}]`);

      const e = c.plan?.entry;
      /**
       * The chosen move AND the terms that decided it.
       *
       * ── read off the terms rather than named, and that was a crash ─────────
       * This used to print `selfThreat`, `foeThreat` and `foeEdge` by name,
       * which is the right set for knockout and does not exist in football —
       * whose terms are `goal`, `ballAdvance`, `goalUncovered` and so on. Opening
       * this readout during a football turn was a `TypeError` on `undefined`,
       * and the panel is where you go when the AI has just done something
       * strange, so it failed exactly when it was needed.
       *
       * Whatever the evaluator returned is printed instead, non-zero entries
       * only. That is the contract every strategy owes — `terms` is required and
       * is the only debugging surface a search has — so a third mode's readout
       * works before anybody remembers this file exists.
       */
      const shown = !e
        ? ''
        : Object.entries(e.terms)
            .filter(([, v]) => Math.abs(v) > 0.005)
            .map(([k, v]) => `${k} ${v.toFixed(2)}`)
            .join(' / ');
      aiStats.chose = !e
        ? '—'
        : `${e.candidate.intent} · 뚜껑${e.candidate.capIndex} · 세기 ${e.candidate.power.toFixed(2)} · ${e.score.toFixed(0)}점` +
          (shown ? `  [${shown}]` : '  [모든 항목 0]');

      aiStats.cards = !c.cardLog.length
        ? '손패 없음'
        : c.cardLog.map((l) => `${l.play ? '●' : '○'}${l.cardId}: ${l.why}`).join('   |   ');
    }
    thinkRow.updateDisplay();
    choseRow.updateDisplay();
    cardRow.updateDisplay();

    const s = aiCfg.show;
    const reveal = s.cardPullSeconds + s.cardMoveSeconds + s.cardFlipSeconds;
    aiShowStats.total = `${reveal.toFixed(2)}s${reveal < 0.6 ? '  ⚠ 0.6s 미만 — 인지 어려움' : ''}`;
    showRow.updateDisplay();
  }
  refreshAi();

  refresh();
  return {
    gui,
    refresh: () => {
      refresh();
      refreshVerify();
      // Voice counts and the device state change on the same timescale as the
      // rest of these — a turn boundary, a rebuild — so they ride the 400 ms
      // poll rather than the per-frame one.
      audioPanel?.refresh();
    },
    /**
     * Per frame, alongside the camera row.
     *
     * The AI's readouts belong on this clock rather than the 400 ms poll for the
     * same reason the camera's do: a whole search starts and finishes inside a
     * third of a second, so a slow poll would show the "thinking" state roughly
     * never and the phase readout would be useless for watching the sequence
     * step through.
     */
    refreshCamera: () => {
      refreshCamera();
      refreshAi();
    },
  };
}

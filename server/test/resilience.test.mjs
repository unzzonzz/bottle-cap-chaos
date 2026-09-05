import assert from 'node:assert/strict';

import { C2S, DETECT, PROTOCOL_VERSION, S2C, decode, encode } from '../../src/net/protocol.js';
import { Hub } from '../Hub.js';

/**
 * Every way a player can vanish, and the promise that the other one is told.
 *
 * ── the bug this suite exists for ──────────────────────────────────────────
 * "한 사람이 나가도 게임이 계속 진행되는 경우가 있다. 안내가 뜰 때도 있고 안 뜰
 * 때도 있다." The inconsistency was five detectors that each did their own
 * tidying, with gaps between them: a turn clock that skipped without looking, a
 * window between a shot and its hashes that nothing watched at all, a queue that
 * paired corpses, and an invite code that outlived its room.
 *
 * So the assertion in almost every test below is the same one — the survivor
 * receives `OPPONENT_GONE` and the room ends — and what varies is how the
 * player left. The `cause` is checked too, because a defence that never fires
 * is indistinguishable from one that does not exist, and this is where that
 * gets noticed.
 *
 * ── the timings are scaled down, not mocked ────────────────────────────────
 * Real `setTimeout`s throughout, with the intervals divided by about a hundred.
 * A fake clock would test the arithmetic and not the wiring, and the wiring is
 * what was broken.
 *
 *   node server/test/resilience.test.mjs
 */

let failures = 0;
const results = [];
const queue = [];
const timings = [];
const test = (name, fn) => queue.push({ name, fn });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Scaled ~100x down from the shipped values so the suite runs in seconds. */
const FAST = {
  turnMs: 200,
  heartbeatMs: 30,
  heartbeatMisses: 3,
  heartbeatTimeoutMs: 400,
  hashTimeoutMs: 300,
  maxSkips: 3,
  roomTtlMs: 5000,
  roomMaxMs: 4000,
  handoffMs: 400,
};

/**
 * A client that behaves like a browser: it answers pings until it stops.
 *
 * `goSilent` is the important one — the socket stays open and no close or error
 * ever fires, which is what a killed mobile app and a dropped Wi-Fi look like
 * from the server. `hangUp` is the tab-close case.
 */
function client(hub, { nickname, configHash = 'cfg1' } = {}) {
  const inbox = [];
  let silent = false;
  const conn = hub.connect({
    send: (raw) => {
      if (silent) return;
      const msg = decode(raw);
      inbox.push(msg);
      if (msg?.t === S2C.PING) hub.handle(conn, encode(C2S.PONG, { t: msg.t }));
    },
    close: () => {},
  });
  const api = {
    conn,
    inbox,
    send: (t, b) => hub.handle(conn, encode(t, b)),
    last: (t) => [...inbox].reverse().find((m) => m.t === t),
    all: (t) => inbox.filter((m) => m.t === t),
    clear: () => (inbox.length = 0),
    /** Killed app / dead network: no close, no error, no pong. */
    goSilent: () => {
      silent = true;
    },
    /** Tab closed: the socket says so. */
    hangUp: () => hub.disconnect(conn, DETECT.SOCKET),
  };
  // A connection that never introduced itself can do nothing at all, so every
  // named client registers on the way in.
  if (nickname) api.send(C2S.HELLO, { protocol: PROTOCOL_VERSION, nickname, configHash });
  return api;
}

const fixedRandom = (seed = 7) => {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
};

/** A hub with its heartbeat actually running, as `index.js` does. */
function newHub(over = {}) {
  const hub = new Hub({
    random: fixedRandom(),
    log: () => {},
    timing: { ...FAST, ...over },
  });
  const beat = setInterval(() => hub.heartbeat(), hub.timing.heartbeatMs);
  const close = hub.close.bind(hub);
  hub.close = () => {
    clearInterval(beat);
    close();
  };
  return hub;
}

function pairUp(hub, mode = 'knockout') {
  const a = client(hub, { nickname: 'aa' });
  const b = client(hub, { nickname: 'bb' });
  a.send(C2S.ROOM_CREATE, { mode });
  b.send(C2S.ROOM_JOIN, { code: a.last(S2C.ROOM_CREATED).code });
  return { a, b, fa: a.last(S2C.MATCH_FOUND), fb: b.last(S2C.MATCH_FOUND) };
}

/** Pair, hand off, and get both into PLAYING. */
function playing(hub, mode = 'knockout') {
  const { a, b, fa, fb } = pairUp(hub, mode);
  a.hangUp();
  b.hangUp();
  const ga = client(hub);
  const gb = client(hub);
  // A game document never sends HELLO, so RESUME is where it states what build
  // it is running — the hub requires it there for that reason.
  ga.send(C2S.RESUME, { roomId: fa.roomId, token: fa.token, configHash: 'cfg1' });
  gb.send(C2S.RESUME, { roomId: fb.roomId, token: fb.token, configHash: 'cfg1' });
  ga.send(C2S.READY, {});
  gb.send(C2S.READY, {});
  const seats = { [fa.seat]: ga, [fb.seat]: gb };
  return { ga, gb, seats, first: fa.first, room: [...hub.rooms.values()][0] };
}

/** Wait until the survivor is told, and report how long it took. */
async function timeToNotice(label, survivor, limitMs = 3000) {
  const t0 = Date.now();
  for (let i = 0; i < limitMs / 10; i++) {
    if (survivor.last(S2C.OPPONENT_GONE)) {
      const ms = Date.now() - t0;
      timings.push([label, ms, survivor.last(S2C.OPPONENT_GONE).cause]);
      return ms;
    }
    await wait(10);
  }
  timings.push([label, -1, '—']);
  return -1;
}

// ── the scenarios ──────────────────────────────────────────────────────────

test('탭 닫기 — close 이벤트로 즉시', async () => {
  const hub = newHub();
  const { ga, gb, seats, first } = playing(hub);
  const gone = seats[first];
  const survivor = gone === ga ? gb : ga;
  survivor.clear();

  gone.hangUp();
  const ms = await timeToNotice('탭 닫기 (close)', survivor);

  assert.ok(ms >= 0, '생존자가 통보받지 못했다');
  assert.equal(survivor.last(S2C.OPPONENT_GONE).cause, DETECT.SOCKET);
  assert.match(survivor.last(S2C.OPPONENT_GONE).message, /연결이 끊어/);
  assert.equal(survivor.last(S2C.MATCH_OVER).winner, gone === ga ? 1 : 0);
  hub.close();
});

test('앱 강제종료 / 와이파이 끔 — close 없이 무응답', async () => {
  const hub = newHub();
  const { ga, gb, seats, first } = playing(hub);
  const gone = seats[first];
  const survivor = gone === ga ? gb : ga;
  survivor.clear();

  gone.goSilent(); // socket still open, nobody home
  const ms = await timeToNotice('무응답 (heartbeat)', survivor);

  assert.ok(ms >= 0, 'heartbeat 가 잡지 못했다');
  assert.ok(
    [DETECT.HEARTBEAT, DETECT.TURN_TIMER].includes(survivor.last(S2C.OPPONENT_GONE).cause),
    `예상 밖 경로: ${survivor.last(S2C.OPPONENT_GONE).cause}`,
  );
  hub.close();
});

test('상대 턴에 무응답 — 턴이 계속 넘어가지 않는다', async () => {
  const hub = newHub();
  const { ga, gb, seats, first, room } = playing(hub);
  const gone = seats[first];
  const survivor = gone === ga ? gb : ga;
  survivor.clear();

  gone.goSilent();
  await timeToNotice('무응답 (상대 턴)', survivor);
  await wait(600); // three turn-lengths past detection

  assert.ok(survivor.last(S2C.OPPONENT_GONE), '통보 없음');
  assert.equal(room.phase, 'over', '방이 아직 살아있다');
  // The heart of the bug: the turn must NOT have kept advancing.
  assert.ok(survivor.all(S2C.TURN_SKIP).length <= 1, '유령 턴이 계속 넘어갔다');
  hub.close();
});

test('발사 직후 상대 사망 — 해시 마감시한이 잡는다', async () => {
  // Heartbeat deliberately slowed right down so the hash deadline is the only
  // thing that can notice. This window used to have nothing watching it.
  const hub = newHub({ heartbeatMs: 2000, heartbeatTimeoutMs: 60000, hashTimeoutMs: 200 });
  const { ga, gb, seats, first } = playing(hub);
  const shooter = seats[first];
  const other = shooter === ga ? gb : ga;

  shooter.send(C2S.INPUT, {
    turn: 0,
    event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 },
  });
  other.goSilent();
  shooter.clear();

  const ms = await timeToNotice('발사 후 사망 (hash-timeout)', shooter);
  assert.ok(ms >= 0, '해시 마감시한이 잡지 못했다');
  assert.equal(shooter.last(S2C.OPPONENT_GONE).cause, DETECT.HASH_TIMEOUT);
  hub.close();
});

test('매칭 대기 중 이탈 — 유령 매칭이 생기지 않는다', async () => {
  const hub = newHub();
  const dead = client(hub, { nickname: 'aa' });
  dead.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  dead.goSilent();

  // Give the heartbeat time to write them off.
  await wait(200);

  const live = client(hub, { nickname: 'bb' });
  live.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  await wait(50);

  assert.equal(live.last(S2C.MATCH_FOUND), undefined, '죽은 상대와 매칭됐다');
  assert.ok(live.last(S2C.QUEUED), '큐에 들어가지도 못했다');
  hub.close();
});

test('큐 이탈이 즉시일 때도 — 매칭 직전 재확인이 막는다', async () => {
  const hub = newHub({ heartbeatMs: 5000 }); // heartbeat is asleep on purpose
  const dead = client(hub, { nickname: 'aa' });
  dead.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  dead.hangUp(); // a real close, before the next player arrives

  const live = client(hub, { nickname: 'bb' });
  live.send(C2S.QUEUE_JOIN, { mode: 'knockout' });

  assert.equal(live.last(S2C.MATCH_FOUND), undefined, '죽은 상대와 매칭됐다');
  assert.ok(live.last(S2C.QUEUED));
  hub.close();
});

test('초대 코드 방 생성 후 이탈 — 방과 코드가 사라진다', async () => {
  const hub = newHub();
  const host = client(hub, { nickname: 'aa' });
  host.send(C2S.ROOM_CREATE, { mode: 'knockout' });
  const code = host.last(S2C.ROOM_CREATED).code;

  host.hangUp();

  assert.equal(hub.rooms.size, 0, '방이 남아있다');
  assert.equal(hub.byCode.has(code), false, '코드가 살아있다');

  const late = client(hub, { nickname: 'bb' });
  late.send(C2S.ROOM_JOIN, { code });
  assert.equal(late.last(S2C.MATCH_FOUND), undefined);
  assert.ok(late.last(S2C.ERROR), '아무 응답도 못 받고 갇혔다');
  hub.close();
});

test('초대 코드 방 생성자가 조용히 죽어도 — 참가자가 갇히지 않는다', async () => {
  const hub = newHub();
  const host = client(hub, { nickname: 'aa' });
  host.send(C2S.ROOM_CREATE, { mode: 'knockout' });
  const code = host.last(S2C.ROOM_CREATED).code;
  host.goSilent();
  await wait(200); // heartbeat writes the host off

  const late = client(hub, { nickname: 'bb' });
  late.send(C2S.ROOM_JOIN, { code });
  assert.equal(late.last(S2C.MATCH_FOUND), undefined, '유령 방에 들어갔다');
  assert.ok(late.last(S2C.ERROR), '성공도 실패도 아닌 상태');
  hub.close();
});

test('연출 중(HANDOFF) 이탈 — 통보가 오고 승패가 정해진다', async () => {
  const hub = newHub();
  const { a, b, fa, fb } = pairUp(hub);
  a.hangUp();
  b.hangUp();

  // Only B comes back from the navigation; A closed the browser.
  const gb = client(hub);
  gb.send(C2S.RESUME, { roomId: fb.roomId, token: fb.token, configHash: 'cfg1' });
  gb.clear();

  const ms = await timeToNotice('연출 중 이탈 (handoff)', gb, 2000);
  assert.ok(ms >= 0, '통보가 오지 않았다');
  assert.equal(gb.last(S2C.OPPONENT_GONE).cause, DETECT.HANDOFF);
  assert.equal(gb.last(S2C.MATCH_OVER).winner, fb.seat, '생존자가 이기지 않았다');
  assert.notEqual(fa.seat, fb.seat);
  hub.close();
});

test('방 최대 수명 — 굳은 방은 결국 치워진다', async () => {
  const hub = newHub({ roomMaxMs: 150, heartbeatMs: 5000 });
  playing(hub);
  assert.equal(hub.rooms.size, 1);
  await wait(250);
  hub.sweep();
  assert.equal(hub.rooms.size, 0, '방이 남았다');
  hub.close();
});

// ── the other half: no false positives ─────────────────────────────────────

test('정상 대전 — 멀쩡한 연결을 끊김으로 오판하지 않는다', async () => {
  const hub = newHub();
  const { ga, gb, seats, first, room } = playing(hub);

  // Play several turns properly, well past the heartbeat timeout.
  let current = first;
  for (let t = 0; t < 4; t++) {
    seats[current].send(C2S.INPUT, {
      turn: t,
      event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: t + 1 },
    });
    await wait(40);
    const next = current === 0 ? 1 : 0;
    ga.send(C2S.HASH, { turn: t, hash: `h${t}`, next, over: false, winner: null });
    gb.send(C2S.HASH, { turn: t, hash: `h${t}`, next, over: false, winner: null });
    await wait(40);
    current = next;
  }

  assert.equal(ga.last(S2C.OPPONENT_GONE), undefined, 'A 가 오판당했다');
  assert.equal(gb.last(S2C.OPPONENT_GONE), undefined, 'B 가 오판당했다');
  assert.equal(room.phase, 'playing', '멀쩡한 방이 끝났다');
  assert.equal(room.turn, 4, '턴이 진행되지 않았다');
  hub.close();
});

test('오래 생각하는 사람 — 턴을 넘기되 몰수패는 아니다', async () => {
  const hub = newHub();
  const { ga, gb, seats, first, room } = playing(hub);
  const slow = seats[first];
  const other = slow === ga ? gb : ga;

  // Let one turn expire while both keep answering pings.
  await wait(300);
  assert.ok(other.last(S2C.TURN_SKIP), '턴이 넘어가지 않았다');
  assert.equal(other.last(S2C.OPPONENT_GONE), undefined, '생각한다고 몰수패시켰다');
  assert.notEqual(room.phase, 'over');
  void slow;
  hub.close();
});

// ── report ─────────────────────────────────────────────────────────────────

console.log('\n이탈 감지 — 시나리오별\n');
for (const { name, fn } of queue) {
  try {
    await fn();
    results.push(`  ✅ ${name}`);
  } catch (err) {
    failures++;
    results.push(`  ❌ ${name}\n     ${err.message}`);
  }
}
console.log(results.join('\n'));

if (timings.length) {
  console.log('\n감지 시간 (축소 설정: ping 30ms / 3회 / 해시 300ms / handoff 400ms)\n');
  for (const [label, ms, cause] of timings) {
    console.log(
      `  ${label.padEnd(30)} ${(ms < 0 ? '감지 못함' : ms + 'ms').padStart(9)}   [${cause}]`,
    );
  }
}

console.log(
  `\n${queue.length - failures}/${queue.length} passed` +
    (failures ? `  —  ${failures} FAILED\n` : '\n'),
);
process.exit(failures ? 1 : 0);

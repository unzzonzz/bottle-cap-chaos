import assert from 'node:assert/strict';

import {
  C2S,
  ERR,
  OVER_REASON,
  PROTOCOL_VERSION,
  S2C,
  TIMING,
  decode,
  encode,
} from '../../src/net/protocol.js';
import { Hub } from '../Hub.js';

/**
 * The relay, exercised without a socket in sight.
 *
 * ── why this can be a plain script ─────────────────────────────────────────
 * `Hub` takes a connection as an object with `send` and `close` and never
 * mentions `ws`, so a "client" here is fourteen lines that push strings in and
 * collect strings out. That is the payoff for keeping the transport out of the
 * hub: the entire matchmaking, timing, forfeit and desync surface is testable
 * synchronously, in-process, with a clock we control.
 *
 *   node server/test/flow.test.mjs
 */

let failures = 0;
const results = [];
const queue = [];

/**
 * Registered, not run.
 *
 * Several of these wait on a real timer — the turn clock is a `setTimeout` and
 * pretending otherwise would test a mock instead of the server. So the bodies
 * are collected here and awaited one at a time below; running them as they are
 * declared would leave the async ones unawaited, and an assertion that fails
 * inside an unawaited promise is an unhandled rejection rather than a failed
 * test. That is the shape of a suite that passes while proving nothing.
 */
function test(name, fn) {
  queue.push({ name, fn });
}

/** A client: collects what the server sent it, and can be asked about it. */
function client(hub, { nickname, configHash = 'cfg00001' } = {}) {
  const inbox = [];
  const conn = hub.connect({
    send: (raw) => inbox.push(decode(raw)),
    close: () => {},
  });
  const api = {
    conn,
    inbox,
    send: (t, body) => hub.handle(conn, encode(t, body)),
    /** The most recent message of a type, or undefined. */
    last: (t) => [...inbox].reverse().find((m) => m.t === t),
    all: (t) => inbox.filter((m) => m.t === t),
    clear: () => (inbox.length = 0),
  };
  if (nickname) {
    api.send(C2S.HELLO, { protocol: PROTOCOL_VERSION, nickname, configHash });
  }
  return api;
}

/** Deterministic "randomness", so seeds and codes are the same every run. */
function fixedRandom(seed = 12345) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const newHub = (over = {}) =>
  new Hub({ random: fixedRandom(), log: () => {}, ...over });

// ── nicknames ──────────────────────────────────────────────────────────────

test('valid nickname is accepted and echoed back normalised', () => {
  const hub = newHub();
  const a = client(hub, { nickname: '  한별  ' });
  assert.equal(a.last(S2C.HELLO_OK)?.nickname, '한별');
  hub.close();
});

test('special characters, digits and spaces are refused', () => {
  const hub = newHub();
  for (const bad of ['neo!', '네오123', 'a b', '한글English!', 'ㄱㄴ']) {
    const c = client(hub, { nickname: bad });
    assert.equal(c.last(S2C.HELLO_OK), undefined, `accepted ${bad}`);
    assert.equal(c.last(S2C.ERROR)?.code, ERR.NICKNAME_INVALID, `wrong code for ${bad}`);
  }
  hub.close();
});

test('length bounds are enforced at both ends', () => {
  const hub = newHub();
  assert.equal(client(hub, { nickname: 'a' }).last(S2C.HELLO_OK), undefined);
  assert.equal(client(hub, { nickname: 'abcdefghijk' }).last(S2C.HELLO_OK), undefined);
  assert.ok(client(hub, { nickname: 'ab' }).last(S2C.HELLO_OK));
  assert.ok(client(hub, { nickname: 'abcdefghij' }).last(S2C.HELLO_OK));
  hub.close();
});

test('duplicate nickname is refused, case-insensitively', () => {
  const hub = newHub();
  assert.ok(client(hub, { nickname: 'Neo' }).last(S2C.HELLO_OK));
  const b = client(hub, { nickname: 'neo' });
  assert.equal(b.last(S2C.ERROR)?.code, 'nickname_taken');
  hub.close();
});

test('a disconnect frees the nickname', () => {
  const hub = newHub();
  const a = client(hub, { nickname: '한별' });
  hub.disconnect(a.conn);
  assert.ok(client(hub, { nickname: '한별' }).last(S2C.HELLO_OK));
  hub.close();
});

test('decomposed Hangul from macOS registers as the composed name', () => {
  const hub = newHub();
  const a = client(hub, { nickname: '한별'.normalize('NFD') });
  assert.equal(a.last(S2C.HELLO_OK)?.nickname, '한별');
  // and now blocks the composed form
  assert.equal(client(hub, { nickname: '한별' }).last(S2C.ERROR)?.code, 'nickname_taken');
  hub.close();
});

// ── invite codes ───────────────────────────────────────────────────────────

test('invite code pairs two players and hands both the same seed', () => {
  const hub = newHub();
  const a = client(hub, { nickname: '한별' });
  const b = client(hub, { nickname: '네오' });

  a.send(C2S.ROOM_CREATE, { mode: 'knockout', mark: { kind: 'none' } });
  const code = a.last(S2C.ROOM_CREATED)?.code;
  assert.ok(code, 'no code issued');
  assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);

  b.send(C2S.ROOM_JOIN, { code, mark: { kind: 'none' } });

  const fa = a.last(S2C.MATCH_FOUND);
  const fb = b.last(S2C.MATCH_FOUND);
  assert.ok(fa && fb, 'both should be told');
  assert.equal(fa.seed, fb.seed, 'seeds differ');
  assert.equal(fa.first, fb.first, 'first player differs');
  assert.notEqual(fa.seat, fb.seat, 'both got the same seat');
  assert.equal(fa.opponent.nickname, '네오');
  assert.equal(fb.opponent.nickname, '한별');
  hub.close();
});

test('all three modes can be matched by code', () => {
  for (const mode of ['knockout', 'football', 'curling']) {
    const hub = newHub();
    const a = client(hub, { nickname: 'aa' });
    const b = client(hub, { nickname: 'bb' });
    a.send(C2S.ROOM_CREATE, { mode });
    b.send(C2S.ROOM_JOIN, { code: a.last(S2C.ROOM_CREATED).code });
    assert.equal(a.last(S2C.MATCH_FOUND)?.mode, mode, `${mode} did not pair`);
    hub.close();
  }
});

test('a lowercase / spaced code still finds the room', () => {
  const hub = newHub();
  const a = client(hub, { nickname: 'aa' });
  const b = client(hub, { nickname: 'bb' });
  a.send(C2S.ROOM_CREATE, { mode: 'knockout' });
  const code = a.last(S2C.ROOM_CREATED).code;
  b.send(C2S.ROOM_JOIN, { code: ` ${code.toLowerCase().slice(0, 3)}-${code.toLowerCase().slice(3)} ` });
  assert.ok(b.last(S2C.MATCH_FOUND), 'forgiving code parse failed');
  hub.close();
});

test('an unknown code is refused', () => {
  const hub = newHub();
  const b = client(hub, { nickname: 'bb' });
  b.send(C2S.ROOM_JOIN, { code: 'ZZZZZZ' });
  assert.equal(b.last(S2C.ERROR)?.code, ERR.ROOM_NOT_FOUND);
  hub.close();
});

test('mismatched config refuses the pairing rather than desyncing later', () => {
  const hub = newHub();
  const a = client(hub, { nickname: 'aa', configHash: 'aaaaaaaa' });
  const b = client(hub, { nickname: 'bb', configHash: 'bbbbbbbb' });
  a.send(C2S.ROOM_CREATE, { mode: 'knockout' });
  b.send(C2S.ROOM_JOIN, { code: a.last(S2C.ROOM_CREATED).code });
  assert.equal(b.last(S2C.ERROR)?.code, ERR.CONFIG_MISMATCH);
  assert.equal(a.last(S2C.MATCH_FOUND), undefined);
  hub.close();
});

// ── random queue ───────────────────────────────────────────────────────────

test('queue pairs two waiters in the same mode', () => {
  const hub = newHub();
  const a = client(hub, { nickname: 'aa' });
  const b = client(hub, { nickname: 'bb' });
  a.send(C2S.QUEUE_JOIN, { mode: 'football' });
  assert.ok(a.last(S2C.QUEUED), 'first waiter not queued');
  assert.equal(a.last(S2C.MATCH_FOUND), undefined, 'paired with nobody');
  b.send(C2S.QUEUE_JOIN, { mode: 'football' });
  assert.ok(a.last(S2C.MATCH_FOUND) && b.last(S2C.MATCH_FOUND), 'queue did not pair');
  hub.close();
});

test('queues do not cross modes', () => {
  const hub = newHub();
  const a = client(hub, { nickname: 'aa' });
  const b = client(hub, { nickname: 'bb' });
  a.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  b.send(C2S.QUEUE_JOIN, { mode: 'curling' });
  assert.equal(a.last(S2C.MATCH_FOUND), undefined);
  assert.equal(b.last(S2C.MATCH_FOUND), undefined);
  hub.close();
});

test('cancelling removes you from the queue', () => {
  const hub = newHub();
  const a = client(hub, { nickname: 'aa' });
  const b = client(hub, { nickname: 'bb' });
  a.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  a.send(C2S.QUEUE_LEAVE, {});
  assert.ok(a.last(S2C.QUEUE_LEFT));
  b.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  assert.equal(b.last(S2C.MATCH_FOUND), undefined, 'paired with a cancelled waiter');
  hub.close();
});

test('dropping while queued just removes you — no forfeit', () => {
  const hub = newHub();
  const a = client(hub, { nickname: 'aa' });
  a.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  hub.disconnect(a.conn);
  // `stats().queued` lists the waiters now rather than counting them — the
  // debug panel needs to show who, not how many.
  assert.equal(hub.stats().queued.knockout.length, 0);
  assert.equal(a.last(S2C.MATCH_OVER), undefined);
  hub.close();
});

// ── the match ──────────────────────────────────────────────────────────────

/** Pair two clients and walk them through the handoff into PLAYING. */
function playing(hub, mode = 'knockout') {
  const a = client(hub, { nickname: 'aa' });
  const b = client(hub, { nickname: 'bb' });
  a.send(C2S.ROOM_CREATE, { mode });
  b.send(C2S.ROOM_JOIN, { code: a.last(S2C.ROOM_CREATED).code });

  const fa = a.last(S2C.MATCH_FOUND);
  const fb = b.last(S2C.MATCH_FOUND);

  // Both browsers navigate; the menu sockets die and the game documents arrive.
  hub.disconnect(a.conn);
  hub.disconnect(b.conn);
  const ga = client(hub);
  const gb = client(hub);
  ga.send(C2S.RESUME, { roomId: fa.roomId, token: fa.token, configHash: 'cfg00001' });
  gb.send(C2S.RESUME, { roomId: fb.roomId, token: fb.token, configHash: 'cfg00001' });

  ga.send(C2S.READY, {});
  gb.send(C2S.READY, {});

  const seats = { [fa.seat]: ga, [fb.seat]: gb };
  return { ga, gb, fa, fb, seats, first: fa.first };
}

test('navigating between documents does not forfeit the match', () => {
  const hub = newHub();
  const { ga, gb } = playing(hub);
  assert.ok(ga.last(S2C.MATCH_START) && gb.last(S2C.MATCH_START), 'match never started');
  assert.equal(ga.last(S2C.MATCH_OVER), undefined, 'handoff was treated as a disconnect');
  hub.close();
});

test('the first turn opens only after BOTH have finished the cutscene', () => {
  const hub = newHub();
  const a = client(hub, { nickname: 'aa' });
  const b = client(hub, { nickname: 'bb' });
  a.send(C2S.ROOM_CREATE, { mode: 'knockout' });
  b.send(C2S.ROOM_JOIN, { code: a.last(S2C.ROOM_CREATED).code });
  const fa = a.last(S2C.MATCH_FOUND);
  const fb = b.last(S2C.MATCH_FOUND);
  const ga = client(hub);
  const gb = client(hub);
  // The hash is required on RESUME as well as on HELLO — a game document never
  // says hello, so this is the only place it states what it is running.
  ga.send(C2S.RESUME, { roomId: fa.roomId, token: fa.token, configHash: 'cfg00001' });
  gb.send(C2S.RESUME, { roomId: fb.roomId, token: fb.token, configHash: 'cfg00001' });

  ga.send(C2S.READY, {});
  assert.equal(ga.last(S2C.TURN_BEGIN), undefined, 'clock started on one READY');
  gb.send(C2S.READY, {});
  assert.ok(ga.last(S2C.TURN_BEGIN), 'clock never started');
  hub.close();
});

test('a shot is relayed to the opponent', () => {
  const hub = newHub();
  const { seats, first } = playing(hub);
  const me = seats[first];
  const them = seats[first === 0 ? 1 : 0];
  them.clear();

  const event = { seq: 0, kind: 'shot', player: first, rngState: 7, capIndex: 1, dirX: 1, dirZ: 0, power: 0.5, seed: 99 };
  me.send(C2S.INPUT, { turn: 0, event });

  const got = them.last(S2C.INPUT);
  assert.ok(got, 'nothing relayed');
  assert.equal(got.event.seed, 99);
  assert.equal(got.player, first);
  hub.close();
});

test('the player whose turn it is not cannot act', () => {
  const hub = newHub();
  const { seats, first } = playing(hub);
  const them = seats[first === 0 ? 1 : 0];
  them.send(C2S.INPUT, { turn: 0, event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 } });
  assert.equal(them.last(S2C.ERROR)?.code, ERR.NOT_YOUR_TURN);
  hub.close();
});

test('agreeing hashes advance the turn to whoever the clients say', () => {
  const hub = newHub();
  const { ga, gb, seats, first } = playing(hub);
  const next = first === 0 ? 1 : 0;
  seats[first].send(C2S.INPUT, {
    turn: 0,
    event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 },
  });
  ga.clear();
  gb.clear();
  ga.send(C2S.HASH, { turn: 0, hash: 'deadbeef', next, over: false, winner: null });
  gb.send(C2S.HASH, { turn: 0, hash: 'deadbeef', next, over: false, winner: null });

  const begun = ga.last(S2C.TURN_BEGIN);
  assert.ok(begun, 'next turn never opened');
  assert.equal(begun.turn, 1);
  assert.equal(begun.player, next);
  hub.close();
});

test('one hash alone does not advance the turn', () => {
  const hub = newHub();
  const { ga, seats, first } = playing(hub);
  seats[first].send(C2S.INPUT, {
    turn: 0,
    event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 },
  });
  ga.clear();
  ga.send(C2S.HASH, { turn: 0, hash: 'deadbeef', next: 1, over: false, winner: null });
  assert.equal(ga.last(S2C.TURN_BEGIN), undefined, 'advanced on a single report');
  hub.close();
});

// ── desync ─────────────────────────────────────────────────────────────────

test('disagreeing hashes stop the match and tell both sides', () => {
  const hub = newHub();
  const { ga, gb, seats, first } = playing(hub);
  seats[first].send(C2S.INPUT, {
    turn: 0,
    event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 },
  });
  ga.send(C2S.HASH, { turn: 0, hash: 'aaaaaaaa', next: 1, over: false, winner: null });
  gb.send(C2S.HASH, { turn: 0, hash: 'bbbbbbbb', next: 1, over: false, winner: null });

  assert.ok(ga.last(S2C.DESYNC), 'sender not told');
  assert.ok(gb.last(S2C.DESYNC), 'receiver not told');
  assert.equal(ga.last(S2C.MATCH_OVER)?.reason, OVER_REASON.DESYNC);
  // and the dump is there for the debug panel
  assert.equal(ga.last(S2C.DESYNC).reports[0].hash, 'aaaaaaaa');
  assert.equal(ga.last(S2C.DESYNC).reports[1].hash, 'bbbbbbbb');
  hub.close();
});

test('agreeing on the world but not on whose turn is next is also a desync', () => {
  const hub = newHub();
  const { ga, gb, seats, first } = playing(hub);
  seats[first].send(C2S.INPUT, {
    turn: 0,
    event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 },
  });
  ga.send(C2S.HASH, { turn: 0, hash: 'same', next: 0, over: false, winner: null });
  gb.send(C2S.HASH, { turn: 0, hash: 'same', next: 1, over: false, winner: null });
  assert.ok(ga.last(S2C.DESYNC), 'rules divergence went undetected');
  hub.close();
});

test('agreeing on a winner ends the match as a played result', () => {
  const hub = newHub();
  const { ga, gb, seats, first } = playing(hub);
  seats[first].send(C2S.INPUT, {
    turn: 0,
    event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 },
  });
  ga.send(C2S.HASH, { turn: 0, hash: 'x', next: 0, over: true, winner: 0 });
  gb.send(C2S.HASH, { turn: 0, hash: 'x', next: 0, over: true, winner: 0 });
  const over = ga.last(S2C.MATCH_OVER);
  assert.equal(over?.reason, OVER_REASON.PLAYED);
  assert.equal(over?.winner, 0);
  hub.close();
});

// ── leaving ────────────────────────────────────────────────────────────────

test('disconnecting mid-match forfeits, and the survivor is told plainly', () => {
  const hub = newHub();
  const { ga, gb, seats, first } = playing(hub);
  const loser = seats[first];
  const winner = loser === ga ? gb : ga;
  winner.clear();

  hub.disconnect(loser.conn);

  const gone = winner.last(S2C.OPPONENT_GONE);
  assert.ok(gone, 'survivor not told');
  assert.equal(gone.reason, OVER_REASON.DISCONNECT);
  assert.match(gone.message, /연결이 끊어/);
  assert.equal(winner.last(S2C.MATCH_OVER)?.reason, OVER_REASON.DISCONNECT);
  hub.close();
});

test('an explicit exit is reported as a forfeit, not as a dropped connection', () => {
  const hub = newHub();
  const { ga, gb } = playing(hub);
  gb.clear();
  ga.send(C2S.FORFEIT, {});
  assert.equal(gb.last(S2C.OPPONENT_GONE)?.reason, OVER_REASON.FORFEIT);
  assert.match(gb.last(S2C.OPPONENT_GONE).message, /나갔습니다/);
  hub.close();
});

test('a heartbeat timeout forfeits like any other disconnect', () => {
  const hub = newHub({ timing: { turnMs: 15000, heartbeatMs: 50, heartbeatTimeoutMs: 1, roomTtlMs: 60000, handoffMs: 60000 } });
  const { ga, gb } = playing(hub);
  gb.clear();
  ga.conn.lastPong = Date.now() - 10_000;
  gb.conn.lastPong = Date.now();
  hub.heartbeat();
  assert.equal(gb.last(S2C.OPPONENT_GONE)?.reason, OVER_REASON.DISCONNECT);
  hub.close();
});

// ── the clock ──────────────────────────────────────────────────────────────

test('running out of time skips the turn and plays nothing', async () => {
  const hub = newHub({ timing: { turnMs: 40, heartbeatMs: 5000, heartbeatTimeoutMs: 15000, roomTtlMs: 60000, handoffMs: 60000 } });
  const { ga, gb } = playing(hub);
  ga.clear();
  gb.clear();
  await new Promise((r) => setTimeout(r, 90));

  const skip = ga.last(S2C.TURN_SKIP);
  assert.ok(skip, 'no skip issued');
  assert.equal(skip.turn, 0);
  assert.ok(gb.last(S2C.TURN_SKIP), 'opponent not told');
  // and crucially: the server invented no move
  assert.equal(ga.all(S2C.INPUT).length, 0, 'server played a move on the timeout');
  hub.close();
});

test('playing a card resets the clock instead of ending the turn', async () => {
  const hub = newHub({ timing: { turnMs: 120, heartbeatMs: 5000, heartbeatTimeoutMs: 15000, roomTtlMs: 60000, handoffMs: 60000 } });
  const { ga, seats, first } = playing(hub);
  const me = seats[first];
  await new Promise((r) => setTimeout(r, 70));
  me.send(C2S.INPUT, { turn: 0, event: { kind: 'card', cardId: 'smash', rngState: 3 } });

  const clock = ga.last(S2C.TURN_CLOCK);
  assert.ok(clock, 'clock not extended');
  assert.equal(clock.reason, 'card');
  // The original 120 ms would have expired by now; the reset must have saved it.
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(ga.last(S2C.TURN_SKIP), undefined, 'card did not reset the clock');
  hub.close();
});

test('the clock stops once a shot is taken, however long the sim runs', async () => {
  const hub = newHub({ timing: { turnMs: 40, heartbeatMs: 5000, heartbeatTimeoutMs: 15000, roomTtlMs: 60000, handoffMs: 60000 } });
  const { ga, seats, first } = playing(hub);
  seats[first].send(C2S.INPUT, {
    turn: 0,
    event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 },
  });
  ga.clear();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(ga.last(S2C.TURN_SKIP), undefined, 'a fired turn timed out mid-simulation');
  hub.close();
});

// ── the two defences the protocol named and the hub did not have ──────────

test('a hello with no config hash is refused', () => {
  const hub = newHub();
  for (const bad of [undefined, '', null, 0, {}, 'x'.repeat(65)]) {
    const c = client(hub);
    c.send(C2S.HELLO, { protocol: PROTOCOL_VERSION, nickname: 'aa', configHash: bad });
    assert.equal(c.last(S2C.HELLO_OK), undefined, `accepted ${JSON.stringify(bad)}`);
    assert.equal(c.last(S2C.ERROR)?.code, ERR.CONFIG_MISMATCH, `wrong code for ${JSON.stringify(bad)}`);
  }
  hub.close();
});

test('two clients that both send nothing are NOT matched', () => {
  const hub = newHub();
  // The hole: `String(undefined ?? '')` is `''` on both sides, `'' === ''`, and
  // the two least compatible clients in the world were paired.
  const a = client(hub);
  const b = client(hub);
  a.send(C2S.HELLO, { protocol: PROTOCOL_VERSION, nickname: 'aa' });
  b.send(C2S.HELLO, { protocol: PROTOCOL_VERSION, nickname: 'bb' });
  a.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  b.send(C2S.QUEUE_JOIN, { mode: 'knockout' });
  assert.equal(a.last(S2C.MATCH_FOUND), undefined, 'paired two clients with no config hash');
  assert.equal(b.last(S2C.MATCH_FOUND), undefined, 'paired two clients with no config hash');
  // And they never got a name in the first place, so the queue refused them.
  assert.equal(a.last(S2C.QUEUED), undefined);
  hub.close();
});

test('a nickname is not reserved by a hello that the hash check refuses', () => {
  const hub = newHub();
  const bad = client(hub);
  bad.send(C2S.HELLO, { protocol: PROTOCOL_VERSION, nickname: '한별', configHash: '' });
  assert.equal(bad.last(S2C.HELLO_OK), undefined);
  // The name has to still be free: refusing after claiming would let anyone
  // burn a nickname with a malformed hello.
  const good = client(hub, { nickname: '한별' });
  assert.equal(good.last(S2C.HELLO_OK)?.nickname, '한별');
  hub.close();
});

test('a flood is cut off with RATE_LIMITED and the socket closed', () => {
  const hub = newHub({ timing: { ...TIMING, msgBurst: 20, msgPerSecond: 1 } });
  const c = client(hub, { nickname: 'aa' });
  c.clear();
  // Far past the budget. Nothing here is a valid message, which is the point:
  // the limiter runs before `decode`, so unparseable frames are charged too.
  for (let i = 0; i < 500; i++) c.send('nonsense', {});
  assert.equal(c.last(S2C.ERROR)?.code, ERR.RATE_LIMITED, 'never rate limited');
  assert.equal(hub.isAlive(c.conn), false, 'connection survived the flood');
  // And it is told once, not five hundred times — the connection is gone after
  // the first refusal, so every later frame is dropped before it reaches a send.
  assert.equal(c.all(S2C.ERROR).filter((m) => m.code === ERR.RATE_LIMITED).length, 1);
  hub.close();
});

test('the bucket refills, so a paced client is never cut', async () => {
  const hub = newHub({ timing: { ...TIMING, msgBurst: 3, msgPerSecond: 200 } });
  const c = client(hub, { nickname: 'aa' });
  c.clear();
  // The hello already spent one, so wait once for the bucket to come back to
  // full before counting. At 200/s a 30 ms pause refills six — twice the burst,
  // so each round starts from a full bucket however the timer actually lands.
  await new Promise((r) => setTimeout(r, 30));
  // Nine messages at a rate the refill covers: three, wait, three, wait, three.
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 3; i++) c.send(C2S.PONG, {});
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(c.last(S2C.ERROR), undefined, 'a paced client was rate limited');
  assert.ok(hub.isAlive(c.conn), 'a paced client was dropped');
  hub.close();
});

test('a whole match at full speed does not touch the limit', async () => {
  const hub = newHub({ timing: { ...TIMING, turnMs: 60_000 } });
  const { ga, gb, seats, first } = playing(hub);
  // 60 turns' worth of INPUT + HASH from both sides, sent as fast as the loop
  // can push them — far more than a real match and with no wall time between.
  // This is the case the burst exists to survive; see `TIMING.msgBurst`.
  let turn = 0;
  for (let i = 0; i < 60; i++) {
    const me = seats[turn % 2 === 0 ? first : first === 0 ? 1 : 0];
    me.send(C2S.INPUT, {
      turn,
      event: { seq: 0, kind: 'shot', player: 0, capIndex: 0, dirX: 1, dirZ: 0, power: 0.5, seed: i },
    });
    ga.send(C2S.HASH, { turn, hash: 'aaaaaaaa', next: (turn + 1) % 2 });
    gb.send(C2S.HASH, { turn, hash: 'aaaaaaaa', next: (turn + 1) % 2 });
    turn++;
  }
  for (const c of [ga, gb]) {
    assert.ok(
      !c.all(S2C.ERROR).some((m) => m.code === ERR.RATE_LIMITED),
      'a full-speed match hit the rate limit',
    );
    assert.ok(hub.isAlive(c.conn), 'a full-speed match dropped a connection');
  }
  hub.close();
});

// ── report ─────────────────────────────────────────────────────────────────

console.log('\nserver flow\n');
for (const { name, fn } of queue) {
  try {
    await fn();
    results.push(`  \u2705 ${name}`);
  } catch (err) {
    failures++;
    results.push(`  \u274c ${name}\n     ${err.message}`);
  }
}
console.log(results.join('\n'));
console.log(
  `\n${queue.length - failures}/${queue.length} passed` +
    (failures ? `  \u2014  ${failures} FAILED\n` : '\n'),
);
process.exit(failures ? 1 : 0);

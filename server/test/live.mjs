import WebSocket from 'ws';

import { C2S, PROTOCOL_VERSION, S2C, configHash, decode, encode } from '../../src/net/protocol.js';
import { CONFIG } from '../../src/game/config.js';

/**
 * The same scenarios, over real WebSockets against the running relay.
 *
 * ── why this exists alongside `resilience.test.mjs` ────────────────────────
 * That suite drives the `Hub` directly with fake connections, which is the
 * right way to test the logic and the wrong way to test the WIRING: the socket
 * event handlers in `index.js`, `ws`'s own close and error behaviour, and what
 * actually reaches a peer are all outside it. A killed process, a socket
 * destroyed without a close frame, a `terminate()` — those only behave like
 * themselves over a real connection.
 *
 *   node server/index.js                  # in another terminal
 *   node server/test/live.mjs
 *
 * Run the relay with accelerated timings to keep it short, e.g.
 *   HEARTBEAT_MS=1000 HASH_TIMEOUT_MS=4000 HANDOFF_MS=4000 node server/index.js
 */

const URL = process.env.RELAY ?? 'ws://127.0.0.1:8787';
const H = configHash(CONFIG);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
let failures = 0;

function open(nickname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const inbox = [];
    ws.on('message', (d) => {
      const msg = decode(d.toString());
      inbox.push(msg);
      /**
       * Answer the heartbeat, like a real client does.
       *
       * Without this every client in this file looks dead within three pings
       * and the relay — correctly — writes them all off, which reads as the
       * server being broken rather than the harness being silent. `Transport`
       * does this in the browser; a raw `ws` socket does not.
       */
      if (msg?.t === S2C.PING && !ws.__muted) ws.send(encode(C2S.PONG, { t: msg.t }));
    });
    ws.on('error', () => {});
    ws.on('open', () => {
      if (nickname) {
        ws.send(encode(C2S.HELLO, { protocol: PROTOCOL_VERSION, nickname, configHash: H }));
      }
      setTimeout(
        () =>
          resolve({
            ws,
            inbox,
            send: (t, b) => ws.send(encode(t, b)),
            last: (t) => [...inbox].reverse().find((m) => m.t === t),
            clear: () => (inbox.length = 0),
            /**
             * Rip the socket away without a close frame.
             *
             * `terminate` is the closest thing `ws` has to a process being
             * killed: no close handshake, and the peer finds out by silence.
             */
            kill: () => ws.terminate(),
            /** Politely close, as a tab does. */
            bye: () => ws.close(),
            /** Stop answering, socket still up. A killed app. */
            mute: () => {
              ws.__muted = true;
            },
          }),
        250,
      );
    });
    setTimeout(() => reject(new Error(`could not reach ${URL}`)), 4000);
  });
}

async function noticed(who, limitMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < limitMs) {
    const gone = who.last(S2C.OPPONENT_GONE);
    if (gone) return { ms: Date.now() - t0, cause: gone.cause, message: gone.message };
    await wait(50);
  }
  return null;
}

/** Pair two fresh clients and walk them into a live match. */
async function playing(tag) {
  // Letters only — the nickname rules reject digits, and a refused HELLO makes
  // every later request fail with `not_registered` rather than saying so.
  const a = await open(`x${tag}`);
  const b = await open(`y${tag}`);
  a.send(C2S.ROOM_CREATE, { mode: 'knockout', mark: { kind: 'none' } });
  await wait(200);
  b.send(C2S.ROOM_JOIN, { code: a.last(S2C.ROOM_CREATED).code, mark: { kind: 'none' } });
  await wait(300);
  const fa = a.last(S2C.MATCH_FOUND);
  const fb = b.last(S2C.MATCH_FOUND);

  a.bye();
  b.bye();
  await wait(200);
  const ga = await open(null);
  const gb = await open(null);
  ga.send(C2S.RESUME, { roomId: fa.roomId, token: fa.token, configHash: H });
  gb.send(C2S.RESUME, { roomId: fb.roomId, token: fb.token, configHash: H });
  await wait(250);
  ga.send(C2S.READY, {});
  gb.send(C2S.READY, {});
  await wait(300);
  const seats = { [fa.seat]: ga, [fb.seat]: gb };
  return { ga, gb, seats, first: fa.first };
}

async function scenario(name, fn) {
  try {
    const r = await fn();
    if (!r) {
      failures++;
      rows.push([name, '감지 못함', '—', '❌']);
      return;
    }
    rows.push([name, `${r.ms}ms`, r.cause, '✅']);
  } catch (err) {
    failures++;
    rows.push([name, `오류: ${err.message}`, '—', '❌']);
  }
}

console.log(`\n실제 소켓 검증 — ${URL}\n`);

await scenario('탭 닫기 (close 프레임)', async () => {
  const { ga, gb, seats, first } = await playing('aa');
  const gone = seats[first];
  const survivor = gone === ga ? gb : ga;
  survivor.clear();
  gone.bye();
  const r = await noticed(survivor);
  ga.bye();
  gb.bye();
  return r;
});

await scenario('프로세스 강제 종료 (close 프레임 없음)', async () => {
  const { ga, gb, seats, first } = await playing('bb');
  const gone = seats[first];
  const survivor = gone === ga ? gb : ga;
  survivor.clear();
  gone.kill();
  const r = await noticed(survivor);
  ga.bye();
  gb.bye();
  return r;
});

await scenario('상대 턴에 무응답', async () => {
  const { ga, gb, seats, first } = await playing('cc');
  const gone = seats[first];
  const survivor = gone === ga ? gb : ga;
  survivor.clear();
  // Stop answering without closing: the socket is up, nobody is home.
  gone.mute();
  const r = await noticed(survivor);
  ga.bye();
  gb.bye();
  return r;
});

await scenario('발사 직후 상대 사망', async () => {
  const { ga, gb, seats, first } = await playing('dd');
  const shooter = seats[first];
  const other = shooter === ga ? gb : ga;
  shooter.send(C2S.INPUT, {
    turn: 0,
    event: { kind: 'shot', capIndex: 0, dirX: 1, dirZ: 0, power: 1, seed: 1 },
  });
  await wait(150);
  shooter.clear();
  other.kill();
  const r = await noticed(shooter);
  ga.bye();
  gb.bye();
  return r;
});

await scenario('연출 중(HANDOFF) 이탈', async () => {
  const a = await open('eex');
  const b = await open('eey');
  a.send(C2S.ROOM_CREATE, { mode: 'knockout' });
  await wait(200);
  b.send(C2S.ROOM_JOIN, { code: a.last(S2C.ROOM_CREATED).code });
  await wait(300);
  const fb = b.last(S2C.MATCH_FOUND);
  a.bye();
  b.bye();
  await wait(150);
  // Only B comes back; A closed the browser during the navigation.
  const gb = await open(null);
  gb.send(C2S.RESUME, { roomId: fb.roomId, token: fb.token, configHash: H });
  await wait(200);
  gb.clear();
  const r = await noticed(gb, 12000);
  gb.bye();
  return r;
});

// ── the non-match cases: no ghosts left behind ─────────────────────────────

await scenario('큐 이탈 → 유령 매칭 없음', async () => {
  const dead = await open('ffx');
  dead.send(C2S.QUEUE_JOIN, { mode: 'football' });
  await wait(200);
  dead.kill();
  await wait(6000); // past the hard silence limit

  const live = await open('ffy');
  live.send(C2S.QUEUE_JOIN, { mode: 'football' });
  await wait(400);
  const paired = !!live.last(S2C.MATCH_FOUND);
  const queued = !!live.last(S2C.QUEUED);
  live.bye();
  if (paired || !queued) return null;
  return { ms: 0, cause: '큐에서 제거됨', message: '' };
});

await scenario('방 생성 후 이탈 → 코드 무효화', async () => {
  const host = await open('ggx');
  host.send(C2S.ROOM_CREATE, { mode: 'curling' });
  await wait(200);
  const code = host.last(S2C.ROOM_CREATED).code;
  host.bye();
  await wait(300);

  const late = await open('ggy');
  late.send(C2S.ROOM_JOIN, { code });
  await wait(300);
  const err = late.last(S2C.ERROR);
  const found = late.last(S2C.MATCH_FOUND);
  late.bye();
  if (found || !err) return null;
  return { ms: 0, cause: err.code, message: err.message };
});

await scenario('정상 대전 — 오탐 없음 (10초)', async () => {
  const { ga, gb } = await playing('hh');
  ga.clear();
  gb.clear();
  await wait(10000); // twice the hard silence limit, both answering pings
  const bad = ga.last(S2C.OPPONENT_GONE) || gb.last(S2C.OPPONENT_GONE);
  ga.bye();
  gb.bye();
  if (bad) return null;
  return { ms: 0, cause: '오탐 없음', message: '' };
});

console.log('  시나리오                                   감지          경로');
console.log('  ' + '─'.repeat(66));
for (const [name, ms, cause, ok] of rows) {
  console.log(`  ${ok} ${name.padEnd(38)} ${String(ms).padStart(10)}   ${cause}`);
}
console.log(`\n${rows.length - failures}/${rows.length} passed\n`);
process.exit(failures ? 1 : 0);

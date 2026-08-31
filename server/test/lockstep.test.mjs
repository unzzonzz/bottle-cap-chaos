import assert from 'node:assert/strict';

import { C2S, PROTOCOL_VERSION, S2C, decode, encode } from '../../src/net/protocol.js';
import { OnlineSession } from '../../src/net/OnlineSession.js';
import { OnlineMatch } from '../../src/net/OnlineMatch.js';
import { Hub } from '../Hub.js';

import { initRapier } from '../../src/physics/rapier.js';
import { FIXED_DT, PhysicsWorld } from '../../src/physics/PhysicsWorld.js';
import { Match, MATCH_STATE } from '../../src/game/Match.js';
import { modeByKey } from '../../src/game/modes.js';
import { nextSeed, Rng } from '../../src/physics/rng.js';
import { replayConfig } from '../../src/replay/ReplayRunner.js';
import { capDimsHeadless } from '../../tools/determinism/capDims.mjs';

/**
 * Two complete game clients, playing each other through the real relay.
 *
 * ── this is the test the whole design exists to pass ──────────────────────
 * Everything else checks a piece: the determinism harness checks that one log
 * replays identically, the flow test checks that the server relays and times and
 * forfeits correctly. Neither of them runs the actual arrangement, which is two
 * independent `Match` instances, each with its own Rapier world, each simulating
 * only from the inputs the other one sent.
 *
 * If lockstep is wrong, it is wrong here and nowhere else — and it shows up as
 * the desync detector firing, which is exactly what it is for.
 *
 * Both clients are in one process, which is fine: they share no state. Two
 * `PhysicsWorld`s, two `Match`es, two `OnlineSession`s, and the only thing that
 * passes between them is JSON through `Hub`.
 *
 *   node server/test/lockstep.test.mjs
 */

await initRapier();
const capDims = await capDimsHeadless();

let failures = 0;
const results = [];
const queue = [];
const test = (name, fn) => queue.push({ name, fn });

/** A transport that speaks straight to a `Hub`, with no socket in between. */
function loopback(hub) {
  const handlers = new Map();
  const t = {
    state: 'open',
    connected: true,
    ping: 0,
    conn: null,
    send(type, body = {}) {
      // Deferred by a microtask so a handler that sends cannot re-enter the hub
      // from inside its own dispatch — the same ordering a real socket gives.
      queueMicrotask(() => hub.handle(t.conn, encode(type, body)));
      return true;
    },
    on(type, h) {
      let s = handlers.get(type);
      if (!s) handlers.set(type, (s = new Set()));
      s.add(h);
      return () => s.delete(h);
    },
    _emit(type, msg) {
      for (const h of [...(handlers.get(type) ?? [])]) h(msg);
    },
    close() {},
    dispose() {
      handlers.clear();
    },
  };
  t.conn = hub.connect({
    send: (raw) => {
      const msg = decode(raw);
      if (!msg) return;
      t._emit(msg.t, msg);
      t._emit('*', msg);
    },
    close: () => {},
  });
  return t;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

/** One client: a session, a physics world, a match, and the bridge. */
function makeClient(hub, config) {
  const transport = loopback(hub);
  const session = new OnlineSession({ config, transport });
  return { transport, session, physics: null, match: null, bridge: null };
}

function bootMatch(client, config) {
  const mode = modeByKey(client.session.match.mode);
  client.physics = new PhysicsWorld({
    solverIterations: config.physics.solverIterations,
    ccdSubsteps: config.physics.ccdSubsteps,
  });
  client.match = new Match({
    physics: client.physics,
    capDims,
    config,
    mode,
    seed: client.session.match.seed,
  });
  client.bridge = new OnlineMatch({ session: client.session, match: client.match });
}

/** Advance both clients one frame and let the loopback deliver. */
async function frame(clients) {
  for (const c of clients) {
    c.match.update(FIXED_DT);
    c.bridge.update();
  }
  await settle();
}

async function frames(clients, n) {
  for (let i = 0; i < n; i++) await frame(clients);
}

/**
 * Pair two clients and get both all the way to a running match.
 * Mirrors what the menu and the game document really do, including the handoff.
 */
async function pair(hub, config, mode) {
  const a = makeClient(hub, config);
  const b = makeClient(hub, config);

  a.session.hello('한별');
  b.session.hello('네오');
  await settle();

  a.session.createRoom(mode, { kind: 'none' });
  await settle();
  b.session.joinRoom(a.session.code, { kind: 'none' });
  await settle();

  // Both browsers navigate. The menu sockets die; game documents re-attach.
  const stashA = { ...a.session.match, opponent: a.session.opponent, nickname: '한별' };
  const stashB = { ...b.session.match, opponent: b.session.opponent, nickname: '네오' };
  hub.disconnect(a.transport.conn);
  hub.disconnect(b.transport.conn);

  const ga = makeClient(hub, config);
  const gb = makeClient(hub, config);
  ga.session.resume(stashA);
  gb.session.resume(stashB);
  await settle();

  bootMatch(ga, config);
  bootMatch(gb, config);

  /**
   * The relay's coin toss, applied — exactly as `main.js` does it.
   *
   * Without this both clients open on whichever player their rule set nominates
   * and the SERVER thinks somebody else is on move. The two clients still agree
   * with each other, which is why an earlier version of this file passed while
   * the real game was one turn out of phase from the first move.
   */
  ga.match.setFirstPlayer(ga.session.match.first);
  gb.match.setFirstPlayer(gb.session.match.first);

  ga.session.ready();
  gb.session.ready();
  await settle();

  return [ga, gb];
}

/**
 * Play a whole match, with the client whose turn it is taking a scripted shot.
 * Returns what happened, for the assertions.
 */
async function playMatch(hub, mode, { turns = 12, scriptSeed = 0xabcdef, power = [0.2, 0.5] } = {}) {
  const config = replayConfig();
  const clients = await pair(hub, config, mode);
  const [a, b] = clients;

  assert.equal(a.session.phase, 'playing', 'match never started');
  // The check that was missing: the clients must agree with the SERVER about
  // whose move it is, not merely with each other.
  assert.equal(
    a.match.rules.currentPlayer,
    a.session.current,
    'client and server disagree about who opens the match',
  );

  const script = new Rng(scriptSeed);
  let played = 0;

  for (let i = 0; i < turns; i++) {
    // Wait for a turn to be open and for both worlds to be idle.
    let guard = 0;
    while (
      (a.session.current < 0 ||
        a.match.state !== MATCH_STATE.AIM ||
        b.match.state !== MATCH_STATE.AIM) &&
      guard++ < 4000
    ) {
      await frame(clients);
    }
    if (a.session.over || b.session.over) break;
    if (a.match.state === MATCH_STATE.OVER) break;

    const seat = a.session.current;
    const me = clients[seat];
    const capIndex = me.match.shooter;
    if (capIndex < 0) break;

    const angle = script.signed() * Math.PI;
    const shot = {
      capIndex,
      dirX: Math.cos(angle),
      dirZ: Math.sin(angle),
      power: power[0] + script.float() * (power[1] - power[0]),
      // Drawn from the match's own stream exactly as `AimInput` does at press.
      seed: nextSeed(),
    };

    // The order a real local shot takes: record + send, then apply.
    me.bridge.localShot(shot);
    assert.ok(me.match.fire(shot), 'local fire refused');
    played++;

    // Let both simulate to rest and report.
    guard = 0;
    while (
      (a.match.state !== MATCH_STATE.AIM || b.match.state !== MATCH_STATE.AIM) &&
      !a.session.over &&
      guard++ < 4000
    ) {
      await frame(clients);
    }
    await frames(clients, 4);
    if (a.session.over) break;
  }

  await frames(clients, 6);
  return { a, b, played };
}

const newHub = () => new Hub({ log: () => {} });

// ── the real thing, per mode ───────────────────────────────────────────────

for (const mode of ['knockout', 'football', 'curling']) {
  test(`${mode}: two clients play in lockstep and never desync`, async () => {
    const hub = newHub();
    const { a, b, played } = await playMatch(hub, mode, { turns: 10 });

    assert.ok(played >= 4, `only ${played} turns were played`);
    assert.equal(a.session.desync, null, `client A saw a desync: ${JSON.stringify(a.session.desync)}`);
    assert.equal(b.session.desync, null, 'client B saw a desync');
    assert.equal(a.bridge.halted, null, `A halted: ${JSON.stringify(a.bridge.halted)}`);

    // The two worlds are the same world.
    assert.equal(
      a.match.physics.hashState(),
      b.match.physics.hashState(),
      'the two clients ended with different worlds',
    );
    assert.equal(
      a.match.rules.currentPlayer,
      b.match.rules.currentPlayer,
      'the two clients disagree about whose turn it is',
    );
    hub.close();
  });
}

test('both clients recorded the same input log', async () => {
  const hub = newHub();
  const { a, b } = await playMatch(hub, 'knockout', { turns: 8 });
  const strip = (log) =>
    log.events.map((e) => `${e.kind}:${e.player}:${e.rngState}:${e.seed ?? e.cardId ?? ''}`);
  assert.deepEqual(strip(a.bridge.log), strip(b.bridge.log), 'logs diverged');
  assert.ok(a.bridge.log.events.length >= 4);
  hub.close();
});

test('the recorded log replays to the same world it was recorded from', async () => {
  const { runLog } = await import('../../src/replay/ReplayRunner.js');
  const hub = newHub();
  const { a } = await playMatch(hub, 'knockout', { turns: 8 });

  const live = a.match.physics.hashState();
  const replayed = runLog(a.bridge.log, { capDims });
  assert.equal(
    replayed.finalHash,
    live,
    'replaying the match log did not reproduce the match',
  );
  hub.close();
});

// ── the detector actually detects ──────────────────────────────────────────

test('a deliberately corrupted client is caught by the desync check', async () => {
  const hub = newHub();
  const config = replayConfig();
  const [a, b] = await pair(hub, config, 'knockout');

  /**
   * B lies about its world exactly once, through the debug panel's own switch.
   *
   * An earlier version of this test monkey-patched `physics.hashState` and
   * silently proved nothing: `Match._beginAim` calls that method itself to take
   * the turn's `startHash`, so the one-shot lie was spent on the match's
   * internal bookkeeping and the REPORT went out with the true hash. The test
   * passed the corrupted client straight through and reported "undetected".
   *
   * Going through `forceDesync` tests the real path, and the real path is the
   * one the panel button uses.
   */
  b.bridge.forceDesync = true;

  const seat = a.session.current;
  const me = [a, b][seat];
  const shot = { capIndex: me.match.shooter, dirX: 1, dirZ: 0, power: 0.4, seed: nextSeed() };
  me.bridge.localShot(shot);
  me.match.fire(shot);

  for (let i = 0; i < 3000 && !a.session.desync; i++) await frame([a, b]);

  assert.ok(a.session.desync, 'a corrupted world went undetected');
  assert.ok(b.session.desync, 'the other client was not told');
  assert.equal(a.session.over?.reason, 'desync', 'the match did not stop');
  assert.ok(a.bridge.halted, 'the bridge did not halt');
  hub.close();
});

test('a mid-match disconnect forfeits and the survivor is told', async () => {
  const hub = newHub();
  const config = replayConfig();
  const [a, b] = await pair(hub, config, 'football');

  let told = null;
  a.session.on('opponentGone', (m) => (told = m));
  hub.disconnect(b.transport.conn);
  await frames([a, b], 3);

  assert.ok(told, 'survivor was never told');
  assert.equal(told.reason, 'disconnect');
  assert.equal(a.session.over?.winner, a.session.mySeat, 'survivor did not win');
  assert.ok(a.bridge.halted, 'the match kept running');
  hub.close();
});

test('a skipped turn advances both clients identically', async () => {
  const hub = newHub();
  const config = replayConfig();
  const [a, b] = await pair(hub, config, 'knockout');

  const before = a.match.rules.currentPlayer;
  // The server's timeout message, delivered without waiting fifteen seconds.
  const room = [...hub.rooms.values()][0];
  room.expire();
  await frames([a, b], 40);

  assert.notEqual(a.match.rules.currentPlayer, before, 'the turn did not pass');
  assert.equal(
    a.match.rules.currentPlayer,
    b.match.rules.currentPlayer,
    'the clients disagree about whose turn it is after a skip',
  );
  assert.equal(
    a.match.physics.hashState(),
    b.match.physics.hashState(),
    'a skip changed the world differently on the two clients',
  );
  assert.equal(a.session.desync, null, 'the skip was reported as a desync');
  hub.close();
});

// ── report ─────────────────────────────────────────────────────────────────

console.log('\nlockstep — two real clients through the real relay\n');
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
console.log(
  `\n${queue.length - failures}/${queue.length} passed` +
    (failures ? `  —  ${failures} FAILED\n` : '\n'),
);
process.exit(failures ? 1 : 0);

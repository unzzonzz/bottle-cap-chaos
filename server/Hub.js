import {
  C2S,
  DETECT,
  ERR,
  ERR_TEXT,
  OVER_REASON,
  PROTOCOL_VERSION,
  ROOM_PHASE,
  S2C,
  TIMING,
  decode,
  encode,
  isValidCode,
  isValidMark,
  makeCode,
  normaliseCode,
} from '../src/net/protocol.js';
import { MemoryNicknameRegistry } from './NicknameRegistry.js';
import { Room } from './Room.js';

/**
 * Everything that is not one match: who is connected, who is called what, which
 * rooms exist, and who is waiting for one.
 *
 * ── the transport is a parameter, not an import ────────────────────────────
 * Nothing here mentions `ws`, `http`, or a socket API. A connection is any
 * object with `send(type, body)` and `close()`, which `index.js` supplies. That
 * is not ceremony: it is what lets the whole server be driven by a fake
 * connection in a test — see `server/test/` — and it is also what a move to a
 * different transport later would otherwise have to unpick.
 *
 * ── state is in memory and that is the whole design ────────────────────────
 * No database, by instruction. Rooms, queues and nicknames live in `Map`s and
 * die with the process. The one place that limitation needs to be visible to a
 * reader is nicknames, and it is written up at length in `NicknameRegistry`.
 */

let nextConnId = 1;

export class Hub {
  constructor({
    timing = TIMING,
    random = Math.random,
    log = console.log,
    registry = new MemoryNicknameRegistry(),
    modes = ['knockout', 'football', 'curling'],
  } = {}) {
    this.timing = timing;
    this.random = random;
    this.log = log;
    this.registry = registry;
    this.modes = new Set(modes);

    /** connId -> conn */
    this.conns = new Map();
    /** roomId -> Room */
    this.rooms = new Map();
    /** invite code -> roomId */
    this.byCode = new Map();
    /** mode -> conn[] , in arrival order */
    this.queues = new Map(modes.map((m) => [m, []]));

    this._sweeper = setInterval(() => this.sweep(), 10_000);
    // Never hold the process open on the janitor alone.
    this._sweeper.unref?.();
  }

  // ── connections ──────────────────────────────────────────────────────────

  /**
   * @param {{send: (raw: string) => void, close: () => void}} socket
   * @returns the connection handle to feed messages into
   */
  connect(socket) {
    const conn = {
      id: `c${nextConnId++}`,
      socket,
      nickname: null,
      configHash: null,
      roomId: null,
      queuedFor: null,
      alive: true,
      lastPong: Date.now(),
      /** When the last ping went out, and the round trip it measured. */
      pingSentAt: 0,
      rtt: 0,
      /**
       * Consecutive pings this socket has failed to answer.
       *
       * The heartbeat's actual rule — see `TIMING.heartbeatMisses`. Reset by any
       * pong, so a single dropped packet costs nothing and three in a row is a
       * verdict.
       */
      misses: 0,
      openedAt: Date.now(),
      send: (type, body) => {
        try {
          socket.send(encode(type, body));
        } catch {
          /* a send to a closing socket is not an error worth unwinding for */
        }
      },
      fail: (code) => {
        conn.send(S2C.ERROR, { code, message: ERR_TEXT[code] ?? code });
      },
    };
    this.conns.set(conn.id, conn);
    return conn;
  }

  /**
   * A connection is gone. THE one cleanup path.
   *
   * ── every route into this is the same route ────────────────────────────
   * `close`, `error`, a heartbeat verdict, a turn timer that found nobody
   * there, a hash that never arrived, the janitor — all of them end up here,
   * and the only thing that differs is `cause`, which is recorded so the log
   * says which defence actually fired. Five detectors that each did their own
   * tidying would be five chances to tidy differently, and the bug this is
   * fixing was exactly that: some paths told the opponent and some did not.
   *
   * Idempotent by the first line. `close` and `error` both fire for the same
   * socket routinely, and a heartbeat verdict can race either of them.
   *
   * @param {string} cause  a `DETECT` value
   */
  disconnect(conn, cause = DETECT.SOCKET) {
    if (!this.conns.has(conn.id)) return;
    this.conns.delete(conn.id);
    conn.alive = false;
    this.registry.release(conn.id);

    const wasQueued = conn.queuedFor;
    this.dequeue(conn);

    const room = conn.roomId ? this.rooms.get(conn.roomId) : null;
    this.log(
      `conn ${conn.id} (${conn.nickname ?? '-'}) dropped [${cause}]` +
        (room ? ` room=${room.id} phase=${room.phase}` : wasQueued ? ` queue=${wasQueued}` : ''),
    );

    if (room) {
      room.drop(conn, { cause });
      // An OPEN room whose only occupant just left is wreckage with a live
      // invite code attached. Destroyed here rather than left for the sweeper,
      // because until it is gone the code still resolves — and whoever types it
      // lands in a room that can never pair. That was one of the ghost matches.
      if (room.occupied === 0 || room.phase === ROOM_PHASE.OVER) this.destroy(room);
    }

    // Never leave the socket half-open behind a logical drop.
    try {
      conn.socket.close();
    } catch {
      /* already gone */
    }
  }

  /** Is this connection one we still believe in? */
  isAlive(conn) {
    return !!conn && conn.alive && this.conns.has(conn.id);
  }

  // ── the message loop ─────────────────────────────────────────────────────

  handle(conn, raw) {
    const msg = decode(raw);
    if (!msg) return conn.fail(ERR.BAD_MESSAGE);

    switch (msg.t) {
      case C2S.HELLO:
        return this.onHello(conn, msg);
      case C2S.PONG:
        conn.lastPong = Date.now();
        /**
         * The round trip, measured where it can actually be measured.
         *
         * The client cannot time this by itself: all it sees is one ping
         * arriving after another, so anything it computes locally is the
         * heartbeat INTERVAL wearing a latency's name — which is exactly what
         * the panel showed, a rock-steady 5003 ms. The server sent the ping, so
         * the server knows when, and it hands the answer back on the next one.
         */
        if (conn.pingSentAt) conn.rtt = Date.now() - conn.pingSentAt;
        return;
      case C2S.ROOM_CREATE:
        return this.onRoomCreate(conn, msg);
      case C2S.ROOM_JOIN:
        return this.onRoomJoin(conn, msg);
      case C2S.ROOM_LEAVE:
        return this.onRoomLeave(conn);
      case C2S.QUEUE_JOIN:
        return this.onQueueJoin(conn, msg);
      case C2S.QUEUE_LEAVE:
        return this.onQueueLeave(conn);
      case C2S.RESUME:
        return this.onResume(conn, msg);
      case C2S.READY:
        return this.withRoom(conn, (room, seat) => room.markReady(seat));
      case C2S.INPUT:
        return this.withRoom(conn, (room, seat) => {
          const res = room.input(seat, msg);
          if (!res.ok) conn.fail(res.code);
        });
      case C2S.HASH:
        return this.withRoom(conn, (room, seat) => {
          room.report(seat, msg);
          this.reapIfDone(room);
        });
      case C2S.FORFEIT:
        return this.withRoom(conn, (room) => {
          room.drop(conn, { reason: OVER_REASON.FORFEIT, cause: DETECT.FORFEIT });
          this.reapIfDone(room);
        });
      default:
        return conn.fail(ERR.BAD_MESSAGE);
    }
  }

  withRoom(conn, fn) {
    const room = conn.roomId ? this.rooms.get(conn.roomId) : null;
    if (!room) return conn.fail(ERR.ROOM_NOT_FOUND);
    const seat = room.seatOf(conn);
    if (seat < 0) return conn.fail(ERR.ROOM_NOT_FOUND);
    fn(room, seat);
  }

  // ── handshake ────────────────────────────────────────────────────────────

  /**
   * Register a name and agree on what game we are both playing.
   *
   * ── the config hash is checked between PLAYERS, not against the server ────
   * The server has no config of its own and should not have one: it does not
   * simulate, so it has no opinion about friction. What it does is remember what
   * each client claimed and refuse to pair two clients that claimed differently
   * — see `pairable`. A relay that held a canonical config would have to be
   * redeployed every time somebody tuned a card.
   */
  onHello(conn, msg) {
    if (msg.protocol !== PROTOCOL_VERSION) return conn.fail(ERR.PROTOCOL_MISMATCH);

    const claimed = this.registry.claim(msg.nickname, conn.id);
    if (!claimed.ok) {
      return conn.send(S2C.ERROR, { code: claimed.code, message: claimed.message });
    }

    conn.nickname = claimed.value;
    conn.configHash = String(msg.configHash ?? '');
    conn.send(S2C.HELLO_OK, {
      nickname: claimed.value,
      protocol: PROTOCOL_VERSION,
      timing: this.timing,
    });
  }

  needsName(conn) {
    if (conn.nickname) return false;
    conn.fail(ERR.NOT_REGISTERED);
    return true;
  }

  // ── invite rooms ─────────────────────────────────────────────────────────

  onRoomCreate(conn, msg) {
    if (this.needsName(conn)) return;
    if (conn.roomId) return conn.fail(ERR.ALREADY_IN_ROOM);
    if (!this.modes.has(msg.mode)) return conn.fail(ERR.BAD_MODE);

    const code = this.freshCode();
    const room = new Room({
      mode: msg.mode,
      code,
      random: this.random,
      timing: this.timing,
      log: this.log,
      isAlive: (c) => this.isAlive(c),
    });
    room.add(conn, conn.nickname);
    room.setMark(0, isValidMark(msg.mark) ? msg.mark : { kind: 'none' });
    conn.roomId = room.id;

    this.rooms.set(room.id, room);
    this.byCode.set(code, room.id);
    this.dequeue(conn);

    conn.send(S2C.ROOM_CREATED, {
      code,
      mode: msg.mode,
      expiresAt: room.createdAt + this.timing.roomTtlMs,
    });
    this.log(`room ${room.id}: created by ${conn.nickname} (${msg.mode}) code=${code}`);
  }

  onRoomJoin(conn, msg) {
    if (this.needsName(conn)) return;
    if (conn.roomId) return conn.fail(ERR.ALREADY_IN_ROOM);

    const code = normaliseCode(msg.code);
    if (!isValidCode(code)) return conn.fail(ERR.ROOM_NOT_FOUND);

    const room = this.rooms.get(this.byCode.get(code) ?? '');
    if (!room) return conn.fail(ERR.ROOM_NOT_FOUND);
    if (room.expired) {
      this.destroy(room);
      return conn.fail(ERR.ROOM_EXPIRED);
    }
    if (room.phase !== ROOM_PHASE.OPEN || room.occupied >= 2) return conn.fail(ERR.ROOM_FULL);

    const host = room.seats[0];
    // The host may have gone without the socket saying so. Joining a room whose
    // creator is a corpse is the invite-code version of the ghost match.
    if (host && !this.isAlive(host.conn)) {
      this.log(`room ${room.id}: host is gone; refusing the join and destroying`);
      this.destroy(room);
      return conn.fail(ERR.ROOM_NOT_FOUND);
    }
    if (host && host.conn.configHash !== conn.configHash) {
      return conn.fail(ERR.CONFIG_MISMATCH);
    }

    const seat = room.add(conn, conn.nickname);
    if (seat < 0) return conn.fail(ERR.ROOM_FULL);
    room.setMark(seat, isValidMark(msg.mark) ? msg.mark : { kind: 'none' });
    conn.roomId = room.id;
    this.dequeue(conn);

    // The code is spent the moment the room is full. Leaving it in the table
    // would let a third person type it and get ROOM_FULL for a room that is
    // really mid-match, which is a worse message than "그런 방이 없습니다".
    this.byCode.delete(code);
    room.pair();
    this.log(`room ${room.id}: ${conn.nickname} joined by code`);
  }

  onRoomLeave(conn) {
    const room = conn.roomId ? this.rooms.get(conn.roomId) : null;
    if (!room) return;
    room.drop(conn, { reason: OVER_REASON.FORFEIT, cause: DETECT.FORFEIT });
    conn.roomId = null;
    conn.send(S2C.ROOM_LEFT, {});
    // An emptied room and its code go together — see `disconnect`.
    if (room.occupied === 0 || room.phase === ROOM_PHASE.OVER) this.destroy(room);
  }

  freshCode() {
    for (let i = 0; i < 200; i++) {
      const code = makeCode(this.random);
      if (!this.byCode.has(code)) return code;
    }
    // 31^6 codes against a table that lives in one process — reaching here means
    // something is very wrong, and inventing a colliding code would be worse.
    throw new Error('could not find a free invite code');
  }

  // ── random matching ──────────────────────────────────────────────────────

  onQueueJoin(conn, msg) {
    if (this.needsName(conn)) return;
    if (conn.roomId) return conn.fail(ERR.ALREADY_IN_ROOM);
    if (!this.modes.has(msg.mode)) return conn.fail(ERR.BAD_MODE);

    this.dequeue(conn);
    conn.queuedMark = isValidMark(msg.mark) ? msg.mark : { kind: 'none' };

    const queue = this.queues.get(msg.mode);
    /**
     * Somebody compatible already waiting, AND still there?
     *
     * The liveness test is the fix for a whole class of ghost match: a client
     * that died without a close event sits in this queue until the heartbeat
     * notices, and for those seconds the next player to arrive was paired with
     * a corpse — both were told the match was on, one of them navigated into a
     * game document, and nobody was ever coming. Dead entries are dropped on
     * the way past rather than skipped, so the queue cleans itself.
     */
    let idx = -1;
    for (let i = 0; i < queue.length; ) {
      const other = queue[i];
      if (!this.isAlive(other)) {
        this.log(`queue ${msg.mode}: dropping dead waiter ${other.id}`);
        queue.splice(i, 1);
        other.queuedFor = null;
        continue;
      }
      if (other.configHash === conn.configHash) {
        idx = i;
        break;
      }
      i++;
    }
    if (idx >= 0) {
      const [other] = queue.splice(idx, 1);
      other.queuedFor = null;
      return this.pairFromQueue(msg.mode, other, conn);
    }

    conn.queuedFor = msg.mode;
    queue.push(conn);
    conn.send(S2C.QUEUED, { mode: msg.mode, since: Date.now(), waiting: queue.length });
  }

  pairFromQueue(mode, a, b) {
    /**
     * The last gate before two people are told a match exists.
     *
     * Both were alive a moment ago — the queue scan just checked — but "a
     * moment ago" is the entire problem this bug is made of. Whichever survives
     * goes back to the front of the queue rather than being dropped: they did
     * nothing wrong and were about to get a game.
     */
    for (const [live, dead] of [[a, b], [b, a]]) {
      if (this.isAlive(dead)) continue;
      this.log(`queue ${mode}: pairing aborted, ${dead.id} is gone [${DETECT.SOCKET}]`);
      if (this.isAlive(live)) {
        live.queuedFor = mode;
        this.queues.get(mode).unshift(live);
        live.send(S2C.QUEUED, { mode, since: Date.now(), waiting: this.queues.get(mode).length });
      }
      return;
    }

    const room = new Room({
      mode,
      code: null,
      random: this.random,
      timing: this.timing,
      log: this.log,
      isAlive: (c) => this.isAlive(c),
    });
    this.rooms.set(room.id, room);

    const sa = room.add(a, a.nickname);
    const sb = room.add(b, b.nickname);
    room.setMark(sa, a.queuedMark ?? { kind: 'none' });
    room.setMark(sb, b.queuedMark ?? { kind: 'none' });
    a.roomId = room.id;
    b.roomId = room.id;

    room.pair();
    this.log(`room ${room.id}: queue paired ${a.nickname} vs ${b.nickname} (${mode})`);
  }

  onQueueLeave(conn) {
    this.dequeue(conn);
    conn.send(S2C.QUEUE_LEFT, {});
  }

  dequeue(conn) {
    if (!conn.queuedFor) return;
    const queue = this.queues.get(conn.queuedFor);
    const i = queue?.indexOf(conn) ?? -1;
    if (i >= 0) queue.splice(i, 1);
    conn.queuedFor = null;
  }

  // ── handoff ──────────────────────────────────────────────────────────────

  /**
   * The game document arriving with the token the menu document was given.
   *
   * This is the seam that exists because entering a match is a real navigation
   * and the matchmaking socket cannot survive it. The token names both the room
   * and the seat, so nothing else has to be re-established.
   */
  onResume(conn, msg) {
    const roomId = String(msg.roomId ?? '');
    const room = this.rooms.get(roomId);
    if (!room) return conn.fail(ERR.BAD_TOKEN);

    const seat = room.resume(conn, String(msg.token ?? ''));
    if (seat < 0) return conn.fail(ERR.BAD_TOKEN);

    conn.roomId = room.id;
    conn.nickname = room.seats[seat].nickname;
    conn.configHash = String(msg.configHash ?? '');

    const them = room.seats[room.other(seat)];
    conn.send(S2C.MATCH_FOUND, {
      roomId: room.id,
      token: room.seats[seat].token,
      mode: room.mode,
      seed: room.seed,
      seat,
      first: room.first,
      turnMs: this.timing.turnMs,
      opponent: { nickname: them?.nickname ?? '', mark: them?.mark ?? null },
      self: { nickname: conn.nickname },
      timing: this.timing,
      resumed: true,
    });
  }

  // ── housekeeping ─────────────────────────────────────────────────────────

  /** The server pings; a client that stops answering is gone. */
  heartbeat() {
    const now = Date.now();
    for (const conn of [...this.conns.values()]) {
      // Did the PREVIOUS ping come back? A pong updates `lastPong`, so a socket
      // that answered has `lastPong` after the ping we sent it.
      if (conn.pingSentAt && conn.lastPong < conn.pingSentAt) conn.misses++;
      else conn.misses = 0;

      const silent = now - conn.lastPong;
      if (
        conn.misses >= this.timing.heartbeatMisses ||
        silent > this.timing.heartbeatTimeoutMs
      ) {
        this.log(
          `conn ${conn.id} (${conn.nickname ?? '-'}): ${conn.misses} missed pings, ` +
            `${silent}ms silent`,
        );
        this.disconnect(conn, DETECT.HEARTBEAT);
        continue;
      }
      conn.pingSentAt = now;
      conn.send(S2C.PING, { t: now, rtt: conn.rtt ?? 0 });
    }

    // The rooms get a look at the same tick: a turn whose clock has stopped and
    // whose opponent is gone has nothing else watching it.
    for (const room of [...this.rooms.values()]) {
      room.audit(now);
      if (room.phase === ROOM_PHASE.OVER) this.destroy(room);
    }
  }

  sweep() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.expired || room.phase === ROOM_PHASE.OVER) {
        this.destroy(room);
        continue;
      }
      /**
       * The janitor of last resort.
       *
       * `expired` only ever answered for OPEN rooms, so a room that got stuck in
       * PLAYING — which is precisely what the ghost-match bug produced — was
       * never collected by anything. This is deliberately far longer than any
       * real match: it is not a timeout, it is a guarantee that nothing lives
       * forever.
       */
      if (now - room.createdAt > this.timing.roomMaxMs) {
        this.log(`room ${room.id}: age limit [${DETECT.ROOM_AGE}] phase=${room.phase}`);
        room.finish(null, OVER_REASON.DISCONNECT, '방이 만료되었습니다', DETECT.ROOM_AGE);
        this.destroy(room);
      }
    }
  }

  reapIfDone(room) {
    if (room.phase === ROOM_PHASE.OVER) this.destroy(room);
  }

  destroy(room) {
    room.dispose();
    this.rooms.delete(room.id);
    if (room.code) this.byCode.delete(room.code);
    for (const s of room.seats) {
      if (s?.conn && s.conn.roomId === room.id) s.conn.roomId = null;
    }
  }

  /**
   * What the relay currently believes, in enough detail to debug a stuck match.
   *
   * ── the per-seat state is the point ────────────────────────────────────
   * "방 목록 + 각 방의 플레이어 연결 상태", and the number that actually settles
   * arguments is `silentMs`: a seat that is present, in a room, and has not
   * answered a ping for twelve seconds is the one about to be written off, and
   * without this you are guessing.
   */
  stats() {
    const now = Date.now();
    const seatOf = (s) =>
      s
        ? {
            nickname: s.nickname,
            present: s.present,
            resumed: s.resumed,
            ready: s.ready,
            alive: this.isAlive(s.conn),
            silentMs: s.conn ? now - s.conn.lastPong : null,
            misses: s.conn?.misses ?? null,
            rtt: s.conn?.rtt ?? null,
          }
        : null;

    return {
      connections: this.conns.size,
      nicknames: this.registry.list(),
      openCodes: this.byCode.size,
      queued: Object.fromEntries(
        [...this.queues].map(([m, q]) => [
          m,
          q.map((c) => ({
            nickname: c.nickname,
            alive: this.isAlive(c),
            silentMs: now - c.lastPong,
          })),
        ]),
      ),
      rooms: [...this.rooms.values()].map((r) => ({
        id: r.id,
        mode: r.mode,
        code: r.code,
        phase: r.phase,
        ageMs: now - r.createdAt,
        turn: r.turn,
        current: r.current,
        seats: r.seats.map(seatOf),
      })),
    };
  }

  close() {
    clearInterval(this._sweeper);
    for (const room of [...this.rooms.values()]) this.destroy(room);
  }
}

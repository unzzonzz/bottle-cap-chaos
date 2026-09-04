import {
  DETECT,
  ERR,
  ERR_TEXT,
  OVER_REASON,
  ROOM_PHASE,
  S2C,
  TIMING,
} from '../src/net/protocol.js';

/**
 * One match, from "two people found each other" to "somebody won".
 *
 * ── what this owns, and the much longer list of what it does not ───────────
 * It owns the CLOCK and the ADJUDICATION. It does not own the game.
 *
 * There is no physics here, no rules, no board, and there will not be. Both
 * clients run the whole simulation from a seed this hands out, and this relays
 * their inputs and times them. That is the entire arrangement, and the reason
 * for it is that a relay which also simulated would be a third opinion — and
 * with three opinions the interesting question stops being "do the players
 * agree" and becomes "which of the three is right", which is not a question a
 * game can recover from mid-match.
 *
 * ── so how does it know whose turn is next? It asks, and requires agreement ─
 * This is the one thing a stateless relay cannot work out for itself. Turn order
 * is not alternation: a football goal hands the kickoff to the side that
 * conceded, 원모어 buys the same player another turn, and curling's rounds have
 * their own lead. All of that lives in the rule sets, on the clients.
 *
 * So each client, having finished simulating a turn, reports what it believes:
 * the state hash AND whose turn is next AND whether the match is over. The
 * server compares the two reports. Agreement advances the match; disagreement is
 * a desync and stops it. The server is therefore authoritative over the thing it
 * can actually be authoritative about — whether the two peers still agree — and
 * the clients stay authoritative over the simulation, which is where the
 * simulation is.
 *
 * It also means the turn hash comparison and the "is the presentation finished"
 * signal are the same message, which is what makes the timer honest: the next
 * turn's clock cannot start until both players have actually finished watching
 * the previous one.
 */

let nextRoomId = 1;

export class Room {
  /**
   * @param {object} opts
   * @param {string} opts.mode
   * @param {string|null} opts.code     invite code, or null for a queue match
   * @param {() => number} opts.random  seeds and codes; injected for tests
   * @param {object} opts.timing
   * @param {(...a: unknown[]) => void} opts.log
   */
  constructor({
    mode,
    code = null,
    random = Math.random,
    timing = TIMING,
    log = () => {},
    isAlive = () => true,
  }) {
    /**
     * Is a seat's socket still one the hub believes in?
     *
     * Injected rather than reached for, like everything else here — the room has
     * no connection table and should not grow one. It is what turns the turn
     * clock from a thing that only counts into a thing that also LOOKS.
     */
    this._isAlive = isAlive;
    this.id = `r${nextRoomId++}`;
    this.mode = mode;
    this.code = code;
    this.random = random;
    this.timing = timing;
    this.log = log;

    this.phase = ROOM_PHASE.OPEN;
    this.createdAt = Date.now();

    /**
     * The two seats, by index. `seats[0]` moves first unless the coin says
     * otherwise — see `pair`.
     * @type {Array<null | {conn: object, nickname: string, mark: object|null,
     *                     token: string, present: boolean, ready: boolean}>}
     */
    this.seats = [null, null];

    /** 32-bit. Handed to both clients; reproduces the entire match. */
    this.seed = 0;
    /** Which seat takes the first turn. Server's call, as the brief requires. */
    this.first = 0;

    /** Turn ordinal, from zero. Gap-free. */
    this.turn = 0;
    /** Whose turn it is now. */
    this.current = 0;
    /** Monotonic input ordinal, so a duplicate or a reorder is visible. */
    this.seq = 0;

    /** turn -> {seat -> report}. Cleared as each turn resolves. */
    this._reports = new Map();

    this._deadline = 0;
    this._timer = null;
    this._handoffTimer = null;
    /** Set while a finished turn is waiting for both hashes. See `audit`. */
    this._reportDeadline = 0;
    /** Consecutive expiries per seat. Reset by any input from that seat. */
    this._skips = [0, 0];

    this.over = null;
  }

  // ── seating ──────────────────────────────────────────────────────────────

  get occupied() {
    return this.seats.filter(Boolean).length;
  }

  seatOf(conn) {
    return this.seats.findIndex((s) => s?.conn === conn);
  }

  other(seat) {
    return seat === 0 ? 1 : 0;
  }

  /** @returns the seat index, or -1 if there was no room. */
  add(conn, nickname) {
    const seat = this.seats.findIndex((s) => s === null);
    if (seat < 0) return -1;
    this.seats[seat] = {
      conn,
      nickname,
      mark: null,
      // Not a secret worth protecting — it authorises re-attaching to a room
      // that is already yours — but it must not be guessable from the room id,
      // or a bystander could take a seat during the handoff window.
      token: `${this.id}.${seat}.${Math.floor(this.random() * 0xffffffff).toString(36)}`,
      present: true,
      ready: false,
      /**
       * Has this seat come back from the navigation yet?
       *
       * The difference between "expected silence" and "gone". During HANDOFF a
       * closed socket is the page changing; once a seat has RESUMED, a closed
       * socket is a person leaving, and the two must not be treated alike — the
       * old code treated every HANDOFF drop as expected and left the survivor
       * waiting a full minute for a message that never named the cause.
       */
      resumed: false,
    };
    return seat;
  }

  /**
   * Both seats are full. Draw the match's parameters and tell everybody.
   *
   * The seed and the first player are decided HERE, on the server, and pushed to
   * both clients — rather than negotiated or derived from anything either client
   * supplied. A client that chose its own seed could replay a match it liked; a
   * client that chose who goes first would always go first.
   */
  pair() {
    if (this.occupied !== 2) return;
    this.seed = Math.floor(this.random() * 0xffffffff) >>> 0;
    this.first = this.random() < 0.5 ? 0 : 1;
    this.current = this.first;
    this.phase = ROOM_PHASE.HANDOFF;

    for (let seat = 0; seat < 2; seat++) {
      const me = this.seats[seat];
      const them = this.seats[this.other(seat)];
      me.conn.send(S2C.MATCH_FOUND, {
        roomId: this.id,
        token: me.token,
        mode: this.mode,
        seed: this.seed,
        seat,
        first: this.first,
        turnMs: this.timing.turnMs,
        opponent: { nickname: them.nickname, mark: them.mark },
        self: { nickname: me.nickname },
        timing: this.timing,
      });
    }

    // The clients are about to navigate from the menu document to the game
    // document, which drops both sockets. That is expected and is NOT a forfeit
    // — see ROOM_PHASE. This is the ceiling on how long it may take.
    this._handoffTimer = setTimeout(() => {
      if (this.phase !== ROOM_PHASE.HANDOFF && this.phase !== ROOM_PHASE.READYING) return;
      /**
       * Whoever never arrived loses; whoever did wins and is told so in the
       * ordinary words. The old version finished with `winner: null` and no
       * OPPONENT_GONE at all, so the survivor's client had nothing to show and
       * nobody had won — a full minute of silence ending in a shrug.
       */
      const missing = this.seats.findIndex((s) => s && !s.resumed);
      if (missing >= 0) this.forfeit(missing, OVER_REASON.DISCONNECT, DETECT.HANDOFF);
      else this.finish(null, OVER_REASON.DISCONNECT, '상대가 게임에 들어오지 못했습니다', DETECT.HANDOFF);
    }, this.timing.handoffMs);
  }

  /**
   * A game document arriving with a token from the menu document.
   *
   * The socket is REPLACED rather than added: it is the same player in the same
   * seat, reached over a new connection, and the old one is already closed.
   */
  resume(conn, token) {
    const seat = this.seats.findIndex((s) => s?.token === token);
    if (seat < 0) return -1;
    const s = this.seats[seat];
    s.conn = conn;
    s.present = true;
    s.resumed = true;
    if (this.phase === ROOM_PHASE.HANDOFF) this.phase = ROOM_PHASE.READYING;
    return seat;
  }

  /** Marks are swapped once, at pairing, and are part of `MATCH_FOUND`. */
  setMark(seat, mark) {
    if (this.seats[seat]) this.seats[seat].mark = mark;
  }

  // ── the match ────────────────────────────────────────────────────────────

  /**
   * A client has finished its opening cutscene and is showing the board.
   *
   * The first turn's clock starts when BOTH have said this, never before — a
   * player who spent the intro watching the intro has not spent any of their
   * fifteen seconds. Same principle as waiting for both hashes between turns.
   */
  markReady(seat) {
    const s = this.seats[seat];
    if (!s || s.ready) return;
    s.ready = true;
    if (!this.seats.every((x) => x?.ready)) return;

    clearTimeout(this._handoffTimer);
    this._handoffTimer = null;
    this.phase = ROOM_PHASE.PLAYING;
    this.broadcast(S2C.MATCH_START, {
      seed: this.seed,
      first: this.first,
      turnMs: this.timing.turnMs,
    });
    this.beginTurn();
  }

  beginTurn() {
    if (this.phase !== ROOM_PHASE.PLAYING) return;
    this._reportDeadline = 0;
    this._deadline = Date.now() + this.timing.turnMs;
    this.broadcast(S2C.TURN_BEGIN, {
      turn: this.turn,
      player: this.current,
      turnMs: this.timing.turnMs,
      deadline: this._deadline,
    });
    this.arm();
  }

  arm() {
    clearTimeout(this._timer);
    const left = Math.max(0, this._deadline - Date.now());
    this._timer = setTimeout(() => this.expire(), left);
  }

  /**
   * The clock ran out.
   *
   * NOTHING IS PLAYED. The brief is explicit and it is the right call: a server
   * that picked a shot on a player's behalf would be inventing a move that the
   * player will be judged on, and in a game where a bad flick loses you a cap
   * that is worse than losing the turn. The turn simply passes.
   *
   * The clients still report a hash for the skipped turn, exactly as they do for
   * a played one, so a skip cannot become a hole in the desync audit.
   */
  expire() {
    if (this.phase !== ROOM_PHASE.PLAYING) return;

    /**
     * ── the clock LOOKS before it skips ────────────────────────────────────
     * This is the fix at the heart of the ghost match. The old version skipped
     * the turn unconditionally, so a player who had vanished was handed turn
     * after turn — and because a turn only advances when BOTH clients report a
     * hash, the room then froze on the first skip with no clock left running
     * and nothing else watching. The survivor waited forever.
     */
    const seat = this.current;
    if (!this._isAlive(this.seats[seat]?.conn)) {
      this.forfeit(seat, OVER_REASON.DISCONNECT, DETECT.TURN_TIMER);
      return;
    }

    this._skips[seat]++;
    this.log(
      `room ${this.id}: turn ${this.turn} expired for seat ${seat} ` +
        `(${this._skips[seat]} in a row)`,
    );
    this.broadcast(S2C.TURN_SKIP, { turn: this.turn, player: seat });

    /**
     * A skip ends a turn, so the same deadline a shot gets applies: both
     * clients have to report, and if one never does this is what notices.
     */
    this._armReportDeadline();

    /**
     * The last net, under everything else.
     *
     * A player who lets several turns run out in a row while still answering
     * pings is not necessarily gone — they might be away from the screen — so
     * this does not end the match. It forces the question: the socket is pinged
     * immediately and the ordinary heartbeat rule judges the answer. If they
     * really are a zombie that the miss counter has not caught yet, this is what
     * shortens the wait.
     */
    if (this._skips[seat] >= (this.timing.maxSkips ?? 3)) {
      this.log(`room ${this.id}: seat ${seat} hit the skip cap [${DETECT.SKIPS}] — probing`);
      this._skips[seat] = 0;
      const conn = this.seats[seat]?.conn;
      if (conn) {
        conn.pingSentAt = Date.now();
        conn.send(S2C.PING, { t: Date.now(), rtt: conn.rtt ?? 0 });
      }
    }
  }

  _armReportDeadline() {
    this._reportDeadline = Date.now() + (this.timing.hashTimeoutMs ?? 30000);
  }

  /**
   * The per-tick sanity check, run from the hub's heartbeat.
   *
   * ── it exists because the clock stops between turns ───────────────────────
   * From the moment a shot is fired until both hashes arrive there is no turn
   * timer — deliberately, because a simulation takes as long as it takes. That
   * left a window with NOTHING watching it, and an opponent who died inside it
   * froze the match. This is what watches it.
   */
  audit(now = Date.now()) {
    if (this.phase !== ROOM_PHASE.PLAYING) return;

    // A seat whose socket has gone, noticed on the tick rather than waiting for
    // whatever the room happened to be doing to time out.
    for (let seat = 0; seat < 2; seat++) {
      if (!this._isAlive(this.seats[seat]?.conn)) {
        this.forfeit(seat, OVER_REASON.DISCONNECT, DETECT.HEARTBEAT);
        return;
      }
    }

    if (!this._reportDeadline || now < this._reportDeadline) return;
    this._reportDeadline = 0;

    // Both are alive by the test above, so somebody is alive and not answering.
    // Whoever owes a report loses it: a client that has stopped taking part is
    // not different, from here, from one that has left.
    const forTurn = this._reports.get(this.turn);
    for (let seat = 0; seat < 2; seat++) {
      if (!forTurn?.has(seat)) {
        this.forfeit(seat, OVER_REASON.DISCONNECT, DETECT.HASH_TIMEOUT);
        return;
      }
    }
  }

  /**
   * Relay one input, having checked it is allowed.
   *
   * @returns {{ok: true} | {ok: false, code: string, message: string}}
   */
  input(seat, msg) {
    if (this.phase !== ROOM_PHASE.PLAYING) {
      return { ok: false, code: ERR.BAD_MESSAGE, message: ERR_TEXT[ERR.BAD_MESSAGE] };
    }
    if (seat !== this.current) {
      return { ok: false, code: ERR.NOT_YOUR_TURN, message: ERR_TEXT[ERR.NOT_YOUR_TURN] };
    }
    if (msg.turn !== this.turn) {
      // Late — almost always the loser of a race against the turn timer. Refused
      // rather than applied, because applying it would play a move into a turn
      // the other client has already been told nobody took.
      return { ok: false, code: ERR.OUT_OF_ORDER, message: ERR_TEXT[ERR.OUT_OF_ORDER] };
    }

    /**
     * The kinds this relay will pass on, listed rather than waved through.
     *
     * A relay that accepted anything would forward a typo as faithfully as a
     * move, and the client on the other end would refuse it — leaving one side
     * having played something the other never saw, which arrives later as a
     * desync blamed on the physics. See `replay/InputLog.js`, which is where
     * this list is really defined; these strings are its `INPUT_KIND` values and
     * the server holds no import of it (it holds a HASH of the config, not the
     * config, and the same restraint applies here).
     */
    const event = msg.event;
    if (!event || (event.kind !== 'shot' && event.kind !== 'card' && event.kind !== 'flip')) {
      return { ok: false, code: ERR.BAD_MESSAGE, message: ERR_TEXT[ERR.BAD_MESSAGE] };
    }

    /**
     * Relayed to the OPPONENT, never echoed back to the sender.
     *
     * The sender has already applied this move — that is what makes the local
     * player's own shot feel instant — so an echo is not a confirmation, it is a
     * second copy of an input that has already been played. It arrives while the
     * world is still LIVE, gets queued rather than refused, and fires again the
     * moment the turn reopens: one player takes two shots and the match desyncs
     * on turn one.
     *
     * Found exactly that way. `broadcast` was the obvious call and it is the
     * wrong one; a relay relays to the other end.
     */
    // Taking part resets the streak. The cap is about consecutive silence.
    this._skips[seat] = 0;
    const seq = this.seq++;
    this.seats[this.other(seat)]?.conn?.send(S2C.INPUT, {
      seq,
      turn: this.turn,
      player: seat,
      event,
    });

    if (event.kind === 'flip') {
      /**
       * A cap turned over. The clock keeps running, and it is not restarted.
       *
       * A card resets the turn clock below, on the grounds that playing one is
       * an action and the player should then get a whole turn to aim. A flip is
       * not an action — it costs no turn and there is no limit on it — so
       * resetting the clock for one would hand any player an unlimited stall:
       * tap the button every fourteen seconds and the turn never expires.
       *
       * Nothing else happens either. The turn does not advance and the shot
       * clock does not stop, because neither of those is true of a flip; the
       * relay above has already sent it to the opponent, which is the whole of
       * what the server owes it.
       */
    } else if (event.kind === 'card') {
      /**
       * A card does not end the turn, and it buys a fresh clock.
       *
       * The alternative — pausing for exactly the effect's length — needs the
       * server to know each card's animation duration, which is a config value
       * it deliberately does not have (it holds a HASH of the config, not the
       * config). Resetting is simpler, cannot drift out of step with a tuning
       * change, and is strictly kinder: playing a card is an action, and the
       * player then gets a whole turn to aim rather than the remains of one.
       */
      this._deadline = Date.now() + this.timing.turnMs;
      this.broadcast(S2C.TURN_CLOCK, {
        turn: this.turn,
        deadline: this._deadline,
        turnMs: this.timing.turnMs,
        reason: 'card',
      });
      this.arm();
    } else {
      // A shot has been taken; the turn clock stops until both sides report,
      // because a simulation takes as long as it takes. The REPORT deadline
      // takes over — without it this window had nothing watching it at all.
      clearTimeout(this._timer);
      this._timer = null;
      this._armReportDeadline();
    }
    return { ok: true };
  }

  /**
   * A client's verdict on a finished turn.
   *
   * Three things are compared, not one: the state hash, whose turn is next, and
   * whether the match is over. Two clients can agree about where every cap
   * stopped and still disagree about who won — a rules divergence rather than a
   * physics one — and shipping only the hash would let that through.
   */
  report(seat, msg) {
    if (this.phase !== ROOM_PHASE.PLAYING) return;
    const turn = msg.turn;
    if (turn !== this.turn) return; // stale report from a turn already closed

    let forTurn = this._reports.get(turn);
    if (!forTurn) {
      forTurn = new Map();
      this._reports.set(turn, forTurn);
    }
    if (forTurn.has(seat)) return; // duplicates are ignored, not an error
    forTurn.set(seat, {
      hash: String(msg.hash ?? ''),
      next: msg.next | 0,
      over: !!msg.over,
      winner: msg.winner === null || msg.winner === undefined ? null : msg.winner | 0,
    });

    if (forTurn.size < 2) return;

    const a = forTurn.get(0);
    const b = forTurn.get(1);
    this._reports.delete(turn);

    if (a.hash !== b.hash || a.next !== b.next || a.over !== b.over || a.winner !== b.winner) {
      this.log(`room ${this.id}: DESYNC on turn ${turn} — ${JSON.stringify({ a, b })}`);
      this.broadcast(S2C.DESYNC, {
        turn,
        reports: { 0: a, 1: b },
      });
      this.finish(null, OVER_REASON.DESYNC, '두 기기의 시뮬레이션이 어긋났습니다');
      return;
    }

    if (a.over) {
      this.finish(a.winner, OVER_REASON.PLAYED, null);
      return;
    }

    this._reportDeadline = 0;
    this.turn = turn + 1;
    this.current = a.next;
    this.beginTurn();
  }

  // ── endings ──────────────────────────────────────────────────────────────

  /**
   * A socket went away.
   *
   * What that means depends entirely on the phase, which is the reason the phase
   * exists. Before the match starts nobody has lost anything; once it has
   * started, leaving is losing, and there is no reconnect — stated in the brief
   * and honoured here rather than softened.
   */
  drop(conn, { reason = OVER_REASON.DISCONNECT, cause = DETECT.SOCKET } = {}) {
    const seat = this.seatOf(conn);
    if (seat < 0) return;
    const s = this.seats[seat];
    s.present = false;

    if (this.phase === ROOM_PHASE.OVER) return;

    if (this.phase === ROOM_PHASE.OPEN) {
      // Nobody to tell and nothing to lose. The hub destroys the emptied room
      // and frees its invite code — leaving either behind is what let a joiner
      // walk into a room that could never pair.
      this.seats[seat] = null;
      return;
    }

    /**
     * ── the one case where a closed socket is NOT a disconnect ─────────────
     * Between MATCH_FOUND and the game document's RESUME, both browsers are
     * navigating and both sockets close. That is the handoff and it is normal.
     *
     * But only for a seat that has not come back YET. Once a seat has resumed,
     * its socket closing is a person leaving, and the old code could not tell
     * the two apart — so a player who quit during the opening sequence left the
     * other one staring at a board for a full minute, and the message that
     * eventually arrived did not say why.
     */
    if (!s.resumed && (this.phase === ROOM_PHASE.HANDOFF || this.phase === ROOM_PHASE.READYING)) {
      this.log(`room ${this.id}: seat ${seat} dropped mid-handoff, still waiting [${cause}]`);
      return;
    }

    this.forfeit(seat, reason, cause);
  }

  /**
   * One seat is gone; the other wins. THE one way a match ends badly.
   *
   * Every detector routes through here — the socket, the heartbeat, the turn
   * clock, the hash deadline, the skip cap, the janitor — so the surviving
   * player is told the same thing in the same words however it was noticed.
   * "뜰 때도 있고 안 뜰 때도 있다" was five code paths, and this is one.
   */
  forfeit(seat, reason = OVER_REASON.DISCONNECT, cause = DETECT.SOCKET) {
    if (this.phase === ROOM_PHASE.OVER) return;
    const winner = this.other(seat);
    const text =
      reason === OVER_REASON.FORFEIT
        ? '상대방이 게임을 나갔습니다'
        : '상대방의 연결이 끊어졌습니다';
    this.log(`room ${this.id}: seat ${seat} forfeits [${cause}] — seat ${winner} wins`);
    this.seats[winner]?.conn?.send(S2C.OPPONENT_GONE, { reason, message: text, cause });
    this.finish(winner, reason, text, cause);
  }

  finish(winner, reason, message, cause = null) {
    if (this.phase === ROOM_PHASE.OVER) return;
    this.phase = ROOM_PHASE.OVER;
    clearTimeout(this._timer);
    clearTimeout(this._handoffTimer);
    this._timer = null;
    this._handoffTimer = null;
    this._reportDeadline = 0;
    this.over = { winner, reason, message, cause };
    this.broadcast(S2C.MATCH_OVER, { winner, reason, message, cause });
    this.log(
      `room ${this.id}: over — winner=${winner} reason=${reason}` +
        (cause ? ` [${cause}]` : ''),
    );
  }

  broadcast(type, body) {
    for (const s of this.seats) {
      if (s?.present) s.conn.send(type, body);
    }
  }

  /** An unclaimed invite code stops working eventually. */
  get expired() {
    return (
      this.phase === ROOM_PHASE.OPEN && Date.now() - this.createdAt > this.timing.roomTtlMs
    );
  }

  dispose() {
    clearTimeout(this._timer);
    clearTimeout(this._handoffTimer);
    this._timer = null;
    this._handoffTimer = null;
  }
}

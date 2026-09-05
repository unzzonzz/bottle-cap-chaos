import {
  C2S,
  ERR_TEXT,
  OVER_REASON,
  PROTOCOL_VERSION,
  S2C,
  configHash,
} from './protocol.js';
import { Transport } from './Transport.js';

/**
 * A match seen from the client, with the socket hidden underneath it.
 *
 * ── what the game above is allowed to know ─────────────────────────────────
 * That there is an opponent, that they have a name and a mark, whose turn it is,
 * and how long is left. It may push a shot or a card in, and pull remote ones
 * out. That is the entire surface, and none of it mentions a connection —
 * `OnlineController` never sees a `Transport`, and `main.js` never sees either.
 *
 * ── remote inputs are QUEUED, not applied ──────────────────────────────────
 * A packet arrives whenever the network feels like it, which is very often
 * mid-simulation, mid-card-effect, or during the opening cutscene — none of
 * which are moments a shot may be fired into. So arrivals land in `_pending` and
 * the controller drains them on a frame when the match is actually ready. Every
 * bug of the form "the remote shot fired during the swap animation" is prevented
 * here rather than guarded against in six places.
 *
 * ── the handoff ────────────────────────────────────────────────────────────
 * Matchmaking happens in the MENU document and the match runs in the GAME
 * document, and moving between them is a real page navigation that destroys the
 * socket. So the menu stashes what it was told (`stash`) and the game document
 * picks it up (`recall`) and re-attaches with the token. The room outlives the
 * connection; that is what `ROOM_PHASE.HANDOFF` on the server is for.
 */

/** Survives a navigation, dies with the tab. Exactly the right lifetime. */
const STASH_KEY = 'msa.online.handoff';

export const SESSION_PHASE = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  READY: 'ready',
  CREATING: 'creating',
  WAITING_CODE: 'waitingCode',
  QUEUED: 'queued',
  MATCHED: 'matched',
  PLAYING: 'playing',
  OVER: 'over',
};

export class OnlineSession {
  /**
   * @param {object} opts
   * @param {object} opts.config       the game config, for the fingerprint
   * @param {Transport} [opts.transport]
   */
  constructor({ config, transport = new Transport() } = {}) {
    this.config = config;
    this.transport = transport;
    this.phase = SESSION_PHASE.IDLE;

    this.nickname = '';
    this.error = null;

    /** Set once matched. Everything the match needs to exist. */
    this.match = null;
    /** `{nickname, mark}` — the other player. */
    this.opponent = null;
    /** The invite code, while we are the one waiting on it. */
    this.code = '';
    this.codeExpiresAt = 0;
    /** When we joined the random queue, for the elapsed-time readout. */
    this.queuedAt = 0;
    this.queuedMode = '';

    /** Server-owned turn clock. `deadline` is a wall-clock ms in OUR frame. */
    this.turn = 0;
    this.current = -1;
    this.deadline = 0;
    this.turnMs = 15000;

    /** Remote inputs waiting to be applied. See the header. */
    this._pending = [];
    /** Set when the server says the match ended, for any reason. */
    this.over = null;
    /** The last desync report, for the debug panel. */
    this.desync = null;
    /** The socket has gone quiet but has not given up. For the HUD. */
    this.unstable = false;

    this._listeners = new Map();
    this._unsubs = [];
    this._wire();
  }

  // ── events out ───────────────────────────────────────────────────────────

  /** @returns {() => void} */
  on(event, handler) {
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  _emit(event, payload) {
    for (const h of [...(this._listeners.get(event) ?? [])]) {
      try {
        h(payload);
      } catch (err) {
        console.error(`[online] ${event} handler threw`, err);
      }
    }
  }

  // ── wiring ───────────────────────────────────────────────────────────────

  _wire() {
    const t = this.transport;
    const sub = (type, fn) => this._unsubs.push(t.on(type, fn));

    sub(S2C.ERROR, (m) => {
      this.error = { code: m.code, message: m.message ?? ERR_TEXT[m.code] ?? m.code };
      this._emit('error', this.error);
    });

    sub(S2C.HELLO_OK, (m) => {
      this.nickname = m.nickname;
      this.turnMs = m.timing?.turnMs ?? this.turnMs;
      // The watchdog is calibrated from the SERVER's own numbers, so a relay
      // started with a different heartbeat interval does not make every client
      // think it is about to lose the connection.
      this.transport.configureWatchdog?.(m.timing);
      this.phase = SESSION_PHASE.READY;
      this._emit('ready', m);
    });

    sub(S2C.ROOM_CREATED, (m) => {
      this.code = m.code;
      this.codeExpiresAt = m.expiresAt ?? 0;
      this.phase = SESSION_PHASE.WAITING_CODE;
      this._emit('roomCreated', m);
    });

    sub(S2C.QUEUED, (m) => {
      this.queuedAt = Date.now();
      this.queuedMode = m.mode;
      this.phase = SESSION_PHASE.QUEUED;
      this._emit('queued', m);
    });

    sub(S2C.QUEUE_LEFT, () => {
      this.queuedAt = 0;
      this.queuedMode = '';
      this.phase = SESSION_PHASE.READY;
      this._emit('queueLeft', {});
    });

    sub(S2C.MATCH_FOUND, (m) => {
      this.match = {
        roomId: m.roomId,
        token: m.token,
        mode: m.mode,
        seed: m.seed >>> 0,
        seat: m.seat | 0,
        first: m.first | 0,
        resumed: !!m.resumed,
      };
      this.opponent = m.opponent ?? { nickname: '', mark: null };
      if (m.self?.nickname) this.nickname = m.self.nickname;
      this.turnMs = m.turnMs ?? this.turnMs;
      // A resumed socket never sees HELLO_OK, so this is where its watchdog is
      // calibrated. Without it the game document ran on the defaults and a relay
      // with a slower heartbeat would be reported as unstable for no reason.
      if (m.timing) this.transport.configureWatchdog?.(m.timing);
      this.phase = SESSION_PHASE.MATCHED;
      this._emit('matched', { ...this.match, opponent: this.opponent });
    });

    sub(S2C.MATCH_START, () => {
      this.phase = SESSION_PHASE.PLAYING;
      this._emit('start', {});
    });

    sub(S2C.TURN_BEGIN, (m) => {
      this.turn = m.turn | 0;
      this.current = m.player | 0;
      this.turnMs = m.turnMs ?? this.turnMs;
      this.deadline = this._localDeadline(m);
      this._emit('turn', { turn: this.turn, player: this.current, deadline: this.deadline });
    });

    sub(S2C.TURN_CLOCK, (m) => {
      this.deadline = this._localDeadline(m);
      this._emit('clock', { deadline: this.deadline, reason: m.reason });
    });

    sub(S2C.TURN_SKIP, (m) => {
      // Queued like any other input so it lands at a legal moment. A skip that
      // was applied the instant it arrived would advance the turn out from under
      // whatever the previous one was still animating.
      this._pending.push({ kind: 'skip', turn: m.turn | 0, player: m.player | 0 });
      this.deadline = 0;
      this._emit('skip', { turn: m.turn | 0, player: m.player | 0 });
    });

    sub(S2C.INPUT, (m) => {
      // Never our own move. The server relays to the opponent only, so this
      // should be unreachable — and it is checked anyway, because the failure it
      // guards against is silent and total: a locally-applied shot that also
      // arrives as a packet is played twice, and the match desyncs on the turn
      // it happens. Cheap comparison, whole class of bug.
      if ((m.player | 0) === this.mySeat) return;
      const kind = m.event?.kind;
      this._pending.push({
        kind,
        turn: m.turn | 0,
        player: m.player | 0,
        event: m.event,
      });
      /**
       * The displayed clock stops, unless the turn is still running.
       *
       * A shot ends the turn and a card is immediately followed by a fresh
       * `TURN_CLOCK`, so clearing this is right for both: either nothing is
       * being timed any more, or a new deadline is a packet away.
       *
       * A flip is neither. It costs no turn, and the server deliberately does
       * not reset the clock for one — see `Room.input`, where resetting would
       * make an unlimited stall out of an unlimited button. So nothing would
       * arrive to put this back, and clearing it would blank the opponent's
       * countdown for the rest of a turn that is very much still ticking.
       */
      if (kind !== 'flip') this.deadline = 0;
    });

    sub(S2C.DESYNC, (m) => {
      this.desync = m;
      this._emit('desync', m);
    });

    sub(S2C.OPPONENT_GONE, (m) => {
      this._emit('opponentGone', m);
    });

    sub(S2C.MATCH_OVER, (m) => {
      this.over = m;
      this.phase = SESSION_PHASE.OVER;
      this.deadline = 0;
      this._emit('over', m);
    });

    sub('unstable', () => {
      this.unstable = true;
      this._emit('unstable', {});
    });
    sub('stable', () => {
      this.unstable = false;
      this._emit('stable', {});
    });

    sub('close', ({ wasOpen }) => {
      this.unstable = false;
      // Only meaningful while a match is live. Before that, a closed socket is
      // just a closed socket and the menu says so.
      if (this.phase === SESSION_PHASE.PLAYING && !this.over) {
        this.over = {
          winner: null,
          reason: OVER_REASON.DISCONNECT,
          message: '서버와의 연결이 끊어졌습니다',
        };
        this.phase = SESSION_PHASE.OVER;
        this._emit('over', this.over);
      }
      this._emit('closed', { wasOpen });
    });
  }

  /**
   * The server's deadline, expressed in this machine's clock.
   *
   * ── never trust the absolute timestamp ─────────────────────────────────
   * The server sends both `deadline` (its own `Date.now()`) and `turnMs`. Using
   * the timestamp directly would import the difference between the two machines'
   * clocks straight into the countdown — and two devices on a home network can
   * easily be seconds apart, which on a fifteen second turn is the difference
   * between a fair clock and a stolen one.
   *
   * So only the DURATION crosses the wire meaningfully, and the deadline is
   * rebuilt locally from the moment the message arrived. The cost is one
   * network latency of drift, which is milliseconds; the alternative costs
   * whatever the clocks disagree by, which is unbounded.
   */
  _localDeadline(m) {
    const ms = Number.isFinite(m.turnMs) ? m.turnMs : this.turnMs;
    return Date.now() + ms;
  }

  /** Seconds left on the current turn, or null when no clock is running. */
  get remaining() {
    if (!this.deadline) return null;
    return Math.max(0, (this.deadline - Date.now()) / 1000);
  }

  get isMyTurn() {
    return this.match !== null && this.current === this.match.seat;
  }

  get mySeat() {
    return this.match?.seat ?? 0;
  }

  get opponentSeat() {
    return this.mySeat === 0 ? 1 : 0;
  }

  // ── matchmaking, from the menu document ──────────────────────────────────

  async connect(url) {
    this.phase = SESSION_PHASE.CONNECTING;
    this.error = null;
    await this.transport.connect(url);
  }

  hello(nickname) {
    this.transport.send(C2S.HELLO, {
      protocol: PROTOCOL_VERSION,
      nickname,
      configHash: configHash(this.config),
    });
  }

  createRoom(mode, mark) {
    this.phase = SESSION_PHASE.CREATING;
    this.transport.send(C2S.ROOM_CREATE, { mode, mark });
  }

  joinRoom(code, mark) {
    this.transport.send(C2S.ROOM_JOIN, { code, mark });
  }

  leaveRoom() {
    this.transport.send(C2S.ROOM_LEAVE, {});
    this.code = '';
    this.phase = SESSION_PHASE.READY;
  }

  joinQueue(mode, mark) {
    this.transport.send(C2S.QUEUE_JOIN, { mode, mark });
  }

  leaveQueue() {
    this.transport.send(C2S.QUEUE_LEAVE, {});
  }

  // ── the handoff across the document boundary ─────────────────────────────

  /** Called by the menu, the instant before it navigates. */
  stash(storage = globalThis.sessionStorage) {
    if (!this.match) return false;
    try {
      storage?.setItem(
        STASH_KEY,
        JSON.stringify({
          ...this.match,
          opponent: this.opponent,
          nickname: this.nickname,
          turnMs: this.turnMs,
          at: Date.now(),
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Called by the game document at boot. @returns the stash, or null. */
  static recall(storage = globalThis.sessionStorage) {
    try {
      const raw = storage?.getItem(STASH_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      return v && typeof v.roomId === 'string' && typeof v.token === 'string' ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Forget the handoff.
   *
   * Called once the match document has consumed it. Leaving it behind means a
   * player who quits and starts a LOCAL game gets silently re-attached to a dead
   * room the next time they load the page.
   */
  static clearStash(storage = globalThis.sessionStorage) {
    try {
      storage?.removeItem(STASH_KEY);
    } catch {
      /* private mode; there was nothing to clear */
    }
  }

  /**
   * Take on a stashed match WITHOUT touching the network.
   *
   * Split from `resume` because the game document needs the seat before it has a
   * connection: `main.js` seats the local player at `mySeat` and builds the
   * controllers around it, and that happens synchronously at boot while the
   * socket is still opening. A version of this that only knew its seat after the
   * server answered would have to build the match twice, or guess.
   */
  adopt(stash) {
    this.match = {
      roomId: stash.roomId,
      token: stash.token,
      mode: stash.mode,
      seed: stash.seed >>> 0,
      seat: stash.seat | 0,
      first: stash.first | 0,
      resumed: true,
    };
    this.opponent = stash.opponent ?? { nickname: '', mark: null };
    this.nickname = stash.nickname ?? '';
    this.turnMs = stash.turnMs ?? this.turnMs;
    return this.match;
  }

  /** Tell the server this document is the one holding the seat now. */
  resume(stash = null) {
    if (stash) this.adopt(stash);
    if (!this.match) return false;
    return this.transport.send(C2S.RESUME, {
      roomId: this.match.roomId,
      token: this.match.token,
      configHash: configHash(this.config),
    });
  }

  /** The cutscene is finished and the board is up. Starts the first clock. */
  ready() {
    this.transport.send(C2S.READY, {});
  }

  // ── during the match ─────────────────────────────────────────────────────

  /** @param {import('../game/shot.js').Shot} shot */
  sendShot(shot, rngState) {
    this.transport.send(C2S.INPUT, {
      turn: this.turn,
      event: {
        kind: 'shot',
        player: this.mySeat,
        rngState,
        capIndex: shot.capIndex,
        dirX: shot.dirX,
        dirZ: shot.dirZ,
        power: shot.power,
        seed: shot.seed >>> 0,
        impulseMul: shot.impulseMul ?? 1,
        spreadMul: shot.spreadMul ?? 1,
      },
    });
  }

  sendCard(cardId, rngState) {
    this.transport.send(C2S.INPUT, {
      turn: this.turn,
      event: { kind: 'card', player: this.mySeat, rngState, cardId },
    });
  }

  /**
   * "I turned my cap over."
   *
   * Carries `rngState` even though a flip draws no random number, and it is sent
   * in the same shape as the other two on purpose. Every event on this wire has
   * the same four fields in the same order, so the receiver restores the counter
   * from one place for every kind — and the moment one kind is special, that
   * place becomes a branch, and the branch is where the next desync comes from.
   */
  sendFlip(rngState) {
    this.transport.send(C2S.INPUT, {
      turn: this.turn,
      event: { kind: 'flip', player: this.mySeat, rngState },
    });
  }

  /**
   * "I have finished simulating and presenting this turn, and here is what I got."
   *
   * Three claims, not one — see `Room.report` for why whose-turn-is-next and
   * who-won have to travel with the hash rather than being inferred by a server
   * that does not run the rules.
   */
  reportTurn({ turn, hash, next, over, winner }) {
    this.transport.send(C2S.HASH, { turn, hash, next, over, winner });
  }

  forfeit() {
    this.transport.send(C2S.FORFEIT, {});
  }

  // ── remote input, drained by the controller ──────────────────────────────

  get hasPending() {
    return this._pending.length > 0;
  }

  /** @returns the next remote input, or null. */
  takePending() {
    return this._pending.shift() ?? null;
  }

  dispose() {
    for (const un of this._unsubs) un();
    this._unsubs = [];
    this._listeners.clear();
    this.transport.dispose();
  }
}

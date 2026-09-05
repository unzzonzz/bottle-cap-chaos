import { C2S, S2C, decode, encode } from './protocol.js';

/**
 * A socket, and nothing else.
 *
 * ── this is the only file in `src/` allowed to say `WebSocket` ─────────────
 * Everything above it — the session, the controller, the menu screens — talks to
 * an object with `send`, `on` and `close`. That separation is a requirement
 * rather than a preference ("게임 로직에 WebSocket 직접 호출 — 계층을 분리한다"),
 * and it earns its keep immediately: the online controller is testable against a
 * fake transport with no server running, and the same session code drives the
 * matchmaking socket in the menu document and the match socket in the game
 * document, which are two different connections with two different lifetimes.
 *
 * ── there is no reconnect, deliberately ────────────────────────────────────
 * A dropped socket mid-match is a forfeit and the server has already awarded the
 * game away by the time this would fire. So a silent retry would reconnect into
 * a room that no longer exists and present the player with a working connection
 * to nothing. `close` is terminal, it is reported upward, and the layer that
 * cares decides what it means — which differs by phase, and is the session's
 * business rather than the socket's.
 *
 * The one reconnection in the system is the HANDOFF, and it is not one: it is a
 * fresh `Transport` in a fresh document, re-attaching with a token. See
 * `OnlineSession.resume`.
 */

/** Where the relay is, unless somebody says otherwise. */
export const DEFAULT_PORT = 8787;

/**
 * A sensible default server address for the page that is running.
 *
 * ── it follows the page's own host, which is what makes LAN play work ──────
 * The second device reaches the dev server at `http://192.168.x.x:5173`, so the
 * relay it wants is at `ws://192.168.x.x:8787` — the same machine, a different
 * port. Hard-coding `localhost` here would work on the host machine and fail on
 * every other device, which is the one arrangement this phase is FOR.
 *
 * `wss:` when the page is `https:`, because a secure page may not open an
 * insecure socket, and a mixed-content failure looks exactly like the server
 * being down.
 */
/**
 * A relay address baked in at build time, if the build was given one.
 *
 * ── this is what a DEPLOYED build needs and a local one must not have ──────
 * The host-derived default below is right for the local phase and wrong the
 * moment the page is served from somewhere the relay is not: a frontend on
 * `myapp.example.com` would go looking for `wss://myapp.example.com:8787`, which
 * is nothing. A deployment puts the relay's real address in `VITE_RELAY_URL`
 * and Vite bakes it in.
 *
 * Read through a guard because this module is also imported by the server-side
 * tests, which run under plain Node where `import.meta.env` does not exist.
 */
const BUILT_IN_RELAY = (() => {
  try {
    return import.meta.env?.VITE_RELAY_URL || '';
  } catch {
    return '';
  }
})();

export function defaultServerUrl(loc = globalThis.location) {
  // A build-time address wins, because a build that has one is a build that is
  // not being served from the same machine as its relay.
  if (BUILT_IN_RELAY) return BUILT_IN_RELAY;
  const secure = loc?.protocol === 'https:';
  const host = loc?.hostname || 'localhost';
  return `${secure ? 'wss' : 'ws'}://${host}:${DEFAULT_PORT}`;
}

export const CONN = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  OPEN: 'open',
  CLOSED: 'closed',
  FAILED: 'failed',
};

export class Transport {
  /**
   * @param {object} [opts]
   * @param {typeof WebSocket} [opts.socketClass]  injected for tests and for Node
   */
  constructor({ socketClass = globalThis.WebSocket } = {}) {
    this.SocketClass = socketClass;
    this.state = CONN.IDLE;
    this.url = '';
    this._ws = null;
    /** type -> Set<handler> */
    this._handlers = new Map();
    /** Round-trip time in ms, as measured BY THE SERVER. See `_receive`. */
    this.ping = 0;
    this.lastError = null;

    /**
     * When the server was last heard from, and the watchdog that reads it.
     *
     * ── the client has to watch too ────────────────────────────────────────
     * A socket that has gone dead does not always tell the page: a laptop that
     * sleeps, a phone that loses its network, a relay that is killed — in all of
     * those the `close` event can be minutes late or never arrive. Meanwhile the
     * player is looking at a board waiting for a turn that is not coming.
     *
     * The server pings on a fixed interval, so silence is measurable from this
     * end without any extra traffic: past a couple of intervals the connection
     * is UNSTABLE and worth saying so, and past the timeout it is gone and the
     * match must stop rather than sit there.
     */
    this.lastSeenAt = 0;
    this.unstable = false;
    this._watchdog = null;
    /**
     * Stop answering pings, without closing. The panel's 강제 무응답.
     *
     * The nearest thing to a killed mobile app that can be produced from inside
     * a running page, and the case the server's heartbeat exists for — so it is
     * the one that most needs to be reproducible on demand.
     */
    this.muted = false;
  }

  get connected() {
    return this.state === CONN.OPEN;
  }

  /**
   * @param {string} url
   * @returns {Promise<void>} resolves when open, rejects if it never opens
   */
  connect(url) {
    this.close();
    this.url = url;
    this.state = CONN.CONNECTING;
    this.lastError = null;

    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new this.SocketClass(url);
      } catch (err) {
        this.state = CONN.FAILED;
        this.lastError = err?.message ?? String(err);
        reject(err);
        return;
      }
      this._ws = ws;

      ws.onopen = () => {
        this.state = CONN.OPEN;
        this.lastSeenAt = Date.now();
        this._startWatchdog();
        this._emit('open', {});
        resolve();
      };
      ws.onmessage = (ev) => this._receive(ev.data);
      ws.onerror = () => {
        this.lastError = '연결할 수 없습니다';
      };
      ws.onclose = (ev) => {
        const wasOpen = this.state === CONN.OPEN;
        this.state = wasOpen ? CONN.CLOSED : CONN.FAILED;
        this._ws = null;
        this._emit('close', { code: ev?.code, wasOpen });
        if (!wasOpen) reject(new Error(this.lastError ?? '연결할 수 없습니다'));
      };
    });
  }

  _receive(raw) {
    const msg = decode(raw);
    if (!msg) return;

    // Anything at all counts as the server being there.
    this.lastSeenAt = Date.now();
    if (this.unstable) {
      this.unstable = false;
      this._emit('stable', {});
    }

    // Answered here rather than upstairs: a heartbeat is the socket's own
    // business and nothing above this needs to know the connection is being
    // checked. Also the one place `ping` can be measured honestly.
    if (msg.t === S2C.PING) {
      /**
       * The round trip is the SERVER's measurement, reported back.
       *
       * Timing it here is not possible: this end only ever sees one ping follow
       * another, so subtracting the previous arrival gives the heartbeat
       * interval — a number that looks like a latency, never moves, and is
       * completely wrong. The server sent the ping and saw the pong come back,
       * so it is the only end that can time it. See `Hub.handle`.
       */
      if (Number.isFinite(msg.rtt)) this.ping = msg.rtt;
      // `muted` is the debug switch; a muted client looks exactly like a dead
      // one to the relay, which is the point of it.
      if (!this.muted) this.send(C2S.PONG, { t: msg.t });
      this._emit(S2C.PING, msg);
      return;
    }

    this._emit(msg.t, msg);
    this._emit('*', msg);
  }

  send(type, body = {}) {
    if (!this._ws || this.state !== CONN.OPEN) return false;
    try {
      this._ws.send(encode(type, body));
      return true;
    } catch {
      return false;
    }
  }

  /** @returns {() => void} an unsubscribe */
  on(type, handler) {
    let set = this._handlers.get(type);
    if (!set) {
      set = new Set();
      this._handlers.set(type, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  _emit(type, msg) {
    const set = this._handlers.get(type);
    if (!set) return;
    // Copied before iterating: a handler is allowed to unsubscribe itself, and
    // several do — the matchmaking screens all tear down on the message that
    // takes them somewhere else.
    for (const h of [...set]) {
      try {
        h(msg);
      } catch (err) {
        console.error('[net] handler threw', err);
      }
    }
  }

  /**
   * @param {object} timing  the server's own values, from the handshake
   */
  configureWatchdog(timing) {
    this._heartbeatMs = timing?.heartbeatMs ?? 5000;
    this._silenceLimitMs = timing?.heartbeatTimeoutMs ?? 20000;
  }

  _startWatchdog() {
    clearInterval(this._watchdog);
    this._watchdog = setInterval(() => {
      if (this.state !== CONN.OPEN) return;
      const silent = Date.now() - this.lastSeenAt;
      const beat = this._heartbeatMs ?? 5000;
      const limit = this._silenceLimitMs ?? 20000;

      if (silent > limit) {
        // Past the point where the server would already have written US off.
        // Reported as a close, because that is what it is — the socket simply
        // has not noticed yet, and the match must not carry on regardless.
        this.lastError = '서버와의 연결이 끊어졌습니다';
        this.close();
        this._emit('close', { code: 0, wasOpen: true });
        return;
      }
      const shaky = silent > beat * 2.5;
      if (shaky !== this.unstable) {
        this.unstable = shaky;
        this._emit(shaky ? 'unstable' : 'stable', { silent });
      }
    }, 1000);
  }

  close() {
    clearInterval(this._watchdog);
    this._watchdog = null;
    const ws = this._ws;
    this._ws = null;
    if (!ws) return;
    // Handlers are cleared first so the deliberate close does not look like a
    // dropped connection to anything listening for one.
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    this.state = CONN.CLOSED;
  }

  dispose() {
    this.close();
    this._handlers.clear();
  }
}

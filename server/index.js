import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

import { DETECT, TIMING } from '../src/net/protocol.js';
import { Hub } from './Hub.js';

/**
 * The relay, as a process.
 *
 * ── it runs locally now and it is written to be deployed later ─────────────
 * The current instruction is a local server on somebody's own machine, reached
 * over the LAN by a second device. Nothing here is written for that specifically:
 *
 *   NOTHING IS HARD-CODED.  No `localhost`, no absolute paths, no origin list
 *     baked into a constant. Host, port, timings and the allowed origins all
 *     come from the environment, with defaults chosen for the local case.
 *   IT BINDS 0.0.0.0 BY DEFAULT.  Which is what makes the second device on the
 *     network able to reach it at all, and is also exactly what a container
 *     wants. `HOST` overrides it.
 *   IT READS `PORT`.  The variable every platform sets. `SERVER_PORT` wins if
 *     both are present, so a dev machine can pin one without touching `PORT`.
 *   THERE IS NO STATE OUTSIDE THE PROCESS.  No database, no files written. The
 *     limitation that follows from that — nicknames only last as long as the
 *     process — is documented where it lives, in `NicknameRegistry`.
 *
 * ── the http server exists for one endpoint ────────────────────────────────
 * `/health` returns the hub's counters. It is what tells you the relay is up
 * before you start blaming the game, and it is what a platform health check
 * would call. Everything else is the WebSocket upgrade.
 */

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const timing = {
  ...TIMING,
  turnMs: num('TURN_MS', TIMING.turnMs),
  heartbeatMisses: num('HEARTBEAT_MISSES', TIMING.heartbeatMisses),
  hashTimeoutMs: num('HASH_TIMEOUT_MS', TIMING.hashTimeoutMs),
  maxSkips: num('MAX_SKIPS', TIMING.maxSkips),
  roomMaxMs: num('ROOM_MAX_MS', TIMING.roomMaxMs),
  heartbeatMs: num('HEARTBEAT_MS', TIMING.heartbeatMs),
  heartbeatTimeoutMs: num('HEARTBEAT_TIMEOUT_MS', TIMING.heartbeatTimeoutMs),
  roomTtlMs: num('ROOM_TTL_MS', TIMING.roomTtlMs),
  handoffMs: num('HANDOFF_MS', TIMING.handoffMs),
};

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Which page origins may open a socket.
 *
 * Unset means "anything", which is correct for a relay on a home network where
 * the dev server's port changes every run and the second device reaches it by
 * IP. Set `ALLOWED_ORIGINS` to a comma-separated list to lock it down, which is
 * what a deployment would do.
 */
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const stamp = () => new Date().toISOString().slice(11, 23);
const log = (...args) => console.log(`[${stamp()}]`, ...args);

const hub = new Hub({ timing, log });

const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime: process.uptime(), ...hub.stats() }, null, 2));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('bottle-cap-chaos relay\n');
});

const wss = new WebSocketServer({ server: http });

wss.on('connection', (socket, req) => {
  const origin = req.headers.origin;
  if (ALLOWED.length && origin && !ALLOWED.includes(origin)) {
    log(`refused origin ${origin}`);
    socket.close(1008, 'origin not allowed');
    return;
  }

  const conn = hub.connect({
    send: (raw) => socket.send(raw),
    close: () => socket.close(),
  });
  log(`conn ${conn.id} open from ${req.socket.remoteAddress}`);

  socket.on('message', (data) => {
    try {
      hub.handle(conn, data.toString());
    } catch (err) {
      // One bad message must not take the relay down and with it every other
      // match in progress. Logged loudly, and the connection carries on.
      log(`conn ${conn.id}: handler threw —`, err?.stack ?? err);
    }
  });

  /**
   * `close` and `error` both, and both into the SAME call.
   *
   * A socket can produce either, both, or — on some failures — only `error`.
   * Handling one and not the other leaves a route by which a player can vanish
   * with nobody noticing, and `Hub.disconnect` is idempotent precisely so that
   * wiring both costs nothing when they both fire.
   */
  socket.on('close', () => {
    log(`conn ${conn.id} closed (${conn.nickname ?? 'unnamed'})`);
    hub.disconnect(conn, DETECT.SOCKET);
  });

  socket.on('error', (err) => {
    log(`conn ${conn.id} errored (${conn.nickname ?? 'unnamed'}): ${err?.message ?? err}`);
    hub.disconnect(conn, DETECT.SOCKET);
  });
});

const beat = setInterval(() => hub.heartbeat(), timing.heartbeatMs);

http.listen(PORT, HOST, () => {
  log(`bottle-cap-chaos relay listening on ${HOST}:${PORT}`);
  log(
    `  turn ${timing.turnMs}ms · heartbeat ${timing.heartbeatMs}ms x${timing.heartbeatMisses} ` +
      `(hard ${timing.heartbeatTimeoutMs}ms) · hash ${timing.hashTimeoutMs}ms · ` +
      `skips ${timing.maxSkips} · handoff ${timing.handoffMs}ms · room max ${timing.roomMaxMs}ms`,
  );
  log(`  origins: ${ALLOWED.length ? ALLOWED.join(', ') : '(any)'}`);
});

const shutdown = () => {
  log('shutting down');
  clearInterval(beat);
  hub.close();
  wss.close();
  http.close(() => process.exit(0));
  // A socket that will not close must not hold the process forever.
  setTimeout(() => process.exit(0), 2000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

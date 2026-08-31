import { MATCH_STATE } from '../game/Match.js';
import { peekSeed, seedRun } from '../physics/rng.js';
import { INPUT_KIND, InputLog } from '../replay/InputLog.js';
import { OVER_REASON } from './protocol.js';

/**
 * The part of an online match that has to happen on every frame.
 *
 * ── one object, three jobs, all of them mistimed if done anywhere else ────
 *
 *   APPLY remote inputs, but only when the match can take one. Packets arrive
 *     mid-simulation, mid-card-effect and during the opening cutscene; a shot
 *     fired at any of those moments is either refused or lands in the wrong
 *     world. So arrivals queue in the session and are drained here, on a frame
 *     when `Match` is actually sitting in AIM.
 *
 *   REPORT the turn once the simulation AND the presentation have finished.
 *     That single message is doing double duty by design — it is the desync
 *     audit and it is the "I have finished watching" signal that lets the server
 *     start the next player's clock. Sending it when the physics settled but the
 *     goal hold was still running would hand the opponent a turn while this
 *     screen was still showing a replay.
 *
 *   RECORD everything into an `InputLog`, so a match that desyncs can be
 *     replayed offline rather than described from memory.
 *
 * ── why it is not in the controller ──────────────────────────────────────
 * `main.js` ticks only the controller whose turn it is. A "your turn was
 * skipped" message for the LOCAL player arrives while the online controller is
 * not being ticked at all, so its `update` is the one place this cannot live.
 * See `OnlineController`'s header.
 *
 * ── and it still contains no socket ──────────────────────────────────────
 * Everything here goes through `OnlineSession`. The word `WebSocket` appears in
 * exactly one file in `src/`, and it is not this one.
 */

export class OnlineMatch {
  /**
   * @param {object} opts
   * @param {import('./OnlineSession.js').OnlineSession} opts.session
   * @param {import('../game/Match.js').Match} opts.match
   */
  constructor({ session, match }) {
    this.session = session;
    this.match = match;

    /** Everything that happened, in wire order. Exportable from the panel. */
    this.log = new InputLog({
      mode: session.match?.mode ?? 'knockout',
      seed: session.match?.seed ?? 0,
      label: `online/${session.match?.roomId ?? '?'}`,
    });

    /**
     * A turn is in flight: something was played and the world has not finished
     * responding. Cleared when the report goes out.
     */
    this._settling = false;
    this._settlingTurn = -1;

    /** Reported turns, so a report cannot go out twice for one turn. */
    this._reported = new Set();

    /** Set when the match must stop dead — desync, forfeit, disconnect. */
    this.halted = null;

    /**
     * Corrupt the next report on purpose. The debug panel's 강제 데스싱크.
     *
     * ── a detector nobody has watched fire is a detector nobody has ─────────
     * The desync path is the one piece of this that is supposed to never run in
     * normal play, which makes it the piece most likely to be broken without
     * anybody noticing. So there is a button that breaks the match deliberately,
     * and it works by lying in the REPORT rather than by damaging the world:
     * damaging the world would also have to be undone, and a half-repaired
     * simulation is a worse thing to leave behind than a stopped match.
     *
     * It is one-shot. The point is to see the handling, not to jam the client.
     */
    this.forceDesync = false;

    this._unsubs = [
      session.on('desync', (m) => {
        this.halted = {
          reason: OVER_REASON.DESYNC,
          message: '두 기기의 시뮬레이션이 어긋났습니다',
          detail: m,
        };
      }),
      session.on('over', (m) => {
        if (m.reason !== OVER_REASON.PLAYED) {
          this.halted = { reason: m.reason, message: m.message, detail: m };
        }
      }),
    ];
  }

  // ── local player acts ────────────────────────────────────────────────────

  /**
   * The local player fired. Record it, send it, and let it through.
   *
   * ── the counter is read BEFORE the shot is applied ───────────────────────
   * `rngState` is what makes a lockstep peer immune to the one thing an event
   * list cannot describe. `AimInput` draws a shot's seed when the drag STARTS,
   * so a press that is pulled back inside the deadzone and released has already
   * moved the global counter and produced no event at all. The receiving client
   * did not see that gesture and cannot know the counter moved.
   *
   * Sending the counter — and restoring it before applying, over there — means
   * the two streams cannot drift apart no matter how much aborted aiming
   * happened in between. Without it the first cancelled drag desyncs the match.
   *
   * @param {import('../game/shot.js').Shot} shot
   */
  localShot(shot) {
    const rngState = peekSeed();
    this.log.recordShot(this.session.mySeat, shot);
    this.session.sendShot(shot, rngState);
    this._beginSettle();
  }

  /** The local player played a card. Same discipline as `localShot`. */
  localCard(cardId) {
    const rngState = peekSeed();
    this.log.recordCard(this.session.mySeat, cardId);
    this.session.sendCard(cardId, rngState);
    // A card does not end the turn; nothing to settle and nothing to report.
  }

  _beginSettle() {
    this._settling = true;
    this._settlingTurn = this.session.turn;
  }

  // ── the frame ────────────────────────────────────────────────────────────

  update() {
    if (!this.session.match) return;
    this._drain();
    this._maybeReport();
  }

  /**
   * Apply at most one queued remote input, if the match can take it.
   *
   * One per frame rather than the whole queue: each one starts a simulation that
   * has to finish before the next is legal, and `_settling` will refuse the rest
   * anyway. Draining in a loop would just spin.
   */
  _drain() {
    if (this.halted) return;
    if (this._settling) return;
    if (this.match.state !== MATCH_STATE.AIM) return;
    if (!this.session.hasPending) return;

    const item = this.session.takePending();
    if (!item) return;

    if (item.kind === INPUT_KIND.SKIP) {
      /**
       * Nobody moved in time.
       *
       * Applied on BOTH clients off the same server message, and it draws no
       * random numbers — see `Match.skipTurn` — so the two seeded streams stay
       * in step across it. Recorded in the log for the same reason it is sent:
       * the board moved on, and a replay that omitted it would run every later
       * shot as the wrong player.
       */
      this.log.recordSkip(item.player);
      if (this.match.skipTurn()) this._beginSettle();
      return;
    }

    const ev = item.event;
    if (!ev) return;

    // The counter as it stood on the machine that made this move.
    seedRun(ev.rngState >>> 0);

    if (ev.kind === INPUT_KIND.CARD) {
      this.log.recordCard(item.player, ev.cardId);
      this.match.playCard(ev.cardId);
      return;
    }

    if (ev.kind === INPUT_KIND.SHOT) {
      const shot = InputLog.shotOf(ev);
      this.log.recordShot(item.player, shot);
      // Straight into the same call a local shot takes. A remote shot that went
      // through a different path would only prove that path deterministic.
      if (this.match.fire(shot)) this._beginSettle();
    }
  }

  /**
   * Once the world has stopped and the screen has caught up, say what happened.
   *
   * The state test is the whole of the timing: `Match` returns to AIM only after
   * the simulation settled, any goal hold ran, any respawn animation finished
   * and the next turn was set up — and goes to OVER when somebody has won. Both
   * are the real "nothing more is going to happen" moment, which is exactly what
   * the server is waiting for before it starts the next clock.
   */
  _maybeReport() {
    if (!this._settling || this.halted) return;
    const state = this.match.state;
    if (state !== MATCH_STATE.AIM && state !== MATCH_STATE.OVER) return;

    const turn = this._settlingTurn;
    this._settling = false;
    if (this._reported.has(turn)) return;
    this._reported.add(turn);

    const over = state === MATCH_STATE.OVER;
    let hash = this.match.physics.hashState();
    if (this.forceDesync) {
      this.forceDesync = false;
      hash = 'deadbeef';
    }
    this.session.reportTurn({
      turn,
      hash,
      // Whose move it is now, according to THIS machine's rules. The server has
      // no rule set and cannot work it out; it compares the two answers instead.
      next: this.match.rules.currentPlayer,
      over,
      winner: over ? (this.match.winner ?? null) : null,
    });
  }

  /** The local player is leaving on purpose. */
  forfeit() {
    this.session.forfeit();
  }

  dispose() {
    for (const un of this._unsubs) un();
    this._unsubs = [];
  }
}

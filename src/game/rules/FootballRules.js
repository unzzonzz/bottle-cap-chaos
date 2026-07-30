import { RuleSet } from './RuleSet.js';

/**
 * 알까기 축구 — 4 v 4, one flick a turn, first to N goals.
 *
 * The second mode, and the one the rule layer's interface was built for. It
 * shares the whole apparatus with knockout: the same bow, the same impulse, the
 * same three-stage settle detector, the same snapshot-and-replay determinism
 * check. What differs is entirely here and in `FootballPitch`.
 *
 * ── nothing is ever eliminated ───────────────────────────────────────────────
 * `alive` stays all true for the whole match. There is no out — the pitch is
 * fenced — so all eight caps are always on it and always selectable by their
 * owner. That the base class still carries `alive` is not waste: the renderer
 * and the HUD read it every frame and a mode that quietly stopped providing it
 * would take the render loop down rather than show a wrong number.
 *
 * ── the ball is not a cap ────────────────────────────────────────────────────
 * `canSelect` never returns true for it because it is not in `capOwner` at all —
 * the arena keeps it as a separate kind, so "you cannot shoot the ball" is a
 * fact about what the ball IS rather than a check somewhere that could be
 * forgotten. It moves only by being hit.
 *
 * ── a goal is a sensor, judged once, at rest ─────────────────────────────────
 * `resolveTurn` asks the narrow phase whether the ball overlaps a goal volume,
 * with everything stationary. Never a coordinate comparison, and never during
 * flight — the same discipline knockout judges an out by. What makes that
 * sound for football, where a ball that crosses the line has scored even if it
 * comes back, is that the net cannot give it back: the net colliders combine
 * restitution by Min at zero, so a ball that goes in stops in. See
 * `FootballPitch`.
 *
 * ── own goals count, and count for the other side ────────────────────────────
 * The scorer is whoever does NOT defend the goal the ball ended up in, whatever
 * happened on the way there. There is no branch on who took the shot, because
 * there is no version of football where knocking it into your own net is not a
 * goal — the note in the HUD is the only place the distinction is made, and
 * that is presentation.
 */

export class FootballRules extends RuleSet {
  constructor(arena) {
    super(arena);
    this.reset();
  }

  get name() {
    return '알까기 축구';
  }

  reset() {
    // Always all true. See the header.
    this.alive = this.arena.capBodies.map(() => true);
    this.score = [0, 0];
    this.player = 0;
    this.turn = 0;
    /** Which of their own caps each player last shot with. Cycles. */
    this._cursor = [0, 0];
    this._selected = [-1, -1];
    /**
     * Who kicks off next, set when a goal goes in and consumed by `advanceTurn`.
     *
     * The conceding side restarts, so a player who has just been scored against
     * gets the first move of the new round rather than watching the scorer take
     * it as well. Held rather than applied immediately because `resolveTurn` is
     * a judgement and `advanceTurn` is the move — keeping those separate is what
     * lets the replay check re-run a scoring turn without the turn order
     * drifting a step each time.
     */
    this._kickoffBy = null;
    /**
     * A goal seen during THIS turn, held until the turn is judged.
     *
     * ── the Law is "has crossed", not "is across at the end" ────────────────
     * Judging only at rest was right about WHEN to judge and wrong about what
     * the question is. A hard shot enters the net, the netting kills the bounce,
     * and the ball still trickles back out over the line — measured, two of
     * eight shots that got wholly across at 420 units/s came to rest just
     * OUTSIDE it, and the goal silently became a corner.
     *
     * No amount of net material fixes that, because the ball is not bouncing —
     * it is rolling. Once the whole ball is over the line it has scored, and
     * nothing after that can un-score it. So the crossing is latched when it
     * happens and the verdict reads the latch.
     *
     * Still judged once, still with everything stopped: `observe` only RECORDS,
     * and `resolveTurn` is the only thing that scores.
     */
    this._latched = null;
    /**
     * Where the ball crossed the lines on its current excursion, or null.
     *
     * Latched exactly like the goal above, and for the same kind of reason: the
     * restart is a fact about a moment DURING the turn, and by the time the turn
     * is judged that moment is long gone and the ball is somewhere else
     * entirely. See `FootballPitch.crossing`.
     *
     * Cleared when the ball comes back inside, so a ball that goes out, returns,
     * and goes out again is restarted from the second crossing — the one that
     * actually put it out. Kept once set within one excursion, so a ball
     * rattling along the fence cannot overwrite the crossing with a later
     * position that crossed nothing.
     */
    this._exit = null;
    /** The last sample with the ball inside: the other end of that segment. */
    this._inside = null;
  }

  get currentPlayer() {
    return this.player;
  }

  status() {
    const goals = this.arena.config.football.winningGoals;
    return `${this.score[0]} : ${this.score[1]}  ·  ${goals}선승  ·  턴 ${this.turn}`;
  }

  // ── selection ────────────────────────────────────────────────────────────

  shooterFor(player) {
    const mine = this.livingCapsOf(player);
    if (!mine.length) return -1;
    const picked = this._selected[player];
    if (picked >= 0 && this.arena.capOwner[picked] === player) return picked;
    return mine[this._cursor[player] % mine.length];
  }

  canSelect(capIndex, player) {
    return (
      capIndex >= 0 &&
      capIndex < this.arena.capCount &&
      this.arena.capOwner[capIndex] === player
    );
  }

  select(capIndex) {
    if (this.canSelect(capIndex, this.player)) this._selected[this.player] = capIndex;
  }

  // ── judging ──────────────────────────────────────────────────────────────

  /**
   * Which player's goal the ball is sitting in, or -1.
   *
   * Two sensors, asked in turn. They cannot both answer — they are at opposite
   * ends of the pitch — but the loop is written to take the first rather than to
   * assume it, because an inverted sensor box from a bad slider value is exactly
   * the kind of thing that would otherwise report a goal at both ends at once
   * and be read as a scoring bug.
   */
  _conceded() {
    const layout = this.arena.layout;
    for (let player = 0; player < 2; player++) {
      const sensor = layout.goalSensorOf?.(player) ?? -1;
      if (sensor >= 0 && this.arena.ballInside(sensor)) return player;
    }
    return -1;
  }

  /**
   * The turn is over. Judge it, in this order.
   *
   * ── the goal is asked FIRST, and that is a rule not an optimisation ──────
   * A ball in the net is past the goal line, so both tests answer yes and only
   * the order decides which one counts. Asking the goal first means a scored
   * goal can never be turned into a corner by the geometry that was true of it
   * anyway — and the alternative failure is silent, because a ball reset to the
   * corner flag looks exactly like a ball that went behind.
   *
   * Everything else is unchanged: judged once, at rest, with nothing moving.
   */
  /**
   * Is there a goal sitting in a net RIGHT NOW?
   *
   * Read-only, and it changes nothing: no score, no bookkeeping, no verdict. It
   * asks `_conceded` — the same narrow-phase query `resolveTurn` will ask when
   * the turn is over — so the two can never disagree about what a goal is.
   *
   * It exists for the goal hold's `ballStop` timing, which has to know mid-turn,
   * and for the note the HUD shows while that hold runs. Judging still happens
   * exactly once, at rest, in `resolveTurn`.
   *
   * @returns {{conceded: number, scorer: number, note: string}|null}
   */
  pendingGoal() {
    const conceded = this._conceded();
    if (conceded < 0) return null;
    const scorer = 1 - conceded;
    return { conceded, scorer, note: `⚽ PLAYER ${scorer + 1} 득점` };
  }

  /**
   * One step of the turn has happened. Note anything that cannot be undone.
   *
   * Called from the sim loop, once per physics step, and it must stay this
   * cheap: one narrow-phase query against a sensor, skipped entirely once the
   * latch is set. It scores nothing and ends nothing.
   */
  observe() {
    this._trackExit();
    if (this._latched) return;
    const g = this.pendingGoal();
    if (g) this._latched = g;
  }

  /**
   * Follow the ball across the lines. Records a crossing; judges nothing.
   *
   * Two cheap reads a step — the ball's centre, and the same `ballIsOut`
   * subtraction the verdict will ask at rest — so this costs about what the goal
   * latch above costs and for the same reason: the answer is only available
   * while it is happening.
   */
  _trackExit() {
    const layout = this.arena.layout;
    if (!layout.ballIsOut || !this.arena.hasBall) return;
    const b = this.arena.ballCom();
    if (!b) return;
    const here = { x: b.x, z: b.z };

    if (!layout.ballIsOut(this.arena)) {
      this._inside = here;
      // Back between the lines: whatever it did on the way out did not put it
      // out, and the next crossing is the one that counts.
      this._exit = null;
      return;
    }
    if (this._exit) return;
    // No inside sample means the ball was already out when this turn started —
    // it cannot be, the previous turn put it back — so the point itself is the
    // only honest answer and `crossing` classifies it the old way.
    this._exit = layout.crossing?.(this._inside ?? here, here) ?? null;
  }

  /** A new shot. Whatever the last turn saw is no longer this turn's business. */
  beginTurn() {
    this._latched = null;
    this._exit = null;
    this._inside = null;
  }

  resolveTurn() {
    // The latch wins if it was ever set: the ball crossed, and a ball that has
    // crossed has scored whatever it did afterwards. Falling back to the live
    // query keeps a goal that is simply still sitting in the net working
    // identically — the two agree in every case except the one the latch exists
    // for.
    const conceded = this._latched ? this._latched.conceded : this._conceded();

    if (conceded < 0) {
      this._kickoffBy = null;
      return this._judgeOut();
    }

    const scorer = 1 - conceded;
    this.score[scorer]++;
    this._kickoffBy = conceded;

    const target = Math.max(1, Math.round(this.arena.config.football.winningGoals));
    const winner = this.score[scorer] >= target ? scorer : null;

    // The only place the shooter is looked at, and only to name the goal. The
    // score has already been given to the other side either way.
    const own = this.player === conceded;
    const note = own
      ? `⚽ 자책골 — PLAYER ${scorer + 1} 득점  ${this.score[0]}:${this.score[1]}`
      : `⚽ PLAYER ${scorer + 1} 득점  ${this.score[0]}:${this.score[1]}`;

    return {
      eliminated: [],
      winner,
      note,
      // Only when the match carries on. Rebuilding into a finished match would
      // wipe the final position off the screen the moment it was reached.
      resetField: winner === null,
    };
  }

  /**
   * No goal. Did it stop outside the lines?
   *
   * Only the ball is asked. Caps in the run-off stay exactly where they came to
   * rest — there is no out for a cap in this mode and nothing here invents one.
   */
  _judgeOut() {
    const layout = this.arena.layout;
    if (!layout.ballIsOut?.(this.arena)) {
      return { eliminated: [], winner: null, note: '' };
    }
    // Restarted from where it crossed, not from where it stopped. The two are
    // routinely metres apart — there is a run-off and then a fence behind the
    // line — and only the first of them is football.
    const spot = layout.respawnFor(this.arena, this._exit);
    return {
      eliminated: [],
      winner: null,
      note: spot.kind === 'corner' ? '코너' : '스로인',
      // A REQUEST, like `resetField`. The rules do not move anything; `Match`
      // rolls the ball there and only then opens the next turn.
      respawn: spot,
    };
  }

  advanceTurn() {
    const mine = this.livingCapsOf(this.player);
    if (mine.length) this._cursor[this.player] = (this._cursor[this.player] + 1) % mine.length;
    this._selected[this.player] = -1;
    this.turn++;

    if (this._kickoffBy !== null) {
      this.player = this._kickoffBy;
      this._kickoffBy = null;
      return;
    }
    this.player = (this.player + 1) % 2;
  }

  /** See `RuleSet.setCurrentPlayer`. The extra-turn card, and nothing else. */
  setCurrentPlayer(player) {
    this.player = ((player % 2) + 2) % 2;
    this._selected[this.player] = -1;
  }

  onFieldReset() {
    // Both players start the new round on their own keeper, so the first move
    // after a goal is not whichever cap the cursor happened to be pointing at
    // from the round before.
    this._cursor = [0, 0];
    this._selected = [-1, -1];
  }

  // ── serialisation ────────────────────────────────────────────────────────
  //
  // The score is in here, and it has to be. A replay rewinds the physics world
  // and restores this state before re-firing, so a scoring turn replayed with
  // the score left out would count the goal a second time and the check would
  // report a determinism failure that was really a bookkeeping one.

  save() {
    return {
      alive: this.alive.slice(),
      score: this.score.slice(),
      player: this.player,
      turn: this.turn,
      cursor: this._cursor.slice(),
      selected: this._selected.slice(),
      kickoffBy: this._kickoffBy,
      latched: this._latched ? { ...this._latched } : null,
      // Both halves of the crossing tracker. A replay that re-fires the turn
      // re-walks the same steps and would re-latch the same crossing anyway, but
      // it has to START from the same place to do that — a stale `_inside` from
      // the run that is being replayed would be one end of a segment that never
      // existed.
      exit: this._exit ? { ...this._exit } : null,
      inside: this._inside ? { ...this._inside } : null,
    };
  }

  load(s) {
    this.alive = s.alive.slice();
    this.score = s.score.slice();
    this.player = s.player;
    this.turn = s.turn;
    this._cursor = s.cursor.slice();
    this._selected = s.selected.slice();
    this._kickoffBy = s.kickoffBy ?? null;
    this._latched = s.latched ? { ...s.latched } : null;
    this._exit = s.exit ? { ...s.exit } : null;
    this._inside = s.inside ? { ...s.inside } : null;
  }
}

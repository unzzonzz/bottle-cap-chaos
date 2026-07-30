import { RuleSet } from './RuleSet.js';

/**
 * 알까기 컬링 — four throws each, alternating, most caps in the house wins.
 *
 * The third mode, and the first one whose pieces are not all on the field when
 * the match starts. Everything else it shares: the same bow, the same impulse,
 * the same three-stage settle detector (on its own clock — see
 * `CurlingLane.turnOverrides`), the same snapshot-and-replay determinism check.
 *
 * ── the field FILLS UP; it does not start full ───────────────────────────────
 * A cap arrives at the throw spot on the turn it is thrown and stays on the lane
 * afterwards as an obstacle and a target. `alive[i]` therefore means "on the
 * lane right now": false before it is dealt, true once it is, false again if it
 * crosses a line. The renderer already hides a cap that is not alive, so an
 * undealt cap is invisible for free.
 *
 * The BODIES all exist from the start — see `CurlingLane.placements` for why
 * they have to — so this never creates or destroys anything. It asks for a cap
 * to be dealt (`needsDeploy`) and `Match` moves it, exactly as football asks for
 * a ball to be put back and `Match` rolls it.
 *
 * ── the score is a COUNT, and the tie is broken by distance ──────────────────
 * "하우스 센서 안에 있는 뚜껑 개수가 많은 팀이 승리 ... 실제 컬링 룰(중심 거리
 * 기반)이 아니다." Counting makes ties common — 2–2 is an ordinary result — so
 * the tiebreaker is not an afterthought: the team with the cap nearest the house
 * centre takes it, then the second nearest, and if neither side has anything in
 * the house at all it is a draw. Whichever of those decided it is reported, in
 * the note and on the result screen, because a player who cannot see why they
 * lost a 2–2 will read it as the game having picked at random.
 *
 * ── in the house means the CENTRE is in the house ────────────────────────────
 * Not "any part of it overlaps", which is what `Arena.capsInside` answers and
 * what the out lines below are judged by. A cap is eleven colliders wide and the
 * house is a circle, so "any part" would count a cap sitting almost entirely
 * outside the outer ring on the strength of one skirt box — and two caps
 * straddling the edge on opposite sides would both count while visibly not being
 * in the same place. The centre of mass is one point, it is where the cap
 * plainly IS, and it is the same point the tiebreaker measures from, so the
 * count and the distance can never disagree about a cap.
 *
 * `Arena.pointInSensor` asks the narrow phase whether that point is inside the
 * house volume. It is still a sensor and still not a coordinate comparison; it
 * is a point query instead of an overlap query.
 *
 * ── out is judged ONCE, at rest, and only then ───────────────────────────────
 * "오버슛 제거 판정은 턴 종료 후에 수행한다. 나갔다 들어온 뚜껑은 살아 있다." So
 * nothing is latched during flight and `observe` scores nothing — it only keeps
 * the live house count the HUD shows, which is a readout and not a verdict.
 */

export class CurlingRules extends RuleSet {
  constructor(arena) {
    super(arena);
    this.reset();
  }

  get name() {
    return '알까기 컬링';
  }

  /** Throws per player. Half the bodies the lane built, by construction. */
  get perTeam() {
    return Math.max(1, Math.floor(this.arena.capCount / 2));
  }

  /** Turns in the whole match. */
  get totalTurns() {
    return this.perTeam * 2;
  }

  reset() {
    // Nothing is on the lane at the start. See the header.
    this.alive = this.arena.capBodies.map(() => false);
    /** Has this cap ever been put on the lane? Never goes back to false. */
    this.dealt = this.arena.capBodies.map(() => false);
    /** Throws COMPLETED, per player. The shooter is derived from it. */
    this.thrown = [0, 0];
    this.player = 0;
    this.turn = 0;
    /** Live house count, for the HUD. A readout; `resolveTurn` is the judge. */
    this.house = [0, 0];
    /** The final judgement, kept for the result screen. Null until the end. */
    this.result = null;
  }

  get currentPlayer() {
    return this.player;
  }

  status() {
    const per = this.perTeam;
    return (
      `하우스 P1 ${this.house[0]} / P2 ${this.house[1]}  ·  ` +
      `투구 ${Math.min(this.turn + 1, this.totalTurns)}/${this.totalTurns}  ·  ` +
      `P1 ${this.thrown[0]}/${per} P2 ${this.thrown[1]}/${per}`
    );
  }

  /** Throws this player has left, including the one being taken. */
  throwsLeft(player) {
    return Math.max(0, this.perTeam - this.thrown[player]);
  }

  // ── selection ────────────────────────────────────────────────────────────

  /**
   * The cap this player throws next.
   *
   * A fixed index rather than a search: `CurlingLane.placements` gives player 0
   * the first `perTeam` slots and player 1 the next, so "your nth throw" is
   * arithmetic and cannot drift from what was built.
   */
  shooterFor(player) {
    const per = this.perTeam;
    if (this.thrown[player] >= per) return -1;
    return player * per + this.thrown[player];
  }

  /**
   * Exactly one cap is selectable: the one being thrown.
   *
   * There is no choosing in curling — you throw the next stone — and this is
   * also what keeps the caps already lying on the lane from being picked up and
   * fired a second time. `AimInput.hitTest` walks every cap through this, so a
   * press on last turn's cap falls through to the camera, which is right.
   */
  canSelect(capIndex, player) {
    return capIndex >= 0 && capIndex === this.shooterFor(player);
  }

  /** Nothing to choose. The base class's no-op would do; this says why. */
  select() {}

  // ── dealing ──────────────────────────────────────────────────────────────

  /** Is this cap still in the pocket? `Match` asks before it opens the turn. */
  needsDeploy(capIndex) {
    return capIndex >= 0 && capIndex < this.dealt.length && !this.dealt[capIndex];
  }

  /** `Match` has put it on the lane. It is in play from here. */
  onDeployed(capIndex) {
    if (capIndex < 0 || capIndex >= this.dealt.length) return;
    this.dealt[capIndex] = true;
    this.alive[capIndex] = true;
  }

  /** Which caps are actually on the lane. The throw spot's search reads it. */
  onLane() {
    return this.alive.slice();
  }

  // ── judging ──────────────────────────────────────────────────────────────

  /**
   * Every cap in the house, with how far its centre is from the middle.
   *
   * The one place either number is computed, so the count, the tiebreaker, the
   * HUD and the panel's verification list are all reading the same answer.
   *
   * @returns {{cap: number, player: number, distance: number}[]} nearest first
   */
  inHouse() {
    const house = this.arena.sensors.house ?? -1;
    const centre = this.arena.layout.metrics;
    const out = [];
    for (let i = 0; i < this.arena.capCount; i++) {
      if (!this.alive[i]) continue;
      const c = this.arena.capCom(i);
      if (!this.arena.pointInSensor(house, c)) continue;
      out.push({
        cap: i,
        player: this.arena.capOwner[i],
        // Plain arithmetic, and deliberately: this is a DISTANCE, not a
        // boundary test. The boundary was the sensor's question and it has
        // already been answered; asking the narrow phase how far something is
        // from the middle of a circle would be machinery in place of a
        // subtraction. Measured on the board plane, because the house is a
        // place on the lane and a cap resting on its rim is no less in it.
        distance: Math.hypot(c.x - 0, c.z - (centre?.houseZ ?? 0)),
      });
    }
    out.sort((a, b) => a.distance - b.distance || a.cap - b.cap);
    return out;
  }

  _countHouse(list) {
    const n = [0, 0];
    for (const e of list) n[e.player]++;
    return n;
  }

  /**
   * Keep the live count fresh while the turn plays out.
   *
   * A READOUT and nothing else — the HUD shows it, and `resolveTurn` recomputes
   * it from scratch when it judges, so nothing downstream depends on what this
   * happened to see mid-flight. Cheap: one point query per cap on the lane, and
   * there are at most eight.
   */
  observe() {
    this.house = this._countHouse(this.inHouse());
  }

  /**
   * The turn is over. Take the overshoots off, then count.
   *
   * In this order, and it matters: a cap that has crossed a line is not in the
   * house even if it somehow overlaps it, so the removal has to settle before
   * anything is counted.
   */
  resolveTurn() {
    // "완전히 넘어간" — no part of the cap is left between the two lines. The
    // narrow phase answers it against the in-play volume; nothing here compares
    // a coordinate to a line, and nothing was latched during the flight, so a
    // cap that went out and came back is still on the lane.
    const outside = this.arena.capsOutside(this.arena.sensors.inPlay ?? -1);

    const eliminated = [];
    for (let i = 0; i < outside.length; i++) {
      if (outside[i] && this.alive[i]) {
        this.alive[i] = false;
        eliminated.push(i);
      }
    }

    const list = this.inHouse();
    this.house = this._countHouse(list);

    // The last cap has been thrown when every body has been dealt — the shooter
    // for this turn was dealt before it opened, so this is exact.
    const finished = this.dealt.every(Boolean);
    if (!finished) {
      return { eliminated, winner: null, note: this._turnNote(eliminated) };
    }

    /**
     * Everybody has thrown everything. Recorded HERE because `advanceTurn` —
     * which is what normally counts a throw — never runs on the turn that ends
     * the match: `Match._endTurn` returns as soon as a winner is declared. Left
     * out, the scoreboard's last frame reads "남은 투구 0/4 · 1/4" for a player
     * who has just thrown their fourth.
     */
    const per = this.perTeam;
    this.thrown = [per, per];

    const judged = this._judge(list);
    this.result = judged;
    return {
      eliminated,
      winner: judged.winner,
      note: judged.note,
      // Shown under the winner line on the result screen. Only this mode fills
      // it in; see `RuleSet.resolveTurn`.
      resultNote: judged.detail,
    };
  }

  /** What just happened, for the HUD's note line. */
  _turnNote(eliminated) {
    const parts = [];
    if (eliminated.length) {
      const own = eliminated.filter((i) => this.arena.capOwner[i] === this.player).length;
      const theirs = eliminated.length - own;
      if (theirs) parts.push(`상대 ${theirs}개 라인 아웃`);
      if (own) parts.push(`자책 ${own}개 라인 아웃`);
    }
    parts.push(`하우스 ${this.house[0]} : ${this.house[1]}`);
    return parts.join('  ·  ');
  }

  /**
   * Who won, and by what.
   *
   * ── count first ─────────────────────────────────────────────────────────
   * More caps in the house takes it outright. That is the mode's rule and it is
   * not a real curling rule; see the header.
   *
   * ── then distance, position by position ─────────────────────────────────
   * On a tie the two teams' caps are compared nearest-to-nearest: whoever owns
   * the single closest cap to the middle wins, and if that is somehow a dead
   * heat, the second closest, and so on. `inHouse` has already sorted by
   * distance, so this is a walk down two lists.
   *
   * ── and a draw is a real outcome ────────────────────────────────────────
   * Both sides empty is a draw — there is nothing to measure and inventing a
   * winner from who threw last would be a rule nobody was told. Two identical
   * distance lists is also a draw; it cannot happen in floating point, and
   * falling through to "player 0 wins" if it ever did would be worse than
   * saying so.
   */
  _judge(list) {
    const count = this._countHouse(list);
    const score = `${count[0]} : ${count[1]}`;

    if (count[0] !== count[1]) {
      const winner = count[0] > count[1] ? 0 : 1;
      return {
        winner,
        tiebreak: false,
        note: `🥌 PLAYER ${winner + 1} 승리  ·  하우스 ${score}`,
        detail: `하우스 ${score}`,
      };
    }

    if (count[0] === 0) {
      return {
        winner: -1,
        tiebreak: false,
        note: '🥌 무승부  ·  양 팀 모두 하우스에 없음',
        detail: '양 팀 모두 하우스에 뚜껑 없음 — 무승부',
      };
    }

    const mine = [0, 1].map((p) => list.filter((e) => e.player === p).map((e) => e.distance));
    for (let rank = 0; rank < count[0]; rank++) {
      const a = mine[0][rank];
      const b = mine[1][rank];
      if (a === b) continue;
      const winner = a < b ? 0 : 1;
      const nth = rank === 0 ? '가장 가까운' : `${rank + 1}번째로 가까운`;
      return {
        winner,
        tiebreak: true,
        note: `🥌 동점 ${score} — 중심 거리로 PLAYER ${winner + 1} 승리`,
        detail: `동점 ${score} · ${nth} 뚜껑 ${Math.min(a, b).toFixed(2)} vs ${Math.max(a, b).toFixed(2)} — 타이브레이커`,
      };
    }

    return {
      winner: -1,
      tiebreak: true,
      note: `🥌 무승부 ${score} — 중심 거리까지 동일`,
      detail: `동점 ${score} · 중심 거리도 완전히 동일 — 무승부`,
    };
  }

  advanceTurn() {
    this.thrown[this.player] = Math.min(this.perTeam, this.thrown[this.player] + 1);
    this.turn++;
    // Strict alternation, and no "skip a player with nothing left" branch: both
    // players get exactly `perTeam` throws and `resolveTurn` has already ended
    // the match by the time either of them runs out.
    this.player = (this.player + 1) % 2;
  }

  /**
   * See `RuleSet.setCurrentPlayer`. The extra-turn card, and only it.
   *
   * Curling does not use cards — `MODES.curling.cards` is false and `playCard`
   * refuses — so nothing can reach this. It is implemented anyway rather than
   * left as the base class's no-op, because "nothing can reach it" is a fact
   * about another file, and a silent no-op here would be a rule that quietly
   * did not apply if that ever changed.
   */
  setCurrentPlayer(player) {
    const p = ((player % 2) + 2) % 2;
    this.player = this.thrown[p] < this.perTeam ? p : (p + 1) % 2;
  }

  // ── serialisation ────────────────────────────────────────────────────────
  //
  // `dealt` and `thrown` are in here and they have to be. A replay rewinds the
  // physics world to the turn's snapshot — which was taken AFTER the shooter was
  // dealt — and restores this alongside it. Left out, the replay would re-deal
  // the same cap on top of itself and the check would report a determinism
  // failure that was really a bookkeeping one.

  save() {
    return {
      alive: this.alive.slice(),
      dealt: this.dealt.slice(),
      thrown: this.thrown.slice(),
      player: this.player,
      turn: this.turn,
      house: this.house.slice(),
      result: this.result ? { ...this.result } : null,
    };
  }

  load(s) {
    this.alive = s.alive.slice();
    this.dealt = s.dealt.slice();
    this.thrown = s.thrown.slice();
    this.player = s.player;
    this.turn = s.turn;
    this.house = (s.house ?? [0, 0]).slice();
    this.result = s.result ? { ...s.result } : null;
  }
}

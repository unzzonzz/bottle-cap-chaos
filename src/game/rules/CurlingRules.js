import { RuleSet } from './RuleSet.js';
import { Rng } from '../../physics/rng.js';
import { distanceToTarget } from '../layout/curlingTableMetrics.js';

/**
 * 알까기 컬링 — four rounds, one throw each, nearest to the far edge takes it.
 *
 * The third mode, and the only one whose match is a sequence of independent
 * ROUNDS rather than one continuous position. Everything else it shares with the
 * other two: the same bow, the same impulse, the same three-stage settle
 * detector on its own clock, the same snapshot-and-replay determinism check, and
 * the same falling-off-the-edge that survival uses — literally the same sensor
 * and the same `Arena.outOfBounds()` call. See `CurlingTable`.
 *
 * ── the field is EMPTIED between rounds ─────────────────────────────────────
 * "각 라운드마다 필드를 완전히 비우고 시작한다." A round is two throws — one
 * each — and when the second has settled and been judged, every cap still
 * standing is taken off. So a round is a clean two-cap position every time, and
 * nothing a player did in round 1 is sitting in the way in round 2.
 *
 * The rules do not move anything. `resolveTurn` returns `cleared`, and `Match`
 * stows them, exactly as it already stows `eliminated` — the same REQUEST split
 * that `needsDeploy` and `resetField` use. See `RuleSet.resolveTurn`.
 *
 * ── the lead ALTERNATES ─────────────────────────────────────────────────────
 * "선공이 매 라운드 교대된다. 1R: P1 선공 → 2R: P2 선공 → …" Throwing second is
 * the advantage in this mode — you can see what you have to beat, and you can
 * knock it off — so a fixed lead would hand one player that advantage four times
 * out of four. `leadFor(round)` is the whole of it, and round 1's lead is a
 * parameter: P1, P2, or a seeded draw. Seeded, never `Math.random`, because
 * "같은 시드·같은 입력이면 결과가 완전히 동일하다" has to survive the very first
 * decision the match makes.
 *
 * ── the judgement is a DISTANCE, and a fallen cap has none ──────────────────
 * "목표 라인에 가장 가까운 뚜껑의 주인이 그 라운드를 이긴다 … 떨어진 뚜껑은
 * 판정에서 제외된다." Those two together are the mode: the reward for going
 * close and the price of going too far are the same axis, so every throw is the
 * same decision made harder. A cap that has fallen is not far from the line, it
 * is NOT THERE — it does not appear in the round's comparison, it cannot set the
 * match's closest-cap tiebreaker, and no amount of having been closest before it
 * fell counts for anything.
 *
 * ── out is judged ONCE, at rest, and only then ──────────────────────────────
 * "판정 시점: 모든 물체가 완전히 멈춘 뒤." Nothing is latched during flight and
 * `observe` does nothing at all: `TurnSettle` establishes that the world has
 * stopped and `resolveTurn` then asks the pit sensor a single question. A cap in
 * mid-air cannot be judged because there is no such moment.
 */

export class CurlingRules extends RuleSet {
  constructor(arena) {
    super(arena);
    this.reset();
  }

  get name() {
    return '알까기 컬링';
  }

  /** Rounds in the match. Half the bodies the table built, by construction. */
  get rounds() {
    return Math.max(1, Math.floor(this.arena.capCount / 2));
  }

  /** Turns in the whole match: one throw each, every round. */
  get totalTurns() {
    return this.rounds * 2;
  }

  /** The table's numbers, for the distance. Null before the layout has built. */
  get metrics() {
    return this.arena.layout.metrics ?? null;
  }

  reset() {
    /** On the table right now. False before a cap is dealt AND after it leaves. */
    this.alive = this.arena.capBodies.map(() => false);
    /**
     * Has this cap ever been put on the table? Never goes back to false.
     *
     * `alive` moves in both directions in this mode, so it cannot answer "has
     * this been thrown" — this can, and it is what the audio layer's deploy cue
     * and `Match._deploy` both read.
     */
    this.dealt = this.arena.capBodies.map(() => false);
    /** Throws COMPLETED, per player. A readout; the round bookkeeping is below. */
    this.thrown = [0, 0];

    /** Round wins, per player. The score. */
    this.wins = [0, 0];
    /** Rounds nobody won. Not a point for anybody; here so the HUD can say so. */
    this.draws = 0;

    /** Which round is being played, 0-based. Reaches `rounds` when the match ends. */
    this.round = 0;
    /** Throws COMPLETED in this round: 0 or 1 while it runs, 2 never persists. */
    this.inRound = 0;
    /**
     * Who has already thrown in this round. Cleared when the round rolls over.
     *
     * Held explicitly rather than derived from `inRound` and the lead, and not
     * from `dealt` either. `dealt` is set the moment `Match._deploy` puts the cap
     * down — which happens BEFORE the turn opens, not after it is taken — so a
     * `shooterFor` that checked it would refuse the very cap it had just handed
     * out and the turn would open with nothing selectable. Deriving it from the
     * lead instead would work only for as long as the order within a round is
     * exactly [lead, other], which is true and is not something `shooterFor`
     * should have to know.
     */
    this.threw = [false, false];

    this.firstLead = this._firstLead();
    this.player = this.leadFor(0);
    this.turn = 0;

    /**
     * The single closest cap of the whole match, and who owned it.
     *
     * The tiebreaker, accumulated as it happens rather than reconstructed at the
     * end — by the end the caps have been swept off four times and there is
     * nothing left to measure. Only caps that were still on the table when their
     * round was judged are ever offered to it.
     */
    this.closest = null;

    /** What the last completed turn left on the table. Drawn; see `distanceMarks`. */
    this.marks = [];
    /** Per-round records, for the note line and the panel. */
    this.history = [];
    /** The final judgement, kept for the result screen. Null until the end. */
    this.result = null;
  }

  /**
   * Who throws first in round 1.
   *
   * `random` draws from a seed on the config rather than from `Math.random`, so
   * a match restarted from the same button opens the same way — the same
   * discipline every other "random" thing in the project follows. Changing the
   * seed on the panel changes the draw; leaving it alone means the coin lands
   * the same way every time, which is what makes a determinism check possible at
   * all.
   */
  _firstLead() {
    const c = this.arena.config.curling;
    if (c.firstLead === 'p2') return 1;
    if (c.firstLead === 'random') return new Rng(c.leadSeed >>> 0).float() < 0.5 ? 0 : 1;
    return 0;
  }

  /** Who leads round `r`. Alternates, always. */
  leadFor(r) {
    return (this.firstLead + r) % 2;
  }

  get currentPlayer() {
    return this.player;
  }

  get over() {
    return this.round >= this.rounds;
  }

  status() {
    const r = Math.min(this.round + 1, this.rounds);
    return (
      `라운드 ${r}/${this.rounds}  ·  ` +
      `P1 ${this.wins[0]} : ${this.wins[1]} P2  ·  ` +
      `선공 P${this.leadFor(Math.min(this.round, this.rounds - 1)) + 1}`
    );
  }

  // ── selection ────────────────────────────────────────────────────────────

  /**
   * The cap this player throws this round.
   *
   * A fixed index rather than a search: `CurlingTable.placements` gives player 0
   * the first `rounds` slots and player 1 the next, so "your cap for round n" is
   * arithmetic and cannot drift from what was built.
   *
   * −1 once that player has thrown this round, which is what makes "각 라운드에
   * 각자 딱 1번씩만" a fact about the rules rather than about the turn order.
   * `Match._beginAim` treats −1 as the match being over, so this must never
   * return −1 for a player whose turn it legitimately is — and it cannot,
   * because `advanceTurn` only ever hands the turn to somebody who still has a
   * throw in the round it hands it in.
   */
  shooterFor(player) {
    if (this.over) return -1;
    if (this.threw[player]) return -1;
    const cap = player * this.rounds + this.round;
    if (cap < 0 || cap >= this.arena.capCount) return -1;
    return cap;
  }

  /**
   * Exactly one cap is selectable: the one being thrown.
   *
   * There is no choosing in curling — you throw the cap you are given — and this
   * is also what keeps the round's other cap, already lying on the table, from
   * being picked up and fired a second time. `AimInput.hitTest` walks every cap
   * through this, so a press on the opponent's cap falls through to the camera,
   * which is right.
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

  /** `Match` has put it on the table. It is in play from here. */
  onDeployed(capIndex) {
    if (capIndex < 0 || capIndex >= this.dealt.length) return;
    this.dealt[capIndex] = true;
    this.alive[capIndex] = true;
  }

  /** Which caps are actually on the table. The throw spot's search reads it. */
  onLane() {
    return this.alive.slice();
  }

  // ── measuring ────────────────────────────────────────────────────────────

  /**
   * Every cap on the table, with how far it is from the target line.
   *
   * The one place that distance is computed for judging, so the round winner,
   * the match tiebreaker, the marks drawn on the table and the panel's live
   * readout are all reading the same answer. A second implementation anywhere
   * would eventually award a round to the cap that visibly lost it.
   *
   * @returns {{cap: number, player: number, x: number, z: number, distance: number}[]}
   *   nearest first
   */
  standings() {
    const m = this.metrics;
    if (!m) return [];
    const out = [];
    for (let i = 0; i < this.arena.capCount; i++) {
      if (!this.alive[i]) continue;
      const c = this.arena.capCom(i);
      out.push({
        cap: i,
        player: this.arena.capOwner[i],
        x: c.x,
        z: c.z,
        distance: distanceToTarget(m, c.z),
      });
    }
    // Tie-broken by index so the order is a function of the world and not of
    // whatever the sort happened to do with two equal keys.
    out.sort((a, b) => a.distance - b.distance || a.cap - b.cap);
    return out;
  }

  /**
   * What the renderer draws between each cap and the line.
   *
   * "거리 표시가 있어서 누가 더 가까운지 눈으로 알 수 있다" is a completion
   * criterion, and it is one the eye cannot meet on its own: two caps a
   * centimetre apart down a table this long are the same distance away as far as
   * anyone watching can tell. So the answer the judge computed is drawn.
   *
   * Held rather than recomputed per frame, and deliberately: these are the marks
   * for a SETTLED turn. Recomputing them live would draw a line to a cap that is
   * still moving and would make the winner flicker between the two of them for
   * the whole of the slide. Cleared when a shot fires, rebuilt when it stops.
   */
  distanceMarks() {
    return this.marks;
  }

  /** A shot has been fired. Last turn's measurements are last turn's. */
  beginTurn() {
    this.marks = [];
  }

  /** Nothing to accumulate mid-flight. See the header: judging happens at rest. */
  observe() {}

  // ── judging ──────────────────────────────────────────────────────────────

  /**
   * The turn is over. Take the fallen off, measure what is left, and — if this
   * was the round's second throw — decide the round and sweep the table.
   *
   * In that order, and it matters: a cap that has fallen has no distance, so the
   * removal has to settle before anything is measured.
   */
  resolveTurn() {
    // Survival's question, asked of survival's sensor: is this cap lying in the
    // pit under the table? Not "has it crossed a line" — there is no line to
    // cross. `TurnSettle` has already established that nothing is moving, so a
    // cap still in the air cannot exist here, and a cap hanging over the rim and
    // holding on is alive because it did not fall.
    const out = this.arena.outOfBounds();
    const eliminated = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i] && this.alive[i]) {
        this.alive[i] = false;
        eliminated.push(i);
      }
    }

    const list = this.standings();
    const roundOver = this.inRound >= 1;

    if (!roundOver) {
      // Half a round. Nothing is decided and nothing is swept; the marks are so
      // the second thrower can see exactly what they have to beat.
      this.marks = this._marks(list, -1);
      return { eliminated, winner: null, note: this._openNote(list, eliminated) };
    }

    const decided = this._judgeRound(list);
    if (decided.winner >= 0) this.wins[decided.winner]++;
    else this.draws++;

    // The closest cap of the match so far. Offered only the caps that survived
    // the round, so a cap that went over the edge can never set it.
    for (const e of list) {
      if (!this.closest || e.distance < this.closest.distance) {
        this.closest = {
          player: e.player,
          distance: e.distance,
          round: this.round,
          cap: e.cap,
        };
      }
    }

    this.marks = this._marks(list, decided.winner);
    this.history.push({
      round: this.round,
      lead: this.leadFor(this.round),
      winner: decided.winner,
      distances: list.map((e) => ({ player: e.player, distance: e.distance })),
    });

    // Everything still standing comes off. A REQUEST — `Match` stows them, this
    // only says which. `eliminated` is deliberately not reused for it: that
    // field means "this cap fell", and the audio layer plays the overshoot cue
    // off it. Sweeping the table is not an overshoot.
    const cleared = [];
    for (const e of list) {
      this.alive[e.cap] = false;
      cleared.push(e.cap);
    }

    const last = this.round + 1 >= this.rounds;
    if (!last) {
      return { eliminated, cleared, winner: null, note: decided.note };
    }

    /**
     * The final round has been judged. Recorded HERE because `advanceTurn` —
     * which is what normally counts a throw — never runs on the turn that ends
     * the match: `Match._endTurn` returns as soon as a winner is declared. Left
     * out, the last frame of the scoreboard would show a round still to play.
     */
    this.thrown[this.player]++;
    this.threw[this.player] = true;
    this.inRound = 0;
    this.round++;

    const judged = this._judgeMatch();
    this.result = judged;
    return {
      eliminated,
      cleared,
      winner: judged.winner,
      note: judged.note,
      // Shown under the winner line on the result screen. Only this mode fills
      // it in; see `RuleSet.resolveTurn`.
      resultNote: judged.detail,
    };
  }

  /**
   * One entry per cap on the table, with the round's winner flagged.
   *
   * `best` is a per-cap boolean rather than an index, because the renderer draws
   * a list and should not have to look anything up to know which line to
   * emphasise. `winner` is −1 mid-round and on a drawn round, and then nothing
   * is emphasised — which is correct: mid-round nothing has been decided, and a
   * draw has no winning cap to point at.
   *
   * `toX`/`toZ` is the point on the line the distance was measured TO, carried
   * on the mark rather than looked up. It is what lets the renderer draw the
   * measurement without knowing what a target line is or which mode it is
   * drawing for — and it is the only version of this that stays honest for a cap
   * that has stopped PAST the line, where the mark runs backwards.
   */
  _marks(list, winner) {
    const m = this.metrics;
    return list.map((e) => ({
      cap: e.cap,
      player: e.player,
      x: e.x,
      z: e.z,
      toX: e.x,
      toZ: m ? m.targetZ : e.z,
      distance: e.distance,
      best: winner >= 0 && e.player === winner,
    }));
  }

  /**
   * Who won this round.
   *
   * Nearest cap takes it. Nothing on the table is a draw — both went over, and
   * inventing a winner from who threw last would be a rule nobody was told. One
   * cap left wins outright, which is the same sentence: it is the nearest one.
   *
   * Two identical distances is also a draw. It cannot happen in floating point
   * off two different throws, and falling through to "player 0 wins" if it ever
   * did would be worse than saying so.
   */
  _judgeRound(list) {
    const r = this.round + 1;
    if (!list.length) {
      return { winner: -1, note: `${r}R 무승부  ·  양쪽 모두 낙하` };
    }

    const near = list[0];
    const rival = list.find((e) => e.player !== near.player);
    if (rival && rival.distance === near.distance) {
      return { winner: -1, note: `${r}R 무승부  ·  거리 동일 ${near.distance.toFixed(2)}` };
    }

    const gap = rival
      ? `${near.distance.toFixed(2)} vs ${rival.distance.toFixed(2)}`
      : `${near.distance.toFixed(2)}  ·  상대 낙하`;
    return { winner: near.player, note: `${r}R P${near.player + 1} 승  ·  ${gap}` };
  }

  /** What the first throw of a round left behind, for the HUD's note line. */
  _openNote(list, eliminated) {
    const r = this.round + 1;
    if (!list.length) {
      return eliminated.length ? `${r}R P${this.player + 1} 낙하` : `${r}R 1투 종료`;
    }
    const e = list[0];
    const fell = eliminated.length ? '  ·  낙하' : '';
    return `${r}R P${e.player + 1} ${e.distance.toFixed(2)}${fell}`;
  }

  /**
   * Who won the match.
   *
   * ── round wins first ────────────────────────────────────────────────────
   * "4라운드 중 더 많은 라운드를 이긴 쪽이 최종 승리." Drawn rounds are worth
   * nothing to either side, so 2–1 with one draw is a win and 2–2 is not.
   *
   * ── then the single closest cap of the whole match ──────────────────────
   * "타이브레이커: 4라운드 전체에서 목표 라인에 가장 가까웠던 단일 뚜껑의 주인이
   * 승리." One cap, across all four rounds, and it has to have been ON the table
   * when its round was judged — `closest` is only ever offered survivors.
   *
   * ── and a draw is a real outcome ────────────────────────────────────────
   * Level on rounds with nothing ever having survived a round is a draw. It
   * takes four rounds of both players going over the edge, which is a thing that
   * can happen and should be reported as what it is.
   *
   * `detail` is the result screen's one explanatory line, and on a tiebreak it
   * has to say so — "타이브레이커 발동 시 결과 화면에 표시해라. 왜 이겼는지 알아야
   * 한다." A player who cannot see why they lost a 2–2 reads it as the game
   * having picked at random.
   */
  _judgeMatch() {
    const score = `${this.wins[0]} : ${this.wins[1]}`;
    const drawn = this.draws ? `  ·  무승부 ${this.draws}R` : '';

    if (this.wins[0] !== this.wins[1]) {
      const winner = this.wins[0] > this.wins[1] ? 0 : 1;
      return {
        winner,
        tiebreak: false,
        note: `🥌 PLAYER ${winner + 1} 승리  ·  라운드 ${score}`,
        detail: `라운드 ${score}${drawn}`,
      };
    }

    if (this.closest) {
      const c = this.closest;
      return {
        winner: c.player,
        tiebreak: true,
        note: `🥌 동점 ${score} — 최근접 뚜껑으로 PLAYER ${c.player + 1} 승리`,
        detail:
          `라운드 ${score} 동점 · 최근접 P${c.player + 1} ` +
          `${c.distance.toFixed(2)} (${c.round + 1}R) — 타이브레이커`,
      };
    }

    return {
      winner: -1,
      tiebreak: false,
      note: `🥌 무승부 ${score} — 남은 뚜껑 없음`,
      detail: `라운드 ${score} 동점 · 판정에 남은 뚜껑이 하나도 없음 — 무승부`,
    };
  }

  advanceTurn() {
    this.thrown[this.player]++;
    this.threw[this.player] = true;
    this.turn++;
    this.inRound++;

    if (this.inRound >= 2) {
      // The round is over and the table has been swept. The next one opens with
      // the OTHER player leading, which is the alternation, and `leadFor` is the
      // only place that is decided.
      this.inRound = 0;
      this.round++;
      this.threw = [false, false];
      this.player = this.leadFor(this.round);
      return;
    }
    // Mid-round: the other player answers.
    this.player = (this.player + 1) % 2;
  }

  /**
   * See `RuleSet.setCurrentPlayer`. The extra-turn card, and only it.
   *
   * Curling does not use cards — `MODES.curling.cards` is false and `playCard`
   * refuses — so nothing can reach this. It is implemented anyway rather than
   * left as the base class's no-op, because "nothing can reach it" is a fact
   * about another file, and a silent no-op here would be a rule that quietly did
   * not apply if that ever changed. The guard is the one this mode needs: a
   * player who has already thrown this round has no cap, and handing them the
   * turn would give `shooterFor` −1 and end the match on a state nobody can act
   * in.
   */
  setCurrentPlayer(player) {
    const p = ((player % 2) + 2) % 2;
    this.player = this.shooterFor(p) >= 0 ? p : (p + 1) % 2;
  }

  // ── serialisation ────────────────────────────────────────────────────────
  //
  // Everything that describes the match, and `dealt` in particular. A replay
  // rewinds the physics world to the turn's snapshot — which was taken AFTER the
  // shooter was dealt — and restores this alongside it. Left out, the replay
  // would re-deal the same cap on top of itself and the check would report a
  // determinism failure that was really a bookkeeping one.
  //
  // `firstLead` is in it too. It is drawn once per match and never changes, but
  // a state that is restored has to be restored whole: leaving it out would mean
  // a replay taken after the panel moved the seed silently played a different
  // match's alternation.

  save() {
    return {
      alive: this.alive.slice(),
      dealt: this.dealt.slice(),
      thrown: this.thrown.slice(),
      wins: this.wins.slice(),
      draws: this.draws,
      round: this.round,
      inRound: this.inRound,
      threw: this.threw.slice(),
      firstLead: this.firstLead,
      player: this.player,
      turn: this.turn,
      closest: this.closest ? { ...this.closest } : null,
      marks: this.marks.map((m) => ({ ...m })),
      history: this.history.map((h) => ({ ...h, distances: h.distances.map((d) => ({ ...d })) })),
      result: this.result ? { ...this.result } : null,
    };
  }

  load(s) {
    this.alive = s.alive.slice();
    this.dealt = s.dealt.slice();
    this.thrown = s.thrown.slice();
    this.wins = (s.wins ?? [0, 0]).slice();
    this.draws = s.draws ?? 0;
    this.round = s.round ?? 0;
    this.inRound = s.inRound ?? 0;
    this.threw = (s.threw ?? [false, false]).slice();
    this.firstLead = s.firstLead ?? 0;
    this.player = s.player ?? 0;
    this.turn = s.turn ?? 0;
    this.closest = s.closest ? { ...s.closest } : null;
    this.marks = (s.marks ?? []).map((m) => ({ ...m }));
    this.history = (s.history ?? []).map((h) => ({
      ...h,
      distances: (h.distances ?? []).map((d) => ({ ...d })),
    }));
    this.result = s.result ? { ...s.result } : null;
  }
}

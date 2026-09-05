import { RuleSet } from './RuleSet.js';

/**
 * 알까기 — basic knockout. The first of the three modes, and the one that has to
 * work before the other two are worth writing.
 *
 * Two players alternate. Knock every one of the other player's caps off the
 * board and you win. Knock your OWN off and it is gone just the same, which is
 * the entire tension of the high-impact shot: a cap that flips and tumbles does
 * not stop where you meant it to.
 *
 * OFF the board, literally — a cap is out when it has fallen, not when it has
 * crossed a line. There is no out line. A cap teetering on the rim is still in
 * the game for exactly as long as it stays up there, which is a rule the player
 * can watch rather than one they have to be told. See `KnockoutBoard`.
 *
 * Eliminated caps are marked dead, not deleted. Removing a rigid body would
 * shuffle Rapier's arena and invalidate handles held by the snapshot machinery,
 * and the caps have already fallen thirty units onto the catch floor where they
 * are asleep and cost nothing. Out of play is a fact about the rules, not about
 * the world.
 */

export class KnockoutRules extends RuleSet {
  constructor(arena) {
    super(arena);
    this.reset();
  }

  get name() {
    return '알까기 (기본)';
  }

  /**
   * What this mode is about, in one line: how many caps each player has left.
   *
   * Moved off the HUD when football arrived. The HUD used to build this string
   * itself, which meant the display layer held one mode's win condition — and
   * football's headline is a score, which no arrangement of cap counts produces.
   */
  status() {
    return `턴 ${this.turn}  ·  P1 ${this.livingCapsOf(0).length}개 / P2 ${
      this.livingCapsOf(1).length
    }개`;
  }

  reset() {
    this.alive = this.arena.capBodies.map(() => true);
    this.player = 0;
    this.turn = 0;
    /** Which of their own caps each player last shot with. Cycles. */
    this._cursor = [0, 0];
    this._selected = [-1, -1];
  }

  get currentPlayer() {
    return this.player;
  }

  shooterFor(player) {
    const mine = this.livingCapsOf(player);
    if (!mine.length) return -1;
    const picked = this._selected[player];
    if (picked >= 0 && this.alive[picked] && this.arena.capOwner[picked] === player) {
      return picked;
    }
    return mine[this._cursor[player] % mine.length];
  }

  canSelect(capIndex, player) {
    return (
      capIndex >= 0 &&
      capIndex < this.arena.capCount &&
      this.alive[capIndex] &&
      this.arena.capOwner[capIndex] === player
    );
  }

  select(capIndex) {
    if (this.canSelect(capIndex, this.player)) this._selected[this.player] = capIndex;
  }

  resolveTurn() {
    // The sensor is asked once, now, with everything at rest — and what it asks
    // is whether the cap is lying in the pit under the board, not whether it has
    // crossed a line. A cap still airborne cannot exist here, because
    // `TurnSettle` has already established that nothing is moving; a cap hanging
    // over the rim and holding on is alive, because it did not fall.
    const out = this.arena.outOfBounds();

    const eliminated = [];
    for (let i = 0; i < out.length; i++) {
      if (out[i] && this.alive[i]) {
        this.alive[i] = false;
        eliminated.push(i);
      }
    }

    const left = [this.livingCapsOf(0).length, this.livingCapsOf(1).length];
    let winner = null;
    if (left[0] === 0 && left[1] === 0) winner = -1; // both cleared: a draw
    else if (left[0] === 0) winner = 1;
    else if (left[1] === 0) winner = 0;

    let note = '';
    if (eliminated.length) {
      const own = eliminated.filter((i) => this.arena.capOwner[i] === this.player).length;
      const theirs = eliminated.length - own;
      const parts = [];
      if (theirs) parts.push(`상대 ${theirs}개 아웃`);
      if (own) parts.push(`자책 ${own}개`);
      note = parts.join(' · ');
    }

    return { eliminated, winner, note };
  }

  advanceTurn() {
    // Cycle this player's own cap for next time, so a turn does not always come
    // back to the same one, then hand over.
    const mine = this.livingCapsOf(this.player);
    if (mine.length) this._cursor[this.player] = (this._cursor[this.player] + 1) % mine.length;
    this._selected[this.player] = -1;
    this.turn++;
    this.player = (this.player + 1) % 2;
    // Skip a player with nothing left. `resolveTurn` would already have declared
    // a winner, so this only matters if the caller carries on anyway.
    if (!this.livingCapsOf(this.player).length) this.player = (this.player + 1) % 2;
  }

  /**
   * See `RuleSet.setCurrentPlayer`. The extra-turn card, and nothing else.
   *
   * The base class's no-op was silently wrong here rather than merely absent:
   * the card was spent, reported as played and did nothing at all, because
   * `advanceTurn` had already handed the turn over and there was no method to
   * take it back.
   *
   * The same "skip a player with nothing left" guard `advanceTurn` carries
   * applies. An extra turn for a player whose last cap has just gone off the
   * board is not a turn — `shooterFor` would return -1 and the match would end
   * on a state nobody could act in.
   */
  setCurrentPlayer(player) {
    const p = ((player % 2) + 2) % 2;
    this.player = this.livingCapsOf(p).length ? p : (p + 1) % 2;
    this._selected[this.player] = -1;
  }

  save() {
    return {
      alive: this.alive.slice(),
      player: this.player,
      turn: this.turn,
      cursor: this._cursor.slice(),
      selected: this._selected.slice(),
    };
  }

  load(s) {
    this.alive = s.alive.slice();
    this.player = s.player;
    this.turn = s.turn;
    this._cursor = s.cursor.slice();
    this._selected = s.selected.slice();
  }
}

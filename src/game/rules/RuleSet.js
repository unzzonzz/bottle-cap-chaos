/**
 * Layer 2: what the physics MEANS.
 *
 * The physics layer knows a cap is at (x, y, z). It does not know that being
 * there makes it out, or whose turn it is, or that the match is over. All of
 * that lives behind this interface, and it lives behind an interface because
 * football and curling are coming: same board, same caps, same impulses, and a
 * completely different set of answers to "what just happened".
 *
 * The contract is deliberately narrow. A rule set may read the arena and may
 * hold its own bookkeeping, but it may NOT step the world, apply impulses, or
 * decide when a turn ends — those belong to `Match` and `TurnSettle`, which are
 * mode-independent. A mode that needs a goal or a house adds sensors at build
 * time and reads them in `resolveTurn`; it does not reach into the sim loop.
 *
 * "At build time" now means something: the sensors, the walls and the opening
 * placement belong to a `Layout`, which is the other half of a mode. A rule set
 * finds what its layout built under `arena.sensors` and asks the narrow phase
 * about it. It never compares coordinates, and it never creates anything.
 *
 * Bookkeeping must be serialisable, because a determinism replay rewinds the
 * physics world to a snapshot and the rules have to rewind with it — a replayed
 * turn that starts with a different cap already eliminated is not a replay.
 */

export class RuleSet {
  /** @param {import('../Arena.js').Arena} arena */
  constructor(arena) {
    this.arena = arena;
    /** Per-cap, index-aligned with `arena.capBodies`. Every mode has this. */
    this.alive = arena.capBodies.map(() => true);
    this.turn = 0;
  }

  /** Shown in the HUD. */
  get name() {
    return 'rules';
  }

  /**
   * The mode's own line in the HUD: score, caps left, whatever it is that this
   * mode is actually about.
   *
   * On the interface rather than in the HUD because the HUD used to assemble it
   * itself out of `livingCapsOf(0)` and `livingCapsOf(1)`, which is a sentence
   * about knockout. Football's headline is a score, and there is no reading of
   * "caps remaining" that produces one — it is 4-4 for the whole match.
   */
  status() {
    return '';
  }

  /**
   * Caps this player still has in play.
   *
   * Lives on the base class rather than in the knockout rules because the HUD
   * reads it every frame, and a mode that did not happen to define it would take
   * the whole render loop down rather than just showing a wrong count.
   */
  livingCapsOf(player) {
    const out = [];
    for (let i = 0; i < this.arena.capCount; i++) {
      if (this.alive[i] && this.arena.capOwner[i] === player) out.push(i);
    }
    return out;
  }

  /**
   * Something worth pausing on, happening right now, mid-turn.
   *
   * Read-only and side-effect free: a mode that implements this must not score,
   * eliminate or record anything from it. Judging is `resolveTurn`'s job and it
   * happens once, at rest. This is only so the turn loop can time a pause
   * against an event rather than against the end of the turn.
   *
   * @returns {{note: string}|null}
   */
  pendingGoal() {
    return null;
  }

  /**
   * One physics step of a live turn has happened.
   *
   * For recording things that cannot be undone by what happens next — football
   * latches a ball crossing the goal line here, because a ball that has crossed
   * has scored even if it rolls back out. Must be cheap, must not score, must
   * not end anything: `resolveTurn` is still the only judge, and it still runs
   * once, at rest.
   */
  observe() {}

  /** A shot has just been fired. Clear whatever `observe` accumulates. */
  beginTurn() {}

  /** Back to the start of a match. */
  reset() {}

  /** @returns {number} cap index that shoots this turn, or -1 if nobody can */
  shooterFor(_player) {
    return -1;
  }

  /** May the player pick this cap right now? */
  canSelect(_capIndex, _player) {
    return false;
  }

  /**
   * Is this cap still waiting to be put on the field?
   *
   * False for every mode that opens with all its pieces out, which is both of
   * the first two. Curling deals one cap a turn, and this is how it asks: a
   * REQUEST, like `resetField` and `respawn` — the rules do not move anything,
   * `Match` does, before the turn's snapshot is taken so the replay rewinds to a
   * world the cap is already standing in.
   */
  needsDeploy(_capIndex) {
    return false;
  }

  /** The request was carried out. The cap is on the field. */
  onDeployed(_capIndex) {}

  /**
   * Which bodies are actually in play, for a layout that has to place around
   * them. Null means "ask about all of them", which is every mode but curling.
   *
   * @returns {boolean[]|null}
   */
  onLane() {
    return null;
  }

  /** Player chose a different cap of their own. */
  select(_capIndex) {}

  /** Whose turn it is now. */
  get currentPlayer() {
    return 0;
  }

  /**
   * The turn has fully settled. Judge it.
   *
   * Called exactly once per turn, and only after `TurnSettle` says the world has
   * stopped — never during flight. A cap that sails over the edge and is knocked
   * back on by a rebound was never out, and judging mid-flight would have called
   * it out and been wrong.
   *
   * `resetField` is how a mode asks for the opening placement back — football
   * needs it after a goal. It is a REQUEST, not an action: the rules do not
   * touch the world, so `Match` rebuilds it and lets it bed down, exactly as it
   * does at the start of a match. Rebuilt, not teleported, for the reason in
   * `Match.start` — a teleported world carries the last one's contact manifolds
   * and is not the same world twice.
   *
   * `resultNote` is one line of explanation for the RESULT screen, and it is
   * separate from `note` — which is the in-game banner and says what the turn
   * did — because the two are read at different moments and by different
   * people. Curling fills it in because a 2–2 decided on centre distance has to
   * say so or the loser cannot tell why they lost; the other two modes leave it
   * out and their result screen is unchanged.
   *
   * @returns {{
   *   eliminated: number[],
   *   winner: number|null,
   *   note: string,
   *   resetField?: boolean,
   *   resultNote?: string,
   * }}
   */
  resolveTurn() {
    return { eliminated: [], winner: null, note: '' };
  }

  /** Advance to the next turn. Called after `resolveTurn`, unless the match ended. */
  advanceTurn() {}

  /**
   * Hand the turn to a specific player, overriding what `advanceTurn` decided.
   *
   * For the extra-turn card, and only for it. Separate from `advanceTurn`
   * because the two say different things: `advanceTurn` is the mode's own idea
   * of whose move it is, and this is something outside the mode overruling it.
   * Folding the card into the rule set would put a card in football's rules.
   */
  setCurrentPlayer(_player) {}

  /**
   * The world has just been rebuilt to the opening placement mid-match.
   *
   * Called after `advanceTurn` and before the next aim, only when the last
   * verdict asked for it. Per-cap bookkeeping that indexes into the arena is
   * still valid — a rebuild recreates the same bodies in the same order — so
   * this is only for state that describes the ROUND rather than the match.
   */
  onFieldReset() {}

  /** @returns {object} plain JSON. Must round-trip through `load`. */
  save() {
    return {};
  }

  /** @param {object} state */
  load(_state) {}
}

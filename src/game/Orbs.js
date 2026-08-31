/**
 * The mystery orbs: where they appear, and who picks them up.
 *
 * ── they are not colliders, and that is the strongest way to honour the brief ─
 * The spec asks for a SENSOR — something a cap passes straight through, that
 * cannot block a goal or deflect a ball. The safest implementation of "does not
 * collide" is not a collider configured not to collide; it is no collider at
 * all. So an orb is a position and a radius, and a pickup is a distance test
 * run once per physics step against the caps.
 *
 * That buys three things a Rapier sensor would have cost effort to get back:
 *
 *   IT CANNOT BLOCK ANYTHING. There is no shape in the world to block with, so
 *     "the orb does not stop the ball" is true by construction rather than by a
 *     flag that someone could later clear.
 *   IT SURVIVES THE SNAPSHOT REWIND. `PhysicsWorld` notes that the collider
 *     shims are JS views over WASM memory that `restoreSnapshot` invalidates.
 *     Orbs are plain numbers and rewind with everything else.
 *   IT IS TRIVIALLY DETERMINISTIC. A distance test on a fixed list in a fixed
 *     order gives the same answer on every machine and every replay.
 *
 * The sensor radius is still a real, separate number — larger than the drawn
 * sphere, so a cap that only grazes it counts.
 *
 * ── the cap that touches it takes the card ──────────────────────────────────
 * THE PICKUP GOES TO THE OWNER OF THE CAP THAT TOUCHED THE ORB, not to whoever's
 * turn it is. Knock an opponent's cap across the board and over an orb and the
 * card is THEIRS.
 *
 * This is the reverse of what it was, and the reversal was asked for. The old
 * rule — the shooter collects whatever any cap runs over — reads fine as a
 * sentence and does not survive being watched: what is on screen is an opponent's
 * cap sitting on the orb while your own hand grows, and there is no reading of
 * that frame in which it is not a bug. A turn being "a thing you did" justifies
 * crediting the shot, not crediting the wrong cap.
 *
 * It also makes hitting an opponent near an orb a real cost, which the old rule
 * inverted into a reward.
 *
 * ── nothing here draws ──────────────────────────────────────────────────────
 * No three.js, no textures, no animation state. The view reads this list and
 * decides what a spawning orb looks like; this decides where one is.
 */

/** How far a spawn search will go before giving the turn up. */
const DEFAULT_RETRIES = 24;

/**
 * The nearest cap within reach of an orb, or -1. Pure; takes a position lookup.
 *
 * ── a free function so the AI's look-ahead asks the SAME question ───────────
 * A pickup is worth a card, and the brief has the AI both chasing orbs and
 * avoiding shoving an opponent onto one — so the search has to predict pickups,
 * and it runs against a restored copy of the world where `Arena.capCom` cannot
 * reach. Handing in `comOf` is the whole of the difference between the two
 * callers; every rule below — the reach, the 3D test, nearest-not-first, ties to
 * the lower index — is shared, which is the point.
 *
 * The alternative was a second distance test in the AI, and the two would drift
 * on precisely the cases that decide whether a card changes hands.
 *
 * @param {(i: number) => {x: number, y: number, z: number}} comOf
 * @param {number} capCount
 * @param {{x: number, z: number}} orb
 * @param {number} r2  squared reach
 */
export function nearestCapWithin(comOf, capCount, orb, r2) {
  let best = -1;
  let bestD2 = Infinity;
  for (let c = 0; c < capCount; c++) {
    const p = comOf(c);
    const dx = p.x - orb.x;
    // The orb is a BOARD position, so height counts against it: a cap thirty
    // units down in the pit is not touching anything. See `_nearestCap`'s note.
    const dy = p.y;
    const dz = p.z - orb.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= r2 && d2 < bestD2) {
      bestD2 = d2;
      best = c;
    }
  }
  return best;
}

export class Orbs {
  /** @param {typeof import('./config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    /** @type {{id: number, x: number, z: number}[]} */
    this.list = [];
    this._nextId = 1;
    /**
     * Pickups that happened this turn, drained by the view each frame so it can
     * play the fly-to-hand animation. Events rather than a flag because several
     * can happen in one step and each needs its own animation.
     *
     * @type {{id: number, x: number, z: number, player: number, cardId: string|null, full: boolean}[]}
     */
    this.events = [];
  }

  reset() {
    this.list = [];
    this._nextId = 1;
    this.events.length = 0;
  }

  get count() {
    return this.list.length;
  }

  remove(id) {
    const at = this.list.findIndex((o) => o.id === id);
    if (at >= 0) this.list.splice(at, 1);
  }

  /**
   * Try to put one orb on the field. Called once at the end of a turn.
   *
   * ── pure luck, on purpose ──────────────────────────────────────────────
   * The position is uniform over the whole spawn area. There is no bias toward
   * the middle, toward either half, or away from where anyone is standing —
   * the brief is explicit that the randomness IS the fun, and a "fairness"
   * nudge would quietly remove it.
   *
   * The one constraint is not overlapping something that already exists, and
   * the margin for that is only as much as it takes: orb radius plus cap radius
   * plus a small allowance. Spreading them further would be a bias by another
   * name.
   *
   * @param {import('../physics/rng.js').Rng} rng
   * @param {import('./Arena.js').Arena} arena
   * @param {object} mode  supplies the area and any forbidden regions
   * @returns {{id: number, x: number, z: number}|null}
   */
  maybeSpawn(rng, arena, mode) {
    const cfg = this.config.orbs;

    // The roll happens FIRST and unconditionally, so the seeded stream advances
    // by exactly one float per turn whether or not the field has room. A roll
    // taken only when there is space would desynchronise a replay the moment
    // the board state differed by one cap.
    const roll = rng.float();
    if (this.list.length >= Math.max(0, Math.round(cfg.maxOnField))) return null;
    if (roll >= Math.max(0, Math.min(1, cfg.spawnChance))) return null;

    const area = mode.orbArea?.(arena, this.config);
    if (!area) return null;

    const retries = Math.max(1, Math.round(cfg.placementRetries ?? DEFAULT_RETRIES));
    const need = this._clearance(arena);

    for (let attempt = 0; attempt < retries; attempt++) {
      // Two draws per attempt, always, so the number of floats consumed is a
      // function of the attempt count alone.
      const x = (rng.float() * 2 - 1) * area.halfX;
      const z = (rng.float() * 2 - 1) * area.halfZ;
      if (mode.orbForbids?.(x, z, arena, this.config)) continue;
      if (!this._clearOf(x, z, arena, need)) continue;

      const orb = { id: this._nextId++, x, z };
      this.list.push(orb);
      return orb;
    }
    // No room this turn. Nothing is forced and nothing is queued — the next
    // turn rolls again from scratch.
    return null;
  }

  /** Orb radius + cap radius + margin. What "not overlapping" means. */
  _clearance(arena) {
    const cfg = this.config.orbs;
    return cfg.sensorRadius + arena.desc.radius + Math.max(0, cfg.spawnMargin);
  }

  _clearOf(x, z, arena, need) {
    if (this._crowded(x, z, arena, need * need)) return false;
    // Against other orbs too, so two never sit on top of each other.
    for (const o of this.list) {
      const dx = o.x - x;
      const dz = o.z - z;
      const r = cfgTwoOrbs(this.config);
      if (dx * dx + dz * dz < r * r) return false;
    }
    return true;
  }

  /** Is a cap or the ball inside `n2` of this point? Squared distances. */
  _crowded(x, z, arena, n2) {
    for (let i = 0; i < arena.capBodies.length; i++) {
      const c = arena.capCom(i);
      const dx = c.x - x;
      const dz = c.z - z;
      if (dx * dx + dz * dz < n2) return true;
    }
    if (arena.hasBall) {
      const b = arena.ballCom();
      const dx = b.x - x;
      const dz = b.z - z;
      if (dx * dx + dz * dz < n2) return true;
    }
    return false;
  }

  /**
   * Drop any orb the BOARD has closed in on. Called after a kickoff rebuild.
   *
   * ── the clearance was only enforced where orbs move, and they are not the
   *    only thing that moves ──────────────────────────────────────────────────
   * `maybeSpawn` places an orb no nearer a cap than `_clearance`, which is the
   * pickup reach plus a margin — so a fresh orb can never be standing on someone.
   * That held right up until the whistle: a goal runs `Match._resetField`, which
   * rebuilds the world and teleports every cap back onto its formation mark,
   * while the orbs stay exactly where they were. The orb had cleared the caps
   * where they SETTLED; nothing re-checked it against where they were about to be
   * PUT.
   *
   * The result is a football-only bug — knockout never resets a field — and it is
   * the one that was reported: an orb sitting on a kickoff mark is inside pickup
   * range on the first step of the next turn, so the round opens with a free card.
   *
   * Same predicate as the spawn test, deliberately. "An orb is never closer to a
   * cap than this" is one rule, and it is now enforced at both of the two moments
   * the board can break it rather than only at the one where orbs appear.
   *
   * Orbs are not tested against each other here: they have not moved relative to
   * one another, so a pair that was legal before the whistle still is.
   *
   * @returns {number} how many were dropped
   */
  dropBlocked(arena) {
    const n2 = this._clearance(arena) ** 2;
    const before = this.list.length;
    this.list = this.list.filter((o) => !this._crowded(o.x, o.z, arena, n2));
    return before - this.list.length;
  }

  /**
   * Run the pickup test for one physics step.
   *
   * ── it fires the instant a cap arrives, not at the end of the turn ────────
   * Called from inside the step loop precisely so the card is in the hand while
   * the caps are still moving. Waiting for the turn to settle would make the
   * pickup feel like a score being tallied rather than like something that
   * happened on the board.
   *
   * @param {import('./Arena.js').Arena} arena
   * @param {import('./cards/CardHands.js').CardHands} hands
   * @param {import('../physics/rng.js').Rng} rng
   */
  step(arena, hands, rng) {
    if (!this.list.length) return;
    const reach = this.config.orbs.sensorRadius + arena.desc.radius;
    const r2 = reach * reach;

    // Walked backwards so a pickup can splice without disturbing the indices
    // still to be visited, and in a fixed order so two orbs touched on the same
    // step are always resolved the same way round.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const orb = this.list[i];
      const toucher = this._nearestCap(arena, orb, r2);
      if (toucher < 0) continue;

      /**
       * THE CAP THAT TOUCHED IT DECIDES WHOSE CARD IT IS.
       *
       * This used to be the shooter — whoever's turn it was got the card however
       * it was reached, so knocking an opponent's cap across the board and over
       * an orb collected it for YOU. That was written down as deliberate and it
       * is not what the game reads like: the thing that visibly touched the orb
       * is the opponent's cap, and watching your own hand grow from it is the
       * kind of thing a player reports as a bug because there is no reading of
       * the screen in which it is not one.
       *
       * So it is the owner of the cap, and the shooter is no longer consulted at
       * all — which is why this method no longer takes one. Everything
       * downstream already keys off the event's `player`, so the card also flies
       * to the correct fan without anything else changing; see `handAnchor` in
       * `main.js`.
       */
      const owner = arena.capOwner[toucher];

      /**
       * A full hand does NOT take the card and the orb does NOT disappear. It
       * stays exactly where it is and the event says so, which is what the view
       * turns into the refusal flash. Silently swallowing it would read as a
       * bug, and silently deleting it would be worse.
       *
       * The latch remembers WHO was refused rather than merely that someone was.
       * With the shooter taking everything there was only ever one candidate per
       * turn; now both players' caps can reach the same orb in the same turn, and
       * a shared boolean would let the first refusal silence the second player's
       * — so one of them would be told nothing at all.
       */
      if (hands.isFull(owner)) {
        if (orb.refused !== owner) {
          orb.refused = owner;
          this.events.push({ ...orb, player: owner, cardId: null, full: true });
        }
        continue;
      }

      const cardId = hands.draw(rng);
      if (!cardId) continue;
      // The instance the hand just gained. The view needs the key so it can
      // hold that card OUT of the fan until its flight lands — see `CardFlight`.
      const card = hands.add(owner, cardId);
      this.list.splice(i, 1);
      this.events.push({
        id: orb.id,
        x: orb.x,
        z: orb.z,
        player: owner,
        cardId,
        key: card?.key ?? null,
        full: false,
      });
    }
  }

  /**
   * The nearest cap within reach of an orb, or -1.
   *
   * ── it is a 3D test, and the height is not decoration ────────────────────
   * This compared x and z alone and ignored y entirely, which is fine for two
   * caps on a board and wrong the moment one is not on it. A knockout cap that
   * goes out falls into the pit under the board — measured at 29.7 units down —
   * and its x/z do not change on the way, so it went on collecting every orb it
   * happened to be beneath. Filtering on `rules.alive` would not have caught it
   * either: elimination is marked at turn END, so a cap is still "alive" for the
   * whole of the fall that eliminates it, which is exactly when it is falling
   * past the orbs.
   *
   * The orb is a board position, so it is tested at board level. A cap airborne
   * over one still collects it — it passed over the orb, which is the reading a
   * player would expect — and a cap thirty units below the turf does not, which
   * is the reading no player would argue with.
   *
   * ── nearest, not first ───────────────────────────────────────────────────
   * It used to break on the first cap in index order, which was free when the
   * answer only had to be "did anybody". Now the answer decides who gets a card,
   * so two caps of DIFFERENT owners in range of one orb is a real question, and
   * the honest answer is the one that is actually touching it. Ties go to the
   * lower index, so the result is stable across a replay.
   */
  _nearestCap(arena, orb, r2) {
    // The body of this moved out to `nearestCapWithin` unchanged, so the AI's
    // look-ahead can ask it of a restored world. Everything the two long notes
    // above argue for — the 3D test, nearest rather than first — lives there now
    // and is therefore shared rather than reproduced.
    return nearestCapWithin((i) => arena.capCom(i), arena.capBodies.length, orb, r2);
  }

  /**
   * Clear the refusal latch so a later pass over the same orb flashes again.
   *
   * -1 rather than false: the latch holds WHICH player was turned away, so that
   * both of them can be told in the same turn. See `step`.
   */
  endTurn() {
    for (const o of this.list) o.refused = -1;
  }

  /** Take the pickup events. The view calls this once a frame. */
  drainEvents() {
    if (!this.events.length) return null;
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  save() {
    return { list: this.list.map((o) => ({ ...o })), nextId: this._nextId };
  }

  load(s) {
    if (!s) return;
    this.list = (s.list ?? []).map((o) => ({ ...o }));
    this._nextId = s.nextId ?? 1;
  }
}

/** Two orbs need to clear each other by their own diameters, not a cap's. */
function cfgTwoOrbs(config) {
  return config.orbs.sensorRadius * 2 + Math.max(0, config.orbs.spawnMargin);
}

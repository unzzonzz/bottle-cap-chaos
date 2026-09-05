/**
 * A frame of physics, turned into at most a few collisions worth hearing.
 *
 * ── the problem, exactly ────────────────────────────────────────────────────
 * `PhysicsWorld.step()` is called with no `EventQueue`, deliberately and
 * permanently: the design note there says the real simulation and the trajectory
 * preview must run an identical call sequence so they cannot diverge over a
 * queue one of them is holding. So there is no "two caps touched" event anywhere
 * in the project, and the audio layer is not allowed to add one.
 *
 * ── what IS available, and what each half is good for ───────────────────────
 * Two read-only routes, and this class uses both because neither is sufficient:
 *
 *   VELOCITY   every body's `linvel()`. Velocity is INTEGRATED STATE, so a
 *              change to it cannot be missed no matter how many physics steps
 *              ran between two observations. This is what DETECTS a collision
 *              and how hard it was.
 *   NARROW     `narrowPhase.contactPairsWith` / `contactPair`. This is what says
 *              WHAT was hit — another cap, the ball, a goal post, the netting,
 *              a fence, the board.
 *
 * Neither is enough on its own. The narrow phase reports the manifold state
 * after the LAST step of the frame only, and up to twelve steps run inside one
 * render frame — so a hit that began and finished in an earlier step shows a
 * contact impulse of zero and would be silently dropped. And a velocity change
 * with no partner attached to it cannot tell a cap-on-cap crack from a
 * cap-on-fence thud, which are supposed to be different sounds.
 *
 * ── the noise floor is real and it is not zero ──────────────────────────────
 * A cap sitting still on the board is in permanent contact, and the solver is
 * applying about 18 g·cm/s every step to hold it up. Any test of the form
 * "impulse > 0" fires continuously for every resting cap, which is why the
 * threshold here is on a CHANGE and why it grows with the number of steps the
 * frame ran — a body in free fall legitimately gains 8.2 cm/s per step and none
 * of that is a collision.
 *
 * ── and the chain is thinned HERE ───────────────────────────────────────────
 * "연쇄 충돌은 가장 강한 충돌 몇 개만 소리를 낸다. 전부 내면 소음이다." This is
 * the only place in the system where a frame's impacts are all in hand at once
 * and therefore the only place their strengths are comparable. `VoicePool` is
 * the backstop; the actual selection is the sort at the end of `collect`.
 *
 * ── nothing here writes ─────────────────────────────────────────────────────
 * Every call is a query. No `step`, no `setLinvel`, no integration parameter, no
 * `nextSeed`. Handles are stored, never shims — `PhysicsWorld.restore` runs on
 * EVERY turn boundary and frees the world out from under any object held across
 * it, and `Coarena` discards the generation bits so a stale handle resolves to
 * somebody else's cap rather than failing.
 */

import { CATEGORY } from './categories.js';

/** Which partner wins when a body is touching several things at once. */
const ROLE_RANK = { cap: 6, ball: 5, frame: 4, net: 3, wall: 2, ground: 1 };

/**
 * The highest scale rung a chain may reach. See `_chain`.
 *
 * Seven rungs, which takes `cap_cap` from 660 Hz to 1744 — an octave and a
 * sixth. Measured rather than guessed: rung eight is 2096 Hz, which is inside
 * the band the ear is most sensitive in, and a chain that arrives there twice
 * in a turn is shrill rather than exciting. Eight caps in a chain is the worst
 * case the whole overload apparatus was built around, so a ceiling of 7 means
 * even that one runs out of ladder before it runs out of patience.
 *
 * It is a module constant and not a `CONFIG` knob on purpose: this is a musical
 * decision, and `config.audio` is a MIX. Nothing on the panel should be able to
 * put a collision chain out of tune with the cards.
 */
const CHAIN_TOP = 7;

export class ContactAudio {
  /** @param {typeof import('../game/config.js').CONFIG.audio} config live block */
  constructor(config) {
    this.config = config;

    /** collider handle -> {role, index}. Rebuilt whenever the world is. */
    this._roles = new Map();
    /** Body handle per slot, and the cap index it belongs to. */
    this._bodies = [];
    /** Last frame's velocities, three floats a slot. */
    this._prev = new Float32Array(0);
    /** Whether `_prev` holds anything worth comparing against. */
    this._primed = false;
    /** `physics.steps` last time we looked, to know how far the world moved. */
    this._steps = -1;
    /** Identity of the array the map was built from. Cheapest rebuild test. */
    this._capBodiesRef = null;

    /** Scratch, reused so a frame allocates nothing. */
    this._candidates = [];
    this._partners = [];
    this._seen = new Set();

    /**
     * Which collision of this shot this is. Handed out as a scale degree.
     *
     * ── the chain walks UP, and that is free information ───────────────────
     * Every impact of one shot lands a rung higher than the last, so a chain
     * arrives as a rising phrase instead of as a pile. It reads as a rally, and
     * it tells the player something they otherwise have to count: a shot that
     * went five caps deep SOUNDS bigger than one that hit and stopped, before
     * they have looked at anything.
     *
     * ── the rung is ORDER, never strength ──────────────────────────────────
     * Assigning it from `dv` was the obvious alternative and it is wrong. Pitch
     * would then jump around inside a chain — hard, soft, hard — and neither
     * direction would mean anything, because the strength is already carried by
     * the level and by the brightness (`velGain`, `velBright`). Order is the
     * one thing nothing else in the sound is saying.
     *
     * ── it is NOT cleared by `reset()` ─────────────────────────────────────
     * `reset()` fires on a world rebuild and on every entry to and exit from a
     * kinematic state — a swap card, a ball respawn — which happen in the
     * middle of a turn. A chain cleared there would restart mid-rally. The turn
     * boundary is a different event and only `MatchAudio` can see it, so it
     * calls `resetChain()` on the shot edge.
     */
    this._chain = 0;
  }

  /**
   * A new shot. The next collision starts the scale again.
   *
   * Called from `MatchAudio` on the `lastTurn` identity edge and on its own
   * `reset`. Deliberately separate from `reset()` — see the note on `_chain`.
   */
  resetChain() {
    this._chain = 0;
  }

  /**
   * Forget everything.
   *
   * Called when the world is rebuilt and whenever the match leaves a state in
   * which bodies move under their own power. Both matter: a swap card and a ball
   * respawn drive bodies KINEMATICALLY — the pose is commanded, so the velocity
   * is whatever the engine computed for it and comparing it against the last
   * dynamic frame produces an enormous phantom impact.
   */
  reset() {
    this._primed = false;
    this._steps = -1;
  }

  /**
   * @param {import('../game/Match.js').Match} match
   * @param {{id: string, intensity: number}[]} out  appended to
   * @returns {{id: string, intensity: number}[]} the same array
   */
  collect(match, out) {
    const arena = match.arena;
    const physics = match.physics;
    const world = physics?.world;
    if (!arena || !world?.narrowPhase) return out;

    if (arena.capBodies !== this._capBodiesRef || physics.steps < this._steps) {
      this._rebuild(arena);
    }

    // How much simulated time this frame covered. Zero means the world did not
    // move — aiming, the victory screen, a card effect that steps nothing — and
    // there is nothing to compare.
    const nSteps = this._steps < 0 ? 0 : physics.steps - this._steps;
    this._steps = physics.steps;

    if (nSteps <= 0) {
      this._sample(physics);
      this._primed = true;
      return out;
    }

    if (!this._primed) {
      this._sample(physics);
      this._primed = true;
      return out;
    }

    const cfg = this.config.impact ?? {};
    const floor = Math.max(1, cfg.minDeltaV ?? 26) + Math.max(0, cfg.gravityBias ?? 9) * nSteps;
    const full = Math.max(floor + 1, cfg.fullDeltaV ?? 320);

    const candidates = this._candidates;
    candidates.length = 0;

    for (let slot = 0; slot < this._bodies.length; slot++) {
      const rec = this._bodies[slot];
      const body = physics.body(rec.handle);
      if (!body) continue;
      const v = body.linvel();
      const o = slot * 3;
      const dx = v.x - this._prev[o];
      const dy = v.y - this._prev[o + 1];
      const dz = v.z - this._prev[o + 2];
      this._prev[o] = v.x;
      this._prev[o + 1] = v.y;
      this._prev[o + 2] = v.z;

      const dv = Math.hypot(dx, dy, dz);
      if (dv < floor) continue;
      candidates.push({ slot, rec, dv });
    }

    if (!candidates.length) return out;

    candidates.sort((a, b) => b.dv - a.dv);
    // Classify a few more than will ever be played: the fallback pairing needs
    // to see the OTHER half of a cap-on-cap hit, and that half is often the
    // quieter one.
    const perFrame = Math.max(1, Math.round(cfg.perFrame ?? 3));
    const examine = Math.min(candidates.length, perFrame * 2 + 2);

    const seen = this._seen;
    seen.clear();
    const events = [];

    for (let i = 0; i < examine; i++) {
      const c = candidates[i];
      const partner = this._classify(physics, world, arena, c, candidates, examine);
      if (!partner) continue;

      // One event per PAIR, not per body: a cap-on-cap hit changes both
      // velocities and would otherwise crack twice, a few milliseconds apart,
      // which is audibly a flam rather than a hit.
      const key =
        partner.role === 'cap' || partner.role === 'ball'
          ? pairKey(c.rec.key, partner.key)
          : `${c.rec.key}|${partner.role}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const id = this._soundFor(c.rec.role, partner.role);
      if (!id) continue;

      let intensity = (c.dv - floor) / (full - floor);
      intensity = intensity < 0.08 ? 0.08 : intensity > 1 ? 1 : intensity;

      const gain = partner.role === 'ground' ? Math.max(0, cfg.groundGain ?? 0.5) : 1;
      /**
       * ── BOTH caps of the pair, and it has to be both ────────────────────
       * One event is emitted per pair rather than per body, and the survivor is
       * whichever half jumped hardest. That is right for the sound and wrong for
       * anything that asks "was THIS cap hit", because the two halves of a
       * cap-on-cap collision are not symmetric: 철벽 makes the braced cap the
       * HEAVIER one, so it takes the smaller velocity change and is reliably the
       * half that loses the sort. A reader given only `capA` would light up the
       * striker and never the cap that actually held.
       *
       * -1 for a partner that is not a cap — a wall, the ball, the ground.
       */
      events.push({
        id,
        intensity,
        gain,
        /** Filled in below, once the frame's cut is known. See the note there. */
        degree: 0,
        dv: c.dv,
        capA: c.rec.role === 'cap' ? c.rec.index : -1,
        capB: partner.role === 'cap' ? partner.index ?? -1 : -1,
      });
    }

    if (!events.length) return out;
    events.sort((a, b) => b.dv - a.dv);
    /**
     * The rung is assigned HERE, after the frame's impacts have been sorted and
     * cut, rather than where the event was built.
     *
     * Two reasons and they pull the same way. A frame classifies about twice as
     * many candidates as it will ever play — the fallback pairing needs to see
     * the quiet half of a cap-on-cap hit — so counting at construction would
     * advance the scale for collisions nobody hears, and a chain of three would
     * arrive on rungs 0, 2, 5. And within one frame the loudest impact should
     * be the lowest rung, because that is the order they are pushed in and
     * therefore the order they are heard in.
     */
    for (let i = 0; i < events.length && i < perFrame; i++) {
      events[i].degree = this._chain;
      // Held at the ceiling rather than wrapped: a rally that runs long should
      // stop climbing, not fall back to the bottom and start again — and left
      // uncapped it eventually arrives somewhere nobody wants to be.
      if (this._chain < CHAIN_TOP) this._chain++;
      out.push(events[i]);
    }
    return out;
  }

  /**
   * What did this body hit?
   *
   * The narrow phase first, because it is the honest answer. `contactPairsWith`
   * reports every pair whose broad-phase boxes merely OVERLAP — the doc says
   * "potentially in contact" — so each candidate partner is confirmed with
   * `contactPair` and a non-zero contact count before it is believed.
   *
   * The handles are collected inside the callback and the manifolds queried
   * outside it. `NarrowPhase` reuses ONE `TempContactManifold` whose raw pointer
   * is freed the moment the closure returns, so a `contactPair` call nested
   * inside another one reads a dangling pointer — collecting first makes that
   * impossible rather than merely avoided.
   */
  _classify(physics, world, arena, candidate, candidates, examine) {
    const partners = this._partners;
    partners.length = 0;
    const np = world.narrowPhase;

    for (const handle of candidate.rec.colliders) {
      np.contactPairsWith(handle, (other) => {
        partners.push([handle, other]);
      });
    }

    let best = null;
    let bestRank = 0;
    for (const [mine, other] of partners) {
      const role = this._roles.get(other);
      if (!role) continue; // A collider in no list — curling's lid, its catch floor.
      const rank = ROLE_RANK[role.role] ?? 0;
      if (rank <= bestRank) continue;

      let touching = false;
      np.contactPair(mine, other, (manifold) => {
        // Copied out as a plain number inside the closure. The manifold is freed
        // the instant this returns.
        if (manifold.numContacts() > 0) touching = true;
      });
      if (!touching) continue;

      bestRank = rank;
      best = { role: role.role, key: role.key ?? `s${other}`, index: role.index ?? -1 };
    }
    if (best) return best;

    /**
     * The narrow phase has already let go.
     *
     * A hard cap-on-cap hit separates the pair within a step or two, and the
     * frame may well be observed after that — the contact is gone and the
     * velocity change is all that is left. Two caps that both jumped this frame
     * and are within a couple of diameters of each other hit each other; that is
     * not a guess so much as the only thing it could have been.
     */
    const reach = arena.desc.radius * Math.max(1, this.config.impact?.pairRadius ?? 2.6);
    const a = this._position(arena, candidate.rec);
    if (a) {
      for (let i = 0; i < examine; i++) {
        const other = candidates[i];
        if (other === candidate) continue;
        const b = this._position(arena, other.rec);
        if (!b) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= reach) {
          return { role: other.rec.role, key: other.rec.key, index: other.rec.index };
        }
      }
    }

    // Something immovable, and we cannot say what. The dull sound is the safe
    // answer: a wall thud heard where a cap crack belonged is a small error, and
    // a crack heard off a wall is the one that sounds broken.
    return { role: 'wall', key: 'wall', index: -1 };
  }

  /** From the latched transform buffer — plain floats, no WASM crossing. */
  _position(arena, rec) {
    const t = arena.currTransforms;
    const slot = rec.slot;
    if (!t || slot < 0 || (slot + 1) * 7 > t.length) return null;
    const o = slot * 7;
    return { x: t[o], y: t[o + 1], z: t[o + 2] };
  }

  /** The pairing rules, in one table. */
  _soundFor(self, other) {
    if (self === 'ball' || other === 'ball') {
      if (other === 'frame' || self === 'frame') return 'goal_post';
      if (other === 'net' || self === 'net') return 'ball_net';
      if (other === 'cap' || self === 'cap') return 'ball_cap';
      return 'ball_wall';
    }
    if (other === 'cap') return 'cap_cap';
    // A cap against the woodwork or the netting is not a goal event; it is just
    // something hard and something soft, and it belongs with the walls.
    return 'cap_wall';
  }

  _sample(physics) {
    for (let slot = 0; slot < this._bodies.length; slot++) {
      const body = physics.body(this._bodies[slot].handle);
      const o = slot * 3;
      if (!body) {
        this._prev[o] = this._prev[o + 1] = this._prev[o + 2] = 0;
        continue;
      }
      const v = body.linvel();
      this._prev[o] = v.x;
      this._prev[o + 1] = v.y;
      this._prev[o + 2] = v.z;
    }
  }

  /**
   * Rebuild the handle maps.
   *
   * Unconditionally rather than by diffing, because there is no event for a
   * rebuild and getting it wrong is silent: `Coarena` resolves a handle by its
   * lower 32 bits and discards the generation, so a stale handle names a
   * DIFFERENT collider instead of failing. Every layout field is feature-
   * detected — only `layout.sensors` is guaranteed by the base class, and the
   * three layouts genuinely do not agree about the rest.
   */
  _rebuild(arena) {
    this._roles.clear();
    this._bodies.length = 0;
    this._capBodiesRef = arena.capBodies;
    this._primed = false;
    this._steps = -1;

    for (let i = 0; i < arena.capBodies.length; i++) {
      const colliders = arena.capColliders[i] ?? [];
      const key = `c${i}`;
      for (const h of colliders) this._roles.set(h, { role: 'cap', index: i, key });
      this._bodies.push({
        handle: arena.capBodies[i],
        colliders,
        role: 'cap',
        index: i,
        slot: i,
        key,
      });
    }

    if (arena.hasBall) {
      this._roles.set(arena.ballCollider, { role: 'ball', index: 0, key: 'ball' });
      this._bodies.push({
        handle: arena.ballBody,
        colliders: [arena.ballCollider],
        role: 'ball',
        index: 0,
        slot: arena.ballSlot,
        key: 'ball',
      });
    }

    const layout = arena.layout ?? {};
    const mark = (handles, role) => {
      if (!handles) return;
      const list = Array.isArray(handles) ? handles : [handles];
      for (const h of list) {
        if (typeof h === 'number' && h >= 0) this._roles.set(h, { role, key: role });
      }
    };
    // The frame before the walls: `wallColliders` and `frameColliders` are
    // separate arrays in football precisely so hitting the woodwork can be a
    // different event from hitting the fence.
    mark(layout.frameColliders, 'frame');
    mark(layout.netColliders, 'net');
    mark(layout.wallColliders, 'wall');
    mark(layout.groundCollider, 'ground');
    mark(layout.boardCollider, 'ground');
    mark(layout.floorCollider, 'ground');
    mark(layout.ceilingCollider, 'wall');

    const want = this._bodies.length * 3;
    if (this._prev.length !== want) this._prev = new Float32Array(want);
    else this._prev.fill(0);
  }
}

/** Order-independent, so A-hits-B and B-hits-A are one event. */
function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Everything this observer can emit. For the panel's coverage readout. */
export const CONTACT_SOUND_IDS = [
  'cap_cap',
  'cap_wall',
  'ball_cap',
  'ball_wall',
  'ball_net',
  'goal_post',
];

/** The bus every one of them lands on. Asserted by the panel, not used here. */
export const CONTACT_CATEGORY = CATEGORY.IMPACT;

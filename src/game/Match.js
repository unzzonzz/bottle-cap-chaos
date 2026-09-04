import { FIXED_DT } from '../physics/PhysicsWorld.js';
import { freshSeed, nextSeed, Rng, seedRun } from '../physics/rng.js';
import { Arena, BODY_KIND, secondsToSteps } from './Arena.js';
import { TurnSettle } from './TurnSettle.js';
import { BallRespawn } from './BallRespawn.js';
import { CardEffects } from './cards/CardEffects.js';
import { CardHands } from './cards/CardHands.js';
import { Orbs } from './Orbs.js';
import { CapSwap } from './cards/CapSwap.js';
import { applyShot } from './shot.js';

/**
 * The turn loop. Owns the accumulator, drives the settle detector, and hands the
 * verdict to whichever rule set is plugged in.
 *
 * ── the accumulator ──────────────────────────────────────────────────────────
 * Frame time goes in, whole 1/120 steps come out, the remainder is carried. The
 * renderer gets `alpha` and interpolates across it, so a 60 Hz display shows
 * smooth motion out of a 120 Hz simulation without the simulation ever knowing
 * what a display is.
 *
 * Slow motion scales the time going IN, so fewer steps run per frame. It never
 * touches the step length. That distinction is the whole game: the sequence of
 * steps a shot goes through at 0.1x is the identical sequence it goes through at
 * 1x, just spread over ten times as many frames, so a shot inspected in slow
 * motion is the same shot.
 *
 * The per-frame step cap is there so a stalled tab cannot come back and try to
 * simulate four seconds in one frame. It makes the sim fall behind wall-clock
 * time under load — which is correct, and is the only option that keeps the step
 * sequence intact. Dropping to a longer dt to catch up would not.
 *
 * ── aiming freezes the world ─────────────────────────────────────────────────
 * No stepping at all in AIM. This is a turn-based game, so nothing should be
 * moving anyway, and it buys the thing the trajectory preview needs: a world
 * that is provably identical to the one the shot will be fired into, so a single
 * snapshot stays valid for the whole aim.
 */

export const MATCH_STATE = {
  AIM: 'aim',
  LIVE: 'live',
  /**
   * The ball is rolling back into play after stopping outside the lines.
   *
   * A state of its own rather than a flag, because the one thing it has to do
   * besides look right is refuse input: the next turn does not open until the
   * ball has arrived. `shooter` and `fire` are already gated on AIM, so being a
   * state gets that for free.
   */
  RESPAWN: 'respawn',
  /**
   * A goal has gone in and the screen is sitting on it before the reset.
   *
   * A state rather than a flag for the same reason RESPAWN is: `fire` and
   * `shooter` are gated on AIM, so the shot is blocked by being in a different
   * state and nothing has to remember to check a boolean. The CAMERA is not
   * gated on match state at all, so zoom, pan and rotation keep working
   * throughout — which is what was asked for.
   */
  GOAL_HOLD: 'goalHold',
  /**
   * A card has been played and its effect is on screen.
   *
   * A state for the same reason RESPAWN and GOAL_HOLD are: `fire` and `shooter`
   * are gated on AIM, so being somewhere else blocks the shot without anything
   * having to remember a boolean. It is also what "연출 중 입력 차단" is — the
   * router asks the match, not the effect.
   *
   * Two flavours, and the difference is whether the WORLD changes. Swap moves
   * bodies, so it steps the simulation and re-snapshots the turn at the far end.
   * The other three change nothing a body can see, so they do not step at all
   * and the turn's existing snapshot stays valid — which is the only version of
   * this that cannot alter what the shot does.
   */
  CARD_FX: 'cardFx',
  OVER: 'over',
};

const MAX_STEPS_PER_FRAME = 20;

export class Match {
  /**
   * @param {import('./modes.js').MODES.knockout} mode  a layout plus a rule set
   * @param {number} [seed]
   *   the opening match's root seed. Omit for a fresh one; pass to reproduce a
   *   match exactly, which is what `?seed=` in the address bar does.
   */
  constructor({ physics, capDims, config, mode, seed }) {
    this.physics = physics;
    this.capDims = capDims;
    this.config = config;
    this.mode = mode;

    // `capDims` goes to the layout as well as to the arena, because a layout may
    // be SIZED in caps rather than in world units — the curling table's width is
    // a multiple of the cap's diameter, which is the one control that decides
    // how big a cap looks on it. See `curlingTableMetrics`. Ignored by the two
    // layouts whose dimensions are absolute.
    this.arena = new Arena({
      physics,
      capDims,
      config,
      layout: mode.createLayout(config, capDims),
    });
    this.rules = mode.createRules(this.arena);
    // No config: the settle detector reads its numbers off the arena now, so the
    // mode's own turn-end clock reaches it. See `TurnSettle`.
    this.settle = new TurnSettle();
    this.respawn = new BallRespawn(config);
    this.cards = new CardEffects(config);
    /**
     * WHAT each player is holding, as opposed to what is currently in effect.
     *
     * Two objects because they are two questions with different lifetimes: an
     * effect is armed and spent inside a turn, a hand is carried across rounds
     * and whole goals. See `CardHands` for why it stopped being the renderer's.
     */
    this.hands = new CardHands(config);
    /** The mystery orbs on the field. Positions only — see `Orbs`. */
    this.orbs = new Orbs(config);
    this.swap = new CapSwap(config);

    this.state = MATCH_STATE.AIM;
    this.alpha = 0;
    this._acc = 0;

    /**
     * How many caps have been turned over. A counter, not a state.
     *
     * The flipped-ness of a cap lives in its POSE and is read back with
     * `Arena.capFlipped` — see `Arena.flipCap` for why it is nowhere else. This
     * only ticks, so the renderer can notice that one just happened and start an
     * animation without the turn loop having to know an animation exists.
     *
     * ── it counts the SESSION, and `start` deliberately does not reset it ────
     * Every other counter here goes back to zero for a new match, and this one
     * must not, because of how it is read: `main.js` remembers the last value it
     * saw and treats any difference as "a cap just flipped". A counter that
     * reset would hand that watcher a difference at the exact moment there is no
     * cap to animate — the first frame of a new match — and the fix would be to
     * remember to re-sync the watcher in every path that starts one. Monotonic,
     * there is no such path and no such thing to remember.
     */
    this.flips = 0;

    /** Everything needed to run the last turn again, exactly. */
    this.lastTurn = null;
    /** Result of the most recent replay check. */
    this.verify = null;
    this._expect = null;

    this.lastVerdict = null;
    this.lastResolved = null;
    this.startHash = '';
    this.endHash = '';

    this.start(seed);
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /**
   * A new match: fresh world, caps back on their marks, rules from zero.
   *
   * The world is rebuilt rather than the caps teleported. Teleporting looks
   * cheaper and is not equivalent — it leaves the previous match's contact
   * manifolds and sleep states behind, so "the same opening position" would in
   * fact be a slightly different world every time and two runs of the same
   * opening shot would not agree. A rebuilt world is the same world.
   *
   * Also the only correct response to a cap count or board size change, so
   * structural edits and the new-match button are deliberately one code path.
   *
   * ── the seed is drawn HERE, and it is what makes a match a match ────────────
   * Everything the match will ever draw at random — every shot seed, every card
   * seed, and through those every orb spawn and every card an orb yields —
   * descends from the counter this points at. So this one number IS the match's
   * luck, and choosing it is the first thing a new match does.
   *
   * Left unset it comes from `freshSeed`, which is the only unpredictable call
   * in the project and is deliberately made before the simulation exists. Passed
   * one, the match replays exactly: same orbs, same turns, same cards. That is
   * what `?seed=` and the panel's seed field are for, and it is the same
   * property the turn-level replay check has always relied on, one level up.
   *
   * @param {number} [seed]  32-bit. Omit for a match nobody has pinned.
   */
  start(seed) {
    /** This match's root seed. Reproduces the whole match; shown by the panel. */
    this.seed = (seed ?? freshSeed()) >>> 0;
    // BEFORE anything that could draw. `_beginAim` at the foot of this method
    // snapshots the turn, and a draw taken ahead of the reseed would belong to
    // the previous match's stream.
    seedRun(this.seed);

    this.arena.rebuild();
    this.rules = this.mode.createRules(this.arena);
    this.cards.reset();
    // Emptied HERE and nowhere else. A new match is the only thing that takes
    // a player's cards away — not a goal, not a round, not a rebuild from the
    // panel's sliders. See `CardHands.reset`.
    this.hands.reset();
    this.orbs.reset();

    this.state = MATCH_STATE.AIM;
    this._acc = 0;
    this.alpha = 0;
    /** Rounds played. Bumped by every kickoff reset; watched by the card hands. */
    this.round = 0;
    this._liveShooter = -1;
    this.lastTurn = null;
    this.verify = null;
    this._expect = null;
    this.lastVerdict = null;
    this.lastResolved = null;
    this.winner = undefined;
    this.endHash = '';
    this._goalLatchStep = null;
    this._holdRemaining = 0;
    /** A goal seen mid-turn, for the HUD while the hold runs. Null otherwise. */
    this.goalPending = null;

    // Let the placement bed down before anything is snapshotted, so the first
    // shot is fired into a world genuinely at rest rather than one still
    // resolving a hundredth of a unit of overlap.
    this.arena.settle();
    this._beginAim();
  }

  /**
   * Load a different mode. Structural: a new world and a new match.
   *
   * The layout is swapped before `start`, so the single rebuild path builds the
   * new world — rather than tearing down the old one here and leaving `start` to
   * rebuild something that no longer matches its own rules.
   */
  setMode(mode, seed) {
    this.mode = mode;
    this.arena.setLayout(mode.createLayout(this.config, this.capDims));
    this.start(seed);
  }

  /**
   * Back to the opening placement, mid-match, keeping the score.
   *
   * The world is REBUILT, not teleported, for exactly the reason `start` gives:
   * a teleported world keeps the previous round's contact manifolds and sleep
   * states, so "the same kickoff position" would be a slightly different world
   * every time and the same opening flick would not give the same result twice.
   * Rebuilding is the only version of this that is the same world twice.
   *
   * The rules survive it. A rebuild recreates the same bodies in the same order,
   * so every cap index the rule set holds still means the cap it meant before —
   * which is what lets the score, the turn count and whose kickoff it is carry
   * across a reset that throws the entire physics world away.
   */
  _resetField() {
    this.arena.rebuild();
    this.arena.settle();
    this.rules.onFieldReset();
    // The whistle clears the board of cards as well as of caps. An effect armed
    // in the round that just ended has nothing left to act on: the world it was
    // played into has been thrown away and rebuilt.
    this.cards.onRoundEnd();
    /**
     * And any orb the restored formation is now standing on.
     *
     * The caps have just been teleported back to their kickoff marks, and the
     * orbs on the field were placed clear of where those caps had SETTLED — a
     * completely different set of positions. An orb left under a cap is inside
     * pickup range on the first step of the next turn, so the round opens by
     * handing somebody a free card.
     *
     * Here rather than inside `maybeSpawn`, because this is not a spawn problem:
     * the orb was legal when it was placed and the BOARD moved. See
     * `Orbs.dropBlocked`, which reuses the spawn's own clearance test so the two
     * cannot disagree about how close is too close.
     */
    this.orbs.dropBlocked(this.arena);
    // A goal starts a new round, and a new round is a fresh deal. Published as a
    // counter rather than a callback so the card layer can notice it without the
    // turn loop having to know a hand exists — same one-way rule as everything
    // else here: `game/` states what happened, `render/` decides what to do
    // about it.
    this.round++;
  }

  _beginAim() {
    const shooter = this.rules.shooterFor(this.rules.currentPlayer);
    if (shooter < 0) {
      this.state = MATCH_STATE.OVER;
      return;
    }
    this._deploy(shooter);
    this._syncCapMass();
    this.state = MATCH_STATE.AIM;
    this._acc = 0;
    this.alpha = 0;
    this.arena.resetTransforms();

    // One snapshot per turn. The world cannot move while aiming, so this stays
    // valid for every trajectory recompute AND doubles as the rewind point for
    // the determinism check.
    this.turnSnapshot = this.physics.takeSnapshot();

    // ── and then the live world is restored FROM it ──────────────────────────
    // This looks like a no-op and is the single most important line in the file.
    //
    // A rigid body's position and velocity are not the whole of its state. The
    // solver also carries per-contact warm-start impulses from the previous
    // step, and a snapshot does not round-trip those exactly. So a world that
    // has been stepped into a resting pose and a world restored from a snapshot
    // OF that pose are not the same world: identical positions, identical
    // velocities, identical hash — and a measurably different answer to the same
    // impulse.
    //
    // Which breaks both guarantees this phase is built on. The trajectory
    // preview runs on a restored copy while the real shot runs on the live
    // world, so the line would be drawn from a world subtly unlike the one the
    // cap actually launches in. And the replay button rewinds through a
    // snapshot, so the first replay of a turn would disagree with the turn it
    // was replaying — while every replay after it agreed with the first, which
    // is exactly the shape of bug that gets diagnosed as "close enough".
    //
    // Restoring here makes the snapshot the canonical form: everything that
    // happens from now on — the shot, the preview, every replay — starts from a
    // world that came out of `restoreSnapshot`, so there is only one state left
    // to disagree about.
    this.physics.restore(this.turnSnapshot);
    this.arena.resetTransforms();

    this.turnRulesState = this.rules.save();
    // Saved alongside the rules and rewound with them. A chaos deviation left
    // out of the replay would twist the shot on the first run and not on the
    // second, and the check would report it as a solver failure.
    this.turnCardState = this.cards.save();
    this.startHash = this.physics.hashState();
  }

  /**
   * Put this turn's piece on the field, if the mode has not already.
   *
   * ── the rules ASK; this does it ─────────────────────────────────────────
   * Same division as `respawn` and `resetField`: the rule set answers
   * `needsDeploy`, the layout answers where, and the only thing that moves a
   * body is here. Neither of them touches the world.
   *
   * ── and it happens BEFORE the snapshot, which is the whole of the
   *    determinism argument ─────────────────────────────────────────────────
   * `_beginAim` takes the turn's snapshot a few lines below and then restores
   * the live world from it, so the snapshot is the canonical state everything
   * downstream starts from — the trajectory preview, the shot, and every
   * replay. A cap dealt after that point would exist in the live world and not
   * in the one the replay rewinds to, and the check would report a hash
   * mismatch that was really a missing cap.
   *
   * A no-op in both of the other modes: their rule sets answer false, because
   * their pieces are all on the field from `Arena.build`.
   */
  /**
   * Put 철벽's mass on the caps that should be carrying it, and take it off the
   * caps that should not.
   *
   * ── it runs alongside `_deploy`, and for the identical reason ─────────────
   * BEFORE `takeSnapshot`, which is a few lines above in `_beginAim`. That
   * snapshot is the canonical state everything downstream starts from — the
   * trajectory preview, the AI's rollouts, the shot, every replay — and mass is
   * part of a rigid body's state that Rapier's world serialisation carries
   * (measured: a braced cap round-trips bit-identically, mass, inertia and
   * centre of mass alike). So getting the mass right here is the whole of
   * getting it right everywhere: `predict.js` and `RolloutArena` both build
   * their worlds out of these bytes and inherit it without knowing the card
   * exists. A brace applied after the snapshot would be a brace the preview
   * drew straight through.
   *
   * ── armed vs LIVE: §2-A is this one comparison ────────────────────────────
   * `CardEffects` records only that a player has the card armed. The brace is
   * for the OPPONENT's reply, so it is live exactly while it is not that
   * player's own turn — which is `owner !== currentPlayer`, asked here because
   * this is where whose-turn-it-is is known. Two consequences fall out of it
   * rather than needing rules of their own: a 원모어 chain leaves the holder
   * unbraced for their whole run of turns, and a brace that outlives a reply is
   * impossible because `onTurnEnd` has already cleared the slot by the time this
   * next runs.
   *
   * ── it is a no-op in the overwhelming majority of turns ───────────────────
   * `Arena.setCapMassMul` compares against what it last wrote and returns
   * without touching Rapier when nothing changed, so this is a loop and a few
   * comparisons on every turn where nobody is holding the card. What it must
   * never become is a per-STEP call: see the note there.
   */
  _syncCapMass() {
    if (this.mode.cards === false) return;
    const current = this.rules.currentPlayer;
    for (let i = 0; i < this.arena.capCount; i++) {
      const owner = this.arena.capOwner[i];
      const live = owner !== current && this.cards.resistOn(owner);
      this.arena.setCapMassMul(i, live ? this.cards.massMulFor(owner) : 1);
    }
  }

  _deploy(shooter) {
    if (!this.rules.needsDeploy?.(shooter)) return;
    const spot = this.arena.layout.throwSpot?.(this.arena, this.rules.onLane?.() ?? null);
    if (!spot) return;
    this.arena.placeCap(shooter, spot.x, spot.z);
    this.rules.onDeployed(shooter);
  }

  // ── cards ────────────────────────────────────────────────────────────────

  /**
   * Play a card for the player whose turn it is.
   *
   * The availability check is here rather than only in the hand, because the
   * hand is a view: a card that greys out is a courtesy, and this is the rule.
   * Both ask the same predicate — see `cardCatalog` — so they cannot disagree
   * about what is playable, only about who is being polite.
   *
   * @param {string} cardId
   * @returns {{ok: boolean, reason?: string}}
   */
  playCard(cardId) {
    /**
     * A mode may not use cards at all.
     *
     * ── the SYSTEM is switched off, not removed ─────────────────────────────
     * Curling has no hand, no orbs and no effects, and the way that is arranged
     * is one flag on the mode rather than a deleted subsystem: "카드 시스템
     * 코드를 삭제하지 말고, 모드 설정으로 비활성화하는 구조로 처리해라. 다른
     * 모드는 계속 카드를 쓴다."
     *
     * The refusal lives here rather than only in the view for the same reason
     * the availability check does — the hand is a view, and this is the rule.
     * The panel's 효과 강제 발동 buttons come through here too, so they are
     * refused in curling as well instead of arming an effect nothing will spend.
     */
    if (this.mode.cards === false) {
      return { ok: false, reason: '이 모드에서는 카드를 쓰지 않습니다' };
    }
    if (this.state !== MATCH_STATE.AIM) return { ok: false, reason: '지금은 사용할 수 없습니다' };
    const player = this.rules.currentPlayer;
    const usable = this.cards.usable(cardId, player);
    if (!usable.ok) return usable;

    // Drawn from the same counter every other seeded thing uses, so a match
    // replayed from the reset button plays the same cards the same way.
    const outcome = this.cards.play(cardId, player, nextSeed());
    // Spent from the hand at the same moment the effect starts. By type rather
    // than by instance because the view reports what was played, not which of
    // the duplicates — and duplicates are interchangeable at the point of use.
    this.hands.removeFirstOfType(player, cardId);
    this.lastCard = { cardId, player };

    this._fx = { cardId, player, seconds: this._fxSeconds(cardId), elapsed: 0 };
    this.state = MATCH_STATE.CARD_FX;
    this._acc = 0;
    this.alpha = 0;

    if (outcome.physical) {
      // What was already touching. Two caps resting against each other are 3% of
      // a diameter inside one another — that is what a contact IS — and the
      // exchange is a permutation of the same set of positions, so they come out
      // still touching. Reported raw, the check cried wolf on every swap taken
      // in a crowded position.
      this._swapOverlapBefore = new Set(
        CapSwap.overlap(this.arena, this.rules.alive).map((o) => `${o.a}:${o.b}`),
      );
      // `alive` matters in knockout, where a cap that has gone off the board is
      // still a body — thirty units down on the catch floor. See `CapSwap.pairs`.
      this.swap.begin(this.arena, this.rules.alive);
      this._fxPhysical = true;
    } else {
      this._fxPhysical = false;
    }
    return { ok: true };
  }

  _fxSeconds(cardId) {
    const cfg = this.config.cards;
    return Math.max(0, cfg.fxSeconds?.[cardId] ?? 0.6);
  }

  /**
   * Seconds of real time the accumulator is holding but has not stepped.
   *
   * The one number that says whether the simulation is keeping up, and the
   * measurement panel is the only thing that wants it. It was read straight off
   * `_acc` from `main.js`, which is a private field of a class the render layer
   * is not supposed to reach into — and the comment there admitted as much.
   *
   * A getter rather than making the field public: this is an OBSERVATION, and
   * nothing outside may write it. Every path that does write it clamps or zeroes
   * it as part of a step, and a caller setting it would desynchronise the
   * fixed-step clock from the interpolation `alpha` derived from it.
   */
  get backlogSeconds() {
    return this._acc;
  }

  /** How far through the current card effect, 0..1. What the renderer draws off. */
  get cardFx() {
    if (this.state !== MATCH_STATE.CARD_FX || !this._fx) return null;
    const t = this._fx.seconds > 0 ? Math.min(1, this._fx.elapsed / this._fx.seconds) : 1;
    return { cardId: this._fx.cardId, player: this._fx.player, t };
  }

  /**
   * The effect, on whichever clock it belongs on.
   *
   * Swap steps the world, because it MOVES bodies and the next turn is
   * snapshotted from the result — a physical change driven by frame time would
   * put the display's refresh rate into the simulation. The other three step
   * nothing at all: they change no body, so the turn's existing snapshot is
   * still a snapshot of the world the shot will be fired into, and stepping
   * would invalidate it for no reason.
   */
  _updateCardFx(dtSeconds) {
    // Never possible in the ordinary path, and the ordinary path is not the one
    // that matters here: this state blocks every shot for BOTH players, so if it
    // is ever entered without an effect to run, the match is over as far as the
    // player is concerned. Costs one comparison; removes a class of dead game.
    if (!this._fx) {
      this._fxPhysical = false;
      this.state = MATCH_STATE.AIM;
      return;
    }
    this._fx.elapsed += dtSeconds;

    /**
     * The way out that does not depend on anything going right.
     *
     * The effect normally ends because the swap finished and the clock ran out.
     * If either of those ever fails to happen — a swap that cannot complete, a
     * clock that is not being advanced — the match sits in a state where NOBODY
     * can shoot and the only thing that still answers is the camera. That is not
     * a bug to be traded off against; it is the game being over.
     *
     * Four times the effect's own length, so it cannot fire during a legitimate
     * effect, and it reports itself rather than recovering quietly.
     */
    if (this._fx.elapsed > Math.max(2, this._fx.seconds * 4)) {
      console.warn(
        `[card] "${this._fx.cardId}" effect overran ${this._fx.elapsed.toFixed(1)}s — forcing the turn back open`,
      );
      if (this.swap.active) this.swap.finish(this.arena);
      this._fx = null;
      this._fxPhysical = false;
      this._beginAim();
      return;
    }

    if (this._fxPhysical) {
      this._acc += dtSeconds * Math.max(0.01, this.config.view.slowmo);
      let n = 0;
      while (this._acc >= FIXED_DT && n < MAX_STEPS_PER_FRAME) {
        this._acc -= FIXED_DT;
        n++;
        this.swap.advance(this.arena);
        this.physics.step();
        this.arena.syncTransforms();
        if (this.swap.done) {
          this.swap.finish(this.arena);
          // Let the landing bed down before the turn is snapshotted, exactly as
          // a fresh placement does at kickoff. Fixed budget, fixed thresholds.
          this.arena.settle();
          // Only pairs that were not already touching. See `playCard`.
          this.swapOverlap = CapSwap.overlap(this.arena, this.rules.alive).filter(
            (o) => !this._swapOverlapBefore?.has(`${o.a}:${o.b}`),
          );
          this._fxPhysical = false;
          this._acc = 0;
          break;
        }
      }
      if (n >= MAX_STEPS_PER_FRAME) this._acc = 0;
      this.alpha = this._acc / FIXED_DT;
    } else {
      this.alpha = 0;
    }

    // The world is done moving AND the effect has played out. Either can finish
    // first; the turn reopens when both have.
    if (!this._fxPhysical && this._fx.elapsed >= this._fx.seconds) {
      const wasPhysical = this._fx.cardId === 'swap';
      this._fx = null;
      // Only a card that changed the world needs a new snapshot. Re-taking one
      // for chaos or one-more would re-freeze a world that never moved, which is
      // harmless and is also a second place for the turn's canonical state to
      // come from — and there should be exactly one.
      if (wasPhysical) this._beginAim();
      else {
        // The CARD state is re-saved even so, and it is the one thing that has
        // moved. `turnCardState` is what `fire` hands the replay, and it was
        // taken when the turn opened — before this card existed. Left stale, a
        // replay restores a world in which the card was never played and wipes
        // it off the live board: cast 혼란, press 리플레이, and the opponent
        // aims freely with the card still shown as spent.
        //
        // Only the card state, not the snapshot. The world genuinely has not
        // changed, so there is still exactly one place it comes from.
        this.turnCardState = this.cards.save();
        this.state = MATCH_STATE.AIM;
      }
    }
  }

  // ── input ────────────────────────────────────────────────────────────────

  /** The turn's orb stream. See `fire`. */
  _orbRng() {
    if (!this._orbRngState) this._orbRngState = new Rng(0x5eed0000);
    return this._orbRngState;
  }

  get shooter() {
    return this.state === MATCH_STATE.AIM
      ? this.rules.shooterFor(this.rules.currentPlayer)
      : this._liveShooter ?? -1;
  }

  /** @param {import('./shot.js').Shot} shot */
  fire(shot) {
    if (this.state !== MATCH_STATE.AIM) return null;

    const resolved = applyShot(this.arena, shot, this.config.shot);
    this.lastResolved = resolved;
    this._liveShooter = shot.capIndex;
    // `_turnPlayer` used to be latched here — whose turn it is, fixed at the
    // moment of firing — because the shooter collected every orb any cap ran
    // over. A pickup now belongs to the owner of the cap that touched it, which
    // `Orbs` reads straight off the arena, so nothing asks this question any
    // more and holding the answer would be a field that only ever goes stale.
    /**
     * The turn's orb stream, derived from the SHOT's seed.
     *
     * Derived rather than drawn fresh so a replay reproduces the pickups too:
     * `replayLastTurn` re-fires the stored shot record, the seed comes back
     * with it, and every orb draw this turn lands the same way. A `nextSeed()`
     * here would advance a global counter the replay could not rewind.
     */
    this._orbRngState = new Rng((shot.seed ^ 0x9e3779b9) >>> 0);

    this.lastTurn = {
      snapshot: this.turnSnapshot,
      rulesState: this.turnRulesState,
      cardState: this.turnCardState,
      shot: { ...shot },
      startHash: this.startHash,
      endHash: '',
      steps: 0,
    };

    // The long preview was for this shot. It has now been taken.
    this.cards.onFire(this.rules.currentPlayer);
    // And whatever the last turn's stepping recorded belongs to the last turn.
    this.rules.beginTurn();

    this.settle.begin(this.arena);
    this.state = MATCH_STATE.LIVE;
    this._acc = 0;
    // Cleared per shot, not per match: the latch below is about THIS turn.
    this._goalLatchStep = null;
    this.goalPending = null;
    return resolved;
  }

  /**
   * Open the match on a player other than the one the mode would have chosen.
   *
   * ── the server decides who leads an online match, and it has to be obeyed ──
   * Both clients build their own `Match`, and a `Match` always opens on the
   * player its rule set nominates — which is the same one on both machines and
   * has nothing to do with the coin the relay flipped. Left alone, the server
   * believes seat 1 is on move while both clients believe seat 0 is, and every
   * turn afterwards is played by the wrong person: the input is refused as
   * "not your turn", the timer expires, and the skip advances the clients one
   * step out of phase with the server forever.
   *
   * It was found exactly that way — a relay log reading "turn 0 expired for
   * seat 1, turn 1 expired for seat 1" — and it was invisible to the headless
   * lockstep test, which drove whichever seat the SERVER named and so kept both
   * clients agreeing with each other while both disagreed with the server. Two
   * clients that agree is necessary and not sufficient.
   *
   * `_beginAim` is re-run rather than only the field being set, because the turn
   * it opened belongs to the other player: in curling that means a cap has
   * already been dealt to the wrong throw spot, and the snapshot everything
   * downstream rewinds to was taken of it.
   *
   * @param {number} player
   * @returns {boolean} whether anything changed
   */
  setFirstPlayer(player) {
    if (this.state !== MATCH_STATE.AIM) return false;
    if (this.rules.currentPlayer === player) return false;
    this.rules.setCurrentPlayer(player);
    this._beginAim();
    return true;
  }

  /**
   * Turn the cap this player is about to throw onto its other face.
   *
   * ── it does not cost a turn, and there is no limit ───────────────────────
   * Flipping is not a move; it is how you are holding the cap. So nothing here
   * touches `advanceTurn`, the score, or whose go it is, and it can be done as
   * many times in a turn as anybody likes. The only cost is that the shot you
   * then take is a different shot.
   *
   * ── before the pull starts, and that is a rule about the SEED ────────────
   * Refused once a drag is under way. `AimInput` draws the shot's error seed
   * when the drag STARTS, and the trajectory preview has already been drawn from
   * it — so a flip mid-pull would either keep a seed drawn for a different cap
   * pose, or draw a fresh one, which is a player re-rolling the error cone by
   * tapping a button. Neither is a thing to leave available; the gate is the
   * `aiming` flag the caller passes in, because the drag lives in `AimInput` and
   * this class has never heard of it.
   *
   * ── the snapshot has to be RE-TAKEN, and this is the whole hazard ────────
   * `_beginAim` takes one snapshot per turn and immediately restores the world
   * from it, which makes that snapshot the canonical state — the preview runs on
   * a copy of it, the replay check rewinds to it, and `startHash` is its
   * fingerprint. Flipping a cap afterwards moves the world out from under all
   * three: the preview would draw the shot the UNFLIPPED cap would take, and the
   * replay would rewind the flip away and report the difference as a solver
   * failure.
   *
   * So `_beginAim` is re-run, exactly as `setFirstPlayer` re-runs it and for the
   * same reason. It is idempotent here — the cap is already dealt, so `_deploy`
   * does nothing — and it leaves the flipped world as the new canonical one.
   *
   * @param {boolean} [aiming]  is a drag under way right now
   * @returns {boolean} whether a cap was turned over
   */
  flipCap(aiming = false) {
    if (this.state !== MATCH_STATE.AIM) return false;
    if (aiming) return false;

    const shooter = this.rules.shooterFor(this.rules.currentPlayer);
    if (shooter < 0) return false;
    // A cap that has not been dealt is in the pocket, thirty units under the
    // table. There is nothing there to turn over, and `_beginAim` deals it.
    if (this.rules.needsDeploy?.(shooter)) return false;

    this.arena.flipCap(shooter);
    this._beginAim();
    // Published as a counter, the same one-way seam the round counter uses:
    // `game/` says a cap turned over, `render/` decides what to draw about it.
    this.flips++;
    return true;
  }

  /**
   * Let the turn pass without anything being played.
   *
   * ── the timeout rule, and why it is not "play something reasonable" ───────
   * Online, the server owns a fifteen second clock and hands the turn on when it
   * runs out. The brief is explicit that nothing is played: "시간 초과 시 턴이
   * 그냥 넘어간다. 자동으로 아무 수나 두지 마라." A move invented on a player's
   * behalf is a move they are then judged on, and in a game where one bad flick
   * puts a cap off the board that is worse than losing the turn.
   *
   * ── it is the tail of `_endTurn`, minus the verdict ──────────────────────
   * Deliberately the same three calls in the same order, because a turn that
   * passes still has to cycle which cap is offered next and still has to let an
   * armed 원모어 have its say. What is NOT here is `rules.resolveTurn` — nothing
   * happened, so there is nothing to judge, no elimination and no goal — and
   * nothing that could draw from the seeded stream. That last part is what makes
   * this safe for lockstep: both clients run it on the same server message and
   * neither consumes a random number, so the two counters stay in step.
   *
   * @returns {boolean} whether there was a turn to pass
   */
  skipTurn() {
    if (this.state !== MATCH_STATE.AIM) return false;

    const shooter = this.rules.currentPlayer;
    const again = this.cards.onTurnEnd(shooter);
    this.rules.advanceTurn();
    if (again) this.rules.setCurrentPlayer(shooter);

    this.lastVerdict = null;
    this.lastResolved = null;
    this._beginAim();
    return true;
  }

  /**
   * Fire the last shot again from the same world state with the same seed.
   *
   * This is the completion criterion made runnable. It rewinds the physics world
   * to the snapshot the turn started from, restores the rules' bookkeeping to
   * match, and replays the identical shot record — then compares the end-state
   * hash and the step count against what happened the first time. Two identical
   * hashes is the proof; anything else is a determinism bug with a number
   * attached to it.
   */
  replayLastTurn() {
    if (!this.lastTurn) return false;

    this.physics.restore(this.lastTurn.snapshot);
    this.arena.resetTransforms();
    this.rules.load(this.lastTurn.rulesState);
    this.cards.load(this.lastTurn.cardState);

    // Straight into the same code path a real shot takes. A replay that went
    // through a different function would only prove that function deterministic.
    this.turnSnapshot = this.lastTurn.snapshot;
    this.turnRulesState = this.lastTurn.rulesState;
    this.turnCardState = this.lastTurn.cardState;
    this.startHash = this.physics.hashState();

    // Kept separately from the end-state check so a failure says WHICH half
    // broke: a start hash that already differs means the snapshot round trip is
    // lossy, and only a matching start with a differing end is the solver
    // itself being non-deterministic.
    this._expect = {
      hash: this.lastTurn.endHash,
      steps: this.lastTurn.steps,
      startHash: this.lastTurn.startHash,
      startOk: this.lastTurn.startHash === this.startHash,
    };
    this.state = MATCH_STATE.AIM;
    this.fire(this.lastTurn.shot);
    return true;
  }

  // ── the loop ─────────────────────────────────────────────────────────────

  update(dtSeconds) {
    if (this.state === MATCH_STATE.RESPAWN) {
      this._updateRespawn(dtSeconds);
      return;
    }
    if (this.state === MATCH_STATE.GOAL_HOLD) {
      this._updateGoalHold(dtSeconds);
      return;
    }
    if (this.state === MATCH_STATE.CARD_FX) {
      this._updateCardFx(dtSeconds);
      return;
    }
    if (this.state !== MATCH_STATE.LIVE) {
      this.alpha = 0;
      return;
    }

    this._acc += dtSeconds * Math.max(0.01, this.config.view.slowmo);

    let n = 0;
    while (this._acc >= FIXED_DT && n < MAX_STEPS_PER_FRAME) {
      this._acc -= FIXED_DT;
      n++;
      this.settle.preStep(this.arena);
      this.physics.step();
      this.arena.syncTransforms();
      /**
       * The pickup test, INSIDE the step.
       *
       * Here rather than at the end of the turn because the brief asks for the
       * card to arrive the instant a cap arrives, and because the caps are only
       * at these positions during this step.
       *
       * No player is passed any more. It used to take `_turnPlayer`, because the
       * shooter collected whatever any cap ran over; the card now belongs to the
       * owner of the cap that touched it, which `Orbs` reads off the arena. See
       * the note in `Orbs.step`.
       */
      this.orbs.step(this.arena, this.hands, this._orbRng());
      this._watchForGoal();
      if (this.settle.postStep(this.arena)) {
        this._endTurn();
        this._acc = 0;
        break;
      }
    }

    // Whatever is left over after the cap is dropped, not carried: carrying it
    // means the next frame starts already behind and the backlog never clears.
    if (n >= MAX_STEPS_PER_FRAME) this._acc = 0;

    this.alpha = this.state === MATCH_STATE.LIVE ? this._acc / FIXED_DT : 0;
  }

  /**
   * Note the step the ball came to rest in a net, for the `ballStop` timing.
   *
   * Costs one narrow-phase query per step and only while it might still fire, so
   * a turn with no goal in it pays for the `kindAtRest` check and nothing else.
   * It records a step index and a string; it does not score anything and it does
   * not end the turn. `resolveTurn` still judges, once, at rest.
   *
   * The note is published here as well, because the hold that starts from this
   * moment has to have the goal already on screen when it begins — at turn end
   * the verdict takes over and says the same thing.
   */
  _watchForGoal() {
    // Unconditional, and first: the rules latch a ball crossing the line here,
    // and that has to happen whatever the hold is set to. It was inside the
    // `ballStop` branch when the only thing being timed was the pause — which
    // meant a goal that rolled back out was recorded on one hold setting and
    // lost on the other, and neither of them was the setting's business.
    this.rules.observe();

    if (this._goalLatchStep !== null) return;
    if (this.config.football?.goalHoldMode !== 'ballStop') return;
    if (!this.arena.hasBall || !this.rules.pendingGoal) return;
    if (!this.arena.kindAtRest(BODY_KIND.BALL)) return;
    const pending = this.rules.pendingGoal();
    if (!pending) return;
    this._goalLatchStep = this.settle.steps;
    this.goalPending = pending;
  }

  /**
   * Steps still to wait before the reset, given when the hold started counting.
   *
   * `ballStop` starts at the latch and therefore OVERLAPS the tail of the turn:
   * whatever the caps spent settling after the ball stopped is time the player
   * has already had to look at the goal, so it comes off the wait. `turnEnd`
   * starts from zero here and is added on top.
   */
  _goalHoldSteps() {
    const seconds = Math.max(0, this.config.football?.goalHoldSeconds ?? 0);
    if (seconds <= 0) return 0;
    const total = secondsToSteps(seconds);
    if (this._goalLatchStep === null) return total;
    return Math.max(0, total - (this.settle.steps - this._goalLatchStep));
  }

  _endTurn() {
    // One roll per turn, taken before anything else can change the field. The
    // roll happens whether or not there is room — see `Orbs.maybeSpawn` for why
    // that matters to a replay.
    //
    // Not at all in a mode with cards switched off. `maybeSpawn` would already
    // return null there, because an orb needs a `mode.orbArea` to appear in and
    // curling does not define one — but "미스터리 오브도 생성하지 마라" deserves
    // to be a stated decision rather than a consequence of a missing field.
    if (this.mode.cards !== false) {
      this.orbs.maybeSpawn(this._orbRng(), this.arena, this.mode);
    }
    this.orbs.endTurn();

    const endHash = this.physics.hashState();
    this.endHash = endHash;
    this.lastTurn.endHash = endHash;
    this.lastTurn.steps = this.settle.steps;
    this._liveShooter = -1;

    if (this._expect) {
      const e = this._expect;
      this._expect = null;
      this.verify = {
        expectedHash: e.hash,
        actualHash: endHash,
        expectedSteps: e.steps,
        actualSteps: this.settle.steps,
        startOk: e.startOk,
        ok: e.startOk && e.hash === endHash && e.steps === this.settle.steps,
      };
    }

    const verdict = this.rules.resolveTurn();
    this.lastVerdict = { ...verdict, reason: this.settle.reason, steps: this.settle.steps };

    /**
     * Take whatever has left play off the field, if this mode has somewhere.
     *
     * A no-op in both of the other modes — `Layout.pocketFor` answers null and
     * `stowCap` returns — and it has to happen for curling: an out there is a
     * LINE, so an eliminated cap is still standing on the run-off where it
     * stopped. The rules have marked it dead so the renderer no longer draws it,
     * and an undrawn body that still collides is an invisible wall the next
     * throw would bounce off.
     *
     * After the end-of-turn hash, deliberately. The hash is what the replay
     * check compares and it describes the turn that was just played; moving a
     * body afterwards belongs to the next turn, which takes its own snapshot.
     */
    for (const i of verdict.eliminated) this.arena.stowCap(i);

    /**
     * And whatever the mode is sweeping off because the round ended.
     *
     * The same operation as the line above and a different EVENT — see
     * `RuleSet.resolveTurn`. Curling empties the table between rounds, and the
     * caps it takes off did nothing wrong; folding them into `eliminated` would
     * have the audio layer announce an overshoot for each of them and the note
     * line report them as having gone out.
     *
     * A no-op in both of the other modes, which never set the field.
     */
    for (const i of verdict.cleared ?? []) this.arena.stowCap(i);

    if (verdict.winner !== null) {
      this.state = MATCH_STATE.OVER;
      this.winner = verdict.winner;
      return;
    }

    // Read before `advanceTurn` moves it on, and consumed here rather than
    // inside the rule set: an extra turn is a card talking, not football.
    const shooter = this.rules.currentPlayer;
    const again = this.cards.onTurnEnd(shooter);

    this.rules.advanceTurn();
    // ...and then put back, if a card said so.
    //
    // AFTER `advanceTurn` rather than instead of it, deliberately. That call
    // also cycles which of the player's own caps is offered next and clears the
    // selection, and an extra turn should still move on to the next cap — it is
    // another turn, not the same one again. Only whose turn it is gets undone.
    //
    // ── but not through a goal ─────────────────────────────────────────────
    // It used to survive one, and that was the wrong end of the same argument:
    // an extra turn is a card talking, and the whistle is where the cards stop
    // talking. A goal ends the round, `_resetField` clears every armed effect
    // with it, and taking the kickoff back off the conceding side here would be
    // the one effect that outlived the round it was played in — the scorer
    // restarts AND shoots again, off a card that is already in the bin.
    //
    // Read off the verdict rather than off the state, because the reset itself
    // may still be several hundred steps away behind the goal hold.
    if (again && !verdict.resetField) this.rules.setCurrentPlayer(shooter);

    // After `advanceTurn`, so the mode has already recorded who restarts, and
    // before `_beginAim`, so the snapshot the next turn is judged against is
    // taken of the world the next player is actually looking at.
    if (verdict.resetField) {
      // The hold sits between `advanceTurn` and the reset, and touches neither.
      // At zero steps this is exactly the old path.
      const hold = this._goalHoldSteps();
      if (hold > 0) {
        this._holdRemaining = hold;
        this.state = MATCH_STATE.GOAL_HOLD;
        this._acc = 0;
        this.alpha = 0;
        return;
      }
      this._resetField();
    } else if (verdict.respawn) {
      // The ball has to arrive before the turn opens, so `_beginAim` waits at
      // the far end of the animation rather than running here.
      this.respawn.begin(this.arena, verdict.respawn);
      this.state = MATCH_STATE.RESPAWN;
      this._acc = 0;
      this.alpha = 0;
      return;
    }
    this._beginAim();
  }

  /**
   * Sit on the goal, on the simulation's own clock.
   *
   * The world keeps stepping. That is deliberate and it is what makes the
   * `ballStop` timing worth having: the caps are still coming to rest during the
   * hold and you watch them do it, rather than the picture freezing the moment
   * the ball stops. By `turnEnd` there is nothing left moving and the stepping
   * costs nothing.
   *
   * None of it reaches the next turn. `_resetField` throws the world away and
   * rebuilds it, and the end-of-turn hash was taken before any of this — so how
   * many steps the hold ran cannot change what the next turn starts from.
   */
  _updateGoalHold(dtSeconds) {
    this._acc += dtSeconds * Math.max(0.01, this.config.view.slowmo);

    let n = 0;
    while (this._acc >= FIXED_DT && n < MAX_STEPS_PER_FRAME) {
      this._acc -= FIXED_DT;
      n++;
      this.physics.step();
      this.arena.syncTransforms();
      this._holdRemaining--;
      if (this._holdRemaining <= 0) {
        this._acc = 0;
        this._resetField();
        this._beginAim();
        break;
      }
    }

    if (n >= MAX_STEPS_PER_FRAME) this._acc = 0;
    this.alpha = this.state === MATCH_STATE.GOAL_HOLD ? this._acc / FIXED_DT : 0;
  }

  /** How far through the hold we are, 0..1. For the panel. */
  get goalHoldProgress() {
    if (this.state !== MATCH_STATE.GOAL_HOLD) return 0;
    const total = Math.max(1, secondsToSteps(Math.max(0.001, this.config.football.goalHoldSeconds)));
    return Math.max(0, Math.min(1, 1 - this._holdRemaining / total));
  }

  /**
   * Roll the ball back, on the simulation's own clock.
   *
   * The same accumulator and the same fixed step as everything else, and that is
   * the point: the animation is a fixed number of steps, so it takes the same
   * simulated time on any machine and leaves the world in the same state every
   * run. Driving it from frame time instead would make the next turn's snapshot
   * depend on how fast the display happened to be.
   */
  _updateRespawn(dtSeconds) {
    this._acc += dtSeconds * Math.max(0.01, this.config.view.slowmo);

    let n = 0;
    while (this._acc >= FIXED_DT && n < MAX_STEPS_PER_FRAME) {
      this._acc -= FIXED_DT;
      n++;
      this.respawn.advance(this.arena);
      this.physics.step();
      this.arena.syncTransforms();
      if (this.respawn.done) {
        this.respawn.finish(this.arena);
        this._acc = 0;
        this._beginAim();
        break;
      }
    }

    if (n >= MAX_STEPS_PER_FRAME) this._acc = 0;
    this.alpha = this.state === MATCH_STATE.RESPAWN ? this._acc / FIXED_DT : 0;
  }
}

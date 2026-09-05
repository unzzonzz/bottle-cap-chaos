import { MATCH_STATE } from '../Match.js';
import { nextSeed } from '../../physics/rng.js';
import { AiPlanner } from './AiPlanner.js';
import { decideCard } from './cardPolicy.js';
import { strategyFor } from './strategy.js';
// Imported for their side effect: each registers itself under a mode key, so
// `strategyFor` can find it. A mode with no strategy is one the menu never
// offered — see `MODES.<mode>.ai` and `strategy.js`.
import './survivalStrategy.js';
import './footballStrategy.js';

/**
 * Who is playing this seat, as one interface with two implementations.
 *
 * ── the point is that `Match` never finds out ───────────────────────────────
 * "게임 로직은 어느 쪽인지 몰라도 동작해야 한다. 턴 흐름 상태머신에 AI 분기를
 * 흩뿌리지 마라." There is not one line in `Match.js` that mentions a controller,
 * and there is nothing in here that reaches into the turn state machine: an AI
 * turn ends the way a human turn ends, by `match.fire()` being called with a
 * shot record, and an AI card is played the way a human card is, through
 * `match.playCard()`. Every rule, every refusal and every effect is the same
 * code path.
 *
 * That is not tidiness for its own sake. The two things this buys are the two
 * things the brief asks for at the end: player-versus-player still works because
 * nothing about it changed, and a third mode gets an AI by handing it a
 * different planner — the sequencing, the input gate and the presentation below
 * are mode-agnostic.
 *
 * ── the interface ──────────────────────────────────────────────────────────
 *   acceptsInput   may the human fire and play cards right now
 *   label          what the turn plate says after "PLAYER n"
 *   begin(ctx)     this seat's turn just opened
 *   update(dt,ctx) one frame
 *   skip()         the player clicked through the presentation
 *   cancel()       the turn was taken away — rebuild, mode switch, match over
 */

export class HumanController {
  constructor(player) {
    this.player = player;
  }

  get isAi() {
    return false;
  }

  /**
   * Nothing is blocked, and nothing is driven.
   *
   * A human turn is already fully implemented by `PointerRouter` -> `AimInput` ->
   * `Match.fire`, and this deliberately does not wrap any of it. Routing the
   * existing input through a controller would be a second path to the same call
   * for no benefit, and it is the path that has to keep working unchanged.
   */
  get acceptsInput() {
    return true;
  }

  get label() {
    return '';
  }

  begin() {}
  update() {}
  skip() {}
  cancel() {}
}

/**
 * The AI's turn, as a strictly sequential presentation over a search.
 *
 * ── the phases do not overlap, and the order is the brief's ────────────────
 *
 *   think    the search runs, sliced across frames. No visuals.
 *   card*    a face-down card is drawn out, moved in, turned over, and held
 *   cardFx   the game's own activation effect, unchanged
 *   replan   only after 강타, which changes what the shot IS
 *   gap      a beat, so the card and the aim do not read as one movement
 *   aim*     the cap is picked out, the pull grows, it holds, it fires
 *
 * "카드 연출과 조준 연출이 겹치지 않는다" is enforced by this being a single
 * cursor through a list rather than a set of timers — two overlapping phases is
 * not expressible.
 *
 * ── none of it is a "thinking" delay ───────────────────────────────────────
 * "인위적인 '생각 중' 딜레이를 추가하지 마라. 이 연출이 그 역할을 한다." Nothing
 * below waits on purpose: the search runs during `think`, underneath the camera
 * still easing into the turn's framing, and every other phase is showing the
 * player something they need in order to know what just happened.
 *
 * `think` is the longest of them and it is real work rather than a beat —
 * measured at about two seconds of solver on a 64-candidate search, which is
 * why what it costs in WALL CLOCK is a question of its own. See `ThinkBudget`:
 * the share of each frame the search gets is what turns those two seconds into
 * the wait, and it used to be a constant that suited neither a 60 Hz phone nor
 * a 120 Hz desktop.
 *
 * ── 강타 forces a second search, and that is not optional ───────────────────
 * The card multiplies the impulse by 1.5 and the cone by 1.5, so the shot the
 * first search chose is not the shot that would now fire. Planning once and
 * playing the card afterwards would have the AI take a boosted version of a move
 * it selected unboosted — which on this board is how a good shot becomes a cap
 * sailing off the far edge.
 *
 * It used to run after every card on the argument that it was hidden under the
 * effect animation. It is not — `replan` is a phase of its own with nothing on
 * screen — so it now runs only when the search's own inputs have moved, which is
 * still not a check on which card was played. See `_replan`.
 */
export class AiController {
  /**
   * @param {number} player
   * @param {typeof import('../config.js').CONFIG} config
   */
  constructor(player, config) {
    this.player = player;
    this.config = config;
    this.planner = new AiPlanner(config);

    this.phase = 'idle';
    this._t = 0;
    /** The shot the search settled on, and the card it decided to spend. */
    this.plan = null;
    this.cardId = null;
    /** Why each card was or was not played. Read by the panel. */
    this.cardLog = [];
    /** Milliseconds of search this turn, both passes. Read by the panel. */
    this.thinkMs = 0;
    this._replanned = false;
    /** The card state the current plan was searched under. See `_replan`. */
    this._searchInputs = null;

    /**
     * What the aim overlay draws while the pull grows, or null.
     *
     * The controller owns it because the controller owns the timing; the
     * renderer reads it exactly as it reads `AimInput.preview`, so the bow, the
     * pull line and the cone are the SAME drawing a human gets rather than a
     * second one built to look like it.
     */
    this.aim = null;
    /** Which cap is being picked out, or -1. */
    this.highlight = -1;
  }

  get isAi() {
    return true;
  }

  /**
   * Fire and cards are blocked; the camera is not.
   *
   * "카메라 조작(줌·팬·회전): 허용" — and it is allowed by this being the only
   * thing the router asks. `PointerRouter` already treats the camera as
   * ungated by match state (see the note on `MATCH_STATE.GOAL_HOLD`), so
   * refusing the aim and the cards is the whole of the change.
   */
  get acceptsInput() {
    return false;
  }

  get label() {
    return ' (AI)';
  }

  /** Every phase in order, with the config key that times it. */
  _durations() {
    const s = this.config.ai.show;
    return {
      cardPull: s.cardPullSeconds,
      cardMove: s.cardMoveSeconds,
      cardFlip: s.cardFlipSeconds,
      cardHold: s.cardHoldSeconds,
      gap: s.gapSeconds,
      aimHighlight: s.aimHighlightSeconds,
      aimDraw: s.aimDrawSeconds,
      aimHold: s.aimHoldSeconds,
    };
  }

  begin({ match }) {
    this.phase = 'think';
    this._t = 0;
    /**
     * The cone's draw for this turn, taken ONCE and before any planning.
     *
     * ── the planner is never told, and that is the whole point ──────────────
     * `AimInput.begin` draws a human's at press, out of the same global counter,
     * and the human does not get to see it either. Drawn here rather than inside
     * the planner because the planner runs TWICE on a 강타 turn — plan, play the
     * card, re-plan — and the shot fired is one shot with one draw. Drawing per
     * plan would give the second search a different cone from the first and cost
     * two `nextSeed()` calls where the turn only fires once.
     *
     * Exactly one call per AI turn, whatever the search does, so the global
     * stream advances by a fixed amount and the match still replays from
     * `?seed=`. `lockSeed` is honoured for the same reason `AimInput` honours it.
     */
    this._shotSeed = this.config.shot.lockSeed
      ? this.config.shot.lockedSeed >>> 0
      : nextSeed();
    this.plan = null;
    this.cardId = null;
    this.cardLog = [];
    /** Every card spent this turn, in order. Combos land here. */
    this.cardsPlayed = [];
    this.thinkMs = 0;
    this._replanned = false;
    /**
     * What the search reads about this seat's cards, as it stands BEFORE any of
     * them is played. `_replan` compares against it — see `searchInputs`.
     */
    this._searchInputs = this.planner.searchInputs(match, this.player);
    this.aim = null;
    this.highlight = -1;
    this.planner.begin({
      match,
      player: this.player,
      shotSeed: this._shotSeed,
      strategy: strategyFor(match.mode),
    });
  }

  cancel() {
    this.phase = 'idle';
    this.plan = null;
    this.aim = null;
    this.highlight = -1;
    this.planner.cancel();
  }

  /**
   * Jump to the end of the current phase.
   *
   * "연출 스킵: 클릭하면 즉시 다음 단계로 점프." One phase at a time rather than
   * to the shot, so a player who wants to hurry can, without losing the ability
   * to see the next thing — and a single click cannot skip both the card and the
   * aim, which would leave them looking at a board that changed for no visible
   * reason.
   *
   * The search is never skipped. It is not a presentation phase and there is
   * nothing to look at; jumping it would just mean the AI had not finished
   * deciding.
   */
  skip() {
    if (this.phase === 'idle' || this.phase === 'think' || this.phase === 'replan') return;
    this._t = Infinity;
  }

  /**
   * @param {number} dt   render seconds
   * @param {object} ctx
   * @param {import('../Match.js').Match} ctx.match
   * @param {import('./ThinkBudget.js').ThinkBudget} [ctx.thinkBudget]
   *   What the frame costs without the search, so the slice can be sized against
   *   this machine rather than against a constant. Absent — every headless
   *   caller, `ai-harness.mjs` included — the planner falls back to the flat
   *   `ai.frameBudgetMs`, because there is no frame to measure and nothing to
   *   keep smooth.
   * @param {(cardId: string) => void} [ctx.onRevealCard]  start the flip animation
   * @param {() => boolean} [ctx.revealDone]
   */
  update(dt, ctx) {
    const { match } = ctx;
    if (this.phase === 'idle') return;

    // The turn was taken away underneath us — a card effect, a rebuild, the
    // match ending. Nothing to drive.
    if (match.state === MATCH_STATE.OVER) {
      this.cancel();
      return;
    }

    switch (this.phase) {
      case 'think':
        return this._think(ctx);
      case 'replan':
        return this._replan(ctx);
      case 'cardFx':
        // The game's own effect owns the screen. It ends when the match says so.
        if (match.state !== MATCH_STATE.CARD_FX) {
          this._replanned = false;
          this._enter('replan');
        }
        return;
      default:
        return this._advance(dt, ctx);
    }
  }

  // ── the search ────────────────────────────────────────────────────────────

  _think({ match, thinkBudget }) {
    const t0 = performance.now();
    const done = this.planner.tick(thinkBudget?.msFor(this.planner.tuning));
    this.thinkMs += performance.now() - t0;
    if (!done) return;

    const pick = this.planner.choose(this._shotSeed);
    if (!pick) {
      // Nothing to shoot with. `shooterFor` would have returned -1 and the match
      // would already be over, so this is the impossible branch — but a phase
      // machine that can get stuck is a game that hangs, so it ends the turn.
      console.warn('[ai] no candidate shot; passing the turn');
      this.cancel();
      return;
    }
    this.plan = pick;

    this._chooseCard(match);
  }

  /**
   * Ask for a card, and go and play it if one is wanted.
   *
   * ── called after EVERY plan, which is what makes a combo possible ─────────
   * `Match.playCard` returns the turn to AIM once a non-physical effect has run,
   * so several cards in one turn are legal — and the two that matter are
   * complementary: 강타 buys the reach to arrive, 궤적 removes the spread that
   * reach costs. Deciding once could never express that, because whether 궤적 is
   * worth playing is a question about the boosted shot, which does not exist
   * until 강타 has been played and the position re-planned.
   *
   * So the cycle is plan, decide, play, re-plan, decide again — capped by
   * `maxCardsPerTurn` so a hand full of cards cannot turn one turn into six
   * animations.
   */
  _chooseCard(match) {
    this.cardId = null;
    const cap = Math.max(0, Math.round(this.config.ai.cards.maxPerTurn));
    if (match.mode.cards !== false && this.cardsPlayed.length < cap) {
      const situation = this.planner.situation({
        hand: match.hands.get(this.player),
        usable: (id) => match.cards.usable(id, this.player),
        opponentHandCount: match.hands.count(1 - this.player),
      });
      if (situation) {
        const decision = decideCard(situation);
        // Appended rather than replaced, so the panel shows the whole turn's
        // reasoning including why the second card was or was not wanted.
        this.cardLog = this.cardLog.concat(decision.log);
        this.cardId = decision.cardId;
      }
    }

    if (this.cardId) this._enter('cardPull');
    else this._enter('gap');
  }

  /**
   * Search again, now that the card is in effect.
   *
   * Only 강타 changes the shot, and only 강타 needs this — but it is not
   * special-cased on the id. Two reasons: the check would be a second place that
   * knows which cards are physical, and it would be wrong the moment a card is
   * added.
   *
   * ── what IS asked is whether the search's own inputs moved ────────────────
   * The original cost of re-planning after all five was argued as free — "one
   * search under an effect animation that is already playing" — and that was
   * true when a search was 330 ms. It is not: `replan` is a phase of its own,
   * nothing is on screen for it, and a 강타+궤적 turn ran three back-to-back
   * searches with the player watching a still board through all of them.
   *
   * `AiPlanner.searchInputs` reads the four things the search consults about the
   * hand — the two multipliers, whether the cone is knowable, and whether the
   * boost probe runs. Unchanged means the second search would build the same
   * queue, step the same worlds and rank them the same way, which is what the
   * paragraph above already claimed happens for the other four cards. So it is
   * skipped rather than run and discarded, and a card that moves any of the four
   * — including one added later — re-plans exactly as it did before.
   */
  _replan(ctx) {
    const { match } = ctx;
    if (!this.planner.running && !this._replanned) {
      this._replanned = true;
      const inputs = this.planner.searchInputs(match, this.player);
      if (inputs === this._searchInputs) {
        // Nothing the search reads has moved. Keep the plan and go straight to
        // asking whether this position wants a SECOND card — which is the only
        // part of the re-plan that had anything left to do.
        return this._chooseCard(match);
      }
      this._searchInputs = inputs;
      this.thinkMs = 0;
      this.planner.begin({ match, player: this.player, shotSeed: this._shotSeed });
      return;
    }
    const t0 = performance.now();
    const done = this.planner.tick(ctx.thinkBudget?.msFor(this.planner.tuning));
    this.thinkMs += performance.now() - t0;
    if (!done) return;
    const pick = this.planner.choose(this._shotSeed);
    if (pick) this.plan = pick;
    // ...and ask whether the NEW position wants another card. This is the step
    // that turns 강타 into 강타 + 궤적.
    this._chooseCard(ctx.match);
  }

  // ── the presentation ─────────────────────────────────────────────────────

  _enter(phase) {
    this.phase = phase;
    this._t = 0;
    if (phase === 'aimHighlight') this.highlight = this.plan.shot.capIndex;
  }

  _advance(dt, ctx) {
    const { match } = ctx;
    const d = this._durations();
    this._t += dt;
    const span = Math.max(0.001, d[this.phase] ?? 0);
    const t = Math.min(1, this._t / span);

    // The card, on its way out of the fan and over. The renderer reads
    // `cardReveal` and draws it; nothing here touches a mesh.
    if (this.phase === 'aimDraw' || this.phase === 'aimHold') {
      this._writeAim(match, this.phase === 'aimHold' ? 1 : t);
    }

    if (t < 1) return;

    switch (this.phase) {
      case 'cardPull':
        return this._enter('cardMove');
      case 'cardMove':
        return this._enter('cardFlip');
      case 'cardFlip':
        return this._enter('cardHold');
      case 'cardHold': {
        /**
         * The card is played HERE, at the end of the hold, not at the start of
         * the animation.
         *
         * `Match.playCard` moves the match into CARD_FX and spends the card out
         * of the hand, and both of those are visible: the fan would re-close
         * around a gap while the card was still being turned over, and the
         * activation effect would fire under a card the player had not read yet.
         * Playing it once it has been read means the reveal and the effect are
         * one continuous sentence.
         */
        const played = match.playCard(this.cardId);
        if (played.ok) this.cardsPlayed.push(this.cardId);
        if (!played.ok) {
          // The rules refused it. `decideCard` filters on the same predicate, so
          // this means the position changed under the decision — report it and
          // carry on to the shot rather than losing the turn.
          console.warn(`[ai] "${this.cardId}" refused: ${played.reason}`);
          this.cardId = null;
          return this._enter('gap');
        }
        return this._enter('cardFx');
      }
      case 'gap':
        return this._enter('aimHighlight');
      case 'aimHighlight':
        return this._enter('aimDraw');
      case 'aimDraw':
        return this._enter('aimHold');
      case 'aimHold':
        return this._fire(match);
      default:
        return this.cancel();
    }
  }

  /**
   * The bow, part-drawn.
   *
   * ── it is the shot's own numbers, run backwards ────────────────────────────
   * The overlay wants a pull vector, and the plan has a direction and a power.
   * The pull is the direction reversed and scaled by how far through the draw we
   * are, so at t = 1 it is exactly the drag a human would have had to make to
   * fire this shot — same `maxPullDistance`, same clamp, same cone. The player
   * is watching the gesture they would have made.
   */
  _writeAim(match, t) {
    const shot = this.plan.shot;
    const cfg = this.config.shot;
    const full = cfg.maxPullDistance * Math.min(1, shot.power);
    const len = full * t;
    /**
     * Drawn along the INTENDED heading, not the fired one.
     *
     * Under 혼란 the two differ by up to 90°, and the shot's heading is the
     * deviated one. Drawing that would show the watching player exactly where a
     * confused shot is going — which is the information `AimOverlay` strips out
     * of a human's own aim for the same card, and would be a stranger thing to
     * leak from the opponent's side. It is also simply what the AI is doing: it
     * is pulling back to shoot THAT way and will find out the rest when it lets
     * go, exactly as the player does.
     *
     * ── except under 궤적, where aiming off IS the gesture ───────────────────
     * That card makes the AI pre-rotate its heading so the cone's draw cancels
     * (`AiPlanner._cancelDraw`), and the same numbers feed the long dashed
     * preview this card exists to show. Drawn from the intent, the preview
     * applied the deviation to a heading that had not had it removed, so the
     * dashed path left the board at an angle while the cap flew straight down
     * the intent — the two drawings visibly disagreeing with each other.
     *
     * So when the draw has been cancelled, the pull is drawn along the heading
     * actually fired. That is the honest picture and the same one a human with
     * 궤적 presents: aim deliberately off, and watch the preview bend back onto
     * the target. 혼란 cannot be in force at the same time — the game refuses
     * 궤적 under it — so the two rules never contend.
     */
    const dir = this.plan.precise ? shot : (this.plan.intent ?? shot);
    this.aim = {
      capIndex: shot.capIndex,
      dirX: dir.dirX,
      dirZ: dir.dirZ,
      power: shot.power * t,
      seed: shot.seed,
      impulseMul: shot.impulseMul,
      spreadMul: shot.spreadMul,
      smash: (shot.impulseMul ?? 1) !== 1 || (shot.spreadMul ?? 1) !== 1,
      pullX: -dir.dirX * len,
      pullZ: -dir.dirZ * len,
      clampedDistance: len,
      atClamp: false,
      armed: t > 0.05,
    };
  }

  _fire(match) {
    const shot = this.plan.shot;
    this.aim = null;
    this.highlight = -1;
    this.phase = 'idle';
    // The same call the router makes on a human's release. Everything after this
    // — the settle, the verdict, the elimination, the next turn — is the game's,
    // and has no idea a controller exists.
    match.fire(shot);
  }

  /**
   * Where the card reveal is, for the renderer. Null outside the card phases.
   *
   * `t` runs 0..1 within the current phase, so the view can drive a pull, a
   * glide and a flip off one object without knowing the phase order.
   */
  get cardReveal() {
    const d = this._durations();
    const phase = this.phase;
    if (phase !== 'cardPull' && phase !== 'cardMove' && phase !== 'cardFlip' && phase !== 'cardHold') {
      return null;
    }
    return {
      cardId: this.cardId,
      phase,
      t: Math.min(1, this._t / Math.max(0.001, d[phase] ?? 0)),
    };
  }
}

import { Rng, nextSeed } from '../../physics/rng.js';
import { Rollout } from './rollout.js';
import { aiTuning } from './strategy.js';
import { rotateY, shotSpread } from '../shot.js';
import { shapeAim } from '../AimInput.js';

/**
 * The search: candidates in, one shot out, spread across frames.
 *
 * ── it does not know which game it is searching ────────────────────────────
 * Everything below is candidate management: build a queue, roll each entry out a
 * chunk at a time, fold the probe and reply stages back in, rank. None of that
 * is survival, and none of it is football. What used to make this file
 * survival-only was four imported names — `survivalCandidates`,
 * `evaluateSurvival`, `dangerMap`, `exposureOf` — called by name, so the search
 * could only ever score caps falling off a board.
 *
 * They are behind an `AiStrategy` now, handed in and carried around. The context
 * it builds is OPAQUE here: exactly two fields of it are read below, `player`
 * and `precise`, and neither is a fact about the mode — one is whose turn it is
 * and the other is whether 궤적 is armed, which is this file's own business and
 * is written INTO the context on the way in. So football swaps in a different
 * evaluator, a different generator and a different notion of danger without a
 * line of this file knowing there is a ball. It is the same separation
 * `Controller` keeps from `Match`, one level down. See `strategy.js`.
 *
 * ── the budget is a CANDIDATE COUNT, and that is a determinism fix ──────────
 * The obvious design is a wall-clock deadline: evaluate until 700 ms is gone,
 * take the best found. It was built that way first and it is wrong, measurably:
 *
 *     pass A  evaluated 66 candidates -> cap 3, "attack:0", power 0.54
 *     pass B  evaluated 63 candidates -> cap 3, "attack:1", power 1.00
 *
 * Identical position, identical seed, different move — because how many
 * candidates fit in 700 ms depends on what else the machine was doing. That
 * makes the AI's play a function of frame timing, which means `?seed=` stops
 * reproducing a match, `Match.replayLastTurn` starts disagreeing with the turn
 * it is replaying, and the panel's determinism check reports solver failures
 * that are really an AI that changed its mind. The whole project rests on the
 * opposite of that.
 *
 * So `maxCandidates` is the budget and it is a fixed number: the same position
 * evaluates the same candidates in the same order and picks the same shot on
 * every machine and every replay. `frameBudgetMs` then controls only how many of
 * them are done per frame — it changes how long the search takes in wall clock,
 * never what it decides.
 *
 * `totalBudgetMs` survives as a SAFETY VALVE, not the normal path. At the
 * measured 14.5 ms a rollout the default count lands around 700 ms; the valve
 * sits far above that and exists so a pathologically slow device cannot hang the
 * turn. It logs when it trips, because a search cut short there HAS diverged and
 * that is worth knowing rather than absorbing quietly.
 *
 * ── the list is breadth-first, so the count buys plans not precision ────────
 * See `candidates.js`. Wave 0 is one shot at every option — every target, every
 * cap, plus the retreat — and later waves refine. Truncating at 48 therefore
 * still considers retreating; truncating an intent-ordered list did not.
 *
 * ── the slice is checked between rollouts, not inside one ───────────────────
 * A rollout is 95 steps of solver and cannot be suspended halfway without
 * keeping the world alive across frames, which is what `TrajectoryPreview` does
 * and what makes it complicated. Here a single rollout is ~14 ms and the frame
 * is ~16 ms, so the granularity is one candidate: the loop stops as soon as the
 * elapsed slice is spent, and a frame runs one rollout more than its budget
 * strictly allows. Under-running by a whole candidate instead would mean a 6 ms
 * budget never starts one at all.
 *
 * ── every random number here comes off the AI's own stream ──────────────────
 * "게임 시드를 소비하면 결정론이 깨진다", and this is exactly where it would
 * happen: the number of candidates evaluated depends on frame timing, so a
 * sampling draw against the global counter would advance it a different number
 * of times on every run and `?seed=` would stop reproducing anything.
 *
 * The stream is derived per turn from the match seed, so it is reproducible
 * without being shared: same match, same turn, same AI decisions, however many
 * candidates the machine got through.
 *
 * ── the AI MUST NOT know its own cone draw, and this is two stages because ──
 * The first version evaluated every candidate with the exact seed the shot would
 * fire with. That looked principled — it is what the human trajectory preview
 * does — and it is the one arrangement `predict.js` explicitly warns against:
 *
 *     seeing the actual draw in advance would let them aim off to cancel it,
 *     which is the same as having no error at all
 *
 * A human under 궤적 sees ONE shot's line and cannot re-roll it. A search sees
 * forty-eight, each with its own deviation, and simply keeps whichever one that
 * particular draw happens to suit. The heading never visibly moves, so it does
 * not look like cheating — it is selection rather than compensation — but the
 * effect is the same and it scales with the width of the cone. Which makes 강타
 * pure profit: 1.5x impulse, and the accuracy it is supposed to cost gets
 * selected away. Reported from play as "먼 거리에서 강타 쓰고 다 맞춘다", which is
 * exactly what it would look like.
 *
 * So:
 *
 *   STAGE 1  every candidate is rolled with the cone switched OFF — `spreadMul`
 *            0, which `shotSpread` turns into a zero half-angle and
 *            `aimAfterSpread` returns undeviated. This is the shot the AI
 *            INTENDS, and intent is what a player chooses between.
 *   STAGE 2  THE REPLY — the opponent's best answer to the shortlist, searched
 *            from the world each candidate leaves behind. Built for "몇 수 앞은
 *            볼 수 있게" and OFF by default: measured, it re-confirms what the
 *            cheap threat model already decided, at twice the cost. The numbers
 *            are in `config.ai.replyCandidates`.
 *   STAGE 3  optional and OFF by default: re-rolls through real cone draws,
 *            scored on the mean. Built to price the cone; it does not pay for
 *            itself — see `config.ai.robustnessSamples` for the numbers.
 *
 * The shot then fires with a seed drawn at commit time that nothing evaluated —
 * see `AiController`. The AI aims at what it wants and the cone decides, which
 * is the same deal the player gets.
 *
 * ── and it is worth saying what this did NOT fix ────────────────────────────
 * Measured after the change: the AI's chosen long-range 강타 shots still land
 * 88% of the draws it never saw. That rate is honest — those lines really are
 * robust — and the reason is in the GAME's numbers rather than the search.
 * `shotSpread` derives the cone from `power`, not from the delivered impulse, so
 * 강타 buys 50% more reach while the AI keeps shooting at power 0.54 where the
 * cone is only ±3.5°. Over 30 units that is ±1.8 units of lateral error against
 * a target on the rim, where a graze is enough.
 *
 * If the card should be less reliable at range, the levers are `smashSpreadMul`,
 * `spreadCurve` and `maxSpreadDeg` — all game balance, none of them this file's
 * to change — or `executionErrorDeg`, which is the AI-side dial the brief asks
 * to be left at 0 until the thing has been played against.
 */

export class AiPlanner {
  /**
   * @param {typeof import('../config.js').CONFIG} config
   * @param {import('./strategy.js').AiStrategy} [strategy]
   *   What game this is searching. Optional here and normally supplied per turn
   *   by `begin`, because the planner outlives a match and the MATCH is the
   *   authority on which mode is being played — a strategy fixed at construction
   *   would be the previous mode's after a rebuild.
   *
   *   Never defaulted to survival. A football turn searched with the knockout
   *   evaluator would score goals as caps falling off a board and look like a
   *   very bad AI rather than like a wiring mistake.
   */
  constructor(config, strategy = null) {
    this.config = config;
    this.strategy = strategy;

    /** @type {import('./candidates.js').Candidate[]} */
    this._queue = [];
    this._at = 0;
    /** @type {{candidate: object, score: number, terms: object, result: object}[]} */
    this.scored = [];
    this._ctx = null;
    this._rng = null;
    this._seed = 0;

    this.running = false;
    /** Wall-clock milliseconds spent in rollouts this turn. For the panel. */
    this.elapsedMs = 0;
    /** How many candidates were generated, and how many actually got run. */
    this.generated = 0;
    this.evaluated = 0;
  }

  /** How far through the queue, 0..1. Drives nothing; the panel draws it. */
  get progress() {
    return this._queue.length ? Math.min(1, this._at / this._queue.length) : 1;
  }

  /**
   * Open a search for the player whose turn it is.
   *
   * @param {object} opts
   * @param {import('../Match.js').Match} opts.match
   * @param {number} opts.player
   * @param {import('./strategy.js').AiStrategy} [opts.strategy]
   *   Which game to search. Omitted by `Controller._replan`, which is re-opening
   *   the SAME turn after a card and must not change what it is searching.
   */
  begin({ match, player, shotSeed = 0, strategy = null }) {
    this._shotSeed = shotSeed >>> 0;
    if (strategy) this.strategy = strategy;
    /**
     * No strategy means this mode has no computer opponent implemented.
     *
     * It should be unreachable — `main.js` refuses to build an `AiController`
     * for a mode whose `MODES.<mode>.ai` is not set, and a mode that sets it
     * without registering a strategy is a wiring mistake. Answered here rather
     * than left to crash on the first `this.strategy.buildContext`, because the
     * controller already knows what to do with a search that finds nothing: it
     * warns and passes the turn. A hang would be the worse failure.
     */
    if (!this.strategy) {
      console.warn('[ai] no strategy registered for this mode; the turn will pass');
      this._queue = [];
      this.scored = [];
      this._at = 0;
      // Zeroed rather than left stale: the panel reads these, and a counter from
      // the previous turn beside a search that never ran reads as a search that
      // ran and found nothing.
      this.generated = 0;
      this.evaluated = 0;
      this.dropped = 0;
      this.elapsedMs = 0;
      this.cutShort = false;
      this.running = false;
      return false;
    }
    /**
     * `config.ai`, with this mode's overrides folded in — see `aiTuning`.
     *
     * Held for the turn so every stage reads the same numbers, and IDENTICAL to
     * `this.config.ai` by object identity for a mode that overrides nothing. So
     * knockout's sliders stay as live as they were and its search reads exactly
     * what it read before this existed.
     */
    this._tuning = aiTuning(this.config, this.strategy.id);
    const cfg = this._tuning;
    const arena = match.arena;
    const rules = match.rules;

    /**
     * The AI's own stream, derived rather than drawn.
     *
     * Off the match seed and the turn number, so it reproduces from `?seed=`
     * alone and is untouched by how long the search ran. The mixing constant is
     * the golden-ratio one `Match.fire` already uses to derive the orb stream —
     * same idiom, different offset, so the two cannot line up.
     */
    this._rng = new Rng(
      (match.seed ^ Math.imul(rules.turn + 1, 0x9e3779b9) ^ 0x51ed2701) >>> 0,
    );

    /**
     * The card state, read live through `shapeAim`.
     *
     * Held as a reference rather than copied, and re-read per candidate, because
     * a re-plan after playing 강타 has to see the boost that was just armed —
     * see `AiController`, which plans, plays the card, and plans again.
     */
    this._cards = match.mode.cards === false ? null : match.cards;
    /**
     * 궤적, and what it actually buys.
     *
     * The card draws the exact path the shot will take, deviation included —
     * which `predict.js` says in as many words is "the same as having no error
     * at all", because a player who can see the draw aims off and cancels it.
     * That is the whole product: for one turn, the cone stops mattering.
     *
     * So when it is armed the search plans with the REAL seed and the real
     * spread, and skips the cone probe entirely. Everywhere else the AI is
     * blind to its draw and pays for its spread. This is the one place
     * clairvoyance is not cheating — it is the card being spent.
     *
     * ── these three MUST be computed before `_ctx` is built ──────────────────
     * `_ctx` copies `precise` and the probe stage reads it from there, so if the
     * assignment comes after the literal the copy holds the PREVIOUS turn's
     * value — the planner instance is long-lived and `begin` runs again on every
     * replan. That was a real bug: the turn 궤적 was played still ran the cone
     * probe and diluted the precision kill it had just paid for, and the turn
     * AFTER skipped the probe entirely and went back to rating a forty-unit full
     * charge as safely as a tap. Anything `_ctx` reads belongs above it.
     */
    this._precise = !!this._cards?.trajectoryOn(player);
    /** The card multipliers in force, read once. */
    this._mul = this._cards
      ? { impulse: this._cards.impulseMulFor(player), spread: this._cards.spreadMulFor(player) }
      : { impulse: 1, spread: 1 };

    /**
     * Everything the evaluator will need, gathered by the strategy.
     *
     * Opaque past this line. Two fields are read below — `player` and
     * `capOwner` — and both are facts about the match; the rest is a private
     * conversation between one mode's context builder and that mode's
     * evaluator. See `strategy.js`.
     */
    this._ctx = this.strategy.buildContext({
      match,
      player,
      arena,
      rules,
      config: this.config,
      // The merged block, so the turn has exactly one of it. A strategy that
      // re-merged for itself would be a second object that has to stay equal to
      // this one, and nothing would notice the day it did not.
      tuning: cfg,
      precise: this._precise,
    });

    this._snapshot = match.turnSnapshot;
    this._arena = arena;
    /**
     * Whether the boost probe is worth running at all.
     *
     * Held AND legal to play right now, asked of the game rather than decided
     * here — `usable` is the same predicate the human's hand greys itself with,
     * so a 강타 refused because one is already in effect stops the probe too.
     * Without this the search would spend `boostPool * 3` rollouts every turn
     * to evaluate a card the AI does not have.
     */
    this._canBoost =
      !!this._cards &&
      match.hands.get(player).some((c) => c.cardId === 'smash') &&
      this._cards.usable('smash', player).ok;
    this._orbs = match.orbs.list.map((o) => ({ id: o.id, x: o.x, z: o.z }));

    /**
     * Whatever the generator needs computed once per turn rather than per
     * candidate — it describes the board the AI is looking at, not any
     * particular move. Survival's is a danger map; a mode with nothing to
     * precompute returns null.
     */
    this.preTurn = this.strategy.preTurn(this._ctx);

    const all = this.strategy.candidates({
      ctx: this._ctx,
      orbs: this._orbs,
      preTurn: this.preTurn,
      sampling: cfg.sampling,
      config: this.config,
    });
    // Truncated HERE rather than by running out of time, so what gets considered
    // is a property of the config and not of the machine. See the header.
    const kept = all.slice(0, Math.max(1, Math.round(cfg.sampling.maxCandidates)));
    this.dropped = all.length - kept.length;
    /**
     * Stage 1: the INTENDED shot, cone switched off.
     *
     * `spreadMul: 0` rather than a flag on `resolveImpulse` — `shot.js` records
     * that the "leave the cone out" branch was deliberately removed and that
     * there is one code path and one answer. Zeroing the multiplier goes through
     * that one path and comes out undeviated, so nothing there has to change.
     */
    this._queue = kept.map((candidate, i) => ({
      candidate,
      // Under 궤적 the shot IS knowable, so plan the one that will fire.
      seed: this._precise ? this._shotSeed : 0,
      spreadMul: this._precise ? null : 0,
      order: i,
    }));

    this._samplePath = cfg.showCandidates ? Math.max(1, Math.round(cfg.candidateSampleEvery)) : 0;
    this._stepChunk = Math.max(1, Math.round(cfg.stepChunk));
    this._maxSteps = Math.max(30, Math.round(cfg.maxRolloutSteps));
    this._live?.free();
    this._live = null;
    /** 1 = intent, blind to the cone. 2 = the best few, sampled through it. */
    this._stage = 1;

    this._at = 0;
    this.scored = [];
    this.elapsedMs = 0;
    this.generated = all.length;
    this.evaluated = 0;
    this.cutShort = false;
    this.running = this._queue.length > 0;
    return this.running;
  }

  /**
   * Spend one frame's slice on the search.
   *
   * @returns {boolean} true once the search has finished or run out of time
   */
  tick() {
    if (!this.running) return true;
    const cfg = this._tuning;
    const frameBudget = Math.max(0.5, cfg.frameBudgetMs);
    const totalBudget = Math.max(1, cfg.totalBudgetMs);

    const sliceStart = performance.now();
    const t0 = sliceStart;

    while (this._at < this._queue.length || this._live) {
      if (performance.now() - sliceStart >= frameBudget) break;
      /**
       * The safety valve, and it reports itself.
       *
       * Tripping this means the search did NOT evaluate its configured
       * candidate list, so this turn's decision is not the one another machine
       * would make — the determinism the count-based budget exists to give is
       * broken for exactly this turn. That is the right trade against hanging,
       * and it is worth a line in the console rather than being absorbed.
       */
      if (this.elapsedMs >= totalBudget) {
        console.warn(
          `[ai] search cut short at ${this.elapsedMs.toFixed(0)} ms — ` +
            `${this._at} of ${this._queue.length} candidates evaluated. ` +
            'This turn is not reproducible; lower ai.sampling.maxCandidates.',
        );
        this.cutShort = true;
        break;
      }

      if (!this._live) {
        const job = this._queue[this._at++];
        this._liveJob = job;
        this._live = new Rollout({
          // A reply is planned from the world THIS candidate leaves behind, not
          // from the turn's own snapshot.
          snapshot: job.reply ? job.entry.result.snapshot : this._snapshot,
          arena: this._arena,
          orbs: job.reply ? [] : this._orbs,
          shot: this._shotFor(job.candidate, job.seed, job.spreadMul, job.reply, job.aimOffset, job.boost),
          config: this.config,
          // Only a first-ply candidate that might reach the second one needs a
          // world kept: replies are leaves and nothing plans from them.
          keepSnapshot: !job.reply && !job.probe && cfg.replyCandidates > 0,
          // Bounds a pathological turn. See `config.ai.maxRolloutSteps`.
          maxSteps: this._maxSteps,
          // Only while the panel is drawing them. Latched at `begin` rather than
          // read here, so a switch flipped mid-search cannot leave half the
          // candidates with a path and half without.
          // Stage 2 re-rolls candidates that already have a path from stage 1,
          // and the path worth drawing is the INTENDED one — see `_finishStage1`.
          samplePath: this._stage === 1 ? this._samplePath : 0,
        });
      }

      /**
       * Stepped in CHUNKS, so a frame can end in the middle of a candidate.
       *
       * This is the difference between the search costing 10 ms of solver in
       * some frames and costing at most `stepChunk` steps in every frame. The
       * chunk is a step count rather than a time slice because steps are the
       * unit that is actually uniform — a time-sliced inner loop would have to
       * call `performance.now()` per step, and the measurement would cost a
       * noticeable fraction of the thing being measured.
       *
       * It changes nothing about the answer. The same world takes the same
       * steps in the same order; only the wall clock they are spread over moves,
       * which is the identical argument `TrajectoryPreview` makes for slicing
       * the human preview.
       */
      if (this._live.advance(this._stepChunk)) {
        const result = this._live.result;
        const job = this._liveJob;
        this._live = null;
        this.evaluated++;
        if (job.reply) {
          /**
           * Scored from the OPPONENT's seat, and only the best kept.
           *
           * The opponent is assumed to find their strongest answer — the
           * pessimistic assumption, which is the right one to plan against.
           * Taking a mean would let a move that hands them one devastating
           * reply hide behind nine bad ones they would never choose.
           */
          /**
           * Only the KILLS are kept, not the reply's whole score.
           *
           * ── subtracting the full reply turtled the AI, twice ──────────────
           * The first version took the opponent's best reply score off mine.
           * That is textbook minimax and it is wrong at this search width:
           * after ANY committal move the opponent has some decent answer, so
           * every attack was penalised and standing still was not. Measured
           * over five matches against a fixed opponent: zero caps taken, versus
           * six at one ply. It is the same failure `foeThreat` produced — a
           * term that rewards not committing.
           *
           * What the position actually needs to know is narrower and much less
           * noisy: does this move let them KILL something. That is the thing
           * worth flinching from, it is nearly binary, and ten reply candidates
           * estimate it far better than they estimate a positional score.
           */
          const { terms } = this.strategy.evaluate(result, job.entry.replyCtx);
          const kills = this.strategy.replyPenalty(terms);
          if (job.entry.replyBest === null || kills > job.entry.replyBest) {
            job.entry.replyBest = kills;
          }
        } else if (job.boost) {
          /**
           * The same shot as 강타 would fire it. Kept apart from the cone probe
           * and NOT folded into the score: this candidate is being evaluated as
           * it will actually be played, which is unboosted. What the boost costs
           * or buys is a question for the card policy alone.
           *
           * Centre first, then the two edges — `_applyProbes` reads the order.
           */
          const { terms } = this.strategy.evaluate(result, this._ctx);
          job.entry.boostKills.push(this.strategy.netGain(terms));
        } else if (job.probe) {
          // One edge of this candidate's cone. Folded in by `_applyProbes`.
          const { score, terms } = this.strategy.evaluate(result, this._ctx);
          job.entry.probeScores.push(score);
          job.entry.probeKills.push(this.strategy.netGain(terms));
        } else {
          const { score, terms, meta } = this.strategy.evaluate(result, this._ctx);
          this.scored.push({ candidate: job.candidate, score, terms, meta, result, order: job.order });
        }
      }

      // Each stage feeds the next, inside the loop so one frame can cross a
      // boundary rather than idling at it.
      if (this._at >= this._queue.length && !this._live) {
        if (this._stage === 1) this._finishStage1();
        else if (this._stage === 2) this._finishStage2();
      }
    }

    this.elapsedMs += performance.now() - t0;

    if ((this._at >= this._queue.length && !this._live) || this.cutShort) {
      this.running = false;
      /**
       * The safety valve exits with a rollout still in flight, and that rollout
       * owns a Rapier world.
       *
       * The ordinary exit cannot: it requires `!this._live`. `cutShort` has no
       * such condition — it fires mid-candidate by design — so this path used to
       * return with a live `World` held, and nothing freed it until the NEXT
       * `begin`. WASM linear memory is invisible to the collector, so that is a
       * whole physics world retained across the shot, the settle and the
       * opponent's turn. `Rollout.free` is idempotent, so freeing here is a
       * no-op on the path that reached this line with nothing in flight.
       */
      this._live?.free();
      this._live = null;
      // A search that ended early may never have reached the probe stage.
      this._applyProbes();
      this._applySamples();
      /**
       * Ranked, with the QUEUE ORDER as the tie-break.
       *
       * Ties are common and not exotic: two mirrored angles at the same power
       * that both miss everything score identically to the last bit. Left to the
       * engine, `Array.sort` resolves those however its implementation happens
       * to, and the move played would vary between browsers on positions where
       * nothing distinguishes the options. Falling back to the order the
       * breadth-first generator produced makes the answer a property of the
       * position.
       */
      /**
       * Reply-searched candidates rank ABOVE everything else, always.
       *
       * ── mixing the two scales was a bug, and a measurable one ─────────────
       * Only the shortlist gets a reply subtracted; the rest keep their raw
       * first-ply score. Sorted together those are two different quantities, and
       * the arithmetic goes exactly the wrong way: the real contenders are the
       * ones dragged down by their replies, so a candidate ranked sixth at ply
       * one — never examined, never penalised — floats to the top. The AI then
       * plays a move that neither search endorsed.
       *
       * Measured against a fixed opponent over ten matches: one ply took 5 caps
       * and lost 6; two plies with the scales mixed took 2 and won nothing. The
       * lookahead was not wrong, the comparison was.
       *
       * So the searched pool is chosen from on its own. It is the top few by
       * first-ply score examined more deeply, which is what a shortlist is for —
       * and an unexamined candidate can no longer win by not having been looked
       * at.
       */
      this.scored.sort(
        (a, b) =>
          (b.searched ? 1 : 0) - (a.searched ? 1 : 0) ||
          b.score - a.score ||
          a.order - b.order,
      );
      return true;
    }
    return false;
  }

  /**
   * Rank on INTENT, then queue the best few to be tried through the cone.
   *
   * ── the pool is small on purpose ─────────────────────────────────────────
   * Sampling every candidate would be the thorough answer and costs
   * `samples x candidates` rollouts — at the measured 10 ms each, three samples
   * over forty candidates is 1.2 s of solver for a turn that is meant to feel
   * immediate. It is also mostly wasted: the cone cannot rescue a move that was
   * bad as an intention, so paying to find out precisely how bad it is buys
   * nothing. What matters is choosing between the handful of moves that are
   * genuinely in contention, and that is what this pays for.
   */
  /**
   * Rank on intent, then ask what the OPPONENT does about it.
   *
   * ── one ply cannot see a cap die, and that is the whole failure ───────────
   * Everything above scores the board the instant this shot settles. A cap that
   * grabs an orb and comes to rest on the rim with nobody currently in range
   * scores well: the orb is worth 30, and `selfThreat` sees no enemy inside
   * `reach`, so the danger reads as zero. Next turn the opponent walks up and
   * pushes it off, and from the outside the AI looks like it traded a cap for a
   * card on purpose — "오브 먹으면 죽는데 오브 먹으려고 목숨을 희생해".
   *
   * No amount of tuning fixes that, because the information is not in the
   * position — it is in the reply. So the shortlist is played out and the
   * opponent's best answer is searched from the world each shot leaves behind,
   * and its value comes off the score. A move that hands the opponent a kill is
   * now worth what it is actually worth.
   *
   * ── it also replaces the proxy that went wrong ────────────────────────────
   * `foeThreat` was an attempt to price "I am in position to kill next turn"
   * without searching for it, and it was farmable: hovering at range scored
   * without ever committing, and the AI turtled — measured at 0 kills across ten
   * matches. A reply search cannot be farmed that way, because it asks what
   * actually happens rather than what the geometry suggests.
   *
   * ── the pool is small, because the second ply is the expensive one ────────
   * Every entry costs `replyCandidates` rollouts. Five entries at ten replies is
   * fifty rollouts on top of the first ply's thirty-odd — about 0.8 s measured,
   * which fits under the card animation and the gap that follow it.
   */
  _finishStage1() {
    const cfg = this._tuning;
    this.scored.sort((a, b) => b.score - a.score || a.order - b.order);

    /**
     * ── the shortlist is re-shot at the EDGES of its own cone ───────────────
     * Stage 1 aims with the cone switched off, which is right — the AI must not
     * see its draw. But "does not see the draw" was implemented as "does not
     * see the cone AT ALL", and those are very different things. A player who
     * cannot predict their error still knows they HAVE one, and knows it grows
     * with the draw: that is why nobody full-charges at a cap forty units away.
     *
     * Blind to both, the search rated a long full-power shot exactly as
     * reliable as a short gentle one — the line is perfect when the deviation
     * is zero — and took it. Reported from play as "너무 멀면 오차가 심해지는데
     * 그거 생각 안 하고 멀어도 풀차징해서 혼자 죽는다". Exactly right, and it
     * follows from the blind stage rather than from any weight.
     *
     * So every shortlisted shot is fired twice more, rotated to each edge of the
     * cone it would actually be drawn from. Three samples of a uniform
     * distribution at its two ends and its middle, which is a crude quadrature
     * and a very good discriminator: a shot whose success needs the middle
     * sample loses two thirds of its value, and a shot that works across the
     * whole cone keeps all of it. Power now costs what it should.
     *
     * The EDGES rather than random draws, deliberately. Three random seeds gave
     * a noisy estimate that mis-ranked good shots — measured, and it is why the
     * sampling this replaces defaulted to off. The extremes are deterministic,
     * they bracket the outcome, and they cost the same two rollouts.
     *
     * Skipped entirely under 궤적. See `_ctx.precise`.
     */
    const probes = this._ctx.precise ? 0 : Math.max(0, Math.round(cfg.spreadProbes));
    const pool = this.scored.slice(0, Math.max(0, Math.round(cfg.spreadPool)));
    const jobs = [];

    for (const entry of pool) {
      entry.blindScore = entry.score;
      entry.blindKills = this.strategy.netGain(entry.terms);
      entry.probeScores = [entry.score];
      entry.probeKills = [this.strategy.netGain(entry.terms)];
      if (probes < 1) continue;

      const half = shotSpread(
        {
          power: entry.candidate.power,
          impulseMul: this._mul.impulse,
          spreadMul: this._mul.spread,
        },
        this.config.shot,
      );
      if (half <= 1e-4) continue;
      for (const sign of [-1, 1]) {
        jobs.push({
          candidate: entry.candidate,
          entry,
          seed: 0,
          spreadMul: 0,
          aimOffset: sign * half,
          order: entry.order,
          probe: true,
        });
      }
    }

    /**
     * ── and the same shortlist again, as 강타 would fire it ──────────────────
     * "would this card open a kill I cannot otherwise get" is a question about
     * physics, and the honest way to answer it is to simulate the boosted shot.
     * It used to be answered by a proxy, `reachShortfall`, and that proxy was
     * measured to be meaningless: it read how close to the rim the nearest enemy
     * was left standing, which is a fact about the BOARD. With two caps parked
     * near a corner it sat at 0.068 at every range from 16 to 48 units, so 강타
     * was spent at 40, 44 and 48 — losing the shooter every time — and held at
     * 24 through 36 where it would have arrived.
     *
     * Three rollouts per entry, at the boosted cone's centre and both edges, so
     * the two answers the card policy needs come out separately: a kill at both
     * edges is one 강타 alone can land, a kill only down the middle is one that
     * needs 궤적 with it. That combination is the long-range finisher, and it is
     * now found by simulating it rather than inferred.
     *
     * Skipped when 강타 is not held — `boostPool` rollouts are not worth
     * spending to evaluate a card the AI cannot play.
     */
    const boostPool = this._canBoost
      ? this.scored
          // Which intents are ATTACKS is the mode's answer, not this file's:
          // survival's are `attack:`/`drive:`, football's aim at a ball.
          .filter((e) => this.strategy.isAttack(e.candidate))
          .slice(0, Math.max(0, Math.round(cfg.boostPool)))
      : [];

    for (const entry of boostPool) {
      entry.boostKills = [];
      const half = shotSpread(
        {
          power: entry.candidate.power,
          impulseMul: this._mul.impulse * this.config.cards.smashImpulseMul,
          spreadMul: this._mul.spread * this.config.cards.smashSpreadMul,
        },
        this.config.shot,
      );
      for (const off of [0, -half, half]) {
        jobs.push({
          candidate: entry.candidate,
          entry,
          seed: 0,
          spreadMul: 0,
          aimOffset: off,
          order: entry.order,
          probe: true,
          boost: true,
        });
      }
    }

    this._stage = 2;
    this._queue = jobs;
    this._at = 0;
  }

  /**
   * Queue the reply search, once the cone probe has settled the ranking.
   *
   * Ordered after the probe rather than instead of it: which candidates deserve
   * a reply search depends on which ones survive their own cone, and asking the
   * opponent about a shot that will not land is wasted solver.
   */
  _finishStage2() {
    const cfg = this._tuning;
    this._applyProbes();
    this.scored.sort(
      (a, b) => (b.searched ? 1 : 0) - (a.searched ? 1 : 0) || b.score - a.score || a.order - b.order,
    );

    const replies = Math.max(0, Math.round(cfg.replyCandidates));
    const pool = this.scored.slice(0, Math.max(0, Math.round(cfg.replyPool)));
    const jobs = [];

    for (const entry of pool) {
      const snap = entry.result.snapshot;
      if (!snap || replies < 1) continue;

      /**
       * The board this shot leaves, seen from the other seat.
       *
       * Built by the strategy because what "the board changed" MEANS is the
       * mode's business: survival has to strike the caps this shot pushed off
       * out of `alive`, and football has to carry the ball to where it stopped.
       * Getting the second one wrong is silent — the opponent's answer would be
       * planned against a ball that has not moved yet — which is why it is one
       * named method rather than a spread and two overrides at the call site.
       */
      const replyCtx = this.strategy.replyContext(this._ctx, entry.result);
      if (!this.strategy.hasReply(replyCtx)) continue;

      const list = this.strategy
        .candidates({
          ctx: replyCtx,
          // An orb this shot already collected is not there to be run at again.
          orbs: this._orbs.filter((o) => !entry.result.orbTouched.some((t) => t.id === o.id)),
          preTurn: this.strategy.preTurn(replyCtx),
          sampling: cfg.sampling,
          config: this.config,
        })
        .slice(0, replies);

      entry.replyCtx = replyCtx;
      entry.replyBest = null;
      for (let i = 0; i < list.length; i++) {
        jobs.push({ candidate: list[i], entry, seed: 0, spreadMul: 0, order: i, reply: true });
      }
    }

    this._stage = 3;
    this._queue = jobs;
    this._at = 0;
  }

  /**
   * Fold the cone probes into each shortlisted candidate's score.
   *
   * The MEAN across the three samples, because the deviation is uniform across
   * the cone and every part of it is equally likely — `aimAfterSpread` draws
   * uniformly on purpose so that the cone drawn on the board is the exact set of
   * places the shot can go. A worst-case rule would refuse every shot with any
   * spread on it, which on a game where power buys reach means never shooting
   * hard at all.
   *
   * `robustKills` is the separate, harsher question the card policy asks: does
   * the kill survive the WHOLE cone, or only its middle? A kill that needs the
   * middle is what 궤적 is for.
   *
   * ── all of these counters are NET, opponent caps minus own ────────────────
   * They were raw kill counts, and every card rule built on them fired on a
   * 1-for-1 trade: a shot that takes one and throws one away scored `1`, so
   * "a kill exists" was true and the AI spent 강타 and 궤적 to reach a move
   * worth −40. Observed in play as a cap traded for a cap and two cards.
   *
   * As a net, a trade reads `0` and buys no card, while a clean take reads `1`.
   * That is what "a kill is available" was always supposed to mean.
   */
  _applyProbes() {
    for (const entry of this.scored) {
      /**
       * The boost probe, read the same way as the cone probe but kept out of
       * `score`: centre first, then the two edges. A kill at every sample is one
       * 강타 can land on its own; a kill at the centre only is one that needs
       * 궤적 alongside it.
       */
      if (entry.boostKills && entry.boostKills.length === 3) {
        entry.boostRobust = Math.min(...entry.boostKills);
        entry.boostBlind = entry.boostKills[0];
      }
      if (!entry.probeScores || entry.probeScores.length < 2) continue;
      let sum = 0;
      for (const v of entry.probeScores) sum += v;
      entry.score = sum / entry.probeScores.length;
      entry.robustKills = Math.min(...entry.probeKills);
      entry.searched = true;
    }
  }

  /**
   * Charge the second ply against the candidates that got one.
   *
   * ── it used to average random cone samples too, and that code was dead ─────
   * `entry.samples` was never assigned by anything, so the averaging branch here
   * could not run and `robustnessSamples`/`robustnessPool` were dials that moved
   * a number nobody read. The job they were meant to do is done properly by the
   * cone probe in `_applyProbes`, which fires the shot at the two EDGES of its
   * own cone rather than at random draws from inside it — deterministic, and a
   * better discriminator for the same two rollouts.
   */
  _applySamples() {
    const w = Math.max(0, this._tuning.replyWeight);
    for (const entry of this.scored) {
      /**
       * A cap the opponent can kill next turn, priced at what losing one costs.
       *
       * `replyBest` is now a KILL COUNT rather than a score — see the reply
       * scoring above for why the full score turtled the AI twice. Multiplying
       * it by `loseOwn` puts the second ply on the same scale as the first: a
       * move that hands them a cap is worth what losing that cap is worth,
       * discounted by how much the sample is trusted.
       *
       * A reply that merely improves their position now costs nothing at all,
       * which is the point. Attacking is supposed to be worth doing.
       */
      if (entry.replyBest !== null && entry.replyBest !== undefined) {
        entry.intentScore = entry.score;
        entry.replyKills = entry.replyBest;
        entry.score -= w * entry.replyBest * this.strategy.replyUnit(this._tuning.weights);
        entry.searched = true;
      }
    }
  }

  /**
   * A candidate as a shot record the sim will accept — cards included.
   *
   * ── the AI is subject to the cards, and this is where that happens ────────
   * `shapeAim` is the same function `AimInput` runs a human's drag through, so
   * 혼란 twists the AI's heading and 강타 boosts its impulse and widens its cone
   * exactly as they would a person's. Skipping it was the obvious shortcut and
   * would have made both cards silently mode-dependent: a 혼란 played on the AI
   * would deviate nothing at all, which reads as the card being broken.
   *
   * It matters to the SEARCH and not only to the shot. A candidate evaluated
   * without the twist is not the shot that will fire, so under 혼란 the AI would
   * be planning against a heading it is not going to take — picking moves that
   * are excellent for an aim it has been denied. Shaping here means the search
   * plans with the deviation, which is the only honest way to play under it.
   *
   * ── and 혼란 is NOT known while choosing ─────────────────────────────────
   * `twist: false`. An earlier version shaped every candidate fully, on the
   * reasoning that a human under 혼란 sees their twisted arrow and so the AI may
   * too. That reasoning was simply wrong about the game: `AimOverlay` blinds a
   * confused player completely — no arrow, no cone, no path — and says why, at
   * length, in its header. The deviation is a hash of the aim BUCKET, so anyone
   * who can see it can sweep until it flatters them, and the card is undone.
   *
   * Shaping the candidates therefore handed the AI the one thing the card exists
   * to take away, and 혼란 became free. The twist is applied once, at commit, in
   * `choose` — the AI aims where it meant to and finds out afterwards.
   *
   * @param {number} seed  the cone's draw. Irrelevant when `spreadMul` is 0.
   * @param {number|null} spreadMul
   *   `0` for a stage-1 intent shot, which `shotSpread` turns into a zero
   *   half-angle so `aimAfterSpread` returns the aim undeviated. `null` for the
   *   real cone the cards have decided on.
   */
  _shotFor(candidate, seed, spreadMul, reply = false, aimOffset = 0, boost = false) {
    // A reply is the OPPONENT shooting, so their card state decides its
    // multipliers — and 혼란 is left out of both for the reason above.
    const seat = reply ? 1 - this._ctx.player : this._ctx.player;
    /**
     * `aimOffset` is how the cone is PROBED.
     *
     * A rotation applied to the heading, with `spreadMul` still zero, rather
     * than trying to coax `aimAfterSpread` into producing a particular
     * deviation — which cannot be done exactly, since the draw comes from
     * hashing a seed and no seed yields exactly +1. Rotating by the half-angle
     * and leaving the cone off puts the shot precisely at the edge of where it
     * could have gone. See `_finishStage1`.
     */
    const dir = aimOffset ? rotateY(candidate.dirX, candidate.dirZ, aimOffset) : null;
    const s = shapeAim(
      this._cards,
      seat,
      dir ? dir.x : candidate.dirX,
      dir ? dir.z : candidate.dirZ,
      { twist: false },
    );
    /**
     * `boost` is the 강타 probe: the shot as it WOULD be with the card played.
     *
     * The multipliers are taken from the card's own config rather than restated,
     * so a re-tuned 강타 re-tunes the probe with it. Both of them, not just the
     * impulse — a boost probe that ignored the wider cone would recommend the
     * card for exactly the shots it makes unlandable.
     */
    const cards = this.config.cards;
    const impulse = boost ? s.impulseMul * cards.smashImpulseMul : s.impulseMul;
    const spread = spreadMul === null || spreadMul === undefined ? s.spreadMul : spreadMul;
    const shot = {
      capIndex: candidate.capIndex,
      dirX: s.dirX,
      dirZ: s.dirZ,
      power: candidate.power,
      seed: seed >>> 0,
      impulseMul: impulse,
      spreadMul: boost ? spread * cards.smashSpreadMul : spread,
    };
    // Under 궤적 the heading is pre-rotated so the draw cancels. Everywhere else
    // `_cancelDraw` is the identity — the AI is blind and pays for its spread.
    const aimed = this._cancelDraw(shot.dirX, shot.dirZ, shot);
    shot.dirX = aimed.x;
    shot.dirZ = aimed.z;
    return shot;
  }

  /**
   * Aim off by the draw, so the shot arrives where it was pointed. 궤적 only.
   *
   * ── seeing the deviation is not the same as beating it ────────────────────
   * The card was implemented as "plan with the real seed", which made the AI
   * SEE its deviated path — and that alone made things worse, not better. The
   * candidate generator produces intended headings, so with the real cone in
   * play every one of them was evaluated as its deviated self, and the kill the
   * blind search had found simply vanished. Measured: at 28 units the AI spent
   * 강타 AND 궤적 and then fired a move it had itself scored at zero kills.
   *
   * `predict.js` describes what the card actually does — a player who reads the
   * preview "would let them aim off to cancel it, which is the same as having no
   * error at all". Aiming off is the half that was missing. The deviation is a
   * pure function of the seed and the cone's half-angle, both known here, so it
   * is subtracted from the heading before firing and `aimAfterSpread` rotates it
   * straight back onto the intended line.
   *
   * Shared by `_shotFor` and `choose` deliberately: the search must evaluate
   * precisely the shot that will be fired, and two copies of this arithmetic
   * would eventually disagree by an angle nobody could find.
   */
  _cancelDraw(dirX, dirZ, shot) {
    if (!this._precise) return { x: dirX, z: dirZ };
    const half = shotSpread(shot, this.config.shot);
    if (half <= 0) return { x: dirX, z: dirZ };
    return rotateY(dirX, dirZ, -(new Rng(shot.seed).signed() * half));
  }

  /**
   * The chosen shot, once the search is done.
   *
   * ── the pick is not always the maximum, and that is a slider ────────────────
   * "상위 후보 중 가중 랜덤 선택 옵션도 슬라이더로 두되, 기본은 최선 후보 실행."
   * At `pickRandomness` 0 this returns the top of the list and draws nothing at
   * all — the AI is exactly as strong as its evaluation function. Above 0 it
   * softmaxes over the top few, which is how the thing is made beatable without
   * making it stupid: a weaker pick among GOOD moves still plays a good move,
   * whereas adding aim error makes it play bad moves badly.
   *
   * ── and the execution error is applied AFTER the pick ───────────────────────
   * "AI는 최고 실력 플레이어를 상정한다. 기본 오차 주입값은 0이다." So at the
   * default this is a no-op and the shot fired is the shot evaluated, byte for
   * byte. Above zero the heading is twisted after the decision is made, which is
   * the honest shape of a human failing to execute what they intended — as
   * opposed to intending something worse.
   *
   * The charge cone is NOT this. That is the game's own error, it is already in
   * `resolveImpulse` via the seed drawn in `begin`, and it applies to the AI
   * untouched.
   *
   * @param {number} shotSeed
   *   The cone's draw, from the controller. Deliberately NOT known to anything
   *   above — no candidate was evaluated against it, so the AI is picking an
   *   intention and then finding out what the cone does with it, exactly as a
   *   player does. See the header.
   * @returns {{shot: import('../shot.js').Shot, entry: object}|null}
   */
  choose(shotSeed) {
    if (!this.scored.length) return null;
    const cfg = this._tuning;

    let entry = this.scored[0];
    const randomness = Math.max(0, Math.min(1, cfg.pickRandomness));
    if (randomness > 0) {
      const topN = Math.max(1, Math.round(cfg.pickPoolSize));
      const pool = this.scored.slice(0, topN);
      // Shifted so the worst of the pool sits at zero: raw scores are signed and
      // a negative weight is not a probability.
      const floor = pool[pool.length - 1].score;
      let total = 0;
      const weights = pool.map((e) => {
        const w = Math.pow(Math.max(1e-6, e.score - floor + 1e-3), 1 / randomness);
        total += w;
        return w;
      });
      let roll = this._rng.float() * total;
      for (let i = 0; i < pool.length; i++) {
        roll -= weights[i];
        if (roll <= 0) {
          entry = pool[i];
          break;
        }
      }
    }

    const c = entry.candidate;
    let { dirX, dirZ } = c;
    const errDeg = Math.max(0, cfg.executionErrorDeg);
    if (errDeg > 0) {
      const twist = this._rng.signed() * ((errDeg * Math.PI) / 180);
      const d = rotateY(dirX, dirZ, twist);
      dirX = d.x;
      dirZ = d.z;
    }

    /**
     * Shaped LAST, and after the execution error rather than before it.
     *
     * The order is the same one a human goes through: where they actually aimed
     * is the input, and the cards act on that. Twisting first and then adding the
     * AI's own error would let the two partially cancel, which would make 혼란
     * weaker against a sloppy AI than against a precise one — the opposite of
     * what the card does.
     *
     * At the default `executionErrorDeg` of 0 the heading fired is the heading
     * the search chose. What it is NOT is the outcome the search saw: the cone
     * has yet to have its say, and `shotSeed` is what decides it.
     */
    /**
     * The twist lands HERE and nowhere earlier.
     *
     * Everything above chose between intentions; this is where 혼란 takes the
     * shot away, once, on the heading that was already settled. The AI cannot
     * react to it because there is nothing left to decide.
     */
    const s = shapeAim(this._cards, this._ctx.player, dirX, dirZ);

    return {
      entry,
      /**
       * What the AI MEANT, kept alongside what it will do.
       *
       * The turn's pull animation is drawn from this rather than from the shot,
       * because the shot's heading carries the 혼란 deviation and drawing it
       * would put the deviation on screen — handing the watching player the
       * information the card denies its victim, from the other side. It is also
       * the truer picture of the gesture: this is the shot the AI is taking.
       */
      intent: { dirX, dirZ },
      /**
       * Whether the heading was aimed off to cancel the draw. 궤적 only.
       *
       * The presentation needs it: with the draw cancelled, the pull must be
       * drawn along the FIRED heading or the card's own dashed preview — which
       * re-applies the deviation — ends up pointing somewhere the cap will not
       * go. See `AiController._writeAim`.
       */
      precise: !!this._precise,
      shot: (() => {
        const shot = {
          capIndex: c.capIndex,
          dirX: s.dirX,
          dirZ: s.dirZ,
          power: c.power,
          seed: shotSeed >>> 0,
          impulseMul: s.impulseMul,
          spreadMul: s.spreadMul,
        };
        // The same cancellation the search evaluated. See `_cancelDraw`.
        const aimed = this._cancelDraw(shot.dirX, shot.dirZ, shot);
        shot.dirX = aimed.x;
        shot.dirZ = aimed.z;
        return shot;
      })(),
    };
  }

  /** The top N scored candidates, for the panel's trajectory overlay. */
  top(n) {
    return this.scored.slice(0, Math.max(0, n));
  }

  /**
   * What the card policy needs to know about this turn, from the search.
   *
   * Built here rather than inside the policy because it is all derived from the
   * evaluated candidates, and the policy has deliberately never seen a rollout —
   * that is what keeps it a set of readable thresholds rather than a second
   * evaluator. `null` before the search has run.
   *
   * @param {{hand: object[], usable: Function, opponentHandCount: number}} extra
   */
  situation(extra) {
    if (!this.scored.length) return null;
    /**
     * Handed straight to the strategy, which fills in the mode's own reasons.
     *
     * `decideCard` is unchanged and stays unchanged: the five cards are the same
     * five in both modes and the judgements about WHEN to spend them — a kill
     * that needs precision, an opponent worth disrupting, a hand worth sealing —
     * are the same shape. What differs is what "a kill" is, and that is a field
     * in here rather than a branch in there.
     *
     * The probe results the policy reads (`boostRobust`, `robustKills`,
     * `blindKills`) are attached to the entries by `_applyProbes` above, so the
     * strategy reads them off `scored` rather than being handed a second copy.
     */
    return this.strategy.situation({
      ctx: this._ctx,
      scored: this.scored,
      precise: !!this._precise,
      tuning: this._tuning.cards,
      extra,
    });
  }

  cancel() {
    this.running = false;
    this._queue = [];
    this._at = 0;
    this.scored = [];
    // The one in flight is a live `RAPIER.World`. Abandoning it without freeing
    // is a WASM leak the GC cannot see — see `Rollout.free`.
    this._live?.free();
    this._live = null;
  }
}

/**
 * What the search needs to know that is different per mode, as one object.
 *
 * ── the planner is the SEARCH, and a search has no opinions about football ───
 * `AiPlanner` does four things: it builds a queue, it rolls candidates out a
 * chunk at a time, it folds the probe and reply stages back in, and it ranks.
 * Not one of those is survival-specific. What was survival-specific was six
 * imported names — `survivalCandidates`, `evaluateSurvival`, `dangerMap`,
 * `exposureOf` — reached for directly, which meant the file could only ever
 * search one game.
 *
 * So they move behind an object the planner is HANDED. It carries the strategy
 * around and never looks inside it, exactly as `Controller` carries a `Match`
 * around without knowing what a `Match` does. That is the same discipline stated
 * twice, and it is what makes a third mode a new file rather than a new branch.
 *
 * ── `buildContext` is opaque ON PURPOSE ─────────────────────────────────────
 * The planner holds `_ctx` and passes it to `evaluate`, `preTurn`, `candidates`
 * and `situation`, and it reads exactly two fields out of it: `player`, to know
 * whose cards to shape the shot with, and `precise`, which it put there itself.
 * Everything else is a private conversation between one strategy's context
 * builder and that same strategy's evaluator. Survival puts `safeRadius` and
 * `threat` in it; football puts goal mouths and a ball radius. Neither has to
 * know the other exists, and the planner cannot tell them apart.
 *
 * ── this file holds no game logic and must not acquire any ──────────────────
 * It is a typedef and a registry. Every line of judgement lives in a strategy
 * module, so the question "why did the AI do that" has exactly one file to open.
 */

/**
 * @typedef {object} AiStrategy
 *
 * @property {string} id
 *   The mode key this plays. Diagnostics only — nothing branches on it.
 *
 * @property {(o: {match: object, player: number, arena: object, rules: object,
 *   config: object}) => object} buildContext
 *   Everything the evaluator will need, gathered once per turn. Survival's is
 *   `safeRadius`, `threat` and `alive`; football's is goal mouths, the ball's
 *   radius and the pitch's dimensions. Handed the merged `tuning` (see
 *   `aiTuning`) so the turn does one merge, and `precise` — whether 궤적 is armed
 *   — which the planner reads back out and nothing else may interpret.
 *
 *   Two fields are required of every context because the planner itself uses
 *   them: `player` and `precise`. The rest is the strategy's own.
 *
 * @property {(o: object) => import('./candidates.js').Candidate[]} candidates
 *   The ordered candidate list for one turn, wave-sorted and ready to truncate.
 *   Handed the context, the shooters, the pre-turn value below and
 *   `config.ai.sampling`.
 *
 * @property {(result: object, ctx: object) => {score: number,
 *   terms: Record<string, number>, meta: object}} evaluate
 *   What one rolled-out candidate is worth from `ctx.player`'s seat. `terms` is
 *   not optional — see `evaluate.js` on why the breakdown is the only debugging
 *   surface a search has.
 *
 * @property {(terms: Record<string, number>) => number} replyPenalty
 *   What to subtract for the opponent's best answer, read off THEIR terms.
 *   Survival counts the caps they take; football counts the goals they score.
 *
 *   Deliberately not "their whole score". Subtracting that is textbook minimax
 *   and it turtled the survival AI to zero kills in ten matches — after any
 *   committal move the opponent has some decent answer, so every attack was
 *   penalised and standing still was not. See `AiPlanner._applySamples`.
 *
 * @property {(weights: object) => number} replyUnit
 *   What one unit of `replyPenalty` is worth on the first ply's scale, read off
 *   the merged `config.ai.weights`. Survival prices a lost cap; football prices
 *   a goal conceded. It is what puts the second ply on the first's scale.
 *
 * @property {(ctx: object, result: object) => object|null} replyContext
 *   The board this candidate leaves, seen from the other seat. What "the board
 *   changed" MEANS is the mode's business: survival strikes the caps this shot
 *   pushed off out of `alive`, football carries the BALL to where it will be
 *   when the next turn opens. Getting the second one wrong is silent — the
 *   opponent's answer would be planned against a ball that has not moved.
 *
 *   `null` refuses the reply search entirely, which football does after a goal
 *   because the field is about to be reset out from under it.
 *
 * @property {(replyCtx: object|null) => boolean} hasReply
 *   Whether that position is worth searching. Must accept `null`.
 *
 * @property {(terms: Record<string, number>) => number} netGain
 *   The NET a card rule may call "a kill", opponent's loss minus my own.
 *   Survival's is caps, football's is goals. A shot that takes one and throws
 *   one away reads 0 and buys no card — see `AiPlanner._applyProbes`, where
 *   spending two cards to reach a 1-for-1 trade is recorded as the bug this
 *   arithmetic fixed.
 *
 * @property {(candidate: object) => boolean} isAttack
 *   Which candidates are worth re-firing as 강타 would fire them. The intents
 *   are the generator's own vocabulary, so only the strategy can read them.
 *
 * @property {(o: {ctx: object, scored: object[], precise: boolean,
 *   tuning: object, extra: object}) => object} situation
 *   The summary `cardPolicy.decideCard` reads. Same five cards in both modes and
 *   `decideCard` has no mode branch — what differs is what fills the fields, so
 *   "is a kill available" becomes "is a goal available" without that file
 *   knowing there is a ball. The probe results the policy reads (`boostRobust`,
 *   `robustKills`, `blindKills`) are attached to the `scored` entries by
 *   `AiPlanner._applyProbes`.
 *
 * @property {(ctx: object) => any} preTurn
 *   Computed once per turn and handed to `candidates` — it describes the board
 *   the AI is looking at rather than any particular move. Survival's is the
 *   danger map. Null is a legitimate answer.
 */

/**
 * `config.ai` as this mode sees it: the common block with its overrides folded in.
 *
 * ── a mode with no overrides gets the SAME OBJECT back, by identity ─────────
 * That is not an optimisation, it is the guarantee that the survival AI did not
 * change when this was introduced. `config.ai` is LIVE — the tuning panel writes
 * into it while a match is running, and `AiPlanner` re-reads it every frame —
 * so returning a merged COPY for knockout would silently freeze every slider at
 * whatever it read when the turn opened. Knockout registers no overrides, this
 * returns `config.ai` itself, and every read downstream is the read it always
 * was.
 *
 * Football does get a copy, and so its sliders land on the next turn rather than
 * mid-search. That is the correct trade for the mode that needs the overrides,
 * and it is worth knowing rather than discovering.
 *
 * ── why the overrides exist at all ─────────────────────────────────────────
 * The two modes are not the same size of problem. Football is 4v4 plus a ball —
 * nine bodies against knockout's six — its turns settle differently, and its
 * weights are in different units entirely (`goal` against `dropOpponent`, world
 * units of ball travel against squared edge fractions). Sharing one `weights`
 * block would mean every survival number acquiring a second, unrelated meaning.
 *
 * Nested one level, because that is how deep `config.ai` goes. A general deep
 * merge would silently accept a typo'd path and produce a config nobody wrote.
 *
 * ── `show` is restored from the base and cannot be overridden ──────────────
 * The reveal timings are the one part of `config.ai` that is not search tuning:
 * they are how long the AI's turn takes to WATCH, and "연출이 넉아웃과 동일하게
 * 진행" is a requirement rather than a default. A mode that set them would give
 * its opponent a different rhythm from the same opponent in the next mode, for
 * no reason a player could see. Written as an explicit restore rather than left
 * to nobody-happening-to-set-it, so the guarantee is in the code.
 *
 * @param {typeof import('../config.js').CONFIG} config
 * @param {string} strategyId
 */
export function aiTuning(config, strategyId) {
  const base = config.ai;
  const over = base.perMode?.[strategyId];
  if (!over) return base;
  return {
    ...base,
    ...over,
    sampling: { ...base.sampling, ...over.sampling },
    weights: { ...base.weights, ...over.weights },
    cards: { ...base.cards, ...over.cards },
    threat: { ...base.threat, ...over.threat },
    show: base.show,
  };
}

/** @type {Map<string, AiStrategy>} */
const REGISTRY = new Map();

/**
 * Register a strategy under a mode key.
 *
 * Called by the strategy modules themselves at import, so adding a mode is
 * adding a file and importing it — there is no central list here to forget to
 * update, and no way to ship a strategy that nothing can reach.
 *
 * @param {AiStrategy} strategy
 */
export function registerStrategy(strategy) {
  REGISTRY.set(strategy.id, strategy);
}

/**
 * The strategy for a mode, or null if that mode has no computer opponent.
 *
 * ── null is a real answer and callers must respect it ───────────────────────
 * `MODES.<mode>.ai` is what the MENU reads to decide whether to offer the row,
 * and this is what the search would need to honour it. The two are kept
 * separate because they answer different questions — one is a product decision
 * about what to show, the other is whether the code exists — but a mode that
 * claims `ai: true` with nothing registered here would build a planner that
 * cannot generate a single candidate, and the turn would simply never end.
 *
 * @param {{key?: string}|string} mode  a mode object or its key
 * @returns {AiStrategy|null}
 */
export function strategyFor(mode) {
  const key = typeof mode === 'string' ? mode : mode?.key;
  return REGISTRY.get(key) ?? null;
}

/** Which modes have a strategy. For diagnostics and the panel. */
export function registeredStrategies() {
  return [...REGISTRY.keys()];
}

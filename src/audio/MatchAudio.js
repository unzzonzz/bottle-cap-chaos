import { MATCH_STATE } from '../game/Match.js';
import { VICTORY_STAGE } from '../victory/VictoryClock.js';
import { ContactAudio } from './ContactAudio.js';

/**
 * The game page's ears.
 *
 * ── it POLLS, and that is the house style rather than a shortcut ────────────
 * Nothing in `src/game/**` emits a callback, on purpose: the layer states what
 * happened and the render layer decides what to do about it. So this reads the
 * same plain fields the renderer reads — `match.state`, `match.lastVerdict`,
 * `rules.score`, `cards.log` — and diffs them frame to frame, exactly as
 * `CardFx._wasSmashing` and `HudLayer._pulseKey` already do.
 *
 * ── the three diffing rules, learned from the existing bugs ─────────────────
 *   BOOLEANS AND STRINGS, never object identity. `match.cardFx` builds a fresh
 *     object on every read; a `!==` test on it is true every frame, which once
 *     left the whole screen inverted for the length of an effect.
 *   IDENTITY on the records that ARE freshly allocated per event —
 *     `match.lastTurn` and `match.lastVerdict` — because those are the only
 *     honest edges for "a shot was fired" and "a turn was judged".
 *   COUNTERS for anything that can happen more than once between two frames.
 *     Up to twelve physics steps run inside one render frame, so several orb
 *     pickups, several house changes and a turn end can all land together.
 *
 * ── what is NOT polled ─────────────────────────────────────────────────────
 * Two things arrive by other routes because polling them would be wrong rather
 * than merely awkward. Card plays come through the `cardused` window event that
 * `main.js` already dispatches. Orb pickups are handed in through `notePickups`,
 * because `drainEvents()` is DESTRUCTIVE and `main.js` already calls it — a
 * second call would steal the pickup from the orb burst and the card flight.
 *
 * ── it never writes ────────────────────────────────────────────────────────
 * Every field read here is read-only, the randomness is the audio stream's, and
 * the only physics calls are queries. A match played with the sound off and a
 * match played with it on produce the same hashes.
 */

/** Which effect sound belongs to which card. */
const CARD_FX_SOUND = {
  trajectory: 'card_fx_trajectory',
  chaos: 'card_fx_chaos',
  onemore: 'card_fx_onemore',
  smash: 'card_fx_smash',
  resist: 'card_fx_resist',
  swap: 'card_fx_swap',
};

/** States in which bodies move under their own power, so contacts are real. */
const PHYSICAL = new Set([MATCH_STATE.LIVE, MATCH_STATE.GOAL_HOLD]);

export class MatchAudio {
  /**
   * @param {import('./AudioSystem.js').AudioSystem} audio
   * @param {typeof import('../game/config.js').CONFIG} config
   * @param {import('../game/Match.js').Match} match
   */
  constructor({ audio, config, match, input, router, cards, hud, victory }) {
    this.audio = audio;
    this.config = config;
    this.match = match;
    this.input = input;
    this.router = router;
    this.cards = cards;
    this.hud = hud;
    this.victory = victory;

    this.contacts = new ContactAudio(config.audio);

    /** Scratch for the frame's impacts, reused so a frame allocates nothing. */
    this._impacts = [];
    /**
     * The caps that took a hit this frame. Read by `CardFx`, for 철벽's ring.
     *
     * A Set rather than a list, because the only question asked of it is
     * membership, once per braced cap per frame.
     */
    this.struckCaps = new Set();
    /** Whether `observe` has already run for this frame. See `update`. */
    this._observed = false;

    this._onCardUsed = () => this._cardUsed();
    window.addEventListener('cardused', this._onCardUsed);

    this.reset();
  }

  /**
   * Forget every diff, and re-seed the ones that must not fire on the way in.
   *
   * ── this is the single most important method in the file ────────────────
   * Everything here works by comparing this frame against the last one, and a
   * REBUILD is the one event that makes "the last one" describe a different
   * match. `rebuildAll` in `main.js` throws the whole world away — new rules,
   * new bodies, new handles, the score back to zero — and an observer that kept
   * its counters would announce the difference between two unrelated matches.
   *
   * The failure is not subtle and it is not rare. Restart a football match won
   * 3-1 and the first turn of the new one plays the full goal fanfare, because
   * `rules.score` is `[0, 0]` and the observer still remembers `[3, 1]`. It
   * cannot be caught by the verdict path either: `Match.start` nulls
   * `lastVerdict`, so the restart frame returns early and never washes the stale
   * value out.
   *
   * ── seeded from the NEW match, not zeroed ───────────────────────────────
   * The distinction matters per field. `_score`, `_wins`, `_draws` and `_thrown`
   * are read from the fresh rule set so the reset itself is not a change.
   * `_dealt` is deliberately emptied instead: curling deals its first cap inside
   * `Match.start`, and seeding from the new `rules.dealt` would swallow the very
   * first `curl_deploy` of every match. `_upSign` is rebuilt from the caps'
   * actual orientations, because a cap that ended the last match face-down would
   * otherwise register a flip the moment the new one stands it up.
   */
  reset() {
    const match = this.match;
    const rules = match?.rules;

    this._state = match?.state ?? null;
    /**
     * The state the CONTACT DETECTOR last looked in. A second latch, and it has
     * to be a second one: `_state` is read in `update`, and the detector is read
     * in `observe`, which runs earlier in the frame — see the note there. One
     * latch shared between them would be flipped by whichever ran first and the
     * other would never see the transition.
     */
    this._contactState = match?.state ?? null;
    this._lastTurn = match?.lastTurn ?? null;
    this._verdict = match?.lastVerdict ?? null;
    this._fxCard = null;

    this._score = Array.isArray(rules?.score) ? rules.score.slice() : [0, 0];
    this._wins = Array.isArray(rules?.wins) ? rules.wins.slice() : [0, 0];
    this._draws = typeof rules?.draws === 'number' ? rules.draws : 0;
    this._thrown = Array.isArray(rules?.thrown) ? rules.thrown.slice() : [0, 0];
    // Emptied, not seeded. See the note above.
    this._dealt = [];

    this._orbIds = new Set((match?.orbs?.list ?? []).map((o) => o.id));
    this._chaos = [false, false];

    this._victoryStage = VICTORY_STAGE.IDLE;
    this._victoryActive = false;
    this._victoryHover = null;

    this._aiming = false;
    this._cardHover = [null, null];
    this._cardDragging = false;
    this._cardMode = [null, null];
    this._cardArmed = false;
    this._cardRefused = false;
    // A Map keyed by card OBJECTS, which are destroyed and rebuilt on every
    // deal. Cleared rather than pruned, or it holds every card the match ever
    // drew for as long as the page is open.
    this._cardShake = new Map();
    this._cardKeys = [new Set(), new Set()];

    this._upSign = this._readUpSigns();
    this._fallen = new Set();

    this.contacts.reset();
    // A rebuild is a turn boundary too — and the strongest one there is. See
    // the note on `ContactAudio._chain` for why this is a second call.
    this.contacts.resetChain();
    this.audio.stopLoops(0.04);
  }

  /** Which way up every cap is right now, as +1 / -1 per cap. */
  _readUpSigns() {
    const t = this.match?.arena?.currTransforms;
    const caps = this.match?.arena?.capCount ?? 0;
    const out = [];
    for (let i = 0; i < caps; i++) {
      if (!t || (i + 1) * 7 > t.length) {
        out.push(1);
        continue;
      }
      const o = i * 7;
      const qx = t[o + 3];
      const qz = t[o + 5];
      // The body's +y axis, rotated. Only its y component decides which way up.
      const upY = 1 - 2 * (qx * qx + qz * qz);
      out.push(upY >= 0 ? 1 : -1);
    }
    return out;
  }

  dispose() {
    window.removeEventListener('cardused', this._onCardUsed);
    this.audio.stopLoops(0.05);
  }

  /**
   * Orb events, handed in rather than drained.
   *
   * `main.js` owns the one call to `drainEvents()` and feeds the burst and the
   * card flight from it. This gets the same array. A refusal carries `full:
   * true` and has no card and no flight — see `Orbs.step`.
   */
  notePickups(picked) {
    if (!picked) return;
    for (const ev of picked) {
      if (ev.full) this.audio.play('orb_refused');
      else this.audio.play('orb_pickup');
    }
  }

  /** One render frame, after everything else has written its state. */
  /**
   * Look at the world. Play nothing.
   *
   * ── split out so the collision signal has ONE source ──────────────────────
   * `ContactAudio` is the only thing in the project that detects a collision —
   * there is no `EventQueue` anywhere, deliberately and permanently, and
   * `ContactAudio`'s own header explains at length why the two read-only routes
   * it combines are the whole of what is available. 철벽's ring has to flash on
   * the frame a braced cap is hit, and a second detector built for it would be a
   * second answer to the same question: the day the two disagreed, the sound and
   * the flash would land on different frames and there would be no way to say
   * which one was wrong.
   *
   * So the detection runs HERE, before `CardFx.update` in the frame, and both
   * the sound and the ring read what it found. It must run exactly once a frame
   * — `collect` diffs velocities against the last time it looked, and calling it
   * twice would hand the second call a zero delta — which is what the latch
   * below is for: whichever of `observe` and `update` comes first does the
   * looking, and `update` clears the latch on the way out.
   *
   * Still strictly read-only. Every call it makes is a query, its randomness is
   * its own stream, and a match played with the sound off produces the same
   * hashes as one played with it on.
   */
  observe() {
    const match = this.match;
    if (!match || this._observed) return;
    this._observed = true;

    /**
     * The detector's own state gate, asked HERE rather than in `_updateState`.
     *
     * Contacts are only meaningful while bodies move under their own power. A
     * swap card and a ball respawn drive them KINEMATICALLY, so the velocities
     * are commanded rather than solved and diffing across the boundary produces
     * a phantom impact large enough to clip.
     *
     * It used to live in `_updateState`, which was fine while the collect was
     * the last thing in the frame — the reset ran first and the collect found a
     * cold detector. Now that the collect runs before `update` at all, leaving
     * the gate there would let a transition frame be collected and PLAYED before
     * anything reset it.
     */
    const state = match.state;
    if (state !== this._contactState) {
      const from = this._contactState;
      this._contactState = state;
      if (!PHYSICAL.has(state) || !PHYSICAL.has(from)) this.contacts.reset();
    }

    const impacts = this._impacts;
    impacts.length = 0;
    this.contacts.collect(match, impacts);

    this.struckCaps.clear();
    // Only while bodies are moving under their own power. Outside that the
    // collect above is a re-sample rather than a reading — see `_updateBoard`.
    if (PHYSICAL.has(match.state)) {
      for (const hit of impacts) {
        if (hit.capA >= 0) this.struckCaps.add(hit.capA);
        if (hit.capB >= 0) this.struckCaps.add(hit.capB);
      }
    }
  }

  update(dt) {
    const match = this.match;
    if (!match) return;

    this._updateState(match);
    this._updateShot(match);
    this._updateVerdict(match);
    if (match.mode?.key === 'curling') this._updateCurling(match);
    this._updateCards(match);
    this._updateOrbs(match);
    this._updateBow();
    this._updateVictory();
    this._updateBoard(match, dt);
    // Armed for the next frame. `observe` runs first when the caller asks for
    // it and falls through to `_updateBoard` here when nobody does.
    this._observed = false;
  }

  // ── the turn ──────────────────────────────────────────────────────────────

  _updateState(match) {
    const state = match.state;
    if (state === this._state) return;
    const from = this._state;
    this._state = state;

    // The contact detector's own reset used to be here and has moved to
    // `observe`, which now runs before this does. See the note there.

    if (state === MATCH_STATE.AIM) this._fallen.clear();

    // The hold is entered only when the goal delay is non-zero; a goal can
    // happen with no GOAL_HOLD frame at all, which is why the GOAL itself is
    // detected from the score and not from here.
    if (state === MATCH_STATE.GOAL_HOLD) this.audio.play('goal_hold_start');
    if (from === MATCH_STATE.GOAL_HOLD) this.audio.play('goal_hold_end');

    if (state === MATCH_STATE.CARD_FX) {
      const fx = match.cardFx;
      const id = fx ? CARD_FX_SOUND[fx.cardId] : null;
      this._fxCard = fx?.cardId ?? null;
      if (id) this.audio.play(id);
    } else {
      this._fxCard = null;
    }
  }

  /** A shot. `lastTurn` is a fresh object per fire, so identity is the edge. */
  _updateShot(match) {
    const turn = match.lastTurn;
    if (turn === this._lastTurn) return;
    this._lastTurn = turn;
    if (!turn?.shot) return;
    /**
     * The collision chain starts over here, and this is the only place that can
     * say so — `ContactAudio.reset()` fires on kinematic transitions in the
     * middle of a turn and would restart the scale mid-rally. A fresh
     * `lastTurn` object is the one honest "a shot was fired" edge in the whole
     * match state, which is why the shot sound already keys off it.
     */
    this.contacts.resetChain();
    const shot = turn.shot;
    // The 0..1 pull power, not `lastResolved.power` — that one is an impulse
    // magnitude in g·cm/s and would saturate the intensity mapping instantly.
    const power = Math.max(0, Math.min(1, shot.power ?? 0));
    const smash = (shot.impulseMul ?? 1) !== 1;
    this.audio.play('bow_fire', {
      intensity: power,
      gain: smash ? 1.15 : 1,
    });
  }

  _updateVerdict(match) {
    const v = match.lastVerdict;
    if (v === this._verdict) return;
    this._verdict = v;
    if (!v) return;

    const curling = match.mode?.key === 'curling';

    if (v.eliminated?.length) {
      // The same field means two different events, and only the mode tells them
      // apart: a knockout cap has fallen off the table, a curling stone has
      // crossed a line. `ko_last` is the one that ends the match.
      const last = v.winner !== null && v.winner !== undefined;
      if (curling) this.audio.play('curl_overshoot');
      else this.audio.play(last ? 'ko_last' : 'ko_out');
    }

    if (v.reason === 'timeout') this.audio.play('turn_timeout');

    // A ball going out is not announced, and neither is it being put back —
    // the throw-in and the corner are both silent on the player's instruction.

    this._updateFootball(match);
  }

  _updateFootball(match) {
    const score = match.rules?.score;
    if (!Array.isArray(score)) return;
    const changed = score[0] !== this._score[0] || score[1] !== this._score[1];
    this._score = [score[0], score[1]];
    if (!changed) return;
    // From the SCORE, not from the state: the goal hold is skipped entirely
    // when its length is zero, and `goalPending` is only ever populated under
    // the non-default `ballStop` timing.
    this.audio.play('goal');
    this.audio.play('score_tick', { when: 0.16 });
  }

  /**
   * Curling, polled every frame rather than judged at the verdict.
   *
   * All three of these move at moments that are not a verdict: the next cap is
   * dealt inside `_beginAim`, which is a state change, and the round bookkeeping
   * is written inside `resolveTurn` — before `lastVerdict` is assembled and
   * published. Reading them off the verdict would report the deploy not at all.
   *
   * ── the pair used to be the house count; it is the ROUND now ─────────────
   * `curl_house_in` and `curl_house_out` are a deliberately symmetric pair — the
   * same two-step figure, one rising and one inverted — so whatever they are
   * attached to has to resolve to a DIRECTION rather than to a bare "something
   * changed", or the falling one becomes dead. The mode no longer has a house to
   * count, and the event that fits the pair is the round finishing: somebody
   * took it, or nobody did. Four of those a match, which is also the budget
   * "과하게 하지 마라" allows.
   */
  _updateCurling(match) {
    const rules = match.rules;

    // A cap placed at the throw spot. `alive` moves in BOTH directions in this
    // mode — false->true on a deploy, true->false when a cap falls or when the
    // round's table is swept — so `dealt`, which never goes back, is the only
    // unambiguous witness of a cap arriving.
    const dealt = rules?.dealt;
    if (Array.isArray(dealt)) {
      for (let i = 0; i < dealt.length; i++) {
        if (dealt[i] && !this._dealt[i]) this.audio.play('curl_deploy');
      }
      this._dealt = dealt.slice();
    }

    const wins = rules?.wins;
    const draws = rules?.draws;
    if (Array.isArray(wins) && typeof draws === 'number') {
      const wonBefore = this._wins[0] + this._wins[1];
      const wonAfter = wins[0] + wins[1];
      const drewBefore = this._draws;
      this._wins = [wins[0], wins[1]];
      this._draws = draws;
      if (wonAfter > wonBefore) this.audio.play('curl_house_in');
      else if (draws > drewBefore) this.audio.play('curl_house_out');
    }

    const thrown = rules?.thrown;
    if (Array.isArray(thrown)) {
      const changed = thrown[0] !== this._thrown[0] || thrown[1] !== this._thrown[1];
      this._thrown = [thrown[0], thrown[1]];
      if (changed) this.audio.play('curl_throws');
    }
  }

  // ── cards ─────────────────────────────────────────────────────────────────

  /**
   * The `cardused` window event `main.js` already dispatches.
   *
   * The one existing custom event in the project, fired on the render frame from
   * inside the hand's own callback — so listening to it needs no change to any
   * game file at all.
   */
  _cardUsed() {
    this.audio.play('card_use');
  }

  _updateCards(match) {
    const cards = this.cards;

    // Curling switches the whole system off. The layer early-returns and its
    // hover state is cleared, so everything below goes quiet on its own — but
    // the held loops have to be told.
    if (!cards || match.mode?.cards === false) {
      this.audio.setLoop('chaos_loop', { on: false });
      return;
    }

    for (const hand of cards.hands) {
      const p = hand.player;

      const hovered = hand.hovered;
      if (hovered !== this._cardHover[p]) {
        this._cardHover[p] = hovered;
        if (hovered) this.audio.play('card_hover');
      }

      /**
       * `dragMode` is undefined before the first drag, null inside the
       * deadzone, then LOCKED to a string until release — at which point
       * `endDrag` nulls it again.
       *
       * Only a non-null value is stored, and that is the whole point: the
       * release clears it on the same frame the drag ends, so a spring-back
       * sound that read the field after the fact would always find null and
       * never fire. This holds the last thing the gesture committed to until
       * the release has been dealt with.
       */
      const mode = hand.dragMode ?? null;
      if (mode && mode !== this._cardMode[p]) {
        const before = this._cardMode[p];
        this._cardMode[p] = mode;
        if (mode === 'sort' && before !== 'sort') this.audio.play('card_sort');
      }

      // The refusal shake is the only signal a blocked card gives; `endDrag`
      // returns null for a refusal, a cancel and a sort alike.
      for (const c of hand.cards) {
        const was = this._cardShake.get(c) ?? 0;
        if (c.shake > was + 0.5) {
          this.audio.play('card_refused');
          // Latched for this frame so the release below cannot ALSO play the
          // spring-back. One gesture, one sound: a refusal and a return
          // together is the flam the per-pair dedupe exists to prevent
          // everywhere else.
          this._cardRefused = true;
        }
        if (c.shake > 0) this._cardShake.set(c, c.shake);
        else this._cardShake.delete(c);
      }

      /**
       * A found card arriving in the fan.
       *
       * By key-set diff, the same idiom the orbs use — `CardHand.syncTo` has an
       * `arrived` list but it is local to that call, and there is no event. The
       * key is stable for the life of an instance, so a card that merely moved
       * slot does not re-announce itself.
       */
      const keys = new Set();
      let arrived = 0;
      for (const c of hand.cards) {
        keys.add(c.key);
        if (!this._cardKeys[p].has(c.key)) arrived++;
      }
      // Only on the frame something appeared, and never on the first sync of a
      // fresh hand — `reset` seeds the sets, so a re-deal is silent.
      if (arrived && this._cardKeys[p].size) this.audio.play('card_land');
      this._cardKeys[p] = keys;
    }

    const dragging = !!cards.dragging;
    if (dragging !== this._cardDragging) {
      this._cardDragging = dragging;
      if (dragging) this.audio.play('card_drag');
      else this._checkCardReturn();
    }

    // Armed is force-cleared every frame for any card that is not being
    // dragged, so it must be read off the dragged card alone or it retriggers.
    const held = cards.hands.find((h) => h.dragging)?.dragging ?? null;
    const armed = !!held?.armed;
    if (armed !== this._cardArmed) {
      this._cardArmed = armed;
      if (armed) this.audio.play('card_arm');
    }

    // The stun hum, held while anybody is confused. `CardFx` polls exactly this
    // to decide which caps wear stars.
    const effects = match.cards;
    let chaos = false;
    for (let p = 0; p < 2; p++) {
      const on = !!effects?.chaosOn?.(p);
      if (on) chaos = true;
      this._chaos[p] = on;
    }
    this.audio.setLoop('chaos_loop', {
      on: chaos,
      gain: Math.max(0, this.config.audio.chaosGain ?? 0.3),
    });
  }

  /**
   * A card let go under the threshold.
   *
   * Inferred rather than reported: `endDrag` gives back null for a return, a
   * cancel and a sort, and only the return should spring. So a drag that ended
   * in 'use' mode without arming and without shaking is one.
   */
  _checkCardReturn() {
    // Read, then cleared unconditionally: the gesture is over either way, and a
    // mode left behind would make the NEXT release sound like this one.
    let wasUse = false;
    for (const hand of this.cards.hands) {
      if (this._cardMode[hand.player] === 'use') wasUse = true;
      this._cardMode[hand.player] = null;
    }
    // Armed at the moment of release means it was PLAYED — `card_use` has
    // already sounded through the `cardused` event — and a spring-back on top
    // of it would describe a card that did not come back.
    //
    // Refused means the shake has already spoken for this gesture. A card
    // dragged to the top and turned away DOES spring home, so the animation is
    // the same — but the player asked one question and must get one answer.
    const refused = this._cardRefused;
    this._cardRefused = false;
    if (this._cardArmed || refused || !wasUse) return;
    this.audio.play('card_return');
  }

  // ── orbs ──────────────────────────────────────────────────────────────────

  /**
   * Spawns, by id-set diff — there is no event for one.
   *
   * `maybeSpawn`'s return value is discarded by `Match._endTurn`, so the list is
   * the only witness. The same idiom `OrbView` uses. Only ADDITIONS are read
   * here: an orb leaving the list is a pickup (already sounded through
   * `notePickups`) or a kickoff clearing one the new formation stands on, which
   * is a bookkeeping correction and not an event.
   */
  _updateOrbs(match) {
    const list = match.orbs?.list;
    if (!list) return;
    let spawned = 0;
    const live = new Set();
    for (const orb of list) {
      live.add(orb.id);
      if (!this._orbIds.has(orb.id)) spawned++;
    }
    this._orbIds = live;
    if (spawned) this.audio.play('orb_spawn');

    // And nothing at all while they sit there — the idle bed is gone. See the
    // note in `soundBank`.
  }

  // ── the bow ───────────────────────────────────────────────────────────────

  /**
   * The bow: two moments, and nothing in between.
   *
   * ── the bed and the clamp blip were removed on instruction ─────────────
   * There was a held tone whose pitch rode the pull distance in both
   * directions, and a two-note blip when the pull reached the clamp. Both were
   * built, both worked, and both were taken out after the player heard them.
   *
   * The reason is worth keeping: aiming is not an event in this game, it is the
   * RESTING STATE — a turn is mostly spent with the bow drawn. A sound that
   * holds for the whole of it is a sound that plays for most of the match, and
   * the clamp blip fires again every time a pull wobbles across the threshold,
   * which a hand holding a full-power shot does constantly.
   */
  _updateBow() {
    const p = this.input?.preview ?? null;
    const aiming = !!p;
    if (aiming === this._aiming) return;

    this._aiming = aiming;
    if (aiming) this.audio.play('bow_start');
    // A release that fired is `bow_fire`'s, not a cancel. The two are told
    // apart by whether a new turn record exists, because a release below the
    // deadzone takes the identical code path as a real shot.
    else if (!this._firedThisFrame()) this.audio.play('bow_cancel');
  }

  /** Did the shot that just ended the aim actually fire? */
  _firedThisFrame() {
    return this.match.lastTurn === this._lastTurn && this.match.state !== MATCH_STATE.AIM;
  }

  // ── the victory screen ────────────────────────────────────────────────────
  //
  // ── nothing sounds on hover any more ──────────────────────────────────
  // The HUD's buttons and this screen's both used to click quietly when the
  // pointer crossed them. Removed on the player's instruction: a hover fires
  // from pointer motion the player is not thinking about, and — worse here —
  // `PointerRouter.refreshHover` re-derives it every frame from the WORLD, so
  // it can change with the cursor completely still. A press still sounds.

  _updateVictory() {
    const victory = this.victory;
    if (!victory) return;

    const active = !!victory.active;
    if (active !== this._victoryActive) {
      this._victoryActive = active;
      if (!active) this._victoryStage = VICTORY_STAGE.IDLE;
    }

    const stage = victory.stage ?? VICTORY_STAGE.IDLE;
    if (stage !== this._victoryStage) {
      const before = this._victoryStage;
      this._victoryStage = stage;
      // A DRAW jumps IDLE -> UI inside one synchronous call and never passes
      // through the hit at all, which is why `_updateSprites` and `_updateShake`
      // both guard on `_draw`. The same guard, as a sound.
      const drew = before === VICTORY_STAGE.IDLE && stage === VICTORY_STAGE.UI;
      if (drew) this.audio.play('victory_draw');
      else if (stage === VICTORY_STAGE.CHARGE) this.audio.play('victory_charge');
      else if (stage === VICTORY_STAGE.IMPACT) this.audio.play('victory_impact');
      else if (stage === VICTORY_STAGE.RESULT) this.audio.play('victory_loser');
      else if (stage === VICTORY_STAGE.UI) this.audio.play('victory_text');
      /**
       * ── pressing through the flourish must not be silent ────────────────
       * `VictoryClock.skip` jumps straight to DONE from wherever it was, so a
       * player who taps during the fly-in — which is what the skip is FOR —
       * lands on a stage no branch above answers, and the whole sequence
       * passes without a sound. The arrival still happened; it just happened
       * at once. So the screen's own sting plays on the way in.
       */
      else if (stage === VICTORY_STAGE.DONE && before !== VICTORY_STAGE.UI) {
        this.audio.play(this.match?.winner === 0 || this.match?.winner === 1
          ? 'victory_text'
          : 'victory_draw');
      }
    }
  }

  // ── the board ─────────────────────────────────────────────────────────────

  /**
   * Collisions, sliding, flips and falls — everything derived from the world.
   *
   * The three that are not contacts are read off `currTransforms` and `angvel`
   * rather than off any sensor: elimination is only marked at TURN END, so a cap
   * is "alive" for the whole of the fall that kills it and the pit sensor would
   * announce it several hundred steps after it was worth hearing.
   */
  _updateBoard(match, _dt) {
    // The reading itself belongs to `observe`, which may already have run this
    // frame on `CardFx`'s behalf. Either way it happens exactly once.
    this.observe();

    const live = PHYSICAL.has(match.state);
    if (live) {
      for (const hit of this._impacts) {
        this.audio.play(hit.id, {
          intensity: hit.intensity,
          gain: hit.gain ?? 1,
          // Which rung of the scale this collision lands on. Ignored by any
          // sound that does not carry `scale: true`.
          degree: hit.degree ?? 0,
        });
        /**
         * 철벽's "it held", ON TOP OF the crack rather than instead of it.
         *
         * The collision genuinely happened, so the collision sound belongs. What
         * the card changed is how it ENDED, and that is one short hard note on
         * the tail rather than a different event.
         *
         * The test is the MASS, not the card. Under §2-A a player holding 철벽
         * is not braced on their own turn, and a note that fired there would be
         * claiming credit for a shove the card did nothing about — the same
         * distinction `CardFx._updateResist` draws for the ring's flash, asked
         * the same way so the two cannot disagree about what "held" means.
         */
        if (this._held(match, hit.capA) || this._held(match, hit.capB)) {
          this.audio.play('resist_hold', { intensity: hit.intensity });
        }
      }
    }

    this._updateSlide(match, live);
    this._updateFlips(match, live);
    this._updateFalls(match, live);
    // RESPAWN makes no sound at all. See the note in `soundBank`.
  }

  /** Was this cap actually heavier when it was hit? -1 is "not a cap". */
  _held(match, index) {
    return index >= 0 && (match.arena?.capMassMul(index) ?? 1) > 1;
  }

  /**
   * The sliding bed, from the fastest cap on the board.
   *
   * `settle.peaks` is recomputed every physics step by the turn detector and
   * cached, so this is free — no extra WASM crossing, no scan. One voice for the
   * whole board: eight beds at eight speeds is a wash the ear cannot separate,
   * and the brief only asks for the sound of things moving.
   */
  _updateSlide(match, live) {
    const cfg = this.config.audio.slide ?? {};
    const peak = live ? match.settle?.peaks?.cap?.lin ?? 0 : 0;
    const min = Math.max(0, cfg.minSpeed ?? 14);
    const full = Math.max(min + 1, cfg.fullSpeed ?? 190);
    const t = Math.max(0, Math.min(1, (peak - min) / (full - min)));
    this.audio.setLoop('cap_slide', {
      on: live && t > 0.01,
      gain: t * Math.max(0, cfg.gain ?? 0.5),
      rate: lerp(1, Math.max(0.1, cfg.rateAtFull ?? 1.5), t),
      // A turn that times out zeroes every velocity in ONE step, so the bed
      // would cut to silence. Longer than the usual release, so it lands as an
      // ending rather than as a fault.
      fade: 0.14,
    });
  }

  /**
   * A cap turning over.
   *
   * The up vector's y component, straight out of the latched quaternion — plain
   * floats, no WASM crossing. Crossing zero is a flip by definition. Gated on
   * the cap actually spinning, so a cap teetering on its rim does not chirp
   * every time it rocks past vertical.
   */
  _updateFlips(match, live) {
    const arena = match.arena;
    const t = arena?.currTransforms;
    if (!t) return;
    const caps = arena.capCount;
    while (this._upSign.length < caps) this._upSign.push(1);

    if (!live) return;
    const minSpin = Math.max(0, this.config.audio.flipMinSpin ?? 3);

    for (let i = 0; i < caps; i++) {
      const o = i * 7;
      const qx = t[o + 3];
      const qy = t[o + 4];
      const qz = t[o + 5];
      const qw = t[o + 6];
      // The body-space +y axis, rotated. Only its y component is needed.
      const upY = 1 - 2 * (qx * qx + qz * qz);
      const sign = upY >= 0 ? 1 : -1;
      if (sign === this._upSign[i]) continue;
      this._upSign[i] = sign;
      if (!match.rules?.alive?.[i]) continue;

      const body = match.physics.body(arena.capBodies[i]);
      if (!body) continue;
      const w = body.angvel();
      const spin = Math.hypot(w.x, w.y, w.z);
      if (spin < minSpin) continue;
      this.audio.play('cap_flip', { intensity: Math.min(1, spin / 30) });
    }
  }

  /**
   * Over the edge.
   *
   * Once per cap per turn — `_fallen` is cleared when the turn reopens. The
   * verdict's own `ko_out` follows several hundred steps later and is a
   * different event: this is the trip, that is the confirmation.
   */
  _updateFalls(match, live) {
    if (!live) return;
    const arena = match.arena;
    const t = arena?.currTransforms;
    if (!t) return;
    const floor = this.config.audio.fallY ?? -3;
    for (let i = 0; i < arena.capCount; i++) {
      if (this._fallen.has(i)) continue;
      if (!match.rules?.alive?.[i]) continue;
      if (t[i * 7 + 1] > floor) continue;
      this._fallen.add(i);
      this.audio.play('cap_fall');
    }
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

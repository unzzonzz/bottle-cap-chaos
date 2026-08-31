import { categoryRank } from './categories.js';

/**
 * What is allowed to make a noise right now.
 *
 * ── the problem this exists for is specific and measurable ──────────────────
 * Eight caps in a chain. One flick puts six of them in motion, they hit each
 * other and the walls, and the contact observer can honestly report a dozen
 * impacts inside 150 ms. Played, that is not a dramatic collision — it is a
 * burst of white noise with no shape, and the individual hit the player was
 * watching is the one thing they cannot hear. The brief is blunt about it:
 * "뚜껑 8개가 연쇄 충돌해도 소음이 되지 않는다."
 *
 * Four rules, and each of them exists because one of the others is not enough:
 *
 *   COOLDOWN   the same sound twice inside a few frames is one sound played
 *              badly. Below the hard window it is dropped; just above it, it
 *              comes back at reduced level rather than at full — a chain should
 *              taper, not machine-gun and then stop dead.
 *   PER-SOUND  a cap on how many of ONE id may be live. Without it a hundred
 *              collisions still fit under a generous global cap and the result
 *              is the same wash.
 *   GLOBAL     a cap on everything. Without it the per-sound caps sum.
 *   PRIORITY   when the global cap is reached the question is not "refuse" but
 *              "refuse WHICH", and the answer must never be the card that was
 *              just played. A louder-ranked sound steals the quietest live
 *              voice; an equal or lower one is dropped.
 *
 * ── the chain is thinned before it gets here, too ───────────────────────────
 * `ContactAudio` sorts a frame's impacts by strength and offers only the
 * loudest few. That is the same requirement — "연쇄 충돌은 가장 강한 충돌 몇
 * 개만" — applied where the strengths are still comparable. This class is the
 * backstop for everything that is not a collision.
 *
 * ── nothing here touches the audio graph ───────────────────────────────────
 * It answers questions and holds records. Starting and stopping is the
 * `AudioSystem`'s, which is what keeps this testable without a device.
 */

export class VoicePool {
  /** @param {typeof import('../game/config.js').CONFIG.audio} config live block */
  constructor(config) {
    this.config = config;
    /** @type {{id: string, rank: number, voice: import('./SoundPlayer.js').Voice}[]} */
    this.active = [];
    /** id -> audio-clock time it last started. */
    this._last = new Map();
    /** Rolling count of what was refused, for the panel's readout. */
    this.dropped = 0;
    this.stolen = 0;
  }

  get count() {
    return this.active.length;
  }

  /** How many of this id are live. */
  countOf(id) {
    let n = 0;
    for (const rec of this.active) if (rec.id === id) n++;
    return n;
  }

  /**
   * Drop anything that has finished.
   *
   * Called once per render frame rather than from each voice's own `onended`:
   * the callback fires on the audio thread's schedule and would mutate this
   * array from underneath whatever is walking it. One sweep a frame is exact
   * enough — a voice that ended 8 ms ago and is still counted costs at most one
   * slot for one frame.
   */
  prune(now) {
    if (!this.active.length) return;
    let write = 0;
    for (let i = 0; i < this.active.length; i++) {
      const rec = this.active[i];
      if (rec.voice.endsAt > now) this.active[write++] = rec;
    }
    this.active.length = write;
  }

  /**
   * May this sound start, and at what level?
   *
   * @returns {{ok: false}|{ok: true, gain: number, steal: object|null}}
   *   `gain` is the cooldown taper, to be multiplied into whatever the caller
   *   asked for. `steal` is the record the caller must stop first.
   */
  request(def, now) {
    const cfg = this.config;
    const id = def.id;

    // ── cooldown ──────────────────────────────────────────────────────────
    const base = Math.max(0, def.cooldown ?? 0) * Math.max(0, cfg.cooldownScale ?? 1);
    let gain = 1;
    if (base > 0) {
      const last = this._last.get(id);
      if (last !== undefined) {
        const since = now - last;
        if (since < base) {
          this.dropped++;
          return { ok: false };
        }
        // The soft window. Between one and `softWindow` cooldowns the sound is
        // allowed but ducked, ramping back to full at the far edge — so a burst
        // fades out instead of stopping mid-chain, which is the difference
        // between a collision that rattles and one that gets cut off.
        const soft = base * Math.max(1, cfg.repeatWindowScale ?? 3);
        if (since < soft) {
          const t = (since - base) / Math.max(1e-4, soft - base);
          const duck = Math.max(0, Math.min(1, cfg.repeatDuck ?? 0.45));
          gain = duck + (1 - duck) * t;
        }
      }
    }

    // ── per-sound cap ─────────────────────────────────────────────────────
    const own = Math.max(1, Math.round(def.voices ?? cfg.voicesPerSound ?? 3));
    if (this.countOf(id) >= own) {
      this.dropped++;
      return { ok: false };
    }

    // ── global cap, and who gives way ─────────────────────────────────────
    const cap = Math.max(1, Math.round(cfg.maxVoices ?? 16));
    if (this.active.length < cap) return { ok: true, gain, steal: null };

    const rank = rankOf(def);
    let weakest = null;
    for (const rec of this.active) {
      if (!weakest || rec.rank < weakest.rank) weakest = rec;
    }
    // Strictly greater: an equal-ranked sound does not evict its own kind,
    // because "the newest of N identical things wins" is a rule that makes a
    // chain of collisions replace itself forever and never actually ring.
    if (!weakest || weakest.rank >= rank) {
      this.dropped++;
      return { ok: false };
    }
    this.stolen++;
    return { ok: true, gain, steal: weakest };
  }

  /** Record a voice that has been started. `request` said yes first. */
  add(def, voice, now) {
    this._last.set(def.id, now);
    const rec = { id: def.id, rank: rankOf(def), voice };
    this.active.push(rec);
    return rec;
  }

  /** Forget a record without stopping it. The caller owns the stop. */
  remove(rec) {
    const at = this.active.indexOf(rec);
    if (at >= 0) this.active.splice(at, 1);
  }

  /** Everything, for a scene change or a mute. The caller stops them. */
  takeAll() {
    const out = this.active.slice();
    this.active.length = 0;
    return out;
  }

  /**
   * Forget the cooldown history.
   *
   * The audio clock does not rewind, so this is not about time — it is for a
   * page or scene change, where the first sound of the new screen must not be
   * ducked because something with the same id happened before the transition.
   */
  clearHistory() {
    this._last.clear();
  }

  resetCounters() {
    this.dropped = 0;
    this.stolen = 0;
  }
}

/**
 * A sound's place in the ladder.
 *
 * Category first and per-sound second, scaled so a definition's own priority can
 * order it within its category but never lift it out of one — see the note in
 * `categories.js`. A goal is a stinger and a cap collision is an impact, and no
 * value of `priority` on a collision may make it outrank the goal.
 */
export function rankOf(def) {
  const own = Math.max(0, Math.min(9, Math.round(def.priority ?? 0)));
  return categoryRank(def.category) * 10 + own;
}
